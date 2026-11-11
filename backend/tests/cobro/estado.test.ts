import { decidirPorFechas, decidirPorPaypal, SituacionEmpresa } from '../../src/cobro/estado';
import { MS_DIA, sumarDias } from '../../src/cobro/politica';
import { SuscripcionPaypal } from '../../src/cobro/tipos';

const AHORA = new Date('2026-11-11T12:00:00Z');

function empresa(cambios: Partial<SituacionEmpresa> = {}): SituacionEmpresa {
  return { estado: 'prueba', gracia_hasta: null, acceso_hasta: null, prueba_hasta: sumarDias(AHORA, 20), proximo_cobro_en: null, exportable_hasta: null, estado_desde: AHORA, suspension_origen: null, ...cambios };
}

function paypal(cambios: Partial<SuscripcionPaypal> = {}): SuscripcionPaypal {
  return { id: 'I-1', estado: 'ACTIVE', planId: 'P-1', customId: null, correoSuscriptor: null, proximoCobro: sumarDias(AHORA, 20), ultimoPagoEn: null, pagosFallidos: 0, saldoPendiente: 0, enPrueba: true, ...cambios };
}

describe('decidirPorPaypal: lo que dice PayPal se convierte en el estado del taller', () => {
  it('activa y en prueba: queda en prueba y guarda cuándo termina', () => {
    const d = decidirPorPaypal(empresa({ estado: 'pendiente', prueba_hasta: null }), paypal(), AHORA);
    expect(d.estado).toBe('prueba');
    expect(d.pruebaHasta).toEqual(sumarDias(AHORA, 20));
    expect(d.cambioEstado).toBe(true);
  });

  it('activa, terminó la prueba y cobró: pasa a activa', () => {
    const d = decidirPorPaypal(empresa(), paypal({ enPrueba: false, ultimoPagoEn: AHORA }), AHORA);
    expect(d.estado).toBe('activa');
    expect(d.cambioEstado).toBe(true);
  });

  it('cobro fallido: pago_fallido con 7 días de gracia', () => {
    const d = decidirPorPaypal(empresa({ estado: 'activa' }), paypal({ enPrueba: false, pagosFallidos: 1, saldoPendiente: 30 }), AHORA);
    expect(d.estado).toBe('pago_fallido');
    expect(d.graciaHasta).toEqual(new Date(AHORA.getTime() + 7 * MS_DIA));
  });

  it('si ya estaba en gracia, el reloj de la gracia NO se reinicia en cada consulta', () => {
    const gracia = new Date(AHORA.getTime() + 2 * MS_DIA);
    const d = decidirPorPaypal(empresa({ estado: 'pago_fallido', gracia_hasta: gracia }), paypal({ enPrueba: false, pagosFallidos: 2, saldoPendiente: 30 }), AHORA);
    expect(d.estado).toBe('pago_fallido');
    expect(d.graciaHasta).toEqual(gracia);
    expect(d.cambioEstado).toBe(false);
  });

  it('PayPal suspende pero la gracia sigue corriendo: el taller sigue trabajando hasta que se acabe', () => {
    const gracia = new Date(AHORA.getTime() + 2 * MS_DIA);
    const d = decidirPorPaypal(empresa({ estado: 'pago_fallido', gracia_hasta: gracia }), paypal({ estado: 'SUSPENDED', enPrueba: false }), AHORA);
    expect(d.estado).toBe('pago_fallido');
  });

  it('PayPal suspende sin gracia vigente: suspendida por pago', () => {
    const d = decidirPorPaypal(empresa({ estado: 'activa' }), paypal({ estado: 'SUSPENDED', enPrueba: false }), AHORA);
    expect(d.estado).toBe('suspendida');
    expect(d.suspensionOrigen).toBe('pago');
  });

  it('un pago posterior reactiva sola una cuenta suspendida por falta de pago', () => {
    const d = decidirPorPaypal(empresa({ estado: 'suspendida', suspension_origen: 'pago' }), paypal({ enPrueba: false, ultimoPagoEn: AHORA }), AHORA);
    expect(d.estado).toBe('activa');
    expect(d.suspensionOrigen).toBeNull();
  });

  it('una suspensión MANUAL de GUATECH nunca se levanta sola, aunque PayPal esté al día', () => {
    const d = decidirPorPaypal(empresa({ estado: 'suspendida', suspension_origen: 'manual' }), paypal({ enPrueba: false }), AHORA);
    expect(d.estado).toBe('suspendida');
    expect(d.cambioEstado).toBe(false);
  });

  it('cancelada: el servicio sigue hasta el próximo cobro (el final del período pagado)', () => {
    const proximo = sumarDias(AHORA, 12);
    const d = decidirPorPaypal(empresa({ estado: 'activa', proximo_cobro_en: proximo }), paypal({ estado: 'CANCELLED', proximoCobro: null, enPrueba: false }), AHORA);
    expect(d.estado).toBe('cancelada_con_acceso');
    expect(d.accesoHasta).toEqual(proximo);
  });

  it('cancelada: si ya había una fecha de acceso (la guardó la cancelación), se respeta', () => {
    const fijo = sumarDias(AHORA, 5);
    const d = decidirPorPaypal(empresa({ estado: 'activa', acceso_hasta: fijo, proximo_cobro_en: sumarDias(AHORA, 30) }), paypal({ estado: 'CANCELLED' }), AHORA);
    expect(d.accesoHasta).toEqual(fijo);
  });

  it('si el cliente reactiva en PayPal una cuenta cancelada con acceso, vuelve a activa', () => {
    const d = decidirPorPaypal(empresa({ estado: 'cancelada_con_acceso', acceso_hasta: sumarDias(AHORA, 3) }), paypal({ enPrueba: false }), AHORA);
    expect(d.estado).toBe('activa');
    expect(d.accesoHasta).toBeNull();
  });

  it('las cuentas en cierre (solo exportar, cerrada) no las mueve PayPal', () => {
    for (const estado of ['solo_exportar', 'cerrada'] as const) {
      expect(decidirPorPaypal(empresa({ estado }), paypal({ enPrueba: false }), AHORA).cambioEstado).toBe(false);
    }
  });

  it('una suscripción todavía sin aprobar no cambia nada', () => {
    expect(decidirPorPaypal(empresa({ estado: 'pendiente' }), paypal({ estado: 'APPROVAL_PENDING' }), AHORA).cambioEstado).toBe(false);
  });
});

describe('decidirPorFechas: lo que cambia solo con el paso del tiempo', () => {
  it('la gracia vencida suspende la cuenta (día 7)', () => {
    const d = decidirPorFechas(empresa({ estado: 'pago_fallido', gracia_hasta: new Date(AHORA.getTime() - 1000) }), AHORA);
    expect(d?.estado).toBe('suspendida');
    expect(d?.suspensionOrigen).toBe('pago');
  });

  it('con la gracia todavía vigente no pasa nada', () => {
    expect(decidirPorFechas(empresa({ estado: 'pago_fallido', gracia_hasta: new Date(AHORA.getTime() + 1000) }), AHORA)).toBeNull();
  });

  it('al terminar el acceso de una cuenta cancelada: 30 días para exportar los datos', () => {
    const acceso = sumarDias(AHORA, -1);
    const d = decidirPorFechas(empresa({ estado: 'cancelada_con_acceso', acceso_hasta: acceso }), AHORA);
    expect(d?.estado).toBe('solo_exportar');
    expect(d?.exportableHasta).toEqual(sumarDias(acceso, 30));
    expect(d?.borradoProgramadoEn).toEqual(sumarDias(acceso, 30));
  });

  it('suspendida por falta de pago durante 30 días: pasa a solo exportar', () => {
    const d = decidirPorFechas(empresa({ estado: 'suspendida', suspension_origen: 'pago', estado_desde: sumarDias(AHORA, -31) }), AHORA);
    expect(d?.estado).toBe('solo_exportar');
    expect(d?.exportableHasta).toEqual(sumarDias(AHORA, 30));
  });

  it('una suspensión manual no pasa nunca a solo exportar por el calendario', () => {
    expect(decidirPorFechas(empresa({ estado: 'suspendida', suspension_origen: 'manual', estado_desde: sumarDias(AHORA, -400) }), AHORA)).toBeNull();
  });

  it('terminado el período de exportar, la cuenta se cierra', () => {
    const d = decidirPorFechas(empresa({ estado: 'solo_exportar', exportable_hasta: sumarDias(AHORA, -1) }), AHORA);
    expect(d?.estado).toBe('cerrada');
  });

  it('antes de tiempo no se cierra nada', () => {
    expect(decidirPorFechas(empresa({ estado: 'solo_exportar', exportable_hasta: sumarDias(AHORA, 1) }), AHORA)).toBeNull();
    expect(decidirPorFechas(empresa({ estado: 'cancelada_con_acceso', acceso_hasta: sumarDias(AHORA, 1) }), AHORA)).toBeNull();
  });
});
