import { Cambio, Cola } from './cola';
import { ClienteApi } from './cliente';
import { ErrorDeRed, ErrorDelServidor, SesionVencida, TipoDeRed } from './errores';
import { Archivos, Reloj } from './tipos';

/**
 * El motor que envía la cola. Reglas (de lo aprendido en la app anterior):
 *  - UN solo envío a la vez (aunque lo pidan varias pantallas): nunca se manda lo mismo dos veces a la vez.
 *  - Se envía en orden. Sin señal, se detiene y TODO queda pendiente (no se pierde ni se marca como error).
 *  - Un rechazo del servidor (400, 403, 404, 409…) NO se reintenta solo: el cambio queda «rechazado» con el motivo, a la vista de la persona, y los demás siguen.
 *  - Un cambio que depende de otro rechazado también se rechaza (no se manda algo que no puede aplicarse).
 *  - Un error del servidor (caído) se reintenta con calma; tras 5 intentos pasa a «error» visible.
 *  - Una sesión vencida detiene todo SIN borrar nada: al ingresar de nuevo la misma persona, lo pendiente se envía.
 */
export interface EstadoDeSincronizacion {
  sincronizando: boolean;
  pendientes: number;
  conError: number;
  rechazados: number;
  ultimaSincronizacion: string | null;
  red: 'ok' | TipoDeRed;
  sesionVencida: boolean;
}

export interface ResultadoDeSincronizacion {
  enviados: number;
  rechazados: number;
  detenidoPor: 'red' | 'sesion' | null;
}

export interface OpcionesDelSincronizador {
  cola: Cola;
  cliente: ClienteApi;
  archivos: Archivos;
  reloj: Reloj;
  /** Se llama con cada cambio ya aplicado en el servidor (para actualizar lo guardado en el teléfono con la respuesta real). */
  alAplicar?: (cambio: Cambio, respuesta: unknown) => Promise<void>;
  alRechazar?: (cambio: Cambio, motivo: string) => Promise<void>;
  /** Al terminar una tanda en la que se envió o se rechazó algo: la app vuelve a bajar el día (así lo que ya está en el servidor reemplaza a lo que se hizo en el teléfono). Se lanza aparte: no demora el envío. */
  alTerminar?: (resultado: ResultadoDeSincronizacion) => Promise<void>;
  maximoDeIntentos?: number;
}

export class Sincronizador {
  private enCurso: Promise<ResultadoDeSincronizacion> | null = null;
  /** Alguien pidió enviar mientras ya se estaba enviando: hay que pasar otra vez (un cambio nuevo no espera al siguiente aviso del reloj). */
  private otraVez = false;
  private red: EstadoDeSincronizacion['red'] = 'ok';
  private sesionVencida = false;
  private ultima: string | null = null;
  private oyentes = new Set<() => void>();

  constructor(private readonly o: OpcionesDelSincronizador) {
    o.cola.escuchar(() => this.avisar());
  }

  escuchar(oyente: () => void): () => void {
    this.oyentes.add(oyente);
    return () => this.oyentes.delete(oyente);
  }

  private avisar(): void {
    for (const f of this.oyentes) f();
  }

  async estado(): Promise<EstadoDeSincronizacion> {
    const todos = await this.o.cola.todos();
    return {
      sincronizando: this.enCurso !== null,
      pendientes: todos.filter((c) => c.estado === 'pendiente').length,
      conError: todos.filter((c) => c.estado === 'error').length,
      rechazados: todos.filter((c) => c.estado === 'rechazado').length,
      ultimaSincronizacion: this.ultima,
      red: this.red,
      sesionVencida: this.sesionVencida,
    };
  }

  /** La persona volvió a ingresar: se puede volver a enviar. */
  sesionRenovada(): void {
    this.sesionVencida = false;
    this.avisar();
  }

  /** Envía lo pendiente. Si ya hay un envío en curso, no empieza otro en paralelo: pide una pasada más al terminar (así lo que se acaba de hacer también sale). */
  sincronizar(): Promise<ResultadoDeSincronizacion> {
    if (this.enCurso) {
      this.otraVez = true;
    } else {
      this.enCurso = this.correr().then((r) => {
        if (r.enviados + r.rechazados > 0 && this.o.alTerminar) void this.o.alTerminar(r).catch(() => undefined);
        return r;
      }).finally(() => {
        this.enCurso = null;
        this.avisar();
      });
    }
    this.avisar();
    return this.enCurso;
  }

  private async correr(): Promise<ResultadoDeSincronizacion> {
    let total = await this.enviar();
    // Solo se repite si la pasada llegó hasta el final (sin señal o sin sesión no tiene caso insistir).
    while (this.otraVez && total.detenidoPor === null) {
      this.otraVez = false;
      const x = await this.enviar();
      total = { enviados: total.enviados + x.enviados, rechazados: total.rechazados + x.rechazados, detenidoPor: x.detenidoPor };
    }
    this.otraVez = false;
    return total;
  }

  private async enviar(): Promise<ResultadoDeSincronizacion> {
    const resultado: ResultadoDeSincronizacion = { enviados: 0, rechazados: 0, detenidoPor: null };
    if (this.sesionVencida) return { ...resultado, detenidoPor: 'sesion' };
    const maximo = this.o.maximoDeIntentos ?? 5;
    for (const c of await this.o.cola.pendientes()) {
      const todos = await this.o.cola.todos();
      const actual = todos.find((x) => x.id === c.id);
      if (!actual || actual.estado !== 'pendiente') continue;
      if (c.dependeDe) {
        const previo = todos.find((x) => x.id === c.dependeDe);
        if (previo && previo.estado !== 'pendiente') {
          await this.rechazar(c, 'Depende de un cambio anterior que no se pudo enviar.');
          resultado.rechazados += 1;
          continue;
        }
        if (previo) continue; // todavía pendiente (no debería pasar: va antes en la fila)
      }
      try {
        let binario: { bytes: Uint8Array; mime: string; nombre: string } | undefined;
        if (c.archivo) {
          if (!(await this.o.archivos.existe(c.archivo.uri))) {
            await this.rechazar(c, 'La foto ya no está en el teléfono.');
            resultado.rechazados += 1;
            continue;
          }
          binario = { bytes: await this.o.archivos.leerBytes(c.archivo.uri), mime: c.archivo.mime, nombre: c.archivo.nombre };
        }
        const respuesta = await this.o.cliente.solicitar(c.metodo, c.ruta, { cuerpo: c.cuerpo, binario, idCliente: c.id, hechoEn: new Date(c.hechoEn) });
        await this.o.cola.quitar(c.id);
        this.red = 'ok';
        resultado.enviados += 1;
        this.ultima = this.o.reloj.ahora().toISOString();
        try {
          await this.o.alAplicar?.(c, respuesta);
        } catch (error) {
          console.error('[sincronizador] no se pudo actualizar lo guardado', c.id, error instanceof Error ? error.message : error);
        }
      } catch (error) {
        if (error instanceof SesionVencida) {
          this.sesionVencida = true;
          resultado.detenidoPor = 'sesion';
          break;
        }
        if (error instanceof ErrorDeRed) {
          this.red = error.tipo;
          // Sin señal o señal débil: no cuenta como intento (no es culpa del cambio). Un servidor caído sí, para no insistir para siempre.
          if (error.tipo === 'servidor_caido') {
            const intentos = c.intentos + 1;
            await this.o.cola.actualizar(c.id, intentos >= maximo ? { estado: 'error', intentos, motivo: error.message } : { intentos });
          }
          resultado.detenidoPor = 'red';
          break;
        }
        if (error instanceof ErrorDelServidor) {
          if (error.codigo === 'EN_PROCESO') continue; // el primer intento sigue en el servidor: se vuelve a preguntar después
          await this.rechazar(c, error.message);
          resultado.rechazados += 1;
          continue;
        }
        await this.o.cola.actualizar(c.id, { estado: 'error', motivo: error instanceof Error ? error.message : 'Error desconocido' });
      }
    }
    return resultado;
  }

  private async rechazar(c: Cambio, motivo: string): Promise<void> {
    await this.o.cola.actualizar(c.id, { estado: 'rechazado', motivo });
    try {
      await this.o.alRechazar?.(c, motivo);
    } catch {
      // lo guardado se corrige en la siguiente descarga del día
    }
  }
}
