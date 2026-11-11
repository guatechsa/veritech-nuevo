import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { crearCatalogo, DefCatalogo, esquemaCatalogo } from './catalogos';
import {
  ACCIONES,
  actualizarEstadoOrden,
  actualizarParte,
  actualizarSistema,
  actualizarSubsistema,
  actualizarTipoOrden,
  actualizarTrabajo,
  alRenombrarAccion,
  cambiarMatriz,
  crearEstadoOrden,
  crearParte,
  crearSistema,
  crearSubsistema,
  crearTipoOrden,
  crearTrabajo,
  ETAPAS,
  leerMatriz,
  listarEstadosOrden,
  listarPartes,
  listarSistemas,
  listarSubsistemas,
  listarTiposOrden,
  listarTrabajos,
  MARCAS,
  MOTIVOS,
  UNIDADES,
} from './catalogos-trabajo';
import { actorDe, idDe, validar } from './comun';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const verInactivos = (req: Request): boolean => validar(z.object({ inactivos: z.enum(['true', 'false']).optional() }), req.query).inactivos === 'true';
const idOpcional = z.coerce.number().int().positive().optional();

/** Catálogos de trabajo (módulo «ordenes»): jerarquía técnica, trabajos, acciones, unidades, marcas, tipos y estados de orden, etapas y motivos. */
export function montarRutasCatalogos(router: Router, _ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('catalogos.ver');
  const gestionar = exigirPermiso('catalogos.gestionar');

  // ── Jerarquía ──────────────────────────────────────────────────────────────────────
  router.get('/catalogos/sistemas', ver, async (req, res) => {
    res.json({ success: true, data: await listarSistemas(taller(req), verInactivos(req)) });
  });
  const flags = { es_servicios_programados: z.boolean().optional(), es_insumos_generales: z.boolean().optional() };
  router.post('/catalogos/sistemas', gestionar, async (req, res) => {
    res.status(201).json({ success: true, data: await crearSistema(taller(req), actorDe(req), validar(z.object({ nombre: texto(100).min(1), ...flags }), req.body)) });
  });
  router.patch('/catalogos/sistemas/:id', gestionar, async (req, res) => {
    res.json({ success: true, data: await actualizarSistema(taller(req), actorDe(req), idDe(req), validar(z.object({ nombre: texto(100).min(1).optional(), activo: z.boolean().optional(), ...flags }), req.body)) });
  });

  router.get('/catalogos/subsistemas', ver, async (req, res) => {
    const f = validar(z.object({ sistema_id: idOpcional }), req.query);
    res.json({ success: true, data: await listarSubsistemas(taller(req), { sistema_id: f.sistema_id, inactivos: verInactivos(req) }) });
  });
  router.post('/catalogos/subsistemas', gestionar, async (req, res) => {
    res.status(201).json({ success: true, data: await crearSubsistema(taller(req), actorDe(req), validar(z.object({ sistema_id: z.number().int().positive(), nombre: texto(100).min(1) }), req.body)) });
  });
  router.patch('/catalogos/subsistemas/:id', gestionar, async (req, res) => {
    res.json({ success: true, data: await actualizarSubsistema(taller(req), actorDe(req), idDe(req), validar(z.object({ nombre: texto(100).min(1).optional(), activo: z.boolean().optional() }), req.body)) });
  });

  router.get('/catalogos/partes', ver, async (req, res) => {
    const f = validar(z.object({ subsistema_id: idOpcional, sistema_id: idOpcional }), req.query);
    res.json({ success: true, data: await listarPartes(taller(req), { ...f, inactivos: verInactivos(req) }) });
  });
  router.post('/catalogos/partes', gestionar, async (req, res) => {
    res.status(201).json({ success: true, data: await crearParte(taller(req), actorDe(req), validar(z.object({ subsistema_id: z.number().int().positive(), nombre: texto(100).min(1) }), req.body)) });
  });
  router.patch('/catalogos/partes/:id', gestionar, async (req, res) => {
    res.json({ success: true, data: await actualizarParte(taller(req), actorDe(req), idDe(req), validar(z.object({ nombre: texto(100).min(1).optional(), activo: z.boolean().optional() }), req.body)) });
  });

  router.get('/catalogos/trabajos', ver, async (req, res) => {
    const f = validar(
      z.object({ buscar: texto(100).optional(), sistema_id: idOpcional, subsistema_id: idOpcional, parte_id: idOpcional, accion_id: idOpcional, area_trabajo_id: idOpcional, pagina: z.coerce.number().int().min(1).default(1) }),
      req.query
    );
    res.json({ success: true, data: await listarTrabajos(taller(req), { ...f, inactivos: verInactivos(req), porPagina: 50 }) });
  });
  router.post('/catalogos/trabajos', gestionar, async (req, res) => {
    const d = validar(z.object({ parte_id: z.number().int().positive(), accion_id: z.number().int().positive(), variante: texto(100).nullable().optional(), area_trabajo_id: z.number().int().positive().nullable().optional() }), req.body);
    res.status(201).json({ success: true, data: await crearTrabajo(taller(req), actorDe(req), d) });
  });
  router.patch('/catalogos/trabajos/:id', gestionar, async (req, res) => {
    const d = validar(z.object({ variante: texto(100).nullable().optional(), area_trabajo_id: z.number().int().positive().nullable().optional(), activo: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarTrabajo(taller(req), actorDe(req), idDe(req), d) });
  });

  // ── Catálogos simples con el mismo motor ───────────────────────────────────────────
  function simple(ruta: string, def: DefCatalogo, alEditar?: (id: number, req: Request) => Promise<void>): void {
    const cat = crearCatalogo(def);
    router.get(`/catalogos/${ruta}`, ver, async (req, res) => {
      res.json({ success: true, data: await cat.listar(taller(req), verInactivos(req)) });
    });
    router.post(`/catalogos/${ruta}`, gestionar, async (req, res) => {
      res.status(201).json({ success: true, data: await cat.crear(taller(req), actorDe(req), validar(esquemaCatalogo(def, false), req.body) as Record<string, unknown>) });
    });
    router.patch(`/catalogos/${ruta}/:id`, gestionar, async (req, res) => {
      const id = idDe(req);
      const r = await cat.actualizar(taller(req), actorDe(req), id, validar(esquemaCatalogo(def, true), req.body) as Record<string, unknown>);
      if (alEditar) await alEditar(id, req);
      res.json({ success: true, data: r });
    });
  }
  simple('acciones', ACCIONES, (id, req) => alRenombrarAccion(taller(req), id));
  simple('unidades', UNIDADES);
  simple('marcas', MARCAS);
  simple('motivos', MOTIVOS);
  simple('etapas', ETAPAS);

  // ── Tipos y estados de orden ───────────────────────────────────────────────────────
  router.get('/catalogos/tipos-orden', ver, async (req, res) => {
    res.json({ success: true, data: await listarTiposOrden(taller(req), verInactivos(req)) });
  });
  router.post('/catalogos/tipos-orden', gestionar, async (req, res) => {
    res.status(201).json({ success: true, data: await crearTipoOrden(taller(req), actorDe(req), validar(z.object({ codigo: texto(3).min(3), nombre: texto(60).min(1), es_pedido_especial: z.boolean().optional() }), req.body)) });
  });
  router.patch('/catalogos/tipos-orden/:id', gestionar, async (req, res) => {
    const d = validar(z.object({ nombre: texto(60).min(1).optional(), es_pedido_especial: z.boolean().optional(), es_default: z.boolean().optional(), activo: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarTipoOrden(taller(req), actorDe(req), idDe(req), d) });
  });

  const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
  router.get('/catalogos/estados-orden', ver, async (req, res) => {
    res.json({ success: true, data: await listarEstadosOrden(taller(req), verInactivos(req)) });
  });
  router.post('/catalogos/estados-orden', gestionar, async (req, res) => {
    const d = validar(z.object({ codigo: texto(30).min(2), nombre: texto(60).min(1), orden: z.number().int().min(0).max(1000).optional(), color: color.optional(), es_terminal: z.boolean().optional(), es_cancelado: z.boolean().optional() }), req.body);
    res.status(201).json({ success: true, data: await crearEstadoOrden(taller(req), actorDe(req), d) });
  });
  router.patch('/catalogos/estados-orden/:id', gestionar, async (req, res) => {
    const d = validar(z.object({ nombre: texto(60).min(1).optional(), orden: z.number().int().min(0).max(1000).optional(), color: color.optional(), es_terminal: z.boolean().optional(), es_cancelado: z.boolean().optional(), activo: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarEstadoOrden(taller(req), actorDe(req), idDe(req), d) });
  });

  // ── Matriz nivel de técnico × sistema ──────────────────────────────────────────────
  router.get('/catalogos/matriz-tecnico-sistema', ver, async (req, res) => {
    res.json({ success: true, data: await leerMatriz(taller(req)) });
  });
  router.patch('/catalogos/matriz-tecnico-sistema', gestionar, async (req, res) => {
    const d = validar(z.object({ cambios: z.array(z.object({ nivel_tecnico_id: z.number().int().positive(), sistema_id: z.number().int().positive(), habilitado: z.boolean() })).min(1).max(500) }), req.body);
    await cambiarMatriz(taller(req), actorDe(req), d.cambios);
    res.json({ success: true, data: await leerMatriz(taller(req)) });
  });
}
