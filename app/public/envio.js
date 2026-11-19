// Página pública: el transportista dice cómo va un envío a Menorca (enlace con token, sin sesión).
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const API = `/api/envio/${encodeURIComponent(token)}`;
  const app = document.getElementById('app');

  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h instanceof Node ? h : String(h));
    return n;
  };
  const dm = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '');
  const ESTADOS = [['recogido', 'Recogido'], ['en_barco', 'En barco'], ['en_mao', 'En Maó'], ['entregado', 'Entregado']];

  async function api(metodo, url, cuerpo, cab) {
    const r = await fetch(url, { method: metodo, headers: cuerpo instanceof Blob ? cab : { 'Content-Type': 'application/json' }, body: cuerpo instanceof Blob ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se ha podido completar. Inténtelo de nuevo.');
    return d;
  }
  async function reducir(file) {
    if (!file.type.startsWith('image/') || file.size < 400 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise((ok) => c.toBlob((b) => ok(b || file), 'image/jpeg', 0.85));
    } catch { return file; }
  }

  let d = null; let b = null; let mensaje = null;
  const nuevoBorrador = () => ({
    estado: d.estado === 'preparando' ? null : d.estado, llegada: d.llegada_prevista || '', ref: d.ref_transportista || '', nota: d.nota_transportista || '',
    recogidas: Object.fromEntries(d.lineas.map((l) => [l.id, l.recogido])),
  });

  function pintar() {
    if (!b) b = nuevoBorrador();
    document.title = `Envío ${d.codigo} · ${d.empresa.nombre}`;
    const vencida = (d.estado === 'preparando' && d.recogida_prevista && d.recogida_prevista < d.hoy)
      || (['recogido', 'en_barco'].includes(d.estado) && d.llegada_prevista && d.llegada_prevista < d.hoy);
    const subir = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, 'aria-label': 'Añadir foto del CMR o albarán',
      onchange: async (ev) => {
        try {
          for (const f of [...ev.target.files]) { const x = await reducir(f); d = await api('POST', `${API}/archivos`, x, { 'Content-Type': x.type || f.type, 'X-Nombre': encodeURIComponent(f.name) }); }
          mensaje = { ok: true, txt: 'Añadido' };
        } catch (e) { mensaje = { ok: false, txt: e.message }; }
        pintar();
      } });
    app.replaceChildren(el('div', { class: 'hoja' },
      el('div', { class: 'cab' },
        el('div', {}, el('div', { class: 'emp' }, d.empresa.nombre), el('div', { class: 'emp-datos' }, 'Envío a Menorca')),
        el('div', { class: 'ref' }, el('div', { class: 'tit' }, 'Envío'), el('div', { class: 'cod' }, d.codigo))),
      el('p', { class: 'hola' }, 'Hola ', el('b', {}, d.transportista || ''), ': indíquenos cómo va este envío; no hace falta usuario.'),
      vencida ? el('div', { class: 'banda aviso' }, `⏰ ${d.estado === 'preparando' ? `La recogida estaba prevista el ${dm(d.recogida_prevista)}` : `La llegada a Maó estaba prevista el ${dm(d.llegada_prevista)}`}. ¿Cómo va?`) : null,
      el('div', { class: 'tarea' },
        el('h3', {}, 'Recoger en'),
        d.recogida_prevista ? el('div', { class: 'plan' }, `Recogida prevista: ${dm(d.recogida_prevista)}`) : null,
        d.lineas.map((l) => el('label', { class: 'campo', style: 'display:flex;gap:10px;align-items:flex-start' },
          el('input', { type: 'checkbox', checked: !!b.recogidas[l.id], style: 'margin-top:4px', onchange: (ev) => { b.recogidas[l.id] = ev.target.checked; mensaje = null; } }),
          el('span', { style: 'color:var(--tinta)' }, el('b', {}, l.origen || '—'), el('br'), l.descripcion,
            (l.bultos || l.kg) ? el('small', { style: 'display:block;color:var(--suave)' }, [l.bultos ? `${l.bultos} bultos` : null, l.kg ? `${l.kg} kg` : null].filter(Boolean).join(' · ')) : null))),
        d.entregar_en ? el('div', { class: 'plan', style: 'margin-top:10px' }, `Entregar en: ${d.entregar_en}`) : null,
        d.notas ? el('div', { class: 'plan' }, d.notas) : null),
      el('div', { class: 'tarea' },
        el('h3', {}, '¿Cómo va?'),
        el('div', { class: 'estados', role: 'group', 'aria-label': 'Estado del envío' }, ESTADOS.map(([k, txt]) => el('button', {
          type: 'button', class: b.estado === k ? 'on' : null, 'aria-pressed': b.estado === k ? 'true' : 'false',
          onclick: () => { b.estado = k; mensaje = null; pintar(); },
        }, txt))),
        el('div', { class: 'fila2' },
          el('label', { class: 'campo' }, el('span', {}, 'Llega a Maó el'),
            el('input', { type: 'date', value: b.llegada, onchange: (ev) => { b.llegada = ev.target.value; } })),
          el('label', { class: 'campo' }, el('span', {}, 'Vuestra referencia'),
            el('input', { type: 'text', maxlength: 80, value: b.ref, oninput: (ev) => { b.ref = ev.target.value; } }))),
        el('div', { class: 'campo' }, el('span', {}, 'CMR, albarán o fotos'),
          el('div', { class: 'fotos' },
            d.archivos.map((f) => el('div', { class: 'foto' },
              el('a', { href: `${API}/archivos/${f.id}`, target: '_blank', rel: 'noopener' }, f.tipo.startsWith('image/') ? el('img', { src: `${API}/archivos/${f.id}`, alt: f.nombre || 'Foto' }) : '📄'),
              f.mio ? el('button', { type: 'button', 'aria-label': 'Quitar', onclick: async () => { if (!confirm('¿Quitar este archivo?')) return; d = await api('DELETE', `${API}/archivos/${f.id}`); pintar(); } }, '✕') : null)),
            el('label', { class: 'foto mas', title: 'Añadir' }, '＋', subir))),
        el('label', { class: 'campo' }, el('span', {}, 'Comentario'),
          el('input', { type: 'text', maxlength: 300, value: b.nota, placeholder: 'p. ej. «sale en el barco de las 22:00»', oninput: (ev) => { b.nota = ev.target.value; } }))),
      d.estado !== 'entregado' ? el('button', { type: 'button', class: 'prim guardar', onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try {
          d = await api('PUT', API, { estado: b.estado || undefined, llegada_prevista: b.llegada || null, ref_transportista: b.ref, nota: b.nota, recogidas: b.recogidas });
          b = null; mensaje = { ok: true, txt: '✔ Recibido, gracias. Puede volver a este enlace cuando quiera para actualizarlo.' };
        } catch (e) { mensaje = { ok: false, txt: e.message }; }
        pintar();
      } }, 'Enviar') : el('div', { class: 'banda ok' }, `✔ Entregado${d.fechas?.entregado ? ` el ${dm(d.fechas.entregado)}` : ''}. Gracias.`),
      mensaje ? el('p', { class: mensaje.ok ? 'ok-msg' : 'error', role: mensaje.ok ? 'status' : 'alert' }, mensaje.txt) : null,
      el('p', { class: 'pie' }, `¿Dudas? ${[d.empresa.telefono, d.empresa.email].filter(Boolean).join(' · ')}`)));
  }

  api('GET', API).then((x) => { d = x; pintar(); }).catch((e) => app.replaceChildren(el('p', { class: 'vacio' }, e.message)));
})();
