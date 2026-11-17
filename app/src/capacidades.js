// Capacidades (saber hacer) de las personas: «sabe soldar MIG/MAG», «carretilla elevadora»…
// Una tarea pide capacidades (y cuántas personas a la vez); el tablero avisa si a quien se asigna le falta.
// La categoría (Oficial 1ª, 2º…) sigue en la ficha del operario para el coste.
const { query, tx } = require('./db');
const auth = require('./auth');

const fallo = (status, msg) => Object.assign(new Error(msg), { status });
const texto = (v, max) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max) || null;

// Lista inicial (se carga una vez; luego se edita en el panel)
const SEMILLA = {
  Soldadura: ['Soldadura MIG/MAG (acero)', 'Soldadura TIG (inox / aluminio)', 'Soldadura con electrodo (MMA)', 'Soldadura láser',
    'Soldadura en posición / bajo techo', 'Corte por plasma', 'Oxicorte'],
  'Herrería y calderería': ['Interpretar planos de taller', 'Trazado y marcado', 'Corte de perfiles (sierra de cinta, tronzadora)', 'Taladrado y roscado',
    'Doblado y curvado de perfiles', 'Plegado de chapa (plegadora)', 'Cizallado de chapa', 'Armado y punteado de estructuras',
    'Escuadrado y control dimensional', 'Repasado, amolado y acabado de soldaduras', 'Forja / herrería artística', 'Torno y fresadora'],
  'Carpintería de aluminio y PVC': ['Corte de perfil de aluminio (ingletadora / cortadora de disco)', 'Mecanizado de aluminio (punzonadora, fresadora de cerraduras)',
    'Ensamblado de ventanas y puertas de aluminio', 'Herrajes y regulación de hojas', 'Persianas, mallorquinas y lamas',
    'Acristalamiento (colocación y acuñado de vidrio)', 'Sellado con siliconas y espumas', 'Carpintería de PVC'],
  'Pintura y acabados': ['Preparación de superficie (desengrase, lijado, chorreado)', 'Imprimación', 'Pintura con pistola aerográfica', 'Pintura con equipo airless',
    'Pintura a brocha y rodillo (retoques en obra)', 'Medición de espesores y control de calidad de pintura', 'Galvanizado en frío / retoques de galvanizado'],
  'Montaje en obra': ['Replanteo y toma de medidas en obra', 'Nivelación y aplomado (láser)', 'Anclajes químicos y mecánicos', 'Montaje de premarcos',
    'Montaje de carpintería en obra', 'Montaje de barandillas y escaleras', 'Montaje de estructura metálica', 'Montaje de cerramientos y fachadas',
    'Remates y sellados de obra'],
  'Uso de maquinaria': ['Sierra de cinta / sierra semiautomática', 'Plegadora', 'Cizalla', 'Curvadora de perfiles', 'Taladro de columna', 'Taladro magnético',
    'Punzonadora de lamas y troqueles', 'Cortadora de disco (aluminio)', 'Fresadora de cerraduras', 'Torno / fresadora'],
  'Elevación, altura y vehículos': ['Carretilla elevadora (toro)', 'Plataforma elevadora (PEMP)', 'Puente grúa / polipasto', 'Señalista de grúa / eslingado de cargas',
    'Montaje de andamios', 'Trabajos en altura con arnés', 'Conducción de furgoneta', 'Conducción de camión (carnet C)'],
  'Herramientas portátiles': ['Radial / amoladora', 'Taladro y atornillador a batería', 'Rotopercutor / martillo perforador', 'Llave de impacto',
    'Remachadoras (manual, a batería, de tuercas)', 'Sierra sable y de calar', 'Instrumentos de medición (flexómetro, calibre, nivel láser)'],
  'Seguridad y formación': ['PRL 20 h del metal', 'PRL 60 h (recurso preventivo)', 'Tarjeta Profesional de la Construcción (TPC)', 'Espacios confinados',
    'Primeros auxilios', 'Trabajos en caliente (permiso de fuego)'],
  'Oficina técnica y otros': ['Diseño CAD / planos de fabricación', 'Despiece y optimización de corte', 'Medición y presupuesto', 'Atención al cliente en obra',
    'Control de calidad y documentación'],
};
// Oficios que en realidad eran «saber hacer»: lo que pedían las tareas pasa a ser la capacidad,
// y quien tenía ese oficio recibe la capacidad (el oficio se queda en su ficha)
const DE_OFICIO = {
  'oficial 1ª soldador': ['Soldadura MIG/MAG (acero)'],
  'oficial de aluminio': ['Ensamblado de ventanas y puertas de aluminio'],
  pintor: ['Pintura con pistola aerográfica'],
  'ingeniero / delineante': ['Diseño CAD / planos de fabricación'],
  'oficial montaje obra': ['Montaje de carpintería en obra'],
};

async function sembrar() {
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'capacidades_semilla'`);
  if (rows.length) return;
  await tx(async (c) => {
    let orden = 0;
    for (const [familia, lista] of Object.entries(SEMILLA)) {
      for (const nombre of lista) {
        await c.query('INSERT INTO capacidades (familia, nombre, orden) VALUES ($1,$2,$3) ON CONFLICT (lower(nombre)) DO NOTHING', [familia, nombre, ++orden]);
      }
    }
    let n = 0;
    for (const [oficio, caps] of Object.entries(DE_OFICIO)) {
      const { rows: t } = await c.query(`SELECT id FROM tipos_recurso WHERE clase = 'operario' AND lower(nombre) = $1`, [oficio]);
      if (!t.length) continue;
      for (const cap of caps) {
        const { rows: k } = await c.query('SELECT id FROM capacidades WHERE lower(nombre) = lower($1)', [cap]);
        if (!k.length) continue;
        await c.query(`INSERT INTO recurso_capacidades (recurso_id, capacidad_id)
                       SELECT recurso_id, $2 FROM recurso_tipos WHERE tipo_recurso_id = $1 ON CONFLICT DO NOTHING`, [t[0].id, k[0].id]);
        const r = await c.query(`INSERT INTO tarea_capacidades (tarea_id, capacidad_id, cantidad)
                       SELECT tarea_id, $2, cantidad FROM tarea_requisitos_tipo WHERE tipo_recurso_id = $1 ON CONFLICT DO NOTHING`, [t[0].id, k[0].id]);
        n += r.rowCount;
      }
      await c.query('DELETE FROM tarea_requisitos_tipo WHERE tipo_recurso_id = $1', [t[0].id]);
    }
    await c.query(`INSERT INTO ajustes (clave, valor) VALUES ('capacidades_semilla', $1)`, [JSON.stringify({ en: new Date().toISOString(), tareas_convertidas: n })]);
    console.log(`Capacidades: lista inicial cargada; ${n} requisito(s) de tareas convertidos`);
  });
}

function montar(app, asyncH) {
  const editar = auth.permiso('recursos');

  app.get('/api/capacidades', asyncH(async (req, res) => {
    const [{ rows: capacidades }, { rows: personas }] = await Promise.all([
      query(`SELECT k.id, k.familia, k.nombre, k.orden,
                    COALESCE((SELECT json_agg(rc.recurso_id) FROM recurso_capacidades rc JOIN recursos r ON r.id = rc.recurso_id AND r.activo
                               WHERE rc.capacidad_id = k.id AND rc.estado = 'validada'), '[]') AS personas,
                    COALESCE((SELECT json_agg(rc.recurso_id) FROM recurso_capacidades rc JOIN recursos r ON r.id = rc.recurso_id AND r.activo
                               WHERE rc.capacidad_id = k.id AND rc.estado = 'propuesta'), '[]') AS propuestas,
                    (SELECT count(*)::int FROM tarea_capacidades q WHERE q.capacidad_id = k.id) AS tareas
               FROM capacidades k ORDER BY k.orden, lower(k.nombre)`),
      query(`SELECT r.id, r.nombre, r.vinculo, r.empresa,
                    (SELECT string_agg(ti.nombre, ', ' ORDER BY lower(ti.nombre)) FROM recurso_tipos rt JOIN tipos_recurso ti ON ti.id = rt.tipo_recurso_id
                      WHERE rt.recurso_id = r.id) AS categoria
               FROM recursos r WHERE r.activo AND r.tipo = 'operario' ORDER BY lower(r.nombre)`),
    ]);
    res.json({ capacidades, personas, puede_editar: auth.tiene(req.usuario, 'recursos') });
  }));

  app.post('/api/capacidades', editar, asyncH(async (req, res) => {
    const nombre = texto(req.body?.nombre, 120);
    if (!nombre) throw fallo(400, 'Escribe el nombre de la capacidad');
    const familia = texto(req.body?.familia, 60) || 'Otras';
    const { rows: ya } = await query('SELECT id FROM capacidades WHERE lower(nombre) = lower($1)', [nombre]);
    if (ya.length) throw fallo(409, 'Ya existe una capacidad con ese nombre');
    const { rows } = await query(
      `INSERT INTO capacidades (familia, nombre, orden) VALUES ($1, $2, COALESCE((SELECT max(orden) FROM capacidades WHERE familia = $1), (SELECT max(orden) FROM capacidades), 0) + 1)
       RETURNING id, familia, nombre, orden`, [familia, nombre]);
    res.status(201).json(rows[0]);
  }));

  app.patch('/api/capacidades/:id', editar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const b = req.body || {};
    const cambios = {};
    if ('nombre' in b) { cambios.nombre = texto(b.nombre, 120); if (!cambios.nombre) throw fallo(400, 'El nombre no puede quedar vacío'); }
    if ('familia' in b) cambios.familia = texto(b.familia, 60) || 'Otras';
    const cols = Object.keys(cambios);
    if (!cols.length) throw fallo(400, 'Nada que cambiar');
    if (cambios.nombre) {
      const { rows: ya } = await query('SELECT id FROM capacidades WHERE lower(nombre) = lower($1) AND id <> $2', [cambios.nombre, id]);
      if (ya.length) throw fallo(409, 'Ya existe una capacidad con ese nombre');
    }
    const { rows } = await query(`UPDATE capacidades SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING id, familia, nombre`,
      [id, ...cols.map((k) => cambios[k])]);
    if (!rows.length) throw fallo(404, 'Capacidad no encontrada');
    res.json(rows[0]);
  }));

  // Renombrar una familia entera
  app.put('/api/capacidades-familia', editar, asyncH(async (req, res) => {
    const de = texto(req.body?.de, 60);
    const a = texto(req.body?.a, 60);
    if (!de || !a) throw fallo(400, 'Falta el nombre');
    await query('UPDATE capacidades SET familia = $2 WHERE familia = $1', [de, a]);
    res.json({ ok: true });
  }));

  app.delete('/api/capacidades/:id', editar, asyncH(async (req, res) => {
    await query('DELETE FROM capacidades WHERE id = $1', [Number(req.params.id)]);
    res.json({ ok: true });
  }));

  // Marcar / desmarcar que una persona sabe hacer algo (lo que marca el supervisor queda validado;
  // si era una propuesta del operario, marcarla = validarla y desmarcarla = rechazarla)
  app.put('/api/capacidades/:id/personas/:recursoId', editar, asyncH(async (req, res) => {
    const id = Number(req.params.id);
    const recursoId = Number(req.params.recursoId);
    if (req.body?.sabe) {
      await query(`INSERT INTO recurso_capacidades (recurso_id, capacidad_id, estado, validada_por, validada_en)
                   SELECT $1, $2, 'validada', $3, now() WHERE EXISTS (SELECT 1 FROM recursos WHERE id = $1 AND tipo = 'operario')
                   ON CONFLICT (recurso_id, capacidad_id) DO UPDATE SET estado = 'validada', validada_por = $3, validada_en = now()`,
      [recursoId, id, req.usuario.id]);
    } else {
      await query('DELETE FROM recurso_capacidades WHERE recurso_id = $1 AND capacidad_id = $2', [recursoId, id]);
    }
    res.json({ ok: true });
  }));
}

// [{id, cantidad}] → validado; null si no viene
function leer(v) {
  if (!Array.isArray(v)) return null;
  return v.map((q) => {
    const id = Number(typeof q === 'object' ? q.id : q);
    const cantidad = Number(typeof q === 'object' && q.cantidad != null ? q.cantidad : 1);
    if (!id) throw fallo(400, 'Capacidad no válida');
    if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > 50) throw fallo(400, 'Cantidad no válida (1–50)');
    return { id, cantidad };
  });
}

// propuestas de los operarios por validar (contador del menú)
async function porValidar() {
  const { rows } = await query(`SELECT count(*)::int AS n FROM recurso_capacidades rc JOIN recursos r ON r.id = rc.recurso_id AND r.activo WHERE rc.estado = 'propuesta'`);
  return rows[0].n;
}

module.exports = { montar, sembrar, leer, porValidar };
