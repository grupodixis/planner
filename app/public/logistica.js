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
  let abiertas = {};
  try { abiertas = JSON.parse(localStorage.getItem('log-acordeon') || '{}') || {}; } catch { abiertas = {}; }
  const guardarAbiertas = () => { try { localStorage.setItem('log-acordeon', JSON.stringify(abiertas)); } catch { /* sin almacenamiento */ } };
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
      type: 'button', role: 'tab', class: 'llv-tab', 'aria-selected': String(k === vista), 'data-ayuda': `log-pestana-${k}`,
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
    // acordeón por partida: se recuerda qué está abierto; con una sola partida (o buscando) va abierta
    const forzar = orden.length === 1 || !!txt || !!pa;
    const abierta = (id) => forzar || abiertas[id] === true;
    const grupoEl = (g) => {
      const l0 = g[0];
      const nTarde = g.filter((l) => l.fecha_necesaria && l.fecha_necesaria < hoy && l.estado !== 'disponible').length;
      const nFalta = g.filter((l) => l.falta).length;
      const det = el('details', { class: 'log-partida' },
        el('summary', { 'data-ayuda': 'log-partida' },
          el('span', { class: 'log-sum-tit' },
            el('b', {}, `${l0.proyecto_codigo} · ${l0.partida_codigo ? `${l0.partida_codigo} · ` : ''}${l0.partida_nombre}`),
            el('small', { class: 'ayuda' }, l0.proyecto_nombre)),
          el('span', { class: 'log-sum-info' },
            el('span', { class: 'llv-n' }, `${g.length} ${g.length === 1 ? 'línea' : 'líneas'}`),
            nFalta ? el('span', { class: 'llv-n aviso' }, `${nFalta} con falta`) : null,
            nTarde ? el('span', { class: 'llv-n aviso neg' }, `${nTarde} tarde`) : null,
            el('span', { class: 'ayuda' }, l0.fecha_necesaria ? `hace falta ${fecha(l0.fecha_necesaria)}` : 'sin planificar'))),
        el('div', { class: 'log-partida-cuerpo' }, ...g.map(tarjeta)));
      det.open = abierta(l0.partida_id);
      det.addEventListener('toggle', () => { if (forzar) return; abiertas[l0.partida_id] = det.open; guardarAbiertas(); });
      return det;
    };
    const todas = (v) => { for (const g of orden) abiertas[g[0].partida_id] = v; guardarAbiertas(); pintar(); };
    $('#lista').replaceChildren(...(orden.length ? [
      orden.length > 1 && !forzar ? el('div', { class: 'log-acc-barra', 'data-ayuda': 'log-acc-barra' },
        el('span', { class: 'ayuda' }, `${orden.length} partidas`),
        el('button', { type: 'button', class: 'ghost', onclick: () => todas(true) }, 'Abrir todas'),
        el('button', { type: 'button', class: 'ghost', onclick: () => todas(false) }, 'Cerrar todas')) : null,
      ...orden.map(grupoEl), el('div', { id: 'barra-pedido' })].filter(Boolean)
      : [el('p', { class: 'vacio-grande' }, vista === 'revisar' ? 'Nada por revisar.' : vista === 'comprar' ? 'Nada por pedir.' : vista === 'recibir' ? 'Nada pendiente de llegar.' : 'Nada.')]));
    barraPedido();
  }

  // líneas marcadas para un pedido de compra: barra abajo con el proveedor y «Crear pedido»
  const marcadas = new Set();
  let provBarra = null;   // proveedor elegido en la barra azul (se mantiene al repintar y sale marcado en «Pedir precio»)
  function barraPedido() {
    const caja = $('#barra-pedido');
    if (!caja) return;
    for (const id of [...marcadas]) if (!d.lineas.some((l) => l.id === id && l.estado === 'por_pedir' && !l.pedido_compra && !l.solicitud)) marcadas.delete(id);
    if (!marcadas.size) { caja.replaceChildren(); caja.className = ''; return; }
    const prov = el('select', { 'aria-label': 'Proveedor del pedido', onchange: (ev) => { provBarra = Number(ev.target.value) || null; } },
      el('option', { value: '' }, 'Proveedor (se puede elegir después)…'),
      d.proveedores.map((p) => el('option', { value: p.id, selected: p.id === provBarra }, p.nombre)));
    caja.className = 'log-barra-pedido';
    caja.replaceChildren(el('b', {}, `${marcadas.size} línea${marcadas.size === 1 ? '' : 's'} marcada${marcadas.size === 1 ? '' : 's'}`), prov,
      el('button', { type: 'button', class: 'primario', onclick: async () => {
        try {
          const p = await api('POST', '/api/compras/pedidos', { proveedor_id: prov.value || null, escandallo_ids: [...marcadas] });
          location.href = `/compras.html?pedido=${p.id}`;
        } catch (e) { toast(e.message, true); }
      } }, '🛒 Crear pedido de compra'),
      el('button', { type: 'button', class: 'ghost', onclick: dialogoPedirPrecio }, '✉ Pedir precio…'),
      el('button', { type: 'button', class: 'ghost mini', onclick: () => { marcadas.clear(); pintar(); } }, 'Desmarcar'));
  }

  // pedir precio de las líneas marcadas a varios proveedores (sugeridos por lo que sirven)
  // el proveedor elegido en la barra azul sale ya marcado y el primero
  function dialogoPedirPrecio() {
    const ls = d.lineas.filter((l) => marcadas.has(l.id));
    const texto = norm(ls.map((l) => l.descripcion).join(' '));
    // palabras de «lo que sirve» de cada proveedor que aparecen en el material (inox, tubo, tornillo…)
    const sugerido = (p) => (p.materiales || []).some((m) => norm(m).split(/[^a-z0-9]+/).some((w) => w.length >= 4 && texto.includes(w.replace(/s$/, ''))));
    const provs = [...d.proveedores].sort((a, b) => Number(b.id === provBarra) - Number(a.id === provBarra)
      || Number(sugerido(b)) - Number(sugerido(a)) || a.nombre.localeCompare(b.nombre));
    const elegidos = new Set(provBarra && d.proveedores.some((p) => p.id === provBarra) ? [provBarra] : []);
    const necesaria = ls.map((l) => l.fecha_necesaria).filter(Boolean).sort()[0] || '';
    const resp = el('input', { type: 'date', min: hoy, 'aria-label': 'Responder antes del' });
    const nec = el('input', { type: 'date', value: necesaria, 'aria-label': 'Lo necesitamos el' });
    const ul = el('ul', { class: 'log-provs-elegir' }, provs.map((p) => el('li', {}, el('label', {},
      el('input', { type: 'checkbox', checked: elegidos.has(p.id), onchange: (ev) => (ev.target.checked ? elegidos.add(p.id) : elegidos.delete(p.id)) }),
      ` ${p.nombre}`, sugerido(p) ? el('span', { class: 'chip-sug' }, 'sirve esto') : null,
      el('small', { class: 'ayuda' }, ` ${(p.materiales || []).slice(0, 3).join(', ')}`)))));
    const dlg = el('dialog', { class: 'dlg-cos' },
      el('h2', {}, `Pedir precio · ${ls.length} línea${ls.length === 1 ? '' : 's'}`),
      el('p', { class: 'ayuda' }, ls.map((l) => l.descripcion).join(' · ')),
      el('h3', {}, 'A quién'), ul,
      el('div', { class: 'cmp-campos' }, el('label', { class: 'cmp-campo' }, el('span', {}, 'Responder antes del'), resp), el('label', { class: 'cmp-campo' }, el('span', {}, 'Lo necesitamos el'), nec)),
      el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          if (!elegidos.size) { toast('Elige al menos un proveedor', true); return; }
          try {
            const s = await api('POST', '/api/compras/solicitudes', { escandallo_ids: [...marcadas], proveedor_ids: [...elegidos], responder_antes: resp.value, necesario_el: nec.value });
            location.href = `/compras.html?vista=precios&sol=${s.id}`;
          } catch (e) { toast(e.message, true); }
        } }, 'Crear petición de precio')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  function tarjeta(l) {
    const tarde = l.fecha_necesaria && l.fecha_necesaria < hoy && l.estado !== 'disponible';
    return el('div', { class: `log-linea est-${l.estado}`, 'data-ayuda': 'log-linea' },
      el('div', { class: 'log-l1' },
        el('span', { class: 'log-desc' }, el('b', {}, l.descripcion),
          l.baja_presupuesto ? el('span', { class: 'mat-baja', title: 'Ya no viene en el presupuesto (reimportación)' }, ' · fuera de presupuesto') : null),
        chipEstado(l)),
      el('div', { class: 'log-l2 ayuda' },
        `Necesita ${cant(l.cantidad)} ${l.unidad || ''}`,
        l.stock != null ? ` · hay ${cant(l.stock)}` : '',
        l.falta ? el('b', { class: 'log-falta' }, ` · faltan ${cant(l.falta)}`) : '',
        l.fecha_necesaria ? el('span', { class: tarde ? 'neg' : '' }, ` · para el ${fecha(l.fecha_necesaria)}`) : '',

        l.nota ? ` · ${l.nota}` : ''),
      // tareas de la OT que usan este material: enlace a la tarea en Proyectos y OTs
      l.tareas.length ? el('ul', { class: 'log-tareas', 'aria-label': 'Tareas que lo usan' }, l.tareas.map((t) => el('li', {},
        el('a', { href: `/proyectos.html?p=${t.proyecto_id}&ot=${t.ot_id}&tarea=${t.tarea_id}`, title: 'Ver la tarea en su OT' },
          el('b', {}, t.ot), ` · ${t.tarea}`),
        el('span', { class: 'ayuda' }, ` · ${cant(t.cantidad)} ${l.unidad || ''}${t.fecha ? ` · ${fecha(t.fecha)}` : ' · sin planificar'}`))))
        : el('p', { class: 'log-tareas sin ayuda' }, 'Sin asignar a ninguna tarea todavía'),
      (l.compra === 'pedido' || l.compra === 'recibido' || l.stock_por || l.nota_logistica) ? el('div', { class: 'log-l2 ayuda' },
        [l.stock_por && `Revisado por ${l.stock_por}`,
          l.compra === 'pedido' && `Pedido${l.num_pedido ? ` nº ${l.num_pedido}` : ''}${l.proveedor ? ` a ${l.proveedor}` : ''}${l.fecha_prevista ? `, llega el ${fecha(l.fecha_prevista)}` : ''}${l.pedido_por ? ` (${l.pedido_por})` : ''}`,
          l.compra === 'recibido' && `Recibido${l.recibido_por ? ` por ${l.recibido_por}` : ''}${l.recibido_en ? ` el ${fecha(l.recibido_en)}` : ''}${l.num_pedido ? ` · pedido nº ${l.num_pedido}` : ''}${l.num_albaran ? ` · albarán nº ${l.num_albaran}` : ''}`,
          l.nota_logistica && `Nota: ${l.nota_logistica}`].filter(Boolean).join(' · ')) : null,
      // incidencias (desde el móvil: llegó una parte, dañado…): se ven hasta que alguien las da por resueltas
      (l.incidencias || []).length ? el('ul', { class: 'log-incs' }, l.incidencias.map((i) => {
        const hecha = ['resuelta', 'cerrada'].includes(i.estado);
        const EST = { abierta: 'abierta', en_curso: 'en curso', esperando: 'esperando al proveedor', resuelta: 'resuelta', cerrada: 'cerrada' };
        return el('li', { class: hecha ? 'resuelta' : '' },
          el('span', {}, hecha ? '✔ ' : '⚠ ', el('a', { href: `/incidencias.html?id=${i.id}`, class: 'inc-cod-link', title: 'Abrir la incidencia: reclamar al proveedor, resolver, cerrar' }, i.codigo || 'incidencia'), ` ${i.texto}`,
            el('span', { class: 'ayuda' }, ` · ${EST[i.estado] || ''} · ${i.por || ''} ${fecha(i.creado)}`)),
          el('a', { class: 'boton ghost mini', href: `/incidencias.html?id=${i.id}` }, hecha ? 'Ver' : 'Gestionar →'));
      })) : null,
      // fotos y enlaces: los del técnico se ven; logística puede añadir fotos con la cámara o de la galería
      window.s360mat.adjuntosLinea(l, { subir: puede.logistica || puede.compras, camara: true }),
      acciones(l));
  }

  function acciones(l) {
    const out = [];
    const hecho = async (url, cuerpo, msg) => {
      try { await api('PUT', url, cuerpo); toast(msg); await cargar(); } catch (e) { toast(e.message, true); }
    };
    // documento (pedido / albarán) en PDF o foto: se sube al elegirlo y se enlaza al guardar
    const adjDoc = (txt) => {
      const st = { ids: [] };
      const nombre = el('span', { class: 'ayuda' });
      const inp = el('input', { type: 'file', accept: 'image/*,application/pdf', hidden: true, onchange: async () => {
        const f = inp.files[0];
        if (!f) return;
        try { toast('Subiendo…'); st.ids = [await window.s360.subirArchivo(f)]; nombre.textContent = ` ${f.name}`; toast('Listo: se guarda al confirmar'); }
        catch (e) { toast(e.message, true); }
      } });
      st.nodo = el('label', { class: 'boton ghost mini', title: `Adjuntar el ${txt} (PDF o foto)` }, `📎 Adjuntar ${txt}`, inp, nombre);
      return st;
    };
    // logística: stock (también para corregir)
    if (puede.logistica && (l.estado === 'sin_revisar' || l.estado === 'por_pedir' || (l.estado === 'disponible' && l.compra !== 'recibido'))) {
      const inp = el('input', { inputmode: 'decimal', value: l.stock != null ? cant(l.stock) : '', placeholder: '¿cuánto?', 'aria-label': `Cuánto hay de ${l.descripcion}` });
      const guardar = () => hecho(`/api/escandallo/${l.id}/stock`, { stock: inp.value }, 'Apuntado');
      inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); guardar(); } });
      out.push(el('div', { class: 'log-acc', 'data-ayuda': 'log-stock' },
        el('button', { type: 'button', class: l.stock === 0 ? 'sel no' : '', onclick: () => hecho(`/api/escandallo/${l.id}/stock`, { stock: 0 }, 'Apuntado: no hay; avisado a compras') }, 'No hay'),
        el('button', { type: 'button', class: l.stock != null && l.stock >= l.cantidad ? 'sel' : '', onclick: () => hecho(`/api/escandallo/${l.id}/stock`, { stock: l.cantidad }, 'Apuntado: hay todo') }, 'Hay todo'),
        el('span', { class: 'log-hay' }, 'Hay ', inp, ` ${l.unidad || ''} `, el('button', { type: 'button', class: 'primario mini', onclick: guardar }, '✓'))));
    }
    // compras: pidiendo precio a proveedores
    if (l.estado === 'por_pedir' && l.solicitud) {
      out.push(el('div', { class: 'log-acc log-en-pedido' }, `✉ Pidiendo precio (${l.solicitud.codigo}) `,
        el('a', { class: 'boton ghost mini', href: `/compras.html?vista=precios&sol=${l.solicitud.id}` }, 'Ver ofertas')));
    }
    // compras: ya está en un pedido de compra en preparación
    if (l.estado === 'por_pedir' && l.pedido_compra) {
      out.push(el('div', { class: 'log-acc log-en-pedido' }, `🛒 En el pedido ${l.pedido_compra.codigo} (${{ borrador: 'en preparación', por_aprobar: 'esperando aprobación', aprobado: 'aprobado, por enviar' }[l.pedido_compra.estado] || l.pedido_compra.estado}) `,
        el('a', { class: 'boton ghost mini', href: `/compras.html?pedido=${l.pedido_compra.id}` }, 'Abrir pedido')));
    }
    // compras: marcar para un pedido de compra con varias líneas
    if (puede.compras && l.estado === 'por_pedir' && !l.pedido_compra && !l.solicitud) {
      out.push(el('label', { class: 'log-sel' }, el('input', { type: 'checkbox', checked: marcadas.has(l.id), onchange: (ev) => { ev.target.checked ? marcadas.add(l.id) : marcadas.delete(l.id); barraPedido(); } }),
        ' Pedir precio o incluir en un pedido'));
    }
    // compras: pedir (rápido: ya pedido por teléfono, sin pedido de compra)
    if (puede.compras && l.estado === 'por_pedir' && !l.pedido_compra && !l.solicitud) {
      const prov = el('select', { 'aria-label': 'Proveedor' }, el('option', { value: '' }, 'Proveedor…'),
        d.proveedores.map((p) => el('option', { value: p.id }, p.nombre)));
      const f = el('input', { type: 'date', 'aria-label': 'Llega el', min: hoy });
      const num = el('input', { placeholder: 'Nº pedido', maxlength: 60, class: 'log-num', 'aria-label': 'Número de pedido o referencia del proveedor' });
      const doc = adjDoc('pedido');
      out.push(el('div', { class: 'log-acc', 'data-ayuda': 'log-pedir' },
        prov, el('label', { class: 'ayuda' }, 'llega ', f), num, doc.nodo,
        el('button', { type: 'button', class: 'primario', onclick: () => hecho(`/api/escandallo/${l.id}/compra`, { estado: 'pedido', proveedor_id: prov.value || null, fecha_prevista: f.value || null, num_pedido: num.value, archivos: doc.ids }, 'Marcado como pedido; avisado a logística y técnico') }, '🛒 Pedido')));
    }
    if (puede.compras && l.estado === 'pedido') {
      // corregir o poner después el nº de pedido
      const num = el('input', { value: l.num_pedido || '', placeholder: 'Nº pedido', maxlength: 60, class: 'log-num', 'aria-label': 'Número de pedido',
        onchange: () => hecho(`/api/escandallo/${l.id}/documentos`, { num_pedido: num.value }, 'Nº de pedido guardado') });
      out.push(el('div', { class: 'log-acc' }, num, el('button', { type: 'button', class: 'ghost mini', onclick: () => hecho(`/api/escandallo/${l.id}/compra`, { estado: 'por_pedir' }, 'Vuelve a «por pedir»') }, 'Deshacer pedido')));
    }
    // logística: recibir
    if (puede.logistica && (l.estado === 'pedido' || (l.estado === 'por_pedir' && vista === 'recibir'))) {
      const alb = el('input', { placeholder: 'Nº albarán', maxlength: 60, class: 'log-num', 'aria-label': 'Número de albarán del proveedor' });
      const doc = adjDoc('albarán');
      out.push(el('div', { class: 'log-acc', 'data-ayuda': 'log-recibir' }, alb, doc.nodo,
        el('button', { type: 'button', class: 'primario', onclick: () => hecho(`/api/escandallo/${l.id}/recibir`, { num_albaran: alb.value, archivos: doc.ids }, 'Recibido; avisado a los operarios de la tarea') }, '✔ Recibido')));
    }
    if (puede.logistica && l.compra === 'recibido') {
      const alb = el('input', { value: l.num_albaran || '', placeholder: 'Nº albarán', maxlength: 60, class: 'log-num', 'aria-label': 'Número de albarán',
        onchange: () => hecho(`/api/escandallo/${l.id}/documentos`, { num_albaran: alb.value }, 'Nº de albarán guardado') });
      out.push(el('div', { class: 'log-acc' }, alb, el('button', { type: 'button', class: 'ghost mini', onclick: () => hecho(`/api/escandallo/${l.id}/recibir`, { deshacer: true }, 'Deshecho: vuelve a «pedido»') }, 'Deshacer recepción')));
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
