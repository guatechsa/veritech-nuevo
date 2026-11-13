import request from 'supertest';
import { crearTallerEspecial } from '../../src/alta/taller-especial';
import { barrerCicloDeVida } from '../../src/cobro/ciclo';
import { filas, una } from '../../src/db/consulta';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
  e.reloj.fijo = null;
});

describe('talleres de cortesía y de demostración (sin PayPal)', () => {
  it('se crea completo, el administrador entra con su contraseña temporal y la empresa queda activa y sin cobro', async () => {
    const r = await crearTallerEspecial(e.ctx, { slug: 'enovax', nombre: 'Enova Prueba', adminNombre: 'Admin Enova', adminCorreo: 'admin@enovax.test', planCodigo: 'profesional', tipo: 'cortesia' });
    const emp = await una<{ estado: string; cobro_por_contrato: number; es_demo: number; paypal_suscripcion_id: string | null; prueba_hasta: Date | null }>(e.pool, 'SELECT estado, cobro_por_contrato, es_demo, paypal_suscripcion_id, prueba_hasta FROM empresas WHERE id = ?', [r.empresaId]);
    expect(emp).toMatchObject({ estado: 'activa', cobro_por_contrato: 1, es_demo: 0, paypal_suscripcion_id: null, prueba_hasta: null });
    const entrada = await request(e.app).post('/api/taller/auth/ingresar').set('X-Taller', 'enovax').send({ correo: 'admin@enovax.test', contrasena: r.contrasenaTemporal });
    expect(entrada.status).toBe(200);
    expect(r.contrasenaTemporal.length).toBeGreaterThanOrEqual(12);
    // Los módulos del plan quedaron asignados.
    const modulos = await filas<{ modulo_codigo: string }>(e.pool, 'SELECT modulo_codigo FROM empresa_modulos WHERE empresa_id = ?', [r.empresaId]);
    expect(modulos.length).toBeGreaterThan(0);
  });

  it('el de demostración queda marcado como demo', async () => {
    const r = await crearTallerEspecial(e.ctx, { slug: 'demox', nombre: 'Taller Demo', adminNombre: 'Admin Demo', adminCorreo: 'admin@demox.test', planCodigo: 'profesional', tipo: 'demo' });
    expect(await una(e.pool, 'SELECT es_demo, cobro_por_contrato FROM empresas WHERE id = ?', [r.empresaId])).toMatchObject({ es_demo: 1, cobro_por_contrato: 1 });
  });

  it('un año después el ciclo de vida NO lo suspende, ni lo cierra, ni le manda avisos de pago', async () => {
    const r = await crearTallerEspecial(e.ctx, { slug: 'enovay', nombre: 'Enova Larga', adminNombre: 'Admin', adminCorreo: 'admin@enovay.test', planCodigo: 'profesional', tipo: 'cortesia' });
    const antes = await filas(e.pool, 'SELECT id FROM correos_salida');
    e.reloj.fijo = new Date(Date.now() + 400 * 86400000);
    const resumen = await barrerCicloDeVida(e.ctx);
    expect(resumen.errores).toEqual([]);
    expect(await una(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [r.empresaId])).toMatchObject({ estado: 'activa' });
    const despues = await filas<{ destinatarios: string }>(e.pool, 'SELECT destinatarios FROM correos_salida');
    expect(despues.filter((c) => c.destinatarios.includes('admin@enovay.test'))).toEqual([]);
    expect(despues.length).toBe(antes.length);
  });

  it('no deja crear dos con el mismo subdominio ni con un plan que no existe', async () => {
    await crearTallerEspecial(e.ctx, { slug: 'repetido', nombre: 'Uno', adminNombre: 'Admin', adminCorreo: 'a@repetido.test', planCodigo: 'profesional', tipo: 'cortesia' });
    await expect(crearTallerEspecial(e.ctx, { slug: 'repetido', nombre: 'Dos', adminNombre: 'Admin', adminCorreo: 'b@repetido.test', planCodigo: 'profesional', tipo: 'cortesia' })).rejects.toThrow('Ya existe');
    await expect(crearTallerEspecial(e.ctx, { slug: 'otro1', nombre: 'Tres', adminNombre: 'Admin', adminCorreo: 'c@otro1.test', planCodigo: 'inexistente', tipo: 'demo' })).rejects.toThrow('no existe');
  });
});
