/* Comprueba la ayuda contra la aplicación de verdad (copia de prueba): en cada pantalla con ayuda
   abre el «?» y ejecuta todos sus recorridos de principio a fin. Avisa de los pasos que se saltan
   porque su elemento no aparece (botón movido, renombrado o quitado).
   Los pasos «hazlo tú» se hacen (están pensados para no cambiar datos); el resto solo se miran.
   Uso: S360_URL=http://localhost:3999 S360_PASS=… [S360_PIN_NOMBRE='Juan Robles' S360_PIN=2580] node comprobar.js */
const { chromium, devices } = require('playwright');
const URL = process.env.S360_URL || 'http://localhost:3999';

async function recorrer(p, tour) {
  await p.evaluate((id) => {
    document.querySelector('.ay-pista')?.remove();
    const pant = window.S360_AYUDA.pantallas[location.pathname === '/index.html' ? '/' : location.pathname];
    window.__pasos = [];
    window.s360ayuda.recorrido(pant.recorridos.find((r) => r.id === id));
  }, tour.id);
  for (let guard = 0; guard < 60; guard++) {
    await p.waitForTimeout(900);
    const info = await p.evaluate(() => {
      const b = document.querySelector('.ay-burbuja');
      if (!b) return null;
      const m = b.querySelector('small')?.textContent.match(/(\d+) de (\d+)/);
      return { n: m ? Number(m[1]) : 0, tu: !!b.querySelector('.ay-b-tu'), escribir: /Escribe/.test(b.querySelector('.ay-b-tu')?.textContent || '') };
    });
    if (!info) break;
    if (info.tu) {
      // lo hace «él»: pulsar o escribir en lo resaltado
      const r = await p.evaluate(() => { const f = document.querySelector('.ay-foco').getBoundingClientRect(); return { x: f.left + f.width / 2, y: f.top + f.height / 2 }; });
      if (info.escribir) await p.keyboard.type('a');
      else await p.mouse.click(r.x, r.y);
      await p.waitForTimeout(1300);
      const otra = await p.evaluate((n) => { const m = document.querySelector('.ay-burbuja small')?.textContent.match(/(\d+) de/); return !m || Number(m[1]) !== n; }, info.n);
      if (!otra) await p.click('.ay-b-pie button:last-child'); // no avanzó: saltar
    } else {
      await p.click('.ay-b-pie .primario');
    }
  }
  // pasos saltados: «no-esta» = su elemento no aparece (problema, salvo los marcados opcional)
  const saltos = await p.evaluate((id) => (window.__ayudaSaltos || []).filter((x) => x.tour === id), tour.id);
  return { saltos };
}

(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1366, height: 860 } });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(`${p.url()}: ${e.message}`));
  await p.goto(`${URL}/login.html`);
  await p.fill('input[type=email]', process.env.S360_EMAIL || 'admin@s360.local');
  await p.fill('input[type=password]', process.env.S360_PASS);
  await p.click('button[type=submit]');
  await p.waitForTimeout(800);
  // que no salgan novedades ni pistas mientras se comprueba; registrar los pasos que se muestran
  await ctx.addInitScript(() => {
    try { localStorage.setItem('s360-ayuda', JSON.stringify({ novedades: 999 })); } catch { /* */ }
  });
  const partida = await p.evaluate(async () => {
    const r = await fetch('/api/material/circuito').then((x) => x.json()).catch(() => ({}));
    return r.lineas?.[0]?.partida_id || null;
  });
  const pantallas = await p.evaluate(async () => {
    await new Promise((ok) => setTimeout(ok, 300));
    return Object.entries(window.S360_AYUDA?.pantallas || {}).map(([k, v]) => ({ ruta: k, tours: (v.recorridos || []).map((r) => ({ id: r.id, pasos: r.pasos.map((x) => x.sel || null) })) }));
  });
  if (!pantallas.length) {
    await p.goto(`${URL}/logistica.html`); await p.waitForTimeout(800);
  }
  const lista = pantallas.length ? pantallas : await p.evaluate(() => Object.entries(window.S360_AYUDA.pantallas).map(([k, v]) => ({ ruta: k, tours: (v.recorridos || []).map((r) => ({ id: r.id, pasos: r.pasos.map((x) => x.sel || null) })) })));
  let malos = 0;
  const informar = (que, total, saltos, boton) => {
    const malosAqui = saltos.filter((x) => x.motivo === 'no-esta' && !x.opcional);
    const info = saltos.filter((x) => !malosAqui.includes(x)).map((x) => `${x.paso}${x.motivo === 'ya-hecho' ? ' ya hecho' : ' sin datos'}`);
    const ok = !malosAqui.length && boton;
    if (!ok) malos++;
    console.log(`${ok ? '✔' : '✗'} ${que}: ${total - saltos.length}/${total} pasos${info.length ? ` (saltados: ${info.join(', ')})` : ''}${boton ? '' : ' · ¡sin botón «?»!'}`);
    for (const x of malosAqui) console.log(`   ✗ paso ${x.paso}: no aparece «${x.sel}»`);
  };
  for (const pant of lista) {
    if (pant.ruta === '/mi-dia.html') continue; // con PIN, abajo
    const ruta = pant.ruta === '/asignar.html' ? `${pant.ruta}?partida=${partida}` : pant.ruta;
    for (const t of pant.tours) {
      await p.goto(`${URL}${ruta}`); await p.waitForTimeout(1600);
      const boton = await p.locator('#btn-ayuda').count();
      const { saltos } = await recorrer(p, t);
      informar(`${ruta} · ${t.id}`, t.pasos.length, saltos, boton);
    }
  }
  // Mi día (operario con PIN)
  if (process.env.S360_PIN) {
    const m = await b.newContext({ ...devices['Pixel 7'] });
    await m.addInitScript(() => { try { localStorage.setItem('s360-ayuda', JSON.stringify({ novedades: 999, tours: { 'md-basico': 99 } })); } catch { /* */ }
    });
    const q = await m.newPage();
    q.on('pageerror', (e) => errores.push(`mi-dia: ${e.message}`));
    await q.goto(`${URL}/login.html`);
    await q.fill('input[type=email]', process.env.S360_EMAIL || 'admin@s360.local'); await q.fill('input[type=password]', process.env.S360_PASS); await q.click('button[type=submit]');
    await q.waitForTimeout(700);
    await q.evaluate(() => fetch('/api/pin/dispositivos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"nombre":"Comprobar ayuda"}' }));
    await q.evaluate(() => fetch('/api/logout', { method: 'POST' }));
    await q.goto(`${URL}/pin.html`); await q.waitForTimeout(800);
    await q.click(`text=${process.env.S360_PIN_NOMBRE || 'Juan Robles'}`); await q.waitForTimeout(300);
    for (const c of process.env.S360_PIN) await q.keyboard.press(c);
    await q.waitForTimeout(1800);
    // buscar un día con trabajo
    for (let i = 0; i < 6 && !(await q.locator('.md-tramo').count()); i++) { await q.click('#dia-sig'); await q.waitForTimeout(900); }
    const tours = lista.find((x) => x.ruta === '/mi-dia.html')?.tours || [];
    for (const t of tours) {
      const { saltos } = await recorrer(q, t);
      informar(`/mi-dia.html · ${t.id}`, t.pasos.length, saltos, true);
    }
    // y el «?» del menú
    await q.click('#md-menu-btn'); await q.waitForTimeout(400);
    await q.locator('.md-menu-op', { hasText: 'Ayuda' }).click(); await q.waitForTimeout(600);
    const panel = await q.locator('.ay-panel').count();
    if (!panel) malos++;
    console.log(`${panel ? '✔' : '✗'} /mi-dia.html · Menú › Ayuda abre el panel`);
  }
  if (errores.length) { malos += errores.length; console.log('Errores de la página:\n ', errores.join('\n  ')); }
  console.log(malos ? `\n${malos} problema(s)` : '\nTodo en orden');
  await b.close();
  process.exit(malos ? 1 : 0);
})();
