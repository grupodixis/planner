/* Entrar con PIN (operarios) desde un móvil o tablet autorizados */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat()) if (h != null && h !== false) n.append(h);
    return n;
  };
  const pasos = ['quien', 'pin', 'no', 'alta'];
  const ver = (p) => pasos.forEach((x) => { $(`#paso-${x}`).hidden = x !== p; });

  async function api(metodo, url, cuerpo) {
    const r = await fetch(url, { method: metodo, headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(d.error || `Error ${r.status}`), { status: r.status });
    return d;
  }

  let persona = null, pin = '', disp = null, enviando = false;

  function pintarPuntos() {
    [...$('#puntos').children].forEach((s, i) => s.classList.toggle('lleno', i < pin.length));
    $('#puntos').setAttribute('aria-label', `PIN: ${pin.length} de 4 cifras`);
  }

  function elegir(p) {
    persona = p; pin = '';
    $('#pin-hola').textContent = `Hola, ${p.nombre.split(' ')[0]}`;
    $('#err').textContent = '';
    $('#volver').hidden = disp.tipo !== 'comun';
    pintarPuntos();
    ver('pin');
  }

  async function tecla(t) {
    if (enviando) return;
    $('#err').textContent = '';
    if (t === '⌫') pin = pin.slice(0, -1);
    else if (pin.length < 4) pin += t;
    pintarPuntos();
    if (pin.length < 4) return;
    enviando = true;
    try {
      await api('POST', '/api/pin/entrar', { usuario_id: persona.id, pin });
      location.replace('/mi-dia.html');
    } catch (e) {
      pin = ''; pintarPuntos();
      $('#err').textContent = e.message;
      $('#puntos').classList.add('mal');
      setTimeout(() => $('#puntos').classList.remove('mal'), 400);
    } finally { enviando = false; }
  }

  function teclado() {
    const teclas = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
    $('#teclado').replaceChildren(...teclas.map((t) => (t
      ? el('button', { type: 'button', class: t === '⌫' ? 'borrar' : '', 'aria-label': t === '⌫' ? 'Borrar' : t, onclick: () => tecla(t) }, t)
      : el('span'))));
    document.addEventListener('keydown', (ev) => {
      if ($('#paso-pin').hidden) return;
      if (/^\d$/.test(ev.key)) tecla(ev.key);
      else if (ev.key === 'Backspace') tecla('⌫');
    });
    $('#volver').onclick = () => { persona = null; ver('quien'); };
  }

  async function init() {
    teclado();
    const q = new URLSearchParams(location.search);
    // abrir el enlace de alta en el móvil del operario
    if (q.get('alta')) {
      ver('alta');
      $('#alta-txt').textContent = 'Autorizando este móvil…';
      try {
        const r = await api('POST', '/api/pin/alta-movil', { token: q.get('alta') });
        history.replaceState(null, '', '/pin.html');
        $('#alta-txt').textContent = `Listo, ${r.nombre}: este móvil ya puede entrar con tu PIN.`;
      } catch (e) {
        $('#alta-txt').textContent = e.message;
        return;
      }
    }
    try { disp = await api('GET', '/api/pin/dispositivo'); } catch { ver('no'); return; }
    $('#disp').textContent = disp.nombre;
    if (!disp.personas.length) { ver('no'); $('#paso-no p').textContent = 'Nadie tiene PIN en este dispositivo todavía.'; return; }
    if (disp.personas.length === 1 && disp.tipo === 'personal') return elegir(disp.personas[0]);
    $('#personas').replaceChildren(...disp.personas.map((p) => el('button', { type: 'button', onclick: () => elegir(p) }, p.nombre)));
    ver('quien');
  }
  init();
})();
