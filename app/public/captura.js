/* Capturar: texto, audio, foto y vídeo (30 s) a la bandeja. Lo usan «Mi día» (operarios) y /capturar.html (oficina).
   window.Captura.montar(caja, { toast, tramoId? }) → { recargar, elegirTramo(id) } */
(() => {
  'use strict';
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden' || k === 'muted') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  async function api(metodo, url, cuerpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    if (r.status === 401) { location.replace(location.pathname === '/mi-dia.html' ? '/pin.html' : '/login.html'); throw new Error('Sesión caducada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const MAX_VIDEO = 30, MAX_AUDIO = 180;

  // tipo que el navegador sabe grabar (Chrome/Android: webm; Safari/iPhone: mp4)
  function tipoGrabacion(video) {
    const c = video ? ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    return c.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  }

  async function subirBlob(blob, nombre) {
    const tipo = (blob.type || '').split(';')[0] || 'application/octet-stream';
    const r = await fetch('/api/archivos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': tipo, 'X-Nombre': encodeURIComponent(nombre) }, body: blob });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d.id;
  }

  function montar(caja, { toast, tramoId = null } = {}) {
    const est = { op: null, adjuntos: [], categoria: null, grabando: null, tramoInicial: tramoId };

    /* ---------- formulario ---------- */
    const texto = el('textarea', { rows: 3, maxlength: 2000, placeholder: '¿Qué pasa? Escríbelo, o graba un audio o un vídeo…', 'aria-label': 'Qué pasa' });
    const minis = el('div', { class: 'cap-adjuntos' });
    const grab = el('div', { class: 'cap-grabando', hidden: true });
    const inFoto = el('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true });
    const inGaleria = el('input', { type: 'file', accept: 'image/*,video/*,audio/*,application/pdf', multiple: '', hidden: true });
    const btnAudio = el('button', { type: 'button', class: 'cap-btn' }, el('span', { 'aria-hidden': 'true' }, '🎤'), 'Audio');
    const btnVideo = el('button', { type: 'button', class: 'cap-btn' }, el('span', { 'aria-hidden': 'true' }, '📹'), 'Vídeo 30 s');
    const btnFoto = el('button', { type: 'button', class: 'cap-btn', onclick: () => inFoto.click() }, el('span', { 'aria-hidden': 'true' }, '📷'), 'Foto');
    const btnGal = el('button', { type: 'button', class: 'cap-btn', onclick: () => inGaleria.click() }, el('span', { 'aria-hidden': 'true' }, '🖼️'), 'De la galería');
    const chips = el('div', { class: 'md-chips cap-cats', role: 'radiogroup', 'aria-label': 'Qué tipo de asunto es (opcional)' });
    const selDonde = el('select', { 'aria-label': 'De qué trabajo, proyecto u OT es' });
    const selOT = el('select', { 'aria-label': 'OT', hidden: true });
    const selMaq = el('select', { 'aria-label': 'Qué máquina', hidden: true });
    const enviar = el('button', { type: 'submit', class: 'primario md-grande' }, 'Enviar a la bandeja');
    const form = el('form', { class: 'md-form cap-form' },
      texto,
      el('div', { class: 'cap-botones' }, btnAudio, btnVideo, btnFoto, btnGal),
      grab, minis, inFoto, inGaleria,
      el('details', { class: 'cap-mas', open: '' }, el('summary', {}, '¿De qué es? (opcional)'),
        el('div', { class: 'cap-mas-cuerpo' }, chips, selDonde, selOT, selMaq)),
      enviar);
    const lista = el('ul', { class: 'md-lista cap-lista' });
    caja.replaceChildren(form, el('h2', { class: 'cap-tit' }, 'Lo que he capturado'), lista);

    /* ---------- adjuntos ---------- */
    function pintarAdjuntos() {
      minis.replaceChildren(...est.adjuntos.map((a, i) => el('span', { class: `cap-adj ${a.clase}` },
        a.clase === 'foto' ? el('img', { src: a.url, alt: 'foto' })
          : a.clase === 'video' ? el('video', { src: a.url, muted: true, playsinline: '', preload: 'metadata' })
            : a.clase === 'audio' ? el('audio', { src: a.url, controls: '' }) : el('span', {}, '📄'),
        a.subiendo ? el('span', { class: 'cap-subiendo' }, 'subiendo…') : null,
        el('button', { type: 'button', class: 'cap-quitar', 'aria-label': 'Quitar', onclick: () => { est.adjuntos.splice(i, 1); pintarAdjuntos(); } }, '✕'))));
    }
    async function añadir(blob, nombre, clase) {
      const a = { url: URL.createObjectURL(blob), clase, subiendo: true, id: null };
      est.adjuntos.push(a); pintarAdjuntos();
      try {
        a.id = clase === 'foto' ? await window.s360.subirArchivo(new File([blob], nombre, { type: blob.type })) : await subirBlob(blob, nombre);
      } catch (e) {
        toast(e.message, true);
        est.adjuntos.splice(est.adjuntos.indexOf(a), 1);
      }
      a.subiendo = false; pintarAdjuntos();
    }
    const claseDe = (t) => (t.startsWith('image/') ? 'foto' : t.startsWith('video/') ? 'video' : t.startsWith('audio/') ? 'audio' : 'doc');
    inFoto.onchange = () => { for (const f of inFoto.files) añadir(f, f.name || 'foto.jpg', 'foto'); inFoto.value = ''; };
    inGaleria.onchange = async () => {
      for (const f of inGaleria.files) {
        if (f.type.startsWith('video/') && !(await duracionOk(f))) { toast('El vídeo pasa de 30 segundos: recórtalo o grábalo aquí', true); continue; }
        añadir(f, f.name || 'archivo', claseDe(f.type));
      }
      inGaleria.value = '';
    };
    function duracionOk(f) {
      return new Promise((ok) => {
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.onloadedmetadata = () => { ok(!(v.duration > MAX_VIDEO + 1)); URL.revokeObjectURL(v.src); };
        v.onerror = () => ok(true);
        v.src = URL.createObjectURL(f);
      });
    }

    /* ---------- grabar audio y vídeo ---------- */
    async function grabar(video) {
      if (est.grabando) return est.grabando.parar();
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
        // sin grabación en el navegador: la cámara / grabadora del móvil
        const i = el('input', { type: 'file', accept: video ? 'video/*' : 'audio/*', capture: video ? 'environment' : 'user', hidden: true });
        i.onchange = () => { inGaleria.files = i.files; inGaleria.onchange(); };
        caja.append(i); i.click(); return;
      }
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(video
          ? { audio: true, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } } } : { audio: true });
      } catch { toast(video ? 'No se ha podido abrir la cámara (¿permiso?)' : 'No se ha podido abrir el micrófono (¿permiso?)', true); return; }
      const mime = tipoGrabacion(video);
      const rec = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), ...(video ? { videoBitsPerSecond: 1500000 } : { audioBitsPerSecond: 64000 }) });
      const trozos = [];
      rec.ondataavailable = (e) => { if (e.data.size) trozos.push(e.data); };
      const max = video ? MAX_VIDEO : MAX_AUDIO;
      const t0 = Date.now();
      const cuenta = el('b', {}, '0:00');
      const btnParar = el('button', { type: 'button', class: 'primario' }, '■ Parar');
      grab.replaceChildren(
        video ? el('video', { class: 'cap-vivo', autoplay: '', muted: true, playsinline: '' }) : el('span', { class: 'cap-punto', 'aria-hidden': 'true' }),
        el('span', { class: 'cap-grab-txt' }, video ? 'Grabando vídeo ' : 'Grabando audio ', cuenta, ` / ${mmss(max)}`), btnParar);
      if (video) grab.querySelector('video').srcObject = stream;
      grab.hidden = false;
      const reloj = setInterval(() => {
        const s = (Date.now() - t0) / 1000;
        cuenta.textContent = mmss(s);
        if (s >= max) parar();
      }, 250);
      function parar() {
        if (rec.state !== 'inactive') rec.stop();
      }
      rec.onstop = () => {
        clearInterval(reloj);
        stream.getTracks().forEach((t) => t.stop());
        grab.hidden = true; grab.replaceChildren();
        est.grabando = null;
        (video ? btnVideo : btnAudio).classList.remove('activo');
        const tipo = (rec.mimeType || mime || (video ? 'video/webm' : 'audio/webm')).split(';')[0];
        const blob = new Blob(trozos, { type: tipo });
        if (blob.size) añadir(blob, `${video ? 'video' : 'audio'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.${tipo.includes('mp4') ? (video ? 'mp4' : 'm4a') : 'webm'}`, video ? 'video' : 'audio');
      };
      btnParar.onclick = parar;
      est.grabando = { parar };
      (video ? btnVideo : btnAudio).classList.add('activo');
      rec.start(1000);
    }
    btnAudio.onclick = () => grabar(false);
    btnVideo.onclick = () => grabar(true);

    /* ---------- de qué es ---------- */
    function pintarOpciones() {
      const o = est.op;
      chips.replaceChildren(...Object.entries(o.categorias).map(([k, t]) => el('button', {
        type: 'button', class: `md-chip${est.categoria === k ? ' activo' : ''}`, 'aria-pressed': est.categoria === k ? 'true' : 'false',
        onclick: () => { est.categoria = est.categoria === k ? null : k; pintarOpciones(); },
      }, t)));
      selMaq.hidden = est.categoria !== 'averia';
      const maqSel = selMaq.value;
      selMaq.replaceChildren(el('option', { value: '' }, '¿Qué máquina?'), ...o.maquinas.map((m) => el('option', { value: m.id }, m.nombre)));
      selMaq.value = maqSel;
      const dondeSel = selDonde.value || (est.tramoInicial ? `t${est.tramoInicial}` : o.tramos_hoy.length ? `t${o.tramos_hoy[0].id}` : '');
      selDonde.replaceChildren(
        el('option', { value: '' }, 'Sin indicar'),
        o.tramos_hoy.length ? el('optgroup', { label: 'Lo que estoy haciendo hoy' },
          o.tramos_hoy.map((t) => el('option', { value: `t${t.id}` }, `${t.orden_codigo} · ${t.tarea}`))) : null,
        el('optgroup', { label: 'Otro proyecto' }, o.proyectos.map((p) => el('option', { value: `p${p.id}` }, `${p.codigo} · ${p.nombre || ''}`))));
      selDonde.value = dondeSel;
      pintarOTs();
    }
    function pintarOTs() {
      const v = selDonde.value;
      selOT.hidden = !v.startsWith('p');
      if (selOT.hidden) return;
      const pid = Number(v.slice(1));
      const ots = est.op.ordenes.filter((x) => x.proyecto_id === pid);
      selOT.replaceChildren(el('option', { value: '' }, ots.length ? 'Todo el proyecto (o elige la OT)' : 'Este proyecto no tiene OTs abiertas'),
        ...ots.map((x) => el('option', { value: x.id }, `${x.codigo} · ${x.titulo || ''}`)));
    }
    selDonde.onchange = pintarOTs;

    /* ---------- enviar ---------- */
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (est.grabando) return toast('Para primero la grabación', true);
      if (est.adjuntos.some((a) => a.subiendo)) return toast('Espera a que termine de subir', true);
      const ids = est.adjuntos.map((a) => a.id).filter(Boolean);
      if (!texto.value.trim() && !ids.length) return toast('Escribe algo, graba un audio o haz una foto o vídeo', true);
      const v = selDonde.value;
      const tramo = v.startsWith('t') ? est.op.tramos_hoy.find((t) => `t${t.id}` === v) : null;
      const cuerpo = {
        texto: texto.value, categoria: est.categoria, archivos: ids,
        tramo_id: tramo?.id || null,
        orden_id: tramo ? tramo.orden_id : Number(selOT.value) || null,
        proyecto_id: tramo ? tramo.proyecto_id : v.startsWith('p') ? Number(v.slice(1)) : null,
        maquina_id: est.categoria === 'averia' ? Number(selMaq.value) || null : null,
      };
      enviar.disabled = true;
      try {
        await api('POST', '/api/capturas', cuerpo);
        toast('Enviado a la bandeja');
        texto.value = ''; est.adjuntos = []; est.categoria = null; pintarAdjuntos(); pintarOpciones();
        await cargarLista();
      } catch (e) { toast(e.message, true); } finally { enviar.disabled = false; }
    };

    /* ---------- lo que he capturado ---------- */
    async function cargarLista() {
      const d = await api('GET', '/api/capturas/mias');
      lista.replaceChildren(...(d.capturas.length ? d.capturas.map((c) => el('li', { class: `cap-mia e-${c.estado}` },
        el('div', { class: 'cap-mia-cab' },
          el('span', {}, new Date(c.creado).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })),
          c.categoria ? el('b', {}, d.categorias[c.categoria]) : null,
          el('span', { class: `cap-estado e-${c.estado}` }, d.estados[c.estado] || c.estado)),
        c.texto ? el('div', {}, c.texto) : null,
        window.s360.adjuntos(c.archivos),
        c.orden_codigo || c.proyecto_codigo ? el('div', { class: 'ayuda' }, [c.proyecto_codigo, c.orden_codigo].filter(Boolean).join(' · ')) : null,
        c.estado === 'tarea' && c.tarea_creada ? el('div', { class: 'ayuda' }, `→ Tarea: ${c.tarea_creada}`) : null,
        c.estado === 'asunto' && c.responsable ? el('div', { class: 'ayuda' }, `→ Lo lleva ${c.responsable}${c.fecha_limite ? ` (para el ${new Date(`${c.fecha_limite}T12:00:00`).toLocaleDateString('es-ES')})` : ''}`) : null,
        c.nota ? el('div', { class: 'ayuda' }, `Nota: ${c.nota}`) : null,
        c.resolucion ? el('div', { class: 'md-ok' }, `✔ ${c.resolucion}`) : null)) : [el('li', { class: 'ayuda' }, 'Aún no has capturado nada.')]));
    }

    async function recargar() {
      est.op = await api('GET', '/api/capturas/opciones');
      pintarOpciones();
      await cargarLista();
    }
    recargar().catch((e) => toast(e.message, true));
    return {
      recargar,
      elegirTramo: (id) => { est.tramoInicial = id; if (est.op) { selDonde.value = `t${id}`; pintarOTs(); } texto.focus(); },
    };
  }

  window.Captura = { montar };
})();
