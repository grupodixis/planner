/* Logística y compras: el material que el técnico ha enviado.
   Logística dice cuánto hay en stock → lo que falta queda «por pedir» → compras lo pide → logística lo recibe. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { api } = window.s360;
  const { el, toast, cant, chipEstado, ddmm } = window.s360mat;
  const q = new URLSearchParams(location.search);
  let d = null, puede = {};
  let vista = q.get('vista') || null;
  const VISTAS = [
    ['revisar', '📦 Revisar stock', 'sin_revisar'],
    ['comprar', '🛒 Por pedir', 'por_pedir'],
    ['recibir', '🚚 Pedido · por recibir', 'pedido'],
    ['disponible', '✔ Disponible', 'disponible'],
    ['todo', 'Todo', null],
  ];
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const fecha = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }) : '');
  const hoy = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10);

  async function cargar() {
    d = await api('GET', '/api/material/circuito');
    const partidas = new Map(d.lineas.map((l) => [l.partida_id, `${l.proyecto_codigo} · ${l.partida_codigo ? `${l.partida_codigo} ` : ''}${l.partida_nombre}`]));
    const sel = $('#f-partida');
    const actual = sel.value || q.get('partida') || '';
    sel.replaceChildren(el('option', { value: '' }, 'Todas las partidas'), ...[...partidas].map(([id, t]) => el('option', { value: id }, t)));
    sel.value = partidas.has(Number(actual)) ? actual : '';
    pintar();
  }

  function pintar() {
    $('#tabs').replaceChildren(...VISTAS.map(([k, txt]) => el('button', {
      type: 'button', role: 'tab', class: 'llv-tab', 'aria-selected': String(k === vista),
      onclick: () => { vista = k; history.replaceState(null, '', `?vista=${k}`); pintar(); },
    }, txt, d.cuentas[k] ? el('span', { class: `llv-n${['revisar', 'comprar', 'recibir'].includes(k) ? ' aviso' : ''}` }, String(d.cuentas[k])) : null)));
    const est = VISTAS.find((v) => v[0] === vista)?.[2];
    const txt = norm($('#buscar').value);
    const pa = Number($('#f-partida').value) || null;
    const ls = d.lineas.filter((l) => (!est || l.estado === est) && (!pa || l.partida_id === pa)
      && (!txt || norm(`${l.descripcion} ${l.proyecto_codigo} ${l.proyecto_nombre} ${l.partida_nombre} ${l.proveedor || ''}`).includes(txt)));
    // por partida, y dentro lo que hace falta antes
    const grupos = new Map();
    for (const l of ls) { if (!grupos.has(l.partida_id)) grupos.set(l.partida_id, []); grupos.get(l.partida_id).push(l); }
    const orden = [...grupos.values()].sort((a, b) => String(a[0].fecha_necesaria || '9').localeCompare(String(b[0].fecha_necesaria || '9')));
    $('#lista').replaceChildren(...(orden.length ? orden.map((g) => {
      const l0 = g[0];
      return el('section', { class: 'log-partida' },
        el('h3', {}, el('span', {}, `${l0.proyecto_codigo} · ${l0.partida_codigo ? `${l0.partida_codigo} · ` : ''}${l0.partida_nombre}`),
          el('span', { class: 'ayuda' }, l0.fecha_necesaria ? ` hace falta ${fecha(l0.fecha_necesaria)}` : ' sin planificar')),
        el('p', { class: 'ayuda log-proy' }, l0.proyecto_nombre),
        ...g.map(tarjeta));
    }) : [el('p', { class: 'vacio-grande' }, vista === 'revisar' ? 'Nada por revisar.' : vista === 'comprar' ? 'Nada por pedir.' : vista === 'recibir' ? 'Nada pendiente de llegar.' : 'Nada.')]));
  }

  function tarjeta(l) {
    const tarde = l.fecha_necesaria && l.fecha_necesaria < hoy && l.estado !== 'disponible';
    return el('div', { class: `log-linea est-${l.estado}` },
      el('div', { class: 'log-l1' },
        el('span', { class: 'log-desc' }, el('b', {}, l.descripcion)),
        chipEstado(l)),
      el('div', { class: 'log-l2 ayuda' },
        `Necesita ${cant(l.cantidad)} ${l.unidad || ''}`,
        l.stock != null ? ` · hay ${cant(l.stock)}` : '',
        l.falta ? el('b', { class: 'log-falta' }, ` · faltan ${cant(l.falta)}`) : '',
        l.fecha_necesaria ? el('span', { class: tarde ? 'neg' : '' }, ` · para el ${fecha(l.fecha_necesaria)}`) : '',
        l.tareas.length ? ` · ${l.tareas.map((t) => t.tarea).join(', ')}` : '',
        l.nota ? ` · ${l.nota}` : ''),
      (l.compra === 'pedido' || l.compra === 'recibido' || l.stock_por || l.nota_logistica) ? el('div', { class: 'log-l2 ayuda' },
        [l.stock_por && `Revisado por ${l.stock_por}`,
          l.compra === 'pedido' && `Pedido${l.proveedor ? ` a ${l.proveedor}` : ''}${l.fecha_prevista ? `, llega el ${fecha(l.fecha_prevista)}` : ''}${l.pedido_por ? ` (${l.pedido_por})` : ''}`,
          l.compra === 'recibido' && `Recibido${l.recibido_por ? ` por ${l.recibido_por}` : ''}${l.recibido_en ? ` el ${fecha(l.recibido_en)}` : ''}`,
          l.nota_logistica && `Nota: ${l.nota_logistica}`].filter(Boolean).join(' · ')) : null,
      // incidencias (desde el móvil: llegó una parte, dañado…): se ven hasta que alguien las da por resueltas
      (l.incidencias || []).length ? el('ul', { class: 'log-incs' }, l.incidencias.map((i) => el('li', { class: i.resuelta_en ? 'resuelta' : '' },
        el('span', {}, i.resuelta_en ? '✔ ' : '⚠ ', i.texto, el('span', { class: 'ayuda' }, ` · ${i.por || ''} ${fecha(i.creado)}${i.resuelta_en ? ` · resuelta${i.resuelta_por ? ` por ${i.resuelta_por}` : ''}` : ''}`)),
        el('button', { type: 'button', class: 'ghost mini', onclick: async () => {
          try { await api('PUT', `/api/escandallo-incidencias/${i.id}/resolver`, i.resuelta_en ? { deshacer: true } : {}); toast(i.resuelta_en ? 'Reabierta' : 'Incidencia resuelta'); await cargar(); }
          catch (e) { toast(e.message, true); }
        } }, i.resuelta_en ? 'Reabrir' : '✔ Resuelta')))) : null,
      // fotos y enlaces: los del técnico se ven; logística puede añadir fotos con la cámara o de la galería
      window.s360mat.adjuntosLinea(l, { subir: puede.logistica || puede.compras, camara: true }),
      acciones(l));
  }

  function acciones(l) {
    const out = [];
    const hecho = async (url, cuerpo, msg) => {
      try { await api('PUT', url, cuerpo); toast(msg); await cargar(); } catch (e) { toast(e.message, true); }
    };
    // logística: stock (también para corregir)
    if (puede.logistica && (l.estado === 'sin_revisar' || l.estado === 'por_pedir' || (l.estado === 'disponible' && l.compra !== 'recibido'))) {
      const inp = el('input', { inputmode: 'decimal', value: l.stock != null ? cant(l.stock) : '', placeholder: '¿cuánto?', 'aria-label': `Cuánto hay de ${l.descripcion}` });
      const guardar = () => hecho(`/api/escandallo/${l.id}/stock`, { stock: inp.value }, 'Apuntado');
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); guardar(); } });
      out.push(el('div', { class: 'log-acc' },
        el('button', { type: 'button', class: l.stock === 0 ? 'sel no' : '', onclick: () => hecho(`/api/escandallo/${l.id}/stock`, { stock: 0 }, 'Apuntado: no hay; avisado a compras') }, 'No hay'),
        el('button', { type: 'button', class: l.stock != null && l.stock >= l.cantidad ? 'sel' : '', onclick: () => hecho(`/api/escandallo/${l.id}/stock`, { stock: l.cantidad }, 'Apuntado: hay todo') }, 'Hay todo'),
        el('span', { class: 'log-hay' }, 'Hay ', inp, ` ${l.unidad || ''} `, el('button', { type: 'button', class: 'primario mini', onclick: guardar }, '✓'))));
    }
    // compras: pedir
    if (puede.compras && l.estado === 'por_pedir') {
      const prov = el('select', { 'aria-label': 'Proveedor' }, el('option', { value: '' }, 'Proveedor…'),
        d.proveedores.map((p) => el('option', { value: p.id }, p.nombre)));
      const f = el('input', { type: 'date', 'aria-label': 'Llega el', min: hoy });
      out.push(el('div', { class: 'log-acc' },
        prov, el('label', { class: 'ayuda' }, 'llega ', f),
        el('button', { type: 'button', class: 'primario', onclick: () => hecho(`/api/escandallo/${l.id}/compra`, { estado: 'pedido', proveedor_id: prov.value || null, fecha_prevista: f.value || null }, 'Marcado como pedido; avisado a logística y técnico') }, '🛒 Pedido')));
    }
    if (puede.compras && l.estado === 'pedido') {
      out.push(el('div', { class: 'log-acc' }, el('button', { type: 'button', class: 'ghost mini', onclick: () => hecho(`/api/escandallo/${l.id}/compra`, { estado: 'por_pedir' }, 'Vuelve a «por pedir»') }, 'Deshacer pedido')));
    }
    // logística: recibir
    if (puede.logistica && (l.estado === 'pedido' || (l.estado === 'por_pedir' && vista === 'recibir'))) {
      out.push(el('div', { class: 'log-acc' }, el('button', { type: 'button', class: 'primario', onclick: () => hecho(`/api/escandallo/${l.id}/recibir`, {}, 'Recibido; avisado a los operarios de la tarea') }, '✔ Recibido')));
    }
    if (puede.logistica && l.compra === 'recibido') {
      out.push(el('div', { class: 'log-acc' }, el('button', { type: 'button', class: 'ghost mini', onclick: () => hecho(`/api/escandallo/${l.id}/recibir`, { deshacer: true }, 'Deshecho: vuelve a «pedido»') }, 'Deshacer recepción')));
    }
    return out.length ? out : null;
  }

  async function init() {
    const yo = await api('GET', '/api/me');
    window.s360.iniciar(yo);
    puede = { logistica: window.s360.tiene('logistica'), compras: window.s360.tiene('compras') };
    if (!vista) vista = puede.logistica ? 'revisar' : puede.compras ? 'comprar' : 'todo';
    $('#buscar').addEventListener('input', pintar);
    $('#f-partida').addEventListener('change', pintar);
    await cargar();
    window.s360.alCambiar(cargar);
  }
  init().catch((e) => toast(e.message, true));
})();
