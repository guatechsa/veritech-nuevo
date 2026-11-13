import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { accesosDeCliente } from './accesos';
import { actorDe, idDe, TallerReq, validar } from './comun';
import { confirmarCita } from './citas';
import { crearEnlaceDeDocumento, listarEnlacesDeOrden, revocarEnlacesDeOrden } from './enlaces-documentos';
import { qrDeEquipo, regenerarQr } from './equipo-publico';
import { revocarSesionesDeCorreo, sesionesDeCliente } from './portal-gestion';
import { exigirPermiso } from './sesion';

/** Del lado del taller: enlaces a la cuenta y al informe, QR del equipo, lo que ha visto un cliente, sesiones del portal y confirmar citas pedidas desde el portal. */
export function montarRutasEnlaces(router: Router, ctx: Contexto): void {
  const taller = (req: Request): TallerReq => req.taller!;
  const emitir = exigirPermiso('documentos.emitir');

  router.post('/ordenes/:id/enlace-cuenta', emitir, async (req, res) => {
    res.status(201).json({ success: true, data: await crearEnlaceDeDocumento(ctx, taller(req), actorDe(req), 'cuenta', idDe(req)) });
  });
  router.post('/checklists/:id/enlace-informe', emitir, async (req, res) => {
    res.status(201).json({ success: true, data: await crearEnlaceDeDocumento(ctx, taller(req), actorDe(req), 'checklist', idDe(req)) });
  });
  router.get('/ordenes/:id/enlaces', exigirPermiso('ordenes.ver'), async (req, res) => {
    res.json({ success: true, data: await listarEnlacesDeOrden(ctx, taller(req), idDe(req)) });
  });
  router.post('/ordenes/:id/enlaces/revocar', emitir, async (req, res) => {
    res.json({ success: true, data: { revocados: await revocarEnlacesDeOrden(ctx, taller(req), actorDe(req), idDe(req)) } });
  });

  // QR del equipo
  router.get('/equipos/:id/qr', exigirPermiso('equipos.ver'), async (req, res) => {
    res.json({ success: true, data: await qrDeEquipo(ctx, taller(req), idDe(req)) });
  });
  router.post('/equipos/:id/qr/regenerar', exigirPermiso('equipos.editar'), async (req, res) => {
    res.json({ success: true, data: await regenerarQr(ctx, taller(req), actorDe(req), idDe(req)) });
  });

  // Lo que ha visto el cliente y sus sesiones del portal
  router.get('/clientes/:id/accesos', exigirPermiso('clientes.ver'), async (req, res) => {
    res.json({ success: true, data: await accesosDeCliente(taller(req), idDe(req)) });
  });
  router.get('/clientes/:id/portal', exigirPermiso('clientes.ver'), async (req, res) => {
    res.json({ success: true, data: await sesionesDeCliente(ctx, taller(req), idDe(req)) });
  });
  router.post('/clientes/:id/portal/revocar', exigirPermiso('clientes.editar'), async (req, res) => {
    const d = validar(z.object({ correo: z.string().max(150) }), req.body);
    res.json({ success: true, data: await revocarSesionesDeCorreo(ctx, taller(req), actorDe(req), idDe(req), d.correo) });
  });

  // Citas pedidas desde el portal
  router.post('/citas/:id/confirmar', exigirPermiso('citas.gestionar'), async (req, res) => {
    res.json({ success: true, data: await confirmarCita(ctx, taller(req), actorDe(req), idDe(req)) });
  });
}
