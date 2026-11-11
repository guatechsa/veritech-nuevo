import { leerEntorno } from '../../src/config/entorno';
import { crearProveedorPaypal, mapearSuscripcion } from '../../src/cobro/paypal';
import { fechaLegible } from '../../src/correos/ciclo-vida';
import { exigirSlugValido, motivoSlugInvalido, nombreBdDeSlug } from '../../src/utils/slug';

const entorno = (extra: Record<string, string> = {}) =>
  leerEntorno({ BD_USUARIO: 'u', JWT_SECRETO: 'x'.repeat(40), PAYPAL_CLIENT_ID: 'cliente', PAYPAL_SECRETO: 'llave', PAYPAL_WEBHOOK_ID: 'WH-1', ...extra } as NodeJS.ProcessEnv);

interface Llamada {
  url: string;
  metodo: string;
  cuerpo: string | undefined;
  auth: string | undefined;
}

function fetchSimulado(respuestas: Array<{ estado: number; cuerpo?: unknown }>) {
  const llamadas: Llamada[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    llamadas.push({ url, metodo: init?.method ?? 'GET', cuerpo: init?.body as string | undefined, auth: (init?.headers as Record<string, string> | undefined)?.['Authorization'] });
    const r = respuestas.shift() ?? { estado: 500 };
    return new Response(r.cuerpo === undefined ? null : JSON.stringify(r.cuerpo), { status: r.estado });
  }) as unknown as typeof fetch;
  return { fn, llamadas };
}

const TOKEN = { estado: 200, cuerpo: { access_token: 'tok', expires_in: 3600 } };

describe('cliente de PayPal', () => {
  it('sin identificador y llave el cobro queda apagado', () => {
    expect(crearProveedorPaypal(leerEntorno({ BD_USUARIO: 'u', JWT_SECRETO: 'x'.repeat(40) } as NodeJS.ProcessEnv))).toBeNull();
  });

  it('usa la dirección de pruebas por defecto y la real solo si se pide', async () => {
    const a = fetchSimulado([TOKEN, { estado: 404 }]);
    await crearProveedorPaypal(entorno(), a.fn)!.obtenerSuscripcion('I-1');
    expect(a.llamadas[0]?.url).toBe('https://api-m.sandbox.paypal.com/v1/oauth2/token');
    const b = fetchSimulado([TOKEN, { estado: 404 }]);
    await crearProveedorPaypal(entorno({ PAYPAL_MODO: 'live' }), b.fn)!.obtenerSuscripcion('I-1');
    expect(b.llamadas[0]?.url).toBe('https://api-m.paypal.com/v1/oauth2/token');
  });

  it('pide el token una sola vez y lo reutiliza', async () => {
    const f = fetchSimulado([TOKEN, { estado: 404 }, { estado: 404 }]);
    const p = crearProveedorPaypal(entorno(), f.fn)!;
    await p.obtenerSuscripcion('I-1');
    await p.obtenerSuscripcion('I-2');
    expect(f.llamadas.filter((l) => l.url.endsWith('/oauth2/token'))).toHaveLength(1);
    expect(f.llamadas[1]?.auth).toBe('Bearer tok');
  });

  it('una suscripción que no existe devuelve null, pero un error de PayPal lanza (no se confunden)', async () => {
    const f = fetchSimulado([TOKEN, { estado: 404 }, { estado: 500 }]);
    const p = crearProveedorPaypal(entorno(), f.fn)!;
    expect(await p.obtenerSuscripcion('I-NO')).toBeNull();
    await expect(p.obtenerSuscripcion('I-1')).rejects.toThrow('PayPal respondió 500');
  });

  it('rechaza identificadores raros antes de armar la dirección (no se cuela nada en la ruta)', async () => {
    const f = fetchSimulado([TOKEN]);
    const p = crearProveedorPaypal(entorno(), f.fn)!;
    await expect(p.obtenerSuscripcion('../../v1/otra-cosa')).rejects.toThrow('inválido');
    await expect(p.cancelarSuscripcion('I-1/cancel?x=', 'm')).rejects.toThrow('inválido');
  });

  it('cancelar: envía el motivo recortado; si ya estaba cancelada (422) se da por hecho; otro error lanza', async () => {
    const f = fetchSimulado([TOKEN, { estado: 204 }, { estado: 422 }, { estado: 500 }]);
    const p = crearProveedorPaypal(entorno(), f.fn)!;
    await p.cancelarSuscripcion('I-1', 'm'.repeat(300));
    expect(JSON.parse(f.llamadas[1]?.cuerpo ?? '{}').reason).toHaveLength(128);
    await p.cancelarSuscripcion('I-1', 'otra vez');
    await expect(p.cancelarSuscripcion('I-1', 'x')).rejects.toThrow('500');
  });

  it('lista los pagos de una ventana con monto, moneda y estado', async () => {
    const f = fetchSimulado([TOKEN, { estado: 200, cuerpo: { transactions: [{ id: 'TX-1', status: 'COMPLETED', time: '2026-11-01T10:00:00Z', amount_with_breakdown: { gross_amount: { currency_code: 'USD', value: '30.00' } } }] } }]);
    const t = await crearProveedorPaypal(entorno(), f.fn)!.listarTransacciones('I-1', new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'));
    expect(t).toEqual([{ id: 'TX-1', fecha: new Date('2026-11-01T10:00:00Z'), monto: 30, moneda: 'USD', estado: 'COMPLETED' }]);
    expect(f.llamadas[1]?.url).toContain('start_time=2026-10-01T00%3A00%3A00.000Z');
  });

  it('verifica la firma del aviso con PayPal y solo acepta SUCCESS', async () => {
    const entrada = { headers: { 'paypal-transmission-id': 'a', 'paypal-transmission-sig': 'b', 'paypal-transmission-time': 'c', 'paypal-cert-url': 'd', 'paypal-auth-algo': 'e' }, cuerpoCrudo: '{"id":"WH-9"}' };
    const buena = fetchSimulado([TOKEN, { estado: 200, cuerpo: { verification_status: 'SUCCESS' } }]);
    expect(await crearProveedorPaypal(entorno(), buena.fn)!.verificarWebhook(entrada)).toBe(true);
    expect(JSON.parse(buena.llamadas[1]?.cuerpo ?? '{}')).toMatchObject({ webhook_id: 'WH-1', transmission_id: 'a', webhook_event: { id: 'WH-9' } });
    const mala = fetchSimulado([TOKEN, { estado: 200, cuerpo: { verification_status: 'FAILURE' } }]);
    expect(await crearProveedorPaypal(entorno(), mala.fn)!.verificarWebhook(entrada)).toBe(false);
    const caida = fetchSimulado([TOKEN, { estado: 500 }]);
    expect(await crearProveedorPaypal(entorno(), caida.fn)!.verificarWebhook(entrada)).toBe(false);
  });

  it('sin identificador de aviso nunca verifica (falla cerrada)', async () => {
    const f = fetchSimulado([TOKEN]);
    const p = crearProveedorPaypal(entorno({ PAYPAL_WEBHOOK_ID: '' }), f.fn)!;
    expect(await p.verificarWebhook({ headers: {}, cuerpoCrudo: '{}' })).toBe(false);
    expect(f.llamadas).toHaveLength(0);
  });

  it('traduce la suscripción: prueba, cobro fallido y saldo pendiente', () => {
    const s = mapearSuscripcion({
      id: 'I-1',
      status: 'ACTIVE',
      plan_id: 'P-1',
      custom_id: 'abc',
      subscriber: { email_address: 'a@b.test' },
      billing_info: {
        next_billing_time: '2026-12-01T00:00:00Z',
        failed_payments_count: 2,
        outstanding_balance: { value: '60.00' },
        cycle_executions: [{ tenure_type: 'TRIAL', cycles_remaining: 0, cycles_completed: 1 }, { tenure_type: 'REGULAR', cycles_remaining: 0, cycles_completed: 0 }],
      },
    });
    expect(s).toMatchObject({ estado: 'ACTIVE', customId: 'abc', correoSuscriptor: 'a@b.test', pagosFallidos: 2, saldoPendiente: 60, enPrueba: false });
    expect(mapearSuscripcion({ id: 'I', status: 'ACTIVE', plan_id: 'P', billing_info: { cycle_executions: [{ tenure_type: 'TRIAL', cycles_remaining: 1 }] } }).enPrueba).toBe(true);
    expect(mapearSuscripcion({ id: 'I', status: 'ACTIVE', plan_id: 'P' })).toMatchObject({ enPrueba: false, pagosFallidos: 0, saldoPendiente: 0, proximoCobro: null, customId: null });
  });
});

describe('nombre del taller en la dirección', () => {
  it.each(['lopez', 'taller-lopez', 'a1b', 'mi-taller-2'])('acepta %s', (s) => expect(motivoSlugInvalido(s)).toBeNull());
  it.each(['ab', 'x'.repeat(31), 'Taller', 'con espacio', 'ñandú', 'doble--guion', '-inicio', 'fin-', '12345', 'punto.punto'])('rechaza %s', (s) => expect(motivoSlugInvalido(s)).not.toBeNull());
  it('exigirSlugValido limpia espacios y mayúsculas del borde antes de validar', () => expect(exigirSlugValido('  Lopez ')).toBe('lopez'));
  it('el nombre de la base usa guion bajo y respeta el largo máximo', () => {
    expect(nombreBdDeSlug('veritech_', 'taller-lopez')).toBe('veritech_taller_lopez');
    expect(() => nombreBdDeSlug('veritech_', 'a'.repeat(60))).toThrow('demasiado largo');
  });
});

describe('fechas de los correos', () => {
  it('se escriben DD/MM/YYYY en la zona del taller (a las 23:00 de Guatemala ya es el día siguiente en UTC)', () => {
    expect(fechaLegible(new Date('2026-11-12T05:00:00Z'))).toBe('11/11/2026');
    expect(fechaLegible(new Date('2026-11-12T07:00:00Z'))).toBe('12/11/2026');
  });
});
