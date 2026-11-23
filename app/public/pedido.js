// Página pública: el proveedor confirma un pedido y dice cómo lo envía (enlace con token, sin sesión):
// lo trae él (agencia y nº de seguimiento), lo deja en el almacén del transportista (con albarán) o estará listo para recoger.
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const API = `/api/pedido-ext/${encodeURIComponent(token)}`;
  const app = document.getElementById('app');
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k === 'value') n.value = v;
      else if (k === 'checked') n.checked = !!v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h instanceof Node ? h : String(h));
    return n;
  };
  const dl = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : '');
  async function api(metodo, cuerpo, url = API, cab) {
    const r = await fetch(url, { method: metodo, headers: cuerpo instanceof Blob ? cab : { 'Content-Type': 'application/json' }, body: cuerpo instanceof Blob ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se ha podido completar. Inténtelo de nuevo.');
    return d;
  }
  async function reducir(file) {
    if (!file.type.startsWith('image/') || file.size < 400 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((ok) => c.toBlob((b) => ok(b || file), 'image/jpeg', 0.85));
    } catch { return file; }
  }
  const campo = (txt, input) => el('label', { class: 'campo' }, el('span', {}, txt), input);

  function pintar(d, msg) {
    document.title = `Pedido ${d.codigo} · ${d.empresa.nombre}`;
    const hoy = new Date().toLocaleDateString('sv-SE');
    const v = {};
    const inp = (k, attrs = {}) => { const i = el(attrs.tag || 'input', { ...attrs, tag: null, value: d[k] ?? '' }); v[k] = i; return i; };
    const err = el('p', { class: 'error', role: 'alert' });
    const confirmar = el('input', { type: 'checkbox', checked: !!d.confirmado, disabled: !!d.confirmado });
    const bloques = [];
    if (d.modo === 'proveedor' || !d.modo) {
      const ag = el('select', {}, el('option', { value: '' }, '— Agencia —'), Object.entries(d.agencias).map(([k, t]) => el('option', { value: k, selected: k === d.agencia }, t)));
      v.agencia = ag;
      const otra = campo('¿Qué agencia?', inp('agencia_otra', { type: 'text', maxlength: 80 })); otra.hidden = d.agencia !== 'otra';
      ag.onchange = () => { otra.hidden = ag.value !== 'otra'; };
      bloques.push(el('h3', {}, '📦 Envío'), el('p', { class: 'plan' }, 'Lo enviáis vosotros (vuestro transporte o una agencia). Cuando salga, indicadnos la agencia y el nº de seguimiento.'),
        el('div', { class: 'fila2' }, campo('Llegará el', inp('fecha_entrega', { type: 'date', min: hoy })), campo('Salió / saldrá el', inp('fecha_salida', { type: 'date' }))),
        el('div', { class: 'fila2' }, campo('Agencia', ag), campo('Nº de seguimiento', inp('tracking', { type: 'text', maxlength: 80 }))), otra);
    }
    if (d.modo === 'almacen') {
      const a = d.almacen || {};
      const ent = inp('entregado_almacen', { type: 'date', max: hoy });
      bloques.push(el('h3', {}, '🏬 Entregar en el almacén del transportista'),
        el('div', { class: 'ok-msg' }, el('div', {}, a.nombre || 'Almacén del transportista'), el('div', { style: 'font-weight:400' }, [a.direccion, a.telefono, a.horario].filter(Boolean).join(' · ')),
          a.leyenda ? el('div', {}, `Indicad en los bultos: «${a.leyenda}»`) : null, a.transportista ? el('div', { style: 'font-weight:400' }, `Nos lo trae ${a.transportista} a Menorca.`) : null),
        el('div', { class: 'fila2' }, campo('Lo entregaremos en el almacén el', inp('fecha_almacen', { type: 'date', min: hoy })), campo('✔ Ya lo hemos entregado el', ent)),
        el('div', { class: 'fila2' }, campo('Bultos', inp('bultos', { type: 'number', min: 0 })), campo('Kg (aprox.)', inp('kg', { type: 'number', min: 0, step: 'any' }))));
    }
    if (d.modo === 'recogida') {
      const r = d.recogida || {};
      bloques.push(el('h3', {}, '🚚 Pasaremos a recogerlo'),
        el('p', { class: 'plan' }, `${r.transportista ? `Lo recoge ${r.transportista}` : 'Lo recoge nuestro transportista'}${r.fecha ? ` el ${dl(r.fecha)}` : ''}${r.direccion ? ` en ${r.direccion}` : ''}. Confirmadnos cuándo estará listo.`),
        el('div', { class: 'fila2' }, campo('Estará listo el', inp('listo_recogida', { type: 'date' })), campo('Bultos', inp('bultos', { type: 'number', min: 0 }))),
        el('div', { class: 'fila2' }, campo('Kg (aprox.)', inp('kg', { type: 'number', min: 0, step: 'any' })), campo('Horario de recogida', el('input', { type: 'text', maxlength: 120, value: r.horario || '', oninput: (e) => { v.recogida_horario = e.target; } }))),
        el('div', { class: 'fila2' }, campo('Persona de contacto', el('input', { type: 'text', maxlength: 120, value: r.contacto || '', oninput: (e) => { v.recogida_contacto = e.target; } })),
          campo('Teléfono', el('input', { type: 'tel', maxlength: 60, value: r.telefono || '', oninput: (e) => { v.recogida_telefono = e.target; } }))));
    }
    const albaran = el('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true });
    albaran.onchange = async () => {
      const f = albaran.files[0]; if (!f) return;
      try { const b = await reducir(f); pintar(await api('POST', b, `${API}/archivos`, { 'Content-Type': b.type || f.type, 'X-Nombre': encodeURIComponent(f.name) }), '📎 Albarán añadido'); }
      catch (e) { err.textContent = e.message; }
    };
    app.replaceChildren(...[
      el('div', { class: 'cab' },
        el('div', {}, el('div', { class: 'emp' }, d.empresa.nombre), el('div', { class: 'emp-datos' }, [d.empresa.telefono, d.empresa.email].filter(Boolean).join(' · '))),
        el('div', { class: 'ref' }, el('div', { class: 'tit' }, 'Pedido'), el('div', { class: 'cod' }, d.codigo))),
      el('p', { class: 'hola' }, `Hola${d.proveedor ? `, ${d.proveedor}` : ''}. Confirmad el pedido y decidnos cómo y cuándo llega.`),
      el('div', { class: 'tarea' }, el('h3', {}, 'Lo que pedimos'),
        el('ul', {}, d.lineas.map((l) => el('li', {}, `${String(l.cantidad).replace('.', ',')} ${l.unidad || ''} · ${l.descripcion}`)))),
      d.cerrado ? el('p', { class: 'ok-msg' }, 'Este pedido ya no admite cambios. Gracias.') : el('form', { class: 'tarea', onsubmit: async (ev) => {
        ev.preventDefault(); err.textContent = '';
        const cuerpo = { confirmar: confirmar.checked };
        for (const [k, i] of Object.entries(v)) cuerpo[k] = i.value;
        const b = ev.submitter; if (b) b.disabled = true;
        try { pintar(await api('PUT', cuerpo), '✔ Guardado. Gracias.'); } catch (e) { err.textContent = e.message; if (b) b.disabled = false; }
      } },
      el('label', { class: 'inc-op on' }, confirmar, d.confirmado ? ' Pedido confirmado' : ' Confirmo el pedido'),
      ...bloques,
      d.modo !== 'recogida' ? el('div', { class: 'campo' }, el('span', {}, 'Albarán de entrega'),
        el('div', {}, d.albaranes.map((a) => el('a', { href: `${API}/archivos/${a.id}`, target: '_blank', rel: 'noopener', style: 'margin-right:8px' }, `📎 ${a.nombre || 'albarán'}`)),
          el('button', { type: 'button', class: 'sec', onclick: () => albaran.click() }, '📷 Añadir foto o PDF'), albaran)) : null,
      campo('Comentario', inp('comentario', { tag: 'textarea', rows: 2, maxlength: 1000 })),
      err, el('p', {}, el('button', { type: 'submit', class: 'prim' }, 'Guardar'))),
      msg ? el('p', { class: 'ok-msg', role: 'status' }, msg) : null].filter(Boolean));
  }
  api('GET').then((d) => pintar(d)).catch((e) => { app.replaceChildren(el('p', { class: 'error' }, e.message)); });
})();
