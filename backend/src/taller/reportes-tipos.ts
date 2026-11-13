/** Forma común de todo reporte (Fase 7c): una o más secciones con columnas tipadas. Con esto se arman igual la pantalla, el Excel, el PDF y el correo programado. */
export type TipoColumna = 'texto' | 'entero' | 'decimal' | 'dinero' | 'porcentaje';
export type CeldaReporte = string | number | null;

export interface ColumnaReporte {
  clave: string;
  titulo: string;
  tipo: TipoColumna;
}

export interface SeccionReporte {
  titulo: string;
  columnas: ColumnaReporte[];
  filas: Array<Record<string, CeldaReporte>>;
  /** Fila de totales (mismas claves que las columnas; el primer texto suele decir «Total»). */
  total?: Record<string, CeldaReporte>;
}

export interface ReporteArmado {
  codigo: string;
  titulo: string;
  desde: string;
  hasta: string;
  /** Los filtros en palabras («Sucursal: CENTRAL»). */
  filtros: string[];
  secciones: SeccionReporte[];
  notas: string[];
}

export type PeriodoRelativo = 'hoy' | 'ultimos_7' | 'ultimos_30' | 'este_mes' | 'mes_anterior' | 'personalizado';

/** Los filtros como se guardan en una vista o en un envío programado: el periodo es relativo, así «este mes» siempre es el mes en curso. */
export interface FiltrosGuardados {
  periodo: PeriodoRelativo;
  desde?: string;
  hasta?: string;
  sucursal_id?: number;
  tipo_equipo_id?: number;
}

const miles = (n: number, decimales: number): string => (Math.round((n + Number.EPSILON) * 10 ** decimales) / 10 ** decimales).toLocaleString('en-US', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

/** Cómo se escribe una celda a la vista (PDF y correo). En Excel los números van como números con su formato. */
export function formatoCelda(moneda: string, tipo: TipoColumna, valor: CeldaReporte | undefined): string {
  if (valor === undefined) return '';
  if (valor === null) return '—';
  if (tipo === 'texto') return String(valor);
  const n = Number(valor);
  if (Number.isNaN(n)) return String(valor);
  switch (tipo) {
    case 'dinero':
      return `${moneda === 'USD' ? 'US$' : 'Q'} ${miles(n, 2)}`;
    case 'porcentaje':
      return `${miles(n, 2)} %`;
    case 'entero':
      return miles(n, 0);
    default:
      return miles(n, 2);
  }
}

/** AAAA-MM-DD → DD/MM/AAAA (estándar de fechas). */
export const ddmmaaaa = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
