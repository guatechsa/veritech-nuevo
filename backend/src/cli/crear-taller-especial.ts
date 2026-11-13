// Uso: node dist/cli/crear-taller-especial.js --tipo cortesia|demo --slug <subdominio> --nombre "<nombre del taller>" --admin "<nombre del administrador>" --correo <correo> [--plan <codigo>]
// Crea un taller SIN pasar por PayPal: de cortesía (empresa que no paga, como enova) o de demostración. Muestra la contraseña temporal UNA sola vez.
import 'dotenv/config';
import { crearTallerEspecial, TipoDeTallerEspecial } from '../alta/taller-especial';
import { leerEntorno } from '../config/entorno';
import { crearPool } from '../db/conexion';
import { Contexto } from '../plataforma/contexto';

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function principal(): Promise<void> {
  const tipo = arg('tipo');
  const slug = arg('slug');
  const nombre = arg('nombre');
  const admin = arg('admin');
  const correo = arg('correo');
  if ((tipo !== 'cortesia' && tipo !== 'demo') || !slug || !nombre || !admin || !correo) throw new Error('Uso: crear-taller-especial.js --tipo cortesia|demo --slug <x> --nombre "<x>" --admin "<x>" --correo <x> [--plan <codigo>]');
  const entorno = leerEntorno();
  const pool = crearPool({ host: entorno.BD_HOST, puerto: entorno.BD_PUERTO, usuario: entorno.BD_USUARIO, clave: entorno.BD_CLAVE }, entorno.BD_PLATAFORMA, 4);
  try {
    const ctx: Contexto = { pool, entorno };
    const r = await crearTallerEspecial(ctx, { slug, nombre, adminNombre: admin, adminCorreo: correo, planCodigo: arg('plan') ?? 'PROFESIONAL', tipo: tipo as TipoDeTallerEspecial });
    console.log(`Taller creado: ${r.subdominio} (empresa ${r.empresaId}), ${tipo === 'demo' ? 'de demostración' : 'de cortesía'}, sin cobro.`);
    console.log(`Administrador: ${correo}`);
    console.log(`Contraseña temporal (se muestra una sola vez, cámbiela al ingresar): ${r.contrasenaTemporal}`);
  } finally {
    await pool.end();
  }
}

principal().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
