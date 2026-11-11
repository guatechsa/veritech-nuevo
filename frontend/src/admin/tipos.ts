export type RolPlataforma = 'SUPER_ADMIN' | 'ADMIN' | 'VIEWER';

export interface UsuarioSesion {
  id: number;
  nombre: string;
  correo: string;
  rol: RolPlataforma;
}

export type EstadoEmpresa = 'pendiente' | 'prueba' | 'activa' | 'pago_fallido' | 'suspendida' | 'cancelada_con_acceso' | 'solo_exportar' | 'cerrada';

export interface EmpresaFila {
  id: number;
  nombre: string;
  slug: string;
  subdominio: string;
  estado: EstadoEmpresa;
  cuota_mensual: number | null;
  cobro_por_contrato: number;
  es_demo: number;
  contacto_nombre: string | null;
  contacto_correo: string | null;
  provisionada_en: string | null;
  plan_id: number | null;
  plan_nombre: string | null;
  modulos_habilitados: number;
}

export interface EmpresaDetalle extends Omit<EmpresaFila, 'modulos_habilitados' | 'plan_nombre'> {
  modulos: string[];
}

export interface ListaEmpresas {
  empresas: EmpresaFila[];
  total_modulos: number;
  cuota_total_activas: number | null;
}

export interface Modulo {
  codigo: string;
  nombre: string;
  orden: number;
}

export interface Plan {
  id: number;
  codigo: string;
  nombre: string;
  precio_mensual: number;
  max_usuarios: number | null;
  max_sucursales: number | null;
  activo: number;
  empresas: number;
  modulos: string[];
}

export interface UsuarioPlataforma {
  id: number;
  nombre: string;
  correo: string;
  rol: RolPlataforma;
  activo: number;
  ultimo_ingreso: string | null;
  created_at: string;
}

export interface Indicadores {
  clientes: { activos: number; en_prueba: number; suspendidos: number; total: number };
  ingreso_mensual: { monto: number | null; sin_datos: boolean };
  altas_mes: number;
  usuarios_plataforma: { total: number; activos: number };
  eventos_auditoria: number;
}

export interface RegistroAuditoria {
  id: number;
  created_at: string;
  accion: string;
  descripcion: string;
  ip: string | null;
  usuario_nombre: string | null;
  usuario_correo: string | null;
}

export interface PaginaAuditoria {
  total: number;
  pagina: number;
  porPagina: number;
  registros: RegistroAuditoria[];
}

export const ETIQUETA_ESTADO: Record<EstadoEmpresa, { texto: string; variante: 'success' | 'warning' | 'danger' | 'default' | 'info' }> = {
  pendiente: { texto: 'Pendiente', variante: 'warning' },
  prueba: { texto: 'En prueba', variante: 'warning' },
  activa: { texto: 'Activa', variante: 'success' },
  pago_fallido: { texto: 'Pago fallido', variante: 'danger' },
  suspendida: { texto: 'Suspendida', variante: 'danger' },
  cancelada_con_acceso: { texto: 'Cancelada con acceso', variante: 'warning' },
  solo_exportar: { texto: 'Solo exportar', variante: 'default' },
  cerrada: { texto: 'Cerrada', variante: 'default' },
};

export const ETIQUETA_ROL: Record<RolPlataforma, string> = {
  SUPER_ADMIN: 'Super administrador',
  ADMIN: 'Administrador',
  VIEWER: 'Solo lectura',
};

export function dinero(monto: number | null | undefined): string {
  if (monto === null || monto === undefined) return '—';
  return `US$ ${monto.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
