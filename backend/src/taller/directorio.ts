import { ejecutar } from '../db/consulta';
import { Contexto } from '../plataforma/contexto';

/**
 * El directorio de accesos (plataforma) dice qué talleres tiene cada correo para la página "Entrar". Vive en OTRA base que
 * el taller, así que no hay transacción entre las dos: se actualiza justo después del cambio y una revisión semanal lo
 * reconcilia (riesgo conocido del diseño). Un fallo aquí se avisa en el registro pero no deshace el cambio del taller.
 */
async function seguro(accion: string, trabajo: () => Promise<unknown>): Promise<void> {
  try {
    await trabajo();
  } catch (error) {
    console.error(`[directorio] no se pudo ${accion}:`, error);
  }
}

export async function agregarAccesoEnDirectorio(ctx: Contexto, empresaId: number, correo: string, usuarioId: number): Promise<void> {
  await seguro('agregar el acceso', () =>
    ejecutar(ctx.pool, 'INSERT INTO directorio_acceso (correo, empresa_id, usuario_id, activo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), activo = 1', [correo, empresaId, usuarioId])
  );
}

export async function desactivarAccesoEnDirectorio(ctx: Contexto, empresaId: number, usuarioId: number): Promise<void> {
  await seguro('desactivar el acceso', () => ejecutar(ctx.pool, 'UPDATE directorio_acceso SET activo = 0 WHERE empresa_id = ? AND usuario_id = ?', [empresaId, usuarioId]));
}

export async function reactivarAccesoEnDirectorio(ctx: Contexto, empresaId: number, usuarioId: number): Promise<void> {
  await seguro('reactivar el acceso', () => ejecutar(ctx.pool, 'UPDATE directorio_acceso SET activo = 1 WHERE empresa_id = ? AND usuario_id = ?', [empresaId, usuarioId]));
}

export async function moverCorreoEnDirectorio(ctx: Contexto, empresaId: number, usuarioId: number, anterior: string | null, nuevo: string | null): Promise<void> {
  await seguro('cambiar el correo', async () => {
    await ejecutar(ctx.pool, 'DELETE FROM directorio_acceso WHERE empresa_id = ? AND usuario_id = ?', [empresaId, usuarioId]);
    if (nuevo) await ejecutar(ctx.pool, 'INSERT INTO directorio_acceso (correo, empresa_id, usuario_id, activo) VALUES (?, ?, ?, 1) ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), activo = 1', [nuevo, empresaId, usuarioId]);
    void anterior;
  });
}
