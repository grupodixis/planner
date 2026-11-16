// Lo mínimo de materiales: qué materiales y herramientas hacen falta para cada tarea.
// Una lista por tarea; la ve quien planifica en Proyectos (y, en el siguiente paso, el operario en Mi día).
const { query } = require('./db');
const auth = require('./auth');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max) => String(v ?? '').trim().slice(0, max) || null;
const TIPOS = ['material', 'herramienta'];

function leer(b, parcial) {
  const o = {};
  if (!parcial || 'tipo' in b) {
    o.tipo = TIPOS.includes(b.tipo) ? b.tipo : parcial ? undefined : 'material';
    if (o.tipo === undefined) throw fallo(400, 'Tipo no válido');
  }
  if (!parcial || 'descripcion' in b) {
    o.descripcion = texto(b.descripcion, 200);
    if (!o.descripcion) throw fallo(400, 'Escribe qué hace falta');
  }
  if ('cantidad' in b) {
    const n = b.cantidad == null || b.cantidad === '' ? null : Number(String(b.cantidad).replace(',', '.'));
    if (n != null && !(n > 0 && n < 1e7)) throw fallo(400, 'Cantidad no válida');
    o.cantidad = n;
  }
  if ('unidad' in b) o.unidad = texto(b.unidad, 20);
  if ('nota' in b) o.nota = texto(b.nota, 300);
  return o;
}

module.exports = function montar(app, asyncH) {
  const editar = auth.permiso('planificar', 'proyectos');

  app.get('/api/tareas/:id/llevar', asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT id, tipo, descripcion, cantidad, unidad, nota FROM tarea_llevar
        WHERE tarea_id = $1 ORDER BY tipo = 'herramienta', orden, id`, [Number(req.params.id)]);
    res.json(rows);
  }));

  app.post('/api/tareas/:id/llevar', editar, asyncH(async (req, res) => {
    const tareaId = Number(req.params.id);
    const { rows: t } = await query('SELECT 1 FROM tareas WHERE id = $1', [tareaId]);
    if (!t.length) throw fallo(404, 'Tarea no encontrada');
    const o = leer(req.body || {}, false);
    const { rows } = await query(
      `INSERT INTO tarea_llevar (tarea_id, tipo, descripcion, cantidad, unidad, nota, orden, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT max(orden) FROM tarea_llevar WHERE tarea_id = $1), 0) + 1, $7)
       RETURNING id, tipo, descripcion, cantidad, unidad, nota`,
      [tareaId, o.tipo, o.descripcion, o.cantidad ?? null, o.unidad ?? null, o.nota ?? null, req.usuario.id]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/llevar/:id', editar, asyncH(async (req, res) => {
    const o = leer(req.body || {}, true);
    const cols = Object.keys(o);
    if (!cols.length) throw fallo(400, 'Nada que cambiar');
    const { rows } = await query(
      `UPDATE tarea_llevar SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1
       RETURNING id, tipo, descripcion, cantidad, unidad, nota`, [Number(req.params.id), ...cols.map((k) => o[k])]);
    if (!rows.length) throw fallo(404, 'Línea no encontrada');
    res.json(rows[0]);
  }));

  app.delete('/api/llevar/:id', editar, asyncH(async (req, res) => {
    await query('DELETE FROM tarea_llevar WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));
};
