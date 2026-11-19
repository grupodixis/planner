/* s360_planificacion · pantalla Proyectos y OTs */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v ?? '';
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };

  function toast(msg, error = false) {
    const t = $('#toast');
    (document.querySelector('dialog[open]') || document.body).append(t);
    t.textContent = msg;
    t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 2600);
  }

  async function api(metodo, url, cuerpo) {
    const r = await fetch(url, {
      method: metodo,
      headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      credentials: 'same-origin',
    });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('No autenticado'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    return data;
  }

  const PRIORIDADES = { 1: 'Urgente', 2: 'Alta', 3: 'Normal', 4: 'Baja' };
  const ESTADO_TAREA = { en_curso: 'En curso', hecha: 'Hecha' };
  const durTxt = (h) => `${String(h).replace('.', ',')}h`;
  const fechaCorta = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

  const estado = {
    usuario: null,
    catalogo: { areas: [], recursos: [], tipos: [], colores: [] },
    partidas: [],
    proyectos: [],
    proyectoId: null,
    ots: [],
    otId: null,
    ot: null,
  };
  const puedeEditar = () => window.s360.tiene('proyectos');

  // Recuerda la selección en la URL para que recargar no la pierda
  function guardarURL() {
    const q = new URLSearchParams();
    if (estado.proyectoId) q.set('p', estado.proyectoId);
    if (estado.otId) q.set('ot', estado.otId);
    history.replaceState(null, '', `${location.pathname}${q.toString() ? '?' + q : ''}`);
  }

  /* ---------- campo editable que guarda al salir ---------- */
  function campo({ etiqueta, valor, tipo = 'text', opciones, max, ancho, guardar, obligatorio, filas }) {
    const id = `c-${Math.random().toString(36).slice(2, 8)}`;
    let input;
    if (opciones) {
      input = el('select', { id }, Object.entries(opciones).map(([v, t]) =>
        el('option', { value: v, selected: String(v) === String(valor ?? '') }, t)));
    } else if (filas) {
      input = el('textarea', { id, rows: filas, maxlength: max });
      input.value = valor ?? '';
    } else {
      input = el('input', { id, type: tipo, maxlength: max, value: valor ?? '' });
    }
    input.disabled = !puedeEditar();
    let previo = input.value;
    input.addEventListener('change', async () => {
      const v = input.value.trim();
      if (obligatorio && !v) { input.value = previo; return toast(`${etiqueta} es obligatorio`, true); }
      try { await guardar(v === '' ? null : v); previo = input.value; toast('Guardado'); }
      catch (e) { toast(e.message, true); input.value = previo; }
    });
    return el('div', { class: `campo${ancho ? ' ' + ancho : ''}` }, el('label', { for: id }, etiqueta), input);
  }

  /* ---------- proyectos ---------- */
  async function cargarProyectos() {
    estado.proyectos = await api('GET', '/api/proyectos');
    pintarProyectos();
  }

  function pintarProyectos() {
    const q = $('#buscar-proyecto').value.trim().toLowerCase();
    const cerrados = $('#ver-cerrados').checked;
    const lista = estado.proyectos.filter((p) =>
      (cerrados || p.estado === 'activo' || p.id === estado.proyectoId) &&
      (!q || `${p.codigo} ${p.nombre || ''} ${p.cliente || ''} ${p.obra || ''}`.toLowerCase().includes(q)));

    $('#lista-proyectos').replaceChildren(...(lista.length ? lista.map((p) => el('li', {},
      el('button', {
        class: `item${p.id === estado.proyectoId ? ' sel' : ''}${p.estado === 'cerrado' ? ' cerrado' : ''}`,
        'aria-current': p.id === estado.proyectoId ? 'true' : false,
        onclick: () => elegirProyecto(p.id),
      },
        el('span', { class: 'item-tit' }, el('b', {}, p.codigo), ` ${p.nombre || ''}`),
        el('span', { class: 'item-sub' },
          [p.cliente, `${p.ots_abiertas} OT abiertas${p.ots > p.ots_abiertas ? ` · ${p.ots - p.ots_abiertas} cerradas` : ''}`,
           p.estado === 'cerrado' ? 'cerrado' : null].filter(Boolean).join(' · ')),
        condPendientes(p) ? el('span', { class: 'item-sub aviso-cond' }, `⚠ ${condPendientes(p)} condición(es) previa(s) pendiente(s)`) : null,
        p.avance?.tareas ? el('span', { class: 'item-sub' }, window.s360.chipAvance(p.avance)) : null,
      ))) : [el('li', { class: 'ayuda' }, q ? 'Ningún proyecto coincide.' : 'Todavía no hay proyectos.')]));
  }

  async function elegirProyecto(id) {
    estado.proyectoId = id;
    if (estado.ot && estado.ot.proyecto_id !== id) { estado.otId = null; estado.ot = null; pintarOT(); }
    guardarURL();
    pintarProyectos();
    pintarFichaProyecto();
    await cargarOTs();
  }

  function pintarFichaProyecto() {
    const p = estado.proyectos.find((x) => x.id === estado.proyectoId);
    $('#proyecto-vacio').hidden = !!p;
    $('#proyecto-ficha').hidden = !p;
    if (!p) return;
    $('#proyecto-titulo').textContent = `${p.codigo} · ${p.nombre || ''}`;
    $('#proyecto-avance').replaceChildren(window.s360.chipAvance(p.avance) || '');
    $('#proyecto-borrar').hidden = !puedeEditar();
    $('#form-ot').hidden = !puedeEditar() || p.estado === 'cerrado';

    const guardar = (k) => async (v) => {
      const r = await api('PATCH', `/api/proyectos/${p.id}`, { [k]: v });
      Object.assign(p, r);
      $('#proyecto-titulo').textContent = `${p.codigo} · ${p.nombre || ''}`;
      if (k === 'estado') pintarFichaProyecto();
      pintarProyectos();
    };
    $('#proyecto-campos').replaceChildren(
      campo({ etiqueta: 'Código', valor: p.codigo, max: 30, ancho: 'c1', obligatorio: true, guardar: guardar('codigo') }),
      campo({ etiqueta: 'Nombre', valor: p.nombre, max: 120, ancho: 'c3', obligatorio: true, guardar: guardar('nombre') }),
      campo({ etiqueta: 'Cliente', valor: p.cliente, max: 120, ancho: 'c2', guardar: guardar('cliente') }),
      campo({ etiqueta: 'Obra / ubicación', valor: p.obra, max: 200, ancho: 'c2', guardar: guardar('obra') }),
      campo({ etiqueta: 'Notas', valor: p.notas, max: 2000, ancho: 'c3', filas: 2, guardar: guardar('notas') }),
      campo({ etiqueta: 'Estado', valor: p.estado, opciones: { activo: 'Activo', cerrado: 'Cerrado' }, ancho: 'c1', guardar: guardar('estado') }),
    );
    pintarObras(p);
    pintarCondiciones(p);
    const im = p.ultima_importacion;
    $('#proyecto-importado').textContent = im
      ? `Importado del ${im.origen?.sistema || 'compositor'} el ${fechaHoraTxt(im.creado)}${im.usuario ? ` por ${im.usuario}` : ''}${p.ref_externa ? ` · ref. ${p.ref_externa}` : ''}. Reimportar el archivo actualiza este proyecto.`
      : '';
  }

  const condPendientes = (p) => (p.condiciones || []).filter((c) => !c.cumplida).length;
  const fechaHoraTxt = (iso) => new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // Obras del proyecto: sus filas en el tablero (se ven mientras el proyecto está activo)
  function pintarObras(p) {
    const caja = $('#proyecto-obras');
    const editar = puedeEditar();
    const obras = p.obras || [];
    const recargar = async () => {
      [estado.catalogo] = await Promise.all([api('GET', '/api/catalogo'), cargarProyectos()]);
      pintarFichaProyecto();
    };
    const guardar = (o, k) => async (ev) => {
      const v = ev.target.value.trim();
      if (v === (o[k] || '')) return;
      if (k === 'nombre' && !v) { ev.target.value = o.nombre; return toast('El nombre es obligatorio', true); }
      try { await api('PATCH', `/api/areas/${o.id}`, { [k]: v }); toast('Obra guardada'); await recargar(); }
      catch (e) { toast(e.message, true); ev.target.value = o[k] || ''; }
    };
    caja.replaceChildren(
      el('div', { class: 'cond-cab' }, el('h3', {}, 'Obras'),
        el('span', { class: 'ayuda' }, p.estado === 'cerrado'
          ? 'proyecto cerrado: no salen en el tablero'
          : obras.length ? 'filas del tablero mientras el proyecto esté activo' : 'sin obra (se crea al poner la dirección de obra)')),
      obras.length ? el('ul', { class: 'obras-lista' }, obras.map((o) => el('li', { class: o.activo ? '' : 'cumplida' },
        el('input', { value: o.nombre, maxlength: 80, disabled: !editar, 'aria-label': 'Nombre de la obra', onchange: guardar(o, 'nombre') }),
        el('input', { value: o.ubicacion || '', maxlength: 200, disabled: !editar, placeholder: 'Dirección', 'aria-label': 'Dirección de la obra', onchange: guardar(o, 'ubicacion') }),
        editar ? el('button', {
          type: 'button', class: 'ghost borrar mini',
          title: o.usos ? 'Tiene tareas o tramos: se desactiva (deja de salir en el tablero)' : 'Quitar la obra',
          onclick: async () => {
            try {
              const r = o.activo || !o.usos ? await api('DELETE', `/api/areas/${o.id}`) : await api('PATCH', `/api/areas/${o.id}`, { activo: true });
              toast(r.desactivada ? 'Tiene trabajo: se ha desactivado' : r.borrada ? 'Obra quitada' : 'Obra reactivada');
              await recargar();
            } catch (e) { toast(e.message, true); }
          },
        }, o.activo || !o.usos ? (o.usos ? 'Desactivar' : 'Quitar') : 'Reactivar') : null))) : null,
      editar ? el('form', {
        class: 'alta cond-alta',
        onsubmit: async (ev) => {
          ev.preventDefault();
          const f = ev.target;
          try {
            await api('POST', `/api/proyectos/${p.id}/obras`, { nombre: f.nombre.value, ubicacion: f.ubicacion.value });
            toast('Obra añadida'); await recargar();
          } catch (e) { toast(e.message, true); }
        },
      },
      el('input', { name: 'nombre', placeholder: obras.length ? 'Otra obra (nombre)' : 'Nombre (p. ej. Obra · Finca Alaior)', maxlength: 80, 'aria-label': 'Nombre de la nueva obra' }),
      el('input', { name: 'ubicacion', placeholder: 'Dirección', maxlength: 200, 'aria-label': 'Dirección de la nueva obra' }),
      el('button', { type: 'submit' }, 'Añadir obra')) : null,
    );
  }

  // Condiciones previas: lo que hay que confirmar antes de ejecutar (pago, RAL, pilares…)
  function pintarCondiciones(p) {
    const caja = $('#proyecto-condiciones');
    const editar = puedeEditar();
    const lista = p.condiciones || [];
    caja.hidden = !lista.length && !editar;
    const recargar = async () => { await cargarProyectos(); pintarFichaProyecto(); };
    const pend = condPendientes(p);
    caja.replaceChildren(
      el('div', { class: 'cond-cab' }, el('h3', {}, 'Condiciones previas'),
        el('span', { class: pend ? 'cond-pend' : 'ayuda' }, lista.length ? (pend ? `${pend} pendiente${pend > 1 ? 's' : ''}` : '✓ todas cumplidas') : 'ninguna')),
      lista.length ? el('ul', {}, lista.map((c) => el('li', { class: c.cumplida ? 'cumplida' : '' },
        el('label', {},
          el('input', {
            type: 'checkbox', checked: c.cumplida, disabled: !editar,
            onchange: async (ev) => {
              try { await api('PATCH', `/api/condiciones/${c.id}`, { cumplida: ev.target.checked }); await recargar(); }
              catch (e) { toast(e.message, true); }
            },
          }),
          ` ${c.texto}`),
        c.cumplida && c.cumplida_en ? el('span', { class: 'ayuda' }, ` · ${fechaHoraTxt(c.cumplida_en).slice(0, 10)}${c.cumplida_por ? ' · ' + c.cumplida_por : ''}`) : null,
        editar ? el('button', {
          type: 'button', class: 'ghost borrar mini', 'aria-label': `Quitar «${c.texto}»`, title: 'Quitar',
          onclick: async () => { try { await api('DELETE', `/api/condiciones/${c.id}`); await recargar(); } catch (e) { toast(e.message, true); } },
        }, '✕') : null))) : '',
      editar ? el('form', {
        class: 'alta cond-alta',
        onsubmit: async (ev) => {
          ev.preventDefault();
          const i = ev.target.texto;
          try { await api('POST', `/api/proyectos/${p.id}/condiciones`, { texto: i.value }); await recargar(); $('#proyecto-condiciones input[name=texto]')?.focus(); }
          catch (e) { toast(e.message, true); }
        },
      }, el('input', { name: 'texto', placeholder: 'Nueva condición (p. ej. RAL confirmado por el cliente)', maxlength: 200, required: true, 'aria-label': 'Nueva condición previa' }),
      el('button', { type: 'submit' }, 'Añadir')) : '',
    );
  }

  /* ---------- OTs del proyecto ---------- */
  async function cargarOTs() {
    if (!estado.proyectoId) return;
    [estado.ots, estado.partidas] = await Promise.all([
      api('GET', `/api/ordenes?proyecto_id=${estado.proyectoId}`),
      api('GET', `/api/partidas?proyecto_id=${estado.proyectoId}`),
    ]);
    pintarSelectorPartida();
    pintarOTs();
  }

  const nombrePartida = (pa) => (pa ? `${pa.codigo ? pa.codigo + ' · ' : ''}${pa.nombre}` : 'Sin partida');

  // Selector de partida del formulario «Crear OT»
  function pintarSelectorPartida() {
    const sel = $('#form-ot select[name=partida_id]');
    const previo = sel.value;
    sel.replaceChildren(
      ...estado.partidas.map((pa) => el('option', { value: pa.id }, nombrePartida(pa))),
      el('option', { value: '' }, 'Sin partida'));
    if ([...sel.options].some((o) => o.value === previo)) sel.value = previo;
  }

  function pintarOTs() {
    const ul = $('#lista-ots');
    if (!estado.ots.length && !estado.partidas.length) {
      ul.replaceChildren(el('li', { class: 'ayuda' }, 'Este proyecto todavía no tiene partidas ni OTs.'));
      return;
    }
    // una cabecera por partida (aunque esté vacía) y, al final, las OTs sin partida
    const grupos = estado.partidas.map((pa) => ({ pa, ots: estado.ots.filter((o) => o.partida_id === pa.id) }));
    const sueltas = estado.ots.filter((o) => !o.partida_id);
    if (sueltas.length) grupos.push({ pa: null, ots: sueltas });
    ul.replaceChildren(...grupos.flatMap(({ pa, ots }) => [
      el('li', { class: 'grupo-partida' },
        el('span', { class: 'gp-nom' }, nombrePartida(pa), pa?.baja_presupuesto ? el('span', { class: 'baja-txt' }, ' · ya no está en el presupuesto') : null),
        pa ? el('span', { class: 'gp-mat' },
          el('button', { type: 'button', class: 'ghost mini', title: 'Escandallo: materiales de la partida (técnico)',
            onclick: () => window.s360mat.escandallo({ partida: pa, alCerrar: cargarOTs }) }, '📋 Escandallo', pa.n_escandallo ? el('span', { class: 'llv-n' }, String(pa.n_escandallo)) : null),
          el('a', { class: 'boton ghost mini', href: `/asignar.html?partida=${pa.id}`,
            title: pa.sin_asignar ? `${pa.sin_asignar} material(es) del escandallo sin asignar a tareas` : 'Asignar materiales y herramientas a las tareas' },
          '🧩 Asignar', pa.sin_asignar ? el('span', { class: 'llv-n aviso' }, `⚠ ${pa.sin_asignar}`) : null)) : null,
        el('span', { class: 'gp-sub' }, [
          `${ots.length} OT`,
          pa?.horas ? `${durTxt(pa.horas_planificadas)}/${durTxt(pa.horas)}` : null,
        ].filter(Boolean).join(' · '), pa ? window.s360.chipAvance(pa.avance, { compacto: true }) : null)),
      ...(ots.length ? ots.map(itemOT) : [el('li', { class: 'ayuda vacia' }, 'Sin OTs todavía')]),
    ]));
  }

  function itemOT(o) {
    return el('li', {},
      el('button', {
        class: `item ot${o.id === estado.otId ? ' sel' : ''}${o.estado === 'cerrada' ? ' cerrado' : ''}`,
        style: `--c:${o.color}`, 'aria-current': o.id === estado.otId ? 'true' : false,
        onclick: () => elegirOT(o.id),
      },
        el('span', { class: 'item-tit' }, el('span', { class: 'punto', 'aria-hidden': 'true' }), el('b', {}, o.codigo), ` ${o.titulo}`),
        el('span', { class: 'item-sub' }, [
          PRIORIDADES[o.prioridad],
          o.fecha_entrega && `entrega ${fechaCorta(o.fecha_entrega)}`,
          `${o.tareas} tareas`,
          o.horas ? `${durTxt(o.horas_planificadas)}/${durTxt(o.horas)} planificadas` : null,
          o.horas_planificadas > o.horas ? `+${durTxt(+(o.horas_planificadas - o.horas).toFixed(1))} sobre lo estimado` : null,
          o.estado === 'cerrada' ? 'cerrada' : null,
        ].filter(Boolean).join(' · ')),
        o.avance?.tareas ? el('span', { class: 'item-sub' }, window.s360.chipAvance(o.avance)) : null,
        o.estado !== 'cerrada' ? situacionOT(o.situacion, true) : null,
        o.baja_presupuesto ? el('span', { class: 'item-sub baja-txt' }, 'Ya no está en el presupuesto (se conserva por tener planificación)') : null,
        o.tareas ? el('span', { class: 'barra', title: `${o.horas_planificadas}h planificadas de ${o.horas}h · ${o.hechas} de ${o.tareas} tareas hechas` },
          el('span', { class: 'b-plan', style: `width:${o.horas ? (o.horas_planificadas / o.horas) * 100 : 0}%` }),
          el('span', { class: 'b-hecha', style: `width:${(o.hechas / o.tareas) * 100}%` })) : null,
      ));
  }

  async function elegirOT(id) {
    estado.otId = id;
    guardarURL();
    pintarOTs();
    await cargarOT();
  }

  /* ---------- OT seleccionada ---------- */
  async function cargarOT() {
    if (!estado.otId) { estado.ot = null; return pintarOT(); }
    try { estado.ot = await api('GET', `/api/ordenes/${estado.otId}`); }
    catch (e) { estado.ot = null; estado.otId = null; guardarURL(); toast(e.message, true); }
    pintarOT();
  }

  async function refrescarOT() {
    await Promise.all([cargarOT(), cargarOTs(), cargarProyectos()]);
  }

  function pintarOT() {
    const o = estado.ot;
    $('#ot-vacio').hidden = !!o;
    $('#ot-ficha').hidden = !o;
    if (!o) return;
    const editar = puedeEditar();
    $('#ot-titulo').textContent = `${o.codigo} · ${o.titulo}`;
    $('#ot-titulo').style.color = o.color;
    $('#ot-borrar').hidden = !editar;
    $('#form-tarea').hidden = !editar || o.estado === 'cerrada';
    const primeraFecha = o.lista_tareas.map((t) => t.primera_fecha).filter(Boolean).sort()[0];
    $('#ot-tablero').href = primeraFecha ? `/?fecha=${primeraFecha}&ot=${o.id}` : `/?ot=${o.id}`;


    const guardar = (k) => async (v) => {
      await api('PATCH', `/api/ordenes/${o.id}`, { [k]: v });
      await refrescarOT();
    };
    const proyectos = Object.fromEntries(estado.proyectos.map((p) => [p.id, `${p.codigo} · ${p.nombre || ''}`]));

    const colores = el('div', { class: 'campo c3' }, el('span', { class: 'etq' }, 'Color en el tablero'),
      el('div', { class: 'colores', role: 'radiogroup', 'aria-label': 'Color' }, estado.catalogo.colores.map((c) =>
        el('button', {
          type: 'button', class: `color${c === o.color ? ' sel' : ''}`, style: `--c:${c}`, role: 'radio',
          'aria-checked': c === o.color ? 'true' : 'false', 'aria-label': c, disabled: !editar,
          onclick: () => guardar('color')(c).then(() => toast('Guardado')).catch((e) => toast(e.message, true)),
        }))));

    $('#ot-campos').replaceChildren(
      // con proyecto, el código es automático (nº de proyecto . OT): no se edita; el anterior queda como referencia
      o.proyecto_id
        ? el('div', { class: 'campo c1' }, el('label', {}, 'Código'),
          el('div', { class: 'cod-auto', title: `Automático: proyecto ${o.proyecto_codigo || ''}, OT nº ${String(o.codigo).split('.').pop()}${o.codigo_antiguo ? `\nCódigo anterior: ${o.codigo_antiguo}` : ''}` },
            el('span', { class: 'cod-chip' }, o.codigo), o.codigo_antiguo ? el('small', {}, ` antes ${o.codigo_antiguo}`) : null))
        : campo({ etiqueta: 'Código', valor: o.codigo, max: 30, ancho: 'c1', obligatorio: true, guardar: guardar('codigo') }),
      campo({ etiqueta: 'Título', valor: o.titulo, max: 120, ancho: 'c3', obligatorio: true, guardar: guardar('titulo') }),
      campo({ etiqueta: 'Proyecto', valor: o.proyecto_id, opciones: proyectos, ancho: 'c2', guardar: guardar('proyecto_id') }),
      campo({
        etiqueta: 'Partida', valor: o.partida_id ?? '', ancho: 'c2',
        opciones: Object.fromEntries([...(o.proyecto_id === estado.proyectoId ? estado.partidas : [])
          .map((pa) => [pa.id, nombrePartida(pa)]), ['', 'Sin partida']]),
        guardar: (v) => guardar('partida_id')(v ? Number(v) : null),
      }),
      campo({ etiqueta: 'Prioridad', valor: o.prioridad, opciones: PRIORIDADES, ancho: 'c1', guardar: (v) => guardar('prioridad')(Number(v)) }),
      campo({ etiqueta: 'Entrega', valor: o.fecha_entrega, tipo: 'date', ancho: 'c1', guardar: guardar('fecha_entrega') }),
      campo({ etiqueta: 'Estado', valor: o.estado, opciones: { abierta: 'Abierta', cerrada: 'Cerrada' }, ancho: 'c1', guardar: guardar('estado') }),
      colores,
      campo({ etiqueta: 'Descripción', valor: o.descripcion, max: 4000, ancho: 'c4', filas: 2, guardar: guardar('descripcion') }),
    );

    const horas = o.lista_tareas.reduce((s, t) => s + t.duracion_h, 0);
    $('#ot-resumen').replaceChildren(o.lista_tareas.length
      ? `${o.lista_tareas.length} tareas · ${durTxt(o.horas_planificadas)} de ${durTxt(horas)} planificadas`
        + (o.horas_planificadas > horas ? ` (+${Math.round(((o.horas_planificadas - horas) / horas) * 100)}%)` : '')
        + (o.hp_estimadas ? ` · ${durTxt(+o.hp_planificadas.toFixed(1))} de ${durTxt(o.hp_estimadas)} horas-persona` : '')
        + ` · ${o.hechas} hechas · ` : '', window.s360.chipAvance(o.avance) || '');
    let caja = $('#ot-situacion');
    if (!caja) { caja = el('div', { id: 'ot-situacion' }); $('#ot-resumen').parentElement.after(caja); }
    caja.replaceChildren(situacionOT(o.situacion) || '');
    pintarTareas();
  }

  // Requisitos de una tarea: capacidades (saber hacer), tipos de recurso (con cantidad) y recursos concretos.
  // En la tabla, un botón con el resumen; al pulsarlo, un cuadro grande para marcar y guardar de una vez.
  const CLASES = [['maquina', 'Equipos y máquinas', '⚙'], ['subcontrata', 'Subcontratas y alquileres', '🤝'], ['operario', 'Categorías (oficio)', '👷']];
  const normR = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function resumenRequisitos(t, recursosReq) {
    const tipos = estado.catalogo.tipos;
    const caps = estado.catalogo.capacidades || [];
    return [
      ...(t.capacidades || []).map((q) => { const k = caps.find((x) => x.id === q.id); return k ? `${q.cantidad > 1 ? q.cantidad + '× ' : ''}sabe ${k.nombre}` : null; }),
      ...(t.requisitos_tipo || []).map((q) => { const ti = tipos.find((x) => x.id === q.id); return ti ? `${q.cantidad > 1 ? q.cantidad + '× ' : ''}${ti.nombre}` : null; }),
      ...t.requisitos.map((id) => recursosReq.find((r) => r.id === id)?.nombre),
    ].filter(Boolean);
  }
  function selectorRequisitos(t, recursosReq, editar, patch) {
    const res = resumenRequisitos(t, recursosReq);
    return el('button', {
      type: 'button', class: `req-btn${res.length ? '' : ' vacio'}`, title: res.length ? res.join('\n') : 'Sin requisitos',
      onclick: () => dialogoRequisitos(t, recursosReq, editar, patch),
    }, res.length ? res.join(', ') : (editar ? '＋ requisitos' : '—'));
  }

  function dialogoRequisitos(t, recursosReq, editar, patch) {
    const tipos = estado.catalogo.tipos;
    const caps = estado.catalogo.capacidades || [];
    // copia de trabajo: se guarda todo junto al pulsar «Guardar»
    const sel = {
      cap: new Map((t.capacidades || []).map((q) => [q.id, q.cantidad])),
      tipo: new Map((t.requisitos_tipo || []).map((q) => [q.id, q.cantidad])),
      rec: new Set(t.requisitos),
    };
    let filtro = '';
    let seccion = 'cap';
    const d = el('dialog', { class: 'dlg-req', 'aria-label': `Requisitos de ${t.nombre}` });
    const cuerpo = el('div', { class: 'dreq-cuerpo' });
    const elegido = el('div', { class: 'dreq-elegido' });
    const nav = el('nav', { class: 'dreq-nav' });
    const buscar = el('input', { type: 'search', class: 'dreq-buscar', placeholder: '🔎 Buscar en todo (soldar, carretilla, grúa, oficial…)', 'aria-label': 'Buscar' });
    buscar.addEventListener('input', () => { filtro = buscar.value; pintar(); });

    const SECCIONES = [
      ['cap', 'Saber hacer', '🧠', caps.length],
      ...CLASES.map(([clase, titulo, ico]) => [clase, titulo, ico, tipos.filter((ti) => ti.clase === clase).length]),
      ['rec', 'Recurso concreto', '📌', recursosReq.length],
    ];
    const nSel = (k) => (k === 'cap' ? sel.cap.size : k === 'rec' ? sel.rec.size : tipos.filter((ti) => ti.clase === k && sel.tipo.has(ti.id)).length);

    const cantidad = (mapa, id, nombre) => el('input', {
      type: 'number', min: 1, max: 50, value: mapa.get(id), class: 'dreq-cant', disabled: !editar, 'aria-label': `Cuántos: ${nombre}`, title: 'Cuántos a la vez',
      onclick: (ev) => ev.stopPropagation(),
      onchange: (ev) => { mapa.set(id, Math.min(50, Math.max(1, Number(ev.target.value) || 1))); pintarElegido(); },
    });
    const casilla = (marcado, onCambio, texto, extra, cant) => el('label', { class: `dreq-op${marcado ? ' si' : ''}` },
      el('input', { type: 'checkbox', checked: marcado, disabled: !editar, onchange: (ev) => onCambio(ev.target.checked) }),
      el('span', { class: 'dreq-op-txt' }, texto), cant, extra);
    const cuenta = (n, txt0, txt1) => el('span', { class: `rt${n ? '' : ' sin'}` }, n ? `${n} ${txt1}` : txt0);

    function pintarElegido() {
      const chips = [
        ...[...sel.cap].map(([id, n]) => { const k = caps.find((x) => x.id === id); return k && [`🧠 ${n > 1 ? n + '× ' : ''}${k.nombre}`, () => sel.cap.delete(id)]; }),
        ...[...sel.tipo].map(([id, n]) => { const ti = tipos.find((x) => x.id === id); return ti && [`${CLASES.find((c) => c[0] === ti.clase)?.[2] || ''} ${n > 1 ? n + '× ' : ''}${ti.nombre}`, () => sel.tipo.delete(id)]; }),
        ...[...sel.rec].map((id) => { const r = recursosReq.find((x) => x.id === id); return r && [`📌 ${r.nombre}`, () => sel.rec.delete(id)]; }),
      ].filter(Boolean);
      elegido.replaceChildren(el('span', { class: 'dreq-el-tit' }, chips.length ? `Pide (${chips.length}):` : 'No pide nada todavía. Marca abajo lo que hace falta.'),
        ...chips.map(([txt, quitar]) => el('span', { class: 'dreq-chip' }, txt,
          editar ? el('button', { type: 'button', 'aria-label': `Quitar ${txt}`, onclick: () => { quitar(); pintar(); } }, '✕') : null)));
    }

    function pintar() {
      pintarElegido();
      const q = normR(filtro);
      nav.replaceChildren(...SECCIONES.map(([k, txt, ico]) => el('button', {
        type: 'button', class: `dreq-nav-b${seccion === k && !q ? ' activo' : ''}`,
        onclick: () => { seccion = k; filtro = ''; buscar.value = ''; pintar(); cuerpo.scrollTop = 0; },
      }, el('span', { 'aria-hidden': 'true' }, ico), ` ${txt}`, nSel(k) ? el('span', { class: 'dreq-n' }, String(nSel(k))) : null)));
      // con texto de búsqueda se busca en todas las secciones; sin él, solo la elegida
      const ver = (k) => (q ? true : seccion === k);
      const bloques = [];
      if (ver('cap')) {
        const fams = new Map();
        for (const k of caps) {
          if (q && !normR(`${k.nombre} ${k.familia}`).includes(q)) continue;
          if (!fams.has(k.familia)) fams.set(k.familia, []);
          fams.get(k.familia).push(k);
        }
        if (fams.size) {
          bloques.push(el('section', { class: 'dreq-sec' },
            el('h3', {}, '🧠 Saber hacer', el('span', { class: 'ayuda' }, ' · cuántas personas que lo sepan hacer a la vez')),
            el('div', { class: 'dreq-fams' }, [...fams].map(([fam, ks]) => el('div', { class: 'dreq-fam' },
              el('h4', {}, fam),
              ks.map((k) => casilla(sel.cap.has(k.id), (v) => { if (v) sel.cap.set(k.id, 1); else sel.cap.delete(k.id); pintar(); }, k.nombre,
                cuenta(k.personas, 'nadie', k.personas === 1 ? 'persona' : 'personas'), sel.cap.has(k.id) ? cantidad(sel.cap, k.id, k.nombre) : null)))))));
        }
      }
      for (const [clase, titulo, ico] of CLASES) {
        if (!ver(clase)) continue;
        const lista = tipos.filter((ti) => ti.clase === clase && (!q || normR(`${ti.nombre} ${ti.familia || ''}`).includes(q)));
        if (!lista.length) continue;
        const filaTipo = (ti) => casilla(sel.tipo.has(ti.id), (v) => { if (v) sel.tipo.set(ti.id, 1); else sel.tipo.delete(ti.id); pintar(); },
          [ti.nombre, ti.uso ? el('span', { class: `dreq-uso ${ti.uso}` }, { taller: 'taller', obra: 'obra', ambos: 'taller y obra' }[ti.uso]) : null],
          cuenta(ti.recursos, 'ninguno', 'de alta'), sel.tipo.has(ti.id) ? cantidad(sel.tipo, ti.id, ti.nombre) : null);
        // las máquinas, por familia (soldadura, corte, fijación…), como las capacidades
        const fams = new Map();
        if (clase === 'maquina') for (const ti of lista) { const f = ti.familia || 'Otras'; if (!fams.has(f)) fams.set(f, []); fams.get(f).push(ti); }
        bloques.push(el('section', { class: 'dreq-sec' },
          el('h3', {}, `${ico} ${titulo}`, clase === 'maquina' ? el('span', { class: 'ayuda' }, ' · en el tablero se asigna cuál') : null),
          clase === 'maquina'
            ? el('div', { class: 'dreq-fams' }, [...fams].map(([fam, ts]) => el('div', { class: 'dreq-fam' }, el('h4', {}, fam), ts.map(filaTipo))))
            : el('div', { class: 'dreq-grid' }, lista.map(filaTipo))));
      }
      if (ver('rec')) {
        const lista = recursosReq.filter((r) => !q || normR(r.nombre).includes(q));
        if (lista.length) {
          bloques.push(el('section', { class: 'dreq-sec' },
            el('h3', {}, '📌 Recurso concreto', el('span', { class: 'ayuda' }, ' · esa máquina o subcontrata en particular')),
            el('div', { class: 'dreq-grid' }, lista.map((r) => casilla(sel.rec.has(r.id), (v) => { if (v) sel.rec.add(r.id); else sel.rec.delete(r.id); pintar(); }, r.nombre,
              el('span', { class: `rt ${r.tipo}` }, r.tipo === 'maquina' ? 'máquina' : 'subcontrata'))))));
        }
      }
      cuerpo.replaceChildren(...(bloques.length ? bloques : [el('p', { class: 'ayuda dreq-vacio' }, q ? `Nada coincide con «${filtro}».` : 'No hay nada dado de alta en esta sección.')]));
    }

    const cerrar = () => { d.close(); d.remove(); };
    const guardar = async () => {
      const cuerpoPatch = {
        capacidades: [...sel.cap].map(([id, cantidad]) => ({ id, cantidad })),
        requisitos_tipo: [...sel.tipo].map(([id, cantidad]) => ({ id, cantidad })),
        requisitos: [...sel.rec],
      };
      cerrar();
      await patch(t, cuerpoPatch);
    };
    d.append(
      el('div', { class: 'dlg-cab' },
        el('div', {}, el('h2', {}, 'Requisitos de la tarea'), el('p', { class: 'ayuda' }, `${t.nombre}${t.operarios_req ? ` · ${t.operarios_req} operario(s)` : ''}`)),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: cerrar }, '✕')),
      elegido,
      el('div', { class: 'dreq-barra' }, buscar),
      el('div', { class: 'dreq-dos' }, nav, cuerpo),
      el('div', { class: 'dreq-pie' },
        el('a', { class: 'req-gestionar', href: '/capacidades.html' }, 'Gestionar capacidades…'),
        el('a', { class: 'req-gestionar', href: '/recursos.html?tipo=tipos' }, 'Gestionar tipos de recurso…'),
        el('span', { class: 'dreq-esp' }),
        el('button', { type: 'button', class: 'ghost', onclick: cerrar }, editar ? 'Cancelar' : 'Cerrar'),
        editar ? el('button', { type: 'button', class: 'primario', onclick: guardar }, 'Guardar') : null));
    d.addEventListener('cancel', (ev) => { ev.preventDefault(); cerrar(); });
    document.body.append(d);
    pintar();
    d.showModal();
    buscar.focus();
  }

  // Debajo del nombre: «ya no está en el presupuesto», dependencias y notas
  function extrasTarea(t, editar, patch) {
    const deps = t.dependencias || [];
    const espera = (d) => (d.espera_h ? ` (+${durTxt(d.espera_h)} espera)` : '');
    const depTxt = deps.map((d) => `${d.orden_codigo === estado.ot.codigo ? '' : d.orden_codigo + ' '}${d.nombre}${espera(d)}`);
    const nLlevar = (t.n_material || 0) + (t.n_herramienta || 0);
    const llevar = nLlevar ? el('button', {
      type: 'button', class: `t-llevar${nLlevar ? '' : ' vacia'}`,
      title: `Llevar: ${t.n_material} material(es) · ${t.n_herramienta} herramienta(s)`,
      'aria-label': nLlevar ? `Materiales y herramientas de ${t.nombre}: ${nLlevar}` : `Añadir materiales y herramientas a ${t.nombre}`,
      onclick: () => window.s360mat.verTarea({ tarea: t }),
    }, '🧰', nLlevar ? el('span', { class: 't-llevar-n' }, String(nLlevar)) : null) : null;
    const depsEl = deps.length ? el(editar ? 'button' : 'span', {
        type: editar ? 'button' : null, class: `t-deps${editar ? ' editable' : ''}`,
        title: `Va después de:\n${depTxt.join('\n')}${editar ? '\n\nPulsa para cambiarlo' : ''}`,
        onclick: editar ? () => editarDependencias(t) : null,
      }, `⤷ después de ${depTxt.length === 1 ? depTxt[0] : `${depTxt[0]} y ${depTxt.length - 1} más`}`)
        : editar ? el('button', { type: 'button', class: 't-deps editable vacia', onclick: () => editarDependencias(t) }, '+ después de…') : null;
    return el('div', { class: 't-extra' },
      llevar || depsEl ? el('div', { class: 't-fila1' }, llevar, depsEl) : null,
      t.baja_presupuesto ? el('span', { class: 'baja-txt' }, 'Ya no está en el presupuesto',
        editar ? el('button', {
          type: 'button', class: 'ghost mini', title: 'Quitar la marca y conservar la tarea',
          onclick: () => patch(t, { baja_presupuesto: false }),
        }, 'Mantener') : null) : null,
      t.notas || editar ? el('details', { class: `t-notas${t.notas ? '' : ' vacia'}` },
        el('summary', {}, t.notas ? `Notas: ${t.notas.length > 70 ? t.notas.slice(0, 70) + '…' : t.notas}` : '+ notas'),
        el('textarea', {
          rows: 3, maxlength: 4000, 'aria-label': `Notas de ${t.nombre}`, disabled: !editar,
          onchange: (ev) => patch(t, { notas: ev.target.value }),
        }, t.notas || '')) : null);
  }

  // Editor de «después de»: tareas previas (del mismo proyecto) con su espera
  async function editarDependencias(t) {
    let d;
    try { d = await api('GET', `/api/tareas/${t.id}/dependencias`); } catch (e) { return toast(e.message, true); }
    const porId = new Map(d.posibles.map((p) => [p.id, p]));
    const elegidas = new Map(d.actuales.map((x) => [x.id, x.espera_h]));
    const dlg = el('dialog', { class: 'dlg-deps', 'aria-labelledby': 'deps-tit' });
    const lista = el('ul', { class: 'deps-lista' });
    const sel = el('select', { 'aria-label': 'Añadir tarea previa' });
    const pintar = () => {
      lista.replaceChildren(...(elegidas.size ? [...elegidas].map(([id, espera]) => {
        const p = porId.get(id);
        return el('li', {},
          el('span', { class: 'deps-nom' }, el('b', {}, p?.orden_codigo || ''), ` ${p?.nombre || 'tarea'}`),
          el('label', { class: 'deps-espera', title: 'Horas de calendario que hay que esperar al terminar la previa (secado, curado, transporte…)' },
            'espera ', el('input', {
              type: 'number', min: 0, max: 720, step: 0.5, value: espera, 'aria-label': `Espera tras ${p?.nombre || 'la previa'}`,
              oninput: (ev) => elegidas.set(id, Number(ev.target.value) || 0),
            }), ' h'),
          el('button', { type: 'button', class: 'ghost mini borrar', 'aria-label': `Quitar ${p?.nombre || ''}`, onclick: () => { elegidas.delete(id); pintar(); } }, '✕'));
      }) : [el('li', { class: 'ayuda' }, 'Sin tareas previas: se puede planificar en cualquier momento.')]));
      const ots = new Map();
      for (const p of d.posibles) {
        if (!ots.has(p.orden_id)) ots.set(p.orden_id, { txt: `${p.orden_codigo} · ${p.orden_titulo}`, ps: [] });
        ots.get(p.orden_id).ps.push(p);
      }
      sel.replaceChildren(el('option', { value: '' }, '+ Añadir tarea previa…'),
        ...[...ots.values()].map((o) => el('optgroup', { label: o.txt }, o.ps.map((p) => el('option', {
          value: p.id, disabled: elegidas.has(p.id) || p.ciclo,
        }, `${p.nombre}${p.ciclo ? ' (ya va después de esta)' : elegidas.has(p.id) ? ' ✓' : ''}`)))));
    };
    sel.onchange = () => { if (sel.value) { elegidas.set(Number(sel.value), 0); pintar(); } };
    const cerrar = () => { dlg.close(); dlg.remove(); };
    dlg.append(
      el('h2', { id: 'deps-tit' }, 'Va después de…'),
      el('p', { class: 'ayuda' }, `«${t.nombre}» no debería empezar hasta que terminen estas tareas (y pase la espera, si la hay). El tablero avisa si se planifica antes.`),
      lista, sel,
      d.importada ? el('p', { class: 'ayuda aviso-imp' }, 'Esta tarea viene del compositor: si se vuelve a importar, sus dependencias vuelven a ser las del compositor.') : null,
      el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: cerrar }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          try {
            await api('PUT', `/api/tareas/${t.id}/dependencias`, { dependencias: [...elegidas].map(([id, espera_h]) => ({ id, espera_h })) });
            cerrar(); toast('Dependencias guardadas'); await refrescarOT();
          } catch (e) { toast(e.message, true); }
        } }, 'Guardar')));
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); cerrar(); });
    document.body.append(dlg);
    pintar();
    dlg.showModal();
    sel.focus();
  }

  function pintarTareas() {
    const o = estado.ot;
    const editar = puedeEditar();
    const tbody = $('#tareas-tbody');
    if (!o.lista_tareas.length) {
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 8, class: 'ayuda' }, 'Sin tareas. Añade la primera abajo.')));
      return;
    }
    const pid = o.proyecto_id;
    const usadas = new Set(o.lista_tareas.map((t) => t.linea_id));
    const areas = Object.fromEntries([['', '—'], ...estado.catalogo.areas
      .filter((a) => a.tipo !== 'obra' || (pid && a.proyecto_id === pid) || usadas.has(a.id))
      .map((a) => [a.id, a.tipo === 'obra' ? `${a.nombre} (obra)` : a.nombre])]);
    const recursosReq = estado.catalogo.recursos.filter((r) => r.tipo !== 'operario');

    const patch = (t, cuerpo) => api('PATCH', `/api/tareas/${t.id}`, cuerpo)
      .then(() => { toast('Guardado'); return refrescarOT(); })
      .catch((e) => { toast(e.message, true); pintarTareas(); });

    if (editar) {
      ordenArrastrable(tbody, async (nuevos) => {
        await api('PUT', `/api/ordenes/${o.id}/tareas/orden`, { ids: nuevos }).then(() => toast('Orden guardado')).catch((e) => toast(e.message, true));
        await cargarOT();
      });
    }

    tbody.replaceChildren(...o.lista_tareas.map((t, i) => {
      const bloqueada = ['en_curso', 'hecha'].includes(t.estado);
      const req = selectorRequisitos(t, recursosReq, editar, patch);

      const hp = t.horas_planificadas;
      const etiquetaPlan = ESTADO_TAREA[t.estado]
        || (!hp ? 'Sin planificar' : hp !== t.duracion_h ? `${durTxt(hp)}/${durTxt(t.duracion_h)}` : 'Planificada');
      const clasePlan = ESTADO_TAREA[t.estado] ? t.estado : !hp ? 'pendiente' : hp < t.duracion_h ? 'parcial' : hp > t.duracion_h ? 'exceso' : 'planificada';
      const plan = t.primera_fecha
        ? el('a', { href: `/?fecha=${t.primera_fecha}`, class: 'plan', title: `${t.n_tramos} tramo(s) en el tablero` },
          t.primera_fecha === t.ultima_fecha ? fechaCorta(t.primera_fecha).slice(0, 5)
            : `${fechaCorta(t.primera_fecha).slice(0, 5)}→${fechaCorta(t.ultima_fecha).slice(0, 5)}`)
        : null;

      const fila = el('tr', { class: `${t.estado}${t.baja_presupuesto ? ' baja' : ''}`, 'data-id': t.id },
        el('td', { class: 'ord' }, editar ? asaOrden(t.nombre) : ''),
        el('td', {}, el('div', { class: 'td-tarea' }, t.codigo ? el('span', { class: 'cod-chip', style: `--c:${o.color}` }, t.codigo) : null, el('input', {
          value: t.nombre, maxlength: 120, 'aria-label': 'Nombre de la tarea', disabled: !editar,
          onchange: (ev) => (ev.target.value.trim() ? patch(t, { nombre: ev.target.value }) : (ev.target.value = t.nombre)),
        })), extrasTarea(t, editar, patch)),
        // tarea de un taller externo: la duración en días (1 día = una jornada) y sin operarios propios
        t.proveedor_id ? el('td', { class: 'num' }, el('input', {
          type: 'number', min: 0.5, step: 0.5, value: +(t.duracion_h / JH()).toFixed(1), 'aria-label': 'Días', disabled: !editar,
          title: `Días de trabajo en el taller (1 día = ${JH()} h de jornada)`,
          onchange: (ev) => patch(t, { duracion_h: Math.max(0.5, Math.round(Number(ev.target.value) * JH() * 2) / 2) }),
        }), el('span', { class: 'ud-dias' }, 'días'))
          : el('td', { class: 'num' }, el('input', {
            type: 'number', min: 0.5, step: 0.5, value: t.duracion_h, 'aria-label': 'Horas', disabled: !editar,
            onchange: (ev) => patch(t, { duracion_h: Number(ev.target.value) }),
          })),
        t.proveedor_id ? el('td', { class: 'num ayuda', title: 'La hace el taller: no ocupa operarios de aquí' }, '—')
          : el('td', { class: 'num' }, el('input', {
            type: 'number', min: 0, step: 1, value: t.operarios_req, 'aria-label': 'Operarios', disabled: !editar,
            onchange: (ev) => patch(t, { operarios_req: Number(ev.target.value) }),
          })),
        el('td', {}, el('select', {
          'aria-label': 'Dónde se hace: área o taller externo', disabled: !editar, class: t.proveedor_id ? 'sel-externo' : null,
          title: t.proveedor_id ? `La hace un taller externo: ${t.proveedor}` : 'Área donde se hace (o un taller externo)',
          onchange: (ev) => {
            const v = ev.target.value;
            patch(t, v.startsWith('p') ? { proveedor_id: Number(v.slice(1)) } : { linea_id: v ? Number(v) : null });
          },
        },
        Object.entries(areas).map(([v, n]) => el('option', { value: v, selected: !t.proveedor_id && String(t.linea_id ?? '') === v }, n)),
        (estado.catalogo.talleres || []).length ? el('optgroup', { label: 'Taller externo (lo hace un proveedor)' },
          estado.catalogo.talleres.map((pv) => el('option', { value: `p${pv.id}`, selected: t.proveedor_id === pv.id }, `🏭 ${pv.nombre}`))) : null),
        t.proveedor_id ? el('span', { class: `ext-est ext-${t.ext?.estado || 'sin_empezar'}` }, EXT_EST[t.ext?.estado || 'sin_empezar']) : null),
        el('td', {}, t.proveedor_id
          ? el('span', { class: 'req-externo', title: 'Lo que pide la tarea (operarios, capacidades, máquinas) es de vuestra gente: no aplica mientras la haga un taller externo. Se conserva por si vuelve a hacerse aquí.' }, 'no aplica (fuera)')
          : req),
        el('td', { class: 'est' }, el('span', { class: `est-${clasePlan}` }, etiquetaPlan), plan ? el('br') : null, plan, realTarea(t)),
        el('td', {}, editar ? el('button', {
          type: 'button', class: 'ghost borrar', disabled: bloqueada,
          title: bloqueada ? 'No se puede borrar una tarea en curso o hecha' : 'Borrar tarea',
          'aria-label': `Borrar ${t.nombre}`,
          onclick: async () => {
            if (t.n_tramos && !confirm(`«${t.nombre}» tiene ${t.n_tramos} tramo(s) en el tablero. ¿Borrarla igualmente?`)) return;
            try { await api('DELETE', `/api/tareas/${t.id}`); toast('Tarea borrada'); await refrescarOT(); }
            catch (e) { toast(e.message, true); }
          },
        }, '✕') : ''),
      );
      // tarea de un taller externo: debajo, a lo ancho, lo que dice el taller y su seguimiento
      return t.proveedor_id ? [fila, el('tr', { class: 'fila-ext' }, el('td', {}), el('td', { colspan: 7 }, extTarea(t, editar, patch)))] : fila;
    }).flat());
  }

  const JH = () => estado.catalogo.jornada_h || 8;
  // Tarea de un taller externo: cómo va fuera. Lo dice el taller en su enlace de seguimiento (o la oficina, a mano):
  // estado, avance, cuándo terminará, comentario, fotos y a quién lo entregó. Y el seguimiento con ese taller.
  const EXT_EST = { sin_empezar: 'Sin empezar', en_curso: 'En curso', terminado: 'Terminado', entregado: 'Entregado' };
  const dm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
  const haceTxt = (ts) => {
    if (!ts) return '';
    const d = Math.floor((Date.now() - new Date(ts).getTime()) / 864e5);
    return d <= 0 ? 'hoy' : d === 1 ? 'ayer' : `hace ${d} días`;
  };
  function extTarea(t, editar, patch) {
    const x = t.ext || {};
    const o = estado.ot;
    const tarde = x.fin_prevista && x.plan_hasta && x.fin_prevista > x.plan_hasta;
    const est = x.estado || 'sin_empezar';
    const fotos = (x.archivos || []);
    const dice = el('div', { class: 'ext-dice' },
      el('span', { class: `ext-est ext-${est}` }, EXT_EST[est]),
      est === 'en_curso' && t.ext_avance != null ? el('span', { class: 'ext-bar', title: `${t.ext_avance} %` }, el('i', { style: `width:${t.ext_avance}%` })) : null,
      est === 'en_curso' && t.ext_avance != null ? ` ${t.ext_avance} %` : null,
      x.fin_prevista && !['terminado', 'entregado'].includes(est) ? el('span', { class: tarde ? 'ext-tarde' : null, title: tarde ? `Planificado hasta el ${dm(x.plan_hasta)}` : null }, ` · termina ${dm(x.fin_prevista)}${tarde ? ` (plan ${dm(x.plan_hasta)})` : ''}`) : null,
      x.recibido && est === 'sin_empezar' ? ` · material recibido ${dm(x.recibido)}` : null,
      x.entrega ? ` · entregado a ${x.entrega.a === 'nosotros' ? 'nosotros' : x.entrega.a}${x.entrega.fecha ? ` el ${dm(x.entrega.fecha)}` : ''}${x.entrega.nota ? ` · ${x.entrega.nota}` : ''}` : null,
      x.actualizado ? el('small', {}, ` · ${haceTxt(x.actualizado)}`) : null,
      fotos.length ? el('span', { class: 'ext-fotos' }, fotos.slice(0, 6).map((f) => el('a', { href: `/api/ext-archivos/${f.id}`, target: '_blank', rel: 'noopener', title: f.albaran ? 'Albarán' : (f.nombre || 'Foto') },
        f.tipo.startsWith('image/') ? el('img', { src: `/api/ext-archivos/${f.id}`, alt: f.albaran ? 'Albarán' : 'Foto del taller', loading: 'lazy' }) : el('span', {}, '📄')))) : null);
    const nov = (x.novedades || []).length ? el('details', { class: 'ext-nov' }, el('summary', {}, `Novedades (${x.novedades.length})`),
      el('ul', {}, x.novedades.map((n) => el('li', {}, el('small', {}, `${new Date(n.creado).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} `), n.texto)))) : null;
    // el control del seguimiento va en la primera tarea de ese taller en la OT
    const primera = o.lista_tareas.find((y) => y.proveedor_id === t.proveedor_id) === t;
    return el('div', { class: 'ext-tarea' },
      dice,
      el('div', { class: 'ext-editar' },
        el('label', {}, el('span', {}, 'Avance'),
          el('input', { type: 'number', min: 0, max: 100, step: 5, value: t.ext_avance ?? '', placeholder: '%', disabled: !editar, 'aria-label': 'Avance en el taller externo (%)',
            onchange: (ev) => patch(t, { ext_avance: ev.target.value === '' ? null : Number(ev.target.value) }) }), '%'),
        el('input', { class: 'ext-nota', value: t.ext_nota || '', maxlength: 300, placeholder: 'cómo va (p. ej. «esperando chapa»)', disabled: !editar, 'aria-label': 'Nota del taller externo',
          onchange: (ev) => patch(t, { ext_nota: ev.target.value }) })),
      nov,
      primera ? controlSeguimiento(t, o) : null);
  }

  // «Comenzar seguimiento» con un taller de la OT, o cómo va el que ya hay (enviado, visto, recordatorios)
  const puedeSeguir = () => window.s360.tiene('planificar') || window.s360.tiene('proyectos');
  function controlSeguimiento(t, o) {
    const s = (o.seguimientos || []).find((x) => x.proveedor_id === t.proveedor_id);
    if (!puedeSeguir()) return s?.activo ? el('div', { class: 'ext-seg ayuda' }, 'Seguimiento activo') : null;
    if (!s || !s.activo) {
      return el('div', { class: 'ext-seg' }, el('button', { type: 'button', class: 'primario mini', onclick: () => dialogoSeguimiento(t, o, s) }, '▶ Comenzar seguimiento'),
        s && !s.activo ? el('small', { class: 'ayuda' }, ' (parado)') : null);
    }
    const partes = [s.enviado_en ? `enviado ${dm(s.enviado_en)}` : 'enlace creado', s.visto_en ? `visto ${haceTxt(s.visto_en)}` : 'aún no lo ha abierto',
      s.actualizado_en ? `actualizó ${haceTxt(s.actualizado_en)}` : null, s.n_recordatorios ? `✉ ${s.n_recordatorios} recordatorio${s.n_recordatorios > 1 ? 's' : ''}${s.recordatorio_en ? ` (último ${dm(s.recordatorio_en)})` : ''}` : null].filter(Boolean);
    const copiar = async (nuevo) => {
      try {
        if (nuevo && !confirm('El enlace anterior dejará de funcionar. ¿Crear uno nuevo?')) return;
        const r = await api('POST', `/api/seguimientos/${s.id}/enlace`, { nuevo: !!nuevo });
        await navigator.clipboard.writeText(r.url).then(() => toast('Enlace copiado: pégalo en WhatsApp o en un correo'), () => prompt('Copia el enlace:', r.url));
      } catch (e) { toast(e.message, true); }
    };
    return el('div', { class: 'ext-seg' },
      el('span', { class: 'ext-seg-txt' }, `📨 Seguimiento: ${partes.join(' · ')}`),
      el('button', { type: 'button', class: 'ghost mini', onclick: () => copiar(false), title: 'Copiar su enlace' }, '🔗 Enlace'),
      el('button', { type: 'button', class: 'ghost mini', onclick: () => dialogoSeguimiento(t, o, s), title: 'Volver a enviarlo por correo' }, '✉ Reenviar'),
      el('button', { type: 'button', class: 'ghost mini', onclick: () => copiar(true), title: 'Anular el enlace y crear otro' }, 'Nuevo'),
      el('button', { type: 'button', class: 'ghost mini', title: 'Parar: el enlace deja de funcionar y no hay más recordatorios',
        onclick: async () => {
          if (!confirm(`¿Parar el seguimiento con ${t.proveedor}? Su enlace dejará de funcionar.`)) return;
          try { await api('PATCH', `/api/seguimientos/${s.id}`, { activo: false }); toast('Seguimiento parado'); await refrescarOT(); } catch (e) { toast(e.message, true); }
        } }, '⏹ Parar'));
  }

  function dialogoSeguimiento(t, o, s) {
    const pv = (estado.catalogo.talleres || []).find((x) => x.id === t.proveedor_id) || {};
    const suyas = o.lista_tareas.filter((y) => y.proveedor_id === t.proveedor_id);
    const dlg = el('dialog', { class: 'dlg-seg', 'aria-labelledby': 'seg-tit' });
    let modo = 'correo';
    const email = el('input', { type: 'email', value: s?.email || pv.email || '', placeholder: 'correo del taller', 'aria-label': 'Correo del taller', maxlength: 200 });
    const opc = (m, tit, sub) => el('label', { class: `seg-op${m === modo ? ' on' : ''}` },
      el('input', { type: 'radio', name: 'seg-modo', value: m, checked: m === modo, onchange: () => { modo = m; dlg.querySelectorAll('.seg-op').forEach((n) => n.classList.toggle('on', n.querySelector('input').value === m)); email.disabled = m !== 'correo'; } }),
      el('b', {}, tit), el('br'), el('small', {}, sub));
    const cerrar = () => { dlg.close(); dlg.remove(); };
    dlg.append(
      el('h2', { id: 'seg-tit' }, `Seguimiento con ${t.proveedor}`),
      el('p', { class: 'ayuda' }, `OT ${o.codigo} ${o.titulo} · ${suyas.map((y) => `${y.codigo} ${y.nombre}`).join(', ')}`),
      el('div', { class: 'seg-ops' }, opc('correo', '✉ Enviar por correo', 'con el enlace y sus tareas'), opc('enlace', '💬 Copiar el enlace', 'para WhatsApp')),
      el('label', { class: 'seg-email' }, el('span', {}, 'Correo'), email),
      el('p', { class: 'ayuda' }, 'Verá sus tareas de esta OT con nuestras fechas y las de los otros talleres, y podrá poner cómo van, cuándo terminará, fotos, comentarios y a quién lo entrega. No hace falta usuario. Si pasa su fecha sin terminar y sin noticias, le llegará un correo de recordatorio cada día laborable.'),
      el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: cerrar }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async (ev) => {
          ev.target.disabled = true;
          try {
            const r = await api('POST', `/api/ordenes/${o.id}/seguimientos`, { proveedor_id: t.proveedor_id, email: email.value.trim() || null, enviar: modo === 'correo' });
            if (modo === 'enlace') await navigator.clipboard.writeText(r.url).then(() => toast('Enlace copiado: pégalo en WhatsApp'), () => prompt('Copia el enlace:', r.url));
            else toast(`Enviado a ${email.value.trim()}`);
            cerrar(); await refrescarOT();
          } catch (e) { toast(e.message, true); ev.target.disabled = false; }
        } }, s ? 'Enviar' : 'Comenzar y enviar')));
    dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); cerrar(); });
    document.body.append(dlg);
    dlg.showModal();
  }

  // Situación del producto: dónde está la OT cuando está fuera
  function situacionOT(sit, compacta) {
    if (!sit) return null;
    const ico = { fuera: '🏭', listo: '🏭', pendiente: '⏳', vuelto: '✔' }[sit.nivel] || '🏭';
    if (compacta) return el('span', { class: `item-sub sit-ot sit-${sit.nivel}` }, `${ico} ${sit.texto}`);
    return el('div', { class: `sit-ot-caja sit-${sit.nivel}` },
      el('div', {}, el('b', {}, '📍 Situación del producto: '), sit.texto),
      el('ol', { class: 'sit-pasos' }, sit.pasos.map((x) => el('li', { class: x.estado },
        el('span', { class: 'sit-p-ico', 'aria-hidden': 'true' }, x.estado === 'hecha' ? '✔' : x.estado === 'en_curso' ? '●' : '○'),
        `${x.nombre} · ${x.proveedor}`,
        x.estado === 'en_curso' && x.avance != null ? ` · ${x.avance} %` : '',
        x.estado !== 'hecha' && x.fin_prevista ? el('span', { class: x.hasta && x.fin_prevista > x.hasta ? 'ext-tarde' : null }, ` · termina ${dm(x.fin_prevista)}`) : '',
        x.entregado_a ? ` · entregado a ${x.entregado_a}${x.entrega_fecha ? ` ${dm(x.entrega_fecha)}` : ''}` : '',
        x.desde ? el('small', {}, ` ${x.desde === x.hasta ? fechaCorta(x.desde).slice(0, 5) : `${fechaCorta(x.desde).slice(0, 5)}→${fechaCorta(x.hasta).slice(0, 5)}`}`) : el('small', {}, ' sin planificar')))));
  }

  // Horas reales de la tarea y su rendimiento (hecha) o lo que lleva (en curso)
  function realTarea(t) {
    const a = t.avance;
    if (!a || !a.real_h) return null;
    const txt = (x) => durTxt(+x.toFixed(1));
    if (a.hecha) {
      return el('span', { class: 'real-tarea', title: `Prevista en ${txt(a.prev_h)} (horas-persona) · costó ${txt(a.real_h)}` },
        el('br'), `real ${txt(a.real_h)} `,
        a.rendimiento_pct != null ? el('span', { class: `av-rend${window.s360.claseRend(a.rendimiento_pct)}` }, `${a.rendimiento_pct} %`) : null);
    }
    return el('span', { class: `real-tarea${a.real_h > a.prev_h ? ' pasada' : ''}`, title: 'Horas-persona apuntadas en el parte, de las previstas' },
      el('br'), `llevas ${txt(a.real_h)} de ${txt(a.prev_h)}${a.real_h > a.prev_h ? ' ⚠' : ''}`);
  }

  /* ---------- importar proyecto del compositor (diálogo) ---------- */
  const imp = { archivo: null, nombre: '', resoluciones: {}, informe: null, ocupado: false };
  const CLASE_TXT = { area: 'Área', area_tipo: 'Área de obra', tipo: { operario: 'Categoría', maquina: 'Tipo de máquina', subcontrata: 'Subcontrata / alquiler' }, recurso: 'Recurso concreto', capacidad: 'Capacidad (saber hacer)' };
  const ESTADO_RES = { recordado: ['recordado', 'Asociación recordada de una importación anterior'], parecido: ['parecido', 'Se parece a uno que ya existe: compruébalo'], falta: ['nuevo', 'No existe en el planificador'], varias: ['varias', 'Hay varias áreas de ese tipo: elige una'], elegido: ['elegido', 'Lo has elegido en esta vista previa'] };
  const CAMPO_TXT = { nombre: 'nombre', titulo: 'título', duracion_h: 'horas', operarios_req: 'operarios', linea_id: 'área', notas: 'notas', descripcion: 'descripción', prioridad: 'prioridad', fecha_entrega: 'entrega', codigo: 'código', tipos: 'requisitos', recursos: 'recursos concretos', dependencias: 'dependencias', ot: 'OT', orden: 'posición', extra: 'datos extra', cliente: 'cliente', obra: 'obra', partida_id: 'partida', color: 'color',
    cantidad: 'cantidad', unidad: 'unidad', nota: 'nota', enlaces: 'enlaces', desglose: 'desglose de tiempos' };

  function abrirImportar() {
    Object.assign(imp, { archivo: null, nombre: '', resoluciones: {}, informe: null });
    $('#imp-informe').replaceChildren();
    $('#imp-estado').textContent = '';
    $('#imp-soltar').hidden = false;
    $('#imp-intro').hidden = false;
    $('#imp-confirmar').disabled = true;
    $('#imp-archivo').value = '';
    $('#dlg-importar').showModal();
  }

  async function leerArchivoImp(f) {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) return toast('El archivo pasa de 2 MB', true);
    let datos;
    try { datos = JSON.parse(await f.text()); }
    catch (e) { return pintarInforme({ ok: false, errores: [{ ruta: f.name, mensaje: `No es un JSON válido: ${e.message}` }] }); }
    Object.assign(imp, { archivo: datos, nombre: f.name, resoluciones: {} });
    await simularImp();
  }

  async function simularImp() {
    imp.ocupado = true;
    $('#imp-confirmar').disabled = true;
    $('#imp-estado').textContent = 'Comprobando…';
    try {
      pintarInforme(await api('POST', '/api/importar?simular=1', { archivo: imp.archivo, resoluciones: imp.resoluciones }));
    } catch (e) {
      $('#imp-estado').textContent = '';
      toast(e.message, true);
    } finally { imp.ocupado = false; }
  }

  function pintarInforme(r) {
    imp.informe = r;
    const caja = $('#imp-informe');
    $('#imp-soltar').hidden = !!imp.archivo && r.ok;
    $('#imp-intro').hidden = !!imp.archivo;
    $('#imp-confirmar').disabled = !r.ok || !puedeEditar();
    if (!r.ok) {
      $('#imp-estado').textContent = '';
      caja.replaceChildren(
        el('div', { class: 'imp-error' },
          el('h3', {}, `${imp.nombre ? imp.nombre + ': ' : ''}${r.errores.length} error${r.errores.length === 1 ? '' : 'es'} · no se puede importar`),
          el('p', { class: 'ayuda' }, 'Corrige el archivo en el compositor y vuelve a exportarlo. No se ha cambiado nada.'),
          el('ul', {}, r.errores.map((e) => el('li', {}, el('code', {}, e.ruta), ` ${e.mensaje}`)))));
      return;
    }
    const R = r.resumen;
    const n = (o) => [o.crear && `${o.crear} nueva${o.crear > 1 ? 's' : ''}`, o.actualizar && `${o.actualizar} cambian`,
      o.igual && `${o.igual} igual`, o.borrar && `${o.borrar} se borran`, o.baja && `${o.baja} fuera de presupuesto`].filter(Boolean).join(' · ') || '—';
    const accionTxt = { crear: 'Proyecto nuevo', actualizar: 'Se actualiza el proyecto', igual: 'Proyecto sin cambios' }[r.proyecto.accion];
    const hayCambios = r.cambios.length || r.proyecto.accion === 'crear';
    $('#imp-estado').textContent = hayCambios ? 'Vista previa: aún no se ha cambiado nada' : 'El archivo no trae cambios';

    caja.replaceChildren(...[
      el('div', { class: `imp-proy ${r.proyecto.accion}` },
        el('span', { class: 'imp-accion' }, accionTxt),
        el('h3', {}, `${r.proyecto.codigo} · ${r.proyecto.nombre}`),
        el('dl', { class: 'imp-resumen' },
          el('dt', {}, 'Partidas'), el('dd', {}, n(R.partidas)),
          el('dt', {}, 'OTs'), el('dd', {}, n(R.ots)),
          el('dt', {}, 'Tareas'), el('dd', {}, n(R.tareas)),
          R.materiales && Object.values(R.materiales).some(Boolean) ? el('dt', {}, 'Material') : null,
          R.materiales && Object.values(R.materiales).some(Boolean) ? el('dd', {}, `${n(R.materiales)}${R.asignaciones_material ? ` · ${R.asignaciones_material} asignaciones a tareas` : ''}${R.a_logistica ? ` · ${R.a_logistica} partida(s) se envían a logística` : ''}`) : null,
          R.capacidades || R.equipos || R.herramientas ? el('dt', {}, 'Lo que piden') : null,
          R.capacidades || R.equipos || R.herramientas ? el('dd', {}, [R.capacidades && `${R.capacidades} capacidades`, R.equipos && `${R.equipos} equipos / subcontratas`, R.herramientas && `${R.herramientas} herramientas de mano`].filter(Boolean).join(' · ')) : null,
          R.desgloses ? el('dt', {}, 'Desglose') : null,
          R.desgloses ? el('dd', {}, `${R.desgloses} tarea(s) con desglose de tiempos`) : null,
          el('dt', {}, 'Horas'), el('dd', {}, `${durTxt(R.horas)} de duración · ${durTxt(R.horas_persona)} horas-persona`),
          R.dependencias ? el('dt', {}, 'Dependencias') : null, R.dependencias ? el('dd', {}, `${R.dependencias} «después de»`) : null,
          R.condiciones.crear || R.condiciones.quitar ? el('dt', {}, 'Condiciones') : null,
          R.condiciones.crear || R.condiciones.quitar ? el('dd', {}, [R.condiciones.crear && `${R.condiciones.crear} nuevas`, R.condiciones.quitar && `${R.condiciones.quitar} se quitan`].filter(Boolean).join(' · ')) : null)),
      seccionResolver(r),
      r.avisos.length ? el('details', { class: 'imp-avisos', open: r.avisos.length <= 6 },
        el('summary', {}, `${r.avisos.length} aviso${r.avisos.length > 1 ? 's' : ''}`),
        el('ul', {}, r.avisos.map((a) => el('li', {}, a.mensaje)))) : null,
      r.cambios.length ? el('details', { class: 'imp-cambios', open: r.proyecto.accion !== 'crear' && r.cambios.length <= 15 },
        el('summary', {}, `Detalle de cambios (${r.cambios.length})`),
        el('ul', {}, r.cambios.map(lineaCambio))) : null,
    ].filter(Boolean));
  }

  function lineaCambio(c) {
    const signo = { crear: '+', actualizar: '~', borrar: '−', baja: '!' }[c.accion];
    const nivel = { proyecto: 'Proyecto', partida: 'Partida', ot: 'OT', tarea: 'Tarea', material: 'Material' }[c.nivel];
    const corto = (v) => { const x = v == null || v === '' ? '—' : String(v); return x.length > 40 ? x.slice(0, 40) + '…' : x; };
    const campos = c.campos ? Object.entries(c.campos).map(([k, [a, b]]) =>
      k === 'extra' ? 'datos extra' : `${CAMPO_TXT[k] || k}: ${corto(k === 'prioridad' ? PRIORIDADES[a] : a)} → ${corto(k === 'prioridad' ? PRIORIDADES[b] : b)}`) : [];
    return el('li', { class: `c-${c.accion}` },
      el('b', { class: 'c-signo' }, signo), ` ${nivel} `, el('span', {}, `${c.codigo ? c.codigo + ' · ' : ''}${c.nombre}`),
      c.horas ? el('span', { class: 'ayuda' }, ` · ${durTxt(c.horas)}`) : null,
      c.accion === 'baja' ? el('span', { class: 'ayuda' }, ' · ya no está en el presupuesto, se conserva porque tiene planificación') : null,
      campos.length ? el('span', { class: 'ayuda' }, ` · ${campos.join(' · ')}`) : null);
  }

  // Nombres del archivo que no coinciden con lo que hay en el planificador
  function seccionResolver(r) {
    const usados = r.usados.length
      ? el('p', { class: 'ayuda' }, `${r.usados.length} nombre${r.usados.length > 1 ? 's' : ''} del archivo coincide${r.usados.length > 1 ? 'n' : ''} con áreas, tipos o recursos que ya existen.`)
      : null;
    if (!r.resolver.length) return el('div', { class: 'imp-resolver' }, usados);
    const orden = { area_tipo: 0, area: 1, capacidad: 2, tipo: 3, recurso: 4 };
    const lista = [...r.resolver].sort((a, b) => orden[a.clase] - orden[b.clase] || (a.subclase || '').localeCompare(b.subclase || ''));
    return el('div', { class: 'imp-resolver' },
      el('h4', {}, 'Nombres que no coinciden'),
      el('p', { class: 'ayuda' }, 'Elige qué hacer con cada uno. Lo que asocies a algo existente se recuerda para la próxima importación.'),
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'En el archivo'), el('th', {}, 'Qué es'), el('th', { class: 'num' }, 'Tareas'), el('th', {}, 'Qué hacer'))),
        el('tbody', {}, lista.map((e) => {
          const [badge, ayudaBadge] = ESTADO_RES[e.elegido ? 'elegido' : e.estado] || [e.estado, ''];
          const clase = e.clase === 'tipo' ? CLASE_TXT.tipo[e.subclase] : CLASE_TXT[e.clase];
          const valor = e.accion === 'asociar' ? `asociar:${e.id}` : e.accion;
          const sel = el('select', {
            'aria-label': `Qué hacer con «${e.nombre}»`, disabled: !puedeEditar(),
            onchange: (ev) => {
              const [accion, id] = ev.target.value.split(':');
              imp.resoluciones[e.clave] = accion === 'asociar' ? { accion, id: Number(id) } : { accion };
              simularImp();
            },
          },
          e.puede.includes('crear') ? el('option', { value: 'crear', selected: valor === 'crear' },
            e.clase === 'tipo' ? `Crear «${e.nombre}»` : e.clase === 'capacidad' ? `Crear capacidad «${e.nombre}»${e.familia ? ` (${e.familia})` : ''}` : `Crear área «${e.nombre}»`) : null,
          e.puede.includes('asociar') && e.opciones.length ? el('optgroup', { label: 'Usar uno que ya existe' },
            e.opciones.map((o) => el('option', { value: `asociar:${o.id}`, selected: valor === `asociar:${o.id}` }, o.nombre))) : null,
          el('option', { value: 'ignorar', selected: valor === 'ignorar' },
            e.clase === 'area' || e.clase === 'area_tipo' ? 'Sin área (se elige al planificar)' : 'No pedirlo'));
          return el('tr', { class: e.accion === 'ignorar' ? 'ignorado' : '' },
            el('td', {}, el('span', { class: 'imp-nombre' }, e.nombre),
              e.desde?.length ? el('span', { class: 'ayuda' }, ` ← «${e.desde.join('», «')}»`) : null,
              el('span', { class: `imp-badge ${e.estado}`, title: ayudaBadge }, badge)),
            el('td', { class: 'ayuda' }, clase),
            el('td', { class: 'num' }, String(e.usos)),
            el('td', {}, sel));
        }))),
      usados);
  }

  async function confirmarImp() {
    if (!imp.archivo || imp.ocupado) return;
    $('#imp-confirmar').disabled = true;
    $('#imp-estado').textContent = 'Importando…';
    try {
      const r = await api('POST', '/api/importar', { archivo: imp.archivo, resoluciones: imp.resoluciones });
      if (!r.ok) return pintarInforme(r);
      $('#dlg-importar').close();
      const R = r.resumen.tareas;
      toast(`${r.proyecto.codigo} importado: ${R.crear} tareas nuevas, ${R.actualizar} actualizadas${R.borrar ? `, ${R.borrar} borradas` : ''}`);
      // la importación puede haber creado tipos de recurso y áreas
      [estado.catalogo] = await Promise.all([api('GET', '/api/catalogo'), cargarProyectos()]);
      estado.otId = null; estado.ot = null; pintarOT();
      await elegirProyecto(r.proyecto.id);
    } catch (e) {
      toast(e.message, true);
      $('#imp-estado').textContent = '';
      $('#imp-confirmar').disabled = false;
    }
  }

  function prepararImportar() {
    $('#btn-importar').hidden = !puedeEditar();
    $('#btn-importar').onclick = abrirImportar;
    $('#dlg-importar-cerrar').onclick = () => $('#dlg-importar').close();
    $('#imp-cancelar').onclick = () => $('#dlg-importar').close();
    $('#imp-confirmar').onclick = confirmarImp;
    const zona = $('#imp-soltar');
    $('#imp-archivo').onchange = (ev) => leerArchivoImp(ev.target.files[0]);
    zona.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#imp-archivo').click(); } });
    zona.addEventListener('dragover', (ev) => { ev.preventDefault(); zona.classList.add('encima'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
    zona.addEventListener('drop', (ev) => { ev.preventDefault(); zona.classList.remove('encima'); leerArchivoImp(ev.dataTransfer.files[0]); });
  }

  /* ---------- partidas del proyecto (diálogo) ---------- */
  function abrirPartidas() {
    const p = estado.proyectos.find((x) => x.id === estado.proyectoId);
    $('#dlg-partidas-tit').textContent = `Partidas · ${p?.codigo || ''} ${p?.nombre || ''}`;
    $('#form-partida').hidden = !puedeEditar();
    pintarPartidasDlg();
    $('#dlg-partidas').showModal();
  }

  function pintarPartidasDlg() {
    const editar = puedeEditar();
    const guardar = (pa, k) => async (ev) => {
      const v = ev.target.value.trim();
      if (v === (pa[k] || '')) return;
      if (k === 'nombre' && !v) { ev.target.value = pa.nombre; return toast('El nombre es obligatorio', true); }
      try { await api('PATCH', `/api/partidas/${pa.id}`, { [k]: v }); toast('Guardado'); await cargarOTs(); await cargarOT(); }
      catch (e) { toast(e.message, true); ev.target.value = pa[k] || ''; }
    };
    if (editar) {
      ordenArrastrable($('#partidas-tbody'), async (nuevos) => {
        try { await api('PUT', `/api/proyectos/${estado.proyectoId}/partidas/orden`, { ids: nuevos }); toast('Orden guardado'); await cargarOTs(); }
        catch (e) { toast(e.message, true); }
        pintarPartidasDlg();
      });
    }
    $('#partidas-tbody').replaceChildren(...(estado.partidas.length ? estado.partidas.map((pa) => el('tr', { 'data-id': pa.id },
      el('td', { class: 'ord' }, editar ? asaOrden(pa.nombre) : ''),
      el('td', {}, el('input', { value: pa.codigo || '', maxlength: 30, 'aria-label': 'Código', placeholder: '—', disabled: !editar, onchange: guardar(pa, 'codigo') })),
      el('td', {}, el('input', { value: pa.nombre, maxlength: 120, 'aria-label': 'Nombre', disabled: !editar, onchange: guardar(pa, 'nombre') })),
      el('td', { class: 'num-txt' }, `${pa.ots} OT · ${durTxt(pa.horas)}`),
      el('td', {}, editar ? el('button', {
        type: 'button', class: 'ghost borrar', disabled: pa.ots > 0,
        title: pa.ots ? 'Tiene OTs: muévelas a otra partida para poder borrarla' : 'Borrar partida',
        'aria-label': `Borrar ${pa.nombre}`,
        onclick: async () => {
          try { await api('DELETE', `/api/partidas/${pa.id}`); toast('Partida borrada'); await cargarOTs(); pintarPartidasDlg(); }
          catch (e) { toast(e.message, true); }
        },
      }, '✕') : ''),
    )) : [el('tr', {}, el('td', { colspan: 5, class: 'ayuda' }, 'Este proyecto no tiene partidas. Crea la primera arriba.'))]));
  }

  /* ---------- altas y borrados ---------- */
  function prepararFormularios() {
    $('#form-proyecto').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const p = await api('POST', '/api/proyectos', { nombre: ev.target.nombre.value });
        ev.target.reset();
        toast(`Proyecto ${p.codigo} creado`);
        await cargarProyectos();
        await elegirProyecto(p.id);
      } catch (e) { toast(e.message, true); }
    });

    $('#form-ot').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const pid = ev.target.partida_id.value;
        const o = await api('POST', '/api/ordenes', {
          titulo: ev.target.titulo.value, proyecto_id: estado.proyectoId, partida_id: pid ? Number(pid) : null,
        });
        ev.target.titulo.value = '';
        toast(`${o.codigo} creada`);
        await Promise.all([cargarOTs(), cargarProyectos()]);
        await elegirOT(o.id);
        $('#form-tarea input[name=nombre]').focus();
      } catch (e) { toast(e.message, true); }
    });

    $('#form-tarea').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      try {
        await api('POST', `/api/ordenes/${estado.otId}/tareas`, {
          nombre: f.nombre.value, duracion_h: Number(f.duracion_h.value), operarios_req: Number(f.operarios_req.value),
        });
        f.nombre.value = '';
        f.nombre.focus();
        toast('Tarea añadida');
        await refrescarOT();
      } catch (e) { toast(e.message, true); }
    });

    prepararImportar();
    $('#btn-partidas').onclick = abrirPartidas;
    $('#dlg-partidas-cerrar').onclick = () => $('#dlg-partidas').close();
    $('#form-partida').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        await api('POST', '/api/partidas', { proyecto_id: estado.proyectoId, codigo: ev.target.codigo.value, nombre: ev.target.nombre.value });
        ev.target.reset();
        ev.target.codigo.focus();
        toast('Partida creada');
        await cargarOTs();
        pintarPartidasDlg();
      } catch (e) { toast(e.message, true); }
    });

    $('#proyecto-borrar').onclick = async () => {
      const p = estado.proyectos.find((x) => x.id === estado.proyectoId);
      if (!p || !confirm(`¿Borrar el proyecto ${p.codigo}?`)) return;
      try {
        await api('DELETE', `/api/proyectos/${p.id}`);
        toast('Proyecto borrado');
        estado.proyectoId = null; estado.otId = null; estado.ot = null;
        guardarURL(); pintarFichaProyecto(); pintarOT();
        await cargarProyectos();
      } catch (e) { toast(e.message, true); }
    };

    $('#ot-borrar').onclick = async () => {
      const o = estado.ot;
      if (!o || !confirm(`¿Borrar ${o.codigo} y sus tareas?`)) return;
      try {
        await api('DELETE', `/api/ordenes/${o.id}`);
        toast('OT borrada');
        estado.otId = null; estado.ot = null;
        guardarURL(); pintarOT();
        await Promise.all([cargarOTs(), cargarProyectos()]);
      } catch (e) { toast(e.message, true); }
    };

    $('#buscar-proyecto').oninput = pintarProyectos;
    $('#ver-cerrados').onchange = pintarProyectos;
    $('#salir').onclick = async () => { await api('POST', '/api/logout'); location.href = '/login.html'; };
  }

  /* ---------- arranque ---------- */
  async function init() {
    try { estado.usuario = await api('GET', '/api/me'); } catch { return; }
    window.s360.iniciar(estado.usuario);
    window.s360Divisores?.preparar(document.querySelector('main.gestion'), {
      clave: 'proyectos', desde: 1201, restoMin: 420,
      columnas: [{ min: 200, titulo: 'Ancho de la lista de proyectos' }, { min: 320, titulo: 'Ancho del proyecto' }],
    });
    window.s360Divisores?.columnas(document.querySelector('.tabla-tareas'), 'tareas');
    window.s360.alCambiar(async () => {
      await Promise.all([cargarProyectos(), estado.proyectoId ? cargarOTs() : null, estado.otId ? cargarOT() : null]);
      if (estado.proyectoId) pintarFichaProyecto();
    });
    $('#form-proyecto').hidden = !puedeEditar();
    prepararFormularios();

    [estado.catalogo] = await Promise.all([api('GET', '/api/catalogo'), cargarProyectos()]);

    const q = new URLSearchParams(location.search);
    let p = Number(q.get('p')) || null;
    const ot = Number(q.get('ot')) || null;
    // Viniendo del tablero solo llega la OT: se busca su proyecto
    if (ot && !p) p = (await api('GET', `/api/ordenes/${ot}`).catch(() => null))?.proyecto_id || null;
    if (p && estado.proyectos.some((x) => x.id === p)) {
      await elegirProyecto(p);
      if (ot) await elegirOT(ot);
      // viniendo de logística (material de una tarea): se señala la tarea
      const tarea = Number(q.get('tarea')) || null;
      const fila = tarea && document.querySelector(`#tareas-tbody tr[data-id="${tarea}"]`);
      if (fila) {
        fila.scrollIntoView({ block: 'center' });
        fila.classList.add('destacada');
        setTimeout(() => fila.classList.remove('destacada'), 4000);
      }
    } else if (estado.proyectos.length) {
      await elegirProyecto(estado.proyectos[0].id);
    }
  }

  init();
})();
