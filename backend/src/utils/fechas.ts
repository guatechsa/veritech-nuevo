import { ErrorValidacion } from '../errores';

/**
 * Fechas razonables (estándar GUATECH §19): un día que no existe o un año imposible se rechaza con 400.
 *  - Rango general: año entre 1980 y (año actual + 30).
 *  - Fecha de nacimiento: de 1900 hasta hoy.
 *  - Lo que ya ocurrió (ingreso, compra, lectura) no puede ser futuro: `noFutura`.
 * `hoy` es 'AAAA-MM-DD' en la zona horaria del TALLER (quien llama lo calcula); por defecto, hoy en UTC.
 */
export interface OpcionesFecha {
  nacimiento?: boolean;
  noFutura?: boolean;
  hoy?: string;
}

const FORMATO = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

export function hoyUtc(ahora: Date = new Date()): string {
  return ahora.toISOString().slice(0, 10);
}

/** Devuelve el valor tal cual si es razonable; si no, lanza ErrorValidacion con el nombre del campo. */
export function validarFechaRazonable(valor: unknown, nombre: string, opciones: OpcionesFecha = {}): string {
  if (typeof valor !== 'string') throw new ErrorValidacion(`${nombre}: la fecha debe ser un texto AAAA-MM-DD`);
  const m = FORMATO.exec(valor.trim());
  if (!m) throw new ErrorValidacion(`${nombre}: formato de fecha inválido`);

  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const horas = m[4] === undefined ? 0 : Number(m[4]);
  const minutos = m[5] === undefined ? 0 : Number(m[5]);
  const segundos = m[6] === undefined ? 0 : Number(m[6]);

  const prueba = new Date(Date.UTC(anio, mes - 1, dia));
  if (prueba.getUTCFullYear() !== anio || prueba.getUTCMonth() !== mes - 1 || prueba.getUTCDate() !== dia) {
    throw new ErrorValidacion(`${nombre}: la fecha no existe`);
  }
  if (horas > 23 || minutos > 59 || segundos > 59) {
    throw new ErrorValidacion(`${nombre}: la hora no es válida`);
  }

  const hoy = opciones.hoy ?? hoyUtc();
  const anioActual = Number(hoy.slice(0, 4));
  const minimo = opciones.nacimiento ? 1900 : 1980;
  const maximo = opciones.nacimiento ? anioActual : anioActual + 30;
  if (anio < minimo || anio > maximo) {
    throw new ErrorValidacion(`${nombre}: el año debe estar entre ${minimo} y ${maximo}`);
  }

  const soloFecha = valor.trim().slice(0, 10);
  if ((opciones.nacimiento || opciones.noFutura) && soloFecha > hoy) {
    throw new ErrorValidacion(`${nombre}: no puede ser una fecha futura`);
  }
  return valor;
}

/** ¿El nombre de un campo del cuerpo de una petición parece ser una fecha? (para la red general de validación). */
export function pareceNombreDeFecha(nombre: string): boolean {
  return /(fecha|vencimiento|vence|vigencia|nacimiento|desde|hasta|inicio|_at$|_en$)/i.test(nombre);
}
