// Fabricación externa: lo que fabrica un taller de fuera con nuestros planos (p. ej. Ferros Puig en Barcelona),
// pasa por otros (galvanizadora, pintura…), viaja con el transportista y llega a Menorca para montarlo.
//  · Un pedido (FE-AAAA-NNNN) tiene un RECORRIDO de etapas (copiado de una plantilla configurable) y una o
//    varias PARTES que avanzan por su cuenta («por partes o total»). Cada parte puede ir unida a su tarea de
//    montaje: el tablero avisa si el montaje está antes de que llegue.
//  · Cada etapa dice QUIÉN la actualiza: el taller del pedido, otro proveedor (la galvanizadora) o nosotros.
//    Cada proveedor tiene su enlace (sin cuenta) y solo puede tocar sus etapas. «Recibido» lo marcamos nosotros.
//  · Etapa de transporte: la empieza quien entrega («Entregado a Ydica») y termina al recibirlo aquí.
//  · Fechas: cada etapa tiene unos días típicos; con lo real (inicio/fin de cada etapa) y la fecha prevista que
//    pone quien la hace, se calcula cuándo llega cada parte.
const crypto = require('crypto');
const express = require('express');
const { query, tx } = require('./db');
const auth = require('./auth');
const archivos = require('./archivos');
const notif = require('./notificaciones');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max = 200) => (v == null ? null : String(v).trim().slice(0, max) || null);
const fechaOk = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
const hoy = () => new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 10);
const sumar = (f, n) => { const d = new Date(`${f}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + Math.round(n)); return d.toISOString().slice(0, 10); };
const max = (a, b) => (!a ? b : !b ? a : a > b ? a : b);
const ddmm = (f) => (f ? `${f.slice(8, 10)}/${f.slice(5, 7)}` : '');

const TIPOS_ETAPA = {
  fabricacion: 'Fabricación', galvanizado: 'Galvanizado', pintura: 'Pintura', lacado: 'Lacado', transporte: 'Transporte', otro: 'Otro',
};
const QUIEN = ['taller', 'proveedor', 'nosotros'];

// Plantillas de recorrido por defecto (se cambian en Compras › Fabricación externa › Recorridos)
function plantillasBase(tenasId) {
  const fab = { nombre: 'Fabricación', tipo: 'fabricacion', quien: 'taller', dias: 10 };
  const galv = { nombre: 'Galvanizado', tipo: 'galvanizado', quien: 'proveedor', proveedor_id: tenasId || null, dias: 5 };
  const pint = { nombre: 'Pintura', tipo: 'pintura', quien: 'taller', dias: 4 };
  const lac = { nombre: 'Lacado', tipo: 'lacado', quien: 'proveedor', proveedor_id: null, dias: 5 };
  const ydica = { nombre: 'Transporte Ydica', tipo: 'transporte', quien: 'taller', transportista: 'Ydica', dias: 3 };
  return [
    { id: 'galv-pint-ydica', nombre: 'Fabricación + galvanizado + pintura · vía Ydica', etapas: [fab, galv, pint, ydica] },
    { id: 'galv-ydica', nombre: 'Fabricación + galvanizado · vía Ydica', etapas: [fab, galv, ydica] },
    { id: 'pint-ydica', nombre: 'Fabricación + pintura · vía Ydica', etapas: [fab, pint, ydica] },
    { id: 'lac-ydica', nombre: 'Fabricación + lacado · vía Ydica', etapas: [fab, lac, ydica] },
    { id: 'fab-ydica', nombre: 'Solo fabricación · vía Ydica', etapas: [fab, ydica] },
    { id: 'fab-recoger', nombre: 'Solo fabricación · lo recogemos / nos lo traen', etapas: [fab] },
  ];
}

async function plantillas() {
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'fab_plantillas'`);
  if (rows[0]?.valor && Array.isArray(rows[0].valor)) return rows[0].valor;
  const { rows: t } = await query(`SELECT id FROM proveedores WHERE nombre ILIKE '%tenas%' ORDER BY activo DESC, id LIMIT 1`).catch(() => ({ rows: [] }));
  return plantillasBase(t[0]?.id);
}

// Limpia un recorrido que llega del navegador
function limpiarEtapas(lista) {
  if (!Array.isArray(lista) || !lista.length) throw fallo(400, 'El recorrido necesita al menos una etapa');
  if (lista.length > 10) throw fallo(400, 'Como máximo 10 etapas');
  return lista.map((e) => {
    const tipo = TIPOS_ETAPA[e.tipo] ? e.tipo : 'otro';
    const quien = QUIEN.includes(e.quien) ? e.quien : 'taller';
    const dias = Math.max(0, Math.min(120, Math.round(Number(e.dias) || 0)));
    return {
      nombre: texto(e.nombre, 60) || TIPOS_ETAPA[tipo], tipo, quien, dias,
      ...(quien === 'proveedor' ? { proveedor_id: Number(e.proveedor_id) || null } : {}),
      ...(tipo === 'transporte' ? { transportista: texto(e.transportista, 60) } : {}),
    };
  });
}

/* ---------- cálculo: dónde está y cuándo llega ---------- */
// Devuelve, para una parte, sus etapas con fechas (reales o previstas), la llegada y si va con retraso
function calcular(p, etapas, h = hoy()) {
  const F = p.fechas || {};
  const out = [];
  let cursor = max(fechaOk(String(p.fecha_pedido || '').slice(0, 10)), null) || h;
  let retrasada = false;
  if (p.recibido_en) {
    etapas.forEach((e, i) => {
      const f = F[i] || {};
      if (f.ini || f.fin) out.push({ i, desde: f.ini || f.fin, hasta: f.fin || p.recibido_en, estado: 'hecha' });
      else out.push({ i, desde: null, hasta: null, estado: 'hecha' });
    });
    return { etapas: out, llegada: p.recibido_en, recibido: true, retrasada: false };
  }
  etapas.forEach((e, i) => {
    const f = F[i] || {};
    if (i < p.etapa) {
      const desde = f.ini || f.fin || cursor;
      const hasta = f.fin || desde;
      out.push({ i, desde, hasta, estado: 'hecha' });
      cursor = max(cursor, hasta);
    } else if (i === p.etapa) {
      const desde = f.ini || (p.iniciada ? h : max(cursor, h));
      let hasta = fechaOk(p.previsto) || sumar(desde, e.dias || 0);
      if (hasta < h) { hasta = h; retrasada = true; }
      out.push({ i, desde, hasta, estado: 'actual', iniciada: !!p.iniciada || !!f.ini });
      cursor = hasta;
    } else {
      const desde = cursor;
      const hasta = sumar(desde, e.dias || 0);
      out.push({ i, desde, hasta, estado: 'futura' });
      cursor = hasta;
    }
  });
  // todas las etapas hechas pero aún sin recibir (p. ej. listo para recoger): «llega» = cuando terminó o hoy
  const llegada = p.etapa >= etapas.length ? max(cursor, h) : cursor;
  return { etapas: out, llegada, recibido: false, retrasada, listo: p.etapa >= etapas.length };
}

// Quién puede tocar la etapa i de un pedido: el taller (proveedor del pedido), otro proveedor o nosotros
function responsable(ped, i) {
  const e = ped.etapas[i];
  if (!e) return null;
  if (e.quien === 'taller') return ped.proveedor_id;
  if (e.quien === 'proveedor') return e.proveedor_id || null;
  return null;   // nosotros
}

// Texto corto de dónde está una parte («en Galvanizado · Tenas», «en tránsito», «listo para recoger»)
function dondeTxt(ped, p, nombres) {
  if (p.recibido_en) return 'recibido';
  if (p.etapa >= ped.etapas.length) return 'listo, falta recibirlo';
  const e = ped.etapas[p.etapa];
  const quien = e.quien === 'nosotros' ? 'nosotros' : nombres.get(responsable(ped, p.etapa)) || (e.quien === 'proveedor' ? 'sin proveedor' : '');
  if (e.tipo === 'transporte') return p.iniciada ? `en tránsito (${e.transportista || e.nombre})` : `esperando ${e.transportista || 'transporte'}`;
  return `${p.iniciada ? 'en' : 'pendiente de'} ${e.nombre}${quien ? ` · ${quien}` : ''}${p.avance != null && p.iniciada ? ` ${p.avance} %` : ''}`;
}

/* ---------- lectura ---------- */
async function nombresProveedores(ids) {
  const lista = [...new Set(ids.filter(Boolean))];
  if (!lista.length) return new Map();
  const { rows } = await query('SELECT id, nombre FROM proveedores WHERE id = ANY($1)', [lista]);
  return new Map(rows.map((r) => [r.id, r.nombre]));
}

const SQL_PEDIDOS = `
  SELECT f.*, f.importe::float AS importe, f.fecha_pedido::text AS fecha_pedido, pv.nombre AS proveedor, pv.email AS proveedor_email,
         pr.codigo AS proyecto_codigo, pr.nombre AS proyecto_nombre, pa.codigo AS partida_codigo, pa.nombre AS partida_nombre
    FROM fab_pedidos f JOIN proveedores pv ON pv.id = f.proveedor_id
    LEFT JOIN proyectos pr ON pr.id = f.proyecto_id LEFT JOIN partidas pa ON pa.id = f.partida_id`;
const SQL_PARTES = `
  SELECT p.*, p.previsto::text AS previsto, p.recibido_en::text AS recibido_en,
         t.nombre AS tarea_nombre, o.codigo AS orden_codigo, o.titulo AS orden_titulo,
         (SELECT min(x.fecha)::text FROM tramos x WHERE x.tarea_id = p.tarea_id) AS montaje_desde,
         (SELECT min(x.fecha)::text FROM tramos x WHERE x.tarea_id = p.tarea_id AND x.fecha >= CURRENT_DATE) AS montaje_proximo
    FROM fab_partes p LEFT JOIN tareas t ON t.id = p.tarea_id LEFT JOIN ordenes o ON o.id = t.orden_id`;

// Pedidos con sus partes ya calculadas
async function pedidos({ ids = null, estados = ['en_curso'], dias = 60 } = {}) {
  const { rows: peds } = await query(`${SQL_PEDIDOS}
     WHERE ${ids ? 'f.id = ANY($1)' : `(f.estado = ANY($1) OR (f.estado = 'recibido' AND f.actualizado_en > now() - make_interval(days => $2)))`}
     ORDER BY f.estado = 'en_curso' DESC, f.fecha_pedido DESC, f.id DESC`, ids ? [ids] : [estados, dias]);
  if (!peds.length) return [];
  const { rows: partes } = await query(`${SQL_PARTES} WHERE p.pedido_id = ANY($1) ORDER BY p.orden, p.id`, [peds.map((x) => x.id)]);
  const provIds = peds.flatMap((x) => [x.proveedor_id, ...x.etapas.map((e) => e.proveedor_id)]);
  const nombres = await nombresProveedores(provIds);
  const h = hoy();
  for (const ped of peds) {
    ped.etapas = ped.etapas.map((e) => ({ ...e, responsable: e.quien === 'taller' ? ped.proveedor : e.quien === 'nosotros' ? 'Nosotros' : nombres.get(e.proveedor_id) || 'sin proveedor' }));
    ped.partes = partes.filter((p) => p.pedido_id === ped.id).map((p) => {
      const c = calcular({ ...p, fecha_pedido: ped.fecha_pedido }, ped.etapas, h);
      const montaje = p.montaje_proximo || null;
      return { ...p, calc: c, donde: dondeTxt(ped, p, nombres),
        tarde_montaje: !c.recibido && montaje && c.llegada > montaje ? Math.round((new Date(c.llegada) - new Date(montaje)) / 864e5) : 0 };
    });
    const pend = ped.partes.filter((p) => !p.recibido_en);
    ped.llegada = pend.length ? pend.reduce((a, p) => max(a, p.calc.llegada), null) : null;
    ped.retrasos = ped.partes.filter((p) => p.tarde_montaje > 0 || p.calc.retrasada).length;
  }
  return peds;
}

async function detalle(id) {
  const [ped] = await pedidos({ ids: [id] });
  if (!ped) return null;
  const [{ rows: ev }, planos, { rows: enl }] = [
    await query(`SELECT e.*, pv.nombre AS proveedor, u.nombre AS usuario, pa.nombre AS parte
                   FROM fab_eventos e LEFT JOIN proveedores pv ON pv.id = e.proveedor_id LEFT JOIN usuarios u ON u.id = e.usuario_id
                   LEFT JOIN fab_partes pa ON pa.id = e.parte_id
                  WHERE e.pedido_id = $1 ORDER BY e.creado_en DESC, e.id DESC LIMIT 150`, [id]),
    await archivos.de('fab_plano', [id]),
    await query('SELECT proveedor_id, visto_en FROM fab_enlaces WHERE pedido_id = $1', [id]),
  ];
  const fotos = await archivos.de('fab_evento', ev.map((e) => e.id));
  ped.eventos = ev.map((e) => ({ ...e, archivos: fotos.get(e.id) || [] }));
  ped.planos = planos.get(id) || [];
  // proveedores con algo que hacer en este pedido (para sus enlaces)
  const provs = [...new Set([ped.proveedor_id, ...ped.etapas.filter((e) => e.quien === 'proveedor' && e.proveedor_id).map((e) => e.proveedor_id)])];
  const nombres = await nombresProveedores(provs);
  ped.enlaces = provs.map((pid) => ({ proveedor_id: pid, nombre: nombres.get(pid), visto_en: enl.find((x) => x.proveedor_id === pid)?.visto_en || null }));
  return ped;
}

/* ---------- escritura ---------- */
async function siguienteCodigo(c) {
  const y = new Date().getFullYear();
  const { rows } = await c.query(`SELECT max(substring(codigo from '\\d+$')::int) AS n FROM fab_pedidos WHERE codigo LIKE $1`, [`FE-${y}-%`]);
  return `FE-${y}-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}

async function cargarPedidoTx(c, id) {
  const { rows } = await c.query('SELECT *, fecha_pedido::text AS fecha_pedido FROM fab_pedidos WHERE id = $1 FOR UPDATE', [id]);
  if (!rows.length) throw fallo(404, 'Pedido no encontrado');
  return rows[0];
}

// Aplica una acción a una parte. actor: { usuario } (nosotros: todo) o { proveedor_id } (solo sus etapas)
// accion: empezar | avance | terminar | recibir | poner (corregir la etapa, solo nosotros)
async function accionParte(c, ped, p, b, actor) {
  const n = ped.etapas.length;
  const nuestro = !!actor.usuario;
  const puede = (i) => nuestro || (i < n && responsable(ped, i) === actor.proveedor_id && ped.etapas[i].quien !== 'nosotros');
  const F = { ...(p.fechas || {}) };
  const h = hoy();
  const e = ped.etapas[p.etapa];
  const ev = [];
  let { etapa, iniciada, avance, previsto, recibido_en: recibido } = p;
  previsto = previsto ? String(previsto).slice(0, 10) : null;
  // el comentario es de la etapa: al cambiar de etapa sin escribir nada, se limpia
  const comentario = b.comentario !== undefined && b.comentario !== null && String(b.comentario).trim() !== '' ? texto(b.comentario, 1000)
    : b.accion === 'avance' ? p.comentario : null;
  if (recibido && b.accion !== 'poner') throw fallo(409, `«${p.nombre}» ya está recibido`);

  const empezar = (i) => { F[i] = { ...(F[i] || {}), ini: F[i]?.ini || h }; };
  const terminar = (i) => { F[i] = { ini: F[i]?.ini || h, fin: h }; };

  switch (b.accion) {
    case 'empezar':
      if (etapa >= n || !puede(etapa)) throw fallo(403, 'Esa etapa no le corresponde');
      empezar(etapa); iniciada = true;
      if (b.previsto !== undefined) previsto = fechaOk(b.previsto);
      ev.push(e.tipo === 'transporte' ? `entregado a ${e.transportista || 'transporte'}${previsto ? ` · llega ${ddmm(previsto)}` : ''}` : `empieza ${e.nombre}`);
      break;
    case 'avance': {
      if (etapa >= n || !puede(etapa)) throw fallo(403, 'Esa etapa no le corresponde');
      const antes = previsto;
      if (b.avance !== undefined && b.avance !== null && b.avance !== '') {
        const a = Math.round(Number(b.avance));
        if (!(a >= 0 && a <= 100)) throw fallo(400, 'Avance entre 0 y 100');
        avance = a;
        if (a > 0 && !iniciada) { empezar(etapa); iniciada = true; }
      }
      if (b.previsto !== undefined) previsto = fechaOk(b.previsto);
      const partes = [];
      if (b.avance != null && b.avance !== '' && avance !== p.avance) partes.push(`${e.nombre} ${avance} %`);
      if (previsto !== antes) partes.push(previsto ? `prevista ${ddmm(previsto)}${antes ? ` (antes ${ddmm(antes)})` : ''}` : 'sin fecha prevista');
      if (!partes.length && comentario === p.comentario && !(b.archivos || []).length) return null;   // nada que guardar
      ev.push(partes.join(' · ') || e.nombre);
      break;
    }
    case 'terminar': {
      if (etapa >= n || !puede(etapa)) throw fallo(403, 'Esa etapa no le corresponde');
      if (e.tipo === 'transporte' && !nuestro) throw fallo(403, 'La llegada la marcamos nosotros al recibirlo');
      terminar(etapa);
      ev.push(`${e.nombre} terminado`);
      etapa += 1; iniciada = false; avance = null; previsto = null;
      // «y entregado al transporte»: si lo siguiente es el transporte y también le toca a él, lo empieza
      const sig = ped.etapas[etapa];
      if (b.entregar && sig && sig.tipo === 'transporte' && puede(etapa)) {
        empezar(etapa); iniciada = true;
        ev.push(`entregado a ${sig.transportista || 'transporte'}`);
      } else if (sig && b.empezar_siguiente && puede(etapa)) {
        empezar(etapa); iniciada = true;
      }
      break;
    }
    case 'recibir':
      if (!nuestro) throw fallo(403, 'Lo recibimos nosotros');
      for (let i = etapa; i < n; i++) terminar(i);
      etapa = n; iniciada = false; avance = null; previsto = null; recibido = h;
      ev.push('recibido en Menorca');
      break;
    case 'poner': {
      if (!nuestro) throw fallo(403, 'Solo desde la oficina');
      const i = Math.round(Number(b.etapa));
      if (!(i >= 0 && i <= n)) throw fallo(400, 'Etapa no válida');
      for (let k = 0; k < Math.min(i, n); k++) if (!F[k]?.fin) terminar(k);
      for (let k = i; k < n; k++) { if (k > i || !b.iniciada) delete F[k]; }
      etapa = i; iniciada = i < n && !!b.iniciada; if (iniciada) empezar(i);
      avance = null; previsto = null; recibido = null;
      ev.push(i >= n ? 'corregido: todas las etapas hechas' : `corregido: ${iniciada ? 'en' : 'pendiente de'} ${ped.etapas[i].nombre}`);
      break;
    }
    default: throw fallo(400, 'Acción no válida');
  }
  await c.query(`UPDATE fab_partes SET etapa = $2, iniciada = $3, avance = $4, previsto = $5, comentario = $6, fechas = $7,
                        recibido_en = $8, recibido_por = $9, actualizado_en = now() WHERE id = $1`,
  [p.id, etapa, iniciada, avance, previsto, comentario, JSON.stringify(F), recibido,
    recibido ? (b.accion === 'recibir' ? actor.usuario.id : p.recibido_por) : null]);
  const { rows: [evr] } = await c.query(`INSERT INTO fab_eventos (pedido_id, parte_id, etapa, accion, texto, comentario, proveedor_id, usuario_id)
                                         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
  [ped.id, p.id, p.etapa, b.accion, ev.join(' · '), comentario && comentario !== p.comentario ? comentario : null,
    actor.proveedor_id || null, actor.usuario?.id || null]);
  return evr.id;
}

// Acción sobre varias partes de un pedido; devuelve los ids de evento (para colgar fotos)
async function accion(pedidoId, b, actor) {
  const ids = (Array.isArray(b.partes) ? b.partes : [b.parte]).map(Number).filter(Number.isInteger);
  if (!ids.length) throw fallo(400, 'Elige alguna parte');
  let antes; let eventos = [];
  await tx(async (c) => {
    const ped = await cargarPedidoTx(c, pedidoId);
    if (ped.estado === 'anulado') throw fallo(409, 'Pedido anulado');
    const { rows: ps } = await c.query('SELECT * FROM fab_partes WHERE pedido_id = $1 AND id = ANY($2) ORDER BY orden, id FOR UPDATE', [pedidoId, ids]);
    if (ps.length !== ids.length) throw fallo(404, 'Parte no encontrada');
    antes = new Map(ps.map((p) => [p.id, calcular({ ...p, fecha_pedido: ped.fecha_pedido }, ped.etapas).llegada]));
    for (const p of ps) {
      const id = await accionParte(c, ped, p, b, actor);
      if (id) eventos.push(id);
    }
    // fotos / PDF que acompañan (subidos antes): al primer evento
    const arch = (b.archivos || []).map(Number).filter(Number.isInteger).slice(0, 12);
    if (arch.length && eventos.length) {
      if (actor.usuario) await archivos.enlazar(c, arch, 'fab_evento', eventos[0], actor.usuario.id);
      else await c.query(`UPDATE archivos SET ref_tipo = 'fab_evento', ref_id = $3 WHERE id = ANY($1) AND ref_tipo = 'fab_pend' AND ref_id = $2`, [arch, pedidoId, eventos[0]]);
    }
    if (!eventos.length && arch.length) throw fallo(400, 'Añada un comentario o un avance con las fotos');
    // todo recibido → pedido recibido
    await c.query(`UPDATE fab_pedidos SET actualizado_en = now(),
                     estado = CASE WHEN estado = 'en_curso' AND NOT EXISTS (SELECT 1 FROM fab_partes WHERE pedido_id = $1 AND recibido_en IS NULL)
                                   THEN 'recibido' ELSE estado END WHERE id = $1`, [pedidoId]);
  });
  if (eventos.length) avisarCambios(pedidoId, antes, actor).catch((e) => console.warn('fab avisos', e.message));
  return eventos;
}

// Avisos: a compras de cada novedad (agrupado por pedido); a planificación si ahora llega después del montaje
async function avisarCambios(pedidoId, antes, actor) {
  const [ped] = await pedidos({ ids: [pedidoId] });
  if (!ped) return;
  const quien = actor.proveedor_id ? (await nombresProveedores([actor.proveedor_id])).get(actor.proveedor_id) : null;
  const tocadas = ped.partes.filter((p) => antes.has(p.id));
  if (quien) {
    notif.avisarLuego(notif.conPermiso('compras', 'proyectos'), 'fab_avance', {
      titulo: `${quien} · ${ped.codigo}`,
      cuerpo: tocadas.map((p) => `${p.nombre}: ${p.donde}`).join('\n').slice(0, 300),
      url: `/compras.html?vista=fabricacion&fab=${ped.id}`, tag: `fab-${ped.id}`,
    });
  }
  const tarde = tocadas.filter((p) => p.tarde_montaje > 0 && p.calc.llegada > (antes.get(p.id) || ''));
  if (tarde.length) {
    notif.avisarLuego(notif.conPermiso('planificar'), 'fab_tarde', {
      titulo: `⚠ ${ped.codigo}: llega después del montaje`,
      cuerpo: tarde.map((p) => `${p.nombre}: llega ~${ddmm(p.calc.llegada)} y el montaje (${p.orden_codigo || ''} ${p.tarea_nombre || ''}) está el ${ddmm(p.montaje_proximo)}`).join('\n').slice(0, 300),
      url: `/?fecha=${tarde[0].montaje_proximo}`, tag: `fab-tarde-${ped.id}`, urgente: true,
    });
  }
}

/* ---------- enlaces de los proveedores ---------- */
function baseUrl(req) {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '');
  return req ? `${req.protocol}://${req.get('host')}` : '';
}
const firma = (ped, prov, nonce) => require('./correo').firmar(`fab:${ped}:${prov}:${nonce}`);

async function enlace(pedidoId, provId, req, { nuevo = false } = {}) {
  const n = crypto.randomBytes(18).toString('base64url');
  const { rows } = await query(
    `INSERT INTO fab_enlaces (pedido_id, proveedor_id, nonce) VALUES ($1,$2,$3)
     ON CONFLICT (pedido_id, proveedor_id) DO UPDATE SET nonce = ${nuevo ? 'EXCLUDED.nonce' : 'fab_enlaces.nonce'} RETURNING nonce`, [pedidoId, provId, n]);
  return `${baseUrl(req)}/fabricacion.html?t=${pedidoId}.${provId}.${firma(pedidoId, provId, rows[0].nonce)}`;
}

async function porToken(t) {
  const m = /^(\d{1,9})\.(\d{1,9})\.([A-Za-z0-9_-]{32})$/.exec(String(t || ''));
  const noVale = fallo(404, 'Este enlace no es válido o ya no está activo. Pídanos uno nuevo.');
  if (!m) throw noVale;
  const [ped, prov] = [Number(m[1]), Number(m[2])];
  const { rows } = await query('SELECT nonce, visto_en FROM fab_enlaces WHERE pedido_id = $1 AND proveedor_id = $2', [ped, prov]);
  if (!rows.length) throw noVale;
  const a = Buffer.from(firma(ped, prov, rows[0].nonce)); const b = Buffer.from(m[3]);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw noVale;
  if (!rows[0].visto_en) await query('UPDATE fab_enlaces SET visto_en = now() WHERE pedido_id = $1 AND proveedor_id = $2', [ped, prov]);
  return { pedidoId: ped, proveedorId: prov };
}

// Lo que ve un proveedor: sus partes (todas, con las que puede tocar marcadas), planos, sin importes
async function vistaProveedor(pedidoId, provId) {
  const ped = await detalle(pedidoId);
  if (!ped) throw fallo(404, 'Pedido no encontrado');
  const { ajustes } = require('./compras');
  const aj = await ajustes();
  const nombres = await nombresProveedores([provId]);
  const mias = (i) => i < ped.etapas.length && ped.etapas[i].quien !== 'nosotros' && responsable(ped, i) === provId;
  const algunaMia = ped.etapas.some((e, i) => mias(i));
  return {
    empresa: { nombre: aj.empresa.nombre, telefono: aj.empresa.telefono, email: aj.empresa.email },
    codigo: ped.codigo, titulo: ped.titulo, proyecto: ped.proyecto_nombre, estado: ped.estado,
    yo: { id: provId, nombre: nombres.get(provId), taller: provId === ped.proveedor_id, alguna: algunaMia },
    taller: ped.proveedor,
    etapas: ped.etapas.map((e, i) => ({ nombre: e.nombre, tipo: e.tipo, responsable: e.responsable, mia: mias(i), transportista: e.transportista || null, dias: e.dias })),
    planos: provId === ped.proveedor_id || algunaMia ? ped.planos.map((a) => ({ id: a.id, nombre: a.nombre, tipo: a.tipo })) : [],
    planos_enlace: ped.planos_enlace,
    partes: ped.partes
      .filter((p) => ped.etapas.some((e, i) => mias(i)) || provId === ped.proveedor_id)
      .map((p) => ({
        id: p.id, nombre: p.nombre, detalle: p.detalle, etapa: p.etapa, iniciada: p.iniciada, avance: p.avance, previsto: p.previsto,
        comentario: p.comentario, recibido: !!p.recibido_en, donde: p.donde, llegada: p.calc.llegada,
        puede: !p.recibido_en && mias(p.etapa) && ped.estado === 'en_curso',
        hechas: p.calc.etapas.filter((x) => x.estado === 'hecha').map((x) => ({ i: x.i, fin: x.hasta })),
      })),
    eventos: ped.eventos.slice(0, 30).map((e) => ({ cuando: e.creado_en, quien: e.proveedor || aj.empresa.nombre, parte: e.parte, texto: e.texto, comentario: e.comentario,
      archivos: e.archivos.map((a) => ({ id: a.id, nombre: a.nombre, tipo: a.tipo })) })),
  };
}

/* ---------- para el tablero ---------- */
// Partes unidas a tareas (marca en el montaje y aviso) y franja de la semana / mes
async function paraTablero(desde, hasta) {
  const peds = await pedidos({ estados: ['en_curso'], dias: 45 });
  const porTarea = new Map();
  const franja = [];
  for (const ped of peds) {
    for (const p of ped.partes) {
      const info = {
        parte_id: p.id, pedido_id: ped.id, codigo: ped.codigo, nombre: p.nombre, taller: ped.proveedor, donde: p.donde,
        llegada: p.calc.llegada, recibido: !!p.recibido_en, recibido_en: p.recibido_en, retrasada: p.calc.retrasada,
        proyecto_id: ped.proyecto_id, proyecto: ped.proyecto_codigo, proyecto_nombre: ped.proyecto_nombre, tarea_id: p.tarea_id,
        etapas: p.calc.etapas.map((x) => ({ ...x, nombre: ped.etapas[x.i].nombre, tipo: ped.etapas[x.i].tipo, responsable: ped.etapas[x.i].responsable })),
      };
      if (p.tarea_id) {
        if (!porTarea.has(p.tarea_id)) porTarea.set(p.tarea_id, []);
        porTarea.get(p.tarea_id).push(info);
      }
      const ini = p.calc.etapas.find((x) => x.desde)?.desde || ped.fecha_pedido;
      const fin = p.recibido_en || p.calc.llegada;
      if (ped.estado !== 'anulado' && ini <= hasta && fin >= desde) franja.push(info);
    }
  }
  return { porTarea, franja };
}

/* ---------- rutas ---------- */
function montar(app, asyncH) {
  const ver = auth.permiso('compras', 'proyectos', 'planificar', 'logistica', 'aprobar_compras');
  const editar = auth.permiso('compras', 'proyectos');
  const recibir = auth.permiso('compras', 'proyectos', 'logistica');

  app.get('/api/fabricacion', ver, asyncH(async (req, res) => {
    const todos = req.query.estado === 'todos';
    res.json({ pedidos: await pedidos({ estados: todos ? ['en_curso', 'recibido', 'anulado'] : ['en_curso'], dias: todos ? 3650 : 30 }), tipos: TIPOS_ETAPA });
  }));

  app.get('/api/fabricacion/opciones', ver, asyncH(async (req, res) => {
    const [pl, { rows: provs }, { rows: proys }] = [
      await plantillas(),
      await query('SELECT id, nombre, email FROM proveedores WHERE activo ORDER BY nombre'),
      await query(`SELECT id, codigo, nombre FROM proyectos WHERE estado = 'activo' ORDER BY codigo DESC`),
    ];
    const aj = await require('./compras').ajustes();
    res.json({ plantillas: pl, proveedores: provs, proyectos: proys, tipos: TIPOS_ETAPA, empresa: aj.empresa.nombre });
  }));

  // partidas y tareas de un proyecto (para unir cada parte a su tarea de montaje)
  app.get('/api/fabricacion/proyecto/:id', ver, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const [{ rows: partidas }, { rows: tareas }] = [
      await query('SELECT id, codigo, nombre FROM partidas WHERE proyecto_id = $1 ORDER BY orden, id', [id]),
      await query(`SELECT t.id, t.nombre, o.codigo AS orden_codigo, o.titulo AS orden_titulo, o.partida_id
                     FROM tareas t JOIN ordenes o ON o.id = t.orden_id
                    WHERE o.proyecto_id = $1 AND o.estado = 'abierta' AND t.estado <> 'hecha'
                    ORDER BY o.codigo, t.orden_en_of, t.id`, [id]),
    ];
    res.json({ partidas, tareas });
  }));

  app.get('/api/fabricacion/plantillas', ver, asyncH(async (req, res) => res.json(await plantillas())));
  app.put('/api/fabricacion/plantillas', editar, asyncH(async (req, res) => {
    const lista = Array.isArray(req.body) ? req.body : [];
    if (lista.length > 40) throw fallo(400, 'Demasiadas plantillas');
    const limpias = lista.map((p, i) => ({ id: texto(p.id, 40) || `p${Date.now()}${i}`, nombre: texto(p.nombre, 80) || `Recorrido ${i + 1}`, etapas: limpiarEtapas(p.etapas) }));
    await query(`INSERT INTO ajustes (clave, valor) VALUES ('fab_plantillas', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(limpias)]);
    res.json(limpias);
  }));

  app.post('/api/fabricacion', editar, asyncH(async (req, res) => {
    const b = req.body || {};
    const prov = Number(b.proveedor_id);
    if (!prov) throw fallo(400, 'Elige el taller');
    const etapas = limpiarEtapas(b.etapas);
    const partes = (Array.isArray(b.partes) && b.partes.length ? b.partes : [{ nombre: texto(b.titulo, 120) || 'Pedido completo' }]).slice(0, 60);
    let id;
    await tx(async (c) => {
      const codigo = await siguienteCodigo(c);
      const { rows } = await c.query(
        `INSERT INTO fab_pedidos (codigo, proveedor_id, proyecto_id, partida_id, titulo, etapas, importe, fecha_pedido, planos_enlace, notas, creado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE),$9,$10,$11) RETURNING id`,
        [codigo, prov, Number(b.proyecto_id) || null, Number(b.partida_id) || null, texto(b.titulo, 160) || 'Fabricación externa',
          JSON.stringify(etapas), b.importe === '' || b.importe == null ? null : Number(b.importe), fechaOk(b.fecha_pedido),
          texto(b.planos_enlace, 500), texto(b.notas, 2000), req.usuario.id]);
      id = rows[0].id;
      for (const [i, p] of partes.entries()) {
        await c.query('INSERT INTO fab_partes (pedido_id, nombre, detalle, tarea_id, orden) VALUES ($1,$2,$3,$4,$5)',
          [id, texto(p.nombre, 160) || `Parte ${i + 1}`, texto(p.detalle, 300), Number(p.tarea_id) || null, i]);
      }
      await archivos.enlazar(c, b.planos, 'fab_plano', id, req.usuario.id);
      await c.query(`INSERT INTO fab_eventos (pedido_id, accion, texto, usuario_id) VALUES ($1,'crear','pedido creado',$2)`, [id, req.usuario.id]);
    });
    res.status(201).json(await detalle(id));
  }));

  app.get('/api/fabricacion/:id', ver, asyncH(async (req, res) => {
    const d = await detalle(Number(req.params.id));
    if (!d) throw fallo(404, 'Pedido no encontrado');
    res.json(d);
  }));

  app.patch('/api/fabricacion/:id', editar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    await tx(async (c) => {
      const ped = await cargarPedidoTx(c, id);
      const sets = []; const vals = [id];
      const poner = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };
      if (b.titulo !== undefined) poner('titulo', texto(b.titulo, 160) || ped.titulo);
      if (b.proveedor_id !== undefined) poner('proveedor_id', Number(b.proveedor_id) || ped.proveedor_id);
      if (b.proyecto_id !== undefined) poner('proyecto_id', Number(b.proyecto_id) || null);
      if (b.partida_id !== undefined) poner('partida_id', Number(b.partida_id) || null);
      if (b.importe !== undefined) poner('importe', b.importe === '' || b.importe == null ? null : Number(b.importe));
      if (b.fecha_pedido !== undefined) poner('fecha_pedido', fechaOk(b.fecha_pedido) || ped.fecha_pedido);
      if (b.planos_enlace !== undefined) poner('planos_enlace', texto(b.planos_enlace, 500));
      if (b.notas !== undefined) poner('notas', texto(b.notas, 2000));
      if (b.estado !== undefined) {
        if (!['en_curso', 'anulado'].includes(b.estado)) throw fallo(400, 'Estado no válido');
        poner('estado', b.estado);
      }
      if (b.etapas !== undefined) {
        const et = limpiarEtapas(b.etapas);
        poner('etapas', JSON.stringify(et));
        // si quitan etapas, ninguna parte se queda fuera del recorrido
        await c.query('UPDATE fab_partes SET etapa = LEAST(etapa, $2) WHERE pedido_id = $1', [id, et.length]);
      }
      if (!sets.length) return;
      await c.query(`UPDATE fab_pedidos SET ${sets.join(', ')}, actualizado_en = now() WHERE id = $1`, vals);
      if (b.estado === 'anulado') await c.query(`INSERT INTO fab_eventos (pedido_id, accion, texto, usuario_id) VALUES ($1,'anular','pedido anulado',$2)`, [id, req.usuario.id]);
    });
    res.json(await detalle(id));
  }));

  app.post('/api/fabricacion/:id/partes', editar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    await tx(async (c) => {
      await cargarPedidoTx(c, id);
      const { rows } = await c.query('SELECT COALESCE(max(orden), -1) + 1 AS o FROM fab_partes WHERE pedido_id = $1', [id]);
      // la parte nueva sale del mismo punto que la que se separa (si se indica «de»)
      const de = b.de ? (await c.query('SELECT * FROM fab_partes WHERE id = $1 AND pedido_id = $2', [Number(b.de), id])).rows[0] : null;
      await c.query(`INSERT INTO fab_partes (pedido_id, nombre, detalle, tarea_id, orden, etapa, iniciada, avance, previsto, fechas)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, texto(b.nombre, 160) || 'Parte nueva', texto(b.detalle, 300), Number(b.tarea_id) || de?.tarea_id || null, rows[0].o,
        de?.etapa || 0, de?.iniciada || false, de?.avance ?? null, de?.previsto || null, JSON.stringify(de?.fechas || {})]);
    });
    res.status(201).json(await detalle(id));
  }));

  app.patch('/api/fabricacion/partes/:id', editar, asyncH(async (req, res) => {
    const b = req.body || {};
    const { rows } = await query(
      `UPDATE fab_partes SET nombre = COALESCE($2, nombre), detalle = CASE WHEN $5 THEN $3 ELSE detalle END,
              tarea_id = CASE WHEN $6 THEN $4::int ELSE tarea_id END, actualizado_en = now()
        WHERE id = $1 RETURNING pedido_id`,
      [Number(req.params.id), b.nombre !== undefined ? texto(b.nombre, 160) : null, texto(b.detalle, 300), Number(b.tarea_id) || null,
        b.detalle !== undefined, b.tarea_id !== undefined]);
    if (!rows.length) throw fallo(404, 'Parte no encontrada');
    res.json(await detalle(rows[0].pedido_id));
  }));

  app.delete('/api/fabricacion/partes/:id', editar, asyncH(async (req, res) => {
    const { rows } = await query('SELECT pedido_id FROM fab_partes WHERE id = $1', [Number(req.params.id)]);
    if (!rows.length) throw fallo(404, 'Parte no encontrada');
    const { rows: n } = await query('SELECT count(*)::int AS n FROM fab_partes WHERE pedido_id = $1', [rows[0].pedido_id]);
    if (n[0].n <= 1) throw fallo(409, 'El pedido necesita al menos una parte');
    await query('DELETE FROM fab_partes WHERE id = $1', [Number(req.params.id)]);
    res.json(await detalle(rows[0].pedido_id));
  }));

  // empezar / avance / terminar / recibir / poner, sobre una o varias partes
  app.post('/api/fabricacion/:id/accion', ver, asyncH(async (req, res) => {
    const b = req.body || {};
    const permitido = b.accion === 'recibir' ? ['compras', 'proyectos', 'logistica'] : ['compras', 'proyectos'];
    if (!permitido.some((p) => auth.tiene(req.usuario, p))) throw fallo(403, 'No tienes permiso para esto');
    await accion(Number(req.params.id), b, { usuario: req.usuario });
    res.json(await detalle(Number(req.params.id)));
  }));

  app.post('/api/fabricacion/:id/planos', editar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    await tx(async (c) => { await cargarPedidoTx(c, id); await archivos.enlazar(c, req.body?.archivos, 'fab_plano', id, req.usuario.id); });
    res.json(await detalle(id));
  }));
  app.delete('/api/fabricacion/:id/planos/:arch', editar, asyncH(async (req, res) => {
    await query(`DELETE FROM archivos WHERE id = $1 AND ref_tipo = 'fab_plano' AND ref_id = $2`, [Number(req.params.arch), Number(req.params.id)]);
    res.json(await detalle(Number(req.params.id)));
  }));

  app.post('/api/fabricacion/:id/enlace', editar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const d = await detalle(id);
    if (!d) throw fallo(404, 'Pedido no encontrado');
    const prov = Number(req.body?.proveedor_id) || d.proveedor_id;
    if (!d.enlaces.some((e) => e.proveedor_id === prov)) throw fallo(400, 'Ese proveedor no tiene ninguna etapa en este pedido');
    res.json({ url: await enlace(id, prov, req, { nuevo: !!req.body?.nuevo }) });
  }));
}

// Página pública del proveedor (sin sesión): se monta antes del control de sesión
function montarPublico(app, asyncH) {
  app.get('/api/fab-enlace/:t', asyncH(async (req, res) => {
    const { pedidoId, proveedorId } = await porToken(req.params.t);
    res.set('Cache-Control', 'no-store').json(await vistaProveedor(pedidoId, proveedorId));
  }));

  app.post('/api/fab-enlace/:t/accion', asyncH(async (req, res) => {
    const { pedidoId, proveedorId } = await porToken(req.params.t);
    const b = req.body || {};
    if (!['empezar', 'avance', 'terminar'].includes(b.accion)) throw fallo(400, 'Acción no válida');
    await accion(pedidoId, { ...b, comentario: b.comentario }, { proveedor_id: proveedorId });
    res.json(await vistaProveedor(pedidoId, proveedorId));
  }));

  // fotos o PDF (albarán, certificado de galvanizado…): se suben y se cuelgan de la siguiente actualización
  app.post('/api/fab-enlace/:t/archivos', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'], limit: 6 * 1024 * 1024 }), asyncH(async (req, res) => {
    const { pedidoId } = await porToken(req.params.t);
    const tipo = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw fallo(400, 'Archivo vacío');
    const { rows: n } = await query(`SELECT count(*)::int AS n FROM archivos WHERE ref_tipo = 'fab_pend' AND ref_id = $1 AND creado > now() - interval '1 day'`, [pedidoId]);
    if (n[0].n > 40) throw fallo(429, 'Demasiados archivos seguidos');
    const nombre = req.headers['x-nombre'] ? decodeURIComponent(String(req.headers['x-nombre'])).slice(0, 120) : null;
    const { rows } = await query(`INSERT INTO archivos (tipo, bytes, nombre, datos, ref_tipo, ref_id, creado_por) VALUES ($1,$2,$3,$4,'fab_pend',$5,NULL) RETURNING id`,
      [tipo, req.body.length, nombre, req.body, pedidoId]);
    res.status(201).json({ id: rows[0].id });
  }));

  // planos y fotos de este pedido
  app.get('/api/fab-enlace/:t/archivos/:id', asyncH(async (req, res) => {
    const { pedidoId } = await porToken(req.params.t);
    const { rows } = await query(
      `SELECT a.tipo, a.nombre, a.datos FROM archivos a
        WHERE a.id = $1 AND a.datos IS NOT NULL AND ((a.ref_tipo IN ('fab_plano','fab_pend') AND a.ref_id = $2)
           OR (a.ref_tipo = 'fab_evento' AND a.ref_id IN (SELECT id FROM fab_eventos WHERE pedido_id = $2)))`, [Number(req.params.id), pedidoId]);
    if (!rows.length) throw fallo(404, 'Archivo no encontrado');
    res.set({ 'Content-Type': rows[0].tipo, 'Content-Disposition': `inline; filename="${encodeURIComponent(rows[0].nombre || 'archivo')}"`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.send(rows[0].datos);
  }));
}

module.exports = { montar, montarPublico, paraTablero, pedidos, calcular, TIPOS_ETAPA };
