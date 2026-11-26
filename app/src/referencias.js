// Trazabilidad: de qué proyecto, partida y OT viene cada línea de una petición de precio o de un pedido.
// Sale en los PDF, en los correos y en el portal del proveedor, para que su oferta, su albarán y su factura
// vuelvan con la referencia y se puedan imputar a su obra.

// SQL (líneas con alias l, escandallo e): proyecto y OT también para las líneas de subcontratación (tarea_id)
const SQL_OTS = `(SELECT string_agg(DISTINCT o.codigo, ', ') FROM tareas t JOIN ordenes o ON o.id = t.orden_id
    WHERE t.id = l.tarea_id OR t.id IN (SELECT tm.tarea_id FROM tarea_material tm WHERE tm.escandallo_id = l.escandallo_id))`;
const SQL_PROY_TAREA = `(SELECT p2.codigo FROM tareas t JOIN ordenes o ON o.id = t.orden_id JOIN proyectos p2 ON p2.id = o.proyecto_id WHERE t.id = l.tarea_id)`;

const corto = (t, n) => (t && t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t);
// «P-2026-0060 · 01.01 Reparación estructural de manga… · OT 60.01»
function deLinea(l, { largo = 60 } = {}) {
  const proy = l.proyecto_codigo || l.proyecto_tarea;
  return [proy, l.partida_codigo ? [l.partida_codigo, corto(l.partida_nombre, largo)].filter(Boolean).join(' ') : null, l.ots ? `OT ${l.ots}` : null]
    .filter(Boolean).join(' · ');
}
// Proyectos distintos de un documento: «P-2026-0060, P-2026-0063»
function proyectos(lineas) { return [...new Set(lineas.map((l) => l.proyecto_codigo || l.proyecto_tarea).filter(Boolean))].join(', '); }

// Las fuentes estándar del PDF no tienen flechas ni algunos signos: «Barcelona → Menorca» salía «Barcelona !' Menorca»
const paraPdf = (t) => String(t ?? '').replace(/[→⇒➔]/g, '-').replace(/[←⇐]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
// Referencia de una línea en un documento; si la línea no tiene (una línea suelta: portes, transporte) y el documento es de un solo proyecto, la de ese proyecto
function enDocumento(l, lineas, op) {
  const r = deLinea(l, op); if (r) return r;
  const ps = proyectos(lineas); return ps && !ps.includes(',') ? ps : '';
}

module.exports = { SQL_OTS, SQL_PROY_TAREA, deLinea, proyectos, paraPdf, enDocumento };
