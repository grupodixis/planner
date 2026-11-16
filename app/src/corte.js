// Optimización de corte lineal (1D): reparte las piezas en barras comerciales
// minimizando barras. Mejor ajuste decreciente (best-fit decreasing), que para
// listas de taller da resultados a 1–2 % del óptimo y es instantáneo.
//
// Cada pieza gasta su longitud + el ancho de la sierra (kerf). El sobrante de cada
// barra que llega al «retal mínimo» se considera aprovechable.

const MAX_PIEZAS = 20000;

// piezas: [{ marca, longitud_mm, cantidad, ref }] · op: { barra_mm, kerf_mm, retal_min_mm }
function optimizar(piezas, op) {
  const barra = Number(op.barra_mm) || 6000;
  const kerf = Math.max(0, Number(op.kerf_mm) || 0);
  const retalMin = Math.max(0, Number(op.retal_min_mm) || 0);
  const lista = [];
  const excedidas = [];
  for (const p of piezas) {
    const L = Number(p.longitud_mm);
    const n = Math.round(Number(p.cantidad) || 0);
    if (!(L > 0) || n <= 0) continue;
    if (L > barra) { excedidas.push({ marca: p.marca || null, longitud_mm: L, cantidad: n }); continue; }
    for (let i = 0; i < n && lista.length < MAX_PIEZAS; i++) lista.push({ marca: p.marca || null, l: L });
  }
  lista.sort((a, b) => b.l - a.l);

  const barras = [];   // { libre, cortes: [] }
  for (const p of lista) {
    // una pieza que ocupa exactamente lo que queda no necesita el último corte
    const cabe = (b) => b.libre >= p.l + kerf || Math.abs(b.libre - p.l) < 0.01;
    let mejor = null;
    for (const b of barras) if (cabe(b) && (!mejor || b.libre < mejor.libre)) mejor = b;
    if (!mejor) { mejor = { libre: barra, cortes: [] }; barras.push(mejor); }
    mejor.cortes.push(p);
    mejor.libre = Math.max(0, mejor.libre - p.l - kerf);
  }

  // barras iguales se juntan («×3») para que el plano de corte se lea rápido
  const patrones = new Map();
  for (const b of barras) {
    const k = b.cortes.map((c) => `${c.marca || ''}:${c.l}`).join(',');
    const x = patrones.get(k);
    if (x) x.veces++;
    else {
      const cortes = [];   // piezas iguales seguidas se cuentan: «B1 1180 ×5»
      for (const c of b.cortes) {
        const u = cortes[cortes.length - 1];
        if (u && u.marca === c.marca && u.longitud_mm === c.l) u.n++;
        else cortes.push({ marca: c.marca, longitud_mm: c.l, n: 1 });
      }
      patrones.set(k, { veces: 1, cortes, sobrante_mm: Math.round(b.libre) });
    }
  }
  const totalPiezas = lista.reduce((s, p) => s + p.l, 0);
  const totalBarras = barras.length * barra;
  const retales = barras.filter((b) => b.libre >= retalMin && retalMin > 0).map((b) => Math.round(b.libre)).sort((a, b) => b - a);
  return {
    barra_mm: barra,
    kerf_mm: kerf,
    barras: barras.length,
    piezas: lista.length,
    metros_piezas: Math.round(totalPiezas) / 1000,
    aprovechamiento: totalBarras ? Math.round((totalPiezas / totalBarras) * 1000) / 10 : null,
    retales_mm: retales,
    patrones: [...patrones.values()].sort((a, b) => b.veces - a.veces),
    excedidas,
    truncado: lista.length >= MAX_PIEZAS,
  };
}

module.exports = { optimizar };
