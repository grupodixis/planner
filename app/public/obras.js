/* Obras: una dirección que reúne proyectos (de uno o varios clientes). Ficha con sus datos (opcionales salvo nombre y
   dirección), sus proyectos, lo próximo planificado y las incidencias abiertas. «Sin obra»: los proyectos sin obra. */
(() => {
  'use strict';
  const { el, toast, campo, pantalla, pedir, dia, hh, api } = window.fichas;

  pantalla({
    filtros: [['activas', (r) => `Activas ${r.activas}`], ['sin_activo', 'Sin proyecto activo'], ['todas', (r) => `Todas ${r.total}`]],
    async cargarLista(q, filtro) {
      const r = await api('GET', `/api/obras?vista=${filtro}&q=${encodeURIComponent(q)}`);
      return {
        items: r.obras, activas: r.activas, total: r.total,
        extra: r.sin_obra.n ? el('li', { class: 'fc-item fc-sin', tabindex: 0, onclick: () => { history.replaceState(null, '', '?id=sin'); location.reload(); } },
          el('b', {}, '— Sin obra —'), el('small', {}, 'proyectos de taller / venta'), el('span', { class: 'fc-chips' }, el('span', { class: 'fc-chip' }, `${r.sin_obra.n} proyecto${r.sin_obra.n > 1 ? 's' : ''}`))) : null,
      };
    },
    item: (o) => el('li', {},
      el('b', {}, o.nombre), el('small', {}, [o.direccion, o.clientes].filter(Boolean).join(' · ')),
      el('span', { class: 'fc-chips' },
        o.activos ? el('span', { class: 'fc-chip v' }, `${o.activos} activo${o.activos > 1 ? 's' : ''}`) : el('span', { class: 'fc-chip' }, o.proyectos ? `${o.proyectos} proyecto${o.proyectos > 1 ? 's' : ''} · terminada` : 'sin proyectos'),
        o.incidencias ? el('span', { class: 'fc-chip a' }, `⚠ ${o.incidencias}`) : null)),
    cargar: (id) => api('GET', `/api/obras/${id}`),
    async nueva() {
      const v = await pedir('Nueva obra', [['nombre', 'Nombre (p. ej. Villa Binibeca)', { maxlength: 120 }], ['direccion', 'Dirección *', { maxlength: 300, required: true }]]);
      if (!v) return null;
      try { const o = await api('POST', '/api/obras', v); toast('Obra creada'); return o.id; } catch (e) { toast(e.message, true); return null; }
    },
    pintar(o, { editar, recargar, ir }) {
      const guardar = async (k, v) => { await api('PUT', `/api/obras/${o.id}`, { [k]: v }); if (['nombre', 'direccion', 'localidad'].includes(k)) recargar(); };
      const c = (k, etiqueta, extra = {}) => campo({ k, etiqueta, valor: o[k], editar, guardar, ...extra });
      const mapa = o.direccion ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.direccion)}` : null;
      const nuevoProyecto = async () => {
        const v = await pedir(`Nuevo proyecto en ${o.nombre}`, [['nombre', 'Nombre del proyecto *', { maxlength: 120, required: true }]]);
        if (!v) return;
        try { const p = await api('POST', '/api/proyectos', { nombre: v.nombre, obra_id: o.id }); location.href = `/proyectos.html?p=${p.id}`; } catch (e) { toast(e.message, true); }
      };
      const datos = o.sin_obra ? null : el('section', { class: 'panel fc-datos' },
        el('div', { class: 'fc-cab' }, el('h2', {}, o.nombre), el('span', { class: 'ayuda' }, o.proyectos.some((p) => p.estado === 'activo') ? '· activa (sale en el tablero)' : '· sin proyectos activos'),
          editar && !o.proyectos.length ? el('button', { type: 'button', class: 'ghost borrar mini', onclick: async () => {
            if (!confirm(`¿Borrar la obra «${o.nombre}»?`)) return;
            try { await api('DELETE', `/api/obras/${o.id}`); toast('Obra borrada'); ir(null); } catch (e) { toast(e.message, true); }
          } }, 'Borrar') : null),
        el('div', { class: 'ficha fc-campos' },
          c('nombre', 'Nombre', { ancho: 'c1', obligatorio: true, max: 120 }), c('direccion', 'Dirección', { ancho: 'c2', obligatorio: true }),
          c('localidad', 'Localidad', { ancho: 'c1', max: 80 }), c('contacto', 'Contacto en obra', { ancho: 'c1', max: 120 }), c('telefono', 'Teléfono', { ancho: 'c1', max: 60, tipo: 'tel' }),
          c('acceso', 'Acceso y horario', { ancho: 'c3', ayuda: 'Por dónde se entra, horario, limitaciones (grúa, carga…): lo ven las subcontratas en su enlace' }),
          c('promotor', 'Promotor', { ancho: 'c1', max: 160 }), c('direccion_facultativa', 'Dirección facultativa', { ancho: 'c1', max: 160 }), c('constructora', 'Constructora', { ancho: 'c1', max: 160 }),
          c('notas', 'Notas', { ancho: 'c3', filas: 2, max: 2000 })));
      const proys = el('section', { class: 'panel' },
        el('div', { class: 'fc-cab' }, el('h3', {}, o.sin_obra ? 'Proyectos sin obra' : 'Proyectos en esta obra'),
          editar && !o.sin_obra ? el('button', { type: 'button', class: 'primario mini', onclick: nuevoProyecto }, '＋ Nuevo proyecto aquí') : null),
        o.proyectos.length ? el('table', { class: 'fc-tabla' },
          el('thead', {}, el('tr', {}, el('th', {}, 'Proyecto'), el('th', {}, 'Cliente'), el('th', {}, 'OTs'), el('th', {}, 'Entrega'), el('th', {}, 'Avance'), el('th', {}, 'Estado'))),
          el('tbody', {}, o.proyectos.map((p) => el('tr', {},
            el('td', {}, el('a', { href: `/proyectos.html?p=${p.id}` }, el('b', {}, p.codigo), ` · ${p.nombre}`)),
            el('td', {}, p.cliente_id ? el('a', { href: `/clientes.html?id=${p.cliente_id}` }, p.cliente) : (p.cliente || '—')),
            el('td', { class: 'num' }, p.ots ? `${p.ots}${p.ots_abiertas !== p.ots ? ` (${p.ots_abiertas} abiertas)` : ''}` : '—'),
            el('td', {}, p.entrega ? dia(p.entrega) : '—'),
            el('td', {}, window.s360.chipAvance?.(p.avance, { compacto: false }) || '—'),
            el('td', {}, el('span', { class: `fc-chip ${p.estado === 'activo' ? 'v' : ''}` }, p.estado)))))) : el('p', { class: 'ayuda' }, 'Aún no tiene proyectos.'));
      const lado = o.sin_obra ? null : el('div', { class: 'fc-lado' },
        el('section', { class: 'panel' }, el('h3', {}, '📍 Ubicación'), el('p', {}, o.direccion),
          mapa ? el('a', { class: 'boton ghost', href: mapa, target: '_blank', rel: 'noopener' }, 'Abrir en Google Maps ↗') : null),
        el('section', { class: 'panel' }, el('h3', {}, '📅 Próximo en esta obra'),
          o.proximo.length ? el('ul', { class: 'fc-prox' }, o.proximo.map((x) => el('li', {},
            el('b', {}, dia(x.fecha)), ` · ${hh(x.desde)}–${hh(x.hasta)} · `, el('span', { class: 'cod' }, x.codigo), ` ${x.nombre}`,
            el('small', {}, [x.area, x.proveedor ? `${x.ext_en_obra ? '🏗' : '🏭'} ${x.proveedor}` : null, x.gente].filter(Boolean).join(' · '))))) : el('p', { class: 'ayuda' }, 'Nada planificado de hoy en adelante.')),
        el('section', { class: 'panel' }, el('h3', {}, '⚠ Incidencias abiertas'),
          o.incidencias.length ? el('ul', { class: 'fc-prox' }, o.incidencias.map((i) => el('li', {},
            el('a', { href: `/incidencias.html?id=${i.id}` }, el('b', {}, i.codigo)), ` · ${i.titulo}`, el('small', {}, [i.tipo, i.proveedor, i.estado].filter(Boolean).join(' · '))))) : el('p', { class: 'ayuda' }, 'Ninguna.')));
      return [el('div', { class: 'fc-centro' }, datos, proys), lado];
    },
  });
})();
