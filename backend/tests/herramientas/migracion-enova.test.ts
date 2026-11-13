import { join } from 'path';
import { Api, cargarTablas, leerTsv, migrarEnova, norma, resumen } from '../../src/herramientas/migracion-enova';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { tallerDePrueba } from '../taller/ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});

const CARPETA = join(__dirname, 'enova-anonimo');

/** La API del taller de pruebas (la misma que usaría el traslado de verdad, por HTTP). */
async function apiDelTaller() {
  const t = await tallerDePrueba(e);
  const agente = t.api(await t.token());
  const api: Api = {
    async llamar(metodo, ruta, cuerpo) {
      const pedido = metodo === 'GET' ? agente.get(ruta) : metodo === 'POST' ? agente.post(ruta) : metodo === 'PUT' ? agente.put(ruta) : agente.patch(ruta);
      const r = cuerpo === undefined ? await pedido : await pedido.send(cuerpo as object);
      return { status: r.status, body: r.body as never };
    },
  };
  return { t, api, agente };
}

describe('lectura de las tablas bajadas', () => {
  it('entiende el formato de mysql (NULL, tabuladores y saltos de línea escapados)', () => {
    const filas = leerTsv('a\tb\tc\n1\tNULL\tlínea 1\\nlínea 2\\ty tab\n2\tx\ty\\\\z\n');
    expect(filas).toEqual([
      { a: '1', b: null, c: 'línea 1\nlínea 2\ty tab' },
      { a: '2', b: 'x', c: 'y\\z' },
    ]);
    expect(norma('  Átomo   Ñandú ')).toBe('ATOMO NANDU');
  });
});

describe('traslado de enova (con la copia anónima de sus datos)', () => {
  it('el ensayo no escribe NADA y dice lo que haría', async () => {
    const { api, agente } = await apiDelTaller();
    const antes = JSON.stringify([(await agente.get('/clientes')).body.data, (await agente.get('/equipos')).body.data, (await agente.get('/materiales')).body.data]);
    const informe = await migrarEnova(api, cargarTablas(CARPETA), { simular: true });
    expect(informe.simulado).toBe(true);
    expect(informe.pasos.find((p) => p.entidad === 'Equipos')).toMatchObject({ origen: 5, creados: 5 });
    expect(informe.pasos.find((p) => p.entidad === 'Clientes')).toMatchObject({ origen: 1, creados: 1 });
    const despues = JSON.stringify([(await agente.get('/clientes')).body.data, (await agente.get('/equipos')).body.data, (await agente.get('/materiales')).body.data]);
    expect(despues).toBe(antes);
  }, 120000);

  it('traslada todo, las cifras de control coinciden y repetirlo NO duplica nada', async () => {
    const { api, agente } = await apiDelTaller();
    const tablas = cargarTablas(CARPETA);
    const informe = await migrarEnova(api, tablas);
    const malas = informe.control.filter((x) => !x.coincide);
    expect(malas).toEqual([]);
    expect(informe.control.length).toBeGreaterThanOrEqual(11); // 6 conteos + 5 medidores
    // Lo esencial quedó en el sistema nuevo.
    const clientes = (await agente.get('/clientes')).body.data.registros as Array<{ id: number; nombre: string }>;
    expect(clientes.map((c) => c.nombre)).toEqual(['CLIENTE DE PRUEBA S.A.']);
    const ficha = (await agente.get(`/clientes/${clientes[0]!.id}`)).body.data as { departamentos: Array<{ nombre: string }> };
    expect(ficha.departamentos.map((d) => d.nombre).sort()).toEqual(['SEDE 1', 'SEDE 2', 'SEDE 3', 'SEDE 4', 'SEDE 5']);
    const equipos = (await agente.get('/equipos')).body.data.registros as Array<{ codigo_interno: string }>;
    expect(equipos).toHaveLength(5);
    // El medidor de un equipo con lectura posterior quedó en el valor actual del sistema viejo (1 hora) y otro con valor inicial 14,2.
    const horas = informe.control.filter((x) => x.concepto.startsWith('Medidor') && x.origen === 1);
    expect(horas).toHaveLength(1);
    const catorce = informe.control.find((x) => x.origen === 14.2);
    expect(catorce?.destino).toBe(14.2);
    // Los trabajos quedaron con sus horas por tipo de equipo (0,16 h) y la orden con su línea (100 × 0,16 h × tarifa 50 = 800).
    const ordenes = (await agente.get('/ordenes?abiertas=true')).body.data.registros as Array<{ id: number }>;
    expect(ordenes).toHaveLength(1);
    const orden = (await agente.get(`/ordenes/${ordenes[0]!.id}`)).body.data as { lineas: Array<{ horas_trabajo: number; total_linea: number }>; subtotal: number; total: number };
    expect(orden.lineas).toHaveLength(1);
    expect(Number(orden.lineas[0]!.horas_trabajo)).toBe(16); // 100 piezas × 0,16 h
    expect(Number(orden.subtotal)).toBe(800); // el mismo valor que tenía en el sistema anterior (100 × Q8); el IVA lo suma el sistema nuevo según su configuración
    // Los 3 equipos con operador asignado en el sistema anterior lo tienen también aquí.
    const conOperador = [];
    for (const eq of (await agente.get('/equipos')).body.data.registros as Array<{ id: number }>) {
      const ficha = (await agente.get(`/equipos/${eq.id}`)).body.data as { operadores?: Array<{ colaborador_id: number }> };
      if ((ficha.operadores ?? []).length > 0) conOperador.push(eq.id);
    }
    expect(conOperador).toHaveLength(3);
    // El checklist propio de sus equipos llegó con sus 10 puntos agrupados por sección y ligado al tipo de equipo.
    const tiposChk = (await agente.get('/checklists-tipos')).body.data as Array<{ id: number; nombre: string }>;
    const mecanica = tiposChk.find((x) => x.nombre.includes('REVISION PREOPERACIONAL'));
    expect(mecanica).toBeDefined();
    const plantilla = (await agente.get(`/checklists-tipos/${mecanica!.id}/plantilla`)).body.data as { secciones: Array<{ nombre: string; items: unknown[] }> };
    expect(plantilla.secciones.reduce((n, x) => n + x.items.length, 0)).toBe(10);
    expect(plantilla.secciones.map((x) => x.nombre)).toContain('SISTEMA HIDRAULICO');
    // La matriz «nivel de técnico × sistema» del sistema anterior: el nivel 4 solo trabaja en TRABAJOS (y en los sistemas de fábrica del nuevo).
    const matriz = (await agente.get('/catalogos/matriz-tecnico-sistema')).body.data as { niveles: Array<{ id: number; codigo: string }>; sistemas: Array<{ id: number; nombre: string }>; habilitadas: Array<{ nivel_tecnico_id: number; sistema_id: number }> };
    const nivel4 = matriz.niveles.find((n) => n.codigo === 'N4')!;
    const deNivel4 = matriz.habilitadas.filter((h) => h.nivel_tecnico_id === nivel4.id).map((h) => matriz.sistemas.find((x) => x.id === h.sistema_id)?.nombre);
    expect(deNivel4).toContain('TRABAJOS');
    expect(deNivel4).not.toContain('MOTOR');
    expect(deNivel4).not.toContain('FRENOS'); // los sistemas de fábrica del sistema nuevo (servicios programados, insumos) quedan como nacen
    // Segunda corrida: nada se crea de nuevo.
    const otra = await migrarEnova(api, tablas);
    expect(otra.pasos.filter((p) => p.creados > 0 && p.entidad !== 'Lecturas').map((p) => p.entidad)).toEqual([]);
    expect(otra.control.filter((x) => !x.coincide)).toEqual([]);
    expect(((await agente.get('/clientes')).body.data.registros as unknown[]).length).toBe(1);
    expect(((await agente.get('/equipos')).body.data.registros as unknown[]).length).toBe(5);
    expect(resumen(informe)).toContain('CONTROL DE CIFRAS');
  }, 300000);
});

// Ensayo local con los datos REALES (no están en el repositorio): ENOVA_DATOS=C:/GUATECH/MIGRACION_ENOVA/datos npx jest migracion-enova
const REALES = process.env['ENOVA_DATOS'];
(REALES ? describe : describe.skip)('traslado de enova con los datos reales (ensayo local)', () => {
  it('corre completo en un taller de pruebas y muestra el informe', async () => {
    const { api } = await apiDelTaller();
    const informe = await migrarEnova(api, cargarTablas(REALES!));
    console.log(resumen(informe));
    expect(informe.control.filter((x) => !x.coincide)).toEqual([]);
  }, 300000);
});
