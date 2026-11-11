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
const bitacoraDe = (t: TallerDePrueba, accion: string) => t.sql(async (con) => (await con.query('SELECT * FROM bitacora WHERE accion = ?', [accion]))[0] as Array<Record<string, unknown>>);

describe('sucursales', () => {
  it('crea y edita normalizando el texto (§5) y deja bitácora', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const r = await api.post('/sucursales').send({ nombre: 'Zona 10 Guatemala', direccion: 'Avenida Reforma 12-34', telefono: '2222 3333' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ nombre: 'ZONA 10 GUATEMALA', direccion: 'AVENIDA REFORMA 12-34', es_principal: 0, activo: 1 });
    const e2 = await api.patch(`/sucursales/${r.body.data.id}`).send({ nombre: 'Zona 10', cupo_diario_citas: 8 });
    expect(e2.body.data).toMatchObject({ nombre: 'ZONA 10', cupo_diario_citas: 8 });
    expect(await bitacoraDe(t, 'sucursal_creada')).toHaveLength(1);
    expect(await bitacoraDe(t, 'sucursal_editada')).toHaveLength(1);
  });

  it('dos sucursales no pueden llamarse igual', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await api.post('/sucursales').send({ nombre: 'Norte' }).expect(201);
    const r = await api.post('/sucursales').send({ nombre: 'norte' });
    expect(r.status).toBe(409);
  });

  it('el plan limita las sucursales activas y el mensaje dice cuántas permite', async () => {
    const t = await tallerDePrueba(e, { plan_codigo: 'basico' }); // 1 sucursal
    const api = await admin(t);
    const r = await api.post('/sucursales').send({ nombre: 'Otra' });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('LIMITE_DEL_PLAN');
    expect(r.body.error).toContain('1 sucursal');
  });

  it('con plan Profesional (3): tres sí, la cuarta no, y desactivar una libera el cupo', async () => {
    const t = await tallerDePrueba(e, { plan_codigo: 'profesional' });
    const api = await admin(t);
    const a = await api.post('/sucursales').send({ nombre: 'A' });
    await api.post('/sucursales').send({ nombre: 'B' }).expect(201);
    expect((await api.post('/sucursales').send({ nombre: 'C' })).status).toBe(409);
    await api.patch(`/sucursales/${a.body.data.id}`).send({ activo: false }).expect(200);
    await api.post('/sucursales').send({ nombre: 'C' }).expect(201);
    // Reactivar la desactivada ahora excede el límite.
    expect((await api.patch(`/sucursales/${a.body.data.id}`).send({ activo: true })).status).toBe(409);
  });

  it('dos altas a la vez no se pasan del límite del plan', async () => {
    const t = await tallerDePrueba(e, { plan_codigo: 'profesional' });
    const api = await admin(t);
    const r = await Promise.all([1, 2, 3, 4, 5].map((i) => api.post('/sucursales').send({ nombre: `Carrera ${i}` })));
    expect(r.filter((x) => x.status === 201)).toHaveLength(2); // la principal ya ocupa 1 de 3
    const activas = (await api.get('/sucursales')).body.data;
    expect(activas).toHaveLength(3);
  });

  it('la sucursal principal: se puede cambiar, pero no desactivar ni quedarse sin ella', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const lista = (await api.get('/sucursales')).body.data;
    const principal = lista[0];
    expect(principal.es_principal).toBe(1);
    expect((await api.patch(`/sucursales/${principal.id}`).send({ activo: false })).status).toBe(409);
    expect((await api.patch(`/sucursales/${principal.id}`).send({ es_principal: false })).status).toBe(409);
    const nueva = (await api.post('/sucursales').send({ nombre: 'Nueva' })).body.data;
    await api.patch(`/sucursales/${nueva.id}`).send({ es_principal: true }).expect(200);
    const despues = (await api.get('/sucursales')).body.data;
    expect(despues.filter((s: { es_principal: number }) => s.es_principal === 1)).toHaveLength(1);
    expect(despues[0].id).toBe(nueva.id);
    // La anterior ya no es principal, pero el administrador trabaja en ella: antes hay que moverlo.
    const r = await api.patch(`/sucursales/${principal.id}`).send({ activo: false });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('colaboradores activos');
  });

  it('no se desactiva una sucursal con colaboradores o bodegas activos', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const s = (await api.post('/sucursales').send({ nombre: 'Con gente' })).body.data;
    const puestos = (await api.get('/puestos')).body.data;
    const c = await api.post('/colaboradores').send({ nombre_completo: 'Persona Uno', puestos: [puestos[0].id], sucursal_id: s.id });
    expect(c.status).toBe(201);
    const r = await api.patch(`/sucursales/${s.id}`).send({ activo: false });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('colaboradores activos');
    await api.post(`/colaboradores/${c.body.data.id}/estado`).send({ activo: false }).expect(200);
    await api.post('/bodegas').send({ nombre: 'Central', sucursal_id: s.id }).expect(201);
    expect((await api.patch(`/sucursales/${s.id}`).send({ activo: false })).body.error).toContain('bodegas activas');
  });

  it('exige el permiso: el recepcionista ve pero no gestiona', async () => {
    const t = await tallerDePrueba(e);
    const u = await t.usuario('recepcionista');
    const api = t.api(await u.token());
    expect((await api.get('/sucursales')).status).toBe(200);
    expect((await api.post('/sucursales').send({ nombre: 'X' })).status).toBe(403);
  });
});

describe('áreas y bodegas', () => {
  it('áreas: crear, no repetir, desactivar y listar solo las activas por defecto', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = (await api.post('/areas').send({ nombre: 'Mecánica general' })).body.data;
    expect(a.nombre).toBe('MECANICA GENERAL');
    expect((await api.post('/areas').send({ nombre: 'mecanica general' })).status).toBe(409);
    await api.patch(`/areas/${a.id}`).send({ activo: false }).expect(200);
    expect((await api.get('/areas')).body.data).toHaveLength(0);
    expect((await api.get('/areas?inactivos=true')).body.data).toHaveLength(1);
  });

  it('bodegas: van en una sucursal activa, el nombre es único por sucursal y se pueden mover', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const s1 = (await api.get('/sucursales')).body.data[0];
    const s2 = (await api.post('/sucursales').send({ nombre: 'Segunda' })).body.data;
    const b = (await api.post('/bodegas').send({ nombre: 'Repuestos', sucursal_id: s1.id })).body.data;
    expect(b).toMatchObject({ nombre: 'REPUESTOS', sucursal: s1.nombre });
    expect((await api.post('/bodegas').send({ nombre: 'repuestos', sucursal_id: s1.id })).status).toBe(409);
    await api.post('/bodegas').send({ nombre: 'Repuestos', sucursal_id: s2.id }).expect(201); // otra sucursal, mismo nombre: sí
    expect((await api.post('/bodegas').send({ nombre: 'X', sucursal_id: 99999 })).status).toBe(400);
    const movida = await api.patch(`/bodegas/${b.id}`).send({ nombre: 'Principal' });
    expect(movida.body.data.nombre).toBe('PRINCIPAL');
  });

  it('las bodegas pertenecen al módulo de inventario: sin él, no hay permiso', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    expect((await api.get('/bodegas')).status).toBe(200);
    const { ejecutar } = await import('../../src/db/consulta');
    await ejecutar(e.pool, "DELETE FROM empresa_modulos WHERE empresa_id = ? AND modulo_codigo = 'inventario'", [t.empresaId]);
    expect((await api.get('/bodegas')).status).toBe(403);
  });
});

describe('puestos, credenciales y niveles', () => {
  it('viene sembrado con los puestos de fábrica y el técnico es técnico', async () => {
    const t = await tallerDePrueba(e);
    const puestos = (await (await admin(t)).get('/puestos')).body.data as Array<{ nombre: string; es_tecnico: number; es_operador: number }>;
    expect(puestos.map((p) => p.nombre)).toEqual(expect.arrayContaining(['TECNICO', 'OPERADOR', 'RECEPCIONISTA', 'ADMINISTRADOR']));
    expect(puestos.find((p) => p.nombre === 'TECNICO')?.es_tecnico).toBe(1);
    expect(puestos.find((p) => p.nombre === 'OPERADOR')?.es_operador).toBe(1);
  });

  it('un puesto exige las credenciales que se le asignen (licencia, certificado interno…)', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const licencia = (await api.post('/tipos-credencial').send({ nombre: 'Licencia tipo C', requiere_vencimiento: true, dias_aviso: 45 })).body.data;
    const certificado = (await api.post('/tipos-credencial').send({ nombre: 'Certificado montacargas' })).body.data;
    expect(licencia).toMatchObject({ nombre: 'LICENCIA TIPO C', requiere_vencimiento: 1, dias_aviso: 45 });
    const operador = (await api.get('/puestos')).body.data.find((p: { nombre: string }) => p.nombre === 'OPERADOR');
    const r = await api.put(`/puestos/${operador.id}/credenciales`).send({ credenciales: [{ tipo_credencial_id: licencia.id, obligatoria: true }, { tipo_credencial_id: certificado.id, obligatoria: false }] });
    expect(r.status).toBe(200);
    expect(r.body.data.credenciales).toHaveLength(2);
    expect((await api.put(`/puestos/${operador.id}/credenciales`).send({ credenciales: [{ tipo_credencial_id: 99999, obligatoria: true }] })).status).toBe(400);
  });

  it('puestos nuevos: crear, nombre único, banderas de técnico y operador', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const p = await api.post('/puestos').send({ nombre: 'Soldador', es_tecnico: true });
    expect(p.status).toBe(201);
    expect(p.body.data).toMatchObject({ nombre: 'SOLDADOR', es_tecnico: 1, es_operador: 0 });
    expect((await api.post('/puestos').send({ nombre: 'soldador' })).status).toBe(409);
  });

  it('niveles de técnico: cada empresa define los suyos; no se borra uno que tienen colaboradores', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const niveles = (await api.get('/niveles-tecnico')).body.data;
    expect(niveles.map((n: { codigo: string }) => n.codigo)).toEqual(['N1', 'N2', 'N3']);
    const n4 = (await api.post('/niveles-tecnico').send({ codigo: 'senior', nombre: 'Maestro', orden: 4 })).body.data;
    expect(n4).toMatchObject({ codigo: 'SENIOR', nombre: 'MAESTRO' });
    expect((await api.post('/niveles-tecnico').send({ codigo: 'SENIOR', nombre: 'Otro' })).status).toBe(409);
    const tecnico = (await api.get('/puestos')).body.data.find((p: { nombre: string }) => p.nombre === 'TECNICO');
    await api.post('/colaboradores').send({ nombre_completo: 'Tecnico Uno', puestos: [tecnico.id], nivel_tecnico_id: n4.id }).expect(201);
    const r = await api.delete(`/niveles-tecnico/${n4.id}`);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('tienen colaboradores');
    await api.delete(`/niveles-tecnico/${niveles[2].id}`).expect(200); // N3 no lo usa nadie
  });
});
