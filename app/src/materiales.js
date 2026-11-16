// Materiales de las OTs.
//  · ESTIMADO: lo que el compositor calcula desde el presupuesto (viene en la importación s360-import/1).
//  · BOM: el despiece real que hace el técnico (Sofía) en Onshape; se pega aquí como JSON
//    (s360-bom/1, normalmente preparado por una IA) o como tabla copiada de una hoja.
//  Cada línea va ligada a la TAREA que la consume (así se sabe cuándo hace falta).
//  Por OT se agrupa «el mismo material a comprar» (perfil + material + acabado), se optimiza
//  el corte en barras comerciales y almacén dice cuánto hay. Lo que falta es lo que se pide.
const { query, tx } = require('./db');
const auth = require('./auth');
const N = require('./material-norma');
const { optimizar } = require('./corte');
const notif = require('./notificaciones');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max) => String(v ?? '').trim().slice(0, max) || null;
const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

const AJUSTES_DEF = {
  barra_mm: 6000,          // barra comercial habitual
  kerf_mm: 3,              // ancho de la sierra
  retal_min_mm: 300,       // sobrante que se guarda como retal aprovechable
  margen_dias: 1,          // días entre que llega el material y se puede usar
  tragina: { corte_dia: 5, corte_hora: 16, llegada_dia: 3 },   // pedir antes del viernes 16:00 → llega el miércoles
  barras_tipo: { VARILLA: 1000 },                              // barra por defecto según el tipo de perfil
};
async function ajustes() {
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'materiales'`);
  const v = rows[0]?.valor || {};
  return { ...AJUSTES_DEF, ...v, tragina: { ...AJUSTES_DEF.tragina, ...(v.tragina || {}) }, barras_tipo: { ...AJUSTES_DEF.barras_tipo, ...(v.barras_tipo || {}) } };
}

/* ---------- Leer líneas (JSON, tabla pegada) y normalizarlas ---------- */

// nombres de columna / campo que se aceptan (en minúsculas y sin acentos)
const ALIAS = {
  marca: ['marca', 'ref', 'referencia', 'pieza', 'posicion', 'pos', 'item', 'n', 'no', 'num'],
  perfil: ['perfil', 'perfil_comercial', 'seccion', 'tipo_perfil', 'tipo de perfil'],
  descripcion: ['descripcion', 'nombre', 'articulo', 'material_comercial', 'concepto', 'producto'],
  material: ['material', 'calidad', 'acero', 'grado'],
  acabado: ['acabado', 'estado', 'superficie', 'acabado_compra'],
  tratamiento: ['tratamiento', 'acabado_final', 'proteccion'],
  familia: ['familia', 'categoria', 'grupo'],
  longitud_mm: ['longitud_mm', 'longitud', 'largo', 'long', 'l', 'l (mm)', 'longitud (mm)', 'largo (mm)', 'l. x ud', 'length'],
  angulo_a: ['angulo_a', 'ang_a', 'angulo 1', 'angulo1', 'ang. a', 'corte a', 'angulo a', 'a1'],
  angulo_b: ['angulo_b', 'ang_b', 'angulo 2', 'angulo2', 'ang. b', 'corte b', 'angulo b', 'a2'],
  cantidad: ['cantidad', 'cant', 'cant.', 'uds', 'ud', 'unidades', 'qty', 'quantity', 'necesidad', 'n piezas'],
  unidad: ['unidad', 'ud med', 'ud. med.', 'unid', 'u.m.', 'um'],
  peso_kg: ['peso_kg', 'peso', 'peso (kg)', 'kg'],
  tarea: ['tarea', 'tarea_ref', 'consume', 'proceso'],
  notas: ['notas', 'nota', 'observaciones', 'obs', 'comentario'],
};
const CAMPO = {};
for (const [k, lista] of Object.entries(ALIAS)) for (const a of lista) CAMPO[a] = k;
const campoDe = (nombre) => CAMPO[sinAcentos(nombre).replace(/\s+/g, ' ')] || CAMPO[sinAcentos(nombre).replace(/[\s.]+/g, '_')] || null;

function mapearObjeto(o) {
  const out = {};
  for (const [k, v] of Object.entries(o || {})) {
    const c = campoDe(k);
    if (c && out[c] == null && v !== '' && v != null) out[c] = v;
  }
  return out;
}

// Texto pegado: JSON (s360-bom/1, lista de piezas) o tabla con cabecera (tabulador, ; o ,)
function parsear(textoEntrada) {
  const t = String(textoEntrada || '').trim();
  if (!t) throw fallo(400, 'No hay nada que importar');
  if (/^[[{]/.test(t)) {
    let j;
    try { j = JSON.parse(t); } catch (e) { throw fallo(400, `El JSON no es válido: ${e.message}`); }
    if (Array.isArray(j)) return { tarea: null, filas: j.map(mapearObjeto), formato: 'lista' };
    if (j.formato && j.formato !== 's360-bom/1') throw fallo(400, `Formato «${j.formato}» no admitido (se espera s360-bom/1)`);
    const filas = [];
    for (const p of j.piezas || []) filas.push(mapearObjeto(p));
    for (const c of j.comerciales || []) filas.push({ ...mapearObjeto(c), _comercial: true });
    if (!filas.length) throw fallo(400, 'El JSON no trae «piezas» ni «comerciales»');
    return { tarea: j.tarea || null, filas, formato: 's360-bom/1', ot: j.ot || null };
  }
  const lineas = t.split(/\r?\n/).filter((l) => l.trim());
  const sep = lineas[0].includes('\t') ? '\t' : lineas[0].includes(';') ? ';' : ',';
  const cab = lineas[0].split(sep).map((c) => campoDe(c.replace(/^"|"$/g, '')));
  if (cab.filter(Boolean).length < 2 || !(cab.includes('cantidad') && (cab.includes('perfil') || cab.includes('descripcion')))) {
    throw fallo(400, 'La primera fila debe ser la cabecera, con al menos «perfil» (o «descripción») y «cantidad»');
  }
  const filas = lineas.slice(1).map((l) => {
    const celdas = l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim());
    const o = {};
    cab.forEach((c, i) => { if (c && celdas[i] !== '' && celdas[i] != null && o[c] == null) o[c] = celdas[i]; });
    return o;
  }).filter((o) => Object.keys(o).length);
  return { tarea: null, filas, formato: 'tabla' };
}

// Una fila → línea normalizada + avisos (o error si no se puede usar)
function normalizar(f, origen) {
  const avisos = [];
  const n = (v) => (v == null || v === '' ? null : N.num(v));
  // sin perfil, la descripción solo cuenta como perfil si se reconoce («Tubo 40x40x2»); si no, es un comercial
  const desdeDesc = !f.perfil && !f._comercial && f.descripcion ? N.perfil(f.descripcion) : null;
  const textoPerfil = f.perfil || (desdeDesc?.reconocido ? f.descripcion : '') || '';
  const p = N.perfil(textoPerfil);
  const mat = N.material(f.material || '');
  let acab = N.acabado(f.acabado || '', mat);
  let trat = N.tratamiento(f.tratamiento || '');
  // «G+P», «galvanizado y pintado»… en el acabado es lo que se le hace después: no cambia la compra
  if (!trat && /g\s*\+\s*p|duplex|pintad/i.test(String(f.acabado || '')) && !/sendz|pregal/i.test(String(f.acabado || ''))) {
    trat = N.tratamiento(f.acabado); acab = mat.startsWith('S') ? 'negro' : '';
  }
  let familia = N.familia(f.familia || '') || p.familia || (f._comercial ? 'otros' : '');
  // en mm nunca hay tres decimales: «1.180» (copiado de un Excel en español) son 1180 mm
  const longitud = /^\s*\d{1,3}(\.\d{3})+(,\d+)?\s*$/.test(String(f.longitud_mm ?? '')) ? n(String(f.longitud_mm).replace(/\./g, '')) : n(f.longitud_mm);
  let unidad = N.unidad(f.unidad || '');
  let cantidad = n(f.cantidad);
  if (!familia) familia = longitud ? 'largos' : 'otros';
  if (!unidad) unidad = familia === 'largos' && !longitud && origen === 'estimado' ? 'm' : 'ud';
  const linea = {
    familia,
    perfil: textoPerfil ? p.perfil : null,
    material: mat || null,
    acabado: acab || null,
    tratamiento: trat || null,
    descripcion: texto(f.descripcion, 200),
    marca: texto(f.marca, 40),
    longitud_mm: longitud,
    angulo_a: n(f.angulo_a),
    angulo_b: n(f.angulo_b),
    cantidad,
    unidad,
    peso_kg: n(f.peso_kg),
    notas: texto(f.notas, 500),
    tarea: f.tarea != null ? String(f.tarea) : null,
  };
  if (!linea.perfil && !linea.descripcion) return { error: 'Falta el perfil o la descripción', linea };
  if (!(cantidad > 0)) return { error: 'Falta la cantidad (o no es un número)', linea };
  if (textoPerfil && !p.reconocido && familia === 'largos') avisos.push('Perfil no reconocido: se agrupa por el texto tal cual');
  if (familia === 'largos' && origen === 'bom' && !(longitud > 0) && unidad === 'ud') avisos.push('Sin longitud: no entra en la optimización de corte');
  if (familia === 'largos' && !linea.material) avisos.push('Sin material (S235, INOX 304…)');
  for (const a of ['angulo_a', 'angulo_b']) if (linea[a] != null && !(linea[a] >= 0 && linea[a] <= 180)) { avisos.push('Ángulo fuera de 0–180°'); linea[a] = null; }
  if (longitud != null && !(longitud > 0 && longitud < 100000)) return { error: 'Longitud no válida (en mm)', linea };
  return { linea, avisos };
}

// tarea indicada en la fila → id de tarea de la OT (por id, ref_externa o nombre)
function resolverTarea(valor, tareas, porDefecto) {
  if (valor == null || valor === '') return porDefecto || null;
  const v = sinAcentos(valor);
  const id = Number(valor);
  return (Number.isInteger(id) && tareas.find((t) => t.id === id)?.id)
    || tareas.find((t) => t.ref_externa && sinAcentos(t.ref_externa) === v)?.id
    || tareas.find((t) => sinAcentos(t.nombre) === v)?.id
    || tareas.find((t) => sinAcentos(t.nombre).startsWith(v))?.id
    || tareas.find((t) => sinAcentos(t.nombre).includes(v))?.id
    || parecida(v, tareas)
    || null;
}
// «Corte perfiles HEA» ≈ «Corte de perfiles laminados HEA/IPE…»: la que comparte más palabras (≥ 60 % de las del texto)
const palabras = (s) => new Set(sinAcentos(s).split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !['del', 'las', 'los', 'con', 'para', 'por', 'una'].includes(w)));
function parecida(v, tareas) {
  const pv = palabras(v);
  if (pv.size < 2) return null;
  let mejor = null, nota = 0;
  for (const t of tareas) {
    const pt = palabras(t.nombre);
    const comunes = [...pv].filter((w) => pt.has(w)).length;
    const x = comunes / pv.size;
    if (x > nota) { nota = x; mejor = t; }
  }
  return nota >= 0.6 ? mejor.id : null;
}
// tareas del proyecto de la OT; las de la propia OT primero (ganan si hay nombres repetidos)
async function tareasProyecto(ordenId) {
  const { rows } = await query(
    `SELECT t.id, t.nombre, t.ref_externa, t.orden_id, o.codigo AS ot_codigo, t.orden_id = $1 AS de_esta_ot,
            (SELECT min(x.fecha) FROM tramos x WHERE x.tarea_id = t.id) AS primera_fecha
       FROM tareas t JOIN ordenes o ON o.id = t.orden_id
      WHERE o.proyecto_id = (SELECT proyecto_id FROM ordenes WHERE id = $1)
      ORDER BY (t.orden_id = $1) DESC, o.codigo, t.orden_en_of, t.id`, [ordenId]);
  return rows;
}

/* ---------- Cálculo por OT: grupos, corte, estimado vs real, fechas ---------- */

const ddmm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;
const sumarDias = (f, d) => { const x = new Date(`${f}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };
const diaSemana = (f) => new Date(`${f}T12:00:00Z`).getUTCDay();
const ahoraMadrid = () => {
  const s = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' });
  return { fecha: s.slice(0, 10), hora: Number(s.slice(11, 13)) + Number(s.slice(14, 16)) / 60 };
};

// Vía Tragina: último miércoles que deja el margen antes de la fecha necesaria, y el viernes 16:00 anterior
function viaTragina(fechaNecesaria, aj) {
  if (!fechaNecesaria) return null;
  const tg = aj.tragina;
  let llegada = sumarDias(fechaNecesaria, -aj.margen_dias);
  while (diaSemana(llegada) !== tg.llegada_dia) llegada = sumarDias(llegada, -1);
  const atras = ((tg.llegada_dia - tg.corte_dia + 7) % 7) || 7;
  const pedirAntes = sumarDias(llegada, -atras);
  const ahora = ahoraMadrid();
  const vencido = ahora.fecha > pedirAntes || (ahora.fecha === pedirAntes && ahora.hora >= tg.corte_hora);
  return { llegada, pedir_antes: pedirAntes, hora: tg.corte_hora, vencido, texto: `vie ${ddmm(pedirAntes)} ${tg.corte_hora}:00 → llega ${ddmm(llegada)}` };
}

async function calcular(ordenId) {
  const aj = await ajustes();
  const { rows: ot } = await query(
    `SELECT o.id, o.codigo, o.titulo, o.bom_en, ub.nombre AS bom_por, p.id AS proyecto_id, p.codigo AS proyecto_codigo, p.nombre AS proyecto_nombre
       FROM ordenes o LEFT JOIN proyectos p ON p.id = o.proyecto_id LEFT JOIN usuarios ub ON ub.id = o.bom_por
      WHERE o.id = $1`, [ordenId]);
  if (!ot.length) throw fallo(404, 'OT no encontrada');
  const tareas = await tareasProyecto(ordenId);
  const { rows: lineas } = await query(
    `SELECT m.* FROM materiales m WHERE m.orden_id = $1 ORDER BY m.origen, m.orden, m.id`, [ordenId]);
  const { rows: dec } = await query(
    `SELECT g.*, u.nombre AS revisado_por_nombre FROM material_grupos g LEFT JOIN usuarios u ON u.id = g.revisado_por
      WHERE g.orden_id = $1`, [ordenId]);
  const decision = new Map(dec.map((d) => [d.clave, d]));
  const fechaTarea = new Map(tareas.map((t) => [t.id, t.primera_fecha]));
  const hayBom = lineas.some((l) => l.origen === 'bom');

  const grupos = new Map();
  for (const l of lineas) {
    const k = N.clave(l);
    l.clave = k;
    let g = grupos.get(k);
    if (!g) {
      g = { clave: k, familia: l.familia, perfil: l.perfil, material: l.material, acabado: l.acabado, descripcion: l.descripcion,
        unidad: l.familia === 'largos' ? 'barra' : l.unidad, bom: [], estimado: [], tareas: new Set() };
      grupos.set(k, g);
    }
    g[l.origen].push(l);
  }

  const lista = [];
  for (const g of grupos.values()) {
    const d = decision.get(g.clave) || {};
    const base = hayBom ? g.bom : g.estimado;   // con BOM, se pide por el BOM; sin él, por la estimación
    for (const l of base) g.tareas.add(l.tarea_id);
    const fechas = [...g.tareas].map((id) => fechaTarea.get(id)).filter(Boolean).sort();
    const tipo = (g.perfil || '').split(' ')[0];
    const barraDef = aj.barras_tipo[tipo] || aj.barras_tipo[(g.perfil || '').split(' ').slice(0, 2).join(' ')] || aj.barra_mm;
    const maxPieza = Math.max(0, ...(hayBom ? g.bom : g.estimado).map((l) => (l.unidad === 'ud' ? Number(l.longitud_mm) || 0 : 0)));
    const barraAuto = maxPieza > barraDef ? ([12000, 14000, 16000].find((x) => x >= maxPieza) || barraDef) : barraDef;
    const barra = d.barra_mm || barraAuto;
    const out = {
      clave: g.clave, familia: g.familia, perfil: g.perfil, material: g.material, acabado: g.acabado, descripcion: g.descripcion,
      tareas: [...g.tareas], fecha_necesaria: fechas[0] || null,
      barra_mm: barra, barra_def_mm: barraAuto, barra_auto: barraAuto !== barraDef,
      en_stock: d.en_stock ?? null, nota: d.nota || null, revisado_por: d.revisado_por_nombre || null, revisado_en: d.revisado_en || null,
      n_bom: g.bom.length, n_estimado: g.estimado.length,
    };
    const conLongitud = (ls) => ls.filter((l) => l.longitud_mm > 0 && l.unidad === 'ud');
    const metros = (ls) => ls.reduce((s, l) => s + (l.unidad === 'm' ? l.cantidad : l.unidad === 'barra' ? l.cantidad * barra / 1000
      : l.longitud_mm > 0 ? (l.longitud_mm * l.cantidad) / 1000 : 0), 0);
    const cantidad = (ls) => ls.reduce((s, l) => s + l.cantidad, 0);
    const optimizable = g.familia === 'largos' || conLongitud(base).length === base.length && base.length > 0;
    if (optimizable) {
      out.unidad = 'barra';
      const piezas = conLongitud(base).map((l) => ({ marca: l.marca, longitud_mm: l.longitud_mm, cantidad: l.cantidad }));
      const sueltas = base.filter((l) => !(l.longitud_mm > 0 && l.unidad === 'ud'));   // en metros o barras
      out.corte = piezas.length ? optimizar(piezas, { barra_mm: barra, kerf_mm: aj.kerf_mm, retal_min_mm: aj.retal_min_mm }) : null;
      const barrasSueltas = Math.ceil(metros(sueltas) * 1000 / barra - 1e-9);
      out.necesario = (out.corte?.barras || 0) + barrasSueltas + (out.corte?.excedidas || []).reduce((s, e) => s + Math.ceil(e.longitud_mm / barra) * e.cantidad, 0);
      out.metros_real = g.bom.length ? Math.round(metros(g.bom) * 100) / 100 : null;
      out.metros_estimado = g.estimado.length ? Math.round(metros(g.estimado) * 100) / 100 : null;
      out.barras_estimado = g.estimado.length ? Math.ceil(metros(g.estimado) * 1000 / barra - 1e-9) : null;
      out.piezas = conLongitud(g.bom).reduce((s, l) => s + l.cantidad, 0);
      out.peso_kg = g.bom.reduce((s, l) => s + (l.peso_kg || 0) * (l.peso_kg ? l.cantidad : 0), 0) || null;
    } else {
      out.unidad = base[0]?.unidad || g.unidad;
      out.necesario = Math.round(cantidad(base) * 1000) / 1000;
      out.cantidad_real = g.bom.length ? cantidad(g.bom) : null;
      out.cantidad_estimado = g.estimado.length ? cantidad(g.estimado) : null;
    }
    out.a_pedir = out.en_stock == null ? null : Math.max(0, Math.round((out.necesario - out.en_stock) * 1000) / 1000);
    out.tragina = out.a_pedir === 0 ? null : viaTragina(out.fecha_necesaria, aj);
    if (!base.length) out.solo_estimado = true;   // con BOM ya cargado, lo estimado que no aparece en el BOM
    lista.push(out);
  }
  const orden = ['largos', 'chapas', 'ferreteria', 'pintura', 'consumibles'];
  const pos = (f) => (orden.includes(f) ? orden.indexOf(f) : 99);
  lista.sort((a, b) => pos(a.familia) - pos(b.familia) || String(a.perfil || a.descripcion).localeCompare(String(b.perfil || b.descripcion), 'es', { numeric: true }));

  const activos = lista.filter((g) => !g.solo_estimado);
  return {
    ot: ot[0], tareas, lineas, grupos: lista, ajustes: aj, hay_bom: hayBom,
    resumen: {
      materiales: activos.length,
      revisados: activos.filter((g) => g.en_stock != null).length,
      a_pedir: activos.filter((g) => g.a_pedir > 0).length,
      barras: activos.filter((g) => g.unidad === 'barra').reduce((s, g) => s + g.necesario, 0),
      fecha_necesaria: activos.map((g) => g.fecha_necesaria).filter(Boolean).sort()[0] || null,
    },
  };
}

/* ---------- Rutas ---------- */

function montar(app, asyncH) {
  app.get('/api/materiales/opciones', asyncH(async (req, res) => {
    res.json({ familias: N.FAMILIAS, acabados: N.ACABADOS, tratamientos: N.TRATAMIENTOS, unidades: N.UNIDADES, ajustes: await ajustes() });
  }));

  app.put('/api/materiales/ajustes', auth.permiso('materiales', 'compras'), asyncH(async (req, res) => {
    const b = req.body || {};
    const actual = await ajustes();
    const entero = (v, min, max, def) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
    const nuevo = {
      barra_mm: entero(b.barra_mm, 500, 20000, actual.barra_mm),
      kerf_mm: entero(b.kerf_mm, 0, 20, actual.kerf_mm),
      retal_min_mm: entero(b.retal_min_mm, 0, 6000, actual.retal_min_mm),
      margen_dias: entero(b.margen_dias, 0, 14, actual.margen_dias),
      tragina: {
        corte_dia: entero(b.tragina?.corte_dia, 0, 6, actual.tragina.corte_dia),
        corte_hora: entero(b.tragina?.corte_hora, 0, 23, actual.tragina.corte_hora),
        llegada_dia: entero(b.tragina?.llegada_dia, 0, 6, actual.tragina.llegada_dia),
      },
      barras_tipo: actual.barras_tipo,
    };
    await query(`INSERT INTO ajustes (clave, valor) VALUES ('materiales', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(nuevo)]);
    res.json(nuevo);
  }));

  app.get('/api/ordenes/:id/materiales', asyncH(async (req, res) => {
    const r = await calcular(Number(req.params.id));
    r.puede = { editar: auth.tiene(req.usuario, 'materiales'), almacen: auth.tiene(req.usuario, 'almacen') };
    res.json(r);
  }));

  // Importar el BOM (o, con origen=estimado, una estimación a mano). simular=true solo devuelve la vista previa.
  app.post('/api/ordenes/:id/materiales/importar', auth.permiso('materiales'), asyncH(async (req, res) => {
    const ordenId = Number(req.params.id);
    const b = req.body || {};
    const origen = b.origen === 'estimado' ? 'estimado' : 'bom';
    const tareas = await tareasProyecto(ordenId);
    if (!tareas.some((t) => t.de_esta_ot)) throw fallo(400, 'La OT no tiene tareas: crea antes la tarea que consume el material');
    const { rows: ot } = await query('SELECT codigo, titulo FROM ordenes WHERE id = $1', [ordenId]);
    const p = parsear(b.texto);
    if (p.ot && ot[0] && sinAcentos(p.ot) !== sinAcentos(ot[0].codigo)) {
      throw fallo(400, `El archivo es de la ${p.ot} y estás en la ${ot[0].codigo}`);
    }
    const tareaDef = resolverTarea(b.tarea_id, tareas, null) || resolverTarea(p.tarea, tareas, null);
    const filas = [];
    let errores = 0;
    p.filas.forEach((f, i) => {
      const r = normalizar(f, origen);
      let tareaId = r.linea ? resolverTarea(r.linea.tarea, tareas, tareaDef) : null;
      // tarea que no existe en el proyecto: va a la de por defecto con aviso (se corrige luego en el despiece)
      if (!r.error && !tareaId && r.linea.tarea && tareaDef) {
        tareaId = tareaDef;
        r.avisos = [...(r.avisos || []), `Tarea «${r.linea.tarea}» no encontrada: va a la de por defecto`];
      }
      if (!r.error && !tareaId) r.error = 'Elige la tarea que consume el material';
      if (r.error) errores++;
      filas.push({ fila: i + 1, ...r, tarea_id: tareaId });
    });
    const validas = filas.filter((f) => !f.error);
    if (b.simular) {
      return res.json({ formato: p.formato, filas, validas: validas.length, errores, tarea_defecto: tareaDef,
        aviso_tarea: p.tarea && !resolverTarea(p.tarea, tareas, null) ? `La tarea «${p.tarea}» del archivo no está en esta OT: elige una` : null,
        reemplaza: (await query(`SELECT count(*)::int AS n FROM materiales WHERE orden_id = $1 AND origen = $2`, [ordenId, origen])).rows[0].n });
    }
    if (!validas.length) throw fallo(400, 'Ninguna línea válida');
    if (errores && !b.ignorar_errores) throw fallo(400, `${errores} línea(s) con error: corrígelas o impórtalas sin ellas`);
    await tx(async (c) => {
      // el BOM se sustituye entero (es la foto del despiece actual)
      await c.query(`DELETE FROM materiales WHERE orden_id = $1 AND origen = $2`, [ordenId, origen]);
      let i = 0;
      for (const f of validas) {
        const l = f.linea;
        await c.query(
          `INSERT INTO materiales (orden_id, tarea_id, origen, familia, perfil, material, acabado, tratamiento, descripcion, marca,
                                   longitud_mm, angulo_a, angulo_b, cantidad, unidad, peso_kg, notas, orden, creado_por)
           VALUES ($19,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
          [f.tarea_id, origen, l.familia, l.perfil, l.material, l.acabado, l.tratamiento, l.descripcion, l.marca,
            l.longitud_mm, l.angulo_a, l.angulo_b, l.cantidad, l.unidad, l.peso_kg, l.notas, ++i, req.usuario.id, ordenId]);
      }
      if (origen === 'bom') await c.query('UPDATE ordenes SET bom_en = now(), bom_por = $2 WHERE id = $1', [ordenId, req.usuario.id]);
    });
    if (origen === 'bom') {
      const r = await calcular(ordenId);
      notif.avisarLuego(notif.conPermiso('almacen'), 'materiales', {
        titulo: `Material a revisar · ${ot[0].codigo}`,
        cuerpo: `${r.resumen.materiales} materiales de «${ot[0].titulo}»${r.resumen.fecha_necesaria ? `, hacen falta el ${ddmm(r.resumen.fecha_necesaria)}` : ''}. ¿Qué hay en el almacén?`,
        url: `/almacen.html?ot=${ordenId}`, tag: `material-${ordenId}`,
      });
    }
    res.json({ ok: true, importadas: validas.length, omitidas: errores });
  }));

  // Línea suelta (añadir / editar / borrar) desde la tabla
  async function leerLineaEditable(b, ordenId, parcial) {
    const r = normalizar({ ...mapearObjeto(b), _comercial: !b.perfil && !!b.descripcion }, b.origen === 'estimado' ? 'estimado' : 'bom');
    if (r.error && !parcial) throw fallo(400, r.error);
    if (b.tarea_id != null) {
      const { rows } = await query(
        `SELECT 1 FROM tareas t JOIN ordenes o ON o.id = t.orden_id
          WHERE t.id = $1 AND o.proyecto_id = (SELECT proyecto_id FROM ordenes WHERE id = $2)`, [Number(b.tarea_id), ordenId]);
      if (!rows.length) throw fallo(400, 'La tarea no es de este proyecto');
    }
    return r;
  }
  const COLS = ['familia', 'perfil', 'material', 'acabado', 'tratamiento', 'descripcion', 'marca', 'longitud_mm', 'angulo_a', 'angulo_b', 'cantidad', 'unidad', 'peso_kg', 'notas'];

  app.post('/api/ordenes/:id/materiales', auth.permiso('materiales'), asyncH(async (req, res) => {
    const ordenId = Number(req.params.id);
    const b = req.body || {};
    if (!b.tarea_id) throw fallo(400, 'Elige la tarea que consume el material');
    const r = await leerLineaEditable(b, ordenId, false);
    const l = r.linea;
    const { rows } = await query(
      `INSERT INTO materiales (tarea_id, origen, ${COLS.join(', ')}, orden, creado_por, orden_id)
       VALUES ($1, $2, ${COLS.map((_, i) => `$${i + 3}`).join(', ')},
               COALESCE((SELECT max(orden) FROM materiales WHERE orden_id = $${COLS.length + 4}), 0) + 1, $${COLS.length + 3}, $${COLS.length + 4}) RETURNING *`,
      [Number(b.tarea_id), b.origen === 'estimado' ? 'estimado' : 'bom', ...COLS.map((k) => l[k]), req.usuario.id, ordenId]);
    res.status(201).json({ ...rows[0], avisos: r.avisos });
  }));

  app.patch('/api/materiales/:id', auth.permiso('materiales'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: act } = await query('SELECT m.* FROM materiales m WHERE m.id = $1', [id]);
    if (!act.length) throw fallo(404, 'Línea no encontrada');
    // se vuelve a normalizar la línea entera con lo cambiado encima
    const b = { ...act[0], ...req.body };
    const r = await leerLineaEditable({ ...b, origen: act[0].origen }, act[0].orden_id, false);
    const l = r.linea;
    const { rows } = await query(
      `UPDATE materiales SET ${COLS.map((k, i) => `${k} = $${i + 2}`).join(', ')}, tarea_id = $${COLS.length + 2} WHERE id = $1 RETURNING *`,
      [id, ...COLS.map((k) => l[k]), Number(b.tarea_id)]);
    res.json({ ...rows[0], avisos: r.avisos });
  }));

  app.delete('/api/materiales/:id', auth.permiso('materiales'), asyncH(async (req, res) => {
    await query('DELETE FROM materiales WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // Decisión sobre un material agrupado: barra comercial (técnico) o existencias (almacén)
  app.put('/api/ordenes/:id/materiales/grupo', auth.permiso('materiales', 'almacen'), asyncH(async (req, res) => {
    const ordenId = Number(req.params.id);
    const b = req.body || {};
    const clave = String(b.clave || '');
    if (!clave || clave.length > 400) throw fallo(400, 'Material no válido');
    const sets = [];
    const vals = [];
    if ('barra_mm' in b) {
      if (!auth.tiene(req.usuario, 'materiales')) throw fallo(403, 'Solo el técnico cambia la barra comercial');
      const v = b.barra_mm == null || b.barra_mm === '' ? null : Math.round(Number(b.barra_mm));
      if (v != null && !(v >= 300 && v <= 20000)) throw fallo(400, 'Barra no válida (300–20000 mm)');
      vals.push(v); sets.push(`barra_mm = $${vals.length + 2}`);
    }
    if ('en_stock' in b) {
      if (!auth.tiene(req.usuario, 'almacen')) throw fallo(403, 'Las existencias las confirma almacén');
      const v = b.en_stock == null || b.en_stock === '' ? null : Number(b.en_stock);
      if (v != null && !(v >= 0 && v < 1e7)) throw fallo(400, 'Cantidad no válida');
      vals.push(v); sets.push(`en_stock = $${vals.length + 2}`);
      vals.push(v == null ? null : req.usuario.id); sets.push(`revisado_por = $${vals.length + 2}`);
      sets.push(v == null ? 'revisado_en = NULL' : 'revisado_en = now()');
    }
    if ('nota' in b) { vals.push(texto(b.nota, 300)); sets.push(`nota = $${vals.length + 2}`); }
    if (!sets.length) throw fallo(400, 'Nada que cambiar');
    const cols = sets.map((s) => s.split(' = ')[0]);
    await query(
      `INSERT INTO material_grupos (orden_id, clave) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [ordenId, clave]);
    await query(`UPDATE material_grupos SET ${sets.join(', ')} WHERE orden_id = $1 AND clave = $2`, [ordenId, clave, ...vals]);
    res.json({ ok: true, cambiado: cols });
  }));

  // Todas las OTs con material: para almacén (qué revisar) y para la vista general
  app.get('/api/materiales/ots', auth.permiso('materiales', 'almacen', 'compras', 'proyectos', 'planificar'), asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT DISTINCT m.orden_id FROM materiales m JOIN ordenes o ON o.id = m.orden_id
        WHERE o.estado IS DISTINCT FROM 'cerrada'`);
    const out = [];
    for (const r of rows) {
      const c = await calcular(r.orden_id);
      out.push({ ...c.ot, hay_bom: c.hay_bom, ...c.resumen,
        tragina: c.grupos.filter((g) => !g.solo_estimado && (g.a_pedir == null || g.a_pedir > 0)).map((g) => g.tragina).filter(Boolean)
          .sort((a, b) => a.pedir_antes.localeCompare(b.pedir_antes))[0] || null });
    }
    out.sort((a, b) => (a.fecha_necesaria || '9999').localeCompare(b.fecha_necesaria || '9999'));
    res.json(out);
  }));

  /* ---------- Proveedores ---------- */
  const ZONAS = { menorca: 'Menorca', baleares: 'Mallorca / Baleares', peninsula: 'Península', online: 'Online' };
  const TRANSPORTES = { proveedor: 'Lo trae el proveedor', tragina: 'Menorca Tragina (miércoles)', luchana: 'Luchana (urgente)', paqueteria: 'Paquetería', recogemos: 'Lo recogemos' };

  function leerProveedor(b, parcial) {
    const o = {};
    if (!parcial || 'nombre' in b) { o.nombre = texto(b.nombre, 120); if (!o.nombre) throw fallo(400, 'El nombre es obligatorio'); }
    for (const [k, max] of [['email', 300], ['telefono', 60], ['contacto', 120], ['localidad', 120], ['web', 300], ['notas', 2000]]) if (k in b) o[k] = texto(b[k], max);
    if ('zona' in b) { if (!ZONAS[b.zona]) throw fallo(400, 'Zona no válida'); o.zona = b.zona; }
    if ('transporte' in b) { if (!TRANSPORTES[b.transporte]) throw fallo(400, 'Transporte no válido'); o.transporte = b.transporte; }
    if ('materiales' in b) o.materiales = (Array.isArray(b.materiales) ? b.materiales : String(b.materiales || '').split(',')).map((x) => String(x).trim()).filter(Boolean).slice(0, 30);
    if ('activo' in b) o.activo = !!b.activo;
    return o;
  }

  app.get('/api/proveedores', auth.permiso('compras', 'materiales', 'almacen'), asyncH(async (req, res) => {
    const { rows } = await query('SELECT * FROM proveedores ORDER BY activo DESC, lower(nombre)');
    res.json({ proveedores: rows, zonas: ZONAS, transportes: TRANSPORTES });
  }));
  app.post('/api/proveedores', auth.permiso('compras'), asyncH(async (req, res) => {
    const o = leerProveedor(req.body || {}, false);
    const cols = Object.keys(o);
    const { rows } = await query(`INSERT INTO proveedores (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, cols.map((k) => o[k]));
    res.status(201).json(rows[0]);
  }));
  app.patch('/api/proveedores/:id', auth.permiso('compras'), asyncH(async (req, res) => {
    const o = leerProveedor(req.body || {}, true);
    const cols = Object.keys(o);
    if (!cols.length) throw fallo(400, 'Nada que cambiar');
    const { rows } = await query(`UPDATE proveedores SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [Number(req.params.id), ...cols.map((k) => o[k])]);
    if (!rows.length) throw fallo(404, 'Proveedor no encontrado');
    res.json(rows[0]);
  }));
}

// La importación del compositor (s360-import/1) trae el escandallo ESTIMADO dentro de cada tarea
async function guardarEstimado(c, tareaId, lista, usuarioId) {
  await c.query(`DELETE FROM materiales WHERE tarea_id = $1 AND origen = 'estimado'`, [tareaId]);
  const avisos = [];
  let i = 0;
  for (const raw of lista || []) {
    const r = normalizar({ ...mapearObjeto(raw), _comercial: !raw.perfil }, 'estimado');
    if (r.error) { avisos.push(r.error); continue; }
    const l = r.linea;
    await c.query(
      `INSERT INTO materiales (tarea_id, origen, familia, perfil, material, acabado, tratamiento, descripcion, marca,
                               longitud_mm, angulo_a, angulo_b, cantidad, unidad, peso_kg, notas, orden, creado_por, orden_id)
       VALUES ($1,'estimado',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,(SELECT orden_id FROM tareas WHERE id = $1))`,
      [tareaId, l.familia, l.perfil, l.material, l.acabado, l.tratamiento, l.descripcion, l.marca,
        l.longitud_mm, l.angulo_a, l.angulo_b, l.cantidad, l.unidad, l.peso_kg, l.notas, ++i, usuarioId || null]);
  }
  return avisos;
}

module.exports = { montar, calcular, guardarEstimado, normalizar, parsear, viaTragina };
