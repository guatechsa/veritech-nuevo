import { filas } from '../../src/db/consulta';
import { crearTransporteExpo, enviarPendientesPush, MensajePush, ResultadoPush, revisarPush, TransportePush } from '../../src/taller/avisos-push';
import { poolsDe } from '../../src/taller/contexto';
import { buscarEmpresa } from '../../src/taller/resolutor';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { dia, mundo as mundoDeOrdenes, Mundo as MundoOrdenes, nueva, ordenId } from './ayuda-ordenes';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
let paso = 0;
/** Adelanta el reloj de la prueba 2 minutos más que la vez anterior (la base redondea las horas al segundo: no se puede enviar «en el mismo instante»). */
const adelantar = (): void => {
  paso += 1;
  e.reloj.fijo = new Date(Date.now() + paso * 120000);
};
beforeEach(async () => {
  paso = 0;
  await e.limpiar();
  await e.planesConPaypal();
  e.reloj.fijo = null;
});

type Mundo = MundoOrdenes & { orden: number; bodega: number; material: number };

async function mundo(): Promise<Mundo> {
  const base = await mundoDeOrdenes(e);
  const sucursal = ((await base.api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id;
  const bodega = (await base.api.post('/bodegas').send({ nombre: 'Bodega principal', sucursal_id: sucursal })).body.data.id as number;
  const op = (await base.api.get('/inventario-opciones')).body.data as { unidades: Array<{ id: number; codigo: string }>; partes: Array<{ id: number; clasificacion: string }> };
  const material = (await base.api.post('/materiales').send({ codigo: 'ACE-15W40', nombre: 'Aceite 15W40', parte_id: op.partes.find((p) => p.clasificacion.startsWith('99-'))!.id, unidad_id: op.unidades.find((u) => u.codigo === 'UND')!.id })).body.data.id as number;
  expect((await base.api.post('/compras').send({ proveedor_id: base.proveedor, bodega_id: bodega, fecha_documento: dia(0), lineas: [{ material_id: material, cantidad: 10, costo_unitario: 10 }] })).status).toBe(201);
  return { ...base, orden: ordenId(await nueva(base)), bodega, material };
}

/** Un transporte falso: anota lo que se le pidió mandar y responde lo que se le diga. */
function falso(respuesta: (m: MensajePush) => ResultadoPush = () => ({ estado: 'ok' })): TransportePush & { enviados: MensajePush[] } {
  const enviados: MensajePush[] = [];
  return {
    enviados,
    async enviar(mensajes) {
      enviados.push(...mensajes);
      return mensajes.map(respuesta);
    },
  };
}
const sql = (m: Mundo, consulta: string, params: unknown[] = []) => m.t.sql(async (c) => (await c.query(consulta, params))[0] as Array<Record<string, unknown>>);
async function treq(m: Mundo) {
  const empresa = (await buscarEmpresa(e.ctx, m.t.slug))!;
  return { empresa, pool: poolsDe(e.ctx).obtener(empresa.nombreBd) };
}
const enviar = async (m: Mundo, transporte: TransportePush) => {
  adelantar();
  return enviarPendientesPush(e.ctx, await treq(m), transporte);
};
const cola = (m: Mundo) => sql(m, 'SELECT tipo, estado, intentos, clave, titulo FROM notificaciones_push ORDER BY id');
/** Una persona con su teléfono registrado (con el código para recibir avisos). */
async function conTelefono(m: Mundo, rol: string, correo: string, token = `ExponentPushToken[${correo.split('@')[0]}]`) {
  const u = await m.t.usuario(rol, correo);
  const api = m.t.api(await u.token());
  expect((await api.post('/movil/dispositivo').send({ instalacion: `inst-${correo.split('@')[0]}-abcdef`, plataforma: 'android', token_push: token })).status).toBe(200);
  return { ...u, api, token };
}

describe('avisos al teléfono: los hechos del momento', () => {
  it('trabajo asignado: llega al técnico (una vez por trabajo), con a dónde lleva; sin teléfono queda anotado; a quien no es técnico no le llega', async () => {
    const m = await mundo();
    const tec = await conTelefono(m, 'tecnico', 'tec@taller.test');
    const sinTel = await m.t.usuario('tecnico', 'sin@taller.test');
    const linea = await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tec.colaboradorId });
    expect(linea.status).toBe(201);
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: sinTel.colaboradorId });
    const visual = await m.t.usuario('visualizador', 'vis@taller.test');
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado', cantidad: 1, precio_unitario: 10, tecnico_id: visual.colaboradorId });
    const pendientes = await cola(m);
    expect(pendientes.map((p) => p['tipo'])).toEqual(['trabajo_asignado', 'trabajo_asignado']); // el visualizador no tiene derecho
    const transporte = falso();
    const r = await enviar(m, transporte);
    expect(r).toEqual({ enviadas: 1, sin_dispositivo: 1, con_error: 0 });
    expect(transporte.enviados).toHaveLength(1);
    expect(transporte.enviados[0]).toMatchObject({ to: tec.token, title: 'Le asignaron un trabajo', data: { pantalla: 'trabajo', orden_id: m.orden } });
    expect(transporte.enviados[0]!.body).toContain('CAM-1');
    expect((await enviar(m, falso())).enviadas).toBe(0); // ya no hay nada por mandar
    // Reasignar el MISMO trabajo al mismo técnico no repite el aviso.
    const lineaId = (await filas<{ id: number }>(e.pool, 'SELECT 1 AS id')).length && (await sql(m, 'SELECT id FROM lineas_orden WHERE tecnico_id = ? ORDER BY id LIMIT 1', [tec.colaboradorId]))[0]!['id'];
    expect((await m.api.patch(`/lineas/${lineaId}`).send({ tecnico_id: tec.colaboradorId })).status).toBe(200);
    expect(await cola(m)).toHaveLength(2);
  });

  it('si la persona apagó ese aviso, no se le manda', async () => {
    const m = await mundo();
    const tec = await conTelefono(m, 'tecnico', 'tec@taller.test');
    expect((await tec.api.put('/movil/preferencias-aviso/trabajo_asignado').send({ activo: false })).status).toBe(200);
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tec.colaboradorId });
    expect(await cola(m)).toHaveLength(0);
  });

  it('material cargado: avisa a los técnicos con trabajos abiertos en la orden, cada vez que llega más; solicitud nueva: avisa a bodega', async () => {
    const m = await mundo();
    const tec = await conTelefono(m, 'tecnico', 'tec@taller.test');
    const bod = await conTelefono(m, 'bodeguero', 'bod@taller.test');
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tec.colaboradorId });
    const sol = (await m.api.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.material, cantidad: 4 }] })).body.data as { id: number; lineas: Array<{ id: number }> };
    let tipos = (await cola(m)).map((x) => x['tipo']);
    expect(tipos.filter((x) => x === 'trabajo_asignado')).toHaveLength(1);
    expect(tipos.filter((x) => x === 'solicitud_material_nueva').length).toBeGreaterThanOrEqual(1); // a todos los que despachan (también a la administración)
    const transporte = falso();
    await enviar(m, transporte);
    expect(transporte.enviados.map((x) => x.to).sort()).toEqual([bod.token, tec.token].sort()); // la administración no tiene teléfono: no se manda nada
    const despachar = (n: number) => m.api.post(`/solicitudes/${sol.id}/despachar`).send({ items: [{ linea_id: sol.lineas[0]!.id, bodega_id: m.bodega, cantidad: n }] });
    expect((await despachar(3)).status).toBe(200);
    expect((await despachar(1)).status).toBe(200);
    tipos = (await cola(m)).map((x) => x['tipo']);
    expect(tipos.filter((x) => x === 'material_cargado')).toHaveLength(2);
    const t2 = falso();
    await enviar(m, t2);
    expect(t2.enviados.every((x) => x.to === tec.token && x.title === 'Llegó material a su orden')).toBe(true); // a bodega no
    expect(t2.enviados).toHaveLength(2);
  });
});

describe('avisos al teléfono: la revisión del día', () => {
  async function ordenQueVenceHoy(m: Mundo, tecnicoColaborador: number) {
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tecnicoColaborador });
    const etapa = (await sql(m, "SELECT id FROM etapas WHERE codigo = 'MANTENIMIENTO'"))[0]!['id'] as number;
    const tipo = (await m.api.post('/checklists-tipos').send({ codigo: 'frenos', nombre: 'Revision de frenos', etapa_id: etapa, requiere_firma_cliente: false })).body.data.id as number;
    expect((await m.api.put(`/checklists-tipos/${tipo}/plantilla`).send({ secciones: [{ nombre: 'Frenos', items: [{ descripcion: 'Pastillas', tipo_respuesta: 'semaforo' }] }] })).status).toBe(200);
    const ck = (await m.api.post(`/ordenes/${m.orden}/checklists`).send({ tipo_id: tipo })).body.data.id as number;
    await sql(m, 'UPDATE ordenes SET fecha_estimada_entrega = ? WHERE id = ?', [dia(0), m.orden]);
    return ck;
  }

  it('checklist por vencer: la orden se entrega hoy y falta completarlo; solo desde las 7:00 del taller y una vez por día', async () => {
    const m = await mundo();
    const tec = await conTelefono(m, 'tecnico', 'tec@taller.test');
    const ck = await ordenQueVenceHoy(m, tec.colaboradorId);
    await sql(m, 'DELETE FROM notificaciones_push');
    const t = await treq(m);
    e.reloj.fijo = new Date(`${dia(0)}T11:00:00Z`); // 05:00 del taller: todavía no
    expect(await revisarPush(e.ctx, t)).toBe(0);
    e.reloj.fijo = new Date(`${dia(0)}T14:00:00Z`); // 08:00
    expect(await revisarPush(e.ctx, t)).toBe(1);
    expect(await revisarPush(e.ctx, t)).toBe(0); // una vez por día
    const c = await cola(m);
    expect(c).toEqual([expect.objectContaining({ tipo: 'checklist_por_vencer', clave: `chk:${ck}:${dia(0)}` })]);
    // Si el checklist ya se completó, no se avisa al día siguiente.
    await sql(m, "UPDATE checklists SET estado = 'completado' WHERE id = ?", [ck]);
    e.reloj.fijo = new Date(`${dia(1)}T14:00:00Z`);
    expect(await revisarPush(e.ctx, t)).toBe(0);
  });

  it('cita del día: a quien ve citas, con cuántas hay; nada si no hay citas', async () => {
    const m = await mundo();
    const rec = await conTelefono(m, 'recepcionista', 'rec@taller.test');
    const t = await treq(m);
    e.reloj.fijo = new Date(`${dia(0)}T14:00:00Z`);
    expect(await revisarPush(e.ctx, t)).toBe(0); // sin citas, sin aviso
    await sql(m, "INSERT INTO citas (equipo_id, cliente_id, sucursal_id, fecha_hora, estado) SELECT ?, ?, id, ?, 'programada' FROM sucursales LIMIT 1", [m.equipo, m.cliente, new Date(`${dia(0)}T20:00:00Z`)]);
    await sql(m, "INSERT INTO citas (equipo_id, cliente_id, sucursal_id, fecha_hora, estado) SELECT ?, ?, id, ?, 'programada' FROM sucursales LIMIT 1", [m.equipo, m.cliente, new Date(`${dia(0)}T21:00:00Z`)]);
    expect(await revisarPush(e.ctx, t)).toBeGreaterThanOrEqual(1);
    const transporte = falso();
    await enviar(m, transporte);
    const mensaje = transporte.enviados.find((x) => x.to === rec.token)!;
    expect(mensaje.body).toBe('Hoy hay 2 citas.');
    expect(await revisarPush(e.ctx, t)).toBe(0);
  });
});

describe('el envío', () => {
  it('un error se reintenta hasta 3 veces y luego queda como error; un teléfono que ya no existe se desactiva', async () => {
    const m = await mundo();
    const tec = await conTelefono(m, 'tecnico', 'tec@taller.test');
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tec.colaboradorId });
    const malo = falso(() => ({ estado: 'error', error: 'MessageRateExceeded' }));
    const t = await treq(m);
    const horaDe = (min: number) => { e.reloj.fijo = new Date(Date.now() + min * 60000); };
    horaDe(1); // un minuto adelante: la base redondea las horas al segundo
    expect(await enviarPendientesPush(e.ctx, t, malo)).toMatchObject({ con_error: 1 });
    expect((await cola(m))[0]).toMatchObject({ estado: 'pendiente', intentos: 1 });
    horaDe(7);
    await enviarPendientesPush(e.ctx, t, malo);
    horaDe(13);
    await enviarPendientesPush(e.ctx, t, malo);
    expect((await cola(m))[0]).toMatchObject({ estado: 'error', intentos: 3 });
    horaDe(31);
    expect((await enviarPendientesPush(e.ctx, t, falso())).enviadas).toBe(0); // ya no se reintenta

    // Un teléfono que Expo dice que ya no existe se apaga y no se le vuelve a mandar.
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tec.colaboradorId });
    const muerto = falso(() => ({ estado: 'error', error: 'DeviceNotRegistered' }));
    horaDe(41);
    expect(await enviarPendientesPush(e.ctx, t, muerto)).toMatchObject({ sin_dispositivo: 1 });
    expect(await sql(m, 'SELECT activo, token_push FROM dispositivos')).toEqual([{ activo: 0, token_push: null }]);
  });

  it('dos envíos a la vez no mandan el mismo aviso dos veces', async () => {
    const m = await mundo();
    const tec = await conTelefono(m, 'tecnico', 'tec@taller.test');
    await m.api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tec.colaboradorId });
    const transporte = falso();
    const t = await treq(m);
    adelantar();
    await Promise.all([enviarPendientesPush(e.ctx, t, transporte), enviarPendientesPush(e.ctx, t, transporte)]);
    expect(transporte.enviados).toHaveLength(1);
  });

  it('el transporte de Expo manda un solo pedido con todos los mensajes, con su llave si la hay, e interpreta lo que responde', async () => {
    const pedidos: Array<{ url: string; init: RequestInit }> = [];
    const fetchFalso = (async (url: string, init: RequestInit) => {
      pedidos.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ data: [{ status: 'ok' }, { status: 'error', message: 'no existe', details: { error: 'DeviceNotRegistered' } }] }) };
    }) as unknown as typeof fetch;
    const t = crearTransporteExpo({ EXPO_ACCESS_TOKEN: 'llave-secreta' }, fetchFalso);
    const r = await t.enviar([{ to: 'a', title: 'T', body: 'B' }, { to: 'b', title: 'T', body: 'B', data: { x: 1 } }]);
    expect(r).toEqual([{ estado: 'ok' }, { estado: 'error', error: 'DeviceNotRegistered', mensaje: 'no existe' }]);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.url).toBe('https://exp.host/--/api/v2/push/send');
    expect((pedidos[0]!.init.headers as Record<string, string>)['Authorization']).toBe('Bearer llave-secreta');
    const cuerpo = JSON.parse(String(pedidos[0]!.init.body)) as Array<{ to: string; sound: string }>;
    expect(cuerpo.map((x) => x.to)).toEqual(['a', 'b']);
    expect(cuerpo[0]!.sound).toBe('default');
    const sinLlave = crearTransporteExpo({ EXPO_ACCESS_TOKEN: undefined }, fetchFalso);
    await sinLlave.enviar([{ to: 'a', title: 'T', body: 'B' }]);
    expect((pedidos[1]!.init.headers as Record<string, string>)['Authorization']).toBeUndefined();
    const caido = crearTransporteExpo({ EXPO_ACCESS_TOKEN: undefined }, (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch);
    await expect(caido.enviar([{ to: 'a', title: 'T', body: 'B' }])).rejects.toThrow('Expo respondió 503');
  });
});
