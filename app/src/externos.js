// Talleres externos: una tarea de una OT la hace un taller de fuera (un proveedor: Ferro Puig, una carpintería
// de aluminio, la galvanizadora…). No hay etapas fijas: las etapas son las tareas de la OT, en su orden.
//  · La tarea externa lleva su taller (tareas.proveedor_id) y se planifica en el área de ese taller
//    (lineas.tipo = 'externo', una por proveedor, se crea sola). En el cuadrante, esas áreas van en el bloque
//    «Talleres externos» y solo salen mientras el taller tiene tareas activas, como las obras.
//  · No ocupa a nadie de aquí: sin avisos de operarios, requisitos ni jornada.
//  · Situación del producto: dónde está la OT cuando está fuera (qué taller, qué tarea, avance, hasta cuándo).
const { query } = require('./db');

const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');

// Área del cuadrante de un taller externo (la crea si no existe)
async function areaExterna(c, proveedorId) {
  const { rows } = await c.query(`SELECT id FROM lineas WHERE tipo = 'externo' AND proveedor_id = $1`, [proveedorId]);
  if (rows.length) {
    await c.query('UPDATE lineas SET activo = true WHERE id = $1 AND NOT activo', [rows[0].id]);
    return rows[0].id;
  }
  const { rows: pv } = await c.query('SELECT nombre FROM proveedores WHERE id = $1', [proveedorId]);
  if (!pv.length) throw Object.assign(new Error('Taller no encontrado'), { status: 400 });
  // el nombre de las áreas es único: si ya existe uno igual, se le añade «(externo)»
  for (const nombre of [pv[0].nombre, `${pv[0].nombre} (externo)`, `${pv[0].nombre} (taller externo ${proveedorId})`]) {
    const { rows: r } = await c.query(
      `INSERT INTO lineas (nombre, tipo, proveedor_id, orden, activo) VALUES ($1, 'externo', $2, 0, true)
       ON CONFLICT DO NOTHING RETURNING id`, [nombre, proveedorId]);
    if (r.length) return r[0].id;
  }
  throw Object.assign(new Error('No se pudo crear el área del taller'), { status: 500 });
}

// Situación del producto de cada OT: recorre sus tareas externas en orden. Usa lo que dice el taller en su
// enlace de seguimiento (estado, avance, fecha prevista, a quién lo entregó) y, si no ha dicho nada, el plan.
//  → { texto, nivel: 'fuera' | 'pendiente' | 'listo' | 'vuelto', retraso, pasos: [...] }
async function situaciones(ordenIds) {
  const out = new Map();
  if (!ordenIds.length) return out;
  const { rows } = await query(
    `SELECT t.id, t.orden_id, t.codigo, t.nombre, t.estado, t.proveedor_id, pv.nombre AS proveedor, t.ext_avance, t.ext_nota,
            t.ext_actualizado, t.orden_en_of, t.ext_estado, t.ext_fin_prevista::text AS fin_prevista, t.ext_entregado_a,
            t.ext_entrega_fecha::text AS entrega_fecha, t.ext_recibido::text AS recibido,
            (SELECT min(x.fecha)::text FROM tramos x WHERE x.tarea_id = t.id) AS desde,
            (SELECT max(x.fecha)::text FROM tramos x WHERE x.tarea_id = t.id) AS hasta
       FROM tareas t JOIN proveedores pv ON pv.id = t.proveedor_id
      WHERE t.orden_id = ANY($1) AND t.proveedor_id IS NOT NULL AND NOT t.ext_en_obra AND NOT t.baja_presupuesto
      ORDER BY t.orden_id, t.orden_en_of, t.id`, [ordenIds]);
  const porOT = new Map();
  for (const r of rows) { if (!porOT.has(r.orden_id)) porOT.set(r.orden_id, []); porOT.get(r.orden_id).push(r); }
  const entregado = (p) => (p.ext_entregado_a ? ` · entregado a ${p.ext_entregado_a === 'nosotros' ? 'nosotros' : p.ext_entregado_a}${p.entrega_fecha ? ` el ${ddmm(p.entrega_fecha)}` : ''}` : '');
  for (const [ot, pasos] of porOT) {
    const i = pasos.findIndex((p) => p.estado !== 'hecha');
    let texto; let nivel; let retraso = null;
    if (i < 0) {
      const u = pasos[pasos.length - 1];
      texto = `Ya no está fuera: ${u.nombre.toLowerCase()} en ${u.proveedor} terminada${entregado(u)}`;
      nivel = 'vuelto';
    } else {
      const p = pasos[i];
      const prev = pasos[i - 1];
      const fin = p.fin_prevista || p.hasta;
      if (p.fin_prevista && p.hasta && p.fin_prevista > p.hasta) retraso = { fecha: p.fin_prevista, plan: p.hasta };
      const extra = [p.ext_avance != null && p.estado === 'en_curso' ? `${p.ext_avance} %` : null,
        fin ? `${p.estado === 'en_curso' ? 'termina' : 'hasta'} ~${ddmm(fin)}${retraso ? ` (plan ${ddmm(retraso.plan)})` : ''}` : 'sin fechas'].filter(Boolean).join(' · ');
      if (p.estado === 'en_curso') { texto = `En ${p.proveedor} · ${p.nombre}${extra ? ` · ${extra}` : ''}`; nivel = 'fuera'; }
      else if (p.recibido) { texto = `En ${p.proveedor} (recibido ${ddmm(p.recibido)}) · ${p.nombre}, sin empezar${fin ? ` · hasta ~${ddmm(fin)}` : ''}`; nivel = 'fuera'; }
      else if (prev) { texto = `En ${prev.proveedor}: ${prev.nombre.toLowerCase()} terminada${entregado(prev)} · lo siguiente: ${p.nombre} (${p.proveedor}${p.desde ? `, desde ${ddmm(p.desde)}` : ''})`; nivel = 'listo'; }
      else { texto = `Aún no ha salido · ${p.nombre} en ${p.proveedor}${p.desde ? ` desde ${ddmm(p.desde)}` : ' (sin planificar)'}`; nivel = 'pendiente'; }
      if (p.ext_nota && p.estado !== 'hecha') texto += ` · «${p.ext_nota}»`;
    }
    out.set(ot, { texto, nivel, retraso, pasos: pasos.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, proveedor: p.proveedor, estado: p.estado, ext_estado: p.ext_estado, avance: p.ext_avance, nota: p.ext_nota, desde: p.desde, hasta: p.hasta, fin_prevista: p.fin_prevista, entregado_a: p.ext_entregado_a, entrega_fecha: p.entrega_fecha, recibido: p.recibido })) });
  }
  // si va en un envío a Menorca (y aún no ha llegado), manda el envío
  const env = await require('./transportes').deOrdenes([...porOT.keys()]);
  const TXT = require('./transportes').ESTADO_TXT;
  for (const [ot, e] of env) {
    const sit = out.get(ot);
    if (!sit || e.estado === 'entregado') continue;
    sit.texto = `🚚 ${e.estado === 'preparando' ? 'Preparando el envío' : e.estado === 'en_mao' ? 'En Maó (almacén del transportista)' : `${TXT[e.estado][0].toUpperCase()}${TXT[e.estado].slice(1)}`} con ${e.transportista || 'el transportista'} (${e.codigo})${e.llegada ? ` · llega ~${ddmm(e.llegada)}` : ''}`;
    sit.nivel = 'fuera';
    sit.envio = e;
  }
  return out;
}

module.exports = { areaExterna, situaciones };
