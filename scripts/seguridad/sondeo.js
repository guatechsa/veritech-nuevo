// Sondeo de seguridad de SOLO LECTURA contra un sitio del sistema nuevo (no modifica nada ni usa cuentas reales).
// Uso: node scripts/seguridad/sondeo.js https://pruebas.veritech.lat [slug-de-un-taller] [--limite]
// --limite agrega la prueba del freno de intentos (25 ingresos malos seguidos): bloquea ESA conexión unos minutos para ese taller, así que no se usa en sitios con gente trabajando.
// Revisa: cabeceras de seguridad, archivos que no deben verse, rutas que exigen sesión, CORS, límites de intentos y errores que no filtren detalles.
const base = (process.argv[2] ?? 'https://pruebas.veritech.lat').replace(/\/$/, '');
const slug = process.argv.slice(3).find((a) => !a.startsWith('--')) ?? 'prueba1';
const resultados = [];
const anotar = (ok, que, detalle = '') => resultados.push({ ok, que, detalle });

async function pedir(ruta, opciones = {}) {
  const r = await fetch(base + ruta, { redirect: 'manual', ...opciones });
  const texto = await r.text();
  return { estado: r.status, cabeceras: r.headers, texto };
}

(async () => {
  // 1. Cabeceras de seguridad de la página y de la API.
  const pagina = await pedir('/');
  const api = await pedir('/api/health');
  for (const [nombre, r] of [['página', pagina], ['api', api]]) {
    anotar(r.cabeceras.get('x-content-type-options') === 'nosniff', `${nombre}: X-Content-Type-Options nosniff`);
    anotar(!!r.cabeceras.get('x-frame-options') || /frame-ancestors/.test(r.cabeceras.get('content-security-policy') ?? ''), `${nombre}: protegida contra marcos (clickjacking)`);
    anotar(!!r.cabeceras.get('strict-transport-security'), `${nombre}: Strict-Transport-Security (HSTS)`, r.cabeceras.get('strict-transport-security') ?? 'falta');
    anotar(!!r.cabeceras.get('content-security-policy'), `${nombre}: Content-Security-Policy`, r.cabeceras.get('content-security-policy') ? '' : 'falta');
    anotar(!/x-powered-by/i.test([...r.cabeceras.keys()].join(',')), `${nombre}: no anuncia la tecnología (X-Powered-By)`);
  }
  anotar(/no-store|no-cache/.test(pagina.cabeceras.get('cache-control') ?? ''), 'index.html sin caché (estándar §14)');

  // 2. Archivos que nunca deben verse.
  for (const ruta of ['/.env', '/api/.env', '/.git/config', '/backend/.env', '/package.json', '/backend/package.json', '/node_modules/', '/.htaccess', '/api/../.env', '/server.js', '/database/taller/0001_base.sql']) {
    const r = await pedir(ruta);
    const sospechoso = r.estado === 200 && !/<!doctype html|<html/i.test(r.texto);
    anotar(!sospechoso, `no expone ${ruta}`, `HTTP ${r.estado}`);
  }

  // 3. Todo lo del taller exige sesión (se prueban rutas de varios módulos).
  const rutasProtegidas = ['/clientes', '/equipos', '/ordenes', '/materiales', '/colaboradores', '/cotizaciones', '/reportes/indicadores', '/importar/tipos', '/exportar/datos', '/movil/mi-dia', '/usuarios', '/configuracion', '/avisos', '/documentos'];
  for (const ruta of rutasProtegidas) {
    const r = await pedir(`/api/taller${ruta}`, { headers: { 'X-Taller': slug } });
    anotar(r.estado === 401 || r.estado === 404, `exige sesión: /api/taller${ruta}`, `HTTP ${r.estado}`);
  }
  const falso = await pedir('/api/taller/clientes', { headers: { 'X-Taller': slug, Authorization: 'Bearer ' + 'a'.repeat(64) } });
  anotar(falso.estado === 401, 'un token inventado no entra', `HTTP ${falso.estado}`);
  const jwtFalso = await pedir('/api/taller/clientes', { headers: { 'X-Taller': slug, Authorization: 'Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOjF9.' } });
  anotar(jwtFalso.estado === 401, 'un JWT «alg: none» no entra', `HTTP ${jwtFalso.estado}`);
  const plataforma = await pedir('/api/plataforma/empresas');
  anotar(plataforma.estado === 401, 'el panel de plataforma exige sesión', `HTTP ${plataforma.estado}`);

  // 4. Un taller que no existe, o cabeceras de taller raras, no dan datos ni errores internos.
  for (const t of ['no-existe-xyz', "x'; DROP TABLE empresas;--", '../../etc/passwd', 'a'.repeat(300)]) {
    const r = await pedir('/api/taller/auth/ingresar', { method: 'POST', headers: { 'X-Taller': t, 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'x@y.test', contrasena: 'x' }) });
    anotar(r.estado < 500 && !/at .*\.(js|ts):\d+|\bER_|SQL syntax|stack/i.test(r.texto), `taller raro «${t.slice(0, 20)}»: sin error interno ni detalles`, `HTTP ${r.estado}`);
  }

  // 5. Entradas con intentos de inyección no rompen nada ni filtran detalles.
  for (const carga of ["' OR '1'='1", '" OR 1=1 --', '<script>alert(1)</script>', '${7*7}', '\u0000']) {
    const r = await pedir('/api/taller/auth/ingresar', { method: 'POST', headers: { 'X-Taller': slug, 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: carga, contrasena: carga }) });
    anotar(r.estado >= 400 && r.estado < 500 && !/SQL|\bER_|stack|at .*:\d+/i.test(r.texto), `inyección «${carga.slice(0, 15)}» en el ingreso: rechazada limpiamente`, `HTTP ${r.estado}`);
  }
  const malJson = await pedir('/api/taller/auth/ingresar', { method: 'POST', headers: { 'X-Taller': slug, 'Content-Type': 'application/json' }, body: '{"correo": ' });
  anotar(malJson.estado === 400 && !/SyntaxError|at /.test(malJson.texto), 'un JSON roto da 400 sin detalles internos', `HTTP ${malJson.estado}`);
  const grande = await pedir('/api/taller/auth/ingresar', { method: 'POST', headers: { 'X-Taller': slug, 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: 'a@b.test', contrasena: 'x'.repeat(2_000_000) }) });
  anotar(grande.estado === 413 || grande.estado === 400, 'un cuerpo gigante se rechaza', `HTTP ${grande.estado}`);

  // 6. CORS: un sitio ajeno no recibe permiso.
  const cors = await pedir('/api/taller/auth/ingresar', { method: 'OPTIONS', headers: { Origin: 'https://sitio-malo.example', 'Access-Control-Request-Method': 'POST', 'X-Taller': slug } });
  const permitido = cors.cabeceras.get('access-control-allow-origin');
  anotar(permitido !== '*' && permitido !== 'https://sitio-malo.example', 'CORS no permite sitios ajenos', `Allow-Origin: ${permitido ?? 'ninguno'}`);

  // 7. Límite de intentos en el ingreso (20 intentos seguidos con una clave mala deben toparse con 429).
  let limitado = false;
  if (process.argv.includes('--limite')) for (let i = 0; i < 25 && !limitado; i++) {
    const r = await pedir('/api/taller/auth/ingresar', { method: 'POST', headers: { 'X-Taller': slug, 'Content-Type': 'application/json' }, body: JSON.stringify({ correo: `sondeo${i}@noexiste.test`, contrasena: 'Mala-clave-2026!' }) });
    if (r.estado === 429) limitado = true;
  }
  if (process.argv.includes('--limite')) anotar(limitado, 'el ingreso se frena tras muchos intentos (429)');

  // 8. Enlaces públicos: un token inventado no da nada y no dice si «casi» existe.
  const pub = await pedir('/api/taller/publico/cotizacion/' + 'b'.repeat(40), { headers: { 'X-Taller': slug } });
  anotar(pub.estado === 404 || pub.estado === 410, 'un enlace público inventado no abre nada', `HTTP ${pub.estado}`);

  const malos = resultados.filter((r) => !r.ok);
  for (const r of resultados) console.log(`${r.ok ? 'OK ' : 'MAL'} ${r.que}${r.detalle ? ` — ${r.detalle}` : ''}`);
  console.log(`\n${resultados.length - malos.length} de ${resultados.length} comprobaciones bien.`);
  process.exitCode = malos.length ? 1 : 0;
})().catch((e) => {
  console.error('ERROR:', e.message);
  process.exit(2);
});
