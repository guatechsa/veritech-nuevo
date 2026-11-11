import { ejecutar, filas, una } from '../../src/db/consulta';
import { sumarDias } from '../../src/cobro/politica';
import { SEGUNDOS_TOKEN_SOPORTE } from '../../src/plataforma/soporte';
import { CLAVE_ADMIN } from '../alta/ayuda';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { tallerDePrueba } from './ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});

const correos = () => filas<{ tipo: string; destinatarios: string; asunto: string; cuerpo: string }>(e.pool, "SELECT tipo, destinatarios, asunto, cuerpo FROM correos_salida WHERE tipo = 'recuperacion_taller' ORDER BY id");
const tokenDeCorreo = (cuerpo: string): string => /token=([a-f0-9]{64})/.exec(cuerpo)?.[1] ?? '';

describe('recuperar la contraseña', () => {
  it('responde siempre lo mismo y solo manda correo si la persona existe y está activa', async () => {
    const t = await tallerDePrueba(e);
    const baja = await t.usuario('tecnico', 'baja@taller.test', { activo: false });
    const a = await t.api().post('/auth/recuperar').send({ correo: t.adminCorreo });
    const b = await t.api().post('/auth/recuperar').send({ correo: 'nadie@taller.test' });
    const c = await t.api().post('/auth/recuperar').send({ correo: baja.correo });
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
    const mandados = await correos();
    expect(mandados).toHaveLength(1);
    expect(mandados[0]?.destinatarios).toBe(t.adminCorreo);
  });

  it('el correo trae un enlace de un solo uso hacia SU taller, con el nombre escapado y en "usted"', async () => {
    const t = await tallerDePrueba(e);
    await ejecutar(e.pool, "UPDATE empresas SET nombre = '<B>TALLER</B>' WHERE id = ?", [t.empresaId]);
    await t.api().post('/auth/recuperar').send({ correo: t.adminCorreo });
    const c = (await correos())[0]!;
    expect(c.cuerpo).toContain(`https://pruebas.veritech.lat/t/${t.slug}/restablecer?token=`);
    expect(c.cuerpo).toContain('Estimado(a) JOSE PEREZ');
    expect(c.cuerpo).toContain('&lt;B&gt;TALLER&lt;/B&gt;');
    expect(c.cuerpo).not.toContain('<B>TALLER');
    expect(c.cuerpo).toContain('30 minutos');
    // En la base solo queda la huella.
    const guardado = await t.sql(async (con) => (await con.query('SELECT huella FROM tokens_recuperacion'))[0] as Array<{ huella: string }>);
    expect(guardado[0]?.huella).not.toBe(tokenDeCorreo(c.cuerpo));
  });

  it('restablece la contraseña, el enlace sirve UNA vez y cierra todas las sesiones abiertas', async () => {
    const t = await tallerDePrueba(e);
    const sesionVieja = await t.token();
    await t.api().post('/auth/recuperar').send({ correo: t.adminCorreo });
    const token = tokenDeCorreo((await correos())[0]!.cuerpo);
    const nueva = 'Nueva-clave-2026!';
    const r = await t.api().post('/auth/restablecer').send({ token, contrasena: nueva });
    expect(r.status).toBe(200);
    expect((await t.entrar(t.adminCorreo, CLAVE_ADMIN)).status).toBe(401);
    expect((await t.entrar(t.adminCorreo, nueva)).status).toBe(200);
    expect((await t.api(sesionVieja).get('/auth/yo')).status).toBe(401); // la sesión anterior se cerró
    const otra = await t.api().post('/auth/restablecer').send({ token, contrasena: 'Otra-clave-2026!' });
    expect(otra.status).toBe(400);
    expect(otra.body.codigo).toBe('TOKEN_INVALIDO');
  });

  it('el enlace vence a los 30 minutos', async () => {
    const t = await tallerDePrueba(e);
    await t.api().post('/auth/recuperar').send({ correo: t.adminCorreo });
    const token = tokenDeCorreo((await correos())[0]!.cuerpo);
    e.reloj.fijo = new Date(Date.now() + 31 * 60 * 1000);
    expect((await t.api().post('/auth/restablecer').send({ token, contrasena: 'Nueva-clave-2026!' })).status).toBe(400);
  });

  it('pedir un enlace nuevo invalida los anteriores', async () => {
    const t = await tallerDePrueba(e);
    await t.api().post('/auth/recuperar').send({ correo: t.adminCorreo });
    await t.api().post('/auth/recuperar').send({ correo: t.adminCorreo });
    const [primero, segundo] = (await correos()).map((c) => tokenDeCorreo(c.cuerpo));
    expect((await t.api().post('/auth/restablecer').send({ token: primero, contrasena: 'Nueva-clave-2026!' })).status).toBe(400);
    expect((await t.api().post('/auth/restablecer').send({ token: segundo, contrasena: 'Nueva-clave-2026!' })).status).toBe(200);
  });

  it('rechaza una contraseña débil sin gastar el enlace, y un enlace inventado', async () => {
    const t = await tallerDePrueba(e);
    await t.api().post('/auth/recuperar').send({ correo: t.adminCorreo });
    const token = tokenDeCorreo((await correos())[0]!.cuerpo);
    const debil = await t.api().post('/auth/restablecer').send({ token, contrasena: 'corta' });
    expect(debil.status).toBe(400);
    expect(debil.body.error).toContain('no cumple');
    expect((await t.api().post('/auth/restablecer').send({ token, contrasena: 'Nueva-clave-2026!' })).status).toBe(200); // el enlace seguía sano
    expect((await t.api().post('/auth/restablecer').send({ token: 'a'.repeat(64), contrasena: 'Nueva-clave-2026!' })).status).toBe(400);
  });

  it('restablecer también levanta un bloqueo por intentos fallidos', async () => {
    const t = await tallerDePrueba(e);
    for (let i = 0; i < 5; i++) await t.entrar(t.adminCorreo, 'Mala-clave-1!');
    await t.api().post('/auth/recuperar').send({ correo: t.adminCorreo });
    const token = tokenDeCorreo((await correos())[0]!.cuerpo);
    await t.api().post('/auth/restablecer').send({ token, contrasena: 'Nueva-clave-2026!' }).expect(200);
    expect((await t.entrar(t.adminCorreo, 'Nueva-clave-2026!')).status).toBe(200);
  });

  it('un enlace de un taller no restablece nada en otro taller', async () => {
    const a = await tallerDePrueba(e);
    const b = await tallerDePrueba(e);
    await a.api().post('/auth/recuperar').send({ correo: a.adminCorreo });
    const token = tokenDeCorreo((await correos())[0]!.cuerpo);
    expect((await b.api().post('/auth/restablecer').send({ token, contrasena: 'Nueva-clave-2026!' })).status).toBe(400);
  });
});

describe('cambiar la contraseña estando dentro', () => {
  it('exige la actual, aplica la política y cierra las OTRAS sesiones (la actual sigue)', async () => {
    const t = await tallerDePrueba(e);
    const actual = await t.token();
    const otra = await t.token();
    expect((await t.api(actual).post('/auth/cambiar-contrasena').send({ actual: 'Equivocada-1!', nueva: 'Nueva-clave-2026!' })).status).toBe(400);
    expect((await t.api(actual).post('/auth/cambiar-contrasena').send({ actual: CLAVE_ADMIN, nueva: 'debil' })).status).toBe(400);
    expect((await t.api(actual).post('/auth/cambiar-contrasena').send({ actual: CLAVE_ADMIN, nueva: 'Nueva-clave-2026!' })).status).toBe(200);
    expect((await t.api(actual).get('/auth/yo')).status).toBe(200);
    expect((await t.api(otra).get('/auth/yo')).status).toBe(401);
    expect((await t.entrar(t.adminCorreo, 'Nueva-clave-2026!')).status).toBe(200);
  });
});

describe('"Entrar" de soporte', () => {
  async function enlace(t: Awaited<ReturnType<typeof tallerDePrueba>>, rol: 'SUPER_ADMIN' | 'ADMIN' = 'SUPER_ADMIN') {
    const admin = await e.usuario(rol);
    const r = await e.autorizado(admin.token).post(`/api/plataforma/empresas/${t.empresaId}/entrar`);
    return { r, admin };
  }
  const tokenDeUrl = (url: string): string => /token=([a-f0-9]{64})/.exec(url)?.[1] ?? '';

  it('solo un super administrador puede emitirlo y el enlace apunta al taller', async () => {
    const t = await tallerDePrueba(e);
    expect((await enlace(t, 'ADMIN')).r.status).toBe(403);
    const { r } = await enlace(t);
    expect(r.status).toBe(200);
    expect(r.body.data.url).toContain(`https://pruebas.veritech.lat/t/${t.slug}/entrar-soporte?token=`);
    expect(r.body.data.vence_en_segundos).toBe(SEGUNDOS_TOKEN_SOPORTE);
  });

  it('se canjea UNA vez, abre una sesión de soporte de 2 horas y queda auditado en las dos bases', async () => {
    const t = await tallerDePrueba(e);
    const { r, admin } = await enlace(t);
    const token = tokenDeUrl(r.body.data.url);
    const canje = await t.api().post('/auth/soporte').send({ token });
    expect(canje.status).toBe(200);
    const sesion = canje.body.data.token as string;
    const yo = await t.api(sesion).get('/auth/yo');
    expect(yo.body.data.soporte).toBe(true);
    expect(yo.body.data.usuario.roles[0].codigo).toBe('administrador');
    const horas = (new Date(canje.body.data.vence_en).getTime() - Date.now()) / 3600000;
    expect(horas).toBeGreaterThan(1.9);
    expect(horas).toBeLessThan(2.1);
    expect((await t.api().post('/auth/soporte').send({ token })).status).toBe(400); // un solo uso
    expect(await una(e.pool, "SELECT id FROM auditoria_plataforma WHERE accion = 'acceso_soporte_canjeado' AND usuario_plataforma_id = ?", [admin.id])).not.toBeNull();
    expect(await una(e.pool, "SELECT id FROM auditoria_plataforma WHERE accion = 'acceso_soporte_iniciado'")).not.toBeNull();
    const bit = await t.sql(async (con) => (await con.query("SELECT accion FROM bitacora WHERE accion = 'acceso_soporte'"))[0] as unknown[]);
    expect(bit).toHaveLength(1);
  });

  it('el enlace vence a los 60 segundos', async () => {
    const t = await tallerDePrueba(e);
    const token = tokenDeUrl((await enlace(t)).r.body.data.url);
    e.reloj.fijo = new Date(Date.now() + 61 * 1000);
    // El vencimiento del enlace lo decide la base (UTC_TIMESTAMP): se adelanta ahí.
    await ejecutar(e.pool, 'UPDATE tokens_acceso_soporte SET vence_en = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)');
    expect((await t.api().post('/auth/soporte').send({ token })).status).toBe(400);
  });

  it('un enlace emitido para un taller NO abre otro taller', async () => {
    const a = await tallerDePrueba(e);
    const b = await tallerDePrueba(e);
    const token = tokenDeUrl((await enlace(a)).r.body.data.url);
    expect((await b.api().post('/auth/soporte').send({ token })).status).toBe(400);
  });

  it('la sesión de soporte NO puede cancelar la suscripción ni cambiar la contraseña de la persona', async () => {
    const t = await tallerDePrueba(e);
    const token = tokenDeUrl((await enlace(t)).r.body.data.url);
    const sesion = (await t.api().post('/auth/soporte').send({ token })).body.data.token as string;
    const cancelar = await t.api(sesion).post('/suscripcion/cancelar').send({ motivo: 'x' });
    expect(cancelar.status).toBe(403);
    expect(cancelar.body.codigo).toBe('SOPORTE_NO_CANCELA');
    const clave = await t.api(sesion).post('/auth/cambiar-contrasena').send({ actual: CLAVE_ADMIN, nueva: 'Nueva-clave-2026!' });
    expect(clave.status).toBe(403);
    expect((await t.api(sesion).get('/suscripcion')).body.data.puede_cancelar).toBe(false);
    expect(e.paypal.cancelaciones).toHaveLength(0);
  });

  it('no se emite un enlace para una cuenta suspendida o sin usuario', async () => {
    const t = await tallerDePrueba(e);
    await ejecutar(e.pool, "UPDATE empresas SET estado = 'suspendida' WHERE id = ?", [t.empresaId]);
    expect((await enlace(t)).r.status).toBe(409);
    const sinUsuario = await e.empresa({ estado: 'activa' });
    const admin = await e.usuario('SUPER_ADMIN');
    expect((await e.autorizado(admin.token).post(`/api/plataforma/empresas/${sinUsuario}/entrar`)).status).toBe(409);
  });
});

describe('suscripción y pagos desde el taller', () => {
  it('el administrador ve su estado, cuota, próximo cobro y pagos; un técnico no tiene acceso', async () => {
    const t = await tallerDePrueba(e);
    await ejecutar(e.pool, "INSERT INTO pagos (empresa_id, paypal_transaccion_id, fecha, monto, moneda, estado) VALUES (?, 'TX-9', ?, 60, 'USD', 'COMPLETED')", [t.empresaId, new Date()]);
    const r = await t.api(await t.token()).get('/suscripcion');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ estado: 'prueba', plan: 'PROFESIONAL', cuota_mensual: 60, puede_cancelar: true, limites: { max_usuarios: 15, max_sucursales: 3 } });
    expect(r.body.data.pagos).toHaveLength(1);
    const tecnico = await t.usuario('tecnico');
    expect((await t.api(await tecnico.token()).get('/suscripcion')).status).toBe(403);
  });

  it('cancelar: lo hace el administrador, se cancela en PayPal y el servicio sigue hasta el final del período', async () => {
    const t = await tallerDePrueba(e);
    const sub = (await una<{ paypal_suscripcion_id: string }>(e.pool, 'SELECT paypal_suscripcion_id FROM empresas WHERE id = ?', [t.empresaId]))!.paypal_suscripcion_id;
    e.paypal.suscripcion(sub, { enPrueba: false, proximoCobro: sumarDias(new Date(), 12) });
    const gerente = await t.usuario('gerente');
    expect((await t.api(await gerente.token()).post('/suscripcion/cancelar').send({ motivo: 'x' })).status).toBe(403); // el gerente no cancela
    const token = await t.token();
    const r = await t.api(token).post('/suscripcion/cancelar').send({ motivo: 'Ya no lo necesito' });
    expect(r.status).toBe(200);
    expect(e.paypal.cancelaciones).toEqual([{ id: sub, motivo: 'Ya no lo necesito' }]);
    const yo = await t.api(token).get('/auth/yo');
    expect(yo.body.data.empresa.estado).toBe('cancelada_con_acceso');
    expect(new Date(yo.body.data.avisos.acceso_hasta).getTime()).toBeGreaterThan(Date.now() + 11 * 86400000);
    expect((await t.api(token).get('/suscripcion')).body.data.puede_cancelar).toBe(false); // ya está cancelada
  });
});
