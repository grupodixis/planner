/* s360_planificacion · Compras: pedidos de compra (preparar, aprobar, enviar) y proveedores */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v ?? '';
      else if (k === 'checked' || k === 'disabled' || k === 'selected') n[k] = !!v;
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
  const tiene = (p) => window.s360.tiene(p);
  const nfE = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
  const eur = (x) => (x == null ? '—' : nfE.format(x));
  const fecha = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '—');
  const cuando = (t) => (t ? new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '');
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  const ESTADOS = {
    borrador: ['Borrador', ''], por_aprobar: ['Esperando aprobación', 'aviso'], aprobado: ['Aprobado · por enviar', 'ok'], enviado: ['Enviado', 'ok'], anulado: ['Anulado', ''],
  };
  const q0 = new URLSearchParams(location.search);
  const estado = { vista: q0.get('vista') || 'pedidos', pedido: Number(q0.get('pedido')) || null, sol: Number(q0.get('sol')) || null, proveedor: Number(q0.get('proveedor')) || null,
    envio: Number(q0.get('envio')) || null,
    proveedores: [], ajustes: null, filtroProv: '' };
  const guardarURL = () => {
    const u = new URLSearchParams();
    if (estado.vista !== 'pedidos') u.set('vista', estado.vista);
    if (estado.vista === 'pedidos' && estado.pedido) u.set('pedido', estado.pedido);
    if (estado.vista === 'precios' && estado.sol) u.set('sol', estado.sol);
    if (estado.vista === 'proveedores' && estado.proveedor) u.set('proveedor', estado.proveedor);
    if (estado.vista === 'transportes' && estado.envio) u.set('envio', estado.envio);
    history.replaceState(null, '', `${location.pathname}${u.toString() ? `?${u}` : ''}`);
  };

  // De dónde es una línea, con enlaces: a la tarea (o tareas) si el material está asignado; si no, al proyecto
  function origenLinea(l, p) {
    const aProy = (pid, txt, q = '') => el('a', { href: `/proyectos.html?p=${pid}${q}`, class: 'enlace-sub', title: 'Abrir en Proyectos y OTs' }, txt);
    const tareas = l.tareas || [];
    const partes = [];
    if (l.proyecto_codigo) partes.push(aProy(l.proyecto_id, l.proyecto_codigo), ` · ${l.partida_codigo ? `${l.partida_codigo} ` : ''}${l.partida_nombre || ''}`);
    if (tareas.length) {
      partes.push(partes.length ? ' · ' : '', tareas.length > 1 ? 'tareas ' : 'tarea ');
      tareas.forEach((t, i) => partes.push(i ? ', ' : '', aProy(t.proyecto_id, `${t.codigo || t.ot_codigo} ${t.nombre}`, `&ot=${t.ot_id}&tarea=${t.id}`)));
    } else if (l.tarea_id) partes.push(`🏭 tarea de la OT ${p.ot_codigo || ''} (taller externo)`);
    if (!partes.length) partes.push('Línea a mano');
    return el('div', { class: 'sub' }, partes);
  }


  /* ================= Transporte de un pedido ================= */
  async function trpDatos() {
    if (!estado.trp) estado.trp = await api('GET', '/api/transportistas');
    return estado.trp;
  }
  // almacenes del transportista en la península (donde los proveedores dejan el material)
  function almacenesDe(x, editar) {
    const caja = el('div', { class: 'trp-almacenes' }, el('h3', {}, '🏬 Almacenes en la península (los proveedores entregan aquí)'));
    trpDatos().then((d) => {
      const t = d.transportistas.find((y) => y.id === x.id);
      const fila = (a) => {
        const inp = (k, ph, w) => el('input', { type: 'text', value: a?.[k] || '', placeholder: ph, disabled: !editar, class: w || '', 'aria-label': ph,
          onchange: async (ev) => { if (!a) return; try { await api('PUT', `/api/almacenes/${a.id}`, { ...a, [k]: ev.target.value }); a[k] = ev.target.value; estado.trp = null; toast('Guardado'); } catch (e) { toast(e.message, true); } } });
        const n = inp('nombre', 'Nombre (p. ej. Idyca · Gavà)'); const di = inp('direccion', 'Dirección', 'ancho'); const te = inp('telefono', 'Teléfono');
        const ho = inp('horario', 'Horario'); const le = inp('leyenda', 'Leyenda en el pedido (p. ej. Para Dixis Menorca)');
        return el('li', {}, n, di, te, ho, le,
          !a && editar ? el('button', { type: 'button', class: 'primario mini', onclick: async () => {
            try { await api('POST', `/api/transportistas/${x.id}/almacenes`, { nombre: n.value, direccion: di.value, telefono: te.value, horario: ho.value, leyenda: le.value }); estado.trp = null; toast('Almacén añadido'); pintar(); } catch (e) { toast(e.message, true); }
          } }, 'Añadir') : null);
      };
      caja.append(el('ul', {}, (t?.almacenes || []).map(fila), editar ? fila(null) : null));
    }).catch(() => {});
    return caja;
  }

  function seccionTransporte(p) {
    const caja = el('section', { class: 'trp-pedido' });
    const editar = tiene('compras') || tiene('logistica');
    const guardarT = async (cuerpo, repintar = true) => {
      try { await api('PUT', `/api/compras/pedidos/${p.id}/transporte`, cuerpo); toast('Guardado'); if (repintar) pintar(); } catch (e) { toast(e.message, true); }
    };
    trpDatos().then((d) => {
      const modo = p.entrega_modo;
      const sug = !modo && p.modo_sugerido ? p.modo_sugerido : null;
      const ICON = { proveedor: '📦', recogida: '🚚', almacen: '🏬' };
      const SUB = { proveedor: 'su transporte o agencia', recogida: 'recogida en un domicilio', almacen: 'y nos lo trae a Menorca' };
      const botones = el('div', { class: 'trp-modos', role: 'radiogroup', 'aria-label': 'Cómo llega' }, Object.entries(d.modos).map(([k, t]) => el('button', {
        type: 'button', role: 'radio', 'aria-checked': k === modo ? 'true' : 'false', class: `trp-modo${k === modo ? ' on' : ''}${k === sug ? ' sug' : ''}`, disabled: !editar,
        onclick: () => guardarT({ entrega_modo: k, ...(k === 'almacen' && !p.almacen_id && p.transportista_sugerido ? {} : {}) }),
      }, el('b', {}, `${ICON[k]} ${t}`), el('small', {}, k === sug ? 'lo habitual con este proveedor' : SUB[k]))));
      const fIn = (k, txt, attrs = {}) => el('label', { class: 'cmp-campo' }, el('span', {}, txt),
        el(attrs.tag || 'input', { ...attrs, tag: null, value: p[k] == null ? '' : String(p[k]).slice(0, attrs.type === 'date' ? 10 : 300), disabled: !editar, onchange: (ev) => guardarT({ [k]: ev.target.value }) }));
      const campos = [];
      if (modo === 'proveedor') {
        const ag = el('select', { disabled: !editar, onchange: (ev) => guardarT({ agencia: ev.target.value }) }, el('option', { value: '' }, '—'),
          Object.entries(d.agencias).map(([k, t]) => el('option', { value: k, selected: k === p.agencia }, t)));
        campos.push(fIn('fecha_entrega', 'Entrega pactada (llega)', { type: 'date' }), el('label', { class: 'cmp-campo' }, el('span', {}, 'Agencia'), ag),
          p.agencia === 'otra' ? fIn('agencia_otra', '¿Cuál?', { maxlength: 80 }) : null, fIn('tracking', 'Nº de seguimiento', { maxlength: 80 }), fIn('fecha_salida', 'Salió el', { type: 'date' }));
      }
      if (modo === 'almacen') {
        const alm = el('select', { disabled: !editar, onchange: (ev) => guardarT({ almacen_id: ev.target.value }) }, el('option', { value: '' }, '— Elige almacén —'),
          d.transportistas.map((t) => t.almacenes.length ? el('optgroup', { label: t.nombre }, t.almacenes.map((a) => el('option', { value: a.id, selected: a.id === p.almacen_id }, a.nombre))) : null));
        campos.push(el('label', { class: 'cmp-campo' }, el('span', {}, 'Entregar en'), alm), fIn('fecha_almacen', 'Entrega en el almacén pactada', { type: 'date' }),
          fIn('fecha_entrega', 'Llega a Menorca (prevista)', { type: 'date' }), fIn('entregado_almacen', 'Entregado en el almacén el', { type: 'date' }), fIn('bultos', 'Bultos', { type: 'number', min: 0 }));
      }
      if (modo === 'recogida') {
        const tr = el('select', { disabled: !editar, onchange: (ev) => guardarT({ transportista_id: ev.target.value }) }, el('option', { value: '' }, '— Transportista —'),
          d.transportistas.map((t) => el('option', { value: t.id, selected: t.id === p.transportista_id }, t.nombre)));
        campos.push(el('label', { class: 'cmp-campo' }, el('span', {}, 'Transportista'), tr), fIn('recogida_fecha', 'Recogida el', { type: 'date' }),
          fIn('recogida_direccion', 'Recoger en (dirección)', { maxlength: 300 }), fIn('recogida_contacto', 'Contacto', { maxlength: 120 }), fIn('recogida_telefono', 'Teléfono', { maxlength: 60 }),
          fIn('recogida_horario', 'Horario', { maxlength: 120 }), fIn('bultos', 'Bultos', { type: 'number', min: 0 }), fIn('kg', 'Kg', { type: 'number', min: 0, step: 'any' }),
          fIn('fecha_entrega', 'Llega a Menorca (prevista)', { type: 'date' }));
      }
      const acc = [];
      if (modo && editar) {
        acc.push(el('button', { type: 'button', class: p.seg_activo ? 'ghost' : 'primario', onclick: async () => {
          try {
            const r = await api('POST', `/api/compras/pedidos/${p.id}/seguimiento`, { activar: !p.seg_activo });
            if (r.url) { try { await navigator.clipboard.writeText(r.url); toast('Seguimiento activado: enlace copiado'); } catch { prompt('Enlace del proveedor:', r.url); } } else toast('Seguimiento parado');
            pintar();
          } catch (e) { toast(e.message, true); }
        } }, p.seg_activo ? '⏹ Parar seguimiento' : '▶ Activar seguimiento'));
        if (p.seg_url) {
          acc.push(el('button', { type: 'button', class: 'ghost', onclick: async () => { try { await navigator.clipboard.writeText(p.seg_url); toast('Enlace copiado'); } catch { prompt('Enlace del proveedor:', p.seg_url); } } }, '🔗 Copiar enlace'));
          if (p.estado === 'enviado') acc.push(el('button', { type: 'button', class: 'ghost', onclick: async () => {
            const para = prompt('Enviar el enlace al correo:', p.proveedor_email || ''); if (!para) return;
            try { await api('POST', `/api/compras/pedidos/${p.id}/seguimiento`, { activar: true, enviar: true, email: para }); toast('Enlace enviado'); pintar(); } catch (e) { toast(e.message, true); }
          } }, '✉ Enviar enlace'));
        }
      }
      if (p.tracking_url) acc.push(el('a', { class: 'boton ghost', href: p.tracking_url, target: '_blank', rel: 'noopener' }, `📦 Seguir en ${d.agencias[p.agencia] || 'la agencia'} ↗`));
      if (p.incidencia_trp_id) acc.push(el('a', { class: 'boton ghost peligro', href: `/incidencias.html?id=${p.incidencia_trp_id}` }, '⚠ Incidencia de transporte'));
      caja.replaceChildren(...[
        el('h3', { class: 'cmp-h3' }, '🚚 Cómo llega'),
        botones,
        modo === 'almacen' && p.almacen ? el('p', { class: 'ayuda' }, `${p.almacen.direccion || ''}${p.almacen.telefono ? ` · ${p.almacen.telefono}` : ''}${p.almacen.leyenda ? ` · en el pedido: «${p.almacen.leyenda}»` : ''} · lo trae ${p.almacen.transportista}`) : null,
        campos.length ? el('div', { class: 'cmp-campos' }, campos.filter(Boolean)) : null,
        p.situacion_trp ? el('p', { class: `trp-sit${p.incidencia_trp_id ? ' mal' : ''}` }, p.situacion_trp) : null,
        p.seg_activo ? el('p', { class: 'ayuda' }, [p.prov_confirmado_en ? `✔ el proveedor confirmó el pedido ${cuando(p.prov_confirmado_en)}` : 'el proveedor aún no ha confirmado', p.seg_visto_en ? `abrió el enlace ${cuando(p.seg_visto_en)}` : null,
          p.estado !== 'enviado' ? 'el enlace irá en el correo y el PDF del pedido' : null].filter(Boolean).join(' · ')) : null,
        acc.length ? el('div', { class: 'cmp-acciones izq' }, acc) : null,
        (p.eventos_trp || []).length ? el('details', { class: 'trp-hist' }, el('summary', {}, `Historial del transporte (${p.eventos_trp.length})`),
          el('ul', {}, p.eventos_trp.map((e) => el('li', {}, e.texto, el('small', {}, ` · ${cuando(e.creado)} · ${e.usuario || e.externo || 'automático'}`))))) : null,
      ].filter(Boolean));
    }).catch((e) => caja.append(el('p', { class: 'ayuda' }, e.message)));
    return caja;
  }

  /* ================= Pedidos ================= */
  async function pintarPedidos() {
    const [d, provs] = await Promise.all([api('GET', '/api/compras/pedidos'), api('GET', '/api/proveedores')]);
    estado.proveedores = provs;
    const grupos = [
      ['por_aprobar', '⏳ Esperando aprobación'], ['aprobado', '✔ Aprobados · por enviar'], ['borrador', '✎ Borradores'], ['enviado', '📤 Enviados (90 días)'],
    ];
    if (!estado.pedido && d.pedidos.length) estado.pedido = (d.pedidos.find((p) => p.estado !== 'enviado') || d.pedidos[0]).id;
    const lista = el('section', { class: 'panel cmp-lista' },
      el('div', { class: 'cab-panel' }, el('h2', {}, 'Pedidos'),
        tiene('compras') ? el('button', { type: 'button', class: 'ghost mini', onclick: nuevoAMano }, '＋ Pedido a mano') : null),
      el('p', { class: 'ayuda' }, 'Los pedidos de material se crean desde ', el('a', { href: '/logistica.html?vista=comprar' }, 'Material de las partidas › Por pedir'), ', marcando las líneas.'),
      d.correo ? null : el('p', { class: 'aviso-coste' }, 'El correo de salida (compras@) aún no está configurado: de momento se descarga el PDF y se envía a mano.'),
      ...grupos.map(([k, t]) => {
        const ps = d.pedidos.filter((p) => p.estado === k);
        if (!ps.length) return null;
        return el('div', { class: 'cmp-grupo' }, el('h3', {}, `${t} `, el('span', { class: 'llv-n' }, String(ps.length))),
          el('ul', {}, ps.map((p) => el('li', {}, el('button', {
            type: 'button', class: `cmp-item${p.id === estado.pedido ? ' actual' : ''}`, onclick: () => { estado.pedido = p.id; guardarURL(); pintar(); },
          }, el('span', { class: 'cmp-item-1' }, el('b', {}, p.codigo), el('span', {}, eur(p.total))),
          el('span', { class: 'cmp-item-2' }, p.proveedor || 'Sin proveedor'),
          el('small', { class: 'ayuda' }, [p.proyectos, `${p.n_lineas} línea${p.n_lineas === 1 ? '' : 's'}`, p.estado === 'enviado' ? `enviado ${cuando(p.enviado_en)}` : `creado ${cuando(p.creado)}`].filter(Boolean).join(' · ')))))));
      }),
      d.pedidos.length ? null : el('p', { class: 'vacio-grande' }, 'Todavía no hay pedidos.'));
    const detalle = el('section', { class: 'panel cmp-detalle' });
    $('#panel-compras').replaceChildren(el('div', { class: 'cmp-dos' }, lista, detalle));
    if (estado.pedido) await pintarPedido(detalle);
    else detalle.append(el('p', { class: 'ayuda' }, 'Elige un pedido de la lista.'));
  }

  async function nuevoAMano() {
    try {
      const p = await api('POST', '/api/compras/pedidos', {});
      estado.pedido = p.id; guardarURL(); pintar();
    } catch (e) { toast(e.message, true); }
  }

  async function pintarPedido(caja) {
    let p;
    try { p = await api('GET', `/api/compras/pedidos/${estado.pedido}`); } catch (e) { caja.replaceChildren(el('p', { class: 'ayuda' }, e.message)); return; }
    const editable = ['borrador', 'por_aprobar'].includes(p.estado) && tiene('compras');
    const telefono = p.por_telefono && p.estado === 'enviado' && tiene('compras');
    const [txtEstado, claseEstado] = ESTADOS[p.estado] || [p.estado, ''];
    const pasos = [['Preparado', true], ['Aprobación', p.necesita_aprobacion ? !!p.aprobado_en : null], ['Enviado', p.estado === 'enviado']];
    // líneas editables
    let lineas = p.lineas.map((l) => ({ ...l }));
    const total = () => lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.precio) || 0), 0);
    const totalEl = el('b', {}, eur(p.total));
    let tGuardar;
    const guardar = (cuerpo, inmediato) => {
      clearTimeout(tGuardar);
      const hacer = async () => {
        try { await api('PUT', `/api/compras/pedidos/${p.id}`, cuerpo()); toast('Guardado'); if (inmediato === 'repintar') pintar(); }
        catch (e) { toast(e.message, true); }
      };
      if (inmediato) hacer(); else tGuardar = setTimeout(hacer, 500);
    };
    const cuerpoLineas = () => ({ lineas: lineas.map((l) => ({ id: l.id, descripcion: l.descripcion, cantidad: l.cantidad, unidad: l.unidad, precio: l.precio })) });
    const tbody = el('tbody');
    const pintarLineas = () => {
      tbody.replaceChildren(...lineas.map((l, i) => {
        const imp = el('td', { class: 'num' }, l.precio == null || l.precio === '' ? '—' : eur((Number(l.cantidad) || 0) * Number(l.precio)));
        const cambia = (k) => (ev) => { l[k] = ev.target.value === '' ? null : ev.target.value; imp.textContent = l.precio == null ? '—' : eur((Number(l.cantidad) || 0) * Number(l.precio)); totalEl.textContent = eur(total()); guardar(cuerpoLineas); };
        return el('tr', {},
          el('td', {}, editable && !l.escandallo_id ? el('input', { value: l.descripcion, 'aria-label': 'Descripción', class: 'cmp-in-desc', oninput: cambia('descripcion') }) : el('span', {}, l.descripcion),
            origenLinea(l, p)),
          el('td', { class: 'num' }, editable ? el('input', { type: 'number', min: '0', step: 'any', value: l.cantidad, class: 'cmp-in-num', 'aria-label': 'Cantidad', oninput: cambia('cantidad') }) : String(l.cantidad).replace('.', ',')),
          el('td', {}, editable && !l.escandallo_id ? el('input', { value: l.unidad || '', class: 'cmp-in-ud', 'aria-label': 'Unidad', oninput: cambia('unidad') }) : (l.unidad || '')),
          el('td', { class: 'num' }, editable ? el('input', { type: 'number', min: '0', step: '0.0001', value: l.precio ?? '', placeholder: '€', class: `cmp-in-num${l.precio == null ? ' falta' : ''}`, 'aria-label': 'Precio unitario', oninput: cambia('precio') })
            // pedido por teléfono: los precios se completan después (a mano o con su confirmación por correo)
            : telefono ? el('input', { type: 'number', min: '0', step: '0.0001', value: l.precio ?? '', placeholder: '€', class: `cmp-in-num${l.precio == null ? ' falta' : ''}`, 'aria-label': 'Precio unitario',
              onchange: async (ev) => { if (ev.target.value === '') return; try { await api('PUT', `/api/compras/pedidos/${p.id}/precios`, { lineas: { [l.id]: Number(ev.target.value) } }); toast('Precio guardado: pasa a la lista de precios'); pintar(); } catch (e) { toast(e.message, true); } } })
              : eur(l.precio)),
          imp,
          el('td', {}, editable ? el('button', { type: 'button', class: 'ghost mini', 'aria-label': `Quitar ${l.descripcion}`, title: 'Quitar del pedido (vuelve a «Por pedir»)',
            onclick: () => { lineas.splice(i, 1); pintarLineas(); totalEl.textContent = eur(total()); guardar(cuerpoLineas, 'repintar'); } }, '✕') : null));
      }));
    };
    pintarLineas();
    const campo = (k, txt, input) => el('label', { class: 'cmp-campo' }, el('span', {}, txt), input);
    const inCampo = (k, attrs = {}) => {
      const i = el(attrs.tag || 'input', { ...attrs, tag: null, value: p[k] ?? '', disabled: !editable });
      i.addEventListener('change', () => guardar(() => ({ [k]: i.value }), true));
      return i;
    };
    const selProv = el('select', { disabled: !editable, 'aria-label': 'Proveedor' }, el('option', { value: '' }, '— Elige proveedor —'),
      estado.proveedores.filter((x) => x.activo || x.id === p.proveedor_id).map((x) => el('option', { value: x.id, selected: x.id === p.proveedor_id }, x.nombre)));
    selProv.addEventListener('change', () => guardar(() => ({ proveedor_id: selProv.value || null }), 'repintar'));
    const prov = estado.proveedores.find((x) => x.id === p.proveedor_id);

    const acciones = [];
    acciones.push(el('a', { class: 'boton ghost', href: `/api/compras/pedidos/${p.id}/pdf`, target: '_blank', rel: 'noopener' }, '📄 Ver PDF'));
    if (editable) acciones.push(el('button', { type: 'button', class: 'ghost peligro', onclick: () => borrar(p) }, 'Borrar'));
    if (p.estado === 'enviado' && tiene('compras')) acciones.push(el('button', { type: 'button', class: 'ghost peligro', onclick: () => anular(p), title: 'Lo que no ha llegado vuelve a «Por pedir»' }, '✕ Anular pedido'));
    if (p.estado === 'borrador' && tiene('compras')) {
      if (p.necesita_aprobacion && !p.aprobado_en) acciones.push(el('button', { type: 'button', class: 'primario', onclick: () => accion(p, 'aprobacion', 'Enviado a Dirección para aprobar') }, '⏳ Pedir aprobación'));
      else acciones.push(el('button', { type: 'button', class: 'primario', onclick: () => dialogoEnviar(p, prov) }, '📤 Enviar al proveedor…'));
    }
    if (p.estado === 'aprobado' && tiene('compras')) acciones.push(el('button', { type: 'button', class: 'primario', onclick: () => dialogoEnviar(p, prov) }, '📤 Enviar al proveedor…'));
    if (['por_aprobar', 'borrador'].includes(p.estado) && tiene('aprobar_compras') && p.necesita_aprobacion) {
      acciones.push(el('button', { type: 'button', class: 'ghost', onclick: () => rechazar(p) }, '✗ No aprobar'));
      acciones.push(el('button', { type: 'button', class: 'primario', onclick: () => accion(p, 'aprobar', 'Aprobado') }, '✔ Aprobar'));
    }

    caja.replaceChildren(...[
      el('div', { class: 'cab-panel' },
        el('div', {}, el('h2', {}, `Pedido ${p.codigo}`), el('p', { class: 'ayuda', style: 'margin:2px 0 0' },
          [`Preparado por ${p.creado_por_nombre || '—'} el ${cuando(p.creado)}`, p.aprobado_en && `aprobado por ${p.aprobado_por_nombre} el ${cuando(p.aprobado_en)}`,
            p.enviado_en && `enviado por ${p.enviado_por_nombre} el ${cuando(p.enviado_en)}${p.enviado_correo ? ` a ${p.enviado_a}` : ' (a mano)'}`].filter(Boolean).join(' · '))),
        el('span', { class: `cmp-estado ${claseEstado}` }, txtEstado)),
      el('ol', { class: 'cmp-pasos' }, pasos.filter(([, v]) => v !== null).map(([t, v], i, arr) => el('li', { class: v ? 'hecho' : arr.findIndex(([, x]) => !x) === i ? 'ahora' : '' }, el('i', {}, v ? '✓' : String(i + 1)), t))),
      p.rechazo ? el('p', { class: 'aviso-coste' }, `✗ Dirección no lo aprobó: ${p.rechazo}`) : null,
      p.estado === 'anulado' ? el('p', { class: 'aviso-coste' }, `✕ Anulado el ${cuando(p.anulado_en)}${p.anulado_motivo ? `: ${p.anulado_motivo}` : ''}`) : null,
      p.por_telefono ? el('p', { class: `cmp-tel${p.prov_confirmado_en ? ' ok' : ''}` }, '📞 Pedido por teléfono',
        p.prov_num_confirmacion ? ` · su nº ${p.prov_num_confirmacion}` : '',
        p.prov_confirmado_en ? ` · ✔ confirmado ${cuando(p.prov_confirmado_en)}` : ' · esperando su confirmación por correo (compras@): la IA la lee y completa precios, su nº y la fecha. Si no llega, apunta aquí los precios.',
        p.lineas.some((l) => l.precio == null) ? el('b', {}, ` · faltan ${p.lineas.filter((l) => l.precio == null).length} precio(s)`) : null) : null,
      (p.albaranes || []).length ? el('p', { class: 'ayuda' }, '📦 Albarán: ', p.albaranes.map((a) => el('a', { href: `/api/archivos/${a.id}`, target: '_blank', rel: 'noopener' }, `${a.nombre || 'albarán'} `))) : null,
      el('div', { class: 'cmp-campos' },
        campo('proveedor_id', 'Proveedor', selProv),
        campo('fecha_entrega', 'Entrega el', inCampo('fecha_entrega', { type: 'date' })),
        campo('entregar_en', 'Entregar en', inCampo('entregar_en', { maxlength: 300 })),
        campo('referencia', 'Referencia (obra / proyecto)', inCampo('referencia', { maxlength: 300 })),
        campo('forma_pago', 'Forma de pago', inCampo('forma_pago', { maxlength: 120, placeholder: prov?.forma_pago || '' })),
        campo('observaciones', 'Observaciones para el proveedor', inCampo('observaciones', { tag: 'textarea', rows: 2, maxlength: 3000 }))),
      el('div', { class: 'tabla-scroll' }, el('table', { class: 'tabla-inf cmp-tabla' },
        el('thead', {}, el('tr', {}, el('th', {}, p.tipo === 'subcontratacion' ? 'Trabajo' : 'Material'), el('th', { class: 'num' }, 'Cantidad'), el('th', {}, 'Ud.'), el('th', { class: 'num' }, 'Precio'), el('th', { class: 'num' }, 'Importe'), el('th', {}))),
        tbody,
        el('tfoot', {}, el('tr', { class: 'fila-total' }, el('td', { colspan: '4' }, 'Total (sin IVA)'), el('td', { class: 'num' }, totalEl), el('td', {}))))),
      editable ? el('button', { type: 'button', class: 'ghost mini', onclick: () => { lineas.push({ descripcion: 'Nueva línea', cantidad: 1, unidad: 'ud', precio: null }); guardar(cuerpoLineas, 'repintar'); } }, '＋ Línea a mano') : null,
      p.necesita_aprobacion && !p.aprobado_en ? el('p', { class: 'aviso-coste' }, `Pasa de ${eur(p.limite)}: necesita la aprobación de Dirección antes de enviarlo.`) : null,
      seccionTransporte(p),
      el('div', { class: 'cmp-acciones' }, acciones)].filter(Boolean));
  }

  async function accion(p, que, ok) {
    try { await api('POST', `/api/compras/pedidos/${p.id}/${que}`, {}); toast(ok); pintar(); } catch (e) { toast(e.message, true); }
  }
  function anular(p) {
    const motivo = el('textarea', { rows: 3, maxlength: 500, 'aria-label': 'Motivo' });
    const d = el('dialog', { class: 'dlg-cos' }, el('h2', {}, `Anular ${p.codigo}`),
      el('p', { class: 'ayuda' }, 'Lo que no ha llegado vuelve a «Por pedir» y logística deja de esperarlo. Lo ya recibido se queda. Avisa tú al proveedor si hace falta.'),
      motivo,
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario peligro', onclick: async () => {
          try { const r = await api('POST', `/api/compras/pedidos/${p.id}/anular`, { motivo: motivo.value }); d.close(); toast(`Anulado: ${r.vuelven} línea(s) vuelven a «Por pedir»`); pintar(); } catch (e) { toast(e.message, true); }
        } }, '✕ Anular pedido')));
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal(); motivo.focus();
  }
  async function borrar(p) {
    if (!confirm(`¿Borrar el pedido ${p.codigo}? Sus líneas de material vuelven a «Por pedir».`)) return;
    try { await api('DELETE', `/api/compras/pedidos/${p.id}`); estado.pedido = null; guardarURL(); toast('Pedido borrado'); pintar(); } catch (e) { toast(e.message, true); }
  }
  function rechazar(p) {
    const motivo = el('textarea', { rows: 3, maxlength: 500, 'aria-label': 'Motivo' });
    const d = el('dialog', { class: 'dlg-cos' }, el('h2', {}, `No aprobar ${p.codigo}`), el('p', { class: 'ayuda' }, 'Vuelve a borrador y quien lo preparó recibe el motivo.'),
      motivo,
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          try { await api('POST', `/api/compras/pedidos/${p.id}/rechazar`, { motivo: motivo.value }); d.close(); toast('Devuelto con el motivo'); pintar(); } catch (e) { toast(e.message, true); }
        } }, 'No aprobar')));
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal(); motivo.focus();
  }

  // proyectos de las líneas de un documento (trazabilidad: van en el asunto y en el texto)
  const proyectosDe = (ls) => [...new Set((ls || []).map((l) => l.proyecto_codigo || l.proyecto_tarea).filter(Boolean))];
  function dialogoEnviar(p, prov) {
    const aj = estado.ajustes || {};
    const faltan = proyectosDe(p.lineas).filter((c) => !String(p.referencia || '').includes(c));
    const para = el('input', { type: 'email', value: prov?.email || '', 'aria-label': 'Para' });
    const cc = el('input', { type: 'text', value: '', placeholder: 'opcional', 'aria-label': 'Copia' });
    const asunto = el('input', { value: `Pedido ${p.codigo} · ${aj.empresa?.nombre || 'HAM Menorca'}${p.referencia ? ` · ${p.referencia}` : ''}${faltan.length ? ` · ${faltan.join(', ')}` : ''}`, 'aria-label': 'Asunto' });
    const texto = el('textarea', { rows: 6, 'aria-label': 'Texto del correo' });
    texto.value = `Buenos días:\n\nLes adjuntamos el pedido ${p.codigo}${p.fecha_entrega ? ` con entrega el ${new Date(`${p.fecha_entrega}T12:00:00`).toLocaleDateString('es-ES')}` : ''}.\n${proyectosDe(p.lineas).length ? `Proyecto: ${proyectosDe(p.lineas).join(', ')}.\n` : ''}Por favor, confirmen la recepción y la fecha de entrega, e indiquen el nº de pedido${proyectosDe(p.lineas).length ? ' y el del proyecto' : ''} en el albarán y la factura.\n\nUn saludo,\n${aj.empresa?.nombre || 'HAM Menorca'}`;
    const enviar = async (porCorreo) => {
      try {
        await api('POST', `/api/compras/pedidos/${p.id}/enviar`, porCorreo ? { correo: true, para: para.value, cc: cc.value, asunto: asunto.value, texto: texto.value } : { correo: false });
        d.close(); toast(porCorreo ? `Enviado a ${para.value}; logística ya lo ve como pedido` : 'Marcado como enviado; logística ya lo ve como pedido'); pintar();
      } catch (e) { toast(e.message, true); }
    };
    const d = el('dialog', { class: 'dlg-cos dlg-enviar' },
      el('h2', {}, `Enviar ${p.codigo} a ${p.proveedor || '—'}`),
      aj.correo ? el('div', { class: 'cmp-correo' },
        el('label', { class: 'cmp-campo' }, el('span', {}, 'De'), el('input', { value: aj.remitente || '', disabled: true })),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Para'), para),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Copia'), cc),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Asunto'), asunto),
        texto,
        el('p', { class: 'ayuda' }, '📎 ', el('a', { href: `/api/compras/pedidos/${p.id}/pdf`, target: '_blank', rel: 'noopener' }, `${p.codigo}.pdf`), ` · total ${eur(p.total)} + IVA`))
        : el('p', { class: 'aviso-coste' }, 'El correo de salida aún no está configurado. ', el('a', { href: `/api/compras/pedidos/${p.id}/pdf`, target: '_blank', rel: 'noopener' }, 'Descarga el PDF'), ', envíalo tú y márcalo como enviado.'),
      el('p', { class: 'ayuda' }, 'Al enviarlo, sus líneas de material pasan a «Pedido · por recibir» con este proveedor, fecha, nº de pedido y precio.'),
      el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: aj.correo ? 'ghost' : 'primario', onclick: () => enviar(false) }, 'Ya lo he enviado yo'),
        aj.correo ? el('button', { type: 'button', class: 'primario', onclick: () => enviar(true) }, '📤 Enviar por correo') : null));
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal();
  }

  /* ================= Peticiones de precio ================= */
  const EST_SP = { pendiente: ['Sin enviar', ''], enviada: ['Esperando oferta', 'aviso'], respondida: ['Oferta recibida', 'ok'], no_oferta: ['No oferta', ''] };
  async function pintarSolicitudes() {
    const lista = await api('GET', '/api/compras/solicitudes');
    if (!estado.sol && lista.length) estado.sol = lista[0].id;
    const izq = el('section', { class: 'panel cmp-lista' },
      el('div', { class: 'cab-panel' }, el('h2', {}, 'Peticiones de precio')),
      el('p', { class: 'ayuda' }, 'Se crean desde ', el('a', { href: '/logistica.html?vista=comprar' }, 'Material de las partidas › Por pedir'), ': marca las líneas y pulsa «✉ Pedir precio».'),
      ...[['abierta', '✉ Abiertas'], ['cerrada', '✔ Cerradas (90 días)']].map(([k, t]) => {
        const ss = lista.filter((x) => x.estado === k);
        if (!ss.length) return null;
        return el('div', { class: 'cmp-grupo' }, el('h3', {}, `${t} `, el('span', { class: 'llv-n' }, String(ss.length))),
          el('ul', {}, ss.map((x) => el('li', {}, el('button', { type: 'button', class: `cmp-item${x.id === estado.sol ? ' actual' : ''}`, onclick: () => { estado.sol = x.id; guardarURL(); pintar(); } },
            el('span', { class: 'cmp-item-1' }, el('b', {}, x.codigo), el('span', { class: x.n_resp < x.n_prov && k === 'abierta' ? 'ayuda' : '' }, `${x.n_resp} de ${x.n_prov} ofertas`)),
            el('small', { class: 'ayuda' }, [x.proyectos, `${x.n_lineas} línea${x.n_lineas === 1 ? '' : 's'}`, x.responder_antes && k === 'abierta' ? `responder antes del ${fecha(x.responder_antes)}` : `creada ${cuando(x.creado)}`].filter(Boolean).join(' · ')))))));
      }),
      lista.length ? null : el('p', { class: 'vacio-grande' }, 'Todavía no hay peticiones de precio.'));
    const der = el('section', { class: 'panel cmp-detalle' });
    $('#panel-compras').replaceChildren(el('div', { class: 'cmp-dos' }, izq, der));
    if (estado.sol) await pintarSolicitud(der);
    else der.append(el('p', { class: 'ayuda' }, 'Elige una petición de la lista.'));
  }

  async function pintarSolicitud(caja) {
    let s;
    try { s = await api('GET', `/api/compras/solicitudes/${estado.sol}`); } catch (e) { caja.replaceChildren(el('p', { class: 'ayuda' }, e.message)); return; }
    if (!estado.proveedores.length) estado.proveedores = await api('GET', '/api/proveedores');
    const abierta = s.estado === 'abierta' && tiene('compras');
    const recargar = () => pintar();
    const hacer = async (fn, ok) => { try { await fn(); if (ok) toast(ok); recargar(); } catch (e) { toast(e.message, true); } };
    // mejor precio por línea entre los que llegan a tiempo (si se sabe la fecha)
    const llega = (p, l) => { const nec = l.necesaria || s.necesario_el; return !nec || !p.fecha_entrega ? null : p.fecha_entrega <= nec; };
    const mejor = new Map();
    for (const l of s.lineas) {
      const ofs = s.proveedores.filter((p) => p.precios[l.id] != null);
      const aTiempo = ofs.filter((p) => llega(p, l) !== false);
      const base = aTiempo.length ? aTiempo : ofs;
      if (base.length) mejor.set(l.id, base.reduce((a, b) => (b.precios[l.id] < a.precios[l.id] ? b : a)).id);
    }
    const elegido = Object.fromEntries(s.lineas.map((l) => [l.id, l.elegido]));
    const guardarEleccion = async () => { try { await api('PUT', `/api/compras/solicitudes/${s.id}/elegir`, { elegido }); toast('Guardado'); } catch (e) { toast(e.message, true); } };
    const totalProv = (p) => s.lineas.reduce((t, l) => t + (elegido[l.id] === p.id ? l.cantidad * (p.precios[l.id] || 0) : 0), 0) + (s.lineas.some((l) => elegido[l.id] === p.id) ? (p.portes || 0) : 0);
    const pies = new Map();
    const actualizarPies = () => { for (const p of s.proveedores) pies.get(p.id).textContent = eur(totalProv(p)); };

    const cab = el('tr', {}, el('th', {}, 'Material'), el('th', { class: 'num' }, 'Cantidad'),
      ...s.proveedores.map((p) => {
        const t = s.lineas.length && p.fecha_entrega ? s.lineas.every((l) => llega(p, l) !== false) : null;
        return el('th', { class: 'cmp-col-prov' }, el('b', {}, p.proveedor),
          el('div', { class: 'sub' }, p.estado === 'respondida' ? [p.ref_oferta ? `oferta ${p.ref_oferta} · ` : '', p.dias_trabajo || p.personas || p.inicio_posible ? `${p.dias_trabajo ? `${String(Number(p.dias_trabajo)).replace('.', ',')} días` : ''}${p.personas ? ` · ${p.personas} pers.` : ''}${p.inicio_posible ? ` · desde ${fecha(String(p.inicio_posible).slice(0, 10))}` : ''} · ` : '', p.fecha_entrega ? `llega ${fecha(p.fecha_entrega)} ` : (p.inicio_posible ? '' : 'sin fecha '), t === true ? el('span', { class: 'pos' }, '✓ a tiempo') : t === false ? el('span', { class: 'neg' }, '⚠ tarde') : null] : (EST_SP[p.estado] || [p.estado])[0]));
      }), el('th', { class: 'cmp-col-no' }, el('b', {}, 'No pedir'), el('div', { class: 'sub' }, 'vuelve a «Por pedir»')));
    const filas = s.lineas.map((l) => el('tr', {},
      el('td', {}, l.descripcion, el('div', { class: 'sub' }, [l.proyecto_codigo, l.partida_codigo, l.necesaria ? `hace falta ${fecha(l.necesaria)}` : null].filter(Boolean).join(' · '))),
      el('td', { class: 'num' }, `${String(l.cantidad).replace('.', ',')} ${l.unidad || ''}`),
      ...s.proveedores.map((p) => {
        const pr = p.precios[l.id];
        const inf = (p.lineas_info || {})[l.id] || {};
        const alt = inf.alt ? el('div', { class: 'sub cmp-alt' }, `↔ Alternativa: ${inf.alt}`) : null;
        if (pr == null) return el('td', { class: 'sub' }, inf.no ? 'No lo tiene' : p.estado === 'respondida' || p.estado === 'no_oferta' ? 'No la oferta' : '—', alt);
        const radio = el('input', { type: 'radio', name: `l${l.id}`, checked: elegido[l.id] === p.id, disabled: !abierta, 'aria-label': `Elegir ${p.proveedor} para ${l.descripcion}`,
          onchange: () => { elegido[l.id] = p.id; actualizarPies(); guardarEleccion(); pintarSel(); } });
        return el('td', { class: `cmp-oferta${mejor.get(l.id) === p.id ? ' mejor' : ''}`, 'data-l': l.id, 'data-p': p.id },
          el('label', {}, radio, el('span', {}, el('b', {}, eur(pr)), ` /${l.unidad || 'ud'}`,
            p.cotizados?.[l.id] ? el('span', { class: 'cmp-cot', title: l.equiv ? `Convertido con ${l.equiv}` : null }, `cotizó ${eur(p.cotizados[l.id].precio)}/${p.cotizados[l.id].unidad}`) : null,
            el('div', { class: 'sub' }, `total ${eur(pr * l.cantidad)}${mejor.get(l.id) === p.id ? ' · mejor' : ''}`), alt)));
      }),
      // quitar la línea de esta compra: no se pide a nadie y vuelve a «Por pedir» al crear los pedidos
      el('td', { class: 'cmp-oferta cmp-no', 'data-l': l.id, 'data-p': '0' },
        el('label', {}, el('input', { type: 'radio', name: `l${l.id}`, checked: !elegido[l.id], disabled: !abierta, 'aria-label': `No pedir ${l.descripcion}`,
          onchange: () => { elegido[l.id] = null; actualizarPies(); guardarEleccion(); pintarSel(); } }), el('span', {}, 'No pedir')))));
    const pintarSel = () => { for (const td of caja.querySelectorAll('.cmp-oferta')) td.classList.toggle('sel', (elegido[td.dataset.l] || 0) === Number(td.dataset.p)); };
    const pie = el('tr', { class: 'fila-total' }, el('td', { colspan: '2' }, 'Total elegido (con portes)'),
      ...s.proveedores.map((p) => { const t = el('b'); pies.set(p.id, t); return el('td', {}, t, p.portes ? el('div', { class: 'sub' }, `portes ${eur(p.portes)}`) : null); }), el('td'));

    const tarjetaProv = (p) => {
      const [txt, cls] = EST_SP[p.estado] || [p.estado, ''];
      return el('div', { class: 'cmp-prov' },
        el('div', { class: 'cmp-item-1' }, el('b', {}, p.proveedor), el('span', { class: `cmp-estado ${cls}` }, txt)),
        el('small', { class: 'ayuda' }, [p.enviado_en ? `enviada ${cuando(p.enviado_en)}${p.enviado_correo ? ` a ${p.enviado_a}` : ' (a mano)'}` : null, p.recordado_en ? `recordada ${cuando(p.recordado_en)}` : null,
          p.portal_respondido_en ? `🌐 respondió en la plataforma ${cuando(p.portal_respondido_en)}` : p.respondido_en ? `respondió ${cuando(p.respondido_en)}` : p.portal_visto_en ? `👁 abrió el enlace ${cuando(p.portal_visto_en)}` : null].filter(Boolean).join(' · ') || (p.email || 'sin email en su ficha')),
        p.correo_id ? el('a', { href: `/correo.html?vista=todos&id=${p.correo_id}`, class: 'ayuda' }, '📧 Llegó por correo o PDF del portal (leída por la IA y revisada) · ver') : null,
        p.portal_pdf_en && !p.respondido_en ? el('a', { href: '/correo.html', class: 'ayuda', style: 'color:#f0b060' }, `🌐 Envió su PDF por el portal ${cuando(p.portal_pdf_en)}: la IA lo ha leído, falta revisarlo en Correo entrante`) : null,
        p.contacto ? el('small', { class: 'ayuda' }, `Contacto: ${p.contacto}`) : null,
        p.notas && p.portal_respondido_en ? el('small', { class: 'ayuda', style: 'white-space:pre-wrap' }, `«${p.notas}»`) : null,
        p.archivos.length ? el('div', {}, p.archivos.map((a) => el('a', { href: `/api/archivos/${a.id}`, target: '_blank', rel: 'noopener', class: 'ayuda' }, `📎 ${a.nombre || 'oferta'} `))) : null,
        p.enviado_en || p.n_correos || p.portal_visto_en ? el('button', { type: 'button', class: `ghost mini cmp-conv${p.n_revisar ? ' pend' : ''}`, title: 'Todo lo hablado con el proveedor: lo enviado, sus respuestas por correo y lo que hizo en el portal',
          onclick: () => conversacion(s, p) }, `💬 Conversación${p.n_correos ? ` (${p.n_correos})` : ''}${p.n_revisar ? ' · por revisar' : ''}`) : null,
        abierta ? el('div', { class: 'cmp-prov-acc' },
          el('button', { type: 'button', class: 'ghost mini', onclick: () => dialogoEnviarSol(s, p) }, p.enviado_en ? '🔔 Recordar' : '📤 Enviar'),
          p.correo_revisar_id
            ? el('button', { type: 'button', class: 'primario mini cmp-ia', title: 'Ha respondido y la IA ya ha leído su oferta: revísala y confírmala', onclick: () => dialogoOferta(s, p, p.correo_revisar_id) }, '🤖 Revisar oferta recibida')
            : el('button', { type: 'button', class: p.estado === 'enviada' ? 'primario mini' : 'ghost mini', onclick: () => dialogoOferta(s, p) }, '✎ Apuntar oferta'),
          el('button', { type: 'button', class: 'ghost mini', title: 'Enlace para que el proveedor ponga sus precios en la plataforma', onclick: () => copiarEnlace(s, p) }, '🔗 Enlace'),
          el('button', { type: 'button', class: 'ghost mini', 'aria-label': `Quitar ${p.proveedor}`, onclick: () => { if (confirm(`¿Quitar a ${p.proveedor} de esta petición?`)) hacer(() => api('DELETE', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}`)); } }, '✕')) : null);
    };
    const yaEstan = new Set(s.proveedores.map((p) => p.proveedor_id));
    const selAdd = el('select', { 'aria-label': 'Añadir proveedor' }, el('option', { value: '' }, '＋ Añadir proveedor…'),
      estado.proveedores.filter((x) => x.activo && !yaEstan.has(x.id)).map((x) => el('option', { value: x.id }, x.nombre)));
    selAdd.addEventListener('change', () => selAdd.value && hacer(() => api('POST', `/api/compras/solicitudes/${s.id}/proveedores`, { proveedor_id: selAdd.value })));
    const nElegidas = s.lineas.filter((l) => l.elegido).length;
    const inFecha = (k, txt) => { const i = el('input', { type: 'date', value: s[k] || '', disabled: !abierta }); i.addEventListener('change', () => hacer(() => api('PUT', `/api/compras/solicitudes/${s.id}`, { [k]: i.value }), 'Guardado')); return el('label', { class: 'cmp-campo' }, el('span', {}, txt), i); };

    // enlace de un aviso: …&conv=<sp> abre la conversación con ese proveedor
    const convQ = Number(new URLSearchParams(location.search).get('conv'));
    if (convQ && !window.__convAbierta) { const pc = s.proveedores.find((x) => x.id === convQ); if (pc) { window.__convAbierta = true; setTimeout(() => conversacion(s, pc), 200); } }
    caja.replaceChildren(...[
      el('div', { class: 'cab-panel' },
        el('div', {}, el('h2', {}, `Petición ${s.codigo}`), el('p', { class: 'ayuda', style: 'margin:2px 0 0' }, `Creada por ${s.creado_por_nombre || '—'} el ${cuando(s.creado)}${s.cerrado_en ? ` · ${s.estado} el ${cuando(s.cerrado_en)}` : ''}`)),
        el('span', { class: `cmp-estado ${s.estado === 'abierta' ? 'aviso' : ''}` }, { abierta: 'Abierta', cerrada: 'Cerrada · pedidos creados', anulada: 'Anulada' }[s.estado])),
      el('div', { class: 'cmp-campos' }, inFecha('responder_antes', 'Responder antes del'), inFecha('necesario_el', 'Lo necesitamos el')),
      el('h3', { class: 'cmp-h3' }, 'Proveedores'),
      el('div', { class: 'cmp-provs-sol' }, s.proveedores.map(tarjetaProv), abierta ? selAdd : null),
      el('h3', { class: 'cmp-h3' }, 'Comparar y elegir'),
      el('p', { class: 'ayuda' }, 'Marca qué proveedor se queda cada línea, o «No pedir» para dejarla fuera (vuelve a «Por pedir»). En verde, lo más barato que llega a tiempo.'),
      el('div', { class: 'tabla-scroll' }, el('table', { class: 'tabla-inf cmp-comp' }, el('thead', {}, cab), el('tbody', {}, filas), el('tfoot', {}, pie))),
      abierta ? el('div', { class: 'cmp-acciones' },
        el('a', { class: 'boton ghost', href: `/api/compras/solicitudes/${s.id}/pdf`, target: '_blank', rel: 'noopener' }, '📄 PDF de la petición'),
        el('button', { type: 'button', class: 'ghost peligro', title: 'Cancela esta petición de precio sin pedir nada: todas sus líneas vuelven a «Por pedir» y los enlaces de los proveedores dejan de admitir cambios',
          onclick: () => { if (confirm(`¿Anular la petición ${s.codigo} sin pedir nada?\n\nTodas sus líneas vuelven a «Por pedir» y los proveedores ya no podrán cambiar su oferta. Las ofertas recibidas se conservan para consulta.`)) hacer(() => api('DELETE', `/api/compras/solicitudes/${s.id}`), 'Petición anulada'); } }, '✕ Anular petición'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          const n = new Set(s.lineas.filter((l) => elegido[l.id]).map((l) => elegido[l.id])).size;
          if (!n) { toast('Elige proveedor en alguna línea', true); return; }
          const sinElegir = s.lineas.filter((l) => !elegido[l.id]).length;
          if (!confirm(`Se crearán ${n} pedido${n === 1 ? '' : 's'} con los precios de las ofertas.${sinElegir ? ` ${sinElegir} línea(s) sin elegir vuelven a «Por pedir».` : ''} ¿Seguir?`)) return;
          try { const r = await api('POST', `/api/compras/solicitudes/${s.id}/pedidos`, {}); toast(`${r.pedidos.length} pedido(s) creados`); estado.vista = 'pedidos'; estado.pedido = r.pedidos[0]; guardarURL(); pintar(); }
          catch (e) { toast(e.message, true); }
        } }, `🛒 Crear pedidos${nElegidas ? '' : ''}`)) : null].filter(Boolean));
    actualizarPies(); pintarSel();
  }

  // «habitual 0,22 € · Proveedor · 12/10» (lista de precios; en naranja si tiene más de 3 meses)
  function habitual(h, unidad) {
    if (!h) return null;
    return el('div', { class: `cmp-hab${h.viejo ? ' viejo' : ''}`, title: `Último precio confirmado en el sistema (${h.origen})${h.viejo ? ` · tiene ${h.dias} días` : ''}` },
      `💶 habitual ${Number(h.precio).toLocaleString('es-ES', { maximumFractionDigits: 4 })} €/${h.unidad || unidad || 'ud'} · ${h.proveedor || '—'} · ${new Date(h.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })}`);
  }

  // correoId: la oferta que ha leído la IA (de un correo o de su PDF en el portal): el cuadro sale relleno y con el original al lado
  async function dialogoOferta(s, p, correoId) {
    let co = null;
    if (correoId) { try { co = await api('GET', `/api/correo/${correoId}`); } catch (e) { toast(e.message, true); return; } }
    const o = co?.extraccion?.oferta || null;
    const ia = o ? Object.fromEntries((o.lineas || []).map((l) => [l.linea_id, l])) : {};
    const ins = new Map(); const uds = new Map();
    const fEnt = el('input', { type: 'date', value: (o ? o.fecha_entrega : p.fecha_entrega) || '' });
    const portes = el('input', { type: 'number', min: '0', step: '0.01', value: (o ? o.portes : p.portes) ?? '', placeholder: '0 = pagados' });
    const ref = el('input', { value: (o ? o.ref_oferta : p.ref_oferta) || '', maxlength: 80, placeholder: 'nº de su oferta' });
    const notas = el('textarea', { rows: 2, maxlength: 1000 });
    notas.value = o ? [o.notas, o.validez && `Validez: ${o.validez.split('-').reverse().join('/')}`, o.forma_pago && `Pago: ${o.forma_pago}`, o.plazo_texto && `Plazo: ${o.plazo_texto}`].filter(Boolean).join('\n') : p.notas || '';
    const subidos = []; const nombre = el('span', { class: 'ayuda' });
    const file = el('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true, onchange: async () => {
      const f = file.files[0]; if (!f) return;
      try { toast('Subiendo…'); subidos.push(await window.s360.subirArchivo(f)); nombre.textContent = ` ${f.name}`; toast('Listo: se guarda al guardar la oferta'); } catch (e) { toast(e.message, true); }
    } });
    const confirmarIA = async (noOferta) => {
      const lineas = Object.fromEntries([...ins].map(([k, i]) => [k, { precio: i.value === '' ? null : Number(i.value), unidad: uds.get(k)?.value || null, no: !!ia[k]?.no && i.value === '', alt: ia[k]?.alt || null }]));
      try {
        await api('POST', `/api/correo/${co.id}/confirmar-oferta`, { sp_id: p.id, lineas, no_oferta: !!noOferta, fecha_entrega: fEnt.value || null, portes: portes.value === '' ? null : Number(portes.value), ref_oferta: ref.value, notas: notas.value, adjuntar: true });
        if (subidos.length) await api('PUT', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}`, { archivos: subidos }).catch(() => {});
        d.close(); toast(noOferta ? 'Apuntado: no oferta' : 'Oferta confirmada: ya está en el comparativo'); pintar();
      } catch (e) { toast(e.message, true); }
    };
    // el original (su correo sin lo citado, o su PDF) al lado
    const original = co ? (() => {
      const pdf = co.adjuntos.find((a) => a.tipo === 'application/pdf') || co.adjuntos.find((a) => /^image\//.test(a.tipo));
      return el('div', { class: 'dlg-oferta-orig' },
        el('div', { class: 'ayuda' }, `${co.origen === 'portal' ? '🌐 Su PDF del portal' : `📧 ${co.de_nombre || co.de_email} · ${new Date(co.fecha).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`}`),
        co.origen !== 'portal' && co.texto ? textoCorreo(co.texto) : null,
        pdf ? (/^image\//.test(pdf.tipo) ? el('img', { src: `/api/correo/adjuntos/${pdf.id}`, alt: pdf.nombre, class: 'dlg-oferta-pdf' }) : el('iframe', { src: `/api/correo/adjuntos/${pdf.id}#view=FitH`, title: pdf.nombre, class: 'dlg-oferta-pdf' })) : null,
        co.adjuntos.filter((a) => a !== pdf).map((a) => el('a', { href: `/api/correo/adjuntos/${a.id}`, target: '_blank', rel: 'noopener', class: 'ayuda' }, `📎 ${a.nombre} `)));
    })() : null;
    const d = el('dialog', { class: `dlg-cos dlg-oferta${co ? ' con-original' : ''}` },
      el('h2', {}, co && o ? `🤖 Oferta de ${p.proveedor} · leída por la IA` : `Oferta de ${p.proveedor}`),
      co && !o ? el('p', { class: 'ayuda' }, 'Apunta los precios mirando su correo o su PDF (a la derecha). Al confirmar, entra en el comparativo y el correo queda resuelto.') : null,
      co && o ? el('div', { class: 'cmp-ia-caja' }, el('b', {}, '🤖 '), co.resumen || 'La IA ha leído su respuesta.', (co.alertas || []).length ? el('ul', {}, co.alertas.map((a) => el('li', {}, `⚠ ${a}`))) : null,
        el('div', { class: 'ayuda' }, 'Comprueba con el original (a la derecha) y corrige lo que haga falta. Hasta que confirmes, no entra en el comparativo.')) : null,
      el('p', { class: 'ayuda' }, 'Precio unitario de cada línea (sin IVA). Deja vacío lo que no oferta.'),
      el('table', { class: 'tabla-inf' }, el('tbody', {}, s.lineas.map((l) => {
        const x = ia[l.id];
        const ops = l.unidades || [{ u: l.unidad || 'ud', a_linea: 1 }];
        // si lo cotizó en otra unidad (€/kg, €/barra…) se apunta tal cual y se convierte con el peso y el largo del material
        const cot = o ? (x?.precio_cotizado != null && ops.some((u) => u.u === x.unidad_cotizada) ? { precio: x.precio_cotizado, unidad: x.unidad_cotizada } : null) : p.cotizados?.[l.id];
        const ini = cot && ops.some((u) => u.u === cot.unidad) ? cot : { precio: o ? x?.precio : p.precios[l.id], unidad: ops[0].u };
        const i = el('input', { type: 'number', min: '0', step: '0.0001', value: ini.precio ?? '', 'aria-label': `Precio de ${l.descripcion}`, class: `cmp-in-num${o && x?.precio == null && !x?.no ? ' cmp-falta' : ''}` });
        ins.set(l.id, i);
        let celda = [i, ` €/${l.unidad || 'ud'}`];
        if (ops.length > 1) {
          const sel = el('select', { class: 'cmp-u', 'aria-label': `Unidad del precio de ${l.descripcion}` }, ops.map((u) => el('option', { value: u.u, selected: u.u === ini.unidad }, `€/${u.u}`)));
          uds.set(l.id, sel);
          const eq = el('div', { class: 'sub' });
          const ver = () => {
            const f = ops.find((u) => u.u === sel.value)?.a_linea ?? 1; const v = i.value === '' ? null : Number(i.value);
            eq.textContent = f !== 1 && v != null ? `= ${(v * f).toLocaleString('es-ES', { maximumFractionDigits: 4 })} €/${l.unidad || 'ud'}` : '';
            eq.title = l.equiv || '';
          };
          sel.addEventListener('change', ver); i.addEventListener('input', ver); ver();
          celda = [el('div', { class: 'cmp-pu' }, i, sel), eq];
        }
        return el('tr', {}, el('td', {}, l.descripcion, el('div', { class: 'sub' }, `${String(l.cantidad).replace('.', ',')} ${l.unidad || ''}`),
          habitual(s.habituales?.[l.id], l.unidad),
          x?.no ? el('div', { class: 'cmp-ia-nota' }, '🤖 dice que no lo tiene') : null, x?.alt ? el('div', { class: 'cmp-ia-nota' }, `🤖 alternativa: ${x.alt}`) : null, x?.nota ? el('div', { class: 'cmp-ia-nota' }, `🤖 ${x.nota}`) : null),
          el('td', { class: 'num' }, ...celda));
      }))),
      el('div', { class: 'cmp-campos' },
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Entrega el'), fEnt),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Portes (€)'), portes),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Su referencia'), ref),
        el('label', { class: 'cmp-campo ancho' }, el('span', {}, 'Notas'), notas)),
      el('label', { class: 'boton ghost mini' }, '📎 Adjuntar su oferta (PDF o foto)', file, nombre),
      el('div', { class: 'acciones' },
        co && o ? el('button', { type: 'button', class: 'ghost', title: 'La lectura de la IA no vale: se descarta (el correo queda en Correo entrante como descartado)', onclick: async () => {
          if (!confirm('¿Descartar lo que ha leído la IA? No se apunta nada.')) return;
          try { await api('POST', `/api/correo/${co.id}/descartar`, { motivo: 'Descartado al revisar la petición' }); d.close(); toast('Descartado'); pintar(); } catch (e) { toast(e.message, true); }
        } }, 'Descartar lectura') : null,
        el('button', { type: 'button', class: 'ghost', onclick: async () => {
          if (co) return confirmarIA(true);
          try { await api('PUT', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}`, { no_oferta: true, notas: notas.value, archivos: subidos }); d.close(); toast('Apuntado: no oferta'); pintar(); } catch (e) { toast(e.message, true); }
        } }, 'No oferta'),
        el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        co ? el('button', { type: 'button', class: 'primario', onclick: () => confirmarIA(false) }, '✔ Confirmar oferta') : null,
        co ? null : el('button', { type: 'button', class: 'primario', onclick: async () => {
          const precios = Object.fromEntries([...ins].map(([k, i]) => [k, i.value === '' ? null : i.value]));
          const unidades = Object.fromEntries([...uds].map(([k, u]) => [k, u.value]));
          try { await api('PUT', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}`, { precios, unidades, fecha_entrega: fEnt.value, portes: portes.value, ref_oferta: ref.value, notas: notas.value, archivos: subidos }); d.close(); toast('Oferta guardada'); pintar(); }
          catch (e) { toast(e.message, true); }
        } }, 'Guardar oferta')));
    if (original) { const cuerpo = el('div', { class: 'dlg-oferta-cols' }, el('div', { class: 'dlg-oferta-izq' }, ...[...d.childNodes]), original); d.replaceChildren(cuerpo); }
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal();
  }

  async function enlaceProv(s, p, nuevo) {
    const r = await api('POST', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}/enlace`, nuevo ? { nuevo: true } : {});
    return r.url;
  }
  async function copiarEnlace(s, p) {
    try {
      const url = await enlaceProv(s, p);
      try { await navigator.clipboard.writeText(url); toast('Enlace copiado: pégalo en un correo o un WhatsApp al proveedor'); }
      catch { prompt('Copia el enlace para el proveedor:', url); }
    } catch (e) { toast(e.message, true); }
  }

  async function dialogoEnviarSol(s, p) {
    const aj = estado.ajustes || {};
    let url = null;
    try { url = await enlaceProv(s, p); } catch (e) { toast(e.message, true); }
    const lineaEnlace = url ? `\n\nPuede responder directamente en nuestra plataforma, sin registrarse, poniendo sus precios línea a línea:\n${url}\n` : '';
    const recordar = !!p.enviado_en;
    const para = el('input', { type: 'email', value: p.email || '', 'aria-label': 'Para' });
    const proys = proyectosDe(s.lineas);
    const asunto = el('input', { value: `${recordar ? 'Recordatorio: ' : ''}[${s.codigo}] Petición de oferta · ${aj.empresa?.nombre || 'HAM Menorca'}${proys.length ? ` · ${proys.join(', ')}` : ''}`, 'aria-label': 'Asunto' });
    const texto = el('textarea', { rows: 10, 'aria-label': 'Texto del correo' });
    texto.value = recordar
      ? `Buenos días:\n\nLes recordamos nuestra petición de oferta ${s.codigo}${s.responder_antes ? `, que necesitaríamos antes del ${new Date(`${s.responder_antes}T12:00:00`).toLocaleDateString('es-ES')}` : ''}. Se la adjuntamos de nuevo.${lineaEnlace}\n\nUn saludo,\n${aj.empresa?.nombre || 'HAM Menorca'}`
      : `Buenos días:\n\nLes adjuntamos petición de oferta ${s.codigo}${proys.length ? ` (proyecto ${proys.join(', ')})` : ''}. Les agradeceríamos precio y plazo de entrega${s.responder_antes ? ` antes del ${new Date(`${s.responder_antes}T12:00:00`).toLocaleDateString('es-ES')}` : ''}, indicando si los portes están incluidos.\nSi responden por correo, mantengan la referencia ${s.codigo} en el asunto.${lineaEnlace}\n\nUn saludo,\n${aj.empresa?.nombre || 'HAM Menorca'}`;
    const enviar = async (porCorreo) => {
      try { await api('POST', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}/enviar`, porCorreo ? { correo: true, para: para.value, asunto: asunto.value, texto: texto.value, enlace: !!url && texto.value.includes(url) } : { correo: false }); d.close(); toast(porCorreo ? `Enviado a ${para.value}` : 'Apuntado como enviado'); pintar(); }
      catch (e) { toast(e.message, true); }
    };
    const pdf = `/api/compras/solicitudes/${s.id}/pdf?sp=${p.id}`;
    const d = el('dialog', { class: 'dlg-cos dlg-enviar' },
      el('h2', {}, `${recordar ? 'Recordar' : 'Enviar'} ${s.codigo} a ${p.proveedor}`),
      aj.correo ? el('div', { class: 'cmp-correo' },
        el('label', { class: 'cmp-campo' }, el('span', {}, 'De'), el('input', { value: aj.remitente || '', disabled: true })),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Para'), para),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Asunto'), asunto), texto,
        el('p', { class: 'ayuda' }, '📎 ', el('a', { href: pdf, target: '_blank', rel: 'noopener' }, `${s.codigo}.pdf`), url ? ' · el enlace para responder en la plataforma va en el texto y en el PDF (si lo quitas del texto, no se envía)' : null))
        : el('p', { class: 'aviso-coste' }, 'El correo de salida aún no está configurado. ', el('a', { href: pdf, target: '_blank', rel: 'noopener' }, 'Descarga el PDF'), ' (lleva el enlace para responder en la plataforma), envíalo tú y márcalo como enviado.'),
      url ? el('p', { class: 'ayuda' }, el('button', { type: 'button', class: 'ghost mini', onclick: () => copiarEnlace(s, p) }, '🔗 Copiar enlace'), ' para mandarlo por WhatsApp u otro medio.') : null,
      el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: aj.correo ? 'ghost' : 'primario', onclick: () => enviar(false) }, 'Ya lo he enviado yo'),
        aj.correo ? el('button', { type: 'button', class: 'primario', onclick: () => enviar(true) }, recordar ? '🔔 Enviar recordatorio' : '📤 Enviar por correo') : null));
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal();
  }

  /* ================= Proveedores ================= */
  async function pintarProveedores() {
    estado.proveedores = await api('GET', '/api/proveedores');
    const editar = tiene('compras');
    const filtro = el('input', { type: 'search', placeholder: 'Buscar nombre, CIF, localidad o lo que sirve', value: estado.filtroProv, 'aria-label': 'Buscar proveedor' });
    const ul = el('ul', { class: 'cmp-provs' });
    const pintarLista = () => {
      const q = norm(estado.filtroProv);
      ul.replaceChildren(...estado.proveedores.filter((x) => !q || norm(`${x.nombre} ${x.cif} ${x.localidad} ${x.materiales.join(' ')}`).includes(q)).map((x) => el('li', {},
        el('button', { type: 'button', class: `cmp-item${x.id === estado.proveedor ? ' actual' : ''}${x.activo ? '' : ' apagado'}`, onclick: () => { estado.proveedor = x.id; guardarURL(); pintar(); } },
          el('span', { class: 'cmp-item-1' }, el('b', {}, x.nombre), x.pedidos ? el('small', { class: 'ayuda' }, `${x.pedidos} pedido${x.pedidos === 1 ? '' : 's'}`) : null),
          el('small', { class: 'ayuda' }, [x.localidad, x.materiales.slice(0, 3).join(', ')].filter(Boolean).join(' · ') || '—')))));
    };
    filtro.addEventListener('input', () => { estado.filtroProv = filtro.value; pintarLista(); });
    pintarLista();
    if (!estado.proveedor && estado.proveedores.length) estado.proveedor = estado.proveedores[0].id;
    const x = estado.proveedores.find((p) => p.id === estado.proveedor);
    const guardarCampo = async (k, v) => {
      try { const r = await api('PUT', `/api/proveedores/${x.id}`, { [k]: v }); Object.assign(x, r); toast('Guardado'); pintarLista(); } catch (e) { toast(e.message, true); }
    };
    const campo = (k, txt, attrs = {}) => {
      const i = el(attrs.tag || 'input', { ...attrs, tag: null, ancho: null, value: x[k] ?? '', disabled: !editar });
      i.addEventListener('change', () => guardarCampo(k, i.value));
      return el('label', { class: `cmp-campo${attrs.ancho ? ` ${attrs.ancho}` : ''}` }, el('span', {}, txt), i);
    };
    const familias = el('input', { value: x ? x.materiales.join(', ') : '', disabled: !editar, 'aria-label': 'Lo que sirve, separado por comas' });
    familias.addEventListener('change', () => guardarCampo('materiales', familias.value.split(',').map((s) => s.trim()).filter(Boolean)));
    $('#panel-compras').replaceChildren(el('div', { class: 'cmp-dos' },
      el('section', { class: 'panel cmp-lista' },
        el('div', { class: 'cab-panel' }, el('h2', {}, `Proveedores `, el('span', { class: 'llv-n' }, String(estado.proveedores.length))),
          editar ? el('button', { type: 'button', class: 'ghost mini', onclick: async () => {
            const nombre = prompt('Nombre del proveedor');
            if (!nombre) return;
            try { const r = await api('POST', '/api/proveedores', { nombre }); estado.proveedor = r.id; guardarURL(); pintar(); } catch (e) { toast(e.message, true); }
          } }, '＋ Nuevo') : null),
        filtro, ul),
      el('section', { class: 'panel cmp-detalle' }, x ? [
        el('div', { class: 'cab-panel' }, el('h2', {}, x.nombre),
          el('span', { class: 'ayuda' }, [x.ref_notion ? 'Importado de Notion' : null, x.ultimo_pedido ? `último pedido ${cuando(x.ultimo_pedido)}` : null].filter(Boolean).join(' · '))),
        el('div', { class: 'cmp-campos' },
          campo('nombre', 'Nombre', { maxlength: 120 }), campo('cif', 'CIF', { maxlength: 20 }),
          campo('email', 'Email para ofertas y pedidos', { type: 'email', maxlength: 200 }), campo('email_admin', 'Email de administración (facturas)', { type: 'email', maxlength: 200 }),
          campo('telefono', 'Teléfono', { maxlength: 60 }), campo('contacto', 'Persona de contacto', { maxlength: 120 }),
          campo('localidad', 'Localidad', { maxlength: 120 }), campo('forma_pago', 'Forma de pago', { maxlength: 120, placeholder: 'Transferencia 60 días' }),
          campo('plazo_dias', 'Plazo habitual (días)', { type: 'number', min: '0', step: '1' }), campo('portes', 'Portes', { maxlength: 200, placeholder: 'Pagados desde 600 €' }),
          el('label', { class: 'cmp-campo ancho' }, el('span', {}, 'Lo que sirve (separado por comas)'), familias),
          campo('notas', 'Notas', { tag: 'textarea', rows: 3, maxlength: 2000, ancho: 'ancho' })),
        el('div', { class: 'cmp-campos' },
          el('label', { class: 'cmp-campo' }, el('span', {}, 'Zona'), el('select', { disabled: !editar, onchange: (ev) => guardarCampo('zona', ev.target.value) },
            [['menorca', 'Menorca'], ['peninsula', 'Península (llega por transporte a Menorca)'], ['baleares', 'Baleares'], ['online', 'Online / paquetería']].map(([v, t]) => el('option', { value: v, selected: x.zona === v }, t))))),
        el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: x.transportista, disabled: !editar, onchange: (ev) => guardarCampo('transportista', ev.target.checked) }), ' Es transportista (península → Menorca: sale en Transportes)'),
        x.transportista ? almacenesDe(x, editar) : null,
        el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: x.cuenta_credito, disabled: !editar, onchange: (ev) => guardarCampo('cuenta_credito', ev.target.checked) }), ' Tiene cuenta de crédito (sale para las compras locales del móvil)'),
        editar ? el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: x.activo, onchange: (ev) => guardarCampo('activo', ev.target.checked) }), ' Activo (sale para elegir en los pedidos)') : null,
        memoriaIA(x, editar),
        el('a', { class: 'ayuda', href: `/precios.html?proveedor=${x.id}` }, '💶 Ver sus precios en la Lista de precios →'),
      ] : el('p', { class: 'ayuda' }, 'Sin proveedores todavía.'))));
  }

  // Lo que la IA sabe de este proveedor: notas (editables), lo que ha deducido sola, correcciones y cómo llama a nuestros materiales
  function memoriaIA(x, editar) {
    const caja = el('details', { class: 'cmp-ia-mem' }, el('summary', {}, '🤖 Lo que la IA sabe de este proveedor'), el('p', { class: 'ayuda' }, 'Cargando…'));
    caja.addEventListener('toggle', async () => {
      if (!caja.open || caja.dataset.ok) return;
      caja.dataset.ok = '1';
      let m; try { m = await api('GET', `/api/proveedores/${x.id}/ia`); } catch (e) { caja.lastChild.textContent = e.message; return; }
      const notas = el('textarea', { rows: 3, maxlength: 2000, disabled: !editar, placeholder: 'Ej.: «Sus precios llevan IVA» · «Cotiza por barra de 6 m» · «Escribe los precios encima de nuestra petición» · «El descuento va al pie»' });
      notas.value = m.notas_ia || '';
      notas.addEventListener('change', async () => { try { await api('PUT', `/api/proveedores/${x.id}/ia`, { notas_ia: notas.value }); toast('Guardado: la IA lo tendrá en cuenta la próxima vez'); } catch (e) { toast(e.message, true); } });
      caja.replaceChildren(...[caja.firstChild,
        el('p', { class: 'ayuda' }, 'Se le pasa a la IA cada vez que lee una oferta o un correo de este proveedor.'),
        el('label', { class: 'cmp-campo ancho' }, el('span', {}, 'Notas para la IA'), notas),
        m.notas_ia_auto ? el('div', { class: 'cmp-ia-auto' }, el('b', {}, 'Deducido de las correcciones: '), m.notas_ia_auto) : null,
        m.correcciones.length ? el('details', {}, el('summary', {}, `Correcciones (${m.correcciones.length})`), el('table', { class: 'tabla-inf' }, el('tbody', {},
          m.correcciones.map((k) => el('tr', {}, el('td', { class: 'ayuda' }, cuando(k.creado)), el('td', {}, `${k.campo}${k.descripcion ? ` · ${k.descripcion}` : ''}`),
            el('td', { class: 'num' }, `IA: ${k.valor_ia ?? '—'} → ${k.valor_final ?? '—'}`), el('td', { class: 'ayuda' }, k.usuario || '')))))) : el('p', { class: 'ayuda' }, 'Sin correcciones todavía.'),
        m.alias.length ? el('details', {}, el('summary', {}, `Cómo llama a nuestros materiales (${m.alias.length})`), el('ul', {}, m.alias.map((a) => el('li', {}, `«${a.su_texto}» = ${a.descripcion}`)))) : null].filter(Boolean));
    });
    return caja;
  }

  /* ================= Ajustes ================= */
  async function pintarAjustes() {
    const aj = await api('GET', '/api/compras/ajustes');
    estado.ajustes = aj;
    const guardar = async (cuerpo) => { try { estado.ajustes = { ...estado.ajustes, ...(await api('PUT', '/api/compras/ajustes', cuerpo)) }; toast('Guardado'); } catch (e) { toast(e.message, true); } };
    const campo = (txt, valor, alCambiar, attrs = {}) => {
      const i = el(attrs.tag || 'input', { ...attrs, tag: null, ancho: null, value: valor ?? '' });
      i.addEventListener('change', () => alCambiar(i.value));
      return el('label', { class: `cmp-campo${attrs.ancho ? ` ${attrs.ancho}` : ''}` }, el('span', {}, txt), i);
    };
    const emp = (k) => (v) => guardar({ empresa: { [k]: v } });
    $('#panel-compras').replaceChildren(el('section', { class: 'panel', style: 'max-width: 900px' },
      el('h2', {}, 'Ajustes de compras'),
      el('p', { class: aj.correo ? 'ayuda' : 'aviso-coste' }, aj.correo ? `Correo de salida: ${aj.remitente}` : 'Correo de salida sin configurar' + (tiene('usuarios') ? ': configúralo en «Cuentas de correo» (abajo).' : ': pídeselo a un administrador.')),
      el('div', { class: 'cmp-campos' },
        campo('Aprobación de Dirección a partir de (€, sin IVA)', aj.limite_aprobacion, (v) => guardar({ limite_aprobacion: v }), { type: 'number', min: '0', step: '50' }),
        campo('Entregar en (por defecto)', aj.entregar_en, (v) => guardar({ entregar_en: v }), { maxlength: 300 }),
        el('h3', { class: 'ancho' }, 'Datos de la empresa en el pedido'),
        campo('Nombre', aj.empresa.nombre, emp('nombre')), campo('CIF', aj.empresa.cif, emp('cif')),
        campo('Dirección', aj.empresa.direccion, emp('direccion'), { ancho: 'ancho' }), campo('Teléfono', aj.empresa.telefono, emp('telefono')), campo('Email', aj.empresa.email, emp('email')),
        campo('Condiciones (al pie del pedido)', aj.condiciones, (v) => guardar({ condiciones: v }), { tag: 'textarea', rows: 5, ancho: 'ancho' })),
      tiene('usuarios') ? await panelCorreo() : null));
  }

  // Texto de un correo sin lo citado («El … escribió:», líneas con «>»), que se puede desplegar
  function textoCorreo(t) {
    const m = [/\n[ \t]*(El|On)\s[^\n]{0,160}(\n[^\n]{0,160})?\s(escribió|wrote)\s*:/i, /\n[ \t]*-{2,}\s*(Mensaje original|Original Message)/i, /\n[ \t]*De:\s[^\n]+\n[ \t]*(Enviado|Fecha|Sent)/i, /\n[ \t]*>/]
      .map((r) => { const x = r.exec(`\n${t}`); return x ? x.index : -1; }).filter((i) => i > 0);
    const corte = m.length ? Math.min(...m) : -1;
    const propio = (corte > 0 ? t.slice(0, corte - 1) : t).trim();
    const citado = corte > 0 ? t.slice(corte - 1).trim() : '';
    const pre = el('pre', { class: 'conv-txt' }, propio.length > 3000 ? `${propio.slice(0, 3000)}…` : propio || '(sin texto propio)');
    return el('div', {}, pre, citado ? el('details', { class: 'conv-cita' }, el('summary', {}, 'Mostrar texto citado'), el('pre', { class: 'conv-txt' }, citado.slice(0, 4000))) : null);
  }

  // Conversación con el proveedor de una petición (lo enviado, sus correos y el portal), para supervisar
  async function conversacion(s, p) {
    let d;
    try { d = await api('GET', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}/conversacion`); } catch (e) { toast(e.message, true); return; }
    const fecha = (t) => new Date(t).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    const ESTADO = { revisar: '⏳ por revisar', sin_asignar: '⏳ sin asignar', hecho: '✔ revisada', descartado: '✕ descartada', clasificado: '✔ leído', error: '⚠ error de lectura', nuevo: '⏳ sin leer', analizando: '🤖 leyendo…' };
    const TIPO = { oferta: 'Oferta', confirmacion_pedido: 'Confirmación', consulta: 'Pregunta', albaran: 'Albarán', factura: 'Factura', publicidad: 'Publicidad', otro: 'Otro', pedido_cliente: 'Pedido' };
    const textoLargo = (t) => (t ? textoCorreo(t) : null);
    const burbuja = (e) => {
      if (e.clase === 'portal') return el('div', { class: 'conv-sis' }, `${fecha(e.fecha)} · ${e.texto}`, e.archivo_id ? el('a', { href: `/api/archivos/${e.archivo_id}`, target: '_blank', rel: 'noopener' }, ' ver') : null);
      if (e.clase === 'enviado') return el('div', { class: 'conv-m nos' },
        el('div', { class: 'conv-cab' }, el('b', {}, 'Nosotros'), ` → ${e.para || p.proveedor} · ${fecha(e.fecha)}`),
        el('div', { class: 'conv-asunto' }, e.asunto || `Petición ${d.codigo}`),
        e.texto ? textoLargo(e.texto) : el('small', { class: 'ayuda' }, '(se envió antes de que se guardara el texto de los correos)'),
        (e.adjuntos || []).length ? el('div', { class: 'conv-adj' }, e.adjuntos.map((a) => el('span', {}, `📎 ${a}`))) : null);
      return el('div', { class: `conv-m ellos${['revisar', 'sin_asignar', 'error'].includes(e.estado) ? ' pend' : ''}` },
        el('div', { class: 'conv-cab' }, el('b', {}, e.clase === 'portal_pdf' ? `🌐 ${p.proveedor} (portal)` : `${e.de_nombre || p.proveedor}`), ` ${e.de_email ? `<${e.de_email}>` : ''} · ${fecha(e.fecha)}`),
        el('div', { class: 'conv-asunto' }, e.asunto || ''),
        e.resumen ? el('div', { class: 'conv-ia' }, `🤖 ${TIPO[e.tipo] || ''}: ${e.resumen}`, el('span', { class: 'conv-est' }, ` · ${ESTADO[e.estado] || e.estado}`)) : el('div', { class: 'conv-ia' }, ESTADO[e.estado] || e.estado),
        e.resultado ? el('small', { class: 'ayuda' }, e.resultado) : null,
        e.clase === 'portal_pdf' ? null : textoLargo(e.texto),
        (e.adjuntos || []).length ? el('div', { class: 'conv-adj' }, e.adjuntos.map((a) => el('a', { href: `/api/correo/adjuntos/${a.id}`, target: '_blank', rel: 'noopener' }, `📎 ${a.nombre}`))) : null,
        e.tipo === 'oferta' && e.estado === 'revisar' && s.estado === 'abierta' ? el('button', { type: 'button', class: 'primario mini', onclick: () => { dlg.close(); dialogoOferta(s, p, e.id); } }, '🤖 Revisar y confirmar aquí')
          : !['hecho', 'descartado'].includes(e.estado) && s.estado === 'abierta' ? el('button', { type: 'button', class: 'ghost mini', title: 'Si en realidad es su oferta: abre el cuadro de la oferta con este correo (o su PDF) al lado', onclick: () => { dlg.close(); dialogoOferta(s, p, e.id); } }, '✎ Apuntar oferta con esto al lado') : null,
        el('a', { href: `/correo.html?vista=todos&id=${e.id}`, class: 'conv-abrir' }, '→ Abrir en Correo entrante'));
    };
    const dlg = el('dialog', { class: 'conv-dlg', 'aria-labelledby': 'conv-tit' },
      el('div', { class: 'conv-top' }, el('h2', { id: 'conv-tit' }, `💬 ${d.proveedor} · ${d.codigo}`), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => dlg.close() }, '✕')),
      el('p', { class: 'ayuda' }, `${d.email || 'sin email en su ficha'} · lo que le hemos enviado, lo que ha respondido por correo y lo que ha hecho en su enlace del portal.`),
      el('div', { class: 'conv-lista' }, d.eventos.length ? d.eventos.map(burbuja) : el('p', { class: 'ayuda' }, 'Todavía no hay nada.')),
      d.email ? el('div', { class: 'conv-pie' }, el('a', { class: 'boton ghost', href: `mailto:${d.email}?subject=${encodeURIComponent(`RE: [${d.codigo}] Petición de oferta`)}` }, '✉ Escribirle desde mi correo')) : null);
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg);
    dlg.showModal();
    dlg.querySelector('.conv-lista').scrollTop = 1e6;
  }

  // El correo de salida ya no se configura aquí: sale de la cuenta principal de «Cuentas de correo» (Correo entrante › ⚙)
  async function panelCorreo() {
    const c = await api('GET', '/api/ajustes/correo').catch(() => ({}));
    return el('section', { class: 'cmp-correo-ajustes', 'data-ayuda': 'correo-salida' },
      el('h3', {}, 'Correo de salida'),
      el('p', { class: c.configurado ? 'ayuda' : 'aviso-coste' }, c.configurado
        ? `Los pedidos y las peticiones de precio salen de ${c.desde}${c.cuenta ? ` (cuenta «${c.cuenta}»)` : c.origen === 'servidor' ? ' (configuración del servidor)' : ''}.`
        : 'Sin configurar: los pedidos se descargan en PDF y se envían a mano.'),
      el('p', { class: 'ayuda' }, 'Las cuentas de correo (enviar y recibir, con su contraseña cifrada) se gestionan en un solo sitio:'),
      el('a', { class: 'boton primario', href: '/correo.html?cuentas=1' }, '⚙ Cuentas de correo'));
  }

  /* ================= Transportes península → Menorca ================= */
  const ENV_EST = [['preparando', 'Preparando'], ['recogido', 'Recogido'], ['en_barco', 'En barco'], ['en_mao', 'En Maó · por entregar'], ['entregado', 'Entregado']];
  const ENV_TXT = Object.fromEntries(ENV_EST);
  async function pintarTransportes() {
    const d = await api('GET', '/api/transportes');
    const editar = tiene('compras') || tiene('logistica');
    const marcados = new Set();
    const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
    // lo que espera
    const itemOT = (r) => el('li', { class: `trp-item${r.listo ? '' : ' no-listo'}`, draggable: editar ? 'true' : null, ondragstart: (ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ tarea_id: r.tarea_id })) },
      editar ? el('input', { type: 'checkbox', 'aria-label': `Marcar OT ${r.ot_codigo}`, onchange: (ev) => (ev.target.checked ? marcados.add(`t${r.tarea_id}`) : marcados.delete(`t${r.tarea_id}`)) }) : null,
      el('div', {}, el('b', {}, el('span', { class: 'cod-chip' }, r.ot_codigo), ` ${r.ot_titulo}`),
        el('small', {}, r.listo
          ? `🏭 ${r.prev_taller || '—'}${r.prev_localidad ? ` · ${r.prev_localidad}` : ''} · ${r.recibido ? `entregado a ${r.transportista} ${cuando(r.recibido)}` : 'listo'}${r.prev_nota ? ` · ${r.prev_nota}` : ''}`
          : `aún en ${r.prev_taller} (${r.prev_codigo} ${r.prev_nombre}${r.prev_fin || r.prev_plan_fin ? `, termina ~${cuando(r.prev_fin || r.prev_plan_fin)}` : ''})`),
        el('small', {}, `🚚 ${r.transportista}${r.plan_desde ? ` · transporte planificado ${cuando(r.plan_desde)}` : ''}`)));
    const itemPed = (r) => el('li', { class: `trp-item${r.listo ? '' : ' no-listo'}`, draggable: editar ? 'true' : null, ondragstart: (ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ pedido_id: r.pedido_id })) },
      editar ? el('input', { type: 'checkbox', 'aria-label': `Marcar ${r.codigo}`, onchange: (ev) => (ev.target.checked ? marcados.add(`p${r.pedido_id}`) : marcados.delete(`p${r.pedido_id}`)) }) : null,
      el('div', {}, el('b', {}, el('a', { class: 'cod-chip mat', href: `/compras.html?pedido=${r.pedido_id}` }, r.codigo), ` ${r.proveedor}`),
        el('small', {}, r.entrega_modo === 'almacen'
          ? (r.entregado_almacen ? `🏬 en ${r.almacen || 'el almacén'} desde ${cuando(r.entregado_almacen)}${r.bultos ? ` · ${r.bultos} bultos` : ''}` : `🏬 el proveedor lo lleva a ${r.almacen || 'el almacén'}${r.fecha_almacen ? ` · pactado ${cuando(r.fecha_almacen)}` : ''}`)
          : r.entrega_modo === 'recogida' ? `🚚 recoger en ${r.recogida_direccion || r.proveedor}${r.recogida_fecha ? ` · ${cuando(r.recogida_fecha)}` : ''}${r.listo_recogida ? ` · listo ${cuando(r.listo_recogida)}` : ''}${r.transportista ? ` · ${r.transportista}` : ''}`
            : `📦 Material · ${[r.localidad, r.fecha_entrega ? `listo ~${cuando(r.fecha_entrega)}` : null].filter(Boolean).join(' · ')}`),
        r.proyectos ? el('small', {}, r.proyectos) : null));
    const itemTraen = (r) => el('li', { class: `trp-item${r.fecha_entrega && r.fecha_entrega < hoy ? ' tarde' : ''}` },
      el('div', {}, el('b', {}, el('a', { class: 'cod-chip mat', href: `/compras.html?pedido=${r.pedido_id}` }, r.codigo), ` ${r.proveedor}`),
        el('small', {}, r.tracking ? ['📦 ', `${d.agencias?.[r.agencia] || r.agencia_otra || r.agencia || 'agencia'} ${r.tracking}`, r.tracking_url ? [' · ', el('a', { href: r.tracking_url, target: '_blank', rel: 'noopener' }, 'seguir ↗')] : null] : '📦 sin nº de seguimiento'),
        el('small', {}, [r.fecha_entrega ? `${r.fecha_entrega < hoy ? '⚠ pactado' : 'llega'} ${cuando(r.fecha_entrega)}` : 'sin fecha', r.seg_activo ? (r.prov_confirmado_en ? 'confirmado' : 'sin confirmar') : null, r.incidencia_trp_id ? '⚠ incidencia' : null, r.proyectos].filter(Boolean).join(' · '))));
    const items = () => [...marcados].map((k) => (k[0] === 't' ? { tarea_id: Number(k.slice(1)) } : { pedido_id: Number(k.slice(1)) }));
    const selEnvio = el('select', { 'aria-label': 'Añadir a un envío' }, el('option', { value: '' }, 'Añadir lo marcado a…'),
      d.envios.filter((e) => !['entregado', 'anulado'].includes(e.estado)).map((e) => el('option', { value: e.id }, `${e.codigo} · ${e.transportista || ''}`)));
    selEnvio.onchange = async () => {
      if (!selEnvio.value || !marcados.size) return;
      try { for (const it of items()) await api('POST', `/api/envios/${selEnvio.value}/lineas`, it); estado.envio = Number(selEnvio.value); guardarURL(); toast('Añadido al envío'); pintar(); }
      catch (e) { toast(e.message, true); }
    };
    const nuevo = async (its) => {
      try {
        // transportista: el de los pedidos marcados si coinciden; si no, el primero
        const ts = [...new Set(its.map((it) => it.pedido_id && d.pendientes.pedidos.find((r) => r.pedido_id === it.pedido_id)?.transportista_id).filter(Boolean))];
        const e = await api('POST', '/api/envios', { transportista_id: (ts.length === 1 ? ts[0] : null) || d.transportistas[0]?.id || null, items: its });
        estado.envio = e.id; guardarURL(); toast(`${e.codigo} creado`); pintar();
      } catch (er) { toast(er.message, true); }
    };
    const pool = el('section', { class: 'trp-col trp-pool' },
      el('h3', {}, '📦 Para enviar a Menorca ', el('span', { class: 'llv-n' }, String(d.pendientes.ots.length + d.pendientes.pedidos.length))),
      el('ul', {}, d.pendientes.ots.filter((r) => r.listo).map(itemOT), d.pendientes.pedidos.filter((r) => r.listo).map(itemPed),
        d.pendientes.ots.filter((r) => !r.listo).map(itemOT), d.pendientes.pedidos.filter((r) => !r.listo).map(itemPed)),
      !d.pendientes.ots.length && !d.pendientes.pedidos.length ? el('p', { class: 'ayuda' }, 'Nada pendiente.') : null,
      editar ? el('div', { class: 'trp-acc' },
        el('button', { type: 'button', class: 'primario mini', onclick: () => (marcados.size ? nuevo(items()) : toast('Marca lo que va en el envío', true)) }, '＋ Nuevo envío con lo marcado'),
        selEnvio) : null,
      el('p', { class: 'ayuda' }, 'Sale solo: las OTs cuya tarea de transporte la hace un transportista (en gris, lo que aún está en el taller), los pedidos «🏬 al almacén del transportista» (en gris hasta que el proveedor lo entrega) y los «🚚 lo vamos a buscar». Se arrastra a un envío o se marca y se añade.'));
    const traen = el('section', { class: 'trp-col trp-pool' },
      el('h3', {}, '📦 Lo traen los proveedores ', el('span', { class: 'llv-n' }, String((d.pendientes.traen || []).length))),
      el('ul', {}, (d.pendientes.traen || []).map(itemTraen)),
      !(d.pendientes.traen || []).length ? el('p', { class: 'ayuda' }, 'Ningún pedido con «Lo trae el proveedor» pendiente de llegar.') : null,
      el('p', { class: 'ayuda' }, 'Su transporte o agencia (MRW, Ecoscooting, UPS, Correos…): con su nº de seguimiento. Sin noticias pasada la fecha: recordatorio y luego incidencia.'));
    const tarjeta = (e) => el('li', {}, el('button', {
      type: 'button', class: `trp-env${e.id === estado.envio ? ' actual' : ''}${e.llegada_prevista && e.llegada_prevista < hoy && ['recogido', 'en_barco'].includes(e.estado) ? ' tarde' : ''}`,
      onclick: () => { estado.envio = e.id; guardarURL(); pintar(); },
      ondragover: (ev) => { if (editar && e.estado !== 'entregado') { ev.preventDefault(); ev.currentTarget.classList.add('soltar'); } },
      ondragleave: (ev) => ev.currentTarget.classList.remove('soltar'),
      ondrop: async (ev) => { ev.preventDefault(); try { await api('POST', `/api/envios/${e.id}/lineas`, JSON.parse(ev.dataTransfer.getData('text/plain'))); estado.envio = e.id; guardarURL(); toast(`Añadido a ${e.codigo}`); pintar(); } catch (er) { toast(er.message, true); } },
    },
    el('span', { class: 'trp-env-1' }, el('b', {}, e.codigo), el('small', {}, e.transportista || 'sin transportista')),
    e.estado === 'preparando' ? el('small', { class: `trp-acept-chip ${e.aceptacion}` }, { pendiente: e.enviado_en ? '⏳ sin aceptar' : '✎ sin pedir', propuesta: '📅 propone cambios', rechazada: '✕ no puede', aceptada: '✔ aceptada' }[e.aceptacion] || '') : null,
    el('small', {}, [e.recogida_prevista && e.estado === 'preparando' ? `recogida ${cuando(e.recogida_prevista)}` : null, e.llegada_prevista ? `llega a Maó ${cuando(e.llegada_prevista)}` : null].filter(Boolean).join(' · ') || 'sin fechas'),
    el('span', { class: 'trp-chips' }, e.lineas.map((l) => el('span', { class: `cod-chip${l.pedido_id ? ' mat' : ''}` }, l.ot_codigo || l.pedido_codigo || '·'))),
    el('small', {}, [`${e.bultos || 0} bultos`, e.kg ? `${e.kg} kg` : null, e.coste != null ? eur(e.coste) : null].filter(Boolean).join(' · '))));
    const cols = ENV_EST.map(([k, t]) => el('section', { class: 'trp-col' },
      el('h3', {}, t, ' ', el('span', { class: 'llv-n' }, String(d.envios.filter((e) => e.estado === k).length))),
      el('ul', {}, d.envios.filter((e) => e.estado === k).map(tarjeta)),
      k === 'preparando' && editar ? el('button', { type: 'button', class: 'ghost mini', onclick: () => nuevo([]) }, '＋ Envío vacío') : null));
    const ficha = el('div', { class: 'trp-ficha-caja' });
    $('#panel-compras').replaceChildren(el('div', { class: 'trp-tablero' }, traen, pool, ...cols), ficha);
    if (!d.transportistas.length) ficha.append(el('p', { class: 'ayuda' }, 'No hay ningún proveedor marcado como transportista: márcalo en Proveedores (p. ej. Menorca Tragina o Luchana).'));
    const e = d.envios.find((x) => x.id === estado.envio);
    if (e) pintarEnvio(ficha, e, d, editar);
  }

  function pintarEnvio(caja, e, d, editar) {
    const guardar = async (cuerpo) => {
      try {
        const r = await api('PUT', `/api/envios/${e.id}`, cuerpo);
        toast(e.aceptacion !== 'pendiente' && r.aceptacion === 'pendiente' ? 'Guardado. Han cambiado las condiciones: reenvíaselo al transportista para que las acepte.' : 'Guardado'); pintar();
      } catch (er) { toast(er.message, true); }
    };
    const pasoActual = ENV_EST.findIndex(([k]) => k === e.estado);
    const fechaIn = (k, txt) => el('label', { class: 'cmp-campo' }, el('span', {}, txt),
      el('input', { type: 'date', value: e[k] || '', disabled: !editar, onchange: (ev) => guardar({ [k]: ev.target.value || null }) }));
    const txtIn = (k, txt, attrs = {}) => el('label', { class: `cmp-campo${attrs.ancho ? ' ancho' : ''}` }, el('span', {}, txt),
      el('input', { ...attrs, ancho: null, value: e[k] ?? '', disabled: !editar, onchange: (ev) => guardar({ [k]: ev.target.value }) }));
    const lineaIn = (l, k, attrs) => el('input', { ...attrs, value: l[k] ?? '', disabled: !editar || e.estado === 'entregado',
      onchange: (ev) => guardar({ lineas: [{ ...l, [k]: ev.target.value }] }) });
    const copiar = async (nuevo) => {
      try { const r = await api('POST', `/api/envios/${e.id}/enlace`, { nuevo }); await navigator.clipboard.writeText(r.url).then(() => toast('Enlace copiado: pégalo en WhatsApp o en un correo'), () => prompt('Copia el enlace:', r.url)); pintar(); }
      catch (er) { toast(er.message, true); }
    };
    const decidirAcept = async (accion, pregunta) => {
      if (pregunta && !confirm(pregunta)) return;
      try { const r = await api('POST', `/api/envios/${e.id}/aceptacion`, { accion }); toast(r.hechos?.length ? `Aceptada · ${r.hechos.join(' · ')}` : 'Hecho'); pintar(); }
      catch (er) { toast(er.message, true); }
    };
    const t = e.transportista || 'el transportista';
    const pr = e.propuesta;
    const acept = e.estado !== 'preparando' ? null : el('div', { class: `trp-acept ${e.aceptacion}`, role: 'status' },
      e.aceptacion === 'aceptada' ? el('span', {}, `✔ ${t} aceptó la recogida ${cuando(e.aceptado_en)}${e.aceptado_por ? ` (${e.aceptado_por})` : ''}. Los proveedores de los pedidos que se recogen ya tienen la recogida confirmada y su enlace de seguimiento.`)
        : e.aceptacion === 'propuesta' && pr ? [el('span', {}, `📅 ${t}${pr.nombre ? ` (${pr.nombre})` : ''} propone: ${[pr.recogida ? `recoger el ${cuando(pr.recogida)}` : null, pr.llegada ? `llegar a Maó el ${cuando(pr.llegada)}` : null, pr.coste != null ? eur(pr.coste) : null].filter(Boolean).join(' · ') || 'cambios'}${pr.nota ? ` · «${pr.nota}»` : ''}`),
          editar ? el('button', { type: 'button', class: 'primario mini', onclick: () => decidirAcept('aceptar_propuesta') }, '✔ Aceptar propuesta') : null,
          editar ? el('button', { type: 'button', class: 'ghost mini', onclick: () => decidirAcept('rechazar_propuesta', 'Vuelve a «pendiente de aceptar». Cambia la fecha o el transportista y reenvíale el enlace. ¿Seguir?') }, '✕ No la acepto') : null]
          : e.aceptacion === 'rechazada' ? [el('span', {}, `✕ ${t} no puede: «${e.rechazo_motivo || ''}». Cambia el transportista o la fecha y vuelve a enviárselo.`)]
            : [el('span', {}, e.enviado_en ? `⏳ Esperando a que ${t} acepte la recogida (pedida ${cuando(e.enviado_en)}). Al aceptarla, el proveedor recibe la recogida confirmada y su enlace de seguimiento.`
              : '✎ Pon la recogida prevista, el coste y lo que va, y pulsa «✉ Enviar al transportista»: tendrá que aceptar la recogida en su enlace.')],
      editar && ['pendiente', 'rechazada'].includes(e.aceptacion) && e.lineas.length ? el('button', { type: 'button', class: 'ghost mini', onclick: () => decidirAcept('marcar_aceptada', `¿${t} la ha aceptado por teléfono o WhatsApp? Se avisará a los proveedores con su enlace de seguimiento.`) }, '✔ Aceptada por teléfono') : null);
    caja.replaceChildren(el('section', { class: 'panel trp-ficha' },
      el('div', { class: 'cab-panel' }, el('h2', {}, `${e.codigo}${e.transportista ? ` · ${e.transportista}` : ''}`),
        el('span', { class: 'ayuda' }, [`creado ${cuando(e.creado)}${e.creado_por_nombre ? ` por ${e.creado_por_nombre}` : ''}`, e.visto_en ? `el transportista lo vio ${cuando(e.visto_en)}` : null, e.n_recordatorios ? `✉ ${e.n_recordatorios} recordatorio(s)` : null].filter(Boolean).join(' · '))),
      el('ol', { class: 'trp-pasos' }, ENV_EST.map(([k, t], i) => el('li', { class: i < pasoActual ? 'ok' : i === pasoActual ? 'ya' : null },
        editar && i !== pasoActual && e.lineas.length ? el('button', { type: 'button', class: 'linklike', title: `Marcar «${t}»`, onclick: async () => {
          if (i < pasoActual && !confirm(`¿Volver a «${t}»?`)) return;
          try { await api('POST', `/api/envios/${e.id}/estado`, { estado: k }); toast(t); pintar(); } catch (er) { toast(er.message, true); }
        } }, t) : t,
        el('small', {}, e.fechas?.[k] ? cuando(e.fechas[k]) : k === 'en_mao' && e.llegada_prevista ? `prev. ${cuando(e.llegada_prevista)}` : k === 'recogido' && e.recogida_prevista ? `prev. ${cuando(e.recogida_prevista)}` : '')))),
      acept,
      el('div', { class: 'cmp-campos' },
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Transportista'), el('select', { disabled: !editar, onchange: (ev) => guardar({ transportista_id: ev.target.value }) },
          el('option', { value: '' }, '—'), d.transportistas.map((t) => el('option', { value: t.id, selected: t.id === e.transportista_id }, t.nombre)))),
        fechaIn('recogida_prevista', 'Recogida prevista'), fechaIn('llegada_prevista', 'Llega a Maó'),
        txtIn('ref_transportista', 'Su referencia', { maxlength: 80 }),
        txtIn('entregar_en', 'Entregar en', { maxlength: 300 }),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Coste del envío (€)'), el('input', { type: 'number', min: 0, step: '0.01', value: e.coste ?? '', disabled: !editar, onchange: (ev) => guardar({ coste: ev.target.value }) })),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Reparto del coste'), el('select', { disabled: !editar, onchange: (ev) => guardar({ reparto: ev.target.value }) },
          el('option', { value: 'kg', selected: e.reparto === 'kg' }, 'Por kg'), el('option', { value: 'manual', selected: e.reparto === 'manual' }, 'A mano'))),
        txtIn('notas', 'Notas para el transportista', { maxlength: 2000, ancho: true })),
      e.nota_transportista ? el('p', { class: 'trp-nota' }, `💬 ${e.transportista}: «${e.nota_transportista}»`) : null,
      el('table', { class: 'trp-lineas' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Qué va'), el('th', {}, 'Recoger en'), el('th', { class: 'num' }, 'Bultos'), el('th', { class: 'num' }, 'Kg'), el('th', { class: 'num' }, 'Coste'), el('th', {}, 'Recogido'), el('th', {}))),
        el('tbody', {}, e.lineas.map((l) => el('tr', {},
          el('td', {}, l.ot_codigo ? el('a', { href: `/proyectos.html?ot=${l.orden_id}` }, el('span', { class: 'cod-chip' }, l.ot_codigo)) : l.pedido_codigo ? el('a', { href: `/compras.html?pedido=${l.pedido_id}` }, el('span', { class: 'cod-chip mat' }, l.pedido_codigo)) : null,
            ' ', lineaIn(l, 'descripcion', { maxlength: 300, class: 'trp-desc', 'aria-label': 'Qué va' }),
            l.siguiente_aqui ? el('small', { class: l.siguiente_aqui < (e.llegada_prevista || '') ? 'trp-tarde' : 'ayuda' }, ` · se necesita aquí el ${cuando(l.siguiente_aqui)}`) : null),
          el('td', { 'data-l': 'Recoger en',}, lineaIn(l, 'origen', { maxlength: 200, 'aria-label': 'Recoger en' })),
          el('td', { 'data-l': 'Bultos', class: 'num' }, lineaIn(l, 'bultos', { type: 'number', min: 0, step: 1, class: 'trp-n', 'aria-label': 'Bultos' })),
          el('td', { 'data-l': 'Kg', class: 'num' }, lineaIn(l, 'kg', { type: 'number', min: 0, step: '0.1', class: 'trp-n', 'aria-label': 'Kg' })),
          el('td', { class: 'num', 'data-l': 'Coste' }, e.reparto === 'manual' ? lineaIn(l, 'coste_manual', { type: 'number', min: 0, step: '0.01', class: 'trp-n', 'aria-label': 'Coste' }) : eur(l.coste)),
          el('td', { 'data-l': 'Recogido' }, el('input', { type: 'checkbox', checked: l.recogido, disabled: !editar, 'aria-label': 'Recogido', onchange: (ev) => guardar({ lineas: [{ ...l, recogido: ev.target.checked }] }) })),
          el('td', {}, editar && e.estado !== 'entregado' ? el('button', { type: 'button', class: 'ghost mini borrar', 'aria-label': 'Quitar del envío', onclick: async () => {
            try { await api('DELETE', `/api/envios/${e.id}/lineas/${l.id}`); pintar(); } catch (er) { toast(er.message, true); }
          } }, '✕') : null)))),
        el('tfoot', {}, el('tr', {}, el('td', { colspan: 2 }, el('b', {}, 'Total')), el('td', { class: 'num', 'data-l': 'Bultos' }, String(e.bultos || 0)), el('td', { class: 'num', 'data-l': 'Kg' }, String(e.kg || 0)), el('td', { class: 'num', 'data-l': 'Coste' }, eur(e.coste)), el('td', { colspan: 2 })))),
      editar && e.estado !== 'entregado' ? el('button', { type: 'button', class: 'ghost mini', onclick: async () => {
        const desc = prompt('¿Qué va? (p. ej. «Palé de tornillería»)'); if (!desc) return;
        const origen = prompt('¿Dónde se recoge?') || null;
        try { await api('POST', `/api/envios/${e.id}/lineas`, { descripcion: desc, origen }); pintar(); } catch (er) { toast(er.message, true); }
      } }, '＋ Línea suelta') : null,
      e.archivos.length ? el('div', { class: 'trp-arch' }, el('span', { class: 'ayuda' }, 'CMR y fotos: '), e.archivos.map((a) => el('a', { href: `/api/envios/${e.id}/archivos/${a.id}`, target: '_blank', rel: 'noopener' }, `📎 ${a.nombre || 'archivo'}`))) : null,
      editar ? el('div', { class: 'trp-acc' },
        el('span', { class: 'ayuda' }, e.enviado_en ? `🔗 Enlace del transportista enviado ${cuando(e.enviado_en)}${e.email ? ` a ${e.email}` : ''}` : 'El transportista aún no tiene su enlace.'),
        el('button', { type: 'button', class: 'primario mini', onclick: async () => {
          const para = prompt('Correo del transportista', e.email || e.transportista_email || '');
          if (!para) return;
          try { await api('POST', `/api/envios/${e.id}/enviar`, { para }); toast(`Enviado a ${para}`); pintar(); } catch (er) { toast(er.message, true); }
        } }, e.enviado_en ? '✉ Reenviar por correo' : '✉ Enviar al transportista'),
        el('button', { type: 'button', class: 'ghost mini', onclick: () => copiar(false) }, '🔗 Copiar enlace'),
        e.enviado_en ? el('button', { type: 'button', class: 'ghost mini', onclick: () => { if (confirm('El enlace anterior dejará de funcionar. ¿Crear uno nuevo?')) copiar(true); } }, 'Nuevo enlace') : null,
        el('button', { type: 'button', class: 'ghost mini borrar', onclick: async () => {
          if (!confirm(`¿Anular ${e.codigo}? Lo que lleva vuelve a «Para enviar».`)) return;
          try { await api('DELETE', `/api/envios/${e.id}`); estado.envio = null; guardarURL(); pintar(); } catch (er) { toast(er.message, true); }
        } }, 'Anular')) : null));
  }

  /* ================= Compras locales (ferretería…) ================= */
  const CL_VISTAS = [['autorizar', 'Por autorizar'], ['sin_ticket', 'Autorizadas sin ticket'], ['cuadrar', 'Por cuadrar con factura'], ['todas', 'Todas']];
  async function pintarLocales() {
    if (!estado.cl) estado.cl = { vista: tiene('autorizar_compras_locales') ? 'autorizar' : 'cuadrar', mes: new Date().toISOString().slice(0, 7) };
    const v = estado.cl.vista;
    const d = await api('GET', `/api/compras-locales?vista=${v}${['cuadrar', 'todas'].includes(v) ? `&mes=${estado.cl.mes}` : ''}`);
    const foto = (c) => c.archivos.map((a) => el('a', { href: `/api/archivos/${a.id}`, target: '_blank', rel: 'noopener', title: a.ticket ? 'Ticket / albarán' : 'Foto' }, a.ticket ? '🧾' : '📷'));
    const cab = (c) => [el('div', { class: 'cl-cab' }, el('b', {}, `${c.codigo} · ${c.usuario_nombre || '—'}`), el('small', {}, cuando(c.creado))),
      el('div', {}, c.que, ' ', foto(c)),
      el('small', {}, [c.tienda_nombre, c.importe_aprox != null ? `≈ ${eur(c.importe_aprox)}` : null, c.tarea_codigo ? `${c.tarea_codigo} ${c.tarea_nombre} (OT ${c.ot_codigo})` : 'sin tarea', c.para === 'manana' ? 'para mañana' : 'para ahora'].filter(Boolean).join(' · '))];
    let cuerpo;
    if (v === 'autorizar' || v === 'sin_ticket') {
      cuerpo = d.compras.length ? el('ul', { class: 'cl-lista' }, d.compras.map((c) => {
        if (v === 'sin_ticket') return el('li', {}, cab(c), el('small', {}, `Código ${c.codigo_aut || '—'} · autorizada por ${c.decidido_por_nombre || '—'} ${cuando(c.decidido_en)}${c.nota_decision ? ` · «${c.nota_decision}»` : ''}`));
        const nota = el('input', { type: 'text', maxlength: 300, placeholder: 'Nota o motivo (si no se autoriza, obligatorio)', 'aria-label': 'Nota' });
        const decidir = async (decision) => {
          try { await api('POST', `/api/compras-locales/${c.id}/decidir`, { decision, nota: nota.value }); toast(decision === 'si' ? `${c.codigo} autorizada` : 'No autorizada'); pintar(); }
          catch (e) { toast(e.message, true); }
        };
        return el('li', {}, cab(c), d.puede_autorizar ? el('div', { class: 'cl-acc' }, nota,
          el('button', { type: 'button', class: 'primario', onclick: () => decidir('si') }, '✔ Autorizar'),
          el('button', { type: 'button', class: 'ghost borrar', onclick: () => decidir('no') }, '✗ No')) : el('small', {}, 'La autoriza Operaciones'));
      })) : el('p', { class: 'vacio' }, v === 'autorizar' ? '✔ Nada por autorizar.' : 'Nada pendiente de ticket.');
    } else {
      // tabla por tienda (y mes)
      const marcados = new Set();
      const grupos = new Map();
      for (const c of d.compras) { const k = c.tienda_nombre || '—'; if (!grupos.has(k)) grupos.set(k, []); grupos.get(k).push(c); }
      const factura = el('input', { type: 'text', maxlength: 60, placeholder: 'Nº de factura de la tienda', 'aria-label': 'Número de factura' });
      cuerpo = el('div', {},
        el('table', { class: 'cl-tabla' },
          el('thead', {}, el('tr', {}, el('th', {}), el('th', {}, 'CL'), el('th', {}, 'Código'), el('th', {}, 'Qué'), el('th', {}, 'Quién · trabajo'), el('th', { class: 'num' }, 'Autoriz.'), el('th', { class: 'num' }, 'Real'), el('th', {}, 'Ticket'), el('th', {}, 'Estado'))),
          el('tbody', {}, [...grupos].map(([tienda, cs]) => [
            el('tr', { class: 'grupo' }, el('td', { colspan: 6 }, `🏪 ${tienda}`), el('td', { class: 'num' }, eur(cs.reduce((s, c) => s + (c.importe_real || 0), 0))), el('td', { colspan: 2 },
              [...new Set(cs.map((c) => c.factura).filter(Boolean))].map((f) => `✔ ${f}`).join(' · '))),
            ...cs.map((c) => el('tr', {},
              el('td', {}, d.puede_cuadrar && ['comprada', 'cuadrada'].includes(c.estado) ? el('input', { type: 'checkbox', 'aria-label': `Marcar ${c.codigo}`, onchange: (ev) => (ev.target.checked ? marcados.add(c.id) : marcados.delete(c.id)) }) : null),
              el('td', {}, c.codigo), el('td', {}, el('b', {}, c.codigo_aut || '—')), el('td', {}, c.que),
              el('td', {}, `${c.usuario_nombre || '—'}${c.tarea_codigo ? ` · ${c.tarea_codigo}` : ''}`),
              el('td', { class: 'num' }, c.importe_aprox != null ? eur(c.importe_aprox) : ''),
              el('td', { class: `num${c.importe_aprox && c.importe_real > c.importe_aprox * (1 + d.desvio) ? ' tarde' : ''}` }, c.importe_real != null ? eur(c.importe_real) : '—'),
              el('td', {}, foto(c), c.num_albaran ? ` ${c.num_albaran}` : ''),
              el('td', {}, ({ pendiente: 'por autorizar', autorizada: 'sin ticket', rechazada: 'no autorizada', comprada: 'con ticket', cuadrada: `facturada${c.factura ? ` (${c.factura})` : ''}`, anulada: 'anulada' })[c.estado])))]))),
        !d.compras.length ? el('p', { class: 'vacio' }, 'Nada este mes.') : null,
        d.puede_cuadrar && v === 'cuadrar' ? el('div', { class: 'cl-acc' }, factura,
          el('button', { type: 'button', class: 'primario', onclick: async () => {
            if (!marcados.size) return toast('Marca las compras de esa factura', true);
            if (!factura.value.trim()) return toast('Pon el nº de factura', true);
            try { await api('POST', '/api/compras-locales/cuadrar', { ids: [...marcados], factura: factura.value }); toast('Cuadradas'); pintar(); } catch (e) { toast(e.message, true); }
          } }, '✔ Cuadrar lo marcado con esta factura'),
          el('button', { type: 'button', class: 'ghost', onclick: async () => {
            if (!marcados.size) return toast('Marca las compras', true);
            try { await api('POST', '/api/compras-locales/cuadrar', { ids: [...marcados], factura: null }); pintar(); } catch (e) { toast(e.message, true); }
          } }, 'Deshacer')) : null);
    }
    $('#panel-compras').replaceChildren(el('section', { class: 'panel' },
      el('div', { class: 'cab-panel' }, el('h2', {}, '🛒 Compras locales'),
        el('span', { class: 'ayuda' }, 'Las piden los operarios desde el móvil (Mi día › Compra local), las autoriza Operaciones y se compran a cuenta. Al subir el ticket, el importe va a costes de la tarea.')),
      el('div', { class: 'cl-acc', role: 'tablist' }, CL_VISTAS.map(([k, t]) => el('button', {
        type: 'button', role: 'tab', class: `llv-tab${k === v ? ' activa' : ''}`, 'aria-selected': k === v ? 'true' : 'false',
        onclick: () => { estado.cl.vista = k; pintar(); },
      }, t, d.cuentas[k] ? el('span', { class: 'llv-n' }, String(d.cuentas[k])) : null)),
      ['cuadrar', 'todas'].includes(v) ? el('input', { type: 'month', value: estado.cl.mes, 'aria-label': 'Mes', onchange: (ev) => { estado.cl.mes = ev.target.value; pintar(); } }) : null),
      cuerpo));
  }

  /* ================= General ================= */
  function pintar() {
    for (const b of document.querySelectorAll('.llv-tab')) b.setAttribute('aria-selected', String(b.dataset.vista === estado.vista));
    const f = { pedidos: pintarPedidos, precios: pintarSolicitudes, proveedores: pintarProveedores, ajustes: pintarAjustes, transportes: pintarTransportes, locales: pintarLocales }[estado.vista] || pintarPedidos;
    return f().catch((e) => toast(e.message, true));
  }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { return; }
    window.s360.iniciar(yo);
    $('#tab-ajustes').hidden = !(tiene('aprobar_compras') || tiene('usuarios'));
    $('#tab-pedidos').hidden = !(tiene('compras') || tiene('aprobar_compras') || tiene('logistica'));
    $('#tab-precios').hidden = $('#tab-pedidos').hidden;
    $('#tab-transportes').hidden = !(tiene('compras') || tiene('logistica') || tiene('aprobar_compras') || tiene('planificar'));
    $('#tab-locales').hidden = !(tiene('compras') || tiene('autorizar_compras_locales') || tiene('costes'));
    if ($('#tab-pedidos').hidden && estado.vista === 'pedidos') estado.vista = 'proveedores';
    for (const b of document.querySelectorAll('.llv-tab')) b.addEventListener('click', () => { estado.vista = b.dataset.vista; guardarURL(); pintar(); });
    try { estado.ajustes = await api('GET', '/api/compras/ajustes'); } catch { /* sin permiso: no hace falta */ }
    window.s360.alCambiar(() => { if (!document.querySelector('dialog[open]') && !document.activeElement?.closest('.cmp-detalle')) pintar(); });
    pintar();
  }

  init().catch((e) => toast(e.message, true));
})();
