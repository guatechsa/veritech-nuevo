import { filas } from '../../src/db/consulta';
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

describe('planes y módulos', () => {
  it('nacen los 3 niveles (30 / 60 / 120 USD) y los 13 módulos del producto', async () => {
    const s = await e.usuario('VIEWER');
    const planes = (await e.autorizado(s.token).get('/api/plataforma/planes')).body.data;
    expect(planes.map((p: { codigo: string; precio_mensual: number }) => [p.codigo, p.precio_mensual])).toEqual([
      ['basico', 30],
      ['profesional', 60],
      ['empresarial', 120],
    ]);
    const [basico, profesional, empresarial] = planes;
    expect(basico.modulos).not.toContain('portal_cliente');
    expect(profesional.modulos).toEqual(expect.arrayContaining(['portal_cliente', 'contadores_condicion']));
    expect(empresarial.modulos).toHaveLength(13);
    expect(empresarial.max_usuarios).toBeNull(); // sin límite
    const modulos = (await e.autorizado(s.token).get('/api/plataforma/modulos')).body.data;
    expect(modulos).toHaveLength(13);
  });

  it('el super administrador cambia precio, límites y módulos, y queda en la auditoría', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const [plan] = await filas<{ id: number }>(e.pool, "SELECT id FROM planes WHERE codigo = 'basico'");
    const res = await e.autorizado(s.token).patch(`/api/plataforma/planes/${plan?.id}`).send({ precio_mensual: 35, max_usuarios: 8, max_sucursales: null, modulos: ['ordenes', 'equipos'] });
    expect(res.status).toBe(200);
    const basico = res.body.data.find((p: { codigo: string }) => p.codigo === 'basico');
    expect(basico).toMatchObject({ precio_mensual: 35, max_usuarios: 8, max_sucursales: null });
    expect(basico.modulos.sort()).toEqual(['equipos', 'ordenes']);
    const rastro = await filas<{ descripcion: string }>(e.pool, "SELECT descripcion FROM auditoria_plataforma WHERE accion = 'plan_editado'");
    expect(rastro[0]?.descripcion).toContain('basico');
  });

  it('un módulo desconocido o un precio absurdo se rechazan sin cambiar nada', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const [plan] = await filas<{ id: number }>(e.pool, "SELECT id FROM planes WHERE codigo = 'basico'");
    const api = e.autorizado(s.token);
    expect((await api.patch(`/api/plataforma/planes/${plan?.id}`).send({ precio_mensual: 1, modulos: ['no_existe'] })).status).toBe(400);
    expect((await api.patch(`/api/plataforma/planes/${plan?.id}`).send({ precio_mensual: -1 })).status).toBe(400);
    const [fila] = await filas<{ precio_mensual: number }>(e.pool, 'SELECT precio_mensual FROM planes WHERE id = ?', [plan?.id]);
    expect(fila?.precio_mensual).toBe(30);
    expect((await api.patch('/api/plataforma/planes/9999').send({ precio_mensual: 10 })).status).toBe(404);
  });

  it('cambiar un plan NO cambia los módulos de las empresas que ya lo tienen (cada empresa conserva los suyos)', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const [plan] = await filas<{ id: number }>(e.pool, "SELECT id FROM planes WHERE codigo = 'basico'");
    const empresa = await e.empresa({ plan_id: plan?.id ?? null });
    await e.pool.query("INSERT INTO empresa_modulos (empresa_id, modulo_codigo) VALUES (?, 'inventario')", [empresa]);
    await e.autorizado(s.token).patch(`/api/plataforma/planes/${plan?.id}`).send({ modulos: ['ordenes'] });
    expect((await e.autorizado(s.token).get(`/api/plataforma/empresas/${empresa}`)).body.data.modulos).toEqual(['inventario']);
  });
});
