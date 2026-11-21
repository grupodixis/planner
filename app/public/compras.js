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
            l.proyecto_codigo ? el('div', { class: 'sub' }, `${l.proyecto_codigo} · ${l.partida_codigo ? `${l.partida_codigo} ` : ''}${l.partida_nombre || ''}`)
              : el('div', { class: 'sub' }, l.tarea_id ? `🏭 tarea de la OT ${p.ot_codigo || ''} (taller externo)` : 'Línea a mano')),
          el('td', { class: 'num' }, editable ? el('input', { type: 'number', min: '0', step: 'any', value: l.cantidad, class: 'cmp-in-num', 'aria-label': 'Cantidad', oninput: cambia('cantidad') }) : String(l.cantidad).replace('.', ',')),
          el('td', {}, editable && !l.escandallo_id ? el('input', { value: l.unidad || '', class: 'cmp-in-ud', 'aria-label': 'Unidad', oninput: cambia('unidad') }) : (l.unidad || '')),
          el('td', { class: 'num' }, editable ? el('input', { type: 'number', min: '0', step: '0.0001', value: l.precio ?? '', placeholder: '€', class: `cmp-in-num${l.precio == null ? ' falta' : ''}`, 'aria-label': 'Precio unitario', oninput: cambia('precio') }) : eur(l.precio)),
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
      el('div', { class: 'cmp-acciones' }, acciones)].filter(Boolean));
  }

  async function accion(p, que, ok) {
    try { await api('POST', `/api/compras/pedidos/${p.id}/${que}`, {}); toast(ok); pintar(); } catch (e) { toast(e.message, true); }
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

  function dialogoEnviar(p, prov) {
    const aj = estado.ajustes || {};
    const para = el('input', { type: 'email', value: prov?.email || '', 'aria-label': 'Para' });
    const cc = el('input', { type: 'text', value: '', placeholder: 'opcional', 'aria-label': 'Copia' });
    const asunto = el('input', { value: `Pedido ${p.codigo} · ${aj.empresa?.nombre || 'HAM Menorca'}${p.referencia ? ` · ${p.referencia}` : ''}`, 'aria-label': 'Asunto' });
    const texto = el('textarea', { rows: 6, 'aria-label': 'Texto del correo' });
    texto.value = `Buenos días:\n\nLes adjuntamos el pedido ${p.codigo}${p.fecha_entrega ? ` con entrega el ${new Date(`${p.fecha_entrega}T12:00:00`).toLocaleDateString('es-ES')}` : ''}.\nPor favor, confirmen la recepción y la fecha de entrega, e indiquen el nº de pedido en el albarán y la factura.\n\nUn saludo,\n${aj.empresa?.nombre || 'HAM Menorca'}`;
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
          el('div', { class: 'sub' }, p.estado === 'respondida' ? [p.ref_oferta ? `oferta ${p.ref_oferta} · ` : '', p.fecha_entrega ? `llega ${fecha(p.fecha_entrega)} ` : 'sin fecha ', t === true ? el('span', { class: 'pos' }, '✓ a tiempo') : t === false ? el('span', { class: 'neg' }, '⚠ tarde') : null] : (EST_SP[p.estado] || [p.estado])[0]));
      }));
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
          el('label', {}, radio, el('span', {}, el('b', {}, eur(pr)), ` /${l.unidad || 'ud'}`, el('div', { class: 'sub' }, `total ${eur(pr * l.cantidad)}${mejor.get(l.id) === p.id ? ' · mejor' : ''}`), alt)));
      })));
    const pintarSel = () => { for (const td of caja.querySelectorAll('.cmp-oferta')) td.classList.toggle('sel', elegido[td.dataset.l] === Number(td.dataset.p)); };
    const pie = el('tr', { class: 'fila-total' }, el('td', { colspan: '2' }, 'Total elegido (con portes)'),
      ...s.proveedores.map((p) => { const t = el('b'); pies.set(p.id, t); return el('td', {}, t, p.portes ? el('div', { class: 'sub' }, `portes ${eur(p.portes)}`) : null); }));

    const tarjetaProv = (p) => {
      const [txt, cls] = EST_SP[p.estado] || [p.estado, ''];
      return el('div', { class: 'cmp-prov' },
        el('div', { class: 'cmp-item-1' }, el('b', {}, p.proveedor), el('span', { class: `cmp-estado ${cls}` }, txt)),
        el('small', { class: 'ayuda' }, [p.enviado_en ? `enviada ${cuando(p.enviado_en)}${p.enviado_correo ? ` a ${p.enviado_a}` : ' (a mano)'}` : null, p.recordado_en ? `recordada ${cuando(p.recordado_en)}` : null,
          p.portal_respondido_en ? `🌐 respondió en la plataforma ${cuando(p.portal_respondido_en)}` : p.respondido_en ? `respondió ${cuando(p.respondido_en)}` : p.portal_visto_en ? `👁 abrió el enlace ${cuando(p.portal_visto_en)}` : null].filter(Boolean).join(' · ') || (p.email || 'sin email en su ficha')),
        p.contacto ? el('small', { class: 'ayuda' }, `Contacto: ${p.contacto}`) : null,
        p.notas && p.portal_respondido_en ? el('small', { class: 'ayuda', style: 'white-space:pre-wrap' }, `«${p.notas}»`) : null,
        p.archivos.length ? el('div', {}, p.archivos.map((a) => el('a', { href: `/api/archivos/${a.id}`, target: '_blank', rel: 'noopener', class: 'ayuda' }, `📎 ${a.nombre || 'oferta'} `))) : null,
        abierta ? el('div', { class: 'cmp-prov-acc' },
          el('button', { type: 'button', class: 'ghost mini', onclick: () => dialogoEnviarSol(s, p) }, p.enviado_en ? '🔔 Recordar' : '📤 Enviar'),
          el('button', { type: 'button', class: p.estado === 'enviada' ? 'primario mini' : 'ghost mini', onclick: () => dialogoOferta(s, p) }, '✎ Apuntar oferta'),
          el('button', { type: 'button', class: 'ghost mini', title: 'Enlace para que el proveedor ponga sus precios en la plataforma', onclick: () => copiarEnlace(s, p) }, '🔗 Enlace'),
          el('button', { type: 'button', class: 'ghost mini', 'aria-label': `Quitar ${p.proveedor}`, onclick: () => { if (confirm(`¿Quitar a ${p.proveedor} de esta petición?`)) hacer(() => api('DELETE', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}`)); } }, '✕')) : null);
    };
    const yaEstan = new Set(s.proveedores.map((p) => p.proveedor_id));
    const selAdd = el('select', { 'aria-label': 'Añadir proveedor' }, el('option', { value: '' }, '＋ Añadir proveedor…'),
      estado.proveedores.filter((x) => x.activo && !yaEstan.has(x.id)).map((x) => el('option', { value: x.id }, x.nombre)));
    selAdd.addEventListener('change', () => selAdd.value && hacer(() => api('POST', `/api/compras/solicitudes/${s.id}/proveedores`, { proveedor_id: selAdd.value })));
    const nElegidas = s.lineas.filter((l) => l.elegido).length;
    const inFecha = (k, txt) => { const i = el('input', { type: 'date', value: s[k] || '', disabled: !abierta }); i.addEventListener('change', () => hacer(() => api('PUT', `/api/compras/solicitudes/${s.id}`, { [k]: i.value }), 'Guardado')); return el('label', { class: 'cmp-campo' }, el('span', {}, txt), i); };

    caja.replaceChildren(...[
      el('div', { class: 'cab-panel' },
        el('div', {}, el('h2', {}, `Petición ${s.codigo}`), el('p', { class: 'ayuda', style: 'margin:2px 0 0' }, `Creada por ${s.creado_por_nombre || '—'} el ${cuando(s.creado)}${s.cerrado_en ? ` · ${s.estado} el ${cuando(s.cerrado_en)}` : ''}`)),
        el('span', { class: `cmp-estado ${s.estado === 'abierta' ? 'aviso' : ''}` }, { abierta: 'Abierta', cerrada: 'Cerrada · pedidos creados', anulada: 'Anulada' }[s.estado])),
      el('div', { class: 'cmp-campos' }, inFecha('responder_antes', 'Responder antes del'), inFecha('necesario_el', 'Lo necesitamos el')),
      el('h3', { class: 'cmp-h3' }, 'Proveedores'),
      el('div', { class: 'cmp-provs-sol' }, s.proveedores.map(tarjetaProv), abierta ? selAdd : null),
      el('h3', { class: 'cmp-h3' }, 'Comparar y elegir'),
      el('p', { class: 'ayuda' }, 'Marca qué proveedor se queda cada línea. En verde, lo más barato que llega a tiempo.'),
      el('div', { class: 'tabla-scroll' }, el('table', { class: 'tabla-inf cmp-comp' }, el('thead', {}, cab), el('tbody', {}, filas), el('tfoot', {}, pie))),
      abierta ? el('div', { class: 'cmp-acciones' },
        el('a', { class: 'boton ghost', href: `/api/compras/solicitudes/${s.id}/pdf`, target: '_blank', rel: 'noopener' }, '📄 PDF de la petición'),
        el('button', { type: 'button', class: 'ghost peligro', onclick: () => { if (confirm(`¿Anular ${s.codigo}? Las líneas vuelven a «Por pedir».`)) hacer(() => api('DELETE', `/api/compras/solicitudes/${s.id}`), 'Petición anulada'); } }, 'Anular'),
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

  function dialogoOferta(s, p) {
    const ins = new Map();
    const fEnt = el('input', { type: 'date', value: p.fecha_entrega || '' });
    const portes = el('input', { type: 'number', min: '0', step: '0.01', value: p.portes ?? '', placeholder: '0 = pagados' });
    const ref = el('input', { value: p.ref_oferta || '', maxlength: 80, placeholder: 'nº de su oferta' });
    const notas = el('textarea', { rows: 2, maxlength: 1000 }); notas.value = p.notas || '';
    const subidos = []; const nombre = el('span', { class: 'ayuda' });
    const file = el('input', { type: 'file', accept: 'application/pdf,image/*', hidden: true, onchange: async () => {
      const f = file.files[0]; if (!f) return;
      try { toast('Subiendo…'); subidos.push(await window.s360.subirArchivo(f)); nombre.textContent = ` ${f.name}`; toast('Listo: se guarda al guardar la oferta'); } catch (e) { toast(e.message, true); }
    } });
    const d = el('dialog', { class: 'dlg-cos dlg-oferta' },
      el('h2', {}, `Oferta de ${p.proveedor}`),
      el('p', { class: 'ayuda' }, 'Precio unitario de cada línea (sin IVA). Deja vacío lo que no oferta.'),
      el('table', { class: 'tabla-inf' }, el('tbody', {}, s.lineas.map((l) => {
        const i = el('input', { type: 'number', min: '0', step: '0.0001', value: p.precios[l.id] ?? '', 'aria-label': `Precio de ${l.descripcion}`, class: 'cmp-in-num' });
        ins.set(l.id, i);
        return el('tr', {}, el('td', {}, l.descripcion, el('div', { class: 'sub' }, `${String(l.cantidad).replace('.', ',')} ${l.unidad || ''}`)), el('td', { class: 'num' }, i, ` €/${l.unidad || 'ud'}`));
      }))),
      el('div', { class: 'cmp-campos' },
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Entrega el'), fEnt),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Portes (€)'), portes),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Su referencia'), ref),
        el('label', { class: 'cmp-campo ancho' }, el('span', {}, 'Notas'), notas)),
      el('label', { class: 'boton ghost mini' }, '📎 Adjuntar su oferta (PDF o foto)', file, nombre),
      el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: async () => {
          try { await api('PUT', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}`, { no_oferta: true, notas: notas.value, archivos: subidos }); d.close(); toast('Apuntado: no oferta'); pintar(); } catch (e) { toast(e.message, true); }
        } }, 'No oferta'),
        el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          const precios = Object.fromEntries([...ins].map(([k, i]) => [k, i.value === '' ? null : i.value]));
          try { await api('PUT', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}`, { precios, fecha_entrega: fEnt.value, portes: portes.value, ref_oferta: ref.value, notas: notas.value, archivos: subidos }); d.close(); toast('Oferta guardada'); pintar(); }
          catch (e) { toast(e.message, true); }
        } }, 'Guardar oferta')));
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
    const asunto = el('input', { value: `${recordar ? 'Recordatorio: ' : ''}[${s.codigo}] Petición de oferta · ${aj.empresa?.nombre || 'HAM Menorca'}`, 'aria-label': 'Asunto' });
    const texto = el('textarea', { rows: 10, 'aria-label': 'Texto del correo' });
    texto.value = recordar
      ? `Buenos días:\n\nLes recordamos nuestra petición de oferta ${s.codigo}${s.responder_antes ? `, que necesitaríamos antes del ${new Date(`${s.responder_antes}T12:00:00`).toLocaleDateString('es-ES')}` : ''}. Se la adjuntamos de nuevo.${lineaEnlace}\n\nUn saludo,\n${aj.empresa?.nombre || 'HAM Menorca'}`
      : `Buenos días:\n\nLes adjuntamos petición de oferta ${s.codigo}. Les agradeceríamos precio y plazo de entrega${s.responder_antes ? ` antes del ${new Date(`${s.responder_antes}T12:00:00`).toLocaleDateString('es-ES')}` : ''}, indicando si los portes están incluidos.\nSi responden por correo, mantengan la referencia ${s.codigo} en el asunto.${lineaEnlace}\n\nUn saludo,\n${aj.empresa?.nombre || 'HAM Menorca'}`;
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
        el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: x.cuenta_credito, disabled: !editar, onchange: (ev) => guardarCampo('cuenta_credito', ev.target.checked) }), ' Tiene cuenta de crédito (sale para las compras locales del móvil)'),
        editar ? el('label', { class: 'chk' }, el('input', { type: 'checkbox', checked: x.activo, onchange: (ev) => guardarCampo('activo', ev.target.checked) }), ' Activo (sale para elegir en los pedidos)') : null,
      ] : el('p', { class: 'ayuda' }, 'Sin proveedores todavía.'))));
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
      el('p', { class: aj.correo ? 'ayuda' : 'aviso-coste' }, aj.correo ? `Correo de salida: ${aj.remitente}` : 'Correo de salida sin configurar' + (tiene('usuarios') ? ': rellénalo abajo, en «Correo de salida».' : ': pídeselo a un administrador.')),
      el('div', { class: 'cmp-campos' },
        campo('Aprobación de Dirección a partir de (€, sin IVA)', aj.limite_aprobacion, (v) => guardar({ limite_aprobacion: v }), { type: 'number', min: '0', step: '50' }),
        campo('Entregar en (por defecto)', aj.entregar_en, (v) => guardar({ entregar_en: v }), { maxlength: 300 }),
        el('h3', { class: 'ancho' }, 'Datos de la empresa en el pedido'),
        campo('Nombre', aj.empresa.nombre, emp('nombre')), campo('CIF', aj.empresa.cif, emp('cif')),
        campo('Dirección', aj.empresa.direccion, emp('direccion'), { ancho: 'ancho' }), campo('Teléfono', aj.empresa.telefono, emp('telefono')), campo('Email', aj.empresa.email, emp('email')),
        campo('Condiciones (al pie del pedido)', aj.condiciones, (v) => guardar({ condiciones: v }), { tag: 'textarea', rows: 5, ancho: 'ancho' })),
      tiene('usuarios') ? await panelCorreo() : null));
  }

  // Correo de salida: servidor SMTP de la cuenta compras@. La contraseña solo se escribe; nunca se muestra.
  async function panelCorreo() {
    const c = await api('GET', '/api/ajustes/correo');
    const v = { host: c.host || 'smtp.ionos.es', port: c.port || 587, secure: !!c.secure, user: c.user || 'compras@hamenorca.com', from: c.from || (c.host ? '' : 'HAM Menorca <compras@hamenorca.com>') };
    const inp = (k, attrs = {}) => { const i = el('input', { ...attrs, value: v[k] ?? '' }); i.addEventListener('input', () => { v[k] = attrs.type === 'number' ? Number(i.value) : i.value; }); return i; };
    const lbl = (txt, i, ancho) => el('label', { class: `cmp-campo${ancho ? ' ancho' : ''}` }, el('span', {}, txt), i);
    const seg = el('select', { 'aria-label': 'Seguridad' },
      el('option', { value: 'starttls', selected: !v.secure }, 'STARTTLS (puerto 587)'),
      el('option', { value: 'ssl', selected: v.secure }, 'SSL/TLS (puerto 465)'));
    const puerto = inp('port', { type: 'number', min: '1', max: '65535' });
    seg.addEventListener('change', () => { v.secure = seg.value === 'ssl'; v.port = v.secure ? 465 : 587; puerto.value = v.port; });
    const clave = el('input', { type: 'password', autocomplete: 'new-password', placeholder: c.tiene_clave ? '•••••••• (guardada; escribe solo para cambiarla)' : 'Contraseña de la cuenta' });
    const estadoTxt = el('p', { class: c.configurado ? 'ayuda' : 'aviso-coste' },
      c.configurado ? (c.origen === 'servidor' ? 'Ahora se usa la configuración puesta en el servidor. Si guardas aquí, manda esta.' : `Configurado: se envía como ${c.from || c.user}.`) : 'Sin configurar: los pedidos se descargan en PDF y se envían a mano.');
    const resultado = el('p', { class: 'ayuda', 'aria-live': 'polite' });
    const ocupado = (b, si) => { b.disabled = si; };
    const guardar = async (ev) => {
      const b = ev.currentTarget; ocupado(b, true);
      try {
        const r = await api('PUT', '/api/ajustes/correo', { ...v, pass: clave.value || undefined });
        clave.value = ''; clave.placeholder = r.tiene_clave ? '•••••••• (guardada; escribe solo para cambiarla)' : 'Contraseña de la cuenta';
        toast('Correo guardado'); resultado.textContent = 'Guardado. Pulsa «Probar conexión» para comprobarlo.';
        estado.ajustes = { ...estado.ajustes, correo: r.configurado };
      } catch (e) { toast(e.message, true); } finally { ocupado(b, false); }
    };
    const probar = async (ev, para) => {
      const b = ev.currentTarget; ocupado(b, true);
      resultado.className = 'ayuda'; resultado.textContent = 'Probando…';
      try {
        await api('POST', '/api/ajustes/correo/probar', para ? { para } : {});
        resultado.className = 'ok-correo'; resultado.textContent = para ? `✔ Conecta y se ha enviado un correo de prueba a ${para}.` : '✔ Conecta con el servidor y la contraseña es correcta.';
      } catch (e) { resultado.className = 'aviso-coste'; resultado.textContent = `✗ ${e.message}`; } finally { ocupado(b, false); }
    };
    const destino = el('input', { type: 'email', placeholder: 'tu@correo.com', 'aria-label': 'Enviar prueba a' });
    return el('section', { class: 'cmp-correo-ajustes', 'data-ayuda': 'correo-salida' },
      el('h3', {}, 'Correo de salida'),
      el('p', { class: 'ayuda' }, 'La cuenta desde la que salen los pedidos y las peticiones de precio (IONOS: smtp.ionos.es, 587, STARTTLS). La contraseña se guarda cifrada y no se vuelve a mostrar.'),
      estadoTxt,
      el('div', { class: 'cmp-campos' },
        lbl('Servidor SMTP', inp('host', { maxlength: 200, placeholder: 'smtp.ionos.es' })),
        lbl('Seguridad', seg), lbl('Puerto', puerto),
        lbl('Usuario (la cuenta)', inp('user', { maxlength: 200, autocomplete: 'off' })),
        lbl('Contraseña', clave),
        lbl('Remitente (cómo lo ve el proveedor)', inp('from', { maxlength: 300, placeholder: 'HAM Menorca <compras@hamenorca.com>' }), true)),
      el('div', { class: 'cmp-acciones' },
        el('button', { type: 'button', class: 'primario', onclick: guardar }, 'Guardar'),
        el('button', { type: 'button', class: 'ghost', onclick: (ev) => probar(ev) }, 'Probar conexión'),
        destino,
        el('button', { type: 'button', class: 'ghost', onclick: (ev) => { if (!destino.value) { destino.focus(); return toast('Escribe a qué correo mandar la prueba', true); } probar(ev, destino.value); } }, 'Enviar correo de prueba')),
      resultado);
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
    const itemPed = (r) => el('li', { class: 'trp-item', draggable: editar ? 'true' : null, ondragstart: (ev) => ev.dataTransfer.setData('text/plain', JSON.stringify({ pedido_id: r.pedido_id })) },
      editar ? el('input', { type: 'checkbox', 'aria-label': `Marcar ${r.codigo}`, onchange: (ev) => (ev.target.checked ? marcados.add(`p${r.pedido_id}`) : marcados.delete(`p${r.pedido_id}`)) }) : null,
      el('div', {}, el('b', {}, el('span', { class: 'cod-chip mat' }, r.codigo), ` ${r.proveedor}`),
        el('small', {}, `📦 Material · ${[r.localidad, r.fecha_entrega ? `listo ~${cuando(r.fecha_entrega)}` : null, r.proyectos].filter(Boolean).join(' · ')}`)));
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
        const e = await api('POST', '/api/envios', { transportista_id: d.transportistas[0]?.id || null, items: its });
        estado.envio = e.id; guardarURL(); toast(`${e.codigo} creado`); pintar();
      } catch (er) { toast(er.message, true); }
    };
    const pool = el('section', { class: 'trp-col trp-pool' },
      el('h3', {}, '📦 Para enviar a Menorca ', el('span', { class: 'llv-n' }, String(d.pendientes.ots.length + d.pendientes.pedidos.length))),
      el('ul', {}, d.pendientes.ots.filter((r) => r.listo).map(itemOT), d.pendientes.pedidos.map(itemPed),
        d.pendientes.ots.filter((r) => !r.listo).map(itemOT)),
      !d.pendientes.ots.length && !d.pendientes.pedidos.length ? el('p', { class: 'ayuda' }, 'Nada pendiente.') : null,
      editar ? el('div', { class: 'trp-acc' },
        el('button', { type: 'button', class: 'primario mini', onclick: () => (marcados.size ? nuevo(items()) : toast('Marca lo que va en el envío', true)) }, '＋ Nuevo envío con lo marcado'),
        selEnvio) : null,
      el('p', { class: 'ayuda' }, 'Sale solo: las OTs cuya tarea de transporte la hace un transportista (cuando el taller ha terminado o se lo ha entregado; en gris, lo que aún está en el taller) y los pedidos a proveedores de península sin llegar. Se arrastra a un envío o se marca y se añade.'));
    const tarjeta = (e) => el('li', {}, el('button', {
      type: 'button', class: `trp-env${e.id === estado.envio ? ' actual' : ''}${e.llegada_prevista && e.llegada_prevista < hoy && ['recogido', 'en_barco'].includes(e.estado) ? ' tarde' : ''}`,
      onclick: () => { estado.envio = e.id; guardarURL(); pintar(); },
      ondragover: (ev) => { if (editar && e.estado !== 'entregado') { ev.preventDefault(); ev.currentTarget.classList.add('soltar'); } },
      ondragleave: (ev) => ev.currentTarget.classList.remove('soltar'),
      ondrop: async (ev) => { ev.preventDefault(); try { await api('POST', `/api/envios/${e.id}/lineas`, JSON.parse(ev.dataTransfer.getData('text/plain'))); estado.envio = e.id; guardarURL(); toast(`Añadido a ${e.codigo}`); pintar(); } catch (er) { toast(er.message, true); } },
    },
    el('span', { class: 'trp-env-1' }, el('b', {}, e.codigo), el('small', {}, e.transportista || 'sin transportista')),
    el('small', {}, [e.recogida_prevista && e.estado === 'preparando' ? `recogida ${cuando(e.recogida_prevista)}` : null, e.llegada_prevista ? `llega a Maó ${cuando(e.llegada_prevista)}` : null].filter(Boolean).join(' · ') || 'sin fechas'),
    el('span', { class: 'trp-chips' }, e.lineas.map((l) => el('span', { class: `cod-chip${l.pedido_id ? ' mat' : ''}` }, l.ot_codigo || l.pedido_codigo || '·'))),
    el('small', {}, [`${e.bultos || 0} bultos`, e.kg ? `${e.kg} kg` : null, e.coste != null ? eur(e.coste) : null].filter(Boolean).join(' · '))));
    const cols = ENV_EST.map(([k, t]) => el('section', { class: 'trp-col' },
      el('h3', {}, t, ' ', el('span', { class: 'llv-n' }, String(d.envios.filter((e) => e.estado === k).length))),
      el('ul', {}, d.envios.filter((e) => e.estado === k).map(tarjeta)),
      k === 'preparando' && editar ? el('button', { type: 'button', class: 'ghost mini', onclick: () => nuevo([]) }, '＋ Envío vacío') : null));
    const ficha = el('div', { class: 'trp-ficha-caja' });
    $('#panel-compras').replaceChildren(el('div', { class: 'trp-tablero' }, pool, ...cols), ficha);
    if (!d.transportistas.length) ficha.append(el('p', { class: 'ayuda' }, 'No hay ningún proveedor marcado como transportista: márcalo en Proveedores (p. ej. Ydica).'));
    const e = d.envios.find((x) => x.id === estado.envio);
    if (e) pintarEnvio(ficha, e, d, editar);
  }

  function pintarEnvio(caja, e, d, editar) {
    const guardar = async (cuerpo) => {
      try { await api('PUT', `/api/envios/${e.id}`, cuerpo); toast('Guardado'); pintar(); } catch (er) { toast(er.message, true); }
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
    caja.replaceChildren(el('section', { class: 'panel trp-ficha' },
      el('div', { class: 'cab-panel' }, el('h2', {}, `${e.codigo}${e.transportista ? ` · ${e.transportista}` : ''}`),
        el('span', { class: 'ayuda' }, [`creado ${cuando(e.creado)}${e.creado_por_nombre ? ` por ${e.creado_por_nombre}` : ''}`, e.visto_en ? `el transportista lo vio ${cuando(e.visto_en)}` : null, e.n_recordatorios ? `✉ ${e.n_recordatorios} recordatorio(s)` : null].filter(Boolean).join(' · '))),
      el('ol', { class: 'trp-pasos' }, ENV_EST.map(([k, t], i) => el('li', { class: i < pasoActual ? 'ok' : i === pasoActual ? 'ya' : null },
        editar && i !== pasoActual && e.lineas.length ? el('button', { type: 'button', class: 'linklike', title: `Marcar «${t}»`, onclick: async () => {
          if (i < pasoActual && !confirm(`¿Volver a «${t}»?`)) return;
          try { await api('POST', `/api/envios/${e.id}/estado`, { estado: k }); toast(t); pintar(); } catch (er) { toast(er.message, true); }
        } }, t) : t,
        el('small', {}, e.fechas?.[k] ? cuando(e.fechas[k]) : k === 'en_mao' && e.llegada_prevista ? `prev. ${cuando(e.llegada_prevista)}` : k === 'recogido' && e.recogida_prevista ? `prev. ${cuando(e.recogida_prevista)}` : '')))),
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
          el('td', {}, lineaIn(l, 'origen', { maxlength: 200, 'aria-label': 'Recoger en' })),
          el('td', { class: 'num' }, lineaIn(l, 'bultos', { type: 'number', min: 0, step: 1, class: 'trp-n', 'aria-label': 'Bultos' })),
          el('td', { class: 'num' }, lineaIn(l, 'kg', { type: 'number', min: 0, step: '0.1', class: 'trp-n', 'aria-label': 'Kg' })),
          el('td', { class: 'num' }, e.reparto === 'manual' ? lineaIn(l, 'coste_manual', { type: 'number', min: 0, step: '0.01', class: 'trp-n', 'aria-label': 'Coste' }) : eur(l.coste)),
          el('td', {}, el('input', { type: 'checkbox', checked: l.recogido, disabled: !editar, 'aria-label': 'Recogido', onchange: (ev) => guardar({ lineas: [{ ...l, recogido: ev.target.checked }] }) })),
          el('td', {}, editar && e.estado !== 'entregado' ? el('button', { type: 'button', class: 'ghost mini borrar', 'aria-label': 'Quitar del envío', onclick: async () => {
            try { await api('DELETE', `/api/envios/${e.id}/lineas/${l.id}`); pintar(); } catch (er) { toast(er.message, true); }
          } }, '✕') : null)))),
        el('tfoot', {}, el('tr', {}, el('td', { colspan: 2 }, el('b', {}, 'Total')), el('td', { class: 'num' }, String(e.bultos || 0)), el('td', { class: 'num' }, String(e.kg || 0)), el('td', { class: 'num' }, eur(e.coste)), el('td', { colspan: 2 })))),
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
      el('small', {}, [c.tienda_nombre, c.importe_aprox != null ? `≈ ${eur(c.importe_aprox)}` : null, c.tarea_codigo ? `${c.tarea_codigo} ${c.tarea_nombre}` : 'taller / sin trabajo', c.para === 'manana' ? 'para mañana' : 'para ahora'].filter(Boolean).join(' · '))];
    let cuerpo;
    if (v === 'autorizar' || v === 'sin_ticket') {
      cuerpo = d.compras.length ? el('ul', { class: 'cl-lista' }, d.compras.map((c) => {
        if (v === 'sin_ticket') return el('li', {}, cab(c), el('small', {}, `Autorizada por ${c.decidido_por_nombre || '—'} ${cuando(c.decidido_en)}${c.nota_decision ? ` · «${c.nota_decision}»` : ''}`));
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
          el('thead', {}, el('tr', {}, el('th', {}), el('th', {}, 'CL'), el('th', {}, 'Qué'), el('th', {}, 'Quién · trabajo'), el('th', { class: 'num' }, 'Autoriz.'), el('th', { class: 'num' }, 'Real'), el('th', {}, 'Ticket'), el('th', {}, 'Estado'))),
          el('tbody', {}, [...grupos].map(([tienda, cs]) => [
            el('tr', { class: 'grupo' }, el('td', { colspan: 5 }, `🏪 ${tienda}`), el('td', { class: 'num' }, eur(cs.reduce((s, c) => s + (c.importe_real || 0), 0))), el('td', { colspan: 2 },
              [...new Set(cs.map((c) => c.factura).filter(Boolean))].map((f) => `✔ ${f}`).join(' · '))),
            ...cs.map((c) => el('tr', {},
              el('td', {}, d.puede_cuadrar && ['comprada', 'cuadrada'].includes(c.estado) ? el('input', { type: 'checkbox', 'aria-label': `Marcar ${c.codigo}`, onchange: (ev) => (ev.target.checked ? marcados.add(c.id) : marcados.delete(c.id)) }) : null),
              el('td', {}, c.codigo), el('td', {}, c.que),
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
