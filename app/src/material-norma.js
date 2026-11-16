// Normaliza cómo se escribe un material para que el mismo tubo se agrupe siempre igual,
// lo escriba quien lo escriba («Tubo rect. 50×10×1,5», «TUBO 50x10x1.5 mm» → «TUBO 50x10x1.5»).
// Lo que no se reconoce se deja tal cual (limpio) y se avisa, pero no se rechaza.

const FAMILIAS = {
  largos: 'Largos (perfiles y tubos)',
  chapas: 'Chapas',
  ferreteria: 'Ferretería y tornillería',
  pintura: 'Pinturas',
  consumibles: 'Consumibles',
  tableros: 'Tableros y maderas',
  paneles: 'Paneles y cerramientos',
  vidrio: 'Vidrio',
  electrico: 'Material eléctrico',
  otros: 'Otros',
};

// cómo se COMPRA el material (lo que hay que pedir al proveedor)
const ACABADOS = {
  negro: 'Negro (laminado, sin tratar)',
  sendzimir: 'Pregalvanizado (sendzimir)',
  galvanizado: 'Galvanizado en caliente (comprado así)',
  bruto: 'Bruto / sin acabado',
  brillo: 'Brillo',
  satinado: 'Satinado',
  mate: 'Mate',
  anodizado: 'Anodizado',
  lacado: 'Lacado / pintado',
};
// lo que se le hace DESPUÉS a la pieza (informativo: no cambia lo que se pide)
const TRATAMIENTOS = {
  galv_caliente: 'Galvanizado en caliente',
  pintura: 'Pintura',
  galv_pintura: 'Galvanizado + pintura',
  pasivado: 'Pasivado',
  ninguno: 'Ninguno',
};
const UNIDADES = ['ud', 'm', 'm2', 'kg', 'l', 'barra', 'caja', 'rollo', 'juego'];

const sinAcentos = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '');
const num = (s) => {
  const n = Number(String(s).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
};
const fmt = (n) => String(Math.round(n * 100) / 100);   // 1.50 → 1.5 ; 40.0 → 40

// Limpieza común: mayúsculas, sin acentos, × → x, coma decimal, sin «mm»
function limpiar(s) {
  return sinAcentos(s).toUpperCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/(\d)\s*[×X*]\s*(?=[\dØ])/g, '$1x')
    .replace(/(\d)\s*MM\b/g, '$1')
    .replace(/[ØΦ⌀]|\bDIAM(ETRO)?\.?|\bD\.(?=\s*\d)/g, 'Ø')
    .replace(/\s+/g, ' ')
    .trim();
}
const dims = (s) => (s.match(/\d+(\.\d+)?(x\d+(\.\d+)?)*/) || [''])[0].split('x').filter(Boolean).map(num);

// [patrón, tipo, familia, formateo(dims)]
const PERFILES = [
  [/\bVARILLA\s*ROSCADA\b|\bV\.?\s*ROSCADA\b/, 'VARILLA', 'ferreteria', (d, t) => { const m = t.match(/M\s*(\d+)/); return m ? `VARILLA ROSCADA M${m[1]}` : null; }],
  [/\bCHAPA\b|\bPLANCHA\b/, 'CHAPA', 'chapas', (d, t) => {
    const lag = /LAGRIM/.test(t) ? ' LAGRIMADA' : /PERFOR/.test(t) ? ' PERFORADA' : /GRECAD/.test(t) ? ' GRECADA' : '';
    return d.length ? `CHAPA${lag} ${fmt(d[0])}` : null;
  }],
  [/\bTUBO\b.*(RED|CIRC|Ø)|\bTUBO\s*Ø/, 'TUBO RED', 'largos', (d) => (d.length >= 2 ? `TUBO Ø${fmt(d[0])}x${fmt(d[1])}` : null)],
  [/\bTUBO\b/, 'TUBO', 'largos', (d) => (d.length >= 3 ? `TUBO ${fmt(d[0])}x${fmt(d[1])}x${fmt(d[2])}` : d.length === 2 ? `TUBO ${fmt(d[0])}x${fmt(d[0])}x${fmt(d[1])}` : null)],
  [/\b(UPN|IPN|IPE|HEA|HEB|HEM|UPE|UAP)\s*-?\s*\d/, 'VIGA', 'largos', (d, t) => `${t.match(/\b(UPN|IPN|IPE|HEA|HEB|HEM|UPE|UAP)\b/)[1]} ${fmt(d[0])}`],
  [/\bANGULAR\b|\bLPN\b|\bCANTONERA\b|^L\s*\d/, 'L', 'largos', (d) => (d.length >= 3 ? `L ${fmt(d[0])}x${fmt(d[1])}x${fmt(d[2])}` : d.length === 2 ? `L ${fmt(d[0])}x${fmt(d[0])}x${fmt(d[1])}` : null)],
  [/\bPLETINA\b|\bPLATINA\b|\bLLANTA\b|\bFLETA\b/, 'PLETINA', 'largos', (d) => (d.length >= 2 ? `PLETINA ${fmt(Math.max(d[0], d[1]))}x${fmt(Math.min(d[0], d[1]))}` : null)],
  [/\bCUADRADILLO\b|\bCUADRADO MACIZO\b|\bMACIZO CUADRADO\b/, 'CUADRADO', 'largos', (d) => (d.length ? `CUADRADO ${fmt(d[0])}` : null)],
  [/\bMACIZO\b|\bREDONDO\b|\bBARRA\s*RED/, 'REDONDO', 'largos', (d) => (d.length ? `REDONDO Ø${fmt(d[0])}` : null)],
  [/^T\s*\d|\bPERFIL\s*T\b/, 'T', 'largos', (d) => (d.length >= 3 ? `T ${fmt(d[0])}x${fmt(d[1])}x${fmt(d[2])}` : d.length === 2 ? `T ${fmt(d[0])}x${fmt(d[0])}x${fmt(d[1])}` : null)],
  [/^U\s*\d|\bU\s*PLEGAD/, 'U', 'largos', (d) => (d.length >= 3 ? `U ${fmt(d[0])}x${fmt(d[1])}x${fmt(d[2])}` : null)],
  [/^(C|Z|OMEGA)\s*\d|\bCORREA\b/, 'CORREA', 'largos', (d, t) => {
    const k = (t.match(/^(C|Z|OMEGA)\b/) || [, 'C'])[1];
    return d.length >= 2 ? `${k} ${d.map(fmt).join('x')}` : null;
  }],
];

// Devuelve { perfil, tipo, familia, reconocido }
function perfil(texto) {
  const t = limpiar(texto);
  if (!t) return { perfil: '', tipo: null, familia: null, reconocido: false };
  for (const [re, tipo, familia, f] of PERFILES) {
    if (!re.test(t)) continue;
    const resto = t.replace(/^[A-Z.\s-]*?(?=[Ø\d])/, '');
    const p = f(dims(resto.replace(/Ø/g, '')), t);
    if (p) return { perfil: p, tipo, familia, reconocido: true };
  }
  return { perfil: t.replace(/\s*\bMM\b/g, '').slice(0, 80), tipo: null, familia: null, reconocido: false };
}

function material(texto) {
  const t = limpiar(texto).replace(/\bACERO\b|\bAISI\b|\bINOXIDABLE\b/g, (m) => (m === 'INOXIDABLE' ? 'INOX' : '')).replace(/\s+/g, ' ').trim();
  if (!t) return '';
  let m;
  if ((m = t.match(/\bS\s*(235|275|355)/))) return `S${m[1]}`;
  if (/316\s*L|1\.4404/.test(t)) return 'INOX 316L';
  if (/\b316\b|1\.4401/.test(t)) return 'INOX 316';
  if (/\b304\s*L|1\.4307/.test(t)) return 'INOX 304L';
  if (/\b304\b|1\.4301|\bA2\b/.test(t)) return 'INOX 304';
  if (/\bA4\b/.test(t)) return 'INOX 316';
  if (/\bDX5\d/.test(t)) return t.match(/DX5\d\w*/)[0];
  if (/\bALU|\b6063|\b6060|\b6082/.test(t)) { m = t.match(/\b(60[0-9]{2})\b/); return m ? `ALUMINIO ${m[1]}` : 'ALUMINIO'; }
  if (/\bINOX\b/.test(t)) return 'INOX';
  if (/\bLAMINADO\b|\bHIERRO\b|\bF-?1\b/.test(t)) return 'S235';
  return t.slice(0, 40);
}

const ALIAS_ACABADO = [
  [/SENDZ|PREGALV|GALV\.?\s*SENDZ|Z275|\bZ\d{3}\b/, 'sendzimir'],
  [/GALV|\bGC\b|CALIENTE/, 'galvanizado'],
  [/SATIN|SCOTCH|GRANO\s*\d/, 'satinado'],
  [/BRILL|PULID|ESPEJO/, 'brillo'],
  [/\bMATE\b|\b2B\b/, 'mate'],
  [/ANODIZ/, 'anodizado'],
  [/LACAD|PINTAD|RAL\s*\d|THERMO/, 'lacado'],
  [/NEGRO|LAMINAD|SIN\s*(TRAT|ACAB)|DECAP|\bBRUTO\b|\bS\/?A\b/, 'negro'],
];
function acabado(texto, mat) {
  const t = limpiar(texto);
  if (!t) return mat && mat.startsWith('S') ? 'negro' : '';
  if (ACABADOS[sinAcentos(texto).toLowerCase().trim()]) return sinAcentos(texto).toLowerCase().trim();
  for (const [re, k] of ALIAS_ACABADO) if (re.test(t)) return k;
  return t.toLowerCase().slice(0, 30);
}
function tratamiento(texto) {
  const t = limpiar(texto);
  if (!t) return '';
  if (TRATAMIENTOS[sinAcentos(texto).toLowerCase().trim()]) return sinAcentos(texto).toLowerCase().trim();
  if (/G\s*\+\s*P|GALV.*PINT|DUPLEX/.test(t)) return 'galv_pintura';
  if (/GALV/.test(t)) return 'galv_caliente';
  if (/PINT|LACA|RAL|ESMALT|IMPRIM/.test(t)) return 'pintura';
  if (/PASIV/.test(t)) return 'pasivado';
  if (/NINGUN|^NO$|SIN/.test(t)) return 'ninguno';
  return t.toLowerCase().slice(0, 30);
}

function familia(texto) {
  const t = sinAcentos(texto).toLowerCase().trim();
  if (!t) return '';
  if (FAMILIAS[t]) return t;
  if (/largo|perfil|tubo|hierro|viga/.test(t)) return 'largos';
  if (/chapa|plancha/.test(t)) return 'chapas';
  if (/ferret|tornill|anclaj|taco/.test(t)) return 'ferreteria';
  if (/pintur|esmalt|imprim|disolv/.test(t)) return 'pintura';
  if (/consum|disco|electrodo|hilo|gas|adhesiv|silicon/.test(t)) return 'consumibles';
  if (/tabler|mader/.test(t)) return 'tableros';
  if (/panel|cerram|malla|sandwich/.test(t)) return 'paneles';
  if (/vidrio|cristal/.test(t)) return 'vidrio';
  if (/electr|cable/.test(t)) return 'electrico';
  return 'otros';
}
function unidad(texto) {
  const t = sinAcentos(texto).toLowerCase().replace(/[.\s]/g, '');
  if (!t) return '';
  if (UNIDADES.includes(t)) return t;
  if (/^(u|un|uds?|unid\w*|pz\w*|pieza\w*)$/.test(t)) return 'ud';
  if (/^(ml|metros?|mts?)$/.test(t)) return 'm';
  if (/^(m²|m2|metros?2)$/.test(t)) return 'm2';
  if (/^(kgs?|kilos?)$/.test(t)) return 'kg';
  if (/^(l|lts?|litros?)$/.test(t)) return 'l';
  if (/^barras?$/.test(t)) return 'barra';
  return t.slice(0, 10);
}

// Clave de agrupación: lo que es «el mismo material a comprar»
function clave(m) {
  if (m.familia === 'largos') return ['largos', m.perfil, m.material || '', m.acabado || ''].join('|');
  return [m.familia || 'otros', m.perfil || sinAcentos(m.descripcion || '').toUpperCase().replace(/\s+/g, ' ').trim(),
    m.material || '', m.acabado || '', m.unidad || 'ud'].join('|');
}

module.exports = { FAMILIAS, ACABADOS, TRATAMIENTOS, UNIDADES, perfil, material, acabado, tratamiento, familia, unidad, clave, limpiar, num };
