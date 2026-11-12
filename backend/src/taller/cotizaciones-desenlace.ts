import { Ejecutor, filas } from '../db/consulta';

/**
 * Qué pasó con cada ítem ROJO de un checklist. Las respuestas del checklist no cambian nunca: el desenlace sale de las líneas de las
 * cotizaciones que atienden ese rojo (y se muestra junto al rojo en el checklist, el informe y el historial del equipo).
 */
export type EstadoDesenlace = 'sin_cotizar' | 'en_borrador' | 'sin_respuesta' | 'autorizado' | 'rechazado' | 'agregado' | 'vencido';

export interface Desenlace {
  estado: EstadoDesenlace;
  cotizacion: string | null;
  cotizacion_id: number | null;
  motivo: string | null;
  orden: string | null;
  fecha: Date | null;
}

const SIN_COTIZAR: Desenlace = { estado: 'sin_cotizar', cotizacion: null, cotizacion_id: null, motivo: null, orden: null, fecha: null };

interface FilaVinculo {
  respuesta_id: number;
  cotizacion_id: number;
  numero: string;
  version: number;
  cot_estado: string;
  linea_estado: string | null;
  motivo: string | null;
  orden: string | null;
  fecha: Date | null;
}

/** Prioridad de lo que mejor cuenta lo que pasó: agregado > autorizado > rechazado > sin respuesta > vencido > borrador. */
const PESO: Record<EstadoDesenlace, number> = { agregado: 6, autorizado: 5, rechazado: 4, sin_respuesta: 3, vencido: 2, en_borrador: 1, sin_cotizar: 0 };

function desenlaceDe(f: FilaVinculo): Desenlace {
  let estado: EstadoDesenlace;
  if (f.cot_estado === 'borrador') estado = 'en_borrador';
  else if (f.linea_estado === 'agregada_a_orden') estado = 'agregado';
  else if (f.linea_estado === 'autorizada') estado = 'autorizado';
  else if (f.linea_estado === 'rechazada') estado = 'rechazado';
  else if (f.linea_estado === 'vencida' || f.cot_estado === 'vencida') estado = 'vencido';
  else if (f.linea_estado === null) estado = 'sin_cotizar'; // la cotización se envió sin ninguna línea para este rojo
  else estado = 'sin_respuesta';
  return { estado, cotizacion: `${f.numero}${f.version > 1 ? ` v${f.version}` : ''}`, cotizacion_id: f.cotizacion_id, motivo: f.motivo, orden: f.orden, fecha: f.fecha };
}

/** Desenlace de cada respuesta indicada (por su número). Las cotizaciones anuladas o reemplazadas no cuentan. */
export async function desenlaceDeRespuestas(con: Ejecutor, respuestaIds: number[]): Promise<Map<number, Desenlace>> {
  const salida = new Map<number, Desenlace>();
  for (const id of respuestaIds) salida.set(id, SIN_COTIZAR);
  if (respuestaIds.length === 0) return salida;
  // Un rojo puede estar atendido por el borrador (hallazgo sin línea) o por líneas de una cotización enviada.
  const filasVinculo = await filas<FilaVinculo>(
    con,
    `SELECT h.respuesta_id, c.id AS cotizacion_id, c.numero, c.version, c.estado AS cot_estado, l.estado AS linea_estado, mo.nombre AS motivo, o.numero AS orden,
            COALESCE(l.agregada_en, l.respondida_en, c.enviada_en) AS fecha
       FROM cotizacion_hallazgos h JOIN cotizaciones c ON c.id = h.cotizacion_id
       LEFT JOIN cotizacion_lineas l ON l.cotizacion_id = c.id AND l.respuesta_id = h.respuesta_id
       LEFT JOIN motivos mo ON mo.id = l.motivo_rechazo_id LEFT JOIN ordenes o ON o.id = l.agregada_orden_id
      WHERE h.respuesta_id IN (?) AND c.estado NOT IN ('anulada', 'reemplazada')`,
    [respuestaIds]
  );
  for (const f of filasVinculo) {
    const nuevo = desenlaceDe(f);
    const actual = salida.get(f.respuesta_id)!;
    if (PESO[nuevo.estado] > PESO[actual.estado]) salida.set(f.respuesta_id, nuevo);
  }
  return salida;
}

/** Los rojos de OTROS checklists completados del mismo tipo y equipo que no se resolvieron (sin cotizar, sin respuesta, vencidos o rechazados): para ver si el defecto persiste. */
export async function rojosAnteriores(con: Ejecutor, equipoId: number, tipoId: number, excluirChecklistId: number) {
  const rojos = await filas<{ id: number; checklist_id: number; seccion: string; descripcion: string; nota: string | null; completado_en: Date | null }>(
    con,
    `SELECT r.id, r.checklist_id, r.seccion, r.descripcion, r.nota, c.completado_en
       FROM checklist_respuestas r JOIN checklists c ON c.id = r.checklist_id
      WHERE c.equipo_id = ? AND c.tipo_id = ? AND c.estado = 'completado' AND c.id <> ? AND r.semaforo = 'rojo' ORDER BY c.completado_en DESC, r.id LIMIT 50`,
    [equipoId, tipoId, excluirChecklistId]
  );
  const des = await desenlaceDeRespuestas(con, rojos.map((r) => r.id));
  return rojos
    .map((r) => ({ ...r, desenlace: des.get(r.id)! }))
    .filter((r) => ['sin_cotizar', 'sin_respuesta', 'rechazado', 'vencido'].includes(r.desenlace.estado));
}
