import { PoolConnection } from 'mysql2/promise';
import { ejecutar, una } from '../db/consulta';
import { encolarCorreo } from '../correos/cola';
import {
  correoCancelacion,
  correoCerrada,
  correoPagoFallido,
  correoReactivacion,
  correoSoloExportar,
  correoSuspension,
  CorreoArmado,
  DatosTaller,
} from '../correos/ciclo-vida';
import { Contexto } from '../plataforma/contexto';
import { urlDeTaller } from '../utils/slug';
import { Decision, EstadoEmpresa, SituacionEmpresa } from './estado';
import { MS_DIA, POLITICA } from './politica';

export type OrigenEvento = 'aviso' | 'conciliacion' | 'manual' | 'sistema';

export interface FilaEmpresa extends SituacionEmpresa {
  id: number;
  nombre: string;
  slug: string;
  subdominio: string;
  nombre_bd: string;
  contacto_nombre: string | null;
  contacto_correo: string | null;
  cobro_por_contrato: number;
  es_demo: number;
  paypal_suscripcion_id: string | null;
  borrado_programado_en: Date | null;
}

export const COLUMNAS_EMPRESA = `id, nombre, slug, subdominio, nombre_bd, estado, gracia_hasta, acceso_hasta, prueba_hasta, proximo_cobro_en,
  exportable_hasta, borrado_programado_en, estado_desde, suspension_origen, contacto_nombre, contacto_correo, cobro_por_contrato, es_demo, paypal_suscripcion_id`;

export function datosTaller(e: Pick<FilaEmpresa, 'nombre' | 'contacto_nombre' | 'subdominio'>): DatosTaller {
  return { nombreTaller: e.nombre, contacto: e.contacto_nombre ?? e.nombre, urlTaller: urlDeTaller(e.subdominio) };
}

/** Pone un correo al contacto de la empresa (si tiene correo). Con clave única: nunca sale dos veces. */
export async function avisarEmpresa(con: PoolConnection | Contexto['pool'], e: FilaEmpresa, correo: CorreoArmado, claveUnica: string): Promise<void> {
  if (!e.contacto_correo || e.cobro_por_contrato) return;
  await encolarCorreo(con, { tipo: correo.tipo, destinatarios: [e.contacto_correo], asunto: correo.asunto, cuerpoHtml: correo.cuerpoHtml, claveUnica });
}

const ESTADOS_CON_SERVICIO: EstadoEmpresa[] = ['prueba', 'activa'];

/**
 * Aplica a una empresa (ya bloqueada con FOR UPDATE por quien llama) lo que se decidió: guarda los campos, deja un evento
 * si cambió el estado y pone en la cola los correos que correspondan. Todo dentro de la misma transacción.
 */
export async function aplicarDecision(
  con: PoolConnection,
  ahora: Date,
  e: FilaEmpresa,
  d: Decision,
  evento: { origen: OrigenEvento; tipo: string; usuarioId?: number | null; detalle?: string }
): Promise<void> {
  const cierra = d.estado === 'cerrada' && d.cambioEstado;
  await ejecutar(
    con,
    `UPDATE empresas SET estado = ?, gracia_hasta = ?, acceso_hasta = ?, prueba_hasta = ?, proximo_cobro_en = ?, exportable_hasta = ?,
            borrado_programado_en = ?, suspension_origen = ?, estado_desde = ?
      WHERE id = ?`,
    [d.estado, d.graciaHasta, d.accesoHasta, d.pruebaHasta, d.proximoCobro, d.exportableHasta, d.borradoProgramadoEn, d.suspensionOrigen, d.cambioEstado ? ahora : e.estado_desde, e.id]
  );
  if (!d.cambioEstado) return;

  await ejecutar(
    con,
    `INSERT INTO suscripcion_eventos (empresa_id, tipo, estado_antes, estado_despues, origen, usuario_plataforma_id, detalle, procesado_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [e.id, evento.tipo, e.estado, d.estado, evento.origen, evento.usuarioId ?? null, (evento.detalle ?? d.motivo).slice(0, 500), ahora]
  );

  const dt = datosTaller(e);
  const epoch = Math.floor(ahora.getTime() / 1000);
  const eraProblema = e.estado === 'pago_fallido' || (e.estado === 'suspendida' && e.suspension_origen === 'pago') || e.estado === 'cancelada_con_acceso';

  if (d.estado === 'pago_fallido' && d.graciaHasta) {
    await avisarEmpresa(con, e, correoPagoFallido(dt, d.graciaHasta, POLITICA.diasGracia), `gracia0:${e.id}:${Math.floor(d.graciaHasta.getTime() / 1000)}`);
  } else if (d.estado === 'suspendida' && d.suspensionOrigen === 'pago') {
    await avisarEmpresa(con, e, correoSuspension(dt), `suspension:${e.id}:${epoch}`);
  } else if (ESTADOS_CON_SERVICIO.includes(d.estado) && eraProblema) {
    await avisarEmpresa(con, e, correoReactivacion(dt), `reactivada:${e.id}:${epoch}`);
  } else if (d.estado === 'cancelada_con_acceso' && d.accesoHasta) {
    await avisarEmpresa(con, e, correoCancelacion(dt, d.accesoHasta), `cancelacion:${e.id}:${Math.floor(d.accesoHasta.getTime() / 1000)}`);
  } else if (d.estado === 'solo_exportar' && d.exportableHasta) {
    await avisarEmpresa(con, e, correoSoloExportar(dt, d.exportableHasta), `solo_exportar:${e.id}:${Math.floor(d.exportableHasta.getTime() / 1000)}`);
  } else if (cierra) {
    await avisarEmpresa(con, e, correoCerrada(dt), `cerrada:${e.id}`);
    // Un taller cerrado libera su nombre y su dirección para que otro cliente pueda usarlos.
    await ejecutar(
      con,
      `UPDATE empresas SET slug = LEFT(CONCAT('cerrada-', id, '-', slug), 50), subdominio = LEFT(CONCAT('cerrada-', id, '-', subdominio), 120) WHERE id = ?`,
      [e.id]
    );
    await ejecutar(con, 'UPDATE directorio_acceso SET activo = 0 WHERE empresa_id = ?', [e.id]);
  }
}

/** Lee y bloquea la empresa. Quien llama decide con lo que lee AQUÍ, no con lo que leyó antes (otra tarea pudo cambiarla). */
export async function bloquearEmpresa(con: PoolConnection, id: number): Promise<FilaEmpresa | null> {
  return una<FilaEmpresa>(con, `SELECT ${COLUMNAS_EMPRESA} FROM empresas WHERE id = ? FOR UPDATE`, [id]);
}

/** ¿Falta poco para el borrado? (para el aviso previo). */
export function diasHasta(fecha: Date, ahora: Date): number {
  return Math.ceil((fecha.getTime() - ahora.getTime()) / MS_DIA);
}
