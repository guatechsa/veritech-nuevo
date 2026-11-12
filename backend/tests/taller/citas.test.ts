import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { admin, dia, mundo, Mundo, nueva, ordenId } from './ayuda-ordenes';
import { utcDeLocal } from '../../src/utils/zona';

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

const cita = (m: Mundo, cuerpo: Record<string, unknown> = {}) => m.api.post('/citas').send({ equipo_id: m.equipo, fecha: dia(1), hora: '14:30', notas: 'servicio de 10 mil', ...cuerpo });
const motivoCancelacion = async (m: Mundo): Promise<number> => ((await m.api.get('/citas-opciones')).body.data.motivos_cancelacion as Array<{ id: number }>)[0]!.id;

describe('crear y reprogramar citas', () => {
  it('se agenda con el día y la hora DEL TALLER y se guarda en UTC', async () => {
    const m = await mundo(e);
    const r = await cita(m);
    expect(r.status).toBe(201);
    expect(r.body.data.cita).toMatchObject({ fecha: dia(1), hora: '14:30', estado: 'programada', origen: 'recepcion', horas_estimadas: 1, cliente: 'INDUSTRIAS LOPEZ', notas: 'SERVICIO DE 10 MIL', ya_paso: false });
    expect(r.body.data.cita.equipo).toContain('CAM-1');
    const fila = await m.t.sql(async (c) => (await c.query('SELECT fecha_hora FROM citas'))[0] as Array<{ fecha_hora: Date }>);
    expect(fila[0]!.fecha_hora.toISOString()).toBe(utcDeLocal(dia(1), '14:30', 'America/Guatemala').toISOString());
    expect(r.body.data.avisos).toEqual([]);
  });

  it('rechaza lo que no corresponde: fecha pasada, hora mala, equipo inexistente o dado de baja', async () => {
    const m = await mundo(e);
    expect((await cita(m, { fecha: dia(-1) })).status).toBe(400);
    expect((await cita(m, { hora: '25:99' })).status).toBe(400);
    expect((await cita(m, { fecha: '2026-02-31' })).status).toBe(400);
    expect((await cita(m, { equipo_id: 99999 })).status).toBe(400);
    expect((await cita(m, { horas_estimadas: 100 })).status).toBe(400);
    expect((await cita(m, { fecha: dia(0), hora: '23:59' })).status).toBe(201); // hoy sí
    await m.api.post(`/equipos/${m.equipo}/estado`).send({ estado: 'baja', motivo: 'vendido' }); // tiene cita programada: la baja no pide órdenes
    expect((await cita(m)).status).toBe(409);
  });

  it('el cupo diario de la sucursal: en «solo coordinar» avisa; en «reservar» rechaza; las canceladas no cuentan', async () => {
    const m = await mundo(e);
    await m.t.sql(async (c) => c.query('UPDATE sucursales SET cupo_diario_citas = 1'));
    expect((await cita(m)).body.data.avisos).toEqual([]);
    const segunda = await cita(m, { hora: '16:00' });
    expect(segunda.status).toBe(201);
    expect(segunda.body.data.avisos.map((a: { tipo: string }) => a.tipo)).toContain('cupo_lleno');

    expect((await m.api.patch('/configuracion').send({ modo_citas: 'RESERVAR' })).status).toBe(200);
    const bloqueada = await cita(m, { hora: '17:00' });
    expect(bloqueada.status).toBe(409);
    expect(bloqueada.body.codigo).toBe('SIN_CUPO');
    expect((await cita(m, { fecha: dia(2) })).status).toBe(201); // otro día
    // Cancelar una libera el lugar.
    const id1 = (await m.api.get(`/citas?desde=${dia(1)}&hasta=${dia(1)}`)).body.data.registros[0].id as number;
    await m.api.post(`/citas/${id1}/cancelar`).send({ motivo_id: await motivoCancelacion(m) });
    const id2 = (await m.api.get(`/citas?desde=${dia(1)}&hasta=${dia(1)}&estado=programada`)).body.data.registros[0].id as number;
    await m.api.post(`/citas/${id2}/cancelar`).send({ motivo_id: await motivoCancelacion(m) });
    expect((await cita(m, { hora: '17:00' })).status).toBe(201);
  });

  it('avisa si el mismo equipo ya tiene otra cita ese día', async () => {
    const m = await mundo(e);
    await cita(m);
    const r = await cita(m, { hora: '09:00' });
    expect(r.status).toBe(201);
    expect(r.body.data.avisos.map((a: { tipo: string }) => a.tipo)).toEqual(['ya_tiene_cita']);
  });

  it('reprogramar cambia el día y la hora; solo una cita programada se puede tocar', async () => {
    const m = await mundo(e);
    const id = (await cita(m)).body.data.cita.id as number;
    const r = await m.api.patch(`/citas/${id}`).send({ fecha: dia(3), hora: '08:15', horas_estimadas: 2.5 });
    expect(r.status).toBe(200);
    expect(r.body.data.cita).toMatchObject({ fecha: dia(3), hora: '08:15', horas_estimadas: 2.5 });
    expect((await m.api.patch(`/citas/${id}`).send({ fecha: dia(-2) })).status).toBe(400);
    expect((await m.api.patch(`/citas/${id}`).send({ notas: 'otra nota' })).body.data.cita.notas).toBe('OTRA NOTA');
    await m.api.post(`/citas/${id}/cancelar`).send({ motivo_id: await motivoCancelacion(m) });
    expect((await m.api.patch(`/citas/${id}`).send({ hora: '10:00' })).status).toBe(409);
  });
});

describe('cancelar, no se presentó y recibir', () => {
  it('cancelar pide un motivo de la lista; una cancelada no se vuelve a cancelar ni a recibir', async () => {
    const m = await mundo(e);
    const id = (await cita(m)).body.data.cita.id as number;
    expect((await m.api.post(`/citas/${id}/cancelar`).send({})).status).toBe(400);
    expect((await m.api.post(`/citas/${id}/cancelar`).send({ motivo_id: 99999 })).status).toBe(400);
    const r = await m.api.post(`/citas/${id}/cancelar`).send({ motivo_id: await motivoCancelacion(m), texto: 'se enfermó el conductor' });
    expect(r.body.data).toMatchObject({ estado: 'cancelada', motivo_cancelacion_texto: 'SE ENFERMO EL CONDUCTOR' });
    expect(r.body.data.motivo_cancelacion).toBeTruthy();
    expect((await m.api.post(`/citas/${id}/cancelar`).send({ motivo_id: await motivoCancelacion(m) })).status).toBe(409);
    expect((await m.api.post(`/citas/${id}/recibir`).send({})).status).toBe(409);
  });

  it('«no se presentó» solo cuando ya pasó la hora', async () => {
    const m = await mundo(e);
    const id = (await cita(m)).body.data.cita.id as number;
    const antes = await m.api.post(`/citas/${id}/no-se-presento`).send({});
    expect(antes.status).toBe(409);
    expect(antes.body.codigo).toBe('AUN_NO_ES_HORA');
    e.reloj.fijo = new Date(Date.now() + 3 * 86400000);
    const api = await admin(m.t); // sesión nueva con el reloj adelantado
    const r = await api.post(`/citas/${id}/no-se-presento`).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.estado).toBe('no_se_presento');
    expect((await api.post(`/citas/${id}/no-se-presento`).send({})).status).toBe(409);
  });

  it('recibir crea la orden ligada a la cita, marca «se presentó» con la hora de llegada y mide la puntualidad', async () => {
    const m = await mundo(e);
    const id = (await cita(m, { notas: 'cambio de aceite y revisión' })).body.data.cita.id as number;
    e.reloj.fijo = new Date(utcDeLocal(dia(1), '14:30', 'America/Guatemala').getTime() + 15 * 60000); // llegó 15 minutos tarde
    const api = await admin(m.t);
    const r = await api.post(`/citas/${id}/recibir`).send({ prioridad: 'alta', lectura: { contador_id: m.odometro, valor: 1200 } });
    expect(r.status).toBe(201);
    expect(r.body.data.numero).toBe('REP-000001');
    expect(r.body.data.cita).toMatchObject({ estado: 'se_presento', minutos_de_diferencia: 15, orden_numero: 'REP-000001' });
    const orden = (await api.get(`/ordenes/${r.body.data.orden_id}`)).body.data;
    expect(orden).toMatchObject({ origen: 'cita', cita_id: id, prioridad: 'alta', descripcion: 'CAMBIO DE ACEITE Y REVISION', equipo_en_taller: true });
    expect(orden.lecturas[0]).toMatchObject({ valor: 1200 });
    // Una cita da a lo más una orden.
    expect((await api.post(`/citas/${id}/recibir`).send({})).status).toBe(409);
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM ordenes WHERE cita_id IS NOT NULL'))[0] as Array<{ n: number }>)).toEqual([{ n: 1 }]);
  });

  it('recibir es todo o nada: si la orden falla (lectura menor), la cita sigue programada y no queda orden', async () => {
    const m = await mundo(e);
    const id = (await cita(m)).body.data.cita.id as number;
    const r = await m.api.post(`/citas/${id}/recibir`).send({ lectura: { contador_id: m.odometro, valor: 10 } }); // el medidor marca 1000
    expect(r.status).toBe(409);
    const c = (await m.api.get(`/citas?estado=programada`)).body.data.registros;
    expect(c).toHaveLength(1);
    expect(c[0].llegada_en).toBeNull();
    expect(await m.t.sql(async (q) => (await q.query('SELECT COUNT(*) AS n FROM ordenes'))[0] as Array<{ n: number }>)).toEqual([{ n: 0 }]);
    expect((await m.api.post(`/citas/${id}/recibir`).send({})).status).toBe(201); // y se puede reintentar bien
  });
});

describe('quién ve y quién agenda', () => {
  it('el técnico ve las citas pero no las agenda ni las recibe; la recepción hace todo', async () => {
    const m = await mundo(e);
    const id = (await cita(m)).body.data.cita.id as number;
    const tecnico = m.t.api(await (await m.t.usuario('tecnico')).token());
    expect((await tecnico.get('/citas')).status).toBe(200);
    expect((await tecnico.post('/citas').send({ equipo_id: m.equipo, fecha: dia(2), hora: '10:00' })).status).toBe(403);
    expect((await tecnico.post(`/citas/${id}/recibir`).send({})).status).toBe(403);
    expect((await tecnico.post(`/citas/${id}/cancelar`).send({ motivo_id: 1 })).status).toBe(403);
    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    expect((await recepcion.post('/citas').send({ equipo_id: m.equipo, fecha: dia(2), hora: '10:00' })).status).toBe(201);
    expect((await recepcion.post(`/citas/${id}/recibir`).send({})).status).toBe(201);
    const visualizador = m.t.api(await (await m.t.usuario('bodeguero')).token());
    expect((await visualizador.get('/citas')).status).toBe(403); // el bodeguero no ve citas
  });

  it('el listado filtra por día y por estado, y una orden directa no es una cita', async () => {
    const m = await mundo(e);
    await cita(m);
    await cita(m, { fecha: dia(5), hora: '09:00' });
    expect((await m.api.get(`/citas?desde=${dia(1)}&hasta=${dia(2)}`)).body.data.total).toBe(1);
    expect((await m.api.get(`/citas?desde=${dia(0)}&hasta=${dia(10)}`)).body.data.total).toBe(2);
    expect((await m.api.get('/citas?estado=cancelada')).body.data.total).toBe(0);
    const o = (await m.api.get(`/ordenes/${ordenId(await nueva(m))}`)).body.data;
    expect(o).toMatchObject({ origen: 'directo', cita_id: null });
  });
});
