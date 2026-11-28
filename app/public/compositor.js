/* Planéalo · Compositor de proyectos: presupuesto → borrador s360-import/2 (partidas › OTs › tareas) que se edita aquí
   y se crea con Proyectos › Importar. El editor sigue al del compositor de Cowork (template.html), con lo guardado en el
   servidor, el catálogo en vivo y, además, OTs, tareas nuevas, desglose de tiempos, dependencias y notas. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, attrs = {}, ...hijos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') n.className = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else if (['checked', 'disabled', 'hidden', 'selected'].includes(k)) n[k] = !!v;
      else if (k === 'value') n.value = v ?? '';
      else if (v != null && v !== false) n.setAttribute(k, v === true ? '' : v);
    }
    for (const h of hijos.flat(Infinity)) if (h != null && h !== false) n.append(h);
    return n;
  };
  const api = (...a) => window.s360.api(...a);
  const aviso = (t) => window.s360.aviso(t);
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => Math.round(n * 1000) / 1000;
  const coma = (n) => String(fmt(Number(n) || 0)).replace('.', ',');
  const arriba05 = (h) => Math.max(0.5, Math.ceil((Number(h) || 0) * 2 - 1e-9) / 2);
  const fecha = (d) => (d ? new Date(d).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
  const FASES = ['preparacion', 'fabricacion', 'soldadura', 'montaje', 'acabado', 'control', 'transporte', 'otros'];
  const leerLocal = (k) => { try { return JSON.parse(localStorage.getItem(`cmp:${k}`) || 'null'); } catch { return null; } };
  const ponerLocal = (k, v) => { try { localStorage.setItem(`cmp:${k}`, JSON.stringify(v)); } catch { /* sin almacenamiento */ } };

  let CAT = null; let IDX = {}; let MAT = new Map(); let PROV = new Map();
  const JORNADA_H = 8;   // un día de taller externo = una jornada
  let C = null; let DATA = null; let lista = []; let sondeo = null; let guardarT = null; let estadoGuardado = '';
  const open = new Set(leerLocal('open') || []);

  /* ---------- catálogo ---------- */
  function setCat(c) {
    CAT = { areas: c.areas || [], area_tipos: c.area_tipos || ['taller', 'pintura', 'oficina', 'obra', 'transporte', 'otro'], capacidades: c.capacidades || [], equipos: c.equipos || [], subcontratas: c.subcontratas || [], herramientas: c.herramientas || [], generado: c.generado };
    IDX = {
      cap: new Map(CAT.capacidades.map((x) => [norm(x.nombre), x])), eq: new Map(CAT.equipos.map((x) => [norm(x.nombre), x])),
      sub: new Map(CAT.subcontratas.map((x) => [norm(x.nombre), x])), her: new Map(CAT.herramientas.map((x) => [norm(x.nombre), x])),
      area: new Map(CAT.areas.map((x) => [norm(x.nombre), x])),
    };
    MAT = new Map((c.materiales || []).map((x) => [norm(x.nombre), x]));
    const opt = (arr, f) => arr.map((x) => `<option value="${esc(x.nombre)}">${esc(f ? f(x) : '')}</option>`).join('');
    const dls = el('div', { id: 'cmp-dl', hidden: true });
    dls.innerHTML = `<datalist id="dlCap">${opt(CAT.capacidades, (x) => x.familia)}</datalist><datalist id="dlEq">${opt(CAT.equipos, (x) => `${x.familia || ''} · ${x.unidades} ud`)}</datalist>
      <datalist id="dlSub">${opt(CAT.subcontratas)}</datalist><datalist id="dlHer">${opt(CAT.herramientas, (x) => x.familia)}</datalist>
      <datalist id="dlMat">${(c.materiales || []).map((x) => `<option value="${esc(x.nombre)}">${esc(`${x.familia || ''} · ${x.unidad || ''}`)}</option>`).join('')}</datalist>`;
    $('#cmp-dl')?.remove(); document.body.append(dls);
  }
  function setProv(lst) {
    PROV = new Map(lst.map((x) => [norm(x.nombre), x]));
    $('#dlProv')?.remove();
    const dl = el('datalist', { id: 'dlProv' }); dl.innerHTML = lst.map((x) => `<option value="${esc(x.nombre)}">${esc(`${x.transportista ? '🚚 transportista' : x.zona === 'peninsula' ? 'península' : 'Menorca'}${x.sirve ? ` · ${x.sirve}` : ''}`)}</option>`).join('');
    document.body.append(dl);
  }
  const FAMILIAS = () => [...new Set(CAT.capacidades.map((c) => c.familia))].concat(['Otras']);

  /* ---------- forma interna de las tareas ---------- */
  function toInternal(t) {
    t._cap = (t.capacidades || []).map((c) => (typeof c === 'string' ? { nombre: c, cantidad: 1 } : { nombre: c.capacidad, cantidad: c.cantidad || 1, familia: c.familia }));
    t._eq = (t.equipos || []).map((c) => (typeof c === 'string' ? { nombre: c, cantidad: 1 } : { nombre: c.tipo, cantidad: c.cantidad || 1 }));
    t._sub = (t.subcontratas || []).map((c) => (typeof c === 'string' ? { nombre: c, cantidad: 1 } : { nombre: c.tipo, cantidad: c.cantidad || 1 }));
    t._her = (t.herramientas || []).map((c) => (typeof c === 'string' ? { nombre: c, cantidad: 1 } : { nombre: c.nombre, cantidad: c.cantidad || 1, nota: c.nota || '' }));
    t._mat = (t.materiales || []).map((m) => ({ ref: m.ref, cantidad: m.cantidad }));
    t._had = { cap: 'capacidades' in t };
  }
  function fromInternal(t) {
    const o = {};
    for (const k of Object.keys(t)) if (!k.startsWith('_')) o[k] = t[k];
    const cap = t._cap.filter((x) => x.nombre.trim()).map((x) => {
      const known = IDX.cap.has(norm(x.nombre));
      if (x.cantidad > 1 || (!known && x.familia)) { const r = { capacidad: x.nombre.trim() }; if (x.cantidad > 1) r.cantidad = x.cantidad; if (!known && x.familia) r.familia = x.familia; return r; }
      return x.nombre.trim();
    });
    const eq = t._eq.filter((x) => x.nombre.trim()).map((x) => (x.cantidad > 1 ? { tipo: x.nombre.trim(), cantidad: x.cantidad } : x.nombre.trim()));
    const sub = t._sub.filter((x) => x.nombre.trim()).map((x) => (x.cantidad > 1 ? { tipo: x.nombre.trim(), cantidad: x.cantidad } : x.nombre.trim()));
    const her = t._her.filter((x) => x.nombre.trim()).map((x) => ((x.cantidad > 1 || x.nota) ? { nombre: x.nombre.trim(), ...(x.cantidad > 1 ? { cantidad: x.cantidad } : {}), ...(x.nota ? { nota: x.nota } : {}) } : x.nombre.trim()));
    const put = (k, arr, had) => { if (arr.length || had) o[k] = arr; else delete o[k]; };
    if (t.taller_externo) { cap.length = 0; delete o.desglose; o.operarios = 0; }
    put('capacidades', cap, t._had.cap && !t.taller_externo); put('equipos', eq, false); put('subcontratas', sub, false); put('herramientas', her, false);
    put('materiales', (t._mat || []).filter((x) => x.ref && x.cantidad > 0).map((x) => ({ ref: x.ref, cantidad: x.cantidad })), false);
    if (o.desglose && !o.desglose.length) delete o.desglose;
    if (o.despues_de && !o.despues_de.length) delete o.despues_de;
    if (!o.notas) delete o.notas;
    if (!o.taller_externo) delete o.taller_externo; if (!o.subcontrata_obra) delete o.subcontrata_obra;
    const orden = ['ref_externa', 'nombre', 'horas', 'operarios', 'taller_externo', 'subcontrata_obra', 'area', 'area_tipo', 'desglose', 'capacidades', 'equipos', 'subcontratas', 'herramientas', 'materiales', 'despues_de', 'requiere', 'oficio', 'notas', 'extra'];
    const r = {}; orden.forEach((k) => { if (k in o) r[k] = o[k]; }); Object.keys(o).forEach((k) => { if (!(k in r)) r[k] = o[k]; });
    return r;
  }
  const tasks = () => { const out = []; (DATA.proyecto.partidas || []).forEach((p, pi) => (p.ots || []).forEach((ot, oi) => (ot.tareas || []).forEach((t, ti) => out.push({ p, ot, t, path: `partidas[${pi}].ots[${oi}].tareas[${ti}]` })))); return out; };
  function setData(d) {
    if (!d || !d.proyecto || !Array.isArray(d.proyecto.partidas)) throw new Error('El borrador no tiene partidas');
    DATA = JSON.parse(JSON.stringify(d));
    tasks().forEach(({ t }) => toInternal(t));
    DATA.proyecto.partidas.forEach((p) => { if (!p.materiales) p.materiales = []; if (!p.ots) p.ots = []; });
  }
  function exportar() {
    const out = JSON.parse(JSON.stringify(DATA, (k, v) => (k.startsWith('_') ? undefined : v)));
    const real = tasks(); let i = 0;
    (out.proyecto.partidas || []).forEach((p) => { (p.ots || []).forEach((ot) => { ot.tareas = ot.tareas.map(() => fromInternal(real[i++].t)); }); if (!p.materiales?.length) delete p.materiales; });
    out.generado = new Date().toISOString();
    return out;
  }

  /* ---------- materiales ---------- */
  const allMats = () => { const o = new Map(); DATA.proyecto.partidas.forEach((p) => (p.materiales || []).forEach((m) => o.set(m.ref_externa, { m, p }))); return o; };
  const usage = () => { const u = new Map(); tasks().forEach(({ t }) => (t._mat || []).forEach((x) => u.set(x.ref, (u.get(x.ref) || 0) + (+x.cantidad || 0)))); return u; };
  const matInCat = (m) => MAT.has(norm(m.catalogo || m.descripcion));
  function nextRef(base, prefijo, existe) { let n = 0; let r; do { n++; r = `${base}/${prefijo}${prefijo === 'M' ? String(n).padStart(2, '0') : n}`; } while (existe(r)); return r; }
  const refsUsadas = () => { const s = new Set(); DATA.proyecto.partidas.forEach((p) => { s.add(p.ref_externa); (p.materiales || []).forEach((m) => s.add(m.ref_externa)); p.ots.forEach((o) => { s.add(o.ref_externa); o.tareas.forEach((t) => s.add(t.ref_externa)); }); }); return s; };
  function matWarnings() {
    const w = []; const u = usage();
    allMats().forEach(({ m }, r) => {
      const used = u.get(r) || 0;
      if (!(m.cantidad > 0)) w.push(`Material «${m.descripcion}»: cantidad no válida.`);
      else if (used > m.cantidad + 1e-9) w.push(`Material «${m.descripcion}»: las tareas consumen ${fmt(used)} y la partida tiene ${m.cantidad} ${m.unidad || ''}.`);
    });
    return w;
  }
  const depRef = (d) => (typeof d === 'string' ? d : d.ref);
  const hpDesglose = (t) => (t.desglose || []).reduce((s, d) => s + (Number(d.horas_persona) || 0), 0);

  /* ---------- avisos de una tarea ---------- */
  function warnings(t) {
    const w = []; const op = t.operarios ?? 1;
    const prov = t.taller_externo || t.subcontrata_obra;
    if (prov && !PROV.has(norm(prov))) w.push(`«${prov}» no está en Proveedores: dalo de alta o elige otro.`);
    if (t.taller_externo) return w;
    if (t.area && !IDX.area.has(norm(t.area))) w.push(`Área «${t.area}» no está en el catálogo.`);
    if (!t.area && !t.area_tipo) w.push('Sin área ni tipo de área.');
    t._cap.forEach((c) => { if (c.cantidad > op) w.push(`«${c.nombre}» pide ${c.cantidad} personas y la tarea tiene ${op} operario(s).`); });
    const seen = new Set();
    [['_cap', 'capacidad'], ['_eq', 'equipo'], ['_sub', 'subcontrata'], ['_her', 'herramienta']].forEach(([k, l]) => t[k].forEach((x) => { const n = k + norm(x.nombre); if (seen.has(n)) w.push(`${l} repetida: «${x.nombre}».`); seen.add(n); }));
    t._her.forEach((h) => { if (IDX.eq.has(norm(h.nombre))) w.push(`«${h.nombre}» es un equipo contado: debería ir en Equipos.`); });
    t._eq.forEach((e) => { const c = IDX.eq.get(norm(e.nombre)); if (c && e.cantidad > c.unidades) w.push(`Se piden ${e.cantidad} «${e.nombre}» y hay ${c.unidades}.`); });
    const a = t.area && IDX.area.get(norm(t.area));
    if (a?.maquinas_fijas?.length) t._eq.forEach((e) => { if (a.maquinas_fijas.some((m) => norm(m) === norm(e.nombre))) w.push(`«${e.nombre}» ya va fija con el área «${a.nombre}».`); });
    if (op > 0 && !t._cap.length && !t.subcontrata_obra) w.push('Sin capacidades.');
    const A = allMats(); (t._mat || []).forEach((x) => { if (!A.has(x.ref)) w.push(`Consume ${x.ref}, que no está en ninguna partida.`); });
    if (op === 0 && !t._eq.length && !t._sub.length && !t.subcontrata_obra) w.push('Sin operarios, equipos ni subcontratas.');
    const hp = hpDesglose(t); const hpt = (t.horas || 0) * Math.max(1, op);
    if (t.desglose?.length && Math.abs(hp - hpt) > Math.max(0.5, hpt * 0.1)) w.push(`El desglose suma ${coma(hp)} h-persona y la tarea tiene ${coma(hpt)} (${t.horas} h × ${Math.max(1, op)}).`);
    if (String(t.nombre || '').length > 40) w.push('Nombre de más de 40 caracteres: el detalle, en notas.');
    return w;
  }

  /* ---------- pintar el editor ---------- */
  const unidadTxt = (q, u) => { u = (u || '').trim(); if (!u || ['ud', 'uds', 'unidad', 'unidades'].includes(u)) return q == 1 ? 'unidad' : 'unidades'; return u; };
  function partHead(p) {
    const pi = DATA.proyecto.partidas.indexOf(p); const x = p.extra || {}; const q = x.cantidad; const ed = open.has(`pe:${p.ref_externa}`);
    return `<div class="part" data-p="${pi}"><span class="pc">Partida ${esc(p.codigo || '')}</span><span>${esc(p.nombre)}</span>${q != null ? `<span class="pu">(${fmt(q)} ${esc(unidadTxt(q, x.unidad))})</span>` : ''}${p.pvp != null ? `<span class="pv">PVP ${coma(p.pvp)} €</span>` : ''}<button type="button" data-pedit>${ed ? 'Cerrar' : 'Editar'}</button><button type="button" data-otadd title="Añadir una OT a esta partida">＋ OT</button></div>
      ${fabHTML(p, pi)}
      <div class="pedit ${ed ? 'on' : ''}" data-p="${pi}"><label>Nombre</label><input class="pn" maxlength="120" value="${esc(p.nombre)}" data-pf="nombre"><label>Código</label><input class="pq" maxlength="30" value="${esc(p.codigo || '')}" data-pf="codigo">
        <button type="button" class="del" data-pdel>Quitar partida</button></div>`;
  }
  function fabHTML(p, pi) {
    const f = p.extra?.fabricacion; const ext = f?.donde === 'externo';
    return `<div class="fab ${ext ? 'ext' : ''}" data-p="${pi}"><span class="hint">Se fabrica</span>
      <select data-fab="donde"><option value="propio" ${ext ? '' : 'selected'}>🏠 en nuestro taller</option><option value="externo" ${ext ? 'selected' : ''}>🏭 en un taller externo</option></select>
      ${ext ? `<input list="dlProv" data-fab="taller" value="${esc(f.taller || '')}" placeholder="Taller (proveedor)…" class="${f.taller && !PROV.has(norm(f.taller)) ? 'malo' : ''}">
        <select data-fab="material"><option value="taller" ${f.material !== 'nosotros' ? 'selected' : ''}>el material lo pone el taller</option><option value="nosotros" ${f.material === 'nosotros' ? 'selected' : ''}>el material lo ponemos nosotros</option></select>
        <button type="button" data-fabaplicar title="Pone ese taller en las tareas de fabricación que aún no tienen a nadie">Aplicar a sus tareas…</button>` : ''}</div>`;
  }
  function escandallo(p) {
    const pi = DATA.proyecto.partidas.indexOf(p); const u = usage(); const k = `esc:${p.ref_externa}`; const isOpen = open.has(k);
    const nOut = p.materiales.filter((m) => !matInCat(m)).length; const over = p.materiales.filter((m) => (u.get(m.ref_externa) || 0) > m.cantidad + 1e-9).length; const free = p.materiales.filter((m) => !u.get(m.ref_externa)).length;
    let h = `<div class="esc ${isOpen ? 'open' : ''}" data-p="${pi}"><div class="eh" data-esc="${esc(k)}"><b>Materiales · escandallo</b>
      <span class="pills">${p.extra?.fabricacion?.donde === 'externo' && p.extra.fabricacion.material !== 'nosotros' ? '<span class="pill w">lo pone el taller: no va a nuestra logística</span>' : ''}<span class="pill">${p.materiales.length} líneas</span>${nOut ? `<span class="pill">${nOut} fuera de catálogo</span>` : ''}${free ? `<span class="pill">${free} sin asignar</span>` : ''}${over ? `<span class="pill w">${over} repartido de más</span>` : ''}</span></div>
      <div class="eb"><label class="hint"><input type="checkbox" data-log ${p.enviar_a_logistica ? 'checked' : ''}> Enviar a logística al crear el proyecto (el escandallo ya está revisado)</label>
      <table class="mt"><thead><tr><th>Ref.</th><th>Descripción (catálogo)</th><th>Cant. total</th><th>Unidad</th><th>Nota</th><th>Asignado</th><th></th></tr></thead><tbody>`;
    p.materiales.forEach((m, mi) => {
      const used = u.get(m.ref_externa) || 0; const inC = matInCat(m);
      h += `<tr data-m="${mi}"><td class="ref">${esc(m.ref_externa.split('/').pop())}</td>
        <td><input class="d ${inC ? '' : 'nw'}" list="dlMat" value="${esc(m.descripcion)}" data-mf="descripcion" title="${inC ? 'En catálogo' : 'Fuera de catálogo: se crea con esta descripción'}"></td>
        <td><input class="c" type="number" min="0" step="any" value="${m.cantidad}" data-mf="cantidad"></td>
        <td><input class="u" value="${esc(m.unidad || '')}" data-mf="unidad"></td>
        <td><input value="${esc(m.nota || '')}" data-mf="nota" placeholder="calidad, cortes, acabado…"></td>
        <td><span class="asig ${used > m.cantidad + 1e-9 ? 'w' : used ? '' : 'z'}">${fmt(used)} / ${m.cantidad}</span></td>
        <td><button type="button" class="x" data-mdel title="Quitar línea" aria-label="Quitar línea">×</button></td></tr>`;
    });
    return `${h}</tbody></table><div class="add"><input list="dlMat" data-madd placeholder="Añadir material del catálogo o escribir uno nuevo…"><button type="button" data-maddbtn>Añadir</button></div></div></div>`;
  }
  function matChips(t) {
    const A = allMats();
    const chips = (t._mat || []).map((x, i) => {
      const e = A.get(x.ref); const name = e ? e.m.descripcion : `${x.ref} (no existe)`;
      return `<span class="chip ${e ? 'mat' : 'w'}" data-mi="${i}" title="${esc(x.ref)}">${esc(name)} ×<input class="q" type="number" min="0" step="any" value="${x.cantidad}" data-tmq><span class="u">${esc(e ? e.m.unidad || '' : '')}</span><button type="button" class="x" data-tmdel title="Quitar">×</button></span>`;
    }).join('');
    const used = new Set((t._mat || []).map((x) => x.ref)); const u = usage();
    let opts = '<option value="">Añadir material de la partida…</option>';
    DATA.proyecto.partidas.forEach((p) => {
      const av = p.materiales.filter((m) => !used.has(m.ref_externa)); if (!av.length) return;
      opts += `<optgroup label="${esc(`${p.codigo || ''} ${p.nombre}`)}">${av.map((m) => `<option value="${esc(m.ref_externa)}">${esc(m.descripcion)} — quedan ${fmt(m.cantidad - (u.get(m.ref_externa) || 0))} ${esc(m.unidad || '')}</option>`).join('')}</optgroup>`;
    });
    return `<div class="chips">${chips}<span class="add"><select data-tmadd>${opts}</select></span></div>`;
  }
  function chip(kind, i, x, t) {
    const map = { _cap: IDX.cap, _eq: IDX.eq, _sub: IDX.sub, _her: IDX.her }[kind];
    const known = map.has(norm(x.nombre));
    let cls = `chip ${known ? 'cat' : 'nw'}`; let extra = '';
    if (kind === '_her' && IDX.eq.has(norm(x.nombre))) cls = 'chip w';
    if (kind === '_cap' && x.cantidad > (t.operarios ?? 1)) cls = 'chip w';
    if (!known && kind === '_cap') extra += `<span class="tag">nueva en</span><select data-f="familia">${FAMILIAS().map((f) => `<option ${f === (x.familia || 'Otras') ? 'selected' : ''}>${esc(f)}</option>`).join('')}</select>`;
    else if (!known) extra += '<span class="tag">nueva</span>';
    const q = `<input class="q" type="number" min="1" step="1" value="${x.cantidad}" data-f="cantidad" title="Cantidad">`;
    const nt = kind === '_her' ? `<input class="nt" placeholder="nota" value="${esc(x.nota || '')}" data-f="nota">` : '';
    return `<span class="${cls}" data-k="${kind}" data-i="${i}">${esc(x.nombre)} ${extra}×${q}${nt}<button type="button" class="x" data-del title="Quitar">×</button></span>`;
  }
  const addBox = (kind, dl, ph) => `<span class="add"><input list="${dl}" data-add="${kind}" placeholder="${ph}"><button type="button" data-addbtn="${kind}">Añadir</button></span>`;
  function areaSelect(t) {
    const groups = {}; CAT.areas.forEach((a) => { (groups[a.tipo] = groups[a.tipo] || []).push(a); });
    const inCat = t.area && IDX.area.has(norm(t.area));
    let h = '<select data-area><option value="">— sin área concreta —</option>';
    if (t.area && !inCat) h += `<option selected value="${esc(t.area)}">${esc(t.area)} (no en catálogo)</option>`;
    for (const [g, arr] of Object.entries(groups)) h += `<optgroup label="${esc(g)}">${arr.map((a) => `<option value="${esc(a.nombre)}" ${inCat && norm(a.nombre) === norm(t.area) ? 'selected' : ''}>${esc(a.nombre)}${a.maquinas_fijas?.length ? ` · ${esc(a.maquinas_fijas.join(', '))}` : ''}</option>`).join('')}</optgroup>`;
    h += `</select> <select data-areatipo ${t.area ? 'disabled' : ''}><option value="">tipo…</option>${CAT.area_tipos.map((x) => `<option ${x === t.area_tipo ? 'selected' : ''}>${x}</option>`).join('')}</select>`;
    return h;
  }
  function desgloseHTML(t) {
    const filas = (t.desglose || []).map((d, i) => `<tr data-di="${i}">
      <td><input value="${esc(d.concepto || '')}" data-df="concepto" placeholder="Soldadura de nudos"></td>
      <td><select data-df="fase"><option value="">—</option>${FASES.map((f) => `<option ${f === d.fase ? 'selected' : ''}>${f}</option>`).join('')}</select></td>
      <td><input class="c" type="number" min="0" step="any" value="${d.cantidad ?? ''}" data-df="cantidad"></td>
      <td><input class="u" value="${esc(d.unidad || '')}" data-df="unidad" placeholder="nudos"></td>
      <td><input class="c" type="number" min="0" step="any" value="${d.rendimiento ?? ''}" data-df="rendimiento" title="h-persona por unidad"></td>
      <td><input class="c" type="number" min="0" step="any" value="${d.horas_persona ?? ''}" data-df="horas_persona"></td>
      <td><button type="button" class="x" data-ddel title="Quitar">×</button></td></tr>`).join('');
    return `<table class="mt dg"><thead><tr><th>Concepto</th><th>Fase</th><th>Cant.</th><th>Unidad</th><th>h-p/ud</th><th>h-persona</th><th></th></tr></thead><tbody>${filas}</tbody></table>
      <div class="inl"><button type="button" data-dadd>＋ Concepto</button><span class="hint">Σ ${coma(hpDesglose(t))} h-persona · cantidad × h-p/ud = h-persona; las horas de la tarea salen de aquí (÷ operarios).</span></div>`;
  }
  function depsHTML(t) {
    const todas = tasks().map((x) => x.t);
    const nom = (r) => { const o = todas.find((x) => x.ref_externa === r); return o ? o.nombre : `${r} (no existe)`; };
    const chips = (t.despues_de || []).map((d, i) => `<span class="chip ${todas.some((x) => x.ref_externa === depRef(d)) ? 'cat' : 'w'}" data-dpi="${i}">${esc(nom(depRef(d)))} · espera <input class="q" type="number" min="0" step="0.5" value="${typeof d === 'string' ? 0 : d.espera_h || 0}" data-dpe title="Horas de calendario de espera (secado, curado)"> h<button type="button" class="x" data-dpdel title="Quitar">×</button></span>`).join('');
    const ya = new Set((t.despues_de || []).map(depRef));
    const opts = todas.filter((x) => x !== t && !ya.has(x.ref_externa)).map((x) => `<option value="${esc(x.ref_externa)}">${esc(x.nombre)}</option>`).join('');
    return `<div class="chips">${chips}<span class="add"><select data-dpadd><option value="">Va después de…</option>${opts}</select></span></div>`;
  }
  function render() {
    const cont = $('#cmp-editor'); if (!cont || !DATA) return;
    const q = norm($('#cmp-q')?.value); const onlyW = $('#cmp-onlyw')?.checked;
    let h = ''; let nT = 0; let nW = 0; let hrs = 0; let hp = 0; const all = tasks();
    DATA.proyecto.partidas.forEach((p, pi) => {
      h += partHead(p) + escandallo(p);
      p.ots.forEach((ot, oi) => {
        const otOpen = !open.has(`otc:${ot.ref_externa}`);
        h += `<div class="ot" data-ot="${pi}:${oi}"><button type="button" class="x tog" data-ottog title="${otOpen ? 'Plegar' : 'Desplegar'}">${otOpen ? '▾' : '▸'}</button>
          <input class="otn" value="${esc(ot.titulo)}" maxlength="120" data-otf="titulo" aria-label="Título de la OT">
          <label class="hint">entrega <input type="date" value="${esc(ot.fecha_entrega || '')}" data-otf="fecha_entrega"></label>
          <select data-otf="prioridad" aria-label="Prioridad">${['', 'urgente', 'alta', 'normal', 'baja'].map((x) => `<option value="${x}" ${x === (ot.prioridad || '') ? 'selected' : ''}>${x || 'prioridad…'}</option>`).join('')}</select>
          <span class="hint">${ot.tareas.length} tareas · ${coma(ot.tareas.reduce((s, t) => s + (t.taller_externo ? 0 : (t.horas || 0) * Math.max(1, t.operarios ?? 1)), 0))} h-p</span>
          <button type="button" data-tadd>＋ Tarea</button><button type="button" class="del" data-otdel>Quitar OT</button></div>`;
        if (!otOpen) return;
        ot.tareas.forEach((t) => {
          const idx = all.findIndex((x) => x.t === t); const w = warnings(t);
          hrs += t.horas || 0; hp += (t.horas || 0) * (t.operarios ?? 1); if (w.length) nW++;
          const txt = norm([t.nombre, t.ref_externa, t.area, t.area_tipo, t.notas, ...t._cap.map((x) => x.nombre), ...t._eq.map((x) => x.nombre), ...t._sub.map((x) => x.nombre), ...t._her.map((x) => x.nombre)].join(' '));
          if (q && !txt.includes(q)) return; if (onlyW && !w.length) return; nT++;
          const isOpen = open.has(t.ref_externa);
          h += `<div class="task ${isOpen ? 'open' : ''} ${w.length ? 'hasw' : ''}" data-t="${idx}">
            <div class="th"><span class="n">${esc(t.nombre)}</span><span class="r">${esc(t.ref_externa.split('/').slice(-2).join('/'))}</span>
              <span class="pills">${t.taller_externo ? `<span class="pill ext">🏭 ${esc(t.taller_externo)} · ${coma(t.horas / JORNADA_H)} días</span>` : `${t.subcontrata_obra ? `<span class="pill ext">🏗 ${esc(t.subcontrata_obra)}</span>` : ''}<span class="pill">${coma(t.horas)} h × ${t.operarios ?? 1} op</span>`}${t.taller_externo ? '' : `<span class="pill">${esc(t.area || (t.area_tipo ? `tipo: ${t.area_tipo}` : 'sin área'))}</span>`}
              <span class="pill">${t._cap.length} cap · ${t._eq.length + t._sub.length} rec · ${t._her.length} herr · ${(t._mat || []).length} mat${t.despues_de?.length ? ` · ⤷${t.despues_de.length}` : ''}</span>${w.length ? `<span class="pill w">${w.length} aviso${w.length > 1 ? 's' : ''}</span>` : ''}</span></div>
            <div class="tb">
              <div class="row"><label>Nombre</label><div class="inl"><input class="tn" value="${esc(t.nombre)}" maxlength="120" data-tname><button type="button" class="del" data-tdel>Eliminar tarea</button></div></div>
              <div class="row"><label>Quién la hace</label><div class="inl">
                <select data-quien><option value="" ${t.taller_externo || t.subcontrata_obra ? '' : 'selected'}>👷 Nosotros</option><option value="taller" ${t.taller_externo ? 'selected' : ''}>🏭 Taller externo (en su taller)</option><option value="obra" ${t.subcontrata_obra ? 'selected' : ''}>🏗 Subcontrata aquí (montador autónomo…)</option></select>
                ${t.taller_externo || t.subcontrata_obra ? `<input list="dlProv" data-prov value="${esc(t.taller_externo || t.subcontrata_obra)}" placeholder="Proveedor…">` : ''}
                ${t.taller_externo ? `<span>Días <input type="number" min="0.5" step="0.5" value="${fmt((t.horas || 0) / JORNADA_H)}" data-dias></span><span class="hint">sin operarios ni capacidades propias</span>` : ''}</div></div>
              ${t.taller_externo ? '' : `<div class="row"><label>Duración</label><div class="inl">
                <span>Horas <input type="number" min="0.5" max="999" step="0.5" value="${t.horas}" data-num="horas"></span>
                <span>Operarios <input type="number" min="0" max="50" step="1" value="${t.operarios ?? 1}" data-num="operarios"></span>
                <span class="hint">${coma((t.horas || 0) * (t.operarios ?? 1))} h-persona${t.subcontrata_obra ? ' (operarios = personas que pone la subcontrata)' : ''}</span></div></div>
              <div class="row"><label>Desglose<br><span class="hint">de dónde salen las horas</span></label><div>${desgloseHTML(t)}</div></div>`}
              ${t.taller_externo ? '' : `<div class="row"><label>Área</label><div class="inl">${areaSelect(t)}</div></div>`}
              <div class="row"><label>Capacidades<br><span class="hint">qué tienen que saber hacer</span></label><div class="chips">${t._cap.map((x, i) => chip('_cap', i, x, t)).join('')}${addBox('_cap', 'dlCap', 'Añadir capacidad…')}</div></div>
              <div class="row"><label>Equipos<br><span class="hint">máquinas de las que hay pocas</span></label><div class="chips">${t._eq.map((x, i) => chip('_eq', i, x, t)).join('')}${addBox('_eq', 'dlEq', 'Añadir equipo…')}</div></div>
              <div class="row"><label>Subcontratas<br><span class="hint">grúa, plataforma, lacado…</span></label><div class="chips">${t._sub.map((x, i) => chip('_sub', i, x, t)).join('')}${addBox('_sub', 'dlSub', 'Añadir subcontrata…')}</div></div>
              <div class="row"><label>Herramientas<br><span class="hint">de mano, a preparar</span></label><div class="chips">${t._her.map((x, i) => chip('_her', i, x, t)).join('')}${addBox('_her', 'dlHer', 'Añadir herramienta…')}</div></div>
              <div class="row"><label>Materiales<br><span class="hint">qué consume de la partida</span></label>${matChips(t)}</div>
              <div class="row"><label>Va después de<br><span class="hint">y espera (secado…)</span></label>${depsHTML(t)}</div>
              <div class="row"><label>Notas</label><textarea rows="2" data-tnotas placeholder="Medidas, cotas, cuidados…">${esc(t.notas || '')}</textarea></div>
              ${w.length ? `<div class="row"><label>Avisos</label><ul class="warns">${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
            </div></div>`;
        });
      });
    });
    h += '<div class="inl cmp-pie"><button type="button" data-padd>＋ Partida</button></div>';
    if (!nT && (q || onlyW)) h += '<p class="hint">Ninguna tarea coincide con el filtro.</p>';
    cont.innerHTML = h;
    const mw = matWarnings();
    $('#cmp-sum').innerHTML = `<span><b>${all.length}</b> tareas</span><span><b>${coma(hrs)}</b> h · <b>${coma(hp)}</b> h-persona</span><span><b>${nW}</b> con avisos</span><span><b>${allMats().size}</b> materiales${mw.length ? ` · <b class="w">${mw.length} aviso(s) de material</b>` : ''}</span><span id="cmp-guardado">${esc(estadoGuardado)}</span>`;
  }
  function cambio() { render(); programarGuardado(); }
  function programarGuardado() {
    estadoGuardado = 'Guardando…'; const g = $('#cmp-guardado'); if (g) g.textContent = estadoGuardado;
    clearTimeout(guardarT); guardarT = setTimeout(guardar, 700);
  }
  async function guardar() {
    clearTimeout(guardarT); guardarT = null;
    if (!C || !DATA) return;
    try { await api('PUT', `/api/composiciones/${C.id}`, { datos: exportar() }); estadoGuardado = `✔ Guardado ${new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`; }
    catch (e) { estadoGuardado = `✕ No se ha guardado: ${e.message}`; aviso(e.message); }
    const g = $('#cmp-guardado'); if (g) g.textContent = estadoGuardado;
  }
  window.addEventListener('beforeunload', (ev) => { if (guardarT) { guardar(); ev.preventDefault(); } });

  /* ---------- acciones del editor ---------- */
  const T = (n) => tasks()[+n.closest('[data-t]').dataset.t].t;
  const Pp2 = (n) => { const x = tasks()[+n.closest('[data-t]').dataset.t]; return x?.p; };
  const Pp = (n) => DATA.proyecto.partidas[+n.closest('[data-p]').dataset.p];
  const OT = (n) => { const [pi, oi] = n.closest('[data-ot]').dataset.ot.split(':').map(Number); return { p: DATA.proyecto.partidas[pi], ot: DATA.proyecto.partidas[pi].ots[oi] }; };
  function guardarOpen() { ponerLocal('open', [...open].slice(-400)); }
  function deleteTask(ref) {
    let f = null; DATA.proyecto.partidas.forEach((p) => p.ots.forEach((ot) => { const i = ot.tareas.findIndex((t) => t.ref_externa === ref); if (i >= 0) f = { p, ot, i, t: ot.tareas[i] }; }));
    if (!f) return; const { ot, i, t } = f;
    ot.tareas.splice(i, 1);
    const preds = t.despues_de || []; let n = 0;
    tasks().forEach(({ t: o }) => {
      if (!o.despues_de) return; const k = o.despues_de.findIndex((d) => depRef(d) === ref); if (k < 0) return; n++;
      o.despues_de.splice(k, 1); preds.forEach((pd) => { if (!o.despues_de.some((d) => depRef(d) === depRef(pd))) o.despues_de.push(pd); });
      if (!o.despues_de.length) delete o.despues_de;
    });
    open.delete(ref); cambio(); aviso(`Tarea eliminada${n ? `; ${n} tarea(s) que iban después heredan sus dependencias` : ''}${ot.tareas.length ? '' : ' · la OT se ha quedado sin tareas'}`);
  }
  function addMat(inp) {
    const v = inp.value.trim(); if (!v) return; const p = Pp(inp); const c = MAT.get(norm(v));
    const m = { ref_externa: nextRef(p.ref_externa, 'M', (r) => allMats().has(r)), descripcion: c ? c.nombre : v, cantidad: 1 }; if (c?.unidad) m.unidad = c.unidad;
    p.materiales.push(m); open.add(`esc:${p.ref_externa}`); cambio();
  }
  function addFrom(inp) {
    const v = inp.value.trim(); if (!v) return; const t = T(inp); const k = inp.dataset.add;
    const map = { _cap: IDX.cap, _eq: IDX.eq, _sub: IDX.sub, _her: IDX.her }[k]; const c = map.get(norm(v)); const nombre = c ? c.nombre : v;
    if (t[k].some((x) => norm(x.nombre) === norm(nombre))) { aviso('Ya está en la tarea'); return; }
    t[k].push({ nombre, cantidad: 1, nota: '', familia: k === '_cap' && !c ? 'Otras' : undefined }); if (k === '_cap') t._had.cap = true;
    const ref = t.ref_externa; cambio();
    const n = [...document.querySelectorAll('[data-t]')].find((x) => T(x).ref_externa === ref); n?.querySelector(`[data-add="${k}"]`)?.focus();
  }
  function recalcularHoras(t) { if (t.desglose?.length) t.horas = arriba05(hpDesglose(t) / Math.max(1, t.operarios ?? 1)); }
  function nuevaTarea(ot) {
    const usadas = refsUsadas(); const ref = nextRef(ot.ref_externa, 'T', (r) => usadas.has(r));
    const t = { ref_externa: ref, nombre: 'Tarea nueva', horas: 1, operarios: 1 }; toInternal(t); ot.tareas.push(t); open.add(ref); cambio();
    setTimeout(() => { const n = [...document.querySelectorAll('[data-t]')].find((x) => T(x).ref_externa === ref); n?.querySelector('[data-tname]')?.select(); }, 0);
  }

  function eventos(cont) {
    cont.addEventListener('click', (e) => {
      const tg = e.target;
      const eh = tg.closest('[data-esc]'); if (eh) { const k = eh.dataset.esc; open.has(k) ? open.delete(k) : open.add(k); guardarOpen(); eh.parentElement.classList.toggle('open'); return; }
      if (tg.matches('[data-ottog]')) { const { ot } = OT(tg); const k = `otc:${ot.ref_externa}`; open.has(k) ? open.delete(k) : open.add(k); guardarOpen(); render(); return; }
      const th = tg.closest('.th'); if (th) { const t = T(th); open.has(t.ref_externa) ? open.delete(t.ref_externa) : open.add(t.ref_externa); guardarOpen(); th.parentElement.classList.toggle('open'); return; }
      if (tg.matches('[data-mdel]')) { const p = Pp(tg); const m = p.materiales[+tg.closest('tr').dataset.m]; p.materiales.splice(p.materiales.indexOf(m), 1); tasks().forEach(({ t }) => { t._mat = t._mat.filter((x) => x.ref !== m.ref_externa); }); cambio(); return; }
      if (tg.matches('[data-maddbtn]')) { addMat(tg.previousElementSibling); return; }
      if (tg.matches('[data-pedit]')) { const p = Pp(tg); const k = `pe:${p.ref_externa}`; open.has(k) ? open.delete(k) : open.add(k); guardarOpen(); render(); return; }
      if (tg.matches('[data-pdel]')) {
        const p = Pp(tg); if (DATA.proyecto.partidas.length === 1) { aviso('Es la única partida'); return; }
        if (!confirm(`¿Quitar la partida «${p.nombre}» con sus ${p.ots.length} OT y su material?`)) return;
        const gone = new Set((p.materiales || []).map((m) => m.ref_externa)); const tr = new Set(p.ots.flatMap((o) => o.tareas.map((t) => t.ref_externa)));
        DATA.proyecto.partidas.splice(DATA.proyecto.partidas.indexOf(p), 1);
        tasks().forEach(({ t }) => { t._mat = t._mat.filter((x) => !gone.has(x.ref)); if (t.despues_de) { t.despues_de = t.despues_de.filter((d) => !tr.has(depRef(d))); if (!t.despues_de.length) delete t.despues_de; } });
        cambio(); return;
      }
      if (tg.matches('[data-fabaplicar]')) {
        const p = Pp(tg); const f = p.extra?.fabricacion; if (!f?.taller) { aviso('Elige antes el taller'); return; }
        const cand = p.ots.flatMap((o) => o.tareas).filter((t) => !t.taller_externo && !t.subcontrata_obra && /(fabric|armad|soldad|cort|plegad|mecaniz|calder)/i.test(t.nombre));
        if (!cand.length) { aviso('No hay tareas de fabricación propias: añade una o elige el taller en cada tarea'); return; }
        if (!confirm(`¿Pasar a ${f.taller} estas tareas?\n\n${cand.map((t) => `· ${t.nombre}`).join('\n')}`)) return;
        cand.forEach((t) => { t.taller_externo = f.taller; t.operarios = 0; t.horas = Math.max(JORNADA_H, t.horas); });
        cambio(); return;
      }
      if (tg.matches('[data-otadd]')) { const p = Pp(tg); const usadas = refsUsadas(); const ref = nextRef(p.ref_externa, 'OT', (r) => usadas.has(r)); p.ots.push({ ref_externa: ref, titulo: 'OT nueva', tareas: [] }); nuevaTarea(p.ots[p.ots.length - 1]); return; }
      if (tg.matches('[data-otdel]')) {
        const { p, ot } = OT(tg); if (ot.tareas.length && !confirm(`¿Quitar la OT «${ot.titulo}» y sus ${ot.tareas.length} tareas?`)) return;
        [...ot.tareas].forEach((t) => deleteTask(t.ref_externa)); p.ots.splice(p.ots.indexOf(ot), 1); cambio(); return;
      }
      if (tg.matches('[data-tadd]')) { nuevaTarea(OT(tg).ot); return; }
      if (tg.matches('[data-padd]')) {
        const usadas = refsUsadas(); let n = DATA.proyecto.partidas.length; let cod; let ref;
        do { n++; cod = String(n).padStart(2, '0'); ref = `${DATA.proyecto.ref_externa}/${cod}`; } while (usadas.has(ref));
        const p = { ref_externa: ref, codigo: cod, nombre: 'Partida nueva', materiales: [], ots: [{ ref_externa: `${ref}/OT1`, titulo: 'Fabricación', tareas: [] }] };
        DATA.proyecto.partidas.push(p); open.add(`pe:${ref}`); nuevaTarea(p.ots[0]); return;
      }
      if (tg.matches('[data-tdel]')) {
        if (!tg.classList.contains('c')) { tg.classList.add('c'); tg.textContent = '¿Eliminar? Pulsa otra vez'; setTimeout(() => { if (tg.isConnected) { tg.classList.remove('c'); tg.textContent = 'Eliminar tarea'; } }, 3000); return; }
        deleteTask(T(tg).ref_externa); return;
      }
      if (tg.matches('[data-tmdel]')) { const t = T(tg); t._mat.splice(+tg.closest('[data-mi]').dataset.mi, 1); cambio(); return; }
      if (tg.matches('[data-del]')) { const c = tg.closest('.chip'); const t = T(c); t[c.dataset.k].splice(+c.dataset.i, 1); cambio(); return; }
      if (tg.matches('[data-addbtn]')) { addFrom(tg.previousElementSibling); return; }
      if (tg.matches('[data-dadd]')) { const t = T(tg); (t.desglose = t.desglose || []).push({ concepto: '', horas_persona: 0 }); cambio(); return; }
      if (tg.matches('[data-ddel]')) { const t = T(tg); t.desglose.splice(+tg.closest('[data-di]').dataset.di, 1); recalcularHoras(t); cambio(); return; }
      if (tg.matches('[data-dpdel]')) { const t = T(tg); t.despues_de.splice(+tg.closest('[data-dpi]').dataset.dpi, 1); if (!t.despues_de.length) delete t.despues_de; cambio(); }
    });
    cont.addEventListener('keydown', (e) => {
      if (e.target.matches('[data-madd]') && e.key === 'Enter') { e.preventDefault(); addMat(e.target); }
      if (e.target.matches('[data-add]') && e.key === 'Enter') { e.preventDefault(); addFrom(e.target); }
    });
    cont.addEventListener('change', (e) => {
      const n = e.target;
      if (n.matches('[data-madd], [data-add]')) return;
      if (n.matches('[data-mf]')) {
        const p = Pp(n); const m = p.materiales[+n.closest('tr').dataset.m]; const f = n.dataset.mf; const v = n.value.trim();
        if (f === 'cantidad') { const x = parseFloat(v); if (x > 0) m.cantidad = x; }
        else if (f === 'descripcion') { if (!v) return; m.descripcion = v; const c = MAT.get(norm(v)); if (c) { delete m.catalogo; if (c.unidad) m.unidad = c.unidad; } }
        else if (v) m[f] = v; else delete m[f];
        cambio(); return;
      }
      if (n.matches('[data-pf]')) { const p = Pp(n); const v = n.value.trim(); if (v) p[n.dataset.pf] = v.slice(0, n.dataset.pf === 'codigo' ? 30 : 120); cambio(); return; }
      if (n.matches('[data-fab]')) {
        const p = Pp(n); p.extra = p.extra || {}; const k = n.dataset.fab; const v = n.value.trim();
        if (k === 'donde') { if (v === 'externo') p.extra.fabricacion = { donde: 'externo', taller: null, material: 'taller' }; else delete p.extra.fabricacion; }
        else if (p.extra.fabricacion) {
          p.extra.fabricacion[k] = v || null;
          if (k === 'taller') { const pv = PROV.get(norm(v)); if (pv) { p.extra.fabricacion.taller = pv.nombre; p.extra.fabricacion.material = pv.zona === 'peninsula' ? 'taller' : 'nosotros'; } }
        }
        cambio(); return;
      }
      if (n.matches('[data-quien]')) {
        const t = T(n); const v = n.value; const prov = t.taller_externo || t.subcontrata_obra || Pp2(n)?.extra?.fabricacion?.taller || '';
        delete t.taller_externo; delete t.subcontrata_obra;
        if (v === 'taller') { t.taller_externo = prov || 'Taller'; t.operarios = 0; t.horas = Math.max(JORNADA_H, t.horas || JORNADA_H); }
        else if (v === 'obra') { t.subcontrata_obra = prov || 'Subcontrata'; if (!t.operarios) t.operarios = 1; }
        else if (!t.operarios) { t.operarios = 1; t.horas = Math.min(t.horas || 1, 8); }
        cambio(); return;
      }
      if (n.matches('[data-prov]')) { const t = T(n); const pv = PROV.get(norm(n.value)); const v = pv ? pv.nombre : n.value.trim(); if (!v) return; if (t.taller_externo) t.taller_externo = v.slice(0, 120); else t.subcontrata_obra = v.slice(0, 120); cambio(); return; }
      if (n.matches('[data-dias]')) { const t = T(n); const d = Math.max(0.5, Math.round((parseFloat(n.value) || 1) * 2) / 2); t.horas = d * JORNADA_H; cambio(); return; }
      if (n.matches('[data-log]')) { const p = Pp(n); if (n.checked) p.enviar_a_logistica = true; else delete p.enviar_a_logistica; cambio(); return; }
      if (n.matches('[data-otf]')) { const { ot } = OT(n); const f = n.dataset.otf; const v = n.value.trim(); if (f === 'titulo') { if (v) ot.titulo = v.slice(0, 120); } else if (v) ot[f] = v; else delete ot[f]; cambio(); return; }
      if (n.matches('[data-tname]')) { const v = n.value.trim(); if (v) T(n).nombre = v.slice(0, 120); cambio(); return; }
      if (n.matches('[data-tnotas]')) { const t = T(n); const v = n.value.trim(); if (v) t.notas = v.slice(0, 4000); else delete t.notas; cambio(); return; }
      if (n.matches('[data-tmadd]')) { const t = T(n); if (n.value) { const e2 = allMats().get(n.value); const rest = Math.max(0, e2.m.cantidad - (usage().get(n.value) || 0)); t._mat.push({ ref: n.value, cantidad: fmt(rest) || e2.m.cantidad }); } cambio(); return; }
      if (n.matches('[data-tmq]')) { const t = T(n); const v = parseFloat(n.value); if (v > 0) t._mat[+n.closest('[data-mi]').dataset.mi].cantidad = v; cambio(); return; }
      if (n.matches('[data-df]')) {
        const t = T(n); const d = t.desglose[+n.closest('[data-di]').dataset.di]; const f = n.dataset.df; const v = n.value.trim();
        if (['cantidad', 'rendimiento', 'horas_persona'].includes(f)) { const x = parseFloat(v.replace(',', '.')); if (x > 0) d[f] = x; else delete d[f]; }
        else if (v) d[f] = v.slice(0, f === 'concepto' ? 200 : 20); else delete d[f];
        if (f !== 'horas_persona' && d.cantidad > 0 && d.rendimiento > 0) d.horas_persona = fmt(d.cantidad * d.rendimiento);
        recalcularHoras(t); cambio(); return;
      }
      if (n.matches('[data-dpadd]')) { const t = T(n); if (n.value) (t.despues_de = t.despues_de || []).push(n.value); cambio(); return; }
      if (n.matches('[data-dpe]')) {
        const t = T(n); const i = +n.closest('[data-dpi]').dataset.dpi; const r = depRef(t.despues_de[i]); const e2 = Math.min(720, Math.round((parseFloat(n.value) || 0) * 2) / 2);
        t.despues_de[i] = e2 > 0 ? { ref: r, espera_h: e2 } : r; cambio(); return;
      }
      const t = T(n);
      if (n.closest('.chip')) { const c = n.closest('.chip'); const x = t[c.dataset.k][+c.dataset.i]; const f = n.dataset.f; x[f] = f === 'cantidad' ? Math.max(1, parseInt(n.value, 10) || 1) : n.value; }
      else if (n.matches('[data-num]')) {
        const f = n.dataset.num; let v = parseFloat(n.value);
        if (f === 'horas') v = Math.max(0.5, Math.round(v * 2) / 2 || 0.5); else v = Math.max(0, Math.min(50, Math.round(v) || 0));
        t[f] = v; if (f === 'operarios') recalcularHoras(t);
      } else if (n.matches('[data-area]')) { if (n.value) { t.area = n.value; delete t.area_tipo; } else delete t.area; }
      else if (n.matches('[data-areatipo]')) { if (n.value) t.area_tipo = n.value; else delete t.area_tipo; }
      cambio();
    });
  }

  /* ---------- ficha de una composición ---------- */
  async function abrir(id) {
    clearTimeout(sondeo); if (guardarT) await guardar();
    try { C = await api('GET', `/api/composiciones/${id}`); } catch (e) { aviso(e.message); return; }
    history.replaceState(null, '', `/compositor.html?id=${id}`);
    DATA = null; if (C.datos) { try { setData(C.datos); } catch (e) { aviso(e.message); } }
    estadoGuardado = C.cambiado ? `Guardado ${fecha(C.cambiado)}` : '';
    pintarFicha(); pintarLista();
    if (C.ia_estado === 'creando') sondeo = setTimeout(() => abrir(id), 2500);
  }
  function pintarFicha() {
    const c = C; const det = $('#cmp-det');
    const creando = c.ia_estado === 'creando';
    const ia = el('details', { class: 'cmp-ia', open: !!(c.ia_dudas?.length || c.ia_avisos?.length) && !c.proyecto_id },
      el('summary', {}, creando ? `🤖 La IA está componiendo… (${c.ia_fase || 'empezando'})` : c.ia_estado === 'error' ? `⚠ La IA no ha podido: ${c.ia_error}` : c.ia_borrador ? `🤖 Preparado por la IA${c.ia_modelo ? ` · ${c.ia_modelo}` : ''}${c.ia_ms ? ` · ${Math.round(c.ia_ms / 1000)} s` : ''}${c.ia_dudas?.length ? ` · ${c.ia_dudas.length} duda(s)` : ''}` : '✎ Hecho a mano'),
      c.ia_resumen ? el('p', {}, c.ia_resumen) : null,
      c.ia_dudas?.length ? [el('b', {}, 'Dudas (lo que ha supuesto o falta saber):'), el('ul', {}, c.ia_dudas.map((d) => el('li', {}, d)))] : null,
      c.ia_avisos?.length ? [el('b', {}, 'Avisos:'), el('ul', { class: 'warns' }, c.ia_avisos.map((d) => el('li', {}, d)))] : null,
      c.ia_skills?.length ? el('p', { class: 'ayuda' }, `🧠 Skills usadas: ${c.ia_skills.join(' · ')}`) : null,
      c.prompt ? el('details', {}, el('summary', { class: 'ayuda' }, 'Lo que se pidió'), el('pre', { class: 'cmp-prompt' }, c.prompt)) : null,
      c.adjuntos?.length ? el('p', { class: 'ayuda' }, '📎 ', c.adjuntos.map((a) => el('a', { href: `/api/presupuestos-adjuntos/${a.id}`, target: '_blank', rel: 'noopener' }, `${a.nombre} `))) : null);
    const cuadre = c.cuadre?.length ? el('table', { class: 'mt cmp-cuadre' },
      el('thead', {}, el('tr', {}, el('th', {}, 'Partida'), el('th', {}, 'h-persona compuestas'), el('th', {}, 'h presupuestadas'), el('th', {}, 'Diferencia'))),
      el('tbody', {}, c.cuadre.map((q) => {
        const dif = q.h_presupuesto ? Math.round(((q.h_persona - q.h_presupuesto) / q.h_presupuesto) * 100) : null;
        return el('tr', {}, el('td', {}, `${q.partida} ${q.nombre}`), el('td', { class: 'n' }, coma(q.h_persona)), el('td', { class: 'n' }, q.h_presupuesto == null ? '—' : coma(q.h_presupuesto)),
          el('td', { class: `n ${dif != null && Math.abs(dif) > 25 ? 'w' : ''}` }, dif == null ? '—' : `${dif > 0 ? '+' : ''}${dif} %`));
      }))) : null;
    const bot = (t, f, cls = 'ghost', attrs = {}) => el('button', { type: 'button', class: cls, onclick: f, ...attrs }, t);
    det.replaceChildren(el('div', { class: 'panel cmp-ficha' },
      el('div', { class: 'cmp-cab' },
        el('input', { class: 'cmp-titulo', value: c.titulo, maxlength: 200, 'aria-label': 'Título', onchange: async (ev) => { try { await api('PUT', `/api/composiciones/${c.id}`, { titulo: ev.target.value }); C.titulo = ev.target.value; pintarLista(); } catch (e2) { aviso(e2.message); } } }),
        el('span', { class: `cmp-estado ${c.estado}` }, c.estado === 'creada' ? `✔ Proyecto ${c.proyecto_codigo || ''}` : c.estado === 'descartada' ? 'descartada' : 'borrador')),
      el('p', { class: 'ayuda' }, c.presupuesto_id ? ['Del presupuesto ', el('a', { href: `/presupuestos.html?id=${c.presupuesto_id}` }, c.presupuesto_codigo), ` (${c.presupuesto_estado})`] : 'Sin presupuesto', ` · ${c.creado_por_nombre || ''} · ${fecha(c.creado)}`,
        c.proyecto_id ? [' · ', el('a', { href: `/proyectos.html?p=${c.proyecto_id}` }, 'Abrir el proyecto →')] : null),
      c.proyecto_id && DATA && tasks().some(({ t }) => t.taller_externo || t.subcontrata_obra) ? el('p', { class: 'pz-nuevos' }, '🏭 Tiene trabajo fuera: pide precio o haz el pedido al taller desde la OT del proyecto con «🏭 Subcontratar…» (al enviar el pedido arranca su seguimiento). ', el('a', { class: 'boton ghost mini', href: `/proyectos.html?p=${c.proyecto_id}` }, 'Ir al proyecto')) : null,
      el('div', { class: 'cmp-acc' },
        bot(c.proyecto_id ? '⟳ Actualizar el proyecto…' : '🏗 Crear el proyecto…', crear, 'primario', { disabled: creando || !DATA, title: 'Abre la vista previa de la importación (Proyectos › Importar): nombres que faltan, avisos y confirmar' }),
        bot('✔ Comprobar', comprobar, 'ghost', { disabled: creando || !DATA, title: 'Vista previa de la importación sin crear nada' }),
        bot('🤖 Rehacer con IA…', rehacer, 'ghost', { disabled: creando }),
        el('a', { class: 'boton ghost', href: `/api/composiciones/${c.id}/archivo?descargar=1` }, '⬇ JSON'),
        c.estado !== 'creada' ? bot(c.estado === 'descartada' ? '↺ Recuperar' : '✕ Descartar', async () => { await api('PUT', `/api/composiciones/${c.id}`, { estado: c.estado === 'descartada' ? 'borrador' : 'descartada' }); abrir(c.id); cargarLista(); }) : null),
      ia, cuadre),
    creando || !DATA ? null : el('div', { class: 'panel cmp-ed', id: 'cmp' },
      el('div', { class: 'bar' }, el('input', { type: 'search', id: 'cmp-q', placeholder: 'Filtrar tareas, recursos o herramientas…', oninput: render }),
        bot('Abrir todas', () => { tasks().forEach(({ t }) => open.add(t.ref_externa)); guardarOpen(); render(); }),
        bot('Cerrar todas', () => { tasks().forEach(({ t }) => open.delete(t.ref_externa)); guardarOpen(); render(); }),
        el('label', { class: 'hint' }, el('input', { type: 'checkbox', id: 'cmp-onlyw', onchange: render }), ' Solo con avisos'),
        el('span', { class: 'legend' }, el('span', { class: 'chip cat' }, 'en catálogo'), el('span', { class: 'chip nw' }, 'nueva (se creará)'), el('span', { class: 'chip w' }, 'revisar'))),
      el('div', { class: 'sum', id: 'cmp-sum' }), el('div', { id: 'cmp-editor' })));
    if (!creando && DATA) { eventos($('#cmp-editor')); render(); }
  }
  async function crear() {
    await guardar();
    location.href = `/proyectos.html?componer=${C.id}`;
  }
  async function comprobar() {
    await guardar();
    let r;
    try { const archivo = await api('GET', `/api/composiciones/${C.id}/archivo`); r = await api('POST', '/api/importar?simular=1', { archivo, resoluciones: {} }); } catch (e) { aviso(e.message); return; }
    const R = r.resumen || {};
    const d = el('dialog', { class: 'dlg-cos cmp-dlg' }, el('h2', {}, r.errores?.length ? '✕ No se podría crear' : '✔ Se puede crear'),
      R.tareas ? el('p', {}, `${R.partidas?.crear || 0} partida(s), ${R.ots?.crear || 0} OT, ${R.tareas?.crear || 0} tareas nuevas${R.tareas?.actualizar ? ` y ${R.tareas.actualizar} actualizadas` : ''}${R.externas ? ` (${R.externas} en talleres externos o subcontratadas)` : ''} · ${coma(R.horas || 0)} h · ${coma(R.horas_persona || 0)} h-persona · ${R.materiales?.crear || 0} materiales.`) : null,
      r.errores?.length ? [el('b', {}, 'Errores (hay que corregirlos):'), el('ul', { class: 'warns' }, r.errores.map((x) => el('li', {}, `${x.ruta}: ${x.mensaje}`)))] : null,
      r.resolver?.length ? [el('b', {}, `Nombres que no existen en el planificador (${r.resolver.length}): se resuelven al crear`), el('ul', {}, r.resolver.slice(0, 30).map((x) => el('li', {}, `${x.clase}: ${x.nombre} → ${x.accion}${x.estado === 'parecido' ? ' (parecido)' : ''}`)))] : null,
      r.avisos?.length ? [el('b', {}, `Avisos (${r.avisos.length}):`), el('ul', { class: 'warns' }, r.avisos.slice(0, 40).map((x) => el('li', {}, `${x.ruta}: ${x.mensaje}`)))] : null,
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cerrar'), r.errores?.length ? null : el('button', { type: 'button', class: 'primario', onclick: crear }, C.proyecto_id ? '⟳ Actualizar el proyecto…' : '🏗 Crear el proyecto…')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
  }
  async function rehacer() {
    const ta = el('textarea', { rows: 5, placeholder: 'Indicaciones para la IA (opcional): «separa la pintura en otra OT», «montaje con 3 operarios»…' }, C.prompt || '');
    const d = el('dialog', { class: 'dlg-cos cmp-dlg' }, el('h2', {}, '🤖 Rehacer con IA'),
      el('p', { class: 'ayuda' }, `Vuelve a componer el proyecto${C.presupuesto_id ? ` desde el presupuesto ${C.presupuesto_codigo}` : ''}. Lo que hayas editado en el borrador se pierde.`), ta,
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'primario', onclick: async () => { try { await api('POST', `/api/composiciones/${C.id}/ia`, { prompt: ta.value }); d.close(); abrir(C.id); } catch (e) { aviso(e.message); } } }, '🤖 Rehacer')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
  }

  /* ---------- lista y nueva ---------- */
  async function cargarLista() { try { lista = await api('GET', `/api/composiciones${$('#cmp-todas').checked ? '?todas=1' : ''}`); } catch (e) { aviso(e.message); lista = []; } pintarLista(); }
  function pintarLista() {
    $('#cmp-items').replaceChildren(...(lista.length ? lista.map((x) => el('button', { type: 'button', class: `cmp-item ${C?.id === x.id ? 'activo' : ''} ${x.estado}`, onclick: () => abrir(x.id) },
      el('b', {}, x.titulo), el('small', {}, [x.cliente, x.presupuesto_codigo].filter(Boolean).join(' · ') || 'sin presupuesto'),
      el('small', { class: x.estado === 'creada' ? 'pz-verde' : x.ia_estado === 'creando' ? 'pz-azul' : x.ia_estado === 'error' ? 'pz-rojo' : '' },
        x.estado === 'creada' ? `✔ ${x.proyecto_codigo || 'creado'}` : x.ia_estado === 'creando' ? `🤖 ${x.ia_fase || 'componiendo…'}` : x.ia_estado === 'error' ? '⚠ error de la IA' : `${x.tareas || 0} tareas · borrador`)))
      : [el('p', { class: 'ayuda' }, 'Aún no hay ninguna. Pulsa «＋ Nueva» o, en un presupuesto aceptado, «🏗 Componer proyecto».')]));
  }
  async function nueva() {
    let pres = [];
    try { pres = await api('GET', '/api/composiciones/presupuestos'); } catch (e) { aviso(e.message); return; }
    const sel = el('select', { 'aria-label': 'Presupuesto' }, el('option', { value: '' }, '— sin presupuesto (lo describo yo o adjunto un PDF) —'),
      ['aceptado', 'enviado', 'preparacion'].map((est) => { const xs = pres.filter((p) => p.estado === est); return xs.length ? el('optgroup', { label: est === 'aceptado' ? 'Aceptados' : est === 'enviado' ? 'Enviados' : 'En preparación' }, xs.map((p) => el('option', { value: p.id }, `${p.codigo} · ${p.cliente || ''} · ${p.titulo || ''}${p.composicion_id ? ' (ya tiene composición)' : ''}`))) : null; }));
    const tit = el('input', { maxlength: 200, placeholder: 'Título (p. ej. Escalera y barandilla · Es Castell)' });
    const desc = el('textarea', { rows: 5, placeholder: 'Qué hay que hacer: medidas, materiales, acabado, montaje… (o adjunta el presupuesto externo en PDF)' });
    const fich = el('input', { type: 'file', multiple: true });
    const ia = el('input', { type: 'checkbox', checked: true });
    const sinPres = el('div', { class: 'cmp-sinpres' }, el('label', {}, el('span', {}, 'Título'), tit), el('label', {}, el('span', {}, 'Descripción'), desc), el('label', {}, el('span', {}, 'Adjuntos (PDF, fotos, Excel)'), fich));
    sel.addEventListener('change', () => { sinPres.hidden = !!sel.value; });
    const ok = el('button', { type: 'button', class: 'primario' }, '🏗 Componer');
    const d = el('dialog', { class: 'dlg-cos cmp-dlg' }, el('h2', {}, '🏗 Nueva composición'),
      el('label', { class: 'cmp-campo' }, el('span', {}, 'Desde el presupuesto'), sel), sinPres,
      el('label', { class: 'co-chk' }, ia, ' Prepararlo con la IA (si no, empiezas con un borrador vacío)'),
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cancelar'), ok));
    ok.addEventListener('click', async () => {
      ok.disabled = true; ok.textContent = 'Preparando…';
      try {
        const ids = [];
        for (const f of fich.files) { const r = await fetch('/api/presupuestos-adjuntos', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': f.type || 'application/octet-stream', 'X-Nombre': encodeURIComponent(f.name) }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'No se pudo subir'); ids.push(j.id); }
        const r = await api('POST', '/api/composiciones', { presupuesto_id: sel.value ? Number(sel.value) : null, titulo: tit.value || null, prompt: desc.value || null, adjunto_ids: ids, ia: ia.checked });
        d.close(); await cargarLista(); abrir(r.id); if (r.existia) aviso('Ese presupuesto ya tenía una composición: te la abro');
      } catch (e) { aviso(e.message); ok.disabled = false; ok.textContent = '🏗 Componer'; }
    });
    d.addEventListener('close', () => d.remove()); document.body.append(d); d.showModal();
  }

  /* ---------- Skills del compositor ---------- */
  async function skills() {
    let ls = await api('GET', '/api/presupuesto-skills?ambito=composicion'); let sel = ls[0]?.id || null;
    const izq = el('div', { class: 'pz-sk-lista' }); const der = el('div', { class: 'pz-sk-ed' });
    const pintar = () => {
      izq.replaceChildren(...ls.map((s) => el('button', { type: 'button', class: `pz-sk-it ${s.id === sel ? 'activo' : ''} ${s.activo ? '' : 'off'}`, onclick: () => { sel = s.id; pintar(); } }, `${s.siempre ? '★ ' : ''}${s.nombre}`)),
        el('button', { type: 'button', class: 'ghost mini', onclick: async () => { const n = prompt('Nombre de la Skill (p. ej. Escaleras · composición)'); if (!n) return; try { const r = await api('POST', '/api/presupuesto-skills', { nombre: n, ambito: 'composicion' }); ls = await api('GET', '/api/presupuesto-skills?ambito=composicion'); sel = r.id; pintar(); } catch (e) { aviso(e.message); } } }, '＋ Nueva'));
      const s = ls.find((x) => x.id === sel); if (!s) { der.replaceChildren(); return; }
      const ta = el('textarea', { class: 'pz-md', rows: 22 }, s.contenido);
      der.replaceChildren(el('h3', {}, s.nombre, el('small', { class: 'ayuda' }, ` · v${s.version}${s.cambiado_por_nombre ? ` · ${s.cambiado_por_nombre}` : ''}`)), ta,
        el('div', { class: 'pz-acc' },
          el('button', { type: 'button', class: 'primario', onclick: async () => { try { await api('PUT', `/api/presupuesto-skills/${s.id}`, { contenido: ta.value }); ls = await api('GET', '/api/presupuesto-skills?ambito=composicion'); pintar(); aviso('Guardada (queda la versión anterior)'); } catch (e) { aviso(e.message); } } }, 'Guardar'),
          el('a', { class: 'boton ghost', href: `/api/presupuesto-skills/${s.id}/md` }, '⬇ .md'),
          el('label', { class: 'co-chk' }, el('input', { type: 'checkbox', checked: s.activo, onchange: async (ev) => { await api('PUT', `/api/presupuesto-skills/${s.id}`, { activo: ev.target.checked }); ls = await api('GET', '/api/presupuesto-skills?ambito=composicion'); pintar(); } }), ' Activa'),
          s.nombre === 'Reglas de composición' ? el('span', { class: 'ayuda' }, 'Se usa siempre') : el('label', { class: 'co-chk' }, el('input', { type: 'checkbox', checked: s.siempre, onchange: async (ev) => { await api('PUT', `/api/presupuesto-skills/${s.id}`, { siempre: ev.target.checked }); ls = await api('GET', '/api/presupuesto-skills?ambito=composicion'); pintar(); } }), ' Usar siempre'),
          el('label', {}, 'Palabras clave ', el('input', { value: s.claves || '', placeholder: 'escalera, barandilla…', onchange: async (ev) => { await api('PUT', `/api/presupuesto-skills/${s.id}`, { claves: ev.target.value }); } }))));
    };
    const imp = el('input', { type: 'file', accept: '.zip,.md', hidden: true, onchange: async (ev) => {
      const f = ev.target.files[0]; if (!f) return;
      try { const r = await fetch(`/api/presupuesto-skills/importar?ambito=composicion&nombre=${encodeURIComponent(f.name)}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream' }, body: f }); const j = await r.json(); if (!r.ok) throw new Error(j.error); aviso(`Nuevas: ${j.nuevas.length} · actualizadas: ${j.actualizadas.length}`); ls = await api('GET', '/api/presupuesto-skills?ambito=composicion'); pintar(); } catch (e) { aviso(e.message); }
    } });
    const d = el('dialog', { class: 'dlg-cos pz-dlg pz-dlg-skills' }, el('h2', {}, '🧠 Skills del compositor'),
      el('p', { class: 'ayuda' }, 'Cómo se compone un proyecto: estructura, rendimientos (h-persona por unidad), recursos y dependencias. La IA las sigue al preparar el borrador; con lo que corrijáis y lo real de los partes se irán afinando.'),
      el('div', { class: 'pz-sk' }, izq, der),
      el('div', { class: 'acciones' }, el('button', { type: 'button', class: 'ghost', onclick: () => imp.click() }, '⬆ Importar .zip / .md'), imp, el('button', { type: 'button', class: 'ghost', onclick: () => d.close() }, 'Cerrar')));
    d.addEventListener('close', () => d.remove()); document.body.append(d); pintar(); d.showModal();
  }

  /* ---------- arranque ---------- */
  async function iniciar() {
    let yo;
    try { yo = await api('GET', '/api/me'); } catch { location.href = '/login.html'; return; }
    window.s360.iniciar(yo);
    $('#cmp-nueva').onclick = nueva; $('#cmp-skills').onclick = skills; $('#cmp-todas').onchange = cargarLista;
    try { setCat(await api('GET', '/api/importar/catalogo')); } catch (e) { aviso(`Catálogo: ${e.message}`); setCat({}); }
    try { setProv(await api('GET', '/api/composiciones/proveedores')); } catch { setProv([]); }
    await cargarLista();
    const q = new URLSearchParams(location.search);
    if (q.get('presupuesto')) {
      try { const r = await api('POST', '/api/composiciones', { presupuesto_id: Number(q.get('presupuesto')) }); await cargarLista(); abrir(r.id); } catch (e) { aviso(e.message); }
    } else if (q.get('id')) abrir(Number(q.get('id')));
  }
  iniciar();
})();
