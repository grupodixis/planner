// Service worker de Planéalo: app instalable, arranque rápido, trabajo sin conexión y avisos.
//
//  · Pantallas y código: las de la app del móvil (Mi día, Capturar, entrar con PIN) se guardan en el móvil; se abren
//    al instante y sin red. El código con versión (?v=…) se sirve del móvil (no cambia); el resto, de la red y si no hay,
//    de lo guardado. Al publicar una versión nueva, se renueva solo.
//  · Datos (solo de la app del móvil: Mi día, Mi mes, capturas, compras locales…): primero la red; si no contesta en
//    unos segundos o no hay, la última copia guardada (avisando «sin conexión · datos de las 07:42»).
//  · Lo que se apunta sin red (Mi día, trabajo no planificado, enviar mi día, material recibido, capturas con fotos,
//    pedir compra local, ticket) va a una BANDEJA DE SALIDA (IndexedDB) y se envía solo, en orden, en cuanto hay red.
//    Mientras tanto, lo pendiente se ve ya aplicado en Mi día y en Mis compras. Las fotos sin enviar llevan un id
//    provisional negativo que se cambia por el de verdad al enviarlas.
const VERSION = 'v71';
const SHELL = `planealo-shell-${VERSION}`;
const DATOS = 'planealo-datos-v1';
const OFFLINE = '/offline.html';
const PAGINAS = ['/mi-dia.html', '/capturar.html', '/pin.html', '/inicio.html', OFFLINE];
const FIJOS = ['/manifest.webmanifest', '/icono-192-v2.png', '/insignia-96.png', '/logo.svg', '/favicon.svg'];
const ESPERA_DATOS = 3500;   // ms: si la red tarda más, se enseña lo guardado

// Datos que se guardan para verlos sin conexión
const GET_GUARDAR = /^\/api\/(me|mi-dia|mi-dia\/(gestiones|mes|perfil|capacidades)|capturas|capturas\/(opciones|mias)|compras-locales|compras-locales\/(opciones|mias)|material\/circuito|pendientes|push\/preferencias|supervision\/(resumen|recibir|donde)|parte|compras\/pedidos|solicitudes-vacaciones|horas-extra)$/;
// Lo que se puede apuntar sin conexión (va a la bandeja de salida)
const COLA = [
  ['PUT', /^\/api\/mi-dia\/tramos\/\d+$/],
  ['POST', /^\/api\/mi-dia\/extra$/],
  ['DELETE', /^\/api\/mi-dia\/extra\/-?\d+$/],
  ['POST', /^\/api\/mi-dia\/enviar$/],
  ['PUT', /^\/api\/mi-dia\/llevar$/],
  ['POST', /^\/api\/archivos$/],
  ['POST', /^\/api\/capturas$/],
  ['POST', /^\/api\/compras-locales\/nueva$/],
  ['POST', /^\/api\/compras-locales\/\d+\/(ticket|anular|decidir)$/],
  // supervisar: recibir en el almacén del transportista o en el taller (sin cobertura)
  ['POST', /^\/api\/envios\/\d+\/recibir$/],
  ['POST', /^\/api\/tareas\/\d+\/recibir-pieza$/],
  // gestiones del operario
  ['POST', /^\/api\/mi-dia\/vacaciones$/],
  ['DELETE', /^\/api\/mi-dia\/vacaciones\/-?\d+$/],
  ['POST', /^\/api\/mi-dia\/ausencias$/],
  ['DELETE', /^\/api\/mi-dia\/ausencias\/-?\d+$/],
  ['POST', /^\/api\/mi-dia\/ausencias\/-?\d+\/justificante$/],
  ['PUT', /^\/api\/mi-dia\/perfil$/],
  ['PUT', /^\/api\/mi-dia\/capacidades\/\d+$/],
  ['POST', /^\/api\/capturas\/\d+\/resolver$/],
  // logística en el móvil
  ['PUT', /^\/api\/escandallo\/\d+\/(stock|recibir)$/],
  ['POST', /^\/api\/escandallo\/\d+\/(incidencias|archivos)$/],
];
const enCola = (m, p) => COLA.some(([mm, re]) => mm === m && re.test(p));

/* ---------- instalar y activar ---------- */
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(SHELL);
    await c.addAll([...PAGINAS, ...FIJOS]).catch(() => {});
    // el código y los estilos que usan esas pantallas (con su versión)
    const recursos = new Set();
    for (const p of PAGINAS) {
      const r = await c.match(p);
      if (!r) continue;
      const html = await r.text();
      for (const m of html.matchAll(/(?:src|href)="\/?([a-z0-9\-_.]+\.(?:js|css)\?v=\d+)"/gi)) recursos.add(`/${m[1]}`);
    }
    await Promise.all([...recursos].map((u) => c.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const ks = await caches.keys();
    await Promise.all(ks.filter((k) => k.startsWith('planealo-shell-') && k !== SHELL || k.startsWith('s360-') || k.startsWith('planealo-offline')).map((k) => caches.delete(k)));
    await self.clients.claim();
    vaciar();
  })());
});

/* ---------- utilidades ---------- */
const conTiempo = (p, ms) => new Promise((ok, mal) => {
  const t = setTimeout(() => mal(new Error('tiempo')), ms);
  p.then((r) => { clearTimeout(t); ok(r); }, (e) => { clearTimeout(t); mal(e); });
});
const json = (datos, status = 200, extra = {}) => new Response(JSON.stringify(datos), { status, headers: { 'Content-Type': 'application/json', ...extra } });
async function avisar(msg) {
  const vs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const v of vs) v.postMessage(msg);
}

/* ---------- bandeja de salida (IndexedDB) ---------- */
let dbP = null;
function db() {
  if (!dbP) {
    dbP = new Promise((ok, mal) => {
      const r = indexedDB.open('planealo-salida', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        d.createObjectStore('ops', { keyPath: 'n', autoIncrement: true });
        d.createObjectStore('fallidos', { keyPath: 'n', autoIncrement: true });
        d.createObjectStore('mapa', { keyPath: 'local' });
        d.createObjectStore('ajustes', { keyPath: 'k' });
      };
      r.onsuccess = () => ok(r.result);
      r.onerror = () => mal(r.error);
    });
  }
  return dbP;
}
async function tx(store, modo, fn) {
  const d = await db();
  return new Promise((ok, mal) => {
    const t = d.transaction(store, modo);
    let res;
    Promise.resolve(fn(t.objectStore(store))).then((x) => { res = x; });
    t.oncomplete = () => ok(res);
    t.onerror = () => mal(t.error);
  });
}
const req = (r) => new Promise((ok, mal) => { r.onsuccess = () => ok(r.result); r.onerror = () => mal(r.error); });
const todos = (store) => tx(store, 'readonly', (s) => req(s.getAll()));
const poner = (store, v) => tx(store, 'readwrite', (s) => req(s.put(v)));
const quitar = (store, k) => tx(store, 'readwrite', (s) => req(s.delete(k)));

// Quién está usando el móvil (lo dice la página al abrirse). Lo apuntado se envía solo con la sesión de esa
// persona: en una tablet común, lo de uno no sale con la sesión de otro; y al cambiar de persona se borran los datos guardados.
let usuario = null;
async function leerUsuario() {
  if (usuario == null) usuario = (await tx('ajustes', 'readonly', (s) => req(s.get('usuario'))).catch(() => null))?.v ?? null;
  return usuario;
}
async function ponerUsuario(id) {
  const antes = await leerUsuario();
  if (antes === id) return;
  usuario = id;
  await poner('ajustes', { k: 'usuario', v: id });
  if (antes != null) await caches.delete(DATOS);   // otra persona: fuera los datos de la anterior
}

let siguienteLocal = -Date.now();   // ids provisionales: negativos y únicos
async function encolar(request, url) {
  const body = ['GET', 'HEAD'].includes(request.method) ? null : await request.arrayBuffer();
  const op = {
    url: url.pathname + url.search, method: request.method, body,
    ctype: request.headers.get('Content-Type') || null, nombre: request.headers.get('X-Nombre') || null,
    creado: Date.now(), local: null, usuario: await leerUsuario(),
  };
  if (/^\/api\/(archivos|capturas|mi-dia\/(extra|vacaciones|ausencias)|compras-locales\/nueva)$/.test(url.pathname) && request.method === 'POST') op.local = siguienteLocal--;
  // quitar algo que aún no se ha enviado: se borra de la bandeja y listo
  const m = /\/(-\d+)$/.exec(url.pathname);
  if (m && request.method === 'DELETE') {
    const ops = await todos('ops');
    const suya = ops.find((o) => o.local === Number(m[1]));
    if (suya) { await quitar('ops', suya.n); estado(); return json({ ok: true, offline: true }); }
  }
  await poner('ops', op);
  try { await self.registration.sync?.register('salida'); } catch { /* sin sincronización en segundo plano (iPhone) */ }
  estado();
  // respuesta provisional
  let cuerpo = { ok: true, offline: true };
  if (/^\/api\/mi-dia\/capacidades\/\d+$/.test(url.pathname)) {
    try { cuerpo.estado = JSON.parse(new TextDecoder().decode(body)).sabe ? 'propuesta' : null; } catch { /* */ }
  }
  if (op.local != null) {
    cuerpo = { ok: true, offline: true, id: op.local };
    if (url.pathname === '/api/compras-locales/nueva') {
      try { Object.assign(cuerpo, JSON.parse(new TextDecoder().decode(body)), { codigo: 'sin enviar', estado: 'pendiente', archivos: [] }); } catch { /* */ }
    }
  }
  return json(cuerpo, 202);
}

// cambia los ids provisionales (negativos) por los de verdad en un cuerpo JSON
function sustituir(v, mapa) {
  if (typeof v === 'number' && v < 0 && mapa.has(v)) return mapa.get(v);
  if (Array.isArray(v)) return v.map((x) => sustituir(x, mapa));
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sustituir(x, mapa)]));
  return v;
}

let vaciando = null;
function vaciar() {
  if (!vaciando) vaciando = vaciarYa().finally(() => { vaciando = null; });
  return vaciando;
}
async function vaciarYa() {
  let ops = await todos('ops');
  if (!ops.length) return;
  const mapa = new Map((await todos('mapa')).map((x) => [x.local, x.real]));
  // ¿con qué sesión se envía? solo lo apuntado por esa misma persona
  let yo = null;
  try { const r = await fetch('/api/me', { credentials: 'same-origin' }); if (r.status === 401) { avisar({ tipo: 'sesion' }); return; } yo = (await r.json()).id; } catch { return; }
  let enviados = 0;
  for (const op of ops.sort((a, b) => a.n - b.n)) {
    if (op.usuario != null && op.usuario !== yo) continue;   // se queda hasta que esa persona vuelva a entrar
    let url = op.url.replace(/\/(-\d+)(?=\/|$)/g, (s, n) => (mapa.has(Number(n)) ? `/${mapa.get(Number(n))}` : s));
    let body = op.body;
    const headers = {};
    if (op.ctype) headers['Content-Type'] = op.ctype;
    if (op.nombre) headers['X-Nombre'] = op.nombre;
    if (body && /json/.test(op.ctype || '')) {
      try { body = JSON.stringify(sustituir(JSON.parse(new TextDecoder().decode(body)), mapa)); } catch { /* tal cual */ }
    }
    let r;
    try { r = await fetch(url, { method: op.method, headers, body, credentials: 'same-origin' }); } catch { break; }   // sigue sin red
    if (r.status === 401) { avisar({ tipo: 'sesion' }); break; }
    if (r.status >= 500 || r.status === 408 || r.status === 429) break;
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      if (op.local != null && d.id) { mapa.set(op.local, d.id); await poner('mapa', { local: op.local, real: d.id }); }
      enviados++;
    } else {
      // el servidor no lo acepta (p. ej. el día ya está cerrado): se aparta para revisarlo
      await poner('fallidos', { ...op, body: null, error: d.error || `Error ${r.status}`, fallo: Date.now() });
      avisar({ tipo: 'fallido', error: d.error || `Error ${r.status}`, url: op.url });
    }
    await quitar('ops', op.n);
  }
  ops = await todos('ops');
  if (!ops.length) await tx('mapa', 'readwrite', (s) => req(s.clear()));
  if (enviados) avisar({ tipo: 'sincronizado', enviados });
  estado();
}
self.addEventListener('sync', (e) => { if (e.tag === 'salida') e.waitUntil(vaciar()); });

async function estado(extra = {}) {
  const [ops, fallidos] = await Promise.all([todos('ops'), todos('fallidos')]).catch(() => [[], []]);
  const yo = await leerUsuario();
  avisar({ tipo: 'estado', pendientes: ops.filter((o) => o.usuario == null || o.usuario === yo).length, otros: ops.filter((o) => o.usuario != null && o.usuario !== yo).length, fallidos: fallidos.map((f) => ({ n: f.n, error: f.error, url: f.url, creado: f.creado })), ...extra });
}
self.addEventListener('message', (e) => {
  const m = e.data || {};
  if (m.tipo === 'usuario') e.waitUntil(ponerUsuario(m.id ?? null).then(() => vaciar()).then(() => estado()));
  if (m.tipo === 'salir') e.waitUntil(caches.delete(DATOS).then(() => ponerUsuario(null)));
  if (m.tipo === 'vaciar') e.waitUntil(vaciar().then(() => estado()));
  if (m.tipo === 'estado') e.waitUntil(estado());
  if (m.tipo === 'descartar') e.waitUntil(quitar('fallidos', m.n).then(() => estado()));
});

/* ---------- lo pendiente, ya aplicado en lo que se enseña ---------- */
async function superponer(path, datos) {
  const yo = await leerUsuario();
  const ops = (await todos('ops').catch(() => [])).filter((o) => o.usuario == null || o.usuario === yo);
  if (!ops.length || !datos) return datos;
  const leer = (o) => { try { return JSON.parse(new TextDecoder().decode(o.body)); } catch { return {}; } };
  if (path === '/api/mi-dia' && Array.isArray(datos.tramos)) {
    for (const o of ops) {
      const b = o.body ? leer(o) : {};
      let m;
      if (o.method === 'PUT' && (m = /\/api\/mi-dia\/tramos\/(\d+)$/.exec(o.url))) {
        const t = datos.tramos.find((x) => x.id === Number(m[1]));
        if (t) t.declaracion = { estado: b.estado, desde: b.estado === 'parcial' ? b.desde : t.desde, hasta: b.estado === 'parcial' ? b.hasta : t.hasta, terminada: b.terminada, motivo: b.motivo, notas: b.notas, resuelto: null, sin_enviar: true };
      } else if (o.method === 'POST' && o.url === '/api/mi-dia/extra' && (!b.fecha || b.fecha === datos.fecha)) {
        const t = (datos.tareas || []).find((x) => x.id === b.tarea_id);
        datos.extra = [...(datos.extra || []), { id: o.local, tipo: b.tipo, tarea_id: b.tarea_id, desde: b.desde, hasta: b.hasta, motivo: b.motivo, notas: b.notas,
          tarea: t?.nombre, orden_codigo: t?.orden_codigo, resuelto: null, sin_enviar: true }].sort((x, y) => x.desde - y.desde);
      } else if (o.method === 'DELETE' && (m = /\/api\/mi-dia\/extra\/(-?\d+)$/.exec(o.url))) {
        datos.extra = (datos.extra || []).filter((x) => x.id !== Number(m[1]));
      } else if (o.url === '/api/mi-dia/enviar' && (!b.fecha || b.fecha === datos.fecha)) {
        datos.enviado = new Date(o.creado).toISOString();
      } else if (o.url === '/api/mi-dia/llevar') {
        for (const t of datos.tramos) {
          const lista = b.tipo === 'herramienta' ? t.llevar?.herramientas : b.tipo === 'material' ? t.llevar?.materiales : t.equipos_check || t.equipos;
          const it = Array.isArray(lista) && lista.find((x) => x && x.id === b.id);
          if (it) it.mio = !!b.hecho;
        }
      }
    }
  }
  if (path === '/api/mi-dia/gestiones') {
    for (const o of ops) {
      const b = o.body ? leer(o) : {};
      let m;
      if (o.method === 'POST' && o.url === '/api/mi-dia/vacaciones' && Array.isArray(datos.solicitudes)) {
        datos.solicitudes.unshift({ id: o.local, desde: b.desde, hasta: b.hasta, dias: null, estado: 'pendiente_ops', notas: b.notas, sin_enviar: true });
      } else if (o.method === 'POST' && o.url === '/api/mi-dia/ausencias' && Array.isArray(datos.avisos)) {
        datos.avisos.unshift({ id: o.local, aviso_motivo: b.motivo, desde: b.desde, hasta: b.hasta || b.desde, hora_desde: b.hora_desde ?? null, hora_hasta: b.hora_hasta ?? null,
          justificante: 'pendiente', archivos: (b.archivos || []).map((id) => ({ id })), avisado_en: new Date(o.creado).toISOString(), sin_enviar: true });
      } else if (o.method === 'DELETE' && (m = /\/api\/mi-dia\/(vacaciones|ausencias)\/(-?\d+)$/.exec(o.url))) {
        const k = m[1] === 'vacaciones' ? 'solicitudes' : 'avisos';
        if (Array.isArray(datos[k])) datos[k] = datos[k].filter((x) => x.id !== Number(m[2]));
      } else if ((m = /\/api\/mi-dia\/ausencias\/(-?\d+)\/justificante$/.exec(o.url))) {
        for (const k of ['avisos', 'justificantes_pendientes']) {
          const a = (datos[k] || []).find((x) => x.id === Number(m[1]));
          if (a) a.archivos = [...(a.archivos || []), ...(b.archivos || []).map((id) => ({ id }))];
        }
      }
    }
  }
  if (path === '/api/mi-dia/perfil') {
    const ult = [...ops].reverse().find((o) => o.url === '/api/mi-dia/perfil');
    if (ult) { datos.datos = { ...(datos.datos || {}), ...leer(ult) }; datos.sin_enviar = true; }
  }
  if (path === '/api/mi-dia/capacidades' && Array.isArray(datos.capacidades || datos)) {
    const lista = Array.isArray(datos) ? datos : datos.capacidades;
    for (const o of ops) {
      const m = /\/api\/mi-dia\/capacidades\/(\d+)$/.exec(o.url);
      if (!m) continue;
      const b = leer(o); const k = lista.find((x) => x.id === Number(m[1]));
      if (k) k.estado = b.sabe === false || b.marcar === false ? null : (k.estado === 'validada' ? 'validada' : 'propuesta');
    }
  }
  if (path === '/api/material/circuito' && Array.isArray(datos.lineas)) {
    for (const o of ops) {
      const m = /\/api\/escandallo\/(\d+)\/(stock|recibir)$/.exec(o.url);
      if (!m) continue;
      const l = datos.lineas.find((x) => x.id === Number(m[1]));
      if (!l) continue;
      const b = leer(o);
      l.estado = m[2] === 'recibir' ? 'recibido' : Number(String(b.stock).replace(',', '.')) >= Number(l.cantidad) ? 'en_stock' : 'por_pedir';
      l.sin_enviar = true;
    }
  }
  if (path === '/api/supervision/recibir' && Array.isArray(datos.envios)) {
    for (const o of ops) {
      const m = /\/api\/envios\/(\d+)\/recibir$/.exec(o.url);
      const e = m && datos.envios.find((x) => x.id === Number(m[1]));
      if (!e) continue;
      for (const l of leer(o).lineas || []) {
        const x = e.lineas.find((y) => y.id === Number(l.id));
        if (x && l.recibido) { x.recibido_en = x.recibido_en || 'sin enviar'; x.bultos_recibidos = l.bultos ?? x.bultos_recibidos; }
      }
    }
    const piezas = new Set(ops.map((o) => /\/api\/tareas\/(\d+)\/recibir-pieza$/.exec(o.url)).filter(Boolean).map((m) => Number(m[1])));
    if (Array.isArray(datos.piezas)) datos.piezas = datos.piezas.filter((p) => !piezas.has(p.id));
  }
  if (path === '/api/compras-locales' && Array.isArray(datos.compras)) {
    const decididas = new Set(ops.map((o) => /\/api\/compras-locales\/(\d+)\/decidir$/.exec(o.url)).filter(Boolean).map((m) => Number(m[1])));
    datos.compras = datos.compras.filter((c) => !(c.estado === 'pendiente' && decididas.has(c.id)));
  }
  if (path === '/api/capturas/mias' && Array.isArray(datos.capturas)) {
    for (const o of ops) {
      if (o.method === 'POST' && o.url === '/api/capturas') {
        const b = leer(o);
        datos.capturas.unshift({ id: o.local, texto: b.texto, categoria: b.categoria, estado: 'bandeja', creado: new Date(o.creado).toISOString(), archivos: [], sin_enviar: true });
      }
    }
  }
  if (path === '/api/compras-locales/mias' && Array.isArray(datos.compras)) {
    for (const o of ops) {
      const b = o.body ? leer(o) : {};
      let m;
      if (o.url === '/api/compras-locales/nueva') {
        datos.compras.unshift({ id: o.local, codigo: 'sin enviar', estado: 'pendiente', que: b.que, importe_aprox: b.importe_aprox ? Number(b.importe_aprox) : null,
          para: b.para, tarea_id: b.tarea_id, tienda_nombre: b.tienda || '', archivos: [], creado: new Date(o.creado).toISOString(), sin_enviar: true });
      } else if ((m = /\/api\/compras-locales\/(\d+)\/(ticket|anular)$/.exec(o.url))) {
        const c = datos.compras.find((x) => x.id === Number(m[1]));
        if (c && m[2] === 'ticket') Object.assign(c, { estado: 'comprada', importe_real: Number(String(b.importe_real).replace(',', '.')), num_albaran: b.num_albaran, sin_enviar: true });
        if (c && m[2] === 'anular') Object.assign(c, { estado: 'anulada', sin_enviar: true });
      }
    }
  }
  return datos;
}

/* ---------- peticiones ---------- */
self.addEventListener('fetch', (e) => {
  const r = e.request;
  const url = new URL(r.url);
  if (url.origin !== self.location.origin) return;

  // «Compartir › Planéalo» desde otra app (Android): se guarda lo compartido y se abre Capturar, que lo recoge
  if (r.method === 'POST' && url.pathname === '/compartir') {
    e.respondWith((async () => {
      try {
        const fd = await r.formData(); const c = await caches.open('planealo-compartido'); let i = 0;
        const t = [fd.get('title'), fd.get('text'), fd.get('url')].filter((x) => x && typeof x === 'string').join('\n');
        if (t) await c.put('/compartido/texto', new Response(t));
        for (const f of fd.getAll('archivos')) {
          if (!f || typeof f === 'string' || !f.size) continue;
          await c.put(`/compartido/${Date.now()}-${i++}`, new Response(f, { headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name || 'archivo') } }));
        }
      } catch { /* sin archivos: se abre Capturar igualmente */ }
      return Response.redirect('/mi-dia.html?vista=capturar&compartido=1', 303);
    })());
    return;
  }
  // apuntar algo: a la red; si no hay red (o ya hay cosas en la bandeja, para no cambiar el orden), a la bandeja
  if (r.method !== 'GET') {
    if (url.pathname === '/api/logout') { e.waitUntil(caches.delete(DATOS)); return; }
    if (!enCola(r.method, url.pathname)) return;
    e.respondWith((async () => {
      const yo = await leerUsuario();
      const ops = (await todos('ops').catch(() => [])).filter((o) => o.usuario == null || o.usuario === yo);
      if (ops.length) { const x = await encolar(r, url); vaciar(); return x; }
      const copia = r.clone();
      try {
        const resp = await fetch(r);
        return resp;
      } catch {
        return encolar(copia, url);
      }
    })());
    return;
  }

  // datos de la app del móvil
  if (url.pathname.startsWith('/api/')) {
    if (!GET_GUARDAR.test(url.pathname)) return;
    e.respondWith((async () => {
      const cache = await caches.open(DATOS);
      const clave = url.pathname + url.search;
      const red = fetch(r).then(async (resp) => {
        if (resp.ok) {
          const cuerpo = await resp.clone().arrayBuffer();
          const cab = { headers: { 'Content-Type': 'application/json', 'X-Guardado': String(Date.now()) } };
          await cache.put(clave, new Response(cuerpo, cab));
          // Mi día sin «?fecha=» es hoy: se guarda también con su fecha (y al revés), para encontrarlo se pida como se pida
          if (url.pathname === '/api/mi-dia') {
            try {
              const f = JSON.parse(new TextDecoder().decode(cuerpo)).fecha;
              if (f) await cache.put(`/api/mi-dia?fecha=${f}`, new Response(cuerpo, cab));
              if (f && f === JSON.parse(new TextDecoder().decode(cuerpo)).hoy) await cache.put('/api/mi-dia', new Response(cuerpo, cab));
            } catch { /* */ }
          }
          vaciar();
        }
        return resp;
      });
      let resp;
      try {
        resp = await conTiempo(red, ESPERA_DATOS);
        avisar({ tipo: 'en_linea' });
      } catch {
        resp = await cache.match(clave);
        if (!resp) {
          try { resp = await red; } catch { return json({ error: url.pathname.includes('previa') ? 'Sin conexión: los días se calcularán al enviarlo' : 'Sin conexión y sin datos guardados en este móvil todavía' }, 503); }
        } else {
          avisar({ tipo: 'sin_red', guardado: Number(resp.headers.get('X-Guardado')) || null });
          red.catch(() => {});
        }
      }
      // lo que hay en la bandeja de salida, ya aplicado
      if (resp.ok && /^\/api\/(mi-dia|mi-dia\/(gestiones|perfil|capacidades)|compras-locales|compras-locales\/mias|material\/circuito|capturas\/mias)$/.test(url.pathname)) {
        const datos = await resp.clone().json().catch(() => null);
        const ops = await todos('ops').catch(() => []);
        if (datos && ops.length) return json(await superponer(url.pathname, datos), 200, { 'X-Guardado': resp.headers.get('X-Guardado') || '' });
      }
      return resp;
    })());
    return;
  }

  // pantallas
  if (r.mode === 'navigate') {
    const app = PAGINAS.includes(url.pathname);
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const red = fetch(r).then((resp) => { if (resp.ok && app) c.put(url.pathname, resp.clone()); return resp; });
      try { return await conTiempo(red, app ? ESPERA_DATOS : 15000); } catch {
        if (app) { const g = await c.match(url.pathname); if (g) { red.catch(() => {}); return g; } }
        try { return await red; } catch { return (await c.match(OFFLINE)) || new Response('Sin conexión', { status: 503 }); }
      }
    })());
    return;
  }

  // código y estilos con versión: no cambian, del móvil (y se guardan la primera vez)
  if (url.search.includes('v=') && /\.(js|css)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const g = await c.match(r);
      if (g) return g;
      const resp = await fetch(r);
      if (resp.ok) c.put(r, resp.clone());
      return resp;
    })());
    return;
  }
  // iconos y logos: lo guardado y se renueva por detrás
  if (/\.(png|svg|webmanifest)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const c = await caches.open(SHELL);
      const g = await c.match(r);
      const red = fetch(r).then((resp) => { if (resp.ok) c.put(r, resp.clone()); return resp; }).catch(() => null);
      return g || (await red) || new Response('', { status: 504 });
    })());
  }
});

/* ---------- avisos (push): se enseñan aunque la app esté cerrada ---------- */
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titulo: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.titulo || 'Planéalo', {
    body: d.cuerpo || '', icon: '/icono-192-v2.png', badge: '/insignia-96.png', tag: d.tag || undefined, renotify: !!d.tag,
    data: { url: d.url || '/inicio.html' }, lang: 'es',
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL(e.notification.data?.url || '/inicio.html', self.location.origin).href;
  e.waitUntil((async () => {
    const ventanas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const misma = ventanas.find((v) => new URL(v.url).origin === self.location.origin);
    if (misma) { await misma.focus(); return misma.navigate(url).catch(() => self.clients.openWindow(url)); }
    return self.clients.openWindow(url);
  })());
});
