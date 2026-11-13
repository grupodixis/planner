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
    pintarNombre();
    const menu = document.querySelector('nav.menu');
    const enlaces = [['/parte.html', 'Parte', 'planificar'], ['/informes.html', 'Informes', 'informes'], ['/usuarios.html', 'Usuarios', 'usuarios']];
    for (const [href, txt, permiso] of enlaces) {
      if (!menu || !tiene(permiso) || menu.querySelector(`a[href="${href}"]`)) continue;
      const a = el('a', { href }, txt);
      if (location.pathname === href) a.setAttribute('aria-current', 'page');
      menu.append(a);
    }
    const salir = document.getElementById('salir');
    if (salir && !salir.onclick) salir.onclick = async () => { await api('POST', '/api/logout'); location.href = '/login.html'; };
  }

  window.s360 = { iniciar, tiene, api };
})();
