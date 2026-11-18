/* s360_planificacion · Control de costes y tiempos por proyecto (presupuesto · real · previsión · margen) */
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
  const eur = (x) => (x == null ? '—' : nfE.format(x));
  const eur0 = (x) => (x ? nfE.format(x) : '—');
  const pctTxt = (x) => (x == null ? '—' : `${nf1.format(x)} %`);
  const desv = (x, p) => el('span', { class: x > 0.5 ? 'neg' : x < -0.5 ? 'pos' : '' },
    Math.abs(x) < 0.5 ? '—' : `${x > 0 ? '+' : ''}${nfE.format(x)}`, p != null && Math.abs(x) >= 0.5 ? el('small', {}, ` (${p > 0 ? '+' : ''}${nf1.format(p)} %)`) : null);
  // avance frente a gastado: barra doble (verde = trabajo hecho, gris = dinero gastado)
  const barraAG = (c) => (c.avance_pct == null ? '—' : el('span', { class: 'ag', title: `Avance ${pctTxt(c.avance_pct)} · gastado ${pctTxt(c.gastado_pct)} de la mano de obra presupuestada` },
    el('span', { class: 'ag-barra' }, el('span', { class: 'ag-av', style: `width:${Math.min(100, c.avance_pct)}%` }),
      el('span', { class: `ag-ga${c.gastado_pct > c.avance_pct + 15 ? ' mal' : ''}`, style: `width:${Math.min(100, c.gastado_pct)}%` })),
    el('small', {}, `${Math.round(c.avance_pct)} / ${Math.round(c.gastado_pct)} %`)));

  const q0 = new URLSearchParams(location.search);
  const estado = { proyecto: Number(q0.get('proyecto')) || null, abiertos: new Set(), datos: null };
  const guardarURL = () => history.replaceState(null, '', estado.proyecto ? `?proyecto=${estado.proyecto}` : location.pathname);

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
  const tarjeta = (titulo, valor, sub, clase = '') => el('div', { class: `kpi ${clase}` }, el('span', { class: 'kpi-tit' }, titulo), el('span', { class: 'kpi-val' }, valor), sub ? el('span', { class: 'kpi-sub' }, sub) : null);

  /* ---------- ajustes: recargo de la hora extra ---------- */
  function ajustesTxt(d) {
    return el('p', { class: 'ayuda cos-ajustes' },
      `Hora extra: +${Math.round(d.ajustes.recargo_extra * 100)} % · coste/hora medio de los operarios: ${eur(d.coste_medio)} `,
      el('button', { type: 'button', class: 'ghost mini', onclick: () => editarAjustes(d) }, '✎ Cambiar'));
  }
  function editarAjustes(d) {
    const inp = el('input', { type: 'number', min: '0', max: '300', step: '5', value: Math.round(d.ajustes.recargo_extra * 100), 'aria-label': 'Recargo de la hora extra en %' });
    const dlg = el('dialog', { class: 'dlg-cos' },
      el('h2', {}, 'Hora extra'),
      el('p', { class: 'ayuda' }, 'Las horas por encima de la jornada de un día cuestan el coste/hora de la persona más este recargo. Se aplica a todo lo calculado (también a lo pasado).'),
      el('label', { class: 'cos-campo' }, 'Recargo ', inp, ' %'),
      el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          try { await api('PUT', '/api/costes/ajustes', { recargo_extra: Number(inp.value) / 100 }); dlg.close(); toast('Guardado'); pintar(); }
          catch (e) { toast(e.message, true); }
        } }, 'Guardar')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  /* ---------- PVP y presupuesto de una partida ---------- */
  function editarPartida(pa, tipos) {
    const campo = (k, txt, v) => el('label', { class: 'cos-campo' }, el('span', {}, txt),
      el('input', { type: 'number', min: '0', step: '0.01', name: k, value: v ?? '', placeholder: '—' }), ' €');
    const f = el('form', { class: 'cos-form', method: 'dialog' },
      campo('pvp', 'PVP (venta, sin IVA)', pa.pvp_fijado),
      el('h3', {}, 'Coste presupuestado'),
      ...Object.entries(tipos).map(([k, t]) => campo(k, t, pa.presupuesto?.[k])));
    const dlg = el('dialog', { class: 'dlg-cos' },
      el('h2', {}, `${pa.codigo ? `${pa.codigo} · ` : ''}${pa.nombre}`),
      el('p', { class: 'ayuda' }, 'Normalmente lo trae el compositor al importar. Lo que dejes vacío no se compara. Si no hay mano de obra, se estima con las horas presupuestadas × el coste/hora medio.'),
      f,
      el('div', { class: 'acciones' },
        el('button', { type: 'button', class: 'ghost', onclick: () => dlg.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => {
          const v = Object.fromEntries(new FormData(f));
          const presupuesto = {};
          for (const k of Object.keys(tipos)) if (v[k] !== '') presupuesto[k] = v[k];
          try { await api('PUT', `/api/costes/partida/${pa.id}`, { pvp: v.pvp, presupuesto }); dlg.close(); toast('Presupuesto guardado'); pintar(); }
          catch (e) { toast(e.message, true); }
        } }, 'Guardar')));
    dlg.addEventListener('close', () => dlg.remove());
    document.body.append(dlg); dlg.showModal();
  }

  /* ---------- Lista de proyectos ---------- */
  async function pintarLista() {
    const d = await api('GET', '/api/costes/proyectos');
    const COLS = [
      ['PVP', 'Precio de venta (suma de las partidas)', (c) => eur(c.pvp)],
      ['Coste presup.', 'Coste presupuestado (todos los tipos)', (c) => eur0(c.presup)],
      ['Real', 'Gastado hasta hoy', (c) => eur0(c.real)],
      ['Previsión', 'Coste previsto al terminar', (c) => eur0(c.prevision)],
      ['Desviación', 'Previsión − presupuesto', (c) => desv(c.desvio, c.desvio_pct)],
      ['Margen previsto', 'PVP − previsión', (c) => (c.margen_prev == null ? '—' : el('span', { class: c.margen_prev < 0 ? 'neg' : '' }, eur(c.margen_prev), el('small', {}, ` (${pctTxt(c.margen_prev_pct)})`)))],
      ['Avance / gastado', 'Mano de obra: valor de lo hecho frente a lo gastado, sobre lo presupuestado', barraAG],
    ];
    const lista = d.proyectos.filter((p) => p.cifras.tareas);
    $('#panel-costes').replaceChildren(el('section', { class: 'panel' },
      el('div', { class: 'cab-panel' }, el('h2', {}, 'Control de costes'),
        botonExportar(() => exportar('control-costes', ['Código', 'Proyecto', 'Cliente', 'Estado', 'PVP', 'Coste presupuestado', 'Real', 'Previsión', 'Desviación', 'Margen previsto', 'Margen %', 'Avance %', 'Gastado %'],
          lista.map((p) => { const c = p.cifras; return [p.codigo, p.nombre, p.cliente, p.estado, c.pvp, c.presup, c.real, c.prevision, c.desvio, c.margen_prev, c.margen_prev_pct, c.avance_pct, c.gastado_pct]; })))),
      el('p', { class: 'ayuda' }, 'Pulsa un proyecto para verlo por partidas, OTs, tareas y personas. Pasa el ratón por las cabeceras para ver qué es cada columna.'),
      ajustesTxt(d),
      el('div', { class: 'tabla-scroll' }, el('table', { class: 'tabla-inf' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Proyecto'), ...COLS.map(([t, a]) => el('th', { class: 'num', title: a }, t)), el('th', {}, ''))),
        el('tbody', {}, lista.map((p) => el('tr', { class: `clic${p.estado !== 'activo' ? ' apagado' : ''}`, onclick: () => { estado.proyecto = p.id; estado.abiertos.clear(); guardarURL(); pintar(); } },
          el('td', {}, el('b', {}, p.codigo), ` ${p.nombre}`, el('div', { class: 'sub' }, [p.cliente, p.estado !== 'activo' ? p.estado : null].filter(Boolean).join(' · '))),
          ...COLS.map(([, , f]) => el('td', { class: 'num' }, f(p.cifras))),
          el('td', {}, p.avisos ? el('span', { class: 'cos-avisos', title: 'Avisos de costes' }, `⚠ ${p.avisos}`) : null))))))));
  }

  /* ---------- Un proyecto ---------- */
  async function pintarProyecto() {
    const d = await api('GET', `/api/costes/proyecto/${estado.proyecto}`);
    estado.datos = d;
    const p = d.proyecto, T = d.total;
    const COLS = [
      ['H. presup.', 'Horas-persona presupuestadas', (c) => h(c.horas_presup)],
      ['H. reales', 'Horas-persona del parte (de ellas, extra)', (c) => [h(c.horas_real), c.horas_extra ? el('small', { class: 'neg' }, ` (${nf1.format(c.horas_extra)} extra)`) : null]],
      ['Faltan', 'Horas-persona que faltan según la estimación actual', (c) => h(c.horas_falta)],
      ['M.O. presup.', 'Mano de obra presupuestada', (c) => eur0(c.tipos.mano_obra.presup)],
      ['M.O. real', 'Horas reales × coste/hora (con el recargo de las extra)', (c) => eur0(c.tipos.mano_obra.real)],
      ['M.O. previsión', 'Real + lo que falta × coste/hora', (c) => eur0(c.tipos.mano_obra.prevision)],
      ['Desviación', 'Previsión − presupuesto de mano de obra', (c) => desv(c.tipos.mano_obra.desvio, c.tipos.mano_obra.presup ? Math.round((c.tipos.mano_obra.desvio / c.tipos.mano_obra.presup) * 1000) / 10 : null)],
      ['Avance / gastado', 'Valor del trabajo hecho frente a lo gastado, sobre la mano de obra presupuestada', barraAG],
    ];
    const celdas = (c) => COLS.map(([, , f]) => el('td', { class: 'num' }, f(c)));
    const plegar = (k) => () => { estado.abiertos.has(k) ? estado.abiertos.delete(k) : estado.abiertos.add(k); pintarProyecto(); };
    const fila = (clase, nombre, c, clave, nivel, extra) => el('tr', { class: `${clase}${clave ? ' clic' : ''}`, onclick: clave ? plegar(clave) : null },
      el('td', { class: `niv${nivel}` }, clave ? el('span', { class: 'flecha' }, estado.abiertos.has(clave) ? '▾ ' : '▸ ') : null, nombre, extra || null),
      ...celdas(c));
    const cuerpo = [];
    const csv = [];
    for (const pa of d.partidas) {
      const kp = `p${pa.id}`;
      const c = pa.cifras;
      cuerpo.push(fila('fila-partida', [pa.codigo ? el('b', {}, `${pa.codigo} `) : null, pa.nombre], c, kp, 0,
        el('div', { class: 'sub' }, c.pvp != null ? `PVP ${eur(c.pvp)} · margen previsto ${eur(c.margen_prev)} (${pctTxt(c.margen_prev_pct)})` : 'Sin PVP',
          pa.id ? el('button', { type: 'button', class: 'ghost mini cos-edit', onclick: (ev) => { ev.stopPropagation(); editarPartida(pa, d.tipos); } }, '✎ Presupuesto') : null)));
      csv.push(['Partida', pa.codigo, pa.nombre, '', c.horas_presup, c.horas_real, c.horas_extra, c.horas_falta, c.tipos.mano_obra.presup, c.tipos.mano_obra.real, c.tipos.mano_obra.prevision, c.tipos.mano_obra.desvio, c.pvp, c.presup, c.prevision, c.margen_prev]);
      if (!estado.abiertos.has(kp)) continue;
      for (const o of pa.ots) {
        const ko = `o${o.id}`;
        cuerpo.push(fila('fila-ot', [el('b', {}, o.codigo), ` ${o.titulo}`], o.cifras, ko, 1));
        if (!estado.abiertos.has(ko)) continue;
        for (const t of o.tareas) {
          const kt = t.personas.length ? `t${t.id}` : null;
          cuerpo.push(fila(`fila-tarea${t.estado === 'hecha' ? ' hecha' : ''}`,
            [t.estado === 'hecha' ? '✓ ' : t.estado === 'en_curso' ? '◐ ' : '○ ', t.nombre, t.ops > 1 ? el('small', {}, ` · ${t.ops} op`) : null, t.baja ? el('small', { class: 'neg' }, ' · fuera de presupuesto') : null],
            t.cifras, kt, 2));
          if (kt && estado.abiertos.has(kt)) {
            for (const r of t.personas) {
              cuerpo.push(el('tr', { class: 'fila-persona' }, el('td', { class: 'niv3' }, '👤 ', r.nombre, r.sin_coste ? el('small', { class: 'neg', title: 'Sin coste/hora en su ficha' }, ' ⚠') : null),
                el('td', {}), el('td', { class: 'num' }, h(r.h), r.h_extra ? el('small', { class: 'neg' }, ` (${nf1.format(r.h_extra)} extra)`) : null), el('td', {}), el('td', {}),
                el('td', { class: 'num' }, eur0(r.coste)), el('td', {}), el('td', {}), el('td', {})));
            }
          }
        }
      }
    }
    for (const pa of d.partidas) for (const o of pa.ots) {
      csv.push(['OT', o.codigo, o.titulo, '', o.cifras.horas_presup, o.cifras.horas_real, o.cifras.horas_extra, o.cifras.horas_falta, o.cifras.tipos.mano_obra.presup, o.cifras.tipos.mano_obra.real, o.cifras.tipos.mano_obra.prevision, o.cifras.tipos.mano_obra.desvio]);
      for (const t of o.tareas) {
        csv.push(['Tarea', o.codigo, t.nombre, '', t.cifras.horas_presup, t.cifras.horas_real, t.cifras.horas_extra, t.cifras.horas_falta, t.cifras.tipos.mano_obra.presup, t.cifras.tipos.mano_obra.real, t.cifras.tipos.mano_obra.prevision, t.cifras.tipos.mano_obra.desvio]);
        for (const r of t.personas) csv.push(['Persona', o.codigo, t.nombre, r.nombre, '', r.h, r.h_extra, '', '', r.coste]);
      }
    }
    const mo = T.tipos.mano_obra;
    const extraCoste = d.personas.reduce((s, r) => s + r.h_extra, 0);
    $('#panel-costes').replaceChildren(
      el('section', { class: 'panel' },
        el('div', { class: 'cab-panel' },
          el('h2', {}, el('button', { type: 'button', class: 'ghost mini', onclick: () => { estado.proyecto = null; guardarURL(); pintar(); } }, '‹ Proyectos'), ` ${p.codigo} · ${p.nombre}`),
          el('span', { class: 'acciones-cab' },
            el('a', { class: 'boton ghost mini', href: `/informes.html?inf=proyectos&proyecto=${p.id}` }, 'Informe de horas'),
            el('button', { type: 'button', class: 'ghost mini', onclick: () => { d.partidas.forEach((pa) => { estado.abiertos.add(`p${pa.id}`); pa.ots.forEach((o) => estado.abiertos.add(`o${o.id}`)); }); pintarProyecto(); } }, 'Desplegar todo'),
            botonExportar(() => exportar(`costes-${p.codigo}`, ['Nivel', 'Código', 'Nombre', 'Persona', 'H. presup.', 'H. reales', 'H. extra', 'Faltan', 'M.O. presup.', 'M.O. real', 'M.O. previsión', 'Desviación M.O.', 'PVP', 'Coste presup. total', 'Previsión total', 'Margen previsto'], csv)))),
        el('p', { class: 'ayuda' }, [p.cliente, p.obra, p.estado].filter(Boolean).join(' · ')),
        el('div', { class: 'kpis' },
          tarjeta('PVP', eur(T.pvp), T.pvp == null ? 'falta el PVP de las partidas' : `margen presupuestado ${eur(T.margen_presup)}`),
          tarjeta('Margen previsto', T.margen_prev == null ? '—' : eur(T.margen_prev), T.margen_prev == null ? '' : `${pctTxt(T.margen_prev_pct)} del PVP`,
            T.margen_prev == null ? '' : T.margen_prev < 0 ? 'mal' : T.margen_prev < T.margen_presup - 0.5 ? '' : 'bien'),
          tarjeta('Coste previsto al terminar', eur(T.prevision), [`presupuestado ${eur(T.presup)}`, Math.abs(T.desvio) >= 0.5 ? ` · ${T.desvio > 0 ? '+' : ''}${eur(T.desvio)}` : ''].join(''), T.desvio > 0.5 ? 'mal' : 'bien'),
          tarjeta('Mano de obra', `${eur(mo.real)} de ${eur(mo.presup)}`, `${h(T.horas_real)} de ${h(T.horas_presup)} presupuestadas · previsión ${eur(mo.prevision)}`, mo.prevision > mo.presup * 1.05 ? 'mal' : ''),
          tarjeta('Avance / gastado', T.avance_pct == null ? '—' : `${Math.round(T.avance_pct)} % / ${Math.round(T.gastado_pct)} %`,
            T.avance_pct == null ? '' : T.gastado_pct > T.avance_pct + 15 ? 'se gasta más deprisa de lo que se avanza' : 'el gasto va acorde al avance',
            T.avance_pct == null ? '' : T.gastado_pct > T.avance_pct + 15 ? 'mal' : 'bien'),
          tarjeta('Horas extra', h(extraCoste), extraCoste ? `con +${Math.round(d.ajustes.recargo_extra * 100)} % de recargo` : 'ninguna en este proyecto')),
        T.mo_estimado ? el('p', { class: 'aviso-coste' }, `La mano de obra presupuestada de alguna partida está estimada (horas presupuestadas × coste/hora medio, ${eur(d.coste_medio)}) porque no vino del compositor. Puedes ponerla con «✎ Presupuesto».`) : null,
        d.avisos.length ? el('ul', { class: 'cos-lista-avisos' }, d.avisos.map((a) => el('li', { class: a.nivel }, a.nivel === 'mal' ? '⚠ ' : a.nivel === 'aviso' ? '• ' : 'ℹ ', a.texto))) : el('p', { class: 'ayuda' }, '✓ Sin avisos de costes.'),
        ajustesTxt(d)),
      el('section', { class: 'panel' },
        el('h2', {}, 'Por tipo de coste'),
        el('table', { class: 'tabla-inf cos-tipos' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Tipo'), el('th', { class: 'num' }, 'Presupuestado'), el('th', { class: 'num' }, 'Real hasta hoy'), el('th', { class: 'num' }, 'Previsión al terminar'), el('th', { class: 'num' }, 'Desviación'), el('th', {}, ''))),
          el('tbody', {}, Object.entries(d.tipos).map(([k, txt]) => {
            const t = T.tipos[k];
            const nota = { material: 'el real llegará con los precios de compra', otros: 'próximamente: gastos con foto del ticket', maquinaria: 'horas del parte × coste/hora de la máquina', subcontratas: 'horas del parte × coste/hora' }[k];
            return el('tr', {}, el('td', {}, txt), el('td', { class: 'num' }, eur0(t.presup)), el('td', { class: 'num' }, eur0(t.real)), el('td', { class: 'num' }, eur0(t.prevision)),
              el('td', { class: 'num' }, desv(t.desvio, null)), el('td', { class: 'sub' }, nota || ''));
          })),
          el('tfoot', {}, el('tr', { class: 'fila-total' }, el('td', {}, 'Total'), el('td', { class: 'num' }, eur0(T.presup)), el('td', { class: 'num' }, eur0(T.real)),
            el('td', { class: 'num' }, eur0(T.prevision)), el('td', { class: 'num' }, desv(T.desvio, T.desvio_pct)), el('td', {}))))),
      el('section', { class: 'panel' },
        el('h2', {}, 'Partida › OT › tarea › persona'),
        el('p', { class: 'ayuda' }, 'Mano de obra y tiempos. Pulsa una fila para desplegarla; en las tareas, para ver quién trabajó.'),
        el('div', { class: 'tabla-scroll' }, el('table', { class: 'tabla-inf' },
          el('thead', {}, el('tr', {}, el('th', {}, ''), ...COLS.map(([t, a]) => el('th', { class: 'num', title: a }, t)))),
          el('tbody', {}, cuerpo), el('tfoot', {}, fila('fila-total', 'Total', T, null, 0))))),
      el('section', { class: 'panel' },
        el('h2', {}, 'Por persona'),
        d.personas.length ? el('table', { class: 'tabla-inf' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Persona'), el('th', { class: 'num' }, 'Horas'), el('th', { class: 'num' }, 'De ellas extra'), el('th', { class: 'num' }, 'Coste'), el('th', {}, 'Partidas'))),
          el('tbody', {}, d.personas.map((r) => el('tr', {},
            el('td', {}, r.nombre, r.vinculo === 'subcontratado' ? el('span', { class: 'sub-tag' }, 'sub') : null, r.sin_coste ? el('small', { class: 'neg', title: 'Sin coste/hora en su ficha' }, ' ⚠ sin coste/hora') : null),
            el('td', { class: 'num' }, h(r.h)), el('td', { class: `num${r.h_extra ? ' neg' : ''}` }, h(r.h_extra)), el('td', { class: 'num' }, eur0(r.coste)),
            el('td', { class: 'proys' }, r.partidas.map((x) => `${x.codigo || x.nombre} ${nf1.format(x.h)} h`).join(' · '))))))
          : el('p', { class: 'ayuda' }, 'Aún no hay horas reales de este proyecto.')));
  }

  function pintar() {
    return (estado.proyecto ? pintarProyecto() : pintarLista()).catch((e) => toast(e.message, true));
  }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { return; }
    window.s360.iniciar(yo);
    if (!window.s360.tiene('costes')) {
      $('#panel-costes').replaceChildren(el('section', { class: 'panel' }, el('p', {}, 'El control de costes solo lo ven Administración, Operaciones y Dirección.')));
      return;
    }
    window.s360.alCambiar(() => { if (!document.querySelector('dialog[open]')) pintar(); });
    pintar();
  }

  init().catch((e) => toast(e.message, true));
})();
