import request from 'supertest';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { linea, mundo, Mundo, nueva, ordenId } from './ayuda-ordenes';

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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const estado = (m: Mundo, lid: number, nuevoEstado: string) => m.api.post(`/lineas/${lid}/estado`).send({ estado: nuevoEstado });
const minutos = (t0: Date, n: number) => new Date(t0.getTime() + n * 60000);

/** Una orden con un trabajo asignado a un técnico. */
async function conTecnico(m: Mundo, rol = 'tecnico') {
  const persona = await m.t.usuario(rol);
  const id = ordenId(await nueva(m));
  const lid = (await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: persona.colaboradorId })).body.data.lineas[0].id as number;
  return { persona, id, lid, api: m.t.api(await persona.token()) };
}

describe('tiempos reales de cada técnico', () => {
  it('iniciar pide técnico; al iniciar y pausar se guardan los tramos y salen las horas reales', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const sin = (await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo })).body.data.lineas[0].id as number;
    const r = await estado(m, sin, 'en_proceso');
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('SIN_TECNICO');

    const { lid } = await conTecnico(m);
    const t0 = new Date();
    e.reloj.fijo = t0;
    const iniciado = await estado(m, lid, 'en_proceso');
    expect(iniciado.body.data.lineas.find((l: { id: number }) => l.id === lid)).toMatchObject({ estado: 'en_proceso', en_curso: true });
    e.reloj.fijo = minutos(t0, 90);
    const pausado = await estado(m, lid, 'detenido_material');
    expect(pausado.body.data.lineas.find((l: { id: number }) => l.id === lid)).toMatchObject({ estado: 'detenido_material', en_curso: false, horas_reales: 1.5 });
    // Se reanuda y se suma un segundo tramo.
    e.reloj.fijo = minutos(t0, 100);
    await estado(m, lid, 'en_proceso');
    e.reloj.fijo = minutos(t0, 130);
    const fin = await estado(m, lid, 'terminado');
    expect(fin.body.data.lineas.find((l: { id: number }) => l.id === lid)).toMatchObject({ estado: 'terminado', horas_reales: 2 }); // 90 + 30 minutos
    const tramos = await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n, SUM(fin IS NULL) AS abiertos FROM registros_tiempo'))[0] as Array<{ n: number; abiertos: number }>);
    expect(tramos[0]).toMatchObject({ n: 2, abiertos: 0 });
    expect((await estado(m, lid, 'terminado')).status).toBe(409); // ya estaba terminado
  });

  it('un técnico NO puede tener dos trabajos en proceso; otro técnico sí; al pausar se libera', async () => {
    const m = await mundo(e);
    const a = await conTecnico(m);
    const id2 = ordenId(await nueva(m));
    const l2 = (await linea(m, id2, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: a.persona.colaboradorId })).body.data.lineas[0].id as number;
    expect((await estado(m, a.lid, 'en_proceso')).status).toBe(200);
    const choque = await estado(m, l2, 'en_proceso');
    expect(choque.status).toBe(409);
    expect(choque.body.codigo).toBe('TECNICO_OCUPADO');
    expect(choque.body.error).toContain('REP-000001');
    const b = await conTecnico(m, 'supervisor');
    expect((await estado(m, b.lid, 'en_proceso')).status).toBe(200); // otra persona, sin problema
    await estado(m, a.lid, 'pausado');
    expect((await estado(m, l2, 'en_proceso')).status).toBe(200);
  });

  it('la base de datos también lo impide: no cabe un segundo tramo abierto del mismo técnico', async () => {
    const m = await mundo(e);
    const a = await conTecnico(m);
    await estado(m, a.lid, 'en_proceso');
    const doble = m.t.sql(async (c) => c.query('INSERT INTO registros_tiempo (linea_id, colaborador_id, inicio) VALUES (?, ?, UTC_TIMESTAMP())', [a.lid, a.persona.colaboradorId]));
    await expect(doble).rejects.toThrow(/Duplicate entry/);
  });

  it('un trabajo en proceso no cambia de técnico; anular la línea o la orden cierra el tramo abierto', async () => {
    const m = await mundo(e);
    const a = await conTecnico(m);
    const otro = await m.t.usuario('supervisor');
    await estado(m, a.lid, 'en_proceso');
    expect((await m.api.patch(`/lineas/${a.lid}`).send({ tecnico_id: otro.colaboradorId })).status).toBe(409);
    await m.api.post(`/lineas/${a.lid}/anular`).send({ motivo: 'se canceló' });
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM registros_tiempo WHERE fin IS NULL'))[0] as Array<{ n: number }>)).toEqual([{ n: 0 }]);

    const b = await conTecnico(m, 'operador');
    await estado(m, b.lid, 'en_proceso');
    await m.api.post(`/ordenes/${b.id}/anular`).send({ motivo_id: m.motivo });
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM registros_tiempo WHERE fin IS NULL'))[0] as Array<{ n: number }>)).toEqual([{ n: 0 }]);
    // Y el técnico queda libre para iniciar otro trabajo.
    const c = await conTecnico(m, 'operador');
    expect((await estado(m, c.lid, 'en_proceso')).status).toBe(200);
  });

  it('matriz nivel × sistema: un técnico sin el sistema habilitado no puede tomar el trabajo', async () => {
    const m = await mundo(e);
    const persona = await m.t.usuario('tecnico');
    const nivel = await m.t.sql(async (c) => (await c.query('SELECT id FROM niveles_tecnico ORDER BY id LIMIT 1'))[0] as Array<{ id: number }>);
    await m.t.sql(async (c) => c.query('UPDATE colaboradores SET nivel_tecnico_id = ? WHERE id = ?', [nivel[0]!.id, persona.colaboradorId]));
    const id = ordenId(await nueva(m));
    expect((await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: persona.colaboradorId })).status).toBe(201); // permisiva por defecto
    await m.t.sql(async (c) => c.query('DELETE FROM matriz_tecnico_sistema'));
    const r = await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: persona.colaboradorId });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('SIN_NIVEL');
    const lid = (await m.api.get(`/ordenes/${id}`)).body.data.lineas[0].id as number;
    expect((await estado(m, lid, 'en_proceso')).body.codigo).toBe('SIN_NIVEL'); // tampoco al iniciar
  });
});

describe('quién puede trabajar cada línea y «Mis trabajos»', () => {
  it('el técnico solo actúa en sus líneas; quien edita órdenes, en cualquiera; la recepción no trabaja', async () => {
    const m = await mundo(e);
    const mio = await conTecnico(m);
    const ajeno = await conTecnico(m, 'operador');
    expect((await estado({ ...m, api: mio.api } as Mundo, mio.lid, 'en_proceso')).status).toBe(200);
    expect((await estado({ ...m, api: mio.api } as Mundo, ajeno.lid, 'en_proceso')).status).toBe(403);
    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    expect((await recepcion.post(`/lineas/${mio.lid}/estado`).send({ estado: 'pausado' })).status).toBe(200); // recepción edita órdenes
    // Un técnico no edita precios ni agrega líneas.
    expect((await mio.api.patch(`/lineas/${mio.lid}`).send({ horas_trabajo: 9 })).status).toBe(403);
    expect((await mio.api.post(`/ordenes/${mio.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).status).toBe(403);
  });

  it('«Mis trabajos» trae solo lo mío que sigue pendiente, lo urgente primero y sin dinero', async () => {
    const m = await mundo(e);
    const mio = await conTecnico(m);
    await conTecnico(m, 'operador'); // de otra persona
    const urgente = ordenId(await nueva(m, { prioridad: 'urgente' }));
    const l2 = (await linea(m, urgente, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: mio.persona.colaboradorId })).body.data.lineas[0].id as number;
    const hecha = ordenId(await nueva(m));
    const l3 = (await linea(m, hecha, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: mio.persona.colaboradorId })).body.data.lineas[0].id as number;
    await estado(m, l3, 'terminado');
    const r = await mio.api.get('/mis-trabajos');
    expect(r.status).toBe(200);
    expect(r.body.data.trabajos.map((x: { id: number }) => x.id)).toEqual([l2, mio.lid]); // la urgente primero; la terminada no sale
    expect(r.body.data.trabajos[0]).toMatchObject({ numero: 'REP-000003', prioridad: 'urgente', estado: 'pendiente' });
    expect(JSON.stringify(r.body.data)).not.toMatch(/precio|total|costo|tarifa/);
    await estado({ ...m, api: mio.api } as Mundo, mio.lid, 'en_proceso');
    const r2 = await mio.api.get('/mis-trabajos');
    expect(r2.body.data.ocupado).toBe(true);
    expect(r2.body.data.trabajos[0].id).toBe(mio.lid); // el que está en proceso va primero
    // Quien no trabaja líneas no tiene esta pantalla.
    expect((await m.t.api(await (await m.t.usuario('recepcionista')).token()).get('/mis-trabajos')).status).toBe(403);
  });
});

describe('fotos del trabajo', () => {
  const subir = (api: Mundo['api'], lid: number, tipo = 'antes', buffer: Buffer = PNG, mime = 'image/png') =>
    api.post(`/lineas/${lid}/fotos?tipo=${tipo}`).set('Content-Type', mime).set('X-Nombre-Archivo', encodeURIComponent('Frente.png')).send(buffer);

  it('el técnico sube sus fotos (antes/después) y se ven con dirección firmada; ajenas y falsas se rechazan', async () => {
    const m = await mundo(e);
    const mio = await conTecnico(m);
    const ajeno = await conTecnico(m, 'operador');
    const r = await subir(mio.api, mio.lid, 'antes');
    expect(r.status).toBe(201);
    const foto = r.body.data.lineas[0].fotos[0];
    expect(foto).toMatchObject({ tipo: 'antes' });
    expect(foto.url).toMatch(/^\/api\/archivos\/.+\?e=\d+&f=[a-f0-9]{64}$/);
    const bajada = await request(e.app).get(foto.url);
    expect(bajada.status).toBe(200);
    expect(bajada.headers['content-type']).toBe('image/png');
    expect((await subir(mio.api, ajeno.lid)).status).toBe(403);
    expect((await subir(mio.api, mio.lid, 'antes', Buffer.from('no soy una foto, soy texto largo largo largo'), 'image/png')).status).toBe(400); // el contenido no es una foto
    expect((await subir(mio.api, mio.lid, 'cualquiera')).status).toBe(400);
    expect((await subir(mio.api, mio.lid, 'antes', Buffer.alloc(0))).status).toBe(400);
    // Quitarla: el técnico la quita de su línea.
    const quitada = await mio.api.delete(`/lineas/${mio.lid}/fotos/${foto.id}`);
    expect(quitada.status).toBe(200);
    expect(quitada.body.data.lineas[0].fotos).toEqual([]);
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM archivos'))[0] as Array<{ n: number }>)).toEqual([{ n: 0 }]); // y el archivo se fue con ella
  });

  it('en una orden cerrada ya no se agregan ni se quitan fotos', async () => {
    const m = await mundo(e);
    const mio = await conTecnico(m);
    await estado(m, mio.lid, 'terminado');
    const subida = await subir(mio.api, mio.lid, 'despues');
    expect(subida.status).toBe(201); // terminada la línea, aún se puede documentar
    const estados = (await m.api.get('/ordenes-opciones')).body.data.estados as Array<{ id: number; codigo: string }>;
    await m.api.post(`/ordenes/${mio.id}/estado`).send({ estado_id: estados.find((x) => x.codigo === 'CERRADA')!.id });
    expect((await subir(mio.api, mio.lid, 'despues')).body.codigo).toBe('ORDEN_CERRADA');
  });
});
