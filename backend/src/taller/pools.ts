import { Pool } from 'mysql2/promise';
import { Entorno } from '../config/entorno';
import { crearPool } from '../db/conexion';

/**
 * Una conexión por taller, abierta cuando se necesita y cerrada cuando sobra. Siempre se pide POR NOMBRE de base y se
 * entrega explícitamente en cada petición: no hay "contexto invisible" que se pueda perder (error que dio muchos
 * incidentes en el sistema anterior).
 */
export class RegistroPools {
  private readonly pools = new Map<string, Pool>();

  constructor(
    private readonly entorno: Entorno,
    private readonly maximo = 40
  ) {}

  obtener(nombreBd: string): Pool {
    const existente = this.pools.get(nombreBd);
    if (existente) {
      // Se marca como el más reciente (el Map conserva el orden de inserción).
      this.pools.delete(nombreBd);
      this.pools.set(nombreBd, existente);
      return existente;
    }
    if (!nombreBd.startsWith(this.entorno.PREFIJO_BD_TALLER) || nombreBd === this.entorno.BD_PLATAFORMA) {
      throw new Error(`La base ${nombreBd} no es de un taller`);
    }
    const pool = crearPool({ host: this.entorno.BD_HOST, puerto: this.entorno.BD_PUERTO, usuario: this.entorno.BD_USUARIO, clave: this.entorno.BD_CLAVE }, nombreBd, 5);
    this.pools.set(nombreBd, pool);
    while (this.pools.size > this.maximo) {
      const [masViejo] = this.pools.keys();
      if (masViejo === undefined) break;
      const p = this.pools.get(masViejo);
      this.pools.delete(masViejo);
      void p?.end().catch(() => undefined);
    }
    return pool;
  }

  /** Cierra la conexión de un taller (por ejemplo, si su base se va a borrar). */
  async cerrar(nombreBd: string): Promise<void> {
    const p = this.pools.get(nombreBd);
    this.pools.delete(nombreBd);
    await p?.end().catch(() => undefined);
  }

  async cerrarTodos(): Promise<void> {
    const todos = [...this.pools.values()];
    this.pools.clear();
    await Promise.all(todos.map((p) => p.end().catch(() => undefined)));
  }
}
