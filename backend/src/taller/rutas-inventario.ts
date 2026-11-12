import { Request, Router } from 'express';
import { z } from 'zod';
import { Contexto } from '../plataforma/contexto';
import { actorDe, idDe, validar } from './comun';
import {
  actualizarMaterial,
  crearMaterial,
  definirMargen,
  listarCompras,
  listarMargenes,
  listarMateriales,
  listarMovimientos,
  obtenerCompra,
  obtenerMaterial,
  opcionesDeInventario,
  quitarMargen,
  registrarCompra,
  registrarDiferencia,
  trasladar,
  Vista,
} from './inventario';
import { hoyDelTaller } from './contadores';
import { reservadoTotal } from './reservas-nucleo';
import { exigirPermiso } from './sesion';

const texto = (max: number) => z.string().trim().max(max);
const nulo = (max: number) => texto(max).nullable().optional();
const idPositivo = z.number().int().positive();
const entero = z.number().int();
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const booleanoDeConsulta = z.enum(['true', 'false']).optional();

const vistaDe = (req: Request): Vista => ({ costos: req.sesionTaller!.permisos.has('inventario.ver_costos') });

/** Inventario: materiales, existencias por bodega, compras, traslados, diferencias y márgenes (módulo «inventario»). */
export function montarRutasInventario(router: Router, ctx: Contexto): void {
  const taller = (req: Request) => req.taller!;
  const ver = exigirPermiso('inventario.ver');
  const verCostos = exigirPermiso('inventario.ver_costos');
  const catalogo = exigirPermiso('inventario.catalogo');

  router.get('/inventario-opciones', ver, async (req, res) => {
    res.json({ success: true, data: await opcionesDeInventario(taller(req)) });
  });

  // ── Materiales ────────────────────────────────────────────────────────────────────
  const camposMaterial = {
    nombre: texto(200).min(2).optional(),
    descripcion: nulo(500),
    parte_id: idPositivo.optional(),
    marca_id: idPositivo.nullable().optional(),
    codigo_oem: nulo(60),
    unidad_id: idPositivo.optional(),
    existencia_minima: entero.min(0).max(10_000_000).optional(),
    ubicacion: nulo(60),
    precio_manual: z.number().min(0).max(99_999_999).nullable().optional(),
    proveedor_principal_id: idPositivo.nullable().optional(),
  };
  router.get('/materiales', ver, async (req, res) => {
    const f = validar(
      z.object({
        buscar: texto(100).optional(),
        parte_id: z.coerce.number().int().positive().optional(),
        sistema_id: z.coerce.number().int().positive().optional(),
        bajo_minimo: booleanoDeConsulta,
        inactivos: booleanoDeConsulta,
        pagina: z.coerce.number().int().min(1).default(1),
      }),
      req.query
    );
    res.json({ success: true, data: await listarMateriales(taller(req), vistaDe(req), { ...f, bajo_minimo: f.bajo_minimo === 'true', inactivos: f.inactivos === 'true', porPagina: 50 }) });
  });
  router.get('/materiales/:id', ver, async (req, res) => {
    const m = await obtenerMaterial(taller(req), idDe(req), vistaDe(req));
    res.json({ success: true, data: { ...m, reservado: await reservadoTotal(taller(req).pool, idDe(req), hoyDelTaller(ctx, taller(req))) } });
  });
  router.post('/materiales', catalogo, async (req, res) => {
    const d = validar(z.object({ ...camposMaterial, codigo: texto(30).min(1), nombre: texto(200).min(2), parte_id: idPositivo, unidad_id: idPositivo }), req.body);
    res.status(201).json({ success: true, data: await crearMaterial(taller(req), actorDe(req), vistaDe(req), d) });
  });
  router.patch('/materiales/:id', catalogo, async (req, res) => {
    const d = validar(z.object({ ...camposMaterial, codigo: texto(30).optional(), activo: z.boolean().optional() }), req.body);
    res.json({ success: true, data: await actualizarMaterial(taller(req), actorDe(req), vistaDe(req), idDe(req), d) });
  });

  // ── Márgenes ──────────────────────────────────────────────────────────────────────
  router.get('/margenes', verCostos, async (req, res) => {
    res.json({ success: true, data: await listarMargenes(taller(req)) });
  });
  router.put('/margenes/:nivel/:referenciaId', catalogo, verCostos, async (req, res) => {
    const nivel = validar(z.enum(['sistema', 'subsistema', 'parte', 'material']), req.params['nivel']);
    const d = validar(z.object({ porcentaje: z.number().min(0).max(1000) }), req.body);
    res.json({ success: true, data: await definirMargen(taller(req), actorDe(req), { nivel, referencia_id: idDe(req, 'referenciaId'), porcentaje: d.porcentaje }) });
  });
  router.delete('/margenes/:nivel/:referenciaId', catalogo, verCostos, async (req, res) => {
    const nivel = validar(z.enum(['sistema', 'subsistema', 'parte', 'material']), req.params['nivel']);
    res.json({ success: true, data: await quitarMargen(taller(req), actorDe(req), nivel, idDe(req, 'referenciaId')) });
  });

  // ── Compras, traslados y diferencias ──────────────────────────────────────────────
  router.get('/compras', ver, async (req, res) => {
    const f = validar(z.object({ buscar: texto(100).optional(), proveedor_id: z.coerce.number().int().positive().optional(), pagina: z.coerce.number().int().min(1).default(1) }), req.query);
    res.json({ success: true, data: await listarCompras(taller(req), { ...f, porPagina: 50 }) });
  });
  router.get('/compras/:id', ver, async (req, res) => {
    res.json({ success: true, data: await obtenerCompra(taller(req), idDe(req)) });
  });
  router.post('/compras', exigirPermiso('inventario.recibir'), async (req, res) => {
    const d = validar(
      z.object({
        proveedor_id: idPositivo,
        bodega_id: idPositivo,
        fecha_documento: fecha,
        numero_factura: nulo(40),
        notas: nulo(300),
        lineas: z.array(z.object({ material_id: idPositivo, cantidad: entero.positive().max(100_000_000), costo_unitario: z.number().min(0).max(99_999_999) })).min(1).max(200),
      }),
      req.body
    );
    res.status(201).json({ success: true, data: await registrarCompra(ctx, taller(req), actorDe(req), d) });
  });
  router.post('/inventario/traslados', exigirPermiso('inventario.trasladar'), async (req, res) => {
    const d = validar(z.object({ material_id: idPositivo, bodega_origen_id: idPositivo, bodega_destino_id: idPositivo, cantidad: entero.positive().max(100_000_000), notas: nulo(300) }), req.body);
    await trasladar(ctx, taller(req), actorDe(req), d);
    res.status(201).json({ success: true, data: await obtenerMaterial(taller(req), d.material_id, vistaDe(req)) });
  });
  router.post('/inventario/diferencias', exigirPermiso('inventario.diferencias'), async (req, res) => {
    const d = validar(z.object({ material_id: idPositivo, bodega_id: idPositivo, cantidad_real: entero.min(0).max(100_000_000), motivo_id: idPositivo, notas: nulo(300) }), req.body);
    const r = await registrarDiferencia(ctx, taller(req), actorDe(req), d);
    res.status(201).json({ success: true, data: { ...r, material: await obtenerMaterial(taller(req), d.material_id, vistaDe(req)) } });
  });

  router.get('/inventario/movimientos', ver, async (req, res) => {
    const f = validar(
      z.object({
        material_id: z.coerce.number().int().positive().optional(),
        bodega_id: z.coerce.number().int().positive().optional(),
        tipo: z.enum(['compra', 'despacho', 'devolucion', 'traslado_salida', 'traslado_entrada', 'diferencia']).optional(),
        pagina: z.coerce.number().int().min(1).default(1),
      }),
      req.query
    );
    res.json({ success: true, data: await listarMovimientos(taller(req), vistaDe(req), { ...f, porPagina: 50 }) });
  });
}
