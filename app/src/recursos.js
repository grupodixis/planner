// Alta, baja y modificación de recursos: operarios, maquinaria y subcontratas / alquileres.
const { query, tx } = require('./db');
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
  if ('vinculo' in b) {
    if (!['plantilla', 'subcontratado'].includes(b.vinculo)) throw fallo(400, 'Vínculo no válido');
    r.vinculo = b.vinculo;
  }
  if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) throw fallo(400, 'Email no válido');
  return r;
}

// Sustituye los tipos de un recurso. Solo se admiten tipos de su misma clase.
async function guardarTipos(c, recursoId, clase, ids) {
  const lista = [...new Set(ids.map(Number).filter(Boolean))];
  if (lista.length) {
    const { rows } = await c.query('SELECT count(*)::int AS n FROM tipos_recurso WHERE id = ANY($1) AND clase = $2', [lista, clase]);
    if (rows[0].n !== lista.length) throw fallo(400, 'Algún tipo no existe o es de otra clase de recurso');
  }
  await c.query('DELETE FROM recurso_tipos WHERE recurso_id = $1', [recursoId]);
  for (const t of lista) await c.query('INSERT INTO recurso_tipos (recurso_id, tipo_recurso_id) VALUES ($1,$2)', [recursoId, t]);
}

module.exports = function montar(app, asyncH) {
  /* ---------- Tipos de recurso (oficios, tipos de máquina, tipos de subcontrata) ---------- */
  app.get('/api/tipos-recurso', asyncH(async (req, res) => {
    const vals = [];
    let where = '';
    if (req.query.clase) {
      if (!TIPOS.includes(req.query.clase)) throw fallo(400, 'Clase no válida');
      vals.push(req.query.clase);
      where = 'WHERE t.clase = $1';
    }
    const { rows } = await query(
      `SELECT t.*,
              COALESCE((SELECT json_agg(json_build_object('id', r.id, 'nombre', r.nombre, 'activo', r.activo) ORDER BY r.nombre)
                          FROM recurso_tipos rt JOIN recursos r ON r.id = rt.recurso_id
                         WHERE rt.tipo_recurso_id = t.id), '[]') AS recursos,
              (SELECT count(*)::int FROM tarea_requisitos_tipo q WHERE q.tipo_recurso_id = t.id) AS tareas
         FROM tipos_recurso t ${where}
        ORDER BY t.clase, lower(t.nombre)`, vals);
    res.json(rows);
  }));

  app.post('/api/tipos-recurso', auth.puedeEditar, asyncH(async (req, res) => {
    const b = req.body || {};
    if (!TIPOS.includes(b.clase)) throw fallo(400, 'Clase no válida');
    const nombre = String(b.nombre || '').trim().replace(/\s+/g, ' ');
    if (!nombre || nombre.length > 60) throw fallo(400, 'El nombre es obligatorio (máx. 60)');
    const { rows } = await query('INSERT INTO tipos_recurso (clase, nombre) VALUES ($1,$2) RETURNING *', [b.clase, nombre]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/tipos-recurso/:id', auth.puedeEditar, asyncH(async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim().replace(/\s+/g, ' ');
    if (!nombre || nombre.length > 60) throw fallo(400, 'El nombre es obligatorio (máx. 60)');
    const { rows } = await query('UPDATE tipos_recurso SET nombre = $2 WHERE id = $1 RETURNING *', [Number(req.params.id), nombre]);
    if (!rows.length) throw fallo(404, 'Tipo no encontrado');
    res.json(rows[0]);
  }));

  // Un tipo que piden tareas no se borra (se perdería el requisito); si solo lo tienen recursos, sí
  app.delete('/api/tipos-recurso/:id', auth.puedeEditar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query('SELECT count(*)::int AS n FROM tarea_requisitos_tipo WHERE tipo_recurso_id = $1', [id]);
    if (rows[0].n) throw fallo(409, `Lo piden ${rows[0].n} tarea(s): quítalo de sus requisitos antes de borrarlo`);
    const { rowCount } = await query('DELETE FROM tipos_recurso WHERE id = $1', [id]);
    if (!rowCount) throw fallo(404, 'Tipo no encontrado');
    res.json({ ok: true });
  }));

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
              COALESCE((SELECT json_agg(json_build_object('id', t.id, 'nombre', t.nombre) ORDER BY lower(t.nombre))
                          FROM recurso_tipos rt JOIN tipos_recurso t ON t.id = rt.tipo_recurso_id
                         WHERE rt.recurso_id = r.id), '[]') AS tipos,
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
    const out = await tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO recursos (tipo, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')}) RETURNING *`,
        [b.tipo, ...cols.map((k) => r[k])]);
      if (Array.isArray(b.tipos)) await guardarTipos(c, rows[0].id, b.tipo, b.tipos);
      return rows[0];
    });
    res.status(201).json(out);
  }));

  app.patch('/api/recursos/:id', auth.puedeEditar, asyncH(async (req, res) => {
    const b = req.body || {};
    const r = leer(b, true);
    const cols = Object.keys(r);
    let tipos = Array.isArray(b.tipos) ? b.tipos : null;
    const id = Number(req.params.id);
    // Cambio de clase (p. ej. una subcontrata que en realidad es una persona que trabaja de
    // operario): sus tipos eran de la otra clase, así que se sustituyen (o se vacían)
    if ('tipo' in b) {
      if (!TIPOS.includes(b.tipo)) throw fallo(400, 'Tipo no válido');
      const { rows: act } = await query('SELECT tipo FROM recursos WHERE id = $1', [id]);
      if (!act.length) throw fallo(404, 'Recurso no encontrado');
      if (act[0].tipo !== b.tipo) {
        r.tipo = b.tipo;
        cols.push('tipo');
        if (b.tipo !== 'operario' && !('vinculo' in r)) { r.vinculo = 'plantilla'; cols.push('vinculo'); }
        if (!tipos) tipos = [];
      }
    }
    if (!cols.length && !tipos) throw fallo(400, 'Nada que cambiar');
    const out = await tx(async (c) => {
      const { rows } = cols.length
        ? await c.query(`UPDATE recursos SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`,
          [id, ...cols.map((k) => r[k])])
        : await c.query('SELECT * FROM recursos WHERE id = $1', [id]);
      if (!rows.length) throw fallo(404, 'Recurso no encontrado');
      if (tipos) await guardarTipos(c, id, rows[0].tipo, tipos);
      return rows[0];
    });
    res.json(out);
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
