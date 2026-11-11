// Uso:
//   npm run migrar:plataforma                 -> aplica database/plataforma a la base de la plataforma
//   npm run migrar:taller -- <nombre_de_base> -> aplica database/taller a la base de UN taller
//   npm run migrar:talleres                   -> aplica database/taller a la base de CADA taller vigente (lo corre el despliegue)
import 'dotenv/config';
import path from 'node:path';
import { leerEntorno } from '../config/entorno';
import { crearPool } from '../db/conexion';
import { filas } from '../db/consulta';
import { aplicarMigraciones } from '../db/migrador';

async function principal(): Promise<void> {
  const [destino, baseTaller] = process.argv.slice(2);
  const entorno = leerEntorno();
  const config = { host: entorno.BD_HOST, puerto: entorno.BD_PUERTO, usuario: entorno.BD_USUARIO, clave: entorno.BD_CLAVE };
  const raiz = path.join(__dirname, '..', '..', '..', 'database');

  if (destino === 'talleres') {
    // Las migraciones NO se despliegan solas: cada despliegue las aplica a todos los talleres (si una falla, el despliegue falla).
    const pool = crearPool(config, entorno.BD_PLATAFORMA, 2);
    let fallos = 0;
    try {
      const talleres = await filas<{ nombre_bd: string; slug: string }>(
        pool,
        "SELECT nombre_bd, slug FROM empresas WHERE estado NOT IN ('cerrada','pendiente') AND provisionada_en IS NOT NULL ORDER BY id"
      );
      for (const t of talleres) {
        try {
          const r = await aplicarMigraciones(config, t.nombre_bd, path.join(raiz, 'taller'));
          console.log(`${t.slug} (${t.nombre_bd}): ${r.aplicadas.length} aplicada(s), ${r.yaAplicadas.length} ya estaban.`);
          for (const archivo of r.aplicadas) console.log(`  + ${archivo}`);
        } catch (error) {
          fallos += 1;
          console.error(`ERROR en ${t.slug}:`, error instanceof Error ? error.message : error);
        }
      }
      console.log(`${talleres.length} taller(es) revisados, ${fallos} con error.`);
    } finally {
      await pool.end();
    }
    if (fallos > 0) process.exit(1);
    return;
  }

  let base: string;
  let carpeta: string;
  if (destino === 'plataforma') {
    base = entorno.BD_PLATAFORMA;
    carpeta = path.join(raiz, 'plataforma');
  } else if (destino === 'taller' && baseTaller) {
    base = baseTaller;
    carpeta = path.join(raiz, 'taller');
  } else {
    throw new Error('Uso: migrar.ts plataforma | migrar.ts taller <nombre_de_base> | migrar.ts talleres');
  }

  const resultado = await aplicarMigraciones(config, base, carpeta);
  console.log(`${base}: ${resultado.aplicadas.length} aplicada(s), ${resultado.yaAplicadas.length} ya estaban.`);
  for (const archivo of resultado.aplicadas) console.log(`  + ${archivo}`);
}

principal().catch((error: unknown) => {
  console.error('ERROR:', error instanceof Error ? error.message : error);
  process.exit(1);
});
