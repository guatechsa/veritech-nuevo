/**
 * Conversión entre la hora de pared de un taller (su zona horaria) y UTC, que es como se guarda todo.
 * El servidor es quien convierte: así la pantalla manda y recibe «día y hora del taller» y no hay riesgo de desfases
 * por la zona del navegador o del servidor.
 */

/** Cuántos milisegundos adelanta la zona respecto de UTC en ese instante (Guatemala: −6 h = −21 600 000). */
function desfaseMs(instante: Date, zona: string): number {
  const partes = new Intl.DateTimeFormat('en-US', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(instante);
  const v = (tipo: string): number => Number(partes.find((p) => p.type === tipo)?.value);
  const comoUtc = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}

const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** «2026-11-15» y «14:30» en la zona del taller → el instante en UTC. */
export function utcDeLocal(fecha: string, hora: string, zona: string): Date {
  const f = FECHA.exec(fecha);
  const h = HORA.exec(hora);
  if (!f || !h) throw new Error('Fecha u hora inválidas');
  const comoUtc = Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(h[1]), Number(h[2]));
  // Se corrige dos veces para acertar también cerca de un cambio de horario.
  let candidato = new Date(comoUtc - desfaseMs(new Date(comoUtc), zona));
  candidato = new Date(comoUtc - desfaseMs(candidato, zona));
  return candidato;
}

/** Un instante UTC → su día (AAAA-MM-DD) y hora (HH:MM) en la zona del taller. */
export function localDeUtc(instante: Date, zona: string): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zona, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(instante);
  const v = (tipo: string): string => partes.find((p) => p.type === tipo)?.value ?? '';
  return { fecha: `${v('year')}-${v('month')}-${v('day')}`, hora: `${v('hour')}:${v('minute')}` };
}

/** Desde las 00:00 del día (hora del taller) hasta las 00:00 del siguiente, en UTC. */
export function limitesDelDia(fecha: string, zona: string): { desde: Date; hasta: Date } {
  const f = FECHA.exec(fecha);
  if (!f) throw new Error('Fecha inválida');
  const siguiente = new Date(Date.UTC(Number(f[1]), Number(f[2]) - 1, Number(f[3]) + 1)).toISOString().slice(0, 10);
  return { desde: utcDeLocal(fecha, '00:00', zona), hasta: utcDeLocal(siguiente, '00:00', zona) };
}
