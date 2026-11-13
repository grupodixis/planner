/* s360_planificacion · pantalla Recursos: operarios, maquinaria y subcontratas / alquileres */
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

  const fechaCorta = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const durTxt = (h) => `${String(Math.round(h * 10) / 10).replace('.', ',')}h`;

  // Qué se pide de cada tipo de recurso. Los campos que no aparecen aquí no se usan en ese tipo.
  const TIPOS = {
    operario: {
      titulo: 'Operarios', singular: 'operario', alta: 'Nombre del operario',
      campos: [
        { k: 'nombre', e: 'Nombre', ancho: 'c2', obligatorio: true, max: 80 },
        { k: 'codigo', e: 'Nº empleado', ancho: 'c1', max: 30 },
        { k: 'vinculo', e: 'Vínculo', ancho: 'c1', opciones: { plantilla: 'Plantilla', subcontratado: 'Subcontratado' } },
        { k: 'empresa', e: 'Empresa (o autónomo)', ancho: 'c2', max: 120, si: (r) => r.vinculo === 'subcontratado' },
        { k: 'tipos', e: 'Oficios / roles', ancho: 'c4', tipos: true, ayuda: 'Una tarea puede pedir un oficio («2 × Soldador»): avisa si los asignados no lo tienen' },
        { k: 'telefono', e: 'Teléfono', ancho: 'c1', max: 40, tipo: 'tel' },
        { k: 'email', e: 'Email', ancho: 'c2', max: 120, tipo: 'email' },
        { k: 'coste_hora', e: 'Coste €/h', ancho: 'c1', tipo: 'number' },
        { k: 'departamento_id', e: 'Departamento', ancho: 'c2', departamentos: true },
        { k: 'linea_id', e: 'Puesto / área habitual', ancho: 'c2', areas: true, ayuda: 'Al planificar en ese puesto se le propone primero' },
        { k: 'notas', e: 'Notas', ancho: 'c4', max: 2000, filas: 2 },
      ],
    },
    maquina: {
      titulo: 'Maquinaria', singular: 'máquina', alta: 'Nombre de la máquina',
      campos: [
        { k: 'nombre', e: 'Nombre', ancho: 'c2', obligatorio: true, max: 80 },
        { k: 'codigo', e: 'Nº / matrícula', ancho: 'c1', max: 30 },
        { k: 'tipos', e: 'Tipo de máquina', ancho: 'c4', tipos: true, ayuda: 'Las tareas pueden pedir el tipo («una Soldadora MIG») y vale cualquier máquina de ese tipo' },
        { k: 'departamento_id', e: 'Departamento', ancho: 'c2', departamentos: true },
        { k: 'linea_id', e: 'Ubicación habitual', ancho: 'c2', areas: true },
        { k: 'coste_hora', e: 'Coste €/h', ancho: 'c1', tipo: 'number' },
        { k: 'notas', e: 'Notas (mantenimiento, capacidades…)', ancho: 'c4', max: 2000, filas: 3 },
      ],
    },
    subcontrata: {
      titulo: 'Subcontratas y alquileres', singular: 'subcontrata o alquiler', alta: 'Nombre (p. ej. Grúa 30t, Lacado)',
      campos: [
        { k: 'nombre', e: 'Nombre en el tablero', ancho: 'c2', obligatorio: true, max: 80 },
        { k: 'categoria', e: 'Clase', ancho: 'c1', opciones: { '': '—', Subcontrata: 'Subcontrata', Alquiler: 'Alquiler' } },
        { k: 'tipos', e: 'Tipo (grúa, lacado, plataforma…)', ancho: 'c4', tipos: true },
        { k: 'coste_hora', e: 'Coste €/h', ancho: 'c1', tipo: 'number' },
        { k: 'empresa', e: 'Empresa / proveedor', ancho: 'c2', max: 120 },
        { k: 'telefono', e: 'Teléfono de contacto', ancho: 'c1', max: 40, tipo: 'tel' },
        { k: 'email', e: 'Email de contacto', ancho: 'c1', max: 120, tipo: 'email' },
        { k: 'notas', e: 'Notas (condiciones, plazos de aviso…)', ancho: 'c4', max: 2000, filas: 3 },
      ],
    },
  };

  // Pestaña de catálogo de tipos (no es una clase de recurso)
  TIPOS.tipos = { titulo: 'Tipos de recurso', singular: 'tipo', alta: 'Nombre del tipo (p. ej. Soldadora MIG)', catalogo: true };
  const CLASE_TXT = { operario: 'Oficio de operario', maquina: 'Tipo de máquina', subcontrata: 'Tipo de subcontrata / alquiler' };
  const CLASE_PLURAL = { operario: 'Oficios', maquina: 'Tipos de máquina', subcontrata: 'Subcontratas / alquileres' };

  const q0 = new URLSearchParams(location.search);
  const estado = {
    usuario: null,
    tipo: TIPOS[q0.get('tipo')] ? q0.get('tipo') : 'operario',
    lista: [],
    sel: Number(q0.get('id')) || null,
    areas: [],
    tipos: [],          // catálogo completo de tipos de recurso
  };
  const puedeEditar = () => estado.usuario && estado.usuario.rol !== 'consulta';
  const guardarURL = () => history.replaceState(null, '',
    `${location.pathname}?tipo=${estado.tipo}${estado.sel ? `&id=${estado.sel}` : ''}`);

  /* ---------- campo editable que guarda al salir ---------- */
  // Tipos de un recurso: chips con × y un campo para añadir (o crear) uno de su clase
  function selectorTipos(def, r, guardar) {
    const editar = puedeEditar();
    const clase = r.tipo;
    const actuales = r.tipos || [];
    const disponibles = estado.tipos.filter((t) => t.clase === clase && !actuales.some((a) => a.id === t.id));
    const fijar = (ids) => guardar('tipos', ids).then(() => toast('Guardado')).catch((e) => toast(e.message, true));
    const listaId = `tipos-${clase}-sug`;
    const input = el('input', { list: listaId, placeholder: 'Añadir tipo…', maxlength: 60, 'aria-label': `Añadir ${def.e}`, disabled: !editar });
    const anadir = async () => {
      const nombre = input.value.trim().replace(/\s+/g, ' ');
      if (!nombre) return;
      let t = estado.tipos.find((x) => x.clase === clase && x.nombre.toLowerCase() === nombre.toLowerCase());
      try {
        if (!t) { t = await api('POST', '/api/tipos-recurso', { clase, nombre }); estado.tipos.push(t); toast(`Tipo «${t.nombre}» creado`); }
        if (actuales.some((a) => a.id === t.id)) return;
        await fijar([...actuales.map((a) => a.id), t.id]);
      } catch (e) { toast(e.message, true); }
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); anadir(); } });
    return el('div', { class: `campo ${def.ancho || 'c4'}` },
      el('span', { class: 'etq' }, def.e),
      el('div', { class: 'chips-tipos' },
        actuales.length ? actuales.map((t) => el('span', { class: 'chip' }, t.nombre,
          editar ? el('button', {
            type: 'button', title: `Quitar ${t.nombre}`, 'aria-label': `Quitar ${t.nombre}`,
            onclick: () => fijar(actuales.filter((a) => a.id !== t.id).map((a) => a.id)),
          }, '×') : null)) : el('span', { class: 'ayuda' }, 'ninguno'),
        editar ? el('span', { class: 'anadir-tipo' }, input, el('button', { type: 'button', class: 'ghost', onclick: anadir }, 'Añadir')) : null,
        el('datalist', { id: listaId }, disponibles.map((t) => el('option', { value: t.nombre })))),
      def.ayuda ? el('span', { class: 'ayuda' }, def.ayuda) : null);
  }

  function campo(def, valor, guardar, r) {
    if (def.tipos) return selectorTipos(def, r, guardar);
    const id = `c-${def.k}`;
    let input;
    if (def.opciones || def.areas || def.departamentos) {
      const ops = def.areas ? { '': '—', ...Object.fromEntries(estado.areas.map((a) => [a.id, a.departamento ? `${a.nombre} · ${a.departamento.replace(/^Departamento (de |)/, '')}` : a.nombre])) }
        : def.departamentos ? { '': '—', ...Object.fromEntries(estado.departamentos.map((d) => [d.id, d.nombre])) } : def.opciones;
      input = el('select', { id }, Object.entries(ops).map(([v, t]) => el('option', { value: v, selected: String(v) === String(valor ?? '') }, t)));
    } else if (def.filas) {
      input = el('textarea', { id, rows: def.filas, maxlength: def.max });
      input.value = valor ?? '';
    } else {
      input = el('input', {
        id, type: def.tipo === 'number' ? 'text' : (def.tipo || 'text'), maxlength: def.max, value: valor ?? '',
        inputmode: def.tipo === 'number' ? 'decimal' : null, list: def.sugerencias ? `${id}-sug` : null,
      });
    }
    input.disabled = !puedeEditar();
    let previo = input.value;
    input.addEventListener('change', async () => {
      const v = input.value.trim();
      if (def.obligatorio && !v) { input.value = previo; return toast(`${def.e} es obligatorio`, true); }
      try { await guardar(def.k, v === '' ? null : v); previo = input.value; toast('Guardado'); }
      catch (e) { toast(e.message, true); input.value = previo; }
    });
    return el('div', { class: `campo ${def.ancho || 'c1'}` },
      el('label', { for: id }, def.e), input,
      def.sugerencias ? el('datalist', { id: `${id}-sug` }, def.sugerencias.map((s) => el('option', { value: s }))) : null);
  }

  /* ---------- lista ---------- */
  async function cargar() {
    estado.tipos = await api('GET', '/api/tipos-recurso');
    estado.lista = TIPOS[estado.tipo].catalogo ? estado.tipos : await api('GET', `/api/recursos?tipo=${estado.tipo}`);
    if (estado.sel && !estado.lista.some((r) => r.id === estado.sel)) estado.sel = null;
    pintar();
  }

  function pintar() {
    const T = TIPOS[estado.tipo];
    document.querySelectorAll('[role=tab]').forEach((b) => {
      const activo = b.dataset.tipo === estado.tipo;
      b.setAttribute('aria-selected', activo ? 'true' : 'false');
      b.tabIndex = activo ? 0 : -1;
    });
    $('#panel-recursos').setAttribute('aria-labelledby', `tab-${estado.tipo}`);
    const activos = T.catalogo ? estado.lista.length : estado.lista.filter((r) => r.activo).length;
    $('#lista-titulo').textContent = `${T.titulo} (${activos})`;
    $('#form-alta input').placeholder = T.alta;
    $('#form-alta').hidden = !puedeEditar();
    $('#form-alta select[name=clase]').hidden = !T.catalogo;
    $('#ver-inactivos').parentElement.hidden = !!T.catalogo;
    pintarLista();
    pintarFicha();
    guardarURL();
  }

  function pintarLista() {
    if (TIPOS[estado.tipo].catalogo) return pintarListaTipos();
    const q = $('#buscar').value.trim().toLowerCase();
    const inactivos = $('#ver-inactivos').checked;
    const lista = estado.lista.filter((r) =>
      (inactivos || r.activo || r.id === estado.sel) &&
      (!q || `${r.nombre} ${r.codigo || ''} ${r.categoria || ''} ${r.empresa || ''} ${r.tipos.map((t) => t.nombre).join(' ')}`.toLowerCase().includes(q)));
    $('#lista').replaceChildren(...(lista.length ? lista.map((r) => el('li', {},
      el('button', {
        class: `item${r.id === estado.sel ? ' sel' : ''}${r.activo ? '' : ' cerrado'}`,
        'aria-current': r.id === estado.sel ? 'true' : false,
        onclick: () => { estado.sel = r.id; pintarLista(); pintarFicha(); guardarURL(); },
      },
        el('span', { class: 'item-tit' }, r.codigo ? el('b', {}, `${r.codigo} `) : null, r.nombre),
        el('span', { class: 'item-sub' }, [
          r.tipo === 'subcontrata' ? r.categoria : null, r.vinculo === 'subcontratado' ? 'subcontratado' : null,
          r.tipos.map((t) => t.nombre).join(', ') || null, r.empresa,
          r.proximo ? `próximo ${fechaCorta(r.proximo).slice(0, 5)}` : null,
          r.activo ? null : 'dado de baja',
        ].filter(Boolean).join(' · ') || '—')),
    )) : [el('li', { class: 'ayuda' }, q ? 'Nada coincide con la búsqueda.' : `Todavía no hay ${TIPOS[estado.tipo].titulo.toLowerCase()}.`)]));
  }

  /* ---------- ficha ---------- */
  function pintarFicha() {
    if (TIPOS[estado.tipo].catalogo) return pintarFichaTipo();
    const r = estado.lista.find((x) => x.id === estado.sel);
    $('#ficha-vacia').hidden = !!r;
    $('#ficha').hidden = !r;
    if (!r) return;
    const T = TIPOS[estado.tipo];
    const editar = puedeEditar();
    $('#ficha-titulo').textContent = `${r.nombre}${r.activo ? '' : ' (dado de baja)'}`;

    const usado = r.usos + r.requerido > 0;
    const baja = $('#baja');
    baja.hidden = !editar;
    if (r.activo) {
      baja.textContent = usado ? 'Dar de baja' : 'Borrar';
      baja.className = 'ghost borrar';
      baja.title = usado ? 'Tiene historial: se da de baja (deja de salir en el tablero) pero se conserva' : 'Nunca se ha usado: se borra';
      baja.onclick = async () => {
        if (!confirm(usado ? `¿Dar de baja «${r.nombre}»? Dejará de salir para asignar, pero se conserva su historial.` : `¿Borrar «${r.nombre}»?`)) return;
        try {
          const x = await api('DELETE', `/api/recursos/${r.id}`);
          toast(x.desactivado ? `${r.nombre} dado de baja` : `${r.nombre} borrado`);
          if (x.borrado) estado.sel = null;
          await cargar();
        } catch (e) { toast(e.message, true); }
      };
    } else {
      baja.textContent = 'Reactivar';
      baja.className = 'primario';
      baja.title = 'Vuelve a salir en el tablero para asignar';
      baja.onclick = () => guardar('activo', true).then(() => toast(`${r.nombre} reactivado`)).catch((e) => toast(e.message, true));
    }
    const verTablero = $('#ver-tablero');
    verTablero.hidden = !r.proximo;
    if (r.proximo) verTablero.href = `/?fecha=${r.proximo}`;

    async function guardar(k, v) {
      const x = await api('PATCH', `/api/recursos/${r.id}`, { [k]: v });
      Object.assign(r, x);
      if (k === 'tipos') { await cargar(); return; }
      if (k === 'vinculo') { pintarLista(); pintarFicha(); return; }
      if (k === 'nombre' || k === 'codigo' || k === 'categoria' || k === 'empresa' || k === 'activo') { pintarLista(); }
      if (k === 'nombre' || k === 'activo') $('#ficha-titulo').textContent = `${r.nombre}${r.activo ? '' : ' (dado de baja)'}`;
      if (k === 'activo') await cargar();
    }
    $('#campos').replaceChildren(...T.campos.filter((def) => !def.si || def.si(r)).map((def) => campo(def, r[def.k], guardar, r)),
      // Una persona dada de alta como subcontrata que en realidad trabaja de operario
      ...(r.tipo === 'subcontrata' && editar ? [el('div', { class: 'campo c4 pasar-operario' },
        el('span', { class: 'ayuda' }, '¿Es una persona que trabaja como operario (pintor, montador…)? Como operario subcontratado cuenta en los operarios de las tareas, puede tener oficio y suma horas-persona.'),
        el('button', {
          type: 'button', class: 'ghost',
          onclick: async () => {
            if (!confirm(`¿Pasar «${r.nombre}» a Operarios como subcontratado? Sus tipos de subcontrata se quitan; luego le pones su oficio.`)) return;
            try {
              await api('PATCH', `/api/recursos/${r.id}`, { tipo: 'operario', vinculo: 'subcontratado', categoria: null });
              toast(`${r.nombre} pasa a Operarios (subcontratado)`);
              estado.tipo = 'operario';
              await cargar();
            } catch (e) { toast(e.message, true); }
          },
        }, 'Pasar a Operarios'))] : []));

    $('#uso').replaceChildren(
      el('dt', {}, 'Próximas 2 semanas'), el('dd', {}, r.horas_14d ? `${durTxt(r.horas_14d)} asignadas` : 'nada asignado'),
      el('dt', {}, 'Próxima asignación'), el('dd', {}, r.proximo ? el('a', { href: `/?fecha=${r.proximo}` }, fechaCorta(r.proximo)) : '—'),
      el('dt', {}, 'Última asignación'), el('dd', {}, r.ultimo ? fechaCorta(r.ultimo) : '—'),
      el('dt', {}, 'Historial'), el('dd', {}, `${r.usos} tramo(s)${r.requerido ? ` · requerido en ${r.requerido} tarea(s)` : ''}`),
    );
  }

  /* ---------- pestaña «Tipos de recurso» ---------- */
  function pintarListaTipos() {
    const q = $('#buscar').value.trim().toLowerCase();
    const lista = estado.lista.filter((t) => !q || t.nombre.toLowerCase().includes(q));
    const grupos = ['maquina', 'subcontrata', 'operario'].map((c) => [c, lista.filter((t) => t.clase === c)]);
    $('#lista').replaceChildren(...(lista.length ? grupos.flatMap(([c, ts]) => (ts.length ? [
      el('li', { class: 'grupo-partida' }, el('span', { class: 'gp-nom' }, CLASE_PLURAL[c]), el('span', { class: 'gp-sub' }, String(ts.length))),
      ...ts.map((t) => el('li', {}, el('button', {
        class: `item${t.id === estado.sel ? ' sel' : ''}`, 'aria-current': t.id === estado.sel ? 'true' : false,
        onclick: () => { estado.sel = t.id; pintarLista(); pintarFicha(); guardarURL(); },
      },
        el('span', { class: 'item-tit' }, t.nombre),
        el('span', { class: 'item-sub' }, [
          t.recursos.length ? `${t.recursos.filter((r) => r.activo).length} dado(s) de alta` : 'ninguno dado de alta',
          t.tareas ? `lo piden ${t.tareas} tarea(s)` : null,
        ].filter(Boolean).join(' · '))))),
    ] : [])) : [el('li', { class: 'ayuda' }, q ? 'Nada coincide con la búsqueda.' : 'Todavía no hay tipos. Crea el primero arriba.')]));
  }

  function pintarFichaTipo() {
    const t = estado.lista.find((x) => x.id === estado.sel);
    $('#ficha-vacia').hidden = !!t;
    $('#ficha').hidden = !t;
    if (!t) return;
    const editar = puedeEditar();
    $('#ficha-titulo').textContent = t.nombre;
    $('#ver-tablero').hidden = true;
    const baja = $('#baja');
    baja.hidden = !editar;
    baja.textContent = 'Borrar';
    baja.className = 'ghost borrar';
    baja.title = t.tareas ? 'Lo piden tareas: quítalo de sus requisitos para poder borrarlo' : 'Borrar el tipo (los recursos que lo tienen lo pierden)';
    baja.onclick = async () => {
      if (!confirm(`¿Borrar el tipo «${t.nombre}»?`)) return;
      try { await api('DELETE', `/api/tipos-recurso/${t.id}`); toast('Tipo borrado'); estado.sel = null; await cargar(); }
      catch (e) { toast(e.message, true); }
    };
    const guardar = async (k, v) => {
      await api('PATCH', `/api/tipos-recurso/${t.id}`, { nombre: v });
      await cargar();
    };
    $('#campos').replaceChildren(
      campo({ k: 'nombre', e: 'Nombre', ancho: 'c2', obligatorio: true, max: 60 }, t.nombre, guardar),
      el('div', { class: 'campo c2' }, el('span', { class: 'etq' }, 'Clase'), el('div', { class: 'valor' }, CLASE_TXT[t.clase])),
    );
    $('#uso').replaceChildren(
      el('dt', {}, 'Recursos de este tipo'), el('dd', {}, t.recursos.length
        ? t.recursos.map((r, i) => [i ? ', ' : '', el('a', { href: `/recursos.html?tipo=${t.clase}&id=${r.id}` }, r.nombre + (r.activo ? '' : ' (de baja)'))])
        : 'ninguno dado de alta: las tareas que lo pidan saldrán con un aviso suave'),
      el('dt', {}, 'Lo piden'), el('dd', {}, t.tareas ? `${t.tareas} tarea(s)` : 'ninguna tarea'),
    );
  }

  /* ---------- semillero (solo administrador) ---------- */
  const sem = { datos: null, nombre: '' };
  const SECCIONES = [['departamentos', 'Departamentos'], ['areas', 'Áreas fijas'], ['tipos', 'Tipos de recurso'], ['recursos', 'Recursos'], ['tareas', 'Tareas afectadas']];
  const ACC_TXT = { crear: 'nuevos', renombrar: 'se renombran', actualizar: 'se actualizan', fusionar: 'se fusionan', borrar: 'se borran',
    desactivar: 'se desactivan (tienen historial)', reactivar: 'se reactivan', 'sin control': 'dejan de pedirse', 'pasa a área': 'pasan a ser un área',
    'área': 'van a un área', 'sin área': 'quedan sin área', tramos: 'tramos reubicados' };

  async function simularSemillero() {
    $('#sem-confirmar').disabled = true;
    $('#sem-estado').textContent = 'Comprobando…';
    try { pintarSemillero(await api('POST', '/api/semillero?simular=1', sem.datos)); }
    catch (e) { $('#sem-estado').textContent = ''; toast(e.message, true); }
  }

  function pintarSemillero(r) {
    const caja = $('#sem-informe');
    $('#sem-confirmar').disabled = !r.ok;
    if (!r.ok) {
      $('#sem-estado').textContent = '';
      caja.replaceChildren(el('div', { class: 'imp-error' }, el('h3', {}, `${sem.nombre}: no se puede cargar`),
        el('ul', {}, (r.errores || []).map((e) => el('li', {}, e)))));
      return;
    }
    $('#sem-soltar').hidden = true;
    $('#sem-estado').textContent = r.simulado ? 'Vista previa: aún no se ha cambiado nada' : '';
    caja.replaceChildren(
      el('div', { class: 'imp-proy' },
        el('span', { class: 'imp-accion' }, 'Después de cargar'),
        el('h3', {}, `${r.totales.areas} áreas fijas · ${r.totales.recursos} recursos activos · ${r.totales.tipos} tipos`),
        el('dl', { class: 'imp-resumen' }, SECCIONES.flatMap(([k, t]) => {
          const res = Object.entries(r.resumen[k] || {});
          return res.length ? [el('dt', {}, t), el('dd', {}, res.map(([a, n]) => `${n} ${ACC_TXT[a] || a}`).join(' · '))] : [];
        }))),
      ...(r.avisos.length ? [el('details', { class: 'imp-avisos', open: true }, el('summary', {}, `${r.avisos.length} aviso(s)`),
        el('ul', {}, r.avisos.map((a) => el('li', {}, a))))] : []),
      ...SECCIONES.filter(([k]) => r[k].length).map(([k, t]) => el('details', { class: 'imp-cambios', open: ['areas', 'tareas'].includes(k) },
        el('summary', {}, `${t} (${r[k].length})`),
        el('ul', {}, r[k].map((x) => el('li', { class: `c-${['crear'].includes(x.accion) ? 'crear' : ['borrar', 'desactivar', 'sin control'].includes(x.accion) ? 'borrar' : 'actualizar'}` },
          el('b', { class: 'c-signo' }, x.accion === 'crear' ? '+' : ['borrar', 'desactivar', 'sin control'].includes(x.accion) ? '−' : '~'),
          ` ${x.accion} · `, el('span', {}, x.nombre), x.detalle ? el('span', { class: 'ayuda' }, ` · ${x.detalle}`) : null))))));
  }

  async function leerSemillero(f) {
    if (!f) return;
    try { sem.datos = JSON.parse(await f.text()); sem.nombre = f.name; }
    catch (e) { return pintarSemillero({ ok: false, errores: [`No es un JSON válido: ${e.message}`] }); }
    await simularSemillero();
  }

  function prepararSemillero() {
    const esAdmin = estado.usuario?.rol === 'admin';
    $('#btn-semillero').hidden = !esAdmin;
    if (!esAdmin) return;
    const dlg = $('#dlg-semillero');
    $('#btn-semillero').onclick = () => {
      sem.datos = null;
      $('#sem-informe').replaceChildren(); $('#sem-estado').textContent = ''; $('#sem-soltar').hidden = false;
      $('#sem-confirmar').disabled = true; $('#sem-archivo').value = '';
      dlg.showModal();
    };
    $('#sem-cerrar').onclick = () => dlg.close();
    $('#sem-cancelar').onclick = () => dlg.close();
    $('#sem-archivo').onchange = (ev) => leerSemillero(ev.target.files[0]);
    const zona = $('#sem-soltar');
    zona.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); $('#sem-archivo').click(); } });
    zona.addEventListener('dragover', (ev) => { ev.preventDefault(); zona.classList.add('encima'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
    zona.addEventListener('drop', (ev) => { ev.preventDefault(); zona.classList.remove('encima'); leerSemillero(ev.dataTransfer.files[0]); });
    $('#sem-confirmar').onclick = async () => {
      $('#sem-confirmar').disabled = true;
      $('#sem-estado').textContent = 'Cargando…';
      try {
        const r = await api('POST', '/api/semillero', sem.datos);
        if (!r.ok) return pintarSemillero(r);
        dlg.close();
        toast(`Semillero cargado: ${r.totales.areas} áreas, ${r.totales.recursos} recursos`);
        location.reload();
      } catch (e) { toast(e.message, true); $('#sem-estado').textContent = ''; $('#sem-confirmar').disabled = false; }
    };
  }

  /* ---------- arranque ---------- */
  function cambiarTipo(tipo) {
    if (tipo === estado.tipo) return;
    estado.tipo = tipo;
    estado.sel = null;
    $('#buscar').value = '';
    cargar().catch((e) => toast(e.message, true));
  }

  async function init() {
    try { estado.usuario = await api('GET', '/api/me'); } catch { return; }
    $('#usuario-nombre').textContent = `${estado.usuario.nombre}${estado.usuario.rol === 'consulta' ? ' (consulta)' : ''}`;
    prepararSemillero();
    $('#salir').onclick = async () => { await api('POST', '/api/logout'); location.href = '/login.html'; };

    const tabs = [...document.querySelectorAll('[role=tab]')];
    tabs.forEach((b, i) => {
      b.onclick = () => cambiarTipo(b.dataset.tipo);
      b.onkeydown = (ev) => {   // flechas para moverse entre pestañas
        if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
        const j = (i + (ev.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
        tabs[j].focus();
        cambiarTipo(tabs[j].dataset.tipo);
      };
    });
    $('#buscar').oninput = pintarLista;
    $('#ver-inactivos').onchange = pintarLista;
    $('#form-alta').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      try {
        const r = TIPOS[estado.tipo].catalogo
          ? await api('POST', '/api/tipos-recurso', { clase: ev.target.clase.value, nombre: ev.target.nombre.value })
          : await api('POST', '/api/recursos', { tipo: estado.tipo, nombre: ev.target.nombre.value });
        ev.target.nombre.value = '';
        estado.sel = r.id;
        toast(`${r.nombre} dado de alta`);
        await cargar();
        document.querySelector('#campos input:not([id=c-nombre]), #campos select')?.focus();
      } catch (e) { toast(e.message, true); }
    });

    const cat = await api('GET', '/api/catalogo');
    estado.areas = cat.areas;
    estado.departamentos = cat.departamentos || [];
    await cargar();
  }

  init();
})();
