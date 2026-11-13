// Importación de proyectos · formato s360-import/1 (especificación en docs/importacion/README.md).
//
// POST /api/importar?simular=1  → vista previa (no cambia nada)
// POST /api/importar            → importa
// Cuerpo: el archivo tal cual, o { archivo, resoluciones }.
//
// La simulación y la importación ejecutan exactamente el mismo código dentro de una
// transacción; en la simulación se deshace al final. Así la vista previa enseña lo que
// de verdad va a pasar.
const Ajv2020 = require('ajv/dist/2020');
const addFormats = require('ajv-formats');
const { pool } = require('./db');
const auth = require('./auth');
// Copia de docs/importacion/esquema.json (la imagen Docker solo incluye app/)
const esquema = require('./importacion-esquema.json');

const ajv = new Ajv2020({ allErrors: true, strict: false, verbose: true });
addFormats(ajv);
const validarEsquema = ajv.compile(esquema);

const COLORES = ['#5aa9f0', '#e08a2a', '#4fb35f', '#b79cf2', '#e57ac4', '#6fcfc0', '#e0c341', '#f07070'];
const PRIORIDAD = { urgente: 1, alta: 2, normal: 3, baja: 4 };
const TIPOS_AREA = ['taller', 'obra', 'oficina', 'pintura', 'transporte', 'otro'];

const fallo = (status, msg) => Object.assign(new Error(msg), { status });

/* ---------- Nombres ---------- */

// minúsculas, sin acentos, sin espacios dobles
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
const VACIAS = new Set(['de', 'del', 'la', 'el', 'los', 'las', 'y', 'e', 'en', 'a', 'al', 'con', 'para', 'por']);
const palabras = (s) => new Set(norm(s).split(/[^a-z0-9]+/).filter((w) => w && !VACIAS.has(w)));
// Parecido entre nombres (0–1): palabras en común sobre palabras totales
function parecido(a, b) {
  const A = palabras(a), B = palabras(b);
  if (!A.size || !B.size) return 0;
  let comunes = 0;
  for (const w of A) if (B.has(w)) comunes++;
  return comunes / (A.size + B.size - comunes);
}
function masParecido(nombre, lista) {
  let mejor = null, nota = 0;
  for (const x of lista) {
    const p = parecido(nombre, x.nombre);
    if (p > nota) { mejor = x; nota = p; }
  }
  return nota >= 0.5 ? mejor : null;
}
function adivinarTipoArea(nombre) {
  const n = norm(nombre);
  if (/pintura|cabina|lacado/.test(n)) return 'pintura';
  if (/oficina|ingenier|tecnic|delinea/.test(n)) return 'oficina';
  if (/obra|instalacion/.test(n)) return 'obra';
  if (/transporte|logistic/.test(n)) return 'transporte';
  if (/taller|corte|soldad|mesa|metal/.test(n)) return 'taller';
  return 'otro';
}

/* ---------- Validación del archivo ---------- */

function ruta(instancePath) {
  return instancePath.split('/').filter(Boolean)
    .reduce((acc, seg) => (/^\d+$/.test(seg) ? `${acc}[${seg}]` : acc ? `${acc}.${seg}` : seg), '') || '(raíz)';
}

function mensajeAjv(e) {
  const p = e.params;
  const TIPOS = { string: 'texto', number: 'número', integer: 'número entero', object: 'objeto', array: 'lista', boolean: 'sí/no' };
  switch (e.keyword) {
    case 'required': return `falta el campo obligatorio «${p.missingProperty}»`;
    case 'additionalProperties': return `campo desconocido «${p.additionalProperty}»`;
    case 'type': return `debe ser ${TIPOS[p.type] || p.type}`;
    case 'const': return `debe ser exactamente «${p.allowedValue}»`;
    case 'enum': return `valor «${e.data}» no válido; se admite: ${p.allowedValues.join(', ')}`;
    case 'maxLength': return `máximo ${p.limit} caracteres (tiene ${String(e.data).length})`;
    case 'minLength': return 'no puede estar vacío';
    case 'pattern': return 'formato no válido (¿vacío o con espacios al principio/final?)';
    case 'multipleOf': return `${String(e.data).replace('.', ',')} no es múltiplo de ${String(p.multipleOf).replace('.', ',')}`;
    case 'maximum': return `máximo ${p.limit}`;
    case 'minimum': return `mínimo ${p.limit}`;
    case 'exclusiveMinimum': return `debe ser mayor que ${p.limit}`;
    case 'minItems': return `debe tener al menos ${p.limit} elemento(s)`;
    case 'format': return `${p.format === 'date-time' ? 'fecha-hora' : p.format} no válida`;
    case 'oneOf': return 'forma no válida (ver la especificación)';
    default: return e.message;
  }
}

// Los "oneOf" de ajv sueltan los errores de todas las alternativas. Nos quedamos con los de
// la alternativa que más se parece a lo que se escribió (la que no falla por tipo y tiene menos errores).
function erroresEsquema(errs) {
  const oneOfs = errs.filter((e) => e.keyword === 'oneOf');
  const ramas = new Set();
  const salida = [];
  for (const o of oneOfs) {
    const deRama = errs.filter((e) => e !== o && e.schemaPath.startsWith(o.schemaPath + '/') && e.instancePath.startsWith(o.instancePath));
    deRama.forEach((e) => ramas.add(e));
    const porRama = new Map();
    for (const e of deRama) {
      const i = e.schemaPath.slice(o.schemaPath.length + 1).split('/')[0];
      if (!porRama.has(i)) porRama.set(i, []);
      porRama.get(i).push(e);
    }
    const candidatas = [...porRama.values()]
      .filter((l) => !l.some((e) => e.keyword === 'type' && e.instancePath === o.instancePath))
      .sort((a, b) => a.length - b.length);
    if (candidatas.length) salida.push(...candidatas[0]);
    else salida.push(o);
  }
  for (const e of errs) if (e.keyword !== 'oneOf' && !ramas.has(e)) salida.push(e);
  const vistos = new Set();
  return salida
    .map((e) => ({ ruta: ruta(e.instancePath), mensaje: mensajeAjv(e) }))
    .filter((x) => { const k = x.ruta + x.mensaje; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .slice(0, 50);
}

const leerRequisito = (r) => {
  if (typeof r === 'string') return { recurso: r };
  if ('recurso' in r) return { recurso: r.recurso };
  if ('tipo_recurso' in r) return { tipo: r.tipo_recurso, clase: r.clase || 'maquina', cantidad: r.cantidad || 1 };
  return { tipo: r.nombre, clase: r.tipo || 'maquina', cantidad: 1 }; // forma antigua {nombre, tipo}
};
const leerDependencia = (d) => (typeof d === 'string' ? { ref: d, espera_h: 0 } : { ref: d.ref, espera_h: d.espera_h || 0 });

// Recorre el archivo y devuelve la lista plana de partidas, OTs y tareas con su ruta
function aplanar(P) {
  const partidas = [], ots = [], tareas = [];
  P.partidas.forEach((pa, i) => {
    const rp = `proyecto.partidas[${i}]`;
    partidas.push({ d: pa, ruta: rp, orden: i + 1 });
    pa.ots.forEach((ot, j) => {
      const ro = `${rp}.ots[${j}]`;
      ots.push({ d: ot, ruta: ro, partida: pa.ref_externa });
      ot.tareas.forEach((t, k) => tareas.push({ d: t, ruta: `${ro}.tareas[${k}]`, ot: ot.ref_externa, orden: k + 1 }));
    });
  });
  return { partidas, ots, tareas };
}

// Comprobaciones que el esquema no puede hacer: refs repetidas, dependencias rotas o en círculo
function erroresSemanticos(plano) {
  const errores = [];
  for (const [nivel, lista] of [['partida', plano.partidas], ['OT', plano.ots], ['tarea', plano.tareas]]) {
    const vistos = new Map();
    for (const x of lista) {
      const r = x.d.ref_externa;
      if (vistos.has(r)) errores.push({ ruta: `${x.ruta}.ref_externa`, mensaje: `ref_externa «${r}» repetida (ya usada en ${vistos.get(r)})` });
      else vistos.set(r, x.ruta);
    }
  }
  const refs = new Set(plano.tareas.map((x) => x.d.ref_externa));
  const grafo = new Map();
  for (const x of plano.tareas) {
    const deps = (x.d.despues_de || []).map(leerDependencia);
    deps.forEach((d, i) => {
      if (d.ref === x.d.ref_externa) errores.push({ ruta: `${x.ruta}.despues_de[${i}]`, mensaje: 'una tarea no puede ir después de sí misma' });
      else if (!refs.has(d.ref)) errores.push({ ruta: `${x.ruta}.despues_de[${i}]`, mensaje: `la tarea «${d.ref}» no está en el archivo` });
    });
    grafo.set(x.d.ref_externa, deps.map((d) => d.ref).filter((r) => refs.has(r) && r !== x.d.ref_externa));
  }
  // ciclos (búsqueda en profundidad con colores)
  const estado = new Map();
  const rutaDe = new Map(plano.tareas.map((x) => [x.d.ref_externa, x.ruta]));
  const visitar = (n, pila) => {
    estado.set(n, 1);
    for (const m of grafo.get(n) || []) {
      if (estado.get(m) === 1) {
        const ciclo = [...pila.slice(pila.indexOf(m)), m];
        errores.push({ ruta: `${rutaDe.get(n)}.despues_de`, mensaje: `dependencias en círculo: ${ciclo.join(' → ')}` });
        return true;
      }
      if (!estado.get(m) && visitar(m, [...pila, m])) return true;
    }
    estado.set(n, 2);
    return false;
  };
  for (const n of grafo.keys()) if (!estado.get(n) && visitar(n, [n])) break;
  return errores;
}

/* ---------- Importación ---------- */

async function importar(c, archivo, resoluciones, usuario, simular) {
  const P = archivo.proyecto;
  const plano = aplanar(P);
  const avisos = [];
  const errores = [];
  const cambios = [];
  const cuenta = () => ({ crear: 0, actualizar: 0, igual: 0, borrar: 0, baja: 0 });
  const resumen = { partidas: cuenta(), ots: cuenta(), tareas: cuenta(), condiciones: { crear: 0, quitar: 0 }, dependencias: 0 };
  const hoy = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' });

  /* 1 · Proyecto existente: por ref_externa, o uno creado a mano con el mismo código */
  let { rows: [proy] } = await c.query('SELECT * FROM proyectos WHERE ref_externa = $1', [P.ref_externa]);
  let adoptado = false;
  if (!proy && P.codigo) {
    const r = await c.query('SELECT * FROM proyectos WHERE lower(codigo) = lower($1) AND ref_externa IS NULL', [P.codigo]);
    if (r.rows.length) { proy = r.rows[0]; adoptado = true; }
  }

  // Elementos del archivo que ya existen en OTRO proyecto → error (las ref_externa son únicas en todo el sistema)
  const ajenos = async (sql, refs, nivel, lista) => {
    if (!refs.length) return;
    const { rows } = await c.query(sql, [refs]);
    for (const r of rows) {
      if (proy && r.proyecto_id === proy.id) continue;
      const x = lista.find((y) => y.d.ref_externa === r.ref_externa);
      errores.push({ ruta: `${x.ruta}.ref_externa`, mensaje: `«${r.ref_externa}» ya existe como ${nivel} del proyecto ${r.codigo}` });
    }
  };
  await ajenos(`SELECT pa.ref_externa, pa.proyecto_id, p.codigo FROM partidas pa JOIN proyectos p ON p.id = pa.proyecto_id
                 WHERE pa.ref_externa = ANY($1)`, plano.partidas.map((x) => x.d.ref_externa), 'partida', plano.partidas);
  await ajenos(`SELECT o.ref_externa, o.proyecto_id, COALESCE(p.codigo, '(sin proyecto)') AS codigo FROM ordenes o
                  LEFT JOIN proyectos p ON p.id = o.proyecto_id WHERE o.ref_externa = ANY($1)`,
  plano.ots.map((x) => x.d.ref_externa), 'OT', plano.ots);
  await ajenos(`SELECT t.ref_externa, o.proyecto_id, COALESCE(p.codigo, '(sin proyecto)') AS codigo FROM tareas t
                  JOIN ordenes o ON o.id = t.orden_id LEFT JOIN proyectos p ON p.id = o.proyecto_id WHERE t.ref_externa = ANY($1)`,
  plano.tareas.map((x) => x.d.ref_externa), 'tarea', plano.tareas);
  if (errores.length) return { errores };

  /* 2 · Resolver nombres: áreas, tipos de recurso (oficios incluidos) y recursos concretos */
  const areas = (await c.query('SELECT id, nombre, tipo, activo, proyecto_id FROM lineas ORDER BY orden, nombre')).rows;
  const tipos = (await c.query('SELECT id, clase, nombre FROM tipos_recurso ORDER BY lower(nombre)')).rows;
  const recursos = (await c.query('SELECT id, tipo, nombre, activo FROM recursos ORDER BY tipo, nombre')).rows;
  const alias = (await c.query('SELECT clase, nombre, destino_id FROM import_alias')).rows;
  // Áreas que puede usar este proyecto: las fijas y sus propias obras (o las obras sueltas, sin proyecto)
  const areasActivas = areas.filter((a) => a.activo && (a.tipo !== 'obra' || !a.proyecto_id || a.proyecto_id === proy?.id));
  const recursosActivos = recursos.filter((r) => r.activo);
  const aliasDe = (clase, nombre) => alias.find((a) => a.clase === clase && a.nombre === norm(nombre))?.destino_id;
  // Del semillero: requisitos que en realidad son un área (la sierra, el torno…) y herramientas sin control
  const areaPorRequisito = (nombre) => { const id = aliasDe('area_por_tipo', nombre); return areas.some((a) => a.id === id && a.activo) ? id : null; };
  const sinControl = (nombre) => alias.some((a) => a.clase === 'tipo_ignorado' && a.nombre === norm(nombre));
  const areaReq = new Map();   // ref de tarea → área que sale de sus requisitos
  let reqAArea = 0, reqSinControl = 0;

  const resolver = new Map(); // clave → entrada
  const pedir = (clave, base) => {
    if (!resolver.has(clave)) resolver.set(clave, { clave, usos: 0, ...base });
    resolver.get(clave).usos++;
    return clave;
  };
  const nombreObra = `Obra · ${(P.obra || P.nombre).split(/[,(]/)[0].trim()}`.slice(0, 120);

  // Un área por nombre que no existe y es "de obra" (por area_tipo o por el nombre: «Montaje en Obra»)
  // se lleva al área de la obra de este proyecto
  const areaDeObra = (t) => t.area && (t.area_tipo || adivinarTipoArea(t.area)) === 'obra'
    && !areasActivas.some((a) => norm(a.nombre) === norm(t.area)) && !aliasDe('area', t.area);
  const claveArea = (t) => (t.area && !areaDeObra(t) ? `area:${norm(t.area)}` : t.area || t.area_tipo ? `area_tipo:${t.area_tipo || 'obra'}` : null);

  for (const x of plano.tareas) {
    const t = x.d;
    if (t.area && !areaDeObra(t)) pedir(claveArea(t), { clase: 'area', nombre: t.area.trim(), area_tipo: t.area_tipo });
    else if (t.area || t.area_tipo) {
      const tipo = t.area_tipo || 'obra';
      pedir(claveArea(t), { clase: 'area_tipo', nombre: tipo === 'obra' ? nombreObra : tipo, area_tipo: tipo, desde: [] });
      if (t.area && !resolver.get(claveArea(t)).desde.includes(t.area.trim())) resolver.get(claveArea(t)).desde.push(t.area.trim());
    }
    const ops = t.operarios ?? 1;
    if (t.oficio && ops >= 1) pedir(`tipo:operario:${norm(t.oficio)}`, { clase: 'tipo', subclase: 'operario', nombre: t.oficio.trim() });
    for (const r of (t.requiere || []).map(leerRequisito)) {
      if (r.recurso) pedir(`recurso:${norm(r.recurso)}`, { clase: 'recurso', nombre: r.recurso.trim() });
      else if (r.clase !== 'operario' && areaPorRequisito(r.tipo)) { if (!areaReq.has(t.ref_externa)) areaReq.set(t.ref_externa, areaPorRequisito(r.tipo)); reqAArea++; }
      else if (r.clase !== 'operario' && sinControl(r.tipo)) reqSinControl++;
      else pedir(`tipo:${r.clase}:${norm(r.tipo)}`, { clase: 'tipo', subclase: r.clase, nombre: r.tipo.trim() });
    }
  }

  // Decide qué hacer con cada nombre: lo que ya existe se usa sin preguntar; lo demás va a "resolver"
  for (const e of resolver.values()) {
    let existe = null, opciones, defecto, puede;
    if (e.clase === 'area') {
      existe = areasActivas.find((a) => norm(a.nombre) === norm(e.nombre));
      opciones = areasActivas;
      puede = ['crear', 'asociar', 'ignorar'];
      const al = aliasDe('area', e.nombre);
      const sug = masParecido(e.nombre, areasActivas);
      defecto = al && areasActivas.some((a) => a.id === al) ? { accion: 'asociar', id: al, estado: 'recordado' }
        : sug ? { accion: 'asociar', id: sug.id, estado: 'parecido' } : { accion: 'ignorar', estado: 'falta' };
      e.crear_tipo = e.area_tipo || adivinarTipoArea(e.nombre);
    } else if (e.clase === 'area_tipo') {
      const delTipo = areasActivas.filter((a) => a.tipo === e.area_tipo);
      opciones = areasActivas;
      if (e.area_tipo === 'obra') {
        // la obra de este proyecto (reimportación) o una suelta con el mismo nombre
        existe = areasActivas.find((a) => a.tipo === 'obra' && proy && a.proyecto_id === proy.id)
          || areasActivas.find((a) => norm(a.nombre) === norm(e.nombre));
        puede = ['crear', 'asociar', 'ignorar'];
        defecto = { accion: 'crear', estado: 'falta' };
        e.crear_tipo = 'obra';
      } else {
        if (delTipo.length === 1) existe = delTipo[0];
        puede = ['asociar', 'ignorar'];
        const al = aliasDe(`area_tipo:${e.area_tipo}`, e.area_tipo);
        defecto = al && areasActivas.some((a) => a.id === al) ? { accion: 'asociar', id: al, estado: 'recordado' }
          : { accion: 'ignorar', estado: delTipo.length ? 'varias' : 'falta' };
        e.nombre = `Área de tipo «${e.area_tipo}»`;
      }
    } else if (e.clase === 'tipo') {
      const deClase = tipos.filter((t) => t.clase === e.subclase);
      existe = deClase.find((t) => norm(t.nombre) === norm(e.nombre));
      opciones = deClase;
      puede = ['crear', 'asociar', 'ignorar'];
      const al = aliasDe(`tipo:${e.subclase}`, e.nombre);
      const sug = masParecido(e.nombre, deClase);
      defecto = al && deClase.some((t) => t.id === al) ? { accion: 'asociar', id: al, estado: 'recordado' }
        : sug ? { accion: 'asociar', id: sug.id, estado: 'parecido' } : { accion: 'crear', estado: 'falta' };
    } else {
      existe = recursosActivos.find((r) => norm(r.nombre) === norm(e.nombre));
      opciones = recursosActivos.filter((r) => r.tipo !== 'operario');
      puede = ['asociar', 'ignorar'];
      const al = aliasDe('recurso', e.nombre);
      const sug = masParecido(e.nombre, opciones);
      defecto = al && recursosActivos.some((r) => r.id === al) ? { accion: 'asociar', id: al, estado: 'recordado' }
        : sug ? { accion: 'asociar', id: sug.id, estado: 'parecido' } : { accion: 'ignorar', estado: 'falta' };
    }
    if (existe) { e.estado = 'existe'; e.accion = 'usar'; e.id = existe.id; continue; }
    Object.assign(e, defecto, { puede, opciones: opciones.map((o) => ({ id: o.id, nombre: o.nombre, ...(o.tipo ? { tipo: o.tipo } : {}) })) });
    // Lo que el usuario eligió en la vista previa manda
    const elegido = resoluciones[e.clave];
    if (elegido) {
      if (!e.puede.includes(elegido.accion)) throw fallo(400, `Acción no válida para «${e.nombre}»`);
      if (elegido.accion === 'asociar' && !e.opciones.some((o) => o.id === Number(elegido.id))) {
        throw fallo(400, `Destino no válido para «${e.nombre}»`);
      }
      e.accion = elegido.accion;
      e.id = elegido.accion === 'asociar' ? Number(elegido.id) : undefined;
      e.elegido = true;
    } else if (e.accion !== 'asociar') delete e.id;
  }

  // Aplica crear / asociar (recordando la asociación) y deja en cada entrada el id final o null
  const nombreTipo = new Map(tipos.map((t) => [t.id, t.nombre]));
  const nombreRecurso = new Map(recursos.map((r) => [r.id, r.nombre]));
  const nombreArea = new Map(areas.map((a) => [a.id, a.nombre]));
  for (const e of resolver.values()) {
    if (e.accion === 'usar') { e.final = e.id; continue; }
    if (e.accion === 'ignorar') {
      e.final = null;
      const claseAlias = e.clase === 'tipo' ? `tipo:${e.subclase}` : e.clase === 'area_tipo' ? `area_tipo:${e.area_tipo}` : e.clase;
      if (e.estado === 'recordado') await c.query('DELETE FROM import_alias WHERE clase = $1 AND nombre = $2', [claseAlias, norm(e.nombre)]);
      continue;
    }
    if (e.accion === 'asociar') {
      e.final = e.id;
      const claseAlias = e.clase === 'tipo' ? `tipo:${e.subclase}` : e.clase === 'area_tipo' ? `area_tipo:${e.area_tipo}` : e.clase;
      if (!(e.clase === 'area_tipo' && e.area_tipo === 'obra')) {
        await c.query(
          `INSERT INTO import_alias (clase, nombre, destino_id) VALUES ($1, $2, $3)
           ON CONFLICT (clase, nombre) DO UPDATE SET destino_id = EXCLUDED.destino_id, creado = now()`,
          [claseAlias, norm(e.nombre), e.id]);
      }
      continue;
    }
    // crear
    if (e.clase === 'tipo') {
      const { rows } = await c.query('INSERT INTO tipos_recurso (clase, nombre) VALUES ($1, $2) RETURNING id', [e.subclase, e.nombre]);
      e.final = rows[0].id;
      nombreTipo.set(e.final, e.nombre);
    } else {
      const inactiva = areas.find((a) => !a.activo && norm(a.nombre) === norm(e.nombre));
      if (inactiva) {
        await c.query('UPDATE lineas SET activo = TRUE WHERE id = $1', [inactiva.id]);
        e.final = inactiva.id;
        e.reactivada = true;
      } else {
        const tipo = TIPOS_AREA.includes(e.crear_tipo) ? e.crear_tipo : 'otro';
        // el nombre de un área es único: si ya lo usa otra (p. ej. la obra de otro proyecto en el mismo sitio), se le añade el código
        if (areas.some((a) => norm(a.nombre) === norm(e.nombre))) e.nombre = `${e.nombre} (${P.codigo || P.ref_externa})`.slice(0, 120);
        const { rows } = await c.query(
          `INSERT INTO lineas (nombre, tipo, ubicacion, orden, proyecto_id)
           VALUES ($1, $2, $3, COALESCE((SELECT max(orden) FROM lineas), 0) + 1, $4) RETURNING id`,
          [e.nombre, tipo, tipo === 'obra' ? P.obra || null : null, tipo === 'obra' ? proy?.id ?? null : null]);
        e.final = rows[0].id;
      }
      nombreArea.set(e.final, e.nombre);
    }
  }
  const idDe = (clave) => resolver.get(clave)?.final ?? null;

  /* 3 · Proyecto */
  const codigoLibre = async (tabla, codigo, propioId) => {
    if (!codigo) return false;
    const { rows } = await c.query(`SELECT id FROM ${tabla} WHERE lower(codigo) = lower($1) AND id <> $2`, [codigo, propioId || 0]);
    return !rows.length;
  };
  const siguienteCodigo = async (prefijo) => {
    const tabla = prefijo === 'OT' ? 'ordenes' : 'proyectos';
    const { rows } = await c.query(
      `SELECT COALESCE(max(substring(codigo FROM '^${prefijo}-(\\d+)$')::int), 0) + 1 AS n FROM ${tabla}`);
    return `${prefijo}-${String(rows[0].n).padStart(prefijo === 'OT' ? 4 : 3, '0')}`;
  };
  const datosProyecto = { nombre: P.nombre.trim(), cliente: P.cliente || null, obra: P.obra || null, notas: P.notas || null, extra: P.extra || null };
  let accionProyecto;
  if (!proy) {
    let codigo = P.codigo;
    if (!(await codigoLibre('proyectos', codigo))) {
      if (codigo) avisos.push({ ruta: 'proyecto.codigo', mensaje: `El código «${codigo}» ya lo usa otro proyecto: se asigna otro` });
      codigo = await siguienteCodigo('PR');
    }
    ({ rows: [proy] } = await c.query(
      `INSERT INTO proyectos (codigo, nombre, cliente, obra, notas, extra, ref_externa)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [codigo, datosProyecto.nombre, datosProyecto.cliente, datosProyecto.obra, datosProyecto.notas, datosProyecto.extra, P.ref_externa]));
    accionProyecto = 'crear';
  } else {
    const campos = diferencias(proy, datosProyecto);
    let codigo = proy.codigo;
    if (P.codigo && P.codigo !== proy.codigo) {
      if (await codigoLibre('proyectos', P.codigo, proy.id)) { campos.codigo = [proy.codigo, P.codigo]; codigo = P.codigo; }
      else avisos.push({ ruta: 'proyecto.codigo', mensaje: `El código «${P.codigo}» ya lo usa otro proyecto: se mantiene ${proy.codigo}` });
    }
    await c.query(
      `UPDATE proyectos SET codigo = $2, nombre = $3, cliente = $4, obra = $5, notas = $6, extra = $7, ref_externa = $8 WHERE id = $1`,
      [proy.id, codigo, datosProyecto.nombre, datosProyecto.cliente, datosProyecto.obra, datosProyecto.notas, datosProyecto.extra, P.ref_externa]);
    proy.codigo = codigo;
    accionProyecto = Object.keys(campos).length || adoptado ? 'actualizar' : 'igual';
    if (adoptado) avisos.push({ ruta: 'proyecto', mensaje: `Se asocia al proyecto ${proy.codigo}, creado a mano con el mismo código` });
    if (Object.keys(campos).length) cambios.push({ nivel: 'proyecto', accion: 'actualizar', ref: P.ref_externa, nombre: P.nombre, campos });
  }

  // Las áreas de obra que usa el archivo pasan a ser de este proyecto
  const obrasUsadas = [...resolver.values()].filter((e) => e.final && (e.clase === 'area' || e.clase === 'area_tipo')).map((e) => e.final);
  if (obrasUsadas.length) {
    await c.query(`UPDATE lineas SET proyecto_id = $1, ubicacion = COALESCE(ubicacion, $3)
                    WHERE id = ANY($2) AND tipo = 'obra' AND proyecto_id IS NULL`, [proy.id, obrasUsadas, P.obra || null]);
  }

  /* 4 · Condiciones previas (se conserva la marca de las que ya estaban) */
  {
    const { rows: act } = await c.query('SELECT id, texto FROM proyecto_condiciones WHERE proyecto_id = $1', [proy.id]);
    const quedan = new Set();
    for (const [i, texto] of (P.condiciones || []).entries()) {
      const ya = act.find((x) => norm(x.texto) === norm(texto) && !quedan.has(x.id));
      if (ya) {
        quedan.add(ya.id);
        await c.query('UPDATE proyecto_condiciones SET texto = $2, orden = $3 WHERE id = $1', [ya.id, texto.trim(), i + 1]);
      } else {
        await c.query('INSERT INTO proyecto_condiciones (proyecto_id, texto, orden) VALUES ($1,$2,$3)', [proy.id, texto.trim(), i + 1]);
        resumen.condiciones.crear++;
      }
    }
    for (const x of act) {
      if (!quedan.has(x.id)) {
        await c.query('DELETE FROM proyecto_condiciones WHERE id = $1', [x.id]);
        resumen.condiciones.quitar++;
      }
    }
  }

  /* 5 · Partidas */
  const idPartida = new Map();
  for (const x of plano.partidas) {
    const pa = x.d;
    const nuevo = { codigo: pa.codigo || null, nombre: pa.nombre.trim(), orden: x.orden, extra: pa.extra || null, baja_presupuesto: false };
    const { rows: [ya] } = await c.query('SELECT * FROM partidas WHERE ref_externa = $1', [pa.ref_externa]);
    if (!ya) {
      const { rows } = await c.query(
        `INSERT INTO partidas (proyecto_id, codigo, nombre, orden, extra, ref_externa) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [proy.id, nuevo.codigo, nuevo.nombre, nuevo.orden, nuevo.extra, pa.ref_externa]);
      idPartida.set(pa.ref_externa, rows[0].id);
      resumen.partidas.crear++;
      cambios.push({ nivel: 'partida', accion: 'crear', ref: pa.ref_externa, codigo: nuevo.codigo, nombre: nuevo.nombre });
    } else {
      idPartida.set(pa.ref_externa, ya.id);
      const campos = diferencias(ya, nuevo);
      await c.query('UPDATE partidas SET codigo = $2, nombre = $3, orden = $4, extra = $5, baja_presupuesto = FALSE WHERE id = $1',
        [ya.id, nuevo.codigo, nuevo.nombre, nuevo.orden, nuevo.extra]);
      registrar('partidas', 'partida', pa.ref_externa, nuevo.codigo, nuevo.nombre, campos);
    }
  }

  /* 6 · OTs */
  const idOT = new Map();
  const { rows: [{ n: nOTs }] } = await c.query('SELECT count(*)::int AS n FROM ordenes');
  let colorSig = nOTs;
  for (const x of plano.ots) {
    const ot = x.d;
    const nuevo = {
      titulo: ot.titulo.trim(), descripcion: ot.descripcion || null, partida_id: idPartida.get(x.partida), proyecto_id: proy.id,
      prioridad: PRIORIDAD[ot.prioridad || 'normal'], fecha_entrega: ot.fecha_entrega || null, extra: ot.extra || null,
      baja_presupuesto: false,
    };
    if (ot.color) nuevo.color = ot.color;
    if (ot.fecha_entrega && ot.fecha_entrega < hoy) avisos.push({ ruta: `${x.ruta}.fecha_entrega`, mensaje: `La fecha de entrega ${ot.fecha_entrega} ya ha pasado` });
    const { rows: [ya] } = await c.query('SELECT * FROM ordenes WHERE ref_externa = $1', [ot.ref_externa]);
    if (!ya) {
      let codigo = ot.codigo;
      if (!(await codigoLibre('ordenes', codigo))) {
        if (codigo) avisos.push({ ruta: `${x.ruta}.codigo`, mensaje: `El código «${codigo}» ya lo usa otra OT: se asigna otro` });
        codigo = await siguienteCodigo('OT');
      }
      const { rows } = await c.query(
        `INSERT INTO ordenes (codigo, titulo, descripcion, partida_id, proyecto_id, prioridad, fecha_entrega, color, extra, ref_externa)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [codigo, nuevo.titulo, nuevo.descripcion, nuevo.partida_id, proy.id, nuevo.prioridad, nuevo.fecha_entrega,
          nuevo.color || COLORES[colorSig++ % COLORES.length], nuevo.extra, ot.ref_externa]);
      idOT.set(ot.ref_externa, rows[0].id);
      resumen.ots.crear++;
      cambios.push({ nivel: 'ot', accion: 'crear', ref: ot.ref_externa, codigo, nombre: nuevo.titulo });
    } else {
      idOT.set(ot.ref_externa, ya.id);
      const campos = diferencias(ya, nuevo);
      let codigo = ya.codigo;
      if (ot.codigo && ot.codigo !== ya.codigo) {
        if (await codigoLibre('ordenes', ot.codigo, ya.id)) { campos.codigo = [ya.codigo, ot.codigo]; codigo = ot.codigo; }
        else avisos.push({ ruta: `${x.ruta}.codigo`, mensaje: `El código «${ot.codigo}» ya lo usa otra OT: se mantiene ${ya.codigo}` });
      }
      await c.query(
        `UPDATE ordenes SET codigo = $2, titulo = $3, descripcion = $4, partida_id = $5, proyecto_id = $6, prioridad = $7,
                fecha_entrega = $8, color = COALESCE($9, color), extra = $10, baja_presupuesto = FALSE WHERE id = $1`,
        [ya.id, codigo, nuevo.titulo, nuevo.descripcion, nuevo.partida_id, proy.id, nuevo.prioridad, nuevo.fecha_entrega,
          nuevo.color || null, nuevo.extra]);
      registrar('ots', 'ot', ot.ref_externa, codigo, nuevo.titulo, campos);
    }
  }

  /* 7 · Tareas, requisitos y dependencias */
  const idTarea = new Map();
  const { rows: existentes } = await c.query(
    `SELECT t.*,
            COALESCE((SELECT sum(x.duracion_h) FROM tramos x WHERE x.tarea_id = t.id), 0)::float AS planificadas,
            COALESCE((SELECT string_agg(tp.nombre || ' ×' || q.cantidad, ', ' ORDER BY lower(tp.nombre))
                        FROM tarea_requisitos_tipo q JOIN tipos_recurso tp ON tp.id = q.tipo_recurso_id
                       WHERE q.tarea_id = t.id), '') AS req_tipo_txt,
            COALESCE((SELECT string_agg(r.nombre, ', ' ORDER BY lower(r.nombre))
                        FROM tarea_requisitos q JOIN recursos r ON r.id = q.recurso_id WHERE q.tarea_id = t.id), '') AS req_rec_txt,
            COALESCE((SELECT string_agg(p.ref_externa || '+' || d.espera_h, ', ' ORDER BY p.ref_externa)
                        FROM tarea_dependencias d JOIN tareas p ON p.id = d.depende_de_id WHERE d.tarea_id = t.id), '') AS dep_txt
       FROM tareas t WHERE t.ref_externa = ANY($1)`, [plano.tareas.map((x) => x.d.ref_externa)]);
  const previa = new Map(existentes.map((t) => [t.ref_externa, t]));

  for (const x of plano.tareas) {
    const t = x.d;
    const ops = t.operarios ?? 1;
    const areaClave = claveArea(t);
    // un área concreta y existente manda; si no, la que sale de los requisitos (p. ej. «Sierra de cinta» → Sierra semiautomática 1)
    const areaExacta = areaClave?.startsWith('area:') && resolver.get(areaClave)?.accion === 'usar';
    const lineaId = (!areaExacta && areaReq.get(t.ref_externa)) || (areaClave ? idDe(areaClave) : null);
    // requisitos: oficio → "operarios × oficio"; requiere → tipos (con cantidad) y recursos concretos
    const reqTipo = new Map(), reqRec = new Set();
    if (t.oficio && ops >= 1) {
      const id = idDe(`tipo:operario:${norm(t.oficio)}`);
      if (id) reqTipo.set(id, Math.max(reqTipo.get(id) || 0, Math.min(ops, 50)));
    }
    for (const r of (t.requiere || []).map(leerRequisito)) {
      if (r.recurso) {
        const id = idDe(`recurso:${norm(r.recurso)}`);
        if (id) reqRec.add(id);
      } else if (resolver.has(`tipo:${r.clase}:${norm(r.tipo)}`)) {
        const id = idDe(`tipo:${r.clase}:${norm(r.tipo)}`);
        if (id) reqTipo.set(id, Math.max(reqTipo.get(id) || 0, r.cantidad));
      }
    }
    if (ops === 0 && !(t.requiere || []).length) avisos.push({ ruta: x.ruta, mensaje: `«${t.nombre}» no tiene operarios ni requisitos: nadie la hace` });

    const nuevo = {
      orden_id: idOT.get(x.ot), nombre: t.nombre.trim(), duracion_h: t.horas, operarios_req: ops, orden_en_of: x.orden,
      notas: t.notas || null, extra: t.extra || null, baja_presupuesto: false,
    };
    // Si el área no se pudo resolver, se deja la que tenga (puesta a mano)
    if (lineaId || !previa.has(t.ref_externa)) nuevo.linea_id = lineaId;
    const ya = previa.get(t.ref_externa);
    let id;
    if (!ya) {
      const { rows } = await c.query(
        `INSERT INTO tareas (orden_id, nombre, duracion_h, operarios_req, linea_id, orden_en_of, notas, extra, ref_externa, actualizado_por)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [nuevo.orden_id, nuevo.nombre, nuevo.duracion_h, ops, lineaId, x.orden, nuevo.notas, nuevo.extra, t.ref_externa, usuario.id]);
      id = rows[0].id;
      resumen.tareas.crear++;
      cambios.push({ nivel: 'tarea', accion: 'crear', ref: t.ref_externa, nombre: nuevo.nombre, horas: t.horas, ot: x.ot });
      await c.query('INSERT INTO historial (usuario_id, tarea_id, accion, detalle) VALUES ($1,$2,$3,$4)',
        [usuario.id, id, 'importar', { ref_externa: t.ref_externa }]);
    } else {
      id = ya.id;
      const campos = diferencias(ya, nuevo, { linea_id: (v) => (v ? nombreArea.get(v) || `#${v}` : '—'), orden_id: () => null, orden_en_of: () => null });
      delete campos.orden_id; delete campos.orden_en_of;
      if (ya.orden_id !== nuevo.orden_id) campos.ot = ['otra OT', x.ot];
      const reqTxt = [...reqTipo].map(([k, n]) => `${nombreTipo.get(k)} ×${n}`).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).join(', ');
      if (norm(reqTxt) !== norm(ya.req_tipo_txt)) campos.tipos = [ya.req_tipo_txt || '—', reqTxt || '—'];
      const recTxt = [...reqRec].map((k) => nombreRecurso.get(k)).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })).join(', ');
      if (norm(recTxt) !== norm(ya.req_rec_txt)) campos.recursos = [ya.req_rec_txt || '—', recTxt || '—'];
      const depTxt = (t.despues_de || []).map(leerDependencia).map((d) => `${d.ref}+${d.espera_h}`).sort().join(', ');
      const depAntes = ya.dep_txt.split(', ').filter(Boolean).map((s) => s.replace(/\+(\d+(\.\d+)?)$/, (m, n) => `+${Number(n)}`)).sort().join(', ');
      if (depTxt !== depAntes) campos.dependencias = [depAntes.split(', ').filter(Boolean).length, (t.despues_de || []).length];
      const s = Object.keys(nuevo);
      await c.query(`UPDATE tareas SET ${s.map((k, i) => `${k} = $${i + 2}`).join(', ')}, actualizado = now(), actualizado_por = $${s.length + 2} WHERE id = $1`,
        [id, ...s.map((k) => nuevo[k]), usuario.id]);
      registrar('tareas', 'tarea', t.ref_externa, null, nuevo.nombre, campos);
      if (ya.planificadas > t.horas) {
        avisos.push({ ruta: `${x.ruta}.horas`, mensaje: `«${t.nombre}»: pasa a ${fmtH(t.horas)} pero ya tiene ${fmtH(ya.planificadas)} planificadas (se verá como exceso)` });
      }
    }
    idTarea.set(t.ref_externa, id);
    await c.query('DELETE FROM tarea_requisitos_tipo WHERE tarea_id = $1', [id]);
    await c.query('DELETE FROM tarea_requisitos WHERE tarea_id = $1', [id]);
    for (const [tipoId, cantidad] of reqTipo) {
      await c.query('INSERT INTO tarea_requisitos_tipo (tarea_id, tipo_recurso_id, cantidad) VALUES ($1,$2,$3)', [id, tipoId, cantidad]);
    }
    for (const recId of reqRec) await c.query('INSERT INTO tarea_requisitos (tarea_id, recurso_id) VALUES ($1,$2)', [id, recId]);
  }
  const idsArchivo = [...idTarea.values()];
  await c.query('DELETE FROM tarea_dependencias WHERE tarea_id = ANY($1)', [idsArchivo]);
  for (const x of plano.tareas) {
    for (const d of (x.d.despues_de || []).map(leerDependencia)) {
      await c.query('INSERT INTO tarea_dependencias (tarea_id, depende_de_id, espera_h) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
        [idTarea.get(x.d.ref_externa), idTarea.get(d.ref), d.espera_h]);
      resumen.dependencias++;
    }
  }

  /* 8 · Lo que ya no está en el archivo: se borra si no tiene planificación; si no, se marca */
  const refsT = plano.tareas.map((x) => x.d.ref_externa);
  const { rows: huerfanas } = await c.query(
    `SELECT t.id, t.ref_externa, t.nombre, t.estado, t.baja_presupuesto,
            COALESCE((SELECT sum(x.duracion_h) FROM tramos x WHERE x.tarea_id = t.id), 0)::float AS planificadas
       FROM tareas t JOIN ordenes o ON o.id = t.orden_id
      WHERE o.proyecto_id = $1 AND t.ref_externa IS NOT NULL AND NOT (t.ref_externa = ANY($2))`, [proy.id, refsT]);
  for (const t of huerfanas) {
    if (t.estado === 'pendiente' && !t.planificadas) {
      await c.query('DELETE FROM tareas WHERE id = $1', [t.id]);
      resumen.tareas.borrar++;
      cambios.push({ nivel: 'tarea', accion: 'borrar', ref: t.ref_externa, nombre: t.nombre });
    } else {
      if (!t.baja_presupuesto) await c.query('UPDATE tareas SET baja_presupuesto = TRUE WHERE id = $1', [t.id]);
      resumen.tareas.baja++;
      cambios.push({ nivel: 'tarea', accion: 'baja', ref: t.ref_externa, nombre: t.nombre });
      avisos.push({ ruta: t.ref_externa, mensaje: `«${t.nombre}» ya no está en el presupuesto pero tiene ${fmtH(t.planificadas)} planificadas${t.estado !== 'pendiente' ? ` y está ${t.estado.replace('_', ' ')}` : ''}: se conserva marcada` });
    }
  }
  for (const [tabla, nivel, hijos, refs] of [
    ['ordenes', 'ot', 'SELECT 1 FROM tareas WHERE orden_id = $1', plano.ots.map((x) => x.d.ref_externa)],
    ['partidas', 'partida', 'SELECT 1 FROM ordenes WHERE partida_id = $1', plano.partidas.map((x) => x.d.ref_externa)],
  ]) {
    const { rows } = await c.query(
      `SELECT id, ref_externa, ${tabla === 'ordenes' ? 'titulo' : 'nombre'} AS nombre, baja_presupuesto FROM ${tabla}
        WHERE proyecto_id = $1 AND ref_externa IS NOT NULL AND NOT (ref_externa = ANY($2))`, [proy.id, refs]);
    const clave = nivel === 'ot' ? 'ots' : 'partidas';
    for (const r of rows) {
      const { rows: h } = await c.query(hijos, [r.id]);
      if (!h.length) {
        await c.query(`DELETE FROM ${tabla} WHERE id = $1`, [r.id]);
        resumen[clave].borrar++;
        cambios.push({ nivel, accion: 'borrar', ref: r.ref_externa, nombre: r.nombre });
      } else {
        if (!r.baja_presupuesto) await c.query(`UPDATE ${tabla} SET baja_presupuesto = TRUE WHERE id = $1`, [r.id]);
        resumen[clave].baja++;
        cambios.push({ nivel, accion: 'baja', ref: r.ref_externa, nombre: r.nombre });
      }
    }
  }

  // Avisos de nombres sin resolver
  for (const e of resolver.values()) {
    if (e.accion !== 'ignorar') continue;
    const que = e.clase === 'recurso' ? `El recurso «${e.nombre}»` : e.clase === 'tipo' ? `El tipo «${e.nombre}»`
      : e.clase === 'area' ? `El área «${e.nombre}»` : e.nombre;
    avisos.push({ ruta: e.clave, mensaje: `${que} no se asigna (${e.usos} tarea${e.usos === 1 ? '' : 's'} sin ${e.clase === 'area' || e.clase === 'area_tipo' ? 'área' : 'ese requisito'})` });
  }

  const horas = plano.tareas.reduce((s, x) => s + x.d.horas, 0);
  const hp = plano.tareas.reduce((s, x) => s + x.d.horas * (x.d.operarios ?? 1), 0);
  const informe = {
    proyecto: { accion: accionProyecto, id: simular ? undefined : proy.id, codigo: proy.codigo, nombre: P.nombre, ref_externa: P.ref_externa },
    resumen: { ...resumen, horas, horas_persona: hp, requisitos_a_area: reqAArea, requisitos_sin_control: reqSinControl },
    cambios,
    resolver: [...resolver.values()].filter((e) => e.accion !== 'usar').map(({ final, crear_tipo, ...e }) => e),
    usados: [...resolver.values()].filter((e) => e.accion === 'usar').map((e) => ({ clave: e.clave, clase: e.clase, subclase: e.subclase, nombre: e.nombre, id: e.id })),
    avisos,
    errores: [],
  };
  if (!simular) {
    const { rows } = await c.query(
      `INSERT INTO importaciones (proyecto_id, ref_externa, usuario_id, origen, resumen, archivo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [proy.id, P.ref_externa, usuario.id, archivo.origen || null, informe.resumen, archivo]);
    informe.importacion_id = rows[0].id;
  }
  return informe;

  // Cuenta y anota un elemento existente según haya cambiado o no
  function registrar(clave, nivel, ref, codigo, nombre, campos) {
    if (Object.keys(campos).length) {
      resumen[clave].actualizar++;
      cambios.push({ nivel, accion: 'actualizar', ref, codigo: codigo || undefined, nombre, campos });
    } else resumen[clave].igual++;
  }
}

const fmtH = (h) => `${String(Math.round(h * 10) / 10).replace('.', ',')} h`;

// JSON con las claves ordenadas (jsonb no conserva el orden de las claves)
const estable = (v) => (v && typeof v === 'object'
  ? Array.isArray(v) ? `[${v.map(estable).join(',')}]`
    : `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${estable(v[k])}`).join(',')}}`
  : JSON.stringify(v));

// Campos que cambian entre la fila actual y los datos nuevos → { campo: [antes, después] }
function diferencias(fila, nuevo, mostrar = {}) {
  const out = {};
  const igual = (a, b) => {
    if (a == null && b == null) return true;
    if (typeof a === 'object' || typeof b === 'object') return estable(a ?? null) === estable(b ?? null);
    if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
    return String(a ?? '') === String(b ?? '');
  };
  for (const k of Object.keys(nuevo)) {
    if (k === 'extra' || k === 'baja_presupuesto' || k === 'proyecto_id') continue;
    if (!igual(fila[k], nuevo[k])) out[k] = mostrar[k] ? [mostrar[k](fila[k]), mostrar[k](nuevo[k])] : [fila[k] ?? null, nuevo[k] ?? null];
  }
  if (!igual(fila.extra, nuevo.extra) && 'extra' in nuevo) out.extra = ['…', '…'];
  return out;
}

module.exports = function montar(app, asyncH) {
  app.post('/api/importar', auth.puedeEditar, asyncH(async (req, res) => {
    const b = req.body || {};
    const archivo = b.formato || !b.archivo ? b : b.archivo;
    const resoluciones = (b.archivo && b.resoluciones && typeof b.resoluciones === 'object') ? b.resoluciones : {};
    const simular = ['1', 'true', 'si'].includes(String(req.query.simular || '').toLowerCase());
    const base = { ok: false, simulado: simular };

    if (!archivo || typeof archivo !== 'object' || Array.isArray(archivo)) {
      return res.json({ ...base, errores: [{ ruta: '(raíz)', mensaje: 'El archivo no es un objeto JSON' }] });
    }
    if (!validarEsquema(archivo)) {
      return res.json({ ...base, errores: erroresEsquema(validarEsquema.errors) });
    }
    const sem = erroresSemanticos(aplanar(archivo.proyecto));
    if (sem.length) return res.json({ ...base, errores: sem.slice(0, 50) });

    const c = await pool.connect();
    try {
      await c.query('BEGIN');
      // una importación a la vez (evita dos códigos iguales si dos personas importan a la vez)
      await c.query('SELECT pg_advisory_xact_lock(360360)');
      const informe = await importar(c, archivo, resoluciones, req.usuario, simular);
      if (informe.errores?.length || simular) await c.query('ROLLBACK');
      else await c.query('COMMIT');
      res.json({ ...base, ...informe, ok: !informe.errores?.length });
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }));

  // Historial de importaciones de un proyecto
  app.get('/api/importaciones', asyncH(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT i.id, i.proyecto_id, i.ref_externa, i.origen, i.resumen, i.creado, u.nombre AS usuario
         FROM importaciones i LEFT JOIN usuarios u ON u.id = i.usuario_id
        WHERE ($1::int IS NULL OR i.proyecto_id = $1) ORDER BY i.creado DESC LIMIT 50`,
      [req.query.proyecto_id ? Number(req.query.proyecto_id) : null]);
    res.json(rows);
  }));
};

module.exports._interno = { norm, parecido, erroresEsquema, erroresSemanticos, aplanar, validarEsquema };
