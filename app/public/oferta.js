// Página pública: el proveedor rellena sus precios de una petición de oferta (enlace con token, sin sesión).
(() => {
  const token = new URLSearchParams(location.search).get('t') || '';
  const API = `/api/oferta/${encodeURIComponent(token)}`;
  const app = document.getElementById('app');

  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (k === 'class') n.className = v;
      else if (k in n && typeof v !== 'string') n[k] = v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h instanceof Node ? h : String(h));
    return n;
  };
  const eur = (x) => `${Number(x || 0).toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
  const cant = (x) => Number(x).toLocaleString('es-ES', { maximumFractionDigits: 3 });
  const fecha = (f) => (f ? new Date(`${String(f).slice(0, 10)}T12:00:00`).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) : '');
  const cuando = (t) => new Date(t).toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  const num = (v) => { const s = String(v ?? '').trim().replace(/\s|€/g, ''); if (!s) return null; const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s); return Number.isFinite(n) ? n : NaN; };
  const fmtIn = (n) => (n == null ? '' : String(n).replace('.', ','));

  async function api(metodo, url, cuerpo, cab) {
    const r = await fetch(url, { method: metodo, headers: cuerpo instanceof Blob ? cab : { 'Content-Type': 'application/json' }, body: cuerpo instanceof Blob ? cuerpo : cuerpo ? JSON.stringify(cuerpo) : undefined });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se ha podido completar. Inténtelo de nuevo.');
    return d;
  }

  function pintar(d, mensaje) {
    document.title = `Petición de oferta ${d.codigo} · ${d.empresa.nombre}`;
    const abierta = d.abierta;
    const r = d.respuesta;
    const estado = {
      lineas: Object.fromEntries(d.lineas.map((l) => [l.id, { precio: l.precio, no: l.no_tiene, alt: l.alternativa }])),
    };
    let archivos = d.archivos;

    // ---- líneas
    const total = el('b');
    const importes = new Map();
    const recalcular = () => {
      let t = 0;
      for (const l of d.lineas) {
        const e = estado.lineas[l.id];
        const p = e.no ? null : num(e.precio);
        const imp = p != null && !Number.isNaN(p) ? p * l.cantidad : null;
        if (imp != null) t += imp;
        importes.get(l.id).textContent = imp != null ? eur(imp) : '—';
      }
      const po = portesIncl.checked ? 0 : num(portes.value);
      total.textContent = eur(t + (po && !Number.isNaN(po) ? po : 0));
    };
    const filas = d.lineas.map((l) => {
      const e = estado.lineas[l.id];
      const imp = el('span');
      importes.set(l.id, imp);
      const precio = el('input', { class: 'precio', type: 'text', inputmode: 'decimal', value: fmtIn(e.precio), placeholder: '0,00', disabled: !abierta || e.no, 'aria-label': `Precio por ${l.unidad || 'unidad'} de ${l.descripcion}` });
      precio.addEventListener('input', () => { e.precio = precio.value; precio.setCustomValidity(Number.isNaN(num(precio.value)) ? 'Número no válido' : ''); recalcular(); });
      const altIn = el('input', { class: 'alt', type: 'text', maxlength: '300', value: e.alt || '', placeholder: 'Marca, medida o calidad que ofrecen en su lugar', disabled: !abierta, 'aria-label': `Alternativa a ${l.descripcion}` });
      const alt = el('label', { class: 'alt-caja' }, el('span', {}, 'Alternativa que ofrecen'), altIn);
      alt.hidden = !e.alt;
      altIn.addEventListener('input', () => { e.alt = altIn.value; });
      const no = el('input', { type: 'checkbox', checked: e.no, disabled: !abierta });
      const tr = el('tr', { class: e.no ? 'sin' : null },
        el('td', { class: 'desc', 'data-t': null }, el('b', {}, l.descripcion),
          el('div', {}, abierta && alt.hidden ? el('button', { type: 'button', class: 'alt-btn', onclick: (ev) => { alt.hidden = false; ev.currentTarget.hidden = true; altIn.focus(); } }, 'Ofrecer una alternativa') : null, alt)),
        el('td', { class: 'num', 'data-t': 'Cantidad' }, `${cant(l.cantidad)} ${l.unidad || ''}`),
        el('td', { class: 'num', 'data-t': `Precio / ${l.unidad || 'ud'}` }, precio),
        el('td', { class: 'num', 'data-t': 'Importe' }, imp),
        el('td', { class: 'num acc' }, el('label', { class: 'chk' }, no, 'No lo tengo')));
      no.addEventListener('change', () => { e.no = no.checked; precio.disabled = !abierta || e.no; tr.classList.toggle('sin', e.no); recalcular(); });
      return tr;
    });

    // ---- condiciones
    const campo = (txt, input, ancho) => el('label', { class: ancho ? 'ancho' : null }, el('span', {}, txt), input);
    const fEnt = el('input', { type: 'date', value: r.fecha_entrega || '', disabled: !abierta });
    // trabajo en obra: días, personas y cuándo puede empezar
    const diasT = el('input', { type: 'number', min: 0.5, step: 0.5, value: r.dias_trabajo ?? '', disabled: !abierta, 'aria-label': 'Días de trabajo' });
    const pers = el('input', { type: 'number', min: 1, step: 1, value: r.personas ?? '', disabled: !abierta, 'aria-label': 'Personas' });
    const inicio = el('input', { type: 'date', value: r.inicio_posible || '', disabled: !abierta, 'aria-label': 'Puedo empezar el' });
    const portes = el('input', { type: 'text', inputmode: 'decimal', value: r.portes ? fmtIn(r.portes) : '', placeholder: '0,00', disabled: !abierta, 'aria-label': 'Portes en euros' });
    const portesIncl = el('input', { type: 'checkbox', checked: r.portes === 0, disabled: !abierta });
    portesIncl.addEventListener('change', () => { portes.disabled = !abierta || portesIncl.checked; if (portesIncl.checked) portes.value = ''; recalcular(); });
    portes.disabled = !abierta || portesIncl.checked;
    portes.addEventListener('input', recalcular);
    const ref = el('input', { type: 'text', maxlength: '80', value: r.ref_oferta || '', placeholder: 'Su nº de oferta', disabled: !abierta });
    const contacto = el('input', { type: 'text', maxlength: '200', value: r.contacto || '', placeholder: 'Nombre y teléfono o email', disabled: !abierta });
    const notas = el('textarea', { rows: 3, maxlength: '2000', disabled: !abierta, placeholder: 'Validez de la oferta, plazos por línea, forma de pago…' });
    notas.value = r.notas || '';

    // ---- archivos
    const cajaArch = el('div', { class: 'archivos' });
    const pintarArch = () => cajaArch.replaceChildren(...archivos.map((a) => el('span', { class: 'archivo' },
      el('a', { href: `${API}/archivos/${a.id}`, target: '_blank', rel: 'noopener' }, `📎 ${a.nombre || 'archivo'}`),
      abierta ? el('button', { type: 'button', 'aria-label': `Quitar ${a.nombre || 'archivo'}`, onclick: async () => { try { archivos = await api('DELETE', `${API}/archivos/${a.id}`); pintarArch(); } catch (e) { err.textContent = e.message; } } }, '×') : null)),
    abierta ? el('label', { class: 'sec', style: 'display:inline-block;border:1px dashed var(--linea);border-radius:8px;padding:6px 12px;cursor:pointer;font-size:14px' },
      '＋ Adjuntar su oferta (PDF o foto)',
      el('input', { type: 'file', accept: 'application/pdf,image/jpeg,image/png,image/webp', hidden: true, onchange: async (ev) => {
        const f = ev.target.files[0]; ev.target.value = '';
        if (!f) return;
        if (f.size > 6 * 1024 * 1024) { err.textContent = 'El archivo pasa de 6 MB.'; return; }
        err.textContent = 'Subiendo…';
        try { archivos = await api('POST', `${API}/archivos`, f, { 'Content-Type': f.type, 'X-Nombre': encodeURIComponent(f.name) }); err.textContent = ''; pintarArch(); }
        catch (e) { err.textContent = e.message; }
      } })) : null);
    pintarArch();

    const err = el('p', { class: 'error', role: 'alert' });
    const enviar = async (noOferta) => {
      err.textContent = '';
      const precios = {}; const lineas = {};
      for (const l of d.lineas) {
        const e = estado.lineas[l.id];
        const p = e.no ? null : num(e.precio);
        if (Number.isNaN(p)) { err.textContent = `Revise el precio de «${l.descripcion}».`; return; }
        precios[l.id] = p;
        lineas[l.id] = { no: e.no, alt: e.alt || null };
      }
      const po = portesIncl.checked ? 0 : num(portes.value);
      if (Number.isNaN(po)) { err.textContent = 'Revise los portes.'; return; }
      if (!noOferta && !Object.values(precios).some((p) => p != null)) { err.textContent = 'Ponga el precio de alguna línea, o marque «No lo tengo» en las que no pueda servir.'; return; }
      if (noOferta && !confirm('¿Confirma que no pueden ofertar esta petición?')) return;
      botones.forEach((b) => { b.disabled = true; });
      try {
        const nd = await api('PUT', API, { precios, lineas, no_oferta: !!noOferta, fecha_entrega: fEnt.value || null, portes: po, ref_oferta: ref.value, notas: notas.value, contacto: contacto.value,
          ...(d.en_obra ? { dias_trabajo: diasT.value, personas: pers.value, inicio_posible: inicio.value || null } : {}) });
        pintar(nd, noOferta ? 'Gracias. Hemos anotado que no pueden ofertar esta petición.' : 'Gracias, hemos recibido su oferta. Puede corregirla desde este mismo enlace mientras la petición siga abierta.');
        scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e) { err.textContent = e.message; botones.forEach((b) => { b.disabled = false; }); }
    };
    const botones = abierta ? [
      el('button', { type: 'button', class: 'prim', onclick: () => enviar(false) }, r.enviada_en ? 'Guardar los cambios' : 'Enviar oferta'),
      el('button', { type: 'button', class: 'sec', onclick: () => enviar(true) }, 'No podemos ofertar'),
    ] : [];

    const e = d.empresa;
    app.replaceChildren(el('div', { class: 'hoja' },
      el('header', { class: 'cab' },
        el('div', {}, el('div', { class: 'emp' }, e.nombre), el('div', { class: 'emp-datos' }, [e.cif && `CIF ${e.cif}`, e.direccion, e.telefono, e.email].filter(Boolean).join(' · '))),
        el('div', { class: 'ref' }, el('div', { class: 'tit' }, 'Petición de oferta'), el('div', { class: 'cod' }, d.codigo))),
      el('div', { class: 'datos' },
        el('div', {}, el('span', {}, 'Para'), d.proveedor),
        el('div', {}, el('span', {}, 'Responder antes del'), fecha(d.responder_antes) || 'Lo antes posible'),
        el('div', {}, el('span', {}, 'Lo necesitamos el'), fecha(d.necesario_el) || 'A convenir'),
        el('div', {}, el('span', {}, 'Entrega en'), d.entregar_en || '—')),
      mensaje ? el('div', { class: 'banda ok', role: 'status' }, '✔ ', mensaje)
        : r.enviada_en ? el('div', { class: 'banda ok' }, `✔ Oferta recibida el ${cuando(r.enviada_en)}.`, abierta ? ' Puede corregirla y volver a guardar.' : '') : null,
      !abierta ? el('div', { class: 'banda aviso' }, 'Esta petición ya está cerrada: se muestra solo para consulta. Si necesita cambiar algo, contacte con nosotros.') : null,
      abierta && !r.enviada_en ? el('p', { class: 'intro' }, 'Indique su precio por unidad, sin IVA, para el material que pueda servir. Si no tiene algo, márquelo como «No lo tengo»; si puede ofrecer algo equivalente, use «Ofrecer una alternativa».') : null,
      d.notas_peticion ? el('p', { class: 'nota-pet' }, d.notas_peticion) : null,

      el('h2', {}, 'Material'),
      el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Descripción'), el('th', { class: 'num' }, 'Cantidad'), el('th', { class: 'num' }, 'Precio / ud (€ sin IVA)'), el('th', { class: 'num' }, 'Importe'), el('th', {}))),
        el('tbody', {}, filas),
        el('tfoot', {}, el('tr', {}, el('td', { colspan: '3', class: 'num' }, 'Total', el('span', { class: 'sub' }, ' (con portes, sin IVA)')), el('td', { class: 'num' }, total), el('td')))),

      el('h2', {}, 'Condiciones'),
      el('div', { class: 'campos' },
        d.en_obra ? [campo('Días de trabajo', diasT), campo('Personas', pers), campo('Podemos empezar el', inicio)] : campo('Fecha de entrega', fEnt),
        el('label', {}, el('span', {}, 'Portes (€)'), el('div', { class: 'portes-fila' }, portes, el('label', { class: 'chk' }, portesIncl, 'Incluidos'))),
        campo('Su referencia', ref),
        campo('Persona de contacto', contacto),
        campo('Observaciones', notas, true),
        el('div', { class: 'ancho' }, cajaArch)),
      err,
      botones.length ? el('div', { class: 'acciones' }, botones, el('span', { class: 'esp' }), el('a', { href: `${API}/pdf`, target: '_blank', rel: 'noopener', class: 'pie', style: 'margin:0' }, 'Descargar la petición en PDF')) : null),
    el('p', { class: 'pie' }, `Enlace personal para ${d.proveedor}. No lo reenvíe fuera de su empresa.`));
    recalcular();
  }

  (async () => {
    try { pintar(await api('GET', API)); }
    catch (e) { app.replaceChildren(el('div', { class: 'hoja' }, el('h1', { style: 'font-size:20px;margin-top:0' }, 'Enlace no válido'), el('p', {}, e.message))); }
  })();
})();
