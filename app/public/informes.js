/* s360_planificacion · Informes de horas, costes y resultados */
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

  const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  const nfE = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
  const h = (x) => (x ? `${nf1.format(x)} h` : '—');
  const eur = (x) => (x == null ? '—' : x ? nfE.format(x) : '—');
  const pct = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${nf1.format(x)} %`);
  const fechaCorta = (iso) => (iso ? iso.split('-').reverse().join('/') : '');
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const q0 = new URLSearchParams(location.search);
  const hoy = new Date();
  const estado = {
    inf: q0.get('inf') || 'proyectos',
    proyecto: Number(q0.get('proyecto')) || null,
    desde: q0.get('desde') || iso(new Date(hoy.getFullYear(), hoy.getMonth(), 1)),
    hasta: q0.get('hasta') || iso(hoy),
    abiertos: new Set(),
  };
  const guardarURL = () => {
    const p = new URLSearchParams({ inf: estado.inf });
    if (estado.inf === 'proyectos' && estado.proyecto) p.set('proyecto', estado.proyecto);
    if (estado.inf !== 'proyectos') { p.set('desde', estado.desde); p.set('hasta', estado.hasta); }
    history.replaceState(null, '', `?${p}`);
  };

  /* ---------- exportar a CSV (se abre con Excel) ---------- */
  function exportar(nombre, cabeceras, filas) {
    const esc = (v) => {
      const s = v == null ? '' : typeof v === 'number' ? String(v).replace('.', ',') : String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + [cabeceras, ...filas].map((f) => f.map(esc).join(';')).join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })), download: `${nombre}.csv` });
    document.body.append(a); a.click(); a.remove();
  }
  const botonExportar = (fn) => el('button', { type: 'button', class: 'ghost mini', onclick: fn, title: 'Descargar para Excel (CSV)' }, '⬇ Excel');

  /* ---------- Proyectos ---------- */
  const COLS = [
    ['prev_h', 'Presup.', 'Horas-persona presupuestadas (estimación inicial × operarios)', h],
    ['est_h', 'Estimado', 'Estimación actual (cambia si en el parte se dice «faltan X h»)', h],
    ['plan_h', 'Planif.', 'Horas-persona planificadas en el tablero (incluye lo futuro)', h],
    ['real_h', 'Real', 'Horas-persona reales del parte del día', h],
    ['prevision_h', 'Previsión', 'Lo que costará al final: real si está hecha; si no, lo mayor entre real y estimado', h],
    ['desvio_h', 'Desvío', 'Previsión − presupuesto', (x, c) => el('span', { class: x > 0.01 ? 'neg' : x < -0.01 ? 'pos' : '' }, x ? `${x > 0 ? '+' : ''}${nf1.format(x)} h` : '—', c.desvio_pct ? el('small', {}, ` (${pct(c.desvio_pct)})`) : null)],
    ['coste', 'Coste real', 'Horas reales × coste/hora (personas, máquinas y subcontratas)', eur],
    ['importe', 'Importe', 'Importe de la partida en el presupuesto (venta)', eur],
    ['margen', 'Importe − coste', 'Lo que queda del importe tras el coste real de mano de obra y máquinas (sin materiales)', (x, c) => (c.importe == null ? '—' : el('span', { class: x < 0 ? 'neg' : '' }, eur(x)))],
  ];
  const celdas = (c) => COLS.map(([k, , , f]) => el('td', { class: 'num' }, f(c[k], c)));
  const cabecera = (primera) => el('tr', {}, el('th', {}, primera), ...COLS.map(([, t, ayuda]) => el('th', { class: 'num', title: ayuda }, t)));

  async function pintarProyectos() {
    const main = $('#panel-inf');
    if (estado.proyecto) return pintarProyecto();
    const { proyectos } = await api('GET', '/api/informes/proyectos');
    const filas = proyectos.map((p) => el('tr', { class: `clic${p.estado !== 'activo' ? ' apagado' : ''}`, onclick: () => { estado.proyecto = p.id; guardarURL(); pintar(); } },
      el('td', {}, el('b', {}, p.codigo), ` ${p.nombre}`, el('div', { class: 'sub' }, [p.cliente, p.estado !== 'activo' ? p.estado : null,
        `${p.cifras.hechas}/${p.cifras.tareas} tareas hechas`, p.ultimo_registro ? `último parte ${fechaCorta(p.ultimo_registro)}` : null].filter(Boolean).join(' · '))),
      ...celdas(p.cifras)));
    main.replaceChildren(el('section', { class: 'panel' },
      el('div', { class: 'cab-panel' }, el('h2', {}, 'Proyectos'),
        botonExportar(() => exportar('proyectos', ['Código', 'Proyecto', 'Cliente', 'Estado', ...COLS.map((c) => c[1])],
          proyectos.map((p) => [p.codigo, p.nombre, p.cliente, p.estado, ...COLS.map(([k]) => p.cifras[k] ?? '')])))),
      el('p', { class: 'ayuda' }, 'Horas-persona. Pulsa un proyecto para verlo por partidas, OTs y tareas. Pasa el ratón por las cabeceras para ver qué es cada columna.'),
      el('div', { class: 'tabla-scroll' }, el('table', { class: 'tabla-inf' }, el('thead', {}, cabecera('Proyecto')), el('tbody', {}, filas)))));
  }

  async function pintarProyecto() {
    const d = await api('GET', `/api/informes/proyecto/${estado.proyecto}`);
    const p = d.proyecto;
    const fila = (clase, nombre, c, clave, nivel) => {
      const abierto = estado.abiertos.has(clave);
      return el('tr', { class: `${clase}${clave ? ' clic' : ''}`, onclick: clave ? () => { abierto ? estado.abiertos.delete(clave) : estado.abiertos.add(clave); pintarProyecto(); } : null },
        el('td', { class: `niv${nivel}` }, clave ? el('span', { class: 'flecha' }, abierto ? '▾ ' : '▸ ') : null, nombre),
        ...celdas(c));
    };
    const cuerpo = [];
    for (const pa of d.partidas) {
      const kp = `p${pa.id}`;
      cuerpo.push(fila('fila-partida', [pa.codigo ? el('b', {}, `${pa.codigo} `) : null, pa.nombre], pa.cifras, kp, 0));
      if (!estado.abiertos.has(kp)) continue;
      for (const o of pa.ots) {
        const ko = `o${o.id}`;
        cuerpo.push(fila('fila-ot', [el('b', {}, o.codigo), ` ${o.titulo}`, o.estado !== 'abierta' ? el('small', {}, ` · ${o.estado}`) : null], o.cifras, ko, 1));
        if (!estado.abiertos.has(ko)) continue;
        for (const t of o.tareas) {
          cuerpo.push(fila(`fila-tarea${t.estado === 'hecha' ? ' hecha' : ''}`,
            [t.estado === 'hecha' ? '✓ ' : t.estado === 'en_curso' ? '◐ ' : '○ ', t.nombre, t.ops > 1 ? el('small', {}, ` · ${t.ops} op`) : null, t.baja ? el('small', { class: 'neg' }, ' · fuera de presupuesto') : null],
            t.cifras, null, 2));
        }
      }
    }
    const filasCSV = [];
    for (const pa of d.partidas) {
      filasCSV.push(['Partida', pa.codigo, pa.nombre, ...COLS.map(([k]) => pa.cifras[k] ?? '')]);
      for (const o of pa.ots) {
        filasCSV.push(['OT', o.codigo, o.titulo, ...COLS.map(([k]) => o.cifras[k] ?? '')]);
        for (const t of o.tareas) filasCSV.push(['Tarea', o.codigo, t.nombre, ...COLS.map(([k]) => t.cifras[k] ?? '')]);
      }
    }
    const T = d.total;
    const tarjeta = (titulo, valor, sub, clase = '') => el('div', { class: `kpi ${clase}` }, el('span', { class: 'kpi-tit' }, titulo), el('span', { class: 'kpi-val' }, valor), sub ? el('span', { class: 'kpi-sub' }, sub) : null);
    const motivosTxt = { hecho: 'Como estaba', corregido: 'Con cambios', no_hecho: 'No se hizo' };
    $('#panel-inf').replaceChildren(
      el('section', { class: 'panel' },
        el('div', { class: 'cab-panel' },
          el('h2', {}, el('button', { type: 'button', class: 'ghost mini', onclick: () => { estado.proyecto = null; guardarURL(); pintar(); } }, '‹ Proyectos'), ` ${p.codigo} · ${p.nombre}`),
          el('span', { class: 'acciones-cab' },
            el('button', { type: 'button', class: 'ghost mini', onclick: () => { d.partidas.forEach((pa) => { estado.abiertos.add(`p${pa.id}`); pa.ots.forEach((o) => estado.abiertos.add(`o${o.id}`)); }); pintarProyecto(); } }, 'Desplegar todo'),
            botonExportar(() => exportar(`informe-${p.codigo}`, ['Nivel', 'Código', 'Nombre', ...COLS.map((c) => c[1])], filasCSV)))),
        el('p', { class: 'ayuda' }, [p.cliente, p.obra, p.estado].filter(Boolean).join(' · ')),
        el('div', { class: 'kpis' },
          tarjeta('Avance', `${T.hechas}/${T.tareas} tareas`, T.avance_pct != null ? `${nf1.format(T.avance_pct)} % de las horas previstas` : ''),
          tarjeta('Horas reales', h(T.real_h), `de ${h(T.prev_h)} presupuestadas`),
          tarjeta('Previsión al terminar', h(T.prevision_h), T.desvio_h ? `${T.desvio_h > 0 ? '+' : ''}${nf1.format(T.desvio_h)} h (${pct(T.desvio_pct)})` : 'en presupuesto', T.desvio_h > 0.01 ? 'mal' : 'bien'),
          tarjeta('Coste real', eur(T.coste), `personas ${eur(T.coste_op)} · máquinas ${eur(T.coste_maq)} · subcontratas ${eur(T.coste_sub)}`),
          T.importe != null ? tarjeta('Importe − coste', eur(T.margen), `de ${eur(T.importe)} (sin materiales)`, T.margen < 0 ? 'mal' : '') : null),
        d.recursos_sin_coste.length ? el('p', { class: 'aviso-coste' }, `Sin coste/hora (el coste sale incompleto): ${d.recursos_sin_coste.map((r) => r.nombre).join(', ')}. `,
          el('a', { href: '/recursos.html' }, 'Ponlo en Recursos')) : null,
        el('div', { class: 'tabla-scroll' }, el('table', { class: 'tabla-inf' }, el('thead', {}, cabecera('Partida › OT › tarea')),
          el('tbody', {}, cuerpo), el('tfoot', {}, fila('fila-total', 'Total', T, null, 0))))),
      el('div', { class: 'inf-dos' },
        el('section', { class: 'panel' }, el('h2', {}, 'Quién ha trabajado'),
          d.personas.length ? el('table', { class: 'tabla-inf' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Recurso'), el('th', { class: 'num' }, 'Horas'), el('th', { class: 'num' }, 'Coste'), el('th', {}, 'Periodo'))),
            el('tbody', {}, d.personas.map((r) => el('tr', {}, el('td', {}, r.nombre, r.tipo !== 'operario' ? el('small', {}, ` · ${r.tipo === 'maquina' ? 'máquina' : 'subcontrata'}`) : null),
              el('td', { class: 'num' }, h(r.h)), el('td', { class: 'num' }, eur(r.coste)), el('td', {}, `${fechaCorta(r.desde)} – ${fechaCorta(r.hasta)}`))))) : el('p', { class: 'ayuda' }, 'Aún no hay horas reales en el parte.')),
        el('section', { class: 'panel' }, el('h2', {}, 'Cómo se cerró lo planificado'),
          d.motivos.length ? el('table', { class: 'tabla-inf' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Cierre'), el('th', {}, 'Motivo'), el('th', { class: 'num' }, 'Tramos'), el('th', { class: 'num' }, 'Plan'), el('th', { class: 'num' }, 'Real'))),
            el('tbody', {}, d.motivos.map((m) => el('tr', {}, el('td', {}, motivosTxt[m.cierre]), el('td', {}, m.nombre || '—'), el('td', { class: 'num' }, String(m.n)),
              el('td', { class: 'num' }, h(m.plan_h)), el('td', { class: 'num' }, h(m.real_h)))))) : el('p', { class: 'ayuda' }, 'Aún no se ha cerrado ningún parte de este proyecto.'))));
  }

  /* ---------- Operarios ---------- */
  async function pintarOperarios() {
    const d = await api('GET', `/api/informes/operarios?desde=${estado.desde}&hasta=${estado.hasta}`);
    const ausTxt = (a) => Object.entries(a).map(([k, n]) => {
      const nom = k.startsWith('falta_') ? `falta ${{ si: 'justif.', no: 'sin justif.', pendiente: 'pend.' }[k.slice(6)]}` : (d.tipos_ausencia[k] || k).toLowerCase();
      return `${nom} ${nf1.format(n)} d`;
    }).join(' · ');
    const filas = d.operarios.filter((o) => o.productivas || o.no_productivas || Object.keys(o.ausencias).length);
    const cap = d.dias_laborables * d.jornada.horas;
    $('#panel-inf').replaceChildren(el('section', { class: 'panel' },
      el('div', { class: 'cab-panel' }, el('h2', {}, `Operarios · ${fechaCorta(d.desde)} – ${fechaCorta(d.hasta)}`),
        botonExportar(() => exportar(`operarios-${d.desde}-${d.hasta}`,
          ['Operario', 'Vínculo', 'Productivas', 'No productivas', 'Extra', 'Días con parte', 'Coste', 'Ausencias', 'Proyectos'],
          filas.map((o) => [o.nombre, o.vinculo, o.productivas, o.no_productivas, o.extra, o.dias, o.coste, ausTxt(o.ausencias), o.proyectos.map((p) => `${p.codigo} ${p.h}h`).join(', ')])))),
      el('p', { class: 'ayuda' }, `${d.dias_laborables} días laborables = ${nf1.format(cap)} h de jornada por persona. «Extra» = horas por encima de la jornada en un día.`),
      filas.length ? el('div', { class: 'tabla-scroll' }, el('table', { class: 'tabla-inf' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Operario'), el('th', { class: 'num' }, 'Productivas'), el('th', { class: 'num' }, 'No product.'),
          el('th', { class: 'num' }, 'Extra'), el('th', { class: 'num', title: 'Productivas sobre la jornada del periodo' }, 'Ocupación'), el('th', { class: 'num' }, 'Coste'), el('th', {}, 'Ausencias (días)'), el('th', {}, 'Proyectos'))),
        el('tbody', {}, filas.map((o) => el('tr', {},
          el('td', {}, o.nombre, o.vinculo === 'subcontratado' ? el('span', { class: 'sub-tag' }, 'sub') : null),
          el('td', { class: 'num' }, h(o.productivas)),
          el('td', { class: 'num', title: Object.entries(o.no_productivo).map(([k, n]) => `${d.no_productivo[k] || k}: ${n} h`).join('\n') }, h(o.no_productivas)),
          el('td', { class: `num${o.extra ? ' neg' : ''}` }, h(o.extra)),
          el('td', { class: 'num' }, cap ? `${Math.round((o.productivas / cap) * 100)} %` : '—'),
          el('td', { class: 'num' }, o.sin_coste ? el('span', { title: 'Sin coste/hora en su ficha' }, `${eur(o.coste)} ⚠`) : eur(o.coste)),
          el('td', { class: 'aus' }, ausTxt(o.ausencias)),
          el('td', { class: 'proys' }, o.proyectos.map((p) => `${p.codigo} ${nf1.format(p.h)} h`).join(' · '))))))) : el('p', { class: 'ayuda' }, 'No hay horas ni ausencias en este periodo. Las horas salen del parte del día.')));
  }

  /* ---------- Máquinas ---------- */
  async function pintarMaquinas() {
    const d = await api('GET', `/api/informes/maquinas?desde=${estado.desde}&hasta=${estado.hasta}`);
    const lista = d.recursos.filter((r) => r.h || r.plan_h);
    $('#panel-inf').replaceChildren(el('section', { class: 'panel' },
      el('div', { class: 'cab-panel' }, el('h2', {}, `Máquinas, vehículos y alquileres · ${fechaCorta(d.desde)} – ${fechaCorta(d.hasta)}`),
        botonExportar(() => exportar(`maquinas-${d.desde}-${d.hasta}`, ['Recurso', 'Clase', 'Planificadas', 'Reales', 'Días', 'Coste'],
          lista.map((r) => [r.nombre, r.tipo, r.plan_h, r.h, r.dias, r.coste])))),
      lista.length ? el('table', { class: 'tabla-inf' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Recurso'), el('th', { class: 'num' }, 'Planificadas'), el('th', { class: 'num' }, 'Reales'), el('th', { class: 'num' }, 'Días'), el('th', { class: 'num' }, 'Coste'))),
        el('tbody', {}, lista.map((r) => el('tr', {}, el('td', {}, r.nombre, el('small', {}, r.tipo === 'maquina' ? '' : ' · subcontrata / alquiler')),
          el('td', { class: 'num' }, h(r.plan_h)), el('td', { class: 'num' }, h(r.h)), el('td', { class: 'num' }, String(r.dias || '—')),
          el('td', { class: 'num' }, r.coste_hora == null && r.h ? el('span', { title: 'Sin coste/hora' }, '— ⚠') : eur(r.coste))))))
        : el('p', { class: 'ayuda' }, 'Ninguna máquina planificada ni usada en este periodo.')));
  }

  /* ---------- Planificación y desvíos ---------- */
  async function pintarPlanificacion() {
    const d = await api('GET', `/api/informes/planificacion?desde=${estado.desde}&hasta=${estado.hasta}`);
    const T = d.total;
    const barra = (s) => {
      const tot = s.cierres || 1;
      return el('span', { class: 'barra-fiab', title: `${s.hechos} como estaba · ${s.corregidos} con cambios · ${s.no_hechos} no se hizo` },
        el('span', { class: 'b-ok', style: `width:${(s.hechos / tot) * 100}%` }),
        el('span', { class: 'b-cor', style: `width:${(s.corregidos / tot) * 100}%` }),
        el('span', { class: 'b-no', style: `width:${(s.no_hechos / tot) * 100}%` }));
    };
    $('#panel-inf').replaceChildren(
      el('section', { class: 'panel' },
        el('h2', {}, `Fiabilidad de la planificación · ${fechaCorta(d.desde)} – ${fechaCorta(d.hasta)}`),
        el('div', { class: 'kpis' },
          el('div', { class: `kpi ${T.fiabilidad != null && T.fiabilidad < 70 ? 'mal' : 'bien'}` }, el('span', { class: 'kpi-tit' }, 'Se cumplió como estaba'),
            el('span', { class: 'kpi-val' }, T.fiabilidad == null ? '—' : `${nf1.format(T.fiabilidad)} %`), el('span', { class: 'kpi-sub' }, `${T.hechos} de ${T.cierres} tramos cerrados`)),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-tit' }, 'Con cambios / no se hizo'), el('span', { class: 'kpi-val' }, `${T.corregidos} / ${T.no_hechos}`)),
          el('div', { class: 'kpi' }, el('span', { class: 'kpi-tit' }, 'Horas-persona plan → real'), el('span', { class: 'kpi-val' }, `${h(T.plan_h)} → ${h(T.real_h)}`)),
          el('div', { class: `kpi ${d.sin_cerrar ? 'mal' : ''}` }, el('span', { class: 'kpi-tit' }, 'Días sin cerrar el parte'), el('span', { class: 'kpi-val' }, String(d.sin_cerrar)),
            d.sin_cerrar ? el('a', { class: 'kpi-sub', href: '/parte.html' }, 'Ir al parte') : null)),
        d.semanas.length ? el('table', { class: 'tabla-inf' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Semana'), el('th', {}, ''), el('th', { class: 'num' }, 'Cumplido'), el('th', { class: 'num' }, 'Tramos'), el('th', { class: 'num' }, 'Plan'), el('th', { class: 'num' }, 'Real'))),
          el('tbody', {}, d.semanas.map((s) => el('tr', {}, el('td', {}, `del ${fechaCorta(s.semana)}`), el('td', { class: 'td-barra' }, barra(s)),
            el('td', { class: 'num' }, `${nf1.format(s.fiabilidad)} %`), el('td', { class: 'num' }, String(s.cierres)), el('td', { class: 'num' }, h(s.plan_h)), el('td', { class: 'num' }, h(s.real_h))))))
          : el('p', { class: 'ayuda' }, 'Aún no hay partes cerrados en este periodo.')),
      el('div', { class: 'inf-dos' },
        el('section', { class: 'panel' }, el('h2', {}, 'Por qué nos desviamos'),
          d.motivos.length ? el('table', { class: 'tabla-inf' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Motivo'), el('th', { class: 'num' }, 'Veces'), el('th', { class: 'num', title: 'Horas-persona planificadas de lo que no se hizo' }, 'No hecho'), el('th', { class: 'num', title: 'Real − plan en lo corregido' }, 'Desvío'))),
            el('tbody', {}, d.motivos.map((m) => el('tr', {}, el('td', {}, m.nombre), el('td', { class: 'num' }, String(m.n)), el('td', { class: 'num' }, h(m.horas_perdidas)),
              el('td', { class: 'num' }, m.horas_desvio ? `${m.horas_desvio > 0 ? '+' : ''}${nf1.format(m.horas_desvio)} h` : '—')))))
            : el('p', { class: 'ayuda' }, 'Sin motivos registrados (se piden al corregir o al decir «no se hizo»).')),
        el('section', { class: 'panel' }, el('h2', {}, `Tareas terminadas con más desvío (${d.tareas_terminadas})`),
          d.tareas.length ? el('table', { class: 'tabla-inf' },
            el('thead', {}, el('tr', {}, el('th', {}, 'Tarea'), el('th', { class: 'num' }, 'Presup.'), el('th', { class: 'num' }, 'Real'), el('th', { class: 'num' }, 'Desvío'))),
            el('tbody', {}, d.tareas.map((t) => el('tr', {}, el('td', {}, el('b', {}, t.orden_codigo), ` ${t.nombre}`), el('td', { class: 'num' }, h(t.prev_h)), el('td', { class: 'num' }, h(t.real_h)),
              el('td', { class: `num ${t.desvio_h > 0 ? 'neg' : 'pos'}` }, `${t.desvio_h > 0 ? '+' : ''}${nf1.format(t.desvio_h)} h`, t.desvio_pct != null ? el('small', {}, ` (${pct(t.desvio_pct)})`) : null)))))
            : el('p', { class: 'ayuda' }, 'Ninguna tarea terminada en este periodo.'))));
  }

  /* ---------- pestañas y arranque ---------- */
  const PINTAR = { proyectos: pintarProyectos, operarios: pintarOperarios, maquinas: pintarMaquinas, planificacion: pintarPlanificacion };
  function pintar() {
    document.querySelectorAll('[role=tab]').forEach((b) => {
      const activo = b.dataset.inf === estado.inf;
      b.setAttribute('aria-selected', activo ? 'true' : 'false');
      b.tabIndex = activo ? 0 : -1;
    });
    $('#inf-rango').hidden = estado.inf === 'proyectos';
    $('#desde').value = estado.desde; $('#hasta').value = estado.hasta;
    guardarURL();
    PINTAR[estado.inf]().catch((e) => toast(e.message, true));
  }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { return; }
    window.s360.iniciar(yo);
    if (!window.s360.tiene('informes')) {
      $('#panel-inf').replaceChildren(el('section', { class: 'panel' }, el('p', {}, 'Tu usuario no tiene permiso para ver informes.')));
      return;
    }
    document.querySelectorAll('[role=tab]').forEach((b) => (b.onclick = () => { estado.inf = b.dataset.inf; pintar(); }));
    $('#desde').onchange = (ev) => { if (ev.target.value) { estado.desde = ev.target.value; pintar(); } };
    $('#hasta').onchange = (ev) => { if (ev.target.value) { estado.hasta = ev.target.value; pintar(); } };
    $('#atajo').onchange = (ev) => {
      const y = hoy.getFullYear(), m = hoy.getMonth();
      const r = {
        mes: [new Date(y, m, 1), hoy], 'mes-1': [new Date(y, m - 1, 1), new Date(y, m, 0)],
        trim: [new Date(y, Math.floor(m / 3) * 3, 1), hoy], anio: [new Date(y, 0, 1), hoy],
      }[ev.target.value];
      ev.target.value = '';
      if (!r) return;
      [estado.desde, estado.hasta] = r.map(iso);
      pintar();
    };
    pintar();
  }

  init().catch((e) => toast(e.message, true));
})();
