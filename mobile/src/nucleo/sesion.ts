import { ErrorDeRed, ErrorDelServidor, SesionVencida } from './errores';
import { FetchLike, hacerPeticion } from './http';
import { AlmacenSeguro, Reloj, Sesion, Telefono } from './tipos';

/**
 * La sesión de la persona. Entrar da un token corto y un refresco largo que se guardan en el almacén SEGURO del teléfono; la contraseña NUNCA se guarda.
 * Renovar es de «un solo vuelo» (si varias pantallas lo piden a la vez, se renueva una sola vez). Una caída de red al renovar NUNCA cierra la sesión: solo
 * un rechazo del servidor la cierra, y aun así lo pendiente de esa persona se conserva (vive en su propio espacio de datos).
 */
export interface OpcionesDeSesion {
  baseUrl: string;
  taller: string;
  fetch: FetchLike;
  seguro: AlmacenSeguro;
  reloj: Reloj;
  telefono: () => Promise<Telefono>;
  limiteMs?: number;
  /** Se avisa a la pantalla cuando la sesión ya no se puede renovar. */
  alVencer?: () => void;
}

interface PerfilServidor {
  usuario: { id: number; nombre: string };
  permisos: string[];
}

const SIN_LIMITE_PREVISTO = 15000;

export class GestorDeSesion {
  private actual: Sesion | null | undefined;
  private renovando: Promise<void> | null = null;

  constructor(private readonly o: OpcionesDeSesion) {}

  private clave(nombre: string): string {
    return `${nombre}:${this.o.taller}`;
  }

  private url(ruta: string): string {
    return `${this.o.baseUrl}${ruta}`;
  }

  private cabeceras(token?: string): Record<string, string> {
    return { 'X-Taller': this.o.taller, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  }

  /** Lo que hay guardado (nulo si nunca entró o ya salió). */
  async cargar(): Promise<Sesion | null> {
    if (this.actual !== undefined) return this.actual;
    const texto = await this.o.seguro.leer(this.clave('sesion'));
    this.actual = texto ? (JSON.parse(texto) as Sesion) : null;
    return this.actual;
  }

  async token(): Promise<string | null> {
    return (await this.cargar())?.token ?? null;
  }

  private async guardar(s: Sesion | null): Promise<void> {
    this.actual = s;
    if (s) await this.o.seguro.escribir(this.clave('sesion'), JSON.stringify(s));
    else await this.o.seguro.borrar(this.clave('sesion'));
  }

  async correoRecordado(): Promise<string | null> {
    return this.o.seguro.leer(this.clave('correo'));
  }

  async ingresar(correo: string, contrasena: string, recordar: boolean): Promise<Sesion> {
    const limiteMs = this.o.limiteMs ?? SIN_LIMITE_PREVISTO;
    const r = await hacerPeticion(this.o.fetch, { metodo: 'POST', url: this.url('/auth/ingresar-movil'), cabeceras: this.cabeceras(), cuerpo: { correo: correo.trim(), contrasena, dispositivo: await this.o.telefono() }, limiteMs });
    if (r.estado !== 200 || !r.json?.success) throw new ErrorDelServidor(r.estado, r.json?.codigo ?? 'ERROR', r.json?.error ?? 'No se pudo ingresar');
    const d = r.json.data as { token: string; vence_en: string; refresco: string; refresco_vence_en: string };
    const yo = await hacerPeticion(this.o.fetch, { metodo: 'GET', url: this.url('/auth/yo'), cabeceras: this.cabeceras(d.token), limiteMs });
    if (yo.estado !== 200 || !yo.json?.success) throw new ErrorDelServidor(yo.estado, yo.json?.codigo ?? 'ERROR', yo.json?.error ?? 'No se pudo ingresar');
    const perfil = yo.json.data as PerfilServidor;
    const sesion: Sesion = { token: d.token, venceEn: d.vence_en, refresco: d.refresco, refrescoVenceEn: d.refresco_vence_en, espacio: { taller: this.o.taller, usuarioId: perfil.usuario.id }, nombre: perfil.usuario.nombre, permisos: perfil.permisos };
    await this.guardar(sesion);
    // «Recordar» guarda SOLO el correo.
    if (recordar) await this.o.seguro.escribir(this.clave('correo'), correo.trim());
    else await this.o.seguro.borrar(this.clave('correo'));
    return sesion;
  }

  /** Renueva el token con el refresco. Varias peticiones a la vez comparten UNA sola renovación. */
  refrescar(): Promise<void> {
    this.renovando ??= this.renovar().finally(() => {
      this.renovando = null;
    });
    return this.renovando;
  }

  private async renovar(): Promise<void> {
    const s = await this.cargar();
    if (!s) throw new SesionVencida();
    const r = await hacerPeticion(this.o.fetch, { metodo: 'POST', url: this.url('/auth/refrescar-movil'), cabeceras: this.cabeceras(), cuerpo: { refresco: s.refresco }, limiteMs: this.o.limiteMs ?? SIN_LIMITE_PREVISTO });
    // Si hacerPeticion lanzó un ErrorDeRed (sin señal, caído), sube tal cual: la sesión NO se toca.
    if (r.estado === 200 && r.json?.success) {
      const d = r.json.data as { token: string; vence_en: string; refresco: string; refresco_vence_en: string };
      await this.guardar({ ...s, token: d.token, venceEn: d.vence_en, refresco: d.refresco, refrescoVenceEn: d.refresco_vence_en });
      return;
    }
    if (r.estado === 429) throw new ErrorDeRed('servidor_caido', 'Demasiados intentos. Intente en unos minutos.');
    if (r.estado !== 401) throw new ErrorDelServidor(r.estado, r.json?.codigo ?? 'ERROR', r.json?.error ?? 'No se pudo renovar la sesión');
    // El servidor dijo que ese refresco ya no sirve (401): se cierra la sesión (las llaves se borran; los datos pendientes quedan).
    await this.guardar(null);
    this.o.alVencer?.();
    throw new SesionVencida();
  }

  /** Cierra la sesión: borra las llaves. Lo pendiente de sus datos NO se borra aquí (eso lo decide quien llama, avisando antes). */
  async salir(): Promise<void> {
    const s = await this.cargar();
    if (s) {
      // Se avisa al servidor para que cierre la sesión allá también; si no hay señal, igual se cierra aquí.
      try {
        await hacerPeticion(this.o.fetch, { metodo: 'POST', url: this.url('/auth/cerrar'), cabeceras: this.cabeceras(s.token), cuerpo: {}, limiteMs: 5000 });
      } catch {
        // sin señal: no pasa nada
      }
    }
    await this.guardar(null);
  }
}
