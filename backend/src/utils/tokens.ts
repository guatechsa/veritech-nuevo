import crypto from 'node:crypto';

/** El token se entrega a la persona UNA vez; en la base solo se guarda su huella (SHA-256), nunca el token. */
export function crearToken(): { token: string; huella: string } {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, huella: huellaDe(token) };
}

export function huellaDe(token: string): string {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}
