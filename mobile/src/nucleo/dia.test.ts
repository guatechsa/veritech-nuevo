import { Acciones } from './acciones';
import { aplicarCambio } from './cambios-locales';
import { ClienteApi } from './cliente';
import { Cola } from './cola';
import { Checklist, claveDeArchivo, Dia, MiDia } from './dia';
import { fechaCorta, fechaHoraDelTaller, numeroDe } from './fechas';
import { Fotos } from './fotos';
import { pantallasPara } from './menu';
import { problemasParaCompletar, puedeAgregarFoto } from './reglas';
import { GestorDeSesion } from './sesion';
import { Sincronizador } from './sincronizador';
import { AlmacenEnMemoria, ArchivosEnMemoria, generadorDeIds, ImagenesFalsas, mal, ok, RelojFalso, SeguroEnMemoria, ServidorFalso } from './pruebas/falsos';

const TEL = { instalacion: 'instalacion-0001-abcdef', plataforma: 'android' as const };
const ESPACIO = { taller: 'miTaller', usuarioId: 7 };

const respuesta = (id: number, extra: Record<string, unknown> = {}) => ({ id, seccion: 'Frenos', descripcion: `Punto ${id}`, tipo_respuesta: 'semaforo', semaforo: null, si_no: null, valor_numero: null, valor_texto: null, opcion_texto: null, nota: null, opciones: [], fotos: [], ...extra });
const diaDelServidor = (): MiDia =>
  ({
    descargado_en: '2026-12-01T15:00:00.000Z',
    hoy: '2026-12-01',
    usuario: { id: 7, nombre: 'ANA', roles: ['tecnico'] },
    trabajos: { colaborador_id: 3, ocupado: false, trabajos: [{ id: 11, orden_id: 5, numero: 'REP-000005', descripcion: 'CAMBIO DE ACEITE', estado: 'pendiente', equipo: 'CAM-1', fotos: [{ id: 1, tipo: 'antes', url: '/api/archivos/miTaller/10?e=111&f=aaa' }] }] },
    ordenes: [{ id: 5, numero: 'REP-000005', equipo_id: 2, lineas: [{ id: 11, estado: 'pendiente' }] }],
    checklists: [{ id: 21, tipo: 'FRENOS', orden_id: 5, equipo_id: 2, estado: 'pendiente', exige_lectura_contador: true, requiere_firma_cliente: false, total: 2, respondidas: 0, respuestas: [respuesta(31), respuesta(32, { fotos: [{ id: 2, url: '/api/archivos/miTaller/12?e=111&f=bbb' }] })] }],
    equipos: [{ id: 2, contadores: [{ id: 41, valor_actual: 1000 }] }],
    archivos: ['/api/archivos/miTaller/10?e=111&f=aaa', '/api/archivos/miTaller/12?e=111&f=bbb'],
    incompleto: [],
  }) as unknown as MiDia;

async function montar() {
  const servidor = new ServidorFalso();
  servidor.en('POST', '/auth/ingresar-movil', ok({ token: 't'.repeat(64), vence_en: '2026-12-01T23:00:00Z', refresco: 'r'.repeat(64), refresco_vence_en: '2027-01-30T15:00:00Z' }));
  servidor.en('GET', '/auth/yo', ok({ usuario: { id: 7, nombre: 'ANA' }, permisos: [] }));
  const reloj = new RelojFalso();
  const gestor = new GestorDeSesion({ baseUrl: servidor.baseUrl, taller: 'miTaller', fetch: servidor.fetch, seguro: new SeguroEnMemoria(), reloj, telefono: async () => TEL, limiteMs: 200 });
  await gestor.ingresar('ana@taller.test', 'x', false);
  servidor.llamadas = [];
  const cliente = new ClienteApi({ baseUrl: servidor.baseUrl, taller: 'miTaller', fetch: servidor.fetch, sesion: gestor, limiteMs: 200 });
  const archivos = new ArchivosEnMemoria();
  const almacen = new AlmacenEnMemoria();
  const cola = new Cola(almacen, ESPACIO, generadorDeIds('c'), reloj);
  const sincronizador = new Sincronizador({ cola, cliente, archivos, reloj });
  const imagenes = new ImagenesFalsas(archivos);
  const fotos = new Fotos({ almacen, archivos, imagenes, espacio: ESPACIO });
  const dia = new Dia({ almacen, espacio: ESPACIO, cliente, archivos, cola, reloj, aplicarCambio });
  const acciones = new Acciones({ cola, sincronizador, fotos });
  return { servidor, cola, archivos, almacen, dia, acciones, sincronizador, imagenes, reloj };
}
/** Hace que no haya señal para enviar (lo que se hace queda en el teléfono). */
const sinSenal = (m: Awaited<ReturnType<typeof montar>>) => m.servidor.en('POST', /.*/, 'sin_senal').en('PATCH', /.*/, 'sin_senal');
const esperarEnvio = (m: Awaited<ReturnType<typeof montar>>) => m.sincronizador.sincronizar();

describe('descargar mi día', () => {
  it('guarda todo en el teléfono y baja las fotos, que quedan con una dirección local estable aunque la firma del servidor cambie', async () => {
    const m = await montar();
    m.servidor.en('GET', '/movil/mi-dia', ok(diaDelServidor()));
    const r = await m.dia.descargar();
    expect(r).toEqual({ descargado_en: '2026-12-01T15:00:00.000Z', fotos: 2, fotosFaltan: 0, partesIncompletas: [] });
    const v = await m.dia.ver();
    expect(v!.datos.trabajos!.trabajos).toHaveLength(1);
    expect(m.archivos.descargas.map((d) => d.url)).toEqual(['/api/archivos/miTaller/10?e=111&f=aaa', '/api/archivos/miTaller/12?e=111&f=bbb']);
    const local = await m.dia.uriLocal('/api/archivos/miTaller/10?e=999&f=otra-firma'); // la misma foto con otra firma
    expect(local.startsWith('file:///app/servidor/')).toBe(true);
    expect(await m.archivos.existe(local)).toBe(true);
    // Bajar otra vez no vuelve a bajar lo que ya está.
    await m.dia.descargar();
    expect(m.archivos.descargas).toHaveLength(2);
  });

  it('si una foto no se puede bajar, lo demás se guarda y se dice cuál faltó', async () => {
    const m = await montar();
    m.servidor.en('GET', '/movil/mi-dia', ok({ ...diaDelServidor(), incompleto: ['equipo 9'] }));
    m.archivos.fallan.add('/api/archivos/miTaller/12?e=111&f=bbb');
    const r = await m.dia.descargar();
    expect(r).toMatchObject({ fotos: 1, fotosFaltan: 1, partesIncompletas: ['equipo 9'] });
    expect((await m.dia.ver())!.faltan).toEqual(['/api/archivos/miTaller/12']);
    expect(await m.dia.uriLocal('/api/archivos/miTaller/12?e=1&f=z')).toBe('/api/archivos/miTaller/12?e=1&f=z'); // sin copia local: la dirección original
  });

  it('sin señal no se pierde lo que ya estaba bajado', async () => {
    const m = await montar();
    m.servidor.en('GET', '/movil/mi-dia', ok(diaDelServidor()));
    await m.dia.descargar();
    m.servidor.en('GET', '/movil/mi-dia', 'sin_senal');
    await expect(m.dia.descargar()).rejects.toMatchObject({ tipo: 'sin_senal' });
    expect((await m.dia.ver())!.datos.checklists).toHaveLength(1); // sigue ahí
    expect(await m.dia.hayDia()).toBe(true);
  });

  it('lo que se hizo sin señal se ve al instante y SOBREVIVE a bajar el día otra vez', async () => {
    const m = await montar();
    sinSenal(m);
    m.servidor.en('GET', '/movil/mi-dia', ok(diaDelServidor()));
    await m.dia.descargar();
    await m.acciones.cambiarEstadoTrabajo(11, 'en_proceso', 'Iniciar trabajo');
    await m.acciones.responderItem(21, 31, { semaforo: 'rojo' }, 'Punto 31');
    await m.acciones.registrarLectura(41, 1500, '2026-12-01');
    let v = (await m.dia.ver())!.datos;
    expect(v.trabajos!.trabajos[0]!.estado).toBe('en_proceso');
    expect(v.trabajos!.ocupado).toBe(true);
    expect(v.ordenes[0]!.lineas![0]!.estado).toBe('en_proceso');
    expect(v.checklists[0]).toMatchObject({ estado: 'en_progreso', respondidas: 1 });
    expect(v.checklists[0]!.respuestas[0]!.semaforo).toBe('rojo');
    expect(v.equipos[0]!.contadores![0]!.valor_actual).toBe(1500);
    // Se baja el día de nuevo (el servidor aún no sabe nada de esos cambios): los cambios se ven igual.
    await m.dia.descargar();
    v = (await m.dia.ver())!.datos;
    expect(v.trabajos!.trabajos[0]!.estado).toBe('en_proceso');
    expect(v.checklists[0]!.respuestas[0]!.semaforo).toBe('rojo');
    // Cuando ya se enviaron (y el servidor los conoce), dejan de aplicarse encima.
    m.servidor.vaciar();
    m.servidor.en('POST', /.*/, ok({})).en('PATCH', /.*/, ok({}));
    m.servidor.en('GET', '/movil/mi-dia', ok({ ...diaDelServidor(), trabajos: { colaborador_id: 3, ocupado: true, trabajos: [{ ...diaDelServidor().trabajos!.trabajos[0]!, estado: 'en_proceso' }] } }));
    await esperarEnvio(m);
    expect(await m.cola.todos()).toEqual([]);
    await m.dia.descargar();
    expect((await m.dia.ver())!.datos.trabajos!.trabajos[0]!.estado).toBe('en_proceso');
  });

  it('lo bajado no se modifica: la copia del servidor queda intacta', () => {
    const original = diaDelServidor();
    const copia = JSON.parse(JSON.stringify(original)) as MiDia;
    const nuevo = aplicarCambio(original, { id: 'c', titulo: '', tipo: 'checklist_respuesta', metodo: 'PATCH', ruta: '/', hechoEn: '', estado: 'pendiente', intentos: 0, contexto: { checklistId: 21, respuestaId: 31, valores: { semaforo: 'verde' } } });
    expect(original).toEqual(copia);
    expect(nuevo.checklists[0]!.respuestas[0]!.semaforo).toBe('verde');
    expect(claveDeArchivo('/api/archivos/t/10?e=1&f=2')).toBe('/api/archivos/t/10');
  });
});

describe('las acciones', () => {
  it('con señal el cambio sale enseguida con su identificador; sin señal queda en el teléfono y sale al volver', async () => {
    const m = await montar();
    m.servidor.en('POST', '/lineas/11/estado', ok({}));
    await m.acciones.cambiarEstadoTrabajo(11, 'terminado', 'Terminar trabajo');
    await esperarEnvio(m);
    expect(m.servidor.llamadas[0]).toMatchObject({ metodo: 'POST', ruta: '/lineas/11/estado', cuerpo: { estado: 'terminado' } });
    expect(m.servidor.llamadas[0]!.cabeceras['X-Id-Cliente']).toMatch(/^c-/);
    expect(await m.cola.todos()).toEqual([]);

    m.servidor.vaciar();
    m.servidor.en('POST', '/lineas/12/estado', 'sin_senal');
    await m.acciones.cambiarEstadoTrabajo(12, 'en_proceso', 'Iniciar trabajo');
    await esperarEnvio(m);
    expect(await m.cola.pendientes()).toHaveLength(1);
    m.servidor.en('POST', '/lineas/12/estado', ok({}));
    await esperarEnvio(m);
    expect(await m.cola.todos()).toEqual([]);
  });

  it('una foto se reduce a 1.600 px, se copia a la carpeta de la app (y la de la cámara se borra) y cuenta como puesta aunque no haya señal', async () => {
    const m = await montar();
    sinSenal(m);
    m.servidor.en('GET', '/movil/mi-dia', ok(diaDelServidor()));
    await m.dia.descargar();
    m.archivos.poner('file:///cache/camara/IMG_9.jpg', new Uint8Array([1, 2, 3, 4]));
    const resp = (await m.dia.ver())!.datos.checklists[0]!.respuestas[0]!;
    const c = await m.acciones.agregarFotoDeItem(21, resp, 'file:///cache/camara/IMG_9.jpg');
    expect(m.imagenes.llamadas).toEqual([{ uri: 'file:///cache/camara/IMG_9.jpg', ancho: 1600 }]);
    expect(c.archivo!.uri).toBe('file:///app/fotos/miTaller-7-checklist-21-31-0001.jpg');
    expect(c.archivo!.nombre).toBe('checklist-21-31-0001.jpg');
    expect(await m.archivos.existe(c.archivo!.uri)).toBe(true);
    expect(await m.archivos.existe('file:///cache/camara/IMG_9.jpg')).toBe(false); // la temporal de la cámara ya no hace falta
    const despues = (await m.dia.ver())!.datos.checklists[0]!.respuestas[0]!;
    expect(despues.fotos_locales).toEqual([{ uri: c.archivo!.uri }]); // ya cuenta, y la pantalla puede avisar que falta subirla
    // Un número distinto para la siguiente.
    m.archivos.poner('file:///cache/camara/IMG_10.jpg');
    const c2 = await m.acciones.agregarFotoDeItem(21, despues, 'file:///cache/camara/IMG_10.jpg');
    expect(c2.archivo!.nombre).toBe('checklist-21-31-0002.jpg');
  });

  it('máximo 5 fotos por punto', async () => {
    const m = await montar();
    sinSenal(m);
    const lleno = respuesta(31, { fotos: [1, 2, 3].map((id) => ({ id, url: `/api/archivos/t/${id}` })), fotos_locales: [{ uri: 'a' }, { uri: 'b' }] }) as never;
    expect(puedeAgregarFoto(lleno)).toBe(false);
    await expect(m.acciones.agregarFotoDeItem(21, lleno, 'file:///x.jpg')).rejects.toThrow('hasta 5 fotos');
    expect(await m.cola.todos()).toEqual([]);
  });

  it('completar el checklist depende de sus respuestas y fotos: si una se rechaza, completar no se manda', async () => {
    const m = await montar();
    m.servidor.en('PATCH', '/checklists/21/respuestas/31', mal(400, 'VALIDACION', 'Elija el motivo'));
    m.servidor.en('POST', '/checklists/21/completar', ok({}));
    sinSenal(m);
    await m.acciones.responderItem(21, 31, { semaforo: 'rojo' }, 'Punto 31');
    await m.acciones.completarChecklist(21, { contador_id: 41, valor: 1500 }, 'Revisión de frenos');
    await esperarEnvio(m); // que termine el envío en segundo plano (sin señal) antes de cambiar las respuestas del servidor
    m.servidor.vaciar();
    m.servidor.en('PATCH', '/checklists/21/respuestas/31', mal(400, 'VALIDACION', 'Elija el motivo'));
    m.servidor.en('POST', '/checklists/21/completar', ok({}));
    await esperarEnvio(m);
    expect(m.servidor.llamadas.map((l) => l.ruta)).toEqual(['/checklists/21/respuestas/31']); // completar nunca salió
    const todos = await m.cola.todos();
    expect(todos.map((c) => c.estado)).toEqual(['rechazado', 'rechazado']);
  });
});

describe('las reglas del checklist en el teléfono', () => {
  const base = (): Checklist => diaDelServidor().checklists[0]!;

  it('dice qué falta: puntos sin responder, fotos de los amarillos y rojos, la lectura del contador', () => {
    const c = base();
    expect(problemasParaCompletar(c, null)).toEqual(['Faltan 2 puntos por responder.', 'Escriba la lectura del contador.']);
    c.respuestas = c.respuestas.map((r) => ({ ...r, semaforo: 'rojo' as const }));
    expect(problemasParaCompletar(c, 1500)).toEqual(['El punto «Punto 31» necesita al menos una foto.']); // el 32 ya trae una del servidor
    c.respuestas[0]!.fotos_locales = [{ uri: 'file:///app/fotos/1.jpg' }]; // una foto tomada y aún sin enviar YA cuenta
    expect(problemasParaCompletar(c, 1500)).toEqual([]);
    c.exige_lectura_contador = false;
    expect(problemasParaCompletar(c, null)).toEqual([]);
    c.estado = 'completado';
    expect(problemasParaCompletar(c, 1500)).toEqual(['Este checklist ya está completado.']);
  });
});

describe('el menú, las fechas y los números', () => {
  it('el menú sale de los permisos, no del rol', () => {
    const ids = (p: string[]) => pantallasPara(p).map((x) => x.id);
    expect(ids([])).toEqual(['inicio', 'cuenta']);
    expect(ids(['ordenes.trabajar', 'checklists.llenar', 'equipos.ver'])).toEqual(['inicio', 'trabajos', 'checklists', 'equipos', 'escanear', 'cuenta']);
    expect(ids(['solicitudes.despachar'])).toEqual(['inicio', 'bodega', 'cuenta']);
    expect(ids(['ordenes.crear', 'citas.ver'])).toEqual(['inicio', 'recepcion', 'citas', 'cuenta']);
  });

  it('las fechas se escriben DD/MM/AAAA sin correrse de día; las horas, en la zona del taller', () => {
    expect(fechaCorta('2026-11-13')).toBe('13/11/2026');
    expect(fechaCorta('2026-11-13T00:00:00.000Z')).toBe('13/11/2026'); // un DATE que llega con hora: se toma el día tal cual
    expect(fechaCorta(null)).toBe('');
    expect(fechaHoraDelTaller('2026-11-13T15:30:00Z', 'America/Guatemala')).toBe('13/11/2026 09:30');
    expect(fechaHoraDelTaller('2026-11-14T04:00:00Z', 'America/Guatemala')).toBe('13/11/2026 22:00'); // de noche no es el día de UTC
  });

  it('un número con coma se entiende; algo como «12abc» se rechaza', () => {
    expect(numeroDe('12,5')).toBe(12.5);
    expect(numeroDe(' 1500 ')).toBe(1500);
    expect(numeroDe('12abc')).toBeNull();
    expect(numeroDe('')).toBeNull();
    expect(numeroDe('-3')).toBeNull();
    expect(numeroDe('1.000,5')).toBeNull();
  });
});
