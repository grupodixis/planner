// «Mi día»: cada operario apunta lo que hizo (✓ hecho / ◐ en parte / ✗ no) y si la tarea quedó terminada.
// Lo apuntado son DECLARACIONES: no cuentan hasta que el encargado las confirma en el parte del día.
//  · Solo su propio día, hoy o ayer, mientras el parte de ese día esté abierto.
//  · Un tramo ya cerrado por el encargado no se puede cambiar.
//  · Para el parte: propuesta de cierre de cada tramo a partir de lo declarado, con avisos.
const { query, tx } = require('./db');
const auth = require('./auth');
const { MOTIVOS, NO_PRODUCTIVO } = require('./partes');
const notif = require('./notificaciones');

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const r2 = (x) => Math.round(x * 100) / 100;
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function leerHora(v, campo) {
  const h = Number(v);
  if (!Number.isFinite(h) || h < 0 || h > 24 || (h * 4) % 1 !== 0) throw fallo(400, `${campo} no válida`);
  return h;
}

// ¿Puede el operario tocar ese día?
async function editable(c, fecha) {
  const hoy = hoyMadrid();
  if (fecha > hoy) return { ok: false, motivo: 'Día por venir: es lo que tienes planificado (puede cambiar).' };
  if (fecha !== hoy && fecha !== sumarDias(hoy, -1)) return { ok: false, motivo: 'Solo puedes apuntar hoy y ayer' };
  const { rows } = await c.query('SELECT 1 FROM dias_cerrados WHERE fecha = $1', [fecha]);
  if (rows.length) return { ok: false, motivo: 'El encargado ya cerró el parte de este día' };
  return { ok: true };
}

function recursoDe(req) {
  if (!req.usuario.recurso_id) throw fallo(400, 'Tu usuario no está ligado a ninguna ficha de operario');
  return req.usuario.recurso_id;
}

/* ---------- Propuesta de cierre a partir de lo declarado (para el parte) ---------- */
// tr: tramo con asignados [{id, nombre, tipo, desde, hasta}] y despues [...]; decl: declaraciones del tramo
function propuesta(tr, decl) {
  const ops = tr.asignados.filter((a) => a.tipo === 'operario');
  const porRec = new Map(decl.map((d) => [d.recurso_id, d]));
  if (!decl.length) return null;
  const avisos = [];
  const sinDeclarar = ops.filter((a) => !porRec.has(a.id));
  if (sinDeclarar.length) avisos.push(`Sin apuntar: ${sinDeclarar.map((a) => a.nombre).join(', ')} (se toma lo planificado)`);

  const declarados = ops.filter((a) => porRec.has(a.id));
  const todosNo = declarados.length && declarados.every((a) => porRec.get(a.id).estado === 'no') && !sinDeclarar.length;
  const notas = decl.map((d) => d.notas && `${d.recurso}: ${d.notas}`).filter(Boolean).join(' · ') || null;
  if (todosNo) {
    const motivo = decl.find((d) => d.motivo)?.motivo || 'otro';
    return { accion: 'no_hecho', motivo, notas, avisos, terminada: false };
  }
  const registros = [];
  let cambia = false;
  for (const a of tr.asignados) {
    const d = porRec.get(a.id);
    if (a.tipo !== 'operario' || !d || d.estado === 'hecho') { registros.push({ recurso_id: a.id, desde: a.desde, hasta: a.hasta }); continue; }
    cambia = true;
    if (d.estado === 'parcial') registros.push({ recurso_id: a.id, desde: d.desde, hasta: d.hasta });
    // «no» → no se le apuntan horas en este tramo
  }
  for (const d of decl) {
    if (d.estado === 'parcial') avisos.push(`${d.recurso}: ${hh(d.desde)}–${hh(d.hasta)} en vez de ${hh(planDe(tr, d.recurso_id).desde)}–${hh(planDe(tr, d.recurso_id).hasta)}`);
    if (d.estado === 'no') avisos.push(`${d.recurso}: no lo hizo (${MOTIVOS[d.motivo] || d.motivo || 'sin motivo'})`);
  }
  // ¿terminada? Solo si todos los que lo dicen están de acuerdo
  const opinan = decl.filter((d) => d.estado !== 'no' && d.terminada != null);
  const si = opinan.filter((d) => d.terminada).length, no = opinan.length - si;
  let terminada = false;
  if (si && no) avisos.push(`No están de acuerdo en si la tarea quedó terminada (${si} sí, ${no} no): decide tú`);
  else if (si) {
    terminada = true;
    if (tr.despues?.length) avisos.push(`Dicen que la tarea quedó terminada y aún tenía ${tr.despues.length} tramo(s) planificado(s) después`);
  }
  const motivo = cambia ? decl.find((d) => d.motivo)?.motivo || null : null;
  return { accion: cambia ? 'corregido' : 'hecho', registros: cambia ? registros : undefined, motivo, notas, avisos, terminada, desacuerdo: !!(si && no) };
}
const hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const planDe = (tr, recursoId) => tr.asignados.find((a) => a.id === recursoId) || { desde: tr.hora_inicio, hasta: tr.hora_inicio + tr.duracion_h };

// Declaraciones de un día (para el parte)
async function delDia(fecha) {
  const [{ rows: decl }, { rows: enviados }, { rows: conPin }] = await Promise.all([
    query(`SELECT d.*, d.desde::float AS desde, d.hasta::float AS hasta, r.nombre AS recurso, t.nombre AS tarea, o.codigo AS orden_codigo
             FROM declaraciones d JOIN recursos r ON r.id = d.recurso_id
             LEFT JOIN tareas t ON t.id = d.tarea_id LEFT JOIN ordenes o ON o.id = t.orden_id
            WHERE d.fecha = $1 ORDER BY r.nombre, d.desde NULLS LAST`, [fecha]),
    query(`SELECT e.recurso_id, e.enviado_en FROM dias_enviados e WHERE e.fecha = $1`, [fecha]),
    query(`SELECT u.recurso_id FROM usuarios u WHERE u.pin_hash IS NOT NULL AND u.activo`),
  ]);
  return { decl, enviados, conPin: new Set(conPin.map((x) => x.recurso_id)) };
}

// Marca como resueltas las declaraciones de un tramo (al cerrarlo el encargado, como sea)
async function resolverTramo(c, tramoId, usuarioId) {
  await c.query(`UPDATE declaraciones SET resuelto = 'confirmado', resuelto_en = now(), resuelto_por = $2
                  WHERE tramo_id = $1 AND resuelto IS NULL`, [tramoId, usuarioId]);
}
async function reabrirTramo(c, tramoId) {
  await c.query(`UPDATE declaraciones SET resuelto = NULL, resuelto_en = NULL, resuelto_por = NULL WHERE tramo_id = $1`, [tramoId]);
}

// Datos de «Mi perfil». «importante»: si falta, se le recuerda en el menú
const CAMPOS_PERFIL = [
  { k: 'telefono', e: 'Teléfono', tipo: 'tel', importante: true, max: 40 },
  { k: 'email', e: 'Email', tipo: 'email', max: 120 },
  { k: 'dni', e: 'DNI / NIE', importante: true, max: 20 },
  { k: 'nacimiento', e: 'Fecha de nacimiento', tipo: 'date' },
  { k: 'direccion', e: 'Dirección', importante: true, max: 200 },
  { k: 'cp', e: 'Código postal', max: 10 },
  { k: 'localidad', e: 'Localidad', importante: true, max: 80 },
  { k: 'nss', e: 'Nº de la Seguridad Social', max: 20 },
  { k: 'emergencia_nombre', e: 'Contacto de emergencia (nombre)', importante: true, max: 120 },
  { k: 'emergencia_tel', e: 'Contacto de emergencia (teléfono)', tipo: 'tel', importante: true, max: 40 },
  { k: 'carnet', e: 'Carnet de conducir (B, C…)', max: 40 },
  { k: 'talla_ropa', e: 'Talla de ropa', max: 10 },
  { k: 'talla_calzado', e: 'Talla de calzado', max: 10 },
];

function montar(app, asyncH) {
  const soloSuyo = auth.permiso('mi_dia');

  /* ---------- Lo del operario ---------- */
  app.get('/api/mi-dia', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const hoy = hoyMadrid();
    const fecha = FECHA_RE.test(req.query.fecha || '') ? req.query.fecha : hoy;
    const ed = await editable({ query }, fecha);
    const [{ rows: rec }, { rows: tramos }, { rows: extra }, { rows: env }, { rows: manana }, { rows: tareas }, { rows: aus }] = await Promise.all([
      query('SELECT id, nombre FROM recursos WHERE id = $1', [recursoId]),
      query(`SELECT x.id, x.tarea_id, x.linea_id, x.hora_inicio::float AS hora_inicio, x.duracion_h::float AS duracion_h, x.cierre,
                    COALESCE(a.desde, x.hora_inicio)::float AS desde, COALESCE(a.hasta, x.hora_inicio + x.duracion_h)::float AS hasta,
                    l.nombre AS area, t.nombre AS tarea, t.estado AS tarea_estado, t.notas AS tarea_notas,
                    o.codigo AS orden_codigo, o.titulo AS orden_titulo, o.color, p.nombre AS proyecto, p.obra,
                    COALESCE((SELECT json_agg(r2.nombre ORDER BY r2.nombre) FROM tramo_asignaciones a2 JOIN recursos r2 ON r2.id = a2.recurso_id
                               WHERE a2.tramo_id = x.id AND r2.tipo = 'operario' AND r2.id <> $2), '[]') AS companeros,
                    COALESCE((SELECT json_agg(r2.nombre ORDER BY r2.nombre) FROM tramo_asignaciones a2 JOIN recursos r2 ON r2.id = a2.recurso_id
                               WHERE a2.tramo_id = x.id AND r2.tipo <> 'operario'), '[]') AS equipos,
                    COALESCE((SELECT json_agg(json_build_object('id', r2.id, 'nombre', r2.nombre,
                               'mio', EXISTS (SELECT 1 FROM equipo_check q WHERE q.recurso_id = $2 AND q.tramo_id = x.id AND q.maquina_id = r2.id))
                               ORDER BY r2.nombre)
                               FROM tramo_asignaciones a2 JOIN recursos r2 ON r2.id = a2.recurso_id
                              WHERE a2.tramo_id = x.id AND r2.tipo = 'maquina' AND NOT (r2.fijo_area AND r2.linea_id IS NOT DISTINCT FROM x.linea_id)), '[]') AS maquinas,
                    COALESCE(l.equipamiento, '{}') AS area_equipamiento,
                    COALESCE((SELECT json_agg(r3.nombre ORDER BY r3.nombre) FROM recursos r3
                               WHERE r3.linea_id = x.linea_id AND r3.fijo_area AND r3.activo), '[]') AS area_maquinas,
                    (SELECT row_to_json(d) FROM (SELECT estado, desde::float, hasta::float, terminada, motivo, notas, resuelto
                       FROM declaraciones WHERE tramo_id = x.id AND recurso_id = $2) d) AS declaracion
               FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $2
               JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id
               LEFT JOIN proyectos p ON p.id = o.proyecto_id LEFT JOIN lineas l ON l.id = x.linea_id
              WHERE x.fecha = $1 ORDER BY desde, x.id`, [fecha, recursoId]),
      query(`SELECT d.id, d.tipo, d.tarea_id, d.desde::float AS desde, d.hasta::float AS hasta, d.motivo, d.notas, d.resuelto,
                    t.nombre AS tarea, o.codigo AS orden_codigo
               FROM declaraciones d LEFT JOIN tareas t ON t.id = d.tarea_id LEFT JOIN ordenes o ON o.id = t.orden_id
              WHERE d.fecha = $1 AND d.recurso_id = $2 AND d.tipo <> 'tramo' ORDER BY d.desde`, [fecha, recursoId]),
      query('SELECT enviado_en FROM dias_enviados WHERE fecha = $1 AND recurso_id = $2', [fecha, recursoId]),
      // lo siguiente que tiene planificado (próximo día con algo, en la próxima semana)
      query(`SELECT x.fecha, COALESCE(a.desde, x.hora_inicio)::float AS desde, t.nombre AS tarea, o.codigo AS orden_codigo, l.nombre AS area
               FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $2
               JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id LEFT JOIN lineas l ON l.id = x.linea_id
              WHERE x.fecha = (SELECT min(y.fecha) FROM tramos y JOIN tramo_asignaciones b ON b.tramo_id = y.id AND b.recurso_id = $2
                                WHERE y.fecha > $1 AND y.fecha <= $1::date + 7)
              ORDER BY desde`, [fecha, recursoId]),
      // tareas en las que puede apuntar horas fuera del plan: las de OTs abiertas sin terminar
      query(`SELECT t.id, t.nombre, o.codigo AS orden_codigo, o.titulo AS orden_titulo,
                    EXISTS (SELECT 1 FROM tramos y JOIN tramo_asignaciones b ON b.tramo_id = y.id AND b.recurso_id = $1
                             WHERE y.tarea_id = t.id AND y.fecha BETWEEN CURRENT_DATE - 14 AND CURRENT_DATE + 14) AS mias
               FROM tareas t JOIN ordenes o ON o.id = t.orden_id
              WHERE o.estado = 'abierta' AND t.estado <> 'hecha'
              ORDER BY o.codigo, t.orden_en_of, t.id`, [recursoId]),
      query(`SELECT tipo FROM ausencias WHERE recurso_id = $1 AND $2 BETWEEN desde AND hasta AND hora_desde IS NULL`, [recursoId, fecha]),
    ]);
    // lo que necesita para cada trabajo: materiales y herramientas asignados a la tarea
    const llevar = await require('./material').deTareas(tramos.map((x) => x.tarea_id), recursoId);
    for (const x of tramos) x.llevar = llevar.get(x.tarea_id) || null;
    res.json({
      fecha, hoy, editable: ed.ok, no_editable: ed.ok ? null : ed.motivo,
      recurso: rec[0], comun: req.usuario.via === 'pin_comun',
      tramos, extra, enviado: env[0]?.enviado_en || null, manana, tareas, ausente: aus[0]?.tipo || null,
      motivos: MOTIVOS, no_productivo: NO_PRODUCTIVO,
    });
  }));

  /* ---------- Mi perfil: datos personales (los rellena el propio operario) ---------- */
  app.get('/api/mi-dia/perfil', soloSuyo, asyncH(async (req, res) => {
    const { rows } = await query('SELECT id, nombre, telefono, email, perfil FROM recursos WHERE id = $1', [recursoDe(req)]);
    if (!rows.length) throw fallo(404, 'No encuentro tu ficha');
    const r = rows[0];
    const datos = { ...r.perfil, telefono: r.telefono || '', email: r.email || '' };
    const faltan = CAMPOS_PERFIL.filter((c) => c.importante && !String(datos[c.k] || '').trim()).map((c) => c.e);
    res.json({ nombre: r.nombre, campos: CAMPOS_PERFIL, datos, faltan });
  }));

  app.put('/api/mi-dia/perfil', soloSuyo, asyncH(async (req, res) => {
    const id = recursoDe(req);
    const b = req.body || {};
    const { rows } = await query('SELECT perfil FROM recursos WHERE id = $1', [id]);
    if (!rows.length) throw fallo(404, 'No encuentro tu ficha');
    const perfil = { ...rows[0].perfil };
    for (const c of CAMPOS_PERFIL) {
      if (!(c.k in b) || c.k === 'telefono' || c.k === 'email') continue;
      const v = String(b[c.k] ?? '').trim().slice(0, c.max || 120);
      if (c.tipo === 'date' && v && !FECHA_RE.test(v)) throw fallo(400, `${c.e}: fecha no válida`);
      if (v) perfil[c.k] = v; else delete perfil[c.k];
    }
    const tel = 'telefono' in b ? String(b.telefono || '').trim().slice(0, 40) || null : undefined;
    const mail = 'email' in b ? String(b.email || '').trim().slice(0, 120) || null : undefined;
    if (mail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw fallo(400, 'El email no parece válido');
    await query(`UPDATE recursos SET perfil = $2${tel !== undefined ? ', telefono = $3' : ''}${mail !== undefined ? `, email = $${tel !== undefined ? 4 : 3}` : ''} WHERE id = $1`,
      [id, perfil, ...(tel !== undefined ? [tel] : []), ...(mail !== undefined ? [mail] : [])]);
    res.json({ ok: true });
  }));

  /* ---------- Mis capacidades: lo que dice que sabe hacer; el supervisor lo valida ---------- */
  app.get('/api/mi-dia/capacidades', soloSuyo, asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT k.id, k.familia, k.nombre, rc.estado
         FROM capacidades k LEFT JOIN recurso_capacidades rc ON rc.capacidad_id = k.id AND rc.recurso_id = $1
        ORDER BY k.orden, lower(k.nombre)`, [recursoDe(req)]);
    res.json(rows);
  }));

  app.put('/api/mi-dia/capacidades/:id', soloSuyo, asyncH(async (req, res) => {
    const id = recursoDe(req);
    const capId = Number(req.params.id);
    const { rows: ya } = await query('SELECT estado FROM recurso_capacidades WHERE recurso_id = $1 AND capacidad_id = $2', [id, capId]);
    if (req.body?.sabe) {
      if (ya.length) return res.json({ ok: true, estado: ya[0].estado });
      const { rowCount } = await query(
        `INSERT INTO recurso_capacidades (recurso_id, capacidad_id, estado, propuesta_en)
         SELECT $1, id, 'propuesta', now() FROM capacidades WHERE id = $2 ON CONFLICT DO NOTHING`, [id, capId]);
      if (!rowCount) throw fallo(404, 'Esa capacidad ya no existe');
      // a quien valida (permiso «recursos»), agrupado por persona
      const { rows: q } = await query(
        `SELECT r.nombre, count(*)::int AS n FROM recurso_capacidades rc JOIN recursos r ON r.id = rc.recurso_id
          WHERE rc.recurso_id = $1 AND rc.estado = 'propuesta' GROUP BY r.nombre`, [id]);
      notif.avisarLuego(notif.conPermiso('recursos'), 'cap_propuesta', {
        titulo: `${q[0]?.nombre || 'Un operario'}: ${q[0]?.n || 1} capacidad(es) por validar`,
        cuerpo: 'Dice que sabe hacerlo. Revísalo en Capacidades.', url: `/capacidades.html?persona=${id}`, tag: `cap-${id}`,
      });
      return res.json({ ok: true, estado: 'propuesta' });
    }
    if (ya[0]?.estado === 'validada') throw fallo(409, 'Esta ya la validó tu encargado: para quitarla, díselo a él');
    await query(`DELETE FROM recurso_capacidades WHERE recurso_id = $1 AND capacidad_id = $2 AND estado = 'propuesta'`, [id, capId]);
    res.json({ ok: true, estado: null });
  }));

  // Marcar / desmarcar: material recibido o herramienta preparada (de una tarea suya)
  app.put('/api/mi-dia/llevar', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const b = req.body || {};
    const id = Number(b.id);
    // equipo (máquina) asignado a uno de sus tramos: { tipo: 'equipo', tramo_id, id }
    if (b.tipo === 'equipo') {
      const tramoId = Number(b.tramo_id);
      const { rows: ok } = await query(
        `SELECT 1 FROM tramo_asignaciones a JOIN tramo_asignaciones m ON m.tramo_id = a.tramo_id AND m.recurso_id = $3
          WHERE a.tramo_id = $1 AND a.recurso_id = $2`, [tramoId, recursoId, id]);
      if (!ok.length) throw fallo(404, 'Ese equipo no está en un trabajo tuyo');
      if (b.hecho) await query('INSERT INTO equipo_check (recurso_id, tramo_id, maquina_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [recursoId, tramoId, id]);
      else await query('DELETE FROM equipo_check WHERE recurso_id = $1 AND tramo_id = $2 AND maquina_id = $3', [recursoId, tramoId, id]);
      return res.json({ ok: true });
    }
    const tipo = b.tipo === 'herramienta' ? 'herramienta' : b.tipo === 'material' ? 'material' : null;
    if (!tipo || !id) throw fallo(400, 'Falta qué marcar');
    const { rows } = await query(
      `SELECT 1 FROM ${tipo === 'material' ? 'tarea_material' : 'tarea_herramienta'} i
         JOIN tramos x ON x.tarea_id = i.tarea_id JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $2
        WHERE i.id = $1 LIMIT 1`, [id, recursoId]);
    if (!rows.length) throw fallo(404, 'Eso no es de un trabajo tuyo');
    if (b.hecho) {
      await query(`INSERT INTO llevar_check (recurso_id, tipo, item_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [recursoId, tipo, id]);
    } else {
      await query('DELETE FROM llevar_check WHERE recurso_id = $1 AND tipo = $2 AND item_id = $3', [recursoId, tipo, id]);
    }
    res.json({ ok: true });
  }));

  // Lo que pasó en uno de sus tramos: { estado: hecho|parcial|no, desde?, hasta?, terminada?, motivo?, notas? }
  app.put('/api/mi-dia/tramos/:id', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const id = Number(req.params.id);
    const b = req.body || {};
    if (!['hecho', 'parcial', 'no'].includes(b.estado)) throw fallo(400, 'Di si lo hiciste, en parte o no');
    await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT x.fecha, x.cierre, x.tarea_id, COALESCE(a.desde, x.hora_inicio)::float AS desde, COALESCE(a.hasta, x.hora_inicio + x.duracion_h)::float AS hasta
           FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $2 WHERE x.id = $1`, [id, recursoId]);
      if (!rows.length) throw fallo(404, 'Ese trabajo no está en tu día');
      const tr = rows[0];
      const ed = await editable(c, tr.fecha);
      if (!ed.ok) throw fallo(409, ed.motivo);
      if (tr.cierre) throw fallo(409, 'El encargado ya lo ha confirmado');
      let desde = tr.desde, hasta = tr.hasta;
      if (b.estado === 'parcial') {
        desde = leerHora(b.desde, 'Hora de inicio'); hasta = leerHora(b.hasta, 'Hora de fin');
        if (hasta <= desde) throw fallo(400, 'La hora de fin debe ser posterior a la de inicio');
      }
      if (b.estado === 'no' && !MOTIVOS[b.motivo]) throw fallo(400, 'Di por qué no se hizo');
      if (b.motivo && !MOTIVOS[b.motivo]) throw fallo(400, 'Motivo no válido');
      const terminada = b.estado === 'no' ? null : b.terminada == null ? null : !!b.terminada;
      await c.query(
        `INSERT INTO declaraciones (fecha, recurso_id, tipo, tramo_id, tarea_id, estado, desde, hasta, terminada, motivo, notas, usuario_id)
         VALUES ($1,$2,'tramo',$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (tramo_id, recurso_id) WHERE tramo_id IS NOT NULL DO UPDATE SET
           estado = EXCLUDED.estado, desde = EXCLUDED.desde, hasta = EXCLUDED.hasta, terminada = EXCLUDED.terminada,
           motivo = EXCLUDED.motivo, notas = EXCLUDED.notas, usuario_id = EXCLUDED.usuario_id, actualizado = now(),
           resuelto = NULL, resuelto_en = NULL, resuelto_por = NULL`,
        [tr.fecha, recursoId, id, tr.tarea_id, b.estado, b.estado === 'no' ? null : desde, b.estado === 'no' ? null : hasta, terminada,
          b.motivo || null, String(b.notas || '').trim().slice(0, 500) || null, req.usuario.id]);
    });
    res.json({ ok: true });
  }));

  app.delete('/api/mi-dia/tramos/:id', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const id = Number(req.params.id);
    const { rows } = await query(`SELECT d.fecha, x.cierre FROM declaraciones d JOIN tramos x ON x.id = d.tramo_id
                                   WHERE d.tramo_id = $1 AND d.recurso_id = $2`, [id, recursoId]);
    if (!rows.length) return res.json({ ok: true });
    const ed = await editable({ query }, rows[0].fecha);
    if (!ed.ok) throw fallo(409, ed.motivo);
    if (rows[0].cierre) throw fallo(409, 'El encargado ya lo ha confirmado');
    await query('DELETE FROM declaraciones WHERE tramo_id = $1 AND recurso_id = $2', [id, recursoId]);
    res.json({ ok: true });
  }));

  // Trabajo no planificado: { fecha, tipo: productivo|no_productivo, tarea_id?, motivo?, desde, hasta, notas? }
  app.post('/api/mi-dia/extra', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const b = req.body || {};
    const fecha = FECHA_RE.test(b.fecha || '') ? b.fecha : null;
    if (!fecha) throw fallo(400, 'Fecha no válida');
    const ed = await editable({ query }, fecha);
    if (!ed.ok) throw fallo(409, ed.motivo);
    const tipo = b.tipo === 'no_productivo' ? 'no_productivo' : 'productivo';
    const desde = leerHora(b.desde, 'Hora de inicio'), hasta = leerHora(b.hasta, 'Hora de fin');
    if (hasta <= desde) throw fallo(400, 'La hora de fin debe ser posterior a la de inicio');
    if (tipo === 'productivo') {
      const { rows } = await query(`SELECT 1 FROM tareas t JOIN ordenes o ON o.id = t.orden_id WHERE t.id = $1 AND o.estado = 'abierta'`, [Number(b.tarea_id)]);
      if (!rows.length) throw fallo(400, 'Elige la tarea en la que trabajaste');
    } else if (!NO_PRODUCTIVO[b.motivo]) throw fallo(400, 'Elige qué hiciste (desplazamiento, espera…)');
    const { rows } = await query(
      `INSERT INTO declaraciones (fecha, recurso_id, tipo, tarea_id, desde, hasta, motivo, notas, usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [fecha, recursoId, tipo, tipo === 'productivo' ? Number(b.tarea_id) : null, desde, hasta,
        tipo === 'no_productivo' ? b.motivo : null, String(b.notas || '').trim().slice(0, 500) || null, req.usuario.id]);
    res.status(201).json({ id: rows[0].id });
  }));

  app.delete('/api/mi-dia/extra/:id', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const { rows } = await query(`SELECT fecha, resuelto FROM declaraciones WHERE id = $1 AND recurso_id = $2 AND tipo <> 'tramo'`,
      [Number(req.params.id), recursoId]);
    if (!rows.length) return res.json({ ok: true });
    if (rows[0].resuelto) throw fallo(409, 'El encargado ya lo ha revisado');
    const ed = await editable({ query }, rows[0].fecha);
    if (!ed.ok) throw fallo(409, ed.motivo);
    await query('DELETE FROM declaraciones WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // «Enviar mi día»: avisa al encargado de que ya está todo apuntado (se puede seguir cambiando)
  app.post('/api/mi-dia/enviar', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const fecha = FECHA_RE.test(req.body?.fecha || '') ? req.body.fecha : null;
    if (!fecha) throw fallo(400, 'Fecha no válida');
    const ed = await editable({ query }, fecha);
    if (!ed.ok) throw fallo(409, ed.motivo);
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $2
        WHERE x.fecha = $1 AND x.cierre IS NULL
          AND NOT EXISTS (SELECT 1 FROM declaraciones d WHERE d.tramo_id = x.id AND d.recurso_id = $2)`, [fecha, recursoId]);
    if (rows[0].n) throw fallo(400, `Te falta apuntar ${rows[0].n} trabajo(s)`);
    await query(`INSERT INTO dias_enviados (fecha, recurso_id, usuario_id) VALUES ($1,$2,$3)
                 ON CONFLICT (fecha, recurso_id) DO UPDATE SET enviado_en = now(), usuario_id = EXCLUDED.usuario_id`,
      [fecha, recursoId, req.usuario.id]);
    res.json({ ok: true });
  }));

  /* ---------- Lo del encargado (parte del día) ---------- */
  const encargado = auth.permiso('planificar');

  // Aceptar horas fuera del plan declaradas: se convierten en registro
  app.post('/api/declaraciones/:id/aceptar', encargado, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const out = await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM declaraciones WHERE id = $1 AND tipo <> 'tramo' FOR UPDATE`, [id]);
      if (!rows.length) throw fallo(404, 'No encontrado');
      const d = rows[0];
      if (d.resuelto) throw fallo(409, 'Ya está revisado');
      const { rows: cerr } = await c.query('SELECT 1 FROM dias_cerrados WHERE fecha = $1', [d.fecha]);
      if (cerr.length) throw fallo(409, 'El parte de ese día está cerrado: reábrelo');
      const { rows: rc } = await c.query('SELECT coste_hora FROM recursos WHERE id = $1', [d.recurso_id]);
      const horas = r2(Number(d.hasta) - Number(d.desde));
      const { rows: g } = await c.query(
        `INSERT INTO registros (fecha, recurso_id, tarea_id, desde, hasta, horas, tipo, motivo, notas, coste_hora, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [d.fecha, d.recurso_id, d.tarea_id, d.desde, d.hasta, horas, d.tipo, d.motivo, d.notas, rc[0]?.coste_hora ?? null, req.usuario.id]);
      if (d.tipo === 'productivo') await c.query(`UPDATE tareas SET estado = 'en_curso' WHERE id = $1 AND estado = 'pendiente'`, [d.tarea_id]);
      await c.query(`UPDATE declaraciones SET resuelto = 'confirmado', resuelto_en = now(), resuelto_por = $2, registro_id = $3 WHERE id = $1`,
        [id, req.usuario.id, g[0].id]);
      return { ok: true, registro_id: g[0].id };
    });
    res.json(out);
  }));

  app.post('/api/declaraciones/:id/descartar', encargado, asyncH(async (req, res) => {
    await query(`UPDATE declaraciones SET resuelto = 'descartado', resuelto_en = now(), resuelto_por = $2 WHERE id = $1 AND resuelto IS NULL`,
      [Number(req.params.id), req.usuario.id]);
    res.json({ ok: true });
  }));
}

module.exports = { montar, propuesta, delDia, resolverTramo, reabrirTramo };
