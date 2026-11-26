/* Precios ESTIMADOS de los materiales del catálogo (la lista de los escandallos), para tener un precio de partida en
   presupuestos mientras no llegan precios reales. Se guardan en «precios» con origen 'estimado' (sin proveedor); en
   cuanto llega uno real (oferta, pedido…), manda el real (precios.habitual los pone siempre detrás).
   Base: compras pequeñas en Menorca, sin IVA, noviembre 2026. Metales por €/kg × kg de la pieza (equivalencias del
   catálogo); tornillería por métrica y largo; el resto, por tipo de artículo. Lo «a medida / según plano» no se estima. */
const { query } = require('./db');
const U = require('./unidades');

const VERSION = 1;   // subirla al cambiar reglas: al arrancar se rehacen las estimaciones (nunca toca precios reales)

const n = (t) => Number(String(t).replace(',', '.'));
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => (x >= 1 ? Math.round(x * 100) / 100 : Math.round(x * 10000) / 10000);   // céntimos; 4 decimales solo en lo pequeño

// ---------- metales: €/kg ----------
function eurKg(nom, fam) {
  const t = nom.toLowerCase();
  let base; let que;
  if (/alumin/.test(t)) { base = 7.5; que = 'aluminio'; if (/lacad|anodiz/.test(t)) { base *= 1.3; que += ' lacado/anodizado'; } }
  else if (/inox/.test(t)) {
    base = /316/.test(t) ? 4.0 : 3.4; que = /316/.test(t) ? 'inox 316' : 'inox 304';
    if (/satinad|pulid|brillo/.test(t)) { base *= 1.12; que += ' satinado/pulido'; }
  } else {
    que = 'acero';
    if (fam === 'Perfiles laminados') base = 3.0;
    else if (fam === 'Chapas') base = 2.4;
    else if (fam === 'Correas') base = 2.6;
    else if (fam === 'Pletinas y macizos') base = 2.7;
    else base = 2.6;
    if (/galvanizad[oa] en caliente/.test(t)) { base *= 1.45; que += ' galvanizado en caliente'; }
    else if (/galvaniz|sendzimir|zincad/.test(t) && fam !== 'Correas') { base *= 1.25; que += ' galvanizado'; }
  }
  if (/lagrimad|damero/.test(t)) { base *= 1.1; que += ' lagrimado'; }
  if (/perforad/.test(t)) { base *= 1.8; que += ' perforado'; }
  return { base, que };
}
function metal(c) {
  const e = c.equiv || {};
  const { base, que } = eurKg(c.nombre, c.familia);
  const ub = U.unidad(c.unidad_base || c.unidad);
  let kg = null; let como = '';
  if (ub === 'ml' && e.kg_ml) { kg = e.kg_ml; como = `${e.kg_ml} kg/ml`; }
  else if (ub === 'm2' && e.kg_m2) { kg = e.kg_m2; como = `${e.kg_m2} kg/m²`; }
  else if (ub === 'kg') { kg = 1; como = 'por kg'; }
  if (kg == null) return null;
  // secciones pequeñas: más caro el kg; grandes, algo más barato
  let k = 1;
  if (ub === 'ml' && !/inox/i.test(c.nombre)) k = kg < 1 ? 1.4 : kg < 2.5 ? 1.25 : kg > 25 ? 0.9 : kg > 10 ? 0.95 : 1;
  const precio = kg * base * k;
  return { precio: r4(precio), nota: `${que} ≈ ${r2(base * k)} €/kg · ${como}`, conf: 'media' };
}

// ---------- tornillería y anclajes por métrica ----------
function acabado(t) {
  if (/inox\s*a4|a4\b/.test(t)) return [4.2, 'inox A4'];
  if (/inox/.test(t)) return [3.0, 'inox A2'];
  if (/galvanizad[oa] en caliente|galvanizad/.test(t)) return [1.6, 'galvanizado'];
  return [1, 'cincado'];
}
function tornilleria(c) {
  const t = c.nombre.toLowerCase(); let m;
  const [k, acab] = acabado(t);
  const ML = t.match(/m(\d+(?:[.,]\d+)?)\s*[×x]\s*(\d+)/); const M = ML ? n(ML[1]) : (t.match(/\bm(\d+(?:[.,]\d+)?)\b/) ? n(t.match(/\bm(\d+(?:[.,]\d+)?)\b/)[1]) : null); const L = ML ? n(ML[2]) : null;
  const res = (p, nota) => ({ precio: r4(p), nota, conf: 'media' });
  if (/^varilla roscada/.test(t) && M) { const f = /8\.8/.test(t) ? 2 : 1; const kk = /inox a4/.test(t) ? 4.5 : /inox/.test(t) ? 3.5 : /caliente/.test(t) ? 1.8 : 1; return res((0.6 + 0.014 * M * M) * f * kk, `varilla M${M} (barra 1 m) · ${acab}`); }
  if (/perno de anclaje/.test(t) && M && L) return res(0.3 + 0.00003 * M * M * L, `perno M${M}×${L} galvanizado`);
  if (/anclaje mec|perno de expansi/.test(t) && M && L) return res((0.2 + 0.00006 * M * M * L) * (/inox/.test(t) ? 3.5 : 1), `anclaje M${M}×${L} · ${acab}`);
  if (/dynabolt/.test(t) && M) return res((0.6 + 0.012 * M * M) * (/inox/.test(t) ? 3 : 1), `camisa M${M}`);
  if (/^tornillo/.test(t) && M && L && !/autotaladr|rosca chapa/.test(t)) {
    let f = 1; let tipo = 'hexagonal';
    if (/allen|avellanad/.test(t)) { f = 1.4; tipo = /avellan/.test(t) ? 'avellanado Allen' : 'Allen'; }
    if (/alomada|carrocero/.test(t)) { f = 1.1; tipo = 'carrocero'; }
    if (/estructural|hv/.test(t)) { f = 2.5; tipo = 'estructural HV'; }
    const kk = /inox/.test(t) ? k : (/10\.9/.test(t) ? 1.3 : 1) * (/caliente/.test(t) ? 1.6 : 1);
    return res((0.012 + 0.000035 * M * M * (L + 2 * M)) * f * kk, `tornillo ${tipo} M${M}×${L} · ${acab}`);
  }
  if (/^tuerca remachable/.test(t)) return res(/inox/.test(t) ? 0.4 : 0.15, 'tuerca remachable');
  if (/^tuerca/.test(t) && M) { const f = /autoblocante/.test(t) ? 2.5 : /ciega/.test(t) ? 3 : /baja/.test(t) ? 0.8 : 1; return res((0.005 + 0.00035 * M * M) * f * k, `tuerca M${M} · ${acab}`); }
  if (/^arandela/.test(t) && M) { const f = /ancha/.test(t) ? 1.8 : /grower/.test(t) ? 1.3 : 1; return res((0.003 + 0.00012 * M * M) * f * k, `arandela M${M} · ${acab}`); }
  if (/^remache/.test(t)) return res(/inox/.test(t) ? 0.09 : 0.03, 'remache ciego');
  if (/autotaladrante/.test(t)) return res(/panel/.test(t) ? 0.22 : /inox/.test(t) ? 0.18 : 0.06, 'autotaladrante');
  if (/rosca chapa/.test(t)) return res(/inox/.test(t) ? 0.12 : 0.05, 'rosca chapa');
  if ((m = t.match(/^taco/))) return res(0.12, 'taco + tirafondo');
  return null;
}

// ---------- resto: por tipo de artículo (precio por la unidad del catálogo) ----------
const D = (t) => { const m = t.match(/ø\s*(\d+(?:[.,]\d+)?)/i) || t.match(/(\d+(?:[.,]\d+)?)\s*mm/); return m ? n(m[1]) : null; };
const MM = (t) => { const m = t.match(/\bm(\d+)\b/i); return m ? n(m[1]) : null; };
const ESP = (t) => { const m = t.match(/(\d+(?:[.,]\d+)?)\s*mm/); return m ? n(m[1]) : null; };
// [expresión, precio (número o función del nombre en minúsculas), nota]
const REGLAS = [
  // a medida: no se estima
  [/a medida|según plano|segun plano|según modelo|corte láser|corte laser/, null, 'a medida: pedir precio'],
  [/perfil omega/, (t) => 1.5 + 0.03 * (n((t.match(/omega\s*(\d+)/) || [0, 40])[1])), 'omega galvanizado por m'],
  [/deployé|deploye|metal desplegado/, (t) => (/galvaniz/.test(t) ? 45 : 35), 'chapa de metal desplegado'],
  [/tubo u con clip/, 12, 'perfil aluminio por m'],
  // abrasivos
  [/cepillo de alambre/, 8, 'cepillo de copa'],
  [/disco de corte para tronzadora/, 9, 'disco tronzadora'],
  [/disco de corte/, (t) => (D(t) >= 230 ? 2.8 : D(t) >= 180 ? 2 : 1.2) * (/inox/.test(t) ? 1.1 : 1), 'disco de corte'],
  [/disco de desbaste/, (t) => (D(t) >= 230 ? 4.5 : 2.5), 'disco de desbaste'],
  [/flap|láminas|laminas/, (t) => (D(t) >= 180 ? 4 : 2.5), 'disco de láminas'],
  [/disco de fibra/, 1.2, 'disco de fibra'],
  [/esponja|scotch/, 6, 'disco de esponja'],
  [/disco diamante/, (t) => (D(t) >= 230 ? 35 : 15), 'disco diamante'],
  [/sierra circular/, 80, 'disco TCT'],
  [/sierra de cinta/, 45, 'hoja de cinta'],
  [/lija/, 15, 'lija en rollo'],
  [/lima|escofina/, 9, 'lima'],
  // brocas
  [/avellanador/, 12, 'avellanador'],
  [/broca hss/, (t) => 0.6 + 0.35 * (D(t) || 6), 'broca HSS-Co'],
  [/broca sds/, (t) => 2 + 0.3 * (D(t) || 8), 'broca SDS'],
  [/broca escalonada/, 25, 'broca escalonada'],
  [/corona bimetal/, (t) => 5 + 0.15 * (D(t) || 40), 'corona bimetal'],
  [/fresa anular/, (t) => 18 + 1.2 * (D(t) || 20), 'fresa anular'],
  [/macho de roscar/, (t) => 6 + 0.5 * (MM(t) || 10), 'juego de machos'],
  [/terraja/, (t) => 8 + 0.6 * (MM(t) || 10), 'terraja'],
  [/puntas de atornillador/, 15, 'estuche de puntas'],
  [/vasos de impacto/, 45, 'juego de vasos'],
  // anclajes químicos y obra de anclaje
  [/cánula|canula/, 0.8, 'cánula'], [/tamiz/, 0.6, 'tamiz'],
  [/resina química epoxi|resina quimica epoxi/, 35, 'cartucho epoxi'],
  [/resina química|resina quimica/, 18, 'cartucho de resina'],
  [/grout|nivelación sin retracción/, 22, 'saco de grout'],
  // automatismos
  [/banda de seguridad/, 90, ''], [/cuadro de maniobra/, 150, ''], [/emisor|mando a distancia/, 25, ''], [/fotocélula/, 55, ''],
  [/lámpara destellante|lampara destellante/, 30, ''], [/motor batiente/, 450, 'kit 2 hojas'], [/selector de llave|teclado/, 60, ''],
  [/motor para portón corredero/, (t) => { const kg = n((t.match(/(\d+)\s*kg/) || [0, 600])[1]); return kg <= 400 ? 260 : kg <= 600 ? 320 : kg <= 1000 ? 420 : 750; }, 'motor corredero'],
  // consumibles y EPI
  [/wd-|lubricante/, 6, ''], [/agua/, 2, ''], [/bolsas de basura/, 4, ''], [/buzo/, 4, ''], [/cantoneras/, 0.3, ''], [/balizamiento/, 6, ''],
  [/film|plástico de embalar/, 18, ''], [/filtros de mascarilla/, 8, ''], [/fleje|precinto/, 25, ''], [/gafas/, 4, ''], [/gasoil/, 1.45, ''], [/gasolina/, 1.6, ''],
  [/^grasa/, 8, ''], [/guantes anticorte/, 6, ''], [/guantes de soldador/, 9, ''], [/guantes/, 3, ''], [/jaboncillo|tiza/, 1, ''],
  [/mascarilla ffp3/, 2.2, ''], [/mascarilla/, 0.8, ''], [/rotulador/, 3, ''], [/señal|cartel/, 15, ''], [/taladrina|aceite de corte/, 12, ''],
  [/tapones auditivos/, 0.3, ''], [/trapos|papel industrial/, 18, ''],
  // elevación y amarre
  [/alambre inox/, 12, ''], [/alambre/, 3, ''],
  [/cable de acero.*inox/, (t) => 0.5 + 0.07 * (D(t) || 6) ** 2, 'cable inox por m'],
  [/cable de acero/, (t) => 0.2 + 0.02 * (D(t) || 6) ** 2, 'cable galvanizado por m'],
  [/cadena.*inox/, (t) => 3 * (0.5 + 0.06 * (D(t) || 6) ** 2), 'cadena inox por m'],
  [/cadena/, (t) => 0.5 + 0.06 * (D(t) || 6) ** 2, 'cadena galvanizada por m'],
  [/cáncamo|cancamo/, (t) => (1 + 0.04 * (MM(t) || 10) ** 2) * (/inox/.test(t) ? 2.5 : 1), 'cáncamo'],
  [/grillete/, (t) => (1 + 0.05 * (D(t) || 8) ** 2) * (/inox/.test(t) ? 2.5 : 1), 'grillete'],
  [/guardacabos/, (t) => 0.5 + 0.05 * (D(t) || 6), ''], [/sujetacables|perrillo/, (t) => 0.5 + 0.08 * (D(t) || 6), ''],
  [/tensor/, (t) => (2 + 0.05 * (MM(t) || 10) ** 2) * (/inox/.test(t) ? 2.5 : 1), 'tensor'],
  [/terminal prensado/, (t) => 4 + 0.6 * (D(t) || 4), ''],
  // eléctrico
  [/bridas/, 5, ''], [/caja estanca/, 6, ''], [/clavija|base industrial/, 9, ''], [/diferencial/, 45, ''], [/magnetotérmico|magnetotermico/, 12, ''],
  [/manguera eléctrica|manguera electrica/, (t) => { const m = t.match(/(\d+)\s*[×x]\s*(\d+(?:[.,]\d+)?)/); return m ? 0.4 + 0.12 * n(m[1]) * n(m[2]) : 1.5; }, 'manguera por m'],
  [/proyector led/, 35, ''], [/regleta/, 3, ''], [/tubo corrugado/, (t) => 0.3 + 0.01 * (D(t) || 20), 'por m'],
  // gases (botella: recarga)
  [/acetileno/, 70, 'recarga'], [/mezcla argón.*inox|mezcla argon.*inox/, 70, 'recarga'], [/mezcla/, 60, 'recarga'], [/argón|argon/, 65, 'recarga'],
  [/botella de co2/, 40, 'recarga'], [/oxígeno|oxigeno/, 45, 'recarga'], [/propano/, 25, 'recarga'],
  // herrajes
  [/bisagra de pala/, 18, ''], [/bisagra para tubo/, 45, ''], [/bisagra regulable/, (t) => 6 + 0.3 * (MM(t) || 16), ''], [/bombín|bombin|cilindro/, 25, ''],
  [/candado/, 35, ''], [/carril|guía de suelo|guia de suelo/, (t) => 3 + 0.15 * (D(t) || 20), 'guía por m'], [/carro \/ carretón|carretón|carreton/, 85, ''],
  [/cerradura de embutir/, 35, ''], [/cerradura de sobreponer/, 30, ''], [/cerradura eléctrica|cerradura electrica|abrepuertas/, 30, ''],
  [/cerrojo de portón|cerrojo de porton/, 18, ''], [/cierrapuertas/, 60, ''], [/cremallera de acero/, 9, ''], [/cremallera de nylon/, 6, ''],
  [/guía superior|guia superior/, 25, ''], [/manillas inox/, 35, ''], [/manillas/, 20, ''], [/muelle de cierre/, 30, ''], [/pasador \/ cerrojo de suelo|pasador.*suelo/, 9, ''],
  [/pasador de cuello/, 7, ''], [/perfil para portón autoportante|perfil para porton autoportante/, 28, 'por m'],
  [/pernio.*inox/, (t) => 4 * (1 + 0.15 * (D(t) || 20)), ''], [/pernio/, (t) => 1 + 0.15 * (D(t) || 20), ''], [/recibidor|receptor final/, 35, ''],
  [/rueda.*inox/, (t) => 8 + 0.05 * (D(t) || 60), ''], [/rueda/, (t) => 6 + 0.12 * (D(t) || 80), ''], [/tope de portón|tope de porton|fin de carrera/, 12, ''], [/tope retenedor/, 8, ''],
  // maderas
  [/calzos|tacos de madera/, 0.5, ''], [/listón|liston/, 3, ''], [/palé|pale\b/, 8, ''], [/tablón|tablon/, 12, ''],
  [/tablero dm/, (t) => 1 + 0.9 * (ESP(t) || 16), 'tablero'], [/tablero osb/, (t) => 2 + 0.8 * (ESP(t) || 16), 'tablero'],
  [/contrachapado/, (t) => 3 + 1.5 * (ESP(t) || 18), 'tablero'], [/fenólico|fenolico/, (t) => 5 + 2.5 * (ESP(t) || 15), 'tablero'],
  // obra
  [/hormigón \(camión\)|hormigon \(camion\)/, 105, 'm³'], [/hormigón seco|hormigon seco/, 4.5, 'saco'], [/arena|grava/, (t, u) => (u === 'm3' ? 35 : 2.5), ''],
  [/cemento/, 6, 'saco 25 kg'], [/escayola/, 6, ''], [/ladrillo|bloque/, 0.6, ''], [/mortero rápido|mortero rapido/, 9, ''], [/mortero/, 4.5, 'saco'],
  // paneles y cubiertas
  [/cañizo|bambú|bambu/, 6, ''], [/chapa grecada/, (t) => 6 + 8 * (ESP(t) || 0.6) + (/prelacad/.test(t) ? 2.5 : 0), 'por m²'],
  [/claraboya|lucernario/, 30, ''], [/panel sándwich cubierta|panel sandwich cubierta/, (t) => 16 + 0.2 * (ESP(t) || 40), 'por m²'],
  [/panel sándwich|panel sandwich/, (t) => 17 + 0.2 * (ESP(t) || 40), 'por m²'], [/policarbonato grecada/, 14, 'por m²'],
  [/policarbonato celular/, (t) => 5 + 1.2 * (ESP(t) || 10), 'por m²'], [/policarbonato compacto/, (t) => 8 + 6 * (ESP(t) || 4), 'por m²'],
  [/canalón|canalon/, 18, 'por m'], [/remate de chapa/, 12, 'por m'], [/tarima composite/, 9, 'por m'],
  // pinturas y tratamientos
  [/brocha|paletina/, 4, ''], [/cinta de carrocero/, 2.5, ''], [/desengrasante/, 6, ''], [/disolvente/, 7, ''],
  [/oxirón|oxiron/, 22, ''], [/esmalte poliuretano|pintura epoxi/, 23, ''], [/esmalte titan|titan/, 18, ''], [/esmalte/, 13, ''],
  [/filtro de cabina/, 25, ''], [/galvanizado en caliente \(servicio/, (t, u) => (u === 'kg' ? 0.62 : 0.62), 'servicio por kg'],
  [/galvanizado en frío \(spray|galvanizado en frio \(spray/, 9, ''], [/galvanizado en frío|galvanizado en frio/, 30, ''],
  [/granallado/, 12, 'servicio por m²'], [/termolacado|horno/, 14, 'servicio por m² (HAM no pinta al horno)'],
  [/rica en zinc/, 28, ''], [/imprimación epoxi para inox|imprimacion epoxi para inox/, 22, ''], [/imprimación epoxi|imprimacion epoxi/, 18, ''],
  [/wash primer/, 18, ''], [/multiadherente/, 16, ''], [/imprimación|imprimacion/, 10, ''], [/masilla/, 12, ''],
  [/spray marcador/, 6, ''], [/pintura en spray/, 7, ''], [/intumescente/, 12, ''], [/pintura para suelo/, 14, ''],
  [/plástico de protección|plastico de proteccion/, 15, ''], [/rodillo/, 3, ''],
  // rejillas y mallas
  [/malla anudada/, 90, 'por m²'], [/simple torsión|simple torsion/, (t, u) => (u === 'rollo' ? 45 : 2.5), ''], [/malla electrosoldada inox/, 60, 'por m²'],
  [/mallazo/, 22, 'panel'], [/panel de malla/, 35, 'panel'], [/peldaño de rejilla|peldano de rejilla/, 70, 'por peldaño'],
  [/tramex|rejilla electrosoldada/, (t) => { const m = t.match(/pletina\s*(\d+)\s*[×x]\s*(\d+)/); const p = m ? 18 + 0.35 * n(m[1]) * n(m[2]) : 50; return /30\s*[×x]\s*10\b/.test(t.replace(/pletina\s*\d+\s*[×x]\s*\d+/, '')) ? p * 1.5 : p; }, 'por m²'],
  // sellado
  [/adhesivo epoxi/, 12, ''], [/cianoacrilato/, 4, ''], [/ms polímero|ms polimero/, 9, ''], [/adhesivo de montaje/, 7, ''], [/burlete|epdm/, 1.5, 'por m'],
  [/cinta americana/, 5, ''], [/cinta butílica|cinta butilica/, 12, ''], [/doble cara/, 15, ''], [/espuma de poliuretano/, 7, ''], [/loctite|fijador de roscas/, 12, ''],
  [/neopreno/, 2, 'por m'], [/sikaflex|sellador de poliuretano/, 9, ''], [/silicona alta/, 8, ''], [/silicona/, 5, ''], [/teflón|teflon/, 1, ''],
  // soldadura
  [/cristal de careta/, 2, ''], [/difusor/, 3, ''], [/tobera/, 4, ''], [/punta de contacto/, 0.6, ''],
  [/electrodo inox/, 45, 'caja'], [/electrodo de tungsteno/, 3.5, ''], [/electrodo para fundición|electrodo para fundicion/, 60, 'caja'],
  [/electrodo básico|electrodo basico/, 25, 'caja'], [/electrodo/, 15, 'caja'],
  [/hilo tubular/, 60, 'bobina'], [/hilo de soldadura inox/, 75, 'bobina'], [/hilo de soldadura aluminio/, 60, 'bobina'], [/hilo de soldadura/, 45, 'bobina 15 kg'],
  [/varilla tig inox/, 22, 'por kg'], [/varilla tig aluminio/, 18, 'por kg'], [/varilla tig/, 8, 'por kg'],
  [/pasivador/, 25, ''], [/pasta decapante/, 30, ''], [/antiproyecciones/, 6, ''],
  // tapones y embellecedores
  [/contera|pie regulable|pie nivelador/, 2.5, ''], [/curva|codo/, (t) => 4 + 0.12 * (D(t) || 42), ''], [/roseta/, (t) => 3 + 0.06 * (D(t) || 42), ''],
  [/embellecedor/, 4, ''], [/soporte de varilla|pasador \/ soporte/, 3.5, ''], [/pasamanos de madera/, 18, 'por m'],
  [/perfil de suelo para barandilla de vidrio/, 95, 'por m'], [/pieza de forja/, 6, ''], [/pinza de vidrio/, 9, ''],
  [/soporte de pasamanos/, 8, ''], [/tapa \/ tapón inox|tapa \/ tapon inox|tapón inox|tapon inox/, (t) => 2 + 0.05 * (D(t) || 42), ''],
  [/tapón plástico|tapon plastico/, (t) => { const m = t.match(/(\d+)\s*[×x]\s*(\d+)/); const d = m ? Math.max(n(m[1]), n(m[2])) : (D(t) || 40); return 0.15 + 0.004 * d; }, ''],
  [/unión|union/, 12, ''],
  // vidrio (m²)
  [/vidrio laminado templado/, (t) => { const m = t.match(/(\d+)\s*\+\s*(\d+)/); return 1.6 * (30 + 3.5 * (m ? n(m[1]) + n(m[2]) : 10)); }, 'por m²'],
  [/vidrio laminado/, (t) => { const m = t.match(/(\d+)\s*\+\s*(\d+)/); return 30 + 3.5 * (m ? n(m[1]) + n(m[2]) : 10) + (/mate|translúcido|translucido/.test(t) ? 12 : 0); }, 'por m²'],
  [/vidrio templado/, (t) => 25 + 4 * (ESP(t) || 8), 'por m²'],
];
function porReglas(c) {
  const t = c.nombre.toLowerCase(); const u = U.unidad(c.unidad_base || c.unidad);
  for (const [re, p, nota] of REGLAS) {
    if (!re.test(t)) continue;
    if (p == null) return { precio: null, nota, conf: null };
    const v = typeof p === 'function' ? p(t, u) : p;
    return v ? { precio: r4(v), nota: nota || 'según tipo de artículo', conf: 'baja' } : null;
  }
  return null;
}

function estimar(c) {
  const METAL = ['Tubos acero', 'Tubos inox', 'Pletinas y macizos', 'Perfiles laminados', 'Perfiles inox', 'Correas', 'Aluminio', 'Chapas'];
  // a medida, pero con precio de referencia conocido
  if (/peldaño de rejilla|peldano de rejilla/i.test(c.nombre)) return { precio: 70, nota: 'peldaño de tramex galvanizado (referencia de presupuestos reales)', conf: 'media' };
  if (/malla electrosoldada inox/i.test(c.nombre)) return { precio: 60, nota: 'malla inox por m²', conf: 'baja' };
  if (/a medida|según plano|segun plano|según modelo|corte láser/i.test(c.nombre)) return { precio: null, nota: 'a medida: pedir precio' };
  if (METAL.includes(c.familia)) { const m = metal(c); if (m) return m; }
  if (['Tornillería', 'Anclajes'].includes(c.familia)) { const m = tornilleria(c); if (m) return m; }
  return porReglas(c) || (METAL.includes(c.familia) ? null : null);
}

// Rehace todas las estimaciones (borra solo las de origen 'estimado'). Devuelve { estimados, sin_estimar: [nombres] }
async function estimarTodo() {
  await U.calcularCatalogo().catch(() => {});
  const { rows } = await query(`SELECT id, familia, nombre, unidad, unidad_base, equiv FROM catalogo WHERE tipo = 'material' AND activo ORDER BY familia, nombre`);
  const norm = require('./precios').norm;
  const filas = []; const sin = [];
  for (const c of rows) {
    const e = estimar(c);
    if (!e || e.precio == null || !(e.precio > 0)) { sin.push({ id: c.id, familia: c.familia, nombre: c.nombre, motivo: e?.nota || 'sin regla' }); continue; }
    filas.push([c.id, c.nombre, norm(c.nombre), e.precio, U.unidad(c.unidad_base || c.unidad) || 'ud', `${e.nota}${e.conf ? ` · fiabilidad ${e.conf}` : ''}`]);
  }
  const { tx } = require('./db');
  await tx(async (q) => {
    await q.query(`DELETE FROM precios WHERE origen = 'estimado'`);
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500); const vals = []; const ps = [];
      lote.forEach((f, j) => { const b = j * 6; vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},CURRENT_DATE,'estimado','estimacion',$${b + 5},$${b + 4},$${b + 6})`); ps.push(...f); });
      await q.query(`INSERT INTO precios (catalogo_id, descripcion, desc_norm, precio, unidad, fecha, origen, via, unidad_base, precio_base, nota) VALUES ${vals.join(',')}`, ps);
    }
    await q.query(`INSERT INTO ajustes (clave, valor) VALUES ('precios_estimados', $1) ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor`,
      [JSON.stringify({ version: VERSION, estimados: filas.length, sin_estimar: sin.length, en: new Date().toISOString() })]);
  });
  return { estimados: filas.length, sin_estimar: sin };
}
// Al arrancar: si las estimaciones son de una versión anterior de las reglas (o no hay), se rehacen
async function alArrancar() {
  const { rows: [a] } = await query(`SELECT valor FROM ajustes WHERE clave = 'precios_estimados'`);
  const v = a?.valor?.version ?? (typeof a?.valor === 'string' ? JSON.parse(a.valor).version : null);
  if (v === VERSION) return;
  const r = await estimarTodo();
  console.log(`Precios estimados: ${r.estimados} materiales (${r.sin_estimar.length} sin estimar)`);
}

module.exports = { estimar, estimarTodo, alArrancar, VERSION };
