// Lista de precios del sistema (Compras › Lista de precios) y lo que aprende la IA de cada proveedor.
//
//  · Cada precio CONFIRMADO queda en «precios»: material del catálogo (si se sabe), proveedor, precio SIN IVA, unidad,
//    cantidad, fecha y de dónde viene. Fuentes: ofertas (formulario del portal, apuntadas a mano, leídas por la IA y
//    confirmadas) y pedidos enviados (precio pactado). Más adelante, albaranes y facturas. Solo material: las líneas de
//    subcontratación (tareas) y los portes no entran.
//  · Precio del sistema de un material = el ÚLTIMO confirmado (con aviso si tiene más de 3 meses). Se guarda todo para
//    ver también el mejor de 6 meses, el medio y la evolución. Es lo que usará Presupuestos (GET /api/precios/estimado).
//  · Aprender: al confirmar una oferta leída por la IA se guardan sus correcciones (ia_correcciones). De ahí salen notas
//    del proveedor (precios con IVA, otra unidad…) y ejemplos que se le pasan a la IA la próxima vez que lea a ese
//    proveedor, junto con sus notas editables (proveedores.notas_ia) y cómo llama él a nuestros materiales (proveedor_alias).
const { query, tx } = require('./db');
const U = require('./unidades');
// Precio en la unidad base del material (€/ml, €/m²…) a partir del de la línea
async function enBase(catalogoId, precio, unidadLinea) {
  const m = await U.deCatalogo(catalogoId);
  const base = m?.base || U.unidad(unidadLinea);
  const pb = m ? await U.precioEn(catalogoId, precio, unidadLinea, base) : (precio == null ? null : Number(precio));
  // si no se sabe pasar a la base (falta la equivalencia), se queda en la unidad de la línea
  if (pb == null && precio != null) return { base: U.unidad(unidadLinea) || base, precio_base: Number(precio) };
  return { base, precio_base: pb };
}

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[×✕]/g, 'x').replace(/[^\w.,/+-]+/g, ' ').replace(/\s+/g, ' ').trim();
const PORTES = /^(portes?|transporte|env[ií]o|gastos de env)/i;
const fallo = (s, m) => Object.assign(new Error(m), { status: s });
const DIAS_VIEJO = 90;

/* ---------- registrar ---------- */
// Oferta de un proveedor (todas sus líneas con precio). Sustituye lo que hubiera de esa misma oferta.
async function registrarOferta(q, spId, { via = 'manual', correo_id = null, usuario_id = null } = {}) {
  const { rows } = await q.query(
    `SELECT sp.proveedor_id, sp.respondido_en, sl.id AS linea_id, sl.descripcion, sl.cantidad, sl.unidad, sp_p.precio, sp_p.precio_cotizado, sp_p.unidad_cotizada,
            COALESCE(sl.catalogo_id, e.catalogo_id) AS catalogo_id
       FROM solicitud_proveedores sp JOIN solicitud_lineas sl ON sl.solicitud_id = sp.solicitud_id
       LEFT JOIN solicitud_precios sp_p ON sp_p.sp_id = sp.id AND sp_p.linea_id = sl.id
       LEFT JOIN partida_escandallo e ON e.id = sl.escandallo_id
      WHERE sp.id = $1 AND sl.tarea_id IS NULL`, [spId]);
  for (const r of rows) {
    if (r.precio == null || PORTES.test(r.descripcion)) { await q.query('DELETE FROM precios WHERE sp_id = $1 AND sol_linea_id = $2', [spId, r.linea_id]); continue; }
    const b = await enBase(r.catalogo_id, r.precio, r.unidad);
    await q.query(
      `INSERT INTO precios (catalogo_id, descripcion, desc_norm, proveedor_id, precio, unidad, cantidad, fecha, origen, via, sp_id, sol_linea_id, correo_id, usuario_id,
                            unidad_base, precio_base, precio_orig, unidad_orig)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),'oferta',$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (sp_id, sol_linea_id) WHERE sp_id IS NOT NULL DO UPDATE SET precio = EXCLUDED.precio, catalogo_id = EXCLUDED.catalogo_id,
         unidad = EXCLUDED.unidad, cantidad = EXCLUDED.cantidad, fecha = EXCLUDED.fecha, via = EXCLUDED.via, correo_id = COALESCE(EXCLUDED.correo_id, precios.correo_id),
         usuario_id = EXCLUDED.usuario_id, unidad_base = EXCLUDED.unidad_base, precio_base = EXCLUDED.precio_base, precio_orig = EXCLUDED.precio_orig, unidad_orig = EXCLUDED.unidad_orig`,
      [r.catalogo_id, r.descripcion, norm(r.descripcion), r.proveedor_id, r.precio, r.unidad, r.cantidad, r.respondido_en, via, spId, r.linea_id, correo_id, usuario_id,
        b.base, b.precio_base, r.precio_cotizado ?? r.precio, r.unidad_cotizada || r.unidad]);
  }
}
// Pedido enviado: el precio pactado de cada línea de material
async function registrarPedido(q, pedidoId, usuario_id = null) {
  const { rows } = await q.query(
    `SELECT pc.proveedor_id, pc.enviado_en, l.id AS linea_id, l.descripcion, l.cantidad, l.unidad, l.precio, e.catalogo_id
       FROM pedidos_compra pc JOIN pedido_compra_lineas l ON l.pedido_id = pc.id LEFT JOIN partida_escandallo e ON e.id = l.escandallo_id
      WHERE pc.id = $1 AND l.tarea_id IS NULL`, [pedidoId]);
  for (const r of rows) {
    if (r.precio == null || PORTES.test(r.descripcion) || !r.proveedor_id) continue;
    const b = await enBase(r.catalogo_id, r.precio, r.unidad);
    await q.query(
      `INSERT INTO precios (catalogo_id, descripcion, desc_norm, proveedor_id, precio, unidad, cantidad, fecha, origen, via, pedido_id, pedido_linea_id, usuario_id,
                            unidad_base, precio_base, precio_orig, unidad_orig)
       VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),'pedido','pedido',$9,$10,$11,$12,$13,$5,$6)
       ON CONFLICT (pedido_linea_id) WHERE pedido_linea_id IS NOT NULL DO UPDATE SET precio = EXCLUDED.precio, cantidad = EXCLUDED.cantidad, fecha = EXCLUDED.fecha,
         unidad_base = EXCLUDED.unidad_base, precio_base = EXCLUDED.precio_base`,
      [r.catalogo_id, r.descripcion, norm(r.descripcion), r.proveedor_id, r.precio, r.unidad, r.cantidad, r.enviado_en, pedidoId, r.linea_id, usuario_id, b.base, b.precio_base]);
  }
}
// Una vez: lo que ya había (ofertas respondidas y pedidos enviados)
async function rellenarBase() {
  const { rows } = await query(`SELECT id, catalogo_id, precio, unidad, precio_orig, unidad_orig FROM precios WHERE precio_base IS NULL`);
  for (const r of rows) {
    // lo que cotizó el proveedor manda (si dio €/kg y se corrige el peso por metro, cambia el €/ml)
    let b = r.precio_orig != null && r.unidad_orig && r.unidad_orig !== r.unidad ? await enBase(r.catalogo_id, r.precio_orig, r.unidad_orig) : null;
    if (!b || b.base !== (await U.deCatalogo(r.catalogo_id))?.base) b = await enBase(r.catalogo_id, r.precio, r.unidad); await query('UPDATE precios SET unidad_base = $2, precio_base = $3, precio_orig = COALESCE(precio_orig, precio), unidad_orig = COALESCE(unidad_orig, unidad) WHERE id = $1', [r.id, b.base, b.precio_base]); }
}
async function cargaInicial() {
  await rellenarBase().catch((e) => console.error('Precios en unidad base:', e.message));
  const { rows: [m] } = await query(`SELECT 1 FROM ajustes WHERE clave = 'migr_precios'`);
  if (m) return;
  const { rows: sps } = await query(`SELECT sp.id, sp.portal_respondido_en, sp.correo_id FROM solicitud_proveedores sp WHERE sp.estado = 'respondida'`);
  const { rows: peds } = await query(`SELECT id FROM pedidos_compra WHERE enviado_en IS NOT NULL`);
  await tx(async (q) => {
    for (const s of sps) await registrarOferta(q, s.id, { via: s.correo_id ? 'correo' : s.portal_respondido_en ? 'portal' : 'manual', correo_id: s.correo_id });
    for (const p of peds) await registrarPedido(q, p.id);
  });
  await query(`INSERT INTO ajustes (clave, valor) VALUES ('migr_precios', $1) ON CONFLICT (clave) DO NOTHING`, [JSON.stringify({ ofertas: sps.length, pedidos: peds.length, en: new Date().toISOString() })]);
  console.log(`Lista de precios: cargadas ${sps.length} ofertas y ${peds.length} pedidos`);
}

/* ---------- precio habitual (para avisar y para presupuestar) ---------- */
// Último precio confirmado de un material (por catálogo o, si no, por descripción), de cualquier proveedor
async function habitual({ catalogo_id, descripcion }) {
  const { rows: [r] } = await query(
    `SELECT COALESCE(p.precio_base, p.precio)::float AS precio, COALESCE(p.unidad_base, p.unidad) AS unidad, p.fecha, p.origen, pr.nombre AS proveedor, (CURRENT_DATE - p.fecha) AS dias,
            p.precio_orig::float AS precio_orig, p.unidad_orig, p.nota, p.via, p.presupuesto_id
       FROM precios p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
      WHERE ${catalogo_id ? 'p.catalogo_id = $1' : 'p.desc_norm = $1'}
      ORDER BY (p.origen = 'estimado'), (p.via = 'presupuesto') IS TRUE, p.fecha DESC, (p.origen = 'pedido') DESC, p.id DESC LIMIT 1`, [catalogo_id || norm(descripcion)]);
  return r ? { ...r, viejo: r.dias > DIAS_VIEJO } : null;
}
// Para las líneas de una petición: { linea_id: habitual } (sin contar los precios de esta misma petición)
async function habitualesDeSolicitud(solId) {
  const { rows } = await query(
    `SELECT sl.id AS linea_id, COALESCE(sl.catalogo_id, e.catalogo_id) AS catalogo_id, sl.descripcion, sl.unidad
       FROM solicitud_lineas sl LEFT JOIN partida_escandallo e ON e.id = sl.escandallo_id WHERE sl.solicitud_id = $1 AND sl.tarea_id IS NULL`, [solId]);
  const out = {};
  for (const l of rows) {
    const { rows: [r] } = await query(
      `SELECT COALESCE(p.precio_base, p.precio)::float AS precio, COALESCE(p.unidad_base, p.unidad) AS unidad, p.fecha, p.origen, pr.nombre AS proveedor, (CURRENT_DATE - p.fecha) AS dias
         FROM precios p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
        WHERE ${l.catalogo_id ? 'p.catalogo_id = $1' : 'p.desc_norm = $1'} AND (p.sp_id IS NULL OR p.sp_id NOT IN (SELECT id FROM solicitud_proveedores WHERE solicitud_id = $2))
        ORDER BY (p.origen = 'estimado'), (p.via = 'presupuesto') IS TRUE, p.fecha DESC, (p.origen = 'pedido') DESC, p.id DESC LIMIT 1`, [l.catalogo_id || norm(l.descripcion), solId]);
    if (!r) continue;
    // en la unidad de la línea (si el habitual está en €/ml y pedimos barras, se convierte)
    const enLinea = U.unidad(r.unidad) === U.unidad(l.unidad) ? r.precio : await U.precioEn(l.catalogo_id, r.precio, r.unidad, l.unidad);
    out[l.linea_id] = { ...r, precio: enLinea != null ? +Number(enLinea).toFixed(4) : r.precio, unidad: enLinea != null ? l.unidad : r.unidad, base: { precio: r.precio, unidad: r.unidad }, viejo: r.dias > DIAS_VIEJO };
  }
  return out;
}

/* ---------- aprender ---------- */
const eur = (n) => `${Number(n).toLocaleString('es-ES', { maximumFractionDigits: 4 })} €`;
// Al confirmar una oferta leída por la IA: lo que leyó frente a lo que quedó
async function aprender(correo, final, usuario_id) {
  const o = correo.extraccion?.oferta;
  if (!o || !correo.proveedor_id) return [];
  const { rows: ls } = await query(
    `SELECT sl.id, sl.descripcion, sl.unidad, COALESCE(sl.catalogo_id, e.catalogo_id) AS catalogo_id FROM solicitud_lineas sl
       LEFT JOIN partida_escandallo e ON e.id = sl.escandallo_id WHERE sl.solicitud_id = (SELECT solicitud_id FROM solicitud_proveedores WHERE id = $1)`, [final.sp_id]);
  const ia = new Map((o.lineas || []).map((l) => [Number(l.linea_id), l]));
  const cambios = [];
  for (const l of ls) {
    const a = ia.get(l.id); const f = final.lineas?.[l.id] || {};
    const pIA = a?.precio ?? null; let pF = f.no ? null : (f.precio === '' || f.precio == null ? null : Number(f.precio));
    if (pF != null && f.unidad) pF = (await require('./unidades').precioEn(l.catalogo_id, pF, f.unidad, l.unidad)) ?? pF;   // comparar en la unidad de la línea
    if ((pIA ?? null) !== (pF ?? null) && !(pIA != null && pF != null && Math.abs(pIA - pF) < 0.00005)) {
      cambios.push({ campo: 'precio', linea_id: l.id, catalogo_id: l.catalogo_id, descripcion: l.descripcion, valor_ia: pIA == null ? null : String(pIA), valor_final: pF == null ? null : String(pF) });
    }
    if (a?.su_texto && l.catalogo_id && pF != null) {   // cómo lo llama el proveedor
      await query(`INSERT INTO proveedor_alias (proveedor_id, su_texto, su_norm, catalogo_id, descripcion) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (proveedor_id, su_norm) DO UPDATE SET catalogo_id = EXCLUDED.catalogo_id, descripcion = EXCLUDED.descripcion, veces = proveedor_alias.veces + 1, ultimo = now()`,
      [correo.proveedor_id, String(a.su_texto).slice(0, 200), norm(a.su_texto), l.catalogo_id, l.descripcion]).catch(() => {});
    }
  }
  for (const [campo, vIA, vF] of [['portes', o.portes, final.portes], ['fecha_entrega', o.fecha_entrega, final.fecha_entrega], ['ref_oferta', o.ref_oferta, final.ref_oferta]]) {
    const a = vIA == null || vIA === '' ? null : String(vIA); const f = vF == null || vF === '' ? null : String(vF);
    if (a !== f && !(a && f && Number(a) === Number(f))) cambios.push({ campo, valor_ia: a, valor_final: f });
  }
  for (const c of cambios) {
    await query(`INSERT INTO ia_correcciones (correo_id, proveedor_id, campo, linea_id, catalogo_id, descripcion, valor_ia, valor_final, usuario_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [correo.id, correo.proveedor_id, c.campo, c.linea_id || null, c.catalogo_id || null, c.descripcion || null, c.valor_ia, c.valor_final, usuario_id]);
  }
  if (cambios.length) await notasAutomaticas(correo.proveedor_id);
  return cambios;
}
// Notas que se deducen solas de sus correcciones (≥ 2 veces lo mismo)
async function notasAutomaticas(provId) {
  const { rows } = await query(`SELECT * FROM ia_correcciones WHERE proveedor_id = $1 AND campo = 'precio' AND valor_ia IS NOT NULL AND valor_final IS NOT NULL ORDER BY id DESC LIMIT 30`, [provId]);
  const ratios = rows.map((r) => Number(r.valor_ia) / Number(r.valor_final)).filter((x) => Number.isFinite(x) && x > 0);
  const cuenta = (f) => ratios.filter(f).length;
  const notas = [];
  if (cuenta((x) => Math.abs(x - 1.21) < 0.02) >= 2) notas.push('Sus precios suelen venir CON IVA (21 %): hay que quitarlo.');
  if (cuenta((x) => Math.abs(x - 1 / 1.21) < 0.02) >= 2) notas.push('Sus precios ya vienen SIN IVA: no lo quites.');
  for (const f of [6, 5, 3, 2, 10, 12, 100, 1000]) {
    if (cuenta((x) => Math.abs(x - f) / f < 0.02) >= 2) notas.push(`Suele cotizar por una unidad ${f} veces mayor que la nuestra (p. ej. barra de ${f} m): divide entre ${f}.`);
    if (cuenta((x) => Math.abs(x - 1 / f) / (1 / f) < 0.02) >= 2) notas.push(`Suele cotizar por una unidad ${f} veces menor que la nuestra: multiplica por ${f}.`);
  }
  await query('UPDATE proveedores SET notas_ia_auto = $2 WHERE id = $1', [provId, notas.join('\n') || null]);
}
// Lo que se le pasa a la IA de este proveedor
async function memoriaProveedor(provId) {
  if (!provId) return null;
  const { rows: [p] } = await query('SELECT nombre, notas_ia, notas_ia_auto FROM proveedores WHERE id = $1', [provId]);
  if (!p) return null;
  const { rows: corr } = await query(`SELECT campo, descripcion, valor_ia, valor_final FROM ia_correcciones WHERE proveedor_id = $1 ORDER BY id DESC LIMIT 8`, [provId]);
  const { rows: alias } = await query(`SELECT su_texto, descripcion FROM proveedor_alias WHERE proveedor_id = $1 ORDER BY veces DESC, ultimo DESC LIMIT 25`, [provId]);
  const m = {
    notas: [p.notas_ia, p.notas_ia_auto].filter(Boolean).join('\n') || undefined,
    correcciones_anteriores: corr.length ? corr.map((c) => `${c.campo}${c.descripcion ? ` de «${c.descripcion}»` : ''}: leíste ${c.valor_ia ?? 'nada'} y era ${c.valor_final ?? 'nada'}`) : undefined,
    como_llama_a_nuestros_materiales: alias.length ? alias.map((a) => `«${a.su_texto}» = ${a.descripcion}`) : undefined,
  };
  return m.notas || m.correcciones_anteriores || m.como_llama_a_nuestros_materiales ? m : null;
}

/* ---------- API ---------- */
function montar(app, asyncH, auth) {
  const ver = auth.permiso('compras', 'aprobar_compras', 'costes', 'usuarios');
  // Lista: un material (o descripción sin catálogo) por fila
  app.get('/api/precios', ver, asyncH(async (req, res) => {
    const q = norm(req.query.q || '');
    const prov = Number(req.query.proveedor) || null;
    const { rows } = await query(
      `WITH b AS (
         SELECT COALESCE('c' || p.catalogo_id, 'd' || p.desc_norm) AS clave, p.*, COALESCE(p.precio_base, p.precio) AS pb, COALESCE(p.unidad_base, p.unidad) AS ub, pr.nombre AS proveedor
           FROM precios p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
          WHERE ($1 = '' OR p.desc_norm LIKE '%' || $1 || '%' OR EXISTS (SELECT 1 FROM catalogo c WHERE c.id = p.catalogo_id AND translate(lower(c.nombre), 'áéíóúüñàèòç', 'aeiouunaeoc') LIKE '%' || $1 || '%'))
            AND ($2::int IS NULL OR p.proveedor_id = $2)),
       u AS (SELECT DISTINCT ON (clave) clave, pb, ub, precio_orig, unidad_orig, proveedor, fecha, origen FROM b ORDER BY clave, (origen = 'estimado'), (via = 'presupuesto') IS TRUE, fecha DESC, (origen = 'pedido') DESC, id DESC)
       SELECT b.clave, max(b.catalogo_id) AS catalogo_id, COALESCE(max(c.nombre), max(b.descripcion)) AS material, max(c.familia) AS familia,
              u.pb::float AS ultimo, u.proveedor AS ultimo_proveedor, u.fecha AS ultimo_fecha, u.ub AS unidad, u.origen AS ultimo_origen, (CURRENT_DATE - u.fecha) AS dias,
              u.precio_orig::float AS ultimo_orig, u.unidad_orig AS ultimo_unidad_orig,
              min(b.pb) FILTER (WHERE b.fecha > CURRENT_DATE - 183 AND b.ub = u.ub AND b.origen <> 'estimado')::float AS mejor_6m,
              (array_agg(b.proveedor ORDER BY b.pb) FILTER (WHERE b.fecha > CURRENT_DATE - 183 AND b.ub = u.ub AND b.origen <> 'estimado'))[1] AS mejor_proveedor,
              round(avg(b.pb) FILTER (WHERE b.fecha > CURRENT_DATE - 365 AND b.ub = u.ub AND b.origen <> 'estimado'), 4)::float AS medio_12m, max(c.unidad) AS unidad_catalogo,
              count(*) FILTER (WHERE b.origen <> 'estimado')::int AS n, count(DISTINCT b.proveedor_id)::int AS n_prov,
              max(b.pb) FILTER (WHERE b.origen = 'estimado')::float AS estimado, max(b.nota) FILTER (WHERE b.origen = 'estimado') AS estimado_nota
         FROM b JOIN u ON u.clave = b.clave LEFT JOIN catalogo c ON c.id = b.catalogo_id
        GROUP BY b.clave, u.pb, u.ub, u.precio_orig, u.unidad_orig, u.proveedor, u.fecha, u.origen
        ORDER BY (u.origen = 'estimado'), u.fecha DESC, material LIMIT 5000`, [q, prov]);
    const { rows: provs } = await query(`SELECT DISTINCT pr.id, pr.nombre FROM precios p JOIN proveedores pr ON pr.id = p.proveedor_id ORDER BY pr.nombre`);
    res.json({ precios: rows, proveedores: provs, dias_viejo: DIAS_VIEJO });
  }));
  // Rehacer los precios estimados (nunca toca los reales)
  app.post('/api/precios/estimar', auth.permiso('compras', 'usuarios'), asyncH(async (req, res) => {
    const r = await require('./precios-estimar').estimarTodo();
    res.json({ estimados: r.estimados, sin_estimar: r.sin_estimar });
  }));
  // Historial de un material (c<catalogo_id> o d<descripción normalizada>)
  app.get('/api/precios/historial', ver, asyncH(async (req, res) => {
    const clave = String(req.query.clave || '');
    const porCat = clave.startsWith('c');
    const { rows } = await query(
      `SELECT p.id, COALESCE(p.precio_base, p.precio)::float AS precio, COALESCE(p.unidad_base, p.unidad) AS unidad, p.precio_orig::float AS precio_orig, p.unidad_orig,
              p.precio::float AS precio_linea, p.unidad AS unidad_linea, p.cantidad::float AS cantidad, p.fecha, p.origen, p.via, p.descripcion, p.nota,
              pr.nombre AS proveedor, s.codigo AS sol_codigo, s.id AS sol_id, pc.codigo AS pedido_codigo, pc.id AS pedido_id, p.correo_id
         FROM precios p LEFT JOIN proveedores pr ON pr.id = p.proveedor_id
         LEFT JOIN solicitud_proveedores sp ON sp.id = p.sp_id LEFT JOIN solicitudes_precio s ON s.id = sp.solicitud_id
         LEFT JOIN pedidos_compra pc ON pc.id = p.pedido_id
        WHERE ${porCat ? 'p.catalogo_id = $1' : 'p.desc_norm = $1'} ORDER BY p.fecha DESC, p.id DESC LIMIT 200`, [porCat ? Number(clave.slice(1)) : clave.slice(1)]);
    res.json(rows);
  }));
  // Unidades y equivalencias de un material (y corregirlas a mano)
  app.get('/api/catalogo/:id/unidades', ver, asyncH(async (req, res) => {
    const m = await U.deCatalogo(Number(req.params.id));
    if (!m) throw fallo(404, 'Material no encontrado');
    res.json({ ...m, explicacion: U.explicar(m) });
  }));
  app.put('/api/catalogo/:id/unidades', auth.permiso('compras', 'escandallo', 'usuarios'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [c] } = await query('SELECT id, unidad, unidad_base, equiv FROM catalogo WHERE id = $1', [id]);
    if (!c) throw fallo(404, 'Material no encontrado');
    const b = req.body || {}; let e = { ...(c.equiv || {}) };
    if (b.recalcular) {   // volver a lo calculado del nombre y el detalle
      const { rows: [cc] } = await query('SELECT nombre, unidad, detalle FROM catalogo WHERE id = $1', [id]);
      const g = U.geometria(cc.nombre, cc.unidad, cc.detalle);
      await query(`UPDATE catalogo SET unidad_base = $2, equiv = $3, equiv_origen = $4, equiv_por = NULL, equiv_en = now() WHERE id = $1`,
        [id, g.base, g.forma || g.ml_barra ? JSON.stringify({ kg_ml: g.kg_ml ?? null, pint_m2_ml: g.pint_m2_ml ?? null, ml_barra: g.ml_barra ?? null, m2_ud: g.m2_ud ?? null, kg_m2: g.kg_m2 ?? null, forma: g.forma, calculo: g.calculo }) : null, g.forma || g.ml_barra ? 'calculado' : null]);
      U.olvidar(id); await query('UPDATE precios SET precio_base = NULL WHERE catalogo_id = $1', [id]); await rellenarBase();
      const m = await U.deCatalogo(id); return res.json({ ...m, explicacion: U.explicar(m) });
    }
    for (const k of ['kg_ml', 'ml_barra', 'm2_ud', 'kg_m2', 'pint_m2_ml']) {
      if (!(k in b)) continue;
      const v = b[k] === '' || b[k] == null ? null : Number(String(b[k]).replace(',', '.'));
      if (v != null && !(v > 0 && v < 1e6)) throw fallo(400, `Valor no válido: ${k}`);
      e[k] = v;
    }
    e.calculo = `corregido a mano${req.usuario?.nombre ? ` por ${req.usuario.nombre}` : ''}`;
    const base = ['ml', 'm2', 'kg', 'ud', 'l', 'h'].includes(b.unidad_base) ? b.unidad_base : c.unidad_base;
    await query(`UPDATE catalogo SET equiv = $2, unidad_base = $3, equiv_origen = 'manual', equiv_por = $4, equiv_en = now() WHERE id = $1`, [id, JSON.stringify(e), base, req.usuario.id]);
    U.olvidar(id);
    // recalcular los precios guardados de ese material
    await query('UPDATE precios SET precio_base = NULL WHERE catalogo_id = $1', [id]);
    await rellenarBase();
    res.json({ ...(await U.deCatalogo(id)), explicacion: U.explicar(await U.deCatalogo(id)) });
  }));
  // Para Presupuestos: precio sugerido de un material (el último confirmado) y si está viejo
  app.get('/api/precios/estimado', ver, asyncH(async (req, res) => {
    const r = await habitual({ catalogo_id: Number(req.query.catalogo_id) || null, descripcion: req.query.descripcion });
    res.json(r ? { ...r, aviso: r.viejo ? `Precio de hace ${r.dias} días: conviene pedir precio` : null } : { precio: null, aviso: 'Sin precio en el sistema: pide precio a proveedores' });
  }));
  // Lo que la IA sabe de un proveedor (y editar sus notas)
  app.get('/api/proveedores/:id/ia', ver, asyncH(async (req, res) => {
    const { rows: [p] } = await query('SELECT id, nombre, notas_ia, notas_ia_auto FROM proveedores WHERE id = $1', [req.params.id]);
    if (!p) throw fallo(404, 'Proveedor no encontrado');
    const { rows: corr } = await query(`SELECT k.*, u.nombre AS usuario FROM ia_correcciones k LEFT JOIN usuarios u ON u.id = k.usuario_id WHERE k.proveedor_id = $1 ORDER BY k.id DESC LIMIT 20`, [p.id]);
    const { rows: alias } = await query(`SELECT * FROM proveedor_alias WHERE proveedor_id = $1 ORDER BY veces DESC LIMIT 50`, [p.id]);
    res.json({ ...p, correcciones: corr, alias });
  }));
  app.put('/api/proveedores/:id/ia', auth.permiso('compras'), asyncH(async (req, res) => {
    const t = req.body?.notas_ia == null ? null : String(req.body.notas_ia).trim().slice(0, 2000) || null;
    await query('UPDATE proveedores SET notas_ia = $2 WHERE id = $1', [req.params.id, t]);
    res.json({ ok: true });
  }));
}

module.exports = { montar, registrarOferta, registrarPedido, cargaInicial, habitual, habitualesDeSolicitud, aprender, memoriaProveedor, norm, DIAS_VIEJO };
