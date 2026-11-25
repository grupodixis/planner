/* Clientes: datos fiscales y de contacto, sus personas (papel, qué aprueba, cómo se le avisa) y sus proyectos y obras */
(() => {
  'use strict';
  const { el, toast, campo, pantalla, pedir, api } = window.fichas;
  const TIPOS = { empresa: 'Empresa', particular: 'Particular', comunidad: 'Comunidad de propietarios', administracion: 'Administración' };
  const APRUEBA = { todo: 'Todo', planos: 'Planos', muestras: 'Muestras de color / acabado', cambios: 'Cambios con precio', actas: 'Actas de entrega', citas: 'Citas en obra' };
  const RESUMEN = { semanal: 'Resumen semanal', hitos: 'Solo hitos', no: 'Nada' };

  // Personas de contacto: una fila editable por persona
  function contactos(cl, { editar, recargar }) {
    const fila = (k) => {
      const g = async (cambio) => { try { await api('PUT', `/api/cliente-contactos/${k.id}`, cambio); toast('Guardado'); } catch (e) { toast(e.message, true); recargar(); } };
      const inp = (c, ph, attrs = {}) => el('input', { value: k[c] || '', placeholder: ph, disabled: !editar, 'aria-label': ph, onchange: (ev) => g({ [c]: ev.target.value }), ...attrs });
      const aprueba = new Set(k.aprueba || []);
      return el('tr', { class: k.activo ? '' : 'baja' },
        el('td', {}, inp('nombre', 'Nombre', { maxlength: 160, class: 'fc-in-nombre' }), inp('papel', 'Papel (propiedad, arquitecto…)', { maxlength: 80 })),
        el('td', {}, inp('telefono', 'Teléfono', { maxlength: 60, type: 'tel' }), inp('email', 'Correo', { maxlength: 160, type: 'email' })),
        el('td', { class: 'fc-aprueba' }, Object.entries(APRUEBA).map(([v, t]) => el('label', { class: `fc-chk${aprueba.has(v) ? ' on' : ''}` },
          el('input', { type: 'checkbox', checked: aprueba.has(v), disabled: !editar, onchange: (ev) => {
            if (ev.target.checked) aprueba.add(v); else aprueba.delete(v);
            ev.target.parentNode.classList.toggle('on', ev.target.checked); g({ aprueba: [...aprueba] });
          } }), t))),
        el('td', { class: 'fc-avisos' },
          el('label', { class: 'fc-chk' }, el('input', { type: 'checkbox', checked: k.avisos_correo, disabled: !editar, onchange: (ev) => g({ avisos_correo: ev.target.checked }) }), '✉ Correo'),
          el('label', { class: 'fc-chk' }, el('input', { type: 'checkbox', checked: k.avisos_whatsapp, disabled: !editar, onchange: (ev) => g({ avisos_whatsapp: ev.target.checked }) }), '🟢 WhatsApp'),
          el('select', { disabled: !editar, 'aria-label': 'Resumen', onchange: (ev) => g({ resumen: ev.target.value }) },
            Object.entries(RESUMEN).map(([v, t]) => el('option', { value: v, selected: k.resumen === v }, t)))),
        el('td', {}, editar ? el('button', { type: 'button', class: 'ghost borrar mini', title: 'Quitar', onclick: async () => {
          if (!confirm(`¿Quitar a ${k.nombre}?`)) return;
          try { await api('DELETE', `/api/cliente-contactos/${k.id}`); recargar(); } catch (e) { toast(e.message, true); }
        } }, '✕') : null));
    };
    return el('section', { class: 'panel' },
      el('div', { class: 'fc-cab' }, el('h3', {}, '👥 Personas de contacto'),
        editar ? el('button', { type: 'button', class: 'primario mini', onclick: async () => {
          const v = await pedir('Nueva persona de contacto', [['nombre', 'Nombre *', { maxlength: 160, required: true }], ['papel', 'Papel (propiedad, arquitecto, administración…)', { maxlength: 80 }],
            ['telefono', 'Teléfono', { type: 'tel', maxlength: 60 }], ['email', 'Correo', { type: 'email', maxlength: 160 }]], 'Añadir');
          if (!v) return;
          try { await api('POST', `/api/clientes/${cl.id}/contactos`, v); toast('Añadida'); recargar(); } catch (e) { toast(e.message, true); }
        } }, '＋ Añadir') : null),
      cl.contactos.length ? el('table', { class: 'fc-tabla fc-contactos' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Persona y papel'), el('th', {}, 'Teléfono y correo'), el('th', {}, 'Puede aprobar'), el('th', {}, 'Avisos'), el('th', {}, ''))),
        el('tbody', {}, cl.contactos.map(fila))) : el('p', { class: 'ayuda' }, 'Sin personas de contacto. Añade quién aprueba planos, muestras o cambios, y quién recibe los avisos.'),
      el('p', { class: 'ayuda' }, 'Son las personas que tendrán su enlace del proyecto: cada una aprueba solo lo marcado.'));
  }

  pantalla({
    filtros: [['todos', 'Todos'], ['activos', 'Con proyectos activos']],
    async cargarLista(q, filtro) {
      const r = await api('GET', `/api/clientes?q=${encodeURIComponent(q)}`);
      return { items: filtro === 'activos' && !q ? r.filter((c) => c.activos) : r };
    },
    item: (c) => el('li', { class: c.activo ? '' : 'baja' },
      el('b', {}, c.nombre), el('small', {}, [c.cif, TIPOS[c.tipo], c.telefono, c.contactos].filter(Boolean).join(' · ')),
      el('span', { class: 'fc-chips' }, c.activos ? el('span', { class: 'fc-chip v' }, `${c.activos} activo${c.activos > 1 ? 's' : ''}`) : el('span', { class: 'fc-chip' }, `${c.proyectos} proyecto${c.proyectos === 1 ? '' : 's'}`),
        c.activo ? null : el('span', { class: 'fc-chip' }, 'de baja'))),
    cargar: (id) => api('GET', `/api/clientes/${id}`),
    async nueva() {
      const v = await pedir('Nuevo cliente', [['nombre', 'Nombre o razón social *', { maxlength: 200, required: true }], ['cif', 'CIF / NIF', { maxlength: 30 }]]);
      if (!v) return null;
      try { const c = await api('POST', '/api/clientes', v); toast('Cliente creado'); return c.id; } catch (e) { toast(e.message, true); return null; }
    },
    pintar(cl, ctx) {
      const { editar, recargar, ir } = ctx;
      const guardar = async (k, v) => { await api('PUT', `/api/clientes/${cl.id}`, { [k]: v }); if (['nombre', 'cif', 'tipo'].includes(k)) recargar(); };
      const c = (k, etiqueta, extra = {}) => campo({ k, etiqueta, valor: cl[k], editar, guardar, ...extra });
      return [el('div', { class: 'fc-centro' },
        el('section', { class: 'panel fc-datos' },
          el('div', { class: 'fc-cab' }, el('h2', {}, cl.nombre), cl.codigo_ext ? el('span', { class: 'fc-chip', title: 'Código en el programa de facturación' }, `cód. ${cl.codigo_ext}`) : null, cl.activo ? null : el('span', { class: 'fc-chip' }, 'de baja'),
            editar ? el('button', { type: 'button', class: 'ghost borrar mini', onclick: async () => {
              if (!cl.activo) { await api('PUT', `/api/clientes/${cl.id}`, { activo: true }); return recargar(); }
              if (!confirm(cl.proyectos.length ? `«${cl.nombre}» tiene proyectos: se dará de baja (no se borra). ¿Seguir?` : `¿Borrar «${cl.nombre}»?`)) return;
              try { const r = await api('DELETE', `/api/clientes/${cl.id}`); toast(r.borrado ? 'Cliente borrado' : 'Dado de baja'); if (r.borrado) ir(null); else recargar(); } catch (e) { toast(e.message, true); }
            } }, cl.activo ? (cl.proyectos.length ? 'Dar de baja' : 'Borrar') : 'Reactivar') : null),
          el('div', { class: 'ficha fc-campos' },
            c('nombre', 'Razón social / nombre', { ancho: 'c1', obligatorio: true, max: 200 }), c('nombre_comercial', 'Nombre comercial', { ancho: 'c1', max: 160 }), c('cif', 'CIF / NIF', { ancho: 'c1', max: 30 }),
            c('direccion_fiscal', 'Dirección fiscal', { ancho: 'c2' }), c('tipo', 'Tipo', { ancho: 'c1', opciones: TIPOS }),
            c('telefono', 'Teléfono', { ancho: 'c1', tipo: 'tel', max: 60 }), c('movil', 'Móvil', { ancho: 'c1', tipo: 'tel', max: 60 }), c('email', 'Correo general', { ancho: 'c1', tipo: 'email', max: 160 }),
            c('email_facturas', 'Correo de facturas', { ancho: 'c1', tipo: 'email', max: 160 }),
            c('forma_pago', 'Forma de pago', { ancho: 'c1', max: 120 }), c('anticipo_pct', 'Anticipo habitual (%)', { ancho: 'c1', tipo: 'number' }), c('notas', 'Notas', { ancho: 'c1', filas: 2, max: 2000 }))),
        contactos(cl, ctx)),
      el('div', { class: 'fc-lado' }, el('section', { class: 'panel' }, el('h3', {}, '📁 Proyectos y obras'),
        cl.proyectos.length ? el('table', { class: 'fc-tabla' }, el('tbody', {}, cl.proyectos.map((p) => el('tr', {},
          el('td', {}, el('a', { href: `/proyectos.html?p=${p.id}` }, el('b', {}, p.codigo), ` · ${p.nombre}`),
            el('div', { class: 'ayuda' }, p.obra_id ? el('a', { href: `/obras.html?id=${p.obra_id}` }, `📍 ${p.obra}`) : 'sin obra')),
          el('td', {}, el('span', { class: `fc-chip ${p.estado === 'activo' ? 'v' : ''}` }, p.estado)))))) : el('p', { class: 'ayuda' }, 'Aún no tiene proyectos.')))];
    },
  });
})();
