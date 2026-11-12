export type EstadoLinea = 'pendiente' | 'en_proceso' | 'pausado' | 'detenido_material' | 'detenido_terceros' | 'detenido_autorizacion' | 'detenido_espacio' | 'terminado';

/** Los 8 estados de línea del estándar: cómo se llaman y de qué color se ven. */
export const ESTADO_LINEA: Record<EstadoLinea, { texto: string; variante: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  pendiente: { texto: 'Pendiente', variante: 'default' },
  en_proceso: { texto: 'En proceso', variante: 'info' },
  pausado: { texto: 'Pausado', variante: 'warning' },
  detenido_material: { texto: 'Detenido por material', variante: 'danger' },
  detenido_terceros: { texto: 'Detenido por trabajos de terceros', variante: 'danger' },
  detenido_autorizacion: { texto: 'Detenido por autorización', variante: 'danger' },
  detenido_espacio: { texto: 'Detenido por espacio', variante: 'danger' },
  terminado: { texto: 'Terminado', variante: 'success' },
};

export const PRIORIDAD: Record<string, { texto: string; variante: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  baja: { texto: 'Baja', variante: 'default' },
  media: { texto: 'Media', variante: 'info' },
  alta: { texto: 'Alta', variante: 'warning' },
  urgente: { texto: 'Urgente', variante: 'danger' },
};

export interface OpcionesOrden {
  tipos_orden: Array<{ id: number; codigo: string; nombre: string; es_default: number; es_pedido_especial: number }>;
  estados: Array<{ id: number; codigo: string; nombre: string; color: string; es_inicial: number; es_terminal: number; es_cancelado: number }>;
  responsables: Array<{ id: number; nombre: string }>;
  sucursales: Array<{ id: number; nombre: string; es_principal: number }>;
  areas: Array<{ id: number; nombre: string }>;
  motivos_anulacion: Array<{ id: number; nombre: string }>;
}

export interface FilaOrden {
  id: number;
  numero: string;
  prioridad: string;
  descripcion: string | null;
  fecha_estimada_entrega: string | null;
  created_at: string;
  cliente: string | null;
  equipo: string;
  tipo: string;
  estado: string;
  estado_color: string;
  es_terminal: number;
  es_cancelado: number;
  responsable: string | null;
  equipo_en_taller: number;
  total?: number;
}

export interface LineaOrden {
  id: number;
  tipo: 'servicio' | 'material' | 'tercero';
  trabajo_codigo: string | null;
  proveedor: string | null;
  descripcion: string;
  cantidad: number;
  precio_unitario?: number;
  descuento_pct?: number;
  total_linea?: number;
  costo?: number;
  horas_trabajo: number | null;
  tarifa_hora_aplicada?: number | null;
  area: string | null;
  area_trabajo_id: number | null;
  tecnico: string | null;
  tecnico_id: number | null;
  estado: EstadoLinea;
  inicio_en: string | null;
  fin_en: string | null;
  notas: string | null;
  anulada_en: string | null;
  motivo_anulacion: string | null;
}

export interface DetalleOrden {
  id: number;
  numero: string;
  cliente: string | null;
  equipo: string;
  equipo_id: number;
  equipo_estado: string;
  tipo_equipo: string;
  tipo: string;
  es_pedido_especial: number;
  estado: string;
  estado_id: number;
  estado_color: string;
  es_terminal: number;
  es_cancelado: number;
  prioridad: string;
  descripcion: string | null;
  sucursal: string;
  area: string | null;
  area_trabajo_id: number | null;
  responsable: string | null;
  responsable_id: number | null;
  fecha_estimada_entrega: string | null;
  fecha_cierre: string | null;
  referencia_factura_externa: string | null;
  notificar_nombre: string | null;
  notificar_correo: string | null;
  notificar_telefono: string | null;
  motivo_anulacion: string | null;
  motivo_anulacion_texto: string | null;
  created_at: string;
  subtotal?: number;
  descuento_total?: number;
  iva?: number;
  total?: number;
  lineas: LineaOrden[];
  historial: Array<{ id: number; estado: string; estado_color: string; desde: string; motivo: string | null; usuario: string | null }>;
  equipo_en_taller: boolean;
  dias_en_taller: number | null;
  lecturas: Array<{ id: number; valor: number; fecha: string; contador: string }>;
}

/** «Q 1,250.00» o «US$ 1,250.00» según la moneda del taller. */
export function dineroDe(moneda: string, monto: number | null | undefined): string {
  const simbolo = moneda === 'USD' ? 'US$' : 'Q';
  const n = Number(monto ?? 0);
  return `${simbolo} ${n.toLocaleString('es-GT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Los DATE de la base llegan como «2026-11-15T00:00:00.000Z»: se toma solo el día. */
export const soloDia = (v: string | null | undefined): string => (v ? v.slice(0, 10) : '');
