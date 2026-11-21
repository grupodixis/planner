// Control de costes y tiempos por proyecto: presupuesto · real · previsión a final · desviación · margen.
//  · Mano de obra real = horas del parte × coste/hora de la persona (el de ese día; si no se guardó, el de su ficha),
//    con recargo en las horas extra (por encima de la jornada en el día, repartidas entre lo que hizo ese día).
//  · Mano de obra presupuestada = la que trae la partida (presupuesto.mano_obra), repartida entre sus tareas por
//    horas-persona presupuestadas; si no la trae, horas-persona presupuestadas × coste/hora medio («estimado»).
//  · Previsión a final de una tarea = real si está hecha; si no, real + horas que faltan × coste/hora (el que lleva
//    la tarea o, si aún no tiene horas, el medio).
//  · Material, maquinaria, subcontratas y otros: presupuesto de la partida; lo real de maquinaria y subcontratas sale
//    del parte (horas × coste/hora); las subcontratas, además, de los pedidos de subcontratación enviados (talleres
//    externos). El material real llegará con los precios de compra (fase 2).
const { query } = require('./db');
const auth = require('./auth');
const { jornada } = require('./config');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const r2 = (x) => Math.round((x || 0) * 100) / 100;
const TIPOS = ['mano_obra', 'material', 'maquinaria', 'subcontratas', 'otros'];
const TIPOS_TXT = { mano_obra: 'Mano de obra', material: 'Material', maquinaria: 'Maquinaria', subcontratas: 'Subcontratas y alquileres', otros: 'Otros gastos' };

async function ajustes() {
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'costes'`);
  return { recargo_extra: 0.5, ...(rows[0]?.valor || {}) };
}

// coste/hora medio de los operarios activos con coste (para presupuestar y prever lo que no tiene horas aún)
async function costeMedio() {
  const { rows } = await query(`SELECT avg(coste_hora)::float AS m FROM recursos WHERE tipo = 'operario' AND activo AND coste_hora > 0`);
  return rows[0].m || 0;
}

// Horas y coste reales por tarea y recurso (con el recargo de horas extra)
async function realesDe(proyectoIds, recargo) {
  const { rows } = await query(
    `WITH dia AS (SELECT recurso_id, fecha, sum(horas)::float AS tot FROM registros GROUP BY 1, 2)
     SELECT g.tarea_id, g.recurso_id, r.nombre, r.tipo, r.vinculo,
            sum(g.horas)::float AS h,
            sum(g.horas * GREATEST(0, d.tot - $2) / d.tot)::float AS h_extra,
            sum(g.horas * COALESCE(g.coste_hora, r.coste_hora) * (1 + $3 * GREATEST(0, d.tot - $2) / d.tot))::float AS coste,
            bool_or(COALESCE(g.coste_hora, r.coste_hora) IS NULL) AS sin_coste,
            min(g.fecha) AS desde, max(g.fecha) AS hasta
       FROM registros g
       JOIN recursos r ON r.id = g.recurso_id
       JOIN dia d ON d.recurso_id = g.recurso_id AND d.fecha = g.fecha
       JOIN tareas t ON t.id = g.tarea_id JOIN ordenes o ON o.id = t.orden_id
      WHERE g.tipo = 'productivo' AND o.proyecto_id = ANY($1)
      GROUP BY 1, 2, 3, 4, 5`, [proyectoIds, jornada.horas, recargo]);
  return rows;
}

function vacio() {
  const t = {};
  for (const k of TIPOS) t[k] = { presup: 0, real: 0, prevision: 0 };
  return { horas_presup: 0, horas_est: 0, horas_real: 0, horas_extra: 0, horas_falta: 0, ganado: 0, tipos: t,
    tareas: 0, hechas: 0, sin_coste: false, mo_estimado: false, pvp: null };
}
function sumar(a, b) {
  for (const k of ['horas_presup', 'horas_est', 'horas_real', 'horas_extra', 'horas_falta', 'ganado', 'tareas', 'hechas']) a[k] += b[k];
  for (const k of TIPOS) for (const c of ['presup', 'real', 'prevision']) a.tipos[k][c] += b.tipos[k][c];
  a.sin_coste ||= b.sin_coste; a.mo_estimado ||= b.mo_estimado;
  if (b.pvp != null) a.pvp = (a.pvp || 0) + b.pvp;
  return a;
}
// totales, desviación, avance frente a gastado y margen
function cerrar(x) {
  const out = { ...x, tipos: {} };
  let presup = 0, real = 0, prevision = 0;
  for (const k of TIPOS) {
    const t = x.tipos[k];
    out.tipos[k] = { presup: r2(t.presup), real: r2(t.real), prevision: r2(t.prevision), desvio: r2(t.prevision - t.presup) };
    presup += t.presup; real += t.real; prevision += t.prevision;
  }
  for (const k of ['horas_presup', 'horas_est', 'horas_real', 'horas_extra', 'horas_falta', 'ganado']) out[k] = r2(x[k]);
  out.presup = r2(presup); out.real = r2(real); out.prevision = r2(prevision);
  out.desvio = r2(prevision - presup);
  out.desvio_pct = presup ? Math.round(((prevision - presup) / presup) * 1000) / 10 : null;
  const mo = x.tipos.mano_obra;
  // avance (valor del trabajo hecho sobre lo presupuestado) frente a lo gastado de mano de obra
  out.avance_pct = mo.presup ? Math.round((x.ganado / mo.presup) * 1000) / 10 : null;
  out.gastado_pct = mo.presup ? Math.round((mo.real / mo.presup) * 1000) / 10 : null;
  if (x.pvp != null) {
    out.pvp = r2(x.pvp);
    out.margen_presup = r2(x.pvp - presup);
    out.margen_prev = r2(x.pvp - prevision);
    out.margen_prev_pct = x.pvp ? Math.round(((x.pvp - prevision) / x.pvp) * 1000) / 10 : null;
  }
  return out;
}

// Todo un proyecto (o varios): partidas › OTs › tareas › personas, con las cifras ya calculadas
async function calcular(proyectoIds) {
  const aj = await ajustes();
  const media = await costeMedio();
  const [{ rows: partidas }, { rows: tareas }, reales] = await Promise.all([
    query(`SELECT id, proyecto_id, codigo, nombre, orden, pvp::float AS pvp, presupuesto
             FROM partidas WHERE proyecto_id = ANY($1) ORDER BY orden, codigo`, [proyectoIds]),
    query(`SELECT t.id, t.nombre, t.estado, t.orden_id, t.baja_presupuesto,
                  o.codigo AS ot_codigo, o.titulo AS ot_titulo, o.estado AS ot_estado, o.partida_id, o.proyecto_id,
                  (CASE WHEN t.proveedor_id IS NOT NULL THEN 0 ELSE GREATEST(t.operarios_req, 1) END) AS ops,
                  COALESCE(t.duracion_inicial_h, t.duracion_h)::float AS prev_dur, t.duracion_h::float AS est_dur
             FROM tareas t JOIN ordenes o ON o.id = t.orden_id
            WHERE o.proyecto_id = ANY($1) ORDER BY o.codigo, t.orden_en_of, t.id`, [proyectoIds]),
    realesDe(proyectoIds, Number(aj.recargo_extra) || 0),
  ]);
  const subPedidos = await require('./subcontratacion').costePorTarea(tareas.map((t) => t.id));
  const transp = await require('./transportes').costePorTarea(tareas.map((t) => t.id));
  const locales = await require('./compras-locales').costePorTarea(tareas.map((t) => t.id));
  const porTarea = new Map();
  for (const r of reales) {
    if (!porTarea.has(r.tarea_id)) porTarea.set(r.tarea_id, []);
    porTarea.get(r.tarea_id).push(r);
  }
  // horas-persona presupuestadas por partida (para repartir su mano de obra entre sus tareas)
  const hPartida = new Map();
  for (const t of tareas) hPartida.set(t.partida_id, (hPartida.get(t.partida_id) || 0) + t.prev_dur * t.ops);
  const pa = new Map(partidas.map((p) => [p.id, p]));

  const filasTarea = tareas.map((t) => {
    const x = vacio();
    const rs = porTarea.get(t.id) || [];
    const ops = rs.filter((r) => r.tipo === 'operario');
    const hReal = ops.reduce((s, r) => s + r.h, 0);
    const cReal = ops.reduce((s, r) => s + (r.coste || 0), 0);
    x.horas_presup = t.prev_dur * t.ops;
    x.horas_est = t.est_dur * t.ops;
    x.horas_real = hReal;
    x.horas_extra = ops.reduce((s, r) => s + r.h_extra, 0);
    x.tareas = 1;
    x.hechas = t.estado === 'hecha' ? 1 : 0;
    x.sin_coste = rs.some((r) => r.sin_coste);
    // mano de obra presupuestada
    const p = pa.get(t.partida_id);
    const moPartida = typeof p?.presupuesto?.mano_obra === 'number' ? p.presupuesto.mano_obra : null;
    if (moPartida != null && hPartida.get(t.partida_id)) x.tipos.mano_obra.presup = moPartida * (x.horas_presup / hPartida.get(t.partida_id));
    else { x.tipos.mano_obra.presup = x.horas_presup * media; x.mo_estimado = true; }
    if (t.baja_presupuesto) x.tipos.mano_obra.presup = 0;
    // real y previsión
    x.tipos.mano_obra.real = cReal;
    const tarifa = hReal ? cReal / hReal : media;
    const falta = t.estado === 'hecha' ? 0 : Math.max(0, x.horas_est - hReal);
    x.horas_falta = falta;
    x.tipos.mano_obra.prevision = cReal + falta * tarifa;
    // terminada sin horas en el parte: no hay dato real; se prevé lo presupuestado (no es un ahorro)
    if (t.estado === 'hecha' && !hReal) x.tipos.mano_obra.prevision = x.tipos.mano_obra.presup;
    for (const r of rs) {
      if (r.tipo === 'maquina') x.tipos.maquinaria.real += r.coste || 0;
      if (r.tipo === 'subcontrata') x.tipos.subcontratas.real += r.coste || 0;
    }
    // pedidos de subcontratación enviados (talleres externos): comprometido
    x.tipos.subcontratas.real += subPedidos.get(t.id) || 0;
    // envíos a Menorca (coste del transporte repartido por kg o a mano)
    x.tipos.subcontratas.real += transp.get(t.id) || 0;
    // compras locales (ferretería…) con su ticket: material de la tarea
    x.tipos.material.real += locales.get(t.id) || 0;
    // valor de lo hecho: hecha = todo lo presupuestado; en curso = proporción de horas (hasta el 90 %)
    const frac = t.estado === 'hecha' ? 1 : x.horas_est ? Math.min(0.9, hReal / x.horas_est) : 0;
    x.ganado = x.tipos.mano_obra.presup * frac;
    const personas = ops.map((r) => ({ id: r.recurso_id, nombre: r.nombre, vinculo: r.vinculo, h: r2(r.h), h_extra: r2(r.h_extra), coste: r2(r.coste), sin_coste: r.sin_coste }))
      .sort((a, b) => b.h - a.h);
    return { ...t, x, personas };
  });

  // Partidas: presupuesto del resto de tipos (solo a nivel de partida) y su previsión
  const grupos = [...partidas, ...proyectoIds.map((pid) => ({ id: null, proyecto_id: pid, codigo: '', nombre: 'Sin partida', pvp: null, presupuesto: {} }))].map((p) => {
    const suyas = filasTarea.filter((t) => (t.partida_id || null) === p.id && t.proyecto_id === p.proyecto_id);
    const ots = new Map();
    for (const t of suyas) {
      if (!ots.has(t.orden_id)) ots.set(t.orden_id, { id: t.orden_id, codigo: t.ot_codigo, titulo: t.ot_titulo, estado: t.ot_estado, x: vacio(), tareas: [] });
      const o = ots.get(t.orden_id);
      sumar(o.x, t.x);
      o.tareas.push(t);
    }
    const x = suyas.reduce((a, t) => sumar(a, t.x), vacio());
    const pres = p.presupuesto || {};
    for (const k of TIPOS.slice(1)) {
      if (typeof pres[k] === 'number') x.tipos[k].presup = pres[k];
      // lo que aún no se lleva de verdad (material, otros) se prevé por lo presupuestado
      x.tipos[k].prevision = Math.max(x.tipos[k].real, x.tipos[k].presup);
    }
    x.pvp = p.pvp;
    return { ...p, x, ots: [...ots.values()] };
  }).filter((g) => g.id || g.ots.length);
  return { grupos, media, ajustes: aj };
}

// Avisos de un proyecto ya calculado
function avisos(grupos) {
  const out = [];
  const eur = (v) => `${Math.round(v).toLocaleString('es-ES')} €`;
  for (const g of grupos) {
    const c = cerrar(g.x);
    const nom = `${g.codigo ? `${g.codigo} · ` : ''}${g.nombre}`;
    if (g.id && g.pvp == null) out.push({ nivel: 'info', partida: g.id, texto: `${nom}: sin PVP; no se puede calcular el margen.` });
    if (c.gastado_pct != null && c.avance_pct != null && c.gastado_pct > 10 && c.gastado_pct > c.avance_pct + 15) {
      out.push({ nivel: 'mal', partida: g.id, texto: `${nom}: llevamos gastado el ${c.gastado_pct} % de la mano de obra con un avance del ${c.avance_pct} %.` });
    }
    const mo = c.tipos.mano_obra;
    if (mo.presup && mo.prevision > mo.presup * 1.1) out.push({ nivel: 'mal', partida: g.id, texto: `${nom}: la mano de obra acabará en ${eur(mo.prevision)}, ${eur(mo.prevision - mo.presup)} por encima de lo presupuestado.` });
    if (c.margen_prev != null && c.margen_prev < 0) out.push({ nivel: 'mal', partida: g.id, texto: `${nom}: con la previsión actual, la partida da pérdidas (${eur(c.margen_prev)}).` });
    for (const o of g.ots) {
      for (const t of o.tareas) {
        if (t.x.horas_real > t.x.horas_est + 0.01 && t.x.horas_est) {
          out.push({ nivel: 'aviso', partida: g.id, ot: o.id, tarea: t.id, texto: `${o.codigo} · ${t.nombre}: ${r2(t.x.horas_real)} h reales de ${r2(t.x.horas_est)} h estimadas.` });
        }
      }
    }
  }
  return out;
}

function montar(app, asyncH) {
  const puede = auth.permiso('costes');

  app.get('/api/costes/ajustes', puede, asyncH(async (req, res) => res.json({ ...(await ajustes()), coste_medio: r2(await costeMedio()), jornada_h: jornada.horas })));
  app.put('/api/costes/ajustes', puede, asyncH(async (req, res) => {
    const rec = Number(req.body?.recargo_extra);
    if (!Number.isFinite(rec) || rec < 0 || rec > 3) throw fallo(400, 'El recargo de la hora extra va de 0 % a 300 %');
    const v = { ...(await ajustes()), recargo_extra: rec };
    await query(`INSERT INTO ajustes (clave, valor) VALUES ('costes', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(v)]);
    res.json(v);
  }));

  /* ---------- Todos los proyectos ---------- */
  app.get('/api/costes/proyectos', puede, asyncH(async (req, res) => {
    const { rows: proyectos } = await query(`SELECT id, codigo, nombre, cliente, estado FROM proyectos ORDER BY (estado = 'activo') DESC, codigo`);
    const { grupos, ajustes: aj, media } = await calcular(proyectos.map((p) => p.id));
    res.json({
      ajustes: aj, coste_medio: r2(media),
      proyectos: proyectos.map((p) => {
        const gs = grupos.filter((g) => g.proyecto_id === p.id);
        const x = gs.reduce((a, g) => sumar(a, g.x), vacio());
        return { ...p, cifras: cerrar(x), avisos: avisos(gs).filter((a) => a.nivel === 'mal').length };
      }),
    });
  }));

  /* ---------- Un proyecto ---------- */
  app.get('/api/costes/proyecto/:id', puede, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: pr } = await query('SELECT id, codigo, nombre, cliente, obra, estado FROM proyectos WHERE id = $1', [id]);
    if (!pr.length) throw fallo(404, 'Proyecto no encontrado');
    const { grupos, ajustes: aj, media } = await calcular([id]);
    const total = grupos.reduce((a, g) => sumar(a, g.x), vacio());
    // por persona: horas, extra y coste en este proyecto, y en qué partidas
    const personas = new Map();
    for (const g of grupos) for (const o of g.ots) for (const t of o.tareas) for (const p of t.personas) {
      if (!personas.has(p.id)) personas.set(p.id, { id: p.id, nombre: p.nombre, vinculo: p.vinculo, h: 0, h_extra: 0, coste: 0, sin_coste: false, partidas: new Map() });
      const q = personas.get(p.id);
      q.h += p.h; q.h_extra += p.h_extra; q.coste += p.coste; q.sin_coste ||= p.sin_coste;
      const k = g.id || 0;
      q.partidas.set(k, { codigo: g.codigo, nombre: g.nombre, h: (q.partidas.get(k)?.h || 0) + p.h, coste: (q.partidas.get(k)?.coste || 0) + p.coste });
    }
    res.json({
      proyecto: pr[0], ajustes: aj, coste_medio: r2(media), tipos: TIPOS_TXT,
      total: cerrar(total),
      avisos: avisos(grupos),
      partidas: grupos.map((g) => ({
        id: g.id, codigo: g.codigo, nombre: g.nombre, presupuesto: g.presupuesto || {}, pvp_fijado: g.pvp, cifras: cerrar(g.x),
        ots: g.ots.map((o) => ({
          id: o.id, codigo: o.codigo, titulo: o.titulo, estado: o.estado, cifras: cerrar(o.x),
          tareas: o.tareas.map((t) => ({ id: t.id, nombre: t.nombre, estado: t.estado, ops: t.ops, baja: t.baja_presupuesto, cifras: cerrar(t.x), personas: t.personas })),
        })),
      })),
      personas: [...personas.values()].map((p) => ({ ...p, h: r2(p.h), h_extra: r2(p.h_extra), coste: r2(p.coste), partidas: [...p.partidas.values()].map((x) => ({ ...x, h: r2(x.h), coste: r2(x.coste) })) }))
        .sort((a, b) => b.coste - a.coste),
    });
  }));

  /* ---------- PVP y presupuesto de una partida (a mano) ---------- */
  app.put('/api/costes/partida/:id', puede, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const num = (v) => (v === '' || v == null ? null : Number(v));
    const pvp = num(b.pvp);
    if (pvp != null && (!Number.isFinite(pvp) || pvp < 0)) throw fallo(400, 'PVP no válido');
    const pres = {};
    for (const k of TIPOS) {
      const v = num(b.presupuesto?.[k]);
      if (v == null) continue;
      if (!Number.isFinite(v) || v < 0) throw fallo(400, `${TIPOS_TXT[k]}: importe no válido`);
      pres[k] = v;
    }
    const { rowCount } = await query('UPDATE partidas SET pvp = $2, presupuesto = $3 WHERE id = $1', [id, pvp, JSON.stringify(pres)]);
    if (!rowCount) throw fallo(404, 'Partida no encontrada');
    res.json({ ok: true });
  }));
}

module.exports = { montar };
