import express, { Request, Router } from 'express';
import { z } from 'zod';
import { ErrorValidacion } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { MAXIMO_BYTES, nombreDeLaPeticion } from './archivos';
import { actorDe, idDe, validar } from './comun';
import {
  actualizarLinea,
  actualizarOrden,
  agregarFotoLinea,
  agregarLinea,
  anularLinea,
  anularOrden,
  autorizarSobreLinea,
  cambiarEstadoLinea,
  cambiarEstadoOrden,
  crearOrden,
  definirTarifaArea,
  ESTADOS_DE_LINEA,
  listarOrdenes,
  listarTarifasArea,
  misTrabajos,
  obtenerOrden,
  opcionesDeOrden,
  quitarFotoLinea,
  quitarTarifaArea,
  Vista,
} from './ordenes';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const nulo = (max: number) => texto(max).nullable().optional();
const idPositivo = z.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const booleanoDeConsulta = z.enum(['true', 'false']).optional();

const vistaDe = (req: Request): Vista => ({ precios: req.sesionTaller!.permisos.has('ordenes.ver_precios'), costos: req.sesionTaller!.permisos.has('ordenes.ver_costos') });

/** Una respuesta de orden siempre se arma con lo que ESTA persona puede ver (sin permiso, ni precios ni costos salen del servidor). */
async function fichaPara(ctx: Contexto, req: Request, id: number) {
  return obtenerOrden(ctx, req.taller!, id, vistaDe(req));
}

/** Órdenes de trabajo, sus líneas y las tarifas por área (módulo «ordenes»). */
export function montarRutasOrdenes(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('ordenes.ver');
  const editar = exigirPermiso('ordenes.editar');

  const camposOrden = {
    prioridad: z.enum(['baja', 'media', 'alta', 'urgente']).optional(),
    descripcion: nulo(500),
    area_trabajo_id: idPositivo.nullable().optional(),
    responsable_id: idPositivo.nullable().optional(),
    fecha_estimada_entrega: fecha.nullable().optional(),
    referencia_factura_externa: nulo(40),
    notificar_nombre: nulo(120),
    notificar_correo: z.string().trim().email().max(150).nullable().optional(),
    notificar_telefono: nulo(40),
  };

  router.get('/ordenes-opciones', ver, async (req, res) => {
    res.json({ success: true, data: await opcionesDeOrden(taller(req)) });
  });

  router.get('/ordenes', ver, async (req, res) => {
    const f = validar(
      z.object({
        buscar: texto(100).optional(),
        estado_id: z.coerce.number().int().positive().optional(),
        tipo_orden_id: z.coerce.number().int().positive().optional(),
        cliente_id: z.coerce.number().int().positive().optional(),
        equipo_id: z.coerce.number().int().positive().optional(),
        abiertas: booleanoDeConsulta,
        pagina: z.coerce.number().int().min(1).default(1),
      }),
      req.query
    );
    res.json({ success: true, data: await listarOrdenes(taller(req), vistaDe(req), { ...f, abiertas: f.abiertas === undefined ? undefined : f.abiertas === 'true', porPagina: 50 }) });
  });

  router.get('/ordenes/:id', ver, async (req, res) => {
    res.json({ success: true, data: await fichaPara(ctx, req, idDe(req)) });
  });

  router.post('/ordenes', exigirPermiso('ordenes.crear'), async (req, res) => {
    const d = validar(
      z.object({
        equipo_id: idPositivo,
        tipo_orden_id: idPositivo.optional(),
        sucursal_id: idPositivo.optional(),
        lectura: z.object({ contador_id: idPositivo, valor: z.number().min(0).max(99999999) }).optional(),
        ...camposOrden,
      }),
      req.body
    );
    const r = await crearOrden(ctx, taller(req), actorDe(req), d);
    res.status(201).json({ success: true, data: { orden: await fichaPara(ctx, req, r.ordenId), avisos: r.avisos } });
  });

  router.patch('/ordenes/:id', editar, async (req, res) => {
    const d = validar(z.object(camposOrden), req.body);
    await actualizarOrden(ctx, taller(req), actorDe(req), idDe(req), d);
    res.json({ success: true, data: await fichaPara(ctx, req, idDe(req)) });
  });

  router.post('/ordenes/:id/estado', exigirPermiso('ordenes.cambiar_estado'), async (req, res) => {
    const d = validar(z.object({ estado_id: idPositivo, motivo: nulo(300), excepcion_motivo_id: idPositivo.optional() }), req.body);
    await cambiarEstadoOrden(ctx, taller(req), actorDe(req), idDe(req), d, req.sesionTaller!.permisos.has('ordenes.reabrir'), req.sesionTaller!.permisos.has('checklists.excepcion'));
    res.json({ success: true, data: await fichaPara(ctx, req, idDe(req)) });
  });

  router.post('/ordenes/:id/anular', exigirPermiso('ordenes.anular'), async (req, res) => {
    const d = validar(z.object({ motivo_id: idPositivo, texto: nulo(300) }), req.body);
    await anularOrden(ctx, taller(req), actorDe(req), idDe(req), d);
    res.json({ success: true, data: await fichaPara(ctx, req, idDe(req)) });
  });

  // ── Líneas ────────────────────────────────────────────────────────────────────────
  router.post('/ordenes/:id/lineas', editar, async (req, res) => {
    const d = validar(
      z.object({
        tipo: z.enum(['servicio', 'material', 'tercero']),
        trabajo_id: idPositivo.optional(),
        proveedor_id: idPositivo.optional(),
        descripcion: texto(250).optional(),
        cantidad: z.number().positive().max(100000).optional(),
        precio_unitario: z.number().min(0).max(99999999).optional(),
        costo: z.number().min(0).max(99999999).optional(),
        horas_trabajo: z.number().positive().max(999).optional(),
        area_trabajo_id: idPositivo.nullable().optional(),
        tecnico_id: idPositivo.nullable().optional(),
        notas: nulo(500),
      }),
      req.body
    );
    await agregarLinea(taller(req), actorDe(req), idDe(req), d);
    res.status(201).json({ success: true, data: await fichaPara(ctx, req, idDe(req)) });
  });

  router.patch('/lineas/:id', editar, async (req, res) => {
    const d = validar(
      z.object({
        notas: nulo(500),
        tecnico_id: idPositivo.nullable().optional(),
        area_trabajo_id: idPositivo.nullable().optional(),
        horas_trabajo: z.number().positive().max(999).optional(),
        descripcion: texto(250).optional(),
        cantidad: z.number().positive().max(100000).optional(),
        precio_unitario: z.number().min(0).max(99999999).optional(),
        costo: z.number().min(0).max(99999999).optional(),
      }),
      req.body
    );
    const o = await actualizarLinea(taller(req), actorDe(req), idDe(req), d);
    res.json({ success: true, data: await fichaPara(ctx, req, o) });
  });

  router.post('/lineas/:id/anular', editar, async (req, res) => {
    const d = validar(z.object({ motivo: texto(300).min(3) }), req.body);
    const o = await anularLinea(ctx, taller(req), actorDe(req), idDe(req), d.motivo);
    res.json({ success: true, data: await fichaPara(ctx, req, o) });
  });

  /** Iniciar, pausar, detener o terminar: quien edita órdenes en cualquier línea, el técnico solo en las suyas. */
  router.post('/lineas/:id/estado', ver, async (req, res) => {
    const d = validar(z.object({ estado: z.enum(ESTADOS_DE_LINEA) }), req.body);
    await autorizarSobreLinea(taller(req), req.sesionTaller!.usuarioId, req.sesionTaller!.permisos, idDe(req));
    const o = await cambiarEstadoLinea(ctx, taller(req), actorDe(req), idDe(req), d.estado);
    res.json({ success: true, data: await fichaPara(ctx, req, o) });
  });

  router.get('/mis-trabajos', exigirPermiso('ordenes.trabajar'), async (req, res) => {
    res.json({ success: true, data: await misTrabajos(ctx, taller(req), req.sesionTaller!.usuarioId) });
  });

  // Fotos del trabajo (el cuerpo es la foto tal cual; el nombre viaja en X-Nombre-Archivo)
  const cuerpoFoto = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAXIMO_BYTES });
  router.post('/lineas/:id/fotos', ver, cuerpoFoto, async (req, res) => {
    const q = validar(z.object({ tipo: z.enum(['antes', 'durante', 'despues']).default('durante'), descripcion: texto(150).optional() }), req.query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ErrorValidacion('Envíe una foto (JPG, PNG o WEBP)');
    await autorizarSobreLinea(taller(req), req.sesionTaller!.usuarioId, req.sesionTaller!.permisos, idDe(req));
    const mime = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    const o = await agregarFotoLinea(ctx, taller(req), actorDe(req), idDe(req), { buffer: req.body, mime, nombre: nombreDeLaPeticion(req), tipo: q.tipo, descripcion: q.descripcion });
    res.status(201).json({ success: true, data: await fichaPara(ctx, req, o) });
  });
  router.delete('/lineas/:id/fotos/:fotoId', ver, async (req, res) => {
    await autorizarSobreLinea(taller(req), req.sesionTaller!.usuarioId, req.sesionTaller!.permisos, idDe(req));
    const o = await quitarFotoLinea(ctx, taller(req), actorDe(req), idDe(req), idDe(req, 'fotoId'));
    res.json({ success: true, data: await fichaPara(ctx, req, o) });
  });

  // ── Tarifas por área y tipo de equipo ─────────────────────────────────────────────
  router.get('/tarifas-area', exigirPermiso('tarifas.gestionar'), async (req, res) => {
    res.json({ success: true, data: await listarTarifasArea(taller(req)) });
  });
  router.put('/tarifas-area/:areaId/:tipoId', exigirPermiso('tarifas.gestionar'), async (req, res) => {
    const d = validar(z.object({ tarifa_venta_hora: z.number().min(0).max(9999999), costo_hora: z.number().min(0).max(9999999) }), req.body);
    res.json({ success: true, data: await definirTarifaArea(taller(req), actorDe(req), idDe(req, 'areaId'), idDe(req, 'tipoId'), d) });
  });
  router.delete('/tarifas-area/:areaId/:tipoId', exigirPermiso('tarifas.gestionar'), async (req, res) => {
    res.json({ success: true, data: await quitarTarifaArea(taller(req), actorDe(req), idDe(req, 'areaId'), idDe(req, 'tipoId')) });
  });
}
