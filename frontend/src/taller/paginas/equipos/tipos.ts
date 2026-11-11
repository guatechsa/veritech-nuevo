export interface FilaEquipo {
  id: number;
  descripcion: string;
  tipo_equipo_id: number;
  tipo_equipo: string;
  codigo_interno: string | null;
  placa: string | null;
  serie: string | null;
  marca: string | null;
  modelo: string | null;
  cliente_id: number | null;
  cliente: string | null;
  propiedad: 'propio' | 'cliente';
  estado: 'activo' | 'fuera_de_servicio' | 'baja';
  contador_principal: string | null;
}

export interface Contador {
  id: number;
  equipo_id: number;
  componente_id: number | null;
  componente: string | null;
  tipo_contador_id: number;
  tipo: string;
  unidad: string;
  es_calendario: boolean;
  nombre: string;
  valor_inicial: number;
  valor_actual: number;
  fecha_inicio: string;
  ultima_lectura_en: string | null;
  es_principal: boolean;
  activo: boolean;
}

export interface Lectura {
  id: number;
  contador_id: number;
  valor: number;
  fecha: string;
  origen: string;
  estado: 'valida' | 'pendiente_revision' | 'anulada';
  notas: string | null;
  registrado_por: string | null;
  archivo_id: number | null;
  foto_url: string | null;
  anulada_en: string | null;
  anulada_por: string | null;
  motivo_anulacion: string | null;
}

export interface DetalleEquipo extends FilaEquipo {
  es_vehiculo: number;
  usa_combustible: number;
  tiene_componentes: number;
  marca_id: number | null;
  anio: number | null;
  color: string | null;
  motor_marca: string | null;
  motor_modelo: string | null;
  motor_serie: string | null;
  combustible: string | null;
  capacidad_tanque: number | null;
  departamento_id: number | null;
  departamento: string | null;
  codigo_publico: string;
  notas: string | null;
  fotos: Array<{ id: number; descripcion: string | null; es_principal: boolean; url: string }>;
  documentos: Array<{ id: number; tipo_documento_id: number; tipo: string; nombre: string | null; vence: string | null; estado: 'vigente' | 'por_vencer' | 'vencido' | 'sin_vencimiento'; url: string | null }>;
  documentos_faltantes: Array<{ tipo_documento_id: number; nombre: string; obligatorio: boolean }>;
  anotaciones: Array<{ id: number; nota: string; es_importante: number; created_at: string; autor: string | null }>;
  componentes: Array<{ id: number; nombre: string; activo: number }>;
  operadores: Array<{ id: number; colaborador_id: number; colaborador: string; desde: string; hasta: string | null; activo: number }>;
  contactos: Array<{ contacto_id: number; nombre: string }>;
  contadores: Contador[];
  ordenes: { abiertas: number; total: number };
}

export interface AvisoEquipo {
  campo: 'placa';
  equipo: { id: number; descripcion: string };
}

export interface TipoEquipo {
  id: number;
  codigo: string;
  nombre: string;
  es_vehiculo: number;
  usa_combustible: number;
  tarifa_venta_hora: number;
  costo_hora: number;
  tolerancia_dias: number;
  tolerancia_contador: number;
  tiene_componentes: number;
  activo: number;
  equipos?: number;
}

export const ESTADO_EQUIPO: Record<FilaEquipo['estado'], { texto: string; variante: 'success' | 'warning' | 'default' }> = {
  activo: { texto: 'Activo', variante: 'success' },
  fuera_de_servicio: { texto: 'Fuera de servicio', variante: 'warning' },
  baja: { texto: 'De baja', variante: 'default' },
};
