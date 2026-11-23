/* Incidencias: lista unificada (material, transporte, calidad, avería, seguridad, proveedor) y ficha con su gestión:
   en curso → reclamar al proveedor (correo / WhatsApp / enlace) → aceptar su fecha o decidir → resolver → cerrar (responsable + Operaciones) */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { api } = window.s360;
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['selected', 'checked', 'hidden', 'disabled', 'required'].includes(k)) n[k] = !!v;
      else if (k === 'value') n.value = v ?? '';
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3500);
  }
  const dia = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
  const cuando = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const eur = (v) => `${Number(v || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const hoy = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
  const ESTADO = { abierta: ['abierta', 'c-ro'], en_curso: ['en curso', 'c-or'], esperando: ['esperando proveedor', 'c-az'], resuelta: ['resuelta · falta cerrar', 'c-ve'], cerrada: ['cerrada', 'c-gr'] };
  const PASOS = [['abierta', 'Abierta'], ['en_curso', 'En curso'], ['esperando', 'Esperando proveedor'], ['resuelta', 'Resuelta'], ['cerrada', 'Cerrada']];
  const GRAV = { leve: 'leve', importante: 'importante', critica: 'crítica' };
  const PEDIMOS = { reponer: 'Reponer / enviar lo que falta', cambiar: 'Cambiarlo por el correcto', abono: 'Descuento o abono' };

  const q0 = new URLSearchParams(location.search);
  const est = { vista: q0.get('vista') || (q0.get('id') ? 'abiertas' : 'mias'), id: Number(q0.get('id')) || null, datos: null, op: null };
  const guardarURL = () => {
    const u = new URLSearchParams();
    if (est.vista !== 'mias') u.set('vista', est.vista);
    if (est.id) u.set('id', est.id);
    history.replaceState(null, '', `${location.pathname}${u.toString() ? `?${u}` : ''}`);
  };

  /* ---------- diálogo genérico ---------- */
  function dialogo(titulo, cuerpo, botones) {
    const d = el('dialog', { class: 'inc-dlg', 'aria-label': titulo });
    const cerrar = () => { d.close(); d.remove(); };
    d.append(el('h2', {}, titulo), ...cuerpo, el('div', { class: 'acciones dlg-acciones' },
      ...botones.map(([txt, cls, fn]) => el('button', { type: 'button', class: cls, onclick: async (ev) => {
        if (!fn) return cerrar();
        ev.currentTarget.disabled = true;
        try { if ((await fn()) !== false) cerrar(); } catch (e) { toast(e.message, true); } finally { ev.target.disabled = false; }
      } }, txt))));
    d.addEventListener('close', () => d.remove());
    document.body.append(d); d.showModal();
    return d;
  }
  const campo = (txt, input) => el('label', { class: 'inc-campo' }, el('span', {}, txt), input);

  /* ---------- lista ---------- */
  async function cargar() {
    const tipo = $('#inc-filtro-tipo').value;
    est.datos = await api('GET', `/api/incidencias?vista=${est.vista}${tipo ? `&tipo=${tipo}` : ''}`);
    pintarLista();
    if (est.id) abrir(est.id); else if (est.datos.incidencias[0] && matchMedia('(min-width: 900px)').matches) abrir(est.datos.incidencias[0].id);
  }
  function pintarLista() {
    const d = est.datos;
    for (const b of document.querySelectorAll('#inc-tabs [data-vista]')) {
      const k = b.dataset.vista; const n = d.cuenta[k];
      b.setAttribute('aria-selected', k === est.vista ? 'true' : 'false');
      b.textContent = `${{ mias: 'Mías', abiertas: 'Abiertas', esperando: 'Esperando proveedor', por_cerrar: 'Por cerrar', cerradas: 'Cerradas' }[k]}${n ? ` ${n}` : ''}`;
    }
    $('#inc-lista').replaceChildren(...(d.incidencias.length ? d.incidencias.map((i) => {
      const [et, cl] = ESTADO[i.estado];
      const af = i.afectadas || [];
      return el('li', { class: `inc-item${i.id === est.id ? ' sel' : ''}${i.gravedad === 'critica' ? ' crit' : ''}`, tabindex: 0, 'data-id': i.id,
        onclick: () => abrir(i.id), onkeydown: (ev) => { if (ev.key === 'Enter') abrir(i.id); } },
      el('div', { class: 'inc-item-1' }, el('b', {}, i.codigo), el('span', { class: `chip ${i.gravedad === 'leve' ? 'c-gr' : 'c-ro'}` }, GRAV[i.gravedad]),
        el('span', { class: 'chip c-tipo' }, d.tipos[i.tipo]), el('span', { class: `chip ${cl}` }, et)),
      el('div', { class: 'inc-item-tit' }, i.titulo),
      el('small', {}, [i.proveedor, af.length ? `afecta ${af.slice(0, 2).map((a) => `${a.codigo}${a.dia ? ` (${ddmm(a.dia)})` : ''}`).join(', ')}` : null,
        i.estado === 'esperando' ? (i.fecha_acordada ? `resolverá el ${ddmm(i.fecha_acordada)}` : i.prov_respondido_en ? `propone ${ddmm(i.prov_fecha)}` : `sin respuesta · plazo ${ddmm(i.plazo_respuesta)}`) : null,
        i.responsable || d.areas[i.area]].filter(Boolean).join(' · ')));
    }) : [el('li', { class: 'ayuda' }, est.vista === 'mias' ? '✔ No tienes incidencias pendientes.' : 'No hay incidencias aquí.')]));
  }

  /* ---------- ficha ---------- */
  async function abrir(id) {
    est.id = id; guardarURL();
    for (const li of document.querySelectorAll('.inc-item')) li.classList.toggle('sel', Number(li.dataset.id) === id);
    try { pintarFicha(await api('GET', `/api/incidencias/${id}`)); } catch (e) { toast(e.message, true); }
  }
  async function hacer(fn, msg) {
    try { const i = await fn(); if (msg) toast(msg); await recargarLista(); if (i?.id) pintarFicha(i); else abrir(est.id); } catch (e) { toast(e.message, true); }
  }
  async function recargarLista() { const tipo = $('#inc-filtro-tipo').value; est.datos = await api('GET', `/api/incidencias?vista=${est.vista}${tipo ? `&tipo=${tipo}` : ''}`); pintarLista(); }

  function pintarFicha(i) {
    const p = i.puedo || {};
    const abierta = !['resuelta', 'cerrada'].includes(i.estado);
    const idxPaso = PASOS.findIndex(([k]) => k === i.estado);
    const deQue = [
      i.material ? ['Material', `${i.material}${i.material_cantidad ? ` · ${String(i.material_cantidad).replace('.', ',')} ${i.material_unidad || ''}` : ''}`] : null,
      i.pedido_codigo ? ['Pedido', el('a', { href: `/compras.html?pedido=${i.pedido_id}` }, i.pedido_codigo)] : null,
      i.envio_codigo ? ['Envío', el('a', { href: `/compras.html?vista=transportes&envio=${i.envio_id}` }, i.envio_codigo)] : null,
      i.tarea_codigo ? ['Tarea', el('a', { href: `/proyectos.html?p=${i.proyecto_id}&ot=${i.orden_id}&tarea=${i.tarea_id}` }, `${i.tarea_codigo} ${i.tarea_nombre}`)] : null,
      !i.tarea_codigo && i.orden_codigo ? ['OT', el('a', { href: `/proyectos.html?p=${i.proyecto_id}&ot=${i.orden_id}` }, `${i.orden_codigo} ${i.orden_titulo}`)] : null,
      i.proyecto_codigo ? ['Proyecto', el('a', { href: `/proyectos.html?p=${i.proyecto_id}` }, `${i.proyecto_codigo} ${i.proyecto_nombre || ''}`)] : null,
      i.recurso_nombre ? ['Máquina', i.recurso_nombre] : null,
    ].filter(Boolean);
    const af = i.afectadas || [];

    // bloque de la respuesta del proveedor
    let caja = null;
    if (i.estado === 'esperando') {
      if (i.prov_respondido_en && !i.fecha_acordada) {
        caja = el('div', { class: 'inc-caja am' },
          el('b', {}, `${i.proveedor} ha respondido`), el('small', {}, ` · ${cuando(i.prov_respondido_en)}`),
          el('div', {}, `«${{ reponer: 'Repondremos / enviaremos lo que falta', cambiar: 'Lo cambiaremos', abono: 'Lo abonaremos', otro: 'Otra solución' }[i.prov_accion] || i.prov_accion}»${i.prov_importe ? ` · ${eur(i.prov_importe)}` : ''} · `, el('b', {}, `fecha de resolución: ${dia(i.prov_fecha)}`)),
          i.prov_comentario ? el('div', { class: 'ayuda' }, `«${i.prov_comentario}»`) : null,
          i.necesario_el && i.prov_fecha > i.necesario_el ? el('div', { class: 'inc-tarde' }, `⚠ Lo necesitábamos el ${dia(i.necesario_el)}`) : null,
          p.editar ? el('div', { class: 'inc-btns' },
            el('button', { type: 'button', class: 'primario', onclick: () => hacer(() => api('POST', `/api/incidencias/${i.id}/aceptar-fecha`), `Fecha aceptada: recordatorio el ${ddmm(i.prov_fecha)}`) }, '✔ Aceptar fecha'),
            el('button', { type: 'button', class: 'ghost peligro', onclick: () => dlgDecidir(i) }, '✗ No es aceptable…')) : null,
          el('small', { class: 'ayuda' }, 'Aceptarla programa ese día un recordatorio para ti y otro correo al proveedor.'));
      } else if (i.fecha_acordada) {
        caja = el('div', { class: `inc-caja ${i.fecha_acordada < hoy() ? 'ro' : 'az'}` },
          el('b', {}, `${i.fecha_acordada < hoy() ? '⚠ Pasó la fecha acordada' : 'Fecha acordada'}: ${dia(i.fecha_acordada)}`),
          el('div', {}, `${i.proveedor}: ${{ reponer: 'repone / envía lo que falta', cambiar: 'lo cambia', abono: 'lo abona', otro: 'otra solución' }[i.prov_accion] || ''}${i.prov_importe ? ` (${eur(i.prov_importe)})` : ''}`),
          el('small', { class: 'ayuda' }, i.material ? 'Se resuelve sola cuando Logística marca «Recibido» el material.' : 'Márcala resuelta cuando llegue o se apunte el abono.'));
      } else {
        caja = el('div', { class: 'inc-caja az' },
          el('b', {}, `Esperando respuesta de ${i.proveedor || 'el proveedor'}`),
          el('div', {}, `Reclamado ${i.reclamado_en ? cuando(i.reclamado_en) : ''} · plazo para responder: ${dia(i.plazo_respuesta)}${i.n_recordatorios ? ` · recordado ${i.n_recordatorios} vez/veces` : ''}`),
          i.visto_en ? el('small', { class: 'ayuda' }, `👁 abrió el enlace ${cuando(i.visto_en)}`) : el('small', { class: 'ayuda' }, 'Aún no ha abierto el enlace.'),
          el('small', { class: 'ayuda' }, ' Sin respuesta en el plazo: correo de recordatorio cada 2 días laborables y aviso al responsable.'));
      }
    }

    const botones = [];
    if (p.editar && i.estado === 'abierta') botones.push(el('button', { type: 'button', class: 'primario', onclick: () => hacer(() => api('POST', `/api/incidencias/${i.id}/en-curso`), 'Te encargas tú') }, '▶ Me encargo'));
    if (p.editar && abierta) botones.push(el('button', { type: 'button', class: i.estado === 'esperando' ? 'ghost' : 'primario', onclick: () => dlgReclamar(i) }, i.reclamado_en ? '✉ Reclamar de nuevo' : '✉ Reclamar al proveedor…'));
    if (p.editar && abierta && i.url) botones.push(el('button', { type: 'button', class: 'ghost', onclick: () => copiar(i.url) }, '🔗 Copiar enlace'));
    if (p.editar && abierta) botones.push(el('button', { type: 'button', class: 'ghost', onclick: () => dlgDecidir(i, true) }, '⚑ Decidir…'));
    if (p.editar && abierta) botones.push(el('button', { type: 'button', class: 'ghost', onclick: () => dlgResolver(i) }, '✔ Marcar resuelta'));
    if (p.cerrar_resp || p.cerrar_ops) botones.push(el('button', { type: 'button', class: 'primario', onclick: () => dlgCerrar(i) }, `🔒 Cerrar${p.cerrar_resp && p.cerrar_ops ? '' : p.cerrar_resp ? ' (responsable)' : ' (Operaciones)'}`));
    if (p.editar && ['resuelta', 'cerrada'].includes(i.estado)) botones.push(el('button', { type: 'button', class: 'ghost', onclick: () => dlgReabrir(i) }, '↺ Reabrir'));
    botones.push(el('button', { type: 'button', class: 'ghost', onclick: () => dlgNota(i) }, '＋ Nota / foto'));
    botones.push(el('a', { class: 'boton ghost', href: `/api/incidencias/${i.id}/pdf`, target: '_blank', rel: 'noopener' }, '📄 Informe PDF'));

    const selGrav = el('select', { 'aria-label': 'Gravedad', disabled: !p.editar, onchange: (ev) => hacer(() => api('PATCH', `/api/incidencias/${i.id}`, { gravedad: ev.target.value }), 'Guardado') },
      Object.entries(GRAV).map(([k, t]) => el('option', { value: k, selected: k === i.gravedad }, t)));
    const selResp = el('select', { 'aria-label': 'Responsable', disabled: !p.editar, onchange: (ev) => hacer(() => api('PATCH', `/api/incidencias/${i.id}`, { responsable_id: ev.target.value || null }), 'Guardado') },
      el('option', { value: '' }, `${i.area_txt} (cualquiera del área)`), (est.op?.usuarios || []).map((u) => el('option', { value: u.id, selected: u.id === i.responsable_id }, u.nombre)));
    const selArea = el('select', { 'aria-label': 'Área', disabled: !p.editar, onchange: (ev) => hacer(() => api('PATCH', `/api/incidencias/${i.id}`, { area: ev.target.value }), 'Guardado') },
      Object.entries(est.op?.areas || {}).map(([k, t]) => el('option', { value: k, selected: k === i.area }, t)));
    const selProv = el('select', { 'aria-label': 'A quién se reclama', disabled: !p.editar, onchange: (ev) => hacer(() => api('PATCH', `/api/incidencias/${i.id}`, { proveedor_id: ev.target.value || null }), 'Guardado') },
      el('option', { value: '' }, 'Interna (sin proveedor)'), (est.op?.proveedores || []).map((x) => el('option', { value: x.id, selected: x.id === i.proveedor_id }, `${x.nombre}${x.transportista ? ' (transportista)' : ''}`)));

    $('#inc-ficha').replaceChildren(...[
      el('div', { class: 'inc-cab' }, el('h2', {}, `${i.codigo} · ${i.tipo_txt}`), selGrav),
      el('p', { class: 'inc-tit' }, i.titulo),
      el('ol', { class: 'inc-pasos' }, PASOS.map(([k, t], n) => el('li', { class: n < idxPaso ? 'ok' : n === idxPaso ? 'act' : '' }, t))),
      el('dl', { class: 'inc-dl' },
        deQue.map(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]),
        el('dt', {}, 'Afecta a'), el('dd', {}, af.length ? af.map((a, n) => [n ? ', ' : '', el('a', { href: `/proyectos.html?p=${a.proyecto_id}&ot=${a.orden_id}&tarea=${a.id}` }, `${a.codigo} ${a.nombre}`), a.dia ? ` (planificada ${ddmm(a.dia)})` : '']) : '—'),
        el('dt', {}, 'Reclamar a'), el('dd', {}, selProv),
        el('dt', {}, 'Área'), el('dd', {}, selArea),
        el('dt', {}, 'Responsable'), el('dd', {}, selResp, el('small', { class: 'ayuda' }, ' · la cierran el responsable y Operaciones')),
        i.pedimos ? el('dt', {}, 'Pedimos') : null, i.pedimos ? el('dd', {}, `${PEDIMOS[i.pedimos]}${i.abono_pedido ? ` (${eur(i.abono_pedido)})` : ''}${i.necesario_el ? ` antes del ${dia(i.necesario_el)}` : ''}`) : null,
        i.resolucion ? el('dt', {}, 'Resolución') : null, i.resolucion ? el('dd', {}, `${i.resolucion}${i.abono_importe ? ` · abono ${eur(i.abono_importe)}` : ''}${i.resuelta_por_nombre ? ` (${i.resuelta_por_nombre})` : ''}`) : null,
        i.causa ? el('dt', {}, 'Causa') : null, i.causa ? el('dd', {}, i.causa) : null,
        i.accion_preventiva ? el('dt', {}, 'Para que no se repita') : null, i.accion_preventiva ? el('dd', {}, i.accion_preventiva) : null,
        i.estado === 'resuelta' || i.estado === 'cerrada' ? el('dt', {}, 'Cierre') : null,
        i.estado === 'resuelta' || i.estado === 'cerrada' ? el('dd', {}, `responsable: ${i.cerrada_resp_nombre ? `✔ ${i.cerrada_resp_nombre}` : 'pendiente'} · Operaciones: ${i.cerrada_ops_nombre ? `✔ ${i.cerrada_ops_nombre}` : 'pendiente'}`) : null),
      i.texto && i.texto !== i.titulo ? el('p', { class: 'inc-texto' }, i.texto) : null,
      i.archivos?.length ? el('div', { class: 'inc-fotos' }, i.archivos.map((a) => el('a', { href: `/api/archivos/${a.id}`, target: '_blank', rel: 'noopener' },
        a.tipo?.startsWith('image/') ? el('img', { src: `/api/archivos/${a.id}`, alt: a.nombre || 'foto', loading: 'lazy' }) : el('span', { class: 'chip c-gr' }, `📎 ${a.nombre || 'archivo'}`)))) : null,
      caja,
      el('div', { class: 'inc-btns' }, botones),
      el('h3', { class: 'inc-h3' }, 'Historial'),
      el('ol', { class: 'inc-hist' }, (i.eventos || []).map((e) => el('li', { class: `ev-${e.tipo}` },
        el('div', {}, e.texto), el('small', {}, `${cuando(e.creado)} · ${e.usuario || e.externo || 'automático'}`))))].filter(Boolean));
  }

  async function copiar(txt) {
    try { await navigator.clipboard.writeText(txt); toast('Enlace copiado'); } catch { prompt('Copia el enlace:', txt); }
  }

  /* ---------- diálogos ---------- */
  function dlgReclamar(i) {
    if (!i.proveedor_id) return toast('Elige antes en «Reclamar a» el proveedor, transportista o subcontrata', true);
    const ped = el('select', {}, Object.entries(PEDIMOS).map(([k, t]) => el('option', { value: k, selected: k === (i.pedimos || 'reponer') }, t)));
    const imp = el('input', { type: 'number', min: 0, step: '0.01', placeholder: 'importe €', value: i.abono_pedido ?? '' });
    const nec = el('input', { type: 'date', value: i.necesario_el || i.afectadas?.find((a) => a.dia)?.dia || '' });
    const plazo = el('select', {}, [1, 2, 3, 5].map((n) => el('option', { value: n, selected: n === 2 }, `${n} día${n > 1 ? 's' : ''} laborable${n > 1 ? 's' : ''}`)));
    const email = el('input', { type: 'email', value: i.email_reclamacion || i.proveedor_email || '', placeholder: 'correo del proveedor' });
    const msg = el('textarea', { rows: 4 }, `Hola,\n\nOs escribimos por una incidencia${i.pedido_codigo ? ` en el pedido ${i.pedido_codigo}` : i.envio_codigo ? ` en el envío ${i.envio_codigo}` : ''}: ${i.texto || i.titulo}.`);
    const filaImp = campo('Importe del abono que pedimos', imp); filaImp.hidden = ped.value !== 'abono';
    ped.onchange = () => { filaImp.hidden = ped.value !== 'abono'; };
    const enviar = (canal) => async () => {
      const r = await api('POST', `/api/incidencias/${i.id}/reclamar`, { pedimos: ped.value, abono_pedido: imp.value, necesario_el: nec.value, plazo_dias: plazo.value, mensaje: msg.value, canal, email: email.value });
      if (canal === 'whatsapp') {
        if (!i.proveedor_telefono) toast('El proveedor no tiene teléfono en su ficha: elige el chat en WhatsApp', true);
        window.open(r.whatsapp, '_blank', 'noopener');
      }
      if (canal === 'enlace') await copiar(r.url);
      toast(canal === 'correo' ? 'Reclamación enviada por correo con el informe' : canal === 'whatsapp' ? 'Se abre WhatsApp con el mensaje y el enlace' : 'Enlace copiado');
      await recargarLista(); pintarFicha(r);
    };
    dialogo(`Reclamar a ${i.proveedor}`, [
      campo('Qué pedimos', ped), filaImp, campo('Lo necesitamos antes del', nec), campo('Plazo para que responda', plazo),
      campo('Correo', email), campo('Mensaje', msg),
      el('p', { class: 'ayuda' }, 'Se adjunta el informe de la incidencia (PDF, con las fotos) y el enlace donde nos dirá qué hará y la fecha. WhatsApp abre el chat con el texto y el enlace (lo envías tú).'),
    ], [['✉ Enviar correo', 'primario', enviar('correo')], ['WhatsApp', 'ghost wa', enviar('whatsapp')], ['🔗 Solo copiar enlace', 'ghost', enviar('enlace')], ['Cancelar', 'ghost']]);
  }

  function dlgDecidir(i, libre = false) {
    const DEC = { otra_fecha: 'Pedir otra fecha (se vuelve a reclamar)', otro_proveedor: 'Pedirlo a otro proveedor', stock: 'Sacarlo de stock / apañarse con lo que hay (resuelve)', abono: 'Aceptarlo con abono o descuento (resuelve)', otro: 'Otra decisión' };
    const sel = el('select', {}, Object.entries(DEC).map(([k, t]) => el('option', { value: k }, t)));
    const imp = el('input', { type: 'number', min: 0, step: '0.01', placeholder: '€' });
    const txt = el('textarea', { rows: 3, placeholder: 'Por qué y qué se hace (queda en la incidencia)' });
    const fImp = campo('Importe del abono', imp); fImp.hidden = true;
    sel.onchange = () => { fImp.hidden = sel.value !== 'abono'; };
    dialogo(libre ? 'Decidir qué se hace' : 'La fecha no es aceptable', [
      i.prov_fecha && !libre ? el('p', {}, `${i.proveedor} propone el ${dia(i.prov_fecha)}${i.necesario_el ? `; lo necesitábamos el ${dia(i.necesario_el)}` : ''}.`) : null,
      campo('Qué hacemos', sel), fImp, campo('Motivo', txt),
    ].filter(Boolean), [['Guardar decisión', 'primario', async () => {
      const r = await api('POST', `/api/incidencias/${i.id}/decidir`, { decision: sel.value, texto: txt.value, importe: imp.value });
      toast('Decisión guardada'); await recargarLista(); pintarFicha(r);
      if (sel.value === 'otra_fecha') dlgReclamar(r);
      if (sel.value === 'otro_proveedor') toast('Pide el material que falta en Compras (Material de las partidas › Por pedir)');
    }], ['Cancelar', 'ghost']]);
  }

  function dlgResolver(i) {
    const txt = el('textarea', { rows: 3, placeholder: 'Cómo se ha resuelto' });
    const imp = el('input', { type: 'number', min: 0, step: '0.01', placeholder: 'si hubo abono, el importe €' });
    dialogo('Marcar resuelta', [campo('Resolución', txt), campo('Abono (opcional)', imp),
      el('p', { class: 'ayuda' }, 'Después la cierran el responsable del área y Operaciones.')],
    [['✔ Resuelta', 'primario', async () => { const r = await api('POST', `/api/incidencias/${i.id}/resolver`, { texto: txt.value, abono_importe: imp.value }); toast('Resuelta'); await recargarLista(); pintarFicha(r); }], ['Cancelar', 'ghost']]);
  }

  function dlgCerrar(i) {
    const causa = el('textarea', { rows: 2, placeholder: i.tipo === 'calidad' ? 'Obligatorio en calidad' : 'Opcional' }, i.causa || '');
    const acc = el('textarea', { rows: 2, placeholder: i.tipo === 'calidad' ? 'Obligatorio en calidad' : 'Opcional' }, i.accion_preventiva || '');
    dialogo(`Cerrar ${i.codigo}`, [el('p', {}, `Resolución: ${i.resolucion || '—'}`), campo('Causa', causa), campo('Qué haremos para que no se repita', acc),
      el('p', { class: 'ayuda' }, 'Queda cerrada cuando firman el responsable del área y Operaciones.')],
    [['🔒 Firmar el cierre', 'primario', async () => { const r = await api('POST', `/api/incidencias/${i.id}/cerrar`, { causa: causa.value, accion_preventiva: acc.value }); toast(r.estado === 'cerrada' ? 'Cerrada' : 'Firmado: falta la otra firma'); await recargarLista(); pintarFicha(r); }], ['Cancelar', 'ghost']]);
  }

  function dlgReabrir(i) {
    const txt = el('input', { type: 'text', placeholder: 'Por qué se reabre' });
    dialogo(`Reabrir ${i.codigo}`, [campo('Motivo', txt)], [['↺ Reabrir', 'primario', async () => { const r = await api('POST', `/api/incidencias/${i.id}/reabrir`, { texto: txt.value }); await recargarLista(); pintarFicha(r); }], ['Cancelar', 'ghost']]);
  }

  function dlgNota(i) {
    const txt = el('textarea', { rows: 3 }); const ids = [];
    const inp = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true });
    const minis = el('span', { class: 'inc-minis' });
    inp.onchange = async () => { for (const f of inp.files) { try { ids.push(await window.s360.subirArchivo(f)); minis.append(el('span', { class: 'chip c-gr' }, `📎 ${f.name}`)); } catch (e) { toast(e.message, true); } } inp.value = ''; };
    dialogo(`Nota en ${i.codigo}`, [campo('Nota', txt), campo('Fotos / PDF', inp), minis],
      [['Guardar', 'primario', async () => { const r = await api('POST', `/api/incidencias/${i.id}/nota`, { texto: txt.value, archivos: ids }); pintarFicha(r); }], ['Cancelar', 'ghost']]);
  }

  function dlgNueva() {
    const o = est.op;
    const tipo = el('select', {}, Object.entries(o.tipos).map(([k, t]) => el('option', { value: k }, t)));
    const grav = el('select', {}, Object.entries(GRAV).map(([k, t]) => el('option', { value: k, selected: k === 'importante' }, t)));
    const tit = el('input', { type: 'text', maxlength: 200, placeholder: 'Qué pasa, en una línea' });
    const txt = el('textarea', { rows: 3, placeholder: 'Detalle' });
    const prov = el('select', {}, el('option', { value: '' }, 'Interna (sin proveedor)'), o.proveedores.map((x) => el('option', { value: x.id }, x.nombre)));
    const tarea = el('input', { type: 'text', placeholder: 'Código de la tarea u OT (p. ej. 61.03.4 o 61.03), opcional' });
    const ids = []; const inp = el('input', { type: 'file', accept: 'image/*,application/pdf', multiple: true }); const minis = el('span', { class: 'inc-minis' });
    inp.onchange = async () => { for (const f of inp.files) { try { ids.push(await window.s360.subirArchivo(f)); minis.append(el('span', { class: 'chip c-gr' }, `📎 ${f.name}`)); } catch (e) { toast(e.message, true); } } inp.value = ''; };
    dialogo('Nueva incidencia', [campo('Tipo', tipo), campo('Gravedad', grav), campo('Qué pasa', tit), campo('Detalle', txt), campo('De la tarea / OT', tarea), campo('Proveedor / transportista / subcontrata', prov), campo('Fotos', inp), minis,
      el('p', { class: 'ayuda' }, 'Avisa al área responsable y a Operaciones; si es crítica, también a Dirección.')],
    [['Crear', 'primario', async () => {
      let ref = {};
      const c = tarea.value.trim();
      if (c) {
        const r = await api('GET', `/api/incidencias-buscar?q=${encodeURIComponent(c)}`);
        if (!r) throw new Error('No encuentro esa tarea u OT');
        ref = r;
      }
      const r = await api('POST', '/api/incidencias', { tipo: tipo.value, gravedad: grav.value, titulo: tit.value, texto: txt.value, proveedor_id: prov.value || null, archivos: ids, ...ref });
      toast(`${r.codigo} creada`); est.vista = 'abiertas'; est.id = r.id; await cargar();
    }], ['Cancelar', 'ghost']]);
  }

  /* ---------- inicio ---------- */
  async function iniciar() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    est.op = await api('GET', '/api/incidencias/opciones');
    $('#inc-filtro-tipo').replaceChildren(el('option', { value: '' }, 'Todos los tipos'), Object.entries(est.op.tipos).map(([k, t]) => el('option', { value: k }, t)));
    $('#inc-filtro-tipo').onchange = cargar;
    for (const b of document.querySelectorAll('#inc-tabs [data-vista]')) b.onclick = () => { est.vista = b.dataset.vista; est.id = null; guardarURL(); cargar(); };
    $('#inc-nueva').onclick = dlgNueva;
    window.s360.alCambiar?.(() => recargarLista().catch(() => {}));
    await cargar();
  }
  iniciar().catch((e) => toast(e.message, true));
})();
