/* Textos de la ayuda de s360. Una entrada por pantalla (por su ruta) y la lista de novedades.
   Regla: cada funcionalidad nueva añade aquí su ayuda, su paso de recorrido si hace falta y su novedad.
   - si: permiso(s) que lo ven (vacío = todos)
   - recorridos[].pasos[].sel: marca data-ayuda="…" (o selector CSS). esperar: 'click' | 'escribir' (lo hace él)
   - version: súbela si el recorrido cambia de verdad; quien ya lo vio recibe un aviso para repetirlo */
window.S360_AYUDA = {
  pantallas: {
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
            { sel: 'log-acc-barra', texto: 'Con muchas partidas: <b>Abrir todas</b> o <b>Cerrar todas</b>. Lo que dejas abierto se recuerda.' },
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
    { id: 4, fecha: '2026-11-17', titulo: 'Ayuda en cada pantalla', texto: 'Pulsa <b>?</b> arriba a la derecha: qué se hace en la pantalla, un vídeo corto y un recorrido guiado en el que lo haces tú. De momento está en <b>Material de las partidas</b>; irá llegando al resto.' },
  ],
};
