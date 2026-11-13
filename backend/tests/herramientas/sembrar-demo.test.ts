import { Api } from '../../src/herramientas/migracion-enova';
import { sembrarDemo } from '../../src/herramientas/sembrar-demo';
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
  return { api, agente };
}

describe('datos de ejemplo del taller de demostración', () => {
  it('siembra un taller creíble: clientes, vehículos con odómetro, personal, bodega con existencias, órdenes en varios estados y citas', async () => {
    const { api, agente } = await apiDelTaller();
    const r = await sembrarDemo(api);
    expect(r).toMatchObject({ clientes: 4, equipos: 8, colaboradores: 5, materiales: 6, ordenes: 8, ordenesCerradas: 3, citas: 3 });
    expect(((await agente.get('/clientes')).body.data.registros as unknown[]).length).toBe(4);
    expect(((await agente.get('/equipos')).body.data.registros as unknown[]).length).toBe(8);
    const abiertas = (await agente.get('/ordenes?abiertas=true')).body.data.registros as unknown[];
    expect(abiertas).toHaveLength(5);
    const cerradas = (await agente.get('/ordenes?abiertas=false')).body.data;
    expect(cerradas.total).toBe(3);
    // El precio sale de las horas por la tarifa (1,2 h × Q120 = Q144 en las pastillas) y los materiales tienen existencias.
    const unaCerrada = (await agente.get(`/ordenes/${cerradas.registros[1].id}`)).body.data as { subtotal: number };
    expect(Number(unaCerrada.subtotal)).toBe(144);
    const materiales = (await agente.get('/materiales')).body.data.registros as Array<{ existencia_total?: number }>;
    expect(materiales).toHaveLength(6);
    expect(materiales.every((m) => Number(m.existencia_total) > 0)).toBe(true);
    // Todo es ficticio y está marcado.
    const clientes = (await agente.get('/clientes')).body.data.registros as Array<{ nombre: string }>;
    expect(clientes.every((c) => c.nombre.includes('(DEMO)'))).toBe(true);
  }, 300000);

  it('NO siembra encima de un taller que ya tiene clientes', async () => {
    const { api, agente } = await apiDelTaller();
    expect((await agente.post('/clientes').send({ nombre: 'Cliente real' })).status).toBe(201);
    await expect(sembrarDemo(api)).rejects.toThrow('ya tiene clientes');
    expect(((await agente.get('/equipos')).body.data.registros as unknown[]).length).toBe(0);
  });
});
