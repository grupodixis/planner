/* s360_planificacion · pantalla Usuarios: altas, roles, enlaces de acceso */
(() => {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v ?? '';
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const api = (...a) => window.s360.api(...a);

  function toast(msg, error = false) {
    const t = $('#toast');
    t.textContent = msg;
    t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 2600);
  }

  const estado = { datos: null };
  const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const hace = (iso) => {
    if (!iso) return 'nunca';
    const min = Math.round((Date.now() - new Date(iso)) / 60000);
    if (min < 2) return 'ahora';
    if (min < 60) return `hace ${min} min`;
    if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`;
    return fechaHora(iso);
  };

  async function guardar(metodo, url, cuerpo, ok) {
    try {
      const r = await api(metodo, url, cuerpo);
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast(e.message, true);
      await cargar();
      return null;
    }
  }

  /* ---------- enlace de activación / recuperación ---------- */
  function mostrarEnlace(u, enl) {
    const activar = u.sin_activar || enl.tipo === 'activar';
    const dlg = $('#dlg-enlace');
    $('#dlg-enlace-tit').textContent = activar ? 'Enlace de activación' : 'Enlace para cambiar la contraseña';
    $('#enl-texto').textContent = enl.enviado
      ? `Se ha enviado por correo a ${u.email}. También puedes pasárselo tú:`
      : `Pásale este enlace a ${u.nombre} (${u.email}) por correo o mensaje. Con él elige su contraseña y entra.`;
    $('#enl-url').value = enl.url;
    const dias = enl.caduca_h >= 48 ? `${enl.caduca_h / 24} días` : `${enl.caduca_h} horas`;
    $('#enl-ayuda').textContent = `Sirve una sola vez y caduca en ${dias}. Si generas otro, este deja de valer.`;
    const asunto = activar ? 'Tu cuenta en el planificador s360' : 'Cambiar tu contraseña del planificador s360';
    const cuerpo = `Hola ${u.nombre}:\n\n${activar ? 'Te he dado de alta en el planificador s360.' : 'Aquí tienes el enlace para elegir una contraseña nueva.'} Ábrelo para elegir tu contraseña:\n\n${enl.url}\n\nSirve una sola vez y caduca en ${dias}.\n`;
    $('#enl-mail').href = `mailto:${encodeURIComponent(u.email)}?subject=${encodeURIComponent(asunto)}&body=${encodeURIComponent(cuerpo)}`;
    $('#enl-mail').textContent = 'Abrir en mi correo';
    $('#enl-mail').removeAttribute('target');
    if (!dlg.open) dlg.showModal();
    $('#enl-url').select();
  }

  async function generarEnlace(u) {
    const enl = await guardar('POST', `/api/usuarios/${u.id}/enlace`);
    if (!enl) return;
    mostrarEnlace(u, enl);
    await cargar();
  }

  /* ---------- usuarios ---------- */
  function opcionesRol(sel) {
    return estado.datos.roles.map((r) => el('option', { value: r.clave, selected: r.clave === sel }, r.nombre));
  }
  function opcionesPersona(sel) {
    return [el('option', { value: '' }, '— ninguno —'),
      ...estado.datos.personas.map((p) => el('option', { value: p.id, selected: p.id === sel }, p.nombre))];
  }

  function textoEstado(u) {
    if (!u.activo) return el('span', { class: 'est est-off' }, 'Desactivado');
    if (u.sin_activar) {
      const e = u.enlace;
      return el('span', { class: 'est est-pend' }, e && !e.caducado ? 'Sin activar · enlace vigente' : 'Sin activar · enlace caducado');
    }
    return el('span', { class: 'est est-ok', title: u.ultimo_acceso ? `Última entrada: ${fechaHora(u.ultimo_acceso)}` : '' },
      `Activo · ${hace(u.ultimo_acceso)}`);
  }

  function filaUsuario(u) {
    const yo = u.id === estado.datos.yo;
    const campo = (k, attrs) => el('input', {
      ...attrs, value: u[k],
      onchange: async (ev) => { if (await guardar('PATCH', `/api/usuarios/${u.id}`, { [k]: ev.target.value }, 'Guardado')) cargar(); },
    });
    const sesiones = u.sesiones && !yo
      ? el('button', {
        type: 'button', class: 'ghost', title: 'Cierra la sesión en todos sus navegadores',
        onclick: async () => { if (await guardar('POST', `/api/usuarios/${u.id}/cerrar-sesiones`, null, 'Sesiones cerradas')) cargar(); },
      }, `Cerrar sesiones (${u.sesiones})`) : null;
    return el('tr', { class: u.activo ? '' : 'inactiva' },
      el('td', {}, campo('nombre', { maxlength: 80, 'aria-label': 'Nombre' }), yo ? el('span', { class: 'tu' }, 'tú') : null),
      el('td', {}, campo('email', { type: 'email', maxlength: 120, 'aria-label': 'Email' })),
      el('td', {}, el('select', {
        'aria-label': 'Rol',
        onchange: async (ev) => { if (await guardar('PATCH', `/api/usuarios/${u.id}`, { rol: ev.target.value }, 'Rol cambiado')) cargar(); },
      }, opcionesRol(u.rol))),
      el('td', {}, el('select', {
        'aria-label': 'Es el operario',
        onchange: (ev) => guardar('PATCH', `/api/usuarios/${u.id}`, { recurso_id: ev.target.value || null }, 'Guardado'),
      }, opcionesPersona(u.recurso_id))),
      el('td', {}, textoEstado(u)),
      el('td', { class: 'acc' },
        u.activo ? el('button', {
          type: 'button', class: 'ghost',
          title: u.sin_activar ? 'Genera un enlace nuevo para que active su cuenta' : 'Genera un enlace para que elija una contraseña nueva',
          onclick: () => generarEnlace(u),
        }, u.sin_activar ? 'Enlace de activación' : 'Cambiar contraseña…') : null,
        sesiones,
        yo ? null : el('button', {
          type: 'button', class: 'ghost',
          onclick: async () => { if (await guardar('PATCH', `/api/usuarios/${u.id}`, { activo: !u.activo }, u.activo ? 'Desactivado' : 'Reactivado')) cargar(); },
        }, u.activo ? 'Desactivar' : 'Reactivar'),
        yo ? null : el('button', {
          type: 'button', class: 'ghost borrar', 'aria-label': `Borrar a ${u.nombre}`,
          title: 'Si ya ha trabajado en el sistema no se borra: se desactiva y se conserva su historial',
          onclick: async () => {
            if (!confirm(`¿Borrar a ${u.nombre}? Si ya ha trabajado en el sistema solo se desactivará.`)) return;
            const r = await guardar('DELETE', `/api/usuarios/${u.id}`);
            if (r) { toast(r.borrado ? 'Usuario borrado' : 'Tenía historial: se ha desactivado'); cargar(); }
          },
        }, '✕')));
  }

  function pintarPeticiones() {
    const pend = estado.datos.usuarios.filter((u) => u.activo && u.enlace?.pedido && !u.enlace.enviado && !u.enlace.caducado);
    $('#peticiones').replaceChildren(...pend.map((u) => el('div', { class: 'peticion', role: 'status' },
      el('span', {}, el('strong', {}, u.nombre), ` pidió cambiar su contraseña (${hace(u.enlace.creado)}). Genera el enlace y pásaselo.`),
      el('button', { type: 'button', class: 'primario', onclick: () => generarEnlace(u) }, 'Generar enlace'))));
  }

  function pintarUsuarios() {
    const verInactivos = $('#ver-inactivos').checked;
    const lista = estado.datos.usuarios.filter((u) => u.activo || verInactivos);
    $('#lista-usuarios').replaceChildren(...lista.map(filaUsuario));
    pintarPeticiones();
  }

  /* ---------- roles ---------- */
  function pintarRoles() {
    const { roles, permisos } = estado.datos;
    const claves = Object.keys(permisos);
    const NOMBRES = { planificar: 'Planificar', proyectos: 'Proyectos', recursos: 'Recursos', usuarios: 'Usuarios', informes: 'Informes' };
    $('#cab-roles').replaceChildren(el('tr', {},
      el('th', {}, 'Rol'), el('th', {}, 'Descripción'),
      ...claves.map((k) => el('th', { class: 'perm', title: permisos[k] }, NOMBRES[k] || k)),
      el('th', { class: 'num' }, 'Usuarios'), el('th', {})));
    $('#lista-roles').replaceChildren(...roles.map((r) => {
      const fijo = r.sistema;
      const patch = async (cuerpo, ok) => { if (await guardar('PATCH', `/api/roles/${r.clave}`, cuerpo, ok)) cargar(); };
      return el('tr', {},
        el('td', {}, el('input', { value: r.nombre, maxlength: 40, 'aria-label': 'Nombre del rol', onchange: (ev) => patch({ nombre: ev.target.value }, 'Guardado') })),
        el('td', {}, el('input', { value: r.descripcion || '', maxlength: 200, 'aria-label': 'Descripción', onchange: (ev) => patch({ descripcion: ev.target.value }, 'Guardado') })),
        ...claves.map((k) => el('td', { class: 'perm' }, el('input', {
          type: 'checkbox', checked: r.permisos.includes(k), disabled: fijo,
          'aria-label': `${r.nombre}: ${permisos[k]}`, title: permisos[k],
          onchange: (ev) => {
            const nuevos = ev.target.checked ? [...r.permisos, k] : r.permisos.filter((p) => p !== k);
            patch({ permisos: nuevos }, 'Permisos guardados');
          },
        }))),
        el('td', { class: 'num' }, String(r.usuarios)),
        el('td', {}, fijo || r.usuarios ? null : el('button', {
          type: 'button', class: 'ghost borrar', 'aria-label': `Borrar el rol ${r.nombre}`,
          onclick: async () => { if (confirm(`¿Borrar el rol «${r.nombre}»?`) && await guardar('DELETE', `/api/roles/${r.clave}`, null, 'Rol borrado')) cargar(); },
        }, '✕')));
    }));
  }

  /* ---------- carga y arranque ---------- */
  /* ---------- operarios con PIN y dispositivos ---------- */
  const FACILES = new Set(['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '9876']);
  function pinAlAzar() {
    for (;;) {
      const n = crypto.getRandomValues(new Uint16Array(1))[0] % 10000;
      const p = String(n).padStart(4, '0');
      if (!FACILES.has(p)) return p;
    }
  }

  function filaPin(o) {
    const conPin = o.tiene_pin && o.activo !== false;
    const input = el('input', { inputmode: 'numeric', maxlength: 4, placeholder: '4 cifras', 'aria-label': `PIN de ${o.nombre}`, class: 'pin-input' });
    const editor = el('span', { class: 'pin-editor', hidden: true },
      input,
      el('button', { type: 'button', class: 'ghost mini', title: 'Otro al azar', 'aria-label': 'Otro PIN al azar', onclick: () => { input.value = pinAlAzar(); } }, '🎲'),
      el('button', { type: 'button', class: 'primario mini', onclick: async () => {
        if (await guardar('PUT', `/api/pin/${o.recurso_id}`, { pin: input.value.trim() }, `PIN de ${o.nombre} guardado: díselo ahora (no se vuelve a mostrar)`)) cargarPin();
      } }, 'Guardar'));
    const abrirEditor = () => { editor.hidden = false; input.value = pinAlAzar(); input.focus(); input.select(); };
    const movil = !conPin ? '—'
      : o.tiene_movil ? `autorizado${o.movil_uso ? ` · usado ${hace(o.movil_uso)}` : ''}`
        : o.alta_pendiente ? 'enlace enviado, sin abrir' : 'no';
    return el('tr', {},
      el('td', {}, o.nombre),
      el('td', {}, conPin ? el('span', { class: 'est-ok' }, '✓ tiene PIN') : el('span', { class: 'suave' }, 'sin acceso'), ' ', editor),
      el('td', { class: 'suave' }, movil),
      el('td', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost mini', onclick: abrirEditor }, conPin ? 'Cambiar PIN' : 'Poner PIN'),
        conPin ? el('button', { type: 'button', class: 'ghost mini', onclick: () => enlaceMovil(o) }, 'Enlace para su móvil') : null,
        conPin ? el('button', { type: 'button', class: 'ghost mini borrar', onclick: async () => {
          if (!confirm(`¿Quitar el acceso con PIN a ${o.nombre}? Su móvil deja de valer. Lo ya apuntado se conserva.`)) return;
          if (await guardar('DELETE', `/api/pin/${o.recurso_id}`, null, 'Acceso quitado')) cargarPin();
        } }, 'Quitar') : null));
  }

  async function enlaceMovil(o) {
    const r = await guardar('POST', `/api/pin/${o.recurso_id}/enlace-movil`);
    if (!r) return;
    const dlg = $('#dlg-enlace');
    $('#dlg-enlace-tit').textContent = `Enlace para el móvil de ${o.nombre}`;
    $('#enl-texto').textContent = 'Que lo abra en SU móvil: queda autorizado para entrar con su PIN. Que lo guarde en la pantalla de inicio para tenerlo a mano.';
    $('#enl-url').value = r.url;
    $('#enl-ayuda').textContent = `Sirve una sola vez y caduca en ${r.caduca_h / 24} días. Si generas otro, este deja de valer.`;
    const texto = `Hola ${o.nombre.split(' ')[0]}: abre este enlace en tu móvil para apuntar tu día en el planificador (luego entras con tu PIN):\n${r.url}`;
    $('#enl-mail').href = `https://wa.me/?text=${encodeURIComponent(texto)}`;
    $('#enl-mail').textContent = 'Enviar por WhatsApp';
    $('#enl-mail').target = '_blank';
    $('#enl-mail').rel = 'noopener';
    if (!dlg.open) dlg.showModal();
    $('#enl-url').select();
    cargarPin();
  }

  async function cargarPin() {
    const d = await api('GET', '/api/pin');
    $('#lista-pin').replaceChildren(...(d.operarios.length ? d.operarios.map(filaPin)
      : [el('tr', {}, el('td', { colspan: 4, class: 'ayuda' }, 'No hay operarios activos en Recursos.'))]));
    $('#lista-disp').replaceChildren(...(d.dispositivos.length ? d.dispositivos.map((x) => el('li', {},
      el('span', {}, el('b', {}, x.nombre), x.id === d.este_dispositivo ? el('span', { class: 'chip-este' }, 'este') : null),
      el('span', { class: 'suave' }, x.tipo === 'comun' ? 'tablet común' : `móvil de ${x.persona}`, ` · usado ${hace(x.ultimo_uso)}`),
      el('button', { type: 'button', class: 'ghost mini borrar', onclick: async () => {
        if (!confirm(`¿Desautorizar «${x.nombre}»? Ya no se podrá entrar con PIN desde ahí.`)) return;
        if (await guardar('DELETE', `/api/pin/dispositivos/${x.id}`, null, 'Dispositivo desautorizado')) cargarPin();
      } }, 'Quitar'))) : [el('li', { class: 'ayuda' }, 'Ninguno todavía.')]));
    $('#form-disp').hidden = !!d.este_dispositivo;
  }

  async function cargar() {
    estado.datos = await api('GET', '/api/usuarios');
    const f = $('#form-usuario');
    const rolSel = f.rol.value || 'consulta';
    f.rol.replaceChildren(...opcionesRol(rolSel));
    f.recurso_id.replaceChildren(...opcionesPersona(Number(f.recurso_id.value) || null));
    $('#ayuda-alta').textContent = estado.datos.correo
      ? 'Al dar de alta se le envía un correo con un enlace para que elija su contraseña.'
      : 'Al dar de alta te damos un enlace para que se lo pases (por correo o mensaje): con él elige su contraseña. Para enviarlo automáticamente, configura el correo (SMTP) en el servidor.';
    pintarUsuarios();
    pintarRoles();
    await cargarPin();
  }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { return; }
    window.s360.iniciar(yo);
    window.s360.alCambiar(() => cargar());
    if (!window.s360.tiene('usuarios')) {
      $('main').replaceChildren(el('section', { class: 'panel' }, el('p', {}, 'Tu usuario no tiene permiso para gestionar usuarios.')));
      return;
    }
    $('#ver-inactivos').onchange = pintarUsuarios;
    document.querySelectorAll('[data-cerrar]').forEach((b) => (b.onclick = () => $('#dlg-enlace').close()));
    $('#enl-copiar').onclick = async () => {
      try { await navigator.clipboard.writeText($('#enl-url').value); toast('Enlace copiado'); }
      catch { $('#enl-url').select(); document.execCommand('copy'); toast('Enlace copiado'); }
    };
    $('#form-usuario').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      const cuerpo = { nombre: f.nombre.value, email: f.email.value, rol: f.rol.value, recurso_id: f.recurso_id.value || null };
      const r = await guardar('POST', '/api/usuarios', cuerpo);
      if (!r) return;
      f.nombre.value = ''; f.email.value = ''; f.recurso_id.value = '';
      await cargar();
      mostrarEnlace({ ...cuerpo, sin_activar: true }, { ...r.enlace, tipo: 'activar' });
    };
    // al elegir el operario, propone su nombre
    $('#form-usuario').recurso_id.onchange = (ev) => {
      const f = ev.target.form;
      const p = estado.datos.personas.find((x) => String(x.id) === ev.target.value);
      if (p && !f.nombre.value) f.nombre.value = p.nombre;
    };
    $('#form-disp').onsubmit = async (ev) => {
      ev.preventDefault();
      const nombre = ev.target.nombre.value.trim() || 'Tablet del taller';
      if (await guardar('POST', '/api/pin/dispositivos', { nombre }, `«${nombre}» autorizado: ya se puede entrar con PIN desde este navegador`)) {
        ev.target.nombre.value = '';
        cargarPin();
      }
    };
    $('#form-rol').onsubmit = async (ev) => {
      ev.preventDefault();
      const nombre = ev.target.nombre.value;
      if (await guardar('POST', '/api/roles', { nombre, permisos: [] }, `Rol «${nombre}» creado: marca sus permisos`)) {
        ev.target.nombre.value = '';
        cargar();
      }
    };
    await cargar();
  }

  init().catch((e) => toast(e.message, true));
})();
