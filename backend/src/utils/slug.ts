import { ErrorValidacion } from '../errores';

/** Nombre del taller en la dirección: 3 a 30 letras minúsculas, números y guiones sueltos (no al inicio, al final ni dobles). */
const FORMATO = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function limpiarSlug(valor: string): string {
  return valor.trim().toLowerCase();
}

/** Devuelve el motivo si el nombre NO sirve, o `null` si el formato es correcto (no mira si está ocupado). */
export function motivoSlugInvalido(slug: string): string | null {
  if (slug.length < 3 || slug.length > 30) return 'debe tener entre 3 y 30 caracteres';
  if (!FORMATO.test(slug)) return 'solo puede llevar letras minúsculas sin tilde, números y guiones sueltos';
  if (/^\d+$/.test(slug)) return 'no puede ser solo números';
  return null;
}

export function exigirSlugValido(slug: string): string {
  const limpio = limpiarSlug(slug);
  const motivo = motivoSlugInvalido(limpio);
  if (motivo) throw new ErrorValidacion(`El nombre en la dirección ${motivo}`);
  return limpio;
}

/** Nombre de la base del taller: el prefijo configurado + el nombre con guion bajo (los guiones no valen en nombres de base). */
export function nombreBdDeSlug(prefijo: string, slug: string): string {
  const nombre = `${prefijo}${slug.replace(/-/g, '_')}`;
  if (nombre.length > 64) throw new ErrorValidacion('El nombre del taller es demasiado largo para su base de datos');
  return nombre;
}

export function subdominioDe(slug: string, dominio: string): string {
  return `${slug}.${dominio}`;
}

export function urlDeTaller(subdominio: string): string {
  return `https://${subdominio}`;
}
