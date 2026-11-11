import request from 'supertest';
import { ejecutar, filas, una } from '../../src/db/consulta';
import { huellaDe } from '../../src/utils/tokens';
import { CLAVE_ADMIN } from '../alta/ayuda';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { CLAVE_TALLER, empresaEstado, tallerDePrueba } from './ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});

describe('qué taller es: se resuelve por la dirección', () => {
  it('por el nombre en la dirección (<taller>.<dominio>)', async () => {
    const t = await tallerDePrueba(e);
    const r = await request(e.app).get('/api/taller/info').set('Host', `${t.slug}.taller.test`);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ slug: t.slug, estado: 'prueba' });
  });

  it('por la cabecera X-Taller solo si está permitida (sitio de pruebas)', async () => {
    const t = await tallerDePrueba(e);
    expect((await t.api().get('/info')).status).toBe(200);
    // Con la cabecera apagada (producción) se ignora aunque venga.
    const produccion = { ...e.ctx, entorno: { ...e.ctx.entorno, TALLER_POR_ENCABEZADO: false } };
    const { crearApp } = await import('../../src/app');
    const app = crearApp({ verificarBase: async () => true, plataforma: produccion });
    const r = await request(app).get('/api/taller/info').set('X-Taller', t.slug);
    expect(r.status).toBe(404);
  });

  it('un taller que no existe, está pendiente o cerrado responde LO MISMO (no se revela cuáles existen)', async () => {
    const t = await tallerDePrueba(e);
    const sinNombre = await request(e.app).get('/api/taller/info');
    const noExiste = await request(e.app).get('/api/taller/info').set('X-Taller', 'no-existe');
    const malFormado = await request(e.app).get('/api/taller/info').set('X-Taller', '../etc');
    await empresaEstado(e, t.empresaId, 'cerrada');
    const cerrado = await t.api().get('/info');
    await empresaEstado(e, t.empresaId, 'pendiente');
    const pendiente = await t.api().get('/info');
    for (const r of [sinNombre, noExiste, malFormado, cerrado, pendiente]) {
      expect(r.status).toBe(404);
      expect(r.body).toEqual(sinNombre.body);
    }
  });

  it('la dirección manda sobre la cabecera: no se puede pedir el taller de otro por X-Taller desde la dirección propia', async () => {
    const a = await tallerDePrueba(e);
    const b = await tallerDePrueba(e);
    const r = await request(e.app).get('/api/taller/info').set('Host', `${a.slug}.taller.test`).set('X-Taller', b.slug);
    expect(r.body.data.slug).toBe(a.slug);
  });
});

describe('ingreso', () => {
  it('entra con el correo y la contraseña del registro, guarda solo la huella de la sesión y deja bitácora', async () => {
    const t = await tallerDePrueba(e);
    const r = await t.entrar(t.adminCorreo, CLAVE_ADMIN);
    expect(r.status).toBe(200);
    const token = r.body.data.token as string;
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    const ses = await t.sql(async (con) => (await con.query('SELECT huella_token, es_soporte, vence_en FROM sesiones'))[0] as Array<{ huella_token: string; es_soporte: number; vence_en: Date }>);
    expect(ses).toHaveLength(1);
    expect(ses[0]?.huella_token).toBe(huellaDe(token));
    expect(ses[0]?.huella_token).not.toBe(token);
    expect(ses[0]?.es_soporte).toBe(0);
    const horas = ((ses[0]?.vence_en.getTime() ?? 0) - Date.now()) / 3600000;
    expect(horas).toBeGreaterThan(7.9);
    expect(horas).toBeLessThan(8.1);
    const bit = await t.sql(async (con) => (await con.query("SELECT accion FROM bitacora WHERE accion = 'login_ok'"))[0] as unknown[]);
    expect(bit).toHaveLength(1);
  });

  it('correo desconocido, contraseña mala y usuario desactivado dan EXACTAMENTE la misma respuesta', async () => {
    const t = await tallerDePrueba(e);
    const baja = await t.usuario('tecnico', 'baja@taller.test', { activo: false });
    const respuestas = [await t.entrar('nadie@taller.test', CLAVE_TALLER), await t.entrar(t.adminCorreo, 'Otra-clave-1!'), await t.entrar(baja.correo, CLAVE_TALLER)];
    for (const r of respuestas) {
      expect(r.status).toBe(401);
      expect(r.body).toEqual(respuestas[0]?.body);
    }
    expect(respuestas[0]?.body.error).toBe('Correo o contraseña incorrectos');
  });

  it('tras 5 fallos seguidos se bloquea 15 minutos, aun con la clave correcta, y el bloqueo termina solo', async () => {
    const t = await tallerDePrueba(e);
    for (let i = 0; i < 5; i++) expect((await t.entrar(t.adminCorreo, 'Mala-clave-1!')).status).toBe(401);
    const bloqueada = await t.entrar(t.adminCorreo, CLAVE_ADMIN);
    expect(bloqueada.status).toBe(401);
    expect(bloqueada.body.error).toBe('Correo o contraseña incorrectos'); // no delata el bloqueo
    expect(await t.sql(async (con) => (await con.query("SELECT accion FROM bitacora WHERE accion = 'login_bloqueado'"))[0] as unknown[])).toHaveLength(1);
    e.reloj.fijo = new Date(Date.now() + 16 * 60 * 1000);
    expect((await t.entrar(t.adminCorreo, CLAVE_ADMIN)).status).toBe(200);
  });

  it('un ingreso correcto reinicia la cuenta de fallos', async () => {
    const t = await tallerDePrueba(e);
    for (let i = 0; i < 4; i++) await t.entrar(t.adminCorreo, 'Mala-clave-1!');
    expect((await t.entrar(t.adminCorreo, CLAVE_ADMIN)).status).toBe(200);
    for (let i = 0; i < 4; i++) await t.entrar(t.adminCorreo, 'Mala-clave-1!');
    expect((await t.entrar(t.adminCorreo, CLAVE_ADMIN)).status).toBe(200); // 4 + 4 fallos no suman 5 porque hubo un éxito en medio
  });

  it('un colaborador desactivado no entra, aunque su usuario siga activo', async () => {
    const t = await tallerDePrueba(e);
    const u = await t.usuario('tecnico');
    await t.sql((con) => con.query('UPDATE colaboradores SET activo = 0 WHERE id = ?', [u.colaboradorId]));
    expect((await t.entrar(u.correo, CLAVE_TALLER)).status).toBe(401);
  });

  it('tiene límite de intentos por dirección', async () => {
    const limitado = await crearEntornoDePrueba({ limites: { ingreso: 3, recuperacion: 100, registro: 100 } });
    try {
      await limitado.planesConPaypal();
      const t = await tallerDePrueba(limitado);
      const estados: number[] = [];
      for (let i = 0; i < 5; i++) estados.push((await t.entrar('x@taller.test', 'Mala-clave-1!')).status);
      expect(estados).toEqual([401, 401, 401, 429, 429]);
    } finally {
      await limitado.cerrar();
    }
  });
});

describe('sesiones', () => {
  it('sin sesión, con un token inventado o con uno de forma incorrecta: 401', async () => {
    const t = await tallerDePrueba(e);
    expect((await t.api().get('/auth/yo')).status).toBe(401);
    expect((await t.api('a'.repeat(64)).get('/auth/yo')).status).toBe(401);
    expect((await t.api('no-es-un-token').get('/auth/yo')).status).toBe(401);
  });

  it('un token de un taller NO sirve en otro taller', async () => {
    const a = await tallerDePrueba(e);
    const b = await tallerDePrueba(e);
    const tokenA = await a.token();
    expect((await a.api(tokenA).get('/auth/yo')).status).toBe(200);
    expect((await b.api(tokenA).get('/auth/yo')).status).toBe(401);
  });

  it('cerrar sesión la revoca y el token deja de servir', async () => {
    const t = await tallerDePrueba(e);
    const token = await t.token();
    expect((await t.api(token).post('/auth/cerrar')).status).toBe(200);
    expect((await t.api(token).get('/auth/yo')).status).toBe(401);
  });

  it('la sesión vence a las 8 horas', async () => {
    const t = await tallerDePrueba(e);
    const token = await t.token();
    e.reloj.fijo = new Date(Date.now() + 7 * 3600 * 1000);
    expect((await t.api(token).get('/auth/yo')).status).toBe(200);
    e.reloj.fijo = new Date(Date.now() + 9 * 3600 * 1000);
    expect((await t.api(token).get('/auth/yo')).status).toBe(401);
  });

  it('desactivar a la persona surte efecto en la siguiente llamada (sin esperar a que venza la sesión)', async () => {
    const t = await tallerDePrueba(e);
    const u = await t.usuario('tecnico');
    const token = await u.token();
    expect((await t.api(token).get('/auth/yo')).status).toBe(200);
    await t.sql((con) => con.query('UPDATE usuarios SET activo = 0 WHERE id = ?', [u.id]));
    expect((await t.api(token).get('/auth/yo')).status).toBe(401);
  });

  it('quitarle el rol a la persona le quita los permisos en la siguiente llamada', async () => {
    const t = await tallerDePrueba(e);
    const u = await t.usuario('gerente');
    const token = await u.token();
    expect((await t.api(token).get('/suscripcion')).status).toBe(200);
    await t.sql((con) => con.query('DELETE FROM usuario_roles WHERE usuario_id = ?', [u.id]));
    expect((await t.api(token).get('/suscripcion')).status).toBe(403);
  });
});

describe('estado de la cuenta', () => {
  it('suspendida: nadie entra y el mensaje dice por qué', async () => {
    const t = await tallerDePrueba(e);
    await empresaEstado(e, t.empresaId, 'suspendida');
    const r = await t.entrar(t.adminCorreo, CLAVE_ADMIN);
    expect(r.status).toBe(403);
    expect(r.body.codigo).toBe('CUENTA_SUSPENDIDA');
  });

  it('pago fallido y cancelada con acceso: el taller sigue trabajando y el perfil trae el aviso', async () => {
    const t = await tallerDePrueba(e);
    const gracia = new Date(Date.now() + 5 * 86400000);
    await empresaEstado(e, t.empresaId, 'pago_fallido', { gracia_hasta: gracia });
    const token = await t.token();
    const yo = await t.api(token).get('/auth/yo');
    expect(yo.status).toBe(200);
    expect(yo.body.data.empresa.estado).toBe('pago_fallido');
    expect(new Date(yo.body.data.avisos.gracia_hasta).getTime()).toBeGreaterThan(Date.now());
    expect(yo.body.data.avisos.acceso_hasta).toBeNull();
  });

  it('solo exportar: puede entrar, mirar y cerrar sesión, pero NO cambiar nada', async () => {
    const t = await tallerDePrueba(e);
    const token = await t.token();
    await empresaEstado(e, t.empresaId, 'solo_exportar', { exportable_hasta: new Date(Date.now() + 20 * 86400000) });
    expect((await t.api(token).get('/auth/yo')).status).toBe(200);
    const cambio = await t.api(token).post('/auth/cambiar-contrasena').send({ actual: CLAVE_ADMIN, nueva: 'Nueva-clave-2026!' });
    expect(cambio.status).toBe(403);
    expect(cambio.body.codigo).toBe('SOLO_EXPORTAR');
    expect((await t.api(token).post('/auth/cerrar')).status).toBe(200);
  });

  it('un módulo que el plan no incluye hace desaparecer sus permisos aunque el rol los tenga', async () => {
    const t = await tallerDePrueba(e);
    const token = await t.token();
    const antes = await t.api(token).get('/auth/yo');
    expect(antes.body.data.permisos).toContain('clientes.ver');
    expect(antes.body.data.permisos).toContain('equipos.ver');
    await ejecutar(e.pool, "DELETE FROM empresa_modulos WHERE empresa_id = ? AND modulo_codigo IN ('clientes','equipos')", [t.empresaId]);
    const despues = await t.api(token).get('/auth/yo');
    expect(despues.body.data.permisos).not.toContain('clientes.ver');
    expect(despues.body.data.permisos).not.toContain('equipos.ver');
    expect(despues.body.data.permisos).toContain('configuracion.ver'); // lo "base" siempre está
    expect(despues.body.data.modulos).not.toContain('clientes');
  });
});

describe('permisos', () => {
  const por = async (t: Awaited<ReturnType<typeof tallerDePrueba>>, rol: string) => {
    const u = await t.usuario(rol);
    const r = await t.api(await u.token()).get('/auth/yo');
    return new Set<string>(r.body.data.permisos);
  };

  it('el administrador tiene TODOS los permisos del catálogo (como filas reales, no "por nombre")', async () => {
    const t = await tallerDePrueba(e);
    const total = await t.sql(async (con) => ((await con.query('SELECT COUNT(*) AS n FROM permisos'))[0] as Array<{ n: number }>)[0]?.n);
    const admin = await por(t, 'administrador');
    expect(admin.size).toBe(total);
    expect(total).toBeGreaterThan(30);
  });

  it('cada rol de fábrica recibe lo que corresponde', async () => {
    const t = await tallerDePrueba(e);
    const gerente = await por(t, 'gerente');
    expect(gerente.has('clientes.editar')).toBe(true);
    expect(gerente.has('roles.gestionar')).toBe(false);
    expect(gerente.has('suscripcion.cancelar')).toBe(false);
    expect(gerente.has('usuarios.gestionar')).toBe(false);

    const recepcion = await por(t, 'recepcionista');
    expect(recepcion.has('clientes.crear')).toBe(true);
    expect(recepcion.has('equipos.crear')).toBe(true);
    expect(recepcion.has('clientes.desactivar')).toBe(false);
    expect(recepcion.has('suscripcion.ver')).toBe(false);

    const tecnico = await por(t, 'tecnico');
    expect(tecnico.has('contadores.registrar')).toBe(true);
    expect(tecnico.has('equipos.crear')).toBe(false);
    expect(tecnico.has('contadores.anular')).toBe(false);

    const visual = await por(t, 'visualizador');
    expect([...visual].every((p) => p.endsWith('.ver'))).toBe(true);
    expect(visual.has('equipos.ver')).toBe(true);
    expect(visual.has('colaboradores.ver')).toBe(false);
    expect(visual.has('bitacora.ver')).toBe(false);
  });

  it('una ruta protegida responde 403 a quien no tiene el permiso y 200 a quien sí', async () => {
    const t = await tallerDePrueba(e);
    for (const [rol, esperado] of [['administrador', 200], ['gerente', 200], ['recepcionista', 403], ['tecnico', 403], ['visualizador', 403]] as const) {
      const u = await t.usuario(rol);
      expect((await t.api(await u.token()).get('/suscripcion')).status).toBe(esperado);
    }
  });

  it('los permisos están sembrados con su módulo y todos los módulos existen en la plataforma', async () => {
    const t = await tallerDePrueba(e);
    const modulosTaller = await t.sql(async (con) => ((await con.query('SELECT DISTINCT modulo FROM permisos'))[0] as Array<{ modulo: string }>).map((m) => m.modulo));
    const enPlataforma = (await filas<{ codigo: string }>(e.pool, 'SELECT codigo FROM modulos')).map((m) => m.codigo);
    for (const m of modulosTaller) expect(m === 'base' || enPlataforma.includes(m)).toBe(true);
  });
});

describe('perfil (/auth/yo)', () => {
  it('trae quién es, su rol, sus permisos, los módulos y el aviso de prueba', async () => {
    const t = await tallerDePrueba(e);
    const r = await t.api(await t.token()).get('/auth/yo');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.usuario).toMatchObject({ nombre: 'JOSE PEREZ', roles: [{ codigo: 'administrador', nombre: 'ADMINISTRADOR' }], sucursal: { nombre: 'SUCURSAL PRINCIPAL' } });
    expect(d.empresa).toMatchObject({ estado: 'prueba', zona_horaria: 'America/Guatemala', plan: 'PROFESIONAL' });
    expect(d.soporte).toBe(false);
    expect(d.modulos).toContain('equipos');
    expect(d.avisos.prueba_hasta).not.toBeNull();
    expect(JSON.stringify(d)).not.toContain('hash');
  });

  it('la columna de contraseña nunca sale en ninguna respuesta', async () => {
    const t = await tallerDePrueba(e);
    const token = await t.token();
    for (const ruta of ['/auth/yo', '/suscripcion', '/info']) {
      const r = await t.api(token).get(ruta);
      expect(JSON.stringify(r.body)).not.toMatch(/scrypt\$/);
    }
  });
});

describe('conexiones a las bases', () => {
  it('el registro de conexiones se niega a abrir una base que no es de un taller', async () => {
    const { RegistroPools } = await import('../../src/taller/pools');
    const r = new RegistroPools(e.ctx.entorno);
    expect(() => r.obtener('mysql')).toThrow('no es de un taller');
    expect(() => r.obtener(e.ctx.entorno.BD_PLATAFORMA)).toThrow('no es de un taller');
    await r.cerrarTodos();
  });

  it('una consulta de otro taller nunca aparece: cada petición usa la base de SU taller', async () => {
    const a = await tallerDePrueba(e);
    const b = await tallerDePrueba(e);
    const ua = await a.usuario('gerente', 'solo-en-a@taller.test');
    expect(await una(e.pool, 'SELECT 1 AS x')).not.toBeNull();
    expect((await b.entrar(ua.correo, CLAVE_TALLER)).status).toBe(401); // existe en A, no en B
    expect((await a.entrar(ua.correo, CLAVE_TALLER)).status).toBe(200);
  });
});
