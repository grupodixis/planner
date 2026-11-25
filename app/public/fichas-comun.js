/* Común a Obras y Clientes: lista con buscador + ficha cuyos campos se guardan al salir de cada uno */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['selected', 'checked', 'hidden', 'disabled', 'required'].includes(k)) n[k] = !!v;
      else if (k === 'value') n.value = v ?? '';
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3500);
  }
  const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
  const dia = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

  // Un campo de la ficha: { k, etiqueta, valor, ancho, filas, tipo, opciones, obligatorio, editar, guardar(k, v) }
  function campo({ k, etiqueta, valor, ancho, filas, tipo = 'text', opciones, obligatorio, editar, guardar, max = 300, ayuda }) {
    const id = `f-${k}`;
    const input = opciones
      ? el('select', { id }, Object.entries(opciones).map(([v, t]) => el('option', { value: v, selected: String(v) === String(valor ?? '') }, t)))
      : filas ? el('textarea', { id, rows: filas, maxlength: max }) : el('input', { id, type: tipo, maxlength: max });
    if (!opciones) input.value = valor ?? '';
    input.disabled = !editar;
    let previo = input.value;
    input.addEventListener('change', async () => {
      const v = input.value.trim();
      if (obligatorio && !v) { input.value = previo; return toast(`${etiqueta}: es obligatorio`, true); }
      try { await guardar(k, v === '' ? null : v); previo = input.value; toast('Guardado'); }
      catch (e) { toast(e.message, true); input.value = previo; }
    });
    return el('div', { class: `campo${ancho ? ` ${ancho}` : ''}` }, el('label', { for: id }, etiqueta, obligatorio ? ' *' : ''), input, ayuda ? el('small', { class: 'ayuda' }, ayuda) : null);
  }

  // Pantalla: { cargarLista(q, filtro) → items, item(x) → el, filtros: [[k, txt]], cargar(id) → datos, pintar(datos, ctx), nueva() }
  async function pantalla(def) {
    const q0 = new URLSearchParams(location.search);
    const est = { id: q0.get('id') || null, filtro: def.filtros?.[0]?.[0] || null, items: [] };
    let yo;
    try { yo = await window.s360.api('GET', '/api/me'); } catch { location.href = '/login.html'; return null; }
    window.s360.iniciar(yo);
    const editar = (yo.permisos || []).includes('proyectos');
    $('#fc-nueva').hidden = !editar;
    const url = () => history.replaceState(null, '', `${location.pathname}${est.id ? `?id=${est.id}` : ''}`);
    async function lista() {
      const r = await def.cargarLista($('#fc-buscar').value.trim(), est.filtro);
      est.items = r.items;
      $('#fc-filtros').replaceChildren(...(def.filtros || []).map(([k, t]) => el('button', {
        type: 'button', class: `fc-filtro${est.filtro === k ? ' on' : ''}`, onclick: () => { est.filtro = k; lista(); },
      }, typeof t === 'function' ? t(r) : t)));
      $('#fc-lista').replaceChildren(...(r.items.length ? r.items.map((x) => {
        const li = def.item(x);
        li.classList.add('fc-item'); if (String(x.id) === String(est.id)) li.classList.add('sel');
        li.tabIndex = 0;
        const ir = () => { est.id = String(x.id); url(); lista(); ficha(); };
        li.onclick = ir; li.onkeydown = (ev) => { if (ev.key === 'Enter') ir(); };
        return li;
      }) : [el('li', { class: 'ayuda' }, 'Nada que coincida.')]), ...(r.extra ? [r.extra] : []));
    }
    async function ficha() {
      if (!est.id) return;
      try {
        const d = await def.cargar(est.id);
        $('#fc-ficha').replaceChildren(...[def.pintar(d, { editar, recargar: async () => { await lista(); await ficha(); }, ir: (id) => { est.id = id ? String(id) : null; url(); lista(); ficha(); } })].flat());
      } catch (e) { $('#fc-ficha').replaceChildren(el('section', { class: 'panel' }, el('p', { class: 'error' }, e.message))); }
    }
    let t;
    $('#fc-buscar').oninput = () => { clearTimeout(t); t = setTimeout(lista, 200); };
    $('#fc-nueva').onclick = async () => { const id = await def.nueva(); if (id) { est.id = String(id); url(); await lista(); await ficha(); } };
    window.s360.alCambiar?.(() => { lista().catch(() => {}); });
    await lista();
    await ficha();
    return est;
  }

  // Diálogo sencillo con campos: devuelve los valores o null
  function pedir(titulo, campos, ok = 'Crear') {
    return new Promise((fin) => {
      const d = el('dialog', { class: 'dlg fc-dlg' });
      const f = el('form', { method: 'dialog' },
        el('h3', {}, titulo),
        campos.map(([k, t, attrs = {}]) => el('label', { class: 'campo' }, el('span', {}, t), el('input', { name: k, ...attrs }))),
        el('p', { class: 'fc-dlg-bot' }, el('button', { type: 'submit', class: 'primario', value: 'ok' }, ok), el('button', { type: 'button', class: 'ghost', onclick: () => { d.close(); } }, 'Cancelar')));
      d.append(f); document.body.append(d);
      d.addEventListener('close', () => { const v = d.returnValue === 'ok' ? Object.fromEntries(new FormData(f)) : null; d.remove(); fin(v); });
      d.showModal();
    });
  }

  window.fichas = { el, toast, campo, pantalla, pedir, ddmm, dia, hh, api: (...a) => window.s360.api(...a) };
})();
