import { ErrorDeRed } from './errores';

/**
 * Una llamada al servidor con TIEMPO LÍMITE y errores que dicen la verdad: sin señal, señal débil (no respondió a tiempo) o servidor caído. Lo demás
 * (400, 403, 404, 409…) es una respuesta del servidor y la maneja quien llama.
 */
export interface Peticion {
  metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  url: string;
  cabeceras?: Record<string, string>;
  cuerpo?: unknown;
  binario?: { bytes: Uint8Array; mime: string };
  limiteMs: number;
}

export interface Respuesta {
  estado: number;
  json: { success?: boolean; data?: unknown; codigo?: string; error?: string; detalle?: unknown } | null;
  cabeceras: { get(nombre: string): string | null };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string | Uint8Array; signal?: AbortSignal }) => Promise<{
  status: number;
  headers: { get(nombre: string): string | null };
  json(): Promise<unknown>;
}>;

export async function hacerPeticion(fetchFn: FetchLike, p: Peticion): Promise<Respuesta> {
  const control = new AbortController();
  const temporizador = setTimeout(() => control.abort(), p.limiteMs);
  try {
    const cabeceras: Record<string, string> = { Accept: 'application/json', ...(p.cabeceras ?? {}) };
    let cuerpo: string | Uint8Array | undefined;
    if (p.binario) {
      cabeceras['Content-Type'] = p.binario.mime;
      cuerpo = p.binario.bytes;
    } else if (p.cuerpo !== undefined) {
      cabeceras['Content-Type'] = 'application/json';
      cuerpo = JSON.stringify(p.cuerpo);
    }
    let r;
    try {
      r = await fetchFn(p.url, { method: p.metodo, headers: cabeceras, body: cuerpo, signal: control.signal });
    } catch (error) {
      if (control.signal.aborted || (error instanceof Error && error.name === 'AbortError')) throw new ErrorDeRed('senal_debil');
      throw new ErrorDeRed('sin_senal');
    }
    let json: Respuesta['json'] = null;
    try {
      json = (await r.json()) as Respuesta['json'];
    } catch (error) {
      if (control.signal.aborted) throw new ErrorDeRed('senal_debil');
      json = null; // un cuerpo que no es JSON (por ejemplo la página de error de un proxy)
    }
    // Un error del servidor (5xx) o una respuesta que no es de nuestro sistema: se trata como «servidor caído» y se reintenta.
    if (r.status >= 500 || (json === null && r.status !== 204)) throw new ErrorDeRed('servidor_caido');
    return { estado: r.status, json, cabeceras: r.headers };
  } finally {
    clearTimeout(temporizador);
  }
}
