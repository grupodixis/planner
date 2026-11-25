/* Gantt: Proyecto › OT › tareas por semanas (o meses), con entrega ⚑, avance, riesgo y la carga por oficios, áreas,
   talleres externos y subcontratas. Al pulsar una tarea se abre su ventana (la misma del cuadrante), con 📋 para verla en
   el cuadrante. Planificar a grandes rasgos: «🗓 Planificar OT» (propuesta rayada que se ajusta arrastrando y se confirma),
   arrastrar la barra de una OT para moverla entera, y «🕘» para deshacer lo planificado o movido. */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { api } = window.s360;
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['checked', 'hidden', 'disabled'].includes(k)) n[k] = !!v;
      else if (k === 'value') n.value = v ?? '';
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const leer = (k, d) => { try { const v = localStorage.getItem(`gantt-${k}`); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const guardar = (k, v) => { try { localStorage.setItem(`gantt-${k}`, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };
  const masDias = (f, n) => new Date(Date.parse(`${f}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const lunes = (f) => { const d = new Date(`${f}T12:00:00Z`); return masDias(f, -((d.getUTCDay() + 6) % 7)); };
  const dm = (f) => (f ? `${Number(f.slice(8, 10))}/${Number(f.slice(5, 7))}` : '');
  const semanaISO = (f) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7)); const a = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); return 1 + Math.round(((d - a) / 864e5 - 3 + ((a.getUTCDay() + 6) % 7)) / 7); };
  const hoyTxt = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

  const q0 = new URLSearchParams(location.search);
  const est = {
    escala: leer('escala', 'semanas'), agrupar: leer('agrupar', 'proyecto'), orden: leer('orden', 'entrega'),
    soloRiesgo: leer('soloRiesgo', false),
    cerradas: false, q: '', desde: q0.get('desde') || null,
    fijas: new Set(),   // OTs que se acaban de planificar o mover: siguen a la vista aunque «Solo con riesgo» las quitaría
    flechas: leer('flechas', true),
    etiq: leer('etiq', 'personas'),   // qué se ve dentro de las barras de tarea: nada | personas | area | horas
    prop: null,   // propuesta de «Planificar» en curso: { alc (ot | partida | proyecto), op: { modo, fecha, ajustes, areas, sinEsperar }, pila, res, cargando }
    abiertas: new Set(leer('abiertas', [])), plegados: new Set(leer('plegados', [])), carga: leer('carga', 'oficios'), datos: null,
  };
  const SEM = () => (est.escala === 'meses' ? 26 : 6);
  const RIESGO = { no_llega: ['r', 0], faltan: ['a', 1], sin_planificar: ['a', 2], justo: ['a', 3], sin_entrega: ['', 4], a_tiempo: ['v', 5], hecha: ['v', 6] };

  async function cargar() {
    const desde = est.desde || masDias(lunes(hoyTxt()), -7);
    est.datos = await api('GET', `/api/gantt?desde=${desde}&semanas=${SEM()}${est.cerradas ? '&cerradas=1' : ''}`);
    est.desde = est.datos.desde;
    pintar();
  }

  /* ---------- controles ---------- */
  function controles() {
    const b = (txt, on, fn, title) => el('button', { type: 'button', class: `gt-b${on ? ' on' : ''}`, onclick: fn, title }, txt);
    const grupo = (titulo, k, ops) => [el('b', {}, titulo), ops.map(([v, t]) => b(t, est[k] === v, () => { est[k] = v; guardar(k, v); if (k === 'escala') { est.desde = null; cargar(); } else pintar(); }))];
    const paso = est.escala === 'meses' ? 28 : 7;
    let tq;
    $('#gt-ctl').replaceChildren(...[
      b('◀', false, () => { est.desde = masDias(est.desde, -paso); cargar(); }, 'Antes'),
      b('Hoy', false, () => { est.desde = null; cargar(); }),
      b('▶', false, () => { est.desde = masDias(est.desde, paso); cargar(); }, 'Después'),
      grupo('Escala:', 'escala', [['semanas', 'Semanas'], ['meses', 'Meses']]),
      grupo('Agrupar:', 'agrupar', [['proyecto', 'Proyecto'], ['obra', 'Obra'], ['cliente', 'Cliente'], ['ninguno', 'Sin agrupar']]),
      grupo('Ordenar OTs:', 'orden', [['entrega', 'Entrega'], ['riesgo', 'Riesgo'], ['codigo', 'Código']]),
      el('b', {}, 'Ver:'),
      b(`Solo con riesgo${est.soloRiesgo && est.ocultas ? ` · ${est.ocultas} oculta${est.ocultas > 1 ? 's' : ''}` : ''}`, est.soloRiesgo, () => { est.soloRiesgo = !est.soloRiesgo; est.fijas.clear(); guardar('soloRiesgo', est.soloRiesgo); pintar(); },
        est.soloRiesgo ? 'Se ocultan las OTs a tiempo, hechas o sin entrega (las que acabas de planificar se quedan a la vista). Pulsa para verlas todas.' : 'Ver solo las OTs que no llegan, van justas o tienen horas sin planificar'),
      b('Incluir cerradas', est.cerradas, () => { est.cerradas = !est.cerradas; cargar(); }),
      b('↳ Dependencias', est.flechas, () => { est.flechas = !est.flechas; guardar('flechas', est.flechas); pintar(); }, 'Flechas de «después de» entre tareas (y entre OTs plegadas)'),
      b('Desplegar todo', false, () => { est.abiertas = new Set(est.datos.ots.map((o) => o.id)); guardar('abiertas', [...est.abiertas]); pintar(); }),
      b('Plegar todo', false, () => { est.abiertas.clear(); guardar('abiertas', []); pintar(); }),
      b('📄 Exportar', false, () => exportar(), 'Gantt de un proyecto en PDF o imagen, para enviar o presentar'),
      el('span', { class: 'gt-etiq' }, el('b', {}, 'En las barras:'), [['nada', 'Nada'], ['personas', 'Personas'], ['area', 'Área'], ['horas', 'Horas']].map(([v, t]) =>
        b(t, est.etiq === v, () => { est.etiq = v; guardar('etiq', v); pintar(); }))),
      el('input', { type: 'search', class: 'gt-buscar', placeholder: '🔍 Obra, cliente, proyecto, OT…', value: est.q, 'aria-label': 'Buscar',
        oninput: (ev) => { clearTimeout(tq); tq = setTimeout(() => { est.q = ev.target.value; pintar(); }, 200); } })].flat(Infinity));
  }

  /* ---------- gantt ---------- */
  function pintar() {
    const d = est.datos;
    const dias = Math.round((Date.parse(`${d.hasta}T12:00:00Z`) - Date.parse(`${d.desde}T12:00:00Z`)) / 864e5) + 1;
    const pos = (f) => (Math.round((Date.parse(`${f}T12:00:00Z`) - Date.parse(`${d.desde}T12:00:00Z`)) / 864e5) / dias) * 100;
    const ancho = (a, b) => pos(masDias(b, 1)) - pos(a);
    const fest = new Set(d.festivos);
    const porDia = est.escala === 'semanas';
    // fondo de rejilla (fines de semana y festivos sombreados) reutilizado en cada fila
    const fondo = () => el('div', { class: 'gt-fondo', 'aria-hidden': 'true' },
      porDia ? Array.from({ length: dias }, (_, i) => { const f = masDias(d.desde, i); const w = new Date(`${f}T12:00:00Z`).getUTCDay(); return el('i', { class: `${w === 0 || w === 6 ? 'we' : ''}${fest.has(f) ? ' fe' : ''}${w === 1 ? ' lu' : ''}`, style: { left: `${pos(f)}%`, width: `${100 / dias}%` } }); })
        : d.semanas.map((w) => el('i', { class: 'lu', style: { left: `${pos(w)}%`, width: `${(7 / dias) * 100}%` } })),
      d.hoy >= d.desde && d.hoy <= d.hasta ? el('b', { class: 'gt-hoy', style: { left: `${pos(d.hoy) + 50 / dias}%` } }) : null);
    const cab = el('div', { class: 'gt-fila gt-cab' }, el('div', { class: 'gt-lab' }, 'Proyecto › OT › tarea'),
      el('div', { class: 'gt-tl' },
        d.semanas.map((w) => el('div', { class: 'gt-sem', style: { left: `${pos(w)}%`, width: `${(7 / dias) * 100}%` } }, porDia ? `S${semanaISO(w)} · ${dm(w)}` : `S${semanaISO(w)}`)),
        porDia ? Array.from({ length: dias }, (_, i) => { const f = masDias(d.desde, i); const w = new Date(`${f}T12:00:00Z`).getUTCDay();
          return el('div', { class: `gt-dia${w === 0 || w === 6 || fest.has(f) ? ' we' : ''}`, style: { left: `${pos(f)}%`, width: `${100 / dias}%` } }, 'DLMXJVS'[w], el('br'), Number(f.slice(8, 10))); })
          : d.semanas.filter((w) => Number(w.slice(8, 10)) <= 7).map((w) => el('div', { class: 'gt-mes', style: { left: `${pos(w)}%` } },
            new Date(`${w}T12:00:00Z`).toLocaleDateString('es-ES', { month: 'short' })))));

    // filtro y orden
    const q = est.q.trim().toLowerCase();
    const enProp = new Set((est.prop?.res?.ots || []).map((x) => x.id));
    const conRiesgo = (o) => ['no_llega', 'faltan', 'sin_planificar', 'justo'].includes(o.riesgo) || est.fijas.has(o.id) || enProp.has(o.id);
    est.ocultas = est.soloRiesgo ? d.ots.filter((o) => !conRiesgo(o)).length : 0;
    controles();
    let ots = d.ots.filter((o) => (!est.soloRiesgo || conRiesgo(o))
      && (!q || [o.codigo, o.titulo, o.proyecto.codigo, o.proyecto.nombre, o.proyecto.cliente, o.proyecto.obra].join(' ').toLowerCase().includes(q)));
    const cmp = {
      entrega: (a, b) => (a.entrega || '9999').localeCompare(b.entrega || '9999') || a.codigo.localeCompare(b.codigo, 'es', { numeric: true }),
      riesgo: (a, b) => RIESGO[a.riesgo][1] - RIESGO[b.riesgo][1] || (a.entrega || '9999').localeCompare(b.entrega || '9999'),
      codigo: (a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }),
    }[est.orden];
    ots = ots.sort(cmp);
    const grupos = new Map();
    const claveDe = (o) => ({
      proyecto: [`p${o.proyecto.id}`, `${o.proyecto.codigo} ${o.proyecto.nombre}`, [o.proyecto.cliente, o.proyecto.obra ? `📍 ${o.proyecto.obra}` : 'sin obra'].filter(Boolean).join(' · '), `/proyectos.html?p=${o.proyecto.id}`],
      obra: [`o${o.proyecto.obra_id || 0}`, o.proyecto.obra ? `📍 ${o.proyecto.obra}` : 'Sin obra', '', o.proyecto.obra_id ? `/obras.html?id=${o.proyecto.obra_id}` : null],
      cliente: [`c${o.proyecto.cliente_id || 0}`, o.proyecto.cliente || 'Sin cliente', '', o.proyecto.cliente_id ? `/clientes.html?id=${o.proyecto.cliente_id}` : null],
      ninguno: ['todas', null, '', null],
    }[est.agrupar]);
    for (const o of ots) { const [k, t, s, u] = claveDe(o); if (!grupos.has(k)) grupos.set(k, { t, s, u, ots: [] }); grupos.get(k).ots.push(o); }

    // hIni / hFin: hora a la que empieza el primer día y acaba el último (si se sabe): la barra empieza y acaba ahí
    const J = d.jornada || { inicio: 7, fin: 15 };
    const frac = (h) => Math.min(1, Math.max(0, (h - J.inicio) / ((J.fin - J.inicio) || 8)));
    const diaW = 100 / dias;
    const barra = (a, b, cls, txt, title, onclick, hIni = null, hFin = null) => {
      const ini = a < d.desde ? d.desde : a; const fin = b > d.hasta ? d.hasta : b;
      if (fin < d.desde || ini > d.hasta) return null;
      const izq = pos(ini) + (ini === a && hIni != null ? frac(hIni) * diaW : 0);
      const der = pos(masDias(fin, 1)) - (fin === b && hFin != null ? (1 - frac(hFin)) * diaW : 0);
      // al pulsar, el día que queda bajo el ratón
      const pulsar = onclick && ((ev) => {
        const r = ev.currentTarget.getBoundingClientRect();
        const n = Math.round((Date.parse(`${fin}T12:00:00Z`) - Date.parse(`${ini}T12:00:00Z`)) / 864e5) + 1;
        onclick(masDias(ini, Math.min(n - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / (r.width || 1)) * n)))));
      });
      return el(onclick ? 'button' : 'div', { type: onclick ? 'button' : null, class: `gt-bb ${cls}${a < d.desde ? ' corta-i' : ''}${b > d.hasta ? ' corta-d' : ''}`, style: { left: `${izq}%`, width: `${Math.max(der - izq, diaW * 0.08)}%` }, title, onclick: pulsar }, txt ? el('span', {}, txt) : null);
    };
    // punto al final de la última barra de una tarea, para unirla con otra (crear «después de»)
    const conector = (t) => {
      if (!puedeDeps() || est.prop || t.hecha || !t.segmentos.length) return null;
      const [, u, , hu] = t.segmentos[t.segmentos.length - 1];
      if (u < d.desde || u > d.hasta) return null;
      const n = el('span', { class: 'gt-con', style: { left: `calc(${pos(masDias(u, 1)) - (hu != null ? (1 - frac(hu)) * diaW : 0)}% - 6px)` }, title: `Arrastra hasta otra tarea: irá después de ${t.codigo}`, 'aria-hidden': 'true' });
      n.addEventListener('pointerdown', (ev) => unir(ev, t, n));
      return n;
    };
    const filas = [];
    for (const [k, g] of grupos) {
      const plegado = est.plegados.has(k);
      if (g.t) {
        filas.push(el('div', { class: 'gt-fila gt-grupo' },
          el('div', { class: 'gt-lab' }, el('button', { type: 'button', class: 'gt-pleg', 'aria-expanded': String(!plegado), onclick: () => { if (plegado) est.plegados.delete(k); else est.plegados.add(k); guardar('plegados', [...est.plegados]); pintar(); } }, plegado ? '▸' : '▾'),
            g.u ? el('a', { href: g.u }, el('b', {}, g.t)) : el('b', {}, g.t), g.s ? el('div', { class: 'gt-sub' }, g.s) : null,
            plegado ? el('span', { class: 'gt-sub' }, ` · ${g.ots.length} OT`) : null,
            est.agrupar === 'proyecto' ? el('button', { type: 'button', class: 'gt-exp', title: 'Exportar el Gantt de este proyecto (PDF o imagen)', 'aria-label': 'Exportar', onclick: () => exportar(g.ots[0].proyecto.id) }, '📄') : null,
            est.agrupar === 'proyecto' && puedePlan() && !est.prop && g.ots.some(pendiente)
              ? el('button', { type: 'button', class: 'gt-exp', title: 'Planificar de una vez una partida o todo el proyecto', 'aria-label': 'Planificar partida o proyecto', onclick: () => abrirPlanificar(alcanceProyecto(g.ots[0].proyecto.id)) }, '🗓') : null),
          el('div', { class: 'gt-tl' }, fondo())));
      }
      if (plegado) continue;
      for (const o of g.ots) {
        const abierta = est.abiertas.has(o.id);
        const [rc] = RIESGO[o.riesgo];
        const pct = Math.round(o.avance?.avance_pct ?? 0);
        const toggle = () => { if (abierta) est.abiertas.delete(o.id); else est.abiertas.add(o.id); guardar('abiertas', [...est.abiertas]); pintar(); };
        const tl = el('div', { class: 'gt-tl' }, fondo(),
          o.inicio ? barra(o.inicio, o.fin, `ot${o.riesgo === 'hecha' ? ' hecha' : ''}`, null, `${o.codigo} · ${dm(o.inicio)} → ${dm(o.fin)}`) : null,
          o.inicio && o.falta_h > 0 && o.riesgo !== 'hecha' ? barra(masDias(o.fin, 1), masDias(o.fin, Math.max(1, Math.ceil(o.falta_h / 8))), 'falta', `faltan ${o.falta_h} h`, 'Horas que aún no están planificadas') : null,
          o.entrega && o.entrega >= d.desde && o.entrega <= d.hasta ? el('div', { class: `gt-ent${rc === 'r' ? ' r' : ''}`, style: { left: `${pos(masDias(o.entrega, 1))}%` }, title: `Entrega ${dm(o.entrega)}` }, '⚑') : null);
        // avance dentro de la barra de la OT
        const bOt = tl.querySelector('.gt-bb.ot');
        if (bOt && pct) bOt.prepend(el('i', { class: 'gt-pg', style: { width: `${pct}%` } }));
        const enProp = est.prop?.res.ots?.find((x) => x.id === o.id && x.inicio) ? est.prop.res : null;
        const propOT = enProp?.ots.find((x) => x.id === o.id);
        if (bOt && puedePlan() && o.riesgo !== 'hecha' && !est.prop) {
          bOt.classList.add('arr'); bOt.title = `${bOt.title} · arrastra para mover la OT entera`;
          arrastrable(bOt, dias, (dd) => `${dd > 0 ? '+' : ''}${dd} d → empieza ${dm(masDias(o.inicio, dd))}`, (dd) => moverOT(o, dd));
        }
        if (propOT) tl.append(barra(propOT.inicio, propOT.fin, 'prop', null, `Propuesta: ${dm(propOT.inicio)} → ${dm(propOT.fin)}`));
        const colorOT = /^#[0-9a-f]{6}$/i.test(o.color || '') ? o.color : '#8a63d2';
        filas.push(el('div', { class: `gt-fila gt-ot${est.agrupar === 'ninguno' ? ' sola' : ''}`, 'data-o': o.id, style: `--c:${colorOT}` },
          el('div', { class: 'gt-lab' },
            el('button', { type: 'button', class: 'gt-pleg', 'aria-expanded': String(abierta), 'aria-label': abierta ? 'Plegar tareas' : 'Ver tareas', onclick: toggle }, abierta ? '▾' : '▸'),
            el('a', { href: `/proyectos.html?ot=${o.id}`, class: 'gt-ot-n' }, el('b', { class: 'cod' }, o.codigo), ` ${o.titulo}`),
            el('div', { class: 'gt-sub' }, [o.entrega ? `entrega ${dm(o.entrega)}` : 'sin entrega', est.agrupar !== 'proyecto' ? `${o.proyecto.codigo}${o.proyecto.cliente ? ` · ${o.proyecto.cliente}` : ''}` : null].filter(Boolean).join(' · ')),
            el('div', { class: 'gt-est' }, el('span', { class: 'gt-av' }, el('i', { style: { width: `${pct}%` } })), el('small', {}, `${pct} %`),
              enProp ? el('span', { class: 'gt-ch prop' }, 'propuesta') : el('span', { class: `gt-ch ${rc}` }, `${o.riesgo === 'no_llega' ? '⚠ ' : ''}${o.riesgo_txt}`),
              puedePlan() && !est.prop && pendiente(o)
                ? el('button', { type: 'button', class: 'gt-acc', title: 'Planificar OT: colocar sus tareas pendientes de una vez', 'aria-label': `Planificar ${o.codigo}`, onclick: () => abrirPlanificar(alcanceOT(o)) }, '🗓') : null,
              puedePlan() && !est.prop && otPisa(o) ? el('button', { type: 'button', class: 'gt-acc gt-acc-mal', title: 'Hay tareas que empiezan antes de que acabe su previa: correrlas (y lo que va después) lo justo', onclick: () => reorganizar({ orden_id: o.id }, `OT ${o.codigo}`) }, '⇉ Reorganizar') : null,
              o.planif_n ? el('button', { type: 'button', class: 'gt-acc', title: 'Planificaciones y movimientos de esta OT (deshacer)', 'aria-label': 'Historial de planificaciones', onclick: () => historial(o) }, '🕘') : null)),
          tl));
        if (!abierta) continue;
        for (const t of o.tareas) {
          const cerca = t.segmentos.find((s) => s[1] >= d.hoy)?.[0] || t.primera || t.segmentos[0]?.[0] || d.hoy;
          const ir = (f) => abrirTarea(t, f, o.color);
          filas.push(el('div', { class: 'gt-fila gt-t', 'data-t': t.id, style: `--c:${colorOT}` },
            el('div', { class: 'gt-lab' }, el('a', { class: 'gt-cuad', href: `/?tarea=${t.id}&fecha=${cerca}&periodo=dia`, title: 'Ver en el cuadrante', 'aria-label': `Ver ${t.codigo} en el cuadrante` }, '📋'),
              el('button', { type: 'button', class: 'gt-t-n', title: 'Abrir la tarea', onclick: () => ir(cerca) }, el('b', { class: 'cod' }, t.codigo), ` ${t.nombre}`),
              el('div', { class: 'gt-sub' }, [t.proveedor ? `${{ ext: '🏭', trp: '🚚', sub: '🏗' }[t.clase] || ''} ${t.proveedor}` : t.area, t.hecha ? '✔ hecha' : t.sin_plan ? 'sin planificar' : t.falta_h ? `faltan ${t.falta_h} h` : null].filter(Boolean).join(' · '))),
            el('div', { class: 'gt-tl' }, fondo(),
              t.segmentos.map(([a, b, hi, hf], i) => {
                const n = barra(a, b, `${t.hecha ? 'hecha' : t.clase}`, i === 0 ? etiqueta(t) : null, null, ir, hi, hf);
                if (n) n.dataset.tid = t.id;
                return n;
              }),
              barrasPropuesta(est.prop?.res, t, barra, dias),
              conector(t))));
        }
      }
    }
    $('#gt-g').replaceChildren(cab, ...(filas.length ? filas : [el('p', { class: 'ayuda gt-vacio' }, est.soloRiesgo ? 'Ninguna OT con riesgo en lo que se ve. 👍' : 'No hay OTs que mostrar.')]));
    pintarBanner();
    requestAnimationFrame(() => {
      // en barras muy cortas no se pone texto (queda la ficha al pasar el ratón)
      for (const sp of document.querySelectorAll('#gt-g .gt-bb[data-tid] > span')) sp.hidden = sp.parentElement.clientWidth < 30;
      flechas();
    });
    pintarCarga(pos, dias);
    $('#gt-ley').replaceChildren(
      el('span', { style: '--c:#5aa9f0' }, el('i', { class: 'gt-bb ot' }), 'OT (su color)'),
      el('span', { style: '--c:#5aa9f0' }, el('i', { class: 'gt-bb propia' }), 'sus tareas (más oscuro)'),
      el('span', { style: '--c:#5aa9f0' }, el('i', { class: 'gt-bb ext' }), 'rayado: 🏭 taller externo · 🚚 transporte · 🏗 subcontrata'),
      el('span', { style: '--c:#5aa9f0' }, el('i', { class: 'gt-bb hecha' }), 'Hecho'), el('span', {}, el('i', { class: 'gt-bb falta' }), 'Falta planificar'), el('span', {}, '↳ dependencia', el('small', { class: 'gt-ley-mal' }, ' (roja si la de detrás empieza antes)')),
      el('span', {}, el('b', { class: 'gt-hoy-ley' }), 'hoy'), el('span', {}, '⚑ entrega (roja si no llega)'));
  }

  /* ---------- ventana de la tarea: la misma del cuadrante (en modo «solo detalle») ---------- */
  let cambiado = false;
  function abrirTarea(t, fecha, color) {
    let dlg = $('#gt-det');
    if (!dlg) {
      dlg = el('dialog', { id: 'gt-det', class: 'gt-det', 'aria-label': 'Tarea' });
      dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
      dlg.addEventListener('close', () => { dlg.replaceChildren(); if (cambiado) { cambiado = false; cargar().catch(() => {}); } });
      document.body.append(dlg);
    }
    dlg.style.setProperty('--c', color || '');
    dlg.replaceChildren(el('div', { class: 'gt-det-carga' }, `Abriendo ${t.codigo}…`),
      el('iframe', { src: `/?solo=detalle&tarea=${t.id}&fecha=${fecha}&periodo=dia`, title: `${t.codigo} ${t.nombre}` }));
    if (!dlg.open) dlg.showModal();
  }
  window.addEventListener('message', (ev) => {
    if (ev.origin !== location.origin || !ev.data?.s360) return;
    const dlg = $('#gt-det');
    if (ev.data.cambio) cambiado = true;
    if (ev.data.s360 === 'listo') dlg?.querySelector('.gt-det-carga')?.remove();
    if (ev.data.s360 === 'cerrar' && dlg?.open) dlg.close();
    if (ev.data.s360 === 'sin-tarea' && dlg?.open) { dlg.close(); window.s360.aviso?.('Esa tarea ya no está en el cuadrante'); }
  });

  /* ---------- exportar el Gantt de un proyecto (PDF o imagen) ---------- */
  const NOTA = 'Planificación prevista a la fecha de emisión. Las fechas pueden ajustarse según el avance de los trabajos y la confirmación de suministros.';
  async function exportar(proyectoId) {
    const proys = [];
    for (const o of est.datos?.ots || []) if (!proys.some((p) => p.id === o.proyecto.id)) proys.push(o.proyecto);
    let todos = proys;
    try { const r = await api('GET', '/api/proyectos'); const l = Array.isArray(r) ? r : r.proyectos || []; if (l.length) todos = l.map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, estado: p.estado })); } catch { /* los del Gantt */ }
    const op = { nivel: 'tareas', avance: true, quien: false, hoy: true, papel: 'a4', titulo: 'Planificación del proyecto', nota: NOTA, ...leer('export', {}) };
    let pid = proyectoId || proys[0]?.id || todos[0]?.id;
    const d = el('dialog', { class: 'gt-exp-dlg', 'aria-labelledby': 'gt-exp-tit' });
    const url = (fmt, extra = '') => `/api/gantt/proyecto/${pid}/informe.${fmt}?${new URLSearchParams({ nivel: op.nivel, avance: op.avance ? 1 : 0, quien: op.quien ? 1 : 0, hoy: op.hoy ? 1 : 0, papel: op.papel, titulo: op.titulo, nota: op.nota })}${extra}`;
    const vista = el('img', { class: 'gt-exp-img', alt: 'Vista previa' });
    let tv;
    const refrescar = () => { guardar('export', { ...op }); clearTimeout(tv); tv = setTimeout(() => { vista.src = url('svg', `&_=${Date.now()}`); }, 250); };
    const radio = (k, v, t) => el('label', { class: 'gt-exp-op' }, el('input', { type: 'radio', name: `gx-${k}`, checked: op[k] === v, onchange: () => { op[k] = v; refrescar(); } }), t);
    const chk = (k, t) => el('label', { class: 'gt-exp-op' }, el('input', { type: 'checkbox', checked: op[k], onchange: (ev) => { op[k] = ev.target.checked; refrescar(); } }), t);
    const ocupado = (b, fn) => async () => { const t0 = b.textContent; b.disabled = true; b.textContent = 'Preparando…'; try { await fn(); } catch (e) { window.s360.aviso?.(e.message || 'No se pudo exportar'); } b.disabled = false; b.textContent = t0; };
    const bajar = (blob, nombre) => { const a = el('a', { href: URL.createObjectURL(blob), download: nombre }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
    const codigo = () => (todos.find((p) => p.id === pid)?.codigo || 'proyecto').replace(/[^\w.-]+/g, '-');
    const bPdf = el('button', { type: 'button', class: 'primario' }, '⬇ PDF');
    bPdf.onclick = ocupado(bPdf, async () => { const r = await fetch(url('pdf', '&descargar=1')); if (!r.ok) throw new Error('No se pudo generar el PDF'); bajar(await r.blob(), `Planificacion-${codigo()}.pdf`); });
    const bPng = el('button', { type: 'button' }, '⬇ Imagen (PNG)');
    bPng.onclick = ocupado(bPng, async () => {
      const r = await fetch(url('svg')); if (!r.ok) throw new Error('No se pudo generar la imagen');
      const svg = await r.text();
      const img = new Image();
      await new Promise((ok, ko) => { img.onload = ok; img.onerror = ko; img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); });
      const k = 2; const c = el('canvas'); c.width = img.naturalWidth * k; c.height = img.naturalHeight * k;
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      bajar(await new Promise((ok) => c.toBlob(ok, 'image/png')), `Planificacion-${codigo()}.png`);
    });
    d.append(
      el('div', { class: 'gt-exp-cab' }, el('h2', { id: 'gt-exp-tit' }, '📄 Exportar el Gantt de un proyecto'),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
      el('div', { class: 'gt-exp-cuerpo' },
        el('div', { class: 'gt-exp-form' },
          el('label', { class: 'gt-exp-campo' }, el('span', {}, 'Proyecto'),
            el('select', { onchange: (ev) => { pid = Number(ev.target.value); refrescar(); } },
              todos.map((p) => el('option', { value: p.id, selected: p.id === pid }, `${p.codigo} · ${p.nombre}${p.estado && p.estado !== 'activo' ? ` (${p.estado})` : ''}`)))),
          el('fieldset', {}, el('legend', {}, 'Detalle'), radio('nivel', 'tareas', 'OTs y sus tareas'), radio('nivel', 'ot', 'Solo las OTs')),
          el('fieldset', {}, el('legend', {}, 'Mostrar'), chk('avance', 'Avance (%)'), chk('hoy', 'Línea de hoy'), chk('quien', 'Quién hace los trabajos externos (talleres, subcontratas)')),
          el('label', { class: 'gt-exp-campo' }, el('span', {}, 'Título'), el('input', { value: op.titulo, maxlength: 120, oninput: (ev) => { op.titulo = ev.target.value; refrescar(); } })),
          el('label', { class: 'gt-exp-campo' }, el('span', {}, 'Nota al pie'), el('textarea', { rows: 3, maxlength: 600, oninput: (ev) => { op.nota = ev.target.value; refrescar(); } }, op.nota)),
          el('fieldset', {}, el('legend', {}, 'Papel del PDF'), radio('papel', 'a4', 'A4 horizontal'), radio('papel', 'a3', 'A3 horizontal')),
          el('p', { class: 'ayuda' }, 'Sale solo lo planificado, sin datos internos (riesgo, horas que faltan, personas). Lo que aún no tiene días sale «por planificar».'),
          el('div', { class: 'gt-exp-bot' }, bPdf, bPng)),
        el('div', { class: 'gt-exp-vista' }, vista)));
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
    refrescar();
  }

  /* ---------- datos en las barras y ficha al pasar el ratón ---------- */
  const puedeDeps = () => !!(window.s360.tiene?.('proyectos') || window.s360.tiene?.('planificar'));
  const iniciales = (n) => n.split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  function etiqueta(t) {
    if (t.clase !== 'propia') return `${{ ext: '🏭', trp: '🚚', sub: '🏗' }[t.clase] || ''} ${t.proveedor || ''}`;
    if (est.etiq === 'area') return t.area || '';
    if (est.etiq === 'horas') return `${Math.round(t.plan_h * 10) / 10}/${t.duracion_h} h`;
    if (est.etiq !== 'personas' || !t.gente || t.hecha) return null;
    const ini = t.gente.nombres.map(iniciales).join(' · ');
    const chip = t.gente.falta > 0 ? el('i', { class: 'gt-falta' }, t.gente.nombres.length ? `👷 ${t.gente.pide - t.gente.falta}/${t.gente.pide}` : 'sin gente') : null;
    return [ini, chip];
  }
  function tareaPorId(id) { for (const o of est.datos.ots) for (const t of o.tareas) if (t.id === id) return t; return null; }
  function fichaTarea(t) {
    const deps = est.datos.deps || [];
    const esp = (d) => (d.espera_h ? ` (+${d.espera_h} h${d.nota ? ` ${d.nota}` : ''})` : d.nota ? ` (${d.nota})` : '');
    const prev = deps.filter((d) => d.a === t.id).map((d) => { const p = tareaPorId(d.de); return p ? `${p.codigo} ${p.nombre}${esp(d)}` : null; }).filter(Boolean);
    const sig = deps.filter((d) => d.de === t.id).map((d) => { const p = tareaPorId(d.a); return p ? `${p.codigo} ${p.nombre}${esp(d)}` : null; }).filter(Boolean);
    const segs = t.segmentos;
    const fila = (k, v, cls) => (v ? el('div', {}, el('span', { class: 'k' }, k), el('span', { class: cls || '' }, v)) : null);
    return el('div', { class: 'gt-ficha', role: 'tooltip' },
      el('b', {}, `${t.codigo} ${t.nombre}`),
      fila('Días', segs.length ? `${fmt(segs[0][0])} → ${fmt(segs.at(-1)[1])}` : 'sin planificar'),
      fila('Horas', t.clase === 'propia' || t.clase === 'sub' ? `${Math.round(t.plan_h * 10) / 10} h planificadas de ${t.duracion_h} h${t.falta_h ? ` · faltan ${t.falta_h} h` : ''}` : null),
      fila('Área', t.area),
      fila('Proveedor', t.proveedor),
      t.gente ? fila('Personas', `${t.gente.nombres.join(', ') || 'nadie asignado'}${t.gente.falta > 0 ? ` · falta${t.gente.falta > 1 ? 'n' : ''} ${t.gente.falta} (pide ${t.gente.pide})` : ''}`, t.gente.falta > 0 ? 'mal' : '') : null,
      fila('Después de', prev.join(' · ')),
      fila('Antes de', sig.join(' · ')),
      fila('Estado', t.hecha ? '✔ hecha' : null),
      el('small', {}, 'Pulsa para abrir la tarea'));
  }
  let fichaAbierta = null;
  document.addEventListener('mouseover', (ev) => {
    const b = ev.target.closest?.('.gt-bb[data-tid]');
    if (!b || document.body.classList.contains('gt-arrastre')) { if (fichaAbierta && !ev.target.closest?.('.gt-ficha')) { fichaAbierta.remove(); fichaAbierta = null; } return; }
    if (fichaAbierta?.dataset.tid === b.dataset.tid) return;
    fichaAbierta?.remove();
    const t = tareaPorId(Number(b.dataset.tid)); if (!t) return;
    fichaAbierta = fichaTarea(t); fichaAbierta.dataset.tid = b.dataset.tid;
    document.body.append(fichaAbierta);
    const r = b.getBoundingClientRect(); const f = fichaAbierta.getBoundingClientRect();
    const x = Math.min(innerWidth - f.width - 8, Math.max(8, ev.clientX - 20));
    const y = r.bottom + 6 + f.height > innerHeight ? r.top - f.height - 6 : r.bottom + 6;
    Object.assign(fichaAbierta.style, { left: `${x}px`, top: `${y}px` });
  });

  /* ---------- dependencias: unir arrastrando, editar o quitar pulsando la flecha ---------- */
  const ESPERAS = [0, 4, 24, 48, 72];
  function dialogoDep({ titulo, dep, aviso, nueva, alGuardar, alQuitar, alDetras }) {
    const d = dialogo(titulo, 'chico');
    const v = { espera_h: dep?.espera_h || 0, nota: dep?.nota || '' };
    const horas = el('input', { type: 'number', min: 0, max: 720, step: 0.5, value: v.espera_h, class: 'gt-dep-h', 'aria-label': 'Horas de espera', oninput: (ev) => { v.espera_h = Number(ev.target.value) || 0; marcar(); } });
    const atajos = el('div', { class: 'gt-dep-pres' }, ESPERAS.map((h) => el('button', { type: 'button', 'data-h': h, onclick: () => { v.espera_h = h; horas.value = h; marcar(); } }, h ? `${h} h` : 'Sin espera')));
    const marcar = () => atajos.querySelectorAll('button').forEach((x) => x.classList.toggle('on', Number(x.dataset.h) === v.espera_h));
    marcar();
    d.append(
      el('div', { class: 'gt-pl-cab' }, el('h2', {}, titulo), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
      el('div', { class: 'gt-pl-caja' },
        el('label', { class: 'gt-dep-fila' }, 'Espera entre las dos: ', horas, ' h'), atajos,
        el('label', { class: 'gt-dep-fila' }, 'Observación ', el('input', { type: 'text', maxlength: 120, value: v.nota, placeholder: 'opcional (p. ej. secado, curado…)', class: 'gt-dep-nota', oninput: (ev) => { v.nota = ev.target.value; } })),
        el('p', { class: 'ayuda' }, 'La espera cuenta horas seguidas, también noches y fines de semana.'),
        aviso ? el('p', { class: aviso.mal ? 'gt-dep-mal' : 'gt-dep-ok' }, aviso.texto) : null),
      el('div', { class: 'gt-pl-pie gt-dep-pie' },
        alQuitar ? el('button', { type: 'button', class: 'gt-prop-desc', onclick: async () => { d.close(); await alQuitar(); } }, '🗑 Quitar dependencia') : el('span'),
        el('span', { class: 'gt-dep-der' },
          alDetras ? el('button', { type: 'button', onclick: async () => { d.close(); await alDetras(); } }, alDetras.texto) : null,
          el('button', { type: 'button', onclick: () => d.close() }, nueva ? 'Cancelar' : 'Cerrar'),
          el('button', { type: 'button', class: 'primario', onclick: async () => {
            if (!(v.espera_h >= 0 && v.espera_h <= 720)) { window.s360.aviso?.('Espera entre 0 y 720 h'); return; }
            d.close(); await alGuardar({ espera_h: Math.round(v.espera_h * 2) / 2, nota: v.nota.trim() });
          } }, nueva ? 'Unir' : 'Guardar'))));
    d.showModal();
    horas.focus();
  }
  async function guardarDep(a, de, v, antes) {
    try {
      await api('POST', '/api/dependencias', { tarea_id: a, depende_de_id: de, ...v });
      await cargar();
      const ta = tareaPorId(a); const tp = tareaPorId(de);
      avisoDeshacer(antes ? `✔ Dependencia cambiada` : `✔ ${ta?.codigo || ''} va después de ${tp?.codigo || ''}${v.espera_h ? ` (+${v.espera_h} h)` : ''}`, async () => {
        try {
          if (antes) await api('POST', '/api/dependencias', { tarea_id: a, depende_de_id: de, espera_h: antes.espera_h, nota: antes.nota || '' });
          else await api('DELETE', `/api/dependencias?tarea_id=${a}&depende_de_id=${de}`);
          await cargar(); window.s360.aviso?.('↶ Deshecho');
        } catch (e) { window.s360.aviso?.(e.message); }
      });
    } catch (e) { window.s360.aviso?.(e.message); }
  }
  // arrastrar desde el punto de una tarea hasta otra
  function unir(ev, t, punto) {
    ev.preventDefault(); ev.stopPropagation();
    const linea = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    linea.setAttribute('class', 'gt-unir');
    const r0 = punto.getBoundingClientRect(); const x0 = r0.left + r0.width / 2; const y0 = r0.top + r0.height / 2;
    document.body.append(linea); document.body.classList.add('gt-arrastre');
    let destino = null;
    const mover = (e) => {
      linea.innerHTML = `<path d="M${x0} ${y0} H${x0 + 8} V${e.clientY} H${e.clientX}" /><circle cx="${e.clientX}" cy="${e.clientY}" r="4"/>`;
      const f = document.elementFromPoint(e.clientX, e.clientY)?.closest('.gt-t[data-t]');
      if (destino && destino !== f) destino.classList.remove('gt-destino');
      destino = f && Number(f.dataset.t) !== t.id ? f : null;
      destino?.classList.add('gt-destino');
    };
    const fin = async () => {
      removeEventListener('pointermove', mover); removeEventListener('pointerup', fin);
      linea.remove(); document.body.classList.remove('gt-arrastre'); destino?.classList.remove('gt-destino');
      if (!destino) return;
      const b = tareaPorId(Number(destino.dataset.t)); if (!b) return;
      const ya = (est.datos.deps || []).find((x) => x.a === b.id && x.de === t.id);
      dialogoDep({ titulo: `${b.codigo} ${b.nombre} va después de ${t.codigo} ${t.nombre}`, dep: ya, nueva: !ya,
        alGuardar: (v) => guardarDep(b.id, t.id, v, ya ? { espera_h: ya.espera_h, nota: ya.nota } : null) });
    };
    addEventListener('pointermove', mover); addEventListener('pointerup', fin);
  }
  // pulsar una flecha
  function editarFlecha(de, a, mal) {
    const dep = (est.datos.deps || []).find((x) => x.de === de && x.a === a); if (!dep) return;
    const tp = tareaPorId(de); const ta = tareaPorId(a);
    const fin = tp?.segmentos.at(-1)?.[1]; const ini = ta?.segmentos.find((s2) => s2[1] >= est.datos.hoy)?.[0] || ta?.segmentos[0]?.[0];
    const aviso = fin && ini ? (mal ? { mal: true, texto: `✕ ${ta.codigo} empieza el ${fmt(ini)}, antes de que acabe ${tp.codigo} (${fmt(fin)})` } : { texto: `✔ ${tp.codigo} acaba el ${fmt(fin)} y ${ta.codigo} empieza el ${fmt(ini)}` }) : null;
    const antes = { espera_h: dep.espera_h, nota: dep.nota };
    const detras = mal && puedePlan() ? () => reorganizar({ tarea_id: a }, `${ta.codigo} y lo que va después`) : null;
    if (detras) detras.texto = `⇉ Correr ${ta.codigo} y lo que va después`;
    dialogoDep({ titulo: `${ta?.codigo} va después de ${tp?.codigo}`, dep, aviso,
      alGuardar: (v) => guardarDep(a, de, v, antes),
      alQuitar: puedeDeps() ? async () => {
        try {
          await api('DELETE', `/api/dependencias?tarea_id=${a}&depende_de_id=${de}`);
          await cargar();
          avisoDeshacer(`🗑 Quitada: ${ta?.codigo} ya no va después de ${tp?.codigo}`, async () => {
            try { await api('POST', '/api/dependencias', { tarea_id: a, depende_de_id: de, ...antes, nota: antes.nota || '' }); await cargar(); window.s360.aviso?.('↶ Deshecho'); } catch (e) { window.s360.aviso?.(e.message); }
          });
        } catch (e) { window.s360.aviso?.(e.message); }
      } : null,
      alDetras: detras });
  }

  /* ---------- reorganizar: correr lo que pisa a su previa, en cadena ---------- */
  const otPisa = (o) => { const ids = new Set(o.tareas.map((t) => t.id)); return (est.datos.deps || []).some((d) => ids.has(d.a) && pisa(d)); };
  async function reorganizar(desde, que) {
    let v;
    try { v = await api('POST', '/api/plan-vista/reorganizar', desde); } catch (e) { window.s360.aviso?.(e.message); return; }
    if (!v.tareas.length) { window.s360.aviso?.('Nada que reorganizar: las dependencias ya se respetan (o lo que pisa no tiene nada que se pueda mover)'); return; }
    const avisos = v.tareas.flatMap((t) => t.avisos || []);
    const d = dialogo('Reorganizar', 'chico');
    d.append(
      el('div', { class: 'gt-pl-cab' }, el('h2', {}, `⇉ Reorganizar ${que}`), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
      el('div', { class: 'gt-pl-caja' },
        el('p', {}, `Se corren ${v.tareas.length} tarea${v.tareas.length > 1 ? 's' : ''} (${v.n} tramos) lo justo para empezar cuando acaba su previa + la espera. Nada se adelanta; lo que ya tiene horas reales o cierre se queda.`),
        el('table', { class: 'gt-pl-ots' }, el('tbody', {}, v.tareas.map((t) => el('tr', {},
          el('td', {}, el('b', { class: 'cod' }, t.codigo), ` ${t.nombre}`),
          el('td', {}, `+${t.dias} día${t.dias > 1 ? 's' : ''}`),
          el('td', {}, `${fmt(t.desde)} → `, el('b', {}, fmt(t.a))),
          el('td', { class: 'ayuda' }, t.tras ? `tras ${t.tras.codigo}${t.tras.espera_h ? ` +${t.tras.espera_h} h` : ''}` : '')))))),
      avisos.length ? el('div', { class: 'gt-pl-caja' }, el('b', {}, 'Avisos'), listaAvisos(avisos)) : null,
      el('div', { class: 'gt-pl-pie' },
        el('button', { type: 'button', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async (ev) => {
          ev.target.disabled = true;
          try {
            const x = await api('POST', '/api/reorganizar', desde);
            for (const id of x.ordenes) est.fijas.add(id);
            d.close(); await cargar();
            avisoDeshacer(`⇉ Reorganizado: ${x.tareas} tarea${x.tareas > 1 ? 's' : ''}, ${x.tramos} tramos`, x.planificacion_id);
          } catch (e) { window.s360.aviso?.(e.message); ev.target.disabled = false; }
        } }, '⇉ Reorganizar')));
    d.showModal();
  }

  /* ---------- flechas de dependencias ---------- */
  // ¿la de detrás empieza antes de que acabe la previa + su espera? Con horas reales (o las de la propuesta)
  const horaAbs = (f, h) => Date.parse(`${f}T00:00:00Z`) / 36e5 + (h ?? 0);
  function segsDe(id) {
    const pt = est.prop?.res?.tareas.find((x) => x.id === id);
    if (pt) return pt.segmentos;
    return tareaPorId(id)?.segmentos || [];
  }
  function pisa(dep) {
    const p = tareaPorId(dep.de); const a = tareaPorId(dep.a);
    if (!p || !a || p.hecha || a.hecha) return false;
    const sp = segsDe(dep.de); const sa = segsDe(dep.a);
    if (!sp.length || !sa.length) return false;
    const [, fb, , hf] = sp.at(-1); const [ia, , hi] = sa[0];
    const J = est.datos.jornada || { inicio: 7, fin: 15 };
    return horaAbs(ia, hi ?? J.inicio) < horaAbs(fb, hf ?? J.fin) + (dep.espera_h || 0) - 0.01;
  }
  // De la última barra de la previa a la primera de la que va detrás. Si una OT está plegada, la flecha sale o llega a la
  // barra de la OT (una sola por pareja). En rojo si la de detrás empieza antes de que acabe la previa. Con una propuesta
  // en curso se usan sus barras rayadas.
  function flechas() {
    const g = $('#gt-g');
    g.querySelector('svg.gt-flechas')?.remove();
    if (!est.flechas || !est.datos?.deps?.length) return;
    const otDe = new Map(); for (const o of est.datos.ots) for (const t of o.tareas) otDe.set(t.id, o.id);
    const caja = g.getBoundingClientRect();
    const fila = (tid) => g.querySelector(`.gt-t[data-t="${tid}"]`) || g.querySelector(`.gt-ot[data-o="${otDe.get(tid)}"]`);
    const barras = (f) => {
      if (!f) return [];
      const prop = [...f.querySelectorAll('.gt-tl > .gt-bb.prop')];
      return prop.length ? prop : [...f.querySelectorAll('.gt-tl > .gt-bb:not(.falta)')];
    };
    const vistas = new Set(); const camino = [];
    for (const dep of est.datos.deps) {
      const fa = fila(dep.de); const fb = fila(dep.a);
      if (!fa || !fb || fa === fb) continue;
      const clave = `${fa.dataset.t || `o${fa.dataset.o}`}>${fb.dataset.t || `o${fb.dataset.o}`}`;
      if (vistas.has(clave)) continue; vistas.add(clave);
      const ba = barras(fa); const bb = barras(fb);
      if (!ba.length || !bb.length) continue;
      const ra = ba.map((x) => x.getBoundingClientRect()).reduce((m, r) => (r.right > m.right ? r : m));
      const rb = bb.map((x) => x.getBoundingClientRect()).reduce((m, r) => (r.left < m.left ? r : m));
      const x1 = ra.right - caja.left; const y1 = ra.top + ra.height / 2 - caja.top;
      const x2 = rb.left - caja.left; const y2 = rb.top + rb.height / 2 - caja.top;
      const mal = pisa(dep);
      let d;
      if (x2 >= x1 + 12) d = `M${x1} ${y1} H${x1 + 6} V${y2} H${x2 - 1}`;
      else if (!mal) {
        // empieza justo al acabar (o casi): baja recta y entra por la izquierda, sin dar la vuelta
        const ym = y2 > y1 ? rb.top - caja.top - 3 : rb.bottom - caja.top + 3;
        d = `M${x1} ${y1} H${x1 + 3} V${ym} H${Math.min(x1 + 3, x2 - 6)} V${y2} H${x2 - 1}`;
      }
      else { const ym = y2 > y1 ? rb.top - caja.top - 4 : rb.bottom - caja.top + 4; d = `M${x1} ${y1} H${x1 + 6} V${ym} H${x2 - 8} V${y2} H${x2 - 1}`; }
      const txt = `${dep.espera_h ? `⏳ ${dep.espera_h} h` : ''}${dep.nota ? `${dep.espera_h ? ' · ' : ''}${dep.nota}` : ''}`;
      const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
      const tareas2 = !!(fa.dataset.t && fb.dataset.t);
      camino.push(`<g class="gt-fl${mal ? ' mal' : ''}${tareas2 ? ' edit' : ''}" data-de="${dep.de}" data-a="${dep.a}"><path class="ver" d="${d}" marker-end="url(#gt-pt${mal ? 'm' : ''})"/>`
        + `<path class="toque" d="${d}"><title>${esc(tareas2 ? `${txt || 'Después de'} · pulsa para cambiar o quitar` : 'Despliega las OTs para cambiarla')}</title></path>`
        + (txt ? `<text x="${Math.max(x1 + 10, Math.min(x2, x1 + 10))}" y="${(y2 >= y1 ? y2 : y1) - 7}">${esc(txt)}</text>` : '') + '</g>');
    }
    if (!camino.length) return;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'gt-flechas');
    svg.setAttribute('width', g.scrollWidth); svg.setAttribute('height', g.scrollHeight);
    svg.innerHTML = `<defs><marker id="gt-pt" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#9aa6b2"/></marker>
      <marker id="gt-ptm" viewBox="0 0 6 6" refX="5" refY="3" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L6 3 L0 6 z" fill="#ff7a7a"/></marker></defs>${camino.join('')}`;
    g.append(svg);
    svg.addEventListener('click', (e) => {
      const f = e.target.closest('g.gt-fl.edit'); if (!f || !puedeDeps()) return;
      editarFlecha(Number(f.dataset.de), Number(f.dataset.a), f.classList.contains('mal'));
    });
  }
  try { new ResizeObserver(() => requestAnimationFrame(flechas)).observe($('#gt-g')); } catch { /* sin ResizeObserver */ }

  /* ---------- planificar a grandes rasgos: propuesta, mover, deshacer ---------- */
  const puedePlan = () => !!window.s360.tiene?.('planificar');
  const fmt = (f) => (f ? new Date(`${f}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'numeric' }) : '');
  const laborable = (f) => { const w = new Date(`${f}T12:00:00Z`).getUTCDay(); return w !== 0 && w !== 6 && !(est.datos?.festivos || []).includes(f); };
  const sigLab = (f) => { let x = f; while (!laborable(x)) x = masDias(x, 1); return x; };
  // días de calendario arrastrados → días laborables (con signo) contando desde f
  const labDelta = (f, dd) => {
    let n = 0; const a = masDias(f, dd);
    if (dd > 0) for (let x = masDias(f, 1); x <= a; x = masDias(x, 1)) { if (laborable(x)) n++; }
    else for (let x = masDias(f, -1); x >= a; x = masDias(x, -1)) { if (laborable(x)) n--; }
    return n;
  };

  // Arrastrar en horizontal una barra: muestra cuántos días, y al soltar llama a soltar(días de calendario)
  function arrastrable(nodo, diasVista, texto, soltar) {
    nodo.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      const tl = nodo.closest('.gt-tl');
      const w = tl.getBoundingClientRect().width / diasVista;
      const x0 = ev.clientX; let dd = 0; let movido = false;
      const tip = el('span', { class: 'gt-drag-tip' });
      const r0 = nodo.getBoundingClientRect();
      nodo.setPointerCapture(ev.pointerId);
      nodo.classList.add('arrastrando'); document.body.classList.add('gt-arrastre');
      const mover = (e) => {
        const dx = e.clientX - x0;
        if (Math.abs(dx) > 4 && !movido) { movido = true; document.body.append(tip); }
        dd = Math.round(dx / w);
        nodo.style.translate = `${dd * w}px 0`;
        Object.assign(tip.style, { left: `${Math.max(4, r0.left + dd * w)}px`, top: `${r0.top - 26}px` });
        tip.textContent = dd ? texto(dd) : 'suelta para dejarlo igual';
      };
      const fin = () => {
        nodo.removeEventListener('pointermove', mover); nodo.removeEventListener('pointerup', fin); nodo.removeEventListener('pointercancel', fin);
        nodo.classList.remove('arrastrando'); document.body.classList.remove('gt-arrastre'); tip.remove();
        if (movido) {
          // que el «click» de después no abra nada
          nodo.addEventListener('click', (e) => { e.stopImmediatePropagation(); e.preventDefault(); }, { capture: true, once: true });
          if (dd) { soltar(dd); return; }
        }
        nodo.style.translate = '';
      };
      nodo.addEventListener('pointermove', mover); nodo.addEventListener('pointerup', fin); nodo.addEventListener('pointercancel', fin);
    });
  }

  function dialogo(titulo, clase = '') {
    const d = el('dialog', { class: `gt-pl-dlg ${clase}`, 'aria-label': titulo });
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    return d;
  }
  const listaAvisos = (avisos) => (avisos.length ? el('ul', { class: 'gt-pl-av' }, avisos.map((a) => el('li', { class: a.tipo }, `⚠ ${a.texto}`))) : el('p', { class: 'ayuda' }, 'Sin avisos.'));

  // Aviso abajo con botón «↶ Deshacer» durante unos segundos
  function avisoDeshacer(texto, plId) {
    $('#gt-undo')?.remove();
    const t = el('div', { id: 'gt-undo', class: 'gt-undo', role: 'status' }, el('span', {}, texto),
      el('button', { type: 'button', onclick: () => { t.remove(); if (typeof plId === 'function') plId(); else deshacer(plId); } }, '↶ Deshacer'),
      el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => t.remove() }, '✕'));
    document.body.append(t);
    setTimeout(() => t.remove(), 15000);
  }

  /* --- 1. diálogo «Planificar» (una OT, una partida o todo el proyecto) --- */
  const pendiente = (o) => o.riesgo !== 'hecha' && (o.falta_h > 0 || o.tareas.some((t) => t.sin_plan && !t.hecha));
  const entregaMax = (ots) => ots.map((o) => o.entrega).filter(Boolean).sort().at(-1) || null;
  const alcanceOT = (o) => ({ tipo: 'ot', id: o.id, titulo: `OT ${o.codigo} · ${o.titulo}`, ots: [o] });
  function alcanceProyecto(pid, partidaId) {
    const ots = est.datos.ots.filter((o) => o.proyecto.id === pid);
    const p = ots[0].proyecto;
    const opciones = [{ tipo: 'proyecto', id: pid, titulo: `Todo el proyecto ${p.codigo}`, ots }];
    const partidas = new Map();
    for (const o of ots) if (o.partida_id) { if (!partidas.has(o.partida_id)) partidas.set(o.partida_id, { tipo: 'partida', id: o.partida_id, titulo: `Partida ${o.partida}`, ots: [] }); partidas.get(o.partida_id).ots.push(o); }
    opciones.push(...[...partidas.values()].filter((x) => x.ots.some(pendiente)));
    const elegida = opciones.find((x) => x.tipo === 'partida' && x.id === partidaId) || opciones[0];
    return { ...elegida, opciones };
  }
  async function abrirPlanificar(alc0, previo) {
    let alc = alc0;
    const op = previo ? JSON.parse(JSON.stringify(previo)) : { modo: 'inicio', fecha: sigLab(masDias(est.datos.hoy, 1)), ajustes: {}, areas: {} };
    const d = dialogo(`Planificar ${alc.titulo}`);
    const res = el('div', { class: 'gt-pl-res' }, el('p', { class: 'ayuda' }, 'Calculando…'));
    const ir = el('button', { type: 'button', class: 'primario', disabled: true }, 'Ver propuesta en el Gantt →');
    let ultima = null; let tv;
    const calcular = () => {
      clearTimeout(tv);
      tv = setTimeout(async () => {
        res.classList.add('cargando');
        try {
          const r = await api('POST', '/api/plan-vista/planificar', { ...op, alcance: { tipo: alc.tipo, id: alc.id } });
          ultima = r; pintarRes(r);
        } catch (e) { ultima = null; ir.disabled = true; res.replaceChildren(el('p', { class: 'error' }, e.message)); }
        res.classList.remove('cargando');
      }, 200);
    };
    const pintarRes = (r) => {
      ir.disabled = !r.n_tramos;
      res.replaceChildren(...[
        el('div', { class: 'gt-pl-caja' }, el('b', {}, 'Resultado previsto'),
          r.n_tramos ? el('ul', {},
            el('li', {}, `${r.tareas.length} tarea${r.tareas.length > 1 ? 's' : ''} · ${r.horas} h en `, el('b', {}, `${r.n_tramos} tramos`)),
            el('li', {}, 'Del ', el('b', {}, fmt(r.inicio)), ' al ', el('b', {}, fmt(r.fin))),
            r.entrega ? el('li', { class: r.entrega.ok ? 'ok' : 'mal' }, `${r.entrega.ok ? '✔' : '✕'} ${r.entrega.texto}`) : el('li', { class: 'ayuda' }, alc.tipo === 'ot' ? 'La OT no tiene fecha de entrega' : 'Ninguna OT tiene fecha de entrega')) : el('p', { class: 'ayuda' }, 'Nada que colocar todavía.')),
        alc.tipo !== 'ot' && r.ots.some((o) => o.tareas) ? el('div', { class: 'gt-pl-caja' }, el('b', {}, 'Cada OT'),
          el('table', { class: 'gt-pl-ots' }, el('tbody', {}, r.ots.filter((o) => o.tareas).map((o) => el('tr', {},
            el('td', {}, el('b', { class: 'cod' }, o.codigo), ` ${o.titulo}`),
            el('td', {}, o.inicio === o.fin ? fmt(o.inicio) : `${fmt(o.inicio)} → ${fmt(o.fin)}`),
            el('td', { class: o.ok === false ? 'mal' : o.ok ? 'ok' : 'ayuda' }, o.entrega ? `${o.ok ? '✔' : '✕'} entrega ${dm(o.entrega)}` : 'sin entrega')))))) : null,
        r.bloqueadas.length || op.sinEsperar ? el('div', { class: 'gt-pl-caja aviso' }, el('b', {}, '⏸ Esperan a una tarea sin planificar'),
          r.bloqueadas.length ? el('ul', {}, r.bloqueadas.map((b) => el('li', {}, `${b.codigo} ${b.nombre} · ${b.horas} h → espera a `, el('b', {}, `${b.espera.codigo} ${b.espera.nombre}`), b.espera.otra_ot ? ' (otra OT)' : ''))) : null,
          el('label', { class: 'gt-pl-opc' }, el('input', { type: 'checkbox', checked: !!op.sinEsperar, onchange: (ev) => { op.sinEsperar = ev.target.checked; calcular(); } }),
            ' Colocarlas igualmente, sin esperar (no recomendado)'),
          el('p', { class: 'ayuda' }, 'Lo normal es planificar antes la tarea previa y volver aquí.')) : null,
        r.tareas.length ? el('details', { class: 'gt-pl-caja gt-pl-det', open: r.tareas.length <= 8 }, el('summary', {}, el('b', {}, 'Dónde va cada tarea')),
          el('ul', {}, r.tareas.map((t) => el('li', {}, el('b', { class: 'cod' }, t.codigo), ` ${t.nombre}: `,
            el('b', {}, t.inicio === t.fin ? fmt(t.inicio) : `${fmt(t.inicio)} → ${fmt(t.fin)}`), ` · ${t.area}`,
            t.tras ? el('small', {}, `tras ${t.tras.codigo} ${t.tras.nombre}${t.tras.otra_ot ? ' (otra OT)' : ''}, que acaba el ${dm(t.tras.fin)}${t.tras.espera_h ? ` + ${t.tras.espera_h} h de espera` : ''}`) : null)))) : null,
        r.sin_area.length ? el('div', { class: 'gt-pl-caja' }, el('b', {}, 'Tareas sin área'),
          r.sin_area.map((t) => el('label', { class: 'gt-pl-area' }, el('span', {}, `${t.codigo} ${t.nombre} · ${t.horas} h`),
            el('select', { onchange: (ev) => { if (ev.target.value) op.areas[t.id] = Number(ev.target.value); else delete op.areas[t.id]; calcular(); } },
              el('option', { value: '' }, '— elegir área —'), r.areas.map((a) => el('option', { value: a.id, selected: op.areas[t.id] === a.id }, a.nombre))))),
          el('p', { class: 'ayuda' }, 'Al confirmar, la tarea se queda con esa área.')) : null,
        el('div', { class: 'gt-pl-caja' }, el('b', {}, 'Avisos'), listaAvisos(r.avisos.filter((a) => a.tipo !== 'sin_area' && a.tipo !== 'bloqueo')))].filter(Boolean));
    };
    const modo = (v, titulo, ayuda) => el('label', { class: `gt-pl-modo${op.modo === v ? ' on' : ''}` },
      el('input', { type: 'radio', name: 'gt-pl-modo', checked: op.modo === v, onchange: () => {
        op.modo = v; d.querySelectorAll('.gt-pl-modo').forEach((x) => x.classList.toggle('on', x.contains(d.querySelector('input[name=gt-pl-modo]:checked'))));
        const ent = entregaMax(alc.ots);
        if (v === 'fin' && ent && op.fecha !== ent && ent >= est.datos.hoy) { op.fecha = ent; fecha.value = op.fecha; }
        calcular();
      } }), el('span', {}, el('b', {}, titulo), el('small', {}, ayuda)));
    const fecha = el('input', { type: 'date', value: op.fecha, min: est.datos.hoy, onchange: (ev) => { if (ev.target.value) { op.fecha = ev.target.value; calcular(); } } });
    d.append(
      el('div', { class: 'gt-pl-cab' }, el('h2', { class: 'gt-pl-tit' }, `🗓 Planificar ${alc.titulo}`), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
      el('div', { class: 'gt-pl-cuerpo' },
        el('div', { class: 'gt-pl-izq' },
          alc.opciones ? el('label', { class: 'gt-pl-que' }, el('span', {}, 'Qué planificar'),
            el('select', { onchange: (ev) => {
              const x = alc.opciones[Number(ev.target.value)];
              alc = { ...x, opciones: alc.opciones }; op.ajustes = {}; op.areas = {};
              d.querySelector('.gt-pl-tit').textContent = `🗓 Planificar ${alc.titulo}`;
              calcular();
            } }, alc.opciones.map((x, i) => el('option', { value: i, selected: x.tipo === alc.tipo && x.id === alc.id }, `${x.titulo} · ${x.ots.length} OT${x.ots.length > 1 ? 's' : ''}`)))) : null,
          modo('inicio', 'Empezar el…', 'Coloca las tareas hacia delante, lo antes posible.'),
          modo('fin', 'Terminar como tarde el…', `Calcula hacia atrás cuándo hay que empezar${entregaMax(alc.ots) ? ` (entrega${alc.ots.length > 1 ? ' más tardía' : ''} ${dm(entregaMax(alc.ots))})` : ''}.`),
          el('label', { class: 'gt-pl-fecha' }, el('span', {}, 'Fecha'), fecha),
          el('div', { class: 'gt-pl-caja' }, el('b', {}, 'Respeta'), el('ul', {},
            el('li', {}, '✔ Dependencias y esperas (p. ej. «+24 h de secado»), también entre OTs'),
            el('li', {}, '✔ El área de cada tarea; en los puestos de uno en uno, no pisa lo ya planificado'),
            el('li', {}, '✔ Jornada, fines de semana y festivos'),
            el('li', {}, '• Sin asignar personas: se asignan después en el cuadrante')))),
        res),
      el('div', { class: 'gt-pl-pie' }, el('button', { type: 'button', onclick: () => d.close() }, 'Cancelar'), ir));
    ir.onclick = () => { if (!ultima) return; d.close(); empezarPropuesta(alc, op, ultima); };
    d.showModal();
    calcular();
  }

  /* --- 2. propuesta en el Gantt --- */
  function empezarPropuesta(alc, op, res) {
    est.prop = { alc, op, pila: [], res, cargando: false };
    for (const o of res.ots) if (o.tareas) est.abiertas.add(o.id);
    guardar('abiertas', [...est.abiertas]);
    // ir a la primera OT de la propuesta
    const irA = () => {
      const o1 = res.ots.find((o) => o.tareas);
      const a = o1 && [...document.querySelectorAll('.gt-ot .gt-ot-n')].find((x) => x.getAttribute('href') === `/proyectos.html?ot=${o1.id}`);
      a?.closest('.gt-fila')?.scrollIntoView({ block: 'center' });
    };
    if (res.inicio && (res.inicio < est.datos.desde || res.inicio > est.datos.hasta)) { est.desde = masDias(lunes(res.inicio), -7); cargar().then(irA); } else { pintar(); irA(); }
  }
  async function recalcular() {
    const p = est.prop; p.cargando = true; pintarBanner();
    try { p.res = await api('POST', '/api/plan-vista/planificar', { ...p.op, alcance: { tipo: p.alc.tipo, id: p.alc.id } }); } catch (e) { window.s360.aviso?.(e.message); if (p.pila.length) p.op = p.pila.pop(); }
    p.cargando = false; pintar();
  }
  function barrasPropuesta(res, t, barra, diasVista) {
    const pt = res?.tareas.find((x) => x.id === t.id);
    if (!pt) return null;
    return pt.segmentos.map(([a, b, hi, hf], i) => {
      const n = barra(a, b, `prop${pt.ajuste ? ' aj' : ''}`, null, `${pt.codigo} propuesta: ${dm(a)}${a !== b ? ` → ${dm(b)}` : ''} · ${pt.area} · arrastra para cambiar el día`, null, hi, hf);
      if (n && i === 0) arrastrable(n, diasVista, (dd) => `${dd > 0 ? '+' : ''}${dd} d → ${dm(masDias(pt.inicio, dd))}`, (dd) => {
        const p = est.prop;
        p.pila.push(JSON.parse(JSON.stringify(p.op)));
        p.op.ajustes[pt.id] = sigLab(masDias(pt.inicio, dd) < est.datos.hoy ? est.datos.hoy : masDias(pt.inicio, dd));
        recalcular();
      });
      return n;
    });
  }
  function pintarBanner() {
    const b = $('#gt-prop');
    const p = est.prop;
    if (!p) { b.hidden = true; b.replaceChildren(); fijar(); return; }
    const r = p.res;
    const nAv = r.avisos.length;
    b.hidden = false;
    b.replaceChildren(
      el('span', { class: 'gt-prop-ic' }, '🗓'),
      el('div', { class: 'gt-prop-t' },
        el('div', {}, el('b', {}, `Propuesta: ${p.alc.titulo}`), ` · ${r.ots.filter((o) => o.tareas).length > 1 ? `${r.ots.filter((o) => o.tareas).length} OTs · ` : ''}${r.n_tramos} tramos del ${dm(r.inicio)} al ${dm(r.fin)}`,
          r.entrega ? el('span', { class: r.entrega.ok ? 'ok' : 'mal' }, ` · ${r.entrega.ok ? 'entrega ✔' : 'no llega ✕'}`) : null,
          nAv ? el('details', { class: 'gt-prop-av' }, el('summary', {}, ` · ${nAv} aviso${nAv > 1 ? 's' : ''}`), listaAvisos(r.avisos)) : null,
          p.cargando ? el('span', { class: 'ayuda' }, ' · calculando…') : null),
        el('small', {}, 'Arrastra las barras rayadas para cambiar el día de una tarea (lo que depende de ella se corre detrás). Aún no está en el cuadrante: nadie más la ve.')),
      el('button', { type: 'button', disabled: !p.pila.length || p.cargando, onclick: () => { p.op = p.pila.pop(); recalcular(); } }, '↶ Deshacer último movimiento'),
      el('button', { type: 'button', onclick: () => { const { alc, op } = p; est.prop = null; pintar(); abrirPlanificar(alc, op); } }, '✎ Cambiar'),
      el('button', { type: 'button', class: 'gt-prop-desc', onclick: () => { est.prop = null; pintar(); } }, '✕ Descartar'),
      el('button', { type: 'button', class: 'primario', disabled: p.cargando || !r.n_tramos, onclick: async (ev) => {
        ev.target.disabled = true;
        try {
          const x = await api('POST', '/api/planificar', { ...p.op, alcance: { tipo: p.alc.tipo, id: p.alc.id } });
          for (const o of p.res.ots) if (o.tareas) est.fijas.add(o.id);
          est.prop = null;
          await cargar();
          avisoDeshacer(`✔ ${x.alcance.tipo === 'ot' ? `${x.ot.codigo} planificada` : `${x.alcance.nombre} planificada (${x.n_ots} OT${x.n_ots > 1 ? 's' : ''})`}: ${x.tramos} tramos en el cuadrante`, x.planificacion_id);
        } catch (e) { window.s360.aviso?.(e.message); ev.target.disabled = false; }
      } }, '✔ Confirmar y pasar al cuadrante'));
  }

  /* --- mover una OT entera (arrastrando su barra) --- */
  async function moverOT(o, dd) {
    const desde = o.inicio < est.datos.hoy ? est.datos.hoy : o.inicio;
    const n = labDelta(desde, dd);
    if (!n) { window.s360.aviso?.('Sin cambio: en días laborables queda igual'); pintar(); return; }
    let v;
    try { v = await api('POST', `/api/plan-vista/ordenes/${o.id}/mover`, { dias: n }); } catch (e) { window.s360.aviso?.(e.message); pintar(); return; }
    const d = dialogo(`Mover ${o.codigo}`, 'chico');
    d.append(
      el('div', { class: 'gt-pl-cab' }, el('h2', {}, `↔ Mover ${o.codigo} ${n > 0 ? '+' : ''}${n} día${Math.abs(n) === 1 ? '' : 's'} laborable${Math.abs(n) === 1 ? '' : 's'}`)),
      el('div', { class: 'gt-pl-caja' }, el('ul', {},
        el('li', {}, `Se mueven `, el('b', {}, `${v.n} tramos`), ` de hoy en adelante (lo que ya tiene horas reales o está cerrado se queda).`),
        el('li', {}, `Empieza el ${fmt(v.a)} (antes ${fmt(v.desde)})`),
        v.entrega ? el('li', { class: v.entrega.ok ? 'ok' : 'mal' }, `${v.entrega.ok ? '✔' : '✕'} ${v.entrega.texto}`) : null)),
      el('div', { class: 'gt-pl-caja' }, el('b', {}, 'Avisos'), listaAvisos(v.avisos)),
      el('div', { class: 'gt-pl-pie' },
        el('button', { type: 'button', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async (ev) => {
          ev.target.disabled = true;
          try { const x = await api('POST', `/api/ordenes/${o.id}/mover`, { dias: n }); est.fijas.add(o.id); d.close(); await cargar(); avisoDeshacer(`↔ ${x.ot.codigo} movida: ${x.n} tramos`, x.planificacion_id); }
          catch (e) { window.s360.aviso?.(e.message); ev.target.disabled = false; }
        } }, 'Mover')));
    d.addEventListener('close', () => pintar());
    d.showModal();
  }

  /* --- 3. deshacer y su historial --- */
  async function deshacer(id) {
    let v;
    try { v = await api('POST', `/api/plan-vista/planificaciones/${id}/deshacer`); } catch (e) { window.s360.aviso?.(e.message); return; }
    const mover = v.tipo === 'mover';
    let tocados = 'dejar';
    const d = dialogo('Deshacer', 'chico');
    d.append(
      el('div', { class: 'gt-pl-cab' }, el('h2', {}, `↶ Deshacer: ${v.resumen}`)),
      el('div', { class: 'gt-pl-caja' }, el('ul', {},
        v.intactos ? el('li', {}, mover ? `${v.intactos} tramos vuelven a su día, con la gente que se quitó al moverlos.` : `Se quitan los ${v.intactos} tramos que creó y sus horas vuelven a «Por planificar».`) : null,
        v.tocados.length ? el('li', { class: 'aviso' }, `⚠ ${v.tocados.length} tramo${v.tocados.length > 1 ? 's se han' : ' se ha'} cambiado después: ${v.tocados.slice(0, 4).join(', ')}${v.tocados.length > 4 ? '…' : ''}`,
          el('div', { class: 'gt-pl-opc' },
            el('label', {}, el('input', { type: 'radio', name: 'gt-toc', onchange: () => { tocados = 'incluir'; } }), mover ? ' Devolverlos también' : ' Quitarlos también'),
            el('label', {}, el('input', { type: 'radio', name: 'gt-toc', checked: true, onchange: () => { tocados = 'dejar'; } }), ' Dejarlos como están'))) : null,
        v.fijos ? el('li', {}, `${v.fijos} tramo${v.fijos > 1 ? 's' : ''} ya ${v.fijos > 1 ? 'tienen' : 'tiene'} horas reales o cierre: no se ${v.fijos > 1 ? 'tocan' : 'toca'}.`) : null,
        v.borrados ? el('li', { class: 'ayuda' }, `${v.borrados} ya no existe${v.borrados > 1 ? 'n' : ''}.`) : null,
        v.ext.length ? el('li', {}, `Lo planificado con ${v.ext.join(', ')} no se anula solo: avísales.`) : null,
        !v.intactos && !v.tocados.length ? el('li', { class: 'ayuda' }, 'No queda nada que deshacer: se marcará como deshecha.') : null)),
      el('div', { class: 'gt-pl-pie' },
        el('button', { type: 'button', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'gt-prop-desc', onclick: async (ev) => {
          ev.target.disabled = true;
          try { const x = await api('POST', `/api/planificaciones/${id}/deshacer`, { tocados }); d.close(); $('#gt-undo')?.remove(); window.s360.aviso?.(`↶ Deshecho (${x.hechos} tramo${x.hechos === 1 ? '' : 's'})`); await cargar(); }
          catch (e) { window.s360.aviso?.(e.message); ev.target.disabled = false; }
        } }, '↶ Deshacer')));
    d.showModal();
  }
  async function historial(o) {
    const d = dialogo(`Planificaciones de ${o.codigo}`, 'chico');
    const lista = el('div', { class: 'gt-pl-hist' }, el('p', { class: 'ayuda' }, 'Cargando…'));
    d.append(el('div', { class: 'gt-pl-cab' }, el('h2', {}, `🕘 Planificaciones de ${o.codigo}`), el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')), lista);
    d.showModal();
    try {
      const r = await api('GET', `/api/ordenes/${o.id}/planificaciones`);
      const cuando = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
      lista.replaceChildren(...(r.length ? r.map((p) => el('div', { class: `gt-pl-it${p.deshecha_en ? ' hecha' : ''}` },
        el('div', {}, el('div', {}, `${cuando(p.creado)} · `, el('b', {}, p.resumen), ` · ${p.usuario || ''}`),
          p.deshecha_en ? el('small', {}, `Deshecha el ${cuando(p.deshecha_en)} por ${p.deshecha_por || '—'}`)
            : (p.tocados ? el('small', { class: 'aviso' }, `${p.tocados} tramo${p.tocados > 1 ? 's se han' : ' se ha'} cambiado después a mano`) : null)),
        !p.deshecha_en && puedePlan() ? el('button', { type: 'button', onclick: () => { d.close(); deshacer(p.id); } }, '↶ Deshacer') : null))
        : [el('p', { class: 'ayuda' }, 'Nada todavía.')]));
    } catch (e) { lista.replaceChildren(el('p', { class: 'error' }, e.message)); }
  }

  /* ---------- carga ---------- */
  function pintarCarga(pos, dias) {
    const d = est.datos;
    const TAB = { oficios: ['Oficios', 'horas-persona planificadas / capacidad de sus operarios (según su turno, sin festivos ni ausencias)'],
      areas: ['Áreas', 'horas planificadas en cada área / jornada × días laborables'], talleres: ['Talleres externos', 'días con trabajo del taller o transportista'],
      subcontratas: ['Subcontratas', 'horas-persona en obra (horas × personas)'] };
    const filas = d.carga[est.carga] || [];
    const max = Math.max(1, ...filas.flatMap((r) => r.h));
    $('#gt-carga').replaceChildren(
      el('div', { class: 'gt-carga-cab' }, el('h3', {}, 'Carga por semana'),
        Object.entries(TAB).map(([k, [t]]) => el('button', { type: 'button', class: `gt-b${est.carga === k ? ' on' : ''}`, onclick: () => { est.carga = k; guardar('carga', k); pintar(); } }, t, ` ${d.carga[k].length ? `(${d.carga[k].length})` : ''}`)),
        el('span', { class: 'ayuda' }, TAB[est.carga][1])),
      filas.length ? el('div', { class: 'gt-carga-t' }, filas.map((r) => el('div', { class: 'gt-fila gt-cf' },
        el('div', { class: 'gt-lab' }, r.nombre),
        el('div', { class: 'gt-tl' }, d.semanas.map((w, i) => {
          const h = r.h[i]; const cap = r.cap?.[i];
          const p = cap ? h / cap : h / max;
          const c = cap ? (p > 1 ? 'r' : p > 0.85 ? 'a' : 'v') : 'n';
          return el('div', { class: `gt-cw ${c}`, style: { left: `${pos(w)}%`, width: `${(7 / dias) * 100}%` }, title: cap ? `${h} h de ${cap} h (${Math.round(p * 100)} %)` : `${h} ${r.unidad}` },
            h ? el('i', { style: { width: `${Math.min(p, 1) * 100}%` } }) : null,
            el('span', {}, h ? (cap ? `${h}/${cap}` : `${h} ${r.unidad === 'días' ? 'd' : 'h'}`) : (cap ? `0/${cap}` : '')));
        }))))) : el('p', { class: 'ayuda' }, 'Nada planificado en estas semanas.'));
  }

  async function iniciar() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    window.s360.alCambiar?.(() => cargar().catch(() => {}));
    await cargar();
    // ?partida=ID o ?proyecto=ID con &planificar=1 (desde Proyectos): abre «Planificar» con esa partida o el proyecto entero
    const paId = Number(q0.get('partida')); const prId = Number(q0.get('proyecto'));
    if ((paId || prId) && q0.get('planificar') && puedePlan()) {
      const o1 = est.datos.ots.find((x) => (paId ? x.partida_id === paId : x.proyecto.id === prId));
      if (o1) abrirPlanificar(alcanceProyecto(o1.proyecto.id, paId || null));
      else window.s360.aviso?.('No hay OTs abiertas que planificar ahí');
      history.replaceState(null, '', location.pathname);
    }
    // ?ot=ID (desde la ficha de la OT): la despliega y, con &planificar=1 o &historial=1, abre ese diálogo
    const otId = Number(q0.get('ot'));
    const o = otId && est.datos.ots.find((x) => x.id === otId);
    if (o) {
      est.abiertas.add(o.id); pintar();
      [...document.querySelectorAll('.gt-ot .gt-ot-n')].find((a) => a.getAttribute('href') === `/proyectos.html?ot=${o.id}`)?.scrollIntoView({ block: 'center' });
      if (q0.get('planificar') && puedePlan()) abrirPlanificar(alcanceOT(o));
      else if (q0.get('historial')) historial(o);
      history.replaceState(null, '', location.pathname);
    }
  }
  // alturas del menú y los controles, para que la fila de fechas quede pegada debajo al bajar
  const fijar = () => {
    const r = document.documentElement.style;
    r.setProperty('--gt-h1', `${document.querySelector('body > header.top')?.offsetHeight || 0}px`);
    r.setProperty('--gt-h2', `${$('#gt-ctl')?.offsetHeight || 0}px`);
    r.setProperty('--gt-h3', `${$('#gt-prop')?.hidden ? 0 : $("#gt-prop")?.offsetHeight || 0}px`);
  };
  try { const ro = new ResizeObserver(fijar); ro.observe(document.querySelector('body > header.top')); ro.observe($('#gt-ctl')); ro.observe($('#gt-prop')); } catch { /* sin ResizeObserver */ }
  addEventListener('resize', fijar);
  iniciar().catch((e) => { $('#gt-g').replaceChildren(el('p', { class: 'error' }, e.message)); });
})();
