import { Pool } from 'mysql2/promise';
import { RowDataPacket } from 'mysql2';
import { crearPool } from '../../src/db/conexion';
import { baseTemporal } from './ayuda';

/**
 * El sistema anterior guardaba horas con 6 h de desfase (el servidor Node corre en America/Guatemala y la base en otra
 * zona). Aquí se prueba que, aunque el proceso corra en UTC-6 (tests/cargar-env.js fija TZ=America/Guatemala),
 * lo que se guarda y se lee es UTC exacto.
 */
let base: Awaited<ReturnType<typeof baseTemporal>>;
let pool: Pool;

beforeAll(async () => {
  base = await baseTemporal();
  pool = crearPool(base.config, base.base, 2);
  await pool.query('CREATE TABLE evento (id INT PRIMARY KEY, momento DATETIME NOT NULL, dia DATE NOT NULL)');
});
afterAll(async () => {
  await pool.end();
  await base.borrar();
});

describe('zona horaria', () => {
  it('el proceso corre en una zona distinta de UTC (la prueba tiene sentido)', () => {
    expect(new Date(2026, 0, 1, 12).getTimezoneOffset()).not.toBe(0);
  });

  it('cada conexión del pool trabaja en UTC', async () => {
    const [filas] = await pool.query<RowDataPacket[]>('SELECT @@session.time_zone AS zona');
    expect(filas[0]?.['zona']).toBe('+00:00');
  });

  it('un instante guardado desde JavaScript se lee idéntico (sin correrse horas)', async () => {
    const instante = new Date('2026-11-11T23:30:00.000Z');
    await pool.query('INSERT INTO evento (id, momento, dia) VALUES (1, ?, ?)', [instante, '2026-11-11']);
    const [filas] = await pool.query<RowDataPacket[]>('SELECT momento FROM evento WHERE id = 1');
    expect((filas[0]?.['momento'] as Date).toISOString()).toBe('2026-11-11T23:30:00.000Z');
    // y la base lo guardó como esa misma hora UTC, no como la hora local de Guatemala
    const [texto] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(momento, '%Y-%m-%d %H:%i:%s') AS t FROM evento WHERE id = 1");
    expect(texto[0]?.['t']).toBe('2026-11-11 23:30:00');
  });

  it('NOW() de la base y la hora de JavaScript coinciden en UTC', async () => {
    const [filas] = await pool.query<RowDataPacket[]>('SELECT NOW() AS ahora');
    const desfase = Math.abs((filas[0]?.['ahora'] as Date).getTime() - Date.now());
    expect(desfase).toBeLessThan(5000);
  });

  it('una fecha de calendario (DATE) no se corre de día', async () => {
    const [filas] = await pool.query<RowDataPacket[]>("SELECT DATE_FORMAT(dia, '%Y-%m-%d') AS d FROM evento WHERE id = 1");
    expect(filas[0]?.['d']).toBe('2026-11-11');
  });
});
