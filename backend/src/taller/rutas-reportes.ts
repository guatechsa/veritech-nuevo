import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { actorDe, validar } from './comun';
import { definirMeta, indicadores, listarMetas, quitarMeta, rechazosDeCotizaciones } from './indicadores';
import { exigirPermiso } from './sesion';
import { configuracionDelTablero, definirTableroDeRol, obtenerTablero, restablecerTableroDeRol } from './tablero';

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const filtros = z.object({ desde: fecha, hasta: fecha, sucursal_id: z.coerce.number().int().positive().optional(), tipo_equipo_id: z.coerce.number().int().positive().optional() });

/** Indicadores con metas, rechazos de cotizaciones y tablero de inicio por rol (módulo «reportes»). */
export function montarRutasReportes(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const operativos = exigirPermiso('reportes.ver');
  const configurar = exigirPermiso('reportes.configurar');
  const conDinero = (req: Request): boolean => req.sesionTaller!.permisos.has('reportes.financieros');

  router.get('/tablero', async (req, res) => {
    res.json({ success: true, data: await obtenerTablero(ctx, taller(req), req.sesionTaller!) });
  });
  router.get('/indicadores', operativos, async (req, res) => {
    const f = validar(filtros, req.query);
    res.json({ success: true, data: await indicadores(ctx, taller(req), f, conDinero(req)) });
  });
  router.get('/indicadores/metas', operativos, async (req, res) => {
    res.json({ success: true, data: await listarMetas(taller(req)) });
  });
  router.put('/indicadores/metas/:codigo', configurar, async (req, res) => {
    const d = validar(z.object({ meta: z.number().min(0).max(100_000_000), limite: z.number().min(0).max(100_000_000).nullable().optional(), sentido: z.enum(['mayor', 'menor']).optional() }), req.body);
    res.json({ success: true, data: await definirMeta(taller(req), actorDe(req), String(req.params['codigo']), d) });
  });
  router.delete('/indicadores/metas/:codigo', configurar, async (req, res) => {
    res.json({ success: true, data: await quitarMeta(taller(req), actorDe(req), String(req.params['codigo'])) });
  });
  router.get('/reportes/rechazos', operativos, async (req, res) => {
    const f = validar(filtros, req.query);
    res.json({ success: true, data: await rechazosDeCotizaciones(ctx, taller(req), f, conDinero(req)) });
  });
  router.get('/tablero/config', configurar, async (req, res) => {
    res.json({ success: true, data: await configuracionDelTablero(taller(req)) });
  });
  router.put('/tablero/config/:rolId', configurar, async (req, res) => {
    const d = validar(z.object({ tarjetas: z.array(z.string().max(40)).max(30) }), req.body);
    res.json({ success: true, data: await definirTableroDeRol(taller(req), actorDe(req), Number(req.params['rolId']), d.tarjetas) });
  });
  router.delete('/tablero/config/:rolId', configurar, async (req, res) => {
    res.json({ success: true, data: await restablecerTableroDeRol(taller(req), actorDe(req), Number(req.params['rolId'])) });
  });
}
