/* Textos de la ayuda de s360. Una entrada por pantalla (por su ruta) y la lista de novedades.
   Regla: cada funcionalidad nueva añade aquí su ayuda, su paso de recorrido si hace falta y su novedad.
   - si: permiso(s) que lo ven (vacío = todos)
   - recorridos[].pasos[].sel: marca data-ayuda="…" (o selector CSS). esperar: 'click' | 'escribir' (lo hace él)
   - version: súbela si el recorrido cambia de verdad; quien ya lo vio recibe un aviso para repetirlo */
window.S360_AYUDA = {
  pantallas: {
    '/': {
      titulo: 'Tablero de planificación',
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
          titulo: 'Cómo planificar en el tablero',
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
          { que: 'Se planifica', quien: 'Tablero' },
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
            { sel: '#mi-dia-envios', texto: 'Quién ha <b>enviado su día</b> desde el móvil: ✔ enviado, ◐ a medias, ✗ nada.' },
            { sel: '#tramos', texto: 'Cada trabajo planificado, con lo que apuntó el operario. Ciérralo con <b>✓ Como estaba</b>, <b>✎ Corregir</b> (quién y de qué hora a qué hora) o <b>✗ No se hizo</b>.', aviso: 'Y dile cómo va la tarea: <b>sigue</b>, <b>faltan X h</b> (reestima) o <b>terminada</b>.' },
            { sel: '#personas', texto: '<b>Por persona</b>: las horas de cada uno ese día, para ver de un vistazo si cuadra.' },
            { sel: '#form-horas', texto: '<b>Horas fuera del plan</b>: trabajo no planificado o tiempo no productivo (desplazamiento, limpieza, formación…).' },
            { sel: '#cerrar-dia', texto: '<b>Cerrar el día</b>: lo que quede se da por hecho tal cual. Un día cerrado ya no se cambia en el tablero (se puede reabrir).' },
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
            ['<b>✗ No se hizo</b>', 'Se quita del tablero y sus horas vuelven a «Por planificar».'],
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
          { que: 'Tarea', quien: 'Horas, operarios, lo que pide → al tablero', aqui: true },
        ],
      },
      recorridos: [
        {
          id: 'proy-basico', version: 1, si: 'proyectos', ofrecer: true, conmigo: true, duracion: '1 min',
          titulo: 'Recorrido por un proyecto',
          pasos: [
            { sel: '#btn-importar', texto: '<b>Importar…</b>: se arrastra el archivo del compositor. Antes de cambiar nada sale una <b>vista previa</b>; reimportar actualiza sin duplicar.' },
            { sel: '#lista-proyectos li:not(.ayuda)', esperar: 'click', texto: 'Los proyectos activos. <b>Pulsa uno</b> para abrirlo.', saltar_si: () => !document.getElementById('proyecto-ficha')?.hidden },
            { sel: '#proyecto-campos', texto: 'Sus datos: cliente, obra, notas. <b>Se guarda al salir de cada campo</b>.' },
            { sel: '#proyecto-condiciones', texto: '<b>Condiciones previas</b> (anticipo, RAL confirmado…): mientras estén sin marcar, el tablero lo avisa.' },
            { sel: '.gp-mat', opcional: true, texto: 'Cada partida tiene su material: <b>📋 Escandallo</b> (lo que hace falta, lo envía el técnico a logística) y <b>🧩 Asignar</b> (qué tarea usa cada material y herramienta).' },
            { sel: '#lista-ots li:not(.grupo-partida):not(.ayuda)', esperar: 'click', texto: 'Las <b>OTs</b> de cada partida. <b>Pulsa una</b> para ver sus tareas.', saltar_si: () => !document.getElementById('ot-ficha')?.hidden },
            { sel: '#tareas-tbody', texto: 'Las <b>tareas</b>: horas, operarios, área. Son lo que luego se arrastra al tablero. Se ordenan con el asa ⠿.' },
            { sel: '.req-btn', opcional: true, texto: '<b>Requiere</b>: lo que tienen que saber hacer los operarios, equipos, subcontratas… Se abre un cuadro para marcarlo.' },
            { sel: '#ot-tablero', texto: '<b>Ver en el tablero</b> te lleva a esta OT en la planificación.' },
          ],
        },
      ],
      secciones: [
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
      para_que: 'Aquí se dice qué tarea usa cada material de la partida y qué herramientas hay que preparar. Así el operario lo ve en Mi día y el tablero avisa si algo llega tarde.',
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
            ['<b>Equipo (hay pocos)</b>', 'Taladro magnético, soldadoras, llaves de impacto… Se pide el tipo y en el tablero se asigna cuál.'],
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
        {
          titulo: 'Vacaciones: cómo se aprueban',
          pasos: ['El operario las pide desde Mi día.', '<b>Operaciones</b> da el visto bueno.', '<b>RRHH</b> las aprueba (o las rechaza con motivo).', 'Pasan solas al calendario de ausencias.'],
        },
        {
          titulo: 'Qué significa…',
          terminos: [
            ['<b>Categoría / puesto</b>', 'Oficial 1ª, 2º, Encargado… Solo agrupa en el tablero y sirve para el coste.'],
            ['<b>¿Se mueve?</b>', 'Una máquina «fija en esa área» va sola con lo que se planifica allí.'],
            ['<b>Familia y uso</b>', 'De los tipos de máquina: qué es (Soldadura, Corte…) y dónde se usa (taller, obra).'],
            ['<b>Baja</b>', 'Ya no se planifica con él, pero su historial se conserva. «Reactivar» lo devuelve.'],
          ],
        },
      ],
    },

    '/capacidades.html': {
      titulo: 'Capacidades',
      para_que: 'Lo que sabe hacer cada persona (soldar MIG, manejar la plegadora, PRL 60 h…). Las tareas piden capacidades y el tablero avisa si se asigna a alguien que no la tiene.',
      esquema: {
        titulo: 'Cómo se valida',
        pasos: [
          { que: 'El operario marca lo que sabe', quien: 'Mi día › Mis capacidades' },
          { que: 'El supervisor la valida', quien: 'Pestaña «Por validar»', aqui: true },
          { que: 'Cuenta en el tablero', quien: '✓ al elegir gente para una tarea' },
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
            { sel: '#lista', texto: 'Cada captura con su foto, audio o vídeo. Clasifícala como <b>Tarea en una OT</b> (pasa a Por planificar), <b>Asunto con responsable</b> (con fecha), <b>Información</b> o <b>Descartar</b>.', aviso: 'Si es una avería, «Máquina parada hoy» la quita del tablero ese día.' },
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
            { sel: '.md-botones', texto: 'Al terminar: <b>✓ Hecho</b>, <b>◐ En parte</b> (de qué hora a qué hora) o <b>✗ No</b> (con el motivo). Luego dinos si la tarea <b>queda terminada</b>.' },
            { sel: '.md-inc-link', opcional: true, texto: '¿Algo raro? <b>＋ Capturar</b>: una foto, un audio o un texto de este trabajo.' },
            { sel: '#extra-abrir', texto: '<b>Trabajo no planificado</b>: si hiciste otra cosa (desplazamiento, limpieza, otra tarea).' },
            { sel: '#enviar', texto: 'Cuando lo tengas todo, <b>Enviar mi día</b>. Puedes cambiarlo hasta que el encargado lo confirme.' },
            { sel: '#md-menu-btn', texto: 'En el <b>Menú</b>: Mi mes, Vacaciones, Avisar si no vienes, Mi perfil, Mis capacidades y esta <b>Ayuda</b>.' },
          ],
        },
      ],
      secciones: [
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
            { sel: 'log-linea', texto: 'Cada tarjeta es un material: <b>cuánto hace falta</b>, para qué día y para qué tarea. La nota del técnico va al final.' },
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
            { sel: 'log-pedir', texto: 'Elige <b>proveedor</b>, <b>cuándo llega</b>, el <b>nº de pedido</b> y, si lo tienes, adjunta el PDF. Luego <b>🛒 Pedido</b>.', aviso: 'Al marcarlo como pedido se avisa al técnico y a logística, y el tablero comprueba si llega a tiempo para la tarea.' },
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
            ['<b>Sin planificar</b>', 'Ninguna tarea de la partida está todavía en el tablero: aún no hay fecha.'],
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
  ],
};
