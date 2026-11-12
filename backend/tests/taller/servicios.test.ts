import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { ExcelJS } from '../../src/taller/datos/libro';
import { dia, mundo, Mundo, nueva, ordenId } from './ayuda-ordenes';

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

interface Estado {
  equipo_id: number;
  servicio_id: number;
  servicio: string;
  estado: string;
  valor_actual: number | null;
  proximo_en: number | null;
  restante: number | null;
  ritmo_por_dia: number | null;
  fecha_estimada: string | null;
  ultimo_servicio: { valor: number; fecha: string } | null;
}

async function tipoContador(m: Mundo, nombre: string): Promise<number> {
  return ((await m.api.get('/tipos-contador')).body.data as Array<{ id: number; nombre: string }>).find((x) => x.nombre === nombre)!.id;
}
async function programa(m: Mundo, extra: Record<string, unknown> = {}) {
  return m.api.post('/servicios-programas').send({ tipo_equipo_id: m.tipoVehiculo, trabajo_id: m.trabajo, tipo_contador_id: await tipoContador(m, 'ODOMETRO'), intervalo: 10000, aviso_proximo: 1000, aviso_urgente: 200, nombre: 'servicio de 10000 km', ...extra });
}
const estados = async (m: Mundo, consulta = ''): Promise<Estado[]> => (await m.api.get(`/servicios${consulta}`)).body.data as Estado[];
const lectura = (m: Mundo, valor: number, fecha = dia(0)) => m.api.post(`/contadores/${m.odometro}/lecturas`).send({ valor, fecha });
async function llenarTodo(m: Mundo, id: number): Promise<void> {
  const d = (await m.api.get(`/checklists/${id}`)).body.data as { respuestas: Array<{ id: number; tipo_respuesta: string }> };
  for (const r of d.respuestas) {
    const cuerpo = r.tipo_respuesta === 'semaforo' ? { semaforo: 'verde' } : r.tipo_respuesta === 'si_no' ? { si_no: true } : { valor_texto: 'ok' };
    expect((await m.api.patch(`/checklists/${id}/respuestas/${r.id}`).send(cuerpo)).status).toBe(200);
  }
}

describe('programas de servicio', () => {
  it('se crean por tipo de equipo con avisos sugeridos según la unidad, y se validan', async () => {
    const m = await mundo(e);
    const r = await programa(m, { aviso_proximo: undefined, aviso_urgente: undefined });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ nombre: 'SERVICIO DE 10000 KM', intervalo: 10000, aviso_proximo: 1000, aviso_urgente: 200, unidad: 'KM', tipo_equipo: 'VEHICULO', equipos: 1 });
    expect((await programa(m)).status).toBe(409); // mismo nombre en el mismo tipo
    expect((await programa(m, { nombre: 'otro', intervalo: 0 })).status).toBe(400);
    expect((await programa(m, { nombre: 'otro', aviso_proximo: 100, aviso_urgente: 500 })).status).toBe(400); // urgente mayor que próximo
    expect((await programa(m, { nombre: 'otro', aviso_proximo: 99999 })).status).toBe(400); // próximo mayor que el intervalo
    expect((await programa(m, { nombre: 'otro', trabajo_id: 99999 })).status).toBe(400);
    const id = r.body.data.id as number;
    const edit = await m.api.patch(`/servicios-programas/${id}`).send({ intervalo: 15000, aviso_proximo: 1500 });
    expect(edit.body.data).toMatchObject({ intervalo: 15000, aviso_proximo: 1500 });
    expect((await m.api.patch(`/servicios-programas/${id}`).send({ tipo_contador_id: await tipoContador(m, 'HOROMETRO') })).status).toBe(409); // rompería la historia
    expect((await m.api.patch(`/servicios-programas/${id}`).send({ activo: false })).body.data.activo).toBe(0);
    expect((await estados(m))).toEqual([]); // un programa inactivo no se vigila
  });

  it('en calendario los avisos sugeridos son 30 y 7 días; cada rol hace lo suyo', async () => {
    const m = await mundo(e);
    const r = await programa(m, { nombre: 'revision anual', tipo_contador_id: await tipoContador(m, 'CALENDARIO'), intervalo: 365, aviso_proximo: undefined, aviso_urgente: undefined });
    expect(r.body.data).toMatchObject({ aviso_proximo: 30, aviso_urgente: 7, unidad: 'DIAS', es_calendario: 1 });
    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    expect((await recepcion.get('/servicios')).status).toBe(200);
    expect((await recepcion.post('/servicios-programas').send({})).status).toBe(403);
    expect((await recepcion.post('/servicios/realizados').send({})).status).toBe(403);
    const sup = m.t.api(await (await m.t.usuario('supervisor')).token());
    expect((await sup.post('/servicios/revisar-avisos').send({})).status).toBe(403);
    const bodeguero = m.t.api(await (await m.t.usuario('bodeguero')).token());
    expect((await bodeguero.get('/servicios')).status).toBe(403);
  });
});

describe('cómo va cada servicio', () => {
  it('el reloj corre desde el contador: al día → próximo → urgente → vencido', async () => {
    const m = await mundo(e);
    await programa(m);
    const [a] = await estados(m);
    expect(a).toMatchObject({ estado: 'al_dia', valor_actual: 1000, proximo_en: 11000, restante: 10000, ultimo_servicio: null }); // el primero cuenta desde el valor inicial
    await lectura(m, 10200);
    expect((await estados(m))[0]).toMatchObject({ estado: 'proximo', restante: 800 });
    await lectura(m, 10900);
    expect((await estados(m))[0]).toMatchObject({ estado: 'urgente', restante: 100 });
    await lectura(m, 11100);
    expect((await estados(m))[0]).toMatchObject({ estado: 'vencido', restante: -100 });
    expect((await estados(m, '?estado=vencido'))).toHaveLength(1);
    expect((await estados(m, '?estado=al_dia'))).toHaveLength(0);
  });

  it('un equipo sin el contador del servicio queda «sin contador»; uno de baja no se vigila; los vencidos van primero', async () => {
    const m = await mundo(e);
    await programa(m);
    const sinOdo = await m.api.post('/equipos').send({ tipo_equipo_id: m.tipoVehiculo, cliente_id: m.cliente, codigo_interno: 'SIN-1' });
    expect(sinOdo.status).toBe(201);
    const baja = await m.api.post('/equipos').send({ tipo_equipo_id: m.tipoVehiculo, cliente_id: m.cliente, codigo_interno: 'BAJA-1' });
    await m.api.post(`/equipos/${baja.body.data.equipo.id}/estado`).send({ estado: 'baja', motivo: 'vendido' });
    await lectura(m, 11500); // el equipo con odómetro, vencido
    const todos = await estados(m);
    expect(todos.map((x) => x.estado)).toEqual(['vencido', 'sin_contador']);
    expect(todos).toHaveLength(2);
    expect(todos[1]).toMatchObject({ restante: null, valor_actual: null });
  });

  it('calendario: la fecha estimada es exacta; el último servicio sin valor se calcula en días', async () => {
    const m = await mundo(e);
    const cal = await tipoContador(m, 'CALENDARIO');
    await m.api.post(`/equipos/${m.equipo}/contadores`).send({ tipo_contador_id: cal, fecha_inicio: dia(-350) });
    await programa(m, { nombre: 'revision anual', tipo_contador_id: cal, intervalo: 365, aviso_proximo: 30, aviso_urgente: 7 });
    const [a] = await estados(m);
    expect(a).toMatchObject({ estado: 'proximo', valor_actual: 350, proximo_en: 365, restante: 15, fecha_estimada: dia(15) });
    const h = await m.api.post('/servicios/realizados').send({ equipo_id: m.equipo, servicio_id: a!.servicio_id, fecha: dia(-100), origen: 'historico' });
    expect(h.status).toBe(201);
    expect((await estados(m))[0]).toMatchObject({ estado: 'al_dia', proximo_en: 615, ultimo_servicio: { valor: 250, fecha: dia(-100) } }); // 250 días desde que empezó el contador
  });

  it('el ritmo de uso de los últimos 90 días da la fecha estimada; sin lecturas suficientes no se inventa una', async () => {
    const m = await mundo(e);
    await programa(m);
    expect((await estados(m))[0]).toMatchObject({ ritmo_por_dia: null, fecha_estimada: null });
    await lectura(m, 2000, dia(-10)); // de 1000 (hace 30 días) a 2000 (hace 10): 50 km por día
    const [r] = await estados(m);
    expect(r).toMatchObject({ ritmo_por_dia: 50, restante: 9000, fecha_estimada: dia(180) });
  });
});

describe('lo ya realizado', () => {
  it('un servicio anterior reinicia el reloj; se valida contra el contador y la fecha', async () => {
    const m = await mundo(e);
    const sid = (await programa(m)).body.data.id as number;
    await lectura(m, 11100); // vencido
    const cargar = (extra: Record<string, unknown>) => m.api.post('/servicios/realizados').send({ equipo_id: m.equipo, servicio_id: sid, fecha: dia(-3), contador_valor: 10800, origen: 'historico', ...extra });
    expect((await cargar({ contador_valor: 99999 })).status).toBe(400); // el contador marca 11100 hoy
    expect((await cargar({ fecha: dia(2) })).status).toBe(400);
    expect((await cargar({ contador_valor: undefined })).status).toBe(400); // en km hay que decir cuánto marcaba
    expect((await cargar({ origen: 'excepcion' })).status).toBe(400); // la excepción pide motivo
    expect((await cargar({ servicio_id: 99999 })).status).toBe(400);
    const ok = await cargar({});
    expect(ok.status).toBe(201);
    expect(ok.body.data.servicios[0]).toMatchObject({ estado: 'al_dia', proximo_en: 20800, ultimo_servicio: { valor: 10800, fecha: dia(-3) } });
    const ex = await cargar({ origen: 'excepcion', motivo: 'se hizo sin checklist', contador_valor: 11000, fecha: dia(-1) });
    expect(ex.status).toBe(201);
    const h = (await m.api.get(`/equipos/${m.equipo}/servicios`)).body.data.historial as Array<{ origen: string; motivo: string | null }>;
    expect(h.map((x) => x.origen)).toEqual(['EXCEPCION', 'HISTORICO']);
    expect(h[0]!.motivo).toBe('SE HIZO SIN CHECKLIST');
    // Un equipo sin el contador no puede cargarlo.
    const sin = (await m.api.post('/equipos').send({ tipo_equipo_id: m.tipoVehiculo, cliente_id: m.cliente, codigo_interno: 'SIN-2' })).body.data.equipo.id as number;
    const r = await m.api.post('/servicios/realizados').send({ equipo_id: sin, servicio_id: sid, fecha: dia(-1), contador_valor: 10, origen: 'historico' });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('SIN_CONTADOR');
  });

  it('una carga equivocada se anula con motivo y el reloj vuelve al servicio anterior; nunca se borra', async () => {
    const m = await mundo(e);
    const sid = (await programa(m)).body.data.id as number;
    await lectura(m, 11100);
    const a = (await m.api.post('/servicios/realizados').send({ equipo_id: m.equipo, servicio_id: sid, fecha: dia(-3), contador_valor: 10800, origen: 'historico' })).body.data.id as number;
    expect((await estados(m))[0]!.estado).toBe('al_dia');
    expect((await m.api.post(`/servicios/realizados/${a}/anular`).send({ motivo: '' })).status).toBe(400);
    const r = await m.api.post(`/servicios/realizados/${a}/anular`).send({ motivo: 'la fecha estaba mal' });
    expect(r.status).toBe(200);
    expect(r.body.data.servicios[0]).toMatchObject({ estado: 'vencido', ultimo_servicio: null });
    expect(r.body.data.historial[0]).toMatchObject({ motivo_anulacion: 'LA FECHA ESTABA MAL' });
    expect((await m.api.post(`/servicios/realizados/${a}/anular`).send({ motivo: 'otra vez' })).status).toBe(409);
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM servicios_realizados'))[0] as Array<{ n: number }>)).toEqual([{ n: 1 }]);
  });

  it('completar el checklist del servicio lo deja registrado como realizado, con lo que marcaba el contador', async () => {
    const m = await mundo(e);
    const calidad = ((await m.api.get('/checklists-tipos')).body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === 'CALIDAD')!.id;
    await programa(m, { checklist_tipo_id: calidad });
    await lectura(m, 11100);
    expect((await estados(m))[0]!.estado).toBe('vencido');
    const id = ordenId(await nueva(m));
    const c = (await m.api.post(`/ordenes/${id}/checklists`).send({ tipo_id: calidad })).body.data as { id: number };
    await llenarTodo(m, c.id);
    expect((await m.api.post(`/checklists/${c.id}/completar`).send({})).status).toBe(200);
    const [s] = await estados(m);
    expect(s).toMatchObject({ estado: 'al_dia', ultimo_servicio: { valor: 11100, fecha: dia(0) }, proximo_en: 21100 });
    const h = (await m.api.get(`/equipos/${m.equipo}/servicios`)).body.data.historial as Array<{ origen: string; orden_numero: string }>;
    expect(h[0]).toMatchObject({ origen: 'CHECKLIST', orden_numero: 'REP-000001' });
  });
});

describe('avisos y citas', () => {
  it('«revisar avisos» solo avisa cuando el estado EMPEORA y vuelve a avisar después de un servicio', async () => {
    const m = await mundo(e);
    const sid = (await programa(m)).body.data.id as number;
    const revisar = async () => (await m.api.post('/servicios/revisar-avisos').send({})).body.data as { avisos_nuevos: Array<{ estado: string }>; pendientes: number };
    expect(await revisar()).toMatchObject({ avisos_nuevos: [], pendientes: 0 });
    await lectura(m, 10200);
    expect((await revisar()).avisos_nuevos.map((x) => x.estado)).toEqual(['proximo']);
    expect((await revisar()).avisos_nuevos).toEqual([]); // sin cambios: no repite
    await lectura(m, 10900);
    expect((await revisar()).avisos_nuevos.map((x) => x.estado)).toEqual(['urgente']);
    await lectura(m, 11100);
    expect((await revisar()).avisos_nuevos.map((x) => x.estado)).toEqual(['vencido']);
    await m.api.post('/servicios/realizados').send({ equipo_id: m.equipo, servicio_id: sid, fecha: dia(0), contador_valor: 11100, origen: 'historico' });
    expect((await revisar()).pendientes).toBe(0);
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM avisos_servicio'))[0] as Array<{ n: number }>)).toEqual([{ n: 0 }]); // quedó al día: se reinicia
    await lectura(m, 20500); // se acerca otra vez
    expect((await revisar()).avisos_nuevos.map((x) => x.estado)).toEqual(['proximo']);
  });

  it('una cita puede nacer de un servicio del mismo tipo de equipo, y no de uno de otro tipo', async () => {
    const m = await mundo(e);
    const sid = (await programa(m)).body.data.id as number;
    const maq = ((await m.api.get('/tipos-equipo')).body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === 'MAQUINARIA')!.id;
    const otroSid = (await programa(m, { nombre: 'de maquinaria', tipo_equipo_id: maq, tipo_contador_id: await tipoContador(m, 'HOROMETRO'), intervalo: 250, aviso_proximo: 25, aviso_urgente: 10 })).body.data.id as number;
    const ok = await m.api.post('/citas').send({ equipo_id: m.equipo, fecha: dia(1), hora: '09:00', servicio_programado_id: sid });
    expect(ok.status).toBe(201);
    expect(ok.body.data.cita.servicio).toBe('SERVICIO DE 10000 KM');
    expect((await m.api.post('/citas').send({ equipo_id: m.equipo, fecha: dia(1), hora: '10:00', servicio_programado_id: otroSid })).status).toBe(400);
  });
});

describe('cargar los últimos servicios desde Excel', () => {
  async function libro(filas: Array<Array<string | number | null>>): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const h = wb.addWorksheet('Datos');
    h.addRow(['EQUIPO', 'SERVICIO', 'FECHA', 'CONTADOR']);
    for (const f of filas) h.addRow(f);
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  const cargar = (m: Mundo, b: Buffer, simular = true) => m.api.post(`/importar/ultimos_servicios?simular=${simular}`).set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').send(b);

  it('carga el historial, dice cada error con fila y columna, y es todo o nada', async () => {
    const m = await mundo(e);
    await programa(m);
    await lectura(m, 11100);
    const malo = await libro([['CAM-1', 'servicio de 10000 km', dia(-3).split('-').reverse().join('/'), 10800], ['NO-EXISTE', 'servicio de 10000 km', '01/01/2026', 100], ['CAM-1', 'servicio fantasma', '01/01/2026', 100], ['CAM-1', 'servicio de 10000 km', '01/01/2026', null]]);
    const r = await cargar(m, malo, false);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ aplicado: false, correctas: 1, con_error: 3 });
    expect(r.body.data.errores.map((x: { fila: number; columna: string }) => [x.fila, x.columna])).toEqual([[3, 'EQUIPO'], [4, 'SERVICIO'], [5, 'CONTADOR']]);
    expect(r.body.data.errores[1].mensaje).toContain('SERVICIO DE 10000 KM');
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM servicios_realizados'))[0] as Array<{ n: number }>)).toEqual([{ n: 0 }]);
    const bueno = await libro([['CAM-1', 'Servicio de 10000 km', dia(-3).split('-').reverse().join('/'), 10800]]);
    const ok = await cargar(m, bueno, false);
    expect(ok.body.data).toMatchObject({ aplicado: true, creados: { servicios: 1 } });
    expect((await estados(m))[0]).toMatchObject({ estado: 'al_dia', ultimo_servicio: { valor: 10800 } });
    const plantilla = await m.api.get('/importar/ultimos_servicios/plantilla').buffer(true).parse((res, cb) => { const p: Buffer[] = []; res.on('data', (x: Buffer) => p.push(x)); res.on('end', () => cb(null, Buffer.concat(p))); });
    expect(plantilla.status).toBe(200);
  });
});
