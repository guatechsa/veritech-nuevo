import { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Contexto, ahoraDe } from '../plataforma/contexto';
import { localDeUtc } from '../utils/zona';
import { buscar } from './busqueda';
import { actorDe, bitacora, TallerReq, validar } from './comun';
import { leerConfiguracion } from './configuracion';
import { datosDeEmpresa } from './documentos';
import { pdfReporte } from './pdf';
import { armarReporte, defDeReporte, reportesPermitidos } from './reportes-catalogo';
import { actualizarProgramado, borrarVista, crearProgramado, eliminarProgramado, guardarVista, listarProgramados, listarVistas, probarProgramado } from './reportes-guardados';
import { reporteAExcel } from './reportes-salida';
import { ddmmaaaa } from './reportes-tipos';
import { exigirPermiso } from './sesion';

const TIPO_EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const idPositivo = z.coerce.number().int().positive();
const periodo = z.enum(['hoy', 'ultimos_7', 'ultimos_30', 'este_mes', 'mes_anterior', 'personalizado']);

/** Los filtros tal como llegan por la dirección (?periodo=este_mes&sucursal_id=1). */
const filtrosDeConsulta = z.object({ periodo: periodo.default('este_mes'), desde: fecha.optional(), hasta: fecha.optional(), sucursal_id: idPositivo.optional(), tipo_equipo_id: idPositivo.optional() });
/** Los filtros tal como se guardan (en el cuerpo). */
const filtrosDeCuerpo = z.object({ periodo, desde: fecha.optional(), hasta: fecha.optional(), sucursal_id: z.number().int().positive().optional(), tipo_equipo_id: z.number().int().positive().optional() });
const destinatarios = { roles: z.array(z.number().int().positive()).max(30), usuarios: z.array(z.number().int().positive()).max(60), correos: z.array(z.string().max(150)).max(20) };

function descargar(res: Response, nombre: string, mime: string, datos: Buffer): void {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(datos);
}

/** Reportes armados en el servidor (pantalla, Excel y PDF), vistas guardadas, envíos programados y búsqueda global (Fase 7c). */
export function montarRutasInformes(router: Router, ctx: Contexto): void {
  const taller = (req: Request): TallerReq => req.taller!;
  const ver = exigirPermiso('reportes.ver');
  const exportar = exigirPermiso('reportes.exportar');
  const programar = exigirPermiso('reportes.programar');
  const conDinero = (req: Request): boolean => req.sesionTaller!.permisos.has('reportes.financieros');
  const freno = rateLimit({
    windowMs: 10 * 60 * 1000,
    limit: ctx.limites?.descargas ?? 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, codigo: 'DEMASIADAS_DESCARGAS', error: 'Ha pedido demasiadas veces esto en poco tiempo. Espere unos minutos e intente de nuevo.' });
    },
  });

  router.get('/reporte-catalogo', ver, (req, res) => {
    const exportable = req.sesionTaller!.permisos.has('reportes.exportar');
    res.json({ success: true, data: reportesPermitidos(req.sesionTaller!.permisos).map((r) => ({ codigo: r.codigo, titulo: r.titulo, ayuda: r.ayuda, financiero: r.financiero, exportable })) });
  });

  router.get('/reporte/:codigo', ver, async (req, res) => {
    const f = validar(filtrosDeConsulta, req.query);
    res.json({ success: true, data: await armarReporte(ctx, taller(req), String(req.params['codigo']), f, conDinero(req)) });
  });

  router.get('/reporte/:codigo/exportar', ver, exportar, freno, async (req, res) => {
    const q = validar(filtrosDeConsulta.extend({ formato: z.enum(['xlsx', 'pdf']).default('xlsx') }), req.query);
    const t = taller(req);
    const codigo = String(req.params['codigo']);
    const def = defDeReporte(codigo);
    const r = await armarReporte(ctx, t, codigo, q, conDinero(req));
    const cfg = await leerConfiguracion(t);
    const empresa = await datosDeEmpresa(t);
    const moneda = String(cfg['moneda'] ?? 'GTQ');
    const { fecha: dia, hora } = localDeUtc(ahoraDe(ctx), t.empresa.zonaHoraria);
    const emitido = `${ddmmaaaa(dia)} ${hora}`;
    const persona = (await t.pool.query('SELECT c.nombre_completo AS n FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.id = ?', [req.sesionTaller!.usuarioId]))[0] as Array<{ n: string }>;
    const emitidoPor = persona[0]?.n ?? null;
    const base = `${def.codigo}-${r.desde}-a-${r.hasta}`;
    await bitacora(t.pool, actorDe(req), { accion: 'reporte_exportado', entidad: 'reportes', despues: { reporte: codigo, formato: q.formato, desde: r.desde, hasta: r.hasta } });
    if (q.formato === 'pdf') descargar(res, `${base}.pdf`, 'application/pdf', await pdfReporte(r, empresa, { emitido, emitidoPor }, moneda));
    else descargar(res, `${base}.xlsx`, TIPO_EXCEL, await reporteAExcel(r, { empresa: empresa.nombre, emitido, emitidoPor, moneda }));
  });

  // ── Vistas guardadas (de cada persona) ──────────────────────────────────────────────
  router.get('/vistas', ver, async (req, res) => {
    const q = validar(z.object({ reporte: z.string().max(40).optional() }), req.query);
    res.json({ success: true, data: await listarVistas(taller(req), req.sesionTaller!.usuarioId, q.reporte) });
  });
  router.post('/vistas', ver, async (req, res) => {
    const d = validar(z.object({ reporte: z.string().max(40), nombre: z.string().max(80), filtros: filtrosDeCuerpo }), req.body);
    res.status(201).json({ success: true, data: await guardarVista(taller(req), actorDe(req), d) });
  });
  router.delete('/vistas/:id', ver, async (req, res) => {
    res.json({ success: true, data: await borrarVista(taller(req), actorDe(req), Number(req.params['id'])) });
  });

  // ── Envíos programados ─────────────────────────────────────────────────────────────
  const cuerpoProgramado = z.object({
    nombre: z.string().max(80),
    reporte: z.string().max(40),
    filtros: filtrosDeCuerpo,
    frecuencia: z.enum(['diaria', 'semanal', 'mensual']),
    dia_semana: z.number().int().min(1).max(7).nullable().optional(),
    dia_mes: z.number().int().min(1).max(28).nullable().optional(),
    activo: z.boolean(),
    ...destinatarios,
  });
  router.get('/reportes-programados', programar, async (req, res) => {
    res.json({ success: true, data: await listarProgramados(taller(req)) });
  });
  router.post('/reportes-programados', programar, async (req, res) => {
    const d = validar(cuerpoProgramado, req.body);
    res.status(201).json({ success: true, data: await crearProgramado(taller(req), actorDe(req), req.sesionTaller!.permisos, d) });
  });
  router.put('/reportes-programados/:id', programar, async (req, res) => {
    const d = validar(cuerpoProgramado, req.body);
    res.json({ success: true, data: await actualizarProgramado(taller(req), actorDe(req), req.sesionTaller!.permisos, Number(req.params['id']), d) });
  });
  router.delete('/reportes-programados/:id', programar, async (req, res) => {
    res.json({ success: true, data: await eliminarProgramado(taller(req), actorDe(req), Number(req.params['id'])) });
  });
  router.post('/reportes-programados/:id/probar', programar, async (req, res) => {
    res.json({ success: true, data: await probarProgramado(ctx, taller(req), actorDe(req), Number(req.params['id'])) });
  });

  // ── Búsqueda global ────────────────────────────────────────────────────────────────
  router.get('/buscar', async (req, res) => {
    const q = validar(z.object({ q: z.string().max(100).default('') }), req.query);
    res.json({ success: true, data: await buscar(taller(req), req.sesionTaller!.permisos, q.q) });
  });
}
