import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { actorDe, idDe, validar } from './comun';
import { Vista } from './inventario';
import { anularSolicitud, crearSolicitud, despachar, devolver, ESTADOS_SOLICITUD, listarSolicitudes, obtenerSolicitud } from './solicitudes';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const idPositivo = z.number().int().positive();
const entero = z.number().int();
const booleanoDeConsulta = z.enum(['true', 'false']).optional();

const vistaDe = (req: Request): Vista => ({ costos: req.sesionTaller!.permisos.has('inventario.ver_costos') });

/** Solicitudes de material, despachos y devoluciones (módulo «inventario»). */
export function montarRutasSolicitudes(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('solicitudes.ver');

  router.get('/solicitudes', ver, async (req, res) => {
    const f = validar(
      z.object({
        estado: z.enum(ESTADOS_SOLICITUD).optional(),
        pendientes: booleanoDeConsulta,
        orden_id: z.coerce.number().int().positive().optional(),
        buscar: texto(100).optional(),
        pagina: z.coerce.number().int().min(1).default(1),
      }),
      req.query
    );
    res.json({ success: true, data: await listarSolicitudes(taller(req), { ...f, pendientes: f.pendientes === 'true', porPagina: 50 }) });
  });
  router.get('/solicitudes/:id', ver, async (req, res) => {
    res.json({ success: true, data: await obtenerSolicitud(taller(req), idDe(req), vistaDe(req)) });
  });
  router.post('/solicitudes', exigirPermiso('solicitudes.crear'), async (req, res) => {
    const d = validar(z.object({ orden_id: idPositivo, notas: texto(300).nullable().optional(), lineas: z.array(z.object({ material_id: idPositivo, cantidad: entero.positive().max(1_000_000) })).min(1).max(50) }), req.body);
    const r = await crearSolicitud(ctx, taller(req), actorDe(req), d);
    res.status(201).json({ success: true, data: await obtenerSolicitud(taller(req), r.id, vistaDe(req)) });
  });
  router.post('/solicitudes/:id/despachar', exigirPermiso('solicitudes.despachar'), async (req, res) => {
    const d = validar(z.object({ items: z.array(z.object({ linea_id: idPositivo, bodega_id: idPositivo, cantidad: entero.positive().max(1_000_000) })).min(1).max(100) }), req.body);
    await despachar(ctx, taller(req), actorDe(req), idDe(req), d.items);
    res.json({ success: true, data: await obtenerSolicitud(taller(req), idDe(req), vistaDe(req)) });
  });
  router.post('/solicitudes/devoluciones', exigirPermiso('solicitudes.despachar'), async (req, res) => {
    const d = validar(z.object({ solicitud_linea_id: idPositivo, bodega_id: idPositivo, cantidad: entero.positive().max(1_000_000), motivo: texto(200).min(3) }), req.body);
    const r = await devolver(ctx, taller(req), actorDe(req), d);
    res.status(201).json({ success: true, data: await obtenerSolicitud(taller(req), r.solicitud_id, vistaDe(req)) });
  });
  router.post('/solicitudes/:id/anular', ver, async (req, res) => {
    const d = validar(z.object({ motivo: texto(300).min(3) }), req.body);
    await anularSolicitud(ctx, taller(req), actorDe(req), idDe(req), d.motivo, req.sesionTaller!.permisos.has('solicitudes.anular'));
    res.json({ success: true, data: await obtenerSolicitud(taller(req), idDe(req), vistaDe(req)) });
  });
}
