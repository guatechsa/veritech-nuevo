import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { normalizarCampo } from '../utils/texto';
import { urlFirmada } from './archivos';
import { Actor, bitacora, siguienteNumero, TallerReq } from './comun';
import { leerConfiguracion } from './configuracion';
import { hoyDelTaller } from './contadores';
import { desenlaceDeRespuestas } from './cotizaciones-desenlace';
import { configDeInventario } from './inventario';
import { bloquearOrdenAbierta, calcularTotales, configDePrecios, descuentoDelCliente, precioServicioDeEquipo, recalcularTotales, totalDeLinea } from './ordenes';
import { crearSolicitudEn, precioDeMaterial } from './solicitudes';

/**
 * Cotizaciones (Fase 6a). Un documento con líneas de trabajos del catálogo (precio por horas), materiales del inventario y trabajos con
 * terceros. Los rojos de los checklists se anotan como «hallazgos» del borrador. El cliente autoriza o rechaza CADA línea; «Agregar a la
 * orden» lleva lo autorizado a la orden (no es automático). Una cotización enviada que se edita nace como versión nueva.
 */

export interface Vista {
  costos: boolean;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const ESTADOS_COTIZACION = ['borrador', 'enviada', 'respondida', 'vencida', 'reemplazada', 'anulada'] as const;
export type EstadoCotizacion = (typeof ESTADOS_COTIZACION)[number];
const numeroDe = (n: number): string => `COT-${String(n).padStart(6, '0')}`;
const sumarDias = (iso: string, dias: number): string => new Date(Date.parse(`${iso}T00:00:00Z`) + dias * 86400000).toISOString().slice(0, 10);

interface CotCruda {
  id: number;
  numero: string;
  version: number;
  estado: EstadoCotizacion;
  orden_id: number | null;
  equipo_id: number | null;
  cliente_id: number | null;
  vence_en: string | null;
  checklist_id: number | null;
}

async function cotCruda(con: Ejecutor, id: number, bloquear = false): Promise<CotCruda> {
  const c = await una<CotCruda>(con, `SELECT id, numero, version, estado, orden_id, equipo_id, cliente_id, DATE_FORMAT(vence_en, '%Y-%m-%d') AS vence_en, checklist_id FROM cotizaciones WHERE id = ? ${bloquear ? 'FOR UPDATE' : ''}`, [id]);
  if (!c) throw new ErrorNoEncontrado('No se encontró la cotización');
  return c;
}

function exigirBorrador(c: CotCruda): void {
  if (c.estado !== 'borrador') throw new ErrorApp(409, 'REGLA', `La cotización ${c.numero} ya se envió y no se edita. Cree una versión nueva para cambiarla.`);
}

/** Marca como vencidas las enviadas cuya fecha ya pasó (y sus líneas sin respuesta). */
export async function marcarCotizacionesVencidas(con: Ejecutor, hoy: string): Promise<void> {
  await ejecutar(con, "UPDATE cotizacion_lineas l JOIN cotizaciones c ON c.id = l.cotizacion_id SET l.estado = 'vencida' WHERE c.estado = 'enviada' AND c.vence_en < ? AND l.estado = 'pendiente'", [hoy]);
  await ejecutar(con, "UPDATE cotizaciones SET estado = 'vencida' WHERE estado = 'enviada' AND vence_en < ?", [hoy]);
}

async function recalcular(con: Ejecutor, t: TallerReq, cotId: number): Promise<void> {
  const cfg = await configDePrecios(t);
  const s = await una<{ bruto: number | null; neto: number | null }>(con, 'SELECT SUM(precio_unitario * cantidad) AS bruto, SUM(total_linea) AS neto FROM cotizacion_lineas WHERE cotizacion_id = ?', [cotId]);
  const x = calcularTotales(Number(s?.bruto ?? 0), Number(s?.neto ?? 0), cfg);
  await ejecutar(con, 'UPDATE cotizaciones SET subtotal = ?, descuento_total = ?, iva = ?, total = ? WHERE id = ?', [x.subtotal, x.descuento, x.iva, x.total, cotId]);
}

// ── Crear ─────────────────────────────────────────────────────────────────────────────
async function origenDe(con: Ejecutor, d: { orden_id?: number | null; equipo_id?: number | null; cliente_id?: number | null }): Promise<{ orden_id: number | null; equipo_id: number | null; cliente_id: number | null }> {
  let orden_id: number | null = d.orden_id ?? null;
  let equipo_id: number | null = d.equipo_id ?? null;
  let cliente_id: number | null = d.cliente_id ?? null;
  if (orden_id) {
    const o = await una<{ equipo_id: number; cliente_id: number | null }>(con, 'SELECT equipo_id, cliente_id FROM ordenes WHERE id = ?', [orden_id]);
    if (!o) throw new ErrorNoEncontrado('No se encontró la orden');
    if (equipo_id && equipo_id !== o.equipo_id) throw new ErrorValidacion('El equipo no es el de la orden');
    equipo_id = o.equipo_id;
    cliente_id = o.cliente_id;
  } else if (equipo_id) {
    const e = await una<{ cliente_id: number | null }>(con, 'SELECT cliente_id FROM equipos WHERE id = ?', [equipo_id]);
    if (!e) throw new ErrorNoEncontrado('No se encontró el equipo');
    cliente_id = e.cliente_id;
  } else if (cliente_id) {
    if (!(await una(con, 'SELECT id FROM clientes WHERE id = ?', [cliente_id]))) throw new ErrorNoEncontrado('No se encontró el cliente');
  }
  orden_id = orden_id ?? null;
  return { orden_id, equipo_id, cliente_id };
}

export async function crearCotizacion(t: TallerReq, actor: Actor, d: { orden_id?: number | null; equipo_id?: number | null; cliente_id?: number | null; notas?: string | null }) {
  return transaccion(t.pool, async (con) => {
    const o = await origenDe(con, d);
    const numero = numeroDe(await siguienteNumero(con, 'COT'));
    const r = await ejecutar(con, 'INSERT INTO cotizaciones (numero, cliente_id, equipo_id, orden_id, notas, creada_por_id) VALUES (?, ?, ?, ?, ?, ?)', [numero, o.cliente_id, o.equipo_id, o.orden_id, normalizarCampo('texto', d.notas)?.slice(0, 500) ?? null, actor.usuarioId]);
    await bitacora(con, actor, { accion: 'cotizacion_creada', entidad: 'cotizaciones', entidadId: r.insertId, despues: { numero, ...o } });
    return { id: r.insertId, numero };
  });
}

/** Crea el borrador con los rojos de un checklist (los que todavía no atiende otra cotización vigente). */
export async function crearDesdeChecklist(t: TallerReq, actor: Actor, checklistId: number) {
  return transaccion(t.pool, async (con) => {
    const c = await una<{ id: number; orden_id: number | null; equipo_id: number }>(con, 'SELECT id, orden_id, equipo_id FROM checklists WHERE id = ?', [checklistId]);
    if (!c) throw new ErrorNoEncontrado('No se encontró el checklist');
    const rojos = await filas<{ id: number }>(con, "SELECT id FROM checklist_respuestas WHERE checklist_id = ? AND semaforo = 'rojo' ORDER BY orden, id", [checklistId]);
    if (rojos.length === 0) throw new ErrorApp(409, 'SIN_ROJOS', 'Ese checklist no tiene ítems en rojo que cotizar.');
    const tomados = await filas<{ respuesta_id: number; numero: string }>(
      con,
      "SELECT h.respuesta_id, c2.numero FROM cotizacion_hallazgos h JOIN cotizaciones c2 ON c2.id = h.cotizacion_id WHERE h.respuesta_id IN (?) AND c2.estado IN ('borrador', 'enviada', 'respondida')",
      [rojos.map((r) => r.id)]
    );
    const libres = rojos.filter((r) => !tomados.some((x) => x.respuesta_id === r.id));
    if (libres.length === 0) throw new ErrorApp(409, 'YA_COTIZADOS', `Los rojos de este checklist ya están en la cotización ${tomados[0]!.numero}.`, { cotizacion: tomados[0]!.numero });
    const o = await origenDe(con, { orden_id: c.orden_id, equipo_id: c.equipo_id });
    const numero = numeroDe(await siguienteNumero(con, 'COT'));
    const r = await ejecutar(con, 'INSERT INTO cotizaciones (numero, cliente_id, equipo_id, orden_id, checklist_id, creada_por_id) VALUES (?, ?, ?, ?, ?, ?)', [numero, o.cliente_id, o.equipo_id, o.orden_id, checklistId, actor.usuarioId]);
    for (const x of libres) await ejecutar(con, 'INSERT INTO cotizacion_hallazgos (cotizacion_id, respuesta_id) VALUES (?, ?)', [r.insertId, x.id]);
    await bitacora(con, actor, { accion: 'cotizacion_creada', entidad: 'cotizaciones', entidadId: r.insertId, despues: { numero, checklist: checklistId, rojos: libres.length } });
    return { id: r.insertId, numero };
  });
}

export async function actualizarCotizacion(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { notas?: string | null; vence_en?: string | null }) {
  const hoy = hoyDelTaller(ctx, t);
  await transaccion(t.pool, async (con) => {
    const c = await cotCruda(con, id, true);
    exigirBorrador(c);
    const sets: string[] = [];
    const v: unknown[] = [];
    if (d.notas !== undefined) {
      sets.push('notas = ?');
      v.push(normalizarCampo('texto', d.notas)?.slice(0, 500) ?? null);
    }
    if (d.vence_en !== undefined) {
      if (d.vence_en !== null && (d.vence_en < hoy || Number.isNaN(Date.parse(`${d.vence_en}T00:00:00Z`)))) throw new ErrorValidacion('La fecha de vencimiento no puede ser anterior a hoy');
      sets.push('vence_en = ?');
      v.push(d.vence_en);
    }
    if (sets.length === 0) return;
    await ejecutar(con, `UPDATE cotizaciones SET ${sets.join(', ')} WHERE id = ?`, [...v, id]);
    await bitacora(con, actor, { accion: 'cotizacion_editada', entidad: 'cotizaciones', entidadId: id, despues: d });
  });
}

// ── Hallazgos (los rojos) ─────────────────────────────────────────────────────────────
export async function agregarHallazgos(t: TallerReq, actor: Actor, id: number, respuestaIds: number[]) {
  await transaccion(t.pool, async (con) => {
    const c = await cotCruda(con, id, true);
    exigirBorrador(c);
    for (const rid of respuestaIds) {
      const r = await una<{ semaforo: string | null; equipo_id: number }>(con, 'SELECT r.semaforo, k.equipo_id FROM checklist_respuestas r JOIN checklists k ON k.id = r.checklist_id WHERE r.id = ?', [rid]);
      if (!r) throw new ErrorNoEncontrado('No se encontró uno de los ítems');
      if (r.semaforo !== 'rojo') throw new ErrorValidacion('Solo los ítems en rojo se cotizan');
      if (c.equipo_id && r.equipo_id !== c.equipo_id) throw new ErrorValidacion('Ese ítem es de otro equipo');
      await ejecutar(con, 'INSERT IGNORE INTO cotizacion_hallazgos (cotizacion_id, respuesta_id) VALUES (?, ?)', [id, rid]);
    }
    await bitacora(con, actor, { accion: 'cotizacion_hallazgos_agregados', entidad: 'cotizaciones', entidadId: id, despues: { respuestas: respuestaIds } });
  });
}

export async function quitarHallazgo(t: TallerReq, actor: Actor, id: number, respuestaId: number) {
  await transaccion(t.pool, async (con) => {
    exigirBorrador(await cotCruda(con, id, true));
    if (await una(con, 'SELECT id FROM cotizacion_lineas WHERE cotizacion_id = ? AND respuesta_id = ?', [id, respuestaId])) throw new ErrorApp(409, 'REGLA', 'Ese ítem tiene líneas en la cotización: quite primero las líneas.');
    await ejecutar(con, 'DELETE FROM cotizacion_hallazgos WHERE cotizacion_id = ? AND respuesta_id = ?', [id, respuestaId]);
    await bitacora(con, actor, { accion: 'cotizacion_hallazgo_quitado', entidad: 'cotizaciones', entidadId: id, despues: { respuestaId } });
  });
}

// ── Líneas ────────────────────────────────────────────────────────────────────────────
export interface DatosLineaCotizacion {
  tipo: 'servicio' | 'material' | 'tercero';
  respuesta_id?: number | null;
  trabajo_id?: number;
  material_id?: number;
  proveedor_id?: number;
  descripcion?: string;
  cantidad?: number;
  precio_unitario?: number;
  costo?: number;
  horas?: number;
  area_trabajo_id?: number | null;
}

export async function agregarLineaCotizacion(t: TallerReq, actor: Actor, id: number, d: DatosLineaCotizacion) {
  const cfgInv = d.tipo === 'material' ? await configDeInventario(t) : null;
  await transaccion(t.pool, async (con) => {
    const c = await cotCruda(con, id, true);
    exigirBorrador(c);
    if (d.respuesta_id && !(await una(con, 'SELECT id FROM cotizacion_hallazgos WHERE cotizacion_id = ? AND respuesta_id = ?', [id, d.respuesta_id]))) throw new ErrorValidacion('Ese ítem en rojo no está en esta cotización: agréguelo primero');
    const respuesta = d.respuesta_id ?? null;
    if (d.tipo === 'servicio') {
      if (!d.trabajo_id) throw new ErrorValidacion('Elija el trabajo del catálogo');
      if (!c.equipo_id) throw new ErrorApp(409, 'SIN_EQUIPO', 'Para cotizar trabajos del catálogo elija primero el equipo: las horas y la tarifa dependen de su tipo.');
      const tr = await una<{ nombre: string; variante: string | null; activo: number; area_trabajo_id: number | null }>(con, 'SELECT nombre, variante, activo, area_trabajo_id FROM trabajos WHERE id = ?', [d.trabajo_id]);
      if (!tr || tr.activo !== 1) throw new ErrorValidacion('El trabajo elegido no existe o está desactivado');
      const area = d.area_trabajo_id ?? tr.area_trabajo_id ?? null;
      const p = await precioServicioDeEquipo(con, c.equipo_id, d.trabajo_id, area, d.horas);
      const desc = await descuentoDelCliente(con, c.cliente_id, 'descuento_trabajos');
      await ejecutar(
        con,
        `INSERT INTO cotizacion_lineas (cotizacion_id, tipo, respuesta_id, trabajo_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo, horas, tarifa_hora_aplicada, costo_hora_aplicado, area_trabajo_id)
         VALUES (?, 'servicio', ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, respuesta, d.trabajo_id, [tr.nombre, tr.variante].filter(Boolean).join(' · ').slice(0, 250), p.precio, desc, totalDeLinea(1, p.precio, desc), p.costo, p.horas, p.tarifa, p.costoHora, area]
      );
    } else if (d.tipo === 'material') {
      if (!d.material_id) throw new ErrorValidacion('Elija el material');
      const cantidad = d.cantidad ?? 1;
      if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 1_000_000) throw new ErrorValidacion('La cantidad debe ser un número entero mayor que cero');
      const m = await una<{ codigo: string; nombre: string; activo: number; costo_promedio: number }>(con, 'SELECT codigo, nombre, activo, costo_promedio FROM materiales WHERE id = ?', [d.material_id]);
      if (!m || m.activo !== 1) throw new ErrorValidacion('El material elegido no existe o está desactivado');
      const precio = await precioDeMaterial(con, cfgInv!, d.material_id);
      const desc = await descuentoDelCliente(con, c.cliente_id, 'descuento_materiales');
      await ejecutar(
        con,
        `INSERT INTO cotizacion_lineas (cotizacion_id, tipo, respuesta_id, material_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo)
         VALUES (?, 'material', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, respuesta, d.material_id, `${m.codigo} ${m.nombre}`.slice(0, 250), cantidad, precio, desc, totalDeLinea(cantidad, precio, desc), r2(cantidad * Number(m.costo_promedio))]
      );
    } else {
      if (!d.proveedor_id) throw new ErrorValidacion('Elija el proveedor que hará el trabajo');
      const pv = await una<{ activo: number }>(con, 'SELECT activo FROM proveedores WHERE id = ?', [d.proveedor_id]);
      if (!pv || pv.activo !== 1) throw new ErrorValidacion('El proveedor elegido no existe o está desactivado');
      const descripcion = normalizarCampo('texto', d.descripcion);
      if (!descripcion) throw new ErrorValidacion('Describa el trabajo con terceros');
      const cantidad = d.cantidad ?? 1;
      const precio = d.precio_unitario ?? 0;
      if (!(cantidad > 0) || cantidad > 100000) throw new ErrorValidacion('La cantidad no es válida');
      if (precio < 0 || precio > 99999999 || (d.costo ?? 0) < 0) throw new ErrorValidacion('El precio o el costo no es válido');
      const desc = await descuentoDelCliente(con, c.cliente_id, 'descuento_otros');
      await ejecutar(
        con,
        `INSERT INTO cotizacion_lineas (cotizacion_id, tipo, respuesta_id, proveedor_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo)
         VALUES (?, 'tercero', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, respuesta, d.proveedor_id, descripcion.slice(0, 250), cantidad, precio, desc, totalDeLinea(cantidad, precio, desc), r2(d.costo ?? 0)]
      );
    }
    await recalcular(con, t, id);
    await bitacora(con, actor, { accion: 'cotizacion_linea_agregada', entidad: 'cotizaciones', entidadId: id, despues: d });
  });
}

async function lineaCruda(con: Ejecutor, lineaId: number) {
  const l = await una<{ id: number; cotizacion_id: number; tipo: 'servicio' | 'material' | 'tercero'; trabajo_id: number | null; material_id: number | null; area_trabajo_id: number | null; horas: number | null; cantidad: number; precio_unitario: number; descuento_pct: number; costo: number }>(
    con,
    'SELECT id, cotizacion_id, tipo, trabajo_id, material_id, area_trabajo_id, horas, cantidad, precio_unitario, descuento_pct, costo FROM cotizacion_lineas WHERE id = ? FOR UPDATE',
    [lineaId]
  );
  if (!l) throw new ErrorNoEncontrado('No se encontró la línea');
  return l;
}

export async function actualizarLineaCotizacion(t: TallerReq, actor: Actor, lineaId: number, d: { horas?: number; area_trabajo_id?: number | null; cantidad?: number; precio_unitario?: number; costo?: number; descripcion?: string }) {
  let cotId = 0;
  await transaccion(t.pool, async (con) => {
    const l = await lineaCruda(con, lineaId);
    cotId = l.cotizacion_id;
    const c = await cotCruda(con, l.cotizacion_id, true);
    exigirBorrador(c);
    if (l.tipo === 'servicio') {
      if (d.cantidad !== undefined || d.precio_unitario !== undefined || d.costo !== undefined || d.descripcion !== undefined) throw new ErrorValidacion('El precio de un trabajo sale de las horas por la tarifa: cambie las horas o el área');
      const area = d.area_trabajo_id === undefined ? l.area_trabajo_id : d.area_trabajo_id;
      const p = await precioServicioDeEquipo(con, c.equipo_id as number, l.trabajo_id as number, area, d.horas ?? Number(l.horas));
      await ejecutar(con, 'UPDATE cotizacion_lineas SET area_trabajo_id = ?, horas = ?, tarifa_hora_aplicada = ?, costo_hora_aplicado = ?, precio_unitario = ?, total_linea = ?, costo = ? WHERE id = ?', [area ?? null, p.horas, p.tarifa, p.costoHora, p.precio, totalDeLinea(1, p.precio, Number(l.descuento_pct)), p.costo, lineaId]);
    } else if (l.tipo === 'material') {
      if (d.horas !== undefined || d.precio_unitario !== undefined || d.costo !== undefined || d.descripcion !== undefined) throw new ErrorValidacion('De un material solo se cambia la cantidad: el precio sale del inventario');
      const cantidad = d.cantidad ?? Number(l.cantidad);
      if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 1_000_000) throw new ErrorValidacion('La cantidad debe ser un número entero mayor que cero');
      const m = await una<{ costo_promedio: number }>(con, 'SELECT costo_promedio FROM materiales WHERE id = ?', [l.material_id]);
      await ejecutar(con, 'UPDATE cotizacion_lineas SET cantidad = ?, total_linea = ?, costo = ? WHERE id = ?', [cantidad, totalDeLinea(cantidad, Number(l.precio_unitario), Number(l.descuento_pct)), r2(cantidad * Number(m?.costo_promedio ?? 0)), lineaId]);
    } else {
      if (d.horas !== undefined) throw new ErrorValidacion('Las horas solo se cambian en los trabajos del catálogo');
      const cantidad = d.cantidad ?? Number(l.cantidad);
      const precio = d.precio_unitario ?? Number(l.precio_unitario);
      if (!(cantidad > 0) || cantidad > 100000) throw new ErrorValidacion('La cantidad no es válida');
      if (precio < 0 || precio > 99999999 || (d.costo ?? 0) < 0) throw new ErrorValidacion('El precio o el costo no es válido');
      const txt = d.descripcion === undefined ? null : normalizarCampo('texto', d.descripcion);
      if (d.descripcion !== undefined && !txt) throw new ErrorValidacion('La descripción no puede quedar vacía');
      await ejecutar(con, `UPDATE cotizacion_lineas SET cantidad = ?, precio_unitario = ?, total_linea = ?, costo = ?${txt ? ', descripcion = ?' : ''} WHERE id = ?`, [cantidad, precio, totalDeLinea(cantidad, precio, Number(l.descuento_pct)), d.costo === undefined ? Number(l.costo) : r2(d.costo), ...(txt ? [txt.slice(0, 250)] : []), lineaId]);
    }
    await recalcular(con, t, l.cotizacion_id);
    await bitacora(con, actor, { accion: 'cotizacion_linea_editada', entidad: 'cotizacion_lineas', entidadId: lineaId, despues: d });
  });
  return cotId;
}

export async function quitarLineaCotizacion(t: TallerReq, actor: Actor, lineaId: number) {
  let cotId = 0;
  await transaccion(t.pool, async (con) => {
    const l = await lineaCruda(con, lineaId);
    cotId = l.cotizacion_id;
    exigirBorrador(await cotCruda(con, l.cotizacion_id, true));
    await ejecutar(con, 'DELETE FROM cotizacion_lineas WHERE id = ?', [lineaId]);
    await recalcular(con, t, l.cotizacion_id);
    await bitacora(con, actor, { accion: 'cotizacion_linea_quitada', entidad: 'cotizacion_lineas', entidadId: lineaId });
  });
  return cotId;
}

// ── Enviar, versiones, anular ─────────────────────────────────────────────────────────
export async function enviarCotizacion(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { vence_en?: string | null }) {
  const hoy = hoyDelTaller(ctx, t);
  const cfg = await leerConfiguracion(t);
  const vigencia = Math.max(1, Number(cfg['vigencia_cotizacion_dias'] ?? 15));
  await transaccion(t.pool, async (con) => {
    const c = await cotCruda(con, id, true);
    exigirBorrador(c);
    const n = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM cotizacion_lineas WHERE cotizacion_id = ?', [id]);
    if (Number(n?.n ?? 0) === 0) throw new ErrorApp(409, 'REGLA', 'La cotización no tiene líneas: agregue trabajos, materiales o trabajos con terceros antes de enviarla.');
    const vence = d.vence_en ?? c.vence_en ?? sumarDias(hoy, vigencia);
    if (vence < hoy) throw new ErrorValidacion('La fecha de vencimiento no puede ser anterior a hoy');
    await ejecutar(con, "UPDATE cotizaciones SET estado = 'enviada', enviada_en = ?, vence_en = ? WHERE id = ?", [ahoraDe(ctx), vence, id]);
    await bitacora(con, actor, { accion: 'cotizacion_enviada', entidad: 'cotizaciones', entidadId: id, despues: { numero: c.numero, vence_en: vence } });
  });
}

/** Una cotización enviada que se quiere cambiar nace como versión nueva (borrador) y la anterior queda «reemplazada». Solo si nadie ha respondido todavía. */
export async function nuevaVersion(ctx: Contexto, t: TallerReq, actor: Actor, id: number) {
  const hoy = hoyDelTaller(ctx, t);
  return transaccion(t.pool, async (con) => {
    await marcarCotizacionesVencidas(con, hoy);
    const c = await cotCruda(con, id, true);
    if (c.estado !== 'enviada' && c.estado !== 'vencida') throw new ErrorApp(409, 'REGLA', c.estado === 'borrador' ? 'Un borrador se edita directamente.' : `La cotización ${c.numero} está ${c.estado}: no se puede reemplazar. Si hace falta, cree una cotización nueva.`);
    const resp = await una<{ n: number }>(con, "SELECT COUNT(*) AS n FROM cotizacion_lineas WHERE cotizacion_id = ? AND estado IN ('autorizada', 'rechazada', 'agregada_a_orden')", [id]);
    if (Number(resp?.n ?? 0) > 0) throw new ErrorApp(409, 'REGLA', `La cotización ${c.numero} ya tiene líneas respondidas por el cliente: no se reemplaza. Cree una cotización nueva para lo que falte.`);
    const ant = await una<Record<string, unknown>>(con, 'SELECT cliente_id, equipo_id, orden_id, checklist_id, notas FROM cotizaciones WHERE id = ?', [id]);
    const r = await ejecutar(con, 'INSERT INTO cotizaciones (numero, version, reemplaza_a_id, cliente_id, equipo_id, orden_id, checklist_id, notas, creada_por_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [c.numero, c.version + 1, id, ant!['cliente_id'], ant!['equipo_id'], ant!['orden_id'], ant!['checklist_id'], ant!['notas'], actor.usuarioId]);
    await ejecutar(con, 'INSERT INTO cotizacion_hallazgos (cotizacion_id, respuesta_id) SELECT ?, respuesta_id FROM cotizacion_hallazgos WHERE cotizacion_id = ?', [r.insertId, id]);
    await ejecutar(
      con,
      `INSERT INTO cotizacion_lineas (cotizacion_id, tipo, respuesta_id, trabajo_id, material_id, proveedor_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo, horas, tarifa_hora_aplicada, costo_hora_aplicado, area_trabajo_id)
       SELECT ?, tipo, respuesta_id, trabajo_id, material_id, proveedor_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo, horas, tarifa_hora_aplicada, costo_hora_aplicado, area_trabajo_id FROM cotizacion_lineas WHERE cotizacion_id = ? ORDER BY id`,
      [r.insertId, id]
    );
    await ejecutar(con, "UPDATE cotizaciones SET estado = 'reemplazada' WHERE id = ?", [id]);
    await ejecutar(con, "UPDATE cotizacion_lineas SET estado = 'vencida' WHERE cotizacion_id = ? AND estado = 'pendiente'", [id]);
    await recalcular(con, t, r.insertId);
    await bitacora(con, actor, { accion: 'cotizacion_nueva_version', entidad: 'cotizaciones', entidadId: r.insertId, despues: { numero: c.numero, version: c.version + 1, reemplaza_a: id } });
    return { id: r.insertId, numero: c.numero, version: c.version + 1 };
  });
}

export async function anularCotizacion(ctx: Contexto, t: TallerReq, actor: Actor, id: number, motivo: string) {
  const texto = normalizarCampo('texto', motivo);
  if (!texto || texto.length < 3) throw new ErrorValidacion('Anular una cotización pide el motivo');
  await transaccion(t.pool, async (con) => {
    const c = await cotCruda(con, id, true);
    if (!['borrador', 'enviada', 'vencida', 'respondida'].includes(c.estado)) throw new ErrorApp(409, 'REGLA', `La cotización ${c.numero} está ${c.estado}: ya no se anula.`);
    const ag = await una<{ n: number }>(con, "SELECT COUNT(*) AS n FROM cotizacion_lineas WHERE cotizacion_id = ? AND estado = 'agregada_a_orden'", [id]);
    if (Number(ag?.n ?? 0) > 0) throw new ErrorApp(409, 'REGLA', `La cotización ${c.numero} ya llevó líneas a una orden: no se anula.`);
    await ejecutar(con, "UPDATE cotizaciones SET estado = 'anulada', anulada_en = ?, anulada_por_id = ?, motivo_anulacion = ? WHERE id = ?", [ahoraDe(ctx), actor.usuarioId, texto.slice(0, 300), id]);
    await bitacora(con, actor, { accion: 'cotizacion_anulada', entidad: 'cotizaciones', entidadId: id, motivo: texto });
  });
}

// ── La respuesta del cliente (registrada por el taller) ───────────────────────────────
/**
 * Autoriza o rechaza UNA línea. Aquí la registra una persona del taller a nombre del cliente (llamada, en persona; o la autorización interna
 * de la flota propia); queda quién, cuándo y desde qué dispositivo. Una respuesta no se cambia. Cuando todas están respondidas la cotización pasa a «respondida».
 */
export async function responderLinea(ctx: Contexto, t: TallerReq, actor: Actor, lineaId: number, d: { decision: 'autorizada' | 'rechazada'; motivo_id?: number | null; motivo_texto?: string | null; dispositivo?: string | null; ip?: string | null }) {
  const hoy = hoyDelTaller(ctx, t);
  let cotId = 0;
  await transaccion(t.pool, async (con) => {
    const l = await una<{ id: number; cotizacion_id: number; estado: string }>(con, 'SELECT id, cotizacion_id, estado FROM cotizacion_lineas WHERE id = ? FOR UPDATE', [lineaId]);
    if (!l) throw new ErrorNoEncontrado('No se encontró la línea');
    cotId = l.cotizacion_id;
    const c = await cotCruda(con, l.cotizacion_id, true);
    if (c.estado !== 'enviada') throw new ErrorApp(409, 'REGLA', c.estado === 'vencida' ? `La cotización ${c.numero} venció: ya no se responde.` : `La cotización ${c.numero} está ${c.estado}: solo se responde una cotización enviada.`);
    if (c.vence_en && c.vence_en < hoy) throw new ErrorApp(409, 'COTIZACION_VENCIDA', `La cotización ${c.numero} venció el ${c.vence_en}: ya no se responde.`);
    if (l.estado !== 'pendiente') throw new ErrorApp(409, 'REGLA', 'Esa línea ya tiene respuesta y no se cambia.');
    let motivoId: number | null = null;
    const texto = normalizarCampo('texto', d.motivo_texto)?.slice(0, 300) ?? null;
    if (d.decision === 'rechazada') {
      const m = d.motivo_id ? await una<{ activo: number }>(con, "SELECT activo FROM motivos WHERE id = ? AND tipo = 'rechazo_cotizacion'", [d.motivo_id]) : null;
      if (!m || m.activo !== 1) throw new ErrorValidacion('Para rechazar elija el motivo de la lista');
      motivoId = d.motivo_id as number;
    }
    await ejecutar(con, 'UPDATE cotizacion_lineas SET estado = ?, motivo_rechazo_id = ?, motivo_rechazo_texto = ?, respondida_en = ?, respondida_por_usuario_id = ?, dispositivo = ?, ip = ? WHERE id = ?', [d.decision, motivoId, texto, ahoraDe(ctx), actor.usuarioId, d.dispositivo?.slice(0, 200) ?? null, d.ip?.slice(0, 64) ?? null, lineaId]);
    const pend = await una<{ n: number }>(con, "SELECT COUNT(*) AS n FROM cotizacion_lineas WHERE cotizacion_id = ? AND estado = 'pendiente'", [l.cotizacion_id]);
    if (Number(pend?.n ?? 0) === 0) await ejecutar(con, "UPDATE cotizaciones SET estado = 'respondida' WHERE id = ?", [l.cotizacion_id]);
    await bitacora(con, actor, { accion: 'cotizacion_linea_respondida', entidad: 'cotizacion_lineas', entidadId: lineaId, despues: { decision: d.decision, motivo_id: motivoId } });
  });
  return cotId;
}

// ── Agregar a la orden ────────────────────────────────────────────────────────────────
/**
 * Lleva a una orden abierta lo AUTORIZADO que todavía no se llevó: los trabajos y los trabajos con terceros pasan como líneas de la orden con el
 * precio cotizado; los materiales se piden a bodega con una solicitud (se cobran con el precio del día del despacho). Lo hace una persona; no es automático.
 */
export async function agregarAOrden(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { orden_id?: number | null }) {
  const cfg = await configDePrecios(t);
  const hoy = hoyDelTaller(ctx, t);
  return transaccion(t.pool, async (con) => {
    await marcarCotizacionesVencidas(con, hoy);
    const c = await cotCruda(con, id, true);
    if (!['enviada', 'respondida', 'vencida'].includes(c.estado)) throw new ErrorApp(409, 'REGLA', `La cotización ${c.numero} está ${c.estado}: solo se lleva a la orden lo autorizado de una cotización enviada.`);
    const ordenId = d.orden_id ?? c.orden_id;
    if (!ordenId) throw new ErrorValidacion('Elija la orden a la que se agrega');
    const o = await bloquearOrdenAbierta(con, ordenId);
    if (c.equipo_id && o.equipo_id !== c.equipo_id) throw new ErrorApp(409, 'REGLA', 'Esa orden es de otro equipo.');
    const lineas = await filas<{ id: number; tipo: 'servicio' | 'material' | 'tercero'; trabajo_id: number | null; material_id: number | null; proveedor_id: number | null; descripcion: string; cantidad: number; precio_unitario: number; descuento_pct: number; total_linea: number; costo: number; horas: number | null; tarifa_hora_aplicada: number | null; costo_hora_aplicado: number | null; area_trabajo_id: number | null }>(
      con,
      "SELECT id, tipo, trabajo_id, material_id, proveedor_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo, horas, tarifa_hora_aplicada, costo_hora_aplicado, area_trabajo_id FROM cotizacion_lineas WHERE cotizacion_id = ? AND estado = 'autorizada' ORDER BY id FOR UPDATE",
      [id]
    );
    if (lineas.length === 0) throw new ErrorApp(409, 'REGLA', 'No hay líneas autorizadas pendientes de llevar a la orden.');
    const ahora = ahoraDe(ctx);
    const materiales = lineas.filter((l) => l.tipo === 'material');
    let solicitud: { id: number; numero: string } | null = null;
    if (materiales.length > 0) {
      const porMaterial = new Map<number, number>();
      for (const l of materiales) porMaterial.set(l.material_id as number, (porMaterial.get(l.material_id as number) ?? 0) + Number(l.cantidad));
      solicitud = await crearSolicitudEn(ctx, con, actor, { orden_id: ordenId, notas: `COTIZACION ${c.numero}`, lineas: [...porMaterial].map(([material_id, cantidad]) => ({ material_id, cantidad })) });
    }
    for (const l of lineas) {
      if (l.tipo === 'material') {
        await ejecutar(con, "UPDATE cotizacion_lineas SET estado = 'agregada_a_orden', agregada_orden_id = ?, agregada_en = ?, solicitud_id = ? WHERE id = ?", [ordenId, ahora, solicitud!.id, l.id]);
        continue;
      }
      const r = await ejecutar(
        con,
        `INSERT INTO lineas_orden (orden_id, tipo, trabajo_id, proveedor_id, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, costo, horas_trabajo, tarifa_hora_aplicada, costo_hora_aplicado, area_trabajo_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ordenId, l.tipo, l.trabajo_id, l.proveedor_id, l.descripcion, l.cantidad, l.precio_unitario, l.descuento_pct, l.total_linea, l.costo, l.horas, l.tarifa_hora_aplicada, l.costo_hora_aplicado, l.area_trabajo_id]
      );
      await ejecutar(con, "UPDATE cotizacion_lineas SET estado = 'agregada_a_orden', agregada_orden_id = ?, agregada_en = ?, linea_orden_id = ? WHERE id = ?", [ordenId, ahora, r.insertId, l.id]);
    }
    if (!c.orden_id) await ejecutar(con, 'UPDATE cotizaciones SET orden_id = ? WHERE id = ?', [ordenId, id]);
    await recalcularTotales(con, ordenId, cfg);
    await bitacora(con, actor, { accion: 'cotizacion_agregada_a_orden', entidad: 'cotizaciones', entidadId: id, despues: { numero: c.numero, orden: o.numero, lineas: lineas.length, solicitud: solicitud?.numero ?? null } });
    return { orden_id: ordenId, orden: o.numero, lineas: lineas.length, solicitud_id: solicitud?.id ?? null };
  });
}

// ── Consultar ─────────────────────────────────────────────────────────────────────────
export async function opcionesDeCotizacion(t: TallerReq) {
  const motivos = await filas<{ id: number; nombre: string }>(t.pool, "SELECT id, nombre FROM motivos WHERE tipo = 'rechazo_cotizacion' AND activo = 1 ORDER BY id");
  const cfg = await leerConfiguracion(t);
  return { motivos_rechazo: motivos, vigencia_dias: Math.max(1, Number(cfg['vigencia_cotizacion_dias'] ?? 15)) };
}

export async function listarCotizaciones(ctx: Contexto, t: TallerReq, f: { estado?: EstadoCotizacion; abiertas?: boolean; orden_id?: number; equipo_id?: number; cliente_id?: number; buscar?: string; pagina: number; porPagina: number }) {
  await marcarCotizacionesVencidas(t.pool, hoyDelTaller(ctx, t));
  const donde: string[] = ["c.estado <> 'reemplazada'"];
  const params: unknown[] = [];
  if (f.estado) {
    donde[0] = '1 = 1';
    donde.push('c.estado = ?');
    params.push(f.estado);
  }
  if (f.abiertas) donde.push("c.estado IN ('borrador', 'enviada')");
  for (const [col, v] of [['c.orden_id', f.orden_id], ['c.equipo_id', f.equipo_id], ['c.cliente_id', f.cliente_id]] as const) {
    if (v) {
      donde.push(`${col} = ?`);
      params.push(v);
    }
  }
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (x) => `\\${x}`)}%`;
    donde.push('(c.numero LIKE ? OR cl.nombre LIKE ? OR e.placa LIKE ? OR e.codigo_interno LIKE ?)');
    params.push(patron, patron, patron, patron);
  }
  const de = `FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN equipos e ON e.id = c.equipo_id LEFT JOIN ordenes o ON o.id = c.orden_id WHERE ${donde.join(' AND ')}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${de}`, params);
  const registros = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT c.id, c.numero, c.version, c.estado, cl.nombre AS cliente, NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa), '') AS equipo, o.numero AS orden, c.total, DATE_FORMAT(c.vence_en, '%Y-%m-%d') AS vence_en, c.enviada_en, c.created_at,
            (SELECT COUNT(*) FROM cotizacion_lineas l WHERE l.cotizacion_id = c.id) AS lineas,
            (SELECT COUNT(*) FROM cotizacion_lineas l WHERE l.cotizacion_id = c.id AND l.estado = 'pendiente') AS sin_respuesta,
            (SELECT COUNT(*) FROM cotizacion_lineas l WHERE l.cotizacion_id = c.id AND l.estado = 'autorizada') AS autorizadas,
            (SELECT COUNT(*) FROM cotizacion_lineas l WHERE l.cotizacion_id = c.id AND l.estado = 'rechazada') AS rechazadas
       ${de} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros: registros.map((r) => ({ ...r, total: Number(r['total']), lineas: Number(r['lineas']), sin_respuesta: Number(r['sin_respuesta']), autorizadas: Number(r['autorizadas']), rechazadas: Number(r['rechazadas']) })) };
}

export async function obtenerCotizacion(ctx: Contexto, t: TallerReq, id: number, vista: Vista) {
  await marcarCotizacionesVencidas(t.pool, hoyDelTaller(ctx, t));
  const c = await una<Record<string, unknown>>(
    t.pool,
    `SELECT c.id, c.numero, c.version, c.reemplaza_a_id, c.cliente_id, cl.nombre AS cliente, c.equipo_id, NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa), '') AS equipo, c.orden_id, o.numero AS orden, c.checklist_id, c.estado, c.notas,
            c.subtotal, c.descuento_total, c.iva, c.total, DATE_FORMAT(c.vence_en, '%Y-%m-%d') AS vence_en, c.enviada_en, co.nombre_completo AS creada_por, c.created_at, c.motivo_anulacion,
            (SELECT c2.id FROM cotizaciones c2 WHERE c2.numero = c.numero AND c2.version > c.version ORDER BY c2.version DESC LIMIT 1) AS version_nueva_id
       FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN equipos e ON e.id = c.equipo_id LEFT JOIN ordenes o ON o.id = c.orden_id LEFT JOIN usuarios u ON u.id = c.creada_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE c.id = ?`,
    [id]
  );
  if (!c) throw new ErrorNoEncontrado('No se encontró la cotización');
  const lineas = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT l.id, l.tipo, l.respuesta_id, l.trabajo_id, l.material_id, l.proveedor_id, pv.nombre AS proveedor, l.descripcion, l.cantidad, l.precio_unitario, l.descuento_pct, l.total_linea, l.costo, l.horas, l.area_trabajo_id,
            l.estado, l.motivo_rechazo_id, mo.nombre AS motivo_rechazo, l.motivo_rechazo_texto, l.respondida_en, co.nombre_completo AS respondida_por, l.dispositivo, l.agregada_en, ao.numero AS agregada_orden, l.solicitud_id, sm.numero AS solicitud
       FROM cotizacion_lineas l LEFT JOIN proveedores pv ON pv.id = l.proveedor_id LEFT JOIN motivos mo ON mo.id = l.motivo_rechazo_id LEFT JOIN usuarios u ON u.id = l.respondida_por_usuario_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id
       LEFT JOIN ordenes ao ON ao.id = l.agregada_orden_id LEFT JOIN solicitudes_material sm ON sm.id = l.solicitud_id WHERE l.cotizacion_id = ? ORDER BY l.id`,
    [id]
  );
  const hallazgos = await filas<{ respuesta_id: number; seccion: string; descripcion: string; nota: string | null; valor_texto: string | null; tipo: string; completado_en: Date | null }>(
    t.pool,
    `SELECT h.respuesta_id, r.seccion, r.descripcion, r.nota, r.valor_texto, ct.nombre AS tipo, k.completado_en
       FROM cotizacion_hallazgos h JOIN checklist_respuestas r ON r.id = h.respuesta_id JOIN checklists k ON k.id = r.checklist_id JOIN checklist_tipos ct ON ct.id = k.tipo_id WHERE h.cotizacion_id = ? ORDER BY h.id`,
    [id]
  );
  const fotos = hallazgos.length === 0 ? [] : await filas<{ respuesta_id: number; archivo_id: number }>(t.pool, 'SELECT respuesta_id, archivo_id FROM checklist_fotos WHERE respuesta_id IN (?) ORDER BY orden, id', [hallazgos.map((h) => h.respuesta_id)]);
  const desenlace = await desenlaceDeRespuestas(t.pool, hallazgos.map((h) => h.respuesta_id));
  const sinCosto = (l: Record<string, unknown>): Record<string, unknown> => {
    if (vista.costos) return { ...l, costo: Number(l['costo']) };
    const { costo: _c, ...resto } = l;
    return resto;
  };
  const { version_nueva_id, ...cabecera } = c;
  return {
    ...cabecera,
    subtotal: Number(c['subtotal']),
    descuento_total: Number(c['descuento_total']),
    iva: Number(c['iva']),
    total: Number(c['total']),
    version_nueva_id: version_nueva_id ?? null,
    lineas: lineas.map((l) => ({ ...sinCosto(l), cantidad: Number(l['cantidad']), precio_unitario: Number(l['precio_unitario']), descuento_pct: Number(l['descuento_pct']), total_linea: Number(l['total_linea']), horas: l['horas'] === null ? null : Number(l['horas']) })),
    hallazgos: hallazgos.map((h) => ({ ...h, desenlace: desenlace.get(h.respuesta_id), fotos: fotos.filter((f) => f.respuesta_id === h.respuesta_id).map((f) => ({ url: urlFirmada(ctx, t.empresa.slug, f.archivo_id) })) })),
  };
}
