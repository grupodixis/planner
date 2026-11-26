/* Planéalo · Correo entrante (Compras): lo que llega a los buzones conectados, lo que ha entendido la IA y la revisión.
   Lista | revisión (datos editables) | documento (PDF o foto) lado a lado. Nada se aplica sin «Confirmar». */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['checked', 'disabled', 'hidden', 'open'].includes(k)) n[k] = !!v;
      else if (k === 'value') n.value = v ?? '';
      else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const api = (...a) => window.s360.api(...a);
  const toast = (m, e) => window.s360.aviso(m, e);
  const eur = (n) => (n == null || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 4 }));
  const fcorta = (t) => (t ? new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
  const TIPO_ICO = { oferta: '💶', confirmacion_pedido: '✅', albaran: '📦', factura: '🧾', pedido_cliente: '🛒', peticion_presupuesto: '📐', respuesta_presupuesto: '📐', consulta: '💬', publicidad: '📣', otro: '📄' };
  const ESTADO = { nuevo: ['Sin leer por la IA', 'gris'], analizando: ['La IA está leyendo…', 'azul'], revisar: ['Por revisar', 'naranja'], sin_asignar: ['Sin asignar', 'rojo'],
    clasificado: ['Clasificado', 'gris'], hecho: ['Resuelto', 'verde'], descartado: ['Descartado', 'gris'], error: ['Error', 'rojo'] };
  const est = { vista: 'revisar', buzon: '', tipo: '', q: '', lista: [], sel: null, c: null, tipos: {}, sucio: false, buzones: [], yo: null, adj: null };

  /* ---------- lista ---------- */
  async function cargarLista() {
    const q = new URLSearchParams({ vista: est.vista, ...(est.buzon ? { buzon: est.buzon } : {}), ...(est.tipo ? { tipo: est.tipo } : {}), ...(est.q ? { q: est.q } : {}) });
    const r = await api('GET', `/api/correo?${q}`);
    est.lista = r.correos; est.tipos = r.tipos;
    $('#co-tabs').replaceChildren(...[['revisar', `Por revisar${r.cuentas.revisar ? ` (${r.cuentas.revisar})` : ''}`], ['clasificados', `Clasificados${r.cuentas.clasificados ? ` (${r.cuentas.clasificados})` : ''}`], ['hechos', 'Resueltos'], ['todos', 'Todo']]
      .map(([k, t]) => el('button', { type: 'button', role: 'tab', class: `co-tab${est.vista === k ? ' activo' : ''}`, 'aria-selected': String(est.vista === k), onclick: () => { est.vista = k; recordar(); cargarLista(); } }, t)));
    if ($('#co-tipo').options.length <= 1) $('#co-tipo').replaceChildren(el('option', { value: '' }, 'Todos los tipos'), ...Object.entries(est.tipos).map(([k, t]) => el('option', { value: k }, `${TIPO_ICO[k]} ${t}`)));
    pintarLista();
  }
  function pintarLista() {
    const caja = $('#co-lista');
    if (!est.lista.length) {
      caja.replaceChildren(el('p', { class: 'co-vacio' }, est.vista === 'revisar' ? (est.buzones.length ? '✔ Nada por revisar. Lo que llegue aparecerá aquí solo.' : 'Aún no hay ningún buzón conectado.') : 'No hay correos.'),
        !est.buzones.length && window.s360.tiene('usuarios') ? el('button', { type: 'button', class: 'primario', onclick: abrirBuzones }, '⚙ Conectar un buzón') : null);
      return;
    }
    caja.replaceChildren(...est.lista.map((c) => {
      const [et, col] = ESTADO[c.estado] || [c.estado, 'gris'];
      return el('button', { type: 'button', class: `co-item${est.sel === c.id ? ' sel' : ''}`, 'aria-current': est.sel === c.id ? 'true' : null, onclick: () => abrir(c.id) },
        el('div', { class: 'co-item-1' }, el('b', {}, c.de_nombre || c.de_email || '—'), el('small', {}, fcorta(c.fecha))),
        el('div', { class: 'co-item-2' }, c.asunto),
        el('div', { class: 'co-item-3' },
          c.origen === 'portal' ? el('span', { class: 'co-chip azul', title: 'PDF subido por el proveedor a su enlace' }, '🌐 Portal') : null,
          c.tipo ? el('span', { class: 'co-chip' }, `${TIPO_ICO[c.tipo] || ''} ${est.tipos[c.tipo] || c.tipo}`) : null,
          el('span', { class: `co-chip ${col}` }, et),
          c.sol_codigo || c.pedido_codigo ? el('span', { class: 'co-chip ref' }, c.sol_codigo || c.pedido_codigo) : null,
          c.n_adjuntos ? el('span', { class: 'co-mini' }, `📎${c.n_adjuntos}`) : null,
          c.n_alertas ? el('span', { class: 'co-mini aviso', title: 'Con avisos' }, `⚠${c.n_alertas}`) : null));
    }));
  }

  /* ---------- detalle ---------- */
  async function abrir(id, { sinScroll } = {}) {
    if (est.sucio && est.sel !== id && !confirm('Tienes cambios sin confirmar en este correo. ¿Salir igualmente?')) return;
    est.sel = id; est.sucio = false; recordar();
    pintarLista();
    try { est.c = await api('GET', `/api/correo/${id}`); } catch (e) { $('#co-det').replaceChildren(el('p', { class: 'co-vacio' }, e.message)); return; }
    if (!est.adj || !est.c.adjuntos.some((a) => a.id === est.adj)) est.adj = (est.c.adjuntos.find((a) => a.tipo === 'application/pdf') || est.c.adjuntos.find((a) => /^image\//.test(a.tipo)))?.id || null;
    pintarDet();
    if (!sinScroll) $('#co-det').scrollTop = 0;
  }

  function pintarDet() {
    const c = est.c;
    if (!c) { $('#co-det').replaceChildren(el('p', { class: 'co-vacio' }, 'Elige un correo de la lista.')); return; }
    const [et, col] = ESTADO[c.estado] || [c.estado, 'gris'];
    const abierto = !['hecho', 'descartado'].includes(c.estado);
    const izq = el('div', { class: 'co-izq' },
      el('div', { class: 'co-cab' },
        el('h2', {}, c.asunto),
        el('div', { class: 'co-de' }, el('b', {}, c.de_nombre || ''), ` <${c.de_email || '—'}>`, el('span', {}, ` · ${fcorta(c.fecha)} · ${c.buzon}`)),
        el('div', { class: 'co-chips' },
          el('span', { class: `co-chip ${col}` }, et),
          c.origen === 'portal' ? el('span', { class: 'co-chip azul', title: 'El proveedor subió este PDF a su enlace de la petición sin rellenar el formulario' }, '🌐 Subido al portal') : null,
          c.tipo ? el('span', { class: 'co-chip' }, `${TIPO_ICO[c.tipo]} ${est.tipos[c.tipo] || c.tipo}`) : null,
          c.confianza != null ? el('span', { class: 'co-chip', title: 'Seguridad de la IA' }, `${Math.round(c.confianza * 100)} %`) : null,
          c.carpeta ? el('span', { class: 'co-chip gris', title: 'Carpeta en el buzón' }, `📁 ${c.carpeta}`) : c.archivo_error ? el('span', { class: 'co-chip rojo', title: c.archivo_error }, '📁 sin mover') : null)),
      c.estado === 'analizando' || c.estado === 'nuevo' ? el('div', { class: 'co-ia' }, c.estado === 'analizando' ? '🤖 La IA está leyendo este correo…' : `🤖 ${c.error || 'Pendiente de leer por la IA.'}`) : null,
      c.estado === 'error' ? el('div', { class: 'co-ia mal' }, `✕ La IA no pudo leerlo: ${c.error}`) : null,
      c.resumen ? el('div', { class: 'co-ia' }, el('b', {}, '🤖 '), c.resumen,
        (c.alertas || []).length ? el('ul', { class: 'co-alertas' }, c.alertas.map((a) => el('li', {}, `⚠ ${a}`))) : null,
        el('small', {}, `Leído con ${c.modelo || '—'}${c.analizado_en ? ` · ${fcorta(c.analizado_en)}` : ''}`)) : null,
      c.resultado && !abierto ? el('div', { class: 'co-hecho' }, `${c.estado === 'hecho' ? '✔' : '✕'} ${c.resultado}`) : null,
      c.presupuesto ? el('div', { class: 'co-hecho' }, '📐 ', el('a', { href: `/presupuestos.html?id=${c.presupuesto.id}` }, `${c.presupuesto.codigo} · ${c.presupuesto.titulo || ''}`)) : null,
      abierto ? asociacion(c) : null,
      abierto && c.tipo === 'oferta' && c.sp ? formOferta(c) : null,
      abierto && c.tipo === 'confirmacion_pedido' && c.pedido ? formPedido(c) : null,
      el('div', { class: 'co-acciones' },
        abierto && c.estado !== 'analizando' ? el('button', { type: 'button', class: 'ghost', onclick: () => accion('reanalizar', {}, 'La IA lo vuelve a leer') }, '↻ Volver a leer') : null,
        abierto ? el('button', { type: 'button', class: 'ghost', onclick: descartar }, '✕ Descartar') : null,
        !c.archivado_en && c.origen !== 'portal' ? el('button', { type: 'button', class: 'ghost', onclick: () => accion('archivar', {}, 'Archivado en el buzón') }, '📁 Archivar en el buzón') : null,
        c.origen !== 'portal' ? el('a', { class: 'ghost boton', href: `/api/correo/${c.id}/eml` }, '⬇ Correo original') : null),
      el('details', { class: 'co-texto', open: !c.adjuntos.length }, el('summary', {}, 'Texto del correo'), el('pre', {}, c.texto || '(sin texto)')));
    // documento
    const adj = c.adjuntos.find((a) => a.id === est.adj);
    const doc = el('div', { class: 'co-doc' },
      c.adjuntos.length ? el('div', { class: 'co-adj-tabs' }, c.adjuntos.map((a) => el('button', { type: 'button', class: `co-adj${a.id === est.adj ? ' activo' : ''}`, title: `${a.nombre} · ${Math.round(a.bytes / 1024)} KB`, onclick: () => {
        if (/^(application\/pdf|image\/)/.test(a.tipo)) { est.adj = a.id; pintarDet(); } else location.href = `/api/correo/adjuntos/${a.id}?descargar`;
      } }, `${a.tipo === 'application/pdf' ? '📄' : /^image\//.test(a.tipo) ? '🖼' : '📎'} ${a.nombre}`))) : null,
      adj ? (/^image\//.test(adj.tipo) ? el('img', { src: `/api/correo/adjuntos/${adj.id}`, alt: adj.nombre, class: 'co-img' })
        : el('iframe', { src: `/api/correo/adjuntos/${adj.id}#view=FitH`, title: adj.nombre, class: 'co-pdf' }))
        : el('div', { class: 'co-sin-doc' }, el('p', {}, c.adjuntos.length ? 'Este adjunto no se puede ver aquí: pulsa en él para descargarlo.' : 'Sin adjuntos.'), el('pre', {}, (c.texto || '').slice(0, 4000))));
    $('#co-det').replaceChildren(izq, doc);
  }

  // A qué petición o pedido corresponde (y cambiarlo)
  function asociacion(c) {
    const acc = ['oferta', 'confirmacion_pedido'].includes(c.tipo);
    const actual = c.sp ? `Petición ${c.sp.codigo} · ${c.sp.proveedor}` : c.pedido ? `Pedido ${c.pedido.codigo} · ${c.pedido.proveedor}` : null;
    const tipoSel = el('select', { 'aria-label': 'Tipo de correo', onchange: (ev) => accion('asignar', { tipo: ev.target.value }, 'Tipo cambiado') },
      Object.entries(est.tipos).map(([k, t]) => el('option', { value: k, selected: k === c.tipo }, `${TIPO_ICO[k]} ${t}`)));
    const cands = c.tipo === 'oferta' ? c.candidatos.sps.map((s) => [`sp:${s.sp_id}`, `${s.codigo} · ${s.proveedor}`]) : c.tipo === 'confirmacion_pedido' ? c.candidatos.pedidos.map((p) => [`ped:${p.pedido_id}`, `${p.codigo} · ${p.proveedor}`]) : [];
    const elegir = el('select', { 'aria-label': 'Asignar a', onchange: (ev) => {
      const [k, v] = ev.target.value.split(':');
      if (k === 'buscar') { buscarDestino(); ev.target.value = ''; return; }
      if (v) accion('asignar', k === 'sp' ? { sp_id: Number(v) } : { pedido_id: Number(v) }, 'Asignado: la IA lo vuelve a leer con esas líneas');
    } }, el('option', { value: '' }, actual ? 'Cambiar a…' : 'Asignar a…'), cands.map(([v, t]) => el('option', { value: v }, t)), el('option', { value: 'buscar:' }, '🔎 Buscar otra…'));
    return el('div', { class: `co-asoc${!actual && acc ? ' falta' : ''}` },
      el('label', {}, 'Es ', tipoSel),
      acc ? el('span', {}, actual ? el('b', {}, `→ ${actual}`) : el('b', { class: 'rojo' }, '→ ¿de qué petición o pedido es?'), ' ', elegir) : null);
  }
  async function buscarDestino() {
    const q = prompt(est.c.tipo === 'oferta' ? 'Código de la petición (SOL-…) o proveedor:' : 'Código del pedido (PC-…) o proveedor:');
    if (!q) return;
    const r = await api('GET', `/api/correo/buscar-destino?q=${encodeURIComponent(q)}`);
    const lista = est.c.tipo === 'oferta' ? r.sps.map((s) => ({ v: { sp_id: s.sp_id }, t: `${s.codigo} · ${s.proveedor}` })) : r.pedidos.map((p) => ({ v: { pedido_id: p.pedido_id }, t: `${p.codigo} · ${p.proveedor}` }));
    if (!lista.length) { toast('No se ha encontrado nada abierto con eso', true); return; }
    const v = await window.s360.preguntar('¿Cuál es?', 'Elige a qué corresponde este correo:', [...lista.slice(0, 8).map((x, i) => ({ valor: String(i), texto: x.t })), { valor: null, texto: 'Cancelar', clase: 'ghost' }]);
    if (v != null) accion('asignar', lista[Number(v)].v, 'Asignado: la IA lo vuelve a leer con esas líneas');
  }

  // Formulario de la oferta: lo que ha leído la IA, editable
  function formOferta(c) {
    const o = c.extraccion?.oferta || {};
    const porLinea = Object.fromEntries((o.lineas || []).map((l) => [l.linea_id, l]));
    const filas = c.lineas.map((l) => {
      const x = porLinea[l.linea_id] || {};
      const precio = el('input', { type: 'number', step: '0.0001', min: 0, value: x.precio ?? '', class: `co-num${x.precio == null && !x.no ? ' vacio' : ''}`, 'aria-label': `Precio de ${l.descripcion}`, 'data-l': l.linea_id, 'data-k': 'precio' });
      const no = el('input', { type: 'checkbox', checked: x.no, 'aria-label': `${l.descripcion}: no lo tiene`, 'data-l': l.linea_id, 'data-k': 'no' });
      const alt = el('input', { type: 'text', value: x.alt || '', placeholder: 'alternativa', 'data-l': l.linea_id, 'data-k': 'alt', 'aria-label': `Alternativa a ${l.descripcion}` });
      const imp = el('td', { class: 'co-imp' });
      const recalc = () => { imp.textContent = no.checked ? '—' : eur((Number(precio.value) || 0) * l.cantidad); precio.disabled = no.checked; total(); };
      [precio, no].forEach((i) => i.addEventListener('input', recalc));
      queueMicrotask(recalc);
      const h = c.habituales?.[l.linea_id];
      return el('tr', {}, el('td', {}, l.descripcion, x.nota ? el('small', { class: 'co-nota' }, `IA: ${x.nota}`) : null,
        h ? el('small', { class: `co-hab${h.viejo ? ' viejo' : ''}`, title: 'Último precio confirmado en el sistema' }, `💶 ${h.origen === 'estimado' ? 'estimado' : 'habitual'} ${Number(h.precio).toLocaleString('es-ES', { maximumFractionDigits: 4 })} € · ${h.origen === 'estimado' ? '≈ estimado' : h.proveedor || '—'} · ${new Date(h.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' })}`) : null), el('td', { class: 'n' }, `${l.cantidad} ${l.unidad || ''}`), el('td', {}, precio), imp, el('td', { class: 'c' }, no), el('td', {}, alt));
    });
    const portes = el('input', { type: 'number', step: '0.01', min: 0, value: o.portes ?? '', class: 'co-num', id: 'co-portes', oninput: () => total() });
    const totalEl = el('b', { id: 'co-total' });
    function total() {
      let t = 0;
      for (const l of c.lineas) {
        const p = form.querySelector(`[data-l="${l.linea_id}"][data-k="precio"]`); const n = form.querySelector(`[data-l="${l.linea_id}"][data-k="no"]`);
        if (p && !n?.checked) t += (Number(p.value) || 0) * l.cantidad;
      }
      t += Number(portes.value) || 0;
      totalEl.textContent = eur(t);
      totalEl.classList.toggle('rojo', !!(o.total && Math.abs(t - o.total) / o.total > 0.02));
      totalEl.title = o.total ? `Total de su oferta: ${eur(o.total)}` : '';
    }
    const notasIni = [o.notas, o.validez && `Validez: ${ddmm(o.validez)}/${o.validez.slice(0, 4)}`, o.forma_pago && `Pago: ${o.forma_pago}`, o.plazo_texto && `Plazo: ${o.plazo_texto}`].filter(Boolean).join('\n');
    const form = el('form', { class: 'co-form', oninput: () => { est.sucio = true; }, onsubmit: async (ev) => {
      ev.preventDefault();
      const lineas = {};
      for (const l of c.lineas) {
        const g = (k) => form.querySelector(`[data-l="${l.linea_id}"][data-k="${k}"]`);
        lineas[l.linea_id] = { precio: g('no').checked ? null : g('precio').value === '' ? null : Number(g('precio').value), no: g('no').checked, alt: g('alt').value };
      }
      await accion('confirmar-oferta', { sp_id: c.sp.id, lineas, portes: portes.value === '' ? null : Number(portes.value), fecha_entrega: form.fecha.value || null, ref_oferta: form.ref.value, notas: form.notas.value, adjuntar: !!form.adjuntar.checked });
    } },
    el('h3', {}, `Oferta para ${c.sp.codigo}`, el('small', {}, ` · ${c.sp.proveedor}${c.sp.estado === 'respondida' ? ' · ⚠ ya tenía una oferta: se sustituye' : ''}`)),
    el('div', { class: 'tabla-scroll' }, el('table', { class: 'co-tabla' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Material'), el('th', { class: 'n' }, 'Cant.'), el('th', {}, '€ / ud'), el('th', {}, 'Importe'), el('th', { class: 'c' }, 'No lo tiene'), el('th', {}, 'Alternativa'))),
      el('tbody', {}, filas),
      el('tfoot', {}, el('tr', {}, el('td', { colspan: 2 }, 'Portes'), el('td', {}, portes), el('td', {}), el('td', {}), el('td', {})),
        el('tr', {}, el('td', { colspan: 3 }, el('b', {}, 'Total sin IVA'), o.total ? el('small', {}, ` (su oferta: ${eur(o.total)})`) : null), el('td', { class: 'co-imp' }, totalEl), el('td', {}), el('td', {}))))),
    el('div', { class: 'co-campos' },
      el('label', {}, 'Entrega', el('input', { type: 'date', name: 'fecha', value: o.fecha_entrega || '' }), o.plazo_texto ? el('small', {}, `«${o.plazo_texto}»`) : null),
      el('label', {}, 'Su referencia', el('input', { type: 'text', name: 'ref', value: o.ref_oferta || '', maxlength: 80 })),
      el('label', { class: 'ancho' }, 'Notas', el('textarea', { name: 'notas', rows: 3 }, notasIni)),
      c.origen === 'portal' ? el('input', { type: 'hidden', name: 'adjuntar' }) : el('label', { class: 'co-chk' }, el('input', { type: 'checkbox', name: 'adjuntar', checked: true }), ' Guardar su PDF con la oferta')),
    el('div', { class: 'co-pie' },
      o.iva_incluido ? el('span', { class: 'naranja' }, '⚠ La IA ha quitado el IVA de los precios') : null,
      el('button', { type: 'submit', class: 'primario' }, '✔ Confirmar oferta · pasa al comparativo')));
    return form;
  }

  function formPedido(c) {
    const k = c.extraccion?.confirmacion || {};
    const porLinea = Object.fromEntries((k.lineas || []).map((l) => [l.linea_id, l]));
    const form = el('form', { class: 'co-form', oninput: () => { est.sucio = true; }, onsubmit: async (ev) => {
      ev.preventDefault();
      const lineas = {};
      form.querySelectorAll('[data-l]').forEach((i) => { if (i.value) lineas[i.dataset.l] = { ...(lineas[i.dataset.l] || {}), fecha: i.value }; });
      form.querySelectorAll('[data-p]').forEach((i) => { if (i.value !== '' && Number(i.value) !== (c.lineas.find((l) => String(l.linea_id) === i.dataset.p)?.precio ?? null)) lineas[i.dataset.p] = { ...(lineas[i.dataset.p] || {}), precio: Number(i.value) }; });
      await accion('confirmar-pedido', { pedido_id: c.pedido.id, confirma: form.confirma.checked, fecha_entrega: form.fecha.value || null, numero: form.numero.value, comentario: form.comentario.value, lineas });
    } },
    el('h3', {}, `Confirmación del pedido ${c.pedido.codigo}`, el('small', {}, ` · ${c.pedido.proveedor}${c.pedido.por_telefono ? ' · 📞 pedido por teléfono' : ''}${c.pedido.prov_confirmado_en ? ' · ya estaba confirmado' : ''}`)),
    el('div', { class: 'co-campos' },
      el('label', { class: 'co-chk' }, el('input', { type: 'checkbox', name: 'confirma', checked: k.confirma !== false }), ' Confirma el pedido'),
      el('label', {}, 'Llega el', el('input', { type: 'date', name: 'fecha', value: k.fecha_entrega || '' }), el('small', {}, c.pedido.fecha_entrega ? `pedido para el ${ddmm(c.pedido.fecha_entrega)}` : 'sin fecha pedida')),
      el('label', {}, 'Su nº de confirmación', el('input', { type: 'text', name: 'numero', value: k.numero || '', maxlength: 80 })),
      el('label', { class: 'ancho' }, 'Comentario', el('textarea', { name: 'comentario', rows: 2 }, k.notas || ''))),
    // líneas: precio (el que confirma; en un pedido por teléfono, el que faltaba) y fecha si es distinta
    c.lineas.length ? el('details', { open: c.pedido.por_telefono || (k.lineas || []).some((l) => l.fecha || l.precio != null) }, el('summary', {}, c.pedido.por_telefono ? 'Precios y fechas por línea' : 'Precio o fecha distintos por línea (opcional)'),
      el('table', { class: 'co-tabla' }, el('thead', {}, el('tr', {}, el('th', {}, 'Material'), el('th', { class: 'n' }, 'Cant.'), el('th', { class: 'n' }, '€ / ud (sin IVA)'), el('th', {}, 'Llega'))),
        el('tbody', {}, c.lineas.map((l) => { const x = porLinea[l.linea_id] || {}; return el('tr', {}, el('td', {}, l.descripcion, x.precio_cotizado != null && x.unidad_cotizada && x.unidad_cotizada !== l.unidad ? el('small', { class: 'ayuda' }, ` · cotizó ${x.precio_cotizado} €/${x.unidad_cotizada}`) : null),
          el('td', { class: 'n' }, `${l.cantidad} ${l.unidad || ''}`),
          el('td', { class: 'n' }, el('input', { type: 'number', min: '0', step: '0.0001', value: x.precio ?? l.precio ?? '', 'data-p': l.linea_id, class: `co-precio${l.precio == null && x.precio == null ? ' falta' : ''}`, 'aria-label': `Precio de ${l.descripcion}` })),
          el('td', {}, el('input', { type: 'date', value: x.fecha || '', 'data-l': l.linea_id, 'aria-label': `Fecha de ${l.descripcion}` }))); })))) : null,
    el('p', { class: 'ayuda' }, `La fecha pasa al material del pedido: el cuadrante avisará si llega después del día planificado.${c.pedido.por_telefono ? ' Los precios completan el pedido y pasan a la lista de precios y a costes.' : ''}`),
    el('div', { class: 'co-pie' }, el('button', { type: 'submit', class: 'primario' }, '✔ Aplicar al pedido')));
    return form;
  }

  async function accion(que, cuerpo, ok) {
    try {
      const r = await api('POST', `/api/correo/${est.c.id}/${que}`, cuerpo);
      est.sucio = false; est.c = r.correo;
      toast(r.texto || ok || 'Hecho');
      pintarDet(); cargarLista();
      if (['reanalizar', 'asignar'].includes(que)) esperarLectura(est.c.id);
    } catch (e) { toast(e.message, true); }
  }
  async function descartar() {
    const m = prompt('¿Por qué se descarta? (opcional)', '');
    if (m === null) return;
    accion('descartar', { motivo: m || 'Descartado' }, 'Descartado');
  }
  // tras «volver a leer» o «asignar», recargar cuando termine la IA
  async function esperarLectura(id) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      if (est.sel !== id) return;
      const c = await api('GET', `/api/correo/${id}`).catch(() => null);
      if (c && !['analizando', 'nuevo'].includes(c.estado)) { est.c = c; pintarDet(); cargarLista(); return; }
    }
  }

  /* ---------- cuentas de correo (entrada IMAP + salida SMTP) ---------- */
  async function cargarBuzones() {
    try { est.buzones = await api('GET', '/api/buzones'); } catch { est.buzones = []; }
    const lee = est.buzones.filter((b) => b.activo && b.entrada);
    $('#co-buzon').replaceChildren(el('option', { value: '' }, 'Todos los buzones'), ...lee.map((b) => el('option', { value: b.id, selected: String(b.id) === est.buzon }, b.nombre)));
    $('#co-buzon').hidden = lee.length < 2;
    const mal = lee.filter((b) => b.estado !== 'escuchando');
    $('#co-estado-buz').replaceChildren(...(lee.length ? [mal.length
      ? el('span', { class: 'rojo', title: mal.map((b) => `${b.nombre}: ${b.ultimo_error || b.estado}`).join('\n') }, `○ ${mal.map((b) => b.nombre).join(', ')} sin conexión`)
      : el('span', { class: 'verde', title: 'Conectado: el correo nuevo se lee en cuanto llega' }, `● Escuchando ${lee.map((b) => b.direccion).join(', ')}`)]
      : est.buzones.length ? [el('span', { class: 'gris' }, 'Ninguna cuenta con la entrada activada')] : []));
  }
  function abrirBuzones() {
    const d = $('#co-dlg');
    const pintar = () => d.replaceChildren(
      el('div', { class: 'co-dlg-cab' }, el('h2', { id: 'co-dlg-tit' }, '⚙ Cuentas de correo'), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
      el('p', { class: 'ayuda' }, 'Cada cuenta puede RECIBIR (Planéalo se queda conectado y la IA lee cada correo en cuanto llega) y ENVIAR (pedidos, peticiones de precio y avisos salen de la cuenta ★ principal). La contraseña se guarda cifrada y no se vuelve a mostrar. Lo ya tratado se mueve a «Planéalo/…» del buzón (Ofertas, Confirmaciones de pedido, Albaranes, Facturas…) y en el servidor queda una copia ordenada igual.'),
      ...est.buzones.map((b) => formBuzon(b, pintar)),
      el('details', { open: !est.buzones.length }, el('summary', { class: 'co-nuevo' }, '＋ Añadir otra cuenta'), formBuzon(null, pintar)));
    pintar();
    d.showModal();
  }
  function formBuzon(b, repintar) {
    const nuevo = !b;
    const v = b || { nombre: '', direccion: '', host: 'imap.ionos.es', puerto: 993, tls: true, usuario: '', carpeta_entrada: 'INBOX', carpeta_raiz: 'Planéalo', archivar: 'auto', activo: true,
      entrada: true, salida: true, smtp_host: 'smtp.ionos.es', smtp_puerto: 587, smtp_seguridad: 'starttls', smtp_usuario: '', remitente: '', uso: 'compras' };
    const resIn = el('span', { class: 'co-prueba' }); const resOut = el('span', { class: 'co-prueba' });
    const f = el('form', { class: `co-buz${b?.principal ? ' principal' : ''}`, autocomplete: 'off', onsubmit: async (ev) => {
      ev.preventDefault();
      try {
        await api(nuevo ? 'POST' : 'PUT', nuevo ? '/api/buzones' : `/api/buzones/${b.id}`, leer());
        toast(nuevo ? 'Cuenta añadida' : 'Guardado'); f.clave.value = '';
        await cargarBuzones(); repintar();
      } catch (e) { toast(e.message, true); }
    } });
    const leer = () => ({
      nombre: f.nombre.value, direccion: f.direccion.value, ...(f.clave.value ? { clave: f.clave.value } : {}), activo: f.activo.checked,
      entrada: f.entrada.checked, host: f.host.value, puerto: Number(f.puerto.value), tls: f.tls.checked, usuario: f.usuario.value || f.direccion.value,
      carpeta_entrada: f.carpeta_entrada.value, carpeta_raiz: f.carpeta_raiz.value, archivar: f.archivar.value,
      smtp_host: f.salida.checked ? f.smtp_host.value : null, smtp_puerto: Number(f.smtp_puerto.value), smtp_seguridad: f.smtp_seguridad.value,
      smtp_usuario: f.smtp_usuario.value || null, remitente: f.remitente.value || null,
      ...(f.otra_clave.checked && f.clave_smtp.value ? { clave_smtp: f.clave_smtp.value } : {}), ...(!f.otra_clave.checked ? { misma_clave_smtp: true } : {}),
      principal: f.principal.checked, uso: f.uso.value,
    });
    const probar = async (ev, ruta, res, extra = {}) => {
      ev.target.disabled = true; res.textContent = 'Probando…'; res.className = 'co-prueba';
      try { const r = await api('POST', ruta, { ...leer(), id: b?.id, ...extra }); res.textContent = `${r.ok ? '✔' : '✕'} ${r.msg}`; res.className = `co-prueba ${r.ok ? 'verde' : 'rojo'}`; }
      catch (e) { res.textContent = `✕ ${e.message}`; res.className = 'co-prueba rojo'; }
      ev.target.disabled = false;
    };
    const estadoIn = b ? (!b.entrada ? el('span', { class: 'gris' }, '○ Entrada desactivada') : b.estado === 'escuchando' ? el('span', { class: 'verde' }, `● Escuchando${b.ultimo_correo ? ` · último correo ${fcorta(b.ultimo_correo)}` : ''}`)
      : el('span', { class: 'rojo' }, `○ ${b.estado === 'sin_clave' ? 'Falta la contraseña' : b.estado === 'parado' ? 'Parada' : b.ultimo_error || 'Conectando…'}`)) : null;
    const seccion = (nombre, check, titulo, sub, ...hijos) => {
      const cuerpo = el('div', { class: 'co-campos', hidden: !check.checked }, ...hijos);
      check.addEventListener('change', () => { cuerpo.hidden = !check.checked; });
      return el('fieldset', { class: 'co-sec' }, el('legend', {}, el('label', { class: 'co-chk' }, check, ` ${titulo}`), el('small', {}, sub)), cuerpo);
    };
    const chkIn = el('input', { name: 'entrada', type: 'checkbox', checked: v.entrada });
    const chkOut = el('input', { name: 'salida', type: 'checkbox', checked: v.salida });
    const otraClave = el('input', { name: 'otra_clave', type: 'checkbox', checked: !!b?.clave_smtp_propia });
    const claveSmtp = el('label', { hidden: !b?.clave_smtp_propia }, 'Contraseña de salida', el('input', { name: 'clave_smtp', type: 'password', autocomplete: 'new-password', placeholder: b?.clave_smtp_propia ? '🔒 guardada' : '' }));
    otraClave.addEventListener('change', () => { claveSmtp.hidden = !otraClave.checked; });
    const seg = el('select', { name: 'smtp_seguridad' }, [['starttls', 'STARTTLS (587)'], ['ssl', 'SSL/TLS (465)'], ['ninguna', 'Sin cifrar']].map(([k, t]) => el('option', { value: k, selected: v.smtp_seguridad === k }, t)));
    const puertoOut = el('input', { name: 'smtp_puerto', type: 'number', value: v.smtp_puerto, class: 'co-num' });
    seg.addEventListener('change', () => { puertoOut.value = seg.value === 'ssl' ? 465 : 587; });
    const destino = el('input', { type: 'email', placeholder: 'enviar prueba a…', 'aria-label': 'Enviar correo de prueba a', class: 'co-dest' });
    f.append(
      b ? el('div', { class: 'co-buz-cab' }, el('b', {}, b.nombre), el('span', {}, b.direccion), b.uso === 'presupuestos' ? el('span', { class: 'co-chip' }, '📐 presupuestos') : null, b.principal ? el('span', { class: 'co-chip verde', title: 'Los pedidos, peticiones de precio y avisos salen de esta cuenta' }, '★ principal para enviar') : null,
        el('small', {}, b.entrada ? `${b.n} correos leídos` : '')) : null,
      el('div', { class: 'co-campos' },
        el('label', {}, 'Nombre', el('input', { name: 'nombre', value: v.nombre, required: true, placeholder: 'Compras' })),
        el('label', {}, 'Dirección', el('input', { name: 'direccion', type: 'email', value: v.direccion, required: true, placeholder: 'compras@…' })),
        el('label', {}, 'Contraseña', el('input', { name: 'clave', type: 'password', autocomplete: 'new-password', placeholder: b?.clave_guardada ? '🔒 guardada' : '', required: nuevo })),
        el('label', { class: 'co-chk' }, el('input', { name: 'activo', type: 'checkbox', checked: v.activo }), ' Activa'),
        el('label', { class: 'ancho2' }, 'Para qué es', el('select', { name: 'uso' },
          [['compras', '🛒 Compras: ofertas, confirmaciones, albaranes y facturas de proveedores'], ['presupuestos', '📐 Presupuestos: peticiones de clientes → la IA prepara el presupuesto']]
            .map(([k, t]) => el('option', { value: k, selected: (v.uso || 'compras') === k }, t))))),
      seccion('entrada', chkIn, '📥 Recibir (la IA lee el correo)', estadoIn,
        el('label', {}, 'Servidor IMAP', el('input', { name: 'host', value: v.host, required: true })),
        el('label', {}, 'Puerto', el('input', { name: 'puerto', type: 'number', value: v.puerto, class: 'co-num' })),
        el('label', { class: 'co-chk' }, el('input', { name: 'tls', type: 'checkbox', checked: v.tls }), ' SSL/TLS'),
        el('label', {}, 'Usuario', el('input', { name: 'usuario', value: v.usuario, placeholder: 'normalmente, la dirección' })),
        el('label', {}, 'Carpeta de entrada', el('input', { name: 'carpeta_entrada', value: v.carpeta_entrada })),
        el('label', {}, 'Archivar en', el('input', { name: 'carpeta_raiz', value: v.carpeta_raiz }), el('small', {}, '…/Ofertas, …/Facturas…')),
        el('label', { class: 'ancho2' }, 'Cuándo archivar', el('select', { name: 'archivar' },
          [['auto', 'Lo que hay que revisar, al revisarlo; lo demás, al leerlo'], ['al_revisar', 'Todo, al revisarlo aquí'], ['nunca', 'Nunca (no mover nada)']].map(([k, t]) => el('option', { value: k, selected: v.archivar === k }, t)))),
        el('div', { class: 'co-pie ancho' }, resIn,
          el('button', { type: 'button', class: 'ghost', onclick: (ev) => probar(ev, '/api/buzones/probar', resIn) }, '🔌 Probar recepción'),
          b?.entrada ? el('button', { type: 'button', class: 'ghost', title: 'Leer también los correos de los últimos días (gasta IA por cada uno)', onclick: async () => {
            const dias = prompt('¿Cuántos días hacia atrás quieres que lea? (máx. 30)', '7'); if (!dias) return;
            try { const r = await api('POST', `/api/buzones/${b.id}/recuperar`, { dias: Number(dias) }); toast(`${r.nuevos} correo(s) nuevos para leer`); cargarLista(); } catch (e) { toast(e.message, true); }
          } }, '⟲ Leer días anteriores') : null)),
      seccion('salida', chkOut, '📤 Enviar (pedidos, peticiones de precio, avisos)', b?.salida ? (b.principal ? '★ es la principal' : '') : '',
        el('label', {}, 'Servidor SMTP', el('input', { name: 'smtp_host', value: v.smtp_host || '' })),
        el('label', {}, 'Seguridad', seg),
        el('label', {}, 'Puerto', puertoOut),
        el('label', {}, 'Usuario', el('input', { name: 'smtp_usuario', value: v.smtp_usuario || '', placeholder: 'el mismo de arriba' })),
        el('label', { class: 'ancho2' }, 'Remitente (cómo lo ve el proveedor)', el('input', { name: 'remitente', value: v.remitente || '', placeholder: 'HAM Menorca <compras@…>' })),
        el('label', { class: 'co-chk' }, otraClave, ' Otra contraseña para enviar'), claveSmtp,
        el('label', { class: 'co-chk ancho2' }, el('input', { name: 'principal', type: 'checkbox', checked: !!b?.principal }), ' ★ Principal: de aquí salen los pedidos, peticiones de precio y avisos'),
        el('div', { class: 'co-pie ancho' }, resOut,
          el('button', { type: 'button', class: 'ghost', onclick: (ev) => probar(ev, '/api/buzones/probar-salida', resOut) }, '🔌 Probar envío'),
          destino,
          el('button', { type: 'button', class: 'ghost', onclick: (ev) => { if (!destino.value) { destino.focus(); toast('Escribe a qué correo mandar la prueba', true); return; } probar(ev, '/api/buzones/probar-salida', resOut, { para: destino.value }); } }, '✉ Enviar prueba'))),
      el('div', { class: 'co-pie' },
        b ? el('button', { type: 'button', class: 'ghost borrar', onclick: async () => {
          if (!confirm(`¿Quitar la cuenta «${b.nombre}»?${b.principal ? ' Es la principal: hasta que marques otra, los correos saldrán con la configuración del servidor (si la hay).' : ''}${b.n ? ' Sus correos ya leídos se conservan.' : ''}`)) return;
          try { await api('DELETE', `/api/buzones/${b.id}`); await cargarBuzones(); repintar(); } catch (e) { toast(e.message, true); }
        } }, 'Quitar cuenta') : null,
        el('button', { type: 'submit', class: 'primario' }, nuevo ? 'Añadir cuenta' : 'Guardar')));
    return f;
  }

  function recordar() {
    const q = new URLSearchParams();
    if (est.vista !== 'revisar') q.set('vista', est.vista);
    if (est.sel) q.set('id', est.sel);
    history.replaceState(null, '', `${location.pathname}${q.toString() ? `?${q}` : ''}`);
  }

  async function iniciar() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo); est.yo = yo;
    const q = new URLSearchParams(location.search);
    est.vista = q.get('vista') || 'revisar';
    $('#co-buzones').hidden = !window.s360.tiene('usuarios');
    $('#co-buzones').onclick = abrirBuzones;
    if (q.get('cuentas') && window.s360.tiene('usuarios')) setTimeout(abrirBuzones, 300);
    $('#co-buzon').onchange = (ev) => { est.buzon = ev.target.value; cargarLista(); };
    $('#co-tipo').onchange = (ev) => { est.tipo = ev.target.value; cargarLista(); };
    let t; $('#co-q').oninput = (ev) => { clearTimeout(t); t = setTimeout(() => { est.q = ev.target.value.trim(); cargarLista(); }, 300); };
    await cargarBuzones();
    await cargarLista();
    const id = Number(q.get('id')) || est.lista[0]?.id;
    if (id) abrir(id); else pintarDet();
    // lo que llega se ve solo (sin pisar lo que se está editando)
    window.s360.alCambiar(async () => { await cargarBuzones(); await cargarLista(); if (est.sel && !est.sucio) abrir(est.sel, { sinScroll: true }); }, { esperar: () => est.sucio });
  }
  iniciar();
})();
