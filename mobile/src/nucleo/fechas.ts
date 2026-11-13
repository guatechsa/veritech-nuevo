/**
 * Fechas sin correrse de día: una fecha «2026-11-13» (o «2026-11-13T00:00:00.000Z» de un DATE) se toma por sus NÚMEROS, sin convertir zonas horarias.
 * Se escribe DD/MM/AAAA (estándar GUATECH).
 */
export function fechaCorta(valor: string | null | undefined): string {
  if (!valor) return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : valor;
}

/** Un instante (UTC) en la hora del taller: «13/11/2026 09:30». */
export function fechaHoraDelTaller(iso: string | null | undefined, zona: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d);
  const v = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${v('day')}/${v('month')}/${v('year')} ${v('hour')}:${v('minute')}`;
}

/** Un número que escribió la persona: acepta «12,5» y «12.5»; todo lo demás se rechaza (nada de «12abc» como 12). */
export function numeroDe(texto: string): number | null {
  const t = texto.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}
