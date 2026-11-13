import { botonCorreo, plantillaCorreo } from '../correos/plantilla';
import { encolarCorreo } from '../correos/cola';
import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorValidacion } from '../errores';
import { registrarAuditoria } from '../plataforma/auditoria';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { consumirTokenAcceso } from '../plataforma/soporte';
import { escaparHtml } from '../utils/html';
import { hashDeRelleno, hashearContrasena, reglasIncumplidas, verificarContrasena } from '../utils/clave';
import { urlBaseDeEmpresa } from '../utils/direccion';
import { crearToken, huellaDe } from '../utils/tokens';
import { EmpresaDePeticion, ESTADOS_QUE_TRABAJAN } from './contexto';
import { Pool } from 'mysql2/promise';

const MENSAJE_CREDENCIALES = 'Correo o contraseña incorrectos';
const HORAS_SESION = 8;
const HORAS_SESION_SOPORTE = 2;
const MINUTOS_RECUPERACION = 30;
const INTENTOS_ANTES_DE_BLOQUEAR = 5;
const MINUTOS_BLOQUEO = 15;

export type { OrigenTaller } from './comun';
import { OrigenTaller } from './comun';
import { leerConfiguracion } from './configuracion';

interface Taller {
  empresa: EmpresaDePeticion;
  pool: Pool;
}

function sumarMs(fecha: Date, ms: number): Date {
  return new Date(fecha.getTime() + ms);
}

/** La dirección base del taller (para los enlaces de los correos). En pruebas sin dirección propia, cuelga del sitio de pruebas. */
export function urlBaseDeTaller(ctx: Contexto, empresa: Pick<EmpresaDePeticion, 'slug' | 'subdominio'>): string {
  return urlBaseDeEmpresa(ctx.entorno, empresa);
}

async function bitacora(pool: Pool, usuarioId: number | null, accion: string, motivo: string | null, ip: string): Promise<void> {
  await ejecutar(pool, 'INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, motivo, ip) VALUES (?, ?, ?, ?, ?, ?)', [
    usuarioId,
    accion,
    'usuarios',
    usuarioId,
    motivo,
    ip,
  ]);
}

async function abrirSesion(ctx: Contexto, t: Taller, usuarioId: number, origen: OrigenTaller, esSoporte: boolean): Promise<{ token: string; venceEn: Date }> {
  const { token, huella } = crearToken();
  const ahora = ahoraDe(ctx);
  const venceEn = sumarMs(ahora, (esSoporte ? HORAS_SESION_SOPORTE : HORAS_SESION) * 3600 * 1000);
  await ejecutar(t.pool, 'INSERT INTO sesiones (usuario_id, huella_token, dispositivo, ip, vence_en, es_soporte, ultimo_uso) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    usuarioId,
    huella,
    origen.dispositivo.slice(0, 255),
    origen.ip,
    venceEn,
    esSoporte ? 1 : 0,
    ahora,
  ]);
  return { token, venceEn };
}

/**
 * Ingreso al taller. Siempre el mismo mensaje si el correo no existe, la contraseña está mal, el usuario está desactivado
 * o está bloqueado: no se revela nada. Tras 5 fallos seguidos la cuenta se bloquea 15 minutos (aun con la clave correcta).
 */
export async function ingresar(ctx: Contexto, t: Taller, datos: OrigenTaller & { correo: string; contrasena: string }) {
  if (t.empresa.estado === 'suspendida') {
    throw new ErrorApp(403, 'CUENTA_SUSPENDIDA', 'La cuenta de este taller está suspendida. Escriba a soporte@guatech.lat para recuperarla.');
  }
  if (!ESTADOS_QUE_TRABAJAN.includes(t.empresa.estado) && t.empresa.estado !== 'solo_exportar') {
    throw new ErrorApp(404, 'TALLER_NO_ENCONTRADO', 'No encontramos ese taller.');
  }
  const ahora = ahoraDe(ctx);
  const correo = datos.correo.trim();
  const f = await una<{ id: number; contrasena_hash: string; activo: number; colaborador_activo: number; intentos_fallidos: number; bloqueado_hasta: Date | null }>(
    t.pool,
    `SELECT u.id, u.contrasena_hash, u.activo, c.activo AS colaborador_activo, u.intentos_fallidos, u.bloqueado_hasta
       FROM colaboradores c JOIN usuarios u ON u.colaborador_id = c.id WHERE c.correo = ?`,
    [correo]
  );
  // Se verifica SIEMPRE contra un hash (el real o uno de relleno): el tiempo no delata si el correo existe.
  const coincide = await verificarContrasena(datos.contrasena, f?.contrasena_hash ?? (await hashDeRelleno()));
  const bloqueado = !!f?.bloqueado_hasta && f.bloqueado_hasta > ahora;
  if (!f || !coincide || f.activo !== 1 || f.colaborador_activo !== 1 || bloqueado) {
    if (f && !bloqueado) {
      const nuevos = f.intentos_fallidos + 1;
      const bloquear = nuevos >= INTENTOS_ANTES_DE_BLOQUEAR;
      await ejecutar(t.pool, 'UPDATE usuarios SET intentos_fallidos = ?, bloqueado_hasta = ? WHERE id = ?', [bloquear ? 0 : nuevos, bloquear ? sumarMs(ahora, MINUTOS_BLOQUEO * 60 * 1000) : null, f.id]);
      await bitacora(t.pool, f.id, bloquear ? 'login_bloqueado' : 'login_fallido', bloquear ? `BLOQUEADO ${MINUTOS_BLOQUEO} MINUTOS` : null, datos.ip);
    }
    throw new ErrorApp(401, 'CREDENCIALES', MENSAJE_CREDENCIALES);
  }
  await ejecutar(t.pool, 'UPDATE usuarios SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_ingreso = ? WHERE id = ?', [ahora, f.id]);
  const sesion = await abrirSesion(ctx, t, f.id, datos, false);
  await bitacora(t.pool, f.id, 'login_ok', null, datos.ip);
  return { token: sesion.token, vence_en: sesion.venceEn };
}

export async function cerrarSesion(ctx: Contexto, t: Taller, sesionId: number): Promise<void> {
  await ejecutar(t.pool, 'UPDATE sesiones SET revocada_en = ? WHERE id = ? AND revocada_en IS NULL', [ahoraDe(ctx), sesionId]);
}

export function exigirContrasenaValida(contrasena: string): void {
  const faltan = reglasIncumplidas(contrasena);
  if (faltan.length > 0) throw new ErrorValidacion(`La contraseña no cumple: ${faltan.join('; ')}.`);
}

/** Pide un enlace para restablecer la contraseña. Siempre la misma respuesta (quien llama no la distingue). */
export async function solicitarRecuperacion(ctx: Contexto, t: Taller, correoEscrito: string): Promise<void> {
  const correo = correoEscrito.trim();
  const f = await una<{ id: number; nombre: string }>(
    t.pool,
    'SELECT u.id, c.nombre_completo AS nombre FROM colaboradores c JOIN usuarios u ON u.colaborador_id = c.id WHERE c.correo = ? AND u.activo = 1 AND c.activo = 1',
    [correo]
  );
  if (!f) return;
  const ahora = ahoraDe(ctx);
  const { token, huella } = crearToken();
  await transaccion(t.pool, async (con) => {
    // Al pedir uno nuevo se invalidan los anteriores.
    await ejecutar(con, 'UPDATE tokens_recuperacion SET usado_en = ? WHERE usuario_id = ? AND usado_en IS NULL', [ahora, f.id]);
    await ejecutar(con, 'INSERT INTO tokens_recuperacion (usuario_id, huella, vence_en) VALUES (?, ?, ?)', [f.id, huella, sumarMs(ahora, MINUTOS_RECUPERACION * 60 * 1000)]);
  });
  const url = `${urlBaseDeTaller(ctx, t.empresa)}/restablecer?token=${token}`;
  const cuerpo = `<p>Estimado(a) ${escaparHtml(f.nombre)}:</p>
    <p>Recibimos una solicitud para restablecer su contraseña en <strong>${escaparHtml(t.empresa.nombre)}</strong>. El enlace sirve una sola vez y vence en ${MINUTOS_RECUPERACION} minutos.</p>
    ${botonCorreo('Restablecer mi contraseña', url)}
    <p>Si usted no lo solicitó, ignore este mensaje: su contraseña no cambia.</p>`;
  await encolarCorreo(ctx.pool, { tipo: 'recuperacion_taller', destinatarios: [correo], asunto: 'Restablezca su contraseña de VERI-TECH', cuerpoHtml: plantillaCorreo(cuerpo) });
}

export async function restablecerContrasena(ctx: Contexto, t: Taller, token: string, contrasena: string, origen: OrigenTaller): Promise<void> {
  exigirContrasenaValida(contrasena);
  const ahora = ahoraDe(ctx);
  const hash = await hashearContrasena(contrasena);
  await transaccion(t.pool, async (con) => {
    // El token se marca usado en la misma operación que lo valida: dos intentos a la vez no pasan los dos.
    const marca = await ejecutar(con, 'UPDATE tokens_recuperacion SET usado_en = ? WHERE huella = ? AND usado_en IS NULL AND vence_en > ?', [ahora, huellaDe(token), ahora]);
    if (marca.affectedRows !== 1) throw new ErrorApp(400, 'TOKEN_INVALIDO', 'El enlace no es válido o ya venció. Pida uno nuevo.');
    const fila = await una<{ usuario_id: number }>(con, 'SELECT usuario_id FROM tokens_recuperacion WHERE huella = ?', [huellaDe(token)]);
    if (!fila) throw new ErrorApp(400, 'TOKEN_INVALIDO', 'El enlace no es válido o ya venció. Pida uno nuevo.');
    await ejecutar(con, 'UPDATE usuarios SET contrasena_hash = ?, intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = ?', [hash, fila.usuario_id]);
    // Cambiar la contraseña cierra todas las sesiones abiertas.
    await ejecutar(con, 'UPDATE sesiones SET revocada_en = ? WHERE usuario_id = ? AND revocada_en IS NULL', [ahora, fila.usuario_id]);
    await ejecutar(con, "INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, motivo, ip) VALUES (?, 'contrasena_restablecida', 'usuarios', ?, 'ENLACE DE RECUPERACION', ?)", [fila.usuario_id, fila.usuario_id, origen.ip]);
  });
}

export async function cambiarContrasena(ctx: Contexto, t: Taller, usuarioId: number, sesionId: number, actual: string, nueva: string, origen: OrigenTaller): Promise<void> {
  exigirContrasenaValida(nueva);
  const f = await una<{ contrasena_hash: string }>(t.pool, 'SELECT contrasena_hash FROM usuarios WHERE id = ?', [usuarioId]);
  if (!f || !(await verificarContrasena(actual, f.contrasena_hash))) throw new ErrorApp(400, 'CONTRASENA_ACTUAL', 'La contraseña actual no es correcta.');
  const ahora = ahoraDe(ctx);
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'UPDATE usuarios SET contrasena_hash = ? WHERE id = ?', [await hashearContrasena(nueva), usuarioId]);
    // Las demás sesiones de la persona se cierran; la actual sigue.
    await ejecutar(con, 'UPDATE sesiones SET revocada_en = ? WHERE usuario_id = ? AND id <> ? AND revocada_en IS NULL', [ahora, usuarioId, sesionId]);
    await ejecutar(con, "INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, ip) VALUES (?, 'contrasena_cambiada', 'usuarios', ?, ?)", [usuarioId, usuarioId, origen.ip]);
  });
}

/** Canje del enlace "Entrar" de soporte: sesión de 2 horas, marcada como soporte, siempre auditada en las dos bases. */
export async function canjearAccesoSoporte(ctx: Contexto, t: Taller, token: string, origen: OrigenTaller) {
  const canje = await consumirTokenAcceso(ctx, token, origen.ip);
  const mismoTaller = canje.empresaId === t.empresa.id;
  const usuario = mismoTaller
    ? await una<{ id: number; nombre: string }>(
        t.pool,
        'SELECT u.id, c.nombre_completo AS nombre FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.id = ? AND u.activo = 1 AND c.activo = 1',
        [canje.usuarioDestinoId]
      )
    : null;
  if (!mismoTaller || !usuario) throw new ErrorApp(400, 'TOKEN_INVALIDO', 'El enlace de acceso no es válido o ya venció. Pida uno nuevo a soporte.');
  const sesion = await abrirSesion(ctx, t, usuario.id, origen, true);
  await bitacora(t.pool, usuario.id, 'acceso_soporte', 'SESION DE SOPORTE GUATECH', origen.ip);
  await registrarAuditoria(ctx.pool, {
    usuarioId: canje.creadoPor,
    accion: 'acceso_soporte_canjeado',
    empresaId: t.empresa.id,
    descripcion: `Se abrió una sesión de soporte en ${t.empresa.nombre} como ${usuario.nombre}`.slice(0, 500),
    ip: origen.ip,
  });
  return { token: sesion.token, vence_en: sesion.venceEn };
}

/** Quién es la persona y qué puede hacer: lo que la pantalla necesita para armar el menú y los avisos. */
export async function perfilDeSesion(t: Taller, sesion: { usuarioId: number; nombre: string; correo: string | null; roles: Array<{ id: number; codigo: string; nombre: string }>; permisos: Set<string>; esSoporte: boolean }) {
  const e = t.empresa;
  const sucursal = await filas<{ id: number; nombre: string }>(
    t.pool,
    'SELECT s.id, s.nombre FROM colaboradores c JOIN usuarios u ON u.colaborador_id = c.id JOIN sucursales s ON s.id = c.sucursal_id WHERE u.id = ?',
    [sesion.usuarioId]
  );
  const config = await leerConfiguracion(t);
  return {
    usuario: { id: sesion.usuarioId, nombre: sesion.nombre, correo: sesion.correo, roles: sesion.roles.map((r) => ({ codigo: r.codigo, nombre: r.nombre })), sucursal: sucursal[0] ?? null },
    permisos: [...sesion.permisos].sort(),
    modulos: [...e.modulos].sort(),
    soporte: sesion.esSoporte,
    empresa: { nombre: e.nombre, slug: e.slug, estado: e.estado, zona_horaria: e.zonaHoraria, moneda: config['moneda'] ?? 'GTQ', plan: e.planNombre, cobro_por_contrato: e.cobroPorContrato },
    avisos: {
      prueba_hasta: e.estado === 'prueba' ? e.pruebaHasta : null,
      gracia_hasta: e.estado === 'pago_fallido' ? e.graciaHasta : null,
      acceso_hasta: e.estado === 'cancelada_con_acceso' ? e.accesoHasta : null,
      exportable_hasta: e.estado === 'solo_exportar' ? e.exportableHasta : null,
    },
  };
}
