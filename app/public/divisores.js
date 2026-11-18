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

  window.s360Divisores = { preparar };
})();
