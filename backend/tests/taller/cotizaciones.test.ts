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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);

interface Mundo extends MundoOrdenes {
  bodega: number;
  material: number;
  orden: number;
  motivoRechazo: number;
  tipoFrenos: number;
}

interface Linea {
  id: number;
  tipo: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  total_linea: number;
  costo?: number;
  estado: string;
  respuesta_id: number | null;
  solicitud: string | null;
  agregada_orden: string | null;
  motivo_rechazo: string | null;
}
interface Cot {
  id: number;
  numero: string;
  version: number;
  estado: string;
  orden: string | null;
  equipo: string | null;
  cliente: string | null;
  subtotal: number;
  descuento_total: number;
  iva: number;
  total: number;
  vence_en: string | null;
  version_nueva_id: number | null;
  lineas: Linea[];
  hallazgos: Array<{ respuesta_id: number; descripcion: string; desenlace: { estado: string; cotizacion: string | null; motivo: string | null }; fotos: Array<{ url: string }> }>;
}

/** Un taller con un cliente (10 % en trabajos, 20 % en materiales, 5 % en lo demás), un vehículo, un trabajo de 2 h a 100 la hora, un material con 10 unidades y una orden abierta. */
async function mundo(): Promise<Mundo> {
  const base = await mundoDeOrdenes(e);
  const tipoCliente = ((await base.api.get('/tipos-cliente')).body.data as Array<{ id: number }>)[0]!.id;
  expect((await base.api.patch(`/tipos-cliente/${tipoCliente}`).send({ descuento_materiales: 20, descuento_otros: 5 })).status).toBe(200);
  const sucursal = ((await base.api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id;
  const bodega = (await base.api.post('/bodegas').send({ nombre: 'Bodega principal', sucursal_id: sucursal })).body.data.id as number;
  const op = (await base.api.get('/inventario-opciones')).body.data as { unidades: Array<{ id: number; codigo: string }>; partes: Array<{ id: number; clasificacion: string }> };
  const material = (await base.api.post('/materiales').send({ codigo: 'FIL-ACE', nombre: 'Filtro de aceite', parte_id: op.partes.find((p) => p.clasificacion.startsWith('99-'))!.id, unidad_id: op.unidades.find((u) => u.codigo === 'UND')!.id })).body.data.id as number;
  expect((await base.api.post('/compras').send({ proveedor_id: base.proveedor, bodega_id: bodega, fecha_documento: dia(0), lineas: [{ material_id: material, cantidad: 10, costo_unitario: 10 }] })).status).toBe(201);
  const orden = ordenId(await nueva(base));
  const motivoRechazo = ((await base.api.get('/cotizaciones-opciones')).body.data as { motivos_rechazo: Array<{ id: number }> }).motivos_rechazo[0]!.id;
  const etapa = (await base.t.sql(async (c) => (await c.query("SELECT id FROM etapas WHERE codigo = 'MANTENIMIENTO'"))[0] as Array<{ id: number }>))[0]!.id;
  const tipoFrenos = (await base.api.post('/checklists-tipos').send({ codigo: 'frenos', nombre: 'Revision de frenos', etapa_id: etapa, requiere_firma_cliente: false })).body.data.id as number;
  expect((await base.api.put(`/checklists-tipos/${tipoFrenos}/plantilla`).send({ secciones: [{ nombre: 'Frenos', items: [{ descripcion: 'Pastillas', tipo_respuesta: 'semaforo' }, { descripcion: 'Discos', tipo_respuesta: 'semaforo' }] }] })).status).toBe(200);
  return { ...base, bodega, material, orden, motivoRechazo, tipoFrenos };
}

const cot = async (m: Mundo, id: number) => (await m.api.get(`/cotizaciones/${id}`)).body.data as Cot;
const crear = async (m: Mundo, cuerpo: Record<string, unknown> = { orden_id: m.orden }) => {
  const r = await m.api.post('/cotizaciones').send(cuerpo);
  expect(r.status).toBe(201);
  return r.body.data as Cot;
};
const linea = (m: Mundo, id: number, cuerpo: Record<string, unknown>) => m.api.post(`/cotizaciones/${id}/lineas`).send(cuerpo);
const servicio = (m: Mundo, id: number, extra: Record<string, unknown> = {}) => linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo, ...extra });
const mat = (m: Mundo, id: number, cantidad: number, extra: Record<string, unknown> = {}) => linea(m, id, { tipo: 'material', material_id: m.material, cantidad, ...extra });
const tercero = (m: Mundo, id: number, extra: Record<string, unknown> = {}) => linea(m, id, { tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado de discos', cantidad: 2, precio_unitario: 100, costo: 60, ...extra });
const enviar = (m: Mundo, id: number, cuerpo: Record<string, unknown> = {}) => m.api.post(`/cotizaciones/${id}/enviar`).send(cuerpo);
const autorizar = (m: Mundo, lineaId: number) => m.api.post(`/cotizacion-lineas/${lineaId}/responder`).send({ decision: 'autorizada' });
const rechazar = (m: Mundo, lineaId: number, motivo: number | null = m.motivoRechazo) => m.api.post(`/cotizacion-lineas/${lineaId}/responder`).send({ decision: 'rechazada', motivo_id: motivo });

/** Abre un checklist de frenos en la orden y responde sus dos ítems con las notas indicadas (rojo con foto). Devuelve los ids de las respuestas. */
async function checklistConRojos(m: Mundo, ordenDe: number, semaforos: Array<'rojo' | 'verde'>, completar = false) {
  const c = await m.api.post(`/ordenes/${ordenDe}/checklists`).send({ tipo_id: m.tipoFrenos });
  expect(c.status).toBe(201);
  const id = c.body.data.id as number;
  const resp = ((await m.api.get(`/checklists/${id}`)).body.data as { respuestas: Array<{ id: number }> }).respuestas;
  for (const [i, s] of semaforos.entries()) {
    expect((await m.api.patch(`/checklists/${id}/respuestas/${resp[i]!.id}`).send({ semaforo: s, nota: s === 'rojo' ? 'desgaste fuerte' : undefined })).status).toBe(200);
    if (s === 'rojo') expect((await m.api.post(`/checklists/${id}/respuestas/${resp[i]!.id}/fotos`).set('Content-Type', 'image/png').set('X-Nombre-Archivo', 'a.png').send(PNG)).status).toBe(201);
  }
  if (completar) expect((await m.api.post(`/checklists/${id}/completar`).send({})).status).toBe(200);
  return { id, respuestas: resp.map((r) => r.id) };
}
const desenlaces = async (m: Mundo, checklistId: number) => ((await m.api.get(`/checklists/${checklistId}`)).body.data as { respuestas: Array<{ id: number; desenlace?: { estado: string; cotizacion: string | null; motivo: string | null } }> }).respuestas;

describe('armar la cotización', () => {
  it('trae cliente y equipo de la orden; calcula precio, descuento por tipo de cliente, costo y totales; solo el borrador se edita', async () => {
    const m = await mundo();
    const c = await crear(m);
    expect(c).toMatchObject({ numero: 'COT-000001', version: 1, estado: 'borrador', cliente: 'INDUSTRIAS LOPEZ', equipo: 'CAM-1 · C123ABC', total: 0 });

    expect((await servicio(m, c.id)).status).toBe(201);
    expect((await mat(m, c.id, 3)).status).toBe(201);
    const r = await tercero(m, c.id);
    expect(r.status).toBe(201);
    const x = r.body.data as Cot;
    expect(x.lineas.map((l) => ({ tipo: l.tipo, precio: l.precio_unitario, desc: l.descuento_pct, total: l.total_linea, costo: l.costo }))).toEqual([
      { tipo: 'servicio', precio: 200, desc: 10, total: 180, costo: 80 }, // 2 h × 100, 10 % en trabajos
      { tipo: 'material', precio: 13, desc: 20, total: 31.2, costo: 30 }, // costo 10 + 30 %, 20 % en materiales
      { tipo: 'tercero', precio: 100, desc: 5, total: 190, costo: 60 }, // 2 × 100, 5 % en lo demás
    ]);
    expect(x).toMatchObject({ subtotal: 439, descuento_total: 37.8, iva: 48.14, total: 449.34 });

    // Editar: horas de un trabajo, cantidad de un material, precio de un tercero.
    const [s, mt, tr] = x.lineas;
    expect(((await m.api.patch(`/cotizacion-lineas/${s!.id}`).send({ horas: 3 })).body.data as Cot).lineas[0]).toMatchObject({ precio_unitario: 300, total_linea: 270, costo: 120 });
    expect(((await m.api.patch(`/cotizacion-lineas/${mt!.id}`).send({ cantidad: 5 })).body.data as Cot).lineas[1]).toMatchObject({ cantidad: 5, total_linea: 52, costo: 50 });
    expect((await m.api.patch(`/cotizacion-lineas/${tr!.id}`).send({ precio_unitario: 150 })).body.data.lineas[2]).toMatchObject({ precio_unitario: 150, total_linea: 285 });
    expect((await m.api.patch(`/cotizacion-lineas/${s!.id}`).send({ precio_unitario: 1 })).status).toBe(400); // el precio de un trabajo sale de horas × tarifa
    expect((await m.api.patch(`/cotizacion-lineas/${mt!.id}`).send({ cantidad: 1.5 })).status).toBe(400);
    const sinTercero = (await m.api.delete(`/cotizacion-lineas/${tr!.id}`)).body.data as Cot;
    expect(sinTercero.lineas).toHaveLength(2);
    expect(sinTercero.total).toBeCloseTo(((270 + 52) * 1.12), 2);

    // Validaciones.
    expect((await servicio(m, c.id, { trabajo_id: m.trabajoSinHoras })).status).toBe(409); // sin horas para ese tipo de equipo
    expect((await mat(m, c.id, 1.5)).status).toBe(400);
    expect((await linea(m, c.id, { tipo: 'tercero', descripcion: 'sin proveedor' })).status).toBe(400);
    expect((await mat(m, c.id, 1, { respuesta_id: 99999 })).status).toBe(400); // un rojo que no está en la cotización

    // Una cotización sin equipo no puede cotizar trabajos del catálogo (las horas dependen del tipo de equipo), pero sí materiales y terceros.
    const libre = await crear(m, { cliente_id: m.cliente });
    expect(libre).toMatchObject({ equipo: null, orden: null, cliente: 'INDUSTRIAS LOPEZ' });
    expect((await servicio(m, libre.id)).status).toBe(409);
    expect((await mat(m, libre.id, 1)).status).toBe(201);
    // El equipo no es el de la orden.
    expect((await m.api.post('/cotizaciones').send({ orden_id: m.orden, equipo_id: 99999 })).status).toBe(400);
  });

  it('sin permiso de costos no salen; quién puede cotizar y quién solo ver', async () => {
    const m = await mundo();
    const c = await crear(m);
    await tercero(m, c.id);
    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    const vista = (await recepcion.get(`/cotizaciones/${c.id}`)).body.data as Cot;
    expect(vista.lineas[0]).not.toHaveProperty('costo');
    expect((await m.api.get(`/cotizaciones/${c.id}`)).body.data.lineas[0]).toHaveProperty('costo');
    const tecnico = m.t.api(await (await m.t.usuario('tecnico')).token());
    expect((await tecnico.get('/cotizaciones')).status).toBe(403);
    const visualizador = m.t.api(await (await m.t.usuario('visualizador')).token());
    expect((await visualizador.get('/cotizaciones')).status).toBe(200);
    expect((await visualizador.post('/cotizaciones').send({ orden_id: m.orden })).status).toBe(403);
    expect((await visualizador.post(`/cotizaciones/${c.id}/enviar`).send({})).status).toBe(403);
    expect((await recepcion.post('/cotizaciones').send({ orden_id: m.orden })).status).toBe(201);
  });
});

describe('enviar, responder y vencer', () => {
  it('enviar pide líneas y fija la vigencia; lo enviado no se edita; cada línea se autoriza o se rechaza (con motivo) y no se cambia', async () => {
    const m = await mundo();
    const c = await crear(m);
    expect((await enviar(m, c.id)).status).toBe(409); // sin líneas
    await servicio(m, c.id);
    await mat(m, c.id, 2);
    await tercero(m, c.id);
    expect((await enviar(m, c.id, { vence_en: dia(-1) })).status).toBe(400);
    const env = (await enviar(m, c.id)).body.data as Cot;
    expect(env).toMatchObject({ estado: 'enviada', vence_en: dia(15) });
    expect((await servicio(m, c.id)).status).toBe(409);
    expect((await m.api.patch(`/cotizaciones/${c.id}`).send({ notas: 'cambio' })).status).toBe(409);
    expect((await enviar(m, c.id)).status).toBe(409);
    const [l1, l2, l3] = env.lineas;

    expect((await autorizar(m, l1!.id)).body.data.lineas[0]).toMatchObject({ estado: 'autorizada' });
    expect((await rechazar(m, l2!.id, null)).status).toBe(400); // el rechazo pide motivo
    expect((await rechazar(m, l2!.id, 99999)).status).toBe(400);
    const r = await m.api.post(`/cotizacion-lineas/${l2!.id}/responder`).send({ decision: 'rechazada', motivo_id: m.motivoRechazo, motivo_texto: 'lo consigue más barato' });
    expect(r.body.data.lineas[1]).toMatchObject({ estado: 'rechazada', motivo_rechazo: expect.any(String), respondida_por: expect.any(String) });
    expect(r.body.data.estado).toBe('enviada'); // todavía falta una
    expect((await autorizar(m, l1!.id)).status).toBe(409); // una respuesta no se cambia
    expect((await rechazar(m, l1!.id)).status).toBe(409);
    expect((await autorizar(m, l3!.id)).body.data.estado).toBe('respondida');
    const registro = await m.t.sql(async (c2) => (await c2.query('SELECT dispositivo, respondida_en FROM cotizacion_lineas WHERE id = ?', [l1!.id]))[0] as Array<{ dispositivo: string | null; respondida_en: Date | null }>);
    expect(registro[0]!.respondida_en).not.toBeNull();
    // Un borrador no se responde; quien solo ve no responde.
    const otro = await crear(m);
    await mat(m, otro.id, 1);
    expect((await autorizar(m, (await cot(m, otro.id)).lineas[0]!.id)).status).toBe(409);
    const visualizador = m.t.api(await (await m.t.usuario('visualizador')).token());
    expect((await visualizador.post(`/cotizacion-lineas/${l3!.id}/responder`).send({ decision: 'autorizada' })).status).toBe(403);
  });

  it('al vencer la vigencia la cotización y sus líneas sin respuesta quedan vencidas y ya no se responden', async () => {
    const m = await mundo();
    const c = await crear(m);
    await mat(m, c.id, 1);
    await mat(m, c.id, 1).then(() => undefined);
    const env = (await enviar(m, c.id, { vence_en: dia(0) })).body.data as Cot; // vale hasta el final de hoy
    expect((await autorizar(m, env.lineas[0]!.id)).status).toBe(200);
    e.reloj.fijo = new Date(Date.now() + 3 * 86400000);
    const manana = m.t.api(await m.t.token());
    // Aunque nadie haya consultado todavia la cotizacion (sigue enviada), su fecha ya paso: no se responde.
    const resp = await manana.post(`/cotizacion-lineas/${env.lineas[1]!.id}/responder`).send({ decision: 'autorizada' });
    expect(resp.status).toBe(409);
    expect(resp.body.codigo).toBe('COTIZACION_VENCIDA');
    const v = (await manana.get(`/cotizaciones/${c.id}`)).body.data as Cot;
    expect(v.estado).toBe('vencida');
    expect(v.lineas.map((l) => l.estado)).toEqual(['autorizada', 'vencida']); // lo autorizado a tiempo se conserva
    expect(((await manana.get('/cotizaciones?estado=vencida')).body.data as { total: number }).total).toBe(1);
  });
});

describe('versiones y anulación', () => {
  it('una enviada sin respuestas se reemplaza por una versión nueva con las mismas líneas; con respuestas no', async () => {
    const m = await mundo();
    const c = await crear(m);
    await servicio(m, c.id);
    await mat(m, c.id, 2);
    await enviar(m, c.id);
    expect((await m.api.post(`/cotizaciones/${(await crear(m)).id}/nueva-version`).send({})).status).toBe(409); // un borrador se edita directamente
    const v2 = await m.api.post(`/cotizaciones/${c.id}/nueva-version`).send({});
    expect(v2.status).toBe(201);
    expect(v2.body.data).toMatchObject({ numero: c.numero, version: 2, estado: 'borrador' });
    expect((v2.body.data as Cot).lineas.map((l) => [l.tipo, l.estado])).toEqual([['servicio', 'pendiente'], ['material', 'pendiente']]);
    expect(await cot(m, c.id)).toMatchObject({ estado: 'reemplazada', version_nueva_id: v2.body.data.id });
    expect((await m.api.post(`/cotizaciones/${c.id}/nueva-version`).send({})).status).toBe(409); // la reemplazada ya no
    expect((await mat(m, v2.body.data.id, 1)).status).toBe(201); // la nueva sí se edita
    const lista = (await m.api.get('/cotizaciones')).body.data as { registros: Array<{ id: number; version: number }> };
    expect(lista.registros.map((r) => r.id)).not.toContain(c.id); // la reemplazada no estorba en la lista

    // Con una línea respondida no se reemplaza.
    const d = await crear(m);
    await mat(m, d.id, 1);
    await mat(m, d.id, 2).then(() => undefined);
    const env = (await enviar(m, d.id)).body.data as Cot;
    await autorizar(m, env.lineas[0]!.id); // la otra queda sin respuesta: la cotizacion sigue enviada
    expect((await cot(m, d.id)).estado).toBe('enviada');
    expect((await m.api.post(`/cotizaciones/${d.id}/nueva-version`).send({})).status).toBe(409);
  });

  it('se anula con motivo hasta que lleve líneas a una orden; una anulada no se responde', async () => {
    const m = await mundo();
    const c = await crear(m);
    await mat(m, c.id, 1);
    expect((await m.api.post(`/cotizaciones/${c.id}/anular`).send({ motivo: 'x' })).status).toBe(400);
    const env = (await enviar(m, c.id)).body.data as Cot;
    expect((await m.api.post(`/cotizaciones/${c.id}/anular`).send({ motivo: 'el cliente ya no quiere' })).body.data).toMatchObject({ estado: 'anulada', motivo_anulacion: 'EL CLIENTE YA NO QUIERE' });
    expect((await autorizar(m, env.lineas[0]!.id)).status).toBe(409);
    expect((await m.api.post(`/cotizaciones/${c.id}/anular`).send({ motivo: 'otra vez' })).status).toBe(409);

    const d = await crear(m);
    await servicio(m, d.id);
    const env2 = (await enviar(m, d.id)).body.data as Cot;
    await autorizar(m, env2.lineas[0]!.id);
    expect((await m.api.post(`/cotizaciones/${d.id}/agregar-a-orden`).send({})).status).toBe(200);
    expect((await m.api.post(`/cotizaciones/${d.id}/anular`).send({ motivo: 'ya se llevó' })).status).toBe(409);
  });
});

describe('agregar a la orden', () => {
  it('lleva solo lo autorizado: trabajos y terceros como líneas con el precio cotizado y los materiales como solicitud a bodega; no es automático ni se repite', async () => {
    const m = await mundo();
    const c = await crear(m);
    await servicio(m, c.id);
    await mat(m, c.id, 3);
    await tercero(m, c.id);
    await mat(m, c.id, 1, {}).then(() => undefined);
    const env = (await enviar(m, c.id)).body.data as Cot;
    expect((await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({})).status).toBe(409); // nada autorizado todavía
    expect((await autorizar(m, env.lineas[0]!.id)).status).toBe(200);
    expect((await autorizar(m, env.lineas[1]!.id)).status).toBe(200);
    expect((await rechazar(m, env.lineas[2]!.id)).status).toBe(200);
    expect((await m.api.get(`/ordenes/${m.orden}`)).body.data.lineas).toHaveLength(0); // autorizar NO la agrega sola

    const r = await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({});
    expect(r.status).toBe(200);
    const x = r.body.data as Cot;
    expect(x.lineas.map((l) => l.estado)).toEqual(['agregada_a_orden', 'agregada_a_orden', 'rechazada', 'pendiente']);
    expect(x.lineas[0]).toMatchObject({ agregada_orden: expect.stringMatching(/^REP-/) });
    expect(x.lineas[1]).toMatchObject({ solicitud: 'SOL-000001' });
    const orden = (await m.api.get(`/ordenes/${m.orden}`)).body.data as { subtotal: number; lineas: Array<{ tipo: string; descripcion: string; precio_unitario: number; descuento_pct: number; total_linea: number; estado: string }> };
    expect(orden.lineas).toEqual([expect.objectContaining({ tipo: 'servicio', precio_unitario: 200, descuento_pct: 10, total_linea: 180, estado: 'pendiente' })]); // lo rechazado no pasó
    expect(orden.subtotal).toBe(200);
    const sol = (await m.api.get('/solicitudes/1')).body.data as { numero: string; estado: string; notas: string; lineas: Array<{ cantidad_solicitada: number }> };
    expect(sol).toMatchObject({ numero: 'SOL-000001', estado: 'no_despachada', notas: expect.stringContaining('COT-000001'), lineas: [{ cantidad_solicitada: 3 }] });
    expect((await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({})).status).toBe(409); // ya se llevó lo autorizado

    // Autorizar la que faltaba y volver a llevar: solo llega lo nuevo.
    expect((await autorizar(m, env.lineas[3]!.id)).body.data.estado).toBe('respondida');
    expect((await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({})).status).toBe(200);
    expect((await m.api.get(`/ordenes/${m.orden}`)).body.data.lineas).toHaveLength(1); // la nueva es material: va por solicitud
    expect((await m.api.get('/solicitudes')).body.data.total).toBe(2);
  });

  it('pide la orden si la cotización no tiene; debe ser abierta y del mismo equipo; y el permiso de editar órdenes', async () => {
    const m = await mundo();
    const c = await crear(m, { equipo_id: m.equipo });
    await servicio(m, c.id);
    const env = (await enviar(m, c.id)).body.data as Cot;
    await autorizar(m, env.lineas[0]!.id);
    expect((await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({})).status).toBe(400); // elija la orden
    const equipo2 = (await m.api.post('/equipos').send({ tipo_equipo_id: m.tipoVehiculo, cliente_id: m.cliente, codigo_interno: 'CAM-2', placa: 'C222ABC' })).body.data.equipo.id as number;
    const ordenOtro = ordenId(await nueva(m, { equipo_id: equipo2 }));
    expect((await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({ orden_id: ordenOtro })).status).toBe(409); // otro equipo
    const visualizador = m.t.api(await (await m.t.usuario('visualizador')).token());
    expect((await visualizador.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({ orden_id: m.orden })).status).toBe(403);
    // Quien puede cotizar pero no editar ordenes, tampoco las modifica.
    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    await m.t.sql(async (con) => con.query("DELETE rp FROM rol_permisos rp JOIN roles r ON r.id = rp.rol_id WHERE r.codigo = 'recepcionista' AND rp.permiso_codigo = 'ordenes.editar'"));
    expect((await recepcion.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({ orden_id: m.orden })).status).toBe(403);
    expect((await m.api.post(`/ordenes/${m.orden}/estado`).send({ estado_id: m.estados['ENTREGADA'] })).status).toBe(200);
    expect((await m.api.post(`/ordenes/${m.orden}/estado`).send({ estado_id: m.estados['CERRADA'] })).status).toBe(200);
    const cerrada = await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({ orden_id: m.orden });
    expect(cerrada.status).toBe(409);
    expect(cerrada.body.codigo).toBe('ORDEN_CERRADA');
    // En una orden abierta del mismo equipo sí; la cotización se liga a esa orden.
    const ordenNueva = ordenId(await nueva(m));
    const ok = await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({ orden_id: ordenNueva });
    expect(ok.status).toBe(200);
    expect(ok.body.data.orden).toMatch(/^REP-/);
  });
});

describe('los rojos de los checklists', () => {
  it('«cotizar» un checklist trae sus rojos con fotos; el desenlace de cada rojo se ve en el checklist y las respuestas no cambian', async () => {
    const m = await mundo();
    const ck = await checklistConRojos(m, m.orden, ['rojo', 'rojo']);
    const sin = await checklistConRojos(m, ordenId(await nueva(m, { equipo_id: (await m.api.post('/equipos').send({ tipo_equipo_id: m.tipoVehiculo, cliente_id: m.cliente, codigo_interno: 'CAM-2' })).body.data.equipo.id })), ['verde', 'verde']);
    expect((await m.api.post('/cotizaciones/desde-checklist').send({ checklist_id: sin.id })).status).toBe(409); // sin rojos
    expect((await desenlaces(m, ck.id)).map((r) => r.desenlace?.estado)).toEqual(['sin_cotizar', 'sin_cotizar']);

    const r = await m.api.post('/cotizaciones/desde-checklist').send({ checklist_id: ck.id });
    expect(r.status).toBe(201);
    const c = r.body.data as Cot;
    expect(c).toMatchObject({ estado: 'borrador', orden: expect.stringMatching(/^REP-/), equipo: 'CAM-1 · C123ABC' });
    expect(c.hallazgos.map((h) => [h.descripcion, h.fotos.length])).toEqual([['PASTILLAS', 1], ['DISCOS', 1]]);
    expect(c.hallazgos[0]!.fotos[0]!.url).toMatch(/^\/api\/.*archivos/); // foto con dirección firmada
    const otra = await m.api.post('/cotizaciones/desde-checklist').send({ checklist_id: ck.id });
    expect(otra.status).toBe(409);
    expect(otra.body.codigo).toBe('YA_COTIZADOS');
    expect((await desenlaces(m, ck.id)).map((x) => x.desenlace?.estado)).toEqual(['en_borrador', 'en_borrador']);

    // Solo se agregan rojos, y del mismo equipo.
    const equipo3 = (await m.api.post('/equipos').send({ tipo_equipo_id: m.tipoVehiculo, cliente_id: m.cliente, codigo_interno: 'CAM-3' })).body.data.equipo.id as number;
    const ajeno = await checklistConRojos(m, ordenId(await nueva(m, { equipo_id: equipo3 })), ['rojo', 'verde']);
    expect((await m.api.post(`/cotizaciones/${c.id}/hallazgos`).send({ respuesta_ids: [sin.respuestas[0]] })).status).toBe(400); // un verde de otro equipo
    const calidad = ((await m.api.get('/checklists-tipos')).body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === 'CALIDAD')!.id;
    const ck2 = await m.api.post(`/ordenes/${m.orden}/checklists`).send({ tipo_id: calidad });
    const primero = ((await m.api.get(`/checklists/${ck2.body.data.id}`)).body.data as { respuestas: Array<{ id: number; tipo_respuesta: string }> }).respuestas.find((r) => r.tipo_respuesta === 'semaforo')!;
    expect((await m.api.patch(`/checklists/${ck2.body.data.id}/respuestas/${primero.id}`).send({ semaforo: 'verde' })).status).toBe(200);
    expect((await m.api.post(`/cotizaciones/${c.id}/hallazgos`).send({ respuesta_ids: [primero.id] })).status).toBe(400); // un verde del mismo equipo
    expect((await m.api.post(`/cotizaciones/${c.id}/hallazgos`).send({ respuesta_ids: [ajeno.respuestas[0]] })).status).toBe(400); // el rojo de otro equipo
    // Las líneas se ligan al rojo que atienden (uno solo puede ligarse a rojos de esta cotización).
    expect((await servicio(m, c.id, { respuesta_id: ck.respuestas[0] })).status).toBe(201);
    expect((await mat(m, c.id, 1, { respuesta_id: ck.respuestas[1] })).status).toBe(201);
    expect((await m.api.delete(`/cotizaciones/${c.id}/hallazgos/${ck.respuestas[0]}`)).status).toBe(409); // tiene líneas
    const env = (await enviar(m, c.id)).body.data as Cot;
    expect((await desenlaces(m, ck.id)).map((x) => x.desenlace?.estado)).toEqual(['sin_respuesta', 'sin_respuesta']);
    await autorizar(m, env.lineas[0]!.id);
    await rechazar(m, env.lineas[1]!.id);
    const d1 = await desenlaces(m, ck.id);
    expect(d1.map((x) => x.desenlace?.estado)).toEqual(['autorizado', 'rechazado']);
    expect(d1[1]!.desenlace).toMatchObject({ cotizacion: 'COT-000001', motivo: expect.any(String) });
    expect((await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({})).status).toBe(200);
    expect((await desenlaces(m, ck.id)).map((x) => x.desenlace?.estado)).toEqual(['agregado', 'rechazado']);
    // Las respuestas del checklist siguen igual.
    const resp = (await m.api.get(`/checklists/${ck.id}`)).body.data as { respuestas: Array<{ semaforo: string; nota: string }> };
    expect(resp.respuestas.map((x) => [x.semaforo, x.nota])).toEqual([['rojo', 'DESGASTE FUERTE'], ['rojo', 'DESGASTE FUERTE']]);
  });

  it('en la siguiente revisión del mismo equipo salen los rojos anteriores que se rechazaron o quedaron sin atender', async () => {
    const m = await mundo();
    const vieja = await checklistConRojos(m, m.orden, ['rojo', 'rojo'], true);
    const c = (await m.api.post('/cotizaciones/desde-checklist').send({ checklist_id: vieja.id })).body.data as Cot;
    await servicio(m, c.id, { respuesta_id: vieja.respuestas[0] });
    const env = (await enviar(m, c.id)).body.data as Cot;
    await autorizar(m, env.lineas[0]!.id);
    await m.api.post(`/cotizaciones/${c.id}/agregar-a-orden`).send({});
    // Del segundo rojo no se hizo nada: sin líneas. El primero ya se atendió.
    const nuevoCk = await m.api.post(`/ordenes/${m.orden}/checklists`).send({ tipo_id: m.tipoFrenos });
    expect(nuevoCk.status).toBe(201);
    const ant = ((await m.api.get(`/checklists/${nuevoCk.body.data.id}`)).body.data as { rojos_anteriores: Array<{ descripcion: string; desenlace: { estado: string } }> }).rojos_anteriores;
    expect(ant.map((a) => [a.descripcion, a.desenlace.estado])).toEqual([['DISCOS', 'sin_cotizar']]);
    // Un checklist ya completado no repite los anteriores.
    const hecho = (await m.api.get(`/checklists/${vieja.id}`)).body.data as { rojos_anteriores: unknown[] };
    expect(hecho.rojos_anteriores).toEqual([]);
  });
});
