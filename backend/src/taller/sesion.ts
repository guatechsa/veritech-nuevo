import { NextFunction, Request, RequestHandler, Response } from 'express';
import { filas, una } from '../db/consulta';
import { ErrorApp } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { huellaDe } from '../utils/tokens';
import { SesionDeTaller } from './contexto';

const NO_AUTENTICADO = new ErrorApp(401, 'NO_AUTENTICADO', 'Su sesión no es válida o venció. Ingrese de nuevo.');

function tokenDe(req: Request): string | null {
  const h = req.headers['authorization'];
  if (typeof h !== 'string' || !h.startsWith('Bearer ')) return null;
  const t = h.slice(7).trim();
  return /^[a-f0-9]{64}$/.test(t) ? t : null;
}

/**
 * Identifica a la persona por su sesión (una fila en la base del TALLER: un token de otro taller no existe aquí, así que
 * jamás sirve). Cada petición revisa de nuevo que la sesión siga vigente y que la persona siga activa: desactivar a alguien
 * o revocar su sesión surte efecto en la siguiente llamada.
 */
export function autenticarTaller(ctx: Contexto): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    const taller = req.taller;
    if (!taller) throw new ErrorApp(500, 'SIN_TALLER', 'No se resolvió el taller');
    const token = tokenDe(req);
    if (!token) throw NO_AUTENTICADO;
    const ahora = ahoraDe(ctx);
    const s = await una<{ sesion_id: number; usuario_id: number; colaborador_id: number; nombre: string; correo: string | null; es_soporte: number }>(
      taller.pool,
      `SELECT s.id AS sesion_id, u.id AS usuario_id, c.id AS colaborador_id, c.nombre_completo AS nombre, c.correo, s.es_soporte
         FROM sesiones s
         JOIN usuarios u ON u.id = s.usuario_id AND u.activo = 1
         JOIN colaboradores c ON c.id = u.colaborador_id AND c.activo = 1
        WHERE s.huella_token = ? AND s.revocada_en IS NULL AND s.vence_en > ?`,
      [huellaDe(token), ahora]
    );
    if (!s) throw NO_AUTENTICADO;
    const roles = await filas<{ id: number; codigo: string; nombre: string }>(
      taller.pool,
      `SELECT r.id, r.codigo, r.nombre FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id AND r.activo = 1 WHERE ur.usuario_id = ? ORDER BY r.id`,
      [s.usuario_id]
    );
    const permisos = await filas<{ codigo: string; modulo: string }>(
      taller.pool,
      `SELECT DISTINCT p.codigo, p.modulo
         FROM usuario_roles ur
         JOIN roles r ON r.id = ur.rol_id AND r.activo = 1
         JOIN rol_permisos rp ON rp.rol_id = ur.rol_id
         JOIN permisos p ON p.codigo = rp.permiso_codigo
        WHERE ur.usuario_id = ?`,
      [s.usuario_id]
    );
    // Un permiso solo cuenta si el módulo que lo contiene está habilitado para la empresa (plan y casillas del panel).
    const vigentes = permisos.filter((p) => p.modulo === 'base' || taller.empresa.modulos.has(p.modulo)).map((p) => p.codigo);
    const sesion: SesionDeTaller = {
      sesionId: s.sesion_id,
      usuarioId: s.usuario_id,
      colaboradorId: s.colaborador_id,
      nombre: s.nombre,
      correo: s.correo,
      roles,
      permisos: new Set(vigentes),
      esSoporte: s.es_soporte === 1,
    };
    req.sesionTaller = sesion;
    next();
  };
}

/** Exige TODOS los permisos indicados. Lo que no está concedido está prohibido (falla cerrada). */
export function exigirPermiso(...codigos: string[]): RequestHandler {
  return (req, _res, next) => {
    const sesion = req.sesionTaller;
    if (!sesion) throw NO_AUTENTICADO;
    const falta = codigos.filter((c) => !sesion.permisos.has(c));
    if (falta.length > 0) throw new ErrorApp(403, 'SIN_PERMISO', 'Su rol no tiene permiso para hacer esto.');
    next();
  };
}

/** Rutas que sí se permiten cuando la cuenta está en "solo exportar" (cerrar sesión y descargar datos). */
const PERMITIDAS_EN_SOLO_EXPORTAR = [/^\/auth\/cerrar$/, /^\/exportar(\/|$)/, /^\/auth\/yo$/];

/** Una cuenta en "solo exportar" solo puede mirar y descargar: cualquier cambio se rechaza. */
export function bloquearCambiosSiSoloExportar(): RequestHandler {
  return (req, _res, next) => {
    if (req.taller?.empresa.estado === 'solo_exportar' && req.method !== 'GET' && req.method !== 'HEAD') {
      if (!PERMITIDAS_EN_SOLO_EXPORTAR.some((r) => r.test(req.path))) {
        throw new ErrorApp(403, 'SOLO_EXPORTAR', 'La cuenta terminó su servicio: solo puede consultar y descargar sus datos. Reactive la suscripción para volver a trabajar.');
      }
    }
    next();
  };
}
