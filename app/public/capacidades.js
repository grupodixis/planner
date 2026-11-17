/* Capacidades: lo que sabe hacer cada persona.
   Dos vistas: por capacidad (quién la sabe) y por persona (qué sabe). Se guarda al marcar. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { api } = window.s360;
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  function toast(msg, error = false) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.className = 'toast'), 2600);
  }
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = new URLSearchParams(location.search);

  let d = null, editar = false;
  let vista = q.get('persona') ? 'persona' : 'capacidad';
  let capSel = Number(q.get('capacidad')) || null;
  let perSel = Number(q.get('persona')) || null;
  let filtro = '';
  const plegadas = new Set();

  async function cargar() {
    d = await api('GET', '/api/capacidades');
    editar = d.puede_editar;
    if (capSel && !d.capacidades.some((k) => k.id === capSel)) capSel = null;
    if (!capSel && d.capacidades.length) capSel = d.capacidades[0].id;
    if (!perSel && d.personas.length) perSel = d.personas[0].id;
    pintar();
  }
  const familias = () => {
    const m = new Map();
    for (const k of d.capacidades) { if (!m.has(k.familia)) m.set(k.familia, []); m.get(k.familia).push(k); }
    return m;
  };
  const sabe = (k, pid) => k.personas.includes(pid);

  function pintar() {
    $('#tabs').replaceChildren(...[['capacidad', 'Por capacidad'], ['persona', 'Por persona']].map(([k, txt]) => el('button', {
      type: 'button', role: 'tab', class: 'llv-tab', 'aria-selected': String(vista === k),
      onclick: () => { vista = k; filtro = ''; pintar(); },
    }, txt)));
    if (vista === 'capacidad') { pintarListaCapacidades(); pintarCapacidad(); } else { pintarListaPersonas(); pintarPersona(); }
  }

  async function marcar(k, pid, valor) {
    try {
      await api('PUT', `/api/capacidades/${k.id}/personas/${pid}`, { sabe: valor });
      if (valor) k.personas.push(pid); else k.personas = k.personas.filter((x) => x !== pid);
      pintar();
    } catch (e) { toast(e.message, true); await cargar(); }
  }

  function buscador(ph) {
    const b = el('input', { type: 'search', class: 'cap-buscar', placeholder: ph, value: filtro, 'aria-label': ph });
    b.addEventListener('input', () => {
      filtro = b.value; pintar();
      const n = $('.cap-buscar'); n.focus(); n.setSelectionRange(n.value.length, n.value.length);
    });
    return b;
  }

  /* ---------- Por capacidad ---------- */
  function pintarListaCapacidades() {
    const f = norm(filtro);
    const grupos = [...familias()].map(([fam, ks]) => [fam, ks.filter((k) => !f || norm(`${k.nombre} ${fam}`).includes(f))]).filter(([, ks]) => ks.length || !f);
    const nueva = (fam) => {
      const inp = el('input', { placeholder: `＋ Añadir en ${fam}… ↵`, maxlength: 120, 'aria-label': `Añadir capacidad en ${fam}`, class: 'cap-nueva' });
      inp.addEventListener('keydown', async (ev) => {
        if (ev.key !== 'Enter' || !inp.value.trim()) return;
        ev.preventDefault();
        try { const k = await api('POST', '/api/capacidades', { familia: fam, nombre: inp.value.trim() }); capSel = k.id; toast(`Añadida: ${k.nombre}`); await cargar(); }
        catch (e) { toast(e.message, true); }
      });
      return inp;
    };
    $('#izq').replaceChildren(
      buscador('🔎 Buscar capacidad…'),
      el('div', { class: 'cap-lista' }, grupos.map(([fam, ks]) => {
        const plegada = plegadas.has(fam) && !f;
        return el('div', { class: 'cap-fam' },
          el('button', { type: 'button', class: 'cap-fam-cab', 'aria-expanded': String(!plegada),
            onclick: () => { plegada ? plegadas.delete(fam) : plegadas.add(fam); pintar(); } },
          el('span', {}, plegada ? '▸ ' : '▾ ', fam), el('span', { class: 'ayuda' }, String(ks.length))),
          plegada ? null : ks.map((k) => el('button', {
            type: 'button', class: `cap-item${k.id === capSel ? ' sel' : ''}`, onclick: () => { capSel = k.id; history.replaceState(null, '', `?capacidad=${k.id}`); pintar(); },
          }, el('span', {}, k.nombre), el('span', { class: `cap-n${k.personas.length ? '' : ' cero'}`, title: `${k.personas.length} persona(s) la saben` }, String(k.personas.length)))),
          plegada || !editar ? null : nueva(fam));
      })),
      editar ? el('div', { class: 'cap-pie' }, (() => {
        const fam = el('input', { placeholder: 'Nueva familia (p. ej. Electricidad)', maxlength: 60, 'aria-label': 'Nueva familia' });
        const nom = el('input', { placeholder: 'Primera capacidad', maxlength: 120, 'aria-label': 'Primera capacidad de la familia' });
        return el('form', { class: 'cap-nfam', onsubmit: async (ev) => {
          ev.preventDefault();
          if (!fam.value.trim() || !nom.value.trim()) return toast('Escribe la familia y una capacidad', true);
          try { const k = await api('POST', '/api/capacidades', { familia: fam.value.trim(), nombre: nom.value.trim() }); capSel = k.id; toast('Familia creada'); await cargar(); }
          catch (e) { toast(e.message, true); }
        } }, fam, nom, el('button', { type: 'submit', class: 'ghost' }, '＋ Familia'));
      })()) : null);
  }

  function pintarCapacidad() {
    const k = d.capacidades.find((x) => x.id === capSel);
    if (!k) { $('#der').replaceChildren(el('p', { class: 'ayuda' }, 'Elige una capacidad.')); return; }
    const nombre = el('input', { value: k.nombre, maxlength: 120, class: 'cap-tit', 'aria-label': 'Nombre de la capacidad', disabled: !editar });
    nombre.addEventListener('change', async () => {
      try { await api('PATCH', `/api/capacidades/${k.id}`, { nombre: nombre.value }); toast('Nombre guardado'); await cargar(); }
      catch (e) { toast(e.message, true); nombre.value = k.nombre; }
    });
    const fams = [...familias().keys()];
    const famSel = el('select', { 'aria-label': 'Familia', disabled: !editar },
      fams.map((f) => el('option', { value: f, selected: f === k.familia ? '' : null }, f)));
    famSel.value = k.familia;
    famSel.addEventListener('change', async () => {
      try { await api('PATCH', `/api/capacidades/${k.id}`, { familia: famSel.value }); toast('Familia cambiada'); await cargar(); }
      catch (e) { toast(e.message, true); }
    });
    const n = k.personas.length;
    $('#der').replaceChildren(
      el('div', { class: 'cap-cab' }, nombre,
        el('label', { class: 'ayuda' }, 'Familia ', famSel),
        editar ? el('button', { type: 'button', class: 'ghost mini borrar', onclick: async () => {
          if (!confirm(`¿Quitar la capacidad «${k.nombre}»?${k.tareas ? ` La piden ${k.tareas} tarea(s): dejarán de pedirla.` : ''}`)) return;
          try { await api('DELETE', `/api/capacidades/${k.id}`); capSel = null; toast('Capacidad quitada'); await cargar(); } catch (e) { toast(e.message, true); }
        } }, 'Quitar') : null),
      el('p', { class: 'ayuda' }, `${n ? `${n} persona${n > 1 ? 's' : ''} la ${n > 1 ? 'saben' : 'sabe'} hacer` : 'Nadie la tiene marcada todavía'}${k.tareas ? ` · la piden ${k.tareas} tarea(s)` : ''}. Marca quién sabe hacerlo:`),
      el('div', { class: 'cap-personas' }, d.personas.map((p) => el('label', { class: `cap-per${sabe(k, p.id) ? ' si' : ''}` },
        el('input', { type: 'checkbox', checked: sabe(k, p.id), disabled: !editar, onchange: (ev) => marcar(k, p.id, ev.target.checked) }),
        el('span', {}, p.nombre, p.categoria ? el('span', { class: 'ayuda' }, ` · ${p.categoria}`) : null,
          p.vinculo === 'subcontratado' ? el('span', { class: 'ayuda' }, ' · sub') : null)))));
  }

  /* ---------- Por persona ---------- */
  function pintarListaPersonas() {
    const f = norm(filtro);
    const cuenta = (p) => d.capacidades.filter((k) => sabe(k, p.id)).length;
    $('#izq').replaceChildren(
      buscador('🔎 Buscar persona…'),
      el('div', { class: 'cap-lista' }, d.personas.filter((p) => !f || norm(`${p.nombre} ${p.categoria}`).includes(f)).map((p) => el('button', {
        type: 'button', class: `cap-item${p.id === perSel ? ' sel' : ''}`, onclick: () => { perSel = p.id; history.replaceState(null, '', `?persona=${p.id}`); pintar(); },
      }, el('span', {}, p.nombre, p.categoria ? el('span', { class: 'ayuda' }, ` · ${p.categoria}`) : null),
      el('span', { class: `cap-n${cuenta(p) ? '' : ' cero'}` }, String(cuenta(p)))))));
  }

  let filtroP = '';
  function pintarPersona() {
    const p = d.personas.find((x) => x.id === perSel);
    if (!p) { $('#der').replaceChildren(el('p', { class: 'ayuda' }, 'No hay operarios dados de alta.')); return; }
    const total = d.capacidades.filter((k) => sabe(k, p.id)).length;
    const b = el('input', { type: 'search', class: 'cap-buscar2', placeholder: '🔎 Filtrar capacidades…', value: filtroP, 'aria-label': 'Filtrar capacidades' });
    b.addEventListener('input', () => { filtroP = b.value; pintarPersona(); const n = $('.cap-buscar2'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });
    const f = norm(filtroP);
    $('#der').replaceChildren(
      el('div', { class: 'cap-cab' }, el('h3', {}, p.nombre), p.categoria ? el('span', { class: 'ayuda' }, p.categoria) : null),
      el('p', { class: 'ayuda' }, `${total} capacidad${total === 1 ? '' : 'es'} marcada${total === 1 ? '' : 's'}. Marca lo que sabe hacer:`),
      b,
      el('div', { class: 'cap-grid' }, [...familias()].map(([fam, ks]) => {
        const vis = ks.filter((k) => !f || norm(`${k.nombre} ${fam}`).includes(f));
        if (!vis.length) return null;
        return el('div', { class: 'cap-grupo' }, el('h4', {}, fam, el('span', { class: 'ayuda' }, ` ${ks.filter((k) => sabe(k, p.id)).length}/${ks.length}`)),
          vis.map((k) => el('label', { class: `cap-per${sabe(k, p.id) ? ' si' : ''}` },
            el('input', { type: 'checkbox', checked: sabe(k, p.id), disabled: !editar, onchange: (ev) => marcar(k, p.id, ev.target.checked) }),
            el('span', {}, k.nombre))));
      })));
  }

  async function init() {
    const yo = await api('GET', '/api/me');
    window.s360.iniciar(yo);
    await cargar();
  }
  init().catch((e) => toast(e.message, true));
})();
