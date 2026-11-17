# Importación de proyectos · formato `s360-import/2`

Contrato entre el **compositor de proyectos** (presupuesto → proyecto, partidas, OTs y tareas) y el
**planificador s360**. El compositor genera un archivo JSON por proyecto; el planificador lo importa
y lo deja todo listo para trabajar:

- las **tareas** en «Por planificar» del tablero, con sus horas, área, lo que tienen que saber hacer
  los operarios (capacidades), los equipos, las herramientas y el desglose de tiempos;
- el **material** de cada partida en el escandallo, ya repartido entre las tareas que lo consumen, y
  (si se indica) enviado a logística para que revise stock.

| Archivo | Qué es |
|---|---|
| `README.md` | Esta especificación |
| `esquema.json` | JSON Schema (draft 2020-12) para validar los archivos antes de exportarlos |
| `ejemplo.json` | Archivo completo y válido (escalera exterior: 2 partidas, 3 OTs, 10 tareas, 12 materiales) |
| `catalogo.json` · `catalogo.md` | Nombres exactos que entiende el planificador (áreas, capacidades, equipos, materiales…). Copia del día; la versión viva está en `GET /api/importar/catalogo` |

> El planificador valida con una copia de `esquema.json` en `app/src/importacion-esquema.json`:
> si se cambia uno, hay que copiarlo al otro.

> **v1 sigue valiendo.** Un archivo con `"formato": "s360-import/1"` se importa igual que antes. La v2
> solo añade campos opcionales; ver «Versiones» al final.

---

## 1. Estructura

```
proyecto
├─ condiciones[]                  Condiciones previas (anticipo, RAL confirmado…)
└─ partidas[]                     Partida del presupuesto
   ├─ materiales[]                ← v2 · Escandallo: todo el material de la partida
   └─ ots[]                       OT (orden de trabajo)
      └─ tareas[]                 Lo que se planifica en el tablero
         ├─ horas, operarios      Duración y personas a la vez
         ├─ area | area_tipo      Dónde se hace
         ├─ desglose[]            ← v2 · Cómo se calcula el tiempo
         ├─ capacidades[]         ← v2 · Qué tienen que saber hacer los operarios
         ├─ equipos[]             ← v2 · Máquinas de las que hay pocas (por tipo)
         ├─ subcontratas[]        ← v2 · Grúa, plataforma, lacado… (por tipo)
         ├─ herramientas[]        ← v2 · Herramientas de mano a preparar
         ├─ materiales[]          ← v2 · Qué material de la partida consume y cuánto
         └─ despues_de[]          Tareas que van antes (+ espera)
```

- **Un archivo = un proyecto.** UTF-8, extensión `.json` (recomendado `<ref_externa>.s360.json`).
- El **orden** de los arrays es el orden en que se muestran.
- Nombres de campo en minúsculas y `snake_case`. **No se admiten campos desconocidos**; lo propio del
  compositor (importes, mediciones) va en `extra`.

## 2. Identificadores: `ref_externa`

Cada proyecto, partida, **material**, OT y tarea lleva una `ref_externa`: su id **en el compositor**.

- **Estable**: el mismo elemento exporta siempre la misma `ref_externa` aunque cambie su nombre,
  cantidad u horas. Es lo que permite **reimportar sin duplicar**.
- **Única** en todo el sistema dentro de su nivel. Recomendado componerla:
  `PRES-2026-0061` → `PRES-2026-0061/01` → `PRES-2026-0061/01/M03` (material) →
  `PRES-2026-0061/01/OT1` → `PRES-2026-0061/01/OT1/T3`.
- Máx. 80 caracteres, sin espacios al principio ni al final.

`codigo` (opcional) es el código **visible** del proyecto, partida u OT. Sin él, el planificador
asigna `PR-###` y `OT-####`.

## 3. Campos

**●** obligatorio · ○ opcional · **v2** = nuevo en esta versión.

### Raíz

| Campo | | Tipo | Notas |
|---|---|---|---|
| `formato` | ● | `"s360-import/2"` | (o `"s360-import/1"`) |
| `generado` | ○ | fecha-hora ISO 8601 | |
| `origen` | ○ | `{sistema, version, usuario}` | Informativo. |
| `proyecto` | ● | objeto | |

### `proyecto`

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref_externa` | ● | texto ≤ 80 | |
| `codigo` | ○ | texto ≤ 30 | Código visible (`P-2026-0061`). |
| `nombre` | ● | texto ≤ 120 | |
| `cliente` | ○ | texto ≤ 120 | |
| `obra` | ○ | texto ≤ 200 | Dirección. Da nombre al **área de obra** del proyecto (§5). |
| `notas` | ○ | texto ≤ 4000 | |
| `condiciones` | ○ | textos ≤ 200 | Salen como **pendientes de confirmar** en el proyecto y en cada tarea. |
| `partidas` | ● | array ≥ 1 | |
| `extra` | ○ | objeto | Libre. |

### `partidas[]`

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref_externa` | ● | texto ≤ 80 | |
| `codigo` | ○ | texto ≤ 30 | `01`, `C4.001`… |
| `nombre` | ● | texto ≤ 120 | |
| `materiales` | ○ **v2** | array de material | El **escandallo** de la partida (abajo). |
| `enviar_a_logistica` | ○ **v2** | sí/no | `true` = el técnico ya lo ha revisado en el compositor: al importar se envía a logística (le llega un aviso para revisar stock). Por defecto `false`: el técnico lo revisa en el planificador y pulsa «Enviar a logística». |
| `ots` | ● | array ≥ 1 | |
| `extra` | ○ | objeto | |

#### `materiales[]` (v2) · escandallo de la partida

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref_externa` | ● | texto ≤ 80 | La usan las tareas para decir qué consumen. |
| `descripcion` | ● | texto ≤ 200 | Mejor el **nombre exacto del catálogo** (`"Tubo cuadrado 40×40×2 S235"`): así se enlaza solo. |
| `catalogo` | ○ | texto ≤ 120 | Nombre del catálogo si la descripción es otra (`"descripcion": "Tubo 40x40 zancas", "catalogo": "Tubo cuadrado 40×40×2 S235"`). |
| `cantidad` | ● | número > 0 | **Total de la partida**, con mermas. Decimales con punto. |
| `unidad` | ○ | texto ≤ 20 | `barra`, `ud`, `m`, `m²`, `kg`, `l`, `chapa`, `bobina`… (la del catálogo). |
| `nota` | ○ | texto ≤ 1000 | Calidad, acabado, RAL, longitudes de corte… |
| `enlaces` | ○ | URLs (≤ 10) | Ficha técnica, catálogo del proveedor. |
| `extra` | ○ | objeto | Precio, proveedor habitual… (no se interpreta). |

### `ots[]`

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref_externa` | ● | texto ≤ 80 | |
| `codigo` | ○ | texto ≤ 30 | Sin él → `OT-####`. |
| `titulo` | ● | texto ≤ 120 | |
| `descripcion` | ○ | texto ≤ 4000 | |
| `prioridad` | ○ | `urgente` \| `alta` \| `normal` \| `baja` | |
| `fecha_entrega` | ○ | `AAAA-MM-DD` | |
| `color` | ○ | `#rrggbb` | |
| `tareas` | ● | array ≥ 1 | |
| `extra` | ○ | objeto | |

### `tareas[]`

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref_externa` | ● | texto ≤ 80 | |
| `nombre` | ● | texto ≤ 120 | |
| `horas` | ● | número > 0, ≤ 999, **múltiplo de 0,5** | **Duración** (horas de reloj), no horas-persona. |
| `operarios` | ○ | entero 0–50 | Personas a la vez (por defecto 1). **Horas-persona = horas × operarios.** `0` si no lleva gente propia (lacado externo). |
| `area` | ○ | texto ≤ 120 | Área concreta, por nombre (§5). Las máquinas fijas del área (sierra, plegadora, cabina…) van solas con la tarea. |
| `area_tipo` | ○ | `taller` \| `pintura` \| `oficina` \| `obra` \| `transporte` \| `otro` | Cuando no se sabe el área concreta. `obra` = la obra de este proyecto. |
| `desglose` | ○ **v2** | array de tiempo | Cómo sale el tiempo (abajo). |
| `capacidades` | ○ **v2** | array | Lo que tienen que saber hacer (abajo). |
| `equipos` | ○ **v2** | array | Máquinas de las que hay pocas, por tipo. |
| `subcontratas` | ○ **v2** | array | Subcontratas y alquileres, por tipo. |
| `herramientas` | ○ **v2** | array | Herramientas de mano. |
| `materiales` | ○ **v2** | array | Material de la partida que consume. |
| `despues_de` | ○ | array | Tareas que van antes (§3.6). |
| `requiere` | ○ | array | *Forma v1*, se sigue aceptando (`tipo_recurso`, `recurso`). En v2 usar `equipos` / `subcontratas`. |
| `oficio` | ○ | texto ≤ 120 | *Forma v1*: categoría (Oficial 1ª…). En v2 lo que se pide es `capacidades`. |
| `notas` | ○ | texto ≤ 4000 | |
| `extra` | ○ | objeto | |

#### 3.1 `desglose[]` (v2) · tiempos

De dónde salen las horas de la tarea. Es informativo: se ve en el detalle de la tarea y sirve para
revisar el presupuesto, pero **lo que se planifica es `horas` × `operarios`**.

| Campo | | Tipo | Notas |
|---|---|---|---|
| `concepto` | ● | texto ≤ 200 | `"Soldadura de nudos"` |
| `horas_persona` | ● | número > 0 | Horas-persona de este concepto. |
| `fase` | ○ | `preparacion` \| `fabricacion` \| `soldadura` \| `montaje` \| `acabado` \| `control` \| `transporte` \| `otros` | Para informes. |
| `cantidad` | ○ | número > 0 | Medición: `14` |
| `unidad` | ○ | texto ≤ 20 | `nudos`, `m`, `m²`, `cortes`… |
| `rendimiento` | ○ | número > 0 | h-persona por unidad: `0.75` |

**Reglas (avisos, no errores):**
- La suma de `horas_persona` debe cuadrar con `horas × operarios` (±10 %).
- Si vienen `cantidad` y `rendimiento`, `cantidad × rendimiento ≈ horas_persona` (±15 %).

**Cómo pasar del desglose a `horas`:** `horas = redondear_arriba_a_0,5( Σ horas_persona / operarios )`.
Ejemplo: 24 h-persona con 2 operarios → `"horas": 12, "operarios": 2`.

#### 3.2 `capacidades[]` (v2) · qué tienen que saber hacer

Sustituye a `oficio`. Se pide lo que hay que **saber hacer**, no la categoría. El tablero avisa si a
la tarea se asigna alguien que no lo tiene y propone a quien sí.

| Forma | Significado |
|---|---|
| `"Soldadura MIG/MAG (acero)"` | 1 persona que lo sepa hacer. |
| `{ "capacidad": "Armado y punteado de estructuras", "cantidad": 2 }` | 2 a la vez. `cantidad` ≤ `operarios`. |
| `{ "capacidad": "Montaje de muro cortina", "familia": "Montaje en obra" }` | Si no existe, `familia` dice dónde crearla. |

Nombres: ver `catalogo.json` → `capacidades` (≈ 80, por familias: Soldadura, Herrería y calderería,
Carpintería de aluminio y PVC, Pintura y acabados, Montaje en obra, Uso de maquinaria, Elevación,
altura y vehículos, Herramientas portátiles, Seguridad y formación, Oficina técnica).

#### 3.3 `equipos[]` y `subcontratas[]` (v2)

Se piden por **tipo**; en el tablero se asigna cuál y se controla que no esté en dos sitios a la vez.

| Forma | Significado |
|---|---|
| `"Taladro magnético"` | 1 unidad del tipo. |
| `{ "tipo": "Soldadora MIG/MAG", "cantidad": 2 }` | 2 a la vez. |

- `equipos` → **tipos de máquina** (familia y uso en el catálogo: Soldadura, Corte y mecanizado,
  Fijación y montaje, Elevación y acceso, Vehículos y transporte, Medición, Pintura…).
- `subcontratas` → tipos de subcontrata o alquiler (Grúa, Plataforma elevadora, Lacado…).
- **No pedir aquí las máquinas fijas** (sierra, plegadora, cizalla, cabina de pintura…): se pone la
  tarea en su `area` y la máquina va sola.

#### 3.4 `herramientas[]` (v2) · herramientas de mano

Lo que el operario tiene que preparar (radial, sargentos, nivel, arnés…). No se controla cuántas
hay; el operario las marca como preparadas en Mi día.

| Forma | Ejemplo |
|---|---|
| `"Radial pequeña 115/125"` | |
| `{ "nombre": "Sargentos (juego)", "cantidad": 4, "nota": "de 1 m" }` | |

Nombres: `catalogo.json` → `herramientas`. Si se pone aquí algo que es un equipo contado (taladro
magnético, soldadora…), se importa pero avisa: debería ir en `equipos`.

#### 3.5 `materiales[]` de la tarea (v2) · qué consume

| Campo | | Tipo | Notas |
|---|---|---|---|
| `ref` | ● | texto ≤ 80 | `ref_externa` de una línea de `materiales` de **cualquier partida del archivo**. |
| `cantidad` | ● | número > 0 | Cuánto consume esta tarea, en la unidad de la línea. |

- La suma de lo que consumen las tareas no debería pasar de la `cantidad` de la línea (aviso).
- Un material puede no estar asignado a ninguna tarea (lo asignará el encargado en «Asignar»).
- Con esto el operario ve en Mi día qué material necesita y si ya está en almacén, y el tablero avisa
  si un material pedido llega después del día planificado.

#### 3.6 `despues_de[]` · dependencias

`"despues_de": ["…/T1", { "ref": "…/T3", "espera_h": 24 }]`

- La tarea empieza **después** de que terminen las indicadas (de cualquier OT o partida del archivo).
- `espera_h` (múltiplo de 0,5, ≤ 720): horas **de calendario** de espera (secado, curado). No son trabajo.

## 4. Ejemplo de tarea completa

```json
{
  "ref_externa": "PRES-2026-0061/01/OT1/T3",
  "nombre": "Armado y soldadura de zancas y peldaños",
  "horas": 12,
  "operarios": 2,
  "area": "Potro de grandes estructuras",
  "capacidades": [
    { "capacidad": "Armado y punteado de estructuras", "cantidad": 2 },
    { "capacidad": "Soldadura MIG/MAG (acero)", "cantidad": 1 }
  ],
  "equipos": [{ "tipo": "Soldadora MIG/MAG", "cantidad": 2 }],
  "herramientas": ["Sargentos (juego)", "Escuadra magnética (soldadura)", "Radial pequeña 115/125"],
  "materiales": [
    { "ref": "PRES-2026-0061/01/M06", "cantidad": 1 },
    { "ref": "PRES-2026-0061/01/M07", "cantidad": 1 }
  ],
  "despues_de": ["PRES-2026-0061/01/OT1/T1", "PRES-2026-0061/01/OT1/T2"],
  "desglose": [
    { "concepto": "Armado y punteado de peldaños", "fase": "fabricacion", "cantidad": 14, "unidad": "peldaños", "rendimiento": 0.5, "horas_persona": 7 },
    { "concepto": "Soldadura de nudos", "fase": "soldadura", "cantidad": 14, "unidad": "nudos", "rendimiento": 0.75, "horas_persona": 10.5 },
    { "concepto": "Repasado y amolado de soldaduras", "fase": "acabado", "horas_persona": 6.5 }
  ]
}
```
24 h-persona / 2 operarios = 12 h de duración.

## 5. Cómo se resuelven los nombres

`area`, `capacidades`, `equipos`, `subcontratas`, `oficio` y `requiere` se buscan en lo dado de alta
en el planificador, **sin distinguir mayúsculas, acentos ni espacios dobles**. Lo que no existe **no
hace fallar** la importación: la vista previa lo enseña y deja elegir.

| Qué falta | Por defecto | Otras opciones |
|---|---|---|
| Capacidad | Si se parece a una existente, **asociarla**; si no, **crearla** (en `familia` o «Otras») | Asociar a otra · no pedirla |
| Tipo de máquina o subcontrata | Parecida → asociar; si no → crearla (sin unidades) | Asociar · ignorar |
| Recurso concreto (`requiere.recurso`) | Ignorar (aviso) | Asociar |
| Área por nombre | Parecida → asociar; si no, sin área (aviso) | Crearla · asociar |
| `area_tipo: "obra"` | **Crear** «Obra · ‹dirección›» (o usar la del proyecto) | Asociar |
| Material sin coincidencia en el catálogo | Se importa con su descripción (no hace falta que esté en el catálogo) | — |
| Herramienta sin coincidencia en el catálogo | Se importa con su nombre | — |

Las asociaciones elegidas se **recuerdan** para las siguientes importaciones.

## 6. Importar y reimportar

Siempre en dos pasos: **vista previa** (no cambia nada) y **confirmar** (todo o nada).

**Reimportación** (mismo `proyecto.ref_externa`): se compara por `ref_externa`.

| Caso | Qué pasa |
|---|---|
| Nuevo en el archivo | Se crea. |
| Ya existe | Se actualiza con lo del archivo (el archivo manda). |
| Tarea / OT / partida que ya no viene | Si no tiene planificación → se borra. Si tiene tramos o está en curso → se conserva marcada «fuera de presupuesto». |
| **Material** que ya no viene | Si logística no lo ha tocado ni se ha asignado a mano → se borra. Si ya está revisado, pedido o recibido → se conserva marcado «fuera de presupuesto» y avisa. |
| **Cantidad** de un material que logística ya revisó o compras pidió | Se actualiza y **avisa** para que lo revisen. |
| `capacidades` de la tarea | Si el campo viene, sustituye a las que tenía. Si no viene, no se tocan. |
| `herramientas` / `materiales` de la tarea | Se reponen las que vinieron de una importación; **lo añadido a mano en el planificador se conserva**. |
| `desglose` | Se sustituye. |
| Planificación, operarios asignados, estado, stock, pedidos | **Nunca se tocan.** |

## 7. Errores y avisos

**Errores** (no se importa nada): no cumple `esquema.json`; `ref_externa` repetida; `despues_de` a
una tarea que no está o dependencias en círculo; `materiales[].ref` de una tarea que no está en
ninguna partida del archivo (o repetida en la misma tarea); `ref_externa` que ya es de otro proyecto.

**Avisos** (se puede importar): nombres que no existen (§5), desglose que no cuadra, material
repartido de más, capacidad que pide más personas que `operarios`, herramienta que es un equipo,
cantidad cambiada de algo ya revisado/pedido, fecha de entrega pasada, tarea sin operarios ni equipos.

Cada error/aviso lleva la ruta, p. ej. `proyecto.partidas[0].ots[1].tareas[2].desglose: …`.

## 8. API del planificador

Sesión con permiso «proyectos». `Content-Type: application/json`, máx. 2 MB.

| Método | Ruta | Qué hace |
|---|---|---|
| `GET` | `/api/importar/catalogo` | **Nombres exactos** que entiende: áreas (con su equipo fijo), capacidades, equipos (familia, uso, unidades), subcontratas, categorías, materiales y herramientas del catálogo. Para sincronizar el compositor. |
| `POST` | `/api/importar?simular=1` | Vista previa. No cambia nada. |
| `POST` | `/api/importar` | Importa (transacción). |

Cuerpo: el archivo tal cual, o `{ "archivo": {…}, "resoluciones": { "capacidad:corte con sierra de cinta": { "accion": "asociar", "id": 12 } } }`.

Respuesta (resumen):
```json
{
  "ok": true, "simulado": true,
  "proyecto": { "accion": "crear", "codigo": "P-2026-0061", "ref_externa": "PRES-2026-0061" },
  "resumen": {
    "partidas": { "crear": 2 }, "ots": { "crear": 3 }, "tareas": { "crear": 10 },
    "materiales": { "crear": 12 }, "asignaciones_material": 13, "a_logistica": 1,
    "capacidades": 16, "equipos": 7, "herramientas": 12, "desgloses": 10,
    "horas": 50.5, "horas_persona": 78.5, "dependencias": 10
  },
  "resolver": [ { "clave": "capacidad:corte con sierra de cinta", "clase": "capacidad", "nombre": "Corte con sierra de cinta", "accion": "asociar", "estado": "parecido", "opciones": [ … ] } ],
  "avisos": [], "errores": []
}
```

## 9. Checklist para el compositor

- [ ] `formato` = `"s360-import/2"`.
- [ ] `ref_externa` **estable y única** en proyecto, partidas, materiales, OTs y tareas.
- [ ] `horas` = duración en medias horas; `operarios` = personas a la vez. Si se calcula en
      horas-persona: `horas = ⌈Σ desglose.horas_persona / operarios⌉₀,₅`.
- [ ] `desglose` con los conceptos que dan el tiempo (cuadra con `horas × operarios`).
- [ ] `capacidades` (no `oficio`) con los nombres del catálogo; `cantidad` ≤ `operarios`.
- [ ] Máquinas fijas → `area`. Equipos de los que hay pocos → `equipos`. Grúa, plataforma, lacado →
      `subcontratas`. Herramienta de mano → `herramientas`.
- [ ] Material de la partida en `partidas[].materiales` (cantidad total con mermas, unidad del catálogo);
      cada tarea dice en `materiales` qué consume (refs del archivo).
- [ ] `enviar_a_logistica: true` solo si el técnico ya revisó el escandallo.
- [ ] Fechas `AAAA-MM-DD`; decimales con punto.
- [ ] Validar contra `esquema.json` antes de exportar y sincronizar nombres con
      `GET /api/importar/catalogo`.

```bash
npx ajv-cli validate --spec=draft2020 -c ajv-formats -s esquema.json -d mi-proyecto.s360.json
```

## 10. Versiones

- **`s360-import/2`** (2026-11-17): material de la partida (`partidas[].materiales`,
  `enviar_a_logistica`); por tarea `desglose`, `capacidades`, `equipos`, `subcontratas`,
  `herramientas`, `materiales`. `oficio` y `requiere` siguen aceptándose. Catálogo en
  `GET /api/importar/catalogo`.
- `s360-import/1` (2026-11-12): proyecto, partidas, OTs, tareas con horas, operarios, oficio, área,
  requisitos, dependencias y condiciones. Se sigue aceptando.

Previsto: fecha «no antes de» por OT y varios proyectos por archivo.
