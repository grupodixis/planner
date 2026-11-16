/* s360_planificacion · Parte del día: registrar lo real (validar o corregir lo planificado) */
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
  const api = (...a) => window.s360.api(...a);
  function toast(msg, error = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 3200);
  }

  const hoyISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const sumarDias = (iso, n) => { const [y, m, d] = iso.split('-').map(Number); const x = new Date(y, m - 1, d + n); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
  const fechaLarga = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
  const fechaCorta = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' });
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  const aHora = (v) => { const [h, m] = String(v).split(':').map(Number); return h + (m || 0) / 60; };
  const hTxt = (h) => `${String(Math.round(h * 100) / 100).replace('.', ',')}h`;

  const q0 = new URLSearchParams(location.search);
  const estado = { fecha: q0.get('fecha') || sumarDias(hoyISO(), -1), datos: null, tareas: [], abierto: null };

  async function accion(fn, ok) {
    try { const r = await fn(); toast(typeof r === 'string' ? r : ok); } catch (e) { toast(e.message, true); }
    await cargar();
  }

  /* ---------- carga ---------- */
  async function cargar() {
    const f = estado.fecha;
    const enc = window.s360.tiene('planificar');
    const [datos, tablero, pend, avisos, inc] = await Promise.all([
      api('GET', `/api/parte?fecha=${f}`),
      api('GET', `/api/tablero?fecha=${f}`),
      api('GET', '/api/parte/pendientes'),
      enc ? api('GET', `/api/avisos-ausencia?desde=${f}&hasta=${f}`) : [],
      enc ? api('GET', '/api/capturas?vista=bandeja') : { capturas: [], categorias: {}, cuenta: {} },
    ]);
    if (f !== estado.fecha) return;
    estado.avisos = avisos; estado.inc = inc;
    estado.datos = datos;
    estado.tareas = tablero.tareas;
    history.replaceState(null, '', `?fecha=${f}`);
    pintar(pend);
  }

  function pintar(pend) {
    const d = estado.datos;
    const editar = window.s360.tiene('planificar') && !d.cerrado;
    $('#fecha-txt').textContent = fechaLarga(d.fecha);
    $('#fecha-input').value = d.fecha;
    $('#ver-tablero').href = `/?fecha=${d.fecha}&periodo=dia`;
    $('#estado-dia').className = `estado-dia${d.cerrado ? ' cerrado' : ''}`;
    $('#estado-dia').textContent = d.cerrado
      ? `🔒 Cerrado${d.cerrado.cerrado_por ? ` por ${d.cerrado.cerrado_por}` : ''}`
      : d.fecha > hoyISO() ? 'Día futuro' : 'Abierto';

    // días anteriores sin cerrar
    const otros = (pend || []).filter((p) => p.fecha !== d.fecha);
    $('#pendientes').hidden = !otros.length;
    $('#pendientes').replaceChildren(el('span', {}, `${otros.length} día(s) con trabajo sin cerrar el parte:`),
      ...otros.slice(-10).map((p) => el('a', { href: `?fecha=${p.fecha}`, onclick: (ev) => { ev.preventDefault(); irA(p.fecha); } }, fechaCorta(p.fecha))));

    const ausDe = (id) => d.ausencias.filter((a) => a.recurso_id === id);
    $('#tramos').replaceChildren(...(d.tramos.length ? d.tramos.map((tr) => tarjeta(tr, editar, ausDe))
      : [el('p', { class: 'ayuda' }, 'No había nada planificado este día. Si se trabajó, apúntalo en «Horas fuera del plan».')]));

    $('#no-hechos').replaceChildren(...(d.no_hechos.length ? [el('h3', {}, 'No se hizo'),
      ...d.no_hechos.map((c) => el('div', { class: 'tarjeta-parte cerrada no-hecho' },
        el('div', { class: 'tp-cab' },
          el('span', { class: 'marca c-no_hecho' }, '✗'),
          el('span', { class: 'tp-ot', style: `color:${c.color}` }, c.orden_codigo), ` ${c.tarea}`,
          el('span', { class: 'tp-hora' }, `${hhmm(c.hora_inicio)}–${hhmm(c.hora_inicio + c.duracion_h)} · ${c.area || ''}`)),
        el('p', { class: 'tp-res' }, `Motivo: ${d.motivos[c.motivo] || c.motivo}${c.notas ? ` · ${c.notas}` : ''} · vuelve a «Por planificar»`),
        editar ? el('button', { type: 'button', class: 'ghost mini', onclick: () => accion(() => api('DELETE', `/api/cierres/${c.id}`), 'Recuperado tal como estaba planificado') }, 'Deshacer') : null))] : []));

    // cerrar / reabrir el día
    const abiertos = d.tramos.filter((t) => !t.cierre).length;
    const puede = window.s360.tiene('planificar');
    $('#cerrar-dia').replaceChildren(
      d.cerrado
        ? (puede ? el('button', { type: 'button', class: 'ghost', onclick: () => confirm('¿Reabrir el parte? Se podrá cambiar lo de este día.') && accion(() => api('DELETE', `/api/parte/cerrar?fecha=${d.fecha}`), 'Parte reabierto') }, 'Reabrir el parte') : null)
        : puede && d.fecha <= hoyISO() ? el('button', {
          type: 'button', class: 'primario grande',
          onclick: () => {
            if (abiertos && !confirm(`Quedan ${abiertos} tramo(s) sin cerrar. ¿Darlos por hechos como estaban y cerrar el día?`)) return;
            accion(() => api('POST', '/api/parte/cerrar', { fecha: d.fecha, validar_resto: true }), abiertos ? `Día cerrado (${abiertos} validado(s) como estaban)` : 'Día cerrado');
          },
        }, abiertos ? `Validar lo que queda (${abiertos}) y cerrar el día` : 'Cerrar el día') : '');

    pintarPersonas(d, ausDe);
    pintarFormHoras(d, editar);
    pintarEnvios(d, editar);
    pintarAvisosIncidencias();
    pintarExtraDeclarado(d, editar);
  }

  /* ---------- tarjeta de un tramo ---------- */
  function tarjeta(tr, editar, ausDe) {
    const cab = el('div', { class: 'tp-cab' },
      tr.cierre ? el('span', { class: `marca c-${tr.cierre}` }, tr.cierre === 'hecho' ? '✓' : '≠') : null,
      el('span', { class: 'tp-ot', style: `color:${tr.color}` }, tr.orden_codigo), ` ${tr.tarea}`,
      el('span', { class: 'tp-hora' }, `${hhmm(tr.hora_inicio)}–${hhmm(tr.hora_inicio + tr.duracion_h)} · ${hTxt(tr.duracion_h)} · ${tr.area || 'sin área'}`));
    const gente = el('div', { class: 'tp-gente' }, tr.asignados.length ? tr.asignados.map((a) => {
      const aus = ausDe(a.id).find((x) => x.hora_desde == null || (x.hora_desde < a.hasta && x.hora_hasta > a.desde));
      return el('span', { class: `chip-p ${a.tipo}${aus ? ' falta' : ''}`, title: aus ? `${a.nombre}: ${aus.tipo}${aus.hora_desde != null ? ` ${hhmm(aus.hora_desde)}–${hhmm(aus.hora_hasta)}` : ''}` : '' },
        a.nombre, el('span', { class: 'cp-franja' }, ` ${hhmm(a.desde)}–${hhmm(a.hasta)}`), aus ? el('span', { class: 'aus' }, ` · ${aus.tipo}`) : null);
    }) : el('span', { class: 'ayuda' }, 'sin nadie asignado'));

    if (tr.cierre) {
      const ci = tr.cierre_info;
      return el('div', { class: `tarjeta-parte cerrada c-${tr.cierre}` }, cab,
        el('p', { class: 'tp-res' },
          tr.registros.length ? `Real: ${tr.registros.map((g) => `${g.recurso} ${hhmm(g.desde)}–${hhmm(g.hasta)}`).join(' · ')}` : 'Real: nadie (0 h)',
          ci?.motivo ? ` · motivo: ${estado.datos.motivos[ci.motivo]}` : '', ci?.notas ? ` · ${ci.notas}` : '',
          tr.tarea_estado === 'hecha' ? el('b', {}, ' · tarea terminada') : ''),
        editar && ci ? el('button', {
          type: 'button', class: 'ghost mini', title: 'Quita lo real de este tramo y devuelve la tarea a como estaba antes (estado, horas que faltaban y tramos quitados)',
          onclick: () => accion(async () => {
            const r = await api('DELETE', `/api/cierres/${ci.id}`);
            return r.tramos_repuestos ? `Cierre deshecho · ${r.tramos_repuestos} tramo(s) repuestos` : 'Cierre deshecho';
          }),
        }, 'Deshacer') : null);
    }

    // avance de la tarea (por defecto «terminada» si es su último tramo y cubre todas sus horas;
    // si los operarios lo han apuntado, lo que digan ellos)
    const pr = tr.propuesta;
    const ultimo = pr ? pr.terminada : !tr.tramos_despues && tr.tarea_planificadas >= tr.tarea_h;
    const nombre = `prog-${tr.id}`;
    const ops = Math.max(1, tr.operarios_req || 1);
    const faltan = el('input', { type: 'number', min: 0, step: 0.5, class: 'faltan', 'aria-label': 'Horas de tarea que faltan', value: '' });
    // explica en qué se convierte «faltan X h»: horas de tarea (de reloj) y su equivalente en horas-persona
    const explica = el('span', { class: 'faltan-explica' });
    const pintarExplica = () => {
      const x = Number(faltan.value);
      if (faltan.value === '' || !(x >= 0)) {
        explica.textContent = `(hasta aquí: ${hTxt(tr.hecho_hasta)} de ${hTxt(tr.tarea_h)} previstas)`;
        return;
      }
      const nueva = tr.hecho_hasta + x;
      explica.textContent = `→ la tarea pasa de ${hTxt(tr.tarea_h)} a ${hTxt(nueva)}${ops > 1 ? ` · ${hTxt(x)} × ${ops} op = ${hTxt(x * ops)}-persona` : ''}`;
    };
    pintarExplica();
    faltan.addEventListener('input', pintarExplica);
    const progreso = el('div', { class: 'tp-prog' },
      el('span', { class: 'etq' }, 'La tarea:'),
      el('label', {}, el('input', { type: 'radio', name: nombre, value: 'sigue', checked: !ultimo && !pr?.desacuerdo }), ' sigue'),
      el('label', {}, el('input', { type: 'radio', name: nombre, value: 'faltan' }), ' faltan ', faltan, ' h de tarea'),
      el('label', {}, el('input', { type: 'radio', name: nombre, value: 'terminada', checked: ultimo && !pr?.desacuerdo }), ' terminada'),
      explica);
    faltan.addEventListener('focus', () => { progreso.querySelector('[value=faltan]').checked = true; });
    // devuelve el avance; undefined = el usuario ha decidido no seguir
    const leerProgreso = async () => {
      const v = progreso.querySelector(`input[name=${nombre}]:checked`)?.value;
      if (!v) throw new Error('Decide si la tarea sigue o quedó terminada');
      if (v === 'terminada') {
        const q = await window.s360.preguntarTramosSobrantes(tr.tarea, tr.despues);
        if (q === null) return undefined;
        return { terminada: true, quitar_futuros: q };
      }
      if (v === 'faltan') {
        if (faltan.value === '') throw new Error('Pon cuántas horas faltan');
        return { faltan_h: Number(faltan.value) };
      }
      return null;
    };

    const zona = el('div', { class: 'tp-zona' });
    const botones = editar ? el('div', { class: 'tp-botones' },
      pr ? el('button', {
        type: 'button', class: 'primario', title: 'Cierra el tramo con lo que han apuntado los operarios',
        onclick: async () => {
          let p; try { p = await leerProgreso(); } catch (e) { return toast(e.message, true); }
          if (p === undefined) return;
          accion(async () => {
            const r = await api('POST', `/api/tramos/${tr.id}/cierre`, cierreDePropuesta(pr, p));
            return r.tramos_quitados ? `Confirmado · ${r.tramos_quitados} tramo(s) posteriores quitados` : 'Confirmado lo apuntado';
          });
        },
      }, '✓ Confirmar lo apuntado') : null,
      el('button', {
        type: 'button', class: 'primario',
        onclick: async () => {
          let p; try { p = await leerProgreso(); } catch (e) { return toast(e.message, true); }
          if (p === undefined) return;
          accion(async () => {
            const r = await api('POST', `/api/tramos/${tr.id}/cierre`, { accion: 'hecho', progreso: p });
            return r.tramos_quitados ? `Hecho como estaba · ${r.tramos_quitados} tramo(s) posteriores quitados` : 'Hecho como estaba';
          });
        },
      }, '✓ Como estaba'),
      el('button', { type: 'button', onclick: () => abrirCorregir(tr, zona, leerProgreso, pr) }, '✎ Corregir'),
      el('button', { type: 'button', class: 'ghost', onclick: () => abrirNoHecho(tr, zona) }, '✗ No se hizo')) : null;
    const ant = tr.anteriores_abiertos || [];
    const avisoAnt = ant.length ? el('p', { class: 'tp-aviso' },
      `Esta tarea tiene ${ant.length} tramo${ant.length > 1 ? 's' : ''} anterior${ant.length > 1 ? 'es' : ''} sin cerrar: `,
      ...ant.slice(0, 4).flatMap((a, i) => [i ? ', ' : '', a.fecha === tr.fecha ? `hoy ${hhmm(a.hora_inicio)}`
        : el('a', { href: `?fecha=${a.fecha}`, onclick: (ev) => { ev.preventDefault(); irA(a.fecha); } }, fechaCorta(a.fecha))]),
      '. Ciérralos antes: «faltan X h» y «terminada» los dan por hechos tal como estaban planificados.') : null;
    return el('div', { class: `tarjeta-parte${pr ? ' con-declarado' : ''}`, style: `--c:${tr.color}` }, cab, gente, bloqueDeclarado(tr), avisoAnt, editar ? progreso : null, botones, zona);
  }

  // Lo que han apuntado los operarios en «Mi día» para este tramo
  const EST_TXT = { hecho: '✓ hecho', parcial: '◐ en parte', no: '✗ no lo hizo' };
  function bloqueDeclarado(tr) {
    const decl = (tr.declaraciones || []).filter((x) => !x.resuelto);
    if (!decl.length) return null;
    const d = estado.datos;
    return el('div', { class: 'tp-declarado' },
      el('p', { class: 'tp-decl-tit' }, 'Apuntado por los operarios'),
      el('ul', {}, decl.map((x) => el('li', { class: `e-${x.estado}` },
        el('b', {}, x.recurso), ': ', EST_TXT[x.estado],
        x.estado === 'parcial' ? ` ${hhmm(x.desde)}–${hhmm(x.hasta)}` : '',
        x.estado !== 'no' && x.terminada === true ? ' · tarea terminada' : x.estado !== 'no' && x.terminada === false ? ' · sigue' : '',
        x.motivo ? ` · ${d.motivos[x.motivo] || x.motivo}` : '',
        x.notas ? el('span', { class: 'tp-decl-nota' }, ` «${x.notas}»`) : null))),
      tr.propuesta?.avisos?.length ? el('ul', { class: 'tp-decl-avisos' }, tr.propuesta.avisos.map((a) => el('li', {}, `⚠ ${a}`))) : null);
  }

  // Cuerpo del cierre a partir de la propuesta (lo apuntado) y del avance elegido
  function cierreDePropuesta(pr, progreso) {
    if (pr.accion === 'no_hecho') return { accion: 'no_hecho', motivo: pr.motivo, notas: pr.notas };
    return { accion: pr.accion, registros: pr.registros, motivo: pr.motivo, notas: pr.notas, progreso };
  }

  // Confirmar de una vez todo lo apuntado que no tiene avisos
  async function confirmarTodo() {
    const d = estado.datos;
    const limpios = d.tramos.filter((tr) => !tr.cierre && tr.propuesta && !tr.propuesta.avisos.length);
    let n = 0, err = 0;
    for (const tr of limpios) {
      let progreso = null;
      if (tr.propuesta.accion !== 'no_hecho' && tr.propuesta.terminada) {
        const q = await window.s360.preguntarTramosSobrantes(tr.tarea, tr.despues);
        if (q === null) continue;
        progreso = { terminada: true, quitar_futuros: q };
      }
      try { await api('POST', `/api/tramos/${tr.id}/cierre`, cierreDePropuesta(tr.propuesta, progreso)); n++; } catch (e) { err++; toast(e.message, true); }
    }
    for (const x of d.declarado_extra) {
      try { await api('POST', `/api/declaraciones/${x.id}/aceptar`); n++; } catch (e) { err++; toast(e.message, true); }
    }
    if (!err) toast(`${n} confirmado(s)`);
    await cargar();
  }

  // Quién ha enviado su día
  function pintarEnvios(d, editar) {
    const caja = $('#mi-dia-envios');
    const pendientes = d.tramos.filter((tr) => !tr.cierre && tr.propuesta);
    const limpios = pendientes.filter((tr) => !tr.propuesta.avisos.length).length + d.declarado_extra.length;
    caja.hidden = !d.envios.length && !pendientes.length && !d.declarado_extra.length;
    if (caja.hidden) return;
    caja.replaceChildren(
      el('span', { class: 'md-env-tit' }, 'Mi día:'),
      ...d.envios.map((o) => el('span', {
        class: `md-env ${o.enviado_en ? 'ok' : o.apuntados ? 'medio' : 'no'}`,
        title: o.enviado_en ? `Enviado a las ${new Date(o.enviado_en).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}` : `Ha apuntado ${o.apuntados} de ${o.tramos} y no lo ha enviado`,
      }, o.enviado_en ? '✔ ' : o.apuntados ? '◐ ' : '✗ ', o.nombre.split(' ')[0])),
      editar && limpios ? el('button', { type: 'button', class: 'primario mini', onclick: confirmarTodo,
        title: 'Confirma los tramos apuntados sin avisos y las horas fuera del plan apuntadas' }, `Confirmar todo lo apuntado sin avisos (${limpios})`) : '');
  }

  // Corregir: horas reales de cada persona / máquina
  function abrirCorregir(tr, zona, leerProgreso, pr) {
    const d = estado.datos;
    const opciones = (sel) => [el('option', { value: '' }, '— elegir —'),
      ...['operario', 'maquina', 'subcontrata'].map((clase) => el('optgroup', { label: { operario: 'Operarios', maquina: 'Máquinas y vehículos', subcontrata: 'Subcontratas / alquiler' }[clase] },
        d.recursos.filter((r) => r.tipo === clase).map((r) => el('option', { value: r.id, selected: r.id === sel }, r.nombre))))];
    const filas = el('div', { class: 'cor-filas' });
    const fila = (a = {}) => {
      const f = el('div', { class: 'cor-fila' },
        el('select', { class: 'cor-rec', 'aria-label': 'Quién' }, opciones(a.id)),
        el('input', { type: 'time', step: 900, class: 'cor-desde', value: hhmm(a.desde ?? tr.hora_inicio), 'aria-label': 'Desde' }), '–',
        el('input', { type: 'time', step: 900, class: 'cor-hasta', value: hhmm(a.hasta ?? tr.hora_inicio + tr.duracion_h), 'aria-label': 'Hasta' }),
        el('button', { type: 'button', class: 'ghost mini borrar', 'aria-label': 'Quitar', onclick: () => f.remove() }, '✕'));
      filas.append(f);
    };
    // sale con lo planificado, sin quien faltó todo el día
    const fuera = new Set(d.ausencias.filter((x) => x.hora_desde == null).map((x) => x.recurso_id));
    if (pr?.registros) pr.registros.forEach((g) => fila({ id: g.recurso_id, desde: g.desde, hasta: g.hasta }));
    else tr.asignados.filter((a) => !fuera.has(a.id)).forEach(fila);
    if (!filas.children.length) fila();
    const motivo = el('select', { 'aria-label': 'Por qué cambió' }, el('option', { value: '' }, '¿Por qué cambió? (opcional)'),
      Object.entries(d.motivos).map(([k, t]) => el('option', { value: k }, t)));
    const notas = el('input', { placeholder: 'Notas (opcional)', maxlength: 1000, 'aria-label': 'Notas' });
    zona.replaceChildren(el('div', { class: 'corregir' },
      el('p', { class: 'ayuda' }, 'Quién trabajó y de qué hora a qué hora (añade o quita personas y máquinas):'),
      filas,
      el('button', { type: 'button', class: 'ghost mini', onclick: () => fila() }, '+ Añadir persona o máquina'),
      el('div', { class: 'cor-pie' }, motivo, notas,
        el('button', {
          type: 'button', class: 'primario',
          onclick: async () => {
            let p; try { p = await leerProgreso(); } catch (e) { return toast(e.message, true); }
            if (p === undefined) return;
            const registros = [...filas.querySelectorAll('.cor-fila')].map((f) => ({
              recurso_id: f.querySelector('.cor-rec').value,
              desde: aHora(f.querySelector('.cor-desde').value), hasta: aHora(f.querySelector('.cor-hasta').value),
            })).filter((g) => g.recurso_id);
            accion(async () => {
              const r = await api('POST', `/api/tramos/${tr.id}/cierre`, { accion: 'corregido', registros, motivo: motivo.value || null, notas: notas.value, progreso: p });
              return r.tramos_quitados ? `Guardado con cambios · ${r.tramos_quitados} tramo(s) posteriores quitados` : 'Guardado con cambios';
            });
          },
        }, 'Guardar lo real'),
        el('button', { type: 'button', class: 'ghost', onclick: () => zona.replaceChildren() }, 'Cancelar'))));
  }

  function abrirNoHecho(tr, zona) {
    const d = estado.datos;
    const motivo = el('select', { 'aria-label': 'Por qué no se hizo', required: true }, el('option', { value: '' }, '¿Por qué no se hizo?'),
      Object.entries(d.motivos).map(([k, t]) => el('option', { value: k }, t)));
    const notas = el('input', { placeholder: 'Notas (opcional)', maxlength: 1000, 'aria-label': 'Notas' });
    zona.replaceChildren(el('div', { class: 'corregir' },
      el('p', { class: 'ayuda' }, 'Se quita del tablero y sus horas vuelven a «Por planificar». Queda registrado para los informes.'),
      el('div', { class: 'cor-pie' }, motivo, notas,
        el('button', {
          type: 'button', class: 'peligro',
          onclick: () => {
            if (!motivo.value) return toast('Elige el motivo', true);
            accion(() => api('POST', `/api/tramos/${tr.id}/cierre`, { accion: 'no_hecho', motivo: motivo.value, notas: notas.value }), 'Anotado: no se hizo');
          },
        }, 'Confirmar'),
        el('button', { type: 'button', class: 'ghost', onclick: () => zona.replaceChildren() }, 'Cancelar'))));
  }

  /* ---------- por persona ---------- */
  function pintarPersonas(d, ausDe) {
    const plan = new Map(), real = new Map();
    for (const tr of d.tramos) for (const a of tr.asignados) if (a.tipo === 'operario') plan.set(a.id, (plan.get(a.id) || 0) + (a.hasta - a.desde));
    for (const g of d.registros) if (g.clase === 'operario') real.set(g.recurso_id, (real.get(g.recurso_id) || 0) + g.horas);
    const ids = new Set([...plan.keys(), ...real.keys(), ...d.ausencias.map((a) => a.recurso_id)]);
    const ops = d.recursos.filter((r) => r.tipo === 'operario' && ids.has(r.id));
    $('#personas').replaceChildren(...(ops.length ? ops.map((r) => {
      const p = plan.get(r.id) || 0, x = real.get(r.id) || 0;
      const aus = ausDe(r.id);
      return el('tr', {},
        el('td', {}, r.nombre),
        el('td', { class: 'num' }, p ? hTxt(p) : '—'),
        el('td', { class: `num${x && Math.abs(x - p) > 0.01 ? ' dif' : ''}` }, x ? hTxt(x) : '—'),
        el('td', { class: 'aus' }, aus.map((a) => `${a.tipo}${a.tipo === 'falta' && a.justificante ? ` (${a.justificante === 'si' ? 'justif.' : a.justificante === 'no' ? 'sin justif.' : 'pend.'})` : ''}`).join(', ')));
    }) : [el('tr', {}, el('td', { colspan: 4, class: 'ayuda' }, 'Nadie con horas este día.'))]));
  }

  /* ---------- horas fuera del plan ---------- */
  function pintarFormHoras(d, editar) {
    const f = $('#form-horas');
    f.hidden = !editar;
    const recSel = f.recurso_id.value;
    f.recurso_id.replaceChildren(el('option', { value: '' }, '¿Quién?'),
      ...['operario', 'maquina', 'subcontrata'].map((clase) => el('optgroup', { label: { operario: 'Operarios', maquina: 'Máquinas y vehículos', subcontrata: 'Subcontratas / alquiler' }[clase] },
        d.recursos.filter((r) => r.tipo === clase).map((r) => el('option', { value: r.id }, r.nombre)))));
    f.recurso_id.value = recSel;
    // tareas abiertas, agrupadas por OT
    const ots = new Map();
    for (const t of estado.tareas) {
      if (!ots.has(t.orden_id)) ots.set(t.orden_id, { cod: t.orden_codigo, tit: t.orden_titulo, ts: [] });
      ots.get(t.orden_id).ts.push(t);
    }
    f.tarea_id.replaceChildren(el('option', { value: '' }, '¿En qué tarea?'),
      ...[...ots.values()].map((o) => el('optgroup', { label: `${o.cod} · ${o.tit}` }, o.ts.map((t) => el('option', { value: t.id }, t.nombre)))));
    f.motivo.replaceChildren(el('option', { value: '' }, '¿Qué hizo?'), ...Object.entries(d.no_productivo).map(([k, t]) => el('option', { value: k }, t)));
    const NP = d.no_productivo;
    $('#sueltos').replaceChildren(...d.sueltos.map((g) => el('li', {},
      el('span', { class: 'sl-quien' }, g.recurso),
      el('span', {}, `${hhmm(g.desde)}–${hhmm(g.hasta)} · ${g.tipo === 'productivo' ? `${g.orden_codigo} ${g.tarea}` : NP[g.motivo] || g.motivo}${g.notas ? ` · ${g.notas}` : ''}`),
      editar ? el('button', { type: 'button', class: 'ghost mini borrar', 'aria-label': 'Quitar', onclick: () => accion(() => api('DELETE', `/api/registros/${g.id}`), 'Quitado') }, '✕') : null)));
  }

  // Avisos de ausencia de los operarios (de este día) e incidencias abiertas
  function pintarAvisosIncidencias() {
    const av = estado.avisos || [], inc = estado.inc?.capturas || [];
    const T = estado.inc?.categorias || {};
    const caja = $('#avisos-inc');
    caja.replaceChildren(
      av.length ? el('section', {}, el('h2', {}, 'Avisos de los operarios'),
        el('ul', { class: 'lista-avisos' }, av.map((a) => el('li', {},
          el('b', {}, a.recurso), ` · ${a.motivo_txt || 'ausencia'}`,
          a.hora_desde != null ? ` ${hhmm(a.hora_desde)}–${hhmm(a.hora_hasta)}` : a.desde !== a.hasta ? ` (${fechaCorta(a.desde)} – ${fechaCorta(a.hasta)})` : ' (todo el día)',
          a.notas ? el('span', { class: 'ayuda' }, ` «${a.notas}»`) : null,
          ' ', window.s360.adjuntos(a.archivos),
          el('span', { class: 'ayuda' }, a.archivos.length ? ' · justificante adjunto, revísalo en Recursos' : ' · sin justificante'))))) : '',
      inc.length ? el('section', {}, el('h2', {}, el('a', { href: '/bandeja.html' }, `Bandeja: ${inc.length} por clasificar`)),
        el('ul', { class: 'lista-inc' }, inc.slice(0, 5).map((c) => el('li', { class: `inc t-${c.categoria || 'otro'}` },
          el('div', {}, el('b', {}, T[c.categoria] || 'Captura'), el('span', { class: 'ayuda' }, ` · ${c.autor || '—'}`)),
          c.texto ? el('div', {}, c.texto.length > 140 ? `${c.texto.slice(0, 140)}…` : c.texto) : el('div', { class: 'ayuda' }, `${c.archivos.length} adjunto(s)`)))),
        inc.length > 5 ? el('p', { class: 'ayuda' }, el('a', { href: '/bandeja.html' }, `y ${inc.length - 5} más…`)) : null) : '');
  }

  // Horas fuera del plan que han apuntado los operarios: aceptar o descartar
  function pintarExtraDeclarado(d, editar) {
    const NP = d.no_productivo;
    $('#declarado-extra').replaceChildren(...(d.declarado_extra.length ? [
      el('p', { class: 'tp-decl-tit' }, 'Apuntado por los operarios'),
      el('ul', { class: 'sueltos declarados' }, d.declarado_extra.map((x) => el('li', {},
        el('span', { class: 'sl-quien' }, x.recurso),
        el('span', {}, `${hhmm(x.desde)}–${hhmm(x.hasta)} · ${x.tipo === 'productivo' ? `${x.orden_codigo} ${x.tarea}` : NP[x.motivo] || x.motivo}${x.notas ? ` · ${x.notas}` : ''}`),
        editar ? el('span', { class: 'sl-acc' },
          el('button', { type: 'button', class: 'primario mini', onclick: () => accion(() => api('POST', `/api/declaraciones/${x.id}/aceptar`), 'Aceptado') }, 'Aceptar'),
          el('button', { type: 'button', class: 'ghost mini', onclick: () => accion(() => api('POST', `/api/declaraciones/${x.id}/descartar`), 'Descartado') }, 'Descartar')) : null)))] : []));
  }

  function irA(f) { estado.fecha = f; cargar().catch((e) => toast(e.message, true)); }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { return; }
    window.s360.iniciar(yo);
    window.s360.alCambiar(() => cargar());
    $('#dia-ant').onclick = () => irA(sumarDias(estado.fecha, -1));
    $('#dia-sig').onclick = () => irA(sumarDias(estado.fecha, 1));
    $('#fecha-input').onchange = (ev) => ev.target.value && irA(ev.target.value);
    const f = $('#form-horas');
    f.addEventListener('change', (ev) => {
      if (ev.target.name !== 'tipo') return;
      const np = f.tipo.value === 'no_productivo';
      f.tarea_id.hidden = np; f.motivo.hidden = !np;
    });
    f.onsubmit = (ev) => {
      ev.preventDefault();
      const np = f.tipo.value === 'no_productivo';
      accion(() => api('POST', '/api/registros', {
        fecha: estado.fecha, recurso_id: f.recurso_id.value, tipo: f.tipo.value,
        tarea_id: np ? null : f.tarea_id.value || null, motivo: np ? f.motivo.value : null,
        desde: aHora(f.desde.value), hasta: aHora(f.hasta.value), notas: f.notas.value,
      }), 'Horas añadidas').then(() => { f.notas.value = ''; });
    };
    await cargar();
  }

  init().catch((e) => toast(e.message, true));
})();
