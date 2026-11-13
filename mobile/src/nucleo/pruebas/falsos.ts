import { FetchLike } from '../http';
import { Almacen, AlmacenSeguro, Archivos, Imagenes, Reloj } from '../tipos';

/** Piezas falsas para probar el núcleo en la computadora, sin teléfono. */
export class AlmacenEnMemoria implements Almacen {
  readonly datos = new Map<string, string>();
  async leer<T>(clave: string): Promise<T | null> {
    const v = this.datos.get(clave);
    return v === undefined ? null : (JSON.parse(v) as T);
  }
  async escribir(clave: string, valor: unknown): Promise<void> {
    this.datos.set(clave, JSON.stringify(valor));
  }
  async borrar(clave: string): Promise<void> {
    this.datos.delete(clave);
  }
  async claves(prefijo: string): Promise<string[]> {
    return [...this.datos.keys()].filter((k) => k.startsWith(prefijo));
  }
}

export class SeguroEnMemoria implements AlmacenSeguro {
  readonly datos = new Map<string, string>();
  async leer(clave: string): Promise<string | null> {
    return this.datos.get(clave) ?? null;
  }
  async escribir(clave: string, valor: string): Promise<void> {
    this.datos.set(clave, valor);
  }
  async borrar(clave: string): Promise<void> {
    this.datos.delete(clave);
  }
}

export class RelojFalso implements Reloj {
  constructor(public actual = new Date('2026-12-01T15:00:00Z')) {}
  ahora(): Date {
    return new Date(this.actual);
  }
  avanzar(ms: number): void {
    this.actual = new Date(this.actual.getTime() + ms);
  }
}

export const generadorDeIds = (prefijo = 'id'): (() => string) => {
  let n = 0;
  return () => `${prefijo}-${String(++n).padStart(6, '0')}-xxxx`;
};

export class ArchivosEnMemoria implements Archivos {
  readonly archivos = new Map<string, Uint8Array>();
  descargas: Array<{ url: string; destino: string }> = [];
  /** Direcciones que fallan al descargar (para probar descargas parciales). */
  fallan = new Set<string>();
  constructor(private readonly raiz = 'file:///app/') {}
  carpeta(): string {
    return this.raiz;
  }
  poner(uri: string, bytes: Uint8Array = new Uint8Array([1, 2, 3])): void {
    this.archivos.set(uri, bytes);
  }
  async copiar(origen: string, destino: string): Promise<string> {
    const b = this.archivos.get(origen);
    if (!b) throw new Error(`No existe ${origen}`);
    this.archivos.set(destino, b);
    return destino;
  }
  async descargar(url: string, destino: string): Promise<string> {
    if (this.fallan.has(url)) throw new Error('No se pudo bajar');
    this.descargas.push({ url, destino });
    this.archivos.set(destino, new Uint8Array([9, 9]));
    return destino;
  }
  async leerBytes(uri: string): Promise<Uint8Array> {
    const b = this.archivos.get(uri);
    if (!b) throw new Error(`No existe ${uri}`);
    return b;
  }
  async existe(uri: string): Promise<boolean> {
    return this.archivos.has(uri);
  }
  async borrar(uri: string): Promise<void> {
    this.archivos.delete(uri);
  }
}

export class ImagenesFalsas implements Imagenes {
  llamadas: Array<{ uri: string; ancho: number }> = [];
  constructor(private readonly archivos: ArchivosEnMemoria) {}
  async reducir(uri: string, anchoMaximo: number) {
    this.llamadas.push({ uri, ancho: anchoMaximo });
    const nueva = uri.replace(/(\.\w+)?$/, `-${anchoMaximo}.jpg`);
    this.archivos.poner(nueva, new Uint8Array([7, 7, 7]));
    return { uri: nueva, ancho: anchoMaximo, alto: Math.round(anchoMaximo * 0.75) };
  }
}

export interface Llamada {
  metodo: string;
  ruta: string;
  cabeceras: Record<string, string>;
  cuerpo?: unknown;
  bytes?: Uint8Array;
}
export type Respuesta = { estado: number; json?: unknown; texto?: string; cabeceras?: Record<string, string> } | 'sin_senal' | 'colgar';
export type Manejador = (l: Llamada) => Respuesta | Promise<Respuesta>;

/** Un servidor falso: se le dice qué responder a cada ruta y anota lo que se le pidió. */
export class ServidorFalso {
  llamadas: Llamada[] = [];
  manejadores: Array<{ metodo: string; ruta: RegExp | string; manejar: Manejador }> = [];
  constructor(private readonly base = 'https://t.test/api/taller') {}

  en(metodo: string, ruta: RegExp | string, manejar: Manejador | Respuesta): this {
    this.manejadores.push({ metodo, ruta, manejar: typeof manejar === 'function' ? manejar : () => manejar });
    return this;
  }
  get baseUrl(): string {
    return this.base;
  }
  vaciar(): void {
    this.manejadores = [];
    this.llamadas = [];
  }
  readonly fetch: FetchLike = async (url, init) => {
    const ruta = url.slice(this.base.length);
    const cuerpo = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
    const llamada: Llamada = { metodo: init.method, ruta, cabeceras: init.headers, cuerpo, bytes: init.body instanceof Uint8Array ? init.body : undefined };
    this.llamadas.push(llamada);
    // Se usa el último manejador que coincida (así una prueba puede cambiar la respuesta a mitad de camino).
    const m = [...this.manejadores].reverse().find((x) => x.metodo === init.method && (typeof x.ruta === 'string' ? x.ruta === ruta : x.ruta.test(ruta)));
    const r: Respuesta = m ? await m.manejar(llamada) : { estado: 404, json: { success: false, codigo: 'NO_ENCONTRADO', error: 'No existe' } };
    if (r === 'sin_senal') throw new TypeError('Network request failed');
    if (r === 'colgar') {
      return new Promise((_resolver, rechazar) => {
        init.signal?.addEventListener('abort', () => rechazar(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      });
    }
    return {
      status: r.estado,
      headers: { get: (n: string) => r.cabeceras?.[n.toLowerCase()] ?? null },
      json: async () => {
        if (r.texto !== undefined) throw new SyntaxError('no es JSON');
        return r.json ?? null;
      },
    };
  };
}

export const ok = (data: unknown, estado = 200): Respuesta => ({ estado, json: { success: true, data } });
export const mal = (estado: number, codigo: string, error = 'No se pudo'): Respuesta => ({ estado, json: { success: false, codigo, error } });
