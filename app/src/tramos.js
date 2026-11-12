// Tablero diario y tramos.
//  · Una tarea se planifica en uno o varios TRAMOS (día, hora, horas, área).
//  · Cada recurso asignado a un tramo tiene su FRANJA (desde–hasta). NULL = todo el tramo.
//    Así se registra que un operario estuvo 4h y otro 8h en el mismo tramo.
//  · Los tramos pueden superar las horas estimadas de la tarea: la diferencia es el exceso.
const { query, tx } = require('./db');
const auth = require('./auth');
const { jornada } = require('./config');
const { calcularConflictos } = require('./conflictos');

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const mediaHora = (h) => Math.floor(h * 2 + 1e-9) / 2;
const r1 = (x) => Math.round(x * 100) / 100;
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

function leerHora(v, campo = 'Hora') {
  const h = Number(v);
  if (!Number.isFinite(h) || h < 0 || h > 24 || (h * 2) % 1 !== 0) throw fallo(400, `${campo} no válida (en medias horas)`);
  return h;
}
function leerDuracion(v) {
  const d = Number(v);
  if (!(d > 0 && d <= 24 && (d * 2) % 1 === 0)) throw fallo(400, 'Horas del tramo no válidas (en medias horas, máx. 24)');
  return d;
}
function leerFecha(v) {
  if (!FECHA_RE.test(String(v || ''))) throw fallo(400, 'Fecha no válida');
  return String(v);
}

// Hora a la que "acaba el día" para un tramo que empieza a la hora h
const finDelDia = (h) => (h < jornada.fin ? jornada.fin : jornada.vistaFin);

async function registrar(c, usuarioId, tareaId, accion, detalle) {
  await c.query('INSERT INTO historial (usuario_id, tarea_id, accion, detalle) VALUES ($1,$2,$3,$4)',
    [usuarioId, tareaId, accion, detalle]);
}

async function horasTarea(c, tareaId, excluirTramo = 0) {
  const { rows } = await c.query(
    `SELECT t.duracion_h, t.linea_id,
            COALESCE((SELECT sum(duracion_h) FROM tramos WHERE tarea_id = t.id AND id <> $2), 0)::float AS planificadas
       FROM tareas t WHERE t.id = $1 FOR UPDATE`, [tareaId, excluirTramo]);
  if (!rows.length) throw fallo(404, 'Tarea no encontrada');
  return { ...rows[0], pendientes: rows[0].duracion_h - rows[0].planificadas };
}

// Tras mover o redimensionar un tramo, sus franjas propias se desplazan con él y se recortan
// a sus nuevos límites; una franja que cubre todo el tramo vuelve a "todo el tramo" (NULL).
async function ajustarFranjas(c, tramoId, delta) {
  if (delta) {
    await c.query(`UPDATE tramo_asignaciones SET desde = desde + $2, hasta = hasta + $2
                    WHERE tramo_id = $1 AND desde IS NOT NULL`, [tramoId, delta]);
  }
  await c.query(
    `UPDATE tramo_asignaciones a SET desde = GREATEST(a.desde, t.hora_inicio),
                                     hasta = LEAST(a.hasta, t.hora_inicio + t.duracion_h)
       FROM tramos t WHERE t.id = a.tramo_id AND a.tramo_id = $1 AND a.desde IS NOT NULL`, [tramoId]);
  await c.query(
    `UPDATE tramo_asignaciones a SET desde = NULL, hasta = NULL
       FROM tramos t WHERE t.id = a.tramo_id AND a.tramo_id = $1 AND a.desde IS NOT NULL
        AND (a.desde >= a.hasta OR (a.desde = t.hora_inicio AND a.hasta = t.hora_inicio + t.duracion_h))`, [tramoId]);
}

const SQL_TAREAS = `
  SELECT t.id, t.nombre, t.duracion_h, t.operarios_req, t.linea_id, t.estado, t.orden_en_of,
         o.id AS orden_id, o.codigo AS orden_codigo, o.color AS orden_color, o.titulo AS orden_titulo,
         o.prioridad, o.partida, o.fecha_entrega,
         p.codigo AS proyecto, p.nombre AS proyecto_nombre, p.cliente, p.obra,
         COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nombre', r.nombre, 'tipo', r.tipo) ORDER BY r.tipo, r.nombre)
                     FROM tarea_requisitos tr JOIN recursos r ON r.id = tr.recurso_id
                    WHERE tr.tarea_id = t.id), '[]') AS requisitos,
         COALESCE((SELECT json_agg(json_build_object('id', x.id, 'fecha', x.fecha, 'hora_inicio', x.hora_inicio,
                                                     'duracion_h', x.duracion_h) ORDER BY x.fecha, x.hora_inicio, x.id)
                     FROM tramos x WHERE x.tarea_id = t.id), '[]') AS tramos,
         COALESCE((SELECT sum(duracion_h) FROM tramos x WHERE x.tarea_id = t.id), 0)::float AS horas_planificadas,
         COALESCE((SELECT sum(COALESCE(a.hasta, x.hora_inicio + x.duracion_h) - COALESCE(a.desde, x.hora_inicio))
                     FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id
                     JOIN recursos r ON r.id = a.recurso_id AND r.tipo = 'operario'
                    WHERE x.tarea_id = t.id), 0)::float AS horas_persona
    FROM tareas t
    JOIN ordenes o ON o.id = t.orden_id
    LEFT JOIN proyectos p ON p.id = o.proyecto_id`;

// Tramos de un día con sus recursos y la franja efectiva de cada uno
const SQL_TRAMOS_DIA = `
  SELECT tr.id, tr.tarea_id, tr.fecha, tr.hora_inicio, tr.duracion_h, tr.linea_id,
         COALESCE((SELECT json_agg(json_build_object(
                     'id', r.id, 'nombre', r.nombre, 'tipo', r.tipo,
                     'desde', COALESCE(a.desde, tr.hora_inicio),
                     'hasta', COALESCE(a.hasta, tr.hora_inicio + tr.duracion_h),
                     'propia', a.desde IS NOT NULL) ORDER BY r.tipo, r.nombre)
                     FROM tramo_asignaciones a JOIN recursos r ON r.id = a.recurso_id
                    WHERE a.tramo_id = tr.id), '[]') AS asignados
    FROM tramos tr`;

/* ---------- Empujar: calcula qué tramos del día hay que retrasar ---------- */
// Tras alargar un tramo (o la franja de un operario), los tramos posteriores del mismo día que
// comparten área u operario/recurso y ahora se solapan se retrasan lo justo, en cascada.
// Lo que pase del fin de jornada se recorta (vuelve a pendientes); si empieza después, se quita.
function planEmpuje(base, tramosDia, nombres) {
  const fin = (x) => x.hora_inicio + x.duracion_h;
  const ocupado = new Map();   // clave (a:área / r:recurso) -> hora a partir de la que está libre
  const marcar = (x, delta) => {
    if (x.linea_id) ocupado.set(`a${x.linea_id}`, Math.max(ocupado.get(`a${x.linea_id}`) ?? 0, fin(x) + delta));
    for (const r of x.asignados) ocupado.set(`r${r.id}`, Math.max(ocupado.get(`r${r.id}`) ?? 0, r.hasta + delta));
  };
  marcar(base, 0);

  const cambios = [];
  const siguientes = tramosDia
    .filter((x) => x.id !== base.id && x.hora_inicio >= base.hora_inicio)
    .sort((a, b) => a.hora_inicio - b.hora_inicio || a.id - b.id);
  for (const x of siguientes) {
    let delta = 0;
    if (x.linea_id && ocupado.has(`a${x.linea_id}`)) delta = Math.max(delta, ocupado.get(`a${x.linea_id}`) - x.hora_inicio);
    for (const r of x.asignados) if (ocupado.has(`r${r.id}`)) delta = Math.max(delta, ocupado.get(`r${r.id}`) - r.desde);
    delta = Math.ceil(delta * 2 - 1e-9) / 2;   // en medias horas
    if (delta <= 0) continue;

    const ini = x.hora_inicio + delta;
    const limite = Math.max(jornada.fin, fin(x));          // no se recorta lo que ya era horas extra
    const quitar = ini >= limite;
    const dur = quitar ? 0 : Math.min(x.duracion_h, limite - ini);
    cambios.push({
      id: x.id, tarea_id: x.tarea_id, delta, hora_inicio: ini, duracion_h: dur, quitar,
      recorte: quitar ? x.duracion_h : r1(x.duracion_h - dur),
      texto: `${nombres.get(x.tarea_id) || 'Tramo'}: ${hhmm(x.hora_inicio)}–${hhmm(fin(x))} → `
        + (quitar ? 'se quita del día (vuelve a pendientes)'
          : `${hhmm(ini)}–${hhmm(ini + dur)}${dur < x.duracion_h ? ` (recortado ${r1(x.duracion_h - dur)}h, vuelven a pendientes)` : ''}`),
    });
    marcar(x, delta);
  }
  return cambios;
}

module.exports = function montar(app, asyncH) {
  /* ---------- Tablero (un día, una semana o un mes) ---------- */
  // ?fecha=YYYY-MM-DD (un día) o ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD (rango, máx. 62 días)
  app.get('/api/tablero', asyncH(async (req, res) => {
    const desde = leerFecha(req.query.desde ?? req.query.fecha);
    const hasta = req.query.hasta != null ? leerFecha(req.query.hasta) : desde;
    const dias = (Date.parse(hasta) - Date.parse(desde)) / 864e5;
    if (dias < 0 || dias > 62) throw fallo(400, 'Rango de fechas no válido (máx. 62 días)');

    const [lineas, recursos, tareas, tramos] = await Promise.all([
      // Áreas activas + las inactivas que aún tengan tramos en el rango (para no perderlos)
      query(`SELECT id, nombre, tipo, ubicacion, activo FROM lineas l
              WHERE activo OR EXISTS (SELECT 1 FROM tramos x WHERE x.linea_id = l.id AND x.fecha BETWEEN $1 AND $2)
              ORDER BY orden, nombre`, [desde, hasta]),
      // Recursos activos + los dados de baja que aún tienen algo asignado en el rango
      query(`SELECT id, tipo, nombre, categoria, activo FROM recursos r
              WHERE activo OR EXISTS (SELECT 1 FROM tramo_asignaciones a JOIN tramos x ON x.id = a.tramo_id
                                       WHERE a.recurso_id = r.id AND x.fecha BETWEEN $1 AND $2)
              ORDER BY tipo, nombre`, [desde, hasta]),
      // Tareas de OTs abiertas + las que tienen algún tramo en el rango
      query(`${SQL_TAREAS}
              WHERE (o.estado = 'abierta' AND t.estado <> 'hecha')
                 OR EXISTS (SELECT 1 FROM tramos x WHERE x.tarea_id = t.id AND x.fecha BETWEEN $1 AND $2)
              ORDER BY o.prioridad, o.fecha_entrega NULLS LAST, o.codigo, t.orden_en_of, t.id`, [desde, hasta]),
      query(`${SQL_TRAMOS_DIA} WHERE tr.fecha BETWEEN $1 AND $2 ORDER BY tr.fecha, tr.hora_inicio, tr.id`, [desde, hasta]),
    ]);

    // Cada tramo lleva su número dentro de la tarea ("2 de 3") y su exceso sobre lo estimado
    const porTarea = new Map(tareas.rows.map((t) => [t.id, t]));
    for (const tr of tramos.rows) {
      const t = porTarea.get(tr.tarea_id);
      const i = t ? t.tramos.findIndex((x) => x.id === tr.id) : 0;
      tr.indice = i + 1;
      const acumulado = t ? t.tramos.slice(0, i + 1).reduce((s, x) => s + x.duracion_h, 0) : 0;
      tr.exceso = t ? Math.max(0, Math.min(tr.duracion_h, r1(acumulado - t.duracion_h))) : 0;
    }
    // Los conflictos se calculan día a día (un solape solo existe dentro del mismo día)
    const porDia = new Map();
    for (const tr of tramos.rows) {
      if (!porDia.has(tr.fecha)) porDia.set(tr.fecha, []);
      const t = porTarea.get(tr.tarea_id);
      porDia.get(tr.fecha).push({ ...t, ...tr, duracion_h_tarea: t?.duracion_h });
    }
    const conflictos = [...porDia].flatMap(([f, lista]) =>
      calcularConflictos(lista, jornada).map((c) => ({ ...c, fecha: f })));

    res.json({ fecha: desde, desde, hasta, jornada, lineas: lineas.rows, recursos: recursos.rows,
      tareas: tareas.rows, tramos: tramos.rows, conflictos });
  }));

  /* ---------- Crear tramo (soltar una tarea en el calendario) ---------- */
  // Sin duracion_h: ocupa lo pendiente hasta el fin de jornada; el resto queda pendiente.
  // Con recurso_id (soltada en la fila de un operario): se asigna ese recurso y no se heredan otros.
  app.post('/api/tareas/:id/tramos', auth.puedeEditar, asyncH(async (req, res) => {
    const tareaId = Number(req.params.id);
    const b = req.body || {};
    const fecha = leerFecha(b.fecha);
    const h = leerHora(b.hora_inicio);
    if (h >= 24) throw fallo(400, 'Hora no válida');

    const out = await tx(async (c) => {
      const t = await horasTarea(c, tareaId);
      if (t.pendientes <= 0) throw fallo(409, 'Esta tarea ya está planificada entera: estira uno de sus tramos o súbele las horas');
      let dur = b.duracion_h != null ? leerDuracion(b.duracion_h) : Math.min(t.pendientes, mediaHora(finDelDia(h) - h));
      if (dur <= 0) dur = Math.min(t.pendientes, 0.5);
      if (h + dur > 24) dur = mediaHora(24 - h);
      const linea = b.linea_id ? Number(b.linea_id) : t.linea_id;
      if (!linea) throw fallo(400, 'La tarea no tiene área por defecto: suéltala en la vista «Áreas» o asígnale un área en Proyectos y OTs');

      const { rows } = await c.query(
        `INSERT INTO tramos (tarea_id, fecha, hora_inicio, duracion_h, linea_id, actualizado_por)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tareaId, fecha, h, dur, linea, req.usuario.id]);
      const tramo = rows[0];

      if (b.recurso_id) {
        await c.query('INSERT INTO tramo_asignaciones (tramo_id, recurso_id, asignado_por) VALUES ($1,$2,$3)',
          [tramo.id, Number(b.recurso_id), req.usuario.id]);
      } else {
        // Continuidad: el tramo nuevo hereda los recursos del último tramo de la tarea
        await c.query(
          `INSERT INTO tramo_asignaciones (tramo_id, recurso_id, asignado_por)
           SELECT $1, a.recurso_id, $3 FROM tramo_asignaciones a
            WHERE a.tramo_id = (SELECT id FROM tramos WHERE tarea_id = $2 AND id <> $1
                                 ORDER BY fecha DESC, hora_inicio DESC, id DESC LIMIT 1)`,
          [tramo.id, tareaId, req.usuario.id]);
      }
      await registrar(c, req.usuario.id, tareaId, 'planificar', { tramo_id: tramo.id, fecha, hora_inicio: h, duracion_h: dur });
      return { tramo, pendientes: t.pendientes - dur };
    });
    res.status(201).json(out);
  }));

  /* ---------- Mover / cambiar horas de un tramo ---------- */
  // Las horas pueden superar la estimación de la tarea: queda registrado como exceso.
  app.patch('/api/tramos/:id', auth.puedeEditar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const cambios = {};
    if ('fecha' in b) cambios.fecha = leerFecha(b.fecha);
    if ('hora_inicio' in b) cambios.hora_inicio = leerHora(b.hora_inicio);
    if ('linea_id' in b) cambios.linea_id = b.linea_id ? Number(b.linea_id) : null;
    if ('duracion_h' in b) cambios.duracion_h = leerDuracion(b.duracion_h);
    if (!Object.keys(cambios).length) throw fallo(400, 'Nada que cambiar');

    const out = await tx(async (c) => {
      const { rows: prev } = await c.query('SELECT * FROM tramos WHERE id = $1 FOR UPDATE', [id]);
      if (!prev.length) throw fallo(404, 'Tramo no encontrado');
      const ini = cambios.hora_inicio ?? prev[0].hora_inicio;
      const dur = cambios.duracion_h ?? prev[0].duracion_h;
      if (ini + dur > 24) throw fallo(400, 'El tramo no puede pasar de medianoche');

      const cols = Object.keys(cambios);
      const { rows } = await c.query(
        `UPDATE tramos SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}, actualizado_por = $${cols.length + 2}
          WHERE id = $1 RETURNING *`, [id, ...cols.map((k) => cambios[k]), req.usuario.id]);

      // Al mover el tramo entero (sin cambiar sus horas) las franjas se desplazan con él;
      // al redimensionar, se quedan donde estaban y solo se recortan a los nuevos límites.
      const soloMover = 'hora_inicio' in cambios && !('duracion_h' in cambios);
      await ajustarFranjas(c, id, soloMover ? ini - prev[0].hora_inicio : 0);

      const t = await horasTarea(c, prev[0].tarea_id);
      await registrar(c, req.usuario.id, prev[0].tarea_id, 'mover', { tramo_id: id, ...cambios });
      return { ...rows[0], exceso: Math.max(0, r1(-t.pendientes)) };
    });
    res.json(out);
  }));

  /* ---------- Quitar un tramo (sus horas vuelven a pendientes) ---------- */
  app.delete('/api/tramos/:id', auth.puedeEditar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx(async (c) => {
      const { rows } = await c.query('DELETE FROM tramos WHERE id = $1 RETURNING tarea_id, fecha, duracion_h', [id]);
      if (!rows.length) throw fallo(404, 'Tramo no encontrado');
      await registrar(c, req.usuario.id, rows[0].tarea_id, 'desplanificar', { tramo_id: id, fecha: rows[0].fecha, duracion_h: rows[0].duracion_h });
    });
    res.json({ ok: true });
  }));

  /* ---------- Empujar lo siguiente (vista previa y aplicar) ---------- */
  app.post('/api/tramos/:id/empujar', auth.puedeEditar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const aplicar = !!req.body?.aplicar;

    const out = await tx(async (c) => {
      const { rows: b } = await c.query('SELECT fecha FROM tramos WHERE id = $1', [id]);
      if (!b.length) throw fallo(404, 'Tramo no encontrado');
      const { rows: dia } = await c.query(`${SQL_TRAMOS_DIA} WHERE tr.fecha = $1`, [b[0].fecha]);
      const { rows: nom } = await c.query(
        `SELECT t.id, o.codigo || ' ' || t.nombre AS n FROM tareas t JOIN ordenes o ON o.id = t.orden_id
          WHERE t.id IN (SELECT tarea_id FROM tramos WHERE fecha = $1)`, [b[0].fecha]);
      const base = dia.find((x) => x.id === id);
      const cambios = planEmpuje(base, dia, new Map(nom.map((r) => [r.id, r.n])));

      if (aplicar) {
        for (const x of cambios) {
          if (x.quitar) {
            await c.query('DELETE FROM tramos WHERE id = $1', [x.id]);
          } else {
            await c.query('UPDATE tramos SET hora_inicio = $2, duracion_h = $3, actualizado_por = $4 WHERE id = $1',
              [x.id, x.hora_inicio, x.duracion_h, req.usuario.id]);
            await ajustarFranjas(c, x.id, x.delta);
          }
          await registrar(c, req.usuario.id, x.tarea_id, 'empujar',
            { tramo_id: x.id, por_tramo: id, delta: x.delta, recorte: x.recorte, quitado: x.quitar });
        }
      }
      return { aplicado: aplicar, cambios };
    });
    res.json(out);
  }));

  /* ---------- Repartir lo pendiente en los días laborables siguientes ---------- */
  // Mismo área y mismos recursos que el tramo de referencia, una jornada por día (o horas_dia).
  app.post('/api/tramos/:id/repartir', auth.puedeEditar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const horasDia = req.body?.horas_dia != null ? leerDuracion(req.body.horas_dia) : jornada.horas;
    if (horasDia > jornada.vistaFin - jornada.inicio) throw fallo(400, 'Más horas por día de las que caben en el tablero');

    const out = await tx(async (c) => {
      const { rows: ref } = await c.query('SELECT * FROM tramos WHERE id = $1', [id]);
      if (!ref.length) throw fallo(404, 'Tramo no encontrado');
      const base = ref[0];
      const t = await horasTarea(c, base.tarea_id);
      if (t.pendientes <= 0) throw fallo(409, 'No quedan horas pendientes en esta tarea');

      const { rows: recursos } = await c.query('SELECT recurso_id FROM tramo_asignaciones WHERE tramo_id = $1', [id]);
      let pendientes = t.pendientes;
      const [y, m, d] = base.fecha.split('-').map(Number);
      const dia = new Date(Date.UTC(y, m - 1, d));
      const creados = [];
      while (pendientes > 0 && creados.length < 60) {
        dia.setUTCDate(dia.getUTCDate() + 1);
        const sem = dia.getUTCDay();
        if (sem === 0 || sem === 6) continue; // fin de semana
        const fecha = dia.toISOString().slice(0, 10);
        const dur = Math.min(pendientes, horasDia);
        const { rows } = await c.query(
          `INSERT INTO tramos (tarea_id, fecha, hora_inicio, duracion_h, linea_id, actualizado_por)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, fecha`,
          [base.tarea_id, fecha, jornada.inicio, dur, base.linea_id, req.usuario.id]);
        for (const r of recursos) {
          await c.query('INSERT INTO tramo_asignaciones (tramo_id, recurso_id, asignado_por) VALUES ($1,$2,$3)',
            [rows[0].id, r.recurso_id, req.usuario.id]);
        }
        creados.push(rows[0]);
        pendientes -= dur;
      }
      await registrar(c, req.usuario.id, base.tarea_id, 'repartir', { desde: base.fecha, tramos: creados.length, horas_dia: horasDia });
      return { creados: creados.length, hasta: creados.at(-1)?.fecha, pendientes };
    });
    res.status(201).json(out);
  }));

  /* ---------- Recursos de un tramo y su franja ---------- */
  async function leerFranja(c, tramoId, b) {
    const { rows } = await c.query('SELECT tarea_id, hora_inicio, duracion_h FROM tramos WHERE id = $1', [tramoId]);
    if (!rows.length) throw fallo(404, 'Tramo no encontrado');
    const t = rows[0];
    let desde = null, hasta = null;
    if (b.desde != null || b.hasta != null) {
      desde = b.desde != null ? leerHora(b.desde, 'Hora de inicio') : t.hora_inicio;
      hasta = b.hasta != null ? leerHora(b.hasta, 'Hora de fin') : t.hora_inicio + t.duracion_h;
      if (desde < t.hora_inicio || hasta > t.hora_inicio + t.duracion_h) {
        throw fallo(400, `La franja debe estar dentro del tramo (${hhmm(t.hora_inicio)}–${hhmm(t.hora_inicio + t.duracion_h)}). Para más horas, estira el tramo.`);
      }
      if (hasta - desde < 0.5) throw fallo(400, 'La franja debe ser de al menos media hora');
      if (desde === t.hora_inicio && hasta === t.hora_inicio + t.duracion_h) { desde = null; hasta = null; }
    }
    return { tarea_id: t.tarea_id, desde, hasta };
  }

  app.post('/api/tramos/:id/asignaciones', auth.puedeEditar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const recursoId = Number(req.body?.recurso_id);
    await tx(async (c) => {
      const f = await leerFranja(c, id, req.body || {});
      await c.query(
        `INSERT INTO tramo_asignaciones (tramo_id, recurso_id, asignado_por, desde, hasta) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT DO NOTHING`, [id, recursoId, req.usuario.id, f.desde, f.hasta]);
      await registrar(c, req.usuario.id, f.tarea_id, 'asignar', { tramo_id: id, recurso_id: recursoId, desde: f.desde, hasta: f.hasta });
    });
    res.status(201).json({ ok: true });
  }));

  // Cambiar la franja de un recurso ({desde, hasta}) o pasarla a otro recurso ({recurso_id})
  app.patch('/api/tramos/:id/asignaciones/:recursoId', auth.puedeEditar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const recursoId = Number(req.params.recursoId);
    const b = req.body || {};
    await tx(async (c) => {
      const { rows: prev } = await c.query('SELECT * FROM tramo_asignaciones WHERE tramo_id = $1 AND recurso_id = $2 FOR UPDATE', [id, recursoId]);
      if (!prev.length) throw fallo(404, 'Ese recurso no está en el tramo');
      const tieneFranja = 'desde' in b || 'hasta' in b;
      const f = tieneFranja ? await leerFranja(c, id, b)
        : { desde: prev[0].desde, hasta: prev[0].hasta, tarea_id: (await c.query('SELECT tarea_id FROM tramos WHERE id = $1', [id])).rows[0].tarea_id };
      const nuevo = b.recurso_id ? Number(b.recurso_id) : recursoId;
      if (nuevo !== recursoId) {
        const { rows: ya } = await c.query('SELECT 1 FROM tramo_asignaciones WHERE tramo_id = $1 AND recurso_id = $2', [id, nuevo]);
        if (ya.length) throw fallo(409, 'Ese recurso ya está en este tramo');
      }
      await c.query(
        `UPDATE tramo_asignaciones SET recurso_id = $3, desde = $4, hasta = $5, asignado_por = $6
          WHERE tramo_id = $1 AND recurso_id = $2`, [id, recursoId, nuevo, f.desde, f.hasta, req.usuario.id]);
      await registrar(c, req.usuario.id, f.tarea_id, nuevo !== recursoId ? 'reasignar' : 'franja',
        { tramo_id: id, recurso_id: recursoId, nuevo_recurso_id: nuevo, desde: f.desde, hasta: f.hasta });
    });
    res.json({ ok: true });
  }));

  app.delete('/api/tramos/:id/asignaciones/:recursoId', auth.puedeEditar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const recursoId = Number(req.params.recursoId);
    await tx(async (c) => {
      const { rows } = await c.query('SELECT tarea_id FROM tramos WHERE id = $1', [id]);
      if (!rows.length) throw fallo(404, 'Tramo no encontrado');
      await c.query('DELETE FROM tramo_asignaciones WHERE tramo_id = $1 AND recurso_id = $2', [id, recursoId]);
      await registrar(c, req.usuario.id, rows[0].tarea_id, 'quitar', { tramo_id: id, recurso_id: recursoId });
    });
    res.json({ ok: true });
  }));
};

module.exports.planEmpuje = planEmpuje;
