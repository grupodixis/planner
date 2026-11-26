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

module.exports = { prepararPDF };
