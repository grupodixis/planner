// Transportes península → Menorca. Un ENVÍO (ENV-AAAA-NNNN) es un viaje de un transportista (Ydica, Tragina…) que
// recoge en uno o varios sitios de la península y lo trae a Menorca. Lleva:
//  · piezas de OTs: la tarea de transporte de la OT (la hace un proveedor marcado «transportista»), cuando lo de antes
//    ya está hecho o entregado al transportista (el taller lo dice en su enlace de seguimiento);
//  · pedidos de material enviados a proveedores de península (zona 'peninsula') que aún no han llegado;
//  · líneas sueltas.
// Estados: preparando → recogido → en_barco → en_mao (almacén del transportista en Maó) → entregado (taller u obra).
// El transportista los marca en su enlace (sin cuenta), con fecha de llegada, su referencia y foto del CMR; también la
// oficina. Efectos: la tarea de transporte va en curso / hecha y su fecha prevista es la llegada (avisos del tablero
// por dependencias); el material de los pedidos pasa a llegar ese día; la situación de la OT dice dónde está.
// Coste del envío: se reparte entre sus líneas por kg (o a mano) y entra en costes como subcontrata de la tarea.
const crypto = require('crypto');
const express = require('express');
const { query, tx } = require('./db');
const auth = require('./auth');
const correo = require('./correo');
const notif = require('./notificaciones');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10)) ? String(v).slice(0, 10) : null);
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const horaMadrid = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
const ESTADOS = ['preparando', 'recogido', 'en_barco', 'en_mao', 'entregado'];
const ESTADO_TXT = { preparando: 'preparando', recogido: 'recogido', en_barco: 'en barco', en_mao: 'en Maó', entregado: 'entregado', anulado: 'anulado' };
const TIPOS_ARCH = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

let ultimaBase = '';
function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (req) ultimaBase = `${req.protocol}://${req.get('host')}`;
  return ultimaBase;
}
const firma = (id, nonce) => correo.firmar(`envio:${id}:${nonce}`);
const urlDe = (e, req) => `${baseUrl(req)}/envio.html?t=${e.id}.${firma(e.id, e.nonce)}`;

async function siguienteCodigo(c) {
  const y = new Date().getFullYear();
  const { rows } = await c.query(`SELECT max(substring(codigo from '\\d+$')::int) AS n FROM envios WHERE codigo LIKE $1`, [`ENV-${y}-%`]);
  return `ENV-${y}-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}

/* ---------- lo que espera a ir a Menorca ---------- */
async function pendientes() {
  // tareas de transporte (las hace un transportista) aún no en un envío; «listo» si lo anterior de fuera está hecho
  const { rows: ots } = await query(
    `SELECT t.id AS tarea_id, t.codigo, t.nombre, t.orden_id, o.codigo AS ot_codigo, o.titulo AS ot_titulo, pr.codigo AS proyecto,
            t.proveedor_id AS transportista_id, tp.nombre AS transportista, t.ext_recibido::text AS recibido,
            (SELECT min(x.fecha)::text FROM tramos x WHERE x.tarea_id = t.id) AS plan_desde,
            prev.id AS prev_id, prev.codigo AS prev_codigo, prev.nombre AS prev_nombre, prev.estado AS prev_estado, pv.nombre AS prev_taller,
            pv.localidad AS prev_localidad, prev.ext_fin_prevista::text AS prev_fin, prev.ext_entrega_nota AS prev_nota, prev.ext_entrega_fecha::text AS prev_entrega,
            (SELECT max(x.fecha)::text FROM tramos x WHERE x.tarea_id = prev.id) AS prev_plan_fin
       FROM tareas t JOIN proveedores tp ON tp.id = t.proveedor_id AND tp.transportista
       JOIN ordenes o ON o.id = t.orden_id AND o.estado <> 'cerrada' LEFT JOIN proyectos pr ON pr.id = o.proyecto_id
       LEFT JOIN LATERAL (SELECT p2.* FROM tareas p2 JOIN proveedores q ON q.id = p2.proveedor_id AND NOT q.transportista
                           WHERE p2.orden_id = t.orden_id AND p2.orden_en_of < t.orden_en_of AND NOT p2.baja_presupuesto
                           ORDER BY p2.orden_en_of DESC, p2.id DESC LIMIT 1) prev ON true
       LEFT JOIN proveedores pv ON pv.id = prev.proveedor_id
      WHERE t.estado <> 'hecha' AND NOT t.baja_presupuesto
        AND NOT EXISTS (SELECT 1 FROM envio_lineas l JOIN envios e ON e.id = l.envio_id WHERE l.tarea_id = t.id AND e.estado <> 'anulado')
      ORDER BY o.codigo, t.orden_en_of`);
  for (const r of ots) r.listo = !!r.recibido || !r.prev_id || r.prev_estado === 'hecha';
  // pedidos que trae un transportista nuestro: recogida en un domicilio, en el almacén del transportista (Idyca Gavà, Luchana…)
  // o, si no se ha dicho cómo llega, los de proveedores de península; enviados y aún sin llegar ni en un envío
  const { rows: pedidos } = await query(
    `SELECT c.id AS pedido_id, c.codigo, c.fecha_entrega::text AS fecha_entrega, c.referencia, p.nombre AS proveedor, p.localidad,
            c.entrega_modo, c.transportista_id, tp.nombre AS transportista, a.nombre AS almacen, c.fecha_almacen::text AS fecha_almacen,
            c.entregado_almacen::text AS entregado_almacen, c.recogida_direccion, c.recogida_fecha::text AS recogida_fecha,
            c.listo_recogida::text AS listo_recogida, c.bultos, c.kg::float AS kg,
            (SELECT count(*)::int FROM pedido_compra_lineas l WHERE l.pedido_id = c.id) AS n_lineas,
            (SELECT string_agg(DISTINCT pr.codigo, ', ') FROM pedido_compra_lineas l JOIN partida_escandallo e ON e.id = l.escandallo_id
               JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos pr ON pr.id = pa.proyecto_id WHERE l.pedido_id = c.id) AS proyectos
       FROM pedidos_compra c JOIN proveedores p ON p.id = c.proveedor_id
       LEFT JOIN proveedores tp ON tp.id = c.transportista_id LEFT JOIN transportista_almacenes a ON a.id = c.almacen_id
      WHERE c.estado = 'enviado' AND c.enviado_en > now() - interval '120 days'
        AND (c.entrega_modo IN ('recogida','almacen') OR (c.entrega_modo IS NULL AND c.tipo = 'material' AND p.zona = 'peninsula'))
        AND (c.tipo <> 'material' OR EXISTS (SELECT 1 FROM partida_escandallo e WHERE e.pedido_compra_id = c.id AND e.compra = 'pedido'))
        AND NOT EXISTS (SELECT 1 FROM envio_lineas l JOIN envios e ON e.id = l.envio_id WHERE l.pedido_id = c.id AND e.estado <> 'anulado')
      ORDER BY c.entregado_almacen NULLS LAST, c.fecha_entrega NULLS LAST, c.id`);
  for (const r of pedidos) r.listo = r.entrega_modo !== 'almacen' || !!r.entregado_almacen;
  // lo traen los proveedores (su transporte o agencia), aún sin llegar
  const { rows: traen } = await query(
    `SELECT c.id AS pedido_id, c.codigo, c.fecha_entrega::text AS fecha_entrega, p.nombre AS proveedor, c.agencia, c.agencia_otra, c.tracking,
            c.seg_activo, c.prov_confirmado_en, c.incidencia_trp_id,
            (SELECT string_agg(DISTINCT pr.codigo, ', ') FROM pedido_compra_lineas l JOIN partida_escandallo e ON e.id = l.escandallo_id
               JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos pr ON pr.id = pa.proyecto_id WHERE l.pedido_id = c.id) AS proyectos
       FROM pedidos_compra c JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.estado = 'enviado' AND c.entrega_modo = 'proveedor' AND c.enviado_en > now() - interval '120 days'
        AND (c.tipo <> 'material' OR EXISTS (SELECT 1 FROM partida_escandallo e WHERE e.pedido_compra_id = c.id AND e.compra = 'pedido'))
      ORDER BY c.fecha_entrega NULLS LAST, c.id`);
  const pt = require('./pedido-transporte');
  for (const r of traen) r.tracking_url = pt.urlTracking(r.agencia, r.tracking);
  return { ots, pedidos, traen };
}

/* ---------- un envío ---------- */
async function envio(id, c = { query }) {
  const { rows } = await c.query(
    `SELECT e.*, e.coste::float AS coste, e.recogida_prevista::text AS recogida_prevista, e.llegada_prevista::text AS llegada_prevista,
            p.nombre AS transportista, p.email AS transportista_email, u.nombre AS creado_por_nombre
       FROM envios e LEFT JOIN proveedores p ON p.id = e.transportista_id LEFT JOIN usuarios u ON u.id = e.creado_por WHERE e.id = $1`, [id]);
  if (!rows.length) return null;
  const e = rows[0];
  const { rows: ls } = await c.query(
    `SELECT l.*, l.kg::float AS kg, l.coste_manual::float AS coste_manual, o.codigo AS ot_codigo, o.titulo AS ot_titulo,
            t.codigo AS tarea_codigo, pc.codigo AS pedido_codigo,
            (SELECT min(x.fecha)::text FROM tareas t2 JOIN tramos x ON x.tarea_id = t2.id
              WHERE t2.orden_id = l.orden_id AND t2.orden_en_of > t.orden_en_of AND t2.proveedor_id IS NULL) AS siguiente_aqui
       FROM envio_lineas l LEFT JOIN ordenes o ON o.id = l.orden_id LEFT JOIN tareas t ON t.id = l.tarea_id
       LEFT JOIN pedidos_compra pc ON pc.id = l.pedido_id
      WHERE l.envio_id = $1 ORDER BY l.orden, l.id`, [id]);
  e.lineas = ls;
  repartir(e);
  e.archivos = (await c.query(`SELECT id, tipo, nombre, creado_por IS NULL AS del_transportista FROM archivos WHERE ref_tipo = 'envio' AND ref_id = $1 ORDER BY id`, [id])).rows;
  e.enlace = !!e.nonce && !!e.enviado_en;
  delete e.nonce;
  e.bultos = ls.reduce((s, l) => s + (l.bultos || 0), 0);
  e.kg = ls.reduce((s, l) => s + (l.kg || 0), 0);
  return e;
}
// Reparto del coste: por kg (si nadie tiene kg, a partes iguales) o a mano
function repartir(e) {
  const ls = e.lineas;
  const totalKg = ls.reduce((s, l) => s + (l.kg || 0), 0);
  for (const l of ls) {
    if (e.reparto === 'manual') l.coste = l.coste_manual;
    else if (e.coste == null) l.coste = null;
    else l.coste = Math.round((totalKg ? e.coste * (l.kg || 0) / totalKg : e.coste / ls.length) * 100) / 100;
  }
}

async function lineaDe(c, item, envioId) {
  if (item.tarea_id) {
    const { rows } = await c.query(
      `SELECT t.id, t.orden_id, o.codigo AS ot_codigo, o.titulo, pv.nombre AS taller, pv.localidad, prev.ext_entrega_nota AS nota
         FROM tareas t JOIN ordenes o ON o.id = t.orden_id
         LEFT JOIN LATERAL (SELECT p2.* FROM tareas p2 JOIN proveedores q ON q.id = p2.proveedor_id AND NOT q.transportista
                             WHERE p2.orden_id = t.orden_id AND p2.orden_en_of < t.orden_en_of ORDER BY p2.orden_en_of DESC LIMIT 1) prev ON true
         LEFT JOIN proveedores pv ON pv.id = prev.proveedor_id WHERE t.id = $1`, [Number(item.tarea_id)]);
    if (!rows.length) throw fallo(400, 'Tarea no encontrada');
    const r = rows[0];
    const { rows: ya } = await c.query(`SELECT e.codigo FROM envio_lineas l JOIN envios e ON e.id = l.envio_id WHERE l.tarea_id = $1 AND e.estado <> 'anulado' AND e.id <> $2`, [r.id, envioId || 0]);
    if (ya.length) throw fallo(400, `OT ${r.ot_codigo} ya va en ${ya[0].codigo}`);
    const bultos = /(\d+)\s*bult/i.exec(r.nota || ''); const kg = /(\d+(?:[.,]\d+)?)\s*kg/i.exec((r.nota || '').replace(/\./g, ''));
    return { orden_id: r.orden_id, tarea_id: r.id, descripcion: `OT ${r.ot_codigo} ${r.titulo}`, origen: r.taller ? `${r.taller}${r.localidad ? ` · ${r.localidad}` : ''}` : null,
      bultos: bultos ? Number(bultos[1]) : null, kg: kg ? Number(kg[1].replace(',', '.')) : null };
  }
  if (item.pedido_id) {
    const { rows } = await c.query(`SELECT c.id, c.codigo, p.nombre, p.localidad, c.referencia, c.entrega_modo, c.recogida_direccion, c.bultos, c.kg::float AS kg, a.nombre AS almacen
                                      FROM pedidos_compra c LEFT JOIN proveedores p ON p.id = c.proveedor_id LEFT JOIN transportista_almacenes a ON a.id = c.almacen_id WHERE c.id = $1`, [Number(item.pedido_id)]);
    if (!rows.length) throw fallo(400, 'Pedido no encontrado');
    const { rows: ya } = await c.query(`SELECT e.codigo FROM envio_lineas l JOIN envios e ON e.id = l.envio_id WHERE l.pedido_id = $1 AND e.estado <> 'anulado' AND e.id <> $2`, [rows[0].id, envioId || 0]);
    if (ya.length) throw fallo(400, `${rows[0].codigo} ya va en ${ya[0].codigo}`);
    return { pedido_id: rows[0].id, descripcion: `Pedido ${rows[0].codigo} · ${rows[0].nombre}${rows[0].referencia ? ` · ${rows[0].referencia}` : ''}`.slice(0, 300),
      origen: rows[0].entrega_modo === 'almacen' && rows[0].almacen ? `🏬 ${rows[0].almacen} (${rows[0].nombre})`
        : rows[0].entrega_modo === 'recogida' && rows[0].recogida_direccion ? `Recoger en ${rows[0].recogida_direccion}`.slice(0, 300)
          : `${rows[0].nombre}${rows[0].localidad ? ` · ${rows[0].localidad}` : ''}`,
      bultos: rows[0].bultos ?? null, kg: rows[0].kg ?? null };
  }
  const d = texto(item.descripcion, 300);
  if (!d) throw fallo(400, 'Falta qué va');
  return { descripcion: d, origen: texto(item.origen, 200) };
}
async function insertarLinea(c, envioId, l) {
  const { rows } = await c.query('SELECT COALESCE(max(orden), -1) + 1 AS n FROM envio_lineas WHERE envio_id = $1', [envioId]);
  await c.query(`INSERT INTO envio_lineas (envio_id, orden_id, tarea_id, pedido_id, descripcion, origen, bultos, kg, orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [envioId, l.orden_id || null, l.tarea_id || null, l.pedido_id || null, l.descripcion, l.origen || null, l.bultos ?? null, l.kg ?? null, rows[0].n]);
}

// Cambia el estado (o la fecha de llegada) y lo lleva a las tareas, al material y a las novedades de las OTs
async function aplicar(c, e, { estado, fecha, llegada }, quien) {
  const cambios = [];
  const hoy = hoyMadrid();
  if (estado && estado !== e.estado) {
    if (!ESTADOS.includes(estado)) throw fallo(400, 'Estado no válido');
    const f = fechaOk(fecha) || hoy;
    await c.query(`UPDATE envios SET estado = $2, fechas = fechas || jsonb_build_object($2::text, $3::text) WHERE id = $1`, [e.id, estado, f]);
    cambios.push(`${ESTADO_TXT[estado]}${f !== hoy ? ` el ${ddmm(f)}` : ''}`);
    e.estado = estado;
  }
  if (llegada !== undefined) {
    const f = llegada ? fechaOk(llegada) : null;
    if (llegada && !f) throw fallo(400, 'Fecha de llegada no válida');
    if (f !== (e.llegada_prevista || null)) {
      await c.query('UPDATE envios SET llegada_prevista = $2 WHERE id = $1', [e.id, f]);
      if (f) cambios.push(`llega a Maó ~${ddmm(f)}${e.llegada_prevista ? ` (antes ${ddmm(e.llegada_prevista)})` : ''}`);
      e.llegada_prevista = f;
    }
  }
  if (!cambios.length) return null;
  const { rows: ls } = await c.query('SELECT * FROM envio_lineas WHERE envio_id = $1', [e.id]);
  const st = e.estado;
  for (const l of ls) {
    if (l.tarea_id) {
      // la tarea de transporte de la OT
      const hecha = st === 'entregado';
      await c.query(
        `UPDATE tareas SET ext_estado = $2, ext_fin_prevista = COALESCE($3, ext_fin_prevista), ext_actualizado = now(),
                estado = CASE WHEN $4 THEN 'hecha' WHEN $2 = 'en_curso' AND estado = 'pendiente' THEN 'en_curso' ELSE estado END,
                hecha_en = CASE WHEN $4 AND estado <> 'hecha' THEN now() ELSE hecha_en END,
                ext_entregado_a = CASE WHEN $4 THEN 'nosotros' ELSE ext_entregado_a END,
                ext_entrega_fecha = CASE WHEN $4 THEN $5::date ELSE ext_entrega_fecha END
          WHERE id = $1`,
        [l.tarea_id, hecha ? 'entregado' : st === 'preparando' ? 'sin_empezar' : 'en_curso', e.llegada_prevista, hecha, hoy]);
      // al recogerlo, lo de antes (el taller) queda entregado al transportista
      if (['recogido', 'en_barco', 'en_mao', 'entregado'].includes(st)) {
        await c.query(
          `UPDATE tareas p SET estado = 'hecha', hecha_en = COALESCE(hecha_en, now()), ext_estado = 'entregado', ext_actualizado = now(),
                  ext_entregado_a = COALESCE(ext_entregado_a, (SELECT nombre FROM proveedores WHERE id = $2)),
                  ext_entregado_proveedor_id = COALESCE(ext_entregado_proveedor_id, $2), ext_entrega_fecha = COALESCE(ext_entrega_fecha, $3::date)
            WHERE p.id = (SELECT p2.id FROM tareas p2 JOIN proveedores q ON q.id = p2.proveedor_id AND NOT q.transportista
                            JOIN tareas t ON t.id = $1
                           WHERE p2.orden_id = t.orden_id AND p2.orden_en_of < t.orden_en_of ORDER BY p2.orden_en_of DESC LIMIT 1)
              AND p.estado <> 'hecha'`, [l.tarea_id, e.transportista_id, hoy]);
      }
      await c.query('INSERT INTO ext_novedades (tarea_id, texto) VALUES ($1,$2)', [l.tarea_id, `🚚 ${e.codigo}: ${cambios.join(' · ')}${quien ? ` (${quien})` : ''}`]);
    }
    if (l.pedido_id && e.llegada_prevista) {
      // el material del pedido llega con el envío
      await c.query(`UPDATE partida_escandallo SET fecha_prevista = $2 WHERE pedido_compra_id = $1 AND compra = 'pedido'`, [l.pedido_id, e.llegada_prevista]);
    }
  }
  await c.query('UPDATE envios SET actualizado_en = now() WHERE id = $1', [e.id]);
  return cambios;
}

async function avisar(e, cambios, quien) {
  if (!cambios?.length) return;
  const ots = [...new Set(e.lineas.map((l) => l.ot_codigo).filter(Boolean))].map((x) => `OT ${x}`);
  const peds = e.lineas.map((l) => l.pedido_codigo).filter(Boolean);
  notif.avisarLuego(notif.conPermiso('planificar', 'logistica'), 'ext_seguimiento', {
    titulo: `🚚 ${e.codigo} ${quien ? `(${quien}) ` : ''}${cambios[0]}`,
    cuerpo: `${[...ots, ...peds].join(', ')}${cambios.length > 1 ? ` · ${cambios.slice(1).join(' · ')}` : ''}`.slice(0, 250),
    url: `/compras.html?vista=transportes&envio=${e.id}`, tag: `envio-${e.id}`,
  });
}

/* ---------- para otras pantallas ---------- */
// OTs que van en un envío activo: dónde están (para la situación del producto)
async function deOrdenes(ordenIds) {
  if (!ordenIds.length) return new Map();
  const { rows } = await query(
    `SELECT DISTINCT ON (l.orden_id) l.orden_id, e.id, e.codigo, e.estado, e.llegada_prevista::text AS llegada, p.nombre AS transportista
       FROM envio_lineas l JOIN envios e ON e.id = l.envio_id LEFT JOIN proveedores p ON p.id = e.transportista_id
      WHERE l.orden_id = ANY($1) AND e.estado NOT IN ('anulado')
      ORDER BY l.orden_id, e.creado DESC`, [ordenIds]);
  return new Map(rows.map((r) => [r.orden_id, r]));
}
// Coste de transporte por tarea (para el control de costes)
async function costePorTarea(tareaIds) {
  if (!tareaIds.length) return new Map();
  const { rows } = await query(
    `SELECT DISTINCT e.id FROM envios e JOIN envio_lineas l ON l.envio_id = e.id WHERE l.tarea_id = ANY($1) AND e.estado <> 'anulado'`, [tareaIds]);
  const out = new Map();
  for (const { id } of rows) {
    const e = await envio(id);
    for (const l of e.lineas) if (l.tarea_id && l.coste) out.set(l.tarea_id, (out.get(l.tarea_id) || 0) + l.coste);
  }
  return out;
}

/* ---------- correo y recordatorios ---------- */
async function correoTransportista(e, url, para) {
  const aj = await require('./compras').ajustes();
  const recoger = e.lineas.map((l) => `  · ${l.origen ? `${l.origen}: ` : ''}${l.descripcion}${l.bultos ? ` · ${l.bultos} bultos` : ''}${l.kg ? ` · ${l.kg} kg` : ''}`).join('\n');
  await correo.enviarOFallar({
    para,
    asunto: `Envío ${e.codigo} a Menorca · ${aj.empresa.nombre}`,
    texto: `Hola,\n\nOs pedimos el envío ${e.codigo} a Menorca${e.recogida_prevista ? `, con recogida prevista el ${ddmm(e.recogida_prevista)}` : ''}:\n${recoger}\n\n`
      + `${e.entregar_en ? `Entregar en: ${e.entregar_en}\n\n` : ''}${e.notas ? `${e.notas}\n\n` : ''}`
      + `Por favor, indicadnos en este enlace (sin usuario) cuándo lo recogéis, en qué barco sale, cuándo llega a Maó y la entrega, con vuestra referencia y el CMR:\n${url}\n\n`
      + `Gracias,\n${aj.empresa.nombre}${aj.empresa.telefono ? ` · ${aj.empresa.telefono}` : ''}`,
  });
}

async function recordatorios() {
  const hoy = hoyMadrid(); const h = horaMadrid();
  if (h < 9 || h >= 19 || [0, 6].includes(new Date(`${hoy}T12:00:00Z`).getUTCDay()) || !correo.configurado()) return;
  const { rows: fest } = await query('SELECT 1 FROM festivos WHERE fecha = $1', [hoy]);
  if (fest.length) return;
  const { rows } = await query(
    `SELECT id FROM envios WHERE email IS NOT NULL AND enviado_en IS NOT NULL AND (recordatorio_en IS NULL OR recordatorio_en < $1)
        AND ((estado = 'preparando' AND recogida_prevista < $1) OR (estado IN ('recogido','en_barco') AND llegada_prevista < $1))
        AND (actualizado_en IS NULL OR (actualizado_en AT TIME ZONE 'Europe/Madrid')::date < $1)`, [hoy]);
  const aj = rows.length ? await require('./compras').ajustes() : null;
  for (const { id } of rows) {
    const e = await envio(id);
    const { rows: n } = await query('SELECT nonce FROM envios WHERE id = $1', [id]);
    const url = urlDe({ id, nonce: n[0].nonce });
    await query('UPDATE envios SET recordatorio_en = $2, n_recordatorios = n_recordatorios + 1 WHERE id = $1', [id, hoy]);
    const que = e.estado === 'preparando' ? `la recogida estaba prevista el ${ddmm(e.recogida_prevista)}` : `la llegada a Maó estaba prevista el ${ddmm(e.llegada_prevista)}`;
    try {
      await correo.enviarOFallar({
        para: e.email, asunto: `¿Cómo va el envío ${e.codigo}?`,
        texto: `Hola,\n\nDel envío ${e.codigo} ${que} y no tenemos noticias. ¿Nos indicáis cómo va (o la fecha nueva)?\n${url}\n\n`
          + `Os lo recordaremos una vez al día hasta que lo actualicéis.\n\nGracias,\n${aj.empresa.nombre}`,
      });
      if (e.n_recordatorios === 0) avisar(e, [`sin noticias: ${que}`], null);
    } catch (er) { console.warn('recordatorio de envío', id, er.message); }
  }
}

/* ---------- API ---------- */
async function porToken(t, c = { query }) {
  const m = /^(\d{1,9})\.([A-Za-z0-9_-]{32})$/.exec(String(t || ''));
  const noVale = fallo(404, 'Este enlace no es válido o ya no está activo. Pídanos uno nuevo respondiendo a nuestro correo.');
  if (!m) throw noVale;
  const id = Number(m[1]);
  const { rows } = await c.query('SELECT id, nonce, estado FROM envios WHERE id = $1', [id]);
  if (!rows.length || rows[0].estado === 'anulado') throw noVale;
  const a = Buffer.from(firma(id, rows[0].nonce)); const b = Buffer.from(m[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw noVale;
  return envio(id, c);
}
async function vistaPublica(e) {
  const aj = await require('./compras').ajustes();
  return {
    empresa: { nombre: aj.empresa.nombre, telefono: aj.empresa.telefono, email: aj.empresa.email },
    codigo: e.codigo, transportista: e.transportista, estado: e.estado, fechas: e.fechas, hoy: hoyMadrid(),
    recogida_prevista: e.recogida_prevista, llegada_prevista: e.llegada_prevista, entregar_en: e.entregar_en, notas: e.notas,
    ref_transportista: e.ref_transportista, nota_transportista: e.nota_transportista,
    lineas: e.lineas.map((l) => ({ id: l.id, descripcion: l.descripcion, origen: l.origen, bultos: l.bultos, kg: l.kg, recogido: l.recogido })),
    archivos: e.archivos.map((a) => ({ id: a.id, tipo: a.tipo, nombre: a.nombre, mio: a.del_transportista })),
  };
}

function montarPublico(app, asyncH) {
  app.get('/api/envio/:t', asyncH(async (req, res) => {
    const e = await porToken(req.params.t);
    await query('UPDATE envios SET visto_en = now() WHERE id = $1', [e.id]);
    res.set('Cache-Control', 'no-store').json(await vistaPublica(e));
  }));
  // { estado, fecha, llegada_prevista, ref_transportista, nota, recogidas: {linea_id: bool} }
  app.put('/api/envio/:t', asyncH(async (req, res) => {
    const b = req.body || {};
    let e; let cambios;
    await tx(async (c) => {
      e = await porToken(req.params.t, c);
      if (e.estado === 'entregado' && b.estado !== 'entregado') throw fallo(409, 'Este envío ya está entregado; si hay que cambiar algo, contacte con nosotros.');
      for (const [lid, v] of Object.entries(b.recogidas || {})) await c.query('UPDATE envio_lineas SET recogido = $3 WHERE id = $1 AND envio_id = $2', [Number(lid), e.id, !!v]);
      const ref = texto(b.ref_transportista, 80); const nota = texto(b.nota, 300);
      await c.query('UPDATE envios SET ref_transportista = $2, nota_transportista = $3, actualizado_en = now() WHERE id = $1', [e.id, ref, nota]);
      cambios = await aplicar(c, e, { estado: b.estado, fecha: b.fecha, llegada: 'llegada_prevista' in b ? b.llegada_prevista : undefined }, e.transportista) || [];
      if (nota && nota !== e.nota_transportista) cambios.push(`«${nota}»`);
    });
    const nuevo = await envio(e.id);
    avisar(nuevo, cambios, nuevo.transportista);
    require('./eventos').emitir({ ruta: 'envios', quien: nuevo.transportista });
    res.json(await vistaPublica(nuevo));
  }));
  app.post('/api/envio/:t/archivos', express.raw({ type: TIPOS_ARCH, limit: 6 * 1024 * 1024 }), asyncH(async (req, res) => {
    const e = await porToken(req.params.t);
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS_ARCH.includes(tipo)) throw fallo(415, 'Solo fotos o PDF');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fallo(400, 'Archivo vacío');
    if (e.archivos.length >= 15) throw fallo(400, 'Como máximo 15 archivos');
    const nombre = req.headers['x-nombre'] ? decodeURIComponent(String(req.headers['x-nombre'])).slice(0, 120) : null;
    await query(`INSERT INTO archivos (tipo, bytes, nombre, datos, ref_tipo, ref_id, creado_por) VALUES ($1,$2,$3,$4,'envio',$5,NULL)`, [tipo, req.body.length, nombre, req.body, e.id]);
    await query('UPDATE envios SET actualizado_en = now() WHERE id = $1', [e.id]);
    res.status(201).json(await vistaPublica(await envio(e.id)));
  }));
  app.delete('/api/envio/:t/archivos/:id', asyncH(async (req, res) => {
    const e = await porToken(req.params.t);
    await query(`DELETE FROM archivos WHERE id = $1 AND ref_tipo = 'envio' AND ref_id = $2 AND creado_por IS NULL`, [Number(req.params.id), e.id]);
    res.json(await vistaPublica(await envio(e.id)));
  }));
  app.get('/api/envio/:t/archivos/:id', asyncH(async (req, res) => {
    const e = await porToken(req.params.t);
    const { rows } = await query(`SELECT tipo, nombre, datos FROM archivos WHERE id = $1 AND ref_tipo = 'envio' AND ref_id = $2`, [Number(req.params.id), e.id]);
    if (!rows.length) throw fallo(404, 'Archivo no encontrado');
    res.set({ 'Content-Type': rows[0].tipo, 'Content-Disposition': `inline; filename="${encodeURIComponent(rows[0].nombre || 'cmr')}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(rows[0].datos);
  }));
  const rep = () => recordatorios().catch((er) => console.warn('recordatorios envíos', er.message));
  setTimeout(() => { rep(); setInterval(rep, 10 * 60 * 1000); }, 40 * 1000);
}

function montarGestion(app, asyncH) {
  const ver = auth.permiso('compras', 'logistica', 'aprobar_compras', 'planificar');
  const p = auth.permiso('compras', 'logistica');

  app.get('/api/transportes', ver, asyncH(async (req, res) => {
    const { rows } = await query(`SELECT id FROM envios WHERE estado NOT IN ('anulado','entregado') OR (estado = 'entregado' AND actualizado_en > now() - interval '30 days')
                                  ORDER BY creado DESC LIMIT 200`);
    const envios = [];
    for (const { id } of rows) envios.push(await envio(id));
    const { rows: tr } = await query('SELECT id, nombre, email FROM proveedores WHERE transportista AND activo ORDER BY lower(nombre)');
    res.json({ pendientes: await pendientes(), envios, transportistas: tr, correo: correo.configurado(), agencias: require('./pedido-transporte').AGENCIAS });
  }));

  app.get('/api/envios/:id', ver, asyncH(async (req, res) => {
    const e = await envio(Number(req.params.id));
    if (!e) throw fallo(404, 'Envío no encontrado');
    res.json(e);
  }));

  // Nuevo envío: { transportista_id, items: [{tarea_id}|{pedido_id}|{descripcion, origen}] }
  app.post('/api/envios', p, asyncH(async (req, res) => {
    const b = req.body || {};
    const id = await tx(async (c) => {
      const aj = await require('./compras').ajustes();
      const tid = Number(b.transportista_id) || (await c.query('SELECT id FROM proveedores WHERE transportista AND activo ORDER BY id LIMIT 1')).rows[0]?.id || null;
      const { rows } = await c.query(
        `INSERT INTO envios (codigo, transportista_id, nonce, email, entregar_en, creado_por)
         VALUES ($1,$2,$3,(SELECT email FROM proveedores WHERE id = $2),$4,$5) RETURNING id`,
        [await siguienteCodigo(c), tid, crypto.randomBytes(18).toString('base64url'), aj.entregar_en || null, req.usuario.id]);
      const eid = rows[0].id;
      for (const it of (Array.isArray(b.items) ? b.items : []).slice(0, 50)) await insertarLinea(c, eid, await lineaDe(c, it, eid));
      return eid;
    });
    res.status(201).json(await envio(id));
  }));

  app.post('/api/envios/:id/lineas', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx(async (c) => {
      const e = await envio(id, c);
      if (!e || e.estado === 'anulado') throw fallo(404, 'Envío no encontrado');
      if (e.estado === 'entregado') throw fallo(400, 'El envío ya está entregado');
      await insertarLinea(c, id, await lineaDe(c, req.body || {}, id));
    });
    res.json(await envio(id));
  }));
  app.delete('/api/envios/:id/lineas/:lid', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await query('DELETE FROM envio_lineas WHERE id = $1 AND envio_id = $2', [Number(req.params.lid), id]);
    res.json(await envio(id));
  }));

  // Datos y líneas: { transportista_id, recogida_prevista, llegada_prevista, entregar_en, ref_transportista, coste, reparto, notas, email,
  //   lineas: [{ id, descripcion, origen, bultos, kg, coste_manual, recogido }] }
  app.put('/api/envios/:id', p, asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    let cambios = null;
    await tx(async (c) => {
      const e = await envio(id, c);
      if (!e || e.estado === 'anulado') throw fallo(404, 'Envío no encontrado');
      const sets = []; const vals = [id];
      const poner = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
      if ('transportista_id' in b) poner('transportista_id', Number(b.transportista_id) || null);
      if ('recogida_prevista' in b) poner('recogida_prevista', fechaOk(b.recogida_prevista));
      for (const [k, m] of [['entregar_en', 300], ['ref_transportista', 80], ['notas', 2000], ['email', 200]]) if (k in b) poner(k, texto(b[k], m));
      if ('coste' in b) { const n = num(b.coste); if (n != null && !(n >= 0)) throw fallo(400, 'Coste no válido'); poner('coste', n); }
      if ('reparto' in b) poner('reparto', b.reparto === 'manual' ? 'manual' : 'kg');
      if (sets.length) await c.query(`UPDATE envios SET ${sets.join(', ')} WHERE id = $1`, vals);
      for (const l of (Array.isArray(b.lineas) ? b.lineas : []).slice(0, 100)) {
        const bu = num(l.bultos); const kg = num(l.kg); const cm = num(l.coste_manual);
        await c.query(`UPDATE envio_lineas SET descripcion = COALESCE($3, descripcion), origen = $4, bultos = $5, kg = $6, coste_manual = $7, recogido = $8
                        WHERE id = $1 AND envio_id = $2`,
        [Number(l.id), id, texto(l.descripcion, 300), texto(l.origen, 200), Number.isInteger(bu) && bu >= 0 ? bu : null,
          kg != null && kg >= 0 ? kg : null, cm != null && cm >= 0 ? cm : null, !!l.recogido]);
      }
      if ('llegada_prevista' in b) cambios = await aplicar(c, { ...e }, { llegada: b.llegada_prevista }, req.usuario.nombre);
    });
    const e = await envio(id);
    if (cambios) avisar(e, cambios, null);
    res.json(e);
  }));

  // Cambiar el estado desde la oficina: { estado, fecha }
  app.post('/api/envios/:id/estado', p, asyncH(async (req, res) => {
    const id = Number(req.params.id); let cambios;
    await tx(async (c) => {
      const e = await envio(id, c);
      if (!e || e.estado === 'anulado') throw fallo(404, 'Envío no encontrado');
      if (!e.lineas.length) throw fallo(400, 'El envío no lleva nada');
      cambios = await aplicar(c, e, { estado: req.body?.estado, fecha: req.body?.fecha }, req.usuario.nombre);
    });
    const e = await envio(id);
    avisar(e, cambios, null);
    res.json(e);
  }));

  // Anular (preparando: se borra; si ya salió, se marca anulado)
  app.delete('/api/envios/:id', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const e = await envio(id);
    if (!e) throw fallo(404, 'Envío no encontrado');
    if (e.estado === 'preparando' && !e.enviado_en) await query('DELETE FROM envios WHERE id = $1', [id]);
    else await query(`UPDATE envios SET estado = 'anulado' WHERE id = $1`, [id]);
    res.json({ ok: true });
  }));

  // Mandar al transportista su enlace por correo ({ para }), o solo obtenerlo ({ nuevo })
  app.post('/api/envios/:id/enviar', p, asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const e = await envio(id);
    if (!e || e.estado === 'anulado') throw fallo(404, 'Envío no encontrado');
    if (!e.lineas.length) throw fallo(400, 'El envío no lleva nada');
    const para = texto(b.para, 200);
    if (!para || !/.+@.+\..+/.test(para)) throw fallo(400, 'Falta el correo del transportista');
    const { rows } = await query('SELECT nonce FROM envios WHERE id = $1', [id]);
    const url = urlDe({ id, nonce: rows[0].nonce }, req);
    await correoTransportista(e, url, para);
    await query('UPDATE envios SET enviado_en = now(), email = $2 WHERE id = $1', [id, para]);
    if (e.transportista_id) await query(`UPDATE proveedores SET email = $2 WHERE id = $1 AND (email IS NULL OR email = '')`, [e.transportista_id, para]);
    res.json({ ...(await envio(id)), url });
  }));
  app.post('/api/envios/:id/enlace', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(
      `UPDATE envios SET nonce = ${req.body?.nuevo ? '$2' : 'nonce'}, enviado_en = COALESCE(enviado_en, now()) WHERE id = $1 RETURNING id, nonce`,
      [id, ...(req.body?.nuevo ? [crypto.randomBytes(18).toString('base64url')] : [])]);
    if (!rows.length) throw fallo(404, 'Envío no encontrado');
    res.json({ url: urlDe(rows[0], req) });
  }));
  app.get('/api/envios/:id/archivos/:aid', ver, asyncH(async (req, res) => {
    const { rows } = await query(`SELECT tipo, nombre, datos FROM archivos WHERE id = $1 AND ref_tipo = 'envio' AND ref_id = $2`, [Number(req.params.aid), Number(req.params.id)]);
    if (!rows.length) throw fallo(404, 'Archivo no encontrado');
    res.set({ 'Content-Type': rows[0].tipo, 'Content-Disposition': `inline; filename="${encodeURIComponent(rows[0].nombre || 'cmr')}"`, 'X-Content-Type-Options': 'nosniff' });
    res.send(rows[0].datos);
  }));
}

const aplicarEstado = (c, e, estado, quien) => aplicar(c, e, { estado }, quien);

module.exports = { montarPublico, montarGestion, deOrdenes, costePorTarea, ESTADO_TXT, aplicarEstado };
