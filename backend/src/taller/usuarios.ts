import crypto from 'node:crypto';
import { botonCorreo, plantillaCorreo } from '../correos/plantilla';
import { encolarCorreo } from '../correos/cola';
import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { escaparHtml } from '../utils/html';
import { hashearContrasena } from '../utils/clave';
import { crearToken } from '../utils/tokens';
import { urlBaseDeTaller } from './auth';
import { Actor, bitacora, TallerReq } from './comun';
import { exigirOtroAdministrador } from './colaboradores';
import { agregarAccesoEnDirectorio, desactivarAccesoEnDirectorio, reactivarAccesoEnDirectorio } from './directorio';

const HORAS_ENLACE_DE_ACCESO = 72;

/** El plan limita cuántos usuarios activos puede tener el taller (nulo = sin límite). */
async function exigirCupoDeUsuarios(t: TallerReq, con: Ejecutor): Promise<void> {
  const max = t.empresa.maxUsuarios;
  if (max === null) return;
  const f = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM usuarios WHERE activo = 1');
  if (Number(f?.n) >= max) throw new ErrorApp(409, 'LIMITE_DEL_PLAN', `Su plan permite ${max} usuarios activos. Para tener más, desactive a alguien o suba de plan.`);
}

async function validarRoles(con: Ejecutor, roles: number[]): Promise<void> {
  if (roles.length === 0) throw new ErrorValidacion('Elija al menos un rol');
  if (new Set(roles).size !== roles.length) throw new ErrorValidacion('Un rol está repetido');
  for (const r of roles) {
    if (!(await una(con, 'SELECT id FROM roles WHERE id = ? AND activo = 1', [r]))) throw new ErrorValidacion('Uno de los roles no existe o está desactivado');
  }
}

/**
 * Un rol que el actor no podría recibir por sí mismo no se puede dar: así nadie se escala privilegios asignando roles.
 * (El administrador tiene todos los permisos, así que puede dar cualquiera.)
 */
async function exigirQuePuedaOtorgar(con: Ejecutor, actorPermisos: Set<string>, roles: number[]): Promise<void> {
  for (const r of roles) {
    const permisos = await filas<{ permiso_codigo: string }>(con, 'SELECT permiso_codigo FROM rol_permisos WHERE rol_id = ?', [r]);
    const faltan = permisos.filter((p) => !actorPermisos.has(p.permiso_codigo));
    if (faltan.length > 0) throw new ErrorApp(403, 'SIN_PERMISO', 'No puede dar un rol con permisos que usted mismo no tiene.');
  }
}

async function emitirEnlace(ctx: Contexto, t: TallerReq, usuario: { id: number; nombre: string; correo: string }, tipo: 'invitacion' | 'restablecer'): Promise<void> {
  const ahora = ahoraDe(ctx);
  const { token, huella } = crearToken();
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'UPDATE tokens_recuperacion SET usado_en = ? WHERE usuario_id = ? AND usado_en IS NULL', [ahora, usuario.id]);
    await ejecutar(con, 'INSERT INTO tokens_recuperacion (usuario_id, huella, vence_en) VALUES (?, ?, ?)', [usuario.id, huella, new Date(ahora.getTime() + HORAS_ENLACE_DE_ACCESO * 3600 * 1000)]);
  });
  const url = `${urlBaseDeTaller(ctx, t.empresa)}/restablecer?token=${token}`;
  const nombre = escaparHtml(usuario.nombre);
  const taller = escaparHtml(t.empresa.nombre);
  const cuerpo =
    tipo === 'invitacion'
      ? `<p>Estimado(a) ${nombre}:</p><p>Se le dio acceso al sistema de <strong>${taller}</strong>. Cree su contraseña con el botón de abajo; el enlace sirve una sola vez y vence en ${HORAS_ENLACE_DE_ACCESO} horas.</p>${botonCorreo('Crear mi contraseña', url)}`
      : `<p>Estimado(a) ${nombre}:</p><p>Un administrador de <strong>${taller}</strong> le envió un enlace para que cree una contraseña nueva. Sirve una sola vez y vence en ${HORAS_ENLACE_DE_ACCESO} horas.</p>${botonCorreo('Crear mi contraseña', url)}<p>Si no lo esperaba, ignore este mensaje.</p>`;
  await encolarCorreo(ctx.pool, {
    tipo: tipo === 'invitacion' ? 'invitacion_taller' : 'enlace_taller',
    destinatarios: [usuario.correo],
    asunto: tipo === 'invitacion' ? `Su acceso a ${t.empresa.nombre}` : 'Cree su contraseña de VERI-TECH',
    cuerpoHtml: plantillaCorreo(cuerpo),
  });
}

/** Da acceso al sistema a un colaborador: nace sin contraseña y recibe por correo un enlace para crearla (nadie ve contraseñas ajenas). */
export async function darAcceso(ctx: Contexto, t: TallerReq, actor: Actor, actorPermisos: Set<string>, colaboradorId: number, roles: number[]) {
  const resultado = await transaccion(t.pool, async (con) => {
    const c = await una<{ nombre_completo: string; correo: string | null; activo: number }>(con, 'SELECT nombre_completo, correo, activo FROM colaboradores WHERE id = ? FOR UPDATE', [colaboradorId]);
    if (!c) throw new ErrorNoEncontrado('No se encontró al colaborador');
    if (c.activo !== 1) throw new ErrorApp(409, 'REGLA', 'El colaborador está desactivado: reactívelo antes de darle acceso.');
    if (!c.correo) throw new ErrorApp(409, 'REGLA', 'El colaborador necesita un correo para recibir su acceso.');
    if (await una(con, 'SELECT id FROM usuarios WHERE colaborador_id = ?', [colaboradorId])) throw new ErrorApp(409, 'CONFLICTO', 'Esta persona ya tiene acceso. Use «Activar» o «Reenviar enlace».');
    await validarRoles(con, roles);
    await exigirQuePuedaOtorgar(con, actorPermisos, roles);
    await exigirCupoDeUsuarios(t, con);
    // La contraseña inicial es un valor aleatorio que nadie conoce: la persona crea la suya con el enlace.
    const r = await ejecutar(con, 'INSERT INTO usuarios (colaborador_id, contrasena_hash) VALUES (?, ?)', [colaboradorId, await hashearContrasena(crypto.randomBytes(24).toString('base64'))]);
    for (const rol of roles) await ejecutar(con, 'INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)', [r.insertId, rol]);
    await bitacora(con, actor, { accion: 'acceso_creado', entidad: 'usuarios', entidadId: r.insertId, despues: { colaboradorId, roles } });
    return { usuarioId: r.insertId, nombre: c.nombre_completo, correo: c.correo };
  });
  await emitirEnlace(ctx, t, { id: resultado.usuarioId, nombre: resultado.nombre, correo: resultado.correo }, 'invitacion');
  await agregarAccesoEnDirectorio(ctx, t.empresa.id, resultado.correo, resultado.usuarioId);
  return { usuario_id: resultado.usuarioId, enlace_enviado_a: resultado.correo };
}

export async function actualizarUsuario(
  ctx: Contexto,
  t: TallerReq,
  actor: Actor,
  actorPermisos: Set<string>,
  usuarioId: number,
  d: { roles?: number[]; activo?: boolean }
) {
  const efectos = { directorio: null as 'activar' | 'desactivar' | null };
  await transaccion(t.pool, async (con) => {
    const u = await una<{ id: number; activo: number; colaborador_activo: number }>(
      con,
      'SELECT u.id, u.activo, c.activo AS colaborador_activo FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.id = ? FOR UPDATE',
      [usuarioId]
    );
    if (!u) throw new ErrorNoEncontrado('No se encontró al usuario');
    if (d.roles) {
      await validarRoles(con, d.roles);
      await exigirQuePuedaOtorgar(con, actorPermisos, d.roles);
      const eraAdmin = await una(con, "SELECT 1 AS x FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id WHERE ur.usuario_id = ? AND r.codigo = 'administrador'", [usuarioId]);
      const seraAdmin = await una(con, `SELECT 1 AS x FROM roles WHERE codigo = 'administrador' AND id IN (${d.roles.map(() => '?').join(',')})`, d.roles);
      if (eraAdmin && !seraAdmin) await exigirOtroAdministrador(con, usuarioId);
      await ejecutar(con, 'DELETE FROM usuario_roles WHERE usuario_id = ?', [usuarioId]);
      for (const rol of d.roles) await ejecutar(con, 'INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)', [usuarioId, rol]);
      await bitacora(con, actor, { accion: 'usuario_roles_editados', entidad: 'usuarios', entidadId: usuarioId, despues: d.roles });
    }
    if (d.activo !== undefined && (d.activo ? 1 : 0) !== u.activo) {
      if (!d.activo) {
        if (usuarioId === actor.usuarioId) throw new ErrorApp(409, 'REGLA', 'No puede quitarse el acceso a sí mismo.');
        await exigirOtroAdministrador(con, usuarioId);
        await ejecutar(con, 'UPDATE usuarios SET activo = 0 WHERE id = ?', [usuarioId]);
        await ejecutar(con, 'UPDATE sesiones SET revocada_en = ? WHERE usuario_id = ? AND revocada_en IS NULL', [ahoraDe(ctx), usuarioId]);
        efectos.directorio = 'desactivar';
      } else {
        if (u.colaborador_activo !== 1) throw new ErrorApp(409, 'REGLA', 'El colaborador está desactivado: reactívelo antes de darle acceso.');
        await exigirCupoDeUsuarios(t, con);
        await ejecutar(con, 'UPDATE usuarios SET activo = 1, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [usuarioId]);
        efectos.directorio = 'activar';
      }
      await bitacora(con, actor, { accion: d.activo ? 'usuario_activado' : 'usuario_desactivado', entidad: 'usuarios', entidadId: usuarioId });
    }
  });
  if (efectos.directorio === 'desactivar') await desactivarAccesoEnDirectorio(ctx, t.empresa.id, usuarioId);
  if (efectos.directorio === 'activar') await reactivarAccesoEnDirectorio(ctx, t.empresa.id, usuarioId);
}

/** Reenvía el enlace para crear contraseña (sirve tanto para una invitación perdida como para ayudar a quien olvidó la suya). */
export async function reenviarEnlace(ctx: Contexto, t: TallerReq, actor: Actor, usuarioId: number): Promise<{ enlace_enviado_a: string }> {
  const u = await una<{ id: number; nombre: string; correo: string | null; activo: number }>(
    t.pool,
    'SELECT u.id, c.nombre_completo AS nombre, c.correo, u.activo FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.id = ?',
    [usuarioId]
  );
  if (!u) throw new ErrorNoEncontrado('No se encontró al usuario');
  if (u.activo !== 1) throw new ErrorApp(409, 'REGLA', 'El usuario está desactivado: actívelo primero.');
  if (!u.correo) throw new ErrorApp(409, 'REGLA', 'El colaborador no tiene correo.');
  await emitirEnlace(ctx, t, { id: u.id, nombre: u.nombre, correo: u.correo }, 'restablecer');
  await bitacora(t.pool, actor, { accion: 'enlace_acceso_enviado', entidad: 'usuarios', entidadId: usuarioId });
  return { enlace_enviado_a: u.correo };
}

/** Cierra todas las sesiones abiertas de una persona (por ejemplo, si perdió el teléfono). */
export async function revocarSesiones(ctx: Contexto, t: TallerReq, actor: Actor, usuarioId: number): Promise<{ cerradas: number }> {
  if (!(await una(t.pool, 'SELECT id FROM usuarios WHERE id = ?', [usuarioId]))) throw new ErrorNoEncontrado('No se encontró al usuario');
  const r = await ejecutar(t.pool, 'UPDATE sesiones SET revocada_en = ? WHERE usuario_id = ? AND revocada_en IS NULL', [ahoraDe(ctx), usuarioId]);
  await bitacora(t.pool, actor, { accion: 'sesiones_revocadas', entidad: 'usuarios', entidadId: usuarioId, despues: { cerradas: r.affectedRows } });
  return { cerradas: r.affectedRows };
}
