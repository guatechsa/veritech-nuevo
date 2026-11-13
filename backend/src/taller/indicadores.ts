import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorValidacion } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { limitesDelDia } from '../utils/zona';
import { Actor, bitacora, TallerReq } from './comun';
import { leerConfiguracion } from './configuracion';
import { estadoDeServicios } from './servicios';

/**
 * Indicadores (Fase 7a): UNA sola definición para el tablero, los reportes y las alertas. Dos bases de fecha, siempre rotuladas:
 * dinero y entregas por fecha de CIERRE; carga de trabajo por fecha de CREACIÓN/SOLICITUD. El periodo son días del taller (la hora de
 * Guatemala, no la de UTC). Cada empresa puede ponerles una meta con semáforo.
 */

export type Unidad = 'cantidad' | 'moneda' | 'porcentaje' | 'dias' | 'horas';

export interface DefIndicador {
  codigo: string;
  nombre: string;
  unidad: Unidad;
  base: string;
  financiero: boolean;
  /** Entre más alto es mejor, o entre más bajo es mejor (para el semáforo). */
  sentido: 'mayor' | 'menor';
  descripcion: string;
}

export const CATALOGO: DefIndicador[] = [
  { codigo: 'ordenes_completadas', nombre: 'Órdenes completadas', unidad: 'cantidad', base: 'Por fecha de cierre', financiero: false, sentido: 'mayor', descripcion: 'Órdenes que llegaron a un estado final (sin contar las anuladas) dentro del periodo.' },
  { codigo: 'ticket_promedio', nombre: 'Ticket promedio', unidad: 'moneda', base: 'Por fecha de cierre', financiero: true, sentido: 'mayor', descripcion: 'Lo que se vendió en promedio por orden completada, con descuentos y sin IVA aparte.' },
  { codigo: 'margen', nombre: 'Margen', unidad: 'porcentaje', base: 'Por fecha de cierre', financiero: true, sentido: 'mayor', descripcion: '(Ventas − costo) ÷ ventas de las líneas de las órdenes completadas. La mano de obra cuesta lo que dice el tipo de equipo.' },
  { codigo: 'dias_en_taller', nombre: 'Días en taller', unidad: 'dias', base: 'Por fecha de cierre', financiero: false, sentido: 'menor', descripcion: 'Días que estuvo el equipo dentro del taller, en promedio, por orden completada.' },
  { codigo: 'tiempo_despacho', nombre: 'Tiempo de despacho de bodega', unidad: 'horas', base: 'Por fecha de la solicitud', financiero: false, sentido: 'menor', descripcion: 'Horas desde que se pide un material hasta el primer despacho, en promedio.' },
  { codigo: 'puntualidad_citas', nombre: 'Puntualidad de citas', unidad: 'porcentaje', base: 'Por fecha de la cita', financiero: false, sentido: 'mayor', descripcion: 'De las citas a las que el cliente se presentó, el porcentaje que llegó a la hora (hasta 15 minutos después).' },
  { codigo: 'eficiencia_tecnicos', nombre: 'Eficiencia de técnicos', unidad: 'porcentaje', base: 'Por fecha de fin del trabajo', financiero: false, sentido: 'mayor', descripcion: 'Horas vendidas ÷ horas realmente trabajadas, en los trabajos terminados en el periodo que se midieron con el cronómetro. Más de 100 % es trabajar más rápido que el estándar.' },
  { codigo: 'utilizacion_tecnicos', nombre: 'Utilización de técnicos', unidad: 'porcentaje', base: 'Por fecha del trabajo', financiero: false, sentido: 'mayor', descripcion: 'Horas trabajadas ÷ horas disponibles (técnicos activos × días hábiles × horas de jornada).' },
  { codigo: 'cumplimiento_mantenimiento', nombre: 'Cumplimiento de mantenimiento', unidad: 'porcentaje', base: 'Situación de hoy', financiero: false, sentido: 'mayor', descripcion: 'De los servicios programados de los equipos, el porcentaje que está al día o apenas por llegar (no vencido ni urgente).' },
  { codigo: 'retrabajos', nombre: 'Retrabajos', unidad: 'porcentaje', base: 'Por fecha de reapertura', financiero: false, sentido: 'menor', descripcion: 'Órdenes que se reabrieron en el periodo ÷ órdenes completadas en el periodo.' },
  { codigo: 'autorizacion_lineas', nombre: 'Cotizaciones autorizadas (líneas)', unidad: 'porcentaje', base: 'Por fecha de envío', financiero: false, sentido: 'mayor', descripcion: 'Del total de líneas cotizadas y enviadas, el porcentaje que el cliente autorizó.' },
  { codigo: 'autorizacion_valor', nombre: 'Cotizaciones autorizadas (valor)', unidad: 'porcentaje', base: 'Por fecha de envío', financiero: true, sentido: 'mayor', descripcion: 'Del valor cotizado y enviado, el porcentaje que el cliente autorizó (potencial de venta adicional).' },
];

export interface Filtros {
  desde: string;
  hasta: string;
  sucursal_id?: number;
  tipo_equipo_id?: number;
}

export interface Meta {
  indicador: string;
  sentido: 'mayor' | 'menor';
  meta: number;
  limite: number | null;
}

export type Semaforo = 'verde' | 'amarillo' | 'rojo';

export function semaforoDe(valor: number | null, m: Meta | undefined): Semaforo | null {
  if (valor === null || !m) return null;
  if (m.sentido === 'mayor') return valor >= m.meta ? 'verde' : m.limite !== null && valor >= m.limite ? 'amarillo' : 'rojo';
  return valor <= m.meta ? 'verde' : m.limite !== null && valor <= m.limite ? 'amarillo' : 'rojo';
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export function validarPeriodo(f: Filtros): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.desde) || !/^\d{4}-\d{2}-\d{2}$/.test(f.hasta)) throw new ErrorValidacion('Indique el periodo con fechas válidas');
  for (const x of [f.desde, f.hasta]) {
    const t = Date.parse(`${x}T00:00:00Z`);
    if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== x) throw new ErrorValidacion('Una de las fechas del periodo no existe en el calendario');
  }
  if (f.hasta < f.desde) throw new ErrorValidacion('La fecha final no puede ser anterior a la inicial');
  if ((Date.parse(`${f.hasta}T00:00:00Z`) - Date.parse(`${f.desde}T00:00:00Z`)) / 86400000 > 731) throw new ErrorValidacion('El periodo no puede pasar de dos años');
}

/** Días hábiles (lunes a viernes) entre dos fechas locales, inclusive. */
export function diasHabiles(desde: string, hasta: string): number {
  let n = 0;
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= Date.parse(`${hasta}T00:00:00Z`); t += 86400000) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) n++;
  }
  return n;
}

/** Calcula el valor de cada indicador del catálogo para el periodo y los filtros (sin dinero si `conDinero` es falso: ni siquiera se calcula). */
export async function calcularValores(ctx: Contexto, t: TallerReq, f: Filtros, conDinero: boolean): Promise<Record<string, { valor: number | null; detalle?: Record<string, number> }>> {
  validarPeriodo(f);
  const zona = t.empresa.zonaHoraria;
  const d = limitesDelDia(f.desde, zona).desde;
  const h = limitesDelDia(f.hasta, zona).hasta;
  const cfg = await leerConfiguracion(t);
  const incluyeIva = String(cfg['precios_incluyen_iva']) === 'true';
  const horasJornada = Math.max(1, Number(cfg['horas_jornada'] ?? 8));
  const filtroOrden = (alias = 'o'): { sql: string; params: unknown[] } => {
    const sql: string[] = [];
    const params: unknown[] = [];
    if (f.sucursal_id) {
      sql.push(`${alias}.sucursal_id = ?`);
      params.push(f.sucursal_id);
    }
    if (f.tipo_equipo_id) {
      sql.push('e.tipo_equipo_id = ?');
      params.push(f.tipo_equipo_id);
    }
    return { sql: sql.length ? ` AND ${sql.join(' AND ')}` : '', params };
  };
  const fo = filtroOrden();
  const salida: Record<string, { valor: number | null; detalle?: Record<string, number> }> = {};

  // Órdenes completadas (base de varios indicadores).
  const base = `FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id JOIN equipos e ON e.id = o.equipo_id WHERE es.es_terminal = 1 AND es.es_cancelado = 0 AND o.fecha_cierre >= ? AND o.fecha_cierre < ?${fo.sql}`;
  const pBase = [d, h, ...fo.params];
  const completadas = Number((await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${base}`, pBase))?.n ?? 0);
  salida['ordenes_completadas'] = { valor: completadas };
  if (conDinero) {
    const tk = await una<{ v: number | null }>(t.pool, `SELECT AVG(o.subtotal - o.descuento_total - ${incluyeIva ? 'o.iva' : '0'}) AS v ${base}`, pBase);
    salida['ticket_promedio'] = { valor: completadas === 0 ? null : r2(Number(tk?.v ?? 0)) };
    const mg = await una<{ v: number | null; c: number | null }>(t.pool, `SELECT SUM(l.total_linea) AS v, SUM(l.costo) AS c FROM lineas_orden l JOIN ordenes o ON o.id = l.orden_id JOIN estados_orden es ON es.id = o.estado_id JOIN equipos e ON e.id = o.equipo_id WHERE l.anulada_en IS NULL AND es.es_terminal = 1 AND es.es_cancelado = 0 AND o.fecha_cierre >= ? AND o.fecha_cierre < ?${fo.sql}`, pBase);
    const ventas = Number(mg?.v ?? 0);
    salida['margen'] = { valor: ventas > 0 ? r2(((ventas - Number(mg?.c ?? 0)) / ventas) * 100) : null, detalle: { ventas: r2(ventas), costo: r2(Number(mg?.c ?? 0)) } };
  }
  const dt = await una<{ v: number | null }>(t.pool, `SELECT AVG(x.d) AS v FROM (SELECT o.id, SUM(TIMESTAMPDIFF(SECOND, i.entrada_en, COALESCE(i.salida_en, o.fecha_cierre))) / 86400 AS d FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id JOIN equipos e ON e.id = o.equipo_id JOIN ingresos_equipo i ON i.orden_id = o.id WHERE es.es_terminal = 1 AND es.es_cancelado = 0 AND o.fecha_cierre >= ? AND o.fecha_cierre < ?${fo.sql} GROUP BY o.id) x`, pBase);
  salida['dias_en_taller'] = { valor: dt?.v === null || dt?.v === undefined ? null : r2(Number(dt.v)) };

  const desp = await una<{ v: number | null; n: number }>(t.pool, `SELECT AVG(TIMESTAMPDIFF(MINUTE, s.solicitada_en, s.primer_despacho_en)) / 60 AS v, COUNT(*) AS n FROM solicitudes_material s JOIN ordenes o ON o.id = s.orden_id JOIN equipos e ON e.id = o.equipo_id WHERE s.primer_despacho_en IS NOT NULL AND s.solicitada_en >= ? AND s.solicitada_en < ?${fo.sql}`, pBase);
  salida['tiempo_despacho'] = { valor: desp?.v === null || desp?.v === undefined ? null : r2(Number(desp.v)), detalle: { solicitudes: Number(desp?.n ?? 0) } };

  const fc = filtroOrden('c');
  const ci = await una<{ n: number; p: number | null }>(t.pool, `SELECT COUNT(*) AS n, SUM(c.llegada_en <= DATE_ADD(c.fecha_hora, INTERVAL 15 MINUTE)) AS p FROM citas c JOIN equipos e ON e.id = c.equipo_id WHERE c.estado = 'se_presento' AND c.llegada_en IS NOT NULL AND c.fecha_hora >= ? AND c.fecha_hora < ?${fc.sql}`, [d, h, ...fc.params]);
  salida['puntualidad_citas'] = { valor: Number(ci?.n ?? 0) === 0 ? null : r2((Number(ci?.p ?? 0) / Number(ci?.n)) * 100), detalle: { citas: Number(ci?.n ?? 0) } };

  const ef = await una<{ vendidas: number | null; reales: number | null }>(
    t.pool,
    `SELECT SUM(x.horas_trabajo) AS vendidas, SUM(x.seg) / 3600 AS reales FROM (
        SELECT l.id, l.horas_trabajo, COALESCE((SELECT SUM(TIMESTAMPDIFF(SECOND, r.inicio, r.fin)) FROM registros_tiempo r WHERE r.linea_id = l.id AND r.fin IS NOT NULL), 0) AS seg
          FROM lineas_orden l JOIN ordenes o ON o.id = l.orden_id JOIN equipos e ON e.id = o.equipo_id
         WHERE l.tipo = 'servicio' AND l.estado = 'terminado' AND l.anulada_en IS NULL AND l.fin_en >= ? AND l.fin_en < ?${fo.sql}
           AND EXISTS (SELECT 1 FROM registros_tiempo r2 WHERE r2.linea_id = l.id AND r2.fin IS NOT NULL)) x`,
    pBase
  );
  const reales = Number(ef?.reales ?? 0);
  salida['eficiencia_tecnicos'] = { valor: reales > 0 ? r2((Number(ef?.vendidas ?? 0) / reales) * 100) : null, detalle: { horas_vendidas: r2(Number(ef?.vendidas ?? 0)), horas_trabajadas: r2(reales) } };

  const tr = await una<{ h: number | null }>(t.pool, `SELECT SUM(TIMESTAMPDIFF(SECOND, r.inicio, r.fin)) / 3600 AS h FROM registros_tiempo r JOIN lineas_orden l ON l.id = r.linea_id JOIN ordenes o ON o.id = l.orden_id JOIN equipos e ON e.id = o.equipo_id WHERE r.fin IS NOT NULL AND r.inicio >= ? AND r.inicio < ?${fo.sql}`, pBase);
  const tecnicos = Number((await una<{ n: number }>(t.pool, "SELECT COUNT(DISTINCT u.id) AS n FROM usuarios u JOIN usuario_roles ur ON ur.usuario_id = u.id JOIN roles r ON r.id = ur.rol_id WHERE u.activo = 1 AND r.codigo = 'tecnico'"))?.n ?? 0);
  const disponibles = tecnicos * diasHabiles(f.desde, f.hasta) * horasJornada;
  salida['utilizacion_tecnicos'] = { valor: disponibles > 0 ? r2((Number(tr?.h ?? 0) / disponibles) * 100) : null, detalle: { horas_trabajadas: r2(Number(tr?.h ?? 0)), horas_disponibles: disponibles, tecnicos } };

  const servicios = await estadoDeServicios(ctx, t, f.tipo_equipo_id ? { tipo_equipo_id: f.tipo_equipo_id } : {});
  const conReloj = servicios.filter((s) => s.estado !== 'sin_contador');
  const cumplen = conReloj.filter((s) => s.estado === 'al_dia' || s.estado === 'proximo').length;
  salida['cumplimiento_mantenimiento'] = { valor: conReloj.length === 0 ? null : r2((cumplen / conReloj.length) * 100), detalle: { servicios: conReloj.length, vencidos: conReloj.filter((s) => s.estado === 'vencido').length } };

  const re = await una<{ n: number }>(
    t.pool,
    `SELECT COUNT(DISTINCT x.orden_id) AS n FROM (
        SELECT h.orden_id, h.desde, es.es_terminal AS fin, LAG(es.es_terminal) OVER (PARTITION BY h.orden_id ORDER BY h.id) AS antes
          FROM orden_estados_historial h JOIN estados_orden es ON es.id = h.estado_id) x
      JOIN ordenes o ON o.id = x.orden_id JOIN equipos e ON e.id = o.equipo_id WHERE x.antes = 1 AND x.fin = 0 AND x.desde >= ? AND x.desde < ?${fo.sql}`,
    pBase
  );
  salida['retrabajos'] = { valor: completadas === 0 ? null : r2((Number(re?.n ?? 0) / completadas) * 100), detalle: { reabiertas: Number(re?.n ?? 0), completadas } };

  const fa = filtroOrden('o');
  const au = await una<{ n: number; a: number | null; v: number | null; va: number | null }>(
    t.pool,
    `SELECT COUNT(*) AS n, SUM(l.estado IN ('autorizada', 'agregada_a_orden')) AS a, SUM(l.total_linea) AS v, SUM(CASE WHEN l.estado IN ('autorizada', 'agregada_a_orden') THEN l.total_linea ELSE 0 END) AS va
       FROM cotizacion_lineas l JOIN cotizaciones c ON c.id = l.cotizacion_id LEFT JOIN equipos e ON e.id = c.equipo_id LEFT JOIN ordenes o ON o.id = c.orden_id
      WHERE c.estado IN ('enviada', 'respondida', 'vencida') AND c.enviada_en >= ? AND c.enviada_en < ?${fa.sql}`,
    [d, h, ...fa.params]
  );
  salida['autorizacion_lineas'] = { valor: Number(au?.n ?? 0) === 0 ? null : r2((Number(au?.a ?? 0) / Number(au?.n)) * 100), detalle: { lineas: Number(au?.n ?? 0), autorizadas: Number(au?.a ?? 0) } };
  if (conDinero) salida['autorizacion_valor'] = { valor: Number(au?.v ?? 0) === 0 ? null : r2((Number(au?.va ?? 0) / Number(au?.v)) * 100), detalle: { cotizado: r2(Number(au?.v ?? 0)), autorizado: r2(Number(au?.va ?? 0)) } };
  return salida;
}

export async function listarMetas(t: TallerReq): Promise<Meta[]> {
  const f = await filas<{ indicador: string; sentido: 'mayor' | 'menor'; meta: number; limite: number | null }>(t.pool, 'SELECT indicador, sentido, meta, limite FROM metas_indicadores ORDER BY indicador');
  return f.map((m) => ({ indicador: m.indicador, sentido: m.sentido, meta: Number(m.meta), limite: num(m.limite) }));
}

export async function indicadores(ctx: Contexto, t: TallerReq, f: Filtros, conDinero: boolean) {
  const valores = await calcularValores(ctx, t, f, conDinero);
  const metas = await listarMetas(t);
  return CATALOGO.filter((c) => conDinero || !c.financiero).map((c) => {
    const v = valores[c.codigo]?.valor ?? null;
    const m = metas.find((x) => x.indicador === c.codigo);
    return { ...c, valor: v, detalle: valores[c.codigo]?.detalle ?? null, meta: m ?? null, semaforo: semaforoDe(v, m) };
  });
}

export async function definirMeta(t: TallerReq, actor: Actor, codigo: string, d: { meta: number; limite?: number | null; sentido?: 'mayor' | 'menor' }) {
  const def = CATALOGO.find((c) => c.codigo === codigo);
  if (!def) throw new ErrorValidacion('Ese indicador no existe');
  const sentido = d.sentido ?? def.sentido;
  const limite = d.limite ?? null;
  if (limite !== null && (sentido === 'mayor' ? limite > d.meta : limite < d.meta)) throw new ErrorValidacion(sentido === 'mayor' ? 'El límite del amarillo debe ser menor o igual que la meta' : 'El límite del amarillo debe ser mayor o igual que la meta');
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'INSERT INTO metas_indicadores (indicador, sentido, meta, limite, actualizado_por_id) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE sentido = VALUES(sentido), meta = VALUES(meta), limite = VALUES(limite), actualizado_por_id = VALUES(actualizado_por_id)', [codigo, sentido, d.meta, limite, actor.usuarioId]);
    await bitacora(con, actor, { accion: 'meta_definida', entidad: 'metas_indicadores', despues: { codigo, ...d, sentido } });
  });
  return listarMetas(t);
}

export async function quitarMeta(t: TallerReq, actor: Actor, codigo: string) {
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'DELETE FROM metas_indicadores WHERE indicador = ?', [codigo]);
    await bitacora(con, actor, { accion: 'meta_quitada', entidad: 'metas_indicadores', despues: { codigo } });
  });
  return listarMetas(t);
}

/**
 * Por qué rechazan los clientes lo que se les cotiza: la distribución de motivos y su corte por tipo de equipo, cliente e ítem del checklist.
 * El valor rechazado (dinero) solo sale con el permiso de reportes financieros.
 */
export async function rechazosDeCotizaciones(_ctx: Contexto, t: TallerReq, f: Filtros, conDinero: boolean) {
  validarPeriodo(f);
  const zona = t.empresa.zonaHoraria;
  const d = limitesDelDia(f.desde, zona).desde;
  const h = limitesDelDia(f.hasta, zona).hasta;
  const filtros: string[] = [];
  const params: unknown[] = [d, h];
  if (f.sucursal_id) {
    filtros.push('o.sucursal_id = ?');
    params.push(f.sucursal_id);
  }
  if (f.tipo_equipo_id) {
    filtros.push('e.tipo_equipo_id = ?');
    params.push(f.tipo_equipo_id);
  }
  const de = `FROM cotizacion_lineas l JOIN cotizaciones c ON c.id = l.cotizacion_id LEFT JOIN motivos mo ON mo.id = l.motivo_rechazo_id LEFT JOIN equipos e ON e.id = c.equipo_id LEFT JOIN tipos_equipo te ON te.id = e.tipo_equipo_id
              LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN ordenes o ON o.id = c.orden_id LEFT JOIN checklist_respuestas r ON r.id = l.respuesta_id
             WHERE l.estado = 'rechazada' AND l.respondida_en >= ? AND l.respondida_en < ?${filtros.length ? ` AND ${filtros.join(' AND ')}` : ''}`;
  const corte = async (columna: string, limite = 10) =>
    (await filas<{ nombre: string | null; lineas: number; valor: number | null }>(t.pool, `SELECT ${columna} AS nombre, COUNT(*) AS lineas, SUM(l.total_linea) AS valor ${de} GROUP BY ${columna} ORDER BY lineas DESC, nombre LIMIT ${limite}`, params)).map((x) => ({
      nombre: x.nombre ?? 'Sin dato',
      lineas: Number(x.lineas),
      ...(conDinero ? { valor: r2(Number(x.valor ?? 0)) } : {}),
    }));
  const total = await una<{ n: number; v: number | null }>(t.pool, `SELECT COUNT(*) AS n, SUM(l.total_linea) AS v ${de}`, params);
  return {
    total_lineas: Number(total?.n ?? 0),
    ...(conDinero ? { total_valor: r2(Number(total?.v ?? 0)) } : {}),
    por_motivo: await corte('mo.nombre'),
    por_tipo_equipo: await corte('te.nombre'),
    por_cliente: await corte('cl.nombre'),
    por_item: await corte('CONCAT_WS(" › ", r.seccion, r.descripcion)'),
  };
}
