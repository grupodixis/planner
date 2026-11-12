// Alta, baja y modificación de recursos: operarios, maquinaria y subcontratas / alquileres.
const { query } = require('./db');
const auth = require('./auth');

const TIPOS = ['operario', 'maquina', 'subcontrata'];
const fallo = (status, msg) => Object.assign(new Error(msg), { status });

// Campos editables y su longitud máxima (los que no aplican a un tipo simplemente no se muestran)
const TEXTOS = { nombre: 80, codigo: 30, categoria: 60, empresa: 120, telefono: 40, email: 120, notas: 2000 };

function leer(b, parcial) {
  const r = {};
  for (const [k, max] of Object.entries(TEXTOS)) {
    if (!parcial || k in b) {
      const v = String(b[k] ?? '').trim();
      if (v.length > max) throw fallo(400, `${k}: máximo ${max} caracteres`);
      r[k] = v || null;
    }
  }
  if ('nombre' in r && !r.nombre) throw fallo(400, 'El nombre es obligatorio');
  if (!parcial || 'coste_hora' in b) {
    if (b.coste_hora === '' || b.coste_hora == null) r.coste_hora = null;
    else {
      const c = Number(String(b.coste_hora).replace(',', '.'));
      if (!Number.isFinite(c) || c < 0 || c > 99999) throw fallo(400, 'Coste no válido');
      r.coste_hora = c;
    }
  }
  if (!parcial || 'linea_id' in b) r.linea_id = b.linea_id ? Number(b.linea_id) : null;
  if ('activo' in b) r.activo = !!b.activo;
  if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) throw fallo(400, 'Email no válido');
  return r;
}

module.exports = function montar(app, asyncH) {
  app.get('/api/recursos', asyncH(async (req, res) => {
    const vals = [];
    let where = '';
    if (req.query.tipo) {
      if (!TIPOS.includes(req.query.tipo)) throw fallo(400, 'Tipo no válido');
      vals.push(req.query.tipo);
      where = 'WHERE r.tipo = $1';
    }
    const { rows } = await query(
      `SELECT r.*, l.nombre AS area_nombre,
              (SELECT count(*)::int FROM tramo_asignaciones a WHERE a.recurso_id = r.id) AS usos,
              (SELECT count(*)::int FROM tarea_requisitos q WHERE q.recurso_id = r.id) AS requerido,
              (SELECT min(t.fecha) FROM tramo_asignaciones a JOIN tramos t ON t.id = a.tramo_id
                WHERE a.recurso_id = r.id AND t.fecha >= CURRENT_DATE) AS proximo,
              (SELECT max(t.fecha) FROM tramo_asignaciones a JOIN tramos t ON t.id = a.tramo_id
                WHERE a.recurso_id = r.id AND t.fecha < CURRENT_DATE) AS ultimo,
              (SELECT COALESCE(sum(COALESCE(a.hasta, t.hora_inicio + t.duracion_h) - COALESCE(a.desde, t.hora_inicio)), 0)::float
                 FROM tramo_asignaciones a JOIN tramos t ON t.id = a.tramo_id
                WHERE a.recurso_id = r.id AND t.fecha BETWEEN CURRENT_DATE AND CURRENT_DATE + 13) AS horas_14d
         FROM recursos r LEFT JOIN lineas l ON l.id = r.linea_id
         ${where}
        ORDER BY r.activo DESC, r.nombre`, vals);
    res.json(rows);
  }));

  app.post('/api/recursos', auth.puedeEditar, asyncH(async (req, res) => {
    const b = req.body || {};
    if (!TIPOS.includes(b.tipo)) throw fallo(400, 'Tipo no válido');
    const r = leer(b, false);
    const cols = Object.keys(r);
    const { rows } = await query(
      `INSERT INTO recursos (tipo, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
      [b.tipo, ...cols.map((k) => r[k])]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/recursos/:id', auth.puedeEditar, asyncH(async (req, res) => {
    const r = leer(req.body || {}, true);
    const cols = Object.keys(r);
    if (!cols.length) throw fallo(400, 'Nada que cambiar');
    const { rows } = await query(
      `UPDATE recursos SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
      [Number(req.params.id), ...cols.map((k) => r[k])]);
    if (!rows.length) throw fallo(404, 'Recurso no encontrado');
    res.json(rows[0]);
  }));

  // Baja: si se ha usado alguna vez (tramos o requisitos) se da de baja (inactivo) para no
  // perder el histórico; si nunca se ha usado, se borra.
  app.delete('/api/recursos/:id', auth.puedeEditar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(
      `SELECT (SELECT count(*) FROM tramo_asignaciones WHERE recurso_id = $1)
            + (SELECT count(*) FROM tarea_requisitos WHERE recurso_id = $1) AS n`, [id]);
    if (Number(rows[0].n) > 0) {
      const { rows: r } = await query('UPDATE recursos SET activo = FALSE WHERE id = $1 RETURNING id', [id]);
      if (!r.length) throw fallo(404, 'Recurso no encontrado');
      return res.json({ ok: true, desactivado: true });
    }
    const { rowCount } = await query('DELETE FROM recursos WHERE id = $1', [id]);
    if (!rowCount) throw fallo(404, 'Recurso no encontrado');
    res.json({ ok: true, borrado: true });
  }));
};
