import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorConflicto, ErrorNoEncontrado } from '../errores';
import { contrasenaTemporal, hashearContrasena } from '../utils/clave';
import { normalizarCampo } from '../utils/texto';
import { registrarAuditoria } from './auditoria';
import { Contexto, RolPlataforma, UsuarioPlataforma } from './contexto';

interface Origen {
  ip: string;
  userAgent: string;
}

export function listarUsuarios(ctx: Contexto) {
  return filas(
    ctx.pool,
    'SELECT id, nombre, correo, rol, activo, ultimo_ingreso, created_at FROM usuarios_plataforma ORDER BY nombre'
  );
}

function esDuplicado(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ER_DUP_ENTRY';
}

export async function crearUsuario(
  ctx: Contexto,
  actor: UsuarioPlataforma,
  datos: { nombre: string; correo: string; rol: RolPlataforma },
  origen: Origen
): Promise<{ id: number; contrasenaTemporal: string }> {
  const nombre = normalizarCampo('texto', datos.nombre) ?? '';
  const correo = (normalizarCampo('correo', datos.correo) ?? '').toLowerCase();
  const temporal = contrasenaTemporal();
  const hash = await hashearContrasena(temporal);
  try {
    const id = await transaccion(ctx.pool, async (con) => {
      const r = await ejecutar(con, 'INSERT INTO usuarios_plataforma (nombre, correo, contrasena_hash, rol) VALUES (?, ?, ?, ?)', [nombre, correo, hash, datos.rol]);
      await registrarAuditoria(con, { usuarioId: actor.id, accion: 'usuario_creado', descripcion: `Creó al usuario ${correo} con rol ${datos.rol}`, ...origen });
      return r.insertId;
    });
    return { id, contrasenaTemporal: temporal };
  } catch (error) {
    if (esDuplicado(error)) throw new ErrorConflicto('Ya existe un usuario con ese correo');
    throw error;
  }
}

/** Cantidad de SUPER_ADMIN activos distintos de `excluirId`: nunca puede quedar el panel sin quien lo administre. */
async function otrosSuperAdminsActivos(ctx: Contexto, excluirId: number): Promise<number> {
  const fila = await una<{ n: number }>(ctx.pool, `SELECT COUNT(*) AS n FROM usuarios_plataforma WHERE rol = 'SUPER_ADMIN' AND activo = 1 AND id <> ?`, [excluirId]);
  return Number(fila?.n ?? 0);
}

export async function actualizarUsuario(
  ctx: Contexto,
  actor: UsuarioPlataforma,
  id: number,
  cambios: { nombre?: string; rol?: RolPlataforma; activo?: boolean },
  origen: Origen
): Promise<void> {
  const actual = await una<{ nombre: string; correo: string; rol: RolPlataforma; activo: number }>(ctx.pool, 'SELECT nombre, correo, rol, activo FROM usuarios_plataforma WHERE id = ?', [id]);
  if (!actual) throw new ErrorNoEncontrado('Usuario no encontrado');

  if (cambios.activo === false && id === actor.id) throw new ErrorConflicto('Usted no puede desactivar su propia cuenta');
  const dejaDeSerSuperAdminActivo =
    actual.rol === 'SUPER_ADMIN' && actual.activo === 1 && (cambios.activo === false || (cambios.rol !== undefined && cambios.rol !== 'SUPER_ADMIN'));
  if (dejaDeSerSuperAdminActivo && (await otrosSuperAdminsActivos(ctx, id)) === 0) {
    throw new ErrorConflicto('Debe quedar al menos un super administrador activo');
  }

  const sets: string[] = [];
  const valores: unknown[] = [];
  const detalle: string[] = [];
  if (cambios.nombre !== undefined) {
    sets.push('nombre = ?');
    valores.push(normalizarCampo('texto', cambios.nombre));
    detalle.push('nombre');
  }
  if (cambios.rol !== undefined && cambios.rol !== actual.rol) {
    sets.push('rol = ?');
    valores.push(cambios.rol);
    detalle.push(`rol ${actual.rol} → ${cambios.rol}`);
  }
  if (cambios.activo !== undefined && (cambios.activo ? 1 : 0) !== actual.activo) {
    sets.push('activo = ?');
    valores.push(cambios.activo ? 1 : 0);
    detalle.push(cambios.activo ? 'activado' : 'desactivado');
  }
  if (sets.length === 0) return;
  await transaccion(ctx.pool, async (con) => {
    await ejecutar(con, `UPDATE usuarios_plataforma SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
    await registrarAuditoria(con, { usuarioId: actor.id, accion: 'usuario_editado', descripcion: `Editó a ${actual.correo}: ${detalle.join(', ')}`, ...origen });
  });
}

/** Genera una contraseña temporal nueva (se muestra una sola vez). */
export async function restablecerContrasenaDeUsuario(ctx: Contexto, actor: UsuarioPlataforma, id: number, origen: Origen): Promise<string> {
  const usuario = await una<{ correo: string }>(ctx.pool, 'SELECT correo FROM usuarios_plataforma WHERE id = ?', [id]);
  if (!usuario) throw new ErrorNoEncontrado('Usuario no encontrado');
  const temporal = contrasenaTemporal();
  const hash = await hashearContrasena(temporal);
  await transaccion(ctx.pool, async (con) => {
    await ejecutar(con, 'UPDATE usuarios_plataforma SET contrasena_hash = ? WHERE id = ?', [hash, id]);
    await ejecutar(con, 'UPDATE tokens_recuperacion SET usado_en = UTC_TIMESTAMP() WHERE usuario_plataforma_id = ? AND usado_en IS NULL', [id]);
    await registrarAuditoria(con, { usuarioId: actor.id, accion: 'contrasena_temporal', descripcion: `Generó una contraseña temporal para ${usuario.correo}`, ...origen });
  });
  return temporal;
}
