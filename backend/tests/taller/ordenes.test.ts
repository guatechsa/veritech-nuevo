import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { dia, linea, mundo, nueva, ordenId } from './ayuda-ordenes';

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


describe('crear una orden', () => {
  it('nace con su número, estado inicial, historial, el equipo en el taller y la lectura de recepción', async () => {
    const m = await mundo(e);
    const r = await nueva(m, { prioridad: 'alta', lectura: { contador_id: m.odometro, valor: 1500 } });
    expect(r.status).toBe(201);
    const o = r.body.data.orden;
    expect(o).toMatchObject({ numero: 'REP-000001', estado: 'CREADA', prioridad: 'alta', cliente: 'INDUSTRIAS LOPEZ', descripcion: 'CAMBIO DE ACEITE', equipo_en_taller: true, tipo: 'REPARACION' });
    expect(o.historial).toHaveLength(1);
    expect(o.historial[0].estado).toBe('CREADA');
    expect(o.lecturas).toEqual([expect.objectContaining({ valor: 1500 })]);
    const lectura = await m.t.sql(async (c) => (await c.query("SELECT origen, orden_id FROM lecturas_contador WHERE valor = 1500"))[0] as Array<{ origen: string; orden_id: number }>);
    expect(lectura[0]).toMatchObject({ origen: 'orden', orden_id: o.id });
    const ingreso = await m.t.sql(async (c) => (await c.query('SELECT lectura_contador_id, recibido_por_id FROM ingresos_equipo'))[0] as Array<{ lectura_contador_id: number | null; recibido_por_id: number | null }>);
    expect(ingreso[0]!.lectura_contador_id).not.toBeNull();
    expect(ingreso[0]!.recibido_por_id).not.toBeNull();
    // La segunda orden del mismo tipo sigue la numeración y avisa que el equipo ya tiene una abierta.
    const r2 = await nueva(m);
    expect(r2.body.data.orden.numero).toBe('REP-000002');
    expect(r2.body.data.avisos).toEqual([{ tipo: 'orden_abierta', numero: 'REP-000001' }]);
  });

  it('cada tipo de orden lleva su propia numeración y varias a la vez nunca repiten número', async () => {
    const m = await mundo(e);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => nueva(m)));
    expect(rs.every((r) => r.status === 201)).toBe(true);
    const numeros = rs.map((r) => r.body.data.orden.numero as string);
    expect(new Set(numeros).size).toBe(5);
    expect(numeros.every((n) => /^REP-\d{6}$/.test(n))).toBe(true);
    const mant = await nueva(m, { tipo_orden_id: m.tipos['MAN'] });
    expect(mant.body.data.orden.numero).toBe('MAN-000001');
  });

  it('rechaza lo que no corresponde: equipo de baja, equipo inexistente, fecha pasada, lectura de otro equipo', async () => {
    const m = await mundo(e);
    expect((await m.api.post('/ordenes').send({ equipo_id: 99999 })).status).toBe(400);
    expect((await nueva(m, { fecha_estimada_entrega: dia(-1) })).status).toBe(400);
    expect((await nueva(m, { fecha_estimada_entrega: dia(3) })).status).toBe(201);
    expect((await nueva(m, { lectura: { contador_id: 99999, valor: 5000 } })).status).toBe(400);
    expect((await nueva(m, { lectura: { contador_id: m.odometro, valor: 10 } })).status).toBe(409); // el medidor solo avanza
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM ordenes'))[0] as Array<{ n: number }>)).toEqual([{ n: 1 }]); // la fallida no dejó nada a medias
    const baja = await m.api.post(`/equipos/${m.equipo}/estado`).send({ estado: 'baja', motivo: 'vendido' });
    expect(baja.status).toBe(409); // tiene una orden abierta
    await m.api.post('/ordenes/1/anular').send({ motivo_id: m.motivo });
  });

  it('un pedido especial nace sin el equipo presente y no lleva lectura', async () => {
    const m = await mundo(e);
    const pedido = await m.t.sql(async (c) => (await c.query("UPDATE tipos_orden SET es_pedido_especial = 1 WHERE codigo = 'MAN'"))[0]);
    expect(pedido).toBeDefined();
    const r = await nueva(m, { tipo_orden_id: m.tipos['MAN'] });
    expect(r.status).toBe(201);
    expect(r.body.data.orden).toMatchObject({ equipo_en_taller: false, ingresos: 0, dias_en_taller: null });
    expect((await nueva(m, { tipo_orden_id: m.tipos['MAN'], lectura: { contador_id: m.odometro, valor: 2000 } })).status).toBe(400);
  });
});

describe('líneas y precios', () => {
  it('el precio es horas por tarifa, con el descuento del cliente y el IVA calculados por el servidor', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const r = await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo });
    expect(r.status).toBe(201);
    const l = r.body.data.lineas[0];
    expect(l).toMatchObject({ tipo: 'servicio', horas_trabajo: 2, tarifa_hora_aplicada: 100, costo_hora_aplicado: 40, precio_unitario: 200, descuento_pct: 10, total_linea: 180, costo: 80, estado: 'pendiente' });
    expect(r.body.data).toMatchObject({ subtotal: 200, descuento_total: 20, iva: 21.6, total: 201.6 });
  });

  it('la tarifa queda COPIADA: si luego cambia la tarifa, la línea ya fijada no cambia', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo });
    expect((await m.api.patch(`/tipos-equipo/${m.tipoVehiculo}`).send({ tarifa_venta_hora: 500 })).status).toBe(200);
    const o = (await m.api.get(`/ordenes/${id}`)).body.data;
    expect(o.lineas[0]).toMatchObject({ precio_unitario: 200, tarifa_hora_aplicada: 100 });
    expect(o.total).toBe(201.6);
    // Una línea nueva sí usa la tarifa nueva.
    const r = await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo });
    expect(r.body.data.lineas[1]).toMatchObject({ precio_unitario: 1000, tarifa_hora_aplicada: 500 });
  });

  it('la tarifa por área manda sobre la del tipo de equipo, y se puede quitar', async () => {
    const m = await mundo(e);
    expect((await m.api.put(`/tarifas-area/${m.area}/${m.tipoVehiculo}`).send({ tarifa_venta_hora: 150, costo_hora: 70 })).status).toBe(200);
    const id = ordenId(await nueva(m));
    const r = await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo, area_trabajo_id: m.area });
    expect(r.body.data.lineas[0]).toMatchObject({ tarifa_hora_aplicada: 150, costo_hora_aplicado: 70, precio_unitario: 300, costo: 140 });
    expect((await m.api.delete(`/tarifas-area/${m.area}/${m.tipoVehiculo}`)).status).toBe(200);
    const r2 = await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo, area_trabajo_id: m.area });
    expect(r2.body.data.lineas[1]).toMatchObject({ tarifa_hora_aplicada: 100 });
    expect((await m.api.put(`/tarifas-area/${m.area}/${m.tipoVehiculo}`).send({ tarifa_venta_hora: -5, costo_hora: 1 })).status).toBe(400);
  });

  it('un trabajo sin horas para ese tipo de equipo pide definirlas, o escribirlas a mano', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const sin = await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajoSinHoras });
    expect(sin.status).toBe(409);
    expect(sin.body.codigo).toBe('SIN_HORAS');
    const mano = await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajoSinHoras, horas_trabajo: 1.5 });
    expect(mano.status).toBe(201);
    expect(mano.body.data.lineas[0]).toMatchObject({ horas_trabajo: 1.5, precio_unitario: 150 });
  });

  it('con «los precios ya incluyen IVA» el IVA se saca del total en vez de sumarse', async () => {
    const m = await mundo(e);
    await m.t.sql(async (c) => c.query("INSERT INTO configuracion (clave, valor) VALUES ('precios_incluyen_iva', 'true') ON DUPLICATE KEY UPDATE valor = 'true'"));
    const id = ordenId(await nueva(m));
    const r = await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo });
    expect(r.body.data).toMatchObject({ subtotal: 200, descuento_total: 20, total: 180, iva: 19.29 });
  });

  it('trabajos con terceros: cantidad por precio; los materiales esperan a Inventario', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const r = await linea(m, id, { tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado de culata', cantidad: 2, precio_unitario: 50, costo: 60 });
    expect(r.status).toBe(201);
    expect(r.body.data.lineas[0]).toMatchObject({ tipo: 'tercero', descripcion: 'RECTIFICADO DE CULATA', total_linea: 100, costo: 60 });
    expect((await linea(m, id, { tipo: 'tercero', descripcion: 'sin proveedor', precio_unitario: 5 })).status).toBe(400);
    expect((await linea(m, id, { tipo: 'tercero', proveedor_id: m.proveedor, precio_unitario: 5 })).status).toBe(400);
    const mat = await linea(m, id, { tipo: 'material', descripcion: 'filtro' });
    expect(mat.status).toBe(409);
    expect(mat.body.codigo).toBe('SIN_INVENTARIO');
  });

  it('cambiar las horas recalcula el precio; anular una línea pide motivo y recalcula los totales', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const l1 = (await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo })).body.data.lineas[0].id as number;
    const r = await linea(m, id, { tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'pintura', precio_unitario: 100 });
    const l2 = r.body.data.lineas[1].id as number;
    const horas = await m.api.patch(`/lineas/${l1}`).send({ horas_trabajo: 3 });
    expect(horas.body.data.lineas[0]).toMatchObject({ horas_trabajo: 3, precio_unitario: 300, total_linea: 270 });
    expect((await m.api.patch(`/lineas/${l1}`).send({ precio_unitario: 1 })).status).toBe(400); // el precio de un servicio no se escribe
    expect((await m.api.post(`/lineas/${l2}/anular`).send({ motivo: '' })).status).toBe(400);
    const anulada = await m.api.post(`/lineas/${l2}/anular`).send({ motivo: 'el cliente no lo quiso' });
    expect(anulada.status).toBe(200);
    expect(anulada.body.data.lineas[1]).toMatchObject({ motivo_anulacion: 'EL CLIENTE NO LO QUISO' });
    expect(anulada.body.data).toMatchObject({ subtotal: 300, total: 302.4 }); // 270 + 12 %
    expect((await m.api.post(`/lineas/${l2}/anular`).send({ motivo: 'otra vez' })).status).toBe(409);
  });

  it('el estado de la línea guarda cuándo empezó y terminó; un trabajo terminado ya no cambia de precio', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const persona = await m.t.usuario('tecnico');
    const lid = (await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: persona.colaboradorId })).body.data.lineas[0].id as number;
    const a = await m.api.post(`/lineas/${lid}/estado`).send({ estado: 'en_proceso' });
    expect(a.body.data.lineas[0].inicio_en).toBeTruthy();
    const b = await m.api.post(`/lineas/${lid}/estado`).send({ estado: 'detenido_material' });
    expect(b.body.data.lineas[0]).toMatchObject({ estado: 'detenido_material' });
    expect(b.body.data.lineas[0].pausa_en).toBeTruthy();
    const c = await m.api.post(`/lineas/${lid}/estado`).send({ estado: 'terminado' });
    expect(c.body.data.lineas[0].fin_en).toBeTruthy();
    expect((await m.api.patch(`/lineas/${lid}`).send({ horas_trabajo: 9 })).status).toBe(409);
    expect((await m.api.post(`/lineas/${lid}/estado`).send({ estado: 'volando' })).status).toBe(400);
  });
});

describe('quién ve los precios y los costos', () => {
  it('sin permiso ni los precios ni los costos salen del servidor', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo });
    const como = async (rol: string) => {
      const p = await m.t.usuario(rol);
      return m.t.api(await p.token());
    };
    const tecnico = await como('tecnico');
    const ficha = (await tecnico.get(`/ordenes/${id}`)).body.data;
    expect(ficha.lineas[0].horas_trabajo).toBe(2);
    for (const k of ['precio_unitario', 'total_linea', 'tarifa_hora_aplicada', 'costo', 'costo_hora_aplicado', 'descuento_pct']) expect(ficha.lineas[0]).not.toHaveProperty(k);
    for (const k of ['subtotal', 'iva', 'total', 'descuento_total']) expect(ficha).not.toHaveProperty(k);
    const lista = (await tecnico.get('/ordenes')).body.data.registros[0];
    expect(lista).not.toHaveProperty('total');

    const recepcion = await como('recepcionista');
    const rf = (await recepcion.get(`/ordenes/${id}`)).body.data;
    expect(rf.total).toBe(201.6);
    expect(rf.lineas[0].total_linea).toBe(180);
    expect(rf.lineas[0]).not.toHaveProperty('costo');
    expect(rf.lineas[0]).not.toHaveProperty('costo_hora_aplicado');

    const jefe = (await m.api.get(`/ordenes/${id}`)).body.data;
    expect(jefe.lineas[0]).toMatchObject({ costo: 80, costo_hora_aplicado: 40 });
    // Y lo que se devuelve al agregar una línea también respeta el permiso.
    const sup = await como('supervisor');
    const agregada = await sup.post(`/ordenes/${id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo });
    expect(agregada.status).toBe(201);
    expect(agregada.body.data.lineas[1]).not.toHaveProperty('costo');
    expect(agregada.body.data.lineas[1]).toHaveProperty('total_linea');
  });

  it('cada rol hace solo lo suyo: el técnico no crea, la recepción no anula, solo la gerencia reabre', async () => {
    const m = await mundo(e);
    const como = async (rol: string) => m.t.api(await (await m.t.usuario(rol)).token());
    const tecnico = await como('tecnico');
    expect((await tecnico.post('/ordenes').send({ equipo_id: m.equipo })).status).toBe(403);
    expect((await tecnico.get('/ordenes')).status).toBe(200);
    const recepcion = await como('recepcionista');
    const creada = await recepcion.post('/ordenes').send({ equipo_id: m.equipo });
    expect(creada.status).toBe(201);
    const id = creada.body.data.orden.id as number;
    expect((await recepcion.post(`/ordenes/${id}/anular`).send({ motivo_id: m.motivo })).status).toBe(403);
    expect((await recepcion.get('/tarifas-area')).status).toBe(403);
    expect((await tecnico.post(`/ordenes/${id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).status).toBe(403);
  });
});

describe('estados de la orden', () => {
  it('no se cierra con trabajos sin terminar; al cerrar el equipo sale; una orden cerrada no se toca', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const lid = (await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo })).body.data.lineas[0].id as number;
    const enProceso = await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['EN_PROCESO'] });
    expect(enProceso.status).toBe(200);
    expect(enProceso.body.data.historial.map((h: { estado: string }) => h.estado)).toEqual(['CREADA', 'EN PROCESO']);
    expect((await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['EN_PROCESO'] })).status).toBe(409);

    const bloqueo = await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['CERRADA'] });
    expect(bloqueo.status).toBe(409);
    expect(bloqueo.body.codigo).toBe('LINEAS_PENDIENTES');
    expect(bloqueo.body.error).toContain('1 trabajo sin terminar');

    await m.api.post(`/lineas/${lid}/estado`).send({ estado: 'terminado' });
    const entregada = await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['ENTREGADA'] });
    expect(entregada.body.data.equipo_en_taller).toBe(false); // «entregada» ya lo saca del taller
    const cerrada = await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['CERRADA'] });
    expect(cerrada.status).toBe(200);
    expect(cerrada.body.data.fecha_cierre).toBeTruthy();

    // Cerrada: nada se modifica.
    for (const r of [
      await m.api.patch(`/ordenes/${id}`).send({ prioridad: 'baja' }),
      await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo }),
      await m.api.post(`/lineas/${lid}/anular`).send({ motivo: 'tarde' }),
      await m.api.post(`/ordenes/${id}/anular`).send({ motivo_id: m.motivo }),
    ]) {
      expect(r.status).toBe(409);
      expect(r.body.codigo).toBe('ORDEN_CERRADA');
    }
  });

  it('reabrir pide permiso y motivo; el equipo vuelve a quedar en el taller y la fecha de cierre se limpia', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    expect((await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['CERRADA'] })).status).toBe(200); // sin líneas se puede cerrar
    const sup = m.t.api(await (await m.t.usuario('supervisor')).token());
    const sinPermiso = await sup.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['EN_PROCESO'], motivo: 'faltó algo' });
    expect(sinPermiso.status).toBe(403);
    expect((await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['EN_PROCESO'] })).status).toBe(400); // sin motivo
    const r = await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['EN_PROCESO'], motivo: 'faltó cambiar las bandas' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ equipo_en_taller: true, fecha_cierre: null, ingresos: 2 });
    expect(r.body.data.historial.at(-1)).toMatchObject({ estado: 'EN PROCESO', motivo: 'FALTO CAMBIAR LAS BANDAS' });
  });

  it('anular pide motivo de la lista, anula los trabajos sin terminar y conserva los terminados', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const l1 = (await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo })).body.data.lineas[0].id as number;
    await linea(m, id, { tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'pintura', precio_unitario: 100 });
    await m.api.post(`/lineas/${l1}/estado`).send({ estado: 'terminado' });
    expect((await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['ANULADA'] })).status).toBe(400); // por aquí no: pide motivo
    expect((await m.api.post(`/ordenes/${id}/anular`).send({})).status).toBe(400);
    expect((await m.api.post(`/ordenes/${id}/anular`).send({ motivo_id: 99999 })).status).toBe(400);
    const r = await m.api.post(`/ordenes/${id}/anular`).send({ motivo_id: m.motivo, texto: 'el cliente se arrepintió' });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ estado: 'ANULADA', equipo_en_taller: false, motivo_anulacion_texto: 'EL CLIENTE SE ARREPINTIO' });
    expect(r.body.data.lineas[0].anulada_en).toBeNull(); // la terminada se conserva
    expect(r.body.data.lineas[1].anulada_en).toBeTruthy();
    expect(r.body.data.lineas[1].motivo_anulacion).toContain('ORDEN ANULADA');
    expect(r.body.data.subtotal).toBe(200); // solo cuenta lo que quedó vigente
    // Una orden anulada no se reabre.
    expect((await m.api.post(`/ordenes/${id}/estado`).send({ estado_id: m.estados['CREADA'], motivo: 'me equivoqué' })).status).toBe(409);
    expect(await m.t.sql(async (c) => (await c.query('SELECT COUNT(*) AS n FROM ordenes'))[0] as Array<{ n: number }>)).toEqual([{ n: 1 }]); // no se borra nada
  });
});

describe('lo que las órdenes protegen en el resto del sistema', () => {
  it('un equipo con órdenes no cambia de tipo ni se da de baja con una abierta; un cliente con órdenes no se elimina', async () => {
    const m = await mundo(e);
    const id = ordenId(await nueva(m));
    const maq = ((await m.api.get('/tipos-equipo')).body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === 'MAQUINARIA')!.id;
    expect((await m.api.patch(`/equipos/${m.equipo}`).send({ tipo_equipo_id: maq })).status).toBe(409);
    const baja = await m.api.post(`/equipos/${m.equipo}/estado`).send({ estado: 'baja', motivo: 'vendido' });
    expect(baja.status).toBe(409);
    expect(baja.body.codigo).toBe('EN_USO');
    expect((await m.api.delete(`/clientes/${m.cliente}`)).status).toBe(409);
    expect((await m.api.get(`/clientes/${m.cliente}`)).body.data.historia).toMatchObject({ ordenes: 1 });
    await m.api.post(`/ordenes/${id}/anular`).send({ motivo_id: m.motivo });
    expect((await m.api.post(`/equipos/${m.equipo}/estado`).send({ estado: 'baja', motivo: 'vendido' })).status).toBe(200); // ya sin abiertas
    expect((await nueva(m)).status).toBe(409); // y una orden nueva a un equipo de baja se rechaza
  });

  it('un colaborador con trabajos abiertos no se desactiva hasta cerrarlos', async () => {
    const m = await mundo(e);
    const persona = await m.t.usuario('tecnico');
    const id = ordenId(await nueva(m));
    const lid = (await linea(m, id, { tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: persona.colaboradorId })).body.data.lineas[0].id as number;
    const r = await m.api.post(`/colaboradores/${persona.colaboradorId}/estado`).send({ activo: false });
    expect(r.status).toBe(409);
    expect(r.body.codigo).toBe('EN_USO');
    await m.api.post(`/lineas/${lid}/estado`).send({ estado: 'terminado' });
    expect((await m.api.post(`/colaboradores/${persona.colaboradorId}/estado`).send({ activo: false })).status).toBe(200);
  });

  it('el listado filtra por estado, abiertas y búsqueda (número, placa o cliente)', async () => {
    const m = await mundo(e);
    const a = ordenId(await nueva(m));
    const b = ordenId(await nueva(m));
    await m.api.post(`/ordenes/${b}/estado`).send({ estado_id: m.estados['CERRADA'] });
    const abiertas = (await m.api.get('/ordenes?abiertas=true')).body.data;
    expect(abiertas.registros.map((o: { id: number }) => o.id)).toEqual([a]);
    expect((await m.api.get('/ordenes?abiertas=false')).body.data.registros.map((o: { id: number }) => o.id)).toEqual([b]);
    expect((await m.api.get('/ordenes?buscar=C123ABC')).body.data.total).toBe(2);
    expect((await m.api.get('/ordenes?buscar=REP-000002')).body.data.total).toBe(1);
    expect((await m.api.get('/ordenes?buscar=nadie')).body.data.total).toBe(0);
    expect((await m.api.get(`/ordenes?estado_id=${m.estados['CERRADA']}`)).body.data.total).toBe(1);
    expect(abiertas.registros[0]).toMatchObject({ equipo: expect.stringContaining('CAM-1'), cliente: 'INDUSTRIAS LOPEZ', total: 0 });
  });

  it('el listado se pagina de a 50 sin repetir ni saltar órdenes: las abiertas primero y, dentro de cada grupo, la más nueva primero', async () => {
    const m = await mundo(e);
    const primera = ordenId(await nueva(m));
    // 59 órdenes abiertas más (con la primera, 60), directo en la base (más rápido que crearlas una por una).
    await m.t.sql(async (c) => {
      await c.query(
        `INSERT INTO ordenes (numero, cliente_id, equipo_id, sucursal_id, tipo_orden_id, estado_id, descripcion)
         SELECT CONCAT('PAG-', LPAD(n.k, 4, '0')), cliente_id, equipo_id, sucursal_id, tipo_orden_id, (SELECT id FROM estados_orden WHERE es_inicial = 1 LIMIT 1), 'ORDEN DE PAGINA'
           FROM ordenes o JOIN (SELECT a.n + 10 * b.n AS k FROM (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9) a CROSS JOIN (SELECT 0 AS n UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4 UNION SELECT 5) b) n ON n.k < 59 WHERE o.id = ?`,
        [primera]
      );
    });
    // Y una cerrada que es la MÁS NUEVA: aun así debe salir al final (las abiertas primero).
    const ultima = ordenId(await nueva(m));
    await m.api.post(`/ordenes/${ultima}/estado`).send({ estado_id: m.estados['CERRADA'] });
    const p1 = (await m.api.get('/ordenes?pagina=1')).body.data;
    const p2 = (await m.api.get('/ordenes?pagina=2')).body.data;
    expect(p1.total).toBe(61);
    expect(p1.registros).toHaveLength(50);
    expect(p2.registros).toHaveLength(11);
    const ids = [...p1.registros, ...p2.registros].map((o: { id: number }) => o.id);
    expect(new Set(ids).size).toBe(61); // ninguna repetida ni salteada
    const abiertasPrimero = [...p1.registros, ...p2.registros].map((o: { es_terminal: number }) => o.es_terminal);
    expect(abiertasPrimero).toEqual([...abiertasPrimero].sort((x, y) => x - y)); // todas las abiertas antes que la cerrada
    const soloAbiertas = ids.slice(0, 60);
    expect(soloAbiertas).toEqual([...soloAbiertas].sort((x, y) => y - x)); // la más nueva primero
    expect(ids[60]).toBe(ultima);
    expect((await m.api.get('/ordenes?buscar=PAGINA&pagina=2')).body.data.registros).toHaveLength(9);
  });
});
