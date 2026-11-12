import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { mundo as mundoDeOrdenes, Mundo as MundoOrdenes, nueva, ordenId } from './ayuda-ordenes';

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

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date());

interface Mundo extends MundoOrdenes {
  bodegaA: number;
  bodegaB: number;
  parte: number;
  unidad: number;
  matA: number;
  orden: number;
}

interface Solicitud {
  id: number;
  numero: string;
  estado: string;
  primer_despacho_en: string | null;
  despachada_en: string | null;
  lineas: Array<{ id: number; material_id: number; cantidad_solicitada: number; cantidad_despachada: number; cantidad_devuelta: number; pendiente: number; en_la_orden: number; por_bodega: Array<{ bodega_id: number; cantidad: number }> }>;
  despachos: Array<Record<string, unknown>>;
  devoluciones: Array<Record<string, unknown>>;
}

/** Un taller con un cliente (20 % de descuento en materiales), dos bodegas de la sucursal principal, un material con 10 unidades a costo 10 y una orden abierta. */
async function mundo(): Promise<Mundo> {
  const base = await mundoDeOrdenes(e);
  const tipoCliente = ((await base.api.get('/tipos-cliente')).body.data as Array<{ id: number }>)[0]!.id;
  expect((await base.api.patch(`/tipos-cliente/${tipoCliente}`).send({ descuento_materiales: 20 })).status).toBe(200);
  const sucursal = ((await base.api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id;
  const bodegaA = (await base.api.post('/bodegas').send({ nombre: 'Bodega principal', sucursal_id: sucursal })).body.data.id as number;
  const bodegaB = (await base.api.post('/bodegas').send({ nombre: 'Bodega de repuestos', sucursal_id: sucursal })).body.data.id as number;
  const op = (await base.api.get('/inventario-opciones')).body.data as { unidades: Array<{ id: number; codigo: string }>; partes: Array<{ id: number; clasificacion: string }> };
  const parte = op.partes.find((p) => p.clasificacion.startsWith('99-'))!.id;
  const unidad = op.unidades.find((u) => u.codigo === 'UND')!.id;
  const matA = (await base.api.post('/materiales').send({ codigo: 'ACE-15W40', nombre: 'Aceite 15W40', parte_id: parte, unidad_id: unidad })).body.data.id as number;
  expect((await base.api.post('/compras').send({ proveedor_id: base.proveedor, bodega_id: bodegaA, fecha_documento: hoy(), lineas: [{ material_id: matA, cantidad: 10, costo_unitario: 10 }] })).status).toBe(201);
  const orden = ordenId(await nueva(base));
  return { ...base, bodegaA, bodegaB, parte, unidad, matA, orden };
}

const pedir = (m: Mundo, lineas: Array<{ material_id: number; cantidad: number }>, extra: Record<string, unknown> = {}) => m.api.post('/solicitudes').send({ orden_id: m.orden, lineas, ...extra });
const ver = async (m: Mundo, id: number) => (await m.api.get(`/solicitudes/${id}`)).body.data as Solicitud;
const despachar = (m: Mundo, id: number, items: Array<{ linea_id: number; bodega_id: number; cantidad: number }>) => m.api.post(`/solicitudes/${id}/despachar`).send({ items });
const devolver = (m: Mundo, lineaId: number, bodega: number, cantidad: number, motivo = 'sobro material') => m.api.post('/solicitudes/devoluciones').send({ solicitud_linea_id: lineaId, bodega_id: bodega, cantidad, motivo });
const existencia = async (m: Mundo, material: number, bodega: number): Promise<number> => {
  const d = (await m.api.get(`/materiales/${material}`)).body.data as { por_bodega: Array<{ bodega_id: number; cantidad: number }> };
  return d.por_bodega.find((b) => b.bodega_id === bodega)?.cantidad ?? -1;
};
const orden = async (m: Mundo) =>
  (await m.api.get(`/ordenes/${m.orden}`)).body.data as { subtotal: number; descuento_total: number; lineas: Array<{ id: number; tipo: string; cantidad: number; precio_unitario: number; descuento_pct: number; total_linea: number; costo: number; descripcion: string; material_id: number }> };
const lineasMaterial = async (m: Mundo) => (await orden(m)).lineas.filter((l) => l.tipo === 'material');

describe('pedir, despachar y cargar a la orden', () => {
  it('una solicitud completa baja el inventario y carga el material a la orden con precio de venta, descuento y costo congelado', async () => {
    const m = await mundo();
    const r = await pedir(m, [{ material_id: m.matA, cantidad: 4 }], { notas: 'para el cambio de aceite' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ numero: 'SOL-000001', estado: 'no_despachada', primer_despacho_en: null, notas: 'PARA EL CAMBIO DE ACEITE' });
    expect((await orden(m)).lineas).toHaveLength(0); // pedir no cobra nada
    const s = r.body.data as Solicitud;

    const d = await despachar(m, s.id, [{ linea_id: s.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 4 }]);
    expect(d.status).toBe(200);
    expect(d.body.data).toMatchObject({ estado: 'despachada', lineas: [{ cantidad_despachada: 4, pendiente: 0, en_la_orden: 4 }] });
    expect(d.body.data.primer_despacho_en).not.toBeNull();
    expect(d.body.data.despachada_en).not.toBeNull();
    expect(await existencia(m, m.matA, m.bodegaA)).toBe(6);

    const o = await orden(m);
    expect(o.lineas.filter((l) => l.tipo === 'material')).toEqual([expect.objectContaining({ cantidad: 4, precio_unitario: 13, descuento_pct: 20, total_linea: 41.6, costo: 40, descripcion: 'ACE-15W40 ACEITE 15W40' })]);
    expect(o).toMatchObject({ subtotal: 52, descuento_total: 10.4 });
    // El libro de movimientos tiene el despacho con su costo y su saldo.
    const mov = (await m.api.get('/inventario/movimientos?tipo=despacho')).body.data.registros[0];
    expect(mov).toMatchObject({ tipo: 'DESPACHO', cantidad: -4, saldo_resultante: 6, costo_unitario: 10, referencia_tipo: 'solicitud' });
  });

  it('un despacho parcial deja lo pendiente; no se despacha más de lo pedido; el precio queda fijo y el costo se congela por despacho', async () => {
    const m = await mundo();
    const s = (await pedir(m, [{ material_id: m.matA, cantidad: 5 }])).body.data as Solicitud;
    const lin = s.lineas[0]!.id;
    const p = await despachar(m, s.id, [{ linea_id: lin, bodega_id: m.bodegaA, cantidad: 2 }]);
    expect(p.body.data).toMatchObject({ estado: 'despachada_parcial', despachada_en: null, lineas: [{ cantidad_despachada: 2, pendiente: 3 }] });
    expect(p.body.data.primer_despacho_en).not.toBeNull();

    // Llega otra compra más cara: el promedio sube a 15, pero lo ya despachado conserva su costo de 10 y el precio de la línea no cambia.
    expect((await m.api.post('/compras').send({ proveedor_id: m.proveedor, bodega_id: m.bodegaA, fecha_documento: hoy(), lineas: [{ material_id: m.matA, cantidad: 8, costo_unitario: 20 }] })).status).toBe(201);
    const exceso = await despachar(m, s.id, [{ linea_id: lin, bodega_id: m.bodegaA, cantidad: 4 }]);
    expect(exceso.status).toBe(409);
    expect(exceso.body.codigo).toBe('EXCEDE_SOLICITADO');
    expect(await existencia(m, m.matA, m.bodegaA)).toBe(16); // no se movió nada

    expect((await despachar(m, s.id, [{ linea_id: lin, bodega_id: m.bodegaA, cantidad: 3 }])).body.data.estado).toBe('despachada');
    expect(await lineasMaterial(m)).toEqual([expect.objectContaining({ cantidad: 5, precio_unitario: 13, total_linea: 52, costo: 65 })]); // 2 × 10 + 3 × 15
    expect((await despachar(m, s.id, [{ linea_id: lin, bodega_id: m.bodegaA, cantidad: 1 }])).status).toBe(409); // ya está completa
  });

  it('si la bodega no tiene suficiente no pasa nada a medias; solo se despacha de bodegas de la sucursal de la orden', async () => {
    const m = await mundo();
    const s = (await pedir(m, [{ material_id: m.matA, cantidad: 20 }])).body.data as Solicitud;
    const lin = s.lineas[0]!.id;
    expect(s.lineas[0]!.por_bodega.find((b) => b.bodega_id === m.bodegaA)!.cantidad).toBe(10); // se ve qué hay en cada bodega
    const corto = await despachar(m, s.id, [{ linea_id: lin, bodega_id: m.bodegaA, cantidad: 11 }]);
    expect(corto.status).toBe(409);
    expect(corto.body.codigo).toBe('SIN_EXISTENCIA');
    expect(await existencia(m, m.matA, m.bodegaA)).toBe(10);
    expect((await ver(m, s.id)).estado).toBe('no_despachada');
    expect(await lineasMaterial(m)).toHaveLength(0);

    // Dos bodegas de la misma sucursal pueden completar un despacho; una bodega de otra sucursal no cuenta.
    expect((await m.api.post('/inventario/traslados').send({ material_id: m.matA, bodega_origen_id: m.bodegaA, bodega_destino_id: m.bodegaB, cantidad: 6 })).status).toBe(201);
    const dos = await despachar(m, s.id, [{ linea_id: lin, bodega_id: m.bodegaA, cantidad: 4 }, { linea_id: lin, bodega_id: m.bodegaB, cantidad: 6 }]);
    expect(dos.status).toBe(200);
    expect(dos.body.data).toMatchObject({ estado: 'despachada_parcial', lineas: [{ cantidad_despachada: 10, pendiente: 10 }] });
    expect(dos.body.data.despachos).toHaveLength(2);
    const norte = (await m.api.post('/sucursales').send({ nombre: 'Norte' })).body.data.id as number;
    const bodegaNorte = (await m.api.post('/bodegas').send({ nombre: 'Bodega norte', sucursal_id: norte })).body.data.id as number;
    expect((await m.api.post('/compras').send({ proveedor_id: m.proveedor, bodega_id: bodegaNorte, fecha_documento: hoy(), lineas: [{ material_id: m.matA, cantidad: 10, costo_unitario: 10 }] })).status).toBe(201);
    const lejos = await despachar(m, s.id, [{ linea_id: lin, bodega_id: bodegaNorte, cantidad: 5 }]);
    expect(lejos.status).toBe(409);
    expect(lejos.body.codigo).toBe('BODEGA_OTRA_SUCURSAL');
    expect(await existencia(m, m.matA, bodegaNorte)).toBe(10);
  });

  it('valida lo que se pide: enteros, sin repetir, material activo, orden abierta', async () => {
    const m = await mundo();
    expect((await pedir(m, [{ material_id: m.matA, cantidad: 1.5 }])).status).toBe(400);
    expect((await pedir(m, [{ material_id: m.matA, cantidad: 0 }])).status).toBe(400);
    expect((await pedir(m, [{ material_id: m.matA, cantidad: 1 }, { material_id: m.matA, cantidad: 2 }])).status).toBe(400);
    expect((await pedir(m, [])).status).toBe(400);
    expect((await pedir(m, [{ material_id: 99999, cantidad: 1 }])).status).toBe(400);
    expect((await m.api.post('/solicitudes').send({ orden_id: 99999, lineas: [{ material_id: m.matA, cantidad: 1 }] })).status).toBe(404);
    expect((await m.api.patch(`/materiales/${m.matA}`).send({ activo: false })).status).toBe(200);
    expect((await pedir(m, [{ material_id: m.matA, cantidad: 1 }])).status).toBe(400);
    expect((await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'material', descripcion: 'a mano' })).status).toBe(409); // los materiales no se agregan a mano
    expect((await m.api.get('/solicitudes')).body.data.total).toBe(0);
  });
});

describe('devoluciones', () => {
  it('devolver sube la bodega, baja la línea de la orden y no se puede devolver más de lo que hay', async () => {
    const m = await mundo();
    const s = (await pedir(m, [{ material_id: m.matA, cantidad: 4 }])).body.data as Solicitud;
    const lin = s.lineas[0]!.id;
    await despachar(m, s.id, [{ linea_id: lin, bodega_id: m.bodegaA, cantidad: 4 }]);

    const sinMotivo = await m.api.post('/solicitudes/devoluciones').send({ solicitud_linea_id: lin, bodega_id: m.bodegaA, cantidad: 1, motivo: '' });
    expect(sinMotivo.status).toBe(400);
    const r = await devolver(m, lin, m.bodegaB, 1);
    expect(r.status).toBe(201);
    expect(r.body.data.devoluciones[0]).toMatchObject({ numero: 'DEV-000001', cantidad: 1, bodega: 'BODEGA DE REPUESTOS', motivo: 'SOBRO MATERIAL', costo_unitario: 10 });
    expect(r.body.data.lineas[0]).toMatchObject({ cantidad_despachada: 4, cantidad_devuelta: 1, en_la_orden: 3 });
    expect(r.body.data.estado).toBe('despachada'); // devolver no cambia el estado de la solicitud
    expect(await existencia(m, m.matA, m.bodegaB)).toBe(1);
    expect(await lineasMaterial(m)).toEqual([expect.objectContaining({ cantidad: 3, total_linea: 31.2, costo: 30 })]);
    expect((await orden(m)).subtotal).toBe(39);

    const demasiado = await devolver(m, lin, m.bodegaA, 4);
    expect(demasiado.status).toBe(409);
    expect(demasiado.body.codigo).toBe('EXCEDE_DESPACHADO');
    expect((await devolver(m, lin, m.bodegaA, 3)).status).toBe(201);
    expect(await lineasMaterial(m)).toEqual([expect.objectContaining({ cantidad: 0, total_linea: 0, costo: 0 })]);
    expect((await orden(m)).subtotal).toBe(0);
    expect(await existencia(m, m.matA, m.bodegaA)).toBe(9);
    expect((await m.api.get('/inventario/movimientos?tipo=devolucion')).body.data.total).toBe(2);
    // Ya no queda nada en la orden para devolver.
    expect((await devolver(m, lin, m.bodegaA, 1)).status).toBe(409);
  });
});

describe('anular y el ciclo de vida de la orden', () => {
  it('la anula quien la pidió o quien tenga el permiso, con motivo; una completa no se anula; una parcial anula lo que falta', async () => {
    const m = await mundo();
    const supervisor = m.t.api(await (await m.t.usuario('supervisor')).token());
    const bodega = m.t.api(await (await m.t.usuario('bodeguero')).token());
    const propia = (await supervisor.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.matA, cantidad: 2 }] })).body.data as Solicitud;
    expect((await supervisor.post(`/solicitudes/${propia.id}/anular`).send({ motivo: 'ab' })).status).toBe(400);
    expect((await supervisor.post(`/solicitudes/${propia.id}/anular`).send({ motivo: 'ya no se necesita' })).body.data).toMatchObject({ estado: 'anulada', motivo_anulacion: 'YA NO SE NECESITA' });
    expect((await supervisor.post(`/solicitudes/${propia.id}/anular`).send({ motivo: 'otra vez' })).status).toBe(409);
    expect((await despachar(m, propia.id, [{ linea_id: propia.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 1 }])).status).toBe(409); // una anulada no se despacha

    const ajena = (await pedir(m, [{ material_id: m.matA, cantidad: 3 }])).body.data as Solicitud;
    expect((await supervisor.post(`/solicitudes/${ajena.id}/anular`).send({ motivo: 'no era mía' })).status).toBe(403);
    expect((await bodega.post(`/solicitudes/${ajena.id}/anular`).send({ motivo: 'mal pedida' })).status).toBe(200);

    const parcial = (await pedir(m, [{ material_id: m.matA, cantidad: 5 }])).body.data as Solicitud;
    await despachar(m, parcial.id, [{ linea_id: parcial.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 2 }]);
    expect((await m.api.post(`/solicitudes/${parcial.id}/anular`).send({ motivo: 'ya no hace falta el resto' })).body.data.estado).toBe('anulada');
    expect((await despachar(m, parcial.id, [{ linea_id: parcial.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 1 }])).status).toBe(409);
    expect(await lineasMaterial(m)).toEqual([expect.objectContaining({ cantidad: 2 })]); // lo despachado sigue en la orden
    expect((await devolver(m, parcial.lineas[0]!.id, m.bodegaA, 2)).status).toBe(201); // y se puede devolver

    const completa = (await pedir(m, [{ material_id: m.matA, cantidad: 1 }])).body.data as Solicitud;
    await despachar(m, completa.id, [{ linea_id: completa.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 1 }]);
    expect((await m.api.post(`/solicitudes/${completa.id}/anular`).send({ motivo: 'me equivoque' })).status).toBe(409);
  });

  it('una orden con material despachado no se anula hasta devolverlo; al anularla se anulan las solicitudes pendientes', async () => {
    const m = await mundo();
    const s = (await pedir(m, [{ material_id: m.matA, cantidad: 4 }])).body.data as Solicitud;
    await despachar(m, s.id, [{ linea_id: s.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 4 }]);
    const pendiente = (await pedir(m, [{ material_id: m.matA, cantidad: 2 }])).body.data as Solicitud;
    const bloqueada = await m.api.post(`/ordenes/${m.orden}/anular`).send({ motivo_id: m.motivo });
    expect(bloqueada.status).toBe(409);
    expect(bloqueada.body.codigo).toBe('MATERIAL_DESPACHADO');
    expect((await ver(m, pendiente.id)).estado).toBe('no_despachada');
    expect((await devolver(m, s.lineas[0]!.id, m.bodegaA, 4)).status).toBe(201);
    expect((await m.api.post(`/ordenes/${m.orden}/anular`).send({ motivo_id: m.motivo })).status).toBe(200);
    expect(await ver(m, pendiente.id)).toMatchObject({ estado: 'anulada', motivo_anulacion: 'ORDEN ANULADA' });
    expect(await existencia(m, m.matA, m.bodegaA)).toBe(10); // el inventario quedó como al principio
  });

  it('en una orden cerrada no se pide, no se despacha y no se devuelve; las líneas de material no se editan ni se anulan a mano', async () => {
    const m = await mundo();
    const s = (await pedir(m, [{ material_id: m.matA, cantidad: 4 }])).body.data as Solicitud;
    await despachar(m, s.id, [{ linea_id: s.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 2 }]);
    const [mat] = await lineasMaterial(m);
    expect((await m.api.patch(`/lineas/${mat!.id}`).send({ cantidad: 9 })).status).toBe(409);
    expect((await m.api.patch(`/lineas/${mat!.id}`).send({ precio_unitario: 1 })).status).toBe(409);
    expect((await m.api.post(`/lineas/${mat!.id}/anular`).send({ motivo: 'quitar' })).status).toBe(409);
    expect((await m.api.post(`/lineas/${mat!.id}/estado`).send({ estado: 'pendiente' })).status).toBe(409);
    const tecnicoId = ((await m.api.get('/ordenes-opciones')).body.data as { responsables: Array<{ id: number }> }).responsables[0]!.id;
    expect((await m.api.patch(`/lineas/${mat!.id}`).send({ tecnico_id: tecnicoId })).status).toBe(409); // un material no tiene técnico
    expect((await m.api.patch(`/lineas/${mat!.id}`).send({ notas: 'nota' })).status).toBe(200);

    expect((await m.api.post(`/ordenes/${m.orden}/estado`).send({ estado_id: m.estados['ENTREGADA'] })).status).toBe(200);
    expect((await m.api.post(`/ordenes/${m.orden}/estado`).send({ estado_id: m.estados['CERRADA'] })).status).toBe(200); // el material no impide cerrar
    for (const r of [await pedir(m, [{ material_id: m.matA, cantidad: 1 }]), await despachar(m, s.id, [{ linea_id: s.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 1 }]), await devolver(m, s.lineas[0]!.id, m.bodegaA, 1)]) {
      expect(r.status).toBe(409);
      expect(r.body.codigo).toBe('ORDEN_CERRADA');
    }
    expect(await existencia(m, m.matA, m.bodegaA)).toBe(8);
    expect((await m.api.post(`/solicitudes/${s.id}/anular`).send({ motivo: 'limpiar pendiente' })).status).toBe(200); // anular sí se puede
  });
});

describe('quién puede qué', () => {
  it('el técnico pide pero no despacha; el bodeguero despacha pero no pide; los costos del despacho solo los ve quien tiene permiso', async () => {
    const m = await mundo();
    const tecnico = m.t.api(await (await m.t.usuario('tecnico')).token());
    const bodega = m.t.api(await (await m.t.usuario('bodeguero')).token());
    const visualizador = m.t.api(await (await m.t.usuario('visualizador')).token());
    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    const s = (await tecnico.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.matA, cantidad: 3 }] })).body.data as Solicitud;
    expect(s.numero).toBe('SOL-000001');
    expect((await tecnico.post(`/solicitudes/${s.id}/despachar`).send({ items: [{ linea_id: s.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 1 }] })).status).toBe(403);
    expect((await bodega.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.matA, cantidad: 1 }] })).status).toBe(403);
    expect((await visualizador.post('/solicitudes').send({})).status).toBe(403);
    expect((await visualizador.get('/solicitudes')).status).toBe(200);
    expect((await recepcion.post(`/solicitudes/${s.id}/despachar`).send({})).status).toBe(403);
    expect((await tecnico.post('/solicitudes/devoluciones').send({ solicitud_linea_id: s.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 1, motivo: 'sobro' })).status).toBe(403);

    const d = await bodega.post(`/solicitudes/${s.id}/despachar`).send({ items: [{ linea_id: s.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 3 }] });
    expect(d.status).toBe(200);
    expect(d.body.data.despachos[0]).not.toHaveProperty('costo_unitario'); // el bodeguero no ve costos
    expect((await m.api.get(`/solicitudes/${s.id}`)).body.data.despachos[0]).toMatchObject({ costo_unitario: 10 });
    expect((await bodega.post('/solicitudes/devoluciones').send({ solicitud_linea_id: s.lineas[0]!.id, bodega_id: m.bodegaA, cantidad: 1, motivo: 'sobro' })).status).toBe(201);
    const lista = (await bodega.get('/solicitudes?pendientes=true')).body.data;
    expect(lista.total).toBe(0);
    expect((await bodega.get(`/solicitudes?orden_id=${m.orden}`)).body.data.registros[0]).toMatchObject({ numero: 'SOL-000001', estado: 'despachada', lineas: 1, unidades_pendientes: 0 });
  });

  it('dos despachos a la vez de la misma solicitud no despachan más de lo pedido', async () => {
    const m = await mundo();
    const s = (await pedir(m, [{ material_id: m.matA, cantidad: 6 }])).body.data as Solicitud;
    const lin = s.lineas[0]!.id;
    const rs = await Promise.all([despachar(m, s.id, [{ linea_id: lin, bodega_id: m.bodegaA, cantidad: 4 }]), despachar(m, s.id, [{ linea_id: lin, bodega_id: m.bodegaA, cantidad: 4 }])]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await existencia(m, m.matA, m.bodegaA)).toBe(6);
    expect((await lineasMaterial(m))[0]).toMatchObject({ cantidad: 4 });
  });
});
