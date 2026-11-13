import { ErrorDeRed, ErrorDelServidor } from './errores';
import { FetchLike, hacerPeticion } from './http';
import { GestorDeSesion } from './sesion';

/**
 * El cliente de la API del taller: pone el taller y la sesión, renueva la sesión UNA vez si el token venció y reintenta, y reparte los errores en
 * «de red» (se reintenta más tarde) y «del servidor» (se le muestra a la persona).
 */
export interface OpcionesDeCliente {
  baseUrl: string;
  taller: string;
  fetch: FetchLike;
  sesion: GestorDeSesion;
  limiteMs?: number;
  limiteDeSubidaMs?: number;
}

export interface OpcionesDeLlamada {
  cuerpo?: unknown;
  /** Una foto o un archivo: se manda tal cual, con su tipo. */
  binario?: { bytes: Uint8Array; mime: string; nombre: string };
  /** Identificador del cambio (lo crea el teléfono): reenviarlo nunca lo duplica. */
  idCliente?: string;
  /** Cuándo se hizo el cambio en el teléfono. */
  hechoEn?: Date;
}

export class ClienteApi {
  constructor(private readonly o: OpcionesDeCliente) {}

  async solicitar<T>(metodo: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE', ruta: string, opciones: OpcionesDeLlamada = {}): Promise<T> {
    const intentar = async (token: string | null) => {
      const cabeceras: Record<string, string> = { 'X-Taller': this.o.taller };
      if (token) cabeceras['Authorization'] = `Bearer ${token}`;
      if (opciones.idCliente) cabeceras['X-Id-Cliente'] = opciones.idCliente;
      if (opciones.hechoEn) cabeceras['X-Hecho-En'] = opciones.hechoEn.toISOString();
      if (opciones.binario) cabeceras['X-Nombre-Archivo'] = encodeURIComponent(opciones.binario.nombre);
      return hacerPeticion(this.o.fetch, {
        metodo,
        url: `${this.o.baseUrl}${ruta}`,
        cabeceras,
        cuerpo: opciones.cuerpo,
        binario: opciones.binario ? { bytes: opciones.binario.bytes, mime: opciones.binario.mime } : undefined,
        limiteMs: opciones.binario ? (this.o.limiteDeSubidaMs ?? 90000) : (this.o.limiteMs ?? 15000),
      });
    };
    let r = await intentar(await this.o.sesion.token());
    // El token venció o se cambió: se renueva UNA vez (si no se puede, sube el error: red = se conserva todo; vencida = ingresar de nuevo) y se reintenta.
    if (r.estado === 401 && r.json?.codigo === 'NO_AUTENTICADO') {
      await this.o.sesion.refrescar();
      r = await intentar(await this.o.sesion.token());
    }
    if (r.estado === 429) {
      throw new ErrorDeRed('servidor_caido', 'Demasiados intentos. Intente en unos minutos.');
    }
    if (r.estado >= 200 && r.estado < 300 && r.json?.success !== false) return (r.json?.data ?? null) as T;
    throw new ErrorDelServidor(r.estado, r.json?.codigo ?? 'ERROR', r.json?.error ?? 'No se pudo completar la operación', r.json?.detalle);
  }

  get<T>(ruta: string): Promise<T> {
    return this.solicitar<T>('GET', ruta);
  }
}
