// Supervisar desde el móvil (Mi día › Menú › Supervisar), para encargados, logística, Operaciones y Dirección:
//  · Recibir: envíos que llegan a Menorca (por línea y bultos, albarán, fotos, lo que falta) y piezas que trae un taller.
//  · Parte de hoy: lo apuntado por cada operario; confirmar uno a uno o todo lo que no tiene avisos (usa /api/parte
//    y /api/tramos/:id/cierre, como en el ordenador).
//  · Aprobar: pedidos por encima del límite, vacaciones (paso de Operaciones o de RRHH) y compras locales.
//  · Dónde está cada cosa: OTs con algo fuera (taller o envío), con retrasos y cuándo se necesita aquí.
// Este archivo da lo que no había: el resumen del menú, la lista de recibir y recibir, y «dónde está».
const { query, tx } = require('./db');
const auth = require('./auth');
const notif = require('./notificaciones');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');

const puede = {
  recibir: (u) => auth.tiene(u, 'logistica') || auth.tiene(u, 'planificar'),
  parte: (u) => auth.tiene(u, 'planificar'),
  aprobar: (u) => ['aprobar_compras', 'vacaciones_ops', 'vacaciones_rrhh', 'autorizar_compras_locales', 'autorizar_horas_extra'].some((k) => auth.tiene(u, k)),
  donde: (u) => auth.tiene(u, 'planificar') || auth.tiene(u, 'proyectos'),
};

/* ---------- Recibir ---------- */
async function porRecibir() {
  const { rows: envios } = await query(
    `SELECT e.id, e.codigo, e.estado, e.llegada_prevista::text AS llegada, e.entregar_en, e.ref_transportista, e.num_albaran, CASE WHEN e.incidencia_resuelta THEN NULL ELSE e.incidencia END AS incidencia, e.fechas, p.nombre AS transportista,
            (SELECT count(*)::int FROM archivos a WHERE a.ref_tipo = 'envio' AND a.ref_id = e.id) AS n_archivos
       FROM envios e LEFT JOIN proveedores p ON p.id = e.transportista_id
      WHERE e.estado IN ('en_barco', 'en_mao') ORDER BY (e.estado = 'en_mao') DESC, e.llegada_prevista NULLS LAST, e.id`);
  for (const e of envios) {
    const { rows } = await query(
      `SELECT l.id, l.descripcion, l.origen, l.bultos, l.kg::float AS kg, l.recibido_en, l.bultos_recibidos, l.orden_id, l.tarea_id, l.pedido_id,
              o.codigo AS ot_codigo, o.titulo AS ot_titulo, pc.codigo AS pedido_codigo,
              (SELECT min(x.fecha)::text FROM tareas t2 JOIN tramos x ON x.tarea_id = t2.id JOIN tareas t ON t.id = l.tarea_id
                WHERE t2.orden_id = l.orden_id AND t2.orden_en_of > t.orden_en_of AND t2.proveedor_id IS NULL) AS se_necesita
         FROM envio_lineas l LEFT JOIN ordenes o ON o.id = l.orden_id LEFT JOIN pedidos_compra pc ON pc.id = l.pedido_id
        WHERE l.envio_id = $1 ORDER BY l.orden, l.id`, [e.id]);
    e.lineas = rows;
  }
  // piezas que un taller dice haber entregado «a nosotros» (o terminado sin transportista detrás) y aún no recibidas
  const { rows: piezas } = await query(
    `SELECT t.id, t.codigo, t.nombre, t.orden_id, o.codigo AS ot_codigo, o.titulo AS ot_titulo, pv.nombre AS taller,
            t.ext_entrega_fecha::text AS entrega_fecha, t.ext_entrega_nota AS entrega_nota, t.ext_estado,
            (SELECT min(x.fecha)::text FROM tareas t2 JOIN tramos x ON x.tarea_id = t2.id
              WHERE t2.orden_id = t.orden_id AND t2.orden_en_of > t.orden_en_of AND t2.proveedor_id IS NULL) AS se_necesita
       FROM tareas t JOIN proveedores pv ON pv.id = t.proveedor_id AND NOT pv.transportista JOIN ordenes o ON o.id = t.orden_id AND o.estado <> 'cerrada'
      WHERE t.ext_entregado_a = 'nosotros' AND t.ext_recibido_en IS NULL AND NOT t.baja_presupuesto
        AND t.ext_entrega_fecha > now() - interval '60 days'
      ORDER BY t.ext_entrega_fecha, t.id`);
  return { envios, piezas };
}

// Recibir un envío: { lineas: [{ id, recibido, bultos }], num_albaran, archivos: [ids], incidencia }
async function recibirEnvio(req, id) {
  const b = req.body || {};
  let completo = false; let e;
  const marcadas = (Array.isArray(b.lineas) ? b.lineas : []).filter((l) => l && l.recibido);
  const inc = texto(b.incidencia, 500);
  if (!marcadas.length && !inc) throw fallo(400, 'Marca lo que ha llegado');
  await tx(async (c) => {
    const { rows } = await c.query('SELECT * FROM envios WHERE id = $1 FOR UPDATE', [id]);
    e = rows[0];
    if (!e || ['anulado', 'entregado'].includes(e.estado)) throw fallo(400, 'Este envío ya no está por recibir');
    for (const l of marcadas) {
      const bu = Number(l.bultos);
      const { rows: ln } = await c.query(
        `UPDATE envio_lineas SET recibido_en = COALESCE(recibido_en, now()), recibido_por = $3, bultos_recibidos = $4
          WHERE id = $1 AND envio_id = $2 RETURNING pedido_id`,
        [Number(l.id), id, req.usuario.id, Number.isInteger(bu) && bu >= 0 ? bu : null]);
      // el material del pedido queda recibido
      if (ln[0]?.pedido_id) {
        await c.query(`UPDATE partida_escandallo SET compra = 'recibido', recibido_por = $2, recibido_en = now(), num_albaran = COALESCE($3, num_albaran)
                        WHERE pedido_compra_id = $1 AND compra = 'pedido'`, [ln[0].pedido_id, req.usuario.id, texto(b.num_albaran, 60)]);
      }
    }
    await c.query(`UPDATE envios SET num_albaran = COALESCE($2, num_albaran), incidencia = COALESCE($3, incidencia), incidencia_resuelta = CASE WHEN $3 IS NULL THEN incidencia_resuelta ELSE false END WHERE id = $1`,
      [id, texto(b.num_albaran, 60), inc]);
    if (Array.isArray(b.archivos) && b.archivos.length) {
      await c.query(`UPDATE archivos SET ref_tipo = 'envio', ref_id = $1 WHERE id = ANY($2) AND creado_por = $3 AND ref_tipo IS NULL`,
        [id, b.archivos.map(Number).filter(Number.isInteger), req.usuario.id]);
    }
    const { rows: falta } = await c.query('SELECT count(*)::int AS n FROM envio_lineas WHERE envio_id = $1 AND recibido_en IS NULL', [id]);
    completo = falta[0].n === 0;
  });
  // todo recibido: el envío queda entregado (tareas de transporte hechas, situación de la OT…)
  if (completo) {
    const tr = require('./transportes');
    await tx(async (c) => {
      const { rows } = await c.query('SELECT *, llegada_prevista::text AS llegada_prevista FROM envios WHERE id = $1', [id]);
      await tr.aplicarEstado(c, rows[0], 'entregado', req.usuario.nombre);
    });
  }
  const { rows: ls } = await query(`SELECT l.descripcion, l.bultos, l.bultos_recibidos, l.recibido_en FROM envio_lineas l WHERE l.envio_id = $1`, [id]);
  const cortos = ls.filter((l) => l.recibido_en && l.bultos && l.bultos_recibidos != null && l.bultos_recibidos < l.bultos);
  notif.avisarLuego(notif.conPermiso('planificar', 'logistica'), 'ext_seguimiento', {
    titulo: `📦 ${e.codigo} ${completo ? 'recibido' : 'recibido en parte'}${inc || cortos.length ? ' ⚠' : ''}`,
    cuerpo: [inc ? `«${inc}»` : null, cortos.length ? cortos.map((l) => `${l.descripcion}: ${l.bultos_recibidos}/${l.bultos} bultos`).join(' · ') : null,
      `por ${req.usuario.nombre}`].filter(Boolean).join(' · ').slice(0, 250),
    url: `/compras.html?vista=transportes&envio=${id}`, tag: `envio-${id}`,
  });
  require('./eventos').emitir({ ruta: 'envios', quien: req.usuario.nombre });
  return { ok: true, completo };
}

// Recibir una pieza que trae un taller: { nota, archivos: [ids] }
async function recibirPieza(req, tareaId) {
  const b = req.body || {};
  const { rows } = await query(
    `UPDATE tareas SET ext_recibido_en = now(), ext_recibido_por = $2, ext_recepcion_nota = $3 WHERE id = $1 AND proveedor_id IS NOT NULL AND ext_recibido_en IS NULL
     RETURNING id, codigo, nombre, orden_id`, [tareaId, req.usuario.id, texto(b.nota, 300)]);
  if (!rows.length) throw fallo(400, 'Esta pieza ya está recibida');
  const t = rows[0];
  if (Array.isArray(b.archivos) && b.archivos.length) {
    await query(`UPDATE archivos SET ref_tipo = 'ext_foto', ref_id = $1 WHERE id = ANY($2) AND creado_por = $3 AND ref_tipo IS NULL`,
      [t.id, b.archivos.map(Number).filter(Number.isInteger), req.usuario.id]);
  }
  await query('INSERT INTO ext_novedades (tarea_id, texto) VALUES ($1,$2)', [t.id, `📦 recibido en HAM por ${req.usuario.nombre}${b.nota ? ` · «${texto(b.nota, 200)}»` : ''}`]);
  notif.avisarLuego(notif.conPermiso('planificar'), 'ext_seguimiento', {
    titulo: `📦 Recibido: ${t.codigo} ${t.nombre}`, cuerpo: `por ${req.usuario.nombre}${b.nota ? ` · «${texto(b.nota, 150)}»` : ''}`,
    url: `/proyectos.html?ot=${t.orden_id}`, tag: `pieza-${t.id}`,
  });
  return { ok: true };
}

/* ---------- Dónde está cada cosa ---------- */
async function donde() {
  const { rows } = await query(
    `SELECT DISTINCT o.id, o.codigo, o.titulo, pr.obra, pr.cliente
       FROM ordenes o JOIN tareas t ON t.orden_id = o.id AND t.proveedor_id IS NOT NULL AND NOT t.baja_presupuesto
       LEFT JOIN proyectos pr ON pr.id = o.proyecto_id
      WHERE o.estado <> 'cerrada' AND (t.estado <> 'hecha' OR t.hecha_en > now() - interval '7 days'
            OR EXISTS (SELECT 1 FROM envio_lineas l JOIN envios e ON e.id = l.envio_id WHERE l.orden_id = o.id AND e.estado NOT IN ('entregado','anulado')))`);
  if (!rows.length) return [];
  const sits = await require('./externos').situaciones(rows.map((r) => r.id));
  const { rows: sig } = await query(
    `SELECT t.orden_id, min(x.fecha)::text AS fecha FROM tareas t JOIN tramos x ON x.tarea_id = t.id
      WHERE t.orden_id = ANY($1) AND t.proveedor_id IS NULL AND t.estado <> 'hecha' AND x.fecha >= $2::date GROUP BY t.orden_id`,
    [rows.map((r) => r.id), hoyMadrid()]);
  const sigMap = new Map(sig.map((s) => [s.orden_id, s.fecha]));
  const out = rows.map((r) => ({ ...r, situacion: sits.get(r.id) || null, aqui: sigMap.get(r.id) || null }))
    .filter((r) => r.situacion && r.situacion.nivel !== 'vuelto');
  const orden = { fuera: 0, listo: 1, pendiente: 2 };
  return out.sort((a, b) => (!!b.situacion.retraso - !!a.situacion.retraso) || (orden[a.situacion.nivel] - orden[b.situacion.nivel]) || String(a.aqui || '9').localeCompare(String(b.aqui || '9')));
}

/* ---------- Resumen para el menú ---------- */
async function resumen(u) {
  const out = {};
  const q1 = async (sql, p = []) => (await query(sql, p)).rows[0];
  if (puede.recibir(u)) {
    const r = await porRecibir();
    out.recibir = { n: r.envios.filter((e) => e.estado === 'en_mao').length + r.piezas.length, en_camino: r.envios.filter((e) => e.estado === 'en_barco').length,
      txt: [...r.envios.filter((e) => e.estado === 'en_mao').map((e) => `${e.codigo} en Maó`), ...r.piezas.map((p) => `pieza de ${p.taller}`)].slice(0, 2).join(' · ') };
  }
  if (puede.parte(u)) {
    const hoy = hoyMadrid();
    const r = await q1(
      `SELECT (SELECT count(*)::int FROM tramos x WHERE x.fecha = $1 AND x.cierre IS NULL
                 AND EXISTS (SELECT 1 FROM declaraciones d WHERE d.tramo_id = x.id AND NOT COALESCE(d.resuelto IS NOT NULL, false))) AS por_confirmar,
              (SELECT count(*)::int FROM declaraciones d WHERE d.fecha = $1 AND d.tipo <> 'tramo' AND d.resuelto IS NULL) AS extra,
              (SELECT count(*)::int FROM dias_enviados v WHERE v.fecha = $1) AS enviaron,
              (SELECT count(DISTINCT a.recurso_id)::int FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id JOIN recursos r ON r.id = a.recurso_id AND r.tipo = 'operario'
                JOIN usuarios u ON u.recurso_id = r.id AND u.pin_hash IS NOT NULL AND u.activo
                WHERE x.fecha = $1 AND NOT EXISTS (SELECT 1 FROM declaraciones d WHERE d.recurso_id = a.recurso_id AND d.fecha = $1)) AS sin_apuntar`, [hoy]).catch((e) => { console.warn('resumen parte', e.message); return null; });
    out.parte = r;
  }
  if (puede.aprobar(u)) {
    const a = { pedidos: 0, vacaciones: 0, locales: 0, extras: 0 };
    if (auth.tiene(u, 'autorizar_horas_extra')) a.extras = await require('./horas-extra').contarPendientes();
    if (auth.tiene(u, 'aprobar_compras')) a.pedidos = (await q1(`SELECT count(*)::int AS n FROM pedidos_compra WHERE estado = 'por_aprobar'`)).n;
    if (auth.tiene(u, 'vacaciones_ops')) a.vacaciones += (await q1(`SELECT count(*)::int AS n FROM solicitudes_vacaciones WHERE estado = 'pendiente_ops'`)).n;
    if (auth.tiene(u, 'vacaciones_rrhh')) a.vacaciones += (await q1(`SELECT count(*)::int AS n FROM solicitudes_vacaciones WHERE estado = 'pendiente_rrhh'`)).n;
    if (auth.tiene(u, 'autorizar_compras_locales')) a.locales = (await q1(`SELECT count(*)::int AS n FROM compras_locales WHERE estado = 'pendiente'`)).n;
    out.aprobar = a;
  }
  if (puede.donde(u)) {
    const d = await donde();
    out.donde = { n: d.length, retrasos: d.filter((x) => x.situacion.retraso).length, envios: d.filter((x) => x.situacion.envio).length };
  }
  return out;
}

function montar(app, asyncH) {
  const exige = (k) => (req, res, next) => (puede[k](req.usuario) ? next() : next(fallo(403, 'Tu rol no tiene acceso a esto')));
  app.get('/api/supervision/resumen', asyncH(async (req, res) => res.json(await resumen(req.usuario))));
  app.get('/api/supervision/recibir', exige('recibir'), asyncH(async (req, res) => res.json(await porRecibir())));
  app.post('/api/envios/:id/recibir', exige('recibir'), asyncH(async (req, res) => res.json(await recibirEnvio(req, Number(req.params.id)))));
  app.post('/api/tareas/:id/recibir-pieza', exige('recibir'), asyncH(async (req, res) => res.json(await recibirPieza(req, Number(req.params.id)))));
  app.get('/api/supervision/donde', exige('donde'), asyncH(async (req, res) => res.json({ ots: await donde(), hoy: hoyMadrid() })));
}

module.exports = { montar };
