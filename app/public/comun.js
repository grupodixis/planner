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

  /* ---------- Menú principal agrupado ---------- */
  // [href, texto, permiso(s) o null = todos, descripción]
  const GRUPOS = [
    ['Planificación', [['/', 'Cuadrante', null, 'Planificar tareas en áreas y operarios'],
      ['/gantt.html', 'Gantt', ['planificar', 'proyectos'], 'Plan por semanas: entregas, riesgo y carga'], ['/parte.html', 'Supervisión de partes', 'planificar', 'Revisar y confirmar lo hecho cada día'],
      ['/bandeja.html', 'Bandeja', 'planificar', 'Capturas por clasificar'],
      ['/incidencias.html', 'Incidencias', ['planificar', 'compras', 'logistica', 'proyectos', 'escandallo', 'aprobar_compras'], 'Material, transporte, calidad, averías…: seguimiento y cierre'],
      ['/mi-dia.html', 'Mi día', 'mi_dia', 'Apuntar mi propio día']]],
    ['Proyectos', [['/proyectos.html', 'Proyectos y OTs', null, 'Partidas, OTs, tareas, escandallo e importación'],
      ['/obras.html', 'Obras', null, 'Direcciones con sus proyectos, contacto en obra y lo próximo'],
      ['/clientes.html', 'Clientes', null, 'Datos del cliente y sus personas de contacto']]],
    ['Compras', [['/logistica.html', 'Material de las partidas', ['logistica', 'compras', 'escandallo'], 'Stock, por pedir, pedido y recepción'],
      ['/compras.html', 'Pedidos de compra', ['compras', 'aprobar_compras', 'logistica'], 'Preparar, aprobar y enviar pedidos a proveedores'],
      ['/compras.html?vista=locales', 'Compras locales', ['compras', 'autorizar_compras_locales'], 'Autorizar y cuadrar lo que piden los operarios (ferretería…)'],
      ['/compras.html?vista=proveedores', 'Proveedores', ['compras', 'logistica', 'escandallo', 'aprobar_compras'], 'Fichas, contactos y lo que sirve cada uno']]],
    ['Recursos', [['/recursos.html', 'Operarios, máquinas y subcontratas', null, 'Fichas, vacaciones y festivos, tipos'],
      ['/recursos.html?tipo=areas', 'Áreas de trabajo', null, 'Zonas del taller, puestos, cabina y su equipo fijo'],
      ['/capacidades.html', 'Capacidades', ['recursos', 'planificar'], 'Lo que sabe hacer cada uno'], ['/usuarios.html', 'Usuarios y accesos', 'usuarios', 'Cuentas, roles y PIN'],
      ['/ia.html', 'IA', ['ia', 'usuarios'], 'Herramientas de la IA, conexión de Claude Code y registro']]],
    ['Informes', [['/informes.html', 'Informes', 'informes', 'Horas, avance y planificación por periodo'],
      ['/costes.html', 'Control de costes', 'costes', 'Presupuesto, real, previsión y margen por proyecto']]],
  ];
  // pantalla actual (un enlace con «?tipo=…» solo cuenta en esa pestaña)
  const aqui = (href) => {
    const [p, qs] = href.split('?');
    if (!(p === '/' ? ['/', '/index.html'].includes(location.pathname) : location.pathname === p)) return false;
    const aqu = new URLSearchParams(location.search); const q = new URLSearchParams(qs || '');
    const tipo = aqu.get('tipo');
    if (q.get('vista') || aqu.get('vista')) return (q.get('vista') || '') === (aqu.get('vista') || '') || (!q.get('vista') && !['locales', 'proveedores'].includes(aqu.get('vista')));
    return qs ? q.get('tipo') === tipo : tipo !== 'areas';
  };
  function pintarMenu(menu) {
    const puede = (p) => !p || [].concat(p).some((k) => tiene(k));
    const cerrarTodo = (salvo) => menu.querySelectorAll('.menu-grupo.abierto').forEach((g) => { if (g !== salvo) g.classList.remove('abierto'); });
    const nodos = [];
    for (const [titulo, items] of GRUPOS) {
      const vis = items.filter(([, , p]) => puede(p));
      if (!vis.length) continue;
      if (vis.length === 1) {
        const [href, txt] = vis[0];
        const a = el('a', { href, 'data-menu': href }, txt);
        if (aqui(href)) a.setAttribute('aria-current', 'page');
        nodos.push(a);
        continue;
      }
      const actual = vis.some(([href]) => aqui(href));
      const g = el('div', { class: 'menu-grupo' });
      const b = el('button', { type: 'button', class: 'menu-g-btn', 'aria-haspopup': 'true', 'aria-expanded': 'false', ...(actual ? { 'aria-current': 'page' } : {}) },
        el('span', { class: 'menu-g-txt' }, titulo), el('span', { class: 'menu-g-num' }), el('span', { class: 'menu-caret', 'aria-hidden': 'true' }, '▾'));
      b.onclick = (ev) => { ev.stopPropagation(); const abrir = !g.classList.contains('abierto'); cerrarTodo(g); g.classList.toggle('abierto', abrir); b.setAttribute('aria-expanded', String(abrir)); };
      const panel = el('div', { class: 'menu-panel', role: 'menu' }, vis.map(([href, txt, , desc]) => el('a', {
        href, role: 'menuitem', 'data-menu': href, ...(aqui(href) ? { 'aria-current': 'page' } : {}),
      }, el('b', {}, txt), desc ? el('small', {}, desc) : null)));
      g.append(b, panel);
      nodos.push(g);
    }
    menu.replaceChildren(...nodos);
    // «＋ Capturar»: siempre a mano, como botón, junto al usuario
    const usuarioDiv = document.querySelector('header .usuario');
    if (usuarioDiv && !usuarioDiv.querySelector('.btn-capturar')) {
      const cap = el('a', { href: '/capturar.html', class: 'boton btn-capturar', 'data-menu': '/capturar.html', title: 'Apuntar algo rápido: incidencia, idea, encargo…' }, '＋ Capturar');
      if (aqui('/capturar.html')) cap.setAttribute('aria-current', 'page');
      usuarioDiv.prepend(cap);
    }
    // En el móvil la cabecera se queda en una línea: logo, ＋ Capturar y ☰ (abre el menú y el usuario como lista)
    const cab = menu.closest('header.top');
    if (cab && !cab.querySelector('.menu-movil-btn')) {
      const bm = el('button', { type: 'button', class: 'menu-movil-btn', 'aria-expanded': 'false', 'aria-label': 'Menú' },
        el('span', { 'aria-hidden': 'true' }, '☰'), el('span', { class: 'menu-movil-num' }));
      bm.onclick = (ev) => { ev.stopPropagation(); const a2 = !cab.classList.contains('menu-abierto'); cab.classList.toggle('menu-abierto', a2); bm.setAttribute('aria-expanded', String(a2)); };
      const capM = el('a', { href: '/capturar.html', class: 'boton btn-capturar capturar-movil', title: 'Apuntar algo rápido' }, '＋');
      cab.querySelector('h1')?.after(capM, bm);
    }
    if (!pintarMenu.listo) {
      pintarMenu.listo = true;
      document.addEventListener('click', (ev) => { if (!ev.target.closest('.menu-grupo')) cerrarTodo(); });
      document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') cerrarTodo(); });
    }
  }

  // ¿Es un teléfono? (pantalla estrecha y táctil; una tablet apaisada o el ordenador ven la versión completa)
  function esTelefono() { return matchMedia('(max-width: 760px) and (pointer: coarse)').matches; }
  // A dónde va en la app móvil un enlace de oficina (los de los avisos)
  function versionMovil() {
    const q = new URLSearchParams(location.search); const pth = location.pathname;
    const vista = pth === '/capturar.html' ? 'capturar' : pth === '/parte.html' ? 'parte'
      : pth === '/compras.html' && q.get('vista') === 'locales' ? 'compras'
        : pth === '/compras.html' && q.get('vista') === 'transportes' ? 'recibir'
          : pth === '/compras.html' && q.get('pedido') ? 'aprobar' : pth === '/recursos.html' && /calendario|extras/.test(q.get('tipo') || '') ? 'aprobar' : null;
    return `/mi-dia.html${vista ? `?vista=${vista}` : ''}`;
  }

  // Lo llama cada pantalla al cargar el usuario (/api/me)
  function iniciar(u) {
    usuario = u;
    // ventana de detalle dentro de otra pantalla (Gantt): sin menú, ayuda ni redirecciones
    if (document.body.classList.contains('solo-detalle')) return;
    // los operarios (solo «Mi día») no tienen nada que hacer en el resto de pantallas
    if (u.solo_mi_dia && location.pathname !== '/mi-dia.html') { location.replace('/mi-dia.html'); return; }
    // En el teléfono solo va la app móvil (Mi día con su menú: supervisar, autorizar, recibir, capturar…); el resto, en el ordenador
    if (esTelefono() && location.pathname !== '/mi-dia.html') { location.replace(versionMovil()); return; }
    pintarNombre();
    const menu = document.querySelector('nav.menu');
    if (menu) pintarMenu(menu);
    refrescarPendientes();
    const salir = document.getElementById('salir');
    if (salir && window.s360pwa && !document.getElementById('btn-avisos')) {
      const b = el('button', { type: 'button', class: 'ghost', id: 'btn-avisos', title: 'Avisos al móvil', 'aria-label': 'Avisos', onclick: () => window.s360pwa.ajustes() }, '🔔');
      salir.before(b, ' ');
      window.s360pwa.renovar();
    }
    if (salir && !salir.onclick) salir.onclick = async () => { await api('POST', '/api/logout'); location.href = '/login.html'; };
    // Asistente ✨ (permiso «ia»): se carga aparte, solo en las pantallas de oficina con cabecera
    if (salir && (tiene('ia') || tiene('usuarios')) && !document.querySelector('script[data-ia-chat]')) {
      const v = (document.querySelector('script[src*="comun.js"]')?.src.match(/\?v=\d+/) || [''])[0];
      document.body.append(el('script', { src: `/ia-chat.js${v}`, 'data-ia-chat': '' }));
    }
    // ayuda («?», recorridos y novedades): en las pantallas que cargan ayuda.js
    window.s360ayuda?.iniciar().catch(() => {});
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
        el('p', { class: 'ayuda' }, '¿Los quito del cuadrante? Así quedan libres esas personas, máquinas y puestos. Si después deshaces este cierre, vuelven a ponerse.')),
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
      const a = document.querySelector(`a[data-menu="${href}"]`);
      if (!a) return;
      a.dataset.n = n || 0;
      // con algo pendiente, el enlace lleva directamente a donde está
      a.href = n && href === '/recursos.html' ? (p.horas_extra && !(p.vacaciones || p.justificantes) ? '/recursos.html?tipo=extras' : '/recursos.html?tipo=calendario') : href;
      marcar(a, n, titulo);
    };
    const nRec = (p.vacaciones || 0) + (p.justificantes || 0);
    const tRec = [p.vacaciones && `${p.vacaciones} petición(es) de vacaciones por aprobar`, p.justificantes && `${p.justificantes} justificante(s) por revisar`].filter(Boolean).join('\n');
    const tExt = p.horas_extra ? `${p.horas_extra} petición(es) de horas extra por autorizar` : '';
    poner('/recursos.html', nRec + (p.horas_extra || 0), [tRec && `${tRec}\n(en Vacaciones y festivos)`, tExt && `${tExt}\n(en Turnos y horas extra)`].filter(Boolean).join('\n'));
    // y dentro de Recursos, en la pestaña donde está
    marcar(document.getElementById('tab-calendario'), nRec, tRec);
    marcar(document.getElementById('tab-extras'), p.horas_extra || 0, tExt);
    poner('/bandeja.html', p.bandeja || 0, `${p.bandeja} captura(s) por clasificar`);
    poner('/incidencias.html', p.incidencias || 0, `${p.incidencias} incidencia(s) tuyas por gestionar o cerrar`);
    poner('/compras.html?vista=locales', p.cl_autorizar || 0, `${p.cl_autorizar} compra(s) local(es) por autorizar`);
    // los asuntos que me han asignado (aunque no planifique): en «＋ Capturar» › Mis asuntos
    poner('/capturar.html', p.mis_asuntos || 0, `${p.mis_asuntos} asunto(s) a tu cargo`);
    poner('/capacidades.html', p.cap_validar || 0, `${p.cap_validar} capacidad(es) que dicen saber los operarios, por validar`);
    const nLog = (p.mat_revisar || 0) + (p.mat_recibir || 0) + (p.mat_comprar || 0);
    poner('/logistica.html', nLog, [p.mat_revisar && `${p.mat_revisar} material(es) por revisar en stock`,
      p.mat_comprar && `${p.mat_comprar} por pedir`, p.mat_recibir && `${p.mat_recibir} pedido(s) por recibir`].filter(Boolean).join('\n'));
    // en el ☰ del móvil, el total
    const tot = [...document.querySelectorAll('header a[data-menu]')].reduce((t, a) => t + Number(a.dataset.n || 0), 0);
    document.querySelector('.menu-movil-num')?.replaceChildren(...(tot ? [el('span', { class: 'menu-num' }, String(tot))] : []));
    // en cada grupo del menú, la suma de lo pendiente de sus pantallas
    document.querySelectorAll('nav.menu .menu-grupo').forEach((g) => {
      const n = [...g.querySelectorAll('a[data-menu]')].reduce((t, a) => t + Number(a.dataset.n || 0), 0);
      const sp = g.querySelector('.menu-g-num');
      sp.replaceChildren(...(n ? [el('span', { class: 'menu-num' }, String(n))] : []));
    });
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

  window.s360 = { iniciar, tiene, api, aviso, preguntar, preguntarTramosSobrantes, alCambiar, chipAvance, tituloAvance, claseRend,
    subirArchivo, adjuntos, refrescarPendientes, usuario: () => usuario };
})();
