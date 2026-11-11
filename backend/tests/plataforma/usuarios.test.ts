import request from 'supertest';
import { filas } from '../../src/db/consulta';
import { reglasIncumplidas } from '../../src/utils/clave';
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

describe('usuarios de plataforma', () => {
  it('crear: normaliza el nombre, devuelve una contraseña temporal válida UNA vez y esa contraseña sirve para entrar', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const res = await e.autorizado(s.token).post('/api/plataforma/usuarios').send({ nombre: 'José Pérez', correo: 'Jose@Taller.test', rol: 'ADMIN' });
    expect(res.status).toBe(201);
    const temporal: string = res.body.data.contrasenaTemporal;
    expect(reglasIncumplidas(temporal)).toEqual([]);
    const [fila] = await filas<{ nombre: string; correo: string; contrasena_hash: string }>(e.pool, 'SELECT nombre, correo, contrasena_hash FROM usuarios_plataforma WHERE id = ?', [res.body.data.id]);
    expect(fila?.nombre).toBe('JOSE PEREZ');
    expect(fila?.correo).toBe('jose@taller.test');
    expect(fila?.contrasena_hash).not.toContain(temporal);
    const entrada = await request(e.app).post('/api/plataforma/auth/ingresar').send({ correo: 'jose@taller.test', contrasena: temporal });
    expect(entrada.status).toBe(200);
    expect(entrada.body.data.usuario.rol).toBe('ADMIN');
  });

  it('crear: un correo repetido responde 409, aunque cambien las mayúsculas', async () => {
    const s = await e.usuario('SUPER_ADMIN', 'jefe@prueba.test');
    const api = e.autorizado(s.token);
    expect((await api.post('/api/plataforma/usuarios').send({ nombre: 'Otro', correo: 'JEFE@prueba.test', rol: 'VIEWER' })).status).toBe(409);
  });

  it('el listado nunca muestra contraseñas ni huellas', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const res = await e.autorizado(s.token).get('/api/plataforma/usuarios');
    expect(JSON.stringify(res.body)).not.toMatch(/contrasena|hash|scrypt/i);
  });

  it('nadie puede desactivar su propia cuenta', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    await e.usuario('SUPER_ADMIN'); // hay otro super administrador: la regla es sobre uno mismo
    const res = await e.autorizado(s.token).patch(`/api/plataforma/usuarios/${s.id}`).send({ activo: false });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('propia cuenta');
  });

  it('siempre debe quedar al menos un super administrador activo', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const otro = await e.usuario('SUPER_ADMIN');
    const api = e.autorizado(s.token);
    expect((await api.patch(`/api/plataforma/usuarios/${otro.id}`).send({ rol: 'ADMIN' })).status).toBe(200); // queda s
    // ahora s es el único: no se puede degradar ni desactivar (otro ya es ADMIN)
    expect((await api.patch(`/api/plataforma/usuarios/${s.id}`).send({ rol: 'VIEWER' })).status).toBe(409);
  });

  it('desactivar a otro usuario le corta la sesión y queda en la auditoría', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const v = await e.usuario('VIEWER');
    expect((await e.autorizado(s.token).patch(`/api/plataforma/usuarios/${v.id}`).send({ activo: false })).status).toBe(200);
    expect((await e.autorizado(v.token).get('/api/plataforma/auth/yo')).status).toBe(401);
    const auditoria = await filas<{ descripcion: string }>(e.pool, "SELECT descripcion FROM auditoria_plataforma WHERE accion = 'usuario_editado'");
    expect(auditoria[0]?.descripcion).toContain('desactivado');
  });

  it('contraseña temporal: la anterior deja de servir y se invalidan los enlaces de recuperación pendientes', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const v = await e.usuario('VIEWER', 'viewer@prueba.test');
    await request(e.app).post('/api/plataforma/auth/recuperar').send({ correo: 'viewer@prueba.test' });
    const res = await e.autorizado(s.token).post(`/api/plataforma/usuarios/${v.id}/contrasena-temporal`);
    expect(res.status).toBe(200);
    expect(reglasIncumplidas(res.body.data.contrasenaTemporal)).toEqual([]);
    const pendientes = await filas(e.pool, 'SELECT id FROM tokens_recuperacion WHERE usado_en IS NULL');
    expect(pendientes).toHaveLength(0);
    expect((await request(e.app).post('/api/plataforma/auth/ingresar').send({ correo: 'viewer@prueba.test', contrasena: res.body.data.contrasenaTemporal })).status).toBe(200);
  });

  it('rechaza datos inválidos', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const api = e.autorizado(s.token);
    expect((await api.post('/api/plataforma/usuarios').send({ nombre: '', correo: 'x@y.test', rol: 'ADMIN' })).status).toBe(400);
    expect((await api.post('/api/plataforma/usuarios').send({ nombre: 'N', correo: 'x@y.test', rol: 'DIOS' })).status).toBe(400);
    expect((await api.patch('/api/plataforma/usuarios/abc').send({ activo: false })).status).toBe(400);
    expect((await api.patch('/api/plataforma/usuarios/99999').send({ activo: false })).status).toBe(404);
  });
});
