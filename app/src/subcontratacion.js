// Subcontratación a talleres externos desde la OT: se marcan tareas externas de la OT (y, si hace falta, líneas sueltas
// como el transporte) y se pide presupuesto a uno o varios talleres, o se hace el pedido a uno.
//  · Usa las peticiones de precio (SOL) y los pedidos de compra (PC) de Compras, con tipo 'subcontratacion', su OT y
//    cada línea enlazada a su tarea. Así valen igual la respuesta del taller en la plataforma, el comparativo, la
//    aprobación de Dirección por importe y el envío con PDF.
//  · Al enviar el pedido, va con él el enlace de seguimiento del taller (seguimiento-ext.js) y sus tareas pasan a ese
//    taller si se eligió otro en el comparativo.
const { query, tx } = require('./db');
const auth = require('./auth');
const { crearPedido, texto, fechaOk } = require('./compras');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const ddmm = (f) => (f ? `${String(f).slice(8, 10)}/${String(f).slice(5, 7)}` : '');

async function siguienteSol(c) {
  const y = new Date().getFullYear();
  const { rows } = await c.query(`SELECT max(substring(codigo from '\\d+$')::int) AS n FROM solicitudes_precio WHERE codigo LIKE $1`, [`SOL-${y}-%`]);
  return `SOL-${y}-${String((rows[0].n || 0) + 1).padStart(4, '0')}`;
}

function montar(app, asyncH) {
  const p = auth.permiso('compras', 'proyectos', 'planificar');

  // { tarea_ids: [], extras: ['Transporte Barcelona → Menorca'], accion: 'presupuesto' | 'pedido',
  //   proveedor_ids: [] (presupuesto) | proveedor_id (pedido), notas, responder_antes }
  app.post('/api/ordenes/:id/subcontratacion', p, asyncH(async (req, res) => {
    const ordenId = Number(req.params.id); const b = req.body || {};
    const ids = [...new Set((Array.isArray(b.tarea_ids) ? b.tarea_ids : []).map(Number).filter(Number.isInteger))].slice(0, 50);
    const extras = (Array.isArray(b.extras) ? b.extras : []).map((x) => texto(x, 300)).filter(Boolean).slice(0, 10);
    if (!ids.length) throw fallo(400, 'Marca alguna tarea');
    const r = await tx(async (c) => {
      const { rows: ot } = await c.query(
        `SELECT o.id, o.codigo, o.titulo, o.estado, pr.nombre AS proyecto, pr.obra FROM ordenes o LEFT JOIN proyectos pr ON pr.id = o.proyecto_id WHERE o.id = $1`, [ordenId]);
      if (!ot.length) throw fallo(404, 'OT no encontrada');
      if (ot[0].estado === 'cerrada') throw fallo(400, 'La OT está cerrada');
      const { rows: ts } = await c.query(
        `SELECT t.id, t.codigo, t.nombre, t.notas, t.proveedor_id, t.duracion_h,
                (SELECT min(x.fecha)::text FROM tramos x WHERE x.tarea_id = t.id) AS desde,
                (SELECT max(x.fecha)::text FROM tramos x WHERE x.tarea_id = t.id) AS hasta,
                (SELECT codigo FROM pedidos_compra pc WHERE pc.id = t.ext_pedido_id AND pc.estado <> 'anulado') AS en_pedido,
                (SELECT codigo FROM solicitudes_precio s WHERE s.id = t.ext_solicitud_id AND s.estado = 'abierta') AS en_solicitud
           FROM tareas t WHERE t.id = ANY($1) AND t.orden_id = $2 ORDER BY t.orden_en_of, t.id FOR UPDATE`, [ids, ordenId]);
      if (ts.length !== ids.length) throw fallo(400, 'Alguna tarea no es de esta OT');
      const mal = ts.find((t) => !t.proveedor_id);
      if (mal) throw fallo(400, `${mal.codigo} ${mal.nombre}: elige antes su taller externo (Área / taller)`);
      const ocupada = ts.find((t) => t.en_pedido || t.en_solicitud);
      if (ocupada) throw fallo(400, `${ocupada.codigo} ${ocupada.nombre} ya está en ${ocupada.en_pedido || ocupada.en_solicitud}`);
      const o = ot[0];
      const plazo = (t) => (t.desde ? ` · previsto ${ddmm(t.desde)}–${ddmm(t.hasta)}` : '');
      const lineas = [
        ...ts.map((t) => ({ tarea_id: t.id, descripcion: `${t.codigo} ${t.nombre}${plazo(t)}`, cantidad: 1, unidad: 'trabajo' })),
        ...extras.map((d) => ({ descripcion: d, cantidad: 1, unidad: 'ud' })),
      ];
      const fin = ts.map((t) => t.hasta).filter(Boolean).sort().pop() || null;
      const notas = texto(b.notas, 2000)
        || `OT ${o.codigo} ${o.titulo}${o.obra ? ` · obra ${o.obra}` : ''}. Planos y detalles: se los enviamos aparte o los tienen en el enlace de seguimiento.`;

      if (b.accion === 'pedido') {
        const pid = Number(b.proveedor_id);
        if (!pid) throw fallo(400, 'Elige el taller');
        const id = await crearPedido(c, {
          proveedor_id: pid, lineas, fecha_entrega: fin, referencia: `OT ${o.codigo} ${o.titulo}${o.proyecto ? ` · ${o.proyecto}` : ''}`,
          usuarioId: req.usuario.id, tipo: 'subcontratacion', orden_id: ordenId, observaciones: notas,
        });
        return { pedido_id: id };
      }
      const provs = [...new Set((Array.isArray(b.proveedor_ids) ? b.proveedor_ids : []).map(Number).filter(Number.isInteger))].slice(0, 20);
      if (!provs.length) throw fallo(400, 'Elige al menos un taller');
      const codigo = await siguienteSol(c);
      const { rows } = await c.query(
        `INSERT INTO solicitudes_precio (codigo, responder_antes, necesario_el, notas, creado_por, tipo, orden_id)
         VALUES ($1,$2,$3,$4,$5,'subcontratacion',$6) RETURNING id`,
        [codigo, fechaOk(b.responder_antes), fin, notas, req.usuario.id, ordenId]);
      const sid = rows[0].id;
      let i = 0;
      for (const l of lineas) {
        await c.query(`INSERT INTO solicitud_lineas (solicitud_id, tarea_id, descripcion, cantidad, unidad, orden) VALUES ($1,$2,$3,$4,$5,$6)`,
          [sid, l.tarea_id || null, l.descripcion, l.cantidad, l.unidad, i++]);
        if (l.tarea_id) await c.query('UPDATE tareas SET ext_solicitud_id = $2 WHERE id = $1', [l.tarea_id, sid]);
      }
      for (const pv of provs) await c.query('INSERT INTO solicitud_proveedores (solicitud_id, proveedor_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [sid, pv]);
      return { solicitud_id: sid };
    });
    res.status(201).json(r);
  }));
}

// Lo comprometido en pedidos de subcontratación enviados, por tarea (las líneas sueltas, como el transporte,
// van a la primera tarea del pedido). Para el control de costes.
async function costePorTarea(tareaIds) {
  if (!tareaIds.length) return new Map();
  const { rows } = await query(
    `SELECT tarea_id, sum(importe)::float AS importe FROM (
       SELECT COALESCE(l.tarea_id, (SELECT l2.tarea_id FROM pedido_compra_lineas l2 WHERE l2.pedido_id = c.id AND l2.tarea_id IS NOT NULL
                                    ORDER BY l2.orden, l2.id LIMIT 1)) AS tarea_id,
              l.cantidad * COALESCE(l.precio, 0) AS importe
         FROM pedidos_compra c JOIN pedido_compra_lineas l ON l.pedido_id = c.id
        WHERE c.tipo = 'subcontratacion' AND c.estado = 'enviado') x
      WHERE tarea_id = ANY($1) GROUP BY tarea_id`, [tareaIds]);
  return new Map(rows.map((r) => [r.tarea_id, r.importe]));
}

module.exports = { montar, costePorTarea };
