/* Material de las partidas — piezas de interfaz compartidas:
   · s360mat.autocompletar(input, {tipo, alElegir})  sugerencias del catálogo al escribir
   · s360mat.escandallo({ partida, alCerrar })       definición del escandallo (técnico), lista rápida con teclado
   · s360mat.verTarea({ tarea, alCerrar })           lo que lleva una tarea (icono 🧰)
   · s360mat.ESTADOS                                  textos y colores de los estados del material */
(() => {
  'use strict';
  const { api } = window.s360;
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v ?? '';
      else if (k === 'hidden' || k === 'disabled' || k === 'checked' || k === 'selected') n[k] = !!v;
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
  const cant = (n) => (n == null ? '' : String(Math.round(Number(n) * 1000) / 1000).replace('.', ','));
  const ESTADOS = {
    sin_revisar: { txt: 'Sin revisar', cls: 'gris' },
    disponible: { txt: 'Disponible', cls: 'verde' },
    por_pedir: { txt: 'Por pedir', cls: 'naranja' },
    pedido: { txt: 'Pedido', cls: 'azul' },
  };
  const chipEstado = (l) => el('span', { class: `mat-est ${ESTADOS[l.estado]?.cls || ''}`, title: tituloEstado(l) },
    ESTADOS[l.estado]?.txt || l.estado, l.estado === 'pedido' && l.fecha_prevista ? ` · ${ddmm(l.fecha_prevista)}` : '');
  const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
  function tituloEstado(l) {
    return [l.stock != null ? `En stock: ${cant(l.stock)} ${l.unidad || ''}${l.stock_por ? ` (${l.stock_por})` : ''}` : 'Logística aún no lo ha revisado',
      l.falta ? `Falta: ${cant(l.falta)} ${l.unidad || ''}` : null,
      l.compra === 'pedido' ? `Pedido${l.proveedor ? ` a ${l.proveedor}` : ''}${l.fecha_prevista ? `, llega el ${ddmm(l.fecha_prevista)}` : ''}` : null,
      l.compra === 'recibido' ? `Recibido${l.recibido_por ? ` por ${l.recibido_por}` : ''}` : null,
      l.nota_logistica ? `Nota: ${l.nota_logistica}` : null].filter(Boolean).join('\n');
  }

  /* ---------- Sugerencias del catálogo ---------- */
  let flot = null;
  const cerrarFlot = () => { if (flot) { flot.el.remove(); flot = null; } };
  function abrirFlot(ancla) {
    cerrarFlot();
    const caja = el('div', { class: 'llv-flot', role: 'listbox' });
    (ancla.closest('dialog') || document.body).append(caja);
    flot = { el: caja, ancla };
    return caja;
  }
  function colocar() {
    if (!flot) return;
    const r = flot.ancla.getBoundingClientRect();
    flot.el.style.left = `${Math.max(8, Math.min(r.left, innerWidth - 470))}px`;
    flot.el.style.minWidth = `${Math.max(r.width, 260)}px`;
    const alto = flot.el.offsetHeight;
    flot.el.style.top = `${r.bottom + 4 + alto > innerHeight && r.top > alto ? r.top - alto - 4 : r.bottom + 4}px`;
  }
  // input + sugerencias. alElegir(item|null) se llama al aceptar (item del catálogo o null si es texto libre)
  function autocompletar(input, { tipo = 'material', alElegir, puedeAñadir = true, alIntro }) {
    let sug = [], sel = -1, pedido = 0, esperar;
    const total = () => sug.length + (extra() ? 1 : 0);
    const extra = () => puedeAñadir && input.value.trim() && !sug.some((c) => c.nombre.toLowerCase() === input.value.trim().toLowerCase());
    const pintar = () => {
      if (!flot || flot.ancla !== input) return;
      const q = input.value.trim();
      flot.el.replaceChildren(
        el('div', { class: 'llv-op-cab' }, q ? `Sugerencias · ${sug.length}` : 'Lo más usado'),
        ...sug.map((c, k) => el('div', { class: `llv-op${k === sel ? ' sel' : ''}`, role: 'option', 'aria-selected': String(k === sel),
          onmousedown: (ev) => { ev.preventDefault(); elegir(c); } }, el('span', {}, c.nombre), el('span', { class: 'llv-op-ud' }, c.detalle || c.unidad || ''))),
        extra() ? el('div', { class: `llv-op llv-op-nuevo${sel === sug.length ? ' sel' : ''}`, role: 'option',
          onmousedown: (ev) => { ev.preventDefault(); añadir(); } }, `＋ Añadir «${q}» al catálogo`) : null,
        !sug.length && !extra() ? el('div', { class: 'llv-op vacio' }, 'Sin sugerencias') : null);
      colocar();
      flot.el.querySelector('.sel')?.scrollIntoView({ block: 'nearest' });
    };
    const buscar = async () => {
      const n = ++pedido;
      try {
        const r = await api('GET', `/api/catalogo-llevar?tipo=${tipo}&limite=30&q=${encodeURIComponent(input.value.trim())}`);
        if (n !== pedido || document.activeElement !== input) return;
        sug = r; sel = r.length ? 0 : -1;
        if (!flot || flot.ancla !== input) abrirFlot(input);
        pintar();
      } catch { /* sin sugerencias */ }
    };
    const elegir = (c) => { input.value = c.nombre; input.dataset.catalogoId = c.id; cerrarFlot(); alElegir?.(c); };
    const añadir = async () => {
      try {
        const c = await api('POST', '/api/catalogo-llevar', { tipo, nombre: input.value.trim() });
        toast(`Añadido al catálogo: ${c.nombre}`); elegir(c);
      } catch (e) { toast(e.message, true); }
    };
    input.setAttribute('autocomplete', 'off');
    input.addEventListener('input', () => { delete input.dataset.catalogoId; clearTimeout(esperar); esperar = setTimeout(buscar, 120); });
    input.addEventListener('focus', () => { if (!input.value) buscar(); });
    input.addEventListener('blur', () => setTimeout(() => { if (flot?.ancla === input) cerrarFlot(); }, 120));
    input.addEventListener('keydown', (ev) => {
      const abierto = flot?.ancla === input;
      if (ev.key === 'ArrowDown') { ev.preventDefault(); if (!abierto) return buscar(); sel = Math.min(total() - 1, sel + 1); pintar(); }
      else if (ev.key === 'ArrowUp') { if (abierto) { ev.preventDefault(); sel = Math.max(0, sel - 1); pintar(); } }
      else if (ev.key === 'Escape' && abierto) { ev.preventDefault(); ev.stopPropagation(); cerrarFlot(); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        if (abierto && sel >= 0 && sel < sug.length) return elegir(sug[sel]);
        if (abierto && sel === sug.length && extra()) return añadir();
        cerrarFlot();
        alIntro?.();
      } else if (ev.key === 'Tab' && abierto && sel >= 0 && sel < sug.length && !input.dataset.catalogoId && input.value.trim()
                 && sug[sel].nombre.toLowerCase().startsWith(input.value.trim().toLowerCase())) {
        ev.preventDefault(); elegir(sug[sel]);
      }
    });
  }

  /* ---------- Fotos, PDF y enlaces de un material ---------- */
  // devuelve un bloque con miniaturas y enlaces; con permiso, botones para subir foto/archivo y añadir enlace.
  // op: { subir, enlaces, camara, alCambiar(lineaNueva) }
  function adjuntosLinea(l, op = {}) {
    const caja = el('div', { class: 'mat-adj' });
    const pintar = () => {
      const fotos = l.archivos || [];
      caja.replaceChildren(...[
        fotos.length || (l.enlaces || []).length ? el('div', { class: 'mat-adj-lista' },
          fotos.map((a) => el('span', { class: 'mat-adj-item' }, window.s360.adjuntos([a]),
            op.subir && (window.s360.tiene('escandallo') || a.creado_por === window.s360.usuario?.()?.id) ? el('button', { type: 'button', class: 'mat-adj-x', title: 'Quitar', 'aria-label': `Quitar ${a.nombre || 'archivo'}`, onclick: async () => {
              if (!confirm('¿Quitar este archivo?')) return;
              try { Object.assign(l, await api('DELETE', `/api/escandallo/${l.id}/archivos/${a.id}`)); pintar(); op.alCambiar?.(l); } catch (e) { toast(e.message, true); }
            } }, '✕') : null)),
          (l.enlaces || []).map((u, k) => el('span', { class: 'mat-adj-enlace' },
            el('a', { href: u, target: '_blank', rel: 'noopener noreferrer', title: u }, `🔗 ${u.replace(/^https?:\/\/(www\.)?/i, '').slice(0, 40)}`),
            op.enlaces ? el('button', { type: 'button', class: 'mat-adj-x', title: 'Quitar enlace', 'aria-label': 'Quitar enlace', onclick: () => guardarEnlaces(l.enlaces.filter((_, j) => j !== k)) }, '✕') : null))) : null,
        op.subir || op.enlaces ? el('div', { class: 'mat-adj-acc' },
          op.subir ? botonSubir() : null,
          op.enlaces ? formEnlace() : null) : null].filter(Boolean));
    };
    const botonSubir = () => {
      // en el móvil, «image/*» deja elegir cámara o galería
      const inp = el('input', { type: 'file', accept: op.camara ? 'image/*' : 'image/*,application/pdf', multiple: '', hidden: true });
      inp.addEventListener('change', async () => {
        const files = [...inp.files];
        if (!files.length) return;
        try {
          toast('Subiendo…');
          const ids = [];
          for (const f of files) ids.push(await window.s360.subirArchivo(f));
          Object.assign(l, await api('POST', `/api/escandallo/${l.id}/archivos`, { ids }));
          toast(files.length > 1 ? `${files.length} archivos subidos` : 'Subido');
          pintar(); op.alCambiar?.(l);
        } catch (e) { toast(e.message, true); }
        inp.value = '';
      });
      return el('label', { class: 'boton ghost mini mat-adj-subir' }, op.camara ? '📷 Foto' : '📎 Foto / PDF', inp);
    };
    const guardarEnlaces = async (lista) => {
      try { Object.assign(l, await api('PATCH', `/api/escandallo/${l.id}`, { enlaces: lista })); pintar(); op.alCambiar?.(l); } catch (e) { toast(e.message, true); }
    };
    const formEnlace = () => {
      const i = el('input', { type: 'url', placeholder: 'Pegar enlace (https://…)', 'aria-label': 'Enlace' });
      const añadir = () => {
        let u = i.value.trim();
        if (!u) return;
        if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
        guardarEnlaces([...(l.enlaces || []), u]);
      };
      i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); añadir(); } });
      return el('span', { class: 'mat-adj-form' }, i, el('button', { type: 'button', class: 'ghost mini', onclick: añadir }, '🔗 Añadir'));
    };
    pintar();
    return caja;
  }

  /* ---------- Escandallo de la partida ---------- */
  async function escandallo({ partida, alCerrar }) {
    let d;
    try { d = await api('GET', `/api/partidas/${partida.id}/escandallo`); } catch (e) { return toast(e.message, true); }
    const editar = window.s360.tiene('escandallo');
    let cambiado = false;
    const abiertos = new Set();   // líneas con los adjuntos desplegados
    const dlg = el('dialog', { class: 'dlg-llevar-ot dlg-escandallo', 'aria-labelledby': 'esc-tit' });
    const cuerpo = el('div', { class: 'llv-cuerpo' });
    const pie = el('div', { class: 'esc-pie' });
    const nombre = `${d.partida.codigo ? `${d.partida.codigo} · ` : ''}${d.partida.nombre}`;

    function fila(l, i) {
      const nueva = !l;
      const desc = el('input', { class: 'llv-desc', value: l?.descripcion || '', maxlength: 200, placeholder: nueva ? 'Escribe un material… (p. ej. «tubo cuad 40»)' : '', 'aria-label': 'Material' });
      const cantI = el('input', { class: 'llv-cant', value: cant(l?.cantidad), inputmode: 'decimal', placeholder: 'Cant.', 'aria-label': 'Cantidad' });
      const ud = el('input', { class: 'llv-ud', value: l?.unidad || '', maxlength: 20, placeholder: 'ud', 'aria-label': 'Unidad' });
      const nota = el('input', { class: 'llv-nota', value: l?.nota || '', maxlength: 300, placeholder: 'Nota', 'aria-label': 'Nota' });
      const guardar = async (cambio) => {
        if (nueva) return;
        try { Object.assign(l, await api('PATCH', `/api/escandallo/${l.id}`, cambio)); cambiado = true; pintarPie(); }
        catch (e) { toast(e.message, true); }
      };
      autocompletar(desc, {
        tipo: 'material', puedeAñadir: editar,
        alElegir: (c) => {
          if (!ud.value && c.unidad) ud.value = c.unidad;
          if (!nueva) guardar({ descripcion: c.nombre, catalogo_id: c.id, ...(c.unidad && !l.unidad ? { unidad: c.unidad } : {}) });
          cantI.focus(); cantI.select();
        },
        alIntro: () => { if (desc.value.trim()) { cantI.focus(); cantI.select(); } },
      });
      if (!nueva) {
        desc.addEventListener('change', () => { if (desc.value.trim() && desc.value !== l.descripcion && !desc.dataset.catalogoId) guardar({ descripcion: desc.value, catalogo_id: null }); });
        cantI.addEventListener('change', () => guardar({ cantidad: cantI.value }));
        ud.addEventListener('change', () => guardar({ unidad: ud.value }));
        nota.addEventListener('change', () => guardar({ nota: nota.value }));
      }
      const crear = async () => {
        if (!desc.value.trim()) return desc.focus();
        if (!cantI.value.trim()) { toast('Falta la cantidad', true); return cantI.focus(); }
        try {
          d.lineas.push(await api('POST', `/api/partidas/${partida.id}/escandallo`, {
            descripcion: desc.value, catalogo_id: desc.dataset.catalogoId || null, cantidad: cantI.value, unidad: ud.value, nota: nota.value }));
          cambiado = true; pintar(); enfocarNueva();
        } catch (e) { toast(e.message, true); }
      };
      for (const inp of [cantI, ud, nota]) inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); if (nueva) crear(); else inp.blur(); } });
      if (!editar) for (const x of [desc, cantI, ud, nota]) x.readOnly = true;
      const nAdj = nueva ? 0 : (l.archivos || []).length + (l.enlaces || []).length;
      const clip = nueva ? el('span') : el('button', { type: 'button', class: `ghost mini esc-clip${nAdj ? ' con' : ''}`, tabindex: '-1',
        title: 'Fotos, PDF y enlaces del material', 'aria-expanded': String(abiertos.has(l.id)),
        onclick: () => { abiertos.has(l.id) ? abiertos.delete(l.id) : abiertos.add(l.id); pintar(); } }, '📎', nAdj ? el('span', { class: 'llv-n' }, String(nAdj)) : null);
      const f = el('div', { class: `llv-fila esc-fila${nueva ? ' nueva' : ''}`, role: 'row' },
        el('span', { class: 'llv-num' }, nueva ? '＋' : String(i + 1)), desc, cantI, ud, nota, clip,
        nueva ? el('span') : chipEstado(l),
        editar ? (nueva ? el('button', { type: 'button', class: 'primario mini', tabindex: '-1', title: 'Añadir (Enter)', onclick: crear }, '＋')
          : el('button', { type: 'button', class: 'ghost mini borrar', tabindex: '-1', 'aria-label': `Quitar ${l.descripcion}`, title: 'Quitar (Ctrl+Supr)', onclick: () => quitar(l) }, '✕')) : el('span'));
      if (!nueva && editar) f.addEventListener('keydown', (ev) => { if (ev.ctrlKey && ev.key === 'Delete') { ev.preventDefault(); quitar(l); } });
      if (!nueva && abiertos.has(l.id)) {
        return [f, el('div', { class: 'esc-adj' }, adjuntosLinea(l, { subir: editar, enlaces: editar, alCambiar: () => { cambiado = true; } }))];
      }
      return f;
    }
    const quitar = async (l) => {
      if (!confirm(`¿Quitar «${l.descripcion}» del escandallo?${l.tareas.length ? '\nTambién se quita de las tareas a las que estaba asignado.' : ''}`)) return;
      try { await api('DELETE', `/api/escandallo/${l.id}`); d.lineas = d.lineas.filter((x) => x !== l); cambiado = true; pintar(); enfocarNueva(); }
      catch (e) { toast(e.message, true); }
    };
    function pintarPie() {
      const sinRev = d.lineas.filter((l) => l.estado === 'sin_revisar').length;
      pie.replaceChildren(
        el('span', { class: 'ayuda' }, d.partida.escandallo_enviado
          ? `Enviado a logística el ${new Date(d.partida.escandallo_enviado).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${sinRev ? ` · ${sinRev} sin revisar` : ' · todo revisado'}`
          : 'Aún no se ha enviado a logística: cuando esté, pulsa «Enviar a logística».'),
        editar ? el('button', { type: 'button', class: 'primario', disabled: !d.lineas.length, onclick: async () => {
          try {
            const r = await api('POST', `/api/partidas/${partida.id}/escandallo/enviar`);
            d.partida.escandallo_enviado = new Date().toISOString(); cambiado = true; pintarPie();
            toast(`Enviado a logística (${r.sin_revisar} por revisar)`);
          } catch (e) { toast(e.message, true); }
        } }, d.partida.escandallo_enviado ? '📦 Volver a avisar a logística' : '📦 Enviar a logística') : null);
    }
    function pintar() {
      cuerpo.replaceChildren(
        el('div', { class: 'llv-fila esc-fila llv-cab', role: 'row' }, ['#', 'Material', 'Cant.', 'Ud', 'Nota', '', 'Estado', ''].map((t) => el('span', {}, t))),
        ...d.lineas.flatMap((l, i) => [].concat(fila(l, i))),
        ...(editar ? [fila(null)] : []),
        ...(!d.lineas.length && !editar ? [el('p', { class: 'ayuda' }, 'Escandallo vacío.')] : []));
      pintarPie();
    }
    const enfocarNueva = () => setTimeout(() => cuerpo.querySelector('.llv-fila.nueva .llv-desc')?.focus(), 0);
    const cerrar = async () => { cerrarFlot(); dlg.close(); dlg.remove(); if (cambiado && alCerrar) await alCerrar(); };
    dlg.append(
      el('div', { class: 'dlg-cab' }, el('h2', { id: 'esc-tit' }, `📋 Escandallo · ${nombre}`),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: cerrar }, '✕')),
      el('p', { class: 'ayuda' }, `${d.partida.proyecto_codigo} ${d.partida.proyecto_nombre} · Materiales de toda la partida (cantidad total). Luego se reparten entre las tareas en «Asignar».`),
      cuerpo, pie,
      editar ? el('p', { class: 'llv-teclas' },
        el('span', {}, el('kbd', {}, '↑'), el('kbd', {}, '↓'), ' elegir · ', el('kbd', {}, 'Enter'), ' aceptar'),
        el('span', {}, el('kbd', {}, 'Tab'), ' siguiente casilla'),
        el('span', {}, el('kbd', {}, 'Enter'), ' en la fila nueva → añadir'),
        el('span', {}, el('kbd', {}, 'Ctrl'), '+', el('kbd', {}, 'Supr'), ' quitar línea')) : null);
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); if (flot) cerrarFlot(); else cerrar(); });
    dlg.addEventListener('scroll', cerrarFlot, true);
    document.body.append(dlg);
    pintar();
    dlg.showModal();
    enfocarNueva();
  }

  /* ---------- Lo que lleva una tarea ---------- */
  async function verTarea({ tarea }) {
    let d;
    try { d = await api('GET', `/api/tareas/${tarea.id}/llevar`); } catch (e) { return toast(e.message, true); }
    const dlg = el('dialog', { class: 'dlg-llevar-tarea', 'aria-labelledby': 'llvt-tit' });
    const cerrar = () => { dlg.close(); dlg.remove(); };
    dlg.append(
      el('div', { class: 'dlg-cab' }, el('h2', { id: 'llvt-tit' }, '🧰 Llevar'), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: cerrar }, '✕')),
      el('p', { class: 'ayuda' }, `Para «${tarea.nombre}».`),
      el('section', { class: 'llevar-grupo material' }, el('h3', {}, '🧱 Materiales', el('span', { class: 'ayuda' }, ` · ${d.materiales.length}`)),
        d.materiales.length ? el('ul', {}, d.materiales.map((m) => el('li', {},
          el('span', { class: 'llvt-cant' }, `${cant(m.cantidad)} ${m.unidad || ''}`), el('span', {}, m.descripcion), ' ', chipEstado(m)))) : el('p', { class: 'ayuda' }, 'Nada.')),
      el('section', { class: 'llevar-grupo herramienta' }, el('h3', {}, '🔧 Herramientas', el('span', { class: 'ayuda' }, ` · ${d.herramientas.length}`)),
        d.herramientas.length ? el('ul', {}, d.herramientas.map((h) => el('li', {},
          el('span', { class: 'llvt-cant' }, h.cantidad != null ? cant(h.cantidad) : ''), el('span', {}, h.descripcion)))) : el('p', { class: 'ayuda' }, 'Nada.')),
      el('p', { class: 'ayuda' }, 'Se asignan desde la partida → «🧩 Asignar».'));
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); cerrar(); });
    document.body.append(dlg);
    dlg.showModal();
  }

  window.s360mat = { adjuntosLinea, autocompletar, escandallo, verTarea, ESTADOS, chipEstado, tituloEstado, cant, ddmm, el, toast };
})();
