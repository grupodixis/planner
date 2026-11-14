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
  // 2026-11 · Usuarios: roles configurables con permisos, enlaces de activación / recuperación
  `CREATE TABLE IF NOT EXISTS roles (
     clave        TEXT PRIMARY KEY,
     nombre       TEXT NOT NULL,
     descripcion  TEXT,
     permisos     TEXT[] NOT NULL DEFAULT '{}',
     sistema      BOOLEAN NOT NULL DEFAULT FALSE,
     orden        INT NOT NULL DEFAULT 0
   )`,
  `INSERT INTO roles (clave, nombre, descripcion, permisos, sistema, orden) VALUES
     ('admin', 'Administrador', 'Todo, incluidos usuarios y roles', '{planificar,proyectos,recursos,usuarios}', TRUE, 1),
     ('planificador', 'Planificador', 'Planifica en el tablero y gestiona proyectos y OTs', '{planificar,proyectos}', FALSE, 2),
     ('consulta', 'Consulta', 'Solo ve, no cambia nada', '{}', FALSE, 3)
   ON CONFLICT (clave) DO NOTHING`,
  // el rol pasa de una lista fija a la tabla de roles
  `ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuarios_rol_fk') THEN
       ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_fk FOREIGN KEY (rol) REFERENCES roles(clave) ON UPDATE CASCADE;
     END IF;
   END $$`,
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS recurso_id INT REFERENCES recursos(id) ON DELETE SET NULL`,
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS ultimo_acceso TIMESTAMPTZ`,
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS password_cambiada TIMESTAMPTZ`,
  `ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS creada TIMESTAMPTZ NOT NULL DEFAULT now()`,
  // Enlaces de un solo uso para activar la cuenta o restablecer la contraseña (se guarda el hash)
  `CREATE TABLE IF NOT EXISTS enlaces_acceso (
     id          SERIAL PRIMARY KEY,
     usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     token_hash  TEXT NOT NULL UNIQUE,
     tipo        TEXT NOT NULL CHECK (tipo IN ('activar', 'recuperar')),
     expira      TIMESTAMPTZ NOT NULL,
     usado       TIMESTAMPTZ,
     pedido_por_usuario BOOLEAN NOT NULL DEFAULT FALSE,   -- «¿Has olvidado tu contraseña?»
     enviado     BOOLEAN NOT NULL DEFAULT FALSE,          -- se mandó por correo
     creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     creado_por  INT REFERENCES usuarios(id) ON DELETE SET NULL
   )`,
  `CREATE INDEX IF NOT EXISTS enlaces_acceso_usuario_idx ON enlaces_acceso (usuario_id)`,
  // 2026-11 · Ausencias (vacaciones, bajas, averías…) y festivos
  `CREATE TABLE IF NOT EXISTS festivos (
     fecha   DATE PRIMARY KEY,
     nombre  TEXT NOT NULL,
     ambito  TEXT NOT NULL DEFAULT 'general' CHECK (ambito IN ('general', 'local', 'empresa'))
   )`,
  `CREATE TABLE IF NOT EXISTS ausencias (
     id          SERIAL PRIMARY KEY,
     recurso_id  INT NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
     tipo        TEXT NOT NULL CHECK (tipo IN ('vacaciones', 'baja', 'permiso', 'formacion', 'averia', 'mantenimiento', 'itv', 'otro')),
     desde       DATE NOT NULL,
     hasta       DATE NOT NULL,
     hora_desde  NUMERIC(4,2),            -- solo en ausencias de unas horas (un único día)
     hora_hasta  NUMERIC(4,2),
     notas       TEXT,
     creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     creado_por  INT REFERENCES usuarios(id) ON DELETE SET NULL,
     CHECK (hasta >= desde),
     CHECK ((hora_desde IS NULL) = (hora_hasta IS NULL)),
     CHECK (hora_desde IS NULL OR (desde = hasta AND hora_hasta > hora_desde))
   )`,
  `CREATE INDEX IF NOT EXISTS ausencias_recurso_idx ON ausencias (recurso_id, desde, hasta)`,
  // tipo «falta sin avisar» (se rehace la comprobación con la lista completa)
  // Faltas: justificante pendiente / presentado (si) / no presentado (no)
  `ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS justificante TEXT CHECK (justificante IN ('pendiente', 'si', 'no'))`,
  `UPDATE ausencias SET justificante = 'pendiente' WHERE tipo = 'falta' AND justificante IS NULL`,
  `ALTER TABLE ausencias DROP CONSTRAINT IF EXISTS ausencias_tipo_check`,
  `ALTER TABLE ausencias ADD CONSTRAINT ausencias_tipo_check
     CHECK (tipo IN ('vacaciones', 'baja', 'permiso', 'formacion', 'falta', 'averia', 'mantenimiento', 'itv', 'otro'))`,
  `CREATE INDEX IF NOT EXISTS ausencias_fechas_idx ON ausencias (desde, hasta)`,
  // días de vacaciones al año de cada persona (vacío = los de convenio, VACACIONES_DIAS)
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS dias_vacaciones NUMERIC(4,1)`,
  // Festivos de Illes Balears + locales de Sant Lluís (BOIB). Solo se cargan si ese año no tiene ninguno.
  `INSERT INTO festivos (fecha, nombre, ambito)
   SELECT v.fecha::date, v.nombre, v.ambito FROM (VALUES
     ('2026-01-01', 'Año Nuevo', 'general'), ('2026-01-06', 'Epifanía del Señor', 'general'),
     ('2026-01-17', 'Sant Antoni', 'local'), ('2026-03-02', 'Día siguiente al Día de les Illes Balears', 'general'),
     ('2026-04-02', 'Jueves Santo', 'general'), ('2026-04-03', 'Viernes Santo', 'general'),
     ('2026-04-06', 'Lunes de Pascua', 'general'), ('2026-05-01', 'Fiesta del Trabajo', 'general'),
     ('2026-08-15', 'Asunción de la Virgen', 'general'), ('2026-09-08', 'Mare de Déu de Gràcia', 'local'),
     ('2026-10-12', 'Fiesta Nacional', 'general'), ('2026-12-08', 'Inmaculada Concepción', 'general'),
     ('2026-12-25', 'Navidad', 'general'), ('2026-12-26', 'Segunda fiesta de Navidad', 'general')
   ) AS v(fecha, nombre, ambito)
   WHERE NOT EXISTS (SELECT 1 FROM festivos WHERE fecha BETWEEN '2026-01-01' AND '2026-12-31')`,
  `INSERT INTO festivos (fecha, nombre, ambito)
   SELECT v.fecha::date, v.nombre, v.ambito FROM (VALUES
     ('2027-01-01', 'Año Nuevo', 'general'), ('2027-01-06', 'Epifanía del Señor', 'general'),
     ('2027-01-07', 'Fiesta local de Sant Lluís', 'local'), ('2027-03-01', 'Día de les Illes Balears', 'general'),
     ('2027-03-25', 'Jueves Santo', 'general'), ('2027-03-26', 'Viernes Santo', 'general'),
     ('2027-03-29', 'Lunes de Pascua', 'general'), ('2027-05-01', 'Fiesta del Trabajo', 'general'),
     ('2027-09-08', 'Mare de Déu de Gràcia', 'local'), ('2027-10-12', 'Fiesta Nacional', 'general'),
     ('2027-11-01', 'Todos los Santos', 'general'), ('2027-12-06', 'Día de la Constitución', 'general'),
     ('2027-12-08', 'Inmaculada Concepción', 'general'), ('2027-12-25', 'Navidad', 'general')
   ) AS v(fecha, nombre, ambito)
   WHERE NOT EXISTS (SELECT 1 FROM festivos WHERE fecha BETWEEN '2027-01-01' AND '2027-12-31')`,
  // 2026-11 · Parte del día: lo real frente a lo planificado
  `ALTER TABLE tramos ADD COLUMN IF NOT EXISTS cierre TEXT CHECK (cierre IN ('hecho', 'corregido'))`,
  `ALTER TABLE tareas ADD COLUMN IF NOT EXISTS duracion_inicial_h NUMERIC(6,2)`,   // estimación antes de reestimar
  `ALTER TABLE tareas ADD COLUMN IF NOT EXISTS hecha_en TIMESTAMPTZ`,
  `ALTER TABLE tareas ADD COLUMN IF NOT EXISTS hecha_por INT REFERENCES usuarios(id) ON DELETE SET NULL`,
  // horas reales de cada recurso (persona, máquina, subcontrata) con su coste/hora de ese momento
  `CREATE TABLE IF NOT EXISTS registros (
     id          SERIAL PRIMARY KEY,
     fecha       DATE NOT NULL,
     recurso_id  INT NOT NULL REFERENCES recursos(id),
     tarea_id    INT REFERENCES tareas(id),
     tramo_id    INT REFERENCES tramos(id) ON DELETE SET NULL,
     desde       NUMERIC(4,2),
     hasta       NUMERIC(4,2),
     horas       NUMERIC(5,2) NOT NULL CHECK (horas > 0),
     tipo        TEXT NOT NULL DEFAULT 'productivo' CHECK (tipo IN ('productivo', 'no_productivo')),
     motivo      TEXT,
     notas       TEXT,
     coste_hora  NUMERIC(8,2),
     creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     creado_por  INT REFERENCES usuarios(id) ON DELETE SET NULL
   )`,
  `CREATE INDEX IF NOT EXISTS registros_fecha_idx ON registros (fecha)`,
  `CREATE INDEX IF NOT EXISTS registros_tarea_idx ON registros (tarea_id)`,
  `CREATE INDEX IF NOT EXISTS registros_recurso_idx ON registros (recurso_id, fecha)`,
  `CREATE INDEX IF NOT EXISTS registros_tramo_idx ON registros (tramo_id)`,
  // cada cierre de tramo, con lo que estaba planificado (para la fiabilidad y las desviaciones)
  `CREATE TABLE IF NOT EXISTS tramo_cierres (
     id          SERIAL PRIMARY KEY,
     tramo_id    INT REFERENCES tramos(id) ON DELETE SET NULL,
     tarea_id    INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
     fecha       DATE NOT NULL,
     hora_inicio NUMERIC(4,2) NOT NULL,
     duracion_h  NUMERIC(5,2) NOT NULL,
     linea_id    INT REFERENCES lineas(id) ON DELETE SET NULL,
     cierre      TEXT NOT NULL CHECK (cierre IN ('hecho', 'corregido', 'no_hecho')),
     motivo      TEXT,
     notas       TEXT,
     plan        JSONB,
     plan_h      NUMERIC(6,2),     -- horas-persona planificadas
     real_h      NUMERIC(6,2),     -- horas reales registradas (todas las clases de recurso)
     cerrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
     cerrado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS tramo_cierres_fecha_idx ON tramo_cierres (fecha)`,
  // para «Deshacer»: cómo estaba la tarea antes del cierre y los tramos que se quitaron al terminarla
  `ALTER TABLE tramo_cierres ADD COLUMN IF NOT EXISTS tarea_antes JSONB`,
  `ALTER TABLE tramo_cierres ADD COLUMN IF NOT EXISTS quitados JSONB`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tramo_cierres_tramo_idx ON tramo_cierres (tramo_id) WHERE tramo_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS dias_cerrados (
     fecha       DATE PRIMARY KEY,
     cerrado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
     cerrado_en  TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // permiso nuevo: ver informes de horas y costes (el Administrador lo tiene)
  `UPDATE roles SET permisos = array_append(permisos, 'informes') WHERE clave = 'admin' AND NOT ('informes' = ANY(permisos))`,
];

async function migrar() {
  for (const sql of MIGRACIONES) await query(sql);
}

module.exports = { migrar };
