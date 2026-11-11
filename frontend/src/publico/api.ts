import { ErrorApi } from '../admin/api';

/** Llamadas a las rutas públicas (sin sesión): registro y "Entrar". */
export async function llamarPublico<T>(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<T> {
  let respuesta: Response;
  try {
    respuesta = await fetch(`/api${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(0, 'SIN_CONEXION', 'No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.');
  }
  const json = (await respuesta.json().catch(() => null)) as { success?: boolean; data?: T; codigo?: string; error?: string } | null;
  if (!respuesta.ok || !json?.success) {
    throw new ErrorApi(respuesta.status, json?.codigo ?? 'ERROR', json?.error ?? 'No se pudo completar la operación');
  }
  return json.data as T;
}

export interface PlanPublico {
  codigo: string;
  nombre: string;
  precio_mensual: number;
  max_usuarios: number | null;
  max_sucursales: number | null;
  modulos: string[];
  cobro_disponible: boolean;
}

export interface PaseEmitido {
  pase: string;
  paypal_plan_id: string;
  custom_id: string;
  vence_en: string;
}

export type EstadoRegistro = 'esperando_pago' | 'creando' | 'lista' | 'error' | 'vencida';

export interface EstadoAltaPublico {
  estado: EstadoRegistro;
  subdominio?: string;
  url?: string;
}
