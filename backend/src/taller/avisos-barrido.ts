import { filas } from '../db/consulta';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { localDeUtc, limitesDelDia } from '../utils/zona';
import { correoDeUsuario, emitirAviso, ResultadoAviso } from './avisos';
import { enviarPendientesPush, revisarPush, TransportePush } from './avisos-push';
import { TallerReq } from './comun';
import { hoyDelTaller } from './contadores';
import { ESTADOS_QUE_TRABAJAN, poolsDe } from './contexto';
import { enviarProgramados } from './reportes-guardados';
import { revisarAvisos } from './servicios';
import { TARJETAS, valorDeContador } from './tablero';
import { buscarEmpresa } from './resolutor';

/**
 * La revisión periódica de los avisos (Fase 7b): recorre los talleres que están trabajando y detecta lo que no tiene un «momento» claro en la
 * pantalla: servicios que se acercan, citas de mañana, cotizaciones, documentos y reservas por vencer, y los resúmenes. Cada hecho tiene su
 * clave, así que correr la revisión dos veces (o dos servidores a la vez) nunca avisa dos veces lo mismo.
 */

/** El resumen diario sale a partir de esta hora del taller. */
export const HORA_DEL_RESUMEN = 7;

const sumarDias = (fecha: string, dias: number): string => new Date(new Date(`${fecha}T00:00:00Z`).getTime() + dias * 86400000).toISOString().slice(0, 10);
const ddmmaaaa = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export interface ResumenRevision {
  [tipo: string]: number;
}

interface Cfg {
  activo: boolean;
  umbral: number | null;
}

async function configs(t: TallerReq): Promise<Map<string, Cfg>> {
  const f = await filas<{ tipo_aviso: string; activo: number; umbral_dias: number | null }>(t.pool, 'SELECT tipo_aviso, activo, umbral_dias FROM avisos_config');
  return new Map(f.map((x) => [x.tipo_aviso, { activo: x.activo === 1, umbral: x.umbral_dias }]));
}

const cuenta = (res: ResumenRevision, tipo: string, r: ResultadoAviso): void => {
  if (r === 'encolado' || r === 'sin_destinatarios') res[tipo] = (res[tipo] ?? 0) + 1;
};

/** Revisa UN taller. Cada revisión es independiente: si una falla, las demás siguen. */
export async function revisarAvisosDeTaller(ctx: Contexto, t: TallerReq): Promise<ResumenRevision> {
  const res: ResumenRevision = {};
  const cfg = await configs(t);
  const activo = (tipo: string): boolean => cfg.get(tipo)?.activo === true;
  const ahora = ahoraDe(ctx);
  const hoy = hoyDelTaller(ctx, t);
  const zona = t.empresa.zonaHoraria;
  const paso = async (nombre: string, trabajo: () => Promise<void>): Promise<void> => {
    try {
      await trabajo();
    } catch (error) {
      console.error(`[avisos] revisión «${nombre}» de ${t.empresa.slug}:`, error instanceof Error ? error.message : error);
    }
  };

  // Servicios programados: se avisa cuando EMPEORAN de estado (la tabla avisos_servicio recuerda lo ya avisado).
  if (activo('servicio_proximo') || activo('servicio_vencido')) {
    await paso('servicios', async () => {
      const r = await revisarAvisos(ctx, t);
      for (const p of r.avisos_nuevos) {
        const tipo = p.estado === 'vencido' ? 'servicio_vencido' : 'servicio_proximo';
        const resto = p.restante === null ? '' : p.restante >= 0 ? `faltan ${p.restante} ${p.unidad}` : `pasado por ${Math.abs(p.restante)} ${p.unidad}`;
        cuenta(
          res,
          tipo,
          await emitirAviso(ctx, t, {
            tipo,
            clave: `srv:${p.equipo_id}:${p.servicio_id}:${p.estado}:${Math.floor(ahora.getTime() / 1000)}`,
            ruta: '/servicios',
            referencia: p.servicio,
            datos: { equipo: p.equipo, tipo_equipo: p.tipo_equipo, cliente: p.cliente ?? 'PROPIO DEL TALLER', servicio: p.servicio, estado: p.estado === 'vencido' ? 'VENCIDO' : p.estado === 'urgente' ? 'URGENTE' : 'PROXIMO', detalle: resto || '-' },
          })
        );
      }
    });
  }

  // Citas de mañana (o con los días de anticipación que el taller elija): le llega al cliente.
  if (activo('recordatorio_cita')) {
    await paso('citas', async () => {
      const dias = cfg.get('recordatorio_cita')?.umbral ?? 1;
      const dia = sumarDias(hoy, dias);
      const l = limitesDelDia(dia, zona);
      const citas = await filas<{ id: number; fecha_hora: Date; cliente: string | null; correo: string | null; equipo: string | null; sucursal: string }>(
        t.pool,
        `SELECT c.id, c.fecha_hora, cl.nombre AS cliente, COALESCE(cl.email, cl.contacto_email) AS correo, NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa), '') AS equipo, s.nombre AS sucursal
           FROM citas c JOIN equipos e ON e.id = c.equipo_id JOIN sucursales s ON s.id = c.sucursal_id LEFT JOIN clientes cl ON cl.id = c.cliente_id
          WHERE c.estado = 'programada' AND c.fecha_hora >= ? AND c.fecha_hora < ? ORDER BY c.fecha_hora`,
        [l.desde, l.hasta]
      );
      for (const c of citas) {
        const local = localDeUtc(c.fecha_hora, zona);
        cuenta(
          res,
          'recordatorio_cita',
          await emitirAviso(ctx, t, {
            tipo: 'recordatorio_cita',
            clave: `cita:${c.id}:${Math.floor(c.fecha_hora.getTime() / 1000)}`,
            contextuales: [c.correo],
            referencia: `CITA ${c.id}`,
            datos: { cliente: c.cliente ?? 'CLIENTE', equipo: c.equipo ?? '-', fecha: ddmmaaaa(local.fecha), hora: local.hora, sucursal: c.sucursal },
          })
        );
      }
    });
  }

  if (activo('cotizacion_por_vencer')) {
    await paso('cotizaciones', async () => {
      const hasta = sumarDias(hoy, cfg.get('cotizacion_por_vencer')?.umbral ?? 2);
      const f = await filas<{ id: number; numero: string; creada_por_id: number | null; cliente: string | null; vence_en: string }>(
        t.pool,
        `SELECT c.id, c.numero, c.creada_por_id, cl.nombre AS cliente, DATE_FORMAT(c.vence_en, '%Y-%m-%d') AS vence_en FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id
          WHERE c.estado = 'enviada' AND c.vence_en >= ? AND c.vence_en <= ? ORDER BY c.vence_en`,
        [hoy, hasta]
      );
      for (const c of f) {
        cuenta(
          res,
          'cotizacion_por_vencer',
          await emitirAviso(ctx, t, {
            tipo: 'cotizacion_por_vencer',
            clave: `cotv:${c.id}:${c.vence_en}`,
            ruta: '/cotizaciones',
            contextuales: [await correoDeUsuario(t, c.creada_por_id)],
            referencia: c.numero,
            datos: { cotizacion: c.numero, cliente: c.cliente ?? '-', vence: ddmmaaaa(c.vence_en) },
          })
        );
      }
    });
  }

  if (activo('documento_por_vencer')) {
    await paso('documentos', async () => {
      const propio = cfg.get('documento_por_vencer')?.umbral ?? null;
      const f = await filas<{ id: number; documento: string; equipo: string | null; vence: string }>(
        t.pool,
        `SELECT d.id, COALESCE(d.nombre, td.nombre) AS documento, NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa), '') AS equipo, DATE_FORMAT(d.vence, '%Y-%m-%d') AS vence
           FROM equipo_documentos d JOIN tipos_documento td ON td.id = d.tipo_documento_id JOIN equipos e ON e.id = d.equipo_id
          WHERE d.activo = 1 AND d.vence IS NOT NULL AND d.vence >= ? AND d.vence <= DATE_ADD(?, INTERVAL COALESCE(?, td.dias_aviso) DAY) AND e.estado <> 'baja' ORDER BY d.vence`,
        [hoy, hoy, propio]
      );
      for (const d of f) {
        cuenta(
          res,
          'documento_por_vencer',
          await emitirAviso(ctx, t, { tipo: 'documento_por_vencer', clave: `doc:${d.id}:${d.vence}`, ruta: '/equipos', referencia: d.documento.slice(0, 60), datos: { equipo: d.equipo ?? '-', documento: d.documento, vence: ddmmaaaa(d.vence) } })
        );
      }
    });
  }

  if (activo('reserva_por_vencer')) {
    await paso('reservas', async () => {
      const hasta = sumarDias(hoy, cfg.get('reserva_por_vencer')?.umbral ?? 1);
      const f = await filas<{ id: number; numero: string; orden: string; creada_por_id: number | null; vence_en: string }>(
        t.pool,
        `SELECT r.id, r.numero, o.numero AS orden, r.creada_por_id, DATE_FORMAT(r.vence_en, '%Y-%m-%d') AS vence_en FROM reservas r JOIN ordenes o ON o.id = r.orden_id
          WHERE r.estado = 'activa' AND r.vence_en >= ? AND r.vence_en <= ? ORDER BY r.vence_en`,
        [hoy, hasta]
      );
      for (const r of f) {
        cuenta(
          res,
          'reserva_por_vencer',
          await emitirAviso(ctx, t, {
            tipo: 'reserva_por_vencer',
            clave: `resv:${r.id}:${r.vence_en}`,
            ruta: '/inventario?tab=reservas',
            contextuales: [await correoDeUsuario(t, r.creada_por_id)],
            referencia: r.numero,
            datos: { reserva: r.numero, orden: r.orden, vence: ddmmaaaa(r.vence_en) },
          })
        );
      }
    });
  }

  // Resúmenes: una vez por día (o por lunes), a partir de la hora del resumen.
  const local = localDeUtc(ahora, zona);
  if (Number(local.hora.slice(0, 2)) >= HORA_DEL_RESUMEN) {
    const lunes = new Date(`${hoy}T00:00:00Z`).getUTCDay() === 1;
    for (const [tipo, toca, clave] of [
      ['resumen_diario', true, `dia:${hoy}`],
      ['resumen_semanal', lunes, `semana:${hoy}`],
    ] as const) {
      if (!toca || !activo(tipo)) continue;
      await paso(tipo, async () => {
        const ya = await filas(t.pool, 'SELECT id FROM avisos_registro WHERE tipo_aviso = ? AND clave = ?', [tipo, clave]);
        if (ya.length > 0) return;
        cuenta(res, tipo, await emitirAviso(ctx, t, { tipo, clave, ruta: '/', referencia: ddmmaaaa(hoy), datos: { fecha: ddmmaaaa(hoy), resumen: await textoDelResumen(ctx, t) } }));
      });
    }
  }
  await paso('avisos al teléfono', async () => {
    const n = await revisarPush(ctx, t);
    if (n > 0) res['push'] = n;
  });
  await paso('reportes programados', async () => {
    const n = await enviarProgramados(ctx, t);
    if (n > 0) res['reporte_programado'] = n;
  });
  return res;
}

const CONTADORES_DEL_RESUMEN = ['ordenes_abiertas', 'ordenes_vencidas', 'entregas_hoy', 'equipos_en_taller', 'citas_hoy', 'solicitudes_pendientes', 'reservas_por_vencer', 'cotizaciones_sin_respuesta', 'servicios_vencidos', 'materiales_bajo_minimo'];

async function textoDelResumen(ctx: Contexto, t: TallerReq): Promise<string> {
  const lineas: string[] = [];
  for (const codigo of CONTADORES_DEL_RESUMEN) {
    const tarjeta = TARJETAS.find((x) => x.codigo === codigo);
    if (!tarjeta) continue;
    lineas.push(`${tarjeta.titulo}: ${await valorDeContador(ctx, t, codigo, 0)}`);
  }
  return lineas.join('\n');
}

/** Recorre todos los talleres que están trabajando. Un taller con problemas no frena a los demás. */
export async function barrerAvisos(ctx: Contexto): Promise<{ talleres: number; avisos: number }> {
  const empresas = await filas<{ slug: string }>(ctx.pool, `SELECT slug FROM empresas WHERE estado IN (${ESTADOS_QUE_TRABAJAN.map(() => '?').join(',')}) AND nombre_bd IS NOT NULL ORDER BY id`, [...ESTADOS_QUE_TRABAJAN]);
  let avisos = 0;
  for (const { slug } of empresas) {
    try {
      const empresa = await buscarEmpresa(ctx, slug);
      if (!empresa) continue;
      const r = await revisarAvisosDeTaller(ctx, { empresa, pool: poolsDe(ctx).obtener(empresa.nombreBd) });
      avisos += Object.values(r).reduce((a, b) => a + b, 0);
    } catch (error) {
      console.error(`[avisos] taller ${slug}:`, error instanceof Error ? error.message : error);
    }
  }
  return { talleres: empresas.length, avisos };
}

/** Manda los avisos al teléfono que están en cola, en todos los talleres que trabajan (cada 30 segundos). */
export async function barrerPush(ctx: Contexto, transporte: TransportePush): Promise<{ talleres: number; enviadas: number }> {
  const empresas = await filas<{ slug: string }>(ctx.pool, `SELECT slug FROM empresas WHERE estado IN (${ESTADOS_QUE_TRABAJAN.map(() => '?').join(',')}) AND nombre_bd IS NOT NULL ORDER BY id`, [...ESTADOS_QUE_TRABAJAN]);
  let enviadas = 0;
  for (const { slug } of empresas) {
    try {
      const empresa = await buscarEmpresa(ctx, slug);
      if (!empresa) continue;
      enviadas += (await enviarPendientesPush(ctx, { empresa, pool: poolsDe(ctx).obtener(empresa.nombreBd) }, transporte)).enviadas;
    } catch (error) {
      console.error(`[push] taller ${slug}:`, error instanceof Error ? error.message : error);
    }
  }
  return { talleres: empresas.length, enviadas };
}
