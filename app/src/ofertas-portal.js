// El proveedor responde la petición de precio en la plataforma, sin cuenta ni contraseña.
//  · Cada proveedor de cada petición tiene su enlace: /oferta.html?t=<sp>.<firma>. La firma se hace
//    con la clave del servidor sobre un número aleatorio guardado en la fila (portal_nonce), así que la
//    base de datos sola no basta para fabricar el enlace. «Nuevo enlace» cambia el número y anula el anterior.
//  · Solo ve su petición: empresa, material y lo que él ha contestado. Mientras esté abierta puede
//    corregir; al cerrarse (pedidos creados o anulada) queda solo para leer.
//  · Contesta precio por línea, «no lo tengo», alternativa, entrega, portes, su referencia, notas y su PDF.
//    Al enviar avisa a compras y la oferta entra en el comparativo como cualquier otra.
const crypto = require('crypto');
const express = require('express');
const { query, tx } = require('./db');
const correo = require('./correo');
const notif = require('./notificaciones');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')));
const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const TIPOS_ARCH = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const MAX_ARCH = 6 * 1024 * 1024;
const MAX_N_ARCH = 10;

function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return req ? `${req.protocol}://${req.get('host')}` : '';
}
const firma = (sp, nonce) => correo.firmar(`oferta:${sp}:${nonce}`);

// Enlace del proveedor (lo crea la primera vez)
async function enlace(sp, req, { nuevo = false } = {}) {
  const n = crypto.randomBytes(18).toString('base64url');
  const { rows } = await query(
    `UPDATE solicitud_proveedores SET portal_nonce = ${nuevo ? '$2' : 'COALESCE(portal_nonce, $2)'} WHERE id = $1 RETURNING portal_nonce`, [sp, n]);
  if (!rows.length) throw fallo(404, 'Proveedor no encontrado en esta petición');
  return `${baseUrl(req)}/oferta.html?t=${sp}.${firma(sp, rows[0].portal_nonce)}`;
}

// Token → fila del proveedor en la petición (o 404 igual para todo lo que no cuadre)
async function porToken(t, c = { query }) {
  const m = /^(\d{1,9})\.([A-Za-z0-9_-]{32})$/.exec(String(t || ''));
  const noVale = fallo(404, 'Este enlace no es válido o ya no está activo. Pídanos uno nuevo respondiendo a nuestro correo.');
  if (!m) throw noVale;
  const sp = Number(m[1]);
  const { rows } = await c.query(
    `SELECT sp.*, sp.portes::float AS portes, p.nombre AS proveedor, s.id AS sol_id, s.codigo, s.estado AS sol_estado,
            s.responder_antes, s.necesario_el, s.notas AS sol_notas
       FROM solicitud_proveedores sp JOIN proveedores p ON p.id = sp.proveedor_id
       JOIN solicitudes_precio s ON s.id = sp.solicitud_id WHERE sp.id = $1`, [sp]);
  const r = rows[0];
  if (!r || !r.portal_nonce) throw noVale;
  const a = Buffer.from(firma(sp, r.portal_nonce)); const b = Buffer.from(m[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw noVale;
  return r;
}

async function vista(r) {
  const { ajustes } = require('./compras');
  const aj = await ajustes();
  const [{ rows: lineas }, { rows: precios }, { rows: arch }] = [
    await query(`SELECT id, descripcion, cantidad::float AS cantidad, unidad FROM solicitud_lineas WHERE solicitud_id = $1 ORDER BY orden, id`, [r.sol_id]),
    await query(`SELECT linea_id, precio::float AS precio FROM solicitud_precios WHERE sp_id = $1`, [r.id]),
    await query(`SELECT id, tipo, nombre, bytes FROM archivos WHERE ref_tipo = 'oferta' AND ref_id = $1 AND creado_por IS NULL ORDER BY id`, [r.id]),
  ];
  const pr = Object.fromEntries(precios.map((x) => [x.linea_id, x.precio]));
  // trabajo en obra (subcontrata): además, días de trabajo, personas y cuándo puede empezar
  const { rows: ob } = await query(`SELECT 1 FROM solicitud_lineas l JOIN tareas t ON t.id = l.tarea_id WHERE l.solicitud_id = $1 AND t.ext_en_obra LIMIT 1`, [r.sol_id]);
  const info = r.lineas_info || {};
  return {
    empresa: { nombre: aj.empresa.nombre, cif: aj.empresa.cif, direccion: aj.empresa.direccion, telefono: aj.empresa.telefono, email: aj.empresa.email },
    entregar_en: aj.entregar_en,
    codigo: r.codigo, proveedor: r.proveedor,
    abierta: r.sol_estado === 'abierta',
    responder_antes: r.responder_antes, necesario_el: r.necesario_el, notas_peticion: r.sol_notas,
    lineas: lineas.map((l) => ({ ...l, precio: pr[l.id] ?? null, no_tiene: !!info[l.id]?.no, alternativa: info[l.id]?.alt || '' })),
    respuesta: {
      fecha_entrega: r.fecha_entrega, portes: r.portes, ref_oferta: r.ref_oferta, notas: r.notas, contacto: r.contacto,
      dias_trabajo: r.dias_trabajo != null ? Number(r.dias_trabajo) : null, personas: r.personas, inicio_posible: r.inicio_posible ? new Date(r.inicio_posible).toLocaleDateString('sv-SE') : null,
      no_oferta: r.estado === 'no_oferta', enviada_en: r.portal_respondido_en, pdf_en: r.portal_pdf_en,
    },
    archivos: arch, en_obra: ob.length > 0,
  };
}

function montar(app, asyncH) {
  app.get('/api/oferta/:t', asyncH(async (req, res) => {
    const r = await porToken(req.params.t);
    if (!r.portal_visto_en) await query('UPDATE solicitud_proveedores SET portal_visto_en = now() WHERE id = $1', [r.id]);
    res.set('Cache-Control', 'no-store').json(await vista(r));
  }));

  // { precios: {linea_id: n|null}, lineas: {linea_id: {no, alt}}, fecha_entrega, portes, ref_oferta, notas, contacto, no_oferta }
  app.put('/api/oferta/:t', asyncH(async (req, res) => {
    const b = req.body || {};
    let r;
    await tx(async (c) => {
      r = await porToken(req.params.t, c);
      if (r.sol_estado !== 'abierta') throw fallo(409, 'Esta petición ya está cerrada; si quiere cambiar algo, contacte con nosotros.');
      const { rows: ls } = await c.query('SELECT id FROM solicitud_lineas WHERE solicitud_id = $1', [r.sol_id]);
      const validas = new Set(ls.map((l) => l.id));
      const info = {};
      let hay = false;
      for (const lid of validas) {
        const i = b.lineas?.[lid] || {};
        const no = !!i.no || !!b.no_oferta;
        const alt = texto(i.alt, 300);
        if (no || alt) info[lid] = { ...(no ? { no: true } : {}), ...(alt ? { alt } : {}) };
        const pr = no ? null : num(b.precios?.[lid]);
        if (pr == null) { await c.query('DELETE FROM solicitud_precios WHERE sp_id = $1 AND linea_id = $2', [r.id, lid]); continue; }
        if (!Number.isFinite(pr) || pr < 0 || pr > 1e7) throw fallo(400, 'Hay un precio que no es válido');
        hay = true;
        await c.query(`INSERT INTO solicitud_precios (sp_id, linea_id, precio) VALUES ($1,$2,$3) ON CONFLICT (sp_id, linea_id) DO UPDATE SET precio = EXCLUDED.precio`, [r.id, lid, pr]);
      }
      const noOferta = !!b.no_oferta || (!hay && [...validas].every((l) => info[l]?.no));
      if (!hay && !noOferta) throw fallo(400, 'Ponga el precio de alguna línea, o marque «No lo tengo» en las que no pueda servir.');
      const portes = num(b.portes);
      if (portes != null && (!Number.isFinite(portes) || portes < 0)) throw fallo(400, 'Portes no válidos');
      await c.query(`UPDATE solicitud_proveedores SET fecha_entrega = $2, portes = $3, ref_oferta = $4, notas = $5, contacto = $6,
                            lineas_info = $7, estado = $8, respondido_en = now(), portal_respondido_en = now(),
                            dias_trabajo = $9, personas = $10, inicio_posible = $11
                      WHERE id = $1`,
      [r.id, fechaOk(b.fecha_entrega), portes, texto(b.ref_oferta, 80), texto(b.notas, 2000), texto(b.contacto, 200),
        JSON.stringify(info), noOferta ? 'no_oferta' : 'respondida',
        num(b.dias_trabajo) != null && num(b.dias_trabajo) > 0 ? Math.min(999, num(b.dias_trabajo)) : null,
        num(b.personas) != null && num(b.personas) >= 0 ? Math.min(99, Math.round(num(b.personas))) : null, fechaOk(b.inicio_posible)]);
    });
    await require('./correo-ia').portalCompletado(r.id).catch(() => {});
    notif.avisarLuego(notif.conPermiso('compras'), 'oferta_recibida', {
      titulo: `${r.proveedor} ha respondido ${r.codigo}`,
      cuerpo: b.no_oferta ? 'No puede ofertar.' : 'Ha puesto sus precios en la plataforma. Ya está en el comparativo.',
      url: `/compras.html?vista=precios&sol=${r.sol_id}`, tag: `oferta-${r.id}`,
    });
    res.json(await vista(await porToken(req.params.t)));
  }));

  // «Enviar solo con mi PDF»: no rellena el formulario; la IA lee su PDF y Compras lo revisa
  app.post('/api/oferta/:t/solo-pdf', express.json({ limit: '20kb' }), asyncH(async (req, res) => {
    const r = await porToken(req.params.t);
    if (r.sol_estado !== 'abierta') throw fallo(409, 'Esta petición ya está cerrada; si quiere cambiar algo, contacte con nosotros.');
    const { rows: n } = await query(`SELECT count(*)::int AS n FROM archivos WHERE ref_tipo = 'oferta' AND ref_id = $1 AND creado_por IS NULL`, [r.id]);
    if (!n[0].n) throw fallo(400, 'Primero adjunte su oferta (PDF o foto).');
    const b = req.body || {};
    await query('UPDATE solicitud_proveedores SET notas = COALESCE($2, notas), contacto = COALESCE($3, contacto), portal_visto_en = COALESCE(portal_visto_en, now()) WHERE id = $1',
      [r.id, texto(b.notas, 2000), texto(b.contacto, 200)]);
    await require('./correo-ia').desdePortal(r.id);
    res.json(await vista(await porToken(req.params.t)));
  }));

  // Su PDF de oferta (o foto): cuerpo = el archivo
  app.post('/api/oferta/:t/archivos', express.raw({ type: TIPOS_ARCH, limit: MAX_ARCH }), asyncH(async (req, res) => {
    const r = await porToken(req.params.t);
    if (r.sol_estado !== 'abierta') throw fallo(409, 'Esta petición ya está cerrada');
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS_ARCH.includes(tipo)) throw fallo(415, 'Solo PDF o fotos');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fallo(400, 'Archivo vacío');
    const { rows: n } = await query(`SELECT count(*)::int AS n FROM archivos WHERE ref_tipo = 'oferta' AND ref_id = $1 AND creado_por IS NULL`, [r.id]);
    if (n[0].n >= MAX_N_ARCH) throw fallo(400, `Como máximo ${MAX_N_ARCH} archivos`);
    const nombre = req.headers['x-nombre'] ? decodeURIComponent(String(req.headers['x-nombre'])).slice(0, 120) : null;
    await query(`INSERT INTO archivos (tipo, bytes, nombre, datos, ref_tipo, ref_id, creado_por) VALUES ($1,$2,$3,$4,'oferta',$5,NULL)`,
      [tipo, req.body.length, nombre, req.body, r.id]);
    res.status(201).json((await vista(r)).archivos);
  }));

  app.delete('/api/oferta/:t/archivos/:id', asyncH(async (req, res) => {
    const r = await porToken(req.params.t);
    if (r.sol_estado !== 'abierta') throw fallo(409, 'Esta petición ya está cerrada');
    await query(`DELETE FROM archivos WHERE id = $1 AND ref_tipo = 'oferta' AND ref_id = $2 AND creado_por IS NULL`, [Number(req.params.id), r.id]);
    res.json((await vista(r)).archivos);
  }));

  app.get('/api/oferta/:t/archivos/:id', asyncH(async (req, res) => {
    const r = await porToken(req.params.t);
    const { rows } = await query(`SELECT tipo, nombre, datos FROM archivos WHERE id = $1 AND ref_tipo = 'oferta' AND ref_id = $2 AND creado_por IS NULL`, [Number(req.params.id), r.id]);
    if (!rows.length || !rows[0].datos) throw fallo(404, 'Archivo no encontrado');
    res.set({ 'Content-Type': rows[0].tipo, 'Content-Disposition': `inline; filename="${encodeURIComponent(rows[0].nombre || 'oferta')}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(rows[0].datos);
  }));

  // La petición en PDF, por si la quiere guardar
  app.get('/api/oferta/:t/pdf', asyncH(async (req, res) => {
    const r = await porToken(req.params.t);
    const { solicitud, pdfSolicitud } = require('./solicitudes');
    const s = await solicitud(r.sol_id);
    const pdf = await pdfSolicitud(s, await require('./compras').ajustes(), s.proveedores.find((x) => x.id === r.id));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${r.codigo}.pdf"`, 'Cache-Control': 'no-store' });
    res.send(pdf);
  }));
}

module.exports = { montar, enlace };
