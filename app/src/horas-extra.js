// Turnos y horas extra.
//  · Cada persona tiene su turno (por defecto «Normal», 07:00–15:00). Lo que se le planifica fuera de él son horas extra.
//  · Al planificar (estirar un tramo, cambiar una franja, asignar a alguien) se sincroniza `horas_extra` por persona y tramo:
//    pendiente de autorizar, o autorizada al momento si quien planifica tiene «autorizar_horas_extra».
//  · Dirección autoriza o no. Si no, la franja de esa persona (y el tramo, si nadie más sigue) vuelve a su fin de turno
//    y lo que sobra queda en «Por planificar».
//  · Lo trabajado fuera del turno sin autorizar (del parte) sale como «hechas sin autorizar» para que Dirección decida.
//  · En costes solo llevan recargo las autorizadas.
const { query, tx } = require('./db');
const auth = require('./auth');
const notif = require('./notificaciones');
const { jornada } = require('./config');

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const ddmm = (f) => `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}`;
const fallo = (status, msg) => Object.assign(new Error(msg), { status });

// Turno de cada recurso (inicio, fin) — para usar en SQL: JOIN (${SQL_TURNO}) tu ON tu.id = …
const SQL_TURNO = `SELECT r.id, COALESCE(t.inicio, d.inicio, ${jornada.inicio})::float AS ini, COALESCE(t.fin, d.fin, ${jornada.fin})::float AS fin,
                          COALESCE(t.nombre, d.nombre, 'Normal') AS turno
                     FROM recursos r LEFT JOIN turnos t ON t.id = r.turno_id AND t.activo
                     LEFT JOIN turnos d ON d.por_defecto AND d.activo`;

// Horas de lo trabajado por día fuera del turno (por recurso y fecha): por intervalos si hay horas de/a; si no, lo que pase
// de la duración del turno.
const SQL_EXTRA_DIA = (filtro) => `
  SELECT g.recurso_id, g.fecha, sum(g.horas)::float AS tot,
         GREATEST(
           sum(CASE WHEN g.desde IS NULL OR g.hasta IS NULL THEN 0
                    ELSE GREATEST(0, LEAST(g.hasta, tu.ini) - g.desde) + GREATEST(0, g.hasta - GREATEST(g.desde, tu.fin)) END),
           sum(g.horas) - max(tu.fin - tu.ini))::float AS ext
    FROM registros g JOIN (${SQL_TURNO}) tu ON tu.id = g.recurso_id
   WHERE ${filtro}
   GROUP BY 1, 2`;

async function turnoDe(c, recursoIds) {
  if (!recursoIds.length) return new Map();
  const { rows } = await c.query(`SELECT * FROM (${SQL_TURNO}) x WHERE id = ANY($1)`, [recursoIds]);
  return new Map(rows.map((r) => [r.id, r]));
}

// Parte de [desde, hasta] que queda fuera de [tu.ini, tu.fin]
function fuera(desde, hasta, tu) {
  const seg = [];
  if (desde < tu.ini) seg.push([desde, Math.min(hasta, tu.ini)]);
  if (hasta > tu.fin) seg.push([Math.max(desde, tu.fin), hasta]);
  const ok = seg.filter(([a, b]) => b > a + 1e-6);
  if (!ok.length) return { horas: 0 };
  return { horas: r2(ok.reduce((s, [a, b]) => s + b - a, 0)), desde: ok[0][0], hasta: ok[ok.length - 1][1] };
}

/* ---------- sincronizar las horas extra de un tramo (dentro de la transacción del cambio) ---------- */
async function sincronizar(c, tramoId, usuario) {
  const { rows: tr } = await c.query(
    `SELECT tr.id, tr.fecha, tr.hora_inicio::float AS hora_inicio, tr.duracion_h::float AS duracion_h, t.proveedor_id
       FROM tramos tr JOIN tareas t ON t.id = tr.tarea_id WHERE tr.id = $1`, [tramoId]);
  if (!tr.length) return [];
  const T = tr[0];
  const { rows: ops } = T.proveedor_id ? { rows: [] } : await c.query(
    `SELECT a.recurso_id, a.desde::float AS desde, a.hasta::float AS hasta
       FROM tramo_asignaciones a JOIN recursos r ON r.id = a.recurso_id AND r.tipo = 'operario' WHERE a.tramo_id = $1`, [tramoId]);
  const { rows: ya } = await c.query('SELECT * FROM horas_extra WHERE tramo_id = $1', [tramoId]);
  const prev = new Map(ya.map((x) => [x.recurso_id, x]));
  const turnos = await turnoDe(c, ops.map((o) => o.recurso_id));
  const puede = auth.tiene(usuario, 'autorizar_horas_extra');
  const fin = T.hora_inicio + T.duracion_h;
  const vivos = new Set();
  for (const o of ops) {
    const f = fuera(o.desde ?? T.hora_inicio, o.hasta ?? fin, turnos.get(o.recurso_id));
    const ex = prev.get(o.recurso_id);
    if (!f.horas) {
      if (ex && ex.estado !== 'rechazada') await c.query('DELETE FROM horas_extra WHERE id = $1', [ex.id]);
      else if (ex) vivos.add(o.recurso_id);
      continue;
    }
    vivos.add(o.recurso_id);
    if (!ex) {
      await c.query(
        `INSERT INTO horas_extra (tramo_id, recurso_id, fecha, desde, hasta, horas, estado, pedido_por, decidido_por, decidido_en, avisado)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [tramoId, o.recurso_id, T.fecha, f.desde, f.hasta, f.horas, puede ? 'autorizada' : 'pendiente', usuario.id,
          puede ? usuario.id : null, puede ? new Date() : null, puede]);
      continue;
    }
    // más horas que lo ya decidido (o se había dicho que no) → vuelve a pedirse
    const mas = f.horas > Number(ex.horas) + 1e-6 || ex.estado === 'rechazada';
    if (mas) {
      await c.query(
        `UPDATE horas_extra SET fecha = $2, desde = $3, hasta = $4, horas = $5, estado = $6, pedido_por = $7, pedido_en = now(),
                decidido_por = $8, decidido_en = $9, nota = NULL, avisado = $10 WHERE id = $1`,
        [ex.id, T.fecha, f.desde, f.hasta, f.horas, puede ? 'autorizada' : 'pendiente', usuario.id,
          puede ? usuario.id : null, puede ? new Date() : null, puede]);
    } else {
      await c.query('UPDATE horas_extra SET fecha = $2, desde = $3, hasta = $4, horas = $5 WHERE id = $1', [ex.id, T.fecha, f.desde, f.hasta, f.horas]);
    }
  }
  for (const x of ya) if (!vivos.has(x.recurso_id)) await c.query('DELETE FROM horas_extra WHERE id = $1', [x.id]);
  const { rows } = await c.query(
    `SELECT he.id, he.tramo_id, he.recurso_id, r.nombre, he.desde::float AS desde, he.hasta::float AS hasta, he.horas::float AS horas,
            he.estado, he.avisado
       FROM horas_extra he JOIN recursos r ON r.id = he.recurso_id WHERE he.tramo_id = $1 ORDER BY r.nombre`, [tramoId]);
  return rows;
}

// Devuelve a su turno la franja de esas personas en el tramo; si ya nadie (operario) pasa del nuevo fin, el tramo se acorta.
async function recortar(c, tramoId, recursoIds) {
  const { rows: tr } = await c.query('SELECT id, hora_inicio::float AS hi, duracion_h::float AS dur FROM tramos WHERE id = $1 FOR UPDATE', [tramoId]);
  if (!tr.length) return;
  const T = tr[0]; const fin = T.hi + T.dur;
  const { rows: asig } = await c.query(
    `SELECT a.recurso_id, a.desde::float AS desde, a.hasta::float AS hasta, r.tipo FROM tramo_asignaciones a JOIN recursos r ON r.id = a.recurso_id
      WHERE a.tramo_id = $1`, [tramoId]);
  const turnos = await turnoDe(c, asig.map((a) => a.recurso_id));
  for (const a of asig.filter((x) => recursoIds.includes(x.recurso_id))) {
    const tu = turnos.get(a.recurso_id);
    const d = Math.max(a.desde ?? T.hi, tu.ini); const h = Math.min(a.hasta ?? fin, tu.fin);
    await c.query('UPDATE tramo_asignaciones SET desde = $3, hasta = $4 WHERE tramo_id = $1 AND recurso_id = $2',
      [tramoId, a.recurso_id, d, Math.max(d, h)]);
  }
  // nuevo final: lo que llegue más lejos entre los operarios (y nunca menos que el inicio + 0,5 h)
  const { rows: ops } = await c.query(
    `SELECT COALESCE(a.hasta, t.hora_inicio + t.duracion_h)::float AS h, COALESCE(a.desde, t.hora_inicio)::float AS d
       FROM tramo_asignaciones a JOIN tramos t ON t.id = a.tramo_id JOIN recursos r ON r.id = a.recurso_id AND r.tipo = 'operario'
      WHERE a.tramo_id = $1`, [tramoId]);
  if (ops.length) {
    const maxFin = Math.max(...ops.map((o) => o.h)); const minIni = Math.min(...ops.map((o) => o.d));
    const ini = Math.max(T.hi, minIni); const nf = Math.max(ini + 0.5, Math.min(fin, maxFin));
    if (ini !== T.hi || nf !== fin) {
      await c.query('UPDATE tramos SET hora_inicio = $2, duracion_h = $3 WHERE id = $1', [tramoId, ini, r2(nf - ini)]);
      await c.query(
        `UPDATE tramo_asignaciones a SET desde = GREATEST(a.desde, $2), hasta = LEAST(a.hasta, $3) WHERE a.tramo_id = $1 AND a.desde IS NOT NULL`,
        [tramoId, ini, nf]);
      await c.query(
        `UPDATE tramo_asignaciones SET desde = NULL, hasta = NULL
          WHERE tramo_id = $1 AND desde IS NOT NULL AND ((desde <= $2 AND hasta >= $3) OR desde >= hasta)`, [tramoId, ini, nf]);
    }
  }
}

/* ---------- quién y qué ---------- */
const SQL_LISTA = `
  SELECT he.id, he.tramo_id, he.recurso_id, r.nombre AS recurso, he.fecha, he.desde::float AS desde, he.hasta::float AS hasta,
         he.horas::float AS horas, he.origen, he.estado, he.motivo, he.nota, he.pedido_en, he.decidido_en,
         up.nombre AS pedido_por_nombre, ud.nombre AS decidido_por_nombre,
         t.id AS tarea_id, t.codigo AS tarea_codigo, t.nombre AS tarea, o.codigo AS orden_codigo, o.titulo AS orden_titulo, l.nombre AS area,
         (he.horas * COALESCE(r.coste_hora, 0) * (1 + COALESCE((SELECT (valor->>'recargo_extra')::float FROM ajustes WHERE clave = 'costes'), 0.5)))::float AS coste,
         (SELECT COALESCE(sum(x.horas), 0)::float FROM horas_extra x WHERE x.recurso_id = he.recurso_id AND x.estado = 'autorizada'
            AND date_trunc('month', x.fecha) = date_trunc('month', he.fecha) AND x.id <> he.id) AS mes_autorizadas
    FROM horas_extra he JOIN recursos r ON r.id = he.recurso_id
    LEFT JOIN tramos tr ON tr.id = he.tramo_id LEFT JOIN tareas t ON t.id = tr.tarea_id
    LEFT JOIN ordenes o ON o.id = t.orden_id LEFT JOIN lineas l ON l.id = tr.linea_id
    LEFT JOIN usuarios up ON up.id = he.pedido_por LEFT JOIN usuarios ud ON ud.id = he.decidido_por`;

// Agrupadas por tramo (una petición = un tramo con sus personas) para decidir de una vez
function agrupar(rows) {
  const g = new Map();
  for (const x of rows) {
    const k = x.tramo_id ? `t${x.tramo_id}` : `p${x.id}`;
    if (!g.has(k)) g.set(k, { ...x, ids: [], personas: [], horas: 0, coste: 0 });
    const a = g.get(k);
    a.ids.push(x.id); a.personas.push({ id: x.recurso_id, nombre: x.recurso, horas: x.horas, desde: x.desde, hasta: x.hasta, mes: x.mes_autorizadas });
    a.horas = r2(a.horas + x.horas); a.coste = r2(a.coste + x.coste);
    a.desde = Math.min(a.desde ?? 99, x.desde ?? 99); a.hasta = Math.max(a.hasta ?? 0, x.hasta ?? 0);
  }
  return [...g.values()];
}

// Trabajado fuera del turno y sin autorizar (ni pedir, ni rechazar) — del parte
async function sinAutorizar(desde, hasta) {
  const { rows } = await query(
    `WITH ext AS (${SQL_EXTRA_DIA('g.fecha BETWEEN $1 AND $2')}),
          he AS (SELECT recurso_id, fecha, sum(horas)::float AS h FROM horas_extra WHERE fecha BETWEEN $1 AND $2 GROUP BY 1, 2)
     SELECT ext.recurso_id, r.nombre AS recurso, ext.fecha, r2.h_ext AS horas,
            (r2.h_ext * COALESCE(r.coste_hora, 0))::float AS coste
       FROM ext JOIN recursos r ON r.id = ext.recurso_id AND r.tipo = 'operario'
       LEFT JOIN he ON he.recurso_id = ext.recurso_id AND he.fecha = ext.fecha,
       LATERAL (SELECT round((ext.ext - COALESCE(he.h, 0))::numeric, 2)::float AS h_ext) r2
      WHERE r2.h_ext > 0.05 ORDER BY ext.fecha DESC, r.nombre`, [desde, hasta]);
  return rows;
}

// Para informes: por recurso, horas fuera del turno trabajadas, autorizadas (con tope en lo trabajado) y sin autorizar
async function resumenReal(desde, hasta) {
  const { rows } = await query(
    `WITH ext AS (${SQL_EXTRA_DIA('g.fecha BETWEEN $1 AND $2')}),
          aut AS (SELECT recurso_id, fecha, sum(horas)::float AS h FROM horas_extra WHERE estado = 'autorizada' AND fecha BETWEEN $1 AND $2 GROUP BY 1, 2)
     SELECT ext.recurso_id, sum(ext.ext)::float AS fuera, sum(LEAST(ext.ext, COALESCE(aut.h, 0)))::float AS autorizadas
       FROM ext LEFT JOIN aut ON aut.recurso_id = ext.recurso_id AND aut.fecha = ext.fecha GROUP BY 1`, [desde, hasta]);
  return new Map(rows.map((r) => [r.recurso_id, { autorizadas: r2(r.autorizadas), sin_autorizar: r2(r.fuera - r.autorizadas) }]));
}

async function contarPendientes() {
  const { rows } = await query(`SELECT count(DISTINCT COALESCE('t' || tramo_id, 'p' || id))::int AS n FROM horas_extra WHERE estado = 'pendiente'`);
  return rows[0].n;
}

function textoPeticion(g) {
  const quien = g.personas.map((p) => p.nombre).join(', ');
  return `${g.tarea_codigo ? `${g.tarea_codigo} ${g.tarea} · ` : ''}${ddmm(g.fecha)} ${g.desde < 99 ? `${hhmm(g.desde)}–${hhmm(g.hasta)} · ` : ''}${quien} = ${g.horas} h`;
}

async function avisarAutorizadores(tramoId, usuario) {
  const { rows } = await query(`${SQL_LISTA} WHERE he.tramo_id = $1 AND he.estado = 'pendiente'`, [tramoId]);
  if (!rows.length) return;
  const g = agrupar(rows)[0];
  const ids = (await notif.conPermiso('autorizar_horas_extra')).filter((id) => id !== usuario.id);
  if (!ids.length) return;
  // a quien usa la app del móvil le abre Supervisar › Aprobar; al resto, Recursos › Horas extra
  const { rows: us } = await query('SELECT id, recurso_id FROM usuarios WHERE id = ANY($1)', [ids]);
  const msg = { titulo: `⏱ Horas extra por autorizar (${g.horas} h)`, cuerpo: `${textoPeticion(g)}${g.motivo ? ` · «${g.motivo}»` : ''} · pidió ${usuario.nombre}`, tag: `he-${tramoId}` };
  const movil = us.filter((u) => u.recurso_id).map((u) => u.id); const resto = us.filter((u) => !u.recurso_id).map((u) => u.id);
  if (movil.length) notif.avisarLuego(movil, 'horas_extra', { ...msg, url: '/mi-dia.html?vista=aprobar' });
  if (resto.length) notif.avisarLuego(resto, 'horas_extra', { ...msg, url: '/recursos.html?tipo=extras' });
}

/* ---------- rutas ---------- */
function montar(app, asyncH) {
  const puedeDecidir = auth.permiso('autorizar_horas_extra');

  // Turnos
  app.get('/api/turnos', asyncH(async (_req, res) => {
    const { rows } = await query(
      `SELECT t.id, t.nombre, t.inicio::float AS inicio, t.fin::float AS fin, t.por_defecto, t.activo,
              (SELECT count(*)::int FROM recursos r WHERE r.activo AND r.tipo = 'operario'
                 AND (r.turno_id = t.id OR (r.turno_id IS NULL AND t.por_defecto))) AS personas
         FROM turnos t ORDER BY t.por_defecto DESC, t.inicio, t.nombre`);
    res.json({ turnos: rows });
  }));
  const leerTurno = (b) => {
    const ini = Number(b.inicio); const fin = Number(b.fin);
    if (!String(b.nombre || '').trim()) throw fallo(400, 'Pon un nombre al turno');
    if (!(ini >= 0 && fin <= 24 && fin > ini)) throw fallo(400, 'Horas del turno no válidas (de 0 a 24, el fin después del inicio)');
    return { nombre: String(b.nombre).trim().slice(0, 60), inicio: ini, fin };
  };
  app.post('/api/turnos', auth.permiso('recursos'), asyncH(async (req, res) => {
    const t = leerTurno(req.body || {});
    const { rows } = await query('INSERT INTO turnos (nombre, inicio, fin) VALUES ($1, $2, $3) RETURNING id', [t.nombre, t.inicio, t.fin])
      .catch((e) => { throw e.code === '23505' ? fallo(400, 'Ya hay un turno con ese nombre') : e; });
    res.json({ id: rows[0].id });
  }));
  app.put('/api/turnos/:id', auth.permiso('recursos'), asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const t = leerTurno(b);
    await tx(async (c) => {
      if (b.por_defecto) await c.query('UPDATE turnos SET por_defecto = FALSE WHERE por_defecto AND id <> $1', [id]);
      const { rowCount } = await c.query(
        `UPDATE turnos SET nombre = $2, inicio = $3, fin = $4, por_defecto = CASE WHEN $5 THEN TRUE ELSE por_defecto END WHERE id = $1`,
        [id, t.nombre, t.inicio, t.fin, !!b.por_defecto]).catch((e) => { throw e.code === '23505' ? fallo(400, 'Ya hay un turno con ese nombre') : e; });
      if (!rowCount) throw fallo(404, 'Turno no encontrado');
    });
    res.json({ ok: true });
  }));
  app.delete('/api/turnos/:id', auth.permiso('recursos'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT por_defecto FROM turnos WHERE id = $1', [id]);
    if (!rows.length) throw fallo(404, 'Turno no encontrado');
    if (rows[0].por_defecto) throw fallo(400, 'Es el turno por defecto: marca otro como por defecto antes de quitarlo');
    await query('UPDATE recursos SET turno_id = NULL WHERE turno_id = $1', [id]);
    await query('DELETE FROM turnos WHERE id = $1', [id]);
    res.json({ ok: true });
  }));

  // Deshacer un excedente (la tarea vuelve a la estimación de antes)
  app.delete('/api/excedentes/:id', auth.permiso('planificar'), asyncH(async (req, res) => {
    await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM tarea_excedentes WHERE id = $1 AND NOT deshecho FOR UPDATE', [Number(req.params.id)]);
      if (!rows.length) throw fallo(404, 'Ya estaba deshecho');
      await c.query('UPDATE tareas SET duracion_h = GREATEST(0.5, duracion_h - $2) WHERE id = $1', [rows[0].tarea_id, rows[0].horas]);
      await c.query('UPDATE tarea_excedentes SET deshecho = TRUE WHERE id = $1', [rows[0].id]);
    });
    res.json({ ok: true });
  }));

  // Pedir (con el motivo) las extra que acaba de crear un cambio del tablero
  app.post('/api/tramos/:id/horas-extra/pedir', auth.permiso('planificar'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const motivo = String(req.body?.motivo || '').trim().slice(0, 500) || null;
    const { rowCount } = await query(
      `UPDATE horas_extra SET motivo = COALESCE($2, motivo), avisado = TRUE WHERE tramo_id = $1 AND estado = 'pendiente'`, [id, motivo]);
    if (rowCount) await avisarAutorizadores(id, req.usuario);
    res.json({ ok: true, pedidas: rowCount });
  }));
  // «Solo hasta el fin del turno»: recorta a los turnos de cada uno lo que esté sin autorizar
  app.post('/api/tramos/:id/horas-extra/recortar', auth.permiso('planificar'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const out = await tx(async (c) => {
      const { rows } = await c.query(`SELECT recurso_id FROM horas_extra WHERE tramo_id = $1 AND estado = 'pendiente'`, [id]);
      await recortar(c, id, rows.map((r) => r.recurso_id));
      return sincronizar(c, id, req.usuario);
    });
    res.json({ ok: true, extras: out });
  }));

  // Lista para decidir: pendientes (agrupadas por tramo), hechas sin autorizar, y lo decidido del mes
  app.get('/api/horas-extra', asyncH(async (req, res) => {
    const u = req.usuario;
    if (!auth.tiene(u, 'autorizar_horas_extra') && !auth.tiene(u, 'planificar')) throw fallo(403, 'No tienes permiso');
    const vista = req.query.vista || 'pendientes';
    if (vista === 'pendientes') {
      const { rows } = await query(`${SQL_LISTA} WHERE he.estado = 'pendiente' ORDER BY he.fecha, he.desde, r.nombre`);
      return res.json({ peticiones: agrupar(rows), puedo: auth.tiene(u, 'autorizar_horas_extra') });
    }
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes
      : new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7);
    const desde = `${mes}-01`;
    const hasta = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0)).toISOString().slice(0, 10);
    if (vista === 'sin_autorizar') {
      const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
      return res.json({ dias: await sinAutorizar(`${Number(hoy.slice(0, 4)) - 1}${hoy.slice(4)}`, hoy), puedo: auth.tiene(u, 'autorizar_horas_extra') });
    }
    const { rows } = await query(`${SQL_LISTA} WHERE he.fecha BETWEEN $1 AND $2 AND he.estado <> 'pendiente' ORDER BY he.fecha DESC, r.nombre`, [desde, hasta]);
    const porPersona = new Map();
    for (const x of rows.filter((y) => y.estado === 'autorizada')) porPersona.set(x.recurso, r2((porPersona.get(x.recurso) || 0) + x.horas));
    res.json({ mes, decididas: agrupar(rows), por_persona: [...porPersona].map(([nombre, horas]) => ({ nombre, horas })).sort((a, b) => b.horas - a.horas) });
  }));

  // Autorizar o no (una persona, o varias a la vez: ids)
  app.post('/api/horas-extra/decidir', puedeDecidir, asyncH(async (req, res) => {
    const b = req.body || {};
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Boolean);
    const si = b.decision === 'si';
    const nota = String(b.nota || '').trim().slice(0, 500) || null;
    if (!ids.length) throw fallo(400, 'Nada que decidir');
    if (!si && !nota) throw fallo(400, 'Di el motivo (lo verá quien lo pidió)');
    const hechas = await tx(async (c) => {
      const { rows } = await c.query(`SELECT * FROM horas_extra WHERE id = ANY($1) AND estado = 'pendiente' FOR UPDATE`, [ids]);
      if (!rows.length) throw fallo(409, 'Ya estaba decidido');
      await c.query(`UPDATE horas_extra SET estado = $2, nota = $3, decidido_por = $4, decidido_en = now() WHERE id = ANY($1)`,
        [rows.map((r) => r.id), si ? 'autorizada' : 'rechazada', nota, req.usuario.id]);
      if (!si) {
        const porTramo = new Map();
        for (const r of rows.filter((x) => x.tramo_id)) porTramo.set(r.tramo_id, [...(porTramo.get(r.tramo_id) || []), r.recurso_id]);
        for (const [tramo, recs] of porTramo) {
          const { rows: cerr } = await c.query('SELECT 1 FROM tramo_cierres WHERE tramo_id = $1', [tramo]);
          if (!cerr.length) await recortar(c, tramo, recs);
        }
      }
      return rows;
    });
    // avisos: a quien lo pidió y a los operarios
    const { rows: info } = await query(`${SQL_LISTA} WHERE he.id = ANY($1)`, [hechas.map((h) => h.id)]);
    for (const g of agrupar(info)) {
      const txt = textoPeticion(g);
      const pidio = hechas.find((h) => h.id === g.ids[0])?.pedido_por;
      if (pidio && pidio !== req.usuario.id) {
        notif.avisarLuego([pidio], 'horas_extra', { titulo: si ? '✔ Horas extra autorizadas' : '✗ Horas extra no autorizadas',
          cuerpo: `${txt}${!si ? ` · «${nota}» · el tramo vuelve al fin de turno` : ''}`, url: g.fecha ? `/?fecha=${String(g.fecha).slice(0, 10)}` : '/', tag: `he-${g.tramo_id || g.id}` });
      }
      if (g.origen === 'plan') {
        for (const p of g.personas) {
          const { rows: us } = await query('SELECT id FROM usuarios WHERE recurso_id = $1 AND activo', [p.id]);
          if (us.length) notif.avisarLuego(us.map((x) => x.id), 'plan', { titulo: si ? '⏱ Horas extra autorizadas' : 'Sin horas extra',
            cuerpo: si ? `${ddmm(g.fecha)} ${hhmm(p.desde)}–${hhmm(p.hasta)}${g.tarea_codigo ? ` · ${g.tarea_codigo} ${g.tarea}` : ''}`
              : `${ddmm(g.fecha)}: terminas a tu hora${g.tarea_codigo ? ` (${g.tarea_codigo} ${g.tarea})` : ''}`,
            url: `/mi-dia.html?fecha=${String(g.fecha).slice(0, 10)}`, tag: `he-${g.tramo_id}-${p.id}` });
        }
      }
    }
    res.json({ ok: true, n: hechas.length });
  }));

  // Hechas sin autorizar (del parte): Dirección dice sí (cuentan como extra) o no (se pagan sin recargo)
  app.post('/api/horas-extra/parte', puedeDecidir, asyncH(async (req, res) => {
    const b = req.body || {};
    const recurso = Number(b.recurso_id); const fecha = String(b.fecha || '').slice(0, 10);
    const si = b.decision === 'si';
    const nota = String(b.nota || '').trim().slice(0, 500) || null;
    if (!recurso || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw fallo(400, 'Falta la persona o el día');
    if (!si && !nota) throw fallo(400, 'Di el motivo');
    const [d] = (await sinAutorizar(fecha, fecha)).filter((x) => x.recurso_id === recurso);
    if (!d) throw fallo(409, 'No hay horas sin autorizar ese día');
    await query(
      `INSERT INTO horas_extra (recurso_id, fecha, horas, origen, estado, nota, pedido_por, decidido_por, decidido_en, avisado)
       VALUES ($1, $2, $3, 'parte', $4, $5, $6, $6, now(), TRUE)`, [recurso, fecha, d.horas, si ? 'autorizada' : 'rechazada', nota, req.usuario.id]);
    res.json({ ok: true, horas: d.horas });
  }));
}

module.exports = { montar, sincronizar, recortar, turnoDe, fuera, SQL_TURNO, SQL_EXTRA_DIA, sinAutorizar, resumenReal, contarPendientes, avisarAutorizadores };
