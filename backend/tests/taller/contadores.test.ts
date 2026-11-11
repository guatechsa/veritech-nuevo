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

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 7)]);
const dia = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function tipo(api: Api, ruta: string, campo: string, valor: string): Promise<number> {
  return ((await api.get(ruta)).body.data as Array<Record<string, unknown>>).find((x) => x[campo] === valor)!['id'] as number;
}

/** Un vehículo con su odómetro en 1000 km, hace 30 días. */
async function vehiculo(api: Api, contadores: Array<Record<string, unknown>> = []) {
  const cli = (await api.post('/clientes').send({ nombre: 'Cliente Uno' })).body.data.cliente.id;
  const odometro = await tipo(api, '/tipos-contador', 'nombre', 'ODOMETRO');
  const r = await api.post('/equipos').send({ tipo_equipo_id: await tipo(api, '/tipos-equipo', 'codigo', 'VEHICULO'), cliente_id: cli, contadores: [{ tipo_contador_id: odometro, valor_inicial: 1000, fecha_inicio: dia(-30) }, ...contadores] });
  expect(r.status).toBe(201);
  return { equipo: r.body.data.equipo, odometro, contador: r.body.data.equipo.contadores[0] as { id: number } };
}
const leer = (api: Api, contadorId: number, valor: number, fecha?: string) => api.post(`/contadores/${contadorId}/lecturas`).send({ valor, ...(fecha ? { fecha } : {}) });
const actual = async (api: Api, equipoId: number, contadorId: number): Promise<number> => ((await api.get(`/equipos/${equipoId}/contadores`)).body.data as Array<{ id: number; valor_actual: number }>).find((c) => c.id === contadorId)!.valor_actual;

describe('contadores: alta y lectura inicial', () => {
  it('al crear el equipo nace su contador con la lectura inicial; el primero es el principal', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo, contador } = await vehiculo(api);
    expect(equipo.contadores).toHaveLength(1);
    expect(equipo.contadores[0]).toMatchObject({ nombre: 'ODOMETRO', unidad: 'KM', valor_inicial: 1000, valor_actual: 1000, es_principal: true, es_calendario: false, fecha_inicio: dia(-30) });
    const lecturas = (await api.get(`/contadores/${contador.id}/lecturas`)).body.data;
    expect(lecturas).toHaveLength(1);
    expect(lecturas[0]).toMatchObject({ valor: 1000, origen: 'inicial', estado: 'valida' });
  });

  it('un segundo contador del mismo grupo no es principal, salvo que se pida (y entonces el anterior deja de serlo)', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo, contador } = await vehiculo(api);
    const horometro = await tipo(api, '/tipos-contador', 'nombre', 'HOROMETRO');
    const r = await api.post(`/equipos/${equipo.id}/contadores`).send({ tipo_contador_id: horometro, valor_inicial: 50 });
    expect(r.status).toBe(201);
    const lista = r.body.data as Array<{ id: number; es_principal: boolean; nombre: string }>;
    expect(lista.filter((c) => c.es_principal).map((c) => c.nombre)).toEqual(['ODOMETRO']);
    const otro = lista.find((c) => c.nombre === 'HOROMETRO')!;
    const cambio = await api.patch(`/contadores/${otro.id}`).send({ es_principal: true });
    expect((cambio.body.data as Array<{ id: number; es_principal: boolean }>).filter((c) => c.es_principal).map((c) => c.id)).toEqual([otro.id]);
    // El principal se cambia marcando otro, no desmarcándolo.
    expect((await api.patch(`/contadores/${otro.id}`).send({ es_principal: false })).status).toBe(409);
    // Y el principal no se desactiva mientras haya otros activos.
    expect((await api.patch(`/contadores/${otro.id}`).send({ activo: false })).status).toBe(409);
    expect((await api.patch(`/contadores/${contador.id}`).send({ activo: false })).status).toBe(200);
  });

  it('valores imposibles: inicial negativo, fecha futura o contador de calendario que no empieza en cero', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo } = await vehiculo(api);
    const odo = await tipo(api, '/tipos-contador', 'nombre', 'ODOMETRO');
    const cal = await tipo(api, '/tipos-contador', 'nombre', 'CALENDARIO');
    expect((await api.post(`/equipos/${equipo.id}/contadores`).send({ tipo_contador_id: odo, valor_inicial: -5 })).status).toBe(400);
    expect((await api.post(`/equipos/${equipo.id}/contadores`).send({ tipo_contador_id: odo, fecha_inicio: dia(3) })).status).toBe(400);
    expect((await api.post(`/equipos/${equipo.id}/contadores`).send({ tipo_contador_id: cal, valor_inicial: 10 })).status).toBe(400);
    expect((await api.post(`/equipos/${equipo.id}/contadores`).send({ tipo_contador_id: 99999 })).status).toBe(400);
  });

  it('un contador de calendario cuenta los días solo y no admite lecturas', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo } = await vehiculo(api);
    const cal = await tipo(api, '/tipos-contador', 'nombre', 'CALENDARIO');
    const r = await api.post(`/equipos/${equipo.id}/contadores`).send({ tipo_contador_id: cal, fecha_inicio: dia(-45), nombre: 'dias de servicio' });
    const c = (r.body.data as Array<{ id: number; nombre: string; valor_actual: number; unidad: string; es_calendario: boolean }>).find((x) => x.nombre === 'DIAS DE SERVICIO')!;
    expect(c).toMatchObject({ es_calendario: true, unidad: 'DIAS', valor_actual: 45 });
    const lectura = await leer(api, c.id, 50);
    expect(lectura.status).toBe(409);
    expect((await api.get(`/contadores/${c.id}/lecturas`)).body.data).toEqual([]);
  });
});

describe('contadores: lecturas', () => {
  it('el medidor solo avanza: una lectura menor se rechaza con el valor anterior; igual o mayor se acepta', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo, contador } = await vehiculo(api);
    const ok = await leer(api, contador.id, 1500, dia(-10));
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ valor: 1500, origen: 'manual', estado: 'valida' });
    const menor = await leer(api, contador.id, 1400, dia(-5));
    expect(menor.status).toBe(409);
    expect(menor.body.codigo).toBe('LECTURA_MENOR');
    expect(menor.body.error).toContain('1500');
    expect((await leer(api, contador.id, 1500, dia(-2))).status).toBe(201); // igual: el equipo no se movió
    expect((await leer(api, contador.id, 1620)).status).toBe(201);
    expect(await actual(api, equipo.id, contador.id)).toBe(1620);
    expect((await leer(api, contador.id, -3)).status).toBe(400);
    expect((await leer(api, contador.id, 99_999_999_999)).status).toBe(400);
  });

  it('una lectura de una fecha pasada tiene que quedar entre la anterior y la siguiente', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo, contador } = await vehiculo(api);
    await leer(api, contador.id, 1200, dia(-20));
    await leer(api, contador.id, 1800, dia(-10));
    const fuera = await leer(api, contador.id, 1900, dia(-15)); // mayor que la de hace 10 días
    expect(fuera.status).toBe(409);
    expect(fuera.body.codigo).toBe('LECTURA_MAYOR');
    expect((await leer(api, contador.id, 1100, dia(-15))).status).toBe(409); // menor que la de hace 20
    expect((await leer(api, contador.id, 1500, dia(-15))).status).toBe(201);
    // El valor vigente sigue siendo el de la fecha más reciente, no el último que se escribió.
    expect(await actual(api, equipo.id, contador.id)).toBe(1800);
  });

  it('no acepta fechas futuras ni anteriores a la fecha de inicio del contador, ni fechas que no existen', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { contador } = await vehiculo(api);
    expect((await leer(api, contador.id, 1100, dia(2))).status).toBe(400);
    expect((await leer(api, contador.id, 1100, dia(-31))).status).toBe(400);
    expect((await leer(api, contador.id, 1100, '2026-02-30')).status).toBe(400);
    expect((await leer(api, contador.id, 1100, '2026/02/10')).status).toBe(400);
  });

  it('"hoy" es el día del taller, no el de UTC: a las 18:30 de Guatemala ya es "mañana" en UTC y esa fecha sigue siendo futura', async () => {
    const t = await tallerDePrueba(e);
    await ejecutar(e.pool, "UPDATE empresas SET zona_horaria = 'America/Guatemala' WHERE id = ?", [t.empresaId]);
    // Mañana 00:30 UTC = hoy 18:30 en Guatemala (menos de un día adelante: ni la prueba ni las sesiones vencen).
    const reloj = new Date();
    reloj.setUTCHours(24, 30, 0, 0);
    e.reloj.fijo = reloj;
    const api = await admin(t);
    const hoyGuatemala = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(reloj);
    const hoyUtc = reloj.toISOString().slice(0, 10);
    expect(hoyUtc).not.toBe(hoyGuatemala);
    const { contador } = await vehiculo(api);
    const manana = await leer(api, contador.id, 1100, hoyUtc);
    expect(manana.status).toBe(400);
    expect(manana.body.error).toContain('futura');
    expect((await leer(api, contador.id, 1100, hoyGuatemala)).status).toBe(201);
    expect((await leer(api, contador.id, 1150)).body.data.fecha).toBe(hoyGuatemala); // sin fecha: el día del taller
  });

  it('dos lecturas a la vez no se pisan: el contador queda con la mayor de las aceptadas', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo, contador } = await vehiculo(api);
    const respuestas = await Promise.all([1100, 1200, 1300, 1400, 1500, 1600].map((v) => leer(api, contador.id, v, dia(-1))));
    const aceptadas = respuestas.filter((r) => r.status === 201).map((r) => r.body.data.valor as number);
    expect(aceptadas.length).toBeGreaterThan(0);
    for (const r of respuestas) expect([201, 409]).toContain(r.status);
    expect(await actual(api, equipo.id, contador.id)).toBe(Math.max(...aceptadas));
    // Y lo guardado es coherente: cada lectura válida es menor o igual que la siguiente por orden de id (el medidor nunca retrocede).
    const guardadas = (await api.get(`/contadores/${contador.id}/lecturas`)).body.data as Array<{ id: number; valor: number }>;
    const porId = [...guardadas].sort((a, b) => a.id - b.id).map((x) => x.valor);
    expect([...porId].sort((a, b) => a - b)).toEqual(porId);
  });

  it('anular: pide permiso y motivo, deja rastro, devuelve el contador a la lectura anterior y no toca la inicial', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo, contador } = await vehiculo(api);
    const mala = (await leer(api, contador.id, 9000, dia(-2))).body.data; // se equivocaron de cifra
    expect(await actual(api, equipo.id, contador.id)).toBe(9000);
    expect((await leer(api, contador.id, 1500, dia(-1))).status).toBe(409); // la lectura mala estorba
    // Un técnico puede registrar, pero no anular.
    const tecnico = t.api(await (await t.usuario('tecnico')).token());
    expect((await tecnico.post(`/lecturas/${mala.id}/anular`).send({ motivo: 'error de digitacion' })).status).toBe(403);
    expect((await api.post(`/lecturas/${mala.id}/anular`).send({})).status).toBe(400);
    expect((await api.post(`/lecturas/${mala.id}/anular`).send({ motivo: 'x' })).status).toBe(400);
    const anulada = await api.post(`/lecturas/${mala.id}/anular`).send({ motivo: 'se digitó mal la cifra' });
    expect(anulada.status).toBe(200);
    expect(anulada.body.data).toMatchObject({ estado: 'anulada', motivo_anulacion: 'SE DIGITO MAL LA CIFRA' });
    expect(anulada.body.data.anulada_por).toBeTruthy();
    expect(anulada.body.data.anulada_en).toBeTruthy();
    expect(await actual(api, equipo.id, contador.id)).toBe(1000);
    expect((await leer(api, contador.id, 1500, dia(-1))).status).toBe(201); // ya cabe
    expect((await api.post(`/lecturas/${mala.id}/anular`).send({ motivo: 'otra vez' })).status).toBe(409);
    // La lectura anulada sigue en el historial (nunca se borra) y la bitácora lo registra.
    const todas = (await api.get(`/contadores/${contador.id}/lecturas`)).body.data as Array<{ id: number; estado: string }>;
    expect(todas.find((l) => l.id === mala.id)?.estado).toBe('anulada');
    const inicial = todas.find((l) => (l as unknown as { origen: string }).origen === 'inicial')!;
    expect((await api.post(`/lecturas/${inicial.id}/anular`).send({ motivo: 'quiero quitarla' })).status).toBe(409);
    const rastro = await t.sql(async (con) => {
      const [rows] = await con.query('SELECT motivo FROM bitacora WHERE accion = ? AND entidad_id = ?', ['lectura_anulada', mala.id]);
      return rows as Array<{ motivo: string }>;
    });
    expect(rastro).toHaveLength(1);
  });

  it('anular la única lectura posterior a la inicial regresa al valor inicial; anular la del medio no cambia el actual', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo, contador } = await vehiculo(api);
    const l1 = (await leer(api, contador.id, 1100, dia(-20))).body.data;
    const l2 = (await leer(api, contador.id, 1300, dia(-10))).body.data;
    await api.post(`/lecturas/${l1.id}/anular`).send({ motivo: 'prueba uno' });
    expect(await actual(api, equipo.id, contador.id)).toBe(1300);
    await api.post(`/lecturas/${l2.id}/anular`).send({ motivo: 'prueba dos' });
    expect(await actual(api, equipo.id, contador.id)).toBe(1000);
  });

  it('un contador desactivado, un equipo dado de baja o un contador que no existe no reciben lecturas', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo, contador } = await vehiculo(api);
    const horometro = await tipo(api, '/tipos-contador', 'nombre', 'HOROMETRO');
    const extra = ((await api.post(`/equipos/${equipo.id}/contadores`).send({ tipo_contador_id: horometro })).body.data as Array<{ id: number; nombre: string }>).find((c) => c.nombre === 'HOROMETRO')!;
    await api.patch(`/contadores/${extra.id}`).send({ activo: false });
    expect((await leer(api, extra.id, 5)).status).toBe(409);
    expect((await leer(api, 99999, 5)).status).toBe(404);
    await api.post(`/equipos/${equipo.id}/estado`).send({ estado: 'baja', motivo: 'chatarra' });
    expect((await leer(api, contador.id, 1100)).status).toBe(409);
  });

  it('la foto del tablero se adjunta una sola vez y solo si es imagen', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { contador } = await vehiculo(api);
    const l = (await leer(api, contador.id, 1100)).body.data;
    const subir = (buf: Buffer, mime: string) => api.post(`/lecturas/${l.id}/foto`).set('Content-Type', mime).set('X-Nombre-Archivo', 'tablero.png').send(buf);
    expect((await subir(Buffer.from('%PDF-1.4 contenido largo de prueba'), 'application/pdf')).status).toBe(400);
    expect((await subir(Buffer.from('no soy una imagen aunque lo diga'), 'image/png')).status).toBe(400);
    const ok = await subir(PNG, 'image/png');
    expect(ok.status).toBe(200);
    expect((ok.body.data as Array<{ id: number; archivo_id: number | null }>).find((x) => x.id === l.id)?.archivo_id).toBeGreaterThan(0);
    expect((await subir(PNG, 'image/png')).status).toBe(409);
    // Si falla, no queda un archivo suelto en el registro.
    expect(await t.sql(async (con) => ((await con.query('SELECT COUNT(*) AS n FROM archivos'))[0] as Array<{ n: number }>)[0]!.n)).toBe(1);
  });

  it('permisos: el operador puede ver y registrar; el bodeguero ni siquiera ve los contadores', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { equipo, contador } = await vehiculo(api);
    const operador = t.api(await (await t.usuario('operador')).token());
    expect((await operador.get(`/equipos/${equipo.id}/contadores`)).status).toBe(200);
    expect((await leer(operador, contador.id, 1200)).status).toBe(201);
    expect((await operador.post(`/equipos/${equipo.id}/contadores`).send({ tipo_contador_id: 1 })).status).toBe(403);
    const bodeguero = t.api(await (await t.usuario('bodeguero')).token());
    expect((await bodeguero.get(`/equipos/${equipo.id}/contadores`)).status).toBe(403);
    expect((await leer(bodeguero, contador.id, 1300)).status).toBe(403);
  });
});
