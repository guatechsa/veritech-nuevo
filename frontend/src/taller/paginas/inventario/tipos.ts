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
