import { PoolConnection } from 'mysql2/promise';
import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, siguienteNumero, TallerReq } from './comun';
import { registrarUsoEnEquipo } from './aplicabilidad';
import { avisarMaterialCargado, avisarSolicitudNueva } from './avisos';
import { hoyDelTaller } from './contadores';
import { aplicarMovimiento, ConfigPrecios, configDeInventario, margenDe, precioDe, Vista } from './inventario';
import { bloquearOrdenAbierta, cargarMaterialEnOrden } from './ordenes';
import { cubrirReservasDeLaOrden, existenciaEnSucursal, reservadoPorOtras } from './reservas-nucleo';

/**
 * Solicitudes de material (Fase 5b). La bodega tiene la obligación de proveer lo que el taller pide, así que no existe «rechazada»:
 * una solicitud está NO DESPACHADA, DESPACHADA PARCIAL, DESPACHADA o ANULADA (con motivo). Cada despacho baja el inventario de una bodega
 * de la MISMA sucursal que la orden, congela el costo del momento y carga el material a la orden con el precio de venta del momento.
 */

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
export const ESTADOS_SOLICITUD = ['no_despachada', 'despachada_parcial', 'despachada', 'anulada'] as const;
export type EstadoSolicitud = (typeof ESTADOS_SOLICITUD)[number];

const numeroDe = (prefijo: string, n: number): string => `${prefijo}-${String(n).padStart(6, '0')}`;

/** Precio de venta de un material AHORA (precio fijo, o costo base más el margen que le toca). */
export async function precioDeMaterial(con: Ejecutor, cfg: ConfigPrecios, materialId: number): Promise<number> {
  const m = await una<{ costo_ultimo: number; costo_promedio: number; precio_manual: number | null; parte_id: number; subsistema_id: number; sistema_id: number }>(
    con,
    `SELECT m.costo_ultimo, m.costo_promedio, m.precio_manual, m.parte_id, x.id AS subsistema_id, x.sistema_id
       FROM materiales m JOIN partes p ON p.id = m.parte_id JOIN subsistemas x ON x.id = p.subsistema_id WHERE m.id = ?`,
    [materialId]
  );
  if (!m) throw new ErrorNoEncontrado('No se encontró el material');
  const margenes = await filas<{ nivel: string; referencia_id: number; porcentaje: number }>(con, 'SELECT nivel, referencia_id, porcentaje FROM margenes');
  const margen = margenDe(materialId, m, margenes, cfg.margenGeneral);
  return precioDe({ costo_ultimo: Number(m.costo_ultimo), costo_promedio: Number(m.costo_promedio), precio_manual: m.precio_manual === null ? null : Number(m.precio_manual) }, margen.porcentaje, cfg.baseCosto);
}

// ── Pedir ─────────────────────────────────────────────────────────────────────────────
export async function crearSolicitud(ctx: Contexto, t: TallerReq, actor: Actor, d: { orden_id: number; notas?: string | null; lineas: Array<{ material_id: number; cantidad: number }> }) {
  const r = await transaccion(t.pool, (con) => crearSolicitudEn(ctx, con, actor, d));
  await avisarSolicitudNueva(ctx, t, r.id);
  return r;
}

/** Pide los materiales dentro de una transacción que ya está abierta (lo usa también «Cargar a la orden» de una reserva). */
export async function crearSolicitudEn(ctx: Contexto, con: PoolConnection, actor: Actor, d: { orden_id: number; notas?: string | null; lineas: Array<{ material_id: number; cantidad: number }> }) {
  if (d.lineas.length === 0 || d.lineas.length > 50) throw new ErrorValidacion('La solicitud necesita entre 1 y 50 materiales');
  const vistos = new Set<number>();
  for (const l of d.lineas) {
    if (!Number.isInteger(l.cantidad) || l.cantidad <= 0 || l.cantidad > 1_000_000) throw new ErrorValidacion('Las cantidades deben ser números enteros mayores que cero');
    if (vistos.has(l.material_id)) throw new ErrorValidacion('Un material aparece dos veces en la solicitud: sume las cantidades en una sola línea');
    vistos.add(l.material_id);
  }
  {
    const o = await bloquearOrdenAbierta(con, d.orden_id);
    const numero = numeroDe('SOL', await siguienteNumero(con, 'SOL'));
    const r = await ejecutar(con, 'INSERT INTO solicitudes_material (numero, orden_id, solicitante_id, notas, solicitada_en) VALUES (?, ?, ?, ?, ?)', [numero, d.orden_id, actor.usuarioId, normalizarCampo('texto', d.notas)?.slice(0, 300) ?? null, ahoraDe(ctx)]);
    for (const l of [...d.lineas].sort((a, b) => a.material_id - b.material_id)) {
      const m = await una<{ activo: number }>(con, 'SELECT activo FROM materiales WHERE id = ?', [l.material_id]);
      if (!m || m.activo !== 1) throw new ErrorValidacion('Alguno de los materiales no existe o está desactivado');
      await ejecutar(con, 'INSERT INTO solicitud_lineas (solicitud_id, material_id, cantidad_solicitada) VALUES (?, ?, ?)', [r.insertId, l.material_id, l.cantidad]);
    }
    await bitacora(con, actor, { accion: 'solicitud_material_creada', entidad: 'solicitudes_material', entidadId: r.insertId, despues: { numero, orden: o.numero, lineas: d.lineas.length } });
    return { id: r.insertId, numero };
  }
}

// ── Consultar ─────────────────────────────────────────────────────────────────────────
export async function listarSolicitudes(t: TallerReq, f: { estado?: EstadoSolicitud; pendientes?: boolean; orden_id?: number; buscar?: string; pagina: number; porPagina: number }) {
  const donde: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (f.estado) {
    donde.push('s.estado = ?');
    params.push(f.estado);
  }
  if (f.pendientes) donde.push("s.estado IN ('no_despachada', 'despachada_parcial')");
  if (f.orden_id) {
    donde.push('s.orden_id = ?');
    params.push(f.orden_id);
  }
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    donde.push('(s.numero LIKE ? OR o.numero LIKE ? OR c.nombre LIKE ?)');
    params.push(patron, patron, patron);
  }
  const de = `FROM solicitudes_material s JOIN ordenes o ON o.id = s.orden_id LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE ${donde.join(' AND ')}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${de}`, params);
  const registros = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT s.id, s.numero, s.orden_id, o.numero AS orden, c.nombre AS cliente, co.nombre_completo AS solicitante, s.estado, s.notas, s.solicitada_en, s.primer_despacho_en, s.despachada_en,
            (SELECT COUNT(*) FROM solicitud_lineas l WHERE l.solicitud_id = s.id) AS lineas,
            (SELECT COALESCE(SUM(l.cantidad_solicitada - l.cantidad_despachada), 0) FROM solicitud_lineas l WHERE l.solicitud_id = s.id) AS unidades_pendientes
       ${de} ORDER BY (s.estado IN ('no_despachada', 'despachada_parcial')) DESC, s.solicitada_en DESC, s.id DESC LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros: registros.map((r) => ({ ...r, lineas: Number(r['lineas']), unidades_pendientes: Number(r['unidades_pendientes']) })) };
}

export async function obtenerSolicitud(t: TallerReq, id: number, vista: Vista) {
  const s = await una<Record<string, unknown>>(
    t.pool,
    `SELECT s.id, s.numero, s.orden_id, o.numero AS orden, o.sucursal_id, sc.nombre AS sucursal, es.es_terminal AS orden_cerrada, c.nombre AS cliente, co.nombre_completo AS solicitante, s.solicitante_id, s.estado, s.notas,
            s.solicitada_en, s.primer_despacho_en, s.despachada_en, s.anulada_en, s.motivo_anulacion
       FROM solicitudes_material s JOIN ordenes o ON o.id = s.orden_id JOIN estados_orden es ON es.id = o.estado_id JOIN sucursales sc ON sc.id = o.sucursal_id LEFT JOIN clientes c ON c.id = o.cliente_id
       LEFT JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE s.id = ?`,
    [id]
  );
  if (!s) throw new ErrorNoEncontrado('No se encontró la solicitud');
  const lineas = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT l.id, l.material_id, m.codigo, m.nombre, u.codigo AS unidad, l.cantidad_solicitada, l.cantidad_despachada,
            COALESCE((SELECT SUM(d.cantidad) FROM devoluciones_material d WHERE d.solicitud_linea_id = l.id), 0) AS cantidad_devuelta
       FROM solicitud_lineas l JOIN materiales m ON m.id = l.material_id JOIN unidades u ON u.id = m.unidad_id WHERE l.solicitud_id = ? ORDER BY l.id`,
    [id]
  );
  const stock = await filas<{ material_id: number; bodega_id: number; bodega: string; cantidad: number }>(
    t.pool,
    `SELECT l.material_id, b.id AS bodega_id, b.nombre AS bodega, COALESCE(e.cantidad, 0) AS cantidad
       FROM solicitud_lineas l JOIN bodegas b ON b.sucursal_id = ? AND b.activo = 1 LEFT JOIN existencias e ON e.material_id = l.material_id AND e.bodega_id = b.id
      WHERE l.solicitud_id = ? ORDER BY b.nombre`,
    [s['sucursal_id'], id]
  );
  const despachos = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT d.id, d.solicitud_linea_id, d.bodega_id, b.nombre AS bodega, d.cantidad, d.costo_unitario, d.fecha, co.nombre_completo AS despachado_por
       FROM despachos_material d JOIN solicitud_lineas l ON l.id = d.solicitud_linea_id JOIN bodegas b ON b.id = d.bodega_id LEFT JOIN usuarios u ON u.id = d.despachado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id
      WHERE l.solicitud_id = ? ORDER BY d.id`,
    [id]
  );
  const devoluciones = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT d.id, d.numero, d.solicitud_linea_id, d.bodega_id, b.nombre AS bodega, d.cantidad, d.costo_unitario, d.motivo, d.fecha, co.nombre_completo AS registrada_por
       FROM devoluciones_material d JOIN solicitud_lineas l ON l.id = d.solicitud_linea_id JOIN bodegas b ON b.id = d.bodega_id LEFT JOIN usuarios u ON u.id = d.registrada_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id
      WHERE l.solicitud_id = ? ORDER BY d.id`,
    [id]
  );
  const sinCosto = (x: Record<string, unknown>): Record<string, unknown> => {
    if (vista.costos) return { ...x, costo_unitario: Number(x['costo_unitario']) };
    const { costo_unitario: _omitido, ...resto } = x;
    return resto;
  };
  const { sucursal_id: _sucursal, orden_cerrada, ...cabecera } = s;
  return {
    ...cabecera,
    orden_cerrada: Number(orden_cerrada) === 1,
    lineas: lineas.map((l) => {
      const solicitada = Number(l['cantidad_solicitada']);
      const despachada = Number(l['cantidad_despachada']);
      const devuelta = Number(l['cantidad_devuelta']);
      return {
        id: l['id'],
        material_id: l['material_id'],
        codigo: l['codigo'],
        nombre: l['nombre'],
        unidad: l['unidad'],
        cantidad_solicitada: solicitada,
        cantidad_despachada: despachada,
        cantidad_devuelta: devuelta,
        pendiente: solicitada - despachada,
        en_la_orden: despachada - devuelta,
        por_bodega: stock.filter((x) => x.material_id === l['material_id']).map((x) => ({ bodega_id: x.bodega_id, bodega: x.bodega, cantidad: Number(x.cantidad) })),
      };
    }),
    despachos: despachos.map(sinCosto),
    devoluciones: devoluciones.map(sinCosto),
  };
}

// ── Despachar ─────────────────────────────────────────────────────────────────────────
interface FilaLinea {
  id: number;
  material_id: number;
  cantidad_solicitada: number;
  cantidad_despachada: number;
  codigo: string;
  nombre: string;
  costo_promedio: number;
}

async function bodegaDeLaSucursal(con: Ejecutor, bodegaId: number, sucursalId: number): Promise<void> {
  const b = await una<{ activo: number; sucursal_id: number; nombre: string }>(con, 'SELECT activo, sucursal_id, nombre FROM bodegas WHERE id = ?', [bodegaId]);
  if (!b || b.activo !== 1) throw new ErrorValidacion('La bodega elegida no existe o está desactivada');
  if (b.sucursal_id !== sucursalId) throw new ErrorApp(409, 'BODEGA_OTRA_SUCURSAL', `La bodega ${b.nombre} es de otra sucursal: el material de una orden se despacha solo desde las bodegas de su misma sucursal.`);
}

export async function despachar(ctx: Contexto, t: TallerReq, actor: Actor, id: number, items: Array<{ linea_id: number; bodega_id: number; cantidad: number }>) {
  if (items.length === 0 || items.length > 100) throw new ErrorValidacion('Indique qué se despacha');
  for (const i of items) if (!Number.isInteger(i.cantidad) || i.cantidad <= 0) throw new ErrorValidacion('Las cantidades deben ser números enteros mayores que cero');
  const r = await transaccion(t.pool, (con) => despacharEn(ctx, t, con, actor, id, items));
  await avisarMaterialCargado(ctx, t, id);
  return r;
}

/** Despacha dentro de una transacción que ya está abierta (lo usa también «Cargar a la orden» de una reserva). */
export async function despacharEn(ctx: Contexto, t: TallerReq, con: PoolConnection, actor: Actor, id: number, items: Array<{ linea_id: number; bodega_id: number; cantidad: number }>) {
  const cfg = await configDeInventario(t);
  const hoy = hoyDelTaller(ctx, t);
  {
    const s = await una<{ id: number; numero: string; orden_id: number; estado: EstadoSolicitud }>(con, 'SELECT id, numero, orden_id, estado FROM solicitudes_material WHERE id = ? FOR UPDATE', [id]);
    if (!s) throw new ErrorNoEncontrado('No se encontró la solicitud');
    if (s.estado === 'anulada') throw new ErrorApp(409, 'REGLA', `La solicitud ${s.numero} está anulada: ya no se despacha.`);
    if (s.estado === 'despachada') throw new ErrorApp(409, 'REGLA', `La solicitud ${s.numero} ya se despachó completa.`);
    const orden = await bloquearOrdenAbierta(con, s.orden_id);
    const ahora = ahoraDe(ctx);
    // Siempre en el mismo orden (material y bodega) para que dos despachos a la vez no se atoren.
    const ordenados: Array<{ linea_id: number; bodega_id: number; cantidad: number; material_id: number }> = [];
    for (const i of items) {
      const l = await una<{ material_id: number }>(con, 'SELECT material_id FROM solicitud_lineas WHERE id = ? AND solicitud_id = ?', [i.linea_id, id]);
      if (!l) throw new ErrorValidacion('Una de las líneas no pertenece a esta solicitud');
      ordenados.push({ ...i, material_id: l.material_id });
    }
    ordenados.sort((a, b) => a.material_id - b.material_id || a.bodega_id - b.bodega_id);
    for (const i of ordenados) {
      await bodegaDeLaSucursal(con, i.bodega_id, orden.sucursal_id);
      const l = await una<FilaLinea>(
        con,
        `SELECT l.id, l.material_id, l.cantidad_solicitada, l.cantidad_despachada, m.codigo, m.nombre, m.costo_promedio
           FROM solicitud_lineas l JOIN materiales m ON m.id = l.material_id WHERE l.id = ? FOR UPDATE`,
        [i.linea_id]
      );
      if (!l) throw new ErrorValidacion('Una de las líneas no existe');
      const pendiente = Number(l.cantidad_solicitada) - Number(l.cantidad_despachada);
      if (i.cantidad > pendiente) throw new ErrorApp(409, 'EXCEDE_SOLICITADO', `De ${l.codigo} ${l.nombre} solo faltan ${pendiente} por despachar: no se puede despachar más de lo pedido.`, { pendiente });
      const costo = Number(l.costo_promedio);
      // Las unidades reservadas para OTRAS órdenes de la sucursal están protegidas: no se pueden despachar a esta.
      const enSucursal = await existenciaEnSucursal(con, l.material_id, orden.sucursal_id);
      const reservado = await reservadoPorOtras(con, l.material_id, orden.sucursal_id, s.orden_id, hoy);
      if (reservado > 0 && i.cantidad <= enSucursal && i.cantidad > enSucursal - reservado) {
        throw new ErrorApp(409, 'RESERVADO', `De ${l.codigo} ${l.nombre} hay ${enSucursal} pero ${reservado} están reservados para otras órdenes: solo se pueden despachar ${Math.max(0, enSucursal - reservado)}.`, { disponible: Math.max(0, enSucursal - reservado), reservado });
      }
      const mov = await aplicarMovimiento(ctx, con, actor, { material_id: l.material_id, bodega_id: i.bodega_id, tipo: 'despacho', cantidad: -i.cantidad, costo_unitario: costo, referencia_tipo: 'solicitud', referencia_id: id });
      await ejecutar(con, 'INSERT INTO despachos_material (solicitud_linea_id, bodega_id, cantidad, costo_unitario, movimiento_id, despachado_por_id, fecha) VALUES (?, ?, ?, ?, ?, ?, ?)', [l.id, i.bodega_id, i.cantidad, costo, mov.id, actor.usuarioId, ahora]);
      await ejecutar(con, 'UPDATE solicitud_lineas SET cantidad_despachada = cantidad_despachada + ? WHERE id = ?', [i.cantidad, l.id]);
      const precio = await precioDeMaterial(con, cfg, l.material_id);
      await cargarMaterialEnOrden(t, con, actor, { orden_id: s.orden_id, solicitud_linea_id: l.id, material_id: l.material_id, descripcion: `${l.codigo} ${l.nombre}`, cantidad: i.cantidad, costo: r2(i.cantidad * costo), precio_unitario: precio });
      await cubrirReservasDeLaOrden(con, s.orden_id, l.material_id, i.cantidad, ahora);
      await registrarUsoEnEquipo(con, l.material_id, orden.equipo_id, ahora);
    }
    const f = await una<{ pendientes: number; despachadas: number }>(con, 'SELECT COALESCE(SUM(cantidad_solicitada - cantidad_despachada), 0) AS pendientes, COALESCE(SUM(cantidad_despachada), 0) AS despachadas FROM solicitud_lineas WHERE solicitud_id = ?', [id]);
    const completa = Number(f?.pendientes ?? 0) === 0;
    await ejecutar(con, 'UPDATE solicitudes_material SET estado = ?, primer_despacho_en = COALESCE(primer_despacho_en, ?), despachada_en = ? WHERE id = ?', [completa ? 'despachada' : 'despachada_parcial', ahora, completa ? ahora : null, id]);
    await bitacora(con, actor, { accion: 'solicitud_material_despachada', entidad: 'solicitudes_material', entidadId: id, despues: { numero: s.numero, orden: orden.numero, completa, items: items.length } });
    return { id, estado: completa ? 'despachada' : 'despachada_parcial' };
  }
}

// ── Devolver ──────────────────────────────────────────────────────────────────────────
export async function devolver(ctx: Contexto, t: TallerReq, actor: Actor, d: { solicitud_linea_id: number; bodega_id: number; cantidad: number; motivo: string }) {
  if (!Number.isInteger(d.cantidad) || d.cantidad <= 0) throw new ErrorValidacion('La cantidad debe ser un número entero mayor que cero');
  const motivo = normalizarCampo('texto', d.motivo);
  if (!motivo || motivo.length < 3) throw new ErrorValidacion('Una devolución pide el motivo');
  return transaccion(t.pool, async (con) => {
    const l = await una<{ id: number; solicitud_id: number; material_id: number; orden_id: number; codigo: string; nombre: string }>(
      con,
      `SELECT l.id, l.solicitud_id, l.material_id, s.orden_id, m.codigo, m.nombre
         FROM solicitud_lineas l JOIN solicitudes_material s ON s.id = l.solicitud_id JOIN materiales m ON m.id = l.material_id WHERE l.id = ? FOR UPDATE`,
      [d.solicitud_linea_id]
    );
    if (!l) throw new ErrorNoEncontrado('No se encontró la línea de la solicitud');
    const orden = await bloquearOrdenAbierta(con, l.orden_id);
    await bodegaDeLaSucursal(con, d.bodega_id, orden.sucursal_id);
    const linea = await una<{ cantidad: number; costo: number }>(con, 'SELECT cantidad, costo FROM lineas_orden WHERE solicitud_linea_id = ? FOR UPDATE', [l.id]);
    const enLaOrden = Number(linea?.cantidad ?? 0);
    if (!linea || d.cantidad > enLaOrden) throw new ErrorApp(409, 'EXCEDE_DESPACHADO', `De ${l.codigo} ${l.nombre} hay ${enLaOrden} en la orden: no se puede devolver ${d.cantidad}.`, { en_la_orden: enLaOrden });
    // El material vuelve a la bodega con el costo con el que salió (el promedio de lo que sigue en la orden).
    const unitario = r2(Number(linea.costo) / enLaOrden);
    const costoQueSale = d.cantidad === enLaOrden ? Number(linea.costo) : r2(d.cantidad * unitario);
    const mov = await aplicarMovimiento(ctx, con, actor, { material_id: l.material_id, bodega_id: d.bodega_id, tipo: 'devolucion', cantidad: d.cantidad, costo_unitario: unitario, referencia_tipo: 'solicitud', referencia_id: l.solicitud_id, notas: motivo });
    const numero = numeroDe('DEV', await siguienteNumero(con, 'DEV'));
    const r = await ejecutar(con, 'INSERT INTO devoluciones_material (numero, solicitud_linea_id, bodega_id, cantidad, costo_unitario, motivo, movimiento_id, registrada_por_id, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [numero, l.id, d.bodega_id, d.cantidad, unitario, motivo.slice(0, 200), mov.id, actor.usuarioId, ahoraDe(ctx)]);
    await cargarMaterialEnOrden(t, con, actor, { orden_id: l.orden_id, solicitud_linea_id: l.id, material_id: l.material_id, descripcion: `${l.codigo} ${l.nombre}`, cantidad: -d.cantidad, costo: -costoQueSale, precio_unitario: 0 });
    await bitacora(con, actor, { accion: 'solicitud_material_devuelta', entidad: 'solicitudes_material', entidadId: l.solicitud_id, motivo, despues: { numero, cantidad: d.cantidad } });
    return { id: r.insertId, numero, solicitud_id: l.solicitud_id };
  });
}

// ── Anular ────────────────────────────────────────────────────────────────────────────
/** La anula quien la pidió (o quien tenga el permiso). Si ya hubo despachos, se anula lo que falta; lo despachado se devuelve aparte. */
export async function anularSolicitud(ctx: Contexto, t: TallerReq, actor: Actor, id: number, motivo: string, puedeAnularAjena: boolean) {
  const texto = normalizarCampo('texto', motivo);
  if (!texto || texto.length < 3) throw new ErrorValidacion('Anular una solicitud pide el motivo');
  return transaccion(t.pool, async (con: PoolConnection) => {
    const s = await una<{ numero: string; estado: EstadoSolicitud; solicitante_id: number | null }>(con, 'SELECT numero, estado, solicitante_id FROM solicitudes_material WHERE id = ? FOR UPDATE', [id]);
    if (!s) throw new ErrorNoEncontrado('No se encontró la solicitud');
    if (s.estado === 'anulada') throw new ErrorApp(409, 'REGLA', `La solicitud ${s.numero} ya está anulada.`);
    if (s.estado === 'despachada') throw new ErrorApp(409, 'REGLA', `La solicitud ${s.numero} ya se despachó completa: para deshacerla devuelva el material a la bodega.`);
    if (s.solicitante_id !== actor.usuarioId && !puedeAnularAjena) throw new ErrorApp(403, 'SIN_PERMISO', 'Una solicitud la anula quien la pidió o quien tenga el permiso para hacerlo.');
    await ejecutar(con, "UPDATE solicitudes_material SET estado = 'anulada', anulada_en = ?, anulada_por_id = ?, motivo_anulacion = ? WHERE id = ?", [ahoraDe(ctx), actor.usuarioId, texto.slice(0, 300), id]);
    await bitacora(con, actor, { accion: 'solicitud_material_anulada', entidad: 'solicitudes_material', entidadId: id, motivo: texto });
    return { id };
  });
}
