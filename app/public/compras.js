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
    proveedores: [], ajustes: null, filtroProv: '' };
  const guardarURL = () => {
    const u = new URLSearchParams();
    if (estado.vista !== 'pedidos') u.set('vista', estado.vista);
    if (estado.vista === 'pedidos' && estado.pedido) u.set('pedido', estado.pedido);
    if (estado.vista === 'precios' && estado.sol) u.set('sol', estado.sol);
    if (estado.vista === 'proveedores' && estado.proveedor) u.set('proveedor', estado.proveedor);
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
            l.proyecto_codigo ? el('div', { class: 'sub' }, `${l.proyecto_codigo} · ${l.partida_codigo ? `${l.partida_codigo} ` : ''}${l.partida_nombre || ''}`) : el('div', { class: 'sub' }, 'Línea a mano')),
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
        el('thead', {}, el('tr', {}, el('th', {}, 'Material'), el('th', { class: 'num' }, 'Cantidad'), el('th', {}, 'Ud.'), el('th', { class: 'num' }, 'Precio'), el('th', { class: 'num' }, 'Importe'), el('th', {}))),
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
        if (pr == null) return el('td', { class: 'sub' }, p.estado === 'respondida' || p.estado === 'no_oferta' ? 'No la oferta' : '—');
        const radio = el('input', { type: 'radio', name: `l${l.id}`, checked: elegido[l.id] === p.id, disabled: !abierta, 'aria-label': `Elegir ${p.proveedor} para ${l.descripcion}`,
          onchange: () => { elegido[l.id] = p.id; actualizarPies(); guardarEleccion(); pintarSel(); } });
        return el('td', { class: `cmp-oferta${mejor.get(l.id) === p.id ? ' mejor' : ''}`, 'data-l': l.id, 'data-p': p.id },
          el('label', {}, radio, el('span', {}, el('b', {}, eur(pr)), ` /${l.unidad || 'ud'}`, el('div', { class: 'sub' }, `total ${eur(pr * l.cantidad)}${mejor.get(l.id) === p.id ? ' · mejor' : ''}`))));
      })));
    const pintarSel = () => { for (const td of caja.querySelectorAll('.cmp-oferta')) td.classList.toggle('sel', elegido[td.dataset.l] === Number(td.dataset.p)); };
    const pie = el('tr', { class: 'fila-total' }, el('td', { colspan: '2' }, 'Total elegido (con portes)'),
      ...s.proveedores.map((p) => { const t = el('b'); pies.set(p.id, t); return el('td', {}, t, p.portes ? el('div', { class: 'sub' }, `portes ${eur(p.portes)}`) : null); }));

    const tarjetaProv = (p) => {
      const [txt, cls] = EST_SP[p.estado] || [p.estado, ''];
      return el('div', { class: 'cmp-prov' },
        el('div', { class: 'cmp-item-1' }, el('b', {}, p.proveedor), el('span', { class: `cmp-estado ${cls}` }, txt)),
        el('small', { class: 'ayuda' }, [p.enviado_en ? `enviada ${cuando(p.enviado_en)}${p.enviado_correo ? ` a ${p.enviado_a}` : ' (a mano)'}` : null, p.recordado_en ? `recordada ${cuando(p.recordado_en)}` : null, p.respondido_en ? `respondió ${cuando(p.respondido_en)}` : null].filter(Boolean).join(' · ') || (p.email || 'sin email en su ficha')),
        p.archivos.length ? el('div', {}, p.archivos.map((a) => el('a', { href: `/api/archivos/${a.id}`, target: '_blank', rel: 'noopener', class: 'ayuda' }, `📎 ${a.nombre || 'oferta'} `))) : null,
        abierta ? el('div', { class: 'cmp-prov-acc' },
          el('button', { type: 'button', class: 'ghost mini', onclick: () => dialogoEnviarSol(s, p) }, p.enviado_en ? '🔔 Recordar' : '📤 Enviar'),
          el('button', { type: 'button', class: p.estado === 'enviada' ? 'primario mini' : 'ghost mini', onclick: () => dialogoOferta(s, p) }, '✎ Apuntar oferta'),
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

  function dialogoEnviarSol(s, p) {
    const aj = estado.ajustes || {};
    const recordar = !!p.enviado_en;
    const para = el('input', { type: 'email', value: p.email || '', 'aria-label': 'Para' });
    const asunto = el('input', { value: `${recordar ? 'Recordatorio: ' : ''}[${s.codigo}] Petición de oferta · ${aj.empresa?.nombre || 'HAM Menorca'}`, 'aria-label': 'Asunto' });
    const texto = el('textarea', { rows: 6, 'aria-label': 'Texto del correo' });
    texto.value = recordar
      ? `Buenos días:\n\nLes recordamos nuestra petición de oferta ${s.codigo}${s.responder_antes ? `, que necesitaríamos antes del ${new Date(`${s.responder_antes}T12:00:00`).toLocaleDateString('es-ES')}` : ''}. Se la adjuntamos de nuevo.\n\nUn saludo,\n${aj.empresa?.nombre || 'HAM Menorca'}`
      : `Buenos días:\n\nLes adjuntamos petición de oferta ${s.codigo}. Les agradeceríamos precio y plazo de entrega${s.responder_antes ? ` antes del ${new Date(`${s.responder_antes}T12:00:00`).toLocaleDateString('es-ES')}` : ''}, indicando si los portes están incluidos.\nPor favor, mantengan la referencia ${s.codigo} en el asunto de su respuesta.\n\nUn saludo,\n${aj.empresa?.nombre || 'HAM Menorca'}`;
    const enviar = async (porCorreo) => {
      try { await api('POST', `/api/compras/solicitudes/${s.id}/proveedores/${p.id}/enviar`, porCorreo ? { correo: true, para: para.value, asunto: asunto.value, texto: texto.value } : { correo: false }); d.close(); toast(porCorreo ? `Enviado a ${para.value}` : 'Apuntado como enviado'); pintar(); }
      catch (e) { toast(e.message, true); }
    };
    const pdf = `/api/compras/solicitudes/${s.id}/pdf?sp=${p.id}`;
    const d = el('dialog', { class: 'dlg-cos dlg-enviar' },
      el('h2', {}, `${recordar ? 'Recordar' : 'Enviar'} ${s.codigo} a ${p.proveedor}`),
      aj.correo ? el('div', { class: 'cmp-correo' },
        el('label', { class: 'cmp-campo' }, el('span', {}, 'De'), el('input', { value: aj.remitente || '', disabled: true })),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Para'), para),
        el('label', { class: 'cmp-campo' }, el('span', {}, 'Asunto'), asunto), texto,
        el('p', { class: 'ayuda' }, '📎 ', el('a', { href: pdf, target: '_blank', rel: 'noopener' }, `${s.codigo}.pdf`)))
        : el('p', { class: 'aviso-coste' }, 'El correo de salida aún no está configurado. ', el('a', { href: pdf, target: '_blank', rel: 'noopener' }, 'Descarga el PDF'), ', envíalo tú y márcalo como enviado.'),
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

  /* ================= General ================= */
  function pintar() {
    for (const b of document.querySelectorAll('.llv-tab')) b.setAttribute('aria-selected', String(b.dataset.vista === estado.vista));
    const f = { pedidos: pintarPedidos, precios: pintarSolicitudes, proveedores: pintarProveedores, ajustes: pintarAjustes }[estado.vista] || pintarPedidos;
    return f().catch((e) => toast(e.message, true));
  }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { return; }
    window.s360.iniciar(yo);
    $('#tab-ajustes').hidden = !(tiene('aprobar_compras') || tiene('usuarios'));
    $('#tab-pedidos').hidden = !(tiene('compras') || tiene('aprobar_compras') || tiene('logistica'));
    $('#tab-precios').hidden = $('#tab-pedidos').hidden;
    if ($('#tab-pedidos').hidden && estado.vista === 'pedidos') estado.vista = 'proveedores';
    for (const b of document.querySelectorAll('.llv-tab')) b.addEventListener('click', () => { estado.vista = b.dataset.vista; guardarURL(); pintar(); });
    try { estado.ajustes = await api('GET', '/api/compras/ajustes'); } catch { /* sin permiso: no hace falta */ }
    window.s360.alCambiar(() => { if (!document.querySelector('dialog[open]') && !document.activeElement?.closest('.cmp-detalle')) pintar(); });
    pintar();
  }

  init().catch((e) => toast(e.message, true));
})();
