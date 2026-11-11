import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { AREAS, crearCatalogo, eliminarNivel, esquemaCatalogo, NIVELES_TECNICO, TIPOS_CREDENCIAL } from './catalogos';
import { actualizarColaborador, actualizarCredencial, cambiarEstadoColaborador, crearColaborador, crearCredencial, listarColaboradores, obtenerColaborador } from './colaboradores';
import { actorDe, idDe, validar } from './comun';
import { guardarConfiguracion, leerConfiguracion, listarBitacora, metadatosDeConfiguracion } from './configuracion';
import { actualizarAusencia, crearAusencia, eliminarAusencia, guardarJornada, jornadaEfectiva, listarAusencias, obtenerJornada } from './jornada';
import { sembrarMatrizDeNivel } from './catalogos-trabajo';
import { actualizarBodega, actualizarSucursal, crearBodega, crearSucursal, DEF_PUESTOS, guardarCredencialesDePuesto, listarBodegas, listarPuestos, listarSucursales, obtenerSucursal, puestosBase } from './estructura';
import { actualizarRol, crearRol, listarPermisos, listarRoles, obtenerRol } from './roles';
import { exigirPermiso } from './sesion';
import { actualizarUsuario, darAcceso, reenviarEnlace, revocarSesiones } from './usuarios';

const texto = (max: number) => z.string().trim().max(max);
const opcionalNulo = (max: number) => texto(max).nullable().optional();
const incluirInactivos = z.object({ inactivos: z.enum(['true', 'false']).optional() });
const verInactivos = (req: Request): boolean => validar(incluirInactivos, req.query).inactivos === 'true';
const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

/** Estructura del taller y sus personas (Fase 3b). Se monta después de resolver el taller y exigir sesión. */
export function montarRutasEstructura(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const permisosDe = (req: Request): Set<string> => req.sesionTaller!.permisos;

  // ── Sucursales ─────────────────────────────────────────────────────────────────────
  router.get('/sucursales', exigirPermiso('sucursales.ver'), async (req, res) => {
    res.json({ success: true, data: await listarSucursales(taller(req), verInactivos(req)) });
  });
  const esquemaSucursal = z.object({ direccion: opcionalNulo(250), telefono: opcionalNulo(40), cupo_diario_citas: z.number().int().min(0).max(1000).nullable().optional() });
  router.post('/sucursales', exigirPermiso('sucursales.gestionar'), async (req, res) => {
    const d = validar(esquemaSucursal.extend({ nombre: texto(100).min(1) }), req.body);
    res.status(201).json({ success: true, data: await crearSucursal(taller(req), actorDe(req), d) });
  });
  router.patch('/sucursales/:id', exigirPermiso('sucursales.gestionar'), async (req, res) => {
    const d = validar(esquemaSucursal.extend({ nombre: texto(100).min(1).optional(), es_principal: z.boolean().optional(), activo: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarSucursal(taller(req), actorDe(req), idDe(req), d) });
  });
  router.get('/sucursales/:id', exigirPermiso('sucursales.ver'), async (req, res) => {
    res.json({ success: true, data: await obtenerSucursal(taller(req), idDe(req)) });
  });

  // ── Áreas de trabajo ───────────────────────────────────────────────────────────────
  const areas = crearCatalogo(AREAS);
  router.get('/areas', exigirPermiso('areas.ver'), async (req, res) => {
    res.json({ success: true, data: await areas.listar(taller(req), verInactivos(req)) });
  });
  router.post('/areas', exigirPermiso('areas.gestionar'), async (req, res) => {
    res.status(201).json({ success: true, data: await areas.crear(taller(req), actorDe(req), validar(esquemaCatalogo(AREAS, false), req.body) as Record<string, unknown>) });
  });
  router.patch('/areas/:id', exigirPermiso('areas.gestionar'), async (req, res) => {
    res.json({ success: true, data: await areas.actualizar(taller(req), actorDe(req), idDe(req), validar(esquemaCatalogo(AREAS, true), req.body) as Record<string, unknown>) });
  });

  // ── Bodegas ────────────────────────────────────────────────────────────────────────
  router.get('/bodegas', exigirPermiso('bodegas.ver'), async (req, res) => {
    res.json({ success: true, data: await listarBodegas(taller(req), verInactivos(req)) });
  });
  router.post('/bodegas', exigirPermiso('bodegas.gestionar'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(100).min(1), sucursal_id: z.number().int().positive() }), req.body);
    res.status(201).json({ success: true, data: await crearBodega(taller(req), actorDe(req), d) });
  });
  router.patch('/bodegas/:id', exigirPermiso('bodegas.gestionar'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(100).min(1).optional(), sucursal_id: z.number().int().positive().optional(), activo: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarBodega(taller(req), actorDe(req), idDe(req), d) });
  });

  // ── Puestos, credenciales y niveles de técnico (catálogos del personal) ────────────
  router.get('/puestos', exigirPermiso('colaboradores.ver'), async (req, res) => {
    res.json({ success: true, data: await listarPuestos(taller(req), verInactivos(req)) });
  });
  router.post('/puestos', exigirPermiso('configuracion.editar'), async (req, res) => {
    const d = validar(esquemaCatalogo(DEF_PUESTOS, false), req.body) as Record<string, unknown>;
    const creado = await puestosBase.crear(taller(req), actorDe(req), d);
    res.status(201).json({ success: true, data: (await listarPuestos(taller(req), true)).find((p) => p['id'] === creado['id']) });
  });
  router.patch('/puestos/:id', exigirPermiso('configuracion.editar'), async (req, res) => {
    const id = idDe(req);
    await puestosBase.actualizar(taller(req), actorDe(req), id, validar(esquemaCatalogo(DEF_PUESTOS, true), req.body) as Record<string, unknown>);
    res.json({ success: true, data: (await listarPuestos(taller(req), true)).find((p) => p['id'] === id) });
  });
  router.put('/puestos/:id/credenciales', exigirPermiso('configuracion.editar'), async (req, res) => {
    const id = idDe(req);
    const d = validar(z.object({ credenciales: z.array(z.object({ tipo_credencial_id: z.number().int().positive(), obligatoria: z.boolean() })).max(30) }), req.body);
    await guardarCredencialesDePuesto(taller(req), actorDe(req), id, d.credenciales);
    res.json({ success: true, data: (await listarPuestos(taller(req), true)).find((p) => p['id'] === id) });
  });

  const tiposCred = crearCatalogo(TIPOS_CREDENCIAL);
  router.get('/tipos-credencial', exigirPermiso('colaboradores.ver'), async (req, res) => {
    res.json({ success: true, data: await tiposCred.listar(taller(req), verInactivos(req)) });
  });
  router.post('/tipos-credencial', exigirPermiso('configuracion.editar'), async (req, res) => {
    res.status(201).json({ success: true, data: await tiposCred.crear(taller(req), actorDe(req), validar(esquemaCatalogo(TIPOS_CREDENCIAL, false), req.body) as Record<string, unknown>) });
  });
  router.patch('/tipos-credencial/:id', exigirPermiso('configuracion.editar'), async (req, res) => {
    res.json({ success: true, data: await tiposCred.actualizar(taller(req), actorDe(req), idDe(req), validar(esquemaCatalogo(TIPOS_CREDENCIAL, true), req.body) as Record<string, unknown>) });
  });

  const niveles = crearCatalogo(NIVELES_TECNICO);
  router.get('/niveles-tecnico', exigirPermiso('colaboradores.ver'), async (req, res) => {
    res.json({ success: true, data: await niveles.listar(taller(req), true) });
  });
  router.post('/niveles-tecnico', exigirPermiso('configuracion.editar'), async (req, res) => {
    const creado = await niveles.crear(taller(req), actorDe(req), validar(esquemaCatalogo(NIVELES_TECNICO, false), req.body) as Record<string, unknown>);
    await sembrarMatrizDeNivel(taller(req), Number(creado['id']));
    res.status(201).json({ success: true, data: creado });
  });
  router.patch('/niveles-tecnico/:id', exigirPermiso('configuracion.editar'), async (req, res) => {
    res.json({ success: true, data: await niveles.actualizar(taller(req), actorDe(req), idDe(req), validar(esquemaCatalogo(NIVELES_TECNICO, true), req.body) as Record<string, unknown>) });
  });
  router.delete('/niveles-tecnico/:id', exigirPermiso('configuracion.editar'), async (req, res) => {
    await eliminarNivel(taller(req), actorDe(req), idDe(req));
    res.json({ success: true, data: { mensaje: 'Nivel eliminado.' } });
  });

  // ── Colaboradores ──────────────────────────────────────────────────────────────────
  router.get('/colaboradores', exigirPermiso('colaboradores.ver'), async (req, res) => {
    const f = validar(
      z.object({
        buscar: texto(100).optional(),
        activo: z.enum(['true', 'false']).optional(),
        sucursal_id: z.coerce.number().int().positive().optional(),
        puesto_id: z.coerce.number().int().positive().optional(),
        con_usuario: z.enum(['true', 'false']).optional(),
      }),
      req.query
    );
    res.json({
      success: true,
      data: await listarColaboradores(taller(req), {
        buscar: f.buscar,
        activo: f.activo === undefined ? undefined : f.activo === 'true',
        sucursal_id: f.sucursal_id,
        puesto_id: f.puesto_id,
        con_usuario: f.con_usuario === undefined ? undefined : f.con_usuario === 'true',
      }),
    });
  });
  router.get('/colaboradores/:id', exigirPermiso('colaboradores.ver'), async (req, res) => {
    res.json({ success: true, data: await obtenerColaborador(taller(req), idDe(req)) });
  });
  const esquemaColab = z.object({
    correo: z.string().trim().email().max(150).nullable().optional(),
    celular: opcionalNulo(30),
    direccion: opcionalNulo(200),
    dpi: opcionalNulo(30),
    sucursal_id: z.number().int().positive().nullable().optional(),
    area_trabajo_id: z.number().int().positive().nullable().optional(),
    nivel_tecnico_id: z.number().int().positive().nullable().optional(),
  });
  router.post('/colaboradores', exigirPermiso('colaboradores.crear'), async (req, res) => {
    const d = validar(esquemaColab.extend({ nombre_completo: texto(150).min(2), puestos: z.array(z.number().int().positive()).min(1).max(10) }), req.body);
    res.status(201).json({ success: true, data: await crearColaborador(taller(req), actorDe(req), d) });
  });
  router.patch('/colaboradores/:id', exigirPermiso('colaboradores.editar'), async (req, res) => {
    const d = validar(esquemaColab.extend({ nombre_completo: texto(150).min(2).optional(), puestos: z.array(z.number().int().positive()).min(1).max(10).optional() }), req.body);
    res.json({ success: true, data: await actualizarColaborador(ctx, taller(req), actorDe(req), idDe(req), d) });
  });
  router.post('/colaboradores/:id/estado', exigirPermiso('colaboradores.desactivar'), async (req, res) => {
    const d = validar(z.object({ activo: z.boolean(), desactivar_acceso: z.boolean().default(true) }), req.body);
    res.json({ success: true, data: await cambiarEstadoColaborador(ctx, taller(req), actorDe(req), idDe(req), d.activo, { desactivarAcceso: d.desactivar_acceso }) });
  });

  // Credenciales de un colaborador
  const esquemaCred = z.object({ numero: opcionalNulo(60), vence: fechaIso.nullable().optional(), notas: opcionalNulo(300) });
  router.post('/colaboradores/:id/credenciales', exigirPermiso('colaboradores.editar'), async (req, res) => {
    const d = validar(esquemaCred.extend({ tipo_credencial_id: z.number().int().positive() }), req.body);
    res.status(201).json({ success: true, data: await crearCredencial(ctx, taller(req), actorDe(req), idDe(req), d) });
  });
  router.patch('/colaboradores/:id/credenciales/:credencialId', exigirPermiso('colaboradores.editar'), async (req, res) => {
    const d = validar(esquemaCred.extend({ activo: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarCredencial(ctx, taller(req), actorDe(req), idDe(req), idDe(req, 'credencialId'), d) });
  });

  // ── Jornada y ausencias ────────────────────────────────────────────────────────────
  const esquemaDia = z.object({ dia_semana: z.number().int().min(1).max(7), desde: hora, hasta: hora, pausa_desde: hora.nullable().optional(), pausa_hasta: hora.nullable().optional() });
  router.get('/jornada', exigirPermiso('configuracion.ver'), async (req, res) => {
    res.json({ success: true, data: await obtenerJornada(taller(req), null) });
  });
  router.put('/jornada', exigirPermiso('configuracion.editar'), async (req, res) => {
    const d = validar(z.object({ dias: z.array(esquemaDia).max(7) }), req.body);
    res.json({ success: true, data: await guardarJornada(taller(req), actorDe(req), null, d.dias) });
  });
  router.get('/colaboradores/:id/jornada', exigirPermiso('colaboradores.ver'), async (req, res) => {
    res.json({ success: true, data: await jornadaEfectiva(taller(req), idDe(req)) });
  });
  router.put('/colaboradores/:id/jornada', exigirPermiso('colaboradores.editar'), async (req, res) => {
    const id = idDe(req);
    const d = validar(z.object({ dias: z.array(esquemaDia).max(7) }), req.body);
    await guardarJornada(taller(req), actorDe(req), id, d.dias);
    res.json({ success: true, data: await jornadaEfectiva(taller(req), id) });
  });

  router.get('/ausencias', exigirPermiso('colaboradores.ver'), async (req, res) => {
    const f = validar(z.object({ colaborador_id: z.coerce.number().int().positive().optional(), desde: fechaIso.optional(), hasta: fechaIso.optional() }), req.query);
    res.json({ success: true, data: await listarAusencias(taller(req), f) });
  });
  const tipos = z.enum(['vacaciones', 'permiso', 'incapacidad', 'otro']);
  router.post('/ausencias', exigirPermiso('colaboradores.editar'), async (req, res) => {
    const d = validar(z.object({ colaborador_id: z.number().int().positive(), desde: fechaIso, hasta: fechaIso, tipo: tipos, notas: opcionalNulo(300) }), req.body);
    res.status(201).json({ success: true, data: await crearAusencia(taller(req), actorDe(req), d) });
  });
  router.patch('/ausencias/:id', exigirPermiso('colaboradores.editar'), async (req, res) => {
    const d = validar(z.object({ desde: fechaIso.optional(), hasta: fechaIso.optional(), tipo: tipos.optional(), notas: opcionalNulo(300) }), req.body);
    res.json({ success: true, data: await actualizarAusencia(taller(req), actorDe(req), idDe(req), d) });
  });
  router.delete('/ausencias/:id', exigirPermiso('colaboradores.editar'), async (req, res) => {
    await eliminarAusencia(taller(req), actorDe(req), idDe(req));
    res.json({ success: true, data: { mensaje: 'Ausencia eliminada.' } });
  });

  // ── Usuarios (acceso al sistema) ───────────────────────────────────────────────────
  router.post('/colaboradores/:id/acceso', exigirPermiso('usuarios.gestionar'), async (req, res) => {
    const d = validar(z.object({ roles: z.array(z.number().int().positive()).min(1).max(10) }), req.body);
    res.status(201).json({ success: true, data: await darAcceso(ctx, taller(req), actorDe(req), permisosDe(req), idDe(req), d.roles) });
  });
  router.patch('/usuarios/:id', exigirPermiso('usuarios.gestionar'), async (req, res) => {
    const id = idDe(req);
    const d = validar(z.object({ roles: z.array(z.number().int().positive()).min(1).max(10).optional(), activo: z.boolean().optional() }), req.body);
    await actualizarUsuario(ctx, taller(req), actorDe(req), permisosDe(req), id, d);
    res.json({ success: true, data: { mensaje: 'Usuario actualizado.' } });
  });
  router.post('/usuarios/:id/enlace', exigirPermiso('usuarios.gestionar'), async (req, res) => {
    res.json({ success: true, data: await reenviarEnlace(ctx, taller(req), actorDe(req), idDe(req)) });
  });
  router.post('/usuarios/:id/revocar-sesiones', exigirPermiso('usuarios.gestionar'), async (req, res) => {
    res.json({ success: true, data: await revocarSesiones(ctx, taller(req), actorDe(req), idDe(req)) });
  });

  // ── Roles y permisos ───────────────────────────────────────────────────────────────
  router.get('/roles', exigirPermiso('roles.ver'), async (req, res) => {
    res.json({ success: true, data: await listarRoles(taller(req)) });
  });
  router.get('/permisos', exigirPermiso('roles.ver'), async (req, res) => {
    res.json({ success: true, data: await listarPermisos(taller(req)) });
  });
  router.get('/roles/:id', exigirPermiso('roles.ver'), async (req, res) => {
    res.json({ success: true, data: await obtenerRol(taller(req), idDe(req)) });
  });
  router.post('/roles', exigirPermiso('roles.gestionar'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(60).min(2), descripcion: opcionalNulo(200), permisos: z.array(texto(60)).max(100).optional(), copiar_de: z.number().int().positive().optional() }), req.body);
    res.status(201).json({ success: true, data: await crearRol(taller(req), actorDe(req), permisosDe(req), d) });
  });
  router.patch('/roles/:id', exigirPermiso('roles.gestionar'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(60).min(2).optional(), descripcion: opcionalNulo(200), activo: z.boolean().optional(), permisos: z.array(texto(60)).max(100).optional() }), req.body);
    res.json({ success: true, data: await actualizarRol(taller(req), actorDe(req), permisosDe(req), idDe(req), d) });
  });

  // ── Configuración y bitácora ───────────────────────────────────────────────────────
  router.get('/configuracion', exigirPermiso('configuracion.ver'), async (req, res) => {
    res.json({ success: true, data: { valores: await leerConfiguracion(taller(req)), claves: metadatosDeConfiguracion() } });
  });
  router.patch('/configuracion', exigirPermiso('configuracion.editar'), async (req, res) => {
    const cambios = validar(z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])), req.body);
    res.json({ success: true, data: { valores: await guardarConfiguracion(ctx, taller(req), actorDe(req), cambios), claves: metadatosDeConfiguracion() } });
  });
  router.get('/bitacora', exigirPermiso('bitacora.ver'), async (req, res) => {
    const f = validar(z.object({ pagina: z.coerce.number().int().min(1).default(1), accion: texto(60).optional(), entidad: texto(60).optional(), usuario_id: z.coerce.number().int().positive().optional() }), req.query);
    res.json({ success: true, data: await listarBitacora(taller(req), { ...f, porPagina: 50 }) });
  });
}
