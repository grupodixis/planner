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
  const ESTADO = { preparacion: 'en preparación', enviado: 'enviado', aceptado: 'aceptado', rechazado: 'rechazado' };
  const TIPOS = [['material', '🧱 Materiales'], ['mano_obra', '👷 Mano de obra'], ['maquinaria', '🏗 Maquinaria'], ['auxiliar', '🧰 Auxiliares (coste aparte)'], ['subcontrata', '🏭 Subcontratas']];
  const CHIP = { real: 'real', tarifa: 'tarifa', estimado: 'estimado', solicitado: 'solicitado' };

  const est = { q: '', id: null, partida: null, p: null, lista: [], tarifa: null, clientes: null, obras: null };
  const url = () => { const u = new URL(location); u.searchParams.delete('id'); u.searchParams.delete('partida'); if (est.id) u.searchParams.set('id', est.id); if (est.partida) u.searchParams.set('partida', est.partida); history.replaceState(null, '', u); };

  /* ---------- lista ---------- */
  async function cargarLista() {
    est.lista = await api('GET', `/api/presupuestos?q=${encodeURIComponent(est.q)}`);
    const grupos = [['preparacion', 'En preparación'], ['enviado', 'Enviados'], ['aceptado', 'Aceptados'], ['rechazado', 'Rechazados']];
    $('#pz-items').replaceChildren(...grupos.flatMap(([k, t]) => {
      const ls = est.lista.filter((p) => p.estado === k);
      if (!ls.length) return [];
      return [el('div', { class: 'pz-tag' }, `${t} (${ls.length})`), ...ls.map((p) => el('button', { type: 'button', class: `pz-item${p.id === est.id ? ' sel' : ''}`, onclick: () => abrir(p.id) },
        el('div', { class: 'pz-item-1' }, el('b', {}, p.codigo), el('span', {}, p.venta ? eur0(p.venta) : '—')),
        el('div', {}, [p.cliente, p.titulo].filter(Boolean).join(' · ')),
        el('small', {}, p.partidas ? `${p.capitulos} capítulo${p.capitulos === 1 ? '' : 's'} · ${p.partidas} partida${p.partidas === 1 ? '' : 's'}` : 'sin partidas',
          p.pendientes.nuevos ? el('span', { class: 'pz-verde' }, ` · ${p.pendientes.nuevos} precio(s) nuevo(s)`)
            : p.pendientes.estimado + p.pendientes.solicitado ? el('span', { class: 'pz-naranja' }, ` · ${p.pendientes.estimado + p.pendientes.solicitado} precio(s) pendientes`)
              : p.partidas ? el('span', { class: 'pz-verde' }, ' · todo con precio real') : null)))];
    }), ...(est.lista.length ? [] : [el('p', { class: 'ayuda' }, est.q ? 'Nada con esa búsqueda.' : 'Todavía no hay presupuestos.')]));
  }

  async function abrir(id, partida = null) { est.id = id; est.partida = partida; url(); await cargar(); cargarLista(); }
  async function cargar() {
    if (!est.id) { $('#pz-det').replaceChildren(el('p', { class: 'ayuda' }, 'Elige un presupuesto o crea uno nuevo.')); return; }
    try { est.p = await api('GET', `/api/presupuestos/${est.id}`); } catch (e) { $('#pz-det').replaceChildren(el('p', { class: 'ayuda' }, e.message)); return; }
    pintar();
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
          el('td', { class: 'n' }, eur(pa.venta_ud)), el('td', { class: 'n' }, eur0(pa.venta)), el('td', {}, chipsPartida(pa))));
      }
    }
    filas.push(el('tr', { class: 'pz-tot' }, el('td', {}, 'Total'), el('td', {}), el('td', {}), el('td', { class: 'n' }, eur0(p.coste)), el('td', {}), el('td', { class: 'n' }, eur0(p.venta)), el('td', {})));

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
        p.pendientes.nuevos ? el('div', { class: 'pz-nuevos' }, `🔔 ${p.pendientes.nuevos} precio(s) nuevo(s) de proveedores. `,
          el('button', { type: 'button', class: 'primario mini', onclick: () => hacer('POST', `/api/presupuestos/${p.id}/aplicar-todos`, {}, (r) => `${r.aplicados} precio(s) aplicados`) }, 'Aplicar todos'),
          el('span', { class: 'ayuda' }, ' o uno a uno en su partida.')) : null,
        el('div', { class: 'tabla-scroll' }, el('table', { class: 'pz-tabla' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Capítulo / partida'), el('th', { class: 'n' }, 'Medición'), el('th', { class: 'n' }, 'Coste / ud'), el('th', { class: 'n' }, 'Coste'),
            el('th', { class: 'n' }, 'Venta / ud'), el('th', { class: 'n' }, 'Venta'), el('th', {}, 'Precios'))),
          el('tbody', {}, filas))),
        el('div', { class: 'pz-acc' },
          abiertoP() ? el('button', { type: 'button', class: 'ghost', onclick: () => hacer('POST', `/api/presupuestos/${p.id}/capitulos`, {}, 'Capítulo añadido') }, '＋ Capítulo') : null,
          abiertoP() && p.capitulos[0]?.id ? el('button', { type: 'button', class: 'ghost', onclick: () => nuevaPartida(p.capitulos[p.capitulos.length - 1].id) }, '＋ Partida') : null,
          abiertoP() ? el('button', { type: 'button', class: pendientes ? 'primario' : 'ghost', onclick: dialogoPedir }, `✉ Pedir precio de lo pendiente${p.pendientes.estimado ? ` (${p.pendientes.estimado})` : ''}`) : null,
          abiertoP() ? el('button', { type: 'button', class: 'ghost', title: 'Vuelve a coger los precios de la lista y de la tarifa (no toca lo escrito a mano ni lo pedido)', onclick: () => hacer('POST', `/api/presupuestos/${p.id}/actualizar-precios`, {}, (r) => `${r.cambiados} precio(s) actualizados`) }, '⟳ Actualizar precios') : null,
          el('a', { class: 'boton ghost', href: `/api/presupuestos/${p.id}/pdf`, target: '_blank', rel: 'noopener' }, '📄 PDF resumido'),
          el('a', { class: 'boton ghost', href: `/api/presupuestos/${p.id}/pdf?detallado=1`, target: '_blank', rel: 'noopener', title: 'Con la descomposición de cada partida a precio de venta' }, '📄 PDF detallado'),
          ...estados,
          p.estado === 'preparacion' ? el('button', { type: 'button', class: 'ghost peligro', onclick: async () => { if (!confirm(`¿Borrar ${p.codigo}?`)) return; try { await api('DELETE', `/api/presupuestos/${p.id}`); est.id = null; url(); cargar(); cargarLista(); } catch (e) { aviso(e.message); } } }, 'Borrar') : null),
        el('label', { class: 'pz-cond' }, el('span', {}, 'Condiciones para el cliente (salen en el PDF)'),
          campo(p.condiciones || '', (v) => put({ condiciones: v }, 'Condiciones guardadas'), { multilinea: true, rows: 3, placeholder: 'Forma de pago, plazo de ejecución, validez, exclusiones…' }))),
      el('div', { class: 'pz-kpis' },
        el('div', { class: 'pz-kpi' }, el('small', {}, 'Coste técnico'), el('b', {}, eur0(p.coste)), el('small', {}, p.real_pct == null ? '—' : `${p.real_pct} % del coste con precio real o de tarifa`)),
        el('div', { class: 'pz-kpi' }, el('small', {}, 'Margen'), el('b', {}, `+ ${fmt(p.margen_pct)} %`), el('small', {}, `GG ${fmt(p.gg_pct)} % + beneficio ${fmt(p.bi_pct)} %`)),
        el('div', { class: 'pz-kpi' }, el('small', {}, 'Precio de venta (sin IVA)'), el('b', { class: 'pz-verde' }, eur0(p.venta)), el('small', {}, `con IVA ${eur0(p.venta * 1.21)}`)),
        el('div', { class: 'pz-kpi' }, el('small', {}, 'Pendiente'), el('b', { class: pendientes ? 'pz-naranja' : 'pz-verde' }, pendientes ? `${pendientes} precio${pendientes === 1 ? '' : 's'}` : 'nada'),
          el('small', {}, `${p.pendientes.estimado} estimados · ${p.pendientes.solicitado} solicitados${p.pendientes.nuevos ? ` · ${p.pendientes.nuevos} nuevos` : ''}`))));
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
    const putL = (l, b, msg) => hacer('PUT', `/api/presupuesto-lineas/${l.id}`, b, msg);
    const lineas = [];
    for (const [tipo, titulo] of TIPOS) {
      const ls = pa.lineas.filter((l) => l.tipo === tipo);
      lineas.push(el('tr', { class: 'pz-tipo' }, el('td', { colspan: 8 }, titulo)));
      for (const l of ls) {
        const opcionesT = tipo === 'mano_obra' ? est.tarifa.mano_obra : tipo === 'maquinaria' ? est.tarifa.maquinaria : null;
        const concepto = opcionesT && l.tarifa_id
          ? el('select', { disabled: !abiertoP(), 'aria-label': 'De la tarifa', onchange: (ev) => putL(l, { tarifa_id: ev.target.value }, 'Cambiado') }, opcionesT.filter((t) => t.activo || t.id === l.tarifa_id).map((t) => el('option', { value: t.id, selected: t.id === l.tarifa_id }, t.nombre)))
          : campo(l.concepto, (v) => putL(l, { concepto: v }), { class: 'pz-in-con', 'aria-label': 'Concepto' });
        lineas.push(el('tr', { class: l.nuevo ? 'pz-con-nuevo' : '' },
          el('td', {}, concepto, l.catalogo_id ? el('small', {}, 'catálogo') : null),
          el('td', { class: 'n' }, l.calculo ? el('span', { title: l.calculo_txt }, pu(l.cantidad_ud)) : campo(fmt(l.por_ud), (v) => putL(l, { por_ud: leer(v) }), { class: 'pz-num', inputmode: 'decimal', 'aria-label': `Cantidad por ${ud(pa.unidad)}` })),
          el('td', {}, l.calculo || l.tarifa_id ? ud(l.unidad) : campo(l.unidad, (v) => putL(l, { unidad: v }), { class: 'pz-ud', 'aria-label': 'Unidad' })),
          el('td', { class: 'n' }, `${pu(l.cantidad_total)} ${ud(l.unidad)}`),
          el('td', { class: 'n' }, campo(fmt(l.precio == null ? '' : +Number(l.precio).toFixed(4)), (v) => putL(l, { precio: leer(v) }, 'Precio a mano: queda como estimado'), { class: `pz-num${l.precio == null ? ' falta' : ''}`, inputmode: 'decimal', 'aria-label': 'Coste por unidad' }), el('span', { class: 'ayuda' }, ` €/${ud(l.unidad)}`)),
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
  function anadir(tipo, pa) {
    const post = (b) => hacer('POST', `/api/presupuesto-partidas/${pa.id}/lineas`, { tipo, ...b }, 'Añadida');
    if (tipo === 'mano_obra' || tipo === 'maquinaria') {
      const ops = (tipo === 'mano_obra' ? est.tarifa.mano_obra : est.tarifa.maquinaria).filter((t) => t.activo);
      const sel = el('select', { 'aria-label': 'De la tarifa' }, el('option', { value: '' }, tipo === 'mano_obra' ? '＋ Mano de obra de la tarifa…' : '＋ Máquina de la tarifa…'),
        ops.map((t) => el('option', { value: t.id }, `${t.nombre} · ${t.coste_efectivo == null ? 'sin coste' : `${pu(t.coste_efectivo)} €/${t.unidad}`}`)));
      sel.addEventListener('change', () => { if (sel.value) post({ tarifa_id: sel.value, por_ud: 1 }); });
      return [sel, ops.length ? null : el('span', { class: 'ayuda' }, ' La tarifa está vacía: ', el('a', { href: '/tarifa.html' }, 'Informes › Tarifa'))];
    }
    if (tipo === 'material') {
      const i = el('input', { type: 'search', placeholder: '＋ Material: escribe para buscar en el catálogo (tubo 40x40, pletina…)', class: 'pz-busca', 'aria-label': 'Buscar material' });
      const sug = el('div', { class: 'pz-sug', hidden: true });
      let t = null; let res = [];
      const elegirM = (m) => { sug.hidden = true; i.value = ''; post(m ? { catalogo_id: m.id, por_ud: 1 } : { concepto: i.dataset.q, unidad: 'ud', por_ud: 1 }); };
      i.addEventListener('input', () => {
        clearTimeout(t); const q = i.value.trim(); i.dataset.q = q;
        if (q.length < 2) { sug.hidden = true; return; }
        t = setTimeout(async () => {
          res = await api('GET', `/api/presupuestos-sugerir?q=${encodeURIComponent(q)}`).catch(() => []);
          sug.replaceChildren(...res.map((m) => el('button', { type: 'button', onclick: () => elegirM(m) }, el('span', {}, m.nombre, m.equiv ? el('small', {}, ` · ${m.equiv}`) : null),
            el('span', { class: m.precio == null ? 'ayuda' : m.estado_precio === 'real' ? 'pz-verde' : 'pz-naranja' }, m.precio == null ? 'sin precio' : `${pu(m.precio)} €/${ud(m.unidad_base)} · ${m.estado_precio === 'real' ? `real ${fecha(m.precio_info?.fecha)}` : `hace ${m.precio_info?.dias} días`}`))),
          el('button', { type: 'button', class: 'pz-sug-libre', onclick: () => elegirM(null) }, `＋ «${q}» sin catálogo (precio a mano)`));
          sug.hidden = false;
        }, 250);
      });
      i.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') sug.hidden = true; });
      return el('div', { class: 'pz-busca-caja' }, i, sug);
    }
    // auxiliar / subcontrata
    const con = el('input', { placeholder: tipo === 'auxiliar' ? '＋ Auxiliar: plataforma, andamio, consumibles…' : '＋ Subcontrata: galvanizado, lacado, transporte…', class: 'pz-in-con', 'aria-label': 'Concepto' });
    const calc = el('select', { 'aria-label': 'Cantidad' }, el('option', { value: '' }, 'cantidad a mano'), el('option', { value: 'kg_perfiles' }, '🧮 kg de los perfiles'), el('option', { value: 'm2_perfiles' }, '🧮 m² de pintura de los perfiles'));
    const u = el('input', { value: 'ud', class: 'pz-ud', 'aria-label': 'Unidad' });
    const pr = el('input', { placeholder: '€', class: 'pz-num', inputmode: 'decimal', 'aria-label': 'Precio' });
    calc.addEventListener('change', () => { u.disabled = !!calc.value; if (calc.value) u.value = calc.value === 'kg_perfiles' ? 'kg' : 'm2'; });
    const ir = () => { if (!con.value.trim()) { con.focus(); return; } post({ concepto: con.value, calculo: calc.value || null, unidad: u.value, por_ud: 1, precio: leer(pr.value) }); };
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
    const contar = () => { boton.textContent = `✉ Crear la petición (${marc.size} línea${marc.size === 1 ? '' : 's'} · ${elegidos.size} proveedor${elegidos.size === 1 ? '' : 'es'})`; };
    const fp = el('input', { type: 'search', placeholder: 'Buscar proveedor…', 'aria-label': 'Buscar proveedor' });
    const caja = el('div', { class: 'pz-provs' });
    const pintarProvs = () => caja.replaceChildren(...provs.filter((x) => !fp.value || x.nombre.toLowerCase().includes(fp.value.toLowerCase())).slice(0, 40).map((x) => el('label', { class: 'co-chk' },
      el('input', { type: 'checkbox', checked: elegidos.has(x.id), onchange: (ev) => { ev.target.checked ? elegidos.add(x.id) : elegidos.delete(x.id); contar(); } }), ` ${x.nombre}`, x.precios ? el('small', {}, ` (${x.precios} precio${x.precios === 1 ? '' : 's'} de estos)`) : null)));
    fp.addEventListener('input', pintarProvs);
    const d = el('dialog', { class: 'dlg-cos pz-dlg' },
      el('h2', {}, `✉ Pedir precio para presupuestar · ${p.codigo}`),
      el('p', { class: 'ayuda' }, 'Se crea una petición de precio normal en Compras (portal, correo, PDF y lectura con IA), marcada «para presupuestar»: no crea pedidos. Desde allí se envía a cada proveedor. Cuando se confirme una oferta, aquí sale como «precio nuevo».'),
      el('table', { class: 'pz-tabla' }, el('thead', {}, el('tr', {}, el('th', {}), el('th', {}, 'Línea'), el('th', { class: 'n' }, 'Cantidad'), el('th', {}, 'Ahora'))),
        el('tbody', {}, candidatas.map((l) => el('tr', {},
          el('td', {}, el('input', { type: 'checkbox', checked: marc.has(l.id), disabled: l.estado_precio === 'solicitado', onchange: (ev) => { ev.target.checked ? marc.add(l.id) : marc.delete(l.id); contar(); } })),
          el('td', {}, l.concepto, el('small', {}, `${l.pa.codigo || ''} ${l.pa.nombre}`)), el('td', { class: 'n' }, `${pu(l.cantidad_total)} ${ud(l.unidad)}`),
          el('td', {}, el('span', { class: `pz-chip ${l.estado_precio}` }, l.estado_precio === 'real' && l.precio_info?.viejo ? 'viejo' : l.estado_precio), l.estado_precio === 'solicitado' ? el('small', {}, l.sol_codigo) : null))))),
      el('div', { class: 'pz-tag' }, 'Proveedores ', el('small', {}, '(primero los que ya nos han dado precio de estos materiales)')), fp, caja,
      el('div', { class: 'pz-campos' }, el('label', {}, el('span', {}, 'Responder antes del'), resp), el('label', { class: 'ancho' }, el('span', {}, 'Nota para el proveedor'), nota)),
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'), boton));
    boton.addEventListener('click', async () => {
      if (!marc.size) { aviso('Marca alguna línea'); return; }
      if (!elegidos.size) { aviso('Elige al menos un proveedor'); return; }
      try {
        const r = await api('POST', `/api/presupuestos/${p.id}/pedir-precio`, { linea_ids: [...marc], proveedor_ids: [...elegidos], responder_antes: resp.value || null, notas: nota.value });
        d.close(); est.p = r; pintar(); cargarLista();
        aviso('Petición creada: ábrela en Compras para enviarla a cada proveedor');
        const ir = el('div', { class: 'pz-nuevos' }, '✉ Petición creada. ', el('a', { class: 'boton primario mini', href: `/compras.html?vista=precios&sol=${r.solicitud_id}` }, 'Abrir en Compras para enviarla'));
        $('#pz-det .pz-card')?.prepend(ir);
      } catch (e) { aviso(e.message); }
    });
    d.addEventListener('close', () => d.remove()); document.body.append(d); pintarProvs(); contar(); d.showModal();
  }

  /* ---------- nuevo ---------- */
  function dialogoNuevo() {
    const t = el('input', { placeholder: 'Barandillas y escalera exterior', maxlength: 200, 'aria-label': 'De qué es' });
    const [cli, dlc] = (() => { const id = 'dl-nuevo-cli'; return [el('input', { list: id, placeholder: 'Escribe para buscar…', 'aria-label': 'Cliente' }), el('datalist', { id }, (est.clientes || []).map((x) => el('option', { value: x.nombre })))]; })();
    const [obr, dlo] = (() => { const id = 'dl-nuevo-obr'; return [el('input', { list: id, placeholder: 'Escribe para buscar…', 'aria-label': 'Obra' }), el('datalist', { id }, (est.obras || []).map((x) => el('option', { value: x.nombre })))]; })();
    const d = el('dialog', { class: 'dlg-cos pz-dlg' }, el('h2', {}, '＋ Nuevo presupuesto'),
      el('div', { class: 'pz-campos' }, el('label', { class: 'ancho' }, el('span', {}, 'De qué es'), t), el('label', {}, el('span', {}, 'Cliente'), cli, dlc), el('label', {}, el('span', {}, 'Obra'), obr, dlo)),
      el('p', { class: 'ayuda' }, 'Se crea vacío, con un capítulo. Crear con IA desde un texto y adjuntos llega en la fase 2.'),
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          if (!t.value.trim()) { t.focus(); return; }
          try {
            const p = await api('POST', '/api/presupuestos', { titulo: t.value, cliente_id: est.clientes.find((x) => x.nombre === cli.value)?.id || null, obra_id: est.obras.find((x) => x.nombre === obr.value)?.id || null });
            d.close(); abrir(p.id);
          } catch (e) { aviso(e.message); }
        } }, 'Crear')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal(); t.focus();
  }

  async function iniciar() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    const q = new URLSearchParams(location.search);
    est.id = Number(q.get('id')) || null; est.partida = Number(q.get('partida')) || null;
    $('#pz-nuevo').onclick = dialogoNuevo;
    let t = null; $('#pz-q').addEventListener('input', (ev) => { clearTimeout(t); t = setTimeout(() => { est.q = ev.target.value.trim(); cargarLista(); }, 250); });
    await opciones();
    await Promise.all([cargarLista(), cargar()]);
  }
  iniciar();
})();
