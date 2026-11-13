import { filas } from '../db/consulta';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { addDias } from './movil-fechas';
import { listarChecklistsDeOrden, obtenerChecklist } from './checklists';
import { TallerReq } from './comun';
import { hoyDelTaller } from './contadores';
import { listarCitas } from './citas';
import { obtenerEquipo } from './equipos';
import { listarOrdenes, misTrabajos, obtenerOrden } from './ordenes';
import { SesionDeTaller } from './contexto';
import { listarSolicitudes, obtenerSolicitud } from './solicitudes';

/**
 * «Descargar mi día» (Fase 8a): todo lo que la persona necesita para trabajar SIN señal, según sus permisos y sin costos ni precios. La app lo guarda en el
 * teléfono (y baja las fotos, porque sus direcciones vencen) y marca qué está disponible sin conexión. Cada parte falla por separado: una orden que no
 * se pudo leer no impide bajar las demás.
 */
export const MAXIMO_ORDENES = 30;
export const MAXIMO_EQUIPOS = 60;
export const MAXIMO_CHECKLISTS = 60;
export const MAXIMO_SOLICITUDES = 30;

const SIN_DINERO = { precios: false, costos: false };

async function conTolerancia<T>(nombre: string, trabajo: () => Promise<T>, avisos: string[]): Promise<T | null> {
  try {
    return await trabajo();
  } catch (error) {
    avisos.push(nombre);
    console.error(`[movil] mi día: ${nombre}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

/** Todas las direcciones de archivos (fotos, firmas, documentos) que salen en lo descargado: la app las baja al teléfono. */
export function direccionesDeArchivos(dato: unknown, acumulado: Set<string> = new Set()): string[] {
  if (typeof dato === 'string') {
    if (dato.startsWith('/api/archivos/')) acumulado.add(dato);
  } else if (Array.isArray(dato)) {
    for (const x of dato) direccionesDeArchivos(x, acumulado);
  } else if (dato && typeof dato === 'object') {
    for (const x of Object.values(dato)) direccionesDeArchivos(x, acumulado);
  }
  return [...acumulado];
}

export async function miDia(ctx: Contexto, t: TallerReq, s: SesionDeTaller) {
  const p = s.permisos;
  const hoy = hoyDelTaller(ctx, t);
  const incompleto: string[] = [];
  const salida: Record<string, unknown> = {
    descargado_en: ahoraDe(ctx),
    hoy,
    usuario: { id: s.usuarioId, nombre: s.nombre, roles: s.roles.map((r) => r.codigo) },
  };
  const ordenIds = new Set<number>();
  const equipoIds = new Set<number>();

  // Mis trabajos (técnico): las líneas que me asignaron y no están terminadas.
  if (p.has('ordenes.trabajar')) {
    const mis = await conTolerancia('mis trabajos', () => misTrabajos(ctx, t, s.usuarioId), incompleto);
    if (mis) {
      salida['trabajos'] = mis;
      for (const x of mis.trabajos) ordenIds.add(Number((x as Record<string, unknown>)['orden_id']));
    }
  }
  // Equipos asignados a mí como operador.
  if (p.has('contadores.registrar') && p.has('equipos.ver')) {
    const f = await filas<{ equipo_id: number }>(t.pool, 'SELECT a.equipo_id FROM asignaciones_operador a JOIN usuarios u ON u.colaborador_id = a.colaborador_id WHERE u.id = ? AND a.activo = 1 AND (a.hasta IS NULL OR a.hasta >= ?)', [s.usuarioId, hoy]);
    const asignados = f.map((x) => x.equipo_id);
    salida['equipos_asignados'] = asignados;
    for (const id of asignados) equipoIds.add(id);
  }
  // Las órdenes abiertas (recepción y supervisión): un resumen para ubicar a qué orden va cada cosa.
  if (p.has('ordenes.ver') && p.has('ordenes.crear')) {
    const r = await conTolerancia('órdenes abiertas', () => listarOrdenes(t, SIN_DINERO, { abiertas: true, pagina: 1, porPagina: 40 }), incompleto);
    if (r) salida['ordenes_abiertas'] = r.registros;
  }

  // El detalle de cada orden de mi día y sus checklists por llenar.
  const ordenes: unknown[] = [];
  const checklists: unknown[] = [];
  if (p.has('ordenes.ver')) {
    for (const id of [...ordenIds].slice(0, MAXIMO_ORDENES)) {
      const o = await conTolerancia(`orden ${id}`, () => obtenerOrden(ctx, t, id, SIN_DINERO), incompleto);
      if (!o) continue;
      ordenes.push(o);
      const equipo = (o as unknown as { equipo_id?: number }).equipo_id;
      if (equipo) equipoIds.add(Number(equipo));
      if (p.has('checklists.ver') || p.has('checklists.llenar')) {
        const lista = await conTolerancia(`checklists de la orden ${id}`, () => listarChecklistsDeOrden(t, id), incompleto);
        for (const c of lista ?? []) {
          if (checklists.length >= MAXIMO_CHECKLISTS) break;
          if (c['estado'] === 'completado') continue; // los terminados no se llenan: la app los pide cuando se necesiten
          const d = await conTolerancia(`checklist ${String(c['id'])}`, () => obtenerChecklist(ctx, t, Number(c['id'])), incompleto);
          if (d) checklists.push(d);
        }
      }
    }
  }
  salida['ordenes'] = ordenes;
  salida['checklists'] = checklists;

  // Las fichas de los equipos (solo lectura).
  const equipos: unknown[] = [];
  if (p.has('equipos.ver')) {
    for (const id of [...equipoIds].slice(0, MAXIMO_EQUIPOS)) {
      const e = await conTolerancia(`equipo ${id}`, () => obtenerEquipo(ctx, t, id), incompleto);
      if (e) equipos.push(e);
    }
  }
  salida['equipos'] = equipos;

  // Bodega: solicitudes por despachar.
  if (p.has('solicitudes.despachar')) {
    const pend = await conTolerancia('solicitudes', () => listarSolicitudes(t, { pendientes: true, pagina: 1, porPagina: MAXIMO_SOLICITUDES }), incompleto);
    const solicitudes: unknown[] = [];
    for (const x of pend?.registros ?? []) {
      const d = await conTolerancia(`solicitud ${String((x as Record<string, unknown>)['id'])}`, () => obtenerSolicitud(t, Number((x as Record<string, unknown>)['id']), { costos: false }), incompleto);
      if (d) solicitudes.push(d);
    }
    salida['solicitudes'] = solicitudes;
  }

  // Citas de hoy y mañana.
  if (p.has('citas.ver')) {
    const c = await conTolerancia('citas', () => listarCitas(ctx, t, { desde: hoy, hasta: addDias(hoy, 1), estado: 'programada', pagina: 1, porPagina: 50 }), incompleto);
    if (c) salida['citas'] = c.registros;
  }

  salida['archivos'] = direccionesDeArchivos(salida);
  salida['incompleto'] = incompleto;
  return salida;
}
