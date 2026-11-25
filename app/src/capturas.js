// Bandeja de capturas (al estilo GTD).
//  1. CAPTURAR: cualquiera (operario u oficina), desde el móvil: texto, audio, foto, vídeo (30 s).
//     Puede decir de qué proyecto / OT es (por defecto, el trabajo en el que está hoy) y qué tipo de
//     asunto es (falta material, avería, calidad, seguridad, mejora…). Las antiguas «incidencias» son esto.
//  2. CLARIFICAR (quien planifica): cada captura de la bandeja se convierte en
//       · tarea nueva en una OT (pasa a «Por planificar» en el cuadrante),
//       · asunto con responsable, prioridad y fecha límite, que se sigue hasta resolverlo,
//       · información que queda en el proyecto / OT,
//       · o se descarta.
//  3. Quien la capturó ve en qué ha quedado.
const { query, tx } = require('./db');
const auth = require('./auth');
const archivos = require('./archivos');
const { afectados } = require('./ausencias');
const notif = require('./notificaciones');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max) => String(v || '').trim().slice(0, max) || null;
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;

const CATEGORIAS = {
  material: 'Falta material',
  averia: 'Avería de máquina o herramienta',
  calidad: 'Problema de calidad / error',
  seguridad: 'Seguridad',
  mejora: 'Idea / mejora',
  otro: 'Otro',
};
const ESTADOS = {
  bandeja: 'En la bandeja', asunto: 'Asunto abierto', tarea: 'Convertida en tarea',
  info: 'Información', resuelta: 'Resuelta', descartada: 'Descartada',
};

const SQL = `
  SELECT c.*, u.nombre AS autor, r.nombre AS recurso, p.codigo AS proyecto_codigo, p.nombre AS proyecto_nombre,
         o.codigo AS orden_codigo, o.titulo AS orden_titulo, t.nombre AS tarea, m.nombre AS maquina,
         ur.nombre AS responsable, uc.nombre AS clasificada_por_nombre, us.nombre AS resuelta_por_nombre,
         tc.nombre AS tarea_creada, tc.estado AS tarea_creada_estado,
         EXISTS (SELECT 1 FROM ausencias a WHERE a.recurso_id = c.maquina_id AND a.tipo = 'averia' AND a.hasta >= CURRENT_DATE) AS maquina_parada
    FROM capturas c
    LEFT JOIN usuarios u ON u.id = c.usuario_id LEFT JOIN recursos r ON r.id = c.recurso_id
    LEFT JOIN proyectos p ON p.id = c.proyecto_id LEFT JOIN ordenes o ON o.id = c.orden_id
    LEFT JOIN tareas t ON t.id = c.tarea_id LEFT JOIN recursos m ON m.id = c.maquina_id
    LEFT JOIN usuarios ur ON ur.id = c.responsable_id LEFT JOIN usuarios uc ON uc.id = c.clasificada_por
    LEFT JOIN usuarios us ON us.id = c.resuelta_por LEFT JOIN tareas tc ON tc.id = c.tarea_creada_id`;

async function conArchivos(rows) {
  const adj = await archivos.de('captura', rows.map((c) => c.id));
  for (const c of rows) c.archivos = adj.get(c.id) || [];
  return rows;
}

// proyecto / OT coherentes: la OT manda (su proyecto); si no, el del tramo; si no, lo que se diga
async function situar(c, { proyecto_id, orden_id, tramo_id }, recursoId) {
  let tramoId = null, tareaId = null, ordenId = orden_id ? Number(orden_id) : null, proyectoId = proyecto_id ? Number(proyecto_id) : null;
  if (tramo_id && recursoId) {
    const { rows } = await c.query(
      `SELECT x.id, x.tarea_id, t.orden_id, o.proyecto_id FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $2
         JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id WHERE x.id = $1`, [Number(tramo_id), recursoId]);
    if (rows.length) {
      tramoId = rows[0].id;
      // si eligió otra OT, la captura es de esa OT (no del trabajo que estaba haciendo)
      if (!ordenId || ordenId === rows[0].orden_id) { tareaId = rows[0].tarea_id; ordenId = rows[0].orden_id; proyectoId = rows[0].proyecto_id; }
    }
  }
  if (ordenId) {
    const { rows } = await c.query('SELECT id, proyecto_id FROM ordenes WHERE id = $1', [ordenId]);
    if (!rows.length) throw fallo(400, 'OT no encontrada');
    proyectoId = rows[0].proyecto_id ?? proyectoId;
  }
  if (proyectoId) {
    const { rows } = await c.query('SELECT 1 FROM proyectos WHERE id = $1', [proyectoId]);
    if (!rows.length) throw fallo(400, 'Proyecto no encontrado');
  }
  return { tramoId, tareaId, ordenId, proyectoId };
}

function montar(app, asyncH) {
  const clasifica = auth.permiso('planificar');

  /* ---------- Capturar (todos) ---------- */
  // Listas para el formulario: proyectos y OTs abiertas, mis trabajos de hoy, máquinas
  app.get('/api/capturas/opciones', asyncH(async (req, res) => {
    const recursoId = req.usuario.recurso_id;
    const [{ rows: proyectos }, { rows: ordenes }, { rows: tramos }, { rows: maquinas }] = await Promise.all([
      query(`SELECT id, codigo, nombre FROM proyectos WHERE estado = 'activo' ORDER BY codigo DESC`),
      query(`SELECT id, codigo, titulo, proyecto_id FROM ordenes WHERE estado = 'abierta' ORDER BY codigo`),
      recursoId ? query(
        `SELECT x.id, x.hora_inicio::float AS hora_inicio, t.nombre AS tarea, o.id AS orden_id, o.codigo AS orden_codigo, o.proyecto_id
           FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $1
           JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id
          WHERE x.fecha = $2 ORDER BY x.hora_inicio`, [recursoId, hoyMadrid()]) : { rows: [] },
      query(`SELECT id, nombre FROM recursos WHERE tipo = 'maquina' AND activo ORDER BY nombre`),
    ]);
    res.json({ proyectos, ordenes, tramos_hoy: tramos, maquinas, categorias: CATEGORIAS });
  }));

  // { texto?, categoria?, proyecto_id?, orden_id?, tramo_id?, maquina_id?, archivos?: [ids] }
  app.post('/api/capturas', asyncH(async (req, res) => {
    const b = req.body || {};
    const t = texto(b.texto, 2000);
    const ids = Array.isArray(b.archivos) ? b.archivos : [];
    if (!t && !ids.length) throw fallo(400, 'Escribe algo, graba un audio o haz una foto o vídeo');
    if (b.categoria && !CATEGORIAS[b.categoria]) throw fallo(400, 'Tipo no válido');
    const id = await tx(async (c) => {
      const s = await situar(c, b, req.usuario.recurso_id);
      let maquinaId = null;
      if (b.maquina_id) {
        const { rows } = await c.query(`SELECT id FROM recursos WHERE id = $1 AND tipo = 'maquina'`, [Number(b.maquina_id)]);
        maquinaId = rows[0]?.id || null;
      }
      const { rows } = await c.query(
        `INSERT INTO capturas (usuario_id, recurso_id, texto, categoria, proyecto_id, orden_id, tramo_id, tarea_id, maquina_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [req.usuario.id, req.usuario.recurso_id || null, t, b.categoria || null, s.proyectoId, s.ordenId, s.tramoId, s.tareaId, maquinaId]);
      const n = await archivos.enlazar(c, ids, 'captura', rows[0].id, req.usuario.id);
      if (!t && !n) throw fallo(400, 'No se ha podido adjuntar lo grabado: vuelve a intentarlo');
      return rows[0].id;
    });
    // averías y seguridad: aviso al momento a quien planifica (lo demás va en el resumen de la bandeja)
    if (notif.URGENTES.includes(b.categoria)) {
      notif.avisarLuego(notif.conPermiso('planificar'), 'urgente', {
        titulo: `⚠ ${CATEGORIAS[b.categoria]}`, cuerpo: `${req.usuario.nombre}: ${(t || 'ver foto / vídeo').slice(0, 140)}`,
        url: '/bandeja.html', tag: `captura-${id}`, urgente: true,
      });
    }
    res.status(201).json({ id });
  }));

  // Lo que he capturado yo (y en qué ha quedado)
  app.get('/api/capturas/mias', asyncH(async (req, res) => {
    const { rows } = await query(
      `${SQL} WHERE c.usuario_id = $1 AND c.estado <> 'descartada' AND (c.estado IN ('bandeja','asunto') OR c.creado > now() - interval '30 days')
       ORDER BY c.creado DESC LIMIT 100`, [req.usuario.id]);
    res.json({ capturas: await conArchivos(rows), categorias: CATEGORIAS, estados: ESTADOS });
  }));

  /* ---------- Bandeja (quien planifica) y asuntos (su responsable) ---------- */
  // vista: bandeja | asuntos | mios (asuntos de los que soy responsable) | todas (sin lo descartado) |
  //        descartadas (solo quien administra usuarios: lo descartado no sale en ningún otro sitio)
  app.get('/api/capturas', asyncH(async (req, res) => {
    const vista = ['bandeja', 'asuntos', 'mios', 'todas', 'descartadas'].includes(req.query.vista) ? req.query.vista : 'bandeja';
    if (vista === 'descartadas' && !auth.tiene(req.usuario, 'usuarios')) throw fallo(403, 'Lo descartado solo lo ve quien administra');
    const puede = auth.tiene(req.usuario, 'planificar');
    if (!puede && vista !== 'mios') throw fallo(403, 'La bandeja la clasifica quien planifica');
    const cond = [], vals = [];
    if (vista === 'bandeja') cond.push(`c.estado = 'bandeja'`);
    if (vista === 'asuntos') cond.push(`c.estado = 'asunto'`);
    if (vista === 'mios') { vals.push(req.usuario.id); cond.push(`c.estado = 'asunto' AND c.responsable_id = $${vals.length}`); }
    if (vista === 'todas') cond.push(`c.creado > now() - interval '120 days' AND c.estado <> 'descartada'`);
    if (vista === 'descartadas') cond.push(`c.estado = 'descartada'`);
    if (req.query.proyecto_id) { vals.push(Number(req.query.proyecto_id)); cond.push(`c.proyecto_id = $${vals.length}`); }
    if (req.query.orden_id) { vals.push(Number(req.query.orden_id)); cond.push(`c.orden_id = $${vals.length}`); }
    const orden = vista === 'bandeja' ? 'c.creado' : `(c.prioridad = 'alta') DESC, c.fecha_limite NULLS LAST, c.creado DESC`;
    const { rows } = await query(`${SQL} ${cond.length ? `WHERE ${cond.join(' AND ')}` : ''} ORDER BY ${orden} LIMIT 300`, vals);
    const { rows: n } = await query(
      `SELECT count(*) FILTER (WHERE estado = 'bandeja')::int AS bandeja, count(*) FILTER (WHERE estado = 'asunto')::int AS asuntos,
              count(*) FILTER (WHERE estado = 'asunto' AND responsable_id = $1)::int AS mios FROM capturas`, [req.usuario.id]);
    res.json({ capturas: await conArchivos(rows), cuenta: n[0], categorias: CATEGORIAS, estados: ESTADOS, puede_clasificar: puede });
  }));

  // Para clasificar: responsables posibles, oficios y áreas (para crear la tarea)
  app.get('/api/capturas/opciones-clasificar', clasifica, asyncH(async (req, res) => {
    const [{ rows: usuarios }, { rows: oficios }, { rows: areas }] = await Promise.all([
      query(`SELECT u.id, u.nombre FROM usuarios u WHERE u.activo AND u.email IS NOT NULL ORDER BY u.nombre`),
      // lo que pide la tarea es saber hacer algo (capacidad), no una categoría
      query(`SELECT id, nombre, familia FROM capacidades ORDER BY orden, lower(nombre)`),
      query(`SELECT id, nombre FROM lineas WHERE activo AND tipo <> 'obra' ORDER BY orden NULLS LAST, nombre`),
    ]);
    res.json({ usuarios, oficios, areas });
  }));

  // { destino: tarea|asunto|info|descartar, proyecto_id?, orden_id?, categoria?, nota?, prioridad?, responsable_id?,
  //   fecha_limite?, tarea?: { nombre, duracion_h, operarios_req, oficio_id?, linea_id? } }
  app.post('/api/capturas/:id/clasificar', clasifica, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    if (!['tarea', 'asunto', 'info', 'descartar'].includes(b.destino)) throw fallo(400, 'Elige qué hacer con ella');
    if (b.categoria && !CATEGORIAS[b.categoria]) throw fallo(400, 'Tipo no válido');
    const prioridad = ['alta', 'normal', 'baja'].includes(b.prioridad) ? b.prioridad : 'normal';
    const out = await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM capturas WHERE id = $1 FOR UPDATE', [id]);
      if (!rows.length) throw fallo(404, 'Captura no encontrada');
      const cap = rows[0];
      const s = await situar(c, { proyecto_id: b.proyecto_id ?? cap.proyecto_id, orden_id: b.orden_id ?? cap.orden_id }, null);
      const comun = [id, s.proyectoId, s.ordenId, b.categoria || cap.categoria, texto(b.nota, 1000), req.usuario.id];
      const base = `proyecto_id = $2, orden_id = $3, categoria = $4, nota = $5, clasificada_por = $6, clasificada_en = now()`;

      if (b.destino === 'tarea') {
        if (!s.ordenId) throw fallo(400, 'Para crear una tarea hay que elegir la OT');
        const t = b.tarea || {};
        const nombre = texto(t.nombre, 120);
        if (!nombre) throw fallo(400, 'Pon nombre a la tarea');
        const dur = Number(t.duracion_h ?? 1);
        if (!(dur > 0 && dur <= 999 && (dur * 2) % 1 === 0)) throw fallo(400, 'Horas no válidas (en medias horas)');
        const ops = Number(t.operarios_req ?? 1);
        if (!Number.isInteger(ops) || ops < 0 || ops > 50) throw fallo(400, 'Operarios no válidos');
        const notas = [cap.texto, `(De la bandeja #${id}${cap.usuario_id ? '' : ''})`].filter(Boolean).join('\n');
        const { rows: tr } = await c.query(
          `INSERT INTO tareas (orden_id, nombre, duracion_h, operarios_req, linea_id, notas, orden_en_of, actualizado_por)
           VALUES ($1,$2,$3,$4,$5,$6, COALESCE((SELECT max(orden_en_of) FROM tareas WHERE orden_id = $1), 0) + 1, $7) RETURNING id`,
          [s.ordenId, nombre, dur, ops, t.linea_id ? Number(t.linea_id) : null, notas.slice(0, 2000), req.usuario.id]);
        const capId = Number(t.capacidad_id || t.oficio_id) || null;
        if (capId && ops > 0) {
          await c.query('INSERT INTO tarea_capacidades (tarea_id, capacidad_id, cantidad) SELECT $1, id, $3 FROM capacidades WHERE id = $2 ON CONFLICT DO NOTHING',
            [tr[0].id, capId, ops]);
        }
        await c.query('INSERT INTO historial (usuario_id, tarea_id, accion, detalle) VALUES ($1,$2,$3,$4)',
          [req.usuario.id, tr[0].id, 'crear', JSON.stringify({ desde_captura: id })]);
        await c.query(`UPDATE capturas SET ${base}, estado = 'tarea', tarea_creada_id = $7, prioridad = $8 WHERE id = $1`, [...comun, tr[0].id, prioridad]);
        return { estado: 'tarea', tarea_id: tr[0].id };
      }
      if (b.destino === 'asunto') {
        const resp = b.responsable_id ? Number(b.responsable_id) : null;
        if (!resp) throw fallo(400, 'Di quién se encarga');
        const fl = b.fecha_limite && FECHA_RE.test(b.fecha_limite) ? b.fecha_limite : null;
        await c.query(`UPDATE capturas SET ${base}, estado = 'asunto', responsable_id = $7, fecha_limite = $8, prioridad = $9 WHERE id = $1`,
          [...comun, resp, fl, prioridad]);
        return { estado: 'asunto' };
      }
      if (b.destino === 'info') {
        if (!s.proyectoId && !s.ordenId) throw fallo(400, 'Elige el proyecto o la OT donde guardarla');
        await c.query(`UPDATE capturas SET ${base}, estado = 'info' WHERE id = $1`, comun);
        return { estado: 'info' };
      }
      await c.query(`UPDATE capturas SET ${base}, estado = 'descartada' WHERE id = $1`, comun);
      return { estado: 'descartada' };
    });
    // avisos: a quien lo capturó si es tarea; al responsable si es un asunto
    const { rows: cap } = await query('SELECT usuario_id, texto FROM capturas WHERE id = $1', [id]);
    const resumen = (cap[0]?.texto || 'lo que apuntaste').slice(0, 120);
    if (out.estado === 'tarea' && cap[0]?.usuario_id !== req.usuario.id) {
      notif.avisarLuego([cap[0]?.usuario_id], 'capturas', { titulo: 'Lo que capturaste ya es una tarea', cuerpo: resumen, url: '/inicio.html', tag: `captura-${id}` });
    }
    if (out.estado === 'asunto' && Number(b.responsable_id) !== req.usuario.id) {
      notif.avisarLuego([Number(b.responsable_id)], 'asuntos', {
        titulo: 'Te han asignado un asunto', cuerpo: `${resumen}${b.fecha_limite ? ` · para el ${b.fecha_limite.split('-').reverse().join('/')}` : ''}`,
        url: '/capturar.html', tag: `captura-${id}`,
      });
    }
    res.json({ ok: true, ...out });
  }));

  // Resolver un asunto (quien planifica o su responsable)
  app.post('/api/capturas/:id/resolver', asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT estado, responsable_id FROM capturas WHERE id = $1', [id]);
    if (!rows.length) throw fallo(404, 'Captura no encontrada');
    if (!auth.tiene(req.usuario, 'planificar') && rows[0].responsable_id !== req.usuario.id) throw fallo(403, 'Lo resuelve su responsable o quien planifica');
    if (!['asunto', 'bandeja'].includes(rows[0].estado)) throw fallo(409, 'Ya está cerrada');
    await query(`UPDATE capturas SET estado = 'resuelta', resuelta_por = $2, resuelta_en = now(), resolucion = $3 WHERE id = $1`,
      [id, req.usuario.id, texto(req.body?.resolucion, 1000)]);
    const { rows: cap } = await query('SELECT usuario_id, texto FROM capturas WHERE id = $1', [id]);
    if (cap[0]?.usuario_id && cap[0].usuario_id !== req.usuario.id) {
      notif.avisarLuego([cap[0].usuario_id], 'capturas', {
        titulo: '✔ Resuelto lo que capturaste', cuerpo: texto(req.body?.resolucion, 140) || (cap[0].texto || '').slice(0, 120), url: '/inicio.html', tag: `captura-${id}`,
      });
    }
    res.json({ ok: true });
  }));

  // Volver a la bandeja (se clasificó mal)
  app.post('/api/capturas/:id/reabrir', clasifica, asyncH(async (req, res) => {
    const { rows } = await query('SELECT estado FROM capturas WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) throw fallo(404, 'Captura no encontrada');
    if (rows[0].estado === 'tarea') throw fallo(409, 'Ya es una tarea: bórrala o cámbiala en Proyectos');
    await query(`UPDATE capturas SET estado = 'bandeja', resuelta_por = NULL, resuelta_en = NULL, resolucion = NULL WHERE id = $1`, [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // Avería: la máquina queda no disponible desde hoy (un día; se amplía en Recursos si dura más)
  app.post('/api/capturas/:id/maquina-parada', clasifica, asyncH(async (req, res) => {
    const { rows } = await query('SELECT maquina_id, texto FROM capturas WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length || !rows[0].maquina_id) throw fallo(400, 'Esta captura no dice qué máquina');
    const hoy = hoyMadrid();
    await query(`INSERT INTO ausencias (recurso_id, tipo, desde, hasta, notas, creado_por) VALUES ($1,'averia',$2,$2,$3,$4)`,
      [rows[0].maquina_id, hoy, `Avería avisada: ${rows[0].texto || '(ver captura)'}`.slice(0, 500), req.usuario.id]);
    res.json({ ok: true, afectados: (await afectados(rows[0].maquina_id, { desde: hoy, hasta: hoy, hora_desde: null })).length });
  }));
}

module.exports = { montar, CATEGORIAS, ESTADOS };
