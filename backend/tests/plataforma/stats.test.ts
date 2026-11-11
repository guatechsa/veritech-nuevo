import { inicioDeMesGuatemalaEnUtc } from '../../src/plataforma/stats';
import { crearEntornoDePrueba, EntornoDePrueba } from './ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => {
  await e.cerrar();
});
beforeEach(async () => {
  await e.limpiar();
});

describe('indicadores del panel (contrato de GET /stats)', () => {
  it('sin ninguna empresa: ceros en los conteos y el ingreso es "sin datos", NUNCA cero', async () => {
    const s = await e.usuario('VIEWER');
    const res = await e.autorizado(s.token).get('/api/plataforma/stats');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      clientes: { activos: 0, en_prueba: 0, suspendidos: 0, total: 0 },
      ingreso_mensual: { monto: null, sin_datos: true },
      altas_mes: 0,
      usuarios_plataforma: { total: 1, activos: 1 },
      eventos_auditoria: expect.any(Number),
    });
  });

  it('clasifica cada estado donde corresponde y suma la cuota solo de los clientes activos', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    await e.empresa({ estado: 'activa', cuota: 30 });
    await e.empresa({ estado: 'pago_fallido', cuota: 60 });
    await e.empresa({ estado: 'cancelada_con_acceso', cuota: 120 });
    await e.empresa({ estado: 'prueba', cuota: 999 });
    await e.empresa({ estado: 'pendiente' });
    await e.empresa({ estado: 'suspendida', cuota: 999 });
    await e.empresa({ estado: 'solo_exportar' });
    await e.empresa({ estado: 'cerrada' });
    const { clientes, ingreso_mensual } = (await e.autorizado(s.token).get('/api/plataforma/stats')).body.data;
    expect(clientes).toEqual({ activos: 3, en_prueba: 2, suspendidos: 3, total: 8 });
    expect(ingreso_mensual).toEqual({ monto: 210, sin_datos: false });
  });

  it('si los clientes activos no tienen cuota registrada, el ingreso sigue siendo "sin datos"', async () => {
    const s = await e.usuario('VIEWER');
    await e.empresa({ estado: 'activa', cuota: null });
    const { ingreso_mensual } = (await e.autorizado(s.token).get('/api/plataforma/stats')).body.data;
    expect(ingreso_mensual).toEqual({ monto: null, sin_datos: true });
  });

  it('altas del mes: cuenta solo las creadas desde el día 1 del mes en hora de Guatemala', async () => {
    const s = await e.usuario('VIEWER');
    const ahora = new Date();
    const inicio = inicioDeMesGuatemalaEnUtc(ahora);
    await e.empresa({ creada: new Date(inicio.getTime() + 60_000) });
    await e.empresa({ creada: new Date(inicio.getTime() - 60_000) });
    expect((await e.autorizado(s.token).get('/api/plataforma/stats')).body.data.altas_mes).toBe(1);
  });

  it('cuenta los usuarios activos y los eventos de auditoría', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    await e.usuario('VIEWER', 'baja@prueba.test', false);
    const { usuarios_plataforma, eventos_auditoria } = (await e.autorizado(s.token).get('/api/plataforma/stats')).body.data;
    expect(usuarios_plataforma).toEqual({ total: 2, activos: 1 });
    expect(eventos_auditoria).toBeGreaterThanOrEqual(1);
  });
});

describe('inicioDeMesGuatemalaEnUtc', () => {
  it('el mes de Guatemala empieza a las 06:00 UTC del día 1', () => {
    expect(inicioDeMesGuatemalaEnUtc(new Date('2026-11-15T12:00:00Z')).toISOString()).toBe('2026-11-01T06:00:00.000Z');
  });
  it('a las 05:59 UTC del 1 de noviembre en Guatemala todavía es octubre', () => {
    expect(inicioDeMesGuatemalaEnUtc(new Date('2026-11-01T05:59:00Z')).toISOString()).toBe('2026-10-01T06:00:00.000Z');
  });
  it('a las 06:00 UTC del 1 de noviembre ya es noviembre', () => {
    expect(inicioDeMesGuatemalaEnUtc(new Date('2026-11-01T06:00:00Z')).toISOString()).toBe('2026-11-01T06:00:00.000Z');
  });
  it('cruza el año correctamente', () => {
    expect(inicioDeMesGuatemalaEnUtc(new Date('2027-01-01T03:00:00Z')).toISOString()).toBe('2026-12-01T06:00:00.000Z');
  });
});
