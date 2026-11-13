import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ErrorApp } from '../errores';
import { Contexto, ipDe } from '../plataforma/contexto';
import { origenDe, validar } from './comun';
import { montarRutasCatalogos } from './rutas-catalogos';
import { montarRutasChecklists } from './rutas-checklists';
import { montarRutasCitas } from './rutas-citas';
import { montarRutasClientes } from './rutas-clientes';
import { montarRutasDatos } from './rutas-datos';
import { montarRutasEquipos } from './rutas-equipos';
import { montarRutasEstructura } from './rutas-estructura';
import { montarRutasCotizaciones } from './rutas-cotizaciones';
import { montarRutasDocumentos } from './rutas-documentos';
import { montarRutasInventario } from './rutas-inventario';
import { montarRutasOrdenes } from './rutas-ordenes';
import { montarRutasReservas } from './rutas-reservas';
import { montarRutasAvisos } from './rutas-avisos';
import { conIdentificador } from './movil-idempotencia';
import { montarRutasEnlaces } from './rutas-enlaces';
import { montarRutasMovil, montarRutasMovilPublicas } from './rutas-movil';
import { montarRutasInformes } from './rutas-informes';
import { montarRutasPublicas } from './rutas-portal';
import { montarRutasReportes } from './rutas-reportes';
import { montarRutasSolicitudes } from './rutas-solicitudes';
import { montarRutasServicios } from './rutas-servicios';
import { exigirTurnstile } from '../utils/turnstile';
import { canjearAccesoSoporte, cambiarContrasena, cerrarSesion, ingresar, perfilDeSesion, restablecerContrasena, solicitarRecuperacion } from './auth';
import { resolverTaller } from './resolutor';
import { autenticarTaller, bloquearCambiosSiSoloExportar, exigirPermiso } from './sesion';
import { cancelarDesdeTaller, resumenSuscripcion } from './suscripcion';
import { responderPorEnlace, verCotizacionPublica } from './enlaces';

function limitador(limite: number, minutos: number) {
  return rateLimit({
    windowMs: minutos * 60 * 1000,
    limit: limite,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, codigo: 'DEMASIADOS_INTENTOS', error: 'Demasiados intentos. Intente de nuevo más tarde.' });
    },
  });
}

const correo = z.string().trim().email().max(150);
const contrasena = z.string().min(1).max(200);

/**
 * API de un taller (`/api/taller/...`). Todas las rutas pasan primero por `resolverTaller` (qué taller es, por su dirección)
 * y, salvo las públicas de acceso, por `autenticarTaller` (quién es y qué puede hacer).
 */
export function crearRutasTaller(ctx: Contexto): Router {
  const router = Router();
  const turnstile = exigirTurnstile(ctx.entorno.TURNSTILE_SECRET);
  const tope = ctx.limites?.ingreso ?? 10;
  const topeRecuperacion = ctx.limites?.recuperacion ?? 5;

  router.use(resolverTaller(ctx));

  // ── Públicas (ya con taller resuelto) ─────────────────────────────────────────────
  /** Datos mínimos para pintar la pantalla de ingreso: el nombre del taller, nada más. */
  router.get('/info', (req, res) => {
    res.json({ success: true, data: { nombre: req.taller!.empresa.nombre, slug: req.taller!.empresa.slug, estado: req.taller!.empresa.estado } });
  });

  router.post('/auth/ingresar', limitador(tope, 15), async (req, res) => {
    const datos = validar(z.object({ correo, contrasena }), req.body);
    res.json({ success: true, data: await ingresar(ctx, req.taller!, { ...origenDe(req), correo: datos.correo, contrasena: datos.contrasena }) });
  });

  router.post('/auth/recuperar', limitador(topeRecuperacion, 60), turnstile, async (req, res) => {
    const datos = validar(z.object({ correo }), req.body);
    await solicitarRecuperacion(ctx, req.taller!, datos.correo);
    res.json({ success: true, data: { mensaje: 'Si el correo está registrado en este taller, le enviamos un enlace para restablecer su contraseña.' } });
  });

  router.post('/auth/restablecer', limitador(topeRecuperacion, 60), async (req, res) => {
    const datos = validar(z.object({ token: z.string().min(10).max(200), contrasena }), req.body);
    await restablecerContrasena(ctx, req.taller!, datos.token, datos.contrasena, origenDe(req));
    res.json({ success: true, data: { mensaje: 'Su contraseña se restableció. Ya puede ingresar.' } });
  });

  /** Canje del enlace "Entrar" que emite el panel de GUATECH (un solo uso, 60 segundos). */
  router.post('/auth/soporte', limitador(tope, 15), async (req, res) => {
    const datos = validar(z.object({ token: z.string().length(64) }), req.body);
    res.json({ success: true, data: await canjearAccesoSoporte(ctx, req.taller!, datos.token, origenDe(req)) });
  });

  // ── Enlaces para el cliente (sin sesión: el enlace secreto es la llave) ─────────────
  const topePublico = ctx.limites?.publico ?? 60;
  router.get('/publico/cotizacion/:token', limitador(topePublico, 15), async (req, res) => {
    res.json({ success: true, data: await verCotizacionPublica(ctx, req.taller!, String(req.params['token']), { ip: ipDe(req), agente: req.get('user-agent') ?? '' }) });
  });
  router.post('/publico/cotizacion/:token/responder', limitador(topePublico, 15), async (req, res) => {
    const d = validar(
      z.object({
        nombre: z.string().trim().min(3).max(100),
        respuestas: z.array(z.object({ linea_id: z.number().int().positive(), decision: z.enum(['autorizada', 'rechazada']), motivo_id: z.number().int().positive().nullable().optional(), motivo_texto: z.string().trim().max(300).nullable().optional() })).min(1).max(100),
      }),
      req.body
    );
    res.json({ success: true, data: await responderPorEnlace(ctx, req.taller!, String(req.params['token']), { ip: ipDe(req), agente: req.get('user-agent') ?? '' }, d) });
  });

  montarRutasPublicas(router, ctx, limitador(topePublico, 15), limitador(topeRecuperacion, 60), turnstile);
  montarRutasMovilPublicas(router, ctx, limitador(tope, 15), turnstile);

  // ── Todo lo demás exige sesión ────────────────────────────────────────────────────
  const requiereSesion = autenticarTaller(ctx);
  router.use(requiereSesion);
  router.use(bloquearCambiosSiSoloExportar());
  router.use(conIdentificador(ctx)); // los cambios de la app llevan un identificador: reenviarlos nunca los duplica
  montarRutasMovil(router, ctx);

  router.get('/auth/yo', async (req, res) => {
    res.json({ success: true, data: await perfilDeSesion(req.taller!, req.sesionTaller!) });
  });

  router.post('/auth/cerrar', async (req, res) => {
    await cerrarSesion(ctx, req.taller!, req.sesionTaller!.sesionId);
    res.json({ success: true, data: { mensaje: 'Sesión cerrada.' } });
  });

  router.post('/auth/cambiar-contrasena', async (req, res) => {
    const datos = validar(z.object({ actual: contrasena, nueva: contrasena }), req.body);
    const s = req.sesionTaller!;
    if (s.esSoporte) throw new ErrorApp(403, 'SOPORTE_NO_CAMBIA', 'Una sesión de soporte no puede cambiar la contraseña de la persona.');
    await cambiarContrasena(ctx, req.taller!, s.usuarioId, s.sesionId, datos.actual, datos.nueva, origenDe(req));
    res.json({ success: true, data: { mensaje: 'Su contraseña se cambió. Se cerraron sus otras sesiones.' } });
  });

  // Suscripción y pagos
  router.get('/suscripcion', exigirPermiso('suscripcion.ver'), async (req, res) => {
    const puede = req.sesionTaller!.permisos.has('suscripcion.cancelar') && !req.sesionTaller!.esSoporte;
    res.json({ success: true, data: await resumenSuscripcion(ctx, req.taller!.empresa, puede) });
  });

  router.post('/suscripcion/cancelar', exigirPermiso('suscripcion.cancelar'), async (req, res) => {
    const datos = validar(z.object({ motivo: z.string().trim().max(200).default('') }), req.body);
    const r = await cancelarDesdeTaller(ctx, req.taller!.empresa, req.sesionTaller!, datos.motivo || 'SIN MOTIVO', ipDe(req));
    res.json({ success: true, data: r });
  });

  montarRutasEstructura(router, ctx);
  montarRutasCatalogos(router, ctx);
  montarRutasClientes(router, ctx);
  montarRutasEquipos(router, ctx);
  montarRutasDatos(router, ctx);
  montarRutasOrdenes(router, ctx);
  montarRutasCitas(router, ctx);
  montarRutasChecklists(router, ctx);
  montarRutasServicios(router, ctx);
  montarRutasInventario(router, ctx);
  montarRutasSolicitudes(router, ctx);
  montarRutasReservas(router, ctx);
  montarRutasCotizaciones(router, ctx);
  montarRutasDocumentos(router, ctx);
  montarRutasReportes(router, ctx);
  montarRutasAvisos(router, ctx);
  montarRutasInformes(router, ctx);
  montarRutasEnlaces(router, ctx);

  return router;
}
