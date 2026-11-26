/* Planéalo · Lista de precios: el último precio confirmado de cada material (sin IVA), el mejor de 6 meses, el medio
   de 12 y el historial con su origen (oferta del portal, correo, PDF, a mano o pedido). */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['checked', 'disabled', 'hidden'].includes(k)) n[k] = !!v;
      else if (k === 'value') n.value = v ?? '';
      else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const api = (...a) => window.s360.api(...a);
  const eur = (n) => (n == null ? '—' : `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`);
  const fecha = (f) => (f ? new Date(f).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: '2-digit' }) : '');
  const ORIGEN = { oferta: 'Oferta', pedido: 'Pedido', albaran: 'Albarán', factura: 'Factura', manual: 'A mano' };
  const VIA = { portal: '🌐 formulario', correo: '📧 correo (IA)', pdf_portal: '🌐 PDF (IA)', manual: '✎ apuntada', pedido: '🛒 pedido' };
  const est = { q: '', prov: '', viejos: false, datos: null, sel: null };
  // «cotizó 1,15 €/kg» cuando el proveedor dio el precio en otra unidad que la base del material
  const cotizo = (pr, u, ub) => (pr != null && u && u !== ub ? el('small', { class: 'pr-cot' }, `cotizó ${eur(pr)}/${u}`) : null);
  const num = (v) => (v == null ? '' : String(v).replace('.', ','));

  async function cargar() {
    const q = new URLSearchParams({ ...(est.q ? { q: est.q } : {}), ...(est.prov ? { proveedor: est.prov } : {}) });
    est.datos = await api('GET', `/api/precios?${q}`);
    if ($('#pr-prov').options.length <= 1) $('#pr-prov').replaceChildren(el('option', { value: '' }, 'Todos los proveedores'), ...est.datos.proveedores.map((p) => el('option', { value: p.id, selected: String(p.id) === est.prov }, p.nombre)));
    pintar();
  }
  function lista() { return est.datos.precios.filter((p) => !est.viejos || p.dias > est.datos.dias_viejo); }
  function pintar() {
    const ps = lista();
    $('#pr-n').textContent = `${ps.length} material(es)`;
    $('#pr-tabla').replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, 'Material'), el('th', { class: 'n' }, 'Último (sistema)'), el('th', {}, 'Proveedor · fecha'), el('th', { class: 'n' }, 'Mejor 6 meses'), el('th', { class: 'n' }, 'Medio 12 meses'), el('th', { class: 'n' }, 'Precios'))),
      el('tbody', {}, ps.length ? ps.map((p) => el('tr', { class: `pr-fila${est.sel === p.clave ? ' sel' : ''}`, tabindex: 0, onclick: () => historial(p), onkeydown: (ev) => { if (ev.key === 'Enter') historial(p); } },
        el('td', {}, el('b', {}, p.material), el('small', {}, [p.familia, p.catalogo_id ? null : 'sin material del catálogo'].filter(Boolean).join(' · '))),
        el('td', { class: `n pr-ult${p.dias > est.datos.dias_viejo ? ' viejo' : ''}`, title: p.dias > est.datos.dias_viejo ? `Tiene ${p.dias} días: conviene pedir precio` : '' }, `${eur(p.ultimo)}`, el('small', {}, `/${p.unidad || 'ud'}`), cotizo(p.ultimo_orig, p.ultimo_unidad_orig, p.unidad)),
        el('td', {}, p.ultimo_proveedor || '—', el('small', {}, `${fecha(p.ultimo_fecha)} · ${ORIGEN[p.ultimo_origen] || p.ultimo_origen}`)),
        el('td', { class: 'n' }, eur(p.mejor_6m), p.mejor_proveedor && p.mejor_6m !== p.ultimo ? el('small', {}, p.mejor_proveedor) : null),
        el('td', { class: 'n' }, eur(p.medio_12m)),
        el('td', { class: 'n' }, `${p.n}`, p.n_prov > 1 ? el('small', {}, `${p.n_prov} prov.`) : null)))
        : el('tr', {}, el('td', { colspan: 6, class: 'ayuda' }, est.q || est.prov ? 'Nada con esos filtros.' : 'Todavía no hay precios. Se irán guardando con cada oferta confirmada y cada pedido enviado.'))));
  }

  async function historial(p) {
    est.sel = p.clave; pintar();
    const h = await api('GET', `/api/precios/historial?clave=${encodeURIComponent(p.clave)}`);
    // gráfico: precio en el tiempo (un punto por precio, color por proveedor)
    const pts = h.slice().reverse();
    const W = 520; const H = 150; const pad = 28; const izq = 62;
    const xs = pts.map((x) => new Date(x.fecha).getTime()); const ys = pts.map((x) => x.precio);
    const x0 = Math.min(...xs); const x1 = Math.max(...xs) || x0 + 1; const y0 = Math.min(...ys) * 0.9; const y1 = Math.max(...ys) * 1.1 || 1;
    const X = (t) => izq + ((t - x0) / Math.max(1, x1 - x0)) * (W - izq - pad); const Y = (v) => H - pad + 6 - ((v - y0) / Math.max(1e-9, y1 - y0)) * (H - pad * 2);
    const provs = [...new Set(pts.map((x) => x.proveedor))];
    const COL = ['#4ea1ff', '#f0b060', '#6fcf7f', '#ff8a8a', '#c79bff', '#5fd3d3'];
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg'); svg.setAttribute('viewBox', `0 0 ${W} ${H}`); svg.setAttribute('class', 'pr-graf'); svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', 'Evolución del precio');
    const add = (tag, a, txt) => { const n = document.createElementNS(svgNS, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); if (txt) n.textContent = txt; svg.append(n); return n; };
    add('line', { x1: izq, y1: H - pad + 6, x2: W - pad, y2: H - pad + 6, stroke: '#444' });
    add('text', { x: 2, y: Y(y1 / 1.1) + 4, fill: '#999', 'font-size': 10 }, eur(y1 / 1.1));
    add('text', { x: 2, y: Y(y0 / 0.9) + 4, fill: '#999', 'font-size': 10 }, eur(y0 / 0.9));
    provs.forEach((pr, i) => {
      const ps = pts.filter((x) => x.proveedor === pr);
      if (ps.length > 1) add('polyline', { points: ps.map((x) => `${X(new Date(x.fecha).getTime())},${Y(x.precio)}`).join(' '), fill: 'none', stroke: COL[i % COL.length], 'stroke-width': 1.5, opacity: 0.6 });
      ps.forEach((x) => { const c = add('circle', { cx: X(new Date(x.fecha).getTime()), cy: Y(x.precio), r: x.origen === 'pedido' ? 5 : 3.5, fill: COL[i % COL.length] }); const t = document.createElementNS(svgNS, 'title'); t.textContent = `${pr} · ${eur(x.precio)} · ${fecha(x.fecha)} · ${ORIGEN[x.origen]}`; c.append(t); });
    });
    $('#pr-det').replaceChildren(
      el('div', { class: 'pr-det-cab' }, el('h2', {}, p.material), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => { est.sel = null; $('#pr-det').replaceChildren(); pintar(); } }, '✕')),
      el('div', { class: 'pr-res' },
        el('div', { class: `pr-kpi${p.dias > est.datos.dias_viejo ? ' viejo' : ''}` }, el('small', {}, 'Precio del sistema (último)'), el('b', {}, eur(p.ultimo)), el('small', {}, `${p.ultimo_proveedor || '—'} · ${fecha(p.ultimo_fecha)}${p.dias > est.datos.dias_viejo ? ` · ⚠ ${p.dias} días` : ''}`)),
        el('div', { class: 'pr-kpi' }, el('small', {}, 'Mejor 6 meses'), el('b', {}, eur(p.mejor_6m)), el('small', {}, p.mejor_proveedor || '')),
        el('div', { class: 'pr-kpi' }, el('small', {}, 'Medio 12 meses'), el('b', {}, eur(p.medio_12m)), el('small', {}, `${p.n} precio(s)`))),
      pts.length > 1 ? svg : null,
      provs.length > 1 ? el('div', { class: 'pr-ley' }, provs.map((pr, i) => el('span', {}, el('i', { style: `background:${COL[i % COL.length]}` }), pr))) : null,
      el('table', { class: 'pr-tabla pr-hist' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Fecha'), el('th', {}, 'Proveedor'), el('th', { class: 'n' }, 'Precio'), el('th', { class: 'n' }, 'Cant.'), el('th', {}, 'De dónde'))),
        el('tbody', {}, h.map((x) => el('tr', {},
          el('td', {}, fecha(x.fecha)), el('td', {}, x.proveedor || '—'),
          el('td', { class: 'n' }, eur(x.precio), el('small', {}, `/${x.unidad || 'ud'}`), cotizo(x.precio_orig, x.unidad_orig, x.unidad)),
          el('td', { class: 'n' }, x.cantidad != null ? `${num(x.cantidad)} ${x.unidad_linea || ''}` : ''),
          el('td', {}, x.sol_id ? el('a', { href: `/compras.html?vista=precios&sol=${x.sol_id}` }, `${ORIGEN[x.origen]} ${x.sol_codigo}`) : x.pedido_id ? el('a', { href: `/compras.html?pedido=${x.pedido_id}` }, `${ORIGEN[x.origen]} ${x.pedido_codigo}`) : ORIGEN[x.origen],
            el('small', {}, ` ${VIA[x.via] || ''}`), x.correo_id ? el('a', { href: `/correo.html?vista=todos&id=${x.correo_id}`, class: 'ayuda' }, ' · correo') : null))))),
      p.catalogo_id ? unidades(p) : el('p', { class: 'ayuda' }, 'Este precio no está enlazado a un material del catálogo: no tiene equivalencias de unidades.'));
  }

  // 📏 Unidades y equivalencias del material: calculadas de su nombre y detalle (dimensiones, material, barra de 6 m); se pueden corregir
  function unidades(p) {
    const caja = el('section', { class: 'pr-uds' }, el('h3', {}, '📏 Unidades y equivalencias'), el('p', { class: 'ayuda' }, 'Cargando…'));
    (async () => {
      let m;
      try { m = await api('GET', `/api/catalogo/${p.catalogo_id}/unidades`); } catch (e) { caja.lastChild.textContent = e.message; return; }
      const CAMPOS = m.base === 'm2' ? [['m2_ud', 'm² por chapa'], ['kg_m2', 'kg por m²']] : m.base === 'ml' ? [['kg_ml', 'kg por ml'], ['ml_barra', 'ml por barra'], ['pint_m2_ml', 'm² de pintura por ml']] : [];
      const ins = {};
      const fac = Object.entries(m.factores || {}).filter(([u]) => u !== m.base && !['m', 'mm', 'cm'].includes(u));
      const ejemplo = p.ultimo != null && p.unidad === m.base ? fac.map(([u, f]) => `${eur(p.ultimo * f)}/${u}`).join(' · ') : '';
      const ORIG = { calculado: '🧮 calculado del nombre del material', manual: '✎ corregido a mano' };
      caja.replaceChildren(el('h3', {}, '📏 Unidades y equivalencias'),
        el('p', { class: 'ayuda' }, `Se compara y guarda en €/${m.base}. `, m.calculo ? `${m.calculo}. ` : '', ORIG[m.origen] || (CAMPOS.length ? 'Sin calcular: pon los datos para poder convertir.' : `Este material se mide en ${m.base}; solo valen las conversiones generales (t ↔ kg).`)),
        fac.length ? el('div', { class: 'pr-eq' }, fac.map(([u, f]) => el('span', {}, `1 ${u} = ${num(+f.toFixed(4))} ${m.base}`))) : null,
        ejemplo ? el('p', { class: 'ayuda' }, `Su último precio equivale a: ${ejemplo}`) : null,
        CAMPOS.length ? el('div', { class: 'pr-eq-campos' }, CAMPOS.map(([k, t]) => { ins[k] = el('input', { type: 'text', inputmode: 'decimal', value: num(m[k]), placeholder: '—', 'aria-label': t }); return el('label', {}, el('span', {}, t), ins[k]); })) : null,
        CAMPOS.length ? el('div', { class: 'acciones' },
          m.origen === 'manual' ? el('button', { type: 'button', class: 'ghost', onclick: async () => {
            try { await api('PUT', `/api/catalogo/${p.catalogo_id}/unidades`, { recalcular: true }); window.s360.aviso('Vuelve a lo calculado'); await cargar(); historial(est.datos.precios.find((x) => x.clave === p.clave) || p); } catch (e) { window.s360.aviso(e.message); }
          } }, 'Volver a lo calculado') : null,
          el('button', { type: 'button', class: 'primario', onclick: async () => {
            const b = Object.fromEntries(Object.entries(ins).map(([k, i]) => [k, i.value.trim()]));
            try { await api('PUT', `/api/catalogo/${p.catalogo_id}/unidades`, b); window.s360.aviso('Equivalencias guardadas: precios recalculados'); await cargar(); historial(est.datos.precios.find((x) => x.clave === p.clave) || p); } catch (e) { window.s360.aviso(e.message); }
          } }, 'Guardar equivalencias')) : null);
    })();
    return caja;
  }

  function csv() {
    const filas = [['Material', 'Familia', 'Último precio (sin IVA)', 'Unidad', 'Proveedor', 'Fecha', 'Origen', 'Mejor 6 meses', 'Medio 12 meses', 'Nº precios']]
      .concat(lista().map((p) => [p.material, p.familia || '', p.ultimo, p.unidad || '', p.ultimo_proveedor || '', p.ultimo_fecha?.slice(0, 10) || '', ORIGEN[p.ultimo_origen] || '', p.mejor_6m ?? '', p.medio_12m ?? '', p.n]));
    const txt = filas.map((f) => f.map((v) => { const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(';')).join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([`﻿${txt}`], { type: 'text/csv;charset=utf-8' })), download: `lista-de-precios-${new Date().toISOString().slice(0, 10)}.csv` });
    document.body.append(a); a.click(); a.remove();
  }

  async function iniciar() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    const q = new URLSearchParams(location.search);
    est.prov = q.get('proveedor') || '';
    let t; $('#pr-q').oninput = (ev) => { clearTimeout(t); t = setTimeout(() => { est.q = ev.target.value.trim(); cargar(); }, 250); };
    $('#pr-prov').onchange = (ev) => { est.prov = ev.target.value; cargar(); };
    $('#pr-viejos').onchange = (ev) => { est.viejos = ev.target.checked; pintar(); };
    $('#pr-csv').onclick = csv;
    try { await cargar(); } catch (e) { $('#pr-tabla').replaceChildren(el('tbody', {}, el('tr', {}, el('td', {}, e.message)))); }
    window.s360.alCambiar?.(() => cargar());
  }
  iniciar();
})();
