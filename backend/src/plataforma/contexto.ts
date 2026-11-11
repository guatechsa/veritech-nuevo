import { Request } from 'express';
import { Pool } from 'mysql2/promise';
import { Entorno } from '../config/entorno';
import { ProveedorPagos } from '../cobro/tipos';
import { ConfigBd } from '../db/conexion';

export type RolPlataforma = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

export interface UsuarioPlataforma {
  id: number;
  nombre: string;
  correo: string;
  rol: RolPlataforma;
}

export interface Contexto {
  pool: Pool;
  entorno: Entorno;
  /** Topes de intentos por ventana (las pruebas los suben para no chocar con el límite). */
  limites?: { ingreso?: number; recuperacion?: number; registro?: number };
  /** PayPal. Sin él, el cobro está apagado. Las pruebas inyectan uno simulado. */
  pagos?: ProveedorPagos;
  /** ¿Responde ya el subdominio de un taller nuevo? (se inyecta para poder probar sin red). */
  verificarSubdominio?: (url: string) => Promise<boolean>;
  /** Reloj inyectable: las pruebas viajan en el tiempo sin esperar. */
  ahora?: () => Date;
  /** Carpeta de migraciones de los talleres (por defecto la del repositorio). */
  carpetaTaller?: string;
  /** Conexiones a las bases de los talleres (se crea sola al primer uso). */
  pools?: import('../taller/pools').RegistroPools;
  /** Cuánto se recuerda la ficha de una empresa en memoria (ms). Las pruebas lo ponen en 0. */
  cacheEmpresaMs?: number;
  /** Cómo se pone en marcha la creación de un taller recién aprobado. Por defecto, en segundo plano; las pruebas la controlan. */
  lanzarAlta?: (altaId: number) => void;
}

export function ahoraDe(ctx: Contexto): Date {
  return ctx.ahora ? ctx.ahora() : new Date();
}

export function configBdDe(entorno: Entorno): ConfigBd {
  return { host: entorno.BD_HOST, puerto: entorno.BD_PUERTO, usuario: entorno.BD_USUARIO, clave: entorno.BD_CLAVE };
}

declare module 'express-serve-static-core' {
  interface Request {
    usuarioPlataforma?: UsuarioPlataforma;
  }
}

export function ipDe(req: Request): string {
  return (req.ip ?? '').slice(0, 45);
}

export function agenteDe(req: Request): string {
  return String(req.headers['user-agent'] ?? '').slice(0, 255);
}
