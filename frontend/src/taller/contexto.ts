import { createContext, useContext } from 'react';
import { ErrorApi } from '../admin/api';

/**
 * Qué taller es. En producción lo dice la dirección (<taller>.veritech.lat); en el sitio de pruebas, mientras los talleres
 * no tengan dirección propia, lo dice la ruta (/t/<taller>/...). El servidor decide con la cabecera X-Taller solo si está permitida.
 */
export interface UbicacionTaller {
  slug: string;
  /** Prefijo de las rutas de la aplicación: '' si el taller tiene su dirección, '/t/<taller>' si cuelga del sitio de pruebas. */
  base: string;
}

const RESERVADOS = new Set(['www', 'pruebas', 'admin', 'api', 'app', 'demo']);

export function ubicacionDeTaller(ruta: string = window.location.pathname, host: string = window.location.hostname): UbicacionTaller | null {
  const porRuta = /^\/t\/([a-z0-9-]+)(\/|$)/.exec(ruta);
  if (porRuta?.[1]) return { slug: porRuta[1], base: `/t/${porRuta[1]}` };
  const partes = host.toLowerCase().split('.');
  const primera = partes[0] ?? '';
  if (partes.length >= 3 && !RESERVADOS.has(primera) && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(primera) && !/^\d+$/.test(primera)) return { slug: primera, base: '' };
  return null;
}

const ContextoUbicacion = createContext<UbicacionTaller | null>(null);
export const ProveedorUbicacion = ContextoUbicacion.Provider;
export function useUbicacion(): UbicacionTaller {
  const v = useContext(ContextoUbicacion);
  if (!v) throw new Error('useUbicacion debe usarse dentro de la aplicación del taller');
  return v;
}

const clave = (slug: string): string => `vt_taller_token_${slug}`;

export function leerTokenTaller(slug: string): string | null {
  try {
    return localStorage.getItem(clave(slug));
  } catch {
    return null;
  }
}

export function guardarTokenTaller(slug: string, token: string | null): void {
  try {
    if (token) localStorage.setItem(clave(slug), token);
    else localStorage.removeItem(clave(slug));
  } catch {
    // Sin almacenamiento: la sesión vive solo mientras la página siga abierta.
  }
}

export const EVENTO_SESION_TALLER_VENCIDA = 'vt-sesion-taller-vencida';

/** Cliente de la API del taller: pone la cabecera X-Taller y la sesión de ESTE taller. */
export function crearApiTaller(slug: string) {
  /** `archivo`: una foto o un PDF para subir tal cual (el cuerpo crudo); el nombre viaja en la cabecera X-Nombre-Archivo. */
  async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown, archivo?: { blob: Blob; nombre: string }): Promise<T> {
    const token = leerTokenTaller(slug);
    let respuesta: Response;
    try {
      respuesta = await fetch(`/api/taller${ruta}`, {
        method: metodo,
        headers: {
          'Content-Type': archivo ? archivo.blob.type : 'application/json',
          'X-Taller': slug,
          ...(archivo ? { 'X-Nombre-Archivo': encodeURIComponent(archivo.nombre) } : {}),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: archivo ? archivo.blob : cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      });
    } catch {
      throw new ErrorApi(0, 'SIN_CONEXION', 'No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.');
    }
    const json = (await respuesta.json().catch(() => null)) as { success?: boolean; data?: T; codigo?: string; error?: string; detalle?: unknown } | null;
    if (!respuesta.ok || !json?.success) {
      if (respuesta.status === 401 && token && json?.codigo === 'NO_AUTENTICADO') {
        guardarTokenTaller(slug, null);
        window.dispatchEvent(new Event(EVENTO_SESION_TALLER_VENCIDA));
      }
      throw new ErrorApi(respuesta.status, json?.codigo ?? 'ERROR', json?.error ?? 'No se pudo completar la operación', json?.detalle);
    }
    return json.data as T;
  }
  /** Baja un archivo (libro de Excel, .zip): pide con la sesión de este taller y devuelve el contenido con el nombre que sugiere el servidor. */
  async function bajar(ruta: string): Promise<{ blob: Blob; nombre: string }> {
    const token = leerTokenTaller(slug);
    let respuesta: Response;
    try {
      respuesta = await fetch(`/api/taller${ruta}`, { headers: { 'X-Taller': slug, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    } catch {
      throw new ErrorApi(0, 'SIN_CONEXION', 'No se pudo conectar con el servidor. Revise su conexión e intente de nuevo.');
    }
    if (!respuesta.ok) {
      const json = (await respuesta.json().catch(() => null)) as { codigo?: string; error?: string } | null;
      throw new ErrorApi(respuesta.status, json?.codigo ?? 'ERROR', json?.error ?? 'No se pudo descargar el archivo');
    }
    const nombre = /filename="([^"]+)"/.exec(respuesta.headers.get('Content-Disposition') ?? '')?.[1] ?? 'descarga';
    return { blob: await respuesta.blob(), nombre };
  }
  return {
    descargar: bajar,
    get: <T,>(ruta: string) => llamar<T>('GET', ruta),
    post: <T,>(ruta: string, cuerpo?: unknown) => llamar<T>('POST', ruta, cuerpo ?? {}),
    patch: <T,>(ruta: string, cuerpo: unknown) => llamar<T>('PATCH', ruta, cuerpo),
    put: <T,>(ruta: string, cuerpo: unknown) => llamar<T>('PUT', ruta, cuerpo),
    delete: <T,>(ruta: string) => llamar<T>('DELETE', ruta),
    subir: <T,>(ruta: string, blob: Blob, nombre: string) => llamar<T>('POST', ruta, undefined, { blob, nombre }),
  };
}
export type ApiTaller = ReturnType<typeof crearApiTaller>;
