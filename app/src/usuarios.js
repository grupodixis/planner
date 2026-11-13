// Cuentas de usuario: entrada, recuperación de contraseña, «Mi cuenta», usuarios y roles.
const crypto = require('crypto');
const { query, tx } = require('./db');
const auth = require('./auth');
const correo = require('./correo');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const sha = (t) => crypto.createHash('sha256').update(t).digest('hex');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VIGENCIA = { activar: 7 * 24, recuperar: 24 };   // horas

// Dirección pública de la web: APP_URL, o la que usó quien hace la petición
function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol).split(',')[0].trim();
  return `${proto}://${req.get('host')}`;
}

async function crearEnlace(c, usuarioId, tipo, { pedido = false, por = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  await c.query(`UPDATE enlaces_acceso SET usado = now() WHERE usuario_id = $1 AND usado IS NULL`, [usuarioId]);
  await c.query(
    `INSERT INTO enlaces_acceso (usuario_id, token_hash, tipo, expira, pedido_por_usuario, creado_por)
     VALUES ($1, $2, $3, now() + make_interval(hours => $4), $5, $6)`,
    [usuarioId, sha(token), tipo, VIGENCIA[tipo], pedido, por]);
  return token;
}

function textoCorreo(tipo, nombre, url) {
  const horas = VIGENCIA[tipo];
  const plazo = horas >= 48 ? `${horas / 24} días` : `${horas} horas`;
  return tipo === 'activar'
    ? { asunto: 'Tu cuenta en el planificador s360',
        texto: `Hola ${nombre}:\n\nTe han dado de alta en el planificador s360. Para elegir tu contraseña y entrar abre este enlace:\n\n${url}\n\nEl enlace sirve una sola vez y caduca en ${plazo}.\n` }
    : { asunto: 'Restablecer tu contraseña del planificador s360',
        texto: `Hola ${nombre}:\n\nPara elegir una contraseña nueva abre este enlace:\n\n${url}\n\nEl enlace sirve una sola vez y caduca en ${plazo}. Si no lo has pedido tú, ignora este correo.\n` };
}

// Crea un enlace y, si hay correo configurado, lo envía. Devuelve { url, enviado }
async function prepararEnlace(req, usuario, tipo, opciones) {
  const token = await crearEnlace({ query }, usuario.id, tipo, opciones);
  const url = `${baseUrl(req)}/restablecer.html?t=${token}`;
  let enviado = false;
  if (correo.configurado()) {
    const m = textoCorreo(tipo, usuario.nombre, url);
    enviado = await correo.enviar({ para: usuario.email, asunto: m.asunto, texto: m.texto });
    if (enviado) await query('UPDATE enlaces_acceso SET enviado = TRUE WHERE token_hash = $1', [sha(token)]);
  }
  return { url, enviado, caduca_h: VIGENCIA[tipo] };
}

// ¿Quedaría algún usuario activo capaz de administrar usuarios?
async function quedaAdministrador(c, { sinUsuario = null, sinRol = null } = {}) {
  const { rows } = await c.query(
    `SELECT count(*)::int AS n FROM usuarios u JOIN roles r ON r.clave = u.rol
      WHERE u.activo AND 'usuarios' = ANY(r.permisos)
        AND ($1::int IS NULL OR u.id <> $1) AND ($2::text IS NULL OR r.clave <> $2)`,
    [sinUsuario, sinRol]);
  return rows[0].n > 0;
}

module.exports = function (app, asyncH) {
  /* ---------- Público: entrar, recuperar, restablecer ---------- */

  app.post('/api/login', asyncH(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const claves = [`email:${email}`, `ip:${req.ip}`];
    const min = auth.bloqueado(...claves);
    if (min) return res.status(429).json({ error: `Demasiados intentos fallidos. Prueba dentro de ${min} min o recupera la contraseña.` });
    const { rows } = await query('SELECT id, password_hash FROM usuarios WHERE email = $1 AND activo', [email]);
    if (!rows.length || !auth.verificarPassword(password, rows[0].password_hash)) {
      auth.anotarFallo(...claves);
      return res.status(401).json({ error: 'Email o contraseña incorrectos' });
    }
    auth.anotarAcierto(`email:${email}`);
    await auth.crearSesion(res, rows[0].id);
    res.json({ ok: true });
  }));

  app.post('/api/logout', asyncH(async (req, res) => {
    await auth.cerrarSesion(req, res);
    res.json({ ok: true });
  }));

  // «¿Has olvidado tu contraseña?» Respuesta siempre igual, exista o no el email.
  app.post('/api/recuperar', asyncH(async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const claveIp = `rec:${req.ip}`;
    const respuesta = {
      ok: true, correo: correo.configurado(),
      mensaje: correo.configurado()
        ? 'Si el email corresponde a una cuenta activa, te llegará un correo con un enlace para elegir una contraseña nueva.'
        : 'Petición registrada. Un administrador te hará llegar el enlace para elegir una contraseña nueva.',
    };
    if (auth.bloqueado(claveIp) || !EMAIL_RE.test(email)) return res.json(respuesta);
    auth.anotarFallo(claveIp);   // como mucho unas pocas peticiones por IP cada 15 min
    const { rows } = await query('SELECT id, email, nombre FROM usuarios WHERE email = $1 AND activo', [email]);
    if (rows.length) {
      const u = rows[0];
      // una petición pendiente reciente basta
      const { rows: rec } = await query(
        `SELECT 1 FROM enlaces_acceso WHERE usuario_id = $1 AND pedido_por_usuario AND usado IS NULL
            AND creado > now() - interval '10 minutes'`, [u.id]);
      if (!rec.length) await prepararEnlace(req, u, 'recuperar', { pedido: true });
    }
    res.json(respuesta);
  }));

  async function leerEnlace(token) {
    const { rows } = await query(
      `SELECT e.id, e.tipo, u.id AS usuario_id, u.email, u.nombre
         FROM enlaces_acceso e JOIN usuarios u ON u.id = e.usuario_id
        WHERE e.token_hash = $1 AND e.usado IS NULL AND e.expira > now() AND u.activo`, [sha(String(token || ''))]);
    return rows[0] || null;
  }

  app.get('/api/restablecer/:token', asyncH(async (req, res) => {
    const e = await leerEnlace(req.params.token);
    if (!e) throw fallo(404, 'El enlace no es válido, ya se usó o ha caducado. Pide otro.');
    res.json({ tipo: e.tipo, nombre: e.nombre, email: e.email });
  }));

  app.post('/api/restablecer', asyncH(async (req, res) => {
    const e = await leerEnlace(req.body?.token);
    if (!e) throw fallo(404, 'El enlace no es válido, ya se usó o ha caducado. Pide otro.');
    const mal = auth.validarPassword(req.body?.password);
    if (mal) throw fallo(400, mal);
    await tx(async (c) => {
      await c.query('UPDATE usuarios SET password_hash = $2, password_cambiada = now() WHERE id = $1',
        [e.usuario_id, auth.hashPassword(String(req.body.password))]);
      await c.query('UPDATE enlaces_acceso SET usado = now() WHERE usuario_id = $1 AND usado IS NULL', [e.usuario_id]);
      await c.query('DELETE FROM sesiones WHERE usuario_id = $1', [e.usuario_id]);
    });
    auth.anotarAcierto(`email:${e.email}`);
    await auth.crearSesion(res, e.usuario_id);
    res.json({ ok: true });
  }));

  /* ---------- A partir de aquí, con sesión ---------- */
  app.use('/api', auth.requiereSesion);

  app.get('/api/me', (req, res) => res.json({ ...req.usuario, permisos_todos: auth.PERMISOS }));

  app.patch('/api/me', asyncH(async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim();
    if (!nombre || nombre.length > 80) throw fallo(400, 'El nombre es obligatorio (máx. 80)');
    await query('UPDATE usuarios SET nombre = $2 WHERE id = $1', [req.usuario.id, nombre]);
    res.json({ ok: true });
  }));

  app.post('/api/me/password', asyncH(async (req, res) => {
    const { rows } = await query('SELECT password_hash FROM usuarios WHERE id = $1', [req.usuario.id]);
    const clave = `email:${req.usuario.email}`;
    if (auth.bloqueado(clave)) throw fallo(429, 'Demasiados intentos fallidos. Espera unos minutos.');
    if (!auth.verificarPassword(String(req.body?.actual || ''), rows[0].password_hash)) {
      auth.anotarFallo(clave);
      throw fallo(400, 'La contraseña actual no es correcta');
    }
    const mal = auth.validarPassword(req.body?.nueva);
    if (mal) throw fallo(400, mal);
    await query('UPDATE usuarios SET password_hash = $2, password_cambiada = now() WHERE id = $1',
      [req.usuario.id, auth.hashPassword(String(req.body.nueva))]);
    // se cierran las demás sesiones (otros navegadores)
    await query('DELETE FROM sesiones WHERE usuario_id = $1 AND token <> $2', [req.usuario.id, auth.tokenActual(req)]);
    res.json({ ok: true });
  }));

  /* ---------- Usuarios (permiso «usuarios») ---------- */
  const admin = auth.permiso('usuarios');

  app.get('/api/usuarios', admin, asyncH(async (req, res) => {
    const { rows: usuarios } = await query(
      `SELECT u.id, u.email, u.nombre, u.rol, u.activo, u.recurso_id, r.nombre AS recurso_nombre,
              u.ultimo_acceso, u.password_cambiada, u.creado,
              (u.password_hash = '!') AS sin_activar,
              (SELECT count(*)::int FROM sesiones s WHERE s.usuario_id = u.id AND s.expira > now()) AS sesiones,
              (SELECT json_build_object('tipo', e.tipo, 'creado', e.creado, 'expira', e.expira, 'enviado', e.enviado,
                                        'pedido', e.pedido_por_usuario, 'caducado', e.expira <= now())
                 FROM enlaces_acceso e WHERE e.usuario_id = u.id AND e.usado IS NULL
                ORDER BY e.creado DESC LIMIT 1) AS enlace
         FROM usuarios u LEFT JOIN recursos r ON r.id = u.recurso_id
        ORDER BY u.activo DESC, u.nombre`);
    const { rows: roles } = await query(
      `SELECT r.*, (SELECT count(*)::int FROM usuarios u WHERE u.rol = r.clave) AS usuarios
         FROM roles r ORDER BY r.orden, r.nombre`);
    const { rows: personas } = await query(
      `SELECT id, nombre FROM recursos WHERE tipo IN ('operario', 'subcontrata') AND activo ORDER BY nombre`);
    res.json({ usuarios, roles, personas, permisos: auth.PERMISOS, correo: correo.configurado(), yo: req.usuario.id });
  }));

  function leerUsuario(b, parcial) {
    const out = {};
    if (!parcial || 'nombre' in b) {
      const n = String(b.nombre || '').trim();
      if (!n || n.length > 80) throw fallo(400, 'El nombre es obligatorio (máx. 80)');
      out.nombre = n;
    }
    if (!parcial || 'email' in b) {
      const e = String(b.email || '').trim().toLowerCase();
      if (!EMAIL_RE.test(e) || e.length > 120) throw fallo(400, 'Email no válido');
      out.email = e;
    }
    if (!parcial || 'rol' in b) out.rol = String(b.rol || 'consulta');
    if ('recurso_id' in b) out.recurso_id = b.recurso_id ? Number(b.recurso_id) : null;
    if ('activo' in b) out.activo = !!b.activo;
    return out;
  }

  app.post('/api/usuarios', admin, asyncH(async (req, res) => {
    const d = leerUsuario(req.body || {}, false);
    const { rows: ya } = await query('SELECT 1 FROM usuarios WHERE email = $1', [d.email]);
    if (ya.length) throw fallo(409, 'Ya hay un usuario con ese email');
    const { rows } = await query(
      `INSERT INTO usuarios (email, nombre, password_hash, rol, recurso_id) VALUES ($1,$2,'!',$3,$4)
       RETURNING id, email, nombre`, [d.email, d.nombre, d.rol, d.recurso_id ?? null]);
    const enlace = await prepararEnlace(req, rows[0], 'activar', { por: req.usuario.id });
    res.status(201).json({ id: rows[0].id, enlace });
  }));

  app.patch('/api/usuarios/:id', admin, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const d = leerUsuario(req.body || {}, true);
    await tx(async (c) => {
      const { rows } = await c.query('SELECT id FROM usuarios WHERE id = $1 FOR UPDATE', [id]);
      if (!rows.length) throw fallo(404, 'Usuario no encontrado');
      if (id === req.usuario.id && d.activo === false) throw fallo(400, 'No puedes desactivar tu propio usuario');
      const campos = Object.keys(d);
      if (!campos.length) return;
      await c.query(`UPDATE usuarios SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`,
        [id, ...campos.map((k) => d[k])]);
      if (!(await quedaAdministrador(c))) throw fallo(400, 'Tiene que quedar al menos un usuario activo que pueda administrar usuarios');
      if (d.activo === false) await c.query('DELETE FROM sesiones WHERE usuario_id = $1', [id]);
    });
    res.json({ ok: true });
  }));

  app.post('/api/usuarios/:id/enlace', admin, asyncH(async (req, res) => {
    const { rows } = await query('SELECT id, email, nombre, activo, password_hash FROM usuarios WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) throw fallo(404, 'Usuario no encontrado');
    if (!rows[0].activo) throw fallo(400, 'El usuario está desactivado');
    const tipo = rows[0].password_hash === '!' ? 'activar' : 'recuperar';
    res.json(await prepararEnlace(req, rows[0], tipo, { por: req.usuario.id }));
  }));

  app.post('/api/usuarios/:id/cerrar-sesiones', admin, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rowCount } = await query('DELETE FROM sesiones WHERE usuario_id = $1 AND token <> $2', [id, auth.tokenActual(req)]);
    res.json({ ok: true, cerradas: rowCount });
  }));

  // Borra si nunca hizo nada; si ya dejó rastro (planificó, importó…), se desactiva
  app.delete('/api/usuarios/:id', admin, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    if (id === req.usuario.id) throw fallo(400, 'No puedes borrar tu propio usuario');
    const r = await tx(async (c) => {
      await c.query('UPDATE usuarios SET activo = FALSE WHERE id = $1', [id]);
      await c.query('DELETE FROM sesiones WHERE usuario_id = $1', [id]);
      if (!(await quedaAdministrador(c))) throw fallo(400, 'Tiene que quedar al menos un usuario activo que pueda administrar usuarios');
      await c.query('SAVEPOINT borrar');
      try {
        await c.query('DELETE FROM usuarios WHERE id = $1', [id]);
        return { borrado: true };
      } catch (e) {
        if (e.code !== '23503') throw e;
        await c.query('ROLLBACK TO SAVEPOINT borrar');
        return { borrado: false, desactivado: true };
      }
    });
    res.json({ ok: true, ...r });
  }));

  /* ---------- Roles ---------- */

  function leerRol(b, parcial) {
    const out = {};
    if (!parcial || 'nombre' in b) {
      const n = String(b.nombre || '').trim();
      if (!n || n.length > 40) throw fallo(400, 'El nombre del rol es obligatorio (máx. 40)');
      out.nombre = n;
    }
    if ('descripcion' in b) out.descripcion = String(b.descripcion || '').trim().slice(0, 200) || null;
    if (!parcial || 'permisos' in b) {
      const p = Array.isArray(b.permisos) ? b.permisos : [];
      if (p.some((k) => !(k in auth.PERMISOS))) throw fallo(400, 'Permiso desconocido');
      out.permisos = Object.keys(auth.PERMISOS).filter((k) => p.includes(k));
    }
    if ('orden' in b) out.orden = Number(b.orden) || 0;
    return out;
  }

  const claveDe = (nombre) => nombre.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'rol';

  app.post('/api/roles', admin, asyncH(async (req, res) => {
    const d = leerRol(req.body || {}, false);
    let clave = claveDe(d.nombre);
    const { rows: ya } = await query('SELECT clave FROM roles WHERE clave LIKE $1', [`${clave}%`]);
    const usadas = new Set(ya.map((r) => r.clave));
    for (let i = 2; usadas.has(clave); i++) clave = `${claveDe(d.nombre)}_${i}`;
    const { rows: [{ max }] } = await query('SELECT COALESCE(max(orden), 0) AS max FROM roles');
    await query(`INSERT INTO roles (clave, nombre, descripcion, permisos, orden) VALUES ($1,$2,$3,$4,$5)`,
      [clave, d.nombre, d.descripcion ?? null, d.permisos, max + 1]);
    res.status(201).json({ clave });
  }));

  app.patch('/api/roles/:clave', admin, asyncH(async (req, res) => {
    const d = leerRol(req.body || {}, true);
    await tx(async (c) => {
      const { rows } = await c.query('SELECT sistema FROM roles WHERE clave = $1 FOR UPDATE', [req.params.clave]);
      if (!rows.length) throw fallo(404, 'Rol no encontrado');
      if (rows[0].sistema && 'permisos' in d) throw fallo(400, 'Los permisos del Administrador no se pueden cambiar');
      const campos = Object.keys(d);
      if (!campos.length) return;
      await c.query(`UPDATE roles SET ${campos.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE clave = $1`,
        [req.params.clave, ...campos.map((k) => d[k])]);
      if (!(await quedaAdministrador(c))) throw fallo(400, 'Tiene que quedar al menos un usuario activo que pueda administrar usuarios');
    });
    res.json({ ok: true });
  }));

  app.delete('/api/roles/:clave', admin, asyncH(async (req, res) => {
    const { rows } = await query(
      `SELECT sistema, (SELECT count(*)::int FROM usuarios WHERE rol = $1) AS n FROM roles WHERE clave = $1`, [req.params.clave]);
    if (!rows.length) throw fallo(404, 'Rol no encontrado');
    if (rows[0].sistema) throw fallo(400, 'El rol Administrador no se puede borrar');
    if (rows[0].n) throw fallo(400, `Hay ${rows[0].n} usuario(s) con este rol: cámbiales el rol antes de borrarlo`);
    await query('DELETE FROM roles WHERE clave = $1', [req.params.clave]);
    res.json({ ok: true });
  }));
};
