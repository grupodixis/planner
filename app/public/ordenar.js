// Reordenar filas de una tabla arrastrando su asa (⠿).
// Uso:  fila: <tr data-id="…"> con asaOrden('Nombre') en una celda
//       ordenArrastrable(tbody, async (ids) => { …guardar el nuevo orden… })
// Teclado: con el asa enfocada, ↑ / ↓ mueve la fila.
(function () {
  function asaOrden(nombre) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'asa-orden';
    b.textContent = '⠿';
    b.title = 'Arrastra para cambiar el orden (o ↑ / ↓ con el teclado)';
    b.setAttribute('aria-label', `Mover ${nombre} (flechas arriba y abajo)`);
    return b;
  }

  function ordenArrastrable(tbody, alCambiar) {
    if (tbody._orden) tbody._orden.abort();
    const ctl = new AbortController();
    tbody._orden = ctl;
    const op = { signal: ctl.signal };
    const filas = () => [...tbody.querySelectorAll(':scope > tr[data-id]')];
    const ids = () => filas().map((tr) => Number(tr.dataset.id));
    let arrastrada = null, antes = null;

    const terminar = async () => {
      if (!arrastrada) return;
      arrastrada.classList.remove('arrastrando');
      arrastrada.draggable = false;
      arrastrada = null;
      tbody.classList.remove('ordenando');
      const ahora = ids();
      if (antes && ahora.join() !== antes.join()) await alCambiar(ahora);
      antes = null;
    };

    // Solo se arrastra desde el asa (así se puede seguir escribiendo y seleccionando en los campos)
    tbody.addEventListener('pointerdown', (ev) => {
      const asa = ev.target.closest('.asa-orden');
      if (!asa) return;
      const tr = asa.closest('tr[data-id]');
      if (tr) tr.draggable = true;
    }, op);
    tbody.addEventListener('pointerup', (ev) => {
      const tr = ev.target.closest('tr[data-id]');
      if (tr && !arrastrada) tr.draggable = false;
    }, op);
    tbody.addEventListener('dragstart', (ev) => {
      const tr = ev.target.closest?.('tr[data-id]');
      if (!tr || !tr.draggable) return;
      arrastrada = tr;
      antes = ids();
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', tr.dataset.id);
      try { ev.dataTransfer.setDragImage(tr, 20, tr.offsetHeight / 2); } catch { /* sin imagen propia */ }
      requestAnimationFrame(() => { tr.classList.add('arrastrando'); tbody.classList.add('ordenando'); });
    }, op);
    tbody.addEventListener('dragover', (ev) => {
      if (!arrastrada) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      // la fila se coloca antes de la primera cuyo centro queda por debajo del puntero
      const otras = filas().filter((tr) => tr !== arrastrada);
      const sig = otras.find((tr) => { const r = tr.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; });
      if (sig) { if (arrastrada.nextElementSibling !== sig) tbody.insertBefore(arrastrada, sig); }
      else if (otras.length) {
        const ultima = otras[otras.length - 1];
        if (ultima.nextElementSibling !== arrastrada) ultima.after(arrastrada);
      }
    }, op);
    tbody.addEventListener('drop', (ev) => { if (arrastrada) ev.preventDefault(); }, op);
    tbody.addEventListener('dragend', terminar, op);

    tbody.addEventListener('keydown', async (ev) => {
      const asa = ev.target.closest('.asa-orden');
      if (!asa || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
      ev.preventDefault();
      const tr = asa.closest('tr[data-id]');
      const lista = filas();
      const i = lista.indexOf(tr), j = i + (ev.key === 'ArrowUp' ? -1 : 1);
      if (j < 0 || j >= lista.length) return;
      if (j < i) tbody.insertBefore(tr, lista[j]); else lista[j].after(tr);
      const id = tr.dataset.id;
      await alCambiar(ids());
      tbody.querySelector(`tr[data-id="${id}"] .asa-orden`)?.focus();
    }, op);
  }

  window.asaOrden = asaOrden;
  window.ordenArrastrable = ordenArrastrable;
})();
