/* s360_planificacion · común a todas las pantallas: permisos, menú Usuarios y «Mi cuenta» */
(() => {
  'use strict';

  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };

  async function api(metodo, url, cuerpo) {
    const r = await fetch(url, {
      method: metodo, credentials: 'same-origin',
      headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('No autenticado'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    return data;
  }

  let usuario = null;
  const tiene = (permiso) => !!usuario && (usuario.permisos || []).includes(permiso);

  function dialogoCuenta() {
    let d = document.getElementById('dlg-cuenta');
    if (d) return d;
    const msg = el('p', { class: 'error', role: 'alert' });
    const nombre = el('input', { name: 'nombre', required: true, maxlength: 80, autocomplete: 'name' });
    const actual = el('input', { name: 'actual', type: 'password', autocomplete: 'current-password' });
    const nueva = el('input', { name: 'nueva', type: 'password', autocomplete: 'new-password', minlength: 8 });
    const repetir = el('input', { name: 'repetir', type: 'password', autocomplete: 'new-password' });
    const info = el('p', { class: 'ayuda', id: 'cuenta-info' });
    d = el('dialog', { id: 'dlg-cuenta', class: 'dlg-cuenta', 'aria-labelledby': 'dlg-cuenta-tit' },
      el('form', { method: 'dialog', class: 'form-cuenta', onsubmit: guardar },
        el('div', { class: 'dlg-cab' },
          el('h2', { id: 'dlg-cuenta-tit' }, 'Mi cuenta'),
          el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
        info,
        el('label', {}, 'Nombre', nombre),
        el('fieldset', {},
          el('legend', {}, 'Cambiar contraseña (opcional)'),
          el('label', {}, 'Contraseña actual', actual),
          el('label', {}, 'Contraseña nueva', nueva),
          el('label', {}, 'Repite la nueva', repetir),
          el('p', { class: 'ayuda' }, 'Mínimo 8 caracteres, mezclando letras con números o símbolos. Al cambiarla se cierra la sesión en los demás navegadores.')),
        msg,
        el('div', { class: 'acciones' },
          el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
          el('button', { type: 'submit', class: 'primario' }, 'Guardar'))));
    document.body.append(d);

    async function guardar(ev) {
      ev.preventDefault();
      msg.textContent = '';
      try {
        if (nueva.value || actual.value) {
          if (nueva.value !== repetir.value) throw new Error('Las dos contraseñas nuevas no coinciden');
          await api('POST', '/api/me/password', { actual: actual.value, nueva: nueva.value });
        }
        if (nombre.value.trim() !== usuario.nombre) {
          await api('PATCH', '/api/me', { nombre: nombre.value });
          usuario.nombre = nombre.value.trim();
          pintarNombre();
        }
        d.close();
        aviso(nueva.value ? 'Contraseña cambiada' : 'Guardado');
      } catch (e) { msg.textContent = e.message; }
    }
    d.abrir = () => {
      nombre.value = usuario.nombre;
      actual.value = nueva.value = repetir.value = '';
      msg.textContent = '';
      info.textContent = `${usuario.email} · rol ${usuario.rol_nombre || usuario.rol}`;
      d.showModal();
      nombre.focus();
    };
    return d;
  }

  function aviso(texto) {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = texto;
    t.className = 'toast ver';
    clearTimeout(aviso._t);
    aviso._t = setTimeout(() => (t.className = 'toast'), 2600);
  }

  function pintarNombre() {
    const span = document.getElementById('usuario-nombre');
    if (!span) return;
    const sinPermisos = !(usuario.permisos || []).length;
    const b = el('button', { type: 'button', class: 'ghost enlace-cuenta', title: 'Mi cuenta: nombre y contraseña' },
      usuario.nombre, sinPermisos ? el('span', { class: 'rol-txt' }, ' (consulta)') : null);
    b.onclick = () => dialogoCuenta().abrir();
    span.replaceChildren(b);
  }

  // Lo llama cada pantalla al cargar el usuario (/api/me)
  function iniciar(u) {
    usuario = u;
    // los operarios (solo «Mi día») no tienen nada que hacer en el resto de pantallas
    if (u.solo_mi_dia && location.pathname !== '/mi-dia.html') { location.replace('/mi-dia.html'); return; }
    pintarNombre();
    const menu = document.querySelector('nav.menu');
    const enlaces = [['/mi-dia.html', 'Mi día', 'mi_dia'], ['/parte.html', 'Parte', 'planificar'], ['/bandeja.html', 'Bandeja', 'planificar'],
      ['/logistica.html', 'Logística', ['logistica', 'compras', 'escandallo']], ['/capacidades.html', 'Capacidades', ['recursos', 'planificar']], ['/informes.html', 'Informes', 'informes'],
      ['/usuarios.html', 'Usuarios', 'usuarios'], ['/capturar.html', '＋ Capturar', null]];
    for (const [href, txt, permiso] of enlaces) {
      if (!menu || (permiso && ![].concat(permiso).some((p) => tiene(p))) || menu.querySelector(`a[href="${href}"]`)) continue;
      const a = el('a', { href }, txt);
      if (location.pathname === href) a.setAttribute('aria-current', 'page');
      menu.append(a);
    }
    refrescarPendientes();
    const salir = document.getElementById('salir');
    if (salir && window.s360pwa && !document.getElementById('btn-avisos')) {
      const b = el('button', { type: 'button', class: 'ghost', id: 'btn-avisos', title: 'Avisos al móvil', 'aria-label': 'Avisos', onclick: () => window.s360pwa.ajustes() }, '🔔');
      salir.before(b, ' ');
      window.s360pwa.renovar();
    }
    if (salir && !salir.onclick) salir.onclick = async () => { await api('POST', '/api/logout'); location.href = '/login.html'; };
  }

  // preguntar('Título', 'Texto o nodo', [{ valor, texto, clase }]) → valor elegido (null si se cierra)
  function preguntar(titulo, texto, botones) {
    return new Promise((resolver) => {
      const d = el('dialog', { class: 'dlg-pregunta', 'aria-labelledby': 'preg-tit' });
      const fin = (v) => { d.close(); d.remove(); resolver(v); };
      d.append(
        el('h2', { id: 'preg-tit' }, titulo),
        typeof texto === 'string' ? el('p', {}, texto) : texto,
        el('div', { class: 'acciones' }, botones.map((b) => el('button', { type: 'button', class: b.clase || '', onclick: () => fin(b.valor) }, b.texto))));
      d.addEventListener('cancel', (ev) => { ev.preventDefault(); fin(null); });
      document.body.append(d);
      d.showModal();
      d.querySelector('.acciones button')?.focus();
    });
  }

  // Al dar una tarea por terminada con tramos por delante: ¿se quitan? → true / false / null (no seguir)
  async function preguntarTramosSobrantes(nombreTarea, tramos) {
    if (!tramos.length) return false;
    const dur = (h) => `${String(h).replace('.', ',')} h`;
    const dia = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const total = tramos.reduce((s, x) => s + x.duracion_h, 0);
    return preguntar('La tarea queda terminada',
      el('div', {},
        el('p', {}, `«${nombreTarea}» aún tiene ${tramos.length} tramo${tramos.length > 1 ? 's' : ''} planificado${tramos.length > 1 ? 's' : ''} después (${dur(total)}):`),
        el('ul', { class: 'lista-sobrantes' }, tramos.map((x) => el('li', {}, `${dia(x.fecha)} · ${dur(x.duracion_h)}`))),
        el('p', { class: 'ayuda' }, '¿Los quito del tablero? Así quedan libres esas personas, máquinas y puestos. Si después deshaces este cierre, vuelven a ponerse.')),
      [{ valor: true, texto: 'Quitarlos', clase: 'primario' }, { valor: false, texto: 'Dejarlos' }, { valor: null, texto: 'Volver', clase: 'ghost' }]);
  }

  /* ---------- Fotos: se reducen en el navegador antes de subirlas ---------- */
  async function reducir(file, max = 1600, calidad = 0.8) {
    if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) || file.size < 350 * 1024) return file;
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
      const blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', calidad));
      return blob ? new File([blob], (file.name || 'foto').replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : file;
    } catch { return file; }
  }
  // sube un archivo (foto o PDF) → id
  async function subirArchivo(file) {
    const f = await reducir(file);
    const tipo = /^image\/(jpeg|png|webp)$|^application\/pdf$/.test(f.type) ? f.type : null;
    if (!tipo) throw new Error('Solo fotos (JPG, PNG) o PDF');
    if (f.size > 6 * 1024 * 1024) throw new Error('El archivo pasa de 6 MB');
    const r = await fetch('/api/archivos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': tipo, 'X-Nombre': encodeURIComponent(f.name || 'foto') }, body: f });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d.id;
  }
  // miniaturas / enlaces a los archivos de algo
  function adjuntos(lista) {
    if (!lista || !lista.length) return null;
    return el('span', { class: 'adjuntos' }, lista.map((a) => {
      const src = `/api/archivos/${a.id}`;
      if (a.tipo.startsWith('audio/')) return el('audio', { src, controls: '', preload: 'none', title: a.nombre || 'audio' });
      if (a.tipo.startsWith('video/')) return el('video', { src, controls: '', preload: 'metadata', playsinline: '', title: a.nombre || 'vídeo' });
      return el('a', { href: src, target: '_blank', rel: 'noopener', title: a.nombre || 'Ver' },
        a.tipo.startsWith('image/') ? el('img', { src, alt: a.nombre || 'foto', loading: 'lazy' }) : '📄 PDF');
    }));
  }

  /* ---------- Contadores de lo que espera a este usuario (en el menú) ---------- */
  async function refrescarPendientes() {
    if (!usuario || usuario.solo_mi_dia) return;
    let p;
    try { p = await api('GET', '/api/pendientes'); } catch { return; }
    const marcar = (nodo, n, titulo) => {
      if (!nodo) return;
      nodo.querySelector('.menu-num')?.remove();
      if (n) nodo.append(el('span', { class: 'menu-num', title: titulo }, String(n)));
    };
    const poner = (href, n, titulo) => {
      const a = document.querySelector(`nav.menu a[data-menu="${href}"]`) || document.querySelector(`nav.menu a[href="${href}"]`);
      if (!a) return;
      a.dataset.menu = href;
      // con algo pendiente, el enlace lleva directamente a donde está
      a.href = n && href === '/recursos.html' ? '/recursos.html?tipo=calendario' : href;
      marcar(a, n, titulo);
    };
    const nRec = (p.vacaciones || 0) + (p.justificantes || 0);
    const tRec = [p.vacaciones && `${p.vacaciones} petición(es) de vacaciones por aprobar`, p.justificantes && `${p.justificantes} justificante(s) por revisar`].filter(Boolean).join('\n');
    poner('/recursos.html', nRec, tRec ? `${tRec}\n(en Vacaciones y festivos)` : '');
    // y dentro de Recursos, en la pestaña donde está
    marcar(document.getElementById('tab-calendario'), nRec, tRec);
    poner('/bandeja.html', p.bandeja || 0, `${p.bandeja} captura(s) por clasificar`);
    // los asuntos que me han asignado (aunque no planifique): en «＋ Capturar» › Mis asuntos
    poner('/capturar.html', p.mis_asuntos || 0, `${p.mis_asuntos} asunto(s) a tu cargo`);
    const nLog = (p.mat_revisar || 0) + (p.mat_recibir || 0) + (p.mat_comprar || 0);
    poner('/logistica.html', nLog, [p.mat_revisar && `${p.mat_revisar} material(es) por revisar en stock`,
      p.mat_comprar && `${p.mat_comprar} por pedir`, p.mat_recibir && `${p.mat_recibir} pedido(s) por recibir`].filter(Boolean).join('\n'));
  }

  /* ---------- Avance y rendimiento (mismo aspecto en todas las pantallas) ---------- */
  const n1 = (x) => (Math.round((x || 0) * 10) / 10).toLocaleString('es-ES');
  function tituloAvance(a) {
    if (!a) return '';
    const l = [`Avance: ${n1(a.hecho_h)} h de ${n1(a.prev_h)} h previstas ya terminadas (${a.hechas} de ${a.tareas} tareas)`];
    if (a.rendimiento_pct != null) {
      l.push(`Rendimiento: lo terminado se previó en ${n1(a.rend_prev_h)} h y costó ${n1(a.rend_real_h)} h`
        + (a.rendimiento_pct >= 100 ? ' (mejor de lo previsto)' : ' (peor de lo previsto)'));
    } else if (a.hechas) l.push('Rendimiento: aún sin horas reales apuntadas en el parte');
    if (a.curso_h) l.push(`En curso: ${n1(a.curso_h)} h previstas sin terminar, ${n1(a.curso_real_h)} h gastadas ya`
      + (a.curso_real_h > a.curso_h ? ' ⚠ ya se ha pasado' : ''));
    return l.join('\n');
  }
  const claseRend = (p) => (p == null ? '' : p >= 100 ? ' bien' : p < 90 ? ' mal' : '');
  // avance → <span class="av"> 31 % · ⚡107 % </span>   (compacto: sin texto «avance»)
  function chipAvance(a, { compacto = false } = {}) {
    if (!a || !a.tareas) return null;
    if (compacto && !a.hecho_h && !a.curso_real_h) return null;
    const pct = a.avance_pct ?? 0;
    return el('span', { class: `av${compacto ? ' compacto' : ''}`, title: tituloAvance(a) },
      el('span', { class: 'av-barra', 'aria-hidden': 'true' }, el('span', { style: `width:${pct}%` })),
      el('span', { class: 'av-pct' }, `${compacto ? '' : 'avance '}${n1(pct)} %`),
      a.rendimiento_pct != null ? el('span', { class: `av-rend${claseRend(a.rendimiento_pct)}` }, `${compacto ? '' : 'rend. '}${a.rendimiento_pct} %`) : null,
      a.curso_real_h > a.curso_h && a.curso_h ? el('span', { class: 'av-aviso', 'aria-label': 'tarea en curso pasada de horas' }, '⚠') : null);
  }

  /* ---------- Cambios en vivo de otros usuarios ---------- */
  // Cada pestaña se identifica en sus cambios, para no recargarse por lo que ella misma guarda
  const PESTANA = Math.random().toString(36).slice(2, 12);
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = (url, opc = {}) => {
    const metodo = (opc.method || 'GET').toUpperCase();
    if (metodo !== 'GET' && metodo !== 'HEAD') opc = { ...opc, headers: { ...(opc.headers || {}), 'X-S360-Pestana': PESTANA } };
    return fetchOriginal(url, opc);
  };

  // ¿El usuario está escribiendo o con un diálogo abierto? Entonces se espera para no pisarle nada
  const ocupado = () => {
    const a = document.activeElement;
    if (document.querySelector('dialog[open]')) return true;
    if (!a) return false;
    if (a.tagName === 'TEXTAREA' || a.isContentEditable) return true;
    if (a.tagName === 'SELECT') return true;
    return a.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(a.type);
  };

  // alCambiar(fn, { esperar }) → fn() cada vez que otro usuario guarda algo.
  // esperar(): devuelve true mientras no conviene recargar (p. ej. arrastrando)
  function alCambiar(fn, { esperar } = {}) {
    if (!window.EventSource) return;
    let pendiente = null, timer = null, enMarcha = false, quien = null;
    const intentar = async () => {
      timer = null;
      if (!pendiente) return;
      if (document.hidden || enMarcha || ocupado() || (esperar && esperar())) { timer = setTimeout(intentar, 1500); return; }
      const datos = pendiente; pendiente = null; enMarcha = true;
      try { await fn(datos); refrescarPendientes(); } catch (e) { console.warn('recarga en vivo', e); } finally { enMarcha = false; }
      if (pendiente && !timer) timer = setTimeout(intentar, 300);
    };
    const programar = (d) => { pendiente = d; if (!timer) timer = setTimeout(intentar, 300); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && pendiente && !timer) intentar(); });

    let visto = null;
    const es = new EventSource('/api/eventos');
    es.addEventListener('hola', (ev) => {
      // al reconectar (se cayó la conexión, el servidor se reinició…) se recarga por si nos perdimos algo
      const { v } = JSON.parse(ev.data);
      if (visto !== null && v !== visto) programar({ reconexion: true });
      visto = v;
    });
    es.addEventListener('cambio', (ev) => {
      const d = JSON.parse(ev.data);
      visto = d.v;
      if (d.pestana === PESTANA) return;
      quien = d.quien;
      programar(d);
    });
    window.addEventListener('pagehide', () => es.close());
    return { get ultimo() { return quien; } };
  }

  window.s360 = { iniciar, tiene, api, preguntar, preguntarTramosSobrantes, alCambiar, chipAvance, tituloAvance, claseRend,
    subirArchivo, adjuntos, refrescarPendientes, usuario: () => usuario };
})();
