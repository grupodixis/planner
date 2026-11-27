// Presupuestos (fase 1): capítulos › partidas › descomposición, con el estado de cada precio.
//
//  · Partida: código, nombre interno, DESCRIPCIÓN COMERCIAL (la que ve el cliente), unidad y medición.
//  · Línea: cantidad POR UNIDAD de partida (rendimiento) × medición = cantidad total; precio = COSTE €/unidad de la línea.
//      material      → lista de precios (convertido a la unidad de la línea con las equivalencias del material)
//      mano de obra  → tarifa (coste efectivo por rendimiento real)       maquinaria → tarifa
//      auxiliar, subcontrata → a mano (estimado) o de una oferta real
//    Estados: real (confirmado, ≤ 3 meses) · tarifa · estimado (a mano, viejo o sin precio) · solicitado (petición en marcha).
//    calculo 'kg_perfiles' / 'm2_perfiles': la cantidad es la suma de los kg (o m² de pintura) de los perfiles de la partida.
//    calculo 'l_pintura': litros de un componente de pintura = Σ m² de pintura × consumo (l/m², guardado en por_ud).
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
  if (h.via === 'presupuesto') return { precio: +Number(p).toFixed(4), estado_precio: 'real', fuente: 'lista', precio_info: { ...info, presupuesto: true, aviso: `Tu precio (${h.nota || 'de un presupuesto'})` } };
  if (h.origen === 'estimado') return { precio: +Number(p).toFixed(4), estado_precio: 'estimado', fuente: 'lista', precio_info: { ...info, estimado: true, aviso: `Precio estimado (${h.nota || 'sin precio real todavía'}): conviene pedir precio` } };
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

/* ---------- ajustes de presupuestos (límite de descuento sin aprobación) ---------- */
const AJ_P = { dto_limite: 10 };
async function ajustesP() {
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'presupuestos'`);
  let v = {}; try { v = rows.length ? (typeof rows[0].valor === 'string' ? JSON.parse(rows[0].valor) : rows[0].valor) : {}; } catch { v = {}; }
  return { ...AJ_P, ...v };
}

/* ---------- el presupuesto entero, con sus cálculos ---------- */
async function cargar(id) {
  const { rows: [p] } = await query(`
    SELECT p.*, p.gg_pct::float AS gg_pct, p.bi_pct::float AS bi_pct, c.nombre AS cliente, c.cif AS cliente_cif, c.direccion_fiscal AS cliente_direccion,
           (SELECT cc.nombre FROM cliente_contactos cc WHERE cc.cliente_id = c.id ORDER BY cc.id LIMIT 1) AS cliente_contacto, o.nombre AS obra, o.direccion AS obra_direccion, u.nombre AS creado_por_nombre
      FROM presupuestos p LEFT JOIN clientes c ON c.id = p.cliente_id LEFT JOIN obras o ON o.id = p.obra_id LEFT JOIN usuarios u ON u.id = p.creado_por
     WHERE p.id = $1`, [id]);
  if (!p) return null;
  const [{ rows: caps }, { rows: parts }, { rows: lins }, { rows: eventos }] = await Promise.all([
    query('SELECT * FROM presupuesto_capitulos WHERE presupuesto_id = $1 ORDER BY orden, id', [id]),
    query('SELECT *, medicion::float AS medicion, COALESCE(dto_pct, 0)::float AS dto_pct FROM presupuesto_partidas WHERE presupuesto_id = $1 ORDER BY orden, id', [id]),
    query(`SELECT l.*, l.por_ud::float AS por_ud, l.precio::float AS precio, sl.solicitud_id, s.codigo AS sol_codigo, s.responder_antes::text AS sol_responder_antes, s.estado AS sol_estado
             FROM presupuesto_lineas l JOIN presupuesto_partidas pp ON pp.id = l.partida_id
             LEFT JOIN solicitud_lineas sl ON sl.id = l.sol_linea_id LEFT JOIN solicitudes_precio s ON s.id = sl.solicitud_id
            WHERE pp.presupuesto_id = $1 ORDER BY l.orden, l.id`, [id]),
    query('SELECT id, clase, texto, correo_id, creado FROM presupuesto_eventos WHERE presupuesto_id = $1 ORDER BY creado, id', [id]),
  ]);
  p.eventos = eventos;
  if (p.captura_id) p.captura_autor = (await query('SELECT u.nombre FROM capturas c JOIN usuarios u ON u.id = c.usuario_id WHERE c.id = $1', [p.captura_id])).rows[0]?.nombre || null;
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
  // equivalencias de cada línea de material (catálogo o, si no está, por su nombre: «Perfil UPN 140» → 16 kg/ml)
  const eqLinea = async (l) => (l.catalogo_id ? mats.get(l.catalogo_id) : await U.equivalencias(null, l.concepto, l.unidad));
  const eqs = new Map();
  for (const l of lins) if (l.tipo === 'material' && !l.calculo) eqs.set(l.id, await eqLinea(l));
  let coste = 0; let venta = 0; let costeReal = 0; let brutaTot = 0; const pend = { estimado: 0, solicitado: 0, nuevos: 0 };
  p.capitulos = caps.map((c) => ({ ...c, partidas: [], coste: 0, venta: 0 }));
  const sinCap = { id: null, codigo: '', nombre: 'Sin capítulo', partidas: [], coste: 0, venta: 0 };
  for (const pa of parts) {
    const ls = lins.filter((l) => l.partida_id === pa.id);
    // kg y m² de pintura de los perfiles de la partida (por unidad de partida)
    let kg = 0; let m2 = 0; const sinEquiv = [];
    for (const l of ls.filter((x) => x.tipo === 'material' && !x.calculo)) {
      const m = eqs.get(l.id);
      const k1 = m ? U.convertirCantidad(l.por_ud, l.unidad, 'kg', m.factores) : null;
      if (k1 != null) kg += k1; else sinEquiv.push(l.concepto);
      const ml = m ? U.convertirCantidad(l.por_ud, l.unidad, 'ml', m.factores) : null;
      if (ml != null && m.pint_m2_ml) m2 += ml * m.pint_m2_ml;
      else if (m && m.base === 'm2') { const s2 = U.convertirCantidad(l.por_ud, l.unidad, 'm2', m.factores); if (s2 != null) m2 += 2 * s2; }   // chapa: las dos caras
    }
    pa.lineas = ls.map((l) => {
      const cant = l.calculo === 'kg_perfiles' ? +kg.toFixed(4) : l.calculo === 'm2_perfiles' ? +m2.toFixed(4) : l.calculo === 'l_pintura' ? +(m2 * l.por_ud).toFixed(4) : l.por_ud;
      const imp = l.precio != null ? cant * pa.medicion * l.precio : 0;
      const of = l.sol_linea_id ? (ofertas[l.sol_linea_id] || []) : [];
      const nuevo = l.estado_precio === 'solicitado' && of.length ? of[0] : null;
      // petición anulada o cerrada sin ofertas: vuelve a contar como estimado
      if (l.estado_precio === 'solicitado' && l.sol_estado && l.sol_estado !== 'abierta' && !of.length) { l.estado_precio = 'estimado'; l.sol_cerrada = true; }
      if (l.estado_precio === 'estimado') pend.estimado++;
      if (l.estado_precio === 'solicitado') pend.solicitado++;
      if (nuevo) pend.nuevos++;
      // precio en otra unidad (€/kg en perfiles…): se guarda en la de la línea y se enseña en la que se eligió
      const eq = eqs.get(l.id);
      const unidades = l.tipo === 'material' && !l.calculo ? U.unidadesPrecio(eq, l.unidad) : [l.unidad];
      // perfiles estructurales (IPE, HEB, UPN…): el precio se maneja en €/kg si no se ha elegido otra cosa
      const estructural = /^(perfil\s+)?(ipe|ipn|hea|heb|hem|upn|upe|upa|correa)\b/i.test(String(l.concepto || '').trim());
      const uVer = l.unidad_ver && l.unidad_ver !== U.unidad(l.unidad) && unidades.includes(l.unidad_ver) ? l.unidad_ver : !l.unidad_ver && estructural && unidades.includes('kg') && l.unidad !== 'kg' ? 'kg' : null;
      const precioVer = uVer && l.precio != null ? U.convertirPrecio(l.precio, l.unidad, uVer, eq.factores) : null;
      return { ...l, unidades, unidad_ver: uVer, precio_ver: precioVer, equiv_txt: eq ? `${U.explicar(eq)}${eq.desde_nombre ? ' (deducido del nombre)' : ''}` : null,
        cantidad_ud: cant, cantidad_total: +(cant * pa.medicion).toFixed(3), importe: r2(imp), nuevo, ofertas: of.length,
        calculo_txt: l.calculo === 'kg_perfiles' ? `Σ kg de los perfiles de la partida${sinEquiv.length ? ` (sin peso: ${sinEquiv.join(', ')})` : ''}` : l.calculo === 'm2_perfiles' ? 'Σ m² de pintura de los perfiles de la partida' : l.calculo === 'l_pintura' ? `${+m2.toFixed(2)} m² de pintura × ${Number(l.por_ud)} l/m²` : null, m2_pintura: l.calculo === 'l_pintura' ? +m2.toFixed(3) : undefined };
    });
    pa.coste_ud = r2(pa.lineas.reduce((s, l) => s + (l.precio != null ? l.cantidad_ud * l.precio : 0), 0));
    pa.coste = r2(pa.lineas.reduce((s, l) => s + l.importe, 0));
    pa.venta_ud = r2(pa.coste_ud * k);
    pa.venta_bruta = r2(pa.venta_ud * pa.medicion);
    pa.dto = r2(pa.venta_bruta * pa.dto_pct / 100);   // descuento de la partida
    pa.venta = r2(pa.venta_bruta - pa.dto);
    brutaTot += pa.venta_bruta;
    pa.kg_ud = +kg.toFixed(3); pa.m2_ud = +m2.toFixed(3);
    pa.estados = pa.lineas.reduce((o, l) => { o[l.estado_precio] = (o[l.estado_precio] || 0) + 1; return o; }, {});
    pa.sin_precio = pa.lineas.filter((l) => l.precio == null).length;
    costeReal += pa.lineas.filter((l) => ['real', 'tarifa'].includes(l.estado_precio)).reduce((s, l) => s + l.importe, 0);
    coste += pa.coste; venta += pa.venta;
    const cap = p.capitulos.find((c) => c.id === pa.capitulo_id) || sinCap;
    cap.partidas.push(pa); cap.coste = r2(cap.coste + pa.coste); cap.venta = r2(cap.venta + pa.venta);
  }
  if (sinCap.partidas.length) p.capitulos.push(sinCap);
  p.coste = r2(coste); p.k = k;
  // Descuentos: los de las partidas ya van en su venta; el general, sobre la suma (en % o importe fijo)
  p.suma = r2(venta); p.venta_bruta = r2(brutaTot);
  p.dto_pct = p.dto_pct == null ? null : Number(p.dto_pct); p.dto_objetivo = p.dto_objetivo == null ? null : Number(p.dto_objetivo);
  p.dto_general = p.dto_objetivo != null ? Math.max(0, r2(p.suma - p.dto_objetivo)) : r2(p.suma * (p.dto_pct || 0) / 100);
  p.dto_general_pct = p.suma ? +((p.dto_general / p.suma) * 100).toFixed(2) : 0;
  p.dto_partidas = r2(p.capitulos.flatMap((c) => c.partidas).reduce((s, x) => s + x.dto, 0));
  p.venta = r2(p.suma - p.dto_general);   // base imponible
  p.dto_total = r2(p.venta_bruta - p.venta);
  p.dto_total_pct = p.venta_bruta ? +((p.dto_total / p.venta_bruta) * 100).toFixed(2) : 0;
  // aprobación: el mayor descuento (general o de una partida) frente al límite
  p.dto_limite = (await ajustesP()).dto_limite;
  p.dto_max_pct = Math.max(p.dto_total_pct, ...parts.map((x) => x.dto_pct || 0), 0);   // el descuento total o el de una partida, el mayor
  p.dto_aprobado_pct = p.dto_aprobado_pct == null ? null : Number(p.dto_aprobado_pct);
  p.dto_necesita = p.dto_max_pct > p.dto_limite + 1e-6 && !(p.dto_aprobado_pct != null && p.dto_max_pct <= p.dto_aprobado_pct + 1e-6);
  // margen que queda después del descuento
  p.beneficio = r2(p.venta - p.coste);
  p.margen_real_pct = p.coste ? +((p.venta / p.coste - 1) * 100).toFixed(1) : null;
  p.no_cubre_gg = p.coste > 0 && p.venta < p.coste * (1 + p.gg_pct / 100) - 0.005;
  p.perdidas = p.coste > 0 && p.venta < p.coste - 0.005;
  p.margen_pct = p.gg_pct + p.bi_pct;
  p.real_pct = coste ? Math.round((costeReal / coste) * 100) : null;
  p.pendientes = pend;
  p.n_partidas = parts.length;
  return p;
}

const eurTxt = (v) => `${Number(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const fmtPct = (v) => String(+Number(v || 0).toFixed(2)).replace('.', ',');
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
// Lo que se escribe a mano en un presupuesto pasa a la lista de precios (origen «presupuesto»): manda sobre los estimados,
// nunca sobre un precio real de proveedor. Uno por línea (si se corrige, se sustituye; si se borra el precio, se quita).
async function precioALista(lineaId) {
  const { rows: [l] } = await query(`SELECT l.*, pp.presupuesto_id, p.codigo FROM presupuesto_lineas l JOIN presupuesto_partidas pp ON pp.id = l.partida_id
                                       JOIN presupuestos p ON p.id = pp.presupuesto_id WHERE l.id = $1`, [lineaId]);
  if (!l) return;
  await query('DELETE FROM precios WHERE presupuesto_linea_id = $1', [l.id]);
  if (l.precio == null || l.fuente !== 'manual' || !['material', 'auxiliar', 'subcontrata'].includes(l.tipo)) return;
  const cot = l.precio_info?.cotizado;
  const norm = require('./precios').norm;
  await query(`INSERT INTO precios (catalogo_id, descripcion, desc_norm, precio, unidad, fecha, origen, via, unidad_base, precio_base, precio_orig, unidad_orig, presupuesto_id, presupuesto_linea_id, nota)
               VALUES ($1,$2,$3,$4,$5,CURRENT_DATE,'manual','presupuesto',$5,$4,$6,$7,$8,$9,$10)`,
  [l.catalogo_id, l.concepto, norm(l.concepto), l.precio, U.unidad(l.unidad) || 'ud', cot?.precio ?? null, cot?.unidad ?? null, l.presupuesto_id, l.id, `Puesto en el presupuesto ${l.codigo}`]);
}
async function lineaNueva(b, td) {
  const tipo = TIPOS.includes(b.tipo) ? b.tipo : null;
  if (!tipo) throw fallo(400, 'Tipo de línea no válido');
  const out = { tipo, concepto: texto(b.concepto, 300), catalogo_id: null, tarifa_id: null, unidad: texto(b.unidad, 12) || 'ud', por_ud: num(b.por_ud) ?? 1, calculo: null,
    precio: num(b.precio), estado_precio: 'estimado', fuente: num(b.precio) != null ? 'manual' : null, precio_info: null };
  if (['kg_perfiles', 'm2_perfiles'].includes(b.calculo)) { out.calculo = b.calculo; out.unidad = b.calculo === 'kg_perfiles' ? 'kg' : 'm2'; }
  if (b.calculo === 'l_pintura' && tipo !== 'material') { out.calculo = 'l_pintura'; out.unidad = 'l'; if (!(out.por_ud > 0 && out.por_ud < 3)) out.por_ud = 0.2; }   // por_ud = consumo l/m²
  if (tipo === 'material' && !b.catalogo_id && (b.nuevo_material || out.concepto)) {
    // siempre de la lista de materiales: el que corresponda o, si no existe, se añade
    const m = b.nuevo_material ? null : await require('./presupuestos-ia').emparejar(out.concepto);
    b.catalogo_id = (m || await require('./catalogo').crearMaterial({ nombre: b.nuevo_material || out.concepto, usuarioId: b.usuarioId })).id;
    out.concepto = null;
  }
  if (tipo === 'material' && b.catalogo_id) {
    const { rows: [c] } = await query('SELECT id, nombre, unidad FROM catalogo WHERE id = $1', [Number(b.catalogo_id)]);
    if (!c) throw fallo(400, 'Material no encontrado en el catálogo');
    const m = await U.deCatalogo(c.id);
    out.catalogo_id = c.id; out.concepto = out.concepto || c.nombre;
    out.unidad = m?.base || U.unidad(c.unidad) || 'ud';   // la unidad la pone el material (ml, m², ud…)
    if (out.precio == null) Object.assign(out, await precioMaterial(c.id, out.unidad, c.nombre));
  } else if (['mano_obra', 'maquinaria'].includes(tipo) && b.tarifa_id) {
    const pt = await precioTarifa(b.tarifa_id, td);
    if (!pt) throw fallo(400, 'No está en la tarifa');
    out.tarifa_id = pt.t.id; out.concepto = out.concepto || pt.t.nombre; out.unidad = pt.t.unidad || 'h';
    if (out.precio == null) { const { t, ...rest } = pt; Object.assign(out, rest); }
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

async function pdf(p, detallado, interno = false) {
  const aj = await require('./compras').ajustes();
  const P = require('./presupuestos-pdf');
  const q = { ...p, atencion: p.atencion || p.cliente_contacto || null };
  return interno ? P.interno(q, aj) : P.cliente(q, aj, { detallado });
}

/* ---------- rutas ---------- */
function montar(app, asyncH) {
  const ver = auth.permiso('presupuestos', 'costes');

  app.get('/api/presupuestos', ver, asyncH(async (req, res) => {
    const { rows } = await query(`SELECT p.id FROM presupuestos p LEFT JOIN clientes c ON c.id = p.cliente_id LEFT JOIN obras o ON o.id = p.obra_id
      WHERE p.estado <> 'anulado' AND ($1 = '' OR (p.codigo || ' ' || p.titulo || ' ' || COALESCE(c.nombre, '') || ' ' || COALESCE(o.nombre, '')) ILIKE '%' || $1 || '%')
      ORDER BY (p.estado = 'lead') DESC, (p.estado = 'preparacion') DESC, p.cambiado DESC LIMIT 300`, [String(req.query.q || '').trim().slice(0, 80)]);
    const out = [];
    for (const r of rows) {
      const p = await cargar(r.id);
      out.push({ id: p.id, codigo: p.codigo, titulo: p.titulo, cliente: p.cliente, obra: p.obra, estado: p.estado, coste: p.coste, venta: p.venta, capitulos: p.capitulos.filter((c) => c.id).length,
        partidas: p.n_partidas, pendientes: p.pendientes, ia_estado: p.ia_estado, origen: p.origen, real_pct: p.real_pct, enviado_en: p.enviado_en, decidido_en: p.decidido_en, cambiado: p.cambiado, creado: p.creado,
        dto_total_pct: p.dto_total_pct, dto_necesita: p.dto_necesita, dto_pedido: !!(p.dto_necesita && p.dto_pedido_en),
        lead: p.estado === 'lead' ? { ...(p.lead_datos || {}), autor: p.captura_autor } : null });
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
    for (const k of ['condiciones', 'notas', 'exclusiones', 'alcance']) if (k in b) poner(k, texto(b[k], 4000));
    for (const k of ['plazo', 'forma_pago', 'atencion', 'calidad']) if (k in b) poner(k, texto(b[k], 400));
    // descuento general: { dto_pct } o { dto_objetivo } = «dejarlo en X €» sin IVA (el otro se borra) · { dto_motivo }
    if ('dto_pct' in b) { const v = num(b.dto_pct); if (v != null && (v < 0 || v > 100)) throw fallo(400, 'El descuento va de 0 a 100 %'); poner('dto_pct', v || null); poner('dto_objetivo', null); }
    else if ('dto_objetivo' in b) { const v = num(b.dto_objetivo); if (v != null && v <= 0) throw fallo(400, 'Importe no válido'); poner('dto_objetivo', v || null); poner('dto_pct', null); }
    if ('dto_motivo' in b) poner('dto_motivo', texto(b.dto_motivo, 300));
    if (b.estado === 'enviado' && p.estado !== 'enviado') {
      const x = await cargar(id);
      if (x.dto_necesita) {
        if (!auth.tiene(req.usuario, 'aprobar_descuentos')) throw fallo(400, `El descuento (${fmtPct(x.dto_max_pct)} %) pasa del límite del ${fmtPct(x.dto_limite)} %: pide aprobación antes de enviarlo`);
        sets.push('dto_aprobado_en = now()'); poner('dto_aprobado_pct', x.dto_max_pct); poner('dto_aprobado_por', req.usuario.id);   // quien puede aprobar, se lo aprueba al enviarlo
      }
    }
    if (!sets.length) throw fallo(400, 'Nada que cambiar');
    sets.push('cambiado = now()');
    await query(`UPDATE presupuestos SET ${sets.join(', ')} WHERE id = $1`, vals);
    // Al enviarlo por primera vez, aprende de lo que se corrigió (en segundo plano)
    if (b.estado === 'enviado' && p.estado !== 'enviado' && !p.aprendido_en) require('./presupuestos-aprender').aprender(id, req.usuario.id).catch((e) => console.error('Aprender', id, e.message));
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
    if ('dto_pct' in b) { const v = num(b.dto_pct); if (v != null && (v < 0 || v > 100)) throw fallo(400, 'El descuento va de 0 a 100 %'); poner('dto_pct', v || null); }
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
    const l = await lineaNueva({ ...(req.body || {}), usuarioId: req.usuario.id });
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
    if ('calculo' in b) {   // Σ kg / Σ m² de los perfiles (galvanizado, pintura) o cantidad a mano
      const c = ['kg_perfiles', 'm2_perfiles', 'l_pintura'].includes(b.calculo) && l.tipo !== 'material' ? b.calculo : null;
      poner('calculo', c);
      if (c === 'l_pintura') { poner('unidad', 'l'); if (!('por_ud' in b)) poner('por_ud', 0.2); }   // por_ud = consumo l/m²
      else if (c) { poner('unidad', c === 'kg_perfiles' ? 'kg' : 'm2'); poner('por_ud', 1); }
      l.calculo = c;
    }
    if ('unidad' in b && !l.calculo && !(l.tipo === 'material' && l.catalogo_id)) {   // en un material de la lista, la unidad la pone él
      // al cambiar de unidad, el precio se convierte (si es un material con equivalencias)
      const u = texto(b.unidad, 12) || 'ud'; poner('unidad', u);
      if (l.precio != null && l.tipo === 'material' && !('precio' in b)) {
        const eq = await U.equivalencias(l.catalogo_id, l.concepto, l.unidad);
        const p = eq ? U.convertirPrecio(Number(l.precio), l.unidad, u, eq.factores) : null; if (p != null) poner('precio', +p.toFixed(4));
      }
    }
    // unidad en la que se escribe / se ve el precio (kg, t, barra…): se convierte con las equivalencias
    const uLinea = 'unidad' in b && !l.calculo ? (texto(b.unidad, 12) || 'ud') : l.unidad;
    let uPre = 'precio_unidad' in b ? (U.unidad(b.precio_unidad) || null) : null;
    if (uPre === U.unidad(uLinea)) uPre = null;
    if ('precio_unidad' in b) poner('unidad_ver', U.unidad(b.precio_unidad) || null);   // también la de la línea: así no se aplica el €/kg de serie
    if ('precio' in b) {   // escrito a mano: estimado
      let v = num(b.precio); if (v != null && (v < 0 || v > 1e7)) throw fallo(400, 'Precio no válido');
      let info = { aviso: 'Escrito a mano' };
      if (v != null && uPre) {
        const eq = await U.equivalencias(l.catalogo_id, l.concepto, uLinea);
        const p2 = eq ? U.convertirPrecio(v, uPre, uLinea, eq.factores) : null;
        if (p2 == null) throw fallo(400, `No sé pasar de €/${uPre} a €/${uLinea} en este material: falta su peso o medida`);
        info = { aviso: `Escrito a mano: ${String(v).replace('.', ',')} €/${uPre}`, cotizado: { precio: v, unidad: uPre } }; v = +p2.toFixed(4);
      }
      poner('precio', v); poner('estado_precio', 'estimado'); poner('fuente', v == null ? null : 'manual'); poner('precio_info', JSON.stringify(info));
    }
    // otro material de la lista (o uno nuevo que se añade): cantidad pasada a su unidad y su precio de la lista
    if (l.tipo === 'material' && (b.catalogo_id || b.nuevo_material || ('concepto' in b && !l.catalogo_id))) {
      let cid = Number(b.catalogo_id) || null;
      if (!cid && b.nuevo_material) cid = (await require('./catalogo').crearMaterial({ nombre: b.nuevo_material, usuarioId: req.usuario.id })).id;
      if (!cid) cid = (await require('./presupuestos-ia').emparejar(texto(b.concepto, 300)))?.id || (await require('./catalogo').crearMaterial({ nombre: b.concepto, usuarioId: req.usuario.id })).id;
      const { rows: [c] } = await query('SELECT id, nombre, unidad FROM catalogo WHERE id = $1', [cid]);
      if (!c) throw fallo(400, 'Material no encontrado en la lista');
      const eqN = await U.deCatalogo(c.id); const eqV = await U.equivalencias(l.catalogo_id, l.concepto, l.unidad);
      const uN = eqN?.base || U.unidad(c.unidad) || 'ud';
      // la cantidad: de la unidad que tenía a la del material (por kg si hace falta)
      let cant = Number(l.por_ud);
      if (U.unidad(l.unidad) !== uN) {
        const kg = eqV ? U.convertirCantidad(cant, l.unidad, 'kg', eqV.factores) : null;
        const c2 = eqN ? (U.convertirCantidad(cant, l.unidad, uN, eqN.factores) ?? (kg != null ? U.convertirCantidad(kg, 'kg', uN, eqN.factores) : null)) : null;
        if (c2 != null) cant = +c2.toFixed(4);
      }
      const ix = sets.findIndex((x) => x.startsWith('concepto ='));
      if (ix >= 0) vals[ix + 1] = c.nombre; else poner('concepto', c.nombre);
      poner('catalogo_id', c.id); poner('unidad', uN); if (!('por_ud' in b)) poner('por_ud', cant); poner('unidad_ver', null);
      if (!('precio' in b)) {
        const pm = await precioMaterial(c.id, uN, c.nombre);
        poner('precio', pm.precio); poner('estado_precio', pm.estado_precio); poner('fuente', pm.fuente); poner('precio_info', JSON.stringify(pm.precio_info || null));
      }
    }
    if ('tarifa_id' in b && ['mano_obra', 'maquinaria'].includes(l.tipo)) {
      const pt = await precioTarifa(b.tarifa_id); if (!pt) throw fallo(400, 'No está en la tarifa');
      poner('tarifa_id', pt.t.id); poner('concepto', pt.t.nombre); poner('unidad', pt.t.unidad || 'h'); poner('precio', pt.precio); poner('estado_precio', pt.estado_precio); poner('fuente', 'tarifa'); poner('precio_info', JSON.stringify(pt.precio_info));
    }
    if (sets.length) await query(`UPDATE presupuesto_lineas SET ${sets.join(', ')} WHERE id = $1`, vals);
    if ('precio' in b || b.catalogo_id || b.nuevo_material) await precioALista(l.id).catch((e) => console.warn('precio a la lista', e.message));
    // mano de obra / maquinaria corregida a mano: proponer fijarla en la tarifa
    let sugerencia = null;
    if ('precio' in b && l.tarifa_id && num(b.precio) != null) {
      const t = (await require('./tarifa').datos()); const x = [...t.mano_obra, ...t.maquinaria].find((y) => y.id === l.tarifa_id);
      if (x && Math.abs((x.coste_efectivo ?? 0) - num(b.precio)) > 0.005) sugerencia = { tarifa_id: x.id, nombre: x.nombre, clase: x.clase, unidad: x.unidad, actual: x.coste_efectivo, nuevo: num(b.precio) };
    }
    await tocar(l.presupuesto_id); res.json({ ...(await cargar(l.presupuesto_id)), sugerencia_tarifa: sugerencia });
  }));
  // Fijar en la tarifa el coste corregido en un presupuesto: { tarifa_id, coste }
  app.post('/api/presupuestos/tarifa-desde-linea', ver, asyncH(async (req, res) => {
    const id = Number(req.body?.tarifa_id); const c = num(req.body?.coste);
    if (!id || c == null || c < 0) throw fallo(400, 'Datos no válidos');
    const { rows: [t] } = await query('SELECT clase FROM tarifa WHERE id = $1', [id]);
    if (!t) throw fallo(404, 'No está en la tarifa');
    await query(`UPDATE tarifa SET ${t.clase === 'mano_obra' ? 'coste_presupuesto' : 'coste_manual'} = $2, cambiado_por = $3, cambiado_en = now() WHERE id = $1`, [id, c, req.usuario.id]);
    res.json({ ok: true });
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
    // { enviar: true }: se manda ya el correo a cada proveedor (PDF + enlace para responder en la plataforma)
    const envio = { enviados: [], sin_correo: [], errores: [] };
    if (b.enviar) {
      const Sol = require('./solicitudes'); const s = await Sol.solicitud(sid);
      for (const pv of s.proveedores) {
        if (!pv.email) { envio.sin_correo.push(pv.proveedor); continue; }
        try { envio.enviados.push(await Sol.enviarAProveedor(sid, pv.id, {}, req)); } catch (e) { envio.errores.push(`${pv.proveedor}: ${e.message}`); }
      }
    }
    res.status(201).json({ ...(await cargar(id)), solicitud_id: sid, envio });
  }));

  // Descuento por encima del límite: pedir aprobación · aprobar / no aprobar (permiso aprobar_descuentos)
  const N = () => require('./notificaciones');
  app.post('/api/presupuestos/:id/descuento/pedir', ver, asyncH(async (req, res) => {
    const id = Number(req.params.id); const p = await cargar(id); editable(p);
    if (!p.dto_necesita) throw fallo(400, 'Este descuento no necesita aprobación');
    await query('UPDATE presupuestos SET dto_pedido_en = now(), dto_pedido_por = $2, dto_respuesta = NULL WHERE id = $1', [id, req.usuario.id]);
    await query(`INSERT INTO presupuesto_eventos (presupuesto_id, clase, texto) VALUES ($1, 'aviso', $2)`, [id, `Se pide aprobar un descuento del ${fmtPct(p.dto_max_pct)} % (${req.usuario.nombre})${p.dto_motivo ? `: ${p.dto_motivo}` : ''}`]).catch(() => {});
    N().avisarLuego(N().conPermiso('aprobar_descuentos'), 'presupuesto_dto', { titulo: `Descuento del ${fmtPct(p.dto_max_pct)} % por aprobar`, cuerpo: `${p.codigo} · ${p.cliente || p.titulo} · ${eurTxt(p.venta)} sin IVA, margen ${p.margen_real_pct ?? '—'} %${p.dto_motivo ? ` · ${p.dto_motivo}` : ''}`, url: `/presupuestos.html?id=${id}`, tag: `pz-dto-${id}` });
    res.json(await cargar(id));
  }));
  app.post('/api/presupuestos/:id/descuento/decidir', auth.permiso('aprobar_descuentos'), asyncH(async (req, res) => {
    const id = Number(req.params.id); const p = await cargar(id); editable(p); const b = req.body || {};
    const nota = texto(b.nota, 300);
    if (b.ok) await query('UPDATE presupuestos SET dto_aprobado_pct = $2, dto_aprobado_por = $3, dto_aprobado_en = now(), dto_pedido_en = NULL, dto_respuesta = $4 WHERE id = $1', [id, p.dto_max_pct, req.usuario.id, nota]);
    else { if (!nota) throw fallo(400, 'Di el motivo'); await query('UPDATE presupuestos SET dto_pedido_en = NULL, dto_respuesta = $2 WHERE id = $1', [id, `No aprobado: ${nota}`]); }
    await query(`INSERT INTO presupuesto_eventos (presupuesto_id, clase, texto) VALUES ($1, 'aviso', $2)`, [id, `${b.ok ? '✔ Descuento aprobado' : '✕ Descuento no aprobado'} (${fmtPct(p.dto_max_pct)} %) por ${req.usuario.nombre}${nota ? `: ${nota}` : ''}`]).catch(() => {});
    if (p.dto_pedido_por) N().avisarLuego([p.dto_pedido_por], 'presupuesto_dto', { titulo: `${b.ok ? '✔ Aprobado' : '✕ No aprobado'}: descuento de ${p.codigo}`, cuerpo: `${fmtPct(p.dto_max_pct)} % · ${req.usuario.nombre}${nota ? ` · ${nota}` : ''}`, url: `/presupuestos.html?id=${id}`, tag: `pz-dto-${id}` });
    res.json(await cargar(id));
  }));
  app.get('/api/presupuestos-ajustes', ver, asyncH(async (req, res) => res.json(await ajustesP())));
  app.put('/api/presupuestos-ajustes', auth.permiso('aprobar_descuentos', 'usuarios'), asyncH(async (req, res) => {
    const v = num(req.body?.dto_limite); if (v == null || v < 0 || v > 100) throw fallo(400, 'El límite va de 0 a 100 %');
    const nuevo = { ...(await ajustesP()), dto_limite: v };
    await query(`INSERT INTO ajustes (clave, valor) VALUES ('presupuestos', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(nuevo)]);
    res.json(nuevo);
  }));

  // Peticiones de este presupuesto abiertas y sin enviar a algún proveedor · enviarlas todas por correo
  const sinEnviar = (id) => query(`SELECT s.id AS solicitud_id, s.codigo, sp.id AS sp_id, pr.nombre AS proveedor, pr.email
      FROM solicitudes_precio s JOIN solicitud_proveedores sp ON sp.solicitud_id = s.id JOIN proveedores pr ON pr.id = sp.proveedor_id
     WHERE s.presupuesto_id = $1 AND s.estado = 'abierta' AND sp.enviado_en IS NULL ORDER BY s.id, pr.nombre`, [id]).then((r) => r.rows);
  app.get('/api/presupuestos/:id/peticiones-sin-enviar', ver, asyncH(async (req, res) => res.json(await sinEnviar(Number(req.params.id)))));
  app.post('/api/presupuestos/:id/enviar-peticiones', ver, asyncH(async (req, res) => {
    const envio = { enviados: [], sin_correo: [], errores: [] }; const Sol = require('./solicitudes');
    for (const x of await sinEnviar(Number(req.params.id))) {
      if (!x.email) { envio.sin_correo.push(x.proveedor); continue; }
      try { envio.enviados.push(await Sol.enviarAProveedor(x.solicitud_id, x.sp_id, {}, req)); } catch (e) { envio.errores.push(`${x.proveedor}: ${e.message}`); }
    }
    res.json({ envio });
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
    const det = req.query.detallado === '1'; const int = req.query.interno === '1';
    if (int && !auth.tiene(req.usuario, 'costes') && !auth.tiene(req.usuario, 'presupuestos')) throw fallo(403, 'Sin permiso');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${req.query.descargar ? 'attachment' : 'inline'}; filename="${p.codigo}${int ? '-interno-costes' : det ? '-detallado' : ''}.pdf"`);
    (await pdf(p, det, int)).pipe(res);
  }));
}

// Una vez: los materiales de la lista que estaban en otra unidad (p. ej. perfiles en kg) pasan a la del material,
// convirtiendo cantidad y precio; el precio se sigue viendo en la unidad que tenía (€/kg).
async function normalizarUnidades() {
  const { rows: [h] } = await query(`SELECT 1 FROM ajustes WHERE clave = 'migr_pres_unidades'`);
  if (h) return preciosAntiguosALista();
  const { rows } = await query(`SELECT id, catalogo_id, unidad, por_ud::float AS por_ud, precio::float AS precio FROM presupuesto_lineas WHERE tipo = 'material' AND catalogo_id IS NOT NULL AND calculo IS NULL`);
  let n = 0;
  for (const l of rows) {
    const m = await U.deCatalogo(l.catalogo_id); if (!m || U.unidad(l.unidad) === m.base) continue;
    const c = U.convertirCantidad(l.por_ud, l.unidad, m.base, m.factores); if (c == null) continue;
    const p = l.precio == null ? null : U.convertirPrecio(l.precio, l.unidad, m.base, m.factores);
    await query('UPDATE presupuesto_lineas SET unidad = $2, por_ud = $3, precio = COALESCE($4, precio), unidad_ver = $5 WHERE id = $1', [l.id, m.base, +c.toFixed(4), p == null ? null : +p.toFixed(4), U.unidad(l.unidad)]);
    n++;
  }
  await query(`INSERT INTO ajustes (clave, valor) VALUES ('migr_pres_unidades', $1) ON CONFLICT (clave) DO NOTHING`, [JSON.stringify({ lineas: n })]);
  if (n) console.log(`Presupuestos: ${n} línea(s) de material pasadas a la unidad de su material`);
  await preciosAntiguosALista();
}

// Una vez: los precios ya corregidos a mano en presupuestos pasan a la Lista de precios (origen «presupuesto»)
async function preciosAntiguosALista() {
  const { rows: [h] } = await query(`SELECT 1 FROM ajustes WHERE clave = 'migr_pres_precios_lista'`);
  if (h) return;
  const { rows } = await query(`SELECT id FROM presupuesto_lineas WHERE fuente = 'manual' AND precio IS NOT NULL AND tipo IN ('material', 'auxiliar', 'subcontrata')`);
  for (const l of rows) await precioALista(l.id).catch((e) => console.warn('precio a lista', l.id, e.message));
  await query(`INSERT INTO ajustes (clave, valor) VALUES ('migr_pres_precios_lista', $1) ON CONFLICT (clave) DO NOTHING`, [JSON.stringify({ lineas: rows.length })]);
  if (rows.length) console.log(`Presupuestos: ${rows.length} precio(s) corregido(s) a mano pasados a la Lista de precios`);
}

module.exports = { normalizarUnidades, montar, cargar, precioMaterial, precioTarifa };
