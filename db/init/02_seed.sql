-- Datos de ejemplo (los del boceto). Se planifican en la fecha de hoy
-- para que el tablero tenga contenido nada más arrancar.

INSERT INTO lineas (nombre, tipo, orden) VALUES
  ('Taller corte', 'taller', 1), ('Taller armado', 'taller', 2),
  ('Transporte', 'transporte', 3), ('Obra montaje', 'obra', 4);

INSERT INTO recursos (tipo, nombre, codigo, categoria, empresa) VALUES
  ('operario', 'Operario 1', 'E-01', 'Soldador', NULL),
  ('operario', 'Operario 2', 'E-02', 'Montador', NULL),
  ('operario', 'Operario 3', 'E-03', 'Oficial cerrajero', NULL),
  ('maquina', 'Sierra 1', 'M-01', 'Sierra de cinta', NULL),
  ('maquina', 'MIG 1', 'M-02', 'Soldadora MIG', NULL),
  ('maquina', 'Láser', 'M-03', 'Corte láser', NULL),
  ('maquina', 'Corte Alu', 'M-04', 'Tronzadora aluminio', NULL),
  ('subcontrata', 'Taller externo', NULL, 'Subcontrata', 'Lacados Menorca'),
  ('subcontrata', 'Grúa 1', NULL, 'Alquiler', 'Grúas Mahón'),
  ('subcontrata', 'Plataforma', NULL, 'Alquiler', 'Elevaciones Illa'),
  ('subcontrata', 'Transporte', NULL, 'Subcontrata', 'Transportes Ciutadella');

INSERT INTO proyectos (codigo, nombre, cliente, obra) VALUES
  ('PR-001', 'Vivienda Calle Mayor', 'Cliente demo', 'Calle Mayor 12, Mahón');

INSERT INTO ordenes (codigo, titulo, proyecto_id, partida, prioridad, color) VALUES
  ('OT-1565', 'Pérgola 1',              1, 'Pérgola 1',     1, '#5aa9f0'),
  ('OT-0245', 'Barandilla galvanizada', 1, 'Barandilla P2', 2, '#e08a2a');

-- helpers
CREATE TEMP TABLE r AS SELECT id, nombre FROM recursos;
CREATE TEMP TABLE l AS SELECT id, nombre FROM lineas;

INSERT INTO tareas (orden_id, nombre, duracion_h, operarios_req, linea_id, orden_en_of) VALUES
  (1, 'Corte perfiles',        2,  1, (SELECT id FROM l WHERE nombre='Taller corte'),  1),
  (1, 'Armado y punteado',     5,  2, (SELECT id FROM l WHERE nombre='Taller armado'), 2),
  (1, 'Lacado (externo)',      3,  0, (SELECT id FROM l WHERE nombre='Transporte'),    3),
  (2, 'Transporte a obra',     2,  1, (SELECT id FROM l WHERE nombre='Transporte'),    1),
  (2, 'Montaje manual',        3,  2, (SELECT id FROM l WHERE nombre='Obra montaje'),  2),
  (2, 'Repaso y entrega',      1,  1, (SELECT id FROM l WHERE nombre='Obra montaje'),  3),
  (1, 'Soldadura estructura', 24,  1, (SELECT id FROM l WHERE nombre='Taller armado'), 4);

INSERT INTO tarea_requisitos (tarea_id, recurso_id) VALUES
  (1, (SELECT id FROM r WHERE nombre='Sierra 1')),
  (2, (SELECT id FROM r WHERE nombre='MIG 1')),
  (3, (SELECT id FROM r WHERE nombre='Taller externo')),
  (4, (SELECT id FROM r WHERE nombre='Grúa 1')),
  (5, (SELECT id FROM r WHERE nombre='Plataforma')),
  (7, (SELECT id FROM r WHERE nombre='MIG 1'));

-- Tramos de hoy (jornada 07:00–15:00). "Soldadura estructura" (24h) solo tiene el
-- primer tramo de 8h: las 16h restantes quedan pendientes para repartir.
INSERT INTO tramos (tarea_id, fecha, hora_inicio, duracion_h, linea_id) VALUES
  (1, CURRENT_DATE, 7,  2, (SELECT id FROM l WHERE nombre='Taller corte')),
  (2, CURRENT_DATE, 9,  5, (SELECT id FROM l WHERE nombre='Taller armado')),
  (4, CURRENT_DATE, 7,  2, (SELECT id FROM l WHERE nombre='Transporte')),
  (5, CURRENT_DATE, 11, 3, (SELECT id FROM l WHERE nombre='Obra montaje')),
  (7, CURRENT_DATE + 1, 7, 8, (SELECT id FROM l WHERE nombre='Taller armado'));

INSERT INTO tramo_asignaciones (tramo_id, recurso_id) VALUES
  (1, (SELECT id FROM r WHERE nombre='Operario 1')),
  (1, (SELECT id FROM r WHERE nombre='Sierra 1')),
  (2, (SELECT id FROM r WHERE nombre='Operario 1')),
  (2, (SELECT id FROM r WHERE nombre='Operario 2')),
  (2, (SELECT id FROM r WHERE nombre='MIG 1')),
  (3, (SELECT id FROM r WHERE nombre='Operario 2')),
  (3, (SELECT id FROM r WHERE nombre='Grúa 1')),
  (4, (SELECT id FROM r WHERE nombre='Operario 3')),
  (5, (SELECT id FROM r WHERE nombre='Operario 3')),
  (5, (SELECT id FROM r WHERE nombre='MIG 1'));
