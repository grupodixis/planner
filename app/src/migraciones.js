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
];

async function migrar() {
  for (const sql of MIGRACIONES) await query(sql);
}

module.exports = { migrar };
