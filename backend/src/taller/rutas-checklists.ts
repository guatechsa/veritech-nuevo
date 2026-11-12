import express, { Request, Router } from 'express';
import { z } from 'zod';
import { ErrorValidacion } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { MAXIMO_BYTES, nombreDeLaPeticion } from './archivos';
import {
  actualizarTipoChecklist,
  agregarFotoRespuesta,
  checklistsPendientes,
  completarChecklist,
  crearChecklist,
  crearTipoChecklist,
  definirRequisitos,
  guardarPlantilla,
  listarChecklistsDeEquipo,
  listarChecklistsDeOrden,
  listarRequisitos,
  listarTiposChecklist,
  obtenerChecklist,
  obtenerPlantilla,
  quitarFotoRespuesta,
  registrarFirma,
  responder,
  TIPOS_DE_RESPUESTA,
} from './checklists';
import { actorDe, idDe, validar } from './comun';
import { agenteDe } from '../plataforma/contexto';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const nulo = (max: number) => texto(max).nullable().optional();
const idPositivo = z.number().int().positive();

/** Checklists: tipos, plantillas versionadas, requisitos por tipo de orden, y llenado (módulo «ordenes»). */
export function montarRutasChecklists(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('checklists.ver');
  const llenar = exigirPermiso('checklists.llenar');
  const gestionar = exigirPermiso('checklists.gestionar');

  // ── Configuración ─────────────────────────────────────────────────────────────────
  router.get('/checklists-tipos', ver, async (req, res) => {
    res.json({ success: true, data: await listarTiposChecklist(taller(req), req.query['inactivos'] === 'true') });
  });
  const camposTipo = {
    descripcion: nulo(250),
    etapa_id: idPositivo.optional(),
    exige_lectura_contador: z.boolean().optional(),
    requiere_firma_cliente: z.boolean().optional(),
    tipos_equipo_ids: z.array(idPositivo).max(100).optional(),
  };
  router.post('/checklists-tipos', gestionar, async (req, res) => {
    const d = validar(z.object({ ...camposTipo, codigo: texto(20).min(2), nombre: texto(80).min(2), etapa_id: idPositivo }), req.body);
    res.status(201).json({ success: true, data: await crearTipoChecklist(taller(req), actorDe(req), d) });
  });
  router.patch('/checklists-tipos/:id', gestionar, async (req, res) => {
    const d = validar(z.object({ codigo: texto(20).optional(), nombre: texto(80).min(2).optional(), activo: z.boolean().optional(), ...camposTipo }), req.body);
    res.json({ success: true, data: await actualizarTipoChecklist(taller(req), actorDe(req), idDe(req), d) });
  });
  router.get('/checklists-tipos/:id/plantilla', ver, async (req, res) => {
    const v = validar(z.object({ version: z.coerce.number().int().positive().optional() }), req.query);
    res.json({ success: true, data: await obtenerPlantilla(taller(req), idDe(req), v.version) });
  });
  router.put('/checklists-tipos/:id/plantilla', gestionar, async (req, res) => {
    const item = z.object({ descripcion: texto(250).min(1), tipo_respuesta: z.enum(TIPOS_DE_RESPUESTA as [string, ...string[]]), unidad_id: idPositivo.nullable().optional(), minimo: z.number().nullable().optional(), maximo: z.number().nullable().optional(), opciones: z.array(texto(100)).max(30).optional() });
    const d = validar(z.object({ secciones: z.array(z.object({ nombre: texto(100).min(1), items: z.array(item).min(1).max(100) })).min(1).max(30) }), req.body);
    res.json({ success: true, data: await guardarPlantilla(taller(req), actorDe(req), idDe(req), d as Parameters<typeof guardarPlantilla>[3]) });
  });
  router.get('/checklists-requisitos', ver, async (req, res) => {
    res.json({ success: true, data: await listarRequisitos(taller(req)) });
  });
  router.put('/checklists-requisitos/:tipoOrdenId', gestionar, async (req, res) => {
    const d = validar(z.object({ requisitos: z.array(z.object({ checklist_tipo_id: idPositivo, momento: z.enum(['antes_de_iniciar', 'antes_de_terminar']), accion: z.enum(['bloquear', 'avisar']) })).max(40) }), req.body);
    res.json({ success: true, data: await definirRequisitos(taller(req), actorDe(req), idDe(req, 'tipoOrdenId'), d.requisitos) });
  });

  // ── Llenado ───────────────────────────────────────────────────────────────────────
  router.get('/ordenes/:id/checklists', ver, async (req, res) => {
    const c = await listarChecklistsDeOrden(taller(req), idDe(req));
    const faltan = { terminar: await checklistsPendientes(taller(req).pool, idDe(req), 'antes_de_terminar'), iniciar: await checklistsPendientes(taller(req).pool, idDe(req), 'antes_de_iniciar') };
    res.json({ success: true, data: { checklists: c, requeridos_pendientes: faltan } });
  });
  router.post('/ordenes/:id/checklists', llenar, async (req, res) => {
    const d = validar(z.object({ tipo_id: idPositivo }), req.body);
    res.status(201).json({ success: true, data: await crearChecklist(ctx, taller(req), actorDe(req), { tipo_id: d.tipo_id, orden_id: idDe(req) }) });
  });
  router.get('/equipos/:id/checklists', ver, async (req, res) => {
    res.json({ success: true, data: await listarChecklistsDeEquipo(taller(req), idDe(req)) });
  });
  /** Un checklist de operación (sin orden): por ejemplo, la revisión diaria del operador. */
  router.post('/checklists', llenar, async (req, res) => {
    const d = validar(z.object({ tipo_id: idPositivo, equipo_id: idPositivo }), req.body);
    res.status(201).json({ success: true, data: await crearChecklist(ctx, taller(req), actorDe(req), d) });
  });
  router.get('/checklists/:id', ver, async (req, res) => {
    res.json({ success: true, data: await obtenerChecklist(ctx, taller(req), idDe(req)) });
  });
  router.patch('/checklists/:id/respuestas/:respuestaId', llenar, async (req, res) => {
    const d = validar(
      z.object({ semaforo: z.enum(['verde', 'amarillo', 'rojo']).optional(), si_no: z.boolean().optional(), valor_numero: z.number().optional(), valor_texto: texto(500).optional(), opcion: texto(100).optional(), nota: nulo(300) }),
      req.body
    );
    await responder(ctx, taller(req), actorDe(req), idDe(req), idDe(req, 'respuestaId'), d);
    res.json({ success: true, data: await obtenerChecklist(ctx, taller(req), idDe(req)) });
  });
  const cuerpoFoto = express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAXIMO_BYTES });
  router.post('/checklists/:id/respuestas/:respuestaId/fotos', llenar, cuerpoFoto, async (req, res) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ErrorValidacion('Envíe una foto (JPG, PNG o WEBP)');
    const mime = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
    await agregarFotoRespuesta(ctx, taller(req), actorDe(req), idDe(req), idDe(req, 'respuestaId'), { buffer: req.body, mime, nombre: nombreDeLaPeticion(req) });
    res.status(201).json({ success: true, data: await obtenerChecklist(ctx, taller(req), idDe(req)) });
  });
  router.delete('/checklists/:id/fotos/:fotoId', llenar, async (req, res) => {
    await quitarFotoRespuesta(ctx, taller(req), idDe(req), idDe(req, 'fotoId'));
    res.json({ success: true, data: await obtenerChecklist(ctx, taller(req), idDe(req)) });
  });
  /** La firma llega dibujada como imagen PNG codificada en base64 (la pantalla la saca de un lienzo). */
  router.post('/checklists/:id/firma', llenar, async (req, res) => {
    const d = validar(z.object({ nombre: texto(120).min(3), imagen: z.string().max(900_000) }), req.body);
    const buffer = Buffer.from(d.imagen.replace(/^data:image\/png;base64,/, ''), 'base64');
    await registrarFirma(ctx, taller(req), actorDe(req), idDe(req), { nombre: d.nombre, buffer, dispositivo: agenteDe(req) });
    res.status(201).json({ success: true, data: await obtenerChecklist(ctx, taller(req), idDe(req)) });
  });
  router.post('/checklists/:id/completar', llenar, async (req, res) => {
    const d = validar(z.object({ lectura: z.object({ contador_id: idPositivo, valor: z.number().min(0).max(99999999) }).optional() }), req.body);
    await completarChecklist(ctx, taller(req), actorDe(req), idDe(req), d);
    res.json({ success: true, data: await obtenerChecklist(ctx, taller(req), idDe(req)) });
  });
}
