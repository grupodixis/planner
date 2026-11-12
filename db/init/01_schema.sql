-- s360_planificacion · esquema inicial (fase 1: tablero operativo diario)

CREATE TABLE usuarios (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  nombre        TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  rol           TEXT NOT NULL DEFAULT 'planificador'
                CHECK (rol IN ('admin', 'planificador', 'consulta')),
  activo        BOOLEAN NOT NULL DEFAULT TRUE,
  creado        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE sesiones (
  token       TEXT PRIMARY KEY,
  usuario_id  INT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira      TIMESTAMPTZ NOT NULL
);

-- Operarios, maquinaria propia y subcontratas / alquileres
CREATE TABLE recursos (
  id          SERIAL PRIMARY KEY,
  tipo        TEXT NOT NULL CHECK (tipo IN ('operario', 'maquina', 'subcontrata')),
  nombre      TEXT NOT NULL,
  codigo      TEXT,                 -- nº de empleado, nº de máquina…
  categoria   TEXT,                 -- oficio / tipo de máquina / subcontrata o alquiler
  empresa     TEXT,                 -- proveedor (subcontratas y alquileres)
  telefono    TEXT,
  email       TEXT,
  coste_hora  NUMERIC(8,2),
  linea_id    INT,                  -- área habitual (FK añadida tras crear lineas)
  notas       TEXT,
  activo      BOOLEAN NOT NULL DEFAULT TRUE,
  creado      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tipo, nombre)
);

-- Áreas de trabajo (filas del calendario): una obra, una zona del taller,
-- la oficina técnica, la cabina de pintura…
CREATE TABLE lineas (
  id         SERIAL PRIMARY KEY,
  nombre     TEXT NOT NULL UNIQUE,
  tipo       TEXT NOT NULL DEFAULT 'taller',  -- taller | obra | oficina | pintura | transporte | otro
  ubicacion  TEXT,
  orden      INT NOT NULL DEFAULT 0,
  activo     BOOLEAN NOT NULL DEFAULT TRUE
);

ALTER TABLE recursos ADD FOREIGN KEY (linea_id) REFERENCES lineas(id);

CREATE TABLE proyectos (
  id       SERIAL PRIMARY KEY,
  codigo   TEXT NOT NULL UNIQUE,
  nombre   TEXT,
  cliente  TEXT,
  obra     TEXT,                                -- ubicación / dirección
  notas    TEXT,
  estado   TEXT NOT NULL DEFAULT 'activo',      -- activo | cerrado
  creado   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Órdenes de trabajo (OT): agrupan las tareas que se planifican en el tablero
CREATE TABLE ordenes (
  id             SERIAL PRIMARY KEY,
  codigo         TEXT NOT NULL UNIQUE,
  titulo         TEXT NOT NULL,
  descripcion    TEXT,
  proyecto_id    INT REFERENCES proyectos(id),
  partida        TEXT,
  prioridad      INT NOT NULL DEFAULT 3,        -- 1 = urgente … 4 = baja
  fecha_entrega  DATE,
  color          TEXT NOT NULL DEFAULT '#5aa9f0',
  estado         TEXT NOT NULL DEFAULT 'abierta', -- abierta | cerrada
  creado         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Tareas de una OT: lo que se planifica. Una tarea larga se reparte en varios tramos.
CREATE TABLE tareas (
  id             SERIAL PRIMARY KEY,
  orden_id       INT NOT NULL REFERENCES ordenes(id) ON DELETE CASCADE,
  nombre         TEXT NOT NULL,
  duracion_h     NUMERIC(4,1) NOT NULL CHECK (duracion_h > 0),   -- horas totales
  operarios_req  INT NOT NULL DEFAULT 1,
  linea_id       INT REFERENCES lineas(id),     -- área por defecto
  estado         TEXT NOT NULL DEFAULT 'pendiente'
                 CHECK (estado IN ('pendiente', 'planificada', 'en_curso', 'hecha')),
  orden_en_of    INT NOT NULL DEFAULT 0,
  actualizado    TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por INT REFERENCES usuarios(id)
);

-- Máquinas / subcontratas que la tarea necesita (p. ej. "MIG 1", "Plataforma")
CREATE TABLE tarea_requisitos (
  tarea_id   INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  recurso_id INT NOT NULL REFERENCES recursos(id),
  PRIMARY KEY (tarea_id, recurso_id)
);

-- Tramos planificados de una tarea (un bloque del tablero: día, hora, horas, área)
CREATE TABLE tramos (
  id               SERIAL PRIMARY KEY,
  tarea_id         INT NOT NULL REFERENCES tareas(id) ON DELETE CASCADE,
  fecha            DATE NOT NULL,
  hora_inicio      NUMERIC(4,2) NOT NULL,       -- horas decimales: 9.5 = 09:30
  duracion_h       NUMERIC(4,1) NOT NULL CHECK (duracion_h > 0),
  linea_id         INT REFERENCES lineas(id),
  creado           TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_por  INT REFERENCES usuarios(id)
);
CREATE INDEX tramos_fecha_idx ON tramos (fecha);
CREATE INDEX tramos_tarea_idx ON tramos (tarea_id);

-- Recursos asignados a cada tramo (lo que se arrastra desde la izquierda)
CREATE TABLE tramo_asignaciones (
  tramo_id     INT NOT NULL REFERENCES tramos(id) ON DELETE CASCADE,
  recurso_id   INT NOT NULL REFERENCES recursos(id),
  asignado     TIMESTAMPTZ NOT NULL DEFAULT now(),
  asignado_por INT REFERENCES usuarios(id),
  desde        NUMERIC(4,2),                  -- franja del recurso dentro del tramo;
  hasta        NUMERIC(4,2),                  -- NULL = todo el tramo
  PRIMARY KEY (tramo_id, recurso_id)
);

-- Registro de cambios (quién movió qué y cuándo)
CREATE TABLE historial (
  id          BIGSERIAL PRIMARY KEY,
  usuario_id  INT REFERENCES usuarios(id),
  tarea_id    INT REFERENCES tareas(id) ON DELETE SET NULL,
  accion      TEXT NOT NULL,
  detalle     JSONB,
  creado      TIMESTAMPTZ NOT NULL DEFAULT now()
);
