import jwt from 'jsonwebtoken';
import { RequestHandler } from 'express';
import { ejecutar, una, transaccion } from '../db/consulta';
import { ErrorApp, ErrorValidacion } from '../errores';
import { botonCorreo, plantillaCorreo } from '../correos/plantilla';
import { encolarCorreo } from '../correos/cola';
import { escaparHtml } from '../utils/html';
import { hashDeRelleno, hashearContrasena, reglasIncumplidas, verificarContrasena } from '../utils/clave';
import { crearToken, huellaDe } from '../utils/tokens';
import { registrarAuditoria } from './auditoria';
import { Contexto, RolPlataforma, UsuarioPlataforma } from './contexto';

const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos';
const EMISOR = 'veritech';
const MINUTOS_RECUPERACION = 30;

interface Origen {
  ip: string;
  userAgent: string;
}

function publico(f: { id: number; nombre: string; correo: string; rol: RolPlataforma }): UsuarioPlataforma {
  return { id: f.id, nombre: f.nombre, correo: f.correo, rol: f.rol };
}

export function firmarSesion(ctx: Contexto, usuario: UsuarioPlataforma): string {
  return jwt.sign({ rol: usuario.rol, ambito: 'plataforma' }, ctx.entorno.JWT_SECRETO, {
    algorithm: 'HS256',
    expiresIn: '8h',
    issuer: EMISOR,
    subject: String(usuario.id),
  });
}

export function exigirContrasenaValida(contrasena: string): void {
  const faltan = reglasIncumplidas(contrasena);
  if (faltan.length > 0) {
    throw new ErrorValidacion(`La contraseña no cumple: ${faltan.join('; ')}.`);
  }
}

export async function ingresar(ctx: Contexto, datos: Origen & { correo: string; contrasena: string }) {
  const correo = datos.correo.trim();
  const fila = await una<{ id: number; nombre: string; correo: string; contrasena_hash: string; rol: RolPlataforma; activo: number }>(
    ctx.pool,
    'SELECT id, nombre, correo, contrasena_hash, rol, activo FROM usuarios_plataforma WHERE correo = ?',
    [correo]
  );
  // Se verifica SIEMPRE contra un hash (el real o uno de relleno): el tiempo de respuesta no delata si el correo existe.
  const coincide = await verificarContrasena(datos.contrasena, fila?.contrasena_hash ?? (await hashDeRelleno()));
  if (!fila || !coincide || fila.activo !== 1) {
    await registrarAuditoria(ctx.pool, {
      usuarioId: fila?.id ?? null,
      accion: 'login_fallido',
      descripcion: `Intento de ingreso fallido (${correo.slice(0, 120)})`,
      ip: datos.ip,
      userAgent: datos.userAgent,
    });
    throw new ErrorApp(401, 'CREDENCIALES', MENSAJE_CREDENCIALES);
  }
  await ejecutar(ctx.pool, 'UPDATE usuarios_plataforma SET ultimo_ingreso = UTC_TIMESTAMP() WHERE id = ?', [fila.id]);
  await registrarAuditoria(ctx.pool, { usuarioId: fila.id, accion: 'login_ok', descripcion: 'Ingreso al panel', ip: datos.ip, userAgent: datos.userAgent });
  const usuario = publico(fila);
  return { token: firmarSesion(ctx, usuario), usuario };
}

/** Middleware: exige una sesión válida y que el usuario siga activo (desactivar a alguien corta su sesión al instante). */
export function autenticar(ctx: Contexto): RequestHandler {
  return async (req, _res, next) => {
    const cabecera = req.headers.authorization;
    if (!cabecera?.startsWith('Bearer ')) throw new ErrorApp(401, 'SIN_SESION', 'Debe iniciar sesión');
    let carga: jwt.JwtPayload;
    try {
      const decodificado = jwt.verify(cabecera.slice(7), ctx.entorno.JWT_SECRETO, { algorithms: ['HS256'], issuer: EMISOR });
      if (typeof decodificado === 'string') throw new Error('formato');
      carga = decodificado;
    } catch {
      throw new ErrorApp(401, 'SESION_INVALIDA', 'Su sesión venció. Ingrese de nuevo.');
    }
    if (carga['ambito'] !== 'plataforma' || !carga.sub) throw new ErrorApp(401, 'SESION_INVALIDA', 'Su sesión venció. Ingrese de nuevo.');
    const fila = await una<{ id: number; nombre: string; correo: string; rol: RolPlataforma }>(
      ctx.pool,
      'SELECT id, nombre, correo, rol FROM usuarios_plataforma WHERE id = ? AND activo = 1',
      [Number(carga.sub)]
    );
    if (!fila) throw new ErrorApp(401, 'SESION_INVALIDA', 'Su sesión venció. Ingrese de nuevo.');
    req.usuarioPlataforma = publico(fila);
    next();
  };
}

export function exigirRol(...roles: RolPlataforma[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.usuarioPlataforma || !roles.includes(req.usuarioPlataforma.rol)) {
      throw new ErrorApp(403, 'SIN_PERMISO', 'No tiene permiso para esta acción');
    }
    next();
  };
}

export async function cambiarContrasena(ctx: Contexto, usuarioId: number, actual: string, nueva: string, origen: Origen): Promise<void> {
  const fila = await una<{ contrasena_hash: string }>(ctx.pool, 'SELECT contrasena_hash FROM usuarios_plataforma WHERE id = ? AND activo = 1', [usuarioId]);
  if (!fila || !(await verificarContrasena(actual, fila.contrasena_hash))) {
    throw new ErrorApp(400, 'CONTRASENA_ACTUAL', 'La contraseña actual no es correcta');
  }
  exigirContrasenaValida(nueva);
  const hash = await hashearContrasena(nueva);
  await transaccion(ctx.pool, async (con) => {
    await ejecutar(con, 'UPDATE usuarios_plataforma SET contrasena_hash = ? WHERE id = ?', [hash, usuarioId]);
    await ejecutar(con, 'UPDATE tokens_recuperacion SET usado_en = UTC_TIMESTAMP() WHERE usuario_plataforma_id = ? AND usado_en IS NULL', [usuarioId]);
    await registrarAuditoria(con, { usuarioId, accion: 'cambio_contrasena', descripcion: 'Cambió su contraseña', ...origen });
  });
}

/**
 * Recuperar contraseña (estándar: respuesta SIEMPRE genérica, token de un solo uso de 30 minutos guardado como huella,
 * y pedir uno nuevo invalida los anteriores).
 */
export async function solicitarRecuperacion(ctx: Contexto, correoEscrito: string, origen: Origen): Promise<void> {
  const correo = correoEscrito.trim();
  const usuario = await una<{ id: number; nombre: string; correo: string }>(
    ctx.pool,
    'SELECT id, nombre, correo FROM usuarios_plataforma WHERE correo = ? AND activo = 1',
    [correo]
  );
  if (!usuario) return;
  const { token, huella } = crearToken();
  await transaccion(ctx.pool, async (con) => {
    await ejecutar(con, 'UPDATE tokens_recuperacion SET usado_en = UTC_TIMESTAMP() WHERE usuario_plataforma_id = ? AND usado_en IS NULL', [usuario.id]);
    await ejecutar(
      con,
      'INSERT INTO tokens_recuperacion (usuario_plataforma_id, huella, vence_en) VALUES (?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE))',
      [usuario.id, huella, MINUTOS_RECUPERACION]
    );
    const enlace = `${ctx.entorno.URL_PANEL.replace(/\/$/, '')}/restablecer?token=${token}`;
    await encolarCorreo(con, {
      tipo: 'recuperacion_contrasena_plataforma',
      destinatarios: [usuario.correo],
      asunto: 'Recupere su contraseña — VERI-TECH Admin',
      cuerpoHtml: plantillaCorreo(
        `<p>Hola, <strong>${escaparHtml(usuario.nombre)}</strong>.</p>
         <p>Recibimos una solicitud para restablecer la contraseña de su cuenta del panel de administración.</p>
         ${botonCorreo('Restablecer contraseña', enlace)}
         <p>Este enlace vence en ${MINUTOS_RECUPERACION} minutos y solo se puede usar una vez. Si usted no lo solicitó, ignore este correo.</p>`
      ),
    });
    await registrarAuditoria(con, { usuarioId: usuario.id, accion: 'recuperacion_solicitada', descripcion: 'Solicitó recuperar su contraseña', ...origen });
  });
}

export async function restablecerContrasena(ctx: Contexto, token: string, nueva: string, origen: Origen): Promise<void> {
  exigirContrasenaValida(nueva);
  const hash = await hashearContrasena(nueva);
  await transaccion(ctx.pool, async (con) => {
    const fila = await una<{ id: number; usuario_plataforma_id: number }>(
      con,
      'SELECT id, usuario_plataforma_id FROM tokens_recuperacion WHERE huella = ? AND usado_en IS NULL AND vence_en > UTC_TIMESTAMP() FOR UPDATE',
      [huellaDe(token)]
    );
    if (!fila) throw new ErrorApp(400, 'TOKEN_INVALIDO', 'El enlace no es válido o ya venció. Pida uno nuevo.');
    const actualizado = await ejecutar(con, 'UPDATE usuarios_plataforma SET contrasena_hash = ? WHERE id = ? AND activo = 1', [hash, fila.usuario_plataforma_id]);
    if (actualizado.affectedRows !== 1) throw new ErrorApp(400, 'TOKEN_INVALIDO', 'El enlace no es válido o ya venció. Pida uno nuevo.');
    await ejecutar(con, 'UPDATE tokens_recuperacion SET usado_en = UTC_TIMESTAMP() WHERE id = ?', [fila.id]);
    await registrarAuditoria(con, { usuarioId: fila.usuario_plataforma_id, accion: 'contrasena_restablecida', descripcion: 'Restableció su contraseña con el enlace del correo', ...origen });
  });
}
