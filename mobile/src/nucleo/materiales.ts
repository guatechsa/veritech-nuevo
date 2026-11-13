/**
 * Pedir material a la bodega desde un trabajo: se busca en el catálogo que se bajó con «Mi día» (sin señal también), se arma la lista y la solicitud sale por
 * la cola. Las cantidades son SIEMPRE números enteros (decisión de la empresa: medio metro es otra unidad, centímetros).
 */
export interface MaterialDelCatalogo {
  id: number;
  codigo: string;
  nombre: string;
  unidad: string;
}
export interface LineaDelCarrito {
  material_id: number;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
}

export const MAXIMO_LINEAS_POR_SOLICITUD = 50;
export const MAXIMO_POR_LINEA = 1_000_000;

/** Para comparar sin importar mayúsculas ni tildes («aceite» encuentra «ACEITE», «bateria» encuentra «BATERÍA»). */
const MARCAS_DE_TILDE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g'); // las marcas que NFD separa de la letra
export const sinTildes = (t: string): string => t.normalize('NFD').replace(MARCAS_DE_TILDE, '').toUpperCase();

/** Cada palabra escrita debe estar en el código o el nombre; sin texto se muestran los primeros. */
export function buscarMateriales(catalogo: MaterialDelCatalogo[], texto: string, limite = 30): MaterialDelCatalogo[] {
  const palabras = sinTildes(texto).split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return catalogo.slice(0, limite);
  const salida: MaterialDelCatalogo[] = [];
  for (const m of catalogo) {
    const pajar = sinTildes(`${m.codigo} ${m.nombre}`);
    if (palabras.every((p) => pajar.includes(p))) {
      salida.push(m);
      if (salida.length >= limite) break;
    }
  }
  return salida;
}

export const esCantidadValida = (n: number): boolean => Number.isInteger(n) && n > 0 && n <= MAXIMO_POR_LINEA;

/** Agrega un material (o suma a la línea que ya está). Una cantidad inválida no cambia nada. */
export function agregarAlCarrito(carrito: LineaDelCarrito[], m: MaterialDelCatalogo, cantidad = 1): LineaDelCarrito[] {
  if (!esCantidadValida(cantidad)) return carrito;
  const existe = carrito.find((l) => l.material_id === m.id);
  if (existe) return carrito.map((l) => (l.material_id === m.id ? { ...l, cantidad: Math.min(l.cantidad + cantidad, MAXIMO_POR_LINEA) } : l));
  return [...carrito, { material_id: m.id, codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, cantidad }];
}

/** Cambia la cantidad de una línea; cero (o menos) la quita; algo que no es entero se ignora. */
export function cambiarCantidad(carrito: LineaDelCarrito[], materialId: number, cantidad: number): LineaDelCarrito[] {
  if (!Number.isInteger(cantidad) || cantidad > MAXIMO_POR_LINEA) return carrito;
  if (cantidad <= 0) return carrito.filter((l) => l.material_id !== materialId);
  return carrito.map((l) => (l.material_id === materialId ? { ...l, cantidad } : l));
}

export function problemasDeSolicitud(carrito: LineaDelCarrito[]): string[] {
  const p: string[] = [];
  if (carrito.length === 0) p.push('Agregue al menos un material.');
  if (carrito.length > MAXIMO_LINEAS_POR_SOLICITUD) p.push(`Una solicitud admite hasta ${MAXIMO_LINEAS_POR_SOLICITUD} materiales distintos: haga otra solicitud.`);
  if (carrito.some((l) => !esCantidadValida(l.cantidad))) p.push('Todas las cantidades deben ser números enteros mayores que cero.');
  return p;
}

export const aLineasDeSolicitud = (carrito: LineaDelCarrito[]): Array<{ material_id: number; cantidad: number }> => carrito.map((l) => ({ material_id: l.material_id, cantidad: l.cantidad }));
