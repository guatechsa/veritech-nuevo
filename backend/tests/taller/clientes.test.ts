import { ejecutar } from '../../src/db/consulta';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { tallerDePrueba, TallerDePrueba } from './ayuda';

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
type Api = Awaited<ReturnType<typeof admin>>;
const nuevo = (api: Api, cambios: Record<string, unknown> = {}) => api.post('/clientes').send({ nombre: 'Industrias Lopez', ...cambios });

describe('clientes', () => {
  it('crea con el texto normalizado (§5), correo tal cual, tipo "GENERAL" por defecto y contado', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const r = await nuevo(api, { nombre: 'Industrias Ñandú López', nit: '1234567-8', email: 'Compras@Lopez.test', telefono: '2222 3333', direccion: 'Zona 4, Guatemala', contacto_nombre: 'María Pérez', notas: 'Cliente de prueba\nsegunda línea' });
    expect(r.status).toBe(201);
    expect(r.body.data.cliente).toMatchObject({
      nombre: 'INDUSTRIAS NANDU LOPEZ',
      nit: '1234567-8',
      email: 'Compras@Lopez.test',
      contacto_nombre: 'MARIA PEREZ',
      direccion: 'ZONA 4, GUATEMALA',
      notas: 'CLIENTE DE PRUEBA\nSEGUNDA LINEA',
      tipo_cliente: 'GENERAL',
      condicion_pago: 'contado',
      dias_credito: 0,
      activo: 1,
    });
    expect(r.body.data.avisos).toEqual([]);
  });

  it('el NIT es único, pero "CF" (consumidor final) lo pueden tener muchos; "c/f" y "C.F." también son CF', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = (await nuevo(api, { nit: '555-5' })).body.data.cliente;
    const repetido = await nuevo(api, { nombre: 'Otro', nit: '555-5' });
    expect(repetido.status).toBe(409);
    expect(repetido.body.codigo).toBe('NIT_REPETIDO');
    expect(repetido.body.error).toContain('INDUSTRIAS LOPEZ');
    expect(repetido.body.detalle.cliente).toEqual({ id: a.id, nombre: 'INDUSTRIAS LOPEZ' }); // se ofrece abrir el cliente que ya lo tiene
    for (const [i, cf] of ['CF', 'c/f', 'C.F.', 'cf'].entries()) {
      const r = await nuevo(api, { nombre: `Final ${i}`, nit: cf });
      expect(r.status).toBe(201);
      expect(r.body.data.cliente.nit).toBe('CF');
    }
    // Sin NIT, también muchos.
    await nuevo(api, { nombre: 'Sin NIT 1' }).then((r) => expect(r.status).toBe(201));
    await nuevo(api, { nombre: 'Sin NIT 2' }).then((r) => expect(r.status).toBe(201));
  });

  it('un NIT repetido por escribirlo distinto (espacios, minúsculas) también se detecta', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await nuevo(api, { nit: 'ab 123' });
    expect((await nuevo(api, { nombre: 'Otro', nit: 'AB123' })).status).toBe(409);
  });

  it('editar: no choca con su propio NIT, sí con el de otro; y quitar el NIT está permitido', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = (await nuevo(api, { nit: '111-1' })).body.data.cliente;
    const b = (await nuevo(api, { nombre: 'Segundo', nit: '222-2' })).body.data.cliente;
    expect((await api.patch(`/clientes/${a.id}`).send({ nit: '111-1', telefono: '5555' })).status).toBe(200);
    const choque = await api.patch(`/clientes/${b.id}`).send({ nit: '111-1' });
    expect(choque.status).toBe(409);
    expect(choque.body.detalle.cliente.id).toBe(a.id);
    expect((await api.patch(`/clientes/${b.id}`).send({ nit: null })).body.data.cliente.nit).toBeNull();
  });

  it('avisa (sin bloquear) si el correo o el teléfono ya los tiene otro cliente', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = (await nuevo(api, { email: 'info@x.test', telefono: '7777' })).body.data.cliente;
    const r = await nuevo(api, { nombre: 'Parecido', email: 'info@x.test', telefono: '7777' });
    expect(r.status).toBe(201);
    expect(r.body.data.avisos).toEqual(expect.arrayContaining([{ campo: 'email', cliente: { id: a.id, nombre: 'INDUSTRIAS LOPEZ' } }, { campo: 'telefono', cliente: { id: a.id, nombre: 'INDUSTRIAS LOPEZ' } }]));
    const ed = await api.patch(`/clientes/${r.body.data.cliente.id}`).send({ direccion: 'otra' });
    expect(ed.body.data.avisos).toHaveLength(2); // el aviso sigue mientras sigan repetidos
  });

  it('el crédito: exige días; contado los pone en cero; el límite no puede ser negativo', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    expect((await nuevo(api, { condicion_pago: 'credito' })).status).toBe(400);
    const c = (await nuevo(api, { condicion_pago: 'credito', dias_credito: 30, limite_credito: 5000 })).body.data.cliente;
    expect(c).toMatchObject({ condicion_pago: 'credito', dias_credito: 30, limite_credito: 5000 });
    const ed = await api.patch(`/clientes/${c.id}`).send({ condicion_pago: 'contado' });
    expect(ed.body.data.cliente).toMatchObject({ condicion_pago: 'contado', dias_credito: 0 });
    expect((await nuevo(api, { nombre: 'Negativo', limite_credito: -1 })).status).toBe(400);
  });

  it.each([
    ['sin nombre', { nombre: '' }],
    ['con un correo inválido', { email: 'no-es-correo' }],
    ['con un tipo que no existe', { tipo_cliente_id: 9999 }],
    ['con días de crédito imposibles', { condicion_pago: 'credito', dias_credito: 4000 }],
  ])('rechaza un cliente %s', async (_n, cambios) => {
    const t = await tallerDePrueba(e);
    expect((await nuevo(await admin(t), cambios)).status).toBe(400);
  });

  it('lista con búsqueda por nombre, NIT, correo o teléfono, filtro por estado y paginación', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await nuevo(api, { nombre: 'Alfa', nit: '1-1', email: 'alfa@x.test', telefono: '1111' });
    const b = (await nuevo(api, { nombre: 'Beta', nit: '2-2', email: 'beta@x.test', telefono: '2222' })).body.data.cliente;
    await api.post(`/clientes/${b.id}/estado`).send({ activo: false }).expect(200);
    const todos = (await api.get('/clientes')).body.data;
    expect(todos.total).toBe(2);
    expect(todos.registros.map((c: { nombre: string }) => c.nombre)).toEqual(['ALFA', 'BETA']);
    expect((await api.get('/clientes?activo=true')).body.data.total).toBe(1);
    expect((await api.get('/clientes?activo=false')).body.data.registros[0].nombre).toBe('BETA');
    for (const q of ['alfa', '1-1', 'alfa@x', '1111']) expect((await api.get(`/clientes?buscar=${q}`)).body.data.total).toBe(1);
    expect((await api.get('/clientes?pagina=2')).body.data.registros).toHaveLength(0);
  });

  it('desactivar y reactivar; borrar solo si nunca se usó (y se llevan sus contactos y departamentos)', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const c = (await nuevo(api)).body.data.cliente;
    await api.post(`/clientes/${c.id}/departamentos`).send({ nombre: 'Produccion' }).expect(201);
    await api.post(`/clientes/${c.id}/contactos`).send({ nombre: 'Juan' }).expect(201);
    expect((await api.post(`/clientes/${c.id}/estado`).send({ activo: false })).body.data.activo).toBe(0);
    expect((await api.post(`/clientes/${c.id}/estado`).send({ activo: true })).body.data.activo).toBe(1);
    await api.delete(`/clientes/${c.id}`).expect(200);
    expect((await api.get(`/clientes/${c.id}`)).status).toBe(404);
    const huerfanos = await t.sql(async (con) => (await con.query('SELECT (SELECT COUNT(*) FROM departamentos) d, (SELECT COUNT(*) FROM contactos_cliente) c'))[0] as Array<{ d: number; c: number }>);
    expect(huerfanos[0]).toMatchObject({ d: 0, c: 0 });
    expect((await api.delete('/clientes/99999')).status).toBe(404);
  });

  it('los departamentos son del cliente: nombre único dentro de él, y no se pueden tocar desde otro cliente', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = (await nuevo(api)).body.data.cliente;
    const b = (await nuevo(api, { nombre: 'Otro cliente' })).body.data.cliente;
    const r = await api.post(`/clientes/${a.id}/departamentos`).send({ nombre: 'Empaque' });
    const dep = r.body.data.departamentos[0];
    expect(dep.nombre).toBe('EMPAQUE');
    expect((await api.post(`/clientes/${a.id}/departamentos`).send({ nombre: 'empaque' })).status).toBe(409);
    await api.post(`/clientes/${b.id}/departamentos`).send({ nombre: 'Empaque' }).expect(201); // en otro cliente, sí
    // Intentar editar el departamento de A como si fuera de B: no existe ahí.
    expect((await api.patch(`/clientes/${b.id}/departamentos/${dep.id}`).send({ nombre: 'Hackeado' })).status).toBe(404);
    expect((await api.patch(`/clientes/${a.id}/departamentos/${dep.id}`).send({ activo: false })).body.data.departamentos[0].activo).toBe(0);
    expect((await api.post('/clientes/99999/departamentos').send({ nombre: 'X' })).status).toBe(404);
  });

  it('los contactos: rol, acceso a todos los equipos, y solo se editan dentro de su cliente', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = (await nuevo(api)).body.data.cliente;
    const b = (await nuevo(api, { nombre: 'Otro' })).body.data.cliente;
    const r = await api.post(`/clientes/${a.id}/contactos`).send({ nombre: 'Ana Gómez', correo: 'Ana@X.test', telefono: '5555', rol: 'aprobador', acceso_todos_equipos: false });
    const c = r.body.data.contactos[0];
    expect(c).toMatchObject({ nombre: 'ANA GOMEZ', correo: 'Ana@X.test', rol: 'aprobador', acceso_todos_equipos: 0, activo: 1 });
    expect((await api.post(`/clientes/${a.id}/contactos`).send({ nombre: 'Mala', rol: 'jefe' })).status).toBe(400);
    expect((await api.patch(`/clientes/${b.id}/contactos/${c.id}`).send({ nombre: 'Robada' })).status).toBe(404);
    const ed = await api.patch(`/clientes/${a.id}/contactos/${c.id}`).send({ rol: 'piloto', acceso_todos_equipos: true, activo: false });
    expect(ed.body.data.contactos[0]).toMatchObject({ rol: 'piloto', acceso_todos_equipos: 1, activo: 0 });
  });

  it('permisos: recepción crea y edita pero no desactiva ni borra; el visualizador solo mira; el técnico solo ve', async () => {
    const t = await tallerDePrueba(e);
    const c = (await nuevo(await admin(t))).body.data.cliente;
    const recep = t.api(await (await t.usuario('recepcionista')).token());
    expect((await recep.post('/clientes').send({ nombre: 'Creado en recepcion' })).status).toBe(201);
    expect((await recep.patch(`/clientes/${c.id}`).send({ telefono: '9999' })).status).toBe(200);
    expect((await recep.post(`/clientes/${c.id}/estado`).send({ activo: false })).status).toBe(403);
    expect((await recep.delete(`/clientes/${c.id}`)).status).toBe(403);
    const vis = t.api(await (await t.usuario('visualizador')).token());
    expect((await vis.get('/clientes')).status).toBe(200);
    expect((await vis.post('/clientes').send({ nombre: 'No' })).status).toBe(403);
    const tec = t.api(await (await t.usuario('tecnico')).token());
    expect((await tec.get(`/clientes/${c.id}`)).status).toBe(200);
    expect((await tec.patch(`/clientes/${c.id}`).send({ telefono: '1' })).status).toBe(403);
  });

  it('sin el módulo de clientes en el plan, no hay acceso a clientes ni a proveedores', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await ejecutar(e.pool, "DELETE FROM empresa_modulos WHERE empresa_id = ? AND modulo_codigo = 'clientes'", [t.empresaId]);
    expect((await api.get('/clientes')).status).toBe(403);
    expect((await api.get('/proveedores')).status).toBe(403);
  });

  it('deja bitácora de lo que se hace con clientes (sin guardar datos de más)', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const c = (await nuevo(api, { nit: '9-9' })).body.data.cliente;
    await api.patch(`/clientes/${c.id}`).send({ telefono: '123' });
    await api.post(`/clientes/${c.id}/estado`).send({ activo: false });
    const b = (await api.get('/bitacora?entidad=clientes')).body.data;
    expect(b.registros.map((r: { accion: string }) => r.accion)).toEqual(['cliente_desactivado', 'cliente_editado', 'cliente_creado']);
  });
});

describe('tipos de cliente', () => {
  it('viene "GENERAL"; los descuentos son porcentajes de 0 a 100; el tipo se asigna al cliente', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    expect((await api.get('/tipos-cliente')).body.data.map((x: { nombre: string }) => x.nombre)).toEqual(['GENERAL']);
    const mayorista = (await api.post('/tipos-cliente').send({ nombre: 'Mayorista', descuento_trabajos: 10, descuento_materiales: 5.5 })).body.data;
    expect(mayorista).toMatchObject({ nombre: 'MAYORISTA', descuento_trabajos: 10, descuento_materiales: 5.5, descuento_otros: 0 });
    expect((await api.post('/tipos-cliente').send({ nombre: 'Imposible', descuento_trabajos: 101 })).status).toBe(400);
    expect((await api.post('/tipos-cliente').send({ nombre: 'Negativo', descuento_otros: -1 })).status).toBe(400);
    expect((await api.post('/tipos-cliente').send({ nombre: 'mayorista' })).status).toBe(409);
    const c = (await nuevo(api, { tipo_cliente_id: mayorista.id })).body.data.cliente;
    expect(c.tipo_cliente).toBe('MAYORISTA');
    await api.patch(`/tipos-cliente/${mayorista.id}`).send({ activo: false }).expect(200);
    expect((await nuevo(api, { nombre: 'Con tipo apagado', tipo_cliente_id: mayorista.id })).status).toBe(400);
  });

  it('solo quien puede editar la configuración cambia los tipos', async () => {
    const t = await tallerDePrueba(e);
    const recep = t.api(await (await t.usuario('recepcionista')).token());
    expect((await recep.get('/tipos-cliente')).status).toBe(200);
    expect((await recep.post('/tipos-cliente').send({ nombre: 'No' })).status).toBe(403);
  });
});

describe('proveedores', () => {
  it('crea con el texto normalizado, nombre único y condición de pago', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const r = await api.post('/proveedores').send({ nombre: 'Repuestos Ñoño', nit: '77-7', contacto_nombre: 'Luis Gómez', contacto_email: 'Luis@Rep.test', condicion_pago: 'credito', dias_credito: 15, notas: 'entrega rápida' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ nombre: 'REPUESTOS NONO', nit: '77-7', contacto_nombre: 'LUIS GOMEZ', contacto_email: 'Luis@Rep.test', condicion_pago: 'credito', dias_credito: 15, notas: 'ENTREGA RAPIDA', activo: 1 });
    expect((await api.post('/proveedores').send({ nombre: 'repuestos nono' })).status).toBe(409);
    expect((await api.post('/proveedores').send({ nombre: 'A credito sin dias', condicion_pago: 'credito' })).status).toBe(400);
  });

  it('lista con búsqueda y estado; editar; desactivar exige el permiso de desactivar', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = (await api.post('/proveedores').send({ nombre: 'Alfa', nit: '1-1', contacto_nombre: 'Pedro' })).body.data;
    await api.post('/proveedores').send({ nombre: 'Beta' }).expect(201);
    expect((await api.get('/proveedores?buscar=pedro')).body.data.total).toBe(1);
    expect((await api.get('/proveedores')).body.data.registros.map((p: { nombre: string }) => p.nombre)).toEqual(['ALFA', 'BETA']);
    expect((await api.patch(`/proveedores/${a.id}`).send({ direccion: 'zona 1', condicion_pago: 'contado' })).body.data.direccion).toBe('ZONA 1');
    await api.patch(`/proveedores/${a.id}`).send({ activo: false }).expect(200);
    expect((await api.get('/proveedores?activo=true')).body.data.total).toBe(1);
    // El gerente edita pero no desactiva (no tiene el permiso en el rol de fábrica? sí lo tiene: probamos con recepción).
    const recep = t.api(await (await t.usuario('recepcionista')).token());
    expect((await recep.get('/proveedores')).status).toBe(200);
    expect((await recep.post('/proveedores').send({ nombre: 'Gamma' })).status).toBe(403);
    const gerente = t.api(await (await t.usuario('gerente')).token());
    expect((await gerente.patch(`/proveedores/${a.id}`).send({ activo: true })).status).toBe(200);
  });

  it('un rol con "editar" pero sin "desactivar" no puede cambiar el estado de un proveedor', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const rol = (await api.post('/roles').send({ nombre: 'Editor de proveedores', permisos: ['proveedores.ver', 'proveedores.editar'] })).body.data;
    const u = await t.usuario('tecnico', 'editor@taller.test');
    await api.patch(`/usuarios/${u.id}`).send({ roles: [rol.id] }).expect(200);
    const editor = t.api(await u.token());
    const p = (await api.post('/proveedores').send({ nombre: 'Delta' })).body.data;
    expect((await editor.patch(`/proveedores/${p.id}`).send({ direccion: 'x' })).status).toBe(200);
    expect((await editor.patch(`/proveedores/${p.id}`).send({ activo: false })).status).toBe(403);
  });
});
