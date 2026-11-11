import { Request, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ErrorValidacion } from '../errores';
import { exigirTurnstile } from '../utils/turnstile';
import { listarAuditoria } from './auditoria';
import { autenticar, cambiarContrasena, exigirRol, ingresar, restablecerContrasena, solicitarRecuperacion } from './auth';
import { agenteDe, Contexto, ipDe } from './contexto';
import { aprovisionarAlta } from '../alta/aprovisionar';
import { conciliarEmpresa } from '../cobro/conciliacion';
import { actualizarEmpresa, cambiarEstadoEmpresa, detalleEmpresa, listarAltasPorAtender, listarEmpresas, obtenerEmpresa } from './empresas';
import { actualizarPlan, listarModulos, listarPlanes } from './planes';
import { obtenerIndicadores } from './stats';
import { actualizarUsuario, crearUsuario, listarUsuarios, restablecerContrasenaDeUsuario } from './usuarios';

function validar<T extends z.ZodType>(esquema: T, datos: unknown): z.infer<T> {
  const resultado = esquema.safeParse(datos);
  if (!resultado.success) {
    const incidencia = resultado.error.issues[0];
    const campo = incidencia?.path.join('.') || 'solicitud';
    throw new ErrorValidacion(`El dato «${campo}» falta o no es válido`);
  }
  return resultado.data;
}

function idDe(req: Request): number {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id) || id <= 0) throw new ErrorValidacion('El identificador no es válido');
  return id;
}

const origen = (req: Request) => ({ ip: ipDe(req), userAgent: agenteDe(req) });

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
const modulos = z.array(z.string().min(1).max(40)).max(50);

export function crearRutasPlataforma(ctx: Contexto): Router {
  const router = Router();
  const requiereSesion = autenticar(ctx);
  const puedeEscribir = exigirRol('SUPER_ADMIN', 'ADMIN');
  const soloSuper = exigirRol('SUPER_ADMIN');

  // ── Acceso (público) ──────────────────────────────────────────────────────────────
  router.post('/auth/ingresar', limitador(ctx.limites?.ingreso ?? 10, 15), async (req, res) => {
    const datos = validar(z.object({ correo, contrasena }), req.body);
    res.json({ success: true, data: await ingresar(ctx, { correo: datos.correo, contrasena: datos.contrasena, ...origen(req) }) });
  });

  router.post('/auth/recuperar', limitador(ctx.limites?.recuperacion ?? 5, 60), exigirTurnstile(ctx.entorno.TURNSTILE_SECRET), async (req, res) => {
    const datos = validar(z.object({ correo }), req.body);
    await solicitarRecuperacion(ctx, datos.correo, origen(req));
    // Siempre la misma respuesta, exista o no la cuenta: no se revela quién está registrado.
    res.json({ success: true, data: { mensaje: 'Si el correo está registrado, le enviamos un enlace para restablecer su contraseña.' } });
  });

  router.post('/auth/restablecer', limitador(ctx.limites?.recuperacion ?? 5, 60), async (req, res) => {
    const datos = validar(z.object({ token: z.string().min(10).max(200), contrasena }), req.body);
    await restablecerContrasena(ctx, datos.token, datos.contrasena, origen(req));
    res.json({ success: true, data: { mensaje: 'Su contraseña se restableció. Ya puede ingresar.' } });
  });

  // ── Todo lo demás exige sesión ────────────────────────────────────────────────────
  router.get('/auth/yo', requiereSesion, (req, res) => {
    res.json({ success: true, data: req.usuarioPlataforma });
  });

  router.post('/auth/cambiar-contrasena', requiereSesion, async (req, res) => {
    const datos = validar(z.object({ actual: contrasena, nueva: contrasena }), req.body);
    await cambiarContrasena(ctx, req.usuarioPlataforma!.id, datos.actual, datos.nueva, origen(req));
    res.json({ success: true, data: { mensaje: 'Su contraseña se cambió.' } });
  });

  router.get('/stats', requiereSesion, async (_req, res) => {
    res.json({ success: true, data: await obtenerIndicadores(ctx) });
  });

  // Empresas
  router.get('/empresas', requiereSesion, async (req, res) => {
    const filtro = validar(
      z.object({
        estado: z.enum(['pendiente', 'prueba', 'activa', 'pago_fallido', 'suspendida', 'cancelada_con_acceso', 'solo_exportar', 'cerrada']).optional(),
        buscar: z.string().trim().max(100).optional(),
      }),
      req.query
    );
    res.json({ success: true, data: await listarEmpresas(ctx, filtro) });
  });

  router.get('/empresas/:id', requiereSesion, async (req, res) => {
    res.json({ success: true, data: await obtenerEmpresa(ctx, idDe(req)) });
  });

  router.get('/empresas/:id/detalle', requiereSesion, async (req, res) => {
    res.json({ success: true, data: await detalleEmpresa(ctx, idDe(req)) });
  });

  /** Pone la empresa al día con PayPal ahora mismo (lo mismo que hace la conciliación cada 3 horas). */
  router.post('/empresas/:id/conciliar', requiereSesion, puedeEscribir, async (req, res) => {
    const r = await conciliarEmpresa(ctx, idDe(req), 'manual', { tipo: 'conciliacion_manual', usuarioId: req.usuarioPlataforma!.id });
    res.json({ success: true, data: r });
  });

  router.get('/altas', requiereSesion, async (_req, res) => {
    res.json({ success: true, data: await listarAltasPorAtender(ctx) });
  });

  /** Reintenta crear el taller de un cliente que ya pagó (alta en error o atorada). */
  router.post('/altas/:id/reintentar', requiereSesion, puedeEscribir, async (req, res) => {
    res.json({ success: true, data: await aprovisionarAlta(ctx, idDe(req)) });
  });

  router.patch('/empresas/:id', requiereSesion, puedeEscribir, async (req, res) => {
    const cambios = validar(
      z.object({
        nombre: z.string().trim().min(1).max(150).optional(),
        contacto_nombre: z.string().trim().max(120).nullable().optional(),
        contacto_correo: correo.nullable().optional(),
        plan_id: z.number().int().positive().nullable().optional(),
        cuota_mensual: z.number().min(0).max(100000).nullable().optional(),
        cobro_por_contrato: z.boolean().optional(),
        modulos: modulos.optional(),
      }),
      req.body
    );
    await actualizarEmpresa(ctx, req.usuarioPlataforma!, idDe(req), cambios, origen(req));
    res.json({ success: true, data: await obtenerEmpresa(ctx, idDe(req)) });
  });

  router.post('/empresas/:id/estado', requiereSesion, puedeEscribir, async (req, res) => {
    const datos = validar(z.object({ estado: z.enum(['activa', 'suspendida']), motivo: z.string().trim().max(300).optional() }), req.body);
    await cambiarEstadoEmpresa(ctx, req.usuarioPlataforma!, idDe(req), datos.estado, datos.motivo, origen(req));
    res.json({ success: true, data: await obtenerEmpresa(ctx, idDe(req)) });
  });

  // Planes y módulos
  router.get('/modulos', requiereSesion, async (_req, res) => {
    res.json({ success: true, data: await listarModulos(ctx) });
  });

  router.get('/planes', requiereSesion, async (_req, res) => {
    res.json({ success: true, data: await listarPlanes(ctx) });
  });

  router.patch('/planes/:id', requiereSesion, soloSuper, async (req, res) => {
    const cambios = validar(
      z.object({
        nombre: z.string().trim().min(1).max(80).optional(),
        precio_mensual: z.number().min(0).max(100000).optional(),
        max_usuarios: z.number().int().positive().nullable().optional(),
        max_sucursales: z.number().int().positive().nullable().optional(),
        activo: z.boolean().optional(),
        modulos: modulos.optional(),
      }),
      req.body
    );
    await actualizarPlan(ctx, req.usuarioPlataforma!, idDe(req), cambios, origen(req));
    res.json({ success: true, data: await listarPlanes(ctx) });
  });

  // Usuarios de plataforma
  router.get('/usuarios', requiereSesion, async (_req, res) => {
    res.json({ success: true, data: await listarUsuarios(ctx) });
  });

  router.post('/usuarios', requiereSesion, soloSuper, async (req, res) => {
    const datos = validar(z.object({ nombre: z.string().trim().min(1).max(120), correo, rol: z.enum(['SUPER_ADMIN', 'ADMIN', 'VIEWER']) }), req.body);
    res.status(201).json({ success: true, data: await crearUsuario(ctx, req.usuarioPlataforma!, datos, origen(req)) });
  });

  router.patch('/usuarios/:id', requiereSesion, soloSuper, async (req, res) => {
    const cambios = validar(
      z.object({ nombre: z.string().trim().min(1).max(120).optional(), rol: z.enum(['SUPER_ADMIN', 'ADMIN', 'VIEWER']).optional(), activo: z.boolean().optional() }),
      req.body
    );
    await actualizarUsuario(ctx, req.usuarioPlataforma!, idDe(req), cambios, origen(req));
    res.json({ success: true, data: await listarUsuarios(ctx) });
  });

  router.post('/usuarios/:id/contrasena-temporal', requiereSesion, soloSuper, async (req, res) => {
    const temporal = await restablecerContrasenaDeUsuario(ctx, req.usuarioPlataforma!, idDe(req), origen(req));
    res.json({ success: true, data: { contrasenaTemporal: temporal } });
  });

  // Auditoría
  router.get('/auditoria', requiereSesion, async (req, res) => {
    const f = validar(
      z.object({
        pagina: z.coerce.number().int().min(1).default(1),
        accion: z.string().trim().max(60).optional(),
        usuario_id: z.coerce.number().int().positive().optional(),
        empresa_id: z.coerce.number().int().positive().optional(),
      }),
      req.query
    );
    res.json({ success: true, data: await listarAuditoria(ctx.pool, { pagina: f.pagina, porPagina: 50, accion: f.accion, usuarioId: f.usuario_id, empresaId: f.empresa_id }) });
  });

  return router;
}
