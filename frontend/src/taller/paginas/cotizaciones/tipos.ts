export type EstadoCotizacion = 'borrador' | 'enviada' | 'respondida' | 'vencida' | 'reemplazada' | 'anulada';
export type EstadoLineaCot = 'pendiente' | 'autorizada' | 'rechazada' | 'agregada_a_orden' | 'vencida';

type Variante = 'default' | 'success' | 'warning' | 'danger' | 'info';

export const ESTADO_COT: Record<EstadoCotizacion, { texto: string; variante: Variante }> = {
  borrador: { texto: 'Borrador', variante: 'default' },
  enviada: { texto: 'Enviada, sin respuesta', variante: 'warning' },
  respondida: { texto: 'Respondida', variante: 'success' },
  vencida: { texto: 'Vencida', variante: 'danger' },
  reemplazada: { texto: 'Reemplazada', variante: 'default' },
  anulada: { texto: 'Anulada', variante: 'default' },
};

export const ESTADO_LINEA_COT: Record<EstadoLineaCot, { texto: string; variante: Variante }> = {
  pendiente: { texto: 'Sin respuesta', variante: 'warning' },
  autorizada: { texto: 'Autorizada', variante: 'success' },
  rechazada: { texto: 'Rechazada', variante: 'danger' },
  agregada_a_orden: { texto: 'Agregada a la orden', variante: 'info' },
  vencida: { texto: 'Vencida', variante: 'default' },
};

export type EstadoDesenlace = 'sin_cotizar' | 'en_borrador' | 'sin_respuesta' | 'autorizado' | 'rechazado' | 'agregado' | 'vencido';

export const DESENLACE: Record<EstadoDesenlace, { texto: string; variante: Variante }> = {
  sin_cotizar: { texto: 'Sin cotizar', variante: 'default' },
  en_borrador: { texto: 'Cotización en borrador', variante: 'default' },
  sin_respuesta: { texto: 'Cotizado, sin respuesta', variante: 'warning' },
  autorizado: { texto: 'Autorizado', variante: 'success' },
  rechazado: { texto: 'Rechazado', variante: 'danger' },
  agregado: { texto: 'Agregado a la orden', variante: 'info' },
  vencido: { texto: 'Cotización vencida', variante: 'default' },
};

export interface Desenlace {
  estado: EstadoDesenlace;
  cotizacion: string | null;
  cotizacion_id: number | null;
  motivo: string | null;
  orden: string | null;
}

export interface FilaCotizacion {
  id: number;
  numero: string;
  version: number;
  estado: EstadoCotizacion;
  cliente: string | null;
  equipo: string | null;
  orden: string | null;
  total: number;
  vence_en: string | null;
  lineas: number;
  sin_respuesta: number;
  autorizadas: number;
  rechazadas: number;
}

export interface LineaCotizacion {
  id: number;
  tipo: 'servicio' | 'material' | 'tercero';
  respuesta_id: number | null;
  descripcion: string;
  proveedor: string | null;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  total_linea: number;
  costo?: number;
  horas: number | null;
  estado: EstadoLineaCot;
  motivo_rechazo: string | null;
  motivo_rechazo_texto: string | null;
  respondida_en: string | null;
  respondida_por: string | null;
  agregada_en: string | null;
  agregada_orden: string | null;
  solicitud: string | null;
}

export interface DetalleCotizacion {
  id: number;
  numero: string;
  version: number;
  cliente: string | null;
  equipo: string | null;
  equipo_id: number | null;
  orden: string | null;
  orden_id: number | null;
  checklist_id: number | null;
  estado: EstadoCotizacion;
  notas: string | null;
  subtotal: number;
  descuento_total: number;
  iva: number;
  total: number;
  vence_en: string | null;
  enviada_en: string | null;
  creada_por: string | null;
  motivo_anulacion: string | null;
  version_nueva_id: number | null;
  lineas: LineaCotizacion[];
  hallazgos: Array<{ respuesta_id: number; seccion: string; descripcion: string; nota: string | null; tipo: string; desenlace?: Desenlace; fotos: Array<{ url: string }> }>;
}

export interface OpcionesCotizacion {
  motivos_rechazo: Array<{ id: number; nombre: string }>;
  vigencia_dias: number;
}
