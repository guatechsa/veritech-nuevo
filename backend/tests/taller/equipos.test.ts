import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
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

async function admin(t: TallerDePrueba) {
  return t.api(await t.token());
}
type Api = Awaited<ReturnType<typeof admin>>;

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(40, 9)]);

async function tipoId(api: Api, codigo: string): Promise<number> {
  const r = await api.get('/tipos-equipo');
  return (r.body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === codigo)!.id;
}
async function cliente(api: Api, nombre = 'Industrias Lopez'): Promise<number> {
  const r = await api.post('/clientes').send({ nombre });
  expect(r.status).toBe(201);
  return r.body.data.cliente.id;
}
const nuevo = (api: Api, cuerpo: Record<string, unknown>) => api.post('/equipos').send(cuerpo);
const subirFoto = (api: Api, equipoId: number, buffer: Buffer = PNG, mime = 'image/png') =>
  api.post(`/equipos/${equipoId}/fotos`).set('Content-Type', mime).set('X-Nombre-Archivo', encodeURIComponent('Fotó frente.png')).send(buffer);

describe('tipos de equipo', () => {
  it('nacen tres de fábrica; el código no cambia; no se desactiva uno con equipos', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const lista = (await api.get('/tipos-equipo')).body.data as Array<{ codigo: string; es_vehiculo: number; usa_combustible: number }>;
    expect(lista.map((x) => x.codigo).sort()).toEqual(['EQUIPO', 'MAQUINARIA', 'VEHICULO']);
    expect(lista.find((x) => x.codigo === 'VEHICULO')).toMatchObject({ es_vehiculo: 1, usa_combustible: 1 });

    const creado = await api.post('/tipos-equipo').send({ codigo: 'montacargas', nombre: 'Montacargas', usa_combustible: true, tarifa_venta_hora: 150, costo_hora: 60 });
    expect(creado.status).toBe(201);
    expect(creado.body.data).toMatchObject({ codigo: 'MONTACARGAS', nombre: 'MONTACARGAS', tarifa_venta_hora: 150, costo_hora: 60 });
    expect((await api.post('/tipos-equipo').send({ codigo: 'MONTACARGAS', nombre: 'Otro' })).status).toBe(409);
    expect((await api.post('/tipos-equipo').send({ codigo: '1ab', nombre: 'Malo' })).status).toBe(400);
    expect((await api.patch(`/tipos-equipo/${creado.body.data.id}`).send({ codigo: 'OTRO' })).status).toBe(409);

    const cli = await cliente(api);
    expect((await nuevo(api, { tipo_equipo_id: creado.body.data.id, cliente_id: cli })).status).toBe(201);
    const desactivar = await api.patch(`/tipos-equipo/${creado.body.data.id}`).send({ activo: false });
    expect(desactivar.status).toBe(409);
    expect(desactivar.body.codigo).toBe('EN_USO');
  });

  it('documentos requeridos y plantilla de componentes (solo si el tipo tiene componentes)', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const veh = await tipoId(api, 'VEHICULO');
    const docs = (await api.get('/tipos-documento')).body.data as Array<{ id: number; nombre: string }>;
    const seguro = docs.find((d) => d.nombre === 'SEGURO')!.id;
    const r = await api.put(`/tipos-equipo/${veh}/documentos`).send({ documentos: [{ tipo_documento_id: seguro, obligatorio: true }] });
    expect(r.status).toBe(200);
    expect(r.body.data.documentos).toHaveLength(1);
    expect((await api.put(`/tipos-equipo/${veh}/documentos`).send({ documentos: [{ tipo_documento_id: seguro, obligatorio: true }, { tipo_documento_id: seguro, obligatorio: false }] })).status).toBe(400);
    expect((await api.put(`/tipos-equipo/${veh}/documentos`).send({ documentos: [{ tipo_documento_id: 99999, obligatorio: true }] })).status).toBe(400);

    const sinComp = await api.put(`/tipos-equipo/${veh}/componentes`).send({ componentes: [{ nombre: 'Motor' }] });
    expect(sinComp.status).toBe(409);
    const cosechadora = (await api.post('/tipos-equipo').send({ codigo: 'COSECHADORA', nombre: 'Cosechadora', tiene_componentes: true })).body.data.id;
    const contadores = (await api.get('/tipos-contador')).body.data as Array<{ id: number; nombre: string }>;
    const horometro = contadores.find((c) => c.nombre === 'HOROMETRO')!.id;
    const conComp = await api.put(`/tipos-equipo/${cosechadora}/componentes`).send({ componentes: [{ nombre: 'Motor', tipo_contador_id: horometro }, { nombre: 'Trilla' }] });
    expect(conComp.status).toBe(200);
    expect(conComp.body.data.componentes.map((c: { nombre: string }) => c.nombre)).toEqual(['MOTOR', 'TRILLA']);
  });

  it('horas por trabajo y tipo de equipo: se guardan, se cambian y se quitan', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const veh = await tipoId(api, 'VEHICULO');
    const maq = await tipoId(api, 'MAQUINARIA');
    const sis = (await api.post('/catalogos/sistemas').send({ nombre: 'Motor' })).body.data.id;
    const sub = (await api.post('/catalogos/subsistemas').send({ sistema_id: sis, nombre: 'Lubricacion' })).body.data.id;
    const parte = (await api.post('/catalogos/partes').send({ subsistema_id: sub, nombre: 'Filtro de aceite' })).body.data.id;
    const accion = ((await api.get('/catalogos/acciones')).body.data as Array<{ id: number }>)[0]!.id;
    const trabajo = (await api.post('/catalogos/trabajos').send({ parte_id: parte, accion_id: accion })).body.data.id;
    const r = await api.put(`/catalogos/trabajos/${trabajo}/horas`).send({ horas: [{ tipo_equipo_id: veh, horas: 1.5 }, { tipo_equipo_id: maq, horas: 3 }] });
    expect(r.status).toBe(200);
    const fila = (id: number) => (r.body.data as Array<{ tipo_equipo_id: number; horas: number | null }>).find((x) => x.tipo_equipo_id === id);
    expect(fila(veh)?.horas).toBe(1.5);
    const r2 = await api.put(`/catalogos/trabajos/${trabajo}/horas`).send({ horas: [{ tipo_equipo_id: maq, horas: null }, { tipo_equipo_id: veh, horas: 2 }] });
    expect((r2.body.data as Array<{ tipo_equipo_id: number; horas: string | null }>).find((x) => x.tipo_equipo_id === maq)?.horas).toBeNull();
    expect((await api.put(`/catalogos/trabajos/${trabajo}/horas`).send({ horas: [{ tipo_equipo_id: veh, horas: -1 }] })).status).toBe(400);
    expect((await api.put(`/catalogos/trabajos/99999/horas`).send({ horas: [] })).status).toBe(404);
  });

  it('las marcas pueden ser de un tipo de equipo, y un equipo no acepta la marca de otro tipo', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const veh = await tipoId(api, 'VEHICULO');
    const maq = await tipoId(api, 'MAQUINARIA');
    const marca = await api.post('/catalogos/marcas').send({ nombre: 'Toyota', tipo_equipo_id: veh });
    expect(marca.status).toBe(201);
    expect(marca.body.data.tipo_equipo_id).toBe(veh);
    expect((await api.post('/catalogos/marcas').send({ nombre: 'Rara', tipo_equipo_id: 99999 })).status).toBe(400);
    const general = (await api.post('/catalogos/marcas').send({ nombre: 'General' })).body.data;
    expect(general.tipo_equipo_id).toBeNull();
    const cli = await cliente(api);
    expect((await nuevo(api, { tipo_equipo_id: maq, cliente_id: cli, marca_id: marca.body.data.id })).status).toBe(400);
    expect((await nuevo(api, { tipo_equipo_id: maq, cliente_id: cli, marca_id: general.id })).status).toBe(201);
    expect((await nuevo(api, { tipo_equipo_id: veh, cliente_id: cli, marca_id: marca.body.data.id })).status).toBe(201);
  });
});

describe('equipos: datos y reglas', () => {
  it('crea con el texto normalizado, código público al azar y la ficha completa', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const veh = await tipoId(api, 'VEHICULO');
    const r = await nuevo(api, { tipo_equipo_id: veh, cliente_id: cli, codigo_interno: 'cam 01', placa: 'p-123 abc', serie: 'abc123xyz', modelo: 'Hilux Ñ', anio: 2020, color: 'Blanco', combustible: 'Diésel', capacidad_tanque: 80 });
    expect(r.status).toBe(201);
    const eq = r.body.data.equipo;
    expect(eq).toMatchObject({ codigo_interno: 'CAM01', placa: 'P-123ABC', serie: 'ABC123XYZ', modelo: 'HILUX N', color: 'BLANCO', combustible: 'DIESEL', propiedad: 'cliente', estado: 'activo', cliente: 'INDUSTRIAS LOPEZ', tipo_equipo: 'VEHICULO' });
    expect(eq.codigo_publico).toMatch(/^[a-f0-9]{16}$/);
    expect(eq.descripcion).toContain('CAM01');
    const otro = await nuevo(api, { tipo_equipo_id: veh, cliente_id: cli });
    expect(otro.body.data.equipo.codigo_publico).not.toBe(eq.codigo_publico);
    expect(otro.body.data.equipo.id).not.toBe(eq.id);
  });

  it('la placa solo la llevan los vehículos y el combustible solo quien lo usa', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const general = await tipoId(api, 'EQUIPO');
    const maq = await tipoId(api, 'MAQUINARIA');
    const conPlaca = await nuevo(api, { tipo_equipo_id: general, cliente_id: cli, placa: 'P-1' });
    expect(conPlaca.status).toBe(400);
    expect(conPlaca.body.error).toContain('placa');
    const conCombustible = await nuevo(api, { tipo_equipo_id: general, cliente_id: cli, combustible: 'Diesel' });
    expect(conCombustible.status).toBe(400);
    expect((await nuevo(api, { tipo_equipo_id: maq, cliente_id: cli, combustible: 'Diesel', capacidad_tanque: 200 })).status).toBe(201);
    expect((await nuevo(api, { tipo_equipo_id: general, cliente_id: cli, anio: 1800 })).status).toBe(400);
  });

  it('la serie es única; el código interno es único por cliente (otro cliente puede repetirlo); la placa repetida solo avisa', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = await cliente(api, 'Cliente A');
    const b = await cliente(api, 'Cliente B');
    const veh = await tipoId(api, 'VEHICULO');
    const primero = await nuevo(api, { tipo_equipo_id: veh, cliente_id: a, codigo_interno: 'C-1', serie: 'S1', placa: 'P-100' });
    expect(primero.body.data.avisos).toEqual([]);
    const serie = await nuevo(api, { tipo_equipo_id: veh, cliente_id: b, serie: 's1' });
    expect(serie.status).toBe(409);
    expect(serie.body.codigo).toBe('SERIE_REPETIDA');
    const codigo = await nuevo(api, { tipo_equipo_id: veh, cliente_id: a, codigo_interno: 'c-1' });
    expect(codigo.status).toBe(409);
    expect(codigo.body.codigo).toBe('CODIGO_REPETIDO');
    expect((await nuevo(api, { tipo_equipo_id: veh, cliente_id: b, codigo_interno: 'C-1' })).status).toBe(201);
    const placa = await nuevo(api, { tipo_equipo_id: veh, cliente_id: b, placa: 'p-100' });
    expect(placa.status).toBe(201);
    expect(placa.body.data.avisos).toHaveLength(1);
    expect(placa.body.data.avisos[0]).toMatchObject({ campo: 'placa', equipo: { id: primero.body.data.equipo.id } });
    // Varios equipos sin código ni serie conviven.
    expect((await nuevo(api, { tipo_equipo_id: veh, cliente_id: a })).status).toBe(201);
    expect((await nuevo(api, { tipo_equipo_id: veh, cliente_id: a })).status).toBe(201);
  });

  it('dueño: de cliente exige cliente; propio del taller no lleva cliente; departamento solo del mismo cliente', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = await cliente(api, 'Cliente A');
    const b = await cliente(api, 'Cliente B');
    const maq = await tipoId(api, 'MAQUINARIA');
    expect((await nuevo(api, { tipo_equipo_id: maq })).status).toBe(400);
    expect((await nuevo(api, { tipo_equipo_id: maq, cliente_id: 99999 })).status).toBe(400);
    const propio = await nuevo(api, { tipo_equipo_id: maq, propiedad: 'propio', cliente_id: a });
    expect(propio.status).toBe(201);
    expect(propio.body.data.equipo.cliente_id).toBeNull(); // un equipo propio no se queda atado a un cliente
    const depA = (await api.post(`/clientes/${a}/departamentos`).send({ nombre: 'Produccion' })).body.data.id;
    expect((await nuevo(api, { tipo_equipo_id: maq, cliente_id: b, departamento_id: depA })).status).toBe(400);
    const ok = await nuevo(api, { tipo_equipo_id: maq, cliente_id: a, departamento_id: depA });
    expect(ok.status).toBe(201);
    expect(ok.body.data.equipo.departamento).toBe('PRODUCCION');
  });

  it('al editar: revisa las mismas reglas, cambia de dueño sin dejar contactos del anterior y devuelve avisos', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = await cliente(api, 'Cliente A');
    const b = await cliente(api, 'Cliente B');
    const veh = await tipoId(api, 'VEHICULO');
    const general = await tipoId(api, 'EQUIPO');
    const contactoA = (await api.post(`/clientes/${a}/contactos`).send({ nombre: 'Piloto Uno', rol: 'piloto' })).body.data.contactos?.[0]?.id;
    const eq = (await nuevo(api, { tipo_equipo_id: veh, cliente_id: a, placa: 'P-5' })).body.data.equipo;
    if (contactoA) expect((await api.put(`/equipos/${eq.id}/contactos`).send({ contactos: [contactoA] })).status).toBe(200);
    // Pasar a un tipo que no es vehículo con placa puesta no se permite.
    expect((await api.patch(`/equipos/${eq.id}`).send({ tipo_equipo_id: general })).status).toBe(400);
    const cambio = await api.patch(`/equipos/${eq.id}`).send({ cliente_id: b, modelo: 'nuevo' });
    expect(cambio.status).toBe(200);
    expect(cambio.body.data.equipo).toMatchObject({ cliente: 'CLIENTE B', modelo: 'NUEVO' });
    expect(cambio.body.data.equipo.contactos).toEqual([]);
    expect((await api.patch(`/equipos/${eq.id}`).send({ anio: 1700 })).status).toBe(400);
    expect((await api.patch('/equipos/99999').send({ modelo: 'x' })).status).toBe(404);
  });

  it('con componentes: copia la plantilla del tipo y le crea su contador a cada uno', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const cosechadora = (await api.post('/tipos-equipo').send({ codigo: 'COSECHADORA', nombre: 'Cosechadora', tiene_componentes: true })).body.data.id;
    const horometro = ((await api.get('/tipos-contador')).body.data as Array<{ id: number; nombre: string }>).find((c) => c.nombre === 'HOROMETRO')!.id;
    await api.put(`/tipos-equipo/${cosechadora}/componentes`).send({ componentes: [{ nombre: 'Motor', tipo_contador_id: horometro }, { nombre: 'Trilla', tipo_contador_id: horometro }] });
    const r = await nuevo(api, { tipo_equipo_id: cosechadora, cliente_id: cli });
    const eq = r.body.data.equipo;
    expect(eq.componentes.map((c: { nombre: string }) => c.nombre)).toEqual(['MOTOR', 'TRILLA']);
    expect(eq.contadores).toHaveLength(2);
    expect(eq.contadores.every((c: { es_principal: boolean; componente_id: number }) => c.es_principal && c.componente_id > 0)).toBe(true);
    // Cambiar la plantilla después no toca los equipos que ya existen.
    await api.put(`/tipos-equipo/${cosechadora}/componentes`).send({ componentes: [{ nombre: 'Banda' }] });
    expect((await api.get(`/equipos/${eq.id}`)).body.data.componentes).toHaveLength(2);
    // Componentes a mano: no repetidos, y solo en tipos que los manejan.
    expect((await api.post(`/equipos/${eq.id}/componentes`).send({ nombre: 'motor' })).status).toBe(409);
    expect((await api.post(`/equipos/${eq.id}/componentes`).send({ nombre: 'Cortador' })).status).toBe(201);
    const veh = (await nuevo(api, { tipo_equipo_id: await tipoId(api, 'VEHICULO'), cliente_id: cli })).body.data.equipo;
    expect((await api.post(`/equipos/${veh.id}/componentes`).send({ nombre: 'Motor' })).status).toBe(409);
  });

  it('lista y busca por código, placa, serie, modelo, marca o cliente; la baja no sale salvo que se pida', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = await cliente(api, 'Agroindustria Sur');
    const b = await cliente(api, 'Bodegas Norte');
    const veh = await tipoId(api, 'VEHICULO');
    const x = (await nuevo(api, { tipo_equipo_id: veh, cliente_id: a, codigo_interno: 'CAM-77', placa: 'P-777' })).body.data.equipo;
    await nuevo(api, { tipo_equipo_id: veh, cliente_id: b, serie: 'ZZZ999' });
    expect((await api.get('/equipos?buscar=cam-77')).body.data.registros.map((r: { id: number }) => r.id)).toEqual([x.id]);
    expect((await api.get('/equipos?buscar=P-777')).body.data.total).toBe(1);
    expect((await api.get('/equipos?buscar=zzz')).body.data.total).toBe(1);
    expect((await api.get('/equipos?buscar=agroindustria')).body.data.total).toBe(1);
    expect((await api.get(`/equipos?cliente_id=${b}`)).body.data.total).toBe(1);
    expect((await api.get('/equipos?buscar=%25')).body.data.total).toBe(0); // el comodín no es comodín
    await api.post(`/equipos/${x.id}/estado`).send({ estado: 'baja', motivo: 'vendido' });
    expect((await api.get('/equipos')).body.data.total).toBe(1);
    expect((await api.get('/equipos?estado=baja')).body.data.total).toBe(1);
  });
});

describe('equipos: estado, permisos y bitácora', () => {
  it('la baja pide motivo, deja rastro y congela el equipo; se puede reactivar', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const eq = (await nuevo(api, { tipo_equipo_id: await tipoId(api, 'MAQUINARIA'), cliente_id: cli })).body.data.equipo;
    expect((await api.post(`/equipos/${eq.id}/estado`).send({ estado: 'baja' })).status).toBe(400);
    expect((await api.post(`/equipos/${eq.id}/estado`).send({ estado: 'fuera_de_servicio' })).body.data.estado).toBe('fuera_de_servicio');
    const baja = await api.post(`/equipos/${eq.id}/estado`).send({ estado: 'baja', motivo: 'Vendido a otro taller' });
    expect(baja.body.data.estado).toBe('baja');
    expect((await api.patch(`/equipos/${eq.id}`).send({ modelo: 'x' })).status).toBe(409);
    expect((await api.post(`/equipos/${eq.id}/notas`).send({ nota: 'hola' })).status).toBe(409);
    expect((await api.post(`/equipos/${eq.id}/estado`).send({ estado: 'activo' })).body.data.estado).toBe('activo');
    const b = await t.sql(async (con) => {
      const [rows] = await con.query('SELECT accion, motivo FROM bitacora WHERE entidad = ? AND entidad_id = ? ORDER BY id', ['equipos', eq.id]);
      return rows as Array<{ accion: string; motivo: string | null }>;
    });
    expect(b.map((x) => x.accion)).toEqual(['equipo_creado', 'equipo_estado', 'equipo_estado', 'equipo_estado']);
    expect(b[2]?.motivo).toBe('VENDIDO A OTRO TALLER');
  });

  it('cada rol hace solo lo suyo: el operador ve y no crea; el supervisor crea y no da de baja', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const veh = await tipoId(api, 'VEHICULO');
    const eq = (await nuevo(api, { tipo_equipo_id: veh, cliente_id: cli })).body.data.equipo;
    const operador = t.api(await (await t.usuario('operador')).token());
    expect((await operador.get('/equipos')).status).toBe(200);
    expect((await operador.get(`/equipos/${eq.id}`)).status).toBe(200);
    expect((await nuevo(operador, { tipo_equipo_id: veh, cliente_id: cli })).status).toBe(403);
    expect((await operador.patch(`/equipos/${eq.id}`).send({ modelo: 'x' })).status).toBe(403);
    expect((await operador.post('/tipos-equipo').send({ codigo: 'ZZ', nombre: 'Zeta' })).status).toBe(403);
    const sup = t.api(await (await t.usuario('supervisor')).token());
    expect((await nuevo(sup, { tipo_equipo_id: veh, cliente_id: cli })).status).toBe(201);
    expect((await sup.post(`/equipos/${eq.id}/estado`).send({ estado: 'baja', motivo: 'x y z' })).status).toBe(403);
    expect((await t.api().get('/equipos')).status).toBe(401);
  });

  it('un taller no ve los equipos de otro', async () => {
    const t1 = await tallerDePrueba(e);
    const t2 = await tallerDePrueba(e);
    const a1 = await admin(t1);
    const a2 = await admin(t2);
    const cli = await cliente(a1);
    const eq = (await nuevo(a1, { tipo_equipo_id: await tipoId(a1, 'VEHICULO'), cliente_id: cli })).body.data.equipo;
    expect((await a2.get('/equipos')).body.data.total).toBe(0);
    expect((await a2.get(`/equipos/${eq.id}`)).status).toBe(404);
    expect((await a2.patch(`/equipos/${eq.id}`).send({ modelo: 'x' })).status).toBe(404);
  });

  it('un cliente con equipos ya no se puede eliminar (se desactiva)', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    await nuevo(api, { tipo_equipo_id: await tipoId(api, 'VEHICULO'), cliente_id: cli });
    const r = await api.delete(`/clientes/${cli}`);
    expect(r.status).toBe(409);
    expect((await api.get(`/clientes/${cli}`)).body.data.historia.equipos).toBe(1);
  });
});

describe('equipos: fotos, documentos, notas y operadores', () => {
  it('foto: se valida lo que de verdad es, se entrega con dirección firmada que vence y no sirve en otro taller', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const eq = (await nuevo(api, { tipo_equipo_id: await tipoId(api, 'VEHICULO'), cliente_id: cli })).body.data.equipo;
    // Un texto que dice ser PNG se rechaza; un ejecutable también; vacío también.
    expect((await subirFoto(api, eq.id, Buffer.from('esto no es una imagen, solo texto largo'))).status).toBe(400);
    expect((await subirFoto(api, eq.id, Buffer.from('MZ-ejecutable-falso-largo'), 'application/x-msdownload')).status).toBe(400);
    expect((await subirFoto(api, eq.id, PDF)).status).toBe(400); // un PDF no es foto
    const ok = await subirFoto(api, eq.id);
    expect(ok.status).toBe(201);
    const foto = ok.body.data.fotos[0];
    expect(foto.es_principal).toBe(true);
    expect(foto.url).toMatch(/^\/api\/archivos\/[a-z0-9-]+\/\d+\?e=\d+&f=[a-f0-9]{64}$/);
    const bajada = await request(e.app).get(foto.url).buffer(true).parse((res, cb) => {
      const trozos: Buffer[] = [];
      res.on('data', (c: Buffer) => trozos.push(c));
      res.on('end', () => cb(null, Buffer.concat(trozos)));
    });
    expect(bajada.status).toBe(200);
    expect(bajada.headers['content-type']).toContain('image/png');
    expect(bajada.headers['content-disposition']).toContain("filename*=UTF-8''Fot%C3%B3%20frente.png");
    expect((bajada.body as Buffer).equals(PNG)).toBe(true);
    // Sin firma, con firma cambiada, o con otro número: no existe.
    const [ruta, consulta] = foto.url.split('?') as [string, string];
    expect((await request(e.app).get(ruta)).status).toBe(404);
    expect((await request(e.app).get(`${ruta}?${consulta.replace(/f=(.)/, (_t, c: string) => `f=${c === '0' ? '1' : '0'}`)}`)).status).toBe(404);
    expect((await request(e.app).get(ruta.replace(/\/\d+$/, '/999') + '?' + consulta)).status).toBe(404);
    // La dirección de un taller no sirve con el nombre de otro.
    const otro = await tallerDePrueba(e);
    expect((await request(e.app).get(foto.url.replace(`/archivos/${t.slug}/`, `/archivos/${otro.slug}/`))).status).toBe(404);
    // Pasada la hora, vence.
    e.reloj.fijo = new Date(Date.now() + 61 * 60 * 1000);
    expect((await request(e.app).get(foto.url)).status).toBe(404);
  });

  it('el archivo queda en la carpeta del taller con nombre al azar, y al quitar la foto se borra del disco', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const eq = (await nuevo(api, { tipo_equipo_id: await tipoId(api, 'VEHICULO'), cliente_id: cli })).body.data.equipo;
    const subida = await subirFoto(api, eq.id);
    expect(subida.status).toBe(201);
    const fila = await t.sql(async (con) => {
      const [rows] = await con.query('SELECT ruta, nombre_original, tipo_mime, tamano, hash FROM archivos');
      return (rows as Array<{ ruta: string; nombre_original: string; tipo_mime: string; tamano: number; hash: string }>)[0]!;
    });
    expect(fila).toMatchObject({ nombre_original: 'Fotó frente.png', tipo_mime: 'image/png', tamano: PNG.length });
    expect(fila.hash).toHaveLength(64);
    expect(fila.ruta).toMatch(/^\d{4}\/[a-f0-9]{24}\.png$/);
    const completa = path.join(e.entorno.ARCHIVOS_DIR as string, t.nombreBd, fila.ruta);
    expect(fs.existsSync(completa)).toBe(true);
    const fotoId = subida.body.data.fotos[0].id;
    expect((await api.delete(`/equipos/${eq.id}/fotos/${fotoId}`)).status).toBe(200);
    expect(fs.existsSync(completa)).toBe(false);
    expect(await t.sql(async (con) => ((await con.query('SELECT COUNT(*) AS n FROM archivos'))[0] as Array<{ n: number }>)[0]!.n)).toBe(0);
  });

  it('más de 10 MB se rechaza; la primera foto es la principal y se puede cambiar', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const eq = (await nuevo(api, { tipo_equipo_id: await tipoId(api, 'VEHICULO'), cliente_id: cli })).body.data.equipo;
    const enorme = Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024 + 10, 1)]);
    expect((await subirFoto(api, eq.id, enorme)).status).toBe(413);
    await subirFoto(api, eq.id);
    const segunda = await subirFoto(api, eq.id);
    const fotos = segunda.body.data.fotos as Array<{ id: number; es_principal: boolean }>;
    expect(fotos).toHaveLength(2);
    expect(fotos.filter((f) => f.es_principal)).toHaveLength(1);
    const otra = fotos.find((f) => !f.es_principal)!;
    const cambio = await api.post(`/equipos/${eq.id}/fotos/${otra.id}/principal`);
    expect((cambio.body.data.fotos as Array<{ id: number; es_principal: boolean }>).find((f) => f.id === otra.id)?.es_principal).toBe(true);
    // Quitar la principal deja otra como principal.
    const sin = await api.delete(`/equipos/${eq.id}/fotos/${otra.id}`);
    expect(sin.body.data.fotos).toHaveLength(1);
    expect(sin.body.data.fotos[0].es_principal).toBe(true);
  });

  it('documentos: el que vence necesita fecha; se ve vigente / por vencer / vencido; lo que falta se avisa; uno nuevo reemplaza al anterior', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const veh = await tipoId(api, 'VEHICULO');
    const tipos = (await api.get('/tipos-documento')).body.data as Array<{ id: number; nombre: string }>;
    const seguro = tipos.find((d) => d.nombre === 'SEGURO')!.id;
    const manual = tipos.find((d) => d.nombre === 'MANUAL DE OPERACION')!.id;
    await api.put(`/tipos-equipo/${veh}/documentos`).send({ documentos: [{ tipo_documento_id: seguro, obligatorio: true }, { tipo_documento_id: manual, obligatorio: false }] });
    const eq = (await nuevo(api, { tipo_equipo_id: veh, cliente_id: cli })).body.data.equipo;
    expect(eq.documentos_faltantes.map((x: { nombre: string }) => x.nombre).sort()).toEqual(['MANUAL DE OPERACION', 'SEGURO']);
    expect((await api.post(`/equipos/${eq.id}/documentos`).send({ tipo_documento_id: seguro })).status).toBe(400); // falta el vencimiento
    const dia = (n: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date(Date.now() + n * 86400000));
    const hoy = dia(0);
    expect((await api.post(`/equipos/${eq.id}/documentos`).send({ tipo_documento_id: seguro, vence: '2020-02-31' })).status).toBe(400);
    const vencido = await api.post(`/equipos/${eq.id}/documentos`).send({ tipo_documento_id: seguro, vence: dia(-3) });
    expect(vencido.status).toBe(201);
    expect(vencido.body.data.documentos[0].estado).toBe('vencido');
    expect(vencido.body.data.documentos_faltantes.map((x: { nombre: string }) => x.nombre)).toContain('SEGURO'); // uno vencido no cuenta
    const porVencer = await api.post(`/equipos/${eq.id}/documentos`).send({ tipo_documento_id: seguro, vence: dia(10) });
    expect(porVencer.body.data.documentos).toHaveLength(1); // reemplazó al vencido
    expect(porVencer.body.data.documentos[0].estado).toBe('por_vencer');
    expect(porVencer.body.data.documentos_faltantes.map((x: { nombre: string }) => x.nombre)).toEqual(['MANUAL DE OPERACION']);
    const vigente = await api.post(`/equipos/${eq.id}/documentos`).send({ tipo_documento_id: seguro, vence: dia(200), nombre: 'poliza 2026' });
    expect(vigente.body.data.documentos[0]).toMatchObject({ estado: 'vigente', nombre: 'POLIZA 2026' });
    void hoy;
    // Con archivo PDF adjunto.
    const conPdf = await api
      .post(`/equipos/${eq.id}/documentos?tipo_documento_id=${manual}`)
      .set('Content-Type', 'application/pdf')
      .set('X-Nombre-Archivo', encodeURIComponent('Manual.pdf'))
      .send(PDF);
    expect(conPdf.status).toBe(201);
    const docManual = (conPdf.body.data.documentos as Array<{ tipo: string; estado: string; url: string | null }>).find((d) => d.tipo === 'MANUAL DE OPERACION')!;
    expect(docManual.estado).toBe('sin_vencimiento');
    expect(docManual.url).toContain('/api/archivos/');
    expect(conPdf.body.data.documentos_faltantes).toEqual([]);
    // Quitar un documento lo saca de la ficha.
    const doc = (conPdf.body.data.documentos as Array<{ id: number; tipo: string }>).find((d) => d.tipo === 'MANUAL DE OPERACION')!;
    expect((await api.delete(`/equipos/${eq.id}/documentos/${doc.id}`)).body.data.documentos).toHaveLength(1);
    expect((await api.delete(`/equipos/${eq.id}/documentos/${doc.id}`)).status).toBe(404);
  });

  it('notas: las importantes van primero y guardan quién las escribió', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const eq = (await nuevo(api, { tipo_equipo_id: await tipoId(api, 'MAQUINARIA'), cliente_id: cli })).body.data.equipo;
    await api.post(`/equipos/${eq.id}/notas`).send({ nota: 'cambio de turbo\nen marzo' });
    const r = await api.post(`/equipos/${eq.id}/notas`).send({ nota: 'No usar sin casco', es_importante: true });
    expect(r.body.data.anotaciones[0]).toMatchObject({ nota: 'NO USAR SIN CASCO', es_importante: 1 });
    expect(r.body.data.anotaciones[1].nota).toBe('CAMBIO DE TURBO\nEN MARZO');
    expect(r.body.data.anotaciones[0].autor).toBeTruthy();
    expect((await api.post(`/equipos/${eq.id}/notas`).send({ nota: '   ' })).status).toBe(400);
  });

  it('operadores: solo colaboradores con puesto de operador, sin repetir; quitarlos deja la fecha', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = await cliente(api);
    const eq = (await nuevo(api, { tipo_equipo_id: await tipoId(api, 'MAQUINARIA'), cliente_id: cli })).body.data.equipo;
    const persona = await t.usuario('tecnico');
    expect((await api.post(`/equipos/${eq.id}/operadores`).send({ colaborador_id: persona.colaboradorId })).status).toBe(409); // sin puesto de operador
    expect(((await api.get('/equipos/operadores-disponibles')).body.data as Array<{ id: number }>).map((c) => c.id)).not.toContain(persona.colaboradorId);
    await t.sql(async (con) => {
      await con.query('INSERT INTO colaborador_puestos (colaborador_id, puesto_id) SELECT ?, id FROM puestos WHERE es_operador = 1 LIMIT 1', [persona.colaboradorId]);
    });
    expect(((await api.get('/equipos/operadores-disponibles')).body.data as Array<{ id: number }>).map((c) => c.id)).toContain(persona.colaboradorId);
    const ok = await api.post(`/equipos/${eq.id}/operadores`).send({ colaborador_id: persona.colaboradorId });
    expect(ok.status).toBe(201);
    expect(ok.body.data.operadores[0]).toMatchObject({ colaborador_id: persona.colaboradorId, activo: 1, hasta: null });
    expect((await api.post(`/equipos/${eq.id}/operadores`).send({ colaborador_id: persona.colaboradorId })).status).toBe(409);
    expect((await api.post(`/equipos/${eq.id}/operadores`).send({ colaborador_id: 99999 })).status).toBe(400);
    const asignacion = ok.body.data.operadores[0].id;
    const fuera = await api.delete(`/equipos/${eq.id}/operadores/${asignacion}`);
    expect(fuera.body.data.operadores[0]).toMatchObject({ activo: 0 });
    expect(fuera.body.data.operadores[0].hasta).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect((await api.delete(`/equipos/${eq.id}/operadores/${asignacion}`)).status).toBe(404);
  });

  it('contactos del equipo: solo contactos activos del mismo cliente', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = await cliente(api, 'Cliente A');
    const b = await cliente(api, 'Cliente B');
    const contactoA = (await api.post(`/clientes/${a}/contactos`).send({ nombre: 'Ana' })).body.data;
    const contactoB = (await api.post(`/clientes/${b}/contactos`).send({ nombre: 'Beto' })).body.data;
    const idA = (contactoA.contactos ?? [contactoA]).find((c: { nombre: string }) => c.nombre === 'ANA').id;
    const idB = (contactoB.contactos ?? [contactoB]).find((c: { nombre: string }) => c.nombre === 'BETO').id;
    const eq = (await nuevo(api, { tipo_equipo_id: await tipoId(api, 'MAQUINARIA'), cliente_id: a })).body.data.equipo;
    expect((await api.put(`/equipos/${eq.id}/contactos`).send({ contactos: [idB] })).status).toBe(400);
    const ok = await api.put(`/equipos/${eq.id}/contactos`).send({ contactos: [idA] });
    expect(ok.body.data.contactos).toEqual([{ contacto_id: idA, nombre: 'ANA' }]);
  });
});
