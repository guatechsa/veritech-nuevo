import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import mysql, { RowDataPacket } from 'mysql2/promise';
import path from 'node:path';
import { ConfigBd, opcionesBase } from './conexion';

/**
 * Aplicador de migraciones (estándar GUATECH §8).
 *  - La estructura de la base sale SOLO de los archivos `NNNN_nombre.sql` de la carpeta, en orden.
 *  - Una migración aplicada nunca cambia: si su contenido cambia, o desaparece de la carpeta, se rechaza.
 *  - La lista NO se escribe a mano: se recorre la carpeta.
 *  - Dos ejecuciones a la vez no se pisan (bloqueo por base).
 *  - Los saltos de línea CRLF/LF no cuentan como cambio.
 */
const NOMBRE_ARCHIVO = /^\d{4}_[a-z0-9_]+\.sql$/;
const TABLA = 'migraciones_aplicadas';

export interface ResultadoMigraciones {
  aplicadas: string[];
  yaAplicadas: string[];
}

export function sumaDeContenido(contenido: string): string {
  return crypto.createHash('sha256').update(contenido.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

export async function aplicarMigraciones(config: ConfigBd, base: string, carpeta: string): Promise<ResultadoMigraciones> {
  const archivos = await listarMigraciones(carpeta);

  const con = await mysql.createConnection({ ...opcionesBase(config, base), multipleStatements: true });
  const bloqueo = `vtn_migraciones_${base}`;
  try {
    await con.query("SET time_zone = '+00:00'");
    const [filaBloqueo] = await con.query<RowDataPacket[]>('SELECT GET_LOCK(?, 60) AS ok', [bloqueo]);
    if (filaBloqueo[0]?.['ok'] !== 1) {
      throw new Error(`No se pudo obtener el bloqueo de migraciones de ${base}: otra ejecución sigue en curso`);
    }

    await con.query(
      `CREATE TABLE IF NOT EXISTS ${TABLA} (
         archivo VARCHAR(190) NOT NULL,
         suma CHAR(64) NOT NULL,
         aplicada_en DATETIME NOT NULL DEFAULT (UTC_TIMESTAMP()),
         PRIMARY KEY (archivo)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );

    const [filas] = await con.query<RowDataPacket[]>(`SELECT archivo, suma FROM ${TABLA}`);
    const registradas = new Map<string, string>(filas.map((f) => [String(f['archivo']), String(f['suma'])]));

    // Deriva en ambos sentidos: lo aplicado debe seguir existiendo y sin cambios.
    const enCarpeta = new Map(archivos.map((a) => [a.nombre, a.suma]));
    for (const [archivo, suma] of registradas) {
      const actual = enCarpeta.get(archivo);
      if (actual === undefined) {
        throw new Error(`La migración ${archivo} ya se aplicó en ${base} pero ya no está en la carpeta ${carpeta}`);
      }
      if (actual !== suma) {
        throw new Error(`La migración ${archivo} ya se aplicó en ${base} y su contenido cambió: no se edita una migración aplicada, se agrega otra`);
      }
    }

    const resultado: ResultadoMigraciones = { aplicadas: [], yaAplicadas: [...registradas.keys()].sort() };
    for (const archivo of archivos) {
      if (registradas.has(archivo.nombre)) continue;
      try {
        await con.query(archivo.contenido);
      } catch (error) {
        const motivo = error instanceof Error ? error.message : String(error);
        throw new Error(`Falló la migración ${archivo.nombre} en ${base}: ${motivo}`);
      }
      await con.query(`INSERT INTO ${TABLA} (archivo, suma) VALUES (?, ?)`, [archivo.nombre, archivo.suma]);
      resultado.aplicadas.push(archivo.nombre);
    }
    return resultado;
  } finally {
    try {
      await con.query('SELECT RELEASE_LOCK(?)', [bloqueo]);
    } finally {
      await con.end();
    }
  }
}

async function listarMigraciones(carpeta: string): Promise<Array<{ nombre: string; contenido: string; suma: string }>> {
  const entradas = await fs.readdir(carpeta);
  const sql = entradas.filter((n) => n.toLowerCase().endsWith('.sql'));
  for (const nombre of sql) {
    if (!NOMBRE_ARCHIVO.test(nombre)) {
      throw new Error(`Nombre de migración inválido: ${nombre} (debe ser NNNN_descripcion_en_minusculas.sql)`);
    }
  }
  sql.sort();
  const resultado: Array<{ nombre: string; contenido: string; suma: string }> = [];
  for (const nombre of sql) {
    const contenido = await fs.readFile(path.join(carpeta, nombre), 'utf8');
    resultado.push({ nombre, contenido, suma: sumaDeContenido(contenido) });
  }
  return resultado;
}
