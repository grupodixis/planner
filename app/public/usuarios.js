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
    const NOMBRES = { planificar: 'Planificar', proyectos: 'Proyectos', recursos: 'Recursos', usuarios: 'Usuarios' };
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
  }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { return; }
    window.s360.iniciar(yo);
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
