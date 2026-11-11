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

const recuperar = (correo: string) => request(e.app).post('/api/plataforma/auth/recuperar').send({ correo });
const restablecer = (token: string, contrasena: string) => request(e.app).post('/api/plataforma/auth/restablecer').send({ token, contrasena });

async function tokenDelUltimoCorreo(): Promise<string> {
  const [correo] = await filas<{ cuerpo: string }>(e.pool, 'SELECT cuerpo FROM correos_salida ORDER BY id DESC LIMIT 1');
  const m = /restablecer\?token=([0-9a-f]{64})/.exec(correo?.cuerpo ?? '');
  if (!m) throw new Error('El correo no trae el enlace con el token');
  return m[1] as string;
}

describe('recuperar contraseña', () => {
  it('responde LO MISMO exista o no el correo, y solo manda correo si existe', async () => {
    await e.usuario('ADMIN', 'ana@prueba.test');
    const existe = await recuperar('ana@prueba.test');
    const noExiste = await recuperar('nadie@prueba.test');
    expect(existe.status).toBe(200);
    expect(existe.body).toEqual(noExiste.body);
    const correos = await filas<{ destinatarios: string; tipo: string }>(e.pool, 'SELECT destinatarios, tipo FROM correos_salida');
    expect(correos).toHaveLength(1);
    expect(correos[0]?.destinatarios).toBe('ana@prueba.test');
  });

  it('un usuario desactivado no recibe el enlace', async () => {
    await e.usuario('ADMIN', 'baja@prueba.test', false);
    await recuperar('baja@prueba.test');
    expect(await filas(e.pool, 'SELECT id FROM correos_salida')).toHaveLength(0);
  });

  it('el correo va en "usted", con el enlace a la dirección del panel, y en la base solo queda la huella del token', async () => {
    await e.usuario('ADMIN', 'ana@prueba.test');
    await recuperar('ana@prueba.test');
    const [correo] = await filas<{ cuerpo: string; asunto: string }>(e.pool, 'SELECT cuerpo, asunto FROM correos_salida');
    expect(correo?.asunto).toContain('Recupere su contraseña');
    expect(correo?.cuerpo).toContain('https://pruebas.veritech.lat/admin/restablecer?token=');
    expect(correo?.cuerpo).toContain('Si usted no lo solicitó');
    expect(correo?.cuerpo).toContain('#4997D0');
    const token = await tokenDelUltimoCorreo();
    const huellas = await filas<{ huella: string }>(e.pool, 'SELECT huella FROM tokens_recuperacion');
    expect(huellas).toHaveLength(1);
    expect(huellas[0]?.huella).not.toBe(token);
    expect(huellas[0]?.huella).toMatch(/^[0-9a-f]{64}$/);
  });

  it('el nombre de la persona se escapa en el correo (no se interpreta como HTML)', async () => {
    await e.usuario('ADMIN', 'html@prueba.test');
    await e.pool.query("UPDATE usuarios_plataforma SET nombre = '<img src=x onerror=alert(1)>' WHERE correo = 'html@prueba.test'");
    await recuperar('html@prueba.test');
    const [correo] = await filas<{ cuerpo: string }>(e.pool, 'SELECT cuerpo FROM correos_salida');
    expect(correo?.cuerpo).not.toContain('<img');
    expect(correo?.cuerpo).toContain('&lt;img');
  });

  it('el token restablece la contraseña UNA sola vez', async () => {
    await e.usuario('ADMIN', 'ana@prueba.test');
    await recuperar('ana@prueba.test');
    const token = await tokenDelUltimoCorreo();
    const primera = await restablecer(token, 'Nueva-2026-Segura!');
    expect(primera.status).toBe(200);
    const segunda = await restablecer(token, 'Otra-2026-Segura!!');
    expect(segunda.status).toBe(400);
    expect(segunda.body.codigo).toBe('TOKEN_INVALIDO');
    const ingreso = await request(e.app).post('/api/plataforma/auth/ingresar').send({ correo: 'ana@prueba.test', contrasena: 'Nueva-2026-Segura!' });
    expect(ingreso.status).toBe(200);
    const vieja = await request(e.app).post('/api/plataforma/auth/ingresar').send({ correo: 'ana@prueba.test', contrasena: CONTRASENA_DE_PRUEBA });
    expect(vieja.status).toBe(401);
  });

  it('un token vencido (más de 30 minutos) no sirve', async () => {
    await e.usuario('ADMIN', 'ana@prueba.test');
    await recuperar('ana@prueba.test');
    const token = await tokenDelUltimoCorreo();
    await e.pool.query('UPDATE tokens_recuperacion SET vence_en = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)');
    expect((await restablecer(token, 'Nueva-2026-Segura!')).status).toBe(400);
  });

  it('el token dura 30 minutos', async () => {
    await e.usuario('ADMIN', 'ana@prueba.test');
    await recuperar('ana@prueba.test');
    const [t] = await filas<{ minutos: number }>(e.pool, 'SELECT TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), vence_en) AS minutos FROM tokens_recuperacion');
    expect(t?.minutos).toBeGreaterThanOrEqual(29);
    expect(t?.minutos).toBeLessThanOrEqual(30);
  });

  it('pedir un enlace nuevo invalida el anterior', async () => {
    await e.usuario('ADMIN', 'ana@prueba.test');
    await recuperar('ana@prueba.test');
    const primero = await tokenDelUltimoCorreo();
    await recuperar('ana@prueba.test');
    const segundo = await tokenDelUltimoCorreo();
    expect(segundo).not.toBe(primero);
    expect((await restablecer(primero, 'Nueva-2026-Segura!')).status).toBe(400);
    expect((await restablecer(segundo, 'Nueva-2026-Segura!')).status).toBe(200);
  });

  it('la contraseña nueva debe cumplir las reglas y, si no, el token NO se gasta', async () => {
    await e.usuario('ADMIN', 'ana@prueba.test');
    await recuperar('ana@prueba.test');
    const token = await tokenDelUltimoCorreo();
    expect((await restablecer(token, 'debil')).status).toBe(400);
    expect((await restablecer(token, 'Nueva-2026-Segura!')).status).toBe(200);
  });

  it('un token inventado no sirve', async () => {
    expect((await restablecer('a'.repeat(64), 'Nueva-2026-Segura!')).status).toBe(400);
  });

  it('desactivar al usuario después de pedir el enlace lo deja sin efecto', async () => {
    const u = await e.usuario('ADMIN', 'ana@prueba.test');
    await recuperar('ana@prueba.test');
    const token = await tokenDelUltimoCorreo();
    await e.pool.query('UPDATE usuarios_plataforma SET activo = 0 WHERE id = ?', [u.id]);
    expect((await restablecer(token, 'Nueva-2026-Segura!')).status).toBe(400);
  });
});
