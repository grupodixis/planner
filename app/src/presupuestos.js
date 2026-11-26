// Presupuestos (fase 1): capítulos › partidas › descomposición, con el estado de cada precio.
//
//  · Partida: código, nombre interno, DESCRIPCIÓN COMERCIAL (la que ve el cliente), unidad y medición.
//  · Línea: cantidad POR UNIDAD de partida (rendimiento) × medición = cantidad total; precio = COSTE €/unidad de la línea.
//      material      → lista de precios (convertido a la unidad de la línea con las equivalencias del material)
//      mano de obra  → tarifa (coste efectivo por rendimiento real)       maquinaria → tarifa
//      auxiliar, subcontrata → a mano (estimado) o de una oferta real
//    Estados: real (confirmado, ≤ 3 meses) · tarifa · estimado (a mano, viejo o sin precio) · solicitado (petición en marcha).
//    calculo 'kg_perfiles' / 'm2_perfiles': la cantidad es la suma de los kg (o m² de pintura) de los perfiles de la partida.
//  · Venta: coste × (1 + GG % + beneficio %). El precio unitario de venta se redondea al céntimo y el importe sale de él.
//  · Pedir precio: crea una petición de precio normal en Compras con motivo «presupuesto» (no crea pedidos); cuando se
//    confirma una oferta, la línea muestra «precio nuevo» para aplicarlo.
const PDFDocument = require('pdfkit');
const { query, tx } = require('./db');
const auth = require('./auth');
const U = require('./unidades');
const precios = require('./precios');
const tarifa = require('./tarifa');

const fallo = (s, m) => Object.assign(new Error(m), { status: s });
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const texto = (v, n) => { const t = v == null ? '' : String(v).trim(); return t ? t.slice(0, n) : null; };
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const TIPOS = ['material', 'mano_obra', 'maquinaria', 'auxiliar', 'subcontrata'];
const DIAS_VIEJO = precios.DIAS_VIEJO || 90;

async function siguienteCodigo(c) {
  const y = new Date().getFullYear();
  const { rows } = await c.query(`SELECT max(substring(codigo from '\\d+$')::int) AS n FROM presupuestos WHERE codigo LIKE $1`, [`PRE-${y}-%`]);
  return `PRE-${y}-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}

/* ---------- precios ---------- */
// Material: último precio de la lista, en la unidad de la línea
async function precioMaterial(catalogoId, unidad, descripcion) {
  const h = await precios.habitual({ catalogo_id: catalogoId || null, descripcion });
  if (!h) return { precio: null, estado_precio: 'estimado', fuente: null, precio_info: { aviso: 'Sin precio en el sistema' } };
  const p = U.unidad(h.unidad) === U.unidad(unidad) ? h.precio : await U.precioEn(catalogoId, h.precio, h.unidad, unidad);
  const info = { proveedor: h.proveedor, fecha: h.fecha, dias: h.dias, origen: h.origen, base: { precio: h.precio, unidad: h.unidad },
    cotizo: h.precio_orig != null && h.unidad_orig && h.unidad_orig !== h.unidad ? { precio: h.precio_orig, unidad: h.unidad_orig } : null };
  if (p == null) return { precio: null, estado_precio: 'estimado', fuente: null, precio_info: { ...info, aviso: `Hay precio en €/${h.unidad} pero falta la equivalencia a ${unidad}` } };
  return { precio: +Number(p).toFixed(4), estado_precio: h.dias > DIAS_VIEJO ? 'estimado' : 'real', fuente: 'lista', precio_info: { ...info, viejo: h.dias > DIAS_VIEJO } };
}
// Mano de obra y maquinaria: coste de la tarifa
async function precioTarifa(tarifaId, td) {
  const d = td || await tarifa.datos();
  const t = [...d.mano_obra, ...d.maquinaria].find((x) => x.id === Number(tarifaId));
  if (!t) return null;
  return { t, precio: t.coste_efectivo, estado_precio: t.coste_efectivo == null ? 'estimado' : 'tarifa', fuente: 'tarifa',
    precio_info: { coste_ficha: t.coste_ficha ?? t.coste_efectivo, rendimiento_pct: t.rendimiento_pct ?? null, venta: t.precio_venta, unidad: t.unidad } };
}

/* ---------- el presupuesto entero, con sus cálculos ---------- */
async function cargar(id) {
  const { rows: [p] } = await query(`
    SELECT p.*, p.gg_pct::float AS gg_pct, p.bi_pct::float AS bi_pct, c.nombre AS cliente, o.nombre AS obra, o.direccion AS obra_direccion, u.nombre AS creado_por_nombre
      FROM presupuestos p LEFT JOIN clientes c ON c.id = p.cliente_id LEFT JOIN obras o ON o.id = p.obra_id LEFT JOIN usuarios u ON u.id = p.creado_por
     WHERE p.id = $1`, [id]);
  if (!p) return null;
  const [{ rows: caps }, { rows: parts }, { rows: lins }] = await Promise.all([
    query('SELECT * FROM presupuesto_capitulos WHERE presupuesto_id = $1 ORDER BY orden, id', [id]),
    query('SELECT *, medicion::float AS medicion FROM presupuesto_partidas WHERE presupuesto_id = $1 ORDER BY orden, id', [id]),
    query(`SELECT l.*, l.por_ud::float AS por_ud, l.precio::float AS precio, sl.solicitud_id, s.codigo AS sol_codigo, s.responder_antes::text AS sol_responder_antes, s.estado AS sol_estado
             FROM presupuesto_lineas l JOIN presupuesto_partidas pp ON pp.id = l.partida_id
             LEFT JOIN solicitud_lineas sl ON sl.id = l.sol_linea_id LEFT JOIN solicitudes_precio s ON s.id = sl.solicitud_id
            WHERE pp.presupuesto_id = $1 ORDER BY l.orden, l.id`, [id]),
  ]);
  // ofertas confirmadas de lo que se pidió: { sol_linea_id: [{precio, proveedor, sp_id}] }
  const solIds = [...new Set(lins.map((l) => l.sol_linea_id).filter(Boolean))];
  const ofertas = {};
  if (solIds.length) {
    const { rows } = await query(`
      SELECT sp2.linea_id, sp2.precio::float AS precio, sp.id AS sp_id, pr.nombre AS proveedor, sp2.precio_cotizado::float AS precio_cotizado, sp2.unidad_cotizada
        FROM solicitud_precios sp2 JOIN solicitud_proveedores sp ON sp.id = sp2.sp_id JOIN proveedores pr ON pr.id = sp.proveedor_id
       WHERE sp2.linea_id = ANY($1) AND sp2.precio IS NOT NULL ORDER BY sp2.precio`, [solIds]);
    for (const r of rows) (ofertas[r.linea_id] ||= []).push(r);
  }
  const k = 1 + (p.gg_pct + p.bi_pct) / 100;
  const mats = new Map();
  for (const l of lins) if (l.tipo === 'material' && l.catalogo_id) mats.set(l.catalogo_id, await U.deCatalogo(l.catalogo_id));
  let coste = 0; let venta = 0; let costeReal = 0; const pend = { estimado: 0, solicitado: 0, nuevos: 0 };
  p.capitulos = caps.map((c) => ({ ...c, partidas: [], coste: 0, venta: 0 }));
  const sinCap = { id: null, codigo: '', nombre: 'Sin capítulo', partidas: [], coste: 0, venta: 0 };
  for (const pa of parts) {
    const ls = lins.filter((l) => l.partida_id === pa.id);
    // kg y m² de pintura de los perfiles de la partida (por unidad de partida)
    let kg = 0; let m2 = 0; const sinEquiv = [];
    for (const l of ls.filter((x) => x.tipo === 'material' && x.catalogo_id)) {
      const m = mats.get(l.catalogo_id);
      const k1 = m ? U.convertirCantidad(l.por_ud, l.unidad, 'kg', m.factores) : null;
      if (k1 != null) kg += k1; else sinEquiv.push(l.concepto);
      const ml = m ? U.convertirCantidad(l.por_ud, l.unidad, 'ml', m.factores) : null;
      if (ml != null && m.pint_m2_ml) m2 += ml * m.pint_m2_ml;
    }
    pa.lineas = ls.map((l) => {
      const cant = l.calculo === 'kg_perfiles' ? +kg.toFixed(4) : l.calculo === 'm2_perfiles' ? +m2.toFixed(4) : l.por_ud;
      const imp = l.precio != null ? cant * pa.medicion * l.precio : 0;
      const of = l.sol_linea_id ? (ofertas[l.sol_linea_id] || []) : [];
      const nuevo = l.estado_precio === 'solicitado' && of.length ? of[0] : null;
      // petición anulada o cerrada sin ofertas: vuelve a contar como estimado
      if (l.estado_precio === 'solicitado' && l.sol_estado && l.sol_estado !== 'abierta' && !of.length) { l.estado_precio = 'estimado'; l.sol_cerrada = true; }
      if (l.estado_precio === 'estimado') pend.estimado++;
      if (l.estado_precio === 'solicitado') pend.solicitado++;
      if (nuevo) pend.nuevos++;
      return { ...l, cantidad_ud: cant, cantidad_total: +(cant * pa.medicion).toFixed(3), importe: r2(imp), nuevo, ofertas: of.length,
        calculo_txt: l.calculo === 'kg_perfiles' ? `Σ kg de los perfiles de la partida${sinEquiv.length ? ` (sin peso: ${sinEquiv.join(', ')})` : ''}` : l.calculo === 'm2_perfiles' ? 'Σ m² de pintura de los perfiles de la partida' : null };
    });
    pa.coste_ud = r2(pa.lineas.reduce((s, l) => s + (l.precio != null ? l.cantidad_ud * l.precio : 0), 0));
    pa.coste = r2(pa.lineas.reduce((s, l) => s + l.importe, 0));
    pa.venta_ud = r2(pa.coste_ud * k);
    pa.venta = r2(pa.venta_ud * pa.medicion);
    pa.kg_ud = +kg.toFixed(3); pa.m2_ud = +m2.toFixed(3);
    pa.estados = pa.lineas.reduce((o, l) => { o[l.estado_precio] = (o[l.estado_precio] || 0) + 1; return o; }, {});
    pa.sin_precio = pa.lineas.filter((l) => l.precio == null).length;
    costeReal += pa.lineas.filter((l) => ['real', 'tarifa'].includes(l.estado_precio)).reduce((s, l) => s + l.importe, 0);
    coste += pa.coste; venta += pa.venta;
    const cap = p.capitulos.find((c) => c.id === pa.capitulo_id) || sinCap;
    cap.partidas.push(pa); cap.coste = r2(cap.coste + pa.coste); cap.venta = r2(cap.venta + pa.venta);
  }
  if (sinCap.partidas.length) p.capitulos.push(sinCap);
  p.coste = r2(coste); p.venta = r2(venta); p.k = k;
  p.margen_pct = p.gg_pct + p.bi_pct;
  p.real_pct = coste ? Math.round((costeReal / coste) * 100) : null;
  p.pendientes = pend;
  p.n_partidas = parts.length;
  return p;
}

const editable = (p) => { if (!p) throw fallo(404, 'Presupuesto no encontrado'); if (!['preparacion', 'enviado'].includes(p.estado)) throw fallo(400, 'Este presupuesto ya está cerrado: no se puede cambiar'); };
async function dePartida(partidaId) {
  const { rows: [r] } = await query('SELECT pp.*, p.estado FROM presupuesto_partidas pp JOIN presupuestos p ON p.id = pp.presupuesto_id WHERE pp.id = $1', [partidaId]);
  if (!r) throw fallo(404, 'Partida no encontrada'); editable(r); return r;
}
async function deLinea(lineaId) {
  const { rows: [r] } = await query(`SELECT l.*, pp.presupuesto_id, pp.medicion::float AS medicion, p.estado FROM presupuesto_lineas l JOIN presupuesto_partidas pp ON pp.id = l.partida_id
                                       JOIN presupuestos p ON p.id = pp.presupuesto_id WHERE l.id = $1`, [lineaId]);
  if (!r) throw fallo(404, 'Línea no encontrada'); editable(r); return r;
}
const tocar = (id) => query('UPDATE presupuestos SET cambiado = now() WHERE id = $1', [id]);

// Datos de una línea nueva según su tipo
async function lineaNueva(b, td) {
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : null;
  if (!tipo) throw fallo(400, 'Tipo de línea no válido');
  const out = { tipo, concepto: texto(b.concepto, 300), catalogo_id: null, tarifa_id: null, unidad: texto(b.unidad, 12) || 'ud', por_ud: num(b.por_ud) ?? 1, calculo: null,
    precio: num(b.precio), estado_precio: 'estimado', fuente: num(b.precio) != null ? 'manual' : null, precio_info: null };
  if (['kg_perfiles', 'm2_perfiles'].includes(b.calculo)) { out.calculo = b.calculo; out.unidad = b.calculo === 'kg_perfiles' ? 'kg' : 'm2'; }
  if (tipo === 'material' && b.catalogo_id) {
    const { rows: [c] } = await query('SELECT id, nombre, unidad FROM catalogo WHERE id = $1', [Number(b.catalogo_id)]);
    if (!c) throw fallo(400, 'Material no encontrado en el catálogo');
    const m = await U.deCatalogo(c.id);
    out.catalogo_id = c.id; out.concepto = out.concepto || c.nombre;
    out.unidad = texto(b.unidad, 12) || m?.base || U.unidad(c.unidad) || 'ud';
    if (out.precio == null) Object.assign(out, await precioMaterial(c.id, out.unidad, c.nombre));
  } else if (['mano_obra', 'maquinaria'].includes(tipo) && b.tarifa_id) {
    const pt = await precioTarifa(b.tarifa_id, td);
    if (!pt) throw fallo(400, 'No está en la tarifa');
    out.tarifa_id = pt.t.id; out.concepto = out.concepto || pt.t.nombre; out.unidad = pt.t.unidad || 'h';
    if (out.precio == null) { const { t, ...rest } = pt; Object.assign(out, rest); }
  } else if (tipo === 'material' && out.concepto && out.precio == null) {
    Object.assign(out, await precioMaterial(null, out.unidad, out.concepto));
  }
  if (!out.concepto) throw fallo(400, 'Falta el concepto');
  return out;
}
async function insertarLinea(c, partidaId, l, orden) {
  const { rows: [r] } = await c.query(`INSERT INTO presupuesto_lineas (partida_id, tipo, concepto, catalogo_id, tarifa_id, unidad, por_ud, calculo, precio, estado_precio, fuente, precio_info, nota, orden)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
  [partidaId, l.tipo, l.concepto, l.catalogo_id, l.tarifa_id, l.unidad, l.por_ud, l.calculo, l.precio, l.estado_precio, l.fuente, l.precio_info ? JSON.stringify(l.precio_info) : null, l.nota || null, orden]);
  return r.id;
}

/* ---------- PDF para el cliente ---------- */
const eur = (n) => `${Number(n || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const cantTxt = (n) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: 3 });
const UD = { m2: 'm²', m3: 'm³' };
const ud = (u) => UD[u] || u || 'ud';
const latin = (t) => String(t ?? '').replace(/[→⇒]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€–—•…]/g, '');
const TIPO_TXT = { material: 'Materiales', mano_obra: 'Mano de obra', maquinaria: 'Maquinaria y medios', auxiliar: 'Medios auxiliares', subcontrata: 'Trabajos subcontratados' };

async function pdf(p, detallado) {
  const aj = await require('./compras').ajustes();
  const emp = aj.empresa || {};
  const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Presupuesto ${p.codigo}` } });
  const W = doc.page.width - 96; const gris = '#666';
  let y = 48;
  doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(latin(emp.nombre || 'Empresa'), 48, y, { width: W * 0.6 });
  doc.fontSize(15).text('PRESUPUESTO', 48 + W * 0.6, y, { width: W * 0.4, align: 'right' });
  y += 22;
  doc.font('Helvetica').fontSize(9).fillColor(gris).text(latin([emp.cif && `CIF ${emp.cif}`, emp.direccion, emp.telefono, emp.email].filter(Boolean).join(' · ')), 48, y, { width: W * 0.6 });
  const hoy = new Date(); const f = `${hoy.getDate()}/${hoy.getMonth() + 1}/${hoy.getFullYear()}`;
  doc.fontSize(10).fillColor('#111').text(`${p.codigo}\n${f}\nVálido ${p.validez_dias} días`, 48 + W * 0.6, y, { width: W * 0.4, align: 'right' });
  y += 46;
  doc.roundedRect(48, y, W, 44, 4).fill('#f2f2f2'); doc.fillColor('#111').fontSize(10);
  doc.font('Helvetica-Bold').text('Cliente:', 60, y + 9, { continued: true }).font('Helvetica').text(` ${latin(p.cliente || '—')}`);
  doc.font('Helvetica-Bold').text('Obra:', 60, y + 25, { continued: true }).font('Helvetica').text(` ${latin([p.obra, p.obra_direccion].filter(Boolean).join(' · ') || '—')}  ·  ${latin(p.titulo)}`);
  y += 60;
  const col = [48, 48 + 44, 48 + W * 0.66, 48 + W * 0.79]; // código, descripción, medición, precio, (importe a la derecha)
  const cab = () => {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gris);
    doc.text('Código', col[0], y); doc.text('Descripción', col[1], y); doc.text('Medición', col[2], y, { width: W * 0.12, align: 'right' });
    doc.text('Precio', col[3], y, { width: W * 0.1, align: 'right' }); doc.text('Importe', 48, y, { width: W, align: 'right' });
    y += 14; doc.moveTo(48, y).lineTo(48 + W, y).strokeColor('#bbb').stroke(); y += 6;
  };
  const salto = (h) => { if (y + h > doc.page.height - 70) { doc.addPage(); y = 48; cab(); } };
  cab();
  for (const c of p.capitulos) {
    if (!c.partidas.length) continue;
    salto(30);
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text(latin(`${c.codigo ? `${c.codigo} · ` : ''}${c.nombre}`.toUpperCase()), col[0], y, { width: W }); y += 16;
    for (const pa of c.partidas) {
      const desc = latin(pa.descripcion || pa.nombre);
      doc.font('Helvetica').fontSize(9.5);
      const h = doc.heightOfString(desc, { width: W * 0.52 });
      salto(h + 8);
      doc.fillColor('#111').text(latin(pa.codigo || ''), col[0], y, { width: 40 });
      doc.text(desc, col[1], y, { width: W * 0.52 });
      doc.text(`${cantTxt(pa.medicion)} ${ud(pa.unidad)}`, col[2], y, { width: W * 0.12, align: 'right' });
      doc.text(eur(pa.venta_ud), col[3], y, { width: W * 0.1, align: 'right' });
      doc.text(eur(pa.venta), 48, y, { width: W, align: 'right' });
      y += h + 4;
      if (detallado && pa.lineas.length) {
        // descomposición a precio de VENTA (sin costes ni márgenes internos), por unidad de partida
        doc.fontSize(8).fillColor(gris);
        for (const t of TIPOS) {
          const ls = pa.lineas.filter((l) => l.tipo === t && l.precio != null);
          if (!ls.length) continue;
          salto(12); doc.font('Helvetica-Oblique').text(TIPO_TXT[t], col[1] + 8, y); y += 10; doc.font('Helvetica');
          for (const l of ls) {
            salto(10);
            const pv = r2(l.precio * p.k);
            doc.text(latin(l.concepto), col[1] + 16, y, { width: W * 0.42 });
            doc.text(`${cantTxt(l.cantidad_ud)} ${ud(l.unidad)} × ${eur(pv)}`, col[2] - 30, y, { width: W * 0.22, align: 'right' });
            doc.text(eur(r2(l.cantidad_ud * pv)), col[3], y, { width: W * 0.1, align: 'right' });
            y += 10;
          }
        }
        doc.fontSize(9.5); y += 4;
      }
      doc.moveTo(col[1], y).lineTo(48 + W, y).strokeColor('#e3e3e3').stroke(); y += 5;
    }
    salto(18);
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111').text(`Total ${latin(c.codigo ? `capítulo ${c.codigo}` : c.nombre)}`, col[1], y, { width: W * 0.8 - 44, align: 'right' });
    doc.text(eur(c.venta), 48, y, { width: W, align: 'right' }); y += 18;
  }
  const iva = r2(p.venta * 0.21);
  salto(70); y += 4;
  doc.moveTo(48 + W * 0.55, y).lineTo(48 + W, y).strokeColor('#999').stroke(); y += 6;
  for (const [t, v, b] of [['Base imponible', p.venta], ['IVA 21 %', iva], ['TOTAL', r2(p.venta + iva), true]]) {
    doc.font(b ? 'Helvetica-Bold' : 'Helvetica').fontSize(b ? 11 : 10).fillColor('#111').text(t, 48 + W * 0.55, y, { width: W * 0.25 });
    doc.text(eur(v), 48, y, { width: W, align: 'right' }); y += b ? 18 : 15;
  }
  const cond = p.condiciones || aj.condiciones_presupuesto || null;
  if (cond) { salto(60); y += 8; doc.font('Helvetica-Bold').fontSize(9.5).text('Condiciones', 48, y); y += 13; doc.font('Helvetica').fontSize(8.5).fillColor(gris).text(latin(cond), 48, y, { width: W }); }
  doc.end();
  return doc;
}

/* ---------- rutas ---------- */
function montar(app, asyncH) {
  const ver = auth.permiso('presupuestos', 'costes');

  app.get('/api/presupuestos', ver, asyncH(async (req, res) => {
    const { rows } = await query(`SELECT p.id FROM presupuestos p LEFT JOIN clientes c ON c.id = p.cliente_id LEFT JOIN obras o ON o.id = p.obra_id
      WHERE p.estado <> 'anulado' AND ($1 = '' OR (p.codigo || ' ' || p.titulo || ' ' || COALESCE(c.nombre, '') || ' ' || COALESCE(o.nombre, '')) ILIKE '%' || $1 || '%')
      ORDER BY (p.estado = 'preparacion') DESC, p.cambiado DESC LIMIT 200`, [String(req.query.q || '').trim().slice(0, 80)]);
    const out = [];
    for (const r of rows) {
      const p = await cargar(r.id);
      out.push({ id: p.id, codigo: p.codigo, titulo: p.titulo, cliente: p.cliente, obra: p.obra, estado: p.estado, coste: p.coste, venta: p.venta, capitulos: p.capitulos.filter((c) => c.id).length,
        partidas: p.n_partidas, pendientes: p.pendientes, ia_estado: p.ia_estado, origen: p.origen, real_pct: p.real_pct, enviado_en: p.enviado_en, decidido_en: p.decidido_en, cambiado: p.cambiado });
    }
    res.json(out);
  }));

  app.post('/api/presupuestos', ver, asyncH(async (req, res) => {
    const b = req.body || {};
    const titulo = texto(b.titulo, 200);
    if (!titulo) throw fallo(400, 'Escribe de qué es el presupuesto');
    const id = await tx(async (c) => {
      const codigo = await siguienteCodigo(c);
      const { rows: [r] } = await c.query(`INSERT INTO presupuestos (codigo, titulo, cliente_id, obra_id, creado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [codigo, titulo, num(b.cliente_id), num(b.obra_id), req.usuario.id]);
      await c.query(`INSERT INTO presupuesto_capitulos (presupuesto_id, codigo, nombre, orden) VALUES ($1, '1', 'Capítulo 1', 0)`, [r.id]);
      return r.id;
    });
    res.status(201).json(await cargar(id));
  }));

  app.get('/api/presupuestos/:id', ver, asyncH(async (req, res) => {
    const p = await cargar(Number(req.params.id));
    if (!p) throw fallo(404, 'Presupuesto no encontrado');
    res.json(p);
  }));

  app.put('/api/presupuestos/:id', ver, asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const { rows: [p] } = await query('SELECT * FROM presupuestos WHERE id = $1', [id]);
    if (!p) throw fallo(404, 'Presupuesto no encontrado');
    const sets = []; const vals = [id]; const poner = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
    if ('estado' in b) {
      if (!['preparacion', 'enviado', 'aceptado', 'rechazado', 'anulado'].includes(b.estado)) throw fallo(400, 'Estado no válido');
      poner('estado', b.estado);
      if (b.estado === 'enviado') sets.push('enviado_en = COALESCE(enviado_en, now())');
      if (['aceptado', 'rechazado'].includes(b.estado)) { sets.push('decidido_en = now()'); poner('decision_nota', texto(b.nota, 500)); }
    } else editable(p);
    if ('titulo' in b) { const t = texto(b.titulo, 200); if (!t) throw fallo(400, 'Falta el título'); poner('titulo', t); }
    for (const k of ['cliente_id', 'obra_id']) if (k in b) poner(k, num(b[k]));
    for (const k of ['gg_pct', 'bi_pct']) if (k in b) { const v = num(b[k]); if (v == null || v < -50 || v > 300) throw fallo(400, 'Porcentaje no válido'); poner(k, v); }
    if ('validez_dias' in b) poner('validez_dias', Math.max(1, Math.min(365, Number(b.validez_dias) || 30)));
    for (const k of ['condiciones', 'notas']) if (k in b) poner(k, texto(b[k], 4000));
    if (!sets.length) throw fallo(400, 'Nada que cambiar');
    sets.push('cambiado = now()');
    await query(`UPDATE presupuestos SET ${sets.join(', ')} WHERE id = $1`, vals);
    res.json(await cargar(id));
  }));

  app.delete('/api/presupuestos/:id', ver, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [s] } = await query('SELECT count(*)::int AS n FROM solicitudes_precio WHERE presupuesto_id = $1', [id]);
    if (s.n) { await query(`UPDATE presupuestos SET estado = 'anulado', cambiado = now() WHERE id = $1`, [id]); return res.json({ anulado: true }); }
    await query(`DELETE FROM presupuestos WHERE id = $1 AND estado = 'preparacion'`, [id]);
    res.json({ borrado: true });
  }));

  // Capítulos
  app.post('/api/presupuestos/:id/capitulos', ver, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [p] } = await query('SELECT * FROM presupuestos WHERE id = $1', [id]); editable(p);
    const { rows: [n] } = await query('SELECT count(*)::int AS n, COALESCE(max(orden), -1) AS o FROM presupuesto_capitulos WHERE presupuesto_id = $1', [id]);
    await query('INSERT INTO presupuesto_capitulos (presupuesto_id, codigo, nombre, orden) VALUES ($1,$2,$3,$4)', [id, String(n.n + 1), texto(req.body?.nombre, 200) || `Capítulo ${n.n + 1}`, n.o + 1]);
    await tocar(id); res.status(201).json(await cargar(id));
  }));
  app.put('/api/presupuesto-capitulos/:id', ver, asyncH(async (req, res) => {
    const { rows: [c] } = await query('SELECT c.*, p.estado FROM presupuesto_capitulos c JOIN presupuestos p ON p.id = c.presupuesto_id WHERE c.id = $1', [req.params.id]); editable(c);
    const b = req.body || {};
    if ('nombre' in b) await query('UPDATE presupuesto_capitulos SET nombre = $2 WHERE id = $1', [c.id, texto(b.nombre, 200) || c.nombre]);
    if ('codigo' in b) await query('UPDATE presupuesto_capitulos SET codigo = $2 WHERE id = $1', [c.id, texto(b.codigo, 20)]);
    await tocar(c.presupuesto_id); res.json(await cargar(c.presupuesto_id));
  }));
  app.delete('/api/presupuesto-capitulos/:id', ver, asyncH(async (req, res) => {
    const { rows: [c] } = await query('SELECT c.*, p.estado FROM presupuesto_capitulos c JOIN presupuestos p ON p.id = c.presupuesto_id WHERE c.id = $1', [req.params.id]); editable(c);
    await query('DELETE FROM presupuesto_capitulos WHERE id = $1', [c.id]);
    await tocar(c.presupuesto_id); res.json(await cargar(c.presupuesto_id));
  }));

  // Partidas: { capitulo_id, nombre, unidad, medicion, descripcion, copiar_de }
  app.post('/api/presupuestos/:id/partidas', ver, asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const { rows: [p] } = await query('SELECT * FROM presupuestos WHERE id = $1', [id]); editable(p);
    const capId = num(b.capitulo_id);
    const { rows: [cap] } = capId ? await query('SELECT * FROM presupuesto_capitulos WHERE id = $1 AND presupuesto_id = $2', [capId, id]) : { rows: [null] };
    let origen = null;
    if (b.copiar_de) {
      const { rows: [o] } = await query('SELECT * FROM presupuesto_partidas WHERE id = $1', [Number(b.copiar_de)]);
      if (!o) throw fallo(400, 'No se encuentra la partida a copiar'); origen = o;
    }
    const nueva = await tx(async (c) => {
      const { rows: [n] } = await c.query('SELECT count(*)::int AS n, COALESCE(max(orden), -1) AS o FROM presupuesto_partidas WHERE presupuesto_id = $1 AND capitulo_id IS NOT DISTINCT FROM $2', [id, cap?.id || null]);
      const codigo = cap?.codigo ? `${cap.codigo}.${String(n.n + 1).padStart(2, '0')}` : String(n.n + 1);
      const { rows: [r] } = await c.query(`INSERT INTO presupuesto_partidas (presupuesto_id, capitulo_id, codigo, nombre, descripcion, unidad, medicion, orden) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [id, cap?.id || null, codigo, texto(b.nombre, 200) || origen?.nombre || 'Partida nueva', texto(b.descripcion, 4000) ?? origen?.descripcion ?? null,
          texto(b.unidad, 12) || origen?.unidad || 'ud', num(b.medicion) ?? (origen ? Number(origen.medicion) : 1), n.o + 1]);
      if (origen) {
        await c.query(`INSERT INTO presupuesto_lineas (partida_id, tipo, concepto, catalogo_id, tarifa_id, unidad, por_ud, calculo, precio, estado_precio, fuente, precio_info, nota, orden)
          SELECT $2, tipo, concepto, catalogo_id, tarifa_id, unidad, por_ud, calculo, precio, CASE WHEN estado_precio = 'solicitado' THEN 'estimado' ELSE estado_precio END, fuente, precio_info, nota, orden
            FROM presupuesto_lineas WHERE partida_id = $1`, [origen.id, r.id]);
      }
      return r.id;
    });
    await tocar(id); res.status(201).json({ ...(await cargar(id)), partida_nueva: nueva });
  }));
  app.put('/api/presupuesto-partidas/:id', ver, asyncH(async (req, res) => {
    const pa = await dePartida(Number(req.params.id)); const b = req.body || {};
    const sets = []; const vals = [pa.id]; const poner = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
    if ('nombre' in b) { const t = texto(b.nombre, 200); if (!t) throw fallo(400, 'Falta el nombre'); poner('nombre', t); }
    if ('codigo' in b) poner('codigo', texto(b.codigo, 20));
    if ('descripcion' in b) poner('descripcion', texto(b.descripcion, 4000));
    if ('unidad' in b) poner('unidad', texto(b.unidad, 12) || 'ud');
    if ('medicion' in b) { const v = num(b.medicion); if (v == null || v < 0) throw fallo(400, 'Medición no válida'); poner('medicion', v); }
    if ('capitulo_id' in b) poner('capitulo_id', num(b.capitulo_id));
    if (sets.length) await query(`UPDATE presupuesto_partidas SET ${sets.join(', ')} WHERE id = $1`, vals);
    await tocar(pa.presupuesto_id); res.json(await cargar(pa.presupuesto_id));
  }));
  app.delete('/api/presupuesto-partidas/:id', ver, asyncH(async (req, res) => {
    const pa = await dePartida(Number(req.params.id));
    await query('DELETE FROM presupuesto_partidas WHERE id = $1', [pa.id]);
    await tocar(pa.presupuesto_id); res.json(await cargar(pa.presupuesto_id));
  }));

  // Líneas: { tipo, catalogo_id | tarifa_id | concepto, unidad, por_ud, precio, calculo }
  app.post('/api/presupuesto-partidas/:id/lineas', ver, asyncH(async (req, res) => {
    const pa = await dePartida(Number(req.params.id));
    const l = await lineaNueva(req.body || {});
    const { rows: [n] } = await query('SELECT COALESCE(max(orden), -1) AS o FROM presupuesto_lineas WHERE partida_id = $1', [pa.id]);
    await insertarLinea({ query }, pa.id, l, n.o + 1);
    await tocar(pa.presupuesto_id); res.status(201).json(await cargar(pa.presupuesto_id));
  }));
  app.put('/api/presupuesto-lineas/:id', ver, asyncH(async (req, res) => {
    const l = await deLinea(Number(req.params.id)); const b = req.body || {};
    const sets = []; const vals = [l.id]; const poner = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
    if ('concepto' in b) { const t = texto(b.concepto, 300); if (!t) throw fallo(400, 'Falta el concepto'); poner('concepto', t); }
    if ('por_ud' in b) { const v = num(b.por_ud); if (v == null || v < 0) throw fallo(400, 'Cantidad no válida'); poner('por_ud', v); }
    if ('nota' in b) poner('nota', texto(b.nota, 500));
    if ('unidad' in b && !l.calculo) {
      // al cambiar de unidad, el precio se convierte (si es un material con equivalencias)
      const u = texto(b.unidad, 12) || 'ud'; poner('unidad', u);
      if (l.precio != null && l.catalogo_id && !('precio' in b)) { const p = await U.precioEn(l.catalogo_id, Number(l.precio), l.unidad, u); if (p != null) poner('precio', +p.toFixed(4)); }
    }
    if ('precio' in b) {   // escrito a mano: estimado
      const v = num(b.precio); if (v != null && (v < 0 || v > 1e7)) throw fallo(400, 'Precio no válido');
      poner('precio', v); poner('estado_precio', 'estimado'); poner('fuente', v == null ? null : 'manual'); poner('precio_info', JSON.stringify({ aviso: 'Escrito a mano' }));
    }
    if ('tarifa_id' in b && ['mano_obra', 'maquinaria'].includes(l.tipo)) {
      const pt = await precioTarifa(b.tarifa_id); if (!pt) throw fallo(400, 'No está en la tarifa');
      poner('tarifa_id', pt.t.id); poner('concepto', pt.t.nombre); poner('unidad', pt.t.unidad || 'h'); poner('precio', pt.precio); poner('estado_precio', pt.estado_precio); poner('fuente', 'tarifa'); poner('precio_info', JSON.stringify(pt.precio_info));
    }
    if (sets.length) await query(`UPDATE presupuesto_lineas SET ${sets.join(', ')} WHERE id = $1`, vals);
    await tocar(l.presupuesto_id); res.json(await cargar(l.presupuesto_id));
  }));
  app.delete('/api/presupuesto-lineas/:id', ver, asyncH(async (req, res) => {
    const l = await deLinea(Number(req.params.id));
    await query('DELETE FROM presupuesto_lineas WHERE id = $1', [l.id]);
    await tocar(l.presupuesto_id); res.json(await cargar(l.presupuesto_id));
  }));

  // Aplicar la oferta recibida a una línea pedida: { sp_id } (si no, la más barata)
  const aplicar = async (l, spId) => {
    const { rows } = await query(`SELECT sp2.precio::float AS precio, sp.id AS sp_id, pr.nombre AS proveedor, s.codigo, sp2.precio_cotizado::float AS precio_cotizado, sp2.unidad_cotizada
                                    FROM solicitud_precios sp2 JOIN solicitud_proveedores sp ON sp.id = sp2.sp_id JOIN proveedores pr ON pr.id = sp.proveedor_id
                                    JOIN solicitudes_precio s ON s.id = sp.solicitud_id
                                   WHERE sp2.linea_id = $1 AND sp2.precio IS NOT NULL ${spId ? 'AND sp.id = $2' : ''} ORDER BY sp2.precio LIMIT 1`, spId ? [l.sol_linea_id, spId] : [l.sol_linea_id]);
    const o = rows[0]; if (!o) return false;
    await query(`UPDATE presupuesto_lineas SET precio = $2, estado_precio = 'real', fuente = 'oferta', precio_info = $3 WHERE id = $1`,
      [l.id, o.precio, JSON.stringify({ proveedor: o.proveedor, fecha: new Date().toISOString().slice(0, 10), dias: 0, sp_id: o.sp_id, sol_codigo: o.codigo,
        cotizo: o.unidad_cotizada ? { precio: o.precio_cotizado, unidad: o.unidad_cotizada } : null })]);
    return true;
  };
  app.post('/api/presupuesto-lineas/:id/aplicar', ver, asyncH(async (req, res) => {
    const l = await deLinea(Number(req.params.id));
    if (!l.sol_linea_id || !(await aplicar(l, num(req.body?.sp_id)))) throw fallo(400, 'Todavía no hay ninguna oferta confirmada para esta línea');
    await tocar(l.presupuesto_id); res.json(await cargar(l.presupuesto_id));
  }));
  app.post('/api/presupuestos/:id/aplicar-todos', ver, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [p] } = await query('SELECT * FROM presupuestos WHERE id = $1', [id]); editable(p);
    const { rows } = await query(`SELECT l.* FROM presupuesto_lineas l JOIN presupuesto_partidas pp ON pp.id = l.partida_id WHERE pp.presupuesto_id = $1 AND l.estado_precio = 'solicitado' AND l.sol_linea_id IS NOT NULL`, [id]);
    let n = 0; for (const l of rows) if (await aplicar(l)) n++;
    await tocar(id); res.json({ ...(await cargar(id)), aplicados: n });
  }));

  // Volver a coger los precios de la lista y de la tarifa (no toca lo escrito a mano ni lo pedido)
  app.post('/api/presupuestos/:id/actualizar-precios', ver, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [p] } = await query('SELECT * FROM presupuestos WHERE id = $1', [id]); editable(p);
    const { rows } = await query(`SELECT l.* FROM presupuesto_lineas l JOIN presupuesto_partidas pp ON pp.id = l.partida_id
                                   WHERE pp.presupuesto_id = $1 AND (l.fuente IN ('lista', 'tarifa') OR (l.fuente IS NULL AND l.precio IS NULL))`, [id]);
    const td = await tarifa.datos(); let n = 0;
    for (const l of rows) {
      let r = null;
      if (l.tipo === 'material') r = await precioMaterial(l.catalogo_id, l.unidad, l.concepto);
      else if (l.tarifa_id) { const pt = await precioTarifa(l.tarifa_id, td); if (pt) { const { t, ...rest } = pt; r = rest; } }
      if (!r || (r.precio == null && l.precio != null)) continue;
      if (r.precio !== (l.precio == null ? null : Number(l.precio)) || r.estado_precio !== l.estado_precio) n++;
      await query('UPDATE presupuesto_lineas SET precio = $2, estado_precio = $3, fuente = $4, precio_info = $5 WHERE id = $1', [l.id, r.precio, r.estado_precio, r.fuente, JSON.stringify(r.precio_info)]);
    }
    await tocar(id); res.json({ ...(await cargar(id)), cambiados: n });
  }));

  // Pedir precio de líneas de material a proveedores: petición de precio «para presupuestar» en Compras
  // { linea_ids, proveedor_ids, responder_antes, notas }
  app.post('/api/presupuestos/:id/pedir-precio', ver, asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const p = await cargar(id); editable(p);
    const ids = new Set((b.linea_ids || []).map(Number));
    const provs = [...new Set((b.proveedor_ids || []).map(Number).filter(Number.isInteger))].slice(0, 20);
    if (!provs.length) throw fallo(400, 'Elige al menos un proveedor');
    const lineas = p.capitulos.flatMap((c) => c.partidas.flatMap((pa) => pa.lineas.filter((l) => ids.has(l.id)).map((l) => ({ ...l, partida: pa }))));
    if (!lineas.length) throw fallo(400, 'Marca alguna línea');
    // las del mismo material y unidad van juntas en una sola línea de la petición
    const grupos = new Map();
    for (const l of lineas) { const k = `${l.catalogo_id || l.concepto}|${U.unidad(l.unidad)}`; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(l); }
    const sid = await tx(async (c) => {
      const codigo = await require('./solicitudes').siguienteCodigo(c);
      const fecha = /^\d{4}-\d{2}-\d{2}$/.test(b.responder_antes || '') ? b.responder_antes : null;
      const { rows: [s] } = await c.query(`INSERT INTO solicitudes_precio (codigo, responder_antes, notas, creado_por, motivo, presupuesto_id) VALUES ($1,$2,$3,$4,'presupuesto',$5) RETURNING id`,
        [codigo, fecha, texto(b.notas, 2000) || `Precio para presupuesto ${p.codigo}`, req.usuario.id, id]);
      let i = 0;
      for (const ls of grupos.values()) {
        const cant = ls.reduce((s, l) => s + l.cantidad_total, 0);
        const { rows: [sl] } = await c.query(`INSERT INTO solicitud_lineas (solicitud_id, catalogo_id, descripcion, cantidad, unidad, orden) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [s.id, ls[0].catalogo_id, ls[0].concepto, +cant.toFixed(3), ls[0].unidad, i++]);
        for (const l of ls) await c.query(`UPDATE presupuesto_lineas SET sol_linea_id = $2, estado_precio = 'solicitado' WHERE id = $1`, [l.id, sl.id]);
      }
      for (const pv of provs) await c.query('INSERT INTO solicitud_proveedores (solicitud_id, proveedor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [s.id, pv]);
      return s.id;
    });
    await tocar(id);
    res.status(201).json({ ...(await cargar(id)), solicitud_id: sid });
  }));

  // Proveedores sugeridos para unas líneas: los que ya han dado precio de esos materiales, luego el resto
  app.get('/api/presupuestos/:id/proveedores-sugeridos', ver, asyncH(async (req, res) => {
    const ids = String(req.query.catalogo || '').split(',').map(Number).filter(Number.isInteger);
    const { rows } = await query(`SELECT pr.id, pr.nombre, pr.email, count(p.id)::int AS precios
                                    FROM proveedores pr LEFT JOIN precios p ON p.proveedor_id = pr.id AND p.catalogo_id = ANY($1)
                                   WHERE pr.activo AND NOT COALESCE(pr.transportista, false) GROUP BY pr.id ORDER BY count(p.id) DESC, pr.nombre`, [ids]);
    res.json(rows);
  }));

  // Buscar material del catálogo con su precio (para añadir líneas)
  app.get('/api/presupuestos-sugerir', ver, asyncH(async (req, res) => {
    const lista = await require('./catalogo').buscarCatalogo(req.query.q, 'material', 10);
    const out = [];
    for (const c of lista) {
      const m = await U.deCatalogo(c.id);
      const u = m?.base || U.unidad(c.unidad) || 'ud';
      const pr = await precioMaterial(c.id, u, c.nombre);
      out.push({ ...c, unidad_base: u, equiv: m ? U.explicar(m) : '', ...pr });
    }
    res.json(out);
  }));

  // Partidas de otros presupuestos para copiar
  app.get('/api/presupuestos-partidas-buscar', ver, asyncH(async (req, res) => {
    const q = String(req.query.q || '').trim().slice(0, 80);
    const { rows } = await query(`SELECT pp.id, pp.codigo, pp.nombre, pp.unidad, p.codigo AS presupuesto, p.titulo,
                                         (SELECT count(*)::int FROM presupuesto_lineas l WHERE l.partida_id = pp.id) AS lineas
                                    FROM presupuesto_partidas pp JOIN presupuestos p ON p.id = pp.presupuesto_id
                                   WHERE p.estado <> 'anulado' AND ($1 = '' OR (pp.nombre || ' ' || COALESCE(pp.descripcion, '')) ILIKE '%' || $1 || '%')
                                   ORDER BY p.cambiado DESC, pp.orden LIMIT 30`, [q]);
    res.json(rows);
  }));

  app.get('/api/presupuestos/:id/pdf', ver, asyncH(async (req, res) => {
    const p = await cargar(Number(req.params.id));
    if (!p) throw fallo(404, 'Presupuesto no encontrado');
    const det = req.query.detallado === '1';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.descargar ? 'attachment' : 'inline'}; filename="${p.codigo}${det ? '-detallado' : ''}.pdf"`);
    (await pdf(p, det)).pipe(res);
  }));
}

module.exports = { montar, cargar, precioMaterial, precioTarifa };
