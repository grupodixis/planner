// Migraciones idempotentes que se aplican al arrancar.
// Permiten actualizar una base de datos ya creada sin perder datos.
const { query } = require('./db');
const { jornada } = require('./config');

const MIGRACIONES = [
  // 2026-11 · Áreas de trabajo (antes "líneas" fijas del calendario)
  `ALTER TABLE lineas ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'taller'`,
  `ALTER TABLE lineas ADD COLUMN IF NOT EXISTS ubicacion TEXT`,
  `ALTER TABLE lineas ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE`,
  `UPDATE lineas SET tipo = 'transporte' WHERE nombre = 'Transporte' AND tipo = 'taller'`,
  `UPDATE lineas SET tipo = 'obra' WHERE nombre = 'Obra montaje' AND tipo = 'taller'`,

  // 2026-11 · OF y OM se unifican en OT (orden de trabajo), con color propio
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS color TEXT`,
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ordenes' AND column_name = 'tipo') THEN
       UPDATE ordenes SET color = CASE WHEN tipo = 'OM' THEN '#e08a2a' ELSE '#5aa9f0' END
        WHERE color IS NULL;
       -- OF-1565 -> OT-1565 (solo si el número no choca con otra orden)
       UPDATE ordenes o SET codigo = 'OT-' || substring(o.codigo FROM 4)
        WHERE o.codigo ~ '^(OF|OM)-'
          AND (SELECT count(*) FROM ordenes y
                WHERE y.codigo ~ '^(OF|OM|OT)-' AND substring(y.codigo FROM 4) = substring(o.codigo FROM 4)) = 1;
       ALTER TABLE ordenes DROP COLUMN tipo;
     END IF;
   END $$`,
  `UPDATE ordenes SET color = '#5aa9f0' WHERE color IS NULL`,
  `ALTER TABLE ordenes ALTER COLUMN color SET DEFAULT '#5aa9f0'`,
  `ALTER TABLE ordenes ALTER COLUMN color SET NOT NULL`,
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS descripcion TEXT`,
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS fecha_entrega DATE`,
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS creado TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS nombre TEXT`,
  `ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS notas TEXT`,
  `ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS creado TIMESTAMPTZ NOT NULL DEFAULT now()`,
  `UPDATE proyectos SET nombre = COALESCE(cliente, codigo) WHERE nombre IS NULL`,

  // 2026-11 · Tramos: una tarea larga se planifica en varios tramos (días / turnos),
  // cada uno con sus propios recursos asignados
  `CREATE TABLE IF NOT EXISTS tramos (
     id               SERIAL PRIMARY KEY,
     tarea_id         INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
     fecha            DATE NOT NULL,
     hora_inicio      NUMERIC(4,2) NOT NULL,
     duracion_h       NUMERIC(4,1) NOT NULL CHECK (duracion_h > 0),
     linea_id         INT REFERENCES lineas(id),
     creado           TIMESTAMPTZ NOT NULL DEFAULT now(),
     actualizado_por  INT REFERENCES usuarios(id)
   )`,
  `CREATE INDEX IF NOT EXISTS tramos_fecha_idx ON tramos (fecha)`,
  `CREATE INDEX IF NOT EXISTS tramos_tarea_idx ON tramos (tarea_id)`,
  `CREATE TABLE IF NOT EXISTS tramo_asignaciones (
     tramo_id      INT NOT NULL REFERENCES tramos(id) ON DELETE CASCADE,
     recurso_id    INT NOT NULL REFERENCES recursos(id),
     asignado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     asignado_por  INT REFERENCES usuarios(id),
     PRIMARY KEY (tramo_id, recurso_id)
   )`,
  // Pasa la planificación antigua (fecha/hora en la tarea) a un primer tramo que acaba
  // como tarde al fin de jornada; lo que no cabe queda pendiente de planificar.
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'tareas' AND column_name = 'fecha') THEN
       INSERT INTO tramos (tarea_id, fecha, hora_inicio, duracion_h, linea_id)
       SELECT id, fecha, hora_inicio,
              LEAST(duracion_h, GREATEST(floor((${jornada.fin} - hora_inicio) * 2) / 2, 0.5)), linea_id
         FROM tareas WHERE fecha IS NOT NULL AND hora_inicio IS NOT NULL;
       INSERT INTO tramo_asignaciones (tramo_id, recurso_id, asignado, asignado_por)
       SELECT tr.id, a.recurso_id, a.asignado, a.asignado_por
         FROM asignaciones a JOIN tramos tr ON tr.tarea_id = a.tarea_id;
       UPDATE tareas SET estado = 'pendiente' WHERE estado = 'planificada';
       ALTER TABLE tareas DROP COLUMN fecha, DROP COLUMN hora_inicio;
       DROP TABLE asignaciones;
     END IF;
   END $$`,
  `DROP INDEX IF EXISTS tareas_fecha_idx`,

  // 2026-11 · Franja de cada recurso dentro del tramo (NULL = todo el tramo)
  `ALTER TABLE tramo_asignaciones ADD COLUMN IF NOT EXISTS desde NUMERIC(4,2)`,
  `ALTER TABLE tramo_asignaciones ADD COLUMN IF NOT EXISTS hasta NUMERIC(4,2)`,

  // 2026-11 · Fichas de recursos (operarios, maquinaria, subcontratas / alquileres)
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS codigo TEXT`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS categoria TEXT`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS empresa TEXT`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS telefono TEXT`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS email TEXT`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS coste_hora NUMERIC(8,2)`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS linea_id INT REFERENCES lineas(id)`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS notas TEXT`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS creado TIMESTAMPTZ NOT NULL DEFAULT now()`,

  // 2026-11 · Partidas: nivel propio entre proyecto y OT (antes, texto libre en la OT)
  `CREATE TABLE IF NOT EXISTS partidas (
     id           SERIAL PRIMARY KEY,
     proyecto_id  INT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
     codigo       TEXT,                     -- código del presupuesto (p. ej. C4.001)
     nombre       TEXT NOT NULL,
     orden        INT NOT NULL DEFAULT 0,
     ref_externa  TEXT,                     -- id. en el compositor (importación)
     creado       TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS partidas_proyecto_idx ON partidas (proyecto_id)`,
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS partida_id INT REFERENCES partidas(id) ON DELETE SET NULL`,
  // Los textos de partida de cada OT pasan a ser partidas reales de su proyecto
  // (las que se escriben igual, sin distinguir mayúsculas ni espacios, se juntan)
  `DO $$ BEGIN
     IF EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'ordenes' AND column_name = 'partida') THEN
       INSERT INTO partidas (proyecto_id, nombre, orden)
       SELECT proyecto_id, min(btrim(partida)), row_number() OVER (PARTITION BY proyecto_id ORDER BY min(id))
         FROM ordenes
        WHERE proyecto_id IS NOT NULL AND btrim(COALESCE(partida, '')) <> ''
        GROUP BY proyecto_id, lower(regexp_replace(btrim(partida), '\\s+', ' ', 'g'));
       UPDATE ordenes o SET partida_id = pa.id
         FROM partidas pa
        WHERE pa.proyecto_id = o.proyecto_id
          AND lower(regexp_replace(btrim(pa.nombre), '\\s+', ' ', 'g')) = lower(regexp_replace(btrim(o.partida), '\\s+', ' ', 'g'));
       ALTER TABLE ordenes DROP COLUMN partida;
     END IF;
   END $$`,

  // 2026-11 · Tipos de recurso (oficios, tipos de máquina, tipos de subcontrata/alquiler).
  // Una tarea puede requerir un tipo («una Soldadora MIG») aunque no estén todas las
  // máquinas dadas de alta; un recurso puede tener varios tipos (un operario, varios oficios).
  `CREATE TABLE IF NOT EXISTS tipos_recurso (
     id      SERIAL PRIMARY KEY,
     clase   TEXT NOT NULL CHECK (clase IN ('operario', 'maquina', 'subcontrata')),
     nombre  TEXT NOT NULL,
     creado  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tipos_recurso_nombre_idx ON tipos_recurso (clase, lower(nombre))`,
  `CREATE TABLE IF NOT EXISTS recurso_tipos (
     recurso_id      INT NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
     tipo_recurso_id INT NOT NULL REFERENCES tipos_recurso(id) ON DELETE CASCADE,
     PRIMARY KEY (recurso_id, tipo_recurso_id)
   )`,
  `CREATE TABLE IF NOT EXISTS tarea_requisitos_tipo (
     tarea_id        INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
     tipo_recurso_id INT NOT NULL REFERENCES tipos_recurso(id),
     cantidad        INT NOT NULL DEFAULT 1 CHECK (cantidad BETWEEN 1 AND 50),
     PRIMARY KEY (tarea_id, tipo_recurso_id)
   )`,
  // Las categorías escritas en las fichas de operarios y máquinas pasan a ser tipos
  // («Administrativo · Resp. Administrativa» → dos oficios). En subcontratas la categoría
  // sigue siendo la clase (Subcontrata / Alquiler) y no se convierte.
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM tipos_recurso) AND NOT EXISTS (SELECT 1 FROM recurso_tipos) THEN
       INSERT INTO tipos_recurso (clase, nombre)
       SELECT DISTINCT ON (r.tipo, lower(btrim(x))) r.tipo, btrim(x)
         FROM recursos r, regexp_split_to_table(r.categoria, '\\s*·\\s*') AS x
        WHERE r.tipo IN ('operario', 'maquina') AND btrim(COALESCE(x, '')) <> ''
        ORDER BY r.tipo, lower(btrim(x)), btrim(x);
       INSERT INTO recurso_tipos (recurso_id, tipo_recurso_id)
       SELECT DISTINCT r.id, t.id
         FROM recursos r, regexp_split_to_table(r.categoria, '\\s*·\\s*') AS x, tipos_recurso t
        WHERE r.tipo IN ('operario', 'maquina') AND t.clase = r.tipo AND lower(t.nombre) = lower(btrim(x));
     END IF;
   END $$`,

  // 2026-11 · Importación de proyectos (formato s360-import/1, ver docs/importacion)
  `ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS ref_externa TEXT`,
  `ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS extra JSONB`,
  `ALTER TABLE partidas  ADD COLUMN IF NOT EXISTS extra JSONB`,
  `ALTER TABLE partidas  ADD COLUMN IF NOT EXISTS baja_presupuesto BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE ordenes   ADD COLUMN IF NOT EXISTS ref_externa TEXT`,
  `ALTER TABLE ordenes   ADD COLUMN IF NOT EXISTS extra JSONB`,
  `ALTER TABLE ordenes   ADD COLUMN IF NOT EXISTS baja_presupuesto BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE tareas    ADD COLUMN IF NOT EXISTS ref_externa TEXT`,
  `ALTER TABLE tareas    ADD COLUMN IF NOT EXISTS notas TEXT`,
  `ALTER TABLE tareas    ADD COLUMN IF NOT EXISTS extra JSONB`,
  `ALTER TABLE tareas    ADD COLUMN IF NOT EXISTS baja_presupuesto BOOLEAN NOT NULL DEFAULT FALSE`,
  `CREATE UNIQUE INDEX IF NOT EXISTS proyectos_ref_idx ON proyectos (ref_externa) WHERE ref_externa IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS partidas_ref_idx  ON partidas  (ref_externa) WHERE ref_externa IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS ordenes_ref_idx   ON ordenes   (ref_externa) WHERE ref_externa IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tareas_ref_idx    ON tareas    (ref_externa) WHERE ref_externa IS NOT NULL`,
  // Dependencias entre tareas: "tarea_id va después de depende_de_id (+ espera_h de calendario)"
  `CREATE TABLE IF NOT EXISTS tarea_dependencias (
     tarea_id       INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
     depende_de_id  INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
     espera_h       NUMERIC(5,1) NOT NULL DEFAULT 0,
     PRIMARY KEY (tarea_id, depende_de_id),
     CHECK (tarea_id <> depende_de_id)
   )`,
  `CREATE INDEX IF NOT EXISTS tarea_dependencias_prev_idx ON tarea_dependencias (depende_de_id)`,
  // Condiciones previas del proyecto (pago, RAL, pilares…), pendientes hasta que se marcan
  `CREATE TABLE IF NOT EXISTS proyecto_condiciones (
     id           SERIAL PRIMARY KEY,
     proyecto_id  INT NOT NULL REFERENCES proyectos(id) ON DELETE CASCADE,
     texto        TEXT NOT NULL,
     orden        INT NOT NULL DEFAULT 0,
     cumplida     BOOLEAN NOT NULL DEFAULT FALSE,
     cumplida_por INT REFERENCES usuarios(id),
     cumplida_en  TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS proyecto_condiciones_idx ON proyecto_condiciones (proyecto_id)`,
  // Asociaciones recordadas: nombre del compositor → área / tipo / recurso del planificador
  `CREATE TABLE IF NOT EXISTS import_alias (
     clase       TEXT NOT NULL,          -- area | tipo:operario | tipo:maquina | tipo:subcontrata | recurso
     nombre      TEXT NOT NULL,          -- normalizado (minúsculas, sin acentos ni espacios dobles)
     destino_id  INT NOT NULL,
     creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (clase, nombre)
   )`,
  `CREATE TABLE IF NOT EXISTS importaciones (
     id           SERIAL PRIMARY KEY,
     proyecto_id  INT REFERENCES proyectos(id) ON DELETE SET NULL,
     ref_externa  TEXT NOT NULL,
     usuario_id   INT REFERENCES usuarios(id),
     origen       JSONB,
     resumen      JSONB,
     archivo      JSONB,
     creado       TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // 2026-11 · Vínculo del operario: de plantilla o subcontratado (personas de otra empresa o
  // autónomos que trabajan como operarios: cuentan como operarios, tienen oficio y suman horas)
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS vinculo TEXT NOT NULL DEFAULT 'plantilla'`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recursos_vinculo_check') THEN
       ALTER TABLE recursos ADD CONSTRAINT recursos_vinculo_check CHECK (vinculo IN ('plantilla', 'subcontratado'));
     END IF;
   END $$`,

  // 2026-11 · Las obras son áreas de un proyecto: se ven en el tablero mientras el proyecto está
  // activo y no aparecen entre las áreas fijas (taller, cabina, oficina…)
  `ALTER TABLE lineas ADD COLUMN IF NOT EXISTS proyecto_id INT REFERENCES proyectos(id) ON DELETE SET NULL`,
  `CREATE INDEX IF NOT EXISTS lineas_proyecto_idx ON lineas (proyecto_id)`,
  // Enlaza las obras que ya existían con su proyecto (por nombre, código, dirección u «Obra · …»)
  `UPDATE lineas l SET proyecto_id = p.id
     FROM proyectos p
    WHERE l.tipo = 'obra' AND l.proyecto_id IS NULL
      AND (lower(l.nombre) IN (lower(p.nombre), lower(p.codigo))
           OR (p.obra IS NOT NULL AND (lower(l.ubicacion) = lower(p.obra) OR lower(l.nombre) = lower('Obra · ' || p.obra))))`,
  // …y las que solo usan tareas de un mismo proyecto
  `UPDATE lineas l SET proyecto_id = x.pid
     FROM (SELECT t.linea_id, min(o.proyecto_id) AS pid, count(DISTINCT o.proyecto_id) AS n
             FROM tareas t JOIN ordenes o ON o.id = t.orden_id
            WHERE o.proyecto_id IS NOT NULL AND t.linea_id IS NOT NULL GROUP BY t.linea_id) x
    WHERE l.id = x.linea_id AND x.n = 1 AND l.tipo = 'obra' AND l.proyecto_id IS NULL`,

  // 2026-11 · Semillero: departamentos, puestos de un solo trabajo a la vez y referencias estables
  `CREATE TABLE IF NOT EXISTS departamentos (
     id     SERIAL PRIMARY KEY,
     clave  TEXT NOT NULL UNIQUE,
     nombre TEXT NOT NULL,
     orden  INT NOT NULL DEFAULT 0
   )`,
  `ALTER TABLE lineas   ADD COLUMN IF NOT EXISTS departamento_id INT REFERENCES departamentos(id) ON DELETE SET NULL`,
  `ALTER TABLE lineas   ADD COLUMN IF NOT EXISTS exclusiva BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE lineas   ADD COLUMN IF NOT EXISTS descripcion TEXT`,
  `ALTER TABLE lineas   ADD COLUMN IF NOT EXISTS ref_semilla TEXT`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS departamento_id INT REFERENCES departamentos(id) ON DELETE SET NULL`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS ref_semilla TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lineas_semilla_idx   ON lineas (ref_semilla) WHERE ref_semilla IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS recursos_semilla_idx ON recursos (ref_semilla) WHERE ref_semilla IS NOT NULL`,
];

async function migrar() {
  for (const sql of MIGRACIONES) await query(sql);
}

module.exports = { migrar };
