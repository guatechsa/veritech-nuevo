import { confirmarAlta, iniciarAlta, slugDisponible } from '../../src/alta/registro';
import { barrerCicloDeVida } from '../../src/cobro/ciclo';
import { cancelarSuscripcionDeEmpresa, conciliarEmpresa } from '../../src/cobro/conciliacion';
import { MS_DIA } from '../../src/cobro/politica';
import { borrarBaseTemporal, crearBase } from '../../src/db/bases';
import { ejecutar, filas, una } from '../../src/db/consulta';
import { configPruebas } from '../db/ayuda';
import { datosAlta, tallerCreado } from '../alta/ayuda';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});

const T0 = new Date('2026-12-01T15:00:00Z');
const enDias = (d: number): Date => new Date(T0.getTime() + d * MS_DIA);

async function empresaActiva(extra: Record<string, unknown> = {}) {
  const id = await e.empresa({ estado: 'activa' });
  const sub = `I-L${id}`;
  await ejecutar(e.pool, "UPDATE empresas SET paypal_suscripcion_id = ?, contacto_correo = 'dueno@taller.test', contacto_nombre = 'MARIA', estado_desde = ? WHERE id = ?", [sub, T0, id]);
  for (const [k, v] of Object.entries(extra)) await ejecutar(e.pool, `UPDATE empresas SET ${k} = ? WHERE id = ?`, [v, id]);
  e.paypal.suscripcion(sub, { enPrueba: false, proximoCobro: enDias(30) });
  return { id, sub };
}

const correos = async (tipo: string) => filas<{ cuerpo: string; asunto: string }>(e.pool, 'SELECT cuerpo, asunto FROM correos_salida WHERE tipo = ? ORDER BY id', [tipo]);
const estadoDe = async (id: number) => (await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [id]))?.estado;

describe('pago fallido: gracia de 7 días', () => {
  it('correos los días 0, 3 y 6, suspensión automática al día 7, sin duplicados aunque el barrido corra de más', async () => {
    const { id, sub } = await empresaActiva();
    e.reloj.fijo = T0;
    e.paypal.suscripcion(sub, { pagosFallidos: 1, saldoPendiente: 30 });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    expect(await estadoDe(id)).toBe('pago_fallido');
    expect(await correos('pago_fallido')).toHaveLength(1); // día 0

    e.reloj.fijo = enDias(1);
    await barrerCicloDeVida(e.ctx);
    expect(await correos('pago_fallido')).toHaveLength(1);

    e.reloj.fijo = enDias(3.1);
    await barrerCicloDeVida(e.ctx);
    await barrerCicloDeVida(e.ctx); // repetir no manda otro
    expect(await correos('pago_fallido')).toHaveLength(2);
    expect((await correos('pago_fallido'))[1]?.cuerpo).toContain('4 días');

    e.reloj.fijo = enDias(6.1);
    await barrerCicloDeVida(e.ctx);
    expect(await correos('pago_fallido')).toHaveLength(3);
    expect(await estadoDe(id)).toBe('pago_fallido'); // el taller sigue trabajando hasta el día 7

    e.reloj.fijo = enDias(7.1);
    const r = await barrerCicloDeVida(e.ctx);
    expect(r.transiciones).toBe(1);
    expect(await estadoDe(id)).toBe('suspendida');
    expect(await una(e.pool, 'SELECT suspension_origen FROM empresas WHERE id = ?', [id])).toMatchObject({ suspension_origen: 'pago' });
    await barrerCicloDeVida(e.ctx);
    expect(await correos('suspension')).toHaveLength(1);
    expect(await correos('pago_fallido')).toHaveLength(3);
  });

  it('si el pago llega antes del día 7, la gracia se cancela y no se suspende nada', async () => {
    const { id, sub } = await empresaActiva();
    e.reloj.fijo = T0;
    e.paypal.suscripcion(sub, { pagosFallidos: 1, saldoPendiente: 30 });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    e.reloj.fijo = enDias(5);
    e.paypal.suscripcion(sub, { pagosFallidos: 0, saldoPendiente: 0 });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    e.reloj.fijo = enDias(8);
    await barrerCicloDeVida(e.ctx);
    expect(await estadoDe(id)).toBe('activa');
    expect(await correos('suspension')).toHaveLength(0);
  });

  it('una cuenta suspendida por falta de pago pasa a solo exportar a los 30 días', async () => {
    const { id } = await empresaActiva({ estado: 'suspendida', suspension_origen: 'pago', estado_desde: T0 });
    e.reloj.fijo = enDias(29);
    await barrerCicloDeVida(e.ctx);
    expect(await estadoDe(id)).toBe('suspendida');
    e.reloj.fijo = enDias(31);
    await barrerCicloDeVida(e.ctx);
    expect(await estadoDe(id)).toBe('solo_exportar');
    expect(await correos('solo_exportar')).toHaveLength(1);
  });

  it('una suspensión manual no la mueve el calendario nunca', async () => {
    const { id } = await empresaActiva({ estado: 'suspendida', suspension_origen: 'manual', estado_desde: T0 });
    e.reloj.fijo = enDias(500);
    await barrerCicloDeVida(e.ctx);
    expect(await estadoDe(id)).toBe('suspendida');
  });
});

describe('cancelación, exportar y cierre', () => {
  it('cancelada → sigue hasta el fin del período → 30 días para exportar → cerrada, con un correo en cada paso y una sola vez', async () => {
    const { id } = await empresaActiva();
    e.reloj.fijo = T0;
    await cancelarSuscripcionDeEmpresa(e.ctx, id, 'ya no lo uso', {});
    expect(await estadoDe(id)).toBe('cancelada_con_acceso');
    const acceso = (await una<{ acceso_hasta: Date }>(e.pool, 'SELECT acceso_hasta FROM empresas WHERE id = ?', [id]))!.acceso_hasta;
    expect(Math.round((acceso.getTime() - T0.getTime()) / MS_DIA)).toBe(30);

    e.reloj.fijo = enDias(29);
    await barrerCicloDeVida(e.ctx);
    expect(await estadoDe(id)).toBe('cancelada_con_acceso'); // todavía tiene servicio

    e.reloj.fijo = enDias(30.1);
    await barrerCicloDeVida(e.ctx);
    expect(await estadoDe(id)).toBe('solo_exportar');
    expect(await correos('solo_exportar')).toHaveLength(1);

    e.reloj.fijo = enDias(30 + 22);
    await barrerCicloDeVida(e.ctx);
    expect(await correos('borrado_proximo')).toHaveLength(0);
    e.reloj.fijo = enDias(30 + 23.5);
    await barrerCicloDeVida(e.ctx);
    await barrerCicloDeVida(e.ctx);
    expect(await correos('borrado_proximo')).toHaveLength(1); // 7 días antes, una sola vez
    expect(await estadoDe(id)).toBe('solo_exportar');

    e.reloj.fijo = enDias(60.5);
    await barrerCicloDeVida(e.ctx);
    expect(await estadoDe(id)).toBe('cerrada');
    expect(await correos('cerrada')).toHaveLength(1);
    expect(await correos('cancelacion')).toHaveLength(1);
  });

  it('al cerrarse, la empresa libera su nombre y deja de aparecer en "Entrar"', async () => {
    const t = await tallerCreado(e, { slug: 'liberame' });
    await ejecutar(e.pool, "UPDATE empresas SET estado = 'solo_exportar', exportable_hasta = ?, estado_desde = ? WHERE id = ?", [T0, T0, t.empresaId]);
    e.reloj.fijo = enDias(1);
    await barrerCicloDeVida(e.ctx);
    expect(await estadoDe(t.empresaId)).toBe('cerrada');
    expect(await slugDisponible(e.ctx, 'liberame')).toBe(true);
    const fila = await una<{ slug: string; subdominio: string }>(e.pool, 'SELECT slug, subdominio FROM empresas WHERE id = ?', [t.empresaId]);
    expect(fila?.slug).toBe(`cerrada-${t.empresaId}-liberame`);
    expect(fila?.subdominio).toContain('cerrada-');
    expect(await una<{ activo: number }>(e.pool, 'SELECT activo FROM directorio_acceso WHERE empresa_id = ?', [t.empresaId])).toMatchObject({ activo: 0 });
    // Y otro cliente puede registrarse con ese nombre.
    await iniciarAlta(e.ctx, datosAlta({ slug: 'liberame' }), { ip: '1.1.1.1' });
  });

  it('con el borrado automático APAGADO, la base del taller cerrado se conserva y queda constancia', async () => {
    const t = await tallerCreado(e, { slug: 'conserva' });
    await ejecutar(e.pool, "UPDATE empresas SET estado = 'solo_exportar', exportable_hasta = ?, estado_desde = ? WHERE id = ?", [T0, T0, t.empresaId]);
    e.reloj.fijo = enDias(1);
    const r = await barrerCicloDeVida(e.ctx);
    expect(r.bases_borradas).toBe(0);
    const base = await una(e.pool, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [t.nombreBd]);
    expect(base).not.toBeNull();
    expect((await una<{ descripcion: string }>(e.pool, "SELECT descripcion FROM auditoria_plataforma WHERE accion = 'taller_cerrado'"))?.descripcion).toContain('NO se borró');
  });

  it('una empresa por contrato no la toca el ciclo de vida', async () => {
    const { id } = await empresaActiva({ estado: 'solo_exportar', exportable_hasta: T0, cobro_por_contrato: 1 });
    e.reloj.fijo = enDias(10);
    await barrerCicloDeVida(e.ctx);
    expect(await estadoDe(id)).toBe('solo_exportar');
  });
});

describe('con el borrado automático ENCENDIDO', () => {
  let e2: EntornoDePrueba;
  beforeAll(async () => {
    e2 = await crearEntornoDePrueba({ borradoAutomatico: true });
  });
  afterAll(async () => e2.cerrar());
  beforeEach(async () => {
    await e2.limpiar();
    await e2.planesConPaypal();
  });

  it('borra la base del taller cerrado y solo esa', async () => {
    const a = await tallerCreado(e2, { slug: 'borrame' });
    const b = await tallerCreado(e2, { slug: 'quedate' });
    await ejecutar(e2.pool, "UPDATE empresas SET estado = 'solo_exportar', exportable_hasta = ?, estado_desde = ? WHERE id = ?", [T0, T0, a.empresaId]);
    e2.reloj.fijo = enDias(1);
    const r = await barrerCicloDeVida(e2.ctx);
    expect(r.bases_borradas).toBe(1);
    const existe = async (bd: string) => (await una(e2.pool, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [bd])) !== null;
    expect(await existe(a.nombreBd)).toBe(false);
    expect(await existe(b.nombreBd)).toBe(true);
    expect((await una<{ descripcion: string }>(e2.pool, "SELECT descripcion FROM auditoria_plataforma WHERE accion = 'taller_cerrado'"))?.descripcion).toContain('se borró su base');
  });

  it('nunca borra una base que no sea de un taller (guarda por prefijo)', async () => {
    const señuelo = 'vtn_senuelo_no_borrar';
    await crearBase(configPruebas(), señuelo);
    try {
      const id = await e2.empresa({ estado: 'solo_exportar' });
      await ejecutar(e2.pool, 'UPDATE empresas SET nombre_bd = ?, exportable_hasta = ?, estado_desde = ? WHERE id = ?', [señuelo, T0, T0, id]);
      e2.reloj.fijo = enDias(1);
      const r = await barrerCicloDeVida(e2.ctx);
      expect(r.errores.join(' ')).toContain('no es de un taller');
      expect(r.bases_borradas).toBe(0);
      expect(await una(e2.pool, 'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [señuelo])).not.toBeNull();
    } finally {
      await borrarBaseTemporal(configPruebas(), señuelo);
    }
  });
});

describe('prueba de 30 días y bienvenida', () => {
  it('avisa 7 días y 1 día antes del primer cobro, una vez cada aviso', async () => {
    const id = await e.empresa({ estado: 'prueba' });
    await ejecutar(e.pool, "UPDATE empresas SET prueba_hasta = ?, contacto_correo = 'dueno@taller.test', contacto_nombre = 'MARIA' WHERE id = ?", [enDias(30), id]);
    e.reloj.fijo = enDias(10);
    await barrerCicloDeVida(e.ctx);
    expect(await correos('prueba_7d')).toHaveLength(0);
    e.reloj.fijo = enDias(23.2);
    await barrerCicloDeVida(e.ctx);
    await barrerCicloDeVida(e.ctx);
    expect(await correos('prueba_7d')).toHaveLength(1);
    expect((await correos('prueba_7d'))[0]?.asunto).toContain('en 7 días');
    e.reloj.fijo = enDias(29.2);
    await barrerCicloDeVida(e.ctx);
    await barrerCicloDeVida(e.ctx);
    expect(await correos('prueba_1d')).toHaveLength(1);
    expect(await correos('prueba_7d')).toHaveLength(1);
  });

  it('la bienvenida sale SOLO cuando el subdominio ya responde, y una sola vez', async () => {
    const t = await tallerCreado(e, { slug: 'bienvenido', nombre_taller: 'Taller <b>Malo</b>' });
    e.ctx.verificarSubdominio = async () => false;
    await barrerCicloDeVida(e.ctx);
    expect(await correos('bienvenida')).toHaveLength(0);
    expect((await una<{ subdominio_listo_en: Date | null }>(e.pool, 'SELECT subdominio_listo_en FROM empresas WHERE id = ?', [t.empresaId]))?.subdominio_listo_en).toBeNull();

    let consultado = '';
    e.ctx.verificarSubdominio = async (url) => {
      consultado = url;
      return true;
    };
    const r = await barrerCicloDeVida(e.ctx);
    await barrerCicloDeVida(e.ctx);
    expect(r.bienvenidas).toBe(1);
    expect(consultado).toBe('https://pruebas.veritech.lat/t/bienvenido');
    const c = await correos('bienvenida');
    expect(c).toHaveLength(1);
    expect(c[0]?.cuerpo).toContain('https://pruebas.veritech.lat/t/bienvenido');
    expect(c[0]?.cuerpo).toContain('30 días de prueba');
    expect(c[0]?.cuerpo).toContain('&lt;B&gt;MALO&lt;/B&gt;'); // el nombre del taller viene escapado
    expect(c[0]?.cuerpo).not.toContain('<B>MALO');
  });
});

describe('altas', () => {
  it('un registro sin pagar vence a las 48 horas y se borra la contraseña guardada', async () => {
    await iniciarAlta(e.ctx, datosAlta({ slug: 'sinpagar' }), { ip: '1.1.1.1' });
    e.reloj.fijo = new Date(Date.now() + 49 * 3600 * 1000);
    const r = await barrerCicloDeVida(e.ctx);
    expect(r.altas_vencidas).toBe(1);
    expect(await una(e.pool, "SELECT estado, contrasena_hash FROM altas_pendientes WHERE slug = 'sinpagar'")).toMatchObject({ estado: 'vencida', contrasena_hash: null });
  });

  it('un alta aprobada que se quedó a medias la termina el barrido', async () => {
    await e.planesConPaypal();
    const emitido = await iniciarAlta(e.ctx, datosAlta({ slug: 'atorada' }), { ip: '1.1.1.1' });
    e.paypal.suscripcion('I-ATORADA', { planId: emitido.paypal_plan_id, customId: emitido.custom_id });
    await confirmarAlta(e.ctx, { pase: emitido.pase, suscripcionId: 'I-ATORADA' });
    // Recién aprobada: el barrido todavía no se mete (la está creando el proceso normal)...
    let r = await barrerCicloDeVida(e.ctx);
    expect(r.altas_reintentadas).toBe(0);
    // ...pero si pasan más de 2 minutos sin crearse, la rescata.
    e.reloj.fijo = new Date(Date.now() + 5 * 60 * 1000);
    r = await barrerCicloDeVida(e.ctx);
    expect(r.altas_reintentadas).toBe(1);
    expect(await una(e.pool, "SELECT estado FROM altas_pendientes WHERE slug = 'atorada'")).toMatchObject({ estado: 'usada' });
    expect(await una(e.pool, "SELECT estado FROM empresas WHERE slug = 'atorada'")).toMatchObject({ estado: 'prueba' });
  });
});
