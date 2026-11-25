// Obras y clientes (Proyectos › Obras · Proyectos › Clientes).
//  · Obra: una dirección que reúne proyectos (de uno o varios clientes). Tiene una fila en el cuadrante (lineas tipo
//    'obra', obra_id), que sale mientras alguno de sus proyectos está activo. Un proyecto está en una obra o en ninguna.
//  · Cliente: datos fiscales y de contacto y sus personas (con lo que aprueba cada una y cómo se le avisa).
//  · proyectos.obra (la dirección) y proyectos.cliente (el nombre) se mantienen como copia del texto de la ficha.
//  · adoptar(proyecto): enlaza un proyecto con su obra y su cliente a partir de lo que tenga (texto o filas de obra
//    sueltas, p. ej. tras importarlo); busca por dirección / nombre y, si no hay, los crea. Una vez para lo que ya había.
const { query, tx } = require('./db');
const auth = require('./auth');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const sinPrefijo = (n) => String(n || '').replace(/^obra\s*[·:-]\s*/i, '').trim();
const TIPOS_CLIENTE = ['empresa', 'particular', 'comunidad', 'administracion'];
const APRUEBA = ['todo', 'planos', 'muestras', 'cambios', 'actas', 'citas'];
// Una obra sale en el cuadrante mientras tiene algún proyecto activo (las filas de obra antiguas, sin ficha, por su proyecto)
const SQL_OBRA_ACTIVA = (l = 'l', p = 'p') => `((${l}.obra_id IS NOT NULL AND EXISTS (SELECT 1 FROM proyectos px WHERE px.obra_id = ${l}.obra_id AND px.estado = 'activo'))
  OR (${l}.obra_id IS NULL AND ${p}.estado = 'activo'))`;
const SQL_OBRA_PROYECTOS = (l = 'l') => `(SELECT string_agg(px.codigo, ' · ' ORDER BY px.codigo) FROM proyectos px WHERE px.obra_id = ${l}.obra_id AND px.estado = 'activo')`;

/* ---------- obras ---------- */
// La fila del cuadrante de la obra (se crea si no la tiene)
async function lineaDeObra(c, obraId) {
  const { rows: ya } = await c.query(`SELECT id FROM lineas WHERE obra_id = $1 AND tipo = 'obra' ORDER BY activo DESC, id LIMIT 1`, [obraId]);
  if (ya.length) { await c.query('UPDATE lineas SET activo = TRUE WHERE id = $1', [ya[0].id]); return ya[0].id; }
  const { rows: [o] } = await c.query('SELECT * FROM obras WHERE id = $1', [obraId]);
  let nombre = `Obra · ${o.nombre}`.slice(0, 120);
  const { rows: ocupado } = await c.query('SELECT 1 FROM lineas WHERE lower(nombre) = lower($1)', [nombre]);
  if (ocupado.length) nombre = `${nombre} (${obraId})`.slice(0, 120);
  const { rows } = await c.query(
    `INSERT INTO lineas (nombre, tipo, ubicacion, orden, obra_id) VALUES ($1, 'obra', $2, COALESCE((SELECT max(orden) FROM lineas), 0) + 1, $3) RETURNING id`,
    [nombre, o.direccion, obraId]);
  return rows[0].id;
}
// Pasa lo planificado de una fila de obra a otra y quita la primera
async function moverLinea(c, de, a) {
  if (de === a) return;
  for (const t of ['tareas', 'tramos', 'tramo_cierres', 'recursos']) await c.query(`UPDATE ${t} SET linea_id = $2 WHERE linea_id = $1`, [de, a]);
  await c.query('DELETE FROM lineas WHERE id = $1', [de]);
}
async function obraPorDireccion(c, direccion, nombre) {
  const d = texto(direccion, 300);
  if (!d) return null;
  const { rows } = await c.query('SELECT id, direccion FROM obras');
  const ya = rows.find((o) => norm(o.direccion) === norm(d));
  if (ya) return ya.id;
  const partes = d.split(',').map((x) => x.trim()).filter(Boolean);
  const { rows: n } = await c.query('INSERT INTO obras (nombre, direccion, localidad) VALUES ($1, $2, $3) RETURNING id',
    [texto(nombre, 120) || texto(partes[0], 120) || d.slice(0, 120), d, partes.length > 1 ? texto(partes[partes.length - 1], 80) : null]);
  return n[0].id;
}
async function clientePorNombre(c, nombre) {
  const n = texto(nombre, 200);
  if (!n) return null;
  const { rows } = await c.query('SELECT id, nombre FROM clientes');
  const ya = rows.find((x) => norm(x.nombre) === norm(n));
  if (ya) return ya.id;
  const { rows: r } = await c.query(`INSERT INTO clientes (nombre, tipo) VALUES ($1, $2) RETURNING id`,
    [n, /^(comunidad|cdad\.?|c\.\s?p\.)\b/i.test(n) ? 'comunidad' : /ajuntament|ayuntamiento|consell|govern|aena|ministerio/i.test(n) ? 'administracion' : 'empresa']);
  return r[0].id;
}

// Pone (o quita) la obra de un proyecto; deja su fila del cuadrante lista y el texto copiado
async function asignarObra(c, proyectoId, obraId) {
  if (obraId) {
    const { rows } = await c.query('SELECT direccion FROM obras WHERE id = $1', [obraId]);
    if (!rows.length) throw fallo(404, 'Obra no encontrada');
    const nueva = await lineaDeObra(c, obraId);
    // lo de este proyecto que estaba en la fila de su obra anterior pasa a la de la nueva
    const { rows: [ant] } = await c.query('SELECT obra_id FROM proyectos WHERE id = $1', [proyectoId]);
    if (ant?.obra_id && ant.obra_id !== obraId) {
      const sus = `SELECT t.id FROM tareas t JOIN ordenes o ON o.id = t.orden_id WHERE o.proyecto_id = $3`;
      const { rows: vieja } = await c.query(`SELECT id FROM lineas WHERE obra_id = $1 AND tipo = 'obra'`, [ant.obra_id]);
      for (const l of vieja) {
        await c.query(`UPDATE tramos SET linea_id = $2 WHERE linea_id = $1 AND tarea_id IN (${sus})`, [l.id, nueva, proyectoId]);
        await c.query(`UPDATE tareas SET linea_id = $2 WHERE linea_id = $1 AND id IN (${sus})`, [l.id, nueva, proyectoId]);
      }
    }
    await c.query('UPDATE proyectos SET obra_id = $2, obra = $3 WHERE id = $1', [proyectoId, obraId, rows[0].direccion]);
  } else {
    await c.query('UPDATE proyectos SET obra_id = NULL, obra = NULL WHERE id = $1', [proyectoId]);
  }
}
async function asignarCliente(c, proyectoId, clienteId) {
  if (clienteId) {
    const { rows } = await c.query('SELECT nombre FROM clientes WHERE id = $1', [clienteId]);
    if (!rows.length) throw fallo(404, 'Cliente no encontrado');
    await c.query('UPDATE proyectos SET cliente_id = $2, cliente = $3 WHERE id = $1', [proyectoId, clienteId, rows[0].nombre]);
  } else await c.query('UPDATE proyectos SET cliente_id = NULL, cliente = NULL WHERE id = $1', [proyectoId]);
}

// Enlaza un proyecto con su obra y su cliente a partir de lo que tenga
async function adoptar(c, proyectoId) {
  const { rows: [p] } = await c.query('SELECT * FROM proyectos WHERE id = $1', [proyectoId]);
  if (!p) return;
  const { rows: sueltas } = await c.query(
    `SELECT * FROM lineas WHERE proyecto_id = $1 AND tipo = 'obra' AND obra_id IS NULL AND activo ORDER BY id`, [proyectoId]);
  let obraId = p.obra_id;
  if (!obraId && (sueltas.length || p.obra)) {
    const base = sueltas[0];
    obraId = await obraPorDireccion(c, p.obra || base?.ubicacion || sinPrefijo(base?.nombre), base ? sinPrefijo(base.nombre) : null);
  }
  if (obraId) {
    const { rows: suya } = await c.query(`SELECT id FROM lineas WHERE obra_id = $1 AND tipo = 'obra' ORDER BY id LIMIT 1`, [obraId]);
    let fila = suya[0]?.id || null;
    for (const l of sueltas) {
      if (!fila) { await c.query('UPDATE lineas SET obra_id = $2 WHERE id = $1', [l.id, obraId]); fila = l.id; }
      else await moverLinea(c, l.id, fila);
    }
    if (!fila) await lineaDeObra(c, obraId);
    if (!p.obra_id) {
      const { rows: [o] } = await c.query('SELECT direccion FROM obras WHERE id = $1', [obraId]);
      await c.query('UPDATE proyectos SET obra_id = $2, obra = COALESCE(obra, $3) WHERE id = $1', [proyectoId, obraId, o.direccion]);
    }
  }
  if (!p.cliente_id && p.cliente) {
    const cid = await clientePorNombre(c, p.cliente);
    if (cid) await c.query('UPDATE proyectos SET cliente_id = $2 WHERE id = $1', [proyectoId, cid]);
  }
}
// Una vez: lo que ya había
async function migrarUnaVez() {
  const { rows } = await query(`SELECT 1 FROM ajustes WHERE clave = 'obras_clientes'`);
  if (rows.length) return;
  const { rows: ps } = await query('SELECT id FROM proyectos ORDER BY id');
  for (const p of ps) await tx((c) => adoptar(c, p.id));
  await query(`INSERT INTO ajustes (clave, valor) VALUES ('obras_clientes', $1) ON CONFLICT (clave) DO NOTHING`, [JSON.stringify({ en: new Date().toISOString(), proyectos: ps.length })]);
  console.log(`Obras y clientes: ${ps.length} proyectos enlazados`);
}

// Clientes del programa de facturación (src/datos/clientes-facturacion.json, ya normalizados): se cargan una vez por
// versión del archivo. Cada uno se busca por código, NIF o nombre (sin la forma jurídica) y, si existe, se sustituyen sus datos.
const sinForma = (n) => norm(String(n || '').replace(/,?\s*(s\.?\s*a\.?\s*,?\s*s\.?\s*m\.?\s*e\.?|s\.?\s*l\.?\s*u\.?|s\.?\s*l\.?|s\.?\s*a\.?|s\.?\s*c\.?\s*p\.?|s\.?\s*c\.?|c\.?\s*b\.?|s\.\s*coop\.?|sociedad limitada|sociedad an[oó]nima)\s*$/i, ''));
async function importarClientes() {
  const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
  const archivo = path.join(__dirname, 'datos', 'clientes-facturacion.json');
  if (!fs.existsSync(archivo)) return;
  const crudo = fs.readFileSync(archivo, 'utf8');
  const huella = crypto.createHash('sha1').update(crudo).digest('hex');
  const { rows: ya } = await query(`SELECT valor FROM ajustes WHERE clave = 'clientes_facturacion'`);
  if (ya[0]?.valor?.huella === huella) return;
  const lista = JSON.parse(crudo);
  const res = await tx(async (c) => {
    const { rows: act } = await c.query('SELECT id, nombre, cif, codigo_ext FROM clientes');
    const porCod = new Map(act.filter((x) => x.codigo_ext).map((x) => [x.codigo_ext, x]));
    const porCif = new Map(act.filter((x) => x.cif).map((x) => [x.cif.replace(/[\s.-]/g, '').toUpperCase(), x]));
    const porNom = new Map(act.map((x) => [sinForma(x.nombre), x]));
    let nuevos = 0; let sustituidos = 0; let contactos = 0;
    const usados = new Set();
    for (const d of lista) {
      let x = porCod.get(d.codigo_ext) || (d.cif && porCif.get(d.cif)) || porNom.get(sinForma(d.nombre)) || (d.nombre_comercial && porNom.get(sinForma(d.nombre_comercial)));
      if (x && usados.has(x.id)) x = null; // dos de la hoja no pisan el mismo
      const vals = [d.nombre, d.nombre_comercial, d.cif, d.tipo, d.telefono, d.movil, d.email, d.notas, d.activo !== false, d.codigo_ext];
      let id;
      if (x) {
        await c.query(`UPDATE clientes SET nombre = $2, nombre_comercial = $3, cif = $4, tipo = $5, telefono = $6, movil = $7, email = $8, notas = $9, activo = $10, codigo_ext = $11
                        WHERE id = $1`, [x.id, ...vals]);
        id = x.id; sustituidos += 1;
      } else {
        const { rows } = await c.query(`INSERT INTO clientes (nombre, nombre_comercial, cif, tipo, telefono, movil, email, notas, activo, codigo_ext)
                                        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, vals);
        id = rows[0].id; nuevos += 1;
      }
      usados.add(id);
      for (const k of d.contactos || []) {
        const { rows: hay } = await c.query('SELECT id, nombre FROM cliente_contactos WHERE cliente_id = $1', [id]);
        if (hay.some((h) => norm(h.nombre) === norm(k.nombre))) continue;
        await c.query('INSERT INTO cliente_contactos (cliente_id, nombre, telefono, email) VALUES ($1,$2,$3,$4)', [id, k.nombre, k.telefono || null, k.email || null]);
        contactos += 1;
      }
    }
    // los proyectos llevan el nombre nuevo; los que no tenían cliente enlazado se enlazan por nombre
    await c.query('UPDATE proyectos p SET cliente = k.nombre FROM clientes k WHERE k.id = p.cliente_id');
    const { rows: sin } = await c.query(`SELECT id, cliente FROM proyectos WHERE cliente_id IS NULL AND cliente IS NOT NULL`);
    const { rows: todos } = await c.query('SELECT id, nombre, nombre_comercial FROM clientes');
    for (const p of sin) {
      const k = todos.find((t) => sinForma(t.nombre) === sinForma(p.cliente) || (t.nombre_comercial && sinForma(t.nombre_comercial) === sinForma(p.cliente)));
      if (k) await c.query('UPDATE proyectos SET cliente_id = $2, cliente = $3 WHERE id = $1', [p.id, k.id, k.nombre]);
    }
    await c.query(`INSERT INTO ajustes (clave, valor) VALUES ('clientes_facturacion', $1) ON CONFLICT (clave) DO UPDATE SET valor = $1`,
      [JSON.stringify({ huella, en: new Date().toISOString(), nuevos, sustituidos, contactos })]);
    return { nuevos, sustituidos, contactos };
  });
  console.log(`Clientes del programa de facturación: ${res.nuevos} nuevos, ${res.sustituidos} sustituidos, ${res.contactos} contactos`);
}

/* ---------- API ---------- */
const CAMPOS_OBRA = { nombre: 120, direccion: 300, localidad: 80, contacto: 120, telefono: 60, acceso: 300, promotor: 160, direccion_facultativa: 160, constructora: 160, notas: 2000 };
const CAMPOS_CLIENTE = { nombre: 200, nombre_comercial: 160, cif: 30, direccion_fiscal: 300, telefono: 60, movil: 60, email: 160, email_facturas: 160, forma_pago: 120, notas: 2000 };
const CAMPOS_CONTACTO = { nombre: 160, papel: 80, telefono: 60, email: 160, notas: 500 };
function leer(b, campos) {
  const o = {};
  for (const [k, max] of Object.entries(campos)) if (k in b) o[k] = texto(b[k], max);
  return o;
}
const emailOk = (e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function montar(app, asyncH) {
  const p = auth.permiso('proyectos');

  // Obras: lista (vista activas = con algún proyecto activo · sin_activo · todas)
  app.get('/api/obras', asyncH(async (req, res) => {
    const q = norm(req.query.q || '');
    const { rows } = await query(
      `SELECT o.*, (SELECT count(*)::int FROM proyectos p WHERE p.obra_id = o.id) AS proyectos,
              (SELECT count(*)::int FROM proyectos p WHERE p.obra_id = o.id AND p.estado = 'activo') AS activos,
              (SELECT string_agg(DISTINCT p.cliente, ' · ') FROM proyectos p WHERE p.obra_id = o.id) AS clientes,
              (SELECT count(*)::int FROM gestion_incidencias i JOIN proyectos p ON p.id = i.proyecto_id
                WHERE p.obra_id = o.id AND i.estado NOT IN ('cerrada')) AS incidencias
         FROM obras o ORDER BY lower(o.nombre)`);
    let lista = rows;
    if (q) lista = lista.filter((o) => norm([o.nombre, o.direccion, o.localidad, o.clientes, o.promotor, o.constructora].join(' ')).includes(q));
    const v = req.query.vista || 'activas';
    if (v === 'activas') lista = lista.filter((o) => o.activos > 0);
    if (v === 'sin_activo') lista = lista.filter((o) => !o.activos);
    const { rows: [sin] } = await query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE estado = 'activo')::int AS activos FROM proyectos WHERE obra_id IS NULL`);
    res.json({ obras: lista, total: rows.length, activas: rows.filter((o) => o.activos > 0).length, sin_obra: sin });
  }));

  // Una obra con sus proyectos, lo próximo planificado y las incidencias abiertas. id = 'sin' → proyectos sin obra
  app.get('/api/obras/:id', asyncH(async (req, res) => {
    const sinObra = req.params.id === 'sin';
    const id = Number(req.params.id);
    let o = { id: null, nombre: 'Sin obra', sin_obra: true };
    if (!sinObra) {
      const { rows } = await query('SELECT * FROM obras WHERE id = $1', [id]);
      if (!rows.length) throw fallo(404, 'Obra no encontrada');
      o = rows[0];
    }
    const { rows: proys } = await query(
      `SELECT p.id, p.codigo, p.nombre, p.cliente, p.cliente_id, p.estado,
              (SELECT count(*)::int FROM ordenes x WHERE x.proyecto_id = p.id) AS ots,
              (SELECT count(*)::int FROM ordenes x WHERE x.proyecto_id = p.id AND x.estado <> 'cerrada') AS ots_abiertas,
              (SELECT max(x.fecha_entrega)::text FROM ordenes x WHERE x.proyecto_id = p.id AND x.estado <> 'cerrada') AS entrega
         FROM proyectos p WHERE ${sinObra ? 'p.obra_id IS NULL' : 'p.obra_id = $1'}
        ORDER BY (p.estado = 'activo') DESC, p.codigo DESC`, sinObra ? [] : [id]);
    const av = await require('./avance').resumen({ proyectoIds: proys.map((x) => x.id) }).catch(() => ({ proyectos: {} }));
    for (const x of proys) x.avance = av.proyectos?.[x.id] || null;
    let proximo = []; let incid = [];
    if (proys.length) {
      const ids = proys.map((x) => x.id);
      ({ rows: proximo } = await query(
        `SELECT x.fecha::text AS fecha, x.hora_inicio::float AS desde, (x.hora_inicio + x.duracion_h)::float AS hasta, t.id AS tarea_id, t.codigo, t.nombre,
                l.nombre AS area, pv.nombre AS proveedor, t.ext_en_obra,
                (SELECT string_agg(r.nombre, ', ' ORDER BY r.nombre) FROM tramo_asignaciones a JOIN recursos r ON r.id = a.recurso_id WHERE a.tramo_id = x.id) AS gente
           FROM tramos x JOIN tareas t ON t.id = x.tarea_id JOIN ordenes ot ON ot.id = t.orden_id LEFT JOIN lineas l ON l.id = x.linea_id
           LEFT JOIN proveedores pv ON pv.id = t.proveedor_id
          WHERE ot.proyecto_id = ANY($1) AND x.fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date
          ORDER BY x.fecha, x.hora_inicio LIMIT 12`, [ids]));
      ({ rows: incid } = await query(
        `SELECT i.id, i.codigo, i.tipo, i.gravedad, i.estado, i.titulo, pv.nombre AS proveedor FROM gestion_incidencias i LEFT JOIN proveedores pv ON pv.id = i.proveedor_id
          WHERE i.proyecto_id = ANY($1) AND i.estado <> 'cerrada' ORDER BY i.creado DESC LIMIT 10`, [ids]));
    }
    res.json({ ...o, proyectos: proys, proximo, incidencias: incid });
  }));

  app.post('/api/obras', p, asyncH(async (req, res) => {
    const d = leer(req.body || {}, CAMPOS_OBRA);
    if (!d.direccion) throw fallo(400, 'La dirección es obligatoria');
    if (!d.nombre) d.nombre = d.direccion.split(',')[0].trim().slice(0, 120);
    const { rows: todas } = await query('SELECT id, nombre, direccion FROM obras');
    const igual = todas.find((x) => norm(x.direccion) === norm(d.direccion));
    if (igual) throw fallo(409, `Ya hay una obra en esa dirección: «${igual.nombre}»`);
    const cols = Object.keys(d);
    const { rows } = await query(`INSERT INTO obras (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, cols.map((k) => d[k]));
    if (req.body?.proyecto_id) await tx((c) => asignarObra(c, Number(req.body.proyecto_id), rows[0].id));
    res.status(201).json(rows[0]);
  }));

  app.put('/api/obras/:id', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const d = leer(req.body || {}, CAMPOS_OBRA);
    if ('nombre' in d && !d.nombre) throw fallo(400, 'El nombre es obligatorio');
    if ('direccion' in d && !d.direccion) throw fallo(400, 'La dirección es obligatoria');
    if ('activo' in (req.body || {})) d.activo = !!req.body.activo;
    const cols = Object.keys(d);
    if (!cols.length) throw fallo(400, 'Nada que cambiar');
    const o = await tx(async (c) => {
      const { rows } = await c.query(`UPDATE obras SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((k) => d[k])]);
      if (!rows.length) throw fallo(404, 'Obra no encontrada');
      // la fila del cuadrante y el texto de sus proyectos siguen a la ficha
      if (d.nombre) {
        const { rows: ocupado } = await c.query(`SELECT 1 FROM lineas WHERE lower(nombre) = lower($1) AND obra_id IS DISTINCT FROM $2`, [`Obra · ${d.nombre}`, id]);
        await c.query(`UPDATE lineas SET nombre = $2 WHERE obra_id = $1 AND tipo = 'obra'`, [id, `Obra · ${d.nombre}${ocupado.length ? ` (${id})` : ''}`.slice(0, 120)]);
      }
      if (d.direccion) {
        await c.query(`UPDATE lineas SET ubicacion = $2 WHERE obra_id = $1 AND tipo = 'obra'`, [id, d.direccion]);
        await c.query('UPDATE proyectos SET obra = $2 WHERE obra_id = $1', [id, d.direccion]);
      }
      return rows[0];
    });
    require('./eventos').emitir({ ruta: 'obras', quien: req.usuario.nombre });
    res.json(o);
  }));

  // Borrar: solo sin proyectos (su fila del cuadrante se quita si no tiene trabajo)
  app.delete('/api/obras/:id', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx(async (c) => {
      const { rows } = await c.query('SELECT count(*)::int AS n FROM proyectos WHERE obra_id = $1', [id]);
      if (rows[0].n) throw fallo(409, 'Tiene proyectos: cámbialos de obra antes de borrarla');
      await c.query(`DELETE FROM lineas l WHERE l.obra_id = $1 AND NOT EXISTS (SELECT 1 FROM tareas t WHERE t.linea_id = l.id)
                       AND NOT EXISTS (SELECT 1 FROM tramos x WHERE x.linea_id = l.id)`, [id]);
      await c.query('UPDATE lineas SET activo = FALSE WHERE obra_id = $1', [id]);
      await c.query('DELETE FROM obras WHERE id = $1', [id]);
    });
    res.json({ ok: true });
  }));

  /* ---- clientes ---- */
  app.get('/api/clientes', asyncH(async (req, res) => {
    const q = norm(req.query.q || '');
    const { rows } = await query(
      `SELECT c.*, (SELECT count(*)::int FROM proyectos p WHERE p.cliente_id = c.id) AS proyectos,
              (SELECT count(*)::int FROM proyectos p WHERE p.cliente_id = c.id AND p.estado = 'activo') AS activos,
              (SELECT string_agg(k.nombre, ' · ') FROM cliente_contactos k WHERE k.cliente_id = c.id AND k.activo) AS contactos
         FROM clientes c ORDER BY c.activo DESC, lower(c.nombre)`);
    res.json(q ? rows.filter((c) => norm([c.nombre, c.nombre_comercial, c.cif, c.contactos, c.email].join(' ')).includes(q)) : rows);
  }));
  app.get('/api/clientes/:id', asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT * FROM clientes WHERE id = $1', [id]);
    if (!rows.length) throw fallo(404, 'Cliente no encontrado');
    const { rows: contactos } = await query('SELECT * FROM cliente_contactos WHERE cliente_id = $1 ORDER BY activo DESC, id', [id]);
    const { rows: proys } = await query(
      `SELECT p.id, p.codigo, p.nombre, p.estado, p.obra_id, o.nombre AS obra FROM proyectos p LEFT JOIN obras o ON o.id = p.obra_id
        WHERE p.cliente_id = $1 ORDER BY (p.estado = 'activo') DESC, p.codigo DESC`, [id]);
    const av = await require('./avance').resumen({ proyectoIds: proys.map((x) => x.id) }).catch(() => ({ proyectos: {} }));
    for (const x of proys) x.avance = av.proyectos?.[x.id] || null;
    res.json({ ...rows[0], contactos, proyectos: proys });
  }));
  function leerCliente(b) {
    const d = leer(b, CAMPOS_CLIENTE);
    if ('tipo' in b) { if (!TIPOS_CLIENTE.includes(b.tipo)) throw fallo(400, 'Tipo no válido'); d.tipo = b.tipo; }
    if ('anticipo_pct' in b) {
      const n = b.anticipo_pct === '' || b.anticipo_pct == null ? null : Number(String(b.anticipo_pct).replace(',', '.'));
      if (n != null && !(n >= 0 && n <= 100)) throw fallo(400, 'El anticipo va de 0 a 100 %');
      d.anticipo_pct = n;
    }
    if ('activo' in b) d.activo = !!b.activo;
    for (const k of ['email', 'email_facturas']) if (!emailOk(d[k])) throw fallo(400, 'Correo no válido');
    return d;
  }
  app.post('/api/clientes', p, asyncH(async (req, res) => {
    const d = leerCliente(req.body || {});
    if (!d.nombre) throw fallo(400, 'El nombre es obligatorio');
    const { rows: todos } = await query('SELECT id, nombre FROM clientes');
    const igual = todos.find((x) => norm(x.nombre) === norm(d.nombre));
    if (igual) throw fallo(409, `Ya existe el cliente «${igual.nombre}»`);
    const cols = Object.keys(d);
    const { rows } = await query(`INSERT INTO clientes (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, cols.map((k) => d[k]));
    if (req.body?.proyecto_id) await tx((c) => asignarCliente(c, Number(req.body.proyecto_id), rows[0].id));
    res.status(201).json(rows[0]);
  }));
  app.put('/api/clientes/:id', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const d = leerCliente(req.body || {});
    if ('nombre' in d && !d.nombre) throw fallo(400, 'El nombre es obligatorio');
    const cols = Object.keys(d);
    if (!cols.length) throw fallo(400, 'Nada que cambiar');
    const r = await tx(async (c) => {
      const { rows } = await c.query(`UPDATE clientes SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((k) => d[k])]);
      if (!rows.length) throw fallo(404, 'Cliente no encontrado');
      if (d.nombre) await c.query('UPDATE proyectos SET cliente = $2 WHERE cliente_id = $1', [id, d.nombre]);
      return rows[0];
    });
    res.json(r);
  }));
  // Borrar: sin proyectos se borra; con proyectos, se da de baja
  app.delete('/api/clientes/:id', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT count(*)::int AS n FROM proyectos WHERE cliente_id = $1', [id]);
    if (rows[0].n) { await query('UPDATE clientes SET activo = FALSE WHERE id = $1', [id]); return res.json({ desactivado: true }); }
    await query('DELETE FROM clientes WHERE id = $1', [id]);
    res.json({ borrado: true });
  }));

  // Personas de contacto
  function leerContacto(b) {
    const d = leer(b, CAMPOS_CONTACTO);
    if (!emailOk(d.email)) throw fallo(400, 'Correo no válido');
    if ('aprueba' in b) d.aprueba = (Array.isArray(b.aprueba) ? b.aprueba : []).filter((x) => APRUEBA.includes(x));
    for (const k of ['avisos_correo', 'avisos_whatsapp', 'activo']) if (k in b) d[k] = !!b[k];
    if ('resumen' in b) { if (!['semanal', 'hitos', 'no'].includes(b.resumen)) throw fallo(400, 'Resumen no válido'); d.resumen = b.resumen; }
    return d;
  }
  app.post('/api/clientes/:id/contactos', p, asyncH(async (req, res) => {
    const d = leerContacto(req.body || {});
    if (!d.nombre) throw fallo(400, 'El nombre es obligatorio');
    d.cliente_id = Number(req.params.id);
    const cols = Object.keys(d);
    const { rows } = await query(`INSERT INTO cliente_contactos (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, cols.map((k) => d[k]));
    res.status(201).json(rows[0]);
  }));
  app.put('/api/cliente-contactos/:id', p, asyncH(async (req, res) => {
    const d = leerContacto(req.body || {});
    if ('nombre' in d && !d.nombre) throw fallo(400, 'El nombre es obligatorio');
    const cols = Object.keys(d);
    if (!cols.length) throw fallo(400, 'Nada que cambiar');
    const { rows } = await query(`UPDATE cliente_contactos SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [Number(req.params.id), ...cols.map((k) => d[k])]);
    if (!rows.length) throw fallo(404, 'Contacto no encontrado');
    res.json(rows[0]);
  }));
  app.delete('/api/cliente-contactos/:id', p, asyncH(async (req, res) => {
    await query('DELETE FROM cliente_contactos WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // Poner la obra o el cliente de un proyecto: { obra_id | null } · { cliente_id | null }
  app.put('/api/proyectos/:id/obra', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx((c) => asignarObra(c, id, req.body?.obra_id ? Number(req.body.obra_id) : null));
    require('./eventos').emitir({ ruta: 'proyectos', quien: req.usuario.nombre });
    res.json({ ok: true });
  }));
  app.put('/api/proyectos/:id/cliente', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx((c) => asignarCliente(c, id, req.body?.cliente_id ? Number(req.body.cliente_id) : null));
    res.json({ ok: true });
  }));
}

module.exports = { montar, adoptar, migrarUnaVez, importarClientes, asignarObra, asignarCliente, lineaDeObra, SQL_OBRA_ACTIVA, SQL_OBRA_PROYECTOS, APRUEBA, norm };
