// Uso: node dist/cli/migrar-enova.js --datos <carpeta con los .tsv> --url <https://.../api/taller> --taller <slug> --token <token de un administrador> [--simular]
// Traslada los datos de `enova` del sistema anterior al taller nuevo indicado, por su API. Sin --simular escribe; con --simular solo cuenta (ensayo).
// El token se puede dar también en la variable MIGRACION_TOKEN (así no queda en el historial de la terminal).
import { writeFileSync } from 'fs';
import { Api, cargarTablas, migrarEnova, resumen } from '../herramientas/migracion-enova';

function argumento(nombre: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function principal(): Promise<void> {
  const datos = argumento('datos');
  const url = argumento('url');
  const taller = argumento('taller');
  const token = argumento('token') ?? process.env['MIGRACION_TOKEN'];
  const simular = process.argv.includes('--simular');
  if (!datos || !url || !taller || !token) throw new Error('Faltan datos. Uso: migrar-enova.js --datos <carpeta> --url <api del taller> --taller <slug> --token <token> [--simular]');
  const base = url.replace(/\/$/, '');
  const api: Api = {
    async llamar(metodo, ruta, cuerpo) {
      const r = await fetch(`${base}${ruta}`, {
        method: metodo,
        headers: { 'X-Taller': taller, Authorization: `Bearer ${token}`, ...(cuerpo === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
        signal: AbortSignal.timeout(60000),
      });
      const texto = await r.text();
      let body = {};
      try {
        body = JSON.parse(texto) as object;
      } catch {
        body = { error: texto.slice(0, 200) };
      }
      return { status: r.status, body };
    },
  };
  const informe = await migrarEnova(api, cargarTablas(datos), { simular });
  const texto = resumen(informe);
  console.log(texto);
  const archivo = `informe-migracion-enova-${simular ? 'ensayo' : 'real'}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '')}.txt`;
  writeFileSync(archivo, texto);
  console.log(`\nInforme guardado en ${archivo}`);
  if (informe.control.some((x) => !x.coincide)) process.exitCode = 2;
}

principal().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
