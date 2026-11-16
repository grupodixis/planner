# Importación de proyectos · formato `s360-import/1`

Contrato entre el **compositor de proyectos** (presupuestos → proyecto, partidas y OTs) y el
**planificador s360**. El compositor genera un archivo JSON por proyecto; el planificador lo
importa y deja las tareas listas para arrastrar al tablero.

| Archivo | Qué es |
|---|---|
| `README.md` | Esta especificación |
| `esquema.json` | JSON Schema (draft 2020-12) para validar los archivos antes de exportarlos |
| `ejemplo.json` | Archivo completo y válido de ejemplo |

> El planificador valida con una copia de `esquema.json` en `app/src/importacion-esquema.json`:
> si se cambia uno, hay que copiarlo al otro.

> Estado: **especificación v1, importador hecho** (Proyectos y OTs → «Importar…»). Cualquier cambio de formato pasa por una versión nueva (ver «Versiones»).

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
| `obra` | ○ | texto ≤ 200 | Dirección / ubicación. Da nombre al **área de obra** del proyecto (ver §4). |
| `notas` | ○ | texto ≤ 4000 | |
| `condiciones` | ○ | array de textos ≤ 200 | Condiciones previas a confirmar antes de ejecutar (anticipo cobrado, RAL confirmado, pilares replanteados…). Salen como **pendientes** en el proyecto hasta que alguien las marca. |
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
| `oficio` | ○ | texto ≤ 120 | Especialidad de los operarios (p. ej. `Soldador`). Se convierte en el requisito **«`operarios` × oficio»** (tipo de recurso de clase operario). |
| `area` | ○ | texto ≤ 120 | Área de trabajo concreta, por **nombre** (ver §4). |
| `area_tipo` | ○ | `taller` \| `pintura` \| `oficina` \| `obra` \| `transporte` \| `otro` | Tipo de área, cuando no se sabe la concreta. `obra` = el área de la obra de este proyecto. Si vienen `area` y `area_tipo`, manda `area`. |
| `requiere` | ○ | array de requisitos | Máquinas / subcontratas necesarias (ver abajo). **No se ponen personas**: eso es `oficio` + `operarios`. |
| `despues_de` | ○ | array | Tareas que deben ir antes: `"ref_externa"` o `{ "ref": "…", "espera_h": 24 }`. |
| `notas` | ○ | texto ≤ 4000 | Se ven en el detalle de la tarea. |
| `extra` | ○ | objeto libre | |

**Ejemplo de horas:** una soldadura de 16 h con 2 operarios es `"horas": 16, "operarios": 2`
(8 h de calendario no: 16 h de duración, 32 horas-persona). Si el presupuesto calcula
horas-persona, el compositor debe dividir entre el número de operarios antes de exportar.

#### Requisitos (`requiere[]`)

Lo normal es pedir un **tipo de recurso** («una soldadora MIG», «una grúa»): al planificar vale
cualquier recurso de ese tipo, y si todavía no hay ninguno dado de alta el requisito se queda
como aviso leve. Un **recurso concreto** solo cuando tiene que ser ese y no otro.

| Forma | Significado |
|---|---|
| `{ "tipo_recurso": "Soldadora MIG/MAG" }` | 1 recurso de ese tipo, clase `maquina`. |
| `{ "tipo_recurso": "Soldadora MIG/MAG", "cantidad": 2 }` | 2 a la vez. `cantidad` 1–50. |
| `{ "tipo_recurso": "Lacado", "clase": "subcontrata" }` | Tipo de subcontrata o alquiler. `clase`: `maquina` (por defecto) \| `subcontrata`. |
| `{ "recurso": "MIG 1" }` | Ese recurso concreto. |
| `{ "nombre": "…", "tipo": "maquina" }` | *Forma antigua, se acepta:* = `{ "tipo_recurso": "…", "clase": "maquina" }`. |
| `"MIG 1"` | *Forma antigua, se acepta:* = `{ "recurso": "MIG 1" }`. |

Nombres hasta 120 caracteres. Los operarios no van aquí: `"oficio": "Soldador", "operarios": 2`
ya genera el requisito «2 × Soldador».

#### Dependencias (`despues_de[]`)

`"despues_de": ["…/T1", { "ref": "…/T3", "espera_h": 24 }]`

- La tarea debe empezar **después** de que terminen las indicadas. Pueden ser de otra OT o
  partida del mismo archivo.
- `espera_h` (múltiplo de 0,5, ≤ 720) son horas **de calendario** de espera (secado, curado,
  fraguado), no trabajo. No consumen horas de nadie.
- En el tablero se ven en el detalle de la tarea y, si un tramo se planifica antes de que acabe
  su predecesora (+ espera), aparece un aviso leve. El planificador no mueve nada solo.

## 4. Cómo se resuelven áreas y recursos

`area`, `oficio` y los nombres de `requiere` se buscan entre las **áreas de trabajo**, los
**tipos de recurso** y los **recursos** dados de alta en el planificador:

1. Coincidencia por nombre **sin distinguir mayúsculas, acentos ni espacios dobles**
   (`"taller  corte"` = `"Taller corte"`), dentro de la clase que toque (`oficio` → tipos de
   operario; `tipo_recurso` → tipos de máquina o subcontrata; `recurso` → recursos).
2. Si **no existe**, la importación **no falla**. La vista previa lo enseña y deja elegir qué hacer
   con cada nombre; las opciones por defecto son:

   | Qué falta | Por defecto | Otras opciones |
   |---|---|---|
   | Tipo de recurso u oficio | **Crearlo** (sin recursos todavía) | Asociar a uno existente · ignorar |
   | Recurso concreto | Ignorar (aviso) | Asociar a uno existente |
   | Área por nombre | Sin área (aviso) | Crearla · asociar a una existente |
   | `area_tipo: "obra"` | **Crear** el área «Obra · ‹obra del proyecto›» (o usarla si ya existe) | Asociar a una existente |
   | Otro `area_tipo` | Si hay un área de ese tipo, esa; si hay varias o ninguna, sin área (aviso) | Elegir una |

3. Las asociaciones elegidas («Soldadora 1» → «MIG 1») **se recuerdan** para las siguientes
   importaciones.
4. Una tarea sin área se importa sin área: se planifica soltándola en cualquier fila.

## 5. Importar y reimportar

La importación siempre tiene dos pasos: **vista previa** (no cambia nada) y **confirmar**.

**Primera importación:** se crea el proyecto (con sus condiciones), las partidas, una OT por cada
`ots[]` y sus tareas con horas, operarios, área, requisitos, dependencias y notas. Aparecen en
«OTs prioritarias» del tablero.

**Reimportación** (mismo `proyecto.ref_externa`): se compara elemento a elemento por `ref_externa`.

| Caso | Qué pasa |
|---|---|
| Elemento nuevo en el archivo | Se crea. |
| Elemento que existe | Se actualizan sus datos (nombre, horas, operarios, área, requisitos, dependencias, notas, prioridad, entrega…). |
| Horas que bajan por debajo de lo ya planificado | Se aceptan; en el tablero se verá como **exceso** sobre lo estimado. |
| Tarea que ya no está en el archivo | Si **no** tiene nada planificado → se borra. Si tiene tramos en el tablero o está en curso/hecha → **se conserva** y se marca «ya no está en el presupuesto» para que decidas. |
| OT o partida que ya no está | Igual: se borra si está vacía de planificación; si no, se conserva y se marca. |
| Condiciones | Se añaden las nuevas; las que ya estaban conservan su marca de cumplida; las que desaparecen del archivo se quitan. |
| Cambios hechos a mano en el planificador | Los campos que vienen en el archivo **mandan** (se sobrescriben). Lo que el archivo no trae (planificación, recursos asignados, estado, color si no se envía) **no se toca**. |

La vista previa enseña el resumen antes de confirmar: «se crean 2 OTs y 9 tareas · se actualizan
3 tareas (horas 12 → 16…) · 1 tarea ya no está en el presupuesto pero tiene 8 h planificadas ·
aviso: el recurso "Soldadora 1" no existe».

## 6. Errores y avisos

- **Error** (el archivo se rechaza entero, no se importa nada): no cumple `esquema.json`
  (falta un campo obligatorio, campo desconocido, horas que no son múltiplo de 0,5, fecha mal
  escrita, `formato` distinto…) o hay `ref_externa` repetidas dentro del archivo.
- **Error** también: `despues_de` que apunta a una tarea que no está en el archivo, o
  dependencias en círculo (A después de B y B después de A).
- **Aviso** (se puede importar): área, tipo o recurso que no existe (ver §4), tarea con
  `operarios: 0` sin ningún requisito, fecha de entrega pasada.

Cada error/aviso indica la ruta del elemento, p. ej.
`proyecto.partidas[0].ots[1].tareas[2].horas: 2.3 no es múltiplo de 0,5`.

## 7. API del planificador

Requiere sesión iniciada con rol `admin` o `planificador`. `Content-Type: application/json`, máx. 2 MB.

| Método | Ruta | Qué hace |
|---|---|---|
| `POST` | `/api/importar?simular=1` | Vista previa: valida y devuelve qué se crearía/actualizaría, qué nombres hay que resolver, errores y avisos. No cambia nada. |
| `POST` | `/api/importar` | Importa (todo o nada, en una transacción). Devuelve el mismo informe y el id del proyecto. |

El cuerpo puede ser el archivo tal cual, o `{ "archivo": {…}, "resoluciones": {…} }` para decir
qué hacer con los nombres que no existen:

```json
{
  "archivo": { "formato": "s360-import/1", "proyecto": { … } },
  "resoluciones": {
    "tipo:maquina:Sierra de Cinta / Tronzadora de Perfiles": { "accion": "asociar", "id": 3 },
    "area:Taller Metalúrgico": { "accion": "asociar", "id": 1 },
    "recurso:Soldadora 1": { "accion": "ignorar" }
  }
}
```

Respuesta (resumen):
```json
{
  "ok": true,
  "simulado": true,
  "proyecto": { "accion": "crear", "ref_externa": "PRES-2026-0045", "codigo": "PR-2026-045" },
  "resumen": { "partidas": { "crear": 2, "actualizar": 0 }, "ots": { "crear": 3, "actualizar": 0 }, "tareas": { "crear": 9, "actualizar": 0, "borrar": 0, "baja": 0 } },
  "resolver": [ { "clave": "tipo:maquina:Camión grúa", "clase": "tipo", "nombre": "Camión grúa", "accion": "crear", "usos": 1, "opciones": [ … ] } ],
  "avisos": [ { "ruta": "proyecto.partidas[0].ots[0].tareas[2].requiere[0]", "mensaje": "El recurso «Soldadora 1» no existe" } ],
  "errores": []
}
```

## 8. Checklist para el compositor

- [ ] `formato` = `"s360-import/1"`.
- [ ] Cada proyecto, partida, OT y tarea tiene una `ref_externa` **estable y única**.
- [ ] `horas` = duración de la tarea en **medias horas** (redondear hacia arriba a 0,5).
- [ ] `operarios` = personas a la vez (no meter horas-persona en `horas`).
- [ ] `requiere` pide **tipos** de recurso (`tipo_recurso`, con `cantidad` si son varios); recurso
      concreto solo si tiene que ser ese. Nada de personas en `requiere`: eso es `oficio`.
- [ ] Área por nombre (`area`) si se conoce; si no, `area_tipo` (`obra` para lo que se hace en obra).
- [ ] `despues_de` solo apunta a tareas del mismo archivo; las esperas (secado…) en `espera_h`.
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
  - *2026-11-12* (compatible): `requiere` por tipo de recurso con `cantidad` y recurso concreto
    explícito; `oficio` pasa a ser requisito; `area_tipo` con área de obra automática;
    `despues_de` se aplica y admite `espera_h`; `proyecto.condiciones`; nombres hasta 120
    caracteres. Las formas antiguas de `requiere` se siguen aceptando.
- Cambios **compatibles** (nuevos campos opcionales) se añaden sin cambiar de versión y se
  anotan aquí.
- Cambios **incompatibles** (renombrar, cambiar tipos o significado) crean `s360-import/2`; el
  planificador seguirá aceptando la versión anterior durante un tiempo.

Previsto para versiones futuras: fechas «no antes de» por OT y varios proyectos por archivo.
