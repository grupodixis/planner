# Catálogo para el compositor · HAM Menorca

Nombres exactos que entiende el planificador s360 al importar un proyecto (formato `s360-import/2`).
Sacado del servidor (administrador.hamenorca.com) el 17/11/2026. La lista viva y completa (con los 2858 materiales)
está en `GET /api/importar/catalogo` y en `catalogo.json`. Si se usan estos nombres tal cual, la importación
los reconoce sin preguntar; si no, la vista previa deja crearlos o asociarlos.

## Qué va en cada campo de la tarea

| Campo | Qué poner | Lista |
|---|---|---|
| `area` | Dónde se hace. Sus máquinas fijas van solas con la tarea | Áreas |
| `area_tipo` | Si no se sabe el área: `taller`, `pintura`, `oficina`, `obra`, `transporte`. `obra` = obra del cliente | — |
| `capacidades` | Lo que tienen que **saber hacer** (sustituye a `oficio`) | Capacidades |
| `equipos` | Máquinas **de las que hay pocas** y se mueven, por tipo | Equipos |
| `subcontratas` | Grúa, plataforma, lacado… por tipo | Subcontratas |
| `herramientas` | Herramientas **de mano** que el operario prepara (no se cuentan) | Herramientas |
| `materiales` | `{ref, cantidad}` del escandallo de la partida | Materiales (familias abajo) |

> **No pedir como equipo las máquinas fijas** (sierra, plegadora, cizalla, curvadora, cabina…): poner la tarea en su área.

## Áreas de trabajo (`area`)

**Departamento técnico**
- Puesto técnico 1 · _oficina_ — equipo fijo: Ordenador de pablo
- Puesto técnico 2 · _oficina_
- Puesto técnico 3 · _oficina_
- Puesto técnico 4 · _oficina_
- Puesto técnico 5 · _oficina_
- Puesto técnico 6 · _oficina_

**Departamento de herrería**
- Cizalla de chapas · _taller_
- Plegadora de chapas · _taller_
- Mesa de pequeña estructura 1 · _taller_
- Mesa de pequeña estructura 2 · _taller_
- Potro de grandes estructuras · _taller_
- Tablero con prensa · _taller_
- Sierra semiautomática 1 · _taller_ — equipo fijo: Sierra Semi automatica
- Cizalla universal · _taller_
- Fresadora · _taller_
- Torno · _taller_
- Cabina de pintura portátil · _pintura_ — equipo fijo: Pistola Sagola, Carpa de pintura, Compresor
- Curvadora de perfiles · _taller_

**Departamento administrativo**
- Puesto administrativo 1 · _oficina_
- Puesto administrativo 2 · _oficina_
- Puesto administrativo 3 · _oficina_
- Puesto administrativo 4 · _oficina_
- Sala de reuniones · _oficina_

**Departamento de aluminio**
- Tablero de aluminio · _taller_
- Mesa de montaje de aluminio · _taller_
- Cortadora de perfiles de aluminio · _taller_ — equipo fijo: cortadora de disco de aluminio

**Logística y transporte**
- Transporte · _transporte_

**En la obra del cliente:** no tiene nombre fijo; usar `"area_tipo": "obra"`.

## Capacidades (`capacidades`)

Entre paréntesis, personas que la tienen validada. Sin número = nadie todavía (el tablero avisará).

**Soldadura**

Soldadura MIG/MAG (acero) (8) · Soldadura TIG (inox / aluminio) (2) · Soldadura con electrodo (MMA) (2) · Soldadura láser (2) · Soldadura en posición / bajo techo · Corte por plasma · Oxicorte

**Herrería y calderería**

Interpretar planos de taller (2) · Trazado y marcado (2) · Corte de perfiles (sierra de cinta, tronzadora) (3) · Taladrado y roscado (2) · Doblado y curvado de perfiles (2) · Plegado de chapa (plegadora) (2) · Cizallado de chapa (2) · Armado y punteado de estructuras (2) · Escuadrado y control dimensional (2) · Repasado, amolado y acabado de soldaduras (2) · Forja / herrería artística (1) · Torno y fresadora (1)

**Carpintería de aluminio y PVC**

Corte de perfil de aluminio (ingletadora / cortadora de disco) (2) · Mecanizado de aluminio (punzonadora, fresadora de cerraduras) (1) · Ensamblado de ventanas y puertas de aluminio (1) · Herrajes y regulación de hojas · Persianas, mallorquinas y lamas · Acristalamiento (colocación y acuñado de vidrio) · Sellado con siliconas y espumas · Carpintería de PVC (1)

**Pintura y acabados**

Preparación de superficie (desengrase, lijado, chorreado) (2) · Imprimación (2) · Pintura con pistola aerográfica (3) · Pintura con equipo airless (1) · Pintura a brocha y rodillo (retoques en obra) (2) · Medición de espesores y control de calidad de pintura (1) · Galvanizado en frío / retoques de galvanizado (1)

**Montaje en obra**

Replanteo y toma de medidas en obra (1) · Nivelación y aplomado (láser) (1) · Anclajes químicos y mecánicos (1) · Montaje de premarcos (1) · Montaje de carpintería en obra (1) · Montaje de barandillas y escaleras · Montaje de estructura metálica · Montaje de cerramientos y fachadas · Remates y sellados de obra

**Uso de maquinaria**

Sierra de cinta / sierra semiautomática · Plegadora · Cizalla · Curvadora de perfiles · Taladro de columna · Taladro magnético · Punzonadora de lamas y troqueles · Cortadora de disco (aluminio) · Fresadora de cerraduras · Torno / fresadora

**Elevación, altura y vehículos**

Carretilla elevadora (toro) · Plataforma elevadora (PEMP) · Puente grúa / polipasto · Señalista de grúa / eslingado de cargas · Montaje de andamios · Trabajos en altura con arnés · Conducción de furgoneta · Conducción de camión (carnet C)

**Herramientas portátiles**

Radial / amoladora · Taladro y atornillador a batería · Rotopercutor / martillo perforador · Llave de impacto · Remachadoras (manual, a batería, de tuercas) · Sierra sable y de calar · Instrumentos de medición (flexómetro, calibre, nivel láser)

**Seguridad y formación**

PRL 20 h del metal · PRL 60 h (recurso preventivo) · Tarjeta Profesional de la Construcción (TPC) · Espacios confinados · Primeros auxilios · Trabajos en caliente (permiso de fuego)

**Oficina técnica y otros**

Diseño CAD / planos de fabricación (1) · Despiece y optimización de corte · Medición y presupuesto · Atención al cliente en obra · Control de calidad y documentación · On shape modelado (3)

## Equipos (`equipos`)

| Familia | Tipo | Uso | Unidades |
|---|---|---|---|
| Corte y mecanizado | Cortadora de disco (aluminio) | taller | 1 |
| Corte y mecanizado | Fresadora de cerraduras | taller | 1 |
| Corte y mecanizado | Punzonadora de lamas y troqueles | taller | 1 |
| Corte y mecanizado | Sierra semi automatica | taller | 1 |
| Elevación y acceso | Andamio | obra | 1 |
| Elevación y acceso | Carretilla elevadora (toro) | taller | 2 |
| Fijación y montaje | Llave de impacto | ambos | 2 |
| Fijación y montaje | Remachadora | ambos | 2 |
| Fijación y montaje | Remachadora de tuercas | ambos | 1 |
| Fijación y montaje | Taladro magnético | ambos | 2 |
| Medición | Kit de medición | ambos | 1 |
| Oficina técnica | Impresora 3D | taller | 1 |
| Pintura | Equipo de pintura (airless / pistola) | taller | 1 |
| Soldadura | Soldadora láser | taller | 1 |
| Soldadura | Soldadora MIG/MAG | ambos | 3 |
| Soldadura | Soldadora MMA (electrodo) | ambos | 2 |
| Soldadura | Soldadora TIG | taller | 1 |
| Vehículos y transporte | Camión | ambos | 1 |
| Vehículos y transporte | Furgón / furgoneta | ambos | 6 |

## Subcontratas y alquileres (`subcontratas`)

| Tipo | Proveedores dados de alta |
|---|---|
| Cristalería / Vidrio Aislante Acústico | ninguno todavía |
| Fábrica Cortizo Sistemas de Carpintería | ninguno todavía |
| Grúa | 1 |
| Lacado / taller externo | 1 |
| Plataforma elevadora | 1 |
| Transporte externo | 1 |

## Herramientas de mano (`herramientas`)

**Acceso y seguridad**: Arnés anticaídas · Botiquín · Casco · Conos · Escalera de tijera · Escalera extensible · Extintor · Línea de vida provisional · Redes de seguridad · Vallas / balizamiento de obra

**Añadidos**: punzon Ø14

**Corte**: Cizalla de palanca · Cizalla eléctrica (chapa) · Cortapernos · Radial a batería · Radial grande 230 · Radial pequeña 115/125 · Sierra de calar · Sierra de cinta portátil · Sierra de mano / arco de sierra · Sierra sable · Tijera de chapa

**Desbaste y acabado**: Amoladora recta · Cepillo de alambre manual · Lijadora de banda · Lijadora orbital · Limas (juego) · Pulidora / satinadora de inox

**Elevación y transporte**: Carro portaperfiles · Eslinga de cadena · Eslingas de poliéster (juego) · Garras de elevación de chapa · Gato hidráulico · Grilletes de elevación (juego) · Patines de carga · Polipasto manual de cadena · Puntales · Transpaleta · Tráctel / tirfor

**Energía y obra**: Alargadera / prolongador · Aspirador · Carretilla de obra · Cuadro eléctrico de obra · Focos de trabajo · Hidrolimpiadora · Pala y pico

**Medición y trazado**: Calibre (pie de rey) · Cinta métrica 30 m · Compás de puntas · Cámara / móvil para fotos de obra · Escuadra de taller · Escuadra magnética (soldadura) · Flexómetro 5 m · Flexómetro 8 m · Galgas de espesores · Goniómetro / transportador · Granete y punta de trazar · Medidor de espesor de pintura · Metro láser · Nivel de burbuja 2 m · Nivel de burbuja 60 cm · Nivel láser / láser de líneas · Nivel láser rotativo con trípode · Plomada · Tiralíneas

**Pintura**: Brochas (juego) · Manguera de aire · Pistola aerográfica · Pistola de sopleteado · Rodillos y bandeja

**Soldadura**: Aspirador de humos · Biombo / cortina de soldadura · Careta de soldar · Carro portabotellas · Equipo de limpieza electrolítica de inox · Manorreductor de gas · Manta ignífuga · Pinza de masa · Pistola MIG de recambio

**Sujeción y montaje**: Alicates (juego) · Bomba / cepillo de limpieza de taladros (anclajes) · Botador · Caja de herramientas de montaje · Carraca y vasos (juego) · Destornilladores (juego) · Imanes de soldadura · Llave de pilotes (fabricada) · Llave de pilotes (nueva) · Llave dinamométrica · Llave inglesa · Llaves Allen (juego) · Llaves fijas combinadas (juego) · Martillo · Maza · Mazo de goma · Mordazas / gatos de presión (juego) · Palanca / pata de cabra · Pistola de resina química · Pistola de silicona · Potro / borriquetas · Sargentos (juego) · Tornillo de banco · Ventosa para vidrio

**Taladro y roscado**: Atornillador de impacto · Avellanador / desbarbador · Martillo perforador SDS · Remachadora manual · Roscadora / juego de machos y terrajas · Taladro atornillador a batería · Taladro percutor

## Materiales (`partidas[].materiales`)

2858 artículos. Poner en `descripcion` (o en `catalogo`) el nombre exacto para que se enlace; si no está, se importa igual con su descripción. Familias:

| Familia | Artículos |
|---|---|
| Abrasivos y corte | 49 |
| Aluminio | 57 |
| Anclajes | 38 |
| Automatismos | 12 |
| Brocas y fresas | 99 |
| Chapas | 144 |
| Consumibles de taller y EPI | 24 |
| Correas | 82 |
| Elevación y amarre | 86 |
| Eléctrico | 14 |
| Gases | 7 |
| Herrajes | 63 |
| Maderas y tableros | 22 |
| Obra | 9 |
| Paneles y cubiertas | 32 |
| Perfiles inox | 15 |
| Perfiles laminados | 154 |
| Pinturas | 39 |
| Pletinas y macizos | 347 |
| Rejillas y mallas | 23 |
| Sellado y adhesivos | 18 |
| Soldadura | 61 |
| Tapones y embellecedores | 67 |
| Tornillería | 835 |
| Tubos acero | 357 |
| Tubos inox | 190 |
| Vidrio | 14 |

## Categorías (informativo)

Ya no se piden en la importación (se piden capacidades). Para referencia: Administrativo · Director Administrativo · Director comercial · Diseñadora · Encargado · Ingeniero / Delineante · Jefe de proyectos · Oficial 1ª Soldador · Oficial 2º · Oficial 3º · Oficial de aluminio · Oficial Montaje Obra · Pintor · Resp. Administrativa · Resp. Logística · Resp. RRHH · Responsable Técnico.

