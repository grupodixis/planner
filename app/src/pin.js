// Entrada con PIN para operarios, solo desde dispositivos autorizados.
//  · Un DISPOSITIVO se autoriza una vez:
//      - tablet común del taller: la registra alguien con permiso «usuarios» desde ese navegador;
//      - móvil de un operario: con un enlace de un solo uso que se le manda (WhatsApp, correo…).
//    El navegador guarda una cookie larga (HttpOnly). Sin ella, el PIN no sirve de nada.
//  · El PIN (4 cifras) es del usuario «operario» ligado a su ficha de recurso. Ese usuario solo
//    tiene el permiso «mi_dia»: solo ve y apunta su propio día.
//  · 5 fallos seguidos bloquean a ese operario 15 min; 20 fallos, el dispositivo.
//  · En la tablet común la sesión dura 15 min (y la pantalla sale sola al enviar o al quedarse quieta).
const crypto = require('crypto');
const { query, tx } = require('./db');
const auth = require('./auth');

const COOKIE_DISP = 's360_disp';
const DISP_MS = 400 * 24 * 3600 * 1000;          // lo máximo que permiten los navegadores
const SESION_COMUN_MS = 15 * 60 * 1000;
const SESION_PERSONAL_MS = 12 * 3600 * 1000;
const ALTA_MOVIL_H = 72;

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex');
const PIN_RE = /^\d{4}$/;
const PIN_FACILES = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '9876']);

function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `scrypt:${salt}:${crypto.scryptSync(`pin:${pin}`, salt, 64).toString('hex')}`;
}
function verificarPin(pin, almacenado) {
  const [alg, salt, hash] = String(almacenado || '').split(':');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const calc = crypto.scryptSync(`pin:${pin}`, salt, 64);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

function ponerCookieDispositivo(res, token) {
  const segura = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.append('Set-Cookie', `${COOKIE_DISP}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${DISP_MS / 1000}${segura}`);
}

async function dispositivoDe(req) {
  const token = auth.leerCookie(req, COOKIE_DISP);
  if (!token) return null;
  const { rows } = await query(
    `SELECT d.id, d.nombre, d.tipo, d.usuario_id FROM dispositivos d
      LEFT JOIN usuarios u ON u.id = d.usuario_id
     WHERE d.token_hash = $1 AND d.activo AND (d.tipo = 'comun' OR u.activo)`, [sha(token)]);
  return rows[0] || null;
}

async function nuevoDispositivo(c, res, { nombre, tipo, usuarioId = null, por = null }) {
  const token = crypto.randomBytes(32).toString('base64url');
  const { rows } = await c.query(
    `INSERT INTO dispositivos (token_hash, nombre, tipo, usuario_id, creado_por) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [sha(token), nombre, tipo, usuarioId, por]);
  ponerCookieDispositivo(res, token);
  return rows[0].id;
}

// Operarios que pueden entrar con PIN (usuario operario activo, con PIN, solo «mi_dia»)
const SQL_OPERARIOS_PIN = `
  SELECT u.id, u.nombre, u.recurso_id, u.pin_hash, COALESCE(r.permisos, '{}') AS permisos
    FROM usuarios u JOIN roles r ON r.clave = u.rol JOIN recursos re ON re.id = u.recurso_id AND re.activo
   WHERE u.activo AND u.pin_hash IS NOT NULL`;

/* ---------- Público (sin sesión) ---------- */
function publico(app, asyncH) {
  // ¿Este navegador es un dispositivo autorizado? → quién puede entrar en él
  app.get('/api/pin/dispositivo', asyncH(async (req, res) => {
    const d = await dispositivoDe(req);
    if (!d) return res.status(404).json({ error: 'Este dispositivo no está autorizado para entrar con PIN' });
    const { rows } = await query(
      `${SQL_OPERARIOS_PIN} ${d.tipo === 'personal' ? 'AND u.id = $1' : ''} ORDER BY u.nombre`, d.tipo === 'personal' ? [d.usuario_id] : []);
    res.json({
      nombre: d.nombre, tipo: d.tipo,
      personas: rows.filter((u) => auth.soloMiDia(u)).map((u) => ({ id: u.id, nombre: u.nombre })),
    });
  }));

  app.post('/api/pin/entrar', asyncH(async (req, res) => {
    const d = await dispositivoDe(req);
    if (!d) throw fallo(403, 'Este dispositivo no está autorizado para entrar con PIN');
    const usuarioId = Number(req.body?.usuario_id);
    const pin = String(req.body?.pin || '');
    if (d.tipo === 'personal' && usuarioId !== d.usuario_id) throw fallo(403, 'Este móvil es de otra persona');
    const claves = [`pin:u:${usuarioId}`, `ip:pin-disp-${d.id}`];
    const min = auth.bloqueado(...claves);
    if (min) throw fallo(429, `Demasiados intentos. Prueba dentro de ${min} min o avisa al encargado.`);
    const { rows } = await query(`${SQL_OPERARIOS_PIN} AND u.id = $1`, [usuarioId]);
    const u = rows[0];
    if (!u || !auth.soloMiDia(u) || !PIN_RE.test(pin) || !verificarPin(pin, u.pin_hash)) {
      // el dispositivo cuenta como «ip» para el bloqueo largo (20 fallos)
      auth.anotarFallo(`pin:u:${usuarioId}`, `ip:pin-disp-${d.id}`);
      throw fallo(401, 'PIN incorrecto');
    }
    auth.anotarAcierto(`pin:u:${usuarioId}`);
    const comun = d.tipo === 'comun';
    await auth.crearSesion(res, u.id, { duracionMs: comun ? SESION_COMUN_MS : SESION_PERSONAL_MS, via: comun ? 'pin_comun' : 'pin_personal' });
    await query('UPDATE dispositivos SET ultimo_uso = now() WHERE id = $1', [d.id]);
    res.json({ ok: true, comun });
  }));

  // Abrir en el móvil el enlace de alta: el móvil queda autorizado para ese operario
  app.post('/api/pin/alta-movil', asyncH(async (req, res) => {
    const token = String(req.body?.token || '');
    const out = await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT a.usuario_id, u.nombre FROM altas_movil a JOIN usuarios u ON u.id = a.usuario_id AND u.activo
          WHERE a.token_hash = $1 AND a.usado IS NULL AND a.expira > now() FOR UPDATE OF a`, [sha(token)]);
      if (!rows.length) throw fallo(404, 'El enlace no es válido, ya se usó o ha caducado. Pide otro al encargado.');
      await c.query('UPDATE altas_movil SET usado = now() WHERE token_hash = $1', [sha(token)]);
      // un móvil por operario: el anterior deja de valer
      await c.query(`UPDATE dispositivos SET activo = FALSE WHERE tipo = 'personal' AND usuario_id = $1`, [rows[0].usuario_id]);
      await nuevoDispositivo(c, res, { nombre: `Móvil de ${rows[0].nombre}`, tipo: 'personal', usuarioId: rows[0].usuario_id });
      return { ok: true, nombre: rows[0].nombre };
    });
    res.json(out);
  }));
}

/* ---------- Gestión (con sesión y permiso «usuarios») ---------- */
function gestion(app, asyncH) {
  const admin = auth.permiso('usuarios');

  app.get('/api/pin', admin, asyncH(async (req, res) => {
    const [{ rows: operarios }, { rows: dispositivos }] = await Promise.all([
      query(`SELECT re.id AS recurso_id, re.nombre, u.id AS usuario_id, (u.pin_hash IS NOT NULL) AS tiene_pin, u.activo,
                    u.ultimo_acceso,
                    (SELECT max(d.ultimo_uso) FROM dispositivos d WHERE d.usuario_id = u.id AND d.activo) AS movil_uso,
                    EXISTS (SELECT 1 FROM dispositivos d WHERE d.usuario_id = u.id AND d.activo) AS tiene_movil,
                    EXISTS (SELECT 1 FROM altas_movil a WHERE a.usuario_id = u.id AND a.usado IS NULL AND a.expira > now()) AS alta_pendiente
               FROM recursos re
               LEFT JOIN usuarios u ON u.recurso_id = re.id AND u.pin_hash IS NOT NULL
              WHERE re.tipo = 'operario' AND re.activo
              ORDER BY re.nombre`),
      query(`SELECT d.id, d.nombre, d.tipo, d.creado, d.ultimo_uso, u.nombre AS persona, c.nombre AS creado_por
               FROM dispositivos d LEFT JOIN usuarios u ON u.id = d.usuario_id LEFT JOIN usuarios c ON c.id = d.creado_por
              WHERE d.activo ORDER BY d.tipo, d.nombre`),
    ]);
    const este = await dispositivoDe(req);
    res.json({ operarios, dispositivos, este_dispositivo: este?.id || null });
  }));

  // Poner o cambiar el PIN de un operario (crea su usuario «operario» si no lo tiene)
  app.put('/api/pin/:recursoId', admin, asyncH(async (req, res) => {
    const recursoId = Number(req.params.recursoId);
    const pin = String(req.body?.pin || '');
    if (!PIN_RE.test(pin)) throw fallo(400, 'El PIN son 4 cifras');
    if (PIN_FACILES.has(pin)) throw fallo(400, 'Ese PIN es demasiado fácil de adivinar: elige otro');
    const out = await tx(async (c) => {
      const { rows: re } = await c.query(`SELECT id, nombre FROM recursos WHERE id = $1 AND tipo = 'operario' AND activo`, [recursoId]);
      if (!re.length) throw fallo(404, 'Operario no encontrado');
      const { rows: ya } = await c.query('SELECT id FROM usuarios WHERE recurso_id = $1 AND pin_hash IS NOT NULL FOR UPDATE', [recursoId]);
      if (ya.length) {
        await c.query('UPDATE usuarios SET pin_hash = $2, activo = TRUE, nombre = $3 WHERE id = $1', [ya[0].id, hashPin(pin), re[0].nombre]);
        await c.query('DELETE FROM sesiones WHERE usuario_id = $1', [ya[0].id]);
        return { usuario_id: ya[0].id, nuevo: false };
      }
      const { rows } = await c.query(
        `INSERT INTO usuarios (email, nombre, password_hash, rol, recurso_id, pin_hash) VALUES (NULL, $1, '!', 'operario', $2, $3) RETURNING id`,
        [re[0].nombre, recursoId, hashPin(pin)]);
      return { usuario_id: rows[0].id, nuevo: true };
    });
    auth.anotarAcierto(`pin:u:${out.usuario_id}`);   // desbloquea si estaba bloqueado
    res.json({ ok: true, ...out });
  }));

  // Quitar el acceso con PIN (el usuario se desactiva; su historial se conserva)
  app.delete('/api/pin/:recursoId', admin, asyncH(async (req, res) => {
    const recursoId = Number(req.params.recursoId);
    await tx(async (c) => {
      const { rows } = await c.query('SELECT id FROM usuarios WHERE recurso_id = $1 AND pin_hash IS NOT NULL', [recursoId]);
      if (!rows.length) return;
      await c.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [rows[0].id]);
      await c.query('DELETE FROM sesiones WHERE usuario_id = $1', [rows[0].id]);
      await c.query('UPDATE dispositivos SET activo = FALSE WHERE usuario_id = $1', [rows[0].id]);
      await c.query('UPDATE altas_movil SET usado = now() WHERE usuario_id = $1 AND usado IS NULL', [rows[0].id]);
    });
    res.json({ ok: true });
  }));

  // Enlace de un solo uso para autorizar el móvil del operario
  app.post('/api/pin/:recursoId/enlace-movil', admin, asyncH(async (req, res) => {
    const recursoId = Number(req.params.recursoId);
    const { rows } = await query('SELECT id, nombre FROM usuarios WHERE recurso_id = $1 AND pin_hash IS NOT NULL AND activo', [recursoId]);
    if (!rows.length) throw fallo(400, 'Ponle primero un PIN');
    const token = crypto.randomBytes(24).toString('base64url');
    await query('UPDATE altas_movil SET usado = now() WHERE usuario_id = $1 AND usado IS NULL', [rows[0].id]);
    await query(`INSERT INTO altas_movil (token_hash, usuario_id, expira, creado_por) VALUES ($1,$2, now() + make_interval(hours => $3), $4)`,
      [sha(token), rows[0].id, ALTA_MOVIL_H, req.usuario.id]);
    const base = process.env.APP_URL ? process.env.APP_URL.replace(/\/+$/, '')
      : `${String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim()}://${req.get('host')}`;
    res.json({ url: `${base}/pin.html?alta=${token}`, caduca_h: ALTA_MOVIL_H, nombre: rows[0].nombre });
  }));

  // Registrar ESTE navegador como tablet común del taller
  app.post('/api/pin/dispositivos', admin, asyncH(async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim().slice(0, 60) || 'Tablet del taller';
    const ya = await dispositivoDe(req);
    if (ya) throw fallo(409, `Este navegador ya está registrado como «${ya.nombre}»`);
    const id = await nuevoDispositivo({ query }, res, { nombre, tipo: 'comun', por: req.usuario.id });
    res.status(201).json({ ok: true, id });
  }));

  app.delete('/api/pin/dispositivos/:id', admin, asyncH(async (req, res) => {
    await query('UPDATE dispositivos SET activo = FALSE WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));
}

module.exports = { publico, gestion };
