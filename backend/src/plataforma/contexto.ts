import { Request } from 'express';
import { Pool } from 'mysql2/promise';
import { Entorno } from '../config/entorno';

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
  limites?: { ingreso?: number; recuperacion?: number };
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
