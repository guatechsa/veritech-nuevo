import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { actorDe, idDe, validar } from './comun';
import { emitirCotizacion, emitirCuenta, emitirInforme, listarDocumentos, obtenerDocumento } from './documentos';
import { exigirPermiso } from './sesion';

/** Documentos emitidos en PDF: cuenta de una orden, informe de un checklist y cotización (no son facturas). */
export function montarRutasDocumentos(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('documentos.ver');
  const emitir = exigirPermiso('documentos.emitir');
  const responder = async (req: Request, res: import('express').Response, r: { id: number; nuevo: boolean }) => {
    res.status(r.nuevo ? 201 : 200).json({ success: true, data: { ...(await obtenerDocumento(ctx, taller(req), r.id)), nuevo: r.nuevo } });
  };

  router.post('/ordenes/:id/cuenta', emitir, exigirPermiso('ordenes.ver_precios'), async (req, res) => {
    await responder(req, res, await emitirCuenta(ctx, taller(req), actorDe(req), idDe(req)));
  });
  router.post('/checklists/:id/informe', emitir, async (req, res) => {
    await responder(req, res, await emitirInforme(ctx, taller(req), actorDe(req), idDe(req)));
  });
  router.post('/cotizaciones/:id/documento', emitir, async (req, res) => {
    await responder(req, res, await emitirCotizacion(ctx, taller(req), actorDe(req), idDe(req)));
  });
  router.get('/documentos', ver, async (req, res) => {
    const f = validar(
      z.object({
        tipo: z.enum(['cuenta', 'informe', 'cotizacion']).optional(),
        orden_id: z.coerce.number().int().positive().optional(),
        checklist_id: z.coerce.number().int().positive().optional(),
        cotizacion_id: z.coerce.number().int().positive().optional(),
        todas: z.enum(['true', 'false']).optional(),
      }),
      req.query
    );
    res.json({ success: true, data: await listarDocumentos(ctx, taller(req), { ...f, todas: f.todas === 'true' }) });
  });
  router.get('/documentos/:id', ver, async (req, res) => {
    res.json({ success: true, data: await obtenerDocumento(ctx, taller(req), idDe(req)) });
  });
}
