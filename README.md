# Planéalo (s360_planificacion)

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
app/src/tramos.js         cuadrante del día y tramos (planificar, mover, repartir, recursos)
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
app/public/ayuda*.js      ayuda: «?», recorridos y novedades
app/src/compras.js        proveedores y pedidos de compra (aprobación, PDF, envío)
app/src/externos.js       talleres externos: área de cada taller y situación del producto por OT
app/src/costes.js         control de costes por proyecto (presupuesto, real, previsión, margen)
app/src/importar.js       importación de proyectos del compositor (s360-import/2 y /1) y catálogo
app/src/migraciones.js    cambios de esquema que se aplican solos al arrancar
app/public/               frontend sin compilación: index (cuadrante), proyectos, recursos, usuarios,
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

## Cuadrante operativo diario (fase 1, incluido)

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
  otro día, quitar del cuadrante y lista de todos los tramos de la tarea para saltar entre días.
  Las 2h después del fin de jornada se ven rayadas: se pueden usar como horas extra y avisan.
  Soltar un tramo en el panel derecho lo quita del cuadrante (sus horas vuelven a pendientes).
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
  otra obra. En el cuadrante van al final, bajo el rótulo «Obras», con el código del proyecto, y
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
  tramos. No bloquea el cuadrante (se siguen arrastrando recursos); se mueve arrastrando su cabecera
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
  en el cuadrante, descripción, abierta/cerrada. Progreso de tareas planificadas y hechas.
  Una OT con tareas planificadas o hechas no se borra: se cierra.
- **Tareas de la OT:** nombre, horas, operarios necesarios, área por defecto y requisitos:
  un **tipo de recurso** con cantidad («una Soldadora MIG», «2 × Oficial 3º») o un recurso
  concreto («MIG 1»). Se ordenan con ↑↓. Son lo que se arrastra al cuadrante.
- Todo se guarda al salir de cada campo. La URL recuerda el proyecto y la OT abiertos.

## Tipos de recurso

Oficios (Soldador, Oficial 3º…), tipos de máquina (Soldadora MIG, Plegadora…) y tipos de
subcontrata / alquiler (Grúa, Lacado…). Se gestionan en Recursos › «Tipos de recurso» y cada
recurso puede tener varios (un operario, varios oficios). Una tarea puede pedir un tipo aunque
no estén dadas de alta todas las máquinas: en el cuadrante el requisito se cumple con cualquier
recurso asignado de ese tipo; si falta, aviso; si no hay ninguno de ese tipo dado de alta, aviso
suave («no hay ninguno dado de alta»). Al seleccionar una tarea, el panel de recursos marca con ✓
los que cumplen lo que pide.

## Recursos (pantalla aparte, menú superior)

Tres pestañas, cada una con su lista (buscador, «ver dados de baja») y su ficha, que se guarda
al salir de cada campo:

- **Operarios:** nombre, nº de empleado, **vínculo** (plantilla / subcontratado, con su empresa
  o «Autónomo»), oficios / roles, teléfono, email, coste €/h, área habitual, notas. Un
  subcontratado que trabaja de operario (pintor, oficial…) cuenta en los operarios de las
  tareas, cumple oficios y suma horas-persona; en el cuadrante lleva la etiqueta «SUB».
- **Maquinaria:** nombre, nº / matrícula, tipo(s) de máquina, ubicación habitual, coste €/h,
  notas (mantenimiento, capacidades…).
- **Subcontratas y alquileres:** empresas que hacen un trabajo entero o alquileres (lacado
  externo, grúa, plataforma): nombre en el cuadrante, clase (subcontrata / alquiler), tipo,
  empresa o proveedor, teléfono y email de contacto, coste €/h, notas. Si alguien está aquí pero
  es una persona que trabaja de operario, «Pasar a Operarios» lo convierte en operario subcontratado.

Cada ficha muestra su **uso**: horas asignadas en las próximas 2 semanas, próxima y última
asignación e historial. **Baja:** si el recurso se ha usado alguna vez se **da de baja**
(deja de salir en el panel del cuadrante para asignar, pero conserva su historial y sigue
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
  | planificar | cuadrante: tramos, asignaciones, estado de las tareas |
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

Correo de salida: se configura en **Compras › Ajustes › Correo de salida** (permiso `usuarios`):
servidor, puerto, seguridad, cuenta, contraseña y remitente, con «Probar conexión» y «Enviar correo de
prueba». Se guarda en `ajustes` ('correo') con la contraseña cifrada (AES-256-GCM); la clave está fuera
de la base de datos (`CORREO_CLAVE` en `.env` o, si no, el archivo `.clave-correo` del volumen de
archivos), y la contraseña nunca vuelve al navegador. Si el panel está vacío vale lo de `.env`
(`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Además, en `.env`:
`APP_URL` (la dirección pública para los enlaces; en el VPS la pone el script de despliegue).

## Supervisión de partes (lo real)

Menú **Parte** (permiso «planificar»: el encargado al final del día). Lo planificado no se
toca: lo real se guarda aparte y se compara.

- Cada tramo del día se cierra con:
  - **✓ Como estaba**: se hizo tal cual. Las horas reales son las franjas planificadas (sin
    quien estaba ausente todo el día).
  - **✎ Corregir**: quién trabajó (personas y máquinas) y de qué hora a qué hora, con motivo
    opcional del cambio.
  - **✗ No se hizo**: con motivo. Se quita del cuadrante y sus horas vuelven a «Por planificar»
    (queda registrado para los informes; «Deshacer» lo vuelve a poner).
- Y cómo va la tarea:
  - **sigue**: va según lo previsto; no cambia nada (pasa a «en curso»).
  - **faltan X h de tarea** (horas de reloj; con 2 operarios son el doble de horas-persona, y se
    muestra al escribirlo): la tarea pasa a *lo planificado hasta este tramo + X*. La primera
    vez se guarda la estimación original. La diferencia con lo que ya hay planificado después
    sale en «Por planificar» (o como exceso, si sobra).
  - **terminada**: pasa a hecha (fecha y quién). Si quedan tramos planificados después,
    **pregunta si se quitan** del cuadrante (Quitarlos / Dejarlos / Volver). Lo mismo al poner
    una tarea en «hecha» desde el cuadrante.
  - Si la tarea tiene **tramos anteriores sin cerrar**, la tarjeta avisa: «faltan» y
    «terminada» los dan por hechos tal como estaban.
- **Deshacer** un cierre devuelve también la tarea a como estaba (estado, estimación) y
  repone los tramos que se quitaron al terminarla. Se deshace en orden: primero el cierre más
  reciente de esa tarea.
- **Horas fuera del plan**: trabajo en una tarea que no estaba planificado, o tiempo no
  productivo (desplazamiento, espera, limpieza, mantenimiento del taller, formación).
- **Cerrar el día** (valida como estaba lo que quede). Un día cerrado no se replanifica en el
  cuadrante; se puede reabrir. Se avisa de los días pasados con trabajo sin cerrar.
- Motivos de desvío: falta de material, avería, retrabajo / error, cliente, clima, ausencia,
  mal estimado, otro.
- En el cuadrante: ✓ / ≠ en los tramos cerrados (no se arrastran), 🔒 en los días cerrados y
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
- Se ve en el cuadrante (OTs y proyectos con algo hecho), en Proyectos (lista, ficha, partidas,
  OTs y cada tarea: «real 32 h · 125 %» o «llevas 45 h de 40») y en Informes (columnas Avance y
  Rend., tarjetas).

## Menú principal

Agrupado (`comun.js › GRUPOS`), cada grupo con desplegable (al pasar el ratón o pulsar) y la suma de
lo pendiente de sus pantallas: **Planificación** (Cuadrante, Supervisión de partes, Bandeja, Mi día) ·
**Proyectos** (Proyectos y OTs, Logística y compras) · **Recursos** (Operarios, máquinas y subcontratas,
Áreas de trabajo, Capacidades, Usuarios y accesos) · **Informes**. Solo salen las pantallas que permite el rol; un grupo con una sola pantalla
es un enlace directo. **＋ Capturar** va como botón junto al usuario.

## Recursos (pantalla)

Pestañas: Operarios · Maquinaria · Subcontratas y alquileres · Vacaciones y festivos · **Áreas de trabajo**
(misma gestión que el botón del cuadrante, en `areas-ui.js`; también en el menú Recursos) · *Capacidades ↗*
(otra pantalla) · **⚙ Tipos** (catálogo, a la derecha). Ficha en dos columnas en pantallas anchas:
datos a la izquierda; uso y ausencias a la derecha.
- Operario: «Categoría / puesto» (Oficial 1ª, 2º, Encargado…) solo agrupa en el cuadrante; lo que sabe
  hacer y lo que piden las tareas va en Capacidades. Debajo, sus datos personales (Mi perfil) y sus
  capacidades (validadas y por validar).
- Tipos de máquina con **familia** (naturaleza: Soldadura, Corte y mecanizado, Fijación y montaje,
  Elevación y acceso, Vehículos y transporte, Medición, Pintura, Oficina técnica) y **uso** (taller, obra,
  taller y obra). La lista de Tipos y el cuadro de requisitos las agrupan por familia. Se quitó el tipo
  comodín «Equipo portátil para obra» (las tareas que lo pedían piden ahora el equipo concreto; script en
  `app/src/datos/2026-11-17-quitar-equipo-portatil.sql`).
- Ya no se ofrece «Cargar semillero…» en pantalla (los recursos ya están dados de alta).
- Máquina: «Área / ubicación» y **«¿Se mueve?»** (Se mueve / Fija en esa área = `recursos.fijo_area`,
  lo mismo que Áreas de trabajo › Equipo fijo).
- Ficha de un tipo: explicación de para qué sirve según su clase; sin bloque de ausencias.
- Bandeja › clasificar como tarea: pide «Sabe hacer» (capacidad), ya no oficio.

## Capacidades (saber hacer)

Lo que pide una tarea es **saber hacer algo** («2 que sepan soldar MIG/MAG»), no una categoría.
La categoría (Oficial 1ª, 2º…) se queda en la ficha del operario para el coste.

- **Panel de Capacidades** (menú «Capacidades», `capacidades.html`; editar con permiso «recursos»):
  - *Por capacidad*: lista por familias (Soldadura, Herrería y calderería, Carpintería de aluminio y PVC,
    Pintura y acabados, Montaje en obra, Uso de maquinaria, Elevación/altura/vehículos, Herramientas
    portátiles, Seguridad y formación, Oficina técnica). Se añaden capacidades en cada familia (↵),
    familias nuevas, se renombran, se cambian de familia o se quitan. A la derecha, quién la sabe hacer.
  - *Por persona*: qué sabe hacer cada operario, con casillas por familia y filtro.
- **Tareas**: en Proyectos, la columna «Requiere» es un botón con el resumen; abre el cuadro
  **Requisitos de la tarea**: arriba lo que pide (chips con ✕), buscador que busca en todo, y a la
  izquierda las secciones Saber hacer (por familias, en columnas) · Equipos y máquinas · Subcontratas
  y alquileres · Categorías · Recurso concreto, con cuántos hay de cada uno y cantidad al marcar.
  Se guarda todo junto con «Guardar». Tablas `capacidades`, `recurso_capacidades`, `tarea_capacidades`.
- **Cuadrante**: aviso «necesita 2 que sepan … (X no la tiene)»; leve si nadie la tiene marcada. «Solucionar»
  propone a quien la sabe. Al seleccionar una tarea se marca ✓ a quien cumple; el tooltip del recurso
  dice «Sabe: …».
- **Lo propone el operario, lo valida el supervisor**: en Mi día › Menú › *Mis capacidades* el operario
  marca lo que sabe hacer; queda «⏳ pendiente» (`recurso_capacidades.estado = 'propuesta'`) y solo
  cuenta en el cuadrante cuando alguien con permiso «recursos» lo valida (pestaña **Por validar** del
  panel, con contador en el menú y aviso al móvil `cap_propuesta`). Lo validado ya no lo puede quitar
  él. Lo que marca el supervisor directamente queda validado.
- **Lista inicial y conversión** (una vez, `ajustes.capacidades_semilla`): ~79 capacidades. Los oficios
  que eran saber hacer pasaron a capacidad, en las tareas que los pedían y en las personas que los
  tenían: Oficial 1ª Soldador → Soldadura MIG/MAG; Oficial de aluminio → Ensamblado de ventanas y
  puertas de aluminio; Pintor → Pintura con pistola aerográfica; Ingeniero / Delineante → Diseño CAD;
  Oficial Montaje Obra → Montaje de carpintería en obra. Encargado, Oficial 2º/3º y Jefe de proyectos
  siguen como categoría.

## Operarios: Mi día con PIN

**El móvil es para confirmar y reportar; redactar y planificar, en el ordenador.** Entrar con PIN
lleva siempre a Mi día.

**Navegación**: barra inferior con *Mi día*, un **botón central «Menú»** y *Capturar*. El menú (hoja que
sube desde abajo) tiene, para todos: Mi día, Mi mes, Capturar, Vacaciones, Avisar, **Mi perfil** (con
«Cambiar mi PIN» dentro), **Mis capacidades**, Avisos al móvil (no en la tablet común) y Salir. Un
punto naranja en el botón avisa si le faltan datos del perfil.

**Logística en el móvil** (con permiso «logistica»): en el menú, **📦 Revisar stock** y **🚚 Recibir
material** con lo pendiente. Tarjetas grandes por material (cantidad, para cuándo, tareas): «✗ No hay»,
«✔ Hay todo» o «Hay N»; foto con la cámara; y «✔ Ha llegado» en lo pedido (`mi-dia-stock.js`, mismas
APIs que Logística). Pedir a proveedores sigue en el ordenador (Logística y compras).
**Nº de pedido y albarán**: al marcar «🛒 Pedido» compras puede poner el **nº de pedido** y adjuntar el
pedido (PDF o foto); al recibir (ordenador o móvil) logística pone el **nº de albarán** y la foto del
albarán. Se ven en la línea («Pedido nº … · albarán nº …») y se pueden corregir después
(`partida_escandallo.num_pedido / num_albaran`, `PUT /api/escandallo/:id/documentos`).
Botón **⚠ Incidencia** (en Recibir junto a «Ha llegado», y en Revisar stock): comentario + fotos con la
cámara; se guarda en `escandallo_incidencias` (las fotos van a la línea), avisa a compras, al técnico y a Operaciones
(`mat_incidencia`, con las tareas afectadas y su primer día planificado); en el **cuadrante** la tarea que usa ese material lleva
«🧰 ⚠», un aviso grave con el texto de la incidencia y la incidencia en el material del detalle (y en Mi día), hasta que se resuelve y en Logística y compras se ve en naranja hasta que alguien pulsa «✔ Resuelta»
(`POST /api/escandallo/:id/incidencias`, `PUT /api/escandallo-incidencias/:id/resolver`).

**Mi perfil** (`GET/PUT /api/mi-dia/perfil`): teléfono, email, DNI/NIE, nacimiento, dirección, C.P.,
localidad, nº Seguridad Social, contacto de emergencia (nombre y teléfono), carnet, tallas de ropa y
calzado (`recursos.perfil` JSONB; teléfono y email en sus columnas). Los marcados * son importantes.
Se ven en la ficha del operario en Recursos solo para quien tiene «recursos», «usuarios» o RRHH.

Cada operario apunta su día desde su móvil o desde una tablet común del taller; el encargado
lo revisa y confirma siempre en el Parte.

- **Acceso** (Usuarios › «Personas: entrada con PIN»): se le pone un **PIN de 4 cifras** (no
  vale 0000, 1234…; botón 🎲 para uno al azar). Se crea un usuario con el rol **Operario**
  (permiso «mi_dia» solo): no ve el cuadrante, ni costes, ni lo de los demás.
- **El PIN es la autorización**: en la misma tabla, la columna **Rol** (desplegable con casillas:
  **uno o varios roles**, se suman sus permisos; se guarda al cerrarlo) cambia lo que puede hacer
  esa persona (Logística, Técnico, Compras, Operaciones…; no se ofrecen roles con permiso
  «usuarios», que siguen entrando con email). Al entrar con PIN va a su pantalla (Logística →
  Logística, Técnico/Operaciones → Proyectos, Operario → Mi día) y siempre puede apuntar su día
  en Mi día (botón ☰ para volver a sus pantallas). Cambiar el rol cierra sus sesiones.
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
  pendiente de justificante** en el cuadrante y en el parte (con la marca «avisó él»). Puede
  quitar el aviso mientras no haya pasado el día.
- **Justificantes pendientes**: sus faltas sin justificante; sube la foto. RRHH / el encargado
  la ve en Recursos › «Faltas pendientes de justificante» y marca justificada o no.
- **Incidencias** (ahora son capturas, ver «Bandeja de capturas»): falta material, avería (con qué máquina), calidad, seguridad u otro, con
  texto y fotos; desde la pestaña o con «⚠ Avisar de una incidencia» en un trabajo de hoy. El
  encargado las ve en el Parte («Incidencias abiertas»): **Máquina parada hoy** (la máquina
  queda no disponible en el cuadrante; se amplía en Recursos) y **Resuelta** (con nota que ve
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

## Sin conexión (app del móvil)

`public/sw.js` (service worker) y `public/offline.js` (barra de estado, en Mi día y Capturar).

- **Arranque rápido**: Mi día, Capturar, entrar con PIN e inicio se guardan en el móvil con su código y estilos; se abren
  al instante y sin red (la red se usa si contesta en < 3,5 s y se renueva por detrás). El código con versión (`?v=…`) se
  sirve siempre del móvil en todas las pantallas (no cambia), así que también el ordenador va más rápido.
- **Datos**: Mi día (hoy, mañana, el mes), gestiones, capturas, compras locales, `me` y pendientes: primero la red; si no
  contesta en 3,5 s o no hay, la última copia (barra «📴 Sin conexión · datos de las 07:42»). Con red, una vez por hora se
  dejan guardados mañana y el mes.
- **Bandeja de salida** (IndexedDB `planealo-salida`): lo que se apunta sin red — Mi día (hecho / en parte / no / terminada),
  trabajo no planificado (y quitarlo), enviar mi día, material y herramientas preparados, fotos/audio/vídeo, capturas y
  asuntos resueltos, pedir vacaciones (y anular), avisar de que no vengo / llego tarde (y quitarlo, justificante), Mi perfil,
  Mis capacidades, compras locales (pedir, ticket, anular y **autorizar**: el código se crea al enviarse), y en logística
  revisar stock, recibir material, incidencias y fotos — se guarda y se envía solo, en orden, al volver la cobertura (evento online, cada
  30 s, Background Sync en Android; en iPhone al abrir la app). Mientras, se ve ya aplicado en Mi día y Mis compras
  («⏳ sin enviar»). Las fotos sin enviar llevan un id provisional negativo que se cambia por el real al enviarlas.
  Lo que el servidor no acepte (p. ej. día ya cerrado por el encargado) se aparta y se avisa en la barra.
- **Por persona**: la página le dice al service worker quién usa el móvil; lo apuntado solo se envía con la sesión de esa
  persona (tablet común) y al cambiar de persona o salir se borran los datos guardados.
- Sigue necesitando red: cambiar el PIN o la contraseña, ver cuántos días son unas vacaciones antes de pedirlas (se calcula
  al enviarlas), buscar «Otra tarea…» en compras locales (sin red salen solo las tuyas), entrar la primera vez, el cuadrante y
  la oficina.

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
    planificando se agrupa, como mucho uno cada 5 min; de noche espera a la mañana),
    **recordatorio a las 17:00** si no ha enviado su día (laborables con trabajo),
    **vacaciones** aprobadas o rechazadas;
  - todos: lo que **capturé** se convierte en tarea o se resuelve; **asunto asignado** a mí y
    asuntos que **vencen mañana** (a las 8:00);
  - quien planifica: **avería o seguridad** capturada (al momento), **resumen de la bandeja**
    (cada 30 min si hay nuevas), un operario **avisa de que no viene o llega tarde**;
  - Operaciones / RRHH: **petición de vacaciones** que espera su paso.
- Al pulsar el aviso se abre la pantalla correspondiente.
- **Android y la batería**: si el ahorro de batería restringe Chrome, los avisos no llegan con
  la app cerrada. Al activarlos sale «Un último paso» con la ruta exacta según la marca
  (Samsung, Xiaomi, Huawei, Oppo/Realme/OnePlus u otras) y **Probar con la app cerrada** (el
  servidor manda una prueba a los 20 s). También en 🔔 › «¿No te llegan con la app cerrada?».
  Una web no puede abrir esa pantalla de ajustes directamente.

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

- **Falta rápida desde el cuadrante:** clic en un operario del panel de recursos (o en su nombre
  en la vista por operarios) → día, «Todo el día / Se fue a las… / Llegó a las…» y un botón:
  **Falta**, Baja, Permiso, Vacaciones… Con una máquina: Avería, Mantenimiento, ITV.
  Lo puede hacer quien planifica. Si ya hay algo apuntado ese día, sale con «Quitar».
- **Justificante de las faltas:** toda falta nace «pendiente de justificante». Se marca
  justificada / sin justificar desde el mismo diálogo del cuadrante, desde la ficha del operario o
  desde la lista «Faltas pendientes de justificante» (Recursos › Vacaciones y festivos). Las
  faltas no restan vacaciones y se cuentan en su columna (total, sin justificar, pendientes).
- **Ausencias** en la ficha de cada recurso (Recursos › Operarios / Maquinaria): desde–hasta, o
  solo unas horas de un día (un médico de 9:00 a 11:00), con notas.
  - Operarios: vacaciones, baja, permiso, formación, falta (con justificante), otro.
  - Máquinas, vehículos y alquileres: avería, mantenimiento, ITV / revisión, otro.
  - Si tenía trabajo asignado en esas fechas, al apuntarla se avisa con la lista de tramos.
- **En el cuadrante:**
  - Quien falta todo el día sale atenuado en el panel de recursos con el motivo y no se puede
    arrastrar; en semana / mes, «Xd fuera» y la capacidad descuenta esos días.
  - Si está asignado a un tramo, aviso grave «está de vacaciones y tiene asignado…» con
    «Solucionar»: pasar su parte a otro del mismo oficio que esté libre, o quitarlo.
  - Vista por operarios: su fila rayada (o solo sus horas). Semana: «vacaciones» en su celda.
    Mes: «N fuera» en el día y la ocupación se calcula con los disponibles.
  - «Repartir» salta los festivos y no asigna a quien falta ese día.
- **Festivos** (Recursos › Vacaciones y festivos): vienen cargados los de Illes Balears y los
  locales de Sant Lluís de 2026 y 2027 (BOIB). Se añaden a mano los de años siguientes y los
  cierres de empresa. En festivo el cuadrante lo marca y avisa si hay algo planificado.
- **Saldo de vacaciones:** 22 días laborables al año por convenio (`VACACIONES_DIAS`); cada
  persona puede tener los suyos en su ficha. Se cuentan días laborables (lunes a viernes sin
  festivos) y medio día / unas horas en proporción. La pestaña Vacaciones y festivos muestra,
  por año, apuntados, ya disfrutados, los que quedan, otras ausencias y la ausencia actual o
  próxima. Los subcontratados no llevan saldo.

## Orden de los departamentos en el cuadrante

Las cabeceras de departamento del cuadrante (vista día por áreas) se reordenan **arrastrándolas**
(o con **Alt + ↑ / ↓** teniendo la cabecera enfocada). Hace falta el permiso «recursos». Obras y
«Otras áreas» quedan siempre al final. El semillero ya no pisa este orden al recargarse; los
departamentos nuevos se añaden al final.

## Semillero de recursos de la empresa

[`semillero/semillero.json`](semillero/README.md) describe departamentos, áreas de trabajo
(puestos, máquinas fijas, mesas…), oficios, tipos de máquina, máquinas, vehículos, personas y
subcontratas. El planificador lo carga desde **Recursos → «Cargar semillero…»** (vista previa y
luego aplicar; renombra en vez de duplicar, fusiona tipos repetidos y desactiva lo que sobra si
tiene historial). El compositor usa los mismos nombres, y sus nombres antiguos están como alias.

- **Departamentos:** las áreas se agrupan en el cuadrante en bloques plegables por departamento
  (y las obras al final).
- **Áreas de «un trabajo a la vez»** (puestos de oficina, máquinas fijas): si coinciden dos
  tramos, aviso leve con «Solucionar» (empezar cuando quede libre o pasar a otro puesto libre).
- **Puesto habitual:** cada persona tiene su puesto; al planificar en él, «Solucionar» la propone
  primero.

## Importación de proyectos

El compositor de proyectos exporta un archivo `.s360.json` (formato **`s360-import/2`**; el `/1`
sigue valiendo) con el proyecto, sus partidas, OTs y tareas. Especificación, JSON Schema, ejemplo
completo y copia del catálogo en [`docs/importacion/`](docs/importacion/README.md).

**Proyectos y OTs → «Importar…»**: se arrastra el archivo y sale una **vista previa** (no cambia
nada): qué se crea o actualiza (proyecto, OTs, tareas, material, lo que piden, desgloses), avisos,
y una tabla con los **nombres que no coinciden** con lo que hay en el planificador (áreas,
capacidades, tipos de máquina, subcontratas, recursos). Para cada uno se elige crearlo, usar uno
que ya existe o no asignarlo; lo que se asocia se **recuerda** para la próxima vez. Al confirmar se
importa todo de una vez (o nada).

Lo que trae cada tarea (v2):
- `horas` (duración) × `operarios` y su **desglose de tiempos** (concepto, fase, cantidad ×
  rendimiento = horas-persona); el desglose se ve en el detalle de la tarea y avisa si no cuadra.
- **Capacidades** que piden (sustituyen al oficio), **equipos** y **subcontratas** por tipo con
  cantidad, **herramientas de mano** y el **material** de la partida que consume (por `ref`).
- Área por nombre (sus máquinas fijas van solas) o por tipo; `area_tipo: "obra"` va al área
  «Obra · ‹obra del proyecto›», que se crea sola.
- **Dependencias** (`despues_de`, con `espera_h` de secado/curado) y **condiciones previas**.

Cada partida trae su **escandallo** (`materiales`, con `ref_externa` estable); con
`enviar_a_logistica: true` se envía directamente a logística (aviso para revisar stock).

**Reimportar** el mismo proyecto (mismo `ref_externa`) actualiza sin duplicar y conserva la
planificación, asignaciones, stock y pedidos. Lo que ya no está en el archivo se borra si no tiene
nada hecho; si lo tiene (tramos, o material revisado/pedido), se conserva marcado «fuera de
presupuesto». Si cambia la cantidad de un material que logística ya revisó, avisa. Las herramientas
y material añadidos a mano en el planificador se conservan.

`GET /api/importar/catalogo` devuelve los nombres exactos (áreas con su equipo fijo, capacidades,
equipos por familia y uso, subcontratas, categorías, materiales y herramientas) para que el
compositor los use.

## Compras: pedidos de compra y proveedores (menú Compras)

- **Material de las partidas** (logística) pasa al menú Compras. En «Por pedir» cada línea tiene
  **«Incluir en un pedido de compra»**; abajo se elige el proveedor y **Crear pedido de compra**.
  Lo pedido por teléfono, con **📞 Ya pedido por teléfono** (ver «Todo pedido es un pedido de compra»).
- **Pedidos de compra** (`/compras.html`): por estado (esperando aprobación, aprobados por enviar,
  borradores, enviados). Ficha con proveedor, entrega, dónde, referencia, forma de pago,
  observaciones y **líneas con precio** (más líneas a mano: portes…); se guarda al cambiar.
  - Total por encima del **límite** (Ajustes, 3.000 € por defecto) → **Pedir aprobación**: avisa a
    quien tiene el permiso **aprobar_compras** (Dirección y Administrador), que **aprueba** o
    **no aprueba** con motivo (vuelve a borrador y se avisa a quien lo preparó).
  - **PDF del pedido** (pdfkit) con los datos de la empresa y las condiciones de Ajustes.
  - **Enviar**: por correo desde la cuenta SMTP (compras@) con el PDF adjunto, o «Ya lo he
    enviado yo». Al enviarlo, sus líneas pasan a **Pedido** con proveedor, fecha, nº de pedido
    (PC-AAAA-NNNN) y **precio** (base del coste comprometido del material).
- **Peticiones de precio** (SOL-AAAA-NNNN, pestaña de Compras): desde «Por pedir», marcar líneas →
  **✉ Pedir precio…** → proveedores (primero los que sirven ese material) y fechas. A cada proveedor
  se le envía el **PDF de la petición** (por correo o a mano) y se le puede **recordar**. Su oferta
  se apunta (precio por línea, entrega, portes, su referencia y PDF). **Comparativo** línea ×
  proveedor con lo más barato que llega a tiempo marcado; se elige proveedor por línea (o **No pedir**: la línea queda
  fuera) y **Crear
  pedidos** hace un pedido por proveedor con esos precios (y los portes). Lo no elegido vuelve a
  «Por pedir». **✕ Anular petición** la cancela sin pedir nada (todo vuelve a «Por pedir»; las ofertas se conservan). Mientras pide precio, la línea sale en logística como «✉ Pidiendo precio».
- **El proveedor responde en la plataforma** (`/oferta.html?t=…`, `src/ofertas-portal.js`): el correo
  y el PDF de la petición llevan un **enlace personal** por proveedor y petición (también «🔗 Enlace»
  en su tarjeta, para WhatsApp). Sin cuenta: ve los datos de la empresa y el material y pone **precio
  por línea**, «No lo tengo», **alternativa**, entrega, portes (o incluidos), su referencia, contacto,
  observaciones y su **PDF**. Puede corregir mientras la petición esté abierta; cerrada queda para
  leer. Al enviar, aviso `oferta_recibida` a compras y la oferta entra en el comparativo («🌐 respondió
  en la plataforma»; «👁 abrió el enlace» si solo lo miró). El enlace es `sp.firma`: HMAC con la clave
  del servidor sobre `solicitud_proveedores.portal_nonce`; «nuevo» anula el anterior
  (`POST /api/compras/solicitudes/:id/proveedores/:sp/enlace {nuevo}`). API pública:
  `GET·PUT /api/oferta/:t`, `POST·GET·DELETE /api/oferta/:t/archivos[/:id]`, `GET /api/oferta/:t/pdf`.
- **Proveedores**: ficha (CIF, email de pedidos y de facturas, teléfono, contacto, forma de pago,
  plazo, portes, lo que sirve, notas, activo). Vienen de Notion.
- **Correo de salida**: en **Compras › Ajustes › Correo de salida** (cuenta compras@; IONOS,
  smtp.ionos.es:587 STARTTLS). Alternativa en el servidor: `bash configurar-correo.sh` (lo deja en
  `.env`; lo del panel manda sobre esto).

## Códigos de proyecto, OT y tarea

Jerárquicos y automáticos (triggers en `migraciones.js`): el proyecto `P-2026-0061` es **61**; sus OTs **61.01, 61.02…**
(por partida al renumerar; luego, la siguiente libre) y sus tareas **61.02.1, 61.02.2…** (`tareas.numero`, estable: no
cambia al reordenar). Al cambiar una OT de proyecto o el código del proyecto, se renumeran OT y tareas. Si otro proyecto
más antiguo ya usa el mismo número (p. ej. `P-2027-0061`), se antepone el año: **27-61.01**. El código anterior de cada
OT (el del compositor, `OT-0058-ING`, o `OT-1568`) queda en `ordenes.codigo_antiguo`, se ve en la ficha («antes …») y se
puede buscar en el cuadrante; al reimportar, el código del compositor ya no pisa el nuevo. Las OTs sin proyecto conservan
`OT-NNNN`. En el cuadrante, cada tarea sale con su código y nombre (grande) y debajo OT, partida, obra y cliente.

**Nombres breves**: el importador avisa (`nombre_largo`) si proyecto > 40, partida > 30, OT > 35 o tarea > 40
caracteres (el detalle va en descripción/notas). En el cuadrante, los avisos citan la tarea por su código y un nombre
corto (y dentro del detalle de la tarea, sin repetirla); cliente sin forma jurídica y obra = localidad (completo al
pasar el ratón).

## Marca

**Planéalo**: monograma (barra vertical y tres barras de tareas, la del medio naranja) en `public/logo.svg` (también
`favicon.svg`), iconos de la app `icono-192/512`, `icono-512-maskable`, `apple-touch-icon`; verde `#10776c`, naranja
`#f59e0b`. Cabecera `h1.marca` en todas las pantallas.

## Talleres externos (lo que se hace fuera)

Una tarea de una OT la puede hacer un **taller de fuera** (Ferros Puig, una carpintería de aluminio, la galvanizadora,
el transporte…). No hay etapas fijas: las etapas son **las tareas de la OT**, en su orden y con sus dependencias
(`src/externos.js`).

- **Elegir el taller**: en Proyectos, columna **Área / taller** de la tarea (grupo «Taller externo», con los
  proveedores activos). La tarea guarda `tareas.proveedor_id` y va al área de ese taller (`lineas.tipo = 'externo'`,
  `lineas.proveedor_id`; se crea sola, una por proveedor). Elegir un área propia quita el taller.
- **Sin requisitos propios**: en una tarea externa, Oper. y Requiere no aplican («no aplica (fuera)»; se conservan por
  si vuelve a hacerse aquí), la duración se ve en **días** (1 día = una jornada) y no cuenta en horas-persona, avance
  ni mano de obra de costes e informes.
- **Avance y cómo va**: `ext_avance` (%) y `ext_nota`, en la tabla de tareas y en el detalle del cuadrante. Los pone el
  propio taller desde su enlace de seguimiento (abajo) o, a mano, la oficina.
- **Seguimiento con el taller** (`src/seguimiento-ext.js`, página pública `seguimiento.html?t=…`): en la OT, debajo de cada
  tarea externa (fila a lo ancho), **▶ Comenzar seguimiento** crea el enlace de ese taller para esa OT
  (`ext_seguimientos`, uno por OT y proveedor) y lo manda por correo (con sus tareas y fechas) o lo copia para WhatsApp.
  Cada taller empieza cuando se pulsa su botón. Sin cuenta: el enlace es `id.firma` (HMAC con la clave del servidor sobre
  `nonce`; «Nuevo» lo cambia, «⏹ Parar» lo desactiva). En su página ve sus tareas de la OT (y las de los otros talleres,
  solo para verlas) y pone por tarea: **estado** (`ext_estado`: sin_empezar / en_curso / terminado / entregado; mueve la
  tarea a en curso / hecha), **avance**, **cuándo terminará** (`ext_fin_prevista`), comentario, **fotos** (archivos
  `ext_foto`) y, al entregar, **a quién** (otro taller de la OT, nosotros u otro), fecha, bultos y **albarán**
  (`ext_entregado_a`, `ext_entrega_*`, archivo `ext_albaran`). Si entrega a otro taller de la OT, la siguiente tarea de ese
  taller queda «material recibido» (`ext_recibido`). Cada cambio queda en `ext_novedades` y avisa a quien planifica
  (push `ext_seguimiento`). **Solo avisa**: si su fecha pasa de la planificada sale el aviso `retraso_taller` en el
  cuadrante y la dependencia de lo siguiente usa su fecha («según el taller»), pero el plan no se mueve solo.
  **Recordatorio**: si una tarea suya sin terminar tiene su fecha (la suya o, si no puso, la nuestra) pasada y no ha
  actualizado ese día, un correo al día (laborables, 9–19 h, sin festivos) hasta que actualice o la termine; el primero
  avisa también a quien planifica. API: `POST /api/ordenes/:id/seguimientos {proveedor_id, email, enviar}`,
  `POST /api/seguimientos/:id/enlace {nuevo}`, `PATCH /api/seguimientos/:id {activo}`, `GET /api/ext-archivos/:id`;
  pública `GET·PUT /api/seguimiento/:t`, `POST /api/seguimiento/:t/tareas/:tid/archivos[?albaran=1]`,
  `GET·DELETE /api/seguimiento/:t/archivos/:id`.
- **Cuadrante**: bloque **Talleres externos** al final (después de las obras), una fila por taller **solo mientras tiene
  tareas activas** (no hechas, de OTs abiertas) o tramos en las fechas vistas. Se planifica igual (arrastrar, repartir en
  días). No ocupa a nadie de aquí: sin avisos de operarios, requisitos, capacidades ni jornada (`externa` en
  `conflictos.js`; solo dependencias y exceso). Si una tarea va después de una tarea externa que aún no ha terminado, el
  aviso de dependencia es **grave** (la pieza no está aquí). Bloques con 🏭 y su avance.
- **Situación del producto** (por OT): recorre sus tareas externas en orden → «En Ferros Puig · Fabricación · 60 % ·
  termina ~26/11 · «nota»», «En Tenas: galvanizado terminado · lo siguiente: Transporte (Ydica)», «Aún no ha salido…» o
  «Ya no está fuera». En Proyectos (lista de OTs y ficha, con las tareas externas y sus fechas) y en el detalle del
  cuadrante. `situacion` en `/api/ordenes` y `/api/ordenes/:id`; `situaciones` en `/api/tablero`.
- **Subcontratación** (`src/subcontratacion.js`): en la OT, **🏭 Subcontratar…** marca tareas externas (+ líneas sueltas:
  transporte, portes) y crea en Compras una **petición de presupuesto** a uno o varios talleres o un **pedido** a uno
  (`POST /api/ordenes/:id/subcontratacion {tarea_ids, extras, accion: presupuesto|pedido, proveedor_ids|proveedor_id, notas,
  responder_antes}`). Son las mismas peticiones (SOL) y pedidos (PC) de Compras con `tipo = 'subcontratacion'`, `orden_id`
  y líneas con `tarea_id`; la tarea guarda `ext_solicitud_id` / `ext_pedido_id` (una tarea no puede estar en dos a la vez).
  Respuesta en la plataforma, comparativo, «Crear pedidos», aprobación por importe y PDF («PEDIDO DE SUBCONTRATACIÓN»)
  funcionan igual. Al **enviar** el pedido se crea o reactiva el seguimiento de ese taller en la OT y su enlace va en el
  correo y en el PDF; si el pedido es para otro taller del que tenía la tarea, la tarea pasa a ese taller. Control de
  costes: lo de los pedidos de subcontratación enviados suma en **Subcontratas** (las líneas sueltas, a la primera tarea).
- **Siguientes pasos**: recepción desde el móvil; transportes dentro de la isla.

## Cuadrante (antes «tablero»)

La pantalla de planificación diaria (`/`, `public/app.js`) se llama **Cuadrante** en menús, ayuda y avisos. Las URL y la API no cambian (`/api/tablero`). Una migración actualiza la descripción del rol Planificador.

- `/?tarea=ID&fecha=…` abre esa tarea seleccionada (su tramo de ese día o el más cercano).
- `/?solo=detalle&tarea=ID&fecha=…`, dentro de un iframe, muestra solo la ventana de la tarea (sin menú ni ayuda, `body.solo-detalle`) con 📋 «Ver en el cuadrante».
  - Avisa a la pantalla que la contiene con `postMessage({ s360: 'listo' | 'cambio' | 'cerrar' | 'sin-tarea', cambio })`.
  - Los enlaces se abren en la pantalla entera.
  - Asignar gente sigue siendo arrastrando en el cuadrante.

## Planificar una OT de una vez, moverla y deshacer (Gantt)

`src/planificar-ot.js`, tabla `planificaciones` (tipo `planificar` | `mover`, `detalle` con los tramos, `deshecha_en`).

**Propuesta:** `POST /api/plan-vista/ordenes/:id/planificar {modo: inicio|fin, fecha, ajustes: {tareaId: fecha}, areas: {tareaId: lineaId}}`.
- Las rutas `/api/plan-vista/…` no cambian nada y no avisan en vivo a las demás pantallas (`eventos.SIN_AVISO`).
- Coloca las horas pendientes (estimado − planificado) de las tareas no hechas:
  - en orden de dependencias (`tarea_dependencias` con `espera_h` en horas de calendario) y después `orden_en_of`;
  - en el área de la tarea, por medias horas dentro de la jornada (`config.jornada`), saltando fines de semana y festivos;
  - en las áreas exclusivas, solo en los huecos libres (lo ya planificado y lo propuesto); en las demás, sin límite.
- Fin de una previa (de la OT o de otra):
  - lo propuesto, o su último tramo;
  - si no está hecha, como mínimo la `ext_fin_prevista` del taller y como mínimo «ahora» (si su plan ya pasó, da aviso).
- Una previa sin planificar y no hecha **bloquea**: la tarea y lo que va detrás no se colocan (`bloqueadas`), salvo `sinEsperar: true`, que coloca sin esperar y avisa.
- Cada tarea propuesta devuelve `tras` (qué previa marca su inicio y cuándo acaba); el diálogo lo enseña en «Dónde va cada tarea».
- Una tarea sin área no se coloca: se elige en el diálogo (`areas`) y al confirmar se le guarda.
- `ajustes` es «no antes de» (lo que deja el arrastre); si las dependencias no lo permiten, avisa.
- Modo `fin`: búsqueda binaria del inicio laborable más tardío con el que todo acaba ese día o antes; si ni empezando hoy llega, lo dice.
- Avisos:
  - puesto ocupado (empieza más tarde de lo pedido);
  - taller externo o subcontrata sin confirmar;
  - previa sin planificar;
  - gente: horas-persona del día (lo que ya hay más lo propuesto, por `operarios_req`) frente a operarios activos sin ausencia de día entero × jornada;
  - margen o retraso respecto a la entrega.

**Alcance:** una OT, una partida o un proyecto. Usa `POST /api/plan-vista/planificar` y `POST /api/planificar` con `{alcance: {tipo: ot|partida|proyecto, id}, …}`; las rutas por OT siguen.
- Entran las OTs abiertas y no dadas de baja; sus tareas se ordenan por OT (código) y `orden_en_of`, con las dependencias entre ellas.
- Devuelve `ots` (inicio, fin, entrega, margen de cada una) y una `entrega` global: cuáles no llegan, o el margen mínimo.
- `planificaciones.ordenes INT[]` y `alcance JSONB`: una planificación de partida o proyecto sale en el historial de cada OT, y deshacer la quita entera.
- En el Gantt: 🗓 en la cabecera del proyecto (agrupando por proyecto), con selector «Qué planificar» (proyecto o partidas con pendientes); en Proyectos, «🗓 Planificar» en cada partida (`/gantt.html?partida=ID&planificar=1`; también `?proyecto=ID&planificar=1`).
- El menú, los controles, el aviso de propuesta y la fila de fechas quedan fijos al bajar (`position: sticky` con alturas medidas en `--gt-h1/2/3`, `.gt-g` con `overflow: clip` y `body.gt-pant` sin altura fija).

**Confirmar:** `POST /api/ordenes/:id/planificar` (mismo cuerpo) vuelve a calcular en la transacción (con `pg_advisory_xact_lock`) y crea los tramos sin gente, con `historial` `planificar_ot` y una `planificaciones` que guarda los tramos creados.

**Mover:** `POST /api/plan-vista/ordenes/:id/mover {dias}` y `POST /api/ordenes/:id/mover`.
- Desplaza N días laborables los tramos de hoy en adelante sin horas reales ni cierre de las tareas no hechas.
- Quita del tramo a quien ese día falta o está ocupado en otro tramo, y lo guarda para deshacer.
- Avisa de choques en puestos exclusivos, dependencias con otras OT y la entrega.

**Deshacer:** `POST /api/plan-vista/planificaciones/:id/deshacer` y `POST /api/planificaciones/:id/deshacer {tocados: dejar|incluir}`.
- `planificar`: borra los tramos creados. `mover`: los devuelve a su día y vuelve a asignar a la gente quitada.
- Un tramo cambiado después (día, hora, horas o área) solo se toca con `incluir`.
- Lo que tiene horas reales o cierre no se toca nunca.
- Historial: `GET /api/ordenes/:id/planificaciones`.

**Pantalla (Gantt):**
- 🗓 en la OT abre el diálogo con el resultado en vivo; la propuesta se dibuja rayada.
- Arrastrar una barra propuesta añade un ajuste, con pila para «↶ Deshacer último movimiento»; también Cambiar, Descartar y Confirmar.
- Arrastrar la barra de una OT abre la vista previa de mover.
- Tras confirmar o mover sale un aviso con ↶ Deshacer; 🕘 abre el historial.
- En la ficha de la OT, «🗓 Planificar OT» y «🕘 Planificaciones» llevan a `/gantt.html?ot=ID&planificar=1|historial=1`.
- Con «Solo con riesgo», las OTs que se acaban de planificar o mover (y las de una propuesta en curso) siguen a la vista (`est.fijas`) hasta que se cambia el filtro. El botón dice cuántas oculta.
- El Gantt devuelve `planif_n` por OT y los festivos de ±400 días (para contar laborables al arrastrar).

### Colores

Cada fila de OT y de tarea lleva `--c` con el color de la OT. La barra de la OT usa ese color; las de sus tareas, el mismo más oscuro (`color-mix`). Lo externo (taller, transporte, subcontrata) va rayado y con 🏭/🚚/🏗 en el texto; lo hecho, apagado. La columna de nombres lleva una franja del color.

### Flechas de dependencias

- El Gantt devuelve `deps` (`de`, `a`, `espera_h`) entre las tareas que salen.
- La pantalla dibuja un SVG encima de `#gt-g`: de la última barra de la previa a la primera de la siguiente, midiendo el DOM (`data-t` y `data-o` en las filas).
  - Con una OT plegada, la flecha usa la barra de la OT, una por pareja.
  - Con una propuesta en curso, usa las barras rayadas.
- Los segmentos de cada tarea llevan `[desde, hasta, hora_inicio_primer_día, hora_fin_último_día]` (también los de la propuesta), y el Gantt devuelve `jornada`. Así las barras empiezan y acaban a su hora dentro del día: una tarea que acaba a las 10:00 y la siguiente que empieza a las 10:00 ya no se ven solapadas.
- En rojo discontinuo solo si, con horas reales, la de detrás empieza antes de que acabe la previa más la espera (`pisa()`; no cuenta si alguna está hecha). Si empieza justo al acabar, la flecha baja recta, sin dar la vuelta.
- Botón «↳ Dependencias» (recordado); se redibuja al pintar y al cambiar el tamaño.
- **Editar en el Gantt:**
  - `tarea_dependencias.nota` es una observación libre (el `PUT /api/tareas/:id/dependencias` de Proyectos la conserva).
  - `POST /api/dependencias {tarea_id, depende_de_id, espera_h, nota}` crea o cambia una dependencia (mismo proyecto, sin ciclos; devuelve `antes` para deshacer). `DELETE /api/dependencias?tarea_id&depende_de_id` la quita.
  - Pantalla:
    - punto azul al final de la última barra de cada tarea (`.gt-con`), arrastrable hasta otra fila de tarea;
    - las flechas entre tareas desplegadas se pueden pulsar (trazo invisible ancho `path.toque`) y muestran «⏳ N h · nota»;
    - diálogo con atajos 0/4/24/48/72 h, observación, Quitar y (si está en rojo) «Mover detrás»;
    - aviso con ↶ Deshacer, que aplica la operación inversa.
- **Mover detrás:** `POST /api/plan-vista/tareas/:id/detras` y `POST /api/tareas/:id/detras {depende_de_id}`.
  - Calcula los días laborables justos para que la tarea empiece cuando acaba su previa más la espera (al día siguiente si a esa hora ya no cabe).
  - Mueve sus tramos de hoy en adelante con `planMover` limitado a esa tarea y se guarda como `planificaciones` `mover`, que se puede deshacer.
- **Reorganizar:** `POST /api/plan-vista/reorganizar` y `POST /api/reorganizar {tarea_id | orden_id}` (`planReorganizar`).
  - Recorre en orden de dependencias las tareas del proyecto. Las «afectables» son la tarea (o las de la OT) y todo lo que va detrás. Corre hacia delante, nunca hacia atrás, las que empiezan antes del fin de alguna previa más la espera.
  - Cada una se corre los días laborables justos, contando el nuevo fin de lo ya corrido (en cadena); los festivos se saltan.
  - Mueve los tramos de hoy en adelante sin horas reales ni cierre (`planMover` por tarea) y lo guarda en una sola `planificaciones` `mover`, que se deshace entera.
  - En el Gantt: botón «⇉ Reorganizar» en la OT cuando alguna de sus tareas pisa a su previa, y «⇉ Correr … y lo que va después» al pulsar una flecha roja. Ambos abren una vista previa con cada tarea, sus días y desde/hasta.
- **Datos en las barras:** «En las barras: Nada / Personas / Área / Horas» (recordado).
  - El Gantt devuelve por tarea `gente {nombres, falta, pide}` de los tramos de hoy en adelante (tareas propias) y `duracion_h`.
  - Personas: iniciales y un chip naranja «👷 x/y» o «sin gente».
  - En barras de menos de 30 px no se pone texto.
  - Ficha al pasar el ratón (`.gt-ficha`): días, horas, área, proveedor, personas, después de y antes de (con espera y nota).

## Gantt de un proyecto para enviar (PDF / imagen)

`src/gantt-informe.js`: `GET /api/gantt/proyecto/:id/informe.pdf|svg` (permiso planificar o proyectos; `&descargar=1` para adjunto).

- El mismo dibujo SVG sirve para las dos salidas:
  - PDF (pdfkit + `svg-to-pdfkit`, A4 o A3 horizontal, por páginas, sin partir una OT si cabe);
  - imagen: la pantalla convierte el SVG a PNG a 2×.
- Opciones: `nivel=ot|tareas`, `avance`, `hoy`, `quien` (nombre de talleres, subcontratas y transporte), `papel=a4|a3`, `titulo`, `nota`.
- Cabecera con la empresa (Compras › Ajustes), proyecto, cliente y obra; leyenda y nota al pie.
- Escala automática: días (≤ 10 semanas, con fines de semana y festivos sombreados), semanas (≤ 10 meses) o meses.
- Solo lo planificado: sin riesgo ni horas que faltan; lo que no tiene días sale «por planificar».
- Texto limitado a Latin-1 (Helvetica del PDF): los emojis se quitan.
- En el Gantt: botón **📄 Exportar** y 📄 en cada proyecto. Diálogo con vista previa, opciones recordadas y descarga PDF o PNG.
- Al pulsar una tarea del Gantt se abre su ventana (el cuadrante en modo «solo detalle» en un diálogo); al cerrar, si cambió algo, el Gantt se recarga.

## Avisos de capacidad: asignar igualmente

En el cuadrante, «Solucionar» de un aviso `capacidad` (también `sin_gente`) muestra dos listas de operarios: quien la tiene marcada y el resto («No la tienen marcada (asignar igualmente)»). Así se puede asignar a otro aunque nadie la sepa. Las capacidades se marcan solo en Capacidades. `candidatos()` acepta `extra(r)` y `vacio`.

## Gantt (Planificación › Gantt)

`src/gantt.js` (`GET /api/gantt?desde=&semanas=&cerradas=1`), `public/gantt.html/js`. Es el plan por semanas, solo para consultar: se planifica en el cuadrante.

**Filas:** Proyecto › OT › tareas. Se pueden agrupar por proyecto, obra, cliente o sin agrupar, y ordenar por entrega, riesgo o código. Hay filtros «Solo con riesgo», «Incluir cerradas» y buscador.

**Tareas**
- Sus tramos se juntan en segmentos de días seguidos (un fin de semana o festivo en medio no los corta).
- Clase: propia, 🏭 taller externo, 🚚 transporte (proveedor transportista o área de transporte) o 🏗 subcontrata en obra.
- Un taller externo sin tramos se muestra en su fecha prevista.
- Al pulsar una tarea se abre el cuadrante ese día.

**OT**
- La barra va del primer al último día planificado y muestra el avance; ⚑ marca la entrega.
- Lo que falta se calcula como horas estimadas menos planificadas de las tareas propias y subcontratas no hechas, y se dibuja en rayado.
- Riesgo de la OT:
  - hecha;
  - **retrasada**: la entrega ya pasó;
  - **no llega**: lo planificado termina después de la entrega;
  - **faltan**: hay horas sin planificar y la entrega está a 15 laborables o menos;
  - **justo**: 2 laborables de margen o menos;
  - sin planificar;
  - sin entrega;
  - a tiempo.

**Carga por semana**
- Oficios: horas-persona de las asignaciones, por categoría del operario, frente a la capacidad (turno × laborables, sin festivos ni ausencias de día entero).
- Áreas: horas de los tramos frente a jornada × laborables.
- Talleres externos: días con trabajo.
- Subcontratas: horas × personas.

## Obras y Clientes (Proyectos › Obras · Proyectos › Clientes)

`src/obras-clientes.js`, `public/obras.html/js`, `public/clientes.html/js` (con `fichas-comun.js`).

**Jerarquía:** **Obra › Proyectos › Partidas › OT › Tareas**. Un proyecto está en una obra o en ninguna («Sin obra»).

**Obra** (`obras`)
- Datos: nombre y dirección obligatorios. Son opcionales:
  - localidad, contacto en obra y teléfono;
  - acceso y horario (sale en el enlace de las subcontratas);
  - promotor, dirección facultativa, constructora y notas.
- Tiene **una fila en el cuadrante** (`lineas` tipo `obra` con `obra_id`), que comparten todos sus proyectos.
  - La fila sale mientras alguno de sus proyectos está activo (`SQL_OBRA_ACTIVA`), y lleva los códigos de los proyectos activos.
  - Al cambiar un proyecto de obra, lo suyo planificado en la fila anterior pasa a la nueva.
- Las filas de obra ya no se gestionan en «Áreas de trabajo».

**Cliente** (`clientes`)
- Datos: razón social, nombre comercial, CIF, tipo, dirección fiscal, teléfono, correos general y de facturas, forma de pago, anticipo y notas.
- Tiene **personas de contacto** (`cliente_contactos`), cada una con:
  - papel, teléfono y correo;
  - `aprueba` (todo, planos, muestras, cambios, actas, citas);
  - avisos por correo y/o WhatsApp, y `resumen` (semanal, hitos o nada).
- Son las personas que tendrán su enlace del proyecto.

**En el proyecto**
- `proyectos.obra_id` / `cliente_id`. El texto `proyectos.obra` (la dirección) y `cliente` (el nombre) se copian de la ficha para listados, correos e informes.
- La ficha tiene dos **buscadores** (elegir, crear o quitar). Debajo se ven la dirección, el contacto, el acceso y los otros proyectos de esa obra.

**Paso de lo que había** (`adoptar`, una vez al arrancar, `ajustes.obras_clientes`; y después de cada importación)
- Cada proyecto pasa a la obra de su fila de obra o de su texto de dirección.
- Las direcciones iguales (sin acentos ni signos) son la misma obra, y las filas repetidas se juntan.
- El cliente se busca por nombre y, si no existe, se crea.

**API**
- Obras: `GET /api/obras?vista=activas|sin_activo|todas&q=`, `GET /api/obras/:id` (o `sin`: con proyectos, lo próximo e incidencias), `POST /api/obras`, `PUT·DELETE /api/obras/:id`.
- Clientes: `GET·POST /api/clientes`, `GET·PUT·DELETE /api/clientes/:id`.
- Contactos: `POST /api/clientes/:id/contactos`, `PUT·DELETE /api/cliente-contactos/:id`.
- Proyecto: `PUT /api/proyectos/:id/obra {obra_id}` y `PUT /api/proyectos/:id/cliente {cliente_id}`.

## Subcontratas en obra (🏗)

`src/subcontratas-obra.js`. Una tarea que hace **aquí** un proveedor (montadores, pintores, grúa…), en la obra o en nuestras áreas.

**Cómo se marca y se planifica**
- En la OT, **Área / taller › Subcontrata en obra › 🏗 proveedor** (`PATCH /api/tareas/:id {proveedor_id, en_obra: true}` → `tareas.ext_en_obra`).
- La tarea **conserva su área** (si era de un taller, se quita), se mide en horas y se planifica en el cuadrante como las demás.
- Es «externa»: no pide operarios, capacidades ni jornada. **Oper.** son las personas que pone la subcontrata (se le comunican).
- No cuenta en la situación del producto ni en «Dónde está».

**Presupuesto y pedido.** Se usa **🏭 Subcontratar…** igual que con los talleres.
- En el enlace de la oferta, si la petición lleva trabajos en obra, la subcontrata responde **días de trabajo, personas y «podemos empezar el»** (`solicitud_proveedores.dias_trabajo / personas / inicio_posible`), que salen en el comparativo.
- Al enviar el pedido va su enlace de seguimiento, el mismo de los talleres: `ext_seguimientos`, uno por OT y proveedor.

**Confirmar días** (en su enlace)
- Ve sus días planificados (fecha y horario, personas y obra) y **confirma**, **propone otro inicio** o **no puede**.
- Se guarda la **firma del plan** (md5 de sus tramos) con la respuesta (`ext_conf`, `ext_conf_firma`, `ext_conf_*`).
- Si después se mueve algún tramo, vuelve a **sin confirmar** (`SQL_CONF`).
- En el cuadrante:
  - **🏗⏳ / 🏗📅 / 🏗✕ / 🏗✔** en el bloque y en el detalle;
  - aviso `subcontrata_conf` (leve; grave si no puede) en los tramos de hoy en adelante;
  - «Solucionar» ofrece **✔ Me lo ha confirmado por teléfono** (`POST /api/tareas/:id/subcontrata/confirmar`).

**Correos** (cada 10 min, de 8 a 20 h, con el seguimiento activo y su correo)
- **«Confirmad los días»** / **«Cambio de días»**: cuando el plan es nuevo o cambió. Se espera una vuelta, de 10 a 20 min, por si se está planificando (`ext_conf_aviso_firma`).
- **Recordatorio el día antes**, desde las 12 h (`ext_recordado_dia`).
- Los recordatorios de «¿cómo va?» de los talleres no se aplican a estas tareas.

**Parte del día** (`ext_partes`, uno por tarea y día)
- La subcontrata apunta personas, desde–hasta, avance, comentario (llega al momento a quien planifica), fotos y **✔ Trabajo terminado**.
- Puede corregirlo hasta que se valida. La tarea pasa a en curso con su avance.
- En la OT, debajo de la tarea, se ven:
  - el estado de la confirmación, sus días y lo que propone;
  - los partes con **✔ Validar** o **✕ Hay un problema**. Esta segunda opción abre una **incidencia de calidad** contra la subcontrata, el parte queda «no validado» y ella ve nuestra respuesta.
- Un parte **terminado validado** cierra la tarea (hecha).

**API**
- Pública:
  - `POST /api/seguimiento/:t/tareas/:tid/confirmar {accion: confirmar|proponer|rechazar, nombre, desde, nota, motivo}`;
  - `PUT /api/seguimiento/:t/tareas/:tid/parte {fecha, personas, desde, hasta, avance, nota, terminado}`.
- Oficina: `POST /api/ext-partes/:id/validar {ok, nota, gravedad}`.

## Transportes península → Menorca (Compras › 🚚 Transportes)

`src/transportes.js`, página pública `envio.html?t=…`. Un **envío** (`envios`, `ENV-AAAA-NNNN`) es un viaje de un
**transportista** (proveedor con `proveedores.transportista`; Ydica y Tragina marcados al migrar; se marca en su ficha,
donde también está su **zona**) que recoge en la península y lo trae a Menorca.

- **Para enviar a Menorca** (lo pendiente, sale solo): las OTs con una tarea que hace un transportista, aún no hecha y no
  en un envío, «listas» si la tarea externa anterior está hecha o el taller la entregó (`ext_recibido`); en gris las que
  aún están en el taller. Y los **pedidos de material** enviados a proveedores de zona `peninsula` con material sin
  llegar. Se marcan y «＋ Nuevo envío» / «Añadir a…», o se arrastran a una tarjeta de envío.
- **Envío** (`envio_lineas`: OT + su tarea de transporte, pedido o línea suelta; origen, bultos, kg, recogido): transportista,
  recogida prevista, **llegada a Maó**, su referencia, entregar en, notas y **coste**, repartido por **kg** (o a partes
  iguales si no hay kg) o **a mano**. Estados: preparando → recogido → en_barco → en_mao → entregado (con la fecha de cada
  uno en `fechas`); anular devuelve lo que lleva a pendiente.
- **Efectos** (`aplicar`): la tarea de transporte pasa a en curso / hecha y su fecha prevista es la llegada (así el
  cuadrante avisa con `retraso_taller` y la dependencia del montaje «según el taller»); al recogerlo, la tarea del taller
  anterior queda entregada al transportista; el material de los pedidos pasa a llegar ese día (`fecha_prevista`, avisos
  de material); novedad en la OT y aviso `ext_seguimiento` a planificar y logística. La **situación** de la OT dice
  «🚚 En barco con Ydica (ENV-…) · llega ~29/11». La ficha marca en rojo si lo siguiente de la OT aquí empieza antes.
- **Enlace del transportista** (sin cuenta, como el de los talleres): marca recogido por sitio, estado, llegada, su
  referencia, comentario y fotos (CMR, `archivos` `ref_tipo='envio'`). «✉ Enviar al transportista» se lo manda por
  correo (con lo que hay que recoger); «Copiar enlace», «Nuevo enlace». **Recordatorio** diario (laborables, 9–19 h) si
  pasó la recogida prevista estando preparando, o la llegada estando recogido / en barco, sin noticias ese día.
- **Costes**: lo repartido a cada OT suma en Subcontratas de su tarea de transporte (los pedidos de material aún no).
- API: `GET /api/transportes`, `POST /api/envios {transportista_id, items}`, `GET·PUT·DELETE /api/envios/:id`,
  `POST /api/envios/:id/lineas`, `DELETE /api/envios/:id/lineas/:lid`, `POST /api/envios/:id/estado {estado, fecha}`,
  `POST /api/envios/:id/enviar {para}`, `POST /api/envios/:id/enlace {nuevo}`; pública `GET·PUT /api/envio/:t`,
  `POST·GET·DELETE /api/envio/:t/archivos[/:id]`.

## Cómo llega cada pedido (transporte del pedido)

`src/pedido-transporte.js`, sección **🚚 Cómo llega** en la ficha del pedido (Compras), `public/pedido.html/js` (enlace del
proveedor). Columnas nuevas en `pedidos_compra` (`entrega_modo`, `transportista_id`, `almacen_id`, `fecha_almacen`, `agencia`,
`tracking`, `fecha_salida`, `recogida_*`, `bultos`, `kg`, `seg_*`, `prov_*`, `entregado_almacen`, `listo_recogida`…),
`transportista_almacenes`, `pedido_eventos` (historial) y `proveedores.entrega_modo_def / transportista_def_id` (lo habitual
con ese proveedor, se recuerda solo).

- **📦 Lo trae el proveedor** (su transporte o agencia): entrega pactada, **agencia** (MRW, Ecoscooting, UPS, Correos u otra) y
  **nº de seguimiento** → botón «Seguir en MRW ↗» (MRW, UPS y Correos abren con el número; Ecoscooting abre su web).
- **🚚 Lo vamos a buscar**: transportista (Menorca Tragina o Luchana Logística), día de recogida, dirección (la del proveedor
  por defecto u otra), contacto, horario, bultos y kg. Sale en «Para enviar a Menorca»; al meterlo en un envío con fecha de
  recogida se avisa al proveedor por correo del día.
- **🏬 Al almacén del transportista**: almacenes en la ficha del transportista (**Idyca · Gavà**, C/ Energia 9-13, Pol. Ind.
  Barnasud, para Menorca Tragina, con la leyenda «Para Dixis Menorca»; **Luchana · Sant Feliu de Llobregat**, Pol. Ind. El Pla,
  C/ Industria 31-33). Al elegirlo, el pedido (si aún no se ha enviado) pone «Entregar en» y la leyenda en las observaciones
  (PDF y correo). Cuando el proveedor lo entrega, pasa a «Para enviar a Menorca» como listo (en gris mientras no).
- **▶ Activar seguimiento** (`POST /api/compras/pedidos/:id/seguimiento {activar, nuevo, enviar, email}`): enlace del proveedor
  (firma HMAC sobre `seg_nonce`), va en el correo y el PDF del pedido o se copia / envía aparte. En él confirma el pedido y,
  según el modo, fecha y agencia + tracking, «ya lo hemos entregado en el almacén» (fecha, bultos, kg, albarán) o cuándo estará
  listo para recoger. La fecha de llegada que da pasa al material (`fecha_prevista`), así el cuadrante avisa si llega tarde.
- **Recordatorios** (laborables 9–19 h, con el seguimiento activo): sin nº de seguimiento a 1 día de la fecha; pasada la fecha
  sin llegar (o sin entregar en el almacén) → correo cada 2 días laborables y aviso a Compras; la segunda vez, **incidencia de
  transporte** contra el proveedor (`incidencia_trp_id`).
- **Transportes** (Compras): columna nueva **📦 Lo traen los proveedores** (con tracking, ⚠ si pasó la fecha) y en «Para enviar a
  Menorca» los pedidos de recogida y de almacén; el envío nuevo toma su transportista.
- **Transportistas**: Menorca Tragina (Polígono de Sant Lluís) y Luchana Logística (Maó). Ydica dejó de ser transportista: es
  el almacén de Tragina en Gavà (Idyca).
- API: `PUT /api/compras/pedidos/:id/transporte`, `GET /api/transportistas`, `POST /api/transportistas/:id/almacenes`,
  `PUT /api/almacenes/:id`; pública `GET·PUT /api/pedido-ext/:t`, `POST·GET /api/pedido-ext/:t/archivos[/:id]`.

### El transportista acepta la recogida

1. En **Compras › Transportes**, el envío (recogida prevista, coste, lo que va) se manda con **✉ Enviar al transportista**.
2. En su enlace, el transportista ve las **condiciones de la recogida**: fecha, dónde recoger (con horario y contacto de cada pedido), bultos y kg, a dónde entregar y precio. Puede:
   - **✔ Aceptar**, con su nombre y, si la sabe, la llegada a Maó y su referencia.
   - **📅 Proponer** otra fecha de recogida o de llegada, otro precio o un comentario.
   - **✕ Decir que no puede**, con el motivo.

   Hasta que acepta, no ve los pasos de «¿Cómo va?». Si marca «recogido» directamente, cuenta como aceptada.
3. En la ficha del envío se ve el punto en que está:
   - ⏳ esperando;
   - 📅 propuesta, con **✔ Aceptar propuesta**, que pasa su fecha y precio al envío, o **✕ No la acepto**;
   - ✕ no puede;
   - ✔ aceptada.

   También existe **✔ Aceptada por teléfono**. La tarjeta del envío lleva el mismo estado. Compras y Logística reciben un aviso en cada respuesta.
4. **Al aceptarse**, cada pedido «lo vamos a buscar» del envío:
   - toma el transportista y la fecha;
   - **activa su seguimiento**;
   - el proveedor recibe por correo la **recogida confirmada** con su enlace, para confirmar cuándo está listo, los bultos y el contacto.

   Si el proveedor no tiene correo, o el envío falla, se apunta en el pedido y se avisa a Compras para que le mande el enlace. En las OTs queda la novedad.
5. Si después se cambian el transportista, la fecha de recogida, el coste o lo que va, el envío vuelve a «pendiente de aceptar» y hay que reenviárselo. Al volver a aceptar con otra fecha, el proveedor recibe la nueva.
6. Recordatorios:
   - si el transportista no acepta en unas 20 h, recibe un recordatorio diario;
   - el aviso de recogida al proveedor solo sale con el envío aceptado.

## Compras locales (ferretería…) desde el móvil

`src/compras-locales.js`, `public/mi-dia-compras.js`, Compras › 🛒 Compras locales. Compras pequeñas en tiendas de la isla a
cuenta de la empresa (cuenta de crédito de la tienda), `compras_locales` (`CL-NNNN`).

1. **Pedir** (quien tenga el permiso **pedir_compras_locales**, que se da por roles en Usuarios › Roles; de inicio
   Administrador, Operaciones y Encargado si existe. En Mi día: botón «🛒 Compra local para esta tarea» en cada trabajo no
   terminado (planificado o apuntado como trabajo no planificado), que la deja elegida, o Menú › 🛒 Compra local; sin el permiso no sale ni el botón ni el menú): qué, tienda (proveedores con `cuenta_credito`; si no hay
   ninguno marcado, los de zona Menorca que no son transportistas), **para qué tarea de OT** (obligatorio: las suyas de hoy y
   mañana, u «Otra tarea…» con buscador `GET /api/compras-locales/tareas?q=` de tareas abiertas),
   importe aproximado, ahora / mañana, foto. Aviso `compra_local` a quien tiene **autorizar_compras_locales** (Operaciones y
   Administrador; contador en el menú Compras).
2. **Autorizar** (Compras › Compras locales › Por autorizar, o en el móvil: Mi día › Menú › Compra local, bloque «Por
   autorizar» arriba con botones grandes, para quien tenga el permiso): ✔ / ✗ con nota (motivo obligatorio si no). Al autorizar se
   genera el **código de autorización** (`codigo_aut`): 6 caracteres al azar sin los que se confunden («7KP-3XM»), único;
   el operario lo ve en grande y lo da en la tienda; sale en la lista y en el cuadre. Aviso al momento con el código.
3. **Ticket**: foto del ticket o albarán (obligatoria), importe real y nº. Si pasa más de un **15 %** de lo autorizado,
   aviso a Operaciones (no bloquea). Autorizada y sin ticket a los 2 días: recordatorio diario al móvil.
4. **Cuadrar** (permiso compras): por tienda y mes, marcar las de una factura y poner su número (`cuadrada`).
   El importe real suma como **material** de la tarea en el control de costes.

Estados: pendiente → autorizada / rechazada → comprada → cuadrada (o anulada). API: `GET /api/compras-locales/opciones`,
`GET /api/compras-locales/mias`, `POST /api/compras-locales/nueva`, `POST /api/compras-locales/:id/ticket`,
`POST /api/compras-locales/:id/anular` (estas, también para operarios con PIN); `GET /api/compras-locales?vista=autorizar|sin_ticket|cuadrar|todas&mes=`,
`POST /api/compras-locales/:id/decidir {decision: si|no, nota}`, `POST /api/compras-locales/cuadrar {ids, factura}`.

## Incidencias (Planificación › Incidencias)

`src/incidencias.js`, `public/incidencias.js` (lista + ficha), `public/incidencia.html/js` (enlace del proveedor). Tablas
`gestion_incidencias` (`INC-AAAA-NNNN`) y `gestion_incidencia_eventos` (historial). (La tabla `incidencias` es la antigua del
operario, ya pasada a capturas.)

- **Un solo sistema** para material, transporte, calidad, avería, seguridad, proveedor u otro. De qué es: material
  (`escandallo_id`), envío, pedido, proyecto, OT, tarea, máquina y **contraparte** (`proveedor_id`: proveedor, transportista
  o subcontrata). Gravedad leve / importante / **crítica** (avisa al momento a Dirección). **Área responsable** por tipo
  (material y proveedor → Compras, transporte → Logística, calidad → Producción, avería y seguridad → Operaciones) y
  responsable opcional. **Afecta a**: tareas de la incidencia, las que usan el material, las del pedido o las del envío.
- Se abren desde Logística (⚠ Incidencia del material, también en el móvil), al **recibir un envío** con algo que falta
  o dañado (tipo transporte, contra el transportista), o con «＋ Nueva incidencia» (tipo, gravedad, tarea u OT por código,
  proveedor, fotos). Las de antes (`escandallo_incidencias`, `envios.incidencia`) se pasaron solas.
- **Estados**: abierta → en curso («Me encargo») → **esperando** (reclamada) → resuelta → **cerrada**. Cierran el
  responsable del área y Operaciones (dos firmas); en calidad, con causa y acción para que no se repita.
- **Reclamar** (`POST /api/incidencias/:id/reclamar {pedimos: reponer|cambiar|abono, abono_pedido, necesario_el,
  plazo_dias, mensaje, canal: correo|whatsapp|enlace, email}`): correo con el **informe PDF** (datos, fotos y enlace),
  **WhatsApp** (`wa.me` con el texto y el enlace; lo envía la persona) o copiar el enlace. El proveedor responde en
  `incidencia.html?t=` (firma HMAC sobre `nonce`): qué hará y **fecha de resolución** (obligatoria), comentario, importe si
  abona. **Aceptar fecha** (`/aceptar-fecha`) o **No es aceptable / Decidir** (`/decidir {decision: otra_fecha|
  otro_proveedor|stock|abono|otro, texto, importe}`, queda escrito; stock y abono resuelven).
- **Recordatorios** (cada 10 min, laborables 9–19 h): sin respuesta pasado el plazo → correo cada 2 días laborables + aviso al
  responsable; el día de la **fecha acordada** → recordatorio al responsable y correo al proveedor; pasado un día laborable
  sin resolver → aviso al responsable y a Operaciones.
- **Resolución automática**: al marcar «Recibido» el material en Logística, sus incidencias abiertas quedan resueltas.
  «Marcar resuelta» con texto y abono opcional.
- **Cuadrante**: aviso `incidencia` en los tramos (hoy en adelante, sin cerrar) de las tareas afectadas, con «Solucionar →
  Abrir la incidencia»; el material con incidencia sigue con «🧰 ⚠».
- Contador en el menú (`pendientes.incidencias`: las mías por gestionar + las que me toca cerrar). Aviso push `incidencia`.
- API: `GET /api/incidencias?vista=mias|abiertas|esperando|por_cerrar|cerradas&tipo=`, `GET·PATCH /api/incidencias/:id`,
  `POST /api/incidencias`, `/:id/nota|en-curso|resolver|cerrar|reabrir`, `GET /:id/pdf`, `GET /api/incidencias-buscar?q=`;
  pública `GET·PUT /api/incidencia-ext/:t`, `GET /api/incidencia-ext/:t/archivos/:id|pdf`.
- **Fase 2** (pendiente): calidad desde la OT / tarea y el móvil, tarea de retrabajo con su coste, captura de la Bandeja →
  incidencia, informes (por proveedor, tiempo de cierre, coste de no calidad).

## Excedente, turnos y horas extra

`src/horas-extra.js`, `public/recursos-extras.js` (Recursos › **Turnos y horas extra**).

- **Excedente**: alargar un tramo **no cambia la estimación**. Lo que pasa del estimado **original** (`duracion_inicial_h`
  si se reestimó en el parte; si no, `duracion_h`) se ve **rayado** en el bloque con «+1h excedente» (`tramos[].excedente`
  en `/api/tablero`; el aviso leve «exceso» sigue midiendo contra la estimación actual). En el detalle de la tarea:
  «Planificado 8h de 7h · +1h de excedente sin estimar» y **Real**: horas-persona del parte frente a las previstas
  (estimado original × operarios) — «llevas 9h de 26h» o, terminada, «✔ terminada con 20h de 26h · 6h menos (−23 %)».
  El **último tramo de una tarea terminada** lleva «✔ −3h menos» (verde) o «✔ +2h más» (rojo). (`tarea_excedentes` quedó
  de la primera versión, que sí subía la estimación; una migración deshizo lo sumado.)
- **Turnos** (`turnos`: nombre, inicio, fin, por defecto; «Normal» 07:00–15:00 se crea solo): se gestionan en la pestaña;
  cada operario tiene el suyo en su ficha (`recursos.turno_id`, vacío = el por defecto). El cuadrante enseña desde el inicio
  más temprano hasta el fin más tardío + 2 h.
- **Horas extra** (`horas_extra`, una fila por persona y tramo): al planificar (crear, estirar, mover, repartir, empujar,
  asignar, cambiar franja) se calcula lo que cae fuera del turno de cada operario. Queda **pendiente**, o **autorizada** al
  momento si quien planifica tiene el permiso nuevo **autorizar_horas_extra** (Dirección y Administrador). Si las horas
  crecen sobre lo ya decidido, se vuelve a pedir. En el cuadrante:
  - diálogo «Horas extra» con el motivo → **Pedir autorización** (aviso `horas_extra` a Dirección: móvil › Supervisar ›
    Aprobar, u ordenador › Recursos) o **Solo hasta el fin de su turno** (recorta);
  - la parte extra del bloque rayada en rojo con «⏱ 4h extra ⏳» (verde ✔ autorizadas), aviso `horas_extra` con
    «Solucionar» (pedir, autorizar o recortar) y detalle por persona en la ficha del tramo. El aviso «fuera de jornada»
    ya no sale en tramos con operarios (se mide con su turno).
- **Decidir** (`POST /api/horas-extra/decidir {ids, decision: si|no, nota}`): autorizar avisa a quien lo pidió y a los
  operarios (Mi día muestra «⏱ 15:00–17:00 horas extra autorizadas» o «⏳ … pendientes de autorizar»). No (con motivo):
  la franja de esas personas vuelve a su turno, el tramo se acorta si ya nadie pasa de ahí y lo que sobra vuelve a «Por
  planificar».
- **Hechas fuera del turno sin autorizar**: del parte (registros con su hora de/a, o lo que pase de la duración del turno
  en el día) menos lo pedido o decidido. Dirección dice si son extra o no (`POST /api/horas-extra/parte`, filas
  `origen = 'parte'`).
- **Costes e informes**: el recargo de la hora extra (Control de costes) se aplica solo a las **autorizadas** (con tope en
  lo trabajado fuera del turno). Informes › Operarios: «Extra» (autorizadas) y «Sin aut.».
- API: `GET·POST /api/turnos`, `PUT·DELETE /api/turnos/:id`, `POST /api/tramos/:id/horas-extra/pedir {motivo}`,
  `POST /api/tramos/:id/horas-extra/recortar`, `GET /api/horas-extra?vista=pendientes|sin_autorizar|mes&mes=`.

## En el teléfono, solo la app móvil

En un teléfono (pantalla de hasta 760 px y táctil) las pantallas de oficina no se abren: `comun.js` (`esTelefono()`)
manda a `/mi-dia.html`, con la vista que corresponde si se llegó por un enlace de aviso (`versionMovil()`):
- Capturar → `?vista=capturar`
- Parte → `parte`
- Compras locales → `compras`
- Transportes → `recibir`
- un pedido o Recursos › vacaciones / horas extra → `aprobar`

`inicio.html` también lleva siempre a Mi día en el teléfono. Las tablets apaisadas y el ordenador siguen viendo la versión completa.

**Sin ficha de operario** (Administrador, oficina, Dirección…), Mi día entra en modo **oficina** (`body.md-oficina`):
- la pestaña «Mi día» pasa a ser **🏠 Inicio**, con botones grandes para lo suyo, cada uno con su número: Capturar, Compra local, Revisar stock / Recibir material, y Supervisar (Recibir envíos, Parte de hoy, Aprobar, Dónde está);
- desaparecen Mi mes, Vacaciones, Avisar, Mi perfil, Mis capacidades, el cambio de PIN y el recorrido del operario;
- no se precarga el día propio.

## Supervisar desde el móvil (Mi día › Menú › Supervisar)

Para encargados, logística, Operaciones y Dirección que también usan Mi día. Cada apartado sale solo con su permiso:

| Apartado | Permiso | Qué hace |
|---|---|---|
| 📦 Recibir envíos | `logistica` o `planificar` | Envíos en Maó (y en barco) por líneas: marcar lo recibido, bultos, nº de albarán, fotos, incidencia («falta 1 bulto…»). Con todas las líneas recibidas el envío pasa a **entregado** (tareas de transporte hechas, la OT vuelve a «en taller HAM»). El material de un pedido de la línea queda **recibido**. También piezas que un taller marcó «entregado a nosotros». Avisa a quien planifica. Funciona sin cobertura (bandeja de salida). |
| 🧾 Parte de hoy | `planificar` | Lo apuntado hoy por tramo con sus avisos; ✔ Confirmar (usa la propuesta, como en el ordenador), «Confirmar todo lo que no tiene avisos», aceptar/descartar lo no planificado, quién está sin apuntar. Corregir horas y cerrar el día siguen en Parte. |
| ✔ Aprobar | `aprobar_compras`, `vacaciones_ops`/`vacaciones_rrhh`, `autorizar_compras_locales` | Pedidos por aprobar, vacaciones en tu paso, compras locales pendientes; ✗ No pide el motivo. |
| 📍 Dónde está cada cosa | `planificar` o `proyectos` | OT con algo fuera (taller o envío), retrasos primero, cuándo se necesita aquí y aviso si el taller o el envío no llegan a tiempo. |

API nueva: `GET /api/supervision/resumen` (contadores del menú), `GET /api/supervision/recibir`, `POST /api/envios/:id/recibir` `{lineas:[{id,recibido,bultos}], num_albaran, archivos, incidencia}`, `POST /api/tareas/:id/recibir-pieza` `{nota, archivos}`, `GET /api/supervision/donde`. Columnas nuevas: `envio_lineas.recibido_en/recibido_por/bultos_recibidos`, `envios.num_albaran/incidencia/incidencia_resuelta`, `tareas.ext_recibido_en/ext_recibido_por/ext_recepcion_nota`.

## Control de costes (Informes › Control de costes)

Solo con el permiso **costes** (Administrador, Operaciones y Dirección; el rol Dirección se crea
solo). Sin ese permiso, **Informes** sale sin euros (ni coste, ni importe, ni margen).

- **Lista de proyectos**: PVP, coste presupuestado, real, previsión al terminar, desviación,
  **margen previsto** (PVP − previsión) y **avance frente a gastado**, con ⚠ si hay avisos.
- **Un proyecto**: cifras clave (PVP, margen previsto, coste al terminar, mano de obra, avance /
  gastado, horas extra), **avisos** (partida que gasta más deprisa de lo que avanza, mano de obra
  >10 % sobre lo presupuestado, partida con pérdidas, tarea con más horas de las estimadas),
  **por tipo de coste** (mano de obra, material, maquinaria, subcontratas, otros) y el árbol
  **partida › OT › tarea › persona** con horas y mano de obra. Exporta a Excel.
- **Cálculo**: real = horas del parte × coste/hora de la ficha (el de ese día); las horas por encima
  de la jornada en un día llevan **recargo** (+50 % por defecto, se cambia en la pantalla).
  Previsión de una tarea = real + (estimación actual − real) × coste/hora (el suyo o el medio);
  terminada = real (si se terminó sin horas en el parte, lo presupuestado). Avance = presupuesto de
  mano de obra de lo hecho (en curso, por horas, hasta el 90 %).
- **Presupuesto**: por partida, `pvp` y `presupuesto` (`mano_obra`, `material`, `maquinaria`,
  `subcontratas`, `otros`) los trae el compositor (s360-import/2) o se escriben con «✎ Presupuesto».
  La mano de obra de la partida se reparte entre sus tareas por horas-persona presupuestadas; si no
  viene, se estima con horas × coste/hora medio (y lo avisa).
- **Por venir**: material real con los precios de compra (pedido y albarán), coste de maquinaria
  y subcontratas por factura, otros gastos con foto del ticket desde el móvil, cierre del proyecto.

## Ayuda: «?», recorridos y novedades

- **«?»** arriba a la derecha en todas las pantallas (en Mi día, **Menú › Ayuda**): panel con para
  qué sirve la pantalla, **recorridos guiados** de su rol, un **vídeo corto** (se amplía al pulsarlo;
  cuadrante, proyectos/importar, logística y Mi día), el **esquema del circuito**, pasos típicos y
  «Qué significa…».
- **Recorridos «hazlo conmigo»**: oscurecen la pantalla y resaltan un elemento cada vez. En los
  pasos «lo haces tú» el recorrido espera a que la persona pulse o escriba de verdad (solo cosas que
  no cambian datos: pestañas, abrir, buscar); los pasos que cambiarían datos solo se enseñan (el
  resaltado no deja pulsarlos). La primera vez se ofrece el recorrido de su rol; si un recorrido
  cambia (sube su `version`), se vuelve a ofrecer. Lo que no está en pantalla se salta.
- **Novedades**: al entrar tras una actualización, una ventana con lo nuevo que afecta a sus permisos.
- **En voz alta**: «🔊 Escuchar» en el panel lee la pantalla (para qué sirve, esquema y secciones), marcando lo que
  suena; pausa, parar, velocidad y voz en español (se recuerdan en el navegador). En los recorridos, 🔇/🔊 en la burbuja
  lee cada paso al avanzar. Usa la síntesis de voz del propio navegador (Web Speech): gratis, sin servicios externos;
  la calidad depende del dispositivo (Chrome/Edge y iPhone traen buenas voces en español).
- Textos en `app/public/ayuda-textos.js`; motor en `app/public/ayuda.js`. Los pasos apuntan a
  `data-ayuda="…"` o a ids estables. Lo visto se guarda en el navegador.
- **Comprobación**: `herramientas/ayuda/comprobar.js` recorre todos los recorridos en la copia de
  prueba y avisa si algún paso ya no encuentra su elemento (`opcional: true` = depende de los datos).
- **Vídeos**: `herramientas/ayuda/grabar.js [logistica|cuadrante|proyectos|midia]` los vuelve a grabar
  sobre la copia de prueba (¡cambia datos, nunca contra producción!) y los deja en `app/public/ayuda/`.
- **Regla**: cada funcionalidad nueva añade su ayuda, su paso de recorrido si hace falta, su línea
  en `novedades`, y pasa `comprobar.js`; si cambia una pantalla con vídeo, se vuelve a grabar.

## Material: escandallo, asignación, stock y compras

Circuito entre Dto. técnico, operaciones, logística y compras, con avisos al móvil en cada paso.

1. **Escandallo de la partida** (técnico · permiso `escandallo`): en Proyectos, debajo de cada
   partida, **📋 Escandallo**. Lista rápida con teclado y sugerencias del catálogo: material,
   cantidad total, unidad, nota y su estado. **📦 Enviar a logística** → aviso a logística.
2. **Asignación** (operaciones · `planificar`/`proyectos`): **🧩 Asignar** en la partida (con ⚠ si
   queda material sin asignar). Pantalla `asignar.html?partida=…`:
   - *Materiales*: a la izquierda el escandallo («quedan X de Y»); a la derecha las OTs de la
     partida en acordeón con sus tareas. Arrastrar el material a la tarea (o pulsar material y
     luego tarea) → pregunta cuánto (propone lo que queda). Se puede repartir entre tareas.
   - *Herramientas*: catálogo con filtro y casillas; pulsar una tarea y **Agregar a la tarea**.
3. **Logística** (`logistica`, p. ej. Sergio): menú **Logística** → *Revisar stock*: «No hay»,
   «Hay todo» o «Hay N». Lo que falta pasa a *Por pedir* → aviso a compras.
4. **Compras** (`compras`): *Por pedir* → marcar líneas → **🛒 Crear pedido de compra**, **✉ Pedir precio** o
   **📞 Ya pedido por teléfono** → al enviarse el pedido, aviso a logística y al técnico.
5. **Recepción** (logística): *Pedido · por recibir*, agrupado por pedido de compra → albarán → **✔ Recibir el
   pedido** (o lo marcado) → aviso a los operarios con plan en las tareas que usan ese material (de hoy en
   adelante) y al técnico.

**Fotos, PDF y enlaces** de cada material: en el escandallo, botón 📎 de la línea (subir foto/PDF
desde el ordenador o pegar un enlace); en Logística, **📷 Foto** en cada material (en el móvil
deja elegir cámara o galería). Cada uno quita lo suyo; el técnico, cualquiera.

En cada tarea, el icono 🧰 muestra sus materiales (con su estado) y herramientas. El menú
Logística lleva un número con lo pendiente de cada uno. Roles nuevos: **Técnico**, **Logística**,
**Compras** (los permisos se pueden dar también a otros roles, p. ej. `logistica` a Operaciones
para que Adrián reciba material urgente).

**Catálogo**: ~3000 materiales y herramientas habituales (`app/src/catalogo/generar.py` →
`catalogo-base.json`, se carga al arrancar si cambia); se amplía desde la propia sugerencia.

API: `/api/catalogo-llevar` · `/api/partidas/:id/escandallo` (+ `/enviar`) · `/api/escandallo/:id`
(`PATCH`/`DELETE`, `PUT …/stock`, `PUT …/compra`, `PUT …/recibir`) · `/api/partidas/:id/asignacion`
· `/api/tareas/:id/materiales` · `/api/tarea-material/:id` · `/api/tareas/:id/herramientas` ·
`/api/tarea-herramienta/:id` · `/api/tareas/:id/llevar` · `/api/material/circuito`.

**Tres clases de «herramienta»** (no se mezclan)
1. **Máquina fija → Área de trabajo** (sierra de cinta, plegadora, cizalla, torno, cabina…). En
   Cuadrante › Áreas de trabajo, columna **Equipo fijo**: se marcan las máquinas (recursos) que están
   fijas allí (`recursos.fijo_area`) y se escriben otros elementos fijos (`lineas.equipamiento`: carpa,
   compresor…). Lo que se planifica en el área **los lleva solo**: las máquinas fijas cumplen lo que
   pida la tarea (no sale «requiere … sin asignar»), el detalle del cuadrante muestra «En el área» y Mi
   día «Ya está en …».
2. **Equipo del que hay pocos → Recurso máquina** (taladro magnético ×2, soldadoras, llaves de
   impacto…). En Asignación › Herramientas, bloque **⚙ Equipos (hay pocos)**: se marca el tipo y la
   tarea queda «requiere …» (`tarea_requisitos_tipo`); en el cuadrante se asigna cuál y se controla que
   no se cruce. Los tipos cuyas máquinas son todas fijas de un área salen desactivados («planifica la
   tarea allí»). En Mi día, las máquinas asignadas al tramo salen con casilla (`equipo_check`).
3. **Herramienta de mano → lista sencilla** (radial, martillo, sargentos, EPIs…), sin control de
   cantidad. El catálogo base ya no ofrece como herramienta las máquinas fijas, equipos contados,
   vehículos, grúas ni plataformas (`NO_DE_MANO` en `generar.py`; al cambiar la base se desactivan).

**Lo ven en el cuadrante y en Mi día**
- **Cuadrante**: cada tarea con material o herramientas lleva un icono en su bloque, en las fichas de
  semana/mes y en «Por planificar»: 🧰 ✔ (todo en almacén), 🧰 24/11 (pedido, llega ese día),
  🧰 falta (sin pedir), 🧰 ? (sin revisar), 🔧 (solo herramientas). En **rojo «llega dd/mm»** si llega
  después del día del tramo. Al pasar el ratón, la lista; en el detalle de la tarea, «Material» (con
  estado, proveedor y fecha de llegada) y «Herramientas».
- **Avisos del cuadrante**: «el material llega el dd/mm» (rojo) si llega después del día planificado,
  y «falta material sin pedir» (leve). Solo días de hoy en adelante y tramos sin cerrar.
- **Aviso al móvil** (`mat_tarde`) a quien planifica y al técnico cuando compras marca una fecha
  de llegada posterior a un día ya planificado de una tarea que usa ese material.
- **Mi día** (app del operario): en cada trabajo, bloque **🧰 Necesitas** con los materiales
  (cantidad, ✔ en almacén / 🚚 llega … / ✗ falta / ? sin revisar; ⚠ en rojo si llega después de ese día)
  y las herramientas 🔧. Cada operario **marca con una casilla** el material que ha recibido y las
  herramientas que va preparando (contador «recibido 2/3 · preparadas 1/2»; «todo listo ✔» al
  completarlo). Las marcas son de cada persona (tabla `llevar_check`; `PUT /api/mi-dia/llevar`
  `{tipo: material|herramienta, id, hecho}`) y en el detalle de la tarea del cuadrante se ve
  «✔ recibido: Juan Robles» / «✔ preparada: …».

## IA: pasarela, registro y herramientas (Recursos › IA)

La IA es **un cliente más de la API**, nunca toca la base de datos. Solo puede usar las **herramientas** registradas en `src/ia.js`; cada una llama internamente a los mismos `GET /api/...` que las pantallas, **en nombre del usuario** que pregunta y **con sus permisos** (cabecera secreta por proceso `x-ia-clave` + `x-ia-usuario`, solo desde 127.0.0.1; cualquier método que no sea GET devuelve 403).

- **Herramientas (fase 1, todas de lectura)**: `ots_en_riesgo`, `proyectos_buscar`, `ot_detalle`, `planificacion_dia`, `agenda_persona`, `personas_libres`, `ausencias`, `pedidos_compra`, `envios_transporte`, `incidencias`, `clientes_buscar`, `obras_buscar`, `capacidades_quien`, `materiales_buscar`. Cada una declara grupo, descripción, esquema de entrada, riesgo (`leer` / `borrador` / `confirmar` / `nunca`) y canales.
- **Ajustes** (`ajustes.ia`, solo con permiso `usuarios`): interruptor general, canales `mcp` y `app`, límite de consultas por persona y 24 h, y apagar herramientas por canal.
- **Registro** (`ia_registro`): cada llamada con usuario, canal (`mcp`, `app`, `prueba`), clave usada, herramienta, datos, resultado o error, ms y bytes. Quien tiene `usuarios` ve el de todos.
- **Probar**: `POST /api/ia/probar/:nombre` ejecuta la herramienta con tus permisos y enseña lo que recibiría la IA.
- **Conectar Claude Code / Antigravity (MCP)**: cada persona con permiso `ia` crea claves (`s360ia_…`, se guardan con sha256 y se ven una sola vez) y puede revocarlas. Servidor MCP en `POST /mcp` (Streamable HTTP sin estado, respuestas JSON) con `Authorization: Bearer <clave>`:

  ```
  claude mcp add --transport http planealo https://administrador.hamenorca.com/mcp --header "Authorization: Bearer s360ia_…"
  ```

- **Proveedor de IA** (`src/ia-proveedores.js`, solo permiso `usuarios`): clave de API de Anthropic, OpenAI o Google para el asistente de la app. Se guarda en `ajustes.ia_proveedores` **cifrada** (AES-256-GCM con la clave de servidor del correo, fuera de la BD); nunca vuelve al navegador (solo `…abcd`). «Probar» pide la lista de modelos al proveedor (no gasta tokens) y la ofrece para elegir el modelo; al guardar una clave se prueba sola. Uno es el **activo** (el que usará el asistente). Si el panel está vacío vale la del entorno (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`). API: `GET /api/ia/proveedores`, `PUT /api/ia/proveedores/:id {clave | modelo | borrar_clave}`, `POST /api/ia/proveedores/:id/probar`, `PUT /api/ia/proveedor-activo {proveedor}`.
- **Asistente ✨** (`src/ia-chat.js`, `public/ia-chat.js`): botón ✨ en la cabecera de las pantallas de oficina (Alt+A), lo carga `comun.js` si el usuario tiene `ia` (o `usuarios`). Panel lateral que se mantiene abierto con la conversación al cambiar de pantalla; sugerencias según la pantalla; chips con las herramientas usadas; Markdown mínimo y seguro (negrita, listas, tablas, enlaces internos). `POST /api/ia/chat {conversacion_id?, mensaje, pagina}` llama al proveedor activo (Gemini, Claude u OpenAI; sin streaming) con hasta 8 rondas de herramientas por el canal `app` (`ia.ejecutar`, con `conversacion_id` en el registro). Al proveedor solo se le mandan los textos de los últimos 16 turnos. Conversaciones en `ia_conversaciones` / `ia_mensajes` (con proveedor, modelo, tokens y ms), cada uno las suyas: `GET /api/ia/conversaciones[/:id]`, `DELETE /api/ia/conversaciones/:id` (archiva). `GET /api/ia/asistente`: si está disponible y por qué no. Para pruebas sin gastar: `IA_GEMINI_URL` apunta a un Gemini falso.
- **En segundo plano**: `POST /api/ia/chat` responde al momento con el mensaje en `estado: 'pensando'` y la respuesta se prepara en el servidor (máx. 2 min); la pantalla pregunta cada 1,2 s `GET /api/ia/mensajes/:id` y enseña la fase (pensando / consultando / redactando), los segundos y las herramientas según se usan. Un mensaje que se queda a medias (reinicio) se da por fallido. Gemini va con razonamiento corto (`thinkingLevel: low` en 3.x, `thinkingBudget: 512` en 2.5 flash; si el modelo no lo admite, sin él).
- **Modelo saturado** (503/529/500, o 429 «high demand», o sin respuesta en 75 s): reintenta 2 veces (2 s y 6 s, fase «esperando») y luego usa el **modelo de reserva** (Recursos › IA › Proveedor › «Reserva»: automático = el flash/sonnet/gpt estable que no sea el principal, uno concreto o «Ninguno»). La respuesta lo dice («ℹ Respondido con … : … estaba saturado») y `ia_mensajes.modelo` guarda el que respondió.
- **En el móvil** (Mi día): «✨ Asistente» en el Menú y en Inicio (no en la tablet común), a pantalla completa, con **🎤 dictado** (reconocimiento de voz del navegador, `es-ES`; rellena el cuadro y se envía con ➤). Misma API y mismas conversaciones; la IA sabe que es el móvil (respuestas más cortas, sin enlaces a pantallas de oficina). Sin conexión avisa; no entra en la bandeja de salida.
- Permiso nuevo **`ia`** (el rol administrador lo recibe al migrar).
- **Próximas fases**: herramientas que **preparan borradores** (presupuestos, pedidos, albaranes) que una persona confirma, y WhatsApp más adelante.

Endpoints: `GET /api/ia`, `PUT /api/ia/ajustes`, `POST /api/ia/probar/:nombre`, `GET /api/ia/registro`, `GET|POST /api/ia/claves`, `DELETE /api/ia/claves/:id`, `POST /mcp`.

## Correo entrante (Compras › Correo entrante)

`src/buzones.js` (conexión IMAP), `src/correo-ia.js` (lectura con IA y revisión), `public/correo.html` + `correo-pantalla.js`. Fase 1: **ofertas de proveedores** y **confirmaciones de pedido**; lo demás se clasifica y se archiva.

- **Por eventos**: cada buzón activo (`buzones`) mantiene una conexión IMAP abierta en su carpeta de entrada (IDLE, `imapflow`). En cuanto entra un correo se descarga, se guarda y pasa a la IA. Si se cae, se reconecta (10 s → 5 min) y recupera lo que entró por UID; cada 5 min, comprobación de seguridad. Al conectar un buzón solo se procesa lo nuevo; «⟲ Leer días anteriores» (máx. 30) lo pide a mano. `CORREO_ENTRANTE=no` no conecta nada (copias de prueba).
- **Cuentas de correo** (botón «⚙ Cuentas de correo», o `/correo.html?cuentas=1`; permiso `usuarios`): una cuenta = **📥 Recibir** (IMAP, `entrada`) y/o **📤 Enviar** (SMTP: `smtp_host`, `smtp_puerto`, `smtp_seguridad` starttls/ssl/ninguna, `smtp_usuario`, `remitente`, `clave_smtp` solo si es distinta). La **★ principal** (`buzones.principal`, una) es de la que salen pedidos, peticiones de precio y avisos: `correo.js` la usa antes que lo antiguo de `ajustes.correo` y que el `.env` (SMTP_…). «🔌 Probar envío» y «✉ Enviar prueba» (`POST /api/buzones/probar-salida`), `POST /api/buzones/:id/principal`. Al arrancar, una vez (`migr_correo_salida`), el correo de salida que hubiera (panel de Compras o `.env`) se traslada a una cuenta principal con su contraseña cifrada (si ya existe una cuenta con esa dirección, se le añade la salida; si no, se crea con la entrada desactivada e IMAP deducido: smtp.ionos.es → imap.ionos.es). Compras › Ajustes ya solo enseña de dónde sale el correo y enlaza aquí.
- **Recepción** (mismo panel): nombre, dirección, servidor IMAP (IONOS: `imap.ionos.es` 993 SSL), usuario, **contraseña cifrada** (como la del correo de salida; nunca vuelve al navegador), carpeta de entrada, carpeta de archivo («Planéalo») y **cuándo archivar**: `auto` (lo que hay que revisar, al revisarlo; lo demás, al leerlo), `al_revisar` o `nunca`. «🔌 Probar», estado en vivo (● escuchando / ○ error). Preparado para varios buzones; los personales (`tipo = 'personal'`, `usuario_id`) en una segunda etapa.
- **Guardado** (`correos`, `correo_adjuntos`): el `.eml` y sus adjuntos en `ARCHIVOS_DIR/correo/<id>-<dirección>/<Tipo>/<año>/<fecha>_<id>_<asunto>/`; en el buzón, a `Planéalo/Ofertas`, `Confirmaciones de pedido`, `Albaranes`, `Facturas`, `Pedidos de clientes`, `Consultas`, `Publicidad`, `Otros`. Sin duplicados (`message_id` por buzón).
- **Asociar** sin IA: respuesta a lo que enviamos (`correo_enviados`: Message-ID de las peticiones de precio y pedidos enviados por `correo.enviarOFallar({ ref })`), códigos `SOL-…` / `PC-…` en el asunto o el texto, y remitente (correo o dominio de un proveedor, sin dominios públicos).
- **Leer con IA** (proveedor activo de Recursos › IA; reintentos y modelo de reserva): texto + hasta 4 PDF/fotos (15 MB) + las líneas de las peticiones y pedidos candidatos → **JSON fijo** (`tipo`, `confianza`, `resumen`, `referencia`, `oferta` con precio por línea, portes, entrega, validez, forma de pago, IVA, total; o `confirmacion` con fecha, nº y fechas por línea; `alertas`). El correo es DATO, no instrucciones; la IA no tiene herramientas. Validación: solo nuestros `linea_id`, formatos, total que no cuadra, entrega más tarde de lo pedido, remitente distinto del proveedor. Registro: `ia_registro` canal `correo`, herramienta `leer_correo`, riesgo `borrador`.
- **Estados**: `nuevo` (IA sin configurar) → `analizando` → `revisar` / `sin_asignar` / `clasificado` / `error` → `hecho` / `descartado`. Aviso `correo_revisar` a Compras y contador en el menú.
- **Revisión** (permiso `compras`): datos editables junto al PDF. **Confirmar oferta** escribe como el enlace del proveedor (`solicitud_precios`, `lineas_info`, entrega, portes, ref., notas; `solicitud_proveedores.correo_id`) y guarda su PDF con la oferta; en el comparativo sale «📧 Llegó por correo». **Aplicar al pedido**: `prov_confirmado_en`, `fecha_entrega` (y al material), fechas por línea, `prov_num_confirmacion`, comentario, evento del pedido y `correo_conf_id`. También: cambiar el tipo, asignar a otra petición/pedido (la IA vuelve a leer con esas líneas), volver a leer, descartar, archivar, descargar el original.
- API: `GET /api/correo?vista=revisar|clasificados|hechos|todos&buzon&tipo&q`, `GET /api/correo/:id`, `GET /api/correo/adjuntos/:id[?descargar]`, `GET /api/correo/:id/eml`, `POST /api/correo/:id/confirmar-oferta|confirmar-pedido|asignar|reanalizar|descartar|archivar`, `GET /api/correo/buscar-destino?q`; `GET·POST /api/buzones`, `PUT·DELETE /api/buzones/:id`, `POST /api/buzones/probar`, `POST /api/buzones/:id/recuperar {dias}`.
- **PDF desde el portal del proveedor** (`correos.origen = 'portal'`, sin buzón): en `oferta.html` el proveedor adjunta su presupuesto y pulsa «📎 Enviar solo con mi PDF» (`POST /api/oferta/:t/solo-pdf`, guarda contacto/observaciones y `solicitud_proveedores.portal_pdf_en`); si sube el PDF y no envía nada, cada 10 min se cogen los de hace más de 30 min (`revisarPortal`). `correoIA.desdePortal(sp)` copia sus archivos a `correo/portal/…`, crea el «correo» ya asociado a su petición y lo pasa a la IA; queda **por revisar** con el sello 🌐 Portal (siempre con revisión humana; al confirmar no se duplica el PDF, que ya está con la oferta). Si después el proveedor rellena el formulario, el borrador se descarta solo (`portalCompletado`). En el comparativo: «🌐 Envió su PDF por el portal…: falta revisarlo».
- **Las cuatro formas de responder una petición de precio**: (1) formulario del portal, con o sin PDF → directo al comparativo; (2) solo PDF en el portal → IA → por revisar; (3) respuesta al correo con los precios en el texto → IA → por revisar; (4) respuesta al correo con PDF → IA → por revisar. Una respuesta se reconoce por responder a nuestro correo (`correo_enviados`), el código SOL en el asunto o el remitente. Cualquier correo claramente ligado a una petición (una pregunta, un «lo miramos»…) queda con su `sp_id` aunque no sea una oferta; si es una **pregunta**, aviso a Compras.
- **PDF con lo escrito encima** (`src/pdf-leer.js`, MuPDF en WASM): muchos proveedores devuelven nuestra propia petición con sus precios añadidos con un editor de PDF (anotaciones, campos de formulario), en una capa que la IA no siempre ve. Antes de leerlo se extrae ese texto (`texto_escrito_encima_de_los_pdf`) y, si hay capa añadida, se dibujan las páginas (máx. 6, PNG) para la IA; aviso «El PDF tiene texto escrito encima». Las instrucciones dicen que una respuesta a nuestra petición con adjunto es casi siempre una oferta. Si aun así la IA no lo ve como oferta, en la conversación cualquier respuesta tiene «✎ Apuntar oferta con esto al lado».
- **Nuestra petición devuelta con los precios escritos** (`pdf-leer.preciosEnPeticion`, sin IA): si un PDF adjunto contiene el código de una petición candidata, se busca cada línea de material por su descripción y se lee el precio que está a su altura (en el texto del PDF, en una anotación o en un campo): «x €0.20», «0,20 €», «€ 0,20», «precio: …». Completa o corrige lo de la IA (con aviso si no coinciden) y, si la IA lo veía como «otro», lo convierte en oferta. **Red de seguridad**: una respuesta a una petición con adjuntos que la IA no ve como oferta queda igualmente como oferta por revisar, con aviso.
- **Revisar desde la petición**: si un proveedor tiene una oferta leída por la IA sin revisar (`correo_revisar_id` en la petición), su tarjeta muestra «🤖 Revisar oferta recibida» (en vez de «✎ Apuntar oferta»): el mismo cuadro de apuntar oferta relleno con la lectura de la IA (precios, entrega, portes, ref., notas con validez/pago/plazo; avisos y notas por línea) y, al lado, su correo (sin lo citado) o su PDF. «✔ Confirmar oferta» = `POST /api/correo/:id/confirmar-oferta` (entra en el comparativo y el correo queda resuelto); «Descartar lectura» la descarta. También «🤖 Revisar y confirmar aquí» en la conversación. El texto citado de las respuestas («El … escribió:», «>») se oculta tras «Mostrar texto citado».
- **💬 Conversación** (tarjeta del proveedor en la petición; `GET /api/compras/solicitudes/:id/proveedores/:sp/conversacion`, y `…&conv=<sp>` en la URL la abre): en orden, lo enviado (desde ahora `correo_enviados` guarda para, asunto, texto y adjuntos), lo recibido por correo o subido al portal (con lo que entendió la IA, estado, texto y adjuntos, y enlace a Correo entrante) y los pasos en el portal (abrir el enlace, formulario, PDF). En naranja lo pendiente de revisar; contador en el botón. «✉ Escribirle desde mi correo» abre un correo con el asunto de la petición.
- **Siguiente fase**: albaranes (cotejar con el pedido en la recepción), facturas (cuadre y costes), Excel adjuntos, clientes, buzones personales.

## Lista de precios y aprendizaje de la IA (Compras › Lista de precios)

`src/precios.js`, `public/precios.html` + `precios-pantalla.js`.

- **Tabla `precios`**: material (`catalogo_id` del catálogo, por la línea de escandallo o `solicitud_lineas.catalogo_id`; si no hay, por `desc_norm`), proveedor, precio **sin IVA**, unidad, cantidad, fecha, `origen` (oferta / pedido / albarán / factura / manual), `via` (portal, correo, pdf_portal, manual, pedido) y referencias (`sp_id`+`sol_linea_id` o `pedido_linea_id`, únicas: reconfirmar sustituye). Solo material: no entran líneas de subcontratación (tareas) ni portes.
- **Se registra solo** al guardar una oferta en el formulario del portal, al apuntarla a mano, al confirmar una leída por la IA (correo o PDF) y al enviar un pedido (precio pactado). Carga inicial una vez (`migr_precios`) con lo que ya había.
- **Precio del sistema** = el último confirmado (a igual fecha, el de pedido); «viejo» si tiene más de 90 días. Pantalla: último, proveedor y fecha, mejor 6 meses, medio 12 meses, nº de precios y proveedores; historial con gráfico y enlace a su petición, pedido o correo; filtro por proveedor y «solo viejos»; CSV. `GET /api/precios?q&proveedor`, `GET /api/precios/historial?clave=c<catalogo>|d<desc>`.
- **Precio habitual** en la revisión de ofertas (petición y Correo entrante): `habitualesDeSolicitud` (sin contar los precios de esa misma petición). La lectura de la IA avisa si un precio se aleja más de un 40 % del habitual.
- **Aprendizaje por proveedor**: al confirmar una oferta leída por la IA, lo corregido (precios, portes, entrega, referencia) va a `ia_correcciones`; de ahí `proveedores.notas_ia_auto` (≥ 2 veces: precios con IVA, unidad N veces mayor/menor). Notas escritas por Compras en `proveedores.notas_ia`. La IA devuelve también cómo llama el proveedor a cada línea (`su_texto` → `proveedor_alias`). Todo esto («memoria_de_este_proveedor»: notas, últimas 8 correcciones y equivalencias) se le pasa a la IA cada vez que lee a ese proveedor, con prioridad sobre su interpretación. En la ficha del proveedor: «🤖 Lo que la IA sabe». `GET·PUT /api/proveedores/:id/ia`.
- **Para Presupuestos**: `GET /api/precios/estimado?catalogo_id=` (precio sugerido y aviso si está viejo o no hay); `solicitudes_precio.motivo` (`compra` | `presupuesto`) y `solicitud_lineas.catalogo_id` para pedir precio de materiales del catálogo sin escandallo.

## Todo pedido es un pedido de compra

Compras pide y Logística recibe. Ya no se marca «pedido» línea a línea en Material de las partidas: `PUT /api/escandallo/:id/compra` responde que se haga con un pedido de compra.

- **📞 Ya pedido por teléfono**: en *Por pedir* se marcan las líneas y en la barra se pulsa «📞 Ya pedido por teléfono…». Se indican proveedor (obligatorio), fecha de llegada, su nº de pedido, precio por línea (opcional) y una nota. `POST /api/compras/pedidos/telefono {escandallo_ids, proveedor_id, fecha_entrega, num_proveedor, precios: {escandallo_id: €}, nota}` crea un pedido de compra:
  - **ya enviado**, con `pedidos_compra.por_telefono` y su nº en `prov_num_confirmacion`;
  - pasa las líneas a «Pedido» (`pasarAPedido`), registra en la lista de precios los precios que haya y avisa a logística;
  - si pasa del límite de aprobación, avisa a Dirección (no lo bloquea: ya está pedido).
- **Se completa con su confirmación por correo** (compras@):
  - los pedidos por teléfono son candidatos para los correos de ese proveedor, y a la IA se le dice que el proveedor no conoce nuestro código PC (`pedido_por_telefono`, `su_numero`);
  - su confirmación, proforma, albarán o factura con esos materiales se lee como `confirmacion_pedido`, con precio por línea (`precio_cotizado` + `unidad_cotizada`, convertido con las equivalencias del material), su nº y la fecha;
  - con varios pedidos abiertos del proveedor, se elige el de las líneas que confirma;
  - en Correo entrante, «Precios y fechas por línea» (editables) → **✔ Aplicar al pedido**. `ponerPrecios` actualiza las líneas, el material (`precio_pedido`), el total y la lista de precios, y deja el evento «📧 Por correo: … · 2 precios».
  - Si no llega, los precios se apuntan en el propio pedido: `PUT /api/compras/pedidos/:id/precios {lineas: {id: €}}`, solo en los de teléfono.
  - La ficha del pedido muestra «📞 Pedido por teléfono · esperando su confirmación…» o «✔ confirmado».
- **Anular** un pedido enviado (`POST /api/compras/pedidos/:id/anular {motivo}`, botón «✕ Anular pedido»):
  - lo que no ha llegado vuelve a *Por pedir* y lo recibido se queda;
  - se quitan sus precios de la lista y se avisa a logística;
  - guarda `anulado_en`, `anulado_por` y `anulado_motivo`.
- **Recibir por pedido**: *Pedido · por recibir* agrupa por pedido de compra (📞/🛒, proveedor, su nº, fecha, «sin confirmar»). Cada línea tiene casilla (todas marcadas) y abajo van nº de albarán, foto o PDF y **✔ Recibir el pedido** o «Recibir lo marcado (N de M)».
  - `POST /api/compras/pedidos/:id/recibir {escandallo_ids, num_albaran, archivos}` marca recibido, resuelve sus incidencias, avisa a los operarios y deja el evento en el pedido.
  - El albarán queda en el pedido (`archivos` `ref_tipo = 'pedido_albaran'`, `pedido.albaranes`).
  - Desde las otras pestañas se puede recibir una línea suelta.
- **Paso de lo anterior** (una vez, `migr_pedidos_telefono`): las líneas marcadas «pedido» con el botón rápido antiguo pasan a pedidos por teléfono, uno por proveedor, nº y día.

## Trazabilidad en los documentos al proveedor

Peticiones de oferta y pedidos de compra llevan el proyecto en todo lo que sale hacia el proveedor (`src/referencias.js`):

- **PDF**: los proyectos en la cabecera (en el pedido, añadidos a su «Referencia» si no estaban). Bajo cada línea, «Ref.: P-2026-0060 · 01.01 partida · OT 60.01». Las líneas sueltas (portes, transporte) llevan el proyecto si el documento es de uno solo.
- **Correo**: el proyecto va en el asunto, después del código SOL/PC (que sigue el primero para asociar las respuestas), y en el texto se pide indicarlo en el albarán y la factura.
- **Portal del proveedor**: el proyecto y la referencia de cada línea.
- La referencia de la línea va en una fila aparte, en letra pequeña, así que la lectura de precios escritos en nuestro PDF no se ve afectada.

## Unidades y equivalencias (todo el sistema)

El proveedor cotiza en su unidad (hierro en €/kg o €/t, tubo en €/barra) y nosotros pedimos en la nuestra (barras, ml). El sistema convierte con las equivalencias de cada material del catálogo (la lista de materiales de los escandallos).

- **Unidad base** de cada material, que es la de comparar y guardar precios: perfiles, tubos, pletinas y macizos en **ml**; chapas en **m²**; el resto en su unidad del catálogo.
- **Equivalencias calculadas** del nombre y el detalle del catálogo (`src/unidades.js`), al arrancar, en `catalogo.unidad_base` / `equiv` / `equiv_origen`:
  - kg/ml por geometría y densidad (acero 7,85; inox 7,93; 316 8,0; aluminio 2,7 kg/dm³);
  - tubos con el radio de esquina de EN 10219; laminados (IPE, HEA, HEB, HEM, IPN, UPN) por tabla;
  - ml por barra («barra 6 m» del detalle); m² de pintura por ml (perímetro); m² y kg por chapa.
  - Unos 1.338 de los 2.858 materiales las tienen. Generales: t ↔ kg, mm/cm ↔ m.
- **Correcciones a mano**: en Lista de precios › material › 📏 (`PUT /api/catalogo/:id/unidades` con `kg_ml`, `ml_barra`, `m2_ud`, `kg_m2`, `pint_m2_ml`, o `{recalcular:true}` para volver a lo calculado). Quedan como `manual` y el arranque no las toca. Al cambiarlas se recalculan los precios guardados de ese material, partiendo de lo que cotizó el proveedor.
- **Dónde se usa**:
  - **Portal del proveedor** y **«Apuntar oferta»**: selector de unidad por línea (la nuestra y las convertibles), con la conversión al momento. El servidor convierte (`unidades.aLinea`) y guarda lo cotizado en `solicitud_precios.precio_cotizado` / `unidad_cotizada`.
  - **IA**: devuelve `precio_cotizado` + `unidad_cotizada` tal cual y no convierte. `normalizar` convierte a la unidad de la línea con una alerta que explica la cuenta. Si falta la equivalencia, deja el precio vacío y pide añadirla.
  - **Comparativo**: «cotizó 1,15 €/kg» bajo el precio por unidad de la línea.
  - **Lista de precios** (`precios.precio_base` / `unidad_base` / `precio_orig` / `unidad_orig`): todo en la unidad base, con lo cotizado debajo. El precio habitual se convierte a la unidad de cada línea.
  - Así lo usará **Presupuestos**.

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
| PUT | `/api/pin/:recursoId/rol` | `{roles: [...]}` roles de quien entra con PIN (el primero es el principal; el resto en `usuarios.roles_extra`) |
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
| GET | `/api/importar/catalogo` | nombres exactos para el compositor (`s360-catalogo/1`) |
| GET | `/api/costes/proyectos` | control de costes: todos los proyectos (permiso costes) |
| GET | `/api/costes/proyecto/:id` | un proyecto: partida › OT › tarea › persona, por tipo de coste, avisos |
| PUT | `/api/costes/partida/:id` | PVP y presupuesto de coste de una partida |
| GET/PUT | `/api/costes/ajustes` | recargo de la hora extra |
| POST | `/api/proyectos/:id/condiciones` | `{texto}` añadir condición previa |
| GET · PUT | `/api/tareas/:id/dependencias` | tareas que pueden ir antes (mismo proyecto; las que harían un círculo, marcadas) · `{dependencias: [{id, espera_h}]}` |
| PATCH · DELETE | `/api/condiciones/:id` | `{cumplida, texto}` · quitar |

## Plan por fases

**Fase 1 – Cuadrante operativo diario (hecho).** Vista día, drag & drop, conflictos, login y roles.

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
