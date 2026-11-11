import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import mysql, { RowDataPacket } from 'mysql2/promise';
import { opcionesBase } from '../../src/db/conexion';
import { aplicarMigraciones } from '../../src/db/migrador';
import { baseTemporal } from './ayuda';

let base: Awaited<ReturnType<typeof baseTemporal>>;
let carpeta: string;
let contador = 0;

async function escribir(nombre: string, contenido: string): Promise<void> {
  await fs.writeFile(path.join(carpeta, nombre), contenido, 'utf8');
}

async function tablasDeLaBase(): Promise<string[]> {
  const con = await mysql.createConnection(opcionesBase(base.config, base.base));
  try {
    const [filas] = await con.query<RowDataPacket[]>('SHOW TABLES');
    return filas.map((f) => String(Object.values(f)[0])).sort();
  } finally {
    await con.end();
  }
}

beforeAll(async () => {
  base = await baseTemporal();
});
afterAll(async () => {
  await base.borrar();
});
beforeEach(async () => {
  // Cada prueba usa su propia base vacía dentro de la misma base temporal: se limpian las tablas.
  const tablas = await tablasDeLaBase();
  const con = await mysql.createConnection(opcionesBase(base.config, base.base));
  try {
    for (const t of tablas) await con.query(`DROP TABLE \`${t}\``);
  } finally {
    await con.end();
  }
  carpeta = await fs.mkdtemp(path.join(os.tmpdir(), `vtn-mig-${++contador}-`));
});
afterEach(async () => {
  await fs.rm(carpeta, { recursive: true, force: true });
});

describe('aplicarMigraciones', () => {
  it('aplica en orden, registra cada archivo y crea las tablas', async () => {
    await escribir('0001_uno.sql', 'CREATE TABLE uno (id INT PRIMARY KEY);');
    await escribir('0002_dos.sql', 'CREATE TABLE dos (id INT PRIMARY KEY, uno_id INT, FOREIGN KEY (uno_id) REFERENCES uno(id));');
    const r = await aplicarMigraciones(base.config, base.base, carpeta);
    expect(r.aplicadas).toEqual(['0001_uno.sql', '0002_dos.sql']);
    expect(r.yaAplicadas).toEqual([]);
    expect(await tablasDeLaBase()).toEqual(['dos', 'migraciones_aplicadas', 'uno']);
  });

  it('es idempotente: la segunda vez no aplica nada', async () => {
    await escribir('0001_uno.sql', 'CREATE TABLE uno (id INT PRIMARY KEY);');
    await aplicarMigraciones(base.config, base.base, carpeta);
    const r = await aplicarMigraciones(base.config, base.base, carpeta);
    expect(r.aplicadas).toEqual([]);
    expect(r.yaAplicadas).toEqual(['0001_uno.sql']);
  });

  it('una migración nueva se aplica sola sobre las anteriores', async () => {
    await escribir('0001_uno.sql', 'CREATE TABLE uno (id INT PRIMARY KEY);');
    await aplicarMigraciones(base.config, base.base, carpeta);
    await escribir('0002_dos.sql', 'CREATE TABLE dos (id INT PRIMARY KEY);');
    const r = await aplicarMigraciones(base.config, base.base, carpeta);
    expect(r.aplicadas).toEqual(['0002_dos.sql']);
  });

  it('rechaza una migración ya aplicada cuyo contenido cambió', async () => {
    await escribir('0001_uno.sql', 'CREATE TABLE uno (id INT PRIMARY KEY);');
    await aplicarMigraciones(base.config, base.base, carpeta);
    await escribir('0001_uno.sql', 'CREATE TABLE uno (id BIGINT PRIMARY KEY);');
    await expect(aplicarMigraciones(base.config, base.base, carpeta)).rejects.toThrow(/su contenido cambió/);
  });

  it('rechaza cuando una migración aplicada ya no está en la carpeta (deriva en el otro sentido)', async () => {
    await escribir('0001_uno.sql', 'CREATE TABLE uno (id INT PRIMARY KEY);');
    await aplicarMigraciones(base.config, base.base, carpeta);
    await fs.rm(path.join(carpeta, '0001_uno.sql'));
    await expect(aplicarMigraciones(base.config, base.base, carpeta)).rejects.toThrow(/ya no está en la carpeta/);
  });

  it('los saltos de línea CRLF o LF no cuentan como cambio', async () => {
    await escribir('0001_uno.sql', 'CREATE TABLE uno (\n  id INT PRIMARY KEY\n);\n');
    await aplicarMigraciones(base.config, base.base, carpeta);
    await escribir('0001_uno.sql', 'CREATE TABLE uno (\r\n  id INT PRIMARY KEY\r\n);\r\n');
    const r = await aplicarMigraciones(base.config, base.base, carpeta);
    expect(r.aplicadas).toEqual([]);
  });

  it('rechaza un archivo .sql con nombre fuera del formato NNNN_descripcion.sql', async () => {
    await escribir('nueva migracion.sql', 'SELECT 1;');
    await expect(aplicarMigraciones(base.config, base.base, carpeta)).rejects.toThrow(/Nombre de migración inválido/);
  });

  it('un error de SQL dice cuál archivo falló y NO lo registra como aplicado', async () => {
    await escribir('0001_uno.sql', 'CREATE TABLE uno (id INT PRIMARY KEY);');
    await escribir('0002_mala.sql', 'CREATE TABLE mala (id INT PRIMARY KEY, columna_rota);');
    await expect(aplicarMigraciones(base.config, base.base, carpeta)).rejects.toThrow(/Falló la migración 0002_mala\.sql/);
    const con = await mysql.createConnection(opcionesBase(base.config, base.base));
    try {
      const [filas] = await con.query<RowDataPacket[]>('SELECT archivo FROM migraciones_aplicadas ORDER BY archivo');
      expect(filas.map((f) => f['archivo'])).toEqual(['0001_uno.sql']);
    } finally {
      await con.end();
    }
  });

  it('dos ejecuciones a la vez no se pisan: cada migración se aplica una sola vez', async () => {
    await escribir('0001_uno.sql', 'CREATE TABLE uno (id INT PRIMARY KEY);');
    await escribir('0002_dos.sql', 'CREATE TABLE dos (id INT PRIMARY KEY);');
    const [a, b] = await Promise.all([
      aplicarMigraciones(base.config, base.base, carpeta),
      aplicarMigraciones(base.config, base.base, carpeta),
    ]);
    expect(a.aplicadas.length + b.aplicadas.length).toBe(2);
    expect(await tablasDeLaBase()).toEqual(['dos', 'migraciones_aplicadas', 'uno']);
  });

  it('ignora archivos que no son .sql (por ejemplo .gitkeep)', async () => {
    await fs.writeFile(path.join(carpeta, '.gitkeep'), '', 'utf8');
    const r = await aplicarMigraciones(base.config, base.base, carpeta);
    expect(r.aplicadas).toEqual([]);
  });
});
