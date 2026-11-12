import { ExcelJS } from '../../src/taller/datos/libro';
import { ejecutar } from '../../src/db/consulta';
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

const TIPO_EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Arma un libro como el que llenaría una persona: encabezados en la fila 1 de la hoja «Datos» y una fila por registro. */
async function libro(encabezados: string[], filas: Array<Array<string | number | Date | null>>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const hoja = wb.addWorksheet('Datos');
  hoja.addRow(encabezados);
  for (const f of filas) hoja.addRow(f);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cargar = (api: Api, tipo: string, buffer: Buffer, opciones: { simular?: boolean; crearMarcas?: boolean } = {}) =>
  api
    .post(`/importar/${tipo}?simular=${opciones.simular === false ? 'false' : 'true'}&crear_marcas=${opciones.crearMarcas ? 'true' : 'false'}`)
    .set('Content-Type', TIPO_EXCEL)
    .send(buffer);

const binario = (r: import('superagent').Response, cb: (err: Error | null, cuerpo: Buffer) => void): void => {
  const partes: Buffer[] = [];
  r.on('data', (p: Buffer) => partes.push(p));
  r.on('end', () => cb(null, Buffer.concat(partes)));
};

async function leerLibro(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return wb;
}
const textos = (hoja: ExcelJS.Worksheet): string[][] => {
  const filas: string[][] = [];
  hoja.eachRow((f) => filas.push(Array.from((f.values as unknown[]).slice(1), (v) => (v === null || v === undefined ? '' : String(v)))));
  return filas;
};

async function cuenta(t: TallerDePrueba, tabla: string): Promise<number> {
  const r = await t.sql(async (c) => (await c.query(`SELECT COUNT(*) AS n FROM ${tabla}`))[0] as Array<{ n: number }>);
  return Number(r[0]!.n);
}

const ENC_CLIENTES = ['NOMBRE', 'NIT', 'TELEFONO', 'CORREO', 'CONDICION DE PAGO', 'DIAS DE CREDITO'];
const ENC_EQUIPOS = ['CLIENTE', 'TIPO DE EQUIPO', 'CODIGO INTERNO', 'PLACA', 'SERIE', 'MARCA', 'MODELO', 'AÑO', 'TIPO DE CONTADOR', 'LECTURA ACTUAL', 'FECHA DE LECTURA'];
const ENC_LECTURAS = ['EQUIPO', 'CLIENTE', 'TIPO DE CONTADOR', 'LECTURA', 'FECHA'];

describe('descargar los datos del taller', () => {
  it('el libro trae lo que se cargó, en español, y NUNCA contraseñas ni sesiones', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = (await api.post('/clientes').send({ nombre: 'Industrias Lopez', nit: '1234567K', telefono: '2222-3333' })).body.data.cliente.id as number;
    const tipos = (await api.get('/tipos-equipo')).body.data as Array<{ id: number; codigo: string }>;
    const vehiculo = tipos.find((x) => x.codigo === 'VEHICULO')!.id;
    const contadores = (await api.get('/tipos-contador')).body.data as Array<{ id: number; nombre: string }>;
    const odo = contadores.find((x) => x.nombre === 'ODOMETRO')!.id;
    const eq = await api.post('/equipos').send({ tipo_equipo_id: vehiculo, cliente_id: cli, codigo_interno: 'cam-1', placa: 'c123abc', contadores: [{ tipo_contador_id: odo, valor_inicial: 1000, fecha_inicio: '2026-01-10' }] });
    expect(eq.status).toBe(201);

    const r = await api.get('/exportar/datos').buffer(true).parse(binario);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    expect(r.headers['content-disposition']).toContain(`datos-${t.slug}-`);
    const wb = await leerLibro(r.body as Buffer);
    const nombres = wb.worksheets.map((h) => h.name);
    for (const esperado of ['Leeme', 'Clientes', 'Equipos', 'Contadores', 'Lecturas de contadores', 'Colaboradores', 'Tipos de equipo']) expect(nombres).toContain(esperado);
    expect(nombres.some((n) => /usuario|sesion|token|recuper/i.test(n))).toBe(false);

    const clientes = textos(wb.getWorksheet('Clientes')!);
    expect(clientes[0]).toContain('Nombre');
    expect(clientes[1]).toContain('INDUSTRIAS LOPEZ');
    expect(clientes[1]).toContain('1234567K');
    const equipos = textos(wb.getWorksheet('Equipos')!);
    expect(equipos[0]).toEqual(expect.arrayContaining(['Cliente', 'Placa', 'Tipo de equipo']));
    expect(equipos[1]).toEqual(expect.arrayContaining(['INDUSTRIAS LOPEZ', 'C123ABC', 'VEHICULO']));
    const lecturas = textos(wb.getWorksheet('Lecturas de contadores')!);
    expect(lecturas[1]).toEqual(expect.arrayContaining(['1000', '10/01/2026', 'INICIAL']));

    // Ninguna celda de ninguna hoja contiene la contraseña guardada de alguien.
    const hashes = await t.sql(async (c) => (await c.query('SELECT contrasena_hash AS h FROM usuarios'))[0] as Array<{ h: string }>);
    expect(hashes.length).toBeGreaterThan(0);
    for (const hoja of wb.worksheets) {
      for (const fila of textos(hoja)) for (const celda of fila) for (const h of hashes) expect(celda.includes(h.h)).toBe(false);
    }
    const resumen = textos(wb.getWorksheet('Leeme')!);
    expect(resumen.flat().join(' ')).toContain('NO incluye contraseñas');

    // Queda constancia en la bitácora.
    const b = await t.sql(async (c) => (await c.query("SELECT accion, despues FROM bitacora WHERE accion = 'datos_exportados'"))[0] as Array<{ accion: string; despues: string }>);
    expect(b).toHaveLength(1);
    expect(b[0]!.despues).toContain('xlsx');
  });

  it('cada hoja se arma sin error aun con el taller vacío, y el resumen cuenta las filas', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const resumen = await api.get('/exportar/resumen');
    expect(resumen.status).toBe(200);
    const hojas = resumen.body.data as Array<{ hoja: string; filas: number }>;
    expect(hojas.find((h) => h.hoja === 'Clientes')!.filas).toBe(0);
    expect(hojas.find((h) => h.hoja === 'Tipos de equipo')!.filas).toBe(3);
    expect(hojas.length).toBeGreaterThan(30);
  });

  it('solo quien tiene permiso descarga: un técnico no', async () => {
    const t = await tallerDePrueba(e);
    const tecnico = t.api(await (await t.usuario('tecnico')).token());
    expect((await tecnico.get('/exportar/datos')).status).toBe(403);
    expect((await tecnico.get('/exportar/archivos')).status).toBe(403);
    expect((await tecnico.get('/exportar/resumen')).status).toBe(403);
    expect((await tecnico.get('/importar/clientes/plantilla')).status).toBe(403);
    expect((await cargar(tecnico, 'clientes', await libro(ENC_CLIENTES, [['X']]))).status).toBe(403);
  });

  it('el .zip trae las fotos con su nombre y un LEEME; el libro dice cómo se llama cada una', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cli = (await api.post('/clientes').send({ nombre: 'Cliente Foto' })).body.data.cliente.id as number;
    const vehiculo = ((await api.get('/tipos-equipo')).body.data as Array<{ id: number; codigo: string }>).find((x) => x.codigo === 'VEHICULO')!.id;
    const eq = (await api.post('/equipos').send({ tipo_equipo_id: vehiculo, cliente_id: cli, placa: 'P1' })).body.data.equipo.id as number;
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
    const foto = await api.post(`/equipos/${eq}/fotos`).set('Content-Type', 'image/png').set('X-Nombre-Archivo', encodeURIComponent('Frente.png')).send(PNG);
    expect(foto.status).toBe(201);

    const zip = await api.get('/exportar/archivos').buffer(true).parse(binario);
    expect(zip.status).toBe(200);
    expect(zip.headers['content-type']).toBe('application/zip');
    const cuerpo = zip.body as Buffer;
    expect(cuerpo.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(cuerpo.includes(Buffer.from('LEEME.txt'))).toBe(true);
    const archivoId = (await t.sql(async (c) => (await c.query('SELECT id FROM archivos'))[0] as Array<{ id: number }>))[0]!.id;
    expect(cuerpo.includes(Buffer.from(`archivos/${archivoId}_Frente.png`))).toBe(true);
    expect(cuerpo.includes(PNG)).toBe(true); // el contenido real viaja dentro

    const wb = await leerLibro((await api.get('/exportar/datos').buffer(true).parse(binario)).body as Buffer);
    expect(textos(wb.getWorksheet('Fotos de equipos')!)[1]).toContain(`${archivoId}_Frente.png`);
  });

  it('en «solo exportar» se puede descargar todo pero no cambiar nada', async () => {
    const t = await tallerDePrueba(e);
    const token = await t.token();
    const api = t.api(token);
    expect((await api.post('/clientes').send({ nombre: 'Antes' })).status).toBe(201);
    await ejecutar(e.pool, "UPDATE empresas SET estado = 'solo_exportar' WHERE id = ?", [t.empresaId]);
    expect((await api.get('/exportar/datos').buffer(true).parse(binario)).status).toBe(200);
    expect((await api.get('/exportar/archivos').buffer(true).parse(binario)).status).toBe(200);
    const bloqueada = await api.post('/clientes').send({ nombre: 'Despues' });
    expect(bloqueada.status).toBe(403);
    expect(bloqueada.body.codigo).toBe('SOLO_EXPORTAR');
    // Cargar datos nuevos tampoco: es un cambio.
    expect((await cargar(api, 'clientes', await libro(ENC_CLIENTES, [['Nuevo']]), { simular: false })).status).toBe(403);
  });
});

describe('plantillas de carga', () => {
  it('se descargan con la hoja Datos, las Instrucciones y las opciones propias del taller', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const tipos = await api.get('/importar/tipos');
    expect(tipos.body.data.map((x: { tipo: string }) => x.tipo)).toEqual(['clientes', 'equipos', 'lecturas', 'ultimos_servicios']);
    for (const tipo of ['clientes', 'equipos', 'lecturas', 'ultimos_servicios']) {
      const r = await api.get(`/importar/${tipo}/plantilla`).buffer(true).parse(binario);
      expect(r.status).toBe(200);
      const wb = await leerLibro(r.body as Buffer);
      expect(wb.getWorksheet('Datos')).toBeDefined();
      expect(wb.getWorksheet('Instrucciones')).toBeDefined();
      expect(textos(wb.getWorksheet('Datos')!)).toHaveLength(1);
    }
    const wb = await leerLibro((await api.get('/importar/equipos/plantilla').buffer(true).parse(binario)).body as Buffer);
    const listas = textos(wb.getWorksheet('Listas')!).flat();
    expect(listas).toEqual(expect.arrayContaining(['VEHICULO', 'MAQUINARIA', 'ODOMETRO']));
    expect((await api.get('/importar/planetas/plantilla')).status).toBe(404);
  });

  it('una plantilla descargada se puede subir tal cual con filas llenas', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const wb = await leerLibro((await api.get('/importar/clientes/plantilla').buffer(true).parse(binario)).body as Buffer);
    wb.getWorksheet('Datos')!.addRow(['Cliente de plantilla', '7654321', 'General']);
    const r = await cargar(api, 'clientes', Buffer.from(await wb.xlsx.writeBuffer()), { simular: false });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ aplicado: true, correctas: 1, creados: { clientes: 1 } });
  });
});

describe('cargar clientes', () => {
  it('probar sin guardar no guarda nada; cargar de verdad sí, y deja constancia', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const archivo = await libro(ENC_CLIENTES, [
      ['Transportes El Sol', '1234567K', '2222-3333', 'compras@elsol.com', 'CREDITO', 30],
      ['Ferretería Ñandú', null, null, null, null, null],
    ]);
    const prueba = await cargar(api, 'clientes', archivo);
    expect(prueba.status).toBe(200);
    expect(prueba.body.data).toMatchObject({ simulacion: true, aplicado: false, total_filas: 2, correctas: 2, con_error: 0, creados: { clientes: 2 } });
    expect(await cuenta(t, 'clientes')).toBe(0);

    const real = await cargar(api, 'clientes', archivo, { simular: false });
    expect(real.body.data).toMatchObject({ simulacion: false, aplicado: true, correctas: 2, creados: { clientes: 2 } });
    const lista = await t.sql(async (c) => (await c.query('SELECT nombre, nit, condicion_pago, dias_credito, email FROM clientes ORDER BY id'))[0] as Array<Record<string, unknown>>);
    expect(lista[0]).toMatchObject({ nombre: 'TRANSPORTES EL SOL', nit: '1234567K', condicion_pago: 'credito', dias_credito: 30, email: 'compras@elsol.com' });
    expect(lista[1]).toMatchObject({ nombre: 'FERRETERIA NANDU', condicion_pago: 'contado' });
    const b = await t.sql(async (c) => (await c.query("SELECT despues FROM bitacora WHERE accion = 'carga_masiva'"))[0] as Array<{ despues: string }>);
    expect(b).toHaveLength(1);
    expect(b[0]!.despues).toContain('"clientes":2');
  });

  it('TODO O NADA: una fila mala impide cargar las buenas, y el reporte dice fila y columna', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await api.post('/clientes').send({ nombre: 'Ya Existe', nit: '999' });
    const malo = await libro(ENC_CLIENTES, [
      ['Bueno Uno', '111', null, null, null, null],
      ['Ya Existe', '222', null, null, null, null], // fila 3: nombre repetido
      ['Bueno Dos', '999', null, null, null, null], // fila 4: NIT repetido
      ['Sin Dias', '333', null, null, 'CREDITO', null], // fila 5: crédito sin días
      ['Correo Malo', '444', null, 'no-es-correo', null, null], // fila 6
      ['Bueno Tres', '555', null, null, null, null],
      ['bueno uno', null, null, null, null, null], // fila 8: repetido DENTRO del archivo
    ]);
    const r = await cargar(api, 'clientes', malo, { simular: false });
    expect(r.status).toBe(200);
    const d = r.body.data as { aplicado: boolean; correctas: number; con_error: number; errores: Array<{ fila: number; columna: string | null; mensaje: string }>; creados: Record<string, number> };
    expect(d.aplicado).toBe(false);
    expect(d.correctas).toBe(2);
    expect(d.con_error).toBe(5);
    expect(d.creados['clientes']).toBe(2); // lo que se habría creado
    expect(d.errores.map((x) => x.fila)).toEqual([3, 4, 5, 6, 8]);
    expect(d.errores[0]).toMatchObject({ fila: 3, columna: 'NOMBRE' });
    expect(d.errores[1]!.mensaje).toContain('Ya Existe'.toUpperCase());
    expect(d.errores[2]!.mensaje).toContain('días de crédito');
    expect(d.errores[3]).toMatchObject({ fila: 6, columna: 'CORREO' });
    expect(await cuenta(t, 'clientes')).toBe(1); // solo el que ya estaba: no entró NINGUNO
    expect(await t.sql(async (c) => (await c.query("SELECT COUNT(*) AS n FROM bitacora WHERE accion = 'carga_masiva'"))[0] as Array<{ n: number }>)).toEqual([{ n: 0 }]);
  });

  it('subir dos veces el mismo archivo no duplica: la segunda vez avisa que ya existen', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const archivo = await libro(ENC_CLIENTES, [['Cliente Unico', '10', null, null, null, null]]);
    expect((await cargar(api, 'clientes', archivo, { simular: false })).body.data.aplicado).toBe(true);
    const otra = await cargar(api, 'clientes', archivo, { simular: false });
    expect(otra.body.data).toMatchObject({ aplicado: false, con_error: 1 });
    expect(await cuenta(t, 'clientes')).toBe(1);
  });
});

describe('cargar equipos', () => {
  async function prepararTaller() {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await api.post('/clientes').send({ nombre: 'Industrias Lopez', nit: '1234567K' });
    await api.post('/clientes').send({ nombre: 'Transportes Sol' });
    return { t, api };
  }

  it('crea equipos ligados al cliente por nombre o NIT, o del taller; con su medidor y lectura', async () => {
    const { t, api } = await prepararTaller();
    const archivo = await libro(ENC_EQUIPOS, [
      ['Industrias Lopez', 'Vehiculo', 'CAM-1', 'c123abc', 'SER1', null, 'Cascadia', 2022, 'Odometro', 125400, '15/03/2026'],
      ['1234567K', 'VEHICULO', 'CAM-2', 'C124ABC', null, null, null, null, 'Odometro', 500, new Date(Date.UTC(2026, 1, 20))],
      [null, 'Maquinaria', 'GRUA-1', null, 'SER3', null, null, null, 'Horometro', null, null], // del taller, lectura 0 hoy
    ]);
    const r = await cargar(api, 'equipos', archivo, { simular: false });
    expect(r.body.data).toMatchObject({ aplicado: true, correctas: 3, con_error: 0, creados: { equipos: 3, contadores: 3 } });
    const equipos = await t.sql(async (c) => (await c.query('SELECT codigo_interno, placa, propiedad, cliente_id, anio FROM equipos ORDER BY id'))[0] as Array<Record<string, unknown>>);
    expect(equipos[0]).toMatchObject({ codigo_interno: 'CAM-1', placa: 'C123ABC', propiedad: 'cliente', anio: 2022 });
    expect(equipos[1]!['cliente_id']).toBe(equipos[0]!['cliente_id']); // por NIT cae en el mismo cliente
    expect(equipos[2]).toMatchObject({ propiedad: 'propio', cliente_id: null });
    const lecturas = await t.sql(async (c) => (await c.query("SELECT valor, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, origen FROM lecturas_contador ORDER BY id"))[0] as Array<Record<string, unknown>>);
    expect(lecturas[0]).toMatchObject({ valor: 125400, fecha: '2026-03-15', origen: 'inicial' });
    expect(lecturas[1]).toMatchObject({ valor: 500, fecha: '2026-02-20' });
    expect(lecturas[2]).toMatchObject({ valor: 0 });
  });

  it('cada error dice qué corregir: tipo, cliente, marca, medidor, identificación, placa de no vehículo', async () => {
    const { api } = await prepararTaller();
    const archivo = await libro(ENC_EQUIPOS, [
      ['Industrias Lopez', 'Avion', 'A1', null, null, null, null, null, null, null, null], // 2: tipo inexistente
      ['Cliente Fantasma', 'Vehiculo', 'A2', null, null, null, null, null, null, null, null], // 3: cliente inexistente
      ['Industrias Lopez', 'Vehiculo', null, null, null, null, null, null, null, null, null], // 4: sin identificación
      ['Industrias Lopez', 'Vehiculo', 'A4', null, null, 'Marca Rara', null, null, null, null, null], // 5: marca inexistente
      ['Industrias Lopez', 'Vehiculo', 'A5', null, null, null, null, null, null, 100, null], // 6: lectura sin medidor
      ['Industrias Lopez', 'Maquinaria', 'A6', 'PLACA1', null, null, null, null, null, null, null], // 7: placa en no-vehículo
      ['Industrias Lopez', 'Vehiculo', 'A7', null, null, null, null, 1800, null, null, null], // 8: año imposible
      ['Industrias Lopez', 'Vehiculo', 'A8', null, null, null, null, null, 'Odometro', 100, '31/02/2026'], // 9: fecha inexistente
      ['Industrias Lopez', 'Vehiculo', 'A9', null, null, null, null, null, 'Odometro', 100, '01/01/2999'], // 10: fecha futura
    ]);
    const r = await cargar(api, 'equipos', archivo);
    const d = r.body.data as { con_error: number; errores: Array<{ fila: number; columna: string | null; mensaje: string }> };
    expect(d.con_error).toBe(9);
    const por = (fila: number) => d.errores.find((x) => x.fila === fila)!;
    expect(por(2)).toMatchObject({ columna: 'TIPO DE EQUIPO' });
    expect(por(2).mensaje).toContain('VEHICULO');
    expect(por(3)).toMatchObject({ columna: 'CLIENTE' });
    expect(por(4)).toMatchObject({ columna: 'CODIGO INTERNO' });
    expect(por(5)).toMatchObject({ columna: 'MARCA' });
    expect(por(6)).toMatchObject({ columna: 'TIPO DE CONTADOR' });
    expect(por(7).mensaje).toContain('vehículos llevan placa');
    expect(por(8).mensaje).toContain('año');
    expect(por(9)).toMatchObject({ columna: 'FECHA DE LECTURA' });
    expect(por(10)).toMatchObject({ columna: 'FECHA DE LECTURA' });
    expect(por(10).mensaje).toContain('futura');
  });

  it('marcas que faltan: se rechazan, o se crean si la persona lo pide', async () => {
    const { t, api } = await prepararTaller();
    const archivo = await libro(ENC_EQUIPOS, [
      ['Industrias Lopez', 'Vehiculo', 'M1', null, null, 'Freightliner', null, null, null, null, null],
      ['Industrias Lopez', 'Vehiculo', 'M2', null, null, 'freightliner', null, null, null, null, null],
    ]);
    expect((await cargar(api, 'equipos', archivo, { simular: false })).body.data).toMatchObject({ aplicado: false, con_error: 2 });
    expect(await cuenta(t, 'marcas')).toBe(0);
    const ok = await cargar(api, 'equipos', archivo, { simular: false, crearMarcas: true });
    expect(ok.body.data).toMatchObject({ aplicado: true, correctas: 2, creados: { equipos: 2, marcas: 1 } });
    expect(await cuenta(t, 'marcas')).toBe(1);
  });

  it('serie repetida y código interno repetido en el mismo cliente se rechazan; una placa repetida solo avisa', async () => {
    const { api } = await prepararTaller();
    const base = await libro(ENC_EQUIPOS, [['Industrias Lopez', 'Vehiculo', 'R1', 'PLACA9', 'SERIE9', null, null, null, null, null, null]]);
    expect((await cargar(api, 'equipos', base, { simular: false })).body.data.aplicado).toBe(true);
    const otro = await libro(ENC_EQUIPOS, [
      ['Industrias Lopez', 'Vehiculo', 'R2', null, 'SERIE9', null, null, null, null, null, null], // serie repetida
      ['Industrias Lopez', 'Vehiculo', 'R1', null, null, null, null, null, null, null, null], // código repetido en el cliente
      ['Transportes Sol', 'Vehiculo', 'R1', 'PLACA9', 'SERIE10', null, null, null, null, null, null], // otro cliente: código sí; placa solo avisa
    ]);
    const r = await cargar(api, 'equipos', otro);
    const d = r.body.data as { correctas: number; con_error: number; errores: Array<{ fila: number }>; avisos: Array<{ fila: number; mensaje: string }> };
    expect(d.errores.map((x) => x.fila)).toEqual([2, 3]);
    expect(d.correctas).toBe(1);
    expect(d.avisos).toHaveLength(1);
    expect(d.avisos[0]).toMatchObject({ fila: 4 });
    expect(d.avisos[0]!.mensaje).toContain('PLACA9');
  });
});

describe('cargar lecturas (historial)', () => {
  async function conEquipos() {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await api.post('/clientes').send({ nombre: 'Industrias Lopez' });
    await api.post('/clientes').send({ nombre: 'Transportes Sol' });
    const equipos = await libro(ENC_EQUIPOS, [
      ['Industrias Lopez', 'Vehiculo', 'CAM-1', 'C1', null, null, null, null, 'Odometro', 1000, '01/01/2026'],
      ['Transportes Sol', 'Vehiculo', 'CAM-1', 'C2', null, null, null, null, 'Odometro', 50, '01/01/2026'], // mismo código, otro cliente
    ]);
    expect((await cargar(api, 'equipos', equipos, { simular: false })).body.data.aplicado).toBe(true);
    return { t, api };
  }

  it('carga el historial en cualquier orden, ligado por placa o por código + cliente, con origen «importación»', async () => {
    const { t, api } = await conEquipos();
    const archivo = await libro(ENC_LECTURAS, [
      ['C1', null, null, 3000, '01/03/2026'],
      ['C1', null, 'Odometro', 2000, '01/02/2026'],
      ['CAM-1', 'Transportes Sol', null, 80, '01/02/2026'],
    ]);
    const r = await cargar(api, 'lecturas', archivo, { simular: false });
    expect(r.body.data).toMatchObject({ aplicado: true, correctas: 3, creados: { lecturas: 3 } });
    const lecturas = await t.sql(async (c) => (await c.query("SELECT valor, origen FROM lecturas_contador WHERE origen = 'importacion' ORDER BY valor"))[0] as Array<Record<string, unknown>>);
    expect(lecturas.map((x) => x['valor'])).toEqual([80, 2000, 3000]);
    const actual = await t.sql(async (c) => (await c.query("SELECT ct.valor_actual FROM contadores ct JOIN equipos e ON e.id = ct.equipo_id WHERE e.placa = 'C1'"))[0] as Array<{ valor_actual: number }>);
    expect(actual[0]!.valor_actual).toBe(3000);
  });

  it('un medidor solo avanza: una lectura fuera de orden se rechaza con el valor vecino', async () => {
    const { api } = await conEquipos();
    const archivo = await libro(ENC_LECTURAS, [
      ['C1', null, null, 2000, '01/02/2026'],
      ['C1', null, null, 1500, '01/03/2026'], // más tarde pero menor: mal
      ['C1', null, null, 900, '15/01/2026'], // antes de la lectura inicial (1000): mal
      ['C1', null, null, 1100, '15/12/2025'], // antes de que el contador existiera: mal
    ]);
    const r = await cargar(api, 'lecturas', archivo);
    const d = r.body.data as { correctas: number; errores: Array<{ fila: number; mensaje: string }> };
    expect(d.correctas).toBe(1);
    expect(d.errores.map((x) => x.fila)).toEqual([3, 4, 5]);
    expect(d.errores[0]!.mensaje).toContain('menor que la anterior');
    expect(d.errores[1]!.mensaje).toContain('1000');
  });

  it('no adivina: equipo inexistente, repetido entre clientes, o con varios medidores', async () => {
    const { t, api } = await conEquipos();
    const eq = await t.sql(async (c) => (await c.query("SELECT id FROM equipos WHERE placa = 'C1'"))[0] as Array<{ id: number }>);
    const horo = ((await api.get('/tipos-contador')).body.data as Array<{ id: number; nombre: string }>).find((x) => x.nombre === 'HOROMETRO')!.id;
    expect((await api.post(`/equipos/${eq[0]!.id}/contadores`).send({ tipo_contador_id: horo, valor_inicial: 0, fecha_inicio: '2026-01-01' })).status).toBe(201);
    const archivo = await libro(ENC_LECTURAS, [
      ['NO-EXISTE', null, null, 5, '01/02/2026'], // 2
      ['CAM-1', null, null, 5, '01/02/2026'], // 3: dos clientes con CAM-1
      ['C1', null, null, 1500, '01/02/2026'], // 4: C1 tiene dos medidores y el principal (odómetro) gana
      ['C1', null, 'Horometro', 5, '01/02/2026'], // 5: bien
      ['C1', null, 'Calendario', 5, '01/02/2026'], // 6: tipo que el equipo no tiene como medidor de lecturas
    ]);
    const d = (await cargar(api, 'lecturas', archivo)).body.data as { correctas: number; errores: Array<{ fila: number; columna: string | null; mensaje: string }> };
    const por = (fila: number) => d.errores.find((x) => x.fila === fila)!;
    expect(por(2)).toMatchObject({ columna: 'EQUIPO' });
    expect(por(3).mensaje).toContain('2 equipos');
    expect(por(6)).toMatchObject({ columna: 'TIPO DE CONTADOR' });
    expect(d.correctas).toBe(2); // filas 4 y 5
  });
});

describe('seguridad del archivo que se sube', () => {
  it('rechaza lo que no es un libro de Excel, vacío, sin la columna obligatoria o con demasiadas filas', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const texto = await cargar(api, 'clientes', Buffer.from('NOMBRE,NIT\nUno,1\n'));
    expect(texto.status).toBe(400);
    expect(texto.body.error).toContain('no es un libro de Excel');
    expect((await api.post('/importar/clientes').set('Content-Type', TIPO_EXCEL).send(Buffer.alloc(0))).status).toBe(400);

    const sinColumna = await cargar(api, 'clientes', await libro(['NIT', 'TELEFONO'], [['1', '2']]));
    expect(sinColumna.status).toBe(400);
    expect(sinColumna.body.error).toContain('«NOMBRE»');

    const vacio = await cargar(api, 'clientes', await libro(ENC_CLIENTES, []));
    expect(vacio.status).toBe(400);

    const muchas = await libro(ENC_CLIENTES, Array.from({ length: 2001 }, (_, i) => [`Cliente ${i}`, null, null, null, null, null]));
    const r = await cargar(api, 'clientes', muchas);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('2000');
  });

  it('rechaza un archivo «bomba» que dice ser enorme al abrirse', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const bueno = await libro(ENC_CLIENTES, [['Uno', null, null, null, null, null]]);
    // Cambia en la tabla de contenido del zip el tamaño declarado de la primera parte: 900 MB.
    const bomba = Buffer.from(bueno);
    const pos = bomba.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(pos).toBeGreaterThan(0);
    bomba.writeUInt32LE(900 * 1024 * 1024, pos + 24);
    const r = await cargar(api, 'clientes', bomba);
    expect(r.status).toBe(400);
    expect(r.body.error).toContain('demasiado grande');
  });

  it('la carga sin simular y sin permiso de importar no toca nada, aunque el archivo sea bueno', async () => {
    const t = await tallerDePrueba(e);
    const recepcion = t.api(await (await t.usuario('recepcionista')).token());
    const r = await cargar(recepcion, 'clientes', await libro(ENC_CLIENTES, [['Colado', null, null, null, null, null]]), { simular: false });
    expect(r.status).toBe(403);
    expect(await cuenta(t, 'clientes')).toBe(0);
  });
});
