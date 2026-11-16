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

Versión de demostración para colaboradores: **https://administrador.hamenorca.com** (VPS con Plesk). El dominio sale de `servidor.conf`: si se cambia ahí, el servidor se republica solo.

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
- Semillero en el servidor: `S360_SEMILLERO` en `servidor.conf` (`si`, `sin-personas` o `no`). La
  actualización automática lo carga (con copia de seguridad antes) cuando cambia
  `semillero/semillero.json` o `servidor.conf`. A mano, dentro del servidor:
  `docker compose exec -T web node src/cargar-semillero.js [--sin-personas] [--limpiar-demo] [--simular] < semillero/semillero.json`.
  Con `S360_LIMPIAR_DEMO=si` se borra antes el proyecto de ejemplo de la instalación (PR-001), si no tiene horas reales.
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
app/src/partes.js         parte del día: cierres de tramos, horas reales, cerrar el día
app/src/informes.js       informes de horas y costes
app/src/avance.js         avance y rendimiento (tarea › OT › partida › proyecto)
app/src/pin.js            entrada con PIN para operarios y dispositivos autorizados
app/src/midia.js          «Mi día» del operario y lo que declara para el parte
app/src/operario.js       app del operario: vacaciones (dos pasos), avisos, justificantes, su mes, PIN
app/src/archivos.js       fotos y PDF (en la base de datos), audio y vídeo (en disco)
app/src/notificaciones.js avisos al móvil (push) y avisos programados
app/src/capturas.js       bandeja de capturas: capturar y clasificar (tarea / asunto / información)
app/src/eventos.js        avisos en vivo entre pantallas (Server-Sent Events)
app/src/importar.js       importación de proyectos del compositor (s360-import/1)
app/src/migraciones.js    cambios de esquema que se aplican solos al arrancar
app/public/               frontend sin compilación: index (tablero), proyectos, recursos, usuarios,
                          parte, informes, pin (entrar con PIN) y mi-dia (operarios)
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

## Parte del día (lo real)

Menú **Parte** (permiso «planificar»: el encargado al final del día). Lo planificado no se
toca: lo real se guarda aparte y se compara.

- Cada tramo del día se cierra con:
  - **✓ Como estaba**: se hizo tal cual. Las horas reales son las franjas planificadas (sin
    quien estaba ausente todo el día).
  - **✎ Corregir**: quién trabajó (personas y máquinas) y de qué hora a qué hora, con motivo
    opcional del cambio.
  - **✗ No se hizo**: con motivo. Se quita del tablero y sus horas vuelven a «Por planificar»
    (queda registrado para los informes; «Deshacer» lo vuelve a poner).
- Y cómo va la tarea:
  - **sigue**: va según lo previsto; no cambia nada (pasa a «en curso»).
  - **faltan X h de tarea** (horas de reloj; con 2 operarios son el doble de horas-persona, y se
    muestra al escribirlo): la tarea pasa a *lo planificado hasta este tramo + X*. La primera
    vez se guarda la estimación original. La diferencia con lo que ya hay planificado después
    sale en «Por planificar» (o como exceso, si sobra).
  - **terminada**: pasa a hecha (fecha y quién). Si quedan tramos planificados después,
    **pregunta si se quitan** del tablero (Quitarlos / Dejarlos / Volver). Lo mismo al poner
    una tarea en «hecha» desde el tablero.
  - Si la tarea tiene **tramos anteriores sin cerrar**, la tarjeta avisa: «faltan» y
    «terminada» los dan por hechos tal como estaban.
- **Deshacer** un cierre devuelve también la tarea a como estaba (estado, estimación) y
  repone los tramos que se quitaron al terminarla. Se deshace en orden: primero el cierre más
  reciente de esa tarea.
- **Horas fuera del plan**: trabajo en una tarea que no estaba planificado, o tiempo no
  productivo (desplazamiento, espera, limpieza, mantenimiento del taller, formación).
- **Cerrar el día** (valida como estaba lo que quede). Un día cerrado no se replanifica en el
  tablero; se puede reabrir. Se avisa de los días pasados con trabajo sin cerrar.
- Motivos de desvío: falta de material, avería, retrabajo / error, cliente, clima, ausencia,
  mal estimado, otro.
- En el tablero: ✓ / ≠ en los tramos cerrados (no se arrastran), 🔒 en los días cerrados y
  aviso «parte sin cerrar» en los días pasados. Lo cerrado y las tareas hechas ya no dan avisos.
- Cada hora real guarda el coste/hora del recurso de ese momento (si después cambia, el
  histórico no cambia; si no tenía, se usa el actual).

## Avance y rendimiento

Mismas reglas en todas las pantallas (`app/src/avance.js`):

- **Peso** de una tarea = horas-persona previstas al crearla o importarla (estimación inicial ×
  operarios). No cambia aunque luego se reestime con «faltan X h».
- **Avance** = peso de las tareas **terminadas** ÷ peso total (OT, partida o proyecto). Una
  tarea cuenta solo al terminarla (lo confirma el encargado). Las que el compositor quitó del
  presupuesto no cuentan, salvo que ya estén hechas.
- **Rendimiento** = peso de lo terminado ÷ horas reales que costó (del parte). Más de 100 % = se
  hizo en menos horas de las previstas. Solo cuentan las tareas terminadas con horas apuntadas.
- **En curso**: tareas sin terminar que ya tienen horas reales; no suman avance, se enseñan
  aparte y avisan (⚠) si ya se han pasado de lo previsto.
- Los **hitos** son las OTs (con su fecha de entrega) y las partidas: para seguir un momento
  como hito, el compositor lo hace OT.
- Se ve en el tablero (OTs y proyectos con algo hecho), en Proyectos (lista, ficha, partidas,
  OTs y cada tarea: «real 32 h · 125 %» o «llevas 45 h de 40») y en Informes (columnas Avance y
  Rend., tarjetas).

## Operarios: Mi día con PIN

Cada operario apunta su día desde su móvil o desde una tablet común del taller; el encargado
lo revisa y confirma siempre en el Parte.

- **Acceso** (Usuarios › «Operarios: entrada con PIN»): se le pone un **PIN de 4 cifras** (no
  vale 0000, 1234…; botón 🎲 para uno al azar). Se crea un usuario con el rol **Operario**
  (permiso «mi_dia» solo): no ve el tablero, ni costes, ni lo de los demás.
- El PIN **solo funciona en dispositivos autorizados**:
  - **Tablet común**: quien administra usuarios entra en ella, pulsa «Autorizar este navegador
    como tablet común» y sale. Allí se elige quién eres y se teclea el PIN. La sesión dura
    15 min y la pantalla sale sola al enviar o a los 3 min sin tocarla.
  - **Móvil del operario**: «Enlace para su móvil» (un solo uso, 3 días; se puede mandar por
    WhatsApp). Al abrirlo, ese móvil queda autorizado solo para él.
  - 5 PIN fallidos bloquean a ese operario 15 min; 20, el dispositivo.
- **Mi día** (`/mi-dia.html`): sus trabajos de hoy (o ayer) con hora, área, OT y compañeros.
  En cada uno: **✓ Hecho**, **◐ En parte** (de qué hora a qué hora) o **✗ No** (con motivo), y
  **¿queda terminada la tarea?** (Sí / No, sigue). Nota opcional. **Trabajo no planificado**
  (otra tarea o tiempo no productivo). **Lo siguiente** que tiene planificado. **Enviar mi
  día** cuando lo tiene todo; puede seguir cambiándolo hasta que el encargado lo confirme.
- **En el Parte** el encargado ve quién ha enviado (✔ / ◐ / ✗), lo apuntado en cada tramo y
  los avisos (quién no ha apuntado, horas distintas, no lo hizo, desacuerdo sobre si quedó
  terminada, terminada antes de lo previsto). **✓ Confirmar lo apuntado** cierra el tramo con
  eso (eligiendo él si la tarea sigue o quedó terminada); **✎ Corregir** sale ya rellenado con
  lo apuntado. Las horas fuera del plan apuntadas se **aceptan** o **descartan**. «Confirmar
  todo lo apuntado sin avisos» lo hace de una vez. No se puede cerrar el día con cosas
  apuntadas sin revisar. Deshacer un cierre vuelve a dejar lo apuntado pendiente.

## App del operario: más gestiones

En «Mi día» hay cuatro pestañas abajo: **Mi día**, **Mi mes**, **Vacaciones** y **Avisar** (y 🔑
para cambiar su PIN).

- **Vacaciones**: ve los días que le quedan (22 de convenio o los de su ficha, menos los
  aprobados y los pedidos) y pide días (desde–hasta; cuenta solo laborables, sin festivos; a
  partir de mañana; cada año por separado). Al pedir se ve cuántos días son, cuántos le
  quedarían y avisos (trabajo planificado esos días, compañeros del mismo oficio fuera).
  Puede anular mientras esté pendiente.
  - Se aprueba en **dos pasos**: **Operaciones** da el visto bueno (permiso «vacaciones_ops»,
    rol «Operaciones») y **RRHH** la aprueba (permiso «vacaciones_rrhh», rol «RRHH»). El
    Administrador puede los dos. Se hace en Recursos › Vacaciones y festivos › «Peticiones
    de vacaciones». Para rechazar hay que dar el motivo (lo ve el operario). Al aprobarse pasa
    sola al calendario de ausencias.
- **Avisar · No vengo o llego tarde**: enfermo, médico, llego tarde, asunto personal u otro;
  un día (o varios, hasta 15) o unas horas; nota y foto del justificante. Queda como **falta
  pendiente de justificante** en el tablero y en el parte (con la marca «avisó él»). Puede
  quitar el aviso mientras no haya pasado el día.
- **Justificantes pendientes**: sus faltas sin justificante; sube la foto. RRHH / el encargado
  la ve en Recursos › «Faltas pendientes de justificante» y marca justificada o no.
- **Incidencias** (ahora son capturas, ver «Bandeja de capturas»): falta material, avería (con qué máquina), calidad, seguridad u otro, con
  texto y fotos; desde la pestaña o con «⚠ Avisar de una incidencia» en un trabajo de hoy. El
  encargado las ve en el Parte («Incidencias abiertas»): **Máquina parada hoy** (la máquina
  queda no disponible en el tablero; se amplía en Recursos) y **Resuelta** (con nota que ve
  el operario).
- **Mi mes**: día a día lo planificado, lo trabajado (confirmado), ausencias y festivos; al
  pulsar un día se abre en Mi día.
- **Fotos**: el móvil las reduce (máx. 1600 px) antes de subirlas; se guardan en la base de
  datos (entran en las copias). Un operario solo ve las suyas.
- En el menú salen **contadores**: en Recursos, peticiones de vacaciones que te esperan y
  justificantes por revisar; en Bandeja, capturas por clasificar; en ＋ Capturar, asuntos a tu cargo.

## Bandeja de capturas (GTD)

Para apuntar cualquier cosa en el momento y que alguien la lleve a término.

- **Capturar** (cualquiera): operarios en Mi día › **＋ Capturar** (botón central); el resto en
  el menú **＋ Capturar** (`/capturar.html`, también en el móvil). Texto, **audio** (hasta 3 min),
  **foto**, **vídeo** (30 s como máximo; se graba en el navegador a ~1,5 Mbps) o algo de la
  galería. Opcional: el tipo (falta material, avería — con qué máquina —, calidad, seguridad,
  idea / mejora, otro) y **de qué es**: por defecto el trabajo que tiene hoy; puede elegir otro
  proyecto y su OT. Desde cada trabajo de Mi día: «＋ Capturar algo de este trabajo».
  Las antiguas «incidencias» son ahora capturas (se pasaron solas a la bandeja).
- **Bandeja** (`/bandeja.html`, quien planifica; contador en el menú): cada captura se
  **clasifica** como
  - **Tarea en una OT** (nombre, horas, operarios, oficio, área): pasa a «Por planificar»; en
    sus notas queda el texto capturado;
  - **Asunto con responsable** (y fecha límite y prioridad): lo ve su responsable en
    «＋ Capturar › Asuntos a mi cargo» (con contador) y lo da por **resuelto**;
  - **Información** del proyecto / OT;
  - **Descartar**.
  Con una nota que ve quien lo capturó. Pestañas: Por clasificar, Asuntos abiertos, Todo
  (120 días); filtro por proyecto. «Máquina parada hoy» en las averías. «Volver a la bandeja»
  si se clasificó mal.
- Quien capturó ve en **Lo que he capturado** en qué quedó cada cosa.
- En el Parte se ve un resumen de lo que hay por clasificar.
- **Archivos**: fotos y PDF en la base de datos; audios y vídeos en disco (volumen Docker
  `archivos`, `/data/archivos`). Al desplegar, `desplegar-vps.sh` copia lo nuevo a
  `backups/archivos/` junto a la copia de la base de datos.

## App en el móvil (PWA)

La aplicación se puede **instalar** como una app (icono en la pantalla de inicio, a pantalla
completa, sin barra del navegador). Al abrirla, cada uno va a lo suyo: un operario con
sesión, a **Mi día**; el resto, a **＋ Capturar** (desde ahí el menú); sin sesión, a entrar
con PIN (si el móvil está autorizado) o con email.

- **Android (Chrome)**: sale el botón **📲 Instalar la app** en Entrar con PIN, Mi día y
  Capturar (o en el menú de Chrome › «Instalar aplicación»). La app comparte la autorización
  y la sesión con Chrome.
- **iPhone (Safari)**: Compartir ⬆︎ › **Añadir a pantalla de inicio**. En iPhone la app
  instalada **no comparte** lo de Safari: por eso, al abrir en Safari el enlace para su móvil,
  no se gasta: se le enseña cómo instalar la app, se copia el código y se **pega en la app**
  (Entrar con PIN › «¿Ya tienes el enlace o el código?»). También vale pegar el enlace entero.
- `manifest.webmanifest`, iconos (`icono-192/512`, `icono-512-maskable`, `apple-touch-icon`),
  `sw.js` (service worker mínimo: no guarda nada en caché salvo la página «Sin conexión») e
  `inicio.html` (a dónde va cada uno al abrir la app).

## Avisos al móvil (notificaciones)

Notificaciones push (Web Push, claves VAPID propias que se crean solas y se guardan en la
tabla `ajustes`). Llegan aunque la app esté cerrada: en Android siempre; en iPhone solo con la
app **instalada** en la pantalla de inicio (iOS 16.4+).

- **Activar**: botón «🔔 Activar avisos en este móvil» (Mi día, Capturar) o la 🔔 de la cabecera
  (todas las pantallas), que abre los **ajustes**: qué avisos quiero, **horas de silencio**
  (por defecto 21:00–7:00; averías y seguridad avisan siempre), enviar una prueba, desactivar.
  En la tablet común no se ofrece.
- **Qué avisa**:
  - operarios: **cambio en su plan** de hoy o mañana (se repasa cada minuto; si están
    planificando se agrupa, como mucho uno cada 20 min; de noche espera a la mañana),
    **recordatorio a las 17:00** si no ha enviado su día (laborables con trabajo),
    **vacaciones** aprobadas o rechazadas;
  - todos: lo que **capturé** se convierte en tarea o se resuelve; **asunto asignado** a mí y
    asuntos que **vencen mañana** (a las 8:00);
  - quien planifica: **avería o seguridad** capturada (al momento), **resumen de la bandeja**
    (cada 30 min si hay nuevas), un operario **avisa de que no viene o llega tarde**;
  - Operaciones / RRHH: **petición de vacaciones** que espera su paso.
- Al pulsar el aviso se abre la pantalla correspondiente.

## Informes

Menú **Informes** (permiso «informes»; de serie solo el Administrador). Exportables a Excel (CSV).

- **Proyectos**: por proyecto y desplegando partida › OT › tarea, horas-persona
  presupuestadas (estimación inicial × operarios), estimadas (con reestimaciones),
  planificadas, reales, previsión al terminar, desvío (h y %), coste real (personas, máquinas,
  subcontratas), importe de la partida (del compositor) e importe − coste (sin materiales).
  Quién ha trabajado en el proyecto y cómo se cerró lo planificado (por motivo).
- **Operarios** (periodo): horas productivas, no productivas, extra (por encima de la jornada
  en un día), ocupación, coste, ausencias en días (faltas justificadas / sin justificar /
  pendientes) y en qué proyectos.
- **Máquinas y alquileres** (periodo): horas planificadas, reales, días y coste.
- **Planificación y desvíos** (periodo): % de tramos que se cumplieron como estaban, por
  semana; horas plan → real; días sin cerrar; motivos de desvío; tareas terminadas con más
  desvío.
- Para que salga el coste hay que poner el **coste €/h** en la ficha de cada recurso.

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

## Orden de los departamentos en el tablero

Las cabeceras de departamento del tablero (vista día por áreas) se reordenan **arrastrándolas**
(o con **Alt + ↑ / ↓** teniendo la cabecera enfocada). Hace falta el permiso «recursos». Obras y
«Otras áreas» quedan siempre al final. El semillero ya no pisa este orden al recargarse; los
departamentos nuevos se añaden al final.

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
| GET | `/api/parte?fecha=` | parte del día: tramos con su cierre y horas reales, no hechos, horas sueltas, ausencias |
| POST | `/api/tramos/:id/cierre` | `{accion: hecho\|corregido\|no_hecho, registros?, motivo?, notas?, progreso?: {terminada} \| {faltan_h}}` |
| DELETE | `/api/cierres/:id` | deshacer un cierre (un «no se hizo» vuelve al plan) |
| POST · DELETE | `/api/registros` · `/api/registros/:id` | horas fuera del plan `{fecha, recurso_id, tarea_id?, desde, hasta, tipo, motivo?, notas?}` |
| POST · DELETE | `/api/parte/cerrar` · `/api/parte/cerrar?fecha=` | cerrar el día `{fecha, validar_resto}` · reabrir |
| GET | `/api/parte/pendientes` | días pasados con trabajo sin cerrar |
| GET | `/api/pin/dispositivo` | (sin sesión) ¿este navegador está autorizado? y quién puede entrar en él |
| POST | `/api/pin/entrar` · `/api/pin/alta-movil` | (sin sesión) `{usuario_id, pin}` · `{token}` autorizar el móvil con el enlace |
| GET | `/api/pin` | operarios con/sin PIN y dispositivos autorizados (permiso «usuarios») |
| PUT · DELETE | `/api/pin/:recursoId` | `{pin}` poner o cambiar el PIN · quitar el acceso |
| POST | `/api/pin/:recursoId/enlace-movil` | enlace de un solo uso para su móvil |
| POST · DELETE | `/api/pin/dispositivos` · `/api/pin/dispositivos/:id` | `{nombre}` autorizar este navegador como tablet común · desautorizar |
| GET | `/api/mi-dia?fecha=` | (operario) sus tramos con lo apuntado, trabajo no planificado, lo siguiente |
| PUT · DELETE | `/api/mi-dia/tramos/:id` | `{estado: hecho\|parcial\|no, desde?, hasta?, terminada?, motivo?, notas?}` · borrar lo apuntado |
| POST · DELETE | `/api/mi-dia/extra` · `/api/mi-dia/extra/:id` | `{fecha, tipo, tarea_id?, motivo?, desde, hasta, notas?}` |
| POST | `/api/mi-dia/enviar` | `{fecha}` avisar al encargado |
| POST | `/api/declaraciones/:id/aceptar` · `/descartar` | (encargado) horas fuera del plan apuntadas por un operario |
| GET | `/api/mi-dia/gestiones` | (operario) saldo y peticiones de vacaciones, avisos, justificantes pendientes, sus capturas |
| GET · POST · DELETE | `/api/mi-dia/vacaciones/previa?desde=&hasta=` · `/api/mi-dia/vacaciones` · `/:id` | ver cuántos días y avisos · pedir `{desde, hasta, notas}` · anular |
| POST · DELETE | `/api/mi-dia/ausencias` · `/api/mi-dia/ausencias/:id` | avisar `{motivo, desde, hasta?, hora_desde?, hora_hasta?, notas, archivos[]}` · quitar el aviso |
| POST | `/api/mi-dia/ausencias/:id/justificante` | `{archivos: [ids]}` |
| GET | `/api/mi-dia/mes?mes=YYYY-MM` | su mes día a día |
| POST | `/api/mi-dia/pin` | `{actual, nuevo}` |
| POST · GET | `/api/archivos` · `/api/archivos/:id` | subir (cuerpo = la foto o el PDF, máx. 6 MB) → `{id}` · ver |
| GET · POST | `/api/solicitudes-vacaciones` · `/api/solicitudes-vacaciones/:id` | peticiones · `{decision: aprobar\|rechazar, nota}` (el paso lo marca el estado) |
| GET | `/api/avisos-ausencia?desde=&hasta=` | ausencias avisadas por los operarios |
| GET | `/api/pendientes` | contadores del menú para el usuario |
| GET | `/api/capturas/opciones` | proyectos y OTs abiertas, mis trabajos de hoy, máquinas, tipos |
| POST | `/api/capturas` | `{texto?, categoria?, proyecto_id?, orden_id?, tramo_id?, maquina_id?, archivos: [ids]}` |
| GET | `/api/capturas/mias` | lo que he capturado y en qué quedó |
| GET | `/api/capturas?vista=bandeja\|asuntos\|mios\|todas&proyecto_id=` | bandeja (quien planifica) · `mios`: asuntos a mi cargo |
| GET | `/api/capturas/opciones-clasificar` | responsables, oficios y áreas |
| POST | `/api/capturas/:id/clasificar` | `{destino: tarea\|asunto\|info\|descartar, proyecto_id, orden_id, categoria, nota, prioridad, responsable_id, fecha_limite, tarea: {nombre, duracion_h, operarios_req, oficio_id, linea_id}}` |
| POST | `/api/capturas/:id/resolver` · `/reabrir` · `/maquina-parada` | `{resolucion}` (quien planifica o el responsable) · volver a la bandeja · máquina no disponible hoy |
| GET | `/api/push/clave` | clave pública VAPID |
| POST · DELETE | `/api/push/suscribir` | `{suscripcion}` (la del navegador) · `{endpoint}` |
| GET · PUT | `/api/push/preferencias` | qué avisos y horas de silencio · `{off: [tipos], silencio: {desde, hasta} \| null}` |
| POST | `/api/push/prueba` | manda un aviso de prueba a mis dispositivos |
| GET | `/api/eventos` | avisos en vivo (Server-Sent Events) para que las pantallas se actualicen solas |
| GET | `/api/informes/proyectos` · `/api/informes/proyecto/:id` | resumen de proyectos · detalle partida › OT › tarea |
| GET | `/api/informes/operarios` · `/maquinas` · `/planificacion` | `?desde=&hasta=` |
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
| GET · PUT | `/api/tareas/:id/dependencias` | tareas que pueden ir antes (mismo proyecto; las que harían un círculo, marcadas) · `{dependencias: [{id, espera_h}]}` |
| PATCH · DELETE | `/api/condiciones/:id` | `{cumplida, texto}` · quitar |

## Plan por fases

**Fase 1 – Tablero operativo diario (hecho).** Vista día, drag & drop, conflictos, login y roles.

**Fase 2 – Mantenimiento de datos.** Hecho: áreas de trabajo, proyectos, OTs y sus tareas.
Hecho también: recursos (operarios, maquinaria, subcontratas) y usuarios con roles configurables,
activación por enlace y recuperación de contraseña.

**Fase 3 – Registro real.** Hecho: parte del día del encargado (como estaba / corregir / no se
hizo, faltan X h, terminada, horas fuera del plan, cerrar el día). Hecho: «Mi día» de cada
operario con PIN (móvil o tablet común) que el encargado confirma en el parte; avance y
rendimiento por tarea, OT, partida y proyecto. Pendiente: conectar el reloj de fichaje
(registro de jornada).

**Fase 4 – Vista semana y capacidad.** Hecho: vistas semana (con nº de semana) y mes, carga por día y por periodo. Pendiente: carga vs. capacidad más detallada,
arrastre entre días. Hecho: calendario laboral (festivos, vacaciones, ausencias) con saldo de vacaciones.

**Fase 5 – Dependencias y avisos.** Hecho en parte: dependencias entre tareas con espera
(se importan del compositor; aviso leve si se planifica antes de tiempo) y condiciones previas
del proyecto. Hecho: editar dependencias a mano (pulsando «después de…» en la tarea). Pendiente: confirmación de subcontratas/alquileres con fecha, avisos de retrasos. Hecho: actualización en vivo
entre usuarios (Server-Sent Events).

**Fase 6 – Informes.** Hecho: proyectos (presupuesto / estimado / real / coste / importe),
operarios, máquinas, fiabilidad y desvíos, exportación a Excel (CSV). Pendiente: materiales,
PDF, devolver las horas reales al compositor para presupuestar mejor.

Pendientes técnicos: drag & drop táctil (tablets), migraciones versionadas en lugar de scripts
de inicio, HTTPS con proxy inverso (Caddy/Traefik) para publicarlo fuera de la red local, tests.
