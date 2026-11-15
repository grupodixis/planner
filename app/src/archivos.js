// Fotos y documentos (justificantes, incidencias…). Se guardan en la base de datos: así entran
// en las copias de seguridad sin más. El móvil reduce las fotos antes de subirlas (~200–400 kB).
//  · Se suben sueltas (POST /api/archivos) y luego se enlazan a lo que corresponda (ref_tipo, ref_id).
//  · Las que no se enlazan en un día se borran solas.
//  · Un operario solo ve las suyas; el resto de usuarios con sesión, todas.
const express = require('express');
const { query } = require('./db');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX = 6 * 1024 * 1024;

// Enlaza archivos subidos por el usuario a una ficha (ausencia, incidencia…)
async function enlazar(c, ids, refTipo, refId, usuarioId) {
  const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 10);
  if (!lista.length) return 0;
  const { rowCount } = await c.query(
    `UPDATE archivos SET ref_tipo = $2, ref_id = $3
      WHERE id = ANY($1) AND creado_por = $4 AND ref_tipo IS NULL`, [lista, refTipo, refId, usuarioId]);
  return rowCount;
}

// [{id, tipo, nombre}] de las fichas pedidas → Map(ref_id → lista)
async function de(refTipo, ids) {
  if (!ids.length) return new Map();
  const { rows } = await query(
    `SELECT id, ref_id, tipo, nombre, bytes FROM archivos WHERE ref_tipo = $1 AND ref_id = ANY($2) ORDER BY id`, [refTipo, ids]);
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.ref_id)) m.set(r.ref_id, []);
    m.get(r.ref_id).push({ id: r.id, tipo: r.tipo, nombre: r.nombre, bytes: r.bytes });
  }
  return m;
}

function montar(app, asyncH) {
  app.post('/api/archivos', express.raw({ type: TIPOS, limit: MAX }), asyncH(async (req, res) => {
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim();
    if (!TIPOS.includes(tipo)) throw fallo(415, 'Solo fotos (JPG, PNG, WebP) o PDF');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fallo(400, 'Archivo vacío');
    const nombre = String(req.headers['x-nombre'] || '').slice(0, 120) || null;
    // limpieza: lo subido hace más de un día y que nunca se enlazó
    await query(`DELETE FROM archivos WHERE ref_tipo IS NULL AND creado < now() - interval '1 day'`);
    const { rows } = await query(
      `INSERT INTO archivos (tipo, bytes, nombre, datos, creado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [tipo, req.body.length, nombre ? decodeURIComponent(nombre) : null, req.body, req.usuario.id]);
    res.status(201).json({ id: rows[0].id });
  }));

  app.get('/api/archivos/:id', asyncH(async (req, res) => {
    const { rows } = await query('SELECT tipo, nombre, datos, creado_por FROM archivos WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) throw fallo(404, 'Archivo no encontrado');
    if (req.usuario.solo_mi_dia && rows[0].creado_por !== req.usuario.id) throw fallo(403, 'No es tuyo');
    res.set({
      'Content-Type': rows[0].tipo,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(rows[0].nombre || `archivo-${req.params.id}`)}`,
    });
    res.send(rows[0].datos);
  }));
}

module.exports = { montar, enlazar, de };
