import { ejecutar, filas, una } from '../db/consulta';
import { ErrorApp, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { conciliarEmpresa } from './conciliacion';
import { EntradaWebhook } from './tipos';

/**
 * Aviso (webhook) de PayPal. Solo acelera: el estado real siempre sale de consultarle a PayPal (la conciliación manda).
 *  1. Se verifica la firma. Sin identificador de aviso configurado o con firma mala, se rechaza (nunca falla abierta).
 *  2. Se GUARDA primero. Un aviso con el mismo identificador nunca se guarda dos veces.
 *  3. Se procesa después (consultando a PayPal), y si falla queda pendiente para el reintento.
 */
export async function recibirAviso(ctx: Contexto, entrada: EntradaWebhook): Promise<{ resultado: 'duplicado' | 'recibido'; eventoId?: number }> {
  if (!ctx.pagos || !ctx.entorno.PAYPAL_WEBHOOK_ID) {
    throw new ErrorApp(503, 'AVISO_NO_CONFIGURADO', 'La recepción de avisos de PayPal no está configurada');
  }
  if (!(await ctx.pagos.verificarWebhook(entrada))) {
    throw new ErrorApp(400, 'FIRMA_INVALIDA', 'No se pudo verificar la firma del aviso');
  }

  let evento: { id?: unknown; event_type?: unknown; resource?: Record<string, unknown> };
  try {
    evento = JSON.parse(entrada.cuerpoCrudo) as typeof evento;
  } catch {
    throw new ErrorValidacion('El aviso no es un JSON válido');
  }
  const id = typeof evento.id === 'string' ? evento.id.slice(0, 60) : '';
  const tipo = typeof evento.event_type === 'string' ? evento.event_type.slice(0, 60) : '';
  if (!id || !tipo) throw new ErrorValidacion('Al aviso le falta su identificador o su tipo');

  const recurso = evento.resource ?? {};
  // Los avisos de la suscripción traen su id en `id`; los de cobro (PAYMENT.SALE.*) lo traen en `billing_agreement_id`.
  const suscripcionId = typeof recurso['billing_agreement_id'] === 'string' ? recurso['billing_agreement_id'] : tipo.startsWith('BILLING.SUBSCRIPTION.') && typeof recurso['id'] === 'string' ? recurso['id'] : null;
  const empresa = suscripcionId ? await una<{ id: number }>(ctx.pool, 'SELECT id FROM empresas WHERE paypal_suscripcion_id = ?', [suscripcionId]) : null;

  const r = await ejecutar(
    ctx.pool,
    `INSERT IGNORE INTO suscripcion_eventos (empresa_id, evento_paypal_id, tipo, origen, detalle, payload) VALUES (?, ?, ?, 'aviso', ?, ?)`,
    [empresa?.id ?? null, id, tipo, suscripcionId ? `Suscripción ${suscripcionId}` : 'Sin suscripción identificable', entrada.cuerpoCrudo.slice(0, 60000)]
  );
  if (r.affectedRows === 0) return { resultado: 'duplicado' };
  return { resultado: 'recibido', eventoId: r.insertId };
}

/** Procesa un aviso ya guardado. Un fallo no lo pierde: queda sin `procesado_en` y el barrido lo reintenta. */
export async function procesarAviso(ctx: Contexto, eventoId: number): Promise<void> {
  const evento = await una<{ empresa_id: number | null; tipo: string; procesado_en: Date | null }>(
    ctx.pool,
    'SELECT empresa_id, tipo, procesado_en FROM suscripcion_eventos WHERE id = ?',
    [eventoId]
  );
  if (!evento || evento.procesado_en) return;
  if (evento.empresa_id !== null) {
    await conciliarEmpresa(ctx, evento.empresa_id, 'aviso', { tipo: `aviso:${evento.tipo}`, detalle: `Aviso de PayPal ${evento.tipo}` });
  }
  await ejecutar(ctx.pool, 'UPDATE suscripcion_eventos SET procesado_en = ? WHERE id = ?', [ahoraDe(ctx), eventoId]);
}

/** Reintenta los avisos que se guardaron pero no se procesaron (hace más de un minuto). */
export async function procesarAvisosPendientes(ctx: Contexto): Promise<number> {
  const ahora = ahoraDe(ctx);
  const pendientes = await filas<{ id: number }>(
    ctx.pool,
    `SELECT id FROM suscripcion_eventos WHERE origen = 'aviso' AND evento_paypal_id IS NOT NULL AND procesado_en IS NULL AND created_at < ? ORDER BY id LIMIT 50`,
    [new Date(ahora.getTime() - 60_000)]
  );
  let procesados = 0;
  for (const { id } of pendientes) {
    try {
      await procesarAviso(ctx, id);
      procesados += 1;
    } catch (error) {
      console.error('[cobro] no se pudo procesar el aviso', id, error);
    }
  }
  return procesados;
}
