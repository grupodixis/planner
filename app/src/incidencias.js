// Incidencias: sistema unificado (material, transporte, calidad, avería, seguridad, proveedor…).
//  Estados: abierta → en_curso → esperando (al proveedor / transportista / subcontrata) → resuelta → cerrada.
//  Cierran el responsable del área y Operaciones (los dos). Reclamar a un tercero: informe PDF por correo o WhatsApp
//  con un enlace (sin cuenta) donde contesta qué hará y la FECHA de resolución; si la aceptamos, recordatorios ese día;
//  sin respuesta, recordatorio cada 2 días laborables. Se resuelve sola al recibir el material o al apuntar el abono.
const crypto = require('crypto');
const express = require('express');
const PDFDocument = require('pdfkit');
const { query, tx } = require('./db');
const auth = require('./auth');
const correo = require('./correo');
const notif = require('./notificaciones');
const archivos = require('./archivos');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 2000) => (v == null ? null : String(v).trim().slice(0, max) || null);
const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10)) ? String(v).slice(0, 10) : null);
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const horaMadrid = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
const fechaLarga = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
const eur = (v) => `${Number(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const TIPOS = { material: 'Material', transporte: 'Transporte', calidad: 'Calidad', averia: 'Avería', seguridad: 'Seguridad', proveedor: 'Proveedor', otro: 'Otro' };
const GRAVEDADES = ['leve', 'importante', 'critica'];
// responsable del área por tipo (se puede cambiar en cada incidencia)
const AREA_DE = { material: 'compras', transporte: 'logistica', calidad: 'planificar', averia: 'operaciones', seguridad: 'operaciones', proveedor: 'compras', otro: 'planificar' };
const AREAS = { compras: 'Compras', logistica: 'Logística', planificar: 'Producción', operaciones: 'Operaciones' };
const PEDIMOS = { reponer: 'reponer o enviar lo que falta', cambiar: 'cambiarlo por material correcto', abono: 'un descuento o abono' };
const ACCION_PROV = { reponer: 'Reponer / enviar lo que falta', cambiar: 'Cambiarlo', abono: 'Abonarlo', otro: 'Otra solución' };

const tieneRol = (u, rol) => u && (u.rol === rol || (u.roles_extra || []).includes(rol));
const esOps = (u) => tieneRol(u, 'operaciones') || u?.rol === 'admin';
const enArea = (u, area) => u?.rol === 'admin' || (area === 'operaciones' ? esOps(u) : auth.tiene(u, area));
const puedeVer = (u) => esOps(u) || ['compras', 'logistica', 'planificar', 'proyectos', 'escandallo', 'aprobar_compras'].some((k) => auth.tiene(u, k));

async function usuariosArea(area) {
  if (area === 'operaciones') {
    const { rows } = await query(`SELECT id FROM usuarios WHERE activo AND (rol = 'operaciones' OR 'operaciones' = ANY(COALESCE(roles_extra, '{}')))`);
    return rows.map((r) => r.id);
  }
  return notif.conPermiso(area);
}
async function usuariosRol(rol) {
  const { rows } = await query(`SELECT id FROM usuarios WHERE activo AND (rol = $1 OR $1 = ANY(COALESCE(roles_extra, '{}')))`, [rol]);
  return rows.map((r) => r.id);
}

/* ---------- días laborables (sin fines de semana ni festivos) ---------- */
async function sumarLaborables(desde, n) {
  const { rows } = await query(`SELECT fecha::text AS f FROM festivos WHERE fecha BETWEEN $1::date AND $1::date + 60`, [desde]);
  const fest = new Set(rows.map((r) => r.f));
  const d = new Date(`${desde}T12:00:00Z`); let k = 0;
  while (k < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const f = d.toISOString().slice(0, 10);
    if (![0, 6].includes(d.getUTCDay()) && !fest.has(f)) k++;
  }
  return d.toISOString().slice(0, 10);
}

/* ---------- enlace del proveedor ---------- */
let ultimaBase = '';
function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (req) ultimaBase = `${req.protocol}://${req.get('host')}`;
  return ultimaBase;
}
const firma = (id, nonce) => correo.firmar(`incidencia:${id}:${nonce}`);
const urlDe = (i, req) => (i.nonce ? `${baseUrl(req)}/incidencia.html?t=${i.id}.${firma(i.id, i.nonce)}` : null);

async function siguienteCodigo(c) {
  const y = new Date().getFullYear();
  const { rows } = await c.query(`SELECT max(substring(codigo from '\\d+$')::int) AS n FROM gestion_incidencias WHERE codigo LIKE $1`, [`INC-${y}-%`]);
  return `INC-${y}-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}
async function evento(c, id, tipo, txt, { usuario = null, externo = null, datos = null } = {}) {
  await c.query('INSERT INTO gestion_incidencia_eventos (incidencia_id, tipo, texto, datos, usuario_id, externo) VALUES ($1,$2,$3,$4,$5,$6)',
    [id, tipo, txt, datos, usuario?.id || null, externo]);
}

/* ---------- consulta ---------- */
const SQL_INC = `
  SELECT i.*, i.fecha_limite::text AS fecha_limite, i.necesario_el::text AS necesario_el, i.plazo_respuesta::text AS plazo_respuesta,
         i.prov_fecha::text AS prov_fecha, i.fecha_acordada::text AS fecha_acordada, i.recordatorio_en::text AS recordatorio_en,
         i.abono_pedido::float AS abono_pedido, i.prov_importe::float AS prov_importe, i.abono_importe::float AS abono_importe,
         p.nombre AS proveedor, p.email AS proveedor_email, p.telefono AS proveedor_telefono, p.transportista AS es_transportista,
         ur.nombre AS responsable, uc.nombre AS creado_por_nombre, urs.nombre AS resuelta_por_nombre,
         ucr.nombre AS cerrada_resp_nombre, uco.nombre AS cerrada_ops_nombre,
         e.descripcion AS material, e.cantidad::float AS material_cantidad, e.unidad AS material_unidad,
         en.codigo AS envio_codigo, pc.codigo AS pedido_codigo, pc.tipo AS pedido_tipo,
         t.codigo AS tarea_codigo, t.nombre AS tarea_nombre, o.codigo AS orden_codigo, o.titulo AS orden_titulo,
         pr.codigo AS proyecto_codigo, pr.nombre AS proyecto_nombre, rc.nombre AS recurso_nombre
    FROM gestion_incidencias i
    LEFT JOIN proveedores p ON p.id = i.proveedor_id
    LEFT JOIN usuarios ur ON ur.id = i.responsable_id LEFT JOIN usuarios uc ON uc.id = i.creado_por
    LEFT JOIN usuarios urs ON urs.id = i.resuelta_por
    LEFT JOIN usuarios ucr ON ucr.id = i.cerrada_resp_por LEFT JOIN usuarios uco ON uco.id = i.cerrada_ops_por
    LEFT JOIN partida_escandallo e ON e.id = i.escandallo_id
    LEFT JOIN envios en ON en.id = i.envio_id LEFT JOIN pedidos_compra pc ON pc.id = i.pedido_id
    LEFT JOIN tareas t ON t.id = i.tarea_id LEFT JOIN ordenes o ON o.id = i.orden_id
    LEFT JOIN proyectos pr ON pr.id = i.proyecto_id LEFT JOIN recursos rc ON rc.id = i.recurso_id`;

// tareas afectadas (no hechas) con su primer día planificado de hoy en adelante
async function afectadas(ids) {
  const out = new Map();
  if (!ids.length) return out;
  const { rows } = await query(
    `WITH x AS (
       SELECT i.id AS inc, i.tarea_id AS tarea FROM gestion_incidencias i WHERE i.id = ANY($1) AND i.tarea_id IS NOT NULL
       UNION SELECT i.id, tm.tarea_id FROM gestion_incidencias i JOIN tarea_material tm ON tm.escandallo_id = i.escandallo_id WHERE i.id = ANY($1)
       UNION SELECT i.id, l.tarea_id FROM gestion_incidencias i JOIN pedido_compra_lineas l ON l.pedido_id = i.pedido_id WHERE i.id = ANY($1) AND l.tarea_id IS NOT NULL
       UNION SELECT i.id, l.tarea_id FROM gestion_incidencias i JOIN envio_lineas l ON l.envio_id = i.envio_id WHERE i.id = ANY($1) AND l.tarea_id IS NOT NULL)
     SELECT x.inc, t.id, t.codigo, t.nombre, t.estado, o.id AS orden_id, o.proyecto_id,
            (SELECT min(tr.fecha)::text FROM tramos tr WHERE tr.tarea_id = t.id AND tr.fecha >= CURRENT_DATE) AS dia
       FROM x JOIN tareas t ON t.id = x.tarea JOIN ordenes o ON o.id = t.orden_id
      WHERE t.estado <> 'hecha' ORDER BY dia NULLS LAST, t.codigo`, [ids]);
  for (const r of rows) out.set(r.inc, [...(out.get(r.inc) || []), r]);
  return out;
}

function permisos(i, u) {
  const resp = i.responsable_id ? i.responsable_id === u.id || enArea(u, i.area) : enArea(u, i.area);
  return {
    editar: resp || esOps(u),
    cerrar_resp: i.estado === 'resuelta' && !i.cerrada_resp_por && (resp || u.rol === 'admin'),
    cerrar_ops: i.estado === 'resuelta' && !i.cerrada_ops_por && esOps(u),
  };
}

async function detalle(id, u, req) {
  const { rows } = await query(`${SQL_INC} WHERE i.id = $1`, [id]);
  if (!rows.length) return null;
  const i = rows[0];
  const [{ rows: ev }, arch, af] = await Promise.all([
    query(`SELECT ev.id, ev.tipo, ev.texto, ev.datos, ev.externo, ev.creado, u.nombre AS usuario FROM gestion_incidencia_eventos ev
             LEFT JOIN usuarios u ON u.id = ev.usuario_id WHERE ev.incidencia_id = $1 ORDER BY ev.creado DESC, ev.id DESC`, [id]),
    archivos.de('incidencia', [id]), afectadas([id]),
  ]);
  i.eventos = ev; i.archivos = arch.get(id) || []; i.afectadas = af.get(id) || [];
  i.url = urlDe(i, req); i.puedo = u ? permisos(i, u) : {};
  i.tipo_txt = TIPOS[i.tipo]; i.area_txt = AREAS[i.area] || i.area;
  delete i.nonce;
  return i;
}

/* ---------- crear (desde cualquier sitio) ---------- */
async function crear(c, d, usuario) {
  const tipo = TIPOS[d.tipo] ? d.tipo : 'otro';
  const gravedad = GRAVEDADES.includes(d.gravedad) ? d.gravedad : 'importante';
  const ref = {
    escandallo_id: Number(d.escandallo_id) || null, envio_id: Number(d.envio_id) || null, pedido_id: Number(d.pedido_id) || null,
    proyecto_id: Number(d.proyecto_id) || null, orden_id: Number(d.orden_id) || null, tarea_id: Number(d.tarea_id) || null,
    recurso_id: Number(d.recurso_id) || null, proveedor_id: Number(d.proveedor_id) || null,
  };
  // completar lo que se deduce
  if (ref.escandallo_id) {
    const { rows } = await c.query(
      `SELECT e.proveedor_id, pa.proyecto_id, e.descripcion,
              COALESCE(e.pedido_compra_id, (SELECT l.pedido_id FROM pedido_compra_lineas l JOIN pedidos_compra pc ON pc.id = l.pedido_id
                WHERE l.escandallo_id = e.id AND pc.estado <> 'anulado' ORDER BY l.id DESC LIMIT 1)) AS pedido_id
         FROM partida_escandallo e JOIN partidas pa ON pa.id = e.partida_id WHERE e.id = $1`, [ref.escandallo_id]);
    if (rows[0]) { ref.proveedor_id ||= rows[0].proveedor_id; ref.proyecto_id ||= rows[0].proyecto_id; ref.pedido_id ||= rows[0].pedido_id; d.titulo ||= rows[0].descripcion; }
  }
  if (ref.pedido_id && !ref.proveedor_id) {
    const { rows } = await c.query('SELECT proveedor_id, orden_id FROM pedidos_compra WHERE id = $1', [ref.pedido_id]);
    if (rows[0]) { ref.proveedor_id = rows[0].proveedor_id; ref.orden_id ||= rows[0].orden_id; }
  }
  if (ref.envio_id) {
    const { rows } = await c.query('SELECT transportista_id, codigo FROM envios WHERE id = $1', [ref.envio_id]);
    if (rows[0]) { ref.proveedor_id ||= rows[0].transportista_id; d.titulo ||= `Envío ${rows[0].codigo}`; }
  }
  if (ref.tarea_id) {
    const { rows } = await c.query('SELECT t.orden_id, o.proyecto_id, t.proveedor_id, t.nombre FROM tareas t JOIN ordenes o ON o.id = t.orden_id WHERE t.id = $1', [ref.tarea_id]);
    if (rows[0]) { ref.orden_id ||= rows[0].orden_id; ref.proyecto_id ||= rows[0].proyecto_id; ref.proveedor_id ||= rows[0].proveedor_id; d.titulo ||= rows[0].nombre; }
  }
  if (ref.orden_id && !ref.proyecto_id) {
    const { rows } = await c.query('SELECT proyecto_id FROM ordenes WHERE id = $1', [ref.orden_id]);
    ref.proyecto_id = rows[0]?.proyecto_id || null;
  }
  const txt = texto(d.texto, 4000);
  const titulo = texto(d.resumen, 140) ? `${texto(d.titulo, 120) ? `${texto(d.titulo, 120)}: ` : ''}${texto(d.resumen, 140)}`
    : texto(d.titulo, 200) || (txt ? txt.slice(0, 120) : null);
  if (!titulo) throw fallo(400, 'Pon qué pasa');
  const area = AREAS[d.area] ? d.area : AREA_DE[tipo];
  const codigo = await siguienteCodigo(c);
  const { rows } = await c.query(
    `INSERT INTO gestion_incidencias (codigo, tipo, gravedad, titulo, texto, escandallo_id, envio_id, pedido_id, proyecto_id, orden_id, tarea_id,
                              recurso_id, proveedor_id, area, responsable_id, creado_por, fecha_limite)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
    [codigo, tipo, gravedad, titulo.slice(0, 200), txt, ref.escandallo_id, ref.envio_id, ref.pedido_id, ref.proyecto_id, ref.orden_id,
      ref.tarea_id, ref.recurso_id, ref.proveedor_id, area, Number(d.responsable_id) || null, usuario?.id || null, fechaOk(d.fecha_limite)]);
  const id = rows[0].id;
  await evento(c, id, 'abierta', txt || titulo, { usuario });
  if (Array.isArray(d.archivos) && d.archivos.length) await archivos.enlazar(c, d.archivos, 'incidencia', id, usuario?.id || null);
  setImmediate(() => avisarNueva(id, usuario).catch((e) => console.warn('aviso incidencia', e.message)));
  return { id, codigo };
}

async function avisarNueva(id, usuario) {
  const { rows } = await query(`${SQL_INC} WHERE i.id = $1`, [id]);
  const i = rows[0]; if (!i) return;
  const af = (await afectadas([id])).get(id) || [];
  let ids = i.responsable_id ? [i.responsable_id] : await usuariosArea(i.area);
  ids = [...ids, ...(await usuariosArea('operaciones'))];
  if (i.gravedad === 'critica') ids = [...ids, ...(await usuariosRol('direccion'))];
  ids = [...new Set(ids)].filter((x) => x !== usuario?.id);
  const dia = af.find((a) => a.dia)?.dia;
  notif.avisarLuego(ids, 'incidencia', {
    titulo: `${i.gravedad === 'critica' ? '🚨' : '⚠'} ${i.codigo} · ${TIPOS[i.tipo]}${i.gravedad === 'critica' ? ' · CRÍTICA' : ''}`,
    cuerpo: `${i.titulo}${i.proveedor ? ` · ${i.proveedor}` : ''}${af.length ? ` · afecta a ${af.slice(0, 2).map((a) => a.codigo).join(', ')}${dia ? ` (${ddmm(dia)})` : ''}` : ''}${usuario ? ` · ${usuario.nombre}` : ''}`,
    url: `/incidencias.html?id=${id}`, tag: `inc-${id}`,
  });
}

async function avisarResponsable(i, msg, conOps = false) {
  let ids = i.responsable_id ? [i.responsable_id] : await usuariosArea(i.area);
  if (conOps) ids = [...ids, ...(await usuariosArea('operaciones'))];
  notif.avisarLuego([...new Set(ids)], 'incidencia', { ...msg, url: `/incidencias.html?id=${i.id}`, tag: `inc-${i.id}` });
}

/* ---------- resolver sola (al recibir el material que se reclamó, etc.) ---------- */
async function resolverAuto(c, where, params, txt, usuario) {
  const { rows } = await c.query(
    `UPDATE gestion_incidencias SET estado = 'resuelta', resuelta_en = now(), resuelta_por = $${params.length + 1}, resolucion = $${params.length + 2}
      WHERE ${where} AND estado IN ('abierta','en_curso','esperando') RETURNING id, codigo, area, responsable_id`, [...params, usuario?.id || null, txt]);
  for (const r of rows) await evento(c, r.id, 'resuelta', txt, { usuario });
  for (const r of rows) setImmediate(() => avisarResponsable(r, { titulo: `✔ ${r.codigo} resuelta`, cuerpo: `${txt}. Falta cerrarla (responsable y Operaciones).` }, true).catch(() => {}));
  return rows;
}

/* ---------- informe PDF ---------- */
function pdfInforme(i, aj, fotos) {
  return new Promise((ok, mal) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: `Incidencia ${i.codigo}`, Author: aj.empresa.nombre } });
    const trozos = []; doc.on('data', (b) => trozos.push(b)); doc.on('end', () => ok(Buffer.concat(trozos))); doc.on('error', mal);
    const W = doc.page.width - 96; const gris = '#555';
    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111').text(aj.empresa.nombre, 48, 48);
    doc.font('Helvetica').fontSize(9).fillColor(gris).text([aj.empresa.cif && `CIF ${aj.empresa.cif}`, aj.empresa.direccion, aj.empresa.telefono, aj.empresa.email].filter(Boolean).join(' · '), 48, 70, { width: W * 0.6 });
    doc.font('Helvetica-Bold').fontSize(15).fillColor('#b42318').text('INFORME DE INCIDENCIA', 48, 48, { width: W, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#111').text(i.codigo, 48, 68, { width: W, align: 'right' }).text(new Date(i.creado).toLocaleDateString('es-ES'), 48, 82, { width: W, align: 'right' });
    let y = 112;
    const filas = [
      ['Para:', i.proveedor],
      ['Tipo:', `${TIPOS[i.tipo]} · gravedad ${i.gravedad}`],
      i.pedido_codigo ? ['Pedido:', i.pedido_codigo] : null,
      i.envio_codigo ? ['Envío:', i.envio_codigo] : null,
      i.material ? ['Material:', `${i.material}${i.material_cantidad ? ` · ${String(i.material_cantidad).replace('.', ',')} ${i.material_unidad || ''}` : ''}`] : null,
      i.tarea_codigo ? ['Trabajo:', `${i.tarea_codigo} ${i.tarea_nombre}${i.orden_titulo ? ` · ${i.orden_titulo}` : ''}`] : null,
      i.proyecto_codigo ? ['Obra / proyecto:', `${i.proyecto_codigo} ${i.proyecto_nombre || ''}`] : null,
    ].filter(Boolean);
    doc.roundedRect(48, y, W, 16 * filas.length + 16, 4).fill('#f2f2f2'); doc.fillColor('#111').fontSize(10);
    filas.forEach(([et, v], k) => doc.font('Helvetica-Bold').text(et, 60, y + 8 + k * 16, { continued: true }).font('Helvetica').text(` ${v || '—'}`));
    y += 16 * filas.length + 32;
    doc.font('Helvetica-Bold').fontSize(11).text('Qué ha pasado', 48, y); y += 16;
    doc.font('Helvetica').fontSize(10).text(i.texto || i.titulo, 48, y, { width: W }); y = doc.y + 14;
    if (i.pedimos) {
      doc.font('Helvetica-Bold').fontSize(11).text('Qué os pedimos', 48, y); y += 16;
      doc.font('Helvetica').fontSize(10).text(`${PEDIMOS[i.pedimos]}${i.pedimos === 'abono' && i.abono_pedido ? ` de ${eur(i.abono_pedido)}` : ''}${i.necesario_el ? `, antes del ${fechaLarga(i.necesario_el)}` : ''}.`, 48, y, { width: W });
      y = doc.y + 14;
    }
    const url = urlDe(i);
    if (url) {
      doc.font('Helvetica-Bold').fontSize(11).text('Cómo responder', 48, y); y += 16;
      doc.font('Helvetica').fontSize(10).text('Indicad qué haréis y la fecha en que quedará resuelto en este enlace (sin usuario ni contraseña):', 48, y, { width: W });
      doc.fillColor('#10776c').text(url, { link: url, underline: true }); doc.fillColor('#111');
      if (i.plazo_respuesta) doc.text(`Os rogamos respuesta antes del ${fechaLarga(i.plazo_respuesta)}.`);
      y = doc.y + 14;
    }
    for (const f of fotos.slice(0, 4)) {
      try {
        if (y > doc.page.height - 260) { doc.addPage(); y = 48; }
        doc.image(f.datos, 48, y, { fit: [W, 220] }); y += 230;
      } catch { /* foto que no se puede incrustar */ }
    }
    doc.end();
  });
}
async function fotosDe(id) {
  const { rows } = await query(`SELECT tipo, datos FROM archivos WHERE ref_tipo = 'incidencia' AND ref_id = $1 AND tipo IN ('image/jpeg','image/png') ORDER BY id LIMIT 4`, [id]);
  return rows;
}
async function pdfDe(id) {
  const { rows } = await query(`${SQL_INC} WHERE i.id = $1`, [id]);
  if (!rows.length) throw fallo(404, 'Incidencia no encontrada');
  const aj = await require('./compras').ajustes();
  return { pdf: await pdfInforme(rows[0], aj, await fotosDe(id)), codigo: rows[0].codigo };
}

/* ---------- texto de la reclamación (correo y WhatsApp) ---------- */
function textoReclamacion(i, aj, url, mensaje) {
  return `${mensaje ? `${mensaje}\n\n` : 'Hola,\n\n'}`
    + `Incidencia ${i.codigo}${i.pedido_codigo ? ` · pedido ${i.pedido_codigo}` : ''}${i.envio_codigo ? ` · envío ${i.envio_codigo}` : ''}\n`
    + `${i.material ? `Material: ${i.material}\n` : ''}Qué ha pasado: ${i.texto || i.titulo}\n`
    + `${i.pedimos ? `Os pedimos: ${PEDIMOS[i.pedimos]}${i.pedimos === 'abono' && i.abono_pedido ? ` de ${eur(i.abono_pedido)}` : ''}${i.necesario_el ? `, antes del ${fechaLarga(i.necesario_el)}` : ''}.\n` : ''}`
    + `\nIndicad qué haréis y la fecha en que quedará resuelto aquí (sin usuario):\n${url}\n`
    + `${i.plazo_respuesta ? `Os rogamos respuesta antes del ${fechaLarga(i.plazo_respuesta)}.\n` : ''}`
    + `\nGracias,\n${aj.empresa.nombre}${aj.empresa.telefono ? ` · ${aj.empresa.telefono}` : ''}`;
}
function urlWhatsApp(tel, txt) {
  let n = String(tel || '').replace(/\D/g, '');
  if (n.length === 9) n = `34${n}`;
  return `https://wa.me/${n}?text=${encodeURIComponent(txt)}`;
}

/* ---------- recordatorios (cada 10 min; laborables 9–19 h) ---------- */
async function recordatorios(forzar = false) {
  const hoy = hoyMadrid(); const h = horaMadrid();
  if (!forzar && (h < 9 || h >= 19 || [0, 6].includes(new Date(`${hoy}T12:00:00Z`).getUTCDay()))) return;
  const { rows: fest } = await query('SELECT 1 FROM festivos WHERE fecha = $1', [hoy]);
  if (fest.length && !forzar) return;
  const aj = await require('./compras').ajustes();
  const { rows } = await query(`${SQL_INC} WHERE i.estado = 'esperando'`);
  for (const i of rows) {
    const url = urlDe(i);
    const email = i.email_reclamacion || i.proveedor_email;
    try {
      // a) sin respuesta pasado el plazo: correo cada 2 días laborables + aviso al responsable
      if (!i.prov_respondido_en && i.plazo_respuesta && i.plazo_respuesta < hoy) {
        const ult = i.recordatorio_en || null;
        if (!ult || (await sumarLaborables(ult, 2)) <= hoy) {
          if (email && correo.configurado() && url) {
            await correo.enviarOFallar({ para: email, asunto: `Recordatorio · incidencia ${i.codigo}${i.pedido_codigo ? ` · pedido ${i.pedido_codigo}` : ''}`,
              texto: `Hola,\n\nAún no tenemos vuestra respuesta a la incidencia ${i.codigo} (${i.titulo}).\n\n${textoReclamacion(i, aj, url, null).replace(/^Hola,\n\n/, '')}` });
          }
          await query('UPDATE gestion_incidencias SET recordatorio_en = $2, n_recordatorios = n_recordatorios + 1 WHERE id = $1', [i.id, hoy]);
          await evento({ query }, i.id, 'recordatorio', `✉ recordatorio al ${i.es_transportista ? 'transportista' : 'proveedor'} (${i.n_recordatorios + 1}.º): sin respuesta`);
          await avisarResponsable(i, { titulo: `⏳ ${i.codigo}: ${i.proveedor || 'el proveedor'} no responde`, cuerpo: `${i.titulo} · se le ha recordado (${i.n_recordatorios + 1}.º)` });
        }
      }
      // b) llega la fecha acordada: recordatorio al responsable y al proveedor (una vez)
      if (i.fecha_acordada && i.fecha_acordada <= hoy && !i.aviso_fecha_en) {
        if (email && correo.configurado()) {
          await correo.enviarOFallar({ para: email, asunto: `Hoy · incidencia ${i.codigo}${i.pedido_codigo ? ` · pedido ${i.pedido_codigo}` : ''}`,
            texto: `Hola,\n\nQuedamos en que la incidencia ${i.codigo} (${i.titulo}) quedaba resuelta el ${fechaLarga(i.fecha_acordada)}${i.prov_accion ? ` (${ACCION_PROV[i.prov_accion] || i.prov_accion})` : ''}.\n¿Nos confirmáis que está en marcha? Podéis responder aquí:\n${url}\n\nGracias,\n${aj.empresa.nombre}` });
        }
        await query('UPDATE gestion_incidencias SET aviso_fecha_en = $2 WHERE id = $1', [i.id, hoy]);
        await evento({ query }, i.id, 'recordatorio', `🔔 fecha acordada (${ddmm(i.fecha_acordada)}): recordatorio al responsable y al ${i.es_transportista ? 'transportista' : 'proveedor'}`);
        await avisarResponsable(i, { titulo: `🔔 ${i.codigo}: hoy es la fecha acordada`, cuerpo: `${i.titulo} · ${i.proveedor || ''}: ${ACCION_PROV[i.prov_accion] || ''}. Comprueba que llega o márcala resuelta.` });
      }
      // c) pasó la fecha acordada sin resolver: aviso al responsable y a Operaciones para decidir (una vez)
      if (i.fecha_acordada && i.fecha_acordada < hoy && !i.aviso_vencida_en) {
        const siguiente = await sumarLaborables(i.fecha_acordada, 1);
        if (siguiente <= hoy) {
          await query('UPDATE gestion_incidencias SET aviso_vencida_en = $2 WHERE id = $1', [i.id, hoy]);
          await evento({ query }, i.id, 'vencida', `⚠ pasó la fecha acordada (${ddmm(i.fecha_acordada)}) sin resolver: hay que decidir`);
          await avisarResponsable(i, { titulo: `⚠ ${i.codigo}: pasó la fecha sin resolver`, cuerpo: `${i.titulo} · ${i.proveedor || ''} se comprometió para el ${ddmm(i.fecha_acordada)}. Decidid: más plazo, otro proveedor…` }, true);
        }
      }
    } catch (e) { console.warn('recordatorio incidencia', i.codigo, e.message); }
  }
}

/* ---------- rutas ---------- */
function montar(app, asyncH) {
  const ver = (req) => { if (!puedeVer(req.usuario)) throw fallo(403, 'No tienes permiso'); };
  const cargar = async (id, u, paraEditar = true) => {
    const { rows } = await query('SELECT * FROM gestion_incidencias WHERE id = $1', [id]);
    if (!rows.length) throw fallo(404, 'Incidencia no encontrada');
    if (paraEditar && !permisos(rows[0], u).editar) throw fallo(403, 'Solo el responsable del área u Operaciones');
    return rows[0];
  };
  const responder = async (req, res, id) => res.json(await detalle(id, req.usuario, req));

  app.get('/api/incidencias/opciones', asyncH(async (req, res) => {
    ver(req);
    const [{ rows: prov }, { rows: us }] = await Promise.all([
      query('SELECT id, nombre, transportista FROM proveedores WHERE activo ORDER BY nombre'),
      query(`SELECT id, nombre FROM usuarios WHERE activo AND (recurso_id IS NULL OR rol <> 'operario') ORDER BY nombre`),
    ]);
    res.json({ tipos: TIPOS, areas: AREAS, area_de: AREA_DE, gravedades: GRAVEDADES, proveedores: prov, usuarios: us, accion_prov: ACCION_PROV });
  }));

  app.get('/api/incidencias', asyncH(async (req, res) => {
    ver(req);
    const u = req.usuario;
    const vista = req.query.vista || 'abiertas';
    const where = {
      abiertas: `i.estado <> 'cerrada'`,
      mias: `i.estado <> 'cerrada'`,
      esperando: `i.estado = 'esperando'`,
      por_cerrar: `i.estado = 'resuelta'`,
      cerradas: `i.estado = 'cerrada' AND i.cerrada_en > now() - interval '180 days'`,
    }[vista] || `i.estado <> 'cerrada'`;
    const filtros = []; const params = [];
    for (const k of ['tipo', 'proveedor_id', 'proyecto_id']) if (req.query[k]) { params.push(k === 'tipo' ? req.query[k] : Number(req.query[k])); filtros.push(`i.${k} = $${params.length}`); }
    const { rows } = await query(`${SQL_INC} WHERE ${where}${filtros.map((f) => ` AND ${f}`).join('')}
      ORDER BY CASE i.gravedad WHEN 'critica' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END, i.creado DESC LIMIT 400`, params);
    let lista = rows.map((i) => ({ ...i, puedo: permisos(i, u), nonce: undefined }));
    if (vista === 'mias') lista = lista.filter((i) => (i.responsable_id ? i.responsable_id === u.id : enArea(u, i.area)) && i.estado !== 'resuelta');
    if (vista === 'por_cerrar') lista = lista.filter((i) => i.puedo.cerrar_resp || i.puedo.cerrar_ops || u.rol === 'admin');
    const af = await afectadas(lista.map((i) => i.id));
    for (const i of lista) i.afectadas = af.get(i.id) || [];
    // contadores de las pestañas
    const { rows: cnt } = await query(`SELECT i.*, NULL AS nonce FROM gestion_incidencias i WHERE i.estado <> 'cerrada'`);
    const cuenta = {
      abiertas: cnt.length,
      mias: cnt.filter((i) => i.estado !== 'resuelta' && (i.responsable_id ? i.responsable_id === u.id : enArea(u, i.area))).length,
      esperando: cnt.filter((i) => i.estado === 'esperando').length,
      por_cerrar: cnt.filter((i) => { const p = permisos(i, u); return p.cerrar_resp || p.cerrar_ops; }).length,
    };
    res.json({ incidencias: lista, cuenta, tipos: TIPOS, areas: AREAS });
  }));

  // buscar una tarea u OT por su código (61.03.4 / 61.03) para abrir una incidencia de ella
  app.get('/api/incidencias-buscar', asyncH(async (req, res) => {
    ver(req);
    const q = String(req.query.q || '').trim();
    const { rows: t } = await query('SELECT id FROM tareas WHERE codigo = $1 LIMIT 1', [q]);
    if (t.length) return res.json({ tarea_id: t[0].id });
    const { rows: o } = await query('SELECT id FROM ordenes WHERE codigo = $1 OR codigo_antiguo = $1 LIMIT 1', [q]);
    res.json(o.length ? { orden_id: o[0].id } : null);
  }));

  app.get('/api/incidencias/:id', asyncH(async (req, res) => {
    ver(req);
    const i = await detalle(Number(req.params.id), req.usuario, req);
    if (!i) throw fallo(404, 'Incidencia no encontrada');
    res.json(i);
  }));

  app.post('/api/incidencias', asyncH(async (req, res) => {
    ver(req);
    const r = await tx((c) => crear(c, req.body || {}, req.usuario));
    res.status(201).json(await detalle(r.id, req.usuario, req));
  }));

  app.patch('/api/incidencias/:id', asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const i0 = await cargar(id, req.usuario);
    const set = []; const vals = []; const cambios = [];
    const poner = (col, v, txt) => { vals.push(v); set.push(`${col} = $${vals.length + 1}`); cambios.push(txt); };
    if (GRAVEDADES.includes(b.gravedad) && b.gravedad !== i0.gravedad) poner('gravedad', b.gravedad, `gravedad: ${b.gravedad}`);
    if (b.area && AREAS[b.area] && b.area !== i0.area) poner('area', b.area, `área: ${AREAS[b.area]}`);
    if ('responsable_id' in b) poner('responsable_id', Number(b.responsable_id) || null, 'responsable cambiado');
    if ('fecha_limite' in b) poner('fecha_limite', fechaOk(b.fecha_limite), `fecha límite: ${ddmm(fechaOk(b.fecha_limite)) || 'sin'}`);
    if ('proveedor_id' in b) poner('proveedor_id', Number(b.proveedor_id) || null, 'proveedor / contraparte cambiado');
    if ('titulo' in b && texto(b.titulo, 200)) poner('titulo', texto(b.titulo, 200), 'título');
    if ('texto' in b) poner('texto', texto(b.texto, 4000), 'descripción');
    if (!set.length) return responder(req, res, id);
    await tx(async (c) => {
      await c.query(`UPDATE gestion_incidencias SET ${set.join(', ')} WHERE id = $1`, [id, ...vals]);
      await evento(c, id, 'cambio', cambios.join(' · '), { usuario: req.usuario });
    });
    if (b.gravedad === 'critica' && i0.gravedad !== 'critica') setImmediate(() => avisarNueva(id, req.usuario).catch(() => {}));
    responder(req, res, id);
  }));

  app.post('/api/incidencias/:id/nota', asyncH(async (req, res) => {
    ver(req);
    const id = Number(req.params.id); const t = texto(req.body?.texto, 2000);
    const fotos = Array.isArray(req.body?.archivos) ? req.body.archivos : [];
    if (!t && !fotos.length) throw fallo(400, 'Escribe algo o añade una foto');
    await cargar(id, req.usuario, false);
    await tx(async (c) => {
      await evento(c, id, 'nota', t || '📷 foto', { usuario: req.usuario });
      if (fotos.length) await archivos.enlazar(c, fotos, 'incidencia', id, req.usuario.id);
    });
    responder(req, res, id);
  }));

  app.post('/api/incidencias/:id/en-curso', asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const i = await cargar(id, req.usuario);
    if (i.estado !== 'abierta') throw fallo(409, 'Ya estaba en curso');
    await tx(async (c) => {
      await c.query(`UPDATE gestion_incidencias SET estado = 'en_curso', responsable_id = COALESCE(responsable_id, $2) WHERE id = $1`, [id, req.usuario.id]);
      await evento(c, id, 'en_curso', `${req.usuario.nombre} se encarga`, { usuario: req.usuario });
    });
    responder(req, res, id);
  }));

  // Reclamar al proveedor / transportista / subcontrata
  app.post('/api/incidencias/:id/reclamar', asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const i0 = await cargar(id, req.usuario);
    if (['resuelta', 'cerrada'].includes(i0.estado)) throw fallo(409, 'La incidencia ya está resuelta');
    if (!i0.proveedor_id) throw fallo(400, 'Elige antes a quién se reclama (proveedor, transportista o subcontrata)');
    const pedimos = PEDIMOS[b.pedimos] ? b.pedimos : 'reponer';
    const plazoDias = Math.min(15, Math.max(1, Number(b.plazo_dias) || 2));
    const plazo = await sumarLaborables(hoyMadrid(), plazoDias);
    const canal = ['correo', 'whatsapp', 'enlace'].includes(b.canal) ? b.canal : 'enlace';
    const email = texto(b.email, 200);
    await tx(async (c) => {
      await c.query(
        `UPDATE gestion_incidencias SET estado = 'esperando', pedimos = $2, abono_pedido = $3, necesario_el = $4, plazo_respuesta = $5,
                reclamado_en = now(), email_reclamacion = COALESCE($6, email_reclamacion), nonce = COALESCE(nonce, $7),
                responsable_id = COALESCE(responsable_id, $8),
                prov_accion = NULL, prov_fecha = NULL, prov_comentario = NULL, prov_importe = NULL, prov_respondido_en = NULL,
                fecha_acordada = NULL, aceptada_en = NULL, aceptada_por = NULL, recordatorio_en = NULL, n_recordatorios = 0,
                aviso_fecha_en = NULL, aviso_vencida_en = NULL
          WHERE id = $1`,
        [id, pedimos, pedimos === 'abono' ? Number(b.abono_pedido) || null : null, fechaOk(b.necesario_el), plazo, email,
          crypto.randomBytes(18).toString('base64url'), req.usuario.id]);
    });
    const { rows } = await query(`${SQL_INC} WHERE i.id = $1`, [id]);
    const i = rows[0];
    const aj = await require('./compras').ajustes();
    const url = urlDe(i, req);
    const cuerpo = textoReclamacion(i, aj, url, texto(b.mensaje, 3000));
    let enviado = null;
    if (canal === 'correo') {
      const para = email || i.proveedor_email;
      if (!para) throw fallo(400, `${i.proveedor} no tiene email: escríbelo o usa WhatsApp`);
      const { pdf } = await pdfDe(id);
      await correo.enviarOFallar({ para, asunto: `Incidencia ${i.codigo}${i.pedido_codigo ? ` · pedido ${i.pedido_codigo}` : ''}${i.envio_codigo ? ` · envío ${i.envio_codigo}` : ''} · ${aj.empresa.nombre}`,
        texto: cuerpo, adjuntos: [{ nombre: `Incidencia ${i.codigo}.pdf`, datos: pdf, tipo: 'application/pdf' }] });
      enviado = para;
    }
    await evento({ query }, id, 'reclamada',
      `${canal === 'correo' ? `✉ reclamación enviada por correo a ${enviado} (informe PDF)` : canal === 'whatsapp' ? '🟢 reclamación por WhatsApp' : '🔗 enlace para responder copiado'}`
      + ` · pedimos ${PEDIMOS[pedimos]}${i.necesario_el ? ` antes del ${ddmm(i.necesario_el)}` : ''} · plazo de respuesta ${ddmm(plazo)}`, { usuario: req.usuario });
    res.json({ ...(await detalle(id, req.usuario, req)), whatsapp: urlWhatsApp(i.proveedor_telefono, cuerpo), texto_reclamacion: cuerpo });
  }));

  // Aceptar la fecha que da el proveedor → recordatorios ese día
  app.post('/api/incidencias/:id/aceptar-fecha', asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const i = await cargar(id, req.usuario);
    if (!i.prov_fecha) throw fallo(409, 'El proveedor aún no ha dado fecha');
    await tx(async (c) => {
      await c.query(`UPDATE gestion_incidencias SET fecha_acordada = prov_fecha, aceptada_en = now(), aceptada_por = $2, aviso_fecha_en = NULL, aviso_vencida_en = NULL WHERE id = $1`, [id, req.usuario.id]);
      await evento(c, id, 'fecha_aceptada', `✔ fecha aceptada: ${ddmm(i.prov_fecha)} (recordatorio ese día al responsable y al proveedor)`, { usuario: req.usuario });
    });
    responder(req, res, id);
  }));

  // La fecha (o la respuesta) no es aceptable: se decide qué hacer y queda escrito
  app.post('/api/incidencias/:id/decidir', asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    await cargar(id, req.usuario);
    const DEC = { otra_fecha: 'pedir otra fecha', otro_proveedor: 'pedirlo a otro proveedor', stock: 'sacarlo de stock / apañarse con lo que hay', abono: 'aceptarlo con abono', otro: 'otra decisión' };
    if (!DEC[b.decision]) throw fallo(400, 'Elige qué se hace');
    const motivo = texto(b.texto, 1000);
    if (!motivo) throw fallo(400, 'Escribe el motivo de la decisión');
    const resuelve = ['stock', 'abono'].includes(b.decision);
    await tx(async (c) => {
      await c.query(
        `UPDATE gestion_incidencias SET decision = $2, estado = $3, fecha_acordada = NULL, abono_importe = COALESCE($4, abono_importe),
                resuelta_en = CASE WHEN $5 THEN now() END, resuelta_por = CASE WHEN $5 THEN $6::int END, resolucion = CASE WHEN $5 THEN $7 END
          WHERE id = $1`,
        [id, b.decision, resuelve ? 'resuelta' : 'en_curso', b.decision === 'abono' ? Number(b.importe) || null : null, resuelve, req.usuario.id, `${DEC[b.decision]}: ${motivo}`]);
      await evento(c, id, 'decision', `Decisión: ${DEC[b.decision]}${b.decision === 'abono' && b.importe ? ` (${eur(b.importe)})` : ''} · «${motivo}»`, { usuario: req.usuario });
    });
    responder(req, res, id);
  }));

  app.post('/api/incidencias/:id/resolver', asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const i = await cargar(id, req.usuario);
    if (['resuelta', 'cerrada'].includes(i.estado)) throw fallo(409, 'Ya estaba resuelta');
    const t = texto(b.texto, 1000);
    if (!t) throw fallo(400, 'Escribe cómo se ha resuelto');
    await tx(async (c) => {
      await c.query(`UPDATE gestion_incidencias SET estado = 'resuelta', resuelta_en = now(), resuelta_por = $2, resolucion = $3,
                            abono_importe = COALESCE($4, abono_importe) WHERE id = $1`, [id, req.usuario.id, t, Number(b.abono_importe) || null]);
      await evento(c, id, 'resuelta', `${t}${b.abono_importe ? ` · abono ${eur(b.abono_importe)}` : ''}`, { usuario: req.usuario });
    });
    avisarResponsable({ ...i, id }, { titulo: `✔ ${i.codigo} resuelta`, cuerpo: `${t} · falta cerrarla (responsable y Operaciones)` }, true).catch(() => {});
    responder(req, res, id);
  }));

  // Cerrar: firma el responsable del área y firma Operaciones; con las dos, cerrada
  app.post('/api/incidencias/:id/cerrar', asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    const { rows } = await query('SELECT * FROM gestion_incidencias WHERE id = $1', [id]);
    const i = rows[0];
    if (!i) throw fallo(404, 'Incidencia no encontrada');
    const p = permisos(i, req.usuario);
    if (!p.cerrar_resp && !p.cerrar_ops) throw fallo(403, i.estado !== 'resuelta' ? 'Primero hay que resolverla' : 'La cierran el responsable del área y Operaciones');
    const causa = texto(b.causa, 1000); const acc = texto(b.accion_preventiva, 1000);
    if (i.tipo === 'calidad' && !(causa || i.causa) ) throw fallo(400, 'En calidad hay que poner la causa y qué se hará para que no se repita');
    if (i.tipo === 'calidad' && !(acc || i.accion_preventiva)) throw fallo(400, 'Pon qué se hará para que no se repita');
    await tx(async (c) => {
      await c.query(
        `UPDATE gestion_incidencias SET causa = COALESCE($2, causa), accion_preventiva = COALESCE($3, accion_preventiva),
                cerrada_resp_por = CASE WHEN $4 THEN $6::int ELSE cerrada_resp_por END, cerrada_resp_en = CASE WHEN $4 THEN now() ELSE cerrada_resp_en END,
                cerrada_ops_por = CASE WHEN $5 THEN $6::int ELSE cerrada_ops_por END, cerrada_ops_en = CASE WHEN $5 THEN now() ELSE cerrada_ops_en END
          WHERE id = $1`, [id, causa, acc, p.cerrar_resp, p.cerrar_ops, req.usuario.id]);
      const { rows: r2 } = await c.query(
        `UPDATE gestion_incidencias SET estado = 'cerrada', cerrada_en = now() WHERE id = $1 AND cerrada_resp_por IS NOT NULL AND cerrada_ops_por IS NOT NULL RETURNING id`, [id]);
      await evento(c, id, r2.length ? 'cerrada' : 'firma',
        `${r2.length ? '🔒 cerrada' : `✔ cierre firmado por ${p.cerrar_resp && p.cerrar_ops ? 'el responsable y Operaciones' : p.cerrar_resp ? 'el responsable' : 'Operaciones'}`}${causa ? ` · causa: ${causa}` : ''}${acc ? ` · para que no se repita: ${acc}` : ''}`, { usuario: req.usuario });
    });
    responder(req, res, id);
  }));

  app.post('/api/incidencias/:id/reabrir', asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await cargar(id, req.usuario);
    await tx(async (c) => {
      await c.query(`UPDATE gestion_incidencias SET estado = 'en_curso', resuelta_en = NULL, resuelta_por = NULL, cerrada_en = NULL,
                            cerrada_resp_por = NULL, cerrada_resp_en = NULL, cerrada_ops_por = NULL, cerrada_ops_en = NULL WHERE id = $1`, [id]);
      await evento(c, id, 'reabierta', `reabierta${req.body?.texto ? `: ${texto(req.body.texto, 500)}` : ''}`, { usuario: req.usuario });
    });
    responder(req, res, id);
  }));

  app.get('/api/incidencias/:id/pdf', asyncH(async (req, res) => {
    ver(req);
    const { pdf, codigo } = await pdfDe(Number(req.params.id));
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Incidencia ${codigo}.pdf"` }).send(pdf);
  }));

}

/* ---------- lo que ve el proveedor (enlace sin cuenta) ---------- */
async function porToken(t) {
  const m = /^(\d{1,9})\.([A-Za-z0-9_-]{32})$/.exec(String(t || ''));
  const noVale = fallo(404, 'Este enlace no es válido o ya no está activo.');
  if (!m) throw noVale;
  const { rows } = await query(`${SQL_INC} WHERE i.id = $1`, [Number(m[1])]);
  const i = rows[0];
  if (!i || !i.nonce) throw noVale;
  const a = Buffer.from(firma(i.id, i.nonce)); const b = Buffer.from(m[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw noVale;
  return i;
}
async function vistaExt(i) {
  const aj = await require('./compras').ajustes();
  const { rows: fotos } = await query(`SELECT id, tipo, nombre FROM archivos WHERE ref_tipo = 'incidencia' AND ref_id = $1 ORDER BY id`, [i.id]);
  return {
    empresa: { nombre: aj.empresa.nombre, telefono: aj.empresa.telefono, email: aj.empresa.email },
    codigo: i.codigo, tipo: TIPOS[i.tipo], titulo: i.titulo, texto: i.texto, proveedor: i.proveedor,
    pedido: i.pedido_codigo, envio: i.envio_codigo, material: i.material, cantidad: i.material_cantidad, unidad: i.material_unidad,
    pedimos: i.pedimos ? PEDIMOS[i.pedimos] : null, abono_pedido: i.abono_pedido, necesario_el: i.necesario_el, plazo_respuesta: i.plazo_respuesta,
    abierta: !['resuelta', 'cerrada'].includes(i.estado),
    respuesta: i.prov_respondido_en ? { accion: i.prov_accion, fecha: i.prov_fecha, comentario: i.prov_comentario, importe: i.prov_importe, en: i.prov_respondido_en } : null,
    fecha_acordada: i.fecha_acordada, acciones: ACCION_PROV,
    fotos: fotos.map((f) => ({ id: f.id, tipo: f.tipo, nombre: f.nombre })),
  };
}
function montarPublico(app, asyncH) {
  app.get('/api/incidencia-ext/:t', asyncH(async (req, res) => {
    const i = await porToken(req.params.t);
    if (!i.visto_en) await query('UPDATE gestion_incidencias SET visto_en = now() WHERE id = $1', [i.id]);
    res.set('Cache-Control', 'no-store').json(await vistaExt(i));
  }));
  app.put('/api/incidencia-ext/:t', express.json({ limit: '50kb' }), asyncH(async (req, res) => {
    const i = await porToken(req.params.t);
    if (['resuelta', 'cerrada'].includes(i.estado)) throw fallo(409, 'Esta incidencia ya está resuelta. Gracias.');
    const b = req.body || {};
    const accion = ACCION_PROV[b.accion] ? b.accion : null;
    const fecha = fechaOk(b.fecha);
    if (!accion) throw fallo(400, 'Indicad qué haréis');
    if (!fecha) throw fallo(400, 'Indicad la fecha en que quedará resuelto');
    if (fecha < hoyMadrid()) throw fallo(400, 'La fecha no puede ser anterior a hoy');
    const coment = texto(b.comentario, 1500);
    const importe = accion === 'abono' ? Number(b.importe) || null : null;
    await query(`UPDATE gestion_incidencias SET prov_accion = $2, prov_fecha = $3, prov_comentario = $4, prov_importe = $5, prov_respondido_en = now(),
                        fecha_acordada = NULL, aceptada_en = NULL, aviso_fecha_en = NULL, aviso_vencida_en = NULL WHERE id = $1`,
    [i.id, accion, fecha, coment, importe]);
    await evento({ query }, i.id, 'respuesta', `${ACCION_PROV[accion]}${importe ? ` (${eur(importe)})` : ''} · fecha de resolución ${ddmm(fecha)}${coment ? ` · «${coment}»` : ''}`, { externo: i.proveedor });
    avisarResponsable(i, { titulo: `💬 ${i.codigo}: ${i.proveedor} ha respondido`, cuerpo: `${ACCION_PROV[accion]} · resuelto el ${ddmm(fecha)}. ¿Aceptas la fecha?` }).catch(() => {});
    res.json(await vistaExt(await porToken(req.params.t)));
  }));
  app.get('/api/incidencia-ext/:t/archivos/:id', asyncH(async (req, res) => {
    const i = await porToken(req.params.t);
    const { rows } = await query(`SELECT tipo, nombre, datos FROM archivos WHERE id = $1 AND ref_tipo = 'incidencia' AND ref_id = $2`, [Number(req.params.id), i.id]);
    if (!rows.length) throw fallo(404, 'Archivo no encontrado');
    res.set({ 'Content-Type': rows[0].tipo, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).send(rows[0].datos);
  }));
  app.get('/api/incidencia-ext/:t/pdf', asyncH(async (req, res) => {
    const i = await porToken(req.params.t);
    const { pdf } = await pdfDe(i.id);
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="Incidencia ${i.codigo}.pdf"` }).send(pdf);
  }));
  setTimeout(() => {
    const rep = () => recordatorios().catch((e) => console.warn('recordatorios incidencias', e.message));
    rep(); setInterval(rep, 10 * 60 * 1000);
  }, 40 * 1000);
}

// contador del menú: lo mío por hacer + lo que me toca cerrar
async function contar(u) {
  if (!puedeVer(u)) return 0;
  const { rows } = await query(`SELECT * FROM gestion_incidencias WHERE estado <> 'cerrada'`);
  return rows.filter((i) => {
    const p = permisos(i, u);
    if (p.cerrar_resp || p.cerrar_ops) return true;
    return i.estado !== 'resuelta' && (i.responsable_id ? i.responsable_id === u.id : enArea(u, i.area));
  }).length;
}

// incidencias abiertas que afectan a cada tarea (para el cuadrante)
async function porTareas(tareaIds) {
  const out = new Map();
  if (!tareaIds.length) return out;
  const { rows } = await query(`SELECT id, codigo, tipo, gravedad, titulo, estado, fecha_acordada::text AS fecha_acordada FROM gestion_incidencias WHERE estado IN ('abierta','en_curso','esperando')`);
  if (!rows.length) return out;
  const af = await afectadas(rows.map((r) => r.id));
  const set = new Set(tareaIds);
  for (const r of rows) for (const t of af.get(r.id) || []) if (set.has(t.id)) out.set(t.id, [...(out.get(t.id) || []), r]);
  return out;
}

module.exports = { montar, montarPublico, recordatorios, crear, resolverAuto, contar, porTareas, detalle, TIPOS, AREA_DE, AREAS };
