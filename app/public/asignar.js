/* Asignación de materiales (del escandallo de la partida) y herramientas (del catálogo) a las tareas
   de las OTs de la partida. Materiales: arrastrar (o pulsar material y luego tarea). Herramientas: marcar y
   «Agregar a la tarea seleccionada». */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { api } = window.s360;
  const { el, toast, cant, chipEstado } = window.s360mat;
  const partidaId = Number(new URLSearchParams(location.search).get('partida'));
  let d = null, herrCat = [], editar = false;
  let tab = new URLSearchParams(location.search).get('tab') === 'herramienta' ? 'herramienta' : 'material';
  let elegido = null;          // material del escandallo elegido para asignar con clic (pantallas táctiles)
  let tareaSel = null;         // tarea seleccionada (herramientas)
  const marcadas = new Set();  // herramientas marcadas (nombre)
  const marcadosEq = new Set(); // equipos marcados (id de tipo de máquina)
  let filtro = '';
  const abiertas = new Set();  // OTs desplegadas
  let pidiendo = null;         // { tareaId, escandalloId } mientras se pregunta la cantidad

  const quedan = (l) => Math.max(0, Math.round((l.cantidad - l.asignado) * 1000) / 1000);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  async function cargar() {
    d = await api('GET', `/api/partidas/${partidaId}/asignacion`);
    if (!abiertas.size) (d.ots.length <= 2 ? d.ots : d.ots.slice(0, 1)).forEach((o) => abiertas.add(o.id));
    const pa = d.partida;
    document.title = `s360 · Asignar ${pa.codigo || pa.nombre}`;
    $('#tit').textContent = `🧩 ${pa.codigo ? `${pa.codigo} · ` : ''}${pa.nombre}`;
    $('#sub').textContent = `${pa.proyecto_codigo} ${pa.proyecto_nombre} · ${d.ots.length} OT · ${d.escandallo.length} materiales en el escandallo`;
    $('#volver').href = `/proyectos.html?proyecto=${pa.proyecto_id}`;
    pintar();
  }

  function pintar() {
    for (const b of document.querySelectorAll('[role=tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    const sinAsignar = d.escandallo.filter((l) => quedan(l) > 0).length;
    $('#tab-mat').replaceChildren('🧱 Materiales', sinAsignar ? el('span', { class: 'llv-n aviso', title: 'Sin asignar del todo' }, String(sinAsignar)) : el('span', { class: 'llv-n' }, '✔'));
    if (tab === 'material') pintarMateriales(); else pintarHerramientas();
    pintarOTs();
  }

  /* ---------- Izquierda: escandallo ---------- */
  function pintarMateriales() {
    const izq = $('#izq');
    if (!d.escandallo.length) {
      izq.replaceChildren(el('div', { class: 'asg-tit' }, 'Escandallo de la partida'),
        el('p', { class: 'ayuda' }, 'El escandallo está vacío. Lo define el técnico desde «📋 Escandallo».'));
      return;
    }
    izq.replaceChildren(
      el('div', { class: 'asg-tit' }, editar ? 'Escandallo · arrastra a una tarea →' : 'Escandallo de la partida'),
      ...d.escandallo.map((l) => {
        const q = quedan(l);
        const item = el('div', {
          class: `asg-mat${q <= 0 ? ' hecho' : ''}${elegido === l.id ? ' elegido' : ''}`, draggable: editar && q > 0 ? 'true' : 'false',
          tabindex: editar && q > 0 ? '0' : '-1', role: 'button', 'aria-pressed': String(elegido === l.id),
          title: editar && q > 0 ? 'Arrástralo a una tarea (o púlsalo y luego pulsa la tarea)' : '',
          onclick: () => { if (!editar || q <= 0) return; elegido = elegido === l.id ? null : l.id; pintar(); },
          onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); ev.currentTarget.click(); } },
        },
        el('span', { class: 'asg-mat-nom' }, el('span', { class: 'asg-asa', 'aria-hidden': 'true' }, '⠿'), l.descripcion, ' ', chipEstado(l)),
        el('span', { class: `asg-q${q <= 0 ? ' ok' : ''}` }, q <= 0 ? `✔ ${cant(l.cantidad)}/${cant(l.cantidad)} ${l.unidad || ''}` : ['quedan ', el('b', {}, cant(q)), ` de ${cant(l.cantidad)} ${l.unidad || ''}`]));
        item.addEventListener('dragstart', (ev) => { ev.dataTransfer.setData('text/x-escandallo', String(l.id)); ev.dataTransfer.effectAllowed = 'copy'; document.body.classList.add('arrastrando'); });
        item.addEventListener('dragend', () => document.body.classList.remove('arrastrando'));
        return item;
      }),
      editar ? el('p', { class: 'ayuda' }, 'Al soltar pregunta cuánto (propone lo que queda). Un material se puede repartir entre varias tareas.') : null);
  }

  /* ---------- Izquierda: herramientas ---------- */
  function pintarHerramientas() {
    const izq = $('#izq');
    const q = norm(filtro);
    const lista = herrCat.filter((h) => !q || norm(`${h.nombre} ${h.familia}`).includes(q));
    const porFam = new Map();
    for (const h of lista) { if (!porFam.has(h.familia)) porFam.set(h.familia, []); porFam.get(h.familia).push(h); }
    const buscar = el('input', { type: 'search', class: 'asg-buscar', placeholder: '🔎 Buscar herramienta…', value: filtro, 'aria-label': 'Buscar herramienta' });
    buscar.addEventListener('input', () => { filtro = buscar.value; pintarHerramientas(); const b = $('.asg-buscar'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); });
    const t = tareaSel && d.ots.flatMap((o) => o.tareas).find((x) => x.id === tareaSel);
    const nM = marcadas.size + marcadosEq.size;
    const btn = el('button', { type: 'button', class: 'primario asg-agregar', disabled: !editar || !t || !nM, onclick: agregarHerramientas },
      t ? `＋ Agregar ${nM || ''} a «${t.nombre}»` : 'Elige una tarea a la derecha');
    // equipos de los que hay pocos: la tarea los pide; en el cuadrante se asigna uno concreto y se controla que no se crucen
    const eqs = (d.equipos || []).filter((e) => !q || norm(e.nombre).includes(q));
    const bloqueEq = eqs.length ? [
      el('div', { class: 'asg-fam eq' }, '⚙ Equipos (hay pocos) · en el cuadrante se asigna cuál'),
      ...eqs.map((e) => {
        const todasFijas = e.n && e.n_fijas === e.n;
        return el('label', { class: `asg-herr eq${todasFijas ? ' fija' : ''}` },
          el('input', { type: 'checkbox', checked: marcadosEq.has(e.id), disabled: !editar || todasFijas,
            onchange: (ev) => { ev.target.checked ? marcadosEq.add(e.id) : marcadosEq.delete(e.id); pintarHerramientas(); } }),
          e.nombre, el('span', { class: 'ayuda' }, todasFijas ? ` · fija en ${e.fijas_en.join(', ')}: planifica la tarea allí`
            : ` (${e.n || 'ninguno dado de alta'})${e.n_fijas ? ` · ${e.n_fijas} fija en ${e.fijas_en.join(', ')}` : ''}`));
      })] : [];
    izq.replaceChildren(
      el('div', { class: 'asg-tit' }, 'Herramientas y equipos · marca y agrega a la tarea seleccionada'),
      el('p', { class: 'ayuda asg-nota' }, 'Las máquinas fijas (sierra, plegadora, cizalla, cabina…) no se asignan aquí: van con el área donde se planifica la tarea (Cuadrante › Áreas de trabajo › Equipo fijo).'),
      buscar,
      el('div', { class: 'asg-herr-lista' },
        ...bloqueEq,
        el('div', { class: 'asg-fam eq' }, '🔧 Herramientas de mano'),
        ...[...porFam].map(([fam, hs]) => [el('div', { class: 'asg-fam' }, fam), ...hs.map((h) => el('label', { class: 'asg-herr' },
          el('input', { type: 'checkbox', checked: marcadas.has(h.nombre), disabled: !editar, onchange: (ev) => { ev.target.checked ? marcadas.add(h.nombre) : marcadas.delete(h.nombre); pintarHerramientas(); } }),
          h.nombre))]),
        !lista.length ? el('p', { class: 'ayuda' }, 'No está en el catálogo.') : null,
        filtro.trim() && editar && !herrCat.some((h) => norm(h.nombre) === q) ? el('button', { type: 'button', class: 'ghost asg-nueva', onclick: async () => {
          try {
            const c = await api('POST', '/api/catalogo-llevar', { tipo: 'herramienta', nombre: filtro.trim() });
            if (!herrCat.some((h) => h.id === c.id)) herrCat.push(c);
            marcadas.add(c.nombre); toast(`Añadida al catálogo: ${c.nombre}`); pintarHerramientas();
          } catch (e) { toast(e.message, true); }
        } }, `＋ Añadir «${filtro.trim()}» al catálogo`) : null),
      el('div', { class: 'asg-pie' }, el('span', { class: 'ayuda' }, `${nM} marcada(s)`),
        nM ? el('button', { type: 'button', class: 'ghost mini', onclick: () => { marcadas.clear(); marcadosEq.clear(); pintarHerramientas(); } }, 'Desmarcar') : null, btn));
  }

  async function agregarHerramientas() {
    const items = [...marcadas].map((nombre) => ({ descripcion: nombre, catalogo_id: herrCat.find((h) => h.nombre === nombre)?.id || null }));
    try {
      const r = items.length ? await api('POST', `/api/tareas/${tareaSel}/herramientas`, { items }) : { añadidas: 0 };
      const e = marcadosEq.size ? await api('POST', `/api/tareas/${tareaSel}/equipos`, { tipo_ids: [...marcadosEq] }) : { añadidos: 0 };
      const n = r.añadidas + e.añadidos;
      toast(n ? `${n} agregado(s) a la tarea` : 'Ya los tenía');
      marcadas.clear(); marcadosEq.clear();
      await cargar();
    } catch (e) { toast(e.message, true); }
  }

  /* ---------- Derecha: OTs y tareas ---------- */
  function pintarOTs() {
    const der = $('#der');
    if (!d.ots.length) {
      der.replaceChildren(el('div', { class: 'asg-tit' }, 'OTs de la partida'), el('p', { class: 'ayuda' }, 'Esta partida no tiene OTs.'));
      return;
    }
    der.replaceChildren(
      el('div', { class: 'asg-tit' }, tab === 'material' ? 'OTs de la partida · tareas que reciben el material' : 'Pulsa una tarea para seleccionarla'),
      ...d.ots.map((o) => {
        const abierta = abiertas.has(o.id);
        const nMat = o.tareas.reduce((s, t) => s + t.materiales.length, 0);
        const nHer = o.tareas.reduce((s, t) => s + t.herramientas.length + (t.equipos || []).length, 0);
        return el('div', { class: `asg-ot${abierta ? ' abierta' : ''}` },
          el('button', { type: 'button', class: 'asg-ot-cab', 'aria-expanded': String(abierta),
            onclick: () => { abierta ? abiertas.delete(o.id) : abiertas.add(o.id); pintarOTs(); } },
          el('span', {}, abierta ? '▾ ' : '▸ ', el('b', {}, o.codigo), ` · ${o.titulo}`),
          el('span', { class: 'ayuda' }, `${o.tareas.length} tareas${tab === 'material' ? (nMat ? ` · ${nMat} mat.` : '') : (nHer ? ` · ${nHer} herr.` : '')}`)),
          abierta ? o.tareas.map((t, i) => tareaFila(t, i)) : null);
      }));
  }

  function tareaFila(t, i) {
    const items = tab === 'material' ? t.materiales
      : [...(t.equipos || []).map((q) => ({ equipo: true, tarea_id: t.id, id: q.tipo_recurso_id, descripcion: q.nombre, cantidad: q.cantidad > 1 ? q.cantidad : null })), ...t.herramientas];
    const sel = tab === 'herramienta' && tareaSel === t.id;
    const fila = el('div', { class: `asg-tarea${sel ? ' sel' : ''}${tab === 'material' && elegido ? ' destino' : ''}`, 'data-tarea': t.id, tabindex: '0', role: 'button',
      onclick: (ev) => {
        if (ev.target.closest('.asg-chip, .asg-pide')) return;
        if (tab === 'herramienta') { tareaSel = tareaSel === t.id ? null : t.id; pintar(); }
        else if (elegido) pedirCantidad(t.id, elegido);
      },
      onkeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); ev.currentTarget.click(); } },
    },
    el('div', { class: 'asg-tarea-nom' }, `${i + 1} · ${t.nombre}`, t.primera_fecha ? el('span', { class: 'ayuda' }, ` · ${window.s360mat.ddmm(t.primera_fecha)}`) : null,
      sel ? el('span', { class: 'asg-selec' }, ' ✓ seleccionada') : null),
    items.length ? el('div', { class: 'asg-chips' }, items.map((x) => chip(x))) : el('div', { class: 'asg-vacio' }, tab === 'material' ? (editar ? '— arrastra aquí —' : '—') : '— sin herramientas —'),
    pidiendo && pidiendo.tareaId === t.id ? pide() : null);
    if (tab === 'material' && editar) {
      fila.addEventListener('dragover', (ev) => { if (ev.dataTransfer.types.includes('text/x-escandallo')) { ev.preventDefault(); fila.classList.add('sobre'); } });
      fila.addEventListener('dragleave', () => fila.classList.remove('sobre'));
      fila.addEventListener('drop', (ev) => {
        ev.preventDefault(); fila.classList.remove('sobre');
        const id = Number(ev.dataTransfer.getData('text/x-escandallo'));
        if (id) pedirCantidad(t.id, id);
      });
    }
    return fila;
  }

  function chip(x) {
    const mat = tab === 'material';
    const txt = mat ? `${cant(x.cantidad)} ${x.unidad || ''} · ${x.descripcion}` : `${x.cantidad != null ? `${cant(x.cantidad)} · ` : ''}${x.descripcion}`;
    return el('span', { class: `asg-chip${mat ? '' : ' h'}${x.equipo ? ' eq' : ''}`, title: mat ? 'Pulsa para cambiar la cantidad' : x.equipo ? 'Equipo: en el cuadrante se asigna cuál' : '' },
      x.equipo ? '⚙ ' : null,
      el('span', { onclick: mat && editar ? () => cambiarCantidad(x) : null }, txt),
      editar ? el('button', { type: 'button', class: 'asg-chip-x', 'aria-label': `Quitar ${x.descripcion}`, onclick: async (ev) => {
        ev.stopPropagation();
        try { await api('DELETE', mat ? `/api/tarea-material/${x.id}` : x.equipo ? `/api/tareas/${x.tarea_id}/equipos/${x.id}` : `/api/tarea-herramienta/${x.id}`); await cargar(); }
        catch (e) { toast(e.message, true); }
      } }, '✕') : null);
  }

  // pregunta en línea «¿Cuántas?» dentro de la tarea
  function pedirCantidad(tareaId, escandalloId) {
    const l = d.escandallo.find((x) => x.id === escandalloId);
    if (!l || quedan(l) <= 0) return toast('Ese material ya está asignado del todo', true);
    pidiendo = { tareaId, escandalloId };
    pintarOTs();
    setTimeout(() => { const i = document.querySelector('.asg-pide input'); i?.focus(); i?.select(); }, 0);
  }
  function pide() {
    const l = d.escandallo.find((x) => x.id === pidiendo.escandalloId);
    const inp = el('input', { inputmode: 'decimal', value: cant(quedan(l)), 'aria-label': 'Cantidad' });
    const ok = async () => {
      try {
        await api('POST', `/api/tareas/${pidiendo.tareaId}/materiales`, { escandallo_id: l.id, cantidad: inp.value });
        pidiendo = null;
        if (quedan(l) - Number(String(inp.value).replace(',', '.')) <= 0) elegido = null;
        await cargar();
      } catch (e) { toast(e.message, true); }
    };
    const cancelar = () => { pidiendo = null; pintarOTs(); };
    inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ok(); } else if (ev.key === 'Escape') { ev.preventDefault(); cancelar(); } });
    return el('div', { class: 'asg-pide' }, `${l.descripcion}: ¿cuántas? `, inp, ` ${l.unidad || ''} `,
      el('button', { type: 'button', class: 'primario mini', onclick: ok }, 'OK'), ' ',
      el('button', { type: 'button', class: 'ghost mini', onclick: cancelar }, 'Cancelar'));
  }
  async function cambiarCantidad(x) {
    const v = prompt(`Cantidad de «${x.descripcion}» en esta tarea (${x.unidad || ''}):`, cant(x.cantidad));
    if (v == null) return;
    try { await api('PATCH', `/api/tarea-material/${x.id}`, { cantidad: v }); await cargar(); }
    catch (e) { toast(e.message, true); }
  }

  async function init() {
    const yo = await api('GET', '/api/me');
    window.s360.iniciar(yo);
    editar = window.s360.tiene('planificar') || window.s360.tiene('proyectos');
    if (!partidaId) { $('#tit').textContent = 'Falta la partida'; return; }
    for (const b of document.querySelectorAll('[role=tab]')) {
      b.onclick = () => { tab = b.dataset.tab; elegido = null; pidiendo = null; history.replaceState(null, '', `?partida=${partidaId}&tab=${tab}`); pintar(); };
    }
    $('#btn-escandallo').onclick = () => window.s360mat.escandallo({ partida: d.partida, alCerrar: cargar });
    herrCat = await api('GET', '/api/catalogo-llevar?tipo=herramienta&limite=400');
    herrCat.sort((a, b) => a.familia.localeCompare(b.familia, 'es') || a.id - b.id);
    await cargar();
    window.s360.alCambiar(cargar);
  }
  init().catch((e) => toast(e.message, true));
})();
