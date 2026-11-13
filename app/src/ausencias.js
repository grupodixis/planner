// Ausencias de recursos (vacaciones, bajas, permisos… y averías, mantenimiento, ITV de máquinas),
// festivos del calendario laboral y saldo de vacaciones.
const { query } = require('./db');
const auth = require('./auth');
const { jornada, vacacionesDias } = require('./config');

const FECHA_RE = /^\d{4}-\d{2}-\d{2}$/;
const fallo = (status, msg) => Object.assign(new Error(msg), { status });

const TIPOS = {
  vacaciones: { nombre: 'Vacaciones', estado: 'de vacaciones', clases: ['operario'] },
  baja: { nombre: 'Baja', estado: 'de baja', clases: ['operario'] },
  permiso: { nombre: 'Permiso', estado: 'de permiso', clases: ['operario'] },
  formacion: { nombre: 'Formación', estado: 'en formación', clases: ['operario'] },
  falta: { nombre: 'Falta sin avisar', estado: 'falta sin avisar', clases: ['operario'] },
  averia: { nombre: 'Avería', estado: 'averiado', clases: ['maquina', 'subcontrata'] },
  mantenimiento: { nombre: 'Mantenimiento', estado: 'en mantenimiento', clases: ['maquina', 'subcontrata'] },
  itv: { nombre: 'ITV / revisión', estado: 'en ITV / revisión', clases: ['maquina', 'subcontrata'] },
  otro: { nombre: 'Otro', estado: 'no disponible', clases: ['operario', 'maquina', 'subcontrata'] },
};

/* ---------- fechas ---------- */
const aUTC = (iso) => Date.parse(`${iso}T00:00:00Z`);
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
function* dias(desde, hasta) {
  for (let t = aUTC(desde); t <= aUTC(hasta); t += 864e5) yield iso(t);
}
const esFinde = (f) => { const d = new Date(aUTC(f)).getUTCDay(); return d === 0 || d === 6; };
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const ddmm = (f) => `${f.slice(8, 10)}/${f.slice(5, 7)}`;

// Días laborables (lunes a viernes, sin festivos) de una ausencia; una de unas horas cuenta su parte
function laborables(a, festivos, limite = null) {
  if (a.hora_desde != null) {
    const f = a.desde;
    if (limite && (f < limite[0] || f > limite[1])) return 0;
    return esFinde(f) || festivos.has(f) ? 0 : Math.min(1, (a.hora_hasta - a.hora_desde) / jornada.horas);
  }
  let n = 0;
  const desde = limite && a.desde < limite[0] ? limite[0] : a.desde;
  const hasta = limite && a.hasta > limite[1] ? limite[1] : a.hasta;
  for (const f of dias(desde, hasta)) if (!esFinde(f) && !festivos.has(f)) n++;
  return n;
}

// Texto corto: «de vacaciones hasta el 24/11», «de permiso 09:00–11:00»
function textoAusencia(a, fecha) {
  const t = TIPOS[a.tipo]?.estado || 'no disponible';
  if (a.hora_desde != null) return `${t} ${hhmm(a.hora_desde)}–${hhmm(a.hora_hasta)}`;
  if (a.desde === a.hasta) return t;
  return fecha && a.hasta > fecha ? `${t} hasta el ${ddmm(a.hasta)}` : `${t} (${ddmm(a.desde)}–${ddmm(a.hasta)})`;
}

const SQL_AUSENCIAS = `
  SELECT a.id, a.recurso_id, a.tipo, a.desde, a.hasta, a.hora_desde::float AS hora_desde, a.hora_hasta::float AS hora_hasta,
         a.notas, r.nombre AS recurso, r.tipo AS clase
    FROM ausencias a JOIN recursos r ON r.id = a.recurso_id`;

async function ausenciasEnRango(c, desde, hasta) {
  const { rows } = await c.query(`${SQL_AUSENCIAS} WHERE a.desde <= $2 AND a.hasta >= $1 ORDER BY a.desde, r.nombre`, [desde, hasta]);
  return rows;
}
async function festivosEnRango(c, desde, hasta) {
  const { rows } = await c.query('SELECT fecha, nombre, ambito FROM festivos WHERE fecha BETWEEN $1 AND $2 ORDER BY fecha', [desde, hasta]);
  return rows;
}

// fecha → Map(recurso_id → [ausencias de ese día])
function ausenciasPorDia(ausencias, desde, hasta) {
  const out = new Map();
  for (const a of ausencias) {
    for (const f of dias(a.desde > desde ? a.desde : desde, a.hasta < hasta ? a.hasta : hasta)) {
      if (!out.has(f)) out.set(f, new Map());
      const m = out.get(f);
      if (!m.has(a.recurso_id)) m.set(a.recurso_id, []);
      m.get(a.recurso_id).push(a);
    }
  }
  return out;
}

function leerAusencia(b, parcial) {
  const out = {};
  if (!parcial || 'tipo' in b) {
    if (!TIPOS[b.tipo]) throw fallo(400, 'Tipo de ausencia no válido');
    out.tipo = b.tipo;
  }
  for (const k of ['desde', 'hasta']) {
    if (!parcial || k in b) {
      if (!FECHA_RE.test(String(b[k] || ''))) throw fallo(400, `Fecha «${k}» no válida`);
      out[k] = b[k];
    }
  }
  if ('hora_desde' in b || 'hora_hasta' in b) {
    const vacio = (v) => v === null || v === '' || v === undefined;
    if (vacio(b.hora_desde) && vacio(b.hora_hasta)) { out.hora_desde = null; out.hora_hasta = null; } else {
      const hd = Number(b.hora_desde), hh = Number(b.hora_hasta);
      const ok = (h) => Number.isFinite(h) && h >= 0 && h <= 24 && (h * 4) % 1 === 0;
      if (!ok(hd) || !ok(hh) || hh <= hd) throw fallo(400, 'Horas no válidas (la de fin, después de la de inicio)');
      out.hora_desde = hd; out.hora_hasta = hh;
    }
  }
  if ('notas' in b) out.notas = String(b.notas || '').trim().slice(0, 500) || null;
  return out;
}

// Tramos que tiene asignados ese recurso dentro de la ausencia (para avisar al guardarla)
async function afectados(recursoId, a) {
  const { rows } = await query(
    `SELECT x.fecha, o.codigo || ' ' || t.nombre AS tarea,
            COALESCE(s.desde, x.hora_inicio)::float AS desde, COALESCE(s.hasta, x.hora_inicio + x.duracion_h)::float AS hasta
       FROM tramo_asignaciones s JOIN tramos x ON x.id = s.tramo_id
       JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id
      WHERE s.recurso_id = $1 AND x.fecha BETWEEN $2 AND $3 ORDER BY x.fecha, x.hora_inicio`,
    [recursoId, a.desde, a.hasta]);
  return rows.filter((r) => a.hora_desde == null || (r.desde < a.hora_hasta && r.hasta > a.hora_desde));
}

function montar(app, asyncH) {
  app.get('/api/ausencias/tipos', (req, res) => res.json(TIPOS));

  // ?recurso_id= · ?desde=&hasta= · ?anio=
  app.get('/api/ausencias', asyncH(async (req, res) => {
    const cond = [], params = [];
    if (req.query.recurso_id) { params.push(Number(req.query.recurso_id)); cond.push(`a.recurso_id = $${params.length}`); }
    let desde = req.query.desde, hasta = req.query.hasta;
    if (req.query.anio) { desde = `${Number(req.query.anio)}-01-01`; hasta = `${Number(req.query.anio)}-12-31`; }
    if (desde && FECHA_RE.test(desde)) { params.push(desde); cond.push(`a.hasta >= $${params.length}`); }
    if (hasta && FECHA_RE.test(hasta)) { params.push(hasta); cond.push(`a.desde <= $${params.length}`); }
    const { rows } = await query(`${SQL_AUSENCIAS}${cond.length ? ` WHERE ${cond.join(' AND ')}` : ''}
                                   ORDER BY a.desde DESC, r.nombre LIMIT 500`, params);
    if (!rows.length) return res.json([]);
    const min = rows.reduce((m, a) => (a.desde < m ? a.desde : m), rows[0].desde);
    const max = rows.reduce((m, a) => (a.hasta > m ? a.hasta : m), rows[0].hasta);
    const fest = new Set((await festivosEnRango({ query }, min, max)).map((f) => f.fecha));
    res.json(rows.map((a) => ({ ...a, dias_laborables: Math.round(laborables(a, fest) * 100) / 100, texto: textoAusencia(a) })));
  }));

  // Las apunta quien gestiona recursos y también quien planifica (una falta se registra desde el tablero)
  app.post('/api/ausencias', auth.permiso('recursos', 'planificar'), asyncH(async (req, res) => {
    const b = req.body || {};
    const d = leerAusencia(b, false);
    if (d.hora_desde != null && d.desde !== d.hasta) throw fallo(400, 'Una ausencia de unas horas es de un solo día');
    const { rows: r } = await query('SELECT id, tipo FROM recursos WHERE id = $1', [Number(b.recurso_id)]);
    if (!r.length) throw fallo(404, 'Recurso no encontrado');
    if (!TIPOS[d.tipo].clases.includes(r[0].tipo)) throw fallo(400, `«${TIPOS[d.tipo].nombre}» no se aplica a este recurso`);
    if (d.hasta < d.desde) throw fallo(400, 'La fecha de fin es anterior a la de inicio');
    const { rows } = await query(
      `INSERT INTO ausencias (recurso_id, tipo, desde, hasta, hora_desde, hora_hasta, notas, creado_por)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [r[0].id, d.tipo, d.desde, d.hasta, d.hora_desde ?? null, d.hora_hasta ?? null, d.notas ?? null, req.usuario.id]);
    res.status(201).json({ id: rows[0].id, afectados: await afectados(r[0].id, d) });
  }));

  app.patch('/api/ausencias/:id', auth.permiso('recursos', 'planificar'), asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: ant } = await query(`${SQL_AUSENCIAS} WHERE a.id = $1`, [id]);
    if (!ant.length) throw fallo(404, 'Ausencia no encontrada');
    const d = leerAusencia(req.body || {}, true);
    const nueva = { ...ant[0], ...d };
    if (nueva.hasta < nueva.desde) throw fallo(400, 'La fecha de fin es anterior a la de inicio');
    if (nueva.hora_desde != null && nueva.desde !== nueva.hasta) throw fallo(400, 'Una ausencia de unas horas es de un solo día');
    if (!TIPOS[nueva.tipo].clases.includes(ant[0].clase)) throw fallo(400, `«${TIPOS[nueva.tipo].nombre}» no se aplica a este recurso`);
    const campos = Object.keys(d);
    if (campos.length) {
      await query(`UPDATE ausencias SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...campos.map((k) => d[k])]);
    }
    res.json({ ok: true, afectados: await afectados(ant[0].recurso_id, nueva) });
  }));

  app.delete('/api/ausencias/:id', auth.permiso('recursos', 'planificar'), asyncH(async (req, res) => {
    await query('DELETE FROM ausencias WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  /* ---------- Festivos ---------- */
  app.get('/api/festivos', asyncH(async (req, res) => {
    const anio = Number(req.query.anio) || new Date().getFullYear();
    res.json(await festivosEnRango({ query }, `${anio}-01-01`, `${anio}-12-31`));
  }));

  app.post('/api/festivos', auth.permiso('recursos'), asyncH(async (req, res) => {
    const b = req.body || {};
    if (!FECHA_RE.test(String(b.fecha || ''))) throw fallo(400, 'Fecha no válida');
    const nombre = String(b.nombre || '').trim();
    if (!nombre || nombre.length > 80) throw fallo(400, 'Pon el nombre del festivo (máx. 80)');
    const ambito = ['general', 'local', 'empresa'].includes(b.ambito) ? b.ambito : 'empresa';
    await query(`INSERT INTO festivos (fecha, nombre, ambito) VALUES ($1,$2,$3)
                 ON CONFLICT (fecha) DO UPDATE SET nombre = EXCLUDED.nombre, ambito = EXCLUDED.ambito`, [b.fecha, nombre, ambito]);
    res.status(201).json({ ok: true });
  }));

  app.delete('/api/festivos/:fecha', auth.permiso('recursos'), asyncH(async (req, res) => {
    await query('DELETE FROM festivos WHERE fecha = $1', [String(req.params.fecha)]);
    res.json({ ok: true });
  }));

  /* ---------- Saldo de vacaciones por persona y año ---------- */
  app.get('/api/vacaciones', asyncH(async (req, res) => {
    const anio = Number(req.query.anio) || new Date().getFullYear();
    const rango = [`${anio}-01-01`, `${anio}-12-31`];
    const hoy = iso(Date.now());
    const [{ rows: personas }, aus, fest] = await Promise.all([
      query(`SELECT id, nombre, vinculo, empresa, dias_vacaciones::float AS dias_vacaciones
               FROM recursos WHERE tipo = 'operario' AND activo ORDER BY (vinculo = 'subcontratado'), nombre`),
      ausenciasEnRango({ query }, ...rango),
      festivosEnRango({ query }, ...rango),
    ]);
    const festSet = new Set(fest.map((f) => f.fecha));
    const r2 = (x) => Math.round(x * 100) / 100;
    const filas = personas.map((p) => {
      const suyas = aus.filter((a) => a.recurso_id === p.id);
      const vac = suyas.filter((a) => a.tipo === 'vacaciones');
      const usados = vac.reduce((s, a) => s + laborables(a, festSet, rango), 0);
      // las que ya han pasado (hasta ayer) y las que están por venir
      const disfrutados = vac.reduce((s, a) => s + (a.desde < hoy ? laborables(a, festSet, [rango[0], iso(aUTC(hoy) - 864e5) < rango[1] ? iso(aUTC(hoy) - 864e5) : rango[1]]) : 0), 0);
      const dias = p.dias_vacaciones ?? vacacionesDias;
      const otras = {};
      for (const a of suyas.filter((x) => x.tipo !== 'vacaciones')) otras[a.tipo] = r2((otras[a.tipo] || 0) + laborables(a, festSet, rango));
      return {
        ...p, dias, propios: p.dias_vacaciones != null, usados: r2(usados), disfrutados: r2(disfrutados),
        pendientes: r2(dias - usados), otras,
        ausencias: suyas.map((a) => ({ ...a, dias_laborables: r2(laborables(a, festSet, rango)), texto: textoAusencia(a) })),
      };
    });
    res.json({ anio, dias_convenio: vacacionesDias, festivos: fest, personas: filas, laborables_anio: [...dias(...rango)].filter((f) => !esFinde(f) && !festSet.has(f)).length });
  }));
}

module.exports = { montar, TIPOS, ausenciasEnRango, festivosEnRango, ausenciasPorDia, textoAusencia };
