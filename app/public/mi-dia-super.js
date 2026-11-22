/* App del móvil · Supervisar (encargados, logística, Operaciones, Dirección):
   📦 Recibir · 🧾 Parte de hoy · ✔ Aprobar · 📍 Dónde está cada cosa. Cada uno sale solo con su permiso. */
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
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3500);
  }
  const ddmm = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : '');
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  const eur = (v) => (v == null ? '' : `${Number(v).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`);
  const cod = (txt, mat) => el('span', { class: `sv-cod${mat ? ' mat' : ''}` }, txt);
  const vacio = (txt) => el('p', { class: 'md-vacio' }, txt);

  // fotos: sube cada una al elegirla y guarda su id
  function fotos(texto) {
    const ids = [];
    const input = el('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true, multiple: '' });
    const minis = el('span', { class: 'md-minis' });
    const boton = el('button', { type: 'button', class: 'md-foto', onclick: () => input.click() }, texto);
    input.onchange = async () => {
      for (const f of [...input.files]) {
        try { ids.push(await window.s360.subirArchivo(f)); minis.append(f.type === 'application/pdf' ? el('span', { class: 'md-mini pdf' }, 'PDF') : el('img', { class: 'md-mini', src: URL.createObjectURL(f), alt: 'foto' })); }
        catch (e) { toast(e.message, true); }
      }
      input.value = '';
    };
    return { nodo: el('div', { class: 'cl-fotos' }, boton, input, minis), ids };
  }

  /* ---------- resumen para el menú ---------- */
  let res = {};
  let permisos = [];
  async function resumen() { try { res = await api('GET', '/api/supervision/resumen'); } catch { /* sin red: lo último */ } return res; }
  function opcionesMenu(ir) {
    const o = [];
    if (res.recibir) o.push(['📦', 'Recibir envíos', ir('recibir'), res.recibir.n ? `${res.recibir.n} por recibir${res.recibir.txt ? ` · ${res.recibir.txt}` : ''}` : res.recibir.en_camino ? `${res.recibir.en_camino} en camino` : 'Nada por recibir', !!res.recibir.n]);
    if (res.parte) {
      const p = res.parte; const n = (p.por_confirmar || 0) + (p.extra || 0);
      o.push(['🧾', 'Parte de hoy', ir('parte'), [n ? `${n} por confirmar` : 'Nada por confirmar', p.sin_apuntar ? `${p.sin_apuntar} sin apuntar` : null].filter(Boolean).join(' · '), !!n]);
    }
    if (res.aprobar) {
      const a = res.aprobar; const n = a.pedidos + a.vacaciones + a.locales;
      o.push(['✔', 'Aprobar', ir('aprobar'), n ? [a.pedidos ? `${a.pedidos} pedido(s)` : null, a.vacaciones ? `${a.vacaciones} vacaciones` : null, a.locales ? `${a.locales} compra(s) local(es)` : null].filter(Boolean).join(' · ') : 'Nada por aprobar', !!n]);
    }
    if (res.donde) o.push(['📍', 'Dónde está cada cosa', ir('donde'), res.donde.n ? `${res.donde.n} OT fuera${res.donde.retrasos ? ` · ⚠ ${res.donde.retrasos} retraso(s)` : ''}` : 'Nada fuera', !!res.donde.retrasos]);
    return o;
  }

  /* ---------- 📦 Recibir ---------- */
  async function cargarRecibir() {
    const d = await api('GET', '/api/supervision/recibir');
    const caja = $('#v-recibir');
    const tEnvio = (e) => {
      const marca = new Map(e.lineas.map((l) => [l.id, { recibido: !!l.recibido_en, bultos: l.bultos_recibidos ?? l.bultos ?? null }]));
      const alb = el('input', { type: 'text', maxlength: 60, placeholder: `Nº albarán ${e.transportista || ''}`.trim(), value: e.num_albaran || '', 'aria-label': 'Número de albarán' });
      const inc = el('input', { type: 'text', maxlength: 500, placeholder: '⚠ Falta algo o llega dañado (opcional)', 'aria-label': 'Incidencia' });
      const f = fotos('📷 Foto del albarán / bultos');
      const lineas = e.lineas.map((l) => {
        const m = marca.get(l.id);
        const bu = el('input', { type: 'number', min: 0, step: 1, inputmode: 'numeric', class: 'sv-bultos', value: m.bultos ?? '', disabled: !!l.recibido_en, 'aria-label': 'Bultos recibidos',
          oninput: (ev) => { m.bultos = ev.target.value === '' ? null : Number(ev.target.value); } });
        return el('label', { class: `sv-linea${l.recibido_en ? ' hecha' : ''}` },
          el('input', { type: 'checkbox', checked: m.recibido, disabled: !!l.recibido_en, onchange: (ev) => { m.recibido = ev.target.checked; } }),
          el('span', { class: 'sv-l-txt' }, l.ot_codigo ? cod(l.ot_codigo) : l.pedido_codigo ? cod(l.pedido_codigo, true) : null, ' ', l.ot_titulo || l.descripcion,
            el('small', {}, [l.origen ? `de ${l.origen}` : null, l.se_necesita ? `se necesita el ${ddmm(l.se_necesita)}` : null, l.recibido_en ? '✔ ya recibido' : null].filter(Boolean).join(' · '))),
          el('span', { class: 'sv-bu' }, bu, l.bultos ? `/${l.bultos}` : ''));
      });
      return el('li', { class: `sv-card ${e.estado === 'en_mao' ? 'az' : ''}` },
        el('div', { class: 'sv-cab' }, el('b', {}, `${e.codigo} · ${e.transportista || ''}`), el('span', { class: 'sv-est' }, e.estado === 'en_mao' ? `en Maó${e.fechas?.en_mao ? ` desde ${ddmm(e.fechas.en_mao)}` : ''}` : `en barco · llega ~${ddmm(e.llegada)}`)),
        el('small', {}, [e.entregar_en ? `Entregar en ${e.entregar_en}` : null, e.ref_transportista ? `ref. ${e.ref_transportista}` : null, e.n_archivos ? `CMR/fotos: ${e.n_archivos}` : null].filter(Boolean).join(' · ')),
        e.incidencia ? el('small', { class: 'sv-tarde' }, `⚠ ${e.incidencia}`) : null,
        lineas, alb, f.nodo, inc,
        el('button', { type: 'button', class: 'primario md-grande', onclick: async (ev) => {
          const sel = e.lineas.filter((l) => !l.recibido_en && marca.get(l.id).recibido).map((l) => ({ id: l.id, recibido: true, bultos: marca.get(l.id).bultos }));
          if (!sel.length && !inc.value.trim()) return toast('Marca lo que ha llegado', true);
          ev.currentTarget.disabled = true;
          try {
            const r = await api('POST', `/api/envios/${e.id}/recibir`, { lineas: sel, num_albaran: alb.value, archivos: f.ids, incidencia: inc.value });
            toast(r.offline ? 'Guardado sin conexión: se enviará al volver la cobertura' : r.completo ? `${e.codigo} recibido entero ✔` : 'Recibido lo marcado');
            await cargarRecibir();
          } catch (er) { toast(er.message, true); ev.target.disabled = false; }
        } }, '✔ Recibido lo marcado'));
    };
    const tPieza = (p) => {
      const nota = el('input', { type: 'text', maxlength: 300, placeholder: 'Nota (bultos, estado…)', 'aria-label': 'Nota' });
      const f = fotos('📷 Foto');
      return el('li', { class: 'sv-card' },
        el('div', { class: 'sv-cab' }, el('b', {}, cod(p.ot_codigo), ` ${p.ot_titulo}`), el('span', { class: 'sv-est' }, 'la trae el taller')),
        el('small', {}, [`${p.codigo} ${p.nombre} · ${p.taller}`, p.entrega_fecha ? `«entregado» ${ddmm(p.entrega_fecha)}` : null, p.entrega_nota, p.se_necesita ? `se necesita el ${ddmm(p.se_necesita)}` : null].filter(Boolean).join(' · ')),
        nota, f.nodo,
        el('button', { type: 'button', class: 'primario md-grande', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { const r = await api('POST', `/api/tareas/${p.id}/recibir-pieza`, { nota: nota.value, archivos: f.ids }); toast(r.offline ? 'Guardado sin conexión' : 'Recibido ✔'); await cargarRecibir(); }
          catch (er) { toast(er.message, true); ev.target.disabled = false; }
        } }, '✔ Recibido'));
    };
    const enMao = d.envios.filter((e) => e.estado === 'en_mao');
    const enBarco = d.envios.filter((e) => e.estado !== 'en_mao');
    caja.replaceChildren(...[
      el('section', { class: 'md-bloque' }, el('h2', {}, '📦 Por recibir'),
        enMao.length || d.piezas.length ? el('ul', { class: 'md-lista sv-lista' }, enMao.map(tEnvio), d.piezas.map(tPieza)) : vacio('Nada esperando en Maó ni piezas de talleres.')),
      enBarco.length ? el('section', { class: 'md-bloque' }, el('h2', {}, '🚢 En camino'), el('ul', { class: 'md-lista sv-lista' }, enBarco.map(tEnvio))) : null,
    ].filter(Boolean));
  }

  /* ---------- 🧾 Parte de hoy ---------- */
  const EST = { hecho: 'hecho', parcial: 'en parte', no: 'no lo hizo' };
  let parteTab = 'confirmar';
  async function cargarParte() {
    const d = await api('GET', `/api/parte?fecha=${new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })}`);
    const caja = $('#v-parte');
    const pend = d.tramos.filter((tr) => !tr.cierre && tr.propuesta);
    const confirmados = d.tramos.filter((tr) => tr.cierre);
    const sinApuntar = d.envios.filter((o) => !o.apuntados);
    const confirmar = async (tr, boton) => {
      let progreso = null;
      if (tr.propuesta.accion !== 'no_hecho' && tr.propuesta.terminada) {
        const quitar = tr.despues?.length ? confirm(`La tarea queda terminada. ¿Quitar los ${tr.despues.length} tramo(s) que tenía planificados después?`) : false;
        progreso = { terminada: true, quitar_futuros: quitar };
      }
      const pr = tr.propuesta;
      const cuerpo = pr.accion === 'no_hecho' ? { accion: 'no_hecho', motivo: pr.motivo, notas: pr.notas } : { accion: pr.accion, registros: pr.registros, motivo: pr.motivo, notas: pr.notas, progreso };
      if (boton) boton.disabled = true;
      await api('POST', `/api/tramos/${tr.id}/cierre`, cuerpo);
    };
    const tarjeta = (tr) => {
      const decl = (tr.declaraciones || []).filter((x) => !x.resuelto);
      const avisos = tr.propuesta?.avisos || [];
      return el('li', { class: `sv-card${avisos.length ? ' am' : ''}` },
        el('div', { class: 'sv-cab' }, el('b', {}, cod(tr.orden_codigo), ` ${tr.tarea}`), el('span', { class: 'sv-est' }, `${hhmm(tr.hora_inicio)}–${hhmm(tr.hora_inicio + tr.duracion_h)}`)),
        el('small', {}, [tr.area, tr.orden_titulo].filter(Boolean).join(' · ')),
        el('ul', { class: 'sv-decl' }, decl.map((x) => el('li', {}, el('b', {}, x.recurso), ': ', EST[x.estado] || x.estado,
          x.estado === 'parcial' ? ` ${hhmm(x.desde)}–${hhmm(x.hasta)}` : '',
          x.estado !== 'no' && x.terminada === true ? ' · terminada' : x.estado !== 'no' && x.terminada === false ? ' · sigue' : '',
          x.motivo ? ` · ${d.motivos[x.motivo] || x.motivo}` : '', x.notas ? ` «${x.notas}»` : ''))),
        avisos.length ? el('ul', { class: 'sv-avisos' }, avisos.map((a) => el('li', {}, `⚠ ${a}`))) : null,
        tr.cierre ? el('small', { class: 'sv-ok' }, '✔ confirmado') : el('div', { class: 'cl-botones' },
          el('button', { type: 'button', class: 'si', onclick: async (ev) => {
            try { await confirmar(tr, ev.currentTarget); toast('Confirmado'); await cargarParte(); } catch (er) { toast(er.message, true); ev.target.disabled = false; }
          } }, '✔ Confirmar'),
          el('a', { class: 'no sv-pc', href: `/parte.html?fecha=${d.fecha}` }, '✎ En el ordenador')));
    };
    const extra = d.declarado_extra.map((x) => el('li', { class: 'sv-card' },
      el('div', { class: 'sv-cab' }, el('b', {}, x.recurso || ''), el('span', { class: 'sv-est' }, `${hhmm(x.desde)}–${hhmm(x.hasta)}`)),
      el('small', {}, `Fuera del plan: ${x.tarea ? `${x.orden_codigo || ''} ${x.tarea}` : d.no_productivo?.[x.tipo] || x.tipo}${x.notas ? ` · «${x.notas}»` : ''}`),
      el('div', { class: 'cl-botones' },
        el('button', { type: 'button', class: 'si', onclick: async () => { try { await api('POST', `/api/declaraciones/${x.id}/aceptar`); toast('Aceptado'); cargarParte(); } catch (er) { toast(er.message, true); } } }, '✔ Aceptar'),
        el('button', { type: 'button', class: 'no', onclick: async () => { try { await api('POST', `/api/declaraciones/${x.id}/descartar`); toast('Descartado'); cargarParte(); } catch (er) { toast(er.message, true); } } }, '✗ Descartar'))));
    const limpios = pend.filter((tr) => !tr.propuesta.avisos.length);
    const tabs = [['confirmar', `Por confirmar ${pend.length + d.declarado_extra.length}`], ['hecho', `Confirmado ${confirmados.length}`], ['sin', `Sin apuntar ${sinApuntar.length}`]];
    let cuerpo;
    if (parteTab === 'confirmar') {
      cuerpo = pend.length || extra.length ? [
        el('ul', { class: 'md-lista sv-lista' }, pend.map(tarjeta), extra),
        limpios.length + d.declarado_extra.length ? el('button', { type: 'button', class: 'primario md-grande', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          let n = 0;
          for (const tr of limpios) { try { await confirmar(tr); n++; } catch (er) { toast(er.message, true); } }
          for (const x of d.declarado_extra) { try { await api('POST', `/api/declaraciones/${x.id}/aceptar`); n++; } catch (er) { toast(er.message, true); } }
          toast(`${n} confirmado(s)`); cargarParte();
        } }, `✔ Confirmar todo lo que no tiene avisos (${limpios.length + d.declarado_extra.length})`) : null] : vacio('Nada por confirmar.');
    } else if (parteTab === 'hecho') {
      cuerpo = confirmados.length ? el('ul', { class: 'md-lista sv-lista' }, confirmados.map(tarjeta)) : vacio('Aún no hay nada confirmado hoy.');
    } else {
      cuerpo = sinApuntar.length ? el('ul', { class: 'md-lista sv-lista' }, sinApuntar.map((o) => el('li', { class: 'sv-card ro' },
        el('div', { class: 'sv-cab' }, el('b', {}, o.nombre), el('span', { class: 'sv-est' }, 'sin apuntar')),
        el('small', {}, `${o.tramos} trabajo(s) planificado(s) hoy`)))) : vacio('Todos han apuntado algo.');
    }
    caja.replaceChildren(
      el('section', { class: 'md-bloque' },
        el('h2', {}, `🧾 Parte · ${d.cerrado ? '🔒 día cerrado' : 'hoy'}`),
        el('div', { class: 'cl-chips sv-tabs', role: 'tablist' }, tabs.map(([k, t]) => el('button', { type: 'button', role: 'tab', class: parteTab === k ? 'on' : null, 'aria-selected': parteTab === k ? 'true' : 'false', onclick: () => { parteTab = k; cargarParte(); } }, t))),
        cuerpo,
        el('p', { class: 'ayuda' }, 'Corregir horas a mano, «no se hizo» y cerrar el día siguen en el ordenador (Parte).')));
  }

  /* ---------- ✔ Aprobar ---------- */
  async function cargarAprobar() {
    const p = permisos;
    const tiene = (k) => p.includes(k);
    const [ped, vac, loc] = await Promise.all([
      tiene('aprobar_compras') ? api('GET', '/api/compras/pedidos?estado=por_aprobar').catch(() => null) : null,
      tiene('vacaciones_ops') || tiene('vacaciones_rrhh') ? api('GET', '/api/solicitudes-vacaciones').catch(() => null) : null,
      tiene('autorizar_compras_locales') ? api('GET', '/api/compras-locales?vista=autorizar').catch(() => null) : null,
    ]);
    const caja = $('#v-aprobar');
    const decide = (url, cuerpoSi, cuerpoNo, pideMotivo) => [
      el('button', { type: 'button', class: 'si', onclick: async (ev) => {
        ev.currentTarget.disabled = true;
        try { const r = await api('POST', url.si, cuerpoSi()); toast(r.offline ? 'Guardado sin conexión' : 'Hecho ✔'); cargarAprobar(); } catch (er) { toast(er.message, true); ev.target.disabled = false; }
      } }, '✔ Aprobar'),
      el('button', { type: 'button', class: 'no', onclick: async () => {
        const m = prompt(pideMotivo); if (!m) return;
        try { const r = await api('POST', url.no, cuerpoNo(m)); toast(r.offline ? 'Guardado sin conexión' : 'Hecho'); cargarAprobar(); } catch (er) { toast(er.message, true); }
      } }, '✗ No')];
    const pedidos = (ped?.pedidos || []).filter((x) => x.estado === 'por_aprobar');
    const vacs = (vac?.solicitudes || []).filter((s) => (s.estado === 'pendiente_ops' && vac.puedo.ops) || (s.estado === 'pendiente_rrhh' && vac.puedo.rrhh));
    const locs = loc?.compras || [];
    caja.replaceChildren(el('section', { class: 'md-bloque' }, el('h2', {}, '✔ Aprobar'),
      !pedidos.length && !vacs.length && !locs.length ? vacio('✔ Nada por aprobar.') : null,
      el('ul', { class: 'md-lista sv-lista' },
        pedidos.map((x) => el('li', { class: 'sv-card' },
          el('div', { class: 'sv-cab' }, el('b', {}, `Pedido ${x.codigo}`), el('span', { class: 'sv-est' }, eur(x.total))),
          el('small', {}, [x.proveedor, x.proyectos, x.referencia, x.creado_por_nombre ? `preparó: ${x.creado_por_nombre}` : null].filter(Boolean).join(' · ')),
          el('a', { class: 'ayuda', href: `/compras.html?pedido=${x.id}` }, 'Ver líneas ↗'),
          el('div', { class: 'cl-botones' }, decide({ si: `/api/compras/pedidos/${x.id}/aprobar`, no: `/api/compras/pedidos/${x.id}/rechazar` }, () => ({}), (m) => ({ motivo: m }), 'Motivo (lo verá quien lo preparó)')))),
        vacs.map((s) => el('li', { class: 'sv-card' },
          el('div', { class: 'sv-cab' }, el('b', {}, `Vacaciones · ${s.recurso}`), el('span', { class: 'sv-est' }, `${ddmm(s.desde)}–${ddmm(s.hasta)} · ${s.dias} días`)),
          el('small', {}, [`${s.estado === 'pendiente_ops' ? 'paso de Operaciones' : 'paso de RRHH'}`, s.quedan != null ? `le quedan ${s.quedan}` : null, s.notas ? `«${s.notas}»` : null].filter(Boolean).join(' · ')),
          (s.avisos || []).length ? el('ul', { class: 'sv-avisos' }, s.avisos.map((a) => el('li', {}, `⚠ ${a}`))) : null,
          el('div', { class: 'cl-botones' }, decide({ si: `/api/solicitudes-vacaciones/${s.id}`, no: `/api/solicitudes-vacaciones/${s.id}` }, () => ({ decision: 'aprobar' }), (m) => ({ decision: 'rechazar', nota: m }), 'Motivo (lo verá el operario)')))),
        locs.map((c) => el('li', { class: 'sv-card' },
          el('div', { class: 'sv-cab' }, el('b', {}, `Compra local · ${c.usuario_nombre || ''}`), el('span', { class: 'sv-est' }, c.importe_aprox != null ? `≈ ${eur(c.importe_aprox)}` : '')),
          el('div', {}, c.que),
          el('small', {}, [c.tienda_nombre, c.tarea_codigo ? `${c.tarea_codigo} ${c.tarea_nombre}` : null, c.para === 'manana' ? 'para mañana' : 'para ahora'].filter(Boolean).join(' · ')),
          el('div', { class: 'cl-botones' }, decide({ si: `/api/compras-locales/${c.id}/decidir`, no: `/api/compras-locales/${c.id}/decidir` }, () => ({ decision: 'si' }), (m) => ({ decision: 'no', nota: m }), 'Motivo (lo verá quien la pidió)')))))));
  }

  /* ---------- 📍 Dónde está cada cosa ---------- */
  async function cargarDonde() {
    const d = await api('GET', '/api/supervision/donde');
    const caja = $('#v-donde');
    caja.replaceChildren(el('section', { class: 'md-bloque' }, el('h2', {}, '📍 Dónde está cada cosa'),
      d.ots.length ? el('ul', { class: 'md-lista sv-lista' }, d.ots.map((o) => {
        const s = o.situacion;
        const tarde = s.retraso && o.aqui && s.retraso.fecha >= o.aqui;
        const tardeEnvio = s.envio?.llegada && o.aqui && s.envio.llegada > o.aqui && s.envio.estado !== 'en_mao';
        return el('li', { class: `sv-card${s.retraso || tardeEnvio ? ' ro' : s.envio ? ' az' : ''}` },
          el('div', { class: 'sv-cab' }, el('b', {}, cod(o.codigo), ` ${o.titulo}`)),
          el('small', {}, s.texto),
          el('small', {}, [o.obra, o.aqui ? `se necesita aquí el ${ddmm(o.aqui)}` : null].filter(Boolean).join(' · ')),
          tardeEnvio ? el('small', { class: 'sv-tarde' }, `⚠ el envío llega ~${ddmm(s.envio.llegada)}: tarde para el ${ddmm(o.aqui)}`) : null,
          tarde ? el('small', { class: 'sv-tarde' }, `⚠ el taller acaba el ${ddmm(s.retraso.fecha)}: no llega para el ${ddmm(o.aqui)}`) : null,
          el('a', { class: 'ayuda', href: `/proyectos.html?ot=${o.id}` }, 'Ver la OT ↗'));
      })) : vacio('No hay nada fuera.')));
  }

  const cargar = { recibir: cargarRecibir, parte: cargarParte, aprobar: cargarAprobar, donde: cargarDonde };
  window.addEventListener('planealo:sincronizado', () => { for (const [k, f] of Object.entries(cargar)) if (!$(`#v-${k}`)?.hidden) f().catch(() => {}); });
  function iniciar(p) { permisos = p || []; return resumen(); }
  window.midiaSuper = { iniciar, resumen, opcionesMenu, cargar: (v) => cargar[v]?.() };
})();
