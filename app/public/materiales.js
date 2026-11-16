/* Materiales de una OT: despiece (BOM) por tarea, material agrupado a pedir con el plano de corte,
   existencias de almacén y comparación con lo estimado en el presupuesto */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { api } = window.s360;
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'selected' || k === 'checked' || k === 'hidden' || k === 'disabled') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3000);
  }
  const fecha = (f) => (f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const nf = (n, d = 2) => (n == null ? '' : Number(n).toLocaleString('es-ES', { maximumFractionDigits: d }));
  const metrosBarra = (mm) => `${nf(mm / 1000, 2)} m`;
  const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

  const params = new URLSearchParams(location.search);
  const otId = Number(params.get('ot')) || null;
  let datos = null, opciones = null, vista = params.get('vista') || 'pedir';
  const abiertos = new Set();   // grupos con el plano de corte desplegado

  const nombreGrupo = (g) => g.perfil || g.descripcion || '—';
  const etiquetaAcabado = (k) => (k ? (opciones?.acabados[k] || k).replace(/ \(.*\)$/, '') : '');
  const chips = (g) => [g.material, etiquetaAcabado(g.acabado)].filter(Boolean).map((t) => el('span', { class: 'mat-chip' }, t));
  const unidadTxt = (g, n) => (g.unidad === 'barra' ? `${nf(n, 0)} ${n === 1 ? 'barra' : 'barras'} de ${metrosBarra(g.barra_mm)}` : `${nf(n, 3)} ${g.unidad}`);
  const nombreTarea = (id) => {
    const t = datos.tareas.find((x) => x.id === id);
    return t ? (t.de_esta_ot ? t.nombre : `${t.nombre} (${t.ot_codigo})`) : `#${id}`;
  };
  // tareas del proyecto agrupadas por OT (la de esta OT, primero)
  const opcionesTareas = (sel) => {
    const porOt = new Map();
    for (const t of datos.tareas) { if (!porOt.has(t.ot_codigo)) porOt.set(t.ot_codigo, []); porOt.get(t.ot_codigo).push(t); }
    return [...porOt].map(([ot, ts]) => el('optgroup', { label: ot === datos.ot.codigo ? `${ot} (esta OT)` : ot },
      ts.map((t) => el('option', { value: t.id, selected: t.id === sel }, t.nombre))));
  };

  /* ---------- Lista de OTs ---------- */
  async function cargarLista() {
    $('#vista-lista').hidden = false;
    const [ots, todas] = await Promise.all([api('GET', '/api/materiales/ots'), api('GET', '/api/ordenes?estado=abierta')]);
    $('#sel-ot').append(...todas.map((o) => el('option', { value: o.id }, `${o.codigo} · ${o.titulo}`)));
    $('#sel-ot').onchange = () => { if ($('#sel-ot').value) location.href = `/materiales.html?ot=${$('#sel-ot').value}`; };
    $('#lista-ots').replaceChildren(...(ots.length ? ots.map((o) => el('li', {},
      el('a', { href: `/materiales.html?ot=${o.id}`, class: 'mat-ot' },
        el('span', { class: 'mat-ot-tit' }, el('b', {}, o.codigo), ` · ${o.titulo}`, el('span', { class: 'ayuda' }, ` ${o.proyecto_codigo || ''} ${o.proyecto_nombre || ''}`)),
        el('span', { class: 'mat-ot-dat' },
          el('span', { class: `mat-est ${o.hay_bom ? 'ok' : ''}` }, o.hay_bom ? 'BOM' : 'Estimado'),
          ` ${o.materiales} materiales · `,
          el('span', { class: o.revisados < o.materiales ? 'pend' : 'ok' }, `${o.revisados}/${o.materiales} revisados en almacén`),
          o.a_pedir ? ` · ${o.a_pedir} a pedir` : '',
          o.fecha_necesaria ? ` · hace falta el ${fecha(o.fecha_necesaria)}` : ' · sin planificar',
          o.tragina ? el('span', { class: o.tragina.vencido ? 'neg' : '' }, ` · Tragina: pedir antes del ${fecha(o.tragina.pedir_antes)} ${o.tragina.hora}:00`) : '')))) : [el('li', { class: 'ayuda' }, 'Todavía ninguna OT tiene materiales.')]));
  }

  /* ---------- Una OT ---------- */
  async function cargar() {
    datos = await api('GET', `/api/ordenes/${otId}/materiales`);
    pintar();
  }

  function pintar() {
    const { ot, resumen: r, puede } = datos;
    document.title = `s360 · Materiales ${ot.codigo}`;
    $('#ot-tit').textContent = `${ot.codigo} · ${ot.titulo}`;
    $('#ot-sub').textContent = [ot.proyecto_codigo && `${ot.proyecto_codigo} · ${ot.proyecto_nombre || ''}`,
      ot.bom_en ? `BOM cargado el ${new Date(ot.bom_en).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}${ot.bom_por ? ` por ${ot.bom_por}` : ''}`
        : 'Sin BOM todavía: se muestra lo estimado en el presupuesto'].filter(Boolean).join(' · ');
    $('#btn-importar').hidden = !puede.editar;
    $('#btn-ajustes').hidden = !puede.editar;
    const tragina = datos.grupos.filter((g) => !g.solo_estimado && g.tragina).map((g) => g.tragina).sort((a, b) => a.pedir_antes.localeCompare(b.pedir_antes))[0];
    const tarjeta = (tit, val, sub, cls) => el('div', { class: `kpi ${cls || ''}` }, el('span', { class: 'kpi-tit' }, tit), el('span', { class: 'kpi-val' }, val), sub ? el('span', { class: 'kpi-sub' }, sub) : null);
    $('#tarjetas').replaceChildren(
      tarjeta('Materiales', String(r.materiales), datos.hay_bom ? 'según el BOM' : 'según la estimación'),
      tarjeta('Barras', nf(r.barras, 0), 'de largos, ya optimizadas'),
      tarjeta('Almacén', `${r.revisados}/${r.materiales}`, r.revisados < r.materiales ? 'pendientes de revisar' : 'todo revisado', r.revisados < r.materiales ? 'aviso' : 'bien'),
      tarjeta('A pedir', String(r.a_pedir), r.revisados < r.materiales ? 'de lo ya revisado' : 'materiales'),
      tarjeta('Hace falta', r.fecha_necesaria ? fecha(r.fecha_necesaria) : '—', r.fecha_necesaria ? 'primera tarea que lo usa' : 'tareas sin planificar'),
      tragina ? tarjeta('Vía Tragina', `${fecha(tragina.pedir_antes)} ${tragina.hora}:00`, tragina.vencido ? 'ya no llega: Luchana o local' : `llega el ${fecha(tragina.llegada)}`, tragina.vencido ? 'mal' : '') : '');
    for (const b of document.querySelectorAll('[role=tab]')) b.setAttribute('aria-selected', String(b.dataset.vista === vista));
    if (vista === 'bom') pintarBom();
    else if (vista === 'comparar') pintarComparar();
    else pintarPedir();
  }

  /* ---------- Material a pedir ---------- */
  function pintarPedir() {
    const { puede } = datos;
    const grupos = datos.grupos.filter((g) => !g.solo_estimado);
    if (!grupos.length) {
      $('#panel').replaceChildren(el('div', { class: 'vacio-grande' },
        puede.editar ? 'Sin materiales. Carga el BOM con «Importar BOM» (JSON o tabla pegada).' : 'Sin materiales todavía.'));
      return;
    }
    const filas = [];
    let familia = null;
    for (const g of grupos) {
      if (g.familia !== familia) {
        familia = g.familia;
        filas.push(el('tr', { class: 'mat-fam' }, el('th', { colspan: 7 }, opciones.familias[familia] || familia)));
      }
      const abierto = abiertos.has(g.clave);
      const stock = puede.almacen
        ? el('input', { type: 'number', min: 0, step: g.unidad === 'barra' ? 1 : 'any', class: 'mat-num', value: g.en_stock ?? '', placeholder: '¿?',
          'aria-label': `En almacén: ${nombreGrupo(g)}`, onchange: (ev) => guardarGrupo(g, { en_stock: ev.target.value === '' ? null : Number(ev.target.value) }) })
        : el('span', { class: g.en_stock == null ? 'pend' : '' }, g.en_stock == null ? 'sin revisar' : nf(g.en_stock, 3));
      const c = g.corte;
      filas.push(el('tr', { class: `mat-grupo${abierto ? ' abierto' : ''}` },
        el('td', {},
          c ? el('button', { type: 'button', class: 'ghost mat-plegar', 'aria-expanded': String(abierto), title: 'Plano de corte',
            onclick: () => { abierto ? abiertos.delete(g.clave) : abiertos.add(g.clave); pintarPedir(); } }, abierto ? '▾' : '▸') : null,
          el('b', {}, nombreGrupo(g)), ' ', chips(g),
          g.descripcion && g.perfil ? el('div', { class: 'ayuda' }, g.descripcion) : null),
        el('td', {}, unidadTxt(g, g.necesario),
          c ? el('div', { class: 'ayuda' }, `${nf(c.piezas, 0)} piezas · ${nf(c.metros_piezas)} m · aprov. ${nf(c.aprovechamiento, 1)} %`) : null,
          c?.excedidas.length ? el('div', { class: 'neg' }, `⚠ ${c.excedidas.map((e) => `${e.marca || 'pieza'} de ${nf(e.longitud_mm, 0)} mm`).join(', ')}: más larga que la barra`) : null),
        el('td', {}, stock, g.revisado_por ? el('div', { class: 'ayuda' }, g.revisado_por) : null),
        el('td', { class: g.a_pedir > 0 ? 'mat-pedir' : '' }, g.a_pedir == null ? '—' : g.a_pedir === 0 ? '✔ hay' : unidadTxt(g, g.a_pedir)),
        el('td', {}, g.fecha_necesaria ? fecha(g.fecha_necesaria) : el('span', { class: 'ayuda' }, 'sin planificar'),
          el('div', { class: 'ayuda' }, g.tareas.map(nombreTarea).join(', '))),
        el('td', {}, g.tragina ? el('span', { class: g.tragina.vencido ? 'neg' : '' }, `${fecha(g.tragina.pedir_antes)} ${g.tragina.hora}:00`,
          el('div', { class: 'ayuda' }, g.tragina.vencido ? 'no llega: Luchana / local' : `llega ${fecha(g.tragina.llegada)}`)) : ''),
        el('td', {}, g.unidad === 'barra' && puede.editar
          ? el('select', { class: 'mat-barra', 'aria-label': 'Barra comercial', onchange: (ev) => guardarGrupo(g, { barra_mm: ev.target.value === 'def' ? null : Number(ev.target.value) }) },
            [...new Set([g.barra_def_mm, 6000, 12000, 1000, 3000, g.barra_mm])].map((mm) => el('option', { value: mm === g.barra_def_mm ? 'def' : mm, selected: mm === g.barra_mm },
              `${metrosBarra(mm)}${mm === g.barra_def_mm ? (g.barra_auto ? ' (por la pieza más larga)' : ' (normal)') : ''}`)))
          : g.unidad === 'barra' ? metrosBarra(g.barra_mm) : '')));
      if (abierto && c) filas.push(el('tr', { class: 'mat-corte-fila' }, el('td', { colspan: 7 }, planoCorte(g))));
    }
    $('#panel').replaceChildren(
      el('p', { class: 'ayuda' }, datos.hay_bom
        ? `Agrupado por perfil, material y acabado. Las barras ya están optimizadas (sierra ${datos.ajustes.kerf_mm} mm). Almacén apunta lo que hay; lo que falta es lo que se pide.`
        : 'Aún no hay BOM: son las cantidades estimadas en el presupuesto (metros pasados a barras, sin optimizar).'),
      el('div', { class: 'mat-scroll' }, el('table', { class: 'mat-tabla' },
        el('thead', {}, el('tr', {}, ['Material', 'Hace falta', 'En almacén', 'A pedir', 'Se usa', 'Pedir (Tragina)', 'Barra'].map((t) => el('th', {}, t)))),
        el('tbody', {}, filas))));
  }

  function planoCorte(g) {
    const c = g.corte;
    const color = (marca) => {
      let h = 0;
      for (const ch of String(marca || '')) h = (h * 31 + ch.charCodeAt(0)) % 360;
      return `hsl(${h} 45% 38%)`;
    };
    return el('div', { class: 'mat-corte' },
      c.patrones.map((p) => el('div', { class: 'mat-barra-fila' },
        el('span', { class: 'mat-veces' }, `×${p.veces}`),
        el('div', { class: 'mat-barra-vis', role: 'img', 'aria-label': `Barra: ${p.cortes.map((x) => `${x.n} × ${x.longitud_mm} mm`).join(', ')}; sobra ${p.sobrante_mm} mm` },
          p.cortes.flatMap((x) => Array.from({ length: x.n }, () => el('span', {
            class: 'mat-pieza', style: `flex-basis:${(x.longitud_mm / c.barra_mm) * 100}%;background:${color(x.marca)}`, title: `${x.marca || ''} ${x.longitud_mm} mm` },
          x.longitud_mm / c.barra_mm > 0.06 ? `${x.marca ? `${x.marca} ` : ''}${nf(x.longitud_mm, 1)}` : ''))),
          p.sobrante_mm > 0 ? el('span', { class: `mat-sobra${p.sobrante_mm >= datos.ajustes.retal_min_mm ? ' retal' : ''}`, style: `flex-basis:${(p.sobrante_mm / c.barra_mm) * 100}%`, title: `Sobra ${p.sobrante_mm} mm` },
            p.sobrante_mm / c.barra_mm > 0.06 ? nf(p.sobrante_mm, 0) : '') : null),
        el('span', { class: 'mat-cortes-txt' }, p.cortes.map((x) => `${x.marca ? `${x.marca}: ` : ''}${x.n} × ${nf(x.longitud_mm, 1)}`).join(' + ')))),
      el('p', { class: 'ayuda' }, `Medidas en mm. Barra de ${nf(c.barra_mm, 0)} mm, sierra ${c.kerf_mm} mm.`,
        c.retales_mm.length ? ` Retales aprovechables (≥ ${datos.ajustes.retal_min_mm} mm): ${c.retales_mm.map((r) => nf(r, 0)).join(', ')}.` : ''));
  }

  async function guardarGrupo(g, cambios) {
    try {
      await api('PUT', `/api/ordenes/${otId}/materiales/grupo`, { clave: g.clave, ...cambios });
      await cargar();
    } catch (e) { toast(e.message, true); }
  }

  /* ---------- Despiece (BOM) ---------- */
  const COLS = [
    ['marca', 'Marca', 'text', 6], ['perfil', 'Perfil / descripción', 'text', 20], ['material', 'Material', 'text', 9],
    ['acabado', 'Acabado', 'acabado', 9], ['longitud_mm', 'L (mm)', 'number', 7], ['angulo_a', '∠A', 'number', 4],
    ['angulo_b', '∠B', 'number', 4], ['cantidad', 'Cant.', 'number', 5], ['unidad', 'Ud', 'unidad', 4], ['tarea_id', 'Tarea', 'tarea', 10],
  ];
  function pintarBom() {
    const { puede } = datos;
    const lineas = datos.lineas.filter((l) => l.origen === (datos.hay_bom ? 'bom' : 'estimado'));
    const editable = puede.editar && (datos.hay_bom || !lineas.length);
    const celda = (l, [k, , tipo, ancho]) => {
      let v = k === 'perfil' ? (l.perfil || l.descripcion || '') : l[k];
      if (!editable) {
        if (k === 'acabado') v = etiquetaAcabado(v);
        if (k === 'tarea_id') v = nombreTarea(v);
        return el('td', { class: tipo === 'number' ? 'num' : '' }, v == null ? '' : tipo === 'number' ? nf(v, 3) : String(v));
      }
      const guardar = async (val) => {
        const cambio = k === 'perfil' && !l.perfil && l.descripcion ? { descripcion: val } : { [k]: val };
        try { const r = await api('PATCH', `/api/materiales/${l.id}`, cambio); if (r.avisos?.length) toast(r.avisos.join(' · ')); await cargar(); }
        catch (e) { toast(e.message, true); await cargar(); }
      };
      let input;
      if (tipo === 'tarea') input = el('select', { onchange: (ev) => guardar(Number(ev.target.value)) }, opcionesTareas(v));
      else if (tipo === 'unidad') input = el('select', { onchange: (ev) => guardar(ev.target.value) }, opciones.unidades.map((u) => el('option', { value: u, selected: u === v }, u)));
      else if (tipo === 'acabado') input = el('select', { onchange: (ev) => guardar(ev.target.value) }, el('option', { value: '' }, '—'),
        Object.entries(opciones.acabados).map(([kk, t]) => el('option', { value: kk, selected: kk === v }, t.replace(/ \(.*\)$/, ''))),
        v && !opciones.acabados[v] ? el('option', { value: v, selected: true }, v) : null);
      else input = el('input', { type: tipo, value: v ?? '', size: ancho, step: tipo === 'number' ? 'any' : null, onchange: (ev) => guardar(tipo === 'number' ? (ev.target.value === '' ? null : Number(ev.target.value)) : ev.target.value) });
      input.setAttribute('aria-label', `${k} línea ${l.marca || l.id}`);
      return el('td', { class: tipo === 'number' ? 'num' : '' }, input);
    };
    const porTarea = new Map();
    for (const l of lineas) { if (!porTarea.has(l.tarea_id)) porTarea.set(l.tarea_id, []); porTarea.get(l.tarea_id).push(l); }
    const cuerpo = [];
    for (const t of datos.tareas) {
      const ls = porTarea.get(t.id);
      if (!ls) continue;
      cuerpo.push(el('tr', { class: 'mat-fam' }, el('th', { colspan: COLS.length + 1 }, nombreTarea(t.id), el('span', { class: 'ayuda' }, ` · ${ls.length} líneas${t.primera_fecha ? ` · desde el ${fecha(t.primera_fecha)}` : ''}`))));
      for (const l of ls) {
        cuerpo.push(el('tr', {}, COLS.map((c) => celda(l, c)),
          el('td', {}, editable ? el('button', { type: 'button', class: 'ghost borrar', 'aria-label': 'Quitar línea', title: 'Quitar línea',
            onclick: async () => { try { await api('DELETE', `/api/materiales/${l.id}`); await cargar(); } catch (e) { toast(e.message, true); } } }, '✕') : null)));
      }
    }
    const nueva = editable ? formNueva() : null;
    $('#panel').replaceChildren(
      el('p', { class: 'ayuda' }, datos.hay_bom
        ? 'El despiece tal como lo cargó el técnico, por la tarea que consume cada pieza. Puedes corregir cualquier celda: se vuelve a normalizar y a optimizar.'
        : lineas.length ? 'Estimado del presupuesto (solo lectura). Cuando se cargue el BOM, se pedirá por el BOM.' : 'Sin líneas.'),
      nueva,
      lineas.length ? el('div', { class: 'mat-scroll' }, el('table', { class: 'mat-tabla mat-bom' },
        el('thead', {}, el('tr', {}, COLS.map(([, t]) => el('th', {}, t)), el('th', {}))), el('tbody', {}, cuerpo))) : null);
  }

  function formNueva() {
    const f = el('form', { class: 'mat-nueva', onsubmit: async (ev) => {
      ev.preventDefault();
      const d = Object.fromEntries(new FormData(f));
      for (const k of ['longitud_mm', 'angulo_a', 'angulo_b', 'cantidad']) d[k] = d[k] === '' ? null : Number(d[k]);
      try {
        const r = await api('POST', `/api/ordenes/${otId}/materiales`, d);
        if (r.avisos?.length) toast(r.avisos.join(' · ')); else toast('Añadida');
        await cargar();
      } catch (e) { toast(e.message, true); }
    } },
    el('input', { name: 'marca', placeholder: 'Marca', size: 5 }),
    el('input', { name: 'perfil', placeholder: 'Perfil (TUBO 50x10x1.5) o descripción', size: 26, required: true }),
    el('input', { name: 'material', placeholder: 'Material', size: 7 }),
    el('input', { name: 'longitud_mm', type: 'number', step: 'any', placeholder: 'L mm', size: 6 }),
    el('input', { name: 'cantidad', type: 'number', step: 'any', placeholder: 'Cant.', size: 4, required: true }),
    el('select', { name: 'tarea_id', 'aria-label': 'Tarea que lo consume' }, opcionesTareas(null)),
    el('button', { type: 'submit', class: 'primario' }, '＋ Añadir'));
    return f;
  }

  /* ---------- Estimado vs real ---------- */
  function pintarComparar() {
    const gs = datos.grupos;
    const conAmbos = gs.filter((g) => g.n_bom || g.n_estimado);
    if (!datos.hay_bom || !gs.some((g) => g.n_estimado)) {
      $('#panel').replaceChildren(el('div', { class: 'vacio-grande' },
        !datos.hay_bom ? 'Falta el BOM para comparar con lo estimado.' : 'El presupuesto no traía materiales estimados para esta OT.'));
      return;
    }
    const pct = (est, real) => (est > 0 && real != null ? Math.round(((real - est) / est) * 100) : null);
    const filas = conAmbos.map((g) => {
      const largos = g.unidad === 'barra';
      const est = largos ? g.metros_estimado : g.cantidad_estimado;
      const real = largos ? g.metros_real : g.cantidad_real;
      const d = pct(est, real);
      return el('tr', {},
        el('td', {}, el('b', {}, nombreGrupo(g)), ' ', chips(g)),
        el('td', { class: 'num' }, est == null ? el('span', { class: 'ayuda' }, 'no estimado') : `${nf(est)} ${largos ? 'm' : g.unidad}`,
          largos && g.barras_estimado != null ? el('div', { class: 'ayuda' }, `≈ ${g.barras_estimado} ${g.barras_estimado === 1 ? 'barra' : 'barras'}`) : null),
        el('td', { class: 'num' }, real == null ? el('span', { class: 'ayuda' }, 'no está en el BOM') : `${nf(real)} ${largos ? 'm' : g.unidad}`,
          largos && g.n_bom ? el('div', { class: 'ayuda' }, `${g.necesario} ${g.necesario === 1 ? 'barra' : 'barras'}`) : null),
        el('td', { class: `num ${d > 10 ? 'neg' : d < -10 ? 'pos' : ''}` }, d == null ? '' : `${d > 0 ? '+' : ''}${d} %`));
    });
    $('#panel').replaceChildren(
      el('p', { class: 'ayuda' }, 'Lo que estimó el presupuesto frente a lo que sale del despiece. Los largos se comparan en metros de pieza (sin el desperdicio de corte). En rojo, más de un 10 % por encima.'),
      el('div', { class: 'mat-scroll' }, el('table', { class: 'mat-tabla' },
        el('thead', {}, el('tr', {}, ['Material', 'Estimado', 'Real (BOM)', 'Desvío'].map((t) => el('th', {}, t)))), el('tbody', {}, filas))));
  }

  /* ---------- Importar ---------- */
  function dialogoImportar() {
    const ta = el('textarea', { rows: 10, class: 'mat-texto', placeholder: 'Pega aquí el JSON (s360-bom/1) o una tabla copiada de Excel / Notion con cabecera (marca, perfil, material, longitud, cantidad…)' });
    const archivo = el('input', { type: 'file', accept: '.json,.csv,.txt,.tsv,application/json,text/csv,text/plain' });
    const tareaSel = el('select', {}, el('option', { value: '' }, 'La que diga cada línea…'), opcionesTareas(null));
    const propias = datos.tareas.filter((t) => t.de_esta_ot);
    const corteDef = propias.find((t) => /cort/i.test(t.nombre)) || propias[0];
    if (corteDef) tareaSel.value = corteDef.id;
    const prev = el('div', { class: 'mat-prev' });
    const msg = el('p', { class: 'error', role: 'alert' });
    const btnImp = el('button', { type: 'button', class: 'primario', disabled: true }, 'Importar');
    const ignorar = el('input', { type: 'checkbox' });
    const ignorarLbl = el('label', { class: 'mat-ignorar', hidden: true }, ignorar, ' Importar sin las líneas con error');
    let ultima = null;
    archivo.onchange = async () => { const f = archivo.files[0]; if (f) { ta.value = await f.text(); vistaPrevia(); } };
    const d = el('dialog', { class: 'dlg-mat', 'aria-labelledby': 'imp-tit' },
      el('div', { class: 'dlg-cab' }, el('h2', { id: 'imp-tit' }, `Importar BOM · ${datos.ot.codigo}`),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
      el('p', { class: 'ayuda' }, 'Sustituye el BOM actual de esta OT. Formato: JSON s360-bom/1 (lo prepara la IA a partir del BOM de Onshape) o una tabla con cabecera. ',
        el('a', { href: '/instrucciones-bom.txt', target: '_blank', rel: 'noopener' }, 'Instrucciones para la IA'), ' · ',
        el('button', { type: 'button', class: 'ghost enlace', onclick: copiarInstrucciones }, 'copiarlas')),
      ta,
      el('div', { class: 'mat-imp-fila' }, el('label', {}, 'o un archivo ', archivo),
        el('label', {}, 'Tarea por defecto ', tareaSel),
        el('button', { type: 'button', onclick: vistaPrevia }, 'Vista previa')),
      prev, msg,
      el('div', { class: 'acciones' }, ignorarLbl, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'), btnImp));
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
    ta.focus();
    let pendiente = null;
    try { pendiente = sessionStorage.getItem('s360-bom-pendiente'); sessionStorage.removeItem('s360-bom-pendiente'); } catch { /* nada */ }
    if (pendiente) { ta.value = pendiente; setTimeout(vistaPrevia, 0); }

    async function vistaPrevia() {
      msg.textContent = ''; prev.replaceChildren(); btnImp.disabled = true;
      // ¿el archivo es de otra OT? se ofrece abrir esa OT con el archivo ya pegado
      let otArchivo = null;
      try { otArchivo = JSON.parse(ta.value).ot || null; } catch { /* tabla u otro: lo valida el servidor */ }
      if (otArchivo && norm(otArchivo) !== norm(datos.ot.codigo)) {
        const todas = await api('GET', '/api/ordenes');
        const otra = todas.find((o) => norm(o.codigo) === norm(otArchivo));
        msg.replaceChildren(`El archivo es de la ${otArchivo} y estás en la ${datos.ot.codigo}. `,
          otra ? el('button', { type: 'button', class: 'primario', onclick: () => {
            try { sessionStorage.setItem('s360-bom-pendiente', ta.value); } catch { /* sin almacenamiento: habrá que volver a pegarlo */ }
            location.href = `/materiales.html?ot=${otra.id}&importar=1`;
          } }, `Abrir ${otra.codigo} e importar allí`) : 'Esa OT no existe en el planificador: revisa el campo «ot» del archivo.');
        return;
      }
      try {
        const r = await api('POST', `/api/ordenes/${otId}/materiales/importar`, { texto: ta.value, tarea_id: tareaSel.value || null, simular: true });
        ultima = r;
        ignorarLbl.hidden = !r.errores || !r.validas;
        btnImp.disabled = !r.validas;
        btnImp.textContent = `Importar ${r.validas} líneas`;
        prev.replaceChildren(
          el('p', {}, el('b', {}, `${r.validas} líneas válidas`), r.errores ? el('span', { class: 'neg' }, ` · ${r.errores} con error`) : '',
            r.reemplaza ? el('span', { class: 'ayuda' }, ` · sustituyen a las ${r.reemplaza} actuales`) : ''),
          r.aviso_tarea ? el('p', { class: 'neg' }, r.aviso_tarea) : '',
          el('div', { class: 'mat-scroll' }, el('table', { class: 'mat-tabla mat-prev-t' },
            el('thead', {}, el('tr', {}, ['#', 'Marca', 'Perfil / descripción', 'Material', 'Acabado', 'L', 'Cant.', 'Tarea', ''].map((t) => el('th', {}, t)))),
            el('tbody', {}, r.filas.map((f) => el('tr', { class: f.error ? 'mal' : f.avisos?.length ? 'aviso' : '' },
              el('td', {}, f.fila), el('td', {}, f.linea?.marca || ''), el('td', {}, f.linea?.perfil || f.linea?.descripcion || ''),
              el('td', {}, f.linea?.material || ''), el('td', {}, etiquetaAcabado(f.linea?.acabado)),
              el('td', { class: 'num' }, nf(f.linea?.longitud_mm, 1)), el('td', { class: 'num' }, `${nf(f.linea?.cantidad, 3)} ${f.linea?.unidad || ''}`),
              el('td', {}, f.tarea_id ? nombreTarea(f.tarea_id) : ''),
              el('td', { class: f.error ? 'neg' : 'ayuda' }, f.error || (f.avisos || []).join(' · '))))))));
      } catch (e) { msg.textContent = e.message; }
    }
    btnImp.onclick = async () => {
      msg.textContent = '';
      try {
        const r = await api('POST', `/api/ordenes/${otId}/materiales/importar`, { texto: ta.value, tarea_id: tareaSel.value || null, ignorar_errores: ignorar.checked });
        d.close();
        toast(`${r.importadas} líneas importadas${r.omitidas ? ` (${r.omitidas} omitidas)` : ''}. Almacén recibe el aviso.`);
        vista = 'pedir';
        await cargar();
      } catch (e) { msg.textContent = e.message; }
    };
    void ultima;
  }

  async function copiarInstrucciones() {
    try {
      const t = await (await fetch('/instrucciones-bom.txt')).text();
      await navigator.clipboard.writeText(t);
      toast('Instrucciones copiadas: pégalas en la IA junto con el BOM de Onshape');
    } catch { toast('No se pudo copiar: ábrelas y cópialas a mano', true); }
  }

  /* ---------- Ajustes ---------- */
  function dialogoAjustes() {
    const a = opciones.ajustes;
    const num = (name, v, min, max, suf) => el('label', {}, el('span', {}, name[1]), el('span', { class: 'mat-aj-in' },
      el('input', { type: 'number', name: name[0], value: v, min, max, step: 1, required: true }), suf ? ` ${suf}` : ''));
    const dia = (name, v) => el('select', { name }, DIAS.map((t, i) => el('option', { value: i, selected: i === v }, t)));
    const msg = el('p', { class: 'error', role: 'alert' });
    const f = el('form', { class: 'mat-ajustes', onsubmit: async (ev) => {
      ev.preventDefault();
      const x = Object.fromEntries(new FormData(f));
      try {
        opciones.ajustes = await api('PUT', '/api/materiales/ajustes', {
          barra_mm: x.barra_mm, kerf_mm: x.kerf_mm, retal_min_mm: x.retal_min_mm, margen_dias: x.margen_dias,
          tragina: { corte_dia: x.corte_dia, corte_hora: x.corte_hora, llegada_dia: x.llegada_dia } });
        d.close(); toast('Ajustes guardados');
        if (otId) await cargar();
      } catch (e) { msg.textContent = e.message; }
    } },
    el('fieldset', {}, el('legend', {}, 'Corte'),
      num(['barra_mm', 'Barra comercial'], a.barra_mm, 500, 20000, 'mm'),
      num(['kerf_mm', 'Ancho de la sierra'], a.kerf_mm, 0, 20, 'mm'),
      num(['retal_min_mm', 'Retal aprovechable desde'], a.retal_min_mm, 0, 6000, 'mm')),
    el('fieldset', {}, el('legend', {}, 'Menorca Tragina'),
      el('label', {}, el('span', {}, 'Pedir antes del'), el('span', { class: 'mat-aj-in' }, dia('corte_dia', a.tragina.corte_dia), ' a las ',
        el('input', { type: 'number', name: 'corte_hora', value: a.tragina.corte_hora, min: 0, max: 23, required: true }), ':00')),
      el('label', {}, el('span', {}, 'Llega el'), el('span', { class: 'mat-aj-in' }, dia('llegada_dia', a.tragina.llegada_dia))),
      num(['margen_dias', 'Días de margen tras llegar'], a.margen_dias, 0, 14, 'días'),
      el('p', { class: 'ayuda' }, 'Entrega en Ydica Transportes (Gavà) a nombre de Dixis.')),
    msg,
    el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'), el('button', { type: 'submit', class: 'primario' }, 'Guardar')));
    const d = el('dialog', { class: 'dlg-cuenta', 'aria-labelledby': 'aj-tit' },
      el('div', { class: 'dlg-cab' }, el('h2', { id: 'aj-tit' }, 'Ajustes de materiales'), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')), f);
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
  }

  function imprimir() {
    vista = 'pedir';
    for (const g of datos.grupos) if (g.corte) abiertos.add(g.clave);
    pintar();
    setTimeout(() => window.print(), 50);
  }

  async function init() {
    const yo = await api('GET', '/api/me');
    window.s360.iniciar(yo);
    opciones = await api('GET', '/api/materiales/opciones');
    const puedeAjustes = window.s360.tiene('materiales') || window.s360.tiene('compras');
    $('#btn-ajustes-l').hidden = !puedeAjustes;
    $('#btn-ajustes-l').onclick = dialogoAjustes;
    if (!otId) return cargarLista();
    $('#vista-ot').hidden = false;
    for (const b of document.querySelectorAll('[role=tab]')) {
      b.onclick = () => { vista = b.dataset.vista; history.replaceState(null, '', `?ot=${otId}&vista=${vista}`); pintar(); };
    }
    $('#btn-importar').onclick = dialogoImportar;
    $('#btn-ajustes').onclick = dialogoAjustes;
    $('#btn-imprimir').onclick = imprimir;
    await cargar();
    if (params.get('importar') && datos.puede.editar) { history.replaceState(null, '', `?ot=${otId}`); dialogoImportar(); }
    window.s360.alCambiar(cargar);
  }
  init().catch((e) => toast(e.message, true));
})();
