/* s360_planificacion · tablero operativo diario (vanilla JS, sin build)
 *
 * Cada bloque del calendario es un TRAMO de una tarea. Una tarea larga se planifica
 * en varios tramos (días); al soltarla se crea un tramo hasta el fin de jornada y el resto
 * queda pendiente en el panel derecho.
 */
(() => {
  'use strict';

  const PASO = 0.5;                       // rejilla de encaje (30 min)
  const TIPO_TXT = {
    taller: 'Taller', obra: 'Obra', oficina: 'Oficina técnica', pintura: 'Pintura',
    transporte: 'Transporte', otro: 'Otro',
  };
  const ESTADO_TXT = { pendiente: 'Pendiente', en_curso: 'En curso', hecha: 'Hecha' };
  const MIME_TAREA = 'application/x-s360-tarea';
  const MIME_TRAMO = 'application/x-s360-tramo';
  const MIME_REC = 'application/x-s360-recurso';
  const BLOQUE_H = 58, GAP = 4;

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

  const PERIODOS = ['dia', 'semana', 'mes'];
  const params = new URLSearchParams(location.search);
  const fechaURL = params.get('fecha');
  const periodoURL = params.get('periodo');
  const estado = {
    fecha: /^\d{4}-\d{2}-\d{2}$/.test(fechaURL || '') ? fechaURL : hoyISO(),
    periodo: PERIODOS.includes(periodoURL) ? periodoURL : (PERIODOS.includes(leerPref('periodo', '')) ? leerPref('periodo', '') : 'dia'),
    datos: null,
    usuario: null,
    sel: null,          // { tipo: 'tramo' | 'tarea', id }
    arrastre: null,     // { tipo: 'tarea' | 'tramo' | 'recurso', id, agarre }
    filtro: '',
    vista: leerPref('vista', 'areas'),   // 'areas' | 'operarios'
  };

  /* ---------- utilidades ---------- */
  // Preferencias por navegador (opcionales: si el almacenamiento falla, se usan los valores por defecto)
  function leerPref(k, def) { try { return localStorage.getItem(`s360.${k}`) || def; } catch { return def; } }
  function guardarPref(k, v) { try { localStorage.setItem(`s360.${k}`, v); } catch { /* sin almacenamiento */ } }
  function hoyISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  function sumarDias(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const f = new Date(y, m - 1, d + n);
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  }
  const fechaLarga = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  };
  const fechaCorta = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' });
  };
  const aFecha = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
  const diaSemana = (iso) => (aFecha(iso).getDay() + 6) % 7;          // 0 = lunes … 6 = domingo
  const lunesDe = (iso) => sumarDias(iso, -diaSemana(iso));
  const esFinde = (iso) => diaSemana(iso) >= 5;
  // Número de semana ISO-8601 (la semana 1 es la que contiene el primer jueves del año)
  function semanaISO(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    const f = new Date(Date.UTC(y, m - 1, d));
    f.setUTCDate(f.getUTCDate() + 3 - ((f.getUTCDay() + 6) % 7));     // jueves de esa semana
    const anio = f.getUTCFullYear();
    return { anio, semana: 1 + Math.floor((f - Date.UTC(anio, 0, 1)) / 864e5 / 7) };
  }
  function sumarMeses(iso, n) {
    const [y, m, d] = iso.split('-').map(Number);
    const ultimo = new Date(y, m - 1 + n + 1, 0).getDate();
    const f = new Date(y, m - 1 + n, Math.min(d, ultimo));
    return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}-${String(f.getDate()).padStart(2, '0')}`;
  }
  const primeroDeMes = (iso) => `${iso.slice(0, 8)}01`;
  const ultimoDeMes = (iso) => sumarDias(sumarMeses(primeroDeMes(iso), 1), -1);
  const diasEntre = (a, b) => { const out = []; for (let f = a; f <= b; f = sumarDias(f, 1)) out.push(f); return out; };

  // Fechas que se cargan (el mes se carga en semanas completas) y fechas que cuentan del periodo
  function rangoCarga() {
    if (estado.periodo === 'semana') { const l = lunesDe(estado.fecha); return [l, sumarDias(l, 6)]; }
    if (estado.periodo === 'mes') return [lunesDe(primeroDeMes(estado.fecha)), sumarDias(lunesDe(ultimoDeMes(estado.fecha)), 6)];
    return [estado.fecha, estado.fecha];
  }
  function rangoPeriodo() {
    if (estado.periodo === 'mes') return [primeroDeMes(estado.fecha), ultimoDeMes(estado.fecha)];
    return rangoCarga();
  }
  const enPeriodo = (iso) => { const [a, b] = rangoPeriodo(); return iso >= a && iso <= b; };
  const MES_CORTO = (iso) => aFecha(iso).toLocaleDateString('es-ES', { month: 'short' }).replace('.', '');
  function tituloPeriodo() {
    const { semana } = semanaISO(estado.fecha);
    if (estado.periodo === 'dia') return `${fechaLarga(estado.fecha)} · S${semana}`;
    if (estado.periodo === 'mes') {
      const t = aFecha(estado.fecha).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
      return t.charAt(0).toUpperCase() + t.slice(1);
    }
    const [a, b] = rangoCarga();
    const [ya, , da] = a.split('-'), [yb, , db] = b.split('-');
    const ini = `${+da}${a.slice(5, 7) !== b.slice(5, 7) ? ` ${MES_CORTO(a)}` : ''}${ya !== yb ? ` ${ya}` : ''}`;
    return `Semana ${semana} · ${ini}–${+db} ${MES_CORTO(b)} ${yb}`;
  }

  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  const durTxt = (h) => `${String(h).replace('.', ',')}h`;
  const puedeEditar = () => estado.usuario && estado.usuario.rol !== 'consulta';

  // Rango visible del día (viene del servidor: jornada + horas extra)
  const J = () => estado.datos.jornada;
  const H_INI = () => J().inicio;
  const H_FIN = () => J().vistaFin;
  const SPAN = () => H_FIN() - H_INI();
  const pct = (h) => `${((h - H_INI()) / SPAN()) * 100}%`;
  const finDelDia = (h) => (h < J().fin ? J().fin : J().vistaFin);

  function toast(msg, error = false) {
    const t = $('#toast');
    const dlg = document.querySelector('dialog[open]');   // con un modal abierto, el aviso va dentro
    (dlg || document.body).append(t);
    t.textContent = msg;
    t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (t.className = 'toast'), 2800);
  }

  async function api(metodo, url, cuerpo) {
    const r = await fetch(url, {
      method: metodo,
      headers: cuerpo ? { 'Content-Type': 'application/json' } : {},
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      credentials: 'same-origin',
    });
    if (r.status === 401) { location.href = '/login.html'; throw new Error('No autenticado'); }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    return data;
  }

  /* ---------- datos ---------- */
  async function cargar() {
    try {
      const [desde, hasta] = rangoCarga();
      const datos = await api('GET', `/api/tablero?desde=${desde}&hasta=${hasta}`);
      if (datos.desde !== rangoCarga()[0]) return;   // llegó tarde: el usuario ya cambió de periodo
      estado.datos = datos;
      pintar();
    } catch (e) { if (e.message !== 'No autenticado') toast(e.message, true); }
  }

  const tarea = (id) => estado.datos.tareas.find((t) => t.id === id);
  const tramo = (id) => estado.datos.tramos.find((t) => t.id === id);
  const pendientes = (t) => Math.max(0, +(t.duracion_h - t.horas_planificadas).toFixed(1));
  const conflictosDe = (tramoId) => estado.datos.conflictos.filter((c) => c.ids.includes(tramoId));

  function pintar() {
    $('#fecha-txt').textContent = tituloPeriodo();
    $('#fecha-input').value = estado.fecha;
    const paso = { dia: 'Día', semana: 'Semana', mes: 'Mes' }[estado.periodo];
    $('#dia-ant').title = `${paso} anterior`; $('#dia-ant').setAttribute('aria-label', `${paso} anterior`);
    $('#dia-sig').title = `${paso === 'Semana' ? 'Semana siguiente' : `${paso} siguiente`}`;
    $('#dia-sig').setAttribute('aria-label', $('#dia-sig').title);
    const url = new URL(location.href);
    url.searchParams.set('fecha', estado.fecha);
    url.searchParams.set('periodo', estado.periodo);
    history.replaceState(null, '', url);
    // si lo seleccionado ya no existe (otro usuario lo quitó), se deselecciona
    if (estado.sel?.tipo === 'tramo' && !tramo(estado.sel.id)) estado.sel = null;
    if (estado.sel?.tipo === 'tarea' && !tarea(estado.sel.id)) estado.sel = null;
    pintarRecursos();
    pintarCalendario();
    pintarOrdenes();
    pintarConflictos();
    pintarDetalle();
    aplicarFiltro();
  }

  /* ---------- recursos (izquierda) ---------- */
  function pintarRecursos() {
    const uso = new Map();   // horas asignadas en el periodo por recurso
    for (const tr of estado.datos.tramos) {
      if (!enPeriodo(tr.fecha)) continue;
      for (const r of tr.asignados) uso.set(r.id, (uso.get(r.id) || 0) + (r.hasta - r.desde));
    }
    // capacidad: jornada × días laborables del periodo (en la vista día, la jornada)
    const laborables = estado.periodo === 'dia' ? 1 : diasEntre(...rangoPeriodo()).filter((f) => !esFinde(f)).length;
    const cap = J().horas * laborables;
    const cuando = { dia: 'hoy', semana: 'esta semana', mes: 'este mes' }[estado.periodo];
    // Con una tarea o un tramo seleccionado, se marcan los recursos que cumplen sus requisitos
    const tSel = estado.sel ? (estado.sel.tipo === 'tarea' ? tarea(estado.sel.id) : tarea(tramo(estado.sel.id)?.tarea_id)) : null;
    const cumple = (r) => !!tSel && (tSel.requisitos.some((q) => q.id === r.id)
      || (tSel.requisitos_tipo || []).some((q) => (r.tipos || []).includes(q.id)));

    for (const tipo of ['operario', 'maquina', 'subcontrata']) {
      $(`#rec-${tipo}`).replaceChildren(...estado.datos.recursos.filter((r) => r.tipo === tipo && r.activo !== false).map((r) => {
        const h = +(uso.get(r.id) || 0).toFixed(1);
        return el('li', {
          class: `rec ${tipo}${h ? ' ocupado' : ''}${h > cap ? ' sobrecarga' : ''}${cumple(r) ? ' cumple' : ''}`,
          draggable: puedeEditar() ? 'true' : 'false',
          'data-buscar': `${r.nombre} ${r.tipos_txt || ''}`.toLowerCase(),
          title: `${cumple(r) ? '✓ Cumple lo que pide la tarea seleccionada\n' : ''}${r.tipos_txt ? r.tipos_txt + ' · ' : ''}${h ? `${durTxt(h)} asignadas ${cuando} (capacidad ${durTxt(cap)})` : `Libre ${cuando}`}`,
          ondragstart: (ev) => {
            estado.arrastre = { tipo: 'recurso', id: r.id };
            ev.dataTransfer.setData(MIME_REC, String(r.id));
            ev.dataTransfer.effectAllowed = 'copy';
          },
          ondragend: finArrastre,
        }, r.nombre, el('span', { class: 'uso' }, h ? `${durTxt(h)}/${durTxt(cap)}` : 'libre'));
      }));
    }
  }

  /* ---------- calendario (centro) ---------- */
  // Dos vistas del mismo día: «Áreas» (filas = áreas, bloques = tramos con una barra por
  // operario) y «Operarios» (filas = operarios, barras = su franja en cada tramo).
  const FILA_TXT = 16, FILA_OP = 15, PAD_B = 6;

  function cabeceraHoras() {
    const horas = el('div', { class: 'horas' });
    for (let h = H_INI(); h <= H_FIN(); h++) {
      const s = el('span', { class: h > J().fin ? 'extra' : '' }, hhmm(h));
      s.style.left = pct(h);
      if (h === H_INI()) s.style.transform = 'none';
      if (h === H_FIN()) s.style.transform = 'translateX(-100%)';
      horas.append(s);
    }
    $('#cal-head').replaceChildren(el('div'), horas);
  }

  function pistaVacia(attrs) {
    const pista = el('div', { class: 'pista', ...attrs });
    if (J().fin < H_FIN()) {
      const z = el('div', { class: 'fuera-jornada', title: 'Fuera de jornada' });
      z.style.left = pct(J().fin);
      z.style.right = '0';
      pista.append(z);
    }
    for (let h = H_INI(); h <= H_FIN(); h++) {
      const r = el('div', { class: `reja${h === J().fin ? ' fin' : ''}` });
      r.style.left = pct(h);
      pista.append(r);
    }
    return pista;
  }

  // Coloca elementos [{ini, fin, alto, nodo}] en carriles para que no se tapen; devuelve el alto total
  function apilar(items, pista, altoMin) {
    items.sort((a, b) => a.ini - b.ini);
    const carriles = [];   // { fin, alto }
    for (const it of items) {
      let c = carriles.findIndex((x) => x.fin <= it.ini);
      if (c === -1) { c = carriles.length; carriles.push({ fin: 0, alto: 0 }); }
      carriles[c].fin = it.fin;
      carriles[c].alto = Math.max(carriles[c].alto, it.alto);
      it.carril = c;
    }
    const tops = [];
    let y = GAP;
    for (const c of carriles) { tops.push(y); y += c.alto + GAP; }
    for (const it of items) { it.nodo.style.top = `${tops[it.carril]}px`; pista.append(it.nodo); }
    return Math.max(y, altoMin);
  }

  function pintarCalendario() {
    const marcar = (sel, attr, valor) => document.querySelectorAll(`${sel} button`).forEach((b) => {
      const activo = b.dataset[attr] === valor;
      b.classList.toggle('activo', activo);
      b.setAttribute('aria-pressed', activo ? 'true' : 'false');
    });
    marcar('#vista-sel', 'vista', estado.vista);
    marcar('#periodo-sel', 'periodo', estado.periodo);
    $('#vista-sel').hidden = estado.periodo === 'mes';
    $('#cal-titulo').textContent = `Calendario central · vista ${{ dia: 'día', semana: 'semana', mes: 'mes' }[estado.periodo]}`;
    $('#cal').className = `cal cal-${estado.periodo}`;
    if (estado.periodo === 'semana') return pintarSemana();
    if (estado.periodo === 'mes') return pintarMes();

    cabeceraHoras();
    if (estado.vista === 'operarios') return pintarVistaOperarios();

    const filas = estado.datos.lineas.map((linea) => {
      const pista = pistaVacia({ 'data-linea': linea.id });
      const items = estado.datos.tramos.filter((tr) => tr.linea_id === linea.id).map((tr) => {
        const nodo = bloque(tr);
        return { ini: tr.hora_inicio, fin: tr.hora_inicio + tr.duracion_h, alto: altoBloque(tr), nodo };
      });
      const alto = apilar(items, pista, BLOQUE_H + 2 * GAP);
      const fila = el('div', { class: `fila${linea.activo ? '' : ' inactiva'}` },
        el('div', { class: 'fila-nombre', title: linea.ubicacion || '' },
          linea.nombre,
          el('span', { class: `tipo-area tipo-${linea.tipo}` }, TIPO_TXT[linea.tipo] || linea.tipo, linea.activo ? '' : ' · inactiva'),
          linea.ubicacion ? el('span', { class: 'ubic' }, linea.ubicacion) : null),
        pista);
      fila.style.minHeight = `${alto}px`;
      prepararDropPista(pista, { lineaId: linea.id });
      return fila;
    });

    if (!filas.length) {
      $('#cal-body').replaceChildren(el('p', { class: 'cal-vacio' },
        'No hay áreas de trabajo activas. Crea una con el botón «Áreas de trabajo».'));
      return;
    }
    const sinArea = estado.datos.tramos.filter((tr) => !estado.datos.lineas.some((l) => l.id === tr.linea_id));
    const aviso = sinArea.length ? [el('p', { class: 'ayuda' },
      `${sinArea.length} tramo(s) de hoy no tienen área: míralos en la vista «Operarios» o muévelos a un área.`)] : [];
    $('#cal-body').replaceChildren(...filas, ...aviso);
  }

  const operariosDe = (tr) => tr.asignados.filter((r) => r.tipo === 'operario');
  const otrosRecursos = (tr) => tr.asignados.filter((r) => r.tipo !== 'operario');
  const altoBloque = (tr) => Math.max(BLOQUE_H,
    PAD_B * 2 + FILA_TXT * 2 + Math.max(1, operariosDe(tr).length) * FILA_OP + (otrosRecursos(tr).length ? FILA_OP : 0));

  function bloque(tr) {
    const t = tarea(tr.tarea_id);
    const ini = Math.max(tr.hora_inicio, H_INI());
    const fin = Math.min(tr.hora_inicio + tr.duracion_h, H_FIN());
    const confs = conflictosDe(tr.id).filter((c) => !c.leve);
    const varios = t.tramos.length > 1 || pendientes(t) > 0;
    const parte = varios ? ` · tramo ${tr.indice}${pendientes(t) ? '' : `/${t.tramos.length}`} de ${durTxt(t.duracion_h)}` : '';
    const sel = estado.sel?.tipo === 'tramo' && estado.sel.id === tr.id;
    const hermano = !sel && estado.sel && (estado.sel.tipo === 'tarea' ? estado.sel.id : tramo(estado.sel.id)?.tarea_id) === t.id;
    const editar = puedeEditar();

    const b = el('div', {
      class: `bloque${confs.length ? ' conflicto' : ''}${sel ? ' sel' : ''}${hermano ? ' hermano' : ''}${t.estado === 'hecha' ? ' hecha' : ''}`,
      draggable: editar ? 'true' : 'false', tabindex: '0', role: 'button',
      'data-tramo': tr.id,
      'data-buscar': `${t.orden_codigo} ${t.orden_titulo} ${t.nombre} ${tr.asignados.map((r) => r.nombre).join(' ')} ${t.proyecto || ''}`.toLowerCase(),
      'aria-label': `${t.orden_codigo} ${t.nombre}${parte}, ${hhmm(tr.hora_inicio)} a ${hhmm(tr.hora_inicio + tr.duracion_h)}`,
      title: `${hhmm(tr.hora_inicio)}–${hhmm(tr.hora_inicio + tr.duracion_h)} · ${durTxt(tr.duracion_h)}`
        + (tr.exceso ? ` · ${durTxt(tr.exceso)} sobre lo estimado` : '') + (confs.length ? ' · tiene avisos' : '')
        + (editar ? '\nBordes del bloque: horas del tramo · Bordes de cada operario: su franja · Mayús + ← →' : ''),
      onclick: () => seleccionar({ tipo: 'tramo', id: tr.id }),
      onkeydown: (ev) => {
        if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); seleccionar({ tipo: 'tramo', id: tr.id }); }
        if (ev.shiftKey && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && editar) {
          ev.preventDefault();
          const f0 = tr.hora_inicio + tr.duracion_h;
          const f = Math.min(Math.max(f0 + (ev.key === 'ArrowRight' ? PASO : -PASO), tr.hora_inicio + PASO), H_FIN());
          if (f !== f0) guardarResizeTramo(tr, tr.hora_inicio, f);
        }
      },
      ondragstart: (ev) => {
        const rect = b.getBoundingClientRect();
        const ancho = b.parentElement.getBoundingClientRect().width;
        const agarre = ((ev.clientX - rect.left) / ancho) * SPAN();
        estado.arrastre = { tipo: 'tramo', id: tr.id, agarre: Math.floor(agarre / PASO) * PASO };
        ev.dataTransfer.setData(MIME_TRAMO, String(tr.id));
        ev.dataTransfer.effectAllowed = 'move';
      },
      ondragend: finArrastre,
    },
      el('div', { class: 'tit' }, `${t.orden_codigo} · ${t.orden_titulo}`),
      el('div', { class: 'sub' }, `${t.nombre} · ${durTxt(tr.duracion_h)}${parte}`),
    );
    b.style.setProperty('--c', t.orden_color);
    b.style.left = pct(ini);
    b.style.width = `calc(${((fin - ini) / SPAN()) * 100}% - 3px)`;
    b.style.height = `${altoBloque(tr)}px`;

    // exceso sobre lo estimado: cola rayada al final del bloque
    if (tr.exceso > 0) {
      const ex = el('div', { class: 'exceso', title: `${durTxt(tr.exceso)} por encima de lo estimado` });
      ex.style.width = `${(tr.exceso / tr.duracion_h) * 100}%`;
      b.append(ex);
    }

    // una barra por operario con su franja (redimensionable) + resto de recursos en una línea
    const ops = operariosDe(tr);
    const barras = el('div', { class: 'franjas' });
    if (!ops.length) barras.append(el('div', { class: 'sin-ops' }, t.operarios_req ? 'sin operarios · arrastra uno aquí' : 'sin operarios'));
    for (const r of ops) barras.append(barraFranja(tr, r, b));
    b.append(barras);
    if (otrosRecursos(tr).length) b.append(el('div', { class: 'rec-asig' }, otrosRecursos(tr).map((r) => `◇ ${r.nombre}`).join('  ')));

    // asas del bloque: horas del tramo
    if (editar) {
      for (const lado of ['izq', 'der']) {
        const asa = el('span', {
          class: `asa asa-${lado}`, 'aria-hidden': 'true',
          title: lado === 'der' ? 'Arrastra para cambiar la hora de fin del tramo' : 'Arrastra para cambiar la hora de inicio del tramo',
          ondragstart: (ev) => ev.preventDefault(),
          onpointerdown: (ev) => resizeTramo(ev, lado, tr, b, asa),
          onclick: (ev) => ev.stopPropagation(),
        });
        b.append(asa);
      }
    }

    // soltar un recurso encima = asignarlo a este tramo
    b.addEventListener('dragover', (ev) => {
      if (estado.arrastre?.tipo !== 'recurso') return;
      ev.preventDefault(); ev.stopPropagation();
      ev.dataTransfer.dropEffect = 'copy';
      b.classList.add('recibe');
    });
    b.addEventListener('dragleave', () => b.classList.remove('recibe'));
    b.addEventListener('drop', async (ev) => {
      if (estado.arrastre?.tipo !== 'recurso') return;
      ev.preventDefault(); ev.stopPropagation();
      b.classList.remove('recibe');
      const recId = Number(ev.dataTransfer.getData(MIME_REC));
      if (tr.asignados.some((r) => r.id === recId)) return toast('Ese recurso ya está en este tramo');
      await accion(() => api('POST', `/api/tramos/${tr.id}/asignaciones`, { recurso_id: recId }), 'Recurso asignado');
    });
    return b;
  }

  // Barra de la franja de un operario dentro del bloque del tramo
  function barraFranja(tr, r, b) {
    const dur = tr.duracion_h;
    const parcial = r.desde > tr.hora_inicio || r.hasta < tr.hora_inicio + dur;
    const fila = el('div', { class: 'franja-fila' });
    const barra = el('div', {
      class: `franja${parcial ? ' parcial' : ''}`,
      title: `${r.nombre}: ${hhmm(r.desde)}–${hhmm(r.hasta)} · ${durTxt(r.hasta - r.desde)}`,
    }, el('span', { class: 'f-nom' }, `${r.nombre}${parcial ? ` · ${hhmm(r.desde)}–${hhmm(r.hasta)}` : ''}`));
    barra.style.left = `${((r.desde - tr.hora_inicio) / dur) * 100}%`;
    barra.style.width = `${((r.hasta - r.desde) / dur) * 100}%`;
    if (puedeEditar()) {
      for (const lado of ['izq', 'der']) {
        barra.append(el('span', {
          class: `asa-f asa-f-${lado}`, 'aria-hidden': 'true',
          title: `Arrastra para cambiar la franja de ${r.nombre}`,
          ondragstart: (ev) => ev.preventDefault(),
          onpointerdown: (ev) => resizeFranja(ev, lado, tr, r, b, barra),
          onclick: (ev) => ev.stopPropagation(),
        }));
      }
    }
    fila.append(barra);
    return fila;
  }

  /* ---------- redimensionar (tramos y franjas) ---------- */
  // Arrastre de un borde con el ratón o el dedo, encajando cada media hora.
  function arrastrarBorde(ev, { asa, pista, nodo, lado, ini0, fin0, min, max, previa, fin }) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const r = pista.getBoundingClientRect();
    let ini = ini0, f = fin0, tope = false;
    estado.arrastre = { tipo: 'resize' };   // pausa el refresco automático
    if (nodo) nodo.draggable = false;
    asa.setPointerCapture(ev.pointerId);

    const mover = (e) => {
      const x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
      const h = Math.round((H_INI() + (x / r.width) * SPAN()) / PASO) * PASO;
      if (lado === 'der') { f = Math.min(Math.max(h, ini + PASO), max); tope = h > max; }
      else { ini = Math.max(Math.min(h, f - PASO), min); tope = h < min; }
      previa(ini, f, tope);
    };
    const terminar = (cancelado) => {
      asa.removeEventListener('pointermove', mover);
      asa.removeEventListener('pointerup', alSoltar);
      asa.removeEventListener('pointercancel', alCancelar);
      estado.arrastre = null;
      if (cancelado || (ini === ini0 && f === fin0)) { pintarCalendario(); return; }
      fin(ini, f, tope);
    };
    const alSoltar = () => terminar(false);
    const alCancelar = () => terminar(true);
    asa.addEventListener('pointermove', mover);
    asa.addEventListener('pointerup', alSoltar);
    asa.addEventListener('pointercancel', alCancelar);
    previa(ini, f, false);
  }

  function etiquetaPrevia(nodo) {
    let info = nodo.querySelector(':scope > .resize-info');
    if (!info) { info = el('span', { class: 'resize-info' }); nodo.append(info); }
    nodo.classList.add('redimensionando');
    return info;
  }

  function resizeTramo(ev, lado, tr, b, asa) {
    const t = tarea(tr.tarea_id);
    const info = etiquetaPrevia(b);
    arrastrarBorde(ev, {
      asa, pista: b.parentElement, nodo: b, lado,
      ini0: tr.hora_inicio, fin0: tr.hora_inicio + tr.duracion_h, min: H_INI(), max: H_FIN(),
      previa: (ini, fin) => {
        b.style.left = pct(ini);
        b.style.width = `calc(${((fin - ini) / SPAN()) * 100}% - 3px)`;
        const total = t.horas_planificadas - tr.duracion_h + (fin - ini);
        const exceso = +(total - t.duracion_h).toFixed(1);
        info.textContent = `${hhmm(ini)}–${hhmm(fin)} · ${durTxt(fin - ini)}${exceso > 0 ? ` · +${durTxt(exceso)} sobre lo estimado` : ''}`;
        b.classList.toggle('tope', exceso > 0);
      },
      fin: (ini, fin) => guardarResizeTramo(tr, ini, fin),
    });
  }

  async function guardarResizeTramo(tr, ini, fin) {
    estado.sel = { tipo: 'tramo', id: tr.id };
    const cambios = { duracion_h: +(fin - ini).toFixed(1) };
    if (ini !== tr.hora_inicio) cambios.hora_inicio = ini;
    let ok = false;
    await accion(async () => {
      const r = await api('PATCH', `/api/tramos/${tr.id}`, cambios);
      ok = true;
      return `Tramo ${hhmm(ini)}–${hhmm(fin)} · ${durTxt(fin - ini)}${r.exceso ? ` · la tarea va ${durTxt(r.exceso)} por encima de lo estimado` : ''}`;
    });
    if (ok && fin > tr.hora_inicio + tr.duracion_h) await proponerEmpuje(tr.id);
  }

  function resizeFranja(ev, lado, tr, r, b, barra) {
    const info = etiquetaPrevia(b);
    const dur = tr.duracion_h;
    arrastrarBorde(ev, {
      asa: ev.currentTarget, pista: b.parentElement, nodo: b, lado,
      ini0: r.desde, fin0: r.hasta, min: tr.hora_inicio, max: tr.hora_inicio + dur,
      previa: (ini, fin, tope) => {
        barra.style.left = `${((ini - tr.hora_inicio) / dur) * 100}%`;
        barra.style.width = `${((fin - ini) / dur) * 100}%`;
        info.textContent = `${r.nombre}: ${hhmm(ini)}–${hhmm(fin)} · ${durTxt(fin - ini)}${tope ? ' · para más, estira el tramo' : ''}`;
      },
      fin: (ini, fin) => guardarFranja(tr, r, ini, fin),
    });
  }

  async function guardarFranja(tr, r, ini, fin) {
    estado.sel = { tipo: 'tramo', id: tr.id };
    let ok = false;
    await accion(async () => {
      await api('PATCH', `/api/tramos/${tr.id}/asignaciones/${r.id}`, { desde: ini, hasta: fin });
      ok = true;
      return `${r.nombre}: ${hhmm(ini)}–${hhmm(fin)} · ${durTxt(fin - ini)}`;
    });
    if (ok && fin > r.hasta) await proponerEmpuje(tr.id);
  }

  /* ---------- empujar lo siguiente ---------- */
  async function proponerEmpuje(tramoId, { siempre = false } = {}) {
    let r;
    try { r = await api('POST', `/api/tramos/${tramoId}/empujar`, {}); } catch (e) { toast(e.message, true); return; }
    if (!r.cambios.length) { if (siempre) toast('No hay nada que empujar: lo siguiente no se solapa'); return; }
    const dlg = $('#dlg-empujar');
    $('#empujar-lista').replaceChildren(...r.cambios.map((c) => el('li', { class: c.quitar ? 'quitar' : c.recorte ? 'recorte' : '' }, c.texto)));
    $('#empujar-si').onclick = async () => {
      dlg.close();
      await accion(async () => {
        const x = await api('POST', `/api/tramos/${tramoId}/empujar`, { aplicar: true });
        return `Empujados ${x.cambios.length} tramo(s)`;
      });
    };
    $('#empujar-no').onclick = () => dlg.close();
    dlg.showModal();
    $('#empujar-si').focus();
  }

  /* ---------- vista por operario ---------- */
  function pintarVistaOperarios() {
    const operarios = estado.datos.recursos.filter((r) => r.tipo === 'operario');
    const usos = new Map(operarios.map((o) => [o.id, []]));
    const sinOperario = [];
    for (const tr of estado.datos.tramos) {
      const ops = operariosDe(tr);
      if (!ops.length) sinOperario.push({ tr, r: null });
      for (const r of ops) usos.get(r.id)?.push({ tr, r });
    }
    const solapados = new Set(estado.datos.conflictos.filter((c) => c.tipo === 'solape').flatMap((c) => c.ids.map((id) => `${c.recurso_id}:${id}`)));

    const fila = (titulo, sub, clase, attrs, lista, recurso) => {
      const pista = pistaVacia(attrs);
      const items = lista.map((u) => ({
        ini: u.r ? u.r.desde : u.tr.hora_inicio,
        fin: u.r ? u.r.hasta : u.tr.hora_inicio + u.tr.duracion_h,
        alto: 40,
        nodo: barraOperario(u.tr, u.r, solapados.has(`${u.r?.id}:${u.tr.id}`)),
      }));
      const alto = apilar(items, pista, 40 + 2 * GAP);
      const f = el('div', { class: `fila ${clase}` }, el('div', { class: 'fila-nombre' }, titulo, sub ? el('span', { class: 'ubic' }, sub) : null), pista);
      f.style.minHeight = `${alto}px`;
      prepararDropPista(pista, { recurso });
      return f;
    };

    const filas = operarios.map((o) => {
      const h = usos.get(o.id).reduce((s, u) => s + (u.r.hasta - u.r.desde), 0);
      return fila(o.nombre, h ? `${durTxt(h)} de ${J().horas}h` : 'libre', h > J().horas ? 'sobrecarga' : '',
        { 'data-recurso': o.id }, usos.get(o.id), o);
    });
    if (sinOperario.length) {
      filas.push(fila('Sin operario', 'arrastra a una persona', 'sin-operario', {}, sinOperario, null));
    }
    $('#cal-body').replaceChildren(...(filas.length ? filas : [el('p', { class: 'cal-vacio' }, 'No hay operarios dados de alta.')]));
  }

  function barraOperario(tr, r, solapada) {
    const t = tarea(tr.tarea_id);
    const ini = r ? r.desde : tr.hora_inicio;
    const fin = r ? r.hasta : tr.hora_inicio + tr.duracion_h;
    const area = estado.datos.lineas.find((l) => l.id === tr.linea_id)?.nombre || 'sin área';
    const sel = estado.sel?.tipo === 'tramo' && estado.sel.id === tr.id;
    const editar = puedeEditar();
    const b = el('div', {
      class: `bloque op${solapada ? ' conflicto' : ''}${sel ? ' sel' : ''}${r ? '' : ' sin-op'}`,
      draggable: editar ? 'true' : 'false', tabindex: '0', role: 'button',
      'data-tramo': tr.id,
      'data-buscar': `${t.orden_codigo} ${t.orden_titulo} ${t.nombre} ${r?.nombre || ''} ${area}`.toLowerCase(),
      title: `${t.orden_codigo} · ${t.nombre}\n${hhmm(ini)}–${hhmm(fin)} · ${durTxt(fin - ini)} · ${area}`
        + (editar ? (r ? '\nBordes: franja de este operario · Arrástrala a otra persona para cambiarla' : '\nArrástralo a una persona para asignarla') : ''),
      onclick: () => seleccionar({ tipo: 'tramo', id: tr.id }),
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); seleccionar({ tipo: 'tramo', id: tr.id }); } },
      ondragstart: (ev) => {
        estado.arrastre = { tipo: 'franja', id: tr.id, recurso: r?.id ?? null };
        ev.dataTransfer.setData(MIME_TRAMO, String(tr.id));
        ev.dataTransfer.effectAllowed = 'move';
      },
      ondragend: finArrastre,
    },
      el('div', { class: 'tit' }, `${t.orden_codigo} · ${t.nombre}`),
      el('div', { class: 'sub' }, `${hhmm(ini)}–${hhmm(fin)} · ${durTxt(fin - ini)} · ${area}`),
    );
    b.style.setProperty('--c', t.orden_color);
    b.style.left = pct(Math.max(ini, H_INI()));
    b.style.width = `calc(${((Math.min(fin, H_FIN()) - Math.max(ini, H_INI())) / SPAN()) * 100}% - 3px)`;
    b.style.height = '40px';
    if (editar && r) {
      for (const lado of ['izq', 'der']) {
        b.append(el('span', {
          class: `asa asa-${lado}`, 'aria-hidden': 'true',
          title: 'Arrastra para cambiar la franja de este operario',
          ondragstart: (ev) => ev.preventDefault(),
          onpointerdown: (ev) => {
            const info = etiquetaPrevia(b);
            arrastrarBorde(ev, {
              asa: ev.currentTarget, pista: b.parentElement, nodo: b, lado,
              ini0: r.desde, fin0: r.hasta, min: tr.hora_inicio, max: tr.hora_inicio + tr.duracion_h,
              previa: (i, f, tope) => {
                b.style.left = pct(i);
                b.style.width = `calc(${((f - i) / SPAN()) * 100}% - 3px)`;
                info.textContent = `${hhmm(i)}–${hhmm(f)} · ${durTxt(f - i)}${tope ? ' · límite del tramo' : ''}`;
              },
              fin: (i, f) => guardarFranja(tr, r, i, f),
            });
          },
          onclick: (ev) => ev.stopPropagation(),
        }));
      }
    }
    return b;
  }

  /* ---------- soltar en una fila (área u operario) ---------- */
  function horaDesdeEvento(ev, pista, agarre = 0) {
    const r = pista.getBoundingClientRect();
    const x = Math.min(Math.max(ev.clientX - r.left, 0), r.width);
    let h = H_INI() + (x / r.width) * SPAN() - agarre;
    h = Math.round(h / PASO) * PASO;
    return Math.min(Math.max(h, H_INI()), H_FIN() - PASO);
  }

  // Qué ocuparía lo que se arrastra si se suelta a la hora h: [inicio, horas]
  function previsto(h) {
    const a = estado.arrastre;
    if (a.tipo === 'tramo') return [h, tramo(a.id)?.duracion_h || 1];
    if (a.tipo === 'franja') {
      const tr = tramo(a.id);
      const r = tr && operariosDe(tr).find((x) => x.id === a.recurso);
      return r ? [r.desde, r.hasta - r.desde] : [tr.hora_inicio, tr.duracion_h];
    }
    const t = tarea(a.id);
    return [h, Math.max(PASO, Math.min(pendientes(t), finDelDia(h) - h))];
  }

  function prepararDropPista(pista, { lineaId = null, recurso = undefined }) {
    const enOperarios = recurso !== undefined;
    let marca = null;
    const quitarMarca = () => { marca?.remove(); marca = null; pista.classList.remove('drop'); };
    const valido = () => {
      const a = estado.arrastre;
      if (!a) return false;
      if (enOperarios) return recurso && (a.tipo === 'tarea' || (a.tipo === 'franja' && a.recurso !== recurso.id));
      return a.tipo === 'tarea' || a.tipo === 'tramo';
    };

    pista.addEventListener('dragover', (ev) => {
      if (!valido()) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      const [h, d] = previsto(horaDesdeEvento(ev, pista, estado.arrastre.agarre || 0));
      pista.classList.add('drop');
      if (!marca) { marca = el('div', { class: 'marca-drop' }, el('span')); pista.append(marca); }
      marca.style.left = pct(h);
      marca.style.width = `${(Math.min(d, H_FIN() - h) / SPAN()) * 100}%`;
      let txt = `${hhmm(h)}–${hhmm(h + d)} · ${durTxt(d)}`;
      if (estado.arrastre.tipo === 'tarea') {
        const resto = pendientes(tarea(estado.arrastre.id)) - d;
        if (resto > 0) txt += ` · quedan ${durTxt(resto)}`;
      }
      if (estado.arrastre.tipo === 'franja') txt = `${recurso.nombre} · ${txt}`;
      marca.firstChild.textContent = txt;
    });
    pista.addEventListener('dragleave', (ev) => { if (!pista.contains(ev.relatedTarget)) quitarMarca(); });
    pista.addEventListener('drop', async (ev) => {
      if (!valido()) return;
      ev.preventDefault();
      const a = estado.arrastre;
      const h = horaDesdeEvento(ev, pista, a.agarre || 0);
      quitarMarca();
      if (a.tipo === 'tarea') {
        await accion(async () => {
          const r = await api('POST', `/api/tareas/${a.id}/tramos`,
            { fecha: estado.fecha, hora_inicio: h, ...(enOperarios ? { recurso_id: recurso.id } : { linea_id: lineaId }) });
          estado.sel = { tipo: 'tramo', id: r.tramo.id };
          return r.pendientes > 0 ? `Planificadas ${durTxt(r.tramo.duracion_h)} · quedan ${durTxt(r.pendientes)} por planificar`
            : `Planificada a las ${hhmm(h)}`;
        });
      } else if (a.tipo === 'franja') {
        estado.sel = { tipo: 'tramo', id: a.id };
        await accion(async () => {
          if (a.recurso) await api('PATCH', `/api/tramos/${a.id}/asignaciones/${a.recurso}`, { recurso_id: recurso.id });
          else await api('POST', `/api/tramos/${a.id}/asignaciones`, { recurso_id: recurso.id });
          return `Pasado a ${recurso.nombre}`;
        });
      } else {
        estado.sel = { tipo: 'tramo', id: a.id };
        await accion(() => api('PATCH', `/api/tramos/${a.id}`, { fecha: estado.fecha, hora_inicio: h, linea_id: lineaId }),
          `Movido a las ${hhmm(h)}`);
      }
    });
  }

  /* ---------- vistas semana y mes ---------- */
  // Semana: columnas lunes–domingo, filas = áreas u operarios (igual que la vista día).
  // Mes: cuadrícula por semanas con su número (ISO). En las dos, cada tramo es una ficha que se
  // arrastra a otro día (conserva la hora) y una tarea del panel derecho se suelta en un día:
  // se planifica en el primer hueco libre de la jornada.
  const hoyEs = (iso) => iso === hoyISO();

  function irAPeriodo(periodo, fecha) {
    estado.periodo = periodo;
    estado.fecha = fecha;
    guardarPref('periodo', periodo);
    cargar();
  }

  function cabeceraDia(f, attrs = {}) {
    return el('button', {
      type: 'button', class: `dia-cab${hoyEs(f) ? ' hoy' : ''}${esFinde(f) ? ' finde' : ''}`,
      title: 'Abrir este día en la vista día', onclick: () => irAPeriodo('dia', f), ...attrs,
    }, fechaCorta(f));
  }

  function chipTramo(tr, r = null, { compacto = false } = {}) {
    const t = tarea(tr.tarea_id);
    const ini = r ? r.desde : tr.hora_inicio;
    const fin = r ? r.hasta : tr.hora_inicio + tr.duracion_h;
    const confs = conflictosDe(tr.id).filter((c) => !c.leve);
    const sel = estado.sel?.tipo === 'tramo' && estado.sel.id === tr.id;
    const hermano = !sel && estado.sel && (estado.sel.tipo === 'tarea' ? estado.sel.id : tramo(estado.sel.id)?.tarea_id) === t.id;
    const area = estado.datos.lineas.find((l) => l.id === tr.linea_id)?.nombre || 'sin área';
    const gente = operariosDe(tr).map((x) => x.nombre).join(', ');
    const editar = puedeEditar();
    const c = el('div', {
      class: `chip-tr${confs.length ? ' conflicto' : ''}${sel ? ' sel' : ''}${hermano ? ' hermano' : ''}${t.estado === 'hecha' ? ' hecha' : ''}${r === undefined ? ' sin-op' : ''}`,
      draggable: editar ? 'true' : 'false', tabindex: '0', role: 'button', 'data-tramo': tr.id,
      'data-buscar': `${t.orden_codigo} ${t.orden_titulo} ${t.nombre} ${tr.asignados.map((x) => x.nombre).join(' ')} ${t.proyecto || ''} ${area}`.toLowerCase(),
      title: `${t.orden_codigo} · ${t.orden_titulo}\n${t.nombre} · ${hhmm(ini)}–${hhmm(fin)} · ${durTxt(fin - ini)}\n${area}${gente ? ` · ${gente}` : ' · sin operarios'}`
        + (confs.length ? `\n⚠ ${confs.map((x) => x.mensaje).join('\n⚠ ')}` : '')
        + (editar ? '\nArrástralo a otro día (conserva la hora)' : ''),
      onclick: () => seleccionar({ tipo: 'tramo', id: tr.id }),
      onkeydown: (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); seleccionar({ tipo: 'tramo', id: tr.id }); } },
      ondragstart: (ev) => {
        estado.arrastre = { tipo: 'tramo', id: tr.id, recurso: r ? r.id : null };
        ev.dataTransfer.setData(MIME_TRAMO, String(tr.id));
        ev.dataTransfer.effectAllowed = 'move';
      },
      ondragend: finArrastre,
    },
      compacto
        ? el('span', { class: 'ct-tit' }, el('span', { class: 'ct-hora' }, hhmm(ini)), ` ${t.nombre}`)
        : el('span', { class: 'ct-tit dos' }, el('span', { class: 'ct-ot' }, t.orden_codigo), ` ${t.nombre}`),
      compacto ? null : el('span', { class: 'ct-sub' }, `${hhmm(ini)}–${hhmm(fin)} · ${durTxt(fin - ini)}`),
      compacto ? null : el('span', { class: 'ct-sub' }, estado.vista === 'operarios' && r !== null ? area : gente || 'sin operarios'),
    );
    c.style.setProperty('--c', t.orden_color);
    return c;
  }

  // Primera hora libre de un día en un área o para un operario (null si la jornada está llena)
  function hueco(fecha, { lineaId = null, recursoId = null }) {
    let fin = J().inicio;
    for (const tr of estado.datos.tramos) {
      if (tr.fecha !== fecha) continue;
      if (lineaId && tr.linea_id === lineaId) fin = Math.max(fin, tr.hora_inicio + tr.duracion_h);
      if (recursoId) for (const r of tr.asignados) if (r.id === recursoId) fin = Math.max(fin, r.hasta);
    }
    fin = Math.ceil(fin / PASO - 1e-9) * PASO;
    return fin < J().fin ? fin : null;
  }

  // Soltar en una celda (día): modo 'area' | 'operario' | 'mes'
  function prepararDropCelda(celda, { fecha, modo, lineaId = null, recurso = null }) {
    const valido = () => {
      const a = estado.arrastre;
      if (!a || (a.tipo !== 'tarea' && a.tipo !== 'tramo')) return false;
      if (modo === 'operario' && !recurso) return false;
      return true;
    };
    celda.addEventListener('dragover', (ev) => {
      if (!valido()) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      celda.classList.add('drop');
    });
    celda.addEventListener('dragleave', (ev) => { if (!celda.contains(ev.relatedTarget)) celda.classList.remove('drop'); });
    celda.addEventListener('drop', async (ev) => {
      if (!valido()) return;
      ev.preventDefault();
      celda.classList.remove('drop');
      const a = estado.arrastre;

      if (a.tipo === 'tarea') {
        const t = tarea(a.id);
        const linea = modo === 'area' ? lineaId : modo === 'mes' ? t.linea_id : null;
        if (modo === 'mes' && !linea) return toast('La tarea no tiene área por defecto: suéltala en la vista semana (Áreas) o asígnale un área en Proyectos y OTs', true);
        const h = hueco(fecha, modo === 'operario' ? { recursoId: recurso.id } : { lineaId: linea });
        if (h == null) return toast(`El ${fechaCorta(fecha)} ya está lleno hasta el fin de jornada: ábrelo en la vista día para usar horas extra`, true);
        await accion(async () => {
          const r = await api('POST', `/api/tareas/${a.id}/tramos`,
            { fecha, hora_inicio: h, ...(modo === 'operario' ? { recurso_id: recurso.id } : { linea_id: linea }) });
          estado.sel = { tipo: 'tramo', id: r.tramo.id };
          return `Planificada el ${fechaCorta(fecha)} a las ${hhmm(h)} · ${durTxt(r.tramo.duracion_h)}`
            + (r.pendientes > 0 ? ` · quedan ${durTxt(r.pendientes)} por planificar` : '');
        });
        return;
      }

      // mover un tramo: a otro día (y otra área / otro operario en la vista semana)
      const tr = tramo(a.id);
      if (!tr) return;
      estado.sel = { tipo: 'tramo', id: tr.id };
      const cambios = {};
      if (fecha !== tr.fecha) cambios.fecha = fecha;
      if (modo === 'area' && lineaId !== tr.linea_id) cambios.linea_id = lineaId;
      const otraPersona = modo === 'operario' && a.recurso !== recurso.id;
      if (!Object.keys(cambios).length && !otraPersona) return;
      if (otraPersona && tr.asignados.some((x) => x.id === recurso.id)) {
        if (!Object.keys(cambios).length) return toast(`${recurso.nombre} ya está en ese tramo`);
      }
      await accion(async () => {
        if (otraPersona && !tr.asignados.some((x) => x.id === recurso.id)) {
          if (a.recurso) await api('PATCH', `/api/tramos/${tr.id}/asignaciones/${a.recurso}`, { recurso_id: recurso.id });
          else await api('POST', `/api/tramos/${tr.id}/asignaciones`, { recurso_id: recurso.id });
        }
        if (Object.keys(cambios).length) await api('PATCH', `/api/tramos/${tr.id}`, cambios);
        return [cambios.fecha ? `Movido al ${fechaCorta(fecha)} (${hhmm(tr.hora_inicio)})` : null,
          otraPersona ? `pasado a ${recurso.nombre}` : null,
          cambios.linea_id ? `área ${estado.datos.lineas.find((l) => l.id === lineaId)?.nombre}` : null].filter(Boolean).join(' · ');
      });
    });
  }

  function pintarSemana() {
    const dias = diasEntre(...rangoCarga());
    const { semana } = semanaISO(dias[0]);
    $('#cal-head').replaceChildren(
      el('div', { class: 'sem-num', title: `Semana ${semana} del año (ISO)` }, `S${semana}`),
      ...dias.map((f) => cabeceraDia(f)));

    const tramosDe = (f, filtro) => estado.datos.tramos.filter((tr) => tr.fecha === f && filtro(tr))
      .sort((a, b) => a.hora_inicio - b.hora_inicio || a.id - b.id);
    const filaSemana = (nombre, sub, clase, celdas) =>
      el('div', { class: `fila-sem ${clase}` }, el('div', { class: 'fila-nombre' }, ...nombre, sub ? el('span', { class: 'ubic' }, sub) : null), ...celdas);
    const celda = (f, hijos, pie, opts) => {
      const c = el('div', { class: `celda${hoyEs(f) ? ' hoy' : ''}${esFinde(f) ? ' finde' : ''}` }, ...hijos,
        pie ? el('div', { class: `celda-pie${pie.clase ? ` ${pie.clase}` : ''}` }, pie.txt) : null);
      prepararDropCelda(c, { fecha: f, ...opts });
      return c;
    };

    let filas;
    if (estado.vista === 'operarios') {
      const operarios = estado.datos.recursos.filter((r) => r.tipo === 'operario');
      filas = operarios.map((o) => {
        let total = 0;
        const celdas = dias.map((f) => {
          const usos = tramosDe(f, (tr) => tr.asignados.some((r) => r.id === o.id))
            .map((tr) => ({ tr, r: tr.asignados.find((x) => x.id === o.id) }))
            .sort((a, b) => a.r.desde - b.r.desde);
          const h = usos.reduce((s, u) => s + (u.r.hasta - u.r.desde), 0);
          total += h;
          return celda(f, usos.map((u) => chipTramo(u.tr, u.r)),
            h ? { txt: `${durTxt(+h.toFixed(1))}/${J().horas}h`, clase: h > J().horas ? 'sobrecarga' : '' } : null,
            { modo: 'operario', recurso: o });
        });
        return filaSemana([o.nombre], total ? `${durTxt(+total.toFixed(1))} en la semana` : 'libre', '', celdas);
      });
      const sinOp = estado.datos.tramos.filter((tr) => !operariosDe(tr).length);
      if (sinOp.length) {
        filas.push(filaSemana(['Sin operario'], 'arrastra a una persona', 'sin-operario',
          dias.map((f) => celda(f, tramosDe(f, (tr) => !operariosDe(tr).length).map((tr) => chipTramo(tr, undefined)), null, { modo: 'operario' }))));
      }
      if (!operarios.length) filas = [el('p', { class: 'cal-vacio' }, 'No hay operarios dados de alta.')];
    } else {
      filas = estado.datos.lineas.map((linea) => {
        let total = 0;
        const celdas = dias.map((f) => {
          const lista = tramosDe(f, (tr) => tr.linea_id === linea.id);
          const h = lista.reduce((s, tr) => s + tr.duracion_h, 0);
          total += h;
          return celda(f, lista.map((tr) => chipTramo(tr)),
            h ? { txt: durTxt(+h.toFixed(1)), clase: h > J().horas ? 'sobrecarga' : '' } : null,
            { modo: 'area', lineaId: linea.id });
        });
        return filaSemana([linea.nombre, el('span', { class: `tipo-area tipo-${linea.tipo}` }, TIPO_TXT[linea.tipo] || linea.tipo, linea.activo ? '' : ' · inactiva')],
          total ? `${durTxt(+total.toFixed(1))} en la semana` : '', linea.activo ? '' : 'inactiva', celdas);
      });
      if (!filas.length) filas = [el('p', { class: 'cal-vacio' }, 'No hay áreas de trabajo activas. Crea una con el botón «Áreas de trabajo».')];
    }
    $('#cal-body').replaceChildren(...filas);
  }

  function pintarMes() {
    const [desde, hasta] = rangoCarga();
    const mes = estado.fecha.slice(0, 7);
    const nombres = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom'];
    $('#cal-head').replaceChildren(el('div', { class: 'sem-num' }, 'Sem'),
      ...nombres.map((n, i) => el('div', { class: `dia-cab${i >= 5 ? ' finde' : ''}` }, n)));

    const nOps = estado.datos.recursos.filter((r) => r.tipo === 'operario' && r.activo !== false).length;
    const MAX_FICHAS = 4;
    const semanas = [];
    for (let l = desde; l <= hasta; l = sumarDias(l, 7)) {
      const { semana } = semanaISO(l);
      const celdas = diasEntre(l, sumarDias(l, 6)).map((f) => {
        const lista = estado.datos.tramos.filter((tr) => tr.fecha === f)
          .sort((a, b) => a.hora_inicio - b.hora_inicio || a.id - b.id);
        const horasOp = lista.reduce((s, tr) => s + operariosDe(tr).reduce((x, r) => x + (r.hasta - r.desde), 0), 0);
        const carga = nOps ? horasOp / (nOps * J().horas) : 0;
        const conf = estado.datos.conflictos.some((c) => c.fecha === f && !c.leve);
        const resto = lista.length - MAX_FICHAS;
        const c = el('div', { class: `celda mes-dia${f.slice(0, 7) !== mes ? ' fuera' : ''}${hoyEs(f) ? ' hoy' : ''}${esFinde(f) ? ' finde' : ''}` },
          el('div', { class: 'mes-cab' },
            el('button', { type: 'button', class: 'ghost num-dia', title: 'Abrir este día en la vista día', onclick: () => irAPeriodo('dia', f) },
              f.slice(8) === '01' ? `${+f.slice(8)} ${MES_CORTO(f)}` : String(+f.slice(8))),
            conf ? el('span', { class: 'aviso', title: 'Hay conflictos este día' }, '!') : null,
            lista.length ? el('span', { class: 'mes-horas', title: `${lista.length} tramo(s) · ${durTxt(+horasOp.toFixed(1))} de operarios` },
              durTxt(+lista.reduce((s, tr) => s + tr.duracion_h, 0).toFixed(1))) : null),
          lista.length && nOps ? el('span', {
            class: `carga${carga > 1 ? ' sobre' : carga > 0.85 ? ' alta' : ''}`, 'aria-hidden': 'true',
            title: `Ocupación de operarios: ${Math.round(carga * 100)}%`,
          }, el('span', { style: `width:${Math.min(100, carga * 100)}%` })) : null,
          ...lista.slice(0, resto > 0 ? MAX_FICHAS - 1 : MAX_FICHAS).map((tr) => chipTramo(tr, null, { compacto: true })),
          resto > 0 ? el('button', { type: 'button', class: 'ghost mas', onclick: () => irAPeriodo('dia', f) }, `+${resto + 1} más`) : null);
        prepararDropCelda(c, { fecha: f, modo: 'mes' });
        return c;
      });
      semanas.push(el('div', { class: 'fila-mes' },
        el('button', { type: 'button', class: 'ghost sem-num', title: `Abrir la semana ${semana}`, onclick: () => irAPeriodo('semana', l) }, `S${semana}`),
        ...celdas));
    }
    $('#cal-body').replaceChildren(...semanas);
  }

  /* ---------- OTs y tareas (derecha) ---------- */
  function pintarOrdenes() {
    const grupos = new Map();
    for (const t of estado.datos.tareas) {
      if (t.estado === 'hecha') continue;
      if (!grupos.has(t.orden_id)) grupos.set(t.orden_id, { t0: t, tareas: [] });
      grupos.get(t.orden_id).tareas.push(t);
    }
    const lista = $('#ordenes-lista');
    if (!grupos.size) { lista.replaceChildren(el('p', { class: 'ayuda' }, 'No hay órdenes abiertas.')); return; }

    lista.replaceChildren(...[...grupos.values()].map(({ t0, tareas }) =>
      el('div', { class: 'orden', style: `--c:${t0.orden_color}` },
        el('h3', {}, `${t0.orden_codigo} / ${t0.orden_titulo}`),
        (t0.proyecto || t0.fecha_entrega) ? el('div', { class: 'meta' },
          [t0.proyecto && `${t0.proyecto}${t0.proyecto_nombre ? ' · ' + t0.proyecto_nombre : ''}`,
           t0.partida && `${t0.partida_codigo ? t0.partida_codigo + ' ' : ''}${t0.partida}`,
           t0.fecha_entrega && `entrega ${t0.fecha_entrega.split('-').reverse().join('/')}`].filter(Boolean).join(' · '),
          t0.condiciones_pendientes?.length ? el('span', {
            class: 'cond', title: `Condiciones previas sin confirmar:\n· ${t0.condiciones_pendientes.join('\n· ')}`,
          }, ` · ⚠ ${t0.condiciones_pendientes.length} condición(es) pendiente(s)`) : null) : null,
        tareas.map(tarjetaTarea),
      )));
  }

  function tarjetaTarea(t) {
    const pend = pendientes(t);
    const completa = pend === 0;
    const req = [...(t.requisitos_tipo || []).map((q) => `${q.cantidad > 1 ? q.cantidad + '× ' : ''}${q.nombre}`),
      ...t.requisitos.map((r) => r.nombre)].join(', ');
    const hoy = t.tramos.filter((x) => x.fecha === estado.fecha);
    const sel = estado.sel?.tipo === 'tarea' && estado.sel.id === t.id;
    const arrastrable = puedeEditar() && !completa;

    let estadoTxt;
    if (completa && t.tramos.length === 1) estadoTxt = t.tramos[0].fecha === estado.fecha ? hhmm(t.tramos[0].hora_inicio) : fechaCorta(t.tramos[0].fecha);
    else if (completa) estadoTxt = `${t.tramos.length} tramos`;
    else if (t.horas_planificadas) estadoTxt = `quedan ${durTxt(pend)}`;
    else estadoTxt = null;

    return el('div', {
      class: `tarea-card${completa ? ' planificada' : ''}${t.horas_planificadas && !completa ? ' parcial' : ''}${sel ? ' sel' : ''}${t.baja_presupuesto ? ' baja' : ''}`,
      draggable: arrastrable ? 'true' : 'false', tabindex: '0', role: 'button',
      'data-tarea': t.id,
      'data-buscar': `${t.orden_codigo} ${t.orden_titulo} ${t.nombre} ${req} ${t.partida_codigo || ''} ${t.partida || ''}`.toLowerCase(),
      title: completa ? 'Planificada entera. Pulsa para ver sus tramos.'
        : t.horas_planificadas ? `${durTxt(t.horas_planificadas)} planificadas de ${durTxt(t.duracion_h)}. Arrastra para planificar el resto.`
          : 'Arrastra al calendario para planificarla',
      onclick: () => seleccionar({ tipo: 'tarea', id: t.id }),
      onkeydown: (ev) => { if (ev.key === 'Enter') seleccionar({ tipo: 'tarea', id: t.id }); },
      ondragstart: (ev) => {
        estado.arrastre = { tipo: 'tarea', id: t.id, agarre: 0 };
        ev.dataTransfer.setData(MIME_TAREA, String(t.id));
        ev.dataTransfer.effectAllowed = 'move';
      },
      ondragend: finArrastre,
    },
      el('div', { class: 'tc-linea' },
        el('span', { class: 'tc-txt' }, [t.nombre, durTxt(t.duracion_h), t.operarios_req ? `${t.operarios_req} op` : null, req || null]
          .filter(Boolean).join(' · ')),
        estadoTxt ? el('span', { class: 'hora' }, estadoTxt) : null),
      t.duracion_h > J().horas || (t.horas_planificadas && !completa)
        ? el('span', { class: 'tc-barra', 'aria-hidden': 'true' },
          el('span', { style: `width:${Math.min(100, (t.horas_planificadas / t.duracion_h) * 100)}%` }))
        : null,
      hoy.length && !completa && estado.periodo === 'dia' ? el('span', { class: 'tc-hoy' }, `hoy ${hoy.map((x) => hhmm(x.hora_inicio)).join(', ')}`) : null,
    );
  }

  // soltar un tramo del calendario en el panel derecho = quitarlo del tablero
  function prepararDropOrdenes() {
    const panel = $('.ordenes');
    panel.addEventListener('dragover', (ev) => {
      if (estado.arrastre?.tipo !== 'tramo') return;
      ev.preventDefault();
      panel.classList.add('drop');
    });
    panel.addEventListener('dragleave', (ev) => { if (!panel.contains(ev.relatedTarget)) panel.classList.remove('drop'); });
    panel.addEventListener('drop', async (ev) => {
      if (estado.arrastre?.tipo !== 'tramo') return;
      ev.preventDefault();
      panel.classList.remove('drop');
      const id = estado.arrastre.id;
      const tareaId = tramo(id)?.tarea_id;
      estado.sel = tareaId ? { tipo: 'tarea', id: tareaId } : null;
      await accion(() => api('DELETE', `/api/tramos/${id}`), 'Tramo quitado del tablero: sus horas vuelven a pendientes');
    });
  }

  function pintarConflictos() {
    const ul = $('#conflictos-lista');
    const cs = estado.datos.conflictos.filter((c) => enPeriodo(c.fecha));
    if (!cs.length) {
      ul.replaceChildren(el('li', { class: 'ok' }, `✓ Sin conflictos ${{ dia: 'en este día', semana: 'esta semana', mes: 'este mes' }[estado.periodo]}`));
      return;
    }
    const conFecha = estado.periodo !== 'dia';
    ul.replaceChildren(...cs.map((c) => el('li', {
      class: c.leve ? 'leve' : '', tabindex: '0', onclick: () => seleccionar({ tipo: 'tramo', id: c.ids[0] }),
      onkeydown: (ev) => { if (ev.key === 'Enter') seleccionar({ tipo: 'tramo', id: c.ids[0] }); },
    }, conFecha ? el('b', { class: 'conf-fecha' }, `${fechaCorta(c.fecha)} · `) : null, c.mensaje)));
  }

  /* ---------- detalle (derecha abajo) ---------- */
  function pintarDetalle() {
    const caja = $('#detalle-cuerpo');
    const s = estado.sel;
    const tr = s?.tipo === 'tramo' ? tramo(s.id) : null;
    const t = tr ? tarea(tr.tarea_id) : s?.tipo === 'tarea' ? tarea(s.id) : null;
    if (!t) { caja.className = 'vacio'; caja.textContent = 'Pulsa un bloque o una tarea para ver su detalle.'; return; }
    caja.className = '';
    const editar = puedeEditar();
    const pend = pendientes(t);

    const filas = [
      el('dt', {}, 'Orden'), el('dd', {}, `${t.orden_codigo} · ${t.orden_titulo}`),
      el('dt', {}, 'Tarea'), el('dd', {}, `${t.nombre} · ${durTxt(t.duracion_h)}`),
      el('dt', {}, 'Proyecto'), el('dd', {}, [t.proyecto, t.proyecto_nombre].filter(Boolean).join(' · ') || '—'),
      el('dt', {}, 'Partida'), el('dd', {}, t.partida ? `${t.partida_codigo ? t.partida_codigo + ' · ' : ''}${t.partida}` : '—'),
      el('dt', {}, 'Obra'), el('dd', {}, [t.cliente, t.obra].filter(Boolean).join(' / ') || '—'),
      el('dt', {}, 'Requiere'), el('dd', {},
        [t.operarios_req ? `${t.operarios_req} op` : null,
          ...(t.requisitos_tipo || []).map((q) => `${q.cantidad > 1 ? q.cantidad + ' × ' : ''}${q.nombre}`),
          ...t.requisitos.map((r) => r.nombre)].filter(Boolean).join(' + ') || '—'),
      el('dt', {}, 'Planificado'), el('dd', {},
        el('div', {}, `${durTxt(t.horas_planificadas)} de ${durTxt(t.duracion_h)}`,
          pend ? el('b', { class: 'pend' }, ` · quedan ${durTxt(pend)}`)
            : t.horas_planificadas > t.duracion_h
              ? el('b', { class: 'exc' }, ` · +${durTxt(+(t.horas_planificadas - t.duracion_h).toFixed(1))} (${Math.round(((t.horas_planificadas - t.duracion_h) / t.duracion_h) * 100)}%) sobre lo estimado`)
              : ' · completa'),
        el('span', { class: 'tc-barra', 'aria-hidden': 'true', style: `--c:${t.orden_color}` },
          el('span', { style: `width:${Math.min(100, (t.horas_planificadas / t.duracion_h) * 100)}%` }))),
      t.dependencias?.length ? el('dt', {}, 'Después de') : null,
      t.dependencias?.length ? el('dd', {}, el('ul', { class: 'deps' }, t.dependencias.map((d) => {
        const terminada = d.fin && d.planificadas >= d.duracion_h;
        const libre = d.fin ? `${fechaCorta(d.fin.fecha)} ${hhmm(d.fin.hora)}` : null;
        return el('li', {}, `${d.orden_codigo} ${d.nombre}`,
          d.espera_h ? el('span', { class: 'ayuda' }, ` · +${durTxt(d.espera_h)} de espera`) : null,
          el('span', { class: d.estado === 'hecha' || terminada ? 'dep-ok' : 'dep-pend' },
            d.estado === 'hecha' ? ' · hecha' : !d.fin ? ' · sin planificar' : terminada ? ` · acaba ${libre}` : ` · planificada en parte (hasta ${libre})`));
      }))) : null,
      t.notas ? el('dt', {}, 'Notas') : null,
      t.notas ? el('dd', { class: 'notas' }, t.notas) : null,
      t.condiciones_pendientes?.length ? el('dt', {}, 'Condiciones') : null,
      t.condiciones_pendientes?.length ? el('dd', {}, el('span', { class: 'dep-pend' }, 'Pendientes de confirmar en el proyecto:'),
        el('ul', { class: 'conds' }, t.condiciones_pendientes.map((c) => el('li', {}, c)))) : null,
      t.baja_presupuesto ? el('dt', {}, 'Presupuesto') : null,
      t.baja_presupuesto ? el('dd', { class: 'baja-txt' }, 'Ya no está en el presupuesto (se conserva por tener planificación)') : null,
      t.operarios_req ? el('dt', {}, 'Horas-persona') : null,
      t.operarios_req ? el('dd', {}, `${durTxt(+t.horas_persona.toFixed(1))} de ${durTxt(t.duracion_h * t.operarios_req)} previstas`,
        el('span', { class: 'ayuda' }, ` (${durTxt(t.duracion_h)} × ${t.operarios_req} op)`)) : null,
    ];

    const partes = [el('dl', {}, filas)];

    if (tr) partes.push(seccionTramo(t, tr, pend, editar));
    else if (pend && editar) partes.push(el('p', { class: 'ayuda' }, 'Arrastra la tarea al calendario: ocupará hasta el fin de jornada y lo que no quepa seguirá pendiente.'));

    // lista de todos los tramos de la tarea
    if (t.tramos.length) {
      partes.push(el('div', { class: 'tramos-lista' },
        el('h4', {}, `Tramos (${t.tramos.length})`),
        el('ol', {}, t.tramos.map((x, i) => el('li', {},
          el('button', {
            type: 'button', class: `ghost${tr && x.id === tr.id ? ' actual' : ''}`,
            onclick: () => irATramo(x),
          }, `${i + 1}. ${fechaCorta(x.fecha)} · ${hhmm(x.hora_inicio)}–${hhmm(x.hora_inicio + x.duracion_h)} · ${durTxt(x.duracion_h)}`))))));
    }

    if (editar) {
      partes.push(el('div', { class: 'acciones' },
        el('label', { class: 'etq' }, 'Estado de la tarea ',
          el('select', {
            'aria-label': 'Estado de la tarea',
            onchange: (ev) => accion(() => api('PATCH', `/api/tareas/${t.id}`, { estado: ev.target.value }), 'Estado actualizado'),
          }, Object.entries(ESTADO_TXT).map(([v, n]) => el('option', { value: v, selected: v === t.estado }, n)))),
        el('a', { class: 'boton ghost', href: `/proyectos.html?ot=${t.orden_id}` }, 'Editar OT')));
    }
    caja.replaceChildren(...partes);
  }

  function seccionTramo(t, tr, pend, editar) {
    const bloqueos = conflictosDe(tr.id);
    const ops = tr.asignados.filter((r) => r.tipo === 'operario').length;
    const maxH = Math.max(PASO, H_FIN() - tr.hora_inicio);
    const hastaFin = Math.max(PASO, finDelDia(tr.hora_inicio) - tr.hora_inicio);
    const opciones = [...new Set([2, 4, 8, hastaFin, tr.duracion_h])].filter((h) => h <= maxH).sort((a, b) => a - b);

    const sec = el('div', { class: 'tramo-det' },
      el('h4', {}, `Tramo ${tr.indice} de ${t.tramos.length}${pend ? '+' : ''}`),
      el('dl', {},
        el('dt', {}, 'Cuándo'), el('dd', {}, `${fechaLarga(tr.fecha)} · ${hhmm(tr.hora_inicio)}–${hhmm(tr.hora_inicio + tr.duracion_h)}`),
        tr.exceso ? el('dt', {}, 'Exceso') : null,
        tr.exceso ? el('dd', { class: 'exc' }, `${durTxt(tr.exceso)} de este tramo van por encima de lo estimado`) : null,
        el('dt', {}, 'Asignado'), el('dd', {},
          tr.asignados.length ? el('ul', { class: 'lista-asig' }, tr.asignados.map((r) => el('li', {},
            el('span', { class: 'chip' }, r.nombre,
              editar ? el('button', {
                title: `Quitar ${r.nombre}`, 'aria-label': `Quitar ${r.nombre}`,
                onclick: () => accion(() => api('DELETE', `/api/tramos/${tr.id}/asignaciones/${r.id}`), `${r.nombre} quitado`),
              }, '×') : null),
            el('span', { class: `franja-txt${r.propia ? ' propia' : ''}` }, `${hhmm(r.desde)}–${hhmm(r.hasta)} · ${durTxt(r.hasta - r.desde)}`),
            editar && r.propia ? el('button', {
              type: 'button', class: 'ghost mini', title: 'Que vuelva a ocupar todo el tramo',
              onclick: () => accion(() => api('PATCH', `/api/tramos/${tr.id}/asignaciones/${r.id}`,
                { desde: tr.hora_inicio, hasta: tr.hora_inicio + tr.duracion_h }), `${r.nombre}: todo el tramo`),
            }, 'todo el tramo') : null))) : '—',
          ops < t.operarios_req ? el('div', { class: 'ayuda' }, `Faltan ${t.operarios_req - ops} operario(s): arrástralos al bloque`) : null),
        el('dt', {}, 'Avisos'), el('dd', {},
          bloqueos.length ? bloqueos.map((c) => el('div', { class: 'bloqueo' }, c.mensaje)) : 'ninguno'),
      ),
    );
    if (!editar) return sec;

    sec.append(
      el('div', { class: 'horas-tramo' },
        el('span', { class: 'etq' }, 'Horas de este tramo'),
        el('div', { class: 'grupo-botones', role: 'group', 'aria-label': 'Horas de este tramo' },
          opciones.map((h) => el('button', {
            type: 'button', class: h === tr.duracion_h ? 'activo' : 'ghost', 'aria-pressed': h === tr.duracion_h ? 'true' : 'false',
            title: h === hastaFin ? 'Hasta el fin de jornada' : '',
            onclick: () => h !== tr.duracion_h && guardarResizeTramo(tr, tr.hora_inicio, tr.hora_inicio + h),
          }, h === hastaFin && ![2, 4, 8].includes(h) ? `${durTxt(h)} (fin)` : durTxt(h))))),
      el('div', { class: 'acciones' },
        el('button', {
          type: 'button', class: 'ghost',
          title: 'Retrasa los tramos posteriores de hoy que comparten área u operario y ahora se solapan con este',
          onclick: () => proponerEmpuje(tr.id, { siempre: true }),
        }, 'Empujar lo siguiente…'),
        pend ? el('button', {
          type: 'button', class: 'primario',
          title: `Crea tramos de ${J().horas}h a las ${hhmm(J().inicio)} en los días laborables siguientes, con la misma área y los mismos recursos`,
          onclick: () => accion(async () => {
            const r = await api('POST', `/api/tramos/${tr.id}/repartir`, {});
            return `Repartidas ${durTxt(pend)} en ${r.creados} día(s), hasta el ${fechaCorta(r.hasta)}`;
          }),
        }, `Repartir ${durTxt(pend)} en días siguientes`) : null,
        el('label', { class: 'etq mover-dia' }, 'Mover a ',
          el('input', {
            type: 'date', value: tr.fecha, 'aria-label': 'Mover el tramo a otro día',
            onchange: (ev) => ev.target.value && ev.target.value !== tr.fecha && accion(async () => {
              await api('PATCH', `/api/tramos/${tr.id}`, { fecha: ev.target.value });
              estado.fecha = ev.target.value;
              return `Tramo movido al ${fechaCorta(ev.target.value)}`;
            }),
          })),
        el('button', {
          type: 'button', class: 'ghost borrar',
          onclick: () => accion(async () => {
            await api('DELETE', `/api/tramos/${tr.id}`);
            estado.sel = { tipo: 'tarea', id: t.id };
            return 'Tramo quitado: sus horas vuelven a pendientes';
          }),
        }, 'Quitar del tablero'),
      ),
    );
    return sec;
  }

  function irATramo(x) {
    estado.sel = { tipo: 'tramo', id: x.id };
    const [a, b] = rangoCarga();
    if (x.fecha < a || x.fecha > b || (estado.periodo === 'dia' && x.fecha !== estado.fecha)) { estado.fecha = x.fecha; cargar(); return; }
    pintar();
    document.querySelector(`[data-tramo="${x.id}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function seleccionar(sel) {
    estado.sel = sel;
    pintarRecursos();
    pintarCalendario();
    pintarOrdenes();
    pintarDetalle();
    aplicarFiltro();
  }

  function aplicarFiltro() {
    const q = estado.filtro.trim().toLowerCase();
    document.querySelectorAll('[data-buscar]').forEach((n) => {
      n.classList.toggle('atenuado', !!q && !n.dataset.buscar.includes(q));
    });
  }

  // Ejecuta una acción, muestra el mensaje (fijo o devuelto por la acción) y recarga
  async function accion(fn, okMsg) {
    try { const r = await fn(); toast(typeof r === 'string' ? r : okMsg); } catch (e) { toast(e.message, true); }
    await cargar();
  }

  function finArrastre() {
    estado.arrastre = null;
    document.querySelectorAll('.drop, .recibe').forEach((n) => n.classList.remove('drop', 'recibe'));
    document.querySelectorAll('.marca-drop').forEach((n) => n.remove());
  }

  /* ---------- áreas de trabajo ---------- */
  async function abrirAreas() {
    const dlg = $('#dlg-areas');
    $('#form-area').hidden = !puedeEditar();
    await pintarAreas();
    if (!dlg.open) dlg.showModal();
  }

  async function pintarAreas() {
    const { tipos, areas } = await api('GET', '/api/areas');
    const editar = puedeEditar();
    const opciones = (sel) => tipos.map((t) => el('option', { value: t, selected: t === sel }, TIPO_TXT[t] || t));
    $('#form-area select[name=tipo]').replaceChildren(...opciones('taller'));

    const activas = areas.filter((a) => a.activo).map((a) => a.id);
    const guardar = (a, campo) => async (ev) => {
      const valor = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
      if (valor === (a[campo] ?? '')) return;
      try {
        await api('PATCH', `/api/areas/${a.id}`, { [campo]: valor });
        a[campo] = valor;
        toast('Área guardada');
        if (campo === 'activo') await pintarAreas();
        cargar();
      } catch (e) { toast(e.message, true); ev.target.value = a[campo] ?? ''; }
    };
    const mover = (id, delta) => async () => {
      const i = activas.indexOf(id), j = i + delta;
      if (i < 0 || j < 0 || j >= activas.length) return;
      [activas[i], activas[j]] = [activas[j], activas[i]];
      await api('PUT', '/api/areas/orden', { ids: activas });
      await pintarAreas(); cargar();
    };

    $('#areas-tbody').replaceChildren(...areas.map((a) => el('tr', { class: a.activo ? '' : 'inactiva' },
      el('td', { class: 'ord' }, editar && a.activo ? [
        el('button', { type: 'button', class: 'ghost', title: 'Subir', 'aria-label': `Subir ${a.nombre}`, onclick: mover(a.id, -1) }, '↑'),
        el('button', { type: 'button', class: 'ghost', title: 'Bajar', 'aria-label': `Bajar ${a.nombre}`, onclick: mover(a.id, 1) }, '↓'),
      ] : ''),
      el('td', {}, el('input', { value: a.nombre, 'aria-label': 'Nombre', maxlength: 80, disabled: !editar, onchange: guardar(a, 'nombre') })),
      el('td', {}, el('select', { 'aria-label': 'Tipo', disabled: !editar, onchange: guardar(a, 'tipo') }, opciones(a.tipo))),
      el('td', {}, el('input', { value: a.ubicacion || '', 'aria-label': 'Ubicación', maxlength: 200, disabled: !editar, placeholder: '—', onchange: guardar(a, 'ubicacion') })),
      el('td', {}, el('input', { type: 'checkbox', checked: a.activo, 'aria-label': 'Activa', disabled: !editar, onchange: guardar(a, 'activo') })),
      el('td', {}, editar ? el('button', {
        type: 'button', class: 'ghost borrar',
        title: a.tareas_abiertas ? `Tiene ${a.tareas_abiertas} tarea(s) abiertas: se desactivará` : 'Borrar área',
        onclick: async () => {
          const r = await api('DELETE', `/api/areas/${a.id}`).catch((e) => toast(e.message, true));
          if (r) toast(r.desactivada ? 'El área tiene tareas: se ha desactivado' : 'Área borrada');
          await pintarAreas(); cargar();
        },
      }, a.tareas_abiertas ? 'Desactivar' : 'Borrar') : ''),
    )));
  }

  function prepararAreas() {
    $('#btn-areas').onclick = abrirAreas;
    $('#dlg-areas-cerrar').onclick = () => $('#dlg-areas').close();
    $('#form-area').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        await api('POST', '/api/areas', Object.fromEntries(fd));
        ev.target.reset();
        toast('Área creada');
        await pintarAreas(); cargar();
      } catch (e) { toast(e.message, true); }
    });
  }

  /* ---------- arranque ---------- */
  function irA(fecha) { estado.fecha = fecha; cargar(); }

  async function init() {
    try { estado.usuario = await api('GET', '/api/me'); } catch { return; }
    $('#usuario-nombre').textContent = `${estado.usuario.nombre}${estado.usuario.rol === 'consulta' ? ' (consulta)' : ''}`;

    const paso = (n) => (estado.periodo === 'mes' ? sumarMeses(estado.fecha, n)
      : sumarDias(estado.fecha, estado.periodo === 'semana' ? 7 * n : n));
    $('#dia-ant').onclick = () => irA(paso(-1));
    $('#dia-sig').onclick = () => irA(paso(1));
    document.querySelectorAll('#periodo-sel button').forEach((b) => {
      b.onclick = () => b.dataset.periodo !== estado.periodo && irAPeriodo(b.dataset.periodo, estado.fecha);
    });
    $('#hoy').onclick = () => irA(hoyISO());
    $('#fecha-input').onchange = (ev) => ev.target.value && irA(ev.target.value);
    $('#buscar').oninput = (ev) => { estado.filtro = ev.target.value; aplicarFiltro(); };
    $('#salir').onclick = async () => { await api('POST', '/api/logout'); location.href = '/login.html'; };
    prepararDropOrdenes();
    prepararAreas();
    document.querySelectorAll('#vista-sel button').forEach((b) => {
      b.onclick = () => { estado.vista = b.dataset.vista; guardarPref('vista', estado.vista); pintar(); };
    });

    await cargar();
    // Multiusuario: refresco periódico de lo que cambian otros (no durante un arrastre)
    setInterval(() => { if (!estado.arrastre && !document.hidden) cargar(); }, 20000);
  }

  init();
})();
