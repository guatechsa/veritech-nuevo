// Uso: node dist/cli/crear-superadmin.js <correo> "<nombre completo>"
// Crea el primer super administrador del panel (o uno de emergencia) y muestra su contraseña temporal UNA sola vez.
import 'dotenv/config';
import { leerEntorno } from '../config/entorno';
import { crearPool } from '../db/conexion';
import { ejecutar, una } from '../db/consulta';
import { contrasenaTemporal, hashearContrasena } from '../utils/clave';
import { normalizarCampo } from '../utils/texto';
import { registrarAuditoria } from '../plataforma/auditoria';

async function principal(): Promise<void> {
  const [correoEscrito, nombreEscrito] = process.argv.slice(2);
  if (!correoEscrito || !nombreEscrito) throw new Error('Uso: crear-superadmin.js <correo> "<nombre completo>"');
  const correo = (normalizarCampo('correo', correoEscrito) ?? '').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) throw new Error('El correo no es válido');
  const nombre = normalizarCampo('texto', nombreEscrito) ?? '';

  const entorno = leerEntorno();
  const pool = crearPool({ host: entorno.BD_HOST, puerto: entorno.BD_PUERTO, usuario: entorno.BD_USUARIO, clave: entorno.BD_CLAVE }, entorno.BD_PLATAFORMA, 2);
  try {
    if (await una(pool, 'SELECT id FROM usuarios_plataforma WHERE correo = ?', [correo])) throw new Error(`Ya existe un usuario con el correo ${correo}`);
    const temporal = contrasenaTemporal();
    const r = await ejecutar(pool, `INSERT INTO usuarios_plataforma (nombre, correo, contrasena_hash, rol) VALUES (?, ?, ?, 'SUPER_ADMIN')`, [nombre, correo, await hashearContrasena(temporal)]);
    await registrarAuditoria(pool, { usuarioId: r.insertId, accion: 'usuario_creado', descripcion: `Se creó el super administrador ${correo} desde la línea de comandos` });
    console.log(`Super administrador creado: ${nombre} <${correo}>`);
    console.log(`Contraseña temporal (se muestra una sola vez, cámbiela al ingresar): ${temporal}`);
  } finally {
    await pool.end();
  }
}

principal().catch((error: unknown) => {
  console.error('ERROR:', error instanceof Error ? error.message : error);
  process.exit(1);
});
