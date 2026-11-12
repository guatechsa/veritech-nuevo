import { Request, Router } from 'express';
import { z } from 'zod';
import { filas } from '../db/consulta';
import { Contexto } from '../plataforma/contexto';
import { actualizarCita, cancelarCita, crearCita, listarCitas, marcarNoSePresento, recibirCita } from './citas';
import { actorDe, idDe, validar } from './comun';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const nulo = (max: number) => texto(max).nullable().optional();
const idPositivo = z.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hora = z.string().regex(/^\d{2}:\d{2}$/);

/** Citas (módulo «ordenes»). Los días y horas que entran y salen son los DEL TALLER. */
export function montarRutasCitas(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('citas.ver');
  const gestionar = exigirPermiso('citas.gestionar');

  router.get('/citas', ver, async (req, res) => {
    const f = validar(
      z.object({
        desde: fecha.optional(),
        hasta: fecha.optional(),
        estado: z.enum(['programada', 'se_presento', 'no_se_presento', 'cancelada']).optional(),
        equipo_id: z.coerce.number().int().positive().optional(),
        sucursal_id: z.coerce.number().int().positive().optional(),
        pagina: z.coerce.number().int().min(1).default(1),
      }),
      req.query
    );
    res.json({ success: true, data: await listarCitas(ctx, taller(req), { ...f, porPagina: 100 }) });
  });

  /** Motivos de cancelación y sucursales para los formularios. */
  router.get('/citas-opciones', ver, async (req, res) => {
    const motivos = await filas<{ id: number; nombre: string }>(taller(req).pool, "SELECT id, nombre FROM motivos WHERE tipo = 'cancelacion_cita' AND activo = 1 ORDER BY nombre");
    const sucursales = await filas<{ id: number; nombre: string; es_principal: number; cupo_diario_citas: number | null }>(taller(req).pool, 'SELECT id, nombre, es_principal, cupo_diario_citas FROM sucursales WHERE activo = 1 ORDER BY es_principal DESC, nombre');
    res.json({ success: true, data: { motivos_cancelacion: motivos, sucursales } });
  });

  router.post('/citas', gestionar, async (req, res) => {
    const d = validar(
      z.object({ equipo_id: idPositivo, fecha, hora, sucursal_id: idPositivo.optional(), horas_estimadas: z.number().min(0.25).max(24).optional(), notas: nulo(500), lectura_contador: z.number().min(0).max(99999999).nullable().optional(), servicio_programado_id: idPositivo.optional() }),
      req.body
    );
    res.status(201).json({ success: true, data: await crearCita(ctx, taller(req), actorDe(req), d) });
  });

  router.patch('/citas/:id', gestionar, async (req, res) => {
    const d = validar(
      z.object({ fecha: fecha.optional(), hora: hora.optional(), sucursal_id: idPositivo.optional(), horas_estimadas: z.number().min(0.25).max(24).optional(), notas: nulo(500), lectura_contador: z.number().min(0).max(99999999).nullable().optional() }),
      req.body
    );
    res.json({ success: true, data: await actualizarCita(ctx, taller(req), actorDe(req), idDe(req), d) });
  });

  router.post('/citas/:id/cancelar', gestionar, async (req, res) => {
    const d = validar(z.object({ motivo_id: idPositivo, texto: nulo(300) }), req.body);
    res.json({ success: true, data: await cancelarCita(ctx, taller(req), actorDe(req), idDe(req), d) });
  });

  router.post('/citas/:id/no-se-presento', gestionar, async (req, res) => {
    res.json({ success: true, data: await marcarNoSePresento(ctx, taller(req), actorDe(req), idDe(req)) });
  });

  /** El cliente llegó: se recibe el equipo y nace la orden. Pide además el permiso de crear órdenes. */
  router.post('/citas/:id/recibir', gestionar, exigirPermiso('ordenes.crear'), async (req, res) => {
    const d = validar(
      z.object({
        tipo_orden_id: idPositivo.optional(),
        prioridad: z.enum(['baja', 'media', 'alta', 'urgente']).optional(),
        descripcion: nulo(500),
        responsable_id: idPositivo.nullable().optional(),
        area_trabajo_id: idPositivo.nullable().optional(),
        fecha_estimada_entrega: fecha.nullable().optional(),
        lectura: z.object({ contador_id: idPositivo, valor: z.number().min(0).max(99999999) }).optional(),
      }),
      req.body
    );
    const r = await recibirCita(ctx, taller(req), actorDe(req), idDe(req), d);
    res.status(201).json({ success: true, data: { orden_id: r.ordenId, numero: r.numero, cita: r.cita } });
  });
}
