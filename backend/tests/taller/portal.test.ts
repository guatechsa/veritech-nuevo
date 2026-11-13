import { filas } from '../../src/db/consulta';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { dia, mundo as mundoDeOrdenes, Mundo as MundoOrdenes, nueva, ordenId } from './ayuda-ordenes';

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

interface Mundo extends MundoOrdenes {
  equipo2: number;
  ajeno: number;
  orden: number;
  ana: number;
  beto: number;
}
type Api = MundoOrdenes['api'];

/**
 * Un cliente «Industrias Lopez» con dos vehículos (CAM-1 y CAM-2) y una orden abierta en CAM-1, y dos contactos: Ana (aprobadora, ve todos los equipos)
 * y Beto (de consulta, solo ve CAM-2). Además, un vehículo de OTRO cliente que nadie de este cliente debe ver.
 */
async function mundo(): Promise<Mundo> {
  const base = await mundoDeOrdenes(e);
  const nuevoEquipo = async (codigo: string, cliente: number | null): Promise<number> =>
    (await base.api.post('/equipos').send({ tipo_equipo_id: base.tipoVehiculo, ...(cliente ? { cliente_id: cliente } : {}), codigo_interno: codigo, placa: `P${codigo}`.replace('-', '') })).body.data.equipo.id as number;
  const equipo2 = await nuevoEquipo('CAM-2', base.cliente);
  const otro = (await base.api.post('/clientes').send({ nombre: 'Transportes Ajenos' })).body.data.cliente.id as number;
  const ajeno = await nuevoEquipo('AJE-1', otro);
  const ana = (await base.api.post(`/clientes/${base.cliente}/contactos`).send({ nombre: 'Ana Gomez', correo: 'Ana@Lopez.test', rol: 'aprobador', acceso_todos_equipos: true })).body.data.contactos[0].id as number;
  const beto = (await base.api.post(`/clientes/${base.cliente}/contactos`).send({ nombre: 'Beto Diaz', correo: 'beto@lopez.test', rol: 'consulta', acceso_todos_equipos: false })).body.data.contactos.find((c: { nombre: string }) => c.nombre === 'BETO DIAZ').id as number;
  await base.t.sql((con) => con.query('INSERT INTO contacto_equipos (contacto_id, equipo_id) VALUES (?, ?)', [beto, equipo2]));
  const orden = ordenId(await nueva(base));
  return { ...base, equipo2, ajeno, orden, ana, beto };
}

const correos = (tipo: string) => filas<{ destinatarios: string; asunto: string; cuerpo: string }>(e.pool, 'SELECT destinatarios, asunto, cuerpo FROM correos_salida WHERE tipo = ? ORDER BY id', [tipo]);
const sql = (m: Mundo, consulta: string, params: unknown[] = []) => m.t.sql(async (c) => (await c.query(consulta, params))[0] as Array<Record<string, unknown>>);
const pedirCodigo = (m: Mundo, correo: string) => m.t.api().post('/publico/portal/codigo').send({ correo });
/** El último código que se mandó por correo a esa persona. */
async function ultimoCodigo(correo: string): Promise<string> {
  const c = (await correos('portal_codigo')).filter((x) => x.destinatarios === correo.toLowerCase()).pop();
  return /letter-spacing:6px;font-weight:bold;">(\d{6})</.exec(c!.cuerpo)![1]!;
}
async function entrar(m: Mundo, correo: string): Promise<string> {
  expect((await pedirCodigo(m, correo)).status).toBe(200);
  const r = await m.t.api().post('/publico/portal/entrar').send({ correo, codigo: await ultimoCodigo(correo) });
  expect(r.status).toBe(200);
  return r.body.data.token as string;
}
const como = (m: Mundo, token: string): Api => m.t.api(token) as unknown as Api;

describe('entrar al portal con correo y código', () => {
  it('el código llega solo al correo de una persona de contacto; la respuesta es la misma exista o no el correo', async () => {
    const m = await mundo();
    const a = await pedirCodigo(m, 'desconocido@nadie.test');
    const b = await pedirCodigo(m, 'ana@lopez.test');
    expect(a.status).toBe(200);
    expect(a.body).toEqual(b.body); // no se puede averiguar qué correos existen
    const c = await correos('portal_codigo');
    expect(c).toHaveLength(1);
    expect(c[0]!.destinatarios).toBe('ana@lopez.test'); // en minúsculas
    expect(c[0]!.cuerpo).toMatch(/\d{6}/);
    expect((await m.t.api().post('/publico/portal/codigo').send({ correo: 'esto no es un correo' })).status).toBe(400);
    // Un contacto desactivado ya no recibe código.
    await sql(m, 'UPDATE contactos_cliente SET activo = 0 WHERE id = ?', [m.beto]);
    await pedirCodigo(m, 'beto@lopez.test');
    expect(await correos('portal_codigo')).toHaveLength(1);
  });

  it('el código sirve una sola vez, vence a los 15 minutos y se prueba como máximo 5 veces', async () => {
    const m = await mundo();
    const entrarCon = (correo: string, codigo: string) => m.t.api().post('/publico/portal/entrar').send({ correo, codigo });
    await pedirCodigo(m, 'ana@lopez.test');
    const bueno = await ultimoCodigo('ana@lopez.test');
    const malo = bueno === '000000' ? '111111' : '000000';
    expect((await entrarCon('ana@lopez.test', malo)).status).toBe(401);
    expect((await entrarCon('ana@lopez.test', '12345')).status).toBe(400); // son 6 números
    const ok = await entrarCon('ana@lopez.test', bueno);
    expect(ok.status).toBe(200);
    expect(ok.body.data.token).toMatch(/^[0-9a-f]{64}$/);
    expect((await entrarCon('ana@lopez.test', bueno)).status).toBe(401); // ya se usó

    // Cinco intentos fallidos «queman» el código aunque después se escriba el bueno.
    await pedirCodigo(m, 'ana@lopez.test');
    const segundo = await ultimoCodigo('ana@lopez.test');
    const equivocado = segundo === '999999' ? '888888' : '999999';
    for (let i = 0; i < 5; i++) expect((await entrarCon('ana@lopez.test', equivocado)).status).toBe(401);
    expect((await entrarCon('ana@lopez.test', segundo)).status).toBe(401);

    // Vencido a los 15 minutos.
    e.reloj.fijo = new Date('2026-11-20T15:00:00Z');
    await pedirCodigo(m, 'beto@lopez.test');
    const codigoBeto = await ultimoCodigo('beto@lopez.test');
    e.reloj.fijo = new Date('2026-11-20T15:16:00Z');
    expect((await entrarCon('beto@lopez.test', codigoBeto)).status).toBe(401);
  });

  it('no se pueden pedir más de 3 códigos por hora al mismo correo', async () => {
    const m = await mundo();
    e.reloj.fijo = new Date('2026-11-20T15:00:00Z');
    for (let i = 0; i < 5; i++) expect((await pedirCodigo(m, 'ana@lopez.test')).status).toBe(200);
    expect(await correos('portal_codigo')).toHaveLength(3);
    e.reloj.fijo = new Date('2026-11-20T16:05:00Z'); // pasó una hora
    await pedirCodigo(m, 'ana@lopez.test');
    expect(await correos('portal_codigo')).toHaveLength(4);
  });

  it('la sesión dura 8 horas, se cierra al salir y sin llave válida no se ve nada', async () => {
    const m = await mundo();
    e.reloj.fijo = new Date('2026-11-20T15:00:00Z');
    const token = await entrar(m, 'ana@lopez.test');
    const api = como(m, token);
    expect((await api.get('/portal/resumen')).status).toBe(200);
    expect((await m.t.api().get('/portal/resumen')).status).toBe(401); // sin llave
    expect((await m.t.api('0'.repeat(64)).get('/portal/resumen')).body.codigo).toBe('PORTAL_SIN_SESION');
    // La sesión del PERSONAL del taller no abre el portal ni al revés.
    expect((await m.t.api(await m.t.token()).get('/portal/resumen')).status).toBe(401);
    expect((await m.t.api(token).get('/auth/yo')).status).toBe(401);
    expect((await api.post('/portal/cerrar').send({})).status).toBe(200);
    expect((await api.get('/portal/resumen')).status).toBe(401);
    // Otra sesión que se deja vencer.
    const otro = como(m, await entrar(m, 'ana@lopez.test'));
    e.reloj.fijo = new Date('2026-11-20T23:10:00Z');
    expect((await otro.get('/portal/resumen')).status).toBe(401);
  });
});

describe('lo que ve cada persona', () => {
  it('Ana ve todos los equipos de su cliente; Beto solo el asignado; el equipo de otro cliente no lo ve nadie', async () => {
    const m = await mundo();
    const ana = como(m, await entrar(m, 'ana@lopez.test'));
    const beto = como(m, await entrar(m, 'beto@lopez.test'));
    const rAna = (await ana.get('/portal/resumen')).body.data as { equipos: Array<{ id: number; etiqueta: string }> };
    expect(rAna.equipos.map((x) => x.id).sort()).toEqual([m.equipo, m.equipo2].sort());
    const rBeto = (await beto.get('/portal/resumen')).body.data as { equipos: Array<{ id: number }> };
    expect(rBeto.equipos.map((x) => x.id)).toEqual([m.equipo2]);
    expect((await ana.get(`/portal/equipos/${m.equipo}`)).status).toBe(200);
    expect((await beto.get(`/portal/equipos/${m.equipo}`)).status).toBe(404); // no le asignaron CAM-1
    expect((await ana.get(`/portal/equipos/${m.ajeno}`)).status).toBe(404);
    expect((await beto.get(`/portal/equipos/${m.ajeno}`)).status).toBe(404);
    // Al quitarle el acceso al equipo, deja de verlo de inmediato.
    await sql(m, 'DELETE FROM contacto_equipos WHERE contacto_id = ?', [m.beto]);
    expect((await beto.get(`/portal/equipos/${m.equipo2}`)).status).toBe(404);
  });

  it('el resumen muestra el estado de la orden y el avance ponderado por horas, sin costos ni datos internos', async () => {
    const m = await mundo();
    const tecnico = await m.t.usuario('tecnico');
    const largo = (await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tecnico.colaboradorId })).body.data.lineas[0].id as number; // 2 horas
    const largo2 = (await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).body.data.lineas.find((l: { id: number }) => l.id !== largo).id as number;
    await sql(m, 'UPDATE lineas_orden SET horas_trabajo = 6 WHERE id = ?', [largo2]); // este trabajo pesa 6 horas, el otro 2
    expect((await m.api.post(`/lineas/${largo}/estado`).send({ estado: 'en_proceso' })).status).toBe(200);
    expect((await m.api.post(`/lineas/${largo}/estado`).send({ estado: 'terminado' })).status).toBe(200);
    const ana = como(m, await entrar(m, 'ana@lopez.test'));
    const r = (await ana.get('/portal/resumen')).body.data as { taller: string; equipos: Array<{ id: number; ordenes_abiertas: Array<{ numero: string; estado: string; avance: number | null }> }> };
    const orden = r.equipos.find((x) => x.id === m.equipo)!.ordenes_abiertas[0]!;
    expect(orden.avance).toBe(25); // 2 horas hechas de 8 (no 50 %: pesa por horas, no por cantidad de trabajos)
    expect(orden.estado).toBeTruthy();
    const ficha = (await ana.get(`/portal/equipos/${m.equipo}`)).body.data;
    expect(JSON.stringify([r, ficha])).not.toMatch(/costo|precio|tecnico|tarifa|registro|cronometro/i);
    expect(ficha.ordenes[0].trabajos.some((t: { terminado: boolean }) => t.terminado)).toBe(true);
  });

  it('las cuentas e informes emitidos aparecen con su PDF firmado, solo la versión vigente', async () => {
    const m = await mundo();
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo });
    expect((await m.api.post(`/ordenes/${m.orden}/cuenta`).send({})).status).toBe(201);
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado', cantidad: 1, precio_unitario: 300, costo: 100 });
    expect((await m.api.post(`/ordenes/${m.orden}/cuenta`).send({})).status).toBe(201); // versión 2
    const ana = como(m, await entrar(m, 'ana@lopez.test'));
    const docs = ((await ana.get(`/portal/equipos/${m.equipo}`)).body.data.documentos as Array<{ folio: string; version: number; url: string }>);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ folio: 'CTA-000001', version: 2 });
    expect(docs[0]!.url).toContain('/api/archivos/');
  });
});

describe('cotizaciones desde el portal', () => {
  async function cotizacion(m: Mundo, equipoOrden: number) {
    const c = (await m.api.post('/cotizaciones').send({ orden_id: equipoOrden })).body.data as { id: number };
    expect((await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).status).toBe(201);
    expect((await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado', cantidad: 1, precio_unitario: 300, costo: 120 })).status).toBe(201);
    const enviada = (await m.api.post(`/cotizaciones/${c.id}/enviar`).send({})).body.data as { lineas: Array<{ id: number }> };
    return { id: c.id, lineas: enviada.lineas.map((l) => l.id) };
  }

  it('la ve quien tiene el equipo; solo un «aprobador» autoriza o rechaza, y queda con su nombre y el portal como origen', async () => {
    const m = await mundo();
    const c = await cotizacion(m, m.orden);
    const motivo = ((await m.api.get('/cotizaciones-opciones')).body.data as { motivos_rechazo: Array<{ id: number }> }).motivos_rechazo[0]!.id;
    const ana = como(m, await entrar(m, 'ana@lopez.test'));
    const resumen = (await ana.get('/portal/resumen')).body.data as { cotizaciones_por_responder: Array<{ id: number; numero: string }>; puede_aprobar: boolean };
    expect(resumen.cotizaciones_por_responder.map((x) => x.id)).toEqual([c.id]);
    expect(resumen.puede_aprobar).toBe(true);
    const det = (await ana.get(`/portal/cotizaciones/${c.id}`)).body.data;
    expect(det).toMatchObject({ puede_responder: true, se_puede_responder: true });
    expect(JSON.stringify(det)).not.toMatch(/"costo"/);
    // Beto no tiene CAM-1: ni la ve.
    const beto = como(m, await entrar(m, 'beto@lopez.test'));
    expect((await beto.get(`/portal/cotizaciones/${c.id}`)).status).toBe(404);
    // Ana responde una línea; otra queda pendiente.
    const r1 = await ana.post(`/portal/cotizaciones/${c.id}/responder`).send({ respuestas: [{ linea_id: c.lineas[0], decision: 'autorizada' }] });
    expect(r1.status).toBe(200);
    expect((await ana.post(`/portal/cotizaciones/${c.id}/responder`).send({ respuestas: [{ linea_id: c.lineas[1], decision: 'rechazada' }] })).status).toBe(400); // rechazar pide motivo
    expect((await ana.post(`/portal/cotizaciones/${c.id}/responder`).send({ respuestas: [{ linea_id: c.lineas[1], decision: 'rechazada', motivo_id: motivo }] })).status).toBe(200);
    const filas2 = await sql(m, 'SELECT estado, respondida_por_nombre, enlace_id FROM cotizacion_lineas WHERE cotizacion_id = ? ORDER BY id', [c.id]);
    expect(filas2.map((f) => f['estado'])).toEqual(['autorizada', 'rechazada']);
    expect(filas2[0]!['respondida_por_nombre']).toBe('ANA GOMEZ (PORTAL)');
    expect(filas2[0]!['enlace_id']).toBeNull();
    expect((await sql(m, 'SELECT estado FROM cotizaciones WHERE id = ?', [c.id]))[0]!['estado']).toBe('respondida');
    expect(await correos('aviso_cotizacion_respondida')).toHaveLength(1); // el taller se entera igual que por el enlace
  });

  it('una persona de «consulta» la ve pero no puede responder', async () => {
    const m = await mundo();
    const orden2 = ordenId(await nueva(m, { equipo_id: m.equipo2 }));
    const c = await cotizacion(m, orden2);
    const beto = como(m, await entrar(m, 'beto@lopez.test'));
    expect((await beto.get(`/portal/cotizaciones/${c.id}`)).body.data).toMatchObject({ puede_responder: false });
    const r = await beto.post(`/portal/cotizaciones/${c.id}/responder`).send({ respuestas: [{ linea_id: c.lineas[0], decision: 'autorizada' }] });
    expect(r.status).toBe(403);
    expect(r.body.codigo).toBe('SOLO_APROBADOR');
    expect((await sql(m, "SELECT COUNT(*) AS n FROM cotizacion_lineas WHERE cotizacion_id = ? AND estado = 'pendiente'", [c.id]))[0]!['n']).toBe(2);
  });
});

describe('pedir una cita desde el portal', () => {
  it('nace «por confirmar», avisa a la recepción, guarda la lectura y quién la pidió; la recepción la confirma una sola vez', async () => {
    const m = await mundo();
    const recep = await m.t.usuario('recepcionista', 'recepcion@taller.test');
    const ana = como(m, await entrar(m, 'ana@lopez.test'));
    const manana = dia(1);
    const r = await ana.post('/portal/citas').send({ equipo_id: m.equipo, fecha: manana, hora: '09:00', lectura_contador: 5200, notas: 'cambio de aceite' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ por_confirmar: true });
    const fila = (await sql(m, 'SELECT origen, por_confirmar, solicitada_por_contacto_id, lectura_contador, notas, estado FROM citas'))[0]!;
    expect(fila).toMatchObject({ origen: 'portal', por_confirmar: 1, solicitada_por_contacto_id: m.ana, estado: 'programada' });
    expect(Number(fila['lectura_contador'])).toBe(5200);
    expect(String(fila['notas'])).toContain('PEDIDA POR ANA GOMEZ DESDE EL PORTAL');
    const avisos = await correos('aviso_cita_solicitada');
    expect(avisos).toHaveLength(1);
    expect(avisos[0]!.destinatarios).toBe(recep.correo);
    expect(avisos[0]!.cuerpo).toContain('ANA GOMEZ');
    // En la lista de citas de la recepción aparece por confirmar.
    const lista = (await m.api.get(`/citas?desde=${manana}&hasta=${manana}`)).body.data.registros as Array<{ id: number; por_confirmar: number; origen: string }>;
    expect(lista[0]).toMatchObject({ por_confirmar: 1, origen: 'portal' });
    // El cliente la ve «por confirmar»; después de que la recepción la confirme, ya no.
    expect(((await ana.get('/portal/resumen')).body.data.citas as Array<{ por_confirmar: boolean }>)[0]!.por_confirmar).toBe(true);
    const sup = m.t.api(await (await m.t.usuario('visualizador')).token());
    expect((await sup.post(`/citas/${lista[0]!.id}/confirmar`).send({})).status).toBe(403);
    expect((await m.api.post(`/citas/${lista[0]!.id}/confirmar`).send({})).status).toBe(200);
    expect((await m.api.post(`/citas/${lista[0]!.id}/confirmar`).send({})).status).toBe(409); // ya estaba confirmada
    expect(((await ana.get('/portal/resumen')).body.data.citas as Array<{ por_confirmar: boolean }>)[0]!.por_confirmar).toBe(false);
  });

  it('no se puede pedir para un equipo ajeno, en el pasado ni con una hora mal escrita', async () => {
    const m = await mundo();
    const beto = como(m, await entrar(m, 'beto@lopez.test'));
    expect((await beto.post('/portal/citas').send({ equipo_id: m.equipo, fecha: dia(1), hora: '09:00' })).status).toBe(404); // CAM-1 no es de Beto
    expect((await beto.post('/portal/citas').send({ equipo_id: m.ajeno, fecha: dia(1), hora: '09:00' })).status).toBe(404);
    expect((await beto.post('/portal/citas').send({ equipo_id: m.equipo2, fecha: dia(-2), hora: '09:00' })).status).toBe(400);
    expect((await beto.post('/portal/citas').send({ equipo_id: m.equipo2, fecha: dia(1), hora: '25:99' })).status).toBe(400);
    expect((await beto.post('/portal/citas').send({ equipo_id: m.equipo2, fecha: dia(1), hora: '09:00' })).status).toBe(201);
    expect(await sql(m, 'SELECT id FROM citas')).toHaveLength(1);
  });
});

describe('enlaces a la cuenta del cliente', () => {
  const cuenta = async (m: Mundo) => {
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo });
    return m.api.post(`/ordenes/${m.orden}/cuenta`).send({});
  };
  const tokenDe = (url: string): string => /documento\/([0-9a-f]{64})$/.exec(url)![1]!;
  const ver = (m: Mundo, token: string, agente = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)') => m.t.api().get(`/publico/documento/${token}`).set('User-Agent', agente);

  it('sin cuenta emitida no hay enlace; con ella el cliente ve su detalle y su PDF, sin costos; el enlace no se guarda en claro', async () => {
    const m = await mundo();
    expect((await m.api.post(`/ordenes/${m.orden}/enlace-cuenta`).send({})).status).toBe(409);
    await cuenta(m);
    const c = await m.api.post(`/ordenes/${m.orden}/enlace-cuenta`).send({});
    expect(c.status).toBe(201);
    expect(c.body.data.folio).toBe('CTA-000001');
    const token = tokenDe(c.body.data.url);
    expect(await sql(m, 'SELECT huella FROM enlaces_publicos WHERE huella = ?', [token])).toHaveLength(0); // solo queda la huella
    const v = await ver(m, token);
    expect(v.status).toBe(200);
    expect(v.body.data).toMatchObject({ tipo: 'cuenta', folio: 'CTA-000001', version: 1, reemplaza_a_una_anterior: false, aviso: expect.stringContaining('no es una factura') });
    expect(v.body.data.resumen.totales.total).toBeGreaterThan(0);
    expect(v.body.data.url).toContain('/api/archivos/');
    expect(JSON.stringify(v.body.data)).not.toMatch(/costo|tecnico/i);
    expect((await ver(m, 'a'.repeat(64))).status).toBe(404);
    expect((await ver(m, 'no-es-un-enlace')).status).toBe(404);
    const sup = m.t.api(await (await m.t.usuario('visualizador')).token());
    expect((await sup.post(`/ordenes/${m.orden}/enlace-cuenta`).send({})).status).toBe(403);
  });

  it('el mismo enlace muestra la versión vigente: si se emite una cuenta nueva, avisa que reemplaza a la anterior', async () => {
    const m = await mundo();
    await cuenta(m);
    const token = tokenDe((await m.api.post(`/ordenes/${m.orden}/enlace-cuenta`).send({})).body.data.url);
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado', cantidad: 1, precio_unitario: 300, costo: 100 });
    expect((await m.api.post(`/ordenes/${m.orden}/cuenta`).send({})).status).toBe(201);
    const v = (await ver(m, token)).body.data;
    expect(v).toMatchObject({ version: 2, reemplaza_a_una_anterior: true });
    expect(v.resumen.lineas).toHaveLength(2);
  });

  it('crear uno nuevo anula el anterior; «revocar todos» deja sin efecto los de la cuenta y los de las cotizaciones de la orden; caduca', async () => {
    const m = await mundo();
    await cuenta(m);
    const t1 = tokenDe((await m.api.post(`/ordenes/${m.orden}/enlace-cuenta`).send({})).body.data.url);
    const t2 = tokenDe((await m.api.post(`/ordenes/${m.orden}/enlace-cuenta`).send({})).body.data.url);
    expect((await ver(m, t1)).status).toBe(404);
    expect((await ver(m, t2)).status).toBe(200);
    // Un enlace de cotización de la misma orden.
    const cot = (await m.api.post('/cotizaciones').send({ orden_id: m.orden })).body.data as { id: number };
    await m.api.post(`/cotizaciones/${cot.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo });
    await m.api.post(`/cotizaciones/${cot.id}/enviar`).send({});
    const tc = /cotizacion\/([0-9a-f]{64})$/.exec((await m.api.post(`/cotizaciones/${cot.id}/enlace`).send({})).body.data.url as string)![1]!;
    const lista = (await m.api.get(`/ordenes/${m.orden}/enlaces`)).body.data as Array<{ tipo: string; vigente: boolean }>;
    expect(lista.filter((x) => x.vigente).map((x) => x.tipo).sort()).toEqual(['cotizacion', 'cuenta']);
    const rv = await m.api.post(`/ordenes/${m.orden}/enlaces/revocar`).send({});
    expect(rv.body.data.revocados).toBe(2);
    expect((await ver(m, t2)).status).toBe(404);
    expect((await m.t.api().get(`/publico/cotizacion/${tc}`)).status).toBe(404);
    // Caduca a los 30 días.
    const t3 = tokenDe((await m.api.post(`/ordenes/${m.orden}/enlace-cuenta`).send({})).body.data.url);
    expect((await ver(m, t3)).status).toBe(200);
    e.reloj.fijo = new Date(Date.now() + 31 * 86400000);
    expect((await ver(m, t3)).status).toBe(404);
  });

  it('la primera apertura real avisa a quien lo creó y queda en la bitácora del cliente; las vistas previas automáticas no cuentan', async () => {
    const m = await mundo();
    await m.api.put('/avisos/enlace_primera_apertura').send({ activo: true, incluir_contextual: true, roles: [], usuarios: [], correos: [] });
    await cuenta(m);
    const token = tokenDe((await m.api.post(`/ordenes/${m.orden}/enlace-cuenta`).send({})).body.data.url);
    expect((await ver(m, token, 'WhatsApp/2.23 A')).status).toBe(200);
    expect(await correos('aviso_enlace_primera_apertura')).toHaveLength(0);
    expect(await sql(m, 'SELECT id FROM accesos_cliente')).toHaveLength(0);
    expect((await ver(m, token)).status).toBe(200);
    expect((await ver(m, token)).status).toBe(200);
    const c = await correos('aviso_enlace_primera_apertura');
    expect(c).toHaveLength(1);
    expect(c[0]!.asunto).toContain('CTA-000001');
    const accesos = (await m.api.get(`/clientes/${m.cliente}/accesos`)).body.data as Array<{ canal: string; tipo: string; referencia: string }>;
    expect(accesos).toHaveLength(2);
    expect(accesos[0]).toMatchObject({ canal: 'enlace', tipo: 'cuenta', referencia: 'CTA-000001' });
    const l = (await m.api.get(`/ordenes/${m.orden}/enlaces`)).body.data as Array<{ aperturas: number; referencia: string }>;
    expect(l[0]).toMatchObject({ aperturas: 2, referencia: 'CTA-000001' });
  });
});

describe('código QR del equipo', () => {
  const codigoDe = async (m: Mundo, equipo = m.equipo) => (await m.api.get(`/equipos/${equipo}/qr`)).body.data as { codigo: string; url: string; etiqueta: string };
  const ver = (m: Mundo, codigo: string, agente = 'Mozilla/5.0 (iPhone)') => m.t.api().get(`/publico/equipo/${codigo}`).set('User-Agent', agente);

  it('el código impreso es una clave al azar del equipo (sin id ni empresa); quien lo escanea ve la ficha y el historial sin costos', async () => {
    const m = await mundo();
    const qr = await codigoDe(m);
    expect(qr.codigo).toMatch(/^[0-9a-f]{16}$/);
    expect(qr.url).toMatch(new RegExp(`/equipo/${qr.codigo}$`));
    expect(qr.etiqueta).toBe('CAM-1 · C123ABC');
    // Una orden terminada con un trabajo, un material de costo conocido y una cancelada que no debe salir.
    const linea = (await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).body.data.lineas[0].id as number;
    expect((await m.api.post(`/lineas/${linea}/estado`).send({ estado: 'terminado' })).status).toBe(200);
    expect((await m.api.post(`/ordenes/${m.orden}/estado`).send({ estado_id: m.estados['ENTREGADA'] })).status).toBe(200);
    expect((await m.api.post(`/ordenes/${m.orden}/estado`).send({ estado_id: m.estados['CERRADA'] })).status).toBe(200);
    const v = await ver(m, qr.codigo);
    expect(v.status).toBe(200);
    const d = v.body.data;
    expect(d.equipo).toMatchObject({ etiqueta: 'CAM-1 · C123ABC', placa: 'C123ABC', fuera_de_servicio: false });
    expect(d.historial).toHaveLength(1);
    expect(d.historial[0].trabajos).toHaveLength(1);
    expect(JSON.stringify(d)).not.toMatch(/costo|precio|tecnico|tarifa|cliente/i);
    expect(d.taller).toBeTruthy();
  });

  it('un código inventado o mal escrito responde siempre lo mismo; las vistas previas no cuentan en la bitácora; cada escaneo real sí', async () => {
    const m = await mundo();
    const qr = await codigoDe(m);
    const a = await ver(m, 'f'.repeat(16));
    const b = await ver(m, 'esto no es un codigo');
    expect(a.status).toBe(404);
    expect(a.body).toEqual(b.body);
    expect((await ver(m, qr.codigo, 'Slackbot-LinkExpanding')).status).toBe(200);
    expect(await sql(m, 'SELECT id FROM accesos_cliente')).toHaveLength(0);
    expect((await ver(m, qr.codigo)).status).toBe(200);
    expect((await ver(m, qr.codigo)).status).toBe(200);
    const accesos = (await m.api.get(`/clientes/${m.cliente}/accesos`)).body.data as Array<{ canal: string; tipo: string; referencia: string }>;
    expect(accesos).toHaveLength(2);
    expect(accesos[0]).toMatchObject({ canal: 'qr', tipo: 'equipo', referencia: 'CAM-1 · C123ABC' });
  });

  it('al cambiar el código el impreso deja de servir; solo quien edita equipos lo cambia', async () => {
    const m = await mundo();
    const viejo = (await codigoDe(m)).codigo;
    const sup = m.t.api(await (await m.t.usuario('visualizador')).token());
    expect((await sup.post(`/equipos/${m.equipo}/qr/regenerar`).send({})).status).toBe(403);
    expect((await sup.get(`/equipos/${m.equipo}/qr`)).status).toBe(200); // verlo sí
    const nuevo = (await m.api.post(`/equipos/${m.equipo}/qr/regenerar`).send({})).body.data as { codigo: string };
    expect(nuevo.codigo).not.toBe(viejo);
    expect((await ver(m, viejo)).status).toBe(404);
    expect((await ver(m, nuevo.codigo)).status).toBe(200);
    expect(await sql(m, "SELECT accion FROM bitacora WHERE accion = 'qr_regenerado'")).toHaveLength(1);
  });
});

describe('sesiones del portal y bitácora, del lado del taller', () => {
  it('el taller ve quién puede entrar y las sesiones abiertas, y las puede cerrar; lo que el cliente vio queda en su ficha', async () => {
    const m = await mundo();
    const ana = como(m, await entrar(m, 'ana@lopez.test'));
    expect((await ana.get(`/portal/equipos/${m.equipo}`)).status).toBe(200);
    const p = (await m.api.get(`/clientes/${m.cliente}/portal`)).body.data as { contactos: Array<{ nombre: string; puede_entrar: boolean }>; sesiones: Array<{ correo: string; vigente: boolean }> };
    expect(p.contactos.map((c) => c.nombre).sort()).toEqual(['ANA GOMEZ', 'BETO DIAZ']);
    expect(p.contactos.every((c) => c.puede_entrar)).toBe(true);
    expect(p.sesiones).toEqual([expect.objectContaining({ correo: 'ana@lopez.test', vigente: true })]);
    const accesos = (await m.api.get(`/clientes/${m.cliente}/accesos`)).body.data as Array<{ canal: string; tipo: string; contacto: string | null }>;
    expect(accesos.map((a) => a.tipo).sort()).toEqual(['entrada', 'equipo']); // entró y miró un equipo
    expect(accesos.every((a) => a.canal === 'portal' && a.contacto === 'ANA GOMEZ')).toBe(true);
    // Cerrar las sesiones de Ana.
    expect((await m.api.post(`/clientes/${m.cliente}/portal/revocar`).send({ correo: 'otro@nadie.test' })).status).toBe(404);
    const r = await m.api.post(`/clientes/${m.cliente}/portal/revocar`).send({ correo: 'ANA@lopez.test' });
    expect(r.body.data.revocadas).toBe(1);
    expect((await ana.get('/portal/resumen')).status).toBe(401);
    // Sin el permiso de ver clientes no se ve nada de esto.
    const bodega = m.t.api(await (await m.t.usuario('bodeguero')).token());
    expect((await bodega.post(`/clientes/${m.cliente}/portal/revocar`).send({ correo: 'ana@lopez.test' })).status).toBe(403);
  });

  it('un contacto al que se le quita el correo o se desactiva pierde el acceso aunque su sesión siga abierta', async () => {
    const m = await mundo();
    const ana = como(m, await entrar(m, 'ana@lopez.test'));
    expect((await ana.get('/portal/resumen')).status).toBe(200);
    await sql(m, 'UPDATE contactos_cliente SET activo = 0 WHERE id = ?', [m.ana]);
    expect((await ana.get('/portal/resumen')).status).toBe(401);
  });
});
