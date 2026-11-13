/** El menú de la app sale de los PERMISOS de la persona (los mismos `módulo.acción` de la web), no de su rol: un rol nuevo funciona sin cambiar la app. */
export interface Pantalla {
  id: 'inicio' | 'trabajos' | 'checklists' | 'bodega' | 'recepcion' | 'citas' | 'equipos' | 'escanear' | 'cuenta';
  titulo: string;
  /** Alguno de estos permisos basta (vacío: siempre). */
  permisos: string[];
}

export const PANTALLAS: Pantalla[] = [
  { id: 'inicio', titulo: 'Mi día', permisos: [] },
  { id: 'trabajos', titulo: 'Mis trabajos', permisos: ['ordenes.trabajar'] },
  { id: 'checklists', titulo: 'Checklists', permisos: ['checklists.llenar', 'checklists.ver'] },
  { id: 'bodega', titulo: 'Bodega', permisos: ['solicitudes.despachar'] },
  { id: 'recepcion', titulo: 'Recepción', permisos: ['ordenes.crear'] },
  { id: 'citas', titulo: 'Citas', permisos: ['citas.ver'] },
  { id: 'equipos', titulo: 'Equipos', permisos: ['equipos.ver'] },
  { id: 'escanear', titulo: 'Escanear QR', permisos: ['equipos.ver'] },
  { id: 'cuenta', titulo: 'Mi cuenta', permisos: [] },
];

export function pantallasPara(permisos: string[]): Pantalla[] {
  const tiene = new Set(permisos);
  return PANTALLAS.filter((p) => p.permisos.length === 0 || p.permisos.some((x) => tiene.has(x)));
}
