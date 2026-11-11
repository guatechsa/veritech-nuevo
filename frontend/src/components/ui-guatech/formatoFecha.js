// ─────────────────────────────────────────────────────────────────────────────
// KIT DE INTERFAZ GUATECH — archivo compartido.
// Fuente de verdad: C:\GUATECH\GUATECH\ui-kit\formatoFecha.js
// Se copia con `bash C:/GUATECH/sync-ui-kit.sh`. NO editar la copia de un producto.
//
// ESTÁNDAR (GUATECH_STANDARDS.md sección 18): toda fecha que ve una persona es DD/MM/YYYY y toda fecha con
// hora es DD/MM/YYYY HH:mm (24 horas), sin importar la configuración regional de la computadora. Por eso aquí
// NO se usa toLocaleDateString / Intl: arman la cadena a mano. Entre pantalla y API el valor sigue siendo ISO.
//
// Cómo se interpretan los valores (los mismos que ya traía el código con `new Date(x)`):
//   'YYYY-MM-DD'                → fecha de calendario; no pasa por Date (no hay corrimiento por zona horaria).
//   'YYYY-MM-DD HH:mm[:ss]'     → hora local tal cual viene (así devuelve las fechas la base: dateStrings).
//   ISO con 'Z' o desfase       → instante: se pasa a la hora local de la computadora.
//   Date                        → hora local.
// ─────────────────────────────────────────────────────────────────────────────

const p2 = (n) => String(n).padStart(2, '0');

const SOLO_FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
const CON_HORA = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/i;

// Devuelve { a, m, d, h, mi } con la fecha/hora que debe verse, o null si el valor no es una fecha.
function partes(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return { a: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate(), h: v.getHours(), mi: v.getMinutes(), tieneHora: true };
  }
  const s = String(v).trim();
  let r = SOLO_FECHA.exec(s);
  if (r) return { a: +r[1], m: +r[2], d: +r[3], h: 0, mi: 0, tieneHora: false };
  r = CON_HORA.exec(s);
  if (r) {
    if (r[7]) {
      const dt = new Date(s);
      if (Number.isNaN(dt.getTime())) return null;
      return { a: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), mi: dt.getMinutes(), tieneHora: true };
    }
    return { a: +r[1], m: +r[2], d: +r[3], h: +r[4], mi: +r[5], tieneHora: true };
  }
  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return null;
  return { a: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate(), h: dt.getHours(), mi: dt.getMinutes(), tieneHora: true };
}

// 04/10/2026
export function formatFecha(v, vacio = '') {
  const x = partes(v);
  return x ? `${p2(x.d)}/${p2(x.m)}/${x.a}` : vacio;
}

// 04/10/2026 15:05
export function formatFechaHora(v, vacio = '') {
  const x = partes(v);
  if (!x) return vacio;
  return x.tieneHora ? `${p2(x.d)}/${p2(x.m)}/${x.a} ${p2(x.h)}:${p2(x.mi)}` : `${p2(x.d)}/${p2(x.m)}/${x.a}`;
}

// 15:05
export function formatHora(v, vacio = '') {
  const x = partes(v);
  return x && x.tieneHora ? `${p2(x.h)}:${p2(x.mi)}` : vacio;
}

// Para tablas y exportaciones genéricas: si el valor es una fecha ISO ('YYYY-MM-DD', con o sin hora) lo devuelve como
// DD/MM/YYYY [HH:mm]; cualquier otro valor (números, textos, null) pasa sin tocar.
export function formatSiFecha(v) {
  if (typeof v !== 'string') return v;
  return SOLO_FECHA.test(v) || CON_HORA.test(v.trim()) ? formatFechaHora(v) : v;
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

// Etiquetas (encabezados de calendario, ejes de gráficas): nunca como valor de un campo.
export function nombreMes(v, corto = false) {
  const x = typeof v === 'number' ? { m: v } : partes(v);
  if (!x) return '';
  const n = MESES[x.m - 1] || '';
  return corto ? n.slice(0, 3) : n;
}

export function nombreDia(v, corto = false) {
  const x = partes(v);
  if (!x) return '';
  const n = DIAS[new Date(x.a, x.m - 1, x.d).getDay()];
  return corto ? n.slice(0, 3) : n;
}

// 'YYYY-MM-DD' de hoy en la hora de la computadora.
export function hoyIso(d = new Date()) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
}

// De lo que escribió la persona (DD/MM/YYYY) a 'YYYY-MM-DD'; '' si no es una fecha que exista.
export function fechaAIso(texto) {
  const r = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(texto ?? '').trim());
  if (!r) return '';
  const d = +r[1], m = +r[2], a = +r[3];
  const dt = new Date(Date.UTC(a, m - 1, d));
  if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return `${r[3]}-${r[2]}-${r[1]}`;
}
