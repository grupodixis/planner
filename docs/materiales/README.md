# Materiales · escandallo estimado, BOM real, corte y existencias

Cómo pasa el material de **lo estimado en el presupuesto** a **lo que hay que pedir**, rápido y sin teclear dos veces.

```
Compositor ──(s360-import/1, tarea.materiales)──► ESTIMADO por tarea
Onshape → IA ──(s360-bom/1, se pega en la OT)──► BOM real por tarea
                                                    │
                     agrupa por perfil + material + acabado (toda la OT)
                     optimiza el corte en barras (6 m, sierra 3 mm)
                                                    │
                     Almacén (Sergio) dice cuánto hay ──► lo que falta = A PEDIR
                     fecha en que hace falta (1.ª tarea planificada) ──► «pedir antes del» (Tragina)
```

## Criterio

1. **Cada línea va ligada a la tarea que la consume** (corte, montaje, pintura…). Así el sistema sabe *cuándo* hace falta el material: la primera fecha planificada de esa tarea.
2. **El técnico sube piezas, no compras.** Una línea por pieza distinta (marca, perfil, material, acabado, longitud, ángulos, cantidad). El sistema calcula las barras.
3. **Nombres normalizados.** «Tubo rect. 50×10×1,5», «TUBO 50x10x1.5 mm» → `TUBO 50x10x1.5`. Material y acabado van separados. Así el mismo material se agrupa siempre igual (y, más adelante, stock y precios).
4. **Acabado = cómo se compra** (negro, sendzimir, galvanizado, satinado…). **Tratamiento = lo que se le hace después** (galvanizado en caliente, pintura…), informativo: no cambia lo que se pide. «G+P» en el acabado se entiende como tratamiento.
5. **Con BOM se pide por el BOM**; sin BOM, por lo estimado (metros pasados a barras, sin optimizar).
6. **Almacén dice cuánto hay por material agrupado**, no pieza a pieza: «No hay», «Hay todo» o el número exacto.

## Formato del BOM: `s360-bom/1`

Se pega en **Materiales → (OT) → Importar BOM**, como JSON o como tabla copiada de Excel / Notion (con cabecera). Ejemplo completo: [`ejemplo-bom.json`](ejemplo-bom.json). Instrucciones para la IA (Antigravity u otra) que convierte el BOM de Onshape: [`app/public/instrucciones-bom.txt`](../../app/public/instrucciones-bom.txt) (también en el diálogo de importar → «copiarlas»).

```json
{
  "formato": "s360-bom/1",
  "ot": "OT-0245",
  "tarea": "Corte de perfiles",
  "piezas": [
    { "marca": "B1", "perfil": "TUBO 50x10x1.5", "material": "S235", "acabado": "negro", "tratamiento": "galv_caliente",
      "longitud_mm": 1180, "angulo_a": 90, "angulo_b": 45, "cantidad": 24 }
  ],
  "comerciales": [
    { "descripcion": "Tornillo DIN 933 M12x40 A2", "familia": "ferreteria", "cantidad": 60, "unidad": "ud", "tarea": "Montaje" }
  ]
}
```

| Campo | Pieza | Comercial | Notas |
|---|---|---|---|
| `marca` | ✓ | | Marca en el plano |
| `perfil` | obligatorio* | opcional | Ver tabla de perfiles. *O `descripcion` |
| `descripcion` | | obligatorio* | Texto libre del artículo |
| `material` | ✓ | ✓ | S235, S275, S355, INOX 304, INOX 316L, ALUMINIO 6063… |
| `acabado` | ✓ | ✓ | negro, sendzimir, galvanizado, satinado, brillo, mate, bruto, anodizado, lacado |
| `tratamiento` | ✓ | | galv_caliente, pintura, galv_pintura, pasivado, ninguno |
| `familia` | (se deduce) | ✓ | largos, chapas, ferreteria, pintura, consumibles, tableros, paneles, vidrio, electrico, otros |
| `longitud_mm` | ✓ | | Longitud de corte (punta larga en ingletes) |
| `angulo_a`, `angulo_b` | ✓ | | Grados, 0–180 (90 = recto) |
| `cantidad` | obligatorio | obligatorio | |
| `unidad` | (ud) | ✓ | ud, m, m2, kg, l, barra, caja, rollo, juego |
| `peso_kg` | ✓ | | Peso de una pieza |
| `tarea` | ✓ | ✓ | Nombre (o parte) de la tarea de la OT; si falta, la de por defecto |
| `notas` | ✓ | ✓ | |

**Tabla pegada:** primera fila con los nombres de columna. Se aceptan sinónimos: *ref/pieza* → marca, *largo/L/longitud* → longitud_mm, *cant/uds* → cantidad, *calidad* → material, *ang. a* → angulo_a, etc. Separador: tabulador (copiar de Excel/Notion), `;` o `,`.

**Perfiles reconocidos** (se normalizan solos):

| Tipo | Se escribe | Ejemplos que entiende |
|---|---|---|
| Tubo rect./cuadrado | `TUBO 50x10x1.5` | «Tubo rect. 50×10×1,5», «tubo cuadrado 40x2» → `TUBO 40x40x2` |
| Tubo redondo | `TUBO Ø42.4x2` | «Tubo redondo 42,4x2» |
| Vigas | `IPE 200`, `UPN 100`, `HEB 120` | «UPN-100» |
| Angular | `L 40x40x4` | «Angular 40x4» |
| Pletina | `PLETINA 40x10` | «Pletina 10x40», «llanta 40x10» |
| Redondo macizo | `REDONDO Ø8` | «Macizo diam 8» |
| Cuadrado macizo | `CUADRADO 12` | «Cuadradillo 12» |
| T, U plegada, correas | `T 40x40x5`, `U 60x30x3`, `C 120x50x15x2` | |
| Varilla roscada | `VARILLA ROSCADA M12` | barra por defecto de 1 m |
| Chapa | `CHAPA 3` | «chapa lagrimada 3/5» → `CHAPA LAGRIMADA 3` |

Lo que no se reconoce se agrupa por el texto tal cual y sale un aviso.

## Estimado desde el compositor (`s360-import/1`)

Cada tarea puede traer `materiales` (ver `docs/importacion/esquema.json`, `$defs.material`). Si el archivo la trae, **sustituye** el estimado anterior de esa tarea; si no la trae, no se toca.

```json
"tareas": [{
  "ref_externa": "T-245-01", "nombre": "Corte de perfiles", "horas": 6,
  "materiales": [
    { "perfil": "TUBO 50x10x1.5", "material": "S235", "acabado": "negro", "cantidad": 43, "unidad": "m" },
    { "perfil": "PLETINA 40x10", "material": "S235", "cantidad": 4, "unidad": "m" },
    { "descripcion": "Esmalte alquídico negro satinado", "familia": "pintura", "cantidad": 4, "unidad": "l" }
  ]
}]
```

Largos estimados: en **metros** (`m`) o **barras** (`barra`). La pantalla **Estimado vs real** compara metros de pieza del BOM con los estimados (en rojo, más de un 10 % por encima).

## Optimización de corte

- Mejor ajuste decreciente (*best-fit decreasing*): instantáneo y a 1–2 % del óptimo en listas de taller.
- Cada pieza gasta su longitud + la sierra (3 mm). Una pieza que ocupa justo lo que queda no gasta el último corte.
- Barra comercial: 6 m por defecto (varilla roscada, 1 m); el técnico la puede cambiar por material (12 m, 3 m…).
- Sobrantes desde 300 mm = retal aprovechable (se listan).
- Piezas más largas que la barra: aviso (empalme o barra más larga) y se cuentan como barras enteras.
- **Imprimir corte** saca el plano de corte de todas las barras para el taller.

## Fechas: «pedir antes del» (Menorca Tragina)

Fecha necesaria = primera fecha planificada de las tareas que consumen el material. Con Tragina: llega el **miércoles**; hay que pedir antes del **viernes anterior a las 16:00**; se deja **1 día** de margen entre la llegada y el uso. Si ya no da tiempo, se marca en rojo («Luchana / local»). Entrega en Ydica Transportes (Gavà) a nombre de Dixis. Todo configurable en **Materiales → Ajustes**.

## Permisos y roles

| Permiso | Qué permite | Roles nuevos |
|---|---|---|
| `materiales` | Importar y editar el BOM, barra comercial, ajustes | Técnico (Sofía) |
| `almacen` | Apuntar existencias (pantalla Almacén, pensada para el móvil) | Almacén (Sergio) |
| `compras` | Proveedores (y, en la fase 2, pedidos y correo de compras) | Compras |

Al importar un BOM, quien tenga `almacen` recibe un aviso push («Material a revisar · OT-…»).

## API

| Método | Ruta | Qué hace |
|---|---|---|
| GET | `/api/materiales/opciones` | Familias, acabados, tratamientos, unidades y ajustes |
| PUT | `/api/materiales/ajustes` | Barra, sierra, retal, Tragina |
| GET | `/api/materiales/ots` | OTs con material: revisados, a pedir, fecha necesaria |
| GET | `/api/ordenes/:id/materiales` | Líneas, grupos con corte optimizado, existencias, fechas |
| POST | `/api/ordenes/:id/materiales/importar` | `{texto, tarea_id, simular, ignorar_errores, origen}` |
| POST | `/api/ordenes/:id/materiales` | Añadir una línea |
| PATCH / DELETE | `/api/materiales/:id` | Corregir / quitar una línea |
| PUT | `/api/ordenes/:id/materiales/grupo` | `{clave, en_stock}` (almacén) o `{clave, barra_mm}` (técnico) |
| GET / POST / PATCH | `/api/proveedores[/:id]` | Proveedores |

## Fases

- **Fase 1 (hecha):** formato y normalización, BOM por tarea, corte optimizado, estimado vs real, existencias de almacén, proveedores (importados de Notion).
- **Fase 2:** pedidos a proveedores desde el sistema (PDF por correo desde compras@hamenorca.com, panel de ajustes del correo), transporte (proveedor / Tragina / Luchana / paquetería), recepción con foto del albarán, «falta material» en el tablero y «material a cargar» en Mi día.
- **Fase 3:** Onshape directo, precios y desvíos de coste.
- **Fase 4:** stock y retales.
