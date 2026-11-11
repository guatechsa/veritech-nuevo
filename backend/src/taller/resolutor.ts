import { Request, RequestHandler } from 'express';
import { EstadoEmpresa } from '../cobro/estado';
import { filas, una } from '../db/consulta';
import { ErrorApp } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { motivoSlugInvalido } from '../utils/slug';
import { EmpresaDePeticion, poolsDe } from './contexto';

interface Cacheada {
  vence: number;
  empresa: EmpresaDePeticion | null;
}
const cache = new Map<string, Cacheada>();

/** Para las pruebas y para cuando cambia el estado de una empresa. */
export function olvidarEmpresas(): void {
  cache.clear();
}

/** Qué taller es, según la dirección. Primero manda el nombre en la dirección; la cabecera `X-Taller` solo si está permitida. */
export function slugDePeticion(ctx: Contexto, req: Request): string | null {
  const dominio = ctx.entorno.DOMINIO_TALLERES.toLowerCase();
  const host = (req.hostname ?? '').toLowerCase();
  if (host.endsWith(`.${dominio}`)) {
    const slug = host.slice(0, -(dominio.length + 1));
    if (motivoSlugInvalido(slug) === null) return slug;
    return null;
  }
  if (ctx.entorno.TALLER_POR_ENCABEZADO) {
    const cabecera = req.headers['x-taller'];
    const valor = (Array.isArray(cabecera) ? cabecera[0] : cabecera)?.toLowerCase();
    if (valor && motivoSlugInvalido(valor) === null) return valor;
  }
  return null;
}

async function cargarEmpresa(ctx: Contexto, slug: string): Promise<EmpresaDePeticion | null> {
  const f = await una<{
    id: number;
    nombre: string;
    slug: string;
    subdominio: string;
    nombre_bd: string;
    estado: EstadoEmpresa;
    zona_horaria: string;
    plan_id: number | null;
    plan_nombre: string | null;
    max_usuarios: number | null;
    max_sucursales: number | null;
    cobro_por_contrato: number;
    prueba_hasta: Date | null;
    gracia_hasta: Date | null;
    acceso_hasta: Date | null;
    exportable_hasta: Date | null;
  }>(
    ctx.pool,
    `SELECT e.id, e.nombre, e.slug, e.subdominio, e.nombre_bd, e.estado, e.zona_horaria, e.plan_id, p.nombre AS plan_nombre,
            p.max_usuarios, p.max_sucursales, e.cobro_por_contrato, e.prueba_hasta, e.gracia_hasta, e.acceso_hasta, e.exportable_hasta
       FROM empresas e LEFT JOIN planes p ON p.id = e.plan_id WHERE e.slug = ?`,
    [slug]
  );
  if (!f) return null;
  const modulos = await filas<{ modulo_codigo: string }>(ctx.pool, 'SELECT modulo_codigo FROM empresa_modulos WHERE empresa_id = ?', [f.id]);
  return {
    id: f.id,
    nombre: f.nombre,
    slug: f.slug,
    subdominio: f.subdominio,
    nombreBd: f.nombre_bd,
    estado: f.estado,
    zonaHoraria: f.zona_horaria,
    planId: f.plan_id,
    planNombre: f.plan_nombre,
    maxUsuarios: f.max_usuarios,
    maxSucursales: f.max_sucursales,
    modulos: new Set(modulos.map((m) => m.modulo_codigo)),
    cobroPorContrato: f.cobro_por_contrato === 1,
    pruebaHasta: f.prueba_hasta,
    graciaHasta: f.gracia_hasta,
    accesoHasta: f.acceso_hasta,
    exportableHasta: f.exportable_hasta,
  };
}

export async function buscarEmpresa(ctx: Contexto, slug: string): Promise<EmpresaDePeticion | null> {
  const ttl = ctx.cacheEmpresaMs ?? 30_000;
  const hit = cache.get(`${ctx.entorno.BD_PLATAFORMA}:${slug}`);
  if (ttl > 0 && hit && hit.vence > Date.now()) return hit.empresa;
  const empresa = await cargarEmpresa(ctx, slug);
  if (ttl > 0) cache.set(`${ctx.entorno.BD_PLATAFORMA}:${slug}`, { vence: Date.now() + ttl, empresa });
  return empresa;
}

const NO_ENCONTRADO = new ErrorApp(404, 'TALLER_NO_ENCONTRADO', 'No encontramos ese taller. Revise la dirección o use «Entrar» para recibir sus accesos.');

/**
 * Pone en la petición la empresa y la conexión a SU base. Un taller que no existe, está pendiente o ya se cerró responde
 * lo mismo (no se revela cuáles existen). El estado de la cuenta se decide aquí y no en cada ruta.
 */
export function resolverTaller(ctx: Contexto): RequestHandler {
  return async (req, _res, next) => {
    const slug = slugDePeticion(ctx, req);
    if (!slug) throw NO_ENCONTRADO;
    const empresa = await buscarEmpresa(ctx, slug);
    if (!empresa || empresa.estado === 'pendiente' || empresa.estado === 'cerrada') throw NO_ENCONTRADO;
    req.taller = { empresa, pool: poolsDe(ctx).obtener(empresa.nombreBd) };
    next();
  };
}
