/** Reglas aprobadas por Luis (módulos 13 y 16). Son política del negocio, no configuración del servidor. */
export const POLITICA = {
  /** Prueba de 30 días con el cobro aprobado desde el inicio (estándar de planes y cobro). */
  diasPrueba: 30,
  /** Pago fallido: el taller sigue trabajando 7 días con aviso; al día 7 se suspende. */
  diasGracia: 7,
  /** Correos de pago fallido: día 0 (al fallar), día 3 y día 6. */
  diasAvisoGracia: [3, 6],
  /** Cuenta cancelada o suspendida: 30 días de solo exportar y luego se cierra. */
  diasSoloExportar: 30,
  /** Una cuenta suspendida por falta de pago pasa a "solo exportar" después de estos días. */
  diasSuspendidaAntesDeExportar: 30,
  /** Avisos de que la prueba termina. */
  diasAvisoPrueba: [7, 1],
  /** Aviso previo al borrado de los datos. */
  diasAvisoBorrado: 7,
  /** El pase del registro vence a las 48 horas. */
  horasVigenciaPase: 48,
  /** Veces que se reintenta crear un taller aprobado antes de avisar a GUATECH. */
  maximoIntentosAlta: 5,
} as const;

export const MS_DIA = 24 * 60 * 60 * 1000;

export function sumarDias(fecha: Date, dias: number): Date {
  return new Date(fecha.getTime() + dias * MS_DIA);
}
