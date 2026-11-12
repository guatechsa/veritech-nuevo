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
  bodegaA: number;
  bodegaB: number;
  parte: number;
  unidad: number;
  matA: number;
  matB: number;
  ordenA: number;
  ordenB: number;
}

interface Reserva {
  id: number;
  numero: string;
  estado: string;
  vence_en: string;
  extensiones: number;
  lista: boolean;
  solicitud_id: number | null;
  lineas: Array<{ id: number; material_id: number; cantidad: number; cantidad_cubierta: number; pendiente: number; disponible: number; alcanza: boolean }>;
}

/** Dos órdenes abiertas (de dos equipos) y dos materiales SIN existencia: cada prueba decide cuánto compra. */
async function mundo(): Promise<Mundo> {
  const base = await mundoDeOrdenes(e);
  const sucursal = ((await base.api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id;
  const bodegaA = (await base.api.post('/bodegas').send({ nombre: 'Bodega principal', sucursal_id: sucursal })).body.data.id as number;
  const bodegaB = (await base.api.post('/bodegas').send({ nombre: 'Bodega de repuestos', sucursal_id: sucursal })).body.data.id as number;
  const op = (await base.api.get('/inventario-opciones')).body.data as { unidades: Array<{ id: number; codigo: string }>; partes: Array<{ id: number; clasificacion: string }> };
  const parte = op.partes.find((p) => p.clasificacion.startsWith('99-'))!.id;
  const unidad = op.unidades.find((u) => u.codigo === 'UND')!.id;
  const matA = (await base.api.post('/materiales').send({ codigo: 'FIL-ACE', nombre: 'Filtro de aceite', parte_id: parte, unidad_id: unidad })).body.data.id as number;
  const matB = (await base.api.post('/materiales').send({ codigo: 'PAS-DEL', nombre: 'Pastillas delanteras', parte_id: parte, unidad_id: unidad })).body.data.id as number;
  const equipo2 = (await base.api.post('/equipos').send({ tipo_equipo_id: base.tipoVehiculo, cliente_id: base.cliente, codigo_interno: 'CAM-2', placa: 'C222ABC' })).body.data.equipo.id as number;
  const ordenA = ordenId(await nueva(base));
  const ordenB = ordenId(await nueva(base, { equipo_id: equipo2 }));
  return { ...base, bodegaA, bodegaB, parte, unidad, matA, matB, ordenA, ordenB };
}

const comprar = async (m: Mundo, material: number, cantidad: number, bodega = m.bodegaA, costo = 10): Promise<void> => {
  const r = await m.api.post('/compras').send({ proveedor_id: m.proveedor, bodega_id: bodega, fecha_documento: dia(0), lineas: [{ material_id: material, cantidad, costo_unitario: costo }] });
  expect(r.status).toBe(201);
};
const reservar = (m: Mundo, orden: number, lineas: Array<{ material_id: number; cantidad: number }>, extra: Record<string, unknown> = {}) => m.api.post('/reservas').send({ orden_id: orden, vence_en: dia(5), lineas, ...extra });
const reserva = async (m: Mundo, id: number) => (await m.api.get(`/reservas/${id}`)).body.data as Reserva;
const pedir = (m: Mundo, orden: number, lineas: Array<{ material_id: number; cantidad: number }>) => m.api.post('/solicitudes').send({ orden_id: orden, lineas });
const despachar = (m: Mundo, solicitud: number, items: Array<{ linea_id: number; bodega_id: number; cantidad: number }>) => m.api.post(`/solicitudes/${solicitud}/despachar`).send({ items });
/** Pide y despacha de una sola vez (de la bodega A). */
const sacar = async (m: Mundo, orden: number, material: number, cantidad: number) => {
  const s = await pedir(m, orden, [{ material_id: material, cantidad }]);
  expect(s.status).toBe(201);
  return despachar(m, s.body.data.id as number, [{ linea_id: s.body.data.lineas[0].id as number, bodega_id: m.bodegaA, cantidad }]);
};
const existencia = async (m: Mundo, material: number): Promise<number> => ((await m.api.get(`/materiales/${material}`)).body.data as { existencia_total: number }).existencia_total;

describe('reservar y cargar a la orden', () => {
  it('se puede reservar sin existencia; «cargar a la orden» es todo o nada y despacha cuando llegan las unidades', async () => {
    const m = await mundo();
    const r = await reservar(m, m.ordenA, [{ material_id: m.matA, cantidad: 5 }], { notas: 'pieza importada' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ numero: 'RES-000001', estado: 'activa', lista: false, notas: 'PIEZA IMPORTADA', lineas: [{ cantidad: 5, pendiente: 5, disponible: 0, alcanza: false }] });
    const id = r.body.data.id as number;

    const sin = await m.api.post(`/reservas/${id}/cargar`).send({});
    expect(sin.status).toBe(409);
    expect(sin.body.codigo).toBe('SIN_EXISTENCIA');
    expect((await m.api.get('/solicitudes')).body.data.total).toBe(0); // no quedó nada a medias

    await comprar(m, m.matA, 3);
    expect((await reserva(m, id)).lista).toBe(false); // 3 de 5: todavía no
    expect((await m.api.post(`/reservas/${id}/cargar`).send({})).status).toBe(409);
    expect(await existencia(m, m.matA)).toBe(3);

    await comprar(m, m.matA, 4, m.bodegaB); // llegan más, en otra bodega de la misma sucursal
    expect((await reserva(m, id)).lista).toBe(true);
    const ok = await m.api.post(`/reservas/${id}/cargar`).send({});
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ estado: 'cargada', lista: false, lineas: [{ cantidad_cubierta: 5, pendiente: 0 }] });
    expect(ok.body.data.solicitud_id).not.toBeNull();
    expect(await existencia(m, m.matA)).toBe(2);
    const orden = (await m.api.get(`/ordenes/${m.ordenA}`)).body.data as { lineas: Array<{ tipo: string; cantidad: number }> };
    expect(orden.lineas.filter((l) => l.tipo === 'material')).toEqual([expect.objectContaining({ cantidad: 5 })]);
    const sol = (await m.api.get(`/solicitudes/${ok.body.data.solicitud_id}`)).body.data;
    expect(sol).toMatchObject({ estado: 'despachada', notas: expect.stringContaining('RES-000001') });
    expect((await m.api.post(`/reservas/${id}/cargar`).send({})).status).toBe(409); // ya está cargada
    expect((await m.api.post(`/reservas/${id}/cancelar`).send({ motivo: 'me arrepenti' })).status).toBe(409); // una cargada no se cancela
  });

  it('con varios materiales, si uno no alcanza no se carga ninguno', async () => {
    const m = await mundo();
    await comprar(m, m.matA, 10);
    await comprar(m, m.matB, 1);
    const id = (await reservar(m, m.ordenA, [{ material_id: m.matA, cantidad: 4 }, { material_id: m.matB, cantidad: 2 }])).body.data.id as number;
    const r = await m.api.post(`/reservas/${id}/cargar`).send({});
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('SIN_EXISTENCIA');
    expect(await existencia(m, m.matA)).toBe(10);
    expect(await existencia(m, m.matB)).toBe(1);
    expect((await reserva(m, id)).estado).toBe('activa');
    expect(((await m.api.get(`/ordenes/${m.ordenA}`)).body.data as { lineas: unknown[] }).lineas).toHaveLength(0);
  });

  it('valida lo que se reserva: fecha, enteros, sin repetir, material activo, orden abierta', async () => {
    const m = await mundo();
    const l = [{ material_id: m.matA, cantidad: 1 }];
    expect((await reservar(m, m.ordenA, l, { vence_en: dia(-1) })).status).toBe(400);
    expect((await reservar(m, m.ordenA, l, { vence_en: dia(400) })).status).toBe(400);
    expect((await reservar(m, m.ordenA, l, { vence_en: '2026-02-31' })).status).toBe(400);
    expect((await reservar(m, m.ordenA, [{ material_id: m.matA, cantidad: 1.5 }])).status).toBe(400);
    expect((await reservar(m, m.ordenA, [{ material_id: m.matA, cantidad: 1 }, { material_id: m.matA, cantidad: 2 }])).status).toBe(400);
    expect((await reservar(m, m.ordenA, [])).status).toBe(400);
    expect((await reservar(m, 99999, l)).status).toBe(404);
    expect((await m.api.patch(`/materiales/${m.matA}`).send({ activo: false })).status).toBe(200);
    expect((await reservar(m, m.ordenA, l)).status).toBe(400);
    expect((await m.api.post(`/ordenes/${m.ordenA}/anular`).send({ motivo_id: m.motivo })).status).toBe(200);
    expect((await reservar(m, m.ordenA, [{ material_id: m.matB, cantidad: 1 }])).status).toBe(409); // orden anulada
    expect((await m.api.get('/reservas')).body.data.total).toBe(0);
  });
});

describe('las unidades reservadas están protegidas', () => {
  it('lo reservado para una orden no se puede despachar a otra; lo despachado a la misma orden cubre su reserva', async () => {
    const m = await mundo();
    await comprar(m, m.matA, 10);
    const id = (await reservar(m, m.ordenA, [{ material_id: m.matA, cantidad: 8 }])).body.data.id as number;
    expect((await reserva(m, id)).lineas[0]).toMatchObject({ disponible: 10, alcanza: true }); // para su propia orden alcanza todo
    const ficha = (await m.api.get(`/materiales/${m.matA}`)).body.data as { existencia_total: number; reservado: number };
    expect(ficha).toMatchObject({ existencia_total: 10, reservado: 8 });

    const bloqueado = await sacar(m, m.ordenB, m.matA, 3); // solo 2 están libres
    expect(bloqueado.status).toBe(409);
    expect(bloqueado.body.codigo).toBe('RESERVADO');
    expect(await existencia(m, m.matA)).toBe(10);
    expect((await sacar(m, m.ordenB, m.matA, 2)).status).toBe(200);

    // La orden dueña sí puede sacar de lo suyo: 5 de las 8 reservadas.
    expect((await sacar(m, m.ordenA, m.matA, 5)).status).toBe(200);
    const r = await reserva(m, id);
    expect(r).toMatchObject({ estado: 'activa', lineas: [{ cantidad: 8, cantidad_cubierta: 5, pendiente: 3 }] });
    expect((await sacar(m, m.ordenA, m.matA, 3)).status).toBe(200);
    expect(await reserva(m, id)).toMatchObject({ estado: 'cargada', lineas: [{ pendiente: 0 }] }); // quedó totalmente cubierta
  });

  it('cancelar, vencer, cerrar o anular la orden liberan las unidades', async () => {
    const m = await mundo();
    await comprar(m, m.matA, 10);
    const ra = (await reservar(m, m.ordenA, [{ material_id: m.matA, cantidad: 10 }])).body.data.id as number;
    expect((await sacar(m, m.ordenB, m.matA, 1)).status).toBe(409);
    // Cancelar con motivo.
    expect((await m.api.post(`/reservas/${ra}/cancelar`).send({ motivo: 'x' })).status).toBe(400);
    expect((await m.api.post(`/reservas/${ra}/cancelar`).send({ motivo: 'el cliente ya no viene' })).body.data).toMatchObject({ estado: 'cancelada', motivo_cancelacion: 'EL CLIENTE YA NO VIENE' });
    expect((await m.api.post(`/reservas/${ra}/cancelar`).send({ motivo: 'otra vez' })).status).toBe(409);
    expect((await sacar(m, m.ordenB, m.matA, 1)).status).toBe(200);

    // Anular la orden cancela sus reservas; cerrarla deja de proteger.
    const rb = (await reservar(m, m.ordenB, [{ material_id: m.matA, cantidad: 9 }])).body.data.id as number;
    const nueva3 = ordenId(await nueva(m, { equipo_id: ((await m.api.post('/equipos').send({ tipo_equipo_id: m.tipoVehiculo, cliente_id: m.cliente, codigo_interno: 'CAM-3' })).body.data.equipo.id as number) }));
    expect((await sacar(m, nueva3, m.matA, 1)).status).toBe(409); // los 9 restantes están reservados por B
    expect((await m.api.post(`/ordenes/${m.ordenB}/estado`).send({ estado_id: m.estados['ENTREGADA'] })).status).toBe(200);
    expect((await m.api.post(`/ordenes/${m.ordenB}/estado`).send({ estado_id: m.estados['CERRADA'] })).status).toBe(200);
    expect((await sacar(m, nueva3, m.matA, 1)).status).toBe(200); // una orden cerrada ya no protege nada
    const rc = (await reservar(m, m.ordenA, [{ material_id: m.matB, cantidad: 1 }])).body.data.id as number;
    expect((await m.api.post(`/ordenes/${m.ordenA}/anular`).send({ motivo_id: m.motivo })).status).toBe(200);
    expect(await reserva(m, rc)).toMatchObject({ estado: 'cancelada', motivo_cancelacion: 'ORDEN ANULADA' });
    void rb;
  });

  it('al vencer su fecha la reserva queda vencida, libera las unidades y ya no se carga', async () => {
    const m = await mundo();
    await comprar(m, m.matA, 10);
    const id = (await reservar(m, m.ordenA, [{ material_id: m.matA, cantidad: 10 }], { vence_en: dia(0) })).body.data.id as number; // vale hasta el final de hoy
    expect((await reserva(m, id)).estado).toBe('activa');
    expect((await sacar(m, m.ordenB, m.matA, 1)).status).toBe(409);
    e.reloj.fijo = new Date(Date.now() + 2 * 86400000);
    const manana = m.t.api(await m.t.token());
    // Aunque nadie haya consultado la reserva (todavía figura «activa»), su fecha ya pasó: no protege nada.
    const s = await manana.post('/solicitudes').send({ orden_id: m.ordenB, lineas: [{ material_id: m.matA, cantidad: 10 }] });
    expect((await manana.post(`/solicitudes/${s.body.data.id}/despachar`).send({ items: [{ linea_id: s.body.data.lineas[0].id, bodega_id: m.bodegaA, cantidad: 10 }] })).status).toBe(200);
    expect((await manana.get(`/reservas/${id}`)).body.data).toMatchObject({ estado: 'vencida', dias_para_vencer: null });
    expect((await manana.get('/reservas?abiertas=true')).body.data.total).toBe(0);
    const carga = await manana.post(`/reservas/${id}/cargar`).send({});
    expect(carga.status).toBe(409);
    expect(carga.body.codigo).toBe('RESERVA_VENCIDA');
  });
});

describe('ampliar, cancelar y quién puede', () => {
  it('ampliar pide motivo, fecha posterior y permiso; cancelar lo hace quien reservó o quien gestiona', async () => {
    const m = await mundo();
    const supervisor = m.t.api(await (await m.t.usuario('supervisor')).token());
    const bodega = m.t.api(await (await m.t.usuario('bodeguero')).token());
    const tecnico = m.t.api(await (await m.t.usuario('tecnico')).token());
    const visualizador = m.t.api(await (await m.t.usuario('visualizador')).token());
    const propia = (await supervisor.post('/reservas').send({ orden_id: m.ordenA, vence_en: dia(5), lineas: [{ material_id: m.matA, cantidad: 2 }] })).body.data as Reserva;
    expect((await tecnico.post('/reservas').send({ orden_id: m.ordenA, vence_en: dia(5), lineas: [{ material_id: m.matA, cantidad: 2 }] })).status).toBe(403);
    expect((await visualizador.post('/reservas').send({})).status).toBe(403);
    expect((await visualizador.get('/reservas')).status).toBe(200);

    expect((await supervisor.post(`/reservas/${propia.id}/ampliar`).send({ vence_en: dia(10), motivo: 'llega tarde' })).status).toBe(403); // quien reservó no amplía sin el permiso
    expect((await bodega.post(`/reservas/${propia.id}/ampliar`).send({ vence_en: dia(10), motivo: 'x' })).status).toBe(400);
    expect((await bodega.post(`/reservas/${propia.id}/ampliar`).send({ vence_en: dia(3), motivo: 'llega tarde' })).status).toBe(400); // no puede ser anterior
    expect((await bodega.post(`/reservas/${propia.id}/ampliar`).send({ vence_en: dia(10), motivo: 'llega tarde' })).body.data).toMatchObject({ vence_en: dia(10), extensiones: 1, motivo_extension: 'LLEGA TARDE' });
    expect((await m.api.post(`/reservas/${propia.id}/ampliar`).send({ vence_en: dia(20), motivo: 'sigue sin llegar' })).body.data.extensiones).toBe(2);

    const ajena = (await m.api.post('/reservas').send({ orden_id: m.ordenA, vence_en: dia(5), lineas: [{ material_id: m.matB, cantidad: 1 }] })).body.data as Reserva;
    expect((await supervisor.post(`/reservas/${ajena.id}/cancelar`).send({ motivo: 'no era mía' })).status).toBe(403);
    expect((await supervisor.post(`/reservas/${propia.id}/cancelar`).send({ motivo: 'ya no hace falta' })).body.data.estado).toBe('cancelada'); // la propia sí
    expect((await supervisor.post(`/reservas/${propia.id}/ampliar`).send({ vence_en: dia(30), motivo: 'otra vez' })).status).toBe(409); // una cancelada no se amplía
    expect((await bodega.post(`/reservas/${ajena.id}/cancelar`).send({ motivo: 'la bodega decide' })).body.data.estado).toBe('cancelada'); // quien gestiona cancela cualquiera
  });

  it('cargar a la orden pide el permiso de despachar y la orden abierta', async () => {
    const m = await mundo();
    await comprar(m, m.matA, 5);
    const supervisor = m.t.api(await (await m.t.usuario('supervisor')).token());
    const bodega = m.t.api(await (await m.t.usuario('bodeguero')).token());
    const id = (await reservar(m, m.ordenA, [{ material_id: m.matA, cantidad: 2 }])).body.data.id as number;
    expect((await supervisor.post(`/reservas/${id}/cargar`).send({})).status).toBe(403);
    expect((await m.api.post(`/ordenes/${m.ordenA}/estado`).send({ estado_id: m.estados['ENTREGADA'] })).status).toBe(200);
    expect((await m.api.post(`/ordenes/${m.ordenA}/estado`).send({ estado_id: m.estados['CERRADA'] })).status).toBe(200);
    const cerrada = await bodega.post(`/reservas/${id}/cargar`).send({});
    expect(cerrada.status).toBe(409);
    expect(cerrada.body.codigo).toBe('ORDEN_CERRADA');
    expect(await existencia(m, m.matA)).toBe(5);
  });
});

describe('a qué equipos les sirve cada material', () => {
  it('se aprende al despachar, se puede capturar a mano y se sugiere al pedir para un equipo del mismo tipo', async () => {
    const m = await mundo();
    await comprar(m, m.matA, 10);
    expect(((await m.api.get(`/materiales/${m.matA}/aplica-a`)).body.data as unknown[])).toHaveLength(0);
    expect(((await m.api.get(`/ordenes/${m.ordenB}/materiales-sugeridos`)).body.data as unknown[])).toHaveLength(0);
    expect((await sacar(m, m.ordenA, m.matA, 2)).status).toBe(200);
    expect((await sacar(m, m.ordenA, m.matA, 1)).status).toBe(200);
    const filas = (await m.api.get(`/materiales/${m.matA}/aplica-a`)).body.data as Array<{ id: number; tipo_equipo: string; origen: string; veces: number; marca: string | null; modelo: string | null }>;
    expect(filas).toEqual([expect.objectContaining({ tipo_equipo: 'VEHICULO', origen: 'consumo', veces: 2, marca: null, modelo: null })]);
    // Otro vehículo cualquiera recibe la sugerencia, con lo que hay en existencia.
    expect((await m.api.get(`/ordenes/${m.ordenB}/materiales-sugeridos`)).body.data).toEqual([expect.objectContaining({ codigo: 'FIL-ACE', veces: 2, manual: false, existencia_total: 7 })]);

    // A mano: por tipo, marca y modelo (no equipo por equipo). Un modelo sin marca no vale; no se repite.
    const marca = (await m.api.post('/catalogos/marcas').send({ nombre: 'Toyota' })).body.data.id as number;
    expect((await m.api.post(`/materiales/${m.matB}/aplica-a`).send({ tipo_equipo_id: m.tipoVehiculo, modelo: 'Hilux' })).status).toBe(400);
    const manual = await m.api.post(`/materiales/${m.matB}/aplica-a`).send({ tipo_equipo_id: m.tipoVehiculo, marca_id: marca, modelo: 'hilux' });
    expect(manual.status).toBe(201);
    expect(manual.body.data).toEqual([expect.objectContaining({ origen: 'manual', marca: 'TOYOTA', modelo: 'HILUX', veces: 0 })]);
    expect((await m.api.post(`/materiales/${m.matB}/aplica-a`).send({ tipo_equipo_id: m.tipoVehiculo, marca_id: marca, modelo: 'Hilux' })).status).toBe(409);
    // Lo capturado para Toyota Hilux no se sugiere a un equipo de otra marca, pero sí a una Toyota Hilux.
    expect(((await m.api.get(`/ordenes/${m.ordenB}/materiales-sugeridos`)).body.data as Array<{ codigo: string }>).map((x) => x.codigo)).toEqual(['FIL-ACE']);
    const hilux = (await m.api.post('/equipos').send({ tipo_equipo_id: m.tipoVehiculo, cliente_id: m.cliente, codigo_interno: 'HIL-1', marca_id: marca, modelo: 'Hilux' })).body.data.equipo.id as number;
    const ordenHilux = ordenId(await nueva(m, { equipo_id: hilux }));
    expect(((await m.api.get(`/ordenes/${ordenHilux}/materiales-sugeridos`)).body.data as Array<{ codigo: string }>).map((x) => x.codigo).sort()).toEqual(['FIL-ACE', 'PAS-DEL']);
    expect((await m.api.delete(`/materiales-aplica-a/${(manual.body.data as Array<{ id: number }>)[0]!.id}`)).status).toBe(200);
    expect(((await m.api.get(`/materiales/${m.matB}/aplica-a`)).body.data as unknown[])).toHaveLength(0);
    // Solo por marca (cualquier modelo): sirve a una Toyota, no a un vehículo sin marca.
    const soloMarca = await m.api.post(`/materiales/${m.matB}/aplica-a`).send({ tipo_equipo_id: m.tipoVehiculo, marca_id: marca });
    expect(soloMarca.status).toBe(201);
    expect(((await m.api.get(`/ordenes/${m.ordenB}/materiales-sugeridos`)).body.data as Array<{ codigo: string }>).map((x) => x.codigo)).toEqual(['FIL-ACE']);
    expect(((await m.api.get(`/ordenes/${ordenHilux}/materiales-sugeridos`)).body.data as Array<{ codigo: string }>).map((x) => x.codigo).sort()).toEqual(['FIL-ACE', 'PAS-DEL']);
    const bodega = m.t.api(await (await m.t.usuario('bodeguero')).token());
    expect((await bodega.post(`/materiales/${m.matB}/aplica-a`).send({ tipo_equipo_id: m.tipoVehiculo })).status).toBe(403);
    expect((await bodega.get(`/materiales/${m.matA}/aplica-a`)).status).toBe(200);
  });
});

describe('alertas de inventario', () => {
  it('avisa lo que está bajo el mínimo, las reservas por vencer, las que ya tienen su material y las solicitudes sin despachar', async () => {
    const m = await mundo();
    await comprar(m, m.matA, 10);
    expect((await m.api.patch(`/materiales/${m.matA}`).send({ existencia_minima: 20 })).status).toBe(200);
    const pronto = (await reservar(m, m.ordenA, [{ material_id: m.matA, cantidad: 4 }], { vence_en: dia(3) })).body.data.id as number;
    const lejos = (await reservar(m, m.ordenB, [{ material_id: m.matB, cantidad: 1 }], { vence_en: dia(30) })).body.data.id as number;
    expect((await pedir(m, m.ordenA, [{ material_id: m.matA, cantidad: 1 }])).status).toBe(201);
    const a = (await m.api.get('/inventario/alertas')).body.data as {
      bajo_minimo: Array<{ codigo: string; existencia_total: number; existencia_minima: number }>;
      reservas_por_vencer: Array<{ id: number; dias_para_vencer: number }>;
      reservas_listas: Array<{ id: number }>;
      solicitudes_pendientes: number;
    };
    expect(a.bajo_minimo).toEqual([expect.objectContaining({ codigo: 'FIL-ACE', existencia_total: 10, existencia_minima: 20 })]);
    expect(a.reservas_por_vencer).toEqual([expect.objectContaining({ id: pronto, dias_para_vencer: 3 })]); // la de 30 días no
    expect(a.reservas_listas.map((r) => r.id)).toEqual([pronto]); // la del material sin existencia no está lista
    expect(a.solicitudes_pendientes).toBe(1);
    void lejos;
    // El técnico solo ve lo que le toca: sin permiso de reservas no salen reservas.
    const tecnico = m.t.api(await (await m.t.usuario('tecnico')).token());
    const t = (await tecnico.get('/inventario/alertas')).body.data as Record<string, unknown>;
    expect(t).toHaveProperty('bajo_minimo');
    expect(t).toHaveProperty('reservas_por_vencer'); // el técnico sí tiene reservas.ver
    const sinNada = m.t.api(await (await m.t.usuario('recepcionista')).token());
    expect((await sinNada.get('/inventario/alertas')).status).toBe(200);
  });
});
