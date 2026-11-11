import { EntradaWebhook, EstadoPaypal, ProveedorPagos, SuscripcionPaypal, TransaccionPaypal } from '../../src/cobro/tipos';

/** PayPal simulado para las pruebas: guarda suscripciones en memoria y permite fabricar cualquier situación. */
export class PaypalSimulado implements ProveedorPagos {
  suscripciones = new Map<string, SuscripcionPaypal>();
  transacciones = new Map<string, TransaccionPaypal[]>();
  cancelaciones: Array<{ id: string; motivo: string }> = [];
  firmaValida = true;
  caido = false;
  llamadas = 0;

  suscripcion(id: string, cambios: Partial<SuscripcionPaypal> = {}): SuscripcionPaypal {
    const base: SuscripcionPaypal = {
      id,
      estado: 'ACTIVE',
      planId: 'P-PRUEBA',
      customId: null,
      correoSuscriptor: null,
      proximoCobro: null,
      ultimoPagoEn: null,
      pagosFallidos: 0,
      saldoPendiente: 0,
      enPrueba: true,
    };
    const s = { ...(this.suscripciones.get(id) ?? base), ...cambios };
    this.suscripciones.set(id, s);
    return s;
  }

  estado(id: string, estado: EstadoPaypal): void {
    this.suscripcion(id, { estado });
  }

  pago(id: string, tx: TransaccionPaypal): void {
    this.transacciones.set(id, [...(this.transacciones.get(id) ?? []), tx]);
  }

  private revisar(): void {
    this.llamadas += 1;
    if (this.caido) throw new Error('PayPal no responde');
  }

  async obtenerSuscripcion(id: string): Promise<SuscripcionPaypal | null> {
    this.revisar();
    return this.suscripciones.get(id) ?? null;
  }

  async cancelarSuscripcion(id: string, motivo: string): Promise<void> {
    this.revisar();
    this.cancelaciones.push({ id, motivo });
    this.suscripcion(id, { estado: 'CANCELLED' });
  }

  async listarTransacciones(id: string, desde: Date, hasta: Date): Promise<TransaccionPaypal[]> {
    this.revisar();
    return (this.transacciones.get(id) ?? []).filter((t) => t.fecha >= desde && t.fecha <= hasta);
  }

  async verificarWebhook(_entrada: EntradaWebhook): Promise<boolean> {
    return this.firmaValida;
  }
}
