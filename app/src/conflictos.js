// Reglas de conflicto del tablero diario. Recibe los tramos del día, cada uno con los datos
// de su tarea (operarios_req, requisitos, orden_codigo, nombre…) y sus recursos asignados,
// cada recurso con su franja efectiva (desde–hasta) dentro del tramo.
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const horas = (h) => `${String(Math.round(h * 100) / 100).replace('.', ',')}h`;
const etiqueta = (t) => `${t.orden_codigo} ${String(t.nombre || '').toLowerCase()}${t.tramos?.length > 1 ? ` (tramo ${t.indice})` : ''}`;

// fecha 'AAAA-MM-DD' + hora decimal → milisegundos (en UTC, solo para comparar)
const instante = (fecha, h) => Date.parse(`${fecha}T00:00:00Z`) + h * 3600e3;
const fechaHora = (ms) => {
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')} ${hhmm(d.getUTCHours() + d.getUTCMinutes() / 60)}`;
};

// dia: { ausencias: Map(recurso_id → [ausencias]), festivo: nombre, fecha }
function calcularConflictos(tramos, jornada, tiposDisponibles = new Set(), exclusivas = new Map(), dia = {}) {
  const out = [];
  // Día festivo: un aviso (leve) con todos los tramos del día
  if (dia.festivo && tramos.length) {
    out.push({ tipo: 'festivo', ids: tramos.map((t) => t.id), leve: true,
      mensaje: `Festivo (${dia.festivo}): ${tramos.length} tramo${tramos.length > 1 ? 's' : ''} planificado${tramos.length > 1 ? 's' : ''}` });
  }
  // Recurso asignado mientras está ausente (vacaciones, baja, avería…), en todo o parte de su franja
  if (dia.ausencias?.size) {
    for (const t of tramos) {
      for (const r of t.asignados) {
        const a = (dia.ausencias.get(r.id) || []).find((x) => x.hora_desde == null || (x.hora_desde < r.hasta && x.hora_hasta > r.desde));
        if (!a) continue;
        out.push({ tipo: 'ausencia', ids: [t.id], recurso_id: r.id, clase: r.tipo, ausencia_id: a.id,
          mensaje: `${r.nombre} está ${a.texto || 'ausente'} y tiene asignado ${etiqueta(t)}` });
      }
    }
  }

  for (const t of tramos) {
    const ops = t.asignados.filter((r) => r.tipo === 'operario').length;
    if (ops < (t.operarios_req || 0)) {
      out.push({ tipo: 'operarios', ids: [t.id], falta: t.operarios_req - ops,
        mensaje: `${etiqueta(t)}: ${ops}/${t.operarios_req} operarios asignados` });
    }
    const asignadosIds = new Set(t.asignados.map((r) => r.id));
    for (const req of t.requisitos || []) {
      if (!asignadosIds.has(req.id)) {
        const falta = req.tipo === 'subcontrata' ? 'sin confirmar' : 'sin asignar';
        out.push({ tipo: 'requisito', ids: [t.id], recurso_id: req.id, mensaje: `${etiqueta(t)} requiere ${req.nombre} (${falta})` });
      }
    }
    // Requisitos por tipo («una Soldadora MIG», «2 × Soldador»): se cumplen con cualquier recurso
    // asignado de ese tipo. Si no hay ninguno dado de alta, es un aviso leve (inventario incompleto).
    for (const q of t.requisitos_tipo || []) {
      const tienen = t.asignados.filter((r) => (r.tipos || []).includes(q.id)).length;
      if (tienen >= q.cantidad) continue;
      const que = `${q.cantidad > 1 ? `${q.cantidad} × ` : ''}${q.nombre}`;
      if (!tiposDisponibles.has(q.id)) {
        out.push({ tipo: 'requisito_tipo', ids: [t.id], leve: true, tipo_recurso_id: q.id, clase: q.clase, falta: q.cantidad - tienen, sin_alta: true,
          mensaje: `${etiqueta(t)} requiere ${que} (no hay ninguno dado de alta)` });
      } else {
        out.push({ tipo: 'requisito_tipo', ids: [t.id], tipo_recurso_id: q.id, clase: q.clase, falta: q.cantidad - tienen,
          mensaje: `${etiqueta(t)} requiere ${que}${tienen ? ` (${tienen} asignado${tienen > 1 ? 's' : ''})` : ' (sin asignar)'}` });
      }
    }
    const fin = t.hora_inicio + t.duracion_h;
    if (fin > jornada.fin) {
      out.push({ tipo: 'jornada', ids: [t.id], lado: 'fin',
        mensaje: `${etiqueta(t)} termina a las ${hhmm(fin)}: ${horas(fin - Math.max(t.hora_inicio, jornada.fin))} fuera de jornada` });
    }
    if (t.hora_inicio < jornada.inicio) {
      out.push({ tipo: 'jornada', ids: [t.id], lado: 'inicio', mensaje: `${etiqueta(t)} empieza a las ${hhmm(t.hora_inicio)}, antes de la jornada` });
    }
    // Dependencias: no empezar antes de que termine la tarea previa (+ espera de secado, curado…)
    for (const d of t.dependencias || []) {
      const previa = `${d.orden_codigo} ${String(d.nombre).toLowerCase()}`;
      const espera = d.espera_h ? ` + ${horas(d.espera_h)} de espera` : '';
      if (!d.fin) {
        if (d.estado !== 'hecha') {
          out.push({ tipo: 'dependencia', ids: [t.id], leve: true, previa_id: d.id, mensaje: `${etiqueta(t)} va después de ${previa}, que aún no está planificada` });
        }
        continue;
      }
      const inicio = instante(t.fecha, t.hora_inicio);
      const libre = instante(d.fin.fecha, d.fin.hora) + (d.espera_h || 0) * 3600e3;
      if (inicio < libre) {
        const l = new Date(libre);
        out.push({ tipo: 'dependencia', ids: [t.id], leve: true, previa_id: d.id,
          libre: { fecha: l.toISOString().slice(0, 10), hora: l.getUTCHours() + l.getUTCMinutes() / 60 },
          mensaje: `${etiqueta(t)} empieza antes de que termine ${previa}${espera} (${fechaHora(libre)})` });
      }
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
  // Puestos de un solo trabajo a la vez: dos tramos que coinciden en el mismo puesto
  const porArea = new Map();
  for (const t of tramos) {
    if (!exclusivas.has(t.linea_id)) continue;
    if (!porArea.has(t.linea_id)) porArea.set(t.linea_id, []);
    porArea.get(t.linea_id).push(t);
  }
  for (const [area, lista] of porArea) {
    lista.sort((a, b) => a.hora_inicio - b.hora_inicio);
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        const a = lista[i], b = lista[j];
        if (b.hora_inicio >= a.hora_inicio + a.duracion_h) break;
        out.push({ tipo: 'puesto', ids: [a.id, b.id], linea_id: area, leve: true,
          libre: a.hora_inicio + a.duracion_h,
          mensaje: `${exclusivas.get(area)}: ${etiqueta(a)} y ${etiqueta(b)} a la vez (${hhmm(b.hora_inicio)}–${hhmm(Math.min(a.hora_inicio + a.duracion_h, b.hora_inicio + b.duracion_h))})` });
      }
    }
  }
  return out;
}

module.exports = { calcularConflictos };
