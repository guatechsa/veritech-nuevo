import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { actualizarAviso, enviarPrueba, listarAvisos, registroDeAvisos } from './avisos';
import { actorDe, validar } from './comun';
import { exigirPermiso } from './sesion';

/** Configuración de los avisos incluidos y su registro (módulo «base»: Configuración → Avisos). */
export function montarRutasAvisos(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('configuracion.ver');
  const configurar = exigirPermiso('avisos.configurar');

  router.get('/avisos', ver, async (req, res) => {
    res.json({ success: true, data: await listarAvisos(taller(req)) });
  });
  router.put('/avisos/:tipo', configurar, async (req, res) => {
    const d = validar(
      z.object({
        activo: z.boolean(),
        asunto: z.string().max(150).nullable().optional(),
        cuerpo: z.string().max(3000).nullable().optional(),
        umbral_dias: z.number().int().min(0).max(365).nullable().optional(),
        incluir_contextual: z.boolean(),
        roles: z.array(z.number().int().positive()).max(30),
        usuarios: z.array(z.number().int().positive()).max(60),
        correos: z.array(z.string().max(150)).max(20),
      }),
      req.body
    );
    res.json({ success: true, data: await actualizarAviso(taller(req), actorDe(req), String(req.params['tipo']), { ...d, asunto: d.asunto ?? null, cuerpo: d.cuerpo ?? null, umbral_dias: d.umbral_dias ?? null }) });
  });
  router.post('/avisos/:tipo/prueba', configurar, async (req, res) => {
    res.json({ success: true, data: await enviarPrueba(ctx, taller(req), actorDe(req), String(req.params['tipo'])) });
  });
  router.get('/avisos-registro', ver, async (req, res) => {
    const f = validar(z.object({ tipo: z.string().max(40).optional(), pagina: z.coerce.number().int().min(1).default(1), porPagina: z.coerce.number().int().min(1).max(100).default(25) }), req.query);
    res.json({ success: true, data: await registroDeAvisos(taller(req), f) });
  });
}
