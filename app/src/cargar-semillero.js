// Carga el semillero desde la línea de comandos (lo usa desplegar-vps.sh dentro del contenedor):
//   docker compose exec -T web node src/cargar-semillero.js [--sin-personas] [--simular] < semillero/semillero.json
//  --sin-personas  carga áreas, máquinas, vehículos, herramientas y subcontratas, pero no los operarios
//                  (ni toca los que ya haya), para instalaciones de demostración.
//  --limpiar-demo  antes de cargar, borra el proyecto de ejemplo de la instalación (PR-001
//                  «Cliente demo»), si nadie ha registrado horas reales en él, para que sus
//                  operarios, máquinas y áreas de ejemplo puedan quitarse.
const { aplicarSemillero } = require('./semillero');
const { pool, tx } = require('./db');

async function limpiarDemo() {
  return tx(async (c) => {
    const { rows } = await c.query(`SELECT id FROM proyectos WHERE codigo = 'PR-001' AND cliente = 'Cliente demo'`);
    if (!rows.length) return 'no hay proyecto de ejemplo';
    const id = rows[0].id;
    const { rows: [u] } = await c.query(
      `SELECT count(*)::int AS n FROM registros g JOIN tareas t ON t.id = g.tarea_id JOIN ordenes o ON o.id = t.orden_id
        WHERE o.proyecto_id = $1`, [id]);
    if (u.n) return 'el proyecto de ejemplo tiene horas reales: no se borra';
    const { rowCount } = await c.query('DELETE FROM ordenes WHERE proyecto_id = $1', [id]);
    await c.query('DELETE FROM proyectos WHERE id = $1', [id]);
    return `proyecto de ejemplo PR-001 borrado (con ${rowCount} OT)`;
  });
}

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
  if (args.includes('--limpiar-demo') && !args.includes('--simular')) console.log(`Limpieza: ${await limpiarDemo()}`);
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
