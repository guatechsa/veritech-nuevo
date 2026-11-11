import { escaparHtml } from '../utils/html';
import { botonCorreo, plantillaCorreo } from './plantilla';

/**
 * Correos del ciclo de vida de una cuenta (módulo 13): todos en "usted", con la marca VERI-TECH y con todo dato escrito
 * por una persona escapado. Cada función devuelve el asunto y el cuerpo ya armados.
 */
export interface DatosTaller {
  nombreTaller: string;
  contacto: string;
  urlTaller: string;
}

export interface CorreoArmado {
  tipo: string;
  asunto: string;
  cuerpoHtml: string;
}

/** DD/MM/YYYY en la zona del taller (estándar §18). */
export function fechaLegible(fecha: Date, zona = 'America/Guatemala'): string {
  return new Intl.DateTimeFormat('es-GT', { timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric' }).format(fecha);
}

function saludo(d: DatosTaller): string {
  return `<p>Estimado(a) ${escaparHtml(d.contacto)}:</p>`;
}

function armar(tipo: string, asunto: string, cuerpo: string): CorreoArmado {
  return { tipo, asunto, cuerpoHtml: plantillaCorreo(cuerpo) };
}

export function correoBienvenida(d: DatosTaller, diasPrueba: number): CorreoArmado {
  return armar(
    'bienvenida',
    `Su cuenta de VERI-TECH está lista: ${d.nombreTaller}`,
    `${saludo(d)}
    <p>Su taller <strong>${escaparHtml(d.nombreTaller)}</strong> ya está listo. Tiene ${diasPrueba} días de prueba para configurarlo y probarlo; el primer cobro será al terminar ese período y puede cancelar cuando quiera.</p>
    ${botonCorreo('Entrar a mi taller', d.urlTaller)}
    <p>Ingrese con el correo y la contraseña que registró.</p>`
  );
}

export function correoPruebaPorTerminar(d: DatosTaller, dias: number, fechaCobro: Date): CorreoArmado {
  const cuando = dias === 1 ? 'mañana' : `en ${dias} días`;
  return armar(
    `prueba_${dias}d`,
    `Su período de prueba termina ${cuando}`,
    `${saludo(d)}
    <p>El período de prueba de <strong>${escaparHtml(d.nombreTaller)}</strong> termina ${cuando}. El primer cobro será el ${fechaLegible(fechaCobro)}.</p>
    <p>Si no desea continuar, puede cancelar antes de esa fecha desde la pantalla «Suscripción y pagos» y no se le cobrará.</p>
    ${botonCorreo('Ver mi suscripción', d.urlTaller)}`
  );
}

export function correoPagoRecibido(d: DatosTaller, pago: { monto: number; moneda: string; fecha: Date; transaccion: string }): CorreoArmado {
  return armar(
    'pago_recibido',
    `Recibimos su pago de ${pago.moneda} ${pago.monto.toFixed(2)}`,
    `${saludo(d)}
    <p>Recibimos el pago de la suscripción de <strong>${escaparHtml(d.nombreTaller)}</strong>. Gracias.</p>
    <p>Monto: <strong>${escaparHtml(pago.moneda)} ${pago.monto.toFixed(2)}</strong><br>Fecha: ${fechaLegible(pago.fecha)}<br>Referencia de PayPal: ${escaparHtml(pago.transaccion)}</p>
    <p>El comprobante de este cobro lo envía PayPal a su correo.</p>`
  );
}

export function correoPagoFallido(d: DatosTaller, graciaHasta: Date, diasRestantes: number): CorreoArmado {
  return armar(
    'pago_fallido',
    'No pudimos cobrar su suscripción',
    `${saludo(d)}
    <p>No pudimos cobrar la suscripción de <strong>${escaparHtml(d.nombreTaller)}</strong>. Su taller sigue funcionando con normalidad.</p>
    <p>Tiene hasta el <strong>${fechaLegible(graciaHasta)}</strong> (${diasRestantes} ${diasRestantes === 1 ? 'día' : 'días'}) para corregir el medio de pago en su cuenta de PayPal. Si no se corrige a tiempo, la cuenta se suspende.</p>
    ${botonCorreo('Ver mi suscripción', d.urlTaller)}`
  );
}

export function correoSuspension(d: DatosTaller): CorreoArmado {
  return armar(
    'suspension',
    'Su cuenta de VERI-TECH fue suspendida',
    `${saludo(d)}
    <p>Suspendimos la cuenta de <strong>${escaparHtml(d.nombreTaller)}</strong> porque no pudimos cobrar la suscripción dentro del plazo.</p>
    <p>Se reactiva sola en cuanto PayPal logre el cobro. Si necesita ayuda, escríbanos a soporte@guatech.lat.</p>`
  );
}

export function correoReactivacion(d: DatosTaller): CorreoArmado {
  return armar(
    'reactivacion',
    'Su cuenta de VERI-TECH volvió a estar activa',
    `${saludo(d)}
    <p>Recibimos su pago y la cuenta de <strong>${escaparHtml(d.nombreTaller)}</strong> volvió a estar activa. Gracias por continuar con nosotros.</p>
    ${botonCorreo('Entrar a mi taller', d.urlTaller)}`
  );
}

export function correoCancelacion(d: DatosTaller, accesoHasta: Date): CorreoArmado {
  return armar(
    'cancelacion',
    'Su suscripción fue cancelada',
    `${saludo(d)}
    <p>Cancelamos la suscripción de <strong>${escaparHtml(d.nombreTaller)}</strong>; no se le volverá a cobrar.</p>
    <p>Puede seguir usando el sistema hasta el <strong>${fechaLegible(accesoHasta)}</strong>. Después tendrá 30 días para descargar sus datos y, si cambia de opinión, puede reactivar la cuenta en ese plazo.</p>`
  );
}

export function correoSoloExportar(d: DatosTaller, hasta: Date): CorreoArmado {
  return armar(
    'solo_exportar',
    'Descargue sus datos antes del ' + fechaLegible(hasta),
    `${saludo(d)}
    <p>El servicio de <strong>${escaparHtml(d.nombreTaller)}</strong> terminó. Hasta el <strong>${fechaLegible(hasta)}</strong> puede entrar solo para descargar sus datos; después los borraremos, como lo indica nuestra Política de Privacidad.</p>
    <p>Si desea continuar, puede reactivar la cuenta dentro de ese plazo.</p>
    ${botonCorreo('Descargar mis datos', d.urlTaller)}`
  );
}

export function correoBorradoProximo(d: DatosTaller, fecha: Date): CorreoArmado {
  return armar(
    'borrado_proximo',
    'Sus datos se borrarán el ' + fechaLegible(fecha),
    `${saludo(d)}
    <p>Los datos de <strong>${escaparHtml(d.nombreTaller)}</strong> se borrarán el <strong>${fechaLegible(fecha)}</strong>. Después no se podrán recuperar.</p>
    <p>Si aún no los descargó, entre antes de esa fecha. Si desea continuar con el servicio, reactive la cuenta.</p>
    ${botonCorreo('Entrar a mi taller', d.urlTaller)}`
  );
}

export function correoCerrada(d: DatosTaller): CorreoArmado {
  return armar(
    'cerrada',
    'Su cuenta de VERI-TECH fue cerrada',
    `${saludo(d)}
    <p>La cuenta de <strong>${escaparHtml(d.nombreTaller)}</strong> fue cerrada y sus datos se eliminaron. Gracias por haber usado VERI-TECH.</p>
    <p>Si algún día desea volver, puede registrarse de nuevo.</p>`
  );
}

/** Correo de "Entrar": la lista de talleres de una misma persona. Los nombres y direcciones se escapan. */
export function correoAccesos(accesos: Array<{ nombreTaller: string; url: string }>): CorreoArmado {
  const items = accesos
    .map((a) => `<li style="margin-bottom: 8px;"><strong>${escaparHtml(a.nombreTaller)}</strong><br><a href="${escaparHtml(a.url)}">${escaparHtml(a.url)}</a></li>`)
    .join('');
  return armar(
    'accesos',
    'Sus accesos a VERI-TECH',
    `<p>Solicitaron los accesos de este correo a VERI-TECH. Estos son sus talleres:</p>
    <ul>${items}</ul>
    <p>Si usted no lo solicitó, puede ignorar este mensaje.</p>`
  );
}

/** Alerta interna para GUATECH: un cliente pagó y su taller no quedó creado. */
export function correoAltaFallida(datos: { nombreTaller: string; slug: string; correo: string; suscripcion: string; error: string }): CorreoArmado {
  return armar(
    'alerta_alta_fallida',
    `ALERTA: alta fallida de ${datos.slug}`,
    `<p>Un cliente aprobó su suscripción en PayPal y el taller <strong>no quedó creado</strong>. Hay que atenderlo hoy.</p>
    <p>Taller: ${escaparHtml(datos.nombreTaller)} (${escaparHtml(datos.slug)})<br>Correo: ${escaparHtml(datos.correo)}<br>Suscripción de PayPal: ${escaparHtml(datos.suscripcion)}<br>Error: ${escaparHtml(datos.error)}</p>
    <p>En el panel de plataforma, abra la empresa y use «Reintentar alta».</p>`
  );
}
