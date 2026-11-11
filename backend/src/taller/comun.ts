import { Request } from 'express';
import { Pool, PoolConnection } from 'mysql2/promise';
import { z } from 'zod';
import { Ejecutor, ejecutar, una } from '../db/consulta';
import { ErrorApp, ErrorValidacion } from '../errores';
import { agenteDe, ipDe } from '../plataforma/contexto';
import { EmpresaDePeticion, SesionDeTaller } from './contexto';

export interface TallerReq {
  empresa: EmpresaDePeticion;
  pool: Pool;
}

export interface Actor {
  usuarioId: number;
  esSoporte: boolean;
  ip: string;
}

export function actorDe(req: Request): Actor {
  const s = req.sesionTaller as SesionDeTaller;
  return { usuarioId: s.usuarioId, esSoporte: s.esSoporte, ip: ipDe(req) };
}

export interface OrigenTaller {
  ip: string;
  dispositivo: string;
}

export const origenDe = (req: Request): OrigenTaller => ({ ip: ipDe(req), dispositivo: agenteDe(req) });

export function validar<T extends z.ZodType>(esquema: T, datos: unknown): z.infer<T> {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) {
    const incidencia = resultado.error.issues[0];
    throw new ErrorValidacion(`El dato «${incidencia?.path.join('.') || 'solicitud'}» falta o no es válido`);
  }
  return resultado.data;
}

export function idDe(req: Request, nombre = 'id'): number {
  const id = Number(req.params[nombre]);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorValidacion('El identificador no es válido');
  return id;
}

/** Deja rastro de un cambio delicado (siempre con quién y desde dónde). `antes` y `despues` se guardan como texto. */
export async function bitacora(
  ejecutor: Ejecutor,
  actor: Actor | { usuarioId: number | null; ip?: string },
  evento: { accion: string; entidad: string; entidadId?: number | null; motivo?: string | null; antes?: unknown; despues?: unknown }
): Promise<void> {
  const texto = (v: unknown): string | null => (v === undefined || v === null ? null : JSON.stringify(v).slice(0, 60000));
  await ejecutar(ejecutor, 'INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, motivo, antes, despues, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
    actor.usuarioId,
    evento.accion.slice(0, 60),
    evento.entidad.slice(0, 60),
    evento.entidadId ?? null,
    evento.motivo?.slice(0, 300) ?? null,
    texto(evento.antes),
    texto(evento.despues),
    actor.ip ?? null,
  ]);
}

/** Siguiente número de una serie, entregado con bloqueo (nunca MAX()+1): dos personas a la vez nunca reciben el mismo. */
export async function siguienteNumero(con: PoolConnection, clave: string): Promise<number> {
  await ejecutar(con, 'INSERT INTO secuencias (clave, ultimo_valor) VALUES (?, LAST_INSERT_ID(1)) ON DUPLICATE KEY UPDATE ultimo_valor = LAST_INSERT_ID(ultimo_valor + 1)', [clave]);
  const fila = await una<{ n: number }>(con, 'SELECT LAST_INSERT_ID() AS n');
  return Number(fila?.n);
}

/** Traduce un choque de llave única a un 409 con el mensaje dado. */
export function conflictoSiDuplicado(error: unknown, mensaje: string): never {
  const codigo = (error as { code?: string }).code;
  if (codigo === 'ER_DUP_ENTRY') throw new ErrorApp(409, 'CONFLICTO', mensaje);
  if (codigo === 'ER_NO_REFERENCED_ROW_2') throw new ErrorValidacion('Uno de los datos elegidos ya no existe');
  throw error;
}
