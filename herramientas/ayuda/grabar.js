/* Graba los vídeos cortos de la ayuda (app/public/ayuda/*.mp4 + póster .jpg) sobre una COPIA DE PRUEBA.
   ¡Las escenas cambian datos (planifican, apuntan stock…): nunca contra el servidor de verdad!
   Uso: S360_URL=http://localhost:3999 S360_PASS=… [S360_PIN_NOMBRE='Juan Robles' S360_PIN=2580]
        node grabar.js [logistica|tablero|proyectos|midia …]   (sin nada: todas)
   Necesita ffmpeg. */
const { chromium, devices } = require('playwright');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const URL = process.env.S360_URL || 'http://localhost:3999';
const SALIDA = path.join(__dirname, '../../app/public/ayuda');
const EJEMPLO = path.join(__dirname, '../../docs/importacion/ejemplo.json');

// cursor visible, onda al pulsar y rótulo abajo (en el vídeo no se ve el ratón de verdad)
function decorado() {
  try { localStorage.setItem('s360-ayuda', JSON.stringify({ novedades: 999, tours: { 'log-revisar': 99, 'log-pedir': 99, 'tab-basico': 99, 'proy-basico': 99, 'md-basico': 99 } })); } catch { /* */ }
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;z-index:99999;width:22px;height:22px;margin:-4px 0 0 -4px;pointer-events:none;left:-50px;top:-50px';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 8-6 1.5L8 18z" fill="#fff" stroke="#000" stroke-width="1.4"/></svg>';
    document.body.append(c);
    const mover = (e) => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; };
    addEventListener('mousemove', mover, true);
    addEventListener('dragover', mover, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;z-index:99998;left:${e.clientX - 18}px;top:${e.clientY - 18}px;width:36px;height:36px;border-radius:50%;border:3px solid #5aa9f0;pointer-events:none;transition:all .5s`;
      document.body.append(r);
      requestAnimationFrame(() => { r.style.transform = 'scale(1.8)'; r.style.opacity = '0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
    const cap = document.createElement('div');
    cap.id = 'cap-video';
    cap.style.cssText = 'position:fixed;z-index:99997;left:50%;bottom:' + (innerWidth < 600 ? 92 : 16) + 'px;transform:translateX(-50%);background:#202a35ee;border:1px solid #5aa9f0;color:#fff;font:600 17px system-ui;padding:9px 16px;border-radius:10px;display:none;max-width:90vw;text-align:center';
    document.body.append(cap);
  });
}

function ayudantes(p) {
  return {
    cap: (t) => p.evaluate((t) => { const c = document.getElementById('cap-video'); if (!c) return; c.textContent = t; c.style.display = t ? 'block' : 'none'; }, t),
    ir: async (loc, dx = null) => {
      await loc.scrollIntoViewIfNeeded();
      const bb = await loc.boundingBox();
      await p.mouse.move(bb.x + (dx ?? Math.min(bb.width / 2, 60)), bb.y + bb.height / 2, { steps: 22 });
      await p.waitForTimeout(250);
    },
    espera: (ms) => p.waitForTimeout(ms),
  };
}

// se entra sin grabar y la sesión pasa al contexto que graba (así el vídeo empieza en la pantalla)
async function sesion(b, movil) {
  const ctx = await b.newContext(movil ? { ...devices['Pixel 7'] } : {});
  const p = await ctx.newPage();
  await p.goto(`${URL}/login.html`);
  await p.fill('input[type=email]', process.env.S360_EMAIL || 'admin@s360.local');
  await p.fill('input[type=password]', process.env.S360_PASS);
  await p.click('button[type=submit]');
  await p.waitForTimeout(900);
  if (movil) {
    // operario con PIN: autorizar este navegador y entrar como él
    await p.evaluate(() => fetch('/api/pin/dispositivos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"nombre":"Vídeo ayuda"}' }));
    await p.evaluate(() => fetch('/api/logout', { method: 'POST' }));
    await p.goto(`${URL}/pin.html`); await p.waitForTimeout(800);
    await p.click(`text=${process.env.S360_PIN_NOMBRE || 'Juan Robles'}`); await p.waitForTimeout(300);
    for (const c of process.env.S360_PIN) await p.keyboard.press(c);
    await p.waitForTimeout(1800);
  }
  const st = await ctx.storageState();
  await ctx.close();
  return st;
}

const ESCENAS = {
  async logistica(p) {
    const { cap, ir, espera } = ayudantes(p);
    await p.goto(`${URL}/logistica.html?vista=todo`); await espera(1200);
    await p.mouse.move(480, 300);
    await cap('1 · Abre «Revisar stock»'); await espera(600);
    const tab = p.locator('[data-ayuda=log-pestana-revisar]'); await ir(tab); await tab.click(); await espera(1100);
    await cap('2 · Abre la partida'); await espera(500);
    const sum = p.locator('[data-ayuda=log-partida]').first(); await ir(sum); await sum.click(); await espera(1200);
    await cap('3 · Mira cuánto hace falta y para cuándo');
    const lin = p.locator('[data-ayuda=log-linea]').first(); await ir(lin.locator('.log-l2').first()); await espera(1600);
    await cap('4 · Contesta: ¿hay en el almacén?');
    const hay = lin.locator('[data-ayuda=log-stock] button', { hasText: 'Hay todo' }); await ir(hay); await espera(500); await hay.click(); await espera(1400);
    await cap('… o escribe cuánto hay y pulsa ✓');
    const lin2 = p.locator('[data-ayuda=log-linea]').first(); const inp = lin2.locator('[data-ayuda=log-stock] input');
    await ir(inp); await inp.click(); await p.keyboard.type('3', { delay: 200 }); await espera(400);
    const ok = lin2.locator('[data-ayuda=log-stock] button.primario'); await ir(ok); await ok.click(); await espera(1300);
    await cap('Lo que falta pasa a «Por pedir» y compras recibe el aviso'); await espera(1400);
    await ir(p.locator('[data-ayuda=log-pestana-comprar]')); await espera(1800);
  },

  async tablero(p) {
    const { cap, ir, espera } = ayudantes(p);
    await p.goto(`${URL}/`); await espera(1800);
    await p.mouse.move(680, 400);
    await cap('1 · Busca la tarea en «Por planificar»'); await espera(800);
    const card = p.locator('.tarea-card').first(); await ir(card); await espera(900);
    // la fila de un área libre del calendario, hacia las 9:00
    const fila = p.locator('#cal-body .fila').nth(2);
    await fila.scrollIntoViewIfNeeded();
    await card.scrollIntoViewIfNeeded();
    const a = await card.boundingBox();
    await cap('2 · Arrástrala al área y la hora'); await espera(300);
    await p.mouse.move(a.x + 40, a.y + a.height / 2, { steps: 8 });
    await p.mouse.down();
    const f = await fila.boundingBox();
    const destino = { x: f.x + f.width * 0.32, y: f.y + f.height / 2 };
    await p.mouse.move(destino.x, destino.y, { steps: 35 });
    await espera(300);
    await p.mouse.up(); await espera(1200);
    await p.keyboard.press('Escape'); await espera(500); // se abre el detalle: se cierra para seguir
    await cap('3 · Arrastra una persona encima del tramo'); await espera(400);
    const rec = p.locator('.rec:not(.ausente)').first(); await ir(rec, 30);
    const r = await rec.boundingBox();
    await p.mouse.down();
    await p.mouse.move(destino.x + 30, destino.y, { steps: 35 });
    await espera(300);
    await p.mouse.up(); await espera(1200);
    await p.keyboard.press('Escape'); await espera(400);
    await cap('4 · Revisa los avisos y pulsa «Solucionar» si sale alguno');
    await ir(p.locator('#conflictos')); await espera(2200);
    await cap('');
  },

  async proyectos(p) {
    const { cap, ir, espera } = ayudantes(p);
    // copia del ejemplo con otra referencia: la vista previa enseña lo que se crearía
    const tmp = path.join(require('os').tmpdir(), 'PRES-2026-0099.s360.json');
    const j = JSON.parse(fs.readFileSync(EJEMPLO, 'utf8').replaceAll('PRES-2026-0061', 'PRES-2026-0099'));
    delete j.proyecto.codigo;
    fs.writeFileSync(tmp, JSON.stringify(j));
    await p.goto(`${URL}/proyectos.html`); await espera(1500);
    await p.mouse.move(600, 300);
    await cap('1 · Pulsa «Importar…»'); await espera(500);
    const b = p.locator('#btn-importar'); await ir(b); await b.click(); await espera(900);
    await cap('2 · Arrastra el archivo del compositor'); await ir(p.locator('#imp-soltar')); await espera(700);
    await p.setInputFiles('#imp-archivo', tmp); await espera(2200);
    await cap('3 · Vista previa: qué se va a crear'); await espera(2200);
    await p.evaluate(() => document.querySelector('#imp-informe')?.scrollBy({ top: 260, behavior: 'smooth' })); await espera(1600);
    await cap('Los nombres que no coinciden: crear, asociar o ignorar');
    await p.evaluate(() => document.querySelector('.dlg-importar')?.scrollBy({ top: 400, behavior: 'smooth' })); await espera(2200);
    await cap('4 · Pulsa «Importar»: entra todo de una vez');
    await ir(p.locator('#imp-confirmar')); await espera(2200);
    await cap('');
    fs.unlinkSync(tmp);
  },

  async midia(p, b) {
    if (!process.env.S360_PIN) throw new Error('midia: falta S360_PIN');
    const { cap, ir, espera } = ayudantes(p);
    await p.goto(`${URL}/mi-dia.html`); await espera(1500);
    for (let i = 0; i < 6 && !(await p.locator('.md-tramo.pendiente').count()); i++) { await p.click('#dia-ant'); await espera(900); }
    await p.mouse.move(200, 300);
    await cap('Tu trabajo: hora, área y con quién'); await espera(400);
    const t = p.locator('.md-tramo.pendiente').first(); await ir(t.locator('.md-t-tarea')); await espera(1800);
    const ll = t.locator('.md-ll-check input');
    if (await ll.count()) { await cap('Marca el material y las herramientas'); await ir(ll.first()); await ll.first().click(); await espera(1400); }
    await cap('Al acabar: ¿cómo fue?');
    const h = t.locator('.md-botones button').first(); await ir(h); await espera(400); await h.click(); await espera(1200);
    await cap('¿Queda terminada la tarea?');
    const si = p.locator('.md-tramo').first().locator('.md-sino button', { hasText: 'No, sigue' });
    if (await si.count()) { await ir(si); await si.click(); await espera(1300); }
    await cap('Cuando esté todo: «Enviar mi día»');
    await ir(p.locator('#enviar')); await espera(2000);
    await cap('');
  },
};

(async () => {
  const pedir = process.argv.slice(2);
  const escenas = pedir.length ? pedir : Object.keys(ESCENAS);
  const b = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  fs.mkdirSync(SALIDA, { recursive: true });
  for (const nombre of escenas) {
    const movil = nombre === 'midia';
    const tam = movil ? { width: 390, height: 760 } : nombre === 'tablero' ? { width: 1280, height: 720 } : { width: 960, height: 600 };
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'ayuda-video-'));
    const storageState = await sesion(b, movil);
    const ctx = await b.newContext({ ...(movil ? devices['Pixel 7'] : {}), storageState, viewport: tam, deviceScaleFactor: movil ? 2 : 1, recordVideo: { dir, size: tam } });
    await ctx.addInitScript(decorado);
    const p = await ctx.newPage();
    const inicio = Date.now();
    await ESCENAS[nombre](p, b);
    const video = p.video();
    await ctx.close();
    const webm = await video.path();
    const archivo = { logistica: 'logistica-revisar', tablero: 'tablero-planificar', proyectos: 'proyectos-importar', midia: 'mi-dia' }[nombre];
    const mp4 = path.join(SALIDA, `${archivo}.mp4`);
    // fuera el arranque (login y carga), que no aporta
    const corte = 1.2;
    spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', String(corte), '-i', webm, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4], { stdio: 'inherit' });
    spawnSync('ffmpeg', ['-loglevel', 'error', '-y', '-ss', '3', '-i', mp4, '-frames:v', '1', '-q:v', '5', mp4.replace(/\.mp4$/, '.jpg')], { stdio: 'inherit' });
    console.log(`✔ ${archivo}.mp4 (${Math.round((Date.now() - inicio) / 1000)} s de grabación)`);
  }
  await b.close();
})();
