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
  window.s360pwa = { instalada, esIOS, boton: (caja) => { if (!caja) return; cajas.add(caja); pintar(caja); } };
})();
