import { ClienteApi } from './cliente';
import { Dia } from './dia';
import { ErrorDeRed } from './errores';

/**
 * Lo que SOLO se puede hacer con señal, porque el servidor crea algo nuevo y la app necesita su número para seguir (una orden al recibir un equipo, un checklist
 * nuevo, una cotización). No pasa por la cola: si no hay señal, la persona lo ve al instante con un mensaje claro y lo vuelve a intentar; nunca queda a medias.
 * Al terminar, vuelve a bajar el día para que lo nuevo (la orden, el checklist) aparezca en la app.
 */
export class EnLinea {
  constructor(private readonly o: { cliente: ClienteApi; dia: Dia }) {}

  /** Una llamada que necesita señal: si no hay, el mensaje lo dice con claridad (no «se guarda en el teléfono», porque aquí NO se guarda). */
  private async llamar<T>(metodo: 'POST', ruta: string, cuerpo: unknown): Promise<T> {
    try {
      return await this.o.cliente.solicitar<T>(metodo, ruta, { cuerpo });
    } catch (e) {
      if (e instanceof ErrorDeRed) throw new ErrorDeRed(e.tipo, 'Esto necesita señal y no se pudo hacer. No quedó guardado: intente de nuevo cuando tenga señal.');
      throw e;
    }
  }

  private async actualizar(): Promise<boolean> {
    try {
      await this.o.dia.descargar();
      return true;
    } catch {
      return false; // lo creado ya está en el servidor; el día se baja la próxima vez
    }
  }

  /** El cliente llegó con su cita: se recibe el equipo y nace la orden. */
  async recibirCita(citaId: number, datos: { tipo_orden_id?: number; descripcion?: string; lectura?: { contador_id: number; valor: number } }): Promise<{ orden_id: number; numero: string; diaActualizado: boolean }> {
    const r = await this.llamar<{ orden_id: number; numero: string }>('POST', `/citas/${citaId}/recibir`, datos);
    return { ...r, diaActualizado: await this.actualizar() };
  }

  /** Un checklist nuevo para una orden (por ejemplo, el de recepción o el de entrega). */
  async iniciarChecklist(ordenId: number, tipoId: number): Promise<{ id: number; diaActualizado: boolean }> {
    const r = await this.llamar<{ id: number }>('POST', `/ordenes/${ordenId}/checklists`, { tipo_id: tipoId });
    return { id: r.id, diaActualizado: await this.actualizar() };
  }

  /** Cotiza los puntos en rojo de un checklist: nace una cotización que se envía al cliente desde el sistema. */
  async cotizarRojos(checklistId: number): Promise<{ id: number; numero: string | null }> {
    const r = await this.llamar<{ id: number; numero?: string }>('POST', '/cotizaciones/desde-checklist', { checklist_id: checklistId });
    return { id: r.id, numero: r.numero ?? null };
  }
}
