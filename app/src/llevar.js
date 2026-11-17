// Materiales y herramientas.
//  · Catálogo con sugerencias (base generada en catalogo/catalogo-base.json + lo que añaden los usuarios).
//  · Lista por OT: cada línea (material o herramienta) va a una o varias tareas de la OT.
//    La cantidad es el total de la OT; las tareas dicen dónde se usa (y qué hay que llevar ese día).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { query, tx } = require('./db');
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
            (SELECT count(*)::int FROM ot_llevar l WHERE l.catalogo_id = c.id) AS uso
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

/* ---------- Lista de la OT ---------- */

function leerLinea(b, parcial) {
  const o = {};
  if (!parcial) {
    if (!TIPOS.includes(b.tipo)) throw fallo(400, 'Tipo no válido');
    o.tipo = b.tipo;
  }
  if (!parcial || 'descripcion' in b) {
    o.descripcion = texto(b.descripcion, 200);
    if (!o.descripcion) throw fallo(400, 'Escribe qué hace falta');
  }
  if ('catalogo_id' in b) o.catalogo_id = b.catalogo_id ? Number(b.catalogo_id) : null;
  if ('cantidad' in b) {
    const n = b.cantidad == null || b.cantidad === '' ? null : Number(String(b.cantidad).replace(',', '.'));
    if (n != null && !(n > 0 && n < 1e7)) throw fallo(400, 'Cantidad no válida');
    o.cantidad = n;
  }
  if ('unidad' in b) o.unidad = texto(b.unidad, 20);
  if ('nota' in b) o.nota = texto(b.nota, 300);
  return o;
}

async function lineasDe(ordenId) {
  const { rows } = await query(
    `SELECT l.id, l.tipo, l.catalogo_id, l.descripcion, l.cantidad, l.unidad, l.nota,
            COALESCE((SELECT array_agg(x.tarea_id ORDER BY t.orden_en_of, t.id) FROM ot_llevar_tareas x JOIN tareas t ON t.id = x.tarea_id
                       WHERE x.llevar_id = l.id), '{}') AS tareas
       FROM ot_llevar l WHERE l.orden_id = $1 ORDER BY l.tipo, l.orden, l.id`, [ordenId]);
  return rows;
}

async function comprobarTareas(c, ordenId, ids) {
  const lista = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))];
  if (!lista.length) return [];
  const { rows } = await c.query('SELECT id FROM tareas WHERE orden_id = $1 AND id = ANY($2::int[])', [ordenId, lista]);
  if (rows.length !== lista.length) throw fallo(400, 'Alguna tarea no es de esta OT');
  return lista;
}

function montar(app, asyncH) {
  const editar = auth.permiso('planificar', 'proyectos');

  app.get('/api/catalogo-llevar', asyncH(async (req, res) => {
    const tipo = TIPOS.includes(req.query.tipo) ? req.query.tipo : 'material';
    const limite = Math.min(100, Math.max(1, Number(req.query.limite) || 40));
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

  app.get('/api/ordenes/:id/llevar', asyncH(async (req, res) => {
    const ordenId = Number(req.params.id);
    const { rows: tareas } = await query('SELECT id, nombre, orden_en_of FROM tareas WHERE orden_id = $1 ORDER BY orden_en_of, id', [ordenId]);
    res.json({ lineas: await lineasDe(ordenId), tareas });
  }));

  app.post('/api/ordenes/:id/llevar', editar, asyncH(async (req, res) => {
    const ordenId = Number(req.params.id);
    const o = leerLinea(req.body || {}, false);
    const id = await tx(async (c) => {
      const tareas = await comprobarTareas(c, ordenId, req.body.tareas);
      const { rows } = await c.query(
        `INSERT INTO ot_llevar (orden_id, tipo, catalogo_id, descripcion, cantidad, unidad, nota, orden, creado_por)
         VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE((SELECT max(orden) FROM ot_llevar WHERE orden_id = $1), 0) + 1, $8) RETURNING id`,
        [ordenId, o.tipo, o.catalogo_id ?? null, o.descripcion, o.cantidad ?? null, o.unidad ?? null, o.nota ?? null, req.usuario.id]);
      for (const t of tareas) await c.query('INSERT INTO ot_llevar_tareas (llevar_id, tarea_id) VALUES ($1, $2)', [rows[0].id, t]);
      return rows[0].id;
    });
    if (o.catalogo_id && cache) { const x = cache.lista.find((c) => c.id === o.catalogo_id); if (x) x.uso++; }
    res.status(201).json((await lineasDe(ordenId)).find((l) => l.id === id));
  }));

  app.patch('/api/llevar/:id', editar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: act } = await query('SELECT orden_id FROM ot_llevar WHERE id = $1', [id]);
    if (!act.length) throw fallo(404, 'Línea no encontrada');
    const o = leerLinea(req.body || {}, true);
    await tx(async (c) => {
      const cols = Object.keys(o);
      if (cols.length) await c.query(`UPDATE ot_llevar SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((k) => o[k])]);
      if ('tareas' in (req.body || {})) {
        const tareas = await comprobarTareas(c, act[0].orden_id, req.body.tareas);
        await c.query('DELETE FROM ot_llevar_tareas WHERE llevar_id = $1', [id]);
        for (const t of tareas) await c.query('INSERT INTO ot_llevar_tareas (llevar_id, tarea_id) VALUES ($1, $2)', [id, t]);
      }
    });
    res.json((await lineasDe(act[0].orden_id)).find((l) => l.id === id));
  }));

  app.delete('/api/llevar/:id', editar, asyncH(async (req, res) => {
    await query('DELETE FROM ot_llevar WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // lo que hay que llevar para una tarea (icono 🧰 de la tarea; luego, Mi día)
  app.get('/api/tareas/:id/llevar', asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT l.id, l.tipo, l.descripcion, l.cantidad, l.unidad, l.nota
         FROM ot_llevar l JOIN ot_llevar_tareas x ON x.llevar_id = l.id
        WHERE x.tarea_id = $1 ORDER BY l.tipo, l.orden, l.id`, [Number(req.params.id)]);
    res.json(rows);
  }));
};

module.exports = montar;
module.exports.sembrar = sembrar;
