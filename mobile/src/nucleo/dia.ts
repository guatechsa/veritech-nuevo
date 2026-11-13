import { Cambio, Cola } from './cola';
import { ClienteApi } from './cliente';
import { Almacen, Archivos, clavesDe, Espacio, Reloj } from './tipos';

/**
 * «Descargar mi día»: la app baja del servidor TODO lo que la persona necesita para trabajar sin señal (sus trabajos, las órdenes, los checklists con su
 * plantilla, las fichas de los equipos, y para bodega y recepción lo suyo) y también las fotos y documentos (sus direcciones vencen a la hora: por eso se
 * copian al teléfono). Lo bajado NUNCA se edita aquí: la pantalla ve «lo bajado + los cambios todavía sin enviar», así bajar de nuevo nunca pierde lo que la
 * persona hizo sin señal.
 */
export interface RespuestaDeChecklist {
  id: number;
  seccion: string;
  descripcion: string;
  tipo_respuesta: 'semaforo' | 'si_no' | 'numero' | 'texto' | 'lista';
  semaforo: 'verde' | 'amarillo' | 'rojo' | null;
  si_no: number | null;
  valor_numero: number | null;
  valor_texto: string | null;
  opcion_texto: string | null;
  nota: string | null;
  opciones: string[];
  fotos: Array<{ id: number; url: string }>;
  /** Fotos tomadas en el teléfono que todavía no se han enviado (las pone la app). */
  fotos_locales?: Array<{ uri: string }>;
}

export interface EstadoDeOrden {
  id: number;
  codigo: string;
  nombre: string;
  es_inicial: number;
  es_terminal: number;
  es_cancelado: number;
  /** 1 = en este estado el equipo ya salió del taller (es el estado de «entregar»). */
  sale_equipo: number;
}

/** Listas que se bajan con «Mi día» para trabajar sin señal (solo las que los permisos de la persona permiten usar). */
export interface Catalogos {
  materiales?: Array<{ id: number; codigo: string; nombre: string; unidad: string }>;
  estados_orden?: EstadoDeOrden[];
  tipos_orden?: Array<{ id: number; codigo: string; nombre: string; es_default: number; es_pedido_especial: number }>;
  checklist_tipos?: Array<{ id: number; nombre: string; etapa: string; requiere_orden: number; requiere_firma_cliente: number }>;
}

/** Una solicitud de material tal como la baja el servidor (con la existencia de cada bodega de la sucursal, para elegir de dónde despachar). */
export interface SolicitudDeMaterial {
  id: number;
  numero: string;
  orden_id: number;
  orden: string;
  sucursal: string;
  solicitante: string | null;
  estado: string;
  lineas: Array<{
    id: number;
    material_id: number;
    codigo: string;
    nombre: string;
    unidad: string;
    cantidad_solicitada: number;
    cantidad_despachada: number;
    pendiente: number;
    por_bodega: Array<{ bodega_id: number; bodega: string; cantidad: number }>;
  }>;
  [clave: string]: unknown;
}

export interface Checklist {
  id: number;
  tipo: string;
  orden_id: number | null;
  equipo_id: number;
  estado: 'pendiente' | 'en_progreso' | 'completado';
  exige_lectura_contador: boolean;
  requiere_firma_cliente: boolean;
  /** La firma que ya está en el servidor. */
  firma?: { firmante_nombre: string } | null;
  /** La firma tomada en el teléfono que todavía no se envió (la pone la app). */
  firma_local?: { nombre: string };
  total: number;
  respondidas: number;
  respuestas: RespuestaDeChecklist[];
  [clave: string]: unknown;
}

export interface Trabajo {
  id: number;
  orden_id: number;
  numero: string;
  descripcion: string;
  estado: string;
  equipo: string;
  fotos: Array<{ id: number; tipo: string; url: string }>;
  fotos_locales?: Array<{ uri: string; tipo: string }>;
  [clave: string]: unknown;
}

export interface MiDia {
  descargado_en: string;
  hoy: string;
  usuario: { id: number; nombre: string; roles: string[] };
  trabajos?: { colaborador_id: number | null; ocupado: boolean; trabajos: Trabajo[] };
  ordenes: Array<{ id: number; numero: string; equipo_id?: number; lineas?: Array<{ id: number; estado: string; [clave: string]: unknown }>; [clave: string]: unknown }>;
  checklists: Checklist[];
  equipos: Array<{ id: number; contadores?: Array<{ id: number; valor_actual: number | null; [clave: string]: unknown }>; [clave: string]: unknown }>;
  solicitudes?: SolicitudDeMaterial[];
  catalogos?: Catalogos;
  citas?: Array<{ id: number; [clave: string]: unknown }>;
  ordenes_abiertas?: Array<{ id: number; [clave: string]: unknown }>;
  equipos_asignados?: number[];
  archivos: string[];
  incompleto: string[];
  [clave: string]: unknown;
}

interface Guardado {
  datos: MiDia;
  /** La dirección estable de cada archivo → dónde quedó en el teléfono. */
  archivos: Record<string, string>;
  faltan: string[];
}

export interface ResultadoDeDescarga {
  descargado_en: string;
  fotos: number;
  fotosFaltan: number;
  partesIncompletas: string[];
}

/** Las direcciones de archivos traen una firma que cambia: la dirección estable es la que va antes del «?». */
export const claveDeArchivo = (url: string): string => url.split('?')[0]!;

export class Dia {
  constructor(
    private readonly o: { almacen: Almacen; espacio: Espacio; cliente: ClienteApi; archivos: Archivos; cola: Cola; reloj: Reloj; aplicarCambio: (d: MiDia, c: Cambio) => MiDia }
  ) {}

  private oyentes = new Set<() => void>();

  /** Avisa cuando el día se vuelve a guardar (para que las pantallas se actualicen solas). */
  escuchar(f: () => void): () => void {
    this.oyentes.add(f);
    return () => this.oyentes.delete(f);
  }

  private clave(): string {
    return clavesDe(this.o.espacio, 'dia');
  }

  /** Baja el día. Si algo falla a medias (por ejemplo, una foto), lo demás se guarda igual y se dice qué faltó. */
  async descargar(): Promise<ResultadoDeDescarga> {
    const datos = await this.o.cliente.get<MiDia>('/movil/mi-dia');
    const previo = await this.o.almacen.leer<Guardado>(this.clave());
    const archivos: Record<string, string> = { ...(previo?.archivos ?? {}) };
    const faltan: string[] = [];
    let nuevas = 0;
    for (const url of datos.archivos) {
      const k = claveDeArchivo(url);
      if (archivos[k] && (await this.o.archivos.existe(archivos[k]!))) continue; // ya está en el teléfono
      try {
        archivos[k] = await this.o.archivos.descargar(url, `${this.o.archivos.carpeta()}servidor/${nombreSeguro(k)}`);
        nuevas += 1;
      } catch {
        faltan.push(k);
      }
    }
    await this.o.almacen.escribir(this.clave(), { datos, archivos, faltan } satisfies Guardado);
    for (const f of this.oyentes) f();
    return { descargado_en: datos.descargado_en, fotos: nuevas, fotosFaltan: faltan.length, partesIncompletas: datos.incompleto };
  }

  async hayDia(): Promise<boolean> {
    return (await this.o.almacen.leer<Guardado>(this.clave())) !== null;
  }

  /** Lo que ve la pantalla: lo bajado más los cambios sin enviar (pendientes). */
  async ver(): Promise<{ datos: MiDia; descargadoHace: number; faltan: string[] } | null> {
    const g = await this.o.almacen.leer<Guardado>(this.clave());
    if (!g) return null;
    let datos = g.datos;
    for (const c of await this.o.cola.pendientes()) datos = this.o.aplicarCambio(datos, c);
    return { datos, descargadoHace: this.o.reloj.ahora().getTime() - Date.parse(g.datos.descargado_en), faltan: g.faltan };
  }

  /** La dirección en el teléfono de un archivo del servidor (o la dirección original si no se pudo bajar). */
  async uriLocal(url: string): Promise<string> {
    const g = await this.o.almacen.leer<Guardado>(this.clave());
    return g?.archivos[claveDeArchivo(url)] ?? url;
  }

  async borrarTodo(): Promise<void> {
    await this.o.almacen.borrar(this.clave());
  }
}

const nombreSeguro = (clave: string): string => clave.replace(/^\/api\/archivos\//, '').replace(/[^A-Za-z0-9_-]/g, '_') + '.bin';
