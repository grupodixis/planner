/* Gantt: Proyecto › OT › tareas por semanas (o meses), con entrega ⚑, avance, riesgo y la carga por oficios, áreas,
   talleres externos y subcontratas. No se planifica aquí: al pulsar una tarea se abre el tablero ese día. */
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
    soloRiesgo: leer('soloRiesgo', false), cerradas: false, q: '', desde: q0.get('desde') || null,
    abiertas: new Set(leer('abiertas', [])), plegados: new Set(leer('plegados', [])), carga: leer('carga', 'oficios'), datos: null,
  };
  const SEM = () => (est.escala === 'meses' ? 26 : 6);
  const RIESGO = { no_llega: ['r', 0], faltan: ['a', 1], sin_planificar: ['a', 2], justo: ['a', 3], sin_entrega: ['', 4], a_tiempo: ['v', 5], hecha: ['v', 6] };
  const CLASE = { propia: 'Taller / obra (gente propia)', ext: '🏭 Taller externo', trp: '🚚 Transporte', sub: '🏗 Subcontrata en obra' };

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
      b('Solo con riesgo', est.soloRiesgo, () => { est.soloRiesgo = !est.soloRiesgo; guardar('soloRiesgo', est.soloRiesgo); pintar(); }),
      b('Incluir cerradas', est.cerradas, () => { est.cerradas = !est.cerradas; cargar(); }),
      b('Desplegar todo', false, () => { est.abiertas = new Set(est.datos.ots.map((o) => o.id)); guardar('abiertas', [...est.abiertas]); pintar(); }),
      b('Plegar todo', false, () => { est.abiertas.clear(); guardar('abiertas', []); pintar(); }),
      el('input', { type: 'search', class: 'gt-buscar', placeholder: '🔍 Obra, cliente, proyecto, OT…', value: est.q, 'aria-label': 'Buscar',
        oninput: (ev) => { clearTimeout(tq); tq = setTimeout(() => { est.q = ev.target.value; pintar(); }, 200); } })].flat(Infinity));
  }

  /* ---------- gantt ---------- */
  function pintar() {
    controles();
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
    let ots = d.ots.filter((o) => (!est.soloRiesgo || ['no_llega', 'faltan', 'sin_planificar', 'justo'].includes(o.riesgo))
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

    const barra = (a, b, cls, txt, title, onclick) => {
      const ini = a < d.desde ? d.desde : a; const fin = b > d.hasta ? d.hasta : b;
      if (fin < d.desde || ini > d.hasta) return null;
      return el(onclick ? 'button' : 'div', { type: onclick ? 'button' : null, class: `gt-bb ${cls}${a < d.desde ? ' corta-i' : ''}${b > d.hasta ? ' corta-d' : ''}`, style: { left: `${pos(ini)}%`, width: `${ancho(ini, fin)}%` }, title, onclick }, txt ? el('span', {}, txt) : null);
    };
    const filas = [];
    for (const [k, g] of grupos) {
      const plegado = est.plegados.has(k);
      if (g.t) {
        filas.push(el('div', { class: 'gt-fila gt-grupo' },
          el('div', { class: 'gt-lab' }, el('button', { type: 'button', class: 'gt-pleg', 'aria-expanded': String(!plegado), onclick: () => { if (plegado) est.plegados.delete(k); else est.plegados.add(k); guardar('plegados', [...est.plegados]); pintar(); } }, plegado ? '▸' : '▾'),
            g.u ? el('a', { href: g.u }, el('b', {}, g.t)) : el('b', {}, g.t), g.s ? el('div', { class: 'gt-sub' }, g.s) : null,
            plegado ? el('span', { class: 'gt-sub' }, ` · ${g.ots.length} OT`) : null),
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
        filas.push(el('div', { class: `gt-fila gt-ot${est.agrupar === 'ninguno' ? ' sola' : ''}` },
          el('div', { class: 'gt-lab' },
            el('button', { type: 'button', class: 'gt-pleg', 'aria-expanded': String(abierta), 'aria-label': abierta ? 'Plegar tareas' : 'Ver tareas', onclick: toggle }, abierta ? '▾' : '▸'),
            el('a', { href: `/proyectos.html?ot=${o.id}`, class: 'gt-ot-n' }, el('b', { class: 'cod' }, o.codigo), ` ${o.titulo}`),
            el('div', { class: 'gt-sub' }, [o.entrega ? `entrega ${dm(o.entrega)}` : 'sin entrega', est.agrupar !== 'proyecto' ? `${o.proyecto.codigo}${o.proyecto.cliente ? ` · ${o.proyecto.cliente}` : ''}` : null].filter(Boolean).join(' · ')),
            el('div', { class: 'gt-est' }, el('span', { class: 'gt-av' }, el('i', { style: { width: `${pct}%` } })), el('small', {}, `${pct} %`),
              el('span', { class: `gt-ch ${rc}` }, `${o.riesgo === 'no_llega' ? '⚠ ' : ''}${o.riesgo_txt}`))),
          tl));
        if (!abierta) continue;
        for (const t of o.tareas) {
          const ir = t.primera ? () => { location.href = `/?fecha=${t.segmentos.find((s) => s[1] >= d.hoy)?.[0] || t.primera}`; } : null;
          filas.push(el('div', { class: 'gt-fila gt-t' },
            el('div', { class: 'gt-lab' }, el('b', { class: 'cod' }, t.codigo), ` ${t.nombre}`,
              el('div', { class: 'gt-sub' }, [t.proveedor ? `${{ ext: '🏭', trp: '🚚', sub: '🏗' }[t.clase] || ''} ${t.proveedor}` : t.area, t.hecha ? '✔ hecha' : t.sin_plan ? 'sin planificar' : t.falta_h ? `faltan ${t.falta_h} h` : null].filter(Boolean).join(' · '))),
            el('div', { class: 'gt-tl' }, fondo(),
              t.segmentos.map(([a, b]) => barra(a, b, `${t.hecha ? 'hecha' : t.clase}`, t.clase === 'propia' ? '' : t.proveedor, `${t.codigo} ${t.nombre} · ${dm(a)}${a !== b ? ` → ${dm(b)}` : ''}${ir ? ' · abrir en el tablero' : ''}`, ir)))));
        }
      }
    }
    $('#gt-g').replaceChildren(cab, ...(filas.length ? filas : [el('p', { class: 'ayuda gt-vacio' }, est.soloRiesgo ? 'Ninguna OT con riesgo en lo que se ve. 👍' : 'No hay OTs que mostrar.')]));
    pintarCarga(pos, dias);
    $('#gt-ley').replaceChildren(...Object.entries(CLASE).map(([k, t]) => el('span', {}, el('i', { class: `gt-bb ${k}` }), t)),
      el('span', {}, el('i', { class: 'gt-bb hecha' }), 'Hecho'), el('span', {}, el('i', { class: 'gt-bb falta' }), 'Falta planificar'),
      el('span', {}, el('b', { class: 'gt-hoy-ley' }), 'hoy'), el('span', {}, '⚑ entrega (roja si no llega)'));
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
  }
  iniciar().catch((e) => { $('#gt-g').replaceChildren(el('p', { class: 'error' }, e.message)); });
})();
