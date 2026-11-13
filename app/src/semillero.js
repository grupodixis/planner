// Carga del semillero de recursos de la empresa (formato s360-semillero/1, ver semillero/README.md).
//
// POST /api/semillero?simular=1 → vista previa (no cambia nada)
// POST /api/semillero           → aplica
//
// Deja áreas fijas, tipos de recurso y recursos como dice el archivo, sin perder lo planificado:
// - renombra lo que ya existe (por ref, nombre o «antes») en vez de crearlo de nuevo;
// - fusiona tipos duplicados (los alias) moviendo sus requisitos y recursos al tipo bueno;
// - lo que sobra se borra si no se ha usado y, si se usó, se desactiva (sigue en el historial);
// - las obras (áreas de proyecto) no se tocan.
// Igual que la importación: todo dentro de una transacción; la simulación se deshace al final.
const Ajv2020 = require('ajv/dist/2020');
const { pool } = require('./db');
const auth = require('./auth');
const esquema = require('./semillero-esquema.json'); // copia de semillero/esquema.json

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validar = ajv.compile(esquema);
const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const CLASES = ['operario', 'maquina', 'subcontrata'];

// Comprobaciones que el esquema no hace: refs repetidas y referencias que no existen
function revisar(S) {
  const err = [];
  const deps = new Set(S.departamentos.map((d) => d.clave));
  const refs = new Set();
  const repetida = (r, donde) => { if (refs.has(r)) err.push(`${donde}: ref «${r}» repetida`); refs.add(r); };
  const nombresTipo = Object.fromEntries(CLASES.map((c) => [c, new Set((S.tipos[c] || []).map((t) => norm(t.nombre)))]));
  for (const c of CLASES) {
    const vistos = new Map();
    for (const t of S.tipos[c] || []) {
      for (const n of [t.nombre, ...(t.alias || [])]) {
        const k = norm(n);
        if (vistos.has(k) && vistos.get(k) !== t.nombre) err.push(`tipos.${c}: «${n}» está en «${vistos.get(k)}» y en «${t.nombre}»`);
        vistos.set(k, t.nombre);
      }
    }
  }
  const nombresArea = new Set();
  for (const a of S.areas) {
    repetida(a.ref, 'areas');
    if (!deps.has(a.departamento)) err.push(`área «${a.nombre}»: departamento «${a.departamento}» no existe`);
    if (nombresArea.has(norm(a.nombre))) err.push(`área «${a.nombre}» repetida`);
    nombresArea.add(norm(a.nombre));
  }
  const areas = new Set(S.areas.map((a) => a.ref));
  const nombresRec = new Set();
  for (const r of S.recursos) {
    repetida(r.ref, 'recursos');
    if (r.departamento && !deps.has(r.departamento)) err.push(`«${r.nombre}»: departamento «${r.departamento}» no existe`);
    if (r.area_habitual && !areas.has(r.area_habitual)) err.push(`«${r.nombre}»: área «${r.area_habitual}» no existe`);
    const lista = r.clase === 'operario' ? r.oficios || [] : r.tipos || [];
    if (r.clase === 'operario' && r.tipos?.length) err.push(`«${r.nombre}»: un operario lleva «oficios», no «tipos»`);
    if (r.clase !== 'operario' && r.oficios?.length) err.push(`«${r.nombre}»: solo los operarios llevan «oficios»`);
    for (const t of lista) if (!nombresTipo[r.clase].has(norm(t))) err.push(`«${r.nombre}»: el tipo «${t}» no está en tipos.${r.clase}`);
    const k = `${r.clase}:${norm(r.nombre)}`;
    if (nombresRec.has(k)) err.push(`recurso «${r.nombre}» repetido`);
    nombresRec.add(k);
  }
  return err;
}

async function cargar(c, S) {
  const inf = { departamentos: [], tipos: [], areas: [], recursos: [], tareas: [], avisos: [] };
  const anota = (sec, accion, nombre, detalle) => inf[sec].push({ accion, nombre, ...(detalle ? { detalle } : {}) });
  const alias = async (clase, nombre, destino) => c.query(
    `INSERT INTO import_alias (clase, nombre, destino_id) VALUES ($1, $2, $3)
     ON CONFLICT (clase, nombre) DO UPDATE SET destino_id = EXCLUDED.destino_id`, [clase, norm(nombre), destino]);

  /* 1 · Departamentos */
  const depId = new Map();
  for (const [i, d] of S.departamentos.entries()) {
    const { rows: [ya] } = await c.query('SELECT * FROM departamentos WHERE clave = $1', [d.clave]);
    if (ya) {
      await c.query('UPDATE departamentos SET nombre = $2, orden = $3 WHERE id = $1', [ya.id, d.nombre, i + 1]);
      if (ya.nombre !== d.nombre) anota('departamentos', 'renombrar', d.nombre, `antes «${ya.nombre}»`);
      depId.set(d.clave, ya.id);
    } else {
      const { rows } = await c.query('INSERT INTO departamentos (clave, nombre, orden) VALUES ($1,$2,$3) RETURNING id', [d.clave, d.nombre, i + 1]);
      depId.set(d.clave, rows[0].id);
      anota('departamentos', 'crear', d.nombre);
    }
  }
  {
    const { rows } = await c.query('DELETE FROM departamentos WHERE NOT (clave = ANY($1)) RETURNING nombre', [S.departamentos.map((d) => d.clave)]);
    for (const r of rows) anota('departamentos', 'borrar', r.nombre);
  }

  /* 2 · Tipos de recurso: el nombre bueno + fusionar los alias que existan */
  const tiposDb = (await c.query('SELECT id, clase, nombre FROM tipos_recurso')).rows;
  const tareasDeTipo = async (id) => (await c.query('SELECT count(*)::int AS n FROM tarea_requisitos_tipo WHERE tipo_recurso_id = $1', [id])).rows[0].n;
  const tipoId = new Map();     // `${clase}:${norm(nombre)}` → id
  const tratados = new Set();   // tipos de la BD ya resueltos (usados, fusionados, convertidos o quitados)
  const fusionar = async (de, a) => {
    await c.query(`INSERT INTO recurso_tipos (recurso_id, tipo_recurso_id)
                   SELECT recurso_id, $2 FROM recurso_tipos WHERE tipo_recurso_id = $1 ON CONFLICT DO NOTHING`, [de, a]);
    await c.query(`INSERT INTO tarea_requisitos_tipo (tarea_id, tipo_recurso_id, cantidad)
                   SELECT tarea_id, $2, cantidad FROM tarea_requisitos_tipo WHERE tipo_recurso_id = $1
                   ON CONFLICT (tarea_id, tipo_recurso_id) DO UPDATE SET cantidad = GREATEST(tarea_requisitos_tipo.cantidad, EXCLUDED.cantidad)`, [de, a]);
    await c.query('DELETE FROM tarea_requisitos_tipo WHERE tipo_recurso_id = $1', [de]);
    await c.query(`UPDATE import_alias SET destino_id = $2 WHERE destino_id = $1 AND clase LIKE 'tipo:%'`, [de, a]);
    await c.query('DELETE FROM tipos_recurso WHERE id = $1', [de]);
  };
  for (const clase of CLASES) {
    for (const t of S.tipos[clase] || []) {
      const nombres = new Set([t.nombre, ...(t.alias || [])].map(norm));
      const cand = tiposDb.filter((x) => x.clase === clase && nombres.has(norm(x.nombre)) && !tratados.has(x.id));
      let bueno = cand.find((x) => norm(x.nombre) === norm(t.nombre)) || cand[0];
      if (!bueno) {
        const { rows } = await c.query('INSERT INTO tipos_recurso (clase, nombre) VALUES ($1,$2) RETURNING id', [clase, t.nombre]);
        bueno = { id: rows[0].id, clase, nombre: t.nombre };
        anota('tipos', 'crear', t.nombre, clase);
      } else if (bueno.nombre !== t.nombre) {
        await c.query('UPDATE tipos_recurso SET nombre = $2 WHERE id = $1', [bueno.id, t.nombre]);
        anota('tipos', 'renombrar', t.nombre, `antes «${bueno.nombre}»`);
      }
      tratados.add(bueno.id);
      for (const x of cand) {
        if (x.id === bueno.id) continue;
        const n = await tareasDeTipo(x.id);
        await fusionar(x.id, bueno.id);
        tratados.add(x.id);
        anota('tipos', 'fusionar', t.nombre, `«${x.nombre}»${n ? ` (${n} tarea${n > 1 ? 's' : ''})` : ''}`);
      }
      for (const a of t.alias || []) await alias(`tipo:${clase}`, a, bueno.id);
      tipoId.set(`${clase}:${norm(t.nombre)}`, bueno.id);
    }
  }

  /* 3 · Herramientas sin control: el compositor puede pedirlas pero no son requisito */
  for (const n of S.requisitos_sin_control?.nombres || []) {
    await alias('tipo_ignorado', n, 0);
    for (const x of tiposDb.filter((y) => y.clase !== 'operario' && norm(y.nombre) === norm(n) && !tratados.has(y.id))) {
      const k = await tareasDeTipo(x.id);
      await c.query('DELETE FROM tarea_requisitos_tipo WHERE tipo_recurso_id = $1', [x.id]);
      await c.query('DELETE FROM tipos_recurso WHERE id = $1', [x.id]);
      tratados.add(x.id);
      anota('tipos', 'sin control', x.nombre, k ? `deja de pedirse en ${k} tarea${k > 1 ? 's' : ''}` : null);
    }
  }

  /* 4 · Áreas fijas (las obras son de los proyectos y no se tocan) */
  const areasDb = (await c.query(`SELECT * FROM lineas WHERE tipo <> 'obra' ORDER BY id`)).rows;
  const areaId = new Map();     // ref → id
  const usadas = new Set();
  for (const [i, a] of S.areas.entries()) {
    const libres = areasDb.filter((x) => !usadas.has(x.id));
    const ya = libres.find((x) => x.ref_semilla === a.ref) || libres.find((x) => norm(x.nombre) === norm(a.nombre))
      || libres.find((x) => (a.antes || []).some((n) => norm(n) === norm(x.nombre)));
    const datos = [a.nombre, a.tipo, depId.get(a.departamento), !!a.exclusiva, a.descripcion || null, i + 1, a.ref];
    if (ya) {
      usadas.add(ya.id);
      await c.query(`UPDATE lineas SET nombre = $2, tipo = $3, departamento_id = $4, exclusiva = $5, descripcion = $6, orden = $7,
                            ref_semilla = $8, activo = TRUE ${'ubicacion' in a ? ', ubicacion = $9' : ''} WHERE id = $1`,
      [ya.id, ...datos, ...('ubicacion' in a ? [a.ubicacion || null] : [])]);
      if (ya.nombre !== a.nombre) anota('areas', 'renombrar', a.nombre, `antes «${ya.nombre}»`);
      else if (ya.tipo !== a.tipo || !ya.activo || ya.departamento_id !== depId.get(a.departamento) || ya.exclusiva !== !!a.exclusiva) anota('areas', 'actualizar', a.nombre);
      areaId.set(a.ref, ya.id);
    } else {
      const { rows } = await c.query(
        `INSERT INTO lineas (nombre, tipo, departamento_id, exclusiva, descripcion, orden, ref_semilla, ubicacion)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`, [...datos, a.ubicacion || null]);
      areaId.set(a.ref, rows[0].id);
      anota('areas', 'crear', a.nombre);
    }
    for (const n of a.alias || []) await alias('area', n, areaId.get(a.ref));
    for (const n of a.alias_requisito || []) await alias('area_por_tipo', n, areaId.get(a.ref));
  }
  const sobran = areasDb.filter((x) => !usadas.has(x.id));
  const sobranIds = sobran.map((x) => x.id);
  // Pasar requisitos a área: la tarea va a esa área si no tenía o tenía una que desaparece
  const tareasAlArea = async (sqlTareas, params, area, motivo) => {
    const { rows } = await c.query(
      `UPDATE tareas SET linea_id = $${params.length + 1} WHERE id IN (${sqlTareas})
         AND (linea_id IS NULL OR linea_id = ANY($${params.length + 2})) RETURNING nombre`, [...params, area, sobranIds]);
    if (rows.length) anota('tareas', 'área', S.areas.find((a) => areaId.get(a.ref) === area).nombre, `${rows.length} tarea${rows.length > 1 ? 's' : ''} (${motivo})`);
  };
  for (const a of S.areas) {
    const id = areaId.get(a.ref);
    for (const n of a.alias_requisito || []) {
      for (const x of tiposDb.filter((y) => y.clase !== 'operario' && norm(y.nombre) === norm(n) && !tratados.has(y.id))) {
        const k = await tareasDeTipo(x.id);
        await tareasAlArea('SELECT tarea_id FROM tarea_requisitos_tipo WHERE tipo_recurso_id = $1', [x.id], id, `pedían «${x.nombre}»`);
        await c.query('DELETE FROM tarea_requisitos_tipo WHERE tipo_recurso_id = $1', [x.id]);
        await c.query('DELETE FROM tipos_recurso WHERE id = $1', [x.id]);
        tratados.add(x.id);
        anota('tipos', 'pasa a área', x.nombre, `${a.nombre}${k ? ` · ${k} tarea${k > 1 ? 's' : ''}` : ''}`);
      }
    }
    for (const n of a.antes_recursos || []) {
      const { rows: rs } = await c.query(`SELECT id, nombre FROM recursos WHERE tipo <> 'operario' AND lower(nombre) = lower($1)`, [n]);
      for (const r of rs) {
        await tareasAlArea('SELECT tarea_id FROM tarea_requisitos WHERE recurso_id = $1', [r.id], id, `pedían «${r.nombre}»`);
        await c.query('DELETE FROM tarea_requisitos WHERE recurso_id = $1', [r.id]);
      }
    }
  }

  /* 5 · Recursos */
  const recDb = (await c.query('SELECT * FROM recursos ORDER BY id')).rows;
  const recUsados = new Set();
  for (const r of S.recursos) {
    const libres = recDb.filter((x) => !recUsados.has(x.id));
    const ya = libres.find((x) => x.ref_semilla === r.ref)
      || libres.find((x) => x.tipo === r.clase && norm(x.nombre) === norm(r.nombre))
      || libres.find((x) => (r.antes || []).some((n) => norm(n) === norm(x.nombre)));
    const v = {
      nombre: r.nombre, tipo: r.clase, ref_semilla: r.ref, activo: true,
      departamento_id: r.departamento ? depId.get(r.departamento) : null,
      linea_id: r.area_habitual ? areaId.get(r.area_habitual) : (ya?.linea_id && !sobranIds.includes(ya.linea_id) ? ya.linea_id : null),
    };
    for (const k of ['codigo', 'categoria', 'empresa', 'vinculo']) if (k in r) v[k] = r[k] || null;
    if (r.clase === 'operario' && !('vinculo' in r) && !ya) v.vinculo = 'plantilla';
    if (r.clase !== 'operario') v.vinculo = 'plantilla';
    if (r.descripcion && (!ya || !ya.notas)) v.notas = r.descripcion;
    let id;
    if (ya) {
      recUsados.add(ya.id);
      id = ya.id;
      const cols = Object.keys(v);
      await c.query(`UPDATE recursos SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((k) => v[k])]);
      if (norm(ya.nombre) !== norm(r.nombre) || ya.tipo !== r.clase) anota('recursos', 'renombrar', r.nombre, `antes «${ya.nombre}»${ya.tipo !== r.clase ? ` (${ya.tipo})` : ''}`);
      else if (!ya.activo) anota('recursos', 'reactivar', r.nombre);
      else if (ya.departamento_id !== v.departamento_id || ya.linea_id !== v.linea_id) {
        const area = S.areas.find((a) => a.ref === r.area_habitual)?.nombre;
        anota('recursos', 'actualizar', r.nombre, [S.departamentos.find((d) => d.clave === r.departamento)?.nombre, area && `puesto: ${area}`].filter(Boolean).join(' · '));
      }
    } else {
      const cols = Object.keys(v);
      const { rows } = await c.query(`INSERT INTO recursos (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        cols.map((k) => v[k]));
      id = rows[0].id;
      anota('recursos', 'crear', r.nombre, r.clase);
    }
    const tipos = (r.clase === 'operario' ? r.oficios : r.tipos) || [];
    const antes = (await c.query(`SELECT string_agg(t.nombre, ', ' ORDER BY t.nombre) AS t FROM recurso_tipos rt
                                   JOIN tipos_recurso t ON t.id = rt.tipo_recurso_id WHERE rt.recurso_id = $1`, [id])).rows[0].t || '';
    await c.query('DELETE FROM recurso_tipos WHERE recurso_id = $1', [id]);
    for (const t of tipos) {
      await c.query('INSERT INTO recurso_tipos (recurso_id, tipo_recurso_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, tipoId.get(`${r.clase}:${norm(t)}`)]);
    }
    const ahora = [...tipos].sort((a, b) => a.localeCompare(b, 'es')).join(', ');
    if (ya && norm(antes) !== norm(ahora) && antes) {
      const k = inf.recursos.find((x) => x.nombre === r.nombre);
      if (!k) anota('recursos', 'actualizar', r.nombre, `${r.clase === 'operario' ? 'oficios' : 'tipos'}: ${ahora || '—'}`);
    }
  }
  // Los que no están en el semillero: se borran si nunca se usaron; si no, se desactivan
  for (const x of recDb.filter((y) => !recUsados.has(y.id))) {
    const { rows: [u] } = await c.query(
      `SELECT (SELECT count(*) FROM tramo_asignaciones WHERE recurso_id = $1)::int AS asig,
              (SELECT count(*) FROM tarea_requisitos WHERE recurso_id = $1)::int AS req`, [x.id]);
    if (!u.asig && !u.req) {
      await c.query('DELETE FROM recursos WHERE id = $1', [x.id]);
      anota('recursos', 'borrar', x.nombre, x.tipo);
    } else {
      await c.query('UPDATE recursos SET activo = FALSE, ref_semilla = NULL WHERE id = $1', [x.id]);
      if (x.activo) anota('recursos', 'desactivar', x.nombre, `${x.tipo} · usado en ${u.asig} tramo(s)${u.req ? `, pedido en ${u.req} tarea(s)` : ''}`);
    }
  }

  /* 6 · Áreas que sobran */
  for (const x of sobran) {
    const { rows: t } = await c.query('UPDATE tareas SET linea_id = NULL WHERE linea_id = $1 RETURNING id', [x.id]);
    if (t.length) anota('tareas', 'sin área', x.nombre, `${t.length} tarea${t.length > 1 ? 's' : ''} (se elige al planificar)`);
    // sus tramos pasan al puesto habitual de quien los tiene asignados, si lo tiene
    const { rows: mov } = await c.query(
      `UPDATE tramos x SET linea_id = r.linea_id
         FROM (SELECT DISTINCT ON (a.tramo_id) a.tramo_id, rc.linea_id
                 FROM tramo_asignaciones a JOIN recursos rc ON rc.id = a.recurso_id
                WHERE rc.tipo = 'operario' AND rc.linea_id = ANY($2) ORDER BY a.tramo_id, a.desde NULLS FIRST) r
        WHERE x.id = r.tramo_id AND x.linea_id = $1 RETURNING x.id`, [x.id, [...areaId.values()]]);
    if (mov.length) anota('tareas', 'tramos', x.nombre, `${mov.length} tramo(s) al puesto habitual de su operario`);
    await c.query('UPDATE recursos SET linea_id = NULL WHERE linea_id = $1', [x.id]);
    const { rows: [q] } = await c.query('SELECT count(*)::int AS n FROM tramos WHERE linea_id = $1', [x.id]);
    if (q.n) {
      await c.query('UPDATE lineas SET activo = FALSE, departamento_id = NULL, ref_semilla = NULL WHERE id = $1', [x.id]);
      if (x.activo) anota('areas', 'desactivar', x.nombre, `tiene ${q.n} tramo(s) planificados: se ve solo esos días`);
    } else {
      await c.query('DELETE FROM import_alias WHERE clase IN ($2, $3) AND destino_id = $1', [x.id, 'area', 'area_tipo:taller']);
      await c.query('DELETE FROM lineas WHERE id = $1', [x.id]);
      anota('areas', 'borrar', x.nombre);
    }
  }

  /* 7 · Tipos que ya no están: se borran si nadie los pide; si se piden, se quedan con aviso */
  for (const x of tiposDb.filter((y) => !tratados.has(y.id))) {
    const n = await tareasDeTipo(x.id);
    if (n) {
      inf.avisos.push(`«${x.nombre}» (${x.clase}) no está en el semillero pero lo piden ${n} tarea(s): se mantiene. Añádelo a tipos o a sus alias.`);
    } else {
      await c.query('DELETE FROM tipos_recurso WHERE id = $1', [x.id]);
      anota('tipos', 'borrar', x.nombre, x.clase);
    }
  }

  // Resumen
  const resumen = {};
  for (const sec of ['departamentos', 'tipos', 'areas', 'recursos', 'tareas']) {
    resumen[sec] = {};
    for (const x of inf[sec]) resumen[sec][x.accion] = (resumen[sec][x.accion] || 0) + 1;
  }
  const { rows: [tot] } = await c.query(
    `SELECT (SELECT count(*) FROM lineas WHERE tipo <> 'obra' AND activo)::int AS areas,
            (SELECT count(*) FROM recursos WHERE activo)::int AS recursos,
            (SELECT count(*) FROM tipos_recurso)::int AS tipos`);
  return { ...inf, resumen, totales: tot };
}

module.exports = function montar(app, asyncH) {
  app.post('/api/semillero', auth.permiso('recursos'), asyncH(async (req, res) => {
    const S = req.body || {};
    const simular = ['1', 'true', 'si'].includes(String(req.query.simular || '').toLowerCase());
    if (!validar(S)) {
      return res.json({ ok: false, simulado: simular, errores: validar.errors.slice(0, 30).map((e) => `${e.instancePath || '(raíz)'} ${e.message}`) });
    }
    const errores = revisar(S);
    if (errores.length) return res.json({ ok: false, simulado: simular, errores });
    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(360360)');
      const inf = await cargar(c, S);
      await c.query(simular ? 'ROLLBACK' : 'COMMIT');
      res.json({ ok: true, simulado: simular, ...inf });
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }));

  app.get('/api/departamentos', asyncH(async (req, res) => {
    const { rows } = await pool.query('SELECT id, clave, nombre, orden FROM departamentos ORDER BY orden, nombre');
    res.json(rows);
  }));
};
