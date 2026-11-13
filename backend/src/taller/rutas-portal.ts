import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { z } from 'zod';
import { ErrorApp } from '../errores';
import { Contexto, ipDe } from '../plataforma/contexto';
import { verDocumentoPublico } from './enlaces-documentos';
import { verEquipoPublico } from './equipo-publico';
import { validar } from './comun';
import { cerrarSesionDePortal, cotizacionDelPortal, entrarAlPortal, equipoDelPortal, resumenDelPortal, responderCotizacionDelPortal, SesionPortal, sesionDePortal, solicitarCitaDelPortal, solicitarCodigo, validarCorreoDePortal } from './portal';

declare module 'express-serve-static-core' {
  interface Request {
    portal?: SesionPortal;
  }
}

const origenDe = (req: Request) => ({ ip: ipDe(req), agente: req.get('user-agent') ?? '' });

/**
 * Lo que el cliente ve SIN iniciar sesión en el taller (Fase 7d): los enlaces a la cuenta y al informe, el QR del equipo y el portal con código por correo.
 * Va ANTES de la exigencia de sesión del taller. Cada ruta lleva el freno de intentos por dirección de red.
 */
export function montarRutasPublicas(router: Router, ctx: Contexto, freno: RequestHandler, frenoCodigos: RequestHandler, turnstile: RequestHandler): void {
  const taller = (req: Request) => req.taller!;

  router.get('/publico/documento/:token', freno, async (req, res) => {
    res.json({ success: true, data: await verDocumentoPublico(ctx, taller(req), String(req.params['token']), origenDe(req)) });
  });
  router.get('/publico/equipo/:codigo', freno, async (req, res) => {
    res.json({ success: true, data: await verEquipoPublico(ctx, taller(req), String(req.params['codigo']), origenDe(req)) });
  });

  // ── Portal ────────────────────────────────────────────────────────────────────────
  router.post('/publico/portal/codigo', frenoCodigos, turnstile, async (req, res) => {
    const d = validar(z.object({ correo: z.string().max(150) }), req.body);
    await solicitarCodigo(ctx, taller(req), validarCorreoDePortal(d.correo), origenDe(req));
    res.json({ success: true, data: { mensaje: 'Si ese correo es de una persona de contacto de este taller, le enviamos un código. Vale 15 minutos.' } });
  });
  router.post('/publico/portal/entrar', frenoCodigos, async (req, res) => {
    const d = validar(z.object({ correo: z.string().max(150), codigo: z.string().trim().regex(/^\d{6}$/, 'El código son 6 números') }), req.body);
    res.json({ success: true, data: await entrarAlPortal(ctx, taller(req), validarCorreoDePortal(d.correo), d.codigo, origenDe(req)) });
  });

  const requierePortal = async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const autorizacion = req.get('authorization') ?? '';
      const token = autorizacion.startsWith('Bearer ') ? autorizacion.slice(7).trim() : '';
      const s = await sesionDePortal(ctx, taller(req), token);
      if (!s) throw new ErrorApp(401, 'PORTAL_SIN_SESION', 'Su sesión venció. Vuelva a entrar con su correo.');
      req.portal = s;
      next();
    } catch (error) {
      next(error);
    }
  };

  router.get('/portal/resumen', freno, requierePortal, async (req, res) => {
    res.json({ success: true, data: await resumenDelPortal(ctx, taller(req), req.portal!) });
  });
  router.get('/portal/equipos/:id', freno, requierePortal, async (req, res) => {
    res.json({ success: true, data: await equipoDelPortal(ctx, taller(req), req.portal!, Number(req.params['id']), origenDe(req)) });
  });
  router.get('/portal/cotizaciones/:id', freno, requierePortal, async (req, res) => {
    res.json({ success: true, data: await cotizacionDelPortal(ctx, taller(req), req.portal!, Number(req.params['id']), origenDe(req)) });
  });
  router.post('/portal/cotizaciones/:id/responder', freno, requierePortal, async (req, res) => {
    const d = validar(
      z.object({
        respuestas: z.array(z.object({ linea_id: z.number().int().positive(), decision: z.enum(['autorizada', 'rechazada']), motivo_id: z.number().int().positive().nullable().optional(), motivo_texto: z.string().trim().max(300).nullable().optional() })).min(1).max(100),
      }),
      req.body
    );
    res.json({ success: true, data: await responderCotizacionDelPortal(ctx, taller(req), req.portal!, Number(req.params['id']), origenDe(req), d.respuestas) });
  });
  router.post('/portal/citas', freno, requierePortal, async (req, res) => {
    const d = validar(
      z.object({
        equipo_id: z.number().int().positive(),
        fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        hora: z.string().regex(/^\d{2}:\d{2}$/),
        lectura_contador: z.number().min(0).max(99999999).nullable().optional(),
        notas: z.string().trim().max(300).nullable().optional(),
      }),
      req.body
    );
    res.status(201).json({ success: true, data: await solicitarCitaDelPortal(ctx, taller(req), req.portal!, d, origenDe(req)) });
  });
  router.post('/portal/cerrar', requierePortal, async (req, res) => {
    await cerrarSesionDePortal(ctx, taller(req), req.portal!);
    res.json({ success: true, data: { mensaje: 'Sesión cerrada.' } });
  });
}
