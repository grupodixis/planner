# Importación de proyectos · formato `s360-import/1`

Contrato entre el **compositor de proyectos** (presupuestos → proyecto, partidas y OTs) y el
**planificador s360**. El compositor genera un archivo JSON por proyecto; el planificador lo
importa y deja las tareas listas para arrastrar al tablero.

| Archivo | Qué es |
|---|---|
| `README.md` | Esta especificación |
| `esquema.json` | JSON Schema (draft 2020-12) para validar los archivos antes de exportarlos |
| `ejemplo.json` | Archivo completo y válido de ejemplo |

> Estado: **especificación v1**. El importador del planificador (pantalla y API) se construye
> sobre este documento. Cualquier cambio de formato pasa por una versión nueva (ver «Versiones»).

---

## 1. Estructura

```
proyecto                      → Proyecto
└─ partidas[]                 → Partida del presupuesto (agrupa OTs)
   └─ ots[]                   → OT (orden de trabajo)
      └─ tareas[]             → Tarea con horas estimadas (lo que se planifica en el tablero)
```

- **Un archivo = un proyecto.**
- Codificación **UTF-8**, extensión `.json` (recomendado `<ref_externa>.s360.json`).
- El **orden** de los arrays importa: es el orden en que se muestran partidas, OTs y tareas.
- Todos los nombres de campo van en minúsculas y `snake_case`. **No se admiten campos
  desconocidos** (para detectar errores de escritura); los datos propios del origen van en `extra`.

## 2. Identificadores: `ref_externa`

Cada proyecto, partida, OT y tarea lleva una `ref_externa`: su identificador **en el compositor**.

- Debe ser **estable**: el mismo elemento exporta siempre la misma `ref_externa`, aunque cambie su
  nombre, sus horas o su posición. Es lo que permite **reimportar sin duplicar**.
- Debe ser **única** dentro de su nivel en todo el sistema (no solo en el archivo). Se recomienda
  componerla jerárquicamente: `PRES-2026-0045` → `PRES-2026-0045/C4.001` →
  `PRES-2026-0045/C4.001/OT1` → `PRES-2026-0045/C4.001/OT1/T3`.
- Máximo 80 caracteres, sin espacios al principio ni al final.

Los **códigos visibles** (`codigo`) son otra cosa: si se envían, se usan como código del proyecto
u OT en el planificador; si no, el planificador asigna `PR-###` y `OT-####`.

## 3. Campos

Leyenda: **●** obligatorio · ○ opcional.

### Raíz

| Campo | | Tipo | Notas |
|---|---|---|---|
| `formato` | ● | `"s360-import/1"` | Exacto. |
| `generado` | ○ | fecha-hora ISO 8601 | Cuándo se exportó. |
| `origen` | ○ | `{sistema, version, usuario}` | Informativo (queda en el historial). |
| `proyecto` | ● | objeto | Ver abajo. |

### `proyecto`

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref_externa` | ● | texto ≤ 80 | Id. estable del presupuesto/proyecto. |
| `codigo` | ○ | texto ≤ 30 | Código visible. Sin él → `PR-###`. |
| `nombre` | ● | texto ≤ 120 | |
| `cliente` | ○ | texto ≤ 120 | |
| `obra` | ○ | texto ≤ 200 | Dirección / ubicación. |
| `notas` | ○ | texto ≤ 2000 | |
| `partidas` | ● | array (≥ 1) | |
| `extra` | ○ | objeto libre | Importes, etc. No se interpreta. |

### `partidas[]`

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref_externa` | ● | texto ≤ 80 | |
| `codigo` | ○ | texto ≤ 30 | Código de partida del presupuesto (p. ej. `C4.001`). |
| `nombre` | ● | texto ≤ 120 | Se muestra en cada OT como «Partida». |
| `ots` | ● | array (≥ 1) | |
| `extra` | ○ | objeto libre | Importe, medición… |

### `ots[]`

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref_externa` | ● | texto ≤ 80 | |
| `codigo` | ○ | texto ≤ 30 | Sin él → `OT-####`. |
| `titulo` | ● | texto ≤ 120 | |
| `descripcion` | ○ | texto ≤ 4000 | |
| `prioridad` | ○ | `urgente` \| `alta` \| `normal` \| `baja` | Por defecto `normal`. |
| `fecha_entrega` | ○ | `AAAA-MM-DD` | |
| `color` | ○ | `#rrggbb` | Color en el tablero. Sin él se asigna uno. |
| `tareas` | ● | array (≥ 1) | |
| `extra` | ○ | objeto libre | |

### `tareas[]`

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref_externa` | ● | texto ≤ 80 | |
| `nombre` | ● | texto ≤ 120 | |
| `horas` | ● | número > 0, ≤ 999, **múltiplo de 0,5** | **Duración** estimada de la tarea (no horas-persona). |
| `operarios` | ○ | entero 0–50 | Personas a la vez. Por defecto 1. **Horas-persona = horas × operarios.** `0` para trabajos que hace una subcontrata. |
| `area` | ○ | texto ≤ 80 | Área de trabajo por defecto, por **nombre** (ver §4). |
| `requiere` | ○ | array | Máquinas / subcontratas necesarias, por **nombre** o `{nombre, tipo}` con `tipo` = `maquina` \| `subcontrata`. **No se ponen personas**: quién hace cada tarea se decide al planificar. |
| `oficio` | ○ | texto ≤ 60 | Oficio recomendado (p. ej. `Soldador`). Informativo en v1. |
| `despues_de` | ○ | array de `ref_externa` | Tareas que deben ir antes. **Reservado**: v1 lo guarda pero aún no lo aplica. |
| `notas` | ○ | texto ≤ 2000 | |
| `extra` | ○ | objeto libre | |

**Ejemplo de horas:** una soldadura de 16 h con 2 operarios es `"horas": 16, "operarios": 2`
(8 h de calendario no: 16 h de duración, 32 horas-persona). Si el presupuesto calcula
horas-persona, el compositor debe dividir entre el número de operarios antes de exportar.

## 4. Cómo se resuelven áreas y recursos

`area` y los nombres de `requiere` se buscan entre las **áreas de trabajo** y los **recursos**
dados de alta en el planificador:

1. Coincidencia por nombre **sin distinguir mayúsculas, acentos ni espacios dobles**
   (`"taller  corte"` = `"Taller corte"`). Si se indica `tipo`, solo se busca en ese tipo.
2. Si **no existe**, la importación **no falla**: la vista previa lo marca como aviso y permite
   (a) crearlo, (b) asociarlo a uno existente, o (c) importar sin él. Las asociaciones elegidas se
   recuerdan para las siguientes importaciones (p. ej. «Soldadora 1» → «MIG 1»).
3. Una tarea sin `area` se importa sin área: se podrá planificar soltándola en cualquier fila.

## 5. Importar y reimportar

La importación siempre tiene dos pasos: **vista previa** (no cambia nada) y **confirmar**.

**Primera importación:** se crea el proyecto, una OT por cada `ots[]` (con su partida) y sus
tareas con horas, operarios, área y requisitos. Aparecen en «OTs prioritarias» del tablero.

**Reimportación** (mismo `proyecto.ref_externa`): se compara elemento a elemento por `ref_externa`.

| Caso | Qué pasa |
|---|---|
| Elemento nuevo en el archivo | Se crea. |
| Elemento que existe | Se actualizan sus datos (nombre, horas, operarios, área, requisitos, prioridad, entrega…). |
| Horas que bajan por debajo de lo ya planificado | Se aceptan; en el tablero se verá como **exceso** sobre lo estimado. |
| Tarea que ya no está en el archivo | Si **no** tiene nada planificado → se borra. Si tiene tramos en el tablero o está en curso/hecha → **se conserva** y se marca «ya no está en el presupuesto» para que decidas. |
| OT o partida que ya no está | Igual: se borra si está vacía de planificación; si no, se conserva y se marca. |
| Cambios hechos a mano en el planificador | Los campos que vienen en el archivo **mandan** (se sobrescriben). Lo que el archivo no trae (planificación, recursos asignados, estado, color si no se envía) **no se toca**. |

La vista previa enseña el resumen antes de confirmar: «se crean 2 OTs y 9 tareas · se actualizan
3 tareas (horas 12 → 16…) · 1 tarea ya no está en el presupuesto pero tiene 8 h planificadas ·
aviso: el recurso "Soldadora 1" no existe».

## 6. Errores y avisos

- **Error** (el archivo se rechaza entero, no se importa nada): no cumple `esquema.json`
  (falta un campo obligatorio, campo desconocido, horas que no son múltiplo de 0,5, fecha mal
  escrita, `formato` distinto…) o hay `ref_externa` repetidas dentro del archivo.
- **Aviso** (se puede importar): área o recurso que no existe, `despues_de` que apunta a una tarea
  que no está en el archivo, tarea con `operarios: 0` sin ningún requisito, fecha de entrega pasada.

Cada error/aviso indica la ruta del elemento, p. ej.
`proyecto.partidas[0].ots[1].tareas[2].horas: 2.3 no es múltiplo de 0,5`.

## 7. API del planificador

Requiere sesión iniciada con rol `admin` o `planificador`. Cuerpo: el JSON tal cual
(`Content-Type: application/json`, máx. 2 MB).

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/importar?simular=1` | Vista previa: valida y devuelve qué se crearía/actualizaría, errores y avisos. No cambia nada. |
| `POST` | `/api/importar` | Importa. Devuelve el mismo informe y el id del proyecto. |

Respuesta (resumen):
```json
{
  "ok": true,
  "simulado": true,
  "proyecto": { "accion": "crear", "ref_externa": "PRES-2026-0045", "codigo": "PR-2026-045" },
  "resumen": { "partidas": 2, "ots": { "crear": 3, "actualizar": 0 }, "tareas": { "crear": 9, "actualizar": 0, "huerfanas": 0 } },
  "avisos": [ { "ruta": "proyecto.partidas[0].ots[0].tareas[2].requiere[0]", "mensaje": "El recurso «Soldadora 1» no existe" } ],
  "errores": []
}
```

## 8. Checklist para el compositor

- [ ] `formato` = `"s360-import/1"`.
- [ ] Cada proyecto, partida, OT y tarea tiene una `ref_externa` **estable y única**.
- [ ] `horas` = duración de la tarea en **medias horas** (redondear hacia arriba a 0,5).
- [ ] `operarios` = personas a la vez (no meter horas-persona en `horas`).
- [ ] `area` y `requiere` usan los **nombres** que hay en el planificador
      (Recursos y Áreas de trabajo). Nada de personas en `requiere`.
- [ ] Fechas `AAAA-MM-DD`.
- [ ] Datos propios (importes, mediciones) solo dentro de `extra`.
- [ ] Validar contra `esquema.json` antes de exportar.

Validar desde la línea de comandos (Node):
```bash
npx ajv-cli validate --spec=draft2020 -c ajv-formats -s docs/importacion/esquema.json -d mi-proyecto.s360.json
```
o en Python: `jsonschema.validate(json.load(open(f)), json.load(open("esquema.json")))`.

## 9. Versiones

- `s360-import/1` — esta versión.
- Cambios **compatibles** (nuevos campos opcionales) se añaden sin cambiar de versión y se
  anotan aquí.
- Cambios **incompatibles** (renombrar, cambiar tipos o significado) crean `s360-import/2`; el
  planificador seguirá aceptando la versión anterior durante un tiempo.

Previsto para versiones futuras: aplicar `despues_de` (dependencias entre tareas), `oficio` como
filtro de operarios al planificar, fechas «no antes de» por OT y varios proyectos por archivo.
