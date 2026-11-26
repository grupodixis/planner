// Correo entrante: buzones IMAP conectados a Planéalo (Compras › Correo entrante › Buzones).
//
//  · Por EVENTOS: cada buzón activo tiene una conexión abierta en la carpeta de entrada (IMAP IDLE): en cuanto entra un
//    correo el servidor avisa, se descarga y se manda a la IA (src/correo-ia.js). Si la conexión se cae, se reconecta
//    (10 s → 5 min) y recupera lo que entró mientras tanto (por UID). Además, cada 5 min una comprobación de seguridad.
//  · Al conectar un buzón por primera vez solo se procesa lo que entra a partir de entonces; «Recuperar» analiza los
//    últimos N días a petición.
//  · Cada correo se guarda en disco tal cual (.eml) con sus adjuntos, ordenado por buzón › tipo › año
//    (ARCHIVOS_DIR/correo/…), y en el buzón se mueve a «Planéalo/<tipo>» (Ofertas, Confirmaciones de pedido, Albaranes…)
//    según la regla del buzón: «auto» (lo que hay que revisar, al revisarlo; lo demás, al clasificarlo), «al_revisar» o
//    «nunca». Así la bandeja de entrada del programa de correo queda como «lo pendiente».
//  · La contraseña se guarda cifrada (como la del correo de salida) y nunca vuelve al navegador.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const { query } = require('./db');
const correo = require('./correo');
const { cifrar, descifrar } = correo;

const DIR = process.env.ARCHIVOS_DIR || path.join(__dirname, '..', 'datos-archivos');
const MAX_CORREO = 30 * 1024 * 1024;
const CARPETAS = {
  oferta: 'Ofertas', confirmacion_pedido: 'Confirmaciones de pedido', albaran: 'Albaranes', factura: 'Facturas',
  pedido_cliente: 'Pedidos de clientes', consulta: 'Consultas', publicidad: 'Publicidad', otro: 'Otros',
};
const fallo = (s, m) => Object.assign(new Error(m), { status: s });
const slug = (t, n = 40) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, n) || 'x';

/* ---------- almacenamiento en disco ---------- */
function rutaCorreo(b, c, tipo) {
  const f = new Date(c.fecha || c.creado || Date.now());
  const dia = f.toISOString().slice(0, 10);
  const base = `${b.id}-${slug(b.direccion, 50)}`;
  return tipo
    ? path.posix.join('correo', base, slug(CARPETAS[tipo] || 'Otros'), dia.slice(0, 4), `${dia}_${c.id}_${slug(c.asunto, 50)}`)
    : path.posix.join('correo', base, '_entrada', String(c.id));
}
const absoluta = (rel) => {
  const a = path.resolve(DIR, rel);
  if (!a.startsWith(path.resolve(DIR) + path.sep)) throw fallo(400, 'Ruta no válida');
  return a;
};
// Cuando ya se sabe qué es, el correo pasa a su carpeta de tipo (y sus adjuntos con él)
async function moverEnDisco(correoId, tipo) {
  const { rows: [c] } = await query('SELECT c.*, b.direccion FROM correos c JOIN buzones b ON b.id = c.buzon_id WHERE c.id = $1', [correoId]);
  if (!c?.ruta) return;
  const nueva = rutaCorreo({ id: c.buzon_id, direccion: c.direccion }, c, tipo);
  if (nueva === c.ruta) return;
  try {
    fs.mkdirSync(path.dirname(absoluta(nueva)), { recursive: true });
    fs.renameSync(absoluta(c.ruta), absoluta(nueva));
  } catch (e) { console.error('Correo: no se pudo mover en disco', e.message); return; }
  await query('UPDATE correos SET ruta = $2 WHERE id = $1', [correoId, nueva]);
  await query(`UPDATE correo_adjuntos SET ruta = $2 || substr(ruta, length($3) + 1) WHERE correo_id = $1 AND ruta LIKE $3 || '/%'`, [correoId, nueva, c.ruta]);
}

/* ---------- guardar un correo recibido ---------- */
async function guardar(b, uid, source) {
  if (source.length > MAX_CORREO) console.warn(`Correo de ${Math.round(source.length / 1e6)} MB en ${b.direccion}: se guarda sin adjuntos grandes`);
  const m = await simpleParser(source, { skipHtmlToText: false });
  const mid = (m.messageId || `<sin-id-${crypto.createHash('sha256').update(source).digest('hex').slice(0, 32)}@planealo>`).slice(0, 500);
  const de = m.from?.value?.[0] || {};
  const refs = [].concat(m.references || []).map(String).slice(0, 50);
  const texto = (m.text || (m.html ? String(m.html).replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ') : '') || '').replace(/\n{3,}/g, '\n\n').slice(0, 60000);
  const { rows } = await query(
    `INSERT INTO correos (buzon_id, uid, message_id, en_respuesta_a, referencias, de_email, de_nombre, para, asunto, fecha, texto, bytes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (buzon_id, message_id) DO NOTHING RETURNING *`,
    [b.id, uid, mid, m.inReplyTo ? String(m.inReplyTo).slice(0, 500) : null, refs, (de.address || '').toLowerCase().slice(0, 200) || null,
      (de.name || '').slice(0, 200) || null, (m.to?.text || '').slice(0, 1000), (m.subject || '(sin asunto)').slice(0, 500), m.date || new Date(), texto, source.length]);
  if (!rows.length) {   // ya estaba (p. ej. se volvió a mover a la entrada): solo se actualiza su UID
    await query('UPDATE correos SET uid = $3 WHERE buzon_id = $1 AND message_id = $2', [b.id, mid, uid]);
    return null;
  }
  const c = rows[0];
  const rel = rutaCorreo(b, c);
  fs.mkdirSync(absoluta(rel), { recursive: true });
  fs.writeFileSync(path.join(absoluta(rel), 'mensaje.eml'), source);
  const usados = new Set();
  for (const a of (m.attachments || [])) {
    if (a.related && /^image\//.test(a.contentType) && (a.size || 0) < 40000) continue;   // logotipos de la firma
    let nombre = slug(a.filename || `adjunto.${(a.contentType || 'bin').split('/')[1] || 'bin'}`, 90);
    while (usados.has(nombre)) nombre = `1-${nombre}`;
    usados.add(nombre);
    fs.writeFileSync(path.join(absoluta(rel), nombre), a.content);
    await query('INSERT INTO correo_adjuntos (correo_id, nombre, tipo, bytes, ruta, sha256) VALUES ($1,$2,$3,$4,$5,$6)',
      [c.id, a.filename || nombre, (a.contentType || 'application/octet-stream').toLowerCase(), a.size || a.content.length, `${rel}/${nombre}`,
        crypto.createHash('sha256').update(a.content).digest('hex')]);
  }
  await query('UPDATE correos SET ruta = $2 WHERE id = $1', [c.id, rel]);
  await query('UPDATE buzones SET ultimo_correo = now() WHERE id = $1', [b.id]);
  return c.id;
}

/* ---------- conexiones (una por buzón activo) ---------- */
const conexiones = new Map();   // buzon_id → Conexion

function cliente(b) {
  return new ImapFlow({
    host: b.host, port: b.puerto, secure: b.tls, auth: { user: b.usuario, pass: descifrar(b.clave) },
    logger: false, emitLogs: false, connectionTimeout: 20000, greetingTimeout: 15000, socketTimeout: 10 * 60 * 1000,
    tls: { rejectUnauthorized: !process.env.IMAP_INSEGURO },   // IMAP_INSEGURO: solo para el servidor de pruebas local
  });
}

class Conexion {
  constructor(b) { this.b = b; this.parado = false; this.espera = 10000; this.ocupado = Promise.resolve(); this.carpetas = new Set(); }

  async estado(e, error = null) {
    this.b.estado = e;
    await query('UPDATE buzones SET estado = $2, ultimo_error = $3, conectado_en = CASE WHEN $2 = \'escuchando\' THEN now() ELSE conectado_en END WHERE id = $1',
      [this.b.id, e, error]).catch(() => {});
  }

  async arrancar() {
    if (this.parado) return;
    clearTimeout(this.reintento);
    try {
      this.c = cliente(this.b);
      this.c.on('error', (e) => console.error(`Buzón ${this.b.direccion}:`, e.message));
      this.c.on('close', () => { if (!this.parado) this.reconectar('Se cerró la conexión'); });
      this.c.on('exists', () => this.colaSilenciosa(() => this.traer()));
      await this.c.connect();
      const caja = await this.c.mailboxOpen(this.b.carpeta_entrada);
      this.delim = caja.delimiter || '/';
      // primera vez (o la carpeta cambió por completo): solo lo que entre desde ahora
      // (o el servidor volvió a numerar sin avisar: el siguiente UID es menor que el último visto)
      if (this.b.ultimo_uid == null || String(caja.uidValidity) !== String(this.b.uid_validez) || Number(caja.uidNext || 0) <= Number(this.b.ultimo_uid)) {
        this.b.ultimo_uid = Math.max(0, Number(caja.uidNext || 1) - 1);
        this.b.uid_validez = String(caja.uidValidity);
        await query('UPDATE buzones SET ultimo_uid = $2, uid_validez = $3 WHERE id = $1', [this.b.id, this.b.ultimo_uid, this.b.uid_validez]);
      }
      this.espera = 10000;
      await this.estado('escuchando');
      await this.cola(() => this.traer()).catch(() => {});   // lo que entró mientras no estábamos
      clearInterval(this.latido);
      this.latido = setInterval(() => this.colaSilenciosa(() => this.traer()), 5 * 60 * 1000);
    } catch (e) {
      this.reconectar(e.authenticationFailed || /auth|login|credential/i.test(e.message) ? 'Usuario o contraseña incorrectos' : (e.responseText || e.message));
    }
  }

  reconectar(motivo) {
    clearInterval(this.latido);
    try { this.c?.removeAllListeners('close'); this.c?.close(); } catch { /* ya cerrada */ }
    if (this.parado) return;
    this.estado('error', motivo);
    clearTimeout(this.reintento);
    this.reintento = setTimeout(() => this.arrancar(), this.espera);
    this.espera = Math.min(this.espera * 2, 5 * 60 * 1000);
  }

  parar() {
    this.parado = true;
    clearInterval(this.latido); clearTimeout(this.reintento);
    try { this.c?.removeAllListeners('close'); this.c?.logout().catch(() => {}); } catch { /* nada */ }
  }

  // Las operaciones sobre el buzón, de una en una
  cola(fn) {
    const p = this.ocupado.then(fn);
    this.ocupado = p.catch((e) => console.error(`Buzón ${this.b.direccion}:`, e.message));
    return p;
  }
  colaSilenciosa(fn) { this.cola(fn).catch(() => {}); }

  async traer(uids = null) {
    if (!this.c?.usable) return 0;
    const nuevos = [];
    const lock = await this.c.getMailboxLock(this.b.carpeta_entrada);
    try {
      const rango = uids ? uids.join(',') : `${Number(this.b.ultimo_uid) + 1}:*`;
      for await (const msg of this.c.fetch(rango, { uid: true, source: true }, { uid: true })) {
        if (!uids && msg.uid <= Number(this.b.ultimo_uid)) continue;   // «N:*» devuelve el último aunque sea viejo
        try {
          const id = await guardar(this.b, msg.uid, msg.source);
          if (id) nuevos.push(id);
        } catch (e) { console.error(`Correo ${msg.uid} de ${this.b.direccion}:`, e.message); }
        if (!uids && msg.uid > Number(this.b.ultimo_uid)) {
          this.b.ultimo_uid = msg.uid;
          await query('UPDATE buzones SET ultimo_uid = $2 WHERE id = $1', [this.b.id, msg.uid]);
        }
      }
    } finally { lock.release(); }
    for (const id of nuevos) require('./correo-ia').encolar(id);
    return nuevos.length;
  }

  async recuperar(dias) {
    if (!this.c?.usable) throw fallo(409, 'El buzón no está conectado');
    const lock = await this.c.getMailboxLock(this.b.carpeta_entrada);
    let uids;
    try { uids = await this.c.search({ since: new Date(Date.now() - dias * 86400000) }, { uid: true }); } finally { lock.release(); }
    if (!uids?.length) return 0;
    return this.traer(uids.slice(-200));
  }

  // Mover el correo a «Planéalo/<tipo>» del buzón
  async archivar(uid, tipo) {
    if (!this.c?.usable) throw fallo(409, 'El buzón no está conectado ahora mismo');
    const destino = [this.b.carpeta_raiz, CARPETAS[tipo] || 'Otros'].join(this.delim);
    if (!this.carpetas.has(destino)) {
      try { await this.c.mailboxCreate([this.b.carpeta_raiz, CARPETAS[tipo] || 'Otros']); } catch (e) { if (!/exist/i.test(`${e.responseText || ''} ${e.message}`) && e.serverResponseCode !== 'ALREADYEXISTS') console.warn('Crear carpeta:', e.responseText || e.message); }
      this.carpetas.add(destino);
    }
    const lock = await this.c.getMailboxLock(this.b.carpeta_entrada);
    try {
      const r = await this.c.messageMove(String(uid), destino, { uid: true });
      return { destino, movido: !!r };
    } finally { lock.release(); }
  }
}

async function arrancarBuzon(id) {
  conexiones.get(id)?.parar();
  conexiones.delete(id);
  const { rows: [b] } = await query('SELECT * FROM buzones WHERE id = $1', [id]);
  if (!b || !b.activo || !b.entrada || !b.clave) { if (b) await query(`UPDATE buzones SET estado = $2, ultimo_error = NULL WHERE id = $1`, [id, !b.activo || !b.entrada ? 'parado' : 'sin_clave']); return; }
  const cx = new Conexion(b);
  conexiones.set(id, cx);
  cx.arrancar();
}

async function arrancarTodos() {
  if (process.env.CORREO_ENTRANTE === 'no') return;
  const { rows } = await query('SELECT id FROM buzones WHERE activo AND entrada');
  for (const r of rows) await arrancarBuzon(r.id).catch((e) => console.error('Buzón', r.id, e.message));
}

// Archivar en el buzón (y en disco) según su regla. forzar: lo pide alguien desde la pantalla
async function archivar(correoId, { forzar = false, revisado = false } = {}) {
  const { rows: [c] } = await query('SELECT c.*, b.archivar AS regla FROM correos c JOIN buzones b ON b.id = c.buzon_id WHERE c.id = $1', [correoId]);
  if (!c || c.archivado_en || !c.tipo) return;
  const accionable = ['oferta', 'confirmacion_pedido'].includes(c.tipo) && !['descartado', 'hecho'].includes(c.estado);
  const toca = forzar || (c.regla === 'auto' && (revisado || !accionable)) || (c.regla === 'al_revisar' && revisado);
  if (!toca || c.regla === 'nunca' && !forzar) return;
  const cx = conexiones.get(c.buzon_id);
  try {
    if (!cx) throw fallo(409, 'El buzón no está conectado');
    if (!c.uid) throw fallo(409, 'No se sabe dónde está en el buzón');
    const r = await cx.cola(() => cx.archivar(c.uid, c.tipo));
    await query('UPDATE correos SET carpeta = $2, archivado_en = now(), archivo_error = NULL, uid = NULL WHERE id = $1', [c.id, r?.movido === false ? null : r?.destino]);
  } catch (e) {
    await query('UPDATE correos SET archivo_error = $2 WHERE id = $1', [c.id, e.message]);
  }
}

async function hacerPrincipal(id) {
  await query('UPDATE buzones SET principal = false WHERE principal AND id <> $1', [id]);
  await query('UPDATE buzones SET principal = true WHERE id = $1', [id]);
}

// Una vez: el «Correo de salida» de Compras › Ajustes (o el del servidor, .env) pasa a ser una cuenta de correo (la principal).
// Si ya hay una cuenta con esa dirección, se le añade la salida. La contraseña se copia cifrada; nadie tiene que volver a escribirla.
async function migrarSalida() {
  const { rows: [m] } = await query(`SELECT 1 FROM ajustes WHERE clave = 'migr_correo_salida'`);
  if (m) return;
  const { rows: [a] } = await query(`SELECT valor FROM ajustes WHERE clave = 'correo'`);
  let v = a?.valor?.host ? a.valor : null;
  if (!v && process.env.SMTP_HOST) {
    v = { host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587), secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : Number(process.env.SMTP_PORT) === 465,
      user: process.env.SMTP_USER || '', from: process.env.SMTP_FROM || '', pass_cifrada: process.env.SMTP_PASS ? cifrar(process.env.SMTP_PASS) : null };
  }
  if (v?.host) {
    const dir = (String(v.from || '').match(/<([^>]+)>/)?.[1] || v.from || v.user || '').trim().toLowerCase();
    const seg = v.secure ? 'ssl' : 'starttls';
    const { rows: [b] } = await query('SELECT * FROM buzones WHERE lower(direccion) = $1 OR lower(usuario) = $2 ORDER BY id LIMIT 1', [dir, String(v.user || '').toLowerCase()]);
    let id;
    if (b) {
      let misma = false;
      try { misma = !!(b.clave && v.pass_cifrada && descifrar(b.clave) === descifrar(v.pass_cifrada)); } catch { /* no */ }
      await query(`UPDATE buzones SET smtp_host = $2, smtp_puerto = $3, smtp_seguridad = $4, smtp_usuario = $5, remitente = $6, clave_smtp = $7,
                          clave = COALESCE(clave, $8) WHERE id = $1`,
        [b.id, v.host, v.port || 587, seg, v.user || null, v.from || null, misma || !v.pass_cifrada ? null : v.pass_cifrada, v.pass_cifrada]);
      id = b.id;
    } else if (dir) {
      const imap = String(v.host).replace(/^smtp\./i, 'imap.');
      const nombre = dir.split('@')[0].replace(/^./, (x) => x.toUpperCase());
      const { rows: [n] } = await query(
        `INSERT INTO buzones (nombre, direccion, host, puerto, tls, usuario, clave, entrada, smtp_host, smtp_puerto, smtp_seguridad, smtp_usuario, remitente)
         VALUES ($1,$2,$3,993,true,$4,$5,false,$6,$7,$8,$4,$9) RETURNING id`,
        [nombre, dir, imap, v.user || dir, v.pass_cifrada, v.host, v.port || 587, seg, v.from || null]);
      id = n.id;
    }
    if (id) await hacerPrincipal(id);
  }
  await query(`INSERT INTO ajustes (clave, valor) VALUES ('migr_correo_salida', $1) ON CONFLICT (clave) DO NOTHING`, [JSON.stringify({ en: new Date().toISOString() })]);
}

/* ---------- API ---------- */
function vistaBuzon(b) {
  const cx = conexiones.get(b.id);
  return {
    id: b.id, nombre: b.nombre, direccion: b.direccion, host: b.host, puerto: b.puerto, tls: b.tls, usuario: b.usuario,
    clave_guardada: !!b.clave, carpeta_entrada: b.carpeta_entrada, carpeta_raiz: b.carpeta_raiz, archivar: b.archivar, tipo: b.tipo,
    activo: b.activo, estado: cx?.b.estado || b.estado, ultimo_error: b.ultimo_error, conectado_en: b.conectado_en, ultimo_correo: b.ultimo_correo,
    entrada: b.entrada, salida: !!b.smtp_host, smtp_host: b.smtp_host, smtp_puerto: b.smtp_puerto, smtp_seguridad: b.smtp_seguridad,
    smtp_usuario: b.smtp_usuario, clave_smtp_propia: !!b.clave_smtp, remitente: b.remitente, principal: b.principal,
  };
}
const texto = (v, n) => (v == null ? null : String(v).trim().slice(0, n) || null);

async function probar(datos) {
  const c = new ImapFlow({ host: datos.host, port: datos.puerto, secure: datos.tls, auth: { user: datos.usuario, pass: datos.clave },
    logger: false, emitLogs: false, connectionTimeout: 15000, greetingTimeout: 10000, tls: { rejectUnauthorized: !process.env.IMAP_INSEGURO } });
  try {
    await c.connect();
    const caja = await c.mailboxOpen(datos.carpeta_entrada || 'INBOX', { readOnly: true });
    const idle = c.capabilities?.has?.('IDLE');
    await c.logout();
    return { ok: true, msg: `Conecta · ${caja.exists} correos en ${datos.carpeta_entrada || 'INBOX'}${idle ? ' · avisos al momento (IDLE)' : ' · sin IDLE: se mirará cada 5 min'}` };
  } catch (e) {
    try { c.close(); } catch { /* nada */ }
    return { ok: false, msg: e.authenticationFailed ? 'Usuario o contraseña incorrectos' : `No conecta: ${e.responseText || e.message}` };
  }
}

function montar(app, asyncH, auth) {
  const admin = auth.permiso('usuarios');
  app.get('/api/buzones', auth.permiso('usuarios', 'compras'), asyncH(async (req, res) => {
    const { rows } = await query(`SELECT b.*, (SELECT count(*)::int FROM correos c WHERE c.buzon_id = b.id) AS n FROM buzones b WHERE b.tipo = 'empresa' ORDER BY b.id`);
    res.json(rows.map((b) => ({ ...vistaBuzon(b), n: b.n })));
  }));
  const datosDe = async (b, actual) => {
    const d = {
      nombre: texto(b.nombre, 80) ?? actual?.nombre, direccion: texto(b.direccion, 200)?.toLowerCase() ?? actual?.direccion,
      host: texto(b.host, 200) ?? actual?.host, puerto: b.puerto != null ? Number(b.puerto) : actual?.puerto ?? 993,
      tls: b.tls != null ? !!b.tls : actual?.tls ?? true, usuario: texto(b.usuario, 200) ?? actual?.usuario,
      carpeta_entrada: texto(b.carpeta_entrada, 200) ?? actual?.carpeta_entrada ?? 'INBOX', carpeta_raiz: texto(b.carpeta_raiz, 60) ?? actual?.carpeta_raiz ?? 'Planéalo',
      archivar: ['auto', 'al_revisar', 'nunca'].includes(b.archivar) ? b.archivar : actual?.archivar ?? 'auto',
      activo: b.activo != null ? !!b.activo : actual?.activo ?? true,
      entrada: b.entrada != null ? !!b.entrada : actual?.entrada ?? true,
      smtp_host: 'smtp_host' in b ? texto(b.smtp_host, 200) : actual?.smtp_host ?? null,
      smtp_puerto: b.smtp_puerto != null ? Number(b.smtp_puerto) : actual?.smtp_puerto ?? 587,
      smtp_seguridad: ['starttls', 'ssl', 'ninguna'].includes(b.smtp_seguridad) ? b.smtp_seguridad : actual?.smtp_seguridad ?? 'starttls',
      smtp_usuario: 'smtp_usuario' in b ? texto(b.smtp_usuario, 200) : actual?.smtp_usuario ?? null,
      remitente: 'remitente' in b ? texto(b.remitente, 300) : actual?.remitente ?? null,
    };
    if (d.smtp_host && (!Number.isInteger(d.smtp_puerto) || d.smtp_puerto < 1 || d.smtp_puerto > 65535)) throw fallo(400, 'Puerto de salida no válido');
    if (!d.nombre || !d.direccion || !d.host || !d.usuario) throw fallo(400, 'Faltan datos: nombre, dirección, servidor y usuario');
    if (!/@/.test(d.direccion)) throw fallo(400, 'La dirección no es un correo');
    if (!Number.isInteger(d.puerto) || d.puerto < 1 || d.puerto > 65535) throw fallo(400, 'Puerto no válido');
    if (/[\\]|\.\./.test(d.carpeta_raiz)) throw fallo(400, 'Nombre de carpeta no válido');
    return d;
  };
  app.post('/api/buzones', admin, asyncH(async (req, res) => {
    const d = await datosDe(req.body || {});
    const clave = req.body?.clave ? cifrar(String(req.body.clave)) : null;
    const { rows: [b] } = await query(
      `INSERT INTO buzones (nombre, direccion, host, puerto, tls, usuario, clave, carpeta_entrada, carpeta_raiz, archivar, activo, creado_por,
                            entrada, smtp_host, smtp_puerto, smtp_seguridad, smtp_usuario, clave_smtp, remitente)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [d.nombre, d.direccion, d.host, d.puerto, d.tls, d.usuario, clave, d.carpeta_entrada, d.carpeta_raiz, d.archivar, d.activo, req.usuario.id,
        d.entrada, d.smtp_host, d.smtp_puerto, d.smtp_seguridad, d.smtp_usuario, req.body?.clave_smtp ? cifrar(String(req.body.clave_smtp)) : null, d.remitente]);
    if (req.body?.principal && d.smtp_host) await hacerPrincipal(b.id);
    else if (d.smtp_host) await query(`UPDATE buzones SET principal = true WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM buzones WHERE principal)`, [b.id]);
    await correo.cargar();
    await arrancarBuzon(b.id);
    res.status(201).json(vistaBuzon(b));
  }));
  app.put('/api/buzones/:id', admin, asyncH(async (req, res) => {
    const { rows: [a] } = await query('SELECT * FROM buzones WHERE id = $1', [req.params.id]);
    if (!a) throw fallo(404, 'Buzón no encontrado');
    const d = await datosDe(req.body || {}, a);
    const clave = req.body?.clave ? cifrar(String(req.body.clave)) : a.clave;
    const cambiaCarpeta = d.carpeta_entrada !== a.carpeta_entrada || d.host !== a.host || d.usuario !== a.usuario;
    const { rows: [b] } = await query(
      `UPDATE buzones SET nombre=$2, direccion=$3, host=$4, puerto=$5, tls=$6, usuario=$7, clave=$8, carpeta_entrada=$9, carpeta_raiz=$10, archivar=$11, activo=$12,
              entrada=$13, smtp_host=$14, smtp_puerto=$15, smtp_seguridad=$16, smtp_usuario=$17, clave_smtp=$18, remitente=$19
              ${cambiaCarpeta ? ', ultimo_uid = NULL, uid_validez = NULL' : ''} WHERE id = $1 RETURNING *`,
      [a.id, d.nombre, d.direccion, d.host, d.puerto, d.tls, d.usuario, clave, d.carpeta_entrada, d.carpeta_raiz, d.archivar, d.activo,
        d.entrada, d.smtp_host, d.smtp_puerto, d.smtp_seguridad, d.smtp_usuario,
        req.body?.misma_clave_smtp ? null : req.body?.clave_smtp ? cifrar(String(req.body.clave_smtp)) : a.clave_smtp, d.remitente]);
    if (req.body?.principal && d.smtp_host) await hacerPrincipal(b.id);
    if (!d.smtp_host && a.principal) await query('UPDATE buzones SET principal = false WHERE id = $1', [a.id]);
    await correo.cargar();
    await arrancarBuzon(b.id);
    res.json(vistaBuzon(b));
  }));
  app.delete('/api/buzones/:id', admin, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows: [n] } = await query('SELECT count(*)::int AS n FROM correos WHERE buzon_id = $1', [id]);
    conexiones.get(id)?.parar(); conexiones.delete(id);
    if (n.n) await query(`UPDATE buzones SET activo = false, clave = NULL, clave_smtp = NULL, principal = false, estado = 'parado' WHERE id = $1`, [id]);   // conserva sus correos
    else await query('DELETE FROM buzones WHERE id = $1', [id]);
    await correo.cargar();
    res.json({ ok: true, conservado: !!n.n });
  }));
  // Probar con lo escrito en el formulario (la contraseña, la escrita o la guardada)
  app.post('/api/buzones/probar', admin, asyncH(async (req, res) => {
    const b = req.body || {};
    let clave = b.clave;
    if (!clave && b.id) { const { rows: [a] } = await query('SELECT clave FROM buzones WHERE id = $1', [b.id]); clave = a?.clave ? descifrar(a.clave) : null; }
    if (!clave) throw fallo(400, 'Falta la contraseña');
    res.json(await probar({ host: texto(b.host, 200), puerto: Number(b.puerto) || 993, tls: b.tls !== false, usuario: texto(b.usuario, 200), clave, carpeta_entrada: texto(b.carpeta_entrada, 200) }));
  }));
  // Probar la SALIDA (SMTP) con lo escrito; con «para», manda un correo de prueba
  app.post('/api/buzones/probar-salida', admin, asyncH(async (req, res) => {
    const b = req.body || {};
    let clave = b.clave_smtp || b.clave;
    if (!clave && b.id) { const { rows: [a] } = await query('SELECT clave, clave_smtp FROM buzones WHERE id = $1', [b.id]); const c = a?.clave_smtp || a?.clave; clave = c ? descifrar(c) : null; }
    if (!clave) throw fallo(400, 'Falta la contraseña');
    const host = texto(b.smtp_host, 200); if (!host) throw fallo(400, 'Falta el servidor de salida');
    const t = correo.transportePara({ host, port: Number(b.smtp_puerto) || 587, secure: b.smtp_seguridad === 'ssl', ignoreTLS: b.smtp_seguridad === 'ninguna', user: texto(b.smtp_usuario, 200) || texto(b.usuario, 200) || texto(b.direccion, 200), pass: clave });
    const de = texto(b.remitente, 300) || texto(b.direccion, 200);
    try {
      await t.verify();
      const para = texto(b.para, 200);
      if (para) await t.sendMail({ from: de, to: para, subject: 'Prueba de correo · Planéalo', text: `Correo de prueba enviado desde Planéalo con la cuenta ${de}. Si lo recibes, la salida funciona.` });
      res.json({ ok: true, msg: para ? `Conecta · correo de prueba enviado a ${para}` : 'Conecta: puede enviar' });
    } catch (e) {
      res.json({ ok: false, msg: /auth|535|credential/i.test(e.message) ? 'Usuario o contraseña incorrectos' : `No conecta: ${e.message}` });
    }
  }));
  app.post('/api/buzones/:id/principal', admin, asyncH(async (req, res) => {
    const { rows: [b] } = await query('SELECT * FROM buzones WHERE id = $1', [req.params.id]);
    if (!b?.smtp_host) throw fallo(400, 'Esa cuenta no tiene configurada la salida');
    await hacerPrincipal(b.id); await correo.cargar();
    res.json({ ok: true });
  }));
  app.post('/api/buzones/:id/recuperar', admin, asyncH(async (req, res) => {
    const cx = conexiones.get(Number(req.params.id));
    if (!cx) throw fallo(409, 'El buzón no está conectado');
    const dias = Math.min(30, Math.max(1, Number(req.body?.dias) || 7));
    res.json({ nuevos: await cx.cola(() => cx.recuperar(dias)) });
  }));
}

module.exports = { montar, arrancarTodos, migrarSalida, archivar, moverEnDisco, absoluta, CARPETAS, conexiones };
