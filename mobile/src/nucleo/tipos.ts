/**
 * Lo que el núcleo de la app necesita del teléfono, escrito como interfaces: así toda la lógica delicada (sesión, cola, sincronización, fotos, «mi día»)
 * se prueba en la computadora con piezas falsas, sin teléfono. Las piezas reales viven en `src/plataforma`.
 */

/** Guarda valores por clave (en el teléfono: una tabla de SQLite). */
export interface Almacen {
  leer<T>(clave: string): Promise<T | null>;
  escribir(clave: string, valor: unknown): Promise<void>;
  borrar(clave: string): Promise<void>;
  /** Las claves que empiezan con el prefijo. */
  claves(prefijo: string): Promise<string[]>;
}

/** Guarda secretos (las llaves de la sesión) en el almacén seguro del sistema. */
export interface AlmacenSeguro {
  leer(clave: string): Promise<string | null>;
  escribir(clave: string, valor: string): Promise<void>;
  borrar(clave: string): Promise<void>;
}

/** Archivos del teléfono: las fotos y lo que se baja del servidor viven en la carpeta propia de la app (el sistema no las borra). */
export interface Archivos {
  /** Copia un archivo a la carpeta de la app y devuelve su nueva dirección. */
  copiar(origen: string, destino: string): Promise<string>;
  /** Baja una dirección del servidor a la carpeta de la app. */
  descargar(url: string, destino: string, cabeceras?: Record<string, string>): Promise<string>;
  leerBytes(uri: string): Promise<Uint8Array>;
  existe(uri: string): Promise<boolean>;
  borrar(uri: string): Promise<void>;
  /** La carpeta de la app donde se guardan los archivos (termina en «/»). */
  carpeta(): string;
}

/** Reduce una foto (ancho máximo) y devuelve la dirección de la nueva. */
export interface Imagenes {
  reducir(uri: string, anchoMaximo: number): Promise<{ uri: string; ancho: number; alto: number }>;
}

export interface Reloj {
  ahora(): Date;
}

export type GeneradorDeId = () => string;

/** El taller y la persona a la que pertenece TODO lo que hay guardado: nada se mezcla entre personas ni entre talleres. */
export interface Espacio {
  taller: string;
  usuarioId: number;
}

export const clavesDe = (e: Espacio, nombre: string): string => `${e.taller}:${e.usuarioId}:${nombre}`;
export const prefijoDe = (e: Espacio): string => `${e.taller}:${e.usuarioId}:`;

export interface Sesion {
  token: string;
  venceEn: string;
  refresco: string;
  refrescoVenceEn: string;
  espacio: Espacio;
  nombre: string;
  permisos: string[];
}

export interface Telefono {
  instalacion: string;
  plataforma: 'android' | 'ios';
  nombre?: string | null;
  version_app?: string | null;
  token_push?: string | null;
}
