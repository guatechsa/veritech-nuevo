// Uso:
//   npm run migrar:plataforma                 -> aplica database/plataforma a la base de la plataforma
//   npm run migrar:taller -- <nombre_de_base> -> aplica database/taller a la base de UN taller
import 'dotenv/config';
import path from 'node:path';
import { leerEntorno } from '../config/entorno';
import { aplicarMigraciones } from '../db/migrador';

async function principal(): Promise<void> {
  const [destino, baseTaller] = process.argv.slice(2);
  const entorno = leerEntorno();
  const config = { host: entorno.BD_HOST, puerto: entorno.BD_PUERTO, usuario: entorno.BD_USUARIO, clave: entorno.BD_CLAVE };
  const raiz = path.join(__dirname, '..', '..', '..', 'database');

  let base: string;
  let carpeta: string;
  if (destino === 'plataforma') {
    base = entorno.BD_PLATAFORMA;
    carpeta = path.join(raiz, 'plataforma');
  } else if (destino === 'taller' && baseTaller) {
    base = baseTaller;
    carpeta = path.join(raiz, 'taller');
  } else {
    throw new Error('Uso: migrar.ts plataforma | migrar.ts taller <nombre_de_base>');
  }

  const resultado = await aplicarMigraciones(config, base, carpeta);
  console.log(`${base}: ${resultado.aplicadas.length} aplicada(s), ${resultado.yaAplicadas.length} ya estaban.`);
  for (const archivo of resultado.aplicadas) console.log(`  + ${archivo}`);
}

principal().catch((error: unknown) => {
  console.error('ERROR:', error instanceof Error ? error.message : error);
  process.exit(1);
});
