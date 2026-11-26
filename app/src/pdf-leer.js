// Prepara los PDF para la IA: lo que el proveedor ha ESCRITO ENCIMA de un PDF (anotaciones de texto, campos de formulario,
// sellos…) va en una capa aparte que muchas lecturas no ven. Con MuPDF (WASM, sin dependencias del sistema) se saca ese
// texto y, si lo hay, se dibuja cada página con todo lo añadido (PNG) para que la IA lo vea como lo ve una persona.
let mupdf = null;
const cargar = async () => (mupdf ||= await import('mupdf'));

const MAX_PAG = 6;
async function prepararPDF(buf) {
  try {
    const m = await cargar();
    const doc = m.Document.openDocument(buf, 'application/pdf');
    const n = doc.countPages();
    const anadido = []; let hayCapa = false;
    for (let i = 0; i < n && i < 30; i++) {
      const p = doc.loadPage(i);
      for (const a of p.getAnnotations?.() || []) {
        const t = String(a.getContents?.() || '').trim();
        const tipo = a.getType?.();
        if (!['Link', 'Popup'].includes(tipo)) hayCapa = true;
        if (t) anadido.push({ pagina: i + 1, tipo, texto: t.slice(0, 2000) });
      }
      for (const w of p.getWidgets?.() || []) {
        const v = String(w.getValue?.() ?? '').trim();
        hayCapa = true;
        if (v && v !== 'Off') anadido.push({ pagina: i + 1, tipo: 'campo', campo: w.getName?.() || null, texto: v.slice(0, 500) });
      }
    }
    const imagenes = [];
    if (hayCapa) {
      for (let i = 0; i < n && i < MAX_PAG; i++) {
        const pix = doc.loadPage(i).toPixmap(m.Matrix.scale(1.4, 1.4), m.ColorSpace.DeviceRGB, false, true);
        imagenes.push(Buffer.from(pix.asPNG()));
      }
    }
    return { paginas: n, anadido, imagenes };
  } catch (e) {
    console.warn('PDF (MuPDF):', e.message);
    return { paginas: null, anadido: [], imagenes: [] };
  }
}

// ¿Es NUESTRA petición (SOL-…) devuelta con los precios escritos? Lectura directa, sin IA: para cada línea de material
// se busca el texto que está a su altura (en el propio PDF o en una anotación) y se saca el precio que hayan puesto.
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[×✕]/g, 'x').replace(/\s+/g, ' ').trim();
function numero(t) {
  let x = String(t).replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(x)) x = x.replace(/\./g, '').replace(',', '.');        // 1.234,50
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(x)) x = x.replace(/,/g, '');                       // 1,234.50
  else x = x.replace(',', '.');
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}
function precioDe(resto, cantidad) {
  const r = resto.replace(/\s+/g, ' ');
  const pats = [
    /[x×*]\s*(?:€|eur)?\s*(\d[\d.,]*)/i,                       // «112 ud x €0.20» / «x 0,20 €»
    /(?:€|eur)\s*(\d[\d.,]*)/i,                                 // «€ 0,20»
    /(\d[\d.,]*)\s*(?:€|eur)/i,                                 // «0,20 €»
    /(?:precio|p\.?\s*u\.?|unit)[^\d]{0,12}(\d[\d.,]*)/i,       // «precio: 0,20»
  ];
  for (const re of pats) {
    const m = re.exec(r);
    if (m) { const n = numero(m[1].replace(/[.,]$/, '')); if (n != null && n >= 0 && n < 1e7 && !(cantidad && n === cantidad && !/€|eur/i.test(m[0]))) return n; }
  }
  return null;
}
async function preciosEnPeticion(buf, codigo, lineas) {
  try {
    const m = await cargar();
    const doc = m.Document.openDocument(buf, 'application/pdf');
    const items = []; let todo = '';
    for (let i = 0; i < doc.countPages() && i < 10; i++) {
      const p = doc.loadPage(i);
      const j = JSON.parse(p.toStructuredText('preserve-whitespace').asJSON());
      for (const b of j.blocks || []) for (const l of b.lines || []) { items.push({ pag: i, x: l.bbox.x, y: l.bbox.y, h: l.bbox.h, w: l.bbox.w, t: l.text, anot: false }); todo += `${l.text}\n`; }
      for (const a of p.getAnnotations?.() || []) {
        const t = String(a.getContents?.() || '').trim(); if (!t) continue;
        const [x0, y0, x1, y1] = a.getRect();
        items.push({ pag: i, x: x0, y: Math.min(y0, y1), h: Math.abs(y1 - y0), w: x1 - x0, t, anot: true }); todo += `${t}\n`;
      }
      for (const w of p.getWidgets?.() || []) {
        const t = String(w.getValue?.() ?? '').trim(); if (!t || t === 'Off') continue;
        const [x0, y0, x1, y1] = w.getRect();
        items.push({ pag: i, x: x0, y: Math.min(y0, y1), h: Math.abs(y1 - y0), w: x1 - x0, t, anot: true }); todo += `${t}\n`;
      }
    }
    if (!norm(todo).includes(norm(codigo))) return null;   // no es nuestra petición
    const precios = {}; const vistos = [];
    for (const l of lineas) {
      const d = norm(l.descripcion).slice(0, 28);
      const fila = items.find((it) => !it.anot && norm(it.t).startsWith(d));
      if (!fila) continue;
      const c = fila.y + fila.h / 2;
      const enFila = items.filter((it) => it.pag === fila.pag && Math.abs((it.y + it.h / 2) - c) <= Math.max(fila.h, 8) * 0.75).sort((a, b) => a.x - b.x);
      // lo de la fila menos la descripción y la cantidad que ya pusimos nosotros
      let resto = enFila.map((it) => it.t).join(' ');
      resto = resto.slice(norm(resto).indexOf(d) >= 0 ? l.descripcion.length : 0);
      const n = precioDe(resto.replace(new RegExp(`^\\s*${String(l.cantidad).replace('.', '[.,]')}\\s*${(l.unidad || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'), ''), l.cantidad);
      vistos.push({ linea_id: l.linea_id, texto: resto.trim().slice(0, 120) });
      if (n != null) precios[l.linea_id] = n;
    }
    return { precios, filas: vistos };
  } catch (e) {
    console.warn('PDF petición (MuPDF):', e.message);
    return null;
  }
}

module.exports = { prepararPDF, preciosEnPeticion, precioDe, numero };
