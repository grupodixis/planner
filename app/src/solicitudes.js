// Peticiones de precio a proveedores (SOL-AAAA-NNNN).
//  · Se crean con líneas de «Por pedir» y los proveedores a los que se pregunta.
//  · A cada proveedor se le envía la petición en PDF (por correo desde compras@ o a mano).
//  · Sus ofertas (precio por línea, entrega, portes, PDF) se apuntan aquí; se comparan y se elige
//    proveedor por línea. «Crear pedidos» hace un pedido por proveedor con esos precios.
const PDFDocument = require('pdfkit');
const REF = require('./referencias');
const { query, tx } = require('./db');
const auth = require('./auth');
const correo = require('./correo');
const archivos = require('./archivos');
const portal = require('./ofertas-portal');
const { ajustes, lineasLibres, crearPedido, eur, cantTxt, texto, num, fechaOk } = require('./compras');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const fechaTxt = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : '');

async function siguienteCodigo(c) {
  const y = new Date().getFullYear();
  const { rows } = await c.query(`SELECT max(substring(codigo from '\\d+$')::int) AS n FROM solicitudes_precio WHERE codigo LIKE $1`, [`SOL-${y}-%`]);
  return `SOL-${y}-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}

async function solicitud(id, c = { query }) {
  const { rows } = await c.query(
    `SELECT s.*, u.nombre AS creado_por_nombre, pz.codigo AS presupuesto_codigo, pz.titulo AS presupuesto_titulo
       FROM solicitudes_precio s LEFT JOIN usuarios u ON u.id = s.creado_por LEFT JOIN presupuestos pz ON pz.id = s.presupuesto_id WHERE s.id = $1`, [id]);
  if (!rows.length) return null;
  const s = rows[0];
  // en secuencia: dentro de una transacción el cliente no admite consultas a la vez
  const sec = async (qs) => { const out = []; for (const q of qs) out.push(await q()); return out; };
  const [{ rows: lineas }, { rows: provs }, { rows: precios }] = await sec([
    () => c.query(`SELECT l.id, l.escandallo_id, l.tarea_id, COALESCE(l.catalogo_id, e.catalogo_id) AS catalogo_id, l.descripcion, l.cantidad::float AS cantidad, l.unidad, l.orden, l.elegido,
                    pr.codigo AS proyecto_codigo, pa.codigo AS partida_codigo, pa.nombre AS partida_nombre,
                    ${REF.SQL_OTS} AS ots, ${REF.SQL_PROY_TAREA} AS proyecto_tarea,
                    (SELECT min(x.fecha) FROM tarea_material m JOIN tramos x ON x.tarea_id = m.tarea_id WHERE m.escandallo_id = l.escandallo_id) AS necesaria
               FROM solicitud_lineas l LEFT JOIN partida_escandallo e ON e.id = l.escandallo_id
               LEFT JOIN partidas pa ON pa.id = e.partida_id LEFT JOIN proyectos pr ON pr.id = pa.proyecto_id
              WHERE l.solicitud_id = $1 ORDER BY l.orden, l.id`, [id]),
    () => c.query(`SELECT sp.*, sp.portes::float AS portes, sp.inicio_posible::text AS inicio_posible, p.nombre AS proveedor, p.email, p.plazo_dias,
                    (SELECT count(*)::int FROM correos co WHERE co.sp_id = sp.id) AS n_correos,
                    (SELECT count(*)::int FROM correos co WHERE co.sp_id = sp.id AND co.estado IN ('revisar','sin_asignar','error','nuevo','analizando')) AS n_revisar,
                    (SELECT max(co.id) FROM correos co WHERE co.sp_id = sp.id AND co.tipo = 'oferta' AND co.estado = 'revisar') AS correo_revisar_id
               FROM solicitud_proveedores sp JOIN proveedores p ON p.id = sp.proveedor_id
              WHERE sp.solicitud_id = $1 ORDER BY sp.id`, [id]),
    () => c.query(`SELECT pc.sp_id, pc.linea_id, pc.precio::float AS precio, pc.precio_cotizado::float AS precio_cotizado, pc.unidad_cotizada FROM solicitud_precios pc
               JOIN solicitud_proveedores sp ON sp.id = pc.sp_id WHERE sp.solicitud_id = $1`, [id]),
  ]);
  const arch = await archivos.de('oferta', provs.map((p) => p.id));
  for (const p of provs) {
    p.portal = !!p.portal_nonce;
    delete p.portal_nonce;
    p.precios = Object.fromEntries(precios.filter((x) => x.sp_id === p.id).map((x) => [x.linea_id, x.precio]));
    // lo que cotizó en su unidad (1,15 €/kg…) cuando no es la de la línea
    p.cotizados = Object.fromEntries(precios.filter((x) => x.sp_id === p.id && x.unidad_cotizada).map((x) => [x.linea_id, { precio: x.precio_cotizado, unidad: x.unidad_cotizada }]));
    p.archivos = arch.get(p.id) || [];
  }
  const U = require('./unidades');
  for (const l of lineas) { const o = await U.opcionesLinea(l.catalogo_id, l.unidad); l.unidades = o.opciones; l.equiv = o.explicacion; }
  s.lineas = lineas;
  s.proveedores = provs;
  s.habituales = await require('./precios').habitualesDeSolicitud(id).catch(() => ({}));   // precio habitual de cada línea
  return s;
}

/* ---------- PDF de la petición de oferta (sin precios) ---------- */
// Correo de petición de oferta a un proveedor (el mismo texto que propone Compras)
async function enviarAProveedor(id, sp, { para, asunto, texto: txt, enlace = true } = {}, req) {
  const s = await solicitud(id);
  const prov = s.proveedores.find((x) => x.id === sp);
  if (!prov) throw fallo(404, 'Proveedor no encontrado en esta petición');
  para = String(para || prov.email || '').trim().slice(0, 300);
  if (!para || !/@/.test(para)) throw fallo(400, `${prov.proveedor || 'El proveedor'} no tiene correo`);
  const aj = await ajustes();
  const url = enlace === false ? null : await portal.enlace(sp, req);
  const pdf = await pdfSolicitud(s, aj, prov, url);
  const recordar = !!prov.enviado_en;
  const fechaTxt = s.responder_antes ? new Date(`${String(s.responder_antes).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES') : null;
  let cuerpo = String(txt || '').slice(0, 5000) || (recordar
    ? `Buenos días:\n\nLes recordamos nuestra petición de oferta ${s.codigo}${fechaTxt ? `, que necesitaríamos antes del ${fechaTxt}` : ''}. Se la adjuntamos de nuevo.\n\nUn saludo,\n${aj.empresa.nombre}`
    : `Buenos días:\n\nLes adjuntamos petición de oferta ${s.codigo}. Les agradeceríamos precio y plazo de entrega${fechaTxt ? ` antes del ${fechaTxt}` : ''}, indicando si los portes están incluidos.\nSi responden por correo, mantengan la referencia ${s.codigo} en el asunto.\n\nUn saludo,\n${aj.empresa.nombre}`);
  if (url && !cuerpo.includes(url)) cuerpo += `\n\n— Puede responder directamente en nuestra plataforma, sin registrarse, poniendo sus precios línea a línea:\n${url}`;
  await correo.enviarOFallar({
    para, asunto: String(asunto || '').slice(0, 200) || `${recordar ? 'Recordatorio: ' : ''}[${s.codigo}] Petición de oferta · ${aj.empresa.nombre}`,
    texto: cuerpo, adjuntos: [{ nombre: `${s.codigo}.pdf`, datos: pdf, tipo: 'application/pdf' }],
    ref: { tipo: 'solicitud', id: sp, proveedor_id: prov.proveedor_id },
  });
  if (recordar) await query('UPDATE solicitud_proveedores SET recordado_en = now() WHERE id = $1', [sp]);
  else await query(`UPDATE solicitud_proveedores SET enviado_en = now(), enviado_correo = TRUE, enviado_a = $2,
                          estado = CASE WHEN estado = 'pendiente' THEN 'enviada' ELSE estado END WHERE id = $1`, [sp, para]);
  return { proveedor: prov.proveedor, para };
}

function pdfSolicitud(s, aj, prov, url) {
  return new Promise((ok, mal) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Petición de oferta ${s.codigo}`, Author: aj.empresa.nombre } });
    const trozos = [];
    doc.on('data', (b) => trozos.push(b));
    doc.on('end', () => ok(Buffer.concat(trozos)));
    doc.on('error', mal);
    const W = doc.page.width - 96;
    const gris = '#555555';
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(aj.empresa.nombre, 48, 48);
    doc.font('Helvetica').fontSize(9).fillColor(gris)
      .text([aj.empresa.cif && `CIF ${aj.empresa.cif}`, aj.empresa.direccion, aj.empresa.telefono, aj.empresa.email].filter(Boolean).join(' · '), 48, 70, { width: W * 0.6 });
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#111').text('PETICIÓN DE OFERTA', 48, 48, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).text(s.codigo, 48, 68, { width: W, align: 'right' }).text(new Date().toLocaleDateString('es-ES'), 48, 82, { width: W, align: 'right' });
    let y = 112;
    const proys = REF.proyectos(s.lineas);
    doc.roundedRect(48, y, W, proys ? 72 : 56, 4).fill('#f2f2f2');
    doc.fillColor('#111').fontSize(10);
    doc.font('Helvetica-Bold').text('Para:', 60, y + 10, { continued: true }).font('Helvetica').text(` ${prov?.proveedor || ''}`);
    doc.font('Helvetica-Bold').text('Responder antes del:', 60, y + 26, { continued: true }).font('Helvetica').text(` ${fechaTxt(s.responder_antes) || 'lo antes posible'}`);
    doc.font('Helvetica-Bold').text('Lo necesitamos el:', 60 + W * 0.5, y + 26, { continued: true }).font('Helvetica').text(` ${fechaTxt(s.necesario_el) || 'a convenir'}`);
    if (proys) doc.font('Helvetica-Bold').text(proys.includes(',') ? 'Proyectos:' : 'Proyecto:', 60, y + 42, { continued: true }).font('Helvetica').text(` ${proys}`, { width: W - 24 });
    y += proys ? 92 : 76;
    doc.font('Helvetica').fontSize(10).fillColor('#111')
      .text(`Les agradeceríamos su mejor precio y plazo de entrega para el siguiente material, indicando en su oferta la referencia de esta petición (${s.codigo})${proys ? ' y la del proyecto' : ''}.`, 48, y, { width: W });
    y = doc.y + 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gris).text('Descripción', 48, y).text('Cantidad', 48 + W * 0.7, y, { width: W * 0.3, align: 'right' });
    y += 14;
    doc.moveTo(48, y).lineTo(48 + W, y).strokeColor('#999').stroke();
    y += 6;
    doc.font('Helvetica').fontSize(10).fillColor('#111');
    for (const l of s.lineas) {
      const ref = REF.paraPdf(REF.enDocumento(l, s.lineas)); const desc = REF.paraPdf(l.descripcion);
      const h = Math.max(doc.heightOfString(desc, { width: W * 0.68 }), 12);
      const hr = ref ? doc.fontSize(8).heightOfString(`Ref.: ${ref}`, { width: W * 0.68 }) + 2 : 0; doc.fontSize(10);
      if (y + h + hr > doc.page.height - 120) { doc.addPage(); y = 48; }
      doc.fillColor('#111').text(desc, 48, y, { width: W * 0.68 });
      doc.text(`${cantTxt(l.cantidad)} ${l.unidad || ''}`, 48 + W * 0.7, y, { width: W * 0.3, align: 'right' });
      if (ref) { doc.fontSize(8).fillColor(gris).text(`Ref.: ${ref}`, 48, y + h + 1, { width: W * 0.68 }); doc.fontSize(10).fillColor('#111'); }
      y += h + hr + 6;
      doc.moveTo(48, y - 3).lineTo(48 + W, y - 3).strokeColor('#e2e2e2').stroke();
    }
    y += 12;
    doc.font('Helvetica').fontSize(9).fillColor(gris).text(`Entrega en: ${aj.entregar_en}. Indiquen si los portes están incluidos.${s.notas ? `\n${REF.paraPdf(s.notas)}` : ''}`, 48, y, { width: W });
    if (url) {
      y = doc.y + 14;
      if (y > doc.page.height - 110) { doc.addPage(); y = 48; }
      doc.roundedRect(48, y, W, 46, 4).fill('#eaf3ec');
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#111').text('Puede responder directamente en nuestra plataforma, sin registrarse:', 60, y + 9, { width: W - 24 });
      doc.font('Helvetica').fontSize(9).fillColor('#1a5fb4').text(url, 60, y + 25, { width: W - 24, link: url, underline: true });
    }
    doc.end();
  });
}

function montar(app, asyncH) {
  const pCompras = auth.permiso('compras');
  const ver = auth.permiso('compras', 'aprobar_compras', 'logistica');

  app.get('/api/compras/solicitudes', ver, asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT s.id, s.codigo, s.estado, s.responder_antes, s.necesario_el, s.creado, s.cerrado_en,
              (SELECT count(*)::int FROM solicitud_lineas l WHERE l.solicitud_id = s.id) AS n_lineas,
              (SELECT count(*)::int FROM solicitud_proveedores sp WHERE sp.solicitud_id = s.id) AS n_prov,
              (SELECT count(*)::int FROM solicitud_proveedores sp WHERE sp.solicitud_id = s.id AND sp.estado IN ('respondida','no_oferta')) AS n_resp,
              COALESCE((SELECT string_agg(DISTINCT pr.codigo, ', ') FROM solicitud_lineas l JOIN partida_escandallo e ON e.id = l.escandallo_id
                 JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos pr ON pr.id = pa.proyecto_id WHERE l.solicitud_id = s.id),
                (SELECT '🏭 OT ' || o.codigo || ' ' || o.titulo FROM ordenes o WHERE o.id = s.orden_id),
                (SELECT '📐 para presupuestar · ' || p.codigo FROM presupuestos p WHERE p.id = s.presupuesto_id)) AS proyectos, s.tipo, s.motivo
         FROM solicitudes_precio s
        WHERE s.estado = 'abierta' OR s.creado > now() - interval '90 days'
        ORDER BY (s.estado = 'abierta') DESC, s.creado DESC LIMIT 200`);
    res.json(rows);
  }));

  app.get('/api/compras/solicitudes/:id', ver, asyncH(async (req, res) => {
    const s = await solicitud(Number(req.params.id));
    if (!s) throw fallo(404, 'Petición no encontrada');
    res.json(s);
  }));

  // { escandallo_ids: [], proveedor_ids: [], responder_antes, necesario_el, notas }
  app.post('/api/compras/solicitudes', pCompras, asyncH(async (req, res) => {
    const b = req.body || {};
    const ids = (Array.isArray(b.escandallo_ids) ? b.escandallo_ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
    const provs = [...new Set((Array.isArray(b.proveedor_ids) ? b.proveedor_ids : []).map(Number).filter(Number.isInteger))].slice(0, 20);
    if (!ids.length) throw fallo(400, 'Marca alguna línea de material');
    if (!provs.length) throw fallo(400, 'Elige al menos un proveedor');
    const id = await tx(async (c) => {
      const ls = await lineasLibres(c, ids);
      const necesaria = ls.map((l) => l.necesaria).filter(Boolean).sort()[0] || null;
      const codigo = await siguienteCodigo(c);
      const { rows } = await c.query(
        `INSERT INTO solicitudes_precio (codigo, responder_antes, necesario_el, notas, creado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [codigo, fechaOk(b.responder_antes), fechaOk(b.necesario_el) || necesaria, texto(b.notas, 2000), req.usuario.id]);
      const sid = rows[0].id;
      let i = 0;
      for (const l of ls) {
        await c.query(`INSERT INTO solicitud_lineas (solicitud_id, escandallo_id, descripcion, cantidad, unidad, orden) VALUES ($1,$2,$3,$4,$5,$6)`,
          [sid, l.id, l.descripcion, l.falta, l.unidad, i++]);
        await c.query('UPDATE partida_escandallo SET solicitud_id = $2 WHERE id = $1', [l.id, sid]);
      }
      for (const p of provs) await c.query('INSERT INTO solicitud_proveedores (solicitud_id, proveedor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sid, p]);
      return sid;
    });
    res.status(201).json(await solicitud(id));
  }));

  const abierta = async (id, c = { query }) => {
    const s = await solicitud(id, c);
    if (!s) throw fallo(404, 'Petición no encontrada');
    if (s.estado !== 'abierta') throw fallo(400, 'Esta petición ya está cerrada');
    return s;
  };

  app.put('/api/compras/solicitudes/:id', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await abierta(id);
    const b = req.body || {};
    const sets = []; const vals = [id];
    for (const k of ['responder_antes', 'necesario_el']) if (k in b) { vals.push(fechaOk(b[k])); sets.push(`${k} = $${vals.length}`); }
    if ('notas' in b) { vals.push(texto(b.notas, 2000)); sets.push(`notas = $${vals.length}`); }
    if (sets.length) await query(`UPDATE solicitudes_precio SET ${sets.join(', ')} WHERE id = $1`, vals);
    res.json(await solicitud(id));
  }));

  // Anular: las líneas vuelven a «Por pedir»
  app.delete('/api/compras/solicitudes/:id', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx(async (c) => {
      await abierta(id, c);
      await c.query('UPDATE partida_escandallo SET solicitud_id = NULL WHERE solicitud_id = $1', [id]);
      await c.query('UPDATE tareas SET ext_solicitud_id = NULL WHERE ext_solicitud_id = $1', [id]);
      await c.query(`UPDATE solicitudes_precio SET estado = 'anulada', cerrado_en = now() WHERE id = $1`, [id]);
    });
    res.json({ ok: true });
  }));

  app.post('/api/compras/solicitudes/:id/proveedores', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await abierta(id);
    const p = Number(req.body?.proveedor_id);
    if (!p) throw fallo(400, 'Elige el proveedor');
    await query('INSERT INTO solicitud_proveedores (solicitud_id, proveedor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [id, p]);
    res.json(await solicitud(id));
  }));

  app.delete('/api/compras/solicitudes/:id/proveedores/:sp', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await abierta(id);
    await query('UPDATE solicitud_lineas SET elegido = NULL WHERE solicitud_id = $1 AND elegido = $2', [id, Number(req.params.sp)]);
    await query('DELETE FROM solicitud_proveedores WHERE id = $1 AND solicitud_id = $2', [Number(req.params.sp), id]);
    res.json(await solicitud(id));
  }));

  // Apuntar la oferta de un proveedor: { precios: {linea_id: precio}, fecha_entrega, portes, ref_oferta, notas, no_oferta, archivos: [] }
  app.put('/api/compras/solicitudes/:id/proveedores/:sp', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id); const sp = Number(req.params.sp);
    const b = req.body || {};
    await tx(async (c) => {
      const s = await abierta(id, c);
      const prov = s.proveedores.find((x) => x.id === sp);
      if (!prov) throw fallo(404, 'Proveedor no encontrado en esta petición');
      const lineas = new Set(s.lineas.map((l) => l.id));
      let hay = false;
      for (const [k, v] of Object.entries(b.precios || {})) {
        const lid = Number(k);
        if (!lineas.has(lid)) continue;
        const pIn = num(v);
        if (pIn == null) { await c.query('DELETE FROM solicitud_precios WHERE sp_id = $1 AND linea_id = $2', [sp, lid]); continue; }
        if (!Number.isFinite(pIn) || pIn < 0) throw fallo(400, 'Precio no válido');
        hay = true;
        const l = s.lineas.find((x) => x.id === lid);
        const cv = await require('./unidades').aLinea(l.catalogo_id, l.unidad, pIn, b.unidades?.[k]);   // cotizado en €/kg, €/barra… → €/unidad de la línea
        await c.query(`INSERT INTO solicitud_precios (sp_id, linea_id, precio, precio_cotizado, unidad_cotizada) VALUES ($1,$2,$3,$4,$5)
          ON CONFLICT (sp_id, linea_id) DO UPDATE SET precio = EXCLUDED.precio, precio_cotizado = EXCLUDED.precio_cotizado, unidad_cotizada = EXCLUDED.unidad_cotizada`,
        [sp, lid, cv.precio, cv.precio_cotizado, cv.unidad_cotizada]);
      }
      const { rows: quedan } = await c.query('SELECT 1 FROM solicitud_precios WHERE sp_id = $1 LIMIT 1', [sp]);
      const portes = num(b.portes);
      const nuevoEstado = b.no_oferta ? 'no_oferta' : quedan.length || hay ? 'respondida' : prov.estado === 'respondida' ? (prov.enviado_en ? 'enviada' : 'pendiente') : prov.estado;
      await c.query(`UPDATE solicitud_proveedores SET fecha_entrega = $2, portes = $3, ref_oferta = $4, notas = $5, estado = $6,
                            respondido_en = CASE WHEN $6 IN ('respondida','no_oferta') THEN COALESCE(respondido_en, now()) ELSE NULL END
                      WHERE id = $1`,
      ['fecha_entrega' in b ? fechaOk(b.fecha_entrega) : prov.fecha_entrega, 'portes' in b ? (Number.isFinite(portes) ? portes : null) : prov.portes,
        'ref_oferta' in b ? texto(b.ref_oferta, 80) : prov.ref_oferta, 'notas' in b ? texto(b.notas, 1000) : prov.notas, nuevoEstado].reduce((a, v) => [...a, v], [sp]));
      if (Array.isArray(b.archivos) && b.archivos.length) await archivos.enlazar(c, b.archivos, 'oferta', sp, req.usuario.id);
      await require('./precios').registrarOferta(c, sp, { via: 'manual', usuario_id: req.usuario.id });   // lista de precios
    });
    res.json(await solicitud(id));
  }));

  // Enlace del proveedor para responder en la plataforma ({ nuevo: true } anula el anterior)
  app.post('/api/compras/solicitudes/:id/proveedores/:sp/enlace', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id); const sp = Number(req.params.sp);
    const s = await solicitud(id);
    if (!s || !s.proveedores.some((x) => x.id === sp)) throw fallo(404, 'Proveedor no encontrado en esta petición');
    res.json({ url: await portal.enlace(sp, req, { nuevo: !!req.body?.nuevo }) });
  }));

  app.get('/api/compras/solicitudes/:id/pdf', ver, asyncH(async (req, res) => {
    const s = await solicitud(Number(req.params.id));
    if (!s) throw fallo(404, 'Petición no encontrada');
    const prov = s.proveedores.find((x) => x.id === Number(req.query.sp)) || null;
    const url = prov && s.estado === 'abierta' && auth.tiene(req.usuario, 'compras') ? await portal.enlace(prov.id, req) : null;
    const pdf = await pdfSolicitud(s, await ajustes(), prov, url);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${s.codigo}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  }));

  // Enviar (o recordar) a un proveedor: { correo, para, asunto, texto } o { correo: false } («lo envío yo»)
  app.post('/api/compras/solicitudes/:id/proveedores/:sp/enviar', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id); const sp = Number(req.params.sp);
    const b = req.body || {};
    const s = await abierta(id);
    const prov = s.proveedores.find((x) => x.id === sp);
    if (!prov) throw fallo(404, 'Proveedor no encontrado en esta petición');
    if (b.correo) {
      const para = texto(b.para, 300);
      if (!para || !/@/.test(para)) throw fallo(400, 'Falta el correo del proveedor');
      await enviarAProveedor(id, sp, { para, asunto: texto(b.asunto, 200), texto: b.texto ? String(b.texto).slice(0, 5000) : '', enlace: b.enlace }, req);
    } else if (prov.enviado_en) await query('UPDATE solicitud_proveedores SET recordado_en = now() WHERE id = $1', [sp]);
    else await query(`UPDATE solicitud_proveedores SET enviado_en = now(), enviado_correo = FALSE, enviado_a = NULL,
                          estado = CASE WHEN estado = 'pendiente' THEN 'enviada' ELSE estado END WHERE id = $1`, [sp]);
    res.json(await solicitud(id));
  }));

  // Elegir proveedor por línea: { elegido: { linea_id: sp_id | null } }
  app.put('/api/compras/solicitudes/:id/elegir', pCompras, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const s = await abierta(id);
    const sps = new Set(s.proveedores.map((p) => p.id));
    for (const [k, v] of Object.entries(req.body?.elegido || {})) {
      const sp = v == null || v === '' ? null : Number(v);
      if (sp != null && !sps.has(sp)) throw fallo(400, 'Proveedor no válido');
      if (sp != null && s.proveedores.find((p) => p.id === sp).precios[k] == null) throw fallo(400, 'Ese proveedor no ha dado precio de esa línea');
      await query('UPDATE solicitud_lineas SET elegido = $3 WHERE id = $2 AND solicitud_id = $1', [id, Number(k), sp]);
    }
    res.json(await solicitud(id));
  }));

  // Crear un pedido por proveedor con lo elegido; lo no elegido vuelve a «Por pedir». La petición se cierra.
  app.post('/api/compras/solicitudes/:id/pedidos', pCompras, asyncH(async (req, res) => {
    { const { rows: [m] } = await query('SELECT motivo FROM solicitudes_precio WHERE id = $1', [Number(req.params.id)]);
      if (m?.motivo === 'presupuesto') throw fallo(400, 'Es una petición para presupuestar: los precios se aplican en el presupuesto, no se crean pedidos'); }
    const id = Number(req.params.id);
    const creados = await tx(async (c) => {
      const s = await abierta(id, c);
      const elegidas = s.lineas.filter((l) => l.elegido);
      if (!elegidas.length) throw fallo(400, 'Elige proveedor en alguna línea');
      const refs = [...new Set(s.lineas.map((l) => l.proyecto_codigo).filter(Boolean))].join(', ');
      // las líneas salen de la petición para poder entrar en el pedido
      await c.query('UPDATE partida_escandallo SET solicitud_id = NULL WHERE solicitud_id = $1', [id]);
      await c.query('UPDATE tareas SET ext_solicitud_id = NULL WHERE ext_solicitud_id = $1', [id]);
      const sub = s.tipo === 'subcontratacion';
      const ot = sub && s.orden_id ? (await c.query('SELECT codigo, titulo FROM ordenes WHERE id = $1', [s.orden_id])).rows[0] : null;
      const out = [];
      for (const prov of s.proveedores) {
        const suyas = elegidas.filter((l) => l.elegido === prov.id);
        if (!suyas.length) continue;
        const lineas = suyas.map((l) => ({ escandallo_id: l.escandallo_id, tarea_id: l.tarea_id, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, precio: prov.precios[l.id] }));
        if (prov.portes) lineas.push({ descripcion: sub ? 'Portes / transporte' : 'Portes', cantidad: 1, unidad: 'ud', precio: prov.portes });
        const pid = await crearPedido(c, {
          proveedor_id: prov.proveedor_id, lineas,
          fecha_entrega: prov.fecha_entrega || s.necesario_el,
          referencia: `${ot ? `OT ${ot.codigo} ${ot.titulo}` : refs}${prov.ref_oferta ? ` · su oferta ${prov.ref_oferta}` : ''} · ${s.codigo}`,
          usuarioId: req.usuario.id, tipo: s.tipo, orden_id: s.orden_id, observaciones: sub ? s.notas : null,
        });
        out.push(pid);
      }
      await c.query(`UPDATE solicitudes_precio SET estado = 'cerrada', cerrado_en = now() WHERE id = $1`, [id]);
      return out;
    });
    res.json({ pedidos: creados });
  }));
}

module.exports = { montar, solicitud, pdfSolicitud, siguienteCodigo, enviarAProveedor };
