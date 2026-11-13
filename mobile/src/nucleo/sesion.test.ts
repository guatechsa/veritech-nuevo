import { ClienteApi } from './cliente';
import { ErrorDeRed, ErrorDelServidor, SesionVencida } from './errores';
import { GestorDeSesion } from './sesion';
import { mal, ok, RelojFalso, ServidorFalso, SeguroEnMemoria } from './pruebas/falsos';

const TEL = { instalacion: 'instalacion-0001-abcdef', plataforma: 'android' as const, nombre: 'Pixel', version_app: '2.0.0' };
const sesionDelServidor = { token: 't'.repeat(64), vence_en: '2026-12-01T23:00:00Z', refresco: 'r'.repeat(64), refresco_vence_en: '2027-01-30T15:00:00Z' };

function montar() {
  const servidor = new ServidorFalso();
  servidor.en('POST', '/auth/ingresar-movil', ok(sesionDelServidor));
  servidor.en('GET', '/auth/yo', ok({ usuario: { id: 7, nombre: 'ANA TECNICA' }, permisos: ['ordenes.trabajar', 'checklists.llenar'] }));
  const seguro = new SeguroEnMemoria();
  let vencidas = 0;
  const gestor = new GestorDeSesion({ baseUrl: servidor.baseUrl, taller: 'miTaller', fetch: servidor.fetch, seguro, reloj: new RelojFalso(), telefono: async () => TEL, limiteMs: 200, alVencer: () => (vencidas += 1) });
  const cliente = new ClienteApi({ baseUrl: servidor.baseUrl, taller: 'miTaller', fetch: servidor.fetch, sesion: gestor, limiteMs: 200 });
  return { servidor, seguro, gestor, cliente, vencidas: () => vencidas };
}

describe('entrar', () => {
  it('guarda las llaves en el almacén seguro (nunca la contraseña), el espacio de la persona y sus permisos', async () => {
    const { servidor, seguro, gestor } = montar();
    const s = await gestor.ingresar('  ana@taller.test ', 'Clave-Secreta-1', true);
    expect(s.espacio).toEqual({ taller: 'miTaller', usuarioId: 7 });
    expect(s.permisos).toContain('ordenes.trabajar');
    expect(await gestor.token()).toBe('t'.repeat(64));
    const guardado = [...seguro.datos.values()].join('|');
    expect(guardado).not.toContain('Clave-Secreta-1'); // la contraseña nunca se guarda
    expect(await gestor.correoRecordado()).toBe('ana@taller.test');
    // Lo que se mandó: correo sin espacios, el taller en la cabecera y los datos del teléfono.
    const primera = servidor.llamadas[0]!;
    expect(primera.cabeceras['X-Taller']).toBe('miTaller');
    expect(primera.cuerpo).toMatchObject({ correo: 'ana@taller.test', dispositivo: TEL });
    // Sin «recordar», el correo se olvida.
    await gestor.ingresar('ana@taller.test', 'Clave-Secreta-1', false);
    expect(await gestor.correoRecordado()).toBeNull();
  });

  it('una contraseña mala da el mensaje del servidor y no deja nada guardado; sin señal lo dice', async () => {
    const { servidor, gestor, seguro } = montar();
    servidor.en('POST', '/auth/ingresar-movil', mal(401, 'CREDENCIALES', 'Correo o contraseña incorrectos'));
    await expect(gestor.ingresar('ana@taller.test', 'mala', false)).rejects.toMatchObject({ estado: 401, message: 'Correo o contraseña incorrectos' });
    expect(await gestor.cargar()).toBeNull();
    expect(seguro.datos.size).toBe(0);
    servidor.en('POST', '/auth/ingresar-movil', 'sin_senal');
    await expect(gestor.ingresar('ana@taller.test', 'x', false)).rejects.toBeInstanceOf(ErrorDeRed);
  });

  it('al volver a abrir la app, la sesión sigue ahí', async () => {
    const { gestor, seguro, servidor } = montar();
    await gestor.ingresar('ana@taller.test', 'x', false);
    const otro = new GestorDeSesion({ baseUrl: servidor.baseUrl, taller: 'miTaller', fetch: servidor.fetch, seguro, reloj: new RelojFalso(), telefono: async () => TEL });
    expect((await otro.cargar())?.espacio.usuarioId).toBe(7);
    // Otro taller en el mismo teléfono tiene su propia sesión.
    const delOtroTaller = new GestorDeSesion({ baseUrl: servidor.baseUrl, taller: 'otroTaller', fetch: servidor.fetch, seguro, reloj: new RelojFalso(), telefono: async () => TEL });
    expect(await delOtroTaller.cargar()).toBeNull();
  });
});

describe('renovar la sesión', () => {
  const nueva = { token: 'n'.repeat(64), vence_en: '2026-12-02T07:00:00Z', refresco: 'm'.repeat(64), refresco_vence_en: '2027-01-31T15:00:00Z' };

  it('un token vencido se renueva UNA vez y la petición se reintenta sola', async () => {
    const { servidor, gestor, cliente } = montar();
    await gestor.ingresar('ana@taller.test', 'x', false);
    servidor.en('GET', '/movil/config', (l) => (l.cabeceras['Authorization'] === `Bearer ${'n'.repeat(64)}` ? ok({ version_minima: '2.0.0' }) : mal(401, 'NO_AUTENTICADO', 'Su sesión venció')));
    servidor.en('POST', '/auth/refrescar-movil', ok(nueva));
    expect(await cliente.get('/movil/config')).toEqual({ version_minima: '2.0.0' });
    expect(servidor.llamadas.filter((l) => l.ruta === '/auth/refrescar-movil')).toHaveLength(1);
    expect(servidor.llamadas.find((l) => l.ruta === '/auth/refrescar-movil')!.cuerpo).toEqual({ refresco: 'r'.repeat(64) });
    expect(await gestor.token()).toBe('n'.repeat(64));
    expect((await gestor.cargar())!.refresco).toBe('m'.repeat(64)); // el refresco también se cambió
  });

  it('varias peticiones a la vez comparten UNA sola renovación', async () => {
    const { servidor, gestor, cliente } = montar();
    await gestor.ingresar('ana@taller.test', 'x', false);
    servidor.en('GET', /\/movil\/.*/, (l) => (l.cabeceras['Authorization'] === `Bearer ${'n'.repeat(64)}` ? ok({ bien: true }) : mal(401, 'NO_AUTENTICADO')));
    servidor.en('POST', '/auth/refrescar-movil', async () => {
      await new Promise((r) => setTimeout(r, 30));
      return ok(nueva);
    });
    const r = await Promise.all([cliente.get('/movil/a'), cliente.get('/movil/b'), cliente.get('/movil/c')]);
    expect(r).toHaveLength(3);
    expect(servidor.llamadas.filter((l) => l.ruta === '/auth/refrescar-movil')).toHaveLength(1);
  });

  it('si no hay señal al renovar, la sesión NO se cierra y se conserva todo', async () => {
    const { servidor, gestor, cliente, vencidas } = montar();
    await gestor.ingresar('ana@taller.test', 'x', false);
    servidor.en('GET', '/movil/config', mal(401, 'NO_AUTENTICADO'));
    servidor.en('POST', '/auth/refrescar-movil', 'sin_senal');
    await expect(cliente.get('/movil/config')).rejects.toBeInstanceOf(ErrorDeRed);
    expect((await gestor.cargar())?.refresco).toBe('r'.repeat(64)); // sigue ahí
    expect(vencidas()).toBe(0);
    // Con un servidor caído (5xx) tampoco.
    servidor.en('POST', '/auth/refrescar-movil', { estado: 503, texto: '<html>Servicio no disponible</html>' });
    await expect(cliente.get('/movil/config')).rejects.toMatchObject({ tipo: 'servidor_caido' });
    expect(await gestor.cargar()).not.toBeNull();
    // Cuando vuelve la señal, funciona.
    servidor.en('POST', '/auth/refrescar-movil', ok(nueva));
    servidor.en('GET', '/movil/config', (l) => (l.cabeceras['Authorization'] === `Bearer ${'n'.repeat(64)}` ? ok({ listo: true }) : mal(401, 'NO_AUTENTICADO')));
    expect(await cliente.get('/movil/config')).toEqual({ listo: true });
  });

  it('si el servidor dice que el refresco ya no sirve, se borran las llaves y se avisa que hay que ingresar de nuevo', async () => {
    const { servidor, gestor, cliente, seguro, vencidas } = montar();
    await gestor.ingresar('ana@taller.test', 'x', true);
    servidor.en('GET', '/movil/config', mal(401, 'NO_AUTENTICADO'));
    servidor.en('POST', '/auth/refrescar-movil', mal(401, 'REFRESCO_REUTILIZADO', 'Por seguridad se cerró su sesión.'));
    await expect(cliente.get('/movil/config')).rejects.toBeInstanceOf(SesionVencida);
    expect(await gestor.cargar()).toBeNull();
    expect(vencidas()).toBe(1);
    expect(seguro.datos.has('sesion:miTaller')).toBe(false);
    expect(await gestor.correoRecordado()).toBe('ana@taller.test'); // el correo recordado sigue para facilitar el ingreso
    // Otro error del servidor al renovar (no 401) no cierra la sesión.
    await gestor.ingresar('ana@taller.test', 'x', true);
    servidor.en('POST', '/auth/refrescar-movil', mal(404, 'TALLER_NO_ENCONTRADO'));
    await expect(cliente.get('/movil/config')).rejects.toBeInstanceOf(ErrorDelServidor);
    expect(await gestor.cargar()).not.toBeNull();
  });

  it('salir borra las llaves aunque no haya señal para avisar al servidor', async () => {
    const { servidor, gestor } = montar();
    await gestor.ingresar('ana@taller.test', 'x', false);
    servidor.en('POST', '/auth/cerrar', 'sin_senal');
    await gestor.salir();
    expect(await gestor.cargar()).toBeNull();
    expect(await gestor.token()).toBeNull();
  });
});

describe('la red', () => {
  it('distingue sin señal, señal débil (no respondió a tiempo) y servidor caído; un rechazo es del servidor', async () => {
    const { servidor, cliente } = montar();
    servidor.en('GET', '/a', 'sin_senal');
    servidor.en('GET', '/b', 'colgar');
    servidor.en('GET', '/c', { estado: 502, texto: '<html>Bad gateway</html>' });
    servidor.en('GET', '/d', mal(409, 'REGLA', 'No se puede'));
    servidor.en('GET', '/e', { estado: 429, json: { success: false, codigo: 'DEMASIADOS_INTENTOS' } });
    await expect(cliente.get('/a')).rejects.toMatchObject({ tipo: 'sin_senal' });
    await expect(cliente.get('/b')).rejects.toMatchObject({ tipo: 'senal_debil' }); // el límite de 200 ms de la prueba
    await expect(cliente.get('/c')).rejects.toMatchObject({ tipo: 'servidor_caido' });
    await expect(cliente.get('/d')).rejects.toMatchObject({ estado: 409, codigo: 'REGLA', message: 'No se puede' });
    await expect(cliente.get('/e')).rejects.toMatchObject({ tipo: 'servidor_caido' });
  });

  it('manda el identificador del cambio, cuándo se hizo y las fotos tal cual', async () => {
    const { servidor, cliente } = montar();
    servidor.en('POST', '/lineas/5/fotos', ok({ listo: true }, 201));
    await cliente.solicitar('POST', '/lineas/5/fotos', { idCliente: 'cambio-000001-xxxx', hechoEn: new Date('2026-12-01T10:00:00Z'), binario: { bytes: new Uint8Array([1, 2]), mime: 'image/jpeg', nombre: 'foto ñ.jpg' } });
    const l = servidor.llamadas[0]!;
    expect(l.cabeceras['X-Id-Cliente']).toBe('cambio-000001-xxxx');
    expect(l.cabeceras['X-Hecho-En']).toBe('2026-12-01T10:00:00.000Z');
    expect(l.cabeceras['Content-Type']).toBe('image/jpeg');
    expect(decodeURIComponent(l.cabeceras['X-Nombre-Archivo']!)).toBe('foto ñ.jpg');
    expect(Array.from(l.bytes!)).toEqual([1, 2]);
  });
});
