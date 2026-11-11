import mysql from 'mysql2/promise';
import { ConfigBd, opcionesBase } from './conexion';
import { ErrorValidacion } from '../errores';

const NOMBRE_VALIDO = /^[a-z0-9_]+$/;

function validarNombre(base: string): void {
  if (!NOMBRE_VALIDO.test(base) || base.length > 64) {
    throw new ErrorValidacion(`Nombre de base de datos inválido: ${base}`);
  }
}

/** Crea una base vacía (idempotente) con el juego de caracteres estándar del sistema. */
export async function crearBase(config: ConfigBd, base: string): Promise<void> {
  validarNombre(base);
  const con = await mysql.createConnection(opcionesBase(config));
  try {
    await con.query(`CREATE DATABASE IF NOT EXISTS \`${base}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await con.end();
  }
}

/** Borra una base. Solo se permite con el prefijo `vtn_` (bases de prueba o temporales); nunca una de producción. */
export async function borrarBaseTemporal(config: ConfigBd, base: string): Promise<void> {
  validarNombre(base);
  if (!base.startsWith('vtn_')) {
    throw new ErrorValidacion(`Por seguridad solo se borran bases temporales (prefijo vtn_): ${base}`);
  }
  const con = await mysql.createConnection(opcionesBase(config));
  try {
    await con.query(`DROP DATABASE IF EXISTS \`${base}\``);
  } finally {
    await con.end();
  }
}

/**
 * Borra la base de un taller cerrado. Triple guarda: el nombre debe llevar el prefijo de talleres, no puede ser la base de
 * la plataforma y debe ser más largo que el prefijo (nunca una base "pelada"). Quien llama además comprueba el estado.
 */
export async function borrarBaseDeTaller(config: ConfigBd, base: string, prefijoTaller: string, basePlataforma: string): Promise<void> {
  validarNombre(base);
  if (!base.startsWith(prefijoTaller) || base.length <= prefijoTaller.length || base === basePlataforma) {
    throw new ErrorValidacion(`Por seguridad no se borra la base ${base}: no es de un taller`);
  }
  const con = await mysql.createConnection(opcionesBase(config));
  try {
    await con.query(`DROP DATABASE IF EXISTS \`${base}\``);
  } finally {
    await con.end();
  }
}
