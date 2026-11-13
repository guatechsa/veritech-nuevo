import { EstadoDesenlace } from './cotizaciones-desenlace';

/** Cómo se dice, en el informe PDF, lo que pasó con un ítem en rojo. */
export const DESENLACE_TEXTO: Record<EstadoDesenlace, string> = {
  sin_cotizar: 'Sin cotizar',
  en_borrador: 'Cotización en preparación',
  sin_respuesta: 'Cotizado, sin respuesta del cliente',
  autorizado: 'Autorizado por el cliente',
  rechazado: 'Rechazado por el cliente',
  agregado: 'Autorizado y agregado a la orden',
  vencido: 'Cotización vencida',
};
