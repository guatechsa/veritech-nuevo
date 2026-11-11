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

describe('empresas', () => {
  it('el listado trae las columnas del estándar, el plan, los módulos y la cuota total de las activas', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    const [plan] = await filas<{ id: number }>(e.pool, "SELECT id FROM planes WHERE codigo = 'profesional'");
    await e.empresa({ nombre: 'TALLER A', estado: 'activa', cuota: 60, plan_id: plan?.id ?? null });
    await e.empresa({ nombre: 'TALLER B', estado: 'activa', cuota: 30 });
    await e.empresa({ nombre: 'TALLER C', estado: 'suspendida', cuota: 120 });
    const res = await e.autorizado(s.token).get('/api/plataforma/empresas');
    expect(res.status).toBe(200);
    const { empresas, total_modulos, cuota_total_activas } = res.body.data;
    expect(empresas.map((x: { nombre: string }) => x.nombre)).toEqual(['TALLER A', 'TALLER B', 'TALLER C']);
    expect(empresas[0]).toMatchObject({ plan_nombre: 'PROFESIONAL', contacto_correo: 'admin@taller.test', estado: 'activa', cuota_mensual: 60 });
    expect(total_modulos).toBe(13);
    expect(cuota_total_activas).toBe(90); // la suspendida no suma
  });

  it('filtra por estado y busca por nombre, sin que los comodines de LIKE se cuelen', async () => {
    const s = await e.usuario('SUPER_ADMIN');
    await e.empresa({ nombre: 'TALLER LOPEZ', slug: 'lopez' });
    await e.empresa({ nombre: 'TALLER GARCIA', slug: 'garcia', estado: 'suspendida' });
    const api = e.autorizado(s.token);
    expect((await api.get('/api/plataforma/empresas?estado=suspendida')).body.data.empresas).toHaveLength(1);
    expect((await api.get('/api/plataforma/empresas?buscar=lopez')).body.data.empresas).toHaveLength(1);
    expect((await api.get('/api/plataforma/empresas?buscar=%25')).body.data.empresas).toHaveLength(0); // "%" literal, no comodín
    expect((await api.get('/api/plataforma/empresas?estado=inventado')).status).toBe(400);
  });

  it('editar: guarda los cambios, normaliza el texto, reemplaza los módulos y deja rastro', async () => {
    const s = await e.usuario('ADMIN');
    const id = await e.empresa({ nombre: 'VIEJO' });
    const res = await e.autorizado(s.token).patch(`/api/plataforma/empresas/${id}`).send({
      nombre: 'Taller Ñandú',
      contacto_nombre: 'María López',
      cuota_mensual: 45.5,
      cobro_por_contrato: true,
      modulos: ['ordenes', 'equipos'],
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ nombre: 'TALLER NANDU', contacto_nombre: 'MARIA LOPEZ', cuota_mensual: 45.5, cobro_por_contrato: 1, modulos: ['equipos', 'ordenes'] });
    await e.autorizado(s.token).patch(`/api/plataforma/empresas/${id}`).send({ modulos: ['reportes'] });
    expect((await e.autorizado(s.token).get(`/api/plataforma/empresas/${id}`)).body.data.modulos).toEqual(['reportes']);
    const auditoria = await filas<{ descripcion: string; empresa_id: number; usuario_plataforma_id: number }>(e.pool, "SELECT descripcion, empresa_id, usuario_plataforma_id FROM auditoria_plataforma WHERE accion = 'empresa_editada' ORDER BY id");
    expect(auditoria).toHaveLength(2);
    expect(auditoria[0]).toMatchObject({ empresa_id: id, usuario_plataforma_id: s.id });
  });

  it('editar: la cuota puede quedar vacía (se muestra —) y rechaza valores absurdos', async () => {
    const s = await e.usuario('ADMIN');
    const id = await e.empresa({ cuota: 30 });
    const api = e.autorizado(s.token);
    expect((await api.patch(`/api/plataforma/empresas/${id}`).send({ cuota_mensual: null })).body.data.cuota_mensual).toBeNull();
    expect((await api.patch(`/api/plataforma/empresas/${id}`).send({ cuota_mensual: -5 })).status).toBe(400);
    expect((await api.patch(`/api/plataforma/empresas/${id}`).send({ contacto_correo: 'no-es-correo' })).status).toBe(400);
  });

  it('editar: un plan o módulo que no existe responde 400 y NO cambia nada', async () => {
    const s = await e.usuario('ADMIN');
    const id = await e.empresa({ nombre: 'INTACTO' });
    const api = e.autorizado(s.token);
    expect((await api.patch(`/api/plataforma/empresas/${id}`).send({ nombre: 'CAMBIADO', plan_id: 9999 })).status).toBe(400);
    expect((await api.patch(`/api/plataforma/empresas/${id}`).send({ nombre: 'CAMBIADO', modulos: ['no_existe'] })).status).toBe(400);
    expect((await api.get(`/api/plataforma/empresas/${id}`)).body.data.nombre).toBe('INTACTO');
    expect((await api.patch('/api/plataforma/empresas/99999').send({ nombre: 'X' })).status).toBe(404);
  });

  it('suspender y reactivar: solo desde los estados que corresponden, y se audita con el motivo', async () => {
    const s = await e.usuario('ADMIN');
    const api = e.autorizado(s.token);
    const activa = await e.empresa({ estado: 'activa' });
    const cerrada = await e.empresa({ estado: 'cerrada' });
    const pendiente = await e.empresa({ estado: 'pendiente' });

    expect((await api.post(`/api/plataforma/empresas/${activa}/estado`).send({ estado: 'suspendida', motivo: 'Falta de pago' })).body.data.estado).toBe('suspendida');
    expect((await api.post(`/api/plataforma/empresas/${activa}/estado`).send({ estado: 'suspendida' })).status).toBe(409); // ya suspendida
    expect((await api.post(`/api/plataforma/empresas/${cerrada}/estado`).send({ estado: 'suspendida' })).status).toBe(409);
    expect((await api.post(`/api/plataforma/empresas/${pendiente}/estado`).send({ estado: 'activa' })).status).toBe(409); // solo se reactiva lo suspendido
    expect((await api.post(`/api/plataforma/empresas/${activa}/estado`).send({ estado: 'activa' })).body.data.estado).toBe('activa');
    expect((await api.post(`/api/plataforma/empresas/${activa}/estado`).send({ estado: 'cualquiera' })).status).toBe(400);

    const rastro = await filas<{ accion: string; descripcion: string }>(e.pool, 'SELECT accion, descripcion FROM auditoria_plataforma WHERE empresa_id = ? ORDER BY id', [activa]);
    expect(rastro.map((r) => r.accion)).toEqual(['empresa_suspendida', 'empresa_activada']);
    expect(rastro[0]?.descripcion).toContain('Falta de pago');
  });
});
