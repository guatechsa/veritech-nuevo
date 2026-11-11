import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { correoPagoRecibido } from '../correos/ciclo-vida';
import { ErrorApp, ErrorConflicto, ErrorNoEncontrado } from '../errores';
import { registrarAuditoria } from '../plataforma/auditoria';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { decidirPorPaypal } from './estado';
import { MS_DIA, sumarDias } from './politica';
import { aplicarDecision, avisarEmpresa, bloquearEmpresa, COLUMNAS_EMPRESA, datosTaller, FilaEmpresa, OrigenEvento } from './transicion';
import { ProveedorPagos } from './tipos';

/** PayPal pide ventanas de 31 días como máximo al listar pagos. */
const VENTANA_DIAS = 30;
const MAXIMO_VENTANAS = 24;

export interface ResultadoConciliacion {
  empresaId: number;
  omitida?: string;
  cambioEstado?: boolean;
  estado?: string;
  motivo?: string;
  pagosNuevos?: number;
}

function exigirPagos(ctx: Contexto): ProveedorPagos {
  if (!ctx.pagos) throw new ErrorApp(503, 'COBRO_APAGADO', 'El cobro con PayPal no está configurado en este servidor');
  return ctx.pagos;
}

/** Guarda los pagos que PayPal informa y avisa por correo de los nuevos. Devuelve cuántos eran nuevos. */
async function sincronizarPagos(ctx: Contexto, pagos: ProveedorPagos, e: FilaEmpresa, desde: Date, ahora: Date): Promise<number> {
  let nuevos = 0;
  let inicio = desde;
  for (let i = 0; i < MAXIMO_VENTANAS && inicio < ahora; i++) {
    const fin = new Date(Math.min(inicio.getTime() + VENTANA_DIAS * MS_DIA, ahora.getTime()));
    const transacciones = await pagos.listarTransacciones(e.paypal_suscripcion_id as string, inicio, fin);
    for (const t of transacciones) {
      const r = await ejecutar(
        ctx.pool,
        'INSERT IGNORE INTO pagos (empresa_id, paypal_transaccion_id, fecha, monto, moneda, estado) VALUES (?, ?, ?, ?, ?, ?)',
        [e.id, t.id.slice(0, 40), t.fecha, t.monto, t.moneda.slice(0, 3), t.estado.slice(0, 30)]
      );
      if (r.affectedRows === 1) {
        nuevos += 1;
        if (t.estado === 'COMPLETED' && t.monto > 0) {
          await avisarEmpresa(ctx.pool, e, correoPagoRecibido(datosTaller(e), { monto: t.monto, moneda: t.moneda, fecha: t.fecha, transaccion: t.id }), `pago:${t.id}`);
        }
      }
    }
    inicio = fin;
  }
  return nuevos;
}

/**
 * Pone una empresa al día con PayPal (la fuente de verdad): trae la suscripción y los pagos, decide el estado con la
 * regla única y lo aplica. Se usa en la conciliación cada 3 horas, tras un aviso de PayPal y desde el panel.
 */
export async function conciliarEmpresa(
  ctx: Contexto,
  empresaId: number,
  origen: OrigenEvento,
  opciones: { tipo?: string; usuarioId?: number | null; detalle?: string } = {}
): Promise<ResultadoConciliacion> {
  const ahora = ahoraDe(ctx);
  const antes = await una<FilaEmpresa & { created_at: Date; ultima_conciliacion_en: Date | null }>(
    ctx.pool,
    `SELECT ${COLUMNAS_EMPRESA}, created_at, ultima_conciliacion_en FROM empresas WHERE id = ?`,
    [empresaId]
  );
  if (!antes) throw new ErrorNoEncontrado('Empresa no encontrada');
  if (!antes.paypal_suscripcion_id) return { empresaId, omitida: 'sin suscripción de PayPal' };
  if (antes.cobro_por_contrato) return { empresaId, omitida: 'cobro por contrato' };
  if (antes.estado === 'cerrada') return { empresaId, omitida: 'cuenta cerrada' };

  const pagos = exigirPagos(ctx);
  const suscripcion = await pagos.obtenerSuscripcion(antes.paypal_suscripcion_id);
  if (!suscripcion) {
    await ejecutar(
      ctx.pool,
      `INSERT INTO suscripcion_eventos (empresa_id, tipo, origen, detalle, procesado_en) VALUES (?, 'suscripcion_no_encontrada', ?, 'PayPal no conoce la suscripción registrada', ?)`,
      [empresaId, origen, ahora]
    );
    return { empresaId, omitida: 'PayPal no conoce la suscripción' };
  }

  const desde = sumarDias(antes.ultima_conciliacion_en ?? antes.created_at, -2);
  const pagosNuevos = await sincronizarPagos(ctx, pagos, antes, desde, ahora);

  return transaccion(ctx.pool, async (con) => {
    const e = await bloquearEmpresa(con, empresaId);
    if (!e) throw new ErrorNoEncontrado('Empresa no encontrada');
    const decision = decidirPorPaypal(e, suscripcion, ahora);
    await aplicarDecision(con, ahora, e, decision, { origen, tipo: opciones.tipo ?? 'conciliacion', usuarioId: opciones.usuarioId, detalle: opciones.detalle ?? decision.motivo });
    await ejecutar(con, 'UPDATE empresas SET paypal_estado = ?, ultima_conciliacion_en = ? WHERE id = ?', [suscripcion.estado, ahora, empresaId]);
    return { empresaId, cambioEstado: decision.cambioEstado, estado: decision.estado, motivo: decision.motivo, pagosNuevos };
  });
}

/** Conciliación periódica (cada 3 horas): una empresa que falla no detiene a las demás. */
export async function conciliarTodas(ctx: Contexto): Promise<{ revisadas: number; cambiaron: number; errores: Array<{ empresaId: number; error: string }> }> {
  const empresas = await filas<{ id: number }>(
    ctx.pool,
    `SELECT id FROM empresas WHERE paypal_suscripcion_id IS NOT NULL AND cobro_por_contrato = 0 AND estado NOT IN ('cerrada','pendiente') ORDER BY id`
  );
  const resumen = { revisadas: 0, cambiaron: 0, errores: [] as Array<{ empresaId: number; error: string }> };
  for (const { id } of empresas) {
    try {
      const r = await conciliarEmpresa(ctx, id, 'conciliacion');
      if (!r.omitida) resumen.revisadas += 1;
      if (r.cambioEstado) resumen.cambiaron += 1;
    } catch (error) {
      resumen.errores.push({ empresaId: id, error: (error instanceof Error ? error.message : String(error)).slice(0, 300) });
    }
  }
  return resumen;
}

/**
 * Cancelar la suscripción (lo pide el administrador del taller; una sesión de soporte NO puede cancelar por el cliente).
 * Primero se cancela en PayPal: si PayPal no acepta, no se toca nada. El servicio sigue hasta el final del período pagado.
 */
export async function cancelarSuscripcionDeEmpresa(
  ctx: Contexto,
  empresaId: number,
  motivo: string,
  actor: { usuarioId?: number | null; ip?: string }
): Promise<ResultadoConciliacion> {
  const pagos = exigirPagos(ctx);
  const empresa = await una<FilaEmpresa>(ctx.pool, `SELECT ${COLUMNAS_EMPRESA} FROM empresas WHERE id = ?`, [empresaId]);
  if (!empresa) throw new ErrorNoEncontrado('Empresa no encontrada');
  if (!empresa.paypal_suscripcion_id || empresa.cobro_por_contrato) throw new ErrorConflicto('Esta cuenta no tiene una suscripción de PayPal que cancelar');
  if (!['prueba', 'activa', 'pago_fallido'].includes(empresa.estado)) throw new ErrorConflicto(`Una cuenta en estado «${empresa.estado}» no se puede cancelar`);

  const actual = await pagos.obtenerSuscripcion(empresa.paypal_suscripcion_id);
  if (!actual) throw new ErrorConflicto('PayPal no reconoce la suscripción');
  const accesoHasta = actual.proximoCobro ?? empresa.proximo_cobro_en ?? ahoraDe(ctx);
  try {
    await pagos.cancelarSuscripcion(empresa.paypal_suscripcion_id, motivo);
  } catch {
    throw new ErrorApp(502, 'PAYPAL_NO_RESPONDE', 'PayPal no aceptó la cancelación. No se hizo ningún cambio; intente de nuevo en unos minutos.');
  }
  await ejecutar(ctx.pool, 'UPDATE empresas SET acceso_hasta = ? WHERE id = ?', [accesoHasta, empresaId]);
  await registrarAuditoria(ctx.pool, { usuarioId: actor.usuarioId ?? null, accion: 'suscripcion_cancelada', empresaId, descripcion: `Se canceló la suscripción de ${empresa.nombre}. Motivo: ${motivo.slice(0, 200)}`, ip: actor.ip });
  return conciliarEmpresa(ctx, empresaId, 'manual', { tipo: 'cancelacion_solicitada', usuarioId: actor.usuarioId, detalle: `Cancelación solicitada. ${motivo.slice(0, 200)}` });
}
