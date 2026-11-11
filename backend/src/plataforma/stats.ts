import { una } from '../db/consulta';
import { Contexto } from './contexto';
import { ESTADOS_ACTIVOS, ESTADOS_EN_PRUEBA, ESTADOS_SUSPENDIDOS } from './empresas';

/** Primer instante del mes en curso, en hora de Guatemala (UTC-6, sin horario de verano), expresado en UTC. */
export function inicioDeMesGuatemalaEnUtc(ahora: Date = new Date()): Date {
  const local = new Date(ahora.getTime() - 6 * 3600 * 1000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 6, 0, 0));
}

function lista(estados: string[]): string {
  return estados.map(() => '?').join(',');
}

/**
 * Los 5 indicadores del panel (estándar de superadmin §2) con el contrato fijo de `GET /stats`.
 * Regla de honestidad: si ningún cliente activo tiene cuota registrada, el ingreso es "sin datos", nunca cero.
 */
export async function obtenerIndicadores(ctx: Contexto, ahora: Date = new Date()) {
  const conteo = async (estados: string[]): Promise<number> =>
    Number((await una<{ n: number }>(ctx.pool, `SELECT COUNT(*) AS n FROM empresas WHERE estado IN (${lista(estados)})`, estados))?.n ?? 0);
  const total = Number((await una<{ n: number }>(ctx.pool, 'SELECT COUNT(*) AS n FROM empresas'))?.n ?? 0);
  const ingreso = await una<{ suma: number | null; con_cuota: number }>(
    ctx.pool,
    `SELECT SUM(cuota_mensual) AS suma, COUNT(cuota_mensual) AS con_cuota FROM empresas WHERE estado IN (${lista(ESTADOS_ACTIVOS)})`,
    ESTADOS_ACTIVOS
  );
  const altas = await una<{ n: number }>(ctx.pool, 'SELECT COUNT(*) AS n FROM empresas WHERE created_at >= ?', [inicioDeMesGuatemalaEnUtc(ahora)]);
  const usuarios = await una<{ total: number; activos: number | null }>(ctx.pool, 'SELECT COUNT(*) AS total, SUM(activo) AS activos FROM usuarios_plataforma');
  const eventos = await una<{ n: number }>(ctx.pool, 'SELECT COUNT(*) AS n FROM auditoria_plataforma');

  const sinDatos = Number(ingreso?.con_cuota ?? 0) === 0;
  return {
    clientes: {
      activos: await conteo(ESTADOS_ACTIVOS),
      en_prueba: await conteo(ESTADOS_EN_PRUEBA),
      suspendidos: await conteo(ESTADOS_SUSPENDIDOS),
      total,
    },
    ingreso_mensual: { monto: sinDatos ? null : Number(ingreso?.suma ?? 0), sin_datos: sinDatos },
    altas_mes: Number(altas?.n ?? 0),
    usuarios_plataforma: { total: Number(usuarios?.total ?? 0), activos: Number(usuarios?.activos ?? 0) },
    eventos_auditoria: Number(eventos?.n ?? 0),
  };
}
