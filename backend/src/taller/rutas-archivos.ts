import fs from 'node:fs/promises';
import path from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import { ErrorNoEncontrado } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { motivoSlugInvalido } from '../utils/slug';
import { abrirArchivo, firmaValida } from './archivos';
import { poolsDe } from './contexto';
import { buscarEmpresa } from './resolutor';

/**
 * Entrega de fotos y documentos: `/api/archivos/<taller>/<número>?e=<vence>&f=<firma>`. No pide sesión (las fotos se
 * incrustan en pantallas y documentos), pero solo sirve con una dirección FIRMADA por el servidor que vence en una hora.
 */
export function crearRutasArchivos(ctx: Contexto): Router {
  const router = Router();
  router.get('/:slug/:id', async (req, res) => {
    const noEncontrado = new ErrorNoEncontrado('No se encontró el archivo');
    const slug = String(req.params['slug']).toLowerCase();
    const id = Number(req.params['id']);
    const q = z.object({ e: z.coerce.number(), f: z.string().max(100) }).safeParse(req.query);
    if (!q.success || !Number.isInteger(id) || id <= 0 || motivoSlugInvalido(slug) !== null) throw noEncontrado;
    if (!firmaValida(ctx, slug, id, q.data.e, q.data.f)) throw noEncontrado;
    const empresa = await buscarEmpresa(ctx, slug);
    if (!empresa || empresa.estado === 'pendiente' || empresa.estado === 'cerrada') throw noEncontrado;
    const archivo = await abrirArchivo(ctx, { empresa, pool: poolsDe(ctx).obtener(empresa.nombreBd) }, id);
    const ruta = path.resolve(archivo.ruta);
    await fs.access(ruta).catch(() => {
      throw noEncontrado;
    });
    res.setHeader('Content-Type', archivo.mime);
    res.setHeader('Content-Disposition', "inline; filename*=UTF-8''" + encodeURIComponent(archivo.nombre));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.sendFile(ruta);
  });
  return router;
}
