/* s360_planificacion · Compras › Fabricación externa: pedidos a talleres de fuera y dónde está cada parte */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v ?? '';
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'hidden') n[k] = !!v;
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const api = (...a) => window.s360.api(...a);
  const tiene = (p) => window.s360.tiene(p);
  function toast(msg, error = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3200);
  }
  const nfE = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const eur = (x) => (x == null ? '—' : nfE.format(x));
  const ddmm = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '');
  const fechaL = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
  const cuando = (t) => (t ? new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const puedeEditar = () => tiene('compras') || tiene('proyectos');
  const puedeRecibir = () => puedeEditar() || tiene('logistica');

  // color de cada clase de etapa (mismo en el tablero)
  const COLOR = { fabricacion: 'var(--azul)', galvanizado: '#b48ae8', pintura: 'var(--naranja)', lacado: 'var(--naranja)', transporte: '#8c8c8c', otro: '#4fb3a9' };
  const COLUMNAS = [
    ['fabricacion', 'Fabricación', 'el taller'],
    ['galvanizado', 'Galvanizado', 'galvanizadora'],
    ['acabado', 'Pintura / lacado', ''],
    ['otro', 'Otras etapas', ''],
    ['transporte', 'Transporte', 'camino de Menorca'],
    ['listo', 'Listo · por recibir', 'falta marcarlo recibido'],
    ['recibido', 'Recibido', 'últimos 30 días'],
  ];
  const columnaDe = (ped, p) => {
    if (p.recibido_en) return 'recibido';
    if (p.etapa >= ped.etapas.length) return 'listo';
    const t = ped.etapas[p.etapa].tipo;
    return t === 'pintura' || t === 'lacado' ? 'acabado' : COLOR[t] ? t : 'otro';
  };

  const q0 = new URLSearchParams(location.search);
  const st = { fab: Number(q0.get('fab')) || null, filtroProv: '', filtroProy: '', soloRetraso: false, buscar: '', opciones: null, tareas: new Map(), sel: new Set() };
  let panel = null;
  const guardarURL = () => {
    const u = new URLSearchParams({ vista: 'fabricacion' });
    if (st.fab) u.set('fab', st.fab);
    history.replaceState(null, '', `${location.pathname}?${u}`);
  };
  async function opciones() {
    if (!st.opciones) st.opciones = await api('GET', '/api/fabricacion/opciones');
    return st.opciones;
  }
  async function tareasDe(proyectoId) {
    if (!proyectoId) return { partidas: [], tareas: [] };
    if (!st.tareas.has(proyectoId)) st.tareas.set(proyectoId, await api('GET', `/api/fabricacion/proyecto/${proyectoId}`));
    return st.tareas.get(proyectoId);
  }

  /* ================= Seguimiento por columnas ================= */
  async function pintarSeguimiento() {
    const d = await api('GET', '/api/fabricacion');
    const peds = d.pedidos.filter((p) => p.estado !== 'anulado');
    const items = peds.flatMap((ped) => ped.partes.map((p) => ({ ped, p, col: columnaDe(ped, p) })))
      .filter(({ ped, p }) => (!st.filtroProv || String(ped.proveedor_id) === st.filtroProv)
        && (!st.filtroProy || String(ped.proyecto_id) === st.filtroProy)
        && (!st.soloRetraso || p.tarde_montaje > 0 || p.calc.retrasada)
        && (!st.buscar || norm(`${p.nombre} ${p.detalle} ${ped.codigo} ${ped.titulo} ${ped.proveedor} ${ped.proyecto_codigo} ${ped.proyecto_nombre}`).includes(norm(st.buscar))));
    const talleres = [...new Map(peds.map((p) => [p.proveedor_id, p.proveedor]))];
    const proys = [...new Map(peds.filter((p) => p.proyecto_id).map((p) => [p.proyecto_id, `${p.proyecto_codigo} ${p.proyecto_nombre}`]))];
    const nRetraso = peds.flatMap((x) => x.partes).filter((p) => p.tarde_montaje > 0 || p.calc.retrasada).length;
    const chip = (txt, activo, onclick, extra = '') => el('button', { type: 'button', class: `fab-chip${activo ? ' act' : ''}${extra}`, onclick }, txt);
    const repintar = () => pintarSeguimiento().catch((e) => toast(e.message, true));

    const cols = COLUMNAS.filter(([k]) => k !== 'otro' || items.some((x) => x.col === 'otro'));
    panel.replaceChildren(el('section', { class: 'panel fab-seg', 'data-ayuda': 'fab-seguimiento' },
      el('div', { class: 'cab-panel' },
        el('div', {}, el('h2', {}, 'Dónde está cada cosa'),
          el('p', { class: 'ayuda' }, 'Cada tarjeta es una parte de un pedido. La mueve quien hace cada etapa desde su enlace (taller, galvanizadora) y vosotros al recibirla. Pulsa una tarjeta para abrir el pedido.')),
        el('div', { class: 'fab-cab-acc' },
          puedeEditar() ? el('button', { type: 'button', class: 'ghost', onclick: () => dialogoRecorridos() }, '⚙ Recorridos') : null,
          puedeEditar() ? el('button', { type: 'button', class: 'primario', 'data-ayuda': 'fab-nuevo', onclick: () => dialogoNuevo() }, '＋ Pedido de fabricación') : null)),
      el('div', { class: 'fab-filtros' },
        el('input', { type: 'search', placeholder: 'Buscar pieza, pedido, proyecto…', value: st.buscar, 'aria-label': 'Buscar',
          oninput: (ev) => { st.buscar = ev.target.value; clearTimeout(repintar._t); repintar._t = setTimeout(repintar, 250); } }),
        chip(`Todos (${peds.length} pedidos · ${peds.reduce((s, p) => s + p.partes.length, 0)} partes)`, !st.filtroProv && !st.filtroProy && !st.soloRetraso,
          () => { st.filtroProv = ''; st.filtroProy = ''; st.soloRetraso = false; repintar(); }),
        talleres.length > 1 ? talleres.map(([id, n]) => chip(n, st.filtroProv === String(id), () => { st.filtroProv = st.filtroProv === String(id) ? '' : String(id); repintar(); })) : null,
        nRetraso ? chip(`⚠ Con retraso (${nRetraso})`, st.soloRetraso, () => { st.soloRetraso = !st.soloRetraso; repintar(); }, ' rojo') : null,
        proys.length > 1 ? el('select', { 'aria-label': 'Proyecto', onchange: (ev) => { st.filtroProy = ev.target.value; repintar(); } },
          el('option', { value: '' }, 'Todos los proyectos'), proys.map(([id, n]) => el('option', { value: id, selected: st.filtroProy === String(id) }, n))) : null),
      !peds.length ? el('div', { class: 'fab-vacio' },
        el('p', {}, 'Aún no hay pedidos de fabricación externa.'),
        el('p', { class: 'ayuda' }, 'Crea uno con «＋ Pedido de fabricación»: el taller, el recorrido (fabricación → galvanizado → pintura → transporte), las partes y su tarea de montaje. Luego mándale su enlace al taller.'))
        : el('div', { class: 'fab-kan', style: `--ncol:${cols.length}` }, cols.map(([k, nombre, sub]) => {
          const lista = items.filter((x) => x.col === k).sort((a, b) => (b.p.tarde_montaje - a.p.tarde_montaje) || String(a.p.calc.llegada).localeCompare(String(b.p.calc.llegada)));
          const quien = [...new Set(lista.map(({ ped, p }) => ped.etapas[p.etapa]?.responsable).filter(Boolean))].slice(0, 2).join(' · ');
          return el('div', { class: 'fab-col' },
            el('h3', {}, el('span', {}, nombre), el('span', { class: 'fab-n' }, String(lista.length))),
            el('div', { class: 'fab-col-sub' }, quien || sub),
            lista.map(({ ped, p }) => tarjeta(ped, p)));
        }))));
  }

  function tarjeta(ped, p) {
    const e = ped.etapas[p.etapa];
    const color = p.recibido_en || p.etapa >= ped.etapas.length ? 'var(--verde)' : COLOR[e?.tipo] || '#777';
    const ult = [p.comentario].filter(Boolean)[0];
    return el('button', {
      type: 'button', class: `fab-tar${p.tarde_montaje > 0 ? ' tarde' : ''}`, style: `--c:${color}`,
      onclick: () => { st.fab = ped.id; guardarURL(); pintar(); },
      title: `${ped.codigo} · ${ped.titulo}\n${p.nombre}${p.detalle ? ` · ${p.detalle}` : ''}\n${p.donde}`,
    },
    el('span', { class: 'fab-tar-t' }, p.nombre),
    el('span', { class: 'fab-tar-p', title: ped.proyecto_nombre || '' }, `${ped.codigo} · ${ped.proveedor}${ped.proyecto_codigo ? ` · ${ped.proyecto_codigo}` : ''}`),
    p.iniciada && p.avance != null && !p.recibido_en ? el('span', { class: 'fab-barra' }, el('i', { style: `width:${p.avance}%;background:${color}` })) : null,
    el('span', { class: 'fab-tar-f' },
      el('span', {}, p.recibido_en ? `✔ recibido ${ddmm(p.recibido_en)}` : p.donde.replace(/^en /, '')),
      p.recibido_en ? null : el('span', { class: p.calc.retrasada ? 'rojo' : '' }, `llega ~${ddmm(p.calc.llegada)}`)),
    p.tarde_montaje > 0 ? el('span', { class: 'fab-tar-f rojo' }, `⚠ montaje ${ddmm(p.montaje_proximo)} · ${p.tarde_montaje} día${p.tarde_montaje > 1 ? 's' : ''} tarde`)
      : p.montaje_proximo && !p.recibido_en ? el('span', { class: 'fab-tar-f verde' }, `montaje ${ddmm(p.montaje_proximo)} ✔`) : null,
    p.calc.retrasada && !p.tarde_montaje ? el('span', { class: 'fab-tar-f rojo' }, '⚠ se ha pasado la fecha prevista') : null,
    ult ? el('span', { class: 'fab-tar-c' }, `«${ult}»`) : null);
  }

  /* ================= Ficha del pedido ================= */
  async function pintarFicha() {
    const [d, op] = await Promise.all([api('GET', `/api/fabricacion/${st.fab}`), opciones()]);
    const tl = await tareasDe(d.proyecto_id);
    const editar = puedeEditar() && d.estado !== 'anulado';
    st.sel = new Set([...st.sel].filter((id) => d.partes.some((p) => p.id === id)));
    const guardar = async (cambios) => {
      try { await api('PATCH', `/api/fabricacion/${d.id}`, cambios); toast('Guardado'); if ('proyecto_id' in cambios || 'etapas' in cambios || 'estado' in cambios || 'proveedor_id' in cambios) pintar(); }
      catch (e) { toast(e.message, true); }
    };
    const campo = (txt, input, ancho) => el('label', { class: `cmp-campo${ancho ? ' ancho' : ''}` }, el('span', {}, txt), input);
    const inp = (k, attrs = {}) => el('input', { ...attrs, value: d[k] ?? '', disabled: !editar, onchange: (ev) => guardar({ [k]: ev.target.value }) });
    const sel = (k, opciones, vacio) => el('select', { disabled: !editar, onchange: (ev) => guardar({ [k]: ev.target.value || null }) },
      vacio ? el('option', { value: '' }, vacio) : null, opciones.map(([v, t]) => el('option', { value: v, selected: String(d[k] ?? '') === String(v) }, t)));

    // --- partes
    const nEt = d.etapas.length;
    const celdaEt = (p, i) => {
      const x = p.calc.etapas[i];
      const e = d.etapas[i];
      if (p.recibido_en || i < p.etapa) return el('span', { class: 'fab-et ok', title: `${e.nombre} ✔${x?.hasta ? ` ${ddmm(x.hasta)}` : ''}` }, `✔${x?.hasta ? ` ${ddmm(x.hasta)}` : ''}`);
      if (i === p.etapa) {
        const txt = !p.iniciada ? 'pend.' : e.tipo === 'transporte' ? `en camino` : p.avance != null ? `${p.avance} %` : 'en curso';
        return el('span', { class: `fab-et ${p.iniciada ? 'en' : 'pe'}`, style: `--c:${COLOR[e.tipo] || '#777'}`, title: `${e.nombre} · ${e.responsable}${x?.hasta ? ` · fin previsto ${ddmm(x.hasta)}` : ''}` }, txt);
      }
      return el('span', { class: 'fab-et', title: `${e.nombre} · previsto ${ddmm(x?.desde)}–${ddmm(x?.hasta)}` }, '');
    };
    const tareaSel = (p) => el('select', {
      class: 'fab-tarea', disabled: !editar, 'aria-label': `Tarea de montaje de ${p.nombre}`,
      onchange: async (ev) => { try { await api('PATCH', `/api/fabricacion/partes/${p.id}`, { tarea_id: Number(ev.target.value) || null }); toast('Guardado'); pintar(); } catch (e) { toast(e.message, true); } },
    }, el('option', { value: '' }, d.proyecto_id ? '— sin tarea de montaje —' : 'elige antes el proyecto'),
    p.tarea_id && !tl.tareas.some((t) => t.id === p.tarea_id) ? el('option', { value: p.tarea_id, selected: true }, `${p.orden_codigo || ''} · ${p.tarea_nombre || 'tarea'}`) : null,
    tl.tareas.map((t) => el('option', { value: t.id, selected: t.id === p.tarea_id }, `${t.orden_codigo} · ${t.nombre}`)));
    const marcar = (p, si) => { if (si) st.sel.add(p.id); else st.sel.delete(p.id); barraSel(); };
    const filas = d.partes.map((p) => el('tr', { class: p.recibido_en ? 'fab-recibida' : '' },
      el('td', {}, el('input', { type: 'checkbox', checked: st.sel.has(p.id), 'aria-label': `Elegir ${p.nombre}`, onchange: (ev) => marcar(p, ev.target.checked) })),
      el('td', { class: 'fab-parte' },
        editar ? el('input', { class: 'fab-in-nom', value: p.nombre, 'aria-label': 'Nombre de la parte', onchange: async (ev) => { try { await api('PATCH', `/api/fabricacion/partes/${p.id}`, { nombre: ev.target.value }); toast('Guardado'); } catch (e) { toast(e.message, true); } } }) : el('b', {}, p.nombre),
        editar ? el('input', { class: 'fab-in-det', value: p.detalle || '', placeholder: 'planos, cantidad…', 'aria-label': 'Detalle', onchange: async (ev) => { try { await api('PATCH', `/api/fabricacion/partes/${p.id}`, { detalle: ev.target.value }); } catch (e) { toast(e.message, true); } } }) : el('div', { class: 'ayuda' }, p.detalle || ''),
        p.comentario ? el('div', { class: 'fab-com' }, `«${p.comentario}»`) : null),
      el('td', {}, tareaSel(p)),
      el('td', {}, el('div', { class: 'fab-ets', style: `--n:${nEt}` }, d.etapas.map((e, i) => celdaEt(p, i)))),
      el('td', { class: 'fab-llega' },
        p.recibido_en ? el('span', { class: 'verde' }, `✔ ${fechaL(p.recibido_en)}`) : el('b', { class: p.calc.retrasada ? 'rojo' : '' }, `~${fechaL(p.calc.llegada)}`),
        p.montaje_proximo && !p.recibido_en ? el('div', { class: p.tarde_montaje ? 'rojo' : 'ayuda' }, `montaje ${ddmm(p.montaje_proximo)}${p.tarde_montaje ? ` · ⚠ ${p.tarde_montaje} d tarde` : ' ✔'}`) : null),
      el('td', { class: 'fab-acc' },
        !p.recibido_en && (editar || puedeRecibir()) ? el('button', { type: 'button', class: 'ghost mini', onclick: () => dialogoAccion(d, [p.id]) }, 'Actualizar…') : null,
        editar ? el('button', { type: 'button', class: 'ghost mini', title: 'Separar: crea otra parte en el mismo punto (para que avancen por separado)', onclick: () => separar(d, p) }, '✂') : null,
        editar && d.partes.length > 1 ? el('button', { type: 'button', class: 'ghost mini', title: 'Quitar esta parte', onclick: () => quitarParte(p) }, '✕') : null)));

    const barra = el('div', { class: 'fab-barra-sel', hidden: true });
    function barraSel() {
      const n = st.sel.size;
      barra.hidden = !n;
      barra.replaceChildren(el('span', {}, `${n} parte${n === 1 ? '' : 's'} elegida${n === 1 ? '' : 's'}`),
        editar ? el('button', { type: 'button', class: 'primario mini', onclick: () => dialogoAccion(d, [...st.sel]) }, 'Actualizar…') : null,
        puedeRecibir() ? el('button', { type: 'button', class: 'ghost mini', onclick: () => recibir(d, [...st.sel]) }, '✔ Recibido en Menorca') : null,
        el('button', { type: 'button', class: 'ghost mini', onclick: () => { st.sel.clear(); pintar(); } }, 'Quitar selección'));
    }
    barraSel();

    // --- enlaces
    const provEmail = (id) => op.proveedores.find((x) => x.id === id)?.email || '';
    const enlaces = d.enlaces.map((x) => el('div', { class: 'fab-enlace' },
      el('b', {}, x.nombre), el('span', { class: 'ayuda' }, x.proveedor_id === d.proveedor_id ? 'taller' : d.etapas.filter((e) => e.quien === 'proveedor' && e.proveedor_id === x.proveedor_id).map((e) => e.nombre).join(', ')),
      el('span', { class: 'ayuda' }, x.visto_en ? `👁 abierto ${cuando(x.visto_en)}` : 'aún no lo ha abierto'),
      el('button', { type: 'button', class: 'ghost mini', onclick: () => copiarEnlace(d, x.proveedor_id) }, '🔗 Copiar enlace'),
      editar ? el('button', { type: 'button', class: 'ghost mini', onclick: () => correoEnlace(d, x, provEmail(x.proveedor_id)) }, '✉ Por correo') : null));

    // --- historial
    const hist = d.eventos.map((e) => el('li', {},
      el('span', { class: 'fab-h-c' }, cuando(e.creado_en)),
      el('span', {}, el('b', {}, e.proveedor || e.usuario || '—'), e.parte ? ` · ${e.parte}` : '', `: ${e.texto || e.accion}`,
        e.comentario ? el('i', {}, ` «${e.comentario}»`) : null,
        e.archivos?.length ? el('span', { class: 'fab-h-arch' }, window.s360.adjuntos(e.archivos)) : null)));

    const recorrido = el('div', { class: 'fab-rec' }, d.etapas.flatMap((e, i) => [
      i ? el('span', { class: 'fab-flecha' }, '→') : null,
      el('span', { class: 'fab-paso', style: `--c:${COLOR[e.tipo] || '#777'}` }, `${i + 1} ${e.nombre}`, el('small', {}, ` · ${e.tipo === 'transporte' ? `lo entrega ${e.responsable}, ${e.dias} d` : `${e.responsable} · ~${e.dias} d`}`)),
    ]), el('span', { class: 'fab-flecha' }, '→'), el('span', { class: 'fab-paso', style: '--c:var(--verde)' }, '✔ Recibido', el('small', {}, ' · nosotros')),
    editar ? el('button', { type: 'button', class: 'ghost mini', onclick: () => dialogoCambiarRecorrido(d) }, '✎ Cambiar') : null);

    panel.replaceChildren(el('div', { class: 'fab-ficha' },
      el('div', { class: 'fab-volver' }, el('button', { type: 'button', class: 'ghost', onclick: () => { st.fab = null; st.sel.clear(); guardarURL(); pintar(); } }, '‹ Seguimiento')),
      el('section', { class: 'panel' },
        el('div', { class: 'cab-panel' },
          el('div', {}, el('h2', {}, `${d.codigo} · ${d.proveedor}`),
            el('p', { class: 'ayuda' }, [d.proyecto_codigo ? `${d.proyecto_codigo} ${d.proyecto_nombre}` : 'sin proyecto', d.partida_nombre ? `partida ${d.partida_codigo || ''} ${d.partida_nombre}` : null,
              `pedido el ${fechaL(d.fecha_pedido)}`, d.importe != null ? eur(d.importe) : null].filter(Boolean).join(' · '))),
          el('span', { class: `cmp-estado ${d.estado === 'en_curso' ? 'aviso' : d.estado === 'recibido' ? 'ok' : ''}` },
            { en_curso: d.llegada ? `En curso · llega ~${ddmm(d.llegada)}` : 'En curso', recibido: 'Recibido', anulado: 'Anulado' }[d.estado])),
        el('h3', { class: 'cmp-h3' }, 'Recorrido'), recorrido,
        el('h3', { class: 'cmp-h3' }, 'Partes ', el('span', { class: 'ayuda', style: 'text-transform:none;letter-spacing:0' }, '· cada una avanza por su cuenta; ✂ separa una parte en dos')),
        el('div', { class: 'fab-tabla-caja' }, el('table', { class: 'tabla fab-tabla' },
          el('thead', {}, el('tr', {}, el('th', {}), el('th', {}, 'Parte'), el('th', {}, 'Tarea de montaje'),
            el('th', {}, el('div', { class: 'fab-ets cab', style: `--n:${nEt}` }, d.etapas.map((e) => el('span', { title: `${e.nombre} · ${e.responsable}` }, e.nombre)))),
            el('th', {}, 'Llega'), el('th', {}))),
          el('tbody', {}, filas))),
        barra,
        editar ? el('div', { class: 'cmp-acciones', style: 'justify-content:flex-start;margin-top:8px' },
          el('button', { type: 'button', class: 'ghost mini', onclick: () => nuevaParte(d) }, '＋ Añadir parte')) : null,
        el('h3', { class: 'cmp-h3' }, 'Enlaces de los proveedores'),
        el('p', { class: 'ayuda' }, 'Cada uno ve el pedido y los planos y actualiza solo sus etapas, sin cuenta ni contraseña. No ven importes.'),
        el('div', { class: 'fab-enlaces' }, enlaces)),
      el('div', { class: 'fab-dos' },
        el('section', { class: 'panel' }, el('h3', { class: 'cmp-h3', style: 'margin-top:0' }, 'Datos del pedido'),
          el('div', { class: 'cmp-campos' },
            campo('Título', inp('titulo', { maxlength: 160 }), true),
            campo('Taller', sel('proveedor_id', op.proveedores.map((x) => [x.id, x.nombre]))),
            campo('Proyecto', sel('proyecto_id', op.proyectos.map((x) => [x.id, `${x.codigo} ${x.nombre}`]), '— sin proyecto —')),
            campo('Partida (para costes)', sel('partida_id', tl.partidas.map((x) => [x.id, `${x.codigo || ''} ${x.nombre}`]), '—')),
            campo('Importe del pedido (€)', inp('importe', { type: 'number', step: '0.01', min: '0' })),
            campo('Fecha del pedido', inp('fecha_pedido', { type: 'date' })),
            campo('Enlace a los planos (Drive, WeTransfer…)', inp('planos_enlace', { type: 'url', placeholder: 'https://…' }), true),
            campo('Notas', el('textarea', { rows: 3, disabled: !editar, onchange: (ev) => guardar({ notas: ev.target.value }) }, d.notas || ''), true)),
          el('h3', { class: 'cmp-h3' }, 'Planos'),
          d.planos.length ? window.s360.adjuntos(d.planos) : el('p', { class: 'ayuda' }, 'Sin planos adjuntos.'),
          editar ? el('div', { class: 'cmp-acciones', style: 'justify-content:flex-start;margin-top:6px' },
            el('label', { class: 'boton ghost mini' }, '📎 Adjuntar planos (PDF)',
              el('input', { type: 'file', accept: 'application/pdf,image/*', multiple: true, hidden: true, onchange: (ev) => subirPlanos(d, ev.target.files) })),
            d.planos.length ? el('select', { class: 'mini', 'aria-label': 'Quitar plano', onchange: async (ev) => { if (!ev.target.value) return; try { await api('DELETE', `/api/fabricacion/${d.id}/planos/${ev.target.value}`); pintar(); } catch (e) { toast(e.message, true); } } },
              el('option', { value: '' }, 'Quitar un plano…'), d.planos.map((a) => el('option', { value: a.id }, a.nombre || `archivo ${a.id}`))) : null) : null,
          puedeEditar() ? el('div', { class: 'cmp-acciones', style: 'margin-top:14px' },
            d.estado === 'anulado' ? el('button', { type: 'button', class: 'ghost', onclick: () => guardar({ estado: 'en_curso' }) }, 'Reactivar')
              : d.estado === 'en_curso' ? el('button', { type: 'button', class: 'peligro', onclick: () => { if (confirm(`¿Anular ${d.codigo}? Deja de salir en el seguimiento y en el tablero.`)) guardar({ estado: 'anulado' }); } }, 'Anular pedido') : null) : null),
        el('section', { class: 'panel' }, el('h3', { class: 'cmp-h3', style: 'margin-top:0' }, 'Historial'),
          el('ul', { class: 'fab-hist' }, hist)))));
  }

  /* ---------- acciones ---------- */
  async function copiarEnlace(d, provId) {
    try {
      const { url } = await api('POST', `/api/fabricacion/${d.id}/enlace`, { proveedor_id: provId });
      try { await navigator.clipboard.writeText(url); toast('Enlace copiado: pégalo en un correo o un WhatsApp'); }
      catch { prompt('Copia el enlace:', url); }
    } catch (e) { toast(e.message, true); }
  }
  async function correoEnlace(d, x, email) {
    try {
      const { url } = await api('POST', `/api/fabricacion/${d.id}/enlace`, { proveedor_id: x.proveedor_id });
      const emp = (await opciones()).empresa || '';
      const cuerpo = `Hola,\n\nPara el pedido ${d.codigo} (${d.titulo}), en este enlace tenéis los planos y podéis ir indicando cómo va cada parte (avance, fecha prevista, fotos), sin registraros:\n\n${url}\n\nGracias.\n${emp}`;
      location.href = `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(`${d.codigo} · seguimiento de fabricación`)}&body=${encodeURIComponent(cuerpo)}`;
    } catch (e) { toast(e.message, true); }
  }
  async function subirPlanos(d, files) {
    try {
      const ids = [];
      for (const f of files) ids.push(await window.s360.subirArchivo(f));
      await api('POST', `/api/fabricacion/${d.id}/planos`, { archivos: ids });
      toast(`${ids.length} plano(s) adjuntados`); pintar();
    } catch (e) { toast(e.message, true); }
  }
  async function separar(d, p) {
    const nombre = prompt(`Nueva parte, separada de «${p.nombre}» (sale en el mismo punto y luego avanza por su cuenta). Nombre:`, `${p.nombre} (2)`);
    if (!nombre) return;
    try { await api('POST', `/api/fabricacion/${d.id}/partes`, { nombre, de: p.id }); toast('Parte separada'); pintar(); } catch (e) { toast(e.message, true); }
  }
  async function nuevaParte(d) {
    const nombre = prompt('Nombre de la parte nueva (p. ej. «Barandilla · tramos 1–3»):');
    if (!nombre) return;
    try { await api('POST', `/api/fabricacion/${d.id}/partes`, { nombre }); pintar(); } catch (e) { toast(e.message, true); }
  }
  async function quitarParte(p) {
    if (!confirm(`¿Quitar «${p.nombre}» del pedido? Se pierde su historial.`)) return;
    try { await api('DELETE', `/api/fabricacion/partes/${p.id}`); pintar(); } catch (e) { toast(e.message, true); }
  }
  async function recibir(d, ids) {
    const n = d.partes.filter((p) => ids.includes(p.id) && !p.recibido_en);
    if (!n.length) return toast('Ya está todo recibido');
    if (!confirm(`¿Marcar como recibido hoy en Menorca: ${n.map((p) => p.nombre).join(', ')}?`)) return;
    try { await api('POST', `/api/fabricacion/${d.id}/accion`, { accion: 'recibir', partes: n.map((p) => p.id) }); st.sel.clear(); toast('Recibido'); pintar(); } catch (e) { toast(e.message, true); }
  }

  // Actualizar una o varias partes desde la oficina (lo mismo que hace el taller, y además corregir y recibir)
  function dialogoAccion(d, ids) {
    const partes = d.partes.filter((p) => ids.includes(p.id) && !p.recibido_en);
    if (!partes.length) return;
    const una = partes.length === 1 ? partes[0] : null;
    const e = una ? d.etapas[una.etapa] : null;
    const sig = una ? d.etapas[una.etapa + 1] : null;
    const opciones = [
      puedeEditar() ? ['avance', 'Avance de la etapa en curso', 'porcentaje, fecha prevista y comentario'] : null,
      puedeEditar() ? ['empezar', una && e?.tipo === 'transporte' ? `Entregado a ${e.transportista || 'transporte'}` : 'Empieza la etapa', una && e ? e.nombre : 'la que toque a cada parte'] : null,
      puedeEditar() ? ['terminar', 'Termina la etapa y pasa a la siguiente', una && e ? `${e.nombre}${sig ? ` → ${sig.nombre}` : ''}` : ''] : null,
      ['recibir', 'Recibido en Menorca', 'llega aquí: se cierra'],
      puedeEditar() ? ['poner', 'Corregir: ponerla en otra etapa', 'si alguien se olvidó de marcarlo'] : null,
    ].filter(Boolean);
    let accion = opciones[0][0];
    const avance = el('input', { type: 'number', min: '0', max: '100', step: '5', value: una?.avance ?? '', placeholder: '%' });
    const previsto = el('input', { type: 'date', value: una?.previsto || '' });
    const comentario = el('textarea', { rows: 2, placeholder: una?.comentario ? `Último: «${una.comentario}»` : 'Comentario (opcional)' });
    const entregar = el('input', { type: 'checkbox', checked: sig?.tipo === 'transporte' });
    const etapaSel = el('select', {}, d.etapas.map((x, i) => el('option', { value: i, selected: una && i === una.etapa }, `${i + 1} · ${x.nombre}`)), el('option', { value: d.etapas.length }, 'Todas hechas · falta recibir'));
    const iniciada = el('input', { type: 'checkbox', checked: true });
    const fotos = []; const lista = el('span', { class: 'ayuda' });
    const extra = el('div', { class: 'cmp-campos' });
    const pintarExtra = () => extra.replaceChildren(...({
      avance: [el('label', { class: 'cmp-campo' }, el('span', {}, 'Avance (%)'), avance), el('label', { class: 'cmp-campo' }, el('span', {}, 'Fin previsto de la etapa'), previsto)],
      empezar: [el('label', { class: 'cmp-campo' }, el('span', {}, una && e?.tipo === 'transporte' ? 'Llegada prevista (si la sabes)' : 'Fin previsto (si lo sabes)'), previsto)],
      terminar: sig?.tipo === 'transporte' || !una ? [el('label', { class: 'chk ancho' }, entregar, ` y entregado ya a ${sig?.transportista || 'transporte'} (empieza el transporte)`)] : [],
      recibir: [], poner: [el('label', { class: 'cmp-campo' }, el('span', {}, 'Etapa'), etapaSel), el('label', { class: 'chk' }, iniciada, ' ya empezada')],
    }[accion] || []), accion !== 'recibir' ? el('label', { class: 'cmp-campo ancho' }, el('span', {}, 'Comentario'), comentario) : null,
    accion !== 'recibir' && accion !== 'poner' ? el('div', { class: 'ancho' }, el('label', { class: 'boton ghost mini' }, '📷 Foto o PDF', el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true,
      onchange: async (ev) => { for (const f of ev.target.files) { try { fotos.push(await window.s360.subirArchivo(f)); } catch (er) { toast(er.message, true); } } lista.textContent = ` ${fotos.length} adjunto(s)`; } })), lista) : null);
    const radios = el('div', { class: 'fab-radios' }, opciones.map(([k, t, s]) => el('label', {},
      el('input', { type: 'radio', name: 'fab-acc', value: k, checked: k === accion, onchange: () => { accion = k; pintarExtra(); } }),
      el('span', {}, el('b', {}, t), s ? el('small', { class: 'ayuda' }, ` · ${s}`) : null))));
    pintarExtra();
    const dlg = el('dialog', { class: 'dlg-fab' },
      el('div', { class: 'dlg-cab' }, el('h2', {}, una ? `Actualizar «${una.nombre}»` : `Actualizar ${partes.length} partes`), el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, '✕')),
      el('p', { class: 'ayuda' }, una ? `Ahora: ${una.donde}` : partes.map((p) => `${p.nombre}: ${p.donde}`).join(' · ')),
      radios, extra,
      el('div', { class: 'cmp-acciones', style: 'margin-top:12px' },
        el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          const b = { accion, partes: partes.map((p) => p.id), comentario: comentario.value.trim() || undefined, archivos: fotos };
          if (accion === 'avance') { b.avance = avance.value; b.previsto = previsto.value || null; }
          if (accion === 'empezar' && previsto.value) b.previsto = previsto.value;
          if (accion === 'terminar') b.entregar = entregar.checked;
          if (accion === 'poner') { b.etapa = Number(etapaSel.value); b.iniciada = iniciada.checked; }
          if (accion === 'recibir') delete b.comentario;
          try { await api('POST', `/api/fabricacion/${d.id}/accion`, b); dlg.close(); st.sel.clear(); toast('Actualizado'); pintar(); }
          catch (er) { toast(er.message, true); ev.target.disabled = false; }
        } }, 'Guardar')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  /* ---------- recorridos (etapas) ---------- */
  function editorEtapas(etapas, op) {
    const filas = etapas.map((e) => ({ ...e }));
    const caja = el('div', { class: 'fab-ed' });
    const pintarEd = () => caja.replaceChildren(
      el('div', { class: 'fab-ed-cab' }, el('span', {}, 'Etapa'), el('span', {}, 'Clase'), el('span', {}, 'La actualiza'), el('span', {}, ''), el('span', {}, 'Días'), el('span', {})),
      ...filas.map((e, i) => el('div', { class: 'fab-ed-fila' },
        el('input', { value: e.nombre, 'aria-label': 'Nombre de la etapa', maxlength: 60, oninput: (ev) => { e.nombre = ev.target.value; } }),
        el('select', { 'aria-label': 'Clase', onchange: (ev) => { e.tipo = ev.target.value; if (e.tipo === 'transporte' && !e.transportista) e.transportista = 'Ydica'; pintarEd(); } },
          Object.entries(op.tipos).map(([k, t]) => el('option', { value: k, selected: k === e.tipo }, t))),
        el('select', { 'aria-label': 'Quién la actualiza', onchange: (ev) => { e.quien = ev.target.value; pintarEd(); } },
          el('option', { value: 'taller', selected: e.quien === 'taller' }, e.tipo === 'transporte' ? 'El taller (al entregar)' : 'El taller del pedido'),
          el('option', { value: 'proveedor', selected: e.quien === 'proveedor' }, 'Otro proveedor…'),
          el('option', { value: 'nosotros', selected: e.quien === 'nosotros' }, 'Nosotros')),
        e.quien === 'proveedor'
          ? el('select', { 'aria-label': 'Proveedor', onchange: (ev) => { e.proveedor_id = Number(ev.target.value) || null; } },
            el('option', { value: '' }, '— elige —'), op.proveedores.map((x) => el('option', { value: x.id, selected: x.id === e.proveedor_id }, x.nombre)))
          : e.tipo === 'transporte' ? el('input', { value: e.transportista || '', placeholder: 'transportista', 'aria-label': 'Transportista', oninput: (ev) => { e.transportista = ev.target.value; } }) : el('span'),
        el('input', { type: 'number', min: '0', max: '120', value: e.dias ?? 0, 'aria-label': 'Días típicos', oninput: (ev) => { e.dias = Number(ev.target.value); } }),
        el('span', { class: 'fab-ed-acc' },
          el('button', { type: 'button', class: 'ghost mini', disabled: !i, 'aria-label': 'Subir', onclick: () => { [filas[i - 1], filas[i]] = [filas[i], filas[i - 1]]; pintarEd(); } }, '↑'),
          el('button', { type: 'button', class: 'ghost mini', disabled: i === filas.length - 1, 'aria-label': 'Bajar', onclick: () => { [filas[i + 1], filas[i]] = [filas[i], filas[i + 1]]; pintarEd(); } }, '↓'),
          el('button', { type: 'button', class: 'ghost mini', disabled: filas.length < 2, 'aria-label': 'Quitar', onclick: () => { filas.splice(i, 1); pintarEd(); } }, '✕')))),
      el('div', { class: 'fab-ed-pie' },
        el('button', { type: 'button', class: 'ghost mini', onclick: () => { filas.splice(Math.max(0, filas.length - (filas.at(-1)?.tipo === 'transporte' ? 1 : 0)), 0, { nombre: 'Etapa', tipo: 'otro', quien: 'taller', dias: 3 }); pintarEd(); } }, '＋ Etapa'),
        el('span', { class: 'ayuda' }, 'Días: lo típico de cada etapa, para calcular cuándo llega. «Recibido» lo marcáis vosotros al final.')));
    pintarEd();
    return { nodo: caja, valor: () => filas };
  }

  async function dialogoCambiarRecorrido(d) {
    const op = await opciones();
    const ed = editorEtapas(d.etapas, op);
    const dlg = el('dialog', { class: 'dlg-fab ancho' },
      el('div', { class: 'dlg-cab' }, el('h2', {}, `Recorrido de ${d.codigo}`), el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, '✕')),
      el('label', { class: 'cmp-campo' }, el('span', {}, 'Partir de una plantilla'),
        el('select', { onchange: (ev) => { const p = op.plantillas.find((x) => x.id === ev.target.value); if (p) { const n = editorEtapas(p.etapas, op); ed.nodo.replaceWith(n.nodo); Object.assign(ed, n); } } },
          el('option', { value: '' }, '— mantener —'), op.plantillas.map((p) => el('option', { value: p.id }, p.nombre)))),
      ed.nodo,
      el('p', { class: 'ayuda' }, 'Si quitas etapas, las partes que estaban en ellas pasan a la última que quede.'),
      el('div', { class: 'cmp-acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          try { await api('PATCH', `/api/fabricacion/${d.id}`, { etapas: ed.valor() }); dlg.close(); toast('Recorrido cambiado'); pintar(); } catch (e) { toast(e.message, true); }
        } }, 'Guardar')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  async function dialogoRecorridos() {
    const op = await opciones();
    const pls = op.plantillas.map((p) => ({ ...p, ed: editorEtapas(p.etapas, op) }));
    const lista = el('div', { class: 'fab-pls' });
    const pintarLista = () => lista.replaceChildren(...pls.map((p, i) => el('details', { class: 'fab-pl', open: !!p.nueva },
      el('summary', {}, el('b', {}, p.nombre), el('span', { class: 'ayuda' }, ` · ${p.ed.valor().map((e) => e.nombre).join(' → ')}`)),
      el('div', { class: 'fab-pl-cuerpo' },
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Nombre del recorrido'), el('input', { value: p.nombre, maxlength: 80, oninput: (ev) => { p.nombre = ev.target.value; } })),
        p.ed.nodo,
        el('button', { type: 'button', class: 'ghost mini peligro', onclick: () => { if (confirm(`¿Quitar el recorrido «${p.nombre}»? Los pedidos ya creados no cambian.`)) { pls.splice(i, 1); pintarLista(); } } }, 'Quitar este recorrido')))));
    pintarLista();
    const dlg = el('dialog', { class: 'dlg-fab ancho' },
      el('div', { class: 'dlg-cab' }, el('h2', {}, 'Recorridos de fabricación externa'), el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, '✕')),
      el('p', { class: 'ayuda' }, 'Plantillas de etapas para los pedidos nuevos: qué pasos lleva, quién actualiza cada uno y cuántos días suele tardar. Cada pedido copia su recorrido y se puede retocar.'),
      lista,
      el('div', { class: 'cmp-acciones', style: 'justify-content:space-between' },
        el('button', { type: 'button', class: 'ghost', onclick: () => { pls.push({ id: `p${Date.now()}`, nombre: 'Recorrido nuevo', nueva: true, ed: editorEtapas([{ nombre: 'Fabricación', tipo: 'fabricacion', quien: 'taller', dias: 10 }, { nombre: 'Transporte Ydica', tipo: 'transporte', quien: 'taller', transportista: 'Ydica', dias: 3 }], op) }); pintarLista(); } }, '＋ Recorrido'),
        el('span', {}, el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancelar'), ' ',
          el('button', { type: 'button', class: 'primario', onclick: async () => {
            try {
              const r = await api('PUT', '/api/fabricacion/plantillas', pls.map((p) => ({ id: p.id, nombre: p.nombre, etapas: p.ed.valor() })));
              st.opciones.plantillas = r; dlg.close(); toast('Recorridos guardados');
            } catch (e) { toast(e.message, true); }
          } }, 'Guardar'))));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  /* ---------- nuevo pedido ---------- */
  async function dialogoNuevo() {
    const op = await opciones();
    const v = { proveedor_id: '', proyecto_id: '', partida_id: '', titulo: '', importe: '', fecha_pedido: new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10), planos_enlace: '' };
    let ed = editorEtapas(op.plantillas[0]?.etapas || [], op);
    const partes = [{ nombre: '', detalle: '', tarea_id: '' }];
    let tl = { partidas: [], tareas: [] };
    const planos = []; const planosTxt = el('span', { class: 'ayuda' });
    const inp = (k, attrs = {}) => el('input', { ...attrs, value: v[k], oninput: (ev) => { v[k] = ev.target.value; } });
    const campo = (txt, input, ancho) => el('label', { class: `cmp-campo${ancho ? ' ancho' : ''}` }, el('span', {}, txt), input);
    const partidaSel = el('select', { onchange: (ev) => { v.partida_id = ev.target.value; } });
    const cajaPartes = el('div', { class: 'fab-np-partes' });
    const pintarPartes = () => {
      partidaSel.replaceChildren(el('option', { value: '' }, '—'), tl.partidas.map((x) => el('option', { value: x.id }, `${x.codigo || ''} ${x.nombre}`)));
      cajaPartes.replaceChildren(...partes.map((p, i) => el('div', { class: 'fab-np-fila' },
        el('input', { value: p.nombre, placeholder: i === 0 && partes.length === 1 ? 'Pedido completo (o la primera parte)' : `Parte ${i + 1}`, 'aria-label': 'Nombre de la parte', oninput: (ev) => { p.nombre = ev.target.value; } }),
        el('input', { value: p.detalle, placeholder: 'planos, cantidad…', 'aria-label': 'Detalle', oninput: (ev) => { p.detalle = ev.target.value; } }),
        el('select', { 'aria-label': 'Tarea de montaje', onchange: (ev) => { p.tarea_id = ev.target.value; } },
          el('option', { value: '' }, v.proyecto_id ? '— tarea de montaje —' : 'elige el proyecto'), tl.tareas.map((t) => el('option', { value: t.id, selected: String(t.id) === String(p.tarea_id) }, `${t.orden_codigo} · ${t.nombre}`))),
        el('button', { type: 'button', class: 'ghost mini', disabled: partes.length < 2, 'aria-label': 'Quitar parte', onclick: () => { partes.splice(i, 1); pintarPartes(); } }, '✕'))),
      el('button', { type: 'button', class: 'ghost mini', onclick: () => { partes.push({ nombre: '', detalle: '', tarea_id: '' }); pintarPartes(); } }, '＋ Otra parte'));
    };
    pintarPartes();
    const cajaEd = el('div', {}, ed.nodo);
    const dlg = el('dialog', { class: 'dlg-fab ancho' },
      el('div', { class: 'dlg-cab' }, el('h2', {}, 'Nuevo pedido de fabricación externa'), el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, '✕')),
      el('div', { class: 'cmp-campos' },
        campo('Taller', el('select', { onchange: (ev) => { v.proveedor_id = ev.target.value; } }, el('option', { value: '' }, '— elige —'), op.proveedores.map((x) => el('option', { value: x.id }, x.nombre)))),
        campo('Proyecto', el('select', { onchange: async (ev) => { v.proyecto_id = ev.target.value; tl = await tareasDe(Number(v.proyecto_id)); for (const p of partes) p.tarea_id = ''; pintarPartes(); } },
          el('option', { value: '' }, '— sin proyecto —'), op.proyectos.map((x) => el('option', { value: x.id }, `${x.codigo} ${x.nombre}`)))),
        campo('Partida (para costes)', partidaSel),
        campo('Título', inp('titulo', { placeholder: 'p. ej. Escalera y barandillas', maxlength: 160 })),
        campo('Importe (€)', inp('importe', { type: 'number', step: '0.01', min: '0' })),
        campo('Fecha del pedido', inp('fecha_pedido', { type: 'date' })),
        campo('Enlace a los planos (opcional)', inp('planos_enlace', { type: 'url', placeholder: 'https://… (Drive, WeTransfer)' }), true),
        el('div', { class: 'ancho' }, el('label', { class: 'boton ghost mini' }, '📎 Adjuntar planos (PDF, hasta 6 MB cada uno)',
          el('input', { type: 'file', accept: 'application/pdf,image/*', multiple: true, hidden: true, onchange: async (ev) => {
            for (const f of ev.target.files) { try { planos.push(await window.s360.subirArchivo(f)); } catch (e) { toast(e.message, true); } }
            planosTxt.textContent = ` ${planos.length} plano(s) listos`;
          } })), planosTxt)),
      el('h3', { class: 'cmp-h3' }, 'Recorrido'),
      el('select', { 'aria-label': 'Plantilla de recorrido', onchange: (ev) => { const p = op.plantillas.find((x) => x.id === ev.target.value); if (p) { ed = editorEtapas(p.etapas, op); cajaEd.replaceChildren(ed.nodo); } } },
        op.plantillas.map((p) => el('option', { value: p.id }, p.nombre))),
      cajaEd,
      el('h3', { class: 'cmp-h3' }, 'Partes ', el('span', { class: 'ayuda', style: 'text-transform:none;letter-spacing:0' }, '· una sola si se sigue el pedido entero; varias si llegan por separado')),
      cajaPartes,
      el('div', { class: 'cmp-acciones', style: 'margin-top:12px' },
        el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async (ev) => {
          if (!v.proveedor_id) return toast('Elige el taller', true);
          ev.currentTarget.disabled = true;
          try {
            const r = await api('POST', '/api/fabricacion', { ...v, etapas: ed.valor(), planos,
              partes: partes.map((p, i) => ({ ...p, nombre: p.nombre || (partes.length === 1 ? v.titulo || 'Pedido completo' : `Parte ${i + 1}`) })) });
            dlg.close(); st.fab = r.id; guardarURL(); toast(`${r.codigo} creado: ahora manda su enlace al taller`); pintar();
          } catch (e) { toast(e.message, true); ev.target.disabled = false; }
        } }, 'Crear pedido')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  function pintar() {
    return (st.fab ? pintarFicha() : pintarSeguimiento()).catch((e) => {
      if (st.fab && /no encontrado/i.test(e.message)) { st.fab = null; guardarURL(); return pintar(); }
      toast(e.message, true);
    });
  }

  window.s360Fab = {
    pintar(contenedor) { panel = contenedor; guardarURL(); return pintar(); },
    abierto: () => !!document.querySelector('dialog.dlg-fab[open]'),
  };
})();
