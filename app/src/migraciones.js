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

  /* ---------- Operarios: entrada con PIN y «Mi día» ---------- */
  // usuarios que solo entran con PIN (sin email ni contraseña)
  `ALTER TABLE usuarios ALTER COLUMN email DROP NOT NULL`,
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS pin_hash TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS usuarios_pin_recurso_idx ON usuarios (recurso_id) WHERE pin_hash IS NOT NULL`,
  `INSERT INTO roles (clave, nombre, descripcion, permisos, sistema, orden) VALUES
     ('operario', 'Operario', 'Entra con PIN y solo apunta su propio día (Mi día)', '{mi_dia}', FALSE, 90)
   ON CONFLICT (clave) DO NOTHING`,
  // cómo se abrió la sesión (pin en tablet común = sesión corta)
  `ALTER TABLE sesiones ADD COLUMN IF NOT EXISTS via TEXT`,
  // móviles y tablets autorizados para entrar con PIN
  `CREATE TABLE IF NOT EXISTS dispositivos (
     id          SERIAL PRIMARY KEY,
     token_hash  TEXT NOT NULL UNIQUE,
     nombre      TEXT NOT NULL,
     tipo        TEXT NOT NULL CHECK (tipo IN ('comun', 'personal')),
     usuario_id  INT REFERENCES usuarios(id) ON DELETE CASCADE,   -- personal: el operario dueño del móvil
     activo      BOOLEAN NOT NULL DEFAULT TRUE,
     creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     creado_por  INT REFERENCES usuarios(id) ON DELETE SET NULL,
     ultimo_uso  TIMESTAMPTZ
   )`,
  // enlaces de un solo uso para dar de alta el móvil de un operario
  `CREATE TABLE IF NOT EXISTS altas_movil (
     token_hash  TEXT PRIMARY KEY,
     usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     expira      TIMESTAMPTZ NOT NULL,
     usado       TIMESTAMPTZ,
     creado_por  INT REFERENCES usuarios(id) ON DELETE SET NULL,
     creado      TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // lo que declara cada operario de su día (lo confirma el encargado en el parte)
  `CREATE TABLE IF NOT EXISTS declaraciones (
     id             SERIAL PRIMARY KEY,
     fecha          DATE NOT NULL,
     recurso_id     INT NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
     tipo           TEXT NOT NULL CHECK (tipo IN ('tramo', 'productivo', 'no_productivo')),
     tramo_id       INT REFERENCES tramos(id) ON DELETE CASCADE,
     tarea_id       INT REFERENCES tareas(id) ON DELETE CASCADE,
     estado         TEXT CHECK (estado IN ('hecho', 'parcial', 'no')),
     desde          NUMERIC(4,2),
     hasta          NUMERIC(4,2),
     terminada      BOOLEAN,
     motivo         TEXT,
     notas          TEXT,
     usuario_id     INT REFERENCES usuarios(id) ON DELETE SET NULL,
     actualizado    TIMESTAMPTZ NOT NULL DEFAULT now(),
     resuelto       TEXT CHECK (resuelto IN ('confirmado', 'descartado')),
     resuelto_en    TIMESTAMPTZ,
     resuelto_por   INT REFERENCES usuarios(id) ON DELETE SET NULL,
     registro_id    INT REFERENCES registros(id) ON DELETE SET NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS declaraciones_tramo_idx ON declaraciones (tramo_id, recurso_id) WHERE tramo_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS declaraciones_fecha_idx ON declaraciones (fecha, recurso_id)`,
  /* ---------- App del operario: fotos, vacaciones, avisos, incidencias ---------- */
  // fotos y documentos (justificantes, incidencias…) guardados en la base de datos
  `CREATE TABLE IF NOT EXISTS archivos (
     id          SERIAL PRIMARY KEY,
     tipo        TEXT NOT NULL,                  -- image/jpeg, application/pdf…
     bytes       INT NOT NULL,
     nombre      TEXT,
     datos       BYTEA NOT NULL,
     ref_tipo    TEXT,                           -- ausencia | incidencia (NULL = aún sin usar)
     ref_id      INT,
     creado_por  INT REFERENCES usuarios(id) ON DELETE SET NULL,
     creado      TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS archivos_ref_idx ON archivos (ref_tipo, ref_id)`,
  // permisos para aprobar vacaciones (dos pasos) y roles de partida
  `UPDATE roles SET permisos = permisos || ARRAY['vacaciones_ops','vacaciones_rrhh']
    WHERE clave = 'admin' AND NOT ('vacaciones_ops' = ANY(permisos))`,
  `INSERT INTO roles (clave, nombre, descripcion, permisos, sistema, orden) VALUES
     ('operaciones', 'Operaciones', 'Planifica, gestiona proyectos y recursos; primer visto bueno de vacaciones', '{planificar,proyectos,recursos,informes,vacaciones_ops}', FALSE, 4),
     ('rrhh', 'RRHH', 'Personas, ausencias y aprobación final de vacaciones', '{recursos,informes,vacaciones_rrhh}', FALSE, 5)
   ON CONFLICT (clave) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS solicitudes_vacaciones (
     id          SERIAL PRIMARY KEY,
     recurso_id  INT NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
     desde       DATE NOT NULL,
     hasta       DATE NOT NULL,
     dias        NUMERIC(5,2) NOT NULL,
     notas       TEXT,
     estado      TEXT NOT NULL DEFAULT 'pendiente_ops'
                 CHECK (estado IN ('pendiente_ops', 'pendiente_rrhh', 'aprobada', 'rechazada', 'anulada')),
     ops_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
     ops_en      TIMESTAMPTZ,
     ops_nota    TEXT,
     rrhh_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
     rrhh_en     TIMESTAMPTZ,
     rrhh_nota   TEXT,
     ausencia_id INT REFERENCES ausencias(id) ON DELETE SET NULL,
     usuario_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
     creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     CHECK (hasta >= desde)
   )`,
  // ausencias avisadas por el propio operario desde su móvil
  `ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS avisado_en TIMESTAMPTZ`,
  `ALTER TABLE ausencias ADD COLUMN IF NOT EXISTS aviso_motivo TEXT`,
  `CREATE TABLE IF NOT EXISTS incidencias (
     id           SERIAL PRIMARY KEY,
     fecha        DATE NOT NULL,
     recurso_id   INT REFERENCES recursos(id) ON DELETE SET NULL,     -- quien la avisa
     usuario_id   INT REFERENCES usuarios(id) ON DELETE SET NULL,
     tipo         TEXT NOT NULL CHECK (tipo IN ('material', 'averia', 'calidad', 'seguridad', 'otro')),
     texto        TEXT NOT NULL,
     tramo_id     INT REFERENCES tramos(id) ON DELETE SET NULL,
     tarea_id     INT REFERENCES tareas(id) ON DELETE SET NULL,
     maquina_id   INT REFERENCES recursos(id) ON DELETE SET NULL,
     estado       TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'resuelta')),
     resuelta_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
     resuelta_en  TIMESTAMPTZ,
     resolucion   TEXT,
     creado       TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS incidencias_estado_idx ON incidencias (estado, fecha)`,
  /* ---------- Bandeja de capturas (GTD): texto, audio, foto, vídeo → tarea / asunto / información ---------- */
  `ALTER TABLE archivos ADD COLUMN IF NOT EXISTS ruta TEXT`,
  `ALTER TABLE archivos ALTER COLUMN datos DROP NOT NULL`,
  `CREATE TABLE IF NOT EXISTS capturas (
     id              SERIAL PRIMARY KEY,
     creado          TIMESTAMPTZ NOT NULL DEFAULT now(),
     usuario_id      INT REFERENCES usuarios(id) ON DELETE SET NULL,     -- quien la capturó
     recurso_id      INT REFERENCES recursos(id) ON DELETE SET NULL,     -- su ficha (si es operario)
     texto           TEXT,
     categoria       TEXT CHECK (categoria IN ('material', 'averia', 'calidad', 'seguridad', 'mejora', 'otro')),
     proyecto_id     INT REFERENCES proyectos(id) ON DELETE SET NULL,
     orden_id        INT REFERENCES ordenes(id) ON DELETE SET NULL,
     tramo_id        INT REFERENCES tramos(id) ON DELETE SET NULL,
     tarea_id        INT REFERENCES tareas(id) ON DELETE SET NULL,
     maquina_id      INT REFERENCES recursos(id) ON DELETE SET NULL,
     estado          TEXT NOT NULL DEFAULT 'bandeja'
                     CHECK (estado IN ('bandeja', 'asunto', 'tarea', 'info', 'resuelta', 'descartada')),
     prioridad       TEXT NOT NULL DEFAULT 'normal' CHECK (prioridad IN ('alta', 'normal', 'baja')),
     responsable_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
     fecha_limite    DATE,
     tarea_creada_id INT REFERENCES tareas(id) ON DELETE SET NULL,
     nota            TEXT,                                               -- del supervisor
     clasificada_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
     clasificada_en  TIMESTAMPTZ,
     resuelta_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
     resuelta_en     TIMESTAMPTZ,
     resolucion      TEXT,
     origen_incidencia_id INT UNIQUE
   )`,
  `CREATE INDEX IF NOT EXISTS capturas_estado_idx ON capturas (estado, creado)`,
  // las incidencias pasan a ser capturas (una sola bandeja)
  `INSERT INTO capturas (creado, usuario_id, recurso_id, texto, categoria, proyecto_id, orden_id, tramo_id, tarea_id, maquina_id,
                         estado, resuelta_por, resuelta_en, resolucion, origen_incidencia_id)
   SELECT i.creado, i.usuario_id, i.recurso_id, i.texto, i.tipo, o.proyecto_id, t.orden_id, i.tramo_id, i.tarea_id, i.maquina_id,
          CASE WHEN i.estado = 'abierta' THEN 'bandeja' ELSE 'resuelta' END, i.resuelta_por, i.resuelta_en, i.resolucion, i.id
     FROM incidencias i LEFT JOIN tareas t ON t.id = i.tarea_id LEFT JOIN ordenes o ON o.id = t.orden_id
    WHERE NOT EXISTS (SELECT 1 FROM capturas c WHERE c.origen_incidencia_id = i.id)`,
  `UPDATE archivos a SET ref_tipo = 'captura', ref_id = c.id FROM capturas c
    WHERE a.ref_tipo = 'incidencia' AND a.ref_id = c.origen_incidencia_id`,
  /* ---------- Avisos al móvil (notificaciones push) ---------- */
  `CREATE TABLE IF NOT EXISTS ajustes (clave TEXT PRIMARY KEY, valor JSONB NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS push_suscripciones (
     id          SERIAL PRIMARY KEY,
     usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
     endpoint    TEXT NOT NULL UNIQUE,
     p256dh      TEXT NOT NULL,
     auth        TEXT NOT NULL,
     agente      TEXT,
     creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     ultimo_ok   TIMESTAMPTZ
   )`,
  // qué avisos quiere cada uno y sus horas de silencio (NULL = los de por defecto)
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS avisos JSONB`,
  `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS roles_extra TEXT[] NOT NULL DEFAULT '{}'`,
  // memoria de los avisos programados (firma del plan, último resumen, recordatorios enviados)
  `CREATE TABLE IF NOT EXISTS push_estado (clave TEXT PRIMARY KEY, valor TEXT, actualizado TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS dias_enviados (
     fecha       DATE NOT NULL,
     recurso_id  INT NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
     enviado_en  TIMESTAMPTZ NOT NULL DEFAULT now(),
     usuario_id  INT REFERENCES usuarios(id) ON DELETE SET NULL,
     PRIMARY KEY (fecha, recurso_id)
   )`,

  // 2026-11 · Se retira el primer módulo de materiales (BOM, corte, almacén): se empieza por lo simple.
  // Sus tablas estaban vacías. Los proveedores (importados de Notion) se conservan para más adelante.
  `DROP TABLE IF EXISTS material_grupos`,
  `DROP TABLE IF EXISTS materiales`,
  `ALTER TABLE ordenes DROP COLUMN IF EXISTS bom_en`,
  `ALTER TABLE ordenes DROP COLUMN IF EXISTS bom_por`,
  `UPDATE roles SET permisos = array_remove(array_remove(permisos, 'materiales'), 'almacen')
    WHERE permisos && ARRAY['materiales','almacen']`,
  `DELETE FROM roles r WHERE r.clave = 'almacen' AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.rol = r.clave)`,
  `CREATE TABLE IF NOT EXISTS proveedores (
     id           SERIAL PRIMARY KEY,
     nombre       TEXT NOT NULL,
     email        TEXT,
     telefono     TEXT,
     contacto     TEXT,
     localidad    TEXT,
     zona         TEXT NOT NULL DEFAULT 'menorca',
     transporte   TEXT NOT NULL DEFAULT 'proveedor',
     materiales   TEXT[] NOT NULL DEFAULT '{}',
     web          TEXT,
     notas        TEXT,
     activo       BOOLEAN NOT NULL DEFAULT TRUE,
     ref_notion   TEXT UNIQUE,
     creado       TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,

  // 2026-11 · Materiales y herramientas: catálogo (con sugerencias) y lista por OT, cada línea en
  // una o varias tareas de la OT
  `CREATE TABLE IF NOT EXISTS catalogo (
     id          SERIAL PRIMARY KEY,
     tipo        TEXT NOT NULL CHECK (tipo IN ('material', 'herramienta')),
     familia     TEXT NOT NULL DEFAULT 'Otros',
     nombre      TEXT NOT NULL,
     unidad      TEXT,
     detalle     TEXT,
     origen      TEXT NOT NULL DEFAULT 'usuario' CHECK (origen IN ('base', 'usuario')),
     activo      BOOLEAN NOT NULL DEFAULT TRUE,
     creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
     creado_por  INT REFERENCES usuarios(id) ON DELETE SET NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS catalogo_nombre_idx ON catalogo (tipo, lower(nombre))`,
  `DROP TABLE IF EXISTS ot_llevar_tareas`,
  `DROP TABLE IF EXISTS ot_llevar`,
  `DROP TABLE IF EXISTS tarea_llevar`,

  // 2026-11 · Circuito de material:
  //   Técnico (Sofía) define el ESCANDALLO de la partida → Logística (Sergio) dice qué hay en stock →
  //   lo que falta lo pide Compras → Logística lo recibe → aviso a los operarios de la tarea.
  //   Operaciones (Adrián) ASIGNA el material del escandallo y las herramientas a las tareas de las OTs.
  `CREATE TABLE IF NOT EXISTS partida_escandallo (
     id             SERIAL PRIMARY KEY,
     partida_id     INT NOT NULL REFERENCES partidas(id) ON DELETE CASCADE,
     catalogo_id    INT REFERENCES catalogo(id) ON DELETE SET NULL,
     descripcion    TEXT NOT NULL,
     cantidad       NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
     unidad         TEXT,
     nota           TEXT,
     orden          INT NOT NULL DEFAULT 0,
     creado         TIMESTAMPTZ NOT NULL DEFAULT now(),
     creado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
     -- logística: cuánto hay en stock (NULL = sin revisar)
     stock          NUMERIC(12,3),
     stock_por      INT REFERENCES usuarios(id) ON DELETE SET NULL,
     stock_en       TIMESTAMPTZ,
     -- compra de lo que falta: por_pedir → pedido → recibido
     compra         TEXT CHECK (compra IN ('por_pedir', 'pedido', 'recibido')),
     proveedor_id   INT REFERENCES proveedores(id) ON DELETE SET NULL,
     fecha_prevista DATE,
     pedido_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
     pedido_en      TIMESTAMPTZ,
     recibido_por   INT REFERENCES usuarios(id) ON DELETE SET NULL,
     recibido_en    TIMESTAMPTZ,
     nota_logistica TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS partida_escandallo_idx ON partida_escandallo (partida_id, orden)`,
  `ALTER TABLE partidas ADD COLUMN IF NOT EXISTS escandallo_enviado TIMESTAMPTZ`,
  // enlaces (web del fabricante, ficha técnica…) del material; las fotos y PDF van en «archivos» (ref_tipo = 'escandallo')
  `ALTER TABLE partida_escandallo ADD COLUMN IF NOT EXISTS enlaces TEXT[] NOT NULL DEFAULT '{}'`,
  `CREATE TABLE IF NOT EXISTS tarea_material (
     id             SERIAL PRIMARY KEY,
     escandallo_id  INT NOT NULL REFERENCES partida_escandallo(id) ON DELETE CASCADE,
     tarea_id       INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
     cantidad       NUMERIC(12,3) NOT NULL CHECK (cantidad > 0),
     creado         TIMESTAMPTZ NOT NULL DEFAULT now(),
     creado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
     UNIQUE (escandallo_id, tarea_id)
   )`,
  `CREATE INDEX IF NOT EXISTS tarea_material_tarea_idx ON tarea_material (tarea_id)`,
  `CREATE TABLE IF NOT EXISTS tarea_herramienta (
     id           SERIAL PRIMARY KEY,
     tarea_id     INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
     catalogo_id  INT REFERENCES catalogo(id) ON DELETE SET NULL,
     descripcion  TEXT NOT NULL,
     cantidad     NUMERIC(12,3),
     nota         TEXT,
     creado       TIMESTAMPTZ NOT NULL DEFAULT now(),
     creado_por   INT REFERENCES usuarios(id) ON DELETE SET NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS tarea_herramienta_unica ON tarea_herramienta (tarea_id, lower(descripcion))`,
  // Equipamiento fijo de un área: máquinas (recursos con «fijo_area») y otros elementos (texto).
  // Lo que se planifica en el área lo lleva solo (requisitos cumplidos, detalle, Mi día)
  `ALTER TABLE lineas ADD COLUMN IF NOT EXISTS equipamiento TEXT[] NOT NULL DEFAULT '{}'`,
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS fijo_area BOOLEAN NOT NULL DEFAULT FALSE`,
  // Importación s360-import/2: material del escandallo con ref del compositor, desglose de tiempos de la tarea,
  // y marca de lo que vino importado (para reimportar sin pisar lo añadido a mano)
  `ALTER TABLE partida_escandallo ADD COLUMN IF NOT EXISTS ref_externa TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS partida_escandallo_ref ON partida_escandallo (ref_externa) WHERE ref_externa IS NOT NULL`,
  `ALTER TABLE partida_escandallo ADD COLUMN IF NOT EXISTS baja_presupuesto BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE tareas ADD COLUMN IF NOT EXISTS desglose JSONB`,
  `ALTER TABLE tarea_herramienta ADD COLUMN IF NOT EXISTS importada BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE tarea_material ADD COLUMN IF NOT EXISTS importada BOOLEAN NOT NULL DEFAULT FALSE`,
  // Nº de pedido al proveedor (al marcar «pedido») y nº de albarán (al recibir)
  `ALTER TABLE partida_escandallo ADD COLUMN IF NOT EXISTS num_pedido TEXT`,
  `ALTER TABLE partida_escandallo ADD COLUMN IF NOT EXISTS num_albaran TEXT`,
  // Incidencias del material (llegó una parte, dañado, equivocado, no llegó…): comentario + fotos
  `CREATE TABLE IF NOT EXISTS escandallo_incidencias (
     id SERIAL PRIMARY KEY,
     escandallo_id INT NOT NULL REFERENCES partida_escandallo(id) ON DELETE CASCADE,
     texto TEXT NOT NULL,
     creado_por INT REFERENCES usuarios(id) ON DELETE SET NULL,
     creado TIMESTAMPTZ NOT NULL DEFAULT now(),
     resuelta_en TIMESTAMPTZ,
     resuelta_por INT REFERENCES usuarios(id) ON DELETE SET NULL)`,
  // Mi día: el operario marca que ha cogido cada equipo (máquina) asignado a su tramo
  `CREATE TABLE IF NOT EXISTS equipo_check (
     recurso_id INT NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
     tramo_id INT NOT NULL REFERENCES tramos(id) ON DELETE CASCADE,
     maquina_id INT NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
     marcado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (recurso_id, tramo_id, maquina_id))`,
  // Mi día: cada operario marca el material que ha recibido y las herramientas que ha preparado
  `CREATE TABLE IF NOT EXISTS llevar_check (
     recurso_id INT NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
     tipo TEXT NOT NULL CHECK (tipo IN ('material', 'herramienta')),
     item_id INT NOT NULL,
     marcado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (recurso_id, tipo, item_id))`,
  // Tipos de máquina por naturaleza (familia) y uso (taller / obra / taller y obra): sustituye al tipo comodín
  // «Equipo portátil para obra». Se rellena una vez por nombre; luego se edita en Recursos › Tipos.
  `ALTER TABLE tipos_recurso ADD COLUMN IF NOT EXISTS familia TEXT`,
  `ALTER TABLE tipos_recurso ADD COLUMN IF NOT EXISTS uso TEXT`,
  `UPDATE tipos_recurso t SET familia = m.familia, uso = COALESCE(t.uso, m.uso) FROM (VALUES
     ('soldadora mig/mag', 'Soldadura', 'ambos'), ('soldadora mma (electrodo)', 'Soldadura', 'ambos'), ('soldadora tig', 'Soldadura', 'taller'),
     ('soldadora láser', 'Soldadura', 'taller'),
     ('sierra semi automatica', 'Corte y mecanizado', 'taller'), ('cortadora de disco (aluminio)', 'Corte y mecanizado', 'taller'),
     ('fresadora de cerraduras', 'Corte y mecanizado', 'taller'), ('punzonadora de lamas y troqueles', 'Corte y mecanizado', 'taller'),
     ('taladro magnético', 'Fijación y montaje', 'ambos'), ('llave de impacto', 'Fijación y montaje', 'ambos'),
     ('remachadora', 'Fijación y montaje', 'ambos'), ('remachadora de tuercas', 'Fijación y montaje', 'ambos'),
     ('andamio', 'Elevación y acceso', 'obra'), ('carretilla elevadora (toro)', 'Elevación y acceso', 'taller'),
     ('camión', 'Vehículos y transporte', 'ambos'), ('furgón / furgoneta', 'Vehículos y transporte', 'ambos'),
     ('kit de medición', 'Medición', 'ambos'), ('equipo de pintura (airless / pistola)', 'Pintura', 'taller'),
     ('impresora 3d', 'Oficina técnica', 'taller')
   ) AS m(nombre, familia, uso) WHERE t.clase = 'maquina' AND t.familia IS NULL AND lower(t.nombre) = m.nombre`,
  // Capacidades (saber hacer) de las personas: lo que pide una tarea es una capacidad, no una categoría
  `CREATE TABLE IF NOT EXISTS capacidades (
     id SERIAL PRIMARY KEY,
     familia TEXT NOT NULL DEFAULT 'Otras',
     nombre TEXT NOT NULL,
     orden INT NOT NULL DEFAULT 0,
     creado TIMESTAMPTZ NOT NULL DEFAULT now())`,
  `CREATE UNIQUE INDEX IF NOT EXISTS capacidades_nombre ON capacidades (lower(nombre))`,
  `CREATE TABLE IF NOT EXISTS recurso_capacidades (
     recurso_id INT NOT NULL REFERENCES recursos(id) ON DELETE CASCADE,
     capacidad_id INT NOT NULL REFERENCES capacidades(id) ON DELETE CASCADE,
     PRIMARY KEY (recurso_id, capacidad_id))`,
  // lo que el operario dice que sabe hacer (desde Mi día) queda «propuesta» hasta que un supervisor la valida
  `ALTER TABLE recurso_capacidades ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'validada'`,
  `ALTER TABLE recurso_capacidades ADD COLUMN IF NOT EXISTS propuesta_en TIMESTAMPTZ`,
  `ALTER TABLE recurso_capacidades ADD COLUMN IF NOT EXISTS validada_por INT REFERENCES usuarios(id) ON DELETE SET NULL`,
  `ALTER TABLE recurso_capacidades ADD COLUMN IF NOT EXISTS validada_en TIMESTAMPTZ`,
  // Mi perfil: datos personales que rellena el propio operario (DNI, dirección, contacto de emergencia, tallas…)
  `ALTER TABLE recursos ADD COLUMN IF NOT EXISTS perfil JSONB NOT NULL DEFAULT '{}'`,
  `CREATE TABLE IF NOT EXISTS tarea_capacidades (
     tarea_id INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
     capacidad_id INT NOT NULL REFERENCES capacidades(id) ON DELETE CASCADE,
     cantidad INT NOT NULL DEFAULT 1 CHECK (cantidad BETWEEN 1 AND 50),
     PRIMARY KEY (tarea_id, capacidad_id))`,
  `INSERT INTO roles (clave, nombre, descripcion, permisos, sistema, orden) VALUES
     ('tecnico', 'Técnico', 'Define el escandallo de las partidas', '{escandallo,informes}', FALSE, 6),
     ('logistica', 'Logística', 'Revisa el stock y recibe el material', '{logistica}', FALSE, 7),
     ('compras', 'Compras', 'Pide a proveedores lo que falta', '{compras}', FALSE, 8)
   ON CONFLICT (clave) DO NOTHING`,
  `UPDATE roles SET permisos = permisos || ARRAY['escandallo','logistica','compras']
    WHERE clave = 'admin' AND NOT ('escandallo' = ANY(permisos))`,
  // 2026-11 · Control de costes: PVP y presupuesto de coste por partida (los trae el compositor o se escriben)
  `ALTER TABLE partidas ADD COLUMN IF NOT EXISTS pvp NUMERIC(12,2)`,
  `ALTER TABLE partidas ADD COLUMN IF NOT EXISTS presupuesto JSONB NOT NULL DEFAULT '{}'`,
  `UPDATE partidas SET pvp = (extra->>'importe_eur')::numeric
    WHERE pvp IS NULL AND jsonb_typeof(extra->'importe_eur') = 'number'`,
  // permiso «costes»: solo Administrador, Operaciones y Dirección (una sola vez: luego se gestiona en Usuarios)
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM ajustes WHERE clave = 'migr_permiso_costes') THEN
       INSERT INTO roles (clave, nombre, descripcion, permisos, sistema, orden) VALUES
         ('direccion', 'Dirección', 'Informes y control de costes', '{informes,costes}', FALSE, 9)
       ON CONFLICT (clave) DO NOTHING;
       UPDATE roles SET permisos = array_append(permisos, 'costes')
        WHERE clave IN ('admin', 'operaciones', 'direccion') AND NOT ('costes' = ANY(permisos));
       INSERT INTO ajustes (clave, valor) VALUES ('migr_permiso_costes', 'true');
     END IF;
   END $$`,
  // 2026-11 · Compras: ficha de proveedor completa, pedidos de compra con aprobación y envío por correo
  `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS cif TEXT`,
  `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS email_admin TEXT`,
  `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS forma_pago TEXT`,
  `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS plazo_dias INT`,
  `ALTER TABLE proveedores ADD COLUMN IF NOT EXISTS portes TEXT`,
  `CREATE TABLE IF NOT EXISTS pedidos_compra (
     id             SERIAL PRIMARY KEY,
     codigo         TEXT NOT NULL UNIQUE,
     proveedor_id   INT REFERENCES proveedores(id) ON DELETE SET NULL,
     estado         TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador','por_aprobar','aprobado','enviado','anulado')),
     fecha_entrega  DATE,
     entregar_en    TEXT,
     referencia     TEXT,
     forma_pago     TEXT,
     observaciones  TEXT,
     total          NUMERIC(12,2) NOT NULL DEFAULT 0,
     creado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
     creado         TIMESTAMPTZ NOT NULL DEFAULT now(),
     aprobacion_pedida_en TIMESTAMPTZ,
     aprobado_por   INT REFERENCES usuarios(id) ON DELETE SET NULL,
     aprobado_en    TIMESTAMPTZ,
     rechazo        TEXT,
     enviado_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
     enviado_en     TIMESTAMPTZ,
     enviado_a      TEXT,
     enviado_correo BOOLEAN NOT NULL DEFAULT FALSE
   )`,
  `CREATE TABLE IF NOT EXISTS pedido_compra_lineas (
     id             SERIAL PRIMARY KEY,
     pedido_id      INT NOT NULL REFERENCES pedidos_compra(id) ON DELETE CASCADE,
     escandallo_id  INT REFERENCES partida_escandallo(id) ON DELETE SET NULL,
     descripcion    TEXT NOT NULL,
     cantidad       NUMERIC(12,3) NOT NULL DEFAULT 0,
     unidad         TEXT,
     precio         NUMERIC(12,4),
     orden          INT NOT NULL DEFAULT 0
   )`,
  `CREATE INDEX IF NOT EXISTS pedido_compra_lineas_idx ON pedido_compra_lineas (pedido_id, orden)`,
  `ALTER TABLE partida_escandallo ADD COLUMN IF NOT EXISTS pedido_compra_id INT REFERENCES pedidos_compra(id) ON DELETE SET NULL`,
  `ALTER TABLE partida_escandallo ADD COLUMN IF NOT EXISTS precio_pedido NUMERIC(12,4)`,
  // permiso «aprobar_compras»: Dirección y Administrador (una vez)
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM ajustes WHERE clave = 'migr_permiso_aprobar_compras') THEN
       UPDATE roles SET permisos = array_append(permisos, 'aprobar_compras')
        WHERE clave IN ('admin', 'direccion') AND NOT ('aprobar_compras' = ANY(permisos));
       INSERT INTO ajustes (clave, valor) VALUES ('migr_permiso_aprobar_compras', 'true');
     END IF;
   END $$`,
  // 2026-11 · Peticiones de precio a proveedores (SOL-AAAA-NNNN): ofertas, comparativo y pedidos
  `CREATE TABLE IF NOT EXISTS solicitudes_precio (
     id             SERIAL PRIMARY KEY,
     codigo         TEXT NOT NULL UNIQUE,
     estado         TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta','cerrada','anulada')),
     responder_antes DATE,
     necesario_el   DATE,
     notas          TEXT,
     creado_por     INT REFERENCES usuarios(id) ON DELETE SET NULL,
     creado         TIMESTAMPTZ NOT NULL DEFAULT now(),
     cerrado_en     TIMESTAMPTZ
   )`,
  `CREATE TABLE IF NOT EXISTS solicitud_lineas (
     id             SERIAL PRIMARY KEY,
     solicitud_id   INT NOT NULL REFERENCES solicitudes_precio(id) ON DELETE CASCADE,
     escandallo_id  INT REFERENCES partida_escandallo(id) ON DELETE SET NULL,
     descripcion    TEXT NOT NULL,
     cantidad       NUMERIC(12,3) NOT NULL DEFAULT 0,
     unidad         TEXT,
     orden          INT NOT NULL DEFAULT 0,
     elegido        INT
   )`,
  `CREATE TABLE IF NOT EXISTS solicitud_proveedores (
     id             SERIAL PRIMARY KEY,
     solicitud_id   INT NOT NULL REFERENCES solicitudes_precio(id) ON DELETE CASCADE,
     proveedor_id   INT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
     estado         TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','enviada','respondida','no_oferta')),
     enviado_en     TIMESTAMPTZ,
     enviado_correo BOOLEAN NOT NULL DEFAULT FALSE,
     enviado_a      TEXT,
     recordado_en   TIMESTAMPTZ,
     respondido_en  TIMESTAMPTZ,
     fecha_entrega  DATE,
     portes         NUMERIC(12,2),
     ref_oferta     TEXT,
     notas          TEXT,
     UNIQUE (solicitud_id, proveedor_id)
   )`,
  `CREATE TABLE IF NOT EXISTS solicitud_precios (
     sp_id          INT NOT NULL REFERENCES solicitud_proveedores(id) ON DELETE CASCADE,
     linea_id       INT NOT NULL REFERENCES solicitud_lineas(id) ON DELETE CASCADE,
     precio         NUMERIC(12,4) NOT NULL,
     PRIMARY KEY (sp_id, linea_id)
   )`,
  `ALTER TABLE partida_escandallo ADD COLUMN IF NOT EXISTS solicitud_id INT REFERENCES solicitudes_precio(id) ON DELETE SET NULL`,
  // 2026-11 · El proveedor responde la petición de precio en la plataforma (enlace sin sesión)
  `ALTER TABLE solicitud_proveedores ADD COLUMN IF NOT EXISTS portal_nonce TEXT,
     ADD COLUMN IF NOT EXISTS portal_visto_en TIMESTAMPTZ,
     ADD COLUMN IF NOT EXISTS portal_respondido_en TIMESTAMPTZ,
     ADD COLUMN IF NOT EXISTS contacto TEXT,
     ADD COLUMN IF NOT EXISTS lineas_info JSONB NOT NULL DEFAULT '{}'::jsonb`,
  // 2026-11 · Se retira el primer planteamiento de «fabricación externa» (pedidos FE con recorridos)
  `DROP TABLE IF EXISTS fab_eventos, fab_enlaces, fab_partes, fab_pedidos CASCADE`,
  `DELETE FROM ajustes WHERE clave = 'fab_plantillas'`,
  `DELETE FROM archivos WHERE ref_tipo IN ('fab_plano', 'fab_evento', 'fab_pend')`,
  // 2026-11 · Talleres externos: una tarea de una OT la hace un taller de fuera (un proveedor). Cada taller
  // tiene su área en el tablero (tipo 'externo'), que solo sale mientras tiene tareas activas, como las obras.
  `ALTER TABLE lineas ADD COLUMN IF NOT EXISTS proveedor_id INT REFERENCES proveedores(id) ON DELETE SET NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS lineas_externo_idx ON lineas (proveedor_id) WHERE tipo = 'externo'`,
  `ALTER TABLE tareas ADD COLUMN IF NOT EXISTS proveedor_id INT REFERENCES proveedores(id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS ext_avance INT CHECK (ext_avance BETWEEN 0 AND 100),
     ADD COLUMN IF NOT EXISTS ext_nota TEXT,
     ADD COLUMN IF NOT EXISTS ext_actualizado TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS tareas_proveedor_idx ON tareas (proveedor_id) WHERE proveedor_id IS NOT NULL`,

  // 2026-11 · Códigos jerárquicos: proyecto P-2026-0061 → «61»; sus OTs 61.01, 61.02…; sus tareas 61.02.1, 61.02.2…
  // Automáticos (también al importar o al cambiar una OT de proyecto). El código anterior queda en codigo_antiguo.
  // Si otro proyecto más antiguo ya usa el mismo número (p. ej. P-2027-0061), se antepone el año: «27-61».
  `CREATE OR REPLACE FUNCTION planea_num_proyecto(pid INT) RETURNS TEXT LANGUAGE sql STABLE AS $f$
     WITH p AS (SELECT id, COALESCE(substring(codigo FROM '(\\d+)\\D*$')::int, id) AS n, substring(codigo FROM '20(\\d\\d)') AS yy
                  FROM proyectos WHERE id = pid)
     SELECT CASE WHEN EXISTS (SELECT 1 FROM proyectos q WHERE q.id < p.id
                                AND COALESCE(substring(q.codigo FROM '(\\d+)\\D*$')::int, q.id) = p.n)
                 THEN COALESCE(p.yy, p.id::text) || '-' || p.n ELSE p.n::text END
       FROM p $f$`,
  `ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS codigo_antiguo TEXT`,
  `ALTER TABLE tareas ADD COLUMN IF NOT EXISTS numero INT, ADD COLUMN IF NOT EXISTS codigo TEXT`,
  // una vez: renumerar lo que hay (OTs por partida y código anterior; tareas por su orden en la OT)
  `DO $m$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM ajustes WHERE clave = 'migr_codigos_v1') THEN
       UPDATE ordenes SET codigo_antiguo = codigo WHERE codigo_antiguo IS NULL;
       UPDATE ordenes SET codigo = 'tmp-' || id WHERE proyecto_id IS NOT NULL;
       WITH x AS (SELECT o.id, planea_num_proyecto(o.proyecto_id) AS pn,
                         row_number() OVER (PARTITION BY o.proyecto_id ORDER BY pa.orden NULLS LAST, pa.id NULLS LAST, o.codigo_antiguo, o.id) AS rn
                    FROM ordenes o LEFT JOIN partidas pa ON pa.id = o.partida_id WHERE o.proyecto_id IS NOT NULL)
       UPDATE ordenes o SET codigo = x.pn || '.' || lpad(x.rn::text, 2, '0') FROM x WHERE x.id = o.id;
       WITH x AS (SELECT t.id, row_number() OVER (PARTITION BY t.orden_id ORDER BY t.orden_en_of, t.id) AS rn FROM tareas t)
       UPDATE tareas t SET numero = x.rn FROM x WHERE x.id = t.id;
       UPDATE tareas t SET codigo = o.codigo || '.' || t.numero FROM ordenes o WHERE o.id = t.orden_id;
       INSERT INTO ajustes (clave, valor) VALUES ('migr_codigos_v1', 'true'::jsonb);
     END IF;
   END $m$`,
  // OT: código según su proyecto (al crearla, al cambiarla de proyecto o si el proyecto cambia de número)
  `CREATE OR REPLACE FUNCTION planea_codigo_ot() RETURNS trigger LANGUAGE plpgsql AS $f$
   DECLARE pn TEXT; seq INT;
   BEGIN
     IF NEW.proyecto_id IS NULL THEN RETURN NEW; END IF;
     pn := planea_num_proyecto(NEW.proyecto_id);
     IF TG_OP = 'UPDATE' AND NEW.proyecto_id = OLD.proyecto_id THEN
       IF OLD.codigo ~ ('^' || pn || '\\.\\d+$') THEN
         -- el código es automático: lo que llegue (p. ej. el del compositor al reimportar) queda como referencia
         IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
           IF NEW.codigo !~ '^[0-9-]+\\.\\d+$' THEN NEW.codigo_antiguo := NEW.codigo; END IF;
           NEW.codigo := OLD.codigo;
         END IF;
         RETURN NEW;
       ELSIF OLD.codigo ~ '^[0-9-]+\\.\\d+$' THEN
         -- el proyecto cambió de número: se conserva la secuencia
         NEW.codigo := pn || '.' || split_part(OLD.codigo, '.', 2);
         RETURN NEW;
       END IF;
     END IF;
     IF NEW.codigo IS NOT NULL AND NEW.codigo !~ '^[0-9-]+\\.\\d+$' AND NEW.codigo !~ '^tmp-' AND NEW.codigo_antiguo IS NULL THEN
       NEW.codigo_antiguo := NEW.codigo;
     END IF;
     SELECT COALESCE(max(split_part(codigo, '.', 2)::int), 0) + 1 INTO seq FROM ordenes
      WHERE proyecto_id = NEW.proyecto_id AND codigo ~ ('^' || pn || '\\.\\d+$') AND id <> COALESCE(NEW.id, 0);
     NEW.codigo := pn || '.' || lpad(seq::text, 2, '0');
     RETURN NEW;
   END $f$`,
  `DROP TRIGGER IF EXISTS planea_codigo_ot ON ordenes`,
  `CREATE TRIGGER planea_codigo_ot BEFORE INSERT OR UPDATE OF codigo, proyecto_id ON ordenes FOR EACH ROW EXECUTE FUNCTION planea_codigo_ot()`,
  // al cambiar el código de la OT, sus tareas lo siguen
  `CREATE OR REPLACE FUNCTION planea_codigo_ot_tareas() RETURNS trigger LANGUAGE plpgsql AS $f$
   BEGIN
     IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
       UPDATE tareas SET codigo = NEW.codigo || '.' || numero WHERE orden_id = NEW.id;
     END IF;
     RETURN NEW;
   END $f$`,
  `DROP TRIGGER IF EXISTS planea_codigo_ot_tareas ON ordenes`,
  `CREATE TRIGGER planea_codigo_ot_tareas AFTER UPDATE ON ordenes FOR EACH ROW WHEN (NEW.codigo IS DISTINCT FROM OLD.codigo) EXECUTE FUNCTION planea_codigo_ot_tareas()`,
  // tarea: el siguiente número de su OT (no cambia al reordenar: el código es estable)
  `CREATE OR REPLACE FUNCTION planea_codigo_tarea() RETURNS trigger LANGUAGE plpgsql AS $f$
   BEGIN
     IF TG_OP = 'INSERT' OR NEW.orden_id IS DISTINCT FROM OLD.orden_id OR NEW.numero IS NULL THEN
       SELECT COALESCE(max(numero), 0) + 1 INTO NEW.numero FROM tareas WHERE orden_id = NEW.orden_id AND id <> COALESCE(NEW.id, 0);
     END IF;
     NEW.codigo := (SELECT codigo FROM ordenes WHERE id = NEW.orden_id) || '.' || NEW.numero;
     RETURN NEW;
   END $f$`,
  `DROP TRIGGER IF EXISTS planea_codigo_tarea ON tareas`,
  `CREATE TRIGGER planea_codigo_tarea BEFORE INSERT OR UPDATE OF orden_id ON tareas FOR EACH ROW EXECUTE FUNCTION planea_codigo_tarea()`,
  // al cambiar el código de un proyecto, sus OTs se renumeran (conservando su secuencia)
  `CREATE OR REPLACE FUNCTION planea_codigo_proyecto() RETURNS trigger LANGUAGE plpgsql AS $f$
   BEGIN
     IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
       UPDATE ordenes o SET codigo = planea_num_proyecto(NEW.id) || '.' || split_part(o.codigo, '.', 2)
        WHERE o.proyecto_id = NEW.id AND o.codigo ~ '^[0-9-]+\\.\\d+$';
     END IF;
     RETURN NEW;
   END $f$`,
  `DROP TRIGGER IF EXISTS planea_codigo_proyecto ON proyectos`,
  `CREATE TRIGGER planea_codigo_proyecto AFTER UPDATE OF codigo ON proyectos FOR EACH ROW EXECUTE FUNCTION planea_codigo_proyecto()`,

  // 2026-11 · Seguimiento de talleres externos: cada taller de una OT tiene su enlace (sin cuenta) para decir
  // cómo van sus tareas (estado, avance, fecha prevista, comentario, fotos, a quién lo entrega). Se envía al pulsar
  // «Comenzar seguimiento». Si pasa su fecha sin terminar, recordatorio por correo una vez al día.
  `CREATE TABLE IF NOT EXISTS ext_seguimientos (
     id              SERIAL PRIMARY KEY,
     orden_id        INT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
     proveedor_id    INT NOT NULL REFERENCES proveedores(id) ON DELETE CASCADE,
     nonce           TEXT NOT NULL,
     email           TEXT,
     activo          BOOLEAN NOT NULL DEFAULT TRUE,
     iniciado_por    INT REFERENCES usuarios(id) ON DELETE SET NULL,
     iniciado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
     enviado_en      TIMESTAMPTZ,
     visto_en        TIMESTAMPTZ,
     actualizado_en  TIMESTAMPTZ,
     recordatorio_en DATE,
     n_recordatorios INT NOT NULL DEFAULT 0,
     UNIQUE (orden_id, proveedor_id)
   )`,
  `ALTER TABLE tareas ADD COLUMN IF NOT EXISTS ext_estado TEXT CHECK (ext_estado IN ('sin_empezar','en_curso','terminado','entregado')),
     ADD COLUMN IF NOT EXISTS ext_fin_prevista DATE,
     ADD COLUMN IF NOT EXISTS ext_entregado_a TEXT,
     ADD COLUMN IF NOT EXISTS ext_entregado_proveedor_id INT REFERENCES proveedores(id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS ext_entrega_fecha DATE,
     ADD COLUMN IF NOT EXISTS ext_entrega_nota TEXT,
     ADD COLUMN IF NOT EXISTS ext_recibido DATE`,
  `CREATE TABLE IF NOT EXISTS ext_novedades (
     id              SERIAL PRIMARY KEY,
     tarea_id        INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
     seguimiento_id  INT REFERENCES ext_seguimientos(id) ON DELETE SET NULL,
     texto           TEXT NOT NULL,
     creado          TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS ext_novedades_tarea_idx ON ext_novedades (tarea_id, creado DESC)`,

  // 2026-11 · Subcontratación: petición de presupuesto y pedido a un taller externo con tareas de una OT (+ transporte…).
  // Usan las mismas peticiones de precio y pedidos de compra, con tipo 'subcontratacion', su OT y líneas enlazadas a tareas.
  `ALTER TABLE pedidos_compra ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'material' CHECK (tipo IN ('material','subcontratacion')),
     ADD COLUMN IF NOT EXISTS orden_id INT REFERENCES ordenes(id) ON DELETE SET NULL`,
  `ALTER TABLE solicitudes_precio ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'material' CHECK (tipo IN ('material','subcontratacion')),
     ADD COLUMN IF NOT EXISTS orden_id INT REFERENCES ordenes(id) ON DELETE SET NULL`,
  `ALTER TABLE pedido_compra_lineas ADD COLUMN IF NOT EXISTS tarea_id INT REFERENCES tareas(id) ON DELETE SET NULL`,
  `ALTER TABLE solicitud_lineas ADD COLUMN IF NOT EXISTS tarea_id INT REFERENCES tareas(id) ON DELETE SET NULL`,
  `ALTER TABLE tareas ADD COLUMN IF NOT EXISTS ext_pedido_id INT REFERENCES pedidos_compra(id) ON DELETE SET NULL,
     ADD COLUMN IF NOT EXISTS ext_solicitud_id INT REFERENCES solicitudes_precio(id) ON DELETE SET NULL`,
];

async function migrar() {
  for (const sql of MIGRACIONES) await query(sql);
}

module.exports = { migrar };
