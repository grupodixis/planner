// Catálogo de materiales y herramientas, con sugerencias al escribir.
// Base generada en catalogo/catalogo-base.json (generar.py) + lo que añaden los usuarios.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query } = require('./db');
const auth = require('./auth');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max) => String(v ?? '').trim().slice(0, max) || null;
const TIPOS = ['material', 'herramienta'];

/* ---------- Catálogo ---------- */

// para buscar: sin acentos, minúsculas, «×» = «x», coma decimal = punto, sin «Ø»
const plano = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[×*]/g, 'x').replace(/(\d),(\d)/g, '$1.$2').replace(/[øΦ⌀]/g, '').replace(/\s+/g, ' ').trim();
// «tubo red 42x2» → tokens; los números con «x» se separan para que «42.4x2» case con «42.4 x 2»
const tokens = (s) => plano(s).replace(/(\d)x(\d)/g, '$1 x $2').split(/[\s/()·,;:+-]+/).filter((t) => t && t !== 'x');

let cache = null;   // { lista: [{id,tipo,familia,nombre,unidad,detalle,_txt,_tok,uso}] }
async function cargarCache() {
  const { rows } = await query(
    `SELECT c.id, c.tipo, c.familia, c.nombre, c.unidad, c.detalle,
            (SELECT count(*)::int FROM partida_escandallo e WHERE e.catalogo_id = c.id)
            + (SELECT count(*)::int FROM tarea_herramienta h WHERE h.catalogo_id = c.id) AS uso
       FROM catalogo c WHERE c.activo ORDER BY c.id`);
  for (const r of rows) {
    r._txt = plano(`${r.nombre} ${r.familia}`);
    r._tok = tokens(`${r.nombre} ${r.familia}`);
  }
  cache = { lista: rows };
  return cache;
}

// Carga (o actualiza) el catálogo base si el archivo ha cambiado
async function sembrar() {
  const archivo = path.join(__dirname, 'catalogo', 'catalogo-base.json');
  if (!fs.existsSync(archivo)) return;
  const crudo = fs.readFileSync(archivo, 'utf8');
  const huella = crypto.createHash('sha1').update(crudo).digest('hex');
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'catalogo_base'`);
  if (rows[0]?.valor?.huella === huella) return;
  const items = JSON.parse(crudo);
  await query(
    `INSERT INTO catalogo (tipo, familia, nombre, unidad, detalle, origen)
     SELECT tipo, familia, nombre, unidad, detalle, 'base'
       FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[]) AS x(tipo, familia, nombre, unidad, detalle)
     ON CONFLICT (tipo, lower(nombre)) DO UPDATE SET familia = EXCLUDED.familia, unidad = EXCLUDED.unidad, detalle = EXCLUDED.detalle
       WHERE catalogo.origen = 'base'`,
    [items.map((i) => i.tipo), items.map((i) => i.familia), items.map((i) => i.nombre), items.map((i) => i.unidad || null), items.map((i) => i.detalle || null)]);
  await query(`INSERT INTO ajustes (clave, valor) VALUES ('catalogo_base', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
    [JSON.stringify({ huella, n: items.length, en: new Date().toISOString() })]);
  cache = null;
  console.log(`Catálogo base: ${items.length} entradas`);
}

function buscar(lista, tipo, q, limite) {
  const qt = tokens(q);
  const qp = plano(q);
  const candidatos = lista.filter((c) => c.tipo === tipo);
  if (!qt.length) return candidatos.slice().sort((a, b) => b.uso - a.uso || a.id - b.id).slice(0, limite);
  const out = [];
  for (const c of candidatos) {
    let nota = 0;
    let ok = true;
    for (const t of qt) {
      // cada palabra buscada tiene que estar: al principio de una palabra (mejor) o dentro
      if (c._tok.some((w) => w === t || (/^\d+$/.test(t) && w.startsWith(`${t}.`)))) nota += 3;
      else if (c._tok.some((w) => w.startsWith(t))) nota += 2;
      else if (c._txt.includes(t)) nota += 1;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (plano(c.nombre).startsWith(qp)) nota += 5;
    else if (c._tok[0] === qt[0]) nota += 2;   // «tubo …» antes que «tapón para tubo …»
    nota += Math.min(c.uso, 20) / 4;   // lo que más se usa, antes
    out.push([nota, c]);
  }
  out.sort((a, b) => b[0] - a[0] || a[1].id - b[1].id);   // a igual nota, el orden del catálogo (medidas de menor a mayor)
  return out.slice(0, limite).map(([, c]) => c);
}
const publico = (c) => ({ id: c.id, tipo: c.tipo, familia: c.familia, nombre: c.nombre, unidad: c.unidad, detalle: c.detalle });

function montar(app, asyncH) {
  const editar = auth.permiso('planificar', 'proyectos', 'escandallo');
  app.get('/api/catalogo-llevar', asyncH(async (req, res) => {
    const tipo = TIPOS.includes(req.query.tipo) ? req.query.tipo : 'material';
    const limite = Math.min(400, Math.max(1, Number(req.query.limite) || 40));
    const c = cache || await cargarCache();
    res.json(buscar(c.lista, tipo, String(req.query.q || '').slice(0, 100), limite).map(publico));
  }));

  app.post('/api/catalogo-llevar', editar, asyncH(async (req, res) => {
    const b = req.body || {};
    if (!TIPOS.includes(b.tipo)) throw fallo(400, 'Tipo no válido');
    const nombre = texto(b.nombre, 200);
    if (!nombre) throw fallo(400, 'Falta el nombre');
    const { rows } = await query(
      `INSERT INTO catalogo (tipo, familia, nombre, unidad, origen, creado_por) VALUES ($1, $2, $3, $4, 'usuario', $5)
       ON CONFLICT (tipo, lower(nombre)) DO UPDATE SET activo = TRUE RETURNING id, tipo, familia, nombre, unidad, detalle`,
      [b.tipo, texto(b.familia, 60) || 'Añadidos', nombre, texto(b.unidad, 20), req.usuario.id]);
    cache = null;
    res.status(201).json(rows[0]);
  }));
}

// sumar un uso (para que lo más usado salga antes)
function usado(id) { if (id && cache) { const x = cache.lista.find((c) => c.id === id); if (x) x.uso++; } }

module.exports = { montar, sembrar, usado };
