import type { Test } from 'supertest';
import { direccionesDeArchivos } from '../../src/taller/movil-dia';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { dia, mundo as mundoDeOrdenes, nueva, ordenId } from './ayuda-ordenes';

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

async function mundoDelDia() {
  const base = await mundoDeOrdenes(e);
  const etapa = (await base.t.sql(async (c) => (await c.query("SELECT id FROM etapas WHERE codigo = 'MANTENIMIENTO'"))[0] as Array<{ id: number }>))[0]!.id;
  const tipo = (await base.api.post('/checklists-tipos').send({ codigo: 'frenos', nombre: 'Revision de frenos', etapa_id: etapa, requiere_firma_cliente: false })).body.data.id as number;
  expect((await base.api.put(`/checklists-tipos/${tipo}/plantilla`).send({ secciones: [{ nombre: 'Frenos', items: [{ descripcion: 'Pastillas', tipo_respuesta: 'semaforo' }, { descripcion: 'Discos', tipo_respuesta: 'semaforo' }] }] })).status).toBe(200);
  const orden = ordenId(await nueva(base));
  return { ...base, orden, tipoChecklist: tipo };
}

interface Dia {
  trabajos?: { trabajos: Array<{ orden_id: number; descripcion: string }> };
  ordenes: Array<{ id: number }>;
  checklists: Array<{ id: number; respuestas: unknown[] }>;
  equipos: Array<{ id: number }>;
  archivos: string[];
  incompleto: string[];
  [clave: string]: unknown;
}
const miDia = async (api: { get: (u: string) => Test }): Promise<Dia> => {
  const r = await api.get('/movil/mi-dia');
  expect(r.status).toBe(200);
  return r.body.data as Dia;
};

describe('«Descargar mi día»', () => {
  it('el técnico baja sus trabajos con sus órdenes, los checklists por llenar y las fichas de sus equipos; no baja lo de otros ni dinero', async () => {
    const m = await mundoDelDia();
    const tecnico = await m.t.usuario('tecnico', 'tec@taller.test');
    const otro = await m.t.usuario('tecnico', 'tec2@taller.test');
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tecnico.colaboradorId });
    const equipo2 = (await m.api.post('/equipos').send({ tipo_equipo_id: m.tipoVehiculo, cliente_id: m.cliente, codigo_interno: 'CAM-9' })).body.data.equipo.id as number;
    const orden2 = ordenId(await nueva(m, { equipo_id: equipo2 }));
    await m.api.post(`/ordenes/${orden2}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: otro.colaboradorId });
    const ck = await m.api.post(`/ordenes/${m.orden}/checklists`).send({ tipo_id: m.tipoChecklist });
    expect(ck.status).toBe(201);
    const d = await miDia(m.t.api(await tecnico.token()));
    expect(d.trabajos!.trabajos.map((x) => x.orden_id)).toEqual([m.orden]);
    expect(d.ordenes.map((o) => o.id)).toEqual([m.orden]);
    expect(d.checklists.map((c) => c.id)).toEqual([ck.body.data.id]);
    expect(d.checklists[0]!.respuestas).toHaveLength(2); // con su plantilla: se llena sin señal
    expect(d.equipos.map((x) => x.id)).toEqual([m.equipo]);
    expect(d.incompleto).toEqual([]);
    expect(Date.parse(String(d['descargado_en']))).not.toBeNaN();
    expect(JSON.stringify(d)).not.toMatch(/"costo|precio_unitario|total_linea|tarifa|"subtotal|"iva"/);
    // No es de bodega ni de recepción: no trae solicitudes ni citas.
    expect(d['solicitudes']).toBeUndefined();
    expect(d['ordenes_abiertas']).toBeUndefined();
  });

  it('los checklists completados no se bajan (no se llenan)', async () => {
    const m = await mundoDelDia();
    const tecnico = await m.t.usuario('tecnico', 'tec@taller.test');
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tecnico.colaboradorId });
    const ck = (await m.api.post(`/ordenes/${m.orden}/checklists`).send({ tipo_id: m.tipoChecklist })).body.data.id as number;
    await m.t.sql((c) => c.query("UPDATE checklists SET estado = 'completado', completado_en = UTC_TIMESTAMP() WHERE id = ?", [ck]));
    expect((await miDia(m.t.api(await tecnico.token()))).checklists).toEqual([]);
  });

  it('el bodeguero baja las solicitudes por despachar; recepción baja las citas y las órdenes abiertas; el operador, sus equipos asignados', async () => {
    const m = await mundoDelDia();
    const sucursal = ((await m.api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id;
    const bodega = (await m.api.post('/bodegas').send({ nombre: 'Bodega principal', sucursal_id: sucursal })).body.data.id as number;
    const op = (await m.api.get('/inventario-opciones')).body.data as { unidades: Array<{ id: number; codigo: string }>; partes: Array<{ id: number; clasificacion: string }> };
    const material = (await m.api.post('/materiales').send({ codigo: 'ACE-15W40', nombre: 'Aceite 15W40', parte_id: op.partes.find((p) => p.clasificacion.startsWith('99-'))!.id, unidad_id: op.unidades.find((u) => u.codigo === 'UND')!.id })).body.data.id as number;
    expect((await m.api.post('/compras').send({ proveedor_id: m.proveedor, bodega_id: bodega, fecha_documento: dia(0), lineas: [{ material_id: material, cantidad: 10, costo_unitario: 10 }] })).status).toBe(201);
    const sol = await m.api.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: material, cantidad: 2 }] });
    expect(sol.status).toBe(201);
    expect((await m.api.post('/citas').send({ equipo_id: m.equipo, fecha: dia(0), hora: '23:00' })).status).toBe(201);

    const bodeguero = await miDia(m.t.api(await (await m.t.usuario('bodeguero', 'bod@taller.test')).token()));
    expect((bodeguero['solicitudes'] as Array<{ id: number }>).map((x) => x.id)).toEqual([sol.body.data.id]);
    expect(JSON.stringify(bodeguero)).not.toMatch(/"costo|costo_unitario/);
    expect(bodeguero['citas']).toBeUndefined();

    const recepcion = await miDia(m.t.api(await (await m.t.usuario('recepcionista', 'rec@taller.test')).token()));
    expect((recepcion['citas'] as unknown[]).length).toBe(1);
    expect((recepcion['ordenes_abiertas'] as Array<{ id: number }>).map((x) => x.id)).toEqual([m.orden]);
    expect(recepcion['solicitudes']).toBeUndefined();

    const tecnico = await m.t.usuario('tecnico', 'tec@taller.test');
    await m.t.sql((c) => c.query('INSERT INTO asignaciones_operador (colaborador_id, equipo_id, desde) VALUES (?, ?, ?)', [tecnico.colaboradorId, m.equipo, dia(-5)]));
    const operador = await miDia(m.t.api(await tecnico.token()));
    expect(operador['equipos_asignados']).toEqual([m.equipo]);
    expect(operador.equipos.map((x) => x.id)).toEqual([m.equipo]);
  });

  it('junta las direcciones de las fotos y los archivos para que la app los baje al teléfono', () => {
    const lista = direccionesDeArchivos({ fotos: [{ url: '/api/archivos/t/1?e=1&f=a' }, { url: '/api/archivos/t/2?e=1&f=b' }], firma: { url: '/api/archivos/t/1?e=1&f=a' }, otro: 'https://otro.com/x', n: 5 });
    expect(lista.sort()).toEqual(['/api/archivos/t/1?e=1&f=a', '/api/archivos/t/2?e=1&f=b']); // sin repetir y sin direcciones ajenas
  });

  it('sin sesión no baja nada; el visualizador no baja trabajos', async () => {
    const m = await mundoDelDia();
    expect((await m.t.api().get('/movil/mi-dia')).status).toBe(401);
    const v = await miDia(m.t.api(await (await m.t.usuario('visualizador', 'vis@taller.test')).token()));
    expect(v.trabajos).toBeUndefined();
    expect(v.ordenes).toEqual([]);
  });
});
