import { ErrorValidacion } from '../../src/errores';
import { hoyUtc, pareceNombreDeFecha, validarFechaRazonable } from '../../src/utils/fechas';

const HOY = '2026-11-11';

describe('validarFechaRazonable (estándar §19)', () => {
  it('acepta fechas normales y fechas con hora', () => {
    expect(validarFechaRazonable('2026-10-04', 'fecha', { hoy: HOY })).toBe('2026-10-04');
    expect(validarFechaRazonable('2026-10-04 15:05:09', 'fecha', { hoy: HOY })).toBe('2026-10-04 15:05:09');
    expect(validarFechaRazonable('2026-10-04T15:05:09.123Z', 'fecha', { hoy: HOY })).toBe('2026-10-04T15:05:09.123Z');
  });

  it('rechaza días que no existen', () => {
    expect(() => validarFechaRazonable('2026-02-30', 'vence', { hoy: HOY })).toThrow(ErrorValidacion);
    expect(() => validarFechaRazonable('2026-13-01', 'vence', { hoy: HOY })).toThrow('no existe');
    expect(() => validarFechaRazonable('2025-02-29', 'vence', { hoy: HOY })).toThrow('no existe');
    expect(validarFechaRazonable('2028-02-29', 'vence', { hoy: HOY })).toBe('2028-02-29');
  });

  it('rechaza años imposibles: antes de 1980 o más de 30 años en el futuro', () => {
    expect(() => validarFechaRazonable('1900-01-01', 'fecha', { hoy: HOY })).toThrow('entre 1980 y 2056');
    expect(() => validarFechaRazonable('2999-01-01', 'fecha', { hoy: HOY })).toThrow('entre 1980 y 2056');
    expect(validarFechaRazonable('2056-12-31', 'fecha', { hoy: HOY })).toBe('2056-12-31');
  });

  it('nacimiento: desde 1900 hasta hoy, nunca futuro', () => {
    expect(validarFechaRazonable('1985-06-01', 'nacimiento', { nacimiento: true, hoy: HOY })).toBe('1985-06-01');
    expect(validarFechaRazonable('1950-06-01', 'nacimiento', { nacimiento: true, hoy: HOY })).toBe('1950-06-01');
    expect(() => validarFechaRazonable('1899-12-31', 'nacimiento', { nacimiento: true, hoy: HOY })).toThrow('entre 1900');
    expect(() => validarFechaRazonable('2026-11-12', 'nacimiento', { nacimiento: true, hoy: HOY })).toThrow('futura');
  });

  it('lo que ya ocurrió (noFutura) no puede ser de mañana, pero hoy sí', () => {
    expect(validarFechaRazonable(HOY, 'compra', { noFutura: true, hoy: HOY })).toBe(HOY);
    expect(() => validarFechaRazonable('2026-11-12', 'compra', { noFutura: true, hoy: HOY })).toThrow('futura');
  });

  it('rechaza horas inválidas y formatos que no son fecha', () => {
    expect(() => validarFechaRazonable('2026-10-04 25:00:00', 'fecha', { hoy: HOY })).toThrow('hora');
    expect(() => validarFechaRazonable('04/10/2026', 'fecha', { hoy: HOY })).toThrow('formato');
    expect(() => validarFechaRazonable(20261004, 'fecha', { hoy: HOY })).toThrow('texto');
  });

  it('el mensaje siempre dice de qué campo se trata', () => {
    expect(() => validarFechaRazonable('2026-02-30', 'licencia_vence', { hoy: HOY })).toThrow(/^licencia_vence:/);
  });

  it('hoyUtc devuelve AAAA-MM-DD', () => {
    expect(hoyUtc(new Date('2026-11-11T23:30:00Z'))).toBe('2026-11-11');
  });

  it('pareceNombreDeFecha reconoce los nombres típicos', () => {
    for (const n of ['fecha_cierre', 'vence', 'licencia_vence', 'vigencia', 'creada_at', 'desde', 'hasta', 'fecha_nacimiento', 'cerrada_en']) {
      expect(pareceNombreDeFecha(n)).toBe(true);
    }
    for (const n of ['nombre', 'cantidad', 'precio', 'notas']) expect(pareceNombreDeFecha(n)).toBe(false);
  });
});
