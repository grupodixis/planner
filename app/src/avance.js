// Avance y rendimiento (tarea › OT › partida › proyecto).
//  · Peso de una tarea = horas-persona previstas al importarla/crearla
//      (estimación inicial × operarios que pide, mín. 1). No cambia aunque luego se reestime.
//  · Avance = peso de las tareas TERMINADAS ÷ peso total. Una tarea cuenta solo al terminarla
//      (lo confirma el encargado en el parte o en el cuadrante).
//  · Rendimiento = peso de lo terminado ÷ horas reales que costó (del parte).
//      > 100 % = se hizo en menos horas de las previstas. Solo cuentan las tareas terminadas
//      que tienen horas reales apuntadas.
//  · «En curso» = tareas sin terminar que ya tienen horas reales (no suman avance; se enseñan aparte).
//  · Las tareas que el compositor quitó del presupuesto (baja) no cuentan, salvo que ya estén hechas.
const { query } = require('./db');

const r1 = (x) => Math.round((x || 0) * 10) / 10;

function base() {
  return { prev_h: 0, hecho_h: 0, rend_prev_h: 0, rend_real_h: 0, curso_h: 0, curso_real_h: 0, tareas: 0, hechas: 0 };
}

// t = { prev_h, real_h, hecha, baja }
function acumular(a, t) {
  if (t.baja && !t.hecha) return a;
  a.tareas++;
  a.prev_h += t.prev_h;
  if (t.hecha) {
    a.hechas++;
    a.hecho_h += t.prev_h;
    if (t.real_h > 0) { a.rend_prev_h += t.prev_h; a.rend_real_h += t.real_h; }
  } else if (t.real_h > 0) {
    a.curso_h += t.prev_h;
    a.curso_real_h += t.real_h;
  }
  return a;
}

function cerrar(a) {
  const out = {};
  for (const k of Object.keys(a)) out[k] = typeof a[k] === 'number' && !Number.isInteger(a[k]) ? r1(a[k]) : a[k];
  out.avance_pct = a.prev_h ? r1(Math.min(100, (a.hecho_h / a.prev_h) * 100)) : null;
  out.rendimiento_pct = a.rend_real_h ? Math.round((a.rend_prev_h / a.rend_real_h) * 100) : null;
  return out;
}

// Tareas con su peso y sus horas reales (personas) de los proyectos / OTs pedidos
async function tareas({ proyectoIds, ordenIds } = {}) {
  const cond = [], vals = [];
  if (proyectoIds) { vals.push(proyectoIds); cond.push(`o.proyecto_id = ANY($${vals.length})`); }
  if (ordenIds) { vals.push(ordenIds); cond.push(`o.id = ANY($${vals.length})`); }
  const { rows } = await query(
    `SELECT t.id, t.orden_id, o.partida_id, o.proyecto_id, (t.estado = 'hecha') AS hecha, t.baja_presupuesto AS baja,
            (COALESCE(t.duracion_inicial_h, t.duracion_h) * (CASE WHEN t.proveedor_id IS NOT NULL THEN 0 ELSE GREATEST(t.operarios_req, 1) END))::float AS prev_h,
            COALESCE((SELECT sum(g.horas) FROM registros g JOIN recursos r ON r.id = g.recurso_id AND r.tipo = 'operario'
                       WHERE g.tarea_id = t.id AND g.tipo = 'productivo'), 0)::float AS real_h
       FROM tareas t JOIN ordenes o ON o.id = t.orden_id
      ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}`, vals);
  return rows;
}

// { proyectos: {id: av}, partidas: {id: av}, ordenes: {id: av}, tareas: {id: {prev_h, real_h, hecha}} }
async function resumen(filtro) {
  const lista = await tareas(filtro);
  const grupos = { proyectos: new Map(), partidas: new Map(), ordenes: new Map() };
  const sumarEn = (m, k, t) => { if (k == null) return; if (!m.has(k)) m.set(k, base()); acumular(m.get(k), t); };
  const porTarea = {};
  for (const t of lista) {
    sumarEn(grupos.proyectos, t.proyecto_id, t);
    sumarEn(grupos.partidas, t.partida_id, t);
    sumarEn(grupos.ordenes, t.orden_id, t);
    porTarea[t.id] = { prev_h: r1(t.prev_h), real_h: r1(t.real_h), hecha: t.hecha,
      rendimiento_pct: t.hecha && t.real_h > 0 ? Math.round((t.prev_h / t.real_h) * 100) : null };
  }
  const obj = (m) => Object.fromEntries([...m].map(([k, a]) => [k, cerrar(a)]));
  return { proyectos: obj(grupos.proyectos), partidas: obj(grupos.partidas), ordenes: obj(grupos.ordenes), tareas: porTarea };
}

module.exports = { base, acumular, cerrar, resumen };
