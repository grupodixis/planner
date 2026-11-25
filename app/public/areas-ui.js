/* Áreas de trabajo (zonas del taller, cabina, oficina…): alta, orden, «1 a la vez», equipo fijo.
   Se usa en Recursos › Áreas de trabajo y en el botón «Áreas de trabajo» del cuadrante. */
(() => {
  'use strict';
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
  const TIPO_TXT = { taller: 'Taller', obra: 'Obra', oficina: 'Oficina', pintura: 'Pintura', transporte: 'Transporte', otro: 'Otro' };

  // raiz: contenedor; opts.alCambiar: se llama tras cada cambio (p. ej. recargar el cuadrante)
  function montar(raiz, opts = {}) {
    const $ = (s) => raiz.querySelector(s);
    const api = (...a) => window.s360.api(...a);
    const alCambiar = () => { try { opts.alCambiar?.(); } catch { /* nada */ } };
    function toast(msg, error = false) {
      const t = document.getElementById('toast');
      if (!t) return;
      (raiz.closest('dialog[open]') || document.body).append(t);
      t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
      clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = 'toast'; }, 2600);
    }
    const puedeAreas = () => window.s360.tiene('recursos');

    raiz.replaceChildren(
      el('p', { class: 'ayuda' }, 'Áreas fijas: cada una es una fila del calendario (una zona del taller, la cabina de pintura, la oficina técnica…). Los cambios se guardan al salir de cada campo. ',
        el('b', {}, 'Las obras no van aquí'), ': se crean en la ficha de su proyecto y salen solas del cuadrante cuando el proyecto se cierra.'),
      el('form', { id: 'form-area', class: 'form-area' },
        el('input', { name: 'nombre', placeholder: 'Nombre (p. ej. Cabina de pintura)', required: true, maxlength: 80 }),
        el('select', { name: 'departamento_id', 'aria-label': 'Departamento' }),
        el('select', { name: 'tipo', 'aria-label': 'Tipo' }),
        el('label', { class: 'chk', title: 'Un solo trabajo a la vez (puesto, máquina fija)' }, el('input', { type: 'checkbox', name: 'exclusiva' }), ' 1 a la vez'),
        el('input', { name: 'ubicacion', placeholder: 'Ubicación (opcional)', maxlength: 200 }),
        el('button', { type: 'submit' }, 'Añadir área')),
      el('div', { class: 'tabla-areas-caja' }, el('table', { class: 'tabla-areas' },
        el('thead', {}, el('tr', {}, ['Orden', 'Nombre', 'Departamento', 'Tipo', 'Ubicación'].map((t) => el('th', {}, t)),
          el('th', { title: 'Máquinas y elementos que están fijos en el área: van con lo que se planifique allí' }, 'Equipo fijo'),
          el('th', { title: 'Un solo trabajo a la vez: avisa si coinciden dos' }, '1 a la vez'), el('th', {}, 'Activa'), el('th', {}))),
        el('tbody', { id: 'areas-tbody' }))),
      el('details', { id: 'obras-sueltas', class: 'obras-sueltas', hidden: true },
        el('summary', {}),
        el('p', { class: 'ayuda' }, 'Obras que se han quedado sin proyecto (por ejemplo, porque se borró). No salen en el cuadrante. Si vuelves a importar o crear su proyecto se enlazan solas.'),
        el('ul', { id: 'obras-sueltas-lista' })));
    $('#form-area').hidden = !puedeAreas();
    $('#form-area').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await api('POST', '/api/areas', Object.fromEntries(fd));
        ev.target.reset();
        toast('Área creada');
        await pintarAreas(); alCambiar();
      } catch (e) { toast(e.message, true); }
    });

  let areaEquipoAbierta = null, focoEquipoTexto = false;   // área con el editor de equipo fijo abierto (sigue abierto al guardar)
  async function pintarAreas() {
    const { tipos, areas, departamentos = [], maquinas = [], obras_sin_proyecto: sueltas = [] } = await api('GET', '/api/areas');
    const editar = puedeAreas();
    const opciones = (sel) => tipos.map((t) => el('option', { value: t, selected: t === sel }, TIPO_TXT[t] || t));
    const opcDep = (sel) => [el('option', { value: '' }, '—'), ...departamentos.map((d) => el('option', { value: d.id, selected: d.id === sel }, d.nombre.replace(/^Departamento (de |)/, '')))];
    $('#form-area select[name=tipo]').replaceChildren(...opciones('taller'));
    $('#form-area select[name=departamento_id]').replaceChildren(...opcDep(null));

    const activas = areas.filter((a) => a.activo).map((a) => a.id);
    const guardar = (a, campo) => async (ev) => {
      let valor = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
      if (campo === 'departamento_id') valor = valor ? Number(valor) : null;
      if (valor === (a[campo] ?? '')) return;
      try {
        await api('PATCH', `/api/areas/${a.id}`, { [campo]: valor });
        a[campo] = valor;
        toast('Área guardada');
        if (campo === 'activo') await pintarAreas();
        alCambiar();
      } catch (e) { toast(e.message, true); ev.target.value = a[campo] ?? ''; }
    };

    // equipo fijo del área: máquinas (recursos) que están allí y otros elementos (carpa, compresor…)
    const nombreArea = (id) => areas.find((x) => x.id === id)?.nombre || '';
    const equipoTxt = (a) => [...a.maquinas.map((m) => m.nombre), ...(a.equipamiento || [])];
    function editorEquipo(a, fila, foco = true) {
      const sig = fila.nextElementSibling;
      if (sig?.classList.contains('area-equipo-ed')) { sig.remove(); areaEquipoAbierta = null; return; }
      areaEquipoAbierta = a.id;
      const fijas = new Set(a.maquinas.map((m) => m.id));
      const elems = [...(a.equipamiento || [])];
      const guardarMaq = async () => {
        try { await api('PUT', `/api/areas/${a.id}/maquinas`, { ids: [...fijas] }); toast('Equipo del área guardado'); await pintarAreas(); alCambiar(); }
        catch (e) { toast(e.message, true); }
      };
      const guardarElems = async () => {
        focoEquipoTexto = true;
        try { await api('PATCH', `/api/areas/${a.id}`, { equipamiento: elems }); toast('Equipo del área guardado'); await pintarAreas(); alCambiar(); }
        catch (e) { toast(e.message, true); }
      };
      const nuevo = el('input', { placeholder: 'Otro elemento fijo (p. ej. carpa, compresor)… ↵', maxlength: 120, 'aria-label': 'Añadir elemento fijo',
        onkeydown: (ev) => { if (ev.key === 'Enter' && ev.target.value.trim()) { ev.preventDefault(); elems.push(ev.target.value.trim()); guardarElems(); } } });
      const ed = el('tr', { class: 'area-equipo-ed' }, el('td', { colspan: 9 },
        el('div', { class: 'aeq' },
          el('div', {}, el('h4', {}, `Máquinas fijas en ${a.nombre}`),
            el('p', { class: 'ayuda' }, 'Lo que se planifique en esta área las lleva solas: cumplen lo que pida la tarea y salen en Mi día.'),
            el('div', { class: 'aeq-maq' }, maquinas.length ? maquinas.map((m) => el('label', { class: 'chk' },
              el('input', { type: 'checkbox', checked: fijas.has(m.id), onchange: (ev) => { if (ev.target.checked) fijas.add(m.id); else fijas.delete(m.id); guardarMaq(); } }),
              ` ${m.nombre}`, m.fijo_area && m.linea_id !== a.id ? el('span', { class: 'ayuda' }, ` (fija en ${nombreArea(m.linea_id)})`) : null))
              : el('p', { class: 'ayuda' }, 'No hay máquinas dadas de alta en Recursos.'))),
          el('div', {}, el('h4', {}, 'Otros elementos fijos'),
            el('div', { class: 'aeq-elems' }, elems.map((x, i) => el('span', { class: 'aeq-chip' }, x,
              el('button', { type: 'button', class: 'ghost mini', 'aria-label': `Quitar ${x}`, onclick: () => { elems.splice(i, 1); guardarElems(); } }, '✕')))),
            nuevo))));
      fila.after(ed);
      if (foco) nuevo.focus();
    }

    $('#areas-tbody').replaceChildren(...areas.map((a) => el('tr', { class: a.activo ? '' : 'inactiva', ...(editar && a.activo ? { 'data-id': a.id } : {}) },
      el('td', { class: 'ord' }, editar && a.activo ? asaOrden(a.nombre) : ''),
      el('td', {}, el('input', { value: a.nombre, 'aria-label': 'Nombre', maxlength: 80, disabled: !editar, onchange: guardar(a, 'nombre') })),
      el('td', {}, el('select', { 'aria-label': 'Departamento', disabled: !editar, onchange: guardar(a, 'departamento_id') }, opcDep(a.departamento_id))),
      el('td', {}, el('select', { 'aria-label': 'Tipo', disabled: !editar, onchange: guardar(a, 'tipo') }, opciones(a.tipo))),
      el('td', {}, el('input', { value: a.ubicacion || '', 'aria-label': 'Ubicación', maxlength: 200, disabled: !editar, placeholder: '—', onchange: guardar(a, 'ubicacion') })),
      el('td', { class: 'area-equipo' }, el('button', {
        type: 'button', class: 'ghost mini', disabled: !editar && !equipoTxt(a).length, title: equipoTxt(a).join('\n') || 'Sin equipo fijo',
        onclick: (ev) => editar && editorEquipo(a, ev.target.closest('tr')),
      }, equipoTxt(a).length ? `⚙ ${equipoTxt(a).length}` : (editar ? '＋' : '—')),
      equipoTxt(a).length ? el('span', { class: 'ayuda aeq-res' }, ` ${equipoTxt(a).join(', ')}`) : null),
      el('td', { class: 'centro' }, el('input', { type: 'checkbox', checked: a.exclusiva, 'aria-label': 'Un trabajo a la vez', title: 'Un solo trabajo a la vez (puesto de oficina, máquina fija): avisa si coinciden dos', disabled: !editar, onchange: guardar(a, 'exclusiva') })),
      el('td', { class: 'centro' }, el('input', { type: 'checkbox', checked: a.activo, 'aria-label': 'Activa', disabled: !editar, onchange: guardar(a, 'activo') })),
      el('td', {}, editar ? el('button', {
        type: 'button', class: 'ghost borrar',
        title: a.tareas_abiertas ? `Tiene ${a.tareas_abiertas} tarea(s) abiertas: se desactivará` : 'Borrar área',
        onclick: async () => {
          const r = await api('DELETE', `/api/areas/${a.id}`).catch((e) => toast(e.message, true));
          if (r) toast(r.desactivada ? 'El área tiene tareas: se ha desactivado' : 'Área borrada');
          await pintarAreas(); alCambiar();
        },
      }, a.tareas_abiertas ? 'Desactivar' : 'Borrar') : ''),
    )));
    if (areaEquipoAbierta) {
      const a = areas.find((x) => x.id === areaEquipoAbierta);
      const fila = a && [...$('#areas-tbody').children].find((tr) => tr.querySelector('input')?.value === a.nombre);
      if (fila) { areaEquipoAbierta = null; editorEquipo(a, fila, focoEquipoTexto); } else areaEquipoAbierta = null;
      focoEquipoTexto = false;
    }
    // Obras sin proyecto: apartadas y plegadas, para que no ensucien la lista
    $('#obras-sueltas').hidden = !sueltas.length;
    $('#obras-sueltas summary').textContent = `Obras sin proyecto (${sueltas.length})`;
    $('#obras-sueltas-lista').replaceChildren(...sueltas.map((a) => el('li', {},
      el('span', {}, a.nombre), a.ubicacion ? el('span', { class: 'ayuda' }, ` · ${a.ubicacion}`) : null,
      a.usos ? el('span', { class: 'ayuda' }, ` · usada en ${a.usos} tarea(s)/tramo(s)`) : null,
      editar && !a.usos ? el('button', {
        type: 'button', class: 'ghost borrar mini',
        onclick: async () => {
          const r = await api('DELETE', `/api/areas/${a.id}`).catch((e) => toast(e.message, true));
          if (r) toast('Obra borrada');
          await pintarAreas();
        },
      }, 'Borrar') : null)));
    if (editar) {
      ordenArrastrable($('#areas-tbody'), async (ids) => {
        try { await api('PUT', '/api/areas/orden', { ids }); toast('Orden guardado'); } catch (e) { toast(e.message, true); }
        await pintarAreas(); alCambiar();
      });
    }
  }


    return { recargar: pintarAreas, listo: pintarAreas() };
  }

  window.s360areas = { montar };
})();
