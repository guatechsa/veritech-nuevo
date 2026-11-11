import { ejecutar, una } from '../db/consulta';
import { ErrorApp, ErrorConflicto, ErrorNoEncontrado } from '../errores';
import { crearToken, huellaDe } from '../utils/tokens';
import { registrarAuditoria } from './auditoria';
import { Contexto, UsuarioPlataforma } from './contexto';

/**
 * "Entrar" de soporte (estándar de acceso de soporte): un token de UN solo uso y 60 segundos para abrir una sesión como
 * un usuario del taller, siempre auditado. El canje lo atiende el login del taller (Fase 3); aquí vive la emisión y la
 * regla de un solo uso, ya probadas.
 */
export const SEGUNDOS_TOKEN_SOPORTE = 60;
const ESTADOS_CON_ACCESO = ['prueba', 'activa', 'pago_fallido', 'cancelada_con_acceso'];

export async function emitirTokenAcceso(
  ctx: Contexto,
  actor: UsuarioPlataforma,
  datos: { empresaId: number; usuarioDestinoId: number },
  origen: { ip: string; userAgent: string }
): Promise<{ token: string; venceEnSegundos: number }> {
  if (actor.rol !== 'SUPER_ADMIN') throw new ErrorApp(403, 'SIN_PERMISO', 'Solo un super administrador puede entrar como soporte');
  const empresa = await una<{ nombre: string; estado: string }>(ctx.pool, 'SELECT nombre, estado FROM empresas WHERE id = ?', [datos.empresaId]);
  if (!empresa) throw new ErrorNoEncontrado('Empresa no encontrada');
  if (!ESTADOS_CON_ACCESO.includes(empresa.estado)) throw new ErrorConflicto(`La empresa está en estado «${empresa.estado}» y no admite acceso de soporte`);

  const { token, huella } = crearToken();
  await ejecutar(
    ctx.pool,
    `INSERT INTO tokens_acceso_soporte (huella, empresa_id, usuario_destino_id, creado_por, vence_en, ip)
     VALUES (?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), ?)`,
    [huella, datos.empresaId, datos.usuarioDestinoId, actor.id, SEGUNDOS_TOKEN_SOPORTE, origen.ip]
  );
  await registrarAuditoria(ctx.pool, {
    usuarioId: actor.id,
    accion: 'acceso_soporte_iniciado',
    empresaId: datos.empresaId,
    descripcion: `Abrió una sesión de soporte en ${empresa.nombre} (usuario ${datos.usuarioDestinoId})`,
    ...origen,
  });
  return { token, venceEnSegundos: SEGUNDOS_TOKEN_SOPORTE };
}

/** Canje del token: se marca usado en la misma operación que lo valida, así dos intentos a la vez no pasan los dos. */
export async function consumirTokenAcceso(ctx: Contexto, token: string, ip: string) {
  const huella = huellaDe(token);
  const marca = await ejecutar(
    ctx.pool,
    'UPDATE tokens_acceso_soporte SET usado_en = UTC_TIMESTAMP(), ip = ? WHERE huella = ? AND usado_en IS NULL AND vence_en > UTC_TIMESTAMP()',
    [ip, huella]
  );
  if (marca.affectedRows !== 1) throw new ErrorApp(400, 'TOKEN_INVALIDO', 'El enlace de acceso no es válido o ya venció. Pida uno nuevo a soporte.');
  const fila = await una<{ empresa_id: number; usuario_destino_id: number; creado_por: number }>(
    ctx.pool,
    'SELECT empresa_id, usuario_destino_id, creado_por FROM tokens_acceso_soporte WHERE huella = ?',
    [huella]
  );
  if (!fila) throw new ErrorApp(400, 'TOKEN_INVALIDO', 'El enlace de acceso no es válido o ya venció. Pida uno nuevo a soporte.');
  return { empresaId: fila.empresa_id, usuarioDestinoId: fila.usuario_destino_id, creadoPor: fila.creado_por };
}
