/* Almacén (pensado para el móvil de Sergio): por cada material de la OT, ¿cuánto hay?
   «No hay» / «Hay todo» con un toque, o el número exacto. Lo que falta es lo que se pide. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { api } = window.s360;
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'disabled' || k === 'hidden') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 2500);
  }
  const fecha = (f) => (f ? new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const nf = (n, d = 3) => (n == null ? '' : Number(n).toLocaleString('es-ES', { maximumFractionDigits: d }));
  const otId = Number(new URLSearchParams(location.search).get('ot')) || null;
  let acabados = {};

  const cantTxt = (g, n) => (g.unidad === 'barra' ? `${nf(n, 0)} ${n === 1 ? 'barra' : 'barras'} de ${nf(g.barra_mm / 1000, 2)} m` : `${nf(n)} ${g.unidad}`);

  async function lista() {
    const ots = await api('GET', '/api/materiales/ots');
    $('#tit').textContent = 'Material a revisar';
    $('#sub').textContent = 'OTs con material, por la fecha en que hace falta. Entra y di qué hay en el almacén.';
    $('#lista').replaceChildren(...(ots.length ? ots.map((o) => el('li', {},
      el('a', { href: `/almacen.html?ot=${o.id}`, class: `mat-ot alm-mat${o.revisados >= o.materiales ? ' hecho' : ''}` },
        el('h3', {}, `${o.codigo} · ${o.titulo}`),
        el('span', { class: 'mat-ot-dat' }, `${o.revisados} de ${o.materiales} revisados`,
          o.fecha_necesaria ? ` · hace falta el ${fecha(o.fecha_necesaria)}` : '', o.hay_bom ? '' : ' · (estimado, sin BOM)')))) : [el('li', { class: 'ayuda' }, 'Nada que revisar.')]));
  }

  async function ot() {
    const d = await api('GET', `/api/ordenes/${otId}/materiales`);
    $('#volver').hidden = false;
    $('#tit').textContent = `${d.ot.codigo} · ${d.ot.titulo}`;
    const r = d.resumen;
    $('#sub').textContent = `${r.revisados} de ${r.materiales} revisados${r.fecha_necesaria ? ` · hace falta el ${fecha(r.fecha_necesaria)}` : ''}${d.hay_bom ? '' : ' · cantidades estimadas (aún sin BOM)'}`;
    const puede = d.puede.almacen;
    const guardar = async (g, v) => {
      try {
        await api('PUT', `/api/ordenes/${otId}/materiales/grupo`, { clave: g.clave, en_stock: v });
        toast(v == null ? 'Quitado' : v === 0 ? 'Apuntado: no hay' : `Apuntado: hay ${cantTxt(g, v)}`);
        await ot();
      } catch (e) { toast(e.message, true); }
    };
    const grupos = d.grupos.filter((g) => !g.solo_estimado)
      .sort((a, b) => (a.en_stock != null) - (b.en_stock != null));   // lo pendiente, arriba
    $('#lista').replaceChildren(...grupos.map((g) => {
      const paso = g.unidad === 'barra' || g.unidad === 'ud' ? 1 : 0.5;
      const input = el('input', { type: 'number', inputmode: 'decimal', min: 0, step: 'any', value: g.en_stock ?? '', 'aria-label': 'Cuánto hay', disabled: !puede });
      input.onchange = () => guardar(g, input.value === '' ? null : Math.max(0, Number(input.value)));
      return el('li', { class: `alm-mat${g.en_stock != null ? ' hecho' : ''}` },
        el('h3', {}, g.perfil || g.descripcion, ' ', [g.material, (acabados[g.acabado] || g.acabado || '').replace(/ \(.*\)$/, '')].filter(Boolean).map((t) => el('span', { class: 'mat-chip' }, t))),
        g.perfil && g.descripcion ? el('div', { class: 'ayuda' }, g.descripcion) : null,
        el('div', { class: 'alm-nec' }, 'Hace falta: ', el('b', {}, cantTxt(g, g.necesario)),
          g.fecha_necesaria ? el('span', { class: 'ayuda' }, ` · el ${fecha(g.fecha_necesaria)}`) : null),
        el('div', { class: 'alm-botones' },
          el('button', { type: 'button', class: `${g.en_stock === 0 ? 'sel no' : ''}`, disabled: !puede, onclick: () => guardar(g, 0) }, 'No hay'),
          el('button', { type: 'button', class: `${g.en_stock != null && g.en_stock >= g.necesario ? 'sel' : ''}`, disabled: !puede, onclick: () => guardar(g, g.necesario) }, 'Hay todo'),
          el('span', { class: 'alm-paso' }, 'Hay',
            el('button', { type: 'button', 'aria-label': 'Uno menos', disabled: !puede, onclick: () => guardar(g, Math.max(0, (g.en_stock || 0) - paso)) }, '−'),
            input,
            el('button', { type: 'button', 'aria-label': 'Uno más', disabled: !puede, onclick: () => guardar(g, (g.en_stock || 0) + paso) }, '+'))),
        g.en_stock != null ? el('div', { class: 'alm-quien' },
          g.a_pedir > 0 ? el('b', { class: 'pend' }, `A pedir: ${cantTxt(g, g.a_pedir)}`) : el('b', { class: 'ok' }, '✔ Cubierto'),
          g.revisado_por ? ` · ${g.revisado_por}, ${new Date(g.revisado_en).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : '') : null);
    }));
    if (!grupos.length) $('#lista').append(el('li', { class: 'ayuda' }, 'Esta OT no tiene materiales.'));
  }

  async function init() {
    const yo = await api('GET', '/api/me');
    window.s360.iniciar(yo);
    acabados = (await api('GET', '/api/materiales/opciones')).acabados;
    const cargar = otId ? ot : lista;
    await cargar();
    window.s360.alCambiar(cargar);
  }
  init().catch((e) => toast(e.message, true));
})();
