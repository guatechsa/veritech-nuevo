import { formatFechaHora } from '../components/ui-guatech/formatoFecha.js';

/**
 * El servidor entrega las horas en UTC (ISO, con Z). El panel de GUATECH se usa en Guatemala (UTC-6, sin horario de
 * verano), así que se convierte a esa hora antes de mostrarla con el formateador del kit (DD/MM/YYYY HH:mm).
 * (Cuando una pantalla muestre horas de un taller, usará la zona horaria de ese taller.)
 */
export function aHoraDeGuatemala(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const l = new Date(d.getTime() - 6 * 3600 * 1000);
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `${l.getUTCFullYear()}-${dos(l.getUTCMonth() + 1)}-${dos(l.getUTCDate())} ${dos(l.getUTCHours())}:${dos(l.getUTCMinutes())}:${dos(l.getUTCSeconds())}`;
}

export function fechaHoraLocal(iso: string | null | undefined, vacio = '—'): string {
  const texto = aHoraDeGuatemala(iso);
  return texto ? (formatFechaHora(texto) as string) : vacio;
}
