// Carga el semillero desde la línea de comandos (lo usa desplegar-vps.sh dentro del contenedor):
//   docker compose exec -T web node src/cargar-semillero.js [--sin-personas] [--simular] < semillero/semillero.json
//  --sin-personas  carga áreas, máquinas, vehículos, herramientas y subcontratas, pero no los operarios
//                  (ni toca los que ya haya), para instalaciones de demostración.
const { aplicarSemillero } = require('./semillero');
const { pool } = require('./db');

async function main() {
  const args = process.argv.slice(2);
  let texto = '';
  for await (const trozo of process.stdin) texto += trozo;
  const S = JSON.parse(texto);
  const conservar = [];
  if (args.includes('--sin-personas')) {
    S.recursos = S.recursos.filter((r) => r.clase !== 'operario');
    conservar.push('operario');
  }
  const r = await aplicarSemillero(S, { simular: args.includes('--simular'), conservar });
  if (!r.ok) {
    console.error('El semillero tiene errores:\n - ' + r.errores.join('\n - '));
    process.exitCode = 1;
    return;
  }
  const cuenta = (lista) => Object.entries(lista.reduce((m, x) => ({ ...m, [x.accion]: (m[x.accion] || 0) + 1 }), {}))
    .map(([k, n]) => `${n} ${k}`).join(', ') || 'sin cambios';
  console.log(`Semillero ${r.simulado ? 'simulado' : 'cargado'}:`);
  for (const k of ['departamentos', 'tipos', 'areas', 'recursos']) console.log(`  ${k}: ${cuenta(r[k])}`);
  for (const a of r.avisos || []) console.log(`  aviso: ${a.nombre || ''} ${a.detalle || a.accion || ''}`);
}

main().catch((e) => { console.error(e.message); process.exitCode = 1; }).finally(() => pool.end());
