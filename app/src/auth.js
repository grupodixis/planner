const crypto = require('crypto');
const { query } = require('./db');

const COOKIE = 's360_sesion';
const DURACION_MS = 1000 * 60 * 60 * 12; // 12 h

// Permisos que puede tener un rol. Ver lo tiene cualquiera con cuenta.
const PERMISOS = {
  planificar: 'Planificar en el cuadrante y rellenar el parte del día (horas reales, faltas)',
  proyectos: 'Proyectos, partidas, OTs, tareas e importación',
  recursos: 'Recursos, áreas de trabajo, tipos y semillero',
  usuarios: 'Usuarios y roles',
  informes: 'Ver informes de horas y resultados',
  costes: 'Control de costes: importes, coste/hora, márgenes (también los € de Informes)',
  vacaciones_ops: 'Vacaciones: primer visto bueno (Operaciones)',
  vacaciones_rrhh: 'Vacaciones: aprobación final (RRHH)',
  escandallo: 'Definir el escandallo (materiales) de las partidas',
  logistica: 'Logística: revisar stock y recibir material',
  compras: 'Compras: pedir a proveedores lo que falta',
  aprobar_compras: 'Aprobar pedidos de compra por encima del límite',
  pedir_compras_locales: 'Pedir compras locales (ferretería…) desde el móvil',
  autorizar_compras_locales: 'Autorizar compras locales (ferretería…) que piden los operarios',
  autorizar_horas_extra: 'Autorizar horas extra (fuera del turno de cada persona)',
  mi_dia: 'Apuntar su propio día (Mi día). Solo, sin otros permisos: no ve nada más',
  ia: 'Usar la IA: asistente y conectar Claude Code / Antigravity (solo con sus propios permisos)',
  presupuestos: 'Presupuestos: prepararlos, pedir precio para presupuestar y recibir los avisos de las peticiones que llegan a presupuestos@',
};
// Permisos de un usuario «u»: los de su rol más los de sus roles añadidos (varios roles)
const SQL_PERMISOS = `ARRAY(SELECT DISTINCT p FROM roles rr, unnest(rr.permisos) p WHERE rr.clave = u.rol OR rr.clave = ANY(u.roles_extra))`;
// Quien solo tiene «mi_dia» únicamente ve su pantalla Mi día (ni cuadrante, ni costes, ni lo de otros)
const soloMiDia = (u) => !!u && (u.permisos || []).includes('mi_dia') && (u.permisos || []).every((k) => k === 'mi_dia');

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

async function crearSesion(res, usuarioId, { duracionMs = DURACION_MS, via = null } = {}) {
  const token = crypto.randomBytes(32).toString('hex');
  const expira = new Date(Date.now() + duracionMs);
  await query('INSERT INTO sesiones (token, usuario_id, expira, via) VALUES ($1,$2,$3,$4)', [token, usuarioId, expira, via]);
  await query('UPDATE usuarios SET ultimo_acceso = now() WHERE id = $1', [usuarioId]);
  await query('DELETE FROM sesiones WHERE expira < now()');
  const segura = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.round(duracionMs / 1000)}${segura}`);
  return token;
}

async function cerrarSesion(req, res) {
  const token = leerCookie(req, COOKIE);
  if (token) await query('DELETE FROM sesiones WHERE token = $1', [token]);
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

const tokenActual = (req) => leerCookie(req, COOKIE);

// Middleware: carga req.usuario (con sus permisos) o responde 401
// Llamadas internas de la pasarela de IA (src/ia.js): solo desde esta máquina, con el secreto del proceso y SOLO GET.
// Cargan el usuario en cuyo nombre actúa la IA, con sus permisos (nunca más).
const SECRETO_IA = crypto.randomBytes(32).toString('hex');
const LOCAL = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
async function sesionIA(req, res, next) {
  const dado = Buffer.from(String(req.headers['x-ia-clave'] || ''));
  const bueno = Buffer.from(SECRETO_IA);
  if (!LOCAL.has(req.socket.remoteAddress) || dado.length !== bueno.length || !crypto.timingSafeEqual(dado, bueno)) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  if (req.method !== 'GET') {
    // Solo para ejecutar un cambio que la persona ha confirmado en la tarjeta del asistente: mismo usuario, método y ruta
    const pid = Number(req.headers['x-ia-propuesta']);
    const { rows: [pr] } = pid ? await query(`SELECT usuario_id, metodo, ruta FROM ia_propuestas WHERE id = $1 AND estado = 'ejecutando'`, [pid]) : { rows: [] };
    if (!pr || pr.usuario_id !== Number(req.headers['x-ia-usuario']) || pr.metodo !== req.method || pr.ruta !== req.originalUrl) {
      return res.status(403).json({ error: 'La IA solo puede cambiar algo que hayas confirmado' });
    }
  }
  const { rows } = await query(
    `SELECT u.id, u.email, u.nombre, u.rol, u.recurso_id, r.nombre AS rol_nombre, u.roles_extra, ${SQL_PERMISOS} AS permisos, 'ia' AS via
       FROM usuarios u LEFT JOIN roles r ON r.clave = u.rol WHERE u.id = $1 AND u.activo`, [Number(req.headers['x-ia-usuario'])]);
  if (!rows.length) return res.status(401).json({ error: 'Usuario no válido' });
  req.usuario = rows[0];
  req.usuario.solo_mi_dia = soloMiDia(req.usuario);
  req.ia = true;
  return next();
}

async function requiereSesion(req, res, next) {
  try {
    if (req.headers['x-ia-clave']) return await sesionIA(req, res, next);
    const token = leerCookie(req, COOKIE);
    if (!token) return res.status(401).json({ error: 'No autenticado' });
    const { rows } = await query(
      `SELECT u.id, u.email, u.nombre, u.rol, u.recurso_id, r.nombre AS rol_nombre, u.roles_extra, ${SQL_PERMISOS} AS permisos, s.via
         FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id LEFT JOIN roles r ON r.clave = u.rol
        WHERE s.token = $1 AND s.expira > now() AND u.activo`, [token]);
    if (!rows.length) return res.status(401).json({ error: 'Sesión caducada' });
    req.usuario = rows[0];
    // quien entra con PIN siempre puede apuntar su día (Mi día), tenga el rol que tenga
    if (String(rows[0].via || '').startsWith('pin') && !req.usuario.permisos.includes('mi_dia')) req.usuario.permisos = [...req.usuario.permisos, 'mi_dia'];
    req.usuario.solo_mi_dia = soloMiDia(req.usuario);
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
  PERMISOS, SQL_PERMISOS, soloMiDia, leerCookie, hashPassword, verificarPassword, validarPassword, crearSesion, cerrarSesion, tokenActual,
  SECRETO_IA, requiereSesion, permiso, tiene, puedeEditar, asegurarAdmin, bloqueado, anotarFallo, anotarAcierto,
};
