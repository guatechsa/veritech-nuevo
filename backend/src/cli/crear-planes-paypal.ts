// Uso: node dist/cli/crear-planes-paypal.js
// Crea en PayPal (por defecto en el ambiente de PRUEBAS) un producto y un plan por cada nivel de la plataforma
// (30 días de prueba gratis y luego cobro mensual sin fin) y guarda el identificador de cada plan en `planes`.
// Los planes en vivo ya existen (C:\GUATECH\PAYPAL_PLANES.md): para el ambiente real se escriben a mano, por eso este
// guion se niega a correr en modo `live`.
import 'dotenv/config';
import { leerEntorno } from '../config/entorno';
import { crearPool } from '../db/conexion';
import { ejecutar, filas } from '../db/consulta';
import { POLITICA } from '../cobro/politica';

const BASE = 'https://api-m.sandbox.paypal.com';

async function principal(): Promise<void> {
  const entorno = leerEntorno();
  if (entorno.PAYPAL_MODO === 'live') throw new Error('Este guion solo crea planes de PRUEBAS. Los planes en vivo se registran a mano.');
  if (!entorno.PAYPAL_CLIENT_ID || !entorno.PAYPAL_SECRETO) throw new Error('Faltan PAYPAL_CLIENT_ID y PAYPAL_SECRETO (de la aplicación de PRUEBAS de PayPal).');

  const t = await fetch(`${BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${entorno.PAYPAL_CLIENT_ID}:${entorno.PAYPAL_SECRETO}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(15000),
  });
  if (!t.ok) throw new Error(`PayPal rechazó la autenticación (${t.status}). Revise que las credenciales sean de PRUEBAS.`);
  const { access_token: token } = (await t.json()) as { access_token: string };

  const llamar = async (ruta: string, cuerpo: unknown, idempotencia: string): Promise<{ id: string }> => {
    const r = await fetch(`${BASE}${ruta}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'PayPal-Request-Id': idempotencia },
      body: JSON.stringify(cuerpo),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) throw new Error(`PayPal respondió ${r.status} en ${ruta}: ${(await r.text()).slice(0, 300)}`);
    return (await r.json()) as { id: string };
  };

  const pool = crearPool({ host: entorno.BD_HOST, puerto: entorno.BD_PUERTO, usuario: entorno.BD_USUARIO, clave: entorno.BD_CLAVE }, entorno.BD_PLATAFORMA, 2);
  try {
    const planes = await filas<{ codigo: string; nombre: string; precio_mensual: number }>(pool, 'SELECT codigo, nombre, precio_mensual FROM planes WHERE activo = 1 ORDER BY precio_mensual');
    const producto = await llamar('/v1/catalogs/products', { name: 'VERI-TECH 4.000 (pruebas)', type: 'SERVICE', category: 'SOFTWARE' }, `vt4-producto-${Date.now()}`);
    for (const p of planes) {
      const plan = await llamar(
        '/v1/billing/plans',
        {
          product_id: producto.id,
          name: `VERI-TECH ${p.nombre} (pruebas)`,
          status: 'ACTIVE',
          billing_cycles: [
            { frequency: { interval_unit: 'DAY', interval_count: POLITICA.diasPrueba }, tenure_type: 'TRIAL', sequence: 1, total_cycles: 1, pricing_scheme: { fixed_price: { value: '0', currency_code: 'USD' } } },
            { frequency: { interval_unit: 'MONTH', interval_count: 1 }, tenure_type: 'REGULAR', sequence: 2, total_cycles: 0, pricing_scheme: { fixed_price: { value: Number(p.precio_mensual).toFixed(2), currency_code: 'USD' } } },
          ],
          payment_preferences: { auto_bill_outstanding: true, setup_fee_failure_action: 'CONTINUE', payment_failure_threshold: 3 },
        },
        `vt4-plan-${p.codigo}-${Date.now()}`
      );
      await ejecutar(pool, 'UPDATE planes SET paypal_plan_prueba = ? WHERE codigo = ?', [plan.id, p.codigo]);
      console.log(`Plan ${p.nombre}: ${plan.id}`);
    }
  } finally {
    await pool.end();
  }
}

principal().catch((error: unknown) => {
  console.error('ERROR:', error instanceof Error ? error.message : error);
  process.exit(1);
});
