import { Ejecutor, ejecutar, filas, una } from '../db/consulta';

/**
 * Lo mínimo de las reservas que necesita el despacho (Fase 5c). Una reserva protege unidades de un material para UNA orden: mientras
 * esté activa y no haya vencido (vale hasta el final de su día), esas unidades no se pueden despachar a otra orden de la misma sucursal.
 * Las unidades pendientes son las reservadas menos las que ya se despacharon a esa orden.
 */

/** Unidades de un material reservadas por OTRAS órdenes abiertas de la sucursal (las de una orden cerrada o anulada no protegen nada). */
export async function reservadoPorOtras(con: Ejecutor, materialId: number, sucursalId: number, ordenId: number, hoy: string): Promise<number> {
  const f = await una<{ n: number | null }>(
    con,
    `SELECT SUM(rl.cantidad - rl.cantidad_cubierta) AS n
       FROM reserva_lineas rl JOIN reservas r ON r.id = rl.reserva_id JOIN ordenes o ON o.id = r.orden_id JOIN estados_orden es ON es.id = o.estado_id
      WHERE rl.material_id = ? AND r.estado = 'activa' AND r.vence_en >= ? AND o.sucursal_id = ? AND r.orden_id <> ? AND es.es_terminal = 0`,
    [materialId, hoy, sucursalId, ordenId]
  );
  return Number(f?.n ?? 0);
}

/** Existencia de un material sumando las bodegas activas de la sucursal. */
export async function existenciaEnSucursal(con: Ejecutor, materialId: number, sucursalId: number): Promise<number> {
  const f = await una<{ n: number | null }>(con, 'SELECT SUM(e.cantidad) AS n FROM existencias e JOIN bodegas b ON b.id = e.bodega_id WHERE e.material_id = ? AND b.sucursal_id = ? AND b.activo = 1', [materialId, sucursalId]);
  return Number(f?.n ?? 0);
}

/**
 * Lo despachado a una orden cubre primero sus propias reservas (la más vieja primero). Cuando una reserva queda totalmente cubierta
 * pasa sola a «cargada». Devuelve las reservas que quedaron cubiertas.
 */
export async function cubrirReservasDeLaOrden(con: Ejecutor, ordenId: number, materialId: number, cantidad: number, ahora: Date): Promise<number[]> {
  let falta = cantidad;
  const completas: number[] = [];
  const lineas = await filas<{ id: number; reserva_id: number; cantidad: number; cantidad_cubierta: number }>(
    con,
    `SELECT rl.id, rl.reserva_id, rl.cantidad, rl.cantidad_cubierta FROM reserva_lineas rl JOIN reservas r ON r.id = rl.reserva_id
      WHERE r.orden_id = ? AND r.estado = 'activa' AND rl.material_id = ? AND rl.cantidad > rl.cantidad_cubierta ORDER BY r.id FOR UPDATE`,
    [ordenId, materialId]
  );
  for (const l of lineas) {
    if (falta <= 0) break;
    const toma = Math.min(falta, Number(l.cantidad) - Number(l.cantidad_cubierta));
    await ejecutar(con, 'UPDATE reserva_lineas SET cantidad_cubierta = cantidad_cubierta + ? WHERE id = ?', [toma, l.id]);
    falta -= toma;
    const pend = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM reserva_lineas WHERE reserva_id = ? AND cantidad > cantidad_cubierta', [l.reserva_id]);
    if (Number(pend?.n ?? 0) === 0) {
      await ejecutar(con, "UPDATE reservas SET estado = 'cargada', cargada_en = ? WHERE id = ?", [ahora, l.reserva_id]);
      completas.push(l.reserva_id);
    }
  }
  return completas;
}

/** Unidades de un material reservadas en total (todas las sucursales) y todavía vigentes. */
export async function reservadoTotal(con: Ejecutor, materialId: number, hoy: string): Promise<number> {
  const f = await una<{ n: number | null }>(
    con,
    `SELECT SUM(rl.cantidad - rl.cantidad_cubierta) AS n
       FROM reserva_lineas rl JOIN reservas r ON r.id = rl.reserva_id JOIN ordenes o ON o.id = r.orden_id JOIN estados_orden es ON es.id = o.estado_id
      WHERE rl.material_id = ? AND r.estado = 'activa' AND r.vence_en >= ? AND es.es_terminal = 0`,
    [materialId, hoy]
  );
  return Number(f?.n ?? 0);
}
