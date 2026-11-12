export interface OpcionesInventario {
  bodegas: Array<{ id: number; nombre: string; sucursal: string }>;
  unidades: Array<{ id: number; codigo: string; nombre: string }>;
  partes: Array<{ id: number; nombre: string; clasificacion: string }>;
  motivos_diferencia: Array<{ id: number; nombre: string }>;
  proveedores: Array<{ id: number; nombre: string }>;
  sistemas: Array<{ id: number; nombre: string }>;
  subsistemas: Array<{ id: number; sistema_id: number; nombre: string }>;
}

export interface FilaMaterial {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  parte_id: number;
  parte: string;
  subsistema_id: number;
  sistema_id: number;
  clasificacion: string;
  marca_id: number | null;
  marca: string | null;
  codigo_oem: string | null;
  unidad_id: number;
  unidad: string;
  existencia_minima: number;
  existencia_total: number;
  bajo_minimo: boolean;
  ubicacion: string | null;
  precio: number;
  precio_manual: number | null;
  proveedor_principal_id: number | null;
  proveedor_principal: string | null;
  activo: number;
  costo_ultimo?: number;
  costo_promedio?: number;
  margen?: number;
  margen_origen?: string;
}

export interface DetalleMaterial extends FilaMaterial {
  por_bodega: Array<{ bodega_id: number; bodega: string; sucursal: string; cantidad: number }>;
}

export interface Movimiento {
  id: number;
  codigo: string;
  material: string;
  bodega: string;
  tipo: string;
  cantidad: number;
  saldo_resultante: number;
  costo_unitario?: number;
  referencia_tipo: string | null;
  motivo: string | null;
  notas: string | null;
  usuario: string | null;
  fecha: string;
}

export interface FilaCompra {
  id: number;
  numero: string;
  proveedor: string;
  bodega: string;
  fecha_documento: string;
  numero_factura: string | null;
  total: number;
  lineas: number;
}

export type EstadoSolicitud = 'no_despachada' | 'despachada_parcial' | 'despachada' | 'anulada';

export const ESTADO_SOLICITUD: Record<EstadoSolicitud, { texto: string; variante: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  no_despachada: { texto: 'No despachada', variante: 'danger' },
  despachada_parcial: { texto: 'Despachada parcial', variante: 'warning' },
  despachada: { texto: 'Despachada', variante: 'success' },
  anulada: { texto: 'Anulada', variante: 'default' },
};

export interface FilaSolicitud {
  id: number;
  numero: string;
  orden_id: number;
  orden: string;
  cliente: string | null;
  solicitante: string | null;
  estado: EstadoSolicitud;
  notas: string | null;
  solicitada_en: string;
  primer_despacho_en: string | null;
  despachada_en: string | null;
  lineas: number;
  unidades_pendientes: number;
}

export interface LineaSolicitud {
  id: number;
  material_id: number;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad_solicitada: number;
  cantidad_despachada: number;
  cantidad_devuelta: number;
  pendiente: number;
  en_la_orden: number;
  por_bodega: Array<{ bodega_id: number; bodega: string; cantidad: number }>;
}

export interface DetalleSolicitud {
  id: number;
  numero: string;
  orden_id: number;
  orden: string;
  sucursal: string;
  orden_cerrada: boolean;
  cliente: string | null;
  solicitante: string | null;
  estado: EstadoSolicitud;
  notas: string | null;
  solicitada_en: string;
  primer_despacho_en: string | null;
  despachada_en: string | null;
  anulada_en: string | null;
  motivo_anulacion: string | null;
  lineas: LineaSolicitud[];
  despachos: Array<{ id: number; solicitud_linea_id: number; bodega: string; cantidad: number; costo_unitario?: number; fecha: string; despachado_por: string | null }>;
  devoluciones: Array<{ id: number; numero: string; solicitud_linea_id: number; bodega: string; cantidad: number; motivo: string; fecha: string; registrada_por: string | null }>;
}
