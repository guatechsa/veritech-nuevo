/**
 * Lo que el sistema necesita saber de PayPal. Todo lo demás (autenticación, formatos, tiempos máximos) vive detrás de
 * `ProveedorPagos`: las pruebas automáticas usan uno simulado y el sistema real usa `paypal.ts`.
 */
export type EstadoPaypal = 'APPROVAL_PENDING' | 'APPROVED' | 'ACTIVE' | 'SUSPENDED' | 'CANCELLED' | 'EXPIRED';

export interface SuscripcionPaypal {
  id: string;
  estado: EstadoPaypal;
  planId: string;
  /** Lo que el registro puso al crear la suscripción: liga la suscripción con ESE registro. */
  customId: string | null;
  correoSuscriptor: string | null;
  proximoCobro: Date | null;
  ultimoPagoEn: Date | null;
  pagosFallidos: number;
  saldoPendiente: number;
  /** Sigue en el período de prueba (todavía no se cobra nada). */
  enPrueba: boolean;
}

export interface TransaccionPaypal {
  id: string;
  fecha: Date;
  monto: number;
  moneda: string;
  estado: string;
}

export interface EntradaWebhook {
  headers: Record<string, string | string[] | undefined>;
  cuerpoCrudo: string;
}

export interface ProveedorPagos {
  /** `null` si PayPal no conoce esa suscripción. Un fallo de red lanza error (no se confunde con "no existe"). */
  obtenerSuscripcion(id: string): Promise<SuscripcionPaypal | null>;
  cancelarSuscripcion(id: string, motivo: string): Promise<void>;
  listarTransacciones(id: string, desde: Date, hasta: Date): Promise<TransaccionPaypal[]>;
  verificarWebhook(entrada: EntradaWebhook): Promise<boolean>;
}
