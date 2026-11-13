import express from 'express';
import request from 'supertest';
import { conIdentificador } from '../../src/taller/movil-idempotencia';
import { poolsDe } from '../../src/taller/contexto';
import { buscarEmpresa } from '../../src/taller/resolutor';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { tallerDePrueba } from './ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});

/** Una mini aplicación con el control de cambios con identificador y rutas que fallan a propósito. */
async function montar() {
  const t = await tallerDePrueba(e);
  const empresa = (await buscarEmpresa(e.ctx, t.slug))!;
  const pool = poolsDe(e.ctx).obtener(empresa.nombreBd);
  const usuarioId = (await t.sql(async (c) => (await c.query('SELECT id FROM usuarios LIMIT 1'))[0] as Array<{ id: number }>))[0]!.id;
  const llamadas = { falla: 0, archivo: 0 };
  const app = express();
  app.use(express.json());
  app.use((req, _res, siguiente) => {
    req.taller = { empresa, pool };
    req.sesionTaller = { usuarioId } as never;
    siguiente();
  });
  app.use(conIdentificador(e.ctx));
  app.post('/falla-una-vez', (_req, res) => {
    llamadas.falla += 1;
    if (llamadas.falla === 1) return void res.status(500).json({ success: false, codigo: 'ERROR_INTERNO' });
    res.status(201).json({ success: true, data: { intento: llamadas.falla } });
  });
  app.post('/archivo', (_req, res) => {
    llamadas.archivo += 1;
    res.type('text/plain').send(`archivo ${llamadas.archivo}`);
  });
  const registro = () => t.sql(async (c) => (await c.query('SELECT id_cliente, estado, codigo_http FROM mutaciones_procesadas'))[0] as Array<Record<string, unknown>>);
  return { app, llamadas, registro };
}

describe('lo que NO se guarda', () => {
  it('un error del servidor (5xx) no se guarda: el mismo cambio se puede reintentar y se aplica; el éxito sí se guarda', async () => {
    const m = await montar();
    const id = 'reintento-0001-aaaa';
    const primera = await request(m.app).post('/falla-una-vez').set('X-Id-Cliente', id).send({});
    expect(primera.status).toBe(500);
    expect(await m.registro()).toEqual([]); // no quedó guardado
    const segunda = await request(m.app).post('/falla-una-vez').set('X-Id-Cliente', id).send({});
    expect(segunda.status).toBe(201);
    expect(segunda.headers['x-repetida']).toBeUndefined(); // se ejecutó de verdad
    expect(m.llamadas.falla).toBe(2);
    const tercera = await request(m.app).post('/falla-una-vez').set('X-Id-Cliente', id).send({});
    expect(tercera.status).toBe(201);
    expect(tercera.headers['x-repetida']).toBe('1'); // ahora sí: repite la respuesta guardada
    expect(tercera.body).toEqual(segunda.body);
    expect(m.llamadas.falla).toBe(2); // no se ejecutó otra vez
    expect(await m.registro()).toEqual([{ id_cliente: id, estado: 'terminada', codigo_http: 201 }]);
  });

  it('una respuesta que no es JSON (un archivo) no se guarda', async () => {
    const m = await montar();
    const id = 'archivo-0001-bbbb';
    expect((await request(m.app).post('/archivo').set('X-Id-Cliente', id).send({})).status).toBe(200);
    // El borrado del registro ocurre al terminar la respuesta: se espera un instante.
    await new Promise((r) => setTimeout(r, 200));
    expect(await m.registro()).toEqual([]);
    expect((await request(m.app).post('/archivo').set('X-Id-Cliente', id).send({})).status).toBe(200);
    expect(m.llamadas.archivo).toBe(2);
  });
});
