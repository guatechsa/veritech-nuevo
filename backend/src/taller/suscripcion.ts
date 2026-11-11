import { cancelarSuscripcionDeEmpresa } from '../cobro/conciliacion';
import { filas, una } from '../db/consulta';
import { ErrorApp } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { EmpresaDePeticion } from './contexto';

/** Pantalla "Suscripción y pagos" del taller: lo que sabe la plataforma (guardado, no consultado a PayPal en cada visita). */
export async function resumenSuscripcion(ctx: Contexto, empresa: EmpresaDePeticion, puedeCancelar: boolean) {
  const f = await una<{
    estado: string;
    cuota_mensual: number | null;
    cobro_por_contrato: number;
    prueba_hasta: Date | null;
    proximo_cobro_en: Date | null;
    gracia_hasta: Date | null;
    acceso_hasta: Date | null;
    exportable_hasta: Date | null;
    borrado_programado_en: Date | null;
    paypal_suscripcion_id: string | null;
  }>(
    ctx.pool,
    `SELECT estado, cuota_mensual, cobro_por_contrato, prueba_hasta, proximo_cobro_en, gracia_hasta, acceso_hasta, exportable_hasta, borrado_programado_en, paypal_suscripcion_id
       FROM empresas WHERE id = ?`,
    [empresa.id]
  );
  if (!f) throw new ErrorApp(404, 'TALLER_NO_ENCONTRADO', 'No encontramos ese taller.');
  const pagos = await filas<{ paypal_transaccion_id: string; fecha: Date; monto: number; moneda: string; estado: string }>(
    ctx.pool,
    'SELECT paypal_transaccion_id, fecha, monto, moneda, estado FROM pagos WHERE empresa_id = ? ORDER BY fecha DESC LIMIT 24',
    [empresa.id]
  );
  const cancelable = ['prueba', 'activa', 'pago_fallido'].includes(f.estado) && !f.cobro_por_contrato && f.paypal_suscripcion_id !== null;
  return {
    estado: f.estado,
    plan: empresa.planNombre,
    cuota_mensual: f.cuota_mensual,
    cobro_por_contrato: f.cobro_por_contrato === 1,
    prueba_hasta: f.prueba_hasta,
    proximo_cobro_en: f.proximo_cobro_en,
    gracia_hasta: f.gracia_hasta,
    acceso_hasta: f.acceso_hasta,
    exportable_hasta: f.exportable_hasta,
    borrado_programado_en: f.borrado_programado_en,
    limites: { max_usuarios: empresa.maxUsuarios, max_sucursales: empresa.maxSucursales },
    pagos: pagos.map((p) => ({ ...p, monto: Number(p.monto) })),
    puede_cancelar: cancelable && puedeCancelar,
  };
}

/** Cancelar es cosa del cliente: una sesión de soporte de GUATECH nunca puede cancelar por él. */
export async function cancelarDesdeTaller(ctx: Contexto, empresa: EmpresaDePeticion, sesion: { esSoporte: boolean; usuarioId: number }, motivo: string, ip: string) {
  if (sesion.esSoporte) throw new ErrorApp(403, 'SOPORTE_NO_CANCELA', 'Una sesión de soporte no puede cancelar la suscripción: debe hacerlo el cliente.');
  return cancelarSuscripcionDeEmpresa(ctx, empresa.id, motivo, { usuarioId: null, ip });
}
