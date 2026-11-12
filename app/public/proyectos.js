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
  const puedeEditar = () => estado.usuario && estado.usuario.rol !== 'consulta';

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
    pintarCondiciones(p);
    const im = p.ultima_importacion;
    $('#proyecto-importado').textContent = im
      ? `Importado del ${im.origen?.sistema || 'compositor'} el ${fechaHoraTxt(im.creado)}${im.usuario ? ` por ${im.usuario}` : ''}${p.ref_externa ? ` · ref. ${p.ref_externa}` : ''}. Reimportar el archivo actualiza este proyecto.`
      : '';
  }

  const condPendientes = (p) => (p.condiciones || []).filter((c) => !c.cumplida).length;
  const fechaHoraTxt = (iso) => new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

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
        }, '✕') : null))) : null,
      editar ? el('form', {
        class: 'alta cond-alta',
        onsubmit: async (ev) => {
          ev.preventDefault();
          const i = ev.target.texto;
          try { await api('POST', `/api/proyectos/${p.id}/condiciones`, { texto: i.value }); await recargar(); $('#proyecto-condiciones input[name=texto]')?.focus(); }
          catch (e) { toast(e.message, true); }
        },
      }, el('input', { name: 'texto', placeholder: 'Nueva condición (p. ej. RAL confirmado por el cliente)', maxlength: 200, required: true, 'aria-label': 'Nueva condición previa' }),
      el('button', { type: 'submit' }, 'Añadir')) : null,
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
        el('span', { class: 'gp-sub' }, [
          `${ots.length} OT`,
          pa?.horas ? `${durTxt(pa.horas_planificadas)}/${durTxt(pa.horas)}` : null,
        ].filter(Boolean).join(' · '))),
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
    $('#ot-tablero').href = primeraFecha ? `/?fecha=${primeraFecha}` : '/';

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
      campo({ etiqueta: 'Código', valor: o.codigo, max: 30, ancho: 'c1', obligatorio: true, guardar: guardar('codigo') }),
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
    $('#ot-resumen').textContent = o.lista_tareas.length
      ? `${o.lista_tareas.length} tareas · ${durTxt(o.horas_planificadas)} de ${durTxt(horas)} planificadas`
        + (o.horas_planificadas > horas ? ` (+${Math.round(((o.horas_planificadas - horas) / horas) * 100)}%)` : '')
        + (o.hp_estimadas ? ` · ${durTxt(+o.hp_planificadas.toFixed(1))} de ${durTxt(o.hp_estimadas)} horas-persona` : '')
        + ` · ${o.hechas} hechas` : '';
    pintarTareas();
  }

  // Requisitos de una tarea: tipos de recurso (con cantidad) y recursos concretos
  const CLASES = [['maquina', 'Tipos de máquina'], ['subcontrata', 'Subcontratas / alquileres'], ['operario', 'Oficios']];
  function selectorRequisitos(t, recursosReq, editar, patch) {
    const tipos = estado.catalogo.tipos;
    const reqTipo = t.requisitos_tipo || [];
    const resumen = [
      ...reqTipo.map((q) => { const ti = tipos.find((x) => x.id === q.id); return ti ? `${q.cantidad > 1 ? q.cantidad + '× ' : ''}${ti.nombre}` : null; }),
      ...t.requisitos.map((id) => recursosReq.find((r) => r.id === id)?.nombre),
    ].filter(Boolean);
    const guardarTipos = (lista) => patch(t, { requisitos_tipo: lista });

    const filaTipo = (ti) => {
      const q = reqTipo.find((x) => x.id === ti.id);
      return el('label', { class: 'req-tipo' },
        el('input', {
          type: 'checkbox', checked: !!q, disabled: !editar,
          onchange: (ev) => guardarTipos(ev.target.checked ? [...reqTipo, { id: ti.id, cantidad: 1 }] : reqTipo.filter((x) => x.id !== ti.id)),
        }),
        ` ${ti.nombre}`,
        q ? el('input', {
          type: 'number', min: 1, max: 50, value: q.cantidad, class: 'cant', 'aria-label': `Cantidad de ${ti.nombre}`, disabled: !editar,
          title: 'Cuántos hacen falta a la vez',
          onclick: (ev) => ev.preventDefault(),
          onchange: (ev) => guardarTipos(reqTipo.map((x) => (x.id === ti.id ? { ...x, cantidad: Math.max(1, Number(ev.target.value) || 1) } : x))),
        }) : null,
        el('span', { class: `rt${ti.recursos ? '' : ' sin'}`, title: ti.recursos ? `${ti.recursos} dado(s) de alta` : 'Ninguno dado de alta todavía' },
          ti.recursos ? String(ti.recursos) : 'ninguno'));
    };

    return el('details', { class: 'req' },
      el('summary', {}, resumen.length ? resumen.join(', ') : '—'),
      el('div', { class: 'req-lista' },
        CLASES.map(([clase, titulo]) => {
          const lista = tipos.filter((ti) => ti.clase === clase);
          return lista.length ? [el('div', { class: 'req-grupo' }, titulo), lista.map(filaTipo)] : null;
        }),
        recursosReq.length ? el('div', { class: 'req-grupo' }, 'Recurso concreto') : null,
        recursosReq.map((r) => el('label', {},
          el('input', {
            type: 'checkbox', checked: t.requisitos.includes(r.id), disabled: !editar,
            onchange: (ev) => patch(t, { requisitos: ev.target.checked ? [...t.requisitos, r.id] : t.requisitos.filter((x) => x !== r.id) }),
          }),
          ` ${r.nombre}`, el('span', { class: `rt ${r.tipo}` }, r.tipo === 'maquina' ? 'máquina' : 'subcontrata'))),
        el('a', { class: 'req-gestionar', href: '/recursos.html?tipo=tipos' }, 'Gestionar tipos de recurso…')));
  }

  // Debajo del nombre: «ya no está en el presupuesto», dependencias y notas
  function extrasTarea(t, editar, patch) {
    const deps = t.dependencias || [];
    const espera = (d) => (d.espera_h ? ` (+${durTxt(d.espera_h)} espera)` : '');
    const depTxt = deps.map((d) => `${d.orden_codigo === estado.ot.codigo ? '' : d.orden_codigo + ' '}${d.nombre}${espera(d)}`);
    return el('div', { class: 't-extra' },
      t.baja_presupuesto ? el('span', { class: 'baja-txt' }, 'Ya no está en el presupuesto',
        editar ? el('button', {
          type: 'button', class: 'ghost mini', title: 'Quitar la marca y conservar la tarea',
          onclick: () => patch(t, { baja_presupuesto: false }),
        }, 'Mantener') : null) : null,
      deps.length ? el('span', { class: 't-deps', title: `Va después de:\n${depTxt.join('\n')}` },
        `⤷ después de ${depTxt.length === 1 ? depTxt[0] : `${depTxt[0]} y ${depTxt.length - 1} más`}`) : null,
      t.notas || editar ? el('details', { class: `t-notas${t.notas ? '' : ' vacia'}` },
        el('summary', {}, t.notas ? `Notas: ${t.notas.length > 70 ? t.notas.slice(0, 70) + '…' : t.notas}` : '+ notas'),
        el('textarea', {
          rows: 3, maxlength: 4000, 'aria-label': `Notas de ${t.nombre}`, disabled: !editar,
          onchange: (ev) => patch(t, { notas: ev.target.value }),
        }, t.notas || '')) : null);
  }

  function pintarTareas() {
    const o = estado.ot;
    const editar = puedeEditar();
    const tbody = $('#tareas-tbody');
    if (!o.lista_tareas.length) {
      tbody.replaceChildren(el('tr', {}, el('td', { colspan: 8, class: 'ayuda' }, 'Sin tareas. Añade la primera abajo.')));
      return;
    }
    const areas = Object.fromEntries([['', '—'], ...estado.catalogo.areas.map((a) => [a.id, a.nombre])]);
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

      return el('tr', { class: `${t.estado}${t.baja_presupuesto ? ' baja' : ''}`, 'data-id': t.id },
        el('td', { class: 'ord' }, editar ? asaOrden(t.nombre) : ''),
        el('td', {}, el('input', {
          value: t.nombre, maxlength: 120, 'aria-label': 'Nombre de la tarea', disabled: !editar,
          onchange: (ev) => (ev.target.value.trim() ? patch(t, { nombre: ev.target.value }) : (ev.target.value = t.nombre)),
        }), extrasTarea(t, editar, patch)),
        el('td', { class: 'num' }, el('input', {
          type: 'number', min: 0.5, step: 0.5, value: t.duracion_h, 'aria-label': 'Horas', disabled: !editar,
          onchange: (ev) => patch(t, { duracion_h: Number(ev.target.value) }),
        })),
        el('td', { class: 'num' }, el('input', {
          type: 'number', min: 0, step: 1, value: t.operarios_req, 'aria-label': 'Operarios', disabled: !editar,
          onchange: (ev) => patch(t, { operarios_req: Number(ev.target.value) }),
        })),
        el('td', {}, el('select', {
          'aria-label': 'Área por defecto', disabled: !editar,
          onchange: (ev) => patch(t, { linea_id: ev.target.value ? Number(ev.target.value) : null }),
        }, Object.entries(areas).map(([v, n]) => el('option', { value: v, selected: String(t.linea_id ?? '') === v }, n)))),
        el('td', {}, req),
        el('td', { class: 'est' }, el('span', { class: `est-${clasePlan}` }, etiquetaPlan), plan ? el('br') : null, plan),
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
    }));
  }

  /* ---------- importar proyecto del compositor (diálogo) ---------- */
  const imp = { archivo: null, nombre: '', resoluciones: {}, informe: null, ocupado: false };
  const CLASE_TXT = { area: 'Área', area_tipo: 'Área de obra', tipo: { operario: 'Oficio', maquina: 'Tipo de máquina', subcontrata: 'Subcontrata / alquiler' }, recurso: 'Recurso concreto' };
  const ESTADO_RES = { recordado: ['recordado', 'Asociación recordada de una importación anterior'], parecido: ['parecido', 'Se parece a uno que ya existe: compruébalo'], falta: ['nuevo', 'No existe en el planificador'], varias: ['varias', 'Hay varias áreas de ese tipo: elige una'], elegido: ['elegido', 'Lo has elegido en esta vista previa'] };
  const CAMPO_TXT = { nombre: 'nombre', titulo: 'título', duracion_h: 'horas', operarios_req: 'operarios', linea_id: 'área', notas: 'notas', descripcion: 'descripción', prioridad: 'prioridad', fecha_entrega: 'entrega', codigo: 'código', tipos: 'requisitos', recursos: 'recursos concretos', dependencias: 'dependencias', ot: 'OT', orden: 'posición', extra: 'datos extra', cliente: 'cliente', obra: 'obra', partida_id: 'partida', color: 'color' };

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

    caja.replaceChildren(
      el('div', { class: `imp-proy ${r.proyecto.accion}` },
        el('span', { class: 'imp-accion' }, accionTxt),
        el('h3', {}, `${r.proyecto.codigo} · ${r.proyecto.nombre}`),
        el('dl', { class: 'imp-resumen' },
          el('dt', {}, 'Partidas'), el('dd', {}, n(R.partidas)),
          el('dt', {}, 'OTs'), el('dd', {}, n(R.ots)),
          el('dt', {}, 'Tareas'), el('dd', {}, n(R.tareas)),
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
    );
  }

  function lineaCambio(c) {
    const signo = { crear: '+', actualizar: '~', borrar: '−', baja: '!' }[c.accion];
    const nivel = { proyecto: 'Proyecto', partida: 'Partida', ot: 'OT', tarea: 'Tarea' }[c.nivel];
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
    const orden = { area_tipo: 0, area: 1, tipo: 2, recurso: 3 };
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
            e.clase === 'tipo' ? `Crear «${e.nombre}»` : `Crear área «${e.nombre}»`) : null,
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
    $('#usuario-nombre').textContent = `${estado.usuario.nombre}${estado.usuario.rol === 'consulta' ? ' (consulta)' : ''}`;
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
    } else if (estado.proyectos.length) {
      await elegirProyecto(estado.proyectos[0].id);
    }
  }

  init();
})();
