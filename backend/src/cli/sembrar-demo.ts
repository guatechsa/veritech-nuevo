// Uso: node dist/cli/sembrar-demo.js --url <https://.../api/taller> --taller <slug> --token <token de un administrador>
// Llena el taller de DEMOSTRACIÓN con datos de ejemplo inventados. Se niega si el taller ya tiene clientes. El token también puede ir en MIGRACION_TOKEN.
import { Api } from '../herramientas/migracion-enova';
import { sembrarDemo } from '../herramientas/sembrar-demo';

const arg = (n: string): string | undefined => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

async function principal(): Promise<void> {
  const url = arg('url');
  const taller = arg('taller');
  const token = arg('token') ?? process.env['MIGRACION_TOKEN'];
  if (!url || !taller || !token) throw new Error('Uso: sembrar-demo.js --url <api del taller> --taller <slug> --token <token>');
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
  console.log(JSON.stringify(await sembrarDemo(api), null, 2));
}

principal().catch((e: unknown) => {
  console.error('ERROR:', e instanceof Error ? e.message : e);
  process.exit(1);
});
