import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { actorDe, idDe, validar } from './comun';
import {
  actualizarCotizacion,
  actualizarLineaCotizacion,
  agregarAOrden,
  agregarHallazgos,
  agregarLineaCotizacion,
  anularCotizacion,
  crearCotizacion,
  crearDesdeChecklist,
  enviarCotizacion,
  ESTADOS_COTIZACION,
  listarCotizaciones,
  nuevaVersion,
  obtenerCotizacion,
  opcionesDeCotizacion,
  quitarHallazgo,
  quitarLineaCotizacion,
  responderLinea,
  Vista,
} from './cotizaciones';
import { crearEnlaceCotizacion, listarEnlacesCotizacion, revocarEnlacesCotizacion } from './enlaces';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const nulo = (max: number) => texto(max).nullable().optional();
const idPositivo = z.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const booleanoDeConsulta = z.enum(['true', 'false']).optional();

const vistaDe = (req: Request): Vista => ({ costos: req.sesionTaller!.permisos.has('ordenes.ver_costos') });

/** Cotizaciones (módulo «cotizaciones»): documento único con líneas que el cliente autoriza o rechaza una por una. */
export function montarRutasCotizaciones(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('cotizaciones.ver');
  const cotizar = exigirPermiso('cotizaciones.crear');
  const detalle = async (req: Request, id: number) => obtenerCotizacion(ctx, taller(req), id, vistaDe(req));

  router.get('/cotizaciones-opciones', ver, async (req, res) => {
    res.json({ success: true, data: await opcionesDeCotizacion(taller(req)) });
  });
  router.get('/cotizaciones', ver, async (req, res) => {
    const f = validar(
      z.object({
        estado: z.enum(ESTADOS_COTIZACION).optional(),
        abiertas: booleanoDeConsulta,
        orden_id: z.coerce.number().int().positive().optional(),
        equipo_id: z.coerce.number().int().positive().optional(),
        cliente_id: z.coerce.number().int().positive().optional(),
        buscar: texto(100).optional(),
        pagina: z.coerce.number().int().min(1).default(1),
      }),
      req.query
    );
    res.json({ success: true, data: await listarCotizaciones(ctx, taller(req), { ...f, abiertas: f.abiertas === 'true', porPagina: 50 }) });
  });
  router.get('/cotizaciones/:id', ver, async (req, res) => {
    res.json({ success: true, data: await detalle(req, idDe(req)) });
  });
  router.post('/cotizaciones', cotizar, async (req, res) => {
    const d = validar(z.object({ orden_id: idPositivo.nullable().optional(), equipo_id: idPositivo.nullable().optional(), cliente_id: idPositivo.nullable().optional(), notas: nulo(500) }), req.body);
    const r = await crearCotizacion(taller(req), actorDe(req), d);
    res.status(201).json({ success: true, data: await detalle(req, r.id) });
  });
  router.post('/cotizaciones/desde-checklist', cotizar, async (req, res) => {
    const d = validar(z.object({ checklist_id: idPositivo }), req.body);
    const r = await crearDesdeChecklist(taller(req), actorDe(req), d.checklist_id);
    res.status(201).json({ success: true, data: await detalle(req, r.id) });
  });
  router.patch('/cotizaciones/:id', cotizar, async (req, res) => {
    const d = validar(z.object({ notas: nulo(500), vence_en: fecha.nullable().optional() }), req.body);
    await actualizarCotizacion(ctx, taller(req), actorDe(req), idDe(req), d);
    res.json({ success: true, data: await detalle(req, idDe(req)) });
  });
  router.post('/cotizaciones/:id/hallazgos', cotizar, async (req, res) => {
    const d = validar(z.object({ respuesta_ids: z.array(idPositivo).min(1).max(50) }), req.body);
    await agregarHallazgos(taller(req), actorDe(req), idDe(req), d.respuesta_ids);
    res.json({ success: true, data: await detalle(req, idDe(req)) });
  });
  router.delete('/cotizaciones/:id/hallazgos/:respuestaId', cotizar, async (req, res) => {
    await quitarHallazgo(taller(req), actorDe(req), idDe(req), idDe(req, 'respuestaId'));
    res.json({ success: true, data: await detalle(req, idDe(req)) });
  });
  router.post('/cotizaciones/:id/lineas', cotizar, async (req, res) => {
    const d = validar(
      z.object({
        tipo: z.enum(['servicio', 'material', 'tercero']),
        respuesta_id: idPositivo.nullable().optional(),
        trabajo_id: idPositivo.optional(),
        material_id: idPositivo.optional(),
        proveedor_id: idPositivo.optional(),
        descripcion: texto(250).optional(),
        cantidad: z.number().positive().max(1_000_000).optional(),
        precio_unitario: z.number().min(0).max(99_999_999).optional(),
        costo: z.number().min(0).max(99_999_999).optional(),
        horas: z.number().positive().max(999).optional(),
        area_trabajo_id: idPositivo.nullable().optional(),
      }),
      req.body
    );
    await agregarLineaCotizacion(taller(req), actorDe(req), idDe(req), d);
    res.status(201).json({ success: true, data: await detalle(req, idDe(req)) });
  });
  router.patch('/cotizacion-lineas/:id', cotizar, async (req, res) => {
    const d = validar(
      z.object({ horas: z.number().positive().max(999).optional(), area_trabajo_id: idPositivo.nullable().optional(), cantidad: z.number().positive().max(1_000_000).optional(), precio_unitario: z.number().min(0).max(99_999_999).optional(), costo: z.number().min(0).max(99_999_999).optional(), descripcion: texto(250).optional() }),
      req.body
    );
    const cotId = await actualizarLineaCotizacion(taller(req), actorDe(req), idDe(req), d);
    res.json({ success: true, data: await detalle(req, cotId) });
  });
  router.delete('/cotizacion-lineas/:id', cotizar, async (req, res) => {
    const cotId = await quitarLineaCotizacion(taller(req), actorDe(req), idDe(req));
    res.json({ success: true, data: await detalle(req, cotId) });
  });
  router.post('/cotizaciones/:id/enviar', cotizar, async (req, res) => {
    const d = validar(z.object({ vence_en: fecha.nullable().optional() }), req.body ?? {});
    await enviarCotizacion(ctx, taller(req), actorDe(req), idDe(req), d);
    res.json({ success: true, data: await detalle(req, idDe(req)) });
  });
  router.post('/cotizaciones/:id/nueva-version', cotizar, async (req, res) => {
    const r = await nuevaVersion(ctx, taller(req), actorDe(req), idDe(req));
    res.status(201).json({ success: true, data: await detalle(req, r.id) });
  });
  router.post('/cotizaciones/:id/anular', cotizar, async (req, res) => {
    const d = validar(z.object({ motivo: texto(300).min(3) }), req.body);
    await anularCotizacion(ctx, taller(req), actorDe(req), idDe(req), d.motivo);
    res.json({ success: true, data: await detalle(req, idDe(req)) });
  });
  router.post('/cotizacion-lineas/:id/responder', exigirPermiso('cotizaciones.responder'), async (req, res) => {
    const d = validar(z.object({ decision: z.enum(['autorizada', 'rechazada']), motivo_id: idPositivo.nullable().optional(), motivo_texto: nulo(300) }), req.body);
    const cotId = await responderLinea(ctx, taller(req), actorDe(req), idDe(req), { ...d, dispositivo: req.get('user-agent') ?? null, ip: req.ip ?? null });
    res.json({ success: true, data: await detalle(req, cotId) });
  });
  router.post('/cotizaciones/:id/enlace', cotizar, async (req, res) => {
    const r = await crearEnlaceCotizacion(ctx, taller(req), actorDe(req), idDe(req));
    res.status(201).json({ success: true, data: r });
  });
  router.post('/cotizaciones/:id/enlace/revocar', cotizar, async (req, res) => {
    res.json({ success: true, data: { revocados: await revocarEnlacesCotizacion(ctx, taller(req), actorDe(req), idDe(req)) } });
  });
  router.get('/cotizaciones/:id/enlaces', ver, async (req, res) => {
    res.json({ success: true, data: await listarEnlacesCotizacion(ctx, taller(req), idDe(req)) });
  });
  router.post('/cotizaciones/:id/agregar-a-orden', cotizar, exigirPermiso('ordenes.editar'), async (req, res) => {
    const d = validar(z.object({ orden_id: idPositivo.nullable().optional() }), req.body ?? {});
    await agregarAOrden(ctx, taller(req), actorDe(req), idDe(req), d);
    res.json({ success: true, data: await detalle(req, idDe(req)) });
  });
}
