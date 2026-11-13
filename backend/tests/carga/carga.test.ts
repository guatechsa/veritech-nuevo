import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { mundo } from '../taller/ayuda-ordenes';

/**
 * Prueba de CARGA (solo si se pide: CARGA=1 npx jest tests/carga). Llena un taller con un volumen de un cliente grande (2.000 clientes, 6.000 equipos,
 * 40.000 órdenes con 80.000 líneas y 3.000 materiales, repartidos en 3 años) y mide cuánto tarda cada pantalla principal, de una en una y con 10 personas a la vez.
 * La meta: ninguna pantalla tarda más de 1,5 s en el percentil 95 con carga normal.
 */
const ACTIVA = process.env['CARGA'] === '1';
const META_MS = Number(process.env['CARGA_META_MS'] ?? 1500);

let e: EntornoDePrueba;
beforeAll(async () => {
  if (ACTIVA) e = await crearEntornoDePrueba();
});
afterAll(async () => {
  if (ACTIVA) await e.cerrar();
});

const percentil = (v: number[], p: number): number => [...v].sort((a, b) => a - b)[Math.min(v.length - 1, Math.floor((p / 100) * v.length))]!;

(ACTIVA ? describe : describe.skip)('carga de un taller grande', () => {
  it('las pantallas principales responden rápido con 40.000 órdenes', async () => {
    await e.limpiar();
    await e.planesConPaypal();
    const m = await mundo(e);
    const t0 = Date.now();
    await m.t.sql(async (c) => {
      // Una tabla de 0 a 9 para armar números con cruces (no depende de ninguna extensión del servidor).
      await c.query('CREATE TABLE carga_d (n INT)');
      await c.query('INSERT INTO carga_d VALUES (0),(1),(2),(3),(4),(5),(6),(7),(8),(9)');
      const secuencia = (cifras: number): string => `(SELECT ${Array.from({ length: cifras }, (_, i) => `d${i}.n * ${10 ** i}`).join(' + ')} AS k FROM ${Array.from({ length: cifras }, (_, i) => `carga_d AS d${i}`).join(' CROSS JOIN ')})`;
      await c.query(`INSERT INTO clientes (nombre, nit) SELECT CONCAT('CLIENTE DE CARGA ', k), CONCAT('C', k) FROM ${secuencia(4)} s WHERE k < 2000`);
      await c.query(
        `INSERT INTO equipos (tipo_equipo_id, codigo_interno, placa, serie, modelo, anio, cliente_id, codigo_publico)
         SELECT ?, CONCAT('EQ-', k), CONCAT('P', LPAD(k, 6, '0')), CONCAT('SERIE', k), 'MODELO CARGA', 2015 + (k MOD 10), (SELECT MIN(id) FROM clientes WHERE nombre = CONCAT('CLIENTE DE CARGA ', k MOD 2000)), LPAD(HEX(k + 1000000), 16, '0')
         FROM ${secuencia(4)} s WHERE k < 6000`,
        [m.tipoVehiculo]
      );
      const ids = async (consulta: string): Promise<number[]> => ((await c.query(consulta))[0] as Array<{ id: number }>).map((x) => x.id);
      const suc = { id: (await ids('SELECT id FROM sucursales WHERE es_principal = 1 LIMIT 1'))[0]! };
      const estados = (await ids('SELECT id FROM estados_orden WHERE activo = 1 ORDER BY id')).map((id) => ({ id }));
      const tipo = { id: (await ids('SELECT id FROM tipos_orden WHERE es_default = 1 LIMIT 1'))[0]! };
      const lista = estados.map((x) => x.id).join(',');
      await c.query(
        `INSERT INTO ordenes (numero, cliente_id, equipo_id, sucursal_id, tipo_orden_id, estado_id, prioridad, descripcion, subtotal, total, created_at, fecha_cierre)
         SELECT CONCAT('CAR-', LPAD(k, 6, '0')), e.cliente_id, e.id, ?, ?, ELT(1 + (k MOD ?), ${lista}), 'media', CONCAT('ORDEN DE CARGA ', k), 100 + (k MOD 500), 112 + (k MOD 500),
                DATE_SUB(NOW(), INTERVAL (k MOD 1095) DAY), IF(k MOD 3 = 0, DATE_SUB(NOW(), INTERVAL (k MOD 1095) - 2 DAY), NULL)
         FROM ${secuencia(5)} s JOIN (SELECT id, cliente_id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS r FROM equipos) e ON e.r = s.k MOD 6001
         WHERE k < 40000`,
        [suc.id, tipo.id, estados.length]
      );
      await c.query(
        `INSERT INTO lineas_orden (orden_id, tipo, trabajo_id, descripcion, cantidad, precio_unitario, total_linea, horas_trabajo, estado)
         SELECT o.id, 'servicio', ?, 'LINEA DE CARGA', 1, 100, 100, 2, 'terminado' FROM ordenes o JOIN (SELECT 0 AS j UNION ALL SELECT 1) x ON 1 = 1 WHERE o.numero LIKE 'CAR-%'`,
        [m.trabajo]
      );
      const parte = (await ids('SELECT id FROM partes LIMIT 1'))[0]!;
      const und = (await ids('SELECT id FROM unidades LIMIT 1'))[0]!;
      await c.query(
        `INSERT INTO materiales (codigo, nombre, parte_id, unidad_id) SELECT CONCAT('MAT-', LPAD(k, 5, '0')), CONCAT('MATERIAL DE CARGA ', k), ?, ? FROM ${secuencia(4)} s WHERE k < 3000`,
        [parte, und]
      );
    });
    console.log(`Carga de datos: ${((Date.now() - t0) / 1000).toFixed(1)} s`);

    const pantallas: Array<[string, string]> = [
      ['Órdenes abiertas', '/ordenes?abiertas=true'],
      ['Órdenes: buscar por texto', '/ordenes?buscar=ORDEN%20DE%20CARGA%2012345'],
      ['Órdenes: página 500', '/ordenes?pagina=500'],
      ['Equipos: buscar por placa', '/equipos?buscar=P003456'],
      ['Equipos: listado', '/equipos'],
      ['Clientes: buscar', '/clientes?buscar=CARGA%201234'],
      ['Materiales: buscar', '/materiales?buscar=CARGA%202345'],
      ['Búsqueda global', '/buscar?q=12345'],
      ['Tablero de inicio', '/tablero'],
      ['Indicadores (último año)', `/indicadores?desde=${new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10)}&hasta=${new Date().toISOString().slice(0, 10)}`],
    ];
    const token = await m.t.token();
    const api = m.t.api(token);
    const filasInforme: string[] = [];
    const lentas: string[] = [];
    for (const [nombre, ruta] of pantallas) {
      const tiempos: number[] = [];
      for (let i = 0; i < 12; i++) {
        const t = Date.now();
        const r = await api.get(ruta);
        tiempos.push(Date.now() - t);
        if (r.status !== 200) throw new Error(`${nombre}: respondió ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
      }
      // 10 personas a la vez.
      const simultaneos = await Promise.all(Array.from({ length: 10 }, async () => {
        const t = Date.now();
        await api.get(ruta);
        return Date.now() - t;
      }));
      const p95 = percentil(tiempos, 95);
      const p95c = percentil(simultaneos, 95);
      filasInforme.push(`${nombre.padEnd(30)} 1 persona: mediana ${String(percentil(tiempos, 50)).padStart(5)} ms · p95 ${String(p95).padStart(5)} ms   10 a la vez: p95 ${String(p95c).padStart(5)} ms`);
      if (p95 > META_MS || p95c > META_MS * 3) lentas.push(`${nombre} (p95 ${p95} ms; a la vez ${p95c} ms)`);
    }
    console.log(`\n${filasInforme.join('\n')}\n\nLentas (meta ${META_MS} ms, y ${META_MS * 3} ms con 10 a la vez): ${lentas.length ? lentas.join(' | ') : 'ninguna'}`);
    expect(lentas).toEqual([]);
  }, 1800000);
});
