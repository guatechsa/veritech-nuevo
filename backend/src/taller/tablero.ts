import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorValidacion } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { limitesDelDia } from '../utils/zona';
import { Actor, bitacora, TallerReq } from './comun';
import { hoyDelTaller } from './contadores';
import { SesionDeTaller } from './contexto';
import { calcularValores, CATALOGO, listarMetas, Semaforo, semaforoDe, Unidad } from './indicadores';
import { estadoDeServicios } from './servicios';

/**
 * Tablero de inicio por rol (Fase 7a). Cada rol ve unas tarjetas sugeridas; la empresa puede cambiarlas por rol. Una tarjeta solo se
 * muestra si la persona tiene el permiso de lo que cuenta (el dinero, solo con el permiso de reportes financieros). Cada tarjeta lleva
 * a la pantalla ya filtrada. Lo abierto o cerrado se decide por la bandera del estado, nunca por su nombre.
 */

export interface DefTarjeta {
  codigo: string;
  titulo: string;
  tipo: 'contador' | 'indicador';
  permiso: string;
  /** Pantalla a la que lleva (relativa al taller) y su filtro. */
  ruta: string;
  unidad: Unidad;
  ayuda: string;
}

const contador = (codigo: string, titulo: string, permiso: string, ruta: string, ayuda: string): DefTarjeta => ({ codigo, titulo, tipo: 'contador', permiso, ruta, unidad: 'cantidad', ayuda });
const indicador = (codigo: string): DefTarjeta => {
  const d = CATALOGO.find((c) => c.codigo === codigo)!;
  return { codigo, titulo: d.nombre, tipo: 'indicador', permiso: d.financiero ? 'reportes.financieros' : 'reportes.ver', ruta: `/reportes?indicador=${codigo}`, unidad: d.unidad, ayuda: `${d.descripcion} (mes en curso contra el mes anterior)` };
};

export const TARJETAS: DefTarjeta[] = [
  contador('ordenes_abiertas', 'Órdenes abiertas', 'ordenes.ver', '/ordenes', 'Órdenes que todavía no llegan a un estado final.'),
  contador('ordenes_vencidas', 'Órdenes vencidas', 'ordenes.ver', '/ordenes?vista=vencidas', 'Abiertas cuya fecha estimada de entrega ya pasó.'),
  contador('sin_tecnico', 'Órdenes con trabajos sin técnico', 'ordenes.ver', '/ordenes', 'Órdenes abiertas con trabajos pendientes a los que falta asignar técnico.'),
  contador('trabajos_detenidos', 'Trabajos detenidos', 'ordenes.ver', '/ordenes', 'Trabajos detenidos por material, terceros, autorización o espacio.'),
  contador('equipos_en_taller', 'Equipos en el taller', 'equipos.ver', '/ordenes', 'Equipos que están físicamente dentro del taller.'),
  contador('citas_hoy', 'Citas de hoy', 'citas.ver', '/citas', 'Citas programadas para hoy.'),
  contador('entregas_hoy', 'Entregas de hoy', 'ordenes.ver', '/ordenes', 'Órdenes abiertas con entrega estimada para hoy.'),
  contador('solicitudes_pendientes', 'Solicitudes de material por despachar', 'solicitudes.ver', '/inventario?tab=solicitudes', 'Solicitudes no despachadas o despachadas parcialmente.'),
  contador('reservas_por_vencer', 'Reservas por vencer', 'reservas.ver', '/inventario?tab=reservas', 'Reservas vigentes que vencen en 7 días o menos.'),
  contador('materiales_bajo_minimo', 'Materiales bajo el mínimo', 'inventario.ver', '/inventario?tab=materiales&bajo=1', 'Materiales con menos existencia que su mínimo.'),
  contador('cotizaciones_sin_respuesta', 'Cotizaciones sin respuesta', 'cotizaciones.ver', '/cotizaciones', 'Cotizaciones enviadas y vigentes que el cliente todavía no responde.'),
  contador('servicios_vencidos', 'Servicios vencidos', 'servicios.ver', '/servicios', 'Servicios programados vencidos de los equipos.'),
  contador('mis_trabajos', 'Mis trabajos', 'ordenes.trabajar', '/mis-trabajos', 'Sus trabajos que todavía no están terminados.'),
  ...['ordenes_completadas', 'ticket_promedio', 'margen', 'dias_en_taller', 'tiempo_despacho', 'puntualidad_citas', 'eficiencia_tecnicos', 'utilizacion_tecnicos', 'cumplimiento_mantenimiento', 'retrabajos', 'autorizacion_lineas', 'autorizacion_valor'].map(indicador),
];

/** Lo que ve cada tipo de rol si la empresa no lo cambió. */
const SUGERIDAS: Record<string, string[]> = {
  administrador: ['ordenes_completadas', 'ticket_promedio', 'margen', 'ordenes_abiertas', 'ordenes_vencidas', 'cotizaciones_sin_respuesta', 'autorizacion_lineas', 'materiales_bajo_minimo'],
  gerente: ['ordenes_completadas', 'ticket_promedio', 'margen', 'ordenes_abiertas', 'ordenes_vencidas', 'cotizaciones_sin_respuesta', 'autorizacion_lineas', 'materiales_bajo_minimo'],
  supervisor: ['ordenes_abiertas', 'ordenes_vencidas', 'sin_tecnico', 'trabajos_detenidos', 'eficiencia_tecnicos', 'solicitudes_pendientes'],
  recepcionista: ['citas_hoy', 'equipos_en_taller', 'entregas_hoy', 'ordenes_vencidas', 'reservas_por_vencer', 'cotizaciones_sin_respuesta'],
  bodeguero: ['solicitudes_pendientes', 'tiempo_despacho', 'materiales_bajo_minimo', 'reservas_por_vencer'],
  tecnico: ['mis_trabajos', 'trabajos_detenidos'],
  visualizador: ['ordenes_abiertas', 'equipos_en_taller'],
};

// ── Lo que cuenta cada tarjeta ────────────────────────────────────────────────────────
export async function valorDeContador(ctx: Contexto, t: TallerReq, codigo: string, colaboradorId: number): Promise<number> {
  const hoy = hoyDelTaller(ctx, t);
  const n = async (sql: string, params: unknown[] = []): Promise<number> => Number((await una<{ n: number }>(t.pool, sql, params))?.n ?? 0);
  const abiertas = 'FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id WHERE es.es_terminal = 0';
  switch (codigo) {
    case 'ordenes_abiertas': return n(`SELECT COUNT(*) AS n ${abiertas}`);
    case 'ordenes_vencidas': return n(`SELECT COUNT(*) AS n ${abiertas} AND o.fecha_estimada_entrega < ?`, [hoy]);
    case 'entregas_hoy': return n(`SELECT COUNT(*) AS n ${abiertas} AND o.fecha_estimada_entrega = ?`, [hoy]);
    case 'sin_tecnico': return n(`SELECT COUNT(DISTINCT l.orden_id) AS n FROM lineas_orden l JOIN ordenes o ON o.id = l.orden_id JOIN estados_orden es ON es.id = o.estado_id WHERE es.es_terminal = 0 AND l.anulada_en IS NULL AND l.tipo = 'servicio' AND l.estado <> 'terminado' AND l.tecnico_id IS NULL`);
    case 'trabajos_detenidos': return n(`SELECT COUNT(*) AS n FROM lineas_orden l JOIN ordenes o ON o.id = l.orden_id JOIN estados_orden es ON es.id = o.estado_id WHERE es.es_terminal = 0 AND l.anulada_en IS NULL AND l.estado LIKE 'detenido\\_%'`);
    case 'equipos_en_taller': return n('SELECT COUNT(DISTINCT equipo_id) AS n FROM ingresos_equipo WHERE salida_en IS NULL');
    case 'citas_hoy': {
      const zona = t.empresa.zonaHoraria;
      const l = limitesDelDia(hoy, zona);
      return n("SELECT COUNT(*) AS n FROM citas WHERE estado = 'programada' AND fecha_hora >= ? AND fecha_hora < ?", [l.desde, l.hasta]);
    }
    case 'solicitudes_pendientes': return n("SELECT COUNT(*) AS n FROM solicitudes_material WHERE estado IN ('no_despachada', 'despachada_parcial')");
    case 'reservas_por_vencer': return n("SELECT COUNT(*) AS n FROM reservas WHERE estado = 'activa' AND vence_en >= ? AND vence_en <= DATE_ADD(?, INTERVAL 7 DAY)", [hoy, hoy]);
    case 'materiales_bajo_minimo': return n('SELECT COUNT(*) AS n FROM (SELECT m.id FROM materiales m LEFT JOIN existencias e ON e.material_id = m.id WHERE m.activo = 1 AND m.existencia_minima > 0 GROUP BY m.id, m.existencia_minima HAVING COALESCE(SUM(e.cantidad), 0) < m.existencia_minima) x');
    case 'cotizaciones_sin_respuesta': return n("SELECT COUNT(*) AS n FROM cotizaciones WHERE estado = 'enviada' AND (vence_en IS NULL OR vence_en >= ?)", [hoy]);
    case 'servicios_vencidos': return (await estadoDeServicios(ctx, t, {})).filter((s) => s.estado === 'vencido').length;
    case 'mis_trabajos': return n(`SELECT COUNT(*) AS n FROM lineas_orden l JOIN ordenes o ON o.id = l.orden_id JOIN estados_orden es ON es.id = o.estado_id WHERE es.es_terminal = 0 AND l.anulada_en IS NULL AND l.tipo = 'servicio' AND l.estado <> 'terminado' AND l.tecnico_id = ?`, [colaboradorId]);
    default: return 0;
  }
}

function mesDe(hoy: string): { desde: string; hasta: string; anteriorDesde: string; anteriorHasta: string } {
  const [y, m] = hoy.split('-').map(Number) as [number, number];
  const pad = (x: number): string => String(x).padStart(2, '0');
  const ultimoAnterior = new Date(Date.UTC(y, m - 1, 0));
  const primeroAnterior = new Date(Date.UTC(y, m - 2, 1));
  return { desde: `${y}-${pad(m)}-01`, hasta: hoy, anteriorDesde: primeroAnterior.toISOString().slice(0, 10), anteriorHasta: ultimoAnterior.toISOString().slice(0, 10) };
}

// ── La configuración por rol ──────────────────────────────────────────────────────────
async function tarjetasDeRol(t: TallerReq, rol: { id: number; codigo: string }): Promise<string[]> {
  const f = await filas<{ tarjeta: string }>(t.pool, 'SELECT tarjeta FROM tablero_roles WHERE rol_id = ? ORDER BY orden, tarjeta', [rol.id]);
  return f.length > 0 ? f.map((x) => x.tarjeta) : SUGERIDAS[rol.codigo] ?? ['ordenes_abiertas'];
}

export interface TarjetaConValor {
  codigo: string;
  titulo: string;
  tipo: 'contador' | 'indicador';
  unidad: Unidad;
  ayuda: string;
  ruta: string;
  valor: number | null;
  anterior?: number | null;
  semaforo: Semaforo | null;
}

export async function obtenerTablero(ctx: Contexto, t: TallerReq, s: SesionDeTaller): Promise<TarjetaConValor[]> {
  const codigos: string[] = [];
  for (const r of s.roles) for (const c of await tarjetasDeRol(t, r)) if (!codigos.includes(c)) codigos.push(c);
  const visibles = codigos.map((c) => TARJETAS.find((x) => x.codigo === c)).filter((x): x is DefTarjeta => !!x && s.permisos.has(x.permiso));
  const hoy = hoyDelTaller(ctx, t);
  const periodo = mesDe(hoy);
  const quiereDinero = visibles.some((x) => x.tipo === 'indicador' && CATALOGO.find((c) => c.codigo === x.codigo)?.financiero);
  const hayIndicadores = visibles.some((x) => x.tipo === 'indicador');
  const actual = hayIndicadores ? await calcularValores(ctx, t, { desde: periodo.desde, hasta: periodo.hasta }, quiereDinero) : {};
  const previo = hayIndicadores ? await calcularValores(ctx, t, { desde: periodo.anteriorDesde, hasta: periodo.anteriorHasta }, quiereDinero) : {};
  const metas = await listarMetas(t);
  const salida: TarjetaConValor[] = [];
  for (const x of visibles) {
    const base = { codigo: x.codigo, titulo: x.titulo, tipo: x.tipo, unidad: x.unidad, ayuda: x.ayuda, ruta: x.ruta };
    if (x.tipo === 'contador') salida.push({ ...base, valor: await valorDeContador(ctx, t, x.codigo, s.colaboradorId), semaforo: null });
    else {
      const v = actual[x.codigo]?.valor ?? null;
      salida.push({ ...base, valor: v, anterior: previo[x.codigo]?.valor ?? null, semaforo: semaforoDe(v, metas.find((m) => m.indicador === x.codigo)) });
    }
  }
  return salida;
}

export async function configuracionDelTablero(t: TallerReq) {
  const roles = await filas<{ id: number; codigo: string; nombre: string }>(t.pool, 'SELECT id, codigo, nombre FROM roles WHERE activo = 1 ORDER BY id');
  const salida = [];
  for (const r of roles) {
    const propias = await una<{ n: number }>(t.pool, 'SELECT COUNT(*) AS n FROM tablero_roles WHERE rol_id = ?', [r.id]);
    salida.push({ ...r, personalizado: Number(propias?.n ?? 0) > 0, tarjetas: await tarjetasDeRol(t, r) });
  }
  return { roles: salida, catalogo: TARJETAS.map(({ codigo, titulo, tipo, permiso, ayuda }) => ({ codigo, titulo, tipo, permiso, ayuda })) };
}

export async function definirTableroDeRol(t: TallerReq, actor: Actor, rolId: number, tarjetas: string[]) {
  for (const c of tarjetas) if (!TARJETAS.some((x) => x.codigo === c)) throw new ErrorValidacion(`La tarjeta «${c}» no existe`);
  if (new Set(tarjetas).size !== tarjetas.length) throw new ErrorValidacion('Una tarjeta aparece dos veces');
  await transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM roles WHERE id = ?', [rolId]))) throw new ErrorValidacion('El rol no existe');
    await ejecutar(con, 'DELETE FROM tablero_roles WHERE rol_id = ?', [rolId]);
    for (const [i, c] of tarjetas.entries()) await ejecutar(con, 'INSERT INTO tablero_roles (rol_id, tarjeta, orden) VALUES (?, ?, ?)', [rolId, c, i]);
    await bitacora(con, actor, { accion: 'tablero_de_rol_definido', entidad: 'tablero_roles', entidadId: rolId, despues: { tarjetas } });
  });
  return configuracionDelTablero(t);
}

/** Vuelve a las tarjetas sugeridas para ese rol. */
export async function restablecerTableroDeRol(t: TallerReq, actor: Actor, rolId: number) {
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'DELETE FROM tablero_roles WHERE rol_id = ?', [rolId]);
    await bitacora(con, actor, { accion: 'tablero_de_rol_restablecido', entidad: 'tablero_roles', entidadId: rolId });
  });
  return configuracionDelTablero(t);
}
