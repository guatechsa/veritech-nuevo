import { Request, RequestHandler, Router } from 'express';
import { z } from 'zod';
import { ejecutar, filas } from '../db/consulta';
import { ErrorApp } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { APP_VERSION } from '../version';
import { origenDe, validar } from './comun';
import { miDia } from './movil-dia';
import { ingresarMovil, refrescarMovil, registrarDispositivo } from './movil-auth';
import { leerConfiguracion } from './configuracion';

/** La app móvil no funciona con una versión más vieja que esta (se le pide actualizar). */
export const VERSION_MINIMA_APP = '2.0.0';

/** Los avisos al teléfono que existen y quién los puede recibir (el aviso solo llega si la persona tiene el permiso de lo que avisa). */
export const AVISOS_PUSH: Array<{ tipo: string; nombre: string; permiso: string }> = [
  { tipo: 'trabajo_asignado', nombre: 'Me asignaron un trabajo', permiso: 'ordenes.trabajar' },
  { tipo: 'material_cargado', nombre: 'Llegó material a una de mis órdenes', permiso: 'ordenes.trabajar' },
  { tipo: 'checklist_por_vencer', nombre: 'Un checklist está por vencer', permiso: 'checklists.llenar' },
  { tipo: 'cita_del_dia', nombre: 'Citas del día', permiso: 'citas.ver' },
  { tipo: 'solicitud_material_nueva', nombre: 'Hay una solicitud de material por despachar', permiso: 'solicitudes.despachar' },
];

/** Los estados de un trabajo (los 8 del estándar GUATECH): el nombre en usted y si el trabajo está detenido. */
export const ESTADOS_DE_TRABAJO = [
  { codigo: 'pendiente', nombre: 'Pendiente', detenido: false },
  { codigo: 'en_proceso', nombre: 'En proceso', detenido: false },
  { codigo: 'pausado', nombre: 'Pausado', detenido: false },
  { codigo: 'detenido_material', nombre: 'Detenido por material', detenido: true },
  { codigo: 'detenido_terceros', nombre: 'Detenido por trabajos de terceros', detenido: true },
  { codigo: 'detenido_autorizacion', nombre: 'Detenido por autorización', detenido: true },
  { codigo: 'detenido_espacio', nombre: 'Detenido por espacio', detenido: true },
  { codigo: 'terminado', nombre: 'Terminado', detenido: false },
];

const dispositivo = z.object({
  instalacion: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  plataforma: z.enum(['android', 'ios']),
  nombre: z.string().max(100).nullable().optional(),
  version_app: z.string().max(20).nullable().optional(),
  token_push: z.string().max(255).nullable().optional(),
});

/** Rutas de la app móvil. `montarPublicas` va ANTES de la exigencia de sesión; `montar` va después. */
export function montarRutasMovilPublicas(router: Router, ctx: Contexto, freno: RequestHandler, turnstile: RequestHandler): void {
  router.post('/auth/ingresar-movil', freno, turnstile, async (req, res) => {
    const d = validar(z.object({ correo: z.string().trim().email().max(150), contrasena: z.string().min(1).max(200), dispositivo }), req.body);
    res.json({ success: true, data: await ingresarMovil(ctx, req.taller!, { ...origenDe(req), correo: d.correo, contrasena: d.contrasena, telefono: d.dispositivo }) });
  });
  router.post('/auth/refrescar-movil', freno, async (req, res) => {
    const d = validar(z.object({ refresco: z.string().length(64) }), req.body);
    res.json({ success: true, data: await refrescarMovil(ctx, req.taller!, d.refresco) });
  });
}

export function montarRutasMovil(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;

  /** Lo que la app necesita saber para arrancar: versión mínima, estados de los trabajos y avisos disponibles para esta persona. */
  router.get('/movil/config', async (req, res) => {
    const cfg = await leerConfiguracion(taller(req));
    const s = req.sesionTaller!;
    res.json({
      success: true,
      data: {
        version_minima: VERSION_MINIMA_APP,
        version_servidor: APP_VERSION,
        zona_horaria: taller(req).empresa.zonaHoraria,
        moneda: String(cfg['moneda'] ?? 'GTQ'),
        estados_de_trabajo: ESTADOS_DE_TRABAJO,
        tipos_de_respuesta: ['semaforo', 'si_no', 'numero', 'texto', 'lista'],
        maximo_fotos_por_item: 5,
        avisos: AVISOS_PUSH.filter((a) => s.permisos.has(a.permiso)).map(({ tipo, nombre }) => ({ tipo, nombre })),
      },
    });
  });

  /** «Descargar mi día»: todo lo que la persona necesita para trabajar sin señal (según sus permisos, sin costos). */
  router.get('/movil/mi-dia', async (req, res) => {
    res.json({ success: true, data: await miDia(ctx, taller(req), req.sesionTaller!) });
  });

  /** El teléfono avisa de sí mismo: su identificador, su versión y el código para mandarle avisos. */
  router.post('/movil/dispositivo', async (req, res) => {
    const d = validar(dispositivo, req.body);
    if (req.sesionTaller!.esSoporte) throw new ErrorApp(403, 'SOPORTE', 'Una sesión de soporte no registra teléfonos.');
    const id = await registrarDispositivo(ctx, taller(req), req.sesionTaller!.usuarioId, d);
    res.json({ success: true, data: { id } });
  });

  router.get('/movil/preferencias-aviso', async (req, res) => {
    const s = req.sesionTaller!;
    const f = await filas<{ tipo_aviso: string; activo: number }>(taller(req).pool, "SELECT tipo_aviso, activo FROM preferencias_aviso WHERE usuario_id = ? AND canal = 'push'", [s.usuarioId]);
    res.json({
      success: true,
      data: AVISOS_PUSH.filter((a) => s.permisos.has(a.permiso)).map((a) => ({ tipo: a.tipo, nombre: a.nombre, activo: f.find((x) => x.tipo_aviso === a.tipo)?.activo !== 0 })),
    });
  });

  router.put('/movil/preferencias-aviso/:tipo', async (req, res) => {
    const s = req.sesionTaller!;
    const def = AVISOS_PUSH.find((a) => a.tipo === String(req.params['tipo']));
    if (!def || !s.permisos.has(def.permiso)) throw new ErrorApp(404, 'NO_ENCONTRADO', 'Ese aviso no existe.');
    const d = validar(z.object({ activo: z.boolean() }), req.body);
    await ejecutar(taller(req).pool, "INSERT INTO preferencias_aviso (usuario_id, tipo_aviso, canal, activo) VALUES (?, ?, 'push', ?) ON DUPLICATE KEY UPDATE activo = VALUES(activo)", [s.usuarioId, def.tipo, d.activo ? 1 : 0]);
    res.json({ success: true, data: { tipo: def.tipo, activo: d.activo } });
  });
}
