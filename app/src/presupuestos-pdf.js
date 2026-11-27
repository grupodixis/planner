/* PDF de los presupuestos con el formato de HAM (el de los presupuestos hechos con Antigravity):
   · cliente(p, aj, {detallado}): A4 vertical. Cabecera de la empresa, título, «Alcance del suministro», ficha (cliente,
     referencia, fecha, atención/obra, validez, calidad), partidas con su descripción técnica, totales con IVA,
     condiciones comerciales y exclusiones a dos columnas, pie. El detallado añade la descomposición a precio de venta.
   · interno(p, aj): A4 apaisado, «Documento interno de costes y producción»: costes directos línea a línea con su
     origen, rentabilidad y márgenes, reparto por tipo de coste y lo pendiente. No se envía al cliente. */
const PDFDocument = require('pdfkit');

const C = { osc: '#0f172a', ambar: '#b45309', gris: '#475569', gris2: '#64748b', borde: '#cbd5e1', lbl: '#f1f5f9', verdeBg: '#f0fdf4', verde: '#16a34a',
  verdeTxt: '#166534', total: '#fef3c7', conds: '#f8fafc', linea: '#e2e8f0', texto: '#1e293b', azulBg: '#eff6ff' };
const r2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
// 1.234,56 (con punto de miles también en 4 cifras, como en los presupuestos de HAM)
const num = (n, d = 2) => { const [e, f] = Math.abs(Number(n || 0)).toFixed(d).split('.'); return `${Number(n) < 0 ? '-' : ''}${e.replace(/\B(?=(\d{3})+(?!\d))/g, '.')}${f ? `,${f}` : ''}`; };
const eur = (n) => `${num(n, 2)} €`;
const cant = (n) => Number(n || 0).toLocaleString('es-ES', { maximumFractionDigits: 3 });
const UD = { m2: 'm²', m3: 'm³', ml: 'ml', ud: 'ud', h: 'h', kg: 'kg', pa: 'p.a.' };
const ud = (u) => UD[u] || u || 'ud';
const latin = (t) => String(t ?? '').replace(/[→⇒]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF€–—•…]/g, '');
const lineas = (t) => String(t || '').split('\n').map((l) => l.replace(/^\s*[-•*·]\s*/, '').trim()).filter(Boolean);
const TIPO_TXT = { material: 'Materiales', mano_obra: 'Mano de obra', maquinaria: 'Maquinaria y medios', auxiliar: 'Medios auxiliares', subcontrata: 'Subcontratas' };
const ESTADO_TXT = { real: 'precio real', tarifa: 'tarifa', estimado: 'estimado', solicitado: 'pedido precio' };
const fechaLarga = (d = new Date()) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Madrid' });

function empresa(aj) {
  const e = aj.empresa || {};
  return {
    marca: e.nombre_comercial || e.nombre || 'Empresa', razon: e.razon_social || '', cif: e.cif || '',
    direccion: e.direccion || '', telefono: e.telefono || '', movil: e.movil || '', email: e.email_comercial || e.email || '', web: e.web || '',
  };
}

// Texto con **negritas** (lo escribe la IA): se pinta por trozos
function rico(doc, texto, x, y, w, { size = 8, color = C.texto, base = 'Helvetica', negrita = 'Helvetica-Bold', lineGap = 1 } = {}) {
  const t = latin(texto);
  const plano = t.replace(/\*\*/g, '');
  doc.font(base).fontSize(size);
  const h = doc.heightOfString(plano, { width: w, lineGap }) + 1;
  const trozos = t.split(/(\*\*[^*]+\*\*)/).filter(Boolean);
  doc.fillColor(color).text('', x, y, { width: w, lineGap, continued: true });
  trozos.forEach((tr, i) => {
    const b = /^\*\*.*\*\*$/.test(tr);
    doc.font(b ? negrita : base).text(b ? tr.slice(2, -2) : tr, { width: w, lineGap, continued: i < trozos.length - 1 });
  });
  doc.font(base);
  return h;
}
const alto = (doc, t, w, size, font = 'Helvetica', lineGap = 1) => { doc.font(font).fontSize(size); return doc.heightOfString(latin(String(t ?? '')).replace(/\*\*/g, ''), { width: w, lineGap }) + 1; };

/* ---------- cabecera y pie (comunes) ---------- */
function cabecera(doc, E, x0, W, { derecha = null, size = 13.5 } = {}) {
  let y = 26;
  const sub = [E.razon, E.cif && `CIF ${E.cif}`].filter(Boolean).join(' · ');
  if (sub) { doc.font('Helvetica-Bold').fontSize(7).fillColor(C.ambar).text(latin(sub.toUpperCase()), x0, y, { width: W * 0.6, characterSpacing: 0.3 }); y += 10; }
  doc.font('Helvetica-Bold').fontSize(size).fillColor(C.osc).text(latin(E.marca.toUpperCase()), x0, y, { width: derecha ? W * 0.72 : W * 0.6 });
  const yMarca = y + alto(doc, E.marca.toUpperCase(), derecha ? W * 0.72 : W * 0.6, size, 'Helvetica-Bold');
  if (derecha) derecha(26);
  else {
    const info = [E.direccion, [E.telefono && `Tel: ${E.telefono}`, E.movil && `WhatsApp: ${E.movil}`].filter(Boolean).join(' · '), [E.email, E.web].filter(Boolean).join(' · ')].filter(Boolean).join('\n');
    doc.font('Helvetica').fontSize(7).fillColor(C.gris).text(latin(info), x0 + W * 0.55, 27, { width: W * 0.45, align: 'right', lineGap: 1 });
  }
  y = Math.max(yMarca, 62) + 4;
  doc.moveTo(x0, y).lineTo(x0 + W, y).lineWidth(2.5).strokeColor(C.osc).stroke().lineWidth(1);
  return y + 10;
}
function pies(doc, E, x0, W, codigo, interno) {
  const r = doc.bufferedPageRange();
  const txt = latin([E.marca, E.razon, E.cif && `CIF: ${E.cif}`, E.direccion].filter(Boolean).join(' · '));
  for (let i = r.start; i < r.start + r.count; i++) {
    doc.switchToPage(i);
    const yb = doc.page.height - 22;
    doc.moveTo(x0, yb - 4).lineTo(x0 + W, yb - 4).strokeColor(C.linea).stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor(C.gris2)
      .text(`${interno ? 'USO INTERNO · ' : ''}${txt}`, x0, yb, { width: W - 120, align: 'left', lineBreak: false, height: 9 })
      .text(`${codigo} · pág. ${i - r.start + 1}/${r.count}`, x0 + W - 110, yb, { width: 110, align: 'right', lineBreak: false, height: 9 });
  }
}

/* ---------- presupuesto para el cliente ---------- */
async function cliente(p, aj, { detallado = false } = {}) {
  const E = empresa(aj);
  const doc = new PDFDocument({ size: 'A4', margins: { top: 28, bottom: 34, left: 34, right: 34 }, bufferPages: true, info: { Title: `Presupuesto ${p.codigo}`, Author: E.marca } });
  const x0 = 34; const W = doc.page.width - 68; const fin = () => doc.page.height - 40;
  let y = cabecera(doc, E, x0, W);
  const nueva = () => { doc.addPage(); y = cabecera(doc, E, x0, W); };
  const sitio = (h) => { if (y + h > fin()) { nueva(); return true; } return false; };

  // título
  const tit = `PRESUPUESTO ${p.codigo} — ${String(p.titulo || '').toUpperCase()}`;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.osc).text(latin(tit), x0, y, { width: W }); y += alto(doc, tit, W, 11, 'Helvetica-Bold') + 4;

  // alcance
  const alc = p.alcance || null;
  if (alc) {
    const txt = `**ALCANCE DEL SUMINISTRO:** ${alc}`;
    const h = alto(doc, txt, W - 18, 8) + 10;
    doc.rect(x0, y, W, h).fill(C.verdeBg); doc.rect(x0, y, 3, h).fill(C.verde);
    rico(doc, txt, x0 + 10, y + 5, W - 18, { size: 8, color: C.verdeTxt }); y += h + 8;
  }

  // ficha
  const atencion = [p.atencion, [p.obra, p.obra_direccion].filter(Boolean).join(', ')].filter(Boolean).join(' · ');
  const filas = [
    ['Cliente', `**${p.cliente || '—'}**${p.cliente_cif ? ` (CIF: ${p.cliente_cif})` : ''}`, 'Presupuesto Nº', `**${p.codigo}**`],
    ['Domicilio', p.cliente_direccion || '—', 'Fecha', fechaLarga(p.enviado_en ? new Date(p.enviado_en) : new Date())],
    ['Atención / Obra', atencion || '—', 'Validez', `${p.validez_dias || 30} días naturales`],
  ];
  if (p.calidad) filas.push(['Calidad / Normativa', p.calidad]);
  const wl = W * 0.17; const wv = W * 0.36; const wl2 = W * 0.15; const wv2 = W - wl - wv - wl2;
  for (const f of filas) {
    const ancho = f.length === 2 ? W - wl : wv;
    const h = Math.max(alto(doc, f[1], ancho - 8, 8), f[3] ? alto(doc, f[3], wv2 - 8, 8) : 0, alto(doc, f[0], wl - 8, 8, 'Helvetica-Bold')) + 8;
    sitio(h);
    const celda = (x, w, t, lbl) => {
      if (lbl) doc.rect(x, y, w, h).fill(C.lbl);
      doc.rect(x, y, w, h).strokeColor(C.borde).stroke();
      if (lbl) doc.font('Helvetica-Bold').fontSize(8).fillColor('#334155').text(latin(t), x + 4, y + 4, { width: w - 8 });
      else rico(doc, t, x + 4, y + 4, w - 8, { size: 8 });
    };
    celda(x0, wl, f[0], true); celda(x0 + wl, ancho, f[1]);
    if (f.length === 4) { celda(x0 + wl + wv, wl2, f[2], true); celda(x0 + wl + wv + wl2, wv2, f[3]); }
    y += h;
  }
  y += 10;

  // partidas
  const cols = [['Nº', 0.07, 'center'], ['Concepto y Descripción Técnica', 0.53, 'left'], ['Ud.', 0.06, 'center'], ['Cant.', 0.09, 'right'], ['Precio Ud.', 0.12, 'right'], ['Subtotal', 0.13, 'right']];
  const xs = []; let acc = x0; for (const c of cols) { xs.push(acc); acc += c[1] * W; }
  const cabItems = () => {
    doc.rect(x0, y, W, 17).fill(C.osc);
    cols.forEach(([t, w, a], i) => doc.font('Helvetica-Bold').fontSize(8).fillColor('#fff').text(t, xs[i] + 4, y + 5, { width: w * W - 8, align: a }));
    y += 17;
  };
  cabItems();
  const sitioItems = (h) => { if (y + h > fin()) { nueva(); cabItems(); } };
  const caps = p.capitulos.filter((c) => c.partidas.length);
  const variosCaps = caps.length > 1;
  caps.forEach((c, ci) => {
    if (variosCaps) {
      sitioItems(34);
      doc.rect(x0, y, W, 16).fill(C.lbl);
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.osc).text(latin(`${c.codigo || ci + 1}. ${String(c.nombre || '').toUpperCase()}`), x0 + 4, y + 4, { width: W * 0.8 });
      doc.text(eur(c.venta), x0, y + 4, { width: W - 4, align: 'right' });
      y += 16;
    }
    c.partidas.forEach((pa, pi) => {
      const cod = pa.codigo || `${c.codigo || ci + 1}.${String(pi + 1).padStart(2, '0')}`;
      const wDesc = cols[1][1] * W - 8;
      const nom = pa.nombre || ''; const des = pa.descripcion && pa.descripcion !== pa.nombre ? pa.descripcion : '';
      let h = alto(doc, nom, wDesc, 8.5, 'Helvetica-Bold') + (des ? alto(doc, des, wDesc, 7.5) + 3 : 0) + 10;
      const desglose = detallado ? pa.lineas.filter((l) => l.precio != null) : [];
      if (desglose.length) h += 12 + desglose.length * 9.5;
      sitioItems(Math.min(h, fin() - 140));
      // números primero (en la primera línea de la partida), luego nombre y descripción (que puede seguir en otra página)
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.osc).text(latin(cod), xs[0] + 2, y + 5, { width: cols[0][1] * W - 4, align: 'center' });
      doc.font('Helvetica').fontSize(8.5).fillColor(C.texto).text(ud(pa.unidad), xs[2], y + 5, { width: cols[2][1] * W, align: 'center' });
      doc.font('Helvetica-Bold').text(cant(pa.medicion), xs[3], y + 5, { width: cols[3][1] * W - 4, align: 'right' });
      doc.font('Helvetica').text(eur(pa.venta_ud), xs[4], y + 5, { width: cols[4][1] * W - 4, align: 'right' });
      doc.font('Helvetica-Bold').text(eur(pa.venta), xs[5], y + 5, { width: cols[5][1] * W - 4, align: 'right' });
      let yy = y + 5;
      doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.osc).text(latin(nom), xs[1] + 4, yy, { width: wDesc }); yy += alto(doc, nom, wDesc, 8.5, 'Helvetica-Bold') + 2;
      if (des) {
        for (const parrafo of String(des).split('\n')) {
          const hp = alto(doc, parrafo || ' ', wDesc, 7.5);
          if (yy + hp > fin()) { nueva(); cabItems(); yy = y + 4; }
          rico(doc, parrafo || ' ', xs[1] + 4, yy, wDesc, { size: 7.5, color: C.gris }); yy += hp;
        }
      }
      y = Math.max(yy, y + 17) + 3;
      if (desglose.length) {
        // descomposición a precio de VENTA por unidad de partida (sin costes ni márgenes)
        doc.font('Helvetica-Oblique').fontSize(7).fillColor(C.gris2).text(`Descomposición por ${ud(pa.unidad)}:`, xs[1] + 10, y, { width: wDesc }); y += 10;
        for (const l of desglose) {
          if (y + 10 > fin()) { nueva(); cabItems(); }
          const pv = r2(l.precio * p.k);
          doc.font('Helvetica').fontSize(7).fillColor(C.gris)
            .text(latin(l.concepto), xs[1] + 16, y, { width: wDesc - 120, lineBreak: false, height: 9 })
            .text(`${cant(l.cantidad_ud)} ${ud(l.unidad)} × ${eur(pv)}`, xs[1] + wDesc - 104, y, { width: 104, align: 'right', lineBreak: false })
            .text(eur(r2(l.cantidad_ud * pv)), xs[4], y, { width: cols[4][1] * W - 4, align: 'right', lineBreak: false });
          y += 9.5;
        }
        y += 3;
      }
      doc.moveTo(x0, y).lineTo(x0 + W, y).strokeColor(C.borde).stroke(); y += 1;
    });
  });
  y += 10;

  // totales
  const iva = r2(p.venta * 0.21);
  const tw = W * 0.44; const tx = x0 + W - tw;
  sitio(62);
  [['Base Imponible', eur(p.venta), 'b'], ['IVA Régimen General (21%)', eur(iva), ''], ['TOTAL PRESUPUESTO', eur(r2(p.venta + iva)), 'g']].forEach(([t, v, k]) => {
    const h = k === 'g' ? 19 : 16;
    if (k === 'g') doc.rect(tx, y, tw, h).fill(C.total);
    doc.rect(tx, y, tw, h).strokeColor(C.borde).stroke();
    doc.font(k ? 'Helvetica-Bold' : 'Helvetica').fontSize(k === 'g' ? 10 : 8.5).fillColor(C.osc)
      .text(t, tx + 6, y + (k === 'g' ? 5 : 4), { width: tw * 0.6 }).text(v, tx, y + (k === 'g' ? 5 : 4), { width: tw - 6, align: 'right' });
    y += h;
  });
  y += 12;

  // condiciones y exclusiones
  const conds = [
    `**Forma de pago:** ${p.forma_pago || aj.presupuestos?.forma_pago || '100% a la aceptación del presupuesto (o según acuerdo habitual).'}`,
    p.plazo ? `**Plazo de ejecución:** ${p.plazo}` : null,
    ...lineas(p.condiciones),
    `**Validez de la oferta:** ${p.validez_dias || 30} días naturales.`,
  ].filter(Boolean);
  const excl = lineas(p.exclusiones);
  const dos = excl.length > 0;
  const cw = dos ? (W - 30) / 2 : W - 20;
  const hLista = (ls) => ls.reduce((s, l) => s + alto(doc, l, cw - 10, 7.5) + 2, 0);
  const hc = Math.max(hLista(conds), dos ? hLista(excl) : 0) + 26;
  sitio(Math.min(hc, fin() - 100));
  doc.roundedRect(x0, y, W, hc, 3).fillAndStroke(C.conds, C.borde);
  const lista = (titulo, ls, x) => {
    let yy = y + 8;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.osc).text(titulo.toUpperCase(), x, yy, { width: cw, characterSpacing: 0.3 }); yy += 13;
    for (const l of ls) { doc.font('Helvetica').fontSize(7.5).fillColor(C.texto).text('•', x, yy); yy += rico(doc, l, x + 9, yy, cw - 10, { size: 7.5 }) + 2; }
  };
  lista('Condiciones comerciales y logística', conds, x0 + 10);
  if (dos) lista('Exclusiones y aclaraciones técnicas', excl, x0 + 20 + cw);
  y += hc + 6;

  pies(doc, E, x0, W, p.codigo, false);
  doc.end();
  return doc;
}

/* ---------- documento interno de costes ---------- */
async function interno(p, aj) {
  const E = empresa(aj);
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margins: { top: 28, bottom: 34, left: 34, right: 34 }, bufferPages: true, info: { Title: `Costes ${p.codigo} (interno)`, Author: E.marca } });
  const x0 = 34; const W = doc.page.width - 68; const fin = () => doc.page.height - 40;
  const chips = (yy) => {
    const t1 = 'USO INTERNO EXCLUSIVO'; const t2 = p.codigo;
    doc.font('Helvetica-Bold').fontSize(7.5);
    const w2 = doc.widthOfString(t2) + 14; const w1 = doc.widthOfString(t1) + 14;
    doc.roundedRect(x0 + W - w2, yy, w2, 15, 2).fill(C.osc); doc.fillColor('#fff').text(t2, x0 + W - w2, yy + 4, { width: w2, align: 'center' });
    doc.roundedRect(x0 + W - w2 - w1 - 6, yy, w1, 15, 2).fill(C.osc); doc.fillColor('#fff').text(t1, x0 + W - w2 - w1 - 6, yy + 4, { width: w1, align: 'center' });
  };
  const E2 = { ...E, marca: `${E.marca} · Documento interno de costes y producción` };
  let y = cabecera(doc, E2, x0, W, { derecha: chips, size: 11.5 });
  const nueva = () => { doc.addPage(); y = cabecera(doc, E2, x0, W, { derecha: chips, size: 11.5 }); };

  const tit = `ESTUDIO ECONÓMICO Y TÉCNICO: ${String(p.titulo || '').toUpperCase()}`;
  doc.font('Helvetica-Bold').fontSize(11).fillColor(C.osc).text(latin(tit), x0, y, { width: W }); y += alto(doc, tit, W, 11, 'Helvetica-Bold') + 4;
  const ban = `**CLIENTE: ${p.cliente || '—'}** | ${p.alcance || p.ia_resumen || p.titulo || ''} Venta: **${eur(p.venta)} + IVA**.`;
  const hb = alto(doc, ban, W - 18, 8) + 10;
  doc.rect(x0, y, W, hb).fill(C.verdeBg); doc.rect(x0, y, 3, hb).fill(C.verde);
  rico(doc, ban, x0 + 10, y + 5, W - 18, { size: 8, color: C.verdeTxt }); y += hb + 10;

  // 1. costes directos
  const sec = (t) => { if (y + 40 > fin()) nueva(); doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.osc).text(t, x0, y); y += 14; };
  sec('1. DESGLOSE DETALLADO DE COSTES DIRECTOS');
  const cols = [['Tipo', 0.115, 'left'], ['Concepto', 0.305, 'left'], ['Ud.', 0.05, 'center'], ['Cant. / ud', 0.08, 'right'], ['Cant. total', 0.08, 'right'],
    ['Coste unit.', 0.09, 'right'], ['Coste total', 0.1, 'right'], ['Origen del precio', 0.18, 'left']];
  const xs = []; let acc = x0; for (const c of cols) { xs.push(acc); acc += c[1] * W; }
  const cab = () => { doc.rect(x0, y, W, 16).fill(C.osc); cols.forEach(([t, w, a], i) => doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff').text(t, xs[i] + 3, y + 5, { width: w * W - 6, align: a })); y += 16; };
  const sitio = (h) => { if (y + h > fin()) { nueva(); cab(); } };
  cab();
  const porTipo = {}; let horas = 0;
  for (const c of p.capitulos) {
    for (const pa of c.partidas) {
      sitio(30);
      doc.rect(x0, y, W, 15).fill(C.lbl);
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.osc)
        .text(latin(`${pa.codigo || ''} ${pa.nombre}`), x0 + 4, y + 4, { width: W * 0.55, lineBreak: false, height: 10 })
        .text(`${cant(pa.medicion)} ${ud(pa.unidad)} · coste ${eur(pa.coste_ud)}/${ud(pa.unidad)} · venta ${eur(pa.venta_ud)}/${ud(pa.unidad)}`, x0 + W * 0.55, y + 4, { width: W * 0.45 - 4, align: 'right', lineBreak: false });
      y += 15;
      for (const l of pa.lineas) {
        const info = l.precio_info || {};
        const origen = [ESTADO_TXT[l.estado_precio] || l.estado_precio, info.proveedor, info.fecha && String(info.fecha).slice(0, 10), l.calculo ? `calc. ${l.calculo.replace('_perfiles', '')}` : null].filter(Boolean).join(' · ');
        const h = Math.max(alto(doc, l.concepto, cols[1][1] * W - 6, 7.5), alto(doc, origen, cols[7][1] * W - 6, 7)) + 5;
        sitio(h);
        const v = [TIPO_TXT[l.tipo] || l.tipo, l.concepto, ud(l.unidad), cant(l.cantidad_ud), cant(l.cantidad_total), l.precio == null ? '—' : eur(l.precio), l.precio == null ? 'sin precio' : eur(l.importe), origen];
        v.forEach((t, i) => doc.font(i === 6 ? 'Helvetica-Bold' : 'Helvetica').fontSize(i === 7 ? 7 : 7.5)
          .fillColor(i === 7 && ['estimado', 'solicitado'].includes(l.estado_precio) ? C.ambar : l.precio == null && i >= 5 ? '#b91c1c' : C.texto)
          .text(latin(t), xs[i] + 3, y + 2.5, { width: cols[i][1] * W - 6, align: cols[i][2] }));
        y += h;
        doc.moveTo(x0, y).lineTo(x0 + W, y).strokeColor(C.linea).stroke();
        porTipo[l.tipo] = r2((porTipo[l.tipo] || 0) + (l.importe || 0));
        if (['mano_obra'].includes(l.tipo) && ud(l.unidad) === 'h') horas += l.cantidad_total || 0;
      }
    }
  }
  sitio(18);
  doc.rect(x0, y, W, 17).fill(C.total);
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor(C.osc).text('COSTE DIRECTO TOTAL', x0 + 4, y + 5, { width: W * 0.5 })
    .text(eur(p.coste), xs[6] + 3, y + 5, { width: cols[6][1] * W - 6, align: 'right' });
  y += 26;

  // 2. rentabilidad + reparto (dos tablas lado a lado)
  if (y + 150 > fin()) nueva();
  doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.osc).text('2. RENTABILIDAD COMERCIAL Y MÁRGENES', x0, y).text('3. REPARTO DEL COSTE', x0 + W * 0.53, y);
  y += 14;
  const ben = r2(p.venta - p.coste); const iva = r2(p.venta * 0.21);
  const rent = [
    ['Coste directo', eur(p.coste), p.venta ? `${num((p.coste / p.venta) * 100, 1)} %` : '—'],
    ['Precio de venta (base)', eur(p.venta), '100 %', 'b'],
    ['Beneficio bruto', `+${eur(ben)}`, p.venta ? `${num((ben / p.venta) * 100, 1)} %` : '—', 'v'],
    ['Margen sobre coste', `+${num(p.coste ? (ben / p.coste) * 100 : 0, 1)} %`, `GG ${num(p.gg_pct, 0)} % + benef. ${num(p.bi_pct, 0)} %`],
    ['IVA repercutido (21 %)', eur(iva), ''],
    ['TOTAL PRESUPUESTO CLIENTE', eur(r2(p.venta + iva)), '', 'g'],
  ];
  const tabla = (filas, x, w, anchos, cabs) => {
    let yy = y;
    doc.rect(x, yy, w, 15).fill(C.osc);
    let xx = x; cabs.forEach((t, i) => { doc.font('Helvetica-Bold').fontSize(7.5).fillColor('#fff').text(t, xx + 4, yy + 4, { width: anchos[i] * w - 8, align: i ? 'right' : 'left' }); xx += anchos[i] * w; });
    yy += 15;
    for (const f of filas) {
      const k = f[3];
      if (k === 'g') doc.rect(x, yy, w, 15).fill(C.total);
      xx = x;
      f.slice(0, 3).forEach((t, i) => {
        doc.font(k ? 'Helvetica-Bold' : 'Helvetica').fontSize(8).fillColor(k === 'v' ? C.verde : C.texto).text(latin(t), xx + 4, yy + 4, { width: anchos[i] * w - 8, align: i ? 'right' : 'left' });
        xx += anchos[i] * w;
      });
      yy += 15; doc.moveTo(x, yy).lineTo(x + w, yy).strokeColor(C.linea).stroke();
    }
    return yy;
  };
  const y1 = tabla(rent, x0, W * 0.5, [0.48, 0.27, 0.25], ['Concepto', 'Importe', '% s/ venta']);
  const rep = Object.entries(porTipo).filter(([, v]) => v).map(([t, v]) => [TIPO_TXT[t] || t, eur(v), p.coste ? `${num((v / p.coste) * 100, 1)} %` : '—']);
  if (horas) rep.push(['Horas de mano de obra', `${num(horas, 1)} h`, '']);
  const y2 = tabla(rep, x0 + W * 0.53, W * 0.47, [0.5, 0.28, 0.22], ['Tipo de coste', 'Importe', '% s/ coste']);
  y = Math.max(y1, y2) + 12;

  // 4. pendiente y observaciones
  const pend = []; let nEst = 0; let nSol = 0;
  for (const c of p.capitulos) for (const pa of c.partidas) for (const l of pa.lineas) { if (l.estado_precio === 'estimado') nEst++; if (l.estado_precio === 'solicitado') nSol++; }
  if (nEst) pend.push(`${nEst} precio(s) estimado(s): conviene confirmarlos antes de enviar.`);
  if (nSol) pend.push(`${nSol} precio(s) pedidos a proveedores, sin respuesta todavía.`);
  for (const d of (p.ia_dudas || [])) pend.push(`${d.partida ? `${d.partida}: ` : ''}${d.texto || d}`);
  if (p.notas) pend.push(...lineas(p.notas));
  if (pend.length) {
    if (y + 40 > fin()) nueva();
    doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.osc).text('4. PENDIENTE Y OBSERVACIONES PARA EL TALLER', x0, y); y += 14;
    for (const t of pend.slice(0, 40)) {
      const h = alto(doc, t, W - 12, 7.5) + 2;
      if (y + h > fin()) nueva();
      doc.font('Helvetica').fontSize(7.5).fillColor(C.texto).text('•', x0, y); rico(doc, t, x0 + 9, y, W - 12, { size: 7.5 }); y += h;
    }
  }
  pies(doc, E, x0, W, p.codigo, true);
  doc.end();
  return doc;
}

module.exports = { cliente, interno };
