import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { agregarAplicabilidad, listarAplicabilidad, materialesSugeridos, quitarAplicabilidad } from './aplicabilidad';
import { actorDe, idDe, validar } from './comun';
import { ampliarReserva, alertasDeInventario, cancelarReserva, cargarReserva, crearReserva, ESTADOS_RESERVA, listarReservas, obtenerReserva } from './reservas';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const idPositivo = z.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const booleanoDeConsulta = z.enum(['true', 'false']).optional();

/** Reservas de material, aplicabilidad a equipos y alertas de inventario (módulo «inventario»). */
export function montarRutasReservas(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('reservas.ver');
  const tiene = (req: Request, permiso: string): boolean => req.sesionTaller!.permisos.has(permiso);

  router.get('/reservas', ver, async (req, res) => {
    const f = validar(
      z.object({
        estado: z.enum(ESTADOS_RESERVA).optional(),
        abiertas: booleanoDeConsulta,
        orden_id: z.coerce.number().int().positive().optional(),
        buscar: texto(100).optional(),
        pagina: z.coerce.number().int().min(1).default(1),
      }),
      req.query
    );
    res.json({ success: true, data: await listarReservas(ctx, taller(req), { ...f, abiertas: f.abiertas === 'true', porPagina: 50 }) });
  });
  router.get('/reservas/:id', ver, async (req, res) => {
    res.json({ success: true, data: await obtenerReserva(ctx, taller(req), idDe(req)) });
  });
  router.post('/reservas', exigirPermiso('reservas.crear'), async (req, res) => {
    const d = validar(z.object({ orden_id: idPositivo, vence_en: fecha, notas: texto(300).nullable().optional(), lineas: z.array(z.object({ material_id: idPositivo, cantidad: z.number().int().positive().max(1_000_000) })).min(1).max(50) }), req.body);
    const r = await crearReserva(ctx, taller(req), actorDe(req), d);
    res.status(201).json({ success: true, data: await obtenerReserva(ctx, taller(req), r.id) });
  });
  router.post('/reservas/:id/ampliar', ver, async (req, res) => {
    const d = validar(z.object({ vence_en: fecha, motivo: texto(300).min(3) }), req.body);
    await ampliarReserva(ctx, taller(req), actorDe(req), idDe(req), d, tiene(req, 'reservas.gestionar'));
    res.json({ success: true, data: await obtenerReserva(ctx, taller(req), idDe(req)) });
  });
  router.post('/reservas/:id/cancelar', ver, async (req, res) => {
    const d = validar(z.object({ motivo: texto(300).min(3) }), req.body);
    await cancelarReserva(ctx, taller(req), actorDe(req), idDe(req), d.motivo, tiene(req, 'reservas.gestionar'));
    res.json({ success: true, data: await obtenerReserva(ctx, taller(req), idDe(req)) });
  });
  router.post('/reservas/:id/cargar', exigirPermiso('solicitudes.despachar'), async (req, res) => {
    await cargarReserva(ctx, taller(req), actorDe(req), idDe(req));
    res.json({ success: true, data: await obtenerReserva(ctx, taller(req), idDe(req)) });
  });

  // ── Alertas ───────────────────────────────────────────────────────────────────────
  router.get('/inventario/alertas', exigirPermiso('inventario.ver'), async (req, res) => {
    res.json({ success: true, data: await alertasDeInventario(ctx, taller(req), tiene(req, 'reservas.ver'), tiene(req, 'solicitudes.ver')) });
  });

  // ── A qué equipos les sirve cada material ─────────────────────────────────────────
  router.get('/materiales/:id/aplica-a', exigirPermiso('inventario.ver'), async (req, res) => {
    res.json({ success: true, data: await listarAplicabilidad(taller(req), idDe(req)) });
  });
  router.post('/materiales/:id/aplica-a', exigirPermiso('inventario.catalogo'), async (req, res) => {
    const d = validar(z.object({ tipo_equipo_id: idPositivo, marca_id: idPositivo.nullable().optional(), modelo: texto(60).nullable().optional() }), req.body);
    await agregarAplicabilidad(taller(req), actorDe(req), idDe(req), d);
    res.status(201).json({ success: true, data: await listarAplicabilidad(taller(req), idDe(req)) });
  });
  router.delete('/materiales-aplica-a/:id', exigirPermiso('inventario.catalogo'), async (req, res) => {
    await quitarAplicabilidad(taller(req), actorDe(req), idDe(req));
    res.json({ success: true, data: { id: idDe(req) } });
  });
  router.get('/ordenes/:id/materiales-sugeridos', exigirPermiso('solicitudes.ver'), async (req, res) => {
    res.json({ success: true, data: await materialesSugeridos(taller(req), idDe(req)) });
  });
}
