BEGIN;
CREATE TEMP TABLE mapa (patron TEXT, tipo TEXT);
INSERT INTO mapa VALUES
  ('%portones%', 'Taladro magnético'), ('%portones%', 'Llave de impacto'),
  ('%ventanas%', 'Kit de medición'),
  ('%paneles%', 'Llave de impacto'),
  ('Fijación mecánica oculta%', 'Llave de impacto'),
  ('Izado%', 'Llave de impacto'), ('Izado%', 'Kit de medición'),
  ('%correas%', 'Llave de impacto');
WITH meta AS (SELECT id FROM tipos_recurso WHERE clase = 'maquina' AND nombre = 'Equipo portátil para obra'),
 tareas_meta AS (SELECT q.tarea_id, t.nombre FROM tarea_requisitos_tipo q JOIN tareas t ON t.id = q.tarea_id WHERE q.tipo_recurso_id IN (SELECT id FROM meta)),
 destino AS (
   SELECT tm.tarea_id, ti.id AS tipo_id FROM tareas_meta tm JOIN mapa m ON tm.nombre ILIKE m.patron
     JOIN tipos_recurso ti ON ti.clase = 'maquina' AND ti.nombre = m.tipo
   UNION
   SELECT tm.tarea_id, ti.id FROM tareas_meta tm JOIN tipos_recurso ti ON ti.clase = 'maquina' AND ti.nombre = 'Llave de impacto'
    WHERE NOT EXISTS (SELECT 1 FROM mapa m WHERE tm.nombre ILIKE m.patron))
INSERT INTO tarea_requisitos_tipo (tarea_id, tipo_recurso_id, cantidad) SELECT tarea_id, tipo_id, 1 FROM destino ON CONFLICT DO NOTHING;
SELECT o.codigo, t.nombre, string_agg(ti.nombre, ', ' ORDER BY ti.nombre) AS ahora_pide
  FROM tarea_requisitos_tipo q JOIN tipos_recurso ti ON ti.id = q.tipo_recurso_id AND ti.clase = 'maquina' AND ti.nombre <> 'Equipo portátil para obra'
  JOIN tareas t ON t.id = q.tarea_id JOIN ordenes o ON o.id = t.orden_id
 WHERE q.tarea_id IN (SELECT tarea_id FROM tarea_requisitos_tipo WHERE tipo_recurso_id IN (SELECT id FROM tipos_recurso WHERE nombre = 'Equipo portátil para obra'))
 GROUP BY 1, 2 ORDER BY 1, 2;
DELETE FROM tarea_requisitos_tipo WHERE tipo_recurso_id IN (SELECT id FROM tipos_recurso WHERE clase = 'maquina' AND nombre = 'Equipo portátil para obra');
DELETE FROM tipos_recurso WHERE clase = 'maquina' AND nombre = 'Equipo portátil para obra';
COMMIT;
