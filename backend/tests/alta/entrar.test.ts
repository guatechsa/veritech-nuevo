import request from 'supertest';
import { ejecutar, filas } from '../../src/db/consulta';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
});

async function acceso(correo: string, empresa: { nombre: string; slug: string; estado?: string }, activo = 1) {
  const id = await e.empresa({ nombre: empresa.nombre, slug: empresa.slug, estado: empresa.estado ?? 'activa' });
  await ejecutar(e.pool, 'UPDATE empresas SET subdominio = ? WHERE id = ?', [`${empresa.slug}.taller.test`, id]);
  await ejecutar(e.pool, 'INSERT INTO directorio_acceso (correo, empresa_id, usuario_id, activo) VALUES (?, ?, 1, ?)', [correo, id, activo]);
  return id;
}

const solicitar = (correo: string) => request(e.app).post('/api/entrar/solicitar').send({ correo });
const correos = () => filas<{ destinatarios: string; asunto: string; cuerpo: string }>(e.pool, "SELECT destinatarios, asunto, cuerpo FROM correos_salida WHERE tipo = 'accesos'");

describe('"Entrar": un correo, varios talleres', () => {
  it('responde LO MISMO exista o no el correo (no revela quién está registrado)', async () => {
    await acceso('juan@correo.test', { nombre: 'TALLER UNO', slug: 'uno' });
    const conocido = await solicitar('juan@correo.test');
    const desconocido = await solicitar('nadie@correo.test');
    expect(conocido.status).toBe(200);
    expect(desconocido.status).toBe(200);
    expect(conocido.body).toEqual(desconocido.body);
    expect(await correos()).toHaveLength(1); // solo el conocido recibe algo
  });

  it('manda UN correo con todos los talleres de esa persona', async () => {
    await acceso('juan@correo.test', { nombre: 'TALLER UNO', slug: 'uno' });
    await acceso('juan@correo.test', { nombre: 'TALLER DOS', slug: 'dos', estado: 'prueba' });
    await acceso('otro@correo.test', { nombre: 'TALLER AJENO', slug: 'ajeno' });
    await solicitar('juan@correo.test');
    const c = await correos();
    expect(c).toHaveLength(1);
    expect(c[0]?.destinatarios).toBe('juan@correo.test');
    expect(c[0]?.cuerpo).toContain('https://uno.taller.test');
    expect(c[0]?.cuerpo).toContain('https://dos.taller.test');
    expect(c[0]?.cuerpo).not.toContain('ajeno');
    expect(c[0]?.cuerpo).toContain('Si usted no lo solicitó');
  });

  it('no incluye talleres cerrados, pendientes ni accesos desactivados', async () => {
    await acceso('juan@correo.test', { nombre: 'TALLER BUENO', slug: 'bueno' });
    await acceso('juan@correo.test', { nombre: 'TALLER CERRADO', slug: 'cerrado', estado: 'cerrada' });
    await acceso('juan@correo.test', { nombre: 'TALLER PENDIENTE', slug: 'pendiente', estado: 'pendiente' });
    await acceso('juan@correo.test', { nombre: 'TALLER BAJA', slug: 'baja' }, 0);
    await solicitar('juan@correo.test');
    const cuerpo = (await correos())[0]?.cuerpo ?? '';
    expect(cuerpo).toContain('bueno.taller.test');
    for (const no of ['cerrado', 'pendiente', 'baja']) expect(cuerpo).not.toContain(`${no}.taller.test`);
  });

  it('si todos sus talleres están cerrados, no manda nada', async () => {
    await acceso('juan@correo.test', { nombre: 'TALLER CERRADO', slug: 'cerrado', estado: 'cerrada' });
    await solicitar('juan@correo.test');
    expect(await correos()).toHaveLength(0);
  });

  it('pedirlo muchas veces seguidas no llena la bandeja (un correo por hora)', async () => {
    await acceso('juan@correo.test', { nombre: 'TALLER UNO', slug: 'uno' });
    for (let i = 0; i < 5; i++) await solicitar('Juan@Correo.test');
    expect(await correos()).toHaveLength(1);
    e.reloj.fijo = new Date(Date.now() + 2 * 3600 * 1000);
    await solicitar('juan@correo.test');
    expect(await correos()).toHaveLength(2);
  });

  it('el nombre del taller va escapado en el correo', async () => {
    await acceso('juan@correo.test', { nombre: '<script>alert(1)</script>', slug: 'xss' });
    await solicitar('juan@correo.test');
    const cuerpo = (await correos())[0]?.cuerpo ?? '';
    expect(cuerpo).not.toContain('<script>');
    expect(cuerpo).toContain('&lt;script&gt;');
  });

  it('rechaza un correo con formato inválido', async () => {
    expect((await solicitar('no-es-correo')).status).toBe(400);
  });

  it('tiene límite de peticiones', async () => {
    const limitado = await crearEntornoDePrueba({ limites: { ingreso: 100, recuperacion: 100, registro: 2 } });
    try {
      const estados: number[] = [];
      for (let i = 0; i < 4; i++) estados.push((await request(limitado.app).post('/api/entrar/solicitar').send({ correo: 'a@b.test' })).status);
      expect(estados).toEqual([200, 200, 429, 429]);
    } finally {
      await limitado.cerrar();
    }
  });
});
