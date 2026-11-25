/* Textos de la ayuda de s360. Una entrada por pantalla (por su ruta) y la lista de novedades.
   Regla: cada funcionalidad nueva añade aquí su ayuda, su paso de recorrido si hace falta y su novedad.
   - si: permiso(s) que lo ven (vacío = todos)
   - recorridos[].pasos[].sel: marca data-ayuda="…" (o selector CSS). esperar: 'click' | 'escribir' (lo hace él)
   - version: súbela si el recorrido cambia de verdad; quien ya lo vio recibe un aviso para repetirlo */
window.S360_AYUDA = {
  pantallas: {
    '/': {
      titulo: 'Cuadrante de planificación',
      para_que: 'Aquí se reparte el trabajo: qué tarea se hace, qué día, en qué área y con quién. A la derecha lo que falta por planificar, en el centro el calendario y a la izquierda la gente, las máquinas y las subcontratas.',
      video: { src: '/ayuda/tablero-planificar.mp4', poster: '/ayuda/tablero-planificar.jpg', texto: 'Planificar una tarea: arrastrarla al calendario y asignarle una persona.' },
      esquema: {
        titulo: 'El camino de una tarea',
        pasos: [
          { que: 'Llega del compositor o se crea', quien: 'Proyectos y OTs' },
          { que: 'Se planifica en el calendario', quien: 'Quien planifica', aqui: true },
          { que: 'Se asignan personas y equipos', quien: 'Quien planifica', aqui: true },
          { que: 'El operario la ve y la apunta', quien: 'Mi día' },
          { que: 'Se confirma lo real', quien: 'Encargado · Supervisión de partes' },
        ],
      },
      recorridos: [
        {
          id: 'tab-basico', version: 1, si: 'planificar', ofrecer: true, conmigo: true, duracion: '2 min',
          titulo: 'Cómo planificar en el cuadrante',
          pasos: [
            { texto: 'En dos minutos: dónde está lo que falta por hacer, cómo se pone en el calendario y cómo se asigna la gente. <b>No cambiaremos nada</b>: los pasos que tocan datos solo te los enseño.' },
            { sel: '#ordenes-lista', texto: '<b>Por planificar</b>: todo lo pendiente, agrupado <b>Proyecto › Partida › OT</b>. Las cabeceras se pliegan; ⚠ son condiciones previas sin cumplir (pago, RAL…).' },
            { sel: '.tarea-card', texto: 'Cada tarjeta es una tarea con las <b>horas que quedan</b>. «×2» = dos operarios a la vez, «⤷» = va después de otra, 🧰 = su material. <b>Arrástrala al calendario</b> para planificarla.', aviso: 'Al soltarla se crea un tramo hasta el fin de la jornada; lo que no cabe queda pendiente en la tarjeta para otro día.' },
            { sel: '#cal', texto: 'El <b>calendario</b>: una fila por área de trabajo (zona del taller, cabina, oficina, obras al final). Las tareas se mueven arrastrando y se alargan desde sus bordes.' },
            { sel: '.bloque', opcional: true, texto: 'Un <b>tramo</b> planificado. Dentro, una barra por operario. <b>Púlsalo</b> para ver el detalle: horas, recursos, material, «Repartir en días siguientes»…' },
            { sel: '.rec', texto: 'Los <b>recursos</b>: operarios, máquinas y subcontratas. <b>Arrastra una persona encima de un tramo</b> para asignarla. Si seleccionas una tarea, se marcan con ✓ los que saben hacer lo que pide.' },
            { sel: '#rec-libres', texto: '<b>Solo libres</b> esconde a quien ya tiene trabajo ese día.' },
            { sel: '#conflictos', texto: 'Los <b>avisos</b>: falta gente, alguien está en dos sitios, el material llega tarde, fuera de jornada… Cada uno tiene <b>Solucionar</b> con propuestas.' },
            { sel: '#periodo-sel', texto: '<b>Día, Semana o Mes</b>. En semana y mes también se arrastra: la tarea va al primer hueco libre de ese día.' },
            { sel: '#vista-sel', texto: '<b>Áreas u Operarios</b>: filas por zona de trabajo o una fila por persona, para ver quién está libre.' },
            { sel: '#hoy', texto: 'Las flechas cambian de día y <b>Hoy</b> te devuelve a hoy.' },
            { sel: '#btn-ayuda', texto: 'Si dudas, <b>?</b>: el vídeo, el esquema y este recorrido otra vez.' },
          ],
        },
      ],
      secciones: [
        { titulo: '⏱ Excedente y horas extra', texto: 'Si <b>alargas un tramo</b> más allá de lo estimado, <b>la estimación no cambia</b>: lo que pasa se ve <b>rayado</b> en el bloque con «+1h excedente» (sin estimar). En el detalle de la tarea, «Real» compara las horas del parte con las previstas; al <b>terminarla</b>, su último tramo lleva «✔ −3h menos» (verde) o «+2h más» (rojo). Si queda <b>fuera del turno</b> de alguien (por defecto 07:00–15:00; cada persona puede tener el suyo), son <b>horas extra</b>: sale «Horas extra» para poner el motivo y <b>Pedir autorización</b> a Dirección, o «Solo hasta el fin de su turno». Mientras no se autorizan, el bloque lleva la parte extra rayada en rojo y «⏱ 2h extra ⏳»; autorizadas, en verde. Si Dirección dice que no, la franja vuelve al fin de su turno. Si tienes el permiso de autorizar, quedan autorizadas al momento.' },
        { titulo: '🏭 Talleres externos', texto: 'Al final del cuadrante, el bloque <b>Talleres externos</b>: una fila por taller de fuera mientras tenga tareas activas (como las obras). Sus tareas se planifican ahí, arrastrándolas, y no ocupan a nadie de aquí (sin avisos de operarios ni jornada). Si el montaje está planificado antes de que termine lo de fuera, sale un aviso en rojo. Al pulsar una tarea ves la <b>📍 situación</b> de la OT y puedes poner su avance.' },
        {
          titulo: 'Planificar una tarea', si: 'planificar',
          pasos: [
            'Busca la tarea en <b>Por planificar</b> (derecha).',
            'Arrástrala al área y la hora del calendario.',
            'Arrastra las personas (y máquinas) de la izquierda encima del tramo.',
            'Mira los <b>avisos</b> abajo y pulsa <b>Solucionar</b> si sale alguno.',
          ],
        },
        {
          titulo: 'Tareas largas', si: 'planificar',
          pasos: [
            'Al soltar, el tramo llega hasta el fin de jornada; el resto queda en la tarjeta («quedan 12h»).',
            'En el detalle del tramo, <b>Repartir lo pendiente en días siguientes</b> lo coloca en jornadas completas con la misma gente.',
            'Para que alguien estuvo menos tiempo, arrastra el borde de <b>su barra</b> dentro del tramo.',
          ],
        },
        {
          titulo: 'Si alguien falta', si: 'planificar',
          pasos: ['Pulsa su nombre en la lista de recursos.', 'Elige <b>Falta</b>, Baja, Permiso… (todo el día o unas horas).', 'Si tenía trabajo, sale un aviso con <b>Solucionar</b> para pasarlo a otro.'],
        },
        {
          titulo: 'Qué significa…',
          terminos: [
            ['<b>quedan 12h</b>', 'Horas de la tarea que aún no están en el calendario.'],
            ['<b>×2</b>', 'La tarea necesita dos operarios a la vez.'],
            ['<b>⤷</b>', 'Va después de otra tarea (dependencia).'],
            ['<b>🧰 ✔ / 24/11 / falta / ?</b>', 'Material: en almacén / llega ese día / sin pedir / sin revisar. En rojo si llega después del día planificado.'],
            ['<b>✓ / ≠ / 🔒</b>', 'Tramo confirmado tal cual / con cambios / día cerrado en el parte.'],
            ['<b>Cola rayada roja</b>', 'El tramo pasa de lo estimado.'],
            ['<b>SUB</b>', 'Persona subcontratada.'],
          ],
        },
      ],
    },

    '/parte.html': {
      titulo: 'Supervisión de partes',
      para_que: 'Al final del día el encargado confirma lo que se hizo de verdad. Lo planificado no se toca: lo real se guarda aparte y sirve para el avance, los costes y los informes.',
      esquema: {
        titulo: 'De lo planificado a lo real',
        pasos: [
          { que: 'Se planifica', quien: 'Cuadrante' },
          { que: 'Cada operario apunta su día', quien: 'Mi día (móvil)' },
          { que: 'Se revisa y confirma', quien: 'Encargado', aqui: true },
          { que: 'Se cierra el día', quien: 'Encargado', aqui: true },
          { que: 'Avance, costes e informes', quien: 'Automático' },
        ],
      },
      recorridos: [
        {
          id: 'parte-basico', version: 1, si: 'planificar', ofrecer: true, duracion: '1 min',
          titulo: 'Cómo supervisar los partes',
          pasos: [
            { sel: '#pendientes', texto: 'Arriba, los <b>días pasados sin cerrar</b> y lo que hay por clasificar en la bandeja.' },
            { sel: '#mi-dia-envios', opcional: true, texto: 'Quién ha <b>enviado su día</b> desde el móvil: ✔ enviado, ◐ a medias, ✗ nada.' },
            { sel: '#tramos', texto: 'Cada trabajo planificado, con lo que apuntó el operario. Ciérralo con <b>✓ Como estaba</b>, <b>✎ Corregir</b> (quién y de qué hora a qué hora) o <b>✗ No se hizo</b>.', aviso: 'Y dile cómo va la tarea: <b>sigue</b>, <b>faltan X h</b> (reestima) o <b>terminada</b>.' },
            { sel: '#personas', texto: '<b>Por persona</b>: las horas de cada uno ese día, para ver de un vistazo si cuadra.' },
            { sel: '#form-horas', texto: '<b>Horas fuera del plan</b>: trabajo no planificado o tiempo no productivo (desplazamiento, limpieza, formación…).' },
            { sel: '#cerrar-dia', texto: '<b>Cerrar el día</b>: lo que quede se da por hecho tal cual. Un día cerrado ya no se cambia en el cuadrante (se puede reabrir).' },
          ],
        },
      ],
      secciones: [
        {
          titulo: 'Cada trabajo',
          terminos: [
            ['<b>✓ Como estaba</b>', 'Se hizo tal cual estaba planificado.'],
            ['<b>✓ Confirmar lo apuntado</b>', 'Da por bueno lo que apuntó el operario en su móvil.'],
            ['<b>✎ Corregir</b>', 'Otra gente u otras horas; con motivo (falta de material, avería, clima…).'],
            ['<b>✗ No se hizo</b>', 'Se quita del cuadrante y sus horas vuelven a «Por planificar».'],
            ['<b>faltan X h</b>', 'Horas de reloj que le quedan a la tarea: reestima lo pendiente.'],
            ['<b>terminada</b>', 'La tarea cuenta para el avance; pregunta si quitar lo planificado después.'],
          ],
        },
        { titulo: 'Si te equivocas', texto: '<b>Deshacer</b> en el trabajo cerrado lo devuelve todo a como estaba. Un día cerrado se puede <b>reabrir</b>.' },
      ],
    },

    '/proyectos.html': {
      titulo: 'Proyectos y OTs',
      para_que: 'Cada proyecto se divide en partidas (las del presupuesto) y cada partida en órdenes de trabajo (OT) con sus tareas. Lo normal es importarlo del compositor; aquí se revisa, se completa y se prepara el material.',
      video: { src: '/ayuda/proyectos-importar.mp4', poster: '/ayuda/proyectos-importar.jpg', texto: 'Importar un proyecto del compositor: arrastrar el archivo, revisar la vista previa e importar.' },
      esquema: {
        titulo: 'Cómo se organiza',
        pasos: [
          { que: 'Proyecto', quien: 'Cliente, obra, condiciones previas', aqui: true },
          { que: 'Partida', quien: 'La del presupuesto, con su material', aqui: true },
          { que: 'OT (orden de trabajo)', quien: 'Hito con fecha de entrega', aqui: true },
          { que: 'Tarea', quien: 'Horas, operarios, lo que pide → al cuadrante', aqui: true },
        ],
      },
      recorridos: [
        {
          id: 'proy-basico', version: 1, si: 'proyectos', ofrecer: true, conmigo: true, duracion: '1 min',
          titulo: 'Recorrido por un proyecto',
          pasos: [
            { sel: '#btn-importar', texto: '<b>Importar…</b>: se arrastra el archivo del compositor. Antes de cambiar nada sale una <b>vista previa</b>; reimportar actualiza sin duplicar.' },
            { sel: '#lista-proyectos li:not(.ayuda)', esperar: 'click', texto: 'Los proyectos activos. <b>Pulsa uno</b> para abrirlo.', saltar_si: () => !document.getElementById('proyecto-ficha')?.hidden },
            { sel: '#proyecto-campos', texto: 'Sus datos. <b>Cliente</b> y <b>Obra</b> se eligen de sus fichas (buscador: elegir, crear o «Sin obra»); lo demás se guarda al salir de cada campo.' },
            { sel: '#proyecto-condiciones', texto: '<b>Condiciones previas</b> (anticipo, RAL confirmado…): mientras estén sin marcar, el cuadrante lo avisa.' },
            { sel: '.gp-mat', opcional: true, texto: 'Cada partida tiene su material: <b>📋 Escandallo</b> (lo que hace falta, lo envía el técnico a logística) y <b>🧩 Asignar</b> (qué tarea usa cada material y herramienta).' },
            { sel: '#lista-ots li:not(.grupo-partida):not(.ayuda)', esperar: 'click', texto: 'Las <b>OTs</b> de cada partida. <b>Pulsa una</b> para ver sus tareas.', saltar_si: () => !document.getElementById('ot-ficha')?.hidden },
            { sel: '#tareas-tbody', texto: 'Las <b>tareas</b>: horas, operarios, área. Son lo que luego se arrastra al cuadrante. Se ordenan con el asa ⠿.' },
            { sel: '.req-btn', opcional: true, texto: '<b>Requiere</b>: lo que tienen que saber hacer los operarios, equipos, subcontratas… Se abre un cuadro para marcarlo.' },
            { sel: '#ot-tablero', texto: '<b>Ver en el cuadrante</b> te lleva a esta OT en la planificación.' },
          ],
        },
      ],
      secciones: [
        { titulo: '🏗 Subcontrata en obra', texto: 'Si el trabajo lo hace aquí (en la obra o en el taller) una subcontrata, en <b>Área / taller</b> elige «🏗 nombre» (grupo «Subcontrata en obra»): la tarea conserva su área y se planifica en el cuadrante como las demás, sin operarios propios; en <b>Oper.</b> pones las personas que pone ella. <b>🏭 Subcontratar…</b> le pide presupuesto (responde precio, días, personas y cuándo puede empezar) o hace el pedido. En su enlace <b>confirma los días</b> que le planificas (o propone otros); si los cambias, se le pide confirmar otra vez, y el día antes le llega un recordatorio. Cada día apunta su <b>parte</b> (personas, horas, avance, fotos); tú lo <b>validas</b> debajo de la tarea o abres una incidencia de calidad. El parte «terminado» validado cierra la tarea.' },
        { titulo: '🏭 Tareas que hace un taller de fuera', texto: 'En la columna <b>Área / taller</b> de la tarea, elige el taller externo (Ferros Puig, la carpintería de aluminio, la galvanizadora, el transporte…). No hay etapas fijas: las etapas son las tareas de la OT, en su orden (con «después de…»). Debajo pones el <b>avance</b> y <b>cómo va</b>. Arriba de las tareas, la <b>📍 situación del producto</b>: dónde está ahora, hasta cuándo y lo que queda fuera.' },
        { titulo: '📨 Seguimiento con el taller', texto: 'Debajo de su tarea, <b>▶ Comenzar seguimiento</b> le manda al taller (por correo, o copias el enlace para WhatsApp) un <b>enlace sin usuario</b>. Ahí ve sus tareas de la OT con nuestras fechas y nos dice: <b>sin empezar / en curso / terminado / entregado</b>, el avance, cuándo terminará, fotos, comentarios y, al entregar, <b>a quién</b> (otro taller, nosotros u otro), con bultos y foto del albarán. Lo que pone sale aquí (con sus fotos y las novedades) y en la situación del producto, y te avisa al móvil. Si dice que termina más tarde que el plan, <b>solo avisa</b>: el plan no se mueve solo. Si pasa su fecha sin terminar y sin noticias, le llega un correo <b>cada día laborable</b> hasta que actualice. Cada taller empieza cuando tú pulses su botón (p. ej. Tenas cuando le llega la pieza). «🔗 Enlace» lo copia otra vez, «Nuevo» anula el anterior y «⏹ Parar» lo cierra.' },
        { titulo: '🧾 Pedir presupuesto o hacer el pedido al taller', texto: 'En la situación del producto, <b>🏭 Subcontratar…</b>: marca las tareas de fuera de la OT, añade líneas sueltas si hace falta (transporte, portes) y elige <b>Pedir presupuesto</b> (a uno o varios talleres: contestan precio y plazo en su enlace y se comparan en Compras › Peticiones de precio) o <b>Hacer el pedido</b> (a un taller). Se abre en Compras, donde se ponen los precios, se aprueba si pasa del límite y se envía. Al enviar el pedido va con él su <b>enlace de seguimiento</b>; si en el comparativo eliges otro taller, las tareas pasan a ese taller. Debajo de cada tarea ves en qué pedido o petición está, y el importe entra en el control de costes como subcontrata.' },
        {
          titulo: 'Importar del compositor', si: 'proyectos',
          pasos: [
            'Pulsa <b>Importar…</b> y arrastra el archivo <code>.s360.json</code>.',
            'Revisa la vista previa: qué se crea o cambia, avisos y los <b>nombres que no coinciden</b>.',
            'Para cada nombre: crearlo, asociarlo a uno que ya existe o ignorarlo (se recuerda).',
            'Pulsa <b>Importar</b>. Lo planificado nunca se toca al reimportar.',
          ],
        },
        {
          titulo: 'Material de la partida', si: ['escandallo', 'proyectos', 'planificar'],
          pasos: [
            '<b>📋 Escandallo</b>: lista del material con cantidad y unidad (viene del compositor o se escribe).',
            '<b>📦 Enviar a logística</b>: logística recibe el aviso para revisar stock.',
            '<b>🧩 Asignar</b>: reparte el material y las herramientas entre las tareas.',
          ],
        },
        {
          titulo: 'Qué significa…',
          terminos: [
            ['<b>Avance</b>', 'Horas previstas de las tareas terminadas sobre el total.'],
            ['<b>Rendimiento</b>', 'Previsto ÷ real de lo terminado. Más de 100 % = se hizo en menos horas.'],
            ['<b>Fuera de presupuesto</b>', 'Al reimportar ya no venía, pero tenía trabajo hecho y se conserva.'],
            ['<b>⚠ en 🧩 Asignar</b>', 'Material del escandallo que todavía no está asignado a ninguna tarea.'],
          ],
        },
      ],
    },

    '/asignar.html': {
      titulo: 'Asignar material y herramientas',
      para_que: 'Aquí se dice qué tarea usa cada material de la partida y qué herramientas hay que preparar. Así el operario lo ve en Mi día y el cuadrante avisa si algo llega tarde.',
      recorridos: [
        {
          id: 'asig-basico', version: 1, ofrecer: true, duracion: '40 s',
          titulo: 'Cómo asignar',
          pasos: [
            { sel: '#tab-mat', texto: '<b>Materiales</b>: a la izquierda el escandallo de la partida con lo que queda por asignar.' },
            { sel: '#izq', texto: '<b>Arrastra un material</b> a una tarea de la derecha (o púlsalo y luego pulsa la tarea). Te pregunta cuánto; se puede repartir entre varias tareas.' },
            { sel: '#der', texto: 'Las OTs de la partida con sus tareas y lo que ya tienen asignado.' },
            { sel: '#tab-herr', texto: '<b>Herramientas</b>: marca las de mano en el catálogo, pulsa la tarea y <b>Agregar a la tarea</b>. Los equipos de los que hay pocos (taladro magnético, soldadoras…) van en <b>⚙ Equipos</b>.' },
            { sel: '#btn-escandallo', texto: 'Para cambiar el material de la partida, <b>Escandallo</b>.' },
          ],
        },
      ],
      secciones: [
        {
          titulo: 'Tres clases de herramienta',
          terminos: [
            ['<b>Máquina fija</b>', 'Sierra, plegadora, cabina… Va con el área: planifica la tarea allí y no hace falta pedirla.'],
            ['<b>Equipo (hay pocos)</b>', 'Taladro magnético, soldadoras, llaves de impacto… Se pide el tipo y en el cuadrante se asigna cuál.'],
            ['<b>Herramienta de mano</b>', 'Radial, sargentos, nivel, arnés… Lista para que el operario la prepare.'],
          ],
        },
      ],
    },

    '/recursos.html': {
      titulo: 'Recursos',
      para_que: 'Las personas, las máquinas y las subcontratas con las que se planifica, sus ausencias y vacaciones, las áreas de trabajo y los tipos de recurso.',
      recorridos: [
        {
          id: 'rec-basico', version: 1, si: 'recursos', ofrecer: true, conmigo: true, duracion: '1 min',
          titulo: 'Recorrido por Recursos',
          pasos: [
            { sel: '#tab-operario', texto: 'Las pestañas: <b>Operarios</b>, <b>Maquinaria</b>, <b>Subcontratas y alquileres</b>, <b>Vacaciones y festivos</b>, <b>Áreas de trabajo</b> y <b>⚙ Tipos</b>.' },
            { sel: '#lista li', esperar: 'click', texto: '<b>Pulsa una persona</b> de la lista para ver su ficha.', saltar_si: () => !document.getElementById('ficha')?.hidden },
            { sel: '#campos', texto: 'Su ficha: categoría, vínculo, coste €/h, área habitual… <b>Se guarda al salir de cada campo</b>. Lo que sabe hacer va en Capacidades.' },
            { sel: '#uso', texto: '<b>Uso</b>: horas asignadas las próximas semanas e historial.' },
            { sel: '#ausencias', texto: '<b>Ausencias</b>: vacaciones, baja, permiso, formación… Si tenía trabajo asignado, te avisa.' },
            { sel: '#baja', texto: '<b>Dar de baja</b>: deja de salir para planificar pero conserva su historial.' },
            { sel: '#tab-calendario', texto: 'En <b>Vacaciones y festivos</b> se aprueban las peticiones de vacaciones y se revisan los justificantes.' },
          ],
        },
      ],
      secciones: [
        { titulo: '⏱ Turnos y horas extra', texto: 'Pestaña <b>Turnos y horas extra</b>. <b>Turnos</b>: «Normal» 07:00–15:00 por defecto; añade otros (Tarde, Obra…) y ponle a cada operario el suyo en su ficha (campo Turno). Lo que se le planifique fuera de su turno son horas extra. <b>Por autorizar</b> (Dirección, permiso «Autorizar horas extra»): cada petición con la tarea, el día, las horas, quiénes, el coste aproximado, cuántas llevan en el mes y el motivo; ✔ Autorizar o ✗ No (con motivo: su franja vuelve al fin de su turno y lo que sobra queda en «Por planificar»). <b>Hechas fuera del turno sin autorizar</b>: del parte; dices si son extra (con recargo) o no. Abajo, lo decidido en el mes por persona.' },
        {
          titulo: 'Vacaciones: cómo se aprueban',
          pasos: ['El operario las pide desde Mi día.', '<b>Operaciones</b> da el visto bueno.', '<b>RRHH</b> las aprueba (o las rechaza con motivo).', 'Pasan solas al calendario de ausencias.'],
        },
        {
          titulo: 'Qué significa…',
          terminos: [
            ['<b>Categoría / puesto</b>', 'Oficial 1ª, 2º, Encargado… Solo agrupa en el cuadrante y sirve para el coste.'],
            ['<b>¿Se mueve?</b>', 'Una máquina «fija en esa área» va sola con lo que se planifica allí.'],
            ['<b>Familia y uso</b>', 'De los tipos de máquina: qué es (Soldadura, Corte…) y dónde se usa (taller, obra).'],
            ['<b>Baja</b>', 'Ya no se planifica con él, pero su historial se conserva. «Reactivar» lo devuelve.'],
          ],
        },
      ],
    },

    '/capacidades.html': {
      titulo: 'Capacidades',
      para_que: 'Lo que sabe hacer cada persona (soldar MIG, manejar la plegadora, PRL 60 h…). Las tareas piden capacidades y el cuadrante avisa si se asigna a alguien que no la tiene.',
      esquema: {
        titulo: 'Cómo se valida',
        pasos: [
          { que: 'El operario marca lo que sabe', quien: 'Mi día › Mis capacidades' },
          { que: 'El supervisor la valida', quien: 'Pestaña «Por validar»', aqui: true },
          { que: 'Cuenta en el cuadrante', quien: '✓ al elegir gente para una tarea' },
        ],
      },
      recorridos: [
        {
          id: 'cap-basico', version: 1, ofrecer: true, duracion: '40 s',
          titulo: 'Cómo funcionan las capacidades',
          pasos: [
            { sel: '#tabs', texto: '<b>Por capacidad</b> (quién sabe hacer cada cosa), <b>Por persona</b> (qué sabe cada uno) y <b>Por validar</b> (lo que han propuesto los operarios).' },
            { sel: '#izq', texto: 'Las capacidades por familias. Con permiso de recursos se añaden, se renombran o se cambian de familia.' },
            { sel: '#der', texto: 'Quién la sabe hacer. Marcar una casilla aquí la deja <b>validada</b> directamente.' },
          ],
        },
      ],
      secciones: [
        { titulo: 'Por validar', si: 'recursos', texto: 'Lo que un operario marca en su móvil queda «⏳ pendiente» y <b>no cuenta</b> hasta que lo validas aquí. El menú lleva un número con lo que espera.' },
      ],
    },

    '/gantt.html': {
      titulo: 'Gantt',
      para_que: 'El plan por semanas de cada proyecto y sus OTs: si llegan a su entrega, qué va antes de qué y dónde se acumula el trabajo. Se planifica en el cuadrante; aquí se mira.',
      secciones: [
        { titulo: 'Cómo se lee', texto: 'Filas: proyecto › OT › tareas (▸ despliega las tareas). La barra de la OT va de su primer a su último día planificado; la parte clara es su avance; <b>⚑</b> es la entrega (roja si no llega). En rayado rojo, las horas que faltan por planificar. Colores de las tareas: gente propia, 🏭 taller externo, 🚚 transporte, 🏗 subcontrata en obra, gris si está hecha. La línea azul es hoy.' },
        { titulo: 'Riesgo de cada OT', texto: '<b>Retrasada</b> (la entrega ya pasó) o <b>no llega</b> (lo planificado termina después), <b>faltan X h por planificar</b> con la entrega cerca, <b>justo</b> (2 días laborables de margen o menos), <b>sin planificar</b>, <b>a tiempo</b>. «Solo con riesgo» deja las que hay que mirar; «Ordenar: Riesgo» las pone arriba.' },
        { titulo: 'Controles', texto: 'Semanas (6, día a día) o Meses (26 semanas). Agrupar por proyecto, obra o cliente (las mismas filas, ordenadas de otra forma). Al pulsar una tarea (su nombre o su barra) se abre su ventana, la misma del cuadrante: cambiar estado, ver tramos, dependencias, material… Con <b>📋</b> se va al cuadrante ese día (para asignar gente). El nombre de la OT abre su ficha.' },
        { titulo: 'Exportar para enviar', texto: '<b>📄 Exportar</b> (o 📄 junto a cada proyecto): el Gantt de un proyecto en <b>PDF</b> (A4 o A3 horizontal) o <b>imagen PNG</b>, para el cliente, proveedores o un pliego. Elige solo OTs u OTs y tareas, avance, línea de hoy, quién hace lo externo, título y nota al pie. Sale solo lo planificado, sin datos internos.' },
        { titulo: 'Carga por semana', texto: '<b>Oficios</b>: horas-persona planificadas frente a lo que pueden hacer sus operarios (su turno, sin festivos ni ausencias). <b>Áreas</b>: horas en cada área frente a la jornada. <b>Talleres externos</b>: días con trabajo. <b>Subcontratas</b>: horas × personas. En naranja a partir del 85 %, en rojo si se pasa.' },
      ],
    },
    '/obras.html': {
      titulo: 'Obras',
      para_que: 'Cada obra es una dirección que reúne proyectos (de uno o varios clientes): sus datos, sus proyectos, lo próximo que hay allí y sus incidencias.',
      secciones: [
        { titulo: 'Qué es una obra', texto: 'La dirección donde se trabaja: <b>Obra › Proyectos › Partidas › OT › Tareas</b>. Un proyecto está en una obra o en ninguna («Sin obra»: trabajos solo de taller o venta). Cada obra tiene <b>una fila en el cuadrante</b> (bajo «Obras») que comparten sus proyectos y que sale mientras alguno está activo.' },
        { titulo: 'Sus datos', texto: 'Nombre y dirección son obligatorios; el resto, opcional: contacto en obra y teléfono, <b>acceso y horario</b> (lo ven las subcontratas en su enlace), promotor, dirección facultativa, constructora y notas. Se guarda al salir de cada campo; cambiar el nombre o la dirección cambia su fila del cuadrante y el texto de sus proyectos.' },
        { titulo: 'Proyectos y lo próximo', texto: 'Debajo, sus proyectos (cliente, OTs, entrega, avance) y «＋ Nuevo proyecto aquí». A la derecha, el mapa, lo planificado de hoy en adelante (con las subcontratas 🏗 y talleres 🏭) y las incidencias abiertas.' },
      ],
    },
    '/clientes.html': {
      titulo: 'Clientes',
      para_que: 'Los datos de cada cliente y sus personas de contacto, con sus proyectos y obras.',
      secciones: [
        { titulo: 'Datos', texto: 'Razón social, nombre comercial, CIF, dirección fiscal, tipo (empresa, particular, comunidad, administración), teléfono, correos general y de facturas, forma de pago, anticipo habitual y notas. Un cliente con proyectos no se borra: se da de baja.' },
        { titulo: 'Personas de contacto', texto: 'Cada una con su papel (propiedad, arquitecto, administración…), teléfono y correo, <b>qué puede aprobar</b> (todo, planos, muestras, cambios con precio, actas, citas) y <b>cómo se le avisa</b> (correo, WhatsApp, resumen semanal o solo hitos). Serán las personas con enlace del proyecto.' },
      ],
    },
    '/incidencias.html': {
      titulo: 'Incidencias',
      para_que: 'Todas las incidencias de la empresa en un sitio (material, transporte, calidad, averías, seguridad, proveedores), con responsable, seguimiento y cierre.',
      esquema: {
        titulo: 'De la incidencia al cierre',
        pasos: [
          { que: 'Se abre', quien: 'Logística, al recibir, en el móvil o aquí' },
          { que: 'En curso', quien: 'Responsable del área', aqui: true },
          { que: 'Esperando proveedor', quien: 'Reclamación con su enlace' },
          { que: 'Resuelta', quien: 'Al recibir, con abono o a mano' },
          { que: 'Cerrada', quien: 'Responsable + Operaciones' },
        ],
      },
      recorridos: [
        {
          id: 'inc-basico', version: 1, ofrecer: true, duracion: '40 s',
          titulo: 'Gestionar una incidencia',
          pasos: [
            { sel: '#inc-tabs', texto: '<b>Mías</b>: las de tu área o a tu nombre. <b>Esperando proveedor</b>: reclamadas, con su plazo o la fecha acordada. <b>Por cerrar</b>: resueltas que te toca firmar.' },
            { sel: '#inc-lista', texto: 'Cada incidencia con su tipo, gravedad, a qué tareas afecta y cómo va. Pulsa una para ver su ficha.' },
            { sel: '#inc-ficha', texto: '<b>Reclamar al proveedor</b>: correo con el informe PDF, WhatsApp o enlace; él contesta qué hará y la <b>fecha</b>. <b>Aceptar fecha</b> programa los recordatorios; si no es aceptable, decides y queda escrito. La cierran el responsable y Operaciones.', opcional: true },
            { sel: '#inc-nueva', texto: 'Abre una incidencia nueva (calidad en una tarea, avería, seguridad…). Las críticas avisan al momento a Dirección.' },
          ],
        },
      ],
      secciones: [
        { titulo: 'Reclamar y esperar', texto: 'Al reclamar se pide <b>reponer</b>, <b>cambiar</b> o un <b>abono</b>, para cuándo lo necesitamos y un plazo de respuesta (2 días laborables por defecto). El proveedor, transportista o subcontrata contesta en su enlace (sin cuenta) qué hará y la <b>fecha de resolución</b> (obligatoria). Sin respuesta en el plazo: correo de recordatorio cada 2 días laborables y aviso al responsable. Con la fecha aceptada: ese día, recordatorio a los dos; si pasa sin resolver, aviso al responsable y a Operaciones para decidir.' },
        { titulo: 'Resolver y cerrar', texto: 'Las de material se resuelven solas cuando Logística marca «Recibido». Si no, «Marcar resuelta» (con el abono, si lo hubo) o «Decidir» (otro proveedor, stock, abono…). Después firman el cierre el responsable del área y Operaciones; en calidad hay que poner la causa y qué se hará para que no se repita.' },
        { titulo: 'En el cuadrante', texto: 'Las tareas afectadas llevan el aviso «⚠ INC-…» en sus tramos de hoy en adelante, con «Solucionar → Abrir la incidencia».' },
      ],
    },
    '/bandeja.html': {
      titulo: 'Bandeja de capturas',
      para_que: 'Todo lo que la gente apunta en el momento (una avería, falta material, una idea…) llega aquí para que alguien decida qué hacer con ello.',
      esquema: {
        titulo: 'De la captura a hecho',
        pasos: [
          { que: 'Alguien captura', quien: 'Texto, foto, audio o vídeo' },
          { que: 'Se clasifica', quien: 'Quien planifica', aqui: true },
          { que: 'Tarea, asunto, información o descartar', quien: '' },
          { que: 'Quien capturó ve en qué quedó', quien: 'Lo que he capturado' },
        ],
      },
      recorridos: [
        {
          id: 'band-basico', version: 1, ofrecer: true, duracion: '40 s',
          titulo: 'Cómo clasificar',
          pasos: [
            { sel: '#tab-bandeja', texto: '<b>Por clasificar</b>: lo nuevo. <b>Asuntos abiertos</b>: lo que tiene responsable y aún no está resuelto. <b>Todo</b>: lo de los últimos 120 días.' },
            { sel: '#filtro-proyecto', texto: 'Filtra por proyecto.' },
            { sel: '#lista', texto: 'Cada captura con su foto, audio o vídeo. Clasifícala como <b>Tarea en una OT</b> (pasa a Por planificar), <b>Asunto con responsable</b> (con fecha), <b>Información</b> o <b>Descartar</b>.', aviso: 'Si es una avería, «Máquina parada hoy» la quita del cuadrante ese día.' },
          ],
        },
      ],
    },

    '/capturar.html': {
      titulo: 'Capturar',
      para_que: 'Para apuntar algo en el momento, sin pensar dónde va: una avería, que falta material, una idea, un encargo. Alguien lo clasificará en la bandeja.',
      recorridos: [
        {
          id: 'capt-basico', version: 1, ofrecer: true, duracion: '30 s',
          titulo: 'Cómo capturar',
          pasos: [
            { sel: '#captura', texto: 'Escribe, haz una <b>foto</b>, graba un <b>audio</b> (hasta 3 min) o un <b>vídeo</b> (30 s). Si quieres, di de qué tipo es y de qué proyecto.' },
            { sel: '#mis-asuntos-panel', opcional: true, texto: '<b>Asuntos a mi cargo</b>: lo que te han asignado desde la bandeja. Cuando lo tengas, márcalo como <b>resuelto</b>.' },
          ],
        },
      ],
    },

    '/informes.html': {
      titulo: 'Informes',
      para_que: 'Horas, costes y resultados: cómo van los proyectos frente al presupuesto, qué ha hecho cada operario, el uso de las máquinas y cuánto se cumple lo planificado.',
      recorridos: [
        {
          id: 'inf-basico', version: 1, si: 'informes', ofrecer: true, duracion: '40 s',
          titulo: 'Recorrido por los informes',
          pasos: [
            { sel: '#tab-proyectos', texto: 'Cuatro informes: <b>Proyectos</b>, <b>Operarios</b>, <b>Máquinas y alquileres</b> y <b>Planificación y desvíos</b>.' },
            { sel: '#panel-inf', texto: 'En Proyectos se despliega <b>partida › OT › tarea</b>: presupuestado, estimado, planificado, real, desvío y coste. Todo se exporta a Excel.' },
            { sel: '#tab-operarios', esperar: 'click', texto: '<b>Pulsa Operarios</b>: horas productivas, extra, ausencias y coste de cada persona.' },
            { sel: '#inf-rango', texto: 'En estos informes eliges el <b>periodo</b> (desde–hasta) o un atajo: esta semana, este mes…' },
          ],
        },
      ],
      secciones: [
        { titulo: '⏱ Horas extra en Operarios', texto: '«Extra» son las horas trabajadas <b>fuera del turno</b> de cada uno que <b>Dirección autorizó</b> (llevan el recargo en Control de costes). «Sin aut.» son las trabajadas fuera de su turno sin autorizar: se deciden en Recursos › Turnos y horas extra.' },
        {
          titulo: 'Qué significa…',
          terminos: [
            ['<b>Presupuestadas</b>', 'Horas-persona del compositor al importar (estimación × operarios).'],
            ['<b>Estimadas</b>', 'Con las reestimaciones del parte («faltan X h»).'],
            ['<b>Previsión</b>', 'Lo real hasta hoy más lo que falta.'],
            ['<b>Cumplimiento</b>', '% de tramos que se hicieron tal como estaban planificados.'],
          ],
        },
        { titulo: 'Para que salga el coste', texto: 'Pon el <b>coste €/h</b> en la ficha de cada recurso (Recursos).' },
      ],
    },

    '/usuarios.html': {
      titulo: 'Usuarios y accesos',
      para_que: 'Quién entra al sistema y qué puede hacer: usuarios con email, personas que entran con PIN desde el móvil o la tablet del taller, y los roles con sus permisos.',
      recorridos: [
        {
          id: 'usu-basico', version: 1, si: 'usuarios', ofrecer: true, duracion: '1 min',
          titulo: 'Recorrido por usuarios',
          pasos: [
            { sel: '#form-usuario', texto: '<b>Alta con email</b>: nombre, email y rol. No se escribe contraseña: se genera un <b>enlace</b> para que la persona elija la suya.' },
            { sel: '#lista-usuarios', texto: 'Los usuarios. Desactivar a alguien lo saca al momento.' },
            { sel: '#tit-pin', texto: '<b>Personas: entrada con PIN</b>: los operarios entran con 4 cifras. La columna <b>Rol</b> (uno o varios) decide qué pueden hacer.' },
            { sel: '#lista-disp', opcional: true, texto: 'El PIN <b>solo funciona en dispositivos autorizados</b>: la tablet del taller o el móvil de cada uno con su enlace.' },
            { sel: '#tit-roles', texto: '<b>Roles y permisos</b>: qué deja cambiar cada rol. Se pueden crear roles nuevos.' },
          ],
        },
      ],
    },

    '/mi-dia.html': {
      titulo: 'Mi día',
      para_que: 'Tu trabajo de hoy: dónde, con quién y qué necesitas. Al terminar, apunta cómo fue y envíalo al encargado. El móvil es para confirmar y avisar; lo demás se hace en la oficina.',
      video: { src: '/ayuda/mi-dia.mp4', poster: '/ayuda/mi-dia.jpg', texto: 'Apuntar el día: marcar el material, decir cómo fue y enviarlo.' },
      recorridos: [
        {
          id: 'md-basico', version: 1, ofrecer: true, duracion: '1 min',
          titulo: 'Cómo usar Mi día',
          pasos: [
            { texto: 'En un minuto te enseño cómo apuntar tu día. <b>No cambiaremos nada</b>.' },
            { sel: '.md-tramo', texto: 'Cada tarjeta es un <b>trabajo de hoy</b>: la hora, el área, la tarea y con quién vas.' },
            { sel: '.md-ll-lista', opcional: true, texto: '<b>🧰 Necesitas</b>: el material y las herramientas. Marca la casilla cuando <b>tengas el material</b> y cuando <b>prepares cada herramienta</b>.' },
            { sel: '.md-botones', opcional: true, texto: 'Al terminar: <b>✓ Hecho</b>, <b>◐ En parte</b> (de qué hora a qué hora) o <b>✗ No</b> (con el motivo). Luego dinos si la tarea <b>queda terminada</b>.' },
            { sel: '.md-inc-link', opcional: true, texto: '¿Algo raro? <b>＋ Capturar</b>: una foto, un audio o un texto de este trabajo.' },
            { sel: '#extra-abrir', texto: '<b>Trabajo no planificado</b>: si hiciste otra cosa (desplazamiento, limpieza, otra tarea).' },
            { sel: '#enviar', texto: 'Cuando lo tengas todo, <b>Enviar mi día</b>. Puedes cambiarlo hasta que el encargado lo confirme.' },
            { sel: '#md-menu-btn', texto: 'En el <b>Menú</b>: Mi mes, Vacaciones, Avisar si no vienes, Mi perfil, Mis capacidades y esta <b>Ayuda</b>.' },
          ],
        },
      ],
      secciones: [
        { titulo: '👁 Supervisar (encargados, logística, Operaciones, Dirección)', texto: 'En Menú, apartado <b>Supervisar</b>, salen solo los que tu rol permite. <b>📦 Recibir envíos</b>: lo que está en Maó (y en camino) por líneas: marca lo que ha llegado, los bultos, el nº de albarán, foto y, si falta algo o llega dañado, escríbelo; con todo recibido el envío queda entregado y avisa. También las piezas que un taller dice haber entregado «a nosotros». Funciona sin cobertura. <b>🧾 Parte de hoy</b>: lo que ha apuntado cada operario, con sus avisos; ✔ Confirmar uno a uno o «Confirmar todo lo que no tiene avisos»; corregir horas y cerrar el día, en el ordenador. <b>✔ Aprobar</b>: pedidos por encima del límite, vacaciones (tu paso) y compras locales. <b>📍 Dónde está cada cosa</b>: las OT con algo en un taller o en un envío, retrasos primero y cuándo se necesita aquí.' },
        { titulo: '🛒 Compra local', texto: 'Si autorizas compras (Operaciones), arriba en Menú › Compra local tienes <b>Por autorizar</b> con ✔ Autorizar / ✗ No. Si tu rol lo permite: botón <b>🛒 Compra local para esta tarea</b> en cada trabajo, o Menú › <b>Compra local</b>: si necesitas algo de la ferretería u otra tienda, escribe qué, elige la tienda, <b>para qué tarea</b> (las tuyas de hoy, u «Otra tarea…» para buscarla por OT, tarea u obra), el importe aproximado y si es para ahora o mañana, y pulsa <b>Pedir autorización</b>. Operaciones te contesta y te llega un aviso. Si está autorizada, verás un <b>código de autorización</b> (p. ej. «7KP-3XM»): dalo en la tienda para comprar a cuenta de la empresa. Después haz la <b>foto del ticket</b>, pon el importe y pulsa «Ya lo he comprado».' },
        {
          titulo: 'Mi día paso a paso',
          pasos: ['Mira tus trabajos y lo que necesitas.', 'Marca el material recibido y las herramientas preparadas.', 'Al acabar cada trabajo: ✓ Hecho, ◐ En parte o ✗ No.', 'Pulsa <b>Enviar mi día</b>.'],
        },
        {
          titulo: 'Otras cosas del menú',
          terminos: [
            ['<b>Vacaciones</b>', 'Ves los días que te quedan y pides días. Primero da el visto bueno Operaciones y luego RRHH.'],
            ['<b>Avisar</b>', 'No vengo o llego tarde, con foto del justificante.'],
            ['<b>Mi perfil</b>', 'Tus datos (teléfono, tallas…) y cambiar tu PIN.'],
            ['<b>Mis capacidades</b>', 'Marca lo que sabes hacer; tu encargado lo valida.'],
          ],
        },
        {
          titulo: 'Logística en el móvil', si: 'logistica',
          pasos: ['Menú › <b>📦 Revisar stock</b>: «No hay», «Hay todo» o cuánto hay.', 'Menú › <b>🚚 Recibir material</b>: «Ha llegado», con el nº de albarán y su foto.', '<b>⚠ Incidencia</b> si llega mal o incompleto.'],
        },
      ],
    },

    '/compras.html': {
      titulo: 'Compras',
      para_que: 'Pedidos de compra a proveedores: se preparan con el material «por pedir» de las partidas, Dirección los aprueba si pasan del límite y se envían en PDF desde compras@. Al enviarlos, logística ya los ve como pedidos.',
      esquema: {
        titulo: 'El camino de un pedido',
        pasos: [
          { que: 'Marcar lo que falta', quien: 'Material de las partidas › Por pedir' },
          { que: 'Precios y proveedor', quien: 'Compras', aqui: true },
          { que: 'Aprobación (si pasa del límite)', quien: 'Dirección', aqui: true },
          { que: 'Enviar el PDF', quien: 'Compras · desde compras@', aqui: true },
          { que: 'Recibir con el albarán', quien: 'Logística' },
        ],
      },
      recorridos: [
        {
          id: 'cmp-basico', version: 2, si: ['compras', 'aprobar_compras'], ofrecer: true, duracion: '1 min',
          titulo: 'Cómo va un pedido de compra',
          pasos: [
            { sel: '.cmp-lista', texto: 'Los pedidos por estado: <b>esperando aprobación</b>, <b>aprobados por enviar</b>, <b>borradores</b> y <b>enviados</b>. Se crean desde <b>Material de las partidas › Por pedir</b>, marcando las líneas.' },
            { sel: '.cmp-campos', texto: 'Proveedor, fecha de entrega, dónde entregar y referencia. <b>Todo se guarda solo</b> al cambiarlo.', opcional: true },
            { sel: '.cmp-tabla', texto: 'Las líneas: pon el <b>precio</b> de cada una (en naranja las que faltan). Se pueden añadir líneas a mano (portes, etc.).', opcional: true },
            { sel: '.cmp-acciones', texto: '<b>📄 Ver PDF</b> es lo que recibe el proveedor. Si el total pasa del límite, primero <b>Pedir aprobación</b>; si no, <b>Enviar al proveedor</b>.', opcional: true },
            { sel: '#tab-precios', texto: 'En <b>Peticiones de precio</b> se pide oferta a varios proveedores, se apuntan sus precios y se comparan antes de pedir.' },
            { sel: '#tab-proveedores', texto: 'En <b>Proveedores</b> están sus correos, forma de pago y lo que sirve cada uno.' },
          ],
        },
      ],
      secciones: [
        { titulo: '🚚 Transportes península → Menorca', texto: 'Pestaña <b>Transportes</b>. A la izquierda, <b>Para enviar a Menorca</b>: sale solo lo que espera transporte — las OT cuya tarea de transporte la hace un transportista (Ydica, Tragina…; se marca en su ficha de Proveedores) cuando el taller ya ha terminado o se lo ha entregado (en gris, lo que aún está en el taller) y los pedidos a proveedores de <b>península</b> que no han llegado. Se marca y <b>＋ Nuevo envío</b> (o se arrastra a un envío). En el envío: transportista, recogida, llegada a Maó, bultos y kg, y el <b>coste</b>, que se reparte por kg (o a mano) y cuenta en costes de la OT. <b>✉ Enviar al transportista</b> le manda su enlace (sin usuario): primero <b>acepta la recogida</b> (fecha, direcciones, bultos, precio) o propone otra fecha o precio (se acepta o no desde la ficha; también «Aceptada por teléfono»); al aceptarla, cada pedido que se recoge activa su seguimiento y el proveedor recibe la recogida confirmada con su enlace. Si se cambian la fecha, el precio, el transportista o lo que va, hay que volver a pedírsela. Después, en el mismo enlace, marca recogido / en barco / en Maó / entregado, la llegada y el CMR. La tarea de transporte y la situación de la OT se actualizan solas, el material de los pedidos pasa a llegar ese día y, si llega después de lo que se necesita (montaje), el cuadrante avisa. Si se pasa la fecha sin noticias, recordatorio diario por correo.' },
        { titulo: '🛒 Compras locales', texto: 'Pestaña <b>Compras locales</b>: lo que piden los operarios desde el móvil (ferretería, almacén de la isla…) a cuenta de la empresa. Cada compra va siempre a una <b>tarea de una OT</b>. <b>Por autorizar</b>: Operaciones pulsa ✔ Autorizar o ✗ No (con motivo); al autorizar se crea un <b>código de autorización</b> al azar y único que el operario da en la tienda (sale también aquí y en el cuadre, para comprobarlo en el albarán o la factura). <b>Autorizadas sin ticket</b>: falta la foto del ticket (a los 2 días se le recuerda). <b>Por cuadrar con factura</b>: por tienda y mes; marca las de una factura, pon su número y «Cuadrar». En rojo, lo que pasó más de un 15 % de lo autorizado. El importe del ticket cuenta como material de la tarea en el control de costes. En la ficha del proveedor, «Tiene cuenta de crédito» decide qué tiendas salen en el móvil.' },
        {
          titulo: 'Preparar y enviar', si: 'compras',
          pasos: [
            'En <b>Material de las partidas › Por pedir</b> marca «Incluir en un pedido de compra» en cada línea.',
            'Abajo elige el proveedor y pulsa <b>Crear pedido de compra</b>.',
            'Pon los precios y revisa fecha y referencia.',
            'Si pasa del límite, <b>Pedir aprobación</b>; Dirección recibe el aviso.',
            '<b>Enviar al proveedor</b>: por correo desde compras@, o «Ya lo he enviado yo» si lo mandas a mano.',
          ],
        },
        {
          titulo: 'Pedir precio antes de pedir', si: 'compras',
          pasos: [
            'En <b>Material de las partidas › Por pedir</b> marca las líneas y pulsa <b>✉ Pedir precio…</b>.',
            'Elige los proveedores (salen primero los que sirven ese material) y las fechas.',
            'En <b>Peticiones de precio</b>, <b>📤 Enviar</b> a cada uno (o «Ya lo he enviado yo»).',
            'Cuando contesten, <b>✎ Apuntar oferta</b>: precio por línea, entrega, portes y su PDF.',
            'Compara, elige proveedor en cada línea (en verde lo más barato que llega a tiempo) y <b>🛒 Crear pedidos</b>.',
            'El proveedor puede <b>responder en la plataforma</b>: el correo y el PDF llevan su enlace personal (o <b>🔗 Enlace</b> para mandarlo por WhatsApp). Pone sus precios, «No lo tengo» o una alternativa, y su oferta entra sola en el comparativo; te llega un aviso.',
          ],
        },
        {
          titulo: 'Aprobar', si: 'aprobar_compras',
          pasos: ['Te llega un aviso con el pedido.', 'Revisa líneas, precios y total.', '<b>✔ Aprobar</b> o <b>✗ No aprobar</b> con el motivo (vuelve a borrador).'],
        },
        { titulo: 'El límite y los datos del PDF', texto: 'En <b>⚙ Ajustes</b>: a partir de qué importe aprueba Dirección, los datos de la empresa y las condiciones al pie del pedido.' },
        { titulo: 'El correo de salida', si: 'usuarios', texto: 'En <b>⚙ Ajustes › Correo de salida</b>: servidor, cuenta y contraseña de compras@ (IONOS: smtp.ionos.es, 587, STARTTLS). La contraseña se guarda cifrada y no se vuelve a mostrar; para cambiarla, escribe la nueva y <b>Guardar</b>. <b>Probar conexión</b> comprueba que entra.' },
      ],
    },

    '/costes.html': {
      titulo: 'Control de costes',
      para_que: 'Cómo va cada proyecto en dinero: lo presupuestado, lo gastado hasta hoy, lo que costará al terminar y el margen sobre el PVP. Solo lo ven Administración, Operaciones y Dirección.',
      esquema: {
        titulo: 'De dónde sale cada cifra',
        pasos: [
          { que: 'Presupuesto y PVP', quien: 'Del compositor al importar (o «✎ Presupuesto»)' },
          { que: 'Horas reales', quien: 'Supervisión de partes' },
          { que: 'Coste real', quien: 'Horas × coste/hora de la ficha (+ recargo de las extra)', aqui: true },
          { que: 'Previsión y margen', quien: 'Real + lo que falta × coste/hora', aqui: true },
        ],
      },
      recorridos: [
        {
          id: 'cos-basico', version: 1, si: 'costes', ofrecer: true, conmigo: true, duracion: '1 min',
          titulo: 'Cómo leer el control de costes',
          pasos: [
            { sel: '#panel-costes tbody tr.clic', esperar: 'click', texto: 'Cada fila es un proyecto: PVP, coste presupuestado, real, previsión y <b>margen previsto</b>. <b>Pulsa uno</b> para verlo en detalle.', opcional: true },
            { sel: '.kpis', texto: 'Arriba lo importante: <b>margen previsto</b>, coste al terminar frente a lo presupuestado y <b>avance frente a gastado</b> (si se gasta más deprisa de lo que se avanza, sale en rojo).', opcional: true },
            { sel: '.cos-lista-avisos', texto: 'Los <b>avisos</b>: partidas que se pasan, que dan pérdidas o tareas con más horas de las estimadas.', opcional: true },
            { sel: '.cos-tipos', texto: '<b>Por tipo de coste</b>: mano de obra, material, maquinaria, subcontratas y otros. El material real llegará con los precios de compra.', opcional: true },
            { sel: '.cos-edit', texto: '<b>✎ Presupuesto</b>: PVP y coste presupuestado de la partida, si no vinieron del compositor.', opcional: true },
            { sel: '.cos-ajustes', texto: 'El <b>recargo de la hora extra</b> (ahora +50 %) se cambia aquí.' },
          ],
        },
      ],
      secciones: [
        {
          titulo: 'Qué significa…',
          terminos: [
            ['<b>Real</b>', 'Horas del parte × coste/hora de la persona (el de ese día). Las horas por encima de la jornada llevan el recargo.'],
            ['<b>Previsión</b>', 'Lo real más lo que falta (estimación actual − real) × coste/hora. Si está terminada, lo real.'],
            ['<b>Avance / gastado</b>', 'Valor del trabajo hecho y lo gastado, ambos sobre la mano de obra presupuestada.'],
            ['<b>Margen previsto</b>', 'PVP − coste previsto al terminar (lo que aún no se lleva, como el material, cuenta por lo presupuestado).'],
            ['<b>Estimado</b>', 'Si el compositor no trae la mano de obra de la partida: horas presupuestadas × coste/hora medio.'],
          ],
        },
        { titulo: 'Para que salga bien', texto: 'Pon el <b>coste €/h</b> en la ficha de cada persona y máquina (Recursos) y cierra los partes cada día.' },
      ],
    },

    '/logistica.html': {
      titulo: 'Material de las partidas',
      para_que: 'Aquí llega el material que el técnico necesita para cada partida. Logística dice cuánto hay en el almacén, compras pide lo que falta y logística lo recibe. Cada cambio avisa al siguiente.',
      video: { src: '/ayuda/logistica-revisar.mp4', poster: '/ayuda/logistica-revisar.jpg', texto: 'Revisar stock en 20 segundos: abrir la partida, contestar «Hay todo» o cuánto hay.' },
      esquema: {
        titulo: 'El camino del material',
        pasos: [
          { que: 'Envía el material', quien: 'Técnico · desde la partida' },
          { que: 'Revisa stock', quien: 'Logística', aqui: true },
          { que: 'Pide lo que falta', quien: 'Compras', aqui: true },
          { que: 'Recibe y apunta albarán', quien: 'Logística', aqui: true },
          { que: 'Lo ve en Mi día', quien: 'Operario de la tarea' },
        ],
      },
      recorridos: [
        {
          id: 'log-revisar', version: 1, si: 'logistica', ofrecer: true, conmigo: true, duracion: '1 min',
          titulo: 'Cómo revisar el stock',
          pasos: [
            { texto: 'En un minuto verás cómo contestar al técnico si el material está en el almacén. <b>Algunos pasos los haces tú</b>; los que cambian datos de verdad solo te los enseño.' },
            { sel: 'log-pestanas', texto: 'Las pestañas siguen el camino del material: <b>Revisar stock</b> → <b>Por pedir</b> (compras) → <b>Pedido</b> → <b>Disponible</b>. El número es lo que está pendiente.' },
            { sel: 'log-pestana-revisar', esperar: 'click', texto: 'Pulsa <b>Revisar stock</b>: es lo que te toca a ti.', saltar_si: (n) => n.getAttribute('aria-selected') === 'true' },
            { sel: 'log-partida', esperar: 'click', texto: 'El material va agrupado por partida. Pulsa la cabecera para <b>abrirla</b>. Los contadores te dicen cuántas líneas tiene, cuántas faltan y cuántas van tarde.', saltar_si: (n) => n.parentElement.open },
            { sel: 'log-linea', texto: 'Cada tarjeta es un material: <b>cuánto hace falta</b> y para qué día. Debajo, <b>↳ la tarea de la OT</b> que lo usa: púlsala para verla en su proyecto.' },
            { sel: 'log-stock', texto: 'Mira en el almacén y contesta: <b>No hay</b>, <b>Hay todo</b>, o escribe <b>cuánto hay</b> y pulsa ✓.', aviso: 'Esto se apunta de verdad: lo que falte pasa a «Por pedir» y compras recibe un aviso. Si te equivocas, puedes corregirlo después.' },
            { sel: 'mat-foto', texto: 'Si hay algo raro (otra medida, viene dañado…), saca una <b>foto</b>: el técnico y compras la verán en la tarjeta.' },
            { sel: 'log-buscar', esperar: 'escribir', texto: 'Para encontrar algo rápido, busca por material, proyecto o partida. Prueba a escribir <b>tubo</b>.' },
            { sel: 'log-acc-barra', opcional: true, texto: 'Con muchas partidas: <b>Abrir todas</b> o <b>Cerrar todas</b>. Lo que dejas abierto se recuerda.' },
            { sel: '#btn-ayuda', texto: 'Cuando dudes, pulsa <b>?</b>: está esta ayuda, el vídeo y el recorrido para repetirlo.' },
          ],
        },
        {
          id: 'log-pedir', version: 1, si: 'compras', ofrecer: true, duracion: '40 s',
          titulo: 'Cómo pedir lo que falta',
          pasos: [
            { sel: 'log-pestana-comprar', esperar: 'click', texto: 'En <b>Por pedir</b> está lo que logística ha dicho que falta.', saltar_si: (n) => n.getAttribute('aria-selected') === 'true' },
            { sel: 'log-pedir', opcional: true, texto: 'Elige <b>proveedor</b>, <b>cuándo llega</b>, el <b>nº de pedido</b> y, si lo tienes, adjunta el PDF. Luego <b>🛒 Pedido</b>.', aviso: 'Al marcarlo como pedido se avisa al técnico y a logística, y el cuadrante comprueba si llega a tiempo para la tarea.' },
            { sel: 'log-pestana-recibir', texto: 'Lo pedido pasa a <b>Pedido · por recibir</b>, donde logística lo recibe con el albarán.' },
          ],
        },
      ],
      secciones: [
        {
          titulo: 'Revisar stock', si: 'logistica',
          pasos: [
            'Abre la pestaña <b>Revisar stock</b> y la partida.',
            'Para cada material, mira en el almacén.',
            'Contesta <b>No hay</b>, <b>Hay todo</b> o escribe cuánto hay y pulsa ✓.',
            'Si algo no cuadra, saca una <b>foto</b>.',
          ],
        },
        {
          titulo: 'Recibir material', si: 'logistica',
          pasos: [
            'Pestaña <b>Pedido · por recibir</b>.',
            'Comprueba lo que ha llegado con el albarán.',
            'Escribe el <b>nº de albarán</b> y adjunta la foto o el PDF.',
            'Pulsa <b>✔ Recibido</b>: el operario de la tarea lo verá en Mi día.',
          ],
        },
        {
          titulo: 'Pedir', si: 'compras',
          pasos: ['Pestaña <b>Por pedir</b>.', 'Proveedor, fecha de llegada y nº de pedido (y PDF si lo hay).', 'Pulsa <b>🛒 Pedido</b>.'],
        },
        {
          titulo: 'Qué significa…',
          terminos: [
            ['<b>N con falta</b>', 'Materiales de la partida de los que no hay bastante en el almacén.'],
            ['<b>N tarde</b>', 'Hacían falta antes de hoy y todavía no están disponibles.'],
            ['<b>Sin planificar</b>', 'Ninguna tarea de la partida está todavía en el cuadrante: aún no hay fecha.'],
            ['<b>Fuera de presupuesto</b>', 'Al reimportar el proyecto, este material ya no venía; se conserva porque ya estaba revisado o pedido.'],
            ['<b>⚠ Incidencia</b>', 'Un aviso desde el móvil (llegó una parte, dañado…). Se ve hasta que alguien pulsa «Resuelta».'],
          ],
        },
      ],
    },
  },

  // id creciente; lo nuevo se enseña una vez a quien le afecta (si: permisos)
  novedades: [
    { id: 1, fecha: '2026-11-16', si: ['logistica', 'compras'], titulo: 'Nº de pedido y de albarán', texto: 'Al pedir se puede apuntar el <b>nº de pedido</b> y al recibir el <b>nº de albarán</b>, cada uno con su PDF o foto.', ir: '/logistica.html' },
    { id: 2, fecha: '2026-11-17', si: ['proyectos', 'escandallo'], titulo: 'Importación del compositor v2', texto: 'Los proyectos importados traen ya el <b>material de cada partida</b>, lo que necesita cada tarea (capacidades, equipos, herramientas) y el <b>desglose de tiempos</b>.', ir: '/proyectos.html' },
    { id: 3, fecha: '2026-11-17', si: ['logistica', 'compras'], titulo: 'Partidas plegables', texto: 'En <b>Material de las partidas</b> cada partida se abre y se cierra, con sus contadores de falta y retraso. Se recuerda lo que dejas abierto.', ir: '/logistica.html' },
    { id: 5, fecha: '2026-11-17', titulo: 'Ayuda en todas las pantallas', texto: 'Pulsa <b>?</b> arriba a la derecha (en el móvil, <b>Menú › Ayuda</b>): qué se hace en cada pantalla, vídeos cortos y un recorrido guiado.' },
    { id: 6, fecha: '2026-11-18', si: 'costes', titulo: 'Control de costes', texto: 'Nueva pantalla en <b>Informes › Control de costes</b>: presupuesto, real, previsión y margen sobre el PVP por partida, OT, tarea y persona.', ir: '/costes.html' },
    { id: 7, fecha: '2026-11-18', si: ['compras', 'aprobar_compras', 'logistica'], titulo: 'Pedidos de compra', texto: 'Nuevo menú <b>Compras</b>: pedidos a proveedores con PDF, aprobación de Dirección por encima del límite y envío desde compras@. Los proveedores tienen su ficha.', ir: '/compras.html' },
    { id: 8, fecha: '2026-11-18', si: ['compras', 'aprobar_compras', 'logistica'], titulo: 'Pedir precio a proveedores', texto: 'Antes de pedir se puede <b>pedir precio</b> a varios proveedores, apuntar sus ofertas, compararlas línea a línea y crear los pedidos con esos precios.', ir: '/compras.html?vista=precios' },
    { id: 9, fecha: '2026-11-19', si: 'usuarios', titulo: 'Correo de salida en Ajustes', texto: 'La cuenta de correo desde la que salen pedidos y peticiones de precio se cambia ya desde <b>Compras › ⚙ Ajustes</b>, con botón para probarla.', ir: '/compras.html?vista=ajustes' },
    { id: 10, fecha: '2026-11-19', si: ['compras', 'aprobar_compras'], titulo: 'Los proveedores ponen sus precios', texto: 'Las peticiones de precio llevan un <b>enlace para que el proveedor responda en la plataforma</b>: precio por línea, «No lo tengo», alternativas, entrega, portes y su PDF. Su oferta aparece sola en el comparativo.', ir: '/compras.html?vista=precios' },
    { id: 12, fecha: '2026-11-19', titulo: 'La ayuda, en voz alta', texto: 'En el panel <b>?</b>, <b>🔊 Escuchar</b> lee la ayuda de la pantalla (con pausa, velocidad y voz). En los recorridos, el botón <b>🔇/🔊</b> de la burbuja lee cada paso al avanzar.' },
    { id: 13, fecha: '2026-11-19', si: ['planificar', 'proyectos'], titulo: 'Talleres externos', texto: 'Una tarea de una OT la puede hacer un <b>taller de fuera</b>: elígelo en <b>Área / taller</b>. El taller sale en el cuadrante, en <b>Talleres externos</b>, mientras tenga tareas activas, y la OT muestra la <b>📍 situación del producto</b> (dónde está y hasta cuándo).', ir: '/proyectos.html' },
    { id: 14, fecha: '2026-11-19', titulo: 'Planéalo y códigos nuevos', texto: 'El planificador se llama <b>Planéalo</b>. Los códigos ahora cuelgan unos de otros: proyecto <b>61</b>, OT <b>61.03</b>, tarea <b>61.03.2</b>. El código anterior de cada OT se conserva («antes OT-…») y se puede buscar. En el cuadrante, cada tarea muestra primero su código y nombre, y debajo la OT, la partida, la obra y el cliente.' },
    { id: 15, fecha: '2026-11-19', si: ['planificar', 'proyectos'], titulo: 'Seguimiento de los talleres externos', texto: 'En la OT, debajo de cada tarea de fuera, <b>▶ Comenzar seguimiento</b> manda al taller un enlace (sin usuario) para que nos diga cómo va: estado, avance, cuándo termina, fotos y a quién lo entrega. Te avisa al móvil, la situación del producto se actualiza sola y, si se pasa su fecha sin noticias, le recordamos por correo cada día.', ir: '/proyectos.html' },
    { id: 16, fecha: '2026-11-19', si: ['planificar', 'proyectos', 'compras'], titulo: 'Subcontratar a talleres externos', texto: 'En la OT, <b>🏭 Subcontratar…</b> pide presupuesto a uno o varios talleres (o hace el pedido) con las tareas de fuera y el transporte. Va por Compras como cualquier pedido, y al enviarlo el taller recibe también su enlace de seguimiento. El importe cuenta en el control de costes.', ir: '/proyectos.html' },
    { id: 17, fecha: '2026-11-19', si: ['compras', 'logistica', 'planificar'], titulo: 'Transportes a Menorca', texto: 'En <b>Compras › 🚚 Transportes</b>, los envíos de península a Menorca: lo que espera transporte sale solo (piezas de los talleres y pedidos de península), se agrupa en un envío y el transportista dice en su enlace cuándo lo recoge, en qué barco va y cuándo llega. La situación de la OT y el cuadrante se actualizan solos y el coste se reparte entre las OT.', ir: '/compras.html?vista=transportes' },
    { id: 18, fecha: '2026-11-21', titulo: 'Compras locales desde el móvil', texto: 'En Mi día › Menú › <b>🛒 Compra local</b> pides autorización para comprar en la ferretería u otra tienda a cuenta de la empresa. Operaciones la autoriza desde Compras › Compras locales y te avisa; después subes la foto del ticket.' },
    { id: 19, fecha: '2026-11-21', si: ['mi_dia'], titulo: 'Mi día funciona sin cobertura', texto: 'Sin conexión, la app abre igual con lo último que tenías y puedes apuntar tu día, trabajo no planificado, capturas con fotos y compras locales. Arriba verás «📴 Sin conexión · N por enviar»; se envía solo cuando vuelve la cobertura.' },
    { id: 20, fecha: '2026-11-22', si: ['logistica', 'planificar', 'proyectos', 'aprobar_compras', 'vacaciones_ops', 'vacaciones_rrhh', 'autorizar_compras_locales'], titulo: 'Supervisar desde el móvil', texto: 'En Mi día › Menú › <b>Supervisar</b>: <b>recibir envíos y piezas</b> (por líneas y bultos, albarán, fotos, lo que falta), <b>parte de hoy</b> para confirmar, <b>aprobar</b> pedidos, vacaciones y compras locales, y <b>dónde está cada cosa</b>. Cada apartado sale solo si tu rol lo tiene.' },
    { id: 21, fecha: '2026-11-23', si: ['planificar', 'autorizar_horas_extra', 'recursos'], titulo: 'Excedente, turnos y horas extra', texto: 'Al <b>alargar un tramo</b> por encima de lo estimado, la estimación no cambia: el excedente se ve rayado («+1h excedente»). Al terminar una tarea se ve si costó menos o más de lo previsto. Lo que queda <b>fuera del turno</b> de cada persona son <b>horas extra</b> y las autoriza <b>Dirección</b> (en Recursos › Turnos y horas extra o en el móvil, Supervisar › Aprobar). Los turnos se definen allí y cada operario tiene el suyo. En costes solo llevan recargo las autorizadas.' },
    { id: 22, fecha: '2026-11-23', si: ['planificar', 'compras', 'logistica', 'proyectos', 'escandallo'], titulo: 'Incidencias: un solo sitio para todas', texto: 'Menú Planificación › <b>Incidencias</b>: material, transporte, calidad, averías… con responsable, <b>reclamación al proveedor</b> (correo con informe PDF, WhatsApp o enlace donde responde qué hará y la fecha), <b>recordatorios</b> automáticos y <b>cierre</b> por el responsable y Operaciones. Las que afectan a tareas se ven en el cuadrante.' },
    { id: 23, fecha: '2026-11-23', si: ['compras', 'logistica'], titulo: 'Cómo llega cada pedido', texto: 'En cada pedido, <b>🚚 Cómo llega</b>: <b>📦 lo trae el proveedor</b> (fecha pactada, agencia MRW / Ecoscooting / UPS / Correos y nº de seguimiento con enlace), <b>🚚 lo vamos a buscar</b> (Menorca Tragina o Luchana recogen en una dirección; se avisa al proveedor del día) o <b>🏬 al almacén del transportista</b> (Idyca Gavà para Tragina, con «Para Dixis Menorca»; Luchana en Sant Feliu). <b>▶ Activar seguimiento</b> da al proveedor un enlace para confirmar y decir cómo va; sin noticias pasada la fecha, recordatorio y luego incidencia. En Transportes, nueva columna «Lo traen los proveedores».' },
    { id: 24, fecha: '2026-11-24', si: ['compras', 'logistica'], titulo: 'El transportista acepta la recogida', texto: 'Al enviar un envío al transportista, en su enlace ve las <b>condiciones de la recogida</b> (fecha, dónde, bultos y kg, precio) y la <b>acepta</b>, propone otra fecha o precio, o dice que no puede. En la ficha del envío se ve en qué punto está y se acepta o no su propuesta. Al aceptarla, el proveedor de cada pedido recibe la <b>recogida confirmada</b> con su enlace de seguimiento.', ir: '/compras.html?vista=transportes' },
    { id: 25, fecha: '2026-11-24', titulo: 'En el teléfono, solo la app móvil', texto: 'Desde el teléfono, Planéalo abre siempre la <b>app móvil</b>. Si no tienes ficha de operario, empiezas en <b>🏠 Inicio</b> con lo que se hace desde el móvil (recibir, aprobar, compras locales, parte de hoy, dónde está cada cosa, capturar). Planificar, pedir y lo demás, en el ordenador.' },
    { id: 26, fecha: '2026-11-24', si: ['planificar', 'proyectos', 'compras'], titulo: 'Subcontratas en obra', texto: 'Una tarea puede hacerla aquí una <b>subcontrata</b> (Área / taller › 🏗). Presupuesto con días y personas, pedido, y en su enlace <b>confirma los días</b> planificados y apunta el <b>parte</b> de cada día, que tú validas. En el cuadrante, 🏗⏳ hasta que confirma y 🏗✔ cuando lo ha hecho; el día antes se le recuerda.', ir: '/proyectos.html' },
    { id: 27, fecha: '2026-11-25', si: ['proyectos', 'planificar'], titulo: 'Obras y Clientes', texto: 'Nuevas pantallas en <b>Proyectos › Obras</b> y <b>Proyectos › Clientes</b>. La obra es una dirección que reúne proyectos y tiene una sola fila en el cuadrante; en el proyecto, Cliente y Obra se eligen con un buscador (o «Sin obra»). Los proyectos que ya había se han pasado solos a su obra y su cliente.', ir: '/obras.html' },
    { id: 28, fecha: '2026-11-25', si: ['planificar', 'proyectos'], titulo: 'Gantt', texto: 'Nueva pantalla <b>Planificación › Gantt</b>: el plan por semanas de cada proyecto y sus OTs, con la entrega ⚑, el avance y el <b>riesgo</b> (retrasada, no llega, faltan horas, justo…), y abajo la <b>carga por semana</b> de oficios, áreas, talleres externos y subcontratas.', ir: '/gantt.html' },
    { id: 29, fecha: '2026-11-25', si: ['planificar', 'proyectos'], titulo: 'El tablero ahora es el Cuadrante · Gantt para enviar', texto: 'El <b>tablero</b> pasa a llamarse <b>Cuadrante</b> (Planificación › Cuadrante). En el <b>Gantt</b>, al pulsar una tarea se abre su ventana sin salir (📋 para verla en el cuadrante), y con <b>📄 Exportar</b> sacas el Gantt de un proyecto en <b>PDF o imagen</b> para el cliente, proveedores o pliegos.', ir: '/gantt.html' },
  ],
};
