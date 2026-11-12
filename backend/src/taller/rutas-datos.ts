import express, { Request, Response, Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { actorDe, validar } from './comun';
import { enviarZipDeArchivos, generarLibroDeDatos, resumenDeExportacion } from './datos/exportar';
import { ejecutarCarga, esTipoDeCarga, IMPORTADORES, TipoCarga } from './datos/importar';
import { MAXIMO_BYTES_EXCEL } from './datos/libro';
import { crearPlantilla } from './datos/plantilla';
import { exigirPermiso } from './sesion';

const TIPO_EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const cuerpoExcel = express.raw({ type: [TIPO_EXCEL, 'application/octet-stream'], limit: MAXIMO_BYTES_EXCEL });

function limitador(limite: number, minutos: number) {
  return rateLimit({
    windowMs: minutos * 60 * 1000,
    limit: limite,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ success: false, codigo: 'DEMASIADAS_DESCARGAS', error: 'Ha pedido demasiadas veces esto en poco tiempo. Espere unos minutos e intente de nuevo.' });
    },
  });
}

function tipoDe(req: Request): TipoCarga {
  const t = String(req.params['tipo']);
  if (!esTipoDeCarga(t)) throw new ErrorNoEncontrado('Esa carga no existe');
  return t;
}

function descargar(res: Response, nombre: string, mime: string, datos: Buffer): void {
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(datos);
}

/** Descarga de los datos del taller y carga masiva desde Excel (permisos `datos.exportar` y `datos.importar`). */
export function montarRutasDatos(router: Router, ctx: Contexto): void {
  const exportar = exigirPermiso('datos.exportar');
  const importar = exigirPermiso('datos.importar');
  const tope = ctx.limites?.descargas ?? 10;
  const frenoDescargas = limitador(tope, 10);
  const frenoCargas = limitador(tope * 3, 10);

  // ── Exportar (también permitido cuando la cuenta está en «solo exportar») ───────────
  router.get('/exportar/resumen', exportar, async (req, res) => {
    res.json({ success: true, data: await resumenDeExportacion(req.taller!) });
  });

  router.get('/exportar/datos', exportar, frenoDescargas, async (req, res) => {
    const r = await generarLibroDeDatos(req.taller!, actorDe(req));
    descargar(res, r.nombre, TIPO_EXCEL, r.buffer);
  });

  router.get('/exportar/archivos', exportar, frenoDescargas, async (req, res) => {
    await enviarZipDeArchivos(ctx, req.taller!, actorDe(req), res);
  });

  // ── Importar ──────────────────────────────────────────────────────────────────────
  router.get('/importar/tipos', importar, (_req, res) => {
    res.json({
      success: true,
      data: Object.values(IMPORTADORES).map((i) => ({
        tipo: i.tipo,
        titulo: i.titulo,
        descripcion: i.descripcion,
        columnas: i.columnas.map((c) => ({ encabezado: c.encabezado, requerida: c.requerida, ayuda: c.ayuda, ejemplo: c.ejemplo })),
      })),
    });
  });

  router.get('/importar/:tipo/plantilla', importar, frenoCargas, async (req, res) => {
    const tipo = tipoDe(req);
    descargar(res, `plantilla-${tipo}.xlsx`, TIPO_EXCEL, await crearPlantilla(IMPORTADORES[tipo], req.taller!));
  });

  router.post('/importar/:tipo', importar, frenoCargas, cuerpoExcel, async (req, res) => {
    const tipo = tipoDe(req);
    const q = validar(z.object({ simular: z.enum(['true', 'false']).default('true'), crear_marcas: z.enum(['true', 'false']).default('false') }), req.query);
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) throw new ErrorValidacion('Envíe el archivo de Excel (.xlsx) lleno con la plantilla');
    const r = await ejecutarCarga(ctx, req.taller!, actorDe(req), tipo, req.body, { simular: q.simular === 'true', crearMarcas: q.crear_marcas === 'true' });
    res.json({ success: true, data: r });
  });
}
