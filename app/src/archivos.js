// Fotos, documentos, audios y vídeos (justificantes, capturas…).
//  · Fotos y PDF se guardan en la base de datos: entran en las copias sin más (el móvil las reduce).
//  · Audios y vídeos pesan más: van a disco (ARCHIVOS_DIR, un volumen de Docker) y se sirven
//    con rangos (para poder saltar en el vídeo).
//  · Se suben sueltos (POST /api/archivos) y luego se enlazan a lo que corresponda (ref_tipo, ref_id).
//    Lo que no se enlaza en un día se borra solo.
//  · Un operario solo ve los suyos; el resto de usuarios con sesión, todos.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { query } = require('./db');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const EN_BD = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const EN_DISCO = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/aac', 'audio/x-m4a', 'video/webm', 'video/mp4', 'video/quicktime'];
const TIPOS = [...EN_BD, ...EN_DISCO];
const MAX_BD = 6 * 1024 * 1024;
const MAX_DISCO = 60 * 1024 * 1024;   // ~30 s de vídeo del móvil con margen
const DIR = process.env.ARCHIVOS_DIR || path.join(__dirname, '..', 'datos-archivos');
const EXT = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/aac': 'aac', 'audio/x-m4a': 'm4a',
  'video/webm': 'webm', 'video/mp4': 'mp4', 'video/quicktime': 'mov' };

// Enlaza archivos subidos por el usuario a una ficha (ausencia, captura…)
async function enlazar(c, ids, refTipo, refId, usuarioId) {
  const lista = (Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger).slice(0, 12);
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
    `SELECT id, ref_id, tipo, nombre, bytes, creado_por FROM archivos WHERE ref_tipo = $1 AND ref_id = ANY($2) ORDER BY id`, [refTipo, ids]);
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.ref_id)) m.set(r.ref_id, []);
    m.get(r.ref_id).push({ id: r.id, tipo: r.tipo, nombre: r.nombre, bytes: r.bytes, creado_por: r.creado_por });
  }
  return m;
}

async function borrarHuerfanos() {
  const { rows } = await query(`DELETE FROM archivos WHERE ref_tipo IS NULL AND creado < now() - interval '1 day' RETURNING ruta`);
  for (const r of rows) if (r.ruta) fs.promises.unlink(path.join(DIR, r.ruta)).catch(() => {});
}

function montar(app, asyncH) {
  fs.mkdirSync(DIR, { recursive: true });

  app.post('/api/archivos', express.raw({ type: TIPOS, limit: MAX_DISCO }), asyncH(async (req, res) => {
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS.includes(tipo)) throw fallo(415, 'Solo fotos, PDF, audio o vídeo');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fallo(400, 'Archivo vacío');
    const aDisco = EN_DISCO.includes(tipo);
    if (!aDisco && req.body.length > MAX_BD) throw fallo(413, 'La foto o el PDF pasa de 6 MB');
    const nombre = req.headers['x-nombre'] ? decodeURIComponent(String(req.headers['x-nombre'])).slice(0, 120) : null;
    await borrarHuerfanos();
    let ruta = null;
    if (aDisco) {
      const mes = new Date().toISOString().slice(0, 7);
      await fs.promises.mkdir(path.join(DIR, mes), { recursive: true });
      ruta = `${mes}/${crypto.randomBytes(12).toString('hex')}.${EXT[tipo]}`;
      await fs.promises.writeFile(path.join(DIR, ruta), req.body);
    }
    const { rows } = await query(
      `INSERT INTO archivos (tipo, bytes, nombre, datos, ruta, creado_por) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tipo, req.body.length, nombre, aDisco ? null : req.body, ruta, req.usuario.id]);
    res.status(201).json({ id: rows[0].id });
  }));

  app.get('/api/archivos/:id', asyncH(async (req, res) => {
    const { rows } = await query('SELECT tipo, nombre, datos, ruta, creado_por FROM archivos WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) throw fallo(404, 'Archivo no encontrado');
    const a = rows[0];
    if (req.usuario.solo_mi_dia && a.creado_por !== req.usuario.id) throw fallo(403, 'No es tuyo');
    res.set({
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.nombre || `archivo-${req.params.id}`)}`,
    });
    if (a.ruta) {
      // con rangos: el navegador puede saltar en el audio / vídeo
      return res.sendFile(path.join(DIR, a.ruta), { headers: { 'Content-Type': a.tipo } }, (e) => {
        if (e && !res.headersSent) res.status(404).json({ error: 'El archivo ya no está en el servidor' });
      });
    }
    res.type(a.tipo).send(a.datos);
  }));
}

module.exports = { montar, enlazar, de, TIPOS };
