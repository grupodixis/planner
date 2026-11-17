/* Materiales y herramientas de una OT: lista con pestañas, sugerencias del catálogo y
   selección de tareas, pensada para cargarse con el teclado.
   window.s360llevar.abrir({ ot, tipo, alCerrar })   ·   window.s360llevar.verTarea({ tarea, ot, alCerrar }) */
(() => {
  'use strict';
  const { api } = window.s360;
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v ?? '';
      else if (k === 'hidden' || k === 'disabled') n[k] = !!v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  function toast(msg, error) {
    const t = document.querySelector('#toast');
    if (!t) return;
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toast.t); toast.t = setTimeout(() => { t.className = 'toast'; }, 2800);
  }
  const TIT = { material: '🧱 Materiales', herramienta: '🔧 Herramientas' };
  const cant = (n) => (n == null ? '' : String(Number(n)).replace('.', ','));
  const corto = (nombre) => nombre.split(/\s+/).slice(0, 3).join(' ');

  /* ---------- Desplegable flotante (sugerencias y tareas) ---------- */
  let flot = null;
  function cerrarFlot() { if (flot) { flot.el.remove(); flot = null; } }
  function abrirFlot(ancla, contenido, extra = {}) {
    cerrarFlot();
    const r = ancla.getBoundingClientRect();
    const caja = el('div', { class: 'llv-flot', role: 'listbox' }, contenido);
    caja.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 440))}px`;
    caja.style.minWidth = `${Math.max(r.width, 260)}px`;
    // dentro del <dialog> modal para que quede por encima
    (ancla.closest('dialog') || document.body).append(caja);
    const alto = caja.offsetHeight;
    caja.style.top = `${r.bottom + 4 + alto > innerHeight && r.top > alto ? r.top - alto - 4 : r.bottom + 4}px`;
    flot = { el: caja, ancla, ...extra };
    return caja;
  }

  /* ---------- Lista de la OT ---------- */
  async function abrir({ ot, tipo = 'material', alCerrar }) {
    let datos;
    try { datos = await api('GET', `/api/ordenes/${ot.id}/llevar`); } catch (e) { return toast(e.message, true); }
    const editar = window.s360.tiene('planificar') || window.s360.tiene('proyectos');
    let pestaña = tipo;
    let cambiado = false;
    let ultimasTareas = [];   // la línea nueva propone las tareas de la anterior
    const dlg = el('dialog', { class: 'dlg-llevar-ot', 'aria-labelledby': 'llv-tit' });
    const tabs = el('div', { class: 'llv-tabs', role: 'tablist' });
    const cuerpo = el('div', { class: 'llv-cuerpo' });
    const nTareas = (ids) => ids.map((id) => datos.tareas.findIndex((t) => t.id === id) + 1).filter(Boolean);
    const nombreTarea = (id) => datos.tareas.find((t) => t.id === id)?.nombre || '';

    const pintarTabs = () => tabs.replaceChildren(...['material', 'herramienta'].map((tp) => el('button', {
      type: 'button', role: 'tab', class: 'llv-tab', 'aria-selected': String(tp === pestaña),
      title: tp === 'material' ? 'Alt+M' : 'Alt+H', onclick: () => cambiarA(tp),
    }, TIT[tp], el('span', { class: 'llv-n' }, String(datos.lineas.filter((l) => l.tipo === tp).length)))));
    const cambiarA = (tp) => { if (tp !== pestaña) ultimasTareas = []; pestaña = tp; cerrarFlot(); pintarTabs(); pintar(); enfocarNueva(); };

    // una fila: existente (se guarda al cambiar cada casilla) o la nueva (se guarda con Enter)
    function fila(l, i) {
      const nueva = !l;
      const d = l ? { ...l } : { tipo: pestaña, descripcion: '', catalogo_id: null, cantidad: null, unidad: '', nota: '', tareas: [...ultimasTareas] };
      const guardar = async (cambio) => {
        if (nueva) return;
        try { Object.assign(l, await api('PATCH', `/api/llevar/${l.id}`, cambio)); cambiado = true; }
        catch (e) { toast(e.message, true); }
      };
      const desc = el('input', { class: 'llv-desc', value: d.descripcion, maxlength: 200, autocomplete: 'off', placeholder: nueva ? (pestaña === 'material' ? 'Escribe un material… (p. ej. «tubo redondo 42»)' : 'Escribe una herramienta…') : '', 'aria-label': 'Qué' });
      const cantI = el('input', { class: 'llv-cant', value: cant(d.cantidad), inputmode: 'decimal', placeholder: 'Cant.', 'aria-label': 'Cantidad' });
      const ud = el('input', { class: 'llv-ud', value: d.unidad || '', maxlength: 20, placeholder: 'ud', 'aria-label': 'Unidad' });
      const tareasB = el('button', { type: 'button', class: 'llv-tareas', 'aria-haspopup': 'listbox', 'aria-label': 'En qué tareas' });
      const nota = el('input', { class: 'llv-nota', value: d.nota || '', maxlength: 300, placeholder: 'Nota', 'aria-label': 'Nota' });
      const pintarTareas = () => tareasB.replaceChildren(...(d.tareas.length
        ? d.tareas.map((id) => el('span', { class: 'llv-chip', title: nombreTarea(id) }, `${nTareas([id])[0]} · ${corto(nombreTarea(id))}`))
        : [el('span', { class: 'llv-sin' }, datos.tareas.length ? 'Tareas…' : 'Sin tareas en la OT')]));
      pintarTareas();

      // --- sugerencias del catálogo
      let sug = [], sel = -1, pedido = 0;
      const pintarSug = () => {
        if (!flot || flot.ancla !== desc) return;
        const q = desc.value.trim();
        const exacta = sug.some((c) => c.nombre.toLowerCase() === q.toLowerCase());
        const opciones = [...sug.map((c, k) => el('div', {
          class: `llv-op${k === sel ? ' sel' : ''}`, role: 'option', 'aria-selected': String(k === sel),
          onmousedown: (ev) => { ev.preventDefault(); elegir(c); },
        }, el('span', {}, c.nombre), el('span', { class: 'llv-op-ud' }, c.detalle || c.unidad || '')))];
        if (q && !exacta && editar) {
          opciones.push(el('div', { class: `llv-op llv-op-nuevo${sel === sug.length ? ' sel' : ''}`, role: 'option',
            onmousedown: (ev) => { ev.preventDefault(); añadirAlCatalogo(); } }, `＋ Añadir «${q}» al catálogo`));
        }
        if (!opciones.length) opciones.push(el('div', { class: 'llv-op vacio' }, 'Sin sugerencias: se guardará tal cual'));
        flot.el.replaceChildren(el('div', { class: 'llv-op-cab' }, q ? `Sugerencias · ${sug.length}` : 'Lo más usado'), ...opciones);
        flot.el.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
      };
      const buscar = async () => {
        const n = ++pedido;
        try {
          const r = await api('GET', `/api/catalogo-llevar?tipo=${pestaña}&limite=30&q=${encodeURIComponent(desc.value.trim())}`);
          if (n !== pedido) return;
          sug = r; sel = r.length ? 0 : -1;
          if (!flot || flot.ancla !== desc) abrirFlot(desc, []);
          pintarSug();
        } catch { /* sin sugerencias */ }
      };
      let esperar;
      desc.addEventListener('input', () => { d.catalogo_id = null; clearTimeout(esperar); esperar = setTimeout(buscar, 120); });
      desc.addEventListener('focus', () => { if (nueva && !desc.value) buscar(); });
      desc.addEventListener('blur', () => { setTimeout(() => { if (flot?.ancla === desc) cerrarFlot(); }, 120); if (!nueva && desc.value.trim() && desc.value !== l.descripcion) guardar({ descripcion: desc.value, catalogo_id: d.catalogo_id }); });
      const elegir = (c) => {
        desc.value = c.nombre; d.catalogo_id = c.id;
        if (!ud.value && c.unidad) ud.value = c.unidad;
        cerrarFlot();
        if (!nueva) guardar({ descripcion: c.nombre, catalogo_id: c.id, ...(c.unidad && !l.unidad ? { unidad: c.unidad } : {}) });
        cantI.focus(); cantI.select();
      };
      const añadirAlCatalogo = async () => {
        try {
          const c = await api('POST', '/api/catalogo-llevar', { tipo: pestaña, nombre: desc.value.trim(), unidad: ud.value || null });
          toast(`Añadido al catálogo: ${c.nombre}`);
          elegir(c);
        } catch (e) { toast(e.message, true); }
      };
      desc.addEventListener('keydown', (ev) => {
        const abierto = flot && flot.ancla === desc;
        const total = sug.length + (desc.value.trim() && editar && !sug.some((c) => c.nombre.toLowerCase() === desc.value.trim().toLowerCase()) ? 1 : 0);
        if (ev.key === 'ArrowDown') { ev.preventDefault(); if (!abierto) return buscar(); sel = Math.min(total - 1, sel + 1); pintarSug(); }
        else if (ev.key === 'ArrowUp') { if (abierto) { ev.preventDefault(); sel = Math.max(0, sel - 1); pintarSug(); } }
        else if (ev.key === 'Escape' && abierto) { ev.preventDefault(); ev.stopPropagation(); cerrarFlot(); }
        else if (ev.key === 'Enter') {
          ev.preventDefault();
          if (abierto && sel >= 0 && sel < sug.length) return elegir(sug[sel]);
          if (abierto && sel === sug.length && total > sug.length) return añadirAlCatalogo();
          cerrarFlot();
          if (desc.value.trim()) { cantI.focus(); cantI.select(); }
        } else if (ev.key === 'Tab' && abierto && sel >= 0 && sel < sug.length && !d.catalogo_id && desc.value.trim()
                   && sug[sel].nombre.toLowerCase().startsWith(desc.value.trim().toLowerCase())) {
          // Tab con una sugerencia marcada que empieza igual: se acepta
          ev.preventDefault(); elegir(sug[sel]);
        }
      });

      // --- selección de tareas (números 1–9, flechas + espacio)
      let cur = 0;
      const pintarLista = () => {
        if (!flot || flot.ancla !== tareasB) return;
        flot.el.replaceChildren(
          el('div', { class: 'llv-op-cab' }, 'Marca con el número o con Espacio · Enter/Tab: seguir'),
          ...datos.tareas.map((t, k) => el('div', {
            class: `llv-op llv-op-tarea${k === cur ? ' sel' : ''}`, role: 'option', 'aria-selected': String(d.tareas.includes(t.id)),
            onmousedown: (ev) => { ev.preventDefault(); cur = k; alternar(t.id); },
          }, el('span', { class: `llv-cb${d.tareas.includes(t.id) ? ' on' : ''}` }), `${k + 1} · ${t.nombre}`)),
          el('div', { class: 'llv-op llv-op-todas', onmousedown: (ev) => { ev.preventDefault(); todas(); } }, '* Todas / ninguna'));
      };
      let tareasAntes = null;
      const alternar = (id) => {
        d.tareas = d.tareas.includes(id) ? d.tareas.filter((x) => x !== id) : [...d.tareas, id];
        d.tareas.sort((a, b) => datos.tareas.findIndex((t) => t.id === a) - datos.tareas.findIndex((t) => t.id === b));
        pintarTareas(); pintarLista();
      };
      const todas = () => { d.tareas = d.tareas.length === datos.tareas.length ? [] : datos.tareas.map((t) => t.id); pintarTareas(); pintarLista(); };
      const abrirTareas = () => { if (!datos.tareas.length) return; tareasAntes = [...d.tareas]; abrirFlot(tareasB, []); pintarLista(); };
      const cerrarTareas = () => {
        if (flot?.ancla !== tareasB) return;
        cerrarFlot();
        if (!nueva && JSON.stringify(tareasAntes) !== JSON.stringify(d.tareas)) guardar({ tareas: d.tareas });
      };
      tareasB.addEventListener('focus', abrirTareas);
      tareasB.addEventListener('click', () => (flot?.ancla === tareasB ? cerrarTareas() : abrirTareas()));
      tareasB.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== tareasB) cerrarTareas(); }, 120));
      tareasB.addEventListener('keydown', (ev) => {
        const abierto = flot?.ancla === tareasB;
        if (/^[1-9]$/.test(ev.key)) { ev.preventDefault(); const t = datos.tareas[Number(ev.key) - 1]; if (t) { if (!abierto) abrirTareas(); cur = Number(ev.key) - 1; alternar(t.id); } }
        else if (ev.key === '*' || ev.key === '0') { ev.preventDefault(); if (!abierto) abrirTareas(); todas(); }
        else if (ev.key === 'ArrowDown') { ev.preventDefault(); if (!abierto) return abrirTareas(); cur = Math.min(datos.tareas.length - 1, cur + 1); pintarLista(); }
        else if (ev.key === 'ArrowUp') { ev.preventDefault(); cur = Math.max(0, cur - 1); pintarLista(); }
        else if (ev.key === ' ') { ev.preventDefault(); if (!abierto) return abrirTareas(); alternar(datos.tareas[cur].id); }
        else if (ev.key === 'Escape' && abierto) { ev.preventDefault(); ev.stopPropagation(); cerrarTareas(); }
        else if (ev.key === 'Enter') { ev.preventDefault(); cerrarTareas(); if (nueva) crear(); else nota.focus(); }
        else if (ev.key === 'Tab') cerrarTareas();
      });

      // --- guardar
      if (!nueva) {
        cantI.addEventListener('change', () => guardar({ cantidad: cantI.value }));
        ud.addEventListener('change', () => guardar({ unidad: ud.value }));
        nota.addEventListener('change', () => guardar({ nota: nota.value }));
      }
      const crear = async () => {
        if (!desc.value.trim()) { desc.focus(); return; }
        try {
          const l2 = await api('POST', `/api/ordenes/${ot.id}/llevar`, {
            tipo: pestaña, descripcion: desc.value, catalogo_id: d.catalogo_id, cantidad: cantI.value, unidad: ud.value, nota: nota.value, tareas: d.tareas });
          datos.lineas.push(l2); cambiado = true; ultimasTareas = [...d.tareas];
          pintarTabs(); pintar(); enfocarNueva();
        } catch (e) { toast(e.message, true); }
      };
      for (const inp of [cantI, ud, nota]) {
        inp.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter') return;
          ev.preventDefault();
          if (nueva) crear(); else inp.blur();
        });
      }
      const borrar = !nueva && editar ? el('button', { type: 'button', class: 'ghost mini borrar', tabindex: '-1', 'aria-label': `Quitar ${d.descripcion}`, title: 'Quitar (Ctrl+Supr en la fila)',
        onclick: () => quitar(l) }, '✕') : nueva && editar ? el('button', { type: 'button', class: 'primario mini', tabindex: '-1', title: 'Añadir (Enter)', onclick: crear }, '＋') : el('span');
      const f = el('div', { class: `llv-fila${nueva ? ' nueva' : ''}`, role: 'row' },
        el('span', { class: 'llv-num' }, nueva ? '＋' : String(i + 1)), desc, cantI, ud, tareasB, nota, borrar);
      if (!nueva) f.addEventListener('keydown', (ev) => { if (ev.ctrlKey && ev.key === 'Delete') { ev.preventDefault(); quitar(l); } });
      if (!editar) for (const x of [desc, cantI, ud, nota]) x.readOnly = true;
      if (!editar) tareasB.disabled = true;
      return f;
    }

    const quitar = async (l) => {
      if (!confirm(`¿Quitar «${l.descripcion}» de la lista?`)) return;
      try {
        await api('DELETE', `/api/llevar/${l.id}`);
        datos.lineas = datos.lineas.filter((x) => x !== l); cambiado = true;
        pintarTabs(); pintar(); enfocarNueva();
      } catch (e) { toast(e.message, true); }
    };

    function pintar() {
      const ls = datos.lineas.filter((l) => l.tipo === pestaña);
      cuerpo.replaceChildren(
        el('div', { class: 'llv-fila llv-cab', role: 'row' }, ['#', 'Qué', 'Cant.', 'Ud', 'En qué tareas', 'Nota', ''].map((t) => el('span', {}, t))),
        ...ls.map((l, i) => fila(l, i)),
        ...(editar ? [fila(null)] : []),
        ...(!ls.length && !editar ? [el('p', { class: 'ayuda' }, 'Nada apuntado.')] : []));
    }
    const enfocarNueva = () => setTimeout(() => cuerpo.querySelector('.llv-fila.nueva .llv-desc')?.focus(), 0);

    const cerrar = async () => { cerrarFlot(); dlg.close(); dlg.remove(); document.removeEventListener('keydown', atajos, true); if (cambiado && alCerrar) await alCerrar(); };
    const atajos = (ev) => {
      if (!ev.altKey || ev.ctrlKey) return;
      const k = ev.key.toLowerCase();
      if (k === 'm' || k === 'µ') { ev.preventDefault(); cambiarA('material'); }
      else if (k === 'h') { ev.preventDefault(); cambiarA('herramienta'); }
    };
    document.addEventListener('keydown', atajos, true);
    dlg.append(
      el('div', { class: 'dlg-cab' },
        el('h2', { id: 'llv-tit' }, `${ot.codigo} · Materiales y herramientas`),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: cerrar }, '✕')),
      el('p', { class: 'ayuda' }, 'La cantidad es el total de la OT; las tareas dicen dónde se usa (y qué hay que llevar ese día).'),
      tabs, cuerpo,
      editar ? el('p', { class: 'llv-teclas' },
        el('span', {}, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' elegir · ', el('kbd', {}, 'Enter'), ' aceptar'),
        el('span', {}, el('kbd', {}, 'Tab'), ' siguiente casilla'),
        el('span', {}, 'tareas: ', el('kbd', {}, '1'), '…', el('kbd', {}, '9'), ' o ', el('kbd', {}, 'Espacio'), ' · ', el('kbd', {}, '*'), ' todas'),
        el('span', {}, el('kbd', {}, 'Enter'), ' en la fila nueva → añadir'),
        el('span', {}, el('kbd', {}, 'Alt'), '+', el('kbd', {}, 'M'), ' / ', el('kbd', {}, 'H'), ' pestaña'),
        el('span', {}, el('kbd', {}, 'Ctrl'), '+', el('kbd', {}, 'Supr'), ' quitar línea')) : null);
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); if (flot) cerrarFlot(); else cerrar(); });
    dlg.addEventListener('scroll', cerrarFlot, true);
    document.body.append(dlg);
    pintarTabs(); pintar();
    dlg.showModal();
    enfocarNueva();
  }

  /* ---------- Lo de una tarea (icono 🧰) ---------- */
  async function verTarea({ tarea, ot, alCerrar }) {
    let ls;
    try { ls = await api('GET', `/api/tareas/${tarea.id}/llevar`); } catch (e) { return toast(e.message, true); }
    const dlg = el('dialog', { class: 'dlg-llevar-tarea', 'aria-labelledby': 'llvt-tit' });
    const cerrar = () => { dlg.close(); dlg.remove(); };
    const grupo = (tp) => {
      const xs = ls.filter((l) => l.tipo === tp);
      return el('section', { class: `llevar-grupo ${tp}` }, el('h3', {}, TIT[tp], el('span', { class: 'ayuda' }, ` · ${xs.length}`)),
        xs.length ? el('ul', {}, xs.map((l) => el('li', {},
          el('span', { class: 'llvt-cant' }, l.cantidad != null ? `${cant(l.cantidad)} ${l.unidad || ''}` : ''),
          el('span', {}, l.descripcion), l.nota ? el('span', { class: 'ayuda' }, ` · ${l.nota}`) : null)))
          : el('p', { class: 'ayuda' }, 'Nada.'));
    };
    const editar = window.s360.tiene('planificar') || window.s360.tiene('proyectos');
    dlg.append(
      el('div', { class: 'dlg-cab' }, el('h2', { id: 'llvt-tit' }, '🧰 Llevar'), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: cerrar }, '✕')),
      el('p', { class: 'ayuda' }, `Para «${tarea.nombre}».`),
      grupo('material'), grupo('herramienta'),
      editar ? el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: () => { cerrar(); abrir({ ot, tipo: 'material', alCerrar }); } }, '🧱 Editar materiales de la OT'),
        el('button', { type: 'button', class: 'ghost', onclick: () => { cerrar(); abrir({ ot, tipo: 'herramienta', alCerrar }); } }, '🔧 Editar herramientas de la OT')) : null);
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); cerrar(); });
    document.body.append(dlg);
    dlg.showModal();
  }

  window.s360llevar = { abrir, verTarea };
})();
