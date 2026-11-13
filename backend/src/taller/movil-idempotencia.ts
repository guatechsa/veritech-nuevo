import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ejecutar, una } from '../db/consulta';
import { ErrorApp } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';

/**
 * Cambios con identificador (Fase 8a). La app manda, en cada cambio que hizo sin señal, la cabecera `X-Id-Cliente` (un identificador único que crea
 * el teléfono) y, si quiere, `X-Hecho-En` (cuándo lo hizo, ISO). Si ese cambio ya se procesó, el servidor NO lo repite: devuelve la misma respuesta de la
 * primera vez (con `X-Repetida: 1`). Así reenviar por una señal mala nunca duplica una solicitud, una foto o un cambio de estado.
 *
 *  - Vale por persona: el mismo identificador de otra persona es otro cambio.
 *  - Se guarda también el rechazo (400, 409…): reenviar lo rechazado da el mismo rechazo.
 *  - Un error del servidor (5xx) no se guarda: se puede reintentar.
 *  - Si el primer intento sigue en proceso, el segundo recibe 409 «EN_PROCESO» (la app espera y vuelve a preguntar); uno abandonado hace más de 2 minutos se retoma.
 */
export const MINUTOS_PARA_RETOMAR = 2;
const FORMATO = /^[A-Za-z0-9_-]{8,64}$/;
const MAXIMO_RESPUESTA = 200_000;
const METODOS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

export function conIdentificador(ctx: Contexto): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = req.get('x-id-cliente');
      if (!id || !METODOS.has(req.method)) return next();
      if (!FORMATO.test(id)) throw new ErrorApp(400, 'ID_CLIENTE_INVALIDO', 'El identificador del cambio no es válido.');
      const t = req.taller!;
      const usuarioId = req.sesionTaller!.usuarioId;
      const ahora = ahoraDe(ctx);
      const hecho = req.get('x-hecho-en');
      const hechoEn = hecho && !Number.isNaN(Date.parse(hecho)) ? new Date(hecho) : null;

      const nuevo = await ejecutar(t.pool, 'INSERT IGNORE INTO mutaciones_procesadas (usuario_id, id_cliente, metodo, ruta, hecho_en, procesada_en) VALUES (?, ?, ?, ?, ?, ?)', [usuarioId, id, req.method, req.path.slice(0, 200), hechoEn, ahora]);
      if (nuevo.affectedRows === 0) {
        const previa = await una<{ estado: 'en_proceso' | 'terminada'; codigo_http: number | null; respuesta: string | null; procesada_en: Date }>(t.pool, 'SELECT estado, codigo_http, respuesta, procesada_en FROM mutaciones_procesadas WHERE usuario_id = ? AND id_cliente = ?', [usuarioId, id]);
        if (previa?.estado === 'terminada' && previa.codigo_http !== null) {
          res.setHeader('X-Repetida', '1');
          res.status(previa.codigo_http).json(previa.respuesta ? JSON.parse(previa.respuesta) : { success: true });
          return;
        }
        const abandonado = !previa || ahora.getTime() - previa.procesada_en.getTime() > MINUTOS_PARA_RETOMAR * 60000;
        if (!abandonado) throw new ErrorApp(409, 'EN_PROCESO', 'Ese cambio todavía se está procesando. Espere unos segundos.');
        // El primer intento nunca terminó (se cayó el servidor): se retoma.
        await ejecutar(t.pool, "UPDATE mutaciones_procesadas SET estado = 'en_proceso', procesada_en = ?, hecho_en = ? WHERE usuario_id = ? AND id_cliente = ?", [ahora, hechoEn, usuarioId, id]);
      }

      // La respuesta se guarda ANTES de mandarla: si la app reenvía enseguida, ya está lista.
      let guardado = false;
      const json = res.json.bind(res);
      res.json = (c?: unknown) => {
        guardado = true;
        const codigo = res.statusCode;
        const texto = JSON.stringify(c ?? { success: true });
        const guardar =
          codigo >= 500
            ? ejecutar(t.pool, 'DELETE FROM mutaciones_procesadas WHERE usuario_id = ? AND id_cliente = ?', [usuarioId, id])
            : ejecutar(t.pool, "UPDATE mutaciones_procesadas SET estado = 'terminada', codigo_http = ?, respuesta = ? WHERE usuario_id = ? AND id_cliente = ?", [codigo, texto.length > MAXIMO_RESPUESTA ? JSON.stringify({ success: true, resumida: true }) : texto, usuarioId, id]);
        guardar.catch((error: unknown) => console.error('[movil] no se pudo guardar el cambio', id, error instanceof Error ? error.message : error)).finally(() => json(c));
        return res;
      };
      // Una respuesta que no es JSON (un archivo) no se guarda: el cambio se puede volver a pedir.
      res.on('finish', () => {
        if (!guardado) void ejecutar(t.pool, 'DELETE FROM mutaciones_procesadas WHERE usuario_id = ? AND id_cliente = ?', [usuarioId, id]).catch(() => undefined);
      });
      next();
    } catch (error) {
      next(error);
    }
  };
}
