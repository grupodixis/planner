// Correo de salida (pedidos a proveedores, peticiones de precio, enlaces de alta…).
//  · Se configura en Compras › Ajustes › Correo de salida (permiso «usuarios»). Se guarda en «ajustes»
//    con la contraseña CIFRADA (AES-256-GCM); la clave de cifrado vive fuera de la base de datos
//    (CORREO_CLAVE en el entorno o un archivo en el volumen de archivos), así una copia de la base de
//    datos sola no revela la contraseña. La contraseña nunca se devuelve al navegador.
//  · Si no hay nada en el panel, vale lo del entorno (SMTP_HOST…); si tampoco, no se envía nada.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let cfgPanel = null;   // { host, port, secure, user, from, pass }
let transporte = null;

function claveCifrado() {
  if (process.env.CORREO_CLAVE) return crypto.createHash('sha256').update(process.env.CORREO_CLAVE).digest();
  const dir = process.env.ARCHIVOS_DIR || path.join(__dirname, '..', 'datos-archivos');
  const f = path.join(dir, '.clave-correo');
  try { return Buffer.from(fs.readFileSync(f, 'utf8').trim(), 'hex'); } catch { /* se crea */ }
  const k = crypto.randomBytes(32);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(f, k.toString('hex'), { mode: 0o600 });
  return k;
}
function cifrar(texto) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', claveCifrado(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), datos].map((b) => b.toString('base64')).join('.');
}
function descifrar(s) {
  const [iv, tag, datos] = String(s).split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', claveCifrado(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString('utf8');
}

function efectiva() {
  if (cfgPanel?.host) return cfgPanel;
  if (!process.env.SMTP_HOST) return null;
  const port = Number(process.env.SMTP_PORT || 587);
  return {
    host: process.env.SMTP_HOST, port, secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    user: process.env.SMTP_USER || '', pass: process.env.SMTP_PASS || '', from: process.env.SMTP_FROM || process.env.SMTP_USER || '', origen: 'servidor',
  };
}
function configurado() { return !!efectiva(); }
const remitente = () => { const c = efectiva(); return c ? c.from || c.user || null : null; };

function transportePara(c) {
  const nodemailer = require('nodemailer');
  return nodemailer.createTransport({
    host: c.host, port: c.port, secure: !!c.secure,
    auth: c.user ? { user: c.user, pass: c.pass || '' } : undefined,
    connectionTimeout: 15000, greetingTimeout: 15000,
  });
}
function crear() {
  const c = efectiva();
  if (!c) return null;
  if (!transporte) transporte = transportePara(c);
  return transporte;
}

// Lee la configuración del panel (al arrancar y al guardarla)
async function cargar() {
  const { query } = require('./db');
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'correo'`);
  const v = rows[0]?.valor;
  transporte = null;
  if (!v?.host) { cfgPanel = null; return; }
  let pass = '';
  try { pass = v.pass_cifrada ? descifrar(v.pass_cifrada) : ''; } catch { console.error('Correo: no se pudo descifrar la contraseña guardada (¿cambió la clave?)'); }
  cfgPanel = { host: v.host, port: Number(v.port) || 587, secure: !!v.secure, user: v.user || '', from: v.from || v.user || '', pass, origen: 'panel' };
}

// Para el panel: nunca la contraseña
async function verAjustes() {
  const { query } = require('./db');
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'correo'`);
  let v = rows[0]?.valor || {};
  const e = efectiva();
  // Lo puesto en el servidor (configurar-correo.sh) se enseña tal cual, sin la contraseña
  if (!v.host && e?.origen === 'servidor') v = { host: e.host, port: e.port, secure: e.secure, user: e.user, from: e.from, pass_cifrada: e.pass ? 'servidor' : null };
  return {
    host: v.host || '', port: v.port || 587, secure: !!v.secure, user: v.user || '', from: v.from || '',
    tiene_clave: !!v.pass_cifrada, origen: e ? (e.origen || 'panel') : null, configurado: !!e,
  };
}

// Guardar desde el panel. pass: solo si se escribe una nueva ('' = se mantiene; null en «borrar» = se quita)
async function guardarAjustes(b, usuarioId) {
  const { query } = require('./db');
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'correo'`);
  const act = rows[0]?.valor || {};
  const txt = (x, m = 200) => (x == null ? '' : String(x).trim().slice(0, m));
  const port = Number(b.port) || 587;
  if (port < 1 || port > 65535) throw Object.assign(new Error('Puerto no válido'), { status: 400 });
  const v = {
    host: txt(b.host), port, secure: !!b.secure, user: txt(b.user), from: txt(b.from, 300),
    pass_cifrada: b.borrar_clave ? null : b.pass ? cifrar(String(b.pass)) : act.pass_cifrada
      // si venía del servidor y es la misma cuenta, se conserva su contraseña
      || (process.env.SMTP_PASS && txt(b.user) === (process.env.SMTP_USER || '') ? cifrar(process.env.SMTP_PASS) : null),
    cambiado_por: usuarioId, cambiado_en: new Date().toISOString(),
  };
  await query(`INSERT INTO ajustes (clave, valor) VALUES ('correo', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(v)]);
  await cargar();
  return verAjustes();
}

// Comprobar la conexión y, si se pide, mandar un correo de prueba
async function probar(para) {
  const c = efectiva();
  if (!c) throw Object.assign(new Error('No hay correo de salida configurado'), { status: 400 });
  const t = transportePara(c);
  try {
    await t.verify();
    if (para) await t.sendMail({ from: c.from || c.user, to: para, subject: 'Prueba de correo · s360', text: 'Este es un correo de prueba enviado desde s360. Si lo recibes, el correo de salida funciona.' });
  } catch (e) {
    throw Object.assign(new Error(`No conecta con ${c.host}: ${e.message}`), { status: 502 });
  }
  return { ok: true, enviado_a: para || null };
}

// Devuelve true si se envió; nunca lanza (el fallo se registra y se informa al llamante)
async function enviar({ para, asunto, texto }) {
  const t = crear();
  if (!t) return false;
  try {
    await t.sendMail({ from: remitente(), to: para, subject: asunto, text: texto });
    return true;
  } catch (e) {
    console.error('No se pudo enviar el correo:', e.message);
    return false;
  }
}

// Para lo que no puede fallar en silencio (pedidos a proveedores): lanza con el motivo
async function enviarOFallar({ para, cc, asunto, texto, adjuntos }) {
  const t = crear();
  if (!t) throw Object.assign(new Error('El correo de salida no está configurado (Compras › Ajustes)'), { status: 400 });
  try {
    return await t.sendMail({
      from: remitente(), to: para, cc: cc || undefined, subject: asunto, text: texto,
      attachments: (adjuntos || []).map((a) => ({ filename: a.nombre, content: a.datos, contentType: a.tipo })),
    });
  } catch (e) {
    throw Object.assign(new Error(`No se pudo enviar el correo: ${e.message}`), { status: 502 });
  }
}

module.exports = { configurado, enviar, enviarOFallar, remitente, cargar, verAjustes, guardarAjustes, probar };
