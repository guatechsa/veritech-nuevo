import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { crearCatalogo, esquemaCatalogo } from './catalogos';
import { TIPOS_CLIENTE } from './catalogos-trabajo';
import {
  actualizarCliente,
  actualizarContacto,
  actualizarDepartamento,
  actualizarProveedor,
  cambiarEstadoCliente,
  crearCliente,
  crearContacto,
  crearDepartamento,
  crearProveedor,
  eliminarCliente,
  listarClientes,
  listarProveedores,
  obtenerCliente,
  obtenerProveedor,
} from './clientes';
import { actorDe, idDe, validar } from './comun';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const nulo = (max: number) => texto(max).nullable().optional();
const condicion = z.enum(['contado', 'credito']);
const booleanoDeConsulta = z.enum(['true', 'false']).optional();

/** Clientes, sus departamentos y contactos, tipos de cliente y proveedores (módulo «clientes»). */
export function montarRutasClientes(router: Router, _ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;

  // ── Tipos de cliente ───────────────────────────────────────────────────────────────
  const tipos = crearCatalogo(TIPOS_CLIENTE);
  router.get('/tipos-cliente', exigirPermiso('clientes.ver'), async (req, res) => {
    res.json({ success: true, data: await tipos.listar(taller(req), req.query['inactivos'] === 'true') });
  });
  router.post('/tipos-cliente', exigirPermiso('configuracion.editar'), async (req, res) => {
    res.status(201).json({ success: true, data: await tipos.crear(taller(req), actorDe(req), validar(esquemaCatalogo(TIPOS_CLIENTE, false), req.body) as Record<string, unknown>) });
  });
  router.patch('/tipos-cliente/:id', exigirPermiso('configuracion.editar'), async (req, res) => {
    res.json({ success: true, data: await tipos.actualizar(taller(req), actorDe(req), idDe(req), validar(esquemaCatalogo(TIPOS_CLIENTE, true), req.body) as Record<string, unknown>) });
  });

  // ── Clientes ───────────────────────────────────────────────────────────────────────
  const camposCliente = {
    nit: nulo(30),
    contacto_nombre: nulo(120),
    contacto_email: z.string().trim().email().max(150).nullable().optional(),
    contacto_telefono: nulo(40),
    telefono: nulo(40),
    email: z.string().trim().email().max(150).nullable().optional(),
    direccion: nulo(250),
    condicion_pago: condicion.optional(),
    dias_credito: z.number().int().min(0).max(365).optional(),
    limite_credito: z.number().min(0).max(100_000_000).optional(),
    notas: nulo(500),
    tipo_cliente_id: z.number().int().positive().nullable().optional(),
  };
  router.get('/clientes', exigirPermiso('clientes.ver'), async (req, res) => {
    const f = validar(z.object({ buscar: texto(100).optional(), activo: booleanoDeConsulta, tipo_cliente_id: z.coerce.number().int().positive().optional(), pagina: z.coerce.number().int().min(1).default(1) }), req.query);
    res.json({ success: true, data: await listarClientes(taller(req), { buscar: f.buscar, activo: f.activo === undefined ? undefined : f.activo === 'true', tipo_cliente_id: f.tipo_cliente_id, pagina: f.pagina, porPagina: 50 }) });
  });
  router.get('/clientes/:id', exigirPermiso('clientes.ver'), async (req, res) => {
    res.json({ success: true, data: await obtenerCliente(taller(req), idDe(req)) });
  });
  router.post('/clientes', exigirPermiso('clientes.crear'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(150).min(2), ...camposCliente }), req.body);
    res.status(201).json({ success: true, data: await crearCliente(taller(req), actorDe(req), d) });
  });
  router.patch('/clientes/:id', exigirPermiso('clientes.editar'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(150).min(2).optional(), ...camposCliente }), req.body);
    res.json({ success: true, data: await actualizarCliente(taller(req), actorDe(req), idDe(req), d) });
  });
  router.post('/clientes/:id/estado', exigirPermiso('clientes.desactivar'), async (req, res) => {
    const d = validar(z.object({ activo: z.boolean() }), req.body);
    res.json({ success: true, data: await cambiarEstadoCliente(taller(req), actorDe(req), idDe(req), d.activo) });
  });
  router.delete('/clientes/:id', exigirPermiso('clientes.desactivar'), async (req, res) => {
    await eliminarCliente(taller(req), actorDe(req), idDe(req));
    res.json({ success: true, data: { mensaje: 'Cliente eliminado.' } });
  });

  // Departamentos (siempre dentro de su cliente)
  router.post('/clientes/:id/departamentos', exigirPermiso('clientes.editar'), async (req, res) => {
    res.status(201).json({ success: true, data: await crearDepartamento(taller(req), actorDe(req), idDe(req), validar(z.object({ nombre: texto(100).min(1) }), req.body)) });
  });
  router.patch('/clientes/:id/departamentos/:depId', exigirPermiso('clientes.editar'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(100).min(1).optional(), activo: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarDepartamento(taller(req), actorDe(req), idDe(req), idDe(req, 'depId'), d) });
  });

  // Contactos
  const camposContacto = { correo: z.string().trim().email().max(150).nullable().optional(), telefono: nulo(40), rol: z.enum(['aprobador', 'consulta', 'piloto']).optional(), acceso_todos_equipos: z.boolean().optional() };
  router.post('/clientes/:id/contactos', exigirPermiso('clientes.editar'), async (req, res) => {
    res.status(201).json({ success: true, data: await crearContacto(taller(req), actorDe(req), idDe(req), validar(z.object({ nombre: texto(120).min(1), ...camposContacto }), req.body)) });
  });
  router.patch('/clientes/:id/contactos/:contactoId', exigirPermiso('clientes.editar'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(120).min(1).optional(), activo: z.boolean().optional(), ...camposContacto }), req.body);
    res.json({ success: true, data: await actualizarContacto(taller(req), actorDe(req), idDe(req), idDe(req, 'contactoId'), d) });
  });

  // ── Proveedores ────────────────────────────────────────────────────────────────────
  const camposProveedor = {
    nit: nulo(30),
    contacto_nombre: nulo(120),
    contacto_email: z.string().trim().email().max(150).nullable().optional(),
    contacto_telefono: nulo(40),
    direccion: nulo(250),
    condicion_pago: condicion.optional(),
    dias_credito: z.number().int().min(0).max(365).optional(),
    notas: nulo(500),
  };
  router.get('/proveedores', exigirPermiso('proveedores.ver'), async (req, res) => {
    const f = validar(z.object({ buscar: texto(100).optional(), activo: booleanoDeConsulta, pagina: z.coerce.number().int().min(1).default(1) }), req.query);
    res.json({ success: true, data: await listarProveedores(taller(req), { buscar: f.buscar, activo: f.activo === undefined ? undefined : f.activo === 'true', pagina: f.pagina, porPagina: 50 }) });
  });
  router.get('/proveedores/:id', exigirPermiso('proveedores.ver'), async (req, res) => {
    res.json({ success: true, data: await obtenerProveedor(taller(req), idDe(req)) });
  });
  router.post('/proveedores', exigirPermiso('proveedores.crear'), async (req, res) => {
    res.status(201).json({ success: true, data: await crearProveedor(taller(req), actorDe(req), validar(z.object({ nombre: texto(150).min(2), ...camposProveedor }), req.body)) });
  });
  router.patch('/proveedores/:id', exigirPermiso('proveedores.editar'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(150).min(2).optional(), activo: z.boolean().optional(), ...camposProveedor }), req.body);
    const id = idDe(req);
    // Cambiar el estado exige el permiso de desactivar, aparte del de editar.
    if (d.activo !== undefined && !req.sesionTaller!.permisos.has('proveedores.desactivar')) {
      res.status(403).json({ success: false, codigo: 'SIN_PERMISO', error: 'Su rol no tiene permiso para hacer esto.' });
      return;
    }
    res.json({ success: true, data: await actualizarProveedor(taller(req), actorDe(req), id, d) });
  });
}
