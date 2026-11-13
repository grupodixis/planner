// Informes de horas y costes: proyectos (presupuesto / estimado / real), operarios,
// máquinas y alquileres, y fiabilidad de la planificación (cierres del parte).
//  · Horas-persona presupuestadas de una tarea = estimación inicial × operarios que pide (mín. 1).
//  · Coste real = horas registradas × coste/hora del recurso (el de ese día; si no se guardó, el actual).
//  · Importe = importe de la partida que trae el compositor (extra.importe_eur), si lo trae.
const { query } = require('./db');
const auth = require('./auth');
const { jornada } = require('./config');
const { MOTIVOS, NO_PRODUCTIVO } = require('./partes');
const { TIPOS: TIPOS_AUS } = require('./ausencias');

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const r2 = (x) => Math.round((x || 0) * 100) / 100;

function rango(q) {
  const hoy = new Date().toISOString().slice(0, 10);
  const desde = FECHA_RE.test(q.desde || '') ? q.desde : `${hoy.slice(0, 7)}-01`;
  const hasta = FECHA_RE.test(q.hasta || '') ? q.hasta : hoy;
  if (hasta < desde) throw fallo(400, 'Rango de fechas no válido');
  return [desde, hasta];
}

// horas y coste reales por tarea y clase de recurso
const SQL_REAL_TAREA = `
  SELECT g.tarea_id, r.tipo AS clase, sum(g.horas)::float AS h,
         sum(g.horas * COALESCE(g.coste_hora, r.coste_hora))::float AS coste,
         count(*) FILTER (WHERE COALESCE(g.coste_hora, r.coste_hora) IS NULL)::int AS sin_coste
    FROM registros g JOIN recursos r ON r.id = g.recurso_id
   WHERE g.tipo = 'productivo' AND g.tarea_id IS NOT NULL`;

function vacio() {
  return { prev_h: 0, est_h: 0, plan_h: 0, real_h: 0, prevision_h: 0, coste_op: 0, coste_maq: 0, coste_sub: 0, coste: 0,
    sin_coste: 0, tareas: 0, hechas: 0, importe: null };
}
function sumar(a, b) {
  for (const k of ['prev_h', 'est_h', 'plan_h', 'real_h', 'prevision_h', 'coste_op', 'coste_maq', 'coste_sub', 'coste', 'sin_coste', 'tareas', 'hechas']) a[k] += b[k];
  if (b.importe != null) a.importe = (a.importe || 0) + b.importe;
  return a;
}
function redondear(x) {
  for (const k of ['prev_h', 'est_h', 'plan_h', 'real_h', 'prevision_h', 'coste_op', 'coste_maq', 'coste_sub', 'coste']) x[k] = r2(x[k]);
  x.desvio_h = r2(x.prevision_h - x.prev_h);
  x.desvio_pct = x.prev_h ? Math.round((x.desvio_h / x.prev_h) * 1000) / 10 : null;
  x.avance_pct = x.prev_h ? Math.min(100, Math.round((x.real_h / Math.max(x.prevision_h, 0.01)) * 1000) / 10) : null;
  if (x.importe != null) { x.importe = r2(x.importe); x.margen = r2(x.importe - x.coste); }
  return x;
}

// Datos de todas las tareas de uno o varios proyectos, ya con sus cifras
async function tareasDe(proyectoIds) {
  const { rows } = await query(
    `WITH real AS (${SQL_REAL_TAREA} GROUP BY 1, 2)
     SELECT t.id, t.nombre, t.estado, t.orden_id, t.orden_en_of, t.baja_presupuesto,
            o.codigo AS orden_codigo, o.titulo AS orden_titulo, o.estado AS orden_estado, o.partida_id, o.proyecto_id,
            GREATEST(t.operarios_req, 1) AS ops,
            COALESCE(t.duracion_inicial_h, t.duracion_h)::float AS prev_dur, t.duracion_h::float AS est_dur,
            (SELECT COALESCE(sum(COALESCE(a.hasta, x.hora_inicio + x.duracion_h) - COALESCE(a.desde, x.hora_inicio)), 0)
               FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id JOIN recursos r ON r.id = a.recurso_id AND r.tipo = 'operario'
              WHERE x.tarea_id = t.id)::float AS plan_h,
            COALESCE((SELECT json_object_agg(clase, json_build_object('h', h, 'coste', coste, 'sin', sin_coste)) FROM real WHERE real.tarea_id = t.id), '{}') AS real
       FROM tareas t JOIN ordenes o ON o.id = t.orden_id
      WHERE o.proyecto_id = ANY($1)
      ORDER BY o.codigo, t.orden_en_of, t.id`, [proyectoIds]);
  return rows.map((t) => {
    const re = t.real || {};
    const x = vacio();
    x.prev_h = t.prev_dur * t.ops;
    x.est_h = t.est_dur * t.ops;
    x.plan_h = t.plan_h;
    x.real_h = re.operario?.h || 0;
    // previsión a fin: lo real si está hecha; si no, lo mayor entre lo real y la estimación actual
    x.prevision_h = t.estado === 'hecha' ? x.real_h : Math.max(x.real_h, x.est_h);
    x.coste_op = re.operario?.coste || 0;
    x.coste_maq = re.maquina?.coste || 0;
    x.coste_sub = re.subcontrata?.coste || 0;
    x.coste = x.coste_op + x.coste_maq + x.coste_sub;
    x.sin_coste = (re.operario?.sin || 0) + (re.maquina?.sin || 0) + (re.subcontrata?.sin || 0);
    x.tareas = 1;
    x.hechas = t.estado === 'hecha' ? 1 : 0;
    return { ...t, cifras: x };
  });
}

function montar(app, asyncH) {
  const puede = auth.permiso('informes');

  /* ---------- Resumen de todos los proyectos ---------- */
  app.get('/api/informes/proyectos', puede, asyncH(async (req, res) => {
    const { rows: proyectos } = await query(
      `SELECT p.id, p.codigo, p.nombre, p.cliente, p.estado,
              (SELECT sum((pa.extra->>'importe_eur')::numeric) FROM partidas pa
                WHERE pa.proyecto_id = p.id AND jsonb_typeof(pa.extra->'importe_eur') = 'number')::float AS importe,
              (SELECT max(g.fecha) FROM registros g JOIN tareas t ON t.id = g.tarea_id JOIN ordenes o ON o.id = t.orden_id
                WHERE o.proyecto_id = p.id) AS ultimo_registro
         FROM proyectos p ORDER BY (p.estado = 'activo') DESC, p.codigo`);
    const tareas = await tareasDe(proyectos.map((p) => p.id));
    const out = proyectos.map((p) => {
      const x = tareas.filter((t) => t.proyecto_id === p.id).reduce((a, t) => sumar(a, t.cifras), vacio());
      x.importe = p.importe;
      return { ...p, cifras: redondear(x) };
    });
    res.json({ proyectos: out });
  }));

  /* ---------- Un proyecto: partida › OT › tarea ---------- */
  app.get('/api/informes/proyecto/:id', puede, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: pr } = await query('SELECT id, codigo, nombre, cliente, obra, estado FROM proyectos WHERE id = $1', [id]);
    if (!pr.length) throw fallo(404, 'Proyecto no encontrado');
    const [{ rows: partidas }, tareas, { rows: personas }, { rows: motivos }, { rows: recursosSinCoste }] = await Promise.all([
      query(`SELECT id, codigo, nombre, orden,
                    CASE WHEN jsonb_typeof(extra->'importe_eur') = 'number' THEN (extra->>'importe_eur')::float END AS importe
               FROM partidas WHERE proyecto_id = $1 ORDER BY orden, codigo`, [id]),
      tareasDe([id]),
      query(`SELECT r.id, r.nombre, r.tipo, sum(g.horas)::float AS h, sum(g.horas * COALESCE(g.coste_hora, r.coste_hora))::float AS coste,
                    min(g.fecha) AS desde, max(g.fecha) AS hasta
               FROM registros g JOIN recursos r ON r.id = g.recurso_id JOIN tareas t ON t.id = g.tarea_id JOIN ordenes o ON o.id = t.orden_id
              WHERE o.proyecto_id = $1 AND g.tipo = 'productivo'
              GROUP BY r.id ORDER BY r.tipo, sum(g.horas) DESC`, [id]),
      query(`SELECT c.cierre, c.motivo, count(*)::int AS n, sum(c.plan_h)::float AS plan_h, sum(c.real_h)::float AS real_h
               FROM tramo_cierres c JOIN tareas t ON t.id = c.tarea_id JOIN ordenes o ON o.id = t.orden_id
              WHERE o.proyecto_id = $1 GROUP BY 1, 2`, [id]),
      query(`SELECT DISTINCT r.id, r.nombre, r.tipo FROM registros g JOIN recursos r ON r.id = g.recurso_id
               JOIN tareas t ON t.id = g.tarea_id JOIN ordenes o ON o.id = t.orden_id
              WHERE o.proyecto_id = $1 AND g.coste_hora IS NULL AND r.coste_hora IS NULL ORDER BY r.nombre`, [id]),
    ]);
    // OTs
    const ots = new Map();
    for (const t of tareas) {
      if (!ots.has(t.orden_id)) {
        ots.set(t.orden_id, { id: t.orden_id, codigo: t.orden_codigo, titulo: t.orden_titulo, estado: t.orden_estado, partida_id: t.partida_id, cifras: vacio(), tareas: [] });
      }
      const o = ots.get(t.orden_id);
      sumar(o.cifras, t.cifras);
      o.tareas.push({ id: t.id, nombre: t.nombre, estado: t.estado, baja: t.baja_presupuesto, ops: t.ops, cifras: redondear({ ...t.cifras }) });
    }
    const grupos = [...partidas, { id: null, codigo: '', nombre: 'Sin partida', importe: null }].map((pa) => {
      const suyas = [...ots.values()].filter((o) => (o.partida_id || null) === pa.id);
      const x = suyas.reduce((a, o) => sumar(a, o.cifras), vacio());
      x.importe = pa.importe;
      return { ...pa, cifras: redondear(x), ots: suyas.map((o) => ({ ...o, cifras: redondear(o.cifras) })) };
    }).filter((g) => g.ots.length || g.id);
    const total = grupos.reduce((a, g) => sumar(a, { ...g.cifras, importe: g.importe }), vacio());
    const motivosOut = motivos.map((m) => ({ ...m, nombre: m.motivo ? MOTIVOS[m.motivo] || m.motivo : null }));
    res.json({ proyecto: pr[0], total: redondear(total), partidas: grupos, personas, motivos: motivosOut, recursos_sin_coste: recursosSinCoste });
  }));

  /* ---------- Operarios en un periodo ---------- */
  app.get('/api/informes/operarios', puede, asyncH(async (req, res) => {
    const [desde, hasta] = rango(req.query);
    const [{ rows: ops }, { rows: regs }, { rows: aus }, { rows: fest }] = await Promise.all([
      query(`SELECT id, nombre, vinculo, coste_hora::float AS coste_hora FROM recursos WHERE tipo = 'operario' AND activo ORDER BY (vinculo = 'subcontratado'), nombre`),
      query(`SELECT g.recurso_id, g.fecha, g.horas::float AS horas, g.tipo, g.motivo, COALESCE(g.coste_hora, r.coste_hora)::float AS coste_hora,
                    p.id AS proyecto_id, p.codigo AS proyecto, p.nombre AS proyecto_nombre
               FROM registros g JOIN recursos r ON r.id = g.recurso_id AND r.tipo = 'operario'
               LEFT JOIN tareas t ON t.id = g.tarea_id LEFT JOIN ordenes o ON o.id = t.orden_id LEFT JOIN proyectos p ON p.id = o.proyecto_id
              WHERE g.fecha BETWEEN $1 AND $2`, [desde, hasta]),
      query(`SELECT recurso_id, tipo, desde, hasta, hora_desde::float AS hora_desde, hora_hasta::float AS hora_hasta, justificante
               FROM ausencias WHERE desde <= $2 AND hasta >= $1`, [desde, hasta]),
      query('SELECT fecha FROM festivos WHERE fecha BETWEEN $1 AND $2', [desde, hasta]),
    ]);
    const festivos = new Set(fest.map((f) => f.fecha));
    const esLaborable = (f) => { const d = new Date(`${f}T00:00:00Z`).getUTCDay(); return d > 0 && d < 6 && !festivos.has(f); };
    const diasLab = [];
    for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hasta}T00:00:00Z`); t += 864e5) {
      const f = new Date(t).toISOString().slice(0, 10);
      if (esLaborable(f)) diasLab.push(f);
    }
    const filas = ops.map((o) => {
      const suyos = regs.filter((g) => g.recurso_id === o.id);
      const porDia = new Map();
      for (const g of suyos) porDia.set(g.fecha, (porDia.get(g.fecha) || 0) + g.horas);
      const extra = [...porDia.values()].reduce((s, h) => s + Math.max(0, h - jornada.horas), 0);
      const prod = suyos.filter((g) => g.tipo === 'productivo');
      const noProd = {};
      for (const g of suyos.filter((x) => x.tipo === 'no_productivo')) noProd[g.motivo] = r2((noProd[g.motivo] || 0) + g.horas);
      const proy = new Map();
      for (const g of prod) {
        const k = g.proyecto_id || 0;
        if (!proy.has(k)) proy.set(k, { id: g.proyecto_id, codigo: g.proyecto || '—', nombre: g.proyecto_nombre || 'Sin proyecto', h: 0, coste: 0 });
        const p = proy.get(k); p.h += g.horas; p.coste += g.horas * (g.coste_hora || 0);
      }
      // ausencias en días laborables del periodo
      const ausencias = {};
      for (const a of aus.filter((x) => x.recurso_id === o.id)) {
        const clave = a.tipo === 'falta' ? `falta_${a.justificante || 'pendiente'}` : a.tipo;
        let n = 0;
        for (const f of diasLab) if (f >= a.desde && f <= a.hasta) n += a.hora_desde != null ? Math.min(1, (a.hora_hasta - a.hora_desde) / jornada.horas) : 1;
        if (n) ausencias[clave] = r2((ausencias[clave] || 0) + n);
      }
      const horasProd = prod.reduce((s, g) => s + g.horas, 0);
      const horasNo = suyos.filter((g) => g.tipo === 'no_productivo').reduce((s, g) => s + g.horas, 0);
      return {
        id: o.id, nombre: o.nombre, vinculo: o.vinculo, coste_hora: o.coste_hora,
        productivas: r2(horasProd), no_productivas: r2(horasNo), no_productivo: noProd, extra: r2(extra),
        dias: porDia.size, coste: r2(suyos.reduce((s, g) => s + g.horas * (g.coste_hora || 0), 0)),
        sin_coste: suyos.some((g) => g.coste_hora == null),
        ausencias, proyectos: [...proy.values()].map((p) => ({ ...p, h: r2(p.h), coste: r2(p.coste) })).sort((a, b) => b.h - a.h),
      };
    });
    res.json({ desde, hasta, jornada, dias_laborables: diasLab.length, operarios: filas,
      tipos_ausencia: Object.fromEntries(Object.entries(TIPOS_AUS).map(([k, t]) => [k, t.nombre])), no_productivo: NO_PRODUCTIVO });
  }));

  /* ---------- Máquinas, vehículos y alquileres en un periodo ---------- */
  app.get('/api/informes/maquinas', puede, asyncH(async (req, res) => {
    const [desde, hasta] = rango(req.query);
    const { rows } = await query(
      `SELECT r.id, r.nombre, r.tipo, r.coste_hora::float AS coste_hora,
              COALESCE(sum(g.horas), 0)::float AS h, count(DISTINCT g.fecha)::int AS dias,
              COALESCE(sum(g.horas * COALESCE(g.coste_hora, r.coste_hora)), 0)::float AS coste,
              (SELECT COALESCE(sum(COALESCE(a.hasta, x.hora_inicio + x.duracion_h) - COALESCE(a.desde, x.hora_inicio)), 0)
                 FROM tramo_asignaciones a JOIN tramos x ON x.id = a.tramo_id
                WHERE a.recurso_id = r.id AND x.fecha BETWEEN $1 AND $2)::float AS plan_h
         FROM recursos r LEFT JOIN registros g ON g.recurso_id = r.id AND g.fecha BETWEEN $1 AND $2
        WHERE r.tipo IN ('maquina', 'subcontrata') AND r.activo
        GROUP BY r.id ORDER BY r.tipo, COALESCE(sum(g.horas), 0) DESC, r.nombre`, [desde, hasta]);
    res.json({ desde, hasta, recursos: rows.map((r) => ({ ...r, h: r2(r.h), coste: r2(r.coste), plan_h: r2(r.plan_h) })) });
  }));

  /* ---------- Fiabilidad de la planificación y desviaciones ---------- */
  app.get('/api/informes/planificacion', puede, asyncH(async (req, res) => {
    const [desde, hasta] = rango(req.query);
    const [{ rows: semanas }, { rows: motivos }, { rows: dias }, { rows: desvios }] = await Promise.all([
      query(`SELECT to_char(date_trunc('week', fecha), 'YYYY-MM-DD') AS semana,
                    count(*)::int AS cierres,
                    count(*) FILTER (WHERE cierre = 'hecho')::int AS hechos,
                    count(*) FILTER (WHERE cierre = 'corregido')::int AS corregidos,
                    count(*) FILTER (WHERE cierre = 'no_hecho')::int AS no_hechos,
                    COALESCE(sum(plan_h), 0)::float AS plan_h, COALESCE(sum(real_h), 0)::float AS real_h
               FROM tramo_cierres WHERE fecha BETWEEN $1 AND $2 GROUP BY 1 ORDER BY 1`, [desde, hasta]),
      query(`SELECT motivo, count(*)::int AS n,
                    count(*) FILTER (WHERE cierre = 'no_hecho')::int AS no_hechos,
                    COALESCE(sum(plan_h) FILTER (WHERE cierre = 'no_hecho'), 0)::float AS horas_perdidas,
                    COALESCE(sum(real_h - plan_h) FILTER (WHERE cierre = 'corregido'), 0)::float AS horas_desvio
               FROM tramo_cierres WHERE fecha BETWEEN $1 AND $2 AND motivo IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC`, [desde, hasta]),
      query(`SELECT count(DISTINCT x.fecha)::int AS sin_cerrar FROM tramos x
              WHERE x.fecha BETWEEN $1 AND LEAST($2::date, CURRENT_DATE - 1)
                AND NOT EXISTS (SELECT 1 FROM dias_cerrados d WHERE d.fecha = x.fecha)`, [desde, hasta]),
      // tareas terminadas en el periodo con su desviación (horas-persona)
      query(`SELECT t.id, t.nombre, o.codigo AS orden_codigo, p.codigo AS proyecto,
                    (COALESCE(t.duracion_inicial_h, t.duracion_h) * GREATEST(t.operarios_req, 1))::float AS prev_h,
                    (SELECT COALESCE(sum(g.horas), 0) FROM registros g JOIN recursos r ON r.id = g.recurso_id AND r.tipo = 'operario'
                      WHERE g.tarea_id = t.id AND g.tipo = 'productivo')::float AS real_h
               FROM tareas t JOIN ordenes o ON o.id = t.orden_id LEFT JOIN proyectos p ON p.id = o.proyecto_id
              WHERE t.estado = 'hecha' AND t.hecha_en::date BETWEEN $1 AND $2`, [desde, hasta]),
    ]);
    const tot = semanas.reduce((a, s) => ({ cierres: a.cierres + s.cierres, hechos: a.hechos + s.hechos, corregidos: a.corregidos + s.corregidos,
      no_hechos: a.no_hechos + s.no_hechos, plan_h: a.plan_h + s.plan_h, real_h: a.real_h + s.real_h }), { cierres: 0, hechos: 0, corregidos: 0, no_hechos: 0, plan_h: 0, real_h: 0 });
    const desv = desvios.map((d) => ({ ...d, desvio_h: r2(d.real_h - d.prev_h), desvio_pct: d.prev_h ? Math.round(((d.real_h - d.prev_h) / d.prev_h) * 1000) / 10 : null }))
      .sort((a, b) => Math.abs(b.desvio_h) - Math.abs(a.desvio_h));
    res.json({
      desde, hasta, sin_cerrar: dias[0].sin_cerrar,
      total: { ...tot, plan_h: r2(tot.plan_h), real_h: r2(tot.real_h), fiabilidad: tot.cierres ? Math.round((tot.hechos / tot.cierres) * 1000) / 10 : null },
      semanas: semanas.map((s) => ({ ...s, plan_h: r2(s.plan_h), real_h: r2(s.real_h), fiabilidad: s.cierres ? Math.round((s.hechos / s.cierres) * 1000) / 10 : null })),
      motivos: motivos.map((m) => ({ ...m, nombre: MOTIVOS[m.motivo] || m.motivo, horas_perdidas: r2(m.horas_perdidas), horas_desvio: r2(m.horas_desvio) })),
      tareas: desv.slice(0, 15),
      tareas_terminadas: desv.length,
    });
  }));
}

module.exports = { montar };
