import express, { Request, Router } from 'express';
import { z } from 'zod';
import { transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorValidacion } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { borrarArchivo, guardarArchivo, MAXIMO_BYTES, nombreDeLaPeticion, TIPOS_PERMITIDOS } from './archivos';
import { crearCatalogo, DefCatalogo, esquemaCatalogo } from './catalogos';
import { TIPOS_CONTADOR, TIPOS_DOCUMENTO } from './catalogos-trabajo';
import { actorDe, idDe, validar } from './comun';
import { actualizarContador, adjuntarFotoALectura, anularLectura, crearContador, listarContadores, listarLecturas, registrarLectura } from './contadores';
import {
  actualizarComponente,
  actualizarEquipo,
  actualizarTipoEquipo,
  agregarDocumento,
  agregarFoto,
  agregarNota,
  asignarOperador,
  cambiarEstadoEquipo,
  crearComponente,
  crearEquipo,
  crearTipoEquipo,
  definirComponentesDeTipo,
  definirContactosDeEquipo,
  definirDocumentosDeTipo,
  definirHorasDeTrabajo,
  horasDeTrabajo,
  listarEquipos,
  operadoresDisponibles,
  listarTiposEquipo,
  marcarFotoPrincipal,
  obtenerEquipo,
  obtenerTipoEquipo,
  quitarDocumento,
  quitarFoto,
  quitarOperador,
} from './equipos';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const nulo = (max: number) => texto(max).nullable().optional();
const idPositivo = z.number().int().positive();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const booleanoDeConsulta = z.enum(['true', 'false']).optional();

/** Cuerpo crudo de una foto o un PDF (el nombre viaja en la cabecera X-Nombre-Archivo). */
const cuerpoDeArchivo = express.raw({ type: [...TIPOS_PERMITIDOS], limit: MAXIMO_BYTES });

function archivoDe(req: Request): { buffer: Buffer; mime: string; nombre: string } {
  if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ErrorValidacion('Envíe una foto (JPG, PNG, WEBP) o un PDF');
  const mime = (req.headers['content-type'] ?? '').split(';')[0]?.trim() ?? '';
  return { buffer: req.body, mime, nombre: nombreDeLaPeticion(req) };
}

/** Equipos, tipos de equipo, contadores y lecturas (módulo «equipos»). */
export function montarRutasEquipos(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const verTipos = exigirPermiso('tipos_equipo.ver');
  const gestionarTipos = exigirPermiso('tipos_equipo.gestionar');

  // ── Catálogos que cuelgan de los equipos ───────────────────────────────────────────
  function simple(ruta: string, def: DefCatalogo): void {
    const cat = crearCatalogo(def);
    router.get(`/${ruta}`, verTipos, async (req, res) => {
      res.json({ success: true, data: await cat.listar(taller(req), req.query['inactivos'] === 'true') });
    });
    router.post(`/${ruta}`, gestionarTipos, async (req, res) => {
      res.status(201).json({ success: true, data: await cat.crear(taller(req), actorDe(req), validar(esquemaCatalogo(def, false), req.body) as Record<string, unknown>) });
    });
    router.patch(`/${ruta}/:id`, gestionarTipos, async (req, res) => {
      res.json({ success: true, data: await cat.actualizar(taller(req), actorDe(req), idDe(req), validar(esquemaCatalogo(def, true), req.body) as Record<string, unknown>) });
    });
  }
  simple('tipos-contador', TIPOS_CONTADOR);
  simple('tipos-documento', TIPOS_DOCUMENTO);

  // ── Tipos de equipo ────────────────────────────────────────────────────────────────
  const camposTipo = {
    es_vehiculo: z.boolean(),
    usa_combustible: z.boolean(),
    tarifa_venta_hora: z.number().min(0).max(1_000_000),
    costo_hora: z.number().min(0).max(1_000_000),
    tolerancia_dias: z.number().int().min(0).max(3650),
    tolerancia_contador: z.number().min(0).max(1_000_000),
    tiene_componentes: z.boolean(),
  };
  router.get('/tipos-equipo', verTipos, async (req, res) => {
    res.json({ success: true, data: await listarTiposEquipo(taller(req), req.query['inactivos'] === 'true') });
  });
  router.get('/tipos-equipo/:id', verTipos, async (req, res) => {
    res.json({ success: true, data: await obtenerTipoEquipo(taller(req).pool, idDe(req)) });
  });
  router.post('/tipos-equipo', gestionarTipos, async (req, res) => {
    const d = validar(z.object({ codigo: texto(20).min(2), nombre: texto(80).min(1), ...camposTipo }).partial({ es_vehiculo: true, usa_combustible: true, tarifa_venta_hora: true, costo_hora: true, tolerancia_dias: true, tolerancia_contador: true, tiene_componentes: true }), req.body);
    res.status(201).json({ success: true, data: await crearTipoEquipo(taller(req), actorDe(req), d) });
  });
  router.patch('/tipos-equipo/:id', gestionarTipos, async (req, res) => {
    const d = validar(z.object({ codigo: texto(20).optional(), nombre: texto(80).min(1).optional(), activo: z.boolean().optional(), ...camposTipo }).partial(), req.body);
    res.json({ success: true, data: await actualizarTipoEquipo(taller(req), actorDe(req), idDe(req), d) });
  });
  router.put('/tipos-equipo/:id/documentos', gestionarTipos, async (req, res) => {
    const d = validar(z.object({ documentos: z.array(z.object({ tipo_documento_id: idPositivo, obligatorio: z.boolean() })).max(50) }), req.body);
    res.json({ success: true, data: await definirDocumentosDeTipo(taller(req), actorDe(req), idDe(req), d.documentos) });
  });
  router.put('/tipos-equipo/:id/componentes', gestionarTipos, async (req, res) => {
    const d = validar(z.object({ componentes: z.array(z.object({ nombre: texto(80).min(1), tipo_contador_id: idPositivo.nullable().optional() })).max(50) }), req.body);
    res.json({ success: true, data: await definirComponentesDeTipo(taller(req), actorDe(req), idDe(req), d.componentes) });
  });

  // Horas de cada trabajo por tipo de equipo
  router.get('/catalogos/trabajos/:id/horas', exigirPermiso('catalogos.ver'), async (req, res) => {
    res.json({ success: true, data: await horasDeTrabajo(taller(req), idDe(req)) });
  });
  router.put('/catalogos/trabajos/:id/horas', exigirPermiso('catalogos.gestionar'), async (req, res) => {
    const d = validar(z.object({ horas: z.array(z.object({ tipo_equipo_id: idPositivo, horas: z.number().nullable() })).max(100) }), req.body);
    res.json({ success: true, data: await definirHorasDeTrabajo(taller(req), actorDe(req), idDe(req), d.horas) });
  });

  // ── Equipos ────────────────────────────────────────────────────────────────────────
  const camposEquipo = {
    codigo_interno: nulo(40),
    placa: nulo(20),
    serie: nulo(60),
    marca_id: idPositivo.nullable().optional(),
    modelo: nulo(80),
    anio: z.number().int().nullable().optional(),
    color: nulo(40),
    motor_marca: nulo(60),
    motor_modelo: nulo(60),
    motor_serie: nulo(60),
    combustible: nulo(30),
    capacidad_tanque: z.number().nullable().optional(),
    cliente_id: idPositivo.nullable().optional(),
    departamento_id: idPositivo.nullable().optional(),
    propiedad: z.enum(['propio', 'cliente']).optional(),
    notas: nulo(500),
  };
  const ver = exigirPermiso('equipos.ver');
  const editar = exigirPermiso('equipos.editar');

  router.get('/equipos', ver, async (req, res) => {
    const f = validar(
      z.object({
        buscar: texto(100).optional(),
        cliente_id: z.coerce.number().int().positive().optional(),
        tipo_equipo_id: z.coerce.number().int().positive().optional(),
        estado: z.enum(['activo', 'fuera_de_servicio', 'baja']).optional(),
        propiedad: z.enum(['propio', 'cliente']).optional(),
        pagina: z.coerce.number().int().min(1).default(1),
      }),
      req.query
    );
    res.json({ success: true, data: await listarEquipos(taller(req), { ...f, porPagina: 50 }) });
  });
  router.get('/equipos/operadores-disponibles', editar, async (req, res) => {
    res.json({ success: true, data: await operadoresDisponibles(taller(req)) });
  });
  router.get('/equipos/:id', ver, async (req, res) => {
    res.json({ success: true, data: await obtenerEquipo(ctx, taller(req), idDe(req)) });
  });
  router.post('/equipos', exigirPermiso('equipos.crear'), async (req, res) => {
    const d = validar(
      z.object({
        tipo_equipo_id: idPositivo,
        ...camposEquipo,
        contadores: z.array(z.object({ tipo_contador_id: idPositivo, valor_inicial: z.number().min(0).max(100_000_000).optional(), fecha_inicio: fecha.optional() })).max(20).optional(),
      }),
      req.body
    );
    res.status(201).json({ success: true, data: await crearEquipo(ctx, taller(req), actorDe(req), d) });
  });
  router.patch('/equipos/:id', editar, async (req, res) => {
    const d = validar(z.object({ tipo_equipo_id: idPositivo.optional(), ...camposEquipo }), req.body);
    res.json({ success: true, data: await actualizarEquipo(ctx, taller(req), actorDe(req), idDe(req), d) });
  });
  router.post('/equipos/:id/estado', exigirPermiso('equipos.desactivar'), async (req, res) => {
    const d = validar(z.object({ estado: z.enum(['activo', 'fuera_de_servicio', 'baja']), motivo: nulo(300) }), req.body);
    res.json({ success: true, data: await cambiarEstadoEquipo(ctx, taller(req), actorDe(req), idDe(req), d.estado, d.motivo) });
  });
  router.put('/equipos/:id/contactos', editar, async (req, res) => {
    const d = validar(z.object({ contactos: z.array(idPositivo).max(100) }), req.body);
    res.json({ success: true, data: await definirContactosDeEquipo(ctx, taller(req), actorDe(req), idDe(req), d.contactos) });
  });

  // Fotos (cuerpo crudo: la foto llega ya reducida desde la pantalla)
  router.post('/equipos/:id/fotos', editar, cuerpoDeArchivo, async (req, res) => {
    const q = validar(z.object({ descripcion: texto(150).optional(), principal: booleanoDeConsulta }), req.query);
    const a = archivoDe(req);
    res.status(201).json({ success: true, data: await agregarFoto(ctx, taller(req), actorDe(req), idDe(req), { ...a, descripcion: q.descripcion, es_principal: q.principal === 'true' }) });
  });
  router.post('/equipos/:id/fotos/:fotoId/principal', editar, async (req, res) => {
    res.json({ success: true, data: await marcarFotoPrincipal(ctx, taller(req), actorDe(req), idDe(req), idDe(req, 'fotoId')) });
  });
  router.delete('/equipos/:id/fotos/:fotoId', editar, async (req, res) => {
    res.json({ success: true, data: await quitarFoto(ctx, taller(req), actorDe(req), idDe(req), idDe(req, 'fotoId')) });
  });

  // Documentos: con archivo (cuerpo crudo y datos en la dirección) o sin archivo (JSON)
  router.post('/equipos/:id/documentos', editar, cuerpoDeArchivo, async (req, res) => {
    const conArchivo = Buffer.isBuffer(req.body);
    const fuente = conArchivo ? req.query : req.body;
    const d = validar(z.object({ tipo_documento_id: z.coerce.number().int().positive(), nombre: texto(150).nullable().optional(), vence: fecha.nullable().optional() }), fuente);
    res.status(201).json({ success: true, data: await agregarDocumento(ctx, taller(req), actorDe(req), idDe(req), d, conArchivo ? archivoDe(req) : undefined) });
  });
  router.delete('/equipos/:id/documentos/:docId', editar, async (req, res) => {
    res.json({ success: true, data: await quitarDocumento(ctx, taller(req), actorDe(req), idDe(req), idDe(req, 'docId')) });
  });

  router.post('/equipos/:id/notas', editar, async (req, res) => {
    const d = validar(z.object({ nota: texto(1000).min(1), es_importante: z.boolean().optional() }), req.body);
    res.status(201).json({ success: true, data: await agregarNota(ctx, taller(req), actorDe(req), idDe(req), d) });
  });

  router.post('/equipos/:id/operadores', editar, async (req, res) => {
    const d = validar(z.object({ colaborador_id: idPositivo, desde: fecha.optional() }), req.body);
    res.status(201).json({ success: true, data: await asignarOperador(ctx, taller(req), actorDe(req), idDe(req), d) });
  });
  router.delete('/equipos/:id/operadores/:asignacionId', editar, async (req, res) => {
    res.json({ success: true, data: await quitarOperador(ctx, taller(req), actorDe(req), idDe(req), idDe(req, 'asignacionId')) });
  });

  router.post('/equipos/:id/componentes', editar, async (req, res) => {
    const d = validar(z.object({ nombre: texto(80).min(1) }), req.body);
    res.status(201).json({ success: true, data: await crearComponente(ctx, taller(req), actorDe(req), idDe(req), d.nombre) });
  });
  router.patch('/equipos/:id/componentes/:componenteId', editar, async (req, res) => {
    const d = validar(z.object({ nombre: texto(80).min(1).optional(), activo: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarComponente(ctx, taller(req), actorDe(req), idDe(req), idDe(req, 'componenteId'), d) });
  });

  // ── Contadores y lecturas ──────────────────────────────────────────────────────────
  const verContadores = exigirPermiso('contadores.ver');
  router.get('/equipos/:id/contadores', verContadores, async (req, res) => {
    const id = idDe(req);
    if (!(await una(taller(req).pool, 'SELECT id FROM equipos WHERE id = ?', [id]))) throw new ErrorApp(404, 'NO_ENCONTRADO', 'No se encontró el equipo');
    res.json({ success: true, data: await listarContadores(ctx, taller(req), id) });
  });
  router.post('/equipos/:id/contadores', exigirPermiso('contadores.gestionar'), async (req, res) => {
    const d = validar(
      z.object({ tipo_contador_id: idPositivo, componente_id: idPositivo.nullable().optional(), nombre: nulo(80), valor_inicial: z.number().min(0).max(100_000_000).optional(), fecha_inicio: fecha.optional(), es_principal: z.boolean().optional() }),
      req.body
    );
    res.status(201).json({ success: true, data: await crearContador(ctx, taller(req), actorDe(req), idDe(req), d) });
  });
  router.patch('/contadores/:id', exigirPermiso('contadores.gestionar'), async (req, res) => {
    const d = validar(z.object({ nombre: texto(80).min(1).optional(), activo: z.boolean().optional(), es_principal: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarContador(ctx, taller(req), actorDe(req), idDe(req), d) });
  });
  router.get('/contadores/:id/lecturas', verContadores, async (req, res) => {
    res.json({ success: true, data: await listarLecturas(ctx, taller(req), idDe(req)) });
  });
  router.post('/contadores/:id/lecturas', exigirPermiso('contadores.registrar'), async (req, res) => {
    const d = validar(z.object({ valor: z.number().min(0).max(100_000_000), fecha: fecha.optional(), notas: nulo(300) }), req.body);
    res.status(201).json({ success: true, data: await registrarLectura(ctx, taller(req), actorDe(req), idDe(req), d) });
  });
  router.post('/lecturas/:id/anular', exigirPermiso('contadores.anular'), async (req, res) => {
    const d = validar(z.object({ motivo: texto(300).min(3) }), req.body);
    res.json({ success: true, data: await anularLectura(ctx, taller(req), actorDe(req), idDe(req), d.motivo) });
  });
  /** La foto del tablero se sube después de registrar la lectura (una sola vez por lectura). */
  router.post('/lecturas/:id/foto', exigirPermiso('contadores.registrar'), cuerpoDeArchivo, async (req, res) => {
    const t = taller(req);
    const actor = actorDe(req);
    const id = idDe(req);
    const a = archivoDe(req);
    if (!a.mime.startsWith('image/')) throw new ErrorValidacion('La foto del tablero debe ser una imagen');
    if (!(await una(t.pool, 'SELECT id FROM lecturas_contador WHERE id = ? AND archivo_id IS NULL', [id]))) throw new ErrorApp(409, 'REGLA', 'Esa lectura no existe o ya tiene foto.');
    const archivo = await guardarArchivo(ctx, t, t.pool, actor, a);
    try {
      await transaccion(t.pool, (con) => adjuntarFotoALectura(con, id, archivo.id));
    } catch (error) {
      await borrarArchivo(ctx, t, t.pool, archivo.id);
      throw error;
    }
    const l = await una<{ contador_id: number }>(t.pool, 'SELECT contador_id FROM lecturas_contador WHERE id = ?', [id]);
    res.json({ success: true, data: await listarLecturas(ctx, t, Number(l?.contador_id)) });
  });
}
