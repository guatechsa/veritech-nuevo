import mysql, { Pool, PoolOptions } from 'mysql2/promise';

export interface ConfigBd {
  host: string;
  puerto: number;
  usuario: string;
  clave: string;
}

/**
 * Opciones comunes de conexión. Todo el sistema guarda y lee las horas en UTC:
 *  - `timezone: 'Z'` hace que los Date de JavaScript se interpreten como UTC al ir y venir de la base;
 *  - cada conexión además fija `time_zone = '+00:00'` para que NOW() / CURRENT_TIMESTAMP de la base también sean UTC.
 * (El sistema anterior guardaba horas con 6 h de desfase por no hacer esto.)
 */
export function opcionesBase(config: ConfigBd, base?: string): PoolOptions {
  return {
    host: config.host,
    port: config.puerto,
    user: config.usuario,
    password: config.clave,
    database: base,
    charset: 'utf8mb4',
    timezone: 'Z',
    decimalNumbers: true,
    dateStrings: false,
  };
}

export function crearPool(config: ConfigBd, base: string, limiteConexiones = 10): Pool {
  const pool = mysql.createPool({ ...opcionesBase(config, base), connectionLimit: limiteConexiones });
  pool.on('connection', (conexion) => {
    conexion.query("SET time_zone = '+00:00'");
  });
  return pool;
}
