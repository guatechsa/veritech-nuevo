import { CLAVE_ADMIN } from '../alta/ayuda';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { CLAVE_TALLER, tallerDePrueba, TallerDePrueba } from './ayuda';

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

const telefono = (n = 1) => ({ instalacion: `instalacion-${n}-abcdef`, plataforma: 'android', nombre: 'Pixel 7', version_app: '2.0.0' });
const sql = (t: TallerDePrueba, consulta: string, params: unknown[] = []) => t.sql(async (c) => (await c.query(consulta, params))[0] as Array<Record<string, unknown>>);
const entrarMovil = (t: TallerDePrueba, correo = t.adminCorreo, clave = CLAVE_ADMIN, dispositivo: unknown = telefono()) => t.api().post('/auth/ingresar-movil').send({ correo, contrasena: clave, dispositivo });
interface Sesion {
  token: string;
  refresco: string;
}
async function sesionMovil(t: TallerDePrueba, correo = t.adminCorreo, clave = CLAVE_ADMIN): Promise<Sesion> {
  const r = await entrarMovil(t, correo, clave);
  expect(r.status).toBe(200);
  return r.body.data as Sesion;
}
const refrescar = (t: TallerDePrueba, refresco: string) => t.api().post('/auth/refrescar-movil').send({ refresco });

describe('sesión de la app', () => {
  it('entrar da un token y un refresco; registra el teléfono; el mensaje de error es el mismo que en la web', async () => {
    const t = await tallerDePrueba(e);
    const r = await entrarMovil(t);
    expect(r.status).toBe(200);
    expect(r.body.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.data.refresco).toMatch(/^[0-9a-f]{64}$/);
    expect(r.body.data.refresco).not.toBe(r.body.data.token);
    expect((await t.api(r.body.data.token).get('/auth/yo')).status).toBe(200);
    expect(await sql(t, 'SELECT plataforma, nombre, version_app FROM dispositivos')).toEqual([{ plataforma: 'android', nombre: 'Pixel 7', version_app: '2.0.0' }]);
    expect(await sql(t, 'SELECT movil, refresco_huella FROM sesiones WHERE movil = 1')).toHaveLength(1);
    // Volver a entrar desde el mismo teléfono no duplica el dispositivo.
    await entrarMovil(t);
    expect(await sql(t, 'SELECT id FROM dispositivos')).toHaveLength(1);
    // Contraseña mala o correo que no existe: el mismo mensaje.
    const mala = await entrarMovil(t, t.adminCorreo, 'incorrecta-123');
    const noExiste = await entrarMovil(t, 'nadie@nada.test', 'incorrecta-123');
    expect(mala.status).toBe(401);
    expect(mala.body).toEqual(noExiste.body);
    expect((await entrarMovil(t, t.adminCorreo, CLAVE_ADMIN, { instalacion: 'x', plataforma: 'android' })).status).toBe(400); // identificador de instalación muy corto
    expect((await entrarMovil(t, t.adminCorreo, CLAVE_ADMIN, { ...telefono(), plataforma: 'windows' })).status).toBe(400);
  });

  it('renovar cambia el token y el refresco: el token viejo deja de servir y el refresco nuevo sirve', async () => {
    const t = await tallerDePrueba(e);
    const s = await sesionMovil(t);
    const r = await refrescar(t, s.refresco);
    expect(r.status).toBe(200);
    expect(r.body.data.token).not.toBe(s.token);
    expect(r.body.data.refresco).not.toBe(s.refresco);
    expect((await t.api(s.token).get('/auth/yo')).status).toBe(401); // el viejo ya no
    expect((await t.api(r.body.data.token).get('/auth/yo')).status).toBe(200);
    expect((await refrescar(t, r.body.data.refresco)).status).toBe(200); // y se puede seguir renovando
    expect((await refrescar(t, 'a'.repeat(64))).status).toBe(401);
    expect((await refrescar(t, 'no-es-un-refresco')).status).toBe(400); // ni siquiera tiene la forma de un refresco
    // Un token de la web no sirve como refresco.
    const web = await t.token();
    expect((await refrescar(t, web)).status).toBe(401);
  });

  it('si la respuesta de una renovación se perdió, la app puede reintentar con el refresco anterior durante 2 minutos; pasado ese tiempo se cierra la sesión', async () => {
    const t = await tallerDePrueba(e);
    const ahora = new Date('2026-12-01T15:00:00Z');
    e.reloj.fijo = ahora;
    const s = await sesionMovil(t);
    e.reloj.fijo = new Date(ahora.getTime() + 3600000);
    const primera = await refrescar(t, s.refresco);
    expect(primera.status).toBe(200);
    // Reintento a los 60 segundos con el refresco ya cambiado: se acepta (la respuesta pudo perderse).
    e.reloj.fijo = new Date(ahora.getTime() + 3600000 + 60000);
    const reintento = await refrescar(t, s.refresco);
    expect(reintento.status).toBe(200);
    expect((await t.api(reintento.body.data.token).get('/auth/yo')).status).toBe(200);
    // Mucho después, usar uno viejo es señal de que lo copiaron: se cierra TODA la sesión.
    e.reloj.fijo = new Date(ahora.getTime() + 2 * 3600000);
    const robado = await refrescar(t, s.refresco);
    expect(robado.status).toBe(401);
    expect(robado.body.codigo).toBe('REFRESCO_REUTILIZADO');
    expect((await t.api(reintento.body.data.token).get('/auth/yo')).status).toBe(401);
    expect((await refrescar(t, reintento.body.data.refresco)).status).toBe(401);
  });

  it('el refresco vence a los 60 días; una persona desactivada o una sesión cerrada ya no renuevan', async () => {
    const t = await tallerDePrueba(e);
    const inicio = new Date('2026-12-01T15:00:00Z');
    e.reloj.fijo = inicio;
    const s1 = await sesionMovil(t);
    e.reloj.fijo = new Date(inicio.getTime() + 59 * 86400000);
    const ok = await refrescar(t, s1.refresco);
    expect(ok.status).toBe(200); // el refresco nuevo vale otros 60 días
    e.reloj.fijo = new Date(inicio.getTime() + 59 * 86400000 + 61 * 86400000);
    expect((await refrescar(t, ok.body.data.refresco)).status).toBe(401);

    e.reloj.fijo = inicio;
    const u = await t.usuario('tecnico', 'tec@taller.test');
    const s2 = await sesionMovil(t, u.correo, CLAVE_TALLER);
    await sql(t, 'UPDATE usuarios SET activo = 0 WHERE id = ?', [u.id]);
    expect((await refrescar(t, s2.refresco)).status).toBe(401);

    const s3 = await sesionMovil(t);
    expect((await t.api(s3.token).post('/auth/cerrar').send({})).status).toBe(200);
    expect((await refrescar(t, s3.refresco)).status).toBe(401);
  });
});

describe('cambios con identificador', () => {
  const crear = (t: TallerDePrueba, token: string, id: string | null, cuerpo: Record<string, unknown> = { nombre: 'Industrias Lopez' }, extra: Record<string, string> = {}) => {
    let r = t.api(token).post('/clientes');
    if (id) r = r.set('X-Id-Cliente', id);
    for (const [k, v] of Object.entries(extra)) r = r.set(k, v);
    return r.send(cuerpo);
  };

  it('enviar el mismo cambio dos veces lo aplica una sola vez y devuelve la misma respuesta', async () => {
    const t = await tallerDePrueba(e);
    const token = await t.token();
    const primera = await crear(t, token, 'cambio-0001-aaaa');
    expect(primera.status).toBe(201);
    expect(primera.headers['x-repetida']).toBeUndefined();
    const segunda = await crear(t, token, 'cambio-0001-aaaa');
    expect(segunda.status).toBe(201);
    expect(segunda.headers['x-repetida']).toBe('1');
    expect(segunda.body).toEqual(primera.body);
    expect(await sql(t, 'SELECT id FROM clientes')).toHaveLength(1);
    // Sin identificador, cada envío es un cambio nuevo (como siempre).
    await crear(t, token, null, { nombre: 'Otro Cliente' });
    await crear(t, token, null, { nombre: 'Otro Cliente Dos' });
    expect(await sql(t, 'SELECT id FROM clientes')).toHaveLength(3);
  });

  it('un rechazo también se guarda: reenviarlo da el mismo rechazo aunque el motivo ya no exista', async () => {
    const t = await tallerDePrueba(e);
    const token = await t.token();
    const a = await crear(t, token, null, { nombre: 'Primero', nit: '1234567-8' });
    expect(a.status).toBe(201);
    const rechazado = await crear(t, token, 'cambio-0002-bbbb', { nombre: 'Segundo', nit: '1234567-8' });
    expect(rechazado.status).toBe(409);
    expect(await sql(t, 'SELECT id FROM mutaciones_procesadas')).toHaveLength(1);
    // Se cambia el NIT del primero: un envío NUEVO ya no chocaría, pero el reenvío del mismo cambio sigue dando el mismo rechazo.
    await sql(t, "UPDATE clientes SET nit = '999' WHERE nombre = 'PRIMERO'");
    const igual = await crear(t, token, 'cambio-0002-bbbb', { nombre: 'Segundo', nit: '1234567-8' });
    expect(igual.status).toBe(409);
    expect(igual.headers['x-repetida']).toBe('1');
    expect(igual.body).toEqual(rechazado.body);
    expect(await sql(t, "SELECT id FROM clientes WHERE nombre = 'SEGUNDO'")).toHaveLength(0);
  });

  it('el identificador vale por persona; guarda cuándo se hizo en el teléfono; uno mal formado se rechaza', async () => {
    const t = await tallerDePrueba(e);
    const adminToken = await t.token();
    const gerente = await t.usuario('gerente', 'ger@taller.test');
    const gerenteToken = await gerente.token();
    expect((await crear(t, adminToken, 'mismo-id-0001', { nombre: 'De la administradora' }, { 'X-Hecho-En': '2026-12-01T10:15:00Z' })).status).toBe(201);
    const deOtra = await crear(t, gerenteToken, 'mismo-id-0001', { nombre: 'Del gerente' });
    expect(deOtra.status).toBe(201);
    expect(deOtra.headers['x-repetida']).toBeUndefined(); // es otro cambio
    expect(await sql(t, 'SELECT id FROM clientes')).toHaveLength(2);
    const reg = await sql(t, 'SELECT usuario_id, hecho_en, estado, codigo_http FROM mutaciones_procesadas ORDER BY id');
    expect(reg).toHaveLength(2);
    expect(reg[0]).toMatchObject({ estado: 'terminada', codigo_http: 201 });
    expect(new Date(reg[0]!['hecho_en'] as Date).toISOString()).toBe('2026-12-01T10:15:00.000Z');
    expect(reg[1]!['hecho_en']).toBeNull();
    expect((await crear(t, adminToken, 'corto')).status).toBe(400);
    expect((await crear(t, adminToken, 'tiene espacios y caracteres raros!!')).status).toBe(400);
    // Las consultas (GET) no se afectan por la cabecera.
    expect((await t.api(adminToken).get('/clientes').set('X-Id-Cliente', 'cambio-0003-cccc')).status).toBe(200);
  });

  it('un cambio que sigue en proceso no se repite; uno abandonado hace más de 2 minutos se retoma', async () => {
    const t = await tallerDePrueba(e);
    const token = await t.token();
    const usuarioId = (await sql(t, 'SELECT id FROM usuarios LIMIT 1'))[0]!['id'] as number;
    const ahora = new Date('2026-12-01T15:00:00Z');
    e.reloj.fijo = ahora;
    const tk = await t.token();
    void token;
    await sql(t, "INSERT INTO mutaciones_procesadas (usuario_id, id_cliente, metodo, ruta, estado, procesada_en) VALUES (?, 'cambio-0004-dddd', 'POST', '/clientes', 'en_proceso', ?)", [usuarioId, new Date(ahora.getTime() - 30000)]);
    const enProceso = await crear(t, tk, 'cambio-0004-dddd');
    expect(enProceso.status).toBe(409);
    expect(enProceso.body.codigo).toBe('EN_PROCESO');
    expect(await sql(t, 'SELECT id FROM clientes')).toHaveLength(0);
    e.reloj.fijo = new Date(ahora.getTime() + 3 * 60000);
    const tk2 = await t.token();
    const retomado = await crear(t, tk2, 'cambio-0004-dddd');
    expect(retomado.status).toBe(201);
    expect(await sql(t, 'SELECT id FROM clientes')).toHaveLength(1);
  });
});

describe('configuración, dispositivo y avisos de la app', () => {
  it('la configuración trae la versión mínima, los 8 estados de un trabajo y solo los avisos que esa persona puede recibir', async () => {
    const t = await tallerDePrueba(e);
    const admin = t.api(await t.token());
    const c = (await admin.get('/movil/config')).body.data;
    expect(c.version_minima).toBe('2.0.0');
    expect(c.estados_de_trabajo.map((x: { codigo: string }) => x.codigo)).toEqual(['pendiente', 'en_proceso', 'pausado', 'detenido_material', 'detenido_terceros', 'detenido_autorizacion', 'detenido_espacio', 'terminado']);
    expect(c.estados_de_trabajo.filter((x: { detenido: boolean }) => x.detenido)).toHaveLength(4);
    expect(c.maximo_fotos_por_item).toBe(5);
    const tecnico = t.api(await (await t.usuario('tecnico')).token());
    const av = (await tecnico.get('/movil/config')).body.data.avisos.map((a: { tipo: string }) => a.tipo);
    expect(av).toEqual(expect.arrayContaining(['trabajo_asignado', 'material_cargado']));
    expect(av).not.toContain('solicitud_material_nueva'); // eso es del bodeguero
    expect((await t.api().get('/movil/config')).status).toBe(401);
  });

  it('el teléfono registra su código de avisos y la persona apaga o enciende cada aviso', async () => {
    const t = await tallerDePrueba(e);
    const s = await sesionMovil(t);
    const api = t.api(s.token);
    const r = await api.post('/movil/dispositivo').send({ ...telefono(), token_push: 'ExponentPushToken[abc123]', version_app: '2.0.1' });
    expect(r.status).toBe(200);
    expect(await sql(t, 'SELECT token_push, version_app FROM dispositivos')).toEqual([{ token_push: 'ExponentPushToken[abc123]', version_app: '2.0.1' }]);
    const prefs = (await api.get('/movil/preferencias-aviso')).body.data as Array<{ tipo: string; activo: boolean }>;
    expect(prefs.every((p) => p.activo)).toBe(true); // por defecto todo encendido
    expect((await api.put('/movil/preferencias-aviso/cita_del_dia').send({ activo: false })).status).toBe(200);
    expect(((await api.get('/movil/preferencias-aviso')).body.data as Array<{ tipo: string; activo: boolean }>).find((p) => p.tipo === 'cita_del_dia')!.activo).toBe(false);
    expect((await api.put('/movil/preferencias-aviso/cita_del_dia').send({ activo: true })).status).toBe(200);
    expect(await sql(t, 'SELECT activo FROM preferencias_aviso')).toEqual([{ activo: 1 }]);
    expect((await api.put('/movil/preferencias-aviso/no_existe').send({ activo: true })).status).toBe(404);
    // El técnico no puede tocar el aviso del bodeguero.
    const tecnico = t.api(await (await t.usuario('tecnico')).token());
    expect((await tecnico.put('/movil/preferencias-aviso/solicitud_material_nueva').send({ activo: false })).status).toBe(404);
    expect((await api.post('/movil/dispositivo').send({ instalacion: 'x', plataforma: 'android' })).status).toBe(400);
  });
});
