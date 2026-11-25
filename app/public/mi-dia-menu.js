/* App del operario: menú del botón central (todas las opciones), Mi perfil y Mis capacidades */
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
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  let faltanPerfil = [];
  const cuentaTxt = (n, txt) => (n ? `${n} ${txt}` : 'Nada pendiente');
  let ctx = { comun: false, misPantallas: null };

  /* ---------- menú ---------- */
  function opciones() {
    const ir = (vista) => () => { cerrar(); window.midiaMas.mostrar(vista); };
    const of = ctx.oficina; // sin ficha de operario: solo lo que hace en el móvil (supervisar, autorizar, recibir…)
    return [
      of ? ['🏠', 'Inicio', ir('dia')] : ['📋', 'Mi día', ir('dia')],
      of ? null : ['📅', 'Mi mes', ir('mes')],
      ['＋', 'Capturar', ir('capturar')],
      of ? null : ['🌴', 'Vacaciones', ir('vac')],
      of ? null : ['🙋', 'Avisar', ir('avisar'), 'No vengo, llego tarde, justificantes'],
      ctx.compras && ['🛒', 'Compra local', ir('compras'),
        [window.midiaCompras?.porAutorizarN() ? `${window.midiaCompras.porAutorizarN()} por autorizar` : null, window.midiaCompras?.pendientes() ? `${window.midiaCompras.pendientes()} autorizada(s): sube el ticket` : null].filter(Boolean).join(' · ') || 'Ferretería… con autorización',
        !!(window.midiaCompras?.pendientes() || window.midiaCompras?.porAutorizarN())],
      of ? null : ['👤', 'Mi perfil', ir('perfil'), faltanPerfil.length ? `Faltan ${faltanPerfil.length} dato(s)` : 'Tus datos', !!faltanPerfil.length],
      of ? null : ['🧠', 'Mis capacidades', ir('caps'), 'Lo que sabes hacer'],
      // logística: confirmar desde el móvil (pedir a proveedores se hace en el ordenador)
      ctx.logistica ? ['📦', 'Revisar stock', () => { cerrar(); window.midiaStock.ver('revisar'); }, cuentaTxt(ctx.cuentas?.revisar, 'por revisar'), !!ctx.cuentas?.revisar] : null,
      ctx.logistica ? ['🚚', 'Recibir material', () => { cerrar(); window.midiaStock.ver('recibir'); }, cuentaTxt(ctx.cuentas?.recibir, 'por llegar'), !!ctx.cuentas?.recibir] : null,
      ctx.ia && window.s360chat ? ['✨', 'Asistente', () => { cerrar(); window.s360chat.abrir(true); }, 'Pregunta: OTs, quién está libre, pedidos…'] : null,
      ...(window.midiaSuper?.opcionesMenu(ir) || []).reduce((a, o, i, t) => [...a, ...(i ? [] : [['§', 'Supervisar']]), o, ...(i === t.length - 1 ? [['§', '']] : [])], []),
      ctx.comun ? null : ['🔔', 'Avisos al móvil', () => { cerrar(); window.s360pwa?.ajustes(); }],
      ['❓', 'Ayuda', () => { cerrar(); window.s360ayuda?.abrirPanel(); }, 'Cómo se usa'],
      ['🚪', 'Salir', () => { cerrar(); $('#salir').click(); }],
    ].filter(Boolean);
  }
  function abrir() {
    const vista = window.midiaMas.vista();
    const mapa = { 'Mi día': 'dia', Inicio: 'dia', 'Mi mes': 'mes', Capturar: 'capturar', Vacaciones: 'vac', Avisar: 'avisar', 'Mi perfil': 'perfil', 'Mis capacidades': 'caps', 'Compra local': 'compras', 'Recibir envíos': 'recibir', 'Parte de hoy': 'parte', Aprobar: 'aprobar', 'Dónde está cada cosa': 'donde' };
    if (ctx.logistica) ctx.cuentas = window.midiaStock?.cuentasYa() || null;
    $('#md-menu-grid').replaceChildren(...opciones().map(([ico, txt, fn, sub, aviso]) => (ico === '§' ? el('h3', { class: 'md-menu-sec', 'aria-hidden': txt ? null : 'true' }, txt) : el('button', {
      type: 'button', class: `md-menu-op${mapa[txt] === vista ? ' actual' : ''}${aviso ? ' aviso' : ''}`, onclick: fn,
    }, el('span', { class: 'md-menu-ico', 'aria-hidden': 'true' }, ico), el('b', {}, txt), sub ? el('small', {}, sub) : null))));
    const d = $('#md-menu');
    if (!d.open) d.showModal();
  }
  function cerrar() { const d = $('#md-menu'); if (d.open) d.close(); }
  // Inicio de quien no tiene ficha de operario: las mismas opciones del menú, en grande
  function pintarInicio(caja, nombre) {
    if (ctx.logistica) ctx.cuentas = window.midiaStock?.cuentasYa() || null;
    const ops = opciones().filter(([, txt]) => !['Inicio', 'Salir', 'Ayuda', 'Avisos al móvil'].includes(txt));
    caja.replaceChildren(
      el('p', { class: 'md-resumen' }, `Hola, ${String(nombre || '').split(' ')[0]}. Desde el móvil: recibir, confirmar y aprobar; lo demás, en el ordenador.`),
      el('div', { class: 'md-menu-grid md-inicio-grid' }, ops.map(([ico, txt, fn, sub, aviso]) => (ico === '§'
        ? (txt ? el('h3', { class: 'md-menu-sec' }, txt) : null)
        : el('button', { type: 'button', class: `md-menu-op${aviso ? ' aviso' : ''}`, onclick: fn },
          el('span', { class: 'md-menu-ico', 'aria-hidden': 'true' }, ico), el('b', {}, txt), sub ? el('small', {}, sub) : null)))));
  }

  /* ---------- Mi perfil ---------- */
  async function cargarPerfil() {
    const p = await api('GET', '/api/mi-dia/perfil');
    faltanPerfil = p.faltan;
    marcarPunto();
    const f = el('form', { class: 'md-form md-perfil', onsubmit: async (ev) => {
      ev.preventDefault();
      const datos = Object.fromEntries(new FormData(f));
      try { await api('PUT', '/api/mi-dia/perfil', datos); toast('Datos guardados'); await cargarPerfil(); } catch (e) { toast(e.message, true); }
    } },
    p.campos.map((c) => el('label', { class: `md-campo${c.importante && !String(p.datos[c.k] || '').trim() ? ' falta' : ''}` },
      el('span', {}, c.e, c.importante ? el('i', { class: 'md-oblig', title: 'Importante' }, ' *') : null),
      el('input', { name: c.k, type: c.tipo || 'text', value: p.datos[c.k] || '', maxlength: c.max || 120,
        autocomplete: { telefono: 'tel', email: 'email', direccion: 'street-address', cp: 'postal-code', localidad: 'address-level2', nacimiento: 'bday' }[c.k] || 'off',
        inputmode: c.tipo === 'tel' ? 'tel' : c.k === 'cp' ? 'numeric' : null }))),
    el('button', { type: 'submit', class: 'primario md-grande' }, 'Guardar'));
    $('#v-perfil').replaceChildren(
      el('section', { class: 'md-bloque' },
        el('h2', {}, p.nombre),
        p.faltan.length ? el('p', { class: 'md-aviso' }, `Te faltan: ${p.faltan.join(', ')}. Rellénalo cuando puedas.`)
          : el('p', { class: 'ayuda' }, 'Tus datos están completos. Si algo cambia, actualízalo aquí.'),
        el('p', { class: 'ayuda' }, 'Solo los ve la empresa (RRHH y encargados). Los que llevan * son los importantes.'),
        f),
      el('section', { class: 'md-bloque' },
        el('h2', {}, 'Mi PIN'),
        el('p', { class: 'ayuda' }, 'El número de 4 cifras con el que entras.'),
        el('button', { type: 'button', class: 'ghost md-grande', onclick: () => window.midiaMas.cambiarPin() }, '🔑 Cambiar mi PIN')));
  }

  /* ---------- Mis capacidades ---------- */
  let filtro = '';
  let caps = [];
  async function cargarCaps() {
    caps = await api('GET', '/api/mi-dia/capacidades');
    pintarCaps();
  }
  function pintarCaps() {
    const q = norm(filtro);
    const fams = new Map();
    for (const k of caps) {
      if (q && !norm(`${k.nombre} ${k.familia}`).includes(q)) continue;
      if (!fams.has(k.familia)) fams.set(k.familia, []);
      fams.get(k.familia).push(k);
    }
    const nVal = caps.filter((k) => k.estado === 'validada').length;
    const nProp = caps.filter((k) => k.estado === 'propuesta').length;
    const buscar = el('input', { type: 'search', class: 'md-caps-buscar', placeholder: '🔎 Buscar (soldar, carretilla, plegadora…)', value: filtro, 'aria-label': 'Buscar capacidad' });
    buscar.addEventListener('input', () => { filtro = buscar.value; pintarCaps(); const b = $('.md-caps-buscar'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); });
    $('#v-caps').replaceChildren(
      el('section', { class: 'md-bloque' },
        el('p', { class: 'ayuda' }, 'Marca lo que sabes hacer. Tu encargado lo revisa y lo valida; hasta entonces sale como «pendiente».'),
        el('p', { class: 'md-caps-res' }, el('span', { class: 'md-ll-est ok' }, `✔ ${nVal} validada${nVal === 1 ? '' : 's'}`), ' ',
          nProp ? el('span', { class: 'md-ll-est pedido' }, `⏳ ${nProp} pendiente${nProp === 1 ? '' : 's'}`) : null),
        buscar,
        ...[...fams].map(([fam, ks]) => el('div', { class: 'md-caps-fam' },
          el('h3', {}, fam),
          el('ul', { class: 'md-ll-lista' }, ks.map((k) => {
            const caja = el('input', { type: 'checkbox', checked: !!k.estado, disabled: k.estado === 'validada',
              'aria-label': k.nombre, onchange: (ev) => marcar(k, ev.target.checked, ev.target) });
            return el('li', { class: k.estado ? 'hecho-cap' : '' }, el('label', { class: 'md-ll-check' }, caja, el('span', { class: 'md-ll-desc' }, k.nombre)),
              k.estado === 'validada' ? el('span', { class: 'md-ll-est ok' }, '✔ validada')
                : k.estado === 'propuesta' ? el('span', { class: 'md-ll-est pedido' }, '⏳ pendiente') : null);
          })))),
        !fams.size ? el('p', { class: 'ayuda' }, 'No hay ninguna con ese nombre. Si sabes hacer algo que no está, díselo a tu encargado.') : null));
  }
  async function marcar(k, valor, caja) {
    caja.disabled = true;
    try {
      const r = await api('PUT', `/api/mi-dia/capacidades/${k.id}`, { sabe: valor });
      k.estado = r.estado;
      if (valor) toast('Anotado: tu encargado lo validará');
      pintarCaps();
    } catch (e) { toast(e.message, true); caja.checked = !valor; caja.disabled = false; }
  }

  function marcarPunto() { $('#md-menu-punto').hidden = !faltanPerfil.length; }

  async function iniciar(c) {
    ctx = { ...ctx, ...c };
    $('#md-menu-btn').onclick = abrir;
    const d = $('#md-menu');
    // pulsar fuera de la hoja la cierra
    d.addEventListener('click', (ev) => { if (ev.target === d) cerrar(); });
    if (!ctx.oficina) { try { faltanPerfil = (await api('GET', '/api/mi-dia/perfil')).faltan; } catch { faltanPerfil = []; } }
    marcarPunto();
  }

  window.midiaMenu = { iniciar, abrir, pintarInicio, cargar: (v) => (v === 'perfil' ? cargarPerfil() : cargarCaps()) };
})();
