/* Bandeja: quien planifica clasifica lo capturado → tarea en una OT, asunto con responsable, información o descartar */
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
  const fecha = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const cuando = (t) => new Date(t).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const AYUDA = {
    bandeja: 'Lo capturado por todos, por orden de llegada. Decide qué es cada cosa: una tarea nueva en una OT (pasa a «Por planificar»), un asunto con responsable y fecha, información para el proyecto, o descártalo.',
    asuntos: 'Asuntos con responsable, pendientes de resolver. Los más urgentes primero.',
    todas: 'Todo lo capturado en los últimos 120 días y en qué quedó (sin lo descartado).',
    descartadas: 'Lo descartado: no sale en ningún otro sitio (ni a quien lo capturó). Solo lo ve quien administra; «Volver a la bandeja» lo recupera.',
  };

  const est = { vista: 'bandeja', datos: null, op: null, cl: null, abierta: null };

  async function cargar() {
    const p = $('#filtro-proyecto').value;
    est.datos = await api('GET', `/api/capturas?vista=${est.vista}${p ? `&proyecto_id=${p}` : ''}`);
    pintar();
  }

  function pintar() {
    const d = est.datos;
    document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.vista === est.vista ? 'true' : 'false'));
    $('#tab-bandeja').textContent = `Por clasificar (${d.cuenta.bandeja})`;
    $('#tab-asuntos').textContent = `Asuntos abiertos (${d.cuenta.asuntos})`;
    $('#ayuda-vista').textContent = AYUDA[est.vista];
    $('#lista').replaceChildren(...(d.capturas.length ? d.capturas.map(tarjeta)
      : [el('li', { class: 'vacio' }, est.vista === 'bandeja' ? '✔ Bandeja vacía: todo clasificado.' : 'Nada por aquí.')]));
  }

  function tarjeta(c) {
    const d = est.datos;
    const li = el('li', { class: `cap-card e-${c.estado} prio-${c.prioridad}` },
      el('div', { class: 'cap-card-cab' },
        el('b', {}, c.autor || '—'),
        el('span', { class: 'ayuda' }, cuando(c.creado)),
        c.categoria ? el('span', { class: `cap-cat c-${c.categoria}` }, d.categorias[c.categoria]) : null,
        el('span', { class: `cap-estado e-${c.estado}` }, d.estados[c.estado])),
      c.texto ? el('p', { class: 'cap-texto' }, c.texto) : null,
      window.s360.adjuntos(c.archivos),
      el('div', { class: 'ayuda' }, [
        c.proyecto_codigo && `${c.proyecto_codigo} ${c.proyecto_nombre || ''}`.trim(),
        c.orden_codigo && `${c.orden_codigo} ${c.orden_titulo || ''}`.trim(),
        c.tarea && `trabajando en: ${c.tarea}`,
        c.maquina && `máquina: ${c.maquina}${c.maquina_parada ? ' (parada)' : ''}`,
      ].filter(Boolean).join(' · ')),
      c.estado === 'asunto' ? el('div', { class: 'cap-asunto' },
        `Lo lleva ${c.responsable || '—'}`, c.fecha_limite ? ` · para el ${fecha(c.fecha_limite)}` : '',
        c.prioridad !== 'normal' ? ` · prioridad ${c.prioridad}` : '') : null,
      c.estado === 'tarea' ? el('div', { class: 'cap-asunto' }, `Tarea creada: ${c.tarea_creada || '—'} (${c.orden_codigo || ''})`) : null,
      c.nota ? el('div', { class: 'ayuda' }, `Nota: ${c.nota}`) : null,
      c.resolucion ? el('div', { class: 'md-ok' }, `✔ ${c.resolucion}${c.resuelta_por_nombre ? ` (${c.resuelta_por_nombre})` : ''}`) : null,
      el('div', { class: 'cap-acc' },
        c.maquina_id && !c.maquina_parada && ['bandeja', 'asunto'].includes(c.estado) ? el('button', { type: 'button', class: 'ghost mini',
          title: 'La máquina queda no disponible hoy en el cuadrante (amplíalo en Recursos si dura más)',
          onclick: () => hacer(async () => { const r = await api('POST', `/api/capturas/${c.id}/maquina-parada`); return `${c.maquina} parada hoy${r.afectados ? ` · afecta a ${r.afectados} tramo(s)` : ''}`; }) }, 'Máquina parada hoy') : null,
        c.estado === 'bandeja' ? el('button', { type: 'button', class: 'primario mini', onclick: () => { est.abierta = est.abierta === c.id ? null : c.id; pintar(); } },
          est.abierta === c.id ? 'Cerrar' : 'Clasificar') : null,
        c.estado === 'asunto' ? el('button', { type: 'button', class: 'primario mini', onclick: () => {
          const r = prompt('¿Cómo se ha resuelto? (lo verá quien lo capturó)');
          if (r !== null) hacer(() => api('POST', `/api/capturas/${c.id}/resolver`, { resolucion: r }), 'Asunto resuelto');
        } }, 'Resuelto') : null,
        ['asunto', 'info', 'descartada', 'resuelta'].includes(c.estado) ? el('button', { type: 'button', class: 'ghost mini',
          onclick: () => hacer(() => api('POST', `/api/capturas/${c.id}/reabrir`), 'De vuelta en la bandeja') }, 'Volver a la bandeja') : null));
    if (est.abierta === c.id) li.append(formClasificar(c));
    return li;
  }

  function formClasificar(c) {
    const { op, cl } = est;
    let destino = c.categoria === 'mejora' ? 'asunto' : 'tarea';
    const sel = (opts, valor, etiqueta) => el('select', { 'aria-label': etiqueta }, opts.map(([v, t]) => el('option', { value: v, selected: String(v) === String(valor ?? '') }, t)));
    const selProy = sel([['', 'Proyecto…'], ...op.proyectos.map((p) => [p.id, `${p.codigo} · ${p.nombre || ''}`])], c.proyecto_id, 'Proyecto');
    const selOT = el('select', { 'aria-label': 'OT' });
    const pintarOTs = () => {
      const pid = Number(selProy.value);
      const ots = op.ordenes.filter((o) => !pid || o.proyecto_id === pid);
      selOT.replaceChildren(el('option', { value: '' }, 'OT…'), ...ots.map((o) => el('option', { value: o.id, selected: o.id === c.orden_id }, `${o.codigo} · ${o.titulo || ''}`)));
    };
    selProy.onchange = pintarOTs; pintarOTs();
    const selCat = sel([['', 'Tipo…'], ...Object.entries(est.datos.categorias)], c.categoria, 'Tipo');
    const nota = el('input', { maxlength: 1000, placeholder: 'Nota (la ve quien lo capturó)', 'aria-label': 'Nota' });
    // tarea
    const tNombre = el('input', { maxlength: 120, value: (c.texto || '').split('\n')[0].slice(0, 120), placeholder: 'Nombre de la tarea', 'aria-label': 'Nombre de la tarea' });
    const tHoras = el('input', { type: 'number', min: 0.5, step: 0.5, value: 1, 'aria-label': 'Horas' });
    const tOps = el('input', { type: 'number', min: 0, step: 1, value: 1, 'aria-label': 'Operarios' });
    const tOficio = sel([['', 'Sabe hacer (opcional)'], ...cl.oficios.map((o) => [o.id, o.nombre])], '', 'Qué tiene que saber hacer');
    const tArea = sel([['', 'Área (opcional)'], ...cl.areas.map((a) => [a.id, a.nombre])], '', 'Área');
    // asunto
    const aResp = sel([['', '¿Quién se encarga?'], ...cl.usuarios.map((u) => [u.id, u.nombre])], '', 'Responsable');
    const aFecha = el('input', { type: 'date', 'aria-label': 'Fecha límite' });
    const aPrio = sel([['normal', 'Prioridad normal'], ['alta', 'Prioridad alta'], ['baja', 'Prioridad baja']], 'normal', 'Prioridad');
    const zTarea = el('div', { class: 'cl-fila' }, el('label', { class: 'cl-ancho' }, 'Tarea', tNombre), el('label', {}, 'Horas', tHoras), el('label', {}, 'Operarios', tOps), tOficio, tArea);
    const zAsunto = el('div', { class: 'cl-fila' }, aResp, el('label', {}, 'Para el', aFecha), aPrio);
    const botones = el('div', { class: 'cl-destinos', role: 'radiogroup', 'aria-label': 'Qué es' });
    const DEST = [['tarea', '🛠 Tarea en una OT'], ['asunto', '👤 Asunto con responsable'], ['info', 'ℹ️ Información'], ['descartar', '🗑 Descartar']];
    const pintarDestino = () => {
      botones.replaceChildren(...DEST.map(([k, t]) => el('button', { type: 'button', class: `md-chip${destino === k ? ' activo' : ''}`, 'aria-pressed': destino === k ? 'true' : 'false',
        onclick: () => { destino = k; pintarDestino(); } }, t)));
      zTarea.hidden = destino !== 'tarea';
      zAsunto.hidden = destino !== 'asunto';
      guardar.textContent = { tarea: 'Crear la tarea', asunto: 'Asignar', info: 'Guardar como información', descartar: 'Descartar' }[destino];
    };
    const guardar = el('button', { type: 'button', class: 'primario' });
    guardar.onclick = () => hacer(async () => {
      const r = await api('POST', `/api/capturas/${c.id}/clasificar`, {
        destino, proyecto_id: Number(selProy.value) || null, orden_id: Number(selOT.value) || null, categoria: selCat.value || null, nota: nota.value,
        prioridad: destino === 'asunto' ? aPrio.value : 'normal', responsable_id: Number(aResp.value) || null, fecha_limite: aFecha.value || null,
        tarea: { nombre: tNombre.value, duracion_h: Number(tHoras.value), operarios_req: Number(tOps.value), capacidad_id: Number(tOficio.value) || null, linea_id: Number(tArea.value) || null },
      });
      est.abierta = null;
      return r.estado === 'tarea' ? 'Tarea creada: ya está en «Por planificar»' : r.estado === 'asunto' ? 'Asunto asignado' : r.estado === 'info' ? 'Guardado como información' : 'Descartado';
    });
    const f = el('div', { class: 'cl-form' }, botones, el('div', { class: 'cl-fila' }, selProy, selOT, selCat), zTarea, zAsunto, nota, el('div', { class: 'cap-acc' }, guardar));
    pintarDestino();
    return f;
  }

  async function hacer(fn, ok) {
    try {
      const msg = await fn();
      toast(ok || msg || 'Hecho');
      await cargar();
      window.s360.refrescarPendientes();
    } catch (e) { toast(e.message, true); }
  }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    if (!window.s360.tiene('planificar')) {
      $('.bandeja-main').replaceChildren(el('p', {}, 'La bandeja la clasifica quien planifica. Para apuntar algo, usa ', el('a', { href: '/capturar.html' }, '＋ Capturar'), '.'));
      return;
    }
    const q = new URLSearchParams(location.search);
    $('#tab-descartadas').hidden = !window.s360.tiene('usuarios');
    if (['bandeja', 'asuntos', 'todas'].includes(q.get('vista')) || (q.get('vista') === 'descartadas' && window.s360.tiene('usuarios'))) est.vista = q.get('vista');
    [est.op, est.cl] = await Promise.all([api('GET', '/api/capturas/opciones'), api('GET', '/api/capturas/opciones-clasificar')]);
    $('#filtro-proyecto').replaceChildren(el('option', { value: '' }, 'Todos los proyectos'), ...est.op.proyectos.map((p) => el('option', { value: p.id }, `${p.codigo} · ${p.nombre || ''}`)));
    $('#filtro-proyecto').onchange = () => cargar().catch((e) => toast(e.message, true));
    document.querySelectorAll('[role=tab]').forEach((b) => { b.onclick = () => { est.vista = b.dataset.vista; est.abierta = null; history.replaceState(null, '', `?vista=${est.vista}`); cargar(); }; });
    await cargar();
    window.s360.alCambiar(() => cargar(), { esperar: () => est.abierta != null });
  }
  init().catch((e) => toast(e.message, true));
})();
