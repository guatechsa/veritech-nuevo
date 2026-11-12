export type EstadoServicio = 'vencido' | 'urgente' | 'proximo' | 'al_dia' | 'sin_contador';

export const ESTADO_SERVICIO: Record<EstadoServicio, { texto: string; variante: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  vencido: { texto: 'Vencido', variante: 'danger' },
  urgente: { texto: 'Urgente', variante: 'danger' },
  proximo: { texto: 'Próximo', variante: 'warning' },
  al_dia: { texto: 'Al día', variante: 'success' },
  sin_contador: { texto: 'Sin contador', variante: 'default' },
};

export interface ServicioDeEquipo {
  equipo_id: number;
  equipo: string;
  tipo_equipo: string;
  cliente: string | null;
  servicio_id: number;
  servicio: string;
  unidad: string;
  estado: EstadoServicio;
  valor_actual: number | null;
  ultimo_servicio: { valor: number; fecha: string } | null;
  proximo_en: number | null;
  restante: number | null;
  ritmo_por_dia: number | null;
  fecha_estimada: string | null;
}

export interface Programa {
  id: number;
  tipo_equipo_id: number;
  tipo_equipo: string;
  trabajo_codigo: string;
  trabajo: string;
  nombre: string;
  tipo: 'mantenimiento' | 'revision_operativa';
  checklist: string | null;
  checklist_tipo_id: number | null;
  tipo_contador_id: number;
  tipo_contador: string;
  unidad: string;
  es_calendario: number;
  intervalo: number;
  aviso_proximo: number;
  aviso_urgente: number;
  activo: number;
  equipos: number;
}

/** «faltan 450 KM», «vencido hace 120 KM». */
export function textoRestante(s: Pick<ServicioDeEquipo, 'restante' | 'unidad' | 'estado'>): string {
  if (s.restante === null) return '—';
  const n = Math.abs(s.restante).toLocaleString('es-GT', { maximumFractionDigits: 1 });
  return s.restante < 0 ? `Vencido hace ${n} ${s.unidad}` : `Faltan ${n} ${s.unidad}`;
}
