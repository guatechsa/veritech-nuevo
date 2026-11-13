import { SolicitudDeMaterial } from './dia';

/** Despachar desde la bodega: de qué bodega sale cada línea y cuánto. Las reglas se revisan en el teléfono ANTES de enviar (el servidor las vuelve a revisar). */
type Linea = SolicitudDeMaterial['lineas'][number];
export interface Elegido {
  bodega_id: number;
  cantidad: number;
}
export type Elecciones = Record<number, Elegido | undefined>;

export const existenciaEn = (l: Linea, bodegaId: number): number => l.por_bodega.find((b) => b.bodega_id === bodegaId)?.cantidad ?? 0;

/** Lo más que se puede despachar de una línea desde una bodega: lo que falta y lo que hay. */
export const maximoADespachar = (l: Linea, bodegaId: number): number => Math.max(0, Math.min(l.pendiente, existenciaEn(l, bodegaId)));

/** La bodega que más tiene (la que conviene por defecto); sin existencia en ninguna, nada. */
export function mejorBodega(l: Linea): number | null {
  const con = l.por_bodega.filter((b) => b.cantidad > 0).sort((a, b) => b.cantidad - a.cantidad || a.bodega_id - b.bodega_id);
  return con[0]?.bodega_id ?? null;
}

/** La elección inicial: cada línea con algo pendiente, desde su mejor bodega y por lo más que se pueda. */
export function proponerDespacho(s: SolicitudDeMaterial): Elecciones {
  const e: Elecciones = {};
  for (const l of s.lineas) {
    const b = mejorBodega(l);
    if (l.pendiente > 0 && b !== null) e[l.id] = { bodega_id: b, cantidad: maximoADespachar(l, b) };
  }
  return e;
}

export function problemasDeDespacho(s: SolicitudDeMaterial, e: Elecciones): string[] {
  const p: string[] = [];
  if (s.estado === 'anulada') return ['La solicitud está anulada.'];
  if (s.estado === 'despachada') return ['La solicitud ya se despachó completa.'];
  const items = s.lineas.filter((l) => e[l.id]);
  if (items.length === 0) p.push('Elija qué despachar.');
  for (const l of items) {
    const x = e[l.id]!;
    if (!Number.isInteger(x.cantidad) || x.cantidad <= 0) p.push(`${l.codigo}: la cantidad debe ser un número entero mayor que cero.`);
    else if (x.cantidad > l.pendiente) p.push(`${l.codigo}: solo faltan ${l.pendiente} por despachar.`);
    else if (x.cantidad > existenciaEn(l, x.bodega_id)) p.push(`${l.codigo}: la bodega elegida solo tiene ${existenciaEn(l, x.bodega_id)}.`);
  }
  return p;
}

export function itemsDeDespacho(s: SolicitudDeMaterial, e: Elecciones): Array<{ linea_id: number; bodega_id: number; cantidad: number }> {
  return s.lineas.filter((l) => e[l.id]).map((l) => ({ linea_id: l.id, bodega_id: e[l.id]!.bodega_id, cantidad: e[l.id]!.cantidad }));
}
