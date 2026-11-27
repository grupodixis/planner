/* Planéalo · Asistente ✨: panel lateral en todas las pantallas de oficina (lo carga comun.js si hay permiso «ia»).
   Habla con /api/ia/chat; la IA solo consulta (herramientas de la pasarela) con los permisos de quien pregunta. */
(() => {
  'use strict';
  if (window.s360chat) return;
  const api = (...a) => window.s360.api(...a);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['disabled', 'hidden'].includes(k)) n[k] = !!v;
      else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const guardado = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { return null; } return null; };
  const NOMBRES = {
    ots_en_riesgo: 'OTs en riesgo', proyectos_buscar: 'proyectos', ot_detalle: 'detalle de OT', planificacion_dia: 'cuadrante del día',
    agenda_persona: 'agenda', personas_libres: 'quién está libre', ausencias: 'ausencias', pedidos_compra: 'pedidos', envios_transporte: 'envíos',
    incidencias: 'incidencias', clientes_buscar: 'clientes', obras_buscar: 'obras', capacidades_quien: 'capacidades', materiales_buscar: 'materiales', crear_cliente: 'preparar cliente', editar_cliente: 'preparar cambios', anadir_contacto_cliente: 'preparar contacto', crear_obra: 'preparar obra',
  };
  const SUGERENCIAS = {
    '/gantt.html': ['¿Qué OTs no llegan a su entrega?', '¿Qué falta por planificar esta semana?'],
    '/': ['¿Qué avisos hay mañana en el cuadrante?', '¿Quién está libre mañana por la tarde para soldar?'],
    '/compras.html': ['¿Qué pedidos están pendientes de recibir?', '¿Qué envíos llegan esta semana?'],
    '/recursos.html': ['¿Quién está de vacaciones las próximas dos semanas?', '¿Quién sabe soldar TIG?'],
    _: ['¿Qué OTs van en riesgo?', '¿Quién está libre mañana?', '¿Qué incidencias hay abiertas?'],
  };

  // Markdown mínimo y seguro (se escapa todo; solo negrita, cursiva, código, listas, tablas y enlaces internos)
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const enLinea = (s) => esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
  function md(txt) {
    const out = []; const lineas = String(txt || '').replace(/\r/g, '').split('\n');
    for (let i = 0; i < lineas.length; i++) {
      const l = lineas[i];
      if (/^\s*\|.*\|\s*$/.test(l)) {
        const filas = []; while (i < lineas.length && /^\s*\|.*\|\s*$/.test(lineas[i])) filas.push(lineas[i++]); i--;
        const celdas = (f) => f.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const cuerpo = filas.filter((f) => !/^\s*\|[\s:|-]+\|\s*$/.test(f));
        out.push(`<div class="iac-tabla"><table>${cuerpo.map((f, n) => `<tr>${celdas(f).map((c) => (n === 0 ? `<th>${enLinea(c)}</th>` : `<td>${enLinea(c)}</td>`)).join('')}</tr>`).join('')}</table></div>`);
      } else if (/^\s*[-*•]\s+/.test(l)) {
        const it = []; while (i < lineas.length && /^\s*[-*•]\s+/.test(lineas[i])) it.push(lineas[i++].replace(/^\s*[-*•]\s+/, '')); i--;
        out.push(`<ul>${it.map((x) => `<li>${enLinea(x)}</li>`).join('')}</ul>`);
      } else if (/^\s*\d+[.)]\s+/.test(l)) {
        const it = []; while (i < lineas.length && /^\s*\d+[.)]\s+/.test(lineas[i])) it.push(lineas[i++].replace(/^\s*\d+[.)]\s+/, '')); i--;
        out.push(`<ol>${it.map((x) => `<li>${enLinea(x)}</li>`).join('')}</ol>`);
      } else if (/^#{1,4}\s+/.test(l)) out.push(`<p><b>${enLinea(l.replace(/^#+\s+/, ''))}</b></p>`);
      else if (l.trim()) out.push(`<p>${enLinea(l)}</p>`);
    }
    return out.join('');
  }

  const est = { conv: Number(guardado('iac-conv')) || null, mensajes: [], enviando: false, info: null, nombre: '' };
  const MOVIL = document.body.classList.contains('midia-pant');
  let panel; let lista; let entrada; let boton;

  function construir() {
    const yo = window.s360.usuario?.() || { nombre: est.nombre };
    entrada = el('textarea', { rows: 1, placeholder: MOVIL ? 'Pregunta o dicta con 🎤…' : 'Pregunta algo…', enterkeyhint: 'send', 'aria-label': 'Pregunta para el asistente',
      onkeydown: (ev) => { if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); enviar(); } },
      oninput: () => { entrada.style.height = 'auto'; entrada.style.height = `${Math.min(entrada.scrollHeight, 140)}px`; } });
    lista = el('div', { class: 'iac-lista', 'aria-live': 'polite' });
    panel = el('aside', { class: `iac${MOVIL ? ' iac-movil' : ''}`, id: 'iac', 'aria-label': 'Asistente', hidden: true },
      el('div', { class: 'iac-cab' },
        el('b', {}, '✨ Asistente'),
        el('span', { class: 'iac-quien', title: 'La IA consulta con tus permisos' }, `como ${yo.nombre || ''}`),
        el('button', { type: 'button', class: 'ghost mini', title: 'Conversaciones anteriores', 'aria-label': 'Conversaciones anteriores', onclick: historial }, '🕘'),
        el('button', { type: 'button', class: 'ghost mini', title: 'Nueva conversación', 'aria-label': 'Nueva conversación', onclick: nueva }, '＋'),
        el('button', { type: 'button', class: 'ghost mini', title: 'Cerrar (Esc)', 'aria-label': 'Cerrar', onclick: () => abrir(false) }, '✕')),
      lista,
      el('form', { class: 'iac-pie', onsubmit: (ev) => { ev.preventDefault(); enviar(); } },
        entrada, microfono(), el('button', { type: 'submit', class: 'primario', 'aria-label': 'Enviar', title: 'Enviar (Intro)' }, '➤')),
      el('div', { class: 'iac-nota' }, 'Consulta, y solo cambia lo que confirmas en una tarjeta. Puede equivocarse; comprueba lo importante.'));
    panel.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') abrir(false); });
    document.body.append(panel);
  }

  // 🎤 Dictado (reconocimiento de voz del navegador; Chrome/Android y Safari/iPhone). Rellena el cuadro; se envía con ➤.
  function microfono() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    let rec = null; let base = '';
    const b = el('button', { type: 'button', class: 'iac-mic', 'aria-label': 'Dictar', title: 'Dictar con la voz', onclick: () => {
      if (rec) { rec.stop(); return; }
      rec = new SR(); rec.lang = 'es-ES'; rec.interimResults = true; rec.continuous = false;
      base = entrada.value ? `${entrada.value.trim()} ` : '';
      rec.onresult = (ev) => { entrada.value = base + [...ev.results].map((r) => r[0].transcript).join(''); entrada.dispatchEvent(new Event('input')); };
      rec.onerror = (ev) => { if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') window.s360.aviso?.('Permite el micrófono para dictar', true); };
      rec.onend = () => { rec = null; b.classList.remove('oyendo'); b.setAttribute('aria-label', 'Dictar'); entrada.focus(); };
      b.classList.add('oyendo'); b.setAttribute('aria-label', 'Parar el dictado');
      try { rec.start(); } catch { rec = null; b.classList.remove('oyendo'); }
    } }, '🎤');
    return b;
  }

  function pintar() {
    if (!est.mensajes.length) {
      const sug = SUGERENCIAS[location.pathname] || SUGERENCIAS._;
      lista.replaceChildren(el('div', { class: 'iac-vacio' },
        el('p', {}, est.info?.disponible === false ? `⚠ ${est.info.motivo}. Se configura en Recursos › IA.` : 'Pregúntame por OTs, el cuadrante, quién está libre, pedidos, envíos, incidencias…'),
        est.info?.disponible === false ? null : el('div', { class: 'iac-sug' }, sug.map((s) => el('button', { type: 'button', class: 'ghost', onclick: () => { entrada.value = s; enviar(); } }, s)))));
      return;
    }
    lista.replaceChildren(...est.mensajes.map((m) => {
      if (m.rol === 'usuario') return el('div', { class: 'iac-m yo' }, m.texto);
      const her = (m.herramientas || []);
      const pend = m.pensando || m.estado === 'pensando';
      const div = el('div', { class: `iac-m ia${m.error ? ' mal' : ''}${pend ? ' pensando' : ''}` },
        her.length ? el('div', { class: 'iac-her' }, her.map((h) => el('span', { class: h.ok === null ? 'va' : h.ok ? '' : 'mal', title: `${h.nombre} ${JSON.stringify(h.args || {})}${h.error ? `\n${h.error}` : ''}` }, `${/^(crear|editar|anadir)_/.test(h.nombre) ? '✎' : '🔎'} ${NOMBRES[h.nombre] || h.nombre}`))) : null);
      if (pend) {
        const seg = m.creado ? Math.max(0, Math.round((Date.now() - new Date(m.creado).getTime()) / 1000)) : 0;
        const fase = { consultando: 'Consultando', redactando: 'Redactando la respuesta', pensando: 'Pensando', esperando: 'El modelo está saturado, reintentando' }[m.fase] || 'Pensando';
        div.append(el('span', { class: 'iac-puntos' }, fase, el('i'), el('i'), el('i'), seg >= 3 ? el('small', {}, ` ${seg} s`) : null));
      }
      else if (m.error) div.append(el('p', {}, `✕ ${m.error}`), el('button', { type: 'button', class: 'mini', onclick: () => reintentar(m) }, '↻ Reintentar'));
      else { const c = el('div', { class: 'iac-txt' }); c.innerHTML = md(m.texto); div.append(c); if (m.aviso) div.append(el('small', { class: 'iac-aviso' }, `ℹ ${m.aviso}`)); }
      for (const p of (!pend && m.propuestas) || []) div.append(tarjeta(p, m));
      return div;
    }));
    lista.scrollTop = lista.scrollHeight;
  }

  // Cambio preparado por la IA: no se hace hasta pulsar ✔ Confirmar (con tus permisos, por la API normal)
  function tarjeta(p, m) {
    const hecha = p.estado === 'hecha'; const cancelada = p.estado === 'cancelada';
    const t = el('div', { class: `iac-prop ${p.estado}` },
      el('div', { class: 'iac-prop-tit' }, hecha ? '✔ ' : cancelada ? '✕ ' : '✎ ', p.titulo),
      el('dl', {}, (p.campos || []).flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, String(v))])),
      ...(p.avisos || []).map((a) => el('p', { class: 'iac-prop-aviso' }, `⚠ ${a}`)),
      p.error ? el('p', { class: 'iac-prop-err' }, `✕ ${p.error}`) : null);
    if (hecha) t.append(el('p', { class: 'iac-prop-ok' }, 'Hecho. ', p.enlace ? el('a', { href: p.enlace }, 'Abrir la ficha →') : null));
    else if (cancelada) t.append(el('p', { class: 'iac-prop-ok' }, 'Cancelado: no se ha cambiado nada.'));
    else {
      const ok = el('button', { type: 'button', class: 'primario mini', onclick: async () => {
        ok.disabled = true; ok.textContent = 'Guardando…';
        try { Object.assign(p, await api('POST', `/api/ia/propuestas/${p.id}/confirmar`)); }
        catch (e) { p.error = e.message; }
        pintar();
      } }, '✔ Confirmar');
      t.append(el('div', { class: 'iac-prop-acc' }, ok,
        el('button', { type: 'button', class: 'ghost mini', onclick: async () => { try { await api('POST', `/api/ia/propuestas/${p.id}/cancelar`); p.estado = 'cancelada'; } catch (e) { p.error = e.message; } pintar(); } }, '✕ Cancelar'),
        el('small', {}, 'No se guarda nada hasta que confirmes')));
    }
    return t;
  }

  async function enviar(texto) {
    const t = (texto ?? entrada.value).trim();
    if (!t || est.enviando) return;
    entrada.value = ''; entrada.style.height = 'auto';
    est.enviando = true;
    est.mensajes.push({ rol: 'usuario', texto: t }, { rol: 'ia', pensando: true });
    pintar();
    try {
      const r = await api('POST', '/api/ia/chat', { conversacion_id: est.conv, mensaje: t, pagina: location.pathname + location.search });
      est.conv = r.conversacion_id; guardado('iac-conv', String(r.conversacion_id));
      est.mensajes.pop(); est.mensajes.push(r.mensaje); pintar();
      await seguir(r.mensaje);
    } catch (e) {
      est.mensajes.pop(); est.mensajes.push({ rol: 'ia', error: navigator.onLine === false ? 'Sin conexión: el asistente necesita internet.' : e.message, reintento: t });
    }
    est.enviando = false;
    pintar(); entrada.focus();
  }
  // La respuesta se prepara en el servidor: preguntar cómo va hasta que esté (o falle)
  async function seguir(m) {
    let fallos = 0;
    while (m.estado === 'pensando') {
      await new Promise((ok) => setTimeout(ok, 1200));
      if (!est.mensajes.includes(m)) return;   // cambió de conversación
      try {
        Object.assign(m, await api('GET', `/api/ia/mensajes/${m.id}`)); fallos = 0;
      } catch (e) {
        if (++fallos >= 5) { Object.assign(m, { estado: 'error', error: navigator.onLine === false ? 'Sin conexión: el asistente necesita internet.' : e.message }); }
      }
      if (m.estado === 'error') m.reintento = est.mensajes[est.mensajes.indexOf(m) - 1]?.texto;
      if (!panel.hidden) pintar();
    }
  }

  function reintentar(m) {
    const i = est.mensajes.indexOf(m);
    const t = m.reintento || est.mensajes[i - 1]?.texto;
    est.mensajes.splice(i - 1, 2); enviar(t);
  }

  async function cargar(id) {
    try {
      const c = await api('GET', `/api/ia/conversaciones/${id}`);
      est.conv = c.id; est.mensajes = c.mensajes; guardado('iac-conv', String(c.id));
    } catch { est.conv = null; est.mensajes = []; guardado('iac-conv', null); }
    pintar();
    const pend = est.mensajes.find((m) => m.estado === 'pensando');
    if (pend && !est.enviando) { est.enviando = true; await seguir(pend); est.enviando = false; pintar(); }
  }
  function nueva() { est.conv = null; est.mensajes = []; guardado('iac-conv', null); pintar(); entrada.focus(); }

  async function historial() {
    let cs = [];
    try { cs = await api('GET', '/api/ia/conversaciones'); } catch { /* nada */ }
    const fecha = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    lista.replaceChildren(el('div', { class: 'iac-hist' },
      el('div', { class: 'iac-hist-cab' }, el('b', {}, 'Conversaciones'), el('button', { type: 'button', class: 'ghost mini', onclick: pintar }, '← Volver')),
      cs.length ? cs.map((c) => el('div', { class: `iac-hist-f${c.id === est.conv ? ' actual' : ''}` },
        el('button', { type: 'button', class: 'ghost', onclick: () => cargar(c.id) }, el('span', {}, c.titulo), el('small', {}, `${fecha(c.actualizado)} · ${c.preguntas} pregunta${c.preguntas === 1 ? '' : 's'}`)),
        el('button', { type: 'button', class: 'ghost mini', title: 'Borrar', 'aria-label': `Borrar «${c.titulo}»`, onclick: async () => { await api('DELETE', `/api/ia/conversaciones/${c.id}`).catch(() => {}); if (c.id === est.conv) nueva(); historial(); } }, '🗑')))
        : el('p', { class: 'ayuda' }, 'Aún no hay conversaciones.')));
  }

  async function abrir(si = panel.hidden) {
    panel.hidden = !si;
    document.body.classList.toggle('iac-abierto', si);
    boton?.setAttribute('aria-expanded', String(si));
    if (!MOVIL) guardado('iac-abierto', si ? '1' : null);
    document.documentElement.classList.toggle('iac-bloqueo', si && MOVIL);
    if (!si) return;
    if (!est.info) {
      try { est.info = await api('GET', '/api/ia/asistente'); } catch { est.info = { disponible: false, motivo: 'No se pudo consultar el asistente' }; }
      if (est.conv && !est.mensajes.length) await cargar(est.conv); else pintar();
    }
    if (!MOVIL) entrada.focus();
  }

  // En Mi día (app móvil) no hay botón en la cabecera: se abre desde Menú › ✨ Asistente o Inicio
  function prepararMovil(nombre) {
    est.nombre = nombre || '';
    if (!panel) construir();
  }
  function iniciar() {
    if (MOVIL) return;
    const salir = document.getElementById('salir');
    if (!salir || document.getElementById('btn-ia')) return;
    construir();
    boton = el('button', { type: 'button', class: 'ghost btn-ia', id: 'btn-ia', title: 'Asistente (Alt+A)', 'aria-label': 'Asistente', 'aria-expanded': 'false', 'aria-controls': 'iac', onclick: () => abrir() }, '✨');
    (document.getElementById('btn-avisos') || salir).before(boton, ' ');
    document.addEventListener('keydown', (ev) => { if (ev.altKey && (ev.key === 'a' || ev.key === 'A')) { ev.preventDefault(); abrir(); } });
    if (guardado('iac-abierto') === '1') abrir(true);
  }
  window.s360chat = { abrir, md, prepararMovil };
  iniciar();
})();
