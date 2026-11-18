// Peticiones de precio a proveedores (SOL-AAAA-NNNN).
//  · Se crean con líneas de «Por pedir» y los proveedores a los que se pregunta.
//  · A cada proveedor se le envía la petición en PDF (por correo desde gestion@ o a mano).
//  · Sus ofertas (precio por línea, entrega, portes, PDF) se apuntan aquí; se comparan y se elige
//    proveedor por línea. «Crear pedidos» hace un pedido por proveedor con esos precios.
const PDFDocument = require('pdfkit');
const { query, tx } = require('./db');
const auth = require('./auth');
const correo = require('./correo');
const archivos = require('./archivos');
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
    `SELECT s.*, u.nombre AS creado_por_nombre FROM solicitudes_precio s LEFT JOIN usuarios u ON u.id = s.creado_por WHERE s.id = $1`, [id]);
  if (!rows.length) return null;
  const s = rows[0];
  // en secuencia: dentro de una transacción el cliente no admite consultas a la vez
  const sec = async (qs) => { const out = []; for (const q of qs) out.push(await q()); return out; };
  const [{ rows: lineas }, { rows: provs }, { rows: precios }] = await sec([
    () => c.query(`SELECT l.id, l.escandallo_id, l.descripcion, l.cantidad::float AS cantidad, l.unidad, l.orden, l.elegido,
                    pr.codigo AS proyecto_codigo, pa.codigo AS partida_codigo, pa.nombre AS partida_nombre,
                    (SELECT min(x.fecha) FROM tarea_material m JOIN tramos x ON x.tarea_id = m.tarea_id WHERE m.escandallo_id = l.escandallo_id) AS necesaria
               FROM solicitud_lineas l LEFT JOIN partida_escandallo e ON e.id = l.escandallo_id
               LEFT JOIN partidas pa ON pa.id = e.partida_id LEFT JOIN proyectos pr ON pr.id = pa.proyecto_id
              WHERE l.solicitud_id = $1 ORDER BY l.orden, l.id`, [id]),
    () => c.query(`SELECT sp.*, sp.portes::float AS portes, p.nombre AS proveedor, p.email, p.plazo_dias
               FROM solicitud_proveedores sp JOIN proveedores p ON p.id = sp.proveedor_id
              WHERE sp.solicitud_id = $1 ORDER BY sp.id`, [id]),
    () => c.query(`SELECT pc.sp_id, pc.linea_id, pc.precio::float AS precio FROM solicitud_precios pc
               JOIN solicitud_proveedores sp ON sp.id = pc.sp_id WHERE sp.solicitud_id = $1`, [id]),
  ]);
  const arch = await archivos.de('oferta', provs.map((p) => p.id));
  for (const p of provs) {
    p.precios = Object.fromEntries(precios.filter((x) => x.sp_id === p.id).map((x) => [x.linea_id, x.precio]));
    p.archivos = arch.get(p.id) || [];
  }
  s.lineas = lineas;
  s.proveedores = provs;
  return s;
}

/* ---------- PDF de la petición de oferta (sin precios) ---------- */
function pdfSolicitud(s, aj, prov) {
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
    doc.roundedRect(48, y, W, 56, 4).fill('#f2f2f2');
    doc.fillColor('#111').fontSize(10);
    doc.font('Helvetica-Bold').text('Para:', 60, y + 10, { continued: true }).font('Helvetica').text(` ${prov?.proveedor || ''}`);
    doc.font('Helvetica-Bold').text('Responder antes del:', 60, y + 26, { continued: true }).font('Helvetica').text(` ${fechaTxt(s.responder_antes) || 'lo antes posible'}`);
    doc.font('Helvetica-Bold').text('Lo necesitamos el:', 60 + W * 0.5, y + 26, { continued: true }).font('Helvetica').text(` ${fechaTxt(s.necesario_el) || 'a convenir'}`);
    y += 76;
    doc.font('Helvetica').fontSize(10).fillColor('#111')
      .text('Les agradeceríamos su mejor precio y plazo de entrega para el siguiente material, indicando la referencia de esta petición en su oferta.', 48, y, { width: W });
    y = doc.y + 14;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(gris).text('Descripción', 48, y).text('Cantidad', 48 + W * 0.7, y, { width: W * 0.3, align: 'right' });
    y += 14;
    doc.moveTo(48, y).lineTo(48 + W, y).strokeColor('#999').stroke();
    y += 6;
    doc.font('Helvetica').fontSize(10).fillColor('#111');
    for (const l of s.lineas) {
      const h = Math.max(doc.heightOfString(l.descripcion, { width: W * 0.68 }), 12);
      if (y + h > doc.page.height - 120) { doc.addPage(); y = 48; }
      doc.text(l.descripcion, 48, y, { width: W * 0.68 });
      doc.text(`${cantTxt(l.cantidad)} ${l.unidad || ''}`, 48 + W * 0.7, y, { width: W * 0.3, align: 'right' });
      y += h + 6;
      doc.moveTo(48, y - 3).lineTo(48 + W, y - 3).strokeColor('#e2e2e2').stroke();
    }
    y += 12;
    doc.font('Helvetica').fontSize(9).fillColor(gris).text(`Entrega en: ${aj.entregar_en}. Indiquen si los portes están incluidos.${s.notas ? `\n${s.notas}` : ''}`, 48, y, { width: W });
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
              (SELECT string_agg(DISTINCT pr.codigo, ', ') FROM solicitud_lineas l JOIN partida_escandallo e ON e.id = l.escandallo_id
                 JOIN partidas pa ON pa.id = e.partida_id JOIN proyectos pr ON pr.id = pa.proyecto_id WHERE l.solicitud_id = s.id) AS proyectos
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
        const pr = num(v);
        if (pr == null) { await c.query('DELETE FROM solicitud_precios WHERE sp_id = $1 AND linea_id = $2', [sp, lid]); continue; }
        if (!Number.isFinite(pr) || pr < 0) throw fallo(400, 'Precio no válido');
        hay = true;
        await c.query(`INSERT INTO solicitud_precios (sp_id, linea_id, precio) VALUES ($1,$2,$3) ON CONFLICT (sp_id, linea_id) DO UPDATE SET precio = EXCLUDED.precio`, [sp, lid, pr]);
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
    });
    res.json(await solicitud(id));
  }));

  app.get('/api/compras/solicitudes/:id/pdf', ver, asyncH(async (req, res) => {
    const s = await solicitud(Number(req.params.id));
    if (!s) throw fallo(404, 'Petición no encontrada');
    const prov = s.proveedores.find((x) => x.id === Number(req.query.sp)) || null;
    const pdf = await pdfSolicitud(s, await ajustes(), prov);
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
    const recordar = !!prov.enviado_en;
    let para = null;
    if (b.correo) {
      para = texto(b.para, 300);
      if (!para || !/@/.test(para)) throw fallo(400, 'Falta el correo del proveedor');
      const aj = await ajustes();
      const pdf = await pdfSolicitud(s, aj, prov);
      await correo.enviarOFallar({
        para, asunto: texto(b.asunto, 200) || `[${s.codigo}] Petición de oferta · ${aj.empresa.nombre}`,
        texto: String(b.texto || '').slice(0, 5000), adjuntos: [{ nombre: `${s.codigo}.pdf`, datos: pdf, tipo: 'application/pdf' }],
      });
    }
    if (recordar) await query('UPDATE solicitud_proveedores SET recordado_en = now() WHERE id = $1', [sp]);
    else {
      await query(`UPDATE solicitud_proveedores SET enviado_en = now(), enviado_correo = $2, enviado_a = $3,
                          estado = CASE WHEN estado = 'pendiente' THEN 'enviada' ELSE estado END WHERE id = $1`, [sp, !!b.correo, para]);
    }
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
    const id = Number(req.params.id);
    const creados = await tx(async (c) => {
      const s = await abierta(id, c);
      const elegidas = s.lineas.filter((l) => l.elegido);
      if (!elegidas.length) throw fallo(400, 'Elige proveedor en alguna línea');
      const refs = [...new Set(s.lineas.map((l) => l.proyecto_codigo).filter(Boolean))].join(', ');
      // las líneas salen de la petición para poder entrar en el pedido
      await c.query('UPDATE partida_escandallo SET solicitud_id = NULL WHERE solicitud_id = $1', [id]);
      const out = [];
      for (const prov of s.proveedores) {
        const suyas = elegidas.filter((l) => l.elegido === prov.id);
        if (!suyas.length) continue;
        const lineas = suyas.map((l) => ({ escandallo_id: l.escandallo_id, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, precio: prov.precios[l.id] }));
        if (prov.portes) lineas.push({ descripcion: 'Portes', cantidad: 1, unidad: 'ud', precio: prov.portes });
        const pid = await crearPedido(c, {
          proveedor_id: prov.proveedor_id, lineas,
          fecha_entrega: prov.fecha_entrega || s.necesario_el,
          referencia: `${refs}${prov.ref_oferta ? ` · su oferta ${prov.ref_oferta}` : ''} · ${s.codigo}`,
          usuarioId: req.usuario.id,
        });
        out.push(pid);
      }
      await c.query(`UPDATE solicitudes_precio SET estado = 'cerrada', cerrado_en = now() WHERE id = $1`, [id]);
      return out;
    });
    res.json({ pedidos: creados });
  }));
}

module.exports = { montar };
