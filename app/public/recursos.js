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
    for (const h of hijos.flat()) if (h != null && h !== false) n.append(h);
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
        { k: 'categoria', e: 'Oficio / categoría', ancho: 'c1', max: 60, sugerencias: ['Soldador', 'Montador', 'Oficial cerrajero', 'Ayudante', 'Chófer', 'Técnico de oficina'] },
        { k: 'telefono', e: 'Teléfono', ancho: 'c1', max: 40, tipo: 'tel' },
        { k: 'email', e: 'Email', ancho: 'c2', max: 120, tipo: 'email' },
        { k: 'coste_hora', e: 'Coste €/h', ancho: 'c1', tipo: 'number' },
        { k: 'linea_id', e: 'Área habitual', ancho: 'c2', areas: true },
        { k: 'notas', e: 'Notas', ancho: 'c4', max: 2000, filas: 2 },
      ],
    },
    maquina: {
      titulo: 'Maquinaria', singular: 'máquina', alta: 'Nombre de la máquina',
      campos: [
        { k: 'nombre', e: 'Nombre', ancho: 'c2', obligatorio: true, max: 80 },
        { k: 'codigo', e: 'Nº / matrícula', ancho: 'c1', max: 30 },
        { k: 'categoria', e: 'Tipo de máquina', ancho: 'c1', max: 60, sugerencias: ['Sierra', 'Soldadora MIG', 'Soldadora TIG', 'Corte láser', 'Plegadora', 'Cizalla', 'Taladro', 'Carretilla'] },
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
        { k: 'coste_hora', e: 'Coste €/h', ancho: 'c1', tipo: 'number' },
        { k: 'empresa', e: 'Empresa / proveedor', ancho: 'c2', max: 120 },
        { k: 'telefono', e: 'Teléfono de contacto', ancho: 'c1', max: 40, tipo: 'tel' },
        { k: 'email', e: 'Email de contacto', ancho: 'c1', max: 120, tipo: 'email' },
        { k: 'notas', e: 'Notas (condiciones, plazos de aviso…)', ancho: 'c4', max: 2000, filas: 3 },
      ],
    },
  };

  const q0 = new URLSearchParams(location.search);
  const estado = {
    usuario: null,
    tipo: TIPOS[q0.get('tipo')] ? q0.get('tipo') : 'operario',
    lista: [],
    sel: Number(q0.get('id')) || null,
    areas: [],
  };
  const puedeEditar = () => estado.usuario && estado.usuario.rol !== 'consulta';
  const guardarURL = () => history.replaceState(null, '',
    `${location.pathname}?tipo=${estado.tipo}${estado.sel ? `&id=${estado.sel}` : ''}`);

  /* ---------- campo editable que guarda al salir ---------- */
  function campo(def, valor, guardar) {
    const id = `c-${def.k}`;
    let input;
    if (def.opciones || def.areas) {
      const ops = def.areas ? { '': '—', ...Object.fromEntries(estado.areas.map((a) => [a.id, a.nombre])) } : def.opciones;
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
    estado.lista = await api('GET', `/api/recursos?tipo=${estado.tipo}`);
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
    const activos = estado.lista.filter((r) => r.activo).length;
    $('#lista-titulo').textContent = `${T.titulo} (${activos})`;
    $('#form-alta input').placeholder = T.alta;
    $('#form-alta').hidden = !puedeEditar();
    pintarLista();
    pintarFicha();
    guardarURL();
  }

  function pintarLista() {
    const q = $('#buscar').value.trim().toLowerCase();
    const inactivos = $('#ver-inactivos').checked;
    const lista = estado.lista.filter((r) =>
      (inactivos || r.activo || r.id === estado.sel) &&
      (!q || `${r.nombre} ${r.codigo || ''} ${r.categoria || ''} ${r.empresa || ''}`.toLowerCase().includes(q)));
    $('#lista').replaceChildren(...(lista.length ? lista.map((r) => el('li', {},
      el('button', {
        class: `item${r.id === estado.sel ? ' sel' : ''}${r.activo ? '' : ' cerrado'}`,
        'aria-current': r.id === estado.sel ? 'true' : false,
        onclick: () => { estado.sel = r.id; pintarLista(); pintarFicha(); guardarURL(); },
      },
        el('span', { class: 'item-tit' }, r.codigo ? el('b', {}, `${r.codigo} `) : null, r.nombre),
        el('span', { class: 'item-sub' }, [
          r.categoria, r.empresa,
          r.proximo ? `próximo ${fechaCorta(r.proximo).slice(0, 5)}` : null,
          r.activo ? null : 'dado de baja',
        ].filter(Boolean).join(' · ') || '—')),
    )) : [el('li', { class: 'ayuda' }, q ? 'Nada coincide con la búsqueda.' : `Todavía no hay ${TIPOS[estado.tipo].titulo.toLowerCase()}.`)]));
  }

  /* ---------- ficha ---------- */
  function pintarFicha() {
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
      if (k === 'nombre' || k === 'codigo' || k === 'categoria' || k === 'empresa' || k === 'activo') { pintarLista(); }
      if (k === 'nombre' || k === 'activo') $('#ficha-titulo').textContent = `${r.nombre}${r.activo ? '' : ' (dado de baja)'}`;
      if (k === 'activo') await cargar();
    }
    $('#campos').replaceChildren(...T.campos.map((def) => campo(def, r[def.k], guardar)));

    $('#uso').replaceChildren(
      el('dt', {}, 'Próximas 2 semanas'), el('dd', {}, r.horas_14d ? `${durTxt(r.horas_14d)} asignadas` : 'nada asignado'),
      el('dt', {}, 'Próxima asignación'), el('dd', {}, r.proximo ? el('a', { href: `/?fecha=${r.proximo}` }, fechaCorta(r.proximo)) : '—'),
      el('dt', {}, 'Última asignación'), el('dd', {}, r.ultimo ? fechaCorta(r.ultimo) : '—'),
      el('dt', {}, 'Historial'), el('dd', {}, `${r.usos} tramo(s)${r.requerido ? ` · requerido en ${r.requerido} tarea(s)` : ''}`),
    );
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
        const r = await api('POST', '/api/recursos', { tipo: estado.tipo, nombre: ev.target.nombre.value });
        ev.target.reset();
        estado.sel = r.id;
        toast(`${r.nombre} dado de alta`);
        await cargar();
        document.querySelector('#campos input:not([id=c-nombre]), #campos select')?.focus();
      } catch (e) { toast(e.message, true); }
    });

    estado.areas = (await api('GET', '/api/catalogo')).areas;
    await cargar();
  }

  init();
})();
