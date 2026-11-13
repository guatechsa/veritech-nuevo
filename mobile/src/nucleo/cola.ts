import { Almacen, clavesDe, Espacio, GeneradorDeId, Reloj } from './tipos';

/**
 * La cola de cambios que se hicieron en el teléfono y falta enviar. Es de CADA PERSONA en CADA TALLER (el espacio): otra persona que use el mismo teléfono
 * jamás ve ni envía lo de la primera. Cada cambio lleva un identificador propio que crea el teléfono, y así reenviarlo nunca lo duplica en el servidor.
 */
export type EstadoDeCambio = 'pendiente' | 'rechazado' | 'error';

export interface Cambio {
  id: string;
  /** Qué es, para mostrarlo en palabras («Terminar trabajo», «Foto del checklist»). */
  titulo: string;
  tipo: string;
  metodo: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  ruta: string;
  cuerpo?: unknown;
  /** Una foto u otro archivo guardado en la carpeta de la app. */
  archivo?: { uri: string; mime: string; nombre: string };
  /** Si este cambio necesita que otro se haya aplicado primero (por ejemplo, completar un checklist necesita sus respuestas). */
  dependeDe?: string;
  hechoEn: string;
  estado: EstadoDeCambio;
  intentos: number;
  /** Lo que dijo el servidor si lo rechazó. */
  motivo?: string;
  /** Datos propios de quien lo creó (por ejemplo, de qué checklist es la foto) para actualizar la pantalla al enviarse. */
  contexto?: Record<string, unknown>;
}

export type NuevoCambio = Omit<Cambio, 'id' | 'hechoEn' | 'estado' | 'intentos' | 'motivo'>;

export class Cola {
  private cambios: Cambio[] | null = null;
  private oyentes = new Set<() => void>();
  /** Todo cambio se encadena: dos escrituras a la vez no se pisan. */
  private cadena: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly almacen: Almacen,
    private readonly espacio: Espacio,
    private readonly nuevoId: GeneradorDeId,
    private readonly reloj: Reloj
  ) {}

  private clave(): string {
    return clavesDe(this.espacio, 'cola');
  }

  private async cargar(): Promise<Cambio[]> {
    if (!this.cambios) this.cambios = (await this.almacen.leer<Cambio[]>(this.clave())) ?? [];
    return this.cambios;
  }

  private serializar<T>(trabajo: () => Promise<T>): Promise<T> {
    const r = this.cadena.then(trabajo, trabajo);
    this.cadena = r.catch(() => undefined);
    return r;
  }

  private async guardar(): Promise<void> {
    await this.almacen.escribir(this.clave(), this.cambios ?? []);
    for (const o of this.oyentes) o();
  }

  /** Avisa cada vez que la cola cambia (la pantalla se actualiza). Devuelve cómo dejar de escuchar. */
  escuchar(oyente: () => void): () => void {
    this.oyentes.add(oyente);
    return () => this.oyentes.delete(oyente);
  }

  encolar(nuevo: NuevoCambio): Promise<Cambio> {
    return this.serializar(async () => {
      const lista = await this.cargar();
      const cambio: Cambio = { ...nuevo, id: this.nuevoId(), hechoEn: this.reloj.ahora().toISOString(), estado: 'pendiente', intentos: 0 };
      lista.push(cambio);
      await this.guardar();
      return cambio;
    });
  }

  async todos(): Promise<Cambio[]> {
    await this.cadena;
    return [...(await this.cargar())];
  }

  async pendientes(): Promise<Cambio[]> {
    return (await this.todos()).filter((c) => c.estado === 'pendiente');
  }

  /** Cuántos cambios hay sin enviar (pendientes, con error o rechazados): sirve para avisar antes de cerrar la sesión. */
  async sinEnviar(): Promise<number> {
    return (await this.todos()).length;
  }

  actualizar(id: string, cambios: Partial<Pick<Cambio, 'estado' | 'intentos' | 'motivo'>>): Promise<void> {
    return this.serializar(async () => {
      const lista = await this.cargar();
      const c = lista.find((x) => x.id === id);
      if (!c) return;
      Object.assign(c, cambios);
      await this.guardar();
    });
  }

  /** Quita un cambio (ya se envió o la persona lo descartó). */
  quitar(id: string): Promise<void> {
    return this.serializar(async () => {
      const lista = await this.cargar();
      this.cambios = lista.filter((c) => c.id !== id);
      await this.guardar();
    });
  }

  /** Vuelve a poner en espera un cambio con error o rechazado para intentarlo otra vez. */
  reintentar(id: string): Promise<void> {
    return this.actualizar(id, { estado: 'pendiente', intentos: 0, motivo: undefined });
  }

  /** Borra TODO lo de esta persona (solo después de avisarle y que confirme). */
  vaciar(): Promise<void> {
    return this.serializar(async () => {
      this.cambios = [];
      await this.almacen.borrar(this.clave());
      for (const o of this.oyentes) o();
    });
  }
}
