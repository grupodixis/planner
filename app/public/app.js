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
    taller: 'Taller', obra: 'Obra', oficina: 'Oficina', pintura: 'Pintura',
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
    solucion: null,     // aviso con las propuestas de «Solucionar» desplegadas
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
  const ddmm = (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
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
  // Permisos del rol: «planificar» para el tablero, «recursos» para las áreas de trabajo
  const puedeEditar = () => window.s360.tiene('planificar');
  const puedeAreas = () => window.s360.tiene('recursos');
  const puedeAusencias = () => window.s360.tiene('planificar') || window.s360.tiene('recursos');

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
  // Ausencias (vacaciones, bajas, averías…) y festivos del rango cargado
  const AUS_TXT = { vacaciones: 'vacaciones', baja: 'baja', permiso: 'permiso', formacion: 'formación', falta: 'falta', averia: 'avería', mantenimiento: 'mantenimiento', itv: 'ITV', otro: 'no disponible' };
  const ausenciasDe = (recursoId, fecha) => (estado.datos.ausencias || []).filter((a) => a.recurso_id === recursoId && a.desde <= fecha && a.hasta >= fecha);
  const ausenteTodoElDia = (recursoId, fecha) => ausenciasDe(recursoId, fecha).find((a) => a.hora_desde == null);
  const festivoDe = (fecha) => (estado.datos?.festivos || []).find((f) => f.fecha === fecha);
  const laborable = (f) => !esFinde(f) && !festivoDe(f);
  // Parte del día: tramos cerrados y días cerrados no se replanifican
  const diaCerrado = (f) => (estado.datos?.dias_cerrados || []).includes(f);
  const bloqueado = (tr) => !!tr.cierre || diaCerrado(tr.fecha);
  const CIERRE_TXT = { hecho: '✓', corregido: '≠' };
  const marcaCierre = (tr) => (tr.cierre ? el('span', {
    class: `marca-cierre c-${tr.cierre}`,
    title: `${tr.cierre === 'hecho' ? 'Hecho como estaba' : 'Hecho con cambios'} (parte del día) · ${durTxt(+tr.real_h.toFixed(2))} reales`,
  }, CIERRE_TXT[tr.cierre]) : null);
  const ausTexto = (a) => (a.hora_desde != null ? `${AUS_TXT[a.tipo]} ${hhmm(a.hora_desde)}–${hhmm(a.hora_hasta)}` : AUS_TXT[a.tipo]);

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
  // Grupos plegados de los paneles laterales (se recuerda por navegador)
  const plegados = new Set((() => { try { return JSON.parse(leerPref('plegados', '[]')); } catch { return []; } })());

  function pintarRecursos() {
    const uso = new Map();   // horas asignadas en el periodo por recurso
    for (const tr of estado.datos.tramos) {
      if (!enPeriodo(tr.fecha)) continue;
      for (const r of tr.asignados) uso.set(r.id, (uso.get(r.id) || 0) + (r.hasta - r.desde));
    }
    // capacidad: jornada × días laborables del periodo (en la vista día, la jornada)
    const diasLab = estado.periodo === 'dia' ? [estado.fecha] : diasEntre(...rangoPeriodo()).filter(laborable);
    const cap = J().horas * Math.max(1, diasLab.length);
    // ausencias: en la vista día, si falta todo el día; en semana/mes, los días que falta
    const ausHoy = (r) => (estado.periodo === 'dia' ? ausenteTodoElDia(r.id, estado.fecha) : null);
    const diasFuera = (r) => diasLab.filter((f) => ausenteTodoElDia(r.id, f)).length;
    const capDe = (r) => (estado.periodo === 'dia' ? cap : Math.max(0, cap - diasFuera(r) * J().horas));
    const libre = (r) => !uso.get(r.id) && !ausHoy(r);
    const cuando = { dia: 'hoy', semana: 'esta semana', mes: 'este mes' }[estado.periodo];
    // Con una tarea o un tramo seleccionado, se marcan los recursos que cumplen sus requisitos
    const tSel = estado.sel ? (estado.sel.tipo === 'tarea' ? tarea(estado.sel.id) : tarea(tramo(estado.sel.id)?.tarea_id)) : null;
    const cumple = (r) => !!tSel && (tSel.requisitos.some((q) => q.id === r.id)
      || (tSel.requisitos_tipo || []).some((q) => (r.tipos || []).includes(q.id)));

    // Acordeones: clase (Operarios / Maquinaria / Subcontratas) › categoría (oficio, tipo de máquina…)
    const soloLibres = leerPref('rec_libres', '0') === '1';
    $('#rec-libres').checked = soloLibres;
    const CLASES = [['operario', 'Operarios', 'Sin oficio'], ['maquina', 'Maquinaria propia', 'Sin tipo'], ['subcontrata', 'Subcontratas / alquiler', 'Sin tipo']];
    const fila = (r) => {
      const h = +(uso.get(r.id) || 0).toFixed(1);
      const fuera = ausHoy(r);
      const parcial = estado.periodo === 'dia' && !fuera ? ausenciasDe(r.id, estado.fecha)[0] : null;
      const nFuera = estado.periodo === 'dia' ? 0 : diasFuera(r);
      const capR = capDe(r);
      const aus = fuera || parcial;
      const ausTit = aus ? `\n⛔ Está ${aus.texto}${aus.notas ? ` · ${aus.notas}` : ''}`
        : nFuera ? `\n⛔ Fuera ${nFuera} día${nFuera > 1 ? 's' : ''} ${cuando}` : '';
      return el('li', {
        class: `rec ${r.tipo}${h ? ' ocupado' : ''}${h > capR ? ' sobrecarga' : ''}${cumple(r) ? ' cumple' : ''}${fuera ? ' ausente' : ''}${parcial || nFuera ? ' ausente-parcial' : ''}`,
        style: `--uso:${capR ? Math.min(100, (h / capR) * 100) : 0}%`,
        draggable: puedeEditar() && !fuera ? 'true' : 'false',
        'data-buscar': `${r.nombre} ${r.tipos_txt || ''} ${r.empresa || ''}`.toLowerCase(),
        title: `${r.nombre}${cumple(r) ? '\n✓ Cumple lo que pide la tarea seleccionada' : ''}${r.vinculo === 'subcontratado' ? `\nSubcontratado${r.empresa ? ' (' + r.empresa + ')' : ''}` : ''}${r.tipos_txt ? '\n' + r.tipos_txt : ''}\n${h ? `${durTxt(h)} asignadas ${cuando} de ${durTxt(capR)}` : fuera ? 'No disponible' : `Libre ${cuando}`}${ausTit}${puedeAusencias() ? `\nClic: apuntar ${r.tipo === 'operario' ? 'falta o ausencia' : 'avería o no disponible'}` : ''}`,
        ondragstart: (ev) => {
          estado.arrastre = { tipo: 'recurso', id: r.id };
          ev.dataTransfer.setData(MIME_REC, String(r.id));
          ev.dataTransfer.effectAllowed = 'copy';
        },
        ondragend: finArrastre,
        tabindex: puedeAusencias() ? '0' : null,
        onclick: () => puedeAusencias() && abrirAusencia(r),
        onkeydown: (ev) => { if (ev.key === 'Enter' && puedeAusencias()) { ev.preventDefault(); abrirAusencia(r); } },
      },
      el('span', { class: 'rec-nom' }, r.nombre),
      r.vinculo === 'subcontratado' ? el('span', { class: 'sub-tag', 'aria-label': 'subcontratado' }, 'sub') : null,
      el('span', { class: 'uso' }, fuera ? AUS_TXT[fuera.tipo] : h ? `${durTxt(h)}/${durTxt(capR)}` : parcial ? ausTexto(parcial) : nFuera ? `${nFuera}d fuera` : 'libre'));
    };

    $('#rec-plegar').textContent = CLASES.every(([c]) => plegados.has(`rc:${c}`)) ? 'Desplegar todo' : 'Plegar todo';
    $('#rec-grupos').replaceChildren(...CLASES.map(([clase, titulo, sinCat]) => {
      const todos = estado.datos.recursos.filter((r) => r.tipo === clase && r.activo !== false);
      const lista = soloLibres ? todos.filter((r) => libre(r) || (cumple(r) && !ausHoy(r))) : todos;
      const libres = todos.filter(libre).length;
      const nCumple = todos.filter(cumple).length;
      const claveC = `rc:${clase}`;
      const abierta = !plegados.has(claveC) || nCumple > 0;
      // categoría = su primer oficio / tipo (en subcontratas, si no tiene tipo, Subcontrata o Alquiler)
      const cats = new Map();
      for (const r of lista) {
        const cat = (r.tipos_txt || '').split(', ')[0] || (clase === 'subcontrata' && r.categoria) || sinCat;
        if (!cats.has(cat)) cats.set(cat, []);
        cats.get(cat).push(r);
      }
      const orden = [...cats].sort(([a], [b]) => (a === sinCat) - (b === sinCat) || a.localeCompare(b, 'es'));
      const variasCats = orden.length > 1;
      return el('section', { class: `rec-clase ${clase}${abierta ? '' : ' plegada'}` },
        el('button', { type: 'button', class: 'rec-clase-cab', 'aria-expanded': abierta ? 'true' : 'false', onclick: () => plegarRec(claveC) },
          el('span', { class: 'flecha', 'aria-hidden': 'true' }, abierta ? '▾' : '▸'),
          el('span', { class: `t-${clase}` }, titulo),
          nCumple ? el('span', { class: 'rc-cumple', title: 'Cumplen lo que pide la tarea seleccionada' }, `✓ ${nCumple}`) : null,
          el('span', { class: 'rc-cuenta', title: `${libres} libres ${cuando} de ${todos.length}` }, `${libres}/${todos.length} libres`)),
        abierta ? el('div', { class: 'rec-clase-cuerpo' },
          !lista.length ? el('p', { class: 'ayuda' }, soloLibres ? 'Nadie libre.' : 'Ninguno dado de alta.') : null,
          orden.map(([cat, rs]) => {
            const claveK = `rk:${clase}:${cat}`;
            const algunoCumple = rs.some(cumple);
            const catAbierta = !variasCats || !plegados.has(claveK) || algunoCumple;
            rs.sort((a, b) => (!!ausHoy(a) - !!ausHoy(b)) || (cumple(b) - cumple(a)) || ((uso.get(a.id) || 0) - (uso.get(b.id) || 0)) || a.nombre.localeCompare(b.nombre, 'es'));
            return el('div', { class: `rec-cat${catAbierta ? '' : ' plegada'}` },
              variasCats ? el('button', { type: 'button', class: 'rec-cat-cab', 'aria-expanded': catAbierta ? 'true' : 'false', onclick: () => plegarRec(claveK) },
                el('span', { class: 'flecha', 'aria-hidden': 'true' }, catAbierta ? '▾' : '▸'),
                el('span', { class: 'rk-nom' }, cat),
                el('span', { class: 'rk-cuenta' }, `${rs.filter(libre).length}/${rs.length}`)) : null,
              catAbierta ? el('ul', { class: 'lista-rec' }, rs.map(fila)) : null);
          })) : null);
    }));
  }

  function plegarRec(clave) {
    if (plegados.has(clave)) plegados.delete(clave); else plegados.add(clave);
    guardarPref('plegados', JSON.stringify([...plegados].slice(-300)));
    pintarRecursos();
    aplicarFiltro();
  }

  // Las obras van al final del calendario, con el código de su proyecto; la primera lleva el rótulo «Obras»
  const claseObra = (l) => {
    if (!l.es_obra) return '';
    const primera = estado.datos.lineas.find((x) => x.es_obra) === l;
    return ` fila-obra${primera ? ' primera-obra' : ''}`;
  };
  const etiquetaArea = (l) => el('span', { class: `tipo-area tipo-${l.tipo}` },
    l.es_obra ? (l.proyecto_codigo ? `Obra · ${l.proyecto_codigo}` : 'Obra sin proyecto') : TIPO_TXT[l.tipo] || l.tipo,
    l.obra_cerrada && l.proyecto_codigo ? ' · proyecto cerrado' : !l.activo ? ' · inactiva' : '');

  // Filas del calendario agrupadas por departamento (y las obras al final), en bloques plegables
  function conGrupos(pintarFila) {
    const grupos = [];
    for (const l of estado.datos.lineas) {
      const key = l.es_obra ? 'obras' : l.departamento_id ? `d${l.departamento_id}` : 'otras';
      if (!grupos.length || grupos[grupos.length - 1].key !== key) {
        grupos.push({ key, nombre: l.es_obra ? 'Obras' : l.departamento || 'Otras áreas', lineas: [] });
      }
      grupos[grupos.length - 1].lineas.push(l);
    }
    if (grupos.length < 2) return estado.datos.lineas.map(pintarFila);
    const out = [];
    for (const g of grupos) {
      const clave = `ga:${g.key}`;
      const abierto = !plegados.has(clave);
      const ids = new Set(g.lineas.map((l) => l.id));
      const trs = estado.datos.tramos.filter((tr) => ids.has(tr.linea_id));
      const h = trs.reduce((s, tr) => s + tr.duracion_h, 0);
      const trIds = new Set(trs.map((tr) => tr.id));
      const avisos = estado.datos.conflictos.filter((c) => c.ids.some((id) => trIds.has(id)));
      out.push(el('button', {
        type: 'button', class: `grupo-areas${abierto ? '' : ' plegado'}${g.key === 'obras' ? ' obras' : ''}`,
        'aria-expanded': abierto ? 'true' : 'false',
        onclick: () => {
          if (plegados.has(clave)) plegados.delete(clave); else plegados.add(clave);
          guardarPref('plegados', JSON.stringify([...plegados].slice(-300)));
          pintarCalendario();
        },
      },
        el('span', { class: 'flecha', 'aria-hidden': 'true' }, abierto ? '▾' : '▸'),
        el('span', { class: 'ga-nom' }, g.nombre),
        el('span', { class: 'ga-info' }, `${g.lineas.length} área${g.lineas.length > 1 ? 's' : ''}${trs.length ? ` · ${durTxt(+h.toFixed(1))} planificadas` : ''}`),
        avisos.length ? el('span', { class: `ga-conf${avisos.every((c) => c.leve) ? ' leve' : ''}`, title: `${avisos.length} aviso(s) en este grupo` }, `⚠ ${avisos.length}`) : null,
        g.key === 'obras' ? el('span', { class: 'ga-nota' }, 'salen solas al cerrar el proyecto') : null));
      if (abierto) out.push(...g.lineas.map(pintarFila));
    }
    return out;
  }
  const tituloArea = (l) => [l.descripcion, l.exclusiva ? 'Un trabajo a la vez (avisa si coinciden dos)' : null,
    l.proyecto_nombre, l.ubicacion].filter(Boolean).join(' · ');

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

  // Calendario central y, en la vista día, el aviso de festivo encima
  function pintarCalendario() {
    pintarCalendarioSolo();
    const fest = estado.periodo === 'dia' && festivoDe(estado.fecha);
    if (fest) $('#cal-body').prepend(el('p', { class: 'festivo-aviso' }, `Festivo: ${fest.nombre}. Lo que se planifique hoy sale como aviso.`));
    if (estado.periodo === 'dia' && estado.fecha < hoyISO() && estado.datos.tramos.length) {
      const cerrado = diaCerrado(estado.fecha);
      $('#cal-body').prepend(el('p', { class: `parte-aviso${cerrado ? ' cerrado' : ''}` },
        cerrado ? 'Parte cerrado: este día ya no se replanifica. ' : 'El parte de este día está sin cerrar. ',
        el('a', { href: `/parte.html?fecha=${estado.fecha}` }, cerrado ? 'Ver el parte' : 'Rellenar el parte →')));
    }
  }

  function pintarCalendarioSolo() {
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

    const filas = conGrupos((linea) => {
      const pista = pistaVacia({ 'data-linea': linea.id });
      const items = estado.datos.tramos.filter((tr) => tr.linea_id === linea.id).map((tr) => {
        const nodo = bloque(tr);
        return { ini: tr.hora_inicio, fin: tr.hora_inicio + tr.duracion_h, alto: altoBloque(tr), nodo };
      });
      const alto = apilar(items, pista, BLOQUE_H + 2 * GAP);
      const fila = el('div', { class: `fila${linea.activo && !linea.obra_cerrada ? '' : ' inactiva'}${claseObra(linea)}` },
        el('div', { class: 'fila-nombre', title: tituloArea(linea) },
          linea.nombre,
          etiquetaArea(linea),
          linea.ubicacion ? el('span', { class: 'ubic' }, linea.ubicacion) : null),
        pista);
      fila.style.minHeight = `${alto}px`;
      prepararDropPista(pista, { lineaId: linea.id });
      return fila;
    });

    if (!estado.datos.lineas.length) {
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
    const editar = puedeEditar() && !bloqueado(tr);

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
      el('div', { class: 'tit' }, marcaCierre(tr), `${t.orden_codigo} · ${t.orden_titulo}`),
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
      // ausencias de ese día: todo el día rayado, o solo sus horas
      for (const a of recurso ? ausenciasDe(recurso.id, estado.fecha) : []) {
        const ini = a.hora_desde ?? H_INI(), fin = a.hora_hasta ?? H_FIN();
        const z = el('div', { class: 'franja-ausente', title: `${recurso.nombre} está ${a.texto}${a.notas ? ` · ${a.notas}` : ''}` },
          el('span', {}, ausTexto(a)));
        z.style.left = pct(ini);
        z.style.width = `${((fin - ini) / SPAN()) * 100}%`;
        pista.prepend(z);
      }
      const f = el('div', { class: `fila ${clase}` }, el('div', { class: 'fila-nombre' }, recurso ? nombreOperario(recurso) : titulo, sub ? el('span', { class: 'ubic' }, sub) : null), pista);
      f.style.minHeight = `${alto}px`;
      prepararDropPista(pista, { recurso });
      return f;
    };

    const filas = operarios.map((o) => {
      const h = usos.get(o.id).reduce((s, u) => s + (u.r.hasta - u.r.desde), 0);
      const fuera = ausenteTodoElDia(o.id, estado.fecha);
      return fila(o.nombre, fuera ? fuera.texto : h ? `${durTxt(h)} de ${J().horas}h` : 'libre', `${h > J().horas ? 'sobrecarga' : ''}${fuera ? ' ausente' : ''}`,
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
    const editar = puedeEditar() && !bloqueado(tr);
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
      type: 'button', class: `dia-cab${hoyEs(f) ? ' hoy' : ''}${esFinde(f) ? ' finde' : ''}${festivoDe(f) ? ' festivo' : ''}`,
      title: `${festivoDe(f) ? `Festivo: ${festivoDe(f).nombre}\n` : ''}Abrir este día en la vista día`, onclick: () => irAPeriodo('dia', f), ...attrs,
    }, diaCerrado(f) ? el('span', { class: 'dia-cerrado', title: 'Parte cerrado' }, '🔒 ') : null, fechaCorta(f), festivoDe(f) ? el('span', { class: 'fest-nom' }, festivoDe(f).nombre) : null);
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
    const editar = puedeEditar() && !bloqueado(tr);
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
        ? el('span', { class: 'ct-tit' }, marcaCierre(tr), el('span', { class: 'ct-hora' }, hhmm(ini)), ` ${t.nombre}`)
        : el('span', { class: 'ct-tit dos' }, marcaCierre(tr), el('span', { class: 'ct-ot' }, t.orden_codigo), ` ${t.nombre}`),
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
      const c = el('div', { class: `celda${hoyEs(f) ? ' hoy' : ''}${esFinde(f) ? ' finde' : ''}${festivoDe(f) ? ' festivo' : ''}${opts.ausencia ? ' ausente' : ''}` },
        opts.ausencia ? el('div', { class: 'aus-chip', title: `${opts.recurso.nombre} está ${opts.ausencia.texto}${opts.ausencia.notas ? ` · ${opts.ausencia.notas}` : ''}` }, ausTexto(opts.ausencia)) : null,
        ...hijos,
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
            { modo: 'operario', recurso: o, ausencia: ausenciasDe(o.id, f)[0] });
        });
        return filaSemana([nombreOperario(o)], total ? `${durTxt(+total.toFixed(1))} en la semana` : 'libre', '', celdas);
      });
      const sinOp = estado.datos.tramos.filter((tr) => !operariosDe(tr).length);
      if (sinOp.length) {
        filas.push(filaSemana(['Sin operario'], 'arrastra a una persona', 'sin-operario',
          dias.map((f) => celda(f, tramosDe(f, (tr) => !operariosDe(tr).length).map((tr) => chipTramo(tr, undefined)), null, { modo: 'operario' }))));
      }
      if (!operarios.length) filas = [el('p', { class: 'cal-vacio' }, 'No hay operarios dados de alta.')];
    } else {
      filas = conGrupos((linea) => {
        let total = 0;
        const celdas = dias.map((f) => {
          const lista = tramosDe(f, (tr) => tr.linea_id === linea.id);
          const h = lista.reduce((s, tr) => s + tr.duracion_h, 0);
          total += h;
          return celda(f, lista.map((tr) => chipTramo(tr)),
            h ? { txt: durTxt(+h.toFixed(1)), clase: h > J().horas ? 'sobrecarga' : '' } : null,
            { modo: 'area', lineaId: linea.id });
        });
        return filaSemana([linea.nombre, etiquetaArea(linea)],
          total ? `${durTxt(+total.toFixed(1))} en la semana` : '', `${linea.activo && !linea.obra_cerrada ? '' : 'inactiva'}${claseObra(linea)}`, celdas);
      });
      if (!estado.datos.lineas.length) filas = [el('p', { class: 'cal-vacio' }, 'No hay áreas de trabajo activas. Crea una con el botón «Áreas de trabajo».')];
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
        const fuera = estado.datos.recursos.filter((r) => r.tipo === 'operario' && r.activo !== false && ausenteTodoElDia(r.id, f));
        const nDisp = nOps - fuera.length;
        const carga = nDisp > 0 ? horasOp / (nDisp * J().horas) : (horasOp ? 2 : 0);
        const fest = festivoDe(f);
        const conf = estado.datos.conflictos.some((c) => c.fecha === f && !c.leve);
        const resto = lista.length - MAX_FICHAS;
        const c = el('div', { class: `celda mes-dia${f.slice(0, 7) !== mes ? ' fuera' : ''}${hoyEs(f) ? ' hoy' : ''}${esFinde(f) ? ' finde' : ''}${fest ? ' festivo' : ''}` },
          el('div', { class: 'mes-cab' },
            el('button', { type: 'button', class: 'ghost num-dia', title: 'Abrir este día en la vista día', onclick: () => irAPeriodo('dia', f) },
              f.slice(8) === '01' ? `${+f.slice(8)} ${MES_CORTO(f)}` : String(+f.slice(8))),
            conf ? el('span', { class: 'aviso', title: 'Hay conflictos este día' }, '!') : null,
            fuera.length && !esFinde(f) && !fest ? el('span', { class: 'mes-aus', title: `Fuera: ${fuera.map((r) => `${r.nombre} (${AUS_TXT[ausenteTodoElDia(r.id, f).tipo]})`).join(', ')}` }, `${fuera.length} fuera`) : null,
            lista.length ? el('span', { class: 'mes-horas', title: `${lista.length} tramo(s) · ${durTxt(+horasOp.toFixed(1))} de operarios` },
              durTxt(+lista.reduce((s, tr) => s + tr.duracion_h, 0).toFixed(1))) : null),
          fest ? el('span', { class: 'fest-nom' }, fest.nombre) : null,
          lista.length && nOps ? el('span', {
            class: `carga${carga > 1 ? ' sobre' : carga > 0.85 ? ' alta' : ''}`, 'aria-hidden': 'true',
            title: `Ocupación de operarios: ${Math.round(carga * 100)}%${fuera.length ? ` (${nDisp} disponibles de ${nOps})` : ''}`,
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
  // Panel derecho: Proyecto › Partida › OT › tareas. Proyectos y OTs se pliegan (se recuerda por navegador).
  function plegar(clave) {
    if (plegados.has(clave)) plegados.delete(clave); else plegados.add(clave);
    guardarPref('plegados', JSON.stringify([...plegados].slice(-300)));
    pintarOrdenes();
    aplicarFiltro();
  }
  const soloPendiente = () => leerPref('solo_pend', '1') === '1';

  function pintarOrdenes() {
    const solo = soloPendiente();
    $('#solo-pend').checked = solo;
    const proyectos = new Map();
    for (const t of estado.datos.tareas) {
      if (t.estado === 'hecha') continue;
      const pk = t.proyecto_id || 0;
      if (!proyectos.has(pk)) proyectos.set(pk, { t0: t, partidas: new Map(), pend: 0, cond: t.condiciones_pendientes || [] });
      const P = proyectos.get(pk);
      const ak = t.partida_id || 0;
      if (!P.partidas.has(ak)) P.partidas.set(ak, { t0: t, ots: new Map() });
      const A = P.partidas.get(ak);
      if (!A.ots.has(t.orden_id)) A.ots.set(t.orden_id, { t0: t, tareas: [] });
      A.ots.get(t.orden_id).tareas.push(t);
      if (pendientes(t) > 0) P.pend++;
    }
    const lista = $('#ordenes-lista');
    if (!proyectos.size) { lista.replaceChildren(el('p', { class: 'ayuda' }, 'No hay órdenes abiertas.')); return; }
    const tSel = estado.sel ? (estado.sel.tipo === 'tarea' ? tarea(estado.sel.id) : tarea(tramo(estado.sel.id)?.tarea_id)) : null;

    lista.replaceChildren(...[...proyectos].map(([pk, P]) => {
      const t0 = P.t0;
      const claveP = `p:${pk}`;
      const abierto = !plegados.has(claveP) || tSel?.proyecto_id === (pk || null);
      const partidas = [...P.partidas.values()].sort((a, b) => (a.t0.partida_orden ?? 1e9) - (b.t0.partida_orden ?? 1e9));
      const conPartidas = partidas.some((a) => a.t0.partida_id);
      return el('section', { class: `proy${abierto ? '' : ' plegado'}` },
        el('button', {
          type: 'button', class: 'proy-cab', 'aria-expanded': abierto ? 'true' : 'false',
          onclick: () => plegar(claveP),
          title: [t0.proyecto_nombre, t0.cliente, t0.obra].filter(Boolean).join(' · '),
        },
          el('span', { class: 'flecha', 'aria-hidden': 'true' }, abierto ? '▾' : '▸'),
          el('span', { class: 'proy-txt' },
            el('span', { class: 'proy-nom' }, pk ? el('b', {}, t0.proyecto) : null, pk ? ` ${t0.proyecto_nombre || ''}` : 'Sin proyecto'),
            t0.cliente ? el('span', { class: 'proy-sub' }, t0.cliente) : null),
          P.cond.length ? el('span', { class: 'cond-chip', title: `Condiciones previas sin confirmar:\n· ${P.cond.join('\n· ')}` }, `⚠ ${P.cond.length}`) : null,
          el('span', { class: 'proy-pend', title: 'Tareas con horas por planificar' }, P.pend ? `${P.pend} pend.` : '✓')),
        abierto ? el('div', { class: 'proy-cuerpo' }, partidas.map((A) => [
          conPartidas ? el('div', { class: 'part-cab', title: A.t0.partida || '' },
            A.t0.partida_id ? `${A.t0.partida_codigo ? A.t0.partida_codigo + ' · ' : ''}${A.t0.partida}` : 'Sin partida') : null,
          [...A.ots.values()].map(({ t0: o, tareas }) => bloqueOT(o, tareas, solo, tSel)),
        ])) : null);
    }));
  }

  function bloqueOT(o, tareas, solo, tSel) {
    const claveO = `o:${o.orden_id}`;
    const abierta = !plegados.has(claveO) || tSel?.orden_id === o.orden_id;
    const horas = tareas.reduce((s, t) => s + t.duracion_h, 0);
    const plan = tareas.reduce((s, t) => s + Math.min(t.duracion_h, t.horas_planificadas), 0);
    const pend = tareas.filter((t) => pendientes(t) > 0);
    const visibles = solo ? pend : tareas;
    const entrega = o.fecha_entrega ? ddmm(o.fecha_entrega) : null;
    const tarde = o.fecha_entrega && o.fecha_entrega < hoyISO();
    return el('div', { class: `ot-b${abierta ? '' : ' plegada'}`, style: `--c:${o.orden_color}`, 'data-buscar': `${o.orden_codigo} ${o.orden_titulo} ${o.proyecto || ''} ${o.partida || ''}`.toLowerCase() },
      el('button', { type: 'button', class: 'ot-cab', 'aria-expanded': abierta ? 'true' : 'false', onclick: () => plegar(claveO), title: o.orden_titulo },
        el('span', { class: 'ot-l1' },
          el('span', { class: 'punto', 'aria-hidden': 'true' }),
          el('b', {}, o.orden_codigo), el('span', { class: 'ot-tit' }, o.orden_titulo),
          el('span', { class: 'flecha', 'aria-hidden': 'true' }, abierta ? '▾' : '▸')),
        el('span', { class: 'ot-l2' },
          o.prioridad <= 2 ? el('span', { class: `prio p${o.prioridad}` }, o.prioridad === 1 ? 'urgente' : 'alta') : null,
          entrega ? el('span', { class: tarde ? 'tarde' : '' }, `entrega ${entrega}`) : null,
          el('span', { title: `${pend.length} de ${tareas.length} tareas con horas por planificar` }, pend.length ? `${pend.length}/${tareas.length} pend.` : '✓ planificada'),
          el('span', { class: 'mini-barra', 'aria-hidden': 'true' }, el('span', { style: `width:${horas ? (plan / horas) * 100 : 0}%` })),
          el('span', { class: 'ot-h' }, `${durTxt(+plan.toFixed(1))}/${durTxt(+horas.toFixed(1))}`))),
      abierta && visibles.length ? el('div', { class: 'ot-tareas' }, visibles.map(tarjetaTarea)) : null);
  }

  function tarjetaTarea(t) {
    const pend = pendientes(t);
    const completa = pend === 0;
    const req = [...(t.requisitos_tipo || []).map((q) => `${q.cantidad > 1 ? q.cantidad + '× ' : ''}${q.nombre}`),
      ...t.requisitos.map((r) => r.nombre)].join(', ');
    const sel = estado.sel?.tipo === 'tarea' && estado.sel.id === t.id;
    const arrastrable = puedeEditar() && !completa;
    const estadoTxt = completa ? (t.tramos.length === 1 ? ddmm(t.tramos[0].fecha) : `${t.tramos.length} tramos`)
      : t.horas_planificadas ? `quedan ${durTxt(pend)}` : durTxt(t.duracion_h);

    return el('div', {
      class: `tarea-card${completa ? ' planificada' : ''}${t.horas_planificadas && !completa ? ' parcial' : ''}${sel ? ' sel' : ''}${t.baja_presupuesto ? ' baja' : ''}`,
      draggable: arrastrable ? 'true' : 'false', tabindex: '0', role: 'button',
      'data-tarea': t.id,
      'data-buscar': `${t.orden_codigo} ${t.orden_titulo} ${t.nombre} ${req} ${t.partida_codigo || ''} ${t.partida || ''} ${t.proyecto || ''} ${t.proyecto_nombre || ''}`.toLowerCase(),
      title: `${t.nombre}\n${durTxt(t.duracion_h)}${t.operarios_req ? ` · ${t.operarios_req} op` : ''}${req ? ` · ${req}` : ''}\n`
        + (completa ? 'Planificada entera. Pulsa para ver el detalle.'
          : t.horas_planificadas ? `${durTxt(t.horas_planificadas)} planificadas de ${durTxt(t.duracion_h)}. Arrastra para planificar el resto.`
            : 'Arrastra al calendario para planificarla'),
      onclick: () => seleccionar({ tipo: 'tarea', id: t.id }),
      onkeydown: (ev) => { if (ev.key === 'Enter') seleccionar({ tipo: 'tarea', id: t.id }); },
      ondragstart: (ev) => {
        estado.arrastre = { tipo: 'tarea', id: t.id, agarre: 0 };
        ev.dataTransfer.setData(MIME_TAREA, String(t.id));
        ev.dataTransfer.effectAllowed = 'move';
      },
      ondragend: finArrastre,
    },
      el('span', { class: 'tc-nom' }, t.nombre),
      el('span', { class: 'tc-der' },
        t.operarios_req > 1 ? el('span', { class: 'tc-ops', title: `${t.operarios_req} operarios a la vez` }, `×${t.operarios_req}`) : null,
        (t.dependencias || []).length ? el('span', { class: 'tc-dep', title: `Va después de: ${t.dependencias.map((d) => d.nombre).join(', ')}` }, '⤷') : null,
        el('span', { class: 'hora' }, estadoTxt)),
      t.horas_planificadas && !completa
        ? el('span', { class: 'tc-barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.min(100, (t.horas_planificadas / t.duracion_h) * 100)}%` }))
        : null);
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
      class: c.leve ? 'leve' : '', tabindex: '0', onclick: () => seleccionar({ tipo: 'tramo', id: tramoDeAviso(c) }),
      onkeydown: (ev) => { if (ev.key === 'Enter') seleccionar({ tipo: 'tramo', id: tramoDeAviso(c) }); },
    }, conFecha ? el('b', { class: 'conf-fecha' }, `${fechaCorta(c.fecha)} · `) : null, c.mensaje,
    puedeEditar() && tieneSolucion(c) ? el('button', {
      type: 'button', class: 'ghost mini btn-sol',
      onclick: (ev) => { ev.stopPropagation(); estado.solucion = claveAviso(c); seleccionar({ tipo: 'tramo', id: tramoDeAviso(c) }); },
    }, 'Solucionar') : null)));
  }

  /* ---------- detalle (derecha abajo) ---------- */
  function pintarDetalle() {
    const caja = $('#detalle-cuerpo');
    const s = estado.sel;
    const tr = s?.tipo === 'tramo' ? tramo(s.id) : null;
    const t = tr ? tarea(tr.tarea_id) : s?.tipo === 'tarea' ? tarea(s.id) : null;
    const dlg = $('#dlg-detalle');
    if (!t) { if (dlg.open) dlg.close(); return; }
    const scroll = dlg.open ? caja.scrollTop : 0;
    const editar = puedeEditar();
    const pend = pendientes(t);

    // Cabecera: de qué proyecto y partida es, y la OT
    dlg.style.setProperty('--c', t.orden_color);
    $('#det-migas').replaceChildren(
      t.proyecto ? el('span', { title: [t.cliente, t.obra].filter(Boolean).join(' · ') }, el('b', {}, t.proyecto), ` ${t.proyecto_nombre || ''}`) : el('span', {}, 'Sin proyecto'),
      t.partida ? el('span', { class: 'sep' }, ' › ') : null,
      t.partida ? el('span', {}, `${t.partida_codigo ? t.partida_codigo + ' · ' : ''}${t.partida}`) : null);
    $('#det-tit').replaceChildren(el('span', { class: 'punto', 'aria-hidden': 'true' }), `${t.orden_codigo} · ${t.orden_titulo}`);
    $('#det-meta').textContent = [
      { 1: 'Urgente', 2: 'Prioridad alta', 3: null, 4: 'Prioridad baja' }[t.prioridad],
      t.fecha_entrega && `entrega ${fechaCorta(t.fecha_entrega)}`,
      [t.cliente, t.obra].filter(Boolean).join(' · ') || null,
    ].filter(Boolean).join(' · ');

    const filas = [
      el('dt', {}, 'Tarea'), el('dd', {}, el('b', {}, t.nombre), ` · ${durTxt(t.duracion_h)}`),
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

    if (tr) {
      if (bloqueado(tr)) {
        partes.push(el('p', { class: 'aviso-cierre' }, tr.cierre
          ? `Cerrado en el parte del día (${tr.cierre === 'hecho' ? 'como estaba' : 'con cambios'}) · ${durTxt(+tr.real_h.toFixed(2))} reales. `
          : 'El parte de este día está cerrado. ',
        el('a', { href: `/parte.html?fecha=${tr.fecha}` }, 'Ver el parte')));
      }
      partes.push(seccionTramo(t, tr, pend, editar && !bloqueado(tr)));
    }
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
    if (!dlg.open) dlg.show();
    caja.scrollTop = scroll;
  }

  // La ventana de detalle se arrastra por su cabecera; se recuerda dónde se dejó
  function moverDetalle() {
    const dlg = $('#dlg-detalle');
    const colocar = (x, y) => {
      const w = dlg.offsetWidth || 440;
      const nx = Math.max(8, Math.min(window.innerWidth - w - 8, x));
      const ny = Math.max(8, Math.min(window.innerHeight - 80, y));
      dlg.style.left = `${nx}px`; dlg.style.top = `${ny}px`; dlg.style.right = 'auto';
      return [nx, ny];
    };
    try { const p = JSON.parse(leerPref('detalle_pos', 'null')); if (p) requestAnimationFrame(() => colocar(...p)); } catch { /* posición por defecto */ }
    const cab = dlg.querySelector('.det-cab');
    cab.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('button, a')) return;
      ev.preventDefault();
      const r = dlg.getBoundingClientRect();
      const dx = ev.clientX - r.left, dy = ev.clientY - r.top;
      cab.setPointerCapture(ev.pointerId);
      const mover = (e) => colocar(e.clientX - dx, e.clientY - dy);
      const soltar = (e) => {
        cab.removeEventListener('pointermove', mover);
        cab.removeEventListener('pointerup', soltar);
        guardarPref('detalle_pos', JSON.stringify(colocar(e.clientX - dx, e.clientY - dy)));
      };
      cab.addEventListener('pointermove', mover);
      cab.addEventListener('pointerup', soltar);
    });
    cab.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('button, a')) return;
      dlg.style.left = ''; dlg.style.top = ''; dlg.style.right = '';
      guardarPref('detalle_pos', 'null');
    });
  }

  /* ---------- avisos con «Solucionar» ---------- */
  const claveAviso = (c) => `${c.tipo}|${c.ids.join(',')}|${c.mensaje}`;
  // El tramo sobre el que se actúa: en un solape, el que empieza más tarde
  function tramoDeAviso(c) {
    if (c.tipo === 'puesto') return c.ids[1];
    if (c.tipo !== 'solape') return c.ids[0];
    const [a, b] = c.ids.map(tramo);
    return a && b && b.hora_inicio < a.hora_inicio ? a.id : c.ids[1];
  }
  const tieneSolucion = (c) => ['operarios', 'requisito', 'requisito_tipo', 'solape', 'jornada', 'exceso', 'dependencia', 'puesto', 'ausencia'].includes(c.tipo);
  const recurso = (id) => estado.datos.recursos.find((r) => r.id === id);
  const activos = (tipo) => estado.datos.recursos.filter((r) => r.activo !== false && (!tipo || r.tipo === tipo));
  // Dónde está ocupado un recurso ese día (sin contar el tramo indicado)
  const ocupaciones = (recursoId, fecha, excluir) => estado.datos.tramos
    .filter((x) => x.fecha === fecha && x.id !== excluir)
    .flatMap((x) => x.asignados.filter((a) => a.id === recursoId).map((a) => ({ x, desde: a.desde, hasta: a.hasta })));

  // Lista de recursos propuestos para un tramo: primero los libres a esa hora
  function candidatos(lista, tr, { asignar, boton = 'Asignar', prefiere = () => false, motivo = '' }) {
    const ini = tr.hora_inicio, fin = tr.hora_inicio + tr.duracion_h;
    const filas = lista.map((r) => {
      const choca = ocupaciones(r.id, tr.fecha, tr.id).filter((o) => o.desde < fin && ini < o.hasta);
      const aus = ausenciasDe(r.id, tr.fecha).find((a) => a.hora_desde == null || (a.hora_desde < fin && a.hora_hasta > ini));
      return { r, choca, aus, pref: prefiere(r) };
    }).sort((a, b) => (!!a.aus - !!b.aus) || (a.choca.length - b.choca.length) || (b.pref - a.pref) || a.r.nombre.localeCompare(b.r.nombre, 'es'));
    const libres = filas.filter((f) => !f.choca.length && !f.aus);
    const ocupados = filas.filter((f) => f.choca.length && !f.aus);
    if (!filas.length) return el('p', { class: 'ayuda' }, 'No hay ningún recurso que encaje dado de alta.');
    return el('div', {},
      libres.length ? null : el('p', { class: 'ayuda' }, `Nadie libre de ${hhmm(ini)} a ${hhmm(fin)}.`),
      el('ul', { class: 'cands' },
        libres.slice(0, 8).map(({ r, pref }) => el('li', {},
          el('span', { class: 'cand-nom' }, r.nombre, r.vinculo === 'subcontratado' ? el('span', { class: 'sub-tag' }, 'sub') : null),
          el('span', { class: 'cand-info' }, pref && motivo ? `✓ ${typeof motivo === 'function' ? motivo(r) : motivo}` : (r.tipos_txt || 'libre')),
          el('button', { type: 'button', class: 'primario mini', onclick: () => asignar(r) }, boton))),
        ocupados.slice(0, 4).map(({ r, choca }) => el('li', { class: 'ocupado' },
          el('span', { class: 'cand-nom' }, r.nombre),
          el('span', { class: 'cand-info' }, `ocupado ${choca.map((o) => `${hhmm(o.desde)}–${hhmm(o.hasta)} ${tarea(o.x.tarea_id)?.orden_codigo || ''}`).join(', ')}`)))),
      filas.some((f) => f.aus) ? el('p', { class: 'ayuda' }, `Fuera ese día: ${filas.filter((f) => f.aus).map((f) => `${f.r.nombre} (${ausTexto(f.aus)})`).join(', ')}`) : null,
      libres.length > 8 ? el('p', { class: 'ayuda' }, `y ${libres.length - 8} más libres`) : null);
  }

  // Primer hueco laborable a partir de un instante (fecha + hora)
  function siguienteHueco(fecha, hora) {
    let f = fecha, h = Math.ceil(hora / PASO) * PASO;
    if (h >= J().fin) { f = sumarDias(f, 1); h = J().inicio; }
    if (h < J().inicio) h = J().inicio;
    while (!laborable(f)) f = sumarDias(f, 1);
    return { fecha: f, hora: h };
  }

  function propuestas(c, tr, t) {
    const ini = tr.hora_inicio, fin = tr.hora_inicio + tr.duracion_h;
    const yaEn = new Set(tr.asignados.map((r) => r.id));
    const asignar = (r) => accion(() => api('POST', `/api/tramos/${tr.id}/asignaciones`, { recurso_id: r.id }), `${r.nombre} asignado`);
    const caja = (...hijos) => el('div', { class: 'sol' }, ...hijos);
    switch (c.tipo) {
      case 'operarios': {
        const oficios = (t.requisitos_tipo || []).filter((q) => q.clase === 'operario');
        const suPuesto = (r) => r.linea_id && r.linea_id === tr.linea_id;
        const tieneOficio = (r) => oficios.some((q) => (r.tipos || []).includes(q.id));
        const ocupante = activos('operario').some((r) => suPuesto(r) && !yaEn.has(r.id));
        return caja(el('p', { class: 'ayuda' }, `Faltan ${c.falta} operario(s)${ocupante ? ' · primero quien tiene aquí su puesto' : ''}${oficios.length ? ` · luego los de ${oficios.map((q) => q.nombre).join(', ')}` : ''}:`),
          candidatos(activos('operario').filter((r) => !yaEn.has(r.id)), tr, {
            asignar,
            motivo: (r) => [suPuesto(r) ? 'su puesto' : null, tieneOficio(r) ? 'tiene el oficio' : null].filter(Boolean).join(' · '),
            prefiere: (r) => (suPuesto(r) ? 2 : 0) + (tieneOficio(r) ? 1 : 0),
          }));
      }
      case 'requisito_tipo': {
        const nombre = (t.requisitos_tipo || []).find((q) => q.id === c.tipo_recurso_id)?.nombre || 'ese tipo';
        if (c.sin_alta) {
          return caja(el('p', { class: 'ayuda' }, `No hay ningún «${nombre}» dado de alta. Si es una máquina o subcontrata que no está en el sistema, puedes ignorar el aviso (es leve) o darla de alta.`),
            el('a', { class: 'boton ghost', href: `/recursos.html?tipo=${c.clase || 'maquina'}` }, 'Dar de alta en Recursos'));
        }
        return caja(el('p', { class: 'ayuda' }, `${nombre}${c.falta > 1 ? ` · faltan ${c.falta}` : ''}:`),
          candidatos(activos().filter((r) => (r.tipos || []).includes(c.tipo_recurso_id) && !yaEn.has(r.id)), tr, { asignar }));
      }
      case 'requisito': {
        const r = recurso(c.recurso_id);
        return caja(r ? candidatos([r], tr, { asignar, boton: r.tipo === 'subcontrata' ? 'Confirmar' : 'Asignar' }) : el('p', { class: 'ayuda' }, 'Ese recurso ya no existe.'));
      }
      case 'ausencia': {
        // está de vacaciones / baja / averiado: pasar su parte a otro del mismo oficio o tipo, o quitarlo
        const r = recurso(c.recurso_id) || tr.asignados.find((x) => x.id === c.recurso_id);
        if (!r) return caja();
        const mismos = activos(r.tipo).filter((x) => x.id !== r.id && !yaEn.has(x.id)
          && (!(r.tipos || []).length || (x.tipos || []).some((id) => r.tipos.includes(id))));
        return caja(
          el('p', { class: 'ayuda' }, `Pasar lo de ${r.nombre} a otro${(r.tipos || []).length ? ' del mismo oficio / tipo' : ''}:`),
          candidatos(mismos, tr, {
            boton: 'Cambiar',
            asignar: (x) => accion(() => api('PATCH', `/api/tramos/${tr.id}/asignaciones/${r.id}`, { recurso_id: x.id }), `${r.nombre} → ${x.nombre}`),
          }),
          el('div', { class: 'sol-acc' }, el('button', {
            type: 'button', class: 'ghost mini',
            onclick: () => accion(() => api('DELETE', `/api/tramos/${tr.id}/asignaciones/${r.id}`), `${r.nombre} quitado del tramo`),
          }, `Quitar a ${r.nombre} del tramo`)));
      }
      case 'solape': {
        const r = recurso(c.recurso_id);
        const otro = tramo(c.ids.find((id) => id !== tr.id));
        if (!r) return caja();
        const mismos = activos(r.tipo).filter((x) => x.id !== r.id && !yaEn.has(x.id)
          && (!(r.tipos || []).length || (x.tipos || []).some((id) => r.tipos.includes(id))));
        const primero = otro && otro.hora_inicio < tr.hora_inicio ? otro : tr;
        return caja(
          el('p', { class: 'ayuda' }, `Cambiar a ${r.nombre} en este tramo (${hhmm(ini)}–${hhmm(fin)}) por otro${(r.tipos || []).length ? ' del mismo tipo' : ''}:`),
          candidatos(mismos, tr, {
            boton: 'Cambiar',
            asignar: (x) => accion(() => api('PATCH', `/api/tramos/${tr.id}/asignaciones/${r.id}`, { recurso_id: x.id }), `${r.nombre} → ${x.nombre}`),
          }),
          el('div', { class: 'sol-acc' }, el('span', { class: 'ayuda' }, 'O retrasa lo que viene detrás:'),
            el('button', { type: 'button', class: 'ghost mini', onclick: () => proponerEmpuje(primero.id, { siempre: true }) }, 'Empujar lo siguiente…')));
      }
      case 'jornada': {
        if (c.lado === 'inicio') {
          return caja(el('button', {
            type: 'button', class: 'primario mini',
            onclick: () => accion(() => api('PATCH', `/api/tramos/${tr.id}`, { hora_inicio: J().inicio }), `Empieza a las ${hhmm(J().inicio)}`),
          }, `Empezar a las ${hhmm(J().inicio)}`));
        }
        const fuera = +(fin - Math.max(ini, J().fin)).toFixed(1);
        return caja(
          ini < J().fin ? el('button', {
            type: 'button', class: 'primario mini', title: 'Lo que no cabe queda pendiente en el panel derecho',
            onclick: () => guardarResizeTramo(tr, ini, J().fin),
          }, `Recortar hasta las ${hhmm(J().fin)} (${durTxt(fuera)} quedan pendientes)`) : null,
          el('span', { class: 'ayuda' }, ' Si son horas extra previstas, puedes dejarlo así.'));
      }
      case 'exceso': {
        const nueva = Math.ceil(t.horas_planificadas / PASO) * PASO;
        return caja(
          el('button', {
            type: 'button', class: 'primario mini', title: 'Si el trabajo de verdad lleva más horas',
            onclick: () => accion(() => api('PATCH', `/api/tareas/${t.id}`, { duracion_h: nueva }), `Estimación: ${durTxt(nueva)}`),
          }, `Subir la estimación a ${durTxt(nueva)}`),
          tr.duracion_h - tr.exceso >= PASO ? el('button', {
            type: 'button', class: 'ghost mini',
            onclick: () => guardarResizeTramo(tr, ini, fin - tr.exceso),
          }, `Recortar este tramo ${durTxt(tr.exceso)}`) : null);
      }
      case 'dependencia': {
        const previa = (t.dependencias || []).find((d) => d.id === c.previa_id);
        if (!c.libre) {
          return caja(el('p', { class: 'ayuda' }, `Planifica antes «${previa?.nombre || 'la tarea previa'}».`),
            previa && tarea(previa.id) ? el('button', { type: 'button', class: 'ghost mini', onclick: () => seleccionar({ tipo: 'tarea', id: previa.id }) }, 'Ver esa tarea') : null);
        }
        const dest = siguienteHueco(c.libre.fecha, c.libre.hora);
        return caja(el('button', {
          type: 'button', class: 'primario mini',
          onclick: () => accion(async () => {
            await api('PATCH', `/api/tramos/${tr.id}`, { fecha: dest.fecha, hora_inicio: dest.hora });
            if (estado.periodo === 'dia') estado.fecha = dest.fecha;
            return `Tramo movido al ${fechaCorta(dest.fecha)} a las ${hhmm(dest.hora)}`;
          }),
        }, `Mover a ${fechaCorta(dest.fecha)} · ${hhmm(dest.hora)}`),
        el('span', { class: 'ayuda' }, ` cuando ya ha terminado «${previa?.nombre || 'la previa'}»`));
      }
      case 'puesto': {
        // dos trabajos a la vez en un puesto: retrasar este hasta que quede libre, o pasarlo a otro puesto libre
        const otro = tramo(c.ids.find((id) => id !== tr.id));
        const area = estado.datos.lineas.find((l) => l.id === tr.linea_id);
        const libreA = otro ? otro.hora_inicio + otro.duracion_h : c.libre;
        const dest = siguienteHueco(tr.fecha, libreA);
        const libres = estado.datos.lineas.filter((l) => l.exclusiva && l.id !== tr.linea_id && l.activo
          && (l.departamento_id === area?.departamento_id)
          && !estado.datos.tramos.some((x) => x.linea_id === l.id && x.fecha === tr.fecha && x.hora_inicio < fin && ini < x.hora_inicio + x.duracion_h));
        const mover = (cambios, txt) => accion(async () => {
          await api('PATCH', `/api/tramos/${tr.id}`, cambios);
          if (cambios.fecha && estado.periodo === 'dia') estado.fecha = cambios.fecha;
          return txt;
        });
        return caja(
          el('button', { type: 'button', class: 'primario mini', onclick: () => mover({ fecha: dest.fecha, hora_inicio: dest.hora }, `Movido a las ${hhmm(dest.hora)}`) },
            `Empezar ${dest.fecha === tr.fecha ? '' : fechaCorta(dest.fecha) + ' '}a las ${hhmm(dest.hora)} (cuando queda libre)`),
          libres.length ? el('div', { class: 'sol-acc' }, el('span', { class: 'ayuda' }, 'O pasarlo a un puesto libre a esa hora:'),
            ...libres.slice(0, 6).map((l) => el('button', { type: 'button', class: 'ghost mini', onclick: () => mover({ linea_id: l.id }, `Pasado a ${l.nombre}`) }, l.nombre))) : null);
      }
      default: return caja();
    }
  }

  // Avisos de un tramo, cada uno con su «Solucionar»
  function listaAvisos(tr, t) {
    const lista = conflictosDe(tr.id);
    if (!lista.length) return el('span', { class: 'dep-ok' }, 'ninguno');
    return el('ul', { class: 'avisos-det' }, lista.map((c) => {
      const k = claveAviso(c);
      const abierto = estado.solucion === k;
      return el('li', { class: c.leve ? 'leve' : '' },
        el('div', { class: 'aviso-l' },
          el('span', {}, c.mensaje.replace(/^OT-\S+ [^:]*?(:| requiere| empieza| termina| va después| solapado)/i, (m, g) => g === ':' ? '' : g.trim()) ),
          puedeEditar() && tieneSolucion(c) ? el('button', {
            type: 'button', class: `ghost mini${abierto ? ' activo' : ''}`, 'aria-expanded': abierto ? 'true' : 'false',
            onclick: () => { estado.solucion = abierto ? null : k; pintarDetalle(); },
          }, abierto ? 'Ocultar' : 'Solucionar') : null),
        abierto ? propuestas(c, tr, t) : null);
    }));
  }

  function seccionTramo(t, tr, pend, editar) {
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
        el('dt', {}, 'Avisos'), el('dd', {}, listaAvisos(tr, t)),
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
          title: `Crea tramos de ${J().horas}h a las ${hhmm(J().inicio)} en los días laborables siguientes (sin festivos), con la misma área y los mismos recursos (salvo quien esté ausente ese día)`,
          onclick: () => accion(async () => {
            const r = await api('POST', `/api/tramos/${tr.id}/repartir`, {});
            const extra = [r.festivos_saltados?.length ? `${r.festivos_saltados.length} festivo(s) saltado(s)` : null,
              r.dias_con_ausencias ? `${r.dias_con_ausencias} día(s) sin alguien que estaba ausente` : null].filter(Boolean).join(' · ');
            return `Repartidas ${durTxt(pend)} en ${r.creados} día(s), hasta el ${fechaCorta(r.hasta)}${extra ? ` (${extra})` : ''}`;
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

  /* ---------- falta / ausencia rápida desde el tablero ---------- */
  // Nombre de operario que abre el apunte de ausencia (vistas por operarios)
  function nombreOperario(r) {
    if (!puedeAusencias()) return r.nombre;
    return el('button', { type: 'button', class: 'nom-op', title: 'Apuntar falta o ausencia', onclick: () => abrirAusencia(r) }, r.nombre);
  }
  // Día al que se refiere el apunte: el de la vista día; en semana / mes, hoy si cae dentro
  function fechaRef() {
    if (estado.periodo === 'dia') return estado.fecha;
    const [a, b] = rangoPeriodo();
    const hoy = hoyISO();
    return hoy >= a && hoy <= b ? hoy : a;
  }
  const TIPOS_AUS = {
    operario: [['falta', 'Falta'], ['baja', 'Baja'], ['permiso', 'Permiso'], ['vacaciones', 'Vacaciones'], ['formacion', 'Formación'], ['otro', 'Otro']],
    maquina: [['averia', 'Avería'], ['mantenimiento', 'Mantenimiento'], ['itv', 'ITV / revisión'], ['otro', 'Otro']],
  };
  TIPOS_AUS.subcontrata = TIPOS_AUS.maquina;

  function abrirAusencia(r, fecha = fechaRef()) {
    let d = $('#dlg-ausencia');
    if (!d) {
      d = el('dialog', { id: 'dlg-ausencia', class: 'dlg-ausencia', 'aria-labelledby': 'aus-tit' });
      document.body.append(d);
    }
    const hHora = (v) => { const [h, m] = v.split(':').map(Number); return h + (m || 0) / 60; };
    const cuando = el('select', { 'aria-label': 'Cuánto' },
      el('option', { value: 'dia' }, 'Todo el día'),
      el('option', { value: 'desde' }, 'Se fue a las…'),
      el('option', { value: 'hasta' }, 'Llegó a las…'));
    const hora = el('input', { type: 'time', step: 900, value: '10:00', hidden: true, 'aria-label': 'Hora' });
    cuando.onchange = () => { hora.hidden = cuando.value === 'dia'; };
    const dia = el('input', { type: 'date', value: fecha, 'aria-label': 'Día' });
    const notas = el('input', { placeholder: 'Notas (opcional)', maxlength: 500, 'aria-label': 'Notas' });
    const ya = el('div', { class: 'aus-ya' });

    const pintarYa = () => {
      const lista = ausenciasDe(r.id, dia.value);
      const justificar = (a, v, txt) => el('button', {
        type: 'button', class: `ghost mini${a.justificante === v ? ' activo' : ''}`, 'aria-pressed': a.justificante === v ? 'true' : 'false',
        onclick: () => accion(async () => { await api('PATCH', `/api/ausencias/${a.id}`, { justificante: v }); d.close(); return `Falta ${txt}`; }),
      }, txt);
      ya.replaceChildren(...lista.map((a) => el('div', { class: 'aus-ya-fila' },
        el('span', {}, `Ya apuntado: ${a.texto}${a.notas ? ` · ${a.notas}` : ''}`),
        a.tipo === 'falta' ? el('span', { class: 'aus-justif' }, 'Justificante:',
          justificar(a, 'si', 'justificada'), justificar(a, 'no', 'sin justificar'), justificar(a, 'pendiente', 'pendiente')) : null,
        el('button', {
          type: 'button', class: 'ghost mini borrar',
          onclick: () => accion(async () => { await api('DELETE', `/api/ausencias/${a.id}`); d.close(); return 'Ausencia quitada'; }),
        }, 'Quitar'))));
    };
    dia.onchange = pintarYa;

    const guardar = (tipo, nombre) => accion(async () => {
      const cuerpo = { recurso_id: r.id, tipo, desde: dia.value, hasta: dia.value, notas: notas.value };
      if (cuando.value === 'desde') { cuerpo.hora_desde = hHora(hora.value); cuerpo.hora_hasta = Math.max(J().fin, cuerpo.hora_desde + 0.5); }
      if (cuando.value === 'hasta') { cuerpo.hora_desde = J().inicio; cuerpo.hora_hasta = hHora(hora.value); }
      const x = await api('POST', '/api/ausencias', cuerpo);
      d.close();
      return `${r.nombre}: ${nombre.toLowerCase()} el ${fechaCorta(dia.value)}${tipo === 'falta' ? ' (pendiente de justificante)' : ''}`
        + (x.afectados.length ? ` · tenía ${x.afectados.length} tramo(s): reasígnalo desde «Solucionar» en los avisos` : '');
    });

    d.replaceChildren(
      el('div', { class: 'dlg-cab' },
        el('h2', { id: 'aus-tit' }, r.nombre),
        el('button', { type: 'button', class: 'ghost', 'aria-label': 'Cerrar', onclick: () => d.close() }, '✕')),
      el('div', { class: 'aus-fila' }, dia, cuando, hora),
      ya,
      el('div', { class: 'aus-botones' }, (TIPOS_AUS[r.tipo] || TIPOS_AUS.maquina).map(([k, nombre], i) =>
        el('button', { type: 'button', class: i === 0 ? 'primario' : '', onclick: () => guardar(k, nombre) }, nombre))),
      notas,
      el('p', { class: 'ayuda' }, r.tipo === 'operario'
        ? 'Una falta queda pendiente de justificante: cuando lo traiga (o no), vuelve aquí o a Recursos › Vacaciones y festivos. Si tenía trabajo asignado, sale un aviso con «Solucionar» para pasárselo a otro.'
        : 'Si estaba asignada, sale un aviso con «Solucionar» para cambiarla por otra del mismo tipo.'));
    pintarYa();
    d.showModal();
    d.querySelector('.aus-botones button')?.focus();
  }

  /* ---------- áreas de trabajo ---------- */
  async function abrirAreas() {
    const dlg = $('#dlg-areas');
    $('#form-area').hidden = !puedeAreas();
    await pintarAreas();
    if (!dlg.open) dlg.showModal();
  }

  async function pintarAreas() {
    const { tipos, areas, departamentos = [], obras_sin_proyecto: sueltas = [] } = await api('GET', '/api/areas');
    const editar = puedeAreas();
    const opciones = (sel) => tipos.map((t) => el('option', { value: t, selected: t === sel }, TIPO_TXT[t] || t));
    const opcDep = (sel) => [el('option', { value: '' }, '—'), ...departamentos.map((d) => el('option', { value: d.id, selected: d.id === sel }, d.nombre.replace(/^Departamento (de |)/, '')))];
    $('#form-area select[name=tipo]').replaceChildren(...opciones('taller'));
    $('#form-area select[name=departamento_id]').replaceChildren(...opcDep(null));

    const activas = areas.filter((a) => a.activo).map((a) => a.id);
    const guardar = (a, campo) => async (ev) => {
      let valor = ev.target.type === 'checkbox' ? ev.target.checked : ev.target.value;
      if (campo === 'departamento_id') valor = valor ? Number(valor) : null;
      if (valor === (a[campo] ?? '')) return;
      try {
        await api('PATCH', `/api/areas/${a.id}`, { [campo]: valor });
        a[campo] = valor;
        toast('Área guardada');
        if (campo === 'activo') await pintarAreas();
        cargar();
      } catch (e) { toast(e.message, true); ev.target.value = a[campo] ?? ''; }
    };

    $('#areas-tbody').replaceChildren(...areas.map((a) => el('tr', { class: a.activo ? '' : 'inactiva', ...(editar && a.activo ? { 'data-id': a.id } : {}) },
      el('td', { class: 'ord' }, editar && a.activo ? asaOrden(a.nombre) : ''),
      el('td', {}, el('input', { value: a.nombre, 'aria-label': 'Nombre', maxlength: 80, disabled: !editar, onchange: guardar(a, 'nombre') })),
      el('td', {}, el('select', { 'aria-label': 'Departamento', disabled: !editar, onchange: guardar(a, 'departamento_id') }, opcDep(a.departamento_id))),
      el('td', {}, el('select', { 'aria-label': 'Tipo', disabled: !editar, onchange: guardar(a, 'tipo') }, opciones(a.tipo))),
      el('td', {}, el('input', { value: a.ubicacion || '', 'aria-label': 'Ubicación', maxlength: 200, disabled: !editar, placeholder: '—', onchange: guardar(a, 'ubicacion') })),
      el('td', { class: 'centro' }, el('input', { type: 'checkbox', checked: a.exclusiva, 'aria-label': 'Un trabajo a la vez', title: 'Un solo trabajo a la vez (puesto de oficina, máquina fija): avisa si coinciden dos', disabled: !editar, onchange: guardar(a, 'exclusiva') })),
      el('td', { class: 'centro' }, el('input', { type: 'checkbox', checked: a.activo, 'aria-label': 'Activa', disabled: !editar, onchange: guardar(a, 'activo') })),
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
    // Obras sin proyecto: apartadas y plegadas, para que no ensucien la lista
    $('#obras-sueltas').hidden = !sueltas.length;
    $('#obras-sueltas summary').textContent = `Obras sin proyecto (${sueltas.length})`;
    $('#obras-sueltas-lista').replaceChildren(...sueltas.map((a) => el('li', {},
      el('span', {}, a.nombre), a.ubicacion ? el('span', { class: 'ayuda' }, ` · ${a.ubicacion}`) : null,
      a.usos ? el('span', { class: 'ayuda' }, ` · usada en ${a.usos} tarea(s)/tramo(s)`) : null,
      editar && !a.usos ? el('button', {
        type: 'button', class: 'ghost borrar mini',
        onclick: async () => {
          const r = await api('DELETE', `/api/areas/${a.id}`).catch((e) => toast(e.message, true));
          if (r) toast('Obra borrada');
          await pintarAreas();
        },
      }, 'Borrar') : null)));
    if (editar) {
      ordenArrastrable($('#areas-tbody'), async (ids) => {
        try { await api('PUT', '/api/areas/orden', { ids }); toast('Orden guardado'); } catch (e) { toast(e.message, true); }
        await pintarAreas(); cargar();
      });
    }
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
    window.s360.iniciar(estado.usuario);

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
    $('#rec-libres').onchange = (ev) => { guardarPref('rec_libres', ev.target.checked ? '1' : '0'); pintarRecursos(); aplicarFiltro(); };
    $('#rec-plegar').onclick = () => {
      const claves = [...document.querySelectorAll('.rec-clase-cab, .rec-cat-cab')].length ? ['operario', 'maquina', 'subcontrata'].map((c) => `rc:${c}`) : [];
      const todoPlegado = claves.every((k) => plegados.has(k));
      for (const k of claves) { if (todoPlegado) plegados.delete(k); else plegados.add(k); }
      if (todoPlegado) for (const k of [...plegados]) if (k.startsWith('rk:')) plegados.delete(k);
      guardarPref('plegados', JSON.stringify([...plegados].slice(-300)));
      pintarRecursos(); aplicarFiltro();
    };
    $('#solo-pend').onchange = (ev) => { guardarPref('solo_pend', ev.target.checked ? '1' : '0'); pintarOrdenes(); aplicarFiltro(); };
    $('#det-cerrar').onclick = () => { estado.solucion = null; seleccionar(null); };
    moverDetalle();
    $('#dlg-detalle').addEventListener('cancel', (ev) => { ev.preventDefault(); estado.solucion = null; seleccionar(null); });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && $('#dlg-detalle').open && !document.querySelector('dialog[open]:modal')) { estado.solucion = null; seleccionar(null); }
    });
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
