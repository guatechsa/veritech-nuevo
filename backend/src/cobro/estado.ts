import { POLITICA, sumarDias } from './politica';
import { SuscripcionPaypal } from './tipos';

export type EstadoEmpresa = 'pendiente' | 'prueba' | 'activa' | 'pago_fallido' | 'suspendida' | 'cancelada_con_acceso' | 'solo_exportar' | 'cerrada';
export type OrigenSuspension = 'manual' | 'pago';

/** Lo que se sabe de la empresa antes de decidir. */
export interface SituacionEmpresa {
  estado: EstadoEmpresa;
  gracia_hasta: Date | null;
  acceso_hasta: Date | null;
  prueba_hasta: Date | null;
  proximo_cobro_en: Date | null;
  exportable_hasta: Date | null;
  estado_desde: Date | null;
  suspension_origen: OrigenSuspension | null;
}

/** Cómo debe quedar la empresa. `cambioEstado` dice si cambió el estado (eso es lo que genera un evento y los correos). */
export interface Decision {
  estado: EstadoEmpresa;
  graciaHasta: Date | null;
  accesoHasta: Date | null;
  pruebaHasta: Date | null;
  proximoCobro: Date | null;
  exportableHasta: Date | null;
  borradoProgramadoEn: Date | null;
  suspensionOrigen: OrigenSuspension | null;
  cambioEstado: boolean;
  motivo: string;
}

function inicial(actual: SituacionEmpresa, proximoCobro: Date | null): Decision {
  return {
    estado: actual.estado,
    graciaHasta: actual.gracia_hasta,
    accesoHasta: actual.acceso_hasta,
    pruebaHasta: actual.prueba_hasta,
    proximoCobro: proximoCobro ?? actual.proximo_cobro_en,
    exportableHasta: actual.exportable_hasta,
    borradoProgramadoEn: actual.exportable_hasta,
    suspensionOrigen: actual.suspension_origen,
    cambioEstado: false,
    motivo: 'sin cambios',
  };
}

function con(base: Decision, actual: SituacionEmpresa, cambios: Partial<Decision> & { estado: EstadoEmpresa; motivo: string }): Decision {
  const resultado = { ...base, ...cambios };
  resultado.cambioEstado = resultado.estado !== actual.estado;
  return resultado;
}

/**
 * Una sola regla para convertir "lo que dice PayPal" en "el estado del taller". La usan la conciliación (cada 3 horas)
 * y el aviso de PayPal; por eso las dos vías siempre llegan al mismo resultado.
 */
export function decidirPorPaypal(actual: SituacionEmpresa, s: SuscripcionPaypal, ahora: Date): Decision {
  const base = inicial(actual, s.proximoCobro);
  if (actual.estado === 'solo_exportar' || actual.estado === 'cerrada') {
    return { ...base, motivo: 'la cuenta ya está en cierre: la cambia el calendario, no PayPal' };
  }
  const suspendidaAMano = actual.estado === 'suspendida' && actual.suspension_origen === 'manual';

  switch (s.estado) {
    case 'ACTIVE': {
      if (suspendidaAMano) return { ...base, motivo: 'suspendida a mano por GUATECH: no se levanta sola' };
      const debe = s.pagosFallidos > 0 && s.saldoPendiente > 0;
      if (debe) {
        const gracia = actual.estado === 'pago_fallido' && actual.gracia_hasta ? actual.gracia_hasta : sumarDias(ahora, POLITICA.diasGracia);
        return con(base, actual, { estado: 'pago_fallido', graciaHasta: gracia, suspensionOrigen: null, accesoHasta: null, motivo: 'PayPal informa un cobro fallido' });
      }
      return con(base, actual, {
        estado: s.enPrueba ? 'prueba' : 'activa',
        graciaHasta: null,
        accesoHasta: null,
        suspensionOrigen: null,
        pruebaHasta: s.enPrueba && s.proximoCobro ? s.proximoCobro : actual.prueba_hasta,
        motivo: s.enPrueba ? 'suscripción activa, en período de prueba' : 'suscripción activa y al día',
      });
    }
    case 'SUSPENDED': {
      if (suspendidaAMano) return { ...base, motivo: 'suspendida a mano por GUATECH' };
      if (actual.estado === 'pago_fallido' && actual.gracia_hasta && actual.gracia_hasta > ahora) {
        return { ...base, motivo: 'PayPal la suspendió, pero la gracia de pago sigue corriendo' };
      }
      if (actual.estado === 'suspendida') return { ...base, motivo: 'sigue suspendida' };
      return con(base, actual, { estado: 'suspendida', suspensionOrigen: 'pago', graciaHasta: null, motivo: 'PayPal suspendió la suscripción' });
    }
    case 'CANCELLED':
    case 'EXPIRED': {
      if (actual.estado === 'pago_fallido' || actual.estado === 'suspendida') {
        return { ...base, motivo: 'PayPal la dio por terminada; el calendario de la cuenta sigue su curso' };
      }
      const acceso = actual.acceso_hasta ?? s.proximoCobro ?? actual.proximo_cobro_en ?? (actual.estado === 'prueba' ? actual.prueba_hasta : null) ?? ahora;
      return con(base, actual, { estado: 'cancelada_con_acceso', accesoHasta: acceso, graciaHasta: null, suspensionOrigen: null, motivo: 'la suscripción se canceló: el servicio sigue hasta el final del período pagado' });
    }
    default:
      return { ...base, motivo: 'la suscripción todavía no está aprobada' };
  }
}

/** Lo que cambia solo por el paso del tiempo (gracia vencida, fin de acceso, fin del período de exportar). */
export function decidirPorFechas(actual: SituacionEmpresa, ahora: Date): Decision | null {
  const base = inicial(actual, null);
  switch (actual.estado) {
    case 'pago_fallido':
      if (actual.gracia_hasta && actual.gracia_hasta <= ahora) {
        return con(base, actual, { estado: 'suspendida', suspensionOrigen: 'pago', graciaHasta: null, motivo: 'se venció la gracia de 7 días sin pago' });
      }
      return null;
    case 'cancelada_con_acceso':
      if (actual.acceso_hasta && actual.acceso_hasta <= ahora) {
        const hasta = sumarDias(actual.acceso_hasta, POLITICA.diasSoloExportar);
        return con(base, actual, { estado: 'solo_exportar', exportableHasta: hasta, borradoProgramadoEn: hasta, motivo: 'terminó el período pagado: 30 días para exportar sus datos' });
      }
      return null;
    case 'suspendida':
      if (actual.suspension_origen === 'pago' && actual.estado_desde && sumarDias(actual.estado_desde, POLITICA.diasSuspendidaAntesDeExportar) <= ahora) {
        const hasta = sumarDias(ahora, POLITICA.diasSoloExportar);
        return con(base, actual, { estado: 'solo_exportar', exportableHasta: hasta, borradoProgramadoEn: hasta, suspensionOrigen: null, motivo: 'suspendida por falta de pago durante 30 días: 30 días para exportar sus datos' });
      }
      return null;
    case 'solo_exportar':
      if (actual.exportable_hasta && actual.exportable_hasta <= ahora) {
        return con(base, actual, { estado: 'cerrada', motivo: 'terminó el período para exportar: la cuenta se cierra' });
      }
      return null;
    default:
      return null;
  }
}
