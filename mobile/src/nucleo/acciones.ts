import { Cambio, Cola, NuevoCambio } from './cola';
import { RespuestaDeChecklist } from './dia';
import { Fotos } from './fotos';
import { MAXIMO_FOTOS_POR_ITEM } from './reglas';
import { Sincronizador } from './sincronizador';

/**
 * Lo que hacen los botones de la app. Cada acción GUARDA el cambio en la cola del teléfono (la pantalla lo muestra al instante) y manda a enviar: con señal
 * sale enseguida; sin señal queda esperando y sale sola al volver. Nunca se pierde y nunca se duplica (cada cambio lleva su identificador).
 */
export interface DatosDeRespuesta {
  semaforo?: 'verde' | 'amarillo' | 'rojo';
  si_no?: boolean;
  valor_numero?: number;
  valor_texto?: string;
  opcion?: string;
  nota?: string | null;
}

export class Acciones {
  constructor(private readonly o: { cola: Cola; sincronizador: Sincronizador; fotos: Fotos }) {}

  private async poner(nuevo: NuevoCambio): Promise<Cambio> {
    const c = await this.o.cola.encolar(nuevo);
    void this.o.sincronizador.sincronizar().catch(() => undefined); // en segundo plano: la pantalla no espera
    return c;
  }

  /** El último cambio sin enviar de un checklist: lo que se mande después (completar) depende de él. */
  private async ultimoDelChecklist(checklistId: number): Promise<string | undefined> {
    const lista = (await this.o.cola.pendientes()).filter((c) => c.contexto?.['checklistId'] === checklistId);
    return lista[lista.length - 1]?.id;
  }

  cambiarEstadoTrabajo(lineaId: number, estado: string, titulo: string): Promise<Cambio> {
    return this.poner({ titulo, tipo: 'linea_estado', metodo: 'POST', ruta: `/lineas/${lineaId}/estado`, cuerpo: { estado }, contexto: { lineaId, estado } });
  }

  async responderItem(checklistId: number, respuestaId: number, valores: DatosDeRespuesta, descripcion: string): Promise<Cambio> {
    const { opcion, ...resto } = valores;
    return this.poner({
      titulo: `Responder «${descripcion}»`,
      tipo: 'checklist_respuesta',
      metodo: 'PATCH',
      ruta: `/checklists/${checklistId}/respuestas/${respuestaId}`,
      cuerpo: { ...resto, ...(opcion !== undefined ? { opcion } : {}) },
      dependeDe: await this.ultimoDelChecklist(checklistId),
      contexto: { checklistId, respuestaId, valores },
    });
  }

  /** Una foto de un punto del checklist: se reduce, se guarda en el teléfono y recién entonces cuenta. Máximo 5 por punto. */
  async agregarFotoDeItem(checklistId: number, respuesta: RespuestaDeChecklist, uriOriginal: string): Promise<Cambio> {
    if (respuesta.fotos.length + (respuesta.fotos_locales?.length ?? 0) >= MAXIMO_FOTOS_POR_ITEM) throw new Error(`Cada punto admite hasta ${MAXIMO_FOTOS_POR_ITEM} fotos.`);
    const f = await this.o.fotos.preparar(uriOriginal, `checklist-${checklistId}-${respuesta.id}`);
    return this.poner({
      titulo: `Foto de «${respuesta.descripcion}»`,
      tipo: 'checklist_foto',
      metodo: 'POST',
      ruta: `/checklists/${checklistId}/respuestas/${respuesta.id}/fotos`,
      archivo: f,
      dependeDe: await this.ultimoDelChecklist(checklistId),
      contexto: { checklistId, respuestaId: respuesta.id, uri: f.uri },
    });
  }

  async completarChecklist(checklistId: number, lectura: { contador_id: number; valor: number } | null, titulo: string): Promise<Cambio> {
    return this.poner({
      titulo: `Completar ${titulo}`,
      tipo: 'checklist_completar',
      metodo: 'POST',
      ruta: `/checklists/${checklistId}/completar`,
      cuerpo: lectura ? { lectura } : {},
      dependeDe: await this.ultimoDelChecklist(checklistId),
      contexto: { checklistId },
    });
  }

  async agregarFotoDeTrabajo(lineaId: number, tipo: 'antes' | 'durante' | 'despues', uriOriginal: string): Promise<Cambio> {
    const f = await this.o.fotos.preparar(uriOriginal, `trabajo-${lineaId}-${tipo}`);
    return this.poner({ titulo: `Foto del trabajo (${tipo})`, tipo: 'linea_foto', metodo: 'POST', ruta: `/lineas/${lineaId}/fotos?tipo=${tipo}`, archivo: f, contexto: { lineaId, tipo, uri: f.uri } });
  }

  registrarLectura(contadorId: number, valor: number, fecha: string): Promise<Cambio> {
    return this.poner({ titulo: 'Lectura del contador', tipo: 'lectura', metodo: 'POST', ruta: `/contadores/${contadorId}/lecturas`, cuerpo: { valor, fecha }, contexto: { contadorId, valor } });
  }

  solicitarMaterial(ordenId: number, lineas: Array<{ material_id: number; cantidad: number }>, notas?: string): Promise<Cambio> {
    return this.poner({ titulo: 'Solicitud de material', tipo: 'solicitud_material', metodo: 'POST', ruta: '/solicitudes', cuerpo: { orden_id: ordenId, lineas, ...(notas ? { notas } : {}) }, contexto: { ordenId } });
  }

  despachar(solicitudId: number, items: Array<{ linea_id: number; bodega_id: number; cantidad: number }>, numero?: string): Promise<Cambio> {
    return this.poner({ titulo: `Despacho de material${numero ? ` ${numero}` : ''}`, tipo: 'despacho', metodo: 'POST', ruta: `/solicitudes/${solicitudId}/despachar`, cuerpo: { items }, contexto: { solicitudId, items } });
  }

  /** La firma del cliente (ya convertida a imagen PNG en base64). Va ANTES de completar el checklist: la cola respeta ese orden. */
  async firmarChecklist(checklistId: number, nombre: string, imagen: string): Promise<Cambio> {
    const quien = nombre.trim();
    if (quien.length < 3) throw new Error('Escriba el nombre completo de quien firma.');
    return this.poner({
      titulo: `Firma de ${quien}`,
      tipo: 'checklist_firma',
      metodo: 'POST',
      ruta: `/checklists/${checklistId}/firma`,
      cuerpo: { nombre: quien, imagen },
      dependeDe: await this.ultimoDelChecklist(checklistId),
      contexto: { checklistId, nombre: quien },
    });
  }

  /** Entregar el equipo (o cualquier cambio de estado de la orden). El servidor revisa que no queden trabajos ni checklists pendientes y, si no, lo rechaza con el motivo. */
  entregarOrden(ordenId: number, estadoId: number, numero: string, estadoNombre: string): Promise<Cambio> {
    return this.poner({ titulo: `Orden ${numero}: pasar a «${estadoNombre}»`, tipo: 'orden_estado', metodo: 'POST', ruta: `/ordenes/${ordenId}/estado`, cuerpo: { estado_id: estadoId }, contexto: { ordenId, estadoId } });
  }
}
