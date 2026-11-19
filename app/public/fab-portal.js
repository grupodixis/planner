// Página pública del taller / galvanizadora: ven el pedido y los planos y actualizan SUS etapas (enlace con token, sin sesión)
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const API = `/api/fab-enlace/${encodeURIComponent(token)}`;
  const app = document.getElementById('app');

  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k === 'value') n.value = v;
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h instanceof Node ? h : String(h));
    return n;
  };
  const fecha = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const cuando = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  async function api(metodo, url, cuerpo, cab) {
    const blob = cuerpo instanceof Blob;
    const r = await fetch(url, { method: metodo, headers: blob ? cab : { 'Content-Type': 'application/json' }, body: blob ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se ha podido guardar. Inténtelo de nuevo.');
    return d;
  }
  async function subir(f) {
    if (f.size > 6 * 1024 * 1024) throw new Error(`«${f.name}» pasa de 6 MB`);
    if (!/^image\/(jpeg|png|webp)$|^application\/pdf$/.test(f.type)) throw new Error('Solo fotos (JPG, PNG) o PDF');
    return (await api('POST', `${API}/archivos`, f, { 'Content-Type': f.type, 'X-Nombre': encodeURIComponent(f.name) })).id;
  }

  // textos de los botones según la etapa
  const txtEmpezar = (e) => (e.tipo === 'transporte' ? `🚚 Entregado a ${e.transportista || 'transporte'}` : e.tipo === 'galvanizado' ? '📥 Recibido en planta, empezamos' : `▶ Empezamos ${e.nombre.toLowerCase()}`);
  const txtTerminar = (e) => (e.tipo === 'galvanizado' ? '✔ Galvanizado · listo para recoger' : `✔ ${e.nombre} terminada`);

  function pintar(d, mensaje) {
    document.title = `${d.codigo} · seguimiento · ${d.empresa.nombre}`;
    const n = d.etapas.length;
    const mias = d.partes.filter((p) => p.puede);

    // ---- varias a la vez: partes que están en la misma etapa suya
    const grupos = new Map();
    for (const p of mias) { if (!grupos.has(p.etapa)) grupos.set(p.etapa, []); grupos.get(p.etapa).push(p); }
    const lotes = [...grupos].filter(([, ps]) => ps.length > 1).map(([i, ps]) => {
      const e = d.etapas[i]; const sig = d.etapas[i + 1];
      const accion = async (b, txt) => {
        if (!confirm(`${txt}: ${ps.map((p) => p.nombre).join(', ')}. ¿Confirmar?`)) return;
        try { pintar(await api('POST', `${API}/accion`, { ...b, partes: ps.map((p) => p.id) }), 'Guardado. Ya lo vemos en HAM.'); scrollTo({ top: 0, behavior: 'smooth' }); }
        catch (er) { alert(er.message); }
      };
      const sinEmpezar = ps.filter((p) => !p.iniciada);
      return el('div', { class: 'lote' }, el('b', {}, `${ps.length} partes en «${e.nombre}»`),
        el('div', { class: 'bot' },
          sinEmpezar.length === ps.length ? el('button', { type: 'button', class: 'sec', onclick: () => accion({ accion: 'empezar' }, txtEmpezar(e)) }, `${txtEmpezar(e)} (todas)`) : null,
          e.tipo !== 'transporte' ? el('button', { type: 'button', class: 'sec', onclick: () => accion({ accion: 'terminar' }, txtTerminar(e)) }, `${txtTerminar(e)} (todas)`) : null,
          e.tipo !== 'transporte' && sig?.tipo === 'transporte' && d.etapas[i + 1].mia
            ? el('button', { type: 'button', class: 'prim', style: 'width:auto;margin:0', onclick: () => accion({ accion: 'terminar', entregar: true }, `Terminado y entregado a ${sig.transportista || 'transporte'}`) }, `🚚 Todas entregadas a ${sig.transportista || 'transporte'}`) : null));
    });

    const tarjeta = (p) => {
      const e = d.etapas[p.etapa];
      const sig = d.etapas[p.etapa + 1];
      const hechas = new Map(p.hechas.map((x) => [x.i, x.fin]));
      const pasos = el('div', { class: 'pasos', style: `--n:${n}` }, d.etapas.map((x, i) => el('span', {
        class: [p.recibido || i < p.etapa ? 'ok' : i === p.etapa ? (p.iniciada ? 'en' : 'pe') : '', x.mia ? '' : 'ext'].filter(Boolean).join(' '),
        title: `${x.nombre} · ${x.responsable}`,
      }, `${p.recibido || i < p.etapa ? '✔ ' : ''}${x.nombre}`)));
      const estado = el('div', { class: 'estado' },
        el('span', {}, p.recibido ? '✔ Recibido en Menorca' : `Ahora: ${p.donde}`),
        p.recibido ? null : el('span', {}, 'Llega a Menorca ', el('b', {}, `~${fecha(p.llegada)}`)));
      let form = null;
      if (p.puede) {
        const fotos = []; const nFotos = el('span');
        const av = el('input', { type: 'range', min: '0', max: '100', step: '5', value: String(p.avance ?? 0), 'aria-label': 'Avance' });
        const out = el('output', {}, `${p.avance ?? 0} %`);
        av.addEventListener('input', () => { out.textContent = `${av.value} %`; });
        const prev = el('input', { type: 'date', value: p.previsto || '' });
        const com = el('textarea', { rows: 2, maxlength: '1000', placeholder: p.comentario ? `Último: «${p.comentario}»` : 'Comentario (opcional): p. ej. «esperando chapa», «sale el lunes»' });
        const err = el('p', { class: 'error', role: 'alert' });
        const enviar = async (b, boton) => {
          err.textContent = '';
          boton.disabled = true;
          try {
            const nd = await api('POST', `${API}/accion`, { ...b, partes: [p.id], comentario: com.value.trim() || undefined, archivos: fotos });
            pintar(nd, `Guardado: ${p.nombre}. Ya lo vemos en HAM.`);
            scrollTo({ top: 0, behavior: 'smooth' });
          } catch (er) { err.textContent = er.message; boton.disabled = false; }
        };
        const transporte = e.tipo === 'transporte';
        form = el('div', { class: 'form' },
          !transporte ? el('div', { class: 'fila-av' }, el('span', {}, 'Avance'), av, out) : null,
          el('label', {}, el('span', {}, transporte ? 'Llegada prevista a Menorca (si la saben)' : `Fecha prevista de fin de ${e.nombre.toLowerCase()}`), prev),
          el('label', {}, el('span', {}, 'Comentario'), com),
          el('div', { class: 'fotos' }, el('label', {}, transporte ? '📎 Albarán / foto' : '📷 Fotos o PDF',
            el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true, hidden: true, onchange: async (ev) => {
              for (const f of ev.target.files) { try { fotos.push(await subir(f)); } catch (er) { err.textContent = er.message; } }
              nFotos.textContent = fotos.length ? `${fotos.length} adjunto(s) listos` : '';
            } })), nFotos),
          err,
          el('div', { class: 'bots' },
            !p.iniciada ? el('button', { type: 'button', class: transporte ? 'prim' : 'sec', style: transporte ? 'margin:0' : null, onclick: (ev) => enviar({ accion: 'empezar', previsto: prev.value || undefined }, ev.currentTarget) }, txtEmpezar(e)) : null,
            !transporte ? el('button', { type: 'button', class: 'sec', onclick: (ev) => enviar({ accion: 'avance', avance: Number(av.value), previsto: prev.value || null }, ev.currentTarget) }, 'Guardar avance') : null,
            transporte && p.iniciada ? el('button', { type: 'button', class: 'sec', onclick: (ev) => enviar({ accion: 'avance', previsto: prev.value || null }, ev.currentTarget) }, 'Guardar') : null,
            !transporte ? el('button', { type: 'button', class: 'prim', style: 'margin:0', onclick: (ev) => enviar({ accion: 'terminar' }, ev.currentTarget) }, txtTerminar(e)) : null,
            !transporte && sig?.tipo === 'transporte' && d.etapas[p.etapa + 1].mia
              ? el('button', { type: 'button', class: 'prim', style: 'margin:0', onclick: (ev) => enviar({ accion: 'terminar', entregar: true }, ev.currentTarget) }, `🚚 Terminado y entregado a ${sig.transportista || 'transporte'}`) : null),
          transporte && p.iniciada ? el('p', { class: 'pz-d' }, 'Cuando llegue a Menorca lo marcamos nosotros como recibido.') : null);
      }
      return el('div', { class: `pz${p.puede ? ' mia' : ''}` },
        el('div', { class: 'pz-n' }, p.nombre), p.detalle ? el('div', { class: 'pz-d' }, p.detalle) : null,
        pasos, estado, form);
    };

    const ordenadas = [...d.partes].sort((a, b) => (b.puede - a.puede) || (a.recibido - b.recibido));
    app.replaceChildren(el('div', { class: 'hoja' },
      el('header', { class: 'cab' },
        el('div', {}, el('div', { class: 'emp' }, d.empresa.nombre), el('div', { class: 'emp-datos' }, [d.empresa.telefono, d.empresa.email].filter(Boolean).join(' · '))),
        el('div', { class: 'ref' }, el('div', { class: 'tit' }, 'Seguimiento de fabricación'), el('div', { class: 'cod' }, d.codigo))),
      el('div', { class: 'datos' },
        el('div', {}, el('span', {}, 'Para'), d.yo.nombre),
        el('div', {}, el('span', {}, 'Trabajo'), d.titulo),
        d.proyecto ? el('div', {}, el('span', {}, 'Obra'), d.proyecto) : null,
        !d.yo.taller ? el('div', {}, el('span', {}, 'Taller'), d.taller) : null),
      mensaje ? el('div', { class: 'banda ok', role: 'status' }, '✔ ', mensaje) : null,
      d.estado !== 'en_curso' ? el('div', { class: 'banda aviso' }, d.estado === 'recibido' ? 'Este pedido ya está recibido entero. Gracias.' : 'Este pedido está anulado.') : null,
      d.estado === 'en_curso' && !mias.length ? el('div', { class: 'banda aviso' }, 'Ahora mismo no tienen ninguna parte pendiente de actualizar. Cuando les llegue algo, aparecerá aquí.') : null,
      d.planos.length || d.planos_enlace ? [el('h2', {}, 'Planos'),
        el('div', { class: 'planos' },
          d.planos.map((a) => el('a', { href: `${API}/archivos/${a.id}`, target: '_blank', rel: 'noopener' }, `📄 ${a.nombre || 'plano'}`)),
          d.planos_enlace ? el('a', { href: d.planos_enlace, target: '_blank', rel: 'noopener noreferrer' }, '🔗 Carpeta de planos') : null)] : null,
      el('h2', {}, 'Recorrido'),
      el('p', { class: 'pz-d', style: 'margin:0' }, d.etapas.map((e) => `${e.nombre} (${e.responsable})`).join(' → '), ' → Recibido en Menorca'),
      el('div', { class: 'leyenda' }, el('span', {}, el('i', { style: 'background:var(--acento)' }), 'en curso'), el('span', {}, el('i', { style: 'border:1.5px dashed var(--acento)' }), 'pendiente de empezar'),
        el('span', {}, el('i', { style: 'background:repeating-linear-gradient(45deg,var(--campo) 0 3px,var(--fondo) 3px 6px)' }), 'lo hace otro')),
      lotes.length ? [el('h2', {}, 'Actualizar varias a la vez'), lotes] : null,
      el('h2', {}, mias.length ? 'Partes' : 'Partes del pedido'),
      ordenadas.map(tarjeta),
      d.eventos.length ? [el('h2', {}, 'Últimos cambios'),
        el('ul', { class: 'hist' }, d.eventos.map((e) => el('li', {},
          el('span', { class: 'c' }, `${cuando(e.cuando)} · ${e.quien}`),
          e.parte ? `${e.parte}: ` : '', e.texto || '', e.comentario ? el('i', {}, ` «${e.comentario}»`) : null,
          e.archivos.map((a) => [' ', el('a', { href: `${API}/archivos/${a.id}`, target: '_blank', rel: 'noopener' }, `📎 ${a.nombre || 'archivo'}`)]))))] : null),
    el('p', { class: 'pie' }, `Enlace personal para ${d.yo.nombre}. No lo reenvíe fuera de su empresa.`));
  }

  (async () => {
    try { pintar(await api('GET', API)); }
    catch (e) { app.replaceChildren(el('div', { class: 'hoja' }, el('h1', { style: 'font-size:20px;margin-top:0' }, 'Enlace no válido'), el('p', {}, e.message))); }
  })();
})();
