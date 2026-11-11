import crypto from 'node:crypto';
import { ConfigBd } from '../../src/db/conexion';
import { borrarBaseTemporal, crearBase } from '../../src/db/bases';

/** Credenciales de la base de PRUEBAS (backend/.env.test en local; variables del flujo en integración continua). */
export function configPruebas(): ConfigBd {
  const usuario = process.env['BD_USUARIO'];
  if (!usuario) {
    throw new Error('Faltan las variables de la base de pruebas (BD_HOST, BD_PUERTO, BD_USUARIO, BD_CLAVE). Cree backend/.env.test.');
  }
  return {
    host: process.env['BD_HOST'] ?? '127.0.0.1',
    puerto: Number(process.env['BD_PUERTO'] ?? 3306),
    usuario,
    clave: process.env['BD_CLAVE'] ?? '',
  };
}

/** Crea una base temporal propia de la prueba (prefijo vtn_test_) y devuelve cómo borrarla. */
export async function baseTemporal(): Promise<{ config: ConfigBd; base: string; borrar: () => Promise<void> }> {
  const config = configPruebas();
  const base = `vtn_test_${crypto.randomBytes(5).toString('hex')}`;
  await crearBase(config, base);
  return { config, base, borrar: () => borrarBaseTemporal(config, base) };
}
