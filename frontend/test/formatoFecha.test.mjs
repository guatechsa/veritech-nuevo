// Estándar GUATECH sección 18: toda fecha se ve y se escribe como DD/MM/YYYY, sin importar la computadora.
// Esta prueba (1) verifica los formateadores compartidos y (2) falla si el código del frontend vuelve a usar
// lo que depende de la configuración regional: <input type="date">, toLocaleDateString, Intl.DateTimeFormat...
// Correr: node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatFecha, formatFechaHora, formatHora, formatSiFecha, fechaAIso, hoyIso, nombreMes, nombreDia } from '../src/components/ui-guatech/formatoFecha.js';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(AQUI, '..', 'src');

test('formatFecha: DD/MM/YYYY con ceros, sin importar el locale', () => {
  assert.equal(formatFecha('2026-10-04'), '04/10/2026');
  assert.equal(formatFecha('2026-01-09'), '09/01/2026');
  assert.equal(formatFecha('2026-10-04 15:05:00'), '04/10/2026');
  assert.equal(formatFecha(new Date(2026, 9, 4, 23, 59)), '04/10/2026');
  assert.equal(formatFecha(null), '');
  assert.equal(formatFecha(''), '');
  assert.equal(formatFecha(undefined, '—'), '—');
  assert.equal(formatFecha('no es fecha', '—'), '—');
});

test('formatFecha: una fecha de calendario no se corre un día por la zona horaria', () => {
  const tz = process.env.TZ;
  for (const z of ['America/Guatemala', 'Asia/Tokyo', 'Pacific/Honolulu']) {
    process.env.TZ = z;
    assert.equal(formatFecha('2026-03-01'), '01/03/2026');
  }
  process.env.TZ = tz;
});

test('formatFechaHora: DD/MM/YYYY HH:mm en 24 horas', () => {
  assert.equal(formatFechaHora('2026-10-04 15:05:09'), '04/10/2026 15:05');
  assert.equal(formatFechaHora('2026-10-04T08:03'), '04/10/2026 08:03');
  assert.equal(formatFechaHora('2026-10-04T00:00:00'), '04/10/2026 00:00');
  assert.equal(formatFechaHora('2026-10-04'), '04/10/2026');
  assert.equal(formatFechaHora(new Date(2026, 9, 4, 15, 5)), '04/10/2026 15:05');
  assert.equal(formatHora('2026-10-04 15:05:09'), '15:05');
});

test('formatFechaHora: un instante ISO con Z se pasa a la hora local de la computadora', () => {
  const d = new Date('2026-10-04T21:30:00Z');
  const esperado = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  assert.equal(formatFechaHora('2026-10-04T21:30:00Z'), esperado);
});

test('formatSiFecha: solo toca las fechas ISO', () => {
  assert.equal(formatSiFecha('2026-10-04'), '04/10/2026');
  assert.equal(formatSiFecha('2026-10-04 15:05:00'), '04/10/2026 15:05');
  assert.equal(formatSiFecha('PED-2026-10-04'), 'PED-2026-10-04');
  assert.equal(formatSiFecha(12.5), 12.5);
  assert.equal(formatSiFecha(null), null);
  assert.equal(formatSiFecha('2026-10'), '2026-10');
});

test('fechaAIso: lo escrito DD/MM/YYYY pasa a ISO; fechas que no existen dan vacío', () => {
  assert.equal(fechaAIso('04/10/2026'), '2026-10-04');
  assert.equal(fechaAIso('29/02/2028'), '2028-02-29');
  assert.equal(fechaAIso('29/02/2026'), '');
  assert.equal(fechaAIso('31/04/2026'), '');
  assert.equal(fechaAIso('4/10/2026'), '');
  assert.equal(fechaAIso('2026-10-04'), '');
});

test('hoyIso, nombreMes y nombreDia', () => {
  assert.equal(hoyIso(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(nombreMes('2026-10-04'), 'octubre');
  assert.equal(nombreMes(3, true), 'mar');
  assert.equal(nombreDia('2026-10-04'), 'domingo');
  assert.equal(nombreDia('2026-10-05', true), 'lun');
});

function archivos(dir, salida = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) archivos(p, salida);
    else if (/\.(jsx?|tsx?)$/.test(e.name)) salida.push(p);
  }
  return salida;
}

// Lo que NO puede aparecer en ningún frontend (excepto en el propio kit, que lo explica en comentarios).
const PROHIBIDO = [
  [/type=(["'])(date|datetime-local|time|month|week)\1/, '<input type="date"> (usar FechaInput / FechaHoraInput)'],
  [/\.toLocaleDateString\(/, 'toLocaleDateString (usar formatFecha)'],
  [/\.toLocaleTimeString\(/, 'toLocaleTimeString (usar formatHora / formatFechaHora)'],
  [/Intl\.DateTimeFormat/, 'Intl.DateTimeFormat (usar formatFecha / formatFechaHora)'],
  [/new Date\([^()]*(\([^()]*\))?[^()]*\)\.toLocaleString\(/, 'new Date(...).toLocaleString (usar formatFechaHora)'],
];

test('ningún archivo del frontend usa formatos que dependen de la configuración regional', () => {
  const faltas = [];
  for (const f of archivos(SRC)) {
    if (f.includes(`${path.sep}ui-guatech${path.sep}`)) continue;
    const lineas = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    lineas.forEach((l, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
      for (const [re, que] of PROHIBIDO) if (re.test(l)) faltas.push(`${path.relative(SRC, f)}:${i + 1}  ${que}`);
    });
  }
  assert.deepEqual(faltas, [], `Formato de fecha no permitido (GUATECH_STANDARDS sección 18):\n${faltas.join('\n')}`);
});
