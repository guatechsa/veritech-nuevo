import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { normalizarCampo } from '../utils/texto';
import { avisarMaterialCargado } from './avisos';
import { Actor, bitacora, siguienteNumero, TallerReq } from './comun';
import { hoyDelTaller } from './contadores';
import { bloquearOrdenAbierta } from './ordenes';
import { existenciaEnSucursal, reservadoPorOtras } from './reservas-nucleo';
import { crearSolicitudEn, despacharEn } from './solicitudes';

/**
 * Reservas de material (Fase 5c). Una reserva protege unidades para UNA orden hasta su vencimiento; se puede reservar aunque hoy no
 * haya existencia (se está buscando o importando la pieza). «Cargar a la orden» despacha todo lo reservado o nada. El cliente y el
 * equipo se toman de la orden. Pasada la fecha la reserva vence sola y libera las unidades.
 */

export const ESTADOS_RESERVA = ['activa', 'cargada', 'vencida', 'cancelada'] as const;
export type EstadoReserva = (typeof ESTADOS_RESERVA)[number];

const MAXIMO_DIAS = 365;
const numeroDe = (n: number): string => `RES-${String(n).padStart(6, '0')}`;
const diasEntre = (desde: string, hasta: string): number => Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000);

/** Las reservas activas cuyo día ya pasó quedan «vencidas» (y sus unidades se liberan). Las unidades ya dejan de protegerse por la fecha, esto solo pone el estado. */
export async function marcarVencidas(con: Ejecutor, hoy: string): Promise<void> {
  await ejecutar(con, "UPDATE reservas SET estado = 'vencida' WHERE estado = 'activa' AND vence_en < ?", [hoy]);
}

function validarVencimiento(vence: string, hoy: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(vence) || Number.isNaN(Date.parse(`${vence}T00:00:00Z`))) throw new ErrorValidacion('La fecha de vencimiento no es válida');
  if (vence < hoy) throw new ErrorValidacion('La fecha de vencimiento no puede ser anterior a hoy');
  if (diasEntre(hoy, vence) > MAXIMO_DIAS) throw new ErrorValidacion(`Una reserva no puede durar más de ${MAXIMO_DIAS} días`);
}

// ── Crear ─────────────────────────────────────────────────────────────────────────────
export async function crearReserva(ctx: Contexto, t: TallerReq, actor: Actor, d: { orden_id: number; vence_en: string; notas?: string | null; lineas: Array<{ material_id: number; cantidad: number }> }) {
  const hoy = hoyDelTaller(ctx, t);
  validarVencimiento(d.vence_en, hoy);
  if (d.lineas.length === 0 || d.lineas.length > 50) throw new ErrorValidacion('La reserva necesita entre 1 y 50 materiales');
  const vistos = new Set<number>();
  for (const l of d.lineas) {
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0 || l.cantidad > 1_000_000) throw new ErrorValidacion('Las cantidades deben ser números enteros mayores que cero');
    if (vistos.has(l.material_id)) throw new ErrorValidacion('Un material aparece dos veces en la reserva: sume las cantidades en una sola línea');
    vistos.add(l.material_id);
  }
  return transaccion(t.pool, async (con) => {
    const o = await bloquearOrdenAbierta(con, d.orden_id);
    const numero = numeroDe(await siguienteNumero(con, 'RES'));
    const r = await ejecutar(con, 'INSERT INTO reservas (numero, orden_id, vence_en, notas, creada_por_id) VALUES (?, ?, ?, ?, ?)', [numero, d.orden_id, d.vence_en, normalizarCampo('texto', d.notas)?.slice(0, 300) ?? null, actor.usuarioId]);
    for (const l of [...d.lineas].sort((a, b) => a.material_id - b.material_id)) {
      const m = await una<{ activo: number }>(con, 'SELECT activo FROM materiales WHERE id = ?', [l.material_id]);
      if (!m || m.activo !== 1) throw new ErrorValidacion('Alguno de los materiales no existe o está desactivado');
      await ejecutar(con, 'INSERT INTO reserva_lineas (reserva_id, material_id, cantidad) VALUES (?, ?, ?)', [r.insertId, l.material_id, l.cantidad]);
    }
    await bitacora(con, actor, { accion: 'reserva_creada', entidad: 'reservas', entidadId: r.insertId, despues: { numero, orden: o.numero, vence_en: d.vence_en, lineas: d.lineas.length } });
    return { id: r.insertId, numero };
  });
}

// ── Consultar ─────────────────────────────────────────────────────────────────────────
interface LineaCruda {
  id: number;
  material_id: number;
  codigo: string;
  nombre: string;
  unidad: string;
  cantidad: number;
  cantidad_cubierta: number;
}

async function lineasDe(t: TallerReq, reservaId: number): Promise<LineaCruda[]> {
  return filas<LineaCruda>(
    t.pool,
    `SELECT l.id, l.material_id, m.codigo, m.nombre, u.codigo AS unidad, l.cantidad, l.cantidad_cubierta
       FROM reserva_lineas l JOIN materiales m ON m.id = l.material_id JOIN unidades u ON u.id = m.unidad_id WHERE l.reserva_id = ? ORDER BY l.id`,
    [reservaId]
  );
}

/** ¿Alcanza la existencia libre (sin lo reservado para otras órdenes) para cubrir lo que falta de cada línea? */
async function lineasConDisponibilidad(t: TallerReq, r: { id: number; orden_id: number; sucursal_id: number }, hoy: string) {
  const lineas = await lineasDe(t, r.id);
  const salida = [];
  for (const l of lineas) {
    const enSucursal = await existenciaEnSucursal(t.pool, l.material_id, r.sucursal_id);
    const otras = await reservadoPorOtras(t.pool, l.material_id, r.sucursal_id, r.orden_id, hoy);
    const pendiente = Number(l.cantidad) - Number(l.cantidad_cubierta);
    salida.push({
      id: l.id,
      material_id: l.material_id,
      codigo: l.codigo,
      nombre: l.nombre,
      unidad: l.unidad,
      cantidad: Number(l.cantidad),
      cantidad_cubierta: Number(l.cantidad_cubierta),
      pendiente,
      disponible: Math.max(0, enSucursal - otras),
      alcanza: pendiente === 0 || enSucursal - otras >= pendiente,
    });
  }
  return salida;
}

interface FilaReservaCruda {
  id: number;
  numero: string;
  orden_id: number;
  sucursal_id: number;
  orden: string;
  cliente: string | null;
  equipo: string;
  estado: EstadoReserva;
  vence_en: string;
  extensiones: number;
  creada_por: string | null;
  created_at: Date;
  lineas: number;
}

export async function listarReservas(ctx: Contexto, t: TallerReq, f: { estado?: EstadoReserva; abiertas?: boolean; orden_id?: number; buscar?: string; pagina: number; porPagina: number }) {
  const hoy = hoyDelTaller(ctx, t);
  await marcarVencidas(t.pool, hoy);
  const donde: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (f.estado) {
    donde.push('r.estado = ?');
    params.push(f.estado);
  }
  if (f.abiertas) donde.push("r.estado = 'activa'");
  if (f.orden_id) {
    donde.push('r.orden_id = ?');
    params.push(f.orden_id);
  }
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    donde.push('(r.numero LIKE ? OR o.numero LIKE ? OR c.nombre LIKE ?)');
    params.push(patron, patron, patron);
  }
  const de = `FROM reservas r JOIN ordenes o ON o.id = r.orden_id LEFT JOIN clientes c ON c.id = o.cliente_id JOIN equipos e ON e.id = o.equipo_id LEFT JOIN usuarios u ON u.id = r.creada_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE ${donde.join(' AND ')}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${de}`, params);
  const registros = await filas<FilaReservaCruda>(
    t.pool,
    `SELECT r.id, r.numero, r.orden_id, o.sucursal_id, o.numero AS orden, c.nombre AS cliente, CONCAT_WS(' · ', e.codigo_interno, e.placa) AS equipo, r.estado, DATE_FORMAT(r.vence_en, '%Y-%m-%d') AS vence_en,
            r.extensiones, co.nombre_completo AS creada_por, r.created_at,
            (SELECT COUNT(*) FROM reserva_lineas l WHERE l.reserva_id = r.id) AS lineas
       ${de} ORDER BY (r.estado = 'activa') DESC, r.vence_en, r.id DESC LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  const salida = [];
  for (const r of registros) {
    let lista = false;
    if (r.estado === 'activa') {
      const ls = await lineasConDisponibilidad(t, r, hoy);
      lista = ls.some((l) => l.pendiente > 0) && ls.every((l) => l.alcanza);
    }
    const { sucursal_id: _s, ...resto } = r;
    salida.push({ ...resto, lineas: Number(r.lineas), lista, dias_para_vencer: r.estado === 'activa' ? diasEntre(hoy, r.vence_en) : null });
  }
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros: salida };
}

export async function obtenerReserva(ctx: Contexto, t: TallerReq, id: number) {
  const hoy = hoyDelTaller(ctx, t);
  await marcarVencidas(t.pool, hoy);
  const r = await una<{ id: number; orden_id: number; sucursal_id: number; estado: EstadoReserva; vence_en: string } & Record<string, unknown>>(
    t.pool,
    `SELECT r.id, r.numero, r.orden_id, o.sucursal_id, o.numero AS orden, es.es_terminal AS orden_cerrada, c.nombre AS cliente, CONCAT_WS(' · ', e.codigo_interno, e.placa) AS equipo, r.estado,
            DATE_FORMAT(r.vence_en, '%Y-%m-%d') AS vence_en, r.extensiones, r.motivo_extension, r.notas, co.nombre_completo AS creada_por, r.creada_por_id, r.created_at, r.solicitud_id, sm.numero AS solicitud,
            r.cargada_en, r.cancelada_en, r.motivo_cancelacion
       FROM reservas r JOIN ordenes o ON o.id = r.orden_id JOIN estados_orden es ON es.id = o.estado_id LEFT JOIN clientes c ON c.id = o.cliente_id JOIN equipos e ON e.id = o.equipo_id
       LEFT JOIN usuarios u ON u.id = r.creada_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id LEFT JOIN solicitudes_material sm ON sm.id = r.solicitud_id WHERE r.id = ?`,
    [id]
  );
  if (!r) throw new ErrorNoEncontrado('No se encontró la reserva');
  const lineas = await lineasConDisponibilidad(t, r, hoy);
  const { sucursal_id: _s, orden_cerrada, ...resto } = r;
  return {
    ...resto,
    orden_cerrada: Number(orden_cerrada) === 1,
    lineas,
    lista: r.estado === 'activa' && lineas.some((l) => l.pendiente > 0) && lineas.every((l) => l.alcanza),
    dias_para_vencer: r.estado === 'activa' ? diasEntre(hoy, r.vence_en) : null,
  };
}

// ── Ampliar y cancelar ────────────────────────────────────────────────────────────────
async function reservaParaCambiar(con: Ejecutor, id: number) {
  const r = await una<{ numero: string; estado: EstadoReserva; vence_en: string; creada_por_id: number | null; orden_id: number }>(con, "SELECT numero, estado, DATE_FORMAT(vence_en, '%Y-%m-%d') AS vence_en, creada_por_id, orden_id FROM reservas WHERE id = ? FOR UPDATE", [id]);
  if (!r) throw new ErrorNoEncontrado('No se encontró la reserva');
  return r;
}

export async function ampliarReserva(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { vence_en: string; motivo: string }, puedeGestionar: boolean) {
  const hoy = hoyDelTaller(ctx, t);
  const motivo = normalizarCampo('texto', d.motivo);
  if (!motivo || motivo.length < 3) throw new ErrorValidacion('Ampliar una reserva pide el motivo');
  validarVencimiento(d.vence_en, hoy);
  return transaccion(t.pool, async (con) => {
    const r = await reservaParaCambiar(con, id);
    if (r.estado !== 'activa' || r.vence_en < hoy) throw new ErrorApp(409, 'REGLA', `La reserva ${r.numero} ya no está vigente: haga una nueva.`);
    if (!puedeGestionar) throw new ErrorApp(403, 'SIN_PERMISO', 'Ampliar una reserva pide un permiso especial.');
    await bloquearOrdenAbierta(con, r.orden_id);
    if (d.vence_en <= r.vence_en) throw new ErrorValidacion('La nueva fecha debe ser posterior a la actual');
    await ejecutar(con, 'UPDATE reservas SET vence_en = ?, extensiones = extensiones + 1, motivo_extension = ? WHERE id = ?', [d.vence_en, motivo.slice(0, 300), id]);
    await bitacora(con, actor, { accion: 'reserva_ampliada', entidad: 'reservas', entidadId: id, motivo, antes: { vence_en: r.vence_en }, despues: { vence_en: d.vence_en } });
    return { id };
  });
}

export async function cancelarReserva(ctx: Contexto, t: TallerReq, actor: Actor, id: number, motivo: string, puedeGestionar: boolean) {
  const texto = normalizarCampo('texto', motivo);
  if (!texto || texto.length < 3) throw new ErrorValidacion('Cancelar una reserva pide el motivo');
  return transaccion(t.pool, async (con) => {
    const r = await reservaParaCambiar(con, id);
    if (r.estado === 'cancelada') throw new ErrorApp(409, 'REGLA', `La reserva ${r.numero} ya está cancelada.`);
    if (r.estado === 'cargada') throw new ErrorApp(409, 'REGLA', `La reserva ${r.numero} ya se cargó a la orden: para deshacerlo devuelva el material a la bodega.`);
    if (r.creada_por_id !== actor.usuarioId && !puedeGestionar) throw new ErrorApp(403, 'SIN_PERMISO', 'Una reserva la cancela quien la hizo o quien tenga el permiso para hacerlo.');
    await ejecutar(con, "UPDATE reservas SET estado = 'cancelada', cancelada_en = ?, cancelada_por_id = ?, motivo_cancelacion = ? WHERE id = ?", [ahoraDe(ctx), actor.usuarioId, texto.slice(0, 300), id]);
    await bitacora(con, actor, { accion: 'reserva_cancelada', entidad: 'reservas', entidadId: id, motivo: texto });
    return { id };
  });
}

// ── Cargar a la orden ─────────────────────────────────────────────────────────────────
/**
 * Despacha a la orden TODO lo que falta de la reserva, o nada: si en las bodegas de la sucursal no alcanza para alguna línea, falla con
 * «no hay suficiente inventario» y no se mueve nada. Crea la solicitud de despacho normal (queda en el historial y en los tiempos de bodega).
 */
export async function cargarReserva(ctx: Contexto, t: TallerReq, actor: Actor, id: number) {
  const hoy = hoyDelTaller(ctx, t);
  const resultado = await transaccion(t.pool, async (con) => {
    const r = await reservaParaCambiar(con, id);
    if (r.estado === 'cargada') throw new ErrorApp(409, 'REGLA', `La reserva ${r.numero} ya se cargó a la orden.`);
    if (r.estado === 'cancelada') throw new ErrorApp(409, 'REGLA', `La reserva ${r.numero} está cancelada.`);
    if (r.estado === 'vencida' || r.vence_en < hoy) throw new ErrorApp(409, 'RESERVA_VENCIDA', `La reserva ${r.numero} venció el ${r.vence_en}: haga una nueva.`);
    const orden = await bloquearOrdenAbierta(con, r.orden_id);
    const pendientes = (await filas<{ material_id: number; codigo: string; nombre: string; falta: number }>(
      con,
      'SELECT l.material_id, m.codigo, m.nombre, l.cantidad - l.cantidad_cubierta AS falta FROM reserva_lineas l JOIN materiales m ON m.id = l.material_id WHERE l.reserva_id = ? AND l.cantidad > l.cantidad_cubierta ORDER BY l.material_id FOR UPDATE',
      [id]
    )).map((l) => ({ ...l, falta: Number(l.falta) }));
    if (pendientes.length === 0) throw new ErrorApp(409, 'REGLA', `La reserva ${r.numero} no tiene nada pendiente por cargar.`);
    // Se elige de qué bodegas sale cada material (primero la que más tiene) y, si no alcanza, se falla antes de mover nada.
    const plan: Array<{ material_id: number; bodega_id: number; cantidad: number }> = [];
    for (const l of pendientes) {
      const bodegas = await filas<{ bodega_id: number; cantidad: number }>(
        con,
        'SELECT e.bodega_id, e.cantidad FROM existencias e JOIN bodegas b ON b.id = e.bodega_id WHERE e.material_id = ? AND b.sucursal_id = ? AND b.activo = 1 AND e.cantidad > 0 ORDER BY e.cantidad DESC, e.bodega_id FOR UPDATE',
        [l.material_id, orden.sucursal_id]
      );
      let falta = l.falta;
      for (const b of bodegas) {
        if (falta <= 0) break;
        const toma = Math.min(falta, Number(b.cantidad));
        plan.push({ material_id: l.material_id, bodega_id: b.bodega_id, cantidad: toma });
        falta -= toma;
      }
      if (falta > 0) {
        throw new ErrorApp(409, 'SIN_EXISTENCIA', `No hay suficiente inventario de ${l.codigo} ${l.nombre}: hacen falta ${l.falta} y hay ${l.falta - falta}. La reserva no se carga hasta que haya las unidades completas.`, { material_id: l.material_id, disponible: l.falta - falta });
      }
    }
    const sol = await crearSolicitudEn(ctx, con, actor, { orden_id: r.orden_id, notas: `RESERVA ${r.numero}`, lineas: pendientes.map((l) => ({ material_id: l.material_id, cantidad: l.falta })) });
    const lineasSol = await filas<{ id: number; material_id: number }>(con, 'SELECT id, material_id FROM solicitud_lineas WHERE solicitud_id = ?', [sol.id]);
    await despacharEn(ctx, t, con, actor, sol.id, plan.map((p) => ({ linea_id: lineasSol.find((x) => x.material_id === p.material_id)!.id, bodega_id: p.bodega_id, cantidad: p.cantidad })));
    await ejecutar(con, "UPDATE reservas SET estado = 'cargada', solicitud_id = ?, cargada_en = COALESCE(cargada_en, ?) WHERE id = ?", [sol.id, ahoraDe(ctx), id]);
    await bitacora(con, actor, { accion: 'reserva_cargada', entidad: 'reservas', entidadId: id, despues: { numero: r.numero, solicitud: sol.numero } });
    return { id, solicitud_id: sol.id };
  });
  await avisarMaterialCargado(ctx, t, resultado.solicitud_id);
  return resultado;
}

// ── Alertas ───────────────────────────────────────────────────────────────────────────
export async function alertasDeInventario(ctx: Contexto, t: TallerReq, incluirReservas: boolean, incluirSolicitudes: boolean) {
  const hoy = hoyDelTaller(ctx, t);
  await marcarVencidas(t.pool, hoy);
  const bajo = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT m.id, m.codigo, m.nombre, m.existencia_minima, COALESCE(SUM(e.cantidad), 0) AS existencia_total
       FROM materiales m LEFT JOIN existencias e ON e.material_id = m.id WHERE m.activo = 1 AND m.existencia_minima > 0
      GROUP BY m.id, m.codigo, m.nombre, m.existencia_minima HAVING COALESCE(SUM(e.cantidad), 0) < m.existencia_minima ORDER BY (COALESCE(SUM(e.cantidad), 0) / m.existencia_minima), m.nombre LIMIT 50`
  );
  const salida: Record<string, unknown> = { bajo_minimo: bajo.map((m) => ({ ...m, existencia_minima: Number(m['existencia_minima']), existencia_total: Number(m['existencia_total']) })) };
  if (incluirReservas) {
    const activas = await listarReservas(ctx, t, { abiertas: true, pagina: 1, porPagina: 200 });
    salida['reservas_por_vencer'] = activas.registros.filter((r) => r.dias_para_vencer !== null && r.dias_para_vencer <= 7).map((r) => ({ id: r.id, numero: r.numero, orden: r.orden, vence_en: r.vence_en, dias_para_vencer: r.dias_para_vencer }));
    salida['reservas_listas'] = activas.registros.filter((r) => r.lista).map((r) => ({ id: r.id, numero: r.numero, orden: r.orden, cliente: r.cliente }));
  }
  if (incluirSolicitudes) {
    const p = await una<{ n: number; mas_vieja: Date | null }>(t.pool, "SELECT COUNT(*) AS n, MIN(solicitada_en) AS mas_vieja FROM solicitudes_material WHERE estado IN ('no_despachada', 'despachada_parcial')");
    salida['solicitudes_pendientes'] = Number(p?.n ?? 0);
    salida['solicitud_mas_vieja'] = p?.mas_vieja ?? null;
  }
  return salida;
}
