import { Acciones } from './acciones';
import { aplicarCambio } from './cambios-locales';
import { ClienteApi } from './cliente';
import { Cola } from './cola';
import { Dia, MiDia } from './dia';
import { EnLinea } from './en-linea';
import { ErrorDeRed } from './errores';
import { firmaEnBase64 } from './firma';
import { Fotos } from './fotos';
import { pantallasPara } from './menu';
import { problemasParaCompletar } from './reglas';
import { GestorDeSesion } from './sesion';
import { Sincronizador } from './sincronizador';
import { AlmacenEnMemoria, ArchivosEnMemoria, generadorDeIds, ImagenesFalsas, mal, ok, RelojFalso, SeguroEnMemoria, ServidorFalso } from './pruebas/falsos';

const TEL = { instalacion: 'instalacion-0001-abcdef', plataforma: 'android' as const };
const ESPACIO = { taller: 'miTaller', usuarioId: 9 };

const respuesta = (id: number, extra: Record<string, unknown> = {}) => ({ id, seccion: 'Recepción', descripcion: `Punto ${id}`, tipo_respuesta: 'semaforo', semaforo: 'verde', si_no: null, valor_numero: null, valor_texto: null, opcion_texto: null, nota: null, opciones: [], fotos: [], ...extra });
const diaDeRecepcion = (): MiDia =>
  ({
    descargado_en: '2026-12-01T15:00:00.000Z',
    hoy: '2026-12-01',
    usuario: { id: 9, nombre: 'LUCIA', roles: ['recepcionista'] },
    ordenes: [{ id: 5, numero: 'REP-000005', equipo_id: 2, estado_id: 1, estado: 'RECIBIDO', es_terminal: 0, equipo_en_taller: 1, lineas: [] }],
    ordenes_abiertas: [{ id: 5, numero: 'REP-000005', estado: 'RECIBIDO', equipo_en_taller: 1 }],
    checklists: [{ id: 21, tipo: 'RECEPCION', orden_id: 5, equipo_id: 2, estado: 'en_progreso', exige_lectura_contador: false, requiere_firma_cliente: true, firma: null, total: 1, respondidas: 1, respuestas: [respuesta(31)] }],
    equipos: [],
    solicitudes: [
      {
        id: 60, numero: 'SOL-000060', orden_id: 5, orden: 'REP-000005', sucursal: 'CENTRAL', solicitante: 'ANA', estado: 'no_despachada',
        lineas: [{ id: 70, material_id: 8, codigo: 'ACE-1', nombre: 'ACEITE', unidad: 'LT', cantidad_solicitada: 4, cantidad_despachada: 0, pendiente: 4, por_bodega: [{ bodega_id: 1, bodega: 'PRINCIPAL', cantidad: 10 }, { bodega_id: 2, bodega: 'REPUESTOS', cantidad: 1 }] }],
      },
    ],
    catalogos: {
      estados_orden: [
        { id: 1, codigo: 'RECIBIDO', nombre: 'RECIBIDO', es_inicial: 1, es_terminal: 0, es_cancelado: 0, sale_equipo: 0 },
        { id: 4, codigo: 'ENTREGADO', nombre: 'ENTREGADO', es_inicial: 0, es_terminal: 1, es_cancelado: 0, sale_equipo: 1 },
      ],
    },
    archivos: [],
    incompleto: [],
  }) as unknown as MiDia;

async function montar(alTerminar?: () => Promise<void>) {
  const servidor = new ServidorFalso();
  servidor.en('POST', '/auth/ingresar-movil', ok({ token: 't'.repeat(64), vence_en: '2026-12-01T23:00:00Z', refresco: 'r'.repeat(64), refresco_vence_en: '2027-01-30T15:00:00Z' }));
  servidor.en('GET', '/auth/yo', ok({ usuario: { id: 9, nombre: 'LUCIA' }, permisos: [] }));
  const reloj = new RelojFalso();
  const gestor = new GestorDeSesion({ baseUrl: servidor.baseUrl, taller: 'miTaller', fetch: servidor.fetch, seguro: new SeguroEnMemoria(), reloj, telefono: async () => TEL, limiteMs: 200 });
  await gestor.ingresar('lucia@taller.test', 'x', false);
  servidor.llamadas = [];
  const cliente = new ClienteApi({ baseUrl: servidor.baseUrl, taller: 'miTaller', fetch: servidor.fetch, sesion: gestor, limiteMs: 200 });
  const archivos = new ArchivosEnMemoria();
  const almacen = new AlmacenEnMemoria();
  const cola = new Cola(almacen, ESPACIO, generadorDeIds('c'), reloj);
  const sincronizador = new Sincronizador({ cola, cliente, archivos, reloj, alTerminar });
  const fotos = new Fotos({ almacen, archivos, imagenes: new ImagenesFalsas(archivos), espacio: ESPACIO });
  const dia = new Dia({ almacen, espacio: ESPACIO, cliente, archivos, cola, reloj, aplicarCambio });
  const acciones = new Acciones({ cola, sincronizador, fotos });
  const enLinea = new EnLinea({ cliente, dia });
  servidor.en('GET', '/movil/mi-dia', ok(diaDeRecepcion()));
  await dia.descargar();
  servidor.llamadas = [];
  return { servidor, cola, dia, acciones, sincronizador, enLinea };
}
const FIRMA = firmaEnBase64([[{ x: 10, y: 10 }, { x: 150, y: 80 }]], 200, 100);

describe('la firma del cliente en el checklist', () => {
  it('se guarda en el teléfono al instante, sin señal; sale ANTES de completar y completar espera a la firma', async () => {
    const m = await montar();
    m.servidor.en('POST', /.*/, 'sin_senal');
    await m.acciones.firmarChecklist(21, '  Juan Pérez ', FIRMA);
    await m.acciones.completarChecklist(21, null, 'Recepción');
    const v = (await m.dia.ver())!.datos.checklists[0]!;
    expect(v.firma_local).toEqual({ nombre: 'Juan Pérez' });
    expect(v.estado).toBe('completado');
    // Con señal: primero la firma (con su imagen), después completar.
    m.servidor.vaciar();
    m.servidor.en('POST', '/checklists/21/firma', ok({})).en('POST', '/checklists/21/completar', ok({}));
    await m.sincronizador.sincronizar();
    expect(m.servidor.llamadas.map((l) => l.ruta)).toEqual(['/checklists/21/firma', '/checklists/21/completar']);
    expect(m.servidor.llamadas[0]!.cuerpo).toEqual({ nombre: 'Juan Pérez', imagen: FIRMA });
    expect(await m.cola.todos()).toEqual([]);
  });

  it('si el servidor rechaza la firma, completar NO se manda y la persona ve el motivo', async () => {
    const m = await montar();
    m.servidor.en('POST', '/checklists/21/firma', mal(409, 'REGLA', 'Este tipo de checklist no lleva firma del cliente.')).en('POST', '/checklists/21/completar', ok({}));
    await m.acciones.firmarChecklist(21, 'Juan Pérez', FIRMA);
    await m.acciones.completarChecklist(21, null, 'Recepción');
    await m.sincronizador.sincronizar();
    expect(m.servidor.llamadas.map((l) => l.ruta)).toEqual(['/checklists/21/firma']);
    const todos = await m.cola.todos();
    expect(todos.map((c) => c.estado)).toEqual(['rechazado', 'rechazado']);
    expect(todos[0]!.motivo).toContain('no lleva firma');
  });

  it('no se puede completar sin firma si el tipo la pide; con la firma (aunque sea del teléfono) sí', async () => {
    const m = await montar();
    m.servidor.en('POST', /.*/, 'sin_senal');
    const antes = (await m.dia.ver())!.datos.checklists[0]!;
    expect(problemasParaCompletar(antes, null)).toEqual(['Falta la firma del cliente.']);
    await m.acciones.firmarChecklist(21, 'Juan Pérez', FIRMA);
    expect(problemasParaCompletar((await m.dia.ver())!.datos.checklists[0]!, null)).toEqual([]);
    // Si el servidor ya la tiene, tampoco se pide otra vez.
    expect(problemasParaCompletar({ ...antes, firma: { firmante_nombre: 'JUAN PEREZ' } }, null)).toEqual([]);
  });

  it('exige el nombre completo de quien firma y no guarda nada si falta', async () => {
    const m = await montar();
    await expect(m.acciones.firmarChecklist(21, ' Jo ', FIRMA)).rejects.toThrow('nombre completo');
    expect(await m.cola.todos()).toEqual([]);
  });
});

describe('entregar el equipo', () => {
  it('el cambio de estado se ve al instante (el equipo ya no está en el taller) y se envía con su identificador; no se duplica al reenviar', async () => {
    const m = await montar();
    m.servidor.en('POST', '/ordenes/5/estado', 'sin_senal');
    await m.acciones.entregarOrden(5, 4, 'REP-000005', 'ENTREGADO');
    const v = (await m.dia.ver())!.datos;
    expect(v.ordenes[0]).toMatchObject({ estado: 'ENTREGADO', estado_id: 4, es_terminal: 1, equipo_en_taller: 0 });
    expect(v.ordenes_abiertas![0]).toMatchObject({ estado: 'ENTREGADO' });
    m.servidor.vaciar();
    m.servidor.en('POST', '/ordenes/5/estado', ok({}));
    await m.sincronizador.sincronizar();
    expect(m.servidor.llamadas).toHaveLength(1);
    expect(m.servidor.llamadas[0]).toMatchObject({ ruta: '/ordenes/5/estado', cuerpo: { estado_id: 4 } });
    expect(m.servidor.llamadas[0]!.cabeceras['X-Id-Cliente']).toMatch(/^c-/);
  });

  it('si el servidor no lo permite (quedan trabajos sin terminar), queda a la vista con el motivo y NO se reintenta solo', async () => {
    const m = await montar();
    m.servidor.en('POST', '/ordenes/5/estado', mal(409, 'REGLA', 'La orden tiene trabajos sin terminar.'));
    await m.acciones.entregarOrden(5, 4, 'REP-000005', 'ENTREGADO');
    await m.sincronizador.sincronizar();
    await m.sincronizador.sincronizar();
    expect(m.servidor.llamadas).toHaveLength(1);
    const [c] = await m.cola.todos();
    expect(c).toMatchObject({ estado: 'rechazado', motivo: 'La orden tiene trabajos sin terminar.' });
  });

  it('un estado que no está en los catálogos no cambia nada en pantalla (no se inventa)', async () => {
    const m = await montar();
    m.servidor.en('POST', '/ordenes/5/estado', 'sin_senal');
    await m.acciones.entregarOrden(5, 99, 'REP-000005', 'FANTASMA');
    expect((await m.dia.ver())!.datos.ordenes[0]).toMatchObject({ estado: 'RECIBIDO' });
  });
});

describe('despachar desde la bodega', () => {
  it('descuenta de lo que se ve (pendiente y existencia de la bodega elegida) y sale con lo elegido; sin señal queda a salvo', async () => {
    const m = await montar();
    m.servidor.en('POST', '/solicitudes/60/despachar', 'sin_senal');
    await m.acciones.despachar(60, [{ linea_id: 70, bodega_id: 1, cantidad: 3 }], 'SOL-000060');
    const s = (await m.dia.ver())!.datos.solicitudes![0]!;
    expect(s.estado).toBe('despachada_parcial');
    expect(s.lineas[0]).toMatchObject({ cantidad_despachada: 3, pendiente: 1 });
    expect(s.lineas[0]!.por_bodega).toEqual([{ bodega_id: 1, bodega: 'PRINCIPAL', cantidad: 7 }, { bodega_id: 2, bodega: 'REPUESTOS', cantidad: 1 }]);
    m.servidor.vaciar();
    m.servidor.en('POST', '/solicitudes/60/despachar', ok({}));
    await m.sincronizador.sincronizar();
    expect(m.servidor.llamadas[0]).toMatchObject({ ruta: '/solicitudes/60/despachar', cuerpo: { items: [{ linea_id: 70, bodega_id: 1, cantidad: 3 }] } });
  });

  it('al despachar todo, la solicitud se ve como despachada', async () => {
    const m = await montar();
    m.servidor.en('POST', /.*/, 'sin_senal');
    await m.acciones.despachar(60, [{ linea_id: 70, bodega_id: 1, cantidad: 4 }]);
    expect((await m.dia.ver())!.datos.solicitudes![0]).toMatchObject({ estado: 'despachada' });
  });
});

describe('lo que necesita señal (recibir, iniciar checklist, cotizar)', () => {
  it('recibir una cita crea la orden en el servidor y vuelve a bajar el día', async () => {
    const m = await montar();
    m.servidor.en('POST', '/citas/3/recibir', ok({ orden_id: 8, numero: 'REP-000008', cita: {} }, 201));
    const r = await m.enLinea.recibirCita(3, { descripcion: 'RUIDO EN FRENOS', lectura: { contador_id: 41, valor: 1500 } });
    expect(r).toMatchObject({ orden_id: 8, numero: 'REP-000008', diaActualizado: true });
    expect(m.servidor.llamadas.map((l) => `${l.metodo} ${l.ruta}`)).toEqual(['POST /citas/3/recibir', 'GET /movil/mi-dia']);
    expect(m.servidor.llamadas[0]!.cuerpo).toEqual({ descripcion: 'RUIDO EN FRENOS', lectura: { contador_id: 41, valor: 1500 } });
  });

  it('sin señal NO queda nada en la cola y el mensaje dice que no se guardó (no «se enviará solo»)', async () => {
    const m = await montar();
    m.servidor.en('POST', '/citas/3/recibir', 'sin_senal');
    const e = await m.enLinea.recibirCita(3, {}).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErrorDeRed);
    expect((e as Error).message).toContain('No quedó guardado');
    expect(await m.cola.todos()).toEqual([]);
  });

  it('si la orden se creó pero no se pudo bajar el día, igual se dice que se creó', async () => {
    const m = await montar();
    m.servidor.en('POST', '/ordenes/5/checklists', ok({ id: 22 }, 201));
    m.servidor.en('GET', '/movil/mi-dia', 'sin_senal');
    const r = await m.enLinea.iniciarChecklist(5, 2);
    expect(r).toEqual({ id: 22, diaActualizado: false });
    expect(m.servidor.llamadas[0]!.cuerpo).toEqual({ tipo_id: 2 });
  });

  it('cotizar los rojos: un rechazo del servidor llega tal cual a la pantalla', async () => {
    const m = await montar();
    m.servidor.en('POST', '/cotizaciones/desde-checklist', mal(409, 'SIN_ROJOS', 'Ese checklist no tiene ítems en rojo que cotizar.'));
    await expect(m.enLinea.cotizarRojos(21)).rejects.toThrow('no tiene ítems en rojo');
    m.servidor.en('POST', '/cotizaciones/desde-checklist', ok({ id: 4, numero: 'COT-000004' }, 201));
    expect(await m.enLinea.cotizarRojos(21)).toEqual({ id: 4, numero: 'COT-000004' });
  });
});

describe('el menú de la recepción', () => {
  it('la pantalla de recepción sale solo con permiso de crear órdenes', () => {
    expect(pantallasPara(['ordenes.crear', 'citas.ver']).map((p) => p.id)).toEqual(expect.arrayContaining(['recepcion', 'citas']));
    expect(pantallasPara(['citas.ver']).map((p) => p.id)).not.toContain('recepcion');
  });
});

describe('enviar cambios', () => {
  it('un cambio que se hace mientras otro se está enviando sale en la misma tanda, sin esperar al siguiente aviso del reloj', async () => {
    const m = await montar();
    let soltar: () => void = () => undefined;
    const compuerta = new Promise<void>((r) => (soltar = r));
    m.servidor.en('POST', '/lineas/1/estado', async () => {
      await compuerta; // el primer envío se queda esperando a la red
      return ok({});
    });
    m.servidor.en('POST', '/lineas/2/estado', ok({}));
    await m.acciones.cambiarEstadoTrabajo(1, 'en_proceso', 'Iniciar 1');
    await new Promise((r) => setTimeout(r, 20)); // el envío del primero ya empezó
    await m.acciones.cambiarEstadoTrabajo(2, 'en_proceso', 'Iniciar 2');
    const pasada = m.sincronizador.sincronizar();
    soltar();
    const r = await pasada;
    expect(r).toMatchObject({ enviados: 2, detenidoPor: null });
    expect(m.servidor.llamadas.map((l) => l.ruta)).toEqual(['/lineas/1/estado', '/lineas/2/estado']);
    expect(await m.cola.todos()).toEqual([]);
  });
  it('al terminar una tanda en la que algo salió, la app vuelve a bajar el día (lo completado deja de verse «por llenar»); si no salió nada, no baja nada', async () => {
    let bajadas = 0;
    const m = await montar(async () => void (bajadas += 1));
    await m.sincronizador.sincronizar(); // la cola está vacía
    expect(bajadas).toBe(0);
    m.servidor.en('POST', '/lineas/1/estado', ok({}));
    await m.acciones.cambiarEstadoTrabajo(1, 'en_proceso', 'Iniciar 1');
    await m.sincronizador.sincronizar();
    expect(bajadas).toBeGreaterThanOrEqual(1);
    const antes = bajadas;
    m.servidor.en('POST', '/lineas/2/estado', 'sin_senal');
    await m.acciones.cambiarEstadoTrabajo(2, 'en_proceso', 'Iniciar 2');
    await m.sincronizador.sincronizar(); // sin señal: nada salió
    expect(bajadas).toBe(antes);
  });

  it('una falla al bajar el día no rompe el envío', async () => {
    const m = await montar(async () => {
      throw new Error('sin señal para bajar');
    });
    m.servidor.en('POST', '/lineas/1/estado', ok({}));
    await m.acciones.cambiarEstadoTrabajo(1, 'en_proceso', 'Iniciar 1');
    await expect(m.sincronizador.sincronizar()).resolves.toMatchObject({ enviados: 1 });
  });

  it('las pantallas se enteran cuando el día se vuelve a guardar', async () => {
    const m = await montar();
    let avisos = 0;
    const quitar = m.dia.escuchar(() => void (avisos += 1));
    await m.dia.descargar();
    expect(avisos).toBe(1);
    quitar();
    await m.dia.descargar();
    expect(avisos).toBe(1);
  });
});
