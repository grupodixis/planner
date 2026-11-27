/* Planéalo · Presupuestos (fase 1): lista, ficha (capítulos › partidas, margen, KPIs), editor de partida
   (descripción comercial + descomposición con precios de la lista y la tarifa), pedir precio y PDF. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['checked', 'disabled', 'hidden', 'selected'].includes(k)) n[k] = !!v;
      else if (k === 'value') n.value = v ?? '';
      else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const api = (...a) => window.s360.api(...a);
  const aviso = (t) => window.s360.aviso(t);
  const eur = (n, d = 2) => (n == null ? '—' : `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })} €`);
  const eur0 = (n) => eur(n, 0);
  const pu = (n) => (n == null ? '' : Number(n).toLocaleString('es-ES', { maximumFractionDigits: 4 }));
  const fmt = (n) => (n == null ? '' : String(n).replace('.', ','));
  const leer = (v) => (String(v).trim() === '' ? null : Number(String(v).replace(',', '.')));
  const UDS = { m2: 'm²', m3: 'm³' };
  const ud = (u) => UDS[u] || u || 'ud';
  const fecha = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '');
  const ESTADO = { lead: 'lead', preparacion: 'en preparación', enviado: 'enviado', aceptado: 'aceptado', rechazado: 'rechazado' };
  const TIPOS = [['material', '🧱 Materiales'], ['mano_obra', '👷 Mano de obra'], ['maquinaria', '🏗 Maquinaria'], ['auxiliar', '🧰 Auxiliares (coste aparte)'], ['subcontrata', '🏭 Subcontratas']];
  const CHIP = { real: 'real', tarifa: 'tarifa', estimado: 'estimado', solicitado: 'solicitado' };

  const est = { q: '', soloLeads: false, id: null, partida: null, p: null, lista: [], tarifa: null, clientes: null, obras: null };
  const url = () => { const u = new URL(location); u.searchParams.delete('id'); u.searchParams.delete('partida'); if (est.id) u.searchParams.set('id', est.id); if (est.partida) u.searchParams.set('partida', est.partida); history.replaceState(null, '', u); };

  /* ---------- lista ---------- */
  async function cargarLista() {
    est.lista = await api('GET', `/api/presupuestos?q=${encodeURIComponent(est.q)}`);
    const nLeads = est.lista.filter((p) => p.estado === 'lead').length;
    const bl = $('#pz-leads'); if (bl) { bl.textContent = `🎯 Leads${nLeads ? ` (${nLeads})` : ''}`; bl.classList.toggle('activo', est.soloLeads); bl.setAttribute('aria-pressed', est.soloLeads ? 'true' : 'false'); }
    const grupos = (est.soloLeads ? [['lead', '🎯 Leads']] : [['lead', '🎯 Leads'], ['preparacion', 'En preparación'], ['enviado', 'Enviados'], ['aceptado', 'Aceptados'], ['rechazado', 'Rechazados']]);
    const itemLead = (p) => el('button', { type: 'button', class: `pz-item pz-item-lead${p.id === est.id ? ' sel' : ''}`, onclick: () => abrir(p.id) },
      el('div', { class: 'pz-item-1' }, el('b', {}, p.codigo), el('span', {}, fecha(p.creado))),
      el('div', {}, String(p.titulo || '').replace(/^Lead · /, '')),
      p.lead?.leyendo ? el('small', { class: 'pz-azul' }, '🤖 leyéndolo la IA…') : el('small', {}, [p.lead?.cliente?.nombre, p.lead?.cliente?.telefono, p.lead?.obra?.localidad].filter(Boolean).join(' · ') || p.lead?.resumen?.slice(0, 90) || ''),
      el('small', { class: 'ayuda' }, `📱 ${p.lead?.autor || 'capturado'}`));
    $('#pz-items').replaceChildren(...grupos.flatMap(([k, t]) => {
      const ls = est.lista.filter((p) => p.estado === k);
      if (!ls.length) return k === 'lead' && est.soloLeads ? [el('p', { class: 'ayuda' }, 'No hay leads. Se capturan desde el móvil: Capturar › 🎯 Lead.')] : [];
      if (k === 'lead') return [el('div', { class: 'pz-tag' }, `${t} (${ls.length})`), ...ls.map(itemLead)];
      return [el('div', { class: 'pz-tag' }, `${t} (${ls.length})`), ...ls.map((p) => el('button', { type: 'button', class: `pz-item${p.id === est.id ? ' sel' : ''}`, onclick: () => abrir(p.id) },
        el('div', { class: 'pz-item-1' }, el('b', {}, p.codigo), el('span', {}, p.venta ? eur0(p.venta) : '—', p.dto_total_pct ? el('small', { class: p.dto_necesita ? 'pz-rojo' : 'ayuda' }, ` −${fmt(p.dto_total_pct)} %`) : null)),
        p.dto_necesita ? el('small', { class: 'pz-rojo' }, p.dto_pedido ? '⏳ descuento esperando aprobación' : '⚠ descuento por encima del límite') : null,
        el('div', {}, [p.cliente, p.titulo].filter(Boolean).join(' · ')),
        p.ia_estado === 'creando' ? el('small', { class: 'pz-azul' }, '🤖 preparándolo la IA…') : p.ia_estado === 'error' ? el('small', { class: 'pz-rojo' }, '⚠ la IA no pudo prepararlo') : null,
        el('small', {}, p.origen === 'correo' ? '📧 ' : p.origen === 'captura' ? '🎯 ' : '', p.partidas ? `${p.capitulos} capítulo${p.capitulos === 1 ? '' : 's'} · ${p.partidas} partida${p.partidas === 1 ? '' : 's'}` : 'sin partidas',
          p.pendientes.nuevos ? el('span', { class: 'pz-verde' }, ` · ${p.pendientes.nuevos} precio(s) nuevo(s)`)
            : p.pendientes.estimado + p.pendientes.solicitado ? el('span', { class: 'pz-naranja' }, ` · ${p.pendientes.estimado + p.pendientes.solicitado} precio(s) pendientes`)
              : p.partidas ? el('span', { class: 'pz-verde' }, ' · todo con precio real') : null)))];
    }), ...(est.lista.length ? [] : [el('p', { class: 'ayuda' }, est.q ? 'Nada con esa búsqueda.' : 'Todavía no hay presupuestos.')]));
  }

  async function abrir(id, partida = null) { est.id = id; est.partida = partida; url(); await cargar(); cargarLista(); }
  async function cargar() {
    if (!est.id) { $('#pz-det').replaceChildren(el('p', { class: 'ayuda' }, 'Elige un presupuesto o crea uno nuevo.')); return; }
    try { est.p = await api('GET', `/api/presupuestos/${est.id}`); } catch (e) { $('#pz-det').replaceChildren(el('p', { class: 'ayuda' }, e.message)); return; }
    if (est.p.estado === 'lead') {
      pintarLead();
      if (est.p.lead_datos?.leyendo) { clearTimeout(est.sondeo); est.sondeo = setTimeout(async () => { await cargar(); if (!est.p?.lead_datos?.leyendo) cargarLista(); }, 2500); }
      return;
    }
    if (est.p.ia_estado === 'creando') { pintarCreando(); clearTimeout(est.sondeo); est.sondeo = setTimeout(async () => { const antes = est.p?.ia_estado; await cargar(); if (antes === 'creando' && est.p?.ia_estado !== 'creando') cargarLista(); }, 2000); return; }
    pintar();
  }
  /* ---------- lead (capturado desde el móvil) ---------- */
  function pintarLead() {
    const p = est.p; const d = p.lead_datos || {}; const cl = d.cliente || {}; const ob = d.obra || {};
    const guardar = (b) => api('PUT', `/api/presupuestos/${p.id}/lead`, b).then(() => { aviso('Guardado'); cargarLista(); }).catch((e) => aviso(e.message));
    const dato = (etq, val, fn, attrs = {}) => el('label', { class: 'pz-lead-dato' }, etq, el('input', { value: val || '', ...attrs, onchange: (ev) => fn(ev.target.value) }));
    const tel = cl.telefono ? String(cl.telefono).replace(/[^\d+]/g, '') : '';
    const accion = async (ruta, cuerpo, msg) => { try { await api('POST', `/api/presupuestos/${p.id}/lead/${ruta}`, cuerpo); aviso(msg); await cargar(); cargarLista(); } catch (e) { aviso(e.message); } };
    const adj = el('div', { class: 'pz-lead-adj' });
    api('GET', `/api/presupuestos/${p.id}/adjuntos`).then((ls) => adj.replaceChildren(...ls.map((a) => /^image\/(jpeg|png|webp)$/.test(a.tipo)
      ? el('a', { href: `/api/presupuestos-adjuntos/${a.id}`, target: '_blank', rel: 'noopener', title: a.nombre }, el('img', { src: `/api/presupuestos-adjuntos/${a.id}`, alt: a.nombre, loading: 'lazy' }))
      : el('a', { class: 'pz-adj', href: `/api/presupuestos-adjuntos/${a.id}`, target: '_blank', rel: 'noopener' }, `📎 ${a.nombre}`)))).catch(() => {});
    const zona = zonaAdjuntos();
    $('#pz-det').replaceChildren(el('div', { class: 'pz-card pz-lead' },
      el('div', { class: 'pz-lead-cab' },
        el('div', {}, el('span', { class: 'pz-lead-chip' }, '🎯 Lead'), ' ', el('b', {}, p.codigo),
          el('div', { class: 'ayuda' }, `Capturado por ${p.captura_autor || p.creado_por_nombre || '—'} · ${new Date(p.creado).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`)),
        el('div', { class: 'pz-acc' },
          el('button', { type: 'button', class: 'primario', disabled: !!d.leyendo, onclick: () => accion('preparar', { modo: 'ia' }, 'Preparando el presupuesto con IA…') }, '🤖 Preparar presupuesto con IA'),
          el('button', { type: 'button', class: 'ghost', disabled: !!d.leyendo, onclick: () => accion('preparar', { modo: 'mano' }, 'Pasa a preparación') }, '✎ Prepararlo a mano'),
          el('button', { type: 'button', class: 'ghost peligro', onclick: () => { const m = prompt('¿Por qué se descarta? (opcional)'); if (m !== null) accion('descartar', { motivo: m }, 'Lead descartado').then(() => { est.id = null; url(); cargar(); }); } }, '✕ Descartar'))),
      el('input', { class: 'pz-lead-tit', value: String(p.titulo || '').replace(/^Lead · /, ''), 'aria-label': 'De qué es', onchange: (ev) => guardar({ titulo: `Lead · ${ev.target.value}` }) }),
      p.prompt ? el('blockquote', { class: 'pz-prompt-ver' }, p.prompt) : null,
      adj,
      d.leyendo ? el('p', { class: 'pz-azul' }, el('span', { class: 'pz-girando' }), ' La IA está leyendo las fotos y documentos…')
        : d.error ? el('p', { class: 'pz-rojo' }, `⚠ ${d.error}`)
          : el('div', { class: 'pz-lead-ia' },
            d.resumen ? el('p', {}, '🤖 ', d.resumen) : null,
            (d.que_necesita || []).length ? el('div', { class: 'pz-adj-chips' }, el('b', {}, 'Podría necesitar: '), d.que_necesita.map((x) => el('span', { class: 'pz-adj' }, x))) : null,
            d.siguiente_paso ? el('p', {}, el('b', {}, 'Siguiente paso: '), d.siguiente_paso) : null,
            (d.otros_contactos || []).length ? el('div', {}, el('b', {}, 'Otros contactos: '), el('ul', {}, d.otros_contactos.map((o) => el('li', {}, [o.papel, o.nombre, o.telefono, o.email].filter(Boolean).join(' · '))))) : null,
            (d.dudas || []).length ? el('div', { class: 'ayuda' }, el('b', {}, 'Dudas: '), d.dudas.join(' · ')) : null),
      el('fieldset', { class: 'pz-lead-datos' }, el('legend', {}, 'Cliente y obra (corrige lo que haga falta: al preparar el presupuesto se da de alta el cliente si no existe)'),
        dato('Cliente', cl.nombre, (v) => guardar({ cliente: { nombre: v } })),
        dato('Persona de contacto', cl.contacto_nombre, (v) => guardar({ cliente: { contacto_nombre: v } })),
        el('div', { class: 'pz-lead-tel' }, dato('Teléfono', cl.telefono, (v) => guardar({ cliente: { telefono: v } }), { type: 'tel' }), tel ? el('a', { class: 'boton ghost', href: `tel:${tel}` }, '📞 Llamar') : null),
        dato('Correo', cl.email, (v) => guardar({ cliente: { email: v } }), { type: 'email' }),
        dato('CIF / NIF', cl.cif, (v) => guardar({ cliente: { cif: v } })),
        dato('Obra / dirección', ob.direccion, (v) => guardar({ obra: { direccion: v } })),
        dato('Localidad', ob.localidad, (v) => guardar({ obra: { localidad: v } }))),
      el('details', {}, el('summary', {}, '📎 Añadir más fotos o documentos'), zona.caja,
        el('button', { type: 'button', class: 'ghost', onclick: async () => { try { const f = zona.archivos(); if (!f.length) return aviso('Elige algún archivo'); await subirAdjuntos(f, p.id); await accion('leer', {}, 'La IA lo vuelve a leer'); } catch (e) { aviso(e.message); } } }, 'Subir y volver a leer')),
      !d.leyendo ? el('div', {}, el('button', { type: 'button', class: 'ghost mini', onclick: () => accion('leer', {}, 'La IA lo vuelve a leer') }, '🔄 Volver a leer con IA')) : null,
      (p.eventos || []).length ? el('div', { class: 'pz-eventos' }, el('ul', {}, p.eventos.map((e) => el('li', {}, el('span', { class: 'pz-ev-f' }, new Date(e.creado).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })), ' ', e.texto)))) : null));
  }
  // la IA lo está preparando
  function pintarCreando() {
    const p = est.p;
    const seg = Math.round((Date.now() - new Date(p.creado).getTime()) / 1000);
    $('#pz-det').replaceChildren(el('div', { class: 'pz-card pz-creando' },
      el('h2', {}, `🤖 Preparando ${p.codigo}…`),
      el('p', {}, el('span', { class: 'pz-girando' }), ` ${p.ia_fase || 'empezando'} · ${seg < 600 ? `${seg} s` : ''}`),
      p.prompt ? el('blockquote', { class: 'pz-prompt-ver' }, p.prompt) : null,
      el('p', { class: 'ayuda' }, 'Suele tardar entre 30 s y 3 min según los planos. Puedes irte: queda en la lista y avisa al terminar.')));
  }
  async function subirAdjuntos(files, presupuestoId = null) {
    const ids = [];
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) throw new Error(`${f.name} pasa de 25 MB`);
      const r = await fetch(`/api/presupuestos-adjuntos${presupuestoId ? `?presupuesto=${presupuestoId}` : ''}`, { method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name) }, body: f });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || `Error ${r.status} al subir ${f.name}`);
      ids.push(d.id);
    }
    return ids;
  }
  // zona de adjuntos: arrastrar o elegir; devuelve { caja, archivos() }
  function zonaAdjuntos() {
    const lista = []; const chips = el('div', { class: 'pz-adj-chips' });
    const pintarChips = () => chips.replaceChildren(...lista.map((f, i) => el('span', { class: 'pz-adj' }, `${/pdf$/i.test(f.name) ? '📐' : /xlsx?$|csv$/i.test(f.name) ? '📊' : /\.(jpe?g|png|webp|heic)$/i.test(f.name) ? '📷' : '📄'} ${f.name} · ${(f.size / 1048576).toFixed(1)} MB `,
      el('button', { type: 'button', class: 'ghost mini', 'aria-label': `Quitar ${f.name}`, onclick: () => { lista.splice(i, 1); pintarChips(); } }, '✕'))));
    const inp = el('input', { type: 'file', multiple: true, hidden: true, onchange: () => { lista.push(...inp.files); inp.value = ''; pintarChips(); } });
    const caja = el('div', { class: 'pz-drop', tabindex: 0, onclick: () => inp.click(), onkeydown: (ev) => { if (ev.key === 'Enter') inp.click(); } },
      '📎 Arrastra aquí planos (PDF), mediciones (Excel), fotos… o pulsa para elegir', inp);
    caja.addEventListener('dragover', (ev) => { ev.preventDefault(); caja.classList.add('sobre'); });
    caja.addEventListener('dragleave', () => caja.classList.remove('sobre'));
    caja.addEventListener('drop', (ev) => { ev.preventDefault(); caja.classList.remove('sobre'); lista.push(...ev.dataTransfer.files); pintarChips(); });
    return { caja: el('div', {}, caja, chips), archivos: () => lista };
  }
  // cambio en el servidor que devuelve el presupuesto entero
  async function hacer(metodo, ruta, cuerpo, msg) {
    try { const r = await api(metodo, ruta, cuerpo); if (r && r.id === est.id && r.capitulos) est.p = r; else await cargar(); if (msg) aviso(typeof msg === 'function' ? msg(r) : msg); pintar(); cargarLista(); return r; }
    catch (e) { aviso(e.message); return null; }
  }
  const pintar = () => (est.partida ? pintarPartida() : pintarFicha());
  const abiertoP = () => ['preparacion', 'enviado'].includes(est.p.estado);

  // campo que guarda al salir
  const campo = (valor, guardar, attrs = {}) => {
    const i = el(attrs.multilinea ? 'textarea' : 'input', { value: valor ?? '', ...attrs, multilinea: null });
    if (!abiertoP()) i.disabled = true;
    const ir = () => { if (String(valor ?? '') === i.value) return; valor = i.value; guardar(i.value); };
    i.addEventListener('change', ir);
    if (!attrs.multilinea) i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') i.blur(); });
    return i;
  };
  const chipsPartida = (pa) => {
    const e = pa.estados || {}; const out = [];
    const nuevos = pa.lineas.filter((l) => l.nuevo).length;
    if (!pa.lineas.length) return el('span', { class: 'ayuda' }, 'sin descomponer');
    if (nuevos) out.push(el('span', { class: 'pz-chip real' }, `${nuevos} precio nuevo`));
    if (e.estimado) out.push(el('span', { class: 'pz-chip estimado' }, `${e.estimado} estimado${e.estimado === 1 ? '' : 's'}`));
    if (e.solicitado) out.push(el('span', { class: 'pz-chip solicitado' }, `${e.solicitado} solicitado${e.solicitado === 1 ? '' : 's'}`));
    if (!out.length) out.push(el('span', { class: 'pz-chip real' }, 'todo real'));
    return out;
  };

  /* ---------- ficha del presupuesto ---------- */
  async function opciones() {
    if (!est.clientes) est.clientes = await api('GET', '/api/clientes').catch(() => []);
    if (!est.obras) est.obras = (await api('GET', '/api/obras?vista=todas').catch(() => ({ obras: [] }))).obras || [];
  }
  // buscador sencillo con datalist (hay cientos de clientes)
  function elegir(lista, actualId, guardar, etiqueta) {
    const id = `dl-${etiqueta}`;
    const actual = lista.find((x) => x.id === actualId);
    const i = el('input', { list: id, value: actual?.nombre || '', placeholder: 'Escribe para buscar…', 'aria-label': etiqueta });
    if (!abiertoP()) i.disabled = true;
    const dl = el('datalist', { id }, lista.map((x) => el('option', { value: x.nombre })));
    i.addEventListener('change', () => {
      if (!i.value.trim()) { guardar(null); return; }
      const x = lista.find((y) => y.nombre === i.value);
      if (x) guardar(x.id); else { aviso('Elige uno de la lista (se crean en Proyectos › Clientes / Obras)'); i.value = actual?.nombre || ''; }
    });
    return [i, dl];
  }

  function pintarFicha() {
    const p = est.p;
    const put = (b, msg) => hacer('PUT', `/api/presupuestos/${p.id}`, b, msg);
    const estados = [];
    if (p.estado === 'preparacion') estados.push(el('button', { type: 'button', class: 'ghost', onclick: () => put({ estado: 'enviado' }, 'Marcado como enviado') }, '📤 Marcar enviado'));
    if (p.estado === 'enviado') {
      estados.push(el('button', { type: 'button', class: 'ghost', onclick: () => put({ estado: 'aceptado' }, 'Aceptado por el cliente') }, '✔ Aceptado'));
      estados.push(el('button', { type: 'button', class: 'ghost', onclick: () => { const n = prompt('¿Por qué lo ha rechazado? (opcional)'); if (n !== null) put({ estado: 'rechazado', nota: n }, 'Rechazado'); } }, '✕ Rechazado'));
    }
    if (p.estado !== 'preparacion') estados.push(el('button', { type: 'button', class: 'ghost', onclick: () => put({ estado: 'preparacion' }, 'Vuelve a preparación') }, '↶ A preparación'));
    const [cli, dlc] = elegir(est.clientes || [], p.cliente_id, (v) => put({ cliente_id: v }, 'Cliente guardado'), 'Cliente');
    const [obr, dlo] = elegir(est.obras || [], p.obra_id, (v) => put({ obra_id: v }, 'Obra guardada'), 'Obra');
    const pendientes = p.pendientes.estimado + p.pendientes.solicitado;

    const filas = [];
    for (const c of p.capitulos) {
      filas.push(el('tr', { class: 'pz-cap' },
        el('td', {}, c.id ? el('div', { class: 'pz-cap-nom' }, el('span', {}, `${c.codigo || ''} ·`), campo(c.nombre, (v) => hacer('PUT', `/api/presupuesto-capitulos/${c.id}`, { nombre: v }), { 'aria-label': 'Nombre del capítulo', class: 'pz-in-cap' })) : el('b', {}, c.nombre)),
        el('td', {}), el('td', {}), el('td', { class: 'n' }, eur0(c.coste)), el('td', {}), el('td', { class: 'n' }, eur0(c.venta)),
        el('td', {}, abiertoP() && c.id ? [
          el('button', { type: 'button', class: 'ghost mini', onclick: () => nuevaPartida(c.id) }, '＋ Partida'),
          c.partidas.length ? null : el('button', { type: 'button', class: 'ghost mini', title: 'Quitar el capítulo', onclick: () => hacer('DELETE', `/api/presupuesto-capitulos/${c.id}`, null, 'Capítulo quitado') }, '✕'),
        ] : null)));
      for (const pa of c.partidas) {
        filas.push(el('tr', { class: 'pz-par', tabindex: 0, onclick: () => abrir(p.id, pa.id), onkeydown: (ev) => { if (ev.key === 'Enter') abrir(p.id, pa.id); } },
          el('td', {}, el('span', { class: 'pz-cod' }, pa.codigo || ''), ' ', pa.nombre, pa.descripcion ? null : el('small', { class: 'pz-naranja' }, 'sin descripción comercial')),
          el('td', { class: 'n' }, `${fmt(pa.medicion)} ${ud(pa.unidad)}`), el('td', { class: 'n' }, eur(pa.coste_ud)), el('td', { class: 'n' }, eur0(pa.coste)),
          el('td', { class: 'n' }, eur(pa.venta_ud)), el('td', { class: 'n' }, eur0(pa.venta), pa.dto_pct ? el('small', { class: 'pz-dto-chip' }, `dto. ${fmt(pa.dto_pct)} %`) : null), el('td', {}, chipsPartida(pa))));
      }
    }
    if (p.dto_general) {
      filas.push(el('tr', { class: 'pz-sub' }, el('td', {}, 'Suma de partidas'), el('td', {}), el('td', {}), el('td', {}), el('td', {}), el('td', { class: 'n' }, eur0(p.suma)), el('td', {})));
      filas.push(el('tr', { class: 'pz-sub' }, el('td', {}, `Descuento comercial (${fmt(p.dto_general_pct)} %)`), el('td', {}), el('td', {}), el('td', {}), el('td', {}), el('td', { class: 'n' }, `−${eur0(p.dto_general)}`), el('td', {})));
    }
    filas.push(el('tr', { class: 'pz-tot' }, el('td', {}, p.dto_total ? 'Total (base imponible)' : 'Total'), el('td', {}), el('td', {}), el('td', { class: 'n' }, eur0(p.coste)), el('td', {}), el('td', { class: 'n' }, eur0(p.venta)), el('td', {})));

    $('#pz-det').replaceChildren(
      el('div', { class: 'pz-card' },
        el('div', { class: 'pz-cab' },
          el('div', { class: 'pz-tit' }, el('span', { class: 'pz-cod' }, p.codigo), campo(p.titulo, (v) => put({ titulo: v }), { class: 'pz-in-tit', 'aria-label': 'Título del presupuesto' })),
          el('span', { class: `pz-chip ${p.estado}` }, ESTADO[p.estado] || p.estado)),
        el('div', { class: 'ayuda' }, `Preparado por ${p.creado_por_nombre || '—'} · ${fecha(p.creado)}${p.enviado_en ? ` · enviado ${fecha(p.enviado_en)}` : ''}${p.decidido_en ? ` · ${ESTADO[p.estado]} ${fecha(p.decidido_en)}` : ''}${p.decision_nota ? ` · «${p.decision_nota}»` : ''}`),
        el('div', { class: 'pz-campos' },
          el('label', {}, el('span', {}, 'Cliente'), cli, dlc), el('label', {}, el('span', {}, 'Obra'), obr, dlo),
          el('label', {}, el('span', {}, 'Gastos generales %'), campo(fmt(p.gg_pct), (v) => put({ gg_pct: leer(v) }, 'Margen cambiado'), { class: 'pz-num', inputmode: 'decimal' })),
          el('label', {}, el('span', {}, 'Beneficio %'), campo(fmt(p.bi_pct), (v) => put({ bi_pct: leer(v) }, 'Margen cambiado'), { class: 'pz-num', inputmode: 'decimal' })),
          el('label', {}, el('span', {}, 'Validez (días)'), campo(p.validez_dias, (v) => put({ validez_dias: v }), { class: 'pz-num', inputmode: 'numeric' }))),
        bloqueIA(p),
        p.pendientes.nuevos ? el('div', { class: 'pz-nuevos' }, `🔔 ${p.pendientes.nuevos} precio(s) nuevo(s) de proveedores. `,
          el('button', { type: 'button', class: 'primario mini', onclick: () => hacer('POST', `/api/presupuestos/${p.id}/aplicar-todos`, {}, (r) => `${r.aplicados} precio(s) aplicados`) }, 'Aplicar todos'),
          el('span', { class: 'ayuda' }, ' o uno a uno en su partida.')) : null,
        el('div', { class: 'tabla-scroll' }, el('table', { class: 'pz-tabla' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Capítulo / partida'), el('th', { class: 'n' }, 'Medición'), el('th', { class: 'n' }, 'Coste / ud'), el('th', { class: 'n' }, 'Coste'),
            el('th', { class: 'n' }, 'Venta / ud'), el('th', { class: 'n' }, 'Venta'), el('th', {}, 'Precios'))),
          el('tbody', {}, filas))),
        bloqueDescuento(p, put),
        el('div', { class: 'pz-acc' },
          abiertoP() ? el('button', { type: 'button', class: 'ghost', onclick: () => hacer('POST', `/api/presupuestos/${p.id}/capitulos`, {}, 'Capítulo añadido') }, '＋ Capítulo') : null,
          abiertoP() && p.capitulos[0]?.id ? el('button', { type: 'button', class: 'ghost', onclick: () => nuevaPartida(p.capitulos[p.capitulos.length - 1].id) }, '＋ Partida') : null,
          abiertoP() ? el('button', { type: 'button', class: pendientes ? 'primario' : 'ghost', onclick: dialogoPedir }, `✉ Pedir precio de lo pendiente${p.pendientes.estimado ? ` (${p.pendientes.estimado})` : ''}`) : null,
          abiertoP() ? el('button', { type: 'button', class: 'ghost', title: 'Vuelve a coger los precios de la lista y de la tarifa (no toca lo escrito a mano ni lo pedido)', onclick: () => hacer('POST', `/api/presupuestos/${p.id}/actualizar-precios`, {}, (r) => `${r.cambiados} precio(s) actualizados`) }, '⟳ Actualizar precios') : null,
          el('a', { class: 'boton ghost', href: `/api/presupuestos/${p.id}/pdf`, target: '_blank', rel: 'noopener' }, '📄 PDF cliente'),
          el('a', { class: 'boton ghost', href: `/api/presupuestos/${p.id}/pdf?detallado=1`, target: '_blank', rel: 'noopener', title: 'Con la descomposición de cada partida a precio de venta' }, '📄 PDF detallado'),
          el('a', { class: 'boton ghost', href: `/api/presupuestos/${p.id}/pdf?interno=1`, target: '_blank', rel: 'noopener', title: 'Documento interno: costes línea a línea, origen de cada precio, margen y beneficio. No es para el cliente.' }, '🔒 PDF interno de costes'),
          ...estados,
          p.estado === 'preparacion' ? el('button', { type: 'button', class: 'ghost peligro', onclick: async () => { if (!confirm(`¿Borrar ${p.codigo}?`)) return; try { await api('DELETE', `/api/presupuestos/${p.id}`); est.id = null; url(); cargar(); cargarLista(); } catch (e) { aviso(e.message); } } }, 'Borrar') : null),
        el('details', { class: 'pz-doc', open: !p.alcance }, el('summary', {}, '📄 Lo que sale en el PDF del cliente'),
          el('div', { class: 'pz-doc-grid' },
            el('label', { class: 'ancho' }, el('span', {}, 'Alcance del suministro (recuadro verde)'), campo(p.alcance || '', (v) => put({ alcance: v }, 'Guardado'), { multilinea: true, rows: 2, placeholder: 'Qué incluye: fabricación, materiales, acabado, montaje…' })),
            el('label', {}, el('span', {}, 'Atención (persona)'), campo(p.atencion || '', (v) => put({ atencion: v }, 'Guardado'), { placeholder: p.cliente_contacto || 'Persona de contacto del cliente' })),
            el('label', {}, el('span', {}, 'Calidad / normativa'), campo(p.calidad || '', (v) => put({ calidad: v }, 'Guardado'), { placeholder: 'Acero S275JR · galvanizado UNE-EN ISO 1461…' })),
            el('label', {}, el('span', {}, 'Plazo de ejecución'), campo(p.plazo || '', (v) => put({ plazo: v }, 'Guardado'), { placeholder: '3 a 4 semanas desde la confirmación' })),
            el('label', {}, el('span', {}, 'Forma de pago'), campo(p.forma_pago || '', (v) => put({ forma_pago: v }, 'Guardado'), { placeholder: '100% a la aceptación del presupuesto' })),
            el('label', {}, el('span', {}, 'Condiciones comerciales y logística (una por línea)'), campo(p.condiciones || '', (v) => put({ condiciones: v }, 'Guardado'), { multilinea: true, rows: 4, placeholder: 'Entrega: transporte y descarga en obra…' })),
            el('label', {}, el('span', {}, 'Exclusiones y aclaraciones técnicas (una por línea)'), campo(p.exclusiones || '', (v) => put({ exclusiones: v }, 'Guardado'), { multilinea: true, rows: 4, placeholder: 'No incluye albañilería ni ayudas de obra…' }))))),
      el('div', { class: 'pz-kpis' },
        el('div', { class: 'pz-kpi' }, el('small', {}, 'Coste técnico'), el('b', {}, eur0(p.coste)), el('small', {}, p.real_pct == null ? '—' : `${p.real_pct} % del coste con precio real o de tarifa`)),
        el('div', { class: 'pz-kpi' }, el('small', {}, 'Margen'), el('b', { class: p.perdidas || p.no_cubre_gg ? 'pz-rojo' : '' }, `+ ${fmt(p.dto_total ? p.margen_real_pct : p.margen_pct)} %`), el('small', {}, p.dto_total ? `tras el descuento (sin él, +${fmt(p.margen_pct)} %)` : `GG ${fmt(p.gg_pct)} % + beneficio ${fmt(p.bi_pct)} %`)),
        el('div', { class: 'pz-kpi' }, el('small', {}, 'Precio de venta (sin IVA)'), el('b', { class: 'pz-verde' }, eur0(p.venta)), el('small', {}, `con IVA ${eur0(p.venta * 1.21)}${p.dto_total ? ` · dto. ${fmt(p.dto_total_pct)} %` : ''}`)),
        el('div', { class: 'pz-kpi' }, el('small', {}, 'Pendiente'), el('b', { class: pendientes ? 'pz-naranja' : 'pz-verde' }, pendientes ? `${pendientes} precio${pendientes === 1 ? '' : 's'}` : 'nada'),
          el('small', {}, `${p.pendientes.estimado} estimados · ${p.pendientes.solicitado} solicitados${p.pendientes.nuevos ? ` · ${p.pendientes.nuevos} nuevos` : ''}`))));
  }

  // 🏷 Descuento: general (% o «dejarlo en X €») + los de las partidas; margen que queda y aprobación si pasa del límite
  function bloqueDescuento(p, put) {
    const puedeAprobar = window.s360.tiene('aprobar_descuentos');
    const hay = p.dto_total > 0;
    const motivos = el('datalist', { id: 'pz-dto-motivos' }, ['Cliente habitual', 'Competencia', 'Volumen de obra', 'Pronto pago', 'Redondeo', 'Cortesía comercial'].map((m) => el('option', { value: m })));
    const estado = [];
    if (p.dto_necesita) {
      estado.push(el('p', { class: 'pz-rojo' }, `⚠ El descuento (${fmt(p.dto_max_pct)} %) pasa del límite sin aprobación (${fmt(p.dto_limite)} %). No se puede marcar como enviado hasta que se apruebe; el PDF del cliente sale como borrador.`));
      if (puedeAprobar) estado.push(el('div', { class: 'pz-acc' },
        el('button', { type: 'button', class: 'primario mini', onclick: () => hacer('POST', `/api/presupuestos/${p.id}/descuento/decidir`, { ok: true }, 'Descuento aprobado') }, '✔ Aprobar el descuento'),
        el('button', { type: 'button', class: 'ghost mini', onclick: () => { const n = prompt('¿Por qué no se aprueba?'); if (n) hacer('POST', `/api/presupuestos/${p.id}/descuento/decidir`, { ok: false, nota: n }, 'Descuento no aprobado'); } }, '✕ No aprobar'),
        p.dto_pedido_en ? el('span', { class: 'ayuda' }, ` Pedido el ${fecha(p.dto_pedido_en)}`) : null));
      else estado.push(p.dto_pedido_en ? el('p', { class: 'pz-azul' }, `⏳ Esperando aprobación (pedida el ${fecha(p.dto_pedido_en)})`)
        : el('button', { type: 'button', class: 'primario mini', onclick: () => hacer('POST', `/api/presupuestos/${p.id}/descuento/pedir`, {}, 'Aprobación pedida: les llega un aviso') }, '✉ Pedir aprobación'));
    } else if (p.dto_aprobado_en && hay && p.dto_max_pct > p.dto_limite) estado.push(el('p', { class: 'pz-verde' }, `✔ Aprobado hasta el ${fmt(p.dto_aprobado_pct)} % (${fecha(p.dto_aprobado_en)})`));
    if (p.dto_respuesta) estado.push(el('p', { class: 'ayuda' }, `Respuesta: ${p.dto_respuesta}`));
    const limite = puedeAprobar || window.s360.tiene('usuarios')
      ? el('label', { class: 'pz-dto-lim' }, 'Límite sin aprobación ', el('input', { class: 'pz-num', inputmode: 'decimal', value: fmt(p.dto_limite), 'aria-label': 'Límite de descuento sin aprobación (%)',
        onchange: async (ev) => { try { await api('PUT', '/api/presupuestos-ajustes', { dto_limite: leer(ev.target.value) }); aviso('Límite guardado para todos los presupuestos'); cargar(); } catch (e) { aviso(e.message); } } }), ' %')
      : el('span', { class: 'ayuda' }, `Límite sin aprobación: ${fmt(p.dto_limite)} %`);
    return el('details', { class: 'pz-dto', open: hay || p.dto_necesita },
      el('summary', {}, '🏷 Descuento', hay ? el('span', { class: p.dto_necesita ? 'pz-rojo' : 'pz-verde' }, ` · −${eur0(p.dto_total)} (${fmt(p.dto_total_pct)} %)`) : null),
      el('div', { class: 'pz-campos' },
        el('label', {}, el('span', {}, 'Descuento general %'), campo(p.dto_pct ? fmt(p.dto_pct) : '', (v) => put({ dto_pct: leer(v) || null }, 'Descuento guardado'), { class: 'pz-num', inputmode: 'decimal', placeholder: p.dto_objetivo ? fmt(p.dto_general_pct) : '0' })),
        el('label', {}, el('span', {}, 'o dejarlo en (€ sin IVA)'), campo(p.dto_objetivo ? fmt(p.dto_objetivo) : '', (v) => { const x = leer(v); put({ dto_objetivo: x || null }, 'Descuento guardado'); }, { class: 'pz-num', inputmode: 'decimal', placeholder: fmt(Math.round(p.suma)) })),
        el('label', { class: 'ancho' }, el('span', {}, 'Motivo'), campo(p.dto_motivo || '', (v) => put({ dto_motivo: v }, 'Guardado'), { list: 'pz-dto-motivos', placeholder: 'Cliente habitual, competencia, volumen…' })), motivos),
      el('p', { class: 'ayuda' }, 'El descuento general va sobre la suma de las partidas; el de una partida se pone en la propia partida (Dto. %). Los dos salen en el PDF del cliente. ', limite),
      p.dto_objetivo && p.dto_objetivo > p.suma ? el('p', { class: 'pz-naranja' }, `«Dejarlo en» ${eur0(p.dto_objetivo)} es más que la suma de las partidas (${eur0(p.suma)}): no se aplica descuento general.`) : null,
      hay ? el('p', {}, `Venta sin descuento ${eur0(p.venta_bruta)}`, p.dto_partidas ? ` · en partidas −${eur0(p.dto_partidas)}` : '', p.dto_general ? ` · general −${eur0(p.dto_general)}` : '', ' → ', el('b', {}, `${eur0(p.venta)} sin IVA`),
        el('br'), el('span', { class: p.perdidas || p.no_cubre_gg ? 'pz-rojo' : 'pz-verde' },
          p.perdidas ? `⛔ Se pierde dinero: ${eur0(p.beneficio)} (por debajo del coste)` : p.no_cubre_gg ? `⚠ Queda ${eur0(p.beneficio)} (+${fmt(p.margen_real_pct)} % sobre coste): no cubre los gastos generales (${fmt(p.gg_pct)} %)` : `Beneficio que queda: ${eur0(p.beneficio)} (+${fmt(p.margen_real_pct)} % sobre coste)`)) : null,
      ...estado);
  }

  // Lo que hizo la IA: resumen, dudas, avisos, adjuntos y «Rehacer con IA»
  function bloqueIA(p) {
    if (!p.ia_estado && !p.prompt) return null;
    const caja = el('details', { class: `pz-ia${p.ia_estado === 'error' ? ' error' : ''}`, open: p.ia_estado === 'error' || (p.ia_dudas || []).length > 0 || (p.eventos || []).some((e) => e.clase === 'respuesta') });
    const dudas = p.ia_dudas || []; const avisos = p.ia_avisos || [];
    caja.append(...[el('summary', {}, p.ia_estado === 'error' ? `⚠ La IA no pudo prepararlo: ${p.ia_error}` : `🤖 Preparado por la IA${p.origen === 'correo' ? ' desde un correo' : ''}${p.ia_modelo ? ` · ${p.ia_modelo}` : ''}${p.ia_ms ? ` · ${Math.round(p.ia_ms / 1000)} s` : ''}${dudas.length ? ` · ${dudas.length} duda${dudas.length === 1 ? '' : 's'}` : ''}`),
      p.ia_resumen ? el('p', {}, p.ia_resumen) : null,
      dudas.length ? el('div', {}, el('b', {}, 'Dudas (lo que ha supuesto o falta saber):'), el('ul', {}, dudas.map((d) => el('li', {}, d.partida ? el('span', { class: 'pz-cod' }, `${d.partida}: `) : null, d.texto)))) : null,
      avisos.length ? el('div', {}, el('b', {}, 'Avisos:'), el('ul', {}, avisos.map((a) => el('li', {}, a)))) : null,
      p.prompt ? el('div', {}, el('b', {}, 'Lo que se pidió:'), el('blockquote', { class: 'pz-prompt-ver' }, p.prompt)) : null,
      (p.ia_skills || []).length ? el('p', { class: 'ayuda' }, `🧠 Skills usadas: ${p.ia_skills.join(' · ')}`) : null,
      el('div', { class: 'pz-acc' }, el('button', { type: 'button', class: 'ghost mini', title: 'Compara lo que propuso la IA con cómo lo has dejado y propone mejoras para las Skills (las revisas tú antes de aplicarlas). Se hace solo al marcarlo como enviado.', onclick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = '🧠 Aprendiendo…';
        try { const r = await api('POST', `/api/presupuestos/${p.id}/aprender`); aviso(r.propuestas ? `${r.propuestas} mejora(s) propuesta(s): revísalas` : 'No hay nada nuevo que aprender de este presupuesto'); if (r.propuestas) dialogoSkills(); }
        catch (e) { aviso(e.message); } finally { b.disabled = false; b.textContent = '🧠 Aprender de este presupuesto'; }
      } }, '🧠 Aprender de este presupuesto'), p.aprendido_en ? el('span', { class: 'ayuda' }, ` · aprendido el ${fecha(p.aprendido_en)}`) : null)].filter(Boolean));
    const ev = p.eventos || [];
    if (ev.length) caja.append(el('div', { class: 'pz-eventos' }, el('b', {}, 'Correo con el cliente:'),
      el('ul', {}, ev.map((e) => el('li', { class: `pz-ev-${e.clase}` }, el('span', { class: 'pz-ev-f' }, new Date(e.creado).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })), ' ', e.texto,
        e.correo_id && window.s360.tiene('compras') ? [' ', el('a', { href: `/correo.html?id=${e.correo_id}`, class: 'pz-ev-l' }, 'ver correo')] : null))),
      (p.datos_pedidos || []).length ? el('p', { class: 'ayuda' }, `Datos pedidos al cliente: ${p.datos_pedidos.join(', ')}. Si contesta en el mismo hilo, se rellenan solos.`) : null));
    const adj = el('div', { class: 'pz-adj-chips' }); caja.append(adj);
    api('GET', `/api/presupuestos/${p.id}/adjuntos`).then((ls) => adj.replaceChildren(...(ls.length ? [el('b', {}, 'Adjuntos: ')] : []), ...ls.map((a) => el('a', { class: 'pz-adj', href: `/api/presupuestos-adjuntos/${a.id}`, target: '_blank', rel: 'noopener' }, `📎 ${a.nombre}`)))).catch(() => {});
    if (p.estado === 'preparacion') caja.append(el('div', { class: 'pz-acc' }, el('button', { type: 'button', class: 'ghost', onclick: () => dialogoRehacer(p) }, '🤖 Rehacer con IA…')));
    return caja;
  }
  function dialogoRehacer(p) {
    const t = el('textarea', { rows: 6, class: 'pz-prompt', value: p.prompt || '' });
    const z = zonaAdjuntos();
    const d = el('dialog', { class: 'dlg-cos pz-dlg' }, el('h2', {}, `🤖 Rehacer ${p.codigo} con IA`),
      el('p', { class: 'ayuda pz-naranja' }, 'Se borran los capítulos y partidas actuales y la IA lo prepara de nuevo con este texto, los adjuntos que ya tiene y los que añadas.'),
      t, z.caja,
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          try { const ids = await subirAdjuntos(z.archivos(), p.id); await api('POST', `/api/presupuestos/${p.id}/ia`, { prompt: t.value, adjunto_ids: ids }); d.close(); cargar(); }
          catch (e) { aviso(e.message); }
        } }, '🤖 Rehacer')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
  }

  async function nuevaPartida(capId) {
    const r = await hacer('POST', `/api/presupuestos/${est.p.id}/partidas`, { capitulo_id: capId, nombre: 'Partida nueva', unidad: 'ud', medicion: 1 }, 'Partida creada');
    if (r?.partida_nueva) abrir(est.p.id, r.partida_nueva);
  }

  /* ---------- editor de partida ---------- */
  function buscarPartida() {
    for (const c of est.p.capitulos) for (const pa of c.partidas) if (pa.id === est.partida) return pa;
    return null;
  }
  const infoPrecio = (l) => {
    const i = l.precio_info || {};
    const t = [];
    if (l.fuente === 'lista' || l.fuente === 'oferta') t.push([i.proveedor, i.fecha ? fecha(i.fecha) : null, i.viejo ? `hace ${i.dias} días` : null, i.cotizo ? `cotizó ${pu(i.cotizo.precio)} €/${ud(i.cotizo.unidad)}` : null, i.sol_codigo].filter(Boolean).join(' · '));
    if (l.fuente === 'tarifa') t.push([i.coste_ficha != null && i.rendimiento_pct ? `coste ${pu(i.coste_ficha)} €/${ud(l.unidad)} ÷ rend. ${i.rendimiento_pct} %` : null, i.venta ? `venta tarifa ${pu(i.venta)} €/${ud(l.unidad)}` : null].filter(Boolean).join(' · '));
    if (l.estado_precio === 'solicitado') t.push(`${l.sol_codigo || 'petición'}${l.sol_responder_antes ? ` · hasta ${fecha(l.sol_responder_antes)}` : ''}${l.ofertas ? ` · ${l.ofertas} oferta(s)` : ' · esperando ofertas'}`);
    if (l.sol_cerrada) t.push('la petición se cerró sin ofertas');
    if (i.aviso) t.push(i.aviso);
    if (l.calculo_txt) t.push(`🧮 ${l.calculo_txt}`);
    return t.filter(Boolean).join(' · ');
  };

  async function pintarPartida() {
    const p = est.p; const pa = buscarPartida();
    if (!pa) { est.partida = null; url(); pintarFicha(); return; }
    if (!est.tarifa) est.tarifa = await api('GET', '/api/tarifa').catch(() => ({ mano_obra: [], maquinaria: [] }));
    const putP = (b, msg) => hacer('PUT', `/api/presupuesto-partidas/${pa.id}`, b, msg);
    const putL = async (l, b, msg) => {
      const r = await hacer('PUT', `/api/presupuesto-lineas/${l.id}`, b, msg);
      const s = r?.sugerencia_tarifa;
      // mano de obra / maquinaria corregida: ¿se fija en la tarifa para los próximos presupuestos?
      if (s && confirm(`Has puesto ${pu(s.nuevo)} €/${s.unidad || 'h'} para «${s.nombre}» y la tarifa da ${s.actual == null ? 'sin coste' : `${pu(s.actual)} €/${s.unidad || 'h'}`}.\n\n¿Lo fijo en la Tarifa para los próximos presupuestos?`)) {
        try { await api('POST', '/api/presupuestos/tarifa-desde-linea', { tarifa_id: s.tarifa_id, coste: s.nuevo }); est.tarifa = null; pintar(); aviso(`Tarifa: ${s.nombre} a ${pu(s.nuevo)} €/${s.unidad || 'h'}`); } catch (e) { aviso(e.message); }
      }
      return r;
    };
    const lineas = [];
    for (const [tipo, titulo] of TIPOS) {
      const ls = pa.lineas.filter((l) => l.tipo === tipo);
      lineas.push(el('tr', { class: 'pz-tipo' }, el('td', { colspan: 8 }, titulo)));
      // precio en la unidad que se quiera (€/kg en perfiles, €/barra…): el sistema lo pasa a la de la línea
      const precioLinea = (l) => {
        const uv = l.unidad_ver || l.unidad;
        const val = l.unidad_ver ? l.precio_ver : l.precio;
        const inp = campo(fmt(val == null ? '' : +Number(val).toFixed(4)), (v) => putL(l, { precio: leer(v), precio_unidad: uv }, l.unidad_ver ? `Precio en €/${ud(uv)}: pasado a €/${ud(l.unidad)}` : 'Precio a mano: queda como estimado'),
          { class: `pz-num${l.precio == null ? ' falta' : ''}`, inputmode: 'decimal', 'aria-label': `Coste por ${ud(uv)}` });
        const us = l.unidades || [l.unidad];
        const sel = us.length > 1 && abiertoP()
          ? el('select', { class: 'pz-upre', 'aria-label': 'Unidad del precio', title: l.equiv_txt || '', onchange: (ev) => putL(l, { precio_unidad: ev.target.value }, `Precio en €/${ud(ev.target.value)}`) },
            us.map((u) => el('option', { value: u, selected: u === uv }, `€/${ud(u)}`)))
          : el('span', { class: 'ayuda' }, ` €/${ud(uv)}`);
        return el('div', { class: 'pz-precio' }, el('div', { class: 'pz-precio-fila' }, inp, sel),
          l.unidad_ver && l.precio != null ? el('small', { class: 'ayuda' }, `= ${pu(+Number(l.precio).toFixed(2))} €/${ud(l.unidad)}`) : null);
      };
      for (const l of ls) {
        const opcionesT = tipo === 'mano_obra' ? est.tarifa.mano_obra : tipo === 'maquinaria' ? est.tarifa.maquinaria : null;
        const concepto = opcionesT && l.tarifa_id
          ? el('select', { disabled: !abiertoP(), 'aria-label': 'De la tarifa', onchange: (ev) => putL(l, { tarifa_id: ev.target.value }, 'Cambiado') }, opcionesT.filter((t) => t.activo || t.id === l.tarifa_id).map((t) => el('option', { value: t.id, selected: t.id === l.tarifa_id }, t.nombre)))
          : tipo === 'material' && abiertoP() ? buscadorMaterial((b) => putL(l, b, b.nuevo_material ? 'Añadido a la lista de materiales' : 'Material cambiado'), { valor: l.concepto, placeholder: 'Material de la lista', clase: 'pz-in-con' })
            : campo(l.concepto, (v) => putL(l, { concepto: v }), { class: 'pz-in-con', 'aria-label': 'Concepto' });
        lineas.push(el('tr', { class: l.nuevo ? 'pz-con-nuevo' : '' },
          el('td', {}, concepto, l.tipo === 'material' ? el('small', {}, l.catalogo_id ? (l.equiv_txt || 'de la lista') : '⚠ no está en la lista: elígelo') : null),
          el('td', { class: 'n' }, l.calculo === 'l_pintura' ? el('span', { class: 'pz-lpint', title: l.calculo_txt }, campo(fmt(l.por_ud), (v) => putL(l, { por_ud: leer(v) }), { class: 'pz-num', inputmode: 'decimal', 'aria-label': 'Consumo en l/m²' }), el('small', {}, ` l/m² × ${pu(l.m2_pintura)} m² = ${pu(l.cantidad_ud)} l`)) : l.calculo ? el('span', { title: l.calculo_txt }, pu(l.cantidad_ud)) : campo(fmt(l.por_ud), (v) => putL(l, { por_ud: leer(v) }), { class: 'pz-num', inputmode: 'decimal', 'aria-label': `Cantidad por ${ud(pa.unidad)}` }),
            ['auxiliar', 'subcontrata'].includes(l.tipo) && abiertoP() ? el('select', { class: 'pz-calc', 'aria-label': 'Cómo se calcula la cantidad', onchange: (ev) => putL(l, { calculo: ev.target.value || null }, 'Cálculo cambiado') },
              [['', 'a mano'], ['kg_perfiles', 'Σ kg perfiles'], ['m2_perfiles', 'Σ m² pintura'], ['l_pintura', 'l/m² × Σ m² pintura']].map(([v, t]) => el('option', { value: v, selected: (l.calculo || '') === v }, t))) : null),
          el('td', {}, l.calculo || l.tarifa_id || (l.tipo === 'material' && l.catalogo_id) ? el('span', { title: l.equiv_txt || '' }, ud(l.unidad)) : campo(l.unidad, (v) => putL(l, { unidad: v }), { class: 'pz-ud', 'aria-label': 'Unidad' })),
          el('td', { class: 'n' }, `${pu(l.cantidad_total)} ${ud(l.unidad)}`),
          el('td', { class: 'n' }, precioLinea(l)),
          el('td', { class: 'n' }, eur(l.importe)),
          el('td', {}, el('span', { class: `pz-chip ${CHIP[l.estado_precio]}` }, l.estado_precio), el('small', {}, infoPrecio(l)),
            l.nuevo ? el('div', { class: 'pz-nuevo' }, `Nuevo: ${pu(l.nuevo.precio)} €/${ud(l.unidad)} · ${l.nuevo.proveedor} `,
              el('button', { type: 'button', class: 'primario mini', onclick: () => hacer('POST', `/api/presupuesto-lineas/${l.id}/aplicar`, { sp_id: l.nuevo.sp_id }, 'Precio aplicado') }, 'Aplicar')) : null),
          el('td', {}, abiertoP() ? el('button', { type: 'button', class: 'ghost mini', title: 'Quitar', onclick: () => hacer('DELETE', `/api/presupuesto-lineas/${l.id}`, null, 'Quitada') }, '✕') : null)));
      }
      if (abiertoP()) lineas.push(el('tr', { class: 'pz-add' }, el('td', { colspan: 8 }, anadir(tipo, pa))));
    }
    lineas.push(el('tr', { class: 'pz-tot' }, el('td', {}, 'Coste técnico de la partida'), el('td', {}), el('td', {}), el('td', {}),
      el('td', { class: 'n' }, `${eur(pa.coste_ud)}/${ud(pa.unidad)}`), el('td', { class: 'n' }, eur(pa.coste)),
      el('td', { colspan: 2 }, el('small', {}, `venta ${eur(pa.venta_ud)}/${ud(pa.unidad)} · ${eur(pa.venta)} (+${fmt(p.margen_pct)} %)${pa.kg_ud ? ` · ${pu(pa.kg_ud)} kg/${ud(pa.unidad)}` : ''}${pa.m2_ud ? ` · ${pu(pa.m2_ud)} m² pintura/${ud(pa.unidad)}` : ''}`))));

    $('#pz-det').replaceChildren(
      el('div', { class: 'pz-card' },
        el('div', { class: 'pz-miga' }, el('button', { type: 'button', class: 'ghost mini', onclick: () => abrir(p.id) }, '← Volver al presupuesto'), ` ${p.codigo} · ${p.titulo}`),
        el('div', { class: 'pz-campos pz-campos-par' },
          el('label', {}, el('span', {}, 'Código'), campo(pa.codigo, (v) => putP({ codigo: v }), { class: 'pz-cod-in' })),
          el('label', { class: 'ancho' }, el('span', {}, 'Nombre interno'), campo(pa.nombre, (v) => putP({ nombre: v }))),
          el('label', {}, el('span', {}, 'Unidad'), campo(pa.unidad, (v) => putP({ unidad: v }), { class: 'pz-ud' })),
          el('label', {}, el('span', {}, 'Medición'), campo(fmt(pa.medicion), (v) => putP({ medicion: leer(v) }), { class: 'pz-num', inputmode: 'decimal' })),
          el('label', { title: 'Descuento de esta partida: sale en el PDF del cliente (precio, «Dto. %» y subtotal ya rebajado)' }, el('span', {}, 'Dto. %'), campo(pa.dto_pct ? fmt(pa.dto_pct) : '', (v) => putP({ dto_pct: leer(v) || null }, 'Descuento de la partida guardado'), { class: 'pz-num', inputmode: 'decimal', placeholder: '0' })),
          el('label', {}, el('span', {}, 'Capítulo'), el('select', { disabled: !abiertoP(), onchange: (ev) => putP({ capitulo_id: ev.target.value }, 'Movida de capítulo') }, p.capitulos.filter((c) => c.id).map((c) => el('option', { value: c.id, selected: c.id === pa.capitulo_id }, `${c.codigo} · ${c.nombre}`))))),
        el('label', { class: 'pz-cond' }, el('span', {}, 'Descripción comercial ', el('small', {}, '(la que ve el cliente en el presupuesto)')),
          campo(pa.descripcion || '', (v) => putP({ descripcion: v }, 'Descripción guardada'), { multilinea: true, rows: 3, placeholder: 'Barandilla de escalera de 1,10 m de altura formada por… Incluye transporte y montaje.' })),
        el('p', { class: 'ayuda' }, `Cada línea: cantidad por ${ud(pa.unidad)} de partida × ${fmt(pa.medicion)} ${ud(pa.unidad)} = total. El precio sale de la lista de precios o de la tarifa; si lo escribes a mano queda «estimado». La descomposición es interna: el cliente solo la ve en el PDF detallado (a precio de venta).`),
        el('div', { class: 'tabla-scroll' }, el('table', { class: 'pz-tabla pz-lineas' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Concepto'), el('th', { class: 'n' }, `Por ${ud(pa.unidad)}`), el('th', {}, 'Ud'), el('th', { class: 'n' }, 'Total'), el('th', { class: 'n' }, '€ coste / ud'), el('th', { class: 'n' }, 'Importe'), el('th', {}, 'Precio'), el('th', {}))),
          el('tbody', {}, lineas))),
        el('div', { class: 'pz-acc' },
          abiertoP() ? el('button', { type: 'button', class: 'ghost', onclick: () => copiarDe(pa) }, '⧉ Copiar de otra partida') : null,
          abiertoP() ? el('button', { type: 'button', class: 'ghost peligro', onclick: () => { if (confirm('¿Borrar esta partida?')) hacer('DELETE', `/api/presupuesto-partidas/${pa.id}`, null, 'Partida borrada').then(() => abrir(p.id)); } }, 'Borrar partida') : null)));
  }

  // fila para añadir una línea de cada tipo
  // Buscador de la lista de materiales: elegir uno o añadir uno nuevo a la lista. elegir({ catalogo_id } | { nuevo_material })
  function buscadorMaterial(elegir, { valor = '', placeholder = '＋ Material: escribe para buscar en la lista (tubo 40x40, UPN 120…)', clase = 'pz-busca' } = {}) {
    const i = el('input', { type: 'search', value: valor, placeholder, class: clase, 'aria-label': 'Material de la lista', autocomplete: 'off' });
    const sug = el('div', { class: 'pz-sug', hidden: true });
    let t = null;
    const fin = (b) => { sug.hidden = true; elegir(b); };
    i.addEventListener('input', () => {
      clearTimeout(t); const q = i.value.trim();
      if (q.length < 2) { sug.hidden = true; return; }
      t = setTimeout(async () => {
        const res = await api('GET', `/api/presupuestos-sugerir?q=${encodeURIComponent(q)}`).catch(() => []);
        sug.replaceChildren(...res.map((m) => el('button', { type: 'button', onmousedown: (ev) => ev.preventDefault(), onclick: () => { i.value = m.nombre; fin({ catalogo_id: m.id }); } }, el('span', {}, m.nombre, m.equiv ? el('small', {}, ` · ${m.equiv}`) : null),
          el('span', { class: m.precio == null ? 'ayuda' : m.estado_precio === 'real' ? 'pz-verde' : 'pz-naranja' }, m.precio == null ? 'sin precio' : `${pu(m.precio)} €/${ud(m.unidad_base)} · ${m.estado_precio === 'real' ? `real ${fecha(m.precio_info?.fecha)}` : m.precio_info?.origen === 'estimado' ? 'estimado' : `hace ${m.precio_info?.dias} días`}`))),
        el('button', { type: 'button', class: 'pz-sug-libre', onmousedown: (ev) => ev.preventDefault(), onclick: () => fin({ nuevo_material: q }) }, `＋ Añadir «${q}» a la lista de materiales`));
        sug.hidden = false;
      }, 250);
    });
    i.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { sug.hidden = true; i.value = valor; i.blur(); } });
    i.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; if (valor) i.value = valor; }, 150));
    return el('div', { class: 'pz-busca-caja' }, i, sug);
  }
  function anadir(tipo, pa) {
    const post = (b) => hacer('POST', `/api/presupuesto-partidas/${pa.id}/lineas`, { tipo, ...b }, 'Añadida');
    if (tipo === 'mano_obra' || tipo === 'maquinaria') {
      const ops = (tipo === 'mano_obra' ? est.tarifa.mano_obra : est.tarifa.maquinaria).filter((t) => t.activo);
      const sel = el('select', { 'aria-label': 'De la tarifa' }, el('option', { value: '' }, tipo === 'mano_obra' ? '＋ Mano de obra de la tarifa…' : '＋ Máquina de la tarifa…'),
        ops.map((t) => el('option', { value: t.id }, `${t.nombre} · ${t.coste_efectivo == null ? 'sin coste' : `${pu(t.coste_efectivo)} €/${t.unidad}`}`)));
      sel.addEventListener('change', () => { if (sel.value) post({ tarifa_id: sel.value, por_ud: 1 }); });
      return [sel, ops.length ? null : el('span', { class: 'ayuda' }, ' La tarifa está vacía: ', el('a', { href: '/tarifa.html' }, 'Informes › Tarifa'))];
    }
    if (tipo === 'material') return buscadorMaterial((b) => post({ ...b, por_ud: 1 }));
    // auxiliar / subcontrata
    const con = el('input', { placeholder: tipo === 'auxiliar' ? '＋ Auxiliar: plataforma, andamio, consumibles…' : '＋ Subcontrata: galvanizado, lacado, transporte…', class: 'pz-in-con', 'aria-label': 'Concepto' });
    const calc = el('select', { 'aria-label': 'Cantidad' }, el('option', { value: '' }, 'cantidad a mano'), el('option', { value: 'kg_perfiles' }, '🧮 kg de los perfiles'), el('option', { value: 'm2_perfiles' }, '🧮 m² de pintura de los perfiles'), el('option', { value: 'l_pintura' }, '🧮 litros: l/m² × m² de pintura'));
    const u = el('input', { value: 'ud', class: 'pz-ud', 'aria-label': 'Unidad' });
    const pr = el('input', { placeholder: '€', class: 'pz-num', inputmode: 'decimal', 'aria-label': 'Precio' });
    calc.addEventListener('change', () => { u.disabled = !!calc.value; if (calc.value) u.value = calc.value === 'kg_perfiles' ? 'kg' : calc.value === 'l_pintura' ? 'l' : 'm2'; });
    const ir = () => { if (!con.value.trim()) { con.focus(); return; } post({ concepto: con.value, calculo: calc.value || null, unidad: u.value, por_ud: calc.value === 'l_pintura' ? 0.2 : 1, precio: leer(pr.value) }); };
    pr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') ir(); });
    return el('div', { class: 'pz-add-fila' }, con, calc, u, pr, el('button', { type: 'button', class: 'ghost mini', onclick: ir }, 'Añadir'));
  }

  function copiarDe(pa) {
    const q = el('input', { type: 'search', placeholder: 'Buscar partida (barandilla, escalera…)', 'aria-label': 'Buscar partida' });
    const lista = el('div', { class: 'pz-copiar' });
    const d = el('dialog', { class: 'dlg-cos pz-dlg' }, el('h2', {}, '⧉ Copiar de otra partida'),
      el('p', { class: 'ayuda' }, 'Se crea una partida nueva igual (descripción, medición y descomposición) en el mismo capítulo; después la cambias.'), q, lista,
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cerrar')));
    const buscar = async () => {
      const r = await api('GET', `/api/presupuestos-partidas-buscar?q=${encodeURIComponent(q.value)}`).catch(() => []);
      lista.replaceChildren(...r.filter((x) => x.id !== pa.id).map((x) => el('button', { type: 'button', class: 'pz-item', onclick: async () => {
        d.close(); const res = await hacer('POST', `/api/presupuestos/${est.p.id}/partidas`, { capitulo_id: pa.capitulo_id, copiar_de: x.id }, 'Partida copiada');
        if (res?.partida_nueva) abrir(est.p.id, res.partida_nueva);
      } }, el('b', {}, `${x.codigo || ''} ${x.nombre}`), el('small', {}, `${x.presupuesto} · ${x.titulo} · ${x.lineas} línea(s) · ${ud(x.unidad)}`))));
    };
    let t = null; q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(buscar, 250); });
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); buscar(); q.focus();
  }

  /* ---------- pedir precio ---------- */
  function resultadoEnvio(e = {}, solId) {
    const partes = [];
    if (e.enviados?.length) partes.push(`✔ Enviada a ${e.enviados.map((x) => `${x.proveedor} (${x.para})`).join(', ')}`);
    if (e.sin_correo?.length) partes.push(`⚠ Sin correo en su ficha: ${e.sin_correo.join(', ')} (envíasela a mano desde Compras)`);
    if (e.errores?.length) partes.push(`✕ No se pudo enviar: ${e.errores.join(' · ')}`);
    aviso(e.enviados?.length && !e.errores?.length && !e.sin_correo?.length ? 'Petición enviada a los proveedores' : 'Revisa el envío de la petición');
    $('#pz-det .pz-card')?.prepend(el('div', { class: 'pz-nuevos' }, ...partes.flatMap((t) => [t, el('br')]),
      el('a', { class: 'boton ghost mini', href: `/compras.html?vista=precios${solId ? `&sol=${solId}` : ''}` }, 'Ver en Compras')));
  }
  async function dialogoPedir() {
    const p = est.p;
    const ls = p.capitulos.flatMap((c) => c.partidas.flatMap((pa) => pa.lineas.filter((l) => l.tipo === 'material' || l.tipo === 'subcontrata' || l.tipo === 'auxiliar').map((l) => ({ ...l, pa }))));
    const candidatas = ls.filter((l) => l.estado_precio !== 'tarifa');
    if (!candidatas.length) { aviso('No hay materiales, auxiliares ni subcontratas en este presupuesto'); return; }
    const marc = new Set(candidatas.filter((l) => l.estado_precio === 'estimado').map((l) => l.id));
    const cats = [...new Set(candidatas.map((l) => l.catalogo_id).filter(Boolean))];
    const provs = await api('GET', `/api/presupuestos/${p.id}/proveedores-sugeridos?catalogo=${cats.join(',')}`).catch(() => []);
    const elegidos = new Set();
    const resp = el('input', { type: 'date', 'aria-label': 'Responder antes del' });
    const nota = el('input', { value: `Precio para presupuesto${p.obra ? `, obra ${p.obra}` : ''}`, maxlength: 300, 'aria-label': 'Nota para el proveedor' });
    const boton = el('button', { type: 'button', class: 'primario' }, '✉ Crear la petición');
    const enviarYa = el('input', { type: 'checkbox', checked: true });
    const contar = () => { boton.textContent = `✉ ${enviarYa.checked ? 'Crear y enviar' : 'Crear la petición'} (${marc.size} línea${marc.size === 1 ? '' : 's'} · ${elegidos.size} proveedor${elegidos.size === 1 ? '' : 'es'})`; };
    enviarYa.addEventListener('change', contar);
    // peticiones de este presupuesto que aún no se han enviado a algún proveedor
    const pendEnvio = await api('GET', `/api/presupuestos/${p.id}/peticiones-sin-enviar`).catch(() => []);
    const fp = el('input', { type: 'search', placeholder: 'Buscar proveedor…', 'aria-label': 'Buscar proveedor' });
    const caja = el('div', { class: 'pz-provs' });
    const pintarProvs = () => caja.replaceChildren(...provs.filter((x) => !fp.value || x.nombre.toLowerCase().includes(fp.value.toLowerCase())).slice(0, 40).map((x) => el('label', { class: 'co-chk' },
      el('input', { type: 'checkbox', checked: elegidos.has(x.id), onchange: (ev) => { ev.target.checked ? elegidos.add(x.id) : elegidos.delete(x.id); contar(); } }), ` ${x.nombre}`, x.precios ? el('small', {}, ` (${x.precios} precio${x.precios === 1 ? '' : 's'} de estos)`) : null,
      x.email ? null : el('small', { class: 'pz-sin-correo', title: 'No tiene correo en su ficha: habrá que enviárselo a mano desde Compras' }, ' ✉✕'))));
    fp.addEventListener('input', pintarProvs);
    const d = el('dialog', { class: 'dlg-cos pz-dlg' },
      el('h2', {}, `✉ Pedir precio para presupuestar · ${p.codigo}`),
      el('p', { class: 'ayuda' }, 'Se crea una petición de precio en Compras, marcada «para presupuestar» (no crea pedidos), y se envía por correo a cada proveedor con el PDF y su enlace para responder en la plataforma. Cuando se confirme una oferta, aquí sale como «precio nuevo».'),
      pendEnvio.length ? el('div', { class: 'pz-nuevos' }, `⚠ Sin enviar: ${pendEnvio.map((x) => `${x.codigo} a ${x.proveedor}${x.email ? '' : ' (sin correo)'}`).join(' · ')} `,
        el('button', { type: 'button', class: 'primario mini', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { const r = await api('POST', `/api/presupuestos/${p.id}/enviar-peticiones`); d.close(); resultadoEnvio(r.envio); } catch (e) { aviso(e.message); ev.currentTarget.disabled = false; }
        } }, '✉ Enviarlas ahora')) : null,
      el('table', { class: 'pz-tabla' }, el('thead', {}, el('tr', {}, el('th', {}), el('th', {}, 'Línea'), el('th', { class: 'n' }, 'Cantidad'), el('th', {}, 'Ahora'))),
        el('tbody', {}, candidatas.map((l) => el('tr', {},
          el('td', {}, el('input', { type: 'checkbox', checked: marc.has(l.id), disabled: l.estado_precio === 'solicitado', onchange: (ev) => { ev.target.checked ? marc.add(l.id) : marc.delete(l.id); contar(); } })),
          el('td', {}, l.concepto, el('small', {}, `${l.pa.codigo || ''} ${l.pa.nombre}`)), el('td', { class: 'n' }, `${pu(l.cantidad_total)} ${ud(l.unidad)}`),
          el('td', {}, el('span', { class: `pz-chip ${l.estado_precio}` }, l.estado_precio === 'real' && l.precio_info?.viejo ? 'viejo' : l.estado_precio), l.estado_precio === 'solicitado' ? el('small', {}, l.sol_codigo) : null))))),
      el('div', { class: 'pz-tag' }, 'Proveedores ', el('small', {}, '(primero los que ya nos han dado precio de estos materiales)')), fp, caja,
      el('div', { class: 'pz-campos' }, el('label', {}, el('span', {}, 'Responder antes del'), resp), el('label', { class: 'ancho' }, el('span', {}, 'Nota para el proveedor'), nota)),
      el('div', { class: 'acciones' }, el('label', { class: 'co-chk' }, enviarYa, ' Enviar ya por correo a cada proveedor'), el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'), boton));
    boton.addEventListener('click', async () => {
      if (!marc.size) { aviso('Marca alguna línea'); return; }
      boton.disabled = false;
      if (!elegidos.size) { aviso('Elige al menos un proveedor'); return; }
      try {
        boton.disabled = true; boton.textContent = enviarYa.checked ? 'Enviando…' : 'Creando…';
        const r = await api('POST', `/api/presupuestos/${p.id}/pedir-precio`, { linea_ids: [...marc], proveedor_ids: [...elegidos], responder_antes: resp.value || null, notas: nota.value, enviar: enviarYa.checked });
        d.close(); est.p = r; pintar(); cargarLista();
        if (enviarYa.checked) resultadoEnvio(r.envio, r.solicitud_id);
        else {
          aviso('Petición creada: ábrela en Compras para enviarla a cada proveedor');
          $('#pz-det .pz-card')?.prepend(el('div', { class: 'pz-nuevos' }, '✉ Petición creada. ', el('a', { class: 'boton primario mini', href: `/compras.html?vista=precios&sol=${r.solicitud_id}` }, 'Abrir en Compras para enviarla')));
        }
      } catch (e) { aviso(e.message); }
    });
    d.addEventListener('close', () => d.remove()); document.body.append(d); pintarProvs(); contar(); d.showModal();
  }

  /* ---------- nuevo ---------- */
  async function dialogoNuevo() {
    const skills = await api('GET', '/api/presupuesto-skills').catch(() => []);
    const t = el('input', { placeholder: 'Si lo dejas vacío, lo pone la IA', maxlength: 200, 'aria-label': 'De qué es' });
    const [cli, dlc] = (() => { const id = 'dl-nuevo-cli'; return [el('input', { list: id, placeholder: 'Escribe para buscar…', 'aria-label': 'Cliente' }), el('datalist', { id }, (est.clientes || []).map((x) => el('option', { value: x.nombre })))]; })();
    const [obr, dlo] = (() => { const id = 'dl-nuevo-obr'; return [el('input', { list: id, placeholder: 'Escribe para buscar…', 'aria-label': 'Obra' }), el('datalist', { id }, (est.obras || []).map((x) => el('option', { value: x.nombre })))]; })();
    const prompt = el('textarea', { rows: 7, class: 'pz-prompt', placeholder: 'Qué hay que presupuestar: «Escalera exterior de emergencia de 2 tramos, zancas UPN 200, peldaños de chapa lagrimada, barandilla de tubo 40x40 a 1,10 m, galvanizado y pintado RAL 7016, montaje con grúa…». Cuanto más detalle, mejor.' });
    const z = zonaAdjuntos();
    const sk = new Set();
    const act = skills.filter((x) => x.activo);
    const caja = el('div', { class: 'pz-skills-elegir' },
      el('p', { class: 'ayuda' }, `Siempre: ${act.filter((x) => x.siempre).map((x) => x.nombre).join(' · ')}`),
      act.filter((x) => !x.siempre).map((x) => el('label', { class: 'co-chk', title: x.claves ? `Se activa sola con: ${x.claves}` : '' },
        el('input', { type: 'checkbox', onchange: (ev) => { ev.target.checked ? sk.add(x.id) : sk.delete(x.id); } }), ` 🧠 ${x.nombre}`)));
    const idCli = () => est.clientes.find((x) => x.nombre === cli.value)?.id || null;
    const idObr = () => est.obras.find((x) => x.nombre === obr.value)?.id || null;
    const conIA = el('button', { type: 'button', class: 'primario' }, '🤖 Crear borrador con IA');
    const d = el('dialog', { class: 'dlg-cos pz-dlg pz-dlg-ancho' }, el('h2', {}, '＋ Nuevo presupuesto'),
      el('p', { class: 'ayuda' }, 'Cuéntale a la IA qué hay que presupuestar y adjunta lo que tengas: prepara un borrador con capítulos, partidas (descripción comercial + descomposición), precios de la lista y la tarifa, y sus dudas. Después lo cambias todo.'),
      el('div', { class: 'pz-campos' }, el('label', { class: 'ancho' }, el('span', {}, 'De qué es'), t), el('label', {}, el('span', {}, 'Cliente'), cli, dlc), el('label', {}, el('span', {}, 'Obra'), obr, dlo)),
      el('label', { class: 'pz-cond' }, el('span', {}, 'Qué hay que presupuestar'), prompt), z.caja,
      el('div', { class: 'pz-tag' }, 'Skills a usar ', el('small', {}, '(si no marcas ninguna, se eligen solas por las palabras de la petición y los adjuntos)')), caja,
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'ghost', onclick: async () => {
          if (!t.value.trim()) { t.focus(); aviso('Pon de qué es (o usa la IA)'); return; }
          try { const p = await api('POST', '/api/presupuestos', { titulo: t.value, cliente_id: idCli(), obra_id: idObr() }); d.close(); abrir(p.id); } catch (e) { aviso(e.message); }
        } }, 'Empezar vacío'), conIA));
    conIA.addEventListener('click', async () => {
      if (!prompt.value.trim() && !z.archivos().length) { prompt.focus(); aviso('Escribe qué hay que presupuestar o adjunta algo'); return; }
      try {
        conIA.disabled = true; conIA.textContent = 'Subiendo adjuntos…';
        const ids = await subirAdjuntos(z.archivos());
        const r = await api('POST', '/api/presupuestos/ia', { titulo: t.value || null, cliente_id: idCli(), obra_id: idObr(), prompt: prompt.value, adjunto_ids: ids, skill_ids: [...sk] });
        d.close(); abrir(r.id);
      } catch (e) { aviso(e.message); conIA.disabled = false; conIA.textContent = '🤖 Crear borrador con IA'; }
    });
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); prompt.focus();
  }

  // 🧠 Skills de presupuestación: documentos .md que la IA sigue al preparar presupuestos
  async function dialogoSkills() {
    let lista = await api('GET', '/api/presupuesto-skills');
    let sel = lista[0]?.id || null;
    const izq = el('div', { class: 'pz-sk-lista' }); const der = el('div', { class: 'pz-sk-ed' });
    // Propuestas aprendidas de presupuestos corregidos: Aceptar (se añade a la Skill), Editar, Descartar
    const props = el('div', { class: 'pz-sk-props' });
    const pintarProps = async () => {
      const ps = await api('GET', '/api/presupuesto-aprendizajes').catch(() => []);
      if (!ps.length) { props.replaceChildren(); return; }
      props.replaceChildren(el('details', { open: true }, el('summary', {}, `💡 Propuestas aprendidas de presupuestos corregidos (${ps.length})`),
        ...ps.map((a) => {
          const ta = el('textarea', { class: 'pz-md pz-prop-txt', value: a.texto, rows: 4, hidden: true, 'aria-label': 'Texto de la propuesta' });
          const ver = el('div', { class: 'pz-prop-ver' }, a.texto);
          const destino = el('select', { 'aria-label': 'Skill donde se añade' },
            el('option', { value: '' }, a.skill_id ? '' : `➕ Nueva: ${String(a.skill_nombre).replace(/\s*\[.*\]$/, '')}`),
            ...lista.map((x) => el('option', { value: x.id, selected: x.id === a.skill_id }, x.nombre)));
          if (a.skill_id) destino.firstChild.remove();
          return el('div', { class: 'pz-prop' },
            el('div', {}, el('b', {}, a.titulo), el('span', { class: 'ayuda' }, ` · de ${a.codigo || '—'}`)),
            a.motivo ? el('p', { class: 'ayuda' }, `Por qué: ${a.motivo}`) : null, ver, ta,
            el('div', { class: 'pz-acc' }, el('label', { class: 'ayuda' }, 'Añadir a ', destino),
              el('button', { type: 'button', class: 'primario mini', onclick: async () => { try { const r = await api('POST', `/api/presupuesto-aprendizajes/${a.id}/aceptar`, { texto: ta.hidden ? undefined : ta.value, skill_id: destino.value || undefined }); lista = await api('GET', '/api/presupuesto-skills'); sel = r.skill_id; pintarSk(); pintarProps(); aviso('Añadida a la Skill (queda la versión anterior)'); } catch (e) { aviso(e.message); } } }, '✓ Aceptar'),
              el('button', { type: 'button', class: 'ghost mini', onclick: () => { ta.hidden = !ta.hidden; ver.hidden = !ta.hidden; } }, '✎ Editar'),
              el('button', { type: 'button', class: 'ghost mini', onclick: async () => { await api('POST', `/api/presupuesto-aprendizajes/${a.id}/descartar`); pintarProps(); } }, '✕ Descartar')));
        })));
    };
    const pintarSk = () => {
      izq.replaceChildren(...lista.map((x) => el('button', { type: 'button', class: `pz-item${x.id === sel ? ' sel' : ''}${x.activo ? '' : ' apagada'}`, onclick: () => { sel = x.id; pintarSk(); } },
        el('b', {}, `${x.nombre}.md`), el('small', {}, `v${x.version}${x.siempre ? ' · siempre' : ''}${x.activo ? '' : ' · desactivada'} · ${x.cambiado_por_nombre || '—'} ${fecha(x.cambiado_en)}`))),
      el('div', { class: 'pz-sk-nueva' }, (() => { const i = el('input', { placeholder: 'Nueva: Barandillas, Escaleras…', 'aria-label': 'Nueva Skill' });
        return [i, el('button', { type: 'button', class: 'ghost mini', onclick: async () => { try { const r = await api('POST', '/api/presupuesto-skills', { nombre: i.value }); lista = await api('GET', '/api/presupuesto-skills'); sel = r.id; pintarSk(); } catch (e) { aviso(e.message); } } }, '＋')]; })()));
      const s = lista.find((x) => x.id === sel);
      if (!s) { der.replaceChildren(el('p', { class: 'ayuda' }, 'Crea la primera Skill.')); return; }
      const ta = el('textarea', { class: 'pz-md', value: s.contenido, spellcheck: false, 'aria-label': `Contenido de ${s.nombre}` });
      der.replaceChildren(el('div', { class: 'pz-sk-cab' }, el('b', {}, `${s.nombre}.md`), el('span', { class: 'ayuda' }, ` · versión ${s.version}`)), ta,
        el('div', { class: 'pz-acc' },
          el('button', { type: 'button', class: 'primario', onclick: async () => { try { await api('PUT', `/api/presupuesto-skills/${s.id}`, { contenido: ta.value }); lista = await api('GET', '/api/presupuesto-skills'); pintarSk(); aviso('Guardada: la IA la usará desde el próximo presupuesto'); } catch (e) { aviso(e.message); } } }, 'Guardar'),
          el('a', { class: 'boton ghost', href: `/api/presupuesto-skills/${s.id}/md` }, '⬇ Descargar .md'),
          el('label', { class: 'boton ghost' }, '⬆ Cargar .md', el('input', { type: 'file', accept: '.md,text/markdown,text/plain', hidden: true, onchange: async (ev) => { const f = ev.target.files[0]; if (f) ta.value = await f.text(); } })),
          s.nombre === 'Reglas generales' ? el('span', { class: 'ayuda' }, 'Se usa siempre') : el('button', { type: 'button', class: 'ghost', onclick: async () => { await api('PUT', `/api/presupuesto-skills/${s.id}`, { activo: !s.activo }); lista = await api('GET', '/api/presupuesto-skills'); pintarSk(); } }, s.activo ? 'Desactivar' : 'Activar')),
        s.nombre === 'Reglas generales' ? null : el('div', { class: 'pz-sk-uso' },
          el('label', { class: 'co-chk' }, el('input', { type: 'checkbox', checked: s.siempre, onchange: async (ev) => { await api('PUT', `/api/presupuesto-skills/${s.id}`, { siempre: ev.target.checked }); lista = await api('GET', '/api/presupuesto-skills'); pintarSk(); } }), ' Usar en todos los presupuestos'),
          s.siempre ? null : el('label', { class: 'pz-sk-claves' }, 'Se usa cuando la petición o los adjuntos dicen: ',
            el('input', { value: s.claves || '', placeholder: 'barandilla, pasamanos…', 'aria-label': 'Palabras clave', onchange: async (ev) => { await api('PUT', `/api/presupuesto-skills/${s.id}`, { claves: ev.target.value }); lista = await api('GET', '/api/presupuesto-skills'); aviso('Palabras guardadas'); } }))));
    };
    const importar = el('label', { class: 'boton ghost', title: 'Un .zip con varias Skills (.md, con su indice.json si lo trae) o un .md suelto. Las que ya existen con el mismo nombre se actualizan y queda la versión anterior.' }, '⬆ Importar .zip / .md',
      el('input', { type: 'file', accept: '.zip,.md,application/zip,text/markdown', hidden: true, onchange: async (ev) => {
        const f = ev.target.files[0]; ev.target.value = ''; if (!f) return;
        try {
          const r = await fetch(`/api/presupuesto-skills/importar?nombre=${encodeURIComponent(f.name)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: f });
          const x = await r.json().catch(() => ({})); if (!r.ok) throw new Error(x.error || `Error ${r.status}`);
          lista = await api('GET', '/api/presupuesto-skills'); pintarSk();
          aviso(`Importadas: ${x.nuevas.length} nuevas, ${x.actualizadas.length} actualizadas${x.iguales.length ? `, ${x.iguales.length} sin cambios` : ''}`);
        } catch (e) { aviso(e.message); }
      } }));
    const d = el('dialog', { class: 'dlg-cos pz-dlg pz-dlg-skills' }, el('h2', {}, '🧠 Skills de presupuestación'),
      el('p', { class: 'ayuda' }, 'Documentos en Markdown con vuestra forma de presupuestar: descomposiciones tipo, rendimientos (h/ml…), reglas y cómo redactar la descripción comercial. La IA lee las que se usan siempre y las de producto cuyas palabras aparecen en la petición o en los adjuntos (o las que marques al crear). Con «⬆ Importar» subes un .zip con varias de golpe.'),
      props, el('div', { class: 'pz-sk' }, izq, der),
      el('div', { class: 'acciones' }, importar, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cerrar')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); pintarSk(); pintarProps(); d.showModal();
  }

  async function iniciar() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    const q = new URLSearchParams(location.search);
    est.id = Number(q.get('id')) || null; est.partida = Number(q.get('partida')) || null;
    $('#pz-nuevo').onclick = dialogoNuevo;
    $('#pz-skills').onclick = dialogoSkills;
    if (q.get('skills')) dialogoSkills();
    est.soloLeads = q.get('vista') === 'leads';
    $('#pz-leads').onclick = () => { est.soloLeads = !est.soloLeads; const u = new URL(location); if (est.soloLeads) u.searchParams.set('vista', 'leads'); else u.searchParams.delete('vista'); history.replaceState(null, '', u); cargarLista(); };
    let t = null; $('#pz-q').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { est.q = ev.target.value.trim(); cargarLista(); }, 250); });
    await opciones();
    await Promise.all([cargarLista(), cargar()]);
  }
  iniciar();
})();
