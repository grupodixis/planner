/* Divisores para cambiar el ancho de los paneles de una pantalla en columnas (Proyectos, Recursos…).
   Se arrastra la raya entre dos paneles (o flechas con el foco; doble clic = ancho normal).
   El ancho elegido se recuerda en este navegador. La columna i se controla con la variable CSS --col-i
   en el contenedor; la última columna se queda con lo que sobra.
   Uso: s360Divisores.preparar(main, { clave: 'proyectos', columnas: [{ def: 260, min: 200 }, { min: 300 }], restoMin: 420, desde: 1201 }) */
(() => {
  'use strict';
  const leer = (k) => { try { return Number(localStorage.getItem(k)) || null; } catch { return null; } };
  const guardar = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, String(v)); } catch { /* sin almacenamiento */ } };

  function preparar(main, op) {
    if (!main || main.dataset.divisores) return;
    main.dataset.divisores = '1';
    const paneles = () => [...main.children].filter((n) => !n.classList.contains('divisor') && !n.hidden && getComputedStyle(n).display !== 'none');
    const activo = () => matchMedia(`(min-width: ${op.desde || 0}px)`).matches;
    const clave = (i) => `s360-ancho-${op.clave}-${i}`;
    const ancho = (i) => paneles()[i]?.getBoundingClientRect().width || 0;
    const gap = () => parseFloat(getComputedStyle(main).columnGap) || 16;

    const poner = (i, v, guardarlo) => {
      const ps = paneles();
      // lo que queda para el resto de columnas no baja de su mínimo
      const otros = ps.slice(0, op.columnas.length).reduce((s, p, j) => s + (j === i ? 0 : p.getBoundingClientRect().width), 0);
      const max = main.clientWidth - otros - (op.restoMin || 320) - gap() * ps.length - 40;
      v = Math.round(Math.max(op.columnas[i].min || 180, Math.min(v, max)));
      main.style.setProperty(`--col-${i}`, `${v}px`);
      if (guardarlo) guardar(clave(i), v);
      colocar();
      return v;
    };
    const normal = (i) => { main.style.removeProperty(`--col-${i}`); guardar(clave(i), null); colocar(); };

    const divs = op.columnas.map((c, i) => {
      const d = document.createElement('div');
      d.className = 'divisor divisor-gen';
      d.setAttribute('role', 'separator'); d.setAttribute('tabindex', '0'); d.setAttribute('aria-orientation', 'vertical');
      d.setAttribute('aria-label', c.titulo || 'Ancho del panel');
      d.title = `${c.titulo || 'Ancho del panel'}: arrastra para ajustar · doble clic para volver al ancho normal`;
      d.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const x0 = ev.clientX, w0 = ancho(i);
        d.setPointerCapture(ev.pointerId);
        d.classList.add('activo'); document.body.classList.add('redimensionando');
        const mover = (e) => poner(i, w0 + e.clientX - x0, false);
        const soltar = (e) => {
          poner(i, w0 + e.clientX - x0, true);
          d.classList.remove('activo'); document.body.classList.remove('redimensionando');
          d.removeEventListener('pointermove', mover); d.removeEventListener('pointerup', soltar); d.removeEventListener('pointercancel', soltar);
        };
        d.addEventListener('pointermove', mover); d.addEventListener('pointerup', soltar); d.addEventListener('pointercancel', soltar);
      });
      d.addEventListener('dblclick', () => normal(i));
      d.addEventListener('keydown', (ev) => {
        const paso = ev.shiftKey ? 64 : 16;
        if (ev.key === 'Home') { ev.preventDefault(); normal(i); return; }
        const dx = ev.key === 'ArrowRight' ? paso : ev.key === 'ArrowLeft' ? -paso : 0;
        if (!dx) return;
        ev.preventDefault();
        poner(i, ancho(i) + dx, true);
      });
      main.append(d);
      return d;
    });

    // la raya va en el hueco entre el panel i y el siguiente
    function colocar() {
      const on = activo();
      const ps = paneles();
      const mr = main.getBoundingClientRect();
      divs.forEach((d, i) => {
        const p = ps[i];
        d.hidden = !on || !p || !ps[i + 1];
        if (d.hidden) return;
        const r = p.getBoundingClientRect();
        d.style.left = `${r.right - mr.left + gap() / 2 - 7 + main.scrollLeft}px`;
        d.style.top = `${r.top - mr.top}px`;
        d.style.height = `${r.height}px`;
      });
    }

    op.columnas.forEach((c, i) => { const v = leer(clave(i)); if (v) main.style.setProperty(`--col-${i}`, `${v}px`); });
    new ResizeObserver(colocar).observe(main);
    addEventListener('resize', colocar);
    // los paneles cambian de alto al cargar contenido
    for (const p of paneles()) new ResizeObserver(colocar).observe(p);
    colocar();
  }

  /* Columnas de una tabla (table-layout: fixed con <colgroup>): asa en el borde derecho de cada
     cabecera con data-ancho; la columna sin ancho (la del nombre) se queda con lo que sobra. */
  function columnas(tabla, clave) {
    if (!tabla || tabla.dataset.columnas) return;
    tabla.dataset.columnas = '1';
    const cols = [...tabla.querySelectorAll('colgroup col')];
    const ths = [...tabla.querySelectorAll('thead th')];
    ths.forEach((th, i) => {
      const col = cols[i];
      if (!col || !th.hasAttribute('data-ancho')) return;
      const k = `s360-col-${clave}-${i}`;
      const v = leer(k);
      if (v) col.style.width = `${v}px`;
      const asa = document.createElement('span');
      asa.className = 'col-asa';
      asa.setAttribute('role', 'separator'); asa.setAttribute('tabindex', '0'); asa.setAttribute('aria-orientation', 'vertical');
      asa.setAttribute('aria-label', `Ancho de la columna ${th.textContent.trim()}`);
      asa.title = 'Arrastra para cambiar el ancho · doble clic: ancho normal';
      const min = Number(th.dataset.ancho) || 40;
      const poner = (w, g) => { w = Math.round(Math.max(min, Math.min(w, 700))); col.style.width = `${w}px`; if (g) guardar(k, w); };
      asa.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        const x0 = ev.clientX, w0 = th.getBoundingClientRect().width;
        asa.setPointerCapture(ev.pointerId);
        asa.classList.add('activo'); document.body.classList.add('redimensionando');
        const mover = (e) => poner(w0 + e.clientX - x0, false);
        const soltar = (e) => {
          poner(w0 + e.clientX - x0, true);
          asa.classList.remove('activo'); document.body.classList.remove('redimensionando');
          asa.removeEventListener('pointermove', mover); asa.removeEventListener('pointerup', soltar); asa.removeEventListener('pointercancel', soltar);
        };
        asa.addEventListener('pointermove', mover); asa.addEventListener('pointerup', soltar); asa.addEventListener('pointercancel', soltar);
      });
      asa.addEventListener('dblclick', () => { col.style.width = ''; guardar(k, null); });
      asa.addEventListener('keydown', (ev) => {
        const dx = ev.key === 'ArrowRight' ? 8 : ev.key === 'ArrowLeft' ? -8 : 0;
        if (!dx) return;
        ev.preventDefault();
        poner(th.getBoundingClientRect().width + dx * (ev.shiftKey ? 4 : 1), true);
      });
      th.classList.add('con-asa');
      th.append(asa);
    });
  }

  window.s360Divisores = { preparar, columnas };
})();
