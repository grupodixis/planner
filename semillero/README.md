# Semillero de recursos de la empresa · `s360-semillero/1`

Un único archivo, [`semillero.json`](semillero.json), describe **lo que tiene la empresa para
trabajar**: departamentos, áreas de trabajo, oficios, tipos de máquina, máquinas, vehículos,
personas y subcontratas. Lo usan dos programas:

- **El planificador s360** lo carga (Recursos → «Cargar semillero…») y deja el sistema igual que
  el archivo.
- **El compositor de proyectos** usa los mismos nombres al exportar (`area`, `oficio`,
  `requiere`), así la importación de proyectos no tiene que preguntar nada.

Esquema: [`esquema.json`](esquema.json) (JSON Schema 2020-12). El planificador valida con una
copia en `app/src/semillero-esquema.json`: si se cambia uno, hay que copiarlo al otro.

## 1. Qué hay en el archivo

| Sección | Qué es | En el planificador |
|---|---|---|
| `departamentos` | Técnico, Administrativo, Aluminio, Herrería, Logística | Bloques plegables del tablero, en este orden |
| `tipos.operario` | Oficios y cargos (Pintor, Oficial 1ª Soldador…) | Requisito «2 × Pintor» de una tarea |
| `tipos.maquina` | Tipos de máquina y vehículo (Soldadora MIG/MAG, Furgón / furgoneta…) | Requisito «una Soldadora MIG/MAG» |
| `tipos.subcontrata` | Tipos de subcontrata o alquiler (Grúa, Lacado…) | Requisito de subcontrata |
| `requisitos_sin_control` | Herramientas que siempre hay (radiales, taladros…) | Si se piden, no se convierten en requisito |
| `areas` | Filas del calendario: puestos, máquinas fijas, mesas, cabina, transporte | Áreas de trabajo |
| `recursos` | Personas, máquinas, vehículos y subcontratas concretos | Recursos (panel izquierdo) |
| `ubicaciones` | Almacenes y salas que no se planifican | No se cargan (para un futuro módulo de material) |
| `inventario_sin_planificar` | Radiales, cajas de herramientas… | Solo informativo |

### Áreas o recursos

- **Área** = un *sitio* fijo donde se hace la tarea (puesto, plegadora, potro, cabina). Es una
  fila del calendario. Con `"exclusiva": true` solo admite **un trabajo a la vez**: si coinciden
  dos, el tablero avisa y propone moverlo (puestos de oficina y máquinas fijas).
- **Recurso** = lo que se *asigna* a la tarea y va con ella (personas, soldadoras, taladros
  magnéticos, vehículos, andamio). El tablero avisa si está en dos sitios a la vez.
- **Las obras no están aquí**: son de cada proyecto (se crean al importarlo o al poner su
  dirección de obra).

### Puestos y ocupante habitual

Los puestos se nombran sin la persona («Puesto técnico 2») y cada persona lleva su puesto en
`area_habitual`. Si mañana alguien cambia de mesa, solo se cambia su `area_habitual`. Al
planificar una tarea en un puesto, «Solucionar» propone primero a quien lo tiene como puesto.

## 2. Para el compositor de proyectos

Al exportar un proyecto (`s360-import/1`, ver [`docs/importacion`](../docs/importacion/README.md)):

| Campo del proyecto | Qué poner |
|---|---|
| `tareas[].area` | El `nombre` de un área de aquí («Sierra semiautomática 1», «Mesa de montaje de aluminio»). Si no se sabe la concreta, `area_tipo`. |
| `tareas[].area_tipo: "obra"` | Lo que se hace en obra (va al área de obra del proyecto). |
| `tareas[].oficio` | El `nombre` de un `tipos.operario` («Oficial 1ª Soldador», «Pintor»). |
| `tareas[].requiere[]` | `{ "tipo_recurso": "<nombre de tipos.maquina o tipos.subcontrata>", "cantidad": n }` |

Reglas que aplica el planificador al importar:

1. **Nombres buenos o sus `alias`**: un tipo pedido por un alias (p. ej. «Equipo de Soldadura
   Semiautomática MIG/MAG») se asocia solo a su tipo («Soldadora MIG/MAG»).
2. **`alias_requisito` de las áreas**: si el compositor pide como recurso algo que aquí es un área
   («Sierra de Cinta / Tronzadora de Perfiles», «Taladro de columna»), la tarea va a esa área y no
   se crea un requisito.
3. **`requisitos_sin_control`**: si pide una herramienta que siempre hay (amoladora, lijadora,
   rotomartillo…), se ignora.
4. Lo que no encaje sale en la vista previa de la importación para decidir.

Lo más cómodo para el compositor es leer `semillero.json` y ofrecer en sus desplegables solo
`areas[].nombre`, `tipos.operario[].nombre`, `tipos.maquina[].nombre` y
`tipos.subcontrata[].nombre`.

## 3. Cargar o recargar el semillero

Recursos → **«Cargar semillero…»** (solo administrador). Primero sale una vista previa con todo
lo que va a cambiar; nada cambia hasta pulsar «Aplicar». Se puede cargar las veces que haga falta:
si el archivo no ha cambiado, no hace nada.

Al cargar:

- **Renombra en vez de duplicar**: busca cada área y recurso por su `ref`, por su nombre o por
  los nombres de `antes`. Así lo ya planificado sigue en su sitio.
- **Fusiona tipos repetidos**: los tipos con nombre de `alias` pasan al tipo bueno, con sus
  requisitos y sus recursos.
- **Lo que sobra**: si nunca se usó, se borra; si tiene historial (tramos planificados), se
  **desactiva**: desaparece de menús y del tablero salvo los días en que tiene trabajo.
- Los tramos de un área que desaparece pasan al puesto habitual de su operario, si lo tiene.
- Las tareas de un área que desaparece quedan **sin área** (se elige al planificar), salvo que su
  requisito diga a qué área van.
- **Las obras** y los proyectos no se tocan.
- Los campos de un recurso que no vienen en el archivo (teléfono, email, coste…) se conservan.

API: `POST /api/semillero?simular=1` (vista previa) y `POST /api/semillero` (aplicar), con el
archivo como cuerpo.

## 4. Pendiente de completar

- **Ubicación** de las áreas nuevas (dirección del taller u oficina).
- **Javier López**: sin oficio.
- **Alfonzo Pérez**: en el Puesto técnico 2 y con oficio «Oficial de aluminio». Confirmar si es
  así o si son dos personas.
- **«Oficial Montaje Obra»**: lo piden las tareas de montaje del compositor, pero nadie lo tiene.
  Añadirlo a los `oficios` de quien monte en obra.
- Habilitaciones (carretillero, PEMP, soldador homologado) como oficios, si se quieren exigir.
- Puente grúa o polipasto del taller, si lo hay.
