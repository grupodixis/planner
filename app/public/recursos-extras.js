/* Recursos › Turnos y horas extra: autorizar (Dirección), hechas sin autorizar, lo del mes y los turnos */
(() => {
  'use strict';
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'value') n.value = v ?? '';
      else if (k === 'checked' || k === 'disabled') n[k] = !!v;
      else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
  const h2 = (h) => `${String(Math.round(h * 10) / 10).replace('.', ',')} h`;
  const eur = (v) => `${Math.round(v).toLocaleString('es-ES')} €`;
  const dia = (f) => new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  const leerHora = (v) => { const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(v).trim()); return m ? Number(m[1]) + Number(m[2] || 0) / 60 : NaN; };

  let ctx; let mes = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' }).slice(0, 7);

  async function pintar(raiz, c) {
    ctx = c || ctx;
    const { api, toast, puede } = ctx;
    const [pend, sin, hist, tur] = await Promise.all([
      api('GET', '/api/horas-extra?vista=pendientes'),
      api('GET', '/api/horas-extra?vista=sin_autorizar').catch(() => ({ dias: [] })),
      api('GET', `/api/horas-extra?vista=mes&mes=${mes}`),
      api('GET', '/api/turnos'),
    ]);
    const decide = pend.puedo;
    const recargar = () => pintar(raiz);
    const preguntarNo = (txt) => { const m = prompt(txt); return m && m.trim() ? m.trim() : null; };

    const tarjeta = (g) => el('li', { class: 'hx-card' },
      el('div', { class: 'hx-cab' },
        el('b', {}, g.tarea_codigo ? el('span', { class: 'hx-cod' }, g.tarea_codigo) : null, ' ', g.tarea || 'Trabajo fuera del plan'),
        el('span', { class: 'hx-h' }, `${h2(g.horas)} · ≈ ${eur(g.coste)}`)),
      el('div', {}, `${dia(g.fecha)} · ${g.desde < 99 ? `${hhmm(g.desde)}–${hhmm(g.hasta)}` : ''}${g.area ? ` · ${g.area}` : ''}`),
      el('div', { class: 'hx-pers' }, g.personas.map((p) => el('span', {}, `${p.nombre} (${h2(p.horas)}${p.mes ? ` · lleva ${h2(p.mes)} este mes` : ''})`))),
      el('small', {}, [g.pedido_por_nombre ? `Pidió: ${g.pedido_por_nombre}` : null, g.motivo ? `«${g.motivo}»` : 'sin motivo'].filter(Boolean).join(' · ')),
      decide ? el('div', { class: 'hx-btns' },
        el('button', { type: 'button', class: 'primario', onclick: async (ev) => {
          ev.currentTarget.disabled = true;
          try { await api('POST', '/api/horas-extra/decidir', { ids: g.ids, decision: 'si' }); toast('Horas extra autorizadas'); recargar(); } catch (e) { toast(e.message, true); ev.target.disabled = false; }
        } }, '✔ Autorizar'),
        el('button', { type: 'button', class: 'ghost', onclick: async () => {
          const nota = preguntarNo('¿Por qué no? (lo verá quien lo pidió; el tramo vuelve al fin de turno)'); if (!nota) return;
          try { await api('POST', '/api/horas-extra/decidir', { ids: g.ids, decision: 'no', nota }); toast('No autorizadas: el tramo vuelve al fin de turno'); recargar(); } catch (e) { toast(e.message, true); }
        } }, '✗ No')) : el('small', { class: 'ayuda' }, 'Las autoriza quien tenga el permiso «Autorizar horas extra» (Dirección).'));

    const sinFilas = (sin.dias || []).map((d) => el('tr', {},
      el('td', {}, d.recurso), el('td', {}, dia(d.fecha)), el('td', { class: 'num' }, h2(d.horas)), el('td', { class: 'num' }, eur(d.coste)),
      el('td', {}, decide ? [
        el('button', { type: 'button', class: 'ghost', onclick: async () => {
          try { await api('POST', '/api/horas-extra/parte', { recurso_id: d.recurso_id, fecha: d.fecha, decision: 'si' }); toast('Cuentan como horas extra'); recargar(); } catch (e) { toast(e.message, true); }
        } }, '✔ Son extra'),
        el('button', { type: 'button', class: 'ghost', onclick: async () => {
          const nota = preguntarNo('¿Por qué no cuentan como extra?'); if (!nota) return;
          try { await api('POST', '/api/horas-extra/parte', { recurso_id: d.recurso_id, fecha: d.fecha, decision: 'no', nota }); toast('Apuntado: sin recargo de horas extra'); recargar(); } catch (e) { toast(e.message, true); }
        } }, '✗ No')] : null)));

    const histFilas = hist.decididas.map((g) => el('tr', { class: g.estado === 'rechazada' ? 'hx-no' : '' },
      el('td', {}, dia(g.fecha)), el('td', {}, g.tarea_codigo ? `${g.tarea_codigo} ${g.tarea}` : g.origen === 'parte' ? 'Del parte' : '—'),
      el('td', {}, g.personas.map((p) => p.nombre).join(', ')), el('td', { class: 'num' }, h2(g.horas)),
      el('td', {}, g.estado === 'autorizada' ? '✔ autorizada' : `✗ no${g.nota ? ` · «${g.nota}»` : ''}`),
      el('td', {}, g.decidido_por_nombre || '')));

    // turnos (editar con permiso «recursos»)
    const editar = puede('recursos');
    const filaTurno = (t) => {
      const n = el('input', { type: 'text', value: t?.nombre || '', maxlength: 60, placeholder: 'Tarde, Obra…', 'aria-label': 'Nombre del turno', disabled: !editar });
      const i = el('input', { type: 'text', value: t ? hhmm(t.inicio) : '', placeholder: '07:00', class: 'hx-hora', 'aria-label': 'Empieza', disabled: !editar });
      const f = el('input', { type: 'text', value: t ? hhmm(t.fin) : '', placeholder: '15:00', class: 'hx-hora', 'aria-label': 'Termina', disabled: !editar });
      const guardar = async (extra = {}) => {
        const cuerpo = { nombre: n.value, inicio: leerHora(i.value), fin: leerHora(f.value), ...extra };
        try {
          if (t) await api('PUT', `/api/turnos/${t.id}`, cuerpo); else await api('POST', '/api/turnos', cuerpo);
          toast(t ? 'Turno guardado' : 'Turno creado'); recargar();
        } catch (e) { toast(e.message, true); }
      };
      if (t) for (const x of [n, i, f]) x.onchange = () => guardar();
      return el('tr', {},
        el('td', {}, n), el('td', {}, i), el('td', {}, f),
        el('td', {}, t ? (t.por_defecto ? el('b', {}, '★ por defecto') : editar ? el('button', { type: 'button', class: 'ghost', onclick: () => guardar({ por_defecto: true }) }, 'Hacer por defecto') : '') : ''),
        el('td', { class: 'num' }, t ? String(t.personas) : ''),
        el('td', {}, !editar ? null : t ? (t.por_defecto ? null : el('button', { type: 'button', class: 'ghost', title: 'Quitar el turno (sus personas pasan al turno por defecto)', onclick: async () => {
          if (!confirm(`¿Quitar el turno «${t.nombre}»? Sus personas pasan al turno por defecto.`)) return;
          try { await api('DELETE', `/api/turnos/${t.id}`); toast('Turno quitado'); recargar(); } catch (e) { toast(e.message, true); }
        } }, '✕')) : el('button', { type: 'button', class: 'primario', onclick: () => guardar() }, 'Añadir')));
    };

    const selMes = el('input', { type: 'month', value: mes, 'aria-label': 'Mes', onchange: (e) => { mes = e.target.value || mes; recargar(); } });
    raiz.replaceChildren(
      el('section', { class: 'panel hx-sec' },
        el('div', { class: 'cab-panel' }, el('h2', {}, `Por autorizar${pend.peticiones.length ? ` (${pend.peticiones.length})` : ''}`),
          el('span', { class: 'ayuda' }, 'Horas planificadas fuera del turno de cada persona. Si no se autorizan, su franja vuelve al fin de su turno y lo que sobra queda en «Por planificar».')),
        pend.peticiones.length ? el('ul', { class: 'hx-lista' }, pend.peticiones.map(tarjeta)) : el('p', { class: 'ayuda' }, '✔ Nada por autorizar.')),
      (sin.dias || []).length ? el('section', { class: 'panel hx-sec' },
        el('div', { class: 'cab-panel' }, el('h2', {}, 'Hechas fuera del turno sin autorizar'),
          el('span', { class: 'ayuda' }, 'Del parte: trabajaron fuera de su turno sin que se pidiera. Si son extra, llevan el recargo en costes; si no, se cuentan como horas normales.')),
        el('table', { class: 'tabla hx-tabla' }, el('thead', {}, el('tr', {}, ['Persona', 'Día', 'Horas', 'Coste', ''].map((x) => el('th', {}, x)))), el('tbody', {}, sinFilas))) : null,
      el('section', { class: 'panel hx-sec' },
        el('div', { class: 'cab-panel' }, el('h2', {}, 'Decididas en el mes'), selMes),
        hist.por_persona.length ? el('p', { class: 'hx-resumen' }, 'Autorizadas: ', hist.por_persona.map((p, k) => [k ? ' · ' : '', el('b', {}, p.nombre), ` ${h2(p.horas)}`])) : null,
        histFilas.length ? el('table', { class: 'tabla hx-tabla' },
          el('thead', {}, el('tr', {}, ['Día', 'Tarea', 'Personas', 'Horas', 'Decisión', 'Quién'].map((x) => el('th', {}, x)))), el('tbody', {}, histFilas))
          : el('p', { class: 'ayuda' }, 'Nada decidido este mes.')),
      el('section', { class: 'panel hx-sec' },
        el('div', { class: 'cab-panel' }, el('h2', {}, 'Turnos'),
          el('span', { class: 'ayuda' }, 'Cada operario tiene su turno (en su ficha; vacío = el turno por defecto). Lo que se le planifique fuera de él son horas extra.')),
        el('table', { class: 'tabla hx-tabla hx-turnos' },
          el('thead', {}, el('tr', {}, ['Turno', 'Empieza', 'Termina', '', 'Personas', ''].map((x) => el('th', {}, x)))),
          el('tbody', {}, tur.turnos.map(filaTurno), editar ? filaTurno(null) : null))));
  }

  window.s360extras = { pintar };
})();
