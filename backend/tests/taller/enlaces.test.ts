import { createHash } from 'crypto';
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
  orden: number;
  motivoRechazo: number;
}
interface Cot {
  id: number;
  estado: string;
  lineas: Array<{ id: number; estado: string; respondida_por_nombre: string | null }>;
}
interface Publica {
  disponible: boolean;
  moneda?: string;
  aviso?: string;
  estado: string;
  empresa: string;
  numero: string;
  cliente: string | null;
  equipo: string | null;
  se_puede_responder: boolean;
  vencida: boolean;
  total: number;
  motivos_rechazo: Array<{ id: number }>;
  lineas: Array<{ id: number; estado: string; descripcion: string; precio_unitario: number; total_linea: number; respondida_por_nombre: string | null; motivo_rechazo: string | null }>;
}

async function mundo(): Promise<Mundo> {
  const base = await mundoDeOrdenes(e);
  const orden = ordenId(await nueva(base));
  const motivoRechazo = ((await base.api.get('/cotizaciones-opciones')).body.data as { motivos_rechazo: Array<{ id: number }> }).motivos_rechazo[0]!.id;
  return { ...base, orden, motivoRechazo };
}

/** Una cotización enviada con dos líneas (un trabajo y un trabajo con terceros). */
async function enviada(m: Mundo, vence?: string): Promise<Cot> {
  const c = (await m.api.post('/cotizaciones').send({ orden_id: m.orden })).body.data as Cot;
  expect((await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).status).toBe(201);
  expect((await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado', cantidad: 1, precio_unitario: 300, costo: 120 })).status).toBe(201);
  const r = await m.api.post(`/cotizaciones/${c.id}/enviar`).send(vence ? { vence_en: vence } : {});
  expect(r.status).toBe(200);
  return r.body.data as Cot;
}
const enlace = async (m: Mundo, cotId: number): Promise<string> => {
  const r = await m.api.post(`/cotizaciones/${cotId}/enlace`).send({});
  expect(r.status).toBe(201);
  return /cotizacion\/([0-9a-f]{64})$/.exec(r.body.data.url as string)![1]!;
};
const publico = (m: Mundo) => m.t.api();
const ver = (m: Mundo, token: string, agente = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)') => publico(m).get(`/publico/cotizacion/${token}`).set('User-Agent', agente);
const responder = (m: Mundo, token: string, cuerpo: Record<string, unknown>, agente = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)') => publico(m).post(`/publico/cotizacion/${token}/responder`).set('User-Agent', agente).send(cuerpo);
const cot = async (m: Mundo, id: number) => (await m.api.get(`/cotizaciones/${id}`)).body.data as Cot;

describe('crear y cuidar el enlace', () => {
  it('solo se crea para una cotización enviada; el enlace no se guarda (solo su huella); uno nuevo anula los anteriores y se puede revocar', async () => {
    const m = await mundo();
    const borrador = (await m.api.post('/cotizaciones').send({ orden_id: m.orden })).body.data as Cot;
    expect((await m.api.post(`/cotizaciones/${borrador.id}/enlace`).send({})).status).toBe(409);
    const c = await enviada(m);
    const r = await m.api.post(`/cotizaciones/${c.id}/enlace`).send({});
    expect(r.status).toBe(201);
    expect(r.body.data.url).toMatch(new RegExp(`/${m.t.slug}/cotizacion/[0-9a-f]{64}$`));
    const token1 = /cotizacion\/([0-9a-f]{64})$/.exec(r.body.data.url as string)![1]!;
    const guardado = await m.t.sql(async (con) => (await con.query('SELECT huella, vence_en FROM enlaces_publicos'))[0] as Array<{ huella: string; vence_en: Date }>);
    expect(guardado).toHaveLength(1);
    expect(guardado[0]!.huella).toBe(createHash('sha256').update(token1).digest('hex'));
    expect(JSON.stringify(guardado)).not.toContain(token1); // el enlace en sí no está en la base
    expect(Math.round((guardado[0]!.vence_en.getTime() - Date.now()) / 86400000)).toBe(30);

    expect((await ver(m, token1)).status).toBe(200);
    const token2 = await enlace(m, c.id);
    expect((await ver(m, token1)).status).toBe(404); // el nuevo anuló al anterior
    expect((await ver(m, token2)).status).toBe(200);
    const lista = (await m.api.get(`/cotizaciones/${c.id}/enlaces`)).body.data as Array<{ vigente: boolean; aperturas: number }>;
    expect(lista.map((x) => x.vigente)).toEqual([true, false]);

    expect((await m.api.post(`/cotizaciones/${c.id}/enlace/revocar`).send({})).body.data.revocados).toBe(1);
    expect((await ver(m, token2)).status).toBe(404);
    // Permisos: ver los enlaces sí, crearlos no.
    const visualizador = m.t.api(await (await m.t.usuario('visualizador')).token());
    expect((await visualizador.get(`/cotizaciones/${c.id}/enlaces`)).status).toBe(200);
    expect((await visualizador.post(`/cotizaciones/${c.id}/enlace`).send({})).status).toBe(403);
    expect((await visualizador.post(`/cotizaciones/${c.id}/enlace/revocar`).send({})).status).toBe(403);
  });
});

describe('lo que ve el cliente', () => {
  it('abre sin sesión, ve la cotización sin costos ni datos internos; un enlace malo, revocado o vencido responde siempre lo mismo', async () => {
    const m = await mundo();
    const c = await enviada(m);
    const token = await enlace(m, c.id);
    const r = await ver(m, token);
    expect(r.status).toBe(200);
    const d = r.body.data as Publica;
    expect(d.moneda).toBe('GTQ');
    expect(d).toMatchObject({ disponible: true, estado: 'enviada', cliente: 'INDUSTRIAS LOPEZ', equipo: 'CAM-1 · C123ABC', se_puede_responder: true, total: 537.6 });
    expect(d.lineas.map((l) => [l.descripcion, l.precio_unitario, l.total_linea])).toEqual([[expect.any(String), 200, 180], [expect.stringContaining('RECTIFICADO'), 300, 300]]);
    expect(d.motivos_rechazo.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(/costo|creada_por|respondida_por"|usuario|tecnico/i);

    const igual = await ver(m, 'a'.repeat(64));
    expect(igual.status).toBe(404);
    expect((await ver(m, 'corto')).status).toBe(404);
    expect(igual.body).toEqual((await ver(m, 'b'.repeat(63) + 'c')).body); // mismo mensaje para cualquier enlace malo
    await m.api.post(`/cotizaciones/${c.id}/enlace/revocar`).send({});
    expect((await ver(m, token)).body).toEqual(igual.body); // revocado = igual que inexistente

    // Un enlace que caducó.
    const token2 = await enlace(m, c.id);
    e.reloj.fijo = new Date(Date.now() + 31 * 86400000);
    expect((await ver(m, token2)).status).toBe(404);
  });

  it('cuenta las aperturas reales (no las vistas previas de WhatsApp o el correo) y guarda la primera', async () => {
    const m = await mundo();
    const c = await enviada(m);
    const token = await enlace(m, c.id);
    expect((await ver(m, token, 'WhatsApp/2.23.20 A')).status).toBe(200);
    expect((await ver(m, token, 'facebookexternalhit/1.1')).status).toBe(200);
    let l = (await m.api.get(`/cotizaciones/${c.id}/enlaces`)).body.data as Array<{ aperturas: number; primera_apertura_en: string | null }>;
    expect(l[0]).toMatchObject({ aperturas: 0, primera_apertura_en: null });
    const hora1 = new Date(Date.now() + 3600000);
    e.reloj.fijo = hora1;
    expect((await ver(m, token)).status).toBe(200);
    e.reloj.fijo = new Date(hora1.getTime() + 7200000);
    expect((await ver(m, token)).status).toBe(200);
    e.reloj.fijo = null;
    const reg = await m.t.sql(async (con) => (await con.query('SELECT aperturas, primera_apertura_en, ultima_apertura_en, primera_apertura_ip FROM enlaces_publicos'))[0] as Array<{ aperturas: number; primera_apertura_en: Date; ultima_apertura_en: Date; primera_apertura_ip: string | null }>);
    expect(reg[0]!.aperturas).toBe(2);
    expect(reg[0]!.primera_apertura_ip).toBeTruthy();
    const seg = (d: Date): number => Math.round(d.getTime() / 1000);
    expect(Math.abs(seg(reg[0]!.primera_apertura_en) - seg(hora1))).toBeLessThanOrEqual(1); // la primera no se pisa (la base puede redondear el segundo)
    expect(Math.abs(seg(reg[0]!.ultima_apertura_en) - (seg(hora1) + 7200))).toBeLessThanOrEqual(1);
    expect(seg(reg[0]!.ultima_apertura_en) - seg(reg[0]!.primera_apertura_en)).toBeGreaterThanOrEqual(7199);
  });

  it('una cotización reemplazada o anulada ya no se muestra y avisa por qué', async () => {
    const m = await mundo();
    const c = await enviada(m);
    const token = await enlace(m, c.id);
    expect((await m.api.post(`/cotizaciones/${c.id}/nueva-version`).send({})).status).toBe(201);
    const r = (await ver(m, token)).body.data as Publica;
    expect(r).toMatchObject({ disponible: false, aviso: expect.stringContaining('reemplazada') });
    expect(r).not.toHaveProperty('lineas');
    const d = await enviada(m);
    const t2 = await enlace(m, d.id);
    await m.api.post(`/cotizaciones/${d.id}/anular`).send({ motivo: 'ya no aplica' });
    expect(((await ver(m, t2)).body.data as Publica).disponible).toBe(false);
  });
});

describe('la respuesta del cliente', () => {
  it('autoriza o rechaza cada línea con su nombre; queda cuándo, desde dónde y por qué enlace; una respuesta no se cambia', async () => {
    const m = await mundo();
    const c = await enviada(m);
    const token = await enlace(m, c.id);
    const [l1, l2] = c.lineas;
    expect((await responder(m, token, { nombre: 'ab', respuestas: [{ linea_id: l1!.id, decision: 'autorizada' }] })).status).toBe(400); // el nombre
    expect((await responder(m, token, { nombre: 'Maria Lopez', respuestas: [] })).status).toBe(400);
    // Todo o nada: un rechazo sin motivo no deja pasar tampoco la autorización de la otra línea.
    const mala = await responder(m, token, { nombre: 'Maria Lopez', respuestas: [{ linea_id: l1!.id, decision: 'autorizada' }, { linea_id: l2!.id, decision: 'rechazada' }] });
    expect(mala.status).toBe(400);
    expect((await cot(m, c.id)).lineas.map((l) => l.estado)).toEqual(['pendiente', 'pendiente']);
    expect((await responder(m, token, { nombre: 'Maria Lopez', respuestas: [{ linea_id: 99999, decision: 'autorizada' }] })).status).toBe(400); // línea ajena

    const parcial = await responder(m, token, { nombre: 'maria lopez', respuestas: [{ linea_id: l1!.id, decision: 'autorizada' }] }, 'Mozilla/5.0 Safari iPhone');
    expect(parcial.status).toBe(200);
    expect((parcial.body.data as Publica).se_puede_responder).toBe(true); // falta una
    expect((await cot(m, c.id)).estado).toBe('enviada');
    // La línea ya respondida no se cambia aunque la cotización siga abierta.
    expect((await responder(m, token, { nombre: 'Maria Lopez', respuestas: [{ linea_id: l1!.id, decision: 'rechazada', motivo_id: m.motivoRechazo }] })).status).toBe(409);
    expect((await cot(m, c.id)).lineas[0]!.estado).toBe('autorizada');
    const completa = await responder(m, token, { nombre: 'Maria Lopez', respuestas: [{ linea_id: l2!.id, decision: 'rechazada', motivo_id: m.motivoRechazo, motivo_texto: 'lo hace otro taller' }] });
    expect(completa.status).toBe(200);
    expect((completa.body.data as Publica).lineas.map((l) => [l.estado, l.respondida_por_nombre, l.motivo_rechazo !== null])).toEqual([['autorizada', 'MARIA LOPEZ', false], ['rechazada', 'MARIA LOPEZ', true]]);
    expect(completa.body.data.se_puede_responder).toBe(false);
    const x = await cot(m, c.id);
    expect(x.estado).toBe('respondida');
    expect(x.lineas[0]).toMatchObject({ estado: 'autorizada', respondida_por_nombre: 'MARIA LOPEZ' }); // lo ve el taller
    const reg = await m.t.sql(async (con) => (await con.query('SELECT dispositivo, ip, enlace_id, respondida_en FROM cotizacion_lineas ORDER BY id'))[0] as Array<{ dispositivo: string | null; ip: string | null; enlace_id: number | null; respondida_en: Date | null }>);
    expect(reg[0]).toMatchObject({ dispositivo: 'Mozilla/5.0 Safari iPhone', enlace_id: expect.any(Number) });
    expect(reg[0]!.ip).toBeTruthy();
    expect(reg[0]!.respondida_en).not.toBeNull();
    const bit = await m.t.sql(async (con) => (await con.query("SELECT usuario_id FROM bitacora WHERE accion = 'cotizacion_respondida_por_enlace'"))[0] as Array<{ usuario_id: number | null }>);
    expect(bit.map((b) => b.usuario_id)).toEqual([null, null]);

    expect((await responder(m, token, { nombre: 'Maria Lopez', respuestas: [{ linea_id: l1!.id, decision: 'rechazada', motivo_id: m.motivoRechazo }] })).status).toBe(409); // ya respondida: no se cambia
    // Lo autorizado sigue el camino normal: una persona lo agrega a la orden.
    expect((await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({})).status).toBe(200);
  });

  it('no se responde con el enlace revocado, ni una cotización vencida, ni una anulada; el enlace solo responde su cotización', async () => {
    const m = await mundo();
    const c = await enviada(m, dia(0)); // vale hasta el final de hoy
    const token = await enlace(m, c.id);
    const otra = await enviada(m);
    const tokenOtra = await enlace(m, otra.id);
    // Con el enlace de OTRA cotización no se responde esta línea.
    expect((await responder(m, tokenOtra, { nombre: 'Maria Lopez', respuestas: [{ linea_id: c.lineas[0]!.id, decision: 'autorizada' }] })).status).toBe(400);
    expect((await cot(m, c.id)).lineas[0]!.estado).toBe('pendiente');

    e.reloj.fijo = new Date(Date.now() + 3 * 86400000);
    const manana = m.t.api(await m.t.token());
    const vencida = await manana.post(`/publico/cotizacion/${token}/responder`).send({ nombre: 'Maria Lopez', respuestas: [{ linea_id: c.lineas[0]!.id, decision: 'autorizada' }] });
    expect(vencida.status).toBe(409);
    expect(vencida.body.codigo).toBe('COTIZACION_VENCIDA');
    expect(((await manana.get(`/publico/cotizacion/${token}`)).body.data as Publica)).toMatchObject({ vencida: true, se_puede_responder: false }); // se ve, pero ya no se responde

    e.reloj.fijo = null;
    await m.api.post(`/cotizaciones/${otra.id}/anular`).send({ motivo: 'se cancelo' });
    expect((await responder(m, tokenOtra, { nombre: 'Maria Lopez', respuestas: [{ linea_id: otra.lineas[0]!.id, decision: 'autorizada' }] })).status).toBe(409);
    await m.api.post(`/cotizaciones/${c.id}/enlace/revocar`).send({});
    expect((await responder(m, token, { nombre: 'Maria Lopez', respuestas: [{ linea_id: c.lineas[0]!.id, decision: 'autorizada' }] })).status).toBe(404);
  });
});
