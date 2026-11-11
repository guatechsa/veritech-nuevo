import { crearEntornoDePrueba, EntornoDePrueba } from './ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => {
  await e.cerrar();
});
beforeEach(async () => {
  await e.limpiar();
});

/**
 * Los tres roles se hacen cumplir DE VERDAD (en el sistema anterior un VIEWER podía loguearse pero recibía 403 en todo, y
 * en otros productos el rol era solo decorativo):
 *   VIEWER lee; ADMIN lee y escribe empresas; SUPER_ADMIN además administra usuarios, planes y "Entrar".
 */
describe('permisos por rol', () => {
  it('sin sesión, todo lo protegido responde 401', async () => {
    const request = (await import('supertest')).default;
    for (const ruta of ['/stats', '/empresas', '/planes', '/modulos', '/usuarios', '/auditoria']) {
      expect([ruta, (await request(e.app).get(`/api/plataforma${ruta}`)).status]).toEqual([ruta, 401]);
    }
  });

  it('VIEWER puede leer todo pero no cambiar nada', async () => {
    const v = await e.usuario('VIEWER');
    const empresaId = await e.empresa();
    const api = e.autorizado(v.token);
    for (const ruta of ['/stats', '/empresas', `/empresas/${empresaId}`, '/planes', '/modulos', '/usuarios', '/auditoria']) {
      expect([ruta, (await api.get(`/api/plataforma${ruta}`)).status]).toEqual([ruta, 200]);
    }
    expect((await api.patch(`/api/plataforma/empresas/${empresaId}`).send({ nombre: 'X' })).status).toBe(403);
    expect((await api.post(`/api/plataforma/empresas/${empresaId}/estado`).send({ estado: 'suspendida', motivo: 'PRUEBA' })).status).toBe(403);
    expect((await api.post('/api/plataforma/usuarios').send({ nombre: 'N', correo: 'n@x.test', rol: 'VIEWER' })).status).toBe(403);
    expect((await api.patch('/api/plataforma/planes/1').send({ precio_mensual: 1 })).status).toBe(403);
  });

  it('ADMIN edita empresas pero no administra usuarios ni planes', async () => {
    const a = await e.usuario('ADMIN');
    const empresaId = await e.empresa({ nombre: 'TALLER VIEJO' });
    const api = e.autorizado(a.token);
    expect((await api.patch(`/api/plataforma/empresas/${empresaId}`).send({ nombre: 'Taller Nuevo' })).status).toBe(200);
    expect((await api.post(`/api/plataforma/empresas/${empresaId}/estado`).send({ estado: 'suspendida', motivo: 'PRUEBA' })).status).toBe(200);
    expect((await api.post('/api/plataforma/usuarios').send({ nombre: 'N', correo: 'n@x.test', rol: 'VIEWER' })).status).toBe(403);
    expect((await api.patch('/api/plataforma/usuarios/1').send({ activo: false })).status).toBe(403);
    expect((await api.post('/api/plataforma/usuarios/1/contrasena-temporal')).status).toBe(403);
    expect((await api.patch('/api/plataforma/planes/1').send({ precio_mensual: 1 })).status).toBe(403);
  });

  it('SUPER_ADMIN puede todo', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const api = e.autorizado(s.token);
    expect((await api.post('/api/plataforma/usuarios').send({ nombre: 'Nuevo', correo: 'nuevo@x.test', rol: 'VIEWER' })).status).toBe(201);
    const planes = (await api.get('/api/plataforma/planes')).body.data as Array<{ id: number }>;
    expect((await api.patch(`/api/plataforma/planes/${planes[0]?.id}`).send({ precio_mensual: 31 })).status).toBe(200);
  });
});
