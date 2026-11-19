const path = require('path');
const express = require('express');
const { query, tx, esperarBD } = require('./db');
const auth = require('./auth');
const { leerRequisitosTipo } = require('./gestion');
const { migrar } = require('./migraciones');

const app = express();
app.disable('x-powered-by');
// Detrás de nginx/Docker la IP real llega en X-Forwarded-For (para el bloqueo de intentos)
app.set('trust proxy', 'loopback, uniquelocal');
// La importación de proyectos admite archivos grandes; el resto, 100 kB
app.use('/api/importar', express.json({ limit: '2mb' }));
app.use('/api/semillero', express.json({ limit: '1mb' }));
app.use(express.json({ limit: '100kb' }));
const eventos = require('./eventos');
app.use(eventos.notificador);   // avisa en vivo a las demás pantallas abiertas

const asyncH = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Versión desplegada (la escribe desplegar-vps.sh con el commit de GitHub); «dev» en el PC
const VERSION = (() => { try { return require('fs').readFileSync(path.join(__dirname, '..', 'public', 'version.txt'), 'utf8').trim(); } catch { return 'dev'; } })();
app.get('/health', (req, res) => res.json({ ok: true, version: VERSION }));

/* ---------- Autenticación ---------- */

require('./pin').publico(app, asyncH);   // entrar con PIN desde un dispositivo autorizado (sin sesión)
require('./ofertas-portal').montar(app, asyncH);   // el proveedor responde la petición de precio (enlace sin sesión)
require('./seguimiento-ext').montarPublico(app, asyncH);   // el taller externo cuenta cómo van sus tareas (enlace sin sesión)
require('./usuarios')(app, asyncH);   // entrar, recuperar contraseña, Mi cuenta, usuarios y roles
require('./pin').gestion(app, asyncH);   // PIN de operarios y dispositivos autorizados
require('./archivos').montar(app, asyncH);   // fotos y documentos (justificantes, incidencias)
require('./operario').montar(app, asyncH);   // app del operario: vacaciones, avisos, justificantes, su mes
require('./capturas').montar(app, asyncH);
require('./notificaciones').montar(app, asyncH);   // avisos al móvil (push) y avisos programados   // bandeja de capturas (texto, audio, foto, vídeo) → tarea / asunto / info
eventos.montar(app);   // GET /api/eventos (con sesión)

/* ---------- Tablero y tramos ---------- */

require('./partes').montar(app, asyncH);
require('./midia').montar(app, asyncH);   // «Mi día» de cada operario y lo que declara para el parte   // parte del día (va antes: protege lo ya cerrado)
require('./tramos')(app, asyncH);
// sin permiso «costes», los informes salen sin euros (coste, coste/hora, importe, margen)
app.use('/api/informes', (req, res, next) => {
  if (auth.tiene(req.usuario, 'costes')) return next();
  const quitar = (v) => {
    if (Array.isArray(v)) return v.map(quitar);
    if (!v || typeof v !== 'object') return v;
    const o = {};
    for (const [k, x] of Object.entries(v)) if (!/^(coste|importe|margen)/.test(k) && k !== 'recursos_sin_coste') o[k] = quitar(x);
    return o;
  };
  const json = res.json.bind(res);
  res.json = (d) => json(quitar(d));
  next();
});
require('./informes').montar(app, asyncH);   // informes de horas y costes
require('./costes').montar(app, asyncH);   // control de costes y tiempos por proyecto
require('./compras').montar(app, asyncH);   // proveedores y pedidos de compra
require('./solicitudes').montar(app, asyncH);   // peticiones de precio a proveedores
require('./ausencias').montar(app, asyncH);   // vacaciones, bajas, averías y festivos

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
  if ('descripcion' in b) out.descripcion = String(b.descripcion || '').trim().slice(0, 200) || null;
  if ('departamento_id' in b) out.departamento_id = b.departamento_id ? Number(b.departamento_id) : null;
  if ('exclusiva' in b) out.exclusiva = !!b.exclusiva;
  if ('activo' in b) out.activo = !!b.activo;
  if ('orden' in b) out.orden = Number(b.orden) || 0;
  // otros elementos fijos del área (carpa, compresor…), en texto
  if ('equipamiento' in b) {
    out.equipamiento = [...new Set((Array.isArray(b.equipamiento) ? b.equipamiento : [])
      .map((x) => String(x || '').trim().slice(0, 120)).filter(Boolean))].slice(0, 40);
  }
  return out;
}

// Áreas fijas (taller, cabina, oficina…). Las obras van con su proyecto (ficha del proyecto);
// aquí solo se listan aparte las que se han quedado sin proyecto.
app.get('/api/areas', asyncH(async (req, res) => {
  const { rows } = await query(
    `SELECT l.id, l.nombre, l.tipo, l.ubicacion, l.orden, l.activo, l.proyecto_id, l.departamento_id, l.exclusiva, l.descripcion, l.equipamiento,
            COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nombre', r.nombre) ORDER BY r.nombre)
                        FROM recursos r WHERE r.linea_id = l.id AND r.fijo_area AND r.activo), '[]') AS maquinas,
            (SELECT count(*)::int FROM tareas t WHERE t.linea_id = l.id AND t.estado <> 'hecha')
          + (SELECT count(*)::int FROM tramos x WHERE x.linea_id = l.id AND x.fecha >= CURRENT_DATE) AS tareas_abiertas,
            (SELECT count(*)::int FROM tareas t WHERE t.linea_id = l.id)
          + (SELECT count(*)::int FROM tramos x WHERE x.linea_id = l.id) AS usos
       FROM lineas l LEFT JOIN departamentos d ON d.id = l.departamento_id
      WHERE l.tipo <> 'obra' OR l.proyecto_id IS NULL
      ORDER BY l.activo DESC, d.orden NULLS LAST, l.orden, l.nombre`);
  const { rows: departamentos } = await query('SELECT id, clave, nombre FROM departamentos ORDER BY orden, nombre');
  // máquinas que se pueden dejar fijas en un área
  const { rows: maquinas } = await query(
    `SELECT r.id, r.nombre, r.linea_id, r.fijo_area FROM recursos r WHERE r.activo AND r.tipo = 'maquina' ORDER BY r.nombre`);
  res.json({
    departamentos, maquinas,
    tipos: TIPOS_AREA.filter((t) => t !== 'obra'),
    areas: rows.filter((a) => a.tipo !== 'obra'),
    obras_sin_proyecto: rows.filter((a) => a.tipo === 'obra'),
  });
}));

const OBRA_DESDE_PROYECTO = 'Las obras se crean desde la ficha del proyecto (Proyectos y OTs)';

app.post('/api/areas', auth.permiso('recursos'), asyncH(async (req, res) => {
  const a = leerArea(req.body || {}, false);
  if (a.tipo === 'obra') return res.status(400).json({ error: OBRA_DESDE_PROYECTO });
  const { rows } = await query(
    `INSERT INTO lineas (nombre, tipo, ubicacion, orden, departamento_id, exclusiva)
     VALUES ($1, $2, $3, COALESCE((SELECT max(orden) FROM lineas), 0) + 1, $4, $5) RETURNING *`,
    [a.nombre, a.tipo, a.ubicacion ?? null, a.departamento_id ?? null, !!a.exclusiva]);
  res.status(201).json(rows[0]);
}));

app.patch('/api/areas/:id', auth.permiso('recursos'), asyncH(async (req, res) => {
  const a = leerArea(req.body || {}, true);
  if ('tipo' in a) {
    const { rows: act } = await query('SELECT tipo, proyecto_id FROM lineas WHERE id = $1', [Number(req.params.id)]);
    if (act.length && (a.tipo === 'obra') !== (act[0].tipo === 'obra')) {
      return res.status(400).json({ error: a.tipo === 'obra' ? OBRA_DESDE_PROYECTO : 'Una obra no puede pasar a área fija' });
    }
  }
  const cols = Object.keys(a);
  if (!cols.length) return res.status(400).json({ error: 'Nada que cambiar' });
  const { rows } = await query(
    `UPDATE lineas SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
    [Number(req.params.id), ...cols.map((k) => a[k])]);
  if (!rows.length) return res.status(404).json({ error: 'Área no encontrada' });
  res.json(rows[0]);
}));

// Máquinas fijas del área: { ids } (las que estaban y ya no, dejan de ser fijas)
app.put('/api/areas/:id/maquinas', auth.permiso('recursos'), asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  await tx(async (c) => {
    await c.query('UPDATE recursos SET fijo_area = FALSE WHERE linea_id = $1 AND fijo_area AND NOT (id = ANY($2::int[]))', [id, ids]);
    if (ids.length) await c.query(`UPDATE recursos SET fijo_area = TRUE, linea_id = $1 WHERE id = ANY($2::int[]) AND tipo = 'maquina'`, [id, ids]);
  });
  res.json({ ok: true });
}));

// Reordenar: recibe la lista de ids en el orden deseado
app.put('/api/areas/orden', auth.permiso('recursos'), asyncH(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number) : [];
  await tx(async (c) => {
    for (let i = 0; i < ids.length; i++) await c.query('UPDATE lineas SET orden = $2 WHERE id = $1', [ids[i], i + 1]);
  });
  res.json({ ok: true });
}));

// Borrar solo si nunca se ha usado; si tiene tareas, se desactiva
app.delete('/api/areas/:id', auth.permiso('recursos'), asyncH(async (req, res) => {
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

app.patch('/api/tareas/:id', auth.permiso('planificar', 'proyectos'), asyncH(async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  const cambios = {};
  const mal = (msg) => res.status(400).json({ error: msg });

  if ('linea_id' in b) cambios.linea_id = b.linea_id ? Number(b.linea_id) : null;
  // taller externo: proveedor_id (o elegir su área). Avance y nota de cómo va fuera.
  if ('proveedor_id' in b) cambios.proveedor_id = b.proveedor_id ? Number(b.proveedor_id) : null;
  if ('ext_avance' in b) {
    const a = b.ext_avance === '' || b.ext_avance == null ? null : Math.round(Number(b.ext_avance));
    if (a != null && !(a >= 0 && a <= 100)) return mal('Avance entre 0 y 100');
    cambios.ext_avance = a;
  }
  if ('ext_nota' in b) cambios.ext_nota = String(b.ext_nota ?? '').trim().slice(0, 300) || null;
  if ('ext_avance' in b || 'ext_nota' in b) cambios.ext_actualizado = new Date();
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
  const capacidades = require('./capacidades').leer(b.capacidades);
  if (!Object.keys(cambios).length && !requisitos && !requisitosTipo && !capacidades) return mal('Nada que cambiar');

  const tarea = await tx(async (c) => {
    const { rows: prev } = await c.query('SELECT id FROM tareas WHERE id = $1 FOR UPDATE', [id]);
    if (!prev.length) return null;
    // el área y el taller van juntos: un taller externo tiene su área; un área propia quita el taller
    if (cambios.proveedor_id) cambios.linea_id = await require('./externos').areaExterna(c, cambios.proveedor_id);
    else if ('linea_id' in cambios && !('proveedor_id' in cambios)) {
      const { rows: l } = cambios.linea_id ? await c.query('SELECT tipo, proveedor_id FROM lineas WHERE id = $1', [cambios.linea_id]) : { rows: [] };
      cambios.proveedor_id = l[0]?.tipo === 'externo' ? l[0].proveedor_id : null;
    }
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
    if (capacidades) {
      await c.query('DELETE FROM tarea_capacidades WHERE tarea_id = $1', [id]);
      for (const q of capacidades) {
        await c.query('INSERT INTO tarea_capacidades (tarea_id, capacidad_id, cantidad) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [id, q.id, q.cantidad]);
      }
      cambios.capacidades = capacidades;
    }
    // dada por hecha antes de tiempo: se quitan los tramos que quedaban (desde mañana) si así se pide
    if (cambios.estado === 'hecha') {
      await c.query('UPDATE tareas SET hecha_en = now(), hecha_por = $2 WHERE id = $1', [id, req.usuario.id]);
      if (b.quitar_futuros) {
        const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
        const { rowCount } = await c.query(
          `DELETE FROM tramos x WHERE x.tarea_id = $1 AND x.fecha > $2 AND x.cierre IS NULL
              AND NOT EXISTS (SELECT 1 FROM dias_cerrados d WHERE d.fecha = x.fecha)`, [id, hoy]);
        cambios.tramos_quitados = rowCount;
      }
    } else if (cambios.estado) {
      await c.query('UPDATE tareas SET hecha_en = NULL, hecha_por = NULL WHERE id = $1', [id]);
    }
    await c.query('INSERT INTO historial (usuario_id, tarea_id, accion, detalle) VALUES ($1,$2,$3,$4)',
      [req.usuario.id, id, 'estado' in cambios ? 'estado' : 'editar', cambios]);
    return { ...rows[0], tramos_quitados: cambios.tramos_quitados || 0 };
  });
  if (!tarea) return res.status(404).json({ error: 'Tarea no encontrada' });
  res.json(tarea);
}));

/* ---------- Proyectos, OTs y tareas ---------- */

require('./gestion')(app, asyncH);
require('./seguimiento-ext').montarGestion(app, asyncH);   // «Comenzar seguimiento» con los talleres externos
require('./recursos')(app, asyncH);
require('./importar')(app, asyncH);
require('./semillero')(app, asyncH);
require('./catalogo').montar(app, asyncH);   // catálogo de materiales y herramientas
require('./material').montar(app, asyncH);
require('./capacidades').montar(app, asyncH);   // capacidades (saber hacer) de las personas   // escandallo, asignación a tareas, stock y compras

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
  await require('./correo').cargar().catch((e) => console.error('Correo:', e.message));
  await auth.asegurarAdmin();
  await require('./capacidades').sembrar().catch((e) => console.error('Capacidades:', e.message));
  await require('./catalogo').sembrar().catch((e) => console.error('Catálogo base:', e.message));
  app.listen(PORT, () => console.log(`s360_planificacion escuchando en :${PORT}`));
})().catch((e) => { console.error(e); process.exit(1); });
