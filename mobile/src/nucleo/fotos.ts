import { Almacen, Archivos, clavesDe, Espacio, Imagenes } from './tipos';

/**
 * Fotos confiables (lo aprendido de la app anterior: la dirección temporal de la cámara puede borrarse antes de que vuelva la señal, y una foto a resolución
 * completa son varios MB por datos móviles). Cada foto se REDUCE a 1.600 px de ancho y se COPIA de inmediato a la carpeta propia de la app, con un número;
 * solo entonces cuenta como «puesta». El envío al servidor sale en segundo plano con la cola (con reintentos).
 */
export const ANCHO_MAXIMO = 1600;

export class Fotos {
  constructor(private readonly o: { almacen: Almacen; archivos: Archivos; imagenes: Imagenes; espacio: Espacio }) {}

  private async siguienteNumero(): Promise<number> {
    const clave = clavesDe(this.o.espacio, 'fotos:contador');
    const n = ((await this.o.almacen.leer<number>(clave)) ?? 0) + 1;
    await this.o.almacen.escribir(clave, n);
    return n;
  }

  /** Reduce y guarda una foto recién tomada. Devuelve dónde quedó y con qué nombre se enviará. */
  async preparar(uriOriginal: string, prefijo: string): Promise<{ uri: string; nombre: string; mime: 'image/jpeg' }> {
    const reducida = await this.o.imagenes.reducir(uriOriginal, ANCHO_MAXIMO);
    const n = await this.siguienteNumero();
    const nombre = `${prefijo}-${String(n).padStart(4, '0')}.jpg`;
    const uri = await this.o.archivos.copiar(reducida.uri, `${this.o.archivos.carpeta()}fotos/${this.o.espacio.taller}-${this.o.espacio.usuarioId}-${nombre}`);
    // La de la cámara (y la reducida, si es otra) ya no se necesitan: la única copia que importa es la de la carpeta de la app.
    for (const sobra of new Set([uriOriginal, reducida.uri])) {
      if (sobra !== uri) await this.o.archivos.borrar(sobra).catch(() => undefined);
    }
    return { uri, nombre, mime: 'image/jpeg' };
  }
}
