// Planificar una OT de una vez, moverla entera y deshacer lo hecho.
//  · PLANIFICAR OT: coloca en el cuadrante las horas pendientes de sus tareas, en orden de dependencias (con sus esperas),
//    en el área de cada tarea, dentro de la jornada, saltando fines de semana y festivos y sin pisar lo que ya ocupa un
//    puesto «de uno en uno» (exclusivo). Dos modos: «Empezar el…» (hacia delante) o «Terminar como tarde el…» (busca el
//    inicio más tardío que llega). Primero es una PROPUESTA (no toca nada; se puede ajustar: «esta tarea no antes del…»),
//    y al confirmarla se crean los tramos (sin gente: se asigna en el cuadrante).
//  · MOVER OT: desplaza N días laborables sus tramos de hoy en adelante que no tengan horas reales ni cierre. La gente
//    que ese día falta o ya está en otra cosa se quita del tramo (y se recuerda para deshacer).
//  · Cada planificación o movimiento queda en `planificaciones` con lo necesario para DESHACERLO: quitar los tramos que
//    creó (o devolverlos a su sitio). Lo que alguien ha cambiado después se puede dejar o incluir; lo que ya tiene horas
//    reales o cierre no se toca nunca.
const { query, tx } = require('./db');
const auth = require('./auth');
const { jornada } = require('./config');
const extras = require('./horas-extra');
const { ausenciasEnRango, festivosEnRango, ausenciasPorDia } = require('./ausencias');

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const DIA = 864e5;
const num = (f) => Math.floor(Date.parse(`${f}T12:00:00Z`) / DIA);            // día → número
const fecha = (n) => new Date(n * DIA).toISOString().slice(0, 10);            // número → día
const finde = (f) => { const w = new Date(`${f}T12:00:00Z`).getUTCDay(); return w === 0 || w === 6; };
const dm = (f) => `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}`;
const DSEM = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const dsem = (f) => `${DSEM[new Date(`${f}T12:00:00Z`).getUTCDay()]} ${dm(f)}`;
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const medias = (h) => Math.ceil(h * 2 - 1e-9) / 2;
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const r1 = (x) => Math.round(x * 10) / 10;
const LOCK = 74231;   // un solo «planificar / mover / deshacer» a la vez

/* ---------- calendario ---------- */
async function calendario(c, desde, hasta) {
  const fest = new Set((await festivosEnRango(c, desde, hasta)).map((f) => f.fecha));
  const lab = (f) => !finde(f) && !fest.has(f);
  // el momento laborable más temprano a partir de t (t = día·24 + hora)
  const normal = (t) => {
    let d = Math.floor(t / 24); let h = t - d * 24;
    if (h < jornada.inicio) h = jornada.inicio;
    if (h >= jornada.fin - 1e-9) { d++; h = jornada.inicio; }
    while (!lab(fecha(d))) { d++; h = jornada.inicio; }
    return d * 24 + h;
  };
  // n días laborables después (o antes, si n < 0) de f
  const sumarLab = (f, n) => { let d = num(f); let k = Math.abs(n); const p = Math.sign(n); while (k > 0) { d += p; if (lab(fecha(d))) k--; } return fecha(d); };
  const labEntre = (a, b) => { let n = 0; for (let d = num(a) + 1; d <= num(b); d++) if (lab(fecha(d))) n++; return n; };
  return { fest, lab, normal, sumarLab, labEntre };
}

/* ---------- datos de la OT ---------- */
async function leerOT(c, ordenId) {
  const r = await leerOTs(c, [ordenId]);
  return { ...r, ot: r.ots[0] };
}
async function leerOTs(c, ordenIds) {
  const { rows: o } = await c.query(
    `SELECT o.id, o.codigo, o.titulo, o.estado, o.fecha_entrega::text AS entrega, o.proyecto_id, p.codigo AS proyecto
       FROM ordenes o LEFT JOIN proyectos p ON p.id = o.proyecto_id WHERE o.id = ANY($1)
      ORDER BY o.codigo`, [ordenIds]);
  if (!o.length) throw fallo(404, 'OT no encontrada');
  const { rows: tareas } = await c.query(
    `SELECT t.id, t.orden_id, t.codigo, t.nombre, t.duracion_h::float AS duracion_h, GREATEST(COALESCE(t.operarios_req, 1), 1) AS personas,
            t.linea_id, l.nombre AS area, l.exclusiva, t.estado, t.orden_en_of, t.proveedor_id, t.ext_en_obra,
            pv.nombre AS proveedor, COALESCE(t.baja_presupuesto, false) AS baja, t.ext_fin_prevista::text AS ext_fin,
            COALESCE((SELECT sum(x.duracion_h) FROM tramos x WHERE x.tarea_id = t.id), 0)::float AS planificadas,
            (SELECT json_build_object('fecha', x.fecha::text, 'hora', x.hora_inicio + x.duracion_h) FROM tramos x
              WHERE x.tarea_id = t.id ORDER BY x.fecha DESC, x.hora_inicio + x.duracion_h DESC LIMIT 1) AS ultimo
       FROM tareas t LEFT JOIN lineas l ON l.id = t.linea_id LEFT JOIN proveedores pv ON pv.id = t.proveedor_id
      WHERE t.orden_id = ANY($1) ORDER BY array_position($2::int[], t.orden_id), t.orden_en_of NULLS LAST, t.id`, [o.map((x) => x.id), o.map((x) => x.id)]);
  const ids = tareas.map((t) => t.id);
  const { rows: deps } = ids.length ? await c.query(
    `SELECT d.tarea_id, d.depende_de_id, COALESCE(d.espera_h, 0)::float AS espera_h, p.codigo, p.nombre, p.orden_id, p.estado,
            p.ext_fin_prevista::text AS ext_fin, (SELECT codigo FROM ordenes WHERE id = p.orden_id) AS orden_codigo,
            (SELECT json_build_object('fecha', x.fecha::text, 'hora', x.hora_inicio + x.duracion_h) FROM tramos x
              WHERE x.tarea_id = p.id ORDER BY x.fecha DESC, x.hora_inicio + x.duracion_h DESC LIMIT 1) AS ultimo
       FROM tarea_dependencias d JOIN tareas p ON p.id = d.depende_de_id
      WHERE d.tarea_id = ANY($1) OR d.depende_de_id = ANY($1)`, [ids]) : { rows: [] };
  return { ots: o, tareas, deps };
}

// Qué OTs entran: una OT, las de una partida o las de un proyecto (abiertas)
async function resolverAlcance(c, alcance) {
  const tipo = ['ot', 'partida', 'proyecto'].includes(alcance?.tipo) ? alcance.tipo : 'ot';
  const id = Number(alcance?.id);
  if (!id) throw fallo(400, 'Falta qué planificar');
  if (tipo === 'ot') {
    const { rows } = await c.query('SELECT id, codigo, titulo, estado FROM ordenes WHERE id = $1', [id]);
    if (!rows.length) throw fallo(404, 'OT no encontrada');
    if (rows[0].estado === 'cerrada') throw fallo(409, 'La OT está cerrada');
    return { tipo, id, nombre: `OT ${rows[0].codigo}`, ids: [id] };
  }
  const { rows: cab } = tipo === 'partida'
    ? await c.query(`SELECT pa.id, COALESCE(NULLIF(pa.codigo, '') || ' · ', '') || pa.nombre AS nombre, pr.codigo AS proyecto FROM partidas pa JOIN proyectos pr ON pr.id = pa.proyecto_id WHERE pa.id = $1`, [id])
    : await c.query('SELECT id, codigo || \' · \' || nombre AS nombre FROM proyectos WHERE id = $1', [id]);
  if (!cab.length) throw fallo(404, tipo === 'partida' ? 'Partida no encontrada' : 'Proyecto no encontrado');
  const { rows } = await c.query(
    `SELECT id FROM ordenes WHERE ${tipo === 'partida' ? 'partida_id' : 'proyecto_id'} = $1 AND estado <> 'cerrada' AND NOT COALESCE(baja_presupuesto, false)`, [id]);
  if (!rows.length) throw fallo(409, `No hay OTs abiertas en ${tipo === 'partida' ? 'esta partida' : 'este proyecto'}`);
  return { tipo, id, nombre: `${tipo === 'partida' ? 'partida' : 'proyecto'} ${cab[0].nombre}`, ids: rows.map((r) => r.id) };
}

/* ---------- PROPUESTA ---------- */
// op: { modo: 'inicio' | 'fin', fecha, ajustes: { tareaId: 'YYYY-MM-DD' (no antes de) }, areas: { tareaId: lineaId } }
async function proponer(c, alcance, op) {
  if (typeof alcance === 'number') alcance = { tipo: 'ot', id: alcance };
  const alc = await resolverAlcance(c, alcance);
  const hoy = hoyMadrid();
  if (!FECHA_RE.test(op.fecha || '')) throw fallo(400, 'Fecha no válida');
  const modo = op.modo === 'fin' ? 'fin' : 'inicio';
  if (modo === 'inicio' && op.fecha < hoy) throw fallo(400, 'La fecha de inicio ya ha pasado');
  if (modo === 'fin' && op.fecha < hoy) throw fallo(400, 'Esa fecha ya ha pasado');
  const ajustes = {};
  for (const [k, v] of Object.entries(op.ajustes || {})) if (FECHA_RE.test(v)) ajustes[Number(k)] = v;
  const sinEsperar = !!op.sinEsperar;   // colocar aunque una previa no esté planificada
  const areasElegidas = {};
  for (const [k, v] of Object.entries(op.areas || {})) if (Number(v) > 0) areasElegidas[Number(k)] = Number(v);

  const { ots, tareas, deps } = await leerOTs(c, alc.ids);
  const ot = ots[0];
  const { rows: lineas } = await c.query(
    `SELECT id, nombre, exclusiva, tipo, proveedor_id FROM lineas WHERE activo AND (obra_id IS NULL OR obra_id IN
       (SELECT obra_id FROM proyectos WHERE id = $1)) ORDER BY orden, nombre`, [ot.proyecto_id]);
  const lineaDe = new Map(lineas.map((l) => [l.id, l]));

  // tareas a colocar: no hechas, con horas pendientes
  const porId = new Map(tareas.map((t) => [t.id, t]));
  const avisos = []; const sinArea = [];
  const aColocar = [];
  for (const t of tareas) {
    if (t.estado === 'hecha' || t.baja) continue;
    const pend = medias(t.duracion_h - t.planificadas);
    if (pend <= 0) continue;
    const linea = areasElegidas[t.id] ? lineaDe.get(areasElegidas[t.id]) : t.linea_id ? { id: t.linea_id, nombre: t.area, exclusiva: t.exclusiva } : null;
    if (!linea) { sinArea.push({ id: t.id, codigo: t.codigo, nombre: t.nombre, horas: pend }); continue; }
    aColocar.push({ ...t, pend, linea });
  }
  if (!aColocar.length && !sinArea.length) throw fallo(409, `No queda nada por planificar en ${alc.tipo === 'ot' ? ot.codigo : `la ${alc.nombre}`}: todas sus tareas están planificadas o hechas`);

  // orden: dependencias primero (dentro de la OT), luego el orden de la OT
  const previas = new Map(); // tarea → [{id, espera}]
  for (const d of deps) {
    if (!porId.has(d.tarea_id)) continue;
    if (!previas.has(d.tarea_id)) previas.set(d.tarea_id, []);
    previas.get(d.tarea_id).push(d);
  }
  const orden = []; const visto = new Set(); const enCurso = new Set();
  const visitar = (t) => {
    if (visto.has(t.id)) return;
    if (enCurso.has(t.id)) return; // ciclo: se ignora
    enCurso.add(t.id);
    for (const d of previas.get(t.id) || []) if (porId.has(d.depende_de_id)) visitar(porId.get(d.depende_de_id));
    enCurso.delete(t.id); visto.add(t.id); orden.push(t);
  };
  for (const t of tareas) visitar(t);
  const colocar = new Map(aColocar.map((t) => [t.id, t]));

  // calendario y ocupación de los puestos exclusivos
  const horizonte = fecha(num(op.fecha) + 400);
  const desdeCal = fecha(Math.min(num(hoy), num(op.fecha)) - 400);
  const cal = await calendario(c, desdeCal, horizonte);
  const exclusivas = [...new Set(aColocar.filter((t) => t.linea.exclusiva).map((t) => t.linea.id))];
  const ocupado = new Map(); // `${linea}|${fecha}` → [[a, b]]
  if (exclusivas.length) {
    const { rows } = await c.query(
      `SELECT linea_id, fecha::text AS fecha, hora_inicio::float AS a, (hora_inicio + duracion_h)::float AS b
         FROM tramos WHERE linea_id = ANY($1) AND fecha >= $2`, [exclusivas, hoy]);
    for (const r of rows) { const k = `${r.linea_id}|${r.fecha}`; if (!ocupado.has(k)) ocupado.set(k, []); ocupado.get(k).push([r.a, r.b]); }
  }
  const tUlt = (u) => (u ? num(u.fecha) * 24 + Number(u.hora) : null);
  const BLOQ = -1;   // previa sin planificar: lo que va detrás no se coloca
  const [hh0, mm0] = new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).split(':').map(Number);
  const ahoraH = hh0 + mm0 / 60;
  const ahora = num(hoy) * 24 + ahoraH;

  // una pasada hacia delante desde el día S
  const pasada = (S) => {
    const occ = new Map([...ocupado].map(([k, v]) => [k, v.map((x) => [...x])]));
    const fin = new Map(); const res = new Map(); const notas = []; const bloqueadas = []; const bloqueo = new Map();
    for (const t of orden) {
      // fin de las previas: lo propuesto, su último tramo ya planificado o lo que ha dicho el taller (fecha prevista).
      // Una previa sin hacer cuyo plan ya pasó no puede acabar antes de ahora; una sin planificar BLOQUEA (salvo «sin esperar»).
      let t0 = null; let porDep = null; let espera = null;
      const ct = colocar.get(t.id);
      for (const d of previas.get(t.id) || []) {
        const p = porId.get(d.depende_de_id);
        const est = p ? p.estado : d.estado;
        let f = fin.get(d.depende_de_id);
        if (f === undefined) {
          f = tUlt((p || d).ultimo);
          const ext = (p || d).ext_fin;
          if (ext && est !== 'hecha') { const fe = num(ext) * 24 + jornada.fin; if (f == null || fe > f) f = fe; }
          if (f != null && est !== 'hecha' && f < ahora) { if (ct && f < num(hoy) * 24) notas.push({ tipo: 'retraso', t, d, p, hasta: f }); f = ahora; }
        }
        if (f == null || f === BLOQ) {
          if (est === 'hecha') continue;
          if (!sinEsperar) { espera = espera || (bloqueo.get(d.depende_de_id) || d); continue; }
          if (ct) notas.push({ tipo: 'dep', t, d });
          continue;
        }
        const x = f + d.espera_h; if (t0 == null || x > t0) { t0 = x; porDep = { ...d, fin: f }; }
      }
      if (espera) { fin.set(t.id, BLOQ); bloqueo.set(t.id, espera); if (ct) bloqueadas.push({ t, ct, espera }); continue; }
      if (!ct) {
        const u = tUlt(t.ultimo);
        if (t.estado === 'hecha') fin.set(t.id, u);
        else if (u == null && sinArea.some((x) => x.id === t.id)) fin.set(t.id, null);
        else fin.set(t.id, u == null ? null : Math.max(u, ahora));
        continue;
      }
      const aj = ajustes[t.id];
      let base = aj ? num(aj) * 24 + jornada.inicio : S * 24 + jornada.inicio;
      if (aj && t0 != null && t0 > base) notas.push({ tipo: 'ajuste', t, d: porDep, desde: t0 });
      if (t0 != null && t0 > base) base = t0;
      if (t.ultimo && tUlt(t.ultimo) > base) base = tUlt(t.ultimo);
      let tt = cal.normal(base);
      const deseado = Math.floor(tt / 24);
      let rem = ct.pend; const tramos = []; let vueltas = 0;
      while (rem > 1e-9 && vueltas++ < 400) {
        const d = Math.floor(tt / 24); const h = tt - d * 24; const f = fecha(d);
        let libres = [[h, jornada.fin]];
        if (ct.linea.exclusiva) {
          const busy = (occ.get(`${ct.linea.id}|${f}`) || []).slice().sort((a, b) => a[0] - b[0]);
          libres = [];
          let cur = h;
          for (const [a, b] of busy) { if (b <= cur) continue; if (a > cur) libres.push([cur, Math.min(a, jornada.fin)]); cur = Math.max(cur, b); if (cur >= jornada.fin) break; }
          if (cur < jornada.fin) libres.push([cur, jornada.fin]);
        }
        for (const [a, b] of libres) {
          const a2 = Math.ceil(a * 2 - 1e-9) / 2; const hueco = Math.floor((b - a2) * 2 + 1e-9) / 2;
          if (hueco < 0.5) continue;
          const dur = Math.min(rem, hueco);
          tramos.push({ fecha: f, hora_inicio: a2, duracion_h: dur, linea_id: ct.linea.id });
          if (ct.linea.exclusiva) { const k = `${ct.linea.id}|${f}`; if (!occ.has(k)) occ.set(k, []); occ.get(k).push([a2, a2 + dur]); }
          rem = medias(rem - dur);
          if (rem <= 0) break;
        }
        tt = cal.normal((d + 1) * 24);
      }
      const ult = tramos[tramos.length - 1];
      fin.set(t.id, ult ? num(ult.fecha) * 24 + ult.hora_inicio + ult.duracion_h : base);
      res.set(t.id, { tras: porDep && t0 != null && Math.floor(t0 / 24) >= deseado ? porDep : null, tramos, deseado, ocupadoHasta: tramos[0] && num(tramos[0].fecha) > deseado && ct.linea.exclusiva ? tramos[0].fecha : null, sinHueco: rem > 0 });
    }
    let maxFin = null;
    for (const [, r] of res) for (const x of r.tramos) if (!maxFin || x.fecha > maxFin) maxFin = x.fecha;
    return { res, notas, fin: maxFin, bloqueadas };
  };

  // modo «terminar como tarde»: el inicio más tardío (en días laborables) con el que todo acaba ese día o antes
  let S; let noLlega = null;
  if (modo === 'inicio') S = num(op.fecha);
  else {
    const dias = []; for (let d = num(hoy); d <= num(op.fecha); d++) if (cal.lab(fecha(d))) dias.push(d);
    if (!dias.length) throw fallo(400, 'No hay días laborables hasta esa fecha');
    const llega = (d) => { const p = pasada(d); return !p.fin || p.fin <= op.fecha; };
    if (!llega(dias[0])) { S = dias[0]; noLlega = true; }
    else { let lo = 0; let hi = dias.length - 1; while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (llega(dias[m])) lo = m; else hi = m - 1; } S = dias[lo]; }
  }
  const p = pasada(S);

  // resultado
  const out = []; let horas = 0; let nTramos = 0; let ini = null;
  for (const t of orden) {
    const r = p.res.get(t.id); if (!r) continue;
    const ct = colocar.get(t.id);
    horas += ct.pend; nTramos += r.tramos.length;
    for (const x of r.tramos) if (!ini || x.fecha < ini) ini = x.fecha;
    // días seguidos (los fines de semana y festivos no cortan)
    const segs = [];
    for (const x of r.tramos) {
      const u = segs[segs.length - 1];
      if (u && cal.labEntre(u[1], x.fecha) <= 1) u[1] = x.fecha; else if (!u || u[1] !== x.fecha) segs.push([x.fecha, x.fecha]);
    }
    out.push({ id: t.id, orden_id: t.orden_id, codigo: t.codigo, nombre: t.nombre, horas: ct.pend, area: ct.linea.nombre, linea_id: ct.linea.id,
      clase: t.proveedor_id ? (t.ext_en_obra ? 'sub' : 'ext') : 'propia', proveedor: t.proveedor, ajuste: ajustes[t.id] || null,
      tramos: r.tramos, segmentos: segs, inicio: r.tramos[0]?.fecha || null, fin: r.tramos.at(-1)?.fecha || null,
      tras: r.tras ? { codigo: r.tras.codigo, nombre: r.tras.nombre, otra_ot: !porId.has(r.tras.depende_de_id), fin: fecha(Math.floor(r.tras.fin / 24)), espera_h: r.tras.espera_h } : null });
    if (r.ocupadoHasta) avisos.push({ tipo: 'area', texto: `${ct.linea.nombre}: ocupada el ${dm(fecha(r.deseado))} → ${t.codigo} empieza el ${dm(r.ocupadoHasta)}` });
    if (r.sinHueco) avisos.push({ tipo: 'area', texto: `${t.codigo}: no cabe en ${ct.linea.nombre} en los próximos meses` });
    if (t.proveedor_id) avisos.push({ tipo: 'ext', texto: `«${t.nombre}» va a ${t.proveedor} (${t.ext_en_obra ? 'subcontrata en obra' : 'taller externo'}): ${r.tramos[0] ? `del ${dm(r.tramos[0].fecha)} al ${dm(r.tramos.at(-1).fecha)}` : ''}, sin confirmar con ellos` });
  }
  for (const n of p.notas) {
    if (n.tipo === 'dep') avisos.push({ tipo: 'dep', texto: `${n.t.codigo} depende de ${n.d.codigo} «${n.d.nombre}», que aún no está planificada: se coloca sin esperarla` });
    if (n.tipo === 'retraso') avisos.push({ tipo: 'dep', texto: `${n.d.codigo} «${n.d.nombre}» (previa de ${n.t.codigo}) iba hasta el ${dm(fecha(Math.floor(n.hasta / 24)))} y no está hecha: se cuenta desde hoy` });
    if (n.tipo === 'ajuste') avisos.push({ tipo: 'ajuste', texto: `${n.t.codigo} no puede empezar antes del ${dm(fecha(Math.floor(n.desde / 24)))}: espera a ${n.d.codigo}` });
  }
  for (const s of sinArea) avisos.push({ tipo: 'sin_area', texto: `${s.codigo} «${s.nombre}» no tiene área: elige una para colocarla` });
  const bloqueadas = p.bloqueadas.map((b) => ({ id: b.t.id, codigo: b.t.codigo, nombre: b.t.nombre, horas: b.ct.pend,
    espera: { codigo: b.espera.codigo, nombre: b.espera.nombre, otra_ot: !porId.has(b.espera.depende_de_id ?? b.espera.id) } }));
  if (bloqueadas.length) {
    const por = [...new Set(bloqueadas.map((b) => `${b.espera.codigo} «${b.espera.nombre}»`))];
    avisos.unshift({ tipo: 'bloqueo', texto: `No se ${bloqueadas.length > 1 ? `colocan ${bloqueadas.length} tareas` : `coloca ${bloqueadas[0].codigo}`}: esperan a ${por.join(', ')}, que aún no está planificada` });
  }

  // gente: horas-persona de cada día (lo que ya hay + lo propuesto) frente a las personas disponibles
  if (nTramos) {
    const dias = [...new Set(out.flatMap((t) => t.tramos.map((x) => x.fecha)))].sort();
    const { rows: ops } = await c.query(`SELECT id FROM recursos WHERE tipo = 'operario' AND activo`);
    const aus = ausenciasPorDia(await ausenciasEnRango(c, dias[0], dias.at(-1)), dias[0], dias.at(-1));
    const { rows: ya } = await c.query(
      `SELECT x.fecha::text AS fecha, sum(x.duracion_h * GREATEST(COALESCE(t.operarios_req, 1), 1))::float AS h
         FROM tramos x JOIN tareas t ON t.id = x.tarea_id
        WHERE x.fecha = ANY($1) AND t.proveedor_id IS NULL GROUP BY 1`, [dias]);
    const yaH = new Map(ya.map((r) => [r.fecha, r.h]));
    const nuevo = new Map();
    for (const t of out) if (t.clase === 'propia') for (const x of t.tramos) nuevo.set(x.fecha, (nuevo.get(x.fecha) || 0) + x.duracion_h * (porId.get(t.id).personas));
    const faltas = [];
    for (const f of dias) {
      if (!nuevo.get(f)) continue;
      const fuera = [...(aus.get(f) || new Map()).values()].filter((l) => l.some((a) => a.hora_desde == null)).length;
      const hay = Math.max(0, ops.length - fuera);
      const pide = (yaH.get(f) || 0) + nuevo.get(f);
      if (pide > hay * jornada.horas + 1e-9) faltas.push(`${dm(f)} (hacen falta unas ${Math.ceil(pide / jornada.horas)} personas y hay ${hay})`);
    }
    if (faltas.length) avisos.push({ tipo: 'gente', texto: `Faltará gente ${faltas.length > 1 ? 'los días' : 'el'} ${faltas.slice(0, 3).join(', ')}${faltas.length > 3 ? ` y ${faltas.length - 3} días más` : ''}` });
  }

  const fin = p.fin;
  // cada OT: su inicio y fin propuestos (con lo ya planificado que no se toca) frente a su entrega
  const otsRes = ots.map((o) => {
    const ts = out.filter((t) => porId.get(t.id).orden_id === o.id);
    const ini2 = ts.map((t) => t.inicio).filter(Boolean).sort()[0] || null;
    const ya = tareas.filter((t) => t.orden_id === o.id && t.ultimo).map((t) => t.ultimo.fecha);
    const fin2 = [...ts.map((t) => t.fin).filter(Boolean), ...ya].sort().at(-1) || null;
    const ok = !o.entrega || !fin2 ? null : fin2 <= o.entrega;
    return { id: o.id, codigo: o.codigo, titulo: o.titulo, entrega: o.entrega, inicio: ini2, fin: fin2, ok, tareas: ts.length,
      margen: ok === true ? cal.labEntre(fin2, o.entrega) : ok === false ? -cal.labEntre(o.entrega, fin2) : null };
  });
  let entrega = null;
  if (alc.tipo === 'ot') {
    const o = otsRes[0];
    if (o.entrega && fin) {
      entrega = fin <= o.entrega
        ? { ok: true, texto: `Entrega ${dsem(o.entrega)}: ${cal.labEntre(fin, o.entrega)} días laborables de margen` }
        : { ok: false, texto: `No llega a la entrega del ${dsem(o.entrega)}: termina ${cal.labEntre(o.entrega, fin)} días laborables después` };
    }
  } else {
    const malas = otsRes.filter((o) => o.ok === false && o.tareas);
    const conE = otsRes.filter((o) => o.ok != null && o.tareas);
    if (malas.length) entrega = { ok: false, texto: `No ${malas.length > 1 ? 'llegan' : 'llega'} a su entrega: ${malas.map((o) => `${o.codigo} (entrega ${dm(o.entrega)}, acaba ${dm(o.fin)})`).join(', ')}` };
    else if (conE.length) entrega = { ok: true, texto: `${conE.length > 1 ? `Las ${conE.length} OTs con entrega llegan` : `${conE[0].codigo} llega`} a tiempo (margen mínimo ${Math.min(...conE.map((o) => o.margen))} días laborables)` };
  }
  if (modo === 'fin' && noLlega) avisos.unshift({ tipo: 'no_llega', texto: `Aun empezando hoy, termina el ${dm(fin)}: no llega al ${dm(op.fecha)}` });
  return {
    ot: { id: ot.id, codigo: ot.codigo, titulo: ot.titulo, entrega: ot.entrega }, alcance: { tipo: alc.tipo, id: alc.id, nombre: alc.nombre },
    ots: otsRes, modo, fecha: op.fecha,
    inicio: ini, fin, entrega, tareas: out, sin_area: sinArea, bloqueadas, sin_esperar: sinEsperar, avisos, horas: r1(horas), n_tramos: nTramos,
    areas: lineas.map((l) => ({ id: l.id, nombre: l.nombre, tipo: l.tipo })),
  };
}

/* ---------- MOVER OT ---------- */
async function planMover(c, ordenId, dias) {
  dias = Math.trunc(Number(dias));
  if (!dias || Math.abs(dias) > 250) throw fallo(400, 'Días no válidos');
  const hoy = hoyMadrid();
  const { ot, tareas, deps } = await leerOT(c, ordenId);
  const ids = tareas.filter((t) => t.estado !== 'hecha').map((t) => t.id);
  const { rows: tramos } = ids.length ? await c.query(
    `SELECT x.id, x.tarea_id, x.fecha::text AS fecha, x.hora_inicio::float AS hora_inicio, x.duracion_h::float AS duracion_h, x.linea_id,
            l.exclusiva, l.nombre AS area, t.codigo,
            COALESCE((SELECT json_agg(json_build_object('recurso_id', a.recurso_id, 'nombre', r.nombre, 'desde', a.desde, 'hasta', a.hasta))
                        FROM tramo_asignaciones a JOIN recursos r ON r.id = a.recurso_id WHERE a.tramo_id = x.id), '[]') AS gente
       FROM tramos x JOIN tareas t ON t.id = x.tarea_id LEFT JOIN lineas l ON l.id = x.linea_id
      WHERE x.tarea_id = ANY($1) AND x.fecha >= $2 AND x.cierre IS NULL
        AND NOT EXISTS (SELECT 1 FROM registros g WHERE g.tramo_id = x.id)
      ORDER BY x.fecha, x.hora_inicio`, [ids, hoy]) : { rows: [] };
  if (!tramos.length) throw fallo(409, `${ot.codigo} no tiene nada planificado de hoy en adelante que se pueda mover`);
  const cal = await calendario(c, fecha(num(hoy) - 30), fecha(num(hoy) + 500));
  const movidos = tramos.map((x) => ({ ...x, nueva: cal.sumarLab(x.fecha, dias) }));
  if (movidos.some((x) => x.nueva < hoy)) throw fallo(409, `No se puede adelantar tanto: algún tramo quedaría antes de hoy`);
  const fechas = [...new Set(movidos.map((x) => x.nueva))];
  const idsMov = movidos.map((x) => x.id);
  // lo que ya hay esos días (sin lo que se mueve)
  const { rows: otros } = await c.query(
    `SELECT x.id, x.fecha::text AS fecha, x.hora_inicio::float AS a, (x.hora_inicio + x.duracion_h)::float AS b, x.linea_id, t.codigo,
            COALESCE((SELECT json_agg(json_build_object('recurso_id', a2.recurso_id, 'desde', COALESCE(a2.desde, x.hora_inicio), 'hasta', COALESCE(a2.hasta, x.hora_inicio + x.duracion_h)))
                        FROM tramo_asignaciones a2 WHERE a2.tramo_id = x.id), '[]') AS gente
       FROM tramos x JOIN tareas t ON t.id = x.tarea_id WHERE x.fecha = ANY($1) AND NOT (x.id = ANY($2))`, [fechas, idsMov]);
  const aus = ausenciasPorDia(await ausenciasEnRango(c, fechas.reduce((a, b) => (a < b ? a : b)), fechas.reduce((a, b) => (a > b ? a : b))),
    fechas.reduce((a, b) => (a < b ? a : b)), fechas.reduce((a, b) => (a > b ? a : b)));
  const avisos = []; const choques = [];
  for (const x of movidos) {
    const fin = x.hora_inicio + x.duracion_h;
    if (x.exclusiva) {
      const c2 = otros.find((o) => o.linea_id === x.linea_id && o.fecha === x.nueva && o.a < fin && o.b > x.hora_inicio);
      if (c2) choques.push(`${x.area} el ${dm(x.nueva)}: ${x.codigo} coincide con ${c2.codigo}`);
    }
    x.quitar = [];
    for (const g of x.gente) {
      const gd = g.desde ?? x.hora_inicio; const gh = g.hasta ?? fin;
      const falta = ((aus.get(x.nueva) || new Map()).get(g.recurso_id) || []).find((a) => a.hora_desde == null || (a.hora_desde < gh && a.hora_hasta > gd));
      const ocupado = otros.find((o) => o.fecha === x.nueva && o.gente.some((h) => h.recurso_id === g.recurso_id && h.desde < gh && h.hasta > gd));
      if (falta || ocupado) x.quitar.push({ ...g, motivo: falta ? 'falta ese día' : `está en ${ocupado.codigo}` });
    }
  }
  const sinGente = movidos.flatMap((x) => x.quitar.map((g) => `${g.nombre} (${dm(x.nueva)}, ${g.motivo})`));
  if (choques.length) avisos.push({ tipo: 'area', texto: `${choques.length} ${choques.length > 1 ? 'tramos chocan' : 'tramo choca'} con otra OT en un puesto de uno en uno: ${choques.slice(0, 3).join('; ')}${choques.length > 3 ? '…' : ''}` });
  if (sinGente.length) avisos.push({ tipo: 'gente', texto: `Se quita del tramo a: ${[...new Set(sinGente)].slice(0, 4).join(', ')}${sinGente.length > 4 ? '…' : ''}. Quedan en «Solucionar» para asignar a otro.` });
  // dependencias con tareas de fuera de la OT
  const enOT = new Set(tareas.map((t) => t.id));
  const primeroNuevo = new Map(); const ultimoNuevo = new Map();
  for (const x of movidos) {
    if (!primeroNuevo.has(x.tarea_id) || x.nueva < primeroNuevo.get(x.tarea_id)) primeroNuevo.set(x.tarea_id, x.nueva);
    if (!ultimoNuevo.has(x.tarea_id) || x.nueva > ultimoNuevo.get(x.tarea_id)) ultimoNuevo.set(x.tarea_id, x.nueva);
  }
  for (const d of deps) {
    if (enOT.has(d.tarea_id) && !enOT.has(d.depende_de_id) && primeroNuevo.has(d.tarea_id) && d.ultimo && primeroNuevo.get(d.tarea_id) < d.ultimo.fecha) {
      avisos.push({ tipo: 'dep', texto: `${tareas.find((t) => t.id === d.tarea_id).codigo} empezaría antes de que acabe ${d.codigo} (${dm(d.ultimo.fecha)}), de la que depende` });
    }
    if (enOT.has(d.depende_de_id) && !enOT.has(d.tarea_id) && ultimoNuevo.has(d.depende_de_id)) {
      const { rows: s } = await c.query('SELECT min(fecha)::text AS f FROM tramos WHERE tarea_id = $1', [d.tarea_id]);
      if (s[0].f && s[0].f < ultimoNuevo.get(d.depende_de_id)) avisos.push({ tipo: 'dep', texto: `${d.codigo} (otra OT) empieza el ${dm(s[0].f)} y depende de esta: habrá que moverla también` });
    }
  }
  const finNuevo = movidos.reduce((a, x) => (x.nueva > a ? x.nueva : a), '');
  let entrega = null;
  if (ot.entrega) entrega = finNuevo <= ot.entrega ? { ok: true, texto: `Termina el ${dsem(finNuevo)}: llega a la entrega del ${dm(ot.entrega)}` } : { ok: false, texto: `Termina el ${dsem(finNuevo)}: no llega a la entrega del ${dm(ot.entrega)}` };
  return { ot: { id: ot.id, codigo: ot.codigo, titulo: ot.titulo, entrega: ot.entrega }, dias, movidos, n: movidos.length,
    desde: movidos[0].fecha, a: movidos[0].nueva, fin: finNuevo, avisos, entrega };
}

/* ---------- DESHACER ---------- */
async function planDeshacer(c, id) {
  const { rows } = await c.query('SELECT * FROM planificaciones WHERE id = $1', [id]);
  if (!rows.length) throw fallo(404, 'No encontrada');
  const pl = rows[0];
  if (pl.deshecha_en) throw fallo(409, 'Ya se deshizo');
  const ids = (pl.detalle.tramos || []).map((x) => x.id);
  const { rows: ahora } = ids.length ? await c.query(
    `SELECT x.id, x.tarea_id, x.fecha::text AS fecha, x.hora_inicio::float AS hora_inicio, x.duracion_h::float AS duracion_h, x.linea_id, x.cierre,
            EXISTS (SELECT 1 FROM registros g WHERE g.tramo_id = x.id) AS con_horas, t.codigo
       FROM tramos x JOIN tareas t ON t.id = x.tarea_id WHERE x.id = ANY($1)`, [ids]) : { rows: [] };
  const mapa = new Map(ahora.map((x) => [x.id, x]));
  const igual = (a, b) => a.fecha === b.fecha && Number(a.hora_inicio) === Number(b.hora_inicio) && Number(a.duracion_h) === Number(b.duracion_h) && a.linea_id === b.linea_id;
  const out = { pl, intactos: [], tocados: [], fijos: [], borrados: 0 };
  for (const x of pl.detalle.tramos || []) {
    const a = mapa.get(x.id);
    if (!a) { out.borrados++; continue; }
    if (a.con_horas || a.cierre) { out.fijos.push(a); continue; }
    const ref = pl.tipo === 'mover' ? x.despues : x;
    (igual(a, ref) ? out.intactos : out.tocados).push({ ...a, ref: x });
  }
  return out;
}

const resumenDeshacer = (d) => {
  const verbo = d.pl.tipo === 'mover' ? 'vuelven a su sitio' : 'se quitan';
  return {
    id: d.pl.id, tipo: d.pl.tipo, resumen: d.pl.resumen, n_ots: (d.pl.ordenes || []).length || 1,
    intactos: d.intactos.length, tocados: d.tocados.map((x) => `${x.codigo} (ahora el ${dm(x.fecha)} ${hhmm(x.hora_inicio)})`),
    fijos: d.fijos.length, borrados: d.borrados, verbo,
    ext: d.pl.tipo === 'planificar' ? [...new Set((d.pl.detalle.tramos || []).filter((x) => x.proveedor).map((x) => x.proveedor))] : [],
  };
};

/* ---------- rutas ---------- */
function montar(app, asyncH) {
  const leerOp = (b) => ({ modo: b?.modo, fecha: b?.fecha, ajustes: b?.ajustes || {}, areas: b?.areas || {}, sinEsperar: !!b?.sinEsperar });

  // Propuesta (no cambia nada; en /api/plan-vista/… para no avisar a las demás pantallas).
  // alcance: { tipo: 'ot' | 'partida' | 'proyecto', id }
  const vista = (alcance) => asyncH(async (req, res) => { res.json(await proponer({ query }, alcance(req), leerOp(req.body))); });
  app.post('/api/plan-vista/ordenes/:id/planificar', auth.permiso('planificar'), vista((req) => ({ tipo: 'ot', id: Number(req.params.id) })));
  app.post('/api/plan-vista/planificar', auth.permiso('planificar'), vista((req) => req.body?.alcance));

  // Confirmar: se vuelve a calcular dentro de la transacción y se crean los tramos
  const confirmar = (alcance) => asyncH(async (req, res) => {
    const out = await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
      const op = leerOp(req.body);
      const p = await proponer(c, alcance(req), op);
      if (!p.n_tramos) throw fallo(409, 'No hay nada que colocar');
      const ids = p.ots.map((o) => o.id);
      // áreas elegidas para tareas que no tenían
      for (const [k, v] of Object.entries(op.areas)) {
        if (Number(v) > 0) await c.query('UPDATE tareas SET linea_id = $2 WHERE id = $1 AND orden_id = ANY($3) AND linea_id IS NULL', [Number(k), Number(v), ids]);
      }
      const creados = [];
      for (const t of p.tareas) {
        for (const x of t.tramos) {
          const { rows } = await c.query(
            `INSERT INTO tramos (tarea_id, fecha, hora_inicio, duracion_h, linea_id, actualizado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [t.id, x.fecha, x.hora_inicio, x.duracion_h, x.linea_id, req.usuario.id]);
          creados.push({ id: rows[0].id, tarea_id: t.id, ...x, proveedor: t.clase !== 'propia' ? t.proveedor : null });
          await extras.sincronizar(c, rows[0].id, req.usuario);
        }
        await c.query('INSERT INTO historial (usuario_id, tarea_id, accion, detalle) VALUES ($1,$2,$3,$4)',
          [req.usuario.id, t.id, 'planificar_ot', { tramos: t.tramos.length, desde: t.inicio, hasta: t.fin, alcance: p.alcance.nombre }]);
      }
      const ordenes = [...new Set(p.tareas.map((t) => t.orden_id))];
      const que = p.alcance.tipo === 'ot' ? 'OT' : `${p.alcance.nombre} (${ordenes.length} OT${ordenes.length > 1 ? 's' : ''})`;
      const resumen = `Planificar ${que} ${p.modo === 'fin' ? `para terminar el ${dm(p.fecha)}` : `desde ${dm(p.fecha)}`} · ${creados.length} tramos · del ${dm(p.inicio)} al ${dm(p.fin)}`;
      const { rows: pl } = await c.query(
        `INSERT INTO planificaciones (tipo, orden_id, ordenes, alcance, usuario_id, resumen, detalle) VALUES ('planificar', $1, $2, $3, $4, $5, $6) RETURNING id`,
        [p.alcance.tipo === 'ot' ? p.alcance.id : null, ordenes, p.alcance, req.usuario.id, resumen, { tramos: creados, modo: p.modo, fecha: p.fecha, ajustes: op.ajustes }]);
      return { planificacion_id: pl[0].id, tramos: creados.length, inicio: p.inicio, fin: p.fin, ot: p.ot, alcance: p.alcance, n_ots: ordenes.length, resumen };
    });
    res.status(201).json(out);
  });
  app.post('/api/ordenes/:id/planificar', auth.permiso('planificar'), confirmar((req) => ({ tipo: 'ot', id: Number(req.params.id) })));
  app.post('/api/planificar', auth.permiso('planificar'), confirmar((req) => req.body?.alcance));

  // Mover la OT N días laborables
  app.post('/api/plan-vista/ordenes/:id/mover', auth.permiso('planificar'), asyncH(async (req, res) => {
    const p = await planMover({ query }, Number(req.params.id), req.body?.dias);
    res.json({ ...p, movidos: undefined });
  }));
  app.post('/api/ordenes/:id/mover', auth.permiso('planificar'), asyncH(async (req, res) => {
    const ordenId = Number(req.params.id);
    const out = await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
      const p = await planMover(c, ordenId, req.body?.dias);
      const det = [];
      for (const x of p.movidos) {
        await c.query('UPDATE tramos SET fecha = $2, actualizado_por = $3 WHERE id = $1', [x.id, x.nueva, req.usuario.id]);
        for (const g of x.quitar) await c.query('DELETE FROM tramo_asignaciones WHERE tramo_id = $1 AND recurso_id = $2', [x.id, g.recurso_id]);
        await extras.sincronizar(c, x.id, req.usuario);
        det.push({ id: x.id, tarea_id: x.tarea_id, antes: { fecha: x.fecha, hora_inicio: x.hora_inicio, duracion_h: x.duracion_h, linea_id: x.linea_id },
          despues: { fecha: x.nueva, hora_inicio: x.hora_inicio, duracion_h: x.duracion_h, linea_id: x.linea_id }, quitados: x.quitar.map((g) => ({ recurso_id: g.recurso_id, desde: g.desde, hasta: g.hasta })) });
      }
      for (const tid of new Set(p.movidos.map((x) => x.tarea_id))) {
        await c.query('INSERT INTO historial (usuario_id, tarea_id, accion, detalle) VALUES ($1,$2,$3,$4)', [req.usuario.id, tid, 'mover_ot', { dias: p.dias }]);
      }
      const resumen = `Mover OT ${p.dias > 0 ? '+' : ''}${p.dias} día${Math.abs(p.dias) === 1 ? '' : 's'} laborable${Math.abs(p.dias) === 1 ? '' : 's'} · ${p.n} tramos`;
      const { rows: pl } = await c.query(
        `INSERT INTO planificaciones (tipo, orden_id, ordenes, usuario_id, resumen, detalle) VALUES ('mover', $1, $2, $3, $4, $5) RETURNING id`,
        [ordenId, [ordenId], req.usuario.id, resumen, { tramos: det, dias: p.dias }]);
      return { planificacion_id: pl[0].id, ot: p.ot, n: p.n, dias: p.dias, resumen };
    });
    res.json(out);
  }));

  // Historial de una OT
  app.get('/api/ordenes/:id/planificaciones', auth.permiso('planificar', 'proyectos'), asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT p.id, p.tipo, p.resumen, p.creado, p.deshecha_en, u.nombre AS usuario, ud.nombre AS deshecha_por
         FROM planificaciones p LEFT JOIN usuarios u ON u.id = p.usuario_id LEFT JOIN usuarios ud ON ud.id = p.deshecha_por
        WHERE p.orden_id = $1 OR $1 = ANY(p.ordenes) ORDER BY p.creado DESC LIMIT 30`, [Number(req.params.id)]);
    const out = [];
    for (const r of rows) {
      if (r.deshecha_en) { out.push(r); continue; }
      const d = await planDeshacer({ query }, r.id);
      out.push({ ...r, tocados: d.tocados.length, fijos: d.fijos.length, intactos: d.intactos.length });
    }
    res.json(out);
  }));

  // Deshacer: vista previa y aplicar. tocados: 'dejar' (por defecto) | 'incluir'
  app.post('/api/plan-vista/planificaciones/:id/deshacer', auth.permiso('planificar'), asyncH(async (req, res) => {
    res.json(resumenDeshacer(await planDeshacer({ query }, Number(req.params.id))));
  }));
  app.post('/api/planificaciones/:id/deshacer', auth.permiso('planificar'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const incluir = req.body?.tocados === 'incluir';
    const out = await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock($1)', [LOCK]);
      const d = await planDeshacer(c, id);
      const lista = [...d.intactos, ...(incluir ? d.tocados : [])];
      for (const x of lista) {
        if (d.pl.tipo === 'planificar') {
          await c.query('DELETE FROM tramos WHERE id = $1', [x.id]);
        } else {
          const a = x.ref.antes;
          await c.query('UPDATE tramos SET fecha = $2, hora_inicio = $3, duracion_h = $4, linea_id = $5, actualizado_por = $6 WHERE id = $1',
            [x.id, a.fecha, a.hora_inicio, a.duracion_h, a.linea_id, req.usuario.id]);
          for (const g of x.ref.quitados || []) {
            await c.query(`INSERT INTO tramo_asignaciones (tramo_id, recurso_id, asignado_por, desde, hasta) VALUES ($1,$2,$3,$4,$5)
                           ON CONFLICT DO NOTHING`, [x.id, g.recurso_id, req.usuario.id, g.desde, g.hasta]);
          }
          await extras.sincronizar(c, x.id, req.usuario);
        }
      }
      for (const tid of new Set(lista.map((x) => x.tarea_id))) {
        await c.query('INSERT INTO historial (usuario_id, tarea_id, accion, detalle) VALUES ($1,$2,$3,$4)', [req.usuario.id, tid, 'deshacer_plan', { planificacion_id: id }]);
      }
      await c.query('UPDATE planificaciones SET deshecha_en = now(), deshecha_por = $2, deshecha_detalle = $3 WHERE id = $1',
        [id, req.usuario.id, { hechos: lista.length, dejados: incluir ? 0 : d.tocados.length, fijos: d.fijos.length }]);
      return { ...resumenDeshacer(d), hechos: lista.length, dejados: incluir ? 0 : d.tocados.length };
    });
    res.json(out);
  }));
}

module.exports = { montar, proponer, planMover };
