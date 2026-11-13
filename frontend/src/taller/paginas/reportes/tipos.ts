import { dineroDe } from '../ordenes/tipos';

export type Unidad = 'cantidad' | 'moneda' | 'porcentaje' | 'dias' | 'horas';
export type Semaforo = 'verde' | 'amarillo' | 'rojo';

export interface Tarjeta {
  codigo: string;
  titulo: string;
  tipo: 'contador' | 'indicador';
  unidad: Unidad;
  ayuda: string;
  ruta: string;
  valor: number | null;
  anterior?: number | null;
  semaforo: Semaforo | null;
}

export interface Indicador {
  codigo: string;
  nombre: string;
  unidad: Unidad;
  base: string;
  financiero: boolean;
  sentido: 'mayor' | 'menor';
  descripcion: string;
  valor: number | null;
  detalle: Record<string, number> | null;
  meta: { meta: number; limite: number | null; sentido: 'mayor' | 'menor' } | null;
  semaforo: Semaforo | null;
}

export function formatoValor(unidad: Unidad, valor: number | null, moneda: string): string {
  if (valor === null) return 'Sin dato';
  const n = Number.isInteger(valor) ? valor.toLocaleString('es-GT') : valor.toLocaleString('es-GT', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  switch (unidad) {
    case 'moneda': return dineroDe(moneda, valor);
    case 'porcentaje': return `${n} %`;
    case 'dias': return `${n} ${valor === 1 ? 'día' : 'días'}`;
    case 'horas': return `${n} h`;
    default: return n;
  }
}

export const COLOR_SEMAFORO: Record<Semaforo, { borde: string; punto: string; texto: string }> = {
  verde: { borde: 'border-green-300', punto: 'bg-green-500', texto: 'En meta' },
  amarillo: { borde: 'border-amber-300', punto: 'bg-amber-400', texto: 'Cerca de la meta' },
  rojo: { borde: 'border-red-300', punto: 'bg-red-500', texto: 'Fuera de la meta' },
};
