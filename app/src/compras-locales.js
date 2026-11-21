// Compras locales (ferretería, almacén de la isla…) a cuenta de la empresa (cuenta de crédito de la tienda).
//  1. Cualquier operario la pide desde el móvil (Mi día › 🛒 Compra local): qué, en qué tienda, importe aproximado,
//     para qué trabajo (por defecto el suyo de hoy), para ahora o mañana, foto o audio.
//  2. Operaciones (permiso «autorizar_compras_locales») la autoriza o no, con nota o motivo; aviso al móvil a los dos.
//  3. El operario compra diciendo el código (CL-0042), sube la foto del ticket o albarán, el importe real y el nº.
//     Si se pasa más de un 15 % de lo autorizado, aviso a Operaciones (no bloquea). Sin ticket a los 2 días: recordatorio.
//  4. Compras las cuadra con la factura mensual de cada tienda. El importe real cuenta como material de la tarea.
const { query, tx } = require('./db');
const auth = require('./auth');
const notif = require('./notificaciones');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const eur = (v) => (v == null ? '—' : `${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
const DESVIO = 0.15;
const puedeAutorizar = (u) => auth.tiene(u, 'autorizar_compras_locales');
const puedeCompras = (u) => auth.tiene(u, 'compras');

const SQL = `
  SELECT c.*, c.importe_aprox::float AS importe_aprox, c.importe_real::float AS importe_real,
         COALESCE(p.nombre, c.tienda) AS tienda_nombre, u.nombre AS usuario_nombre, d.nombre AS decidido_por_nombre,
         t.codigo AS tarea_codigo, t.nombre AS tarea_nombre, o.id AS orden_id, o.codigo AS ot_codigo, o.titulo AS ot_titulo,
         pr.obra,
         (SELECT COALESCE(json_agg(json_build_object('id', a.id, 'tipo', a.tipo, 'nombre', a.nombre, 'ticket', a.ref_tipo = 'compra_local_ticket') ORDER BY a.id), '[]')
            FROM archivos a WHERE a.ref_tipo IN ('compra_local', 'compra_local_ticket') AND a.ref_id = c.id) AS archivos
    FROM compras_locales c
    LEFT JOIN proveedores p ON p.id = c.proveedor_id LEFT JOIN usuarios u ON u.id = c.usuario_id
    LEFT JOIN usuarios d ON d.id = c.decidido_por
    LEFT JOIN tareas t ON t.id = c.tarea_id LEFT JOIN ordenes o ON o.id = t.orden_id LEFT JOIN proyectos pr ON pr.id = o.proyecto_id`;

async function una(id) {
  const { rows } = await query(`${SQL} WHERE c.id = $1`, [id]);
  return rows[0] || null;
}
async function siguienteCodigo(c) {
  const { rows } = await c.query(`SELECT max(substring(codigo from '\\d+$')::int) AS n FROM compras_locales`);
  return `CL-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}
// archivos subidos por esa persona (POST /api/archivos) que pasan a ser de la compra
async function adjuntar(c, ids, compraId, ref, usuarioId) {
  const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 8);
  if (!lista.length) return;
  await c.query(`UPDATE archivos SET ref_tipo = $1, ref_id = $2 WHERE id = ANY($3) AND creado_por = $4 AND ref_tipo IS NULL`, [ref, compraId, lista, usuarioId]);
}
const linea = (c) => `${c.que.slice(0, 80)}${c.tienda_nombre ? ` · ${c.tienda_nombre}` : ''}${c.importe_aprox != null ? ` · ≈ ${eur(c.importe_aprox)}` : ''}`;

// Recordatorio: autorizada hace más de 2 días y sin ticket → aviso al móvil de quien la pidió (uno al día)
async function recordatorios() {
  const hoy = hoyMadrid();
  const h = Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
  if (h < 8 || h >= 19) return;
  const { rows } = await query(
    `UPDATE compras_locales SET recordatorio_en = $1
      WHERE estado = 'autorizada' AND decidido_en < now() - interval '2 days' AND (recordatorio_en IS NULL OR recordatorio_en < $1)
      RETURNING id, codigo, usuario_id, que`, [hoy]);
  for (const r of rows) {
    notif.avisarLuego([r.usuario_id], 'compra_local', {
      titulo: `🧾 Falta el ticket de ${r.codigo}`, cuerpo: `${r.que.slice(0, 100)} · haz la foto del ticket o albarán`,
      url: '/mi-dia.html?vista=compras', tag: `cl-${r.id}`,
    });
  }
}

function montar(app, asyncH) {
  /* ---------- quien pide (todos, también operarios con PIN) ---------- */
  app.get('/api/compras-locales/opciones', asyncH(async (req, res) => {
    const [{ rows: tiendas }, { rows: hoy }] = await Promise.all([
      query(`SELECT id, nombre, localidad, cuenta_credito FROM proveedores WHERE activo AND NOT transportista AND (cuenta_credito OR zona = 'menorca')
              ORDER BY cuenta_credito DESC, lower(nombre)`),
      req.usuario.recurso_id ? query(
        `SELECT DISTINCT t.id, t.codigo, t.nombre, o.codigo AS ot_codigo, o.titulo AS ot_titulo
           FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id AND a.recurso_id = $1
           JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id
          WHERE x.fecha BETWEEN $2::date AND $2::date + 1 ORDER BY t.codigo`, [req.usuario.recurso_id, hoyMadrid()]) : { rows: [] },
    ]);
    // si ninguna tienda está marcada con cuenta de crédito, salen las de Menorca
    const conCuenta = tiendas.filter((t) => t.cuenta_credito);
    res.json({ tiendas: (conCuenta.length ? conCuenta : tiendas).slice(0, 60), trabajos: hoy, puede_autorizar: puedeAutorizar(req.usuario) });
  }));

  app.get('/api/compras-locales/mias', asyncH(async (req, res) => {
    const { rows } = await query(
      `${SQL} WHERE c.usuario_id = $1 AND (c.estado IN ('pendiente','autorizada') OR c.creado > now() - interval '45 days')
       ORDER BY c.creado DESC LIMIT 60`, [req.usuario.id]);
    res.json({ compras: rows });
  }));

  // { que, proveedor_id | tienda, importe_aprox, para, tarea_id, archivos: [ids] }
  app.post('/api/compras-locales/nueva', asyncH(async (req, res) => {
    const b = req.body || {};
    const que = texto(b.que, 1000);
    if (!que) throw fallo(400, 'Escribe qué necesitas');
    const pid = Number(b.proveedor_id) || null;
    const tienda = pid ? null : texto(b.tienda, 120);
    if (!pid && !tienda) throw fallo(400, 'Elige la tienda');
    const imp = num(b.importe_aprox);
    if (imp != null && !(imp >= 0 && imp < 100000)) throw fallo(400, 'Importe no válido');
    const id = await tx(async (c) => {
      const { rows } = await c.query(
        `INSERT INTO compras_locales (codigo, usuario_id, proveedor_id, tienda, que, importe_aprox, para, tarea_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [await siguienteCodigo(c), req.usuario.id, pid, tienda, que, imp, b.para === 'manana' ? 'manana' : 'ahora', Number(b.tarea_id) || null]);
      await adjuntar(c, b.archivos, rows[0].id, 'compra_local', req.usuario.id);
      return rows[0].id;
    });
    const cl = await una(id);
    notif.avisarLuego(notif.conPermiso('autorizar_compras_locales'), 'compra_local', {
      titulo: `🛒 ${cl.usuario_nombre} pide comprar${cl.importe_aprox != null ? ` · ≈ ${eur(cl.importe_aprox)}` : ''}`,
      cuerpo: `${cl.tienda_nombre} · ${cl.que.slice(0, 90)}${cl.tarea_codigo ? ` · ${cl.tarea_codigo} ${cl.tarea_nombre}` : ''}${cl.para === 'manana' ? ' · para mañana' : ''}`,
      url: '/compras.html?vista=locales', tag: `cl-${id}`, urgente: cl.para === 'ahora',
    });
    require('./eventos').emitir({ ruta: 'compras-locales', quien: req.usuario.nombre });
    res.status(201).json(cl);
  }));

  // Ya comprada: { importe_real, num_albaran, archivos: [ids] } (quien la pidió, o compras)
  app.post('/api/compras-locales/:id/ticket', asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const cl0 = await una(id);
    if (!cl0) throw fallo(404, 'Compra no encontrada');
    if (cl0.usuario_id !== req.usuario.id && !puedeCompras(req.usuario)) throw fallo(403, 'No es tuya');
    if (!['autorizada', 'comprada'].includes(cl0.estado)) throw fallo(400, cl0.estado === 'pendiente' ? 'Aún no está autorizada' : 'Esta compra ya no se puede cambiar');
    const imp = num(b.importe_real);
    if (imp == null || !(imp >= 0 && imp < 100000)) throw fallo(400, 'Pon el importe del ticket');
    await tx(async (c) => {
      await adjuntar(c, b.archivos, id, 'compra_local_ticket', req.usuario.id);
      const { rows: f } = await c.query(`SELECT 1 FROM archivos WHERE ref_tipo = 'compra_local_ticket' AND ref_id = $1 LIMIT 1`, [id]);
      if (!f.length) throw fallo(400, 'Falta la foto del ticket o albarán');
      await c.query(`UPDATE compras_locales SET estado = 'comprada', importe_real = $2, num_albaran = $3, comprado_en = COALESCE(comprado_en, now()) WHERE id = $1`,
        [id, imp, texto(b.num_albaran, 60)]);
    });
    const cl = await una(id);
    if (cl.importe_aprox && imp > cl.importe_aprox * (1 + DESVIO)) {
      notif.avisarLuego(notif.conPermiso('autorizar_compras_locales'), 'compra_local', {
        titulo: `⚠ ${cl.codigo}: ${eur(imp)} (autorizado ≈ ${eur(cl.importe_aprox)})`,
        cuerpo: `${cl.usuario_nombre} · ${cl.tienda_nombre} · +${Math.round((imp / cl.importe_aprox - 1) * 100)} % sobre lo autorizado`,
        url: '/compras.html?vista=locales', tag: `cl-${id}`,
      });
    }
    res.json(cl);
  }));

  // Anular mientras está pendiente (quien la pidió) o si ya no se compra (también autorizada)
  app.post('/api/compras-locales/:id/anular', asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const cl = await una(id);
    if (!cl) throw fallo(404, 'Compra no encontrada');
    if (cl.usuario_id !== req.usuario.id && !puedeAutorizar(req.usuario)) throw fallo(403, 'No es tuya');
    if (!['pendiente', 'autorizada'].includes(cl.estado)) throw fallo(400, 'Ya está comprada');
    await query(`UPDATE compras_locales SET estado = 'anulada' WHERE id = $1`, [id]);
    res.json(await una(id));
  }));

  /* ---------- Operaciones y compras ---------- */
  // vista: autorizar | sin_ticket | cuadrar | todas  ·  mes=AAAA-MM (cuadrar / todas)
  app.get('/api/compras-locales', asyncH(async (req, res) => {
    const u = req.usuario;
    if (!puedeAutorizar(u) && !puedeCompras(u) && !auth.tiene(u, 'costes')) throw fallo(403, 'Sin permiso');
    const v = ['autorizar', 'sin_ticket', 'cuadrar', 'todas'].includes(req.query.vista) ? req.query.vista : 'autorizar';
    const mes = /^\d{4}-\d{2}$/.test(req.query.mes || '') ? req.query.mes : null;
    const cond = { autorizar: `c.estado = 'pendiente'`, sin_ticket: `c.estado = 'autorizada'`, cuadrar: `c.estado IN ('comprada','cuadrada')`, todas: 'true' }[v];
    const vals = [];
    let filtroMes = '';
    if (mes && ['cuadrar', 'todas'].includes(v)) { vals.push(`${mes}-01`); filtroMes = ` AND COALESCE(c.comprado_en, c.creado) >= $1::date AND COALESCE(c.comprado_en, c.creado) < ($1::date + interval '1 month')`; }
    const { rows } = await query(`${SQL} WHERE ${cond}${filtroMes} ORDER BY ${v === 'cuadrar' ? 'tienda_nombre, c.comprado_en' : 'c.creado DESC'} LIMIT 500`, vals);
    const { rows: n } = await query(`SELECT count(*) FILTER (WHERE estado = 'pendiente')::int AS autorizar, count(*) FILTER (WHERE estado = 'autorizada')::int AS sin_ticket,
                                            count(*) FILTER (WHERE estado = 'comprada')::int AS cuadrar FROM compras_locales`);
    res.json({ compras: rows, cuentas: n[0], puede_autorizar: puedeAutorizar(u), puede_cuadrar: puedeCompras(u), desvio: DESVIO });
  }));

  // { decision: 'si' | 'no', nota }
  app.post('/api/compras-locales/:id/decidir', auth.permiso('autorizar_compras_locales'), asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    if (!['si', 'no'].includes(b.decision)) throw fallo(400, 'Autoriza o no');
    const nota = texto(b.nota, 300);
    if (b.decision === 'no' && !nota) throw fallo(400, 'Di el motivo (lo verá quien la pidió)');
    const { rows } = await query(
      `UPDATE compras_locales SET estado = $2, decidido_por = $3, decidido_en = now(), nota_decision = $4 WHERE id = $1 AND estado = 'pendiente' RETURNING id`,
      [id, b.decision === 'si' ? 'autorizada' : 'rechazada', req.usuario.id, nota]);
    if (!rows.length) throw fallo(409, 'Ya no está pendiente (la ha decidido otra persona o se anuló)');
    const cl = await una(id);
    notif.avisarLuego([cl.usuario_id], 'compra_local', {
      titulo: b.decision === 'si' ? `✔ Autorizada ${cl.codigo}: di en la tienda «a cuenta, ${cl.codigo}»` : `✗ No autorizada: ${cl.que.slice(0, 60)}`,
      cuerpo: `${linea(cl)}${nota ? ` · ${req.usuario.nombre}: «${nota}»` : ''}`,
      url: '/mi-dia.html?vista=compras', tag: `cl-${id}`, urgente: true,
    });
    require('./eventos').emitir({ ruta: 'compras-locales', quien: req.usuario.nombre });
    res.json(cl);
  }));

  // Cuadrar con la factura de la tienda: { ids: [], factura } (o deshacer: { ids, factura: null })
  app.post('/api/compras-locales/cuadrar', auth.permiso('compras'), asyncH(async (req, res) => {
    const b = req.body || {};
    const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger);
    if (!ids.length) throw fallo(400, 'Marca alguna compra');
    const f = texto(b.factura, 60);
    if (f) await query(`UPDATE compras_locales SET estado = 'cuadrada', factura = $2, cuadrado_por = $3, cuadrado_en = now() WHERE id = ANY($1) AND estado IN ('comprada','cuadrada')`, [ids, f, req.usuario.id]);
    else await query(`UPDATE compras_locales SET estado = 'comprada', factura = NULL, cuadrado_por = NULL, cuadrado_en = NULL WHERE id = ANY($1) AND estado = 'cuadrada'`, [ids]);
    res.json({ ok: true });
  }));

  setTimeout(() => { recordatorios().catch(() => {}); setInterval(() => recordatorios().catch((e) => console.warn('recordatorios compras locales', e.message)), 30 * 60 * 1000); }, 50 * 1000);
}

// Para el control de costes: lo comprado (importe real) por tarea
async function costePorTarea(tareaIds) {
  if (!tareaIds.length) return new Map();
  const { rows } = await query(
    `SELECT tarea_id, sum(importe_real)::float AS importe FROM compras_locales
      WHERE tarea_id = ANY($1) AND estado IN ('comprada','cuadrada') AND importe_real IS NOT NULL GROUP BY tarea_id`, [tareaIds]);
  return new Map(rows.map((r) => [r.tarea_id, r.importe]));
}

module.exports = { montar, costePorTarea };
