const CLAVE_TOKEN = 'vt_admin_token';
export const EVENTO_SESION_VENCIDA = 'vt-sesion-vencida';

export function leerToken(): string | null {
  try {
    return localStorage.getItem(CLAVE_TOKEN);
  } catch {
    return null;
  }
}

export function guardarToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(CLAVE_TOKEN, token);
    else localStorage.removeItem(CLAVE_TOKEN);
  } catch {
    // Navegación privada o sin almacenamiento: la sesión vive solo mientras la página siga abierta.
  }
}

export class ErrorApi extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    /** Datos adicionales que manda el servidor (por ejemplo, el cliente que ya tiene ese NIT). */
    public readonly detalle?: unknown
  ) {
    super(mensaje);
  }
}

async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const token = leerToken();
  let respuesta: Response;
  try {
    respuesta = await fetch(`/api/plataforma${ruta}`, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
  } catch {
    throw new ErrorApi(0, 'SIN_CONEXION', 'No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.');
  }
  const json = (await respuesta.json().catch(() => null)) as { success?: boolean; data?: T; codigo?: string; error?: string } | null;
  if (!respuesta.ok || !json?.success) {
    if (respuesta.status === 401 && token) {
      guardarToken(null);
      window.dispatchEvent(new Event(EVENTO_SESION_VENCIDA));
    }
    throw new ErrorApi(respuesta.status, json?.codigo ?? 'ERROR', json?.error ?? 'No se pudo completar la operación');
  }
  return json.data as T;
}

export const api = {
  get: <T,>(ruta: string) => llamar<T>('GET', ruta),
  post: <T,>(ruta: string, cuerpo?: unknown) => llamar<T>('POST', ruta, cuerpo ?? {}),
  patch: <T,>(ruta: string, cuerpo: unknown) => llamar<T>('PATCH', ruta, cuerpo),
};
