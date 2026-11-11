import { Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';

/** Algo sobre lo que se pueden hacer consultas: el pool o una conexión de una transacción. */
export type Ejecutor = Pool | PoolConnection;

export async function filas<T extends object = Record<string, unknown>>(
  ejecutor: Ejecutor,
  sql: string,
  parametros: unknown[] = []
): Promise<Array<T & RowDataPacket>> {
  const [resultado] = await ejecutor.query<RowDataPacket[]>(sql, parametros);
  return resultado as Array<T & RowDataPacket>;
}

export async function una<T extends object = Record<string, unknown>>(
  ejecutor: Ejecutor,
  sql: string,
  parametros: unknown[] = []
): Promise<(T & RowDataPacket) | null> {
  const resultado = await filas<T>(ejecutor, sql, parametros);
  return resultado[0] ?? null;
}

export async function ejecutar(ejecutor: Ejecutor, sql: string, parametros: unknown[] = []): Promise<ResultSetHeader> {
  const [resultado] = await ejecutor.query<ResultSetHeader>(sql, parametros);
  return resultado;
}

/** Corre `trabajo` dentro de una transacción: si lanza un error, se deshace todo. */
export async function transaccion<T>(pool: Pool, trabajo: (conexion: PoolConnection) => Promise<T>): Promise<T> {
  const conexion = await pool.getConnection();
  try {
    await conexion.beginTransaction();
    const resultado = await trabajo(conexion);
    await conexion.commit();
    return resultado;
  } catch (error) {
    await conexion.rollback();
    throw error;
  } finally {
    conexion.release();
  }
}
