import request from 'supertest';
import { procesarAviso, procesarAvisosPendientes, recibirAviso } from '../../src/cobro/aviso';
import { ejecutar, filas, una } from '../../src/db/consulta';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});
afterEach(() => jest.restoreAllMocks());

function aviso(tipo: string, recurso: Record<string, unknown>, id = `WH-${Math.random().toString(36).slice(2)}`) {
  const cuerpo = JSON.stringify({ id, event_type: tipo, resource: recurso });
  return { id, cuerpo, entrada: { headers: { 'paypal-transmission-id': 'x' }, cuerpoCrudo: cuerpo } };
}

async function empresaConSuscripcion(estado = 'activa') {
  const id = await e.empresa({ estado });
  const sub = `I-A${id}`;
  await ejecutar(e.pool, "UPDATE empresas SET paypal_suscripcion_id = ?, contacto_correo = 'dueno@taller.test' WHERE id = ?", [sub, id]);
  e.paypal.suscripcion(sub, { enPrueba: false });
  return { id, sub };
}

describe('aviso (webhook) de PayPal', () => {
  it('sin identificador de aviso configurado se RECHAZA (nunca falla abierta)', async () => {
    const sinId = { ...e.ctx, entorno: { ...e.ctx.entorno, PAYPAL_WEBHOOK_ID: undefined } };
    const a = aviso('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-1' });
    await expect(recibirAviso(sinId, a.entrada)).rejects.toMatchObject({ estado: 503 });
    expect(await filas(e.pool, 'SELECT * FROM suscripcion_eventos')).toHaveLength(0);
  });

  it('con la firma mala responde 400 y no guarda nada', async () => {
    e.paypal.firmaValida = false;
    const a = aviso('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-1' });
    const r = await request(e.app).post('/api/webhooks/paypal').set('Content-Type', 'application/json').send(a.cuerpo);
    expect(r.status).toBe(400);
    expect(await filas(e.pool, 'SELECT * FROM suscripcion_eventos')).toHaveLength(0);
  });

  it('verifica la firma sobre el cuerpo EXACTO que llegó (bytes crudos), no sobre uno reconstruido', async () => {
    const espiado = jest.spyOn(e.paypal, 'verificarWebhook');
    const cuerpo = '{ "id":"WH-CRUDO",   "event_type":"X.Y",\n "resource":{} }'; // espacios raros a propósito
    await request(e.app).post('/api/webhooks/paypal').set('Content-Type', 'application/json').send(cuerpo).expect(200);
    expect(espiado.mock.calls[0]?.[0].cuerpoCrudo).toBe(cuerpo);
  });

  it('guarda el aviso, ignora el que ya llegó antes y responde 200 a PayPal', async () => {
    const a = aviso('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-NADIE' }, 'WH-REPETIDO');
    const r1 = await request(e.app).post('/api/webhooks/paypal').set('Content-Type', 'application/json').send(a.cuerpo);
    const r2 = await request(e.app).post('/api/webhooks/paypal').set('Content-Type', 'application/json').send(a.cuerpo);
    expect(r1.body.data.resultado).toBe('recibido');
    expect(r2.body.data.resultado).toBe('duplicado');
    expect(await filas(e.pool, "SELECT id FROM suscripcion_eventos WHERE evento_paypal_id = 'WH-REPETIDO'")).toHaveLength(1);
  });

  it.each([
    ['un JSON roto', 'esto no es json'],
    ['un aviso sin identificador', JSON.stringify({ event_type: 'X' })],
    ['un aviso sin tipo', JSON.stringify({ id: 'WH-1' })],
  ])('rechaza %s con 400', async (_nombre, cuerpo) => {
    const r = await request(e.app).post('/api/webhooks/paypal').set('Content-Type', 'application/json').send(cuerpo);
    expect(r.status).toBe(400);
  });

  it('un aviso de la suscripción se relaciona con su empresa y la pone al día CONSULTANDO a PayPal', async () => {
    const { id, sub } = await empresaConSuscripcion('activa');
    const a = aviso('BILLING.SUBSCRIPTION.SUSPENDED', { id: sub });
    const r = await recibirAviso(e.ctx, a.entrada);
    expect(r.resultado).toBe('recibido');
    expect((await una<{ empresa_id: number }>(e.pool, 'SELECT empresa_id FROM suscripcion_eventos WHERE id = ?', [r.eventoId]))?.empresa_id).toBe(id);

    e.paypal.estado(sub, 'SUSPENDED'); // PayPal confirma lo que el aviso dice
    await procesarAviso(e.ctx, r.eventoId!);
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [id]))?.estado).toBe('suspendida');
    const ev = await una(e.pool, "SELECT origen, estado_antes, estado_despues FROM suscripcion_eventos WHERE empresa_id = ? AND estado_despues = 'suspendida'", [id]);
    expect(ev).toMatchObject({ origen: 'aviso', estado_antes: 'activa', estado_despues: 'suspendida' });
    expect((await una<{ procesado_en: Date | null }>(e.pool, 'SELECT procesado_en FROM suscripcion_eventos WHERE id = ?', [r.eventoId]))?.procesado_en).not.toBeNull();
  });

  it('NO confía en lo que dice el aviso: si PayPal dice que sigue activa, no se suspende', async () => {
    const { id, sub } = await empresaConSuscripcion('activa');
    const r = await recibirAviso(e.ctx, aviso('BILLING.SUBSCRIPTION.CANCELLED', { id: sub }).entrada);
    await procesarAviso(e.ctx, r.eventoId!); // PayPal sigue diciendo ACTIVE
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [id]))?.estado).toBe('activa');
  });

  it('los avisos de cobro (PAYMENT.SALE.*) se ligan por billing_agreement_id', async () => {
    const { id, sub } = await empresaConSuscripcion('prueba');
    const r = await recibirAviso(e.ctx, aviso('PAYMENT.SALE.COMPLETED', { id: 'SALE-1', billing_agreement_id: sub }).entrada);
    expect((await una<{ empresa_id: number }>(e.pool, 'SELECT empresa_id FROM suscripcion_eventos WHERE id = ?', [r.eventoId]))?.empresa_id).toBe(id);
    e.paypal.pago(sub, { id: 'SALE-1', fecha: new Date(), monto: 30, moneda: 'USD', estado: 'COMPLETED' });
    await procesarAviso(e.ctx, r.eventoId!);
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [id]))?.estado).toBe('activa');
    expect(await filas(e.pool, 'SELECT * FROM pagos')).toHaveLength(1);
  });

  it('un aviso que no se pudo procesar queda pendiente y el barrido lo reintenta después', async () => {
    const { id, sub } = await empresaConSuscripcion('activa');
    const r = await recibirAviso(e.ctx, aviso('BILLING.SUBSCRIPTION.SUSPENDED', { id: sub }).entrada);
    e.paypal.estado(sub, 'SUSPENDED');
    e.paypal.caido = true;
    await expect(procesarAviso(e.ctx, r.eventoId!)).rejects.toThrow('PayPal no responde');
    expect((await una<{ procesado_en: Date | null }>(e.pool, 'SELECT procesado_en FROM suscripcion_eventos WHERE id = ?', [r.eventoId]))?.procesado_en).toBeNull();

    // Todavía es muy reciente: el barrido no lo toca. Pasado un minuto, sí.
    e.paypal.caido = false;
    expect(await procesarAvisosPendientes(e.ctx)).toBe(0);
    e.reloj.fijo = new Date(Date.now() + 3 * 60 * 1000);
    expect(await procesarAvisosPendientes(e.ctx)).toBe(1);
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [id]))?.estado).toBe('suspendida');
  });

  it('un aviso de una suscripción desconocida se guarda sin empresa y no rompe nada', async () => {
    const r = await recibirAviso(e.ctx, aviso('BILLING.SUBSCRIPTION.ACTIVATED', { id: 'I-DESCONOCIDA' }).entrada);
    await procesarAviso(e.ctx, r.eventoId!);
    expect(await una<{ empresa_id: number | null }>(e.pool, 'SELECT empresa_id FROM suscripcion_eventos WHERE id = ?', [r.eventoId])).toMatchObject({ empresa_id: null });
  });
});
