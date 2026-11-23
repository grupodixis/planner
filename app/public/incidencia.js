// Página pública: el proveedor / transportista / subcontrata responde a una incidencia (enlace con token, sin sesión):
// qué hará y la fecha en que quedará resuelto.
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const API = `/api/incidencia-ext/${encodeURIComponent(token)}`;
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
  const eur = (v) => `${Number(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  async function api(metodo, cuerpo) {
    const r = await fetch(API, { method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se ha podido completar. Inténtelo de nuevo.');
    return d;
  }
  function pintar(d, msg) {
    document.title = `Incidencia ${d.codigo} · ${d.empresa.nombre}`;
    const hoy = new Date().toLocaleDateString('sv-SE');
    let accion = d.respuesta?.accion || 'reponer';
    const opciones = el('div', { class: 'inc-ops', role: 'radiogroup', 'aria-label': '¿Qué haréis?' },
      Object.entries(d.acciones).map(([k, t]) => el('label', { class: `inc-op${k === accion ? ' on' : ''}` },
        el('input', { type: 'radio', name: 'accion', value: k, checked: k === accion, onchange: () => { accion = k; imp.hidden = k !== 'abono'; for (const x of opciones.querySelectorAll('.inc-op')) x.classList.toggle('on', x.querySelector('input').checked); } }), t)));
    const fecha = el('input', { type: 'date', min: hoy, value: d.respuesta?.fecha || '', required: true, 'aria-label': 'Fecha de resolución' });
    const importe = el('input', { type: 'number', min: 0, step: '0.01', value: d.respuesta?.importe ?? '', placeholder: '€' });
    const imp = el('label', { class: 'campo' }, el('span', {}, 'Importe del abono'), importe); imp.hidden = accion !== 'abono';
    const com = el('textarea', { rows: 3, placeholder: 'Cómo y cuándo lo haréis, referencia de envío…' }, d.respuesta?.comentario || '');
    const err = el('p', { class: 'error', role: 'alert' });
    app.replaceChildren(...[
      el('div', { class: 'cab' },
        el('div', {}, el('div', { class: 'emp' }, d.empresa.nombre), el('div', { class: 'emp-datos' }, [d.empresa.telefono, d.empresa.email].filter(Boolean).join(' · '))),
        el('div', { class: 'ref' }, el('div', { class: 'tit' }, `Incidencia · ${d.tipo}`), el('div', { class: 'cod' }, d.codigo))),
      el('p', { class: 'hola' }, `Hola${d.proveedor ? `, ${d.proveedor}` : ''}. Hemos tenido esta incidencia y necesitamos saber qué haréis y para cuándo.`),
      el('div', { class: 'tarea' },
        el('h3', {}, d.titulo),
        el('p', { class: 'plan' }, [d.pedido ? `Pedido ${d.pedido}` : null, d.envio ? `Envío ${d.envio}` : null, d.material ? `${d.material}${d.cantidad ? ` · ${String(d.cantidad).replace('.', ',')} ${d.unidad || ''}` : ''}` : null].filter(Boolean).join(' · ')),
        d.texto ? el('p', {}, d.texto) : null,
        d.pedimos ? el('p', {}, el('b', {}, 'Os pedimos: '), `${d.pedimos}${d.abono_pedido ? ` (${eur(d.abono_pedido)})` : ''}${d.necesario_el ? `, antes del ${dl(d.necesario_el)}` : ''}.`) : null,
        d.fotos.length ? el('div', { class: 'inc-fotos-ext' }, d.fotos.map((f) => el('a', { href: `${API}/archivos/${f.id}`, target: '_blank', rel: 'noopener' },
          f.tipo.startsWith('image/') ? el('img', { src: `${API}/archivos/${f.id}`, alt: f.nombre || 'foto' }) : `📎 ${f.nombre || 'archivo'}`))) : null,
        el('p', {}, el('a', { href: `${API}/pdf`, target: '_blank', rel: 'noopener' }, '📄 Informe de la incidencia (PDF)'))),
      d.fecha_acordada ? el('p', { class: 'ok-msg' }, `✔ Quedamos en que se resuelve el ${dl(d.fecha_acordada)}. Si cambia algo, actualizadlo aquí.`) : null,
      !d.abierta ? el('p', { class: 'ok-msg' }, '✔ Esta incidencia ya está resuelta. Gracias.') : el('form', { class: 'tarea', onsubmit: async (ev) => {
        ev.preventDefault(); err.textContent = '';
        if (!fecha.value) { err.textContent = 'Indicad la fecha en que quedará resuelto.'; fecha.focus(); return; }
        const b = ev.submitter; if (b) b.disabled = true;
        try { pintar(await api('PUT', { accion, fecha: fecha.value, comentario: com.value, importe: importe.value }), '✔ Respuesta enviada. Gracias: os lo recordaremos ese día.'); }
        catch (e) { err.textContent = e.message; if (b) b.disabled = false; }
      } },
      el('h3', {}, d.respuesta ? 'Vuestra respuesta (podéis cambiarla)' : 'Vuestra respuesta'),
      el('div', { class: 'campo' }, el('span', {}, '¿Qué haréis?'), opciones), imp,
      el('label', { class: 'campo' }, el('span', {}, 'Fecha en que quedará resuelto *'), fecha),
      el('label', { class: 'campo' }, el('span', {}, 'Comentario'), com),
      err, el('p', {}, el('button', { type: 'submit', class: 'prim' }, d.respuesta ? 'Actualizar respuesta' : 'Enviar respuesta'))),
      msg ? el('p', { class: 'ok-msg', role: 'status' }, msg) : null].filter(Boolean));
  }
  api('GET').then((d) => pintar(d)).catch((e) => { app.replaceChildren(el('p', { class: 'error' }, e.message)); });
})();
