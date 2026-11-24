// Subcontratas en obra: una tarea que hace un proveedor aquí (en la obra o en nuestras áreas), no en su taller.
//  · Se elige en la OT («Área / taller» › Subcontrata en obra): la tarea conserva su área y se planifica en el tablero
//    como las demás, pero no ocupa operarios propios (la gente la pone la subcontrata).
//  · Presupuesto y pedido: los de la subcontratación (subcontratacion.js), con días de trabajo, personas y cuándo puede
//    empezar en su respuesta. Al enviar el pedido, su enlace de seguimiento (seguimiento-ext.js) va con él.
//  · Confirmar días: en su enlace ve los días planificados y los confirma, propone otros o dice que no puede. Se guarda
//    la «firma» del plan que confirmó: si después se mueve un tramo, vuelve a «sin confirmar» y se le avisa otra vez.
//    En el tablero, aviso leve mientras no confirme. El día antes, recordatorio.
//  · Parte: cada día que trabaja, personas, horas, avance, comentario, fotos y «terminado». Lo valida quien planifica
//    (✔, o ✕ con una incidencia de calidad contra la subcontrata). Un parte «terminado» validado cierra la tarea.
const { query, tx } = require('./db');
const auth = require('./auth');
const correo = require('./correo');
const notif = require('./notificaciones');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 300) => (v == null ? null : String(v).trim().slice(0, max) || null);
const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v).slice(0, 10)) ? String(v).slice(0, 10) : null);
const hoyMadrid = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });
const horaMadrid = () => Number(new Date().toLocaleString('en-GB', { timeZone: 'Europe/Madrid', hour: '2-digit', hour12: false }));
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');
const hhmm = (h) => { const n = Number(h); return `${String(Math.floor(n)).padStart(2, '0')}:${String(Math.round((n % 1) * 60)).padStart(2, '0')}`; };
const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const diaTxt = (f) => `${DIAS[new Date(`${f}T12:00:00Z`).getUTCDay()]} ${ddmm(f)}`;
const leerHora = (v) => {
  if (v == null || v === '') return null;
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(v).trim());
  if (!m) return NaN;
  const h = Number(m[1]) + Number(m[2] || 0) / 60;
  return h >= 0 && h <= 24 ? Math.round(h * 4) / 4 : NaN;
};

// Firma del plan de una tarea (sus tramos): si cambia, lo confirmado deja de valer
const SQL_FIRMA = (a = 't') => `(SELECT md5(string_agg(x.fecha::text || ' ' || x.hora_inicio::text || ' ' || x.duracion_h::text, ','
  ORDER BY x.fecha, x.hora_inicio)) FROM tramos x WHERE x.tarea_id = ${a}.id)`;
// Estado de la confirmación tal como vale ahora: sin_plan · pendiente · confirmada · propuesta · rechazada
const SQL_CONF = (a = 't') => `CASE WHEN NOT ${a}.ext_en_obra OR ${a}.proveedor_id IS NULL THEN NULL
  WHEN NOT EXISTS (SELECT 1 FROM tramos x WHERE x.tarea_id = ${a}.id) THEN 'sin_plan'
  WHEN ${a}.ext_conf IS NOT NULL AND ${a}.ext_conf_firma = ${SQL_FIRMA(a)} THEN ${a}.ext_conf ELSE 'pendiente' END`;
const CONF_TXT = { sin_plan: 'sin días planificados', pendiente: 'días sin confirmar', confirmada: 'días confirmados', propuesta: 'propone otros días', rechazada: 'no puede esos días' };

async function dias(tareaId, c = { query }) {
  const { rows } = await c.query(
    `SELECT x.fecha::text AS fecha, x.hora_inicio::float AS desde, (x.hora_inicio + x.duracion_h)::float AS hasta, l.nombre AS area
       FROM tramos x LEFT JOIN lineas l ON l.id = x.linea_id WHERE x.tarea_id = $1 ORDER BY x.fecha, x.hora_inicio`, [tareaId]);
  return rows.map((r) => ({ ...r, desde_txt: hhmm(r.desde), hasta_txt: hhmm(r.hasta) }));
}
async function partes(tareaIds, c = { query }) {
  if (!tareaIds.length) return [];
  const { rows } = await c.query(
    `SELECT p.id, p.tarea_id, p.fecha::text AS fecha, p.personas, p.desde::float AS desde, p.hasta::float AS hasta, p.avance, p.nota, p.terminado,
            p.estado, p.validado_en, p.nota_val, p.incidencia_id, u.nombre AS validado_por, gi.codigo AS incidencia
       FROM ext_partes p LEFT JOIN usuarios u ON u.id = p.validado_por LEFT JOIN gestion_incidencias gi ON gi.id = p.incidencia_id
      WHERE p.tarea_id = ANY($1) ORDER BY p.fecha DESC`, [tareaIds]);
  return rows;
}

// Lo que añade la vista del enlace a una tarea en obra de la subcontrata
async function paraEnlace(t) {
  const { rows } = await query(
    `SELECT t.operarios_req, t.ext_conf, t.ext_conf_en, t.ext_conf_por, t.ext_conf_propuesta, t.ext_conf_motivo,
            ${SQL_CONF('t')} AS conf, (t.ext_conf = 'confirmada' AND t.ext_conf_firma IS DISTINCT FROM ${SQL_FIRMA('t')}) AS cambiado
       FROM tareas t WHERE t.id = $1`, [t.id]);
  const r = rows[0] || {};
  return {
    en_obra: true, dias: await dias(t.id), personas: r.operarios_req || null,
    conf: r.conf, cambiado: !!r.cambiado, conf_en: r.ext_conf_en, conf_por: r.ext_conf_por, propuesta: r.ext_conf_propuesta, motivo: r.ext_conf_motivo,
    partes: (await partes([t.id])).map((p) => ({ ...p, desde: p.desde != null ? hhmm(p.desde) : null, hasta: p.hasta != null ? hhmm(p.hasta) : null })),
  };
}

function avisar(s, t, titulo, cuerpo) {
  notif.avisarLuego(notif.conPermiso('planificar'), 'ext_seguimiento', { titulo, cuerpo, url: `/proyectos.html?ot=${s.orden_id}`, tag: `subc-${t.id}` });
  require('./eventos').emitir({ ruta: 'tareas', quien: s.proveedor });
}
const novedad = (c, t, s, txt) => c.query('INSERT INTO ext_novedades (tarea_id, seguimiento_id, texto) VALUES ($1,$2,$3)', [t.id, s?.id || null, txt]);

/* ---------- enlace de la subcontrata (sin sesión) ---------- */
function montarPublico(app, asyncH, porToken, vista) {
  async function suTarea(req, c = { query }) {
    const s = await porToken(req.params.t, c);
    const { rows } = await c.query(`SELECT t.*, ${SQL_FIRMA('t')} AS firma FROM tareas t
       WHERE t.id = $1 AND t.orden_id = $2 AND t.proveedor_id = $3 AND t.ext_en_obra FOR UPDATE`, [Number(req.params.tid), s.orden_id, s.proveedor_id]);
    if (!rows.length) throw fallo(404, 'Trabajo no encontrado');
    if (s.ot_estado === 'cerrada') throw fallo(409, 'Esta orden ya está cerrada.');
    return { s, t: rows[0] };
  }

  // { accion: 'confirmar' | 'proponer' | 'rechazar', nombre, desde, nota, motivo }
  app.post('/api/seguimiento/:t/tareas/:tid/confirmar', asyncH(async (req, res) => {
    const b = req.body || {};
    let s; let t; let msg;
    await tx(async (c) => {
      ({ s, t } = await suTarea(req, c));
      if (!t.firma) throw fallo(400, 'Aún no hay días planificados para este trabajo.');
      const nombre = texto(b.nombre, 120);
      const por = nombre ? `${nombre} (${s.proveedor})` : s.proveedor;
      if (b.accion === 'confirmar') {
        await c.query(`UPDATE tareas SET ext_conf = 'confirmada', ext_conf_firma = $2, ext_conf_en = now(), ext_conf_por = $3, ext_conf_propuesta = NULL, ext_conf_motivo = NULL,
                         ext_conf_aviso_firma = $2 WHERE id = $1`, [t.id, t.firma, por]);
        msg = '✔ confirma los días';
      } else if (b.accion === 'proponer') {
        const desde = fechaOk(b.desde); const nota = texto(b.nota, 300);
        if (!desde && !nota) throw fallo(400, 'Díganos desde qué día pueden (o un comentario).');
        await c.query(`UPDATE tareas SET ext_conf = 'propuesta', ext_conf_firma = $2, ext_conf_en = now(), ext_conf_por = $3, ext_conf_propuesta = $4, ext_conf_motivo = NULL,
                         ext_conf_aviso_firma = $2 WHERE id = $1`, [t.id, t.firma, por, JSON.stringify({ desde, nota })]);
        msg = `📅 propone ${desde ? `empezar el ${ddmm(desde)}` : 'otros días'}${nota ? ` · «${nota}»` : ''}`;
      } else if (b.accion === 'rechazar') {
        const motivo = texto(b.motivo, 300);
        if (!motivo) throw fallo(400, 'Díganos por qué no pueden.');
        await c.query(`UPDATE tareas SET ext_conf = 'rechazada', ext_conf_firma = $2, ext_conf_en = now(), ext_conf_por = $3, ext_conf_propuesta = NULL, ext_conf_motivo = $4,
                         ext_conf_aviso_firma = $2 WHERE id = $1`, [t.id, t.firma, por, motivo]);
        msg = `✕ no puede esos días: «${motivo}»`;
      } else throw fallo(400, 'Acción no válida');
      await novedad(c, t, s, msg);
    });
    avisar(s, t, `${s.proveedor} ${msg.replace(/^[✔📅✕] /u, '')} · ${t.codigo}`, `${t.codigo} ${t.nombre}`);
    res.json(await vista(await porToken(req.params.t)));
  }));

  // Parte del día: { fecha, personas, desde, hasta, avance, nota, terminado }
  app.put('/api/seguimiento/:t/tareas/:tid/parte', asyncH(async (req, res) => {
    const b = req.body || {};
    let s; let t; let txt;
    await tx(async (c) => {
      ({ s, t } = await suTarea(req, c));
      const fecha = fechaOk(b.fecha) || hoyMadrid();
      if (fecha > hoyMadrid()) throw fallo(400, 'El parte es de un día ya trabajado.');
      const personas = b.personas === '' || b.personas == null ? null : Math.round(Number(b.personas));
      if (personas != null && !(personas >= 0 && personas <= 99)) throw fallo(400, 'Personas no válidas');
      const desde = leerHora(b.desde); const hasta = leerHora(b.hasta);
      if (Number.isNaN(desde) || Number.isNaN(hasta)) throw fallo(400, 'Hora no válida (p. ej. 08:00)');
      if (desde != null && hasta != null && hasta <= desde) throw fallo(400, 'La hora de fin va después de la de inicio');
      const avance = b.avance === '' || b.avance == null ? null : Math.round(Number(b.avance));
      if (avance != null && !(avance >= 0 && avance <= 100)) throw fallo(400, 'El avance va de 0 a 100');
      const terminado = !!b.terminado;
      const { rows: prev } = await c.query('SELECT estado FROM ext_partes WHERE tarea_id = $1 AND fecha = $2', [t.id, fecha]);
      if (prev[0]?.estado === 'validado') throw fallo(409, 'Ese parte ya lo hemos validado; si hay que cambiar algo, contacte con nosotros.');
      await c.query(
        `INSERT INTO ext_partes (tarea_id, seguimiento_id, fecha, personas, desde, hasta, avance, nota, terminado)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (tarea_id, fecha) DO UPDATE SET personas = $4, desde = $5, hasta = $6, avance = $7, nota = $8, terminado = $9,
           estado = 'pendiente', actualizado = now()`,
        [t.id, s.id, fecha, personas, desde, hasta, terminado ? 100 : avance, texto(b.nota, 600), terminado]);
      // lo que se ve de la tarea: en curso, su avance y su comentario (terminada, cuando validemos el parte)
      await c.query(`UPDATE tareas SET ext_estado = CASE WHEN ext_estado IN ('terminado','entregado') THEN ext_estado ELSE 'en_curso' END,
                       ext_avance = COALESCE($2, ext_avance), ext_nota = COALESCE($3, ext_nota), ext_actualizado = now(),
                       estado = CASE WHEN estado = 'pendiente' THEN 'en_curso' ELSE estado END WHERE id = $1`,
      [t.id, terminado ? 100 : avance, texto(b.nota, 300)]);
      txt = `🧾 parte del ${ddmm(fecha)}${personas != null ? ` · ${personas} pers.` : ''}${desde != null && hasta != null ? ` · ${hhmm(desde)}–${hhmm(hasta)}` : ''}`
        + `${terminado ? ' · ✔ dice que ha terminado' : avance != null ? ` · ${avance} %` : ''}${b.nota ? ` · «${texto(b.nota, 120)}»` : ''}`;
      await novedad(c, t, s, txt);
    });
    avisar(s, t, `${s.proveedor}: ${b.terminado ? 'trabajo terminado, valida el parte' : 'parte del día'} · ${t.codigo}`, txt);
    res.json(await vista(await porToken(req.params.t)));
  }));
}

/* ---------- oficina ---------- */
function montarGestion(app, asyncH) {
  const p = auth.permiso('planificar', 'proyectos');

  // Confirmada por teléfono / WhatsApp
  app.post('/api/tareas/:id/subcontrata/confirmar', p, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx(async (c) => {
      const { rows } = await c.query(`SELECT t.*, ${SQL_FIRMA('t')} AS firma FROM tareas t WHERE t.id = $1 AND t.ext_en_obra AND t.proveedor_id IS NOT NULL FOR UPDATE`, [id]);
      if (!rows.length) throw fallo(404, 'No es una tarea de subcontrata en obra');
      if (!rows[0].firma) throw fallo(400, 'Planifica antes sus días en el tablero');
      await c.query(`UPDATE tareas SET ext_conf = 'confirmada', ext_conf_firma = $2, ext_conf_en = now(), ext_conf_por = $3, ext_conf_propuesta = NULL,
                       ext_conf_motivo = NULL, ext_conf_aviso_firma = $2 WHERE id = $1`, [id, rows[0].firma, `por teléfono (${req.usuario.nombre})`]);
      await novedad(c, rows[0], null, `✔ días confirmados por teléfono (anotado por ${req.usuario.nombre})`);
    });
    require('./eventos').emitir({ ruta: 'tareas', quien: req.usuario.nombre });
    res.json({ ok: true });
  }));

  // Validar el parte: { ok: true, nota } o { ok: false, nota, gravedad } (abre incidencia de calidad contra la subcontrata)
  app.post('/api/ext-partes/:id/validar', p, asyncH(async (req, res) => {
    const id = Number(req.params.id); const b = req.body || {};
    let inc = null;
    await tx(async (c) => {
      const { rows } = await c.query(
        `SELECT p.*, p.fecha::text AS fecha_t, t.codigo, t.nombre, t.orden_id, t.proveedor_id, t.estado AS tarea_estado, pv.nombre AS proveedor
           FROM ext_partes p JOIN tareas t ON t.id = p.tarea_id JOIN proveedores pv ON pv.id = t.proveedor_id WHERE p.id = $1 FOR UPDATE`, [id]);
      const pa = rows[0];
      if (!pa) throw fallo(404, 'Parte no encontrado');
      const nota = texto(b.nota, 600);
      if (b.ok) {
        await c.query(`UPDATE ext_partes SET estado = 'validado', validado_por = $2, validado_en = now(), nota_val = $3 WHERE id = $1`, [id, req.usuario.id, nota]);
        if (pa.terminado) {
          await c.query(`UPDATE tareas SET ext_estado = 'terminado', ext_avance = 100, ext_actualizado = now(),
                           estado = 'hecha', hecha_en = COALESCE(hecha_en, now()), hecha_por = $2 WHERE id = $1`, [pa.tarea_id, req.usuario.id]);
        }
        await novedad(c, { id: pa.tarea_id }, null, `✔ parte del ${ddmm(pa.fecha_t)} validado por ${req.usuario.nombre}${pa.terminado ? ' · tarea terminada' : ''}`);
      } else {
        if (!nota) throw fallo(400, 'Escribe qué está mal: va a la incidencia');
        const incid = require('./incidencias');
        inc = await incid.crear(c, {
          tipo: 'calidad', gravedad: ['leve', 'importante', 'critica'].includes(b.gravedad) ? b.gravedad : 'importante',
          titulo: `${pa.codigo} ${pa.nombre} (${pa.proveedor})`, resumen: nota.slice(0, 120), texto: `Parte del ${ddmm(pa.fecha_t)} no validado: ${nota}`,
          tarea_id: pa.tarea_id, orden_id: pa.orden_id, proveedor_id: pa.proveedor_id,
        }, req.usuario);
        await c.query(`UPDATE ext_partes SET estado = 'rechazado', validado_por = $2, validado_en = now(), nota_val = $3, incidencia_id = $4 WHERE id = $1`,
          [id, req.usuario.id, nota, inc?.id || null]);
        // si decía «terminado», la tarea sigue abierta
        if (pa.terminado) await c.query(`UPDATE tareas SET ext_estado = 'en_curso' WHERE id = $1 AND ext_estado = 'terminado'`, [pa.tarea_id]);
        await novedad(c, { id: pa.tarea_id }, null, `✕ parte no validado por ${req.usuario.nombre}${inc?.codigo ? ` · incidencia ${inc.codigo}` : ''}: «${nota.slice(0, 120)}»`);
      }
    });
    require('./eventos').emitir({ ruta: 'tareas', quien: req.usuario.nombre });
    res.json({ ok: true, incidencia: inc ? { id: inc.id, codigo: inc.codigo } : null });
  }));
}

/* ---------- avisos por correo (cada 10 min, de 8 a 20 h) ---------- */
// 1) Pedir que confirme los días cuando hay plan nuevo o cambiado (tras 10–20 min sin cambios, por si se está planificando)
// 2) El día antes de trabajar (desde las 12 h), recordatorio con el horario y la obra
async function avisos(urlDe, forzar = false) {
  const h = forzar ? 12 : horaMadrid();
  if (h < 8 || h >= 20 || !correo.configurado()) return;
  const hoy = hoyMadrid();
  const manana = new Date(Date.parse(`${hoy}T12:00:00Z`) + 864e5).toISOString().slice(0, 10);
  const { rows } = await query(
    `SELECT t.id, t.codigo, t.nombre, t.orden_id, t.operarios_req, t.ext_conf, t.ext_conf_aviso_firma, t.ext_recordado_dia::text AS recordado,
            ${SQL_FIRMA('t')} AS firma, ${SQL_CONF('t')} AS conf,
            s.id AS seg_id, s.email, s.nonce, p.nombre AS proveedor, o.codigo AS ot_codigo, o.titulo AS ot_titulo, pr.obra, pr.nombre AS proyecto,
            EXISTS (SELECT 1 FROM tramos x WHERE x.tarea_id = t.id AND x.fecha >= $1) AS futuro,
            EXISTS (SELECT 1 FROM tramos x WHERE x.tarea_id = t.id AND x.fecha = $2) AS manana
       FROM tareas t JOIN ext_seguimientos s ON s.orden_id = t.orden_id AND s.proveedor_id = t.proveedor_id AND s.activo AND s.email IS NOT NULL
       JOIN proveedores p ON p.id = t.proveedor_id JOIN ordenes o ON o.id = t.orden_id LEFT JOIN proyectos pr ON pr.id = o.proyecto_id
      WHERE t.ext_en_obra AND t.estado <> 'hecha' AND NOT t.baja_presupuesto AND o.estado <> 'cerrada'`, [hoy, manana]);
  if (!rows.length) return;
  const aj = await require('./compras').ajustes();
  const firmaEmp = `Gracias,\n${aj.empresa.nombre}${aj.empresa.telefono ? ` · ${aj.empresa.telefono}` : ''}`;
  for (const t of rows) {
    const url = urlDe({ id: t.seg_id, nonce: t.nonce });
    const lista = async () => (await dias(t.id)).filter((d) => d.fecha >= hoy)
      .map((d) => `  · ${diaTxt(d.fecha)}: ${d.desde_txt}–${d.hasta_txt}${t.operarios_req ? ` · ${t.operarios_req} pers.` : ''}`).join('\n');
    try {
      // 1) confirmar días
      if (t.futuro && t.firma && t.conf === 'pendiente' && t.ext_conf_aviso_firma !== t.firma) {
        if (t.ext_conf_aviso_firma !== `visto:${t.firma}`) { // primera vez que se ve este plan: esperar a la siguiente vuelta
          await query('UPDATE tareas SET ext_conf_aviso_firma = $2 WHERE id = $1', [t.id, `visto:${t.firma}`]);
        } else {
          const cambio = !!t.ext_conf;
          await correo.enviarOFallar({
            para: t.email,
            asunto: `${cambio ? 'Cambio de días' : 'Confirmad los días'} · ${t.codigo} ${t.nombre} · ${aj.empresa.nombre}`,
            texto: `Hola,\n\n${cambio ? 'Hemos cambiado los días' : 'Os hemos planificado'} para ${t.codigo} ${t.nombre}${t.obra ? ` (obra: ${t.obra})` : ''}:\n${await lista()}\n\n`
              + `Por favor, confirmadlos (o proponednos otros) en vuestro enlace, sin usuario:\n${url}\n\n${firmaEmp}`,
          });
          await query('UPDATE tareas SET ext_conf_aviso_firma = $2 WHERE id = $1', [t.id, t.firma]);
          await query('INSERT INTO ext_novedades (tarea_id, seguimiento_id, texto) VALUES ($1,$2,$3)', [t.id, t.seg_id, `✉ ${cambio ? 'cambio de días enviado' : 'días enviados para confirmar'}`]);
        }
      }
      // 2) recordatorio el día antes
      if (t.manana && h >= 12 && t.recordado !== manana && ['confirmada', 'pendiente'].includes(t.conf)) {
        const d = (await dias(t.id)).find((x) => x.fecha === manana);
        await correo.enviarOFallar({
          para: t.email,
          asunto: `Mañana · ${t.codigo} ${t.nombre}${t.obra ? ` · ${t.obra}` : ''}`,
          texto: `Hola,\n\nOs recordamos que mañana, ${diaTxt(manana)}, contamos con vosotros de ${d.desde_txt} a ${d.hasta_txt}${t.operarios_req ? ` (${t.operarios_req} personas)` : ''}`
            + ` para ${t.codigo} ${t.nombre}${t.obra ? `, en ${t.obra}` : ''}.\n\n${t.conf !== 'confirmada' ? 'Aún no nos habéis confirmado los días: ' : ''}`
            + `Al terminar cada día, apuntad el parte (personas, horas, avance y fotos) en vuestro enlace:\n${url}\n\n${firmaEmp}`,
        });
        await query('UPDATE tareas SET ext_recordado_dia = $2 WHERE id = $1', [t.id, manana]);
        await query('INSERT INTO ext_novedades (tarea_id, seguimiento_id, texto) VALUES ($1,$2,$3)', [t.id, t.seg_id, '✉ recordatorio del día siguiente']);
      }
    } catch (e) { console.warn('avisos subcontrata en obra', t.codigo, e.message); }
  }
}

module.exports = { SQL_FIRMA, SQL_CONF, CONF_TXT, dias, partes, paraEnlace, montarPublico, montarGestion, avisos };
