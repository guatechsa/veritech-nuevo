import { expect } from '@jest/globals';
import { EntornoDePrueba } from '../plataforma/ayuda';
import { tallerDePrueba, TallerDePrueba } from './ayuda';

export async function admin(t: TallerDePrueba) {
  return t.api(await t.token());
}
export type Api = Awaited<ReturnType<typeof admin>>;

/** Día del taller (Guatemala): de noche no es el mismo que el de UTC. */
export const dia = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date(Date.now() + n * 86400000));

export interface Mundo {
  t: TallerDePrueba;
  api: Api;
  cliente: number;
  tipoVehiculo: number;
  equipo: number;
  odometro: number;
  trabajo: number;
  trabajoSinHoras: number;
  proveedor: number;
  area: number;
  estados: Record<string, number>;
  tipos: Record<string, number>;
  motivo: number;
}

/** Un taller con un cliente (10 % de descuento en trabajos), un vehículo con odómetro, un trabajo de 2 horas y la tarifa de 100 la hora. */
export async function mundo(e: EntornoDePrueba): Promise<Mundo> {
  const t = await tallerDePrueba(e);
  const api = await admin(t);
  const tipoCliente = ((await api.get('/tipos-cliente')).body.data as Array<{ id: number }>)[0]!.id;
  expect((await api.patch(`/tipos-cliente/${tipoCliente}`).send({ descuento_trabajos: 10 })).status).toBe(200);
  const cliente = (await api.post('/clientes').send({ nombre: 'Industrias Lopez' })).body.data.cliente.id as number;
  const tipoVehiculo = ((await api.get('/tipos-equipo')).body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === 'VEHICULO')!.id;
  expect((await api.patch(`/tipos-equipo/${tipoVehiculo}`).send({ tarifa_venta_hora: 100, costo_hora: 40 })).status).toBe(200);
  const odo = ((await api.get('/tipos-contador')).body.data as Array<{ id: number; nombre: string }>).find((x) => x.nombre === 'ODOMETRO')!.id;
  const eq = await api.post('/equipos').send({ tipo_equipo_id: tipoVehiculo, cliente_id: cliente, codigo_interno: 'CAM-1', placa: 'C123ABC', contadores: [{ tipo_contador_id: odo, valor_inicial: 1000, fecha_inicio: dia(-30) }] });
  expect(eq.status).toBe(201);
  const equipo = eq.body.data.equipo.id as number;
  const odometro = (eq.body.data.equipo.contadores as Array<{ id: number }>)[0]!.id;
  const sis = (await api.post('/catalogos/sistemas').send({ nombre: 'Motor' })).body.data.id;
  const sub = (await api.post('/catalogos/subsistemas').send({ sistema_id: sis, nombre: 'Lubricacion' })).body.data.id;
  const parte = (await api.post('/catalogos/partes').send({ subsistema_id: sub, nombre: 'Filtro de aceite' })).body.data.id;
  const parte2 = (await api.post('/catalogos/partes').send({ subsistema_id: sub, nombre: 'Bomba de aceite' })).body.data.id;
  const accion = ((await api.get('/catalogos/acciones')).body.data as Array<{ id: number }>)[0]!.id;
  const trabajo = (await api.post('/catalogos/trabajos').send({ parte_id: parte, accion_id: accion })).body.data.id as number;
  const trabajoSinHoras = (await api.post('/catalogos/trabajos').send({ parte_id: parte2, accion_id: accion })).body.data.id as number;
  expect((await api.put(`/catalogos/trabajos/${trabajo}/horas`).send({ horas: [{ tipo_equipo_id: tipoVehiculo, horas: 2 }] })).status).toBe(200);
  const proveedor = (await api.post('/proveedores').send({ nombre: 'Rectificadora Central' })).body.data.proveedor?.id ?? (await api.get('/proveedores')).body.data.registros[0].id;
  const area = (await api.post('/areas').send({ nombre: 'Mecanica general' })).body.data.id as number;
  const op = (await api.get('/ordenes-opciones')).body.data as { estados: Array<{ id: number; codigo: string }>; tipos_orden: Array<{ id: number; codigo: string }>; motivos_anulacion: Array<{ id: number }> };
  return {
    t,
    api,
    cliente,
    tipoVehiculo,
    equipo,
    odometro,
    trabajo,
    trabajoSinHoras,
    proveedor,
    area,
    estados: Object.fromEntries(op.estados.map((x) => [x.codigo, x.id])),
    tipos: Object.fromEntries(op.tipos_orden.map((x) => [x.codigo, x.id])),
    motivo: op.motivos_anulacion[0]!.id,
  };
}

export const nueva = (m: Mundo, cuerpo: Record<string, unknown> = {}) => m.api.post('/ordenes').send({ equipo_id: m.equipo, descripcion: 'cambio de aceite', ...cuerpo });
export const linea = (m: Mundo, ordenId: number, cuerpo: Record<string, unknown>) => m.api.post(`/ordenes/${ordenId}/lineas`).send(cuerpo);
export const ordenId = (r: { body: { data: { orden: { id: number } } } }): number => r.body.data.orden.id;

