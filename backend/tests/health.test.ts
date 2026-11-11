import request from 'supertest';
import { crearApp } from '../src/app';
import { APP_VERSION } from '../src/version';

describe('GET /health y /api/health', () => {
  it('con la base respondiendo: 200 y la versión que corre', async () => {
    const app = crearApp({ verificarBase: async () => true });
    for (const ruta of ['/health', '/api/health']) {
      const res = await request(app).get(ruta);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.version).toBe(APP_VERSION);
      expect(res.body.base).toBe('ok');
    }
  });

  it('con la base caída: 503, y aun así dice la versión', async () => {
    const app = crearApp({ verificarBase: async () => { throw new Error('sin conexión'); } });
    const res = await request(app).get('/health');
    expect(res.status).toBe(503);
    expect(res.body.success).toBe(false);
    expect(res.body.version).toBe(APP_VERSION);
    expect(res.body.base).toBe('sin_conexion');
  });

  it('una ruta inexistente responde 404 con el formato de error del sistema', async () => {
    const app = crearApp({ verificarBase: async () => true });
    const res = await request(app).get('/api/no-existe');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ success: false, codigo: 'NO_ENCONTRADO', error: 'No encontrado' });
  });

  it('no revela que es Express', async () => {
    const app = crearApp({ verificarBase: async () => true });
    const res = await request(app).get('/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('la versión sigue el formato MAYOR.NNN del estándar', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d{3}$/);
  });
});
