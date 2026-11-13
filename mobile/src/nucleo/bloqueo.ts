import { Reloj } from './tipos';

/**
 * El candado de la app: cuando la persona vuelve a la app después de un rato (o la abre de cero), pide la huella, la cara o el PIN/patrón del TELÉFONO.
 * No guarda ninguna clave propia: usa el bloqueo de pantalla del teléfono. Si el teléfono no tiene ninguno, no hay con qué pedirlo: la app lo avisa y no se
 * bloquea (no se deja a nadie fuera por algo que no puede arreglar aquí).
 */
export interface Autenticador {
  /** El teléfono tiene huella, cara, PIN o patrón puesto. */
  disponible(): Promise<boolean>;
  pedir(motivo: string): Promise<boolean>;
}

export const MINUTOS_DE_GRACIA = 5;

export class Candado {
  private _bloqueado = false;
  private _activo: boolean;
  private _sinProteccion = false;
  private segundoPlanoDesde: number | null = null;
  private oyentes = new Set<() => void>();

  constructor(private readonly o: { autenticador: Autenticador; reloj: Reloj; activo: boolean; minutos?: number }) {
    this._activo = o.activo;
  }

  get bloqueado(): boolean {
    return this._bloqueado;
  }
  get activo(): boolean {
    return this._activo;
  }
  /** Quiere candado pero el teléfono no tiene bloqueo de pantalla: se le avisa a la persona. */
  get sinProteccion(): boolean {
    return this._sinProteccion;
  }

  escuchar(f: () => void): () => void {
    this.oyentes.add(f);
    return () => this.oyentes.delete(f);
  }
  private avisar(): void {
    for (const f of this.oyentes) f();
  }

  private async bloquearSiHaceFalta(): Promise<void> {
    if (!this._activo) return;
    this._sinProteccion = !(await this.o.autenticador.disponible());
    if (!this._sinProteccion) this._bloqueado = true;
    this.avisar();
  }

  /** Al abrir la app de cero. */
  iniciar(): Promise<void> {
    return this.bloquearSiHaceFalta();
  }

  alSegundoPlano(): void {
    if (this.segundoPlanoDesde === null) this.segundoPlanoDesde = this.o.reloj.ahora().getTime();
  }

  /** Al volver a la app: si estuvo afuera más de los minutos de gracia, se bloquea. */
  async alVolver(): Promise<void> {
    const desde = this.segundoPlanoDesde;
    this.segundoPlanoDesde = null;
    if (desde === null || this._bloqueado) return;
    if (this.o.reloj.ahora().getTime() - desde >= (this.o.minutos ?? MINUTOS_DE_GRACIA) * 60000) await this.bloquearSiHaceFalta();
  }

  /** La persona pulsa «Desbloquear». Si cancela o falla, sigue bloqueada. */
  async desbloquear(): Promise<boolean> {
    const bien = await this.o.autenticador.pedir('Confirme que es usted para seguir en VERI-TECH');
    if (bien) {
      this._bloqueado = false;
      this.avisar();
    }
    return bien;
  }

  /** Activar o desactivar el candado (en Mi cuenta). Activarlo exige confirmar antes: no se puede activar y quedar afuera sin poder entrar. */
  async cambiarActivo(activo: boolean): Promise<boolean> {
    if (activo) {
      this._sinProteccion = !(await this.o.autenticador.disponible());
      if (this._sinProteccion) {
        this._activo = false;
        this.avisar();
        return false;
      }
      if (!(await this.o.autenticador.pedir('Confirme que es usted para activar el bloqueo'))) return false;
    }
    this._activo = activo;
    if (!activo) this._bloqueado = false;
    this.avisar();
    return true;
  }
}
