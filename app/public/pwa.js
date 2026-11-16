/* App instalable (PWA): registra el service worker y ofrece «Instalar la app».
   window.s360pwa.boton(caja): pone en «caja» el botón (Android/Chrome) o cómo hacerlo (iPhone). */
(() => {
  'use strict';
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  const instalada = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const esIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  let aviso = null;
  const cajas = new Set();
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); aviso = e; cajas.forEach(pintar); });
  window.addEventListener('appinstalled', () => { aviso = null; cajas.forEach(pintar); });

  function pintar(caja) {
    caja.replaceChildren();
    if (instalada()) return;
    if (aviso) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'pwa-instalar';
      b.textContent = '📲 Instalar la app';
      b.onclick = async () => { aviso.prompt(); await aviso.userChoice.catch(() => {}); aviso = null; cajas.forEach(pintar); };
      caja.append(b);
    } else if (esIOS()) {
      const p = document.createElement('p');
      p.className = 'pwa-ios';
      p.innerHTML = '📲 Para tenerla como app: pulsa <b>Compartir</b> <span aria-hidden="true">⬆︎</span> y luego <b>Añadir a pantalla de inicio</b>.';
      caja.append(p);
    }
  }
  /* ---------- Avisos (notificaciones push) ---------- */
  const puedeAvisar = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const b64 = (s) => { const p = '='.repeat((4 - (s.length % 4)) % 4); const r = atob((s + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map((c) => c.charCodeAt(0))); };
  async function jfetch(metodo, url, cuerpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }
  async function suscripcion() {
    if (!puedeAvisar()) return null;
    const reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }
  async function activar() {
    if (!puedeAvisar()) throw new Error(esIOS() && !instalada() ? 'En iPhone, primero instala la app (Compartir → Añadir a pantalla de inicio) y actívalos desde ella' : 'Este navegador no admite avisos');
    const permiso = await Notification.requestPermission();
    if (permiso !== 'granted') throw new Error('No has dado permiso para los avisos. Puedes darlo en los ajustes del navegador o del móvil.');
    const reg = await navigator.serviceWorker.ready;
    const { clave } = await jfetch('GET', '/api/push/clave');
    let s = await reg.pushManager.getSubscription();
    if (!s) s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(clave) });
    await jfetch('POST', '/api/push/suscribir', { suscripcion: s.toJSON() });
    await jfetch('POST', '/api/push/prueba').catch(() => {});
  }
  async function desactivar() {
    const s = await suscripcion();
    if (s) { await jfetch('DELETE', '/api/push/suscribir', { endpoint: s.endpoint }).catch(() => {}); await s.unsubscribe().catch(() => {}); }
  }
  // al entrar: si ya tiene permiso y suscripción, se renueva en el servidor (por si cambió de usuario)
  async function renovar() {
    try {
      const s = await suscripcion();
      if (s && Notification.permission === 'granted') await jfetch('POST', '/api/push/suscribir', { suscripcion: s.toJSON() });
    } catch { /* sin sesión todavía */ }
  }

  const avisosCajas = new Set();
  async function pintarAvisos(caja) {
    caja.replaceChildren();
    if (!puedeAvisar() || Notification.permission === 'denied') return;
    if (await suscripcion()) return;
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'pwa-instalar';
    b.textContent = '🔔 Activar avisos en este móvil';
    b.onclick = async () => {
      b.disabled = true;
      try { await activar(); avisosCajas.forEach(pintarAvisos); ultimoPaso(); } catch (e) { alert(e.message); b.disabled = false; }
    };
    caja.append(b);
  }

  /* ---------- Android: que no los corte el ahorro de batería ---------- */
  const esAndroid = () => /Android/i.test(navigator.userAgent);
  // Desde una web no se puede abrir directamente esa pantalla de ajustes: se explica en una línea, según la marca
  async function rutaBateria() {
    let modelo = '';
    try { modelo = (await navigator.userAgentData?.getHighEntropyValues(['model']))?.model || ''; } catch { /* sin datos */ }
    const ua = `${navigator.userAgent} ${modelo}`;
    if (/SM-|Samsung/i.test(ua)) return 'Ajustes › Aplicaciones › Chrome › Batería › <b>Sin restricciones</b>';
    if (/Redmi|POCO|Xiaomi|\bMi /i.test(ua)) return 'Ajustes › Aplicaciones › Chrome › Ahorro de batería › <b>Sin restricciones</b>';
    if (/HUAWEI|HONOR/i.test(ua)) return 'Ajustes › Batería › Inicio de aplicaciones › Chrome › <b>Gestionar manualmente</b> (todo activado)';
    if (/OPPO|CPH|realme|RMX|OnePlus/i.test(ua)) return 'Ajustes › Batería › Chrome › <b>Permitir actividad en segundo plano</b>';
    return 'Ajustes › Aplicaciones › Chrome › Batería › <b>Sin restricciones</b>';
  }
  async function consejoBateria() {
    return `<p class="av-bateria">🔋 Para que lleguen con la app cerrada: ${await rutaBateria()}.</p>`;
  }
  async function probarCerrada() {
    await jfetch('POST', '/api/push/prueba', { espera: 20 });
    alert('Cierra la app ahora. En 20 segundos te llegará un aviso de prueba.\nSi no llega, revisa el ajuste de batería.');
  }
  // justo después de activarlos en Android: el último paso, breve
  async function ultimoPaso() {
    if (!esAndroid()) return;
    const d = document.createElement('dialog');
    d.className = 'dlg-pregunta dlg-avisos';
    d.innerHTML = `<h2>Un último paso</h2>${await consejoBateria()}
      <div class="acciones"><button type="button" class="ghost" data-a="cerrar">Ya está</button>
      <button type="button" class="primario" data-a="probar">Probar con la app cerrada</button></div>`;
    d.addEventListener('click', async (ev) => {
      const a = ev.target.dataset?.a;
      if (!a) return;
      if (a === 'probar') await probarCerrada().catch((e) => alert(e.message));
      d.close(); d.remove();
    });
    document.body.append(d);
    d.showModal();
  }

  // Diálogo: qué avisos quiero y horas de silencio
  async function ajustes() {
    let p;
    try { p = await jfetch('GET', '/api/push/preferencias'); } catch (e) { alert(e.message); return; }
    const activa = !!(await suscripcion().catch(() => null));
    const d = document.createElement('dialog');
    d.className = 'dlg-pregunta dlg-avisos';
    d.setAttribute('aria-labelledby', 'avisos-tit');
    const horas = (sel) => Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === sel ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
    const sil = p.silencio;
    d.innerHTML = `
      <h2 id="avisos-tit">Avisos</h2>
      <p class="ayuda">${activa ? '🔔 Activados en este dispositivo.' : 'Desactivados en este dispositivo.'} ${p.dispositivos ? `Los recibes en ${p.dispositivos} dispositivo(s).` : ''}</p>
      <fieldset><legend>Quiero que me avisen de…</legend>
        ${p.tipos.map((t) => `<label class="av-tipo"><input type="checkbox" value="${t.clave}"${t.activo ? ' checked' : ''}> ${t.texto}</label>`).join('')}
      </fieldset>
      <fieldset><legend>Horas de silencio</legend>
        <label class="av-tipo"><input type="checkbox" id="av-sil"${sil ? ' checked' : ''}> No avisar de</label>
        <span class="av-sil"><select id="av-desde" aria-label="Desde">${horas(sil ? sil.desde : 21)}</select> a <select id="av-hasta" aria-label="Hasta">${horas(sil ? sil.hasta : 7)}</select></span>
        <p class="ayuda">Las averías y la seguridad avisan siempre.</p>
      </fieldset>
      ${activa && esAndroid() ? `<details class="av-cerrada"><summary>¿No te llegan con la app cerrada?</summary>${await consejoBateria()}
        <button type="button" class="ghost" data-a="prueba-cerrada">Probar con la app cerrada</button></details>` : ''}
      <div class="acciones">
        ${activa ? '<button type="button" class="ghost" data-a="prueba">Enviar prueba</button><button type="button" class="ghost" data-a="quitar">Desactivar aquí</button>' : '<button type="button" class="ghost" data-a="activar">Activar aquí</button>'}
        <button type="button" class="ghost" data-a="cerrar">Cancelar</button>
        <button type="button" class="primario" data-a="guardar">Guardar</button>
      </div>`;
    const cerrar = () => { d.close(); d.remove(); };
    d.addEventListener('cancel', (ev) => { ev.preventDefault(); cerrar(); });
    d.addEventListener('click', async (ev) => {
      const a = ev.target.dataset?.a;
      if (!a) return;
      try {
        if (a === 'cerrar') return cerrar();
        if (a === 'prueba') { const r = await jfetch('POST', '/api/push/prueba'); alert(r.enviados ? 'Enviado: debería llegarte en unos segundos.' : 'No se ha podido enviar (¿estás en horas de silencio o lo tienes desactivado?)'); return; }
        if (a === 'quitar') { await desactivar(); cerrar(); avisosCajas.forEach(pintarAvisos); return; }
        if (a === 'activar') { await activar(); cerrar(); avisosCajas.forEach(pintarAvisos); ultimoPaso(); return; }
        if (a === 'prueba-cerrada') { await probarCerrada(); cerrar(); return; }
        if (a === 'guardar') {
          const off = [...d.querySelectorAll('fieldset input[type=checkbox][value]')].filter((i) => !i.checked).map((i) => i.value);
          const silencio = d.querySelector('#av-sil').checked ? { desde: Number(d.querySelector('#av-desde').value), hasta: Number(d.querySelector('#av-hasta').value) } : null;
          await jfetch('PUT', '/api/push/preferencias', { off, silencio });
          cerrar();
        }
      } catch (e) { alert(e.message); }
    });
    document.body.append(d);
    d.showModal();
  }

  window.s360pwa = {
    instalada, esIOS, boton: (caja) => { if (!caja) return; cajas.add(caja); pintar(caja); },
    avisos: (caja) => { if (!caja) return; avisosCajas.add(caja); pintarAvisos(caja); },
    ajustes, activar, renovar, ultimoPaso,
  };
})();
