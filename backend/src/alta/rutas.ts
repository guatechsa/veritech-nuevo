import { Request, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { procesarAviso, recibirAviso } from '../cobro/aviso';
import { ErrorValidacion } from '../errores';
import { Contexto, ipDe } from '../plataforma/contexto';
import { exigirTurnstile } from '../utils/turnstile';
import { aprovisionarAlta } from './aprovisionar';
import { solicitarAccesos } from './entrar';
import { confirmarAlta, estadoAlta, iniciarAlta, listarPlanesPublicos, slugDisponible, VERSION_LEGAL_VIGENTE } from './registro';

function validar<T extends z.ZodType>(esquema: T, datos: unknown): z.infer<T> {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) {
    const incidencia = resultado.error.issues[0];
    throw new ErrorValidacion(`El dato «${incidencia?.path.join('.') || 'solicitud'}» falta o no es válido`);
  }
  return resultado.data;
}

function limitador(limite: number, minutos: number) {
  return rateLimit({
    windowMs: minutos * 60 * 1000,
    limit: limite,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, codigo: 'DEMASIADOS_INTENTOS', error: 'Demasiados intentos. Intente de nuevo más tarde.' });
    },
  });
}

declare module 'express-serve-static-core' {
  interface Request {
    rawBody?: string;
  }
}

/**
 * Rutas públicas (sin sesión): registro en dos pasos, "Entrar" por correo y avisos de PayPal. Todas las que aceptan datos
 * de personas llevan límite de peticiones y, si está configurado, la casilla anti-robots.
 */
export function crearRutasPublicas(ctx: Contexto): Router {
  const router = Router();
  const tope = ctx.limites?.registro ?? 20;
  const turnstile = exigirTurnstile(ctx.entorno.TURNSTILE_SECRET);

  router.get('/registro/planes', async (_req, res) => {
    res.json({ success: true, data: { version_legal: VERSION_LEGAL_VIGENTE, planes: await listarPlanesPublicos(ctx) } });
  });

  /** Lo que el navegador necesita para mostrar el botón de PayPal (el identificador de cliente es público por diseño). */
  router.get('/registro/config', (_req, res) => {
    res.json({
      success: true,
      data: { paypal: ctx.pagos && ctx.entorno.PAYPAL_CLIENT_ID ? { client_id: ctx.entorno.PAYPAL_CLIENT_ID, modo: ctx.entorno.PAYPAL_MODO } : null, dominio: ctx.entorno.DOMINIO_TALLERES },
    });
  });

  router.post('/registro/disponibilidad', limitador(tope * 3, 15), async (req, res) => {
    const datos = validar(z.object({ slug: z.string().trim().max(60) }), req.body);
    res.json({ success: true, data: { disponible: await slugDisponible(ctx, datos.slug) } });
  });

  router.post('/registro/iniciar', limitador(tope, 60), turnstile, async (req, res) => {
    const datos = validar(
      z.object({
        nombre_taller: z.string().trim().min(3).max(150),
        slug: z.string().trim().max(60),
        admin_nombre: z.string().trim().min(2).max(120),
        admin_correo: z.string().trim().email().max(150),
        contrasena: z.string().min(1).max(200),
        plan_codigo: z.string().trim().min(1).max(30),
        version_legal: z.string().trim().max(10),
        acepta_terminos: z.boolean(),
      }),
      req.body
    );
    res.status(201).json({ success: true, data: await iniciarAlta(ctx, datos, { ip: ipDe(req) }) });
  });

  router.post('/registro/confirmar', limitador(tope * 2, 60), async (req, res) => {
    const datos = validar(z.object({ pase: z.string().length(64), suscripcion_id: z.string().trim().min(3).max(64) }), req.body);
    const estado = await confirmarAlta(ctx, { pase: datos.pase, suscripcionId: datos.suscripcion_id });
    res.json({ success: true, data: { estado: estado.estado } });
    // El taller se crea en segundo plano; el navegador consulta /registro/estado. Si algo falla, el barrido lo reintenta.
    if (estado.estado === 'creando' && estado.altaId !== undefined) {
      const altaId = estado.altaId;
      if (ctx.lanzarAlta) ctx.lanzarAlta(altaId);
      else {
        setImmediate(() => {
          aprovisionarAlta(ctx, altaId).catch((error: unknown) => console.error('[alta] no se pudo crear el taller del alta', altaId, error));
        });
      }
    }
  });

  router.get('/registro/estado', limitador(tope * 30, 15), async (req, res) => {
    const datos = validar(z.object({ pase: z.string().length(64) }), req.query);
    res.json({ success: true, data: await estadoAlta(ctx, datos.pase) });
  });

  // "Entrar": siempre la misma respuesta, exista o no el correo.
  router.post('/entrar/solicitar', limitador(tope, 60), turnstile, async (req, res) => {
    const datos = validar(z.object({ correo: z.string().trim().email().max(150) }), req.body);
    await solicitarAccesos(ctx, datos.correo).catch((error: unknown) => console.error('[entrar] no se pudo encolar el correo', error));
    res.json({ success: true, data: { mensaje: 'Si el correo está registrado, le enviamos sus accesos.' } });
  });

  // Aviso de PayPal: la firma se verifica sobre el cuerpo EXACTO que llegó (por eso se guarda crudo en `rawBody`).
  router.post('/webhooks/paypal', async (req: Request, res) => {
    const resultado = await recibirAviso(ctx, { headers: req.headers, cuerpoCrudo: req.rawBody ?? '' });
    res.json({ success: true, data: { resultado: resultado.resultado } });
    if (resultado.eventoId !== undefined) {
      const eventoId = resultado.eventoId;
      setImmediate(() => {
        procesarAviso(ctx, eventoId).catch((error: unknown) => console.error('[cobro] aviso sin procesar; lo reintentará el barrido', eventoId, error));
      });
    }
  });

  return router;
}
