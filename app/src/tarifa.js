// Tarifa de mano de obra y maquinaria (Informes › Tarifa). Base de precios de Presupuestos.
//
//  · Precio de VENTA estipulado por categoría de operario (Oficial 1ª, 2º…) y por tipo de máquina, en su unidad (h, día, km).
//  · COSTE: el de la ficha (coste empresa €/h de cada operario o máquina; media de los activos de esa categoría o tipo)
//    corregido por el RENDIMIENTO REAL: horas previstas ÷ horas reales en las tareas terminadas de los últimos 6 meses.
//    De cada tarea terminada sale su rendimiento (previstas ÷ reales de todos); a cada operario le cuenta el de las tareas en
//    las que trabajó, pesado por sus horas. Coste efectivo = coste ficha ÷ rendimiento.
//    Con menos de 20 h de base no se corrige (se enseña, pero el coste efectivo es el de ficha).
//  · Margen sobre tarifa = (venta − coste efectivo) ÷ venta.
const { query } = require('./db');
const auth = require('./auth');

const fallo = (s, m) => Object.assign(new Error(m), { status: s });
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const MESES = 6; const BASE_MIN_H = 20;
const principal = (cat) => String(cat || '').split('·')[0].trim();   // '' = sin categoría

// Rendimiento real por operario: { recurso_id: { prev, real, tareas } } (horas previstas equivalentes y reales)
async function rendimientos() {
  const { rows } = await query(`
    WITH t AS (
      SELECT t.id, (COALESCE(t.duracion_inicial_h, t.duracion_h) * GREATEST(t.operarios_req, 1))::float AS prev_h,
             (SELECT sum(g.horas) FROM registros g JOIN recursos r ON r.id = g.recurso_id AND r.tipo = 'operario'
               WHERE g.tarea_id = t.id AND g.tipo = 'productivo')::float AS real_h
        FROM tareas t
       WHERE t.estado = 'hecha' AND t.proveedor_id IS NULL AND COALESCE(t.hecha_en, now()) > now() - interval '${MESES} months')
    SELECT g.recurso_id, sum(g.horas)::float AS real, sum(g.horas * t.prev_h / t.real_h)::float AS prev, count(DISTINCT t.id)::int AS tareas
      FROM registros g JOIN t ON t.id = g.tarea_id
     WHERE g.tipo = 'productivo' AND t.real_h > 0 AND t.prev_h > 0
     GROUP BY g.recurso_id`);
  return Object.fromEntries(rows.map((r) => [r.recurso_id, r]));
}

const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);
function calcular(coste, prev, real) {
  const rend = real > 0 ? prev / real : null;
  const corrige = rend && real >= BASE_MIN_H;
  return { rendimiento_pct: rend ? Math.round(rend * 100) : null, poca_base: !!rend && !corrige, coste_efectivo: coste == null ? null : r2(corrige ? coste / rend : coste) };
}

async function datos() {
  const rend = await rendimientos();
  const { rows: ops } = await query(`SELECT id, nombre, categoria, coste_hora::float AS coste FROM recursos WHERE tipo = 'operario' AND activo ORDER BY nombre`);
  const { rows: maqs } = await query(`
    SELECT t.id::text AS clave, t.nombre, t.familia, count(r.id)::int AS n, avg(r.coste_hora)::float AS coste, string_agg(r.nombre, ', ' ORDER BY r.nombre) AS equipos
      FROM tipos_recurso t JOIN recurso_tipos rt ON rt.tipo_recurso_id = t.id JOIN recursos r ON r.id = rt.recurso_id AND r.activo AND r.tipo = 'maquina'
     WHERE t.clase = 'maquina' GROUP BY t.id ORDER BY t.familia NULLS LAST, t.nombre`);
  // las filas que faltan se crean solas (sin precio de venta)
  const cats = [...new Set(ops.map((o) => principal(o.categoria)).filter(Boolean))];
  // quien no tiene categoría va a «Sin categoría», para que también tenga precio (y se le pueda poner una desde aquí)
  if (ops.some((o) => !principal(o.categoria))) await query(`INSERT INTO tarifa (clase, clave, nombre, orden) VALUES ('mano_obra', '', 'Sin categoría', 999) ON CONFLICT DO NOTHING`);
  // las de oficina nacen ocultas (no se presupuestan por horas); se pueden mostrar
  for (const c of cats) await query(`INSERT INTO tarifa (clase, clave, nombre, activo) VALUES ('mano_obra', $1, $1, $2) ON CONFLICT DO NOTHING`, [c, !/administr|director|rrhh|recursos humanos|comercial|log[ií]stica|contab/i.test(c)]);
  for (const m of maqs) await query(`INSERT INTO tarifa (clase, clave, nombre) VALUES ('maquinaria', $1, $2) ON CONFLICT DO NOTHING`, [m.clave, m.nombre]);
  const { rows: tar } = await query(`SELECT t.*, t.precio_venta::float AS precio_venta, t.coste_manual::float AS coste_manual, t.coste_presupuesto::float AS coste_presupuesto, u.nombre AS cambiado_por_nombre
                                       FROM tarifa t LEFT JOIN usuarios u ON u.id = t.cambiado_por ORDER BY t.clase, t.orden, t.nombre`);

  const personas = ops.map((o) => {
    const r = rend[o.id] || { prev: 0, real: 0, tareas: 0 };
    return { id: o.id, nombre: o.nombre, categoria: principal(o.categoria), categoria_completa: o.categoria || '', coste_ficha: o.coste, horas: r2(r.real), tareas: r.tareas, ...calcular(o.coste, r.prev, r.real) };
  });
  const margen = (venta, coste) => (venta && coste != null ? Math.round(((venta - coste) / venta) * 100) : null);
  const manoObra = tar.filter((t) => t.clase === 'mano_obra').map((t) => {
    const ps = ops.filter((o) => principal(o.categoria) === t.clave);
    const conCoste = ps.filter((o) => o.coste != null);
    const coste = conCoste.length ? r2(conCoste.reduce((s, o) => s + o.coste, 0) / conCoste.length) : null;
    const prev = ps.reduce((s, o) => s + (rend[o.id]?.prev || 0), 0); const real = ps.reduce((s, o) => s + (rend[o.id]?.real || 0), 0);
    const tareas = ps.reduce((s, o) => s + (rend[o.id]?.tareas || 0), 0);
    const c = calcular(t.coste_manual ?? coste, prev, real);
    // fijado para presupuestar (lo que se corrige en los presupuestos): manda sobre el calculado con el rendimiento
    if (t.coste_presupuesto != null) { c.coste_calculado_rend = c.coste_efectivo; c.coste_efectivo = t.coste_presupuesto; c.fijo = true; }
    return { ...t, operarios: ps.length, sin_coste: ps.length - conCoste.length, coste_ficha: t.coste_manual ?? coste, coste_calculado: coste, horas: r2(real), tareas, ...c, margen_pct: margen(t.precio_venta, c.coste_efectivo) };
  });
  const maquinaria = tar.filter((t) => t.clase === 'maquinaria').map((t) => {
    const m = maqs.find((x) => x.clave === t.clave);
    const coste = t.coste_manual ?? (m?.coste != null ? r2(m.coste) : null);
    return { ...t, equipos: m?.equipos || '', n: m?.n || 0, familia: m?.familia || null, coste_calculado: m?.coste != null ? r2(m.coste) : null, coste_efectivo: coste, margen_pct: margen(t.precio_venta, coste) };
  });
  return { mano_obra: manoObra, maquinaria, personas, categorias: manoObra.map((t) => t.clave).filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')), meses: MESES, base_min_h: BASE_MIN_H };
}

function montar(app, asyncH) {
  const ver = auth.permiso('costes');
  app.get('/api/tarifa', ver, asyncH(async (req, res) => res.json(await datos())));
  // Nueva categoría de mano de obra (para ponerle precio y luego asignarla a los operarios): { nombre }
  app.post('/api/tarifa', ver, asyncH(async (req, res) => {
    const n = String(req.body?.nombre || '').replace(/·/g, ' ').trim().slice(0, 60);
    if (!n) throw fallo(400, 'Escribe el nombre de la categoría (p. ej. Oficial 1ª)');
    await query(`INSERT INTO tarifa (clase, clave, nombre) VALUES ('mano_obra', $1, $1) ON CONFLICT (clase, clave) DO UPDATE SET activo = TRUE`, [n]);
    res.status(201).json(await datos());
  }));

  // { precio_venta, unidad, coste_manual, notas, activo, nombre }
  app.put('/api/tarifa/:id', ver, asyncH(async (req, res) => {
    const b = req.body || {}; const sets = []; const vals = [Number(req.params.id)];
    const poner = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
    for (const k of ['precio_venta', 'coste_manual', 'coste_presupuesto']) if (k in b) {
      const v = num(b[k]); if (v != null && !(v >= 0 && v < 1e6)) throw fallo(400, 'Importe no válido'); poner(k, v);
    }
    if ('unidad' in b) { const u = String(b.unidad || '').trim().slice(0, 12); if (!u) throw fallo(400, 'Falta la unidad'); poner('unidad', u); }
    if ('notas' in b) poner('notas', String(b.notas || '').trim().slice(0, 500) || null);
    if ('nombre' in b) { const n = String(b.nombre || '').trim().slice(0, 80); if (!n) throw fallo(400, 'Falta el nombre'); poner('nombre', n); }
    if ('activo' in b) poner('activo', !!b.activo);
    if (!sets.length) throw fallo(400, 'Nada que cambiar');
    poner('cambiado_por', req.usuario.id); sets.push('cambiado_en = now()');
    const { rowCount } = await query(`UPDATE tarifa SET ${sets.join(', ')} WHERE id = $1`, vals);
    if (!rowCount) throw fallo(404, 'No encontrado');
    res.json(await datos());
  }));
}

module.exports = { montar, datos, rendimientos };
