/* App del operario: Mi mes, Vacaciones, Avisar (ausencias, justificantes, incidencias) y cambiar el PIN */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'checked' || k === 'selected' || k === 'disabled' || k === 'hidden') n[k] = !!v;
      else if (k === 'value') n.value = v;
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  const deHora = (s) => { const [h, m] = String(s).split(':').map(Number); return h + (m || 0) / 60; };
  const num = (n) => String(Math.round((n || 0) * 100) / 100).replace('.', ',');
  const durTxt = (h) => `${num(h)} h`;
  const fCorta = (f) => new Date(`${f}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const rango = (a, b) => (a === b ? fCorta(a) : `${fCorta(a)} – ${fCorta(b)}`);
  const sumarMes = (m, n) => { const [y, mm] = m.split('-').map(Number); const d = new Date(y, mm - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3000);
  }
  async function api(metodo, url, cuerpo) {
    const r = await fetch(url, { method: metodo, credentials: 'same-origin', headers: cuerpo ? { 'Content-Type': 'application/json' } : {}, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    if (r.status === 401) { location.replace('/pin.html'); throw new Error('Sesión caducada'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Error ${r.status}`);
    return d;
  }

  const est = { vista: 'dia', mes: null, g: null, ctx: null, ausMotivo: null, incTipo: null };

  /* ---------- pestañas ---------- */
  const TITULOS = { mes: 'Mi mes', vac: 'Vacaciones', avisar: 'Avisar', capturar: 'Capturar', perfil: 'Mi perfil', caps: 'Mis capacidades', stock: 'Material', compras: 'Compras locales' };
  function mostrar(vista) {
    est.vista = vista;
    for (const v of ['dia', 'mes', 'vac', 'avisar', 'capturar', 'perfil', 'caps', 'stock', 'compras']) $(`#v-${v}`).hidden = v !== vista;
    document.querySelectorAll('.md-tabs button').forEach((b) => {
      if (b.dataset.vista === vista) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    $('#nav-fecha').hidden = vista !== 'dia';
    $('#titulo-vista').hidden = vista === 'dia';
    $('#titulo-vista').textContent = TITULOS[vista] || '';
    window.scrollTo(0, 0);
    if (vista === 'mes') cargarMes().catch((e) => toast(e.message, true));
    if (vista === 'perfil' || vista === 'caps') window.midiaMenu?.cargar(vista).catch((e) => toast(e.message, true));
    if (vista === 'stock') window.midiaStock?.cargar().catch((e) => toast(e.message, true));
    if (vista === 'compras') window.midiaCompras?.cargar().catch((e) => toast(e.message, true));
    if (vista === 'vac' || vista === 'avisar') cargarGestiones().catch((e) => toast(e.message, true));
    if (vista === 'capturar') {
      if (!est.captura) est.captura = window.Captura.montar($('#v-capturar'), { toast });
      else est.captura.recargar().catch(() => {});
    }
  }

  /* ---------- fotos ---------- */
  // zona de fotos de un formulario: botón «📷 Foto», miniaturas y lista de ids subidos
  function zonaFotos(caja, { multiple = true, texto = '📷 Añadir foto' } = {}) {
    const ids = [];
    const input = el('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true, multiple: multiple ? '' : null });
    const miniaturas = el('span', { class: 'md-minis' });
    const boton = el('button', { type: 'button', class: 'md-foto', onclick: () => input.click() }, texto);
    input.onchange = async () => {
      for (const f of [...input.files]) {
        boton.disabled = true; boton.textContent = 'Subiendo…';
        try {
          const id = await window.s360.subirArchivo(f);
          ids.push(id);
          miniaturas.append(f.type === 'application/pdf' ? el('span', { class: 'md-mini pdf' }, 'PDF')
            : el('img', { class: 'md-mini', src: URL.createObjectURL(f), alt: 'foto' }));
        } catch (e) { toast(e.message, true); }
      }
      boton.disabled = false; boton.textContent = texto;
      input.value = '';
    };
    caja.replaceChildren(boton, input, miniaturas);
    return { ids, limpiar: () => { ids.length = 0; miniaturas.replaceChildren(); } };
  }

  /* ---------- Mi mes ---------- */
  async function cargarMes() {
    const d = await api('GET', `/api/mi-dia/mes${est.mes ? `?mes=${est.mes}` : ''}`);
    est.mes = d.mes;
    const [y, m] = d.mes.split('-').map(Number);
    const t = new Date(y, m - 1, 15).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    $('#mes-txt').textContent = t.charAt(0).toUpperCase() + t.slice(1);
    $('#mes-sig').disabled = d.mes >= sumarMes(d.hoy.slice(0, 7), 2);
    $('#mes-total').textContent = `Planificado ${durTxt(d.total.plan_h)} · Trabajado ${durTxt(d.total.real_h)}${d.total.no_prod_h ? ` · No productivo ${durTxt(d.total.no_prod_h)}` : ''}`;
    const finde = (f) => [0, 6].includes(new Date(`${f}T12:00:00`).getDay());
    $('#mes-dias').replaceChildren(...d.dias.filter((x) => !finde(x.fecha) || x.plan_h || x.real_h || x.ausencias.length).map((x) => {
      const futuro = x.fecha > d.hoy;
      return el('li', { class: `${x.fecha === d.hoy ? 'hoy' : ''}${x.festivo ? ' festivo' : ''}${finde(x.fecha) ? ' finde' : ''}` },
        el('button', { type: 'button', onclick: () => { est.ctx.irADia(x.fecha); mostrar('dia'); } },
          el('span', { class: 'mm-dia' }, fCorta(x.fecha)),
          el('span', { class: 'mm-info' },
            x.festivo ? el('span', { class: 'mm-fest' }, x.festivo) : null,
            ...x.ausencias.map((a) => el('span', { class: `mm-aus t-${a.tipo}` }, a.texto)),
            x.plan_h ? el('span', {}, `plan ${durTxt(x.plan_h)}`) : null,
            x.real_h ? el('span', { class: 'mm-real' }, `✔ ${durTxt(x.real_h)}`) : !futuro && x.apuntado ? el('span', { class: 'mm-pend' }, x.enviado ? 'enviado' : 'sin enviar') : null)));
    }));
  }

  /* ---------- Vacaciones y avisos ---------- */
  async function cargarGestiones() {
    est.g = await api('GET', '/api/mi-dia/gestiones');
    pintarVacaciones();
    pintarAvisar();
  }

  const EST_SOL = { pendiente_ops: '⏳ espera a Operaciones', pendiente_rrhh: '⏳ espera a RRHH', aprobada: '✔ aprobada', rechazada: '✗ rechazada' };
  function pintarVacaciones() {
    const g = est.g, s = g.saldo;
    $('#vac-saldo').replaceChildren(
      el('span', { class: 'md-saldo-n' }, num(s.quedan)),
      el('span', {}, `días te quedan en ${s.anio}`),
      el('span', { class: 'ayuda' }, `de ${num(s.dias)} · disfrutados o aprobados ${num(s.usados)}${s.pedidos ? ` · pedidos ${num(s.pedidos)}` : ''}`));
    $('#vac-lista').replaceChildren(...(g.solicitudes.length ? g.solicitudes.map((x) => el('li', { class: `sol-${x.estado}` },
      el('div', {}, el('b', {}, rango(x.desde, x.hasta)), ` · ${num(x.dias)} día${x.dias === 1 ? '' : 's'}`),
      el('div', { class: `md-est-sol e-${x.estado}` }, EST_SOL[x.estado] || x.estado),
      x.estado === 'rechazada' && (x.rrhh_nota || x.ops_nota) ? el('div', { class: 'ayuda' }, `Motivo: ${x.rrhh_nota || x.ops_nota}`) : null,
      x.estado.startsWith('pendiente') ? el('button', { type: 'button', class: 'ghost mini', onclick: async () => {
        if (!confirm('¿Anular esta petición?')) return;
        try { await api('DELETE', `/api/mi-dia/vacaciones/${x.id}`); toast('Petición anulada'); cargarGestiones(); } catch (e) { toast(e.message, true); }
      } }, 'Anular') : null)) : [el('li', { class: 'ayuda' }, 'Todavía no has pedido vacaciones.')]));
  }

  async function previaVacaciones() {
    const f = $('#form-vac');
    const p = $('#vac-previa');
    if (!f.desde.value || !f.hasta.value) { p.textContent = ''; return; }
    if (f.hasta.value < f.desde.value) { p.textContent = 'La fecha de fin es anterior a la de inicio'; return; }
    try {
      const r = await api('GET', `/api/mi-dia/vacaciones/previa?desde=${f.desde.value}&hasta=${f.hasta.value}`);
      p.replaceChildren(el('b', {}, `${num(r.dias)} día${r.dias === 1 ? '' : 's'} laborable${r.dias === 1 ? '' : 's'}`),
        ` · te quedarían ${num(r.quedan_despues)}`, ...r.avisos.map((a) => el('span', { class: 'md-previa-aviso' }, `⚠ ${a}`)));
    } catch (e) { p.textContent = e.message; }
  }

  function pintarAvisar() {
    const g = est.g;
    // motivos de aviso y tipos de incidencia como botones grandes
    const chips = (caja, opciones, sel, alElegir) => caja.replaceChildren(...Object.entries(opciones).map(([k, t]) => el('button', {
      type: 'button', class: `md-chip${sel === k ? ' activo' : ''}`, 'aria-pressed': sel === k ? 'true' : 'false',
      onclick: () => { alElegir(k); pintarAvisar(); },
    }, t)));
    chips($('#aus-motivos'), g.motivos_aviso, est.ausMotivo, (k) => {
      est.ausMotivo = k;
      // médico y llego tarde suelen ser unas horas
      if (k === 'medico' || k === 'retraso') $('#form-aus').cuanto.value = 'horas';
      ajustarAus();
    });

    // faltas que esperan justificante
    $('#bloque-justif').hidden = !g.justificantes_pendientes.length;
    $('#justif-lista').replaceChildren(...g.justificantes_pendientes.map((a) => {
      const li = el('li', {},
        el('div', {}, el('b', {}, rango(a.desde, a.hasta)), a.hora_desde != null ? ` ${hhmm(a.hora_desde)}–${hhmm(a.hora_hasta)}` : '',
          a.aviso_motivo ? ` · ${g.motivos_aviso[a.aviso_motivo] || ''}` : ''),
        a.archivos.length ? el('div', { class: 'md-ok' }, '✔ Justificante enviado ', window.s360.adjuntos(a.archivos)) : null);
      const caja = el('div', { class: 'md-fotos' });
      const z = zonaFotos(caja, { multiple: false, texto: a.archivos.length ? '📷 Añadir otra foto' : '📷 Subir justificante' });
      const enviar = el('button', { type: 'button', class: 'primario mini', onclick: async () => {
        if (!z.ids.length) return toast('Haz primero la foto', true);
        try { await api('POST', `/api/mi-dia/ausencias/${a.id}/justificante`, { archivos: z.ids }); toast('Justificante enviado'); cargarGestiones(); }
        catch (e) { toast(e.message, true); }
      } }, 'Enviar');
      li.append(caja, enviar);
      return li;
    }));

    // lo que ha avisado
    const MOT = g.motivos_aviso;
    const items = [
      ...g.avisos.map((a) => ({ cuando: a.avisado_en, nodo: el('li', {},
        el('div', {}, el('b', {}, MOT[a.aviso_motivo] || 'Ausencia'), ` · ${rango(a.desde, a.hasta)}${a.hora_desde != null ? ` ${hhmm(a.hora_desde)}–${hhmm(a.hora_hasta)}` : ''}`),
        el('div', { class: 'ayuda' }, a.justificante === 'si' ? '✔ justificada' : a.justificante === 'no' ? '✗ sin justificar' : a.archivos.length ? 'justificante enviado, pendiente de revisar' : 'pendiente de justificante'),
        a.desde >= g.hoy && a.justificante === 'pendiente' ? el('button', { type: 'button', class: 'ghost mini', onclick: async () => {
          if (!confirm('¿Quitar este aviso?')) return;
          try { await api('DELETE', `/api/mi-dia/ausencias/${a.id}`); toast('Aviso quitado'); cargarGestiones(); est.ctx.recargarDia(); } catch (e) { toast(e.message, true); }
        } }, 'Quitar aviso') : null) })),
    ].sort((a, b) => String(b.cuando).localeCompare(String(a.cuando)));
    $('#mis-avisos').replaceChildren(...(items.length ? items.map((x) => x.nodo) : [el('li', { class: 'ayuda' }, 'Nada en los últimos días.')]),
      el('li', { class: 'ayuda' }, 'Para una avería, falta de material u otra incidencia, usa ', el('b', {}, '＋ Capturar'), '.'));
  }

  function ajustarAus() {
    const f = $('#form-aus');
    const horas = f.cuanto.value === 'horas';
    $('#aus-horas').hidden = !horas;
    f.hasta.closest('label').hidden = horas;
  }

  /* ---------- cambiar PIN ---------- */
  function cambiarPin() {
    const d = el('dialog', { class: 'dlg-pregunta md-dlg-pin', 'aria-labelledby': 'pin-tit' });
    const actual = el('input', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'current-password', 'aria-label': 'PIN actual' });
    const nuevo = el('input', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'new-password', 'aria-label': 'PIN nuevo' });
    const repite = el('input', { type: 'password', inputmode: 'numeric', maxlength: 4, autocomplete: 'new-password', 'aria-label': 'Repite el PIN nuevo' });
    const err = el('p', { class: 'error', role: 'alert' });
    const cerrar = () => { d.close(); d.remove(); };
    d.append(el('h2', { id: 'pin-tit' }, 'Cambiar mi PIN'),
      el('label', {}, 'PIN actual', actual), el('label', {}, 'PIN nuevo (4 cifras)', nuevo), el('label', {}, 'Repítelo', repite), err,
      el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: cerrar }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          if (nuevo.value !== repite.value) { err.textContent = 'Los dos PIN nuevos no coinciden'; return; }
          try { await api('POST', '/api/mi-dia/pin', { actual: actual.value, nuevo: nuevo.value }); cerrar(); toast('PIN cambiado'); }
          catch (e) { err.textContent = e.message; }
        } }, 'Guardar')));
    d.addEventListener('cancel', (ev) => { ev.preventDefault(); cerrar(); });
    document.body.append(d);
    d.showModal();
    actual.focus();
  }

  /* ---------- arranque ---------- */
  function iniciar(ctx) {
    est.ctx = ctx;
    document.querySelectorAll('.md-tabs button[data-vista]').forEach((b) => { b.onclick = () => mostrar(b.dataset.vista); });
    $('#cambiar-pin').onclick = cambiarPin;
    $('#mes-ant').onclick = () => { est.mes = sumarMes(est.mes, -1); cargarMes().catch((e) => toast(e.message, true)); };
    $('#mes-sig').onclick = () => { est.mes = sumarMes(est.mes, 1); cargarMes().catch((e) => toast(e.message, true)); };

    const fv = $('#form-vac');
    fv.desde.onchange = () => { if (!fv.hasta.value || fv.hasta.value < fv.desde.value) fv.hasta.value = fv.desde.value; previaVacaciones(); };
    fv.hasta.onchange = previaVacaciones;
    fv.onsubmit = async (ev) => {
      ev.preventDefault();
      try {
        const r = await api('POST', '/api/mi-dia/vacaciones', { desde: fv.desde.value, hasta: fv.hasta.value, notas: fv.notas.value });
        toast(`Pedidos ${num(r.dias)} días: espera la respuesta`);
        fv.reset(); $('#vac-previa').textContent = '';
        cargarGestiones();
      } catch (e) { toast(e.message, true); }
    };

    const fa = $('#form-aus');
    const fotosAus = zonaFotos($('#aus-fotos'), { texto: '📷 Foto del justificante (si lo tienes)' });
    fa.addEventListener('change', (ev) => { if (ev.target.name === 'cuanto') ajustarAus(); });
    fa.onsubmit = async (ev) => {
      ev.preventDefault();
      if (!est.ausMotivo) return toast('Elige qué pasa', true);
      const horas = fa.cuanto.value === 'horas';
      if (horas && (!fa.hora_desde.value || !fa.hora_hasta.value)) return toast('Pon de qué hora a qué hora', true);
      try {
        const r = await api('POST', '/api/mi-dia/ausencias', {
          motivo: est.ausMotivo, desde: fa.desde.value, hasta: horas ? null : fa.hasta.value || null,
          hora_desde: horas ? deHora(fa.hora_desde.value) : null, hora_hasta: horas ? deHora(fa.hora_hasta.value) : null,
          notas: fa.notas.value, archivos: fotosAus.ids,
        });
        toast(`Avisado${r.afectados ? ` · tenías ${r.afectados} trabajo(s) planificado(s): el encargado lo verá` : ''}`);
        fa.reset(); fotosAus.limpiar(); est.ausMotivo = null; fa.desde.value = est.g?.hoy || ''; ajustarAus();
        cargarGestiones(); ctx.recargarDia();
      } catch (e) { toast(e.message, true); }
    };

    const hoy = new Date().toLocaleDateString('sv-SE');
    fa.desde.value = hoy;
  }

  // desde una tarjeta de Mi día: capturar algo de ese trabajo
  function incidencia(tramoId) {
    if (!est.captura) est.captura = window.Captura.montar($('#v-capturar'), { toast, tramoId });
    mostrar('capturar');
    est.captura.elegirTramo(tramoId);
  }

  window.midiaMas = { iniciar, mostrar, incidencia, cambiarPin, vista: () => est.vista,
    recargar: () => (est.vista === 'mes' ? cargarMes() : ['dia', 'perfil', 'caps'].includes(est.vista) ? null : est.vista === 'stock' ? window.midiaStock?.cargar() : est.vista === 'compras' ? window.midiaCompras?.cargar() : est.vista === 'capturar' ? est.captura?.recargar() : cargarGestiones()) };
})();
