/* Proveedores: a quién se pide y cómo llega el material */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { api } = window.s360;
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'selected' || k === 'checked' || k === 'hidden' || k === 'disabled') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 2500);
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  let d = null, puede = false;

  function pintar() {
    const q = norm($('#buscar').value);
    const zona = $('#f-zona').value;
    const ver = d.proveedores.filter((p) => ($('#f-inactivos').checked || p.activo) && (!zona || p.zona === zona)
      && (!q || norm(`${p.nombre} ${p.materiales.join(' ')} ${p.localidad || ''}`).includes(q)));
    $('#tabla').replaceChildren(
      el('thead', {}, el('tr', {}, ['Proveedor', 'Material habitual', 'Zona · transporte', 'Contacto'].map((t) => el('th', {}, t)))),
      el('tbody', {}, ver.map((p) => el('tr', { class: p.activo ? '' : 'prov-inactivo' },
        el('td', {}, puede ? el('button', { type: 'button', class: 'ghost enlace', onclick: () => editar(p) }, p.nombre) : el('b', {}, p.nombre),
          p.localidad ? el('div', { class: 'ayuda' }, p.localidad) : null),
        el('td', {}, p.materiales.map((m) => el('span', { class: 'mat-chip' }, m))),
        el('td', {}, d.zonas[p.zona], el('div', { class: 'ayuda' }, d.transportes[p.transporte])),
        el('td', {}, p.email ? el('div', {}, el('a', { href: `mailto:${p.email.split(/[,\s]+/)[0]}` }, p.email)) : null,
          p.telefono ? el('div', {}, el('a', { href: `tel:${p.telefono.replace(/\s/g, '')}` }, p.telefono)) : null,
          p.contacto ? el('div', { class: 'ayuda' }, p.contacto) : null,
          p.web ? el('div', {}, el('a', { href: /^https?:/.test(p.web) ? p.web : `https://${p.web}`, target: '_blank', rel: 'noopener', class: 'ayuda' }, 'web')) : null)))),
    );
    if (!ver.length) $('#tabla').append(el('tbody', {}, el('tr', {}, el('td', { colspan: 4, class: 'ayuda' }, 'Ninguno.'))));
  }

  function editar(p) {
    const nuevo = !p;
    p = p || { nombre: '', zona: 'menorca', transporte: 'proveedor', materiales: [], activo: true };
    const msg = el('p', { class: 'error', role: 'alert' });
    const campo = (k, t, attrs = {}) => el('label', { class: attrs.ancho ? 'ancho' : '' }, t,
      el('input', { name: k, value: p[k] || '', ...attrs, ancho: null }));
    const sel = (k, t, ops) => el('label', {}, t, el('select', { name: k }, Object.entries(ops).map(([v, x]) => el('option', { value: v, selected: v === p[k] }, x))));
    const f = el('form', { class: 'form-prov', onsubmit: async (ev) => {
      ev.preventDefault();
      const x = Object.fromEntries(new FormData(f));
      x.materiales = x.materiales.split(',').map((s) => s.trim()).filter(Boolean);
      x.activo = f.querySelector('[name=activo]').checked;
      try {
        if (nuevo) await api('POST', '/api/proveedores', x); else await api('PATCH', `/api/proveedores/${p.id}`, x);
        dlg.close(); toast('Guardado'); await cargar();
      } catch (e) { msg.textContent = e.message; }
    } },
    campo('nombre', 'Nombre', { required: true, maxlength: 120, ancho: true }),
    campo('email', 'Correo (pedidos)', { type: 'text', maxlength: 300 }),
    campo('telefono', 'Teléfono', { maxlength: 60 }),
    campo('contacto', 'Persona de contacto', { maxlength: 120 }),
    campo('localidad', 'Localidad', { maxlength: 120 }),
    sel('zona', 'Zona', d.zonas),
    sel('transporte', 'Cómo llega', d.transportes),
    el('label', { class: 'ancho' }, 'Material habitual (separado por comas)', el('input', { name: 'materiales', value: p.materiales.join(', ') })),
    campo('web', 'Web', { maxlength: 300, ancho: true }),
    el('label', { class: 'ancho' }, 'Notas', el('textarea', { name: 'notas', rows: 2, maxlength: 2000 }, p.notas || '')),
    el('label', {}, el('span', {}, el('input', { type: 'checkbox', name: 'activo', checked: p.activo }), ' Activo')),
    el('div', { class: 'ancho' }, msg),
    el('div', { class: 'acciones ancho' }, el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancelar'), el('button', { type: 'submit', class: 'primario' }, 'Guardar')));
    const dlg = el('dialog', { 'aria-labelledby': 'prov-tit' },
      el('div', { class: 'dlg-cab' }, el('h2', { id: 'prov-tit' }, nuevo ? 'Nuevo proveedor' : p.nombre),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')), f);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
  }

  async function cargar() {
    d = await api('GET', '/api/proveedores');
    if ($('#f-zona').options.length === 1) $('#f-zona').append(...Object.entries(d.zonas).map(([k, t]) => el('option', { value: k }, t)));
    pintar();
  }

  async function init() {
    const yo = await api('GET', '/api/me');
    window.s360.iniciar(yo);
    puede = window.s360.tiene('compras');
    $('#nuevo').hidden = !puede;
    $('#nuevo').onclick = () => editar(null);
    for (const x of ['#buscar', '#f-zona', '#f-inactivos']) $(x).addEventListener('input', pintar);
    await cargar();
    window.s360.alCambiar(cargar);
  }
  init().catch((e) => toast(e.message, true));
})();
