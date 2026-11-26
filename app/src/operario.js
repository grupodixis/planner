// App del operario (además de «Mi día»): vacaciones, avisar ausencias, justificantes, incidencias,
// su mes y cambiar el PIN. Y lo que necesitan quienes lo atienden: aprobar vacaciones (Operaciones
// y luego RRHH) e incidencias (encargado).
const { query, tx } = require('./db');
const auth = require('./auth');
const { vacacionesDias } = require('./config');
const { laborables, afectados, festivosEnRango, ausenciasEnRango, textoAusencia } = require('./ausencias');
const archivos = require('./archivos');
const notif = require('./notificaciones');
const fFecha = (f) => f.split('-').reverse().join('/');
const hhmm = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const r2 = (x) => Math.round((x || 0) * 100) / 100;
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const leerFecha = (v, campo = 'Fecha') => { if (!FECHA_RE.test(String(v || ''))) throw fallo(400, `${campo} no válida`); return String(v); };
const leerHora = (v, campo) => {
  const h = Number(v);
  if (!Number.isFinite(h) || h < 0 || h > 24 || (h * 4) % 1 !== 0) throw fallo(400, `${campo} no válida`);
  return h;
};
const texto = (v, max) => String(v || '').trim().slice(0, max) || null;

function recursoDe(req) {
  if (!req.usuario.recurso_id) throw fallo(400, 'Tu usuario no está ligado a ninguna ficha de operario');
  return req.usuario.recurso_id;
}

/* ---------- Vacaciones: saldo de una persona en un año ---------- */
async function saldo(recursoId, anio) {
  const rango = [`${anio}-01-01`, `${anio}-12-31`];
  const [{ rows: rec }, aus, fest, { rows: sol }] = await Promise.all([
    query('SELECT dias_vacaciones::float AS dias FROM recursos WHERE id = $1', [recursoId]),
    ausenciasEnRango({ query }, ...rango),
    festivosEnRango({ query }, ...rango),
    query(`SELECT dias::float AS dias FROM solicitudes_vacaciones
            WHERE recurso_id = $1 AND estado IN ('pendiente_ops', 'pendiente_rrhh') AND desde <= $3 AND hasta >= $2`, [recursoId, ...rango]),
  ]);
  const festSet = new Set(fest.map((f) => f.fecha));
  const dias = rec[0]?.dias ?? vacacionesDias;
  const usados = aus.filter((a) => a.recurso_id === recursoId && a.tipo === 'vacaciones').reduce((s, a) => s + laborables(a, festSet, rango), 0);
  const pedidos = sol.reduce((s, x) => s + x.dias, 0);
  return { anio, dias, usados: r2(usados), pedidos: r2(pedidos), quedan: r2(dias - usados - pedidos), festSet };
}

async function diasLaborables(desde, hasta) {
  const fest = new Set((await festivosEnRango({ query }, desde, hasta)).map((f) => f.fecha));
  return r2(laborables({ desde, hasta, hora_desde: null }, fest));
}

// Avisos al pedir: trabajo planificado esos días y compañeros del mismo oficio fuera
async function avisosVacaciones(recursoId, desde, hasta, excluirSolicitud = 0) {
  const [trabajo, { rows: comp }] = await Promise.all([
    afectados(recursoId, { desde, hasta, hora_desde: null }),
    query(`SELECT DISTINCT r.nombre, 'vacaciones' AS que FROM ausencias a JOIN recursos r ON r.id = a.recurso_id
            WHERE a.tipo = 'vacaciones' AND a.recurso_id <> $1 AND a.desde <= $3 AND a.hasta >= $2
              AND EXISTS (SELECT 1 FROM recurso_tipos x JOIN recurso_tipos y ON y.tipo_recurso_id = x.tipo_recurso_id
                           WHERE x.recurso_id = $1 AND y.recurso_id = r.id)
           UNION
           SELECT DISTINCT r.nombre, 'pedidas' FROM solicitudes_vacaciones s JOIN recursos r ON r.id = s.recurso_id
            WHERE s.estado IN ('pendiente_ops', 'pendiente_rrhh') AND s.recurso_id <> $1 AND s.id <> $4 AND s.desde <= $3 AND s.hasta >= $2
              AND EXISTS (SELECT 1 FROM recurso_tipos x JOIN recurso_tipos y ON y.tipo_recurso_id = x.tipo_recurso_id
                           WHERE x.recurso_id = $1 AND y.recurso_id = r.id)`, [recursoId, desde, hasta, excluirSolicitud]),
  ]);
  const out = [];
  if (trabajo.length) out.push(`Tiene ${trabajo.length} trabajo(s) planificado(s) esos días`);
  for (const c of comp) out.push(`${c.nombre} (misma categoría) ${c.que === 'pedidas' ? 'también ha pedido' : 'está de vacaciones'} esos días`);
  return out;
}

const SQL_SOLICITUDES = `
  SELECT s.id, s.recurso_id, r.nombre AS recurso, s.desde, s.hasta, s.dias::float AS dias, s.notas, s.estado, s.creado,
         s.ops_nota, s.ops_en, uo.nombre AS ops_por, s.rrhh_nota, s.rrhh_en, ur.nombre AS rrhh_por
    FROM solicitudes_vacaciones s JOIN recursos r ON r.id = s.recurso_id
    LEFT JOIN usuarios uo ON uo.id = s.ops_por LEFT JOIN usuarios ur ON ur.id = s.rrhh_por`;

/* ---------- Avisos de ausencia del operario ---------- */
const MOTIVOS_AVISO = {
  enfermo: 'Enfermo / malestar',
  medico: 'Médico',
  retraso: 'Llego tarde',
  personal: 'Asunto personal',
  otro: 'Otro',
};

function montar(app, asyncH) {
  const soloSuyo = auth.permiso('mi_dia');

  /* ======================= OPERARIO ======================= */

  // Todo lo que no es el día: vacaciones, avisos, incidencias, justificantes pendientes
  app.get('/api/mi-dia/gestiones', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const anio = Number(req.query.anio) || Number(hoyMadrid().slice(0, 4));
    const hoy = hoyMadrid();
    const [s, { rows: solicitudes }, { rows: avisos }, { rows: pendientes }, { rows: incidencias }, { rows: maquinas }, { rows: tramosHoy }] = await Promise.all([
      saldo(recursoId, anio),
      query(`${SQL_SOLICITUDES} WHERE s.recurso_id = $1 AND (s.estado <> 'anulada') AND s.hasta >= $2 ORDER BY s.desde DESC LIMIT 30`,
        [recursoId, `${anio - 1}-12-01`]),
      query(`SELECT a.id, a.tipo, a.desde, a.hasta, a.hora_desde::float AS hora_desde, a.hora_hasta::float AS hora_hasta, a.notas,
                    a.justificante, a.aviso_motivo, a.avisado_en
               FROM ausencias a WHERE a.recurso_id = $1 AND a.avisado_en IS NOT NULL AND a.hasta >= $2 ORDER BY a.desde DESC`, [recursoId, sumarDias(hoy, -30)]),
      query(`SELECT a.id, a.tipo, a.desde, a.hasta, a.hora_desde::float AS hora_desde, a.hora_hasta::float AS hora_hasta, a.notas, a.aviso_motivo
               FROM ausencias a WHERE a.recurso_id = $1 AND a.tipo = 'falta' AND a.justificante = 'pendiente' ORDER BY a.desde DESC`, [recursoId]),
      query(`SELECT c.id, c.creado::date AS fecha, c.categoria AS tipo, c.texto, c.estado, c.resolucion, c.nota, m.nombre AS maquina, t.nombre AS tarea
               FROM capturas c LEFT JOIN recursos m ON m.id = c.maquina_id LEFT JOIN tareas t ON t.id = c.tarea_id
              WHERE c.usuario_id = $1 AND c.estado <> 'descartada' AND (c.estado IN ('bandeja','asunto') OR c.creado > now() - interval '14 days') ORDER BY c.creado DESC`, [req.usuario.id]),
      query(`SELECT id, nombre FROM recursos WHERE tipo = 'maquina' AND activo ORDER BY nombre`),
      query(`SELECT x.id, o.codigo || ' · ' || t.nombre AS nombre, x.tarea_id FROM tramos x
               JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $1
               JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id
              WHERE x.fecha = $2 ORDER BY x.hora_inicio`, [recursoId, hoy]),
    ]);
    const adjuntosAus = await archivos.de('ausencia', [...new Set([...avisos, ...pendientes].map((a) => a.id))]);
    const adjuntosInc = await archivos.de('captura', incidencias.map((i) => i.id));
    for (const a of avisos) { a.archivos = adjuntosAus.get(a.id) || []; a.texto = textoAusencia(a); }
    for (const a of pendientes) { a.archivos = adjuntosAus.get(a.id) || []; a.texto = textoAusencia(a); }
    for (const i of incidencias) i.archivos = adjuntosInc.get(i.id) || [];
    delete s.festSet;
    res.json({
      hoy, saldo: s, solicitudes, avisos, justificantes_pendientes: pendientes, incidencias, maquinas, tramos_hoy: tramosHoy,
      motivos_aviso: MOTIVOS_AVISO, tipos_incidencia: require('./capturas').CATEGORIAS, estados_captura: require('./capturas').ESTADOS,
    });
  }));

  /* ---------- Vacaciones ---------- */
  // Vista previa: días laborables y avisos, sin pedir nada
  app.get('/api/mi-dia/vacaciones/previa', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const desde = leerFecha(req.query.desde, 'Desde'), hasta = leerFecha(req.query.hasta, 'Hasta');
    if (hasta < desde) throw fallo(400, 'La fecha de fin es anterior a la de inicio');
    const dias = await diasLaborables(desde, hasta);
    const s = await saldo(recursoId, Number(desde.slice(0, 4)));
    res.json({ dias, quedan_despues: r2(s.quedan - dias), avisos: await avisosVacaciones(recursoId, desde, hasta) });
  }));

  app.post('/api/mi-dia/vacaciones', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const b = req.body || {};
    const desde = leerFecha(b.desde, 'Desde'), hasta = leerFecha(b.hasta, 'Hasta');
    if (hasta < desde) throw fallo(400, 'La fecha de fin es anterior a la de inicio');
    if (desde <= hoyMadrid()) throw fallo(400, 'Las vacaciones se piden con antelación (a partir de mañana)');
    if (desde.slice(0, 4) !== hasta.slice(0, 4)) throw fallo(400, 'Pide por separado los días de cada año');
    const dias = await diasLaborables(desde, hasta);
    if (!dias) throw fallo(400, 'Esos días no son laborables');
    const s = await saldo(recursoId, Number(desde.slice(0, 4)));
    if (dias > s.quedan) throw fallo(400, `Te quedan ${s.quedan} días y pides ${dias}`);
    const { rows: solape } = await query(
      `SELECT 1 FROM solicitudes_vacaciones WHERE recurso_id = $1 AND estado IN ('pendiente_ops','pendiente_rrhh','aprobada')
          AND desde <= $3 AND hasta >= $2
       UNION SELECT 1 FROM ausencias WHERE recurso_id = $1 AND tipo = 'vacaciones' AND desde <= $3 AND hasta >= $2`, [recursoId, desde, hasta]);
    if (solape.length) throw fallo(409, 'Ya tienes vacaciones pedidas o aprobadas en esas fechas');
    const { rows } = await query(
      `INSERT INTO solicitudes_vacaciones (recurso_id, desde, hasta, dias, notas, usuario_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [recursoId, desde, hasta, dias, texto(b.notas, 500), req.usuario.id]);
    notif.avisarLuego(notif.conPermiso('vacaciones_ops'), 'vac_pendiente', {
      titulo: 'Petición de vacaciones', cuerpo: `${req.usuario.nombre}: ${fFecha(desde)} – ${fFecha(hasta)} (${dias} días). Espera tu visto bueno.`,
      url: '/recursos.html?tipo=calendario', tag: `vac-${rows[0].id}`,
    });
    res.status(201).json({ id: rows[0].id, dias });
  }));

  // Anular una petición que aún no está aprobada
  app.delete('/api/mi-dia/vacaciones/:id', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const { rowCount } = await query(
      `UPDATE solicitudes_vacaciones SET estado = 'anulada' WHERE id = $1 AND recurso_id = $2 AND estado IN ('pendiente_ops','pendiente_rrhh')`,
      [Number(req.params.id), recursoId]);
    if (!rowCount) throw fallo(409, 'Ya está resuelta: si necesitas cambiarla, habla con RRHH');
    res.json({ ok: true });
  }));

  /* ---------- Avisar de una ausencia (enfermo, médico, llego tarde…) ---------- */
  // { motivo, desde, hasta?, hora_desde?, hora_hasta?, notas?, archivos?: [ids] }
  app.post('/api/mi-dia/ausencias', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const b = req.body || {};
    if (!MOTIVOS_AVISO[b.motivo]) throw fallo(400, 'Di qué pasa');
    const hoy = hoyMadrid();
    const desde = leerFecha(b.desde, 'Fecha');
    const hasta = b.hasta ? leerFecha(b.hasta, 'Hasta') : desde;
    if (desde < sumarDias(hoy, -1) || desde > sumarDias(hoy, 30)) throw fallo(400, 'Se avisa de hoy, de ayer o de los próximos 30 días');
    if (hasta < desde || hasta > sumarDias(desde, 14)) throw fallo(400, 'Fechas no válidas (como mucho 15 días; si es más, es una baja: habla con RRHH)');
    let hd = null, hh = null;
    if (b.hora_desde != null && b.hora_desde !== '') {
      hd = leerHora(b.hora_desde, 'Hora de inicio'); hh = leerHora(b.hora_hasta, 'Hora de fin');
      if (hh <= hd) throw fallo(400, 'La hora de fin debe ser posterior a la de inicio');
      if (hasta !== desde) throw fallo(400, 'Una ausencia de unas horas es de un solo día');
    }
    const out = await tx(async (c) => {
      // queda como falta pendiente de justificante: el encargado / RRHH decide luego
      const { rows } = await c.query(
        `INSERT INTO ausencias (recurso_id, tipo, desde, hasta, hora_desde, hora_hasta, notas, justificante, creado_por, avisado_en, aviso_motivo)
         VALUES ($1,'falta',$2,$3,$4,$5,$6,'pendiente',$7, now(), $8) RETURNING id`,
        [recursoId, desde, hasta, hd, hh, texto(b.notas, 500), req.usuario.id, b.motivo]);
      await archivos.enlazar(c, b.archivos, 'ausencia', rows[0].id, req.usuario.id);
      return rows[0].id;
    });
    const nAf = (await afectados(recursoId, { desde, hasta, hora_desde: hd, hora_hasta: hh })).length;
    const cuando = desde === hoyMadrid() ? 'hoy' : desde === hasta ? `el ${fFecha(desde)}` : `del ${fFecha(desde)} al ${fFecha(hasta)}`;
    notif.avisarLuego(notif.conPermiso('planificar'), 'ausencias', {
      titulo: `${req.usuario.nombre}: ${MOTIVOS_AVISO[b.motivo].toLowerCase()}`,
      cuerpo: `${hd != null ? `De ${hhmm(hd)} a ${hhmm(hh)} ` : 'Todo el día '}${cuando}${nAf ? ` · tenía ${nAf} trabajo(s) planificado(s)` : ''}`,
      url: `/parte.html?fecha=${desde}`, tag: `aus-${out}`,
    });
    res.status(201).json({ id: out, afectados: nAf });
  }));

  // Quitar un aviso propio (se equivocó) mientras no haya pasado el día
  app.delete('/api/mi-dia/ausencias/:id', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const { rows } = await query(`SELECT desde, justificante FROM ausencias WHERE id = $1 AND recurso_id = $2 AND avisado_en IS NOT NULL`,
      [Number(req.params.id), recursoId]);
    if (!rows.length) throw fallo(404, 'Aviso no encontrado');
    if (rows[0].desde < hoyMadrid() || rows[0].justificante !== 'pendiente') throw fallo(409, 'Ya no se puede quitar: habla con el encargado');
    await query('DELETE FROM ausencias WHERE id = $1', [Number(req.params.id)]);
    await query(`DELETE FROM archivos WHERE ref_tipo = 'ausencia' AND ref_id = $1`, [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // Añadir el justificante (foto) a una falta suya
  app.post('/api/mi-dia/ausencias/:id/justificante', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const id = Number(req.params.id);
    const n = await tx(async (c) => {
      const { rows } = await c.query(`SELECT 1 FROM ausencias WHERE id = $1 AND recurso_id = $2 AND tipo = 'falta'`, [id, recursoId]);
      if (!rows.length) throw fallo(404, 'Falta no encontrada');
      return archivos.enlazar(c, req.body?.archivos, 'ausencia', id, req.usuario.id);
    });
    if (!n) throw fallo(400, 'Sube primero la foto');
    res.json({ ok: true, archivos: n });
  }));

  /* ---------- Mi mes: horas y ausencias día a día ---------- */
  app.get('/api/mi-dia/mes', soloSuyo, asyncH(async (req, res) => {
    const recursoId = recursoDe(req);
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : hoyMadrid().slice(0, 7);
    const desde = `${mes}-01`;
    const hasta = sumarDias(`${sumarDias(desde, 32).slice(0, 7)}-01`, -1);
    const [{ rows: plan }, { rows: real }, { rows: decl }, aus, fest] = await Promise.all([
      query(`SELECT x.fecha, sum(COALESCE(a.hasta, x.hora_inicio + x.duracion_h) - COALESCE(a.desde, x.hora_inicio))::float AS h
               FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $1
              WHERE x.fecha BETWEEN $2 AND $3 GROUP BY x.fecha`, [recursoId, desde, hasta]),
      query(`SELECT fecha, sum(horas) FILTER (WHERE tipo = 'productivo')::float AS prod,
                    sum(horas) FILTER (WHERE tipo = 'no_productivo')::float AS no_prod
               FROM registros WHERE recurso_id = $1 AND fecha BETWEEN $2 AND $3 GROUP BY fecha`, [recursoId, desde, hasta]),
      query(`SELECT d.fecha, count(*)::int AS n, bool_or(e.fecha IS NOT NULL) AS enviado
               FROM declaraciones d LEFT JOIN dias_enviados e ON e.fecha = d.fecha AND e.recurso_id = d.recurso_id
              WHERE d.recurso_id = $1 AND d.fecha BETWEEN $2 AND $3 GROUP BY d.fecha`, [recursoId, desde, hasta]),
      ausenciasEnRango({ query }, desde, hasta),
      festivosEnRango({ query }, desde, hasta),
    ]);
    const m = (rows) => new Map(rows.map((r) => [r.fecha, r]));
    const P = m(plan), R = m(real), D = m(decl), F = new Map(fest.map((f) => [f.fecha, f.nombre]));
    const suyas = aus.filter((a) => a.recurso_id === recursoId);
    const out = [];
    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
      const a = suyas.filter((x) => x.desde <= f && x.hasta >= f);
      out.push({
        fecha: f, festivo: F.get(f) || null,
        plan_h: r2(P.get(f)?.h), real_h: r2(R.get(f)?.prod), no_prod_h: r2(R.get(f)?.no_prod),
        apuntado: D.get(f)?.n || 0, enviado: !!D.get(f)?.enviado,
        ausencias: a.map((x) => ({ tipo: x.tipo, texto: textoAusencia(x, f) })),
      });
    }
    const tot = out.reduce((t, d) => ({ plan: t.plan + d.plan_h, real: t.real + d.real_h, no_prod: t.no_prod + d.no_prod_h }), { plan: 0, real: 0, no_prod: 0 });
    res.json({ mes, hoy: hoyMadrid(), dias: out, total: { plan_h: r2(tot.plan), real_h: r2(tot.real), no_prod_h: r2(tot.no_prod) } });
  }));

  /* ---------- Cambiar su PIN ---------- */
  app.post('/api/mi-dia/pin', soloSuyo, asyncH(async (req, res) => {
    const actual = String(req.body?.actual || ''), nuevo = String(req.body?.nuevo || '');
    const clave = `pin:u:${req.usuario.id}`;
    if (auth.bloqueado(clave)) throw fallo(429, 'Demasiados intentos. Espera unos minutos.');
    const { rows } = await query('SELECT pin_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    const pin = require('./pin');
    if (!rows[0]?.pin_hash || !pin.verificarPin(actual, rows[0].pin_hash)) {
      auth.anotarFallo(clave);
      throw fallo(400, 'El PIN actual no es correcto');
    }
    const mal = pin.pinNoValido(nuevo);
    if (mal) throw fallo(400, mal);
    await query('UPDATE usuarios SET pin_hash = $2 WHERE id = $1', [req.usuario.id, pin.hashPin(nuevo)]);
    res.json({ ok: true });
  }));

  /* ======================= QUIEN LO ATIENDE ======================= */
  const aprueba = auth.permiso('vacaciones_ops', 'vacaciones_rrhh');

  // Peticiones de vacaciones (pendientes y las últimas resueltas)
  app.get('/api/solicitudes-vacaciones', aprueba, asyncH(async (req, res) => {
    const { rows } = await query(
      `${SQL_SOLICITUDES} WHERE s.estado IN ('pendiente_ops','pendiente_rrhh') OR (s.estado <> 'anulada' AND s.creado > now() - interval '60 days')
       ORDER BY (s.estado LIKE 'pendiente%') DESC, s.desde`);
    for (const s of rows) {
      if (!s.estado.startsWith('pendiente')) continue;
      s.avisos = await avisosVacaciones(s.recurso_id, s.desde, s.hasta, s.id);
      const sal = await saldo(s.recurso_id, Number(s.desde.slice(0, 4)));
      s.quedan = sal.quedan;   // ya descontada esta petición
    }
    res.json({ solicitudes: rows, puedo: { ops: auth.tiene(req.usuario, 'vacaciones_ops'), rrhh: auth.tiene(req.usuario, 'vacaciones_rrhh') } });
  }));

  // { decision: 'aprobar' | 'rechazar', nota? } — el paso lo marca el estado: Operaciones y luego RRHH
  app.post('/api/solicitudes-vacaciones/:id', aprueba, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const decision = req.body?.decision;
    if (!['aprobar', 'rechazar'].includes(decision)) throw fallo(400, 'Aprobar o rechazar');
    const nota = texto(req.body?.nota, 500);
    if (decision === 'rechazar' && !nota) throw fallo(400, 'Di por qué se rechaza (lo verá el operario)');
    const out = await tx(async (c) => {
      const { rows } = await c.query('SELECT * FROM solicitudes_vacaciones WHERE id = $1 FOR UPDATE', [id]);
      if (!rows.length) throw fallo(404, 'Petición no encontrada');
      const s = rows[0];
      if (s.estado === 'pendiente_ops') {
        if (!auth.tiene(req.usuario, 'vacaciones_ops')) throw fallo(403, 'Este paso lo da Operaciones');
        await c.query(`UPDATE solicitudes_vacaciones SET estado = $2, ops_por = $3, ops_en = now(), ops_nota = $4 WHERE id = $1`,
          [id, decision === 'aprobar' ? 'pendiente_rrhh' : 'rechazada', req.usuario.id, nota]);
        return { estado: decision === 'aprobar' ? 'pendiente_rrhh' : 'rechazada' };
      }
      if (s.estado === 'pendiente_rrhh') {
        if (!auth.tiene(req.usuario, 'vacaciones_rrhh')) throw fallo(403, 'Este paso lo da RRHH');
        let ausenciaId = null;
        if (decision === 'aprobar') {
          const { rows: a } = await c.query(
            `INSERT INTO ausencias (recurso_id, tipo, desde, hasta, notas, creado_por) VALUES ($1,'vacaciones',$2,$3,$4,$5) RETURNING id`,
            [s.recurso_id, s.desde, s.hasta, s.notas ? `Pedidas: ${s.notas}` : 'Pedidas desde la app', req.usuario.id]);
          ausenciaId = a[0].id;
        }
        await c.query(`UPDATE solicitudes_vacaciones SET estado = $2, rrhh_por = $3, rrhh_en = now(), rrhh_nota = $4, ausencia_id = $5 WHERE id = $1`,
          [id, decision === 'aprobar' ? 'aprobada' : 'rechazada', req.usuario.id, nota, ausenciaId]);
        return { estado: decision === 'aprobar' ? 'aprobada' : 'rechazada' };
      }
      throw fallo(409, 'Esta petición ya está resuelta');
    });
    // avisos: a RRHH cuando Operaciones da el visto bueno; al operario cuando se resuelve
    const { rows: sv } = await query(
      `SELECT s.recurso_id, s.desde, s.hasta, s.dias::float AS dias, r.nombre FROM solicitudes_vacaciones s JOIN recursos r ON r.id = s.recurso_id WHERE s.id = $1`, [id]);
    const s = sv[0];
    if (s && out.estado === 'pendiente_rrhh') {
      notif.avisarLuego(notif.conPermiso('vacaciones_rrhh'), 'vac_pendiente', {
        titulo: 'Vacaciones para aprobar', cuerpo: `${s.nombre}: ${fFecha(s.desde)} – ${fFecha(s.hasta)} (${s.dias} días). Operaciones ya dio el visto bueno.`,
        url: '/recursos.html?tipo=calendario', tag: `vac-${id}`,
      });
    }
    if (s && (out.estado === 'aprobada' || out.estado === 'rechazada')) {
      notif.avisarLuego(notif.deRecurso(s.recurso_id), 'vacaciones', {
        titulo: out.estado === 'aprobada' ? '🌴 Vacaciones aprobadas' : 'Vacaciones rechazadas',
        cuerpo: `${fFecha(s.desde)} – ${fFecha(s.hasta)}${out.estado === 'rechazada' && nota ? ` · ${nota}` : ''}`,
        url: '/mi-dia.html', tag: `vac-${id}`,
      });
    }
    res.json({ ok: true, ...out });
  }));

  // Avisos de ausencia de los operarios (para el parte y el cuadrante)
  const encargado = auth.permiso('planificar');
  app.get('/api/avisos-ausencia', encargado, asyncH(async (req, res) => {
    const desde = FECHA_RE.test(req.query.desde || '') ? req.query.desde : sumarDias(hoyMadrid(), -1);
    const hasta = FECHA_RE.test(req.query.hasta || '') ? req.query.hasta : sumarDias(hoyMadrid(), 7);
    const { rows } = await query(
      `SELECT a.id, a.recurso_id, r.nombre AS recurso, a.tipo, a.desde, a.hasta, a.hora_desde::float AS hora_desde, a.hora_hasta::float AS hora_hasta,
              a.notas, a.justificante, a.aviso_motivo, a.avisado_en
         FROM ausencias a JOIN recursos r ON r.id = a.recurso_id
        WHERE a.avisado_en IS NOT NULL AND a.desde <= $2 AND a.hasta >= $1 ORDER BY a.desde, r.nombre`, [desde, hasta]);
    const adj = await archivos.de('ausencia', rows.map((a) => a.id));
    for (const a of rows) { a.archivos = adj.get(a.id) || []; a.texto = textoAusencia(a); a.motivo_txt = MOTIVOS_AVISO[a.aviso_motivo] || null; }
    res.json(rows);
  }));

  // Contadores para el menú: lo que espera a este usuario
  app.get('/api/pendientes', asyncH(async (req, res) => {
    const u = req.usuario;
    if (u.solo_mi_dia) return res.json({});
    const out = {};
    if (auth.tiene(u, 'vacaciones_ops') || auth.tiene(u, 'vacaciones_rrhh')) {
      const estados = [auth.tiene(u, 'vacaciones_ops') && 'pendiente_ops', auth.tiene(u, 'vacaciones_rrhh') && 'pendiente_rrhh'].filter(Boolean);
      out.vacaciones = (await query(`SELECT count(*)::int AS n FROM solicitudes_vacaciones WHERE estado = ANY($1)`, [estados])).rows[0].n;
    }
    if (auth.tiene(u, 'planificar')) {
      out.bandeja = (await query(`SELECT count(*)::int AS n FROM capturas WHERE estado = 'bandeja'`)).rows[0].n;
    }
    out.mis_asuntos = (await query(`SELECT count(*)::int AS n FROM capturas WHERE estado = 'asunto' AND responsable_id = $1`, [u.id])).rows[0].n;
    if (auth.tiene(u, 'recursos') || auth.tiene(u, 'planificar')) {
      out.justificantes = (await query(
        `SELECT count(DISTINCT a.id)::int AS n FROM ausencias a JOIN archivos f ON f.ref_tipo = 'ausencia' AND f.ref_id = a.id
          WHERE a.tipo = 'falta' AND a.justificante = 'pendiente'`)).rows[0].n;
    }
    Object.assign(out, await require('./material').pendientes(u));
    if (auth.tiene(u, 'recursos')) out.cap_validar = await require('./capacidades').porValidar();
    out.incidencias = await require('./incidencias').contar(u);
    if (auth.tiene(u, 'compras')) out.correo = (await query(`SELECT count(*)::int AS n FROM correos WHERE estado IN ('revisar','sin_asignar','error')`)).rows[0].n;
    if (auth.tiene(u, 'autorizar_horas_extra')) out.horas_extra = await require('./horas-extra').contarPendientes();
    if (auth.tiene(u, 'autorizar_compras_locales')) out.cl_autorizar = (await query(`SELECT count(*)::int AS n FROM compras_locales WHERE estado = 'pendiente'`)).rows[0].n;
    res.json(out);
  }));
}

module.exports = { montar, MOTIVOS_AVISO };
