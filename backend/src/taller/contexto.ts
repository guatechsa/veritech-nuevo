import { Pool } from 'mysql2/promise';
import { EstadoEmpresa } from '../cobro/estado';
import { Contexto } from '../plataforma/contexto';
import { RegistroPools } from './pools';

/** La empresa a la que pertenece la petición (se resuelve por la dirección). */
export interface EmpresaDePeticion {
  id: number;
  nombre: string;
  slug: string;
  subdominio: string;
  nombreBd: string;
  estado: EstadoEmpresa;
  zonaHoraria: string;
  planId: number | null;
  planNombre: string | null;
  maxUsuarios: number | null;
  maxSucursales: number | null;
  modulos: Set<string>;
  cobroPorContrato: boolean;
  pruebaHasta: Date | null;
  graciaHasta: Date | null;
  accesoHasta: Date | null;
  exportableHasta: Date | null;
}

export interface SesionDeTaller {
  sesionId: number;
  usuarioId: number;
  colaboradorId: number;
  nombre: string;
  correo: string | null;
  roles: Array<{ id: number; codigo: string; nombre: string }>;
  permisos: Set<string>;
  esSoporte: boolean;
}

declare module 'express-serve-static-core' {
  interface Request {
    taller?: { empresa: EmpresaDePeticion; pool: Pool };
    sesionTaller?: SesionDeTaller;
  }
}

export function poolsDe(ctx: Contexto): RegistroPools {
  ctx.pools ??= new RegistroPools(ctx.entorno);
  return ctx.pools;
}

/** Los estados en los que el taller puede entrar a trabajar (con o sin aviso). */
export const ESTADOS_QUE_TRABAJAN: EstadoEmpresa[] = ['prueba', 'activa', 'pago_fallido', 'cancelada_con_acceso'];
