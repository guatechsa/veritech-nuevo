import { ejecutar, filas, una } from '../../src/db/consulta';
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
});

async function admin(t: TallerDePrueba) {
  return t.api(await t.token());
}
async function puesto(api: Awaited<ReturnType<typeof admin>>, nombre: string): Promise<number> {
  return (await api.get('/puestos')).body.data.find((p: { nombre: string }) => p.nombre === nombre).id as number;
}
const rolId = async (api: Awaited<ReturnType<typeof admin>>, codigo: string): Promise<number> => (await api.get('/roles')).body.data.find((r: { codigo: string }) => r.codigo === codigo).id as number;
const correos = (tipo: string) => filas<{ destinatarios: string; asunto: string; cuerpo: string }>(e.pool, 'SELECT destinatarios, asunto, cuerpo FROM correos_salida WHERE tipo = ? ORDER BY id', [tipo]);
const tokenDe = (cuerpo: string): string => /token=([a-f0-9]{64})/.exec(cuerpo)?.[1] ?? '';

describe('colaboradores', () => {
  it('crea con código correlativo, texto normalizado y puestos; el correo se guarda tal cual', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const a = await api.post('/colaboradores').send({ nombre_completo: 'José Ñandú Pérez', correo: 'Jose.Nandu@Taller.test', celular: '5555 1234', dpi: '2345 67890 0101', puestos: [tec] });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ codigo: 'C-000001', nombre_completo: 'JOSE NANDU PEREZ', correo: 'Jose.Nandu@Taller.test', dpi: '2345678900101', activo: 1, puestos: 'TECNICO' });
    const b = await api.post('/colaboradores').send({ nombre_completo: 'Ana Gómez', puestos: [tec] });
    expect(b.body.data.codigo).toBe('C-000002');
  });

  it('dos creaciones a la vez nunca reciben el mismo código', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const r = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => api.post('/colaboradores').send({ nombre_completo: `Persona ${i}`, puestos: [tec] })));
    const codigos = r.map((x) => x.body.data.codigo as string);
    expect(new Set(codigos).size).toBe(6);
  });

  it.each([
    ['sin puestos', { puestos: [] }],
    ['con un DPI que no tiene 13 dígitos', { dpi: '12345' }],
    ['con un correo inválido', { correo: 'no-es-correo' }],
    ['con una sucursal que no existe', { sucursal_id: 9999 }],
    ['con un puesto que no existe', { puestos: [9999] }],
    ['con un nombre demasiado corto', { nombre_completo: 'A' }],
  ])('rechaza un colaborador %s', async (_n, cambios) => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const r = await api.post('/colaboradores').send({ nombre_completo: 'Persona', puestos: [tec], ...cambios });
    expect(r.status).toBe(400);
  });

  it('DPI y correo no se repiten', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    await api.post('/colaboradores').send({ nombre_completo: 'Uno', correo: 'uno@taller.test', dpi: '1234567890101', puestos: [tec] }).expect(201);
    const dpi = await api.post('/colaboradores').send({ nombre_completo: 'Dos', dpi: '1234567890101', puestos: [tec] });
    expect(dpi.status).toBe(409);
    expect(dpi.body.error).toContain('UNO');
    expect((await api.post('/colaboradores').send({ nombre_completo: 'Tres', correo: 'UNO@taller.test', puestos: [tec] })).status).toBe(409);
  });

  it('el nivel solo aplica a técnicos: un recepcionista no lo lleva, pero cambiar de puesto no borra el que ya tenía', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const recep = await puesto(api, 'RECEPCIONISTA');
    const nivel = (await api.get('/niveles-tecnico')).body.data[0].id;
    expect((await api.post('/colaboradores').send({ nombre_completo: 'Recepcion', puestos: [recep], nivel_tecnico_id: nivel })).status).toBe(400);
    const c = (await api.post('/colaboradores').send({ nombre_completo: 'Tecnico', puestos: [tec], nivel_tecnico_id: nivel })).body.data;
    // Cambia a recepción: el nivel NO se borra (se conserva y se oculta).
    const r = await api.patch(`/colaboradores/${c.id}`).send({ puestos: [recep] });
    expect(r.status).toBe(200);
    expect(r.body.data.nivel_tecnico_id).toBe(nivel);
    expect(r.body.data.puestos).toBe('RECEPCIONISTA');
  });

  it('editar reemplaza los puestos de una sola vez y la lista filtra por texto, puesto y estado', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const op = await puesto(api, 'OPERADOR');
    const a = (await api.post('/colaboradores').send({ nombre_completo: 'Ana Lopez', puestos: [tec] })).body.data;
    await api.post('/colaboradores').send({ nombre_completo: 'Beto Ruiz', puestos: [op] }).expect(201);
    await api.patch(`/colaboradores/${a.id}`).send({ puestos: [tec, op] }).expect(200);
    expect((await api.get(`/colaboradores/${a.id}`)).body.data.puestos_detalle).toHaveLength(2);
    expect((await api.get(`/colaboradores?puesto_id=${op}`)).body.data).toHaveLength(2);
    expect((await api.get('/colaboradores?buscar=ruiz')).body.data).toHaveLength(1);
    expect((await api.get('/colaboradores?buscar=C-000001')).body.data).toHaveLength(1);
    expect((await api.get('/colaboradores?activo=false')).body.data).toHaveLength(0);
  });

  it('desactivar: no a sí mismo, no al último administrador, y se puede reactivar', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const yo = (await api.get('/colaboradores')).body.data.find((c: { correo: string }) => c.correo === t.adminCorreo);
    const propio = await api.post(`/colaboradores/${yo.id}/estado`).send({ activo: false });
    expect(propio.status).toBe(409);
    expect(propio.body.error).toContain('a sí mismo');
    const tec = await puesto(api, 'TECNICO');
    const c = (await api.post('/colaboradores').send({ nombre_completo: 'Temporal', puestos: [tec] })).body.data;
    expect((await api.post(`/colaboradores/${c.id}/estado`).send({ activo: false })).body.data.activo).toBe(0);
    expect((await api.post(`/colaboradores/${c.id}/estado`).send({ activo: true })).body.data.activo).toBe(1);
  });

  it('desactivar a un colaborador con acceso le quita el acceso y cierra sus sesiones (si así se pide)', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const u = await t.usuario('gerente', 'gerente2@taller.test');
    const sesion = await u.token();
    expect((await t.api(sesion).get('/auth/yo')).status).toBe(200);
    await api.post(`/colaboradores/${u.colaboradorId}/estado`).send({ activo: false }).expect(200);
    expect((await t.api(sesion).get('/auth/yo')).status).toBe(401);
    expect((await t.entrar(u.correo, CLAVE_TALLER)).status).toBe(401);
    const bit = await t.sql(async (con) => (await con.query("SELECT * FROM bitacora WHERE accion = 'colaborador_desactivado'"))[0] as unknown[]);
    expect(bit).toHaveLength(1);
  });

  it('exige permisos: el técnico no ve colaboradores y el recepcionista no crea', async () => {
    const t = await tallerDePrueba(e);
    const tecnico = await t.usuario('tecnico');
    expect((await t.api(await tecnico.token()).get('/colaboradores')).status).toBe(403);
    const gerente = await t.usuario('gerente');
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    expect((await t.api(await gerente.token()).post('/colaboradores').send({ nombre_completo: 'Gerente crea', puestos: [tec] })).status).toBe(201);
    const recep = await t.usuario('recepcionista');
    expect((await t.api(await recep.token()).post('/colaboradores').send({ nombre_completo: 'No', puestos: [tec] })).status).toBe(403);
  });
});

describe('credenciales de un colaborador', () => {
  it('registra, calcula el estado por vencimiento y avisa qué obligatorias le faltan', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const op = await puesto(api, 'OPERADOR');
    const licencia = (await api.post('/tipos-credencial').send({ nombre: 'Licencia C', requiere_vencimiento: true, dias_aviso: 30 })).body.data;
    const cert = (await api.post('/tipos-credencial').send({ nombre: 'Certificado interno' })).body.data;
    await api.put(`/puestos/${op}/credenciales`).send({ credenciales: [{ tipo_credencial_id: licencia.id, obligatoria: true }, { tipo_credencial_id: cert.id, obligatoria: true }] }).expect(200);
    const c = (await api.post('/colaboradores').send({ nombre_completo: 'Operador Uno', puestos: [op] })).body.data;
    expect(c.credenciales_faltantes).toEqual(expect.arrayContaining(['LICENCIA C', 'CERTIFICADO INTERNO']));

    const ya = new Date();
    const en = (d: number) => new Date(ya.getTime() + d * 86400000).toISOString().slice(0, 10);
    const sinFecha = await api.post(`/colaboradores/${c.id}/credenciales`).send({ tipo_credencial_id: licencia.id });
    expect(sinFecha.status).toBe(400); // exige vencimiento
    const r1 = await api.post(`/colaboradores/${c.id}/credenciales`).send({ tipo_credencial_id: licencia.id, numero: 'ab-123', vence: en(10) });
    expect(r1.status).toBe(201);
    expect(r1.body.data.credenciales[0]).toMatchObject({ tipo: 'LICENCIA C', numero: 'AB-123', estado: 'por_vencer' });
    await api.post(`/colaboradores/${c.id}/credenciales`).send({ tipo_credencial_id: cert.id }).expect(201);
    expect((await api.get(`/colaboradores/${c.id}`)).body.data.credenciales_faltantes).toEqual([]);

    // Vencida: deja de contar como cumplida.
    const lic = (await api.get(`/colaboradores/${c.id}`)).body.data.credenciales.find((x: { tipo: string }) => x.tipo === 'LICENCIA C');
    const r2 = await api.patch(`/colaboradores/${c.id}/credenciales/${lic.id}`).send({ vence: en(-1) });
    expect(r2.body.data.credenciales.find((x: { tipo: string }) => x.tipo === 'LICENCIA C').estado).toBe('vencida');
    expect(r2.body.data.credenciales_faltantes).toEqual(['LICENCIA C']);
    // Desactivarla también la quita.
    await api.patch(`/colaboradores/${c.id}/credenciales/${lic.id}`).send({ vence: en(200), activo: false }).expect(200);
    expect((await api.get(`/colaboradores/${c.id}`)).body.data.credenciales_faltantes).toEqual(['LICENCIA C']);
  });

  it('rechaza una fecha de vencimiento imposible', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const op = await puesto(api, 'OPERADOR');
    const lic = (await api.post('/tipos-credencial').send({ nombre: 'Licencia', requiere_vencimiento: true })).body.data;
    const c = (await api.post('/colaboradores').send({ nombre_completo: 'Op', puestos: [op] })).body.data;
    expect((await api.post(`/colaboradores/${c.id}/credenciales`).send({ tipo_credencial_id: lic.id, vence: '2026-02-31' })).status).toBe(400);
    expect((await api.post(`/colaboradores/${c.id}/credenciales`).send({ tipo_credencial_id: lic.id, vence: '1850-01-01' })).status).toBe(400);
  });
});

describe('jornada y ausencias', () => {
  it('la empresa nace con la jornada de partida (lunes a sábado) y la puede cambiar', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const j = (await api.get('/jornada')).body.data;
    expect(j).toHaveLength(6);
    expect(j[0]).toMatchObject({ dia_semana: 1, desde: '07:00', hasta: '16:00', pausa_desde: '12:00', pausa_hasta: '13:00' });
    expect(j[5]).toMatchObject({ dia_semana: 6, hasta: '12:00', pausa_desde: null });
    const nueva = await api.put('/jornada').send({ dias: [1, 2, 3, 4, 5].map((d) => ({ dia_semana: d, desde: '08:00', hasta: '17:00', pausa_desde: '12:30', pausa_hasta: '13:30' })) });
    expect(nueva.status).toBe(200);
    expect(nueva.body.data).toHaveLength(5);
  });

  it.each([
    ['salida antes de la entrada', [{ dia_semana: 1, desde: '10:00', hasta: '09:00' }]],
    ['un día repetido', [{ dia_semana: 1, desde: '08:00', hasta: '12:00' }, { dia_semana: 1, desde: '13:00', hasta: '17:00' }]],
    ['almuerzo fuera de la jornada', [{ dia_semana: 1, desde: '08:00', hasta: '12:00', pausa_desde: '12:30', pausa_hasta: '13:30' }]],
    ['almuerzo incompleto', [{ dia_semana: 1, desde: '08:00', hasta: '17:00', pausa_desde: '12:00' }]],
    ['sin ningún día', []],
  ])('rechaza una jornada con %s', async (_n, dias) => {
    const t = await tallerDePrueba(e);
    expect((await (await admin(t)).put('/jornada').send({ dias })).status).toBe(400);
  });

  it('una persona puede tener su propia jornada; sin ella vale la de la empresa', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const c = (await api.post('/colaboradores').send({ nombre_completo: 'Turno Noche', puestos: [tec] })).body.data;
    expect((await api.get(`/colaboradores/${c.id}/jornada`)).body.data).toMatchObject({ origen: 'empresa' });
    const r = await api.put(`/colaboradores/${c.id}/jornada`).send({ dias: [{ dia_semana: 1, desde: '22:00', hasta: '23:59' }] });
    expect(r.body.data).toMatchObject({ origen: 'propia' });
    expect(r.body.data.dias).toHaveLength(1);
    const vuelve = await api.put(`/colaboradores/${c.id}/jornada`).send({ dias: [] });
    expect(vuelve.body.data.origen).toBe('empresa');
  });

  it('ausencias: crear, no cruzarse con otra de la misma persona, editar y eliminar', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const c = (await api.post('/colaboradores').send({ nombre_completo: 'Con Vacaciones', puestos: [tec] })).body.data;
    const a = await api.post('/ausencias').send({ colaborador_id: c.id, desde: '2026-12-20', hasta: '2026-12-31', tipo: 'vacaciones', notas: 'fin de año' });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ desde: '2026-12-20', hasta: '2026-12-31', tipo: 'vacaciones', notas: 'FIN DE ANO', colaborador: 'CON VACACIONES' });
    expect((await api.post('/ausencias').send({ colaborador_id: c.id, desde: '2026-12-30', hasta: '2027-01-05', tipo: 'permiso' })).status).toBe(409);
    await api.post('/ausencias').send({ colaborador_id: c.id, desde: '2027-01-06', hasta: '2027-01-06', tipo: 'permiso' }).expect(201);
    expect((await api.post('/ausencias').send({ colaborador_id: c.id, desde: '2027-02-10', hasta: '2027-02-01', tipo: 'otro' })).status).toBe(400);
    expect((await api.post('/ausencias').send({ colaborador_id: c.id, desde: '2027-03-33', hasta: '2027-03-34', tipo: 'otro' })).status).toBe(400);
    const ed = await api.patch(`/ausencias/${a.body.data.id}`).send({ hasta: '2026-12-28' });
    expect(ed.body.data.hasta).toBe('2026-12-28');
    expect((await api.get(`/ausencias?colaborador_id=${c.id}&desde=2026-12-25&hasta=2026-12-26`)).body.data).toHaveLength(1);
    expect((await api.get(`/ausencias?colaborador_id=${c.id}&desde=2027-06-01&hasta=2027-06-02`)).body.data).toHaveLength(0);
    await api.delete(`/ausencias/${a.body.data.id}`).expect(200);
    expect((await api.get(`/ausencias?colaborador_id=${c.id}`)).body.data).toHaveLength(1);
  });
});

describe('dar acceso al sistema', () => {
  it('de punta a punta: crea el acceso, llega el enlace por correo, la persona crea su contraseña y entra con su rol', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const c = (await api.post('/colaboradores').send({ nombre_completo: 'Nuevo Gerente', correo: 'nuevo.gerente@taller.test', puestos: [tec] })).body.data;
    const rol = await rolId(api, 'gerente');
    const r = await api.post(`/colaboradores/${c.id}/acceso`).send({ roles: [rol] });
    expect(r.status).toBe(201);
    expect(r.body.data.enlace_enviado_a).toBe('nuevo.gerente@taller.test');
    // No puede entrar todavía: nadie conoce su contraseña.
    expect((await t.entrar('nuevo.gerente@taller.test', 'Cualquier-cosa-1!')).status).toBe(401);
    const mail = (await correos('invitacion_taller'))[0]!;
    expect(mail.destinatarios).toBe('nuevo.gerente@taller.test');
    expect(mail.cuerpo).toContain('Estimado(a) NUEVO GERENTE');
    expect(mail.cuerpo).toContain('72 horas');
    const token = tokenDe(mail.cuerpo);
    expect((await t.api().post('/auth/restablecer').send({ token, contrasena: 'Mi-clave-2026!' })).status).toBe(200);
    const login = await t.entrar('nuevo.gerente@taller.test', 'Mi-clave-2026!');
    expect(login.status).toBe(200);
    const yo = await t.api(login.body.data.token).get('/auth/yo');
    expect(yo.body.data.usuario.roles[0].codigo).toBe('gerente');
    expect(yo.body.data.permisos).toContain('clientes.editar');
    // Quedó en el directorio de accesos de la plataforma.
    expect(await una(e.pool, 'SELECT activo FROM directorio_acceso WHERE correo = ? AND empresa_id = ?', ['nuevo.gerente@taller.test', t.empresaId])).toMatchObject({ activo: 1 });
  });

  it('exige colaborador activo, con correo y sin acceso previo', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const rol = await rolId(api, 'tecnico');
    const sinCorreo = (await api.post('/colaboradores').send({ nombre_completo: 'Sin correo', puestos: [tec] })).body.data;
    expect((await api.post(`/colaboradores/${sinCorreo.id}/acceso`).send({ roles: [rol] })).status).toBe(409);
    const c = (await api.post('/colaboradores').send({ nombre_completo: 'Con correo', correo: 'con@taller.test', puestos: [tec] })).body.data;
    await api.post(`/colaboradores/${c.id}/acceso`).send({ roles: [rol] }).expect(201);
    expect((await api.post(`/colaboradores/${c.id}/acceso`).send({ roles: [rol] })).status).toBe(409);
    expect((await api.post(`/colaboradores/${c.id}/acceso`).send({ roles: [] })).status).toBe(400);
    expect((await api.post(`/colaboradores/${c.id}/acceso`).send({ roles: [99999] })).status).toBe(409); // ya tiene acceso: manda esa regla primero
  });

  it('el plan limita los usuarios activos (Básico: 5) y se libera desactivando a alguien', async () => {
    const t = await tallerDePrueba(e, { plan_codigo: 'basico' });
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const rol = await rolId(api, 'tecnico');
    const ids: number[] = [];
    for (let i = 1; i <= 4; i++) {
      const c = (await api.post('/colaboradores').send({ nombre_completo: `Persona ${i}`, correo: `p${i}@taller.test`, puestos: [tec] })).body.data;
      const r = await api.post(`/colaboradores/${c.id}/acceso`).send({ roles: [rol] });
      expect(r.status).toBe(201);
      ids.push(r.body.data.usuario_id);
    }
    const quinto = (await api.post('/colaboradores').send({ nombre_completo: 'Persona 5', correo: 'p5@taller.test', puestos: [tec] })).body.data;
    const r5 = await api.post(`/colaboradores/${quinto.id}/acceso`).send({ roles: [rol] });
    expect(r5.status).toBe(409);
    expect(r5.body.codigo).toBe('LIMITE_DEL_PLAN');
    expect(r5.body.error).toContain('5 usuarios');
    await api.patch(`/usuarios/${ids[0]}`).send({ activo: false }).expect(200);
    await api.post(`/colaboradores/${quinto.id}/acceso`).send({ roles: [rol] }).expect(201);
  });

  it('desactivar y reactivar un usuario: cierra sesiones, lo saca del directorio y lo devuelve', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const u = await t.usuario('tecnico', 'tec@taller.test');
    await ejecutar(e.pool, 'INSERT INTO directorio_acceso (correo, empresa_id, usuario_id, activo) VALUES (?, ?, ?, 1)', ['tec@taller.test', t.empresaId, u.id]);
    const sesion = await u.token();
    await api.patch(`/usuarios/${u.id}`).send({ activo: false }).expect(200);
    expect((await t.api(sesion).get('/auth/yo')).status).toBe(401);
    expect(await una(e.pool, 'SELECT activo FROM directorio_acceso WHERE correo = ?', ['tec@taller.test'])).toMatchObject({ activo: 0 });
    await api.patch(`/usuarios/${u.id}`).send({ activo: true }).expect(200);
    expect((await t.entrar('tec@taller.test', CLAVE_TALLER)).status).toBe(200);
    expect(await una(e.pool, 'SELECT activo FROM directorio_acceso WHERE correo = ?', ['tec@taller.test'])).toMatchObject({ activo: 1 });
  });

  it('nadie se quita el acceso a sí mismo ni deja al taller sin administrador', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const yo = (await api.get('/auth/yo')).body.data.usuario.id as number;
    expect((await api.patch(`/usuarios/${yo}`).send({ activo: false })).body.error).toContain('a sí mismo');
    const gerente = await rolId(api, 'gerente');
    const r = await api.patch(`/usuarios/${yo}`).send({ roles: [gerente] }); // se quitaría el único rol de administrador
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('único administrador');
    // Con un segundo administrador, ya puede.
    const otro = await t.usuario('administrador', 'admin2@taller.test');
    expect((await api.patch(`/usuarios/${yo}`).send({ roles: [gerente] })).status).toBe(200);
    expect(otro.id).toBeGreaterThan(0);
  });

  it('el gerente no gestiona usuarios; reenviar el enlace y revocar sesiones sí funcionan para el administrador', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const gerente = await t.usuario('gerente');
    expect((await t.api(await gerente.token()).post(`/usuarios/${gerente.id}/enlace`)).status).toBe(403);
    const u = await t.usuario('tecnico', 'tec2@taller.test');
    const s1 = await u.token();
    const s2 = await u.token();
    const rev = await api.post(`/usuarios/${u.id}/revocar-sesiones`);
    expect(rev.body.data.cerradas).toBe(2);
    expect((await t.api(s1).get('/auth/yo')).status).toBe(401);
    expect((await t.api(s2).get('/auth/yo')).status).toBe(401);
    expect((await api.post(`/usuarios/${u.id}/enlace`)).body.data.enlace_enviado_a).toBe('tec2@taller.test');
    const mails = await correos('enlace_taller');
    expect(mails).toHaveLength(1);
    expect((await t.api().post('/auth/restablecer').send({ token: tokenDe(mails[0]!.cuerpo), contrasena: 'Otra-clave-2026!' })).status).toBe(200);
  });

  it('cambiar el correo de quien tiene acceso lo cambia también en el directorio de talleres', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tec = await puesto(api, 'TECNICO');
    const rol = await rolId(api, 'tecnico');
    const c = (await api.post('/colaboradores').send({ nombre_completo: 'Cambia Correo', correo: 'viejo@taller.test', puestos: [tec] })).body.data;
    await api.post(`/colaboradores/${c.id}/acceso`).send({ roles: [rol] }).expect(201);
    await api.patch(`/colaboradores/${c.id}`).send({ correo: 'nuevo@taller.test' }).expect(200);
    const dir = await filas<{ correo: string }>(e.pool, 'SELECT correo FROM directorio_acceso WHERE empresa_id = ? AND correo IN (?, ?)', [t.empresaId, 'viejo@taller.test', 'nuevo@taller.test']);
    expect(dir.map((d) => d.correo)).toEqual(['nuevo@taller.test']);
  });
});

describe('roles y permisos', () => {
  it('lista los 8 roles de fábrica con cuántos usuarios y permisos tiene cada uno', async () => {
    const t = await tallerDePrueba(e);
    const roles = (await (await admin(t)).get('/roles')).body.data as Array<{ codigo: string; es_sistema: number; usuarios: number; permisos: number }>;
    expect(roles.map((r) => r.codigo)).toEqual(['administrador', 'gerente', 'supervisor', 'recepcionista', 'tecnico', 'operador', 'bodeguero', 'visualizador']);
    expect(roles[0]).toMatchObject({ es_sistema: 1, usuarios: 1 });
    expect(roles[0]!.permisos).toBeGreaterThan(30);
  });

  it('crea un rol propio con permisos, copiando de otro, y los usuarios lo reciben de inmediato', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const r = await api.post('/roles').send({ nombre: 'Jefe de patio', descripcion: 'coordina', permisos: ['equipos.ver', 'contadores.ver', 'contadores.registrar'] });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ codigo: 'jefe_de_patio', nombre: 'JEFE DE PATIO', es_sistema: 0, activo: 1 });
    expect(r.body.data.permisos).toEqual(['contadores.registrar', 'contadores.ver', 'equipos.ver']);
    const copia = await api.post('/roles').send({ nombre: 'Como recepcion', copiar_de: await rolId(api, 'recepcionista') });
    expect(copia.body.data.permisos).toContain('clientes.crear');
    expect((await api.post('/roles').send({ nombre: 'jefe de patio' })).status).toBe(409);

    const u = await t.usuario('tecnico', 'con-rol-nuevo@taller.test');
    await api.patch(`/usuarios/${u.id}`).send({ roles: [r.body.data.id] }).expect(200);
    const token = await u.token();
    const antes = (await t.api(token).get('/auth/yo')).body.data.permisos as string[];
    expect(antes).toEqual(['contadores.registrar', 'contadores.ver', 'equipos.ver']);
    await api.patch(`/roles/${r.body.data.id}`).send({ permisos: ['equipos.ver', 'clientes.ver'] }).expect(200);
    expect((await t.api(token).get('/auth/yo')).body.data.permisos).toEqual(['clientes.ver', 'equipos.ver']); // sin cerrar sesión
  });

  it('el rol administrador siempre tiene todo: no se edita ni se desactiva; los de fábrica se pueden renombrar', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const adminId = await rolId(api, 'administrador');
    expect((await api.patch(`/roles/${adminId}`).send({ permisos: ['equipos.ver'] })).status).toBe(409);
    expect((await api.patch(`/roles/${adminId}`).send({ activo: false })).status).toBe(409);
    const tec = await rolId(api, 'tecnico');
    const r = await api.patch(`/roles/${tec}`).send({ nombre: 'Mecánico' });
    expect(r.body.data).toMatchObject({ codigo: 'tecnico', nombre: 'MECANICO' }); // el código no cambia: la lógica nunca mira el texto
  });

  it('un rol con usuarios activos no se desactiva', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await t.usuario('tecnico');
    const r = await api.patch(`/roles/${await rolId(api, 'tecnico')}`).send({ activo: false });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('usuarios activos');
  });

  it('nadie puede dar (ni quitar) permisos que no tiene: no hay escalada de privilegios', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    // Un rol especial que SÍ puede gestionar roles y usuarios, pero no tiene "suscripcion.cancelar".
    const gestor = (await api.post('/roles').send({ nombre: 'Gestor', permisos: ['roles.ver', 'roles.gestionar', 'usuarios.gestionar', 'equipos.ver', 'colaboradores.ver'] })).body.data;
    const u = await t.usuario('tecnico', 'gestor@taller.test');
    await api.patch(`/usuarios/${u.id}`).send({ roles: [gestor.id] }).expect(200);
    const apiGestor = t.api(await u.token());
    const nuevo = await apiGestor.post('/roles').send({ nombre: 'Espia', permisos: ['suscripcion.cancelar'] });
    expect(nuevo.status).toBe(403);
    // Tampoco se puede dar a alguien un rol que contiene permisos que el gestor no tiene.
    const otro = await t.usuario('tecnico', 'otro@taller.test');
    const rolAdmin = await rolId(api, 'administrador');
    expect((await apiGestor.patch(`/usuarios/${otro.id}`).send({ roles: [rolAdmin] })).status).toBe(403);
    // Y si edita un rol que tiene permisos que él no ve, esos se conservan.
    const mixto = (await api.post('/roles').send({ nombre: 'Mixto', permisos: ['equipos.ver', 'suscripcion.cancelar'] })).body.data;
    await apiGestor.patch(`/roles/${mixto.id}`).send({ permisos: ['equipos.ver', 'colaboradores.ver'] }).expect(200);
    expect((await api.get(`/roles/${mixto.id}`)).body.data.permisos).toEqual(['colaboradores.ver', 'equipos.ver', 'suscripcion.cancelar']);
  });

  it('el catálogo de permisos dice cuáles están disponibles según el plan', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await ejecutar(e.pool, "DELETE FROM empresa_modulos WHERE empresa_id = ? AND modulo_codigo = 'clientes'", [t.empresaId]);
    const permisos = (await api.get('/permisos')).body.data as Array<{ codigo: string; disponible: boolean }>;
    expect(permisos.find((p) => p.codigo === 'clientes.ver')?.disponible).toBe(false);
    expect(permisos.find((p) => p.codigo === 'equipos.ver')?.disponible).toBe(true);
    expect(permisos.find((p) => p.codigo === 'configuracion.ver')?.disponible).toBe(true);
  });
});

describe('configuración y bitácora', () => {
  it('devuelve los valores con su valor de fábrica y valida cada clave', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const r = (await api.get('/configuracion')).body.data;
    expect(r.valores).toMatchObject({ moneda: 'GTQ', zona_horaria: 'America/Guatemala', iva_porcentaje: '12', precios_incluyen_iva: 'false' });
    expect(r.claves.find((c: { clave: string }) => c.clave === 'moneda').opciones).toEqual(['GTQ', 'USD']);
    const ok = await api.patch('/configuracion').send({ nit_empresa: '1234567-8', direccion_empresa: 'Zona 1', iva_porcentaje: 10, precios_incluyen_iva: true, correo_empresa: 'info@taller.test' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.valores).toMatchObject({ nit_empresa: '1234567-8', direccion_empresa: 'ZONA 1', iva_porcentaje: '10', precios_incluyen_iva: 'true', correo_empresa: 'info@taller.test' });
    for (const malo of [{ moneda: 'EUR' }, { iva_porcentaje: 99 }, { zona_horaria: 'Marte/Olimpo' }, { precios_incluyen_iva: 'quizas' }, { correo_empresa: 'no-es' }, { clave_inventada: 'x' }]) {
      expect((await api.patch('/configuracion').send(malo)).status).toBe(400);
    }
  });

  it('cambiar la zona horaria también la actualiza en la plataforma y queda en la bitácora', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await api.patch('/configuracion').send({ zona_horaria: 'America/Mexico_City' }).expect(200);
    expect(await una(e.pool, 'SELECT zona_horaria FROM empresas WHERE id = ?', [t.empresaId])).toMatchObject({ zona_horaria: 'America/Mexico_City' });
    const b = (await api.get('/bitacora?accion=configuracion_editada')).body.data;
    expect(b.total).toBe(1);
    expect(b.registros[0]).toMatchObject({ entidad: 'configuracion', usuario: 'JOSE PEREZ' });
  });

  it('la bitácora lista lo que pasó, con quién lo hizo, filtra y pagina; solo la ve quien tiene permiso', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await api.post('/areas').send({ nombre: 'Pintura' });
    await api.post('/areas').send({ nombre: 'Latoneria' });
    const b = (await api.get('/bitacora?entidad=areas_trabajo')).body.data;
    expect(b.total).toBe(2);
    expect(b.registros.map((r: { accion: string }) => r.accion)).toEqual(['areas_trabajo_creado', 'areas_trabajo_creado']);
    expect(b.registros[0].usuario).toBe('JOSE PEREZ');
    const gerente = await t.usuario('gerente');
    expect((await t.api(await gerente.token()).get('/bitacora')).status).toBe(200);
    const tecnico = await t.usuario('tecnico');
    expect((await t.api(await tecnico.token()).get('/bitacora')).status).toBe(403);
  });

  it('la configuración la edita quien tiene permiso: el gerente la edita, el supervisor no la ve', async () => {
    const t = await tallerDePrueba(e);
    const gerente = await t.usuario('gerente');
    expect((await t.api(await gerente.token()).patch('/configuracion').send({ iva_porcentaje: 12 })).status).toBe(200);
    const sup = await t.usuario('supervisor');
    expect((await t.api(await sup.token()).get('/configuracion')).status).toBe(403);
  });
});
