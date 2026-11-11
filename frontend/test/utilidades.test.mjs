// Utilidades del panel: normalización de texto (estándar §5) y conversión de horas UTC a Guatemala.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mayusculasSinTildes } from '../src/hooks/useFormatoTextoGlobal.ts';
import { aHoraDeGuatemala, fechaHoraLocal } from '../src/utils/hora.ts';

test('mayusculasSinTildes: mayúsculas y sin diacríticos', () => {
  assert.equal(mayusculasSinTildes('José Pérez Ñandú'), 'JOSE PEREZ NANDU');
  assert.equal(mayusculasSinTildes('canción ü'), 'CANCION U');
  assert.equal(mayusculasSinTildes('ABC 123'), 'ABC 123');
});

test('aHoraDeGuatemala: UTC-6, también al cruzar de día', () => {
  assert.equal(aHoraDeGuatemala('2026-11-11T17:30:00.000Z'), '2026-11-11 11:30:00');
  assert.equal(aHoraDeGuatemala('2026-11-11T05:59:00.000Z'), '2026-11-10 23:59:00');
  assert.equal(aHoraDeGuatemala('2027-01-01T03:00:00.000Z'), '2026-12-31 21:00:00');
  assert.equal(aHoraDeGuatemala(null), '');
  assert.equal(aHoraDeGuatemala('no es fecha'), '');
});

test('fechaHoraLocal: DD/MM/YYYY HH:mm en hora de Guatemala, no la del computador', () => {
  const tz = process.env.TZ;
  for (const zona of ['America/Guatemala', 'Asia/Tokyo', 'Europe/Madrid']) {
    process.env.TZ = zona;
    assert.equal(fechaHoraLocal('2026-11-11T17:30:00.000Z'), '11/11/2026 11:30');
  }
  process.env.TZ = tz;
  assert.equal(fechaHoraLocal(null), '—');
  assert.equal(fechaHoraLocal(undefined, 'Nunca'), 'Nunca');
});
