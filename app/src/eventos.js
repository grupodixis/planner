// Avisos en vivo entre usuarios (Server-Sent Events): cuando alguien guarda un cambio,
// el resto de pantallas abiertas lo recargan solas, sin tener que refrescar la página.
const clientes = new Set();
let version = 0;

const SIN_AVISO = /^\/api\/(login|logout|recuperar|restablecer|activar|eventos|pin\/entrar|pin\/alta-movil|archivos)/;

function emitir(datos) {
  version++;
  const msg = `id: ${version}\nevent: cambio\ndata: ${JSON.stringify({ v: version, ...datos })}\n\n`;
  for (const res of clientes) res.write(msg);
}

// Va antes de las rutas: tras cualquier cambio que salga bien, avisa a todos
function notificador(req, res, next) {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.path.startsWith('/api/') && !SIN_AVISO.test(req.path)) {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;
      emitir({
        ruta: req.path.split('/')[2] || '',
        pestana: String(req.get('X-S360-Pestana') || '').slice(0, 40),
        quien: req.usuario?.nombre || null,
      });
    });
  }
  next();
}

// Va después de exigir sesión
function montar(app) {
  app.get('/api/eventos', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',   // nginx (Plesk): no retener los mensajes
    });
    res.flushHeaders();
    res.write(`retry: 3000\nevent: hola\ndata: ${JSON.stringify({ v: version })}\n\n`);
    clientes.add(res);
    const latido = setInterval(() => res.write(': latido\n\n'), 25000);
    req.on('close', () => { clearInterval(latido); clientes.delete(res); });
  });
}

module.exports = { notificador, montar, emitir };
