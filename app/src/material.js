// Circuito del material de una partida:
//   1. Técnico (Sofía) define el ESCANDALLO de la partida y lo envía a logística.
//   2. Logística (Sergio) dice cuánto hay en stock de cada material; lo que falta queda «por pedir».
//   3. Compras lo pide (proveedor, fecha prevista).
//   4. Logística lo recibe → avisa a los operarios de las tareas que lo usan.
//   Aparte, Operaciones (Adrián) ASIGNA el material del escandallo y las herramientas a las tareas.
const { query, tx } = require('./db');
const auth = require('./auth');
const notif = require('./notificaciones');
const catalogo = require('./catalogo');
const archivos = require('./archivos');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max) => String(v ?? '').trim().slice(0, max) || null;
const numero = (v, { cero = false } = {}) => {
  if (v == null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || (!cero && n === 0) || n >= 1e7) throw fallo(400, 'Cantidad no válida');
  return n;
};
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
const cant = (n, u) => `${String(Math.round(n * 1000) / 1000).replace('.', ',')}${u ? ` ${u}` : ''}`;

// estado de una línea del escandallo
function estado(l) {
  if (l.stock == null) return 'sin_revisar';
  if (l.compra === 'recibido' || l.stock >= l.cantidad) return 'disponible';
  if (l.compra === 'pedido') return 'pedido';
  return 'por_pedir';
}

const SQL_LINEAS = `
  SELECT e.id, e.partida_id, e.catalogo_id, e.descripcion, e.cantidad::float, e.unidad, e.nota, e.orden,
         e.enlaces, e.stock::float, e.stock_en, e.compra, e.proveedor_id, e.fecha_prevista, e.pedido_en, e.recibido_en, e.nota_logistica,
         pa.codigo AS partida_codigo, pa.nombre AS partida_nombre, pa.escandallo_enviado, pa.proyecto_id,
         p.codigo AS proyecto_codigo, p.nombre AS proyecto_nombre,
         pr.nombre AS proveedor, us.nombre AS stock_por, up.nombre AS pedido_por, ur.nombre AS recibido_por,
         COALESCE((SELECT sum(m.cantidad) FROM tarea_material m WHERE m.escandallo_id = e.id), 0)::float AS asignado,
         COALESCE((SELECT json_agg(json_build_object('id', m.id, 'tarea_id', t.id, 'tarea', t.nombre, 'ot', o.codigo, 'cantidad', m.cantidad::float)
                                   ORDER BY o.codigo, t.orden_en_of)
                     FROM tarea_material m JOIN tareas t ON t.id = m.tarea_id JOIN ordenes o ON o.id = t.orden_id
                    WHERE m.escandallo_id = e.id), '[]') AS tareas,
         COALESCE((SELECT min(x.fecha) FROM tarea_material m JOIN tramos x ON x.tarea_id = m.tarea_id WHERE m.escandallo_id = e.id),
                  (SELECT min(x.fecha) FROM ordenes o JOIN tareas t ON t.orden_id = o.id JOIN tramos x ON x.tarea_id = t.id
                    WHERE o.partida_id = e.partida_id)) AS fecha_necesaria
    FROM partida_escandallo e
    JOIN partidas pa ON pa.id = e.partida_id
    JOIN proyectos p ON p.id = pa.proyecto_id
    LEFT JOIN proveedores pr ON pr.id = e.proveedor_id
    LEFT JOIN usuarios us ON us.id = e.stock_por
    LEFT JOIN usuarios up ON up.id = e.pedido_por
    LEFT JOIN usuarios ur ON ur.id = e.recibido_por`;

async function lineas(where, params) {
  const { rows } = await query(`${SQL_LINEAS} WHERE ${where} ORDER BY p.codigo, pa.orden, pa.id, e.orden, e.id`, params);
  const arch = await archivos.de('escandallo', rows.map((l) => l.id));
  for (const l of rows) {
    l.archivos = arch.get(l.id) || [];
    l.estado = estado(l);
    l.falta = l.stock == null ? null : Math.max(0, Math.round((l.cantidad - l.stock) * 1000) / 1000);
  }
  return rows;
}
const linea = async (id) => (await lineas('e.id = $1', [id]))[0];

async function partidaDe(id) {
  const { rows } = await query(
    `SELECT pa.id, pa.codigo, pa.nombre, pa.escandallo_enviado, p.id AS proyecto_id, p.codigo AS proyecto_codigo, p.nombre AS proyecto_nombre
       FROM partidas pa JOIN proyectos p ON p.id = pa.proyecto_id WHERE pa.id = $1`, [id]);
  if (!rows.length) throw fallo(404, 'Partida no encontrada');
  return rows[0];
}
const nombrePartida = (pa) => `${pa.codigo ? `${pa.codigo} · ` : ''}${pa.nombre}`;

// a quién avisar cuando llega un material: los operarios con usuario de las tareas que lo usan
// (asignados en el plan de hoy en adelante; si no hay plan, nadie) y quien define el escandallo
async function interesadosRecepcion(escandalloId) {
  const { rows } = await query(
    `SELECT DISTINCT u.id FROM tarea_material m
       JOIN tramos x ON x.tarea_id = m.tarea_id AND x.fecha >= (now() AT TIME ZONE 'Europe/Madrid')::date
       JOIN tramo_asignaciones a ON a.tramo_id = x.id
       JOIN usuarios u ON u.recurso_id = a.recurso_id AND u.activo
      WHERE m.escandallo_id = $1`, [escandalloId]);
  return [...rows.map((r) => r.id), ...(await notif.conPermiso('escandallo'))];
}

function montar(app, asyncH) {
  const pEscandallo = auth.permiso('escandallo');
  const pAsignar = auth.permiso('planificar', 'proyectos');
  const pLogistica = auth.permiso('logistica');
  const pCompras = auth.permiso('compras');

  /* ---------- 1. Escandallo de la partida (técnico) ---------- */
  app.get('/api/partidas/:id/escandallo', asyncH(async (req, res) => {
    const pa = await partidaDe(Number(req.params.id));
    res.json({ partida: pa, lineas: await lineas('e.partida_id = $1', [pa.id]) });
  }));

  app.post('/api/partidas/:id/escandallo', pEscandallo, asyncH(async (req, res) => {
    const pa = await partidaDe(Number(req.params.id));
    const b = req.body || {};
    const descripcion = texto(b.descripcion, 200);
    if (!descripcion) throw fallo(400, 'Escribe el material');
    const cantidad = numero(b.cantidad);
    if (cantidad == null) throw fallo(400, 'Falta la cantidad');
    const { rows } = await query(
      `INSERT INTO partida_escandallo (partida_id, catalogo_id, descripcion, cantidad, unidad, nota, orden, creado_por)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE((SELECT max(orden) FROM partida_escandallo WHERE partida_id = $1), 0) + 1, $7) RETURNING id`,
      [pa.id, b.catalogo_id ? Number(b.catalogo_id) : null, descripcion, cantidad, texto(b.unidad, 20), texto(b.nota, 300), req.usuario.id]);
    catalogo.usado(Number(b.catalogo_id));
    res.status(201).json(await linea(rows[0].id));
  }));

  app.patch('/api/escandallo/:id', pEscandallo, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const o = {};
    if ('descripcion' in b) { o.descripcion = texto(b.descripcion, 200); if (!o.descripcion) throw fallo(400, 'Escribe el material'); }
    if ('catalogo_id' in b) o.catalogo_id = b.catalogo_id ? Number(b.catalogo_id) : null;
    if ('cantidad' in b) { o.cantidad = numero(b.cantidad); if (o.cantidad == null) throw fallo(400, 'Falta la cantidad'); }
    if ('unidad' in b) o.unidad = texto(b.unidad, 20);
    if ('nota' in b) o.nota = texto(b.nota, 300);
    if ('enlaces' in b) {
      o.enlaces = (Array.isArray(b.enlaces) ? b.enlaces : []).map((x) => String(x || '').trim()).filter(Boolean).slice(0, 10);
      for (const u of o.enlaces) if (!/^https?:\/\/\S+$/i.test(u) || u.length > 1000) throw fallo(400, `Enlace no válido: ${u.slice(0, 60)}`);
    }
    const cols = Object.keys(o);
    if (!cols.length) throw fallo(400, 'Nada que cambiar');
    const { rowCount } = await query(`UPDATE partida_escandallo SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((k) => o[k])]);
    if (!rowCount) throw fallo(404, 'Línea no encontrada');
    // si cambia la cantidad ya revisada, se recalcula si falta algo
    if ('cantidad' in o) {
      await query(`UPDATE partida_escandallo SET compra = CASE
                     WHEN stock IS NULL OR compra IN ('pedido', 'recibido') THEN compra
                     WHEN stock >= cantidad THEN NULL ELSE 'por_pedir' END WHERE id = $1`, [id]);
    }
    res.json(await linea(id));
  }));

  app.delete('/api/escandallo/:id', pEscandallo, asyncH(async (req, res) => {
    await query(`DELETE FROM archivos WHERE ref_tipo = 'escandallo' AND ref_id = $1`, [Number(req.params.id)]);
    await query('DELETE FROM partida_escandallo WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // Enviar a logística: avisa a quien revisa el stock
  app.post('/api/partidas/:id/escandallo/enviar', pEscandallo, asyncH(async (req, res) => {
    const pa = await partidaDe(Number(req.params.id));
    const ls = await lineas('e.partida_id = $1', [pa.id]);
    if (!ls.length) throw fallo(400, 'El escandallo está vacío');
    await query('UPDATE partidas SET escandallo_enviado = now() WHERE id = $1', [pa.id]);
    const sinRevisar = ls.filter((l) => l.estado === 'sin_revisar').length;
    notif.avisarLuego(notif.conPermiso('logistica'), 'mat_revisar', {
      titulo: `Escandallo para revisar · ${pa.proyecto_codigo}`,
      cuerpo: `${nombrePartida(pa)}: ${sinRevisar} material(es) por revisar en stock.`,
      url: `/logistica.html?vista=revisar&partida=${pa.id}`, tag: `revisar-${pa.id}`,
    });
    res.json({ ok: true, sin_revisar: sinRevisar });
  }));

  /* ---------- 2. Logística: stock ---------- */
  app.put('/api/escandallo/:id/stock', pLogistica, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const stock = numero(b.stock, { cero: true });
    const antes = await linea(id);
    if (!antes) throw fallo(404, 'Línea no encontrada');
    await query(
      `UPDATE partida_escandallo SET stock = $2, stock_por = $3, stock_en = now(),
              nota_logistica = COALESCE($4, nota_logistica),
              compra = CASE WHEN $2::numeric IS NULL THEN NULL
                            WHEN compra IN ('pedido', 'recibido') THEN compra
                            WHEN $2::numeric >= cantidad THEN NULL ELSE 'por_pedir' END
        WHERE id = $1`, [id, stock, stock == null ? null : req.usuario.id, 'nota' in b ? texto(b.nota, 300) : null]);
    const l = await linea(id);
    if (l.estado === 'por_pedir' && antes.estado !== 'por_pedir') {
      const { rows } = await query(`SELECT count(*)::int AS n FROM partida_escandallo WHERE partida_id = $1 AND compra = 'por_pedir'`, [l.partida_id]);
      notif.avisarLuego(notif.conPermiso('compras'), 'mat_comprar', {
        titulo: `Material por pedir · ${l.proyecto_codigo}`,
        cuerpo: `${nombrePartida({ codigo: l.partida_codigo, nombre: l.partida_nombre })}: ${rows[0].n} material(es) que faltan${l.fecha_necesaria ? `; hacen falta el ${ddmm(l.fecha_necesaria)}` : ''}. Último: ${cant(l.falta, l.unidad)} de ${l.descripcion}.`,
        url: '/logistica.html?vista=comprar', tag: `comprar-${l.partida_id}`,
      });
    }
    res.json(l);
  }));

  /* ---------- 3. Compras: pedido ---------- */
  app.put('/api/escandallo/:id/compra', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const l0 = await linea(id);
    if (!l0) throw fallo(404, 'Línea no encontrada');
    if (b.estado === 'pedido') {
      if (l0.stock == null) throw fallo(400, 'Logística aún no ha revisado el stock de este material');
      const fecha = b.fecha_prevista && /^\d{4}-\d{2}-\d{2}$/.test(b.fecha_prevista) ? b.fecha_prevista : null;
      await query(
        `UPDATE partida_escandallo SET compra = 'pedido', proveedor_id = $2, fecha_prevista = $3, pedido_por = $4, pedido_en = now(),
                nota_logistica = COALESCE($5, nota_logistica) WHERE id = $1`,
        [id, b.proveedor_id ? Number(b.proveedor_id) : null, fecha, req.usuario.id, 'nota' in b ? texto(b.nota, 300) : null]);
      const l = await linea(id);
      notif.avisarLuego(notif.conPermiso('logistica', 'escandallo'), 'mat_pedido', {
        titulo: `Pedido: ${l.descripcion}`,
        cuerpo: `${cant(l.falta, l.unidad)}${l.proveedor ? ` a ${l.proveedor}` : ''}${l.fecha_prevista ? `, llega el ${ddmm(l.fecha_prevista)}` : ''} · ${l.proyecto_codigo} ${l.partida_nombre}`,
        url: '/logistica.html?vista=recibir', tag: `pedido-${l.partida_id}`,
      });
      // si llega después del día en que está planificada alguna tarea que lo usa, que lo sepa quien planifica
      if (l.fecha_prevista) {
        const { rows: tt } = await query(
          `SELECT min(x.fecha) AS fecha, string_agg(DISTINCT o.codigo || ' ' || t.nombre, ', ') AS tareas
             FROM tarea_material m JOIN tramos x ON x.tarea_id = m.tarea_id JOIN tareas t ON t.id = m.tarea_id JOIN ordenes o ON o.id = t.orden_id
            WHERE m.escandallo_id = $1 AND x.fecha >= CURRENT_DATE AND x.fecha < $2`, [id, l.fecha_prevista]);
        if (tt[0]?.fecha) {
          notif.avisarLuego(notif.conPermiso('planificar', 'escandallo'), 'mat_tarde', {
            titulo: `⚠ Material tarde: ${l.descripcion}`,
            cuerpo: `Llega el ${ddmm(l.fecha_prevista)} y ${tt[0].tareas} está planificada el ${ddmm(tt[0].fecha)}`,
            url: `/?fecha=${tt[0].fecha}`, tag: `tarde-${id}`,
          });
        }
      }
      return res.json(l);
    }
    if (b.estado === 'por_pedir') {
      await query(`UPDATE partida_escandallo SET compra = 'por_pedir', proveedor_id = NULL, fecha_prevista = NULL, pedido_por = NULL, pedido_en = NULL
                    WHERE id = $1 AND compra = 'pedido'`, [id]);
      return res.json(await linea(id));
    }
    throw fallo(400, 'Estado no válido');
  }));

  /* ---------- 4. Logística: recepción ---------- */
  app.put('/api/escandallo/:id/recibir', pLogistica, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const deshacer = !!(req.body || {}).deshacer;
    const l0 = await linea(id);
    if (!l0) throw fallo(404, 'Línea no encontrada');
    if (deshacer) {
      await query(`UPDATE partida_escandallo SET compra = 'pedido', recibido_por = NULL, recibido_en = NULL WHERE id = $1 AND compra = 'recibido'`, [id]);
      return res.json(await linea(id));
    }
    if (!['pedido', 'por_pedir'].includes(l0.compra)) throw fallo(400, 'Este material no está pendiente de llegar');
    await query(`UPDATE partida_escandallo SET compra = 'recibido', recibido_por = $2, recibido_en = now() WHERE id = $1`, [id, req.usuario.id]);
    const l = await linea(id);
    const tareas = l.tareas.map((t) => `«${t.tarea}»`).join(', ');
    notif.avisarLuego(interesadosRecepcion(id), 'mat_recibido', {
      titulo: `Ya ha llegado: ${l.descripcion}`,
      cuerpo: `${cant(l.cantidad, l.unidad)} · ${l.proyecto_codigo} ${l.partida_nombre}${tareas ? ` · para ${tareas}` : ''}`,
      url: '/mi-dia.html', tag: `recibido-${id}`,
    });
    res.json(l);
  }));

  /* ---------- Fotos y PDF del material (técnico y logística) ---------- */
  const pArchivos = auth.permiso('escandallo', 'logistica', 'compras');
  app.post('/api/escandallo/:id/archivos', pArchivos, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (!(await linea(id))) throw fallo(404, 'Línea no encontrada');
    const n = await tx((c) => archivos.enlazar(c, (req.body || {}).ids, 'escandallo', id, req.usuario.id));
    if (!n) throw fallo(400, 'No se ha podido adjuntar');
    res.status(201).json(await linea(id));
  }));
  app.delete('/api/escandallo/:id/archivos/:archivo', pArchivos, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    // cada uno quita lo suyo; el técnico, cualquiera
    const { rowCount } = await query(
      `DELETE FROM archivos WHERE id = $1 AND ref_tipo = 'escandallo' AND ref_id = $2 AND (creado_por = $3 OR $4)`,
      [Number(req.params.archivo), id, req.usuario.id, auth.tiene(req.usuario, 'escandallo')]);
    if (!rowCount) throw fallo(403, 'Solo puedes quitar las fotos que has subido tú');
    res.json(await linea(id));
  }));

  /* ---------- Pantalla de logística y compras ---------- */
  app.get('/api/material/circuito', auth.permiso('logistica', 'compras', 'escandallo', 'planificar'), asyncH(async (req, res) => {
    const conds = [`p.estado IS DISTINCT FROM 'cerrado'`, 'pa.escandallo_enviado IS NOT NULL'];
    const params = [];
    if (req.query.partida) { params.push(Number(req.query.partida)); conds.push(`e.partida_id = $${params.length}`); }
    const ls = await lineas(conds.join(' AND '), params);
    const cuenta = (est) => ls.filter((l) => l.estado === est).length;
    const { rows: proveedores } = await query('SELECT id, nombre, zona, transporte FROM proveedores WHERE activo ORDER BY lower(nombre)');
    res.json({
      lineas: ls, proveedores,
      cuentas: { revisar: cuenta('sin_revisar'), comprar: cuenta('por_pedir'), recibir: cuenta('pedido'), disponible: cuenta('disponible'), todo: ls.length },
    });
  }));

  /* ---------- Asignación a tareas (operaciones) ---------- */
  app.get('/api/partidas/:id/asignacion', asyncH(async (req, res) => {
    const pa = await partidaDe(Number(req.params.id));
    const ls = await lineas('e.partida_id = $1', [pa.id]);
    const { rows: ots } = await query(
      `SELECT o.id, o.codigo, o.titulo, o.estado FROM ordenes o WHERE o.partida_id = $1 ORDER BY o.codigo, o.id`, [pa.id]);
    const { rows: tareas } = await query(
      `SELECT t.id, t.orden_id, t.nombre, t.orden_en_of, t.estado, (SELECT min(x.fecha) FROM tramos x WHERE x.tarea_id = t.id) AS primera_fecha
         FROM tareas t WHERE t.orden_id = ANY($1::int[]) ORDER BY t.orden_en_of, t.id`, [ots.map((o) => o.id)]);
    const { rows: herr } = await query(
      `SELECT h.id, h.tarea_id, h.descripcion, h.cantidad::float, h.nota FROM tarea_herramienta h
        WHERE h.tarea_id = ANY($1::int[]) ORDER BY h.id`, [tareas.map((t) => t.id)]);
    // equipos de los que hay pocos (tipos de máquina): la tarea los pide y en el tablero se asigna uno concreto
    const { rows: equipos } = await query(
      `SELECT ti.id, ti.nombre,
              (SELECT count(*)::int FROM recurso_tipos rt JOIN recursos r ON r.id = rt.recurso_id WHERE rt.tipo_recurso_id = ti.id AND r.activo) AS n,
              COALESCE((SELECT json_agg(DISTINCT l.nombre) FROM recurso_tipos rt JOIN recursos r ON r.id = rt.recurso_id JOIN lineas l ON l.id = r.linea_id
                         WHERE rt.tipo_recurso_id = ti.id AND r.activo AND r.fijo_area), '[]') AS fijas_en,
              (SELECT count(*)::int FROM recurso_tipos rt JOIN recursos r ON r.id = rt.recurso_id WHERE rt.tipo_recurso_id = ti.id AND r.activo AND r.fijo_area) AS n_fijas
         FROM tipos_recurso ti WHERE ti.clase = 'maquina' ORDER BY lower(ti.nombre)`);
    const { rows: reqs } = await query(
      `SELECT q.tarea_id, q.tipo_recurso_id, q.cantidad, ti.nombre FROM tarea_requisitos_tipo q JOIN tipos_recurso ti ON ti.id = q.tipo_recurso_id
        WHERE ti.clase = 'maquina' AND q.tarea_id = ANY($1::int[]) ORDER BY lower(ti.nombre)`, [tareas.map((t) => t.id)]);
    for (const o of ots) o.tareas = tareas.filter((t) => t.orden_id === o.id);
    for (const t of tareas) {
      t.equipos = reqs.filter((q) => q.tarea_id === t.id);
      t.materiales = ls.flatMap((l) => l.tareas.filter((x) => x.tarea_id === t.id)
        .map((x) => ({ id: x.id, escandallo_id: l.id, descripcion: l.descripcion, cantidad: x.cantidad, unidad: l.unidad, estado: l.estado })));
      t.herramientas = herr.filter((h) => h.tarea_id === t.id);
    }
    res.json({ partida: pa, escandallo: ls, ots, equipos });
  }));

  async function comprobarTareaDePartida(tareaId, partidaId) {
    const { rows } = await query('SELECT 1 FROM tareas t JOIN ordenes o ON o.id = t.orden_id WHERE t.id = $1 AND o.partida_id = $2', [tareaId, partidaId]);
    if (!rows.length) throw fallo(400, 'La tarea no es de una OT de esta partida');
  }

  app.post('/api/tareas/:id/materiales', pAsignar, asyncH(async (req, res) => {
    const tareaId = Number(req.params.id);
    const b = req.body || {};
    const l = await linea(Number(b.escandallo_id));
    if (!l) throw fallo(404, 'Material no encontrado');
    await comprobarTareaDePartida(tareaId, l.partida_id);
    const cantidad = numero(b.cantidad);
    if (cantidad == null) throw fallo(400, 'Falta la cantidad');
    const yaEnEsta = l.tareas.find((x) => x.tarea_id === tareaId)?.cantidad || 0;
    if (l.asignado + cantidad > l.cantidad + 1e-9) {
      throw fallo(400, `Solo quedan ${cant(Math.max(0, l.cantidad - l.asignado), l.unidad)} sin asignar`);
    }
    await query(
      `INSERT INTO tarea_material (escandallo_id, tarea_id, cantidad, creado_por) VALUES ($1, $2, $3, $4)
       ON CONFLICT (escandallo_id, tarea_id) DO UPDATE SET cantidad = $5`,
      [l.id, tareaId, cantidad, req.usuario.id, yaEnEsta + cantidad]);
    res.status(201).json({ ok: true });
  }));

  app.patch('/api/tarea-material/:id', pAsignar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const cantidad = numero((req.body || {}).cantidad);
    if (cantidad == null) throw fallo(400, 'Falta la cantidad');
    const { rows } = await query('SELECT escandallo_id, cantidad::float FROM tarea_material WHERE id = $1', [id]);
    if (!rows.length) throw fallo(404, 'Asignación no encontrada');
    const l = await linea(rows[0].escandallo_id);
    if (l.asignado - rows[0].cantidad + cantidad > l.cantidad + 1e-9) throw fallo(400, `Solo hay ${cant(l.cantidad, l.unidad)} en el escandallo`);
    await query('UPDATE tarea_material SET cantidad = $2 WHERE id = $1', [id, cantidad]);
    res.json({ ok: true });
  }));

  app.delete('/api/tarea-material/:id', pAsignar, asyncH(async (req, res) => {
    await query('DELETE FROM tarea_material WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  app.post('/api/tareas/:id/herramientas', pAsignar, asyncH(async (req, res) => {
    const tareaId = Number(req.params.id);
    const { rows: t } = await query('SELECT 1 FROM tareas WHERE id = $1', [tareaId]);
    if (!t.length) throw fallo(404, 'Tarea no encontrada');
    const items = Array.isArray((req.body || {}).items) ? req.body.items.slice(0, 100) : [];
    let n = 0;
    for (const it of items) {
      const d = texto(it.descripcion, 200);
      if (!d) continue;
      const r = await query(
        `INSERT INTO tarea_herramienta (tarea_id, catalogo_id, descripcion, cantidad, creado_por) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (tarea_id, lower(descripcion)) DO NOTHING`,
        [tareaId, it.catalogo_id ? Number(it.catalogo_id) : null, d, numero(it.cantidad), req.usuario.id]);
      if (r.rowCount) { n++; catalogo.usado(Number(it.catalogo_id)); }
    }
    res.status(201).json({ ok: true, añadidas: n });
  }));

  // Equipos (tipos de máquina) que pide la tarea: { tipo_ids }
  app.post('/api/tareas/:id/equipos', pAsignar, asyncH(async (req, res) => {
    const tareaId = Number(req.params.id);
    const ids = (Array.isArray(req.body?.tipo_ids) ? req.body.tipo_ids : []).map(Number).filter(Boolean);
    let n = 0;
    for (const tid of ids) {
      const r = await query(
        `INSERT INTO tarea_requisitos_tipo (tarea_id, tipo_recurso_id, cantidad)
         SELECT $1, id, 1 FROM tipos_recurso WHERE id = $2 AND clase = 'maquina' ON CONFLICT DO NOTHING`, [tareaId, tid]);
      n += r.rowCount;
    }
    res.status(201).json({ ok: true, añadidos: n });
  }));
  app.delete('/api/tareas/:id/equipos/:tipoId', pAsignar, asyncH(async (req, res) => {
    await query('DELETE FROM tarea_requisitos_tipo WHERE tarea_id = $1 AND tipo_recurso_id = $2', [Number(req.params.id), Number(req.params.tipoId)]);
    res.json({ ok: true });
  }));

  app.delete('/api/tarea-herramienta/:id', pAsignar, asyncH(async (req, res) => {
    await query('DELETE FROM tarea_herramienta WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // Lo que lleva una tarea (icono 🧰 de la tarea; luego, Mi día)
  app.get('/api/tareas/:id/llevar', asyncH(async (req, res) => {
    const tareaId = Number(req.params.id);
    const { rows: mats } = await query(
      `SELECT m.id, m.escandallo_id, m.cantidad::float, e.descripcion, e.unidad, e.stock::float, e.compra, e.cantidad::float AS total, e.fecha_prevista
         FROM tarea_material m JOIN partida_escandallo e ON e.id = m.escandallo_id WHERE m.tarea_id = $1 ORDER BY e.orden, e.id`, [tareaId]);
    for (const m of mats) m.estado = estado({ stock: m.stock, cantidad: m.total, compra: m.compra });
    const { rows: herr } = await query('SELECT id, descripcion, cantidad::float, nota FROM tarea_herramienta WHERE tarea_id = $1 ORDER BY id', [tareaId]);
    res.json({ materiales: mats, herramientas: herr });
  }));
}

// Lo que lleva cada tarea (tablero y Mi día): tareaId → { materiales, herramientas, estado, llega }
//  estado = el peor de sus materiales (por_pedir > sin_revisar > pedido > disponible); llega = la última fecha prevista de lo pedido
const PESO = { por_pedir: 4, sin_revisar: 3, pedido: 2, disponible: 1 };
async function deTareas(ids, recursoId = null) {
  const out = new Map();
  ids = [...new Set((ids || []).map(Number).filter(Boolean))];
  if (!ids.length) return out;
  const [{ rows: mats }, { rows: herr }] = await Promise.all([
    query(`SELECT m.id, m.tarea_id, m.cantidad::float, e.descripcion, e.unidad, e.stock::float, e.compra, e.cantidad::float AS total,
                  e.fecha_prevista, pr.nombre AS proveedor, e.recibido_en
             FROM tarea_material m JOIN partida_escandallo e ON e.id = m.escandallo_id LEFT JOIN proveedores pr ON pr.id = e.proveedor_id
            WHERE m.tarea_id = ANY($1::int[]) ORDER BY e.orden, e.id`, [ids]),
    query(`SELECT id, tarea_id, descripcion, cantidad::float FROM tarea_herramienta WHERE tarea_id = ANY($1::int[]) ORDER BY id`, [ids]),
  ]);
  // quién ha marcado cada cosa (material recibido / herramienta preparada)
  const { rows: ck } = await query(
    `SELECT c.tipo, c.item_id, c.recurso_id, r.nombre FROM llevar_check c JOIN recursos r ON r.id = c.recurso_id
      WHERE (c.tipo = 'material' AND c.item_id = ANY($1::int[])) OR (c.tipo = 'herramienta' AND c.item_id = ANY($2::int[]))
      ORDER BY c.marcado_en`, [mats.map((m) => m.id), herr.map((h) => h.id)]);
  const marcas = new Map();
  for (const c of ck) { const k = `${c.tipo}:${c.item_id}`; if (!marcas.has(k)) marcas.set(k, []); marcas.get(k).push(c); }
  const quien = (tipo, id) => (marcas.get(`${tipo}:${id}`) || []).map((c) => c.nombre);
  const mio = (tipo, id) => !!recursoId && (marcas.get(`${tipo}:${id}`) || []).some((c) => c.recurso_id === recursoId);
  const de = (id) => { if (!out.has(id)) out.set(id, { materiales: [], herramientas: [], estado: null, llega: null }); return out.get(id); };
  for (const m of mats) {
    const x = de(m.tarea_id);
    const est = estado({ stock: m.stock, cantidad: m.total, compra: m.compra });
    x.materiales.push({ id: m.id, recibido_por: quien('material', m.id), mio: mio('material', m.id), descripcion: m.descripcion, cantidad: m.cantidad, unidad: m.unidad, estado: est,
      fecha_prevista: est === 'pedido' ? m.fecha_prevista : null, proveedor: est === 'pedido' ? m.proveedor : null });
    if (!x.estado || PESO[est] > PESO[x.estado]) x.estado = est;
    if (est === 'pedido' && m.fecha_prevista && (!x.llega || m.fecha_prevista > x.llega)) x.llega = m.fecha_prevista;
  }
  for (const h of herr) de(h.tarea_id).herramientas.push({ id: h.id, preparado_por: quien('herramienta', h.id), mio: mio('herramienta', h.id), descripcion: h.descripcion, cantidad: h.cantidad });
  return out;
}

// cuentas para los avisos del menú
async function pendientes(u) {
  const out = {};
  if (auth.tiene(u, 'logistica') || auth.tiene(u, 'compras')) {
    const { rows } = await query(
      `SELECT count(*) FILTER (WHERE e.stock IS NULL)::int AS revisar,
              count(*) FILTER (WHERE e.compra = 'por_pedir')::int AS comprar,
              count(*) FILTER (WHERE e.compra = 'pedido')::int AS recibir
         FROM partida_escandallo e JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos p ON p.id = pa.proyecto_id
        WHERE pa.escandallo_enviado IS NOT NULL AND p.estado IS DISTINCT FROM 'cerrado'`);
    if (auth.tiene(u, 'logistica')) { out.mat_revisar = rows[0].revisar; out.mat_recibir = rows[0].recibir; }
    if (auth.tiene(u, 'compras')) out.mat_comprar = rows[0].comprar;
  }
  return out;
}

module.exports = { montar, pendientes, estado, deTareas };
