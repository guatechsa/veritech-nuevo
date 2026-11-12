import { PoolConnection } from 'mysql2/promise';
import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { validarFechaRazonable } from '../utils/fechas';
import { normalizarCampo } from '../utils/texto';
import { borrarArchivo, guardarArchivo, urlFirmada } from './archivos';
import { checklistsPendientes } from './checklists';
import { Actor, bitacora, siguienteNumero, TallerReq } from './comun';
import { leerConfiguracion } from './configuracion';
import { hoyDelTaller, registrarLecturaEn } from './contadores';
import { descripcionDeEquipo } from './equipos';

/**
 * Órdenes de trabajo (Fase 4a). Reglas que el servidor hace cumplir:
 *  - La orden se anula con motivo, nunca se borra; una orden en estado terminal no se toca (salvo reabrirla con motivo y permiso).
 *  - El precio de un servicio es horas × tarifa por hora; se guarda una copia de la tarifa y del costo del momento.
 *  - Descuentos, IVA y totales los calcula el servidor y quedan guardados.
 *  - No se cierra una orden con trabajos sin terminar.
 *  - El equipo entra y sale físicamente según el estado de la orden (`ingresos_equipo`).
 */

/** Qué datos delicados puede ver quien pide: sin permiso, los precios y costos NUNCA salen del servidor. */
export interface Vista {
  precios: boolean;
  costos: boolean;
}

export type Prioridad = 'baja' | 'media' | 'alta' | 'urgente';
export const ESTADOS_DE_LINEA = ['pendiente', 'en_proceso', 'pausado', 'detenido_material', 'detenido_terceros', 'detenido_autorizacion', 'detenido_espacio', 'terminado'] as const;
export type EstadoLinea = (typeof ESTADOS_DE_LINEA)[number];

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const ACTIVA = 'anulada_en IS NULL';

// ── Consultas de apoyo ────────────────────────────────────────────────────────────────
interface OrdenCruda {
  id: number;
  numero: string;
  equipo_id: number;
  cliente_id: number | null;
  tipo_orden_id: number;
  area_trabajo_id: number | null;
  estado_id: number;
  es_terminal: number;
  es_cancelado: number;
  sale_equipo: number;
  es_pedido_especial: number;
  tipo_codigo: string;
}

async function ordenCruda(con: Ejecutor, id: number, bloquear = false): Promise<OrdenCruda> {
  const o = await una<OrdenCruda>(
    con,
    `SELECT o.id, o.numero, o.equipo_id, o.cliente_id, o.tipo_orden_id, o.area_trabajo_id, o.estado_id, es.es_terminal, es.es_cancelado, es.sale_equipo, tor.es_pedido_especial, tor.codigo AS tipo_codigo
       FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id JOIN tipos_orden tor ON tor.id = o.tipo_orden_id WHERE o.id = ? ${bloquear ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!o) throw new ErrorNoEncontrado('No se encontró la orden');
  return o;
}

function exigirAbierta(o: OrdenCruda): void {
  if (o.es_terminal === 1) throw new ErrorApp(409, 'ORDEN_CERRADA', `La orden ${o.numero} está cerrada o anulada y ya no se puede modificar. Para cambiarla hay que reabrirla con un motivo.`);
}

/** Calcula y guarda subtotal, descuento, IVA y total de la orden con las líneas que siguen vigentes. */
export async function recalcularTotales(con: Ejecutor, ordenId: number, cfg: { ivaPct: number; incluyeIva: boolean }): Promise<void> {
  const s = await una<{ bruto: number | null; neto: number | null }>(con, `SELECT SUM(precio_unitario * cantidad) AS bruto, SUM(total_linea) AS neto FROM lineas_orden WHERE orden_id = ? AND ${ACTIVA}`, [ordenId]);
  const bruto = r2(Number(s?.bruto ?? 0));
  const neto = r2(Number(s?.neto ?? 0));
  const descuento = r2(bruto - neto);
  let iva: number;
  let total: number;
  if (cfg.incluyeIva) {
    iva = r2(neto - neto / (1 + cfg.ivaPct / 100));
    total = neto;
  } else {
    iva = r2((neto * cfg.ivaPct) / 100);
    total = r2(neto + iva);
  }
  await ejecutar(con, 'UPDATE ordenes SET subtotal = ?, descuento_total = ?, iva = ?, total = ? WHERE id = ?', [bruto, descuento, iva, total, ordenId]);
}

async function configDePrecios(t: TallerReq): Promise<{ ivaPct: number; incluyeIva: boolean }> {
  const c = await leerConfiguracion(t);
  return { ivaPct: Number(c['iva_porcentaje'] ?? 12), incluyeIva: c['precios_incluyen_iva'] === 'true' };
}

// ── Opciones para los formularios ─────────────────────────────────────────────────────
export async function opcionesDeOrden(t: TallerReq) {
  const [tipos, estados, responsables, sucursales, areas, motivos, excepciones] = await Promise.all([
    filas<{ id: number; codigo: string; nombre: string; es_default: number; es_pedido_especial: number }>(t.pool, 'SELECT id, codigo, nombre, es_default, es_pedido_especial FROM tipos_orden WHERE activo = 1 ORDER BY es_default DESC, nombre'),
    filas<{ id: number; codigo: string; nombre: string; color: string; es_inicial: number; es_terminal: number; es_cancelado: number }>(t.pool, 'SELECT id, codigo, nombre, color, es_inicial, es_terminal, es_cancelado FROM estados_orden WHERE activo = 1 ORDER BY orden, id'),
    filas<{ id: number; nombre: string }>(t.pool, 'SELECT id, nombre_completo AS nombre FROM colaboradores WHERE activo = 1 ORDER BY nombre_completo'),
    filas<{ id: number; nombre: string; es_principal: number }>(t.pool, 'SELECT id, nombre, es_principal FROM sucursales WHERE activo = 1 ORDER BY es_principal DESC, nombre'),
    filas<{ id: number; nombre: string }>(t.pool, 'SELECT id, nombre FROM areas_trabajo WHERE activo = 1 ORDER BY nombre'),
    filas<{ id: number; nombre: string }>(t.pool, "SELECT id, nombre FROM motivos WHERE tipo = 'anulacion_orden' AND activo = 1 ORDER BY nombre"),
    filas<{ id: number; nombre: string }>(t.pool, "SELECT id, nombre FROM motivos WHERE tipo = 'excepcion_checklist' AND activo = 1 ORDER BY nombre"),
  ]);
  return { tipos_orden: tipos, estados, responsables, sucursales, areas, motivos_anulacion: motivos, motivos_excepcion: excepciones, prioridades: ['baja', 'media', 'alta', 'urgente'], estados_de_linea: ESTADOS_DE_LINEA };
}

// ── Listado ───────────────────────────────────────────────────────────────────────────
export async function listarOrdenes(t: TallerReq, vista: Vista, f: { buscar?: string; estado_id?: number; tipo_orden_id?: number; cliente_id?: number; equipo_id?: number; abiertas?: boolean; pagina: number; porPagina: number }) {
  const donde: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (f.estado_id) {
    donde.push('o.estado_id = ?');
    params.push(f.estado_id);
  }
  if (f.tipo_orden_id) {
    donde.push('o.tipo_orden_id = ?');
    params.push(f.tipo_orden_id);
  }
  if (f.cliente_id) {
    donde.push('o.cliente_id = ?');
    params.push(f.cliente_id);
  }
  if (f.equipo_id) {
    donde.push('o.equipo_id = ?');
    params.push(f.equipo_id);
  }
  if (f.abiertas === true) donde.push('es.es_terminal = 0');
  if (f.abiertas === false) donde.push('es.es_terminal = 1');
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    donde.push('(o.numero LIKE ? OR e.codigo_interno LIKE ? OR e.placa LIKE ? OR e.serie LIKE ? OR c.nombre LIKE ? OR o.descripcion LIKE ?)');
    params.push(patron, patron, patron, patron, patron, patron);
  }
  const de = `FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id JOIN tipos_orden tor ON tor.id = o.tipo_orden_id JOIN equipos e ON e.id = o.equipo_id
              LEFT JOIN marcas m ON m.id = e.marca_id LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN colaboradores co ON co.id = o.responsable_id WHERE ${donde.join(' AND ')}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${de}`, params);
  const registros = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT o.id, o.numero, o.prioridad, o.descripcion, o.fecha_estimada_entrega, o.created_at, o.fecha_cierre, o.total,
            c.nombre AS cliente, e.id AS equipo_id, e.codigo_interno, e.placa, m.nombre AS marca, e.modelo, tor.nombre AS tipo, tor.es_pedido_especial,
            es.nombre AS estado, es.color AS estado_color, es.es_terminal, es.es_cancelado, co.nombre_completo AS responsable,
            (SELECT COUNT(*) FROM ingresos_equipo i WHERE i.orden_id = o.id AND i.salida_en IS NULL) AS equipo_en_taller
       ${de} ORDER BY es.es_terminal, o.id DESC LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return {
    total: Number(total?.n ?? 0),
    pagina: f.pagina,
    porPagina: f.porPagina,
    registros: registros.map((r) => {
      const { total: monto, ...resto } = r as { total: number } & Record<string, unknown>;
      return { ...resto, equipo: descripcionDeEquipo({ id: Number(r['equipo_id']), codigo_interno: r['codigo_interno'] as string | null, placa: r['placa'] as string | null, marca: r['marca'] as string | null, modelo: r['modelo'] as string | null }), ...(vista.precios ? { total: Number(monto) } : {}) };
    }),
  };
}

// ── Ficha ─────────────────────────────────────────────────────────────────────────────
export async function obtenerOrden(ctx: Contexto, t: TallerReq, id: number, vista: Vista) {
  const o = await una<Record<string, unknown>>(
    t.pool,
    `SELECT o.*, c.nombre AS cliente, e.codigo_interno, e.placa, e.serie, e.modelo, m.nombre AS marca, te.nombre AS tipo_equipo, te.id AS tipo_equipo_id, e.estado AS equipo_estado,
            tor.codigo AS tipo_codigo, tor.nombre AS tipo, tor.es_pedido_especial, es.codigo AS estado_codigo, es.nombre AS estado, es.color AS estado_color,
            es.es_terminal, es.es_cancelado, s.nombre AS sucursal, ar.nombre AS area, co.nombre_completo AS responsable, mo.nombre AS motivo_anulacion
       FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id JOIN tipos_orden tor ON tor.id = o.tipo_orden_id JOIN equipos e ON e.id = o.equipo_id JOIN tipos_equipo te ON te.id = e.tipo_equipo_id
       JOIN sucursales s ON s.id = o.sucursal_id LEFT JOIN marcas m ON m.id = e.marca_id LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN areas_trabajo ar ON ar.id = o.area_trabajo_id
       LEFT JOIN colaboradores co ON co.id = o.responsable_id LEFT JOIN motivos mo ON mo.id = o.motivo_anulacion_id WHERE o.id = ?`,
    [id]
  );
  if (!o) throw new ErrorNoEncontrado('No se encontró la orden');
  const lineas = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT l.id, l.tipo, l.trabajo_id, tr.codigo AS trabajo_codigo, l.proveedor_id, p.nombre AS proveedor, l.descripcion, l.cantidad, l.precio_unitario, l.descuento_pct, l.total_linea, l.costo,
            l.horas_trabajo, l.tarifa_hora_aplicada, l.costo_hora_aplicado, l.area_trabajo_id, ar.nombre AS area, l.tecnico_id, co.nombre_completo AS tecnico, l.estado,
            l.inicio_en, l.pausa_en, l.fin_en, l.notas, l.anulada_en, l.motivo_anulacion,
            (SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, r.inicio, COALESCE(r.fin, ?))), 0) FROM registros_tiempo r WHERE r.linea_id = l.id) AS segundos,
            EXISTS(SELECT 1 FROM registros_tiempo r WHERE r.linea_id = l.id AND r.fin IS NULL) AS en_curso
       FROM lineas_orden l LEFT JOIN trabajos tr ON tr.id = l.trabajo_id LEFT JOIN proveedores p ON p.id = l.proveedor_id LEFT JOIN areas_trabajo ar ON ar.id = l.area_trabajo_id
       LEFT JOIN colaboradores co ON co.id = l.tecnico_id WHERE l.orden_id = ? ORDER BY l.id`,
    [ahoraDe(ctx), id]
  );
  const fotos = await filas<{ id: number; linea_id: number; archivo_id: number; tipo: string; descripcion: string | null }>(
    t.pool,
    'SELECT f.id, f.linea_id, f.archivo_id, f.tipo, f.descripcion FROM linea_fotos f JOIN lineas_orden l ON l.id = f.linea_id WHERE l.orden_id = ? ORDER BY f.id',
    [id]
  );
  const historial = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT h.id, es.nombre AS estado, es.color AS estado_color, h.desde, h.motivo, co.nombre_completo AS usuario
       FROM orden_estados_historial h JOIN estados_orden es ON es.id = h.estado_id LEFT JOIN usuarios u ON u.id = h.usuario_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id
      WHERE h.orden_id = ? ORDER BY h.id`,
    [id]
  );
  const ingresos = await filas<{ id: number; entrada_en: Date; salida_en: Date | null }>(t.pool, 'SELECT id, entrada_en, salida_en FROM ingresos_equipo WHERE orden_id = ? ORDER BY id', [id]);
  const ahora = ahoraDe(ctx).getTime();
  const msEnTaller = ingresos.reduce((s, i) => s + ((i.salida_en ? i.salida_en.getTime() : ahora) - i.entrada_en.getTime()), 0);
  const lecturas = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT l.id, l.valor, DATE_FORMAT(l.fecha, '%Y-%m-%d') AS fecha, ct.nombre AS contador FROM lecturas_contador l JOIN contadores ct ON ct.id = l.contador_id WHERE l.orden_id = ? AND l.estado <> 'anulada' ORDER BY l.id`,
    [id]
  );

  const sinDinero = (l: Record<string, unknown>): Record<string, unknown> => {
    const copia = { ...l };
    if (!vista.precios) for (const k of ['precio_unitario', 'descuento_pct', 'total_linea', 'tarifa_hora_aplicada']) delete copia[k];
    if (!vista.costos) for (const k of ['costo', 'costo_hora_aplicado']) delete copia[k];
    return copia;
  };
  const { subtotal, descuento_total, iva, total, ...resto } = o as { subtotal: number; descuento_total: number; iva: number; total: number } & Record<string, unknown>;
  return {
    ...resto,
    equipo: descripcionDeEquipo({ id: Number(o['equipo_id']), codigo_interno: o['codigo_interno'] as string | null, placa: o['placa'] as string | null, marca: o['marca'] as string | null, modelo: o['modelo'] as string | null, tipo_equipo: o['tipo_equipo'] as string }),
    ...(vista.precios ? { subtotal: Number(subtotal), descuento_total: Number(descuento_total), iva: Number(iva), total: Number(total) } : {}),
    lineas: lineas.map((l) => {
      const { segundos, en_curso, ...resto2 } = sinDinero(l) as { segundos: number; en_curso: number } & Record<string, unknown>;
      return {
        ...resto2,
        horas_reales: Math.round((Number(segundos) / 3600) * 100) / 100,
        en_curso: Number(en_curso) === 1,
        fotos: fotos.filter((f) => f.linea_id === l['id']).map((f) => ({ id: f.id, tipo: f.tipo, descripcion: f.descripcion, url: urlFirmada(ctx, t.empresa.slug, f.archivo_id) })),
      };
    }),
    historial,
    ingresos: ingresos.length,
    equipo_en_taller: ingresos.some((i) => i.salida_en === null),
    dias_en_taller: ingresos.length === 0 ? null : Math.floor(msEnTaller / 86400000),
    lecturas,
  };
}

// ── Crear y editar ────────────────────────────────────────────────────────────────────
export interface DatosOrden {
  prioridad?: Prioridad;
  descripcion?: string | null;
  area_trabajo_id?: number | null;
  responsable_id?: number | null;
  fecha_estimada_entrega?: string | null;
  referencia_factura_externa?: string | null;
  notificar_nombre?: string | null;
  notificar_correo?: string | null;
  notificar_telefono?: string | null;
}

export interface DatosOrdenNueva extends DatosOrden {
  equipo_id: number;
  tipo_orden_id?: number;
  sucursal_id?: number;
  /** Lo que marca el medidor al recibir el equipo. */
  lectura?: { contador_id: number; valor: number };
}

async function validarReferencias(con: Ejecutor, d: DatosOrden, hoy: string): Promise<void> {
  if (d.area_trabajo_id) {
    const a = await una<{ activo: number }>(con, 'SELECT activo FROM areas_trabajo WHERE id = ?', [d.area_trabajo_id]);
    if (!a || a.activo !== 1) throw new ErrorValidacion('El área de trabajo elegida no existe o está desactivada');
  }
  if (d.responsable_id) {
    const r = await una<{ activo: number }>(con, 'SELECT activo FROM colaboradores WHERE id = ?', [d.responsable_id]);
    if (!r || r.activo !== 1) throw new ErrorValidacion('El responsable elegido no existe o está desactivado');
  }
  if (d.fecha_estimada_entrega) {
    validarFechaRazonable(d.fecha_estimada_entrega, 'fecha_estimada_entrega', { hoy });
    if (d.fecha_estimada_entrega < hoy) throw new ErrorValidacion('La fecha estimada de entrega no puede ser anterior a hoy');
  }
}

function textosDe(d: DatosOrden) {
  return {
    descripcion: d.descripcion === undefined ? undefined : normalizarCampo('multilinea', d.descripcion),
    referencia: d.referencia_factura_externa === undefined ? undefined : normalizarCampo('codigo', d.referencia_factura_externa),
    nombre: d.notificar_nombre === undefined ? undefined : normalizarCampo('texto', d.notificar_nombre),
    correo: d.notificar_correo === undefined ? undefined : normalizarCampo('correo', d.notificar_correo),
    telefono: d.notificar_telefono === undefined ? undefined : normalizarCampo('telefono', d.notificar_telefono),
  };
}

/** Crea la orden dentro de una transacción ya abierta (la usa también «recibir una cita», que además marca la cita como presentada). */
export async function crearOrdenEn(ctx: Contexto, t: TallerReq, con: PoolConnection, actor: Actor, d: DatosOrdenNueva & { cita_id?: number | null }): Promise<{ id: number; avisos: Array<{ tipo: string; numero: string }> }> {
  const hoy = hoyDelTaller(ctx, t);
  const ahora = ahoraDe(ctx);
  const txt = textosDe(d);
  const e = await una<{ estado: string; cliente_id: number | null }>(con, 'SELECT estado, cliente_id FROM equipos WHERE id = ? FOR UPDATE', [d.equipo_id]);
  if (!e) throw new ErrorValidacion('El equipo elegido no existe');
  if (e.estado === 'baja') throw new ErrorApp(409, 'REGLA', 'El equipo está dado de baja: reactívelo antes de abrirle una orden.');
  const tipo = d.tipo_orden_id
    ? await una<{ id: number; codigo: string; es_pedido_especial: number; activo: number }>(con, 'SELECT id, codigo, es_pedido_especial, activo FROM tipos_orden WHERE id = ?', [d.tipo_orden_id])
    : await una<{ id: number; codigo: string; es_pedido_especial: number; activo: number }>(con, 'SELECT id, codigo, es_pedido_especial, activo FROM tipos_orden WHERE es_default = 1 AND activo = 1 LIMIT 1');
  if (!tipo || tipo.activo !== 1) throw new ErrorValidacion('El tipo de orden elegido no existe o está desactivado');
  const estado = await una<{ id: number }>(con, 'SELECT id FROM estados_orden WHERE es_inicial = 1 AND activo = 1 ORDER BY orden, id LIMIT 1');
  if (!estado) throw new ErrorApp(409, 'REGLA', 'El taller no tiene un estado inicial de orden activo. Revise los estados de orden.');
  let sucursalId = d.sucursal_id ?? null;
  if (!sucursalId) {
    const propia = await una<{ id: number }>(con, 'SELECT s.id FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id JOIN sucursales s ON s.id = c.sucursal_id WHERE u.id = ? AND s.activo = 1', [actor.usuarioId]);
    sucursalId = propia?.id ?? (await una<{ id: number }>(con, 'SELECT id FROM sucursales WHERE activo = 1 ORDER BY es_principal DESC, id LIMIT 1'))?.id ?? null;
  }
  const suc = sucursalId ? await una<{ activo: number }>(con, 'SELECT activo FROM sucursales WHERE id = ?', [sucursalId]) : null;
  if (!suc || suc.activo !== 1) throw new ErrorValidacion('La sucursal elegida no existe o está desactivada');
  await validarReferencias(con, d, hoy);

  const abierta = await una<{ numero: string }>(
    con,
    'SELECT o.numero FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id WHERE o.equipo_id = ? AND es.es_terminal = 0 ORDER BY o.id DESC LIMIT 1',
    [d.equipo_id]
  );
  const n = await siguienteNumero(con, `ORD-${tipo.codigo}`);
  const numero = `${tipo.codigo}-${String(n).padStart(6, '0')}`;
  const r = await ejecutar(
    con,
    `INSERT INTO ordenes (numero, cliente_id, equipo_id, sucursal_id, area_trabajo_id, tipo_orden_id, estado_id, prioridad, origen, cita_id, descripcion, referencia_factura_externa, responsable_id, creada_por_id,
                            fecha_estimada_entrega, notificar_nombre, notificar_correo, notificar_telefono)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [numero, e.cliente_id, d.equipo_id, sucursalId, d.area_trabajo_id ?? null, tipo.id, estado.id, d.prioridad ?? 'media', d.cita_id ? 'cita' : 'directo', d.cita_id ?? null, txt.descripcion ?? null, txt.referencia ?? null, d.responsable_id ?? null,
       actor.usuarioId, d.fecha_estimada_entrega ?? null, txt.nombre ?? null, txt.correo ?? null, txt.telefono ?? null]
  );
  const ordenId = r.insertId;
  await ejecutar(con, 'INSERT INTO orden_estados_historial (orden_id, estado_id, desde, usuario_id) VALUES (?, ?, ?, ?)', [ordenId, estado.id, ahora, actor.usuarioId]);
  // Un pedido especial nace sin el equipo presente (el repuesto llega antes que el equipo); lo demás, con el equipo en el taller.
  if (tipo.es_pedido_especial !== 1) {
    const ing = await ejecutar(con, 'INSERT INTO ingresos_equipo (orden_id, equipo_id, entrada_en, recibido_por_id) VALUES (?, ?, ?, ?)', [ordenId, d.equipo_id, ahora, actor.usuarioId]);
    if (d.lectura) {
      const c = await una<{ equipo_id: number }>(con, 'SELECT equipo_id FROM contadores WHERE id = ?', [d.lectura.contador_id]);
      if (!c || c.equipo_id !== d.equipo_id) throw new ErrorValidacion('El contador elegido no es de este equipo');
      const lecturaId = await registrarLecturaEn(ctx, t, con, actor, d.lectura.contador_id, { valor: d.lectura.valor, fecha: hoy, origen: 'orden', orden_id: ordenId });
      await ejecutar(con, 'UPDATE ingresos_equipo SET lectura_contador_id = ? WHERE id = ?', [lecturaId, ing.insertId]);
    }
  } else if (d.lectura) throw new ErrorValidacion('Un pedido especial nace sin el equipo presente: no lleva lectura de contador');
  await bitacora(con, actor, { accion: 'orden_creada', entidad: 'ordenes', entidadId: ordenId, despues: { numero, equipo_id: d.equipo_id, tipo_orden_id: tipo.id } });
  return { id: ordenId, avisos: abierta ? [{ tipo: 'orden_abierta', numero: abierta.numero }] : [] };
}

export async function crearOrden(ctx: Contexto, t: TallerReq, actor: Actor, d: DatosOrdenNueva) {
  const { id, avisos } = await transaccion(t.pool, (con) => crearOrdenEn(ctx, t, con, actor, d));
  return { ordenId: id, avisos };
}

export async function actualizarOrden(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: DatosOrden) {
  const hoy = hoyDelTaller(ctx, t);
  const txt = textosDe(d);
  await transaccion(t.pool, async (con) => {
    const o = await ordenCruda(con, id, true);
    exigirAbierta(o);
    await validarReferencias(con, d, hoy);
    const sets: string[] = [];
    const v: unknown[] = [];
    const poner = (col: string, valor: unknown): void => {
      sets.push(`${col} = ?`);
      v.push(valor ?? null);
    };
    if (d.prioridad !== undefined) poner('prioridad', d.prioridad);
    if (txt.descripcion !== undefined) poner('descripcion', txt.descripcion);
    if (d.area_trabajo_id !== undefined) poner('area_trabajo_id', d.area_trabajo_id);
    if (d.responsable_id !== undefined) poner('responsable_id', d.responsable_id);
    if (d.fecha_estimada_entrega !== undefined) poner('fecha_estimada_entrega', d.fecha_estimada_entrega);
    if (txt.referencia !== undefined) poner('referencia_factura_externa', txt.referencia);
    if (txt.nombre !== undefined) poner('notificar_nombre', txt.nombre);
    if (txt.correo !== undefined) poner('notificar_correo', txt.correo);
    if (txt.telefono !== undefined) poner('notificar_telefono', txt.telefono);
    if (sets.length === 0) return;
    await ejecutar(con, `UPDATE ordenes SET ${sets.join(', ')} WHERE id = ?`, [...v, id]);
    await bitacora(con, actor, { accion: 'orden_editada', entidad: 'ordenes', entidadId: id, despues: d });
  });
  return id;
}

// ── Estado de la orden ────────────────────────────────────────────────────────────────
async function mover(ctx: Contexto, con: PoolConnection, actor: Actor, o: OrdenCruda, nuevo: { id: number; es_terminal: number; sale_equipo: number }, motivo: string | null): Promise<void> {
  const ahora = ahoraDe(ctx);
  await ejecutar(con, 'UPDATE ordenes SET estado_id = ?, fecha_cierre = ? WHERE id = ?', [nuevo.id, nuevo.es_terminal === 1 ? ahora : null, o.id]);
  await ejecutar(con, 'INSERT INTO orden_estados_historial (orden_id, estado_id, desde, usuario_id, motivo) VALUES (?, ?, ?, ?, ?)', [o.id, nuevo.id, ahora, actor.usuarioId, motivo]);
  if (o.es_pedido_especial === 1) return;
  if (o.sale_equipo !== 1 && nuevo.sale_equipo === 1) {
    await ejecutar(con, 'UPDATE ingresos_equipo SET salida_en = ? WHERE orden_id = ? AND salida_en IS NULL', [ahora, o.id]);
  } else if (o.sale_equipo === 1 && nuevo.sale_equipo !== 1) {
    // El equipo regresó al taller (se reabrió la orden o se corrigió una entrega).
    await ejecutar(con, 'INSERT INTO ingresos_equipo (orden_id, equipo_id, entrada_en, recibido_por_id) VALUES (?, ?, ?, ?)', [o.id, o.equipo_id, ahora, actor.usuarioId]);
  }
}

export async function cambiarEstadoOrden(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { estado_id: number; motivo?: string | null; excepcion_motivo_id?: number }, puedeReabrir: boolean, puedeExceptuar = false) {
  const motivo = normalizarCampo('texto', d.motivo);
  await transaccion(t.pool, async (con) => {
    let excepcion: { motivo: string; faltaban: string[] } | null = null;
    const o = await ordenCruda(con, id, true);
    const nuevo = await una<{ id: number; es_terminal: number; es_cancelado: number; sale_equipo: number; activo: number; nombre: string }>(con, 'SELECT id, es_terminal, es_cancelado, sale_equipo, activo, nombre FROM estados_orden WHERE id = ?', [d.estado_id]);
    if (!nuevo || nuevo.activo !== 1) throw new ErrorValidacion('El estado elegido no existe o está desactivado');
    if (nuevo.id === o.estado_id) throw new ErrorApp(409, 'REGLA', 'La orden ya está en ese estado.');
    if (nuevo.es_cancelado === 1) throw new ErrorValidacion('Para anular una orden use «Anular», que pide el motivo.');
    if (o.es_terminal === 1) {
      if (!puedeReabrir) throw new ErrorApp(403, 'SIN_PERMISO', 'Su rol no tiene permiso para reabrir una orden cerrada.');
      if (!motivo || motivo.length < 3) throw new ErrorValidacion('Reabrir una orden pide el motivo');
      if (o.es_cancelado === 1) throw new ErrorApp(409, 'REGLA', 'Una orden anulada no se reabre: cree una nueva.');
    }
    if (nuevo.es_terminal === 1) {
      const p = await una<{ n: number }>(con, `SELECT COUNT(*) AS n FROM lineas_orden WHERE orden_id = ? AND ${ACTIVA} AND tipo IN ('servicio', 'tercero') AND estado <> 'terminado'`, [id]);
      if (Number(p?.n) > 0) throw new ErrorApp(409, 'LINEAS_PENDIENTES', `La orden tiene ${p?.n} ${Number(p?.n) === 1 ? 'trabajo' : 'trabajos'} sin terminar. Termínelos, o anúlelos con su motivo, antes de cerrar la orden.`, { pendientes: Number(p?.n) });
    }
    if (nuevo.es_terminal === 1) {
      // Los checklists requeridos para cerrar: bloquean, salvo una excepción autorizada con motivo (que queda registrada).
      const pend = await checklistsPendientes(con, id, 'antes_de_terminar');
      if (pend.bloquean.length > 0) {
        if (d.excepcion_motivo_id) {
          if (!puedeExceptuar) throw new ErrorApp(403, 'SIN_PERMISO', 'Su rol no puede autorizar una excepción de checklist.');
          const m = await una<{ nombre: string }>(con, "SELECT nombre FROM motivos WHERE id = ? AND tipo = 'excepcion_checklist' AND activo = 1", [d.excepcion_motivo_id]);
          if (!m) throw new ErrorValidacion('Elija un motivo de excepción de la lista');
          excepcion = { motivo: m.nombre, faltaban: pend.bloquean };
        } else {
          throw new ErrorApp(409, 'CHECKLIST_REQUERIDO', `Faltan checklists por completar antes de cerrar la orden: ${pend.bloquean.join(', ')}.`, { faltan: pend.bloquean });
        }
      }
    }
    await mover(ctx, con, actor, o, nuevo, motivo);
    if (excepcion) await bitacora(con, actor, { accion: 'orden_cierre_con_excepcion', entidad: 'ordenes', entidadId: id, motivo: excepcion.motivo, despues: { faltaban: excepcion.faltaban } });
    await bitacora(con, actor, { accion: o.es_terminal === 1 ? 'orden_reabierta' : 'orden_estado', entidad: 'ordenes', entidadId: id, motivo, antes: { estado_id: o.estado_id }, despues: { estado_id: nuevo.id } });
  });
  return id;
}

export async function anularOrden(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { motivo_id: number; texto?: string | null }) {
  const cfg = await configDePrecios(t);
  const texto = normalizarCampo('texto', d.texto);
  await transaccion(t.pool, async (con) => {
    const o = await ordenCruda(con, id, true);
    exigirAbierta(o);
    const m = await una<{ nombre: string; activo: number }>(con, "SELECT nombre, activo FROM motivos WHERE id = ? AND tipo = 'anulacion_orden'", [d.motivo_id]);
    if (!m || m.activo !== 1) throw new ErrorValidacion('Elija un motivo de anulación de la lista');
    const cancelado = await una<{ id: number; es_terminal: number; sale_equipo: number }>(con, 'SELECT id, es_terminal, sale_equipo FROM estados_orden WHERE es_cancelado = 1 AND activo = 1 ORDER BY orden, id LIMIT 1');
    if (!cancelado) throw new ErrorApp(409, 'REGLA', 'El taller no tiene un estado de orden «cancelado» activo. Revise los estados de orden.');
    const ahora = ahoraDe(ctx);
    // Los trabajos sin terminar se anulan con la orden; los ya terminados se conservan.
    await ejecutar(con, `UPDATE registros_tiempo r JOIN lineas_orden l ON l.id = r.linea_id SET r.fin = ? WHERE l.orden_id = ? AND r.fin IS NULL`, [ahora, id]);
    await ejecutar(con, `UPDATE lineas_orden SET anulada_en = ?, anulada_por_id = ?, motivo_anulacion = ? WHERE orden_id = ? AND ${ACTIVA} AND estado <> 'terminado'`, [ahora, actor.usuarioId, `ORDEN ANULADA: ${m.nombre}`, id]);
    await ejecutar(con, 'UPDATE ordenes SET motivo_anulacion_id = ?, motivo_anulacion_texto = ? WHERE id = ?', [d.motivo_id, texto, id]);
    await recalcularTotales(con, id, cfg);
    await mover(ctx, con, actor, o, cancelado, `${m.nombre}${texto ? `: ${texto}` : ''}`.slice(0, 300));
    await bitacora(con, actor, { accion: 'orden_anulada', entidad: 'ordenes', entidadId: id, motivo: m.nombre, despues: { texto } });
  });
  return id;
}

// ── Líneas ────────────────────────────────────────────────────────────────────────────
export interface DatosLinea {
  tipo: 'servicio' | 'material' | 'tercero';
  trabajo_id?: number;
  proveedor_id?: number;
  descripcion?: string;
  cantidad?: number;
  precio_unitario?: number;
  costo?: number;
  horas_trabajo?: number;
  area_trabajo_id?: number | null;
  tecnico_id?: number | null;
  notas?: string | null;
}

async function descuentoDelCliente(con: Ejecutor, clienteId: number | null, columna: 'descuento_trabajos' | 'descuento_otros'): Promise<number> {
  if (!clienteId) return 0;
  const f = await una<{ d: number | null }>(con, `SELECT tc.${columna} AS d FROM clientes c JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id WHERE c.id = ?`, [clienteId]);
  return Number(f?.d ?? 0);
}

const totalDeLinea = (cantidad: number, precio: number, descuento: number): number => r2(cantidad * precio * (1 - descuento / 100));

async function validarTecnico(con: Ejecutor, tecnicoId: number | null | undefined, trabajoId?: number | null): Promise<void> {
  if (!tecnicoId) return;
  const c = await una<{ activo: number; nombre: string; nivel_tecnico_id: number | null }>(con, 'SELECT activo, nombre_completo AS nombre, nivel_tecnico_id FROM colaboradores WHERE id = ?', [tecnicoId]);
  if (!c || c.activo !== 1) throw new ErrorValidacion('El técnico elegido no existe o está desactivado');
  // Matriz nivel × sistema: una fila ausente es SIN permiso. Quien no tiene nivel asignado no tiene restricción.
  if (trabajoId && c.nivel_tecnico_id) {
    const sis = await una<{ id: number; nombre: string }>(
      con,
      'SELECT s.id, s.nombre FROM trabajos tr JOIN partes p ON p.id = tr.parte_id JOIN subsistemas x ON x.id = p.subsistema_id JOIN sistemas s ON s.id = x.sistema_id WHERE tr.id = ?',
      [trabajoId]
    );
    if (sis) {
      const ok = await una(con, 'SELECT 1 AS x FROM matriz_tecnico_sistema WHERE nivel_tecnico_id = ? AND sistema_id = ?', [c.nivel_tecnico_id, sis.id]);
      if (!ok) throw new ErrorApp(409, 'SIN_NIVEL', `El nivel de ${c.nombre} no está habilitado para trabajos de ${sis.nombre}. Elija a otro técnico o cambie la matriz de niveles.`);
    }
  }
}

/** Horas y tarifa que le tocan a un trabajo en el equipo de la orden. */
async function preciosDeServicio(con: Ejecutor, o: OrdenCruda, trabajoId: number, areaId: number | null, horasManual?: number) {
  const eq = await una<{ tipo_equipo_id: number; tipo: string; tarifa: number; costo: number }>(
    con,
    'SELECT e.tipo_equipo_id, te.nombre AS tipo, te.tarifa_venta_hora AS tarifa, te.costo_hora AS costo FROM equipos e JOIN tipos_equipo te ON te.id = e.tipo_equipo_id WHERE e.id = ?',
    [o.equipo_id]
  );
  if (!eq) throw new ErrorNoEncontrado('No se encontró el equipo de la orden');
  const catalogo = await una<{ horas: number }>(con, 'SELECT horas FROM trabajo_horas_tipo_equipo WHERE trabajo_id = ? AND tipo_equipo_id = ?', [trabajoId, eq.tipo_equipo_id]);
  const horas = horasManual ?? (catalogo ? Number(catalogo.horas) : null);
  if (horas === null) {
    throw new ErrorApp(409, 'SIN_HORAS', `Este trabajo no tiene horas definidas para equipos de tipo ${eq.tipo}. Defínalas en el catálogo de trabajos, o escriba las horas al agregar la línea.`);
  }
  if (!(horas > 0) || horas > 999) throw new ErrorValidacion('Las horas de trabajo deben ser mayores que cero y menores de 1000');
  const deArea = areaId ? await una<{ tarifa: number; costo: number }>(con, 'SELECT tarifa_venta_hora AS tarifa, costo_hora AS costo FROM tarifas_area WHERE area_trabajo_id = ? AND tipo_equipo_id = ?', [areaId, eq.tipo_equipo_id]) : null;
  const tarifa = Number(deArea?.tarifa ?? eq.tarifa);
  const costoHora = Number(deArea?.costo ?? eq.costo);
  return { horas, tarifa, costoHora, precio: r2(horas * tarifa), costo: r2(horas * costoHora) };
}

export async function agregarLinea(t: TallerReq, actor: Actor, ordenId: number, d: DatosLinea) {
  if (d.tipo === 'material') throw new ErrorApp(409, 'SIN_INVENTARIO', 'Los materiales se cargan a la orden desde Inventario, que llega en una fase próxima. Por ahora use servicios y trabajos con terceros.');
  const cfg = await configDePrecios(t);
  const notas = normalizarCampo('texto', d.notas);
  await transaccion(t.pool, async (con) => {
    const o = await ordenCruda(con, ordenId, true);
    exigirAbierta(o);
    await validarTecnico(con, d.tecnico_id, d.tipo === 'servicio' ? d.trabajo_id : null);
    const areaId = d.area_trabajo_id ?? null;
    if (areaId) {
      const a = await una<{ activo: number }>(con, 'SELECT activo FROM areas_trabajo WHERE id = ?', [areaId]);
      if (!a || a.activo !== 1) throw new ErrorValidacion('El área de trabajo elegida no existe o está desactivada');
    }
    if (d.tipo === 'servicio') {
      if (!d.trabajo_id) throw new ErrorValidacion('Elija el trabajo del catálogo');
      const tr = await una<{ nombre: string; variante: string | null; activo: number; area_trabajo_id: number | null }>(con, 'SELECT nombre, variante, activo, area_trabajo_id FROM trabajos WHERE id = ?', [d.trabajo_id]);
      if (!tr || tr.activo !== 1) throw new ErrorValidacion('El trabajo elegido no existe o está desactivado');
      const area = areaId ?? tr.area_trabajo_id ?? o.area_trabajo_id;
      const p = await preciosDeServicio(con, o, d.trabajo_id, area, d.horas_trabajo);
      const desc = await descuentoDelCliente(con, o.cliente_id, 'descuento_trabajos');
      await ejecutar(
        con,
        `INSERT INTO lineas_orden (orden_id, tipo, trabajo_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo, horas_trabajo, tarifa_hora_aplicada, costo_hora_aplicado, area_trabajo_id, tecnico_id, notas)
         VALUES (?, 'servicio', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordenId, d.trabajo_id, [tr.nombre, tr.variante].filter(Boolean).join(' · ').slice(0, 250), p.precio, desc, totalDeLinea(1, p.precio, desc), p.costo, p.horas, p.tarifa, p.costoHora, area, d.tecnico_id ?? null, notas]
      );
    } else {
      if (!d.proveedor_id) throw new ErrorValidacion('Elija el proveedor que hará el trabajo');
      const pv = await una<{ activo: number }>(con, 'SELECT activo FROM proveedores WHERE id = ?', [d.proveedor_id]);
      if (!pv || pv.activo !== 1) throw new ErrorValidacion('El proveedor elegido no existe o está desactivado');
      const descripcion = normalizarCampo('texto', d.descripcion);
      if (!descripcion) throw new ErrorValidacion('Describa el trabajo con terceros');
      if (descripcion.length > 250) throw new ErrorValidacion('La descripción es demasiado larga');
      const cantidad = d.cantidad ?? 1;
      const precio = d.precio_unitario ?? 0;
      if (!(cantidad > 0) || cantidad > 100000) throw new ErrorValidacion('La cantidad no es válida');
      if (precio < 0 || precio > 99999999) throw new ErrorValidacion('El precio no es válido');
      if ((d.costo ?? 0) < 0) throw new ErrorValidacion('El costo no es válido');
      const desc = await descuentoDelCliente(con, o.cliente_id, 'descuento_otros');
      await ejecutar(
        con,
        `INSERT INTO lineas_orden (orden_id, tipo, proveedor_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo, area_trabajo_id, tecnico_id, notas)
         VALUES (?, 'tercero', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordenId, d.proveedor_id, descripcion, cantidad, precio, desc, totalDeLinea(cantidad, precio, desc), r2(d.costo ?? 0), areaId, d.tecnico_id ?? null, notas]
      );
    }
    await recalcularTotales(con, ordenId, cfg);
    await bitacora(con, actor, { accion: 'orden_linea_agregada', entidad: 'ordenes', entidadId: ordenId, despues: d });
  });
  return ordenId;
}

async function lineaCruda(con: Ejecutor, id: number) {
  const l = await una<{ id: number; orden_id: number; tipo: 'servicio' | 'material' | 'tercero'; trabajo_id: number | null; estado: EstadoLinea; anulada_en: Date | null; cantidad: number; precio_unitario: number; descuento_pct: number; horas_trabajo: number | null; area_trabajo_id: number | null; inicio_en: Date | null; tecnico_id: number | null }>(
    con,
    'SELECT id, orden_id, tipo, trabajo_id, estado, anulada_en, cantidad, precio_unitario, descuento_pct, horas_trabajo, area_trabajo_id, inicio_en, tecnico_id FROM lineas_orden WHERE id = ? FOR UPDATE',
    [id]
  );
  if (!l) throw new ErrorNoEncontrado('No se encontró la línea');
  if (l.anulada_en) throw new ErrorApp(409, 'REGLA', 'Esa línea está anulada y ya no se puede modificar.');
  return l;
}

export async function actualizarLinea(
  t: TallerReq,
  actor: Actor,
  id: number,
  d: { notas?: string | null; tecnico_id?: number | null; area_trabajo_id?: number | null; horas_trabajo?: number; descripcion?: string; cantidad?: number; precio_unitario?: number; costo?: number }
) {
  const cfg = await configDePrecios(t);
  let ordenId = 0;
  await transaccion(t.pool, async (con) => {
    const l = await lineaCruda(con, id);
    ordenId = l.orden_id;
    const o = await ordenCruda(con, l.orden_id, true);
    exigirAbierta(o);
    const sets: string[] = [];
    const v: unknown[] = [];
    if (d.notas !== undefined) {
      sets.push('notas = ?');
      v.push(normalizarCampo('texto', d.notas));
    }
    if (d.tecnico_id !== undefined) {
      if (l.estado === 'en_proceso' && d.tecnico_id !== l.tecnico_id) throw new ErrorApp(409, 'REGLA', 'El trabajo está en proceso: páuselo o termínelo antes de cambiar de técnico.');
      await validarTecnico(con, d.tecnico_id, l.trabajo_id);
      sets.push('tecnico_id = ?');
      v.push(d.tecnico_id);
    }
    const cambiaPrecio = d.horas_trabajo !== undefined || d.area_trabajo_id !== undefined || d.cantidad !== undefined || d.precio_unitario !== undefined || d.costo !== undefined || d.descripcion !== undefined;
    if (cambiaPrecio && l.estado === 'terminado') throw new ErrorApp(409, 'REGLA', 'El trabajo ya está terminado: su precio no se cambia. Anule la línea y agregue otra si hace falta.');
    if (cambiaPrecio && l.tipo === 'servicio') {
      if (d.cantidad !== undefined || d.precio_unitario !== undefined || d.costo !== undefined || d.descripcion !== undefined) throw new ErrorValidacion('El precio de un servicio sale de las horas por la tarifa: cambie las horas o el área');
      const area = d.area_trabajo_id === undefined ? l.area_trabajo_id : d.area_trabajo_id;
      const p = await preciosDeServicio(con, o, l.trabajo_id as number, area ?? o.area_trabajo_id, d.horas_trabajo ?? Number(l.horas_trabajo));
      const desc = Number(l.descuento_pct);
      sets.push('area_trabajo_id = ?', 'horas_trabajo = ?', 'tarifa_hora_aplicada = ?', 'costo_hora_aplicado = ?', 'precio_unitario = ?', 'total_linea = ?', 'costo = ?');
      v.push(area ?? null, p.horas, p.tarifa, p.costoHora, p.precio, totalDeLinea(1, p.precio, desc), p.costo);
    } else if (cambiaPrecio) {
      if (d.horas_trabajo !== undefined) throw new ErrorValidacion('Las horas solo se cambian en los servicios');
      const cantidad = d.cantidad ?? Number(l.cantidad);
      const precio = d.precio_unitario ?? Number(l.precio_unitario);
      if (!(cantidad > 0) || cantidad > 100000) throw new ErrorValidacion('La cantidad no es válida');
      if (precio < 0 || precio > 99999999) throw new ErrorValidacion('El precio no es válido');
      sets.push('cantidad = ?', 'precio_unitario = ?', 'total_linea = ?');
      v.push(cantidad, precio, totalDeLinea(cantidad, precio, Number(l.descuento_pct)));
      if (d.costo !== undefined) {
        if (d.costo < 0) throw new ErrorValidacion('El costo no es válido');
        sets.push('costo = ?');
        v.push(r2(d.costo));
      }
      if (d.descripcion !== undefined) {
        const txt = normalizarCampo('texto', d.descripcion);
        if (!txt) throw new ErrorValidacion('La descripción no puede quedar vacía');
        sets.push('descripcion = ?');
        v.push(txt.slice(0, 250));
      }
      if (d.area_trabajo_id !== undefined) {
        sets.push('area_trabajo_id = ?');
        v.push(d.area_trabajo_id);
      }
    }
    if (sets.length === 0) return;
    await ejecutar(con, `UPDATE lineas_orden SET ${sets.join(', ')} WHERE id = ?`, [...v, id]);
    await recalcularTotales(con, l.orden_id, cfg);
    await bitacora(con, actor, { accion: 'orden_linea_editada', entidad: 'lineas_orden', entidadId: id, despues: d });
  });
  return ordenId;
}

export async function anularLinea(ctx: Contexto, t: TallerReq, actor: Actor, id: number, motivo: string) {
  const texto = normalizarCampo('texto', motivo);
  if (!texto || texto.length < 3) throw new ErrorValidacion('Anular una línea pide el motivo');
  const cfg = await configDePrecios(t);
  let ordenId = 0;
  await transaccion(t.pool, async (con) => {
    const l = await lineaCruda(con, id);
    ordenId = l.orden_id;
    exigirAbierta(await ordenCruda(con, l.orden_id, true));
    await ejecutar(con, 'UPDATE registros_tiempo SET fin = ? WHERE linea_id = ? AND fin IS NULL', [ahoraDe(ctx), id]);
    await ejecutar(con, 'UPDATE lineas_orden SET anulada_en = ?, anulada_por_id = ?, motivo_anulacion = ? WHERE id = ?', [ahoraDe(ctx), actor.usuarioId, texto.slice(0, 300), id]);
    await recalcularTotales(con, l.orden_id, cfg);
    await bitacora(con, actor, { accion: 'orden_linea_anulada', entidad: 'lineas_orden', entidadId: id, motivo: texto });
  });
  return ordenId;
}

/**
 * Cambio de estado de una línea (los 8 estados del estándar, sin grafo). Al pasar a «en proceso» se abre un tramo de tiempo del
 * técnico (que no puede tener dos a la vez); al salir de «en proceso» se cierra. De los tramos salen las horas reales.
 */
export async function cambiarEstadoLinea(ctx: Contexto, t: TallerReq, actor: Actor, id: number, estado: EstadoLinea) {
  let ordenId = 0;
  await transaccion(t.pool, async (con) => {
    const l = await lineaCruda(con, id);
    ordenId = l.orden_id;
    exigirAbierta(await ordenCruda(con, l.orden_id, true));
    if (l.tipo === 'material') throw new ErrorApp(409, 'REGLA', 'Los materiales los controla Inventario: no tienen estados de trabajo.');
    if (l.estado === estado) throw new ErrorApp(409, 'REGLA', 'La línea ya está en ese estado.');
    const ahora = ahoraDe(ctx);
    if (estado === 'en_proceso') {
      if (!l.tecnico_id) throw new ErrorApp(409, 'SIN_TECNICO', 'Asigne un técnico al trabajo antes de iniciarlo.');
      await validarTecnico(con, l.tecnico_id, l.trabajo_id);
      const pend = await checklistsPendientes(con, l.orden_id, 'antes_de_iniciar');
      if (pend.bloquean.length > 0) throw new ErrorApp(409, 'CHECKLIST_REQUERIDO', `Antes de iniciar el trabajo falta completar: ${pend.bloquean.join(', ')}.`, { faltan: pend.bloquean });
      const ocupado = await una<{ numero: string; descripcion: string }>(
        con,
        `SELECT o.numero, l2.descripcion FROM registros_tiempo r JOIN lineas_orden l2 ON l2.id = r.linea_id JOIN ordenes o ON o.id = l2.orden_id
          WHERE r.colaborador_id = ? AND r.fin IS NULL LIMIT 1`,
        [l.tecnico_id]
      );
      if (ocupado) throw new ErrorApp(409, 'TECNICO_OCUPADO', `Este técnico ya tiene un trabajo en proceso (${ocupado.descripcion}, orden ${ocupado.numero}). Debe pausarlo o terminarlo antes de iniciar otro.`, ocupado);
      await ejecutar(con, 'INSERT INTO registros_tiempo (linea_id, colaborador_id, inicio) VALUES (?, ?, ?)', [id, l.tecnico_id, ahora]);
    } else if (l.estado === 'en_proceso') {
      await ejecutar(con, 'UPDATE registros_tiempo SET fin = ? WHERE linea_id = ? AND fin IS NULL', [ahora, id]);
    }
    const sets = ['estado = ?'];
    const v: unknown[] = [estado];
    if (estado === 'en_proceso') {
      sets.push('inicio_en = ?', 'pausa_en = NULL', 'fin_en = NULL');
      v.push(l.inicio_en ?? ahora);
    } else if (estado === 'terminado') {
      sets.push('inicio_en = ?', 'fin_en = ?');
      v.push(l.inicio_en ?? ahora, ahora);
    } else if (estado === 'pendiente') {
      sets.push('pausa_en = NULL', 'fin_en = NULL');
    } else {
      sets.push('pausa_en = ?', 'fin_en = NULL');
      v.push(ahora);
    }
    await ejecutar(con, `UPDATE lineas_orden SET ${sets.join(', ')} WHERE id = ?`, [...v, id]);
    await bitacora(con, actor, { accion: 'orden_linea_estado', entidad: 'lineas_orden', entidadId: id, antes: { estado: l.estado }, despues: { estado } });
  });
  return ordenId;
}

/** Quién puede actuar sobre una línea: quien edita órdenes (en cualquiera) o el técnico asignado (solo en las suyas). */
export async function autorizarSobreLinea(t: TallerReq, usuarioId: number, permisos: Set<string>, lineaId: number): Promise<void> {
  if (permisos.has('ordenes.editar')) return;
  const f = await una<{ tecnico_id: number | null; colaborador_id: number | null }>(
    t.pool,
    'SELECT l.tecnico_id, (SELECT u.colaborador_id FROM usuarios u WHERE u.id = ?) AS colaborador_id FROM lineas_orden l WHERE l.id = ?',
    [usuarioId, lineaId]
  );
  if (!f) throw new ErrorNoEncontrado('No se encontró la línea');
  if (permisos.has('ordenes.trabajar') && f.tecnico_id !== null && f.tecnico_id === f.colaborador_id) return;
  throw new ErrorApp(403, 'SIN_PERMISO', 'Solo puede trabajar en los trabajos que tiene asignados.');
}

// ── Mis trabajos ──────────────────────────────────────────────────────────────────────
export async function misTrabajos(ctx: Contexto, t: TallerReq, usuarioId: number) {
  const yo = await una<{ colaborador_id: number }>(t.pool, 'SELECT colaborador_id FROM usuarios WHERE id = ?', [usuarioId]);
  if (!yo) return { colaborador_id: null, ocupado: false, trabajos: [] };
  const ahora = ahoraDe(ctx);
  const lineas = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT l.id, l.orden_id, o.numero, o.prioridad, o.descripcion AS orden_descripcion, e.codigo_interno, e.placa, m.nombre AS marca, e.modelo, te.nombre AS tipo_equipo, c.nombre AS cliente,
            l.descripcion, l.horas_trabajo, l.estado, l.notas, l.inicio_en,
            (SELECT COALESCE(SUM(TIMESTAMPDIFF(SECOND, r.inicio, COALESCE(r.fin, ?))), 0) FROM registros_tiempo r WHERE r.linea_id = l.id) AS segundos,
            (SELECT r.inicio FROM registros_tiempo r WHERE r.linea_id = l.id AND r.fin IS NULL LIMIT 1) AS tramo_desde
       FROM lineas_orden l JOIN ordenes o ON o.id = l.orden_id JOIN estados_orden es ON es.id = o.estado_id JOIN equipos e ON e.id = o.equipo_id JOIN tipos_equipo te ON te.id = e.tipo_equipo_id
       LEFT JOIN marcas m ON m.id = e.marca_id LEFT JOIN clientes c ON c.id = o.cliente_id
      WHERE l.tecnico_id = ? AND l.anulada_en IS NULL AND l.estado <> 'terminado' AND l.tipo <> 'material' AND es.es_terminal = 0
      ORDER BY (l.estado = 'en_proceso') DESC, FIELD(o.prioridad, 'urgente', 'alta', 'media', 'baja'), l.id`,
    [ahora, yo.colaborador_id]
  );
  const ids = lineas.map((l) => Number(l['id']));
  const fotos = ids.length === 0 ? [] : await filas<{ id: number; linea_id: number; archivo_id: number; tipo: string }>(t.pool, 'SELECT id, linea_id, archivo_id, tipo FROM linea_fotos WHERE linea_id IN (?) ORDER BY id', [ids]);
  return {
    colaborador_id: yo.colaborador_id,
    ocupado: lineas.some((l) => l['estado'] === 'en_proceso'),
    trabajos: lineas.map((l) => {
      const { segundos, codigo_interno, placa, marca, modelo, tipo_equipo, ...resto } = l as { segundos: number; codigo_interno: string | null; placa: string | null; marca: string | null; modelo: string | null; tipo_equipo: string } & Record<string, unknown>;
      return {
        ...resto,
        equipo: descripcionDeEquipo({ id: 0, codigo_interno, placa, marca, modelo, tipo_equipo }),
        horas_reales: Math.round((Number(segundos) / 3600) * 100) / 100,
        fotos: fotos.filter((f) => f.linea_id === l['id']).map((f) => ({ id: f.id, tipo: f.tipo, url: urlFirmada(ctx, t.empresa.slug, f.archivo_id) })),
      };
    }),
  };
}

// ── Fotos de una línea ────────────────────────────────────────────────────────────────
export async function agregarFotoLinea(ctx: Contexto, t: TallerReq, actor: Actor, lineaId: number, entrada: { buffer: Buffer; mime: string; nombre: string; tipo: 'antes' | 'durante' | 'despues'; descripcion?: string | null }): Promise<number> {
  let ordenId = 0;
  await transaccion(t.pool, async (con) => {
    const l = await lineaCruda(con, lineaId);
    ordenId = l.orden_id;
    exigirAbierta(await ordenCruda(con, l.orden_id, true));
    const total = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM linea_fotos WHERE linea_id = ?', [lineaId]);
    if (Number(total?.n) >= 20) throw new ErrorApp(409, 'REGLA', 'Cada trabajo admite hasta 20 fotos.');
    if (!entrada.mime.startsWith('image/')) throw new ErrorValidacion('Aquí solo se aceptan fotos (JPG, PNG o WEBP).');
    const archivo = await guardarArchivo(ctx, t, con, actor, entrada);
    await ejecutar(con, 'INSERT INTO linea_fotos (linea_id, archivo_id, tipo, descripcion, subido_por_id) VALUES (?, ?, ?, ?, ?)', [lineaId, archivo.id, entrada.tipo, normalizarCampo('texto', entrada.descripcion)?.slice(0, 150) ?? null, actor.usuarioId]);
    await bitacora(con, actor, { accion: 'orden_linea_foto', entidad: 'lineas_orden', entidadId: lineaId, despues: { tipo: entrada.tipo, archivo_id: archivo.id } });
  });
  return ordenId;
}

export async function quitarFotoLinea(ctx: Contexto, t: TallerReq, actor: Actor, lineaId: number, fotoId: number): Promise<number> {
  let ordenId = 0;
  await transaccion(t.pool, async (con) => {
    const l = await lineaCruda(con, lineaId);
    ordenId = l.orden_id;
    exigirAbierta(await ordenCruda(con, l.orden_id, true));
    const f = await una<{ archivo_id: number }>(con, 'SELECT archivo_id FROM linea_fotos WHERE id = ? AND linea_id = ?', [fotoId, lineaId]);
    if (!f) throw new ErrorNoEncontrado('No se encontró la foto');
    await ejecutar(con, 'DELETE FROM linea_fotos WHERE id = ?', [fotoId]);
    await borrarArchivo(ctx, t, con, f.archivo_id);
    await bitacora(con, actor, { accion: 'orden_linea_foto_quitada', entidad: 'lineas_orden', entidadId: lineaId, despues: { fotoId } });
  });
  return ordenId;
}

// ── Tarifas por área ──────────────────────────────────────────────────────────────────
export async function listarTarifasArea(t: TallerReq) {
  return filas<Record<string, unknown>>(
    t.pool,
    `SELECT ta.area_trabajo_id, ar.nombre AS area, ta.tipo_equipo_id, te.nombre AS tipo_equipo, ta.tarifa_venta_hora, ta.costo_hora
       FROM tarifas_area ta JOIN areas_trabajo ar ON ar.id = ta.area_trabajo_id JOIN tipos_equipo te ON te.id = ta.tipo_equipo_id ORDER BY ar.nombre, te.nombre`
  );
}

export async function definirTarifaArea(t: TallerReq, actor: Actor, areaId: number, tipoId: number, d: { tarifa_venta_hora: number; costo_hora: number }) {
  if (d.tarifa_venta_hora < 0 || d.costo_hora < 0 || d.tarifa_venta_hora > 9999999 || d.costo_hora > 9999999) throw new ErrorValidacion('La tarifa y el costo deben ser números positivos');
  await transaccion(t.pool, async (con) => {
    const a = await una<{ id: number }>(con, 'SELECT id FROM areas_trabajo WHERE id = ?', [areaId]);
    const te = await una<{ id: number }>(con, 'SELECT id FROM tipos_equipo WHERE id = ?', [tipoId]);
    if (!a || !te) throw new ErrorNoEncontrado('No se encontró el área o el tipo de equipo');
    await ejecutar(con, 'INSERT INTO tarifas_area (area_trabajo_id, tipo_equipo_id, tarifa_venta_hora, costo_hora) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE tarifa_venta_hora = VALUES(tarifa_venta_hora), costo_hora = VALUES(costo_hora)', [areaId, tipoId, r2(d.tarifa_venta_hora), r2(d.costo_hora)]);
    await bitacora(con, actor, { accion: 'tarifa_area_definida', entidad: 'tarifas_area', despues: { areaId, tipoId, ...d } });
  });
  return listarTarifasArea(t);
}

export async function quitarTarifaArea(t: TallerReq, actor: Actor, areaId: number, tipoId: number) {
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'DELETE FROM tarifas_area WHERE area_trabajo_id = ? AND tipo_equipo_id = ?', [areaId, tipoId]);
    await bitacora(con, actor, { accion: 'tarifa_area_quitada', entidad: 'tarifas_area', despues: { areaId, tipoId } });
  });
  return listarTarifasArea(t);
}
