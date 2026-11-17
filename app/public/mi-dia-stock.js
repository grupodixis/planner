/* App del móvil · Logística: revisar stock y recibir material (confirmar y reportar).
   Pedir a proveedores y el resto del circuito se hace en el ordenador (Logística y compras). */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'hidden') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  async function api(metodo, url, cuerpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    if (r.status === 401) { location.replace('/pin.html'); throw new Error('Sesión caducada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }
  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3000);
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const cant = (n) => String(Math.round((n || 0) * 1000) / 1000).replace('.', ',');
  const dia = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const hoy = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10);

  let d = null, vista = 'revisar', filtro = '', cuentasCache = null;
  const ESTADO = { revisar: 'sin_revisar', recibir: 'pedido' };

  async function cuentas() {
    d = await api('GET', '/api/material/circuito');
    cuentasCache = d.cuentas;
    return d.cuentas;
  }
  async function cargar() {
    await cuentas();
    pintar();
  }
  function ver(v) { vista = v; filtro = ''; window.midiaMas.mostrar('stock'); }

  function pintar() {
    const q = norm(filtro);
    const ls = d.lineas.filter((l) => l.estado === ESTADO[vista]
      && (!q || norm(`${l.descripcion} ${l.proyecto_codigo} ${l.proyecto_nombre} ${l.partida_nombre} ${l.proveedor || ''}`).includes(q)));
    // por lo que hace falta antes
    ls.sort((a, b) => String(a.fecha_necesaria || '9').localeCompare(String(b.fecha_necesaria || '9')) || a.partida_id - b.partida_id);
    const buscar = el('input', { type: 'search', class: 'md-caps-buscar', placeholder: '🔎 Buscar material, proyecto…', value: filtro, 'aria-label': 'Buscar' });
    buscar.addEventListener('input', () => { filtro = buscar.value; pintar(); const b = $('#v-stock .md-caps-buscar'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); });
    let partidaAnt = null;
    $('#v-stock').replaceChildren(
      el('div', { class: 'stk-tabs', role: 'tablist' },
        [['revisar', '📦 Revisar stock', d.cuentas.revisar], ['recibir', '🚚 Recibir', d.cuentas.recibir]].map(([k, txt, n]) => el('button', {
          type: 'button', role: 'tab', 'aria-selected': String(vista === k), class: vista === k ? 'activo' : '',
          onclick: () => { vista = k; filtro = ''; pintar(); window.scrollTo(0, 0); },
        }, txt, n ? el('span', { class: 'stk-n' }, String(n)) : null))),
      el('p', { class: 'ayuda stk-ayuda' }, vista === 'revisar'
        ? 'Mira en el almacén y di cuánto hay. Lo que falte le llega a compras.'
        : 'Cuando llegue, márcalo: se avisa a los operarios de la tarea.'),
      buscar,
      ...(ls.length ? ls.flatMap((l) => {
        const cab = l.partida_id !== partidaAnt ? el('h3', { class: 'stk-partida' }, `${l.proyecto_codigo} · ${l.partida_nombre}`) : null;
        partidaAnt = l.partida_id;
        return [cab, tarjeta(l)].filter(Boolean);
      }) : [el('p', { class: 'md-vacio' }, filtro ? 'Nada coincide.' : vista === 'revisar' ? '✔ Nada por revisar.' : '✔ Nada pendiente de llegar.')]));
  }

  function tarjeta(l) {
    const tarde = l.fecha_necesaria && l.fecha_necesaria < hoy();
    const hecho = async (url, cuerpo, msg) => {
      try { await api('PUT', url, cuerpo); toast(msg); await cargar(); } catch (e) { toast(e.message, true); }
    };
    const info = [
      el('b', {}, `${cant(l.cantidad)} ${l.unidad || ''}`),
      l.fecha_necesaria ? el('span', { class: tarde ? 'stk-tarde' : '' }, ` · para el ${dia(l.fecha_necesaria)}`) : ' · sin planificar',
      l.tareas.length ? el('div', { class: 'stk-tareas' }, l.tareas.map((t) => `${t.ot} ${t.tarea}`).join(' · ')) : null,
      vista === 'recibir' ? el('div', { class: 'stk-ped' }, `Pedido${l.proveedor ? ` a ${l.proveedor}` : ''}${l.fecha_prevista ? ` · llega el ${dia(l.fecha_prevista)}` : ''}${l.falta ? ` · faltan ${cant(l.falta)}` : ''}`) : null,
      l.nota ? el('div', { class: 'ayuda' }, l.nota) : null,
    ];
    // fotos: las del técnico se ven; aquí se añaden con la cámara
    const fotos = el('div', { class: 'stk-fotos' }, window.s360.adjuntos(l.archivos || []),
      el('label', { class: 'boton ghost stk-foto' }, '📷 Foto',
        el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: async (ev) => {
          const f = ev.target.files[0];
          if (!f) return;
          try {
            toast('Subiendo foto…');
            const id = await window.s360.subirArchivo(f);
            await api('POST', `/api/escandallo/${l.id}/archivos`, { ids: [id] });
            toast('Foto añadida'); await cargar();
          } catch (e) { toast(e.message, true); }
        } })));
    let acciones;
    if (vista === 'revisar') {
      const inp = el('input', { inputmode: 'decimal', placeholder: 'cuánto', 'aria-label': `Cuánto hay de ${l.descripcion}`, class: 'stk-cuanto' });
      acciones = el('div', { class: 'stk-acc' },
        el('div', { class: 'stk-dos' },
          el('button', { type: 'button', class: 'stk-no', onclick: () => hecho(`/api/escandallo/${l.id}/stock`, { stock: 0 }, 'No hay: avisado a compras') }, '✗ No hay'),
          el('button', { type: 'button', class: 'stk-si', onclick: () => hecho(`/api/escandallo/${l.id}/stock`, { stock: l.cantidad }, 'Hay todo ✔') }, '✔ Hay todo')),
        el('div', { class: 'stk-parte' }, el('span', {}, 'Hay '), inp, el('span', {}, ` ${l.unidad || ''}`),
          el('button', { type: 'button', class: 'primario', onclick: () => {
            if (!inp.value.trim()) { inp.focus(); return; }
            hecho(`/api/escandallo/${l.id}/stock`, { stock: inp.value }, 'Apuntado');
          } }, 'Guardar')));
    } else {
      acciones = el('div', { class: 'stk-acc' },
        el('button', { type: 'button', class: 'stk-si stk-grande', onclick: () => hecho(`/api/escandallo/${l.id}/recibir`, {}, 'Recibido: avisados los operarios') }, '✔ Ha llegado'));
    }
    return el('article', { class: 'stk-card' },
      el('div', { class: 'stk-desc' }, l.descripcion),
      el('div', { class: 'stk-info' }, ...info),
      fotos, acciones);
  }

  function iniciar() { cuentas().catch(() => {}); }

  window.midiaStock = { iniciar, cargar, ver, cuentas, cuentasYa: () => cuentasCache };
})();
