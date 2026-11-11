import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (clave: crypto.BinaryLike, salt: crypto.BinaryLike, largo: number, opciones: crypto.ScryptOptions) => Promise<Buffer>;

/**
 * Contraseñas (estándar GUATECH, recuperación de contraseña §4): mínimo 10 caracteres con mayúscula, minúscula,
 * número y símbolo. Se guardan con scrypt (sin dependencias nativas), con sal propia y comparación en tiempo constante.
 */
export const REGLAS_CONTRASENA: Array<{ id: string; texto: string; cumple: (c: string) => boolean }> = [
  { id: 'largo', texto: 'Al menos 10 caracteres', cumple: (c) => c.length >= 10 },
  { id: 'mayuscula', texto: 'Una letra mayúscula', cumple: (c) => /[A-ZÁÉÍÓÚÑÜ]/.test(c) },
  { id: 'minuscula', texto: 'Una letra minúscula', cumple: (c) => /[a-záéíóúñü]/.test(c) },
  { id: 'numero', texto: 'Un número', cumple: (c) => /[0-9]/.test(c) },
  { id: 'simbolo', texto: 'Un símbolo (por ejemplo ! # $ % & *)', cumple: (c) => /[^A-Za-z0-9ÁÉÍÓÚÑÜáéíóúñü\s]/.test(c) },
];

/** Devuelve los textos de las reglas que NO se cumplen (vacío = la contraseña es válida). */
export function reglasIncumplidas(contrasena: string): string[] {
  return REGLAS_CONTRASENA.filter((r) => !r.cumple(contrasena)).map((r) => r.texto);
}

const N = 16384;
const R = 8;
const P = 1;
const LARGO = 64;

export async function hashearContrasena(contrasena: string): Promise<string> {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(contrasena.normalize('NFKC'), sal, LARGO, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${sal.toString('base64')}$${hash.toString('base64')}`;
}

export async function verificarContrasena(contrasena: string, almacenado: string): Promise<boolean> {
  const partes = almacenado.split('$');
  if (partes.length !== 6 || partes[0] !== 'scrypt') return false;
  const [, n, r, p, sal, hash] = partes as [string, string, string, string, string, string];
  const esperado = Buffer.from(hash, 'base64');
  const calculado = await scrypt(contrasena.normalize('NFKC'), Buffer.from(sal, 'base64'), esperado.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });
  return calculado.length === esperado.length && crypto.timingSafeEqual(calculado, esperado);
}

/** Hash de una contraseña inexistente: se verifica contra él cuando el usuario no existe, para que el tiempo no delate el correo. */
let hashFalso: Promise<string> | null = null;
export function hashDeRelleno(): Promise<string> {
  hashFalso ??= hashearContrasena('relleno-sin-uso-0!A');
  return hashFalso;
}

/** Contraseña temporal que cumple las reglas (se muestra una sola vez al crear una cuenta). */
export function contrasenaTemporal(): string {
  const alfabeto = 'abcdefghijkmnopqrstuvwxyz';
  const mayus = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const nums = '23456789';
  const simbolos = '!#$%&*+?';
  const elegir = (s: string, n: number): string => Array.from({ length: n }, () => s[crypto.randomInt(s.length)] as string).join('');
  const lista = (elegir(alfabeto, 5) + elegir(mayus, 3) + elegir(nums, 3) + elegir(simbolos, 2)).split('');
  for (let i = lista.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [lista[i], lista[j]] = [lista[j] as string, lista[i] as string];
  }
  return lista.join('');
}
