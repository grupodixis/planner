// Gantt de un proyecto para enviar o presentar (cliente, proveedores, pliegos): un dibujo SVG que sirve para el PDF
// (A4 o A3 horizontal, por páginas, con pdfkit + svg-to-pdfkit) y para la imagen PNG (la pantalla lo pasa a PNG).
//  · Solo lo planificado: sin riesgo, sin horas que faltan ni nada interno. Lo no planificado sale «por planificar».
//  · Opciones: nivel (ot | tareas), avance (%), quién (talleres externos / subcontratas), línea de hoy, título y nota.
//  · La escala se elige sola según lo que dure: días (≤ 10 semanas), semanas (≤ 10 meses) o meses.
const PDFDocument = require('pdfkit');
const SVGtoPDF = require('svg-to-pdfkit');
const { query } = require('./db');
const auth = require('./auth');
const gantt = require('./gantt');
const compras = require('./compras');

const { masDias, lunes, finde, hoyMadrid } = gantt;
const PAPEL = { a4: [842, 595], a3: [1191, 842] };
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const LETRA = ['D', 'L', 'M', 'X', 'J', 'V', 'S'];
const FUENTE = 'Helvetica, Arial, sans-serif';
const PALETA = ['#2f7ec4', '#d9822b', '#3f9b4f', '#8a63d2', '#c94f9c', '#c9a227', '#2a9d8f', '#d65a5a'];

const dmy = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const dm = (f) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;
const dias = (a, b) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 864e5);
const dow = (f) => new Date(`${f}T12:00:00Z`).getUTCDay();
const semanaISO = (f) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); const a = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - a) / 864e5 - 3 + ((a.getUTCDay() + 6) % 7)) / 7); };
// Helvetica del PDF solo tiene Latin-1 (más «…»): fuera emojis y símbolos raros
const limpio = (t) => String(t ?? '').replace(/[^\x20-\x7e\xa0-\xff…–—‘’“”€‹›•]/g, '').replace(/\s+/g, ' ').trim();
const esc = (t) => limpio(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colorOk = (c, i) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : PALETA[i % PALETA.length]);
// un poco más oscuro para bordes y texto (los colores de las OT son claros, pensados para la pantalla oscura)
const oscuro = (c, k = 0.72) => `#${[1, 3, 5].map((i) => Math.round(parseInt(c.slice(i, i + 2), 16) * k).toString(16).padStart(2, '0')).join('')}`;

// medir texto con las mismas métricas que el PDF
const medidor = new PDFDocument({ autoFirstPage: false });
const ancho = (t, size, negrita) => medidor.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(size).widthOfString(limpio(t));
function cortar(t, size, max, negrita) {
  t = limpio(t);
  if (ancho(t, size, negrita) <= max) return t;
  while (t.length > 1 && ancho(`${t}…`, size, negrita) > max) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
function lineas(t, size, max, maxLineas = 4) {
  const out = [];
  for (const parrafo of limpio(t).split(/\s*\n\s*/)) {
    let l = '';
    for (const p of parrafo.split(' ')) {
      const prueba = l ? `${l} ${p}` : p;
      if (ancho(prueba, size) <= max || !l) l = prueba; else { out.push(l); l = p; }
    }
    if (l) out.push(l);
  }
  return out.length > maxLineas ? [...out.slice(0, maxLineas - 1), cortar(out.slice(maxLineas - 1).join(' '), size, max)] : out;
}
const txt = (x, y, t, { size = 8, peso, color = '#111', anchor, italic } = {}) =>
  `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FUENTE}" font-size="${size}"${peso ? ' font-weight="bold"' : ''}${italic ? ' font-style="italic"' : ''} fill="${color}"${anchor ? ` text-anchor="${anchor}"` : ''}>${esc(t)}</text>`;
const rect = (x, y, w, h, attrs) => `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(0, w).toFixed(1)}" height="${h.toFixed(1)}" ${attrs}/>`;
const linea = (x1, y1, x2, y2, attrs) => `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" ${attrs}/>`;

const CLASE_TXT = { ext: 'Taller externo', trp: 'Transporte', sub: 'Subcontrata' };

// Datos del proyecto y sus OTs
async function datos(proyectoId) {
  const { rows } = await query(
    `SELECT p.id, p.codigo, p.nombre, p.cliente, p.estado, ob.nombre AS obra, ob.direccion, ob.localidad, c.nombre AS cliente_ficha
       FROM proyectos p LEFT JOIN obras ob ON ob.id = p.obra_id LEFT JOIN clientes c ON c.id = p.cliente_id WHERE p.id = $1`, [proyectoId]);
  if (!rows[0]) return null;
  const hoy = hoyMadrid();
  const { salida } = await gantt.datosOTs({ cerradas: true, proyectoId, desde: hoy, hasta: hoy, hoy });
  const aj = await compras.ajustes().catch(() => ({ empresa: { nombre: '' } }));
  return { p: rows[0], ots: salida, empresa: aj.empresa, hoy };
}

// Opciones de la petición
function opciones(q) {
  const si = (v, def) => (v == null ? def : v === '1' || v === 'true');
  return {
    nivel: q.nivel === 'ot' ? 'ot' : 'tareas',
    avance: si(q.avance, true),
    quien: si(q.quien, false),
    hoy: si(q.hoy, true),
    papel: PAPEL[q.papel] ? q.papel : 'a4',
    titulo: limpio(q.titulo).slice(0, 120) || 'Planificación del proyecto',
    nota: String(q.nota ?? '').slice(0, 600),
  };
}

// Dibuja el Gantt: una lista de páginas SVG. alto = null → una sola imagen tan alta como haga falta (PNG).
function dibujar(d, op, { W, H = null }) {
  const { p, ots, empresa, hoy } = d;
  const M = 28;

  /* ---- filas ---- */
  const filas = [];
  ots.forEach((o, i) => {
    const color = colorOk(o.color, i);
    const pct = Math.round(o.avance?.avance_pct ?? (o.riesgo === 'hecha' ? 100 : 0));
    filas.push({ tipo: 'ot', o, color, pct, alto: op.nivel === 'ot' ? 20 : 19 });
    if (op.nivel === 'tareas') for (const t of o.tareas) filas.push({ tipo: 't', t, o, color, alto: 14 });
  });

  /* ---- rango de fechas y escala ---- */
  const fechas = ots.flatMap((o) => [o.inicio, o.fin, o.entrega, ...o.tareas.flatMap((t) => t.segmentos.flat())]).filter(Boolean).sort();
  let ini = fechas[0] || hoy; let fin = fechas[fechas.length - 1] || masDias(hoy, 27);
  if (op.hoy && hoy < ini && dias(hoy, ini) <= 14) ini = hoy;
  if (op.hoy && hoy > fin && dias(fin, hoy) <= 14) fin = hoy;
  const largo = dias(ini, fin) + 1;
  const escala = largo <= 70 ? 'dias' : largo <= 300 ? 'semanas' : 'meses';
  if (escala === 'meses') { ini = `${ini.slice(0, 7)}-01`; const f = new Date(`${fin.slice(0, 7)}-01T12:00:00Z`); f.setUTCMonth(f.getUTCMonth() + 1); fin = masDias(f.toISOString().slice(0, 10), -1); }
  else { ini = lunes(ini); fin = masDias(lunes(fin), 6); }
  const N = dias(ini, fin) + 1;

  /* ---- medidas ---- */
  const LW = Math.min(310, Math.round(W * 0.3));
  const X0 = M + LW; const X1 = W - M; const DW = (X1 - X0) / N;
  const xDe = (f) => X0 + dias(ini, f) * DW;
  const CAB = 74; const THEAD = escala === 'dias' ? 40 : 30;
  const notaL = op.nota ? lineas(op.nota, 7.5, W - 2 * M - 120, 3) : [];
  const PIE = 22 + notaL.length * 10;

  /* ---- páginas ---- */
  const util = H ? H - M - CAB - THEAD - PIE : Infinity;
  const paginas = [[]]; let usado = 0;
  for (let i = 0; i < filas.length; i++) {
    const f = filas[i];
    let alto = f.alto;
    // no dejar una OT sola al pie: su bloque (OT + tareas) pasa entero si cabe en una página
    if (f.tipo === 'ot') { let j = i + 1; while (j < filas.length && filas[j].tipo === 't') alto += filas[j++].alto; if (alto > util) alto = f.alto + (filas[i + 1]?.alto || 0); }
    if (usado + alto > util && paginas[paginas.length - 1].length) { paginas.push([]); usado = 0; }
    paginas[paginas.length - 1].push(f); usado += f.alto;
  }
  const total = paginas.length;

  return paginas.map((pag, ip) => {
    const cuerpo = pag.reduce((s, f) => s + f.alto, 0) || 30;
    const alto = H || M + CAB + THEAD + cuerpo + PIE + 8;
    const yT = M + CAB; const yB = yT + THEAD; const yF = yB + cuerpo;
    const o = [];

    /* cabecera */
    o.push(txt(M, M + 12, empresa.nombre || '', { size: 14, peso: true }));
    o.push(txt(M, M + 24, [empresa.direccion, empresa.telefono, empresa.email].filter(Boolean).join(' · '), { size: 7.5, color: '#666' }));
    o.push(txt(X1, M + 12, op.titulo, { size: 13, peso: true, anchor: 'end' }));
    o.push(txt(X1, M + 24, `Emitido el ${dmy(hoy)}${total > 1 ? ` · página ${ip + 1} de ${total}` : ''}`, { size: 7.5, color: '#666', anchor: 'end' }));
    o.push(linea(M, M + 31, X1, M + 31, 'stroke="#10776c" stroke-width="1.2"'));
    o.push(txt(M, M + 47, cortar(`${p.codigo} · ${p.nombre}`, 11.5, W - 2 * M, true), { size: 11.5, peso: true }));
    const cli = p.cliente_ficha || p.cliente;
    // obra: nombre, dirección y localidad sin repetir lo que ya se ha dicho
    const partes = [];
    for (const x of [p.obra, p.direccion, p.localidad].map(limpio).filter(Boolean)) {
      const xl = x.toLowerCase();
      if (partes.some((y) => y.toLowerCase().includes(xl))) continue;
      for (let i = partes.length - 1; i >= 0; i--) if (xl.includes(partes[i].toLowerCase())) partes.splice(i, 1);
      partes.push(x);
    }
    const sitio = p.obra ? partes.join(', ') : null;
    o.push(txt(M, M + 61, cortar([cli ? `Cliente: ${cli}` : null, sitio ? `Obra: ${sitio}` : null].filter(Boolean).join('  ·  '), 8.5, W - 2 * M), { size: 8.5, color: '#333' }));

    /* fondo del calendario: fines de semana y festivos (escala días), rejilla */
    o.push(rect(M, yT, X1 - M, THEAD, 'fill="#f3f5f5"'));
    if (escala === 'dias') {
      for (let k = 0; k < N; k++) {
        const f = masDias(ini, k);
        if (finde(f) || (d.libres || new Set()).has(f)) o.push(rect(X0 + k * DW, yB, DW, cuerpo, 'fill="#f1f1f1"'));
      }
    }
    // cabecera de la escala: fila superior (meses o años) y fila inferior (semanas, días o meses)
    const arriba = []; const abajo = [];
    if (escala === 'meses') {
      for (let f = ini; f <= fin;) { const s = new Date(`${f}T12:00:00Z`); s.setUTCMonth(s.getUTCMonth() + 1); const sig = s.toISOString().slice(0, 10); abajo.push([f, masDias(sig, -1), MESES[Number(f.slice(5, 7)) - 1].slice(0, 3)]); f = sig; }
      for (const [a, b] of abajo) { const y = a.slice(0, 4); const u = arriba[arriba.length - 1]; if (u && u[2] === y) u[1] = b; else arriba.push([a, b, y]); }
    } else {
      for (let f = ini; f <= fin; f = masDias(f, 7)) abajo.push([f, masDias(f, 6), escala === 'dias' ? `S${semanaISO(f)} · ${dm(f)}` : `${dm(f)}`]);
      for (let k = 0; k < N; k++) {
        const f = masDias(ini, k); const m = f.slice(0, 7); const u = arriba[arriba.length - 1];
        if (u && u[3] === m) u[1] = f; else arriba.push([f, f, `${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`, m]);
      }
    }
    const fila1 = yT + 12; const fila2 = yT + (escala === 'dias' ? 25 : 24);
    for (const [a, b, t] of arriba) {
      const xa = xDe(a); const w = xDe(masDias(b, 1)) - xa;
      if (a !== ini) o.push(linea(xa, yT, xa, yF, 'stroke="#b9c2c2" stroke-width="0.7"'));
      if (w > 18) o.push(txt(xa + 3, fila1, cortar(t, 8, w - 5, true), { size: 8, peso: true, color: '#333' }));
    }
    for (const [a, b, t] of abajo) {
      const xa = xDe(a); const w = xDe(masDias(b, 1)) - xa;
      if (a !== ini) o.push(linea(xa, yT + 15, xa, yF, 'stroke="#dfe4e4" stroke-width="0.5"'));
      if (w > 12) o.push(txt(xa + w / 2, fila2, cortar(t, 7, w - 2), { size: 7, color: '#555', anchor: 'middle' }));
    }
    if (escala === 'dias' && DW >= 7) {
      for (let k = 0; k < N; k++) {
        const f = masDias(ini, k); const esHoy = op.hoy && f === hoy;
        if (esHoy) o.push(rect(X0 + k * DW + 0.5, yT + 29, DW - 1, 10, 'rx="1.5" fill="#c0392b"'));
        o.push(txt(X0 + k * DW + DW / 2, yT + 36.5, LETRA[dow(f)], { size: 6, color: esHoy ? '#fff' : finde(f) ? '#aaa' : '#777', anchor: 'middle', peso: esHoy }));
      }
    }
    o.push(txt(M + 4, fila2 + (escala === 'dias' ? 0 : 0), op.nivel === 'ot' ? 'Orden de trabajo' : 'Orden de trabajo  ›  tarea', { size: 7.5, peso: true, color: '#555' }));
    o.push(linea(M, yB, X1, yB, 'stroke="#9aa5a5" stroke-width="0.8"'));

    /* filas */
    let y = yB;
    for (const f of pag) {
      const yc = y + f.alto / 2;
      if (f.tipo === 'ot') {
        if (y > yB) o.push(linea(M, y, X1, y, 'stroke="#d5dbdb" stroke-width="0.6"'));
        const ent = f.o.entrega ? `  entrega ${dm(f.o.entrega)}` : '';
        const etiqueta = cortar(`${f.o.codigo}  ${f.o.titulo}`, 8.5, LW - 10 - (ent ? ancho(ent, 7) : 0), true);
        o.push(txt(M + 4, yc + 3, etiqueta, { size: 8.5, peso: true }));
        if (ent) o.push(txt(M + 10 + ancho(etiqueta, 8.5, true), yc + 3, ent.trim(), { size: 7, color: '#777' }));
        if (f.o.inicio) {
          const xa = xDe(f.o.inicio); const xb = xDe(masDias(f.o.fin, 1));
          o.push(rect(xa, yc - 5, xb - xa, 10, `rx="2" fill="${f.color}" fill-opacity="0.35" stroke="${oscuro(f.color)}" stroke-width="0.8"`));
          if (op.avance && f.pct > 0) o.push(rect(xa, yc - 5, (xb - xa) * Math.min(1, f.pct / 100), 10, `rx="2" fill="${oscuro(f.color, 0.85)}"`));
          if (op.avance) o.push(txt(xb + 3, yc + 3, `${f.pct} %`, { size: 7, color: '#444' }));
        } else o.push(txt(X0 + 4, yc + 3, f.o.riesgo === 'hecha' ? 'terminada' : 'por planificar', { size: 7, color: '#888', italic: true }));
        if (f.o.entrega && f.o.entrega >= ini && f.o.entrega <= fin) {
          const xe = xDe(masDias(f.o.entrega, 1));
          o.push(`<path d="M${xe.toFixed(1)} ${(yc - 5).toFixed(1)} l4.5 5 l-4.5 5 l-4.5 -5 z" fill="#c0392b" stroke="#fff" stroke-width="0.6"/>`);
        }
      } else {
        const t = f.t;
        const quien = op.quien && t.proveedor && t.clase !== 'propia' ? `  (${CLASE_TXT[t.clase]}: ${t.proveedor})` : '';
        const etq = cortar(`${t.codigo}  ${t.nombre}`, 7.5, LW - 22 - (quien ? Math.min(ancho(quien, 6.5), LW * 0.45) : 0));
        o.push(txt(M + 16, yc + 2.6, etq, { size: 7.5, color: t.hecha ? '#555' : '#222' }));
        if (quien) o.push(txt(M + 22 + ancho(etq, 7.5), yc + 2.6, cortar(quien.trim(), 6.5, LW - 28 - ancho(etq, 7.5)), { size: 6.5, color: '#888' }));
        if (t.segmentos.length) {
          for (const [a, b] of t.segmentos) {
            if (b < ini || a > fin) continue;
            const xa = xDe(a < ini ? ini : a); const xb = xDe(masDias(b > fin ? fin : b, 1));
            o.push(rect(xa, yc - 3.5, Math.max(1.5, xb - xa), 7, t.hecha ? `rx="1.5" fill="${oscuro(f.color, 0.85)}"` : `rx="1.5" fill="${f.color}" fill-opacity="0.55" stroke="${oscuro(f.color)}" stroke-width="0.5"`));
          }
        } else if (!t.hecha) o.push(txt(X0 + 4, yc + 2.6, 'por planificar', { size: 6.5, color: '#999', italic: true }));
      }
      y += f.alto;
    }
    if (!pag.length) o.push(txt(X0 + 6, yB + 18, 'Aún no hay órdenes de trabajo en este proyecto.', { size: 8, color: '#888', italic: true }));
    o.push(linea(M, yF, X1, yF, 'stroke="#9aa5a5" stroke-width="0.8"'));
    o.push(linea(X0, yT, X0, yF, 'stroke="#9aa5a5" stroke-width="0.8"'));
    o.push(rect(M, yT, X1 - M, yF - yT, 'fill="none" stroke="#9aa5a5" stroke-width="0.8"'));

    /* hoy */
    if (op.hoy && hoy >= ini && hoy <= fin) {
      const xh = xDe(hoy) + DW / 2;
      o.push(linea(xh, yB, xh, yF, 'stroke="#c0392b" stroke-width="0.9" stroke-dasharray="3 2"'));
      o.push(`<path d="M${(xh - 3.5).toFixed(1)} ${yB.toFixed(1)} h7 l-3.5 4.5 z" fill="#c0392b"/>`);
    }

    /* pie: leyenda y nota */
    let yp = yF + 13;
    const ley = []; let xl = M;
    const item = (dibujo, t) => { ley.push(dibujo(xl)); ley.push(txt(xl + 16, yp, t, { size: 7, color: '#555' })); xl += 22 + ancho(t, 7); };
    item((x) => rect(x, yp - 7, 12, 7, 'rx="1.5" fill="#7a9" fill-opacity="0.45" stroke="#576" stroke-width="0.6"'), op.nivel === 'ot' ? 'Duración prevista de la orden' : 'Previsto');
    if (op.avance) item((x) => rect(x, yp - 7, 12, 7, 'rx="1.5" fill="#465"'), op.nivel === 'ot' ? 'Avance' : 'Hecho / avance');
    item((x) => `<path d="M${x + 6} ${yp - 8} l4 4 l-4 4 l-4 -4 z" fill="#c0392b"/>`, 'Fecha de entrega');
    if (op.hoy) item((x) => linea(x + 6, yp - 8, x + 6, yp + 1, 'stroke="#c0392b" stroke-width="0.9" stroke-dasharray="2 1.5"'), 'Hoy');
    o.push(...ley);
    o.push(txt(X1, yp, 'Planéalo', { size: 6.5, color: '#aaa', anchor: 'end' }));
    for (const l of notaL) { yp += 10; o.push(txt(M, yp, l, { size: 7.5, color: '#444' })); }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${alto}" viewBox="0 0 ${W} ${alto}">`
      + `<rect width="${W}" height="${alto}" fill="#fff"/>${o.join('')}</svg>`;
  });
}

function nombreArchivo(p, ext) {
  return `Planificacion-${limpio(p.codigo).replace(/[^\w.-]+/g, '-')}.${ext}`;
}

function montar(app, asyncH) {
  // Ver o descargar: .svg (una imagen, para el PNG) o .pdf (A4 / A3 horizontal, por páginas)
  app.get('/api/gantt/proyecto/:id/informe.:formato(svg|pdf)', auth.permiso('planificar', 'proyectos'), asyncH(async (req, res) => {
    const d = await datos(Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const op = opciones(req.query);
    const { rows: fest } = await query('SELECT fecha::text AS f FROM festivos');
    d.libres = new Set(fest.map((x) => x.f));
    const descargar = req.query.descargar === '1';
    if (req.params.formato === 'svg') {
      const [svg] = dibujar(d, op, { W: 1191 });
      res.set('Content-Type', 'image/svg+xml; charset=utf-8');
      if (descargar) res.set('Content-Disposition', `attachment; filename="${nombreArchivo(d.p, 'svg')}"`);
      return res.send(svg);
    }
    const [W, H] = PAPEL[op.papel];
    const paginas = dibujar(d, op, { W, H });
    const doc = new PDFDocument({ size: [W, H], margin: 0, autoFirstPage: false, info: { Title: `${op.titulo} · ${limpio(d.p.codigo)}`, Author: d.empresa.nombre || '' } });
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', `${descargar ? 'attachment' : 'inline'}; filename="${nombreArchivo(d.p, 'pdf')}"`);
    doc.pipe(res);
    const fuente = (familia, negrita, cursiva) => (negrita ? (cursiva ? 'Helvetica-BoldOblique' : 'Helvetica-Bold') : (cursiva ? 'Helvetica-Oblique' : 'Helvetica'));
    for (const svg of paginas) { doc.addPage({ size: [W, H], margin: 0 }); SVGtoPDF(doc, svg, 0, 0, { fontCallback: fuente, assumePt: true }); }
    doc.end();
  }));
}

module.exports = { montar, dibujar, opciones };
