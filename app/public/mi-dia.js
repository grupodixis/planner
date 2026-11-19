/* Mi día: el operario apunta lo que hizo. Pensado para el móvil y para la tablet del taller. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'selected' || k === 'disabled') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  const deHora = (s) => { const [h, m] = String(s).split(':').map(Number); return h + m / 60; };
  const durTxt = (h) => { const x = Math.round(h * 4) / 4; const hh = Math.floor(x), mm = Math.round((x - hh) * 60); return mm ? `${hh} h ${mm}` : `${hh} h`; };
  const sumarDias = (f, n) => { const d = new Date(`${f}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString('sv-SE'); };
  const fechaLarga = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 2600);
  }
  async function api(metodo, url, cuerpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    if (r.status === 401) { location.replace('/pin.html'); throw new Error('Sesión caducada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }

  const estado = { fecha: null, d: null, abiertos: new Set() };
  const puede = () => estado.d?.editable;

  async function salir() {
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.replace('/pin.html');
  }

  // En la tablet común: si nadie toca nada en 3 min, se sale sola
  let quieto;
  function vigilarInactividad() {
    const reiniciar = () => { clearTimeout(quieto); quieto = setTimeout(salir, 3 * 60 * 1000); };
    ['pointerdown', 'keydown', 'scroll'].forEach((e) => document.addEventListener(e, reiniciar, { passive: true }));
    reiniciar();
  }

  async function cargar() {
    estado.d = await api('GET', `/api/mi-dia${estado.fecha ? `?fecha=${estado.fecha}` : ''}`);
    estado.fecha = estado.d.fecha;
    pintar();
  }

  /* ---------- pintar ---------- */
  function pintar() {
    const d = estado.d;
    $('#md-nombre').textContent = d.recurso.nombre;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    $('#fecha-txt').textContent = d.fecha === d.hoy ? `Hoy, ${fechaLarga(d.fecha)}` : d.fecha === sumarDias(d.hoy, -1) ? `Ayer, ${fechaLarga(d.fecha)}` : cap(fechaLarga(d.fecha));
    // se puede mirar lo planificado hasta 30 días por delante (solo consulta)
    $('#dia-sig').disabled = d.fecha >= sumarDias(d.hoy, 30);
    const futuro = d.fecha > d.hoy;

    const plan = d.tramos.reduce((s, t) => s + (t.hasta - t.desde), 0);
    const apuntado = d.tramos.reduce((s, t) => {
      const x = t.declaracion;
      if (!x || x.estado === 'no') return s;
      return s + (x.hasta - x.desde);
    }, 0) + d.extra.reduce((s, x) => s + (x.hasta - x.desde), 0);
    $('#resumen').textContent = d.tramos.length || d.extra.length
      ? (futuro ? `Planificado ${durTxt(plan)}` : `Planificado ${durTxt(plan)} · Apuntado ${durTxt(apuntado)}`) : '';

    const aviso = !d.editable ? d.no_editable : d.ausente ? 'Hoy constas como ausente. Si has venido, díselo al encargado.' : null;
    $('#aviso').hidden = !aviso;
    $('#aviso').classList.toggle('info', futuro);
    $('#aviso').textContent = aviso || '';

    $('#tramos').replaceChildren(...(d.tramos.length ? d.tramos.map(tarjeta)
      : [el('p', { class: 'md-vacio' }, futuro ? 'Todavía no tienes nada planificado este día.' : 'No tienes nada planificado este día.')]));

    // trabajo no planificado
    $('#extra').replaceChildren(...d.extra.map((x) => el('li', {},
      el('span', { class: 'md-ex-h' }, `${hhmm(x.desde)}–${hhmm(x.hasta)}`),
      el('span', { class: 'md-ex-que' }, x.tipo === 'productivo' ? `${x.orden_codigo} · ${x.tarea}` : d.no_productivo[x.motivo] || x.motivo,
        x.notas ? el('small', {}, ` · ${x.notas}`) : null),
      x.resuelto ? el('span', { class: 'md-ok' }, x.resuelto === 'confirmado' ? '✔' : 'descartado')
        : puede() ? el('button', { type: 'button', class: 'ghost mini', 'aria-label': 'Quitar', onclick: () => quitarExtra(x) }, '✕') : null)));
    $('#extra-abrir').hidden = !puede();
    if (!puede()) $('#form-extra').hidden = true;

    $('#extra').closest('section').hidden = futuro;
    $('#bloque-manana').hidden = !d.manana.length;
    if (d.manana.length) {
      $('#tit-manana').textContent = `Lo siguiente · ${fechaLarga(d.manana[0].fecha)}`;
      $('#manana').replaceChildren(...d.manana.map((m) => el('li', {}, el('b', {}, hhmm(m.desde)), ` ${m.orden_codigo} · ${m.tarea}`, m.area ? el('small', {}, ` · ${m.area}`) : null)));
    }

    const faltan = d.tramos.filter((t) => !t.cierre && !t.declaracion).length;
    $('#enviar').hidden = !puede() || (!d.tramos.length && !d.extra.length);
    $('#enviar').disabled = faltan > 0;
    $('#enviar').textContent = d.enviado ? 'Volver a enviar' : 'Enviar mi día';
    $('#enviar-txt').hidden = !puede();
    $('#enviar-txt').textContent = faltan ? `Te falta apuntar ${faltan} trabajo${faltan > 1 ? 's' : ''}.`
      : d.enviado ? `Enviado a las ${new Date(d.enviado).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}. El encargado lo revisará; hasta entonces puedes cambiarlo.`
        : 'Cuando lo tengas todo, envíalo al encargado.';
  }

  // Lo que necesita para este trabajo: materiales (con su estado) y herramientas
  const EST_MAT = {
    disponible: ['ok', '✔ en almacén'],
    pedido: ['pedido', '🚚 pedido'],
    por_pedir: ['falta', '✗ falta'],
    sin_revisar: ['revisar', '? sin revisar'],
  };
  const cantTxt = (n, u) => (n ? `${String(Math.round(n * 1000) / 1000).replace('.', ',')}${u ? ` ${u}` : ''}` : '');
  const diaTxt = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  // marcar: material recibido / herramienta preparada / equipo cogido (cada operario lo suyo)
  async function marcar(tipo, item, hecho, caja, tramoId) {
    caja.disabled = true;
    try { await api('PUT', '/api/mi-dia/llevar', { tipo, id: item.id, hecho, tramo_id: tramoId }); item.mio = hecho; pintar(); }
    catch (e) { toast(e.message, true); caja.checked = !hecho; caja.disabled = false; }
  }
  function bloqueLlevar(t, dia) {
    const L = t.llevar || { materiales: [], herramientas: [] };
    const maqs = t.maquinas || [];
    const enArea = [...(t.area_maquinas || []), ...(t.area_equipamiento || [])];
    if (!L.materiales.length && !L.herramientas.length && !maqs.length && !enArea.length) return null;
    const falta = L.materiales.filter((m) => m.estado !== 'disponible' && !m.mio).length;
    const recib = L.materiales.filter((m) => m.mio).length;
    const prep = L.herramientas.filter((h) => h.mio).length + maqs.filter((m) => m.mio).length;
    const nPrep = L.herramientas.length + maqs.length;
    const todo = recib === L.materiales.length && prep === nPrep && (L.materiales.length + nPrep) > 0;
    const fila = (tipo, item, desc, est) => {
      const caja = el('input', { type: 'checkbox', checked: item.mio, onchange: (ev) => marcar(tipo, item, ev.target.checked, ev.target, t.id),
        'aria-label': `${tipo === 'material' ? 'Recibido' : 'Preparado'}: ${item.descripcion || item.nombre}` });
      return el('li', { class: item.mio ? 'hecho' : '' }, el('label', { class: 'md-ll-check' }, caja, el('span', { class: 'md-ll-desc' }, ...desc)), est);
    };
    return el('div', { class: `md-llevar${todo ? ' todo' : falta ? ' con-falta' : ''}` },
      el('div', { class: 'md-ll-tit' }, '🧰 Necesitas',
        todo ? el('span', { class: 'md-ll-okt' }, ' · todo listo ✔')
          : falta ? el('span', { class: 'md-ll-aviso' }, ` · ${falta} material${falta > 1 ? 'es' : ''} aún no disponible${falta > 1 ? 's' : ''}`) : null),
      L.materiales.length ? el('div', { class: 'md-ll-sub' }, `Material · recibido ${recib}/${L.materiales.length}`) : null,
      L.materiales.length ? el('ul', { class: 'md-ll-lista' }, L.materiales.map((m) => {
        const tarde = m.estado === 'pedido' && m.fecha_prevista && m.fecha_prevista > dia;
        const [cl, txt] = m.mio ? ['ok', '✔ recibido'] : tarde ? ['falta', ''] : EST_MAT[m.estado] || ['', ''];
        return fila('material', m, [el('b', {}, cantTxt(m.cantidad, m.unidad)), ` ${m.descripcion}`],
          el('span', { class: `md-ll-est ${cl}` }, !m.mio && m.estado === 'pedido' && m.fecha_prevista ? `${tarde ? '⚠' : '🚚'} llega ${diaTxt(m.fecha_prevista)}` : txt));
      })) : null,
      nPrep ? el('div', { class: 'md-ll-sub' }, `Herramientas y equipos · preparados ${prep}/${nPrep}`) : null,
      nPrep ? el('ul', { class: 'md-ll-lista herr' },
        maqs.map((m) => fila('equipo', m, ['⚙️ ', el('b', {}, m.nombre)], el('span', { class: 'md-ll-est revisar' }, 'equipo'))),
        L.herramientas.map((h) => fila('herramienta', h, ['🔧 ', h.cantidad > 1 ? el('b', {}, `${cantTxt(h.cantidad)}× `) : null, h.descripcion], null))) : null,
      enArea.length ? el('div', { class: 'md-ll-area' }, el('b', {}, `Ya está en ${t.area || 'el área'}: `), enArea.join(', ')) : null);
  }

  // lo asignado que no es operario ni máquina (subcontratas…): las máquinas van en «Necesitas»
  const otrosEquipos = (t) => t.equipos.filter((n) => !(t.maquinas || []).some((m) => m.nombre === n) && !(t.area_maquinas || []).includes(n));

  function tarjeta(t) {
    const x = t.declaracion;
    const cerrado = !!t.cierre;
    const editar = puede() && !cerrado;
    const est = x?.estado || null;
    const guardar = (cambios) => declarar(t, { estado: est, desde: x?.desde, hasta: x?.hasta, terminada: x?.terminada, motivo: x?.motivo, notas: x?.notas, ...cambios });

    const boton = (valor, txt, clase) => el('button', {
      type: 'button', class: `md-est ${clase}${est === valor ? ' activo' : ''}`, 'aria-pressed': est === valor ? 'true' : 'false', disabled: !editar,
      onclick: () => {
        if (valor === 'parcial') return guardar({ estado: 'parcial', desde: x?.estado === 'parcial' ? x.desde : t.desde, hasta: x?.estado === 'parcial' ? x.hasta : t.hasta });
        if (valor === 'no') { estado.abiertos.add(t.id); return pintarNo(t); }
        return guardar({ estado: 'hecho', desde: undefined, hasta: undefined, motivo: null });
      },
    }, txt);

    const card = el('article', { class: `md-tramo${cerrado ? ' cerrado' : ''}${est ? ` e-${est}` : estado.d.fecha > estado.d.hoy ? '' : ' pendiente'}`, style: `--c:${t.color || 'var(--azul)'}`, 'data-tramo': t.id },
      el('div', { class: 'md-t-cab' },
        el('span', { class: 'md-t-hora' }, `${hhmm(t.desde)}–${hhmm(t.hasta)}`),
        el('span', { class: 'md-t-area' }, t.area || '')),
      el('div', { class: 'md-t-tarea' }, el('b', {}, t.orden_codigo), ` ${t.tarea}`),
      t.companeros.length || otrosEquipos(t).length ? el('div', { class: 'md-t-con' },
        t.companeros.length ? `con ${t.companeros.join(', ')}` : null,
        otrosEquipos(t).length ? el('span', {}, `${t.companeros.length ? ' · ' : ''}${otrosEquipos(t).join(', ')}`) : null) : null,
      bloqueLlevar(t, estado.d.fecha),
      t.fab?.length ? el('div', { class: `md-llevar md-fab${t.fab.some((f) => !f.recibido && f.llegada >= estado.d.fecha) ? ' con-falta' : ''}` },
        el('div', { class: 'md-ll-tit' }, '🏭 Piezas fabricadas fuera'),
        el('ul', { class: 'md-ll-lista' }, t.fab.map((f) => el('li', {},
          el('span', { class: 'md-ll-desc' }, f.nombre),
          el('span', { class: `md-ll-est ${f.recibido ? 'ok' : f.llegada >= estado.d.fecha ? 'falta' : 'pedido'}` },
            f.recibido ? '✔ ya está aquí' : `${f.llegada >= estado.d.fecha ? '⚠' : '🚚'} llega ${diaTxt(f.llegada)}`))))) : null,
      t.tarea_notas ? el('details', { class: 'md-t-notas' }, el('summary', {}, 'Notas de la tarea'), el('p', {}, t.tarea_notas)) : null,
      cerrado ? el('p', { class: 'md-ok' }, '✔ Confirmado por el encargado') : null,
      estado.d.fecha === estado.d.hoy ? el('button', { type: 'button', class: 'md-inc-link', onclick: () => window.midiaMas.incidencia(t.id) }, '＋ Capturar algo de este trabajo') : null,
      estado.d.fecha > estado.d.hoy ? null : el('div', { class: 'md-botones', role: 'group', 'aria-label': 'Cómo fue' },
        boton('hecho', '✓ Hecho', 'ok'), boton('parcial', '◐ En parte', 'parcial'), boton('no', '✗ No', 'no')),
      el('div', { class: 'md-detalle' }));
    const det = card.querySelector('.md-detalle');

    if (est === 'parcial') {
      det.append(el('div', { class: 'md-horas' },
        el('label', {}, 'De ', el('input', { type: 'time', step: 900, value: hhmm(x.desde), disabled: !editar, onchange: (ev) => ev.target.value && guardar({ desde: deHora(ev.target.value) }) })),
        el('label', {}, 'a ', el('input', { type: 'time', step: 900, value: hhmm(x.hasta), disabled: !editar, onchange: (ev) => ev.target.value && guardar({ hasta: deHora(ev.target.value) }) }))));
    }
    if (est === 'hecho' || est === 'parcial') {
      det.append(el('div', { class: 'md-terminada' },
        el('span', {}, '¿Queda terminada la tarea?'),
        el('div', { class: 'md-sino' },
          el('button', { type: 'button', class: `md-si${x.terminada === true ? ' activo' : ''}`, 'aria-pressed': x.terminada === true ? 'true' : 'false', disabled: !editar, onclick: () => guardar({ terminada: true }) }, 'Sí, terminada'),
          el('button', { type: 'button', class: `md-si${x.terminada === false ? ' activo' : ''}`, 'aria-pressed': x.terminada === false ? 'true' : 'false', disabled: !editar, onclick: () => guardar({ terminada: false }) }, 'No, sigue'))));
    }
    if (est === 'no' || (est === null && estado.abiertos.has(t.id))) det.append(selectorMotivo(t, x, editar, guardar, true));
    if (est === 'parcial') det.append(selectorMotivo(t, x, editar, guardar, false));
    if (est) {
      det.append(el('input', {
        class: 'md-nota', maxlength: 500, placeholder: 'Nota para el encargado (opcional)', value: x.notas || '', disabled: !editar, 'aria-label': 'Nota',
        onchange: (ev) => guardar({ notas: ev.target.value }),
      }));
    }
    return card;
  }

  function selectorMotivo(t, x, editar, guardar, obligatorio) {
    const d = estado.d;
    return el('label', { class: 'md-motivo' }, obligatorio ? '¿Por qué no se hizo?' : '¿Por qué? (opcional)',
      el('select', {
        disabled: !editar,
        onchange: (ev) => {
          if (!ev.target.value) return;
          if (obligatorio) guardar({ estado: 'no', motivo: ev.target.value, terminada: null });
          else guardar({ motivo: ev.target.value });
        },
      }, el('option', { value: '' }, 'Elige…'),
      Object.entries(d.motivos).map(([k, v]) => el('option', { value: k, selected: x?.motivo === k }, v))));
  }

  // «✗ No» necesita el motivo antes de guardarse
  function pintarNo(t) {
    pintar();
    document.querySelector(`[data-tramo="${t.id}"] .md-motivo select`)?.focus();
  }

  async function declarar(t, datos) {
    try {
      const cuerpo = { estado: datos.estado, terminada: datos.terminada ?? null, motivo: datos.motivo || null, notas: datos.notas || null };
      if (datos.estado === 'parcial') { cuerpo.desde = datos.desde; cuerpo.hasta = datos.hasta; }
      await api('PUT', `/api/mi-dia/tramos/${t.id}`, cuerpo);
      estado.abiertos.delete(t.id);
      await cargar();
    } catch (e) { toast(e.message, true); await cargar(); }
  }

  /* ---------- trabajo no planificado ---------- */
  function prepararExtra() {
    const f = $('#form-extra');
    $('#extra-abrir').onclick = () => {
      const d = estado.d;
      const mias = d.tareas.filter((t) => t.mias), otras = d.tareas.filter((t) => !t.mias);
      const opt = (t) => el('option', { value: t.id }, `${t.orden_codigo} · ${t.nombre}`);
      f.tarea_id.replaceChildren(el('option', { value: '' }, '¿En qué tarea?'),
        mias.length ? el('optgroup', { label: 'Mis tareas' }, mias.map(opt)) : null,
        otras.length ? el('optgroup', { label: 'Otras' }, otras.map(opt)) : null);
      f.motivo.replaceChildren(el('option', { value: '' }, '¿Qué hiciste?'), ...Object.entries(d.no_productivo).map(([k, v]) => el('option', { value: k }, v)));
      const fin = d.tramos.reduce((m, t) => Math.max(m, t.hasta), 0) || 15;
      f.desde.value = hhmm(Math.min(fin, 22)); f.hasta.value = hhmm(Math.min(fin + 1, 23));
      f.hidden = false; $('#extra-abrir').hidden = true;
      f.tarea_id.focus();
    };
    $('#extra-cancelar').onclick = () => { f.hidden = true; f.reset(); $('#extra-abrir').hidden = !puede(); };
    f.addEventListener('change', (ev) => {
      if (ev.target.name !== 'tipo') return;
      const np = f.tipo.value === 'no_productivo';
      f.tarea_id.hidden = np; f.motivo.hidden = !np;
    });
    f.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        await api('POST', '/api/mi-dia/extra', {
          fecha: estado.fecha, tipo: f.tipo.value, tarea_id: Number(f.tarea_id.value) || null, motivo: f.motivo.value || null,
          desde: deHora(f.desde.value), hasta: deHora(f.hasta.value), notas: f.notas.value,
        });
        f.reset(); f.hidden = true; f.tarea_id.hidden = false; f.motivo.hidden = true;
        toast('Añadido');
        await cargar();
      } catch (e) { toast(e.message, true); }
    };
  }

  async function quitarExtra(x) {
    try { await api('DELETE', `/api/mi-dia/extra/${x.id}`); await cargar(); } catch (e) { toast(e.message, true); }
  }

  /* ---------- enviar ---------- */
  async function enviar() {
    try {
      await api('POST', '/api/mi-dia/enviar', { fecha: estado.fecha });
      if (estado.d.comun) {
        // en la tablet común se sale sola para el siguiente
        document.body.replaceChildren(el('main', { class: 'md-gracias' }, el('p', {}, '✔ Enviado'), el('p', { class: 'ayuda' }, 'Gracias. Cerrando…')));
        setTimeout(salir, 1800);
        return;
      }
      toast('Enviado al encargado');
      await cargar();
    } catch (e) { toast(e.message, true); }
  }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { return; }
    if (!(yo.permisos || []).includes('mi_dia')) {
      document.querySelector('.md-main').replaceChildren(el('p', { class: 'md-vacio' }, 'Esta pantalla es para los operarios que entran con PIN. ', el('a', { href: '/' }, 'Ir al tablero')));
      return;
    }
    $('#salir').onclick = salir;
    // quien tiene otro rol además (Logística, Operaciones…) vuelve a sus pantallas desde aquí
    const otros = (yo.permisos || []).filter((k) => k !== 'mi_dia');
    if (otros.length) {
      $('#mis-pantallas').hidden = false;
      $('#mis-pantallas').href = otros.includes('planificar') ? '/' : otros.some((k) => ['logistica', 'compras', 'escandallo'].includes(k)) ? '/logistica.html' : '/proyectos.html';
    }
    window.s360pwa?.boton($('#instalar'));
    const fq = new URLSearchParams(location.search).get('fecha');
    if (/^\d{4}-\d{2}-\d{2}$/.test(fq || '')) estado.fecha = fq;
    $('#dia-ant').onclick = () => { estado.fecha = sumarDias(estado.fecha, -1); cargar().catch((e) => toast(e.message, true)); };
    $('#dia-sig').onclick = () => { estado.fecha = sumarDias(estado.fecha, 1); cargar().catch((e) => toast(e.message, true)); };
    $('#enviar').onclick = enviar;
    prepararExtra();
    window.midiaMas.iniciar({
      irADia: (f) => { estado.fecha = f; cargar().catch((e) => toast(e.message, true)); },
      recargarDia: () => cargar().catch(() => {}),
    });
    await cargar();
    const logistica = (yo.permisos || []).includes('logistica');
    window.midiaMenu?.iniciar({ comun: !!estado.d.comun, logistica });
    if (logistica) window.midiaStock?.iniciar();
    // ayuda: novedades y recorrido de la primera vez (el «?» está en el menú)
    window.s360ayuda?.iniciar({ sinBoton: true, permisos: yo.permisos || [] }).catch(() => {});
    if (estado.d.comun) vigilarInactividad();
    // avisos al móvil: solo en el móvil de cada uno (en la tablet común no tiene sentido)
    if (estado.d.comun) $('#ajustes-avisos').hidden = true;
    else {
      window.s360pwa?.avisos($('#activar-avisos'));
      window.s360pwa?.renovar();
      $('#ajustes-avisos').onclick = () => window.s360pwa?.ajustes();
    }
    // si el encargado confirma o cambia el plan (o aprueba algo), se ve al momento
    window.s360.alCambiar(() => Promise.all([cargar(), window.midiaMas.recargar()]));
  }
  init();
})();
