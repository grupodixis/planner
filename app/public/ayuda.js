/* Ayuda de s360: botón «?» con el panel de la pantalla, recorridos «hazlo conmigo» y «Novedades».
   Los textos están en ayuda-textos.js (window.S360_AYUDA). Las pantallas solo marcan sus elementos con
   data-ayuda="…"; los pasos de los recorridos apuntan a esas marcas (o a un selector CSS). */
(() => {
  'use strict';
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const T = () => window.S360_AYUDA || { pantallas: {}, novedades: [] };
  const pantalla = () => T().pantallas[location.pathname === '/index.html' ? '/' : location.pathname] || null;
  let permisos = null; // Mi día pasa los suyos (no usa la cabecera común)
  const puede = (p) => !p || [].concat(p).some((x) => (permisos ? permisos.includes(x) : window.s360?.tiene?.(x)));

  // lo visto se guarda en este navegador (si no se puede, se vuelve a ofrecer: no pasa nada)
  const CLAVE = 's360-ayuda';
  const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || '{}') || {}; } catch { return {}; } };
  const guardar = (f) => { const s = leer(); f(s); try { localStorage.setItem(CLAVE, JSON.stringify(s)); } catch { /* sin almacenamiento */ } };

  /* ---------------- Voz: lee la ayuda en voz alta (síntesis del propio navegador, sin servicios externos) ---------------- */
  const voz = (() => {
    const ok = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;
    const S = ok ? window.speechSynthesis : null;
    let cola = [], alTerminar = null, gen = 0;
    const pref = () => ({ vel: 1, auto: false, nombre: '', ...(leer().voz || {}) });
    const ponerPref = (cambios) => guardar((x) => { x.voz = { ...pref(), ...cambios }; });
    const voces = () => (S ? S.getVoices().filter((v) => /^es([-_]|$)/i.test(v.lang)) : []);
    const elegida = () => {
      const vs = voces(); const p = pref();
      return vs.find((v) => v.name === p.nombre) || vs.find((v) => /es[-_]ES/i.test(v.lang) && /google|natural|online|neural|helena|lucia|monica|paulina/i.test(v.name))
        || vs.find((v) => /es[-_]ES/i.test(v.lang)) || vs[0] || null;
    };
    if (S) S.addEventListener?.('voiceschanged', () => {});
    // HTML de la ayuda → texto que suena bien (sin etiquetas, emojis ni flechas)
    const limpiar = (html) => {
      const d = document.createElement('div'); d.innerHTML = String(html || '');
      return d.textContent
        .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, ' ')
        .replace(/\s*[→›]\s*/g, ', ').replace(/@(?=\s|$|[,.;])/g, ' arroba ').replace(/[«»"“”]/g, '').replace(/\s*·\s*/g, ', ')
        .replace(/\bp\. ej\./gi, 'por ejemplo').replace(/\bnº\b/gi, 'número').replace(/\s+/g, ' ').trim();
    };
    // trozos de una o pocas frases (Chrome corta las locuciones muy largas)
    const trozos = (t) => (t.match(/[^.!?;:]+[.!?;:]*/g) || [t]).reduce((a, f) => {
      if (a.length && (a[a.length - 1] + f).length < 220) a[a.length - 1] += f; else a.push(f);
      return a;
    }, []).map((x) => x.trim()).filter(Boolean);
    function parar() { gen++; cola = []; if (S) S.cancel(); const f = alTerminar; alTerminar = null; f?.(false); }
    // partes: [{ texto (html), nodo? }] — se lee en orden; onParte(nodo) marca lo que suena
    function hablar(partes, { onParte, onFin } = {}) {
      if (!S) return;
      parar();
      const mio = ++gen;
      alTerminar = onFin || null;
      cola = partes.flatMap((p) => trozos(limpiar(p.texto)).map((t, i) => ({ t, nodo: i === 0 ? p.nodo : undefined })));
      const v = elegida(); const vel = pref().vel;
      const siguiente = () => {
        if (mio !== gen) return;
        const x = cola.shift();
        if (!x) { const f = alTerminar; alTerminar = null; f?.(true); return; }
        if (x.nodo !== undefined) onParte?.(x.nodo);
        const u = new SpeechSynthesisUtterance(x.t);
        u.lang = v?.lang || 'es-ES'; if (v) u.voice = v; u.rate = vel;
        u.onend = siguiente; u.onerror = (e) => { if (e.error !== 'interrupted' && e.error !== 'canceled') siguiente(); };
        S.speak(u);
      };
      siguiente();
    }
    const pausar = () => S?.pause(); const seguir = () => S?.resume();
    const hablando = () => !!S && (S.speaking || cola.length > 0);
    const enPausa = () => !!S && S.paused;
    addEventListener('pagehide', parar);
    return { ok, hablar, parar, pausar, seguir, hablando, enPausa, voces, elegida, pref, ponerPref };
  })();

  // barra «Escuchar» del panel: leer todo, pausa, parar, velocidad y voz
  function barraVoz(partes) {
    if (!voz.ok) return null;
    const btn = el('button', { type: 'button', class: 'ay-voz-btn primario', 'aria-label': 'Escuchar esta ayuda' }, '🔊 Escuchar');
    const stop = el('button', { type: 'button', class: 'ghost mini', 'aria-label': 'Parar la lectura', hidden: true }, '⏹');
    const marcar = (n) => { panel?.querySelectorAll('.ay-leyendo').forEach((x) => x.classList.remove('ay-leyendo')); if (n) { n.classList.add('ay-leyendo'); n.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } };
    const estado = (txt, parado) => { btn.textContent = txt; stop.hidden = parado; if (parado) marcar(null); };
    btn.addEventListener('click', () => {
      if (voz.hablando() && !voz.enPausa()) { voz.pausar(); estado('▶ Seguir', false); return; }
      if (voz.enPausa()) { voz.seguir(); estado('⏸ Pausa', false); return; }
      estado('⏸ Pausa', false);
      voz.hablar(partes(), { onParte: marcar, onFin: () => estado('🔊 Escuchar', true) });
    });
    stop.addEventListener('click', () => { voz.parar(); estado('🔊 Escuchar', true); });
    const p = voz.pref();
    const vel = el('select', { 'aria-label': 'Velocidad de la voz', title: 'Velocidad', onchange: (ev) => voz.ponerPref({ vel: Number(ev.target.value) }) },
      [[0.85, 'lenta'], [1, 'normal'], [1.2, 'rápida'], [1.4, 'muy rápida']].map(([v, t]) => el('option', { value: v, selected: v === p.vel ? true : null }, t)));
    const selVoz = el('select', { 'aria-label': 'Voz', title: 'Voz', onchange: (ev) => voz.ponerPref({ nombre: ev.target.value }) });
    const llenar = () => {
      const vs = voz.voces(); const yo = voz.elegida()?.name;
      selVoz.replaceChildren(...vs.map((v) => el('option', { value: v.name, selected: v.name === yo ? true : null }, `${v.name.replace(/^(Microsoft|Google)\s*/i, '').replace(/\s*\(.*\)$/, '')} · ${v.lang}`)));
      selVoz.hidden = vs.length < 2;
    };
    llenar();
    window.speechSynthesis.addEventListener?.('voiceschanged', llenar);
    return el('div', { class: 'ay-voz' }, btn, stop, el('span', { class: 'ay-voz-op' }, vel, selVoz));
  }

  /* ---------------- Panel «?» ---------------- */
  let panel = null;
  function abrirPanel() {
    const p = pantalla();
    if (!p) return;
    cerrarPanel();
    const tours = (p.recorridos || []).filter((r) => puede(r.si));
    const secciones = (p.secciones || []).filter((s) => puede(s.si));
    const novs = novedadesDe(true);
    // lo que se lee en voz alta, en el orden del panel (cada parte marca su bloque mientras suena)
    const partesVoz = () => {
      const c = panel?.querySelector('.ay-cuerpo');
      const out = [{ texto: `${p.titulo}. ${p.para_que}`, nodo: c?.querySelector('.ay-para') }];
      if (p.esquema) out.push({ texto: `${p.esquema.titulo}: ${p.esquema.pasos.map((x, i) => `${i + 1}, ${x.que}, ${x.quien}.`).join(' ')}`, nodo: c?.querySelector('.ay-sec-esquema') });
      c?.querySelectorAll('.ay-sec').forEach((n) => out.push({ texto: [...n.querySelectorAll('h3, li, dt, dd, p')].map((x) => x.innerHTML.replace(/<\/?b>/g, '')).map((t) => (/[.!?:]$/.test(t.replace(/<[^>]+>/g, '').trim()) ? t : `${t}.`)).join(' '), nodo: n }));
      return out;
    };
    panel = el('aside', { class: 'ay-panel', role: 'dialog', 'aria-modal': 'false', 'aria-labelledby': 'ay-tit' },
      el('div', { class: 'ay-cab' },
        el('h2', { id: 'ay-tit' }, el('span', { class: 'ay-ico', 'aria-hidden': 'true' }, '?'), p.titulo),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar ayuda', onclick: cerrarPanel }, '✕')),
      barraVoz(partesVoz),
      el('div', { class: 'ay-cuerpo' },
        el('p', { class: 'ay-para' }, p.para_que),
        tours.length ? el('div', { class: 'ay-tours' }, tours.map((r) => el('button', {
          type: 'button', class: 'ay-tour-btn', onclick: () => { cerrarPanel(); recorrido(r); },
        }, el('b', {}, `▶ ${r.titulo}`), el('small', {}, `${r.pasos.length} pasos · ${r.duracion || '1 min'}${r.conmigo ? ' · lo haces tú' : ''}`)))) : null,
        p.video ? el('figure', { class: 'ay-video' },
          el('button', { type: 'button', class: 'ay-video-btn', title: 'Ver en grande', onclick: () => verVideo(p.video) },
            el('video', { src: p.video.src, poster: p.video.poster || null, autoplay: true, muted: true, loop: true, playsinline: true, preload: 'metadata', 'aria-label': p.video.texto }),
            el('span', { class: 'ay-video-zoom', 'aria-hidden': 'true' }, '⤢')),
          el('figcaption', {}, p.video.texto)) : null,
        p.esquema ? el('section', { class: 'ay-sec-esquema' }, el('h3', {}, p.esquema.titulo), esquema(p.esquema)) : null,
        ...secciones.map((s) => el('section', { class: 'ay-sec' },
          el('h3', {}, s.titulo),
          s.pasos ? el('ol', { class: 'ay-pasos' }, s.pasos.map((t) => el('li', { html: t }))) : null,
          s.terminos ? el('dl', { class: 'ay-terminos' }, s.terminos.flatMap(([t, d]) => [el('dt', { html: t }), el('dd', { html: d })])) : null,
          s.texto ? el('p', { html: s.texto }) : null)),
        novs.length ? el('section', {}, el('h3', {}, 'Novedades'),
          el('ul', { class: 'ay-novs' }, novs.slice(0, 4).map((n) => el('li', {}, el('small', {}, fechaTxt(n.fecha)), ' ', el('span', { html: n.texto })))),
          el('button', { type: 'button', class: 'ghost mini', onclick: () => { cerrarPanel(); mostrarNovedades(true); } }, 'Ver todas')) : null));
    document.body.append(panel);
    panel.querySelector('.ay-cab button').focus();
    document.addEventListener('keydown', escPanel);
  }
  function cerrarPanel() { if (panel) voz.parar(); panel?.remove(); panel = null; document.removeEventListener('keydown', escPanel); }
  function escPanel(ev) { if (ev.key === 'Escape') cerrarPanel(); }

  // el vídeo en grande, con controles para pararlo o ir atrás
  function verVideo(v) {
    const d = el('dialog', { class: 'ay-video-grande', 'aria-label': v.texto },
      el('video', { src: v.src, autoplay: true, muted: true, loop: true, playsinline: true, controls: true }),
      el('div', { class: 'acciones' }, el('span', { class: 'ayuda' }, v.texto), el('button', { type: 'button', class: 'primario', onclick: () => d.close() }, 'Cerrar')));
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', (ev) => { if (ev.target === d) d.close(); });
    document.body.append(d);
    d.showModal();
  }

  // esquema del circuito: cajas en fila (en el móvil, en columna) con quién hace cada paso
  function esquema(e) {
    return el('ol', { class: 'ay-esquema', 'aria-label': e.titulo }, e.pasos.map((p, i) => el('li', { class: p.aqui ? 'aqui' : '' },
      el('span', { class: 'ay-esq-n' }, String(i + 1)),
      el('b', {}, p.que), el('small', {}, p.quien),
      p.aqui ? el('em', {}, 'esta pantalla') : null)));
  }

  /* ---------------- Recorridos ---------------- */
  let tour = null;
  function recorrido(r) {
    finTour(false);
    const capa = el('div', { class: 'ay-capa', 'aria-hidden': 'true' },
      ...['t', 'r', 'b', 'l'].map((k) => el('div', { class: `ay-velo ay-velo-${k}` })),
      el('div', { class: 'ay-foco' }));
    const burbuja = el('div', { class: 'ay-burbuja', role: 'dialog', 'aria-live': 'polite', 'aria-label': r.titulo });
    document.body.append(capa, burbuja);
    tour = { r, i: 0, capa, burbuja, objetivo: null, quitar: [] };
    document.addEventListener('keydown', escTour, true);
    const bucle = () => { if (!tour) return; colocar(); tour.raf = requestAnimationFrame(bucle); };
    tour.raf = requestAnimationFrame(bucle);
    paso(0);
  }
  function escTour(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); finTour(true); } }
  const selDe = (p) => (p.sel ? (p.sel.startsWith('#') || p.sel.startsWith('.') || p.sel.includes('[') ? p.sel : `[data-ayuda="${p.sel}"]`) : null);
  const visible = (n) => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  async function buscar(p) {
    const s = selDe(p);
    if (!s) return null;
    for (let t = 0; t < 6; t++) {
      const n = [...document.querySelectorAll(s)].find(visible);
      if (n) return n;
      await new Promise((ok) => setTimeout(ok, 100));
    }
    return null;
  }
  async function paso(i) {
    if (!tour) return;
    for (const f of tour.quitar) f();
    tour.quitar = [];
    const pasos = tour.r.pasos;
    if (i >= pasos.length) { finTour(true); return; }
    tour.i = i;
    const p = pasos[i];
    // mientras se busca el elemento, la burbuja anterior no se puede pulsar (evita saltos dobles)
    tour.burbuja.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    const n = await buscar(p);
    if (!tour || tour.i !== i) return;
    // lo que no está en pantalla (o ya está hecho) se salta
    if ((p.sel && !n) || (n && p.saltar_si && p.saltar_si(n))) {
      // para la comprobación automática (herramientas/ayuda/comprobar.js)
      (window.__ayudaSaltos ||= []).push({ tour: tour.r.id, paso: i + 1, motivo: n ? 'ya-hecho' : 'no-esta', opcional: !!p.opcional, sel: p.sel });
      paso(i + 1); return;
    }
    tour.objetivo = n;
    if (n) n.scrollIntoView({ block: n.getBoundingClientRect().height > innerHeight * 0.6 ? 'start' : 'center', behavior: 'smooth' });
    const espera = n ? p.esperar || null : null;
    const sig = () => paso(i + 1);
    if (espera === 'click') {
      const f = (ev) => { if (n.contains(ev.target)) setTimeout(sig, 450); };
      document.addEventListener('click', f, true);
      tour.quitar.push(() => document.removeEventListener('click', f, true));
    } else if (espera === 'escribir') {
      let t;
      const f = () => { clearTimeout(t); if (n.value.trim()) t = setTimeout(sig, 1000); };
      n.addEventListener('input', f);
      tour.quitar.push(() => { clearTimeout(t); n.removeEventListener('input', f); });
      setTimeout(() => n.focus(), 350);
    }
    tour.capa.classList.toggle('sin-foco', !n);
    tour.capa.classList.toggle('libre', !!espera); // si lo tiene que hacer él, el elemento se puede pulsar
    tour.burbuja.replaceChildren(...[
      el('div', { class: 'ay-b-cab' },
        el('small', {}, `${tour.r.titulo} · ${i + 1} de ${pasos.length}`),
        el('span', { class: 'ay-b-cab-acc' },
          voz.ok ? el('button', {
            type: 'button', class: `ghost mini ay-b-voz${voz.pref().auto ? ' activo' : ''}`, 'aria-pressed': voz.pref().auto ? 'true' : 'false',
            title: voz.pref().auto ? 'Leyendo cada paso en voz alta · pulsa para silenciar' : 'Leer los pasos en voz alta',
            onclick: (ev) => {
              const on = !voz.pref().auto;
              voz.ponerPref({ auto: on });
              ev.currentTarget.classList.toggle('activo', on);
              ev.currentTarget.setAttribute('aria-pressed', String(on));
              ev.currentTarget.textContent = on ? '🔊' : '🔇';
              if (on) leerPaso(p); else voz.parar();
            },
          }, voz.pref().auto ? '🔊' : '🔇') : null,
          el('button', { type: 'button', class: 'ghost mini', 'aria-label': 'Salir del recorrido', onclick: () => finTour(true) }, '✕'))),
      el('p', { html: p.texto }),
      p.aviso ? el('p', { class: 'ay-b-aviso', html: p.aviso }) : null,
      espera ? el('p', { class: 'ay-b-tu' }, espera === 'click' ? '👉 Pulsa tú lo que está resaltado' : '⌨ Escribe tú en el recuadro resaltado') : null,
      el('div', { class: 'ay-b-pie' },
        i ? el('button', { type: 'button', class: 'ghost mini', onclick: () => paso(i - 1) }, '← Atrás') : el('span'),
        espera ? el('button', { type: 'button', class: 'ghost mini', onclick: sig }, 'Saltar este paso')
          : el('button', { type: 'button', class: 'primario', onclick: sig }, i === pasos.length - 1 ? 'Terminar' : 'Siguiente →'))].filter(Boolean));
    colocar();
    if (!espera) tour.burbuja.querySelector('.ay-b-pie .primario')?.focus({ preventScroll: true });
    if (voz.ok && voz.pref().auto) leerPaso(p, espera); else voz.parar();
  }
  function leerPaso(p, espera = p.esperar) {
    voz.hablar([{ texto: [p.texto, p.aviso, espera === 'click' ? 'Pulsa tú lo que está resaltado.' : espera === 'escribir' ? 'Escribe tú en el recuadro resaltado.' : ''].filter(Boolean).join(' ') }]);
  }
  function colocar() {
    if (!tour) return;
    const { capa, burbuja, objetivo } = tour;
    const W = innerWidth, H = innerHeight, M = 6;
    const v = capa.querySelectorAll('.ay-velo');
    const foco = capa.querySelector('.ay-foco');
    if (objetivo && !objetivo.isConnected) {
      const s = selDe(tour.r.pasos[tour.i]);
      const n = s && [...document.querySelectorAll(s)].find(visible);
      if (n) { tour.objetivo = n; colocar(); return; }
    }
    if (!objetivo || !objetivo.isConnected) {
      // sin elemento: velo entero y burbuja en el centro
      v[0].style.cssText = `left:0;top:0;width:${W}px;height:${H}px`;
      for (const x of [v[1], v[2], v[3], foco]) x.style.cssText = 'display:none';
      burbuja.style.cssText = `left:${Math.max(8, (W - burbuja.offsetWidth) / 2)}px;top:${Math.max(8, (H - burbuja.offsetHeight) / 2)}px`;
      return;
    }
    const r = objetivo.getBoundingClientRect();
    // lo que es más alto que la pantalla se recorta a lo visible
    const x = Math.max(0, r.left - M), y = Math.max(2, r.top - M), w = Math.min(W - x, r.width + 2 * M), h = Math.max(0, Math.min(H - 2, r.bottom + M) - y);
    v[0].style.cssText = `left:0;top:0;width:${W}px;height:${y}px`;
    v[1].style.cssText = `left:${x + w}px;top:${y}px;width:${Math.max(0, W - x - w)}px;height:${h}px`;
    v[2].style.cssText = `left:0;top:${y + h}px;width:${W}px;height:${Math.max(0, H - y - h)}px`;
    v[3].style.cssText = `left:0;top:${y}px;width:${x}px;height:${h}px`;
    foco.style.cssText = `left:${x}px;top:${y}px;width:${w}px;height:${h}px`;
    // burbuja: debajo si cabe, si no encima; si tampoco, abajo del todo
    const bw = burbuja.offsetWidth, bh = burbuja.offsetHeight;
    let top = y + h + 10;
    if (top + bh > H - 8) top = y - bh - 10;
    if (top < 8) top = H - bh - 8;
    const left = Math.min(Math.max(8, x + w / 2 - bw / 2), W - bw - 8);
    burbuja.style.cssText = `left:${left}px;top:${top}px`;
  }
  function finTour(marcar) {
    if (!tour) return;
    voz.parar();
    cancelAnimationFrame(tour.raf);
    for (const f of tour.quitar) f();
    if (marcar) guardar((s) => { s.tours = { ...(s.tours || {}), [tour.r.id]: tour.r.version || 1 }; });
    tour.capa.remove(); tour.burbuja.remove();
    document.removeEventListener('keydown', escTour, true);
    tour = null;
  }

  /* ---------------- Novedades ---------------- */
  const fechaTxt = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  // todas = las que le tocan por rol; si no, solo las que aún no ha visto
  function novedadesDe(todas) {
    const vistas = leer().novedades || 0;
    return (T().novedades || []).filter((n) => puede(n.si) && (todas || n.id > vistas)).sort((a, b) => b.id - a.id);
  }
  function mostrarNovedades(todas) {
    const ns = novedadesDe(todas);
    if (!ns.length) return Promise.resolve();
    return new Promise((fin) => {
      const d = el('dialog', { class: 'ay-novedades', 'aria-labelledby': 'ay-nov-tit' },
        el('h2', { id: 'ay-nov-tit' }, '✨ Novedades'),
        el('p', { class: 'ayuda' }, todas ? 'Lo último que ha cambiado en lo que usas.' : 'Desde la última vez que entraste ha cambiado esto en lo que usas:'),
        el('ul', {}, ns.slice(0, todas ? 20 : 6).map((n) => el('li', {},
          el('div', {}, el('b', { html: n.titulo }), ' ', el('small', { class: 'ayuda' }, fechaTxt(n.fecha))),
          el('p', { html: n.texto }),
          n.ir ? el('a', { href: n.ir, class: 'ay-nov-ir' }, n.ir_txt || 'Ir a verlo →') : null))),
        el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'primario', onclick: () => d.close() }, 'Entendido')));
      d.addEventListener('close', () => {
        guardar((s) => { s.novedades = Math.max(s.novedades || 0, ...T().novedades.map((n) => n.id)); });
        d.remove(); fin();
      });
      document.body.append(d);
      d.showModal();
    });
  }

  /* ---------------- Pista de primera vez ---------------- */
  function pista() {
    const p = pantalla();
    const r = (p?.recorridos || []).find((x) => puede(x.si) && x.ofrecer);
    if (!r) return;
    const s = leer();
    if ((s.tours || {})[r.id] >= (r.version || 1) || (s.pistas || {})[`${r.id}@${r.version || 1}`]) return;
    const cambio = (s.tours || {})[r.id] != null; // ya lo vio, pero ha cambiado
    const quitar = (marcar) => { n.remove(); if (marcar) guardar((x) => { x.pistas = { ...(x.pistas || {}), [`${r.id}@${r.version || 1}`]: 1 }; }); };
    const n = el('div', { class: 'ay-pista', role: 'status' },
      el('span', {}, cambio ? `Ha cambiado: ${r.cambio || r.titulo}. ` : '¿Primera vez aquí? ', el('b', {}, r.titulo), ` (${r.duracion || '1 min'})`),
      el('button', { type: 'button', class: 'primario mini', onclick: () => { quitar(true); recorrido(r); } }, '▶ Empezar'),
      el('button', { type: 'button', class: 'ghost mini', onclick: () => quitar(true) }, 'Ahora no'));
    document.body.append(n);
  }

  /* ---------------- Arranque ---------------- */
  async function iniciar(op = {}) {
    if (op.permisos) permisos = op.permisos;
    const salir = document.getElementById('salir');
    if (!op.sinBoton && pantalla() && salir && !document.getElementById('btn-ayuda')) {
      const b = el('button', { type: 'button', class: 'ghost btn-ayuda', id: 'btn-ayuda', title: 'Ayuda de esta pantalla', 'aria-label': 'Ayuda', onclick: () => (panel ? cerrarPanel() : abrirPanel()) }, '?');
      (document.getElementById('btn-avisos') || salir).before(b, ' ');
    }
    const q = new URLSearchParams(location.search);
    if (q.has('ayuda')) { abrirPanel(); return; }
    if (novedadesDe(false).length) await mostrarNovedades(false);
    pista();
  }

  window.s360ayuda = { iniciar, abrirPanel, recorrido, mostrarNovedades, finTour };
})();
