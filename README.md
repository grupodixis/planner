# s360_planificacion

Gestor de proyectos web y multiusuario para **planificar y registrar los recursos asignados**
(operarios, maquinaria propia, subcontratas/alquileres) a las **órdenes de trabajo (OT)** de
cada proyecto. Se construye por fases, manteniendo la simplicidad.

## Arrancar con Docker

Requisitos: Docker Desktop (o Docker Engine + Compose v2).

```bash
cp .env.example .env        # cambia las contraseñas
docker compose up -d --build
```

Abre <http://localhost:8080> y entra con el administrador del `.env`
(por defecto `admin@s360.local` / `cambiame`).

| Acción | Comando |
|---|---|
| Ver logs | `docker compose logs -f web` |
| Parar | `docker compose down` |
| Reiniciar la BD con los datos de ejemplo (borra todo) | `docker compose down -v && docker compose up -d --build` |
| Copia de seguridad | `docker compose exec db pg_dump -U s360 s360 > backup.sql` (`levantar.bat` deja una en `backups\` antes de cada actualización) |

Los scripts de `db/init/` solo se ejecutan la primera vez, con el volumen de datos vacío.
Los cambios posteriores del esquema van en `app/src/migraciones.js` y se aplican solos al
arrancar, sin perder datos: para actualizar basta con `docker compose up -d --build`.

## Publicar en un servidor (VPS con Plesk)

Producción de pruebas: **https://administrador.hamenorca.com** (VPS con Plesk).

**Instalación (una vez, por SSH como root):**

```bash
curl -fsSL https://raw.githubusercontent.com/grupodixis/planner/main/desplegar-vps.sh \
  | bash -s -- --dominio administrador.hamenorca.com --auto
```

- Instala Docker si falta, descarga el código de GitHub en `/opt/s360`, crea contraseñas
  aleatorias (`/opt/s360/.env`) y arranca escuchando solo en `127.0.0.1:8380`.
- `--dominio`: en Plesk crea el subdominio, pone el proxy nginx hacia la aplicación, emite el
  certificado Let's Encrypt y redirige HTTP → HTTPS (el DNS del subdominio debe apuntar al VPS).
- `--auto`: **actualización automática**. Cada 5 minutos mira GitHub; si hay cambios hace copia
  de la base de datos (`/opt/s360/backups`, las 20 últimas), reconstruye y comprueba que
  responde; si la nueva versión no arranca, vuelve sola a la anterior.
  Registro: `journalctl -u s360-actualizar --since today`.
- Versión publicada: `https://administrador.hamenorca.com/health` (commit de GitHub).
- `--restaurar /root/copia.sql`: carga una copia de la base de datos (p. ej. la del PC).

Si algo de Plesk no se puede automatizar, el script lo dice; a mano son estas directivas en
*Configuración de Apache y nginx → Directivas adicionales de nginx* del subdominio:

```nginx
location ~ ^/ {
    proxy_pass http://127.0.0.1:8380;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 5m;
}
```

## Estructura

```
docker-compose.yml        web (Node 22) + db (PostgreSQL 16)
db/init/01_schema.sql     tablas
db/init/02_seed.sql       datos del boceto, planificados en la fecha de hoy
app/src/server.js         API REST (Express): login, áreas, editar tareas
app/src/tramos.js         tablero del día y tramos (planificar, mover, repartir, recursos)
app/src/config.js         jornada laboral (JORNADA_INICIO / JORNADA_FIN)
app/src/gestion.js        API de proyectos, OTs y sus tareas
app/src/recursos.js       API de operarios, maquinaria y subcontratas
app/src/auth.js           sesiones en BD, permisos, bloqueo tras intentos fallidos
app/src/usuarios.js       entrar, recuperar contraseña, Mi cuenta, usuarios y roles
app/src/correo.js         envío de correo opcional (SMTP)
app/src/conflictos.js     reglas de conflicto del día
app/src/ausencias.js      ausencias (vacaciones, bajas, averías), festivos y saldo de vacaciones
app/src/importar.js       importación de proyectos del compositor (s360-import/1)
app/src/migraciones.js    cambios de esquema que se aplican solos al arrancar
app/public/               frontend sin compilación: index (tablero), proyectos, recursos, usuarios
```

## Vistas Día, Semana y Mes

Selector **Día | Semana | Mes** en la cabecera del calendario; las flechas avanzan un día, una
semana o un mes. La URL y el navegador recuerdan el periodo (`?fecha=…&periodo=semana`).

- **Semana:** lunes a domingo, con el **número de semana ISO** (S46) y el rango de fechas en la
  cabecera. Filas por área o por operario (selector Áreas | Operarios), una ficha por tramo con
  hora, horas y operarios; al pie de cada día, las horas de esa área (o del operario, en rojo si
  pasa de la jornada). Pulsar un día abre la vista día.
- **Mes:** cuadrícula por semanas con su número a la izquierda (pulsarlo abre esa semana). Cada día
  muestra sus tramos, las horas planificadas, una barra de ocupación de operarios y «!» si hay
  conflictos; «+N más» y el número del día abren la vista día.
- **Arrastrar en semana y mes:** una tarea del panel derecho soltada en un día se planifica en el
  primer hueco libre de la jornada (en el mes, en el área por defecto de la tarea); un tramo
  arrastrado a otro día conserva su hora (en la semana también puede cambiar de área o de
  operario). Para horas extra o ajustar horas, la vista día.
- El panel de recursos muestra las horas del periodo frente a su capacidad (jornada × días
  laborables) y la lista de conflictos, los del periodo con su fecha.

## Tablero operativo diario (fase 1, incluido)

- **Izquierda – recursos:** acordeones Operarios / Maquinaria propia / Subcontratas, cada uno
  con «libres/total» del periodo, y dentro por **categoría** (oficio, tipo de máquina, tipo de
  subcontrata; «Sin oficio» al final), plegables y recordadas en el navegador. Cada recurso en una
  línea con sus horas asignadas (barra fina abajo; roja si se pasa de la capacidad) y «SUB» si es
  subcontratado. Con una tarea seleccionada se despliegan y marcan (✓) los que cumplen lo que pide.
  «Solo libres» oculta los que ya tienen algo asignado. Arrastra un recurso encima de una tarea del
  calendario para asignarlo.
- **Centro – calendario del día:** una fila por **área de trabajo** (una obra, una zona del
  taller, la oficina técnica, la cabina de pintura…), 07:00–17:00, encaje cada 30 min. Arrastra tareas para moverlas; si se solapan
  en la misma fila se apilan.
- **Derecha – Por planificar:** agrupado **Proyecto › Partida › OT**. Cada proyecto muestra su
  cliente, condiciones previas pendientes (⚠) y cuántas tareas quedan; cada OT, prioridad, entrega,
  avance (barra y horas planificadas/estimadas). Proyectos y OTs se pliegan (se recuerda en el
  navegador). «Solo lo pendiente» oculta las tareas ya planificadas enteras. Cada tarjeta de
  tarea: nombre y horas que quedan (×2 = operarios a la vez, ⤷ = va después de otra).
- **Tramos (tareas largas):** al soltar una tarea en el calendario se crea un **tramo** que
  llega como mucho al fin de jornada (07:00–15:00 por defecto); lo que no cabe queda pendiente
  en la tarjeta («quedan 44h») para arrastrarlo otro día. Cada tramo tiene sus propios
  recursos; un tramo nuevo hereda los del anterior de la misma tarea.
  En el detalle del tramo: horas (2h / 4h / 8h / hasta fin de jornada), **«Repartir lo pendiente
  en días siguientes»** (jornadas completas en días laborables, mismo área y recursos), mover a
  otro día, quitar del tablero y lista de todos los tramos de la tarea para saltar entre días.
  Las 2h después del fin de jornada se ven rayadas: se pueden usar como horas extra y avisan.
  Soltar un tramo en el panel derecho lo quita del tablero (sus horas vuelven a pendientes).
- **Redimensionar tramos:** arrastra el borde derecho de un bloque para cambiar la hora de fin,
  o el izquierdo para la de inicio (encaje cada 30 min; Mayús + ← / → con el bloque
  seleccionado). Un tramo **puede superar lo estimado**: la parte de más se ve con una cola
  rayada en rojo y queda registrada («3h de 2h · +1h (50%) sobre lo estimado»).
- **Franja de cada operario:** dentro de cada bloque hay una barra por operario. Sus bordes se
  arrastran para registrar que alguien estuvo menos tiempo (p. ej. Operario 1 de 07:00 a 11:00
  y Operario 2 las 8h). Así se registran las **horas-persona reales** y la persona queda libre
  para otra OT. «todo el tramo» en el detalle la devuelve a ocupar el tramo entero.
  Al mover un tramo, las franjas se mueven con él.
- **Empujar lo siguiente:** al alargar un tramo o una franja, si ahora se solapa con lo que venía
  después en la misma área o con las mismas personas, aparece la lista de lo que se retrasaría
  para confirmar. Lo que pase de las 15:00 se recorta y vuelve a pendientes; si ya no cabe en el
  día, se quita (vuelve a pendientes). También desde el detalle: «Empujar lo siguiente…».
- **Vista «Operarios»** (selector Áreas | Operarios del calendario): una fila por persona con su
  franja en cada OT y sus horas del día. Bordes = cambiar la franja; arrastrar una barra a otra
  persona = pasársela; soltar una tarea del panel derecho en una persona = planificarla con esa
  persona (en el área por defecto de la tarea). Los tramos sin nadie salen en «Sin operario».
- **Obras:** son áreas **de un proyecto**. Se crean solas al poner la dirección de obra en el
  proyecto o al importarlo (tareas «de obra»), y desde la ficha del proyecto se renombran o se añade
  otra obra. En el tablero van al final, bajo el rótulo «Obras», con el código del proyecto, y
  **solo mientras el proyecto está activo**: al cerrarlo desaparecen solas (los días con trabajo ya
  planificado se siguen viendo, marcados «proyecto cerrado»). No aparecen en «Áreas de trabajo»;
  allí solo hay, plegadas, las que se quedaron sin proyecto.
- **Áreas de trabajo** (botón en el calendario): áreas fijas; crear, renombrar, tipo (taller, oficina
  técnica, pintura, transporte, otro), ubicación, orden (arrastrando el asa ⠿ de cada fila, o
  ↑/↓ con el asa enfocada; igual en las tareas de una OT y en las partidas) y activar/desactivar. Un área con tareas
  no se borra: se desactiva y deja de salir en el calendario salvo los días en que tenga tareas.
- **Detalle (ventana flotante):** al pulsar un bloque o una tarea se abre una ventana con el
  proyecto y la partida de la OT, la tarea (requisitos, planificado, dependencias, notas,
  condiciones), el tramo (recursos asignados, avisos, horas, empujar, repartir, mover) y todos sus
  tramos. No bloquea el tablero (se siguen arrastrando recursos); se mueve arrastrando su cabecera
  (doble clic la devuelve a su sitio) y se cierra con ✕ o Esc.
- **Sin asignar / conflictos:** faltan operarios, falta máquina/subcontrata o tipo requerido,
  mismo recurso en dos tareas a la vez, fuera de jornada, exceso sobre lo estimado, tarea que
  empieza antes que su previa. Cada aviso tiene **«Solucionar»**, que propone:
  - faltan operarios / un tipo: los recursos **libres a esa hora** de ese tipo (primero los que
    tienen el oficio pedido) con «Asignar»; los ocupados se ven con dónde están;
  - recurso concreto: asignarlo (o confirmarlo, si es subcontrata);
  - solape: cambiar a esa persona/máquina por otra libre del mismo tipo, o empujar lo siguiente;
  - fuera de jornada: recortar hasta el fin de jornada (lo demás queda pendiente) o empezar a las 07:00;
  - exceso: subir la estimación o recortar el tramo;
  - dependencia: mover el tramo al primer hueco tras la tarea previa (+ espera), o ir a la previa.
- **Multiusuario:** login, roles `admin` / `planificador` / `consulta` (solo lectura),
  historial de cada cambio con usuario y hora, refresco automático cada 20 s.

## Proyectos y OTs (pantalla aparte, menú superior)

- **Partidas:** cada proyecto se divide en partidas (código del presupuesto, p. ej. C4.001, y
  nombre). Las OTs se muestran agrupadas por partida con sus horas; botón «Partidas…» para
  crearlas, renombrarlas, ordenarlas y borrarlas (solo vacías). Una OT puede ir sin partida.
- **Proyectos:** crear (código PR-### automático), nombre, cliente, obra/ubicación, notas,
  activo/cerrado. Buscador y filtro de cerrados. Un proyecto con OTs no se borra: se cierra.
- **Órdenes de trabajo (OT):** sustituyen a las antiguas OF y OM (OF-1565 → OT-1565). Código
  automático, título, partida, prioridad (urgente/alta/normal/baja), fecha de entrega, color
  en el tablero, descripción, abierta/cerrada. Progreso de tareas planificadas y hechas.
  Una OT con tareas planificadas o hechas no se borra: se cierra.
- **Tareas de la OT:** nombre, horas, operarios necesarios, área por defecto y requisitos:
  un **tipo de recurso** con cantidad («una Soldadora MIG», «2 × Oficial 3º») o un recurso
  concreto («MIG 1»). Se ordenan con ↑↓. Son lo que se arrastra al tablero.
- Todo se guarda al salir de cada campo. La URL recuerda el proyecto y la OT abiertos.

## Tipos de recurso

Oficios (Soldador, Oficial 3º…), tipos de máquina (Soldadora MIG, Plegadora…) y tipos de
subcontrata / alquiler (Grúa, Lacado…). Se gestionan en Recursos › «Tipos de recurso» y cada
recurso puede tener varios (un operario, varios oficios). Una tarea puede pedir un tipo aunque
no estén dadas de alta todas las máquinas: en el tablero el requisito se cumple con cualquier
recurso asignado de ese tipo; si falta, aviso; si no hay ninguno de ese tipo dado de alta, aviso
suave («no hay ninguno dado de alta»). Al seleccionar una tarea, el panel de recursos marca con ✓
los que cumplen lo que pide.

## Recursos (pantalla aparte, menú superior)

Tres pestañas, cada una con su lista (buscador, «ver dados de baja») y su ficha, que se guarda
al salir de cada campo:

- **Operarios:** nombre, nº de empleado, **vínculo** (plantilla / subcontratado, con su empresa
  o «Autónomo»), oficios / roles, teléfono, email, coste €/h, área habitual, notas. Un
  subcontratado que trabaja de operario (pintor, oficial…) cuenta en los operarios de las
  tareas, cumple oficios y suma horas-persona; en el tablero lleva la etiqueta «SUB».
- **Maquinaria:** nombre, nº / matrícula, tipo(s) de máquina, ubicación habitual, coste €/h,
  notas (mantenimiento, capacidades…).
- **Subcontratas y alquileres:** empresas que hacen un trabajo entero o alquileres (lacado
  externo, grúa, plataforma): nombre en el tablero, clase (subcontrata / alquiler), tipo,
  empresa o proveedor, teléfono y email de contacto, coste €/h, notas. Si alguien está aquí pero
  es una persona que trabaja de operario, «Pasar a Operarios» lo convierte en operario subcontratado.

Cada ficha muestra su **uso**: horas asignadas en las próximas 2 semanas, próxima y última
asignación e historial. **Baja:** si el recurso se ha usado alguna vez se **da de baja**
(deja de salir en el panel del tablero para asignar, pero conserva su historial y sigue
viéndose los días en que ya tenía trabajo); si nunca se usó, se borra. «Reactivar» lo devuelve.

## Usuarios y roles

Menú **Usuarios** (solo quien tiene el permiso «usuarios»).

- **Alta:** nombre, email, rol y, si es un operario, a quién corresponde. No se escribe
  contraseña: se genera un **enlace de activación** (7 días, un solo uso) con el que la persona
  elige la suya. Si hay correo configurado se le envía; si no, aparece en pantalla para copiarlo
  o abrirlo en tu correo.
- **Roles** configurables con cuatro permisos. Ver lo puede todo el mundo; los permisos dicen qué
  se puede **cambiar**:

  | Permiso | Qué deja cambiar |
  |---|---|
  | planificar | tablero: tramos, asignaciones, estado de las tareas |
  | proyectos | proyectos, partidas, OTs, tareas, importación |
  | recursos | recursos, áreas de trabajo, tipos, semillero |
  | usuarios | usuarios y roles |

  De serie: **Administrador** (todo; no se puede modificar ni borrar), **Planificador**
  (planificar + proyectos) y **Consulta** (nada). Se pueden crear otros (p. ej. «Jefe de taller»
  solo con planificar). Un rol con usuarios no se borra.
- **¿Has olvidado tu contraseña?** en la pantalla de entrada. Con correo configurado llega un
  enlace (24 h). Sin correo, la petición aparece arriba en Usuarios para que un administrador
  genere el enlace y se lo pase.
- **Mi cuenta:** pulsando en tu nombre (arriba a la derecha) cambias nombre y contraseña.
- **Seguridad:** contraseñas de 8+ caracteres mezclando letras con números o símbolos, guardadas
  con scrypt; los enlaces se guardan como hash y caducan; 5 intentos fallidos bloquean ese email
  15 minutos; al cambiar la contraseña se cierran las demás sesiones. Desactivar a un usuario lo
  saca al momento. Tiene que quedar siempre al menos un usuario activo que gestione usuarios.
- **Borrar** solo quita a quien nunca ha hecho nada en el sistema; si ya planificó o importó, se
  desactiva y se conserva su historial.

Correo (opcional), en `.env`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` y
`APP_URL` (la dirección pública para los enlaces; en el VPS la pone el script de despliegue).

## Vacaciones, ausencias y festivos

- **Falta rápida desde el tablero:** clic en un operario del panel de recursos (o en su nombre
  en la vista por operarios) → día, «Todo el día / Se fue a las… / Llegó a las…» y un botón:
  **Falta**, Baja, Permiso, Vacaciones… Con una máquina: Avería, Mantenimiento, ITV.
  Lo puede hacer quien planifica. Si ya hay algo apuntado ese día, sale con «Quitar».
- **Justificante de las faltas:** toda falta nace «pendiente de justificante». Se marca
  justificada / sin justificar desde el mismo diálogo del tablero, desde la ficha del operario o
  desde la lista «Faltas pendientes de justificante» (Recursos › Vacaciones y festivos). Las
  faltas no restan vacaciones y se cuentan en su columna (total, sin justificar, pendientes).
- **Ausencias** en la ficha de cada recurso (Recursos › Operarios / Maquinaria): desde–hasta, o
  solo unas horas de un día (un médico de 9:00 a 11:00), con notas.
  - Operarios: vacaciones, baja, permiso, formación, falta (con justificante), otro.
  - Máquinas, vehículos y alquileres: avería, mantenimiento, ITV / revisión, otro.
  - Si tenía trabajo asignado en esas fechas, al apuntarla se avisa con la lista de tramos.
- **En el tablero:**
  - Quien falta todo el día sale atenuado en el panel de recursos con el motivo y no se puede
    arrastrar; en semana / mes, «Xd fuera» y la capacidad descuenta esos días.
  - Si está asignado a un tramo, aviso grave «está de vacaciones y tiene asignado…» con
    «Solucionar»: pasar su parte a otro del mismo oficio que esté libre, o quitarlo.
  - Vista por operarios: su fila rayada (o solo sus horas). Semana: «vacaciones» en su celda.
    Mes: «N fuera» en el día y la ocupación se calcula con los disponibles.
  - «Repartir» salta los festivos y no asigna a quien falta ese día.
- **Festivos** (Recursos › Vacaciones y festivos): vienen cargados los de Illes Balears y los
  locales de Sant Lluís de 2026 y 2027 (BOIB). Se añaden a mano los de años siguientes y los
  cierres de empresa. En festivo el tablero lo marca y avisa si hay algo planificado.
- **Saldo de vacaciones:** 22 días laborables al año por convenio (`VACACIONES_DIAS`); cada
  persona puede tener los suyos en su ficha. Se cuentan días laborables (lunes a viernes sin
  festivos) y medio día / unas horas en proporción. La pestaña Vacaciones y festivos muestra,
  por año, apuntados, ya disfrutados, los que quedan, otras ausencias y la ausencia actual o
  próxima. Los subcontratados no llevan saldo.

## Semillero de recursos de la empresa

[`semillero/semillero.json`](semillero/README.md) describe departamentos, áreas de trabajo
(puestos, máquinas fijas, mesas…), oficios, tipos de máquina, máquinas, vehículos, personas y
subcontratas. El planificador lo carga desde **Recursos → «Cargar semillero…»** (vista previa y
luego aplicar; renombra en vez de duplicar, fusiona tipos repetidos y desactiva lo que sobra si
tiene historial). El compositor usa los mismos nombres, y sus nombres antiguos están como alias.

- **Departamentos:** las áreas se agrupan en el tablero en bloques plegables por departamento
  (y las obras al final).
- **Áreas de «un trabajo a la vez»** (puestos de oficina, máquinas fijas): si coinciden dos
  tramos, aviso leve con «Solucionar» (empezar cuando quede libre o pasar a otro puesto libre).
- **Puesto habitual:** cada persona tiene su puesto; al planificar en él, «Solucionar» la propone
  primero.

## Importación de proyectos

El compositor de proyectos exporta un archivo `.s360.json` (formato `s360-import/1`) con el
proyecto, sus partidas, OTs y tareas con horas estimadas. Especificación, JSON Schema y ejemplo
en [`docs/importacion/`](docs/importacion/README.md).

**Proyectos y OTs → «Importar…»**: se arrastra el archivo y sale una **vista previa** (no cambia
nada): qué se crea o actualiza, avisos, y una tabla con los **nombres que no coinciden** con lo
que hay en el planificador (áreas, oficios, tipos de máquina, recursos). Para cada uno se elige
crearlo, usar uno que ya existe o no asignarlo; lo que se asocia se **recuerda** para la próxima
vez. Al confirmar se importa todo de una vez (o nada).

- `requiere` por **tipo de recurso** con cantidad; `oficio` + `operarios` → requisito «2 × Soldador».
- Áreas por nombre o por tipo; lo que es de **obra** («Montaje en Obra», `area_tipo: "obra"`) va
  al área «Obra · ‹obra del proyecto›», que se crea sola.
- **Dependencias** (`despues_de`, con `espera_h` de secado/curado): se ven en el detalle de la
  tarea y el tablero avisa (leve) si un tramo empieza antes de que termine la tarea previa.
- **Condiciones previas** del proyecto (pago, RAL, pilares…): casillas en la ficha del proyecto;
  las pendientes se ven en la lista de proyectos y en las OTs del tablero.
- **Notas** de cada tarea: en la tabla de tareas (editables) y en el detalle del tablero.
- **Reimportar** el mismo proyecto (mismo `ref_externa`) actualiza sin duplicar y conserva la
  planificación. Lo que ya no está en el archivo se borra si no tiene nada planificado; si lo
  tiene, se conserva marcado «ya no está en el presupuesto».

## API

| Método | Ruta | Uso |
|---|---|---|
| POST | `/api/login` · `/api/logout` | Sesión (429 tras 5 fallos) |
| POST | `/api/recuperar` | `{email}` pedir enlace para cambiar la contraseña (respuesta siempre igual) |
| GET · POST | `/api/restablecer/:token` · `/api/restablecer` | ver a quién es el enlace · `{token, password}` guardar y entrar |
| GET · PATCH | `/api/me` | usuario actual con `permisos` · `{nombre}` |
| POST | `/api/me/password` | `{actual, nueva}` (cierra las demás sesiones) |
| GET · POST | `/api/usuarios` | usuarios, roles, personas y peticiones · alta `{nombre, email, rol, recurso_id}` (devuelve el enlace) |
| PATCH · DELETE | `/api/usuarios/:id` | `{nombre, email, rol, recurso_id, activo}` · borrar (o desactivar si tiene historial) |
| POST | `/api/usuarios/:id/enlace` · `/api/usuarios/:id/cerrar-sesiones` | enlace nuevo de activación/recuperación · sacarlo de todas partes |
| POST · PATCH · DELETE | `/api/roles` · `/api/roles/:clave` | `{nombre, descripcion, permisos[]}` |
| GET · POST | `/api/ausencias` | listar (`?recurso_id=`, `?desde=&hasta=`, `?anio=`) · `{recurso_id, tipo, desde, hasta, hora_desde?, hora_hasta?, notas}` (devuelve los tramos afectados) |
| PATCH · DELETE | `/api/ausencias/:id` | editar · quitar |
| GET | `/api/ausencias/tipos` | tipos de ausencia y a qué recursos se aplican |
| GET · POST · DELETE | `/api/festivos?anio=` · `/api/festivos` · `/api/festivos/:fecha` | festivos del año · `{fecha, nombre, ambito}` · quitar |
| GET | `/api/vacaciones?anio=` | saldo de vacaciones por operario |
| GET | `/api/tablero?fecha=YYYY-MM-DD` · `?desde=…&hasta=…` | jornada, áreas, recursos, tareas abiertas, tramos del día o del rango (máx. 62 días) y avisos (cada uno con su `fecha`) |
| PATCH | `/api/tareas/:id` | `{estado, nombre, duracion_h, operarios_req, linea_id, requisitos, requisitos_tipo, notas, baja_presupuesto}` |
| POST | `/api/tareas/:id/tramos` | `{fecha, hora_inicio, linea_id?, recurso_id?, duracion_h?}` planificar (sin horas: hasta fin de jornada) |
| PATCH · DELETE | `/api/tramos/:id` | mover / cambiar horas `{fecha, hora_inicio, linea_id, duracion_h}` · quitar |
| POST | `/api/tramos/:id/empujar` | `{aplicar?}` vista previa / aplicar el empuje de lo siguiente |
| POST | `/api/tramos/:id/repartir` | `{horas_dia?}` reparte lo pendiente en los días laborables siguientes |
| POST | `/api/tramos/:id/asignaciones` | `{recurso_id, desde?, hasta?}` asignar recurso al tramo |
| PATCH | `/api/tramos/:id/asignaciones/:recursoId` | `{desde, hasta}` franja · `{recurso_id}` pasar a otro recurso |
| DELETE | `/api/tramos/:id/asignaciones/:recursoId` | quitar recurso del tramo |
| GET | `/api/tareas/:id/historial` | últimos cambios |
| GET | `/api/catalogo` | áreas, recursos y colores para formularios |
| GET · POST | `/api/proyectos` | listar · crear `{nombre, codigo?, cliente, obra, notas}` |
| PATCH · DELETE | `/api/proyectos/:id` | editar · borrar (solo sin OTs) |
| GET · POST | `/api/ordenes` | listar (`?proyecto_id=&estado=`) · crear `{titulo, proyecto_id, …}` |
| GET · PATCH · DELETE | `/api/ordenes/:id` | detalle con tareas · editar · borrar |
| POST | `/api/ordenes/:id/tareas` | `{nombre, duracion_h, operarios_req, linea_id, requisitos}` |
| PUT | `/api/ordenes/:id/tareas/orden` | `{ids: [...]}` |
| DELETE | `/api/tareas/:id` | borrar tarea (no en curso ni hecha) |
| GET · POST | `/api/partidas` | listar (`?proyecto_id=`) · crear `{proyecto_id, codigo, nombre}` |
| PATCH · DELETE | `/api/partidas/:id` | editar · borrar (solo sin OTs) |
| PUT | `/api/proyectos/:id/partidas/orden` | `{ids: [...]}` |
| GET · POST | `/api/tipos-recurso` | listar (`?clase=`) · crear `{clase, nombre}` |
| PATCH · DELETE | `/api/tipos-recurso/:id` | renombrar · borrar (no si lo piden tareas) |
| GET · POST | `/api/recursos` | listar (`?tipo=operario\|maquina\|subcontrata`, con uso) · alta `{tipo, nombre, …}` |
| PATCH · DELETE | `/api/recursos/:id` | modificar · baja (desactiva si tiene historial, borra si no) |
| GET · POST | `/api/areas` | listar · crear `{nombre, tipo, ubicacion}` |
| PATCH · DELETE | `/api/areas/:id` | editar · borrar (o desactivar si tiene tareas) |
| PUT | `/api/areas/orden` | `{ids: [...]}` nuevo orden |
| POST | `/api/importar?simular=1` | vista previa de una importación (archivo o `{archivo, resoluciones}`) |
| POST | `/api/importar` | importar (transacción; devuelve el informe y el id del proyecto) |
| GET | `/api/importaciones` | historial (`?proyecto_id=`) |
| POST | `/api/proyectos/:id/condiciones` | `{texto}` añadir condición previa |
| PATCH · DELETE | `/api/condiciones/:id` | `{cumplida, texto}` · quitar |

## Plan por fases

**Fase 1 – Tablero operativo diario (hecho).** Vista día, drag & drop, conflictos, login y roles.

**Fase 2 – Mantenimiento de datos.** Hecho: áreas de trabajo, proyectos, OTs y sus tareas.
Hecho también: recursos (operarios, maquinaria, subcontratas) y usuarios con roles configurables,
activación por enlace y recuperación de contraseña.

**Fase 3 – Registro real.** Hecho en parte: franjas por operario, horas-persona, exceso sobre lo
estimado y empujar. Pendiente: cierre de cada tramo (hecho / faltan X h / no se hizo), estado en curso/hecha desde el móvil (vista simple para taller y obra).

**Fase 4 – Vista semana y capacidad.** Hecho: vistas semana (con nº de semana) y mes, carga por día y por periodo. Pendiente: carga vs. capacidad más detallada,
arrastre entre días. Hecho: calendario laboral (festivos, vacaciones, ausencias) con saldo de vacaciones.

**Fase 5 – Dependencias y avisos.** Hecho en parte: dependencias entre tareas con espera
(se importan del compositor; aviso leve si se planifica antes de tiempo) y condiciones previas
del proyecto. Pendiente: editar dependencias a mano, confirmación de subcontratas/alquileres con fecha, avisos de retrasos, actualización en tiempo
real (WebSocket) en lugar de refresco periódico.

**Fase 6 – Informes.** Horas por proyecto/partida/operario, ocupación de máquinas, coste de
subcontratas, exportación a Excel/PDF.

Pendientes técnicos: drag & drop táctil (tablets), migraciones versionadas en lugar de scripts
de inicio, HTTPS con proxy inverso (Caddy/Traefik) para publicarlo fuera de la red local, tests.
