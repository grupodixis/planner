// Cómo llega cada pedido (material o subcontratación):
//  · proveedor  — lo trae el proveedor (su transporte o agencia): fecha pactada, agencia y nº de seguimiento (tracking)
//  · recogida   — lo vamos a buscar: el transportista (Menorca Tragina, Luchana…) recoge en una dirección
//  · almacen    — el proveedor lo deja en el almacén del transportista en la península (Idyca Gavà, Luchana Sant Feliu…)
//                 y este nos lo trae a Menorca en un envío
// «Activar seguimiento» crea el enlace del proveedor (pedido.html?t=…): confirma el pedido y, según el modo, da el tracking,
// marca «entregado al transportista» (con albarán) o confirma cuándo estará listo para recoger.
const crypto = require('crypto');
const express = require('express');
const { query, tx } = require('./db');
const auth = require('./auth');
const correo = require('./correo');
const notif = require('./notificaciones');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);
const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10)) ? String(v).slice(0, 10) : null);
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const horaMadrid = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
const fechaLarga = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : '');

const MODOS = { proveedor: 'Lo trae el proveedor', recogida: 'Lo vamos a buscar', almacen: 'Al almacén del transportista' };
const AGENCIAS = { mrw: 'MRW', ecoscooting: 'Ecoscooting', ups: 'UPS', correos: 'Correos', otra: 'Otra' };
function urlTracking(agencia, n) {
  const t = encodeURIComponent(String(n || '').trim());
  if (!t) return null;
  return {
    mrw: `https://www.mrw.es/seguimiento_envios/MRW_resultados_consultas.asp?modo=nacional&envio=${t}`,
    ups: `https://www.ups.com/track?loc=es_ES&tracknum=${t}`,
    correos: `https://www.correos.es/es/es/herramientas/localizador/envios/detalle?tracking-number=${t}`,
    ecoscooting: 'https://www.ecoscooting.com/',
  }[agencia] || null;
}

let ultimaBase = '';
function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (req) ultimaBase = `${req.protocol}://${req.get('host')}`;
  return ultimaBase;
}
const firma = (id, nonce) => correo.firmar(`pedido:${id}:${nonce}`);
const urlDe = (p, req) => (p.seg_nonce && p.seg_activo ? `${baseUrl(req)}/pedido.html?t=${p.id}.${firma(p.id, p.seg_nonce)}` : null);

async function evento(c, pedidoId, txt, { usuario = null, externo = null } = {}) {
  await c.query('INSERT INTO pedido_eventos (pedido_id, texto, usuario_id, externo) VALUES ($1,$2,$3,$4)', [pedidoId, txt, usuario?.id || null, externo]);
}

// Datos de transporte de un pedido (se añaden a GET /api/compras/pedidos/:id)
async function completar(p, req) {
  const { rows } = await query(
    `SELECT a.*, t.nombre AS transportista FROM transportista_almacenes a JOIN proveedores t ON t.id = a.transportista_id WHERE a.id = $1`, [p.almacen_id || 0]);
  p.almacen = rows[0] || null;
  if (p.transportista_id) p.transportista = (await query('SELECT nombre FROM proveedores WHERE id = $1', [p.transportista_id])).rows[0]?.nombre || null;
  p.tracking_url = urlTracking(p.agencia, p.tracking);
  p.seg_url = urlDe(p, req);
  p.modos = MODOS; p.agencias = AGENCIAS;
  const { rows: ev } = await query(`SELECT e.texto, e.externo, e.creado, u.nombre AS usuario FROM pedido_eventos e LEFT JOIN usuarios u ON u.id = e.usuario_id
                                     WHERE e.pedido_id = $1 ORDER BY e.creado DESC LIMIT 30`, [p.id]);
  p.eventos_trp = ev;
  const { rows: env } = await query(
    `SELECT e.id, e.codigo, e.estado, e.aceptacion, e.recogida_prevista::text AS recogida, e.llegada_prevista::text AS llegada, t.nombre AS transportista
       FROM envio_lineas l JOIN envios e ON e.id = l.envio_id LEFT JOIN proveedores t ON t.id = e.transportista_id
      WHERE l.pedido_id = $1 AND e.estado <> 'anulado' ORDER BY e.id DESC LIMIT 1`, [p.id]);
  p.envio = env[0] || null;
  const { rows: pend } = await query(`SELECT count(*)::int AS n FROM partida_escandallo WHERE pedido_compra_id = $1 AND compra = 'pedido'`, [p.id]);
  p.por_recibir = pend[0].n;
  if (!p.entrega_modo && p.proveedor_id) {
    const { rows: pv } = await query('SELECT entrega_modo_def, transportista_def_id FROM proveedores WHERE id = $1', [p.proveedor_id]);
    p.modo_sugerido = pv[0]?.entrega_modo_def || null; p.transportista_sugerido = pv[0]?.transportista_def_id || null;
  }
  p.situacion_trp = situacion(p);
  delete p.seg_nonce;
  return p;
}

// texto corto de cómo va el transporte del pedido
function situacion(p) {
  if (!p.entrega_modo) return null;
  if (p.estado !== 'enviado') return `${MODOS[p.entrega_modo]} (cuando se envíe el pedido)`;
  if (p.por_recibir === 0 && p.tipo === 'material') return '✔ recibido';
  if (p.envio) {
    const E = { preparando: 'en preparación', recogido: 'recogido', en_barco: 'en barco', en_mao: 'en Maó', entregado: 'entregado' };
    return `🚚 ${p.envio.codigo} · ${p.envio.transportista || ''} · ${E[p.envio.estado] || p.envio.estado}${p.envio.llegada && !['en_mao', 'entregado'].includes(p.envio.estado) ? ` · llega ~${ddmm(p.envio.llegada)}` : ''}${p.envio.estado === 'preparando' && p.envio.recogida ? ` · recogida ${ddmm(p.envio.recogida)}` : ''}${p.envio.estado === 'preparando' ? ({ pendiente: ' · ⏳ sin aceptar', propuesta: ' · 📅 propone otra fecha', rechazada: ' · ✕ no puede', aceptada: ' · ✔ aceptada' }[p.envio.aceptacion] || '') : ''}`;
  }
  if (p.entrega_modo === 'proveedor') {
    return p.tracking ? `📦 ${AGENCIAS[p.agencia] || p.agencia_otra || 'agencia'} ${p.tracking}${p.fecha_entrega ? ` · llega ~${ddmm(p.fecha_entrega)}` : ''}`
      : `📦 lo trae el proveedor${p.fecha_entrega ? ` · pactado ${ddmm(p.fecha_entrega)}` : ''} · sin nº de seguimiento`;
  }
  if (p.entrega_modo === 'almacen') {
    return p.entregado_almacen ? `🏬 en ${p.almacen?.nombre || 'el almacén'} desde ${ddmm(p.entregado_almacen)} · falta meterlo en un envío`
      : `🏬 el proveedor lo lleva a ${p.almacen?.nombre || 'el almacén del transportista'}${p.fecha_almacen ? ` · pactado ${ddmm(p.fecha_almacen)}` : ''}`;
  }
  return `🚚 recogida por ${p.transportista || 'programar'}${p.recogida_fecha ? ` · ${ddmm(p.recogida_fecha)}` : ''}${p.listo_recogida ? ` · listo ${ddmm(p.listo_recogida)}` : ''}`;
}

// la fecha prevista de llegada del pedido pasa al material (los avisos del cuadrante la usan)
async function fechaAlMaterial(c, pedidoId, fecha) {
  if (!fecha) return;
  await c.query(`UPDATE partida_escandallo SET fecha_prevista = $2 WHERE pedido_compra_id = $1 AND compra = 'pedido'`, [pedidoId, fecha]);
}

async function avisarCompras(p, titulo, cuerpo) {
  notif.avisarLuego(notif.conPermiso('compras', 'logistica'), 'mat_pedido', { titulo, cuerpo, url: `/compras.html?pedido=${p.id}`, tag: `trp-${p.id}` });
}

/* ---------- rutas internas ---------- */
function montar(app, asyncH) {
  const pEdit = auth.permiso('compras', 'logistica');

  app.get('/api/transportistas', asyncH(async (_req, res) => {
    const { rows: t } = await query('SELECT id, nombre, telefono, email, localidad FROM proveedores WHERE transportista AND activo ORDER BY nombre');
    const { rows: a } = await query('SELECT * FROM transportista_almacenes WHERE activo ORDER BY nombre');
    res.json({ transportistas: t.map((x) => ({ ...x, almacenes: a.filter((y) => y.transportista_id === x.id) })), modos: MODOS, agencias: AGENCIAS });
  }));
  // almacenes de un transportista (alta / cambio / baja)
  app.post('/api/transportistas/:id/almacenes', auth.permiso('compras'), asyncH(async (req, res) => {
    const b = req.body || {};
    if (!texto(b.nombre, 120)) throw fallo(400, 'Pon el nombre del almacén');
    const { rows } = await query(`INSERT INTO transportista_almacenes (transportista_id, nombre, direccion, telefono, email, horario, leyenda)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`, [Number(req.params.id), texto(b.nombre, 120), texto(b.direccion), texto(b.telefono, 60), texto(b.email, 200), texto(b.horario, 200), texto(b.leyenda, 200)]);
    res.json({ id: rows[0].id });
  }));
  app.put('/api/almacenes/:id', auth.permiso('compras'), asyncH(async (req, res) => {
    const b = req.body || {};
    await query(`UPDATE transportista_almacenes SET nombre = COALESCE($2, nombre), direccion = $3, telefono = $4, email = $5, horario = $6, leyenda = $7, activo = COALESCE($8, activo) WHERE id = $1`,
      [Number(req.params.id), texto(b.nombre, 120), texto(b.direccion), texto(b.telefono, 60), texto(b.email, 200), texto(b.horario, 200), texto(b.leyenda, 200), b.activo == null ? null : !!b.activo]);
    res.json({ ok: true });
  }));

  // Cambiar cómo llega (también con el pedido ya enviado)
  app.put('/api/compras/pedidos/:id/transporte', pEdit, asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM pedidos_compra WHERE id = $1 FOR UPDATE', [id]);
      const p = rows[0];
      if (!p) throw fallo(404, 'Pedido no encontrado');
      const sets = []; const vals = [id]; const cambios = [];
      const poner = (k, v, txt) => { vals.push(v); sets.push(`${k} = $${vals.length}`); if (txt) cambios.push(txt); };
      if ('entrega_modo' in b) poner('entrega_modo', MODOS[b.entrega_modo] ? b.entrega_modo : null, `cómo llega: ${MODOS[b.entrega_modo] || 'sin decir'}`);
      if ('transportista_id' in b) poner('transportista_id', Number(b.transportista_id) || null);
      let alm = null;
      if ('almacen_id' in b) {
        const aid = Number(b.almacen_id) || null;
        poner('almacen_id', aid);
        if (aid) {
          alm = (await c.query('SELECT * FROM transportista_almacenes WHERE id = $1', [aid])).rows[0];
          if (alm) {
            poner('transportista_id', alm.transportista_id);
            // en el pedido (PDF y correo): dónde entregarlo y la leyenda («Para Dixis Menorca»)
            if (['borrador', 'por_aprobar', 'aprobado'].includes(p.estado)) {
              poner('entregar_en', `${alm.nombre} · ${alm.direccion || ''}`.slice(0, 300));
              if (alm.leyenda && !(p.observaciones || '').includes(alm.leyenda)) poner('observaciones', `${p.observaciones ? `${p.observaciones}\n` : ''}${alm.leyenda}`.slice(0, 3000));
            }
          }
        }
      }
      for (const [k, m] of [['agencia', 30], ['agencia_otra', 80], ['tracking', 80], ['recogida_direccion', 300], ['recogida_contacto', 120], ['recogida_telefono', 60], ['recogida_horario', 120]]) {
        if (k in b) poner(k, texto(b[k], m), k === 'tracking' && texto(b[k], 80) ? `nº de seguimiento ${texto(b[k], 80)}` : null);
      }
      for (const k of ['fecha_entrega', 'fecha_almacen', 'fecha_salida', 'recogida_fecha', 'entregado_almacen', 'listo_recogida']) {
        if (k in b) poner(k, fechaOk(b[k]), k === 'entregado_almacen' && fechaOk(b[k]) ? `entregado en el almacén el ${ddmm(fechaOk(b[k]))}` : null);
      }
      if ('bultos' in b) poner('bultos', Number.isInteger(Number(b.bultos)) && b.bultos !== '' ? Number(b.bultos) : null);
      if ('kg' in b) poner('kg', b.kg === '' || b.kg == null ? null : Number(b.kg));
      if (b.entrega_modo === 'recogida' && !p.recogida_direccion && !('recogida_direccion' in b)) {
        const { rows: pv } = await c.query('SELECT nombre, localidad, contacto, telefono FROM proveedores WHERE id = $1', [p.proveedor_id || 0]);
        if (pv[0]) { poner('recogida_direccion', [pv[0].nombre, pv[0].localidad].filter(Boolean).join(' · ')); poner('recogida_contacto', pv[0].contacto); poner('recogida_telefono', pv[0].telefono); }
      }
      if (!sets.length) return;
      await c.query(`UPDATE pedidos_compra SET ${sets.join(', ')} WHERE id = $1`, vals);
      if ('fecha_entrega' in b && p.estado === 'enviado') await fechaAlMaterial(c, id, fechaOk(b.fecha_entrega));
      if (cambios.length) await evento(c, id, cambios.join(' · '), { usuario: req.usuario });
      // recordar el modo en el proveedor para el próximo pedido
      if (b.entrega_modo && p.proveedor_id) await c.query('UPDATE proveedores SET entrega_modo_def = $2, transportista_def_id = COALESCE($3, transportista_def_id) WHERE id = $1', [p.proveedor_id, b.entrega_modo, alm?.transportista_id || Number(b.transportista_id) || null]);
    });
    res.json({ ok: true });
  }));

  // Activar / parar el seguimiento del proveedor (crea el enlace)
  app.post('/api/compras/pedidos/:id/seguimiento', pEdit, asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const activar = b.activar !== false;
    const { rows } = await query(
      `UPDATE pedidos_compra SET seg_activo = $2, seg_nonce = CASE WHEN $3 OR seg_nonce IS NULL THEN $4 ELSE seg_nonce END WHERE id = $1 RETURNING *`,
      [id, activar, !!b.nuevo, crypto.randomBytes(18).toString('base64url')]);
    if (!rows.length) throw fallo(404, 'Pedido no encontrado');
    await evento({ query }, id, activar ? '▶ seguimiento activado (enlace del proveedor)' : '⏹ seguimiento parado', { usuario: req.usuario });
    const p = rows[0];
    let enviado = null;
    if (activar && b.enviar && p.estado === 'enviado') {
      const { rows: pv } = await query('SELECT nombre, email FROM proveedores WHERE id = $1', [p.proveedor_id || 0]);
      const para = texto(b.email, 200) || pv[0]?.email;
      if (!para) throw fallo(400, 'El proveedor no tiene correo: copia el enlace');
      await enviarEnlace(p, para, req);
      enviado = para;
    }
    res.json({ url: urlDe(p, req), enviado });
  }));
}

async function enviarEnlace(p, para, req) {
  const aj = await require('./compras').ajustes();
  const full = await completar({ ...p }, req);
  const url = urlDe(p, req);
  const que = {
    proveedor: 'Cuando lo enviéis, indicadnos la agencia y el nº de seguimiento.',
    almacen: `Entregadlo en ${full.almacen ? `${full.almacen.nombre} (${full.almacen.direccion}${full.almacen.leyenda ? ` · ${full.almacen.leyenda}` : ''})` : 'el almacén del transportista'} y marcadlo como entregado (con el albarán).`,
    recogida: 'Pasará nuestro transportista a recogerlo: confirmadnos cuándo estará listo y cuántos bultos son.',
  }[p.entrega_modo] || 'Confirmadnos la fecha de entrega.';
  await correo.enviarOFallar({
    para, asunto: `Pedido ${p.codigo} · confirmación y seguimiento · ${aj.empresa.nombre}`,
    texto: `Hola,\n\nPara el pedido ${p.codigo}, os pedimos que lo confirméis y nos digáis cómo va en este enlace (sin usuario ni contraseña):\n${url}\n\n${que}\n\nGracias,\n${aj.empresa.nombre}${aj.empresa.telefono ? ` · ${aj.empresa.telefono}` : ''}`,
  });
  await evento({ query }, p.id, `✉ enlace de seguimiento enviado a ${para}`);
}

// El transportista ha aceptado la recogida de un envío que lleva este pedido: el pedido toma su transportista y fecha,
// se activa su seguimiento y el proveedor recibe la recogida confirmada con su enlace (para decir cuándo está listo, bultos y contacto).
async function recogidaAceptada(pedidoId, e, req) {
  const { rows } = await query(`SELECT c.*, c.recogida_fecha::text AS recogida_fecha, p.nombre AS proveedor, p.email AS proveedor_email
                                  FROM pedidos_compra c LEFT JOIN proveedores p ON p.id = c.proveedor_id WHERE c.id = $1`, [pedidoId]);
  const p0 = rows[0];
  if (!p0 || p0.estado !== 'enviado') return null;
  const quien = e.transportista || 'nuestro transportista';
  if (p0.entrega_modo === 'almacen') {
    await evento({ query }, p0.id, `✔ ${quien} acepta recogerlo del almacén (${e.codigo}${e.recogida_prevista ? `, ${ddmm(e.recogida_prevista)}` : ''})`);
    return null;
  }
  const otraFecha = (p0.recogida_fecha || null) !== (e.recogida_prevista || null) || (p0.transportista_id || null) !== (e.transportista_id || null);
  const { rows: up } = await query(
    `UPDATE pedidos_compra SET entrega_modo = COALESCE(entrega_modo, 'recogida'), transportista_id = COALESCE($2, transportista_id),
            recogida_fecha = COALESCE($3, recogida_fecha), seg_activo = TRUE, seg_nonce = COALESCE(seg_nonce, $4)
      WHERE id = $1 RETURNING *`, [p0.id, e.transportista_id || null, e.recogida_prevista || null, crypto.randomBytes(18).toString('base64url')]);
  const p = up[0];
  await evento({ query }, p.id, `✔ ${quien} acepta la recogida (${e.codigo}${e.recogida_prevista ? `, ${ddmm(e.recogida_prevista)}` : ''}) · ▶ seguimiento activado`);
  if (p0.aviso_recogida_en && !otraFecha) return null; // el proveedor ya lo sabe
  const url = urlDe(p, req);
  if (!p0.proveedor_email || !correo.configurado()) {
    await evento({ query }, p.id, '⚠ el proveedor no tiene correo: envíale el enlace (Copiar enlace)');
    await avisarCompras(p, `🚚 ${quien} recoge el ${p.codigo}${e.recogida_prevista ? ` el ${ddmm(e.recogida_prevista)}` : ''}`, `Avisa a ${p0.proveedor || 'el proveedor'}: no tiene correo. Copia el enlace de seguimiento del pedido.`);
    return `${p.codigo}: sin correo del proveedor`;
  }
  const aj = await require('./compras').ajustes();
  try {
    await correo.enviarOFallar({
    para: p0.proveedor_email,
    asunto: `Recogida confirmada · pedido ${p.codigo} · ${aj.empresa.nombre}`,
    texto: `Hola,\n\n${e.recogida_prevista ? `El ${fechaLarga(e.recogida_prevista)}` : 'En los próximos días'} pasará ${quien} a recoger el pedido ${p.codigo}`
      + `${p.recogida_direccion ? ` en ${p.recogida_direccion}` : ''}${p.recogida_horario ? ` (${p.recogida_horario})` : ''}.\n\n`
      + `En este enlace (sin usuario) podéis confirmar el pedido, cuándo estará listo, los bultos y kg, y la persona de contacto para la recogida:\n${url}\n\n`
      + `Gracias,\n${aj.empresa.nombre}${aj.empresa.telefono ? ` · ${aj.empresa.telefono}` : ''}`,
    });
  } catch (er) {
    await evento({ query }, p.id, `⚠ no se pudo enviar el correo al proveedor (${er.message.slice(0, 80)}): envíale el enlace`);
    await avisarCompras(p, `🚚 ${quien} recoge el ${p.codigo}`, `No se ha podido escribir a ${p0.proveedor || 'el proveedor'}: copia el enlace de seguimiento del pedido y envíaselo.`);
    return `${p.codigo}: no se pudo escribir al proveedor`;
  }
  await query('UPDATE pedidos_compra SET aviso_recogida_en = $2 WHERE id = $1', [p.id, hoyMadrid()]);
  await evento({ query }, p.id, `✉ recogida confirmada y enlace de seguimiento enviados a ${p0.proveedor_email}`);
  return `${p.codigo}: avisado ${p0.proveedor || 'el proveedor'}`;
}

/* ---------- lo que ve el proveedor ---------- */
async function porToken(t) {
  const m = /^(\d{1,9})\.([A-Za-z0-9_-]{32})$/.exec(String(t || ''));
  const noVale = fallo(404, 'Este enlace no es válido o ya no está activo.');
  if (!m) throw noVale;
  const { rows } = await query(`SELECT c.*, p.nombre AS proveedor FROM pedidos_compra c LEFT JOIN proveedores p ON p.id = c.proveedor_id WHERE c.id = $1`, [Number(m[1])]);
  const p = rows[0];
  if (!p || !p.seg_activo || !p.seg_nonce) throw noVale;
  const a = Buffer.from(firma(p.id, p.seg_nonce)); const b = Buffer.from(m[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw noVale;
  return p;
}
async function vistaExt(p) {
  const aj = await require('./compras').ajustes();
  const full = await completar({ ...p });
  const { rows: ls } = await query('SELECT descripcion, cantidad::float AS cantidad, unidad FROM pedido_compra_lineas WHERE pedido_id = $1 ORDER BY orden, id', [p.id]);
  const { rows: arch } = await query(`SELECT id, nombre, tipo FROM archivos WHERE ref_tipo = 'pedido_albaran' AND ref_id = $1 ORDER BY id`, [p.id]);
  return {
    empresa: { nombre: aj.empresa.nombre, telefono: aj.empresa.telefono, email: aj.empresa.email },
    codigo: p.codigo, proveedor: p.proveedor, lineas: ls, modo: p.entrega_modo, modo_txt: MODOS[p.entrega_modo] || null, agencias: AGENCIAS,
    confirmado: p.prov_confirmado_en, fecha_entrega: p.fecha_entrega ? String(p.fecha_entrega).slice(0, 10) : null,
    fecha_almacen: full.fecha_almacen ? String(full.fecha_almacen).slice(0, 10) : null,
    agencia: p.agencia, agencia_otra: p.agencia_otra, tracking: p.tracking, fecha_salida: p.fecha_salida ? String(p.fecha_salida).slice(0, 10) : null,
    almacen: full.almacen ? { nombre: full.almacen.nombre, direccion: full.almacen.direccion, telefono: full.almacen.telefono, horario: full.almacen.horario, leyenda: full.almacen.leyenda, transportista: full.almacen.transportista } : null,
    entregado_almacen: p.entregado_almacen ? String(p.entregado_almacen).slice(0, 10) : null, bultos: p.bultos, kg: p.kg == null ? null : Number(p.kg),
    recogida: p.entrega_modo === 'recogida' ? { transportista: full.transportista, direccion: p.recogida_direccion, fecha: p.recogida_fecha ? String(p.recogida_fecha).slice(0, 10) : null, contacto: p.recogida_contacto, telefono: p.recogida_telefono, horario: p.recogida_horario } : null,
    listo_recogida: p.listo_recogida ? String(p.listo_recogida).slice(0, 10) : null,
    comentario: p.prov_comentario, albaranes: arch, cerrado: p.estado !== 'enviado',
  };
}
function montarPublico(app, asyncH) {
  app.get('/api/pedido-ext/:t', asyncH(async (req, res) => {
    const p = await porToken(req.params.t);
    if (!p.seg_visto_en) await query('UPDATE pedidos_compra SET seg_visto_en = now() WHERE id = $1', [p.id]);
    res.set('Cache-Control', 'no-store').json(await vistaExt(p));
  }));
  app.put('/api/pedido-ext/:t', express.json({ limit: '30kb' }), asyncH(async (req, res) => {
    const p = await porToken(req.params.t);
    const b = req.body || {}; const hechos = [];
    await tx(async (c) => {
      const sets = []; const vals = [p.id];
      const poner = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
      if (b.confirmar && !p.prov_confirmado_en) { sets.push('prov_confirmado_en = now()'); hechos.push('confirma el pedido'); }
      const fe = fechaOk(b.fecha_entrega);
      if (fe && fe !== (p.fecha_entrega && String(p.fecha_entrega).slice(0, 10))) { poner('fecha_entrega', fe); hechos.push(`llegará el ${ddmm(fe)}`); }
      if (p.entrega_modo === 'proveedor' || !p.entrega_modo) {
        if (b.agencia && AGENCIAS[b.agencia]) poner('agencia', b.agencia);
        if ('agencia_otra' in b) poner('agencia_otra', texto(b.agencia_otra, 80));
        const tr = texto(b.tracking, 80);
        if (tr && tr !== p.tracking) { poner('tracking', tr); hechos.push(`enviado por ${AGENCIAS[b.agencia] || texto(b.agencia_otra, 80) || 'agencia'} · nº ${tr}`); }
        const fs = fechaOk(b.fecha_salida); if (fs) poner('fecha_salida', fs);
      }
      if (p.entrega_modo === 'almacen') {
        const fa = fechaOk(b.fecha_almacen); if (fa) { poner('fecha_almacen', fa); }
        const ent = fechaOk(b.entregado_almacen);
        if (ent && ent !== (p.entregado_almacen && String(p.entregado_almacen).slice(0, 10))) { poner('entregado_almacen', ent); hechos.push(`🏬 entregado en el almacén el ${ddmm(ent)}`); }
      }
      if (p.entrega_modo === 'recogida') {
        const li = fechaOk(b.listo_recogida);
        if (li && li !== (p.listo_recogida && String(p.listo_recogida).slice(0, 10))) { poner('listo_recogida', li); hechos.push(`estará listo para recoger el ${ddmm(li)}`); }
        if ('recogida_contacto' in b) poner('recogida_contacto', texto(b.recogida_contacto, 120));
        if ('recogida_telefono' in b) poner('recogida_telefono', texto(b.recogida_telefono, 60));
        if ('recogida_horario' in b) poner('recogida_horario', texto(b.recogida_horario, 120));
      }
      if ('bultos' in b && b.bultos !== '' && b.bultos != null) poner('bultos', Math.max(0, Math.round(Number(b.bultos)) || 0));
      if ('kg' in b && b.kg !== '' && b.kg != null) poner('kg', Number(b.kg) || null);
      const com = texto(b.comentario, 1000);
      if (com && com !== p.prov_comentario) { poner('prov_comentario', com); hechos.push(`«${com}»`); }
      if (!sets.length) return;
      sets.push('prov_actualizado_en = now()');
      await c.query(`UPDATE pedidos_compra SET ${sets.join(', ')} WHERE id = $1`, vals);
      if (fe) await fechaAlMaterial(c, p.id, fe);
      if (hechos.length) await evento(c, p.id, hechos.join(' · '), { externo: p.proveedor });
    });
    if (hechos.length) avisarCompras(p, `${p.proveedor} · pedido ${p.codigo}`, hechos.join(' · '));
    require('./eventos').emitir({ ruta: 'compras', quien: p.proveedor });
    res.json(await vistaExt(await porToken(req.params.t)));
  }));
  // albarán de entrega (foto o PDF) — cuerpo = el archivo
  const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  app.post('/api/pedido-ext/:t/archivos', express.raw({ type: TIPOS, limit: 6 * 1024 * 1024 }), asyncH(async (req, res) => {
    const p = await porToken(req.params.t);
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS.includes(tipo) || !Buffer.isBuffer(req.body) || !req.body.length) throw fallo(400, 'Solo fotos o PDF');
    const { rows: n } = await query(`SELECT count(*)::int AS n FROM archivos WHERE ref_tipo = 'pedido_albaran' AND ref_id = $1`, [p.id]);
    if (n[0].n >= 8) throw fallo(400, 'Como máximo 8 archivos');
    const nombre = req.headers['x-nombre'] ? decodeURIComponent(String(req.headers['x-nombre'])).slice(0, 120) : 'albaran';
    await query(`INSERT INTO archivos (tipo, bytes, nombre, datos, ref_tipo, ref_id, creado_por) VALUES ($1,$2,$3,$4,'pedido_albaran',$5,NULL)`, [tipo, req.body.length, nombre, req.body, p.id]);
    await evento({ query }, p.id, '📎 albarán', { externo: p.proveedor });
    res.status(201).json(await vistaExt(p));
  }));
  app.get('/api/pedido-ext/:t/archivos/:id', asyncH(async (req, res) => {
    const p = await porToken(req.params.t);
    const { rows } = await query(`SELECT tipo, datos FROM archivos WHERE id = $1 AND ref_tipo = 'pedido_albaran' AND ref_id = $2`, [Number(req.params.id), p.id]);
    if (!rows.length) throw fallo(404, 'Archivo no encontrado');
    res.set({ 'Content-Type': rows[0].tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(rows[0].datos);
  }));
  setTimeout(() => {
    const rep = () => recordatorios().catch((e) => console.warn('recordatorios transporte pedidos', e.message));
    rep(); setInterval(rep, 10 * 60 * 1000);
  }, 50 * 1000);
}

/* ---------- recordatorios (laborables 9–19 h) ---------- */
async function laborablesHasta(desde, hasta) {
  if (!desde || desde >= hasta) return 0;
  const { rows } = await query(`SELECT count(*)::int AS n FROM generate_series($1::date + 1, $2::date, '1 day') d
                                 WHERE extract(isodow FROM d) < 6 AND NOT EXISTS (SELECT 1 FROM festivos f WHERE f.fecha = d::date)`, [desde, hasta]);
  return rows[0].n;
}
async function recordatorios(forzar = false) {
  const hoy = hoyMadrid(); const h = horaMadrid();
  if (!forzar && (h < 9 || h >= 19 || [0, 6].includes(new Date(`${hoy}T12:00:00Z`).getUTCDay()))) return;
  const { rows: fest } = await query('SELECT 1 FROM festivos WHERE fecha = $1', [hoy]);
  if (fest.length && !forzar) return;
  const aj = await require('./compras').ajustes();
  const { rows } = await query(
    `SELECT c.*, c.fecha_entrega::text AS fecha_entrega, c.fecha_almacen::text AS fecha_almacen, c.recogida_fecha::text AS recogida_fecha,
            c.entregado_almacen::text AS entregado_almacen, c.recordatorio_trp::text AS recordatorio_trp, c.aviso_recogida_en::text AS aviso_recogida_en,
            p.nombre AS proveedor, p.email AS proveedor_email,
            (SELECT count(*)::int FROM partida_escandallo e WHERE e.pedido_compra_id = c.id AND e.compra = 'pedido') AS por_recibir,
            (SELECT e.recogida_prevista::text FROM envio_lineas l JOIN envios e ON e.id = l.envio_id WHERE l.pedido_id = c.id AND e.estado = 'preparando' AND e.aceptacion = 'aceptada' ORDER BY e.id DESC LIMIT 1) AS envio_recogida,
            (SELECT t.nombre FROM envio_lineas l JOIN envios e ON e.id = l.envio_id JOIN proveedores t ON t.id = e.transportista_id WHERE l.pedido_id = c.id AND e.estado <> 'anulado' AND e.aceptacion = 'aceptada' ORDER BY e.id DESC LIMIT 1) AS envio_transportista,
            EXISTS (SELECT 1 FROM envio_lineas l JOIN envios e ON e.id = l.envio_id WHERE l.pedido_id = c.id AND e.estado <> 'anulado') AS en_envio
       FROM pedidos_compra c LEFT JOIN proveedores p ON p.id = c.proveedor_id
      WHERE c.estado = 'enviado' AND c.entrega_modo IS NOT NULL AND c.enviado_en > now() - interval '120 days'`);
  for (const p of rows) {
    try {
      const pendiente = p.tipo === 'subcontratacion' || p.por_recibir > 0;
      if (!pendiente) continue;
      const email = p.proveedor_email;
      const url = urlDe(p);
      const yaHoy = p.recordatorio_trp === hoy;
      const enviar = async (asunto, cuerpo) => {
        if (!email || !correo.configurado()) return false;
        await correo.enviarOFallar({ para: email, asunto: `${asunto} · pedido ${p.codigo} · ${aj.empresa.nombre}`, texto: `Hola,\n\n${cuerpo}${url ? `\n\nPodéis actualizarlo aquí, sin usuario:\n${url}` : ''}\n\nGracias,\n${aj.empresa.nombre}${aj.empresa.telefono ? ` · ${aj.empresa.telefono}` : ''}` });
        return true;
      };
      // recogida programada: avisar al proveedor del día (una vez)
      const diaRec = p.envio_recogida || p.recogida_fecha;
      if (p.entrega_modo === 'recogida' && diaRec && !p.aviso_recogida_en && p.envio_transportista) {
        if (await enviar('Recogida', `El ${fechaLarga(diaRec)} pasará ${p.envio_transportista} a recoger el pedido ${p.codigo}${p.recogida_direccion ? ` en ${p.recogida_direccion}` : ''}${p.recogida_horario ? ` (${p.recogida_horario})` : ''}. Tenedlo preparado${p.bultos ? ` (${p.bultos} bultos)` : ''}, por favor.`)) {
          await query('UPDATE pedidos_compra SET aviso_recogida_en = $2 WHERE id = $1', [p.id, hoy]);
          await evento({ query }, p.id, `✉ aviso de recogida (${ddmm(diaRec)}) enviado al proveedor`);
        }
      }
      if (!p.seg_activo || yaHoy) continue;
      // lo trae el proveedor: sin nº de seguimiento a 1 día de la fecha; pasada la fecha sin llegar → recordatorio y luego incidencia
      if (p.entrega_modo === 'proveedor' && p.fecha_entrega) {
        const dias = await laborablesHasta(p.fecha_entrega, hoy);
        if (!p.tracking && p.fecha_entrega >= hoy && (await laborablesHasta(hoy, p.fecha_entrega)) <= 1) {
          if (await enviar('Nº de seguimiento', `El pedido ${p.codigo} está previsto para el ${fechaLarga(p.fecha_entrega)}. ¿Nos indicáis la agencia y el nº de seguimiento?`)) {
            await query('UPDATE pedidos_compra SET recordatorio_trp = $2 WHERE id = $1', [p.id, hoy]);
            await evento({ query }, p.id, '✉ recordatorio: falta el nº de seguimiento');
          }
        } else if (p.fecha_entrega < hoy && dias >= 1) {
          await vencido(p, hoy, enviar, `El pedido ${p.codigo} tenía que llegar el ${fechaLarga(p.fecha_entrega)} y aún no lo tenemos. ¿Nos indicáis cómo va${p.tracking ? '' : ' y el nº de seguimiento'}?`, `No ha llegado el pedido ${p.codigo} (pactado ${ddmm(p.fecha_entrega)})`, dias);
        }
      }
      // al almacén del transportista: pasada la fecha pactada sin entregarlo
      if (p.entrega_modo === 'almacen' && p.fecha_almacen && !p.entregado_almacen && p.fecha_almacen < hoy) {
        const dias = await laborablesHasta(p.fecha_almacen, hoy);
        if (dias >= 1) await vencido(p, hoy, enviar, `Quedamos en que el pedido ${p.codigo} se entregaba en el almacén del transportista el ${fechaLarga(p.fecha_almacen)}. ¿Lo habéis entregado? Marcadlo, por favor, con el albarán.`, `Pedido ${p.codigo} sin entregar en el almacén (pactado ${ddmm(p.fecha_almacen)})`, dias);
      }
    } catch (e) { console.warn('recordatorio transporte pedido', p.codigo, e.message); }
  }
}
// recordatorio al proveedor (cada 2 días laborables) y, la segunda vez, incidencia de transporte contra él
async function vencido(p, hoy, enviar, cuerpo, titulo, dias) {
  const ult = p.recordatorio_trp;
  if (ult && (await laborablesHasta(ult, hoy)) < 2) return;
  const ok = await enviar('¿Cómo va?', cuerpo);
  await query('UPDATE pedidos_compra SET recordatorio_trp = $2 WHERE id = $1', [p.id, hoy]);
  await evento({ query }, p.id, `${ok ? '✉ recordatorio al proveedor' : '⚠ sin correo (no se ha podido recordar al proveedor)'}: ${titulo}`);
  await avisarCompras(p, `⏳ ${titulo}`, ok ? 'Se le ha recordado por correo.' : 'No se le ha podido escribir: llámale o envíale el enlace.');
  if (!p.incidencia_trp_id && (ult || dias >= 2)) {
    const r = await tx((c) => require('./incidencias').crear(c, { tipo: 'transporte', pedido_id: p.id, proveedor_id: p.proveedor_id, area: 'compras', resumen: titulo, titulo: `Pedido ${p.codigo}`, texto: titulo }, null));
    await query('UPDATE pedidos_compra SET incidencia_trp_id = $2 WHERE id = $1', [p.id, r.id]);
    await evento({ query }, p.id, `⚠ incidencia ${r.codigo} abierta`);
  }
}

// para el PDF y el correo del pedido
function lineasPdf(p) {
  if (!p.entrega_modo) return [];
  if (p.entrega_modo === 'almacen' && p.almacen) return [`Entregar en: ${p.almacen.nombre} · ${p.almacen.direccion || ''}${p.almacen.horario ? ` · ${p.almacen.horario}` : ''}${p.almacen.leyenda ? ` · ${p.almacen.leyenda}` : ''}`];
  if (p.entrega_modo === 'recogida') return [`Recogida: pasará ${p.transportista || 'nuestro transportista'}${p.recogida_fecha ? ` el ${ddmm(p.recogida_fecha)}` : ''}${p.recogida_direccion ? ` en ${p.recogida_direccion}` : ''}`];
  return ['Envío a vuestro cargo: indicadnos la agencia y el nº de seguimiento.'];
}

module.exports = { recogidaAceptada, montar, montarPublico, completar, urlDe, lineasPdf, urlTracking, recordatorios, MODOS, AGENCIAS, situacion, evento, fechaAlMaterial };
