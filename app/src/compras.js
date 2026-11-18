// Compras: proveedores y pedidos de compra.
//  · Un pedido se prepara con líneas de «Por pedir» (material de partidas) y/o líneas a mano.
//  · Si el total pasa del límite (ajustes «compras»), lo aprueba quien tiene «aprobar_compras» (Dirección).
//  · Al enviarlo: PDF del pedido por correo al proveedor (o «lo envío yo» si no hay correo configurado),
//    y sus líneas de material pasan a «Pedido» con proveedor, fecha, nº de pedido y precio.
const PDFDocument = require('pdfkit');
const { query, tx } = require('./db');
const auth = require('./auth');
const notif = require('./notificaciones');
const correo = require('./correo');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
const eur = (x) => `${Number(x || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
const cantTxt = (x) => Number(x).toLocaleString('es-ES', { maximumFractionDigits: 3 });

const AJUSTES_DEF = {
  limite_aprobacion: 3000,
  empresa: { nombre: 'HAM Menorca', cif: '', direccion: '', telefono: '', email: 'compras@hamenorca.com' },
  entregar_en: 'Taller HAM Menorca',
  condiciones: 'Indicar el nº de pedido en el albarán y en la factura.\nEnviar el certificado de material (3.1 EN 10204) con la entrega cuando corresponda.\nFacturas a compras@hamenorca.com.',
};
async function ajustes() {
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'compras'`);
  const v = rows[0]?.valor || {};
  return { ...AJUSTES_DEF, ...v, empresa: { ...AJUSTES_DEF.empresa, ...(v.empresa || {}) } };
}

/* ---------- Proveedores ---------- */
const CAMPOS_PROV = { nombre: 120, cif: 20, email: 200, email_admin: 200, telefono: 60, contacto: 120, localidad: 120, forma_pago: 120, portes: 200, web: 200, notas: 2000 };
const SQL_PROV = `SELECT p.*, (SELECT count(*)::int FROM pedidos_compra c WHERE c.proveedor_id = p.id AND c.estado = 'enviado') AS pedidos,
                         (SELECT max(enviado_en) FROM pedidos_compra c WHERE c.proveedor_id = p.id) AS ultimo_pedido
                    FROM proveedores p`;

/* ---------- Pedidos ---------- */
const SQL_PEDIDO = `
  SELECT c.*, p.nombre AS proveedor, p.email AS proveedor_email, p.cif AS proveedor_cif, p.forma_pago AS proveedor_forma_pago,
         uc.nombre AS creado_por_nombre, ua.nombre AS aprobado_por_nombre, ue.nombre AS enviado_por_nombre,
         (SELECT count(*)::int FROM pedido_compra_lineas l WHERE l.pedido_id = c.id) AS n_lineas,
         (SELECT string_agg(DISTINCT pr.codigo, ', ') FROM pedido_compra_lineas l JOIN partida_escandallo e ON e.id = l.escandallo_id
            JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos pr ON pr.id = pa.proyecto_id WHERE l.pedido_id = c.id) AS proyectos
    FROM pedidos_compra c LEFT JOIN proveedores p ON p.id = c.proveedor_id
    LEFT JOIN usuarios uc ON uc.id = c.creado_por LEFT JOIN usuarios ua ON ua.id = c.aprobado_por LEFT JOIN usuarios ue ON ue.id = c.enviado_por`;

async function pedido(id, c = { query }) {
  const { rows } = await c.query(`${SQL_PEDIDO} WHERE c.id = $1`, [id]);
  if (!rows.length) return null;
  const { rows: lineas } = await c.query(
    `SELECT l.id, l.escandallo_id, l.descripcion, l.cantidad::float AS cantidad, l.unidad, l.precio::float AS precio, l.orden,
            pr.codigo AS proyecto_codigo, pa.codigo AS partida_codigo, pa.nombre AS partida_nombre, e.compra, e.precio_pedido::float AS precio_pedido
       FROM pedido_compra_lineas l
       LEFT JOIN partida_escandallo e ON e.id = l.escandallo_id
       LEFT JOIN partidas pa ON pa.id = e.partida_id LEFT JOIN proyectos pr ON pr.id = pa.proyecto_id
      WHERE l.pedido_id = $1 ORDER BY l.orden, l.id`, [id]);
  const aj = await ajustes();
  const p = rows[0];
  p.total = Number(p.total);
  p.lineas = lineas;
  p.limite = aj.limite_aprobacion;
  p.necesita_aprobacion = p.total > aj.limite_aprobacion;
  return p;
}

async function recalcular(c, id) {
  await c.query(`UPDATE pedidos_compra SET total = COALESCE((SELECT round(sum(cantidad * COALESCE(precio, 0)), 2)
                   FROM pedido_compra_lineas WHERE pedido_id = $1), 0) WHERE id = $1`, [id]);
}

async function siguienteCodigo(c) {
  const y = new Date().getFullYear();
  const { rows } = await c.query(`SELECT max(substring(codigo from '\\d+$')::int) AS n FROM pedidos_compra WHERE codigo LIKE $1`, [`PC-${y}-%`]);
  return `PC-${y}-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}

// Líneas de material «por pedir» que no están ya en un pedido ni pidiendo precio (con lo que falta y cuándo hace falta)
async function lineasLibres(c, ids, { solicitud = null } = {}) {
  if (!ids.length) return [];
  const { rows: ls } = await c.query(
    `SELECT e.id, e.descripcion, e.unidad, GREATEST(e.cantidad - COALESCE(e.stock, 0), 0)::float AS falta, e.compra, e.pedido_compra_id, e.solicitud_id,
            pr.codigo AS proyecto, pr.nombre AS proyecto_nombre,
            (SELECT min(x.fecha) FROM tarea_material m JOIN tramos x ON x.tarea_id = m.tarea_id WHERE m.escandallo_id = e.id) AS necesaria
       FROM partida_escandallo e JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos pr ON pr.id = pa.proyecto_id
      WHERE e.id = ANY($1)`, [ids]);
  if (ls.length !== ids.length) throw fallo(400, 'Alguna línea de material ya no existe');
  const ocupada = ls.find((l) => l.pedido_compra_id);
  if (ocupada) throw fallo(400, `«${ocupada.descripcion}» ya está en un pedido`);
  const pidiendo = ls.find((l) => l.solicitud_id && l.solicitud_id !== solicitud);
  if (pidiendo) throw fallo(400, `«${pidiendo.descripcion}» ya está pidiendo precio`);
  const noPend = ls.find((l) => l.compra !== 'por_pedir');
  if (noPend) throw fallo(400, `«${noPend.descripcion}» no está «por pedir»`);
  return ls;
}

// Crea un pedido en borrador con sus líneas; las de material quedan enlazadas al pedido
async function crearPedido(c, { proveedor_id, lineas, fecha_entrega, referencia, usuarioId }) {
  const aj = await ajustes();
  let formaPago = null;
  if (proveedor_id) { const { rows } = await c.query('SELECT forma_pago FROM proveedores WHERE id = $1', [proveedor_id]); formaPago = rows[0]?.forma_pago || null; }
  const codigo = await siguienteCodigo(c);
  const { rows } = await c.query(
    `INSERT INTO pedidos_compra (codigo, proveedor_id, fecha_entrega, entregar_en, referencia, forma_pago, creado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [codigo, proveedor_id || null, fecha_entrega || null, aj.entregar_en, texto(referencia, 300), formaPago, usuarioId]);
  const pid = rows[0].id;
  let i = 0;
  for (const l of lineas) {
    await c.query(`INSERT INTO pedido_compra_lineas (pedido_id, escandallo_id, descripcion, cantidad, unidad, precio, orden) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [pid, l.escandallo_id || null, l.descripcion, l.cantidad, l.unidad || null, l.precio ?? null, i++]);
    if (l.escandallo_id) await c.query('UPDATE partida_escandallo SET pedido_compra_id = $2, solicitud_id = NULL WHERE id = $1', [l.escandallo_id, pid]);
  }
  await recalcular(c, pid);
  return pid;
}

/* ---------- PDF del pedido ---------- */
function pdfPedido(p, aj) {
  return new Promise((ok, mal) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Pedido ${p.codigo}`, Author: aj.empresa.nombre } });
    const trozos = [];
    doc.on('data', (b) => trozos.push(b));
    doc.on('end', () => ok(Buffer.concat(trozos)));
    doc.on('error', mal);
    const gris = '#555555';
    const W = doc.page.width - 96;
    // cabecera
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(aj.empresa.nombre, 48, 48);
    doc.font('Helvetica').fontSize(9).fillColor(gris)
      .text([aj.empresa.cif && `CIF ${aj.empresa.cif}`, aj.empresa.direccion, aj.empresa.telefono, aj.empresa.email].filter(Boolean).join(' · '), 48, 70, { width: W * 0.6 });
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#111').text('PEDIDO DE COMPRA', 48, 48, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#111')
      .text(p.codigo, 48, 68, { width: W, align: 'right' })
      .text(new Date(p.enviado_en || Date.now()).toLocaleDateString('es-ES'), 48, 82, { width: W, align: 'right' });
    // datos
    let y = 112;
    doc.roundedRect(48, y, W, 70, 4).fill('#f2f2f2');
    doc.fillColor('#111').fontSize(10);
    const fila = (et, v, yy) => { doc.font('Helvetica-Bold').text(et, 60, yy, { continued: true }).font('Helvetica').text(` ${v || '—'}`); };
    fila('Proveedor:', `${p.proveedor || '—'}${p.proveedor_cif ? ` · CIF ${p.proveedor_cif}` : ''}`, y + 10);
    fila('Entrega:', `${p.fecha_entrega ? new Date(`${String(p.fecha_entrega).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : 'a convenir'}${p.entregar_en ? ` · ${p.entregar_en}` : ''}`, y + 26);
    fila('Referencia:', p.referencia, y + 42);
    if (p.forma_pago) doc.font('Helvetica-Bold').text('Pago:', 60 + W * 0.55, y + 42, { continued: true }).font('Helvetica').text(` ${p.forma_pago}`);
    y += 90;
    // líneas
    const col = [48, 48 + W * 0.56, 48 + W * 0.72, 48 + W * 0.86];
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gris);
    doc.text('Descripción', col[0], y).text('Cantidad', col[1], y, { width: W * 0.15, align: 'right' })
      .text('Precio', col[2], y, { width: W * 0.13, align: 'right' }).text('Importe', col[3], y, { width: W * 0.14, align: 'right' });
    y += 14;
    doc.moveTo(48, y).lineTo(48 + W, y).strokeColor('#999').stroke();
    y += 6;
    doc.font('Helvetica').fontSize(10).fillColor('#111');
    for (const l of p.lineas) {
      const h = Math.max(doc.heightOfString(l.descripcion, { width: W * 0.54 }), 12);
      if (y + h > doc.page.height - 140) { doc.addPage(); y = 48; }
      doc.text(l.descripcion, col[0], y, { width: W * 0.54 });
      doc.text(`${cantTxt(l.cantidad)} ${l.unidad || ''}`, col[1], y, { width: W * 0.15, align: 'right' });
      doc.text(l.precio == null ? '—' : eur(l.precio), col[2], y, { width: W * 0.13, align: 'right' });
      doc.text(l.precio == null ? '—' : eur(l.cantidad * l.precio), col[3], y, { width: W * 0.14, align: 'right' });
      y += h + 6;
      doc.moveTo(48, y - 3).lineTo(48 + W, y - 3).strokeColor('#e2e2e2').stroke();
    }
    y += 6;
    doc.font('Helvetica-Bold').fontSize(11).text(`Total: ${eur(p.total)} + IVA`, 48, y, { width: W, align: 'right' });
    y += 30;
    if (p.observaciones) { doc.font('Helvetica-Bold').fontSize(9).text('Observaciones', 48, y); doc.font('Helvetica').text(p.observaciones, 48, y + 12, { width: W }); y = doc.y + 12; }
    if (aj.condiciones) { doc.font('Helvetica-Bold').fontSize(9).fillColor(gris).text('Condiciones', 48, y); doc.font('Helvetica').text(aj.condiciones, 48, y + 12, { width: W }); }
    doc.end();
  });
}

function montar(app, asyncH) {
  const verProv = auth.permiso('compras', 'logistica', 'escandallo', 'aprobar_compras');
  const pCompras = auth.permiso('compras');
  const verPedidos = auth.permiso('compras', 'aprobar_compras', 'logistica');
  const pAprobar = auth.permiso('aprobar_compras');

  /* ---------- Ajustes ---------- */
  app.get('/api/compras/ajustes', verPedidos, asyncH(async (req, res) => res.json({ ...(await ajustes()), correo: correo.configurado(), remitente: correo.remitente() })));
  app.put('/api/compras/ajustes', auth.permiso('aprobar_compras', 'usuarios'), asyncH(async (req, res) => {
    const b = req.body || {};
    const act = await ajustes();
    const lim = num(b.limite_aprobacion);
    if (lim != null && (!Number.isFinite(lim) || lim < 0)) throw fallo(400, 'Límite no válido');
    const v = {
      limite_aprobacion: lim ?? act.limite_aprobacion,
      entregar_en: texto(b.entregar_en, 300) ?? act.entregar_en,
      condiciones: b.condiciones != null ? String(b.condiciones).slice(0, 3000) : act.condiciones,
      empresa: { ...act.empresa },
    };
    for (const k of ['nombre', 'cif', 'direccion', 'telefono', 'email']) if (b.empresa && k in b.empresa) v.empresa[k] = texto(b.empresa[k], 200) || '';
    await query(`INSERT INTO ajustes (clave, valor) VALUES ('compras', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(v)]);
    res.json(v);
  }));

  /* ---------- Proveedores ---------- */
  app.get('/api/proveedores', verProv, asyncH(async (req, res) => {
    const { rows } = await query(`${SQL_PROV} ORDER BY p.activo DESC, lower(p.nombre)`);
    res.json(rows);
  }));
  app.post('/api/proveedores', pCompras, asyncH(async (req, res) => {
    const nombre = texto(req.body?.nombre, 120);
    if (!nombre) throw fallo(400, 'Falta el nombre');
    const { rows } = await query('INSERT INTO proveedores (nombre) VALUES ($1) RETURNING id', [nombre]);
    res.status(201).json({ id: rows[0].id });
  }));
  app.put('/api/proveedores/:id', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const sets = []; const vals = [id];
    for (const [k, max] of Object.entries(CAMPOS_PROV)) if (k in b) { vals.push(texto(b[k], max)); sets.push(`${k} = $${vals.length}`); }
    if ('nombre' in b && !texto(b.nombre)) throw fallo(400, 'El nombre no puede quedar vacío');
    if ('plazo_dias' in b) { const n = num(b.plazo_dias); vals.push(Number.isInteger(n) && n >= 0 ? n : null); sets.push(`plazo_dias = $${vals.length}`); }
    if ('materiales' in b) { vals.push((Array.isArray(b.materiales) ? b.materiales : []).map((x) => texto(x, 60)).filter(Boolean).slice(0, 30)); sets.push(`materiales = $${vals.length}`); }
    if ('activo' in b) { vals.push(!!b.activo); sets.push(`activo = $${vals.length}`); }
    if (!sets.length) return res.json({ ok: true });
    const { rowCount } = await query(`UPDATE proveedores SET ${sets.join(', ')} WHERE id = $1`, vals);
    if (!rowCount) throw fallo(404, 'Proveedor no encontrado');
    const { rows } = await query(`${SQL_PROV} WHERE p.id = $1`, [id]);
    res.json(rows[0]);
  }));

  /* ---------- Pedidos ---------- */
  app.get('/api/compras/pedidos', verPedidos, asyncH(async (req, res) => {
    const { rows } = await query(`${SQL_PEDIDO} WHERE c.estado <> 'anulado' AND (c.estado <> 'enviado' OR c.enviado_en > now() - interval '90 days')
                                  ORDER BY c.creado DESC LIMIT 300`);
    const aj = await ajustes();
    res.json({ pedidos: rows.map((p) => ({ ...p, total: Number(p.total), necesita_aprobacion: Number(p.total) > aj.limite_aprobacion })), limite: aj.limite_aprobacion, correo: correo.configurado() });
  }));

  app.get('/api/compras/pedidos/:id', verPedidos, asyncH(async (req, res) => {
    const p = await pedido(Number(req.params.id));
    if (!p) throw fallo(404, 'Pedido no encontrado');
    res.json(p);
  }));

  // Nuevo pedido: { proveedor_id?, escandallo_ids?: [] } (líneas de «Por pedir»)
  app.post('/api/compras/pedidos', pCompras, asyncH(async (req, res) => {
    const b = req.body || {};
    const ids = (Array.isArray(b.escandallo_ids) ? b.escandallo_ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
    const id = await tx(async (c) => {
      const ls = await lineasLibres(c, ids);
      return crearPedido(c, {
        proveedor_id: b.proveedor_id ? Number(b.proveedor_id) : null,
        lineas: ls.map((l) => ({ escandallo_id: l.id, descripcion: l.descripcion, cantidad: l.falta, unidad: l.unidad, precio: null })),
        fecha_entrega: ls.map((l) => l.necesaria).filter(Boolean).sort()[0] || null,
        referencia: [...new Set(ls.map((l) => `${l.proyecto} · ${l.proyecto_nombre}`))].join(' / '),
        usuarioId: req.usuario.id,
      });
    });
    res.status(201).json(await pedido(id));
  }));

  const editable = (p) => ['borrador', 'por_aprobar'].includes(p.estado);

  // Cambiar datos y líneas: { proveedor_id, fecha_entrega, entregar_en, referencia, forma_pago, observaciones,
  //   lineas: [{ id?, descripcion, cantidad, unidad, precio }] }  (las que no vienen se quitan)
  app.put('/api/compras/pedidos/:id', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    await tx(async (c) => {
      const p = await pedido(id, c);
      if (!p) throw fallo(404, 'Pedido no encontrado');
      if (!editable(p)) throw fallo(400, 'Un pedido enviado ya no se cambia');
      const sets = []; const vals = [id];
      const poner = (k, v) => { vals.push(v); sets.push(`${k} = $${vals.length}`); };
      if ('proveedor_id' in b) poner('proveedor_id', b.proveedor_id ? Number(b.proveedor_id) : null);
      if ('fecha_entrega' in b) poner('fecha_entrega', fechaOk(b.fecha_entrega));
      for (const [k, m] of [['entregar_en', 300], ['referencia', 300], ['forma_pago', 120], ['observaciones', 3000]]) if (k in b) poner(k, texto(b[k], m));
      // si ya se había pedido aprobación y cambia algo, vuelve a borrador
      if (p.estado === 'por_aprobar' && (sets.length || Array.isArray(b.lineas))) sets.push(`estado = 'borrador'`, 'aprobacion_pedida_en = NULL');
      if (sets.length) await c.query(`UPDATE pedidos_compra SET ${sets.join(', ')} WHERE id = $1`, vals);
      if (Array.isArray(b.lineas)) {
        const quedan = new Set(b.lineas.map((l) => Number(l.id)).filter(Boolean));
        const fuera = p.lineas.filter((l) => !quedan.has(l.id));
        for (const l of fuera) {
          if (l.escandallo_id) await c.query('UPDATE partida_escandallo SET pedido_compra_id = NULL WHERE id = $1 AND pedido_compra_id = $2', [l.escandallo_id, id]);
          await c.query('DELETE FROM pedido_compra_lineas WHERE id = $1', [l.id]);
        }
        let i = 0;
        for (const l of b.lineas.slice(0, 200)) {
          const cant = num(l.cantidad); const precio = num(l.precio);
          if (cant != null && (!Number.isFinite(cant) || cant < 0)) throw fallo(400, 'Cantidad no válida');
          if (precio != null && (!Number.isFinite(precio) || precio < 0)) throw fallo(400, 'Precio no válido');
          const desc = texto(l.descripcion, 300);
          if (l.id) {
            await c.query(`UPDATE pedido_compra_lineas SET descripcion = COALESCE($3, descripcion), cantidad = COALESCE($4, cantidad), unidad = COALESCE($5, unidad), precio = $6, orden = $7
                            WHERE id = $1 AND pedido_id = $2`, [Number(l.id), id, desc, cant, texto(l.unidad, 20), precio, i++]);
          } else {
            if (!desc) continue;
            await c.query(`INSERT INTO pedido_compra_lineas (pedido_id, descripcion, cantidad, unidad, precio, orden) VALUES ($1,$2,$3,$4,$5,$6)`,
              [id, desc, cant || 0, texto(l.unidad, 20), precio, i++]);
          }
        }
      }
      await recalcular(c, id);
    });
    res.json(await pedido(id));
  }));

  app.delete('/api/compras/pedidos/:id', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx(async (c) => {
      const p = await pedido(id, c);
      if (!p) throw fallo(404, 'Pedido no encontrado');
      if (!editable(p)) throw fallo(400, 'Un pedido enviado no se borra');
      await c.query('UPDATE partida_escandallo SET pedido_compra_id = NULL WHERE pedido_compra_id = $1', [id]);
      await c.query('DELETE FROM pedidos_compra WHERE id = $1', [id]);
    });
    res.json({ ok: true });
  }));

  // Pedir aprobación a Dirección
  app.post('/api/compras/pedidos/:id/aprobacion', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const p = await pedido(id);
    if (!p) throw fallo(404, 'Pedido no encontrado');
    if (p.estado !== 'borrador') throw fallo(400, 'Este pedido no está en borrador');
    if (!p.proveedor_id) throw fallo(400, 'Elige el proveedor');
    if (!p.lineas.length) throw fallo(400, 'El pedido no tiene líneas');
    if (p.lineas.some((l) => l.precio == null)) throw fallo(400, 'Falta el precio de alguna línea');
    await query(`UPDATE pedidos_compra SET estado = 'por_aprobar', aprobacion_pedida_en = now(), rechazo = NULL WHERE id = $1`, [id]);
    notif.avisarLuego(notif.conPermiso('aprobar_compras'), 'compra_aprobar', {
      titulo: `Pedido por aprobar: ${p.codigo}`,
      cuerpo: `${p.proveedor} · ${eur(p.total)}${p.proyectos ? ` · ${p.proyectos}` : ''} · lo pide ${req.usuario.nombre}`,
      url: `/compras.html?pedido=${id}`, tag: `compra-${id}`, urgente: true,
    });
    res.json(await pedido(id));
  }));

  app.post('/api/compras/pedidos/:id/aprobar', pAprobar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const p = await pedido(id);
    if (!p) throw fallo(404, 'Pedido no encontrado');
    if (!['por_aprobar', 'borrador'].includes(p.estado)) throw fallo(400, 'Este pedido no está pendiente de aprobar');
    await query(`UPDATE pedidos_compra SET estado = 'aprobado', aprobado_por = $2, aprobado_en = now(), rechazo = NULL WHERE id = $1`, [id, req.usuario.id]);
    if (p.creado_por && p.creado_por !== req.usuario.id) {
      notif.avisarLuego([p.creado_por], 'compra_aprobada', { titulo: `✔ Aprobado: ${p.codigo}`, cuerpo: `${p.proveedor} · ${eur(p.total)} · ya se puede enviar`, url: `/compras.html?pedido=${id}`, tag: `compra-${id}` });
    }
    res.json(await pedido(id));
  }));

  app.post('/api/compras/pedidos/:id/rechazar', pAprobar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const p = await pedido(id);
    if (!p) throw fallo(404, 'Pedido no encontrado');
    if (p.estado !== 'por_aprobar') throw fallo(400, 'Este pedido no está pendiente de aprobar');
    const motivo = texto(req.body?.motivo, 500);
    if (!motivo) throw fallo(400, 'Escribe el motivo');
    await query(`UPDATE pedidos_compra SET estado = 'borrador', rechazo = $2, aprobacion_pedida_en = NULL WHERE id = $1`, [id, motivo]);
    if (p.creado_por) notif.avisarLuego([p.creado_por], 'compra_aprobada', { titulo: `✗ No aprobado: ${p.codigo}`, cuerpo: motivo, url: `/compras.html?pedido=${id}`, tag: `compra-${id}` });
    res.json(await pedido(id));
  }));

  app.get('/api/compras/pedidos/:id/pdf', verPedidos, asyncH(async (req, res) => {
    const p = await pedido(Number(req.params.id));
    if (!p) throw fallo(404, 'Pedido no encontrado');
    const pdf = await pdfPedido(p, await ajustes());
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${p.codigo}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  }));

  // Enviar: { correo: true, para, cc, asunto, texto } o { correo: false } («lo envío yo»)
  app.post('/api/compras/pedidos/:id/enviar', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const p = await pedido(id);
    if (!p) throw fallo(404, 'Pedido no encontrado');
    if (!['borrador', 'aprobado', 'por_aprobar'].includes(p.estado)) throw fallo(400, 'Este pedido ya se envió');
    if (!p.proveedor_id) throw fallo(400, 'Elige el proveedor');
    if (!p.lineas.length) throw fallo(400, 'El pedido no tiene líneas');
    if (p.lineas.some((l) => l.precio == null)) throw fallo(400, 'Falta el precio de alguna línea');
    if (p.necesita_aprobacion && p.estado !== 'aprobado') throw fallo(400, `Pasa de ${eur(p.limite)}: necesita la aprobación de Dirección`);
    const aj = await ajustes();
    let para = null;
    if (b.correo) {
      para = texto(b.para, 300);
      if (!para || !/@/.test(para)) throw fallo(400, 'Falta el correo del proveedor');
      const pdf = await pdfPedido({ ...p, enviado_en: new Date() }, aj);
      await correo.enviarOFallar({
        para, cc: texto(b.cc, 300), asunto: texto(b.asunto, 200) || `Pedido ${p.codigo} · ${aj.empresa.nombre}`,
        texto: String(b.texto || '').slice(0, 5000), adjuntos: [{ nombre: `${p.codigo}.pdf`, datos: pdf, tipo: 'application/pdf' }],
      });
    }
    await tx(async (c) => {
      await c.query(`UPDATE pedidos_compra SET estado = 'enviado', enviado_por = $2, enviado_en = now(), enviado_a = $3, enviado_correo = $4 WHERE id = $1`,
        [id, req.usuario.id, para, !!b.correo]);
      // sus líneas de material pasan a «Pedido»
      for (const l of p.lineas.filter((x) => x.escandallo_id)) {
        await c.query(`UPDATE partida_escandallo SET compra = 'pedido', proveedor_id = $2, fecha_prevista = $3, pedido_por = $4, pedido_en = now(),
                              num_pedido = $5, precio_pedido = $6, pedido_compra_id = $7
                        WHERE id = $1 AND compra IN ('por_pedir', 'pedido')`,
        [l.escandallo_id, p.proveedor_id, p.fecha_entrega ? String(p.fecha_entrega).slice(0, 10) : null, req.usuario.id, p.codigo, l.precio, id]);
      }
    });
    notif.avisarLuego(notif.conPermiso('logistica', 'escandallo'), 'mat_pedido', {
      titulo: `Pedido ${p.codigo} enviado`,
      cuerpo: `${p.proveedor} · ${p.lineas.length} línea${p.lineas.length === 1 ? '' : 's'}${p.fecha_entrega ? ` · llega el ${ddmm(p.fecha_entrega)}` : ''}${p.proyectos ? ` · ${p.proyectos}` : ''}`,
      url: '/logistica.html?vista=recibir', tag: `pedido-c-${id}`,
    });
    res.json(await pedido(id));
  }));
}

module.exports = { montar, ajustes, lineasLibres, crearPedido, eur, cantTxt, texto, num, fechaOk, ddmm };
