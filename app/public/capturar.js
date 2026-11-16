/* Capturar desde la oficina o la obra (usuarios con email), y los asuntos que tengo a mi cargo */
(() => {
  'use strict';
  const $ = (s) => document.querySelector(s);
  const { api } = window.s360;
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (v != null && v !== false) n.setAttribute(k, v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  let toastT;
  function toast(msg, error) {
    const t = $('#toast');
    t.textContent = msg; t.className = `toast ver${error ? ' error' : ''}`;
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = 'toast'; }, 3000);
  }

  async function cargarAsuntos() {
    const d = await api('GET', '/api/capturas?vista=mios');
    $('#mis-asuntos-panel').hidden = !d.capturas.length;
    $('#mis-asuntos').replaceChildren(...d.capturas.map((c) => el('li', { class: `cap-mia prio-${c.prioridad}` },
      el('div', { class: 'cap-mia-cab' },
        c.prioridad === 'alta' ? el('b', { class: 'prio-alta' }, '¡Prioridad alta!') : null,
        c.categoria ? el('b', {}, d.categorias[c.categoria]) : null,
        el('span', {}, `de ${c.autor || '—'}`),
        c.fecha_limite ? el('span', { class: 'cap-estado' }, `para el ${new Date(`${c.fecha_limite}T12:00:00`).toLocaleDateString('es-ES')}`) : null),
      c.texto ? el('div', {}, c.texto) : null,
      window.s360.adjuntos(c.archivos),
      c.proyecto_codigo || c.orden_codigo ? el('div', { class: 'ayuda' }, [c.proyecto_codigo, c.orden_codigo].filter(Boolean).join(' · ')) : null,
      c.nota ? el('div', { class: 'ayuda' }, `Nota: ${c.nota}`) : null,
      el('button', { type: 'button', class: 'primario mini', onclick: async () => {
        const r = prompt('¿Cómo se ha resuelto? (lo verá quien lo capturó)');
        if (r === null) return;
        try { await api('POST', `/api/capturas/${c.id}/resolver`, { resolucion: r }); toast('Asunto resuelto'); cargarAsuntos(); window.s360.refrescarPendientes(); }
        catch (e) { toast(e.message, true); }
      } }, 'Resuelto'))));
  }

  async function init() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    window.s360pwa?.boton($('#instalar'));
    const cap = window.Captura.montar($('#captura'), { toast });
    await cargarAsuntos().catch((e) => toast(e.message, true));
    window.s360.alCambiar(() => Promise.all([cargarAsuntos(), cap.recargar()]));
  }
  init();
})();
