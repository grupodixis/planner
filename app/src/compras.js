// Compras: proveedores y pedidos de compra.
//  · Un pedido se prepara con líneas de «Por pedir» (material de partidas) y/o líneas a mano.
//  · Si el total pasa del límite (ajustes «compras»), lo aprueba quien tiene «aprobar_compras» (Dirección).
//  · Al enviarlo: PDF del pedido por correo al proveedor (o «lo envío yo» si no hay correo configurado),
//    y sus líneas de material pasan a «Pedido» con proveedor, fecha, nº de pedido y precio.
const PDFDocument = require('pdfkit');
const REF = require('./referencias');
const { query, tx } = require('./db');
const auth = require('./auth');
const notif = require('./notificaciones');
const correo = require('./correo');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
const eur = (x) => `${Number(x || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const cantTxt = (x) => Number(x).toLocaleString('es-ES', { maximumFractionDigits: 3 });

const AJUSTES_DEF = {
  limite_aprobacion: 3000,
  // datos de la empresa (los que salen en los presupuestos de HAM); lo que se rellene en Ajustes manda
  empresa: { nombre: 'HAM Menorca', cif: 'B57825432', direccion: 'Av. Circunval·lació, 11 · Pol. Ind. Sant Lluís, 07710 Sant Lluís (Menorca)', telefono: '+34 971 35 20 18',
    email: 'compras@hamenorca.com', razon_social: 'Dixis Recursos y Soluciones S.L.', nombre_comercial: 'HAM Estructuras Metálicas Menorca', movil: '+34 669 769 541',
    email_comercial: 'info@hamenorca.com', web: 'www.hamenorca.com' },
  entregar_en: 'Taller HAM Menorca',
  condiciones: 'Indicar el nº de pedido en el albarán y en la factura.\nEnviar el certificado de material (3.1 EN 10204) con la entrega cuando corresponda.\nFacturas a compras@hamenorca.com.',
};
async function ajustes() {
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'compras'`);
  const v = rows[0]?.valor || {};
  const emp = { ...AJUSTES_DEF.empresa };
  for (const [k, x] of Object.entries(v.empresa || {})) if (x) emp[k] = x;   // un campo vacío en Ajustes no borra el de serie
  return { ...AJUSTES_DEF, ...v, empresa: emp };
}

/* ---------- Proveedores ---------- */
const CAMPOS_PROV = { nombre: 120, cif: 20, email: 200, email_admin: 200, telefono: 60, contacto: 120, localidad: 120, forma_pago: 120, portes: 200, web: 200, notas: 2000 };
const SQL_PROV = `SELECT p.*, (SELECT count(*)::int FROM pedidos_compra c WHERE c.proveedor_id = p.id AND c.estado = 'enviado') AS pedidos,
                         (SELECT max(enviado_en) FROM pedidos_compra c WHERE c.proveedor_id = p.id) AS ultimo_pedido
                    FROM proveedores p`;

/* ---------- Pedidos ---------- */
const SQL_PEDIDO = `
  SELECT c.*, p.nombre AS proveedor, p.email AS proveedor_email, p.cif AS proveedor_cif, p.forma_pago AS proveedor_forma_pago,
         uc.nombre AS creado_por_nombre, ua.nombre AS aprobado_por_nombre, ue.nombre AS enviado_por_nombre,
         (SELECT count(*)::int FROM pedido_compra_lineas l WHERE l.pedido_id = c.id) AS n_lineas,
         COALESCE((SELECT string_agg(DISTINCT pr.codigo, ', ') FROM pedido_compra_lineas l JOIN partida_escandallo e ON e.id = l.escandallo_id
            JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos pr ON pr.id = pa.proyecto_id WHERE l.pedido_id = c.id),
           (SELECT '🏭 OT ' || o.codigo || ' ' || o.titulo FROM ordenes o WHERE o.id = c.orden_id)) AS proyectos,
         (SELECT o.codigo FROM ordenes o WHERE o.id = c.orden_id) AS ot_codigo, (SELECT o.titulo FROM ordenes o WHERE o.id = c.orden_id) AS ot_titulo
    FROM pedidos_compra c LEFT JOIN proveedores p ON p.id = c.proveedor_id
    LEFT JOIN usuarios uc ON uc.id = c.creado_por LEFT JOIN usuarios ua ON ua.id = c.aprobado_por LEFT JOIN usuarios ue ON ue.id = c.enviado_por`;

async function pedido(id, c = { query }) {
  const { rows } = await c.query(`${SQL_PEDIDO} WHERE c.id = $1`, [id]);
  if (!rows.length) return null;
  const { rows: lineas } = await c.query(
    `SELECT l.id, l.escandallo_id, l.tarea_id, l.descripcion, l.cantidad::float AS cantidad, l.unidad, l.precio::float AS precio, l.orden,
            pr.codigo AS proyecto_codigo, pa.codigo AS partida_codigo, pa.nombre AS partida_nombre, e.compra, e.precio_pedido::float AS precio_pedido,
            pr.id AS proyecto_id, pa.id AS partida_id, ${REF.SQL_OTS} AS ots, ${REF.SQL_PROY_TAREA} AS proyecto_tarea,
            -- a qué tareas está asignado ese material (o la tarea de la línea, si es de subcontratación): para enlazarlas
            COALESCE((SELECT json_agg(json_build_object('id', t.id, 'codigo', t.codigo, 'nombre', t.nombre, 'ot_id', o.id, 'ot_codigo', o.codigo,
                                                        'proyecto_id', o.proyecto_id) ORDER BY t.codigo)
                        FROM tareas t JOIN ordenes o ON o.id = t.orden_id
                       WHERE t.id = l.tarea_id OR t.id IN (SELECT tm.tarea_id FROM tarea_material tm WHERE tm.escandallo_id = l.escandallo_id)), '[]') AS tareas
       FROM pedido_compra_lineas l
       LEFT JOIN partida_escandallo e ON e.id = l.escandallo_id
       LEFT JOIN partidas pa ON pa.id = e.partida_id LEFT JOIN proyectos pr ON pr.id = pa.proyecto_id
      WHERE l.pedido_id = $1 ORDER BY l.orden, l.id`, [id]);
  const aj = await ajustes();
  const p = rows[0];
  p.total = Number(p.total);
  p.lineas = lineas;
  p.albaranes = (await require('./archivos').de('pedido_albaran', [p.id])).get(p.id) || [];   // los que sube logística al recibir
  p.limite = aj.limite_aprobacion;
  p.necesita_aprobacion = p.total > aj.limite_aprobacion;
  return p;
}

async function recalcular(c, id) {
  await c.query(`UPDATE pedidos_compra SET total = COALESCE((SELECT round(sum(cantidad * COALESCE(precio, 0)), 2)
                   FROM pedido_compra_lineas WHERE pedido_id = $1), 0) WHERE id = $1`, [id]);
}

async function siguienteCodigo(c) {
  const y = new Date().getFullYear();
  const { rows } = await c.query(`SELECT max(substring(codigo from '\\d+$')::int) AS n FROM pedidos_compra WHERE codigo LIKE $1`, [`PC-${y}-%`]);
  return `PC-${y}-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}

// Líneas de material «por pedir» que no están ya en un pedido ni pidiendo precio (con lo que falta y cuándo hace falta)
async function lineasLibres(c, ids, { solicitud = null } = {}) {
  if (!ids.length) return [];
  const { rows: ls } = await c.query(
    `SELECT e.id, e.descripcion, e.unidad, GREATEST(e.cantidad - COALESCE(e.stock, 0), 0)::float AS falta, e.compra, e.pedido_compra_id, e.solicitud_id,
            pr.codigo AS proyecto, pr.nombre AS proyecto_nombre,
            (SELECT min(x.fecha) FROM tarea_material m JOIN tramos x ON x.tarea_id = m.tarea_id WHERE m.escandallo_id = e.id) AS necesaria
       FROM partida_escandallo e JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos pr ON pr.id = pa.proyecto_id
      WHERE e.id = ANY($1)`, [ids]);
  if (ls.length !== ids.length) throw fallo(400, 'Alguna línea de material ya no existe');
  const ocupada = ls.find((l) => l.pedido_compra_id);
  if (ocupada) throw fallo(400, `«${ocupada.descripcion}» ya está en un pedido`);
  const pidiendo = ls.find((l) => l.solicitud_id && l.solicitud_id !== solicitud);
  if (pidiendo) throw fallo(400, `«${pidiendo.descripcion}» ya está pidiendo precio`);
  const noPend = ls.find((l) => l.compra !== 'por_pedir');
  if (noPend) throw fallo(400, `«${noPend.descripcion}» no está «por pedir»`);
  return ls;
}

// Crea un pedido en borrador con sus líneas; las de material quedan enlazadas al pedido
// Las líneas de material de un pedido enviado pasan a «Pedido» (logística las ve por recibir)
async function pasarAPedido(c, p, usuarioId) {
  for (const l of p.lineas.filter((x) => x.escandallo_id)) {
    await c.query(`UPDATE partida_escandallo SET compra = 'pedido', proveedor_id = $2, fecha_prevista = $3, pedido_por = $4, pedido_en = now(),
                          num_pedido = $5, precio_pedido = $6, pedido_compra_id = $7
                    WHERE id = $1 AND compra IN ('por_pedir', 'pedido')`,
    [l.escandallo_id, p.proveedor_id, p.fecha_entrega ? String(p.fecha_entrega).slice(0, 10) : null, usuarioId, p.codigo, l.precio, p.id]);
  }
}

// Precios de las líneas de un pedido ya enviado (pedido por teléfono, o lo que confirma el proveedor):
// { pedido_compra_lineas.id: precio }. Actualiza el material, el total y la lista de precios. Devuelve qué cambió.
async function ponerPrecios(c, pedidoId, precios, usuarioId) {
  const cambios = [];
  for (const [k, v] of Object.entries(precios || {})) {
    const pr = num(v);
    if (pr == null || !Number.isFinite(pr) || pr < 0 || pr > 1e7) continue;
    const { rows: [l] } = await c.query('SELECT id, escandallo_id, descripcion, precio::float AS precio FROM pedido_compra_lineas WHERE id = $1 AND pedido_id = $2', [Number(k), pedidoId]);
    if (!l || (l.precio != null && Math.abs(l.precio - pr) < 0.00005)) continue;
    await c.query('UPDATE pedido_compra_lineas SET precio = $2 WHERE id = $1', [l.id, pr]);
    if (l.escandallo_id) await c.query('UPDATE partida_escandallo SET precio_pedido = $2 WHERE id = $1 AND pedido_compra_id = $3', [l.escandallo_id, pr, pedidoId]);
    cambios.push({ descripcion: l.descripcion, antes: l.precio, ahora: pr });
  }
  if (cambios.length) {
    await recalcular(c, pedidoId);
    await require('./precios').registrarPedido(c, pedidoId, usuarioId);
  }
  return cambios;
}

async function crearPedido(c, { proveedor_id, lineas, fecha_entrega, referencia, usuarioId, tipo = 'material', orden_id = null, observaciones = null }) {
  const aj = await ajustes();
  let formaPago = null;
  if (proveedor_id) { const { rows } = await c.query('SELECT forma_pago FROM proveedores WHERE id = $1', [proveedor_id]); formaPago = rows[0]?.forma_pago || null; }
  const codigo = await siguienteCodigo(c);
  const { rows } = await c.query(
    `INSERT INTO pedidos_compra (codigo, proveedor_id, fecha_entrega, entregar_en, referencia, forma_pago, creado_por, tipo, orden_id, observaciones)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [codigo, proveedor_id || null, fecha_entrega || null, tipo === 'subcontratacion' ? null : aj.entregar_en, texto(referencia, 300), formaPago, usuarioId,
      tipo, orden_id, texto(observaciones, 3000)]);
  const pid = rows[0].id;
  let i = 0;
  for (const l of lineas) {
    await c.query(`INSERT INTO pedido_compra_lineas (pedido_id, escandallo_id, tarea_id, descripcion, cantidad, unidad, precio, orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [pid, l.escandallo_id || null, l.tarea_id || null, l.descripcion, l.cantidad, l.unidad || null, l.precio ?? null, i++]);
    if (l.tarea_id) await c.query('UPDATE tareas SET ext_pedido_id = $2, ext_solicitud_id = NULL WHERE id = $1', [l.tarea_id, pid]);
    if (l.escandallo_id) await c.query('UPDATE partida_escandallo SET pedido_compra_id = $2, solicitud_id = NULL WHERE id = $1', [l.escandallo_id, pid]);
  }
  await recalcular(c, pid);
  return pid;
}

/* ---------- PDF del pedido ---------- */
function pdfPedido(p, aj) {
  return new Promise((ok, mal) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Pedido ${p.codigo}`, Author: aj.empresa.nombre } });
    const trozos = [];
    doc.on('data', (b) => trozos.push(b));
    doc.on('end', () => ok(Buffer.concat(trozos)));
    doc.on('error', mal);
    const gris = '#555555';
    const W = doc.page.width - 96;
    // cabecera
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(aj.empresa.nombre, 48, 48);
    doc.font('Helvetica').fontSize(9).fillColor(gris)
      .text([aj.empresa.cif && `CIF ${aj.empresa.cif}`, aj.empresa.direccion, aj.empresa.telefono, aj.empresa.email].filter(Boolean).join(' · '), 48, 70, { width: W * 0.6 });
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#111').text(p.tipo === 'subcontratacion' ? 'PEDIDO DE SUBCONTRATACIÓN' : 'PEDIDO DE COMPRA', 48, 48, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#111')
      .text(p.codigo, 48, 68, { width: W, align: 'right' })
      .text(new Date(p.enviado_en || Date.now()).toLocaleDateString('es-ES'), 48, 82, { width: W, align: 'right' });
    // datos
    let y = 112;
    doc.roundedRect(48, y, W, 70, 4).fill('#f2f2f2');
    doc.fillColor('#111').fontSize(10);
    const fila = (et, v, yy) => { doc.font('Helvetica-Bold').text(et, 60, yy, { continued: true }).font('Helvetica').text(` ${v || '—'}`); };
    fila('Proveedor:', `${p.proveedor || '—'}${p.proveedor_cif ? ` · CIF ${p.proveedor_cif}` : ''}`, y + 10);
    fila('Entrega:', `${p.fecha_entrega ? new Date(`${String(p.fecha_entrega).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : 'a convenir'}${p.entregar_en ? ` · ${p.entregar_en}` : ''}`, y + 26);
    // la referencia que escribe compras, y siempre los proyectos de las líneas (trazabilidad)
    const faltan = REF.proyectos(p.lineas).split(', ').filter((c) => c && !String(p.referencia || '').includes(c));
    fila('Referencia:', [p.referencia, faltan.length ? `Proyecto ${faltan.join(', ')}` : null].filter(Boolean).join(' · '), y + 42);
    if (p.forma_pago) doc.font('Helvetica-Bold').text('Pago:', 60 + W * 0.55, y + 42, { continued: true }).font('Helvetica').text(` ${p.forma_pago}`);
    y += 90;
    // líneas
    const col = [48, 48 + W * 0.56, 48 + W * 0.72, 48 + W * 0.86];
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gris);
    doc.text('Descripción', col[0], y).text('Cantidad', col[1], y, { width: W * 0.15, align: 'right' })
      .text('Precio', col[2], y, { width: W * 0.13, align: 'right' }).text('Importe', col[3], y, { width: W * 0.14, align: 'right' });
    y += 14;
    doc.moveTo(48, y).lineTo(48 + W, y).strokeColor('#999').stroke();
    y += 6;
    doc.font('Helvetica').fontSize(10).fillColor('#111');
    for (const l of p.lineas) {
      const ref = REF.paraPdf(REF.enDocumento(l, p.lineas, { largo: 45 })); const desc = REF.paraPdf(l.descripcion);
      const h = Math.max(doc.heightOfString(desc, { width: W * 0.54 }), 12);
      const hr = ref ? doc.fontSize(8).heightOfString(`Ref.: ${ref}`, { width: W * 0.54 }) + 2 : 0; doc.fontSize(10);
      if (y + h + hr > doc.page.height - 140) { doc.addPage(); y = 48; }
      if (ref) { doc.fontSize(8).fillColor(gris).text(`Ref.: ${ref}`, col[0], y + h + 1, { width: W * 0.54 }); doc.fontSize(10).fillColor('#111'); }
      doc.text(desc, col[0], y, { width: W * 0.54 });
      doc.text(`${cantTxt(l.cantidad)} ${l.unidad || ''}`, col[1], y, { width: W * 0.15, align: 'right' });
      doc.text(l.precio == null ? '—' : eur(l.precio), col[2], y, { width: W * 0.13, align: 'right' });
      doc.text(l.precio == null ? '—' : eur(l.cantidad * l.precio), col[3], y, { width: W * 0.14, align: 'right' });
      y += h + hr + 6;
      doc.moveTo(48, y - 3).lineTo(48 + W, y - 3).strokeColor('#e2e2e2').stroke();
    }
    y += 6;
    doc.font('Helvetica-Bold').fontSize(11).text(`Total: ${eur(p.total)} + IVA`, 48, y, { width: W, align: 'right' });
    y += 30;
    // cómo llega (almacén del transportista con su leyenda, recogida o agencia)
    const trp = require('./pedido-transporte').lineasPdf(p);
    if (trp.length) { doc.font('Helvetica-Bold').fontSize(9).fillColor('#111').text('Transporte', 48, y); doc.font('Helvetica').text(trp.join('\n'), 48, y + 12, { width: W }); y = doc.y + 12; }
    if (p.seg_url && !p.seguimiento_url) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#10776c').text('Confirmación y seguimiento del pedido', 48, y);
      doc.font('Helvetica').fontSize(9).fillColor('#111').text('Confirme el pedido y díganos cómo y cuándo lo envía en este enlace, sin registrarse:', 48, y + 13, { width: W });
      doc.fillColor('#10776c').text(p.seg_url, 48, doc.y + 2, { width: W, link: p.seg_url, underline: true }); doc.fillColor('#111');
      y = doc.y + 14;
    }
    if (p.observaciones) { doc.font('Helvetica-Bold').fontSize(9).text('Observaciones', 48, y); doc.font('Helvetica').text(p.observaciones, 48, y + 12, { width: W }); y = doc.y + 12; }
    if (p.seguimiento_url) {
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#10776c').text('Seguimiento del trabajo', 48, y);
      doc.font('Helvetica').fontSize(9).fillColor('#111').text('Indíquenos aquí cómo va (inicio, avance, fecha prevista, fotos y entrega), sin registrarse:', 48, y + 13, { width: W });
      doc.fillColor('#10776c').text(p.seguimiento_url, 48, doc.y + 2, { width: W, link: p.seguimiento_url, underline: true });
      y = doc.y + 14;
    }
    if (aj.condiciones) { doc.font('Helvetica-Bold').fontSize(9).fillColor(gris).text('Condiciones', 48, y); doc.font('Helvetica').text(aj.condiciones, 48, y + 12, { width: W }); }
    doc.end();
  });
}

function montar(app, asyncH) {
  const verProv = auth.permiso('compras', 'logistica', 'escandallo', 'aprobar_compras');
  const pCompras = auth.permiso('compras');
  const verPedidos = auth.permiso('compras', 'aprobar_compras', 'logistica');
  const pAprobar = auth.permiso('aprobar_compras');

  /* ---------- Ajustes ---------- */
  // Correo de salida (servidor SMTP). La contraseña entra pero nunca sale.
  const pCorreo = auth.permiso('usuarios');
  app.get('/api/ajustes/correo', pCorreo, asyncH(async (req, res) => res.json(await correo.verAjustes())));
  app.put('/api/ajustes/correo', pCorreo, asyncH(async (req, res) => res.json(await correo.guardarAjustes(req.body || {}, req.usuario.id))));
  app.post('/api/ajustes/correo/probar', pCorreo, asyncH(async (req, res) => {
    const para = req.body?.para ? String(req.body.para).trim() : null;
    if (para && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(para)) throw fallo(400, 'Correo de destino no válido');
    res.json(await correo.probar(para));
  }));
  app.get('/api/compras/ajustes', verPedidos, asyncH(async (req, res) => res.json({ ...(await ajustes()), correo: correo.configurado(), remitente: correo.remitente() })));
  app.put('/api/compras/ajustes', auth.permiso('aprobar_compras', 'usuarios'), asyncH(async (req, res) => {
    const b = req.body || {};
    const act = await ajustes();
    const lim = num(b.limite_aprobacion);
    if (lim != null && (!Number.isFinite(lim) || lim < 0)) throw fallo(400, 'Límite no válido');
    const v = {
      limite_aprobacion: lim ?? act.limite_aprobacion,
      entregar_en: texto(b.entregar_en, 300) ?? act.entregar_en,
      condiciones: b.condiciones != null ? String(b.condiciones).slice(0, 3000) : act.condiciones,
      empresa: { ...act.empresa },
    };
    for (const k of ['nombre', 'cif', 'direccion', 'telefono', 'email', 'razon_social', 'nombre_comercial', 'movil', 'email_comercial', 'web']) if (b.empresa && k in b.empresa) v.empresa[k] = texto(b.empresa[k], 200) || '';
    await query(`INSERT INTO ajustes (clave, valor) VALUES ('compras', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(v)]);
    res.json(v);
  }));

  /* ---------- Proveedores ---------- */
  app.get('/api/proveedores', verProv, asyncH(async (req, res) => {
    const { rows } = await query(`${SQL_PROV} ORDER BY p.activo DESC, lower(p.nombre)`);
    res.json(rows);
  }));
  app.post('/api/proveedores', pCompras, asyncH(async (req, res) => {
    const nombre = texto(req.body?.nombre, 120);
    if (!nombre) throw fallo(400, 'Falta el nombre');
    const { rows } = await query('INSERT INTO proveedores (nombre) VALUES ($1) RETURNING id', [nombre]);
    res.status(201).json({ id: rows[0].id });
  }));
  app.put('/api/proveedores/:id', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const sets = []; const vals = [id];
    for (const [k, max] of Object.entries(CAMPOS_PROV)) if (k in b) { vals.push(texto(b[k], max)); sets.push(`${k} = $${vals.length}`); }
    if ('nombre' in b && !texto(b.nombre)) throw fallo(400, 'El nombre no puede quedar vacío');
    if ('plazo_dias' in b) { const n = num(b.plazo_dias); vals.push(Number.isInteger(n) && n >= 0 ? n : null); sets.push(`plazo_dias = $${vals.length}`); }
    if ('materiales' in b) { vals.push((Array.isArray(b.materiales) ? b.materiales : []).map((x) => texto(x, 60)).filter(Boolean).slice(0, 30)); sets.push(`materiales = $${vals.length}`); }
    if ('activo' in b) { vals.push(!!b.activo); sets.push(`activo = $${vals.length}`); }
    if ('transportista' in b) { vals.push(!!b.transportista); sets.push(`transportista = $${vals.length}`); }
    if ('cuenta_credito' in b) { vals.push(!!b.cuenta_credito); sets.push(`cuenta_credito = $${vals.length}`); }
    if ('zona' in b) { vals.push(['menorca', 'peninsula', 'baleares', 'online'].includes(b.zona) ? b.zona : 'menorca'); sets.push(`zona = $${vals.length}`); }
    if (!sets.length) return res.json({ ok: true });
    const { rowCount } = await query(`UPDATE proveedores SET ${sets.join(', ')} WHERE id = $1`, vals);
    if (!rowCount) throw fallo(404, 'Proveedor no encontrado');
    const { rows } = await query(`${SQL_PROV} WHERE p.id = $1`, [id]);
    res.json(rows[0]);
  }));

  /* ---------- Pedidos ---------- */
  app.get('/api/compras/pedidos', verPedidos, asyncH(async (req, res) => {
    const { rows } = await query(`${SQL_PEDIDO} WHERE c.estado <> 'anulado' AND (c.estado <> 'enviado' OR c.enviado_en > now() - interval '90 days')
                                  ORDER BY c.creado DESC LIMIT 300`);
    const aj = await ajustes();
    res.json({ pedidos: rows.map((p) => ({ ...p, total: Number(p.total), necesita_aprobacion: Number(p.total) > aj.limite_aprobacion })), limite: aj.limite_aprobacion, correo: correo.configurado() });
  }));

  app.get('/api/compras/pedidos/:id', verPedidos, asyncH(async (req, res) => {
    const p = await pedido(Number(req.params.id));
    if (!p) throw fallo(404, 'Pedido no encontrado');
    res.json(await require('./pedido-transporte').completar(p, req));
  }));

  // Nuevo pedido: { proveedor_id?, escandallo_ids?: [] } (líneas de «Por pedir»)
  app.post('/api/compras/pedidos', pCompras, asyncH(async (req, res) => {
    const b = req.body || {};
    const ids = (Array.isArray(b.escandallo_ids) ? b.escandallo_ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
    const id = await tx(async (c) => {
      const ls = await lineasLibres(c, ids);
      return crearPedido(c, {
        proveedor_id: b.proveedor_id ? Number(b.proveedor_id) : null,
        lineas: ls.map((l) => ({ escandallo_id: l.id, descripcion: l.descripcion, cantidad: l.falta, unidad: l.unidad, precio: null })),
        fecha_entrega: ls.map((l) => l.necesaria).filter(Boolean).sort()[0] || null,
        referencia: [...new Set(ls.map((l) => `${l.proyecto} · ${l.proyecto_nombre}`))].join(' / '),
        usuarioId: req.usuario.id,
      });
    });
    res.status(201).json(await pedido(id));
  }));

  const editable = (p) => ['borrador', 'por_aprobar'].includes(p.estado);

  // Cambiar datos y líneas: { proveedor_id, fecha_entrega, entregar_en, referencia, forma_pago, observaciones,
  //   lineas: [{ id?, descripcion, cantidad, unidad, precio }] }  (las que no vienen se quitan)
  app.put('/api/compras/pedidos/:id', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    await tx(async (c) => {
      const p = await pedido(id, c);
      if (!p) throw fallo(404, 'Pedido no encontrado');
      if (!editable(p)) throw fallo(400, 'Un pedido enviado ya no se cambia');
      const sets = []; const vals = [id];
      const poner = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
      if ('proveedor_id' in b) poner('proveedor_id', b.proveedor_id ? Number(b.proveedor_id) : null);
      if ('fecha_entrega' in b) poner('fecha_entrega', fechaOk(b.fecha_entrega));
      for (const [k, m] of [['entregar_en', 300], ['referencia', 300], ['forma_pago', 120], ['observaciones', 3000]]) if (k in b) poner(k, texto(b[k], m));
      // si ya se había pedido aprobación y cambia algo, vuelve a borrador
      if (p.estado === 'por_aprobar' && (sets.length || Array.isArray(b.lineas))) sets.push(`estado = 'borrador'`, 'aprobacion_pedida_en = NULL');
      if (sets.length) await c.query(`UPDATE pedidos_compra SET ${sets.join(', ')} WHERE id = $1`, vals);
      if (Array.isArray(b.lineas)) {
        const quedan = new Set(b.lineas.map((l) => Number(l.id)).filter(Boolean));
        const fuera = p.lineas.filter((l) => !quedan.has(l.id));
        for (const l of fuera) {
          if (l.escandallo_id) await c.query('UPDATE partida_escandallo SET pedido_compra_id = NULL WHERE id = $1 AND pedido_compra_id = $2', [l.escandallo_id, id]);
          if (l.tarea_id) await c.query('UPDATE tareas SET ext_pedido_id = NULL WHERE id = $1 AND ext_pedido_id = $2', [l.tarea_id, id]);
          await c.query('DELETE FROM pedido_compra_lineas WHERE id = $1', [l.id]);
        }
        let i = 0;
        for (const l of b.lineas.slice(0, 200)) {
          const cant = num(l.cantidad); const precio = num(l.precio);
          if (cant != null && (!Number.isFinite(cant) || cant < 0)) throw fallo(400, 'Cantidad no válida');
          if (precio != null && (!Number.isFinite(precio) || precio < 0)) throw fallo(400, 'Precio no válido');
          const desc = texto(l.descripcion, 300);
          if (l.id) {
            await c.query(`UPDATE pedido_compra_lineas SET descripcion = COALESCE($3, descripcion), cantidad = COALESCE($4, cantidad), unidad = COALESCE($5, unidad), precio = $6, orden = $7
                            WHERE id = $1 AND pedido_id = $2`, [Number(l.id), id, desc, cant, texto(l.unidad, 20), precio, i++]);
          } else {
            if (!desc) continue;
            await c.query(`INSERT INTO pedido_compra_lineas (pedido_id, descripcion, cantidad, unidad, precio, orden) VALUES ($1,$2,$3,$4,$5,$6)`,
              [id, desc, cant || 0, texto(l.unidad, 20), precio, i++]);
          }
        }
      }
      await recalcular(c, id);
    });
    res.json(await pedido(id));
  }));

  app.delete('/api/compras/pedidos/:id', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx(async (c) => {
      const p = await pedido(id, c);
      if (!p) throw fallo(404, 'Pedido no encontrado');
      if (!editable(p)) throw fallo(400, 'Un pedido enviado no se borra');
      await c.query('UPDATE partida_escandallo SET pedido_compra_id = NULL WHERE pedido_compra_id = $1', [id]);
      await c.query('UPDATE tareas SET ext_pedido_id = NULL WHERE ext_pedido_id = $1', [id]);
      await c.query('DELETE FROM pedidos_compra WHERE id = $1', [id]);
    });
    res.json({ ok: true });
  }));

  // 📞 Ya pedido por teléfono: queda como pedido de compra ENVIADO (sin correo), con lo que se sepa. Lo completa su
  // confirmación por correo (compras@) o se completa a mano. { escandallo_ids, proveedor_id, fecha_entrega, num_proveedor,
  //   precios: { escandallo_id: precio }, nota }
  app.post('/api/compras/pedidos/telefono', pCompras, asyncH(async (req, res) => {
    const b = req.body || {};
    const ids = (Array.isArray(b.escandallo_ids) ? b.escandallo_ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
    if (!b.proveedor_id) throw fallo(400, 'Elige a qué proveedor se lo has pedido');
    const id = await tx(async (c) => {
      const ls = await lineasLibres(c, ids);
      const pid = await crearPedido(c, {
        proveedor_id: Number(b.proveedor_id),
        lineas: ls.map((l) => ({ escandallo_id: l.id, descripcion: l.descripcion, cantidad: l.falta, unidad: l.unidad, precio: num(b.precios?.[l.id]) })),
        fecha_entrega: fechaOk(b.fecha_entrega) || ls.map((l) => l.necesaria).filter(Boolean).sort()[0] || null,
        referencia: [...new Set(ls.map((l) => `${l.proyecto} · ${l.proyecto_nombre}`))].join(' / '),
        observaciones: texto(b.nota, 1000), usuarioId: req.usuario.id,
      });
      await c.query(`UPDATE pedidos_compra SET estado = 'enviado', por_telefono = TRUE, enviado_por = $2, enviado_en = now(), enviado_correo = FALSE,
                            prov_num_confirmacion = $3 WHERE id = $1`, [pid, req.usuario.id, texto(b.num_proveedor, 80)]);
      const p = await pedido(pid, c);
      await pasarAPedido(c, p, req.usuario.id);
      await require('./precios').registrarPedido(c, pid, req.usuario.id);
      await require('./pedido-transporte').evento(c, pid, `📞 Pedido por teléfono a ${p.proveedor}${b.num_proveedor ? ` (su nº ${texto(b.num_proveedor, 80)})` : ''}`, { usuario: req.usuario.id });
      return pid;
    });
    const p = await pedido(id);
    if (p.necesita_aprobacion) {
      notif.avisarLuego(notif.conPermiso('aprobar_compras'), 'compra_aprobar', {
        titulo: `Pedido por teléfono sin aprobar: ${p.codigo}`,
        cuerpo: `${p.proveedor} · ${eur(p.total)} (pasa del límite) · lo pidió ${req.usuario.nombre}`, url: `/compras.html?pedido=${id}`, tag: `pedido-tel-${id}`,
      });
    }
    notif.avisarLuego(notif.conPermiso('logistica', 'escandallo'), 'mat_pedido', {
      titulo: `Pedido ${p.codigo} (por teléfono)`,
      cuerpo: `${p.proveedor} · ${p.lineas.length} línea${p.lineas.length === 1 ? '' : 's'}${p.fecha_entrega ? ` · llega el ${ddmm(p.fecha_entrega)}` : ''}`,
      url: '/logistica.html?vista=recibir', tag: `pedido-c-${id}`,
    });
    res.status(201).json(p);
  }));

  // Completar los precios de un pedido por teléfono (si no llega su confirmación por correo): { lineas: { id: precio } }
  app.put('/api/compras/pedidos/:id/precios', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const cambios = await tx(async (c) => {
      const p = await pedido(id, c);
      if (!p) throw fallo(404, 'Pedido no encontrado');
      if (!p.por_telefono || p.estado !== 'enviado') throw fallo(400, 'Solo se completan así los pedidos por teléfono');
      const cs = await ponerPrecios(c, id, req.body?.lineas, req.usuario.id);
      if (cs.length) await require('./pedido-transporte').evento(c, id, `✎ Precios apuntados a mano: ${cs.map((x) => `${x.descripcion} ${eur(x.ahora)}`).join(' · ')}`, { usuario: req.usuario.id });
      return cs;
    });
    res.json({ ...(await pedido(id)), cambios });
  }));

  // Anular un pedido ya enviado: lo que no ha llegado vuelve a «Por pedir» (lo recibido se queda). { motivo }
  app.post('/api/compras/pedidos/:id/anular', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const motivo = texto(req.body?.motivo, 500);
    if (!motivo) throw fallo(400, 'Escribe el motivo');
    const vuelven = await tx(async (c) => {
      const p = await pedido(id, c);
      if (!p) throw fallo(404, 'Pedido no encontrado');
      if (p.estado !== 'enviado') throw fallo(400, 'Solo se anula un pedido enviado (uno sin enviar se borra)');
      const { rows } = await c.query(`UPDATE partida_escandallo SET compra = 'por_pedir', proveedor_id = NULL, fecha_prevista = NULL, pedido_por = NULL, pedido_en = NULL,
                                             pedido_compra_id = NULL, precio_pedido = NULL, num_pedido = NULL
                                       WHERE pedido_compra_id = $1 AND compra = 'pedido' RETURNING id`, [id]);
      await c.query('UPDATE tareas SET ext_pedido_id = NULL WHERE ext_pedido_id = $1', [id]);
      await c.query(`UPDATE pedidos_compra SET estado = 'anulado', anulado_en = now(), anulado_por = $2, anulado_motivo = $3 WHERE id = $1`, [id, req.usuario.id, motivo]);
      await c.query(`DELETE FROM precios WHERE pedido_id = $1`, [id]).catch(() => {});
      await require('./pedido-transporte').evento(c, id, `✕ Anulado: ${motivo}`, { usuario: req.usuario.id });
      return rows.length;
    });
    notif.avisarLuego(notif.conPermiso('logistica', 'escandallo'), 'mat_pedido', {
      titulo: `Pedido anulado`, cuerpo: `${vuelven} línea(s) vuelven a «Por pedir» · ${motivo}`, url: '/logistica.html?vista=comprar', tag: `pedido-anulado-${id}`,
    });
    res.json({ ...(await pedido(id)), vuelven });
  }));

  // Pedir aprobación a Dirección
  app.post('/api/compras/pedidos/:id/aprobacion', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const p = await pedido(id);
    if (!p) throw fallo(404, 'Pedido no encontrado');
    if (p.estado !== 'borrador') throw fallo(400, 'Este pedido no está en borrador');
    if (!p.proveedor_id) throw fallo(400, 'Elige el proveedor');
    if (!p.lineas.length) throw fallo(400, 'El pedido no tiene líneas');
    if (p.lineas.some((l) => l.precio == null)) throw fallo(400, 'Falta el precio de alguna línea');
    await query(`UPDATE pedidos_compra SET estado = 'por_aprobar', aprobacion_pedida_en = now(), rechazo = NULL WHERE id = $1`, [id]);
    notif.avisarLuego(notif.conPermiso('aprobar_compras'), 'compra_aprobar', {
      titulo: `Pedido por aprobar: ${p.codigo}`,
      cuerpo: `${p.proveedor} · ${eur(p.total)}${p.proyectos ? ` · ${p.proyectos}` : ''} · lo pide ${req.usuario.nombre}`,
      url: `/compras.html?pedido=${id}`, tag: `compra-${id}`, urgente: true,
    });
    res.json(await pedido(id));
  }));

  app.post('/api/compras/pedidos/:id/aprobar', pAprobar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const p = await pedido(id);
    if (!p) throw fallo(404, 'Pedido no encontrado');
    if (!['por_aprobar', 'borrador'].includes(p.estado)) throw fallo(400, 'Este pedido no está pendiente de aprobar');
    await query(`UPDATE pedidos_compra SET estado = 'aprobado', aprobado_por = $2, aprobado_en = now(), rechazo = NULL WHERE id = $1`, [id, req.usuario.id]);
    if (p.creado_por && p.creado_por !== req.usuario.id) {
      notif.avisarLuego([p.creado_por], 'compra_aprobada', { titulo: `✔ Aprobado: ${p.codigo}`, cuerpo: `${p.proveedor} · ${eur(p.total)} · ya se puede enviar`, url: `/compras.html?pedido=${id}`, tag: `compra-${id}` });
    }
    res.json(await pedido(id));
  }));

  app.post('/api/compras/pedidos/:id/rechazar', pAprobar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const p = await pedido(id);
    if (!p) throw fallo(404, 'Pedido no encontrado');
    if (p.estado !== 'por_aprobar') throw fallo(400, 'Este pedido no está pendiente de aprobar');
    const motivo = texto(req.body?.motivo, 500);
    if (!motivo) throw fallo(400, 'Escribe el motivo');
    await query(`UPDATE pedidos_compra SET estado = 'borrador', rechazo = $2, aprobacion_pedida_en = NULL WHERE id = $1`, [id, motivo]);
    if (p.creado_por) notif.avisarLuego([p.creado_por], 'compra_aprobada', { titulo: `✗ No aprobado: ${p.codigo}`, cuerpo: motivo, url: `/compras.html?pedido=${id}`, tag: `compra-${id}` });
    res.json(await pedido(id));
  }));

  app.get('/api/compras/pedidos/:id/pdf', verPedidos, asyncH(async (req, res) => {
    const p = await pedido(Number(req.params.id));
    if (!p) throw fallo(404, 'Pedido no encontrado');
    if (p.tipo === 'subcontratacion' && p.orden_id && auth.tiene(req.usuario, 'compras')) p.seguimiento_url = await require('./seguimiento-ext').urlActiva(p.orden_id, p.proveedor_id, req);
    await require('./pedido-transporte').completar(p, req);
    const pdf = await pdfPedido(p, await ajustes());
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${p.codigo}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  }));

  // Enviar: { correo: true, para, cc, asunto, texto } o { correo: false } («lo envío yo»)
  app.post('/api/compras/pedidos/:id/enviar', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const p = await pedido(id);
    if (!p) throw fallo(404, 'Pedido no encontrado');
    if (!['borrador', 'aprobado', 'por_aprobar'].includes(p.estado)) throw fallo(400, 'Este pedido ya se envió');
    if (!p.proveedor_id) throw fallo(400, 'Elige el proveedor');
    if (!p.lineas.length) throw fallo(400, 'El pedido no tiene líneas');
    if (p.lineas.some((l) => l.precio == null)) throw fallo(400, 'Falta el precio de alguna línea');
    if (p.necesita_aprobacion && p.estado !== 'aprobado') throw fallo(400, `Pasa de ${eur(p.limite)}: necesita la aprobación de Dirección`);
    const aj = await ajustes();
    let para = null;
    // subcontratación: con el pedido va el enlace de seguimiento del taller para esa OT (se crea o se reactiva)
    const sub = p.tipo === 'subcontratacion' && p.orden_id;
    const destino = b.correo ? texto(b.para, 300) : null;
    const seg = sub ? await require('./seguimiento-ext').iniciar({ ordenId: p.orden_id, proveedorId: p.proveedor_id, email: destino || p.proveedor_email, usuarioId: req.usuario.id, req }) : null;
    if (b.correo) {
      para = destino;
      if (!para || !/@/.test(para)) throw fallo(400, 'Falta el correo del proveedor');
      await require('./pedido-transporte').completar(p, req);
      const pdf = await pdfPedido({ ...p, enviado_en: new Date(), seguimiento_url: seg?.url }, aj);
      let cuerpo = String(b.texto || '').slice(0, 5000);
      if (p.seg_url && !seg && !cuerpo.includes(p.seg_url)) cuerpo += `\n\n— Confirmación y seguimiento: confírmenos el pedido y díganos cómo y cuándo lo envía (agencia y nº de seguimiento, entrega en el almacén del transportista o día de recogida) en este enlace, sin registrarse:\n${p.seg_url}`;
      if (seg && !cuerpo.includes(seg.url)) cuerpo += `\n\n— Seguimiento del trabajo: indíquenos cómo va (inicio, avance, fecha prevista, fotos y a quién lo entregan) en este enlace, sin registrarse:\n${seg.url}`;
      await correo.enviarOFallar({
        para, cc: texto(b.cc, 300), asunto: texto(b.asunto, 200) || `Pedido ${p.codigo} · ${aj.empresa.nombre}`,
        texto: cuerpo, adjuntos: [{ nombre: `${p.codigo}.pdf`, datos: pdf, tipo: 'application/pdf' }],
        ref: { tipo: 'pedido', id, proveedor_id: p.proveedor_id },
      });
      if (seg) await query('UPDATE ext_seguimientos SET enviado_en = now() WHERE id = $1', [seg.id]);
    }
    await tx(async (c) => {
      await c.query(`UPDATE pedidos_compra SET estado = 'enviado', enviado_por = $2, enviado_en = now(), enviado_a = $3, enviado_correo = $4 WHERE id = $1`,
        [id, req.usuario.id, para, !!b.correo]);
      await require('./precios').registrarPedido(c, id, req.usuario.id);   // lista de precios (precio pactado)
      // subcontratación: sus tareas las hace este taller (si se cambió de proveedor, pasan a su área)
      for (const l of p.lineas.filter((x) => x.tarea_id)) {
        const { rows: t } = await c.query('SELECT proveedor_id FROM tareas WHERE id = $1', [l.tarea_id]);
        if (t.length && t[0].proveedor_id !== p.proveedor_id) {
          await c.query('UPDATE tareas SET proveedor_id = $2, linea_id = $3 WHERE id = $1', [l.tarea_id, p.proveedor_id, await require('./externos').areaExterna(c, p.proveedor_id)]);
        }
      }
      await pasarAPedido(c, p, req.usuario.id);   // sus líneas de material pasan a «Pedido»
    });
    if (sub) return res.json({ ...(await pedido(id)), seguimiento_url: seg?.url || null });
    notif.avisarLuego(notif.conPermiso('logistica', 'escandallo'), 'mat_pedido', {
      titulo: `Pedido ${p.codigo} enviado`,
      cuerpo: `${p.proveedor} · ${p.lineas.length} línea${p.lineas.length === 1 ? '' : 's'}${p.fecha_entrega ? ` · llega el ${ddmm(p.fecha_entrega)}` : ''}${p.proyectos ? ` · ${p.proyectos}` : ''}`,
      url: '/logistica.html?vista=recibir', tag: `pedido-c-${id}`,
    });
    res.json(await pedido(id));
  }));
}

// Una vez: el material marcado «pedido» con el botón rápido antiguo (sin pedido de compra) pasa a pedidos por teléfono,
// uno por proveedor, nº y día, para que todo pedido esté en Compras y se pueda recibir por pedido.
async function migrarPedidosSueltos() {
  const { rows: [m] } = await query(`SELECT 1 FROM ajustes WHERE clave = 'migr_pedidos_telefono'`);
  if (m) return;
  const { rows } = await query(`SELECT e.id, e.descripcion, e.unidad, GREATEST(e.cantidad - COALESCE(e.stock, 0), 0)::float AS falta, e.proveedor_id, e.num_pedido,
                                       e.fecha_prevista::text AS fecha, e.pedido_por, e.pedido_en, pr.codigo AS proyecto, pr.nombre AS proyecto_nombre
                                  FROM partida_escandallo e JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos pr ON pr.id = pa.proyecto_id
                                 WHERE e.compra = 'pedido' AND e.pedido_compra_id IS NULL ORDER BY e.pedido_en NULLS FIRST, e.id`);
  const grupos = new Map();
  for (const r of rows) {
    const k = `${r.proveedor_id || 0}|${r.num_pedido || ''}|${r.pedido_en ? new Date(r.pedido_en).toISOString().slice(0, 10) : ''}`;
    if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(r);
  }
  await tx(async (c) => {
    for (const ls of grupos.values()) {
      const r0 = ls[0];
      const pid = await crearPedido(c, { proveedor_id: r0.proveedor_id, lineas: ls.map((l) => ({ escandallo_id: l.id, descripcion: l.descripcion, cantidad: l.falta || 1, unidad: l.unidad, precio: null })),
        fecha_entrega: ls.map((l) => l.fecha).filter(Boolean).sort()[0] || null, referencia: [...new Set(ls.map((l) => `${l.proyecto} · ${l.proyecto_nombre}`))].join(' / '),
        observaciones: 'Pedido marcado en Logística antes de que existiera «Ya pedido por teléfono».', usuarioId: r0.pedido_por });
      await c.query(`UPDATE pedidos_compra SET estado = 'enviado', por_telefono = TRUE, enviado_por = $2, enviado_en = COALESCE($3, now()), enviado_correo = FALSE, prov_num_confirmacion = $4 WHERE id = $1`,
        [pid, r0.pedido_por, r0.pedido_en, r0.num_pedido]);
      await c.query(`UPDATE partida_escandallo SET pedido_compra_id = $2 WHERE id = ANY($1)`, [ls.map((l) => l.id), pid]);
    }
    await c.query(`INSERT INTO ajustes (clave, valor) VALUES ('migr_pedidos_telefono', $1) ON CONFLICT (clave) DO NOTHING`, [JSON.stringify({ lineas: rows.length, pedidos: grupos.size })]);
  });
  if (rows.length) console.log(`Pedidos sueltos: ${rows.length} línea(s) pasadas a ${grupos.size} pedido(s) por teléfono`);
}

module.exports = { montar, ajustes, lineasLibres, crearPedido, ponerPrecios, migrarPedidosSueltos, eur, cantTxt, texto, num, fechaOk, ddmm };
