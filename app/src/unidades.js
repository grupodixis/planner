// Unidades y equivalencias de los materiales (para TODO el sistema: escandallo, compras, lista de precios, presupuestos).
//
//  · Cada material tiene una UNIDAD BASE: la de medir y comparar precios. Perfiles y tubos (se compran por barra) → ml;
//    chapas → m²; el resto, su unidad del catálogo.
//  · Las equivalencias de perfiles, tubos, pletinas, macizos, laminados y chapas se CALCULAN del nombre del catálogo
//    (dimensiones, material) y del detalle («barra 6 m»): kg/ml por geometría y densidad, m² de pintura por ml (perímetro),
//    ml por barra, m² y kg por chapa. Una persona puede corregirlas (quedan como «manual»).
//  · Unidades generales (t↔kg, mm/cm↔m, cm²↔m²) valen para todo.
const DENS = { acero: 7.85, inox: 7.93, inox316: 8.0, aluminio: 2.7 };   // kg/dm³

// Alias de unidades → unidad normalizada
const ALIAS = [
  [/^(ml|m\.?l\.?|m|mts?|metros?( lineal(es)?)?|ml\.)$/i, 'ml'],
  [/^(kg|kgs|kilos?|kilogramos?)$/i, 'kg'],
  [/^(t|tn|tm|tons?|toneladas?)$/i, 't'],
  [/^(barras?|bar|br)$/i, 'barra'],
  [/^(m2|m²|mt2|metros? cuadrados?)$/i, 'm2'],
  [/^(ud|uds|u|un|unidad(es)?|pzas?|piezas?|pza)$/i, 'ud'],
  [/^(chapas?|planchas?|hojas?)$/i, 'chapa'],
  [/^(l|lt|litros?)$/i, 'l'],
  [/^(h|hr|horas?)$/i, 'h'],
];
function unidad(u) {
  const t = String(u || '').trim().replace(/^€\s*\/\s*/, '').replace(/\.$/, '');
  for (const [re, n] of ALIAS) if (re.test(t)) return n;
  return t.toLowerCase() || null;
}

// Pesos por metro de laminados normalizados (kg/m) — tablas habituales
const LAM = {
  IPE: { 80: 6.0, 100: 8.1, 120: 10.4, 140: 12.9, 160: 15.8, 180: 18.8, 200: 22.4, 220: 26.2, 240: 30.7, 270: 36.1, 300: 42.2, 330: 49.1, 360: 57.1, 400: 66.3, 450: 77.6, 500: 90.7, 550: 106, 600: 122 },
  HEA: { 100: 16.7, 120: 19.9, 140: 24.7, 160: 30.4, 180: 35.5, 200: 42.3, 220: 50.5, 240: 60.3, 260: 68.2, 280: 76.4, 300: 88.3, 320: 97.6, 340: 105, 360: 112, 400: 125, 450: 140, 500: 155, 600: 178 },
  HEB: { 100: 20.4, 120: 26.7, 140: 33.7, 160: 42.6, 180: 51.2, 200: 61.3, 220: 71.5, 240: 83.2, 260: 93.0, 280: 103, 300: 117, 320: 127, 340: 134, 360: 142, 400: 155, 450: 171, 500: 187, 600: 212 },
  HEM: { 100: 41.8, 120: 52.1, 140: 63.2, 160: 76.2, 180: 88.9, 200: 103, 220: 117, 240: 157, 260: 172, 280: 189, 300: 238, 320: 245, 340: 248, 360: 250, 400: 256, 450: 263, 500: 270, 600: 285 },
  IPN: { 80: 5.94, 100: 8.34, 120: 11.1, 140: 14.3, 160: 17.9, 180: 21.9, 200: 26.2, 220: 31.1, 240: 36.2, 260: 41.9, 280: 47.9, 300: 54.2, 320: 61.0, 340: 68.0, 360: 76.1, 400: 92.4, 450: 115, 500: 141 },
  UPN: { 50: 5.59, 65: 7.09, 80: 8.64, 100: 10.6, 120: 13.4, 140: 16.0, 160: 18.8, 180: 22.0, 200: 25.3, 220: 29.4, 240: 33.2, 260: 37.9, 280: 41.8, 300: 46.2, 320: 59.5, 350: 60.6, 380: 63.1, 400: 71.8 },
};
// Superficie de pintura aproximada (m²/m) de laminados: ~ perímetro desarrollado
const ALAS = { IPE: 0.5, HEA: 1.0, HEB: 1.0, HEM: 1.0, IPN: 0.45, UPN: 0.4 };   // ancho de ala ≈ factor × canto (aprox.)

const n = (t) => Number(String(t).replace(',', '.'));
function densidad(nombre) {
  if (/alumin/i.test(nombre)) return { d: DENS.aluminio, mat: 'aluminio' };
  if (/inox\s*316/i.test(nombre)) return { d: DENS.inox316, mat: 'inox 316' };
  if (/inox/i.test(nombre)) return { d: DENS.inox, mat: 'inox' };
  return { d: DENS.acero, mat: 'acero' };
}
const NUM = '(\\d+(?:[.,]\\d+)?)';
const X = '\\s*[×x]\\s*';

// Del nombre y el detalle del catálogo → { base, kg_ml?, pint_m2_ml?, ml_barra?, m2_ud?, kg_m2?, forma, calculo }
function geometria(nombre, unidadCat, detalle) {
  const nm = String(nombre || ''); const { d, mat } = densidad(nm);
  const barra = (String(detalle || '').match(new RegExp(`barra\\s+${NUM}\\s*m`, 'i')) || [])[1];
  const ml_barra = barra ? n(barra) : null;
  const perfil = (forma, area_mm2, perim_mm, txt) => ({
    base: 'ml', forma, kg_ml: +(area_mm2 * d / 1000).toFixed(3), pint_m2_ml: perim_mm ? +(perim_mm / 1000).toFixed(3) : null, ml_barra,
    calculo: `${txt} · ${mat} ${d} kg/dm³`,
  });
  // accesorios que nombran un perfil pero se compran por unidad o por m² (tapón para tubo Ø42, rejilla de pletina 30×2…)
  if (/\b(tap[oó]n|embellecedor|pinza|rejilla electrosoldada|tramex)\b/i.test(nm)) return { base: unidad(unidadCat) || 'ud' };
  let m;
  if ((m = nm.match(new RegExp(`tubo\\s+(?:cuadrado|rectangular)(?:\\s+aluminio)?\\s+${NUM}${X}${NUM}${X}${NUM}`, 'i')))) {
    const [a, b, e] = [n(m[1]), n(m[2]), n(m[3])];
    // EN 10219: esquinas redondeadas (radio exterior 2e hasta 6 mm, 2,5e hasta 10, 3e más)
    const ro = e <= 6 ? 2 * e : e <= 10 ? 2.5 * e : 3 * e; const ri = ro - e;
    const area = 2 * e * (a + b - 2 * e) - (4 - Math.PI) * (ro * ro - ri * ri);
    return perfil('tubo', area, 2 * (a + b) - (8 - 2 * Math.PI) * ro, `tubo ${a}×${b}×${e}: área ${area.toFixed(0)} mm² (EN 10219)`);
  }
  if ((m = nm.match(new RegExp(`tubo\\s+redondo(?:\\s+aluminio)?\\s+Ø\\s*${NUM}${X}${NUM}`, 'i')))) {
    const [D, e] = [n(m[1]), n(m[2])];
    return perfil('tubo redondo', Math.PI * (D - e) * e, Math.PI * D, `tubo Ø${D}×${e}: área ${(Math.PI * (D - e) * e).toFixed(0)} mm²`);
  }
  if ((m = nm.match(new RegExp(`pletina(?:\\s+aluminio)?\\s+${NUM}${X}${NUM}`, 'i')))) {
    const [a, e] = [n(m[1]), n(m[2])];
    return perfil('pletina', a * e, 2 * (a + e), `pletina ${a}×${e}`);
  }
  if ((m = nm.match(new RegExp(`(?:redondo|macizo|varilla(?! roscada))[^Ø\\d]*Ø\\s*${NUM}`, 'i')))) {
    const D = n(m[1]);
    return perfil('redondo macizo', Math.PI * D * D / 4, Math.PI * D, `redondo Ø${D}`);
  }
  if ((m = nm.match(new RegExp(`cuadrado\\s+macizo[^\\d]*${NUM}`, 'i')))) {
    const a = n(m[1]);
    return perfil('cuadrado macizo', a * a, 4 * a, `cuadrado ${a}`);
  }
  if ((m = nm.match(new RegExp(`angular(?:\\s+L)?(?:\\s+desigual)?(?:\\s+aluminio)?\\s+${NUM}${X}${NUM}${X}${NUM}`, 'i')))) {
    const [a, b, e] = [n(m[1]), n(m[2]), n(m[3])];
    return perfil('angular', e * (a + b - e), 2 * (a + b), `angular ${a}×${b}×${e}`);
  }
  if ((m = nm.match(new RegExp(`perfil\\s+T\\s+${NUM}${X}${NUM}${X}${NUM}`, 'i')))) {
    const [a, b, e] = [n(m[1]), n(m[2]), n(m[3])];
    return perfil('T', e * (a + b - e), 2 * (a + b), `T ${a}×${b}×${e}`);
  }
  if ((m = nm.match(new RegExp(`perfil\\s+U\\s+plegado\\s+${NUM}${X}${NUM}${X}${NUM}`, 'i')))) {
    const [a, b, e] = [n(m[1]), n(m[2]), n(m[3])];
    return perfil('U plegado', e * (a + 2 * b - 2 * e), 2 * (a + 2 * b), `U ${a}×${b}×${e}`);
  }
  if ((m = nm.match(/\b(IPE|HEA|HEB|HEM|IPN|UPN)\s*(\d{2,3})\b/i))) {
    const t = m[1].toUpperCase(); const h = Number(m[2]); const kg = LAM[t]?.[h];
    if (kg) return { base: 'ml', forma: t, kg_ml: kg, pint_m2_ml: +((2 * h + 4 * h * ALAS[t]) / 1000).toFixed(3), ml_barra, calculo: `${t} ${h}: ${kg} kg/m (tabla) · pintura aprox.` };
  }
  // correas de chapa conformada C / Z (h×e): desarrollo ≈ alma + 2 alas (0,25h + 20) + 2 labios
  if ((m = nm.match(new RegExp(`correa\\s+[CZ]\\s+${NUM}${X}${NUM}`, 'i')))) {
    const [h, e] = [n(m[1]), n(m[2])]; const des = h + 2 * (0.25 * h + 20) + 2 * (h <= 150 ? 15 : 20);
    return perfil('correa', des * e, 2 * des, `correa ${h}×${e}: desarrollo ≈ ${des.toFixed(0)} mm`);
  }
  if ((m = nm.match(new RegExp(`chapa.*?\\s(?:${NUM}\\/)?${NUM}\\s*mm\\s+${NUM}${X}${NUM}`, 'i')))) {
    const [e, w, l] = [n(m[1] || m[2]), n(m[3]), n(m[4])];
    const m2 = +(w * l / 1e6).toFixed(3); const kgm2 = +(e * d).toFixed(2);
    return { base: 'm2', forma: 'chapa', m2_ud: m2, kg_m2: kgm2, calculo: `chapa ${e} mm ${w}×${l}: ${m2} m²/chapa · ${kgm2} kg/m² · ${mat} ${d} kg/dm³` };
  }
  if (unidad(unidadCat) === 'barra') return { base: 'ml', forma: 'barra', ml_barra, calculo: ml_barra ? `barra de ${ml_barra} m` : 'barra (largo desconocido)' };
  return { base: unidad(unidadCat) || 'ud', forma: null, calculo: null };
}

// Factores a la unidad base: { unidad: cuántas unidades base vale 1 de esa unidad }
function factores(g) {
  const f = { [g.base]: 1 };
  if (g.base === 'ml') {
    f.m = 1; f.mm = 0.001; f.cm = 0.01;
    if (g.ml_barra) f.barra = g.ml_barra;
    if (g.kg_ml) { f.kg = 1 / g.kg_ml; f.t = 1000 / g.kg_ml; }
  }
  if (g.base === 'm2') {
    if (g.m2_ud) { f.chapa = g.m2_ud; f.ud = g.m2_ud; }
    if (g.kg_m2) { f.kg = 1 / g.kg_m2; f.t = 1000 / g.kg_m2; }
  }
  if (g.base === 'kg') f.t = 1000;
  return f;
}

// Convertir un PRECIO de una unidad a otra del mismo material (€/kg → €/ml…). null si no se puede.
function convertirPrecio(precio, de, a, fact) {
  const u1 = unidad(de); const u2 = unidad(a);
  if (precio == null || !u1 || !u2) return null;
  if (u1 === u2) return Number(precio);
  if (!fact[u1] || !fact[u2]) return null;
  // precio por 1 u1 → por 1 base = precio / fact[u1] → por 1 u2 = × fact[u2]
  return +(Number(precio) / fact[u1] * fact[u2]).toFixed(6);
}
function convertirCantidad(cant, de, a, fact) {
  const u1 = unidad(de); const u2 = unidad(a);
  if (cant == null || !u1 || !u2) return null;
  if (u1 === u2) return Number(cant);
  if (!fact[u1] || !fact[u2]) return null;
  return +(Number(cant) * fact[u1] / fact[u2]).toFixed(6);
}

/* ---------- en la base de datos ---------- */
// equiv guardado en catalogo: { kg_ml, pint_m2_ml, ml_barra, m2_ud, kg_m2, forma, calculo, factores }
function armar(cat) {
  const e = cat.equiv || {};
  const g = { base: cat.unidad_base || unidad(cat.unidad) || 'ud', kg_ml: e.kg_ml, pint_m2_ml: e.pint_m2_ml, ml_barra: e.ml_barra, m2_ud: e.m2_ud, kg_m2: e.kg_m2 };
  return { base: g.base, unidad: unidad(cat.unidad), factores: factores(g), ...e, origen: cat.equiv_origen || null };
}
// Al arrancar: calcula las de todo el catálogo (sin tocar las corregidas a mano)
async function calcularCatalogo() {
  const { query } = require('./db');
  const { rows } = await query(`SELECT id, nombre, unidad, detalle, unidad_base, equiv FROM catalogo WHERE tipo = 'material' AND equiv_origen IS DISTINCT FROM 'manual'`);
  let n = 0;
  for (const r of rows) {
    const g = geometria(r.nombre, r.unidad, r.detalle);
    const equiv = g.forma || g.ml_barra ? { kg_ml: g.kg_ml ?? null, pint_m2_ml: g.pint_m2_ml ?? null, ml_barra: g.ml_barra ?? null, m2_ud: g.m2_ud ?? null, kg_m2: g.kg_m2 ?? null, forma: g.forma, calculo: g.calculo } : null;
    const canon = (o) => (o ? JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]])) : 'null');   // jsonb reordena las claves
    if (g.base === r.unidad_base && canon(equiv) === canon(r.equiv)) continue;
    await query(`UPDATE catalogo SET unidad_base = $2, equiv = $3, equiv_origen = $4 WHERE id = $1`, [r.id, g.base, equiv ? JSON.stringify(equiv) : null, equiv ? 'calculado' : null]);
    n++;
  }
  if (n) console.log(`Unidades: equivalencias calculadas o actualizadas en ${n} materiales`);
}
const cache = new Map();
async function deCatalogo(catalogoId) {
  if (!catalogoId) return null;
  if (cache.has(catalogoId)) return cache.get(catalogoId);
  const { query } = require('./db');
  const { rows: [c] } = await query('SELECT id, nombre, unidad, detalle, unidad_base, equiv, equiv_origen FROM catalogo WHERE id = $1', [catalogoId]);
  if (!c) return null;
  if (!c.unidad_base) { const g = geometria(c.nombre, c.unidad, c.detalle); c.unidad_base = g.base; c.equiv = g.forma || g.ml_barra ? g : null; }
  const r = { ...armar(c), nombre: c.nombre };
  cache.set(catalogoId, r); setTimeout(() => cache.delete(catalogoId), 60000).unref?.();
  return r;
}
// Precio de un material de una unidad a otra (con sus equivalencias); null si no se sabe
async function precioEn(catalogoId, precio, de, a) {
  if (unidad(de) === unidad(a)) return precio == null ? null : Number(precio);
  const m = await deCatalogo(catalogoId);
  return m ? convertirPrecio(precio, de, a, m.factores) : null;
}
// Texto corto de la conversión: «1,15 €/kg → 13,84 €/barra (2,31 kg/ml · barra 6 m)»
function explicar(m) {
  if (!m) return '';
  return [m.kg_ml ? `${String(m.kg_ml).replace('.', ',')} kg/ml` : null, m.ml_barra ? `barra ${String(m.ml_barra).replace('.', ',')} m` : null,
    m.m2_ud ? `${String(m.m2_ud).replace('.', ',')} m²/chapa` : null, m.kg_m2 ? `${String(m.kg_m2).replace('.', ',')} kg/m²` : null].filter(Boolean).join(' · ');
}
function olvidar(id) { cache.delete(Number(id)); }

// Unidades en las que se puede cotizar una línea (además de la suya) y por cuánto multiplicar ese precio para pasarlo a la de la línea.
//   → [{ u: 'ml', a_linea: 1 }, { u: 'kg', a_linea: 2.306 }, { u: 'barra', a_linea: 0.1667 }, …]
const ORDEN_U = ['ml', 'm2', 'ud', 'kg', 't', 'barra', 'chapa'];
async function opcionesLinea(catalogoId, unidadLinea) {
  const un = unidad(unidadLinea);
  const out = [{ u: un || 'ud', a_linea: 1 }];
  const m = await deCatalogo(catalogoId);
  if (!m || !un || !m.factores[un]) return { opciones: out, explicacion: null };
  for (const u of Object.keys(m.factores).sort((a, b) => (ORDEN_U.indexOf(a) + 99) % 99 - (ORDEN_U.indexOf(b) + 99) % 99)) {
    if (u === un || ['m', 'mm', 'cm'].includes(u)) continue;
    out.push({ u, a_linea: +(m.factores[un] / m.factores[u]).toFixed(6) });
  }
  return { opciones: out, explicacion: explicar(m) || null };
}
// Lo cotizado → precio de la línea. { precio, precio_cotizado, unidad_cotizada } (si no hay conversión, lanza)
async function aLinea(catalogoId, unidadLinea, precio, unidadCot) {
  const un = unidad(unidadLinea); const uc = unidad(unidadCot);
  if (precio == null || !uc || uc === un) return { precio, precio_cotizado: null, unidad_cotizada: null };
  const p = await precioEn(catalogoId, precio, uc, un);
  if (p == null) throw Object.assign(new Error(`No sé pasar de ${uc} a ${un} en este material: falta su equivalencia`), { status: 400 });
  return { precio: +p.toFixed(4), precio_cotizado: Number(precio), unidad_cotizada: uc };
}

// Equivalencias de una línea: las del material del catálogo o, si no está, las que se deducen de su nombre («Perfil UPN 140»)
async function equivalencias(catalogoId, nombre, unidadLinea) {
  const m = catalogoId ? await deCatalogo(catalogoId) : null;
  if (m) return m;
  const g = geometria(String(nombre || ''), unidadLinea || 'ml', '');
  if (!g || !(g.kg_ml || g.kg_m2 || g.ml_barra || g.m2_ud)) return null;
  return { ...armar({ unidad: unidadLinea, unidad_base: g.base, equiv: g }), nombre, desde_nombre: true };
}
// Unidades en las que se puede escribir el precio de una línea (la suya primero)
function unidadesPrecio(m, unidadLinea) {
  const un = unidad(unidadLinea) || 'ud';
  if (!m || !m.factores[un]) return [un];
  return [un, ...Object.keys(m.factores).filter((u) => u !== un && !['m', 'mm', 'cm'].includes(u))
    .sort((a, b) => (ORDEN_U.indexOf(a) + 99) % 99 - (ORDEN_U.indexOf(b) + 99) % 99)];
}

module.exports = { unidad, geometria, factores, convertirPrecio, convertirCantidad, DENS, calcularCatalogo, deCatalogo, precioEn, explicar, olvidar, armar, opcionesLinea, aLinea, equivalencias, unidadesPrecio };
