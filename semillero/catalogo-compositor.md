# Catálogo para el compositor · HAM Menorca

Nombres exactos que entiende el planificador s360 al importar un proyecto (formato `s360-import/1`).
Sacado del servidor (administrador.hamenorca.com) el 14/11/2026. Si se usan estos nombres tal cual, la
importación los reconoce sin preguntar.

## Cómo usar cada campo de una tarea

| Campo | Qué poner | Ejemplo |
|---|---|---|
| `horas` | Duración de la tarea (de reloj, no horas-persona), en medias horas | `6` |
| `operarios` | Personas a la vez (horas-persona = horas × operarios). `0` si no lleva gente propia (p. ej. un lacado externo) | `2` |
| `oficio` | Un **oficio** de la lista de abajo. Lo deben tener los operarios | `"Oficial 1ª Soldador"` |
| `area` | Un **área** concreta de la lista de abajo, si la tarea se hace en un sitio fijo | `"Potro de grandes estructuras"` |
| `area_tipo` | Si no se sabe el área concreta: `taller`, `pintura`, `oficina`, `obra`, `transporte`. **`obra` = en la obra del cliente** (el planificador crea esa área con la dirección del proyecto) | `"obra"` |
| `requiere` | Lo que necesita además de la gente. Lo normal: `{ "tipo_recurso": "…", "clase": "maquina", "cantidad": 1 }` con un **tipo** de la lista. Un recurso concreto `{ "recurso": "…" }` solo si tiene que ser ese y no otro | `{ "tipo_recurso": "Soldadora MIG/MAG", "clase": "maquina" }` |

`clase` es `operario`, `maquina` o `subcontrata`.

## Áreas de trabajo (`area`)

**Departamento técnico** (oficina, un ocupante a la vez)
- Puesto técnico 1 · Puesto técnico 2 · Puesto técnico 3 · Puesto técnico 4 · Puesto técnico 5 · Puesto técnico 6

**Departamento de herrería**
- Sierra semiautomática 1: corte de perfiles largos
- Cizalla de chapas: cortar chapas
- Plegadora de chapas: plegar chapas
- Cizalla universal: punzonado, sacabocados, corte de placas y ángulos
- Fresadora: perforación (como taladro de columna)
- Torno: tornear piezas
- Curvadora de perfiles: curvado de perfiles largos
- Tablero con prensa: mecanizado pequeño
- Mesa de pequeña estructura 1 · Mesa de pequeña estructura 2: armado de estructuras
- Potro de grandes estructuras: armado de estructuras grandes
- Cabina de pintura portátil: pintura

**Departamento administrativo** (oficina)
- Puesto administrativo 1 · Puesto administrativo 2 · Puesto administrativo 3 · Puesto administrativo 4 · Sala de reuniones

**Departamento de aluminio**
- Tablero de aluminio: corte, mecanizado y preparación de perfiles de aluminio
- Mesa de montaje de aluminio: montaje de carpintería de aluminio

**Logística y transporte**
- Transporte: cargas, entregas y traslados a obra

**En la obra del cliente:** no tiene nombre fijo; usar `"area_tipo": "obra"`.

> Si el compositor pide una máquina fija del taller como requisito (cizalla, plegadora, sierra, fresadora,
> torno, curvadora, punzonadora…), el planificador la convierte en el área de la tarea. Es mejor ponerla
> directamente en `area`.

## Oficios (`oficio`, o `requiere` con `"clase": "operario"`)

**Producción (taller y obra)**
| Oficio | Personas que lo tienen |
|---|---|
| Encargado | 2 |
| Oficial 1ª Soldador | 1 |
| Oficial 2º | 2 |
| Oficial 3º | 2 |
| Oficial de aluminio | 1 |
| Pintor | 1 |
| Oficial Montaje Obra | **0: nadie lo tiene todavía.** Si se usa, el planificador avisará de que falta gente |

**Oficina**
| Oficio | Personas |
|---|---|
| Ingeniero / Delineante | 1 |
| Diseñadora | 1 |
| Jefe de proyectos | 2 |
| Responsable Técnico | 1 |
| Director comercial | 1 |
| Director Administrativo | 1 |
| Administrativo | 2 |
| Resp. Administrativa | 1 |
| Resp. Logística | 1 |
| Resp. RRHH | 1 |

## Tipos de máquina, vehículo y herramienta (`requiere` con `"clase": "maquina"`)

| Tipo | Cuántas hay | Cuáles |
|---|---|---|
| Soldadora MIG/MAG | 3 | MIG-500, MIG-300, MIG-200 portátil |
| Soldadora MMA (electrodo) | 2 | MMA-1, MMA-2 |
| Soldadora TIG | 1 | TIG-200 |
| Soldadora láser | 1 | Láser-1500 |
| Taladro magnético | 2 | Taladro magnético 1, Taladro magnético 2 |
| Llave de impacto | 2 | Llave de impacto 1, Llave de impacto 2 |
| Remachadora | 2 | Remachadora a batería, Remachadora fuerte |
| Remachadora de tuercas | 1 | Remachadora de tuercas |
| Kit de medición | 1 | Maletín de medición |
| Equipo de pintura (airless / pistola) | 1 | Pistola Sagola |
| Cortadora de disco (aluminio) | 1 | Cortadora de disco |
| Punzonadora de lamas y troqueles | 1 | Punzonadora de lamas |
| Fresadora de cerraduras | 1 | Fresadora de cerraduras |
| Impresora 3D | 1 | Impresora 3D |
| Andamio | 1 | Andamio 6 m |
| Carretilla elevadora (toro) | 2 | Toro diésel, Toro a batería |
| Camión | 1 | Camión Iveco 3,5 t |
| Furgón / furgoneta | 6 | Furgón Nissan, Furgoneta 1 a 5 |
| Equipo portátil para obra | 12 | Agrupa lo que se puede llevar a obra (MIG-200 portátil, MMA, taladros magnéticos, llaves de impacto, remachadoras, maletín, andamio) |

## Subcontratas y alquileres (`requiere` con `"clase": "subcontrata"`)

| Tipo | Proveedor dado de alta |
|---|---|
| Grúa | Grúa 1 (Grúas Mahón) |
| Plataforma elevadora | Plataforma (Elevaciones Illa) |
| Transporte externo | Transporte (Transportes Ciutadella) |
| Lacado / taller externo | Taller externo (Lacados Menorca) |
| Cristalería / Vidrio Aislante Acústico | ninguno todavía |
| Fábrica Cortizo Sistemas de Carpintería | ninguno todavía |

## Herramientas que no hace falta pedir

Siempre hay de sobra; si vienen en `requiere`, el planificador las ignora: amoladora / radial,
lijadora orbital, rotomartillo / taladro percutor, taladro, atornillador de impacto, caja de
herramientas, herramienta manual, kit de ventosas y acuñado.

## Personas (solo si una tarea tiene que hacerla alguien concreto)

Lo normal es pedir un **oficio**, no una persona. Si hace falta fijarla: `{ "recurso": "<nombre>" }`.

Adrian Carbo · Adriana Montoya · Alfonzo Perez · Carlos Julio Vargas Gomez · Carolina Valverdi ·
Eduardo · Estiven Rojas · Fernando Lopez · Javier Lopez · Jose Gomez · Jose Sanchez · Juan Robles ·
Mariana Montenegro · Martin Sánchez · Pablo S. Sánchez · Sergio Vidaurre · Sofia Klasberg

## Ejemplo de tarea

```json
{
  "ref_externa": "P-2026-0060/03/OT-02/T-04",
  "nombre": "Armado y soldadura de barandilla",
  "horas": 6,
  "operarios": 2,
  "oficio": "Oficial 1ª Soldador",
  "area": "Mesa de pequeña estructura 1",
  "requiere": [
    { "tipo_recurso": "Soldadora MIG/MAG", "clase": "maquina", "cantidad": 1 }
  ],
  "despues_de": [{ "ref": "P-2026-0060/03/OT-02/T-03" }]
}
```
