import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { tallerDePrueba, TallerDePrueba } from './ayuda';

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

interface Mundo {
  t: TallerDePrueba;
  api: ReturnType<TallerDePrueba['api']>;
  proveedor: number;
  bodegaA: number;
  bodegaB: number;
  parte: number;
  unidad: number;
  motivo: number;
}

async function mundo(): Promise<Mundo> {
  const t = await tallerDePrueba(e);
  const api = t.api(await t.token());
  const sucursal = ((await api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id;
  const bodegaA = (await api.post('/bodegas').send({ nombre: 'Bodega principal', sucursal_id: sucursal })).body.data.id as number;
  const bodegaB = (await api.post('/bodegas').send({ nombre: 'Bodega de repuestos', sucursal_id: sucursal })).body.data.id as number;
  const proveedor = (await api.post('/proveedores').send({ nombre: 'Repuestos del Sur' })).body.data.proveedor?.id ?? ((await api.get('/proveedores')).body.data.registros[0].id as number);
  const op = (await api.get('/inventario-opciones')).body.data as { unidades: Array<{ id: number; codigo: string }>; partes: Array<{ id: number; clasificacion: string }>; motivos_diferencia: Array<{ id: number }> };
  return { t, api, proveedor, bodegaA, bodegaB, parte: op.partes.find((p) => p.clasificacion.startsWith('99-'))!.id, unidad: op.unidades.find((u) => u.codigo === 'UND')!.id, motivo: op.motivos_diferencia[0]!.id };
}

const material = (m: Mundo, cuerpo: Record<string, unknown> = {}) => m.api.post('/materiales').send({ codigo: 'ACE-15W40', nombre: 'Aceite 15W40', parte_id: m.parte, unidad_id: m.unidad, ...cuerpo });
const compra = (m: Mundo, lineas: Array<{ material_id: number; cantidad: number; costo_unitario: number }>, extra: Record<string, unknown> = {}) =>
  m.api.post('/compras').send({ proveedor_id: m.proveedor, bodega_id: m.bodegaA, fecha_documento: hoy(), lineas, ...extra });
const detalle = async (m: Mundo, id: number) => (await m.api.get(`/materiales/${id}`)).body.data as { existencia_total: number; precio: number; costo_ultimo?: number; costo_promedio?: number; margen?: number; margen_origen?: string; por_bodega: Array<{ bodega_id: number; cantidad: number }>; bajo_minimo: boolean };
const enBodega = (d: { por_bodega: Array<{ bodega_id: number; cantidad: number }> }, id: number): number => d.por_bodega.find((b) => b.bodega_id === id)?.cantidad ?? -1;

describe('materiales', () => {
  it('vienen los insumos generales para clasificar; la clasificación es obligatoria; el código no se repite ni cambia', async () => {
    const m = await mundo();
    const op = (await m.api.get('/inventario-opciones')).body.data as { partes: Array<{ clasificacion: string }>; unidades: Array<{ codigo: string }> };
    expect(op.partes.map((p) => p.clasificacion.slice(0, 5))).toEqual(['99-01-01', '99-02-01', '99-03-01'].map((x) => x.slice(0, 5)));
    expect(op.unidades.map((u) => u.codigo)).not.toContain('KM'); // las unidades de contador no son de inventario
    const r = await material(m, { descripcion: 'aceite para motor', existencia_minima: 5, ubicacion: 'estante 3', codigo: 'ace-15w40' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ codigo: 'ACE-15W40', nombre: 'ACEITE 15W40', unidad: 'UND', existencia_total: 0, existencia_minima: 5, ubicacion: 'ESTANTE 3', clasificacion: expect.stringMatching(/^99-/), precio: 0 });
    expect((await material(m)).status).toBe(409);
    expect((await m.api.post('/materiales').send({ codigo: 'X1', nombre: 'Sin parte', unidad_id: m.unidad })).status).toBe(400);
    expect((await material(m, { codigo: 'X2', parte_id: 99999 })).status).toBe(400);
    expect((await material(m, { codigo: 'X3', unidad_id: 99999 })).status).toBe(400);
    expect((await material(m, { codigo: 'X(4)' })).status).toBe(400); // caracteres que no se aceptan en un código
    expect((await material(m, { codigo: 'X5', existencia_minima: 1.5 })).status).toBe(400); // solo enteros
    const km = (await m.t.sql(async (c) => (await c.query("SELECT id FROM unidades WHERE codigo = 'KM'"))[0] as Array<{ id: number }>))[0]!.id;
    expect((await material(m, { codigo: 'X6', unidad_id: km })).status).toBe(400);
    expect((await m.api.patch(`/materiales/${r.body.data.id}`).send({ codigo: 'OTRO' })).status).toBe(409);
    expect((await m.api.patch(`/materiales/${r.body.data.id}`).send({ nombre: 'Aceite 20W50', existencia_minima: 8 })).body.data).toMatchObject({ nombre: 'ACEITE 20W50', existencia_minima: 8 });
  });

  it('con movimientos, la unidad ya no se cambia; se puede desactivar y el listado filtra', async () => {
    const m = await mundo();
    const id = (await material(m)).body.data.id as number;
    const otraUnidad = (await m.t.sql(async (c) => (await c.query("SELECT id FROM unidades WHERE codigo = 'LT'"))[0] as Array<{ id: number }>))[0]!.id;
    expect((await m.api.patch(`/materiales/${id}`).send({ unidad_id: otraUnidad })).status).toBe(200); // aún sin movimientos
    await compra(m, [{ material_id: id, cantidad: 3, costo_unitario: 10 }]);
    expect((await m.api.patch(`/materiales/${id}`).send({ unidad_id: m.unidad })).status).toBe(409);
    await material(m, { codigo: 'FIL-1', nombre: 'Filtro de aceite', existencia_minima: 10 });
    expect((await m.api.get('/materiales?buscar=filtro')).body.data.total).toBe(1);
    expect((await m.api.get('/materiales?bajo_minimo=true')).body.data.registros.map((x: { codigo: string }) => x.codigo)).toEqual(['FIL-1']);
    await m.api.patch(`/materiales/${id}`).send({ activo: false });
    expect((await m.api.get('/materiales')).body.data.total).toBe(1);
    expect((await m.api.get('/materiales?inactivos=true')).body.data.total).toBe(2);
  });
});

describe('compras', () => {
  it('una compra recibe todas sus líneas: sube la existencia de la bodega, el último costo y el promedio ponderado', async () => {
    const m = await mundo();
    const id = (await material(m)).body.data.id as number;
    const r = await compra(m, [{ material_id: id, cantidad: 10, costo_unitario: 5 }], { numero_factura: 'a-100' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ numero: 'COM-000001', total: 50, numero_factura: 'A-100', proveedor: 'REPUESTOS DEL SUR', lineas: [expect.objectContaining({ cantidad: 10, costo_unitario: 5, subtotal: 50 })] });
    let d = await detalle(m, id);
    expect(d).toMatchObject({ existencia_total: 10, costo_ultimo: 5, costo_promedio: 5 });
    expect(enBodega(d, m.bodegaA)).toBe(10);
    // Segunda compra, a otro costo y en OTRA bodega: el promedio pondera lo que hay en todas.
    const r2 = await compra(m, [{ material_id: id, cantidad: 10, costo_unitario: 7 }], { bodega_id: m.bodegaB });
    expect(r2.body.data.numero).toBe('COM-000002');
    d = await detalle(m, id);
    expect(d).toMatchObject({ existencia_total: 20, costo_ultimo: 7, costo_promedio: 6 });
    expect(enBodega(d, m.bodegaB)).toBe(10);
    const libro = (await m.api.get(`/inventario/movimientos?material_id=${id}`)).body.data.registros as Array<{ tipo: string; cantidad: number; saldo_resultante: number; referencia_tipo: string }>;
    expect(libro.map((x) => [x.tipo, x.cantidad, x.saldo_resultante])).toEqual([['COMPRA', 10, 10], ['COMPRA', 10, 10]]);
    expect(libro[0]!.referencia_tipo).toBe('compra');
  });

  it('la factura no se repite para el mismo proveedor; una compra con una línea mala no deja nada a medias', async () => {
    const m = await mundo();
    const a = (await material(m)).body.data.id as number;
    const b = (await material(m, { codigo: 'FIL-1', nombre: 'Filtro' })).body.data.id as number;
    expect((await compra(m, [{ material_id: a, cantidad: 2, costo_unitario: 3 }], { numero_factura: 'F-1' })).status).toBe(201);
    const repetida = await compra(m, [{ material_id: a, cantidad: 2, costo_unitario: 3 }], { numero_factura: 'f-1' });
    expect(repetida.status).toBe(409);
    expect(repetida.body.codigo).toBe('FACTURA_REPETIDA');
    await m.api.patch(`/materiales/${b}`).send({ activo: false });
    const mala = await compra(m, [{ material_id: a, cantidad: 5, costo_unitario: 3 }, { material_id: b, cantidad: 1, costo_unitario: 3 }]);
    expect(mala.status).toBe(400);
    expect(enBodega(await detalle(m, a), m.bodegaA)).toBe(2); // la línea buena tampoco entró
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM compras'))[0] as Array<{ n: number }>)).toEqual([{ n: 1 }]);
    expect((await compra(m, [{ material_id: a, cantidad: 0, costo_unitario: 3 }])).status).toBe(400);
    expect((await compra(m, [{ material_id: a, cantidad: 1.5, costo_unitario: 3 }])).status).toBe(400); // sin decimales
    expect((await compra(m, [{ material_id: a, cantidad: 1, costo_unitario: -1 }])).status).toBe(400);
    expect((await compra(m, [])).status).toBe(400);
    const futura = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date(Date.now() + 5 * 86400000));
    expect((await compra(m, [{ material_id: a, cantidad: 1, costo_unitario: 3 }], { fecha_documento: futura })).status).toBe(400);
    expect((await compra(m, [{ material_id: a, cantidad: 1, costo_unitario: 3 }], { bodega_id: 99999 })).status).toBe(400);
  });

  it('varias compras a la vez no pierden unidades (se bloquea la existencia)', async () => {
    const m = await mundo();
    const id = (await material(m)).body.data.id as number;
    const rs = await Promise.all([1, 2, 3, 4, 5, 6].map(() => compra(m, [{ material_id: id, cantidad: 1, costo_unitario: 10 }])));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(rs.map((r) => r.body.data.numero as string)).size).toBe(6);
    expect(await detalle(m, id)).toMatchObject({ existencia_total: 6, costo_promedio: 10 });
    const libro = (await m.api.get(`/inventario/movimientos?material_id=${id}`)).body.data.registros as Array<{ saldo_resultante: number }>;
    expect(libro.map((x) => x.saldo_resultante).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('traslados y diferencias', () => {
  it('el traslado mueve entre bodegas en un solo paso; si no alcanza, no pasa nada; no a la misma bodega', async () => {
    const m = await mundo();
    const id = (await material(m)).body.data.id as number;
    await compra(m, [{ material_id: id, cantidad: 10, costo_unitario: 4 }]);
    const t1 = await m.api.post('/inventario/traslados').send({ material_id: id, bodega_origen_id: m.bodegaA, bodega_destino_id: m.bodegaB, cantidad: 4, notas: 'para el taller 2' });
    expect(t1.status).toBe(201);
    expect(enBodega(t1.body.data, m.bodegaA)).toBe(6);
    expect(enBodega(t1.body.data, m.bodegaB)).toBe(4);
    const libro = (await m.api.get(`/inventario/movimientos?material_id=${id}&tipo=traslado_entrada`)).body.data.registros as Array<{ referencia_id: number; cantidad: number }>;
    expect(libro[0]).toMatchObject({ cantidad: 4 });
    const salida = (await m.api.get(`/inventario/movimientos?material_id=${id}&tipo=traslado_salida`)).body.data.registros as Array<{ id: number; cantidad: number }>;
    expect(salida[0]).toMatchObject({ cantidad: -4 });
    expect(libro[0]!.referencia_id).toBe(salida[0]!.id); // ligados
    const sinEx = await m.api.post('/inventario/traslados').send({ material_id: id, bodega_origen_id: m.bodegaA, bodega_destino_id: m.bodegaB, cantidad: 7 });
    expect(sinEx.status).toBe(409);
    expect(sinEx.body.codigo).toBe('SIN_EXISTENCIA');
    expect(sinEx.body.error).toContain('hay 6 y se necesitan 7');
    expect(enBodega(await detalle(m, id), m.bodegaB)).toBe(4); // nada a medias
    expect((await m.api.post('/inventario/traslados').send({ material_id: id, bodega_origen_id: m.bodegaA, bodega_destino_id: m.bodegaA, cantidad: 1 })).status).toBe(400);
    expect((await m.api.post('/inventario/traslados').send({ material_id: id, bodega_origen_id: m.bodegaA, bodega_destino_id: m.bodegaB, cantidad: 0 })).status).toBe(400);
  });

  it('la diferencia de inventario es la única forma de corregir una cantidad: se escribe lo real, con motivo', async () => {
    const m = await mundo();
    const id = (await material(m)).body.data.id as number;
    await compra(m, [{ material_id: id, cantidad: 10, costo_unitario: 8 }]);
    const cuerpo = { material_id: id, bodega_id: m.bodegaA, cantidad_real: 7, motivo_id: m.motivo };
    expect((await m.api.post('/inventario/diferencias').send({ ...cuerpo, motivo_id: undefined })).status).toBe(400);
    expect((await m.api.post('/inventario/diferencias').send({ ...cuerpo, motivo_id: 99999 })).status).toBe(400);
    expect((await m.api.post('/inventario/diferencias').send({ ...cuerpo, cantidad_real: -1 })).status).toBe(400);
    expect((await m.api.post('/inventario/diferencias').send({ ...cuerpo, cantidad_real: 10 })).body.codigo).toBe('SIN_DIFERENCIA');
    const r = await m.api.post('/inventario/diferencias').send({ ...cuerpo, notas: 'se cayó una caja' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ antes: 10, despues: 7, diferencia: -3, valor: -24 });
    expect(enBodega(r.body.data.material, m.bodegaA)).toBe(7);
    const mov = (await m.api.get(`/inventario/movimientos?material_id=${id}&tipo=diferencia`)).body.data.registros as Array<{ cantidad: number; motivo: string; notas: string; saldo_resultante: number }>;
    expect(mov[0]).toMatchObject({ cantidad: -3, saldo_resultante: 7, notas: 'SE CAYO UNA CAJA' });
    expect(mov[0]!.motivo).toBeTruthy();
    // También sirve para dar de alta lo que había y no estaba registrado (contar más de lo que dice el sistema).
    const mas = await m.api.post('/inventario/diferencias').send({ ...cuerpo, cantidad_real: 12 });
    expect(mas.body.data).toMatchObject({ diferencia: 5 });
  });
});

describe('precio y margen', () => {
  it('el precio es el costo más el margen; manda el más específico; un precio fijo manda sobre todo', async () => {
    const m = await mundo();
    const id = (await material(m)).body.data.id as number;
    await compra(m, [{ material_id: id, cantidad: 10, costo_unitario: 10 }]);
    expect(await detalle(m, id)).toMatchObject({ precio: 13, margen: 30, margen_origen: 'general' });
    const d0 = (await m.api.get(`/materiales/${id}`)).body.data as { sistema_id: number; subsistema_id: number; parte_id: number };
    expect((await m.api.put(`/margenes/sistema/${d0.sistema_id}`).send({ porcentaje: 50 })).status).toBe(200);
    expect(await detalle(m, id)).toMatchObject({ precio: 15, margen_origen: 'sistema' });
    await m.api.put(`/margenes/subsistema/${d0.subsistema_id}`).send({ porcentaje: 40 });
    expect(await detalle(m, id)).toMatchObject({ precio: 14, margen_origen: 'subsistema' });
    await m.api.put(`/margenes/parte/${d0.parte_id}`).send({ porcentaje: 20 });
    expect(await detalle(m, id)).toMatchObject({ precio: 12, margen_origen: 'parte' });
    await m.api.put(`/margenes/material/${id}`).send({ porcentaje: 100 });
    expect(await detalle(m, id)).toMatchObject({ precio: 20, margen_origen: 'material' });
    expect((await m.api.get('/margenes')).body.data.map((x: { nivel: string }) => x.nivel)).toEqual(['sistema', 'subsistema', 'parte', 'material']);
    await m.api.patch(`/materiales/${id}`).send({ precio_manual: 99.5 });
    expect((await detalle(m, id)).precio).toBe(99.5);
    await m.api.patch(`/materiales/${id}`).send({ precio_manual: null });
    expect((await m.api.delete(`/margenes/material/${id}`)).status).toBe(200);
    expect(await detalle(m, id)).toMatchObject({ precio: 12, margen_origen: 'parte' });
    expect((await m.api.put(`/margenes/parte/${d0.parte_id}`).send({ porcentaje: -5 })).status).toBe(400);
    expect((await m.api.put('/margenes/parte/99999').send({ porcentaje: 10 })).status).toBe(404);
  });

  it('el costo base (último o promedio) y el margen general son configuración del taller', async () => {
    const m = await mundo();
    const id = (await material(m)).body.data.id as number;
    await compra(m, [{ material_id: id, cantidad: 10, costo_unitario: 10 }]);
    await compra(m, [{ material_id: id, cantidad: 10, costo_unitario: 20 }]); // promedio 15, último 20
    expect((await detalle(m, id)).precio).toBe(19.5); // 15 × 1.30 (promedio, por defecto)
    expect((await m.api.patch('/configuracion').send({ costo_base_inventario: 'ULTIMO COSTO', margen_general: 10 })).status).toBe(200);
    expect((await detalle(m, id)).precio).toBe(22); // 20 × 1.10
    expect((await m.api.patch('/configuracion').send({ margen_general: 5000 })).status).toBe(400);
  });
});

describe('quién ve costos y quién hace qué', () => {
  it('sin permiso no salen los costos ni los márgenes; el bodeguero recibe y corrige pero no cambia el catálogo', async () => {
    const m = await mundo();
    const id = (await material(m)).body.data.id as number;
    await compra(m, [{ material_id: id, cantidad: 10, costo_unitario: 10 }]);
    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    const ficha = (await recepcion.get(`/materiales/${id}`)).body.data;
    expect(ficha.precio).toBe(13);
    for (const k of ['costo_ultimo', 'costo_promedio', 'margen', 'margen_origen']) expect(ficha).not.toHaveProperty(k);
    expect(JSON.stringify((await recepcion.get('/materiales')).body.data)).not.toMatch(/costo_/);
    const mov = (await recepcion.get('/inventario/movimientos')).body.data.registros[0];
    expect(mov).not.toHaveProperty('costo_unitario');
    expect((await recepcion.get('/margenes')).status).toBe(403);
    expect((await recepcion.post('/compras').send({})).status).toBe(403);
    expect((await recepcion.post('/inventario/diferencias').send({})).status).toBe(403);

    const bodega = m.t.api(await (await m.t.usuario('bodeguero')).token());
    expect((await bodega.post('/compras').send({ proveedor_id: m.proveedor, bodega_id: m.bodegaA, fecha_documento: hoy(), lineas: [{ material_id: id, cantidad: 5, costo_unitario: 12 }] })).status).toBe(201);
    expect((await bodega.post('/inventario/diferencias').send({ material_id: id, bodega_id: m.bodegaA, cantidad_real: 14, motivo_id: m.motivo })).status).toBe(201);
    expect((await bodega.post('/inventario/traslados').send({ material_id: id, bodega_origen_id: m.bodegaA, bodega_destino_id: m.bodegaB, cantidad: 1 })).status).toBe(201);
    expect((await bodega.post('/materiales').send({ codigo: 'Z1', nombre: 'No puede', parte_id: m.parte, unidad_id: m.unidad })).status).toBe(403);
    expect((await bodega.get(`/materiales/${id}`)).body.data).not.toHaveProperty('costo_promedio');
    const jefe = (await m.api.get(`/materiales/${id}`)).body.data;
    expect(jefe).toMatchObject({ costo_ultimo: 12 });
    const visualizador = m.t.api(await (await m.t.usuario('visualizador')).token());
    expect((await visualizador.get('/materiales')).status).toBe(200);
    expect((await visualizador.post('/inventario/traslados').send({})).status).toBe(403);
  });
});
