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
const PNG_BASE64 = PNG.toString('base64');

interface Resp {
  id: number;
  seccion: string;
  descripcion: string;
  tipo_respuesta: string;
  semaforo: string | null;
  opciones: string[];
  fotos: Array<{ id: number; url: string }>;
}

async function tipoId(m: Mundo, codigo: string): Promise<number> {
  return ((await m.api.get('/checklists-tipos')).body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === codigo)!.id;
}
const abrir = (m: Mundo, orden: number, tipo: number) => m.api.post(`/ordenes/${orden}/checklists`).send({ tipo_id: tipo });
const detalle = async (m: Mundo, id: number) => (await m.api.get(`/checklists/${id}`)).body.data as { estado: string; version: number; total: number; respondidas: number; respuestas: Resp[]; firma: unknown };
const responder = (m: Mundo, id: number, rid: number, cuerpo: Record<string, unknown>) => m.api.patch(`/checklists/${id}/respuestas/${rid}`).send(cuerpo);
const foto = (m: Mundo, id: number, rid: number) => m.api.post(`/checklists/${id}/respuestas/${rid}/fotos`).set('Content-Type', 'image/png').set('X-Nombre-Archivo', 'a.png').send(PNG);

/** Responde TODO en verde / sí / texto (lo que cada tipo de ítem pida). */
async function llenarTodo(m: Mundo, id: number, conRojo = false): Promise<void> {
  const d = await detalle(m, id);
  let primero = true;
  for (const r of d.respuestas) {
    const cuerpo: Record<string, unknown> =
      r.tipo_respuesta === 'semaforo' ? { semaforo: conRojo && primero ? 'rojo' : 'verde' } : r.tipo_respuesta === 'si_no' ? { si_no: true } : r.tipo_respuesta === 'numero' ? { valor_numero: 5 } : r.tipo_respuesta === 'lista' ? { opcion: r.opciones[0] } : { valor_texto: 'sin novedad' };
    expect((await responder(m, id, r.id, cuerpo)).status).toBe(200);
    if (r.tipo_respuesta === 'semaforo') primero = false;
  }
}

describe('tipos y plantillas', () => {
  it('vienen sembrados RECEPCIÓN, CALIDAD y ENTREGA con su plantilla v1, y las etapas de operación y mantenimiento', async () => {
    const m = await mundo(e);
    const tipos = (await m.api.get('/checklists-tipos')).body.data as Array<{ codigo: string; version_vigente: number; items: number; requiere_firma_cliente: number; exige_lectura_contador: number; etapa: string }>;
    expect(tipos.map((x) => x.codigo).sort()).toEqual(['CALIDAD', 'ENTREGA', 'RECEPCION']);
    expect(tipos.find((x) => x.codigo === 'RECEPCION')).toMatchObject({ version_vigente: 1, items: 5, requiere_firma_cliente: 1, exige_lectura_contador: 1, etapa: 'RECEPCION' });
    expect(tipos.find((x) => x.codigo === 'CALIDAD')).toMatchObject({ requiere_firma_cliente: 0 });
    const etapas = await m.t.sql(async (c) => (await c.query('SELECT codigo, requiere_orden FROM etapas ORDER BY orden'))[0] as Array<{ codigo: string; requiere_orden: number }>);
    expect(etapas.map((x) => x.codigo)).toEqual(['OPERACION', 'RECEPCION', 'MANTENIMIENTO', 'CALIDAD', 'ENTREGA']);
    const p = (await m.api.get(`/checklists-tipos/${await tipoId(m, 'RECEPCION')}/plantilla`)).body.data;
    expect(p.secciones.map((s: { nombre: string }) => s.nombre)).toEqual(['EXTERIOR', 'INTERIOR Y CABINA']);
    expect(p.secciones[0].items[0]).toMatchObject({ descripcion: 'CARROCERIA Y PINTURA', tipo_respuesta: 'semaforo' });
  });

  it('crear un tipo propio; el código no cambia; el nombre no se repite; la plantilla se valida', async () => {
    const m = await mundo(e);
    const etapa = (await m.t.sql(async (c) => (await c.query("SELECT id FROM etapas WHERE codigo = 'MANTENIMIENTO'"))[0] as Array<{ id: number }>))[0]!.id;
    const r = await m.api.post('/checklists-tipos').send({ codigo: 'frenos', nombre: 'Revision de frenos', etapa_id: etapa, requiere_firma_cliente: false });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ codigo: 'FRENOS', nombre: 'REVISION DE FRENOS', version_vigente: null, items: 0 });
    expect((await m.api.post('/checklists-tipos').send({ codigo: 'otro', nombre: 'Revision de frenos', etapa_id: etapa })).status).toBe(409);
    expect((await m.api.post('/checklists-tipos').send({ codigo: '1mal', nombre: 'Malo', etapa_id: etapa })).status).toBe(400);
    expect((await m.api.patch(`/checklists-tipos/${r.body.data.id}`).send({ codigo: 'OTRO' })).status).toBe(409);
    const id = r.body.data.id as number;
    const item = (extra: Record<string, unknown>) => ({ descripcion: 'Presion', tipo_respuesta: 'numero', ...extra });
    const guardar = (secciones: unknown) => m.api.put(`/checklists-tipos/${id}/plantilla`).send({ secciones });
    expect((await guardar([])).status).toBe(400);
    expect((await guardar([{ nombre: 'A', items: [] }])).status).toBe(400);
    expect((await guardar([{ nombre: 'A', items: [{ descripcion: 'Color', tipo_respuesta: 'lista', opciones: ['uno'] }] }])).status).toBe(400); // lista con una opción
    expect((await guardar([{ nombre: 'A', items: [item({ minimo: 10, maximo: 5 })] }])).status).toBe(400);
    const ok = await guardar([{ nombre: 'Ruedas', items: [item({ minimo: 0, maximo: 10 }), { descripcion: 'Estado', tipo_respuesta: 'lista', opciones: ['bueno', 'regular', 'malo'] }] }]);
    expect(ok.status).toBe(200);
    expect(ok.body.data.secciones[0].items[1]).toMatchObject({ opciones: ['BUENO', 'REGULAR', 'MALO'] });
  });
});

describe('abrir y llenar', () => {
  it('al abrir se copia la plantilla; no se abren dos iguales en la misma orden; solo en órdenes abiertas', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const tipo = await tipoId(m, 'RECEPCION');
    const r = await abrir(m, id, tipo);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ estado: 'pendiente', total: 5, respondidas: 0, version: 1, orden_numero: 'REP-000001', tipo: 'RECEPCION DEL EQUIPO' });
    expect(r.body.data.respuestas[0]).toMatchObject({ seccion: 'EXTERIOR', descripcion: 'CARROCERIA Y PINTURA', tipo_respuesta: 'semaforo' });
    const otra = await abrir(m, id, tipo);
    expect(otra.status).toBe(409);
    expect(otra.body.codigo).toBe('YA_ABIERTO');
    expect(otra.body.detalle).toMatchObject({ checklist_id: r.body.data.id });
    expect((await abrir(m, id, 99999)).status).toBe(400);
    const lista = (await m.api.get(`/ordenes/${id}/checklists`)).body.data.checklists;
    expect(lista).toEqual([expect.objectContaining({ tipo: 'RECEPCION DEL EQUIPO', estado: 'pendiente', total: 5, respondidas: 0 })]);
    const estados = (await m.api.get('/ordenes-opciones')).body.data.estados as Array<{ id: number; codigo: string }>;
    await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: estados.find((x) => x.codigo === 'CERRADA')!.id });
    expect((await abrir(m, id, await tipoId(m, 'CALIDAD'))).body.codigo).toBe('ORDEN_CERRADA');
  });

  it('un tipo que solo aplica a otro tipo de equipo no se abre; un checklist de operación no necesita orden', async () => {
    const m = await mundo(e);
    const maq = ((await m.api.get('/tipos-equipo')).body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === 'MAQUINARIA')!.id;
    const calidad = await tipoId(m, 'CALIDAD');
    expect((await m.api.patch(`/checklists-tipos/${calidad}`).send({ tipos_equipo_ids: [maq] })).status).toBe(200);
    const id = ordenId(await nueva(m)); // el equipo es un vehículo
    const r = await abrir(m, id, calidad);
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('no aplica');
    // Operación: sin orden.
    const etapa = (await m.t.sql(async (c) => (await c.query("SELECT id FROM etapas WHERE codigo = 'OPERACION'"))[0] as Array<{ id: number }>))[0]!.id;
    const diario = (await m.api.post('/checklists-tipos').send({ codigo: 'DIARIO', nombre: 'Revision diaria', etapa_id: etapa })).body.data.id as number;
    await m.api.put(`/checklists-tipos/${diario}/plantilla`).send({ secciones: [{ nombre: 'Antes de arrancar', items: [{ descripcion: 'Aceite', tipo_respuesta: 'semaforo' }] }] });
    const op = await m.api.post('/checklists').send({ tipo_id: diario, equipo_id: m.equipo });
    expect(op.status).toBe(201);
    expect(op.body.data.orden_id).toBeNull();
    expect((await m.api.post('/checklists').send({ tipo_id: await tipoId(m, 'RECEPCION'), equipo_id: m.equipo })).status).toBe(400); // ese sí pide orden
  });

  it('cada respuesta se valida según el tipo de ítem', async () => {
    const m = await mundo(e);
    const etapa = (await m.t.sql(async (c) => (await c.query("SELECT id FROM etapas WHERE codigo = 'MANTENIMIENTO'"))[0] as Array<{ id: number }>))[0]!.id;
    const t = (await m.api.post('/checklists-tipos').send({ codigo: 'MIX', nombre: 'Mixto', etapa_id: etapa })).body.data.id as number;
    await m.api.put(`/checklists-tipos/${t}/plantilla`).send({ secciones: [{ nombre: 'Todo', items: [
      { descripcion: 'Luces', tipo_respuesta: 'semaforo' }, { descripcion: 'Llave', tipo_respuesta: 'si_no' },
      { descripcion: 'Presion', tipo_respuesta: 'numero', minimo: 20, maximo: 40 }, { descripcion: 'Comentario', tipo_respuesta: 'texto' },
      { descripcion: 'Estado', tipo_respuesta: 'lista', opciones: ['Bueno', 'Malo'] },
    ] }] });
    const id = ordenId(await nueva(m));
    const c = (await abrir(m, id, t)).body.data as { id: number; respuestas: Resp[] };
    const [luces, llave, presion, comentario, estado] = c.respuestas as [Resp, Resp, Resp, Resp, Resp];
    expect((await responder(m, c.id, luces.id, { si_no: true })).status).toBe(400); // semáforo pide un color
    expect((await responder(m, c.id, luces.id, { semaforo: 'azul' })).status).toBe(400);
    expect((await responder(m, c.id, luces.id, { semaforo: 'verde' })).status).toBe(200);
    expect((await responder(m, c.id, llave.id, { si_no: false })).status).toBe(200);
    expect((await responder(m, c.id, presion.id, { valor_numero: 10 })).status).toBe(400); // menor que 20
    expect((await responder(m, c.id, presion.id, { valor_numero: 50 })).status).toBe(400); // mayor que 40
    expect((await responder(m, c.id, presion.id, { valor_numero: 32 })).status).toBe(200);
    expect((await responder(m, c.id, comentario.id, { valor_texto: '   ' })).status).toBe(400);
    expect((await responder(m, c.id, estado.id, { opcion: 'Regular' })).status).toBe(400); // no es una opción
    expect((await responder(m, c.id, estado.id, { opcion: 'bueno' })).status).toBe(200);
    expect((await responder(m, c.id, 99999, { semaforo: 'verde' })).status).toBe(404);
    const d = await detalle(m, c.id);
    expect(d).toMatchObject({ estado: 'en_progreso', respondidas: 4, total: 5 });
  });

  it('las fotos de un ítem: hasta 5, solo imágenes de verdad', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const c = (await abrir(m, id, await tipoId(m, 'RECEPCION'))).body.data as { id: number; respuestas: Resp[] };
    const rid = c.respuestas[0]!.id;
    for (let i = 0; i < 5; i++) expect((await foto(m, c.id, rid)).status).toBe(201);
    expect((await foto(m, c.id, rid)).status).toBe(409);
    const falsa = await m.api.post(`/checklists/${c.id}/respuestas/${c.respuestas[1]!.id}/fotos`).set('Content-Type', 'image/png').send(Buffer.from('esto no es una imagen de verdad, es texto'));
    expect(falsa.status).toBe(400);
    const d = await detalle(m, c.id);
    expect(d.respuestas[0]!.fotos).toHaveLength(5);
    const bajada = await request(e.app).get(d.respuestas[0]!.fotos[0]!.url);
    expect(bajada.status).toBe(200);
    expect((await m.api.delete(`/checklists/${c.id}/fotos/${d.respuestas[0]!.fotos[0]!.id}`)).body.data.respuestas[0].fotos).toHaveLength(4);
  });
});

describe('completar: el candado', () => {
  it('no se completa vacío ni a medias: dice TODO lo que falta (ítems, fotos en rojo, lectura y firma)', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m)); // sin lectura al recibir
    const c = (await abrir(m, id, await tipoId(m, 'RECEPCION'))).body.data as { id: number };
    const vacio = await m.api.post(`/checklists/${c.id}/completar`).send({});
    expect(vacio.status).toBe(409);
    expect(vacio.body.codigo).toBe('CHECKLIST_INCOMPLETO');
    expect(vacio.body.detalle.faltas).toEqual(expect.arrayContaining([expect.stringContaining('Faltan 5 ítems'), expect.stringContaining('lectura del medidor'), expect.stringContaining('firma')]));

    await llenarTodo(m, c.id, true); // el primero en rojo, sin foto
    const sinFoto = await m.api.post(`/checklists/${c.id}/completar`).send({});
    expect(sinFoto.body.detalle.faltas.join(' ')).toContain('foto');
    expect(sinFoto.body.detalle.faltas.join(' ')).not.toContain('ítems por responder');
    const d = await detalle(m, c.id);
    await foto(m, c.id, d.respuestas.find((r) => r.semaforo === 'rojo')!.id);
    expect((await m.api.post(`/checklists/${c.id}/firma`).send({ nombre: 'Jo', imagen: PNG_BASE64 })).status).toBe(400); // nombre corto
    expect((await m.api.post(`/checklists/${c.id}/firma`).send({ nombre: 'Juan Perez', imagen: Buffer.from('no es png').toString('base64') })).status).toBe(400);
    expect((await m.api.post(`/checklists/${c.id}/firma`).send({ nombre: 'Juan Perez', imagen: PNG_BASE64 })).status).toBe(201);
    const sinLectura = await m.api.post(`/checklists/${c.id}/completar`).send({});
    expect(sinLectura.body.detalle.faltas).toEqual([expect.stringContaining('lectura del medidor')]);
    const hecho = await m.api.post(`/checklists/${c.id}/completar`).send({ lectura: { contador_id: m.odometro, valor: 1300 } });
    expect(hecho.status).toBe(200);
    expect(hecho.body.data).toMatchObject({ estado: 'completado', firma: expect.objectContaining({ firmante_nombre: 'JUAN PEREZ' }) });
    const lectura = await m.t.sql(async (q) => (await q.query("SELECT origen, orden_id FROM lecturas_contador WHERE valor = 1300"))[0] as Array<{ origen: string; orden_id: number }>);
    expect(lectura[0]).toMatchObject({ origen: 'checklist', orden_id: id });
  });

  it('si la orden ya tiene lectura de recepción no se pide otra; y un tipo sin firma ni lectura se completa solo con las respuestas', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m, { lectura: { contador_id: m.odometro, valor: 1100 } }));
    const rec = (await abrir(m, id, await tipoId(m, 'RECEPCION'))).body.data as { id: number };
    await llenarTodo(m, rec.id);
    expect((await m.api.post(`/checklists/${rec.id}/completar`).send({})).body.detalle.faltas).toEqual([expect.stringContaining('firma')]); // la lectura ya estaba
    const cal = (await abrir(m, id, await tipoId(m, 'CALIDAD'))).body.data as { id: number };
    await llenarTodo(m, cal.id);
    expect((await m.api.post(`/checklists/${cal.id}/completar`).send({})).status).toBe(200);
  });

  it('un checklist completado queda bloqueado: ni respuestas, ni fotos, ni firma; y se puede abrir otro del mismo tipo', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const cal = (await abrir(m, id, await tipoId(m, 'CALIDAD'))).body.data as { id: number };
    await llenarTodo(m, cal.id);
    await m.api.post(`/checklists/${cal.id}/completar`).send({});
    const d = await detalle(m, cal.id);
    expect(d.estado).toBe('completado');
    const bloqueadas = [await responder(m, cal.id, d.respuestas[0]!.id, { semaforo: 'rojo' }), await foto(m, cal.id, d.respuestas[0]!.id), await m.api.post(`/checklists/${cal.id}/completar`).send({})];
    for (const r of bloqueadas) {
      expect(r.status).toBe(409);
      expect(r.body.codigo).toBe('CHECKLIST_COMPLETADO');
    }
    expect((await abrir(m, id, await tipoId(m, 'CALIDAD'))).status).toBe(201); // un segundo, ya con el primero cerrado
  });

  it('las plantillas se VERSIONAN: lo abierto y lo completado conservan su texto aunque la plantilla cambie', async () => {
    const m = await mundo(e);
    const tipo = await tipoId(m, 'CALIDAD');
    const id = ordenId(await nueva(m));
    const viejo = (await abrir(m, id, tipo)).body.data as { id: number };
    const nueva2 = await m.api.put(`/checklists-tipos/${tipo}/plantilla`).send({ secciones: [{ nombre: 'Final', items: [{ descripcion: 'Todo en orden', tipo_respuesta: 'si_no' }] }] });
    expect(nueva2.body.data).toMatchObject({ version: 2, vigente: true });
    expect(nueva2.body.data.versiones.map((v: { version: number; vigente: number }) => [v.version, v.vigente])).toEqual([[2, 1], [1, 0]]);
    const dv = await detalle(m, viejo.id);
    expect(dv).toMatchObject({ version: 1, total: 4 });
    expect(dv.respuestas[0]!.descripcion).toBe('EL TRABAJO SOLICITADO QUEDO COMPLETO');
    await llenarTodo(m, viejo.id);
    await m.api.post(`/checklists/${viejo.id}/completar`).send({});
    const otra = ordenId(await nueva(m));
    const fresco = (await abrir(m, otra, tipo)).body.data as { version: number; total: number };
    expect(fresco).toMatchObject({ version: 2, total: 1 });
    expect((await m.api.get(`/checklists-tipos/${tipo}/plantilla?version=1`)).body.data.secciones[0].items[0].descripcion).toBe('EL TRABAJO SOLICITADO QUEDO COMPLETO');
  });
});

describe('checklists requeridos', () => {
  async function requisitos(m: Mundo, lista: Array<{ nombre: string; momento: string; accion: string }>) {
    const requisitos = [];
    for (const l of lista) requisitos.push({ checklist_tipo_id: await tipoId(m, l.nombre), momento: l.momento, accion: l.accion });
    return m.api.put(`/checklists-requisitos/${m.tipos['REP']}`).send({ requisitos });
  }
  const cambiar = (m: Mundo, orden: number, codigo: string, extra: Record<string, unknown> = {}, api = m.api) =>
    api.get('/ordenes-opciones').then((o) => api.post(`/ordenes/${orden}/estado`).send({ estado_id: (o.body.data.estados as Array<{ id: number; codigo: string }>).find((x) => x.codigo === codigo)!.id, ...extra }));

  it('el checklist requerido bloquea iniciar un trabajo y cerrar la orden, diciendo cuál falta', async () => {
    const m = await mundo(e);
    expect((await requisitos(m, [{ nombre: 'RECEPCION', momento: 'antes_de_iniciar', accion: 'bloquear' }, { nombre: 'CALIDAD', momento: 'antes_de_terminar', accion: 'bloquear' }])).status).toBe(200);
    const persona = await m.t.usuario('tecnico');
    const id = ordenId(await nueva(m, { lectura: { contador_id: m.odometro, valor: 1100 } }));
    const lid = (await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: persona.colaboradorId })).body.data.lineas[0].id as number;
    const ini = await m.api.post(`/lineas/${lid}/estado`).send({ estado: 'en_proceso' });
    expect(ini.status).toBe(409);
    expect(ini.body.codigo).toBe('CHECKLIST_REQUERIDO');
    expect(ini.body.error).toContain('RECEPCION DEL EQUIPO');
    const pend = (await m.api.get(`/ordenes/${id}/checklists`)).body.data.requeridos_pendientes;
    expect(pend.iniciar.bloquean).toEqual(['RECEPCION DEL EQUIPO']);
    expect(pend.terminar.bloquean).toEqual(['CONTROL DE CALIDAD']);

    const rec = (await abrir(m, id, await tipoId(m, 'RECEPCION'))).body.data as { id: number };
    await llenarTodo(m, rec.id);
    await m.api.post(`/checklists/${rec.id}/firma`).send({ nombre: 'Juan Perez', imagen: PNG_BASE64 });
    expect((await m.api.post(`/checklists/${rec.id}/completar`).send({})).status).toBe(200);
    expect((await m.api.post(`/lineas/${lid}/estado`).send({ estado: 'en_proceso' })).status).toBe(200);
    await m.api.post(`/lineas/${lid}/estado`).send({ estado: 'terminado' });

    const cierre = await cambiar(m, id, 'CERRADA');
    expect(cierre.status).toBe(409);
    expect(cierre.body.codigo).toBe('CHECKLIST_REQUERIDO');
    expect(cierre.body.error).toContain('CONTROL DE CALIDAD');
    const cal = (await abrir(m, id, await tipoId(m, 'CALIDAD'))).body.data as { id: number };
    expect((await cambiar(m, id, 'CERRADA')).status).toBe(409); // abierto no basta: tiene que estar COMPLETADO
    await llenarTodo(m, cal.id);
    await m.api.post(`/checklists/${cal.id}/completar`).send({});
    expect((await cambiar(m, id, 'CERRADA')).status).toBe(200);
  });

  it('«avisar» no bloquea; un tipo que no aplica al equipo no se exige; sin requisitos todo sigue como antes', async () => {
    const m = await mundo(e);
    await requisitos(m, [{ nombre: 'CALIDAD', momento: 'antes_de_terminar', accion: 'avisar' }]);
    const id = ordenId(await nueva(m));
    expect((await cambiar(m, id, 'CERRADA')).status).toBe(200);
    const maq = ((await m.api.get('/tipos-equipo')).body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === 'MAQUINARIA')!.id;
    await m.api.patch(`/checklists-tipos/${await tipoId(m, 'CALIDAD')}`).send({ tipos_equipo_ids: [maq] });
    await requisitos(m, [{ nombre: 'CALIDAD', momento: 'antes_de_terminar', accion: 'bloquear' }]);
    const id2 = ordenId(await nueva(m));
    expect((await cambiar(m, id2, 'CERRADA')).status).toBe(200); // el vehículo no necesita el checklist de maquinaria
    expect((await requisitos(m, [{ nombre: 'CALIDAD', momento: 'antes_de_terminar', accion: 'bloquear' }, { nombre: 'CALIDAD', momento: 'antes_de_terminar', accion: 'avisar' }])).status).toBe(400); // repetido
  });

  it('una excepción autorizada (con permiso y motivo) deja cerrar sin el checklist y queda registrada', async () => {
    const m = await mundo(e);
    await requisitos(m, [{ nombre: 'CALIDAD', momento: 'antes_de_terminar', accion: 'bloquear' }]);
    const motivo = (await m.t.sql(async (c) => (await c.query("SELECT id FROM motivos WHERE tipo = 'excepcion_checklist' ORDER BY id LIMIT 1"))[0] as Array<{ id: number }>))[0]!.id;
    const id = ordenId(await nueva(m));
    expect((await cambiar(m, id, 'CERRADA', { excepcion_motivo_id: 99999 })).status).toBe(400);
    const sup = m.t.api(await (await m.t.usuario('recepcionista')).token()); // la recepción no autoriza excepciones
    expect((await cambiar(m, id, 'CERRADA', { excepcion_motivo_id: motivo }, sup)).status).toBe(403);
    const ok = await cambiar(m, id, 'CERRADA', { excepcion_motivo_id: motivo });
    expect(ok.status).toBe(200);
    const b = await m.t.sql(async (c) => (await c.query("SELECT motivo, despues FROM bitacora WHERE accion = 'orden_cierre_con_excepcion'"))[0] as Array<{ motivo: string; despues: string }>);
    expect(b).toHaveLength(1);
    expect(b[0]!.despues).toContain('CONTROL DE CALIDAD');
  });
});

describe('quién hace qué con los checklists', () => {
  it('el técnico llena pero no configura; el bodeguero solo ve; la recepción llena', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const tecnico = m.t.api(await (await m.t.usuario('tecnico')).token());
    const calidad = await tipoId(m, 'CALIDAD');
    expect((await tecnico.post(`/ordenes/${id}/checklists`).send({ tipo_id: calidad })).status).toBe(201);
    expect((await tecnico.put(`/checklists-tipos/${calidad}/plantilla`).send({ secciones: [{ nombre: 'A', items: [{ descripcion: 'x', tipo_respuesta: 'si_no' }] }] })).status).toBe(403);
    expect((await tecnico.post('/checklists-tipos').send({ codigo: 'XX', nombre: 'Xx', etapa_id: 1 })).status).toBe(403);
    expect((await tecnico.put(`/checklists-requisitos/${m.tipos['REP']}`).send({ requisitos: [] })).status).toBe(403);
    const bodeguero = m.t.api(await (await m.t.usuario('bodeguero')).token());
    expect((await bodeguero.get(`/ordenes/${id}/checklists`)).status).toBe(200);
    expect((await bodeguero.post(`/ordenes/${id}/checklists`).send({ tipo_id: await tipoId(m, 'ENTREGA') })).status).toBe(403);
    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    expect((await recepcion.post(`/ordenes/${id}/checklists`).send({ tipo_id: await tipoId(m, 'ENTREGA') })).status).toBe(201);
  });
});
