const crypto = require('crypto');
const { query } = require('./db');

const COOKIE = 's360_sesion';
const DURACION_MS = 1000 * 60 * 60 * 12; // 12 h

// Permisos que puede tener un rol. Ver lo tiene cualquiera con cuenta.
const PERMISOS = {
  planificar: 'Planificar en el tablero (tramos, asignaciones, estado de las tareas)',
  proyectos: 'Proyectos, partidas, OTs, tareas e importación',
  recursos: 'Recursos, áreas de trabajo, tipos y semillero',
  usuarios: 'Usuarios y roles',
};

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

// Contraseña aceptable: 8+ caracteres y no solo letras o solo números
function validarPassword(p) {
  const s = String(p || '');
  if (s.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (s.length > 200) return 'La contraseña es demasiado larga';
  if (/^[a-záéíóúñü]+$/i.test(s) || /^\d+$/.test(s)) return 'Mezcla letras con números o símbolos';
  return null;
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
  await query('UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1', [usuarioId]);
  await query('DELETE FROM sesiones WHERE expira < now()');
  const segura = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${DURACION_MS / 1000}${segura}`);
  return token;
}

async function cerrarSesion(req, res) {
  const token = leerCookie(req, COOKIE);
  if (token) await query('DELETE FROM sesiones WHERE token = $1', [token]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

const tokenActual = (req) => leerCookie(req, COOKIE);

// Middleware: carga req.usuario (con sus permisos) o responde 401
async function requiereSesion(req, res, next) {
  try {
    const token = leerCookie(req, COOKIE);
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    const { rows } = await query(
      `SELECT u.id, u.email, u.nombre, u.rol, u.recurso_id, r.nombre AS rol_nombre, COALESCE(r.permisos, '{}') AS permisos
         FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id LEFT JOIN roles r ON r.clave = u.rol
        WHERE s.token = $1 AND s.expira > now() AND u.activo`, [token]);
    if (!rows.length) return res.status(401).json({ error: 'Sesión caducada' });
    req.usuario = rows[0];
    next();
  } catch (e) { next(e); }
}

const tiene = (usuario, clave) => !!usuario && (usuario.permisos || []).includes(clave);

// Middleware: exige alguno de los permisos indicados
function permiso(...claves) {
  return (req, res, next) => {
    if (claves.some((k) => tiene(req.usuario, k))) return next();
    res.status(403).json({ error: 'Tu usuario no tiene permiso para esto' });
  };
}

// Compatibilidad: «puede editar algo»
function puedeEditar(req, res, next) {
  if (req.usuario && (req.usuario.permisos || []).length) return next();
  res.status(403).json({ error: 'Tu usuario es de solo consulta' });
}

/* ---------- Bloqueo tras intentos fallidos (en memoria) ---------- */
const INTENTOS = new Map();          // clave → { fallos, hasta }
const MAX_FALLOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
function bloqueado(...claves) {
  const ahora = Date.now();
  for (const k of claves) {
    const x = INTENTOS.get(k);
    if (x?.hasta && x.hasta > ahora) return Math.ceil((x.hasta - ahora) / 60000);
  }
  return 0;
}
function anotarFallo(...claves) {
  for (const k of claves) {
    const x = INTENTOS.get(k) || { fallos: 0, hasta: 0 };
    x.fallos++;
    if (x.fallos >= (k.startsWith('ip:') ? MAX_FALLOS * 4 : MAX_FALLOS)) { x.hasta = Date.now() + BLOQUEO_MS; x.fallos = 0; }
    INTENTOS.set(k, x);
  }
  if (INTENTOS.size > 5000) INTENTOS.clear();
}
const anotarAcierto = (...claves) => claves.forEach((k) => INTENTOS.delete(k));

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
  PERMISOS, hashPassword, verificarPassword, validarPassword, crearSesion, cerrarSesion, tokenActual,
  requiereSesion, permiso, tiene, puedeEditar, asegurarAdmin, bloqueado, anotarFallo, anotarAcierto,
};
