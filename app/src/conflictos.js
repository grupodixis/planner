// Reglas de conflicto del tablero diario. Recibe los tramos del día, cada uno con los datos
// de su tarea (operarios_req, requisitos, orden_codigo, nombre…) y sus recursos asignados,
// cada recurso con su franja efectiva (desde–hasta) dentro del tramo.
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const horas = (h) => `${String(Math.round(h * 100) / 100).replace('.', ',')}h`;
const etiqueta = (t) => `${t.orden_codigo} ${String(t.nombre || '').toLowerCase()}${t.tramos?.length > 1 ? ` (tramo ${t.indice})` : ''}`;

function calcularConflictos(tramos, jornada) {
  const out = [];

  for (const t of tramos) {
    const ops = t.asignados.filter((r) => r.tipo === 'operario').length;
    if (ops < (t.operarios_req || 0)) {
      out.push({ tipo: 'operarios', ids: [t.id],
        mensaje: `${etiqueta(t)}: ${ops}/${t.operarios_req} operarios asignados` });
    }
    const asignadosIds = new Set(t.asignados.map((r) => r.id));
    for (const req of t.requisitos || []) {
      if (!asignadosIds.has(req.id)) {
        const falta = req.tipo === 'subcontrata' ? 'sin confirmar' : 'sin asignar';
        out.push({ tipo: 'requisito', ids: [t.id], mensaje: `${etiqueta(t)} requiere ${req.nombre} (${falta})` });
      }
    }
    const fin = t.hora_inicio + t.duracion_h;
    if (fin > jornada.fin) {
      out.push({ tipo: 'jornada', ids: [t.id],
        mensaje: `${etiqueta(t)} termina a las ${hhmm(fin)}: ${horas(fin - Math.max(t.hora_inicio, jornada.fin))} fuera de jornada` });
    }
    if (t.hora_inicio < jornada.inicio) {
      out.push({ tipo: 'jornada', ids: [t.id], mensaje: `${etiqueta(t)} empieza a las ${hhmm(t.hora_inicio)}, antes de la jornada` });
    }
    if (t.exceso > 0) {
      out.push({ tipo: 'exceso', ids: [t.id], leve: true,
        mensaje: `${etiqueta(t)}: ${horas(t.exceso)} por encima de lo estimado (${horas(t.duracion_h_tarea ?? 0)})` });
    }
  }

  // Solapes: el mismo recurso en dos franjas a la vez
  const porRecurso = new Map();
  for (const t of tramos) {
    for (const r of t.asignados) {
      if (!porRecurso.has(r.id)) porRecurso.set(r.id, { r, usos: [] });
      porRecurso.get(r.id).usos.push({ t, desde: r.desde, hasta: r.hasta });
    }
  }
  for (const { r, usos } of porRecurso.values()) {
    usos.sort((a, b) => a.desde - b.desde);
    for (let i = 0; i < usos.length; i++) {
      for (let j = i + 1; j < usos.length; j++) {
        const a = usos[i], b = usos[j];
        if (b.desde < a.hasta) {
          out.push({ tipo: 'solape', ids: [a.t.id, b.t.id], recurso_id: r.id,
            mensaje: `${r.nombre} solapado: ${etiqueta(a.t)} y ${etiqueta(b.t)} (${hhmm(b.desde)}–${hhmm(Math.min(a.hasta, b.hasta))})` });
        }
      }
    }
  }
  return out;
}

module.exports = { calcularConflictos };
