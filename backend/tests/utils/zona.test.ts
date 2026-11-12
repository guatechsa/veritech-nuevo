import { limitesDelDia, localDeUtc, utcDeLocal } from '../../src/utils/zona';

const GT = 'America/Guatemala';

describe('hora del taller ↔ UTC', () => {
  it('Guatemala va 6 horas atrás de UTC, todo el año', () => {
    expect(utcDeLocal('2026-11-15', '14:30', GT).toISOString()).toBe('2026-11-15T20:30:00.000Z');
    expect(utcDeLocal('2026-07-01', '00:00', GT).toISOString()).toBe('2026-07-01T06:00:00.000Z');
    expect(utcDeLocal('2026-12-31', '20:00', GT).toISOString()).toBe('2027-01-01T02:00:00.000Z'); // cruza de año
  });

  it('de UTC al día y la hora del taller (de noche el día es el anterior)', () => {
    expect(localDeUtc(new Date('2026-11-15T20:30:00Z'), GT)).toEqual({ fecha: '2026-11-15', hora: '14:30' });
    expect(localDeUtc(new Date('2026-11-16T03:00:00Z'), GT)).toEqual({ fecha: '2026-11-15', hora: '21:00' });
    expect(localDeUtc(new Date('2026-11-16T06:00:00Z'), GT)).toEqual({ fecha: '2026-11-16', hora: '00:00' });
  });

  it('ida y vuelta devuelve lo mismo', () => {
    for (const [f, h] of [['2026-01-01', '00:00'], ['2026-06-15', '12:45'], ['2026-12-31', '23:59']] as const) {
      expect(localDeUtc(utcDeLocal(f, h, GT), GT)).toEqual({ fecha: f, hora: h });
    }
  });

  it('el día del taller empieza a las 6:00 UTC y dura 24 horas', () => {
    const { desde, hasta } = limitesDelDia('2026-11-15', GT);
    expect(desde.toISOString()).toBe('2026-11-15T06:00:00.000Z');
    expect(hasta.toISOString()).toBe('2026-11-16T06:00:00.000Z');
    expect(limitesDelDia('2026-12-31', GT).hasta.toISOString()).toBe('2027-01-01T06:00:00.000Z');
  });

  it('también acierta en zonas con cambio de horario', () => {
    const NY = 'America/New_York';
    expect(utcDeLocal('2026-07-01', '12:00', NY).toISOString()).toBe('2026-07-01T16:00:00.000Z'); // verano: −4
    expect(utcDeLocal('2026-01-15', '12:00', NY).toISOString()).toBe('2026-01-15T17:00:00.000Z'); // invierno: −5
    const dia = limitesDelDia('2026-03-08', NY); // el día que se adelanta el reloj dura 23 horas
    expect((dia.hasta.getTime() - dia.desde.getTime()) / 3600000).toBe(23);
  });

  it('rechaza lo que no es fecha u hora', () => {
    expect(() => utcDeLocal('15/11/2026', '14:30', GT)).toThrow();
    expect(() => utcDeLocal('2026-11-15', '25:00', GT)).toThrow();
    expect(() => limitesDelDia('mañana', GT)).toThrow();
  });
});
