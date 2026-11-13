// Parte del día: registrar lo que pasó de verdad, validando o corrigiendo lo planificado.
//  · Cada tramo se cierra como «hecho» (tal cual), «corregido» (otras horas / otra gente) o
//    «no_hecho» (se quita del plan y sus horas vuelven a pendientes).
//  · Las horas reales van a REGISTROS (persona / máquina, tarea, horas y su coste/hora de ese momento).
//  · TRAMO_CIERRES guarda cada cierre con lo que estaba planificado, para los informes.
//  · Al cerrar el día, nada de ese día se puede replanificar (se reabre si hace falta).
const { query, tx } = require('./db');
const auth = require('./auth');
const { jornada } = require('./config');

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const r2 = (x) => Math.round(x * 100) / 100;
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

const MOTIVOS = {
  material: 'Falta de material',
  averia: 'Avería / máquina',
  retrabajo: 'Retrabajo / error',
  cliente: 'Cambio o espera del cliente',
  clima: 'Clima',
  ausencia: 'Ausencia de personal',
  estimacion: 'Mal estimado',
  otro: 'Otro',
};
const NO_PRODUCTIVO = {
  desplazamiento: 'Desplazamiento',
  espera: 'Espera',
  limpieza: 'Limpieza / orden',
  mantenimiento: 'Mantenimiento del taller',
  formacion: 'Formación',
  otro: 'Otro',
};

function leerFecha(v) {
  if (!FECHA_RE.test(String(v || ''))) throw fallo(400, 'Fecha no válida');
  return String(v);
}
function leerHora(v, campo) {
  const h = Number(v);
  if (!Number.isFinite(h) || h < 0 || h > 24 || (h * 4) % 1 !== 0) throw fallo(400, `${campo} no válida`);
  return h;
}

async function diaCerrado(c, fecha) {
  const { rows } = await c.query('SELECT 1 FROM dias_cerrados WHERE fecha = $1', [fecha]);
  return rows.length > 0;
}
async function exigirAbierto(c, fecha) {
  if (await diaCerrado(c, fecha)) throw fallo(409, `El parte del ${fecha.split('-').reverse().join('/')} está cerrado: reábrelo para cambiarlo`);
}

// Coste/hora vigente de cada recurso (se copia en el registro para que el histórico no cambie)
async function costes(c, ids) {
  if (!ids.length) return new Map();
  const { rows } = await c.query('SELECT id, tipo, coste_hora::float AS coste FROM recursos WHERE id = ANY($1)', [ids]);
  return new Map(rows.map((r) => [r.id, r]));
}

async function tramoCompleto(c, id) {
  const { rows } = await c.query(
    `SELECT x.*, t.nombre AS tarea, t.estado AS tarea_estado, t.duracion_h AS tarea_h, o.codigo AS orden_codigo,
            COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nombre', r.nombre, 'tipo', r.tipo,
                       'desde', COALESCE(a.desde, x.hora_inicio)::float, 'hasta', COALESCE(a.hasta, x.hora_inicio + x.duracion_h)::float))
                        FROM tramo_asignaciones a JOIN recursos r ON r.id = a.recurso_id WHERE a.tramo_id = x.id), '[]') AS asignados
       FROM tramos x JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id WHERE x.id = $1 FOR UPDATE OF x`, [id]);
  if (!rows.length) throw fallo(404, 'Tramo no encontrado');
  return rows[0];
}

async function historial(c, usuarioId, tareaId, accion, detalle) {
  await c.query('INSERT INTO historial (usuario_id, tarea_id, accion, detalle) VALUES ($1,$2,$3,$4)', [usuarioId, tareaId, accion, detalle]);
}

// Avance de la tarea al cerrar un tramo: terminada, o «faltan X h» (reestima lo que queda)
async function avanzarTarea(c, usuarioId, tr, progreso) {
  if (!progreso) {
    await c.query(`UPDATE tareas SET estado = 'en_curso' WHERE id = $1 AND estado = 'pendiente'`, [tr.tarea_id]);
    return;
  }
  if (progreso.terminada) {
    await c.query(`UPDATE tareas SET estado = 'hecha', hecha_en = now(), hecha_por = $2, actualizado = now(), actualizado_por = $2 WHERE id = $1`,
      [tr.tarea_id, usuarioId]);
    await historial(c, usuarioId, tr.tarea_id, 'estado', { estado: 'hecha', por: 'parte', fecha: tr.fecha });
    return;
  }
  if (progreso.faltan_h != null) {
    const faltan = Number(progreso.faltan_h);
    if (!Number.isFinite(faltan) || faltan < 0 || faltan > 999 || (faltan * 2) % 1 !== 0) throw fallo(400, 'Horas que faltan no válidas (en medias horas)');
    // lo hecho hasta este tramo (incluido) + lo que falta = nueva duración de la tarea
    const { rows } = await c.query(
      `SELECT COALESCE(sum(duracion_h), 0)::float AS hecho FROM tramos
        WHERE tarea_id = $1 AND (fecha, hora_inicio, id) <= ($2::date, $3, $4)`, [tr.tarea_id, tr.fecha, tr.hora_inicio, tr.id]);
    const nueva = r2(Math.max(0.5, rows[0].hecho + faltan));
    await c.query(
      `UPDATE tareas SET duracion_inicial_h = COALESCE(duracion_inicial_h, duracion_h), duracion_h = $2,
              estado = CASE WHEN estado = 'pendiente' THEN 'en_curso' ELSE estado END, actualizado = now(), actualizado_por = $3
        WHERE id = $1`, [tr.tarea_id, nueva, usuarioId]);
    await historial(c, usuarioId, tr.tarea_id, 'reestimar', { faltan_h: faltan, duracion_h: nueva, fecha: tr.fecha });
  }
}

function montar(app, asyncH) {
  const puede = auth.permiso('planificar');

  // Guarda: un tramo cerrado o de un día cerrado no se replanifica
  app.use('/api/tramos/:id', asyncH(async (req, res, next) => {
    if (req.method === 'GET' || req.path.startsWith('/cierre')) return next();
    const { rows } = await query('SELECT fecha, cierre FROM tramos WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) return next();
    if (rows[0].cierre) throw fallo(409, 'Este tramo ya está cerrado en el parte: deshaz el cierre para cambiarlo');
    await exigirAbierto({ query }, rows[0].fecha);
    if (req.body?.fecha && FECHA_RE.test(req.body.fecha)) await exigirAbierto({ query }, req.body.fecha);
    next();
  }));
  app.post('/api/tareas/:id/tramos', asyncH(async (req, res, next) => {
    if (req.body?.fecha && FECHA_RE.test(req.body.fecha)) await exigirAbierto({ query }, req.body.fecha);
    next();
  }));

  app.get('/api/parte/listas', (req, res) => res.json({ motivos: MOTIVOS, no_productivo: NO_PRODUCTIVO }));

  /* ---------- Parte de un día ---------- */
  app.get('/api/parte', asyncH(async (req, res) => {
    const fecha = leerFecha(req.query.fecha);
    const [cerrado, tramos, cierres, registros, ausencias, recursos] = await Promise.all([
      query(`SELECT d.fecha, d.cerrado_en, u.nombre AS cerrado_por FROM dias_cerrados d LEFT JOIN usuarios u ON u.id = d.cerrado_por WHERE d.fecha = $1`, [fecha]),
      query(`SELECT x.id, x.tarea_id, x.fecha, x.hora_inicio::float AS hora_inicio, x.duracion_h::float AS duracion_h, x.linea_id, x.cierre,
                    l.nombre AS area, t.nombre AS tarea, t.estado AS tarea_estado, t.duracion_h::float AS tarea_h, t.operarios_req,
                    o.codigo AS orden_codigo, o.titulo AS orden_titulo, o.color, p.codigo AS proyecto,
                    (SELECT COALESCE(sum(y.duracion_h), 0)::float FROM tramos y WHERE y.tarea_id = t.id) AS tarea_planificadas,
                    (SELECT count(*)::int FROM tramos y WHERE y.tarea_id = t.id AND (y.fecha, y.hora_inicio) > (x.fecha, x.hora_inicio)) AS tramos_despues,
                    COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nombre', r.nombre, 'tipo', r.tipo,
                               'desde', COALESCE(a.desde, x.hora_inicio)::float, 'hasta', COALESCE(a.hasta, x.hora_inicio + x.duracion_h)::float)
                               ORDER BY r.tipo, r.nombre)
                                FROM tramo_asignaciones a JOIN recursos r ON r.id = a.recurso_id WHERE a.tramo_id = x.id), '[]') AS asignados
               FROM tramos x JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id
               LEFT JOIN proyectos p ON p.id = o.proyecto_id LEFT JOIN lineas l ON l.id = x.linea_id
              WHERE x.fecha = $1 ORDER BY x.hora_inicio, l.nombre, x.id`, [fecha]),
      query(`SELECT c.*, c.hora_inicio::float AS hora_inicio, c.duracion_h::float AS duracion_h, t.nombre AS tarea, o.codigo AS orden_codigo,
                    o.color, l.nombre AS area, u.nombre AS cerrado_por_nombre
               FROM tramo_cierres c JOIN tareas t ON t.id = c.tarea_id JOIN ordenes o ON o.id = t.orden_id
               LEFT JOIN lineas l ON l.id = c.linea_id LEFT JOIN usuarios u ON u.id = c.cerrado_por
              WHERE c.fecha = $1`, [fecha]),
      query(`SELECT g.id, g.recurso_id, g.tarea_id, g.tramo_id, g.desde::float AS desde, g.hasta::float AS hasta, g.horas::float AS horas,
                    g.tipo, g.motivo, g.notas, r.nombre AS recurso, r.tipo AS clase, t.nombre AS tarea, o.codigo AS orden_codigo
               FROM registros g JOIN recursos r ON r.id = g.recurso_id
               LEFT JOIN tareas t ON t.id = g.tarea_id LEFT JOIN ordenes o ON o.id = t.orden_id
              WHERE g.fecha = $1 ORDER BY r.nombre, g.desde NULLS LAST`, [fecha]),
      query(`SELECT a.recurso_id, a.tipo, a.hora_desde::float AS hora_desde, a.hora_hasta::float AS hora_hasta, a.justificante
               FROM ausencias a WHERE $1 BETWEEN a.desde AND a.hasta`, [fecha]),
      query(`SELECT id, nombre, tipo, activo FROM recursos WHERE activo ORDER BY tipo, nombre`),
    ]);
    const porCierre = new Map(cierres.rows.filter((c) => c.tramo_id).map((c) => [c.tramo_id, c]));
    for (const tr of tramos.rows) {
      tr.cierre_info = porCierre.get(tr.id) || null;
      tr.registros = registros.rows.filter((g) => g.tramo_id === tr.id);
    }
    res.json({
      fecha, jornada, cerrado: cerrado.rows[0] || null,
      tramos: tramos.rows,
      no_hechos: cierres.rows.filter((c) => c.cierre === 'no_hecho'),
      sueltos: registros.rows.filter((g) => !g.tramo_id),
      registros: registros.rows,
      ausencias: ausencias.rows,
      recursos: recursos.rows,
      motivos: MOTIVOS, no_productivo: NO_PRODUCTIVO,
    });
  }));

  /* ---------- Cerrar un tramo ---------- */
  // { accion: 'hecho' | 'corregido' | 'no_hecho', registros?: [{recurso_id, desde, hasta}],
  //   motivo?, notas?, progreso?: { terminada: true } | { faltan_h: n } }
  app.post('/api/tramos/:id/cierre', puede, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    if (!['hecho', 'corregido', 'no_hecho'].includes(b.accion)) throw fallo(400, 'Acción no válida');
    if (b.motivo && !MOTIVOS[b.motivo]) throw fallo(400, 'Motivo no válido');
    if (b.accion === 'no_hecho' && !b.motivo) throw fallo(400, 'Di por qué no se hizo');
    const notas = String(b.notas || '').trim().slice(0, 1000) || null;

    const out = await tx(async (c) => {
      const tr = await tramoCompleto(c, id);
      await exigirAbierto(c, tr.fecha);
      if (tr.cierre) throw fallo(409, 'Este tramo ya está cerrado: deshaz el cierre para cambiarlo');
      const plan = { hora_inicio: tr.hora_inicio, duracion_h: tr.duracion_h, asignados: tr.asignados };

      // horas reales
      let filas = [];
      if (b.accion === 'hecho') {
        // tal cual, salvo quien faltó todo el día (ausencias)
        const { rows: aus } = await c.query(
          `SELECT recurso_id FROM ausencias WHERE $1 BETWEEN desde AND hasta AND hora_desde IS NULL`, [tr.fecha]);
        const fuera = new Set(aus.map((a) => a.recurso_id));
        filas = tr.asignados.filter((a) => !fuera.has(a.id)).map((a) => ({ recurso_id: a.id, desde: a.desde, hasta: a.hasta }));
      } else if (b.accion === 'corregido') {
        if (!Array.isArray(b.registros)) throw fallo(400, 'Faltan las horas reales');
        filas = b.registros.map((g) => {
          const desde = leerHora(g.desde, 'Hora de inicio'), hasta = leerHora(g.hasta, 'Hora de fin');
          if (hasta <= desde) throw fallo(400, 'La hora de fin debe ser posterior a la de inicio');
          return { recurso_id: Number(g.recurso_id), desde, hasta };
        });
      }
      const cost = await costes(c, filas.map((f) => f.recurso_id));
      for (const f of filas) {
        if (!cost.has(f.recurso_id)) throw fallo(400, 'Recurso no válido');
        await c.query(
          `INSERT INTO registros (fecha, recurso_id, tarea_id, tramo_id, desde, hasta, horas, tipo, coste_hora, creado_por)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'productivo',$8,$9)`,
          [tr.fecha, f.recurso_id, tr.tarea_id, b.accion === 'no_hecho' ? null : id, f.desde, f.hasta, r2(f.hasta - f.desde), cost.get(f.recurso_id).coste, req.usuario.id]);
      }
      // horas-persona reales (solo operarios, igual que las planificadas)
      const realH = r2(filas.filter((f) => cost.get(f.recurso_id).tipo === 'operario').reduce((s, f) => s + (f.hasta - f.desde), 0));
      const planH = r2(tr.asignados.filter((a) => a.tipo === 'operario').reduce((s, a) => s + (a.hasta - a.desde), 0));

      await c.query(
        `INSERT INTO tramo_cierres (tramo_id, tarea_id, fecha, hora_inicio, duracion_h, linea_id, cierre, motivo, notas, plan, plan_h, real_h, cerrado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [b.accion === 'no_hecho' ? null : id, tr.tarea_id, tr.fecha, tr.hora_inicio, tr.duracion_h, tr.linea_id, b.accion,
          b.motivo || null, notas, JSON.stringify(plan), planH, realH, req.usuario.id]);

      if (b.accion === 'no_hecho') {
        // se quita del plan: sus horas vuelven a «Por planificar»
        await c.query('DELETE FROM tramos WHERE id = $1', [id]);
        await historial(c, req.usuario.id, tr.tarea_id, 'no_hecho', { fecha: tr.fecha, motivo: b.motivo, notas });
      } else {
        await c.query('UPDATE tramos SET cierre = $2 WHERE id = $1', [id, b.accion]);
        await historial(c, req.usuario.id, tr.tarea_id, 'parte', { tramo_id: id, cierre: b.accion, real_h: realH, motivo: b.motivo || null });
        await avanzarTarea(c, req.usuario.id, tr, b.progreso);
      }
      return { ok: true, real_h: realH };
    });
    res.json(out);
  }));

  // Deshacer el cierre de un tramo (o recuperar un «no se hizo»)
  app.delete('/api/cierres/:id', puede, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM tramo_cierres WHERE id = $1 FOR UPDATE', [id]);
      if (!rows.length) throw fallo(404, 'Cierre no encontrado');
      const ci = rows[0];
      await exigirAbierto(c, ci.fecha);
      if (ci.cierre === 'no_hecho') {
        // vuelve a ponerse el tramo como estaba planificado
        const plan = ci.plan || {};
        const { rows: nt } = await c.query(
          `INSERT INTO tramos (tarea_id, fecha, hora_inicio, duracion_h, linea_id, actualizado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [ci.tarea_id, ci.fecha, ci.hora_inicio, ci.duracion_h, ci.linea_id, req.usuario.id]);
        for (const a of plan.asignados || []) {
          const propia = a.desde !== Number(ci.hora_inicio) || a.hasta !== Number(ci.hora_inicio) + Number(ci.duracion_h);
          await c.query(`INSERT INTO tramo_asignaciones (tramo_id, recurso_id, asignado_por, desde, hasta) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
            [nt[0].id, a.id, req.usuario.id, propia ? a.desde : null, propia ? a.hasta : null]).catch(() => {});
        }
      } else {
        await c.query('DELETE FROM registros WHERE tramo_id = $1', [ci.tramo_id]);
        await c.query('UPDATE tramos SET cierre = NULL WHERE id = $1', [ci.tramo_id]);
      }
      await c.query('DELETE FROM tramo_cierres WHERE id = $1', [id]);
      await historial(c, req.usuario.id, ci.tarea_id, 'deshacer_parte', { fecha: ci.fecha, cierre: ci.cierre });
    });
    res.json({ ok: true });
  }));

  /* ---------- Horas sin planificar y no productivas ---------- */
  // { fecha, recurso_id, tarea_id?, desde, hasta, tipo: productivo|no_productivo, motivo?, notas? }
  app.post('/api/registros', puede, asyncH(async (req, res) => {
    const b = req.body || {};
    const fecha = leerFecha(b.fecha);
    const desde = leerHora(b.desde, 'Hora de inicio'), hasta = leerHora(b.hasta, 'Hora de fin');
    if (hasta <= desde) throw fallo(400, 'La hora de fin debe ser posterior a la de inicio');
    const tipo = b.tipo === 'no_productivo' ? 'no_productivo' : 'productivo';
    if (tipo === 'productivo' && !b.tarea_id) throw fallo(400, 'Elige la tarea en la que trabajó');
    if (tipo === 'no_productivo' && !NO_PRODUCTIVO[b.motivo]) throw fallo(400, 'Elige qué hizo (desplazamiento, espera…)');
    const out = await tx(async (c) => {
      await exigirAbierto(c, fecha);
      const cost = await costes(c, [Number(b.recurso_id)]);
      if (!cost.has(Number(b.recurso_id))) throw fallo(400, 'Recurso no válido');
      const { rows } = await c.query(
        `INSERT INTO registros (fecha, recurso_id, tarea_id, desde, hasta, horas, tipo, motivo, notas, coste_hora, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [fecha, Number(b.recurso_id), tipo === 'productivo' ? Number(b.tarea_id) : null, desde, hasta, r2(hasta - desde), tipo,
          tipo === 'no_productivo' ? b.motivo : null, String(b.notas || '').trim().slice(0, 500) || null, cost.get(Number(b.recurso_id)).coste, req.usuario.id]);
      if (tipo === 'productivo') {
        await c.query(`UPDATE tareas SET estado = 'en_curso' WHERE id = $1 AND estado = 'pendiente'`, [Number(b.tarea_id)]);
        await historial(c, req.usuario.id, Number(b.tarea_id), 'sin_planificar', { fecha, recurso_id: Number(b.recurso_id), horas: r2(hasta - desde) });
      }
      return { id: rows[0].id };
    });
    res.status(201).json(out);
  }));

  app.delete('/api/registros/:id', puede, asyncH(async (req, res) => {
    await tx(async (c) => {
      const { rows } = await c.query('SELECT fecha, tramo_id FROM registros WHERE id = $1', [Number(req.params.id)]);
      if (!rows.length) throw fallo(404, 'Registro no encontrado');
      if (rows[0].tramo_id) throw fallo(400, 'Estas horas son del cierre de un tramo: deshaz ese cierre');
      await exigirAbierto(c, rows[0].fecha);
      await c.query('DELETE FROM registros WHERE id = $1', [Number(req.params.id)]);
    });
    res.json({ ok: true });
  }));

  /* ---------- Cerrar / reabrir el día ---------- */
  // { fecha, validar_resto: true } valida como «hecho» lo que quede sin cerrar
  app.post('/api/parte/cerrar', puede, asyncH(async (req, res) => {
    const fecha = leerFecha(req.body?.fecha);
    const out = await tx(async (c) => {
      await exigirAbierto(c, fecha);
      const { rows: abiertos } = await c.query('SELECT id FROM tramos WHERE fecha = $1 AND cierre IS NULL ORDER BY hora_inicio, id', [fecha]);
      if (abiertos.length && !req.body?.validar_resto) throw fallo(409, `Quedan ${abiertos.length} tramo(s) sin cerrar`);
      let validados = 0;
      for (const { id } of abiertos) {
        const tr = await tramoCompleto(c, id);
        const { rows: aus } = await c.query(`SELECT recurso_id FROM ausencias WHERE $1 BETWEEN desde AND hasta AND hora_desde IS NULL`, [fecha]);
        const fuera = new Set(aus.map((a) => a.recurso_id));
        const filas = tr.asignados.filter((a) => !fuera.has(a.id));
        const cost = await costes(c, filas.map((a) => a.id));
        for (const a of filas) {
          await c.query(
            `INSERT INTO registros (fecha, recurso_id, tarea_id, tramo_id, desde, hasta, horas, tipo, coste_hora, creado_por)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'productivo',$8,$9)`,
            [fecha, a.id, tr.tarea_id, id, a.desde, a.hasta, r2(a.hasta - a.desde), cost.get(a.id).coste, req.usuario.id]);
        }
        const planH = r2(tr.asignados.filter((a) => a.tipo === 'operario').reduce((s, a) => s + (a.hasta - a.desde), 0));
        await c.query(
          `INSERT INTO tramo_cierres (tramo_id, tarea_id, fecha, hora_inicio, duracion_h, linea_id, cierre, plan, plan_h, real_h, cerrado_por)
           VALUES ($1,$2,$3,$4,$5,$6,'hecho',$7,$8,$9,$10)`,
          [id, tr.tarea_id, fecha, tr.hora_inicio, tr.duracion_h, tr.linea_id,
            JSON.stringify({ hora_inicio: tr.hora_inicio, duracion_h: tr.duracion_h, asignados: tr.asignados }), planH,
            r2(filas.filter((a) => a.tipo === 'operario').reduce((s, a) => s + (a.hasta - a.desde), 0)), req.usuario.id]);
        await c.query('UPDATE tramos SET cierre = $2 WHERE id = $1', [id, 'hecho']);
        await c.query(`UPDATE tareas SET estado = 'en_curso' WHERE id = $1 AND estado = 'pendiente'`, [tr.tarea_id]);
        validados++;
      }
      await c.query('INSERT INTO dias_cerrados (fecha, cerrado_por) VALUES ($1,$2)', [fecha, req.usuario.id]);
      return { ok: true, validados };
    });
    res.json(out);
  }));

  app.delete('/api/parte/cerrar', puede, asyncH(async (req, res) => {
    const fecha = leerFecha(req.query.fecha);
    await query('DELETE FROM dias_cerrados WHERE fecha = $1', [fecha]);
    res.json({ ok: true });
  }));

  // Días con trabajo planificado que ya pasaron y están sin cerrar (últimos 60 días)
  app.get('/api/parte/pendientes', asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT x.fecha, count(*)::int AS tramos, count(*) FILTER (WHERE x.cierre IS NULL)::int AS abiertos
         FROM tramos x
        WHERE x.fecha < CURRENT_DATE AND x.fecha >= CURRENT_DATE - 60
          AND NOT EXISTS (SELECT 1 FROM dias_cerrados d WHERE d.fecha = x.fecha)
        GROUP BY x.fecha ORDER BY x.fecha`);
    res.json(rows);
  }));
}

module.exports = { montar, MOTIVOS, NO_PRODUCTIVO, hhmm };
