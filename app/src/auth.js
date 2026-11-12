const crypto = require('crypto');
const { query } = require('./db');

const COOKIE = 's360_sesion';
const DURACION_MS = 1000 * 60 * 60 * 12; // 12 h

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verificarPassword(password, almacenado) {
  const [alg, salt, hash] = String(almacenado).split(':');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const calc = crypto.scryptSync(password, salt, 64);
  const esperado = Buffer.from(hash, 'hex');
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

function leerCookie(req, nombre) {
  const raw = req.headers.cookie || '';
  for (const parte of raw.split(';')) {
    const [k, ...v] = parte.trim().split('=');
    if (k === nombre) return decodeURIComponent(v.join('='));
  }
  return null;
}

async function crearSesion(res, usuarioId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + DURACION_MS);
  await query('INSERT INTO sesiones (token, usuario_id, expira) VALUES ($1,$2,$3)', [token, usuarioId, expira]);
  const segura = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${DURACION_MS / 1000}${segura}`);
}

async function cerrarSesion(req, res) {
  const token = leerCookie(req, COOKIE);
  if (token) await query('DELETE FROM sesiones WHERE token = $1', [token]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// Middleware: carga req.usuario o responde 401
async function requiereSesion(req, res, next) {
  try {
    const token = leerCookie(req, COOKIE);
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    const { rows } = await query(
      `SELECT u.id, u.email, u.nombre, u.rol
         FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
        WHERE s.token = $1 AND s.expira > now() AND u.activo`, [token]);
    if (!rows.length) return res.status(401).json({ error: 'Sesión caducada' });
    req.usuario = rows[0];
    next();
  } catch (e) { next(e); }
}

// Solo admin / planificador pueden modificar
function puedeEditar(req, res, next) {
  if (req.usuario && ['admin', 'planificador'].includes(req.usuario.rol)) return next();
  res.status(403).json({ error: 'Tu usuario es de solo consulta' });
}

// Crea el administrador inicial si no hay usuarios
async function asegurarAdmin() {
  const { rows } = await query('SELECT count(*)::int AS n FROM usuarios');
  if (rows[0].n > 0) return;
  const email = process.env.ADMIN_EMAIL || 'admin@s360.local';
  const pass = process.env.ADMIN_PASSWORD || 'cambiame';
  await query(
    `INSERT INTO usuarios (email, nombre, password_hash, rol) VALUES ($1, 'Administrador', $2, 'admin')`,
    [email.toLowerCase(), hashPassword(pass)]);
  console.log(`Usuario administrador creado: ${email}`);
}

module.exports = {
  hashPassword, verificarPassword, crearSesion, cerrarSesion,
  requiereSesion, puedeEditar, asegurarAdmin,
};
