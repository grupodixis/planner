// Pantalla "Proyectos y OTs": alta y edición de proyectos, órdenes de trabajo y sus tareas.
const { query, tx } = require('./db');
const auth = require('./auth');

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLORES = ['#5aa9f0', '#e08a2a', '#4fb35f', '#b79cf2', '#e57ac4', '#6fcfc0', '#e0c341', '#f07070'];

const fallo = (status, msg) => Object.assign(new Error(msg), { status });

// [{id, cantidad}] → validado; null si no viene
function leerRequisitosTipo(v) {
  if (!Array.isArray(v)) return null;
  return v.map((q) => {
    const id = Number(typeof q === 'object' ? q.id : q);
    const cantidad = Number(typeof q === 'object' && q.cantidad != null ? q.cantidad : 1);
    if (!id) throw fallo(400, 'Tipo de recurso no válido');
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) throw fallo(400, 'Cantidad no válida (1–50)');
    return { id, cantidad };
  });
}

function texto(v, max, obligatorio, campo) {
  const s = String(v ?? '').trim();
  if (obligatorio && !s) throw fallo(400, `${campo} es obligatorio`);
  if (s.length > max) throw fallo(400, `${campo}: máximo ${max} caracteres`);
  return s || null;
}

// Construye "SET a = $2, b = $3" a partir de un objeto de cambios
function sets(obj) {
  const cols = Object.keys(obj);
  return { sql: cols.map((k, i) => `${k} = $${i + 2}`).join(', '), vals: cols.map((k) => obj[k]), n: cols.length };
}

async function siguienteCodigo(prefijo) {
  const { rows } = await query(
    `SELECT COALESCE(max(substring(codigo FROM '^${prefijo}-(\\d+)$')::int), 0) + 1 AS n
       FROM ${prefijo === 'OT' ? 'ordenes' : 'proyectos'}`);
  const ancho = prefijo === 'OT' ? 4 : 3;
  return `${prefijo}-${String(rows[0].n).padStart(ancho, '0')}`;
}

module.exports = function montar(app, asyncH) {
  /* ---------- Catálogo para formularios ---------- */
  app.get('/api/catalogo', asyncH(async (req, res) => {
    const [areas, recursos, tipos, departamentos] = await Promise.all([
      query(`SELECT l.id, l.nombre, l.tipo, l.proyecto_id, l.departamento_id, d.nombre AS departamento
               FROM lineas l LEFT JOIN proyectos p ON p.id = l.proyecto_id LEFT JOIN departamentos d ON d.id = l.departamento_id
              WHERE l.activo AND (l.tipo <> 'obra' OR p.estado = 'activo')
              ORDER BY (l.tipo = 'obra'), d.orden NULLS LAST, l.orden, l.nombre`),
      query('SELECT id, tipo, nombre FROM recursos WHERE activo ORDER BY tipo, nombre'),
      query(`SELECT t.id, t.clase, t.nombre,
                    (SELECT count(*)::int FROM recurso_tipos rt JOIN recursos r ON r.id = rt.recurso_id AND r.activo
                      WHERE rt.tipo_recurso_id = t.id) AS recursos
               FROM tipos_recurso t ORDER BY t.clase, lower(t.nombre)`),
      query('SELECT id, clave, nombre FROM departamentos ORDER BY orden, nombre'),
    ]);
    res.json({ areas: areas.rows, recursos: recursos.rows, tipos: tipos.rows, departamentos: departamentos.rows, colores: COLORES });
  }));

  /* ---------- Proyectos ---------- */
  function leerProyecto(b, parcial) {
    const p = {};
    if (!parcial || 'codigo' in b) p.codigo = texto(b.codigo, 30, false, 'Código');
    if (!parcial || 'nombre' in b) p.nombre = texto(b.nombre, 120, true, 'El nombre');
    for (const [k, max] of [['cliente', 120], ['obra', 200], ['notas', 2000]]) {
      if (!parcial || k in b) p[k] = texto(b[k], max, false, k);
    }
    if ('estado' in b) {
      if (!['activo', 'cerrado'].includes(b.estado)) throw fallo(400, 'Estado no válido');
      p.estado = b.estado;
    }
    return p;
  }

  app.get('/api/proyectos', asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT p.*,
              (SELECT count(*)::int FROM ordenes o WHERE o.proyecto_id = p.id) AS ots,
              (SELECT count(*)::int FROM ordenes o WHERE o.proyecto_id = p.id AND o.estado = 'abierta') AS ots_abiertas,
              COALESCE((SELECT json_agg(json_build_object('id', c.id, 'texto', c.texto, 'cumplida', c.cumplida,
                                                          'cumplida_en', c.cumplida_en, 'cumplida_por', u.nombre) ORDER BY c.orden, c.id)
                          FROM proyecto_condiciones c LEFT JOIN usuarios u ON u.id = c.cumplida_por
                         WHERE c.proyecto_id = p.id), '[]') AS condiciones,
              (SELECT json_build_object('creado', i.creado, 'usuario', u.nombre, 'origen', i.origen)
                 FROM importaciones i LEFT JOIN usuarios u ON u.id = i.usuario_id
                WHERE i.proyecto_id = p.id ORDER BY i.creado DESC LIMIT 1) AS ultima_importacion,
              COALESCE((SELECT json_agg(json_build_object('id', l.id, 'nombre', l.nombre, 'ubicacion', l.ubicacion, 'activo', l.activo,
                                                          'usos', (SELECT count(*) FROM tareas t WHERE t.linea_id = l.id)
                                                                + (SELECT count(*) FROM tramos x WHERE x.linea_id = l.id))
                                          ORDER BY l.id)
                          FROM lineas l WHERE l.proyecto_id = p.id AND l.tipo = 'obra'), '[]') AS obras
         FROM proyectos p
        ORDER BY (p.estado = 'activo') DESC, p.codigo DESC`);
    res.json(rows);
  }));

  app.post('/api/proyectos', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const p = leerProyecto(req.body || {}, false);
    p.codigo = p.codigo || await siguienteCodigo('PR');
    const { rows } = await query(
      `INSERT INTO proyectos (codigo, nombre, cliente, obra, notas) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [p.codigo, p.nombre, p.cliente, p.obra, p.notas]);
    await asegurarObra(rows[0]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/proyectos/:id', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const p = leerProyecto(req.body || {}, true);
    if ('codigo' in p && !p.codigo) throw fallo(400, 'El código no puede quedar vacío');
    const s = sets(p);
    if (!s.n) throw fallo(400, 'Nada que cambiar');
    const { rows } = await query(`UPDATE proyectos SET ${s.sql} WHERE id = $1 RETURNING *`, [Number(req.params.id), ...s.vals]);
    if (!rows.length) throw fallo(404, 'Proyecto no encontrado');
    if (p.obra) await asegurarObra(rows[0]);
    res.json(rows[0]);
  }));

  // Si el proyecto tiene dirección de obra y aún no tiene área de obra, se crea
  async function asegurarObra(p) {
    if (!p.obra) return;
    const { rows } = await query(`SELECT 1 FROM lineas WHERE proyecto_id = $1 AND tipo = 'obra'`, [p.id]);
    if (rows.length) return;
    await crearObra(p.id, nombreObra(p.obra), p.obra);
  }
  const nombreObra = (obra) => `Obra · ${String(obra).split(/[,(]/)[0].trim()}`.slice(0, 80);
  async function crearObra(proyectoId, nombre, ubicacion) {
    // si ya hay un área suelta con ese nombre (p. ej. de una importación anterior), se reutiliza
    const { rows: ya } = await query(
      `SELECT id FROM lineas WHERE lower(nombre) = lower($1) AND tipo = 'obra' AND (proyecto_id IS NULL OR proyecto_id = $2)`, [nombre, proyectoId]);
    if (ya.length) {
      const { rows } = await query(`UPDATE lineas SET proyecto_id = $2, activo = TRUE, ubicacion = COALESCE($3, ubicacion) WHERE id = $1 RETURNING *`,
        [ya[0].id, proyectoId, ubicacion || null]);
      return rows[0];
    }
    const { rows: [pr] } = await query('SELECT codigo FROM proyectos WHERE id = $1', [proyectoId]);
    const { rows: ocupado } = await query('SELECT 1 FROM lineas WHERE lower(nombre) = lower($1)', [nombre]);
    if (ocupado.length) nombre = `${nombre} (${pr?.codigo || proyectoId})`.slice(0, 80);
    const { rows } = await query(
      `INSERT INTO lineas (nombre, tipo, ubicacion, orden, proyecto_id)
       VALUES ($1, 'obra', $2, COALESCE((SELECT max(orden) FROM lineas), 0) + 1, $3) RETURNING *`,
      [nombre, ubicacion || null, proyectoId]);
    return rows[0];
  }

  // Añadir otra obra al proyecto (si trabaja en dos sitios)
  app.post('/api/proyectos/:id/obras', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: p } = await query('SELECT * FROM proyectos WHERE id = $1', [id]);
    if (!p.length) throw fallo(404, 'Proyecto no encontrado');
    const ubic = texto(req.body?.ubicacion, 200, false, 'La ubicación') || null;
    const nombre = texto(req.body?.nombre, 80, false, 'El nombre') || nombreObra(ubic || p[0].obra || p[0].nombre);
    res.status(201).json(await crearObra(id, nombre, ubic || (p[0].obra && !req.body?.nombre ? p[0].obra : null)));
  }));

  app.delete('/api/proyectos/:id', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT count(*)::int AS n FROM ordenes WHERE proyecto_id = $1', [id]);
    if (rows[0].n) throw fallo(409, 'El proyecto tiene OTs: ciérralo en lugar de borrarlo');
    // sus obras sin usar se borran; las usadas se quedan sin proyecto (fuera del tablero)
    await query(`DELETE FROM lineas l WHERE l.proyecto_id = $1 AND l.tipo = 'obra'
                   AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.linea_id = l.id)
                   AND NOT EXISTS (SELECT 1 FROM tramos x WHERE x.linea_id = l.id)`, [id]);
    await query('DELETE FROM proyectos WHERE id = $1', [id]);
    res.json({ ok: true });
  }));

  /* ---------- Condiciones previas del proyecto (pago, RAL, pilares…) ---------- */
  app.post('/api/proyectos/:id/condiciones', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const textoC = texto(req.body?.texto, 200, true, 'El texto');
    const { rows } = await query(
      `INSERT INTO proyecto_condiciones (proyecto_id, texto, orden)
       VALUES ($1, $2, COALESCE((SELECT max(orden) FROM proyecto_condiciones WHERE proyecto_id = $1), 0) + 1) RETURNING *`,
      [Number(req.params.id), textoC]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/condiciones/:id', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const b = req.body || {};
    const id = Number(req.params.id);
    if ('texto' in b) await query('UPDATE proyecto_condiciones SET texto = $2 WHERE id = $1', [id, texto(b.texto, 200, true, 'El texto')]);
    if ('cumplida' in b) {
      await query(`UPDATE proyecto_condiciones SET cumplida = $2, cumplida_por = CASE WHEN $2 THEN $3::int END,
                          cumplida_en = CASE WHEN $2 THEN now() END WHERE id = $1`, [id, !!b.cumplida, req.usuario.id]);
    }
    const { rows } = await query('SELECT * FROM proyecto_condiciones WHERE id = $1', [id]);
    if (!rows.length) throw fallo(404, 'Condición no encontrada');
    res.json(rows[0]);
  }));

  app.delete('/api/condiciones/:id', auth.permiso('proyectos'), asyncH(async (req, res) => {
    await query('DELETE FROM proyecto_condiciones WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  /* ---------- Partidas (nivel entre proyecto y OT) ---------- */
  app.get('/api/partidas', asyncH(async (req, res) => {
    const proyecto = Number(req.query.proyecto_id);
    if (!proyecto) throw fallo(400, 'Falta proyecto_id');
    const { rows } = await query(
      `SELECT pa.*,
              (SELECT count(*)::int FROM ordenes o WHERE o.partida_id = pa.id) AS ots,
              (SELECT COALESCE(sum(t.duracion_h), 0)::float FROM ordenes o JOIN tareas t ON t.orden_id = o.id
                WHERE o.partida_id = pa.id) AS horas,
              (SELECT COALESCE(sum(x.duracion_h), 0)::float FROM ordenes o JOIN tareas t ON t.orden_id = o.id
                 JOIN tramos x ON x.tarea_id = t.id WHERE o.partida_id = pa.id) AS horas_planificadas
         FROM partidas pa WHERE pa.proyecto_id = $1 ORDER BY pa.orden, pa.id`, [proyecto]);
    res.json(rows);
  }));

  function leerPartida(b, parcial) {
    const p = {};
    if (!parcial || 'codigo' in b) p.codigo = texto(b.codigo, 30, false, 'Código');
    if (!parcial || 'nombre' in b) p.nombre = texto(b.nombre, 120, true, 'El nombre de la partida');
    return p;
  }

  app.post('/api/partidas', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const b = req.body || {};
    const proyecto = Number(b.proyecto_id);
    if (!proyecto) throw fallo(400, 'Falta el proyecto');
    const p = leerPartida(b, false);
    const { rows } = await query(
      `INSERT INTO partidas (proyecto_id, codigo, nombre, orden)
       VALUES ($1, $2, $3, COALESCE((SELECT max(orden) FROM partidas WHERE proyecto_id = $1), 0) + 1) RETURNING *`,
      [proyecto, p.codigo, p.nombre]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/partidas/:id', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const p = leerPartida(req.body || {}, true);
    const s = sets(p);
    if (!s.n) throw fallo(400, 'Nada que cambiar');
    const { rows } = await query(`UPDATE partidas SET ${s.sql} WHERE id = $1 RETURNING *`, [Number(req.params.id), ...s.vals]);
    if (!rows.length) throw fallo(404, 'Partida no encontrada');
    res.json(rows[0]);
  }));

  // Solo se borra una partida vacía (sin OTs)
  app.delete('/api/partidas/:id', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT count(*)::int AS n FROM ordenes WHERE partida_id = $1', [id]);
    if (rows[0].n) throw fallo(409, `La partida tiene ${rows[0].n} OT(s): muévelas a otra partida antes de borrarla`);
    await query('DELETE FROM partidas WHERE id = $1', [id]);
    res.json({ ok: true });
  }));

  app.put('/api/proyectos/:id/partidas/orden', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    await tx(async (c) => {
      for (let i = 0; i < ids.length; i++) {
        await c.query('UPDATE partidas SET orden = $3 WHERE id = $1 AND proyecto_id = $2', [ids[i], Number(req.params.id), i + 1]);
      }
    });
    res.json({ ok: true });
  }));

  /* ---------- Órdenes de trabajo ---------- */
  function leerOT(b, parcial) {
    const o = {};
    if (!parcial || 'codigo' in b) o.codigo = texto(b.codigo, 30, false, 'Código');
    if (!parcial || 'titulo' in b) o.titulo = texto(b.titulo, 120, true, 'El título');
    if (!parcial || 'descripcion' in b) o.descripcion = texto(b.descripcion, 4000, false, 'Descripción');
    if (!parcial || 'partida_id' in b) o.partida_id = b.partida_id ? Number(b.partida_id) : null;
    if (!parcial || 'proyecto_id' in b) o.proyecto_id = b.proyecto_id ? Number(b.proyecto_id) : null;
    if (!parcial || 'prioridad' in b) {
      const pr = Number(b.prioridad ?? 3);
      if (![1, 2, 3, 4].includes(pr)) throw fallo(400, 'Prioridad no válida');
      o.prioridad = pr;
    }
    if (!parcial || 'fecha_entrega' in b) {
      if (b.fecha_entrega && !FECHA_RE.test(b.fecha_entrega)) throw fallo(400, 'Fecha de entrega no válida');
      o.fecha_entrega = b.fecha_entrega || null;
    }
    if ('color' in b) {
      if (!/^#[0-9a-f]{6}$/i.test(b.color)) throw fallo(400, 'Color no válido');
      o.color = b.color;
    }
    if ('estado' in b) {
      if (!['abierta', 'cerrada'].includes(b.estado)) throw fallo(400, 'Estado no válido');
      o.estado = b.estado;
    }
    return o;
  }

  const SQL_RESUMEN_OT = `
    SELECT o.*, p.codigo AS proyecto_codigo, p.nombre AS proyecto_nombre,
           pa.codigo AS partida_codigo, pa.nombre AS partida_nombre, pa.orden AS partida_orden,
           (SELECT count(*)::int FROM tareas t WHERE t.orden_id = o.id) AS tareas,
           (SELECT count(*)::int FROM tareas t WHERE t.orden_id = o.id
              AND (SELECT COALESCE(sum(x.duracion_h), 0) FROM tramos x WHERE x.tarea_id = t.id) >= t.duracion_h) AS planificadas,
           (SELECT COALESCE(sum(x.duracion_h), 0)::float FROM tramos x JOIN tareas t ON t.id = x.tarea_id
             WHERE t.orden_id = o.id) AS horas_planificadas,
           (SELECT count(*)::int FROM tareas t WHERE t.orden_id = o.id AND t.estado = 'hecha') AS hechas,
           (SELECT COALESCE(sum(duracion_h), 0)::float FROM tareas t WHERE t.orden_id = o.id) AS horas,
           (SELECT COALESCE(sum(duracion_h * operarios_req), 0)::float FROM tareas t WHERE t.orden_id = o.id) AS hp_estimadas,
           (SELECT COALESCE(sum(COALESCE(a.hasta, x.hora_inicio + x.duracion_h) - COALESCE(a.desde, x.hora_inicio)), 0)::float
              FROM tareas t JOIN tramos x ON x.tarea_id = t.id JOIN tramo_asignaciones a ON a.tramo_id = x.id
              JOIN recursos r ON r.id = a.recurso_id AND r.tipo = 'operario'
             WHERE t.orden_id = o.id) AS hp_planificadas
      FROM ordenes o LEFT JOIN proyectos p ON p.id = o.proyecto_id
      LEFT JOIN partidas pa ON pa.id = o.partida_id`;

  app.get('/api/ordenes', asyncH(async (req, res) => {
    const cond = [], vals = [];
    if (req.query.proyecto_id) { vals.push(Number(req.query.proyecto_id)); cond.push(`o.proyecto_id = $${vals.length}`); }
    if (req.query.estado) { vals.push(String(req.query.estado)); cond.push(`o.estado = $${vals.length}`); }
    const { rows } = await query(
      `${SQL_RESUMEN_OT} ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
       ORDER BY pa.orden NULLS LAST, pa.id, (o.estado = 'abierta') DESC, o.prioridad, o.fecha_entrega NULLS LAST, o.codigo`, vals);
    res.json(rows);
  }));

  app.get('/api/ordenes/:id', asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(`${SQL_RESUMEN_OT} WHERE o.id = $1`, [id]);
    if (!rows.length) throw fallo(404, 'OT no encontrada');
    const tareas = await query(
      `SELECT t.id, t.nombre, t.duracion_h, t.operarios_req, t.linea_id, t.estado, t.orden_en_of,
              COALESCE((SELECT sum(x.duracion_h) FROM tramos x WHERE x.tarea_id = t.id), 0)::float AS horas_planificadas,
              (SELECT count(*)::int FROM tramos x WHERE x.tarea_id = t.id) AS n_tramos,
              COALESCE((SELECT sum(COALESCE(a.hasta, x.hora_inicio + x.duracion_h) - COALESCE(a.desde, x.hora_inicio))
                          FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id
                          JOIN recursos r ON r.id = a.recurso_id AND r.tipo = 'operario'
                         WHERE x.tarea_id = t.id), 0)::float AS horas_persona,
              (SELECT min(x.fecha) FROM tramos x WHERE x.tarea_id = t.id) AS primera_fecha,
              (SELECT max(x.fecha) FROM tramos x WHERE x.tarea_id = t.id) AS ultima_fecha,
              t.notas, t.baja_presupuesto, t.ref_externa,
              COALESCE((SELECT json_agg(json_build_object('id', p2.id, 'nombre', p2.nombre, 'orden_codigo', o2.codigo,
                                                          'espera_h', d.espera_h) ORDER BY o2.codigo, p2.orden_en_of)
                          FROM tarea_dependencias d JOIN tareas p2 ON p2.id = d.depende_de_id JOIN ordenes o2 ON o2.id = p2.orden_id
                         WHERE d.tarea_id = t.id), '[]') AS dependencias,
              COALESCE((SELECT json_agg(tr.recurso_id) FROM tarea_requisitos tr WHERE tr.tarea_id = t.id), '[]') AS requisitos,
              COALESCE((SELECT json_agg(json_build_object('id', q.tipo_recurso_id, 'cantidad', q.cantidad))
                          FROM tarea_requisitos_tipo q WHERE q.tarea_id = t.id), '[]') AS requisitos_tipo
         FROM tareas t WHERE t.orden_id = $1 ORDER BY t.orden_en_of, t.id`, [id]);
    res.json({ ...rows[0], lista_tareas: tareas.rows });
  }));

  async function comprobarPartida(partidaId, proyectoId) {
    if (!partidaId) return;
    const { rows } = await query('SELECT proyecto_id FROM partidas WHERE id = $1', [partidaId]);
    if (!rows.length) throw fallo(400, 'Partida no encontrada');
    if (rows[0].proyecto_id !== proyectoId) throw fallo(400, 'La partida es de otro proyecto');
  }

  app.post('/api/ordenes', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const o = leerOT(req.body || {}, false);
    await comprobarPartida(o.partida_id, o.proyecto_id);
    o.codigo = o.codigo || await siguienteCodigo('OT');
    if (!o.color) {
      const { rows } = await query('SELECT count(*)::int AS n FROM ordenes');
      o.color = COLORES[rows[0].n % COLORES.length];
    }
    const { rows } = await query(
      `INSERT INTO ordenes (codigo, titulo, descripcion, partida_id, proyecto_id, prioridad, fecha_entrega, color)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [o.codigo, o.titulo, o.descripcion, o.partida_id, o.proyecto_id, o.prioridad, o.fecha_entrega, o.color]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/ordenes/:id', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const o = leerOT(req.body || {}, true);
    if ('codigo' in o && !o.codigo) throw fallo(400, 'El código no puede quedar vacío');
    if ('partida_id' in o || 'proyecto_id' in o) {
      const { rows: act } = await query('SELECT proyecto_id, partida_id FROM ordenes WHERE id = $1', [Number(req.params.id)]);
      if (!act.length) throw fallo(404, 'OT no encontrada');
      const proyecto = 'proyecto_id' in o ? o.proyecto_id : act[0].proyecto_id;
      // al cambiar de proyecto, la OT sale de su partida (salvo que se indique una del nuevo)
      if ('proyecto_id' in o && !('partida_id' in o) && proyecto !== act[0].proyecto_id) o.partida_id = null;
      await comprobarPartida('partida_id' in o ? o.partida_id : act[0].partida_id, proyecto);
    }
    const s = sets(o);
    if (!s.n) throw fallo(400, 'Nada que cambiar');
    const { rows } = await query(`UPDATE ordenes SET ${s.sql} WHERE id = $1 RETURNING *`, [Number(req.params.id), ...s.vals]);
    if (!rows.length) throw fallo(404, 'OT no encontrada');
    res.json(rows[0]);
  }));

  // Solo se borra una OT sin tareas planificadas ni hechas; si no, se cierra
  app.delete('/api/ordenes/:id', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT count(*)::int AS n FROM tareas t WHERE t.orden_id = $1
          AND (t.estado <> 'pendiente' OR EXISTS (SELECT 1 FROM tramos x WHERE x.tarea_id = t.id))`, [id]);
    if (rows[0].n) throw fallo(409, 'La OT tiene tareas planificadas o hechas: ciérrala en lugar de borrarla');
    await query('DELETE FROM ordenes WHERE id = $1', [id]);
    res.json({ ok: true });
  }));

  /* ---------- Tareas de una OT ---------- */
  app.post('/api/ordenes/:id/tareas', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const ordenId = Number(req.params.id);
    const b = req.body || {};
    const nombre = texto(b.nombre, 120, true, 'El nombre de la tarea');
    const dur = Number(b.duracion_h ?? 1);
    if (!(dur > 0 && dur <= 999 && (dur * 2) % 1 === 0)) throw fallo(400, 'Horas no válidas (en medias horas)');
    const ops = Number(b.operarios_req ?? 1);
    if (!Number.isInteger(ops) || ops < 0 || ops > 50) throw fallo(400, 'Operarios no válidos');
    const req_ = Array.isArray(b.requisitos) ? b.requisitos.map(Number) : [];
    const reqTipo = leerRequisitosTipo(b.requisitos_tipo) || [];

    const tarea = await tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO tareas (orden_id, nombre, duracion_h, operarios_req, linea_id, orden_en_of, actualizado_por)
         VALUES ($1,$2,$3,$4,$5, COALESCE((SELECT max(orden_en_of) FROM tareas WHERE orden_id = $1), 0) + 1, $6)
         RETURNING *`,
        [ordenId, nombre, dur, ops, b.linea_id ? Number(b.linea_id) : null, req.usuario.id]);
      for (const r of req_) await c.query('INSERT INTO tarea_requisitos VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, r]);
      for (const q of reqTipo) {
        await c.query('INSERT INTO tarea_requisitos_tipo (tarea_id, tipo_recurso_id, cantidad) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [rows[0].id, q.id, q.cantidad]);
      }
      await c.query('INSERT INTO historial (usuario_id, tarea_id, accion) VALUES ($1,$2,$3)', [req.usuario.id, rows[0].id, 'crear']);
      return rows[0];
    });
    res.status(201).json(tarea);
  }));

  app.delete('/api/tareas/:id', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT estado FROM tareas WHERE id = $1', [id]);
    if (!rows.length) throw fallo(404, 'Tarea no encontrada');
    if (['en_curso', 'hecha'].includes(rows[0].estado)) throw fallo(409, 'No se puede borrar una tarea en curso o hecha');
    const { rows: reg } = await query('SELECT 1 FROM registros WHERE tarea_id = $1 LIMIT 1', [id]);
    if (reg.length) throw fallo(409, 'Tiene horas reales registradas: no se puede borrar');
    await query('DELETE FROM tareas WHERE id = $1', [id]);
    res.json({ ok: true });
  }));

  // Reordenar tareas dentro de la OT
  app.put('/api/ordenes/:id/tareas/orden', auth.permiso('proyectos'), asyncH(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
    await tx(async (c) => {
      for (let i = 0; i < ids.length; i++) {
        await c.query('UPDATE tareas SET orden_en_of = $3 WHERE id = $1 AND orden_id = $2', [ids[i], Number(req.params.id), i + 1]);
      }
    });
    res.json({ ok: true });
  }));
};

module.exports.leerRequisitosTipo = leerRequisitosTipo;
