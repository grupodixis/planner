// Gantt (Planificación › Gantt): plan por semanas de Proyecto › OT › tareas, a partir de lo planificado en el tablero.
//  · Cada tarea: sus tramos juntados en tramos de días seguidos (segmentos), su clase (propia, taller externo, transporte,
//    subcontrata en obra) y si está hecha. Las de un taller externo sin tramos usan su fecha prevista.
//  · Cada OT: de su primer a su último día planificado, avance, entrega y riesgo:
//      hecha · no_llega (termina después de la entrega) · faltan (horas sin planificar con la entrega en ≤ 21 días)
//      · justo (≤ 2 días laborables de margen) · sin_planificar · a_tiempo · sin_entrega
//  · Carga por semana: oficios (horas-persona / capacidad de sus operarios según su turno, sin festivos ni ausencias de
//    día entero), áreas (horas de reloj / jornada × días), talleres externos (días con trabajo) y subcontratas (horas-persona).
const { query } = require('./db');
const avance = require('./avance');

const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const masDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const lunes = (f) => { const d = new Date(`${f}T12:00:00Z`); return masDias(f, -((d.getUTCDay() + 6) % 7)); };
const finde = (f) => [0, 6].includes(new Date(`${f}T12:00:00Z`).getUTCDay());

// Días seguidos → segmentos (un fin de semana o festivo en medio no corta)
function segmentos(fechas, libres) {
  const fs = [...new Set(fechas)].sort();
  const out = [];
  for (const f of fs) {
    const u = out[out.length - 1];
    if (u) {
      let g = masDias(u[1], 1);
      while (g < f && (finde(g) || libres.has(g))) g = masDias(g, 1);
      if (g >= f) { u[1] = f; continue; }
    }
    out.push([f, f]);
  }
  return out;
}
function laborablesEntre(a, b, libres) { // días laborables de a (excl.) a b (incl.); negativo si b < a
  if (a === b) return 0;
  const sig = b > a ? 1 : -1; let n = 0; let f = a;
  while (f !== b) { f = masDias(f, sig); if (!finde(f) && !libres.has(f)) n += sig; }
  return n;
}

function montar(app, asyncH) {
  app.get('/api/gantt', asyncH(async (req, res) => {
    const hoy = hoyMadrid();
    const desde = lunes(fechaOk(req.query.desde) || masDias(hoy, -7));
    const semanas = Math.min(Math.max(Number(req.query.semanas) || 6, 2), 30);
    const hasta = masDias(desde, semanas * 7 - 1);
    const cerradas = req.query.cerradas === '1';

    const { rows: fest } = await query('SELECT fecha::text AS f FROM festivos WHERE fecha BETWEEN $1 AND $2', [masDias(desde, -400), masDias(hasta, 400)]);
    const libres = new Set(fest.map((x) => x.f));

    const { rows: ots } = await query(
      `SELECT o.id, o.codigo, o.titulo, o.prioridad, o.estado, o.color, o.fecha_entrega::text AS entrega, o.proyecto_id,
              p.codigo AS p_codigo, p.nombre AS p_nombre, p.cliente, p.cliente_id, p.obra_id, ob.nombre AS obra, p.estado AS p_estado
         FROM ordenes o JOIN proyectos p ON p.id = o.proyecto_id LEFT JOIN obras ob ON ob.id = p.obra_id
        WHERE NOT COALESCE(o.baja_presupuesto, false) AND ($1 OR (o.estado <> 'cerrada' AND p.estado = 'activo'))
        ORDER BY p.codigo, o.codigo`, [cerradas]);
    const otIds = ots.map((o) => o.id);
    const { rows: tareas } = otIds.length ? await query(
      `SELECT t.id, t.orden_id, t.codigo, t.nombre, t.estado, t.duracion_h::float AS duracion_h, t.operarios_req, t.proveedor_id, t.ext_en_obra,
              t.ext_fin_prevista::text AS ext_fin, t.ext_estado, pv.nombre AS proveedor, l.nombre AS area, l.tipo AS area_tipo, t.baja_presupuesto,
              (SELECT bool_or(lw.tipo = 'transporte') FROM lineas lw WHERE lw.id = t.linea_id) AS es_transporte, pv.transportista
         FROM tareas t LEFT JOIN proveedores pv ON pv.id = t.proveedor_id LEFT JOIN lineas l ON l.id = t.linea_id
        WHERE t.orden_id = ANY($1) AND NOT t.baja_presupuesto ORDER BY t.orden_id, t.orden_en_of NULLS LAST, t.id`, [otIds]) : { rows: [] };
    const { rows: tramos } = otIds.length ? await query(
      `SELECT x.tarea_id, x.fecha::text AS fecha, x.duracion_h::float AS h FROM tramos x JOIN tareas t ON t.id = x.tarea_id WHERE t.orden_id = ANY($1)`, [otIds]) : { rows: [] };
    const porTarea = new Map();
    for (const x of tramos) { if (!porTarea.has(x.tarea_id)) porTarea.set(x.tarea_id, []); porTarea.get(x.tarea_id).push(x); }
    const av = await avance.resumen({ proyectoIds: [...new Set(ots.map((o) => o.proyecto_id))] }).catch(() => ({ ordenes: {} }));

    const tareasDe = new Map();
    for (const t of tareas) {
      const xs = porTarea.get(t.id) || [];
      const plan_h = xs.reduce((s, x) => s + x.h, 0);
      const clase = t.proveedor_id ? (t.ext_en_obra ? 'sub' : (t.transportista || t.es_transporte ? 'trp' : 'ext')) : 'propia';
      let segs = segmentos(xs.map((x) => x.fecha), libres);
      // taller externo sin tramos: su fecha prevista (lo que dice el taller)
      if (!segs.length && clase !== 'propia' && clase !== 'sub' && t.ext_fin) segs = [[t.ext_fin, t.ext_fin]];
      const externa = t.proveedor_id && !t.ext_en_obra;
      const falta_h = t.estado === 'hecha' || externa ? 0 : Math.max(0, Math.round((t.duracion_h - plan_h) * 10) / 10);
      const x = {
        id: t.id, codigo: t.codigo, nombre: t.nombre, estado: t.estado, clase, hecha: t.estado === 'hecha' || ['terminado', 'entregado'].includes(t.ext_estado),
        area: t.area, proveedor: t.proveedor, segmentos: segs, plan_h, falta_h, ext_fin: t.ext_fin, sin_plan: !segs.length && t.estado !== 'hecha',
        primera: xs.length ? xs.map((y) => y.fecha).sort()[0] : null,
      };
      if (!tareasDe.has(t.orden_id)) tareasDe.set(t.orden_id, []);
      tareasDe.get(t.orden_id).push(x);
    }

    const salida = [];
    for (const o of ots) {
      const ts = tareasDe.get(o.id) || [];
      const ini = ts.flatMap((t) => t.segmentos.map((s) => s[0])).sort()[0] || null;
      const fin = ts.flatMap((t) => t.segmentos.map((s) => s[1])).sort().pop() || null;
      const falta_h = Math.round(ts.reduce((s, t) => s + t.falta_h, 0) * 10) / 10;
      const sinPlan = ts.filter((t) => t.sin_plan && !t.hecha);
      const hecha = o.estado === 'cerrada' || (ts.length && ts.every((t) => t.hecha));
      let riesgo; let txt;
      if (hecha) { riesgo = 'hecha'; txt = '✔ hecha'; }
      else if (o.entrega && o.entrega < hoy) { riesgo = 'no_llega'; txt = `retrasada: la entrega era el ${o.entrega.slice(8, 10)}/${o.entrega.slice(5, 7)}${falta_h ? ` · faltan ${falta_h} h` : ''}`; }
      else if (!ini) { riesgo = 'sin_planificar'; txt = `sin planificar${falta_h ? ` (${falta_h} h)` : ''}`; }
      else if (o.entrega && fin > o.entrega) { riesgo = 'no_llega'; txt = `no llega: termina ${fin.slice(8, 10)}/${fin.slice(5, 7)}${falta_h ? ` y faltan ${falta_h} h` : ''}`; }
      else if (o.entrega && (falta_h > 0 || sinPlan.length) && laborablesEntre(hoy, o.entrega, libres) <= 15) { riesgo = 'faltan'; txt = falta_h ? `faltan ${falta_h} h por planificar` : `${sinPlan.length} tarea(s) sin planificar`; }
      else if (o.entrega && laborablesEntre(fin, o.entrega, libres) <= 2) { const m = laborablesEntre(fin, o.entrega, libres); riesgo = 'justo'; txt = m <= 0 ? 'justo: termina el día de entrega' : `justo: ${m} día${m > 1 ? 's' : ''} de margen`; }
      else if (!o.entrega) { riesgo = 'sin_entrega'; txt = falta_h ? `sin fecha de entrega · faltan ${falta_h} h` : 'sin fecha de entrega'; }
      else { riesgo = 'a_tiempo'; txt = falta_h ? `a tiempo · faltan ${falta_h} h` : 'a tiempo'; }
      salida.push({
        id: o.id, codigo: o.codigo, titulo: o.titulo, prioridad: o.prioridad, color: o.color, entrega: o.entrega, estado: o.estado,
        proyecto: { id: o.proyecto_id, codigo: o.p_codigo, nombre: o.p_nombre, cliente: o.cliente, cliente_id: o.cliente_id, obra: o.obra, obra_id: o.obra_id, estado: o.p_estado },
        inicio: ini, fin, falta_h, riesgo, riesgo_txt: txt, avance: av.ordenes?.[o.id] || null, tareas: ts,
      });
    }

    /* ---- carga por semana ---- */
    const weeks = Array.from({ length: semanas }, (_, i) => masDias(desde, i * 7));
    const semDe = (f) => weeks.findIndex((w) => f >= w && f <= masDias(w, 6));
    const labDe = (w) => Array.from({ length: 7 }, (_, i) => masDias(w, i)).filter((f) => !finde(f) && !libres.has(f));
    const { rows: tr } = await query(
      `SELECT x.id, x.fecha::text AS fecha, x.hora_inicio::float AS ini, x.duracion_h::float AS h, l.id AS linea_id, l.nombre AS area, l.tipo AS area_tipo,
              t.proveedor_id, t.ext_en_obra, t.operarios_req, pv.nombre AS proveedor, pv.transportista
         FROM tramos x JOIN tareas t ON t.id = x.tarea_id LEFT JOIN lineas l ON l.id = x.linea_id LEFT JOIN proveedores pv ON pv.id = t.proveedor_id
        WHERE x.fecha BETWEEN $1 AND $2`, [desde, hasta]);
    const { rows: asig } = await query(
      `SELECT a.tramo_id, r.id AS recurso_id, COALESCE(NULLIF(r.categoria, ''), 'Sin categoría') AS categoria,
              (COALESCE(a.hasta, x.hora_inicio + x.duracion_h) - COALESCE(a.desde, x.hora_inicio))::float AS h, x.fecha::text AS fecha
         FROM tramo_asignaciones a JOIN tramos x ON x.id = a.tramo_id JOIN recursos r ON r.id = a.recurso_id AND r.tipo = 'operario'
        WHERE x.fecha BETWEEN $1 AND $2`, [desde, hasta]);
    const { rows: ops } = await query(
      `SELECT r.id, COALESCE(NULLIF(r.categoria, ''), 'Sin categoría') AS categoria, tu.fin - tu.ini AS jornada
         FROM recursos r JOIN (${require('./horas-extra').SQL_TURNO}) tu ON tu.id = r.id
        WHERE r.tipo = 'operario' AND r.activo`);
    const { rows: aus } = await query(
      `SELECT recurso_id, desde::text AS desde, hasta::text AS hasta FROM ausencias WHERE hora_desde IS NULL AND desde <= $2 AND hasta >= $1`, [desde, hasta]);
    const ausente = (rid, f) => aus.some((a) => a.recurso_id === rid && f >= a.desde && f <= a.hasta);
    const fila = () => ({ h: Array(semanas).fill(0), cap: Array(semanas).fill(0) });
    const oficios = {}; const areas = {}; const talleres = {}; const subcs = {};
    for (const o of ops) {
      oficios[o.categoria] = oficios[o.categoria] || fila();
      weeks.forEach((w, i) => { for (const f of labDe(w)) if (!ausente(o.id, f)) oficios[o.categoria].cap[i] += Number(o.jornada) || 8; });
    }
    for (const a of asig) { const i = semDe(a.fecha); if (i < 0) continue; oficios[a.categoria] = oficios[a.categoria] || fila(); oficios[a.categoria].h[i] += a.h; }
    const jornadaArea = 8;
    const diasTaller = {};
    for (const x of tr) {
      const i = semDe(x.fecha); if (i < 0) continue;
      if (x.area_tipo === 'externo' || (x.proveedor_id && !x.ext_en_obra)) {
        const k = `${x.transportista ? '🚚' : '🏭'} ${x.proveedor || x.area || 'Taller externo'}`;
        talleres[k] = talleres[k] || { h: Array(semanas).fill(0), cap: null };
        const clave = `${k}|${x.fecha}`;
        if (!diasTaller[clave]) { diasTaller[clave] = 1; talleres[k].h[i] += 1; }
        continue;
      }
      if (x.proveedor_id && x.ext_en_obra) {
        const k = `🏗 ${x.proveedor || 'Subcontrata'}`;
        subcs[k] = subcs[k] || { h: Array(semanas).fill(0), cap: null };
        subcs[k].h[i] += x.h * (x.operarios_req || 1);
      }
      const k = x.area || 'Sin área';
      areas[k] = areas[k] || { h: Array(semanas).fill(0), cap: weeks.map((w) => labDe(w).length * jornadaArea), tipo: x.area_tipo };
      areas[k].h[i] += x.h;
    }
    const lista = (o, unidad) => Object.entries(o).map(([nombre, v]) => ({ nombre, unidad, ...v, h: v.h.map((n) => Math.round(n * 10) / 10) }))
      .filter((r) => r.h.some((n) => n > 0))
      .sort((a, b) => b.h.reduce((s, n) => s + n, 0) - a.h.reduce((s, n) => s + n, 0));
    res.json({
      desde, hasta, hoy, semanas: weeks, festivos: [...libres].filter((f) => f >= desde && f <= hasta),
      ots: salida,
      carga: { oficios: lista(oficios, 'h-persona'), areas: lista(areas, 'h'), talleres: lista(talleres, 'días'), subcontratas: lista(subcs, 'h-persona') },
    });
  }));
}

module.exports = { montar };
