import request from 'supertest';
import { huellaDe } from '../../src/utils/tokens';
import { ejecutar, una } from '../../src/db/consulta';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { altaAprobada, datosAlta } from './ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});

describe('registro público: paso 1 (datos y pase)', () => {
  it('lista los planes sin mostrar identificadores internos de PayPal', async () => {
    const r = await request(e.app).get('/api/registro/planes');
    expect(r.status).toBe(200);
    expect(r.body.data.version_legal).toBe('1.0');
    expect(r.body.data.planes.map((p: { codigo: string }) => p.codigo)).toEqual(['basico', 'profesional', 'empresarial']);
    expect(JSON.stringify(r.body)).not.toContain('P-BASICO');
    expect(r.body.data.planes[0].cobro_disponible).toBe(true);
  });

  it('entrega un pase, guarda solo su huella y nunca la contraseña en claro', async () => {
    const datos = datosAlta({ slug: 'lopez', nombre_taller: 'Taller López', admin_nombre: 'José Pérez' });
    const r = await request(e.app).post('/api/registro/iniciar').send(datos);
    expect(r.status).toBe(201);
    const { pase, paypal_plan_id, custom_id } = r.body.data as { pase: string; paypal_plan_id: string; custom_id: string };
    expect(pase).toMatch(/^[a-f0-9]{64}$/);
    expect(paypal_plan_id).toBe('P-BASICO');
    const fila = await una<{ pase_hash: string; contrasena_hash: string; nombre_taller: string; admin_nombre: string; admin_correo: string }>(e.pool, 'SELECT * FROM altas_pendientes');
    expect(fila?.pase_hash).toBe(huellaDe(pase));
    expect(fila?.pase_hash).not.toBe(pase);
    expect(custom_id).toBe(huellaDe(pase).slice(0, 32));
    expect(fila?.contrasena_hash).not.toContain(datos.contrasena);
    expect(fila?.nombre_taller).toBe('TALLER LOPEZ'); // §5: mayúsculas y sin tildes
    expect(fila?.admin_nombre).toBe('JOSE PEREZ');
    expect(fila?.admin_correo).toBe(datos.admin_correo); // el correo se guarda tal cual
  });

  it.each([
    ['sin aceptar los términos', { acepta_terminos: false }],
    ['con una versión de términos vieja', { version_legal: '0.9' }],
    ['con una contraseña débil', { contrasena: 'corta' }],
    ['con un correo inválido', { admin_correo: 'no-es-correo' }],
    ['con un nombre en la dirección demasiado corto', { slug: 'ab' }],
    ['con un nombre en la dirección con mayúsculas y tildes', { slug: 'Taller Ñandú' }],
    ['con un nombre en la dirección solo de números', { slug: '12345' }],
    ['con un guion al inicio', { slug: '-taller' }],
    ['con un plan que no existe', { plan_codigo: 'inventado' }],
  ])('rechaza el registro %s', async (_motivo, cambios) => {
    const r = await request(e.app).post('/api/registro/iniciar').send(datosAlta(cambios as never));
    expect(r.status).toBe(400);
    expect((await una<{ n: number }>(e.pool, 'SELECT COUNT(*) AS n FROM altas_pendientes'))?.n).toBe(0);
  });

  it('rechaza un nombre reservado y uno ya usado por un taller, con el MISMO mensaje', async () => {
    await e.empresa({ slug: 'garcia' });
    const reservado = await request(e.app).post('/api/registro/iniciar').send(datosAlta({ slug: 'admin' }));
    const ocupado = await request(e.app).post('/api/registro/iniciar').send(datosAlta({ slug: 'garcia' }));
    expect(reservado.status).toBe(409);
    expect(ocupado.status).toBe(409);
    expect(reservado.body.error).toBe(ocupado.body.error);
  });

  it('dos registros a la vez con el mismo nombre: solo uno se queda con él', async () => {
    const resultados = await Promise.all([1, 2, 3, 4].map(() => request(e.app).post('/api/registro/iniciar').send(datosAlta({ slug: 'carrera' }))));
    expect(resultados.filter((r) => r.status === 201)).toHaveLength(1);
    expect(resultados.filter((r) => r.status === 409)).toHaveLength(3);
  });

  it('el nombre queda apartado mientras el registro está vigente y se libera cuando vence', async () => {
    await request(e.app).post('/api/registro/iniciar').send(datosAlta({ slug: 'apartado' })).expect(201);
    expect((await request(e.app).post('/api/registro/disponibilidad').send({ slug: 'apartado' })).body.data.disponible).toBe(false);
    e.reloj.fijo = new Date(Date.now() + 49 * 3600 * 1000);
    expect((await request(e.app).post('/api/registro/disponibilidad').send({ slug: 'apartado' })).body.data.disponible).toBe(true);
    await request(e.app).post('/api/registro/iniciar').send(datosAlta({ slug: 'apartado' })).expect(201);
  });

  it('la disponibilidad no distingue "reservado" de "ocupado" y rechaza formatos inválidos', async () => {
    await e.empresa({ slug: 'ocupado' });
    const d = async (slug: string) => (await request(e.app).post('/api/registro/disponibilidad').send({ slug })).body.data.disponible;
    expect(await d('libre')).toBe(true);
    expect(await d('ocupado')).toBe(false);
    expect(await d('api')).toBe(false);
    expect(await d('Mal Nombre')).toBe(false);
  });

  it('un taller cerrado libera su nombre', async () => {
    await e.empresa({ slug: 'cerrado1', estado: 'cerrada' });
    expect((await request(e.app).post('/api/registro/disponibilidad').send({ slug: 'cerrado1' })).body.data.disponible).toBe(true);
  });

  it('sin PayPal configurado en el plan no se puede iniciar el registro', async () => {
    await ejecutar(e.pool, "UPDATE planes SET paypal_plan_prueba = NULL WHERE codigo = 'BASICO'");
    const r = await request(e.app).post('/api/registro/iniciar').send(datosAlta());
    expect(r.status).toBe(503);
  });
});

describe('registro público: paso 2 (PayPal aprobado)', () => {
  async function emitir(slug: string) {
    const r = await request(e.app).post('/api/registro/iniciar').send(datosAlta({ slug }));
    return r.body.data as { pase: string; paypal_plan_id: string; custom_id: string };
  }

  it('confirma contra PayPal, deja el alta aprobada y repetir el paso no cambia nada', async () => {
    const p = await emitir('confirma1');
    e.paypal.suscripcion('I-OK', { planId: p.paypal_plan_id, customId: p.custom_id });
    const r1 = await request(e.app).post('/api/registro/confirmar').send({ pase: p.pase, suscripcion_id: 'I-OK' });
    expect(r1.status).toBe(200);
    expect(r1.body.data.estado).toBe('creando');
    const r2 = await request(e.app).post('/api/registro/confirmar').send({ pase: p.pase, suscripcion_id: 'I-OK' });
    expect(r2.body.data.estado).toBe('creando');
    // Repetir el paso 2 vuelve a pedir la creación (sirve si el primer intento se cayó); el bloqueo por alta evita que corran dos a la vez.
    expect(e.altasLanzadas).toHaveLength(2);
    const fila = await una<{ estado: string; paypal_suscripcion_id: string }>(e.pool, "SELECT estado, paypal_suscripcion_id FROM altas_pendientes WHERE slug = 'confirma1'");
    expect(fila).toMatchObject({ estado: 'aprobada', paypal_suscripcion_id: 'I-OK' });
  });

  it.each([
    ['PayPal no conoce la suscripción', () => undefined, 400],
    ['la suscripción es de otro plan', (p: { custom_id: string }) => ({ planId: 'P-PROFESIONAL', customId: p.custom_id }), 400],
    ['la suscripción pertenece a otro registro', (p: { paypal_plan_id: string }) => ({ planId: p.paypal_plan_id, customId: 'otro-registro-distinto' }), 400],
    ['la suscripción sigue sin aprobar', (p: { paypal_plan_id: string; custom_id: string }) => ({ planId: p.paypal_plan_id, customId: p.custom_id, estado: 'APPROVAL_PENDING' as const }), 400],
    ['la suscripción ya está cancelada', (p: { paypal_plan_id: string; custom_id: string }) => ({ planId: p.paypal_plan_id, customId: p.custom_id, estado: 'CANCELLED' as const }), 400],
  ])('NO aprueba el alta si %s', async (_motivo, fabricar, esperado) => {
    const p = await emitir(`rechaza${Math.floor(Math.random() * 1e6)}`);
    const cambios = (fabricar as (p: unknown) => Record<string, unknown> | undefined)(p);
    if (cambios) e.paypal.suscripcion('I-MALA', cambios);
    const r = await request(e.app).post('/api/registro/confirmar').send({ pase: p.pase, suscripcion_id: 'I-MALA' });
    expect(r.status).toBe(esperado);
    expect((await una<{ n: number }>(e.pool, "SELECT COUNT(*) AS n FROM altas_pendientes WHERE estado = 'aprobada'"))?.n).toBe(0);
  });

  it('una suscripción de PayPal no se puede usar en dos registros', async () => {
    const a = await emitir('doble1');
    const b = await emitir('doble2');
    e.paypal.suscripcion('I-UNICA', { planId: a.paypal_plan_id, customId: a.custom_id });
    await request(e.app).post('/api/registro/confirmar').send({ pase: a.pase, suscripcion_id: 'I-UNICA' }).expect(200);
    e.paypal.suscripcion('I-UNICA', { customId: b.custom_id }); // mismo id, ahora "del otro registro"
    const r = await request(e.app).post('/api/registro/confirmar').send({ pase: b.pase, suscripcion_id: 'I-UNICA' });
    expect(r.status).toBe(409);
  });

  it('un pase vencido no se confirma', async () => {
    const p = await emitir('vencido1');
    e.paypal.suscripcion('I-V', { planId: p.paypal_plan_id, customId: p.custom_id });
    e.reloj.fijo = new Date(Date.now() + 49 * 3600 * 1000);
    const r = await request(e.app).post('/api/registro/confirmar').send({ pase: p.pase, suscripcion_id: 'I-V' });
    expect(r.status).toBe(410);
  });

  it('un pase inventado se rechaza sin revelar nada', async () => {
    const r = await request(e.app).post('/api/registro/confirmar').send({ pase: 'a'.repeat(64), suscripcion_id: 'I-X' });
    expect(r.status).toBe(404);
  });

  it('si PayPal no responde no se pierde el pago: error 502 y el alta sigue esperando', async () => {
    const p = await emitir('caido1');
    e.paypal.caido = true;
    const r = await request(e.app).post('/api/registro/confirmar').send({ pase: p.pase, suscripcion_id: 'I-CAIDO' });
    expect(r.status).toBe(502);
    expect((await una<{ estado: string }>(e.pool, "SELECT estado FROM altas_pendientes WHERE slug = 'caido1'"))?.estado).toBe('emitida');
  });

  it('el estado público sigue al alta: esperando pago → creando → lista', async () => {
    const p = await emitir('estado1');
    const estado = async () => (await request(e.app).get(`/api/registro/estado?pase=${p.pase}`)).body.data;
    expect((await estado()).estado).toBe('esperando_pago');
    e.paypal.suscripcion('I-E', { planId: p.paypal_plan_id, customId: p.custom_id });
    await request(e.app).post('/api/registro/confirmar').send({ pase: p.pase, suscripcion_id: 'I-E' });
    expect((await estado()).estado).toBe('creando');
    await ejecutar(e.pool, "UPDATE altas_pendientes SET estado = 'usada' WHERE slug = 'estado1'");
    expect(await estado()).toMatchObject({ estado: 'lista', subdominio: 'estado1.taller.test', url: 'https://estado1.taller.test' });
  });

  it('altaAprobada (ayuda de pruebas) deja el alta lista para crear', async () => {
    const a = await altaAprobada(e);
    expect(a.altaId).toBeGreaterThan(0);
  });
});
