import { Checklist, RespuestaDeChecklist } from './dia';

/** Las reglas del checklist que se revisan en el teléfono ANTES de enviar (el servidor las vuelve a revisar). */
export const MAXIMO_FOTOS_POR_ITEM = 5;

export const necesitaFoto = (r: Pick<RespuestaDeChecklist, 'semaforo'>): boolean => r.semaforo === 'rojo' || r.semaforo === 'amarillo';

export const totalDeFotos = (r: RespuestaDeChecklist): number => r.fotos.length + (r.fotos_locales?.length ?? 0);

export function estaRespondida(r: RespuestaDeChecklist): boolean {
  return r.semaforo !== null || r.si_no !== null || r.valor_numero !== null || !!r.valor_texto || !!r.opcion_texto;
}

export function puedeAgregarFoto(r: RespuestaDeChecklist): boolean {
  return totalDeFotos(r) < MAXIMO_FOTOS_POR_ITEM;
}

/** Lo que falta para poder completar un checklist (vacío = se puede). Las fotos tomadas y aún sin enviar SÍ cuentan: ya están a salvo en el teléfono. */
export function problemasParaCompletar(c: Checklist, lectura: number | null): string[] {
  if (c.estado === 'completado') return ['Este checklist ya está completado.'];
  const problemas: string[] = [];
  const sinResponder = c.respuestas.filter((r) => !estaRespondida(r));
  if (sinResponder.length > 0) problemas.push(`Faltan ${sinResponder.length} ${sinResponder.length === 1 ? 'punto' : 'puntos'} por responder.`);
  for (const r of c.respuestas) {
    if (necesitaFoto(r) && totalDeFotos(r) === 0) problemas.push(`El punto «${r.descripcion}» necesita al menos una foto.`);
  }
  if (c.exige_lectura_contador && lectura === null) problemas.push('Escriba la lectura del contador.');
  if (c.requiere_firma_cliente && !c.firma && !c.firma_local) problemas.push('Falta la firma del cliente.');
  return problemas;
}

/** Cuántas fotos tomadas en el teléfono faltan por subir al servidor (para avisarlo en pantalla). */
export function fotosPorSubir(c: Checklist): number {
  return c.respuestas.reduce((n, r) => n + (r.fotos_locales?.length ?? 0), 0);
}
