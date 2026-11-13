import request from 'supertest';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { mundo as mundoDeOrdenes, Mundo as MundoOrdenes, nueva, ordenId } from './ayuda-ordenes';

process.env['PDF_SIN_COMPRIMIR'] = '1'; // para poder buscar texto dentro de los PDF de prueba

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

interface Mundo extends MundoOrdenes {
  orden: number;
  motivoRechazo: number;
  tipoFrenos: number;
}
interface Doc {
  id: number;
  tipo: string;
  folio: string;
  version: number;
  vigente: boolean;
  nuevo?: boolean;
  url: string;
  reemplaza_a_id: number | null;
  contenido: Record<string, unknown> & { lineas?: Array<{ descripcion: string; total_linea: number }>; totales?: { total: number }; respuestas?: Array<{ descripcion: string; desenlace: string | null }> };
}

async function mundo(): Promise<Mundo> {
  const base = await mundoDeOrdenes(e);
  const orden = ordenId(await nueva(base));
  const motivoRechazo = ((await base.api.get('/cotizaciones-opciones')).body.data as { motivos_rechazo: Array<{ id: number }> }).motivos_rechazo[0]!.id;
  const etapa = (await base.t.sql(async (c) => (await c.query("SELECT id FROM etapas WHERE codigo = 'MANTENIMIENTO'"))[0] as Array<{ id: number }>))[0]!.id;
  const tipoFrenos = (await base.api.post('/checklists-tipos').send({ codigo: 'frenos', nombre: 'Revision de frenos', etapa_id: etapa, requiere_firma_cliente: false })).body.data.id as number;
  expect((await base.api.put(`/checklists-tipos/${tipoFrenos}/plantilla`).send({ secciones: [{ nombre: 'Frenos', items: [{ descripcion: 'Pastillas', tipo_respuesta: 'semaforo' }, { descripcion: 'Discos', tipo_respuesta: 'semaforo' }] }] })).status).toBe(200);
  return { ...base, orden, motivoRechazo, tipoFrenos };
}

const agregarServicio = (m: Mundo) => m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo });
const cuenta = (m: Mundo) => m.api.post(`/ordenes/${m.orden}/cuenta`).send({});
const pdfDe = async (url: string): Promise<Buffer> => {
  const r = await request(e.app).get(url).buffer(true).parse((res, cb) => {
    const trozos: Buffer[] = [];
    res.on('data', (c: Buffer) => trozos.push(c));
    res.on('end', () => cb(null, Buffer.concat(trozos)));
  });
  expect(r.status).toBe(200);
  expect(r.headers['content-type']).toContain('application/pdf');
  return r.body as Buffer;
};
/** El texto de un PDF sin comprimir: junta las letras de cada instruccion TJ (pdfkit las escribe en hexadecimal, con ajustes de espacio entre medio). */
const textoDe = (b: Buffer): string =>
  [...b.toString('latin1').matchAll(/\[(.*?)\]\s*TJ/g)]
    .map((m) => [...m[1]!.matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1')).join(''))
    .join('\n');
const valido = (b: Buffer): void => {
  expect(b.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(b.subarray(-8).toString('latin1')).toContain('%%EOF');
  expect(b.length).toBeGreaterThan(1500);
};

async function checklistConRojo(m: Mundo, completar: boolean) {
  const c = await m.api.post(`/ordenes/${m.orden}/checklists`).send({ tipo_id: m.tipoFrenos });
  expect(c.status).toBe(201);
  const id = c.body.data.id as number;
  const resp = ((await m.api.get(`/checklists/${id}`)).body.data as { respuestas: Array<{ id: number }> }).respuestas;
  expect((await m.api.patch(`/checklists/${id}/respuestas/${resp[0]!.id}`).send({ semaforo: 'rojo', nota: 'desgaste fuerte' })).status).toBe(200);
  expect((await m.api.post(`/checklists/${id}/respuestas/${resp[0]!.id}/fotos`).set('Content-Type', 'image/png').set('X-Nombre-Archivo', 'a.png').send(PNG)).status).toBe(201);
  expect((await m.api.patch(`/checklists/${id}/respuestas/${resp[1]!.id}`).send({ semaforo: 'verde' })).status).toBe(200);
  if (completar) expect((await m.api.post(`/checklists/${id}/completar`).send({})).status).toBe(200);
  return { id, respuestas: resp.map((r) => r.id) };
}

describe('la cuenta de una orden', () => {
  it('se emite en PDF con folio; si nada cambió devuelve el mismo; si la orden cambió, nace una versión nueva que reemplaza a la anterior', async () => {
    const m = await mundo();
    const vacia = await cuenta(m);
    expect(vacia.status).toBe(409);
    expect(vacia.body.codigo).toBe('SIN_LINEAS');

    expect((await agregarServicio(m)).status).toBe(201);
    const r = await cuenta(m);
    expect(r.status).toBe(201);
    const d1 = r.body.data as Doc;
    expect(d1).toMatchObject({ tipo: 'cuenta', folio: 'CTA-000001', version: 1, vigente: true, nuevo: true, reemplaza_a_id: null });
    expect(d1.contenido.lineas).toEqual([expect.objectContaining({ total_linea: 180 })]);
    expect(d1.contenido.totales).toMatchObject({ subtotal: 200, descuento_total: 20, iva: 21.6, total: 201.6 });
    expect(JSON.stringify(d1.contenido)).not.toMatch(/costo/i); // nunca lleva costos

    const pdf = await pdfDe(d1.url);
    valido(pdf);
    expect(textoDe(pdf)).toContain('CTA-000001'); // el folio sale en el documento
    expect(textoDe(pdf)).toContain('no es una factura');
    // La dirección del PDF está firmada: sin la firma no se abre.
    expect((await request(e.app).get(d1.url.split('?')[0]!)).status).toBe(404);

    const repetida = await cuenta(m);
    expect(repetida.status).toBe(200);
    expect(repetida.body.data).toMatchObject({ id: d1.id, nuevo: false });
    // Una línea anulada no cuenta: agregar y anular otra no cambia la cuenta.
    const extra = await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'por error', cantidad: 1, precio_unitario: 50, costo: 10 });
    const lineaExtra = (extra.body.data.lineas as Array<{ id: number; descripcion: string }>).find((l) => l.descripcion === 'POR ERROR')!.id;
    expect((await cuenta(m)).body.data).toMatchObject({ version: 2 }); // con la línea sí cambia
    expect((await m.api.post(`/lineas/${lineaExtra}/anular`).send({ motivo: 'se puso por error' })).status).toBe(200);
    const sinLaExtra = (await cuenta(m)).body.data as Doc;
    expect(sinLaExtra.contenido.lineas).toHaveLength(1);

    expect((await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado', cantidad: 1, precio_unitario: 300, costo: 100 })).status).toBe(201);
    const v2 = (await cuenta(m)).body.data as Doc;
    expect(v2).toMatchObject({ folio: 'CTA-000001', version: 4, vigente: true, nuevo: true });
    expect(v2.contenido.lineas).toHaveLength(2);
    valido(await pdfDe(v2.url));
    const vigentes = (await m.api.get(`/documentos?orden_id=${m.orden}`)).body.data as Doc[];
    expect(vigentes.map((x) => [x.folio, x.version])).toEqual([['CTA-000001', 4]]);
    const todas = (await m.api.get(`/documentos?orden_id=${m.orden}&todas=true`)).body.data as Doc[];
    expect(todas.map((x) => [x.version, x.vigente])).toEqual([[4, true], [3, false], [2, false], [1, false]]);
    expect(todas[0]!.reemplaza_a_id).toBe(todas[1]!.id); // cada versión apunta a la que reemplaza
    expect(((await m.api.get(`/documentos/${d1.id}`)).body.data as Doc).contenido.lineas).toHaveLength(1); // la versión vieja conserva lo que decía
  });

  it('dos emisiones al mismo tiempo dejan un solo documento', async () => {
    const m = await mundo();
    await agregarServicio(m);
    const rs = await Promise.all([cuenta(m), cuenta(m)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(((await m.api.get('/documentos?todas=true')).body.data as Doc[]).length).toBe(1);
  });

  it('quién puede ver y quién emitir', async () => {
    const m = await mundo();
    await agregarServicio(m);
    const visualizador = m.t.api(await (await m.t.usuario('visualizador')).token());
    const tecnico = m.t.api(await (await m.t.usuario('tecnico')).token());
    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    expect((await visualizador.post(`/ordenes/${m.orden}/cuenta`).send({})).status).toBe(403);
    expect((await tecnico.get('/documentos')).status).toBe(403);
    expect((await recepcion.post(`/ordenes/${m.orden}/cuenta`).send({})).status).toBe(201);
    expect((await visualizador.get('/documentos')).status).toBe(200);
    expect((await visualizador.get(`/documentos/${((await m.api.get('/documentos')).body.data as Doc[])[0]!.id}`)).status).toBe(200);
    // Emitir una cuenta lleva precios: quien no ve precios no la emite.
    await m.t.sql(async (con) => con.query("DELETE rp FROM rol_permisos rp JOIN roles r ON r.id = rp.rol_id WHERE r.codigo = 'recepcionista' AND rp.permiso_codigo = 'ordenes.ver_precios'"));
    const sinPrecios = m.t.api(await (await m.t.usuario('recepcionista')).token());
    expect((await sinPrecios.post(`/ordenes/${m.orden}/cuenta`).send({})).status).toBe(403);
    expect((await visualizador.post('/checklists/1/informe').send({})).status).toBe(403);
    expect((await visualizador.post('/cotizaciones/1/documento').send({})).status).toBe(403);
  });
});

describe('el informe de un checklist', () => {
  it('solo de uno completado; trae lo respondido, las fotos y qué pasó con cada rojo; cambia de versión cuando cambia ese desenlace', async () => {
    const m = await mundo();
    const ck = await checklistConRojo(m, false);
    const noListo = await m.api.post(`/checklists/${ck.id}/informe`).send({});
    expect(noListo.status).toBe(409);
    expect((await m.api.post(`/checklists/${ck.id}/completar`).send({})).status).toBe(200);

    const r = await m.api.post(`/checklists/${ck.id}/informe`).send({});
    expect(r.status).toBe(201);
    const d1 = r.body.data as Doc;
    expect(d1).toMatchObject({ tipo: 'informe', folio: 'INF-000001', version: 1 });
    expect(d1.contenido.respuestas).toEqual([expect.objectContaining({ descripcion: 'PASTILLAS', desenlace: 'Sin cotizar' }), expect.objectContaining({ descripcion: 'DISCOS', desenlace: null })]);
    const pdf = await pdfDe(d1.url);
    valido(pdf);
    expect(textoDe(pdf)).toContain('INF-000001');
    expect(textoDe(pdf)).toContain('PASTILLAS');

    // Se cotiza el rojo y el cliente lo autoriza: el informe nuevo lo cuenta.
    const c = (await m.api.post('/cotizaciones/desde-checklist').send({ checklist_id: ck.id })).body.data as { id: number };
    await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, respuesta_id: ck.respuestas[0] });
    const env = (await m.api.post(`/cotizaciones/${c.id}/enviar`).send({})).body.data as { lineas: Array<{ id: number }> };
    await m.api.post(`/cotizacion-lineas/${env.lineas[0]!.id}/responder`).send({ decision: 'autorizada' });
    const v2 = (await m.api.post(`/checklists/${ck.id}/informe`).send({})).body.data as Doc;
    expect(v2).toMatchObject({ folio: 'INF-000001', version: 2, reemplaza_a_id: d1.id });
    expect(v2.contenido.respuestas![0]!.desenlace).toBe('Autorizado por el cliente (COT-000001)');
  });
});

describe('la cotización en PDF', () => {
  it('solo enviada; el folio es su número; cambia de versión con las respuestas y con una versión nueva de la cotización', async () => {
    const m = await mundo();
    const c = (await m.api.post('/cotizaciones').send({ orden_id: m.orden })).body.data as { id: number };
    await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo });
    expect((await m.api.post(`/cotizaciones/${c.id}/documento`).send({})).status).toBe(409); // borrador
    const env = (await m.api.post(`/cotizaciones/${c.id}/enviar`).send({})).body.data as { lineas: Array<{ id: number }> };
    const d1 = (await m.api.post(`/cotizaciones/${c.id}/documento`).send({})).body.data as Doc;
    expect(d1).toMatchObject({ tipo: 'cotizacion', folio: 'COT-000001', version: 1 });
    const pdf = await pdfDe(d1.url);
    valido(pdf);
    expect(textoDe(pdf)).toContain('COT-000001');
    expect(textoDe(pdf)).toContain('Sin respuesta');
    expect(JSON.stringify(d1.contenido)).not.toMatch(/costo/i);

    await m.api.post(`/cotizacion-lineas/${env.lineas[0]!.id}/responder`).send({ decision: 'rechazada', motivo_id: m.motivoRechazo });
    const d2 = (await m.api.post(`/cotizaciones/${c.id}/documento`).send({})).body.data as Doc;
    expect(d2).toMatchObject({ folio: 'COT-000001', version: 2, reemplaza_a_id: d1.id });
    expect(textoDe(await pdfDe(d2.url))).toContain('Rechazada');

    // Una cotización con versión nueva tiene su propio folio.
    const c2 = (await m.api.post('/cotizaciones').send({ orden_id: m.orden })).body.data as { id: number };
    await m.api.post(`/cotizaciones/${c2.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo });
    await m.api.post(`/cotizaciones/${c2.id}/enviar`).send({});
    const v2 = (await m.api.post(`/cotizaciones/${c2.id}/nueva-version`).send({})).body.data as { id: number };
    await m.api.post(`/cotizaciones/${v2.id}/enviar`).send({});
    expect(((await m.api.post(`/cotizaciones/${v2.id}/documento`).send({})).body.data as Doc).folio).toBe('COT-000002-V2');
  });
});
