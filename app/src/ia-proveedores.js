// Proveedores de IA (Recursos › IA › Proveedor de IA): la clave de API de Anthropic, OpenAI o Google.
//  · Solo quien tiene el permiso «usuarios». La clave se guarda CIFRADA (AES-256-GCM, misma clave de
//    servidor que el correo: fuera de la base de datos) y nunca vuelve al navegador: solo «…abcd».
//  · «Probar» pide la lista de modelos al proveedor (no gasta tokens) y la guarda para elegir modelo.
//  · Si en el panel no hay clave, vale la del entorno (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY).
//  · claveDe() / activo() son lo que usará el asistente (fase 2).
const { query } = require('./db');
const { cifrar, descifrar } = require('./correo');

// Modelos que no sirven para un asistente de texto con herramientas
const RARO = /robotic|embed|aqa|image|imagen|vision|audio|tts|speech|transcri|realtime|live|native|search|veo|lyria|learnlm|gemma|computer-use|moderation|dall|whisper|babbage|davinci|codex/i;
// Orden: estables antes que preview/exp, versión más nueva primero, y dentro: flash, pro, flash-lite…
const version = (id) => Number((id.match(/(\d+(?:\.\d+)?)/) || [0, 0])[1]);
const peso = (id) => (/preview|exp/.test(id) ? 100 : 0) + (/-\d{3,}|\d{4}-\d\d/.test(id) ? 10 : 0) + (/lite|nano|-mini/.test(id) ? 2 : /pro/.test(id) ? 1 : 0);
const orden = (a, b) => (peso(a) >= 100) - (peso(b) >= 100) || version(b) - version(a) || peso(a) - peso(b) || a.localeCompare(b);

const PROV = {
  anthropic: {
    nombre: 'Anthropic (Claude)', env: 'ANTHROPIC_API_KEY', consola: 'https://console.anthropic.com/settings/keys',
    modelos: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], def: 'claude-sonnet-5-5',
    async listar(k) {
      const r = await pedir('https://api.anthropic.com/v1/models?limit=100', { 'x-api-key': k, 'anthropic-version': '2023-06-01' });
      return (r.data || []).map((m) => m.id);
    },
  },
  openai: {
    nombre: 'OpenAI (ChatGPT)', env: 'OPENAI_API_KEY', consola: 'https://platform.openai.com/api-keys',
    modelos: [], def: '',
    async listar(k) {
      const r = await pedir('https://api.openai.com/v1/models', { authorization: `Bearer ${k}` });
      return (r.data || []).map((m) => m.id).filter((id) => /^(gpt|o\d|chatgpt)/.test(id) && !RARO.test(id) && !/instruct|0301|0613/.test(id)).sort(orden);
    },
  },
  google: {
    nombre: 'Google (Gemini)', env: 'GEMINI_API_KEY', consola: 'https://aistudio.google.com/app/apikey',
    modelos: [], def: '',
    async listar(k) {
      const r = await pedir('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { 'x-goog-api-key': k });
      return (r.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name).replace(/^models\//, '')).filter((id) => /^gemini/.test(id) && !RARO.test(id)).sort(orden);
    },
  },
};

async function pedir(url, headers) {
  let r;
  try { r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) }); }
  catch (e) { throw new Error(`No se pudo conectar con el proveedor (${e.cause?.code || e.name})`); }
  let j = {}; try { j = await r.json(); } catch { /* sin cuerpo */ }
  if (r.status === 401 || r.status === 403) throw new Error('La clave no es válida o no tiene permiso');
  if (r.status === 400 && /api.?key/i.test(JSON.stringify(j))) throw new Error('La clave no es válida');
  if (r.status === 429) throw new Error('El proveedor dice que se ha pasado el límite o no hay saldo (429)');
  if (!r.ok) throw new Error(`El proveedor respondió ${r.status}: ${j.error?.message || ''}`.trim());
  return j;
}

const fallo = (s, m) => Object.assign(new Error(m), { status: s });
async function leer() {
  const { rows } = await query(`SELECT valor FROM ajustes WHERE clave = 'ia_proveedores'`);
  let v = {}; try { v = rows.length ? (typeof rows[0].valor === 'string' ? JSON.parse(rows[0].valor) : rows[0].valor) : {}; } catch { v = {}; }
  return { activo: v.activo || null, p: v.p || {} };
}
async function guardar(v) {
  await query(`INSERT INTO ajustes (clave, valor) VALUES ('ia_proveedores', $1)
    ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`, [JSON.stringify(v)]);
}

function claveGuardada(c) {
  if (!c?.clave) return null;
  try { return descifrar(c.clave); } catch { console.error('IA: no se pudo descifrar una clave guardada (¿cambió la clave del servidor?)'); return null; }
}
async function claveDe(id) {
  const v = await leer();
  return claveGuardada(v.p[id]) || process.env[PROV[id]?.env] || null;
}
// Proveedor y modelo con los que trabajará el asistente (o null si no hay nada configurado)
async function activo() {
  const v = await leer();
  const id = v.activo && PROV[v.activo] ? v.activo : Object.keys(PROV).find((k) => claveGuardada(v.p[k]) || process.env[PROV[k].env]);
  if (!id) return null;
  const clave = claveGuardada(v.p[id]) || process.env[PROV[id].env];
  if (!clave) return null;
  return { proveedor: id, modelo: v.p[id]?.modelo || PROV[id].def, clave };
}

async function vista() {
  const v = await leer();
  const act = await activo();
  return {
    activo: act?.proveedor || null,
    proveedores: Object.entries(PROV).map(([id, d]) => {
      const c = v.p[id] || {};
      const guardada = !!c.clave;
      const env = !guardada && !!process.env[d.env];
      return {
        id, nombre: d.nombre, consola: d.consola,
        configurada: guardada || env, origen: guardada ? 'panel' : env ? 'servidor' : null,
        final: guardada ? c.final : env ? `…${String(process.env[d.env]).slice(-4)}` : null,
        modelo: c.modelo || d.def, modelos: [...new Set([...(c.modelos || []), ...d.modelos])],
        guardada_por: c.por || null, guardada_en: c.en || null, prueba: c.prueba || null,
      };
    }),
  };
}

async function probar(id, usuario) {
  const d = PROV[id]; if (!d) throw fallo(404, 'Proveedor desconocido');
  const k = await claveDe(id);
  if (!k) throw fallo(400, 'Primero guarda una clave');
  const v = await leer(); const c = v.p[id] || (v.p[id] = {});
  try {
    const modelos = (await d.listar(k)).slice(0, 80);
    c.modelos = modelos;
    // Modelo por defecto (o si el elegido solo no está en la lista): el primero, que es el estable más nuevo
    if (modelos.length && (!c.modelo || c.modelo_auto || !modelos.includes(c.modelo))) {
      const def = d.def && modelos.includes(d.def) ? d.def : modelos.find((m) => /flash|sonnet|gpt/.test(m) && !/lite|-mini|nano|preview|exp/.test(m)) || modelos[0];
      c.modelo = def; c.modelo_auto = true;
    }
    c.prueba = { ok: true, en: new Date().toISOString(), por: usuario.nombre, msg: `Conecta · ${modelos.length} modelos disponibles` };
  } catch (e) {
    c.prueba = { ok: false, en: new Date().toISOString(), por: usuario.nombre, msg: e.message };
  }
  await guardar(v);
  return c.prueba;
}

function montar(app, asyncH, auth) {
  const admin = auth.permiso('usuarios');
  app.get('/api/ia/proveedores', admin, asyncH(async (req, res) => res.json(await vista())));

  app.put('/api/ia/proveedores/:id', admin, asyncH(async (req, res) => {
    const id = req.params.id; const d = PROV[id]; if (!d) throw fallo(404, 'Proveedor desconocido');
    const b = req.body || {}; const v = await leer(); const c = v.p[id] || (v.p[id] = {});
    if (b.borrar_clave) {
      v.p[id] = { modelo: c.modelo };
      if (v.activo === id) v.activo = null;
    } else if (b.clave != null) {
      const k = String(b.clave).trim();
      if (k.length < 20 || k.length > 400 || /\s/.test(k)) throw fallo(400, 'Eso no parece una clave de API (sin espacios, 20+ caracteres)');
      Object.assign(c, { clave: cifrar(k), final: `…${k.slice(-4)}`, por: req.usuario.nombre, en: new Date().toISOString(), prueba: null });
      if (!v.activo) v.activo = id;
    }
    if (b.modelo != null) {
      const m = String(b.modelo).trim();
      if (m && !/^[\w.:/-]{2,80}$/.test(m)) throw fallo(400, 'Nombre de modelo no válido');
      v.p[id].modelo = m || undefined; v.p[id].modelo_auto = false;
    }
    await guardar(v);
    // Al guardar una clave nueva se prueba al momento
    if (b.clave != null && !b.borrar_clave) await probar(id, req.usuario);
    res.json(await vista());
  }));

  app.put('/api/ia/proveedor-activo', admin, asyncH(async (req, res) => {
    const id = req.body?.proveedor; if (!PROV[id]) throw fallo(400, 'Proveedor desconocido');
    if (!(await claveDe(id))) throw fallo(400, 'Ese proveedor no tiene clave');
    const v = await leer(); v.activo = id; await guardar(v);
    res.json(await vista());
  }));

  app.post('/api/ia/proveedores/:id/probar', admin, asyncH(async (req, res) => {
    await probar(req.params.id, req.usuario);
    res.json(await vista());
  }));
}

module.exports = { montar, claveDe, activo, PROV };
