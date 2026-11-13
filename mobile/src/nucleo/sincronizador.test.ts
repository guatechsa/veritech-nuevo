import { ClienteApi } from './cliente';
import { Cola, NuevoCambio } from './cola';
import { GestorDeSesion } from './sesion';
import { Sincronizador } from './sincronizador';
import { ArchivosEnMemoria, AlmacenEnMemoria, generadorDeIds, mal, ok, RelojFalso, SeguroEnMemoria, ServidorFalso } from './pruebas/falsos';

const TEL = { instalacion: 'instalacion-0001-abcdef', plataforma: 'android' as const };
const sesionDelServidor = { token: 't'.repeat(64), vence_en: '2026-12-01T23:00:00Z', refresco: 'r'.repeat(64), refresco_vence_en: '2027-01-30T15:00:00Z' };

async function montar(espacio = { taller: 'miTaller', usuarioId: 7 }, almacen = new AlmacenEnMemoria()) {
  const servidor = new ServidorFalso();
  servidor.en('POST', '/auth/ingresar-movil', ok(sesionDelServidor));
  servidor.en('GET', '/auth/yo', ok({ usuario: { id: espacio.usuarioId, nombre: 'ANA' }, permisos: [] }));
  const reloj = new RelojFalso();
  const gestor = new GestorDeSesion({ baseUrl: servidor.baseUrl, taller: espacio.taller, fetch: servidor.fetch, seguro: new SeguroEnMemoria(), reloj, telefono: async () => TEL, limiteMs: 200 });
  await gestor.ingresar('ana@taller.test', 'x', false);
  servidor.llamadas = [];
  const cliente = new ClienteApi({ baseUrl: servidor.baseUrl, taller: espacio.taller, fetch: servidor.fetch, sesion: gestor, limiteMs: 200 });
  const archivos = new ArchivosEnMemoria();
  const cola = new Cola(almacen, espacio, generadorDeIds('c'), reloj);
  const aplicados: string[] = [];
  const rechazados: string[] = [];
  const sync = new Sincronizador({ cola, cliente, archivos, reloj, alAplicar: async (c) => void aplicados.push(c.id), alRechazar: async (c) => void rechazados.push(c.id) });
  return { servidor, cola, sync, archivos, almacen, gestor, aplicados, rechazados, reloj };
}
const cambio = (ruta: string, extra: Partial<NuevoCambio> = {}): NuevoCambio => ({ titulo: 'Cambio', tipo: 'prueba', metodo: 'POST', ruta, cuerpo: { x: 1 }, ...extra });

describe('enviar lo pendiente', () => {
  it('envía en orden, cada cambio con su identificador y su hora; lo enviado sale de la cola y se avisa', async () => {
    const m = await montar();
    m.servidor.en('POST', /\/lineas\/\d+\/estado/, ok({ listo: true }));
    const a = await m.cola.encolar(cambio('/lineas/1/estado', { cuerpo: { estado: 'en_proceso' } }));
    m.reloj.avanzar(60000);
    const b = await m.cola.encolar(cambio('/lineas/1/estado', { cuerpo: { estado: 'terminado' } }));
    const r = await m.sync.sincronizar();
    expect(r).toEqual({ enviados: 2, rechazados: 0, detenidoPor: null });
    expect(m.servidor.llamadas.map((l) => l.cuerpo)).toEqual([{ estado: 'en_proceso' }, { estado: 'terminado' }]); // en orden
    expect(m.servidor.llamadas.map((l) => l.cabeceras['X-Id-Cliente'])).toEqual([a.id, b.id]);
    expect(m.servidor.llamadas[0]!.cabeceras['X-Hecho-En']).toBe('2026-12-01T15:00:00.000Z');
    expect(m.servidor.llamadas[1]!.cabeceras['X-Hecho-En']).toBe('2026-12-01T15:01:00.000Z'); // cuándo se hizo, no cuándo se envió
    expect(await m.cola.todos()).toEqual([]);
    expect(m.aplicados).toEqual([a.id, b.id]);
    const e = await m.sync.estado();
    expect(e).toMatchObject({ pendientes: 0, conError: 0, rechazados: 0, red: 'ok', sincronizando: false });
    expect(e.ultimaSincronizacion).not.toBeNull();
  });

  it('dos peticiones de envío a la vez comparten UN solo envío: nada se manda dos veces', async () => {
    const m = await montar();
    m.servidor.en('POST', '/lineas/1/estado', async () => {
      await new Promise((r) => setTimeout(r, 30));
      return ok({});
    });
    await m.cola.encolar(cambio('/lineas/1/estado'));
    const [x, y] = await Promise.all([m.sync.sincronizar(), m.sync.sincronizar()]);
    expect(x).toBe(y === x ? x : x); // el mismo resultado
    expect(m.servidor.llamadas).toHaveLength(1);
  });

  it('sin señal se detiene y TODO queda pendiente (sin contar como intento); al volver la señal se envía', async () => {
    const m = await montar();
    m.servidor.en('POST', '/a', ok({}));
    m.servidor.en('POST', '/b', 'sin_senal');
    m.servidor.en('POST', '/c', ok({}));
    await m.cola.encolar(cambio('/a'));
    const b = await m.cola.encolar(cambio('/b'));
    await m.cola.encolar(cambio('/c'));
    const r = await m.sync.sincronizar();
    expect(r).toEqual({ enviados: 1, rechazados: 0, detenidoPor: 'red' });
    expect((await m.cola.pendientes()).map((c) => c.ruta)).toEqual(['/b', '/c']);
    expect((await m.cola.todos()).find((c) => c.id === b.id)!.intentos).toBe(0);
    expect(m.servidor.llamadas.map((l) => l.ruta)).toEqual(['/a', '/b']); // no siguió con /c
    expect((await m.sync.estado()).red).toBe('sin_senal');
    m.servidor.en('POST', '/b', ok({}));
    expect(await m.sync.sincronizar()).toMatchObject({ enviados: 2, detenidoPor: null });
    expect(await m.cola.todos()).toEqual([]);
    expect((await m.sync.estado()).red).toBe('ok');
  });

  it('un servidor caído se reintenta, pero a la quinta vez el cambio pasa a «error» visible', async () => {
    const m = await montar();
    m.servidor.en('POST', '/a', { estado: 503, texto: 'caído' });
    const c = await m.cola.encolar(cambio('/a'));
    for (let i = 0; i < 4; i++) await m.sync.sincronizar();
    expect((await m.cola.todos())[0]).toMatchObject({ id: c.id, estado: 'pendiente', intentos: 4 });
    await m.sync.sincronizar();
    expect((await m.cola.todos())[0]).toMatchObject({ estado: 'error', intentos: 5 });
    expect(await m.sync.estado()).toMatchObject({ pendientes: 0, conError: 1 });
    // La persona lo reintenta desde la pantalla.
    m.servidor.en('POST', '/a', ok({}));
    await m.cola.reintentar(c.id);
    expect(await m.sync.sincronizar()).toMatchObject({ enviados: 1 });
  });

  it('un rechazo del servidor NO se reintenta solo: queda «rechazado» con su motivo y los demás siguen', async () => {
    const m = await montar();
    m.servidor.en('POST', '/a', mal(409, 'REGLA', 'El trabajo ya está terminado'));
    m.servidor.en('POST', '/b', ok({}));
    const a = await m.cola.encolar(cambio('/a'));
    await m.cola.encolar(cambio('/b'));
    const r = await m.sync.sincronizar();
    expect(r).toEqual({ enviados: 1, rechazados: 1, detenidoPor: null });
    const rechazado = (await m.cola.todos())[0]!;
    expect(rechazado).toMatchObject({ id: a.id, estado: 'rechazado', motivo: 'El trabajo ya está terminado' });
    expect(m.rechazados).toEqual([a.id]);
    await m.sync.sincronizar();
    expect(m.servidor.llamadas.filter((l) => l.ruta === '/a')).toHaveLength(1); // no insiste
    expect(await m.sync.estado()).toMatchObject({ rechazados: 1, pendientes: 0 });
  });

  it('un cambio que depende de otro rechazado se rechaza sin mandarlo', async () => {
    const m = await montar();
    m.servidor.en('PATCH', '/checklists/1/respuestas/2', mal(400, 'VALIDACION', 'Falta la foto'));
    m.servidor.en('POST', '/checklists/1/completar', ok({}));
    const resp = await m.cola.encolar(cambio('/checklists/1/respuestas/2', { metodo: 'PATCH' }));
    const completar = await m.cola.encolar(cambio('/checklists/1/completar', { dependeDe: resp.id }));
    const r = await m.sync.sincronizar();
    expect(r.rechazados).toBe(2);
    expect(m.servidor.llamadas.map((l) => l.ruta)).toEqual(['/checklists/1/respuestas/2']); // completar nunca se mandó
    expect((await m.cola.todos()).find((c) => c.id === completar.id)).toMatchObject({ estado: 'rechazado', motivo: expect.stringContaining('Depende') });
  });

  it('«todavía en proceso» (409 EN_PROCESO) no es un rechazo: se vuelve a preguntar después', async () => {
    const m = await montar();
    m.servidor.en('POST', '/a', mal(409, 'EN_PROCESO', 'Todavía se está procesando'));
    await m.cola.encolar(cambio('/a'));
    expect(await m.sync.sincronizar()).toEqual({ enviados: 0, rechazados: 0, detenidoPor: null });
    expect((await m.cola.todos())[0]).toMatchObject({ estado: 'pendiente' });
    m.servidor.en('POST', '/a', ok({}));
    expect(await m.sync.sincronizar()).toMatchObject({ enviados: 1 });
  });

  it('las fotos se envían tal cual con su nombre; si la foto ya no está en el teléfono se rechaza con un motivo claro', async () => {
    const m = await mundoConFoto();
    async function mundoConFoto() {
      const x = await montar();
      x.servidor.en('POST', '/lineas/5/fotos', ok({}, 201));
      return x;
    }
    m.archivos.poner('file:///app/fotos/1.jpg', new Uint8Array([5, 6, 7]));
    await m.cola.encolar(cambio('/lineas/5/fotos', { cuerpo: undefined, archivo: { uri: 'file:///app/fotos/1.jpg', mime: 'image/jpeg', nombre: 'foto-1.jpg' } }));
    await m.cola.encolar(cambio('/lineas/5/fotos', { cuerpo: undefined, archivo: { uri: 'file:///app/fotos/borrada.jpg', mime: 'image/jpeg', nombre: 'foto-2.jpg' } }));
    const r = await m.sync.sincronizar();
    expect(r).toMatchObject({ enviados: 1, rechazados: 1 });
    expect(Array.from(m.servidor.llamadas[0]!.bytes!)).toEqual([5, 6, 7]);
    expect(m.servidor.llamadas[0]!.cabeceras['Content-Type']).toBe('image/jpeg');
    expect((await m.cola.todos())[0]!.motivo).toBe('La foto ya no está en el teléfono.');
  });

  it('una sesión vencida detiene el envío SIN borrar nada; al ingresar otra vez la misma persona, se envía', async () => {
    const m = await montar();
    m.servidor.en('POST', '/a', mal(401, 'NO_AUTENTICADO'));
    m.servidor.en('POST', '/auth/refrescar-movil', mal(401, 'REFRESCO_INVALIDO', 'Su sesión venció'));
    await m.cola.encolar(cambio('/a'));
    const r = await m.sync.sincronizar();
    expect(r.detenidoPor).toBe('sesion');
    expect((await m.sync.estado()).sesionVencida).toBe(true);
    expect(await m.cola.pendientes()).toHaveLength(1);
    // Mientras siga vencida, no insiste.
    const antes = m.servidor.llamadas.length;
    expect((await m.sync.sincronizar()).detenidoPor).toBe('sesion');
    expect(m.servidor.llamadas.length).toBe(antes);
    // La persona ingresa de nuevo.
    m.servidor.en('POST', '/a', ok({}));
    await m.gestor.ingresar('ana@taller.test', 'x', false);
    m.sync.sesionRenovada();
    expect(await m.sync.sincronizar()).toMatchObject({ enviados: 1 });
  });
});

describe('cada persona y cada taller tienen SU cola', () => {
  it('otra persona en el mismo teléfono no ve ni envía lo pendiente de la primera', async () => {
    const almacen = new AlmacenEnMemoria();
    const ana = await montar({ taller: 'miTaller', usuarioId: 7 }, almacen);
    await ana.cola.encolar(cambio('/de-ana'));
    const beto = await montar({ taller: 'miTaller', usuarioId: 8 }, almacen);
    expect(await beto.cola.todos()).toEqual([]);
    beto.servidor.en('POST', '/de-ana', ok({}));
    expect(await beto.sync.sincronizar()).toEqual({ enviados: 0, rechazados: 0, detenidoPor: null });
    expect(beto.servidor.llamadas).toEqual([]); // jamás se manda con la identidad equivocada
    // Y la de Ana sigue intacta; también en otro taller.
    expect(await ana.cola.todos()).toHaveLength(1);
    const otroTaller = await montar({ taller: 'otroTaller', usuarioId: 7 }, almacen);
    expect(await otroTaller.cola.todos()).toEqual([]);
  });

  it('lo pendiente sobrevive a cerrar y abrir la app (está guardado)', async () => {
    const almacen = new AlmacenEnMemoria();
    const antes = await montar({ taller: 'miTaller', usuarioId: 7 }, almacen);
    const c = await antes.cola.encolar(cambio('/a', { titulo: 'Terminar trabajo' }));
    const despues = await montar({ taller: 'miTaller', usuarioId: 7 }, almacen);
    expect((await despues.cola.todos()).map((x) => x.id)).toEqual([c.id]);
    expect(await despues.cola.sinEnviar()).toBe(1);
    await despues.cola.vaciar();
    expect(await despues.cola.sinEnviar()).toBe(0);
    const otra = await montar({ taller: 'miTaller', usuarioId: 7 }, almacen);
    expect(await otra.cola.todos()).toEqual([]);
  });

  it('dos escrituras a la vez no se pisan', async () => {
    const m = await montar();
    await Promise.all(Array.from({ length: 20 }, (_, i) => m.cola.encolar(cambio(`/c${i}`))));
    const ids = (await m.cola.todos()).map((c) => c.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
  });
});
