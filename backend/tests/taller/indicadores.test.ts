import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { dia, linea, mundo as mundoDeOrdenes, Mundo as MundoOrdenes, nueva, ordenId } from './ayuda-ordenes';

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

type Mundo = MundoOrdenes;
const mundo = (): Promise<Mundo> => mundoDeOrdenes(e);
interface Ind {
  codigo: string;
  valor: number | null;
  detalle: Record<string, number> | null;
  semaforo: string | null;
  meta: { meta: number } | null;
}

/** 10:00 de hoy en el taller (Guatemala es UTC−6 todo el año). */
const T0 = (): Date => new Date(`${dia(0)}T16:00:00Z`);
const mas = (d: Date, horas: number): Date => new Date(d.getTime() + horas * 3600000);

/** Pide como si fuera esa hora (el servidor usa el reloj de la prueba; se vuelve a ingresar para que la sesión valga a esa hora). */
async function como(m: Mundo, cuando: Date) {
  e.reloj.fijo = cuando;
  return m.t.api(await m.t.token());
}
const equipoNuevo = async (m: Mundo, codigo: string, tipo = m.tipoVehiculo): Promise<number> => (await m.api.post('/equipos').send({ tipo_equipo_id: tipo, cliente_id: m.cliente, codigo_interno: codigo })).body.data.equipo.id as number;
const consultar = async (api: Awaited<ReturnType<typeof como>>, desde: string, hasta: string, extra = ''): Promise<Record<string, Ind>> => {
  const r = await api.get(`/indicadores?desde=${desde}&hasta=${hasta}${extra}`);
  expect(r.status).toBe(200);
  return Object.fromEntries((r.body.data as Ind[]).map((i) => [i.codigo, i]));
};
const cerrar = async (api: Awaited<ReturnType<typeof como>>, m: Mundo, orden: number): Promise<void> => {
  expect((await api.post(`/ordenes/${orden}/estado`).send({ estado_id: m.estados['ENTREGADA'] })).status).toBe(200);
  expect((await api.post(`/ordenes/${orden}/estado`).send({ estado_id: m.estados['CERRADA'] })).status).toBe(200);
};
const terminar = async (api: Awaited<ReturnType<typeof como>>, lineaId: number): Promise<void> => {
  expect((await api.post(`/lineas/${lineaId}/estado`).send({ estado: 'terminado' })).status).toBe(200);
};
const ids = (r: { body: { data: { lineas: Array<{ id: number }> } } }): number[] => r.body.data.lineas.map((l) => l.id);

describe('indicadores del dinero y de las órdenes', () => {
  it('cuenta lo completado por fecha de cierre y calcula ticket, margen y días en taller; las anuladas y las abiertas no cuentan; los filtros recortan', async () => {
    const m = await mundo();
    const t0 = T0();
    let api = await como(m, t0);
    const eqB = await equipoNuevo(m, 'CAM-2');
    const eqC = await equipoNuevo(m, 'CAM-3');
    const eqE = await equipoNuevo(m, 'CAM-4');
    const a = ordenId(await nueva(m, { equipo_id: m.equipo }));
    const b = ordenId(await nueva(m, { equipo_id: eqB }));
    const c = ordenId(await nueva(m, { equipo_id: eqC }));
    const x = ordenId(await nueva(m, { equipo_id: eqE }));
    const la = ids(await linea(m, a, { tipo: 'servicio', trabajo_id: m.trabajo }));
    const lb1 = ids(await linea(m, b, { tipo: 'servicio', trabajo_id: m.trabajo }));
    const lb2 = ids(await linea(m, b, { tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado', cantidad: 1, precio_unitario: 300, costo: 100 }));
    await linea(m, c, { tipo: 'servicio', trabajo_id: m.trabajo });
    expect((await api.post(`/ordenes/${x}/anular`).send({ motivo_id: m.motivo })).status).toBe(200);

    api = await como(m, mas(t0, 24));
    await terminar(api, la[0]!);
    await cerrar(api, m, a);
    api = await como(m, mas(t0, 48));
    await terminar(api, lb1[0]!);
    await terminar(api, lb2[1]!);
    await cerrar(api, m, b);

    const r = await consultar(api, dia(0), dia(2));
    expect(r['ordenes_completadas']!.valor).toBe(2);
    expect(r['ticket_promedio']!.valor).toBe(330); // (180 + 480) ÷ 2, sin IVA aparte
    expect(r['margen']).toMatchObject({ valor: 60.61, detalle: { ventas: 660, costo: 260 } }); // la mano de obra cuesta lo que dice el tipo de equipo
    expect(r['dias_en_taller']!.valor).toBe(1.5);
    // Por fecha de cierre: el primer día no tiene cierres; sí el segundo.
    expect((await consultar(api, dia(0), dia(0)))['ordenes_completadas']!.valor).toBe(0);
    expect((await consultar(api, dia(1), dia(1)))['ordenes_completadas']!.valor).toBe(1);
    expect((await consultar(api, dia(1), dia(1)))['ticket_promedio']!.valor).toBe(180);
    // Filtros: otra sucursal y otro tipo de equipo no tienen nada.
    const sucursal = ((await api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id;
    expect((await consultar(api, dia(0), dia(2), `&sucursal_id=${sucursal}`))['ordenes_completadas']!.valor).toBe(2);
    const otraSucursal = (await api.post('/sucursales').send({ nombre: 'Norte' })).body.data.id as number;
    expect((await consultar(api, dia(0), dia(2), `&sucursal_id=${otraSucursal}`))['ordenes_completadas']!.valor).toBe(0);
    const maquinaria = ((await api.get('/tipos-equipo')).body.data as Array<{ id: number; codigo: string }>).find((t) => t.codigo === 'MAQUINARIA')!.id;
    const sinMaquinas = await consultar(api, dia(0), dia(2), `&tipo_equipo_id=${maquinaria}`);
    expect(sinMaquinas['ordenes_completadas']!.valor).toBe(0);
    expect(sinMaquinas['ticket_promedio']!.valor).toBeNull();
    // Periodos inválidos.
    expect((await api.get(`/indicadores?desde=${dia(2)}&hasta=${dia(0)}`)).status).toBe(400);
    expect((await api.get('/indicadores?desde=2026-13-45&hasta=2026-14-01')).status).toBe(400);
    expect((await api.get(`/indicadores?desde=${dia(-800)}&hasta=${dia(0)}`)).status).toBe(400);
  });

  it('reconoce el retrabajo: una orden que se reabre', async () => {
    const m = await mundo();
    const t0 = T0();
    let api = await como(m, t0);
    const f = ordenId(await nueva(m));
    api = await como(m, mas(t0, 1));
    await cerrar(api, m, f);
    api = await como(m, mas(t0, 2));
    expect((await api.post(`/ordenes/${f}/estado`).send({ estado_id: m.estados['EN_PROCESO'], motivo: 'quedo mal el trabajo' })).status).toBe(200);
    expect((await consultar(api, dia(0), dia(0)))['retrabajos']).toMatchObject({ valor: null }); // reabierta: hoy no hay ninguna completada
    api = await como(m, mas(t0, 3));
    await cerrar(api, m, f);
    const r = await consultar(api, dia(0), dia(0));
    expect(r['ordenes_completadas']!.valor).toBe(1);
    expect(r['retrabajos']).toMatchObject({ valor: 100, detalle: { reabiertas: 1, completadas: 1 } });
  });
});

describe('indicadores de tiempo, bodega y citas', () => {
  it('eficiencia y utilización de técnicos (solo con trabajos medidos con el cronómetro) y tiempo de despacho de bodega', async () => {
    const m = await mundo();
    const t0 = T0();
    const tecnico = await m.t.usuario('tecnico');
    let api = await como(m, t0);
    const eq2 = await equipoNuevo(m, 'CAM-2');
    const g = ordenId(await nueva(m));
    const h = ordenId(await nueva(m, { equipo_id: eq2 }));
    const lg = ids(await linea(m, g, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tecnico.colaboradorId }))[0]!;
    const lh = ids(await linea(m, h, { tipo: 'servicio', trabajo_id: m.trabajo }))[0]!;
    expect((await api.post(`/lineas/${lg}/estado`).send({ estado: 'en_proceso' })).status).toBe(200);
    // Bodega: una solicitud a las 10:00 que se despacha a las 12:00.
    const sucursal = ((await m.api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id;
    const bodega = (await api.post('/bodegas').send({ nombre: 'Principal', sucursal_id: sucursal })).body.data.id as number;
    const op = (await api.get('/inventario-opciones')).body.data as { unidades: Array<{ id: number; codigo: string }>; partes: Array<{ id: number; clasificacion: string }> };
    const mat = (await api.post('/materiales').send({ codigo: 'FIL', nombre: 'Filtro', parte_id: op.partes.find((p) => p.clasificacion.startsWith('99-'))!.id, unidad_id: op.unidades.find((u) => u.codigo === 'UND')!.id })).body.data.id as number;
    expect((await api.post('/compras').send({ proveedor_id: m.proveedor, bodega_id: bodega, fecha_documento: dia(0), lineas: [{ material_id: mat, cantidad: 5, costo_unitario: 10 }] })).status).toBe(201);
    const sol = (await api.post('/solicitudes').send({ orden_id: g, lineas: [{ material_id: mat, cantidad: 2 }] })).body.data as { id: number; lineas: Array<{ id: number }> };
    api = await como(m, mas(t0, 2));
    expect((await api.post(`/solicitudes/${sol.id}/despachar`).send({ items: [{ linea_id: sol.lineas[0]!.id, bodega_id: bodega, cantidad: 2 }] })).status).toBe(200);
    api = await como(m, mas(t0, 3));
    await terminar(api, lg); // 3 horas reales para 2 horas vendidas
    await terminar(api, lh); // este no se midió: no cuenta

    const r = await consultar(api, dia(0), dia(6)); // una semana: 5 días hábiles
    expect(r['eficiencia_tecnicos']).toMatchObject({ valor: 66.67, detalle: { horas_vendidas: 2, horas_trabajadas: 3 } });
    expect(r['utilizacion_tecnicos']).toMatchObject({ valor: 7.5, detalle: { horas_trabajadas: 3, horas_disponibles: 40, tecnicos: 1 } }); // 3 ÷ (1 técnico × 5 días × 8 h)
    expect(r['tiempo_despacho']).toMatchObject({ valor: 2, detalle: { solicitudes: 1 } });
    // Sin nada que medir, el valor es «sin dato», no cero.
    expect((await consultar(api, dia(-20), dia(-14)))['eficiencia_tecnicos']!.valor).toBeNull();
    expect((await consultar(api, dia(-20), dia(-14)))['tiempo_despacho']!.valor).toBeNull();
  });

  it('puntualidad de citas: solo las que se presentaron, con 15 minutos de gracia', async () => {
    const m = await mundo();
    const t0 = T0();
    const ins = async (estado: string, minutosTarde: number | null, hora: number) =>
      m.t.sql(async (con) => {
        const cita = mas(t0, hora);
        await con.query('INSERT INTO citas (equipo_id, cliente_id, sucursal_id, fecha_hora, estado, llegada_en) VALUES (?, ?, (SELECT id FROM sucursales LIMIT 1), ?, ?, ?)', [m.equipo, m.cliente, cita, estado, minutosTarde === null ? null : new Date(cita.getTime() + minutosTarde * 60000)]);
      });
    await ins('se_presento', 10, 1);
    await ins('se_presento', 0, 2);
    await ins('se_presento', 30, 3);
    await ins('no_se_presento', null, 4);
    await ins('programada', null, 5);
    const api = await como(m, t0);
    expect((await consultar(api, dia(0), dia(0)))['puntualidad_citas']).toMatchObject({ valor: 66.67, detalle: { citas: 3 } });
  });
});

describe('cotizaciones: autorización y rechazos', () => {
  it('mide cuánto de lo cotizado autoriza el cliente y por qué rechaza; el dinero solo con el permiso', async () => {
    const m = await mundo();
    const t0 = T0();
    let api = await como(m, t0);
    const o = ordenId(await nueva(m));
    const c = (await api.post('/cotizaciones').send({ orden_id: o })).body.data as { id: number };
    await api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo });
    await api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado', cantidad: 1, precio_unitario: 300, costo: 100 });
    const env = (await api.post(`/cotizaciones/${c.id}/enviar`).send({})).body.data as { lineas: Array<{ id: number }> };
    const motivo = ((await api.get('/cotizaciones-opciones')).body.data as { motivos_rechazo: Array<{ id: number; nombre: string }> }).motivos_rechazo[0]!;
    api = await como(m, mas(t0, 1));
    await api.post(`/cotizacion-lineas/${env.lineas[0]!.id}/responder`).send({ decision: 'autorizada' });
    await api.post(`/cotizacion-lineas/${env.lineas[1]!.id}/responder`).send({ decision: 'rechazada', motivo_id: motivo.id });

    const r = await consultar(api, dia(0), dia(0));
    expect(r['autorizacion_lineas']).toMatchObject({ valor: 50, detalle: { lineas: 2, autorizadas: 1 } });
    expect(r['autorizacion_valor']).toMatchObject({ valor: 37.5, detalle: { cotizado: 480, autorizado: 180 } });
    const rz = (await api.get(`/reportes/rechazos?desde=${dia(0)}&hasta=${dia(0)}`)).body.data;
    expect(rz).toMatchObject({ total_lineas: 1, total_valor: 300, por_motivo: [{ nombre: motivo.nombre, lineas: 1, valor: 300 }], por_tipo_equipo: [{ nombre: 'VEHICULO', lineas: 1 }], por_cliente: [{ nombre: 'INDUSTRIAS LOPEZ', lineas: 1 }] });

    // El supervisor ve lo operativo pero no el dinero.
    const supervisor = m.t.api(await (await m.t.usuario('supervisor')).token());
    const s = await consultar(supervisor, dia(0), dia(0));
    expect(s['autorizacion_lineas']!.valor).toBe(50);
    for (const k of ['ticket_promedio', 'margen', 'autorizacion_valor']) expect(s).not.toHaveProperty(k);
    const rs = (await supervisor.get(`/reportes/rechazos?desde=${dia(0)}&hasta=${dia(0)}`)).body.data;
    expect(rs.total_lineas).toBe(1);
    expect(JSON.stringify(rs)).not.toContain('valor');
  });
});

describe('metas y semáforo, y quién puede qué', () => {
  it('una meta pinta el indicador de verde, amarillo o rojo; se valida y se quita; solo la configura quien tiene el permiso', async () => {
    const m = await mundo();
    const t0 = T0();
    let api = await como(m, t0);
    const o = ordenId(await nueva(m));
    api = await como(m, mas(t0, 1));
    await cerrar(api, m, o);
    const completadas = async (): Promise<Ind> => (await consultar(api, dia(0), dia(0)))['ordenes_completadas']!; // vale 1
    expect((await completadas()).semaforo).toBeNull();
    expect((await api.put('/indicadores/metas/ordenes_completadas').send({ meta: 3, limite: 1 })).status).toBe(200);
    expect(await completadas()).toMatchObject({ semaforo: 'amarillo', meta: { meta: 3 } });
    await api.put('/indicadores/metas/ordenes_completadas').send({ meta: 1 });
    expect((await completadas()).semaforo).toBe('verde');
    await api.put('/indicadores/metas/ordenes_completadas').send({ meta: 5, limite: 2 });
    expect((await completadas()).semaforo).toBe('rojo');
    // Entre más bajo mejor: los días en taller.
    expect((await api.put('/indicadores/metas/dias_en_taller').send({ meta: 2, limite: 5 })).status).toBe(200);
    expect((await api.put('/indicadores/metas/ordenes_completadas').send({ meta: 3, limite: 9 })).status).toBe(400); // el amarillo no puede estar por encima de la meta
    expect((await api.put('/indicadores/metas/no_existe').send({ meta: 1 })).status).toBe(400);
    expect((await api.get('/indicadores/metas')).body.data).toHaveLength(2);
    expect((await api.delete('/indicadores/metas/ordenes_completadas')).body.data).toHaveLength(1);
    expect((await completadas()).semaforo).toBeNull();

    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    const tecnico = m.t.api(await (await m.t.usuario('tecnico')).token());
    expect((await recepcion.get('/indicadores/metas')).status).toBe(200);
    expect((await recepcion.put('/indicadores/metas/ordenes_completadas').send({ meta: 1 })).status).toBe(403);
    expect((await recepcion.get('/tablero/config')).status).toBe(403);
    expect((await tecnico.get(`/indicadores?desde=${dia(0)}&hasta=${dia(0)}`)).status).toBe(403);
    expect((await tecnico.get('/reportes/rechazos?desde=2026-01-01&hasta=2026-01-02')).status).toBe(403);
  });
});

describe('el tablero de inicio por rol', () => {
  it('cada rol ve sus tarjetas con sus números; solo lo que su permiso deja; la empresa puede cambiarlas y volver a las sugeridas', async () => {
    const m = await mundo();
    const t0 = T0();
    const tecnico = await m.t.usuario('tecnico');
    const api = await como(m, t0);
    const eq2 = await equipoNuevo(m, 'CAM-2');
    const o1 = ordenId(await nueva(m));
    const o2 = ordenId(await nueva(m, { equipo_id: eq2 }));
    await m.t.sql(async (con) => con.query('UPDATE ordenes SET fecha_estimada_entrega = ? WHERE id = ?', [dia(-1), o2]));
    await linea(m, o1, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tecnico.colaboradorId });
    await linea(m, o2, { tipo: 'servicio', trabajo_id: m.trabajo });
    await m.t.sql(async (con) => con.query("INSERT INTO citas (equipo_id, cliente_id, sucursal_id, fecha_hora, estado) VALUES (?, ?, (SELECT id FROM sucursales LIMIT 1), ?, 'programada')", [m.equipo, m.cliente, mas(t0, 4)]));

    const tarjetas = async (a: Awaited<ReturnType<typeof como>>): Promise<Record<string, { valor: number | null; titulo: string; ruta: string }>> =>
      Object.fromEntries(((await a.get('/tablero')).body.data as Array<{ codigo: string; valor: number | null; titulo: string; ruta: string }>).map((c) => [c.codigo, c]));
    const admin = await tarjetas(api);
    expect(Object.keys(admin)).toEqual(['ordenes_completadas', 'ticket_promedio', 'margen', 'ordenes_abiertas', 'ordenes_vencidas', 'cotizaciones_sin_respuesta', 'autorizacion_lineas', 'materiales_bajo_minimo']);
    expect(admin['ordenes_abiertas']).toMatchObject({ valor: 2, ruta: '/ordenes' });
    expect(admin['ordenes_vencidas']!.valor).toBe(1);

    const recepcion = m.t.api(await (await m.t.usuario('recepcionista')).token());
    const r = await tarjetas(recepcion);
    expect(r['citas_hoy']!.valor).toBe(1);
    expect(r['equipos_en_taller']!.valor).toBe(2);
    expect(r['ordenes_vencidas']!.valor).toBe(1);
    const tec = await tarjetas(m.t.api(await tecnico.token()));
    expect(tec['mis_trabajos']!.valor).toBe(1); // solo los suyos
    expect(tec).not.toHaveProperty('ticket_promedio');
    const bodega = await tarjetas(m.t.api(await (await m.t.usuario('bodeguero')).token()));
    expect(Object.keys(bodega)).toEqual(['solicitudes_pendientes', 'tiempo_despacho', 'materiales_bajo_minimo', 'reservas_por_vencer']);

    // Sin permiso de dinero no sale dinero aunque la tarjeta esté en su lista.
    const rolSupervisor = ((await api.get('/tablero/config')).body.data as { roles: Array<{ id: number; codigo: string; personalizado: boolean }> }).roles.find((x) => x.codigo === 'supervisor')!;
    expect((await api.put(`/tablero/config/${rolSupervisor.id}`).send({ tarjetas: ['ticket_promedio', 'ordenes_abiertas'] })).status).toBe(200);
    const sup = await tarjetas(m.t.api(await (await m.t.usuario('supervisor')).token()));
    expect(Object.keys(sup)).toEqual(['ordenes_abiertas']);

    // La empresa cambia las tarjetas de un rol y puede volver a las sugeridas.
    const rolTec = ((await api.get('/tablero/config')).body.data as { roles: Array<{ id: number; codigo: string }> }).roles.find((x) => x.codigo === 'tecnico')!;
    expect((await api.put(`/tablero/config/${rolTec.id}`).send({ tarjetas: ['ordenes_abiertas', 'mis_trabajos'] })).status).toBe(200);
    expect(Object.keys(await tarjetas(m.t.api(await tecnico.token())))).toEqual(['ordenes_abiertas', 'mis_trabajos']);
    expect((await api.put(`/tablero/config/${rolTec.id}`).send({ tarjetas: ['no_existe'] })).status).toBe(400);
    expect((await api.put(`/tablero/config/${rolTec.id}`).send({ tarjetas: ['mis_trabajos', 'mis_trabajos'] })).status).toBe(400);
    expect((await api.delete(`/tablero/config/${rolTec.id}`)).status).toBe(200);
    expect(Object.keys(await tarjetas(m.t.api(await tecnico.token())))).toEqual(['mis_trabajos', 'trabajos_detenidos']);
    // Las tarjetas de indicadores traen el mes anterior para comparar.
    const dato = ((await api.get('/tablero')).body.data as Array<{ codigo: string; anterior?: number | null }>).find((c) => c.codigo === 'ordenes_completadas')!;
    expect(dato).toHaveProperty('anterior');
  });
});
