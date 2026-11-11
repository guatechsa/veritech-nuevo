import { Entorno } from '../config/entorno';
import { EntradaWebhook, EstadoPaypal, ProveedorPagos, SuscripcionPaypal, TransaccionPaypal } from './tipos';

const TIEMPO_MAXIMO_MS = 12_000;
const ID_VALIDO = /^[A-Za-z0-9_-]{3,64}$/;

type Fetch = typeof fetch;

interface RespuestaSuscripcion {
  id: string;
  status: EstadoPaypal;
  plan_id: string;
  custom_id?: string;
  subscriber?: { email_address?: string };
  billing_info?: {
    next_billing_time?: string;
    last_payment?: { time?: string };
    failed_payments_count?: number;
    outstanding_balance?: { value?: string };
    cycle_executions?: Array<{ tenure_type: string; cycles_remaining?: number; cycles_completed?: number }>;
  };
}

interface RespuestaTransacciones {
  transactions?: Array<{ id: string; status: string; time: string; amount_with_breakdown?: { gross_amount?: { currency_code?: string; value?: string } } }>;
}

function exigirId(id: string): string {
  if (!ID_VALIDO.test(id)) throw new Error('Identificador de suscripción inválido');
  return id;
}

function fecha(valor: string | undefined): Date | null {
  if (!valor) return null;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function mapearSuscripcion(r: RespuestaSuscripcion): SuscripcionPaypal {
  const info = r.billing_info;
  const prueba = info?.cycle_executions?.find((c) => c.tenure_type === 'TRIAL');
  const regular = info?.cycle_executions?.find((c) => c.tenure_type === 'REGULAR');
  return {
    id: r.id,
    estado: r.status,
    planId: r.plan_id,
    customId: r.custom_id ?? null,
    correoSuscriptor: r.subscriber?.email_address ?? null,
    proximoCobro: fecha(info?.next_billing_time),
    ultimoPagoEn: fecha(info?.last_payment?.time),
    pagosFallidos: info?.failed_payments_count ?? 0,
    saldoPendiente: Number(info?.outstanding_balance?.value ?? 0) || 0,
    // PayPal da por "completado" el ciclo de prueba (de 0 dólares) desde el primer momento, así que NO sirve mirar sus
    // ciclos restantes. Se está en prueba mientras el plan la tenga y todavía no se haya cobrado ni un ciclo regular
    // (comprobado con una suscripción real de pruebas, 2026-11-11).
    enPrueba: prueba !== undefined && regular !== undefined && (regular.cycles_completed ?? 0) === 0 && !info?.last_payment,
  };
}

/** Cliente real de PayPal (API REST). Sin identificador y llave devuelve `null`: el cobro queda apagado. */
export function crearProveedorPaypal(entorno: Entorno, fetchFn: Fetch = fetch): ProveedorPagos | null {
  if (!entorno.PAYPAL_CLIENT_ID || !entorno.PAYPAL_SECRETO) return null;
  const base = entorno.PAYPAL_MODO === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
  const credenciales = Buffer.from(`${entorno.PAYPAL_CLIENT_ID}:${entorno.PAYPAL_SECRETO}`).toString('base64');
  let token: { valor: string; vence: number } | null = null;

  async function obtenerToken(): Promise<string> {
    if (token && token.vence > Date.now() + 60_000) return token.valor;
    const r = await fetchFn(`${base}/v1/oauth2/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${credenciales}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    if (!r.ok) throw new Error(`PayPal rechazó la autenticación (${r.status})`);
    const datos = (await r.json()) as { access_token: string; expires_in: number };
    token = { valor: datos.access_token, vence: Date.now() + datos.expires_in * 1000 };
    return token.valor;
  }

  async function llamar(metodo: 'GET' | 'POST', ruta: string, cuerpo?: unknown): Promise<Response> {
    const r = await fetchFn(`${base}${ruta}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${await obtenerToken()}`, 'Content-Type': 'application/json' },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
    });
    return r;
  }

  return {
    async obtenerSuscripcion(id) {
      const r = await llamar('GET', `/v1/billing/subscriptions/${exigirId(id)}`);
      // PayPal contesta 404 a un identificador bien formado que no existe y 400 a uno mal formado: para nosotros, ambos son "no existe".
      if (r.status === 404 || r.status === 400) return null;
      if (!r.ok) throw new Error(`PayPal respondió ${r.status} al consultar la suscripción`);
      return mapearSuscripcion((await r.json()) as RespuestaSuscripcion);
    },

    async cancelarSuscripcion(id, motivo) {
      const r = await llamar('POST', `/v1/billing/subscriptions/${exigirId(id)}/cancel`, { reason: motivo.slice(0, 128) });
      if (!r.ok && r.status !== 422) throw new Error(`PayPal respondió ${r.status} al cancelar la suscripción`);
      // 422 = ya estaba cancelada: el resultado deseado ya se cumple.
    },

    async listarTransacciones(id, desde, hasta) {
      const consulta = new URLSearchParams({ start_time: desde.toISOString(), end_time: hasta.toISOString() });
      const r = await llamar('GET', `/v1/billing/subscriptions/${exigirId(id)}/transactions?${consulta.toString()}`);
      if (!r.ok) throw new Error(`PayPal respondió ${r.status} al listar los pagos`);
      const datos = (await r.json()) as RespuestaTransacciones;
      const resultado: TransaccionPaypal[] = [];
      for (const t of datos.transactions ?? []) {
        const bruto = t.amount_with_breakdown?.gross_amount;
        resultado.push({ id: t.id, fecha: new Date(t.time), monto: Number(bruto?.value ?? 0) || 0, moneda: bruto?.currency_code ?? 'USD', estado: t.status });
      }
      return resultado;
    },

    async verificarWebhook(entrada: EntradaWebhook) {
      if (!entorno.PAYPAL_WEBHOOK_ID) return false; // sin identificador, nunca se acepta (falla cerrada)
      const h = (n: string): string => {
        const v = entrada.headers[n];
        return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
      };
      let evento: unknown;
      try {
        evento = JSON.parse(entrada.cuerpoCrudo);
      } catch {
        return false;
      }
      const r = await llamar('POST', '/v1/notifications/verify-webhook-signature', {
        auth_algo: h('paypal-auth-algo'),
        cert_url: h('paypal-cert-url'),
        transmission_id: h('paypal-transmission-id'),
        transmission_sig: h('paypal-transmission-sig'),
        transmission_time: h('paypal-transmission-time'),
        webhook_id: entorno.PAYPAL_WEBHOOK_ID,
        webhook_event: evento,
      });
      if (!r.ok) return false;
      const datos = (await r.json()) as { verification_status?: string };
      return datos.verification_status === 'SUCCESS';
    },
  };
}
