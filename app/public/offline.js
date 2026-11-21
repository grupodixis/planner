// Sin conexión (app del móvil): barra de estado y bandeja de salida.
//  · Le dice al service worker quién usa el móvil (para enviar lo apuntado con su sesión).
//  · Enseña «📴 Sin conexión · datos de las 07:42 · 2 por enviar», «✔ Enviado» y lo que el servidor no aceptó.
//  · Con red, deja guardado lo de mañana y el mes para poder verlo luego sin cobertura.
(() => {
  'use strict';
  if (!('serviceWorker' in navigator)) return;
  const barra = document.createElement('div');
  barra.className = 'sin-red';
  barra.setAttribute('role', 'status');
  barra.hidden = true;
  document.addEventListener('DOMContentLoaded', () => document.body.prepend(barra));

  let st = { sinRed: false, guardado: null, pendientes: 0, fallidos: [], otros: 0 };
  const hora = (t) => new Date(t).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const dia = (t) => {
    const d = new Date(t); const hoy = new Date();
    return d.toDateString() === hoy.toDateString() ? hora(t) : `${d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })} ${hora(t)}`;
  };
  function pintar() {
    const partes = [];
    if (st.sinRed) partes.push(`📴 Sin conexión${st.guardado ? ` · datos de las ${dia(st.guardado)}` : ''}`);
    if (st.pendientes) partes.push(`⏳ ${st.pendientes} ${st.pendientes === 1 ? 'cosa' : 'cosas'} por enviar${st.sinRed ? ' (se envía sola al volver la cobertura)' : '…'}`);
    const hijos = partes.length ? [document.createTextNode(partes.join(' · '))] : [];
    for (const f of st.fallidos) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = 'Vale';
      b.onclick = () => navigator.serviceWorker.controller?.postMessage({ tipo: 'descartar', n: f.n });
      const p = document.createElement('div');
      p.className = 'sin-red-fallo';
      p.append(`⚠ No se pudo enviar algo apuntado sin conexión: ${f.error} `, b);
      hijos.push(p);
    }
    barra.replaceChildren(...hijos);
    barra.hidden = !hijos.length;
    barra.classList.toggle('con-fallo', !!st.fallidos.length);
  }
  let tOk;
  function enviado(n) {
    clearTimeout(tOk);
    barra.hidden = false; barra.classList.add('ok');
    barra.textContent = `✔ Enviado lo que tenías pendiente (${n})`;
    tOk = setTimeout(() => { barra.classList.remove('ok'); pintar(); }, 3000);
    window.dispatchEvent(new CustomEvent('planealo:sincronizado'));
  }

  navigator.serviceWorker.addEventListener('message', (e) => {
    const m = e.data || {};
    if (m.tipo === 'sin_red') { st.sinRed = true; st.guardado = m.guardado; pintar(); }
    if (m.tipo === 'en_linea' && st.sinRed) { st.sinRed = false; pintar(); }
    if (m.tipo === 'estado') { st.pendientes = m.pendientes; st.fallidos = m.fallidos || []; st.otros = m.otros || 0; pintar(); }
    if (m.tipo === 'sincronizado') enviado(m.enviados);
    if (m.tipo === 'sesion') { st.fallidos = [{ n: -1, error: 'tu sesión ha caducado: vuelve a entrar para enviarlo' }]; pintar(); }
  });
  const pedir = (tipo, extra = {}) => navigator.serviceWorker.controller?.postMessage({ tipo, ...extra });
  window.addEventListener('online', () => { st.sinRed = false; pintar(); pedir('vaciar'); });
  window.addEventListener('offline', () => { st.sinRed = true; pintar(); });
  setInterval(() => { if (st.pendientes) pedir('vaciar'); }, 30000);

  navigator.serviceWorker.ready.then(async () => {
    // quién está usando el móvil
    try {
      const r = await fetch('/api/me', { credentials: 'same-origin' });
      if (r.ok) { const me = await r.json(); pedir('usuario', { id: me.id }); }
    } catch { /* sin red y sin copia */ }
    pedir('estado');
    if (!navigator.onLine) { st.sinRed = true; pintar(); }
    // con red: dejar guardado lo de los próximos días (una vez por hora)
    if (navigator.onLine && /mi-dia\.html/.test(location.pathname)) {
      let ult = 0;
      try { ult = Number(localStorage.getItem('planealo-precarga')) || 0; } catch { /* */ }
      if (Date.now() - ult > 3600e3) {
        setTimeout(async () => {
          const f = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }); };
          for (const u of [`/api/mi-dia?fecha=${f(1)}`, `/api/mi-dia?fecha=${f(0)}`, '/api/mi-dia/mes', '/api/mi-dia/gestiones', '/api/compras-locales/opciones', '/api/compras-locales/mias', '/api/capturas/opciones']) {
            await fetch(u, { credentials: 'same-origin' }).catch(() => {});
          }
          try { localStorage.setItem('planealo-precarga', String(Date.now())); } catch { /* */ }
        }, 4000);
      }
    }
  });
})();
