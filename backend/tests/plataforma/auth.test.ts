import jwt from 'jsonwebtoken';
import request from 'supertest';
import { filas } from '../../src/db/consulta';
import { CONTRASENA_DE_PRUEBA, crearEntornoDePrueba, EntornoDePrueba } from './ayuda';

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

const ingresar = (correo: string, contrasena: string) => request(e.app).post('/api/plataforma/auth/ingresar').send({ correo, contrasena });

describe('ingresar', () => {
  it('con credenciales correctas entrega una sesión y registra el ingreso', async () => {
    const u = await e.usuario('ADMIN', 'ana@prueba.test');
    await e.pool.query('DELETE FROM auditoria_plataforma'); // el ayudante ya ingresó una vez para sacar su token
    const res = await ingresar('ana@prueba.test', CONTRASENA_DE_PRUEBA);
    expect(res.status).toBe(200);
    expect(res.body.data.usuario).toEqual({ id: u.id, nombre: 'USUARIO ADMIN', correo: 'ana@prueba.test', rol: 'ADMIN' });
    expect(typeof res.body.data.token).toBe('string');
    const auditoria = await filas<{ accion: string }>(e.pool, "SELECT accion FROM auditoria_plataforma WHERE accion = 'login_ok'");
    expect(auditoria).toHaveLength(1);
    const [fila] = await filas<{ ultimo_ingreso: Date | null }>(e.pool, 'SELECT ultimo_ingreso FROM usuarios_plataforma WHERE id = ?', [u.id]);
    expect(fila?.ultimo_ingreso).toBeInstanceOf(Date);
  });

  it('un correo inexistente y una contraseña mala dan EXACTAMENTE la misma respuesta', async () => {
    await e.usuario('ADMIN', 'ana@prueba.test');
    const malaClave = await ingresar('ana@prueba.test', 'otra-clave-Mala-1!');
    const sinCuenta = await ingresar('nadie@prueba.test', 'otra-clave-Mala-1!');
    expect(malaClave.status).toBe(401);
    expect(sinCuenta.status).toBe(401);
    expect(malaClave.body).toEqual(sinCuenta.body);
    expect(malaClave.body.error).toBe('Correo o contraseña incorrectos');
  });

  it('un usuario desactivado no entra aunque la contraseña sea correcta', async () => {
    await e.usuario('ADMIN', 'baja@prueba.test', false);
    const res = await ingresar('baja@prueba.test', CONTRASENA_DE_PRUEBA);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Correo o contraseña incorrectos');
  });

  it('los intentos fallidos quedan en la auditoría', async () => {
    await ingresar('nadie@prueba.test', 'x');
    const auditoria = await filas<{ descripcion: string }>(e.pool, "SELECT descripcion FROM auditoria_plataforma WHERE accion = 'login_fallido'");
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]?.descripcion).toContain('nadie@prueba.test');
  });

  it('rechaza una solicitud sin los datos', async () => {
    const res = await request(e.app).post('/api/plataforma/auth/ingresar').send({ correo: 'no-es-correo' });
    expect(res.status).toBe(400);
  });

  it('limita los intentos: después del tope responde 429', async () => {
    const limitado = await crearEntornoDePrueba({ limites: { ingreso: 3, recuperacion: 3 } });
    try {
      const codigos: number[] = [];
      for (let i = 0; i < 5; i++) {
        codigos.push((await request(limitado.app).post('/api/plataforma/auth/ingresar').send({ correo: 'x@prueba.test', contrasena: 'x' })).status);
      }
      expect(codigos).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limitado.cerrar();
    }
  });
});

describe('sesión', () => {
  it('GET /auth/yo exige sesión', async () => {
    expect((await request(e.app).get('/api/plataforma/auth/yo')).status).toBe(401);
    expect((await request(e.app).get('/api/plataforma/auth/yo').set('Authorization', 'Bearer basura')).status).toBe(401);
  });

  it('con sesión devuelve a quien ingresó', async () => {
    const u = await e.usuario('VIEWER', 'v@prueba.test');
    const res = await e.autorizado(u.token).get('/api/plataforma/auth/yo');
    expect(res.status).toBe(200);
    expect(res.body.data.correo).toBe('v@prueba.test');
  });

  it('desactivar a alguien corta su sesión al instante', async () => {
    const u = await e.usuario('ADMIN');
    await e.pool.query('UPDATE usuarios_plataforma SET activo = 0 WHERE id = ?', [u.id]);
    expect((await e.autorizado(u.token).get('/api/plataforma/auth/yo')).status).toBe(401);
  });

  it('un token firmado con otra llave, o de otro ámbito, no sirve', async () => {
    const u = await e.usuario('SUPER_ADMIN');
    const ajena = jwt.sign({ rol: 'SUPER_ADMIN', ambito: 'plataforma' }, 'otra-llave-distinta-de-mas-de-32-caracteres!!', { algorithm: 'HS256', issuer: 'veritech', subject: String(u.id) });
    const deOtroAmbito = jwt.sign({ rol: 'SUPER_ADMIN', ambito: 'taller' }, e.entorno.JWT_SECRETO, { algorithm: 'HS256', issuer: 'veritech', subject: String(u.id) });
    const sinFirma = jwt.sign({ rol: 'SUPER_ADMIN', ambito: 'plataforma' }, '', { algorithm: 'none', subject: String(u.id) });
    for (const t of [ajena, deOtroAmbito, sinFirma]) {
      expect((await e.autorizado(t).get('/api/plataforma/auth/yo')).status).toBe(401);
    }
  });

  it('un token vencido no sirve', async () => {
    const u = await e.usuario('ADMIN');
    const vencido = jwt.sign({ rol: 'ADMIN', ambito: 'plataforma' }, e.entorno.JWT_SECRETO, { algorithm: 'HS256', issuer: 'veritech', subject: String(u.id), expiresIn: -10 });
    const res = await e.autorizado(vencido).get('/api/plataforma/auth/yo');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('venció');
  });
});

describe('cambiar contraseña', () => {
  it('exige la contraseña actual correcta', async () => {
    const u = await e.usuario('ADMIN');
    const res = await e.autorizado(u.token).post('/api/plataforma/auth/cambiar-contrasena').send({ actual: 'mala', nueva: 'Nueva-2026-Segura!' });
    expect(res.status).toBe(400);
    expect(res.body.codigo).toBe('CONTRASENA_ACTUAL');
  });

  it('aplica las reglas del estándar a la nueva (10 caracteres, mayúscula, minúscula, número y símbolo)', async () => {
    const u = await e.usuario('ADMIN');
    for (const nueva of ['Corta1!', 'sinmayuscula-123!', 'SINMINUSCULA-123!', 'SinNumeros-Aqui!', 'SinSimbolo12345']) {
      const res = await e.autorizado(u.token).post('/api/plataforma/auth/cambiar-contrasena').send({ actual: CONTRASENA_DE_PRUEBA, nueva });
      expect([nueva, res.status]).toEqual([nueva, 400]);
    }
  });

  it('con datos correctos cambia la contraseña: la vieja deja de servir y la nueva entra', async () => {
    const u = await e.usuario('ADMIN', 'cambia@prueba.test');
    const res = await e.autorizado(u.token).post('/api/plataforma/auth/cambiar-contrasena').send({ actual: CONTRASENA_DE_PRUEBA, nueva: 'Nueva-2026-Segura!' });
    expect(res.status).toBe(200);
    expect((await ingresar('cambia@prueba.test', CONTRASENA_DE_PRUEBA)).status).toBe(401);
    expect((await ingresar('cambia@prueba.test', 'Nueva-2026-Segura!')).status).toBe(200);
  });
});
