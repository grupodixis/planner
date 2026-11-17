/* Graba el vídeo de ayuda «Revisar stock» sobre una copia de prueba (¡cambia datos: nunca contra producción!).
   S360_URL=http://localhost:3999 S360_PASS=… node grabar-logistica.js → webm; luego:
   ffmpeg -ss 1.2 -i X.webm -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p -movflags +faststart -an app/public/ayuda/logistica-revisar.mp4 */
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const login = await b.newContext();
  const lp = await login.newPage();
  await lp.goto((process.env.S360_URL || 'http://localhost:3999') + '/login.html');
  await lp.fill('input[type=email]', process.env.S360_EMAIL || 'admin@s360.local'); await lp.fill('input[type=password]', process.env.S360_PASS); await lp.click('button[type=submit]');
  await lp.waitForTimeout(800);
  const st = await login.storageState();
  // ya visto: que no salgan novedades ni pista en el vídeo
  const ctx = await b.newContext({ storageState: st, viewport: { width: 960, height: 600 }, recordVideo: { dir: '/tmp/pw/vid', size: { width: 960, height: 600 } } });
  await ctx.addInitScript(() => {
    try { localStorage.setItem('s360-ayuda', JSON.stringify({ novedades: 99, tours: { 'log-revisar': 9, 'log-pedir': 9 } })); localStorage.removeItem('log-acordeon'); } catch {}
    addEventListener('DOMContentLoaded', () => {
      const c = document.createElement('div');
      c.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;margin:-4px 0 0 -4px;pointer-events:none;left:-50px;top:-50px;transition:transform .1s';
      c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8-6 1.5L8 18z" fill="#fff" stroke="#000" stroke-width="1.4"/></svg>';
      document.body.append(c);
      addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
      addEventListener('mousedown', (e) => {
        const r = document.createElement('div');
        r.style.cssText = `position:fixed;z-index:99998;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #5aa9f0;pointer-events:none;transition:all .5s;opacity:1`;
        document.body.append(r); requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; }); setTimeout(() => r.remove(), 600);
      }, true);
      const cap = document.createElement('div'); cap.id = 'cap';
      cap.style.cssText = 'position:fixed;z-index:99997;left:50%;bottom:16px;transform:translateX(-50%);background:#202a35ee;border:1px solid #5aa9f0;color:#fff;font:600 17px system-ui;padding:9px 16px;border-radius:10px;display:none;max-width:90vw;text-align:center';
      document.body.append(cap);
    });
  });
  const p = await ctx.newPage();
  const cap = (t) => p.evaluate((t) => { const c = document.getElementById('cap'); c.textContent = t; c.style.display = t ? 'block' : 'none'; }, t);
  let pos = { x: 480, y: 300 };
  const ir = async (loc) => { await loc.scrollIntoViewIfNeeded(); const bb = await loc.boundingBox(); const x = bb.x + Math.min(bb.width / 2, 60), y = bb.y + bb.height / 2; await p.mouse.move(x, y, { steps: 22 }); pos = { x, y }; await p.waitForTimeout(250); };
  const pulsa = async (loc) => { await ir(loc); await p.mouse.down(); await p.mouse.up(); await loc.click({ trial: true }).catch(() => {}); };
  await p.goto((process.env.S360_URL || 'http://localhost:3999') + '/logistica.html?vista=todo'); await p.waitForTimeout(1200);
  await p.mouse.move(pos.x, pos.y);
  await cap('1 · Abre «Revisar stock»'); await p.waitForTimeout(600);
  const tab = p.locator('[data-ayuda=log-pestana-revisar]'); await ir(tab); await tab.click(); await p.waitForTimeout(1100);
  await cap('2 · Abre la partida'); await p.waitForTimeout(500);
  const sum = p.locator('[data-ayuda=log-partida]').first(); await ir(sum); await sum.click(); await p.waitForTimeout(1200);
  await cap('3 · Mira cuánto hace falta y para cuándo'); 
  const lin = p.locator('[data-ayuda=log-linea]').first(); await ir(lin.locator('.log-l2').first()); await p.waitForTimeout(1600);
  await cap('4 · Contesta: ¿hay en el almacén?');
  const hay = lin.locator('[data-ayuda=log-stock] button', { hasText: 'Hay todo' }); await ir(hay); await p.waitForTimeout(500); await hay.click(); await p.waitForTimeout(1400);
  await cap('… o escribe cuánto hay y pulsa ✓');
  const lin2 = p.locator('[data-ayuda=log-linea]').first(); const inp = lin2.locator('[data-ayuda=log-stock] input'); await ir(inp); await inp.click(); await p.keyboard.type('3', { delay: 200 }); await p.waitForTimeout(400);
  const ok = lin2.locator('[data-ayuda=log-stock] button.primario'); await ir(ok); await ok.click(); await p.waitForTimeout(1300);
  await cap('Lo que falta pasa a «Por pedir» y compras recibe el aviso'); await p.waitForTimeout(1400);
  const tc = p.locator('[data-ayuda=log-pestana-comprar]'); await ir(tc); await p.waitForTimeout(1800);
  await cap(''); await p.waitForTimeout(300);
  await ctx.close();
  console.log(await p.video().path());
  await b.close();
})();
