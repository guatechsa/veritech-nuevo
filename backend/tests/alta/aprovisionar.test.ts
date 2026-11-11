import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { aprovisionarAlta } from '../../src/alta/aprovisionar';
import { opcionesBase } from '../../src/db/conexion';
import { ejecutar, filas, una } from '../../src/db/consulta';
import { verificarContrasena } from '../../src/utils/clave';
import { baseTemporal, configPruebas } from '../db/ayuda';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { altaAprobada, CLAVE_ADMIN, tallerCreado } from './ayuda';

const MIGRACIONES_DE_TALLER = fs.readdirSync(path.join(__dirname, '..', '..', '..', 'database', 'taller')).filter((n) => n.endsWith('.sql')).sort();

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});

async function conTaller<T>(nombreBd: string, trabajo: (con: mysql.Connection) => Promise<T>): Promise<T> {
  const con = await mysql.createConnection(opcionesBase(configPruebas(), nombreBd));
  try {
    return await trabajo(con);
  } finally {
    await con.end();
  }
}

describe('creación de un taller', () => {
  it('crea la empresa, su base propia, el administrador y deja todo en estado de prueba', async () => {
    const t = await tallerCreado(e, { slug: 'lopez', nombre_taller: 'Taller López', admin_nombre: 'José Pérez' });
    expect(t.nombreBd).toBe('vtn_t_lopez');
    expect(t.subdominio).toBe('lopez.taller.test');

    const empresa = await una<Record<string, unknown>>(e.pool, 'SELECT * FROM empresas WHERE id = ?', [t.empresaId]);
    expect(empresa).toMatchObject({ estado: 'prueba', nombre: 'TALLER LOPEZ', slug: 'lopez', cuota_mensual: 30, paypal_suscripcion_id: t.suscripcionId, contacto_nombre: 'JOSE PEREZ', version_legal_aceptada: '1.0', legal_aceptada_ip: '10.0.0.1' });
    expect(empresa?.['provisionada_en']).toBeInstanceOf(Date);
    const dias = ((empresa?.['prueba_hasta'] as Date).getTime() - Date.now()) / 86400000;
    expect(dias).toBeGreaterThan(29.9);
    expect(dias).toBeLessThan(30.1);

    const alta = await una<{ estado: string; contrasena_hash: string | null; empresa_id: number }>(e.pool, 'SELECT estado, contrasena_hash, empresa_id FROM altas_pendientes WHERE id = ?', [t.altaId]);
    expect(alta).toMatchObject({ estado: 'usada', contrasena_hash: null, empresa_id: t.empresaId }); // la contraseña ya no se conserva
  });

  it('los módulos de la empresa son los del plan elegido', async () => {
    const t = await tallerCreado(e, { plan_codigo: 'basico' });
    const esperados = await filas<{ modulo_codigo: string }>(e.pool, "SELECT modulo_codigo FROM plan_modulos pm JOIN planes p ON p.id = pm.plan_id WHERE p.codigo = 'basico' ORDER BY 1");
    const reales = await filas<{ modulo_codigo: string }>(e.pool, 'SELECT modulo_codigo FROM empresa_modulos WHERE empresa_id = ? ORDER BY 1', [t.empresaId]);
    expect(reales.length).toBeGreaterThan(0);
    expect(reales.map((m) => m.modulo_codigo)).toEqual(esperados.map((m) => m.modulo_codigo));
  });

  it('el administrador existe DENTRO del taller, con su rol, su sucursal y su configuración; la contraseña se verifica', async () => {
    const t = await tallerCreado(e, { admin_nombre: 'José Pérez', nombre_taller: 'Taller López' });
    await conTaller(t.nombreBd, async (con) => {
      const [col] = await con.query<mysql.RowDataPacket[]>('SELECT c.*, s.nombre AS sucursal FROM colaboradores c JOIN sucursales s ON s.id = c.sucursal_id');
      expect(col).toHaveLength(1);
      expect(col[0]).toMatchObject({ nombre_completo: 'JOSE PEREZ', correo: t.datos.admin_correo, sucursal: 'SUCURSAL PRINCIPAL' });
      const [usu] = await con.query<mysql.RowDataPacket[]>('SELECT u.contrasena_hash, r.codigo FROM usuarios u JOIN usuario_roles ur ON ur.usuario_id = u.id JOIN roles r ON r.id = ur.rol_id');
      expect(usu).toHaveLength(1);
      expect(usu[0]?.['codigo']).toBe('administrador');
      expect(await verificarContrasena(CLAVE_ADMIN, String(usu[0]?.['contrasena_hash']))).toBe(true);
      expect(String(usu[0]?.['contrasena_hash'])).not.toContain(CLAVE_ADMIN);
      const [cfg] = await con.query<mysql.RowDataPacket[]>('SELECT clave, valor FROM configuracion ORDER BY clave');
      expect(cfg.map((c) => [c['clave'], c['valor']])).toEqual([['moneda', 'GTQ'], ['nombre_empresa', 'TALLER LOPEZ'], ['zona_horaria', 'America/Guatemala']]);
      const [roles] = await con.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM roles');
      expect(roles[0]?.['n']).toBe(8);
      const [mig] = await con.query<mysql.RowDataPacket[]>('SELECT archivo FROM migraciones_aplicadas');
      expect(mig.map((m) => m['archivo'])).toEqual(MIGRACIONES_DE_TALLER); // el taller nace con TODAS las migraciones de la carpeta
    });
  });

  it('el correo del administrador queda en el directorio de accesos (un correo, varios talleres)', async () => {
    const t = await tallerCreado(e);
    const fila = await una<{ correo: string; empresa_id: number; usuario_id: number; activo: number }>(e.pool, 'SELECT * FROM directorio_acceso');
    expect(fila).toMatchObject({ correo: t.datos.admin_correo, empresa_id: t.empresaId, usuario_id: 1, activo: 1 });
  });

  it('deja rastro en la auditoría y la empresa aparece en el panel', async () => {
    await tallerCreado(e, { nombre_taller: 'Taller Rastro' });
    const a = await una<{ accion: string }>(e.pool, "SELECT accion FROM auditoria_plataforma WHERE accion = 'empresa_creada'");
    expect(a).not.toBeNull();
    const admin = await e.usuario('SUPER_ADMIN');
    const lista = await e.autorizado(admin.token).get('/api/plataforma/empresas');
    expect(lista.body.data.empresas.map((x: { nombre: string }) => x.nombre)).toContain('TALLER RASTRO');
  });

  it('repetir la creación no duplica nada (empresa, administrador, directorio, módulos)', async () => {
    const t = await tallerCreado(e);
    const otra = await aprovisionarAlta(e.ctx, t.altaId);
    expect(otra).toMatchObject({ empresaId: t.empresaId, yaExistia: true });
    expect((await una<{ n: number }>(e.pool, 'SELECT COUNT(*) AS n FROM empresas'))?.n).toBe(1);
    expect((await una<{ n: number }>(e.pool, 'SELECT COUNT(*) AS n FROM directorio_acceso'))?.n).toBe(1);
    await conTaller(t.nombreBd, async (con) => {
      const [u] = await con.query<mysql.RowDataPacket[]>('SELECT COUNT(*) AS n FROM usuarios');
      expect(u[0]?.['n']).toBe(1);
    });
  });

  it('un fallo a la mitad se reanuda: no queda un taller a medias ni se duplica la empresa', async () => {
    const alta = await altaAprobada(e);
    // Primer intento: la carpeta de migraciones es inválida, así que la base se crea pero el taller no se completa.
    const rota = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-mig-'));
    fs.writeFileSync(path.join(rota, '0001_rota.sql'), 'CREATE TABLE x (;');
    e.ctx.carpetaTaller = rota;
    await expect(aprovisionarAlta(e.ctx, alta.altaId)).rejects.toThrow(/Falló la migración/);
    const medio = await una<{ estado: string; intentos: number; error: string; empresa_id: number }>(e.pool, 'SELECT estado, intentos, error, empresa_id FROM altas_pendientes WHERE id = ?', [alta.altaId]);
    expect(medio?.estado).toBe('aprobada'); // se puede reintentar
    expect(medio?.intentos).toBe(1);
    expect(medio?.error).toContain('0001_rota.sql');
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [medio?.empresa_id]))?.estado).toBe('pendiente');
    expect((await una<{ n: number }>(e.pool, 'SELECT COUNT(*) AS n FROM directorio_acceso'))?.n).toBe(0);

    // Segundo intento con la carpeta correcta: termina el trabajo sobre la MISMA empresa.
    e.ctx.carpetaTaller = undefined;
    // (la base ya existe y tiene una migración fallida registrada? no: la fallida nunca se registra)
    const r = await aprovisionarAlta(e.ctx, alta.altaId);
    expect(r.empresaId).toBe(medio?.empresa_id);
    expect((await una<{ n: number }>(e.pool, 'SELECT COUNT(*) AS n FROM empresas'))?.n).toBe(1);
    expect((await una<{ estado: string; error: string | null }>(e.pool, 'SELECT estado, error FROM altas_pendientes WHERE id = ?', [alta.altaId]))).toMatchObject({ estado: 'usada', error: null });
    fs.rmSync(rota, { recursive: true, force: true });
  });

  it('tras 5 intentos fallidos el alta queda en error y GUATECH recibe una alerta (una sola vez por intento)', async () => {
    const alta = await altaAprobada(e);
    const rota = fs.mkdtempSync(path.join(os.tmpdir(), 'vt-mig-'));
    fs.writeFileSync(path.join(rota, '0001_rota.sql'), 'CREATE TABLE x (;');
    e.ctx.carpetaTaller = rota;
    for (let i = 0; i < 5; i++) await expect(aprovisionarAlta(e.ctx, alta.altaId)).rejects.toThrow();
    expect((await una<{ estado: string; intentos: number }>(e.pool, 'SELECT estado, intentos FROM altas_pendientes WHERE id = ?', [alta.altaId]))).toMatchObject({ estado: 'error', intentos: 5 });
    const alertas = await filas<{ destinatarios: string; asunto: string }>(e.pool, "SELECT destinatarios, asunto FROM correos_salida WHERE tipo = 'alerta_alta_fallida'");
    expect(alertas).toHaveLength(1);
    expect(alertas[0]?.destinatarios).toBe('soporte@guatech.lat');
    expect(alertas[0]?.asunto).toContain(alta.datos.slug);

    // Soporte la reintenta desde el panel con la carpeta ya corregida.
    e.ctx.carpetaTaller = undefined;
    const admin = await e.usuario('ADMIN');
    const r = await e.autorizado(admin.token).post(`/api/plataforma/altas/${alta.altaId}/reintentar`);
    expect(r.status).toBe(200);
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM altas_pendientes WHERE id = ?', [alta.altaId]))?.estado).toBe('usada');
    fs.rmSync(rota, { recursive: true, force: true });
  });

  it('dos creaciones a la vez del mismo alta: una trabaja y la otra se rechaza (no se pisan)', async () => {
    const alta = await altaAprobada(e);
    const resultados = await Promise.allSettled([aprovisionarAlta(e.ctx, alta.altaId), aprovisionarAlta(e.ctx, alta.altaId), aprovisionarAlta(e.ctx, alta.altaId)]);
    expect(resultados.some((r) => r.status === 'fulfilled')).toBe(true);
    expect((await una<{ n: number }>(e.pool, 'SELECT COUNT(*) AS n FROM empresas'))?.n).toBe(1);
    expect((await una<{ n: number }>(e.pool, 'SELECT COUNT(*) AS n FROM directorio_acceso'))?.n).toBe(1);
  });

  it('un alta que no está aprobada no crea nada', async () => {
    const { iniciarAlta } = await import('../../src/alta/registro');
    const { datosAlta } = await import('./ayuda');
    await iniciarAlta(e.ctx, datosAlta({ slug: 'sinpago' }), { ip: '1.1.1.1' });
    const fila = await una<{ id: number }>(e.pool, "SELECT id FROM altas_pendientes WHERE slug = 'sinpago'");
    await expect(aprovisionarAlta(e.ctx, fila!.id)).rejects.toThrow(/solo se crea el taller de un alta aprobada/);
    expect((await una<{ n: number }>(e.pool, 'SELECT COUNT(*) AS n FROM empresas'))?.n).toBe(0);
  });

  it('los nombres con guion usan guion bajo en la base del taller', async () => {
    const t = await tallerCreado(e, { slug: 'taller-lopez' });
    expect(t.nombreBd).toBe('vtn_t_taller_lopez');
    expect(t.subdominio).toBe('taller-lopez.taller.test');
  });

  it('la migración base de talleres es repetible: aplicarla otra vez no cambia nada', async () => {
    const b = await baseTemporal();
    try {
      const { aplicarMigraciones } = await import('../../src/db/migrador');
      const carpeta = path.join(__dirname, '..', '..', '..', 'database', 'taller');
      expect((await aplicarMigraciones(b.config, b.base, carpeta)).aplicadas).toEqual(MIGRACIONES_DE_TALLER);
      expect((await aplicarMigraciones(b.config, b.base, carpeta)).aplicadas).toEqual([]);
    } finally {
      await b.borrar();
    }
  });

  it('PayPal y la base: la empresa conserva la cuota del plan y el id de la suscripción', async () => {
    const t = await tallerCreado(e, { plan_codigo: 'profesional' });
    expect(await una(e.pool, 'SELECT cuota_mensual, paypal_suscripcion_id FROM empresas WHERE id = ?', [t.empresaId])).toMatchObject({ cuota_mensual: 60, paypal_suscripcion_id: t.suscripcionId });
    await ejecutar(e.pool, 'UPDATE empresas SET cuota_mensual = cuota_mensual WHERE id = ?', [t.empresaId]);
  });
});
