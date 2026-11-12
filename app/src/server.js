const path = require('path');
const express = require('express');
const { query, tx, esperarBD } = require('./db');
const auth = require('./auth');
const { leerRequisitosTipo } = require('./gestion');
const { migrar } = require('./migraciones');

const app = express();
app.disable('x-powered-by');
// La importación de proyectos admite archivos grandes; el resto, 100 kB
app.use('/api/importar', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get('/health', (req, res) => res.json({ ok: true }));

/* ---------- Autenticación ---------- */

app.post('/api/login', asyncH(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const { rows } = await query('SELECT id, password_hash FROM usuarios WHERE email = $1 AND activo', [email]);
  if (!rows.length || !auth.verificarPassword(password, rows[0].password_hash)) {
    return res.status(401).json({ error: 'Email o contraseña incorrectos' });
  }
  await auth.crearSesion(res, rows[0].id);
  res.json({ ok: true });
}));

app.post('/api/logout', asyncH(async (req, res) => {
  await auth.cerrarSesion(req, res);
  res.json({ ok: true });
}));

app.use('/api', auth.requiereSesion);

app.get('/api/me', (req, res) => res.json(req.usuario));

/* ---------- Tablero y tramos ---------- */

require('./tramos')(app, asyncH);

/* ---------- Áreas de trabajo ---------- */

const TIPOS_AREA = ['taller', 'obra', 'oficina', 'pintura', 'transporte', 'otro'];

function leerArea(b, parcial) {
  const out = {};
  if (!parcial || 'nombre' in b) {
    const nombre = String(b.nombre || '').trim();
    if (!nombre || nombre.length > 80) throw Object.assign(new Error('El nombre es obligatorio (máx. 80)'), { status: 400 });
    out.nombre = nombre;
  }
  if (!parcial || 'tipo' in b) {
    const tipo = b.tipo || 'taller';
    if (!TIPOS_AREA.includes(tipo)) throw Object.assign(new Error('Tipo de área no válido'), { status: 400 });
    out.tipo = tipo;
  }
  if ('ubicacion' in b) out.ubicacion = String(b.ubicacion || '').trim().slice(0, 200) || null;
  if ('activo' in b) out.activo = !!b.activo;
  if ('orden' in b) out.orden = Number(b.orden) || 0;
  return out;
}

app.get('/api/areas', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.tipo, l.ubicacion, l.orden, l.activo,
            (SELECT count(*)::int FROM tareas t WHERE t.linea_id = l.id AND t.estado <> 'hecha')
          + (SELECT count(*)::int FROM tramos x WHERE x.linea_id = l.id AND x.fecha >= CURRENT_DATE) AS tareas_abiertas
       FROM lineas l ORDER BY l.activo DESC, l.orden, l.nombre`);
  res.json({ tipos: TIPOS_AREA, areas: rows });
}));

app.post('/api/areas', auth.puedeEditar, asyncH(async (req, res) => {
  const a = leerArea(req.body || {}, false);
  const { rows } = await query(
    `INSERT INTO lineas (nombre, tipo, ubicacion, orden)
     VALUES ($1, $2, $3, COALESCE((SELECT max(orden) FROM lineas), 0) + 1) RETURNING *`,
    [a.nombre, a.tipo, a.ubicacion ?? null]);
  res.status(201).json(rows[0]);
}));

app.patch('/api/areas/:id', auth.puedeEditar, asyncH(async (req, res) => {
  const a = leerArea(req.body || {}, true);
  const cols = Object.keys(a);
  if (!cols.length) return res.status(400).json({ error: 'Nada que cambiar' });
  const { rows } = await query(
    `UPDATE lineas SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
    [Number(req.params.id), ...cols.map((k) => a[k])]);
  if (!rows.length) return res.status(404).json({ error: 'Área no encontrada' });
  res.json(rows[0]);
}));

// Reordenar: recibe la lista de ids en el orden deseado
app.put('/api/areas/orden', auth.puedeEditar, asyncH(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  await tx(async (c) => {
    for (let i = 0; i < ids.length; i++) await c.query('UPDATE lineas SET orden = $2 WHERE id = $1', [ids[i], i + 1]);
  });
  res.json({ ok: true });
}));

// Borrar solo si nunca se ha usado; si tiene tareas, se desactiva
app.delete('/api/areas/:id', auth.puedeEditar, asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await query(
    `SELECT (SELECT count(*) FROM tareas WHERE linea_id = $1) + (SELECT count(*) FROM tramos WHERE linea_id = $1) AS n`, [id]);
  if (rows[0].n > 0) {
    await query('UPDATE lineas SET activo = FALSE WHERE id = $1', [id]);
    return res.json({ ok: true, desactivada: true });
  }
  await query('DELETE FROM lineas WHERE id = $1', [id]);
  res.json({ ok: true, borrada: true });
}));

/* ---------- Editar tarea (datos y estado; la planificación va por tramos) ---------- */

app.patch('/api/tareas/:id', auth.puedeEditar, asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const cambios = {};
  const mal = (msg) => res.status(400).json({ error: msg });

  if ('linea_id' in b) cambios.linea_id = b.linea_id ? Number(b.linea_id) : null;
  if ('estado' in b) {
    if (!['pendiente', 'en_curso', 'hecha'].includes(b.estado)) return mal('Estado no válido');
    cambios.estado = b.estado;
  }
  if ('nombre' in b) {
    const n = String(b.nombre || '').trim();
    if (!n || n.length > 120) return mal('El nombre de la tarea es obligatorio');
    cambios.nombre = n;
  }
  if ('duracion_h' in b) {
    const d = Number(b.duracion_h);
    if (!(d > 0 && d <= 999 && (d * 2) % 1 === 0)) return mal('Horas no válidas (en medias horas)');
    cambios.duracion_h = d;
  }
  if ('operarios_req' in b) {
    const o = Number(b.operarios_req);
    if (!Number.isInteger(o) || o < 0 || o > 50) return mal('Operarios no válidos');
    cambios.operarios_req = o;
  }
  if ('notas' in b) {
    const n = String(b.notas ?? '').trim();
    if (n.length > 4000) return mal('Notas: máximo 4000 caracteres');
    cambios.notas = n || null;
  }
  // Una tarea marcada «ya no está en el presupuesto» se puede volver a dar por buena
  if ('baja_presupuesto' in b) cambios.baja_presupuesto = !!b.baja_presupuesto;
  const requisitos = Array.isArray(b.requisitos) ? b.requisitos.map(Number) : null;
  const requisitosTipo = leerRequisitosTipo(b.requisitos_tipo);
  if (!Object.keys(cambios).length && !requisitos && !requisitosTipo) return mal('Nada que cambiar');

  const tarea = await tx(async (c) => {
    const { rows: prev } = await c.query('SELECT id FROM tareas WHERE id = $1 FOR UPDATE', [id]);
    if (!prev.length) return null;
    // duracion_h es la ESTIMACIÓN: puede quedar por debajo de lo planificado (se ve como exceso)
    const cols = Object.keys(cambios);
    const sets = cols.map((k, i) => `${k} = $${i + 2}`).join(', ');
    const { rows } = await c.query(
      `UPDATE tareas SET ${sets}${cols.length ? ',' : ''} actualizado = now(), actualizado_por = $${cols.length + 2}
        WHERE id = $1 RETURNING *`,
      [id, ...cols.map((k) => cambios[k]), req.usuario.id]);
    if (requisitos) {
      await c.query('DELETE FROM tarea_requisitos WHERE tarea_id = $1', [id]);
      for (const r of requisitos) await c.query('INSERT INTO tarea_requisitos VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, r]);
      cambios.requisitos = requisitos;
    }
    if (requisitosTipo) {
      await c.query('DELETE FROM tarea_requisitos_tipo WHERE tarea_id = $1', [id]);
      for (const q of requisitosTipo) {
        await c.query('INSERT INTO tarea_requisitos_tipo (tarea_id, tipo_recurso_id, cantidad) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
          [id, q.id, q.cantidad]);
      }
      cambios.requisitos_tipo = requisitosTipo;
    }
    await c.query('INSERT INTO historial (usuario_id, tarea_id, accion, detalle) VALUES ($1,$2,$3,$4)',
      [req.usuario.id, id, 'estado' in cambios ? 'estado' : 'editar', cambios]);
    return rows[0];
  });
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  res.json(tarea);
}));

/* ---------- Proyectos, OTs y tareas ---------- */

require('./gestion')(app, asyncH);
require('./recursos')(app, asyncH);
require('./importar')(app, asyncH);

/* ---------- Historial ---------- */

app.get('/api/tareas/:id/historial', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT h.accion, h.detalle, h.creado, u.nombre AS usuario
       FROM historial h LEFT JOIN usuarios u ON u.id = h.usuario_id
      WHERE h.tarea_id = $1 ORDER BY h.creado DESC LIMIT 20`, [Number(req.params.id)]);
  res.json(rows);
}));

/* ---------- Estáticos y errores ---------- */

// no-cache: el navegador revalida siempre (ETag), así tras cada actualización
// nadie se queda con un JavaScript antiguo que no entiende los datos nuevos
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'no-cache'),
}));

app.use((err, req, res, next) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  if (err.code === '23505') return res.status(409).json({ error: 'Ya existe un registro con ese nombre' });
  if (err.code === '23503') return res.status(400).json({ error: 'Referencia no válida' });
  console.error(err);
  res.status(500).json({ error: 'Error interno' });
});

const PORT = Number(process.env.PORT || 3000);

(async () => {
  await esperarBD();
  await migrar();
  await auth.asegurarAdmin();
  app.listen(PORT, () => console.log(`s360_planificacion escuchando en :${PORT}`));
})().catch((e) => { console.error(e); process.exit(1); });
