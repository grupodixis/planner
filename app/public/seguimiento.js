// Página pública: el taller externo cuenta cómo van sus tareas de una OT (enlace con token, sin sesión).
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const API = `/api/seguimiento/${encodeURIComponent(token)}`;
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
  const ESTADOS = [['sin_empezar', 'Sin empezar'], ['en_curso', 'En curso'], ['terminado', 'Terminado'], ['entregado', 'Entregado']];

  async function api(metodo, url, cuerpo, cab) {
    const r = await fetch(url, { method: metodo, headers: cuerpo instanceof Blob ? cab : { 'Content-Type': 'application/json' }, body: cuerpo instanceof Blob ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se ha podido completar. Inténtelo de nuevo.');
    return d;
  }

  // Foto del móvil: se reduce (máx. 1600 px) antes de subirla
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

  let datos = null;
  const borrador = new Map();   // lo que ha tocado y aún no ha enviado (sobrevive a subir fotos)
  let mensaje = null;

  const de = (t) => {
    if (!borrador.has(t.id)) {
      borrador.set(t.id, {
        estado: t.estado, avance: t.avance ?? (t.estado === 'en_curso' ? 0 : null), fin_prevista: t.fin_prevista || '', nota: t.nota || '',
        entrega: { destino: t.entrega.proveedor_id ?? (t.entrega.a === 'nosotros' ? 'nosotros' : t.entrega.a ? 'otro' : ''), texto: t.entrega.a && !t.entrega.proveedor_id && t.entrega.a !== 'nosotros' ? t.entrega.a : '', fecha: t.entrega.fecha || datos.hoy, nota: t.entrega.nota || '' },
        tocada: false,
      });
    }
    return borrador.get(t.id);
  };

  function fotos(t, albaran) {
    const lista = albaran ? t.albaran : t.fotos;
    const subir = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: !albaran, 'aria-label': albaran ? 'Añadir foto del albarán' : 'Añadir fotos',
      onchange: async (ev) => {
        const fs = [...ev.target.files];
        try {
          for (const f of fs) {
            const b = await reducir(f);
            datos = await api('POST', `${API}/tareas/${t.id}/archivos${albaran ? '?albaran=1' : ''}`, b, { 'Content-Type': b.type || f.type, 'X-Nombre': encodeURIComponent(f.name) });
          }
          mensaje = { ok: true, txt: fs.length > 1 ? 'Fotos añadidas' : 'Añadida' };
        } catch (e) { mensaje = { ok: false, txt: e.message }; }
        pintar();
      } });
    return el('div', { class: 'fotos' },
      lista.map((f) => el('div', { class: 'foto' },
        f.tipo.startsWith('image/') ? el('a', { href: `${API}/archivos/${f.id}`, target: '_blank', rel: 'noopener' }, el('img', { src: `${API}/archivos/${f.id}`, alt: f.nombre || 'Foto' }))
          : el('a', { href: `${API}/archivos/${f.id}`, target: '_blank', rel: 'noopener' }, '📄'),
        f.mia ? el('button', { type: 'button', 'aria-label': 'Quitar', title: 'Quitar', onclick: async () => {
          if (!confirm('¿Quitar este archivo?')) return;
          try { datos = await api('DELETE', `${API}/archivos/${f.id}`); } catch (e) { mensaje = { ok: false, txt: e.message }; }
          pintar();
        } }, '✕') : null)),
      el('label', { class: 'foto mas', title: albaran ? 'Foto del albarán' : 'Añadir fotos' }, '＋', subir));
  }

  function tarjeta(t) {
    if (!t.propia) {
      return el('div', { class: 'tarea ajena' },
        el('h3', {}, el('span', { class: 'cod' }, t.codigo), t.nombre),
        el('div', { class: 'plan' }, `Lo hace ${t.proveedor} · ${ESTADOS.find((e) => e[0] === t.estado)?.[1].toLowerCase()}${t.plan.desde ? ` · previsto ${dm(t.plan.desde)} → ${dm(t.plan.hasta)}` : ''} · solo para que lo vea`));
    }
    const b = de(t);
    const marcar = () => { b.tocada = true; mensaje = null; };
    const caja = el('div', { class: 'tarea' });
    const repintar = () => caja.replaceChildren(...contenido().filter(Boolean));
    const contenido = () => [
      el('h3', {}, el('span', { class: 'cod' }, t.codigo), t.nombre),
      el('div', { class: 'plan' }, t.plan.desde ? `Lo que tenemos previsto: ${dm(t.plan.desde)} → ${dm(t.plan.hasta)}` : 'Aún sin fechas por nuestra parte'),
      t.viene_de ? el('p', { class: 'viene' }, t.recibido ? `📦 Recibido de ${t.viene_de.proveedor} el ${dm(t.recibido)}`
        : `Antes lo hace ${t.viene_de.proveedor} (${ESTADOS.find((e) => e[0] === t.viene_de.estado)?.[1].toLowerCase()})`) : null,
      t.vencida && !b.tocada ? el('div', { class: 'banda aviso vencida' }, `⏰ ${t.fin_prevista ? 'Nos dijo que terminaba' : 'Lo teníamos previsto para'} el ${dm(t.fin_prevista || t.plan.hasta)}. ¿Cómo va? Ponga la fecha nueva o márquelo terminado.`) : null,
      el('div', { class: 'estados', role: 'group', 'aria-label': 'Estado' }, ESTADOS.map(([k, txt]) => el('button', {
        type: 'button', class: b.estado === k ? 'on' : null, 'aria-pressed': b.estado === k ? 'true' : 'false',
        onclick: () => { b.estado = k; if (k === 'en_curso' && b.avance == null) b.avance = 0; marcar(); repintar(); },
      }, txt))),
      b.estado === 'en_curso' ? el('label', { class: 'campo' }, el('span', {}, 'Avance'),
        el('div', { class: 'avance' },
          el('input', { type: 'range', min: 0, max: 100, step: 5, value: b.avance ?? 0, 'aria-label': 'Avance en %',
            oninput: (ev) => { b.avance = Number(ev.target.value); ev.target.nextSibling.textContent = `${b.avance} %`; marcar(); } }),
          el('b', {}, `${b.avance ?? 0} %`))) : null,
      ['sin_empezar', 'en_curso'].includes(b.estado) ? el('div', { class: 'fila2' },
        el('label', { class: 'campo' }, el('span', {}, b.estado === 'sin_empezar' ? 'Terminaré previsiblemente el' : 'Terminaré el'),
          el('input', { type: 'date', value: b.fin_prevista || '', min: datos.hoy, onchange: (ev) => { b.fin_prevista = ev.target.value; marcar(); } })),
        el('div', { class: 'campo' }, el('span', {}, 'Fotos'), fotos(t, false))) : null,
      b.estado === 'entregado' ? el('div', { class: 'entrega' },
        el('b', {}, '¿A quién lo ha entregado?'),
        el('div', { class: 'destinos', role: 'group', 'aria-label': 'Entregado a' },
          [...datos.destinos.map((d) => [d.id, d.nombre]), ['nosotros', datos.empresa.nombre], ['otro', 'Otro…']].map(([v, txt]) => el('button', {
            type: 'button', class: String(b.entrega.destino) === String(v) ? 'on' : null, 'aria-pressed': String(b.entrega.destino) === String(v) ? 'true' : 'false',
            onclick: () => { b.entrega.destino = v; marcar(); repintar(); },
          }, txt))),
        b.entrega.destino === 'otro' ? el('label', { class: 'campo' }, el('span', {}, '¿A quién?'),
          el('input', { type: 'text', maxlength: 120, value: b.entrega.texto, oninput: (ev) => { b.entrega.texto = ev.target.value; marcar(); } })) : null,
        el('div', { class: 'fila2' },
          el('label', { class: 'campo' }, el('span', {}, 'Fecha de entrega'),
            el('input', { type: 'date', value: b.entrega.fecha || '', max: datos.hoy, onchange: (ev) => { b.entrega.fecha = ev.target.value; marcar(); } })),
          el('div', { class: 'campo' }, el('span', {}, 'Albarán (foto)'), fotos(t, true))),
        el('label', { class: 'campo' }, el('span', {}, 'Bultos, peso…'),
          el('input', { type: 'text', maxlength: 300, value: b.entrega.nota, placeholder: 'p. ej. 3 bultos, 420 kg', oninput: (ev) => { b.entrega.nota = ev.target.value; marcar(); } }))) : null,
      b.estado === 'terminado' ? el('div', { class: 'campo' }, el('span', {}, 'Fotos'), fotos(t, false)) : null,
      el('label', { class: 'campo' }, el('span', {}, 'Comentario'),
        el('input', { type: 'text', maxlength: 300, value: b.nota, placeholder: 'p. ej. «esperando pletina»', oninput: (ev) => { b.nota = ev.target.value; marcar(); } })),
      t.actualizado ? el('div', { class: 'plan', style: 'margin:8px 0 0' }, `Última actualización: ${new Date(t.actualizado).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`) : null,
    ];
    repintar();
    return caja;
  }

  async function enviar(btn) {
    const cuerpo = { tareas: {} };
    for (const t of datos.tareas.filter((x) => x.propia)) {
      const b = de(t);
      cuerpo.tareas[t.id] = { estado: b.estado, avance: b.estado === 'en_curso' ? b.avance : null, fin_prevista: ['sin_empezar', 'en_curso'].includes(b.estado) ? b.fin_prevista || null : t.fin_prevista, nota: b.nota,
        ...(b.estado === 'entregado' ? { entrega: { destino: b.entrega.destino, texto: b.entrega.texto, fecha: b.entrega.fecha, nota: b.entrega.nota } } : {}) };
    }
    btn.disabled = true;
    try {
      datos = await api('PUT', API, cuerpo);
      borrador.clear();
      mensaje = { ok: true, txt: '✔ Recibido, gracias. Puede volver a este enlace cuando quiera para actualizarlo.' };
    } catch (e) { mensaje = { ok: false, txt: e.message }; }
    pintar();
    document.querySelector('.ok-msg, .error')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function pintar() {
    const d = datos;
    document.title = `Seguimiento OT ${d.ot.codigo} · ${d.empresa.nombre}`;
    const propias = d.tareas.filter((t) => t.propia);
    app.replaceChildren(el('div', { class: 'hoja' },
      el('div', { class: 'cab' },
        el('div', {}, el('div', { class: 'emp' }, d.empresa.nombre), el('div', { class: 'emp-datos' }, 'Seguimiento de trabajo')),
        el('div', { class: 'ref' }, el('div', { class: 'tit' }, 'OT'), el('div', { class: 'cod' }, d.ot.codigo),
          (d.pedidos || []).length ? el('div', { class: 'emp-datos' }, `Pedido ${d.pedidos.join(', ')}`) : null)),
      el('p', { class: 'hola' }, 'Hola ', el('b', {}, d.proveedor), ': estas son sus tareas de la ', el('b', {}, `OT ${d.ot.codigo} ${d.ot.titulo}`),
        d.proyecto.obra ? ` (${d.proyecto.obra})` : '', '. Cuéntenos cómo van; no hace falta usuario.'),
      !d.ot.abierta ? el('div', { class: 'banda ok' }, 'Esta orden ya está cerrada: queda solo para consultar.') : null,
      d.tareas.map(tarjeta),
      d.ot.abierta && propias.length ? el('button', { type: 'button', class: 'prim guardar', onclick: (ev) => enviar(ev.currentTarget) }, 'Enviar actualización') : null,
      mensaje ? el('p', { class: mensaje.ok ? 'ok-msg' : 'error', role: mensaje.ok ? 'status' : 'alert' }, mensaje.txt) : null,
      el('p', { class: 'pie' }, `¿Dudas? ${[d.empresa.telefono, d.empresa.email].filter(Boolean).join(' · ')}`)));
  }

  api('GET', API).then((d) => { datos = d; pintar(); })
    .catch((e) => app.replaceChildren(el('p', { class: 'vacio' }, e.message)));
})();
