// Seguimiento de los talleres externos: el taller nos dice cómo van sus tareas, sin cuenta ni contraseña.
//  · Un enlace por taller y OT (ext_seguimientos). Se crea y se envía al pulsar «Comenzar seguimiento» en la OT
//    (por correo o copiando el enlace para WhatsApp). Firma: HMAC con la clave del servidor sobre un número
//    aleatorio de la fila; «nuevo enlace» lo cambia y anula el anterior.
//  · En su enlace ve sus tareas de la OT (y, sin poder tocarlas, las de los demás talleres) con nuestras fechas.
//    En las suyas pone estado (sin empezar / en curso / terminado / entregado), avance, cuándo terminará,
//    comentario, fotos y, al entregar, a quién (otro taller de la OT, nosotros u otro), fecha, bultos y albarán.
//  · Lo que pone actualiza la tarea (y la situación del producto) y avisa a quien planifica. Solo avisa: si
//    retrasa su fecha, el plan no se mueve solo (sale como aviso en el cuadrante).
//  · Recordatorio: si pasa su fecha prevista (o la nuestra) sin terminar y no ha dicho nada ese día, un correo
//    al día, solo días laborables, hasta que actualice o lo termine.
const crypto = require('crypto');
const express = require('express');
const { query, tx } = require('./db');
const auth = require('./auth');
const correo = require('./correo');
const notif = require('./notificaciones');
const obra = require('./subcontratas-obra');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);
const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10)) ? String(v).slice(0, 10) : null);
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const horaMadrid = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
const ESTADOS = ['sin_empezar', 'en_curso', 'terminado', 'entregado'];
const ESTADO_TXT = { sin_empezar: 'sin empezar', en_curso: 'en curso', terminado: 'terminado', entregado: 'entregado' };
const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_FOTO = 6 * 1024 * 1024;
const MAX_N_FOTOS = 12;

let ultimaBase = '';   // para los recordatorios (sin petición): la dirección con la que se entró la última vez
function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  if (req) ultimaBase = `${req.protocol}://${req.get('host')}`;
  return ultimaBase;
}
const firma = (id, nonce) => correo.firmar(`seguimiento:${id}:${nonce}`);
const urlDe = (s, req) => `${baseUrl(req)}/seguimiento.html?t=${s.id}.${firma(s.id, s.nonce)}`;

// Estado que ve el taller: el suyo, o el que se deduce de la tarea si aún no ha dicho nada
const estadoExt = (t) => t.ext_estado || (t.estado === 'hecha' ? 'terminado' : t.estado === 'en_curso' ? 'en_curso' : 'sin_empezar');

async function porToken(t, c = { query }) {
  const m = /^(\d{1,9})\.([A-Za-z0-9_-]{32})$/.exec(String(t || ''));
  const noVale = fallo(404, 'Este enlace no es válido o ya no está activo. Pídanos uno nuevo respondiendo a nuestro correo.');
  if (!m) throw noVale;
  const id = Number(m[1]);
  const { rows } = await c.query(
    `SELECT s.*, p.nombre AS proveedor, o.codigo AS ot_codigo, o.titulo AS ot_titulo, o.estado AS ot_estado,
            pr.nombre AS proyecto, pr.obra, pr.cliente, ob.nombre AS obra_nombre, ob.contacto AS obra_contacto, ob.telefono AS obra_telefono, ob.acceso AS obra_acceso
       FROM ext_seguimientos s JOIN proveedores p ON p.id = s.proveedor_id JOIN ordenes o ON o.id = s.orden_id
       LEFT JOIN proyectos pr ON pr.id = o.proyecto_id LEFT JOIN obras ob ON ob.id = pr.obra_id
      WHERE s.id = $1`, [id]);
  const r = rows[0];
  if (!r || !r.activo) throw noVale;
  const a = Buffer.from(firma(id, r.nonce)); const b = Buffer.from(m[2]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw noVale;
  return r;
}

// Tareas externas de la OT, con su plan, lo que ha dicho el taller y sus fotos
async function tareasOT(ordenId, c = { query }) {
  const { rows } = await c.query(
    `SELECT t.id, t.codigo, t.nombre, t.estado, t.orden_en_of, t.proveedor_id, pv.nombre AS proveedor, t.ext_en_obra,
            t.ext_estado, t.ext_avance, t.ext_nota, t.ext_fin_prevista::text AS ext_fin_prevista, t.ext_actualizado,
            t.ext_entregado_a, t.ext_entregado_proveedor_id, t.ext_entrega_fecha::text AS ext_entrega_fecha, t.ext_entrega_nota,
            t.ext_recibido::text AS ext_recibido,
            (SELECT min(x.fecha)::text FROM tramos x WHERE x.tarea_id = t.id) AS plan_desde,
            (SELECT max(x.fecha)::text FROM tramos x WHERE x.tarea_id = t.id) AS plan_hasta,
            t.ext_pedido_id AS pedido_id, pc.codigo AS pedido_codigo, pc.estado AS pedido_estado, pcp.nombre AS pedido_proveedor,
            t.ext_solicitud_id AS solicitud_id, sol.codigo AS solicitud_codigo, sol.estado AS solicitud_estado
       FROM tareas t JOIN proveedores pv ON pv.id = t.proveedor_id
       LEFT JOIN pedidos_compra pc ON pc.id = t.ext_pedido_id AND pc.estado <> 'anulado' LEFT JOIN proveedores pcp ON pcp.id = pc.proveedor_id
       LEFT JOIN solicitudes_precio sol ON sol.id = t.ext_solicitud_id AND sol.estado = 'abierta'
      WHERE t.orden_id = $1 AND t.proveedor_id IS NOT NULL AND NOT t.baja_presupuesto
      ORDER BY t.orden_en_of, t.id`, [ordenId]);
  return rows;
}
async function archivosDe(tareaIds) {
  if (!tareaIds.length) return [];
  const { rows } = await query(
    `SELECT id, ref_tipo, ref_id AS tarea_id, tipo, nombre, creado_por IS NULL AS del_taller, creado
       FROM archivos WHERE ref_tipo IN ('ext_foto', 'ext_albaran') AND ref_id = ANY($1) ORDER BY id`, [tareaIds]);
  return rows;
}

async function vista(s) {
  const aj = await require('./compras').ajustes();
  const ts = await tareasOT(s.orden_id);
  const arch = await archivosDe(ts.filter((t) => t.proveedor_id === s.proveedor_id).map((t) => t.id));
  const hoy = hoyMadrid();
  const nombreDe = new Map(ts.map((t) => [t.proveedor_id, t.proveedor]));
  const extraObra = new Map();
  for (const t of ts) if (t.proveedor_id === s.proveedor_id && t.ext_en_obra) extraObra.set(t.id, await obra.paraEnlace(t));
  const tareas = ts.map((t, i) => {
    const propia = t.proveedor_id === s.proveedor_id;
    const est = estadoExt(t);
    const base = { id: t.id, codigo: t.codigo, nombre: t.nombre, propia, proveedor: t.proveedor, estado: est,
      plan: { desde: t.plan_desde, hasta: t.plan_hasta } };
    if (!propia) return base;
    // quién le pasa la pieza: la tarea externa anterior de otro taller
    const prev = ts.slice(0, i).reverse().find((x) => x.proveedor_id !== s.proveedor_id);
    const ref = t.ext_fin_prevista || t.plan_hasta;
    return {
      ...base,
      avance: t.ext_avance, fin_prevista: t.ext_fin_prevista, nota: t.ext_nota, actualizado: t.ext_actualizado,
      recibido: t.ext_recibido,
      viene_de: prev ? { proveedor: prev.proveedor, estado: estadoExt(prev), entrega: prev.ext_entrega_fecha } : null,
      entrega: { a: t.ext_entregado_a, proveedor_id: t.ext_entregado_proveedor_id, fecha: t.ext_entrega_fecha, nota: t.ext_entrega_nota },
      vencida: !t.ext_en_obra && !['terminado', 'entregado'].includes(est) && !!ref && ref < hoy,
      ...(extraObra.get(t.id) || {}),
      fotos: arch.filter((a) => a.tarea_id === t.id && a.ref_tipo === 'ext_foto').map((a) => ({ id: a.id, nombre: a.nombre, tipo: a.tipo, mia: a.del_taller })),
      albaran: arch.filter((a) => a.tarea_id === t.id && a.ref_tipo === 'ext_albaran').map((a) => ({ id: a.id, nombre: a.nombre, tipo: a.tipo, mia: a.del_taller })),
    };
  });
  // a quién puede entregar: los demás talleres de la OT, nosotros u otro
  const destinos = [...nombreDe].filter(([id]) => id !== s.proveedor_id).map(([id, nombre]) => ({ id, nombre }));
  return {
    empresa: { nombre: aj.empresa.nombre, telefono: aj.empresa.telefono, email: aj.empresa.email, direccion: aj.empresa.direccion },
    proveedor: s.proveedor,
    pedidos: [...new Set(ts.filter((t) => t.proveedor_id === s.proveedor_id && t.pedido_estado === 'enviado').map((t) => t.pedido_codigo))],
    ot: { codigo: s.ot_codigo, titulo: s.ot_titulo, abierta: s.ot_estado !== 'cerrada' },
    proyecto: { nombre: s.proyecto, obra: s.obra, obra_nombre: s.obra_nombre,
      obra_contacto: [s.obra_contacto, s.obra_telefono].filter(Boolean).join(' · ') || null, obra_acceso: s.obra_acceso || null },
    tareas, destinos, hoy,
  };
}

// Cuando un taller entrega a otro taller de la OT: su siguiente tarea pasa a «material recibido»
async function marcarRecibido(c, t, destinoId, fecha) {
  await c.query(
    `UPDATE tareas SET ext_recibido = $3
      WHERE id = (SELECT id FROM tareas WHERE orden_id = $1 AND proveedor_id = $2 AND estado <> 'hecha' AND NOT baja_presupuesto
                     AND orden_en_of >= $4 AND id <> $5 ORDER BY orden_en_of, id LIMIT 1)`,
    [t.orden_id, destinoId, fecha, t.orden_en_of, t.id]);
}

// Aplica lo que manda el taller a una de sus tareas → lista de cambios en palabras (para el aviso)
async function aplicar(c, s, t, b, destinos) {
  const cambios = [];
  const set = {};
  let retraso = null; let entrega = null;
  if ('estado' in b) {
    if (!ESTADOS.includes(b.estado)) throw fallo(400, 'Estado no válido');
    if (b.estado !== estadoExt(t) && b.estado !== 'entregado') cambios.push(ESTADO_TXT[b.estado]);   // «entregado a…» ya lo dice
    set.ext_estado = b.estado;
  }
  const est = set.ext_estado || estadoExt(t);
  if ('avance' in b) {
    const a = b.avance === '' || b.avance == null ? null : Math.round(Number(b.avance));
    if (a != null && !(a >= 0 && a <= 100)) throw fallo(400, 'El avance va de 0 a 100');
    const av = ['terminado', 'entregado'].includes(est) ? 100 : a;
    if (av !== t.ext_avance && av != null && est === 'en_curso') cambios.push(`${av} %`);
    set.ext_avance = av;
  }
  if ('fin_prevista' in b) {
    const f = b.fin_prevista ? fechaOk(b.fin_prevista) : null;
    if (b.fin_prevista && !f) throw fallo(400, 'Fecha prevista no válida');
    if (f !== (t.ext_fin_prevista || null)) {
      if (f) cambios.push(`terminará el ${ddmm(f)}${t.ext_fin_prevista ? ` (antes ${ddmm(t.ext_fin_prevista)})` : ''}`);
      const plan = t.plan_hasta;
      if (f && plan && f > plan && (!t.ext_fin_prevista || f > t.ext_fin_prevista)) retraso = { fecha: f, plan };
    }
    set.ext_fin_prevista = f;
  }
  if ('nota' in b) {
    const n = texto(b.nota, 300);
    if (n && n !== t.ext_nota) cambios.push(`«${n}»`);
    set.ext_nota = n;
  }
  if (est === 'entregado') {
    const e = b.entrega || {};
    let a = null; let pid = null;
    if (e.destino === 'nosotros') a = 'nosotros';
    else if (e.destino === 'otro') a = texto(e.texto, 120) || 'otro';
    else if (e.destino != null && e.destino !== '') {
      const d = destinos.find((x) => x.id === Number(e.destino));
      if (!d) throw fallo(400, 'Elija a quién lo ha entregado');
      pid = d.id; a = d.nombre;
    }
    if (!a) throw fallo(400, `${t.codigo} ${t.nombre}: indique a quién lo ha entregado`);
    const f = fechaOk(e.fecha) || hoyMadrid();
    Object.assign(set, { ext_entregado_a: a, ext_entregado_proveedor_id: pid, ext_entrega_fecha: f, ext_entrega_nota: texto(e.nota, 300) });
    if (a !== t.ext_entregado_a || f !== t.ext_entrega_fecha || pid !== t.ext_entregado_proveedor_id) {
      entrega = { a: a === 'nosotros' ? 'nosotros' : a, fecha: f };
      cambios.push(`entregado a ${a === 'nosotros' ? 'nosotros' : a} el ${ddmm(f)}${set.ext_entrega_nota ? ` · ${set.ext_entrega_nota}` : ''}`);
      if (pid) await marcarRecibido(c, t, pid, f);
    }
  }
  // si ya no está entregado (lo corrige), se quita la entrega
  if (est !== 'entregado' && t.ext_entregado_a) Object.assign(set, { ext_entregado_a: null, ext_entregado_proveedor_id: null, ext_entrega_fecha: null, ext_entrega_nota: null });
  // la tarea en el planificador: en curso / hecha (lo que el taller da por terminado; si lo deshace, vuelve)
  let estadoTarea = null;
  if (est === 'en_curso' && t.estado === 'pendiente') estadoTarea = 'en_curso';
  else if (['terminado', 'entregado'].includes(est) && t.estado !== 'hecha') estadoTarea = 'hecha';
  else if (['sin_empezar', 'en_curso'].includes(est) && t.estado === 'hecha' && t.ext_estado && ['terminado', 'entregado'].includes(t.ext_estado)) {
    estadoTarea = est === 'en_curso' ? 'en_curso' : 'pendiente';
  }
  const cols = Object.keys(set);
  if (!cols.length && !estadoTarea) return null;
  await c.query(
    `UPDATE tareas SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')}${cols.length ? ',' : ''} ext_actualizado = now()
       ${estadoTarea ? `, estado = '${estadoTarea}', hecha_en = ${estadoTarea === 'hecha' ? 'now()' : 'NULL'}, hecha_por = NULL` : ''}
      WHERE id = $1`, [t.id, ...cols.map((k) => set[k])]);
  if (cambios.length) {
    await c.query('INSERT INTO ext_novedades (tarea_id, seguimiento_id, texto) VALUES ($1,$2,$3)', [t.id, s.id, cambios.join(' · ')]);
  }
  return cambios.length ? { tarea: t, cambios, retraso, entrega } : null;
}

async function avisarPlanifica(s, res) {
  if (!res.length) return;
  const r = res.find((x) => x.retraso) || res.find((x) => x.entrega) || res[0];
  const t = r.tarea;
  const titulo = r.retraso ? `${s.proveedor} retrasa ${t.codigo} al ${ddmm(r.retraso.fecha)} (plan ${ddmm(r.retraso.plan)})`
    : r.entrega ? `${s.proveedor} ha entregado ${t.codigo} a ${r.entrega.a}`
      : `${s.proveedor} actualiza ${t.codigo}`;
  const cuerpo = res.map((x) => `${x.tarea.codigo} ${x.tarea.nombre}: ${x.cambios.join(' · ')}`).join('\n').slice(0, 300);
  notif.avisarLuego(notif.conPermiso('planificar'), 'ext_seguimiento', { titulo, cuerpo, url: `/proyectos.html?ot=${s.orden_id}`, tag: `ext-${s.id}` });
}

/* ---------- correo ---------- */
async function correoInicio(s, url, para) {
  const aj = await require('./compras').ajustes();
  const ts = (await tareasOT(s.orden_id)).filter((t) => t.proveedor_id === s.proveedor_id);
  const lista = ts.map((t) => `  · ${t.codigo} ${t.nombre}${t.ext_en_obra ? ` (en ${s.obra || 'obra'})` : ''}${t.plan_desde ? ` (previsto ${ddmm(t.plan_desde)} → ${ddmm(t.plan_hasta)})` : ''}`).join('\n');
  const enObra = ts.some((t) => t.ext_en_obra);
  await correo.enviarOFallar({
    para,
    asunto: `Seguimiento · OT ${s.ot_codigo} ${s.ot_titulo} · ${aj.empresa.nombre}`,
    texto: `Hola,\n\nPara la OT ${s.ot_codigo} ${s.ot_titulo}${s.obra ? ` (${s.obra})` : ''} contamos con vosotros para:\n${lista}\n\n`
      + `Os pedimos que nos vayáis contando cómo va en este enlace (no hace falta usuario ni contraseña):\n${url}\n\n`
      + (enObra ? 'Ahí veréis los días que os hemos planificado para confirmarlos (o proponer otros) y, cada día de trabajo, apuntaréis el parte: personas, horas, avance y fotos.\n'
        : 'Ahí podéis marcar cuándo empezáis, el avance, cuándo pensáis terminar, añadir fotos y comentarios y, al terminar, a quién lo entregáis.\n')
      + 'Si pasa la fecha prevista sin noticias, os lo recordaremos por correo una vez al día.\n\n'
      + `Gracias,\n${aj.empresa.nombre}${aj.empresa.telefono ? ` · ${aj.empresa.telefono}` : ''}`,
  });
}

// Recordatorio diario: tareas del taller sin terminar con su fecha (o la nuestra) ya pasada y sin noticias hoy
async function recordatorios() {
  const hoy = hoyMadrid(); const h = horaMadrid();
  if (h < 9 || h >= 19 || [0, 6].includes(new Date(`${hoy}T12:00:00Z`).getUTCDay())) return;
  if (!correo.configurado()) return;
  const { rows: fest } = await query('SELECT 1 FROM festivos WHERE fecha = $1', [hoy]);
  if (fest.length) return;
  const { rows: segs } = await query(
    `SELECT s.*, p.nombre AS proveedor, o.codigo AS ot_codigo, o.titulo AS ot_titulo, pr.obra
       FROM ext_seguimientos s JOIN proveedores p ON p.id = s.proveedor_id JOIN ordenes o ON o.id = s.orden_id
       LEFT JOIN proyectos pr ON pr.id = o.proyecto_id
      WHERE s.activo AND s.email IS NOT NULL AND o.estado <> 'cerrada' AND (s.recordatorio_en IS NULL OR s.recordatorio_en < $1)`, [hoy]);
  const aj = segs.length ? await require('./compras').ajustes() : null;
  for (const s of segs) {
    // (las de una subcontrata en obra tienen sus propios avisos: confirmar días, el día antes)
    const ts = (await tareasOT(s.orden_id)).filter((t) => t.proveedor_id === s.proveedor_id && !t.ext_en_obra
      && !['terminado', 'entregado'].includes(estadoExt(t)) && t.estado !== 'hecha');
    const tarde = ts.filter((t) => {
      const ref = t.ext_fin_prevista || t.plan_hasta;
      const ult = t.ext_actualizado ? new Date(t.ext_actualizado).toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }) : null;
      return ref && ref < hoy && ult !== hoy;
    });
    if (!tarde.length) continue;
    await query('UPDATE ext_seguimientos SET recordatorio_en = $2, n_recordatorios = n_recordatorios + 1 WHERE id = $1', [s.id, hoy]);
    const lineas = tarde.map((t) => `  · ${t.codigo} ${t.nombre}: ${t.ext_fin_prevista ? 'nos indicasteis que terminaba' : 'lo teníamos previsto para'} el ${ddmm(t.ext_fin_prevista || t.plan_hasta)}`
      + (t.ext_actualizado ? ` · última noticia ${ddmm(new Date(t.ext_actualizado).toISOString())}${t.ext_avance != null ? `, ${t.ext_avance} %` : ''}${t.ext_nota ? `, «${t.ext_nota}»` : ''}` : ' · aún sin noticias')).join('\n');
    try {
      await correo.enviarOFallar({
        para: s.email,
        asunto: `¿Cómo va? · OT ${s.ot_codigo} ${s.ot_titulo}`,
        texto: `Hola,\n\nYa ha pasado la fecha prevista de:\n${lineas}\n\n¿Nos contáis cómo va? Basta con poner la fecha nueva o marcarlo terminado:\n${urlDe(s)}\n\n`
          + `Os lo recordaremos una vez al día hasta que lo actualicéis.\n\nGracias,\n${aj.empresa.nombre}${aj.empresa.telefono ? ` · ${aj.empresa.telefono}` : ''}`,
      });
      await query('INSERT INTO ext_novedades (tarea_id, seguimiento_id, texto) SELECT unnest($1::int[]), $2, $3',
        [tarde.map((t) => t.id), s.id, `✉ recordatorio enviado (${s.n_recordatorios + 1}.º)`]);
      if (s.n_recordatorios === 0) {
        notif.avisarLuego(notif.conPermiso('planificar'), 'ext_seguimiento', {
          titulo: `Sin noticias de ${s.proveedor} · OT ${s.ot_codigo}`,
          cuerpo: `Fecha prevista pasada: ${tarde.map((t) => t.codigo).join(', ')}. Se le recuerda por correo cada día.`,
          url: `/proyectos.html?ot=${s.orden_id}`, tag: `ext-${s.id}`,
        });
      }
    } catch (e) { console.warn('recordatorio de seguimiento', s.id, e.message); }
  }
}

// Crea (o reactiva) el seguimiento de un taller en una OT → { id, url }
async function iniciar({ ordenId, proveedorId, email, usuarioId, req }) {
  const { rows } = await query(
    `INSERT INTO ext_seguimientos (orden_id, proveedor_id, nonce, email, iniciado_por) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (orden_id, proveedor_id) DO UPDATE SET activo = true, email = COALESCE(EXCLUDED.email, ext_seguimientos.email)
     RETURNING *`, [ordenId, proveedorId, crypto.randomBytes(18).toString('base64url'), texto(email, 200), usuarioId]);
  return { ...rows[0], url: urlDe(rows[0], req) };
}
async function urlActiva(ordenId, proveedorId, req) {
  const { rows } = await query('SELECT * FROM ext_seguimientos WHERE orden_id = $1 AND proveedor_id = $2 AND activo', [ordenId, proveedorId]);
  return rows.length ? urlDe(rows[0], req) : null;
}

/* ---------- para la OT (oficina) ---------- */
async function paraOT(ordenId) {
  const [{ rows: segs }, { rows: nov }] = await Promise.all([
    query(`SELECT s.id, s.proveedor_id, s.email, s.activo, s.iniciado_en, s.enviado_en, s.visto_en, s.actualizado_en,
                  s.recordatorio_en::text AS recordatorio_en, s.n_recordatorios, p.email AS email_proveedor
             FROM ext_seguimientos s JOIN proveedores p ON p.id = s.proveedor_id WHERE s.orden_id = $1`, [ordenId]),
    query(`SELECT n.tarea_id, n.texto, n.creado FROM ext_novedades n JOIN tareas t ON t.id = n.tarea_id
            WHERE t.orden_id = $1 ORDER BY n.creado DESC LIMIT 60`, [ordenId]),
  ]);
  const ts = await tareasOT(ordenId);
  const arch = await archivosDe(ts.map((t) => t.id));
  const porTarea = {};
  for (const t of ts) {
    porTarea[t.id] = {
      estado: estadoExt(t), fin_prevista: t.ext_fin_prevista, recibido: t.ext_recibido, actualizado: t.ext_actualizado,
      entrega: t.ext_entregado_a ? { a: t.ext_entregado_a, fecha: t.ext_entrega_fecha, nota: t.ext_entrega_nota } : null,
      plan_hasta: t.plan_hasta,
      pedido: t.pedido_id ? { id: t.pedido_id, codigo: t.pedido_codigo, estado: t.pedido_estado, proveedor: t.pedido_proveedor } : null,
      solicitud: t.solicitud_id ? { id: t.solicitud_id, codigo: t.solicitud_codigo, estado: t.solicitud_estado } : null,
      archivos: arch.filter((a) => a.tarea_id === t.id).map((a) => ({ id: a.id, tipo: a.tipo, nombre: a.nombre, albaran: a.ref_tipo === 'ext_albaran' })),
      novedades: nov.filter((n) => n.tarea_id === t.id).slice(0, 5),
      obra: t.ext_en_obra ? await obra.paraEnlace(t) : null,
    };
  }
  return { seguimientos: segs, ext: porTarea };
}

function montarPublico(app, asyncH) {
  app.get('/api/seguimiento/:t', asyncH(async (req, res) => {
    const s = await porToken(req.params.t);
    await query('UPDATE ext_seguimientos SET visto_en = now() WHERE id = $1', [s.id]);
    res.set('Cache-Control', 'no-store').json(await vista(s));
  }));

  // { tareas: { [id]: { estado, avance, fin_prevista, nota, entrega: { destino: id|'nosotros'|'otro', texto, fecha, nota } } } }
  app.put('/api/seguimiento/:t', asyncH(async (req, res) => {
    const b = req.body || {};
    let s; const hechos = [];
    await tx(async (c) => {
      s = await porToken(req.params.t, c);
      if (s.ot_estado === 'cerrada') throw fallo(409, 'Esta orden ya está cerrada; si quiere cambiar algo, contacte con nosotros.');
      const ts = await tareasOT(s.orden_id, c);
      const destinos = [...new Map(ts.filter((t) => t.proveedor_id !== s.proveedor_id).map((t) => [t.proveedor_id, { id: t.proveedor_id, nombre: t.proveedor }])).values()];
      for (const [id, datos] of Object.entries(b.tareas || {})) {
        const t = ts.find((x) => x.id === Number(id) && x.proveedor_id === s.proveedor_id);
        if (!t || !datos || typeof datos !== 'object') continue;
        const r = await aplicar(c, s, { ...t, orden_id: s.orden_id }, datos, destinos);
        if (r) hechos.push(r);
      }
      await c.query('UPDATE ext_seguimientos SET actualizado_en = now() WHERE id = $1', [s.id]);
    });
    avisarPlanifica(s, hechos).catch(() => {});
    require('./eventos').emitir({ ruta: 'tareas', quien: s.proveedor });
    res.json(await vista(await porToken(req.params.t)));
  }));

  // Fotos (o PDF) de una tarea suya; ?albaran=1 para el albarán de entrega. Cuerpo = el archivo.
  app.post('/api/seguimiento/:t/tareas/:tid/archivos', express.raw({ type: TIPOS_FOTO, limit: MAX_FOTO }), asyncH(async (req, res) => {
    const s = await porToken(req.params.t);
    const tid = Number(req.params.tid);
    const { rows: t } = await query('SELECT id, codigo FROM tareas WHERE id = $1 AND orden_id = $2 AND proveedor_id = $3', [tid, s.orden_id, s.proveedor_id]);
    if (!t.length) throw fallo(404, 'Tarea no encontrada');
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!TIPOS_FOTO.includes(tipo)) throw fallo(415, 'Solo fotos o PDF');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fallo(400, 'Archivo vacío');
    const ref = req.query.albaran ? 'ext_albaran' : 'ext_foto';
    const { rows: n } = await query(`SELECT count(*)::int AS n FROM archivos WHERE ref_tipo IN ('ext_foto','ext_albaran') AND ref_id = $1`, [tid]);
    if (n[0].n >= MAX_N_FOTOS) throw fallo(400, `Como máximo ${MAX_N_FOTOS} archivos por tarea`);
    const nombre = req.headers['x-nombre'] ? decodeURIComponent(String(req.headers['x-nombre'])).slice(0, 120) : null;
    await query(`INSERT INTO archivos (tipo, bytes, nombre, datos, ref_tipo, ref_id, creado_por) VALUES ($1,$2,$3,$4,$5,$6,NULL)`,
      [tipo, req.body.length, nombre, req.body, ref, tid]);
    await query('INSERT INTO ext_novedades (tarea_id, seguimiento_id, texto) VALUES ($1,$2,$3)', [tid, s.id, ref === 'ext_albaran' ? '📎 albarán' : '📷 foto']);
    await query('UPDATE ext_seguimientos SET actualizado_en = now() WHERE id = $1', [s.id]);
    await query('UPDATE tareas SET ext_actualizado = now() WHERE id = $1', [tid]);
    res.status(201).json(await vista(s));
  }));

  app.delete('/api/seguimiento/:t/archivos/:id', asyncH(async (req, res) => {
    const s = await porToken(req.params.t);
    await query(`DELETE FROM archivos a USING tareas t WHERE a.id = $1 AND a.ref_tipo IN ('ext_foto','ext_albaran') AND a.creado_por IS NULL
                    AND t.id = a.ref_id AND t.orden_id = $2 AND t.proveedor_id = $3`, [Number(req.params.id), s.orden_id, s.proveedor_id]);
    res.json(await vista(s));
  }));

  app.get('/api/seguimiento/:t/archivos/:id', asyncH(async (req, res) => {
    const s = await porToken(req.params.t);
    const { rows } = await query(
      `SELECT a.tipo, a.nombre, a.datos FROM archivos a JOIN tareas t ON t.id = a.ref_id
        WHERE a.id = $1 AND a.ref_tipo IN ('ext_foto','ext_albaran') AND t.orden_id = $2 AND t.proveedor_id = $3`, [Number(req.params.id), s.orden_id, s.proveedor_id]);
    if (!rows.length) throw fallo(404, 'Archivo no encontrado');
    res.set({ 'Content-Type': rows[0].tipo, 'Content-Disposition': `inline; filename="${encodeURIComponent(rows[0].nombre || 'foto')}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(rows[0].datos);
  }));

  obra.montarPublico(app, asyncH, porToken, vista);

  // recordatorios: cada 10 minutos se mira si toca (uno al día por taller y OT; subcontratas en obra: confirmar días y el día antes)
  const vuelta = () => {
    recordatorios().catch((e) => console.warn('recordatorios seguimiento', e.message));
    obra.avisos(urlDe).catch((e) => console.warn('avisos subcontratas en obra', e.message));
  };
  setTimeout(() => { vuelta(); setInterval(vuelta, 10 * 60 * 1000); }, 30 * 1000);
}

function montarGestion(app, asyncH) {
  const p = auth.permiso('planificar', 'proyectos');
  obra.montarGestion(app, asyncH);

  // Comenzar seguimiento con un taller de la OT: crea (o reactiva) su enlace; si se pide, se lo manda por correo
  app.post('/api/ordenes/:id/seguimientos', p, asyncH(async (req, res) => {
    const ordenId = Number(req.params.id); const b = req.body || {};
    const pid = Number(b.proveedor_id);
    const { rows: t } = await query('SELECT 1 FROM tareas WHERE orden_id = $1 AND proveedor_id = $2 LIMIT 1', [ordenId, pid]);
    if (!t.length) throw fallo(400, 'Ese taller no tiene tareas en esta OT');
    const email = texto(b.email, 200);
    if (b.enviar && !(email && /.+@.+\..+/.test(email))) throw fallo(400, 'Falta el correo del taller');
    const s = await iniciar({ ordenId, proveedorId: pid, email, usuarioId: req.usuario.id, req });
    const url = s.url;
    if (b.enviar) {
      const { rows: d } = await query(
        `SELECT s.*, o.codigo AS ot_codigo, o.titulo AS ot_titulo, pr.obra FROM ext_seguimientos s JOIN ordenes o ON o.id = s.orden_id
           LEFT JOIN proyectos pr ON pr.id = o.proyecto_id WHERE s.id = $1`, [s.id]);
      await correoInicio(d[0], url, email);
      await query('UPDATE ext_seguimientos SET enviado_en = now() WHERE id = $1', [s.id]);
    }
    // si el proveedor no tenía correo, se le guarda
    if (email) await query(`UPDATE proveedores SET email = $2 WHERE id = $1 AND (email IS NULL OR email = '')`, [pid, email]);
    res.json({ url, enviado: !!b.enviar });
  }));

  app.post('/api/seguimientos/:id/enlace', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const { rows } = await query(
      `UPDATE ext_seguimientos SET nonce = ${req.body?.nuevo ? '$2' : 'nonce'}, activo = true WHERE id = $1 RETURNING *`,
      [id, ...(req.body?.nuevo ? [crypto.randomBytes(18).toString('base64url')] : [])]);
    if (!rows.length) throw fallo(404, 'Seguimiento no encontrado');
    res.json({ url: urlDe(rows[0], req) });
  }));

  // Parar (o retomar) el seguimiento: sin enlace activo ni recordatorios
  app.patch('/api/seguimientos/:id', p, asyncH(async (req, res) => {
    const { rows } = await query('UPDATE ext_seguimientos SET activo = $2 WHERE id = $1 RETURNING id, activo', [Number(req.params.id), !!req.body?.activo]);
    if (!rows.length) throw fallo(404, 'Seguimiento no encontrado');
    res.json(rows[0]);
  }));

  // Fotos y albaranes que ha subido el taller (para verlos desde la OT o el cuadrante)
  app.get('/api/ext-archivos/:id', asyncH(async (req, res) => {
    const { rows } = await query(`SELECT tipo, nombre, datos FROM archivos WHERE id = $1 AND ref_tipo IN ('ext_foto','ext_albaran')`, [Number(req.params.id)]);
    if (!rows.length) throw fallo(404, 'Archivo no encontrado');
    res.set({ 'Content-Type': rows[0].tipo, 'Content-Disposition': `inline; filename="${encodeURIComponent(rows[0].nombre || 'foto')}"`, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
    res.send(rows[0].datos);
  }));
}

module.exports = { montarPublico, montarGestion, paraOT, estadoExt, recordatorios, iniciar, urlActiva, avisosObra: (forzar) => obra.avisos(urlDe, forzar) };
