import { ejecutar, filas } from '../db/consulta';
import { TallerReq } from './comun';

/**
 * Bitácora única de lo que ve el cliente (Fase 7d): cada vez que una persona abre de verdad un enlace, el QR de un equipo o entra al portal,
 * queda quién (si se sabe), qué, cuándo, desde qué dispositivo y qué dirección de red. Se ve en la ficha del cliente.
 */
export type CanalAcceso = 'enlace' | 'portal' | 'qr';

export interface AccesoNuevo {
  canal: CanalAcceso;
  /** cotizacion, cuenta, checklist, equipo, portal… */
  tipo: string;
  entidadId: number | null;
  /** Lo que el taller reconoce: COT-000015, CTA-000002, CAM-1 · C123ABC… */
  referencia: string | null;
  clienteId: number | null;
  contactoId?: number | null;
  ip: string;
  dispositivo: string;
  en: Date;
}

/** Anota un acceso. Nunca lanza un error: que la bitácora falle no debe impedirle al cliente ver lo suyo. */
export async function registrarAcceso(t: TallerReq, a: AccesoNuevo): Promise<void> {
  try {
    await ejecutar(t.pool, 'INSERT INTO accesos_cliente (canal, tipo, entidad_id, referencia, cliente_id, contacto_id, ip, dispositivo, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
      a.canal,
      a.tipo.slice(0, 30),
      a.entidadId,
      a.referencia?.slice(0, 60) ?? null,
      a.clienteId,
      a.contactoId ?? null,
      a.ip.slice(0, 64),
      a.dispositivo.slice(0, 200),
      a.en,
    ]);
  } catch (error) {
    console.error('[accesos] no se pudo anotar:', error instanceof Error ? error.message : error);
  }
}

export async function accesosDeCliente(t: TallerReq, clienteId: number, limite = 50) {
  return filas<{ id: number; canal: CanalAcceso; tipo: string; referencia: string | null; contacto: string | null; ip: string; dispositivo: string; created_at: Date }>(
    t.pool,
    `SELECT a.id, a.canal, a.tipo, a.referencia, c.nombre AS contacto, a.ip, a.dispositivo, a.created_at
       FROM accesos_cliente a LEFT JOIN contactos_cliente c ON c.id = a.contacto_id WHERE a.cliente_id = ? ORDER BY a.id DESC LIMIT ?`,
    [clienteId, Math.min(Math.max(limite, 1), 200)]
  );
}
