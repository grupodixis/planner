/* Planéalo · IA: estado de la pasarela, herramientas (con «Probar»), claves para MCP y registro de auditoría */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['checked', 'disabled', 'hidden'].includes(k)) n[k] = !!v;
      else if (k === 'value') n.value = v ?? '';
      else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const api = (...a) => window.s360.api(...a);
  const toast = (m, e) => window.s360.aviso ? window.s360.aviso(m, e) : alert(m);
  const RIESGO = { leer: ['Leer', 'lee'], borrador: ['Borrador', 'bor'], confirmar: ['Confirmar', 'con'], nunca: ['Nunca', 'nun'] };
  const CANAL = { app: '💬 App', mcp: '🧩 MCP', prueba: '🧪 Prueba' };
  const est = { d: null, filtro: {} };
  const cuando = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

  function pintarEstado() {
    const { ajustes: aj, puede_admin: adm } = est.d;
    const guardar = async (cuerpo) => { try { est.d.ajustes = await api('PUT', '/api/ia/ajustes', cuerpo); pintarEstado(); pintarHerr(); toast('Guardado'); } catch (e) { toast(e.message, true); } };
    $('#ia-estado').replaceChildren(
      el('span', { class: `ia-on ${aj.activo ? 'si' : 'no'}` }, aj.activo ? '● IA encendida' : '○ IA apagada'),
      adm ? el('button', { type: 'button', class: aj.activo ? 'ia-apagar' : 'primario', onclick: () => guardar({ activo: !aj.activo }) }, aj.activo ? '⏻ Apagar IA' : '⏻ Encender IA') : null,
      ...['mcp', 'app'].map((c) => el('label', { class: 'ia-chk', title: c === 'app' ? 'El asistente dentro de la app (próximamente)' : 'Claude Code / Antigravity con su clave' },
        el('input', { type: 'checkbox', checked: aj.canales[c], disabled: !adm, onchange: (ev) => guardar({ canales: { [c]: ev.target.checked } }) }), ` ${CANAL[c]}${c === 'app' ? ' (pronto)' : ''}`)),
      el('label', { class: 'ia-chk' }, 'Límite por persona ', el('input', { type: 'number', min: 10, max: 100000, value: aj.limite_dia, disabled: !adm, class: 'ia-num', onchange: (ev) => guardar({ limite_dia: Number(ev.target.value) }) }), ' consultas / 24 h'));
  }

  function pintarHerr() {
    const { herramientas: hs, ajustes: aj, puede_admin: adm } = est.d;
    $('#ia-herr-n').textContent = `${hs.length} herramientas · todas de lectura`;
    const alternar = async (h, canal, on) => { try { est.d.ajustes = await api('PUT', '/api/ia/ajustes', { herramienta: h.nombre, canal, apagada: !on }); pintarHerr(); } catch (e) { toast(e.message, true); } };
    $('#ia-herr').replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, 'Herramienta'), el('th', {}, 'Qué hace (lo que lee la IA)'), el('th', {}, 'Riesgo'), el('th', {}, 'Permiso'), el('th', { class: 'c' }, CANAL.mcp), el('th', { class: 'c' }, CANAL.app), el('th', {}))),
      el('tbody', {}, hs.map((h) => el('tr', {},
        el('td', {}, el('b', { class: 'ia-nom' }, h.nombre), el('small', {}, h.grupo)),
        el('td', { class: 'ia-desc' }, h.descripcion),
        el('td', {}, el('span', { class: `ia-chip ${RIESGO[h.riesgo][1]}` }, RIESGO[h.riesgo][0])),
        el('td', { class: 'ayuda' }, h.permiso || 'el de la pantalla'),
        ['mcp', 'app'].map((c) => el('td', { class: 'c' }, el('input', { type: 'checkbox', checked: h.canales.includes(c) && !h.apagada_en.includes(c), disabled: !adm || !h.canales.includes(c), 'aria-label': `${h.nombre} por ${c}`, onchange: (ev) => alternar(h, c, ev.target.checked) }))),
        el('td', {}, el('button', { type: 'button', class: 'mini', onclick: () => probar(h) }, '🧪 Probar'))))));
  }

  // Probar una herramienta: formulario con sus datos de entrada → resultado (queda en el registro como «Prueba»)
  function probar(h) {
    const d = $('#ia-dlg');
    const args = {};
    const campos = Object.entries(h.entrada).map(([k, def]) => el('label', { class: 'ia-campo' }, el('span', {}, `${k}${h.requeridos.includes(k) ? ' *' : ''}`),
      def.enum ? el('select', { onchange: (ev) => { args[k] = ev.target.value; } }, el('option', { value: '' }, '—'), def.enum.map((v) => el('option', { value: v }, v)))
        : def.type === 'boolean' ? el('input', { type: 'checkbox', onchange: (ev) => { args[k] = ev.target.checked; } })
          : el('input', { type: def.type === 'number' ? 'number' : 'text', step: 'any', placeholder: def.description || '', oninput: (ev) => { args[k] = ev.target.value; } }),
      null));
    const salida = el('pre', { class: 'ia-salida' }, 'Pulsa «Ejecutar».');
    d.replaceChildren(
      el('div', { class: 'ia-dlg-cab' }, el('h2', { id: 'ia-dlg-tit' }, `🧪 ${h.nombre}`), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
      el('p', { class: 'ayuda' }, h.descripcion),
      el('div', { class: 'ia-campos' }, campos.length ? campos : el('p', { class: 'ayuda' }, 'No necesita datos.')),
      el('div', { class: 'ia-dlg-pie' }, el('button', { type: 'button', class: 'primario', onclick: async (ev) => {
        ev.target.disabled = true; salida.textContent = 'Consultando…';
        try { const r = await api('POST', `/api/ia/probar/${h.nombre}`, { args }); salida.textContent = JSON.stringify(r, null, 2); }
        catch (e) { salida.textContent = `✕ ${e.message}`; }
        ev.target.disabled = false; cargarRegistro();
      } }, 'Ejecutar')),
      el('p', { class: 'ayuda' }, 'Esto es exactamente lo que recibe la IA. Se ejecuta con tus permisos.'),
      salida);
    d.showModal();
  }

  async function pintarMcp() {
    let claves = [];
    try { claves = await api('GET', '/api/ia/claves'); } catch { /* sin permiso */ }
    const url = est.d.mcp_url;
    const conf = (k) => JSON.stringify({ mcpServers: { planealo: { type: 'http', url, headers: { Authorization: `Bearer ${k}` } } } }, null, 2);
    const nueva = async () => {
      const nombre = prompt('Nombre para reconocer la clave (p. ej. «Claude Code portátil»):', 'Claude Code');
      if (nombre == null) return;
      try {
        const r = await api('POST', '/api/ia/claves', { nombre });
        const d = $('#ia-dlg');
        d.replaceChildren(
          el('div', { class: 'ia-dlg-cab' }, el('h2', { id: 'ia-dlg-tit' }, '🔑 Clave creada'), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
          el('p', {}, el('b', {}, 'Cópiala ahora: no se vuelve a mostrar.'), ' Quien la tenga entra con tus permisos (solo lectura); si la pierdes, revócala y crea otra.'),
          el('pre', { class: 'ia-salida ia-clave' }, r.clave),
          el('p', { class: 'ayuda' }, 'Claude Code (terminal):'),
          el('pre', { class: 'ia-salida' }, `claude mcp add --transport http planealo ${url} --header "Authorization: Bearer ${r.clave}"`),
          el('p', { class: 'ayuda' }, 'O en la configuración MCP (Antigravity, Claude Code, .mcp.json…):'),
          el('pre', { class: 'ia-salida' }, conf(r.clave)),
          el('div', { class: 'ia-dlg-pie' }, el('button', { type: 'button', class: 'primario', onclick: () => { navigator.clipboard?.writeText(r.clave); toast('Clave copiada'); } }, '📋 Copiar clave')));
        d.showModal();
        pintarMcp();
      } catch (e) { toast(e.message, true); }
    };
    $('#ia-mcp').replaceChildren(
      el('p', { class: 'ayuda' }, 'Con una clave tuya, Claude Code o Antigravity (con tus Skills) pueden usar estas herramientas desde tu ordenador. Dirección del servidor MCP: ', el('code', {}, url)),
      el('div', { class: 'ia-claves-cab' }, el('b', {}, 'Mis claves'), el('button', { type: 'button', class: 'primario mini', onclick: nueva }, '＋ Nueva clave')),
      claves.length ? el('table', { class: 'ia-tabla' }, el('tbody', {}, claves.map((k) => el('tr', { class: k.revocada ? 'ia-revocada' : '' },
        el('td', {}, el('b', {}, k.nombre), el('small', {}, `${k.prefijo}…`)),
        el('td', { class: 'ayuda' }, `creada ${cuando(k.creado)}`),
        el('td', { class: 'ayuda' }, k.ultimo_uso ? `usada ${cuando(k.ultimo_uso)}` : 'sin usar'),
        el('td', {}, k.revocada ? el('span', { class: 'ayuda' }, `revocada ${cuando(k.revocada)}`) : el('button', { type: 'button', class: 'ghost borrar mini', onclick: async () => {
          if (!confirm(`¿Revocar «${k.nombre}»? Lo que esté conectado con ella dejará de funcionar.`)) return;
          try { await api('DELETE', `/api/ia/claves/${k.id}`); toast('Clave revocada'); pintarMcp(); } catch (e) { toast(e.message, true); }
        } }, 'Revocar')))))) : el('p', { class: 'ayuda' }, 'Aún no tienes ninguna clave.'));
  }

  async function cargarRegistro() {
    const q = new URLSearchParams(Object.entries(est.filtro).filter(([, v]) => v));
    let r;
    try { r = await api('GET', `/api/ia/registro?${q}`); } catch (e) { $('#ia-reg').replaceChildren(el('tbody', {}, el('tr', {}, el('td', {}, e.message)))); return; }
    const sel = (k, opciones, todos) => el('select', { 'aria-label': k, onchange: (ev) => { est.filtro[k] = ev.target.value; cargarRegistro(); } },
      el('option', { value: '' }, todos), opciones.map(([v, t]) => el('option', { value: v, selected: est.filtro[k] === v }, t)));
    $('#ia-reg-filtros').replaceChildren(
      el('span', { class: 'ayuda' }, `Últimas 24 h: ${r.ultimas_24h.n} consultas${r.ultimas_24h.errores ? ` · ${r.ultimas_24h.errores} con error` : ''}${r.todos ? '' : ' (las tuyas)'}`),
      sel('canal', Object.entries(CANAL), 'Todos los canales'),
      sel('herramienta', est.d.herramientas.map((h) => [h.nombre, h.nombre]), 'Todas las herramientas'),
      el('label', { class: 'ia-chk' }, el('input', { type: 'checkbox', checked: est.filtro.errores === '1', onchange: (ev) => { est.filtro.errores = ev.target.checked ? '1' : ''; cargarRegistro(); } }), ' solo errores'),
      el('button', { type: 'button', class: 'mini', onclick: cargarRegistro }, '↻'));
    const args = (a) => { const e = Object.entries(a || {}); return e.length ? e.map(([k, v]) => `${k}: ${v}`).join(' · ') : '—'; };
    $('#ia-reg').replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, 'Cuándo'), el('th', {}, 'Canal'), el('th', {}, 'En nombre de'), el('th', {}, 'Herramienta'), el('th', {}, 'Datos'), el('th', {}, 'Resultado'), el('th', { class: 'c' }, 'ms'))),
      el('tbody', {}, r.registro.length ? r.registro.map((x) => el('tr', {},
        el('td', { class: 'ayuda' }, cuando(x.creado)),
        el('td', {}, CANAL[x.canal] || x.canal, x.clave ? el('small', {}, x.clave) : null),
        el('td', {}, x.usuario || '—'),
        el('td', {}, el('span', { class: `ia-chip ${RIESGO[x.riesgo]?.[1] || 'nun'}` }, x.herramienta)),
        el('td', { class: 'ia-args' }, args(x.args)),
        el('td', { class: x.ok ? 'ia-ok' : 'ia-mal' }, x.ok ? `✔ ${x.resumen || ''}` : `✕ ${x.error || ''}`),
        el('td', { class: 'c ayuda' }, String(x.ms ?? ''))))
        : el('tr', {}, el('td', { colspan: 7, class: 'ayuda' }, 'Nada todavía.'))));
  }


  // Proveedor de IA: clave de API (cifrada en el servidor; aquí solo «…abcd»), modelo y cuál usa el asistente
  async function pintarProv() {
    if (!est.d.puede_admin) return;
    $('#ia-prov-sec').hidden = false;
    let v;
    try { v = await api('GET', '/api/ia/proveedores'); } catch (e) { $('#ia-prov').replaceChildren(el('p', {}, e.message)); return; }
    const act = v.proveedores.find((p) => p.id === v.activo);
    $('#ia-prov-activo').textContent = act ? `El asistente usará: ${act.nombre} · ${act.modelo || 'sin modelo'}` : 'Sin configurar';
    const tras = async (prom, ok) => { try { await prom; if (ok) toast(ok); } catch (e) { toast(e.message, true); } pintarProv(); };
    $('#ia-prov').replaceChildren(...v.proveedores.map((p) => {
      const inp = el('input', { type: 'password', autocomplete: 'new-password', spellcheck: 'false', placeholder: p.configurada ? 'Pegar otra para cambiarla' : 'Pega aquí la clave de API', 'aria-label': `Clave de ${p.nombre}`, class: 'ia-prov-clave' });
      const guardar = async (ev) => {
        const clave = inp.value.trim(); if (!clave) { inp.focus(); return; }
        ev.target.disabled = true; ev.target.textContent = 'Guardando y probando…';
        inp.value = '';
        await tras(api('PUT', `/api/ia/proveedores/${p.id}`, { clave }), 'Clave guardada');
      };
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') guardar({ target: inp.nextSibling }); });
      const pr = p.prueba;
      return el('div', { class: `ia-prov-card${v.activo === p.id ? ' activo' : ''}` },
        el('div', { class: 'ia-prov-cab' },
          el('b', {}, p.nombre),
          p.configurada ? el('span', { class: 'ia-chip lee' }, `🔒 ${p.final}${p.origen === 'servidor' ? ' · del servidor (.env)' : ''}`) : el('span', { class: 'ia-chip nun' }, 'sin clave'),
          v.activo === p.id ? el('span', { class: 'ia-chip ok' }, '★ la usa el asistente')
            : p.configurada ? el('button', { type: 'button', class: 'mini', onclick: () => tras(api('PUT', '/api/ia/proveedor-activo', { proveedor: p.id }), `El asistente usará ${p.nombre}`) }, 'Usar este') : null),
        el('div', { class: 'ia-prov-fila' }, inp, el('button', { type: 'button', class: 'primario mini', onclick: guardar }, p.configurada ? 'Cambiar clave' : 'Guardar clave')),
        el('div', { class: 'ia-prov-fila' },
          el('label', { class: 'ia-chk' }, 'Modelo ', (() => {
            const lista = p.modelos.includes(p.modelo) || !p.modelo ? p.modelos : [p.modelo, ...p.modelos];
            const sel = el('select', { class: 'ia-prov-mod', onchange: (ev) => {
              let m = ev.target.value;
              if (m === '__otro') { m = prompt('Nombre exacto del modelo:', p.modelo || ''); if (!m) { ev.target.value = p.modelo || ''; return; } }
              tras(api('PUT', `/api/ia/proveedores/${p.id}`, { modelo: m }), 'Modelo guardado');
            } },
            !lista.length ? el('option', { value: '' }, p.configurada ? 'Pulsa «Probar»' : '—') : null,
            lista.map((m) => el('option', { value: m, selected: m === p.modelo }, `${m}${/preview|exp/.test(m) ? ' (preview)' : ''}`)),
            el('option', { value: '__otro' }, 'Otro (escribir)…'));
            return sel;
          })()),
          p.configurada ? el('button', { type: 'button', class: 'mini', onclick: (ev) => { ev.target.disabled = true; ev.target.textContent = 'Probando…'; tras(api('POST', `/api/ia/proveedores/${p.id}/probar`)); } }, '🔌 Probar') : null,
          p.origen === 'panel' ? el('button', { type: 'button', class: 'ghost borrar mini', onclick: () => { if (confirm(`¿Quitar la clave de ${p.nombre}? El asistente dejará de poder usarla.`)) tras(api('PUT', `/api/ia/proveedores/${p.id}`, { borrar_clave: true }), 'Clave quitada'); } }, 'Quitar clave') : null),
        el('div', { class: 'ia-prov-pie' },
          pr ? el('span', { class: pr.ok ? 'ia-ok' : 'ia-mal' }, `${pr.ok ? '✔' : '✕'} ${pr.msg} · ${cuando(pr.en)}`) : p.configurada ? el('span', { class: 'ayuda' }, 'Sin probar') : null,
          p.guardada_por ? el('span', { class: 'ayuda' }, `Guardada por ${p.guardada_por} · ${cuando(p.guardada_en)}`) : null,
          el('a', { href: p.consola, target: '_blank', rel: 'noopener', class: 'ayuda' }, 'Conseguir una clave ↗')));
    }));
  }

  async function iniciar() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    try { est.d = await api('GET', '/api/ia'); }
    catch (e) { document.querySelector('.ia-main').replaceChildren(el('section', { class: 'panel' }, el('p', {}, e.message))); return; }
    pintarEstado(); pintarProv(); pintarHerr(); pintarMcp(); cargarRegistro();
  }
  iniciar();
})();
