// Pasarela de IA: la única puerta por la que una IA (el asistente de la app, o Claude Code / Antigravity por MCP) usa
// el sistema. La IA no toca la base de datos: llama a «herramientas» de un catálogo, y cada herramienta llama a los
// MISMOS métodos GET de la API que usan las pantallas, en nombre de un usuario y con sus permisos.
//  · Fase 1: solo herramientas de LECTURA. Además, la API rechaza cualquier llamada interna de la IA que no sea GET.
//  · Todo queda en el registro (ia_registro): quién, por qué canal, qué herramienta, con qué datos, resultado y tiempo.
//  · Ajustes (ajustes.clave = 'ia'): IA encendida o apagada, canales, herramientas apagadas por canal, límite diario.
//  · Claves de IA (ia_claves): cada usuario con permiso «ia» se crea las suyas para conectar Claude Code / Antigravity
//    por MCP; se guardan solo con hash, se ven una vez y se pueden revocar.
const crypto = require('crypto');
const { query } = require('./db');
const auth = require('./auth');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const masDias = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const norm = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s*[×x*]\s*(?=\d)/g, 'x').trim();
const contiene = (txt, q) => !q || norm(txt).includes(norm(q));
const hh = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
const r1 = (x) => Math.round(Number(x || 0) * 10) / 10;
const fechaArg = (v, def) => { if (v == null || v === '') return def; if (v === 'hoy') return hoyMadrid(); if (v === 'mañana' || v === 'manana') return masDias(hoyMadrid(), 1); if (!FECHA.test(v)) throw fallo(400, `Fecha no válida: ${v} (usa AAAA-MM-DD)`); return v; };
const MAX = 40;
const cortar = (lista, n = MAX) => (lista.length > n ? { mostrando: n, total: lista.length, items: lista.slice(0, n) } : { total: lista.length, items: lista });

/* ---------- llamada interna a la API (solo GET), como el usuario ---------- */
let PUERTO = Number(process.env.PORT || 3000);
async function get(ctx, ruta) {
  const r = await fetch(`http://127.0.0.1:${PUERTO}${ruta}`, {
    headers: { 'x-ia-clave': auth.SECRETO_IA, 'x-ia-usuario': String(ctx.usuario.id), accept: 'application/json' },
  });
  const txt = await r.text();
  let datos; try { datos = JSON.parse(txt); } catch { datos = null; }
  if (!r.ok) throw fallo(r.status, datos?.error || `La API respondió ${r.status}`);
  return datos;
}

/* ---------- catálogo de herramientas (fase 1: lectura) ---------- */
// riesgo: leer | borrador | confirmar | nunca · permiso: el que exige la API por debajo (informativo; manda la API)
const H = [];
const herramienta = (h) => H.push({ riesgo: 'leer', canales: ['app', 'mcp'], permiso: null, ...h });

herramienta({
  nombre: 'ots_en_riesgo', grupo: 'Planificación',
  descripcion: 'OTs que no llegan a su entrega, van justas, están retrasadas o tienen horas sin planificar (lo mismo que «Solo con riesgo» del Gantt). Con todas=true devuelve todas las OTs abiertas con su riesgo.',
  entrada: { texto: { type: 'string', description: 'Filtra por código, OT, proyecto, cliente u obra' }, todas: { type: 'boolean', description: 'Todas las OTs abiertas, no solo las de riesgo' } },
  async run(ctx, a) {
    const d = await get(ctx, '/api/gantt?semanas=12');
    const riesgo = ['no_llega', 'faltan', 'sin_planificar', 'justo'];
    const l = d.ots.filter((o) => (a.todas || riesgo.includes(o.riesgo)) && contiene([o.codigo, o.titulo, o.proyecto.codigo, o.proyecto.nombre, o.proyecto.cliente, o.proyecto.obra].join(' '), a.texto))
      .map((o) => ({ ot: o.codigo, titulo: o.titulo, proyecto: `${o.proyecto.codigo} ${o.proyecto.nombre}`, cliente: o.proyecto.cliente, entrega: o.entrega, planificado: o.inicio ? `${o.inicio} → ${o.fin}` : null,
        riesgo: o.riesgo, situacion: o.riesgo_txt, horas_sin_planificar: o.falta_h, avance_pct: o.avance?.avance_pct ?? null }));
    return { hoy: d.hoy, ...cortar(l) };
  },
});

herramienta({
  nombre: 'proyectos_buscar', grupo: 'Proyectos',
  descripcion: 'Busca proyectos por código, nombre, cliente u obra. Devuelve estado, OTs abiertas, avance y condiciones pendientes.',
  entrada: { texto: { type: 'string', description: 'Código, nombre, cliente u obra' }, estado: { type: 'string', enum: ['activo', 'todos'], description: 'Por defecto, solo activos' } },
  async run(ctx, a) {
    const d = await get(ctx, '/api/proyectos');
    const l = d.filter((p) => (a.estado === 'todos' || p.estado === 'activo') && contiene([p.codigo, p.nombre, p.cliente, p.obra].join(' '), a.texto))
      .map((p) => ({ id: p.id, codigo: p.codigo, nombre: p.nombre, cliente: p.cliente_ficha?.nombre || p.cliente, obra: p.obra_ficha?.nombre || p.obra, estado: p.estado,
        ots: p.ots, ots_abiertas: p.ots_abiertas, avance_pct: p.avance?.avance_pct ?? null,
        condiciones_pendientes: (p.condiciones || []).filter((c) => !c.hecha && !c.cumplida).map((c) => c.texto).slice(0, 10) }));
    return cortar(l);
  },
});

herramienta({
  nombre: 'ot_detalle', grupo: 'Proyectos',
  descripcion: 'Detalle de una OT por su código (p. ej. 58.03): entrega, avance y cada tarea con horas estimadas y planificadas, área, estado, fechas planificadas y de qué tareas depende.',
  entrada: { codigo: { type: 'string', description: 'Código de la OT, p. ej. 58.03' } },
  requeridos: ['codigo'],
  async run(ctx, a) {
    const ots = await get(ctx, '/api/ordenes');
    const o = ots.find((x) => norm(x.codigo) === norm(a.codigo)) || ots.find((x) => norm(x.codigo_antiguo) === norm(a.codigo));
    if (!o) throw fallo(404, `No encuentro la OT ${a.codigo}`);
    const d = await get(ctx, `/api/ordenes/${o.id}`);
    const nom = new Map(d.lista_tareas.map((t) => [t.id, t.codigo]));
    return {
      ot: d.codigo, titulo: d.titulo, proyecto: `${d.proyecto_codigo} ${d.proyecto_nombre}`, partida: d.partida_nombre, estado: d.estado, entrega: d.fecha_entrega,
      prioridad: d.prioridad, avance_pct: d.avance?.avance_pct ?? null, horas_estimadas: r1(d.horas), horas_planificadas: r1(d.horas_planificadas),
      tareas: d.lista_tareas.map((t) => ({ codigo: t.codigo, nombre: t.nombre, horas: t.duracion_h, operarios: t.operarios_req, planificadas: r1(t.horas_planificadas), estado: t.estado,
        planificada: t.primera_fecha ? `${t.primera_fecha} → ${t.ultima_fecha}` : null, proveedor: t.proveedor || null,
        despues_de: (t.dependencias || []).map((x) => `${nom.get(x.id) || x.nombre || x.id}${x.espera_h ? ` (+${x.espera_h} h)` : ''}`),
        capacidades: (t.capacidades || []).map((k) => k.nombre) })),
    };
  },
});

herramienta({
  nombre: 'planificacion_dia', grupo: 'Planificación',
  descripcion: 'Lo planificado en el cuadrante un día: cada tramo con hora, tarea, OT, área y personas asignadas, más los avisos del día (falta gente, solapes…). Fecha AAAA-MM-DD, «hoy» o «mañana».',
  entrada: { fecha: { type: 'string', description: 'AAAA-MM-DD, hoy o mañana' }, area: { type: 'string', description: 'Filtra por área' } },
  async run(ctx, a) {
    const f = fechaArg(a.fecha, hoyMadrid());
    const d = await get(ctx, `/api/tablero?fecha=${f}`);
    const tarea = new Map(d.tareas.map((t) => [t.id, t])); const linea = new Map(d.lineas.map((l) => [l.id, l.nombre]));
    const l = d.tramos.filter((x) => contiene(linea.get(x.linea_id), a.area)).sort((x, y) => x.hora_inicio - y.hora_inicio).map((x) => {
      const t = tarea.get(x.tarea_id) || {};
      return { hora: `${hh(x.hora_inicio)}–${hh(x.hora_inicio + x.duracion_h)}`, tarea: `${t.codigo} ${t.nombre}`, ot: `${t.orden_codigo} ${t.orden_titulo}`, area: linea.get(x.linea_id),
        personas: (x.asignados || []).map((r) => r.nombre), cerrado: !!x.cierre };
    });
    return { fecha: f, festivo: (d.festivos || []).some((x) => (x.fecha || x) === f), tramos: cortar(l, 80), avisos: (d.conflictos || []).slice(0, 30).map((c) => c.mensaje) };
  },
});

herramienta({
  nombre: 'agenda_persona', grupo: 'Planificación',
  descripcion: 'En qué trabaja una persona (o máquina) entre dos fechas (máx. 31 días): tramos con hora, tarea, OT y área, y sus ausencias. Busca la persona por nombre.',
  entrada: { persona: { type: 'string', description: 'Nombre (o parte) de la persona o recurso' }, desde: { type: 'string', description: 'AAAA-MM-DD, hoy o mañana (por defecto hoy)' }, hasta: { type: 'string', description: 'AAAA-MM-DD (por defecto, una semana)' } },
  requeridos: ['persona'],
  async run(ctx, a) {
    const desde = fechaArg(a.desde, hoyMadrid()); const hasta = fechaArg(a.hasta, masDias(desde, 6));
    if (hasta < desde || (Date.parse(hasta) - Date.parse(desde)) / 864e5 > 31) throw fallo(400, 'Rango de fechas no válido (máx. 31 días)');
    const d = await get(ctx, `/api/tablero?desde=${desde}&hasta=${hasta}`);
    const cand = d.recursos.filter((r) => contiene(r.nombre, a.persona));
    if (!cand.length) throw fallo(404, `No encuentro a «${a.persona}»`);
    if (cand.length > 1 && !cand.some((r) => norm(r.nombre) === norm(a.persona))) return { varias_coinciden: cand.slice(0, 10).map((r) => r.nombre), pista: 'Di el nombre completo' };
    const r = cand.find((x) => norm(x.nombre) === norm(a.persona)) || cand[0];
    const tarea = new Map(d.tareas.map((t) => [t.id, t])); const linea = new Map(d.lineas.map((l) => [l.id, l.nombre]));
    const tramos = d.tramos.filter((x) => (x.asignados || []).some((y) => y.id === r.id)).sort((x, y) => (x.fecha + hh(x.hora_inicio)).localeCompare(y.fecha + hh(y.hora_inicio)))
      .map((x) => { const t = tarea.get(x.tarea_id) || {}; const asg = x.asignados.find((y) => y.id === r.id); const ini = asg?.desde ?? x.hora_inicio; const fin = asg?.hasta ?? x.hora_inicio + x.duracion_h;
        return { fecha: x.fecha, hora: `${hh(ini)}–${hh(fin)}`, tarea: `${t.codigo} ${t.nombre}`, ot: t.orden_codigo, area: linea.get(x.linea_id), obra: t.obra || null }; });
    const aus = (d.ausencias || []).filter((x) => x.recurso_id === r.id).map((x) => ({ tipo: x.tipo, desde: x.desde, hasta: x.hasta, horas: x.hora_desde != null ? `${hh(x.hora_desde)}–${hh(x.hora_hasta)}` : 'todo el día' }));
    return { persona: r.nombre, categoria: r.categoria, desde, hasta, tramos: cortar(tramos, 80), ausencias: aus };
  },
});

herramienta({
  nombre: 'personas_libres', grupo: 'Planificación',
  descripcion: 'Operarios libres un día (y opcionalmente en una franja horaria), sin ausencias ni otra tarea a esa hora. Puede filtrar por capacidad («Soldadura MIG/MAG»…).',
  entrada: { fecha: { type: 'string', description: 'AAAA-MM-DD, hoy o mañana' }, desde: { type: 'number', description: 'Hora de inicio (p. ej. 7 o 11.5)' }, hasta: { type: 'number', description: 'Hora de fin (p. ej. 15)' }, capacidad: { type: 'string', description: 'Que sepa hacer… (nombre o parte)' } },
  async run(ctx, a) {
    const f = fechaArg(a.fecha, hoyMadrid());
    const d = await get(ctx, `/api/tablero?fecha=${f}`);
    const ini = Number.isFinite(a.desde) ? a.desde : d.jornada?.inicio ?? 7; const fin = Number.isFinite(a.hasta) ? a.hasta : d.jornada?.fin ?? 15;
    const ocupado = (id) => d.tramos.some((x) => (x.asignados || []).some((y) => y.id === id && (y.desde ?? x.hora_inicio) < fin && (y.hasta ?? x.hora_inicio + x.duracion_h) > ini));
    const fuera = (id) => (d.ausencias || []).some((x) => x.recurso_id === id && x.desde <= f && x.hasta >= f && (x.hora_desde == null || (x.hora_desde < fin && x.hora_hasta > ini)));
    const l = d.recursos.filter((r) => r.tipo === 'operario' && r.activo !== false && !ocupado(r.id) && !fuera(r.id) && (!a.capacidad || contiene(r.capacidades_txt, a.capacidad)))
      .map((r) => ({ nombre: r.nombre, categoria: r.categoria || r.tipos_txt || null, sabe: r.capacidades_txt || null }));
    return { fecha: f, franja: `${hh(ini)}–${hh(fin)}`, capacidad: a.capacidad || null, ...cortar(l, 60) };
  },
});

herramienta({
  nombre: 'ausencias', grupo: 'Personas',
  descripcion: 'Ausencias (vacaciones, bajas, permisos, faltas…) entre dos fechas, opcionalmente de una persona.',
  entrada: { desde: { type: 'string', description: 'AAAA-MM-DD (por defecto hoy)' }, hasta: { type: 'string', description: 'AAAA-MM-DD (por defecto, 30 días)' }, persona: { type: 'string' } },
  async run(ctx, a) {
    const desde = fechaArg(a.desde, hoyMadrid()); const hasta = fechaArg(a.hasta, masDias(desde, 30));
    const d = await get(ctx, `/api/ausencias?desde=${desde}&hasta=${hasta}`);
    const l = d.filter((x) => contiene(x.recurso, a.persona)).map((x) => ({ persona: x.recurso, tipo: x.tipo, desde: x.desde, hasta: x.hasta,
      horas: x.hora_desde != null ? `${hh(x.hora_desde)}–${hh(x.hora_hasta)}` : 'todo el día', dias_laborables: x.dias_laborables ?? null, notas: x.notas || null }));
    return { desde, hasta, ...cortar(l) };
  },
});

herramienta({
  nombre: 'pedidos_compra', grupo: 'Compras',
  descripcion: 'Pedidos de compra a proveedores: código, proveedor, estado, fecha de entrega y total. Filtra por estado, proveedor u OT.',
  entrada: { estado: { type: 'string', description: 'borrador, pendiente_aprobacion, aprobado, enviado, recibido_parcial, recibido… o «pendientes» (lo que no está recibido ni cancelado)' }, proveedor: { type: 'string' }, texto: { type: 'string', description: 'Código de pedido, referencia u observaciones' } },
  permiso: 'compras / logística',
  async run(ctx, a) {
    const [d, provs] = await Promise.all([get(ctx, '/api/compras/pedidos'), get(ctx, '/api/proveedores').catch(() => [])]);
    const pnom = new Map((Array.isArray(provs) ? provs : provs.proveedores || []).map((p) => [p.id, p.nombre]));
    const cerrados = ['recibido', 'cancelado', 'anulado', 'cerrado'];
    const l = d.pedidos.filter((p) => (!a.estado || (a.estado === 'pendientes' ? !cerrados.includes(p.estado) : p.estado === a.estado))
      && contiene(pnom.get(p.proveedor_id), a.proveedor) && contiene([p.codigo, p.referencia, p.observaciones].join(' '), a.texto))
      .map((p) => ({ codigo: p.codigo, proveedor: pnom.get(p.proveedor_id) || p.proveedor_id, estado: p.estado, entrega: p.fecha_entrega, total: p.total != null ? Number(p.total) : null, referencia: p.referencia || null, enviado: p.enviado_en || null }));
    return cortar(l);
  },
});

herramienta({
  nombre: 'envios_transporte', grupo: 'Logística',
  descripcion: 'Envíos de transporte: código, estado, si el transportista aceptó, recogida y llegada previstas, destino.',
  entrada: { estado: { type: 'string', description: 'preparando, enviado, en_camino, entregado… o «abiertos»' } },
  permiso: 'logística / compras',
  async run(ctx, a) {
    const d = await get(ctx, '/api/transportes');
    const tnom = new Map((d.transportistas || []).map((t) => [t.id, t.nombre]));
    const l = (d.envios || []).filter((e) => !a.estado || (a.estado === 'abiertos' ? !['entregado', 'cancelado'].includes(e.estado) : e.estado === a.estado))
      .map((e) => ({ codigo: e.codigo, transportista: tnom.get(e.transportista_id) || null, estado: e.estado, aceptacion: e.aceptacion, recogida: e.recogida_prevista, llegada: e.llegada_prevista, destino: e.entregar_en, incidencia: e.incidencia && !e.incidencia_resuelta ? e.incidencia : null }));
    return { pendientes_de_enviar: (d.pendientes || []).length, ...cortar(l) };
  },
});

herramienta({
  nombre: 'incidencias', grupo: 'Incidencias',
  descripcion: 'Incidencias (material, transporte, calidad, avería, seguridad, proveedor…): código, tipo, gravedad, estado y título. Por defecto, las abiertas.',
  entrada: { todas: { type: 'boolean', description: 'Incluir cerradas' }, texto: { type: 'string' }, tipo: { type: 'string' } },
  async run(ctx, a) {
    const d = await get(ctx, '/api/incidencias');
    const l = d.incidencias.filter((i) => (a.todas || !['cerrada', 'resuelta', 'descartada'].includes(i.estado)) && (!a.tipo || norm(i.tipo) === norm(a.tipo)) && contiene([i.codigo, i.titulo, i.texto, i.area].join(' '), a.texto))
      .map((i) => ({ codigo: i.codigo, tipo: i.tipo, gravedad: i.gravedad, estado: i.estado, titulo: i.titulo, creada: i.creado, limite: i.fecha_limite || null }));
    return cortar(l);
  },
});

herramienta({
  nombre: 'clientes_buscar', grupo: 'Proyectos',
  descripcion: 'Busca clientes por nombre, CIF o código: datos de contacto, forma de pago y nº de proyectos.',
  entrada: { texto: { type: 'string', description: 'Nombre, CIF o código' } },
  requeridos: ['texto'],
  async run(ctx, a) {
    const d = await get(ctx, `/api/clientes?q=${encodeURIComponent(a.texto)}`);
    return cortar(d.map((c) => ({ id: c.id, nombre: c.nombre, cif: c.cif, codigo: c.codigo_ext, tipo: c.tipo, telefono: c.telefono || c.movil || null, email: c.email || null, forma_pago: c.forma_pago || null, proyectos: c.proyectos, activos: c.activos })), 20);
  },
});

herramienta({
  nombre: 'obras_buscar', grupo: 'Proyectos',
  descripcion: 'Obras (direcciones donde se trabaja) con sus proyectos activos e incidencias. Busca por nombre o dirección.',
  entrada: { texto: { type: 'string' }, todas: { type: 'boolean', description: 'Incluir obras sin proyecto activo' } },
  async run(ctx, a) {
    const d = await get(ctx, `/api/obras?vista=${a.todas ? 'todas' : 'activas'}&q=${encodeURIComponent(a.texto || '')}`);
    return cortar(d.obras.map((o) => ({ id: o.id, nombre: o.nombre, direccion: o.direccion, clientes: o.clientes, proyectos_activos: o.activos, incidencias: o.incidencias })));
  },
});

herramienta({
  nombre: 'capacidades_quien', grupo: 'Personas',
  descripcion: 'Quién tiene validada una capacidad (lo que sabe hacer cada persona), p. ej. «Soldadura TIG».',
  entrada: { capacidad: { type: 'string', description: 'Nombre o parte de la capacidad' } },
  requeridos: ['capacidad'],
  async run(ctx, a) {
    const d = await get(ctx, '/api/capacidades');
    const pers = new Map(d.personas.map((p) => [p.id, p.nombre]));
    const l = d.capacidades.filter((k) => contiene(`${k.familia} ${k.nombre}`, a.capacidad))
      .map((k) => ({ capacidad: k.nombre, familia: k.familia, saben: (k.personas || []).map((id) => pers.get(id)).filter(Boolean), tareas_que_la_piden: k.tareas }));
    return cortar(l, 20);
  },
});

herramienta({
  nombre: 'materiales_buscar', grupo: 'Compras',
  descripcion: 'Busca en el catálogo de materiales (perfiles, chapas, tornillería…) por nombre o familia: nombre exacto, familia y unidad.',
  entrada: { texto: { type: 'string', description: 'Palabras del material (p. ej. «tubo 40x40»)' } },
  requeridos: ['texto'],
  permiso: 'proyectos',
  async run(ctx, a) {
    const d = await get(ctx, '/api/importar/catalogo');
    const palabras = norm(a.texto).split(/\s+/).filter(Boolean);
    const l = (d.materiales || []).filter((m) => { const t = norm(`${m.familia} ${m.nombre}`); return palabras.every((p) => t.includes(p)); })
      .map((m) => ({ nombre: m.nombre, familia: m.familia, unidad: m.unidad }));
    return cortar(l, 30);
  },
});

const PORNOMBRE = new Map(H.map((h) => [h.nombre, h]));
const esquema = (h) => ({ type: 'object', properties: h.entrada || {}, required: h.requeridos || [], additionalProperties: false });

/* ---------- ajustes ---------- */
const AJ_DEF = { activo: true, canales: { app: true, mcp: true }, apagadas: {}, limite_dia: 500 };
async function ajustes() {
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'ia'`);
  let v = {}; try { v = rows.length ? (typeof rows[0].valor === 'string' ? JSON.parse(rows[0].valor) : rows[0].valor) : {}; } catch { v = {}; }
  return { ...AJ_DEF, ...v, canales: { ...AJ_DEF.canales, ...(v.canales || {}) }, apagadas: v.apagadas || {} };
}
const disponible = (aj, h, canal) => h.canales.includes(canal === 'prueba' ? 'app' : canal) && !(aj.apagadas[h.nombre] || []).includes(canal);

/* ---------- ejecutar una herramienta (con registro) ---------- */
async function ejecutar(usuario, canal, nombre, args, extra = {}) {
  const t0 = Date.now();
  const h = PORNOMBRE.get(nombre);
  let ok = false; let error = null; let resultado = null;
  try {
    const aj = await ajustes();
    if (!aj.activo) throw fallo(503, 'La IA está apagada en Ajustes › IA');
    if (canal !== 'prueba' && !aj.canales[canal]) throw fallo(503, `El canal «${canal}» está apagado en Ajustes › IA`);
    if (!h) throw fallo(404, `No existe la herramienta «${nombre}»`);
    if (!disponible(aj, h, canal)) throw fallo(403, `La herramienta «${nombre}» no está disponible por ${canal}`);
    if (!auth.tiene(usuario, 'ia') && !auth.tiene(usuario, 'usuarios')) throw fallo(403, 'Tu usuario no tiene permiso para usar la IA');
    const { rows: n } = await query(`SELECT count(*)::int AS n FROM ia_registro WHERE usuario_id = $1 AND creado > now() - interval '1 day'`, [usuario.id]);
    if (n[0].n >= aj.limite_dia) throw fallo(429, `Límite de ${aj.limite_dia} consultas de IA en 24 h alcanzado`);
    // solo lo que el esquema conoce
    const a = {};
    for (const [k, def] of Object.entries(h.entrada || {})) {
      if (args?.[k] == null || args[k] === '') continue;
      const v = args[k];
      if (def.type === 'number') { const x = Number(v); if (!Number.isFinite(x)) throw fallo(400, `«${k}» debe ser un número`); a[k] = x; }
      else if (def.type === 'boolean') a[k] = v === true || v === 'true';
      else a[k] = String(v).slice(0, 200);
    }
    for (const k of h.requeridos || []) if (a[k] == null) throw fallo(400, `Falta «${k}»`);
    resultado = await h.run({ usuario }, a);
    ok = true;
    return resultado;
  } catch (e) {
    error = e.message; throw e;
  } finally {
    const txt = resultado ? JSON.stringify(resultado) : '';
    await query(
      `INSERT INTO ia_registro (usuario_id, canal, herramienta, riesgo, args, ok, error, ms, bytes, resumen, clave_id, conversacion_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [usuario.id, canal, nombre, h?.riesgo || null, JSON.stringify(args || {}).slice(0, 4000), ok, error, Date.now() - t0, txt.length,
        resultado ? resumir(resultado) : null, extra.clave_id || null, extra.conversacion_id || null]).catch((e) => console.error('ia_registro:', e.message));
  }
}
function resumir(r) {
  if (r.total != null) return `${r.total} resultado${r.total === 1 ? '' : 's'}`;
  if (r.tramos?.total != null) return `${r.tramos.total} tramos${r.avisos?.length ? ` · ${r.avisos.length} avisos` : ''}`;
  if (r.tareas) return `${r.tareas.length} tareas`;
  if (r.varias_coinciden) return `varias personas coinciden`;
  return 'ok';
}

/* ---------- claves de IA (para MCP) ---------- */
const hashClave = (c) => crypto.createHash('sha256').update(c).digest('hex');
async function usuarioDeClave(clave) {
  if (!/^s360ia_[A-Za-z0-9_-]{20,}$/.test(clave || '')) return null;
  const { rows } = await query(
    `SELECT k.id AS clave_id, u.id, u.email, u.nombre, u.rol, u.recurso_id, ${auth.SQL_PERMISOS} AS permisos
       FROM ia_claves k JOIN usuarios u ON u.id = k.usuario_id
      WHERE k.hash = $1 AND k.revocada IS NULL AND u.activo`, [hashClave(clave)]);
  if (!rows.length) return null;
  await query('UPDATE ia_claves SET ultimo_uso = now() WHERE id = $1', [rows[0].clave_id]);
  return rows[0];
}

/* ---------- MCP (Streamable HTTP, respuestas JSON, sin estado) ---------- */
const VERSIONES = ['2025-06-18', '2025-03-26', '2024-11-05'];
async function mcp(req, res) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  const u = m ? await usuarioDeClave(m[1].trim()) : null;
  if (!u) { res.set('WWW-Authenticate', 'Bearer'); return res.status(401).json({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Clave de IA no válida o revocada (créala en Ajustes › IA)' } }); }
  const lote = Array.isArray(req.body) ? req.body : [req.body];
  const respuestas = [];
  for (const msg of lote) {
    if (!msg || msg.jsonrpc !== '2.0' || !msg.method) { respuestas.push({ jsonrpc: '2.0', id: msg?.id ?? null, error: { code: -32600, message: 'Petición no válida' } }); continue; }
    if (msg.id === undefined) continue; // notificación (p. ej. notifications/initialized)
    const ok = (result) => respuestas.push({ jsonrpc: '2.0', id: msg.id, result });
    try {
      if (msg.method === 'initialize') {
        const pv = VERSIONES.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : VERSIONES[0];
        ok({ protocolVersion: pv, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'planealo', title: 'Planéalo (HAM Menorca)', version: '1.0.0' },
          instructions: 'Herramientas de SOLO LECTURA del planificador Planéalo: planificación (cuadrante, Gantt, quién está libre), proyectos y OTs, personas, compras, logística e incidencias. Fechas AAAA-MM-DD. Actúas con los permisos del usuario dueño de la clave.' });
      } else if (msg.method === 'ping') ok({});
      else if (msg.method === 'tools/list') {
        const aj = await ajustes();
        ok({ tools: H.filter((h) => disponible(aj, h, 'mcp')).map((h) => ({ name: h.nombre, title: h.nombre.replace(/_/g, ' '), description: h.descripcion, inputSchema: esquema(h), annotations: { readOnlyHint: h.riesgo === 'leer' } })) });
      } else if (msg.method === 'tools/call') {
        try {
          const r = await ejecutar(u, 'mcp', msg.params?.name, msg.params?.arguments || {}, { clave_id: u.clave_id });
          ok({ content: [{ type: 'text', text: JSON.stringify(r) }], structuredContent: r, isError: false });
        } catch (e) { ok({ content: [{ type: 'text', text: e.message }], isError: true }); }
      } else if (msg.method === 'resources/list') ok({ resources: [] });
      else if (msg.method === 'prompts/list') ok({ prompts: [] });
      else respuestas.push({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `Método no soportado: ${msg.method}` } });
    } catch (e) { respuestas.push({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: e.message } }); }
  }
  if (!respuestas.length) return res.status(202).end();
  res.json(Array.isArray(req.body) ? respuestas : respuestas[0]);
}

/* ---------- rutas ---------- */
function montarPublico(app, express) {
  app.post('/mcp', express.json({ limit: '1mb' }), (req, res, next) => mcp(req, res).catch(next));
  app.get('/mcp', (req, res) => res.status(405).set('Allow', 'POST').json({ error: 'Usa POST (MCP Streamable HTTP, respuestas JSON)' }));
  app.delete('/mcp', (req, res) => res.status(405).end());
}

function montar(app, asyncH, { puerto } = {}) {
  if (puerto) PUERTO = puerto;
  const admin = auth.permiso('usuarios');
  const usar = auth.permiso('ia', 'usuarios');

  // Catálogo (lo que ve este usuario) y estado
  app.get('/api/ia', usar, asyncH(async (req, res) => {
    const aj = await ajustes();
    res.json({
      ajustes: aj, puede_admin: auth.tiene(req.usuario, 'usuarios'),
      herramientas: H.map((h) => ({ nombre: h.nombre, grupo: h.grupo, descripcion: h.descripcion, riesgo: h.riesgo, permiso: h.permiso, canales: h.canales,
        apagada_en: aj.apagadas[h.nombre] || [], entrada: h.entrada || {}, requeridos: h.requeridos || [] })),
      mcp_url: `${req.protocol === 'http' && req.get('x-forwarded-proto') === 'https' ? 'https' : req.get('x-forwarded-proto') || req.protocol}://${req.get('host')}/mcp`,
    });
  }));
  app.put('/api/ia/ajustes', admin, asyncH(async (req, res) => {
    const b = req.body || {}; const aj = await ajustes();
    if (b.activo != null) aj.activo = !!b.activo;
    if (b.canales) for (const k of ['app', 'mcp']) if (b.canales[k] != null) aj.canales[k] = !!b.canales[k];
    if (b.limite_dia != null) { const n = Math.trunc(Number(b.limite_dia)); if (!(n >= 10 && n <= 100000)) throw fallo(400, 'Límite entre 10 y 100000'); aj.limite_dia = n; }
    if (b.herramienta && PORNOMBRE.has(b.herramienta) && b.canal) {
      const l = new Set(aj.apagadas[b.herramienta] || []);
      if (b.apagada) l.add(b.canal); else l.delete(b.canal);
      aj.apagadas[b.herramienta] = [...l];
    }
    await query(`INSERT INTO ajustes (clave, valor) VALUES ('ia', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(aj)]);
    res.json(aj);
  }));

  // Probar una herramienta a mano (canal «prueba», queda en el registro)
  app.post('/api/ia/probar/:nombre', usar, asyncH(async (req, res) => {
    res.json(await ejecutar(req.usuario, 'prueba', req.params.nombre, req.body?.args || {}));
  }));

  // Registro
  app.get('/api/ia/registro', usar, asyncH(async (req, res) => {
    const todos = auth.tiene(req.usuario, 'usuarios');
    const w = []; const p = [];
    if (!todos) { p.push(req.usuario.id); w.push(`r.usuario_id = $${p.length}`); }
    if (req.query.canal) { p.push(req.query.canal); w.push(`r.canal = $${p.length}`); }
    if (req.query.herramienta) { p.push(req.query.herramienta); w.push(`r.herramienta = $${p.length}`); }
    if (req.query.usuario && todos) { p.push(Number(req.query.usuario)); w.push(`r.usuario_id = $${p.length}`); }
    if (req.query.errores === '1') w.push('NOT r.ok');
    const { rows } = await query(
      `SELECT r.id, r.creado, r.canal, r.herramienta, r.riesgo, r.args, r.ok, r.error, r.ms, r.bytes, r.resumen, u.nombre AS usuario, k.nombre AS clave
         FROM ia_registro r LEFT JOIN usuarios u ON u.id = r.usuario_id LEFT JOIN ia_claves k ON k.id = r.clave_id
        ${w.length ? `WHERE ${w.join(' AND ')}` : ''} ORDER BY r.id DESC LIMIT 300`, p);
    const { rows: hoy } = await query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE NOT ok)::int AS errores FROM ia_registro WHERE creado > now() - interval '1 day' ${todos ? '' : 'AND usuario_id = $1'}`, todos ? [] : [req.usuario.id]);
    res.json({ registro: rows, ultimas_24h: hoy[0], todos });
  }));

  // Claves de IA del propio usuario (para conectar Claude Code / Antigravity por MCP)
  app.get('/api/ia/claves', usar, asyncH(async (req, res) => {
    const todos = auth.tiene(req.usuario, 'usuarios') && req.query.todas === '1';
    const { rows } = await query(
      `SELECT k.id, k.nombre, k.prefijo, k.creado, k.ultimo_uso, k.revocada, u.nombre AS usuario, k.usuario_id = $1 AS mia
         FROM ia_claves k JOIN usuarios u ON u.id = k.usuario_id ${todos ? '' : 'WHERE k.usuario_id = $1'} ORDER BY k.revocada NULLS FIRST, k.id DESC`, [req.usuario.id]);
    res.json(rows);
  }));
  app.post('/api/ia/claves', usar, asyncH(async (req, res) => {
    const nombre = String(req.body?.nombre || '').trim().slice(0, 60) || 'Claude Code';
    const clave = `s360ia_${crypto.randomBytes(24).toString('base64url')}`;
    await query('INSERT INTO ia_claves (usuario_id, nombre, hash, prefijo) VALUES ($1,$2,$3,$4)', [req.usuario.id, nombre, hashClave(clave), clave.slice(0, 12)]);
    res.status(201).json({ clave, nombre, aviso: 'Cópiala ahora: no se vuelve a mostrar.' });
  }));
  app.delete('/api/ia/claves/:id', usar, asyncH(async (req, res) => {
    const todos = auth.tiene(req.usuario, 'usuarios');
    const { rowCount } = await query(`UPDATE ia_claves SET revocada = now() WHERE id = $1 AND revocada IS NULL ${todos ? '' : 'AND usuario_id = $2'}`, todos ? [Number(req.params.id)] : [Number(req.params.id), req.usuario.id]);
    if (!rowCount) throw fallo(404, 'Clave no encontrada');
    res.json({ ok: true });
  }));
}

module.exports = { montar, montarPublico, ejecutar, herramientas: H, ajustesIA: ajustes };
