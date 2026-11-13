// Jornada laboral (horas decimales: 7.5 = 07:30). Se cambia con variables de entorno.
const num = (v, def) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : def);

const inicio = num(process.env.JORNADA_INICIO, 7);
const fin = num(process.env.JORNADA_FIN, 15);
// El tablero enseña un poco más allá del fin de jornada para poder planificar horas extra
const vistaFin = Math.min(24, num(process.env.VISTA_FIN, fin + 2));

// Días laborables de vacaciones al año por convenio (cada persona puede tener los suyos)
const vacacionesDias = num(process.env.VACACIONES_DIAS, 22);

module.exports = { jornada: { inicio, fin, vistaFin, horas: fin - inicio }, vacacionesDias };
