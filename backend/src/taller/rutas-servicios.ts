import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { actorDe, idDe, validar } from './comun';
import { actualizarPrograma, anularRealizado, crearPrograma, estadoDeServicios, listarProgramas, registrarRealizado, revisarAvisos, serviciosDeEquipo } from './servicios';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const nulo = (max: number) => texto(max).nullable().optional();
const idPositivo = z.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const booleanoDeConsulta = z.enum(['true', 'false']).optional();

/** Servicios programados: configuración por tipo de equipo, estado de cada equipo y lo ya realizado (módulo «ordenes»). */
export function montarRutasServicios(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('servicios.ver');
  const gestionar = exigirPermiso('servicios.gestionar');
  const registrar = exigirPermiso('servicios.registrar');

  const camposPrograma = {
    nombre: texto(120).min(2).optional(),
    checklist_tipo_id: idPositivo.nullable().optional(),
    tipo: z.enum(['mantenimiento', 'revision_operativa']).optional(),
    intervalo: z.number().positive().max(10_000_000).optional(),
    aviso_proximo: z.number().min(0).max(10_000_000).optional(),
    aviso_urgente: z.number().min(0).max(10_000_000).optional(),
  };

  router.get('/servicios-programas', ver, async (req, res) => {
    const f = validar(z.object({ tipo_equipo_id: z.coerce.number().int().positive().optional(), inactivos: booleanoDeConsulta }), req.query);
    res.json({ success: true, data: await listarProgramas(taller(req), { tipo_equipo_id: f.tipo_equipo_id, inactivos: f.inactivos === 'true' }) });
  });
  router.post('/servicios-programas', gestionar, async (req, res) => {
    const d = validar(z.object({ ...camposPrograma, tipo_equipo_id: idPositivo, trabajo_id: idPositivo, tipo_contador_id: idPositivo, intervalo: z.number().positive().max(10_000_000) }), req.body);
    res.status(201).json({ success: true, data: await crearPrograma(taller(req), actorDe(req), d) });
  });
  router.patch('/servicios-programas/:id', gestionar, async (req, res) => {
    const d = validar(z.object({ ...camposPrograma, activo: z.boolean().optional(), tipo_equipo_id: idPositivo.optional(), trabajo_id: idPositivo.optional(), tipo_contador_id: idPositivo.optional() }), req.body);
    res.json({ success: true, data: await actualizarPrograma(taller(req), actorDe(req), idDe(req), d) });
  });

  router.get('/servicios', ver, async (req, res) => {
    const f = validar(
      z.object({
        estado: z.enum(['vencido', 'urgente', 'proximo', 'al_dia', 'sin_contador']).optional(),
        tipo_equipo_id: z.coerce.number().int().positive().optional(),
        equipo_id: z.coerce.number().int().positive().optional(),
        servicio_id: z.coerce.number().int().positive().optional(),
      }),
      req.query
    );
    res.json({ success: true, data: await estadoDeServicios(ctx, taller(req), f) });
  });
  router.get('/equipos/:id/servicios', ver, async (req, res) => {
    res.json({ success: true, data: await serviciosDeEquipo(ctx, taller(req), idDe(req)) });
  });

  router.post('/servicios/realizados', registrar, async (req, res) => {
    const d = validar(z.object({ equipo_id: idPositivo, servicio_id: idPositivo, fecha, contador_valor: z.number().min(-100000).max(99999999).optional(), origen: z.enum(['historico', 'excepcion']), motivo: nulo(300) }), req.body);
    res.status(201).json({ success: true, data: await registrarRealizado(ctx, taller(req), actorDe(req), d) });
  });
  router.post('/servicios/realizados/:id/anular', registrar, async (req, res) => {
    const d = validar(z.object({ motivo: texto(300).min(3) }), req.body);
    res.json({ success: true, data: await anularRealizado(ctx, taller(req), actorDe(req), idDe(req), d.motivo) });
  });
  router.post('/servicios/revisar-avisos', gestionar, async (req, res) => {
    res.json({ success: true, data: await revisarAvisos(ctx, taller(req)) });
  });
}
