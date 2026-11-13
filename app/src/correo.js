// Envío de correo opcional. Si no hay SMTP_HOST en el entorno, no se envía nada
// y los enlaces se reparten a mano desde la pantalla Usuarios.
let transporte = null;

function configurado() { return !!process.env.SMTP_HOST; }

function crear() {
  if (transporte || !configurado()) return transporte;
  const nodemailer = require('nodemailer');
  const puerto = Number(process.env.SMTP_PORT || 587);
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: puerto,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : puerto === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined,
  });
  return transporte;
}

// Devuelve true si se envió; nunca lanza (el fallo se registra y se informa al llamante)
async function enviar({ para, asunto, texto }) {
  const t = crear();
  if (!t) return false;
  try {
    await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: para, subject: asunto, text: texto,
    });
    return true;
  } catch (e) {
    console.error('No se pudo enviar el correo:', e.message);
    return false;
  }
}

module.exports = { configurado, enviar };
