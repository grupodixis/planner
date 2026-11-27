/* Planéalo · Tarifa de mano de obra y maquinaria: precio de venta estipulado (se edita aquí) y coste real
   (ficha ÷ rendimiento de los partes). Base de Presupuestos. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
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
  const eur = (n) => (n == null ? '—' : `${Number(n).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  const fmt = (n) => (n == null ? '' : String(n).replace('.', ','));
  const UNIDADES = ['h', 'día', 'km', 'ud'];
  let d = null; let ocultas = false; let yo = null;
  const puedeRecursos = () => (yo?.permisos || []).includes('recursos');

  async function cargar() { d = await api('GET', '/api/tarifa'); pintar(); }
  async function guardar(id, cuerpo, msg = 'Guardado') {
    try { d = await api('PUT', `/api/tarifa/${id}`, cuerpo); aviso(msg); pintar(); } catch (e) { aviso(e.message); }
  }
  // importe editable: guarda al salir del campo o con Enter
  const importe = (t, k, attrs = {}) => {
    const i = el('input', { type: 'text', inputmode: 'decimal', value: fmt(t[k]), class: 'ta-in', ...attrs });
    const ir = () => { const v = i.value.trim(); if (fmt(t[k]) === v) return; guardar(t.id, { [k]: v === '' ? null : v.replace(',', '.') }); };
    i.addEventListener('change', ir); i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') i.blur(); });
    return i;
  };
  const rendCls = (r) => (r == null ? '' : r >= 100 ? 'bien' : r < 85 ? 'mal' : '');
  const margenCls = (m) => (m == null ? '' : m < 15 ? 'mal' : m < 25 ? 'medio' : 'bien');
  const rendTxt = (x) => (x.rendimiento_pct == null ? el('span', { class: 'ayuda', title: 'Sin tareas terminadas con horas en los partes' }, 'sin datos')
    : el('span', { class: `ta-rend ${rendCls(x.rendimiento_pct)}${x.poca_base ? ' poca' : ''}`, title: x.poca_base ? `Menos de ${d.base_min_h} h de base: no se corrige el coste todavía` : 'Horas previstas ÷ horas reales' }, `${x.rendimiento_pct} %`));

  function pintar() {
    const mo = d.mano_obra.filter((t) => ocultas || t.activo);
    $('#ta-mo').replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, 'Categoría'), el('th', { class: 'n' }, 'Venta (tarifa)'), el('th', { class: 'n' }, 'Coste ficha'), el('th', { class: 'n' }, 'Rendimiento real'),
        el('th', { class: 'n' }, 'Coste para presupuestar'), el('th', { class: 'n' }, 'Margen s/ tarifa'), el('th', {}, 'Base'), el('th', {}))),
      el('tbody', {}, mo.length ? mo.map((t) => el('tr', { class: t.activo ? '' : 'oculta' },
        el('td', {}, el('b', {}, t.nombre), el('small', {}, `${t.operarios} operario${t.operarios === 1 ? '' : 's'}${t.sin_coste ? ` · ${t.sin_coste} sin coste en su ficha` : ''}`)),
        el('td', { class: 'n' }, importe(t, 'precio_venta', { placeholder: '€/h', 'aria-label': `Precio de venta de ${t.nombre}` }), el('span', { class: 'ayuda' }, ' €/h')),
        // coste €/h: el de las fichas (media) o uno fijado a mano para la tarifa
        el('td', { class: 'n' }, importe(t, 'coste_manual', { placeholder: t.coste_calculado != null ? fmt(t.coste_calculado) : '€/h', title: 'Vacío = media del coste €/h de las fichas de sus operarios. Escríbelo para fijar otro en la tarifa.', 'aria-label': `Coste por hora de ${t.nombre}` }),
          el('span', { class: 'ayuda' }, ' €/h'), el('small', { class: 'ta-nota' }, t.coste_manual != null ? 'a mano' : 'media de las fichas')),
        el('td', { class: 'n' }, rendTxt(t)),
        el('td', { class: 'n' }, importe(t, 'coste_presupuesto', { placeholder: t.fijo ? fmt(t.coste_calculado_rend) : t.coste_efectivo != null ? fmt(t.coste_efectivo) : '€/h', title: 'El coste por hora que usan los presupuestos. Vacío = coste ficha ÷ rendimiento. Escríbelo para fijarlo (también se fija al corregirlo en un presupuesto).', 'aria-label': `Coste para presupuestar de ${t.nombre}` }),
          el('span', { class: 'ayuda' }, ' €/h'), el('small', { class: 'ta-nota' }, t.fijo ? `fijado · por rendimiento saldría ${eur(t.coste_calculado_rend)}` : 'ficha ÷ rendimiento')),
        el('td', { class: `n ta-margen ${margenCls(t.margen_pct)}` }, t.margen_pct == null ? '—' : `${t.margen_pct} %`),
        el('td', { class: 'ayuda' }, t.horas ? `${fmt(t.horas)} h en ${t.tareas} tarea${t.tareas === 1 ? '' : 's'}` : '—'),
        el('td', {}, el('button', { type: 'button', class: 'ghost mini', title: t.activo ? 'No sale en la tarifa ni en Presupuestos' : 'Volver a mostrar', onclick: () => guardar(t.id, { activo: !t.activo }, t.activo ? 'Oculta' : 'Visible') }, t.activo ? 'Ocultar' : 'Mostrar'))))
        : el('tr', {}, el('td', { colspan: 8, class: 'ayuda' }, 'No hay categorías: créalas con «＋ Categoría» y asígnalas a cada operario en la tabla de abajo.'))));

    const ps = d.personas.filter((p) => ocultas || d.mano_obra.find((t) => t.clave === (p.categoria || ''))?.activo !== false);
    // la categoría se pone aquí mismo (es la «Categoría / puesto» de su ficha en Recursos)
    const catSel = (p) => {
      if (!puedeRecursos()) return el('td', { class: p.categoria ? '' : 'ayuda' }, p.categoria || 'sin categoría');
      const sel = el('select', { 'aria-label': `Categoría de ${p.nombre}`, class: p.categoria ? '' : 'ta-sin' },
        el('option', { value: '' }, 'Sin categoría'), d.categorias.map((c) => el('option', { value: c, selected: c === p.categoria }, c)));
      sel.addEventListener('change', async () => {
        const resto = String(p.categoria_completa || '').split('·').slice(1).map((x) => x.trim()).filter(Boolean);
        try { await api('PATCH', `/api/recursos/${p.id}`, { categoria: [sel.value, ...resto].filter(Boolean).join(' · ') || null }); aviso(`${p.nombre}: ${sel.value || 'sin categoría'}`); await cargar(); }
        catch (e) { aviso(e.message); }
      });
      return el('td', {}, sel);
    };
    $('#ta-per').replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, 'Operario'), el('th', {}, 'Categoría'), el('th', { class: 'n' }, 'Coste ficha'), el('th', { class: 'n' }, 'Rendimiento'), el('th', { class: 'n' }, 'Coste efectivo'), el('th', {}, 'Base'))),
      el('tbody', {}, ps.sort((a, b) => (b.horas || 0) - (a.horas || 0) || a.nombre.localeCompare(b.nombre)).map((p) => el('tr', {},
        el('td', {}, p.nombre), catSel(p),
        el('td', { class: 'n' }, p.coste_ficha == null ? el('span', { class: 'ta-rend mal' }, 'sin coste') : eur(p.coste_ficha)),
        el('td', { class: 'n' }, rendTxt(p)), el('td', { class: 'n' }, eur(p.coste_efectivo)),
        el('td', { class: 'ayuda' }, p.horas ? `${fmt(p.horas)} h · ${p.tareas} tarea${p.tareas === 1 ? '' : 's'}` : '—')))));

    const mq = d.maquinaria.filter((t) => ocultas || t.activo);
    $('#ta-maq').replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, 'Tipo de máquina'), el('th', { class: 'n' }, 'Venta'), el('th', {}, 'Unidad'), el('th', { class: 'n' }, 'Coste'), el('th', { class: 'n' }, 'Margen'), el('th', {}, 'Equipos'), el('th', {}))),
      el('tbody', {}, mq.map((t) => {
        const ud = el('select', { 'aria-label': `Unidad de ${t.nombre}`, onchange: (ev) => guardar(t.id, { unidad: ev.target.value }) }, [...new Set([...UNIDADES, t.unidad])].map((u) => el('option', { value: u, selected: u === t.unidad }, u)));
        return el('tr', { class: t.activo ? '' : 'oculta' },
          el('td', {}, el('b', {}, t.nombre), t.familia ? el('small', {}, t.familia) : null),
          el('td', { class: 'n' }, importe(t, 'precio_venta', { placeholder: '€', 'aria-label': `Precio de venta de ${t.nombre}` })),
          el('td', {}, ud),
          el('td', { class: 'n' }, importe(t, 'coste_manual', { placeholder: t.coste_calculado != null ? fmt(t.coste_calculado) : '€', title: 'Vacío = media del coste €/h de sus equipos (ficha). Escríbelo si va por día o km.', 'aria-label': `Coste de ${t.nombre}` }),
            el('small', { class: 'ta-nota' }, t.coste_manual != null ? 'a mano' : 'de las fichas')),
          el('td', { class: `n ta-margen ${margenCls(t.margen_pct)}` }, t.margen_pct == null ? '—' : `${t.margen_pct} %`),
          el('td', { class: 'ayuda ta-eq' }, `${t.n} · ${t.equipos}`),
          el('td', {}, el('button', { type: 'button', class: 'ghost mini', onclick: () => guardar(t.id, { activo: !t.activo }, t.activo ? 'Oculta' : 'Visible') }, t.activo ? 'Ocultar' : 'Mostrar')));
      })));
  }

  async function iniciar() {
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    $('#ta-ocultas').onchange = (ev) => { ocultas = ev.target.checked; pintar(); };
    const nueva = async () => {
      const i = $('#ta-nueva'); if (!i.value.trim()) { i.focus(); return; }
      try { d = await api('POST', '/api/tarifa', { nombre: i.value }); aviso(`Categoría «${i.value.trim()}» creada: ponle precio y asígnasela a sus operarios abajo`); i.value = ''; pintar(); } catch (e) { aviso(e.message); }
    };
    $('#ta-nueva-btn').onclick = nueva; $('#ta-nueva').onkeydown = (ev) => { if (ev.key === 'Enter') nueva(); };
    try { await cargar(); } catch (e) { $('#ta-mo').replaceChildren(el('tbody', {}, el('tr', {}, el('td', {}, e.message)))); }
  }
  iniciar();
})();
