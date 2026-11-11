import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Request } from 'express';
import { Ejecutor, ejecutar, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { Actor, TallerReq } from './comun';

/**
 * Archivos del taller (fotos, documentos, PDF). Cada uno se registra UNA vez en `archivos`; las demás tablas apuntan a él.
 *  - Se valida lo que de verdad es (los primeros bytes), no lo que dice su nombre ni lo que declara quien lo sube.
 *  - Quedan en una carpeta del servidor por taller, con un nombre al azar: nunca se publican directamente.
 *  - Se entregan con una dirección firmada que VENCE (por defecto una hora): una dirección copiada no sirve para siempre.
 */
export const MAXIMO_BYTES = 10 * 1024 * 1024;
export const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
const EXTENSION: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };
const SEGUNDOS_FIRMA = 3600;

export function carpetaBase(ctx: Contexto): string {
  return ctx.entorno.ARCHIVOS_DIR ?? path.join(process.cwd(), 'archivos');
}

/** ¿Los primeros bytes corresponden al tipo declarado? */
export function coincideConElTipo(buffer: Buffer, mime: string): boolean {
  if (mime === 'image/jpeg') return buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mime === 'image/png') return buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'image/webp') return buffer.length > 12 && buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP';
  if (mime === 'application/pdf') return buffer.length > 5 && buffer.subarray(0, 5).toString('latin1') === '%PDF-';
  return false;
}

function nombreLimpio(original: string): string {
  const base = original.replace(/[\\/]/g, '_').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 150);
  return base === '' ? 'archivo' : base;
}

/** Lee el nombre que manda el navegador (viene codificado en la cabecera X-Nombre-Archivo). */
export function nombreDeLaPeticion(req: Request): string {
  const crudo = req.headers['x-nombre-archivo'];
  const valor = Array.isArray(crudo) ? crudo[0] : crudo;
  if (!valor) return 'archivo';
  try {
    return decodeURIComponent(valor);
  } catch {
    return valor;
  }
}

export interface ArchivoGuardado {
  id: number;
  nombre_original: string;
  tipo_mime: string;
  tamano: number;
}

export async function guardarArchivo(ctx: Contexto, t: TallerReq, ejecutor: Ejecutor, actor: Actor | null, entrada: { buffer: Buffer; mime: string; nombre: string }): Promise<ArchivoGuardado> {
  if (!(TIPOS_PERMITIDOS as readonly string[]).includes(entrada.mime)) throw new ErrorValidacion('Solo se aceptan fotos (JPG, PNG, WEBP) y documentos PDF');
  if (entrada.buffer.length === 0) throw new ErrorValidacion('El archivo está vacío');
  if (entrada.buffer.length > MAXIMO_BYTES) throw new ErrorApp(413, 'DEMASIADO_GRANDE', 'El archivo pesa más de 10 MB');
  if (!coincideConElTipo(entrada.buffer, entrada.mime)) throw new ErrorValidacion('El contenido del archivo no corresponde a su tipo');

  const hash = crypto.createHash('sha256').update(entrada.buffer).digest('hex');
  const anio = String(ahoraDe(ctx).getUTCFullYear());
  const ruta = `${anio}/${crypto.randomBytes(12).toString('hex')}.${EXTENSION[entrada.mime]}`;
  const destino = path.join(carpetaBase(ctx), t.empresa.nombreBd, ruta);
  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, entrada.buffer, { flag: 'wx' });
  const nombre = nombreLimpio(entrada.nombre);
  try {
    const r = await ejecutar(ejecutor, 'INSERT INTO archivos (ruta, nombre_original, tipo_mime, tamano, hash, subido_por) VALUES (?, ?, ?, ?, ?, ?)', [ruta, nombre, entrada.mime, entrada.buffer.length, hash, actor?.usuarioId ?? null]);
    return { id: r.insertId, nombre_original: nombre, tipo_mime: entrada.mime, tamano: entrada.buffer.length };
  } catch (error) {
    await fs.rm(destino, { force: true });
    throw error;
  }
}

/** Borra un archivo del disco y del registro (para cuando la foto o el documento ya no se usa). */
export async function borrarArchivo(ctx: Contexto, t: TallerReq, ejecutor: Ejecutor, archivoId: number): Promise<void> {
  const a = await una<{ ruta: string }>(ejecutor, 'SELECT ruta FROM archivos WHERE id = ?', [archivoId]);
  if (!a) return;
  await ejecutar(ejecutor, 'DELETE FROM archivos WHERE id = ?', [archivoId]);
  await fs.rm(path.join(carpetaBase(ctx), t.empresa.nombreBd, a.ruta), { force: true });
}

// ── Direcciones firmadas ─────────────────────────────────────────────────────────────
function firma(ctx: Contexto, slug: string, id: number, vence: number): string {
  return crypto.createHmac('sha256', ctx.entorno.JWT_SECRETO).update(`archivo:${slug}:${id}:${vence}`).digest('hex');
}

export function urlFirmada(ctx: Contexto, slug: string, id: number): string {
  const vence = Math.floor(ahoraDe(ctx).getTime() / 1000) + SEGUNDOS_FIRMA;
  return `/api/archivos/${slug}/${id}?e=${vence}&f=${firma(ctx, slug, id, vence)}`;
}

export function firmaValida(ctx: Contexto, slug: string, id: number, vence: number, f: string): boolean {
  if (!Number.isFinite(vence) || vence < Math.floor(ahoraDe(ctx).getTime() / 1000)) return false;
  const esperada = Buffer.from(firma(ctx, slug, id, vence), 'hex');
  const recibida = /^[a-f0-9]{64}$/.test(f) ? Buffer.from(f, 'hex') : Buffer.alloc(0);
  return esperada.length === recibida.length && crypto.timingSafeEqual(esperada, recibida);
}

export async function abrirArchivo(ctx: Contexto, t: TallerReq, id: number): Promise<{ ruta: string; mime: string; nombre: string }> {
  const a = await una<{ ruta: string; tipo_mime: string; nombre_original: string }>(t.pool, 'SELECT ruta, tipo_mime, nombre_original FROM archivos WHERE id = ?', [id]);
  if (!a) throw new ErrorNoEncontrado('No se encontró el archivo');
  return { ruta: path.join(carpetaBase(ctx), t.empresa.nombreBd, a.ruta), mime: a.tipo_mime, nombre: a.nombre_original };
}
