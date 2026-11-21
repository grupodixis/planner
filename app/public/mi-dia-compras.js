/* App del móvil · Compras locales (ferretería…): pedir autorización, ver si está autorizada y subir el ticket.
   Autorizar lo hace Operaciones (Compras › Compras locales); cuadrar con la factura, compras. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'disabled' || k === 'hidden') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  async function api(metodo, url, cuerpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    if (r.status === 401) { location.replace('/pin.html'); throw new Error('Sesión caducada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }
  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3000);
  }
  const eur = (v) => (v == null ? '' : `${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  const cuando = (t) => new Date(t).toLocaleString('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const EST = { pendiente: ['⏳ Esperando autorización', 'cl-pend'], autorizada: ['✔ Autorizada', 'cl-aut'], rechazada: ['✗ No autorizada', 'cl-no'],
    comprada: ['🧾 Con ticket', 'cl-ok'], cuadrada: ['✔ Facturada', 'cl-ok'], anulada: ['Anulada', 'cl-anul'] };

  // fotos: sube cada una al elegirla y guarda su id
  function fotos(texto) {
    const ids = [];
    const input = el('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true, multiple: '' });
    const minis = el('span', { class: 'md-minis' });
    const boton = el('button', { type: 'button', class: 'md-foto', onclick: () => input.click() }, texto);
    input.onchange = async () => {
      for (const f of [...input.files]) {
        boton.disabled = true; boton.textContent = 'Subiendo…';
        try {
          ids.push(await window.s360.subirArchivo(f));
          minis.append(f.type === 'application/pdf' ? el('span', { class: 'md-mini pdf' }, 'PDF') : el('img', { class: 'md-mini', src: URL.createObjectURL(f), alt: 'foto' }));
        } catch (e) { toast(e.message, true); }
      }
      boton.disabled = false; boton.textContent = texto; input.value = '';
    };
    return { nodo: el('div', { class: 'cl-fotos' }, boton, input, minis), ids };
  }

  let op = null; let mias = []; let pidiendo = false;

  async function cargar() {
    [op, { compras: mias }] = await Promise.all([op ? Promise.resolve(op) : api('GET', '/api/compras-locales/opciones'), api('GET', '/api/compras-locales/mias')]);
    pintar();
  }

  function formulario() {
    const sel = { tienda: op.tiendas[0]?.id ?? 'otro', tarea: op.trabajos[0]?.id ?? 'otra', para: 'ahora', otraTarea: null };
    // «Otra tarea…»: buscador de tareas de OTs abiertas
    const elegida = el('div', { class: 'cl-elegida', hidden: true });
    const resultados = el('ul', { class: 'cl-resultados' });
    let tBusca;
    const busca = el('input', { type: 'search', placeholder: 'Busca por OT, tarea u obra (p. ej. 61.03 o «pérgola»)', 'aria-label': 'Buscar tarea', hidden: sel.tarea !== 'otra',
      oninput: () => {
        clearTimeout(tBusca);
        tBusca = setTimeout(async () => {
          try {
            const { tareas } = await api('GET', `/api/compras-locales/tareas?q=${encodeURIComponent(busca.value)}`);
            resultados.replaceChildren(...tareas.map((t) => el('li', {}, el('button', { type: 'button', onclick: () => {
              sel.otraTarea = t; resultados.replaceChildren(); busca.hidden = true;
              elegida.hidden = false;
              elegida.replaceChildren(el('span', {}, el('b', {}, t.codigo), ` ${t.nombre}`, el('small', {}, ` · OT ${t.ot_codigo} ${t.ot_titulo}${t.obra ? ` · ${t.obra}` : ''}`)),
                el('button', { type: 'button', class: 'ghost mini', onclick: () => { sel.otraTarea = null; elegida.hidden = true; busca.hidden = false; busca.focus(); } }, 'Cambiar'));
            } }, el('b', {}, t.codigo), ` ${t.nombre}`, el('small', {}, ` · OT ${t.ot_codigo} ${t.ot_titulo}${t.obra ? ` · ${t.obra}` : ''}`)))));
            if (!tareas.length && busca.value.trim().length >= 2) resultados.replaceChildren(el('li', { class: 'ayuda' }, 'No hay tareas abiertas con eso.'));
          } catch (e) { toast(e.message, true); }
        }, 250);
      } });
    const que = el('textarea', { rows: 3, maxlength: 1000, placeholder: 'p. ej. 2 cajas de tacos químicos 12 mm y 4 discos de corte inox', 'aria-label': 'Qué necesitas', required: '' });
    const otra = el('input', { type: 'text', maxlength: 120, placeholder: 'Nombre de la tienda', 'aria-label': 'Otra tienda', hidden: sel.tienda !== 'otro' });
    const imp = el('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', placeholder: '≈ €', 'aria-label': 'Importe aproximado' });
    const f = fotos('📷 Foto (opcional)');
    const chips = (lista, clave, alCambiar) => el('div', { class: 'cl-chips', role: 'group' }, lista.map(([v, txt]) => el('button', {
      type: 'button', class: String(sel[clave]) === String(v) ? 'on' : null, 'aria-pressed': String(sel[clave]) === String(v) ? 'true' : 'false',
      onclick: (ev) => { sel[clave] = v; ev.currentTarget.parentNode.querySelectorAll('button').forEach((b) => { const on = b === ev.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); alCambiar?.(); },
    }, txt)));
    const form = el('form', { class: 'md-form', onsubmit: async (ev) => {
      ev.preventDefault();
      if (pidiendo) return;
      if (sel.tarea === 'otra' && !sel.otraTarea) { toast('Elige para qué tarea es', true); busca.focus(); return; }
      pidiendo = true;
      try {
        const r = await api('POST', '/api/compras-locales/nueva', {
          que: que.value, proveedor_id: sel.tienda === 'otro' ? null : sel.tienda, tienda: sel.tienda === 'otro' ? otra.value : null,
          importe_aprox: imp.value, para: sel.para, tarea_id: sel.tarea === 'otra' ? sel.otraTarea?.id : sel.tarea, archivos: f.ids,
        });
        toast(`${r.codigo}: pedida. Te avisamos cuando la autoricen`);
        await cargar();
      } catch (e) { toast(e.message, true); } finally { pidiendo = false; }
    } },
    el('label', { class: 'md-campo' }, el('span', {}, '¿Qué necesitas?'), que),
    el('div', { class: 'md-campo' }, el('span', {}, '¿Dónde?'),
      op.tiendas.length <= 8
        ? chips([...op.tiendas.map((t) => [t.id, t.nombre]), ['otro', 'Otra…']], 'tienda', () => { otra.hidden = sel.tienda !== 'otro'; if (!otra.hidden) otra.focus(); })
        : el('select', { 'aria-label': 'Tienda', onchange: (ev) => { sel.tienda = ev.target.value === 'otro' ? 'otro' : Number(ev.target.value); otra.hidden = sel.tienda !== 'otro'; if (!otra.hidden) otra.focus(); } },
          op.tiendas.map((t) => el('option', { value: t.id }, `${t.nombre}${t.localidad ? ` · ${t.localidad}` : ''}`)), el('option', { value: 'otro' }, 'Otra…')),
      otra),
    el('div', { class: 'md-campo' }, el('span', {}, '¿Para qué tarea?'),
      chips([...op.trabajos.map((t) => [t.id, `${t.codigo} ${t.nombre}`]), ['otra', 'Otra tarea…']], 'tarea', () => {
        const otra = sel.tarea === 'otra';
        busca.hidden = !otra || !!sel.otraTarea; elegida.hidden = !otra || !sel.otraTarea; resultados.hidden = !otra;
        if (otra && !sel.otraTarea) busca.focus();
      }),
      busca, resultados, elegida),
    el('div', { class: 'cl-dos' },
      el('label', { class: 'md-campo' }, el('span', {}, 'Importe aprox.'), imp),
      el('div', { class: 'md-campo' }, el('span', {}, '¿Para cuándo?'), chips([['ahora', 'Ahora'], ['manana', 'Mañana']], 'para'))),
    f.nodo,
    el('button', { type: 'submit', class: 'primario md-grande' }, 'Pedir autorización'),
    el('p', { class: 'ayuda' }, 'A cuenta de la empresa (cuenta de crédito en la tienda). Lo autoriza Operaciones; te llega un aviso.'));
    return form;
  }

  function tarjeta(c) {
    const [txt, cls] = EST[c.estado] || [c.estado, ''];
    const hijos = [
      el('div', { class: 'cl-cab' }, el('b', {}, c.codigo), el('span', { class: `cl-est ${cls}` }, txt)),
      el('div', {}, c.que),
      el('small', {}, [c.tienda_nombre, c.importe_aprox != null ? `≈ ${eur(c.importe_aprox)}` : null, c.tarea_codigo ? `${c.tarea_codigo} ${c.tarea_nombre}` : null, cuando(c.creado)].filter(Boolean).join(' · ')),
    ];
    if (c.nota_decision) hijos.push(el('div', { class: c.estado === 'rechazada' ? 'cl-motivo no' : 'cl-motivo' }, `${c.decidido_por_nombre || 'Operaciones'}: «${c.nota_decision}»`));
    if (c.estado === 'autorizada') {
      hijos.push(el('div', { class: 'cl-decir' }, 'Da este código en la tienda (a cuenta de la empresa):', el('div', { class: 'cl-codigo' }, c.codigo_aut || c.codigo)));
      const f = fotos('📷 Foto del ticket o albarán');
      const imp = el('input', { type: 'number', inputmode: 'decimal', min: 0, step: '0.01', placeholder: '€', 'aria-label': 'Importe del ticket' });
      const alb = el('input', { type: 'text', maxlength: 60, placeholder: 'nº', 'aria-label': 'Número de albarán' });
      const aviso = el('small', { class: 'cl-desvio', hidden: true });
      imp.oninput = () => {
        const v = Number(String(imp.value).replace(',', '.'));
        const d = c.importe_aprox ? v / c.importe_aprox - 1 : 0;
        aviso.hidden = !(d > 0.15);
        aviso.textContent = `+${Math.round(d * 100)} % sobre lo autorizado: se avisará a Operaciones`;
      };
      hijos.push(f.nodo,
        el('div', { class: 'cl-dos' }, el('label', { class: 'md-campo' }, el('span', {}, 'Importe del ticket'), imp), el('label', { class: 'md-campo' }, el('span', {}, 'Nº albarán'), alb)),
        aviso,
        el('button', { type: 'button', class: 'primario md-grande', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { await api('POST', `/api/compras-locales/${c.id}/ticket`, { importe_real: imp.value, num_albaran: alb.value, archivos: f.ids }); toast('Guardado, gracias'); await cargar(); }
          catch (e) { toast(e.message, true); ev.target.disabled = false; }
        } }, 'Ya lo he comprado'));
    }
    if (c.estado === 'comprada' || c.estado === 'cuadrada') hijos.push(el('small', {}, `Ticket: ${eur(c.importe_real)}${c.num_albaran ? ` · albarán ${c.num_albaran}` : ''}${c.codigo_aut ? ` · código ${c.codigo_aut}` : ''}`));
    if (['pendiente', 'autorizada'].includes(c.estado)) {
      hijos.push(el('button', { type: 'button', class: 'ghost mini', onclick: async () => {
        if (!confirm('¿Ya no hace falta? Se anula la petición.')) return;
        try { await api('POST', `/api/compras-locales/${c.id}/anular`); await cargar(); } catch (e) { toast(e.message, true); }
      } }, 'Ya no hace falta'));
    }
    return el('li', { class: `cl-tarjeta ${cls}` }, hijos);
  }

  function pintar() {
    const abiertas = mias.filter((c) => ['pendiente', 'autorizada'].includes(c.estado));
    const resto = mias.filter((c) => !['pendiente', 'autorizada'].includes(c.estado));
    $('#v-compras').replaceChildren(...[
      abiertas.length ? el('section', { class: 'md-bloque' }, el('h2', {}, 'Mis compras en marcha'), el('ul', { class: 'md-lista' }, abiertas.map(tarjeta))) : null,
      el('section', { class: 'md-bloque' }, el('h2', {}, '🛒 Pedir una compra'), formulario()),
      op.puede_autorizar ? el('p', { class: 'ayuda' }, el('a', { href: '/compras.html?vista=locales' }, 'Autorizar las que piden los demás ↗')) : null,
      resto.length ? el('section', { class: 'md-bloque' }, el('h2', {}, 'Anteriores'), el('ul', { class: 'md-lista' }, resto.map(tarjeta))) : null].filter(Boolean));
  }

  // cuántas esperan algo de mí (para el menú)
  const pendientes = () => mias.filter((c) => c.estado === 'autorizada').length;

  window.midiaCompras = { cargar, pendientes, precargar: () => api('GET', '/api/compras-locales/mias').then((d) => { mias = d.compras; }).catch(() => {}) };
})();
