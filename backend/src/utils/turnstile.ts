import { RequestHandler } from 'express';
import { ErrorApp } from '../errores';

const URL_VERIFICACION = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Casilla anti-robots de Cloudflare para formularios públicos (recuperar contraseña, registro).
 * Sin TURNSTILE_SECRET no exige nada (así se puede subir el código antes de poner la llave). Si Cloudflare no responde,
 * deja pasar: un corte de Cloudflare no debe bloquear a clientes reales.
 */
export function exigirTurnstile(secreto: string | undefined): RequestHandler {
  return async (req, _res, next) => {
    if (!secreto) return next();
    const token: unknown = (req.body as { turnstileToken?: unknown } | undefined)?.turnstileToken;
    if (typeof token !== 'string' || token === '' || token.length > 2048) {
      throw new ErrorApp(400, 'TURNSTILE', 'No se pudo verificar que usted no es un robot. Recargue la página e intente de nuevo.');
    }
    try {
      const cuerpo = new URLSearchParams({ secret: secreto, response: token });
      if (req.ip) cuerpo.set('remoteip', req.ip);
      const respuesta = await fetch(URL_VERIFICACION, { method: 'POST', body: cuerpo, signal: AbortSignal.timeout(8000) });
      const datos = (await respuesta.json()) as { success?: boolean };
      if (datos.success !== true) {
        throw new ErrorApp(400, 'TURNSTILE', 'No se pudo verificar que usted no es un robot. Recargue la página e intente de nuevo.');
      }
    } catch (error) {
      if (error instanceof ErrorApp) throw error;
      console.warn('[turnstile] no se pudo consultar a Cloudflare, se deja pasar');
    }
    next();
  };
}
