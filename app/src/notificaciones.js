// Avisos al móvil (notificaciones push, estándar Web Push con claves VAPID propias).
//  · Las claves se crean solas la primera vez y se guardan en la base de datos (tabla ajustes).
//  · Cada navegador que acepta los avisos deja su «suscripción»; un usuario puede tener varias.
//  · Cada usuario elige qué avisos quiere y sus horas de silencio (salvo «urgente»: averías y seguridad).
//  · Avisos al momento (los lanza quien hace el cambio) y programados (cada minuto se repasa):
//      plan de hoy/mañana cambiado, recordatorio de las 17:00, resumen de la bandeja, asuntos que vencen.
const webpush = require('web-push');
const { query } = require('./db');
const auth = require('./auth');

const TIPOS = {
  plan: { txt: 'Cambios en mi plan de hoy o mañana', para: (u) => !!u.recurso_id },
  recordatorio: { txt: 'Recordatorio a las 17:00 si no he enviado mi día', para: (u) => auth.tiene(u, 'mi_dia') },
  vacaciones: { txt: 'Respuesta a mis peticiones de vacaciones', para: (u) => auth.tiene(u, 'mi_dia') || !!u.recurso_id },
  capturas: { txt: 'Lo que capturé se convierte en tarea o se resuelve', para: () => true },
  urgente: { txt: 'Averías y seguridad, al momento (también en horas de silencio)', para: (u) => auth.tiene(u, 'planificar') },
  bandeja: { txt: 'Resumen de capturas nuevas en la bandeja', para: (u) => auth.tiene(u, 'planificar') },
  ausencias: { txt: 'Un operario avisa de que no viene o llega tarde', para: (u) => auth.tiene(u, 'planificar') },
  vac_pendiente: { txt: 'Peticiones de vacaciones que esperan mi paso', para: (u) => auth.tiene(u, 'vacaciones_ops') || auth.tiene(u, 'vacaciones_rrhh') },
  asuntos: { txt: 'Asuntos asignados a mí o que vencen mañana', para: (u) => !u.solo_mi_dia },
  mat_revisar: { txt: 'Escandallo nuevo o cambiado: revisar stock', para: (u) => auth.tiene(u, 'logistica') },
  mat_comprar: { txt: 'Material que falta y hay que pedir', para: (u) => auth.tiene(u, 'compras') },
  mat_pedido: { txt: 'Material pedido al proveedor (cuándo llega)', para: (u) => auth.tiene(u, 'logistica') || auth.tiene(u, 'escandallo') },
  mat_recibido: { txt: 'Ya ha llegado el material de mis tareas', para: () => true },
};
const SILENCIO = { desde: 21, hasta: 7 };
const URGENTES = ['averia', 'seguridad'];

let listo = null;   // promesa: claves cargadas
async function claves() {
  if (!listo) {
    listo = (async () => {
      const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'vapid'`);
      let k = rows[0]?.valor;
      if (!k) {
        k = webpush.generateVAPIDKeys();
        await query(`INSERT INTO ajustes (clave, valor) VALUES ('vapid', $1) ON CONFLICT (clave) DO NOTHING`, [JSON.stringify(k)]);
        k = (await query(`SELECT valor FROM ajustes WHERE clave = 'vapid'`)).rows[0].valor;
      }
      const contacto = process.env.MAIL_FROM && /@/.test(process.env.MAIL_FROM) ? `mailto:${process.env.MAIL_FROM.replace(/.*<|>.*/g, '')}` : 'mailto:avisos@s360.local';
      webpush.setVapidDetails(contacto, k.publicKey, k.privateKey);
      return k;
    })().catch((e) => { listo = null; throw e; });
  }
  return listo;
}

const horaMadrid = () => {
  const p = new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  return Number(p.find((x) => x.type === 'hour').value) + Number(p.find((x) => x.type === 'minute').value) / 60;
};
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const enSilencio = (s, h) => (s.desde > s.hasta ? h >= s.desde || h < s.hasta : h >= s.desde && h < s.hasta);

function prefsDe(u) {
  const a = u.avisos || {};
  return { off: Array.isArray(a.off) ? a.off : [], silencio: a.silencio === null ? null : a.silencio || SILENCIO };
}

/* ---------- enviar ---------- */
// avisar([ids], 'tipo', { titulo, cuerpo, url, tag, urgente })
async function avisar(usuarioIds, tipo, msg) {
  const ids = [...new Set((usuarioIds || []).filter(Boolean))];
  if (!ids.length) return 0;
  await claves();
  const { rows: us } = await query(
    `SELECT u.id, u.avisos, s.id AS sid, s.endpoint, s.p256dh, s.auth
       FROM usuarios u JOIN push_suscripciones s ON s.usuario_id = u.id
      WHERE u.id = ANY($1) AND u.activo`, [ids]);
  const h = horaMadrid();
  const payload = JSON.stringify({ titulo: msg.titulo, cuerpo: msg.cuerpo || '', url: msg.url || '/inicio.html', tag: msg.tag || tipo });
  let n = 0;
  await Promise.all(us.map(async (s) => {
    const p = prefsDe(s);
    if (p.off.includes(tipo)) return;
    if (!msg.urgente && tipo !== 'prueba' && p.silencio && enSilencio(p.silencio, h)) return;
    // siempre «high»: con «normal», Android en reposo (Doze) los retiene hasta que se usa el móvil
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, { TTL: 6 * 3600, urgency: 'high' });
      n++;
      query('UPDATE push_suscripciones SET ultimo_ok = now() WHERE id = $1', [s.sid]).catch(() => {});
    } catch (e) {
      // el navegador ya no la acepta (se desinstaló, se quitó el permiso…): fuera
      if (e.statusCode === 404 || e.statusCode === 410) await query('DELETE FROM push_suscripciones WHERE id = $1', [s.sid]).catch(() => {});
      else console.warn('push', e.statusCode || '', e.body || e.message);
    }
  }));
  return n;
}
// sin esperar ni romper nada si falla (los destinatarios pueden ser una promesa)
function avisarLuego(ids, tipo, msg) {
  setImmediate(async () => {
    try { await avisar(await ids, tipo, msg); } catch (e) { console.warn('avisos', e.message); }
  });
}

/* ---------- a quién ---------- */
async function conPermiso(...permisos) {
  const { rows } = await query(
    `SELECT u.id FROM usuarios u WHERE u.activo AND ${require('./auth').SQL_PERMISOS} && $1::text[]`, [permisos]);
  return rows.map((r) => r.id);
}
async function deRecurso(recursoId) {
  const { rows } = await query('SELECT id FROM usuarios WHERE recurso_id = $1 AND activo', [recursoId]);
  return rows.map((r) => r.id);
}

/* ---------- programados (cada minuto) ---------- */
async function estado(clave) { return (await query('SELECT valor, actualizado FROM push_estado WHERE clave = $1', [clave])).rows[0] || null; }
async function guardar(clave, valor) {
  await query(`INSERT INTO push_estado (clave, valor) VALUES ($1,$2) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado = now()`, [clave, valor]);
}

const DIA_TXT = (f, hoy) => (f === hoy ? 'hoy' : 'mañana');
async function repasarPlanes(hoy, h) {
  // solo de quien tiene avisos activados
  const { rows: gente } = await query(
    `SELECT DISTINCT u.recurso_id FROM usuarios u JOIN push_suscripciones s ON s.usuario_id = u.id WHERE u.activo AND u.recurso_id IS NOT NULL`);
  if (!gente.length) return;
  const dias = [hoy, sumarDias(hoy, 1)];
  const { rows } = await query(
    `SELECT a.recurso_id, x.fecha,
            string_agg(x.id || '@' || COALESCE(a.desde, x.hora_inicio) || '-' || COALESCE(a.hasta, x.hora_inicio + x.duracion_h) || '#' || COALESCE(x.linea_id, 0), ',' ORDER BY x.id) AS firma,
            (array_agg(o.codigo || ' · ' || t.nombre ORDER BY COALESCE(a.desde, x.hora_inicio)))[1] AS primero, count(*)::int AS n
       FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id JOIN tareas t ON t.id = x.tarea_id JOIN ordenes o ON o.id = t.orden_id
      WHERE x.fecha = ANY($1::date[]) AND a.recurso_id = ANY($2) GROUP BY a.recurso_id, x.fecha`,
    [dias, gente.map((g) => g.recurso_id)]);
  const porClave = new Map(rows.map((r) => [`${r.recurso_id}:${r.fecha}`, r]));
  for (const g of gente) {
    for (const f of dias) {
      const r = porClave.get(`${g.recurso_id}:${f}`);
      const firma = r?.firma || '';
      const clave = `plan:${g.recurso_id}:${f}`;
      const antes = await estado(clave);
      if (!antes) { await guardar(clave, firma); continue; }   // primera vez: solo se apunta
      if (antes.valor === firma) continue;
      if (h < 6 || h >= 21) continue;   // de noche se espera (la firma vieja se queda y avisa por la mañana)
      // si están planificando, se agrupa: como mucho un aviso cada 5 min por persona y día
      const ultimo = await estado(`planaviso:${g.recurso_id}:${f}`);
      if (ultimo && Date.now() - new Date(ultimo.actualizado).getTime() < 5 * 60 * 1000) continue;
      await guardar(clave, firma);
      await guardar(`planaviso:${g.recurso_id}:${f}`, '1');
      await avisar(await deRecurso(g.recurso_id), 'plan', {
        titulo: `Ha cambiado tu plan de ${DIA_TXT(f, hoy)}`,
        cuerpo: r ? `${r.n} trabajo${r.n > 1 ? 's' : ''}. Empiezas con: ${r.primero}` : 'Ya no tienes trabajo planificado ese día',
        url: `/mi-dia.html?fecha=${f}`, tag: `plan-${f}`,
      });
    }
  }
}

async function recordatorio(hoy) {
  const finde = [0, 6].includes(new Date(`${hoy}T12:00:00Z`).getUTCDay());
  if (finde) return;
  const { rows: fest } = await query('SELECT 1 FROM festivos WHERE fecha = $1', [hoy]);
  if (fest.length) return;
  const { rows } = await query(
    `SELECT DISTINCT a.recurso_id FROM tramos x JOIN tramo_asignaciones a ON a.tramo_id = x.id
       JOIN recursos r ON r.id = a.recurso_id AND r.tipo = 'operario'
      WHERE x.fecha = $1 AND x.cierre IS NULL
        AND NOT EXISTS (SELECT 1 FROM dias_enviados e WHERE e.fecha = $1 AND e.recurso_id = a.recurso_id)
        AND NOT EXISTS (SELECT 1 FROM dias_cerrados c WHERE c.fecha = $1)`, [hoy]);
  for (const r of rows) {
    const clave = `recordatorio:${r.recurso_id}:${hoy}`;
    if (await estado(clave)) continue;
    await guardar(clave, '1');
    const { rows: us } = await query(
      `SELECT u.id FROM usuarios u JOIN roles ro ON ro.clave = u.rol WHERE u.recurso_id = $1 AND u.activo AND 'mi_dia' = ANY(ro.permisos)`, [r.recurso_id]);
    await avisar(us.map((u) => u.id), 'recordatorio', {
      titulo: 'Apunta tu día', cuerpo: 'Marca lo que hiciste hoy y envíalo al encargado.', url: '/mi-dia.html', tag: `recordatorio-${hoy}`,
    });
  }
}

async function resumenBandeja() {
  const ult = await estado('bandeja:resumen');
  const desde = ult ? ult.actualizado : new Date(Date.now() - 30 * 60 * 1000);
  if (Date.now() - new Date(desde).getTime() < 30 * 60 * 1000) return;
  const { rows } = await query(
    `SELECT count(*)::int AS n FROM capturas WHERE estado = 'bandeja' AND creado > $1
        AND (categoria IS NULL OR NOT (categoria = ANY($2)))`, [desde, URGENTES]);
  await guardar('bandeja:resumen', String(rows[0].n));
  if (!rows[0].n) return;
  const { rows: t } = await query(`SELECT count(*)::int AS n FROM capturas WHERE estado = 'bandeja'`);
  await avisar(await conPermiso('planificar'), 'bandeja', {
    titulo: `${rows[0].n} captura${rows[0].n > 1 ? 's' : ''} nueva${rows[0].n > 1 ? 's' : ''} en la bandeja`,
    cuerpo: `Hay ${t[0].n} por clasificar.`, url: '/bandeja.html', tag: 'bandeja',
  });
}

async function vencenManana(hoy) {
  const clave = `vence:${hoy}`;
  if (await estado(clave)) return;
  await guardar(clave, '1');
  const { rows } = await query(
    `SELECT responsable_id, count(*)::int AS n, min(texto) AS texto FROM capturas
      WHERE estado = 'asunto' AND fecha_limite = $1 AND responsable_id IS NOT NULL GROUP BY responsable_id`, [sumarDias(hoy, 1)]);
  for (const r of rows) {
    await avisar([r.responsable_id], 'asuntos', {
      titulo: r.n > 1 ? `${r.n} asuntos vencen mañana` : 'Un asunto vence mañana',
      cuerpo: r.n > 1 ? '' : (r.texto || '').slice(0, 120), url: '/capturar.html', tag: 'vence',
    });
  }
}

let enMarcha = false;
async function repasar() {
  if (enMarcha) return;
  enMarcha = true;
  try {
    const { rows } = await query('SELECT count(*)::int AS n FROM push_suscripciones');
    if (!rows[0].n) return;
    const hoy = hoyMadrid(), h = horaMadrid();
    await repasarPlanes(hoy, h);
    if (h >= 17 && h < 20) await recordatorio(hoy);
    if (h >= 7 && h < 20) await resumenBandeja();
    if (h >= 8 && h < 20) await vencenManana(hoy);
  } catch (e) {
    console.warn('avisos programados', e.message);
  } finally { enMarcha = false; }
}

/* ---------- API ---------- */
function montar(app, asyncH) {
  app.get('/api/push/clave', asyncH(async (req, res) => {
    res.json({ clave: (await claves()).publicKey });
  }));

  app.post('/api/push/suscribir', asyncH(async (req, res) => {
    const s = req.body?.suscripcion || {};
    if (!/^https:\/\//.test(s.endpoint || '') || !s.keys?.p256dh || !s.keys?.auth) {
      return res.status(400).json({ error: 'Suscripción no válida' });
    }
    await query(
      `INSERT INTO push_suscripciones (usuario_id, endpoint, p256dh, auth, agente) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (endpoint) DO UPDATE SET usuario_id = EXCLUDED.usuario_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, agente = EXCLUDED.agente`,
      [req.usuario.id, s.endpoint, s.keys.p256dh, s.keys.auth, String(req.get('user-agent') || '').slice(0, 200)]);
    res.json({ ok: true });
  }));

  app.delete('/api/push/suscribir', asyncH(async (req, res) => {
    await query('DELETE FROM push_suscripciones WHERE endpoint = $1 AND usuario_id = $2', [String(req.body?.endpoint || ''), req.usuario.id]);
    res.json({ ok: true });
  }));

  // qué avisos puede recibir este usuario y cuáles tiene apagados
  app.get('/api/push/preferencias', asyncH(async (req, res) => {
    const { rows } = await query('SELECT avisos FROM usuarios WHERE id = $1', [req.usuario.id]);
    const p = prefsDe({ avisos: rows[0]?.avisos });
    const { rows: s } = await query('SELECT count(*)::int AS n FROM push_suscripciones WHERE usuario_id = $1', [req.usuario.id]);
    res.json({
      tipos: Object.entries(TIPOS).filter(([, t]) => t.para(req.usuario)).map(([k, t]) => ({ clave: k, texto: t.txt, activo: !p.off.includes(k) })),
      silencio: p.silencio, dispositivos: s[0].n,
    });
  }));

  app.put('/api/push/preferencias', asyncH(async (req, res) => {
    const off = (Array.isArray(req.body?.off) ? req.body.off : []).filter((k) => TIPOS[k]);
    let silencio = req.body?.silencio;
    if (silencio !== null) {
      const d = Number(silencio?.desde), h = Number(silencio?.hasta);
      silencio = Number.isInteger(d) && Number.isInteger(h) && d >= 0 && d < 24 && h >= 0 && h < 24 && d !== h ? { desde: d, hasta: h } : SILENCIO;
    }
    await query('UPDATE usuarios SET avisos = $2 WHERE id = $1', [req.usuario.id, JSON.stringify({ off, silencio })]);
    res.json({ ok: true });
  }));

  // { espera: segundos } → se manda más tarde (para probar con la app cerrada)
  app.post('/api/push/prueba', asyncH(async (req, res) => {
    const espera = Math.min(Math.max(Number(req.body?.espera) || 0, 0), 60);
    const msg = espera
      ? { titulo: '✔ Te llegan con la app cerrada', cuerpo: 'Perfecto: los avisos funcionan aunque no tengas la app abierta.', url: '/inicio.html', tag: 'prueba' }
      : { titulo: 'Avisos activados ✔', cuerpo: 'Así te llegarán los avisos del planificador.', url: '/inicio.html', tag: 'prueba' };
    if (espera) {
      const id = req.usuario.id;
      setTimeout(() => avisar([id], 'prueba', msg).catch(() => {}), espera * 1000);
      return res.json({ programado: true, espera });
    }
    res.json({ enviados: await avisar([req.usuario.id], 'prueba', msg) });
  }));

  setTimeout(() => { repasar(); setInterval(repasar, 60 * 1000); }, 15 * 1000);
}

module.exports = { montar, avisar, avisarLuego, conPermiso, deRecurso, URGENTES };
