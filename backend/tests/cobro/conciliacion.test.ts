import { cancelarSuscripcionDeEmpresa, conciliarEmpresa, conciliarTodas } from '../../src/cobro/conciliacion';
import { MS_DIA, sumarDias } from '../../src/cobro/politica';
import { ejecutar, filas, una } from '../../src/db/consulta';
import { tallerCreado } from '../alta/ayuda';
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
afterEach(() => {
  jest.restoreAllMocks();
});

/** Una empresa con suscripción, sin crear su base (la conciliación solo toca la plataforma). */
async function empresaConPaypal(estado = 'prueba', extra: Record<string, unknown> = {}) {
  const id = await e.empresa({ estado });
  const sub = `I-C${id}`;
  await ejecutar(e.pool, 'UPDATE empresas SET paypal_suscripcion_id = ?, contacto_correo = ?, contacto_nombre = ? WHERE id = ?', [sub, 'dueno@taller.test', 'MARIA', id]);
  for (const [k, v] of Object.entries(extra)) await ejecutar(e.pool, `UPDATE empresas SET ${k} = ? WHERE id = ?`, [v, id]);
  return { id, sub };
}

const correos = (tipo?: string) => filas<{ tipo: string; destinatarios: string; asunto: string; cuerpo: string }>(e.pool, `SELECT tipo, destinatarios, asunto, cuerpo FROM correos_salida ${tipo ? 'WHERE tipo = ?' : ''} ORDER BY id`, tipo ? [tipo] : []);

describe('conciliación con PayPal', () => {
  it('prueba terminada y primer cobro: pasa a activa, guarda el pago y manda el recibo una sola vez', async () => {
    const { id, sub } = await empresaConPaypal('prueba');
    const ahora = new Date();
    e.paypal.suscripcion(sub, { enPrueba: false, ultimoPagoEn: ahora, proximoCobro: sumarDias(ahora, 30) });
    e.paypal.pago(sub, { id: 'TX-1', fecha: ahora, monto: 30, moneda: 'USD', estado: 'COMPLETED' });

    const r = await conciliarEmpresa(e.ctx, id, 'conciliacion');
    expect(r).toMatchObject({ cambioEstado: true, estado: 'activa', pagosNuevos: 1 });
    expect(await una(e.pool, 'SELECT estado, paypal_estado, proximo_cobro_en FROM empresas WHERE id = ?', [id])).toMatchObject({ estado: 'activa', paypal_estado: 'ACTIVE' });
    expect(await filas(e.pool, 'SELECT * FROM pagos')).toHaveLength(1);

    // Segunda vuelta: nada nuevo, ni pagos duplicados ni otro recibo.
    const r2 = await conciliarEmpresa(e.ctx, id, 'conciliacion');
    expect(r2).toMatchObject({ cambioEstado: false, pagosNuevos: 0 });
    expect(await filas(e.pool, 'SELECT * FROM pagos')).toHaveLength(1);
    const recibos = await correos('pago_recibido');
    expect(recibos).toHaveLength(1);
    expect(recibos[0]?.destinatarios).toBe('dueno@taller.test');
    expect(recibos[0]?.cuerpo).toContain('USD 30.00');
    expect(recibos[0]?.cuerpo).toContain('Estimado(a) MARIA');
  });

  it('deja un evento por cada cambio de estado, con estado antes y después y su origen', async () => {
    const { id, sub } = await empresaConPaypal('prueba');
    e.paypal.suscripcion(sub, { enPrueba: false });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    const ev = await una(e.pool, "SELECT estado_antes, estado_despues, origen FROM suscripcion_eventos WHERE empresa_id = ? AND tipo = 'conciliacion'", [id]);
    expect(ev).toMatchObject({ estado_antes: 'prueba', estado_despues: 'activa', origen: 'conciliacion' });
  });

  it('cobro fallido: pago_fallido, 7 días de gracia y un correo el día 0 (el taller sigue funcionando)', async () => {
    const { id, sub } = await empresaConPaypal('activa');
    e.paypal.suscripcion(sub, { enPrueba: false, pagosFallidos: 1, saldoPendiente: 30 });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    const fila = await una<{ estado: string; gracia_hasta: Date }>(e.pool, 'SELECT estado, gracia_hasta FROM empresas WHERE id = ?', [id]);
    expect(fila?.estado).toBe('pago_fallido');
    const dias = (fila!.gracia_hasta.getTime() - Date.now()) / MS_DIA;
    expect(dias).toBeGreaterThan(6.9);
    expect(dias).toBeLessThan(7.1);
    const c = await correos('pago_fallido');
    expect(c).toHaveLength(1);
    expect(c[0]?.cuerpo).toContain('sigue funcionando con normalidad');
    // Conciliar otra vez no reinicia la gracia ni repite el correo.
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    expect((await una<{ gracia_hasta: Date }>(e.pool, 'SELECT gracia_hasta FROM empresas WHERE id = ?', [id]))?.gracia_hasta).toEqual(fila?.gracia_hasta);
    expect(await correos('pago_fallido')).toHaveLength(1);
  });

  it('el pago llega después del fallo: vuelve a activa solo y avisa la reactivación', async () => {
    const { id, sub } = await empresaConPaypal('activa');
    e.paypal.suscripcion(sub, { enPrueba: false, pagosFallidos: 1, saldoPendiente: 30 });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    e.paypal.suscripcion(sub, { pagosFallidos: 0, saldoPendiente: 0 });
    const r = await conciliarEmpresa(e.ctx, id, 'conciliacion');
    expect(r.estado).toBe('activa');
    expect((await una<{ gracia_hasta: Date | null }>(e.pool, 'SELECT gracia_hasta FROM empresas WHERE id = ?', [id]))?.gracia_hasta).toBeNull();
    expect(await correos('reactivacion')).toHaveLength(1);
  });

  it('PayPal suspende y ya no hay gracia: suspendida y se reactiva sola cuando se cobra', async () => {
    const { id, sub } = await empresaConPaypal('activa');
    e.paypal.suscripcion(sub, { enPrueba: false, estado: 'SUSPENDED' });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    expect(await una(e.pool, 'SELECT estado, suspension_origen FROM empresas WHERE id = ?', [id])).toMatchObject({ estado: 'suspendida', suspension_origen: 'pago' });
    expect(await correos('suspension')).toHaveLength(1);
    e.paypal.suscripcion(sub, { estado: 'ACTIVE' });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [id]))?.estado).toBe('activa');
    expect(await correos('reactivacion')).toHaveLength(1);
  });

  it('una suspensión manual de GUATECH NO se levanta aunque PayPal esté al día', async () => {
    const admin = await e.usuario('SUPER_ADMIN');
    const { id, sub } = await empresaConPaypal('activa');
    await e.autorizado(admin.token).post(`/api/plataforma/empresas/${id}/estado`).send({ estado: 'suspendida', motivo: 'ABUSO' }).expect(200);
    e.paypal.suscripcion(sub, { enPrueba: false });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    expect(await una(e.pool, 'SELECT estado, suspension_origen FROM empresas WHERE id = ?', [id])).toMatchObject({ estado: 'suspendida', suspension_origen: 'manual' });
    expect(await correos('reactivacion')).toHaveLength(0);
  });

  it('una empresa por contrato, sin suscripción o cerrada se omite', async () => {
    const contrato = await e.empresa({ estado: 'activa' });
    await ejecutar(e.pool, "UPDATE empresas SET paypal_suscripcion_id = 'I-CONTRATO', cobro_por_contrato = 1 WHERE id = ?", [contrato]);
    const sinSub = await e.empresa({ estado: 'activa' });
    expect((await conciliarEmpresa(e.ctx, contrato, 'conciliacion')).omitida).toBe('cobro por contrato');
    expect((await conciliarEmpresa(e.ctx, sinSub, 'conciliacion')).omitida).toBe('sin suscripción de PayPal');
    expect(e.paypal.llamadas).toBe(0);
  });

  it('si PayPal no responde, no cambia nada y el error se informa (no se confunde con "no existe")', async () => {
    const { id, sub } = await empresaConPaypal('activa');
    e.paypal.suscripcion(sub, { enPrueba: false, estado: 'SUSPENDED' });
    e.paypal.caido = true;
    await expect(conciliarEmpresa(e.ctx, id, 'conciliacion')).rejects.toThrow('PayPal no responde');
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [id]))?.estado).toBe('activa');
  });

  it('si PayPal no conoce la suscripción, queda anotado y no se cambia el estado', async () => {
    const { id } = await empresaConPaypal('activa');
    const r = await conciliarEmpresa(e.ctx, id, 'conciliacion');
    expect(r.omitida).toBe('PayPal no conoce la suscripción');
    expect(await una(e.pool, "SELECT tipo FROM suscripcion_eventos WHERE empresa_id = ? AND tipo = 'suscripcion_no_encontrada'", [id])).not.toBeNull();
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [id]))?.estado).toBe('activa');
  });

  it('conciliar todas: una que falla no detiene a las demás', async () => {
    const a = await empresaConPaypal('prueba');
    const b = await empresaConPaypal('activa');
    const c = await empresaConPaypal('activa');
    e.paypal.suscripcion(a.sub, { enPrueba: false });
    e.paypal.suscripcion(c.sub, { enPrueba: false, estado: 'SUSPENDED' });
    // La de en medio hace que el simulado falle solo para ella.
    const original = e.paypal.obtenerSuscripcion.bind(e.paypal);
    jest.spyOn(e.paypal, 'obtenerSuscripcion').mockImplementation(async (id: string) => {
      if (id === b.sub) throw new Error('falla puntual');
      return original(id);
    });
    const r = await conciliarTodas(e.ctx);
    expect(r.errores).toEqual([{ empresaId: b.id, error: 'falla puntual' }]);
    expect(r.cambiaron).toBe(2);
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [c.id]))?.estado).toBe('suspendida');
  });

  it('cobra por transacciones de varias ventanas de 30 días (el primer cobro después de una prueba larga)', async () => {
    const id = await e.empresa({ estado: 'prueba', creada: sumarDias(new Date(), -70) });
    const sub = 'I-LARGA';
    await ejecutar(e.pool, "UPDATE empresas SET paypal_suscripcion_id = ?, contacto_correo = 'x@y.test' WHERE id = ?", [sub, id]);
    e.paypal.suscripcion(sub, { enPrueba: false });
    e.paypal.pago(sub, { id: 'TX-VIEJO', fecha: sumarDias(new Date(), -65), monto: 30, moneda: 'USD', estado: 'COMPLETED' });
    e.paypal.pago(sub, { id: 'TX-NUEVO', fecha: sumarDias(new Date(), -3), monto: 30, moneda: 'USD', estado: 'COMPLETED' });
    expect((await conciliarEmpresa(e.ctx, id, 'conciliacion')).pagosNuevos).toBe(2);
  });
});

describe('cancelar la suscripción', () => {
  it('cancela en PayPal, guarda el fin del período pagado y avisa', async () => {
    const { id, sub } = await empresaConPaypal('activa');
    const proximo = sumarDias(new Date(), 12);
    e.paypal.suscripcion(sub, { enPrueba: false, proximoCobro: proximo });
    const r = await cancelarSuscripcionDeEmpresa(e.ctx, id, 'Ya no lo necesito', { usuarioId: null, ip: '1.1.1.1' });
    expect(r.estado).toBe('cancelada_con_acceso');
    expect(e.paypal.cancelaciones).toEqual([{ id: sub, motivo: 'Ya no lo necesito' }]);
    const fila = await una<{ estado: string; acceso_hasta: Date }>(e.pool, 'SELECT estado, acceso_hasta FROM empresas WHERE id = ?', [id]);
    expect(Math.abs((fila?.acceso_hasta.getTime() ?? 0) - proximo.getTime())).toBeLessThan(1000); // el servicio sigue hasta el final del período pagado
    const c = await correos('cancelacion');
    expect(c).toHaveLength(1);
    expect(c[0]?.cuerpo).toContain('no se le volverá a cobrar');
    expect(await una(e.pool, "SELECT accion FROM auditoria_plataforma WHERE accion = 'suscripcion_cancelada'")).not.toBeNull();
  });

  it('si PayPal no acepta la cancelación, no se toca nada y se informa con 502', async () => {
    const { id, sub } = await empresaConPaypal('activa');
    e.paypal.suscripcion(sub, { enPrueba: false, proximoCobro: sumarDias(new Date(), 12) });
    jest.spyOn(e.paypal, 'cancelarSuscripcion').mockRejectedValue(new Error('PayPal 500'));
    await expect(cancelarSuscripcionDeEmpresa(e.ctx, id, 'x', {})).rejects.toMatchObject({ estado: 502 });
    expect(await una(e.pool, 'SELECT estado, acceso_hasta FROM empresas WHERE id = ?', [id])).toMatchObject({ estado: 'activa', acceso_hasta: null });
    expect(await correos('cancelacion')).toHaveLength(0);
  });

  it('no se cancela una cuenta que ya está suspendida, cerrada o por contrato', async () => {
    const s = await empresaConPaypal('suspendida');
    await expect(cancelarSuscripcionDeEmpresa(e.ctx, s.id, 'x', {})).rejects.toMatchObject({ estado: 409 });
    const c = await empresaConPaypal('activa', { cobro_por_contrato: 1 });
    await expect(cancelarSuscripcionDeEmpresa(e.ctx, c.id, 'x', {})).rejects.toMatchObject({ estado: 409 });
  });

  it('un taller creado de verdad por el registro se puede conciliar y cancelar de punta a punta', async () => {
    const t = await tallerCreado(e);
    e.paypal.suscripcion(t.suscripcionId, { enPrueba: true, proximoCobro: sumarDias(new Date(), 29) });
    await conciliarEmpresa(e.ctx, t.empresaId, 'conciliacion');
    expect((await una<{ estado: string }>(e.pool, 'SELECT estado FROM empresas WHERE id = ?', [t.empresaId]))?.estado).toBe('prueba');
    const r = await cancelarSuscripcionDeEmpresa(e.ctx, t.empresaId, 'prueba', {});
    expect(r.estado).toBe('cancelada_con_acceso');
  });
});

describe('acciones del panel', () => {
  it('"Conciliar ahora" la puede usar ADMIN y SUPER_ADMIN, no VIEWER', async () => {
    const { id, sub } = await empresaConPaypal('prueba');
    e.paypal.suscripcion(sub, { enPrueba: false });
    const viewer = await e.usuario('VIEWER');
    expect((await e.autorizado(viewer.token).post(`/api/plataforma/empresas/${id}/conciliar`)).status).toBe(403);
    const admin = await e.usuario('ADMIN');
    const r = await e.autorizado(admin.token).post(`/api/plataforma/empresas/${id}/conciliar`);
    expect(r.status).toBe(200);
    expect(r.body.data.estado).toBe('activa');
    const ev = await una(e.pool, "SELECT usuario_plataforma_id, origen FROM suscripcion_eventos WHERE tipo = 'conciliacion_manual'");
    expect(ev).toMatchObject({ usuario_plataforma_id: admin.id, origen: 'manual' });
  });

  it('el detalle de la empresa trae pagos y eventos', async () => {
    const { id, sub } = await empresaConPaypal('prueba');
    e.paypal.suscripcion(sub, { enPrueba: false });
    e.paypal.pago(sub, { id: 'TX-D', fecha: new Date(), monto: 30, moneda: 'USD', estado: 'COMPLETED' });
    await conciliarEmpresa(e.ctx, id, 'conciliacion');
    const viewer = await e.usuario('VIEWER');
    const r = await e.autorizado(viewer.token).get(`/api/plataforma/empresas/${id}/detalle`);
    expect(r.status).toBe(200);
    expect(r.body.data.pagos).toHaveLength(1);
    expect(r.body.data.eventos.length).toBeGreaterThan(0);
    expect(r.body.data.empresa.estado).toBe('activa');
  });
});
