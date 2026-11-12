import { PoolConnection } from 'mysql2/promise';
import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { validarFechaRazonable } from '../utils/fechas';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, siguienteNumero, TallerReq } from './comun';
import { leerConfiguracion } from './configuracion';
import { hoyDelTaller } from './contadores';

/**
 * Inventario (Fase 5a): materiales, existencias por bodega, compras, traslados y diferencias.
 * Reglas aprobadas: cantidades SIEMPRE enteras; la existencia vive en UN solo lugar; una cantidad solo cambia por un movimiento
 * (con su motivo y su usuario) y nunca queda negativa; la única forma de corregirla es la «diferencia de inventario».
 */

export interface Vista {
  costos: boolean;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Margen y precio ───────────────────────────────────────────────────────────────────
export interface ConfigPrecios {
  /** Con qué costo se sugiere el precio: el último o el promedio ponderado. */
  baseCosto: 'ULTIMO COSTO' | 'COSTO PROMEDIO';
  margenGeneral: number;
}

export async function configDeInventario(t: TallerReq): Promise<ConfigPrecios> {
  const c = await leerConfiguracion(t);
  return { baseCosto: c['costo_base_inventario'] === 'ULTIMO COSTO' ? 'ULTIMO COSTO' : 'COSTO PROMEDIO', margenGeneral: Number(c['margen_general'] ?? 30) };
}

interface Clasificacion {
  parte_id: number;
  subsistema_id: number;
  sistema_id: number;
}

/** El margen que le toca a un material: manda el más específico (material > parte > subsistema > sistema > general). */
export function margenDe(materialId: number, c: Clasificacion, margenes: Array<{ nivel: string; referencia_id: number; porcentaje: number }>, general: number): { porcentaje: number; nivel: string } {
  const buscar = (nivel: string, ref: number): number | null => {
    const m = margenes.find((x) => x.nivel === nivel && x.referencia_id === ref);
    return m ? Number(m.porcentaje) : null;
  };
  for (const [nivel, ref] of [['material', materialId], ['parte', c.parte_id], ['subsistema', c.subsistema_id], ['sistema', c.sistema_id]] as const) {
    const p = buscar(nivel, ref);
    if (p !== null) return { porcentaje: p, nivel };
  }
  return { porcentaje: general, nivel: 'general' };
}

/** Precio de venta: el fijado a mano, o el costo base más el margen. */
export function precioDe(m: { costo_ultimo: number; costo_promedio: number; precio_manual: number | null }, margen: number, base: ConfigPrecios['baseCosto']): number {
  if (m.precio_manual !== null) return r2(Number(m.precio_manual));
  const costo = base === 'ULTIMO COSTO' ? Number(m.costo_ultimo) : Number(m.costo_promedio);
  return r2(costo * (1 + margen / 100));
}

export async function listarMargenes(t: TallerReq) {
  return filas<{ nivel: string; referencia_id: number; porcentaje: number; nombre: string }>(
    t.pool,
    `SELECT mg.nivel, mg.referencia_id, mg.porcentaje,
            CASE mg.nivel WHEN 'sistema' THEN (SELECT CONCAT(s.codigo, ' ', s.nombre) FROM sistemas s WHERE s.id = mg.referencia_id)
                          WHEN 'subsistema' THEN (SELECT CONCAT(s.codigo, '-', x.codigo, ' ', x.nombre) FROM subsistemas x JOIN sistemas s ON s.id = x.sistema_id WHERE x.id = mg.referencia_id)
                          WHEN 'parte' THEN (SELECT CONCAT(s.codigo, '-', x.codigo, '-', p.codigo, ' ', p.nombre) FROM partes p JOIN subsistemas x ON x.id = p.subsistema_id JOIN sistemas s ON s.id = x.sistema_id WHERE p.id = mg.referencia_id)
                          ELSE (SELECT CONCAT(m.codigo, ' ', m.nombre) FROM materiales m WHERE m.id = mg.referencia_id) END AS nombre
       FROM margenes mg ORDER BY FIELD(mg.nivel, 'sistema', 'subsistema', 'parte', 'material'), mg.referencia_id`
  );
}

export async function definirMargen(t: TallerReq, actor: Actor, d: { nivel: 'sistema' | 'subsistema' | 'parte' | 'material'; referencia_id: number; porcentaje: number }) {
  if (!(d.porcentaje >= 0 && d.porcentaje <= 1000)) throw new ErrorValidacion('El margen debe estar entre 0 y 1000 %');
  const tabla = { sistema: 'sistemas', subsistema: 'subsistemas', parte: 'partes', material: 'materiales' }[d.nivel];
  await transaccion(t.pool, async (con) => {
    if (!(await una(con, `SELECT id FROM ${tabla} WHERE id = ?`, [d.referencia_id]))) throw new ErrorNoEncontrado('No se encontró lo que se quiere marcar con ese margen');
    await ejecutar(con, 'INSERT INTO margenes (nivel, referencia_id, porcentaje) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE porcentaje = VALUES(porcentaje)', [d.nivel, d.referencia_id, r2(d.porcentaje)]);
    await bitacora(con, actor, { accion: 'margen_definido', entidad: 'margenes', entidadId: d.referencia_id, despues: d });
  });
  return listarMargenes(t);
}

export async function quitarMargen(t: TallerReq, actor: Actor, nivel: string, referenciaId: number) {
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'DELETE FROM margenes WHERE nivel = ? AND referencia_id = ?', [nivel, referenciaId]);
    await bitacora(con, actor, { accion: 'margen_quitado', entidad: 'margenes', entidadId: referenciaId, despues: { nivel } });
  });
  return listarMargenes(t);
}

// ── Movimientos: la ÚNICA puerta por la que cambia una cantidad ───────────────────────
export interface DatosMovimiento {
  material_id: number;
  bodega_id: number;
  tipo: 'compra' | 'despacho' | 'devolucion' | 'traslado_salida' | 'traslado_entrada' | 'diferencia';
  /** Con signo: entra (+) o sale (−). */
  cantidad: number;
  costo_unitario: number;
  referencia_tipo?: string | null;
  referencia_id?: number | null;
  motivo_id?: number | null;
  notas?: string | null;
}

/** Aplica un movimiento a la existencia de esa bodega (con bloqueo) y lo anota en el libro. Falla si la cantidad quedaría negativa. */
export async function aplicarMovimiento(ctx: Contexto, con: PoolConnection, actor: Actor, d: DatosMovimiento): Promise<{ id: number; saldo: number }> {
  if (!Number.isInteger(d.cantidad) || d.cantidad === 0) throw new ErrorValidacion('La cantidad debe ser un número entero distinto de cero');
  await ejecutar(con, 'INSERT IGNORE INTO existencias (material_id, bodega_id, cantidad) VALUES (?, ?, 0)', [d.material_id, d.bodega_id]);
  const e = await una<{ cantidad: number }>(con, 'SELECT cantidad FROM existencias WHERE material_id = ? AND bodega_id = ? FOR UPDATE', [d.material_id, d.bodega_id]);
  const saldo = Number(e?.cantidad ?? 0) + d.cantidad;
  if (saldo < 0) {
    const m = await una<{ codigo: string; nombre: string }>(con, 'SELECT codigo, nombre FROM materiales WHERE id = ?', [d.material_id]);
    throw new ErrorApp(409, 'SIN_EXISTENCIA', `No hay suficiente inventario de ${m?.codigo ?? ''} ${m?.nombre ?? ''}: hay ${Number(e?.cantidad ?? 0)} y se necesitan ${-d.cantidad}.`, { disponible: Number(e?.cantidad ?? 0), material_id: d.material_id });
  }
  await ejecutar(con, 'UPDATE existencias SET cantidad = ? WHERE material_id = ? AND bodega_id = ?', [saldo, d.material_id, d.bodega_id]);
  const r = await ejecutar(
    con,
    'INSERT INTO movimientos_inventario (material_id, bodega_id, tipo, cantidad, saldo_resultante, costo_unitario, referencia_tipo, referencia_id, motivo_id, notas, usuario_id, fecha) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [d.material_id, d.bodega_id, d.tipo, d.cantidad, saldo, d.costo_unitario, d.referencia_tipo ?? null, d.referencia_id ?? null, d.motivo_id ?? null, normalizarCampo('texto', d.notas)?.slice(0, 300) ?? null, actor.usuarioId, ahoraDe(ctx)]
  );
  return { id: r.insertId, saldo };
}

// ── Materiales ────────────────────────────────────────────────────────────────────────
export interface DatosMaterial {
  codigo?: string;
  nombre?: string;
  descripcion?: string | null;
  parte_id?: number;
  marca_id?: number | null;
  codigo_oem?: string | null;
  unidad_id?: number;
  existencia_minima?: number;
  ubicacion?: string | null;
  precio_manual?: number | null;
  proveedor_principal_id?: number | null;
  activo?: boolean;
}

const SELECT_MATERIAL = `m.id, m.codigo, m.nombre, m.descripcion, m.parte_id, m.marca_id, mr.nombre AS marca, m.codigo_oem, m.unidad_id, u.codigo AS unidad, m.existencia_minima, m.ubicacion,
  m.costo_ultimo, m.costo_promedio, m.precio_manual, m.proveedor_principal_id, pv.nombre AS proveedor_principal, m.activo,
  p.nombre AS parte, x.id AS subsistema_id, x.nombre AS subsistema, s.id AS sistema_id, s.nombre AS sistema, CONCAT(s.codigo, '-', x.codigo, '-', p.codigo) AS clasificacion,
  COALESCE((SELECT SUM(e.cantidad) FROM existencias e WHERE e.material_id = m.id), 0) AS existencia_total`;
const DE_MATERIAL = `FROM materiales m JOIN partes p ON p.id = m.parte_id JOIN subsistemas x ON x.id = p.subsistema_id JOIN sistemas s ON s.id = x.sistema_id JOIN unidades u ON u.id = m.unidad_id
  LEFT JOIN marcas mr ON mr.id = m.marca_id LEFT JOIN proveedores pv ON pv.id = m.proveedor_principal_id`;

type FilaMaterial = Record<string, unknown> & { id: number; parte_id: number; subsistema_id: number; sistema_id: number; costo_ultimo: number; costo_promedio: number; precio_manual: number | null; existencia_total: number; existencia_minima: number };

function presentar(m: FilaMaterial, margenes: Array<{ nivel: string; referencia_id: number; porcentaje: number }>, cfg: ConfigPrecios, vista: Vista) {
  const margen = margenDe(m.id, m, margenes, cfg.margenGeneral);
  const { costo_ultimo, costo_promedio, ...resto } = m;
  const salida: Record<string, unknown> = {
    ...resto,
    existencia_total: Number(m.existencia_total),
    bajo_minimo: Number(m.existencia_minima) > 0 && Number(m.existencia_total) < Number(m.existencia_minima),
    precio: precioDe({ costo_ultimo: Number(costo_ultimo), costo_promedio: Number(costo_promedio), precio_manual: m.precio_manual === null ? null : Number(m.precio_manual) }, margen.porcentaje, cfg.baseCosto),
  };
  if (vista.costos) Object.assign(salida, { costo_ultimo: Number(costo_ultimo), costo_promedio: Number(costo_promedio), margen: margen.porcentaje, margen_origen: margen.nivel });
  return salida;
}

export async function listarMateriales(t: TallerReq, vista: Vista, f: { buscar?: string; parte_id?: number; sistema_id?: number; bajo_minimo?: boolean; inactivos?: boolean; pagina: number; porPagina: number }) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (!f.inactivos) donde.push('m.activo = 1');
  if (f.parte_id) {
    donde.push('m.parte_id = ?');
    params.push(f.parte_id);
  }
  if (f.sistema_id) {
    donde.push('s.id = ?');
    params.push(f.sistema_id);
  }
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    donde.push('(m.codigo LIKE ? OR m.nombre LIKE ? OR m.codigo_oem LIKE ? OR mr.nombre LIKE ?)');
    params.push(patron, patron, patron, patron);
  }
  const having = f.bajo_minimo ? 'HAVING m.existencia_minima > 0 AND existencia_total < m.existencia_minima' : '';
  const where = donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : '';
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n FROM (SELECT ${SELECT_MATERIAL} ${DE_MATERIAL} ${where} ${having}) x`, params);
  const registros = await filas<FilaMaterial>(t.pool, `SELECT ${SELECT_MATERIAL} ${DE_MATERIAL} ${where} ${having} ORDER BY m.nombre, m.id LIMIT ? OFFSET ?`, [...params, f.porPagina, (f.pagina - 1) * f.porPagina]);
  const margenes = await filas<{ nivel: string; referencia_id: number; porcentaje: number }>(t.pool, 'SELECT nivel, referencia_id, porcentaje FROM margenes');
  const cfg = await configDeInventario(t);
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros: registros.map((m) => presentar(m, margenes, cfg, vista)) };
}

export async function obtenerMaterial(t: TallerReq, id: number, vista: Vista) {
  const m = await una<FilaMaterial>(t.pool, `SELECT ${SELECT_MATERIAL} ${DE_MATERIAL} WHERE m.id = ?`, [id]);
  if (!m) throw new ErrorNoEncontrado('No se encontró el material');
  const margenes = await filas<{ nivel: string; referencia_id: number; porcentaje: number }>(t.pool, 'SELECT nivel, referencia_id, porcentaje FROM margenes');
  const cfg = await configDeInventario(t);
  const porBodega = await filas<{ bodega_id: number; bodega: string; sucursal: string; cantidad: number }>(
    t.pool,
    `SELECT b.id AS bodega_id, b.nombre AS bodega, s.nombre AS sucursal, COALESCE(e.cantidad, 0) AS cantidad
       FROM bodegas b JOIN sucursales s ON s.id = b.sucursal_id LEFT JOIN existencias e ON e.bodega_id = b.id AND e.material_id = ? WHERE b.activo = 1 ORDER BY s.nombre, b.nombre`,
    [id]
  );
  return { ...presentar(m, margenes, cfg, vista), por_bodega: porBodega.map((b) => ({ ...b, cantidad: Number(b.cantidad) })) };
}

async function revisarMaterial(con: Ejecutor, d: DatosMaterial): Promise<void> {
  if (d.parte_id !== undefined && !(await una(con, 'SELECT id FROM partes WHERE id = ? AND activo = 1', [d.parte_id]))) throw new ErrorValidacion('Elija la clasificación (sistema, subsistema y parte) del material: es obligatoria');
  if (d.unidad_id !== undefined) {
    const u = await una<{ uso: string; activo: number }>(con, 'SELECT uso, activo FROM unidades WHERE id = ?', [d.unidad_id]);
    if (!u || u.activo !== 1 || u.uso === 'contador') throw new ErrorValidacion('La unidad elegida no existe o no es de inventario');
  }
  if (d.marca_id && !(await una(con, 'SELECT id FROM marcas WHERE id = ? AND activo = 1', [d.marca_id]))) throw new ErrorValidacion('La marca elegida no existe o está desactivada');
  if (d.proveedor_principal_id && !(await una(con, 'SELECT id FROM proveedores WHERE id = ? AND activo = 1', [d.proveedor_principal_id]))) throw new ErrorValidacion('El proveedor elegido no existe o está desactivado');
  if (d.existencia_minima !== undefined && (!Number.isInteger(d.existencia_minima) || d.existencia_minima < 0 || d.existencia_minima > 10_000_000)) throw new ErrorValidacion('La existencia mínima debe ser un número entero');
  if (d.precio_manual != null && (d.precio_manual < 0 || d.precio_manual > 99_999_999)) throw new ErrorValidacion('El precio no es válido');
}

export async function crearMaterial(t: TallerReq, actor: Actor, vista: Vista, d: DatosMaterial & { codigo: string; nombre: string; parte_id: number; unidad_id: number }) {
  const codigo = normalizarCampo('codigo', d.codigo);
  const nombre = normalizarCampo('texto', d.nombre);
  if (!codigo || !/^[A-Z0-9][A-Z0-9._/-]{0,29}$/.test(codigo)) throw new ErrorValidacion('El código lleva letras, números y . _ / - (hasta 30), sin espacios');
  if (!nombre) throw new ErrorValidacion('Escriba el nombre del material');
  const id = await transaccion(t.pool, async (con) => {
    await revisarMaterial(con, d);
    try {
      const r = await ejecutar(
        con,
        'INSERT INTO materiales (codigo, nombre, descripcion, parte_id, marca_id, codigo_oem, unidad_id, existencia_minima, ubicacion, precio_manual, proveedor_principal_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [codigo, nombre.slice(0, 200), normalizarCampo('texto', d.descripcion)?.slice(0, 500) ?? null, d.parte_id, d.marca_id ?? null, normalizarCampo('codigo', d.codigo_oem), d.unidad_id, d.existencia_minima ?? 0, normalizarCampo('texto', d.ubicacion), d.precio_manual ?? null, d.proveedor_principal_id ?? null]
      );
      await bitacora(con, actor, { accion: 'material_creado', entidad: 'materiales', entidadId: r.insertId, despues: { codigo, nombre } });
      return r.insertId;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErrorApp(409, 'CONFLICTO', 'Ya existe un material con ese código');
      throw error;
    }
  });
  return obtenerMaterial(t, id, vista);
}

export async function actualizarMaterial(t: TallerReq, actor: Actor, vista: Vista, id: number, d: DatosMaterial) {
  await transaccion(t.pool, async (con) => {
    const m = await una<{ id: number }>(con, 'SELECT id FROM materiales WHERE id = ? FOR UPDATE', [id]);
    if (!m) throw new ErrorNoEncontrado('No se encontró el material');
    if (d.codigo !== undefined) throw new ErrorApp(409, 'REGLA', 'El código de un material no se cambia.');
    if (d.unidad_id !== undefined) {
      const mov = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM movimientos_inventario WHERE material_id = ?', [id]);
      const actual = await una<{ unidad_id: number }>(con, 'SELECT unidad_id FROM materiales WHERE id = ?', [id]);
      if (Number(mov?.n) > 0 && actual?.unidad_id !== d.unidad_id) throw new ErrorApp(409, 'REGLA', 'El material ya tiene movimientos: su unidad no se cambia (cambiaría lo que significa cada cantidad).');
    }
    await revisarMaterial(con, d);
    const sets: string[] = [];
    const v: unknown[] = [];
    const poner = (col: string, valor: unknown): void => {
      sets.push(`${col} = ?`);
      v.push(valor ?? null);
    };
    if (d.nombre !== undefined) {
      const n = normalizarCampo('texto', d.nombre);
      if (!n) throw new ErrorValidacion('Escriba el nombre del material');
      poner('nombre', n.slice(0, 200));
    }
    if (d.descripcion !== undefined) poner('descripcion', normalizarCampo('texto', d.descripcion)?.slice(0, 500));
    if (d.parte_id !== undefined) poner('parte_id', d.parte_id);
    if (d.marca_id !== undefined) poner('marca_id', d.marca_id);
    if (d.codigo_oem !== undefined) poner('codigo_oem', normalizarCampo('codigo', d.codigo_oem));
    if (d.unidad_id !== undefined) poner('unidad_id', d.unidad_id);
    if (d.existencia_minima !== undefined) poner('existencia_minima', d.existencia_minima);
    if (d.ubicacion !== undefined) poner('ubicacion', normalizarCampo('texto', d.ubicacion));
    if (d.precio_manual !== undefined) poner('precio_manual', d.precio_manual);
    if (d.proveedor_principal_id !== undefined) poner('proveedor_principal_id', d.proveedor_principal_id);
    if (d.activo !== undefined) poner('activo', d.activo ? 1 : 0);
    if (sets.length > 0) await ejecutar(con, `UPDATE materiales SET ${sets.join(', ')} WHERE id = ?`, [...v, id]);
    await bitacora(con, actor, { accion: 'material_editado', entidad: 'materiales', entidadId: id, despues: d });
  });
  return obtenerMaterial(t, id, vista);
}

// ── Compras ───────────────────────────────────────────────────────────────────────────
export interface DatosCompra {
  proveedor_id: number;
  bodega_id: number;
  fecha_documento: string;
  numero_factura?: string | null;
  notas?: string | null;
  lineas: Array<{ material_id: number; cantidad: number; costo_unitario: number }>;
}

/** Recibe una compra: crea el documento, sube las existencias de la bodega y actualiza el costo último y el promedio ponderado, todo en una sola transacción. */
export async function registrarCompra(ctx: Contexto, t: TallerReq, actor: Actor, d: DatosCompra) {
  const hoy = hoyDelTaller(ctx, t);
  validarFechaRazonable(d.fecha_documento, 'fecha_documento', { noFutura: true, hoy });
  if (d.lineas.length === 0 || d.lineas.length > 200) throw new ErrorValidacion('La compra necesita entre 1 y 200 líneas');
  const factura = normalizarCampo('codigo', d.numero_factura);
  const id = await transaccion(t.pool, async (con) => {
    const pv = await una<{ activo: number }>(con, 'SELECT activo FROM proveedores WHERE id = ?', [d.proveedor_id]);
    if (!pv || pv.activo !== 1) throw new ErrorValidacion('El proveedor elegido no existe o está desactivado');
    const b = await una<{ activo: number }>(con, 'SELECT activo FROM bodegas WHERE id = ?', [d.bodega_id]);
    if (!b || b.activo !== 1) throw new ErrorValidacion('La bodega elegida no existe o está desactivada');
    const numero = `COM-${String(await siguienteNumero(con, 'COM')).padStart(6, '0')}`;
    let compraId: number;
    try {
      const r = await ejecutar(con, 'INSERT INTO compras (numero, proveedor_id, bodega_id, fecha_documento, numero_factura, notas, creada_por_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [numero, d.proveedor_id, d.bodega_id, d.fecha_documento, factura, normalizarCampo('texto', d.notas)?.slice(0, 300) ?? null, actor.usuarioId]);
      compraId = r.insertId;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErrorApp(409, 'FACTURA_REPETIDA', 'Esa factura ya está registrada para ese proveedor.');
      throw error;
    }
    let total = 0;
    // Se procesan en orden de material para que dos compras a la vez bloqueen las filas en el mismo orden.
    for (const l of [...d.lineas].sort((x, y) => x.material_id - y.material_id)) {
      if (!Number.isInteger(l.cantidad) || l.cantidad <= 0) throw new ErrorValidacion('Las cantidades de la compra deben ser números enteros mayores que cero');
      if (!(l.costo_unitario >= 0) || l.costo_unitario > 99_999_999) throw new ErrorValidacion('El costo de una línea no es válido');
      const m = await una<{ activo: number; codigo: string; costo_promedio: number }>(con, 'SELECT activo, codigo, costo_promedio FROM materiales WHERE id = ? FOR UPDATE', [l.material_id]);
      if (!m || m.activo !== 1) throw new ErrorValidacion('Alguno de los materiales no existe o está desactivado');
      const antes = await una<{ n: number }>(con, 'SELECT COALESCE(SUM(cantidad), 0) AS n FROM existencias WHERE material_id = ?', [l.material_id]);
      const existente = Number(antes?.n ?? 0);
      // Costo promedio ponderado por lo que ya hay en todas las bodegas (si no había nada, el promedio es el costo de esta compra).
      const promedio = existente > 0 ? (existente * Number(m.costo_promedio) + l.cantidad * l.costo_unitario) / (existente + l.cantidad) : l.costo_unitario;
      await ejecutar(con, 'UPDATE materiales SET costo_ultimo = ?, costo_promedio = ? WHERE id = ?', [r2(l.costo_unitario), r2(promedio), l.material_id]);
      await ejecutar(con, 'INSERT INTO compra_lineas (compra_id, material_id, cantidad, costo_unitario) VALUES (?, ?, ?, ?)', [compraId, l.material_id, l.cantidad, r2(l.costo_unitario)]);
      await aplicarMovimiento(ctx, con, actor, { material_id: l.material_id, bodega_id: d.bodega_id, tipo: 'compra', cantidad: l.cantidad, costo_unitario: r2(l.costo_unitario), referencia_tipo: 'compra', referencia_id: compraId });
      total += l.cantidad * l.costo_unitario;
    }
    await ejecutar(con, 'UPDATE compras SET total = ? WHERE id = ?', [r2(total), compraId]);
    await bitacora(con, actor, { accion: 'compra_registrada', entidad: 'compras', entidadId: compraId, despues: { numero, lineas: d.lineas.length, total: r2(total) } });
    return compraId;
  });
  return obtenerCompra(t, id);
}

export async function obtenerCompra(t: TallerReq, id: number) {
  const c = await una<Record<string, unknown>>(
    t.pool,
    `SELECT c.id, c.numero, c.proveedor_id, p.nombre AS proveedor, c.bodega_id, b.nombre AS bodega, DATE_FORMAT(c.fecha_documento, '%Y-%m-%d') AS fecha_documento, c.numero_factura, c.total, c.notas, c.created_at,
            co.nombre_completo AS registrada_por
       FROM compras c JOIN proveedores p ON p.id = c.proveedor_id JOIN bodegas b ON b.id = c.bodega_id LEFT JOIN usuarios u ON u.id = c.creada_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE c.id = ?`,
    [id]
  );
  if (!c) throw new ErrorNoEncontrado('No se encontró la compra');
  const lineas = await filas<Record<string, unknown>>(t.pool, 'SELECT l.id, l.material_id, m.codigo, m.nombre, l.cantidad, l.costo_unitario, (l.cantidad * l.costo_unitario) AS subtotal FROM compra_lineas l JOIN materiales m ON m.id = l.material_id WHERE l.compra_id = ? ORDER BY l.id', [id]);
  return { ...c, total: Number(c['total']), lineas: lineas.map((l) => ({ ...l, costo_unitario: Number(l['costo_unitario']), subtotal: Number(l['subtotal']) })) };
}

export async function listarCompras(t: TallerReq, f: { buscar?: string; proveedor_id?: number; pagina: number; porPagina: number }) {
  const donde: string[] = ['1 = 1'];
  const params: unknown[] = [];
  if (f.proveedor_id) {
    donde.push('c.proveedor_id = ?');
    params.push(f.proveedor_id);
  }
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (x) => `\\${x}`)}%`;
    donde.push('(c.numero LIKE ? OR c.numero_factura LIKE ? OR p.nombre LIKE ?)');
    params.push(patron, patron, patron);
  }
  const de = `FROM compras c JOIN proveedores p ON p.id = c.proveedor_id JOIN bodegas b ON b.id = c.bodega_id WHERE ${donde.join(' AND ')}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${de}`, params);
  const registros = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT c.id, c.numero, p.nombre AS proveedor, b.nombre AS bodega, DATE_FORMAT(c.fecha_documento, '%Y-%m-%d') AS fecha_documento, c.numero_factura, c.total, (SELECT COUNT(*) FROM compra_lineas l WHERE l.compra_id = c.id) AS lineas
       ${de} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros: registros.map((r) => ({ ...r, total: Number(r['total']) })) };
}

// ── Traslados y diferencias ───────────────────────────────────────────────────────────
export async function trasladar(ctx: Contexto, t: TallerReq, actor: Actor, d: { material_id: number; bodega_origen_id: number; bodega_destino_id: number; cantidad: number; notas?: string | null }) {
  if (d.bodega_origen_id === d.bodega_destino_id) throw new ErrorValidacion('La bodega de origen y la de destino son la misma');
  if (!Number.isInteger(d.cantidad) || d.cantidad <= 0) throw new ErrorValidacion('La cantidad debe ser un número entero mayor que cero');
  await transaccion(t.pool, async (con) => {
    const m = await una<{ activo: number; costo_promedio: number }>(con, 'SELECT activo, costo_promedio FROM materiales WHERE id = ?', [d.material_id]);
    if (!m || m.activo !== 1) throw new ErrorValidacion('El material elegido no existe o está desactivado');
    for (const b of [d.bodega_origen_id, d.bodega_destino_id]) {
      const f = await una<{ activo: number }>(con, 'SELECT activo FROM bodegas WHERE id = ?', [b]);
      if (!f || f.activo !== 1) throw new ErrorValidacion('Una de las bodegas no existe o está desactivada');
    }
    const costo = Number(m.costo_promedio);
    // Se bloquea siempre en el mismo orden de bodega para que dos traslados cruzados no se atoren.
    const salida = await aplicarMovimiento(ctx, con, actor, { material_id: d.material_id, bodega_id: d.bodega_origen_id, tipo: 'traslado_salida', cantidad: -d.cantidad, costo_unitario: costo, notas: d.notas });
    await aplicarMovimiento(ctx, con, actor, { material_id: d.material_id, bodega_id: d.bodega_destino_id, tipo: 'traslado_entrada', cantidad: d.cantidad, costo_unitario: costo, referencia_tipo: 'traslado', referencia_id: salida.id, notas: d.notas });
    await bitacora(con, actor, { accion: 'inventario_traslado', entidad: 'materiales', entidadId: d.material_id, despues: d });
  });
}

/** La única forma de corregir una cantidad: se escribe lo REAL, el sistema calcula la diferencia y queda registrada con su motivo. */
export async function registrarDiferencia(ctx: Contexto, t: TallerReq, actor: Actor, d: { material_id: number; bodega_id: number; cantidad_real: number; motivo_id: number; notas?: string | null }) {
  if (!Number.isInteger(d.cantidad_real) || d.cantidad_real < 0 || d.cantidad_real > 100_000_000) throw new ErrorValidacion('La cantidad real debe ser un número entero, cero o mayor');
  return transaccion(t.pool, async (con) => {
    const m = await una<{ activo: number; costo_promedio: number }>(con, 'SELECT activo, costo_promedio FROM materiales WHERE id = ?', [d.material_id]);
    if (!m || m.activo !== 1) throw new ErrorValidacion('El material elegido no existe o está desactivado');
    const b = await una<{ activo: number }>(con, 'SELECT activo FROM bodegas WHERE id = ?', [d.bodega_id]);
    if (!b || b.activo !== 1) throw new ErrorValidacion('La bodega elegida no existe o está desactivada');
    const mo = await una<{ nombre: string; activo: number }>(con, "SELECT nombre, activo FROM motivos WHERE id = ? AND tipo = 'diferencia_inventario'", [d.motivo_id]);
    if (!mo || mo.activo !== 1) throw new ErrorValidacion('Elija el motivo de la diferencia de la lista');
    await ejecutar(con, 'INSERT IGNORE INTO existencias (material_id, bodega_id, cantidad) VALUES (?, ?, 0)', [d.material_id, d.bodega_id]);
    const e = await una<{ cantidad: number }>(con, 'SELECT cantidad FROM existencias WHERE material_id = ? AND bodega_id = ? FOR UPDATE', [d.material_id, d.bodega_id]);
    const delSistema = Number(e?.cantidad ?? 0);
    const diferencia = d.cantidad_real - delSistema;
    if (diferencia === 0) throw new ErrorApp(409, 'SIN_DIFERENCIA', 'Lo que usted cuenta es igual a lo que dice el sistema: no hay nada que corregir.');
    const costo = Number(m.costo_promedio);
    await aplicarMovimiento(ctx, con, actor, { material_id: d.material_id, bodega_id: d.bodega_id, tipo: 'diferencia', cantidad: diferencia, costo_unitario: costo, motivo_id: d.motivo_id, notas: d.notas });
    await bitacora(con, actor, { accion: 'inventario_diferencia', entidad: 'materiales', entidadId: d.material_id, motivo: mo.nombre, antes: { sistema: delSistema }, despues: { real: d.cantidad_real, diferencia, valor: r2(diferencia * costo) } });
    return { antes: delSistema, despues: d.cantidad_real, diferencia, valor: r2(diferencia * costo) };
  });
}

// ── Consultas del libro ───────────────────────────────────────────────────────────────
export async function listarMovimientos(t: TallerReq, vista: Vista, f: { material_id?: number; bodega_id?: number; tipo?: string; pagina: number; porPagina: number }) {
  const donde: string[] = ['1 = 1'];
  const params: unknown[] = [];
  for (const [col, v] of [['mv.material_id', f.material_id], ['mv.bodega_id', f.bodega_id]] as const) {
    if (v) {
      donde.push(`${col} = ?`);
      params.push(v);
    }
  }
  if (f.tipo) {
    donde.push('mv.tipo = ?');
    params.push(f.tipo);
  }
  const de = `FROM movimientos_inventario mv JOIN materiales m ON m.id = mv.material_id JOIN bodegas b ON b.id = mv.bodega_id LEFT JOIN motivos mo ON mo.id = mv.motivo_id
    LEFT JOIN usuarios u ON u.id = mv.usuario_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE ${donde.join(' AND ')}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${de}`, params);
  const registros = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT mv.id, mv.material_id, m.codigo, m.nombre AS material, mv.bodega_id, b.nombre AS bodega, UPPER(REPLACE(mv.tipo, '_', ' ')) AS tipo, mv.cantidad, mv.saldo_resultante, mv.costo_unitario,
            mv.referencia_tipo, mv.referencia_id, mo.nombre AS motivo, mv.notas, co.nombre_completo AS usuario, mv.fecha ${de} ORDER BY mv.id DESC LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return {
    total: Number(total?.n ?? 0),
    pagina: f.pagina,
    porPagina: f.porPagina,
    registros: registros.map((r) => {
      const { costo_unitario, ...resto } = r;
      return vista.costos ? { ...resto, costo_unitario: Number(costo_unitario) } : resto;
    }),
  };
}

export async function opcionesDeInventario(t: TallerReq) {
  const [bodegas, unidades, partes, motivos, proveedores, sistemas, subsistemas] = await Promise.all([
    filas<{ id: number; nombre: string; sucursal: string }>(t.pool, 'SELECT b.id, b.nombre, s.nombre AS sucursal FROM bodegas b JOIN sucursales s ON s.id = b.sucursal_id WHERE b.activo = 1 ORDER BY s.nombre, b.nombre'),
    filas<{ id: number; codigo: string; nombre: string }>(t.pool, "SELECT id, codigo, nombre FROM unidades WHERE activo = 1 AND uso <> 'contador' ORDER BY nombre"),
    filas<{ id: number; nombre: string; clasificacion: string }>(
      t.pool,
      `SELECT p.id, p.nombre, CONCAT(s.codigo, '-', x.codigo, '-', p.codigo, ' ', s.nombre, ' › ', x.nombre) AS clasificacion
         FROM partes p JOIN subsistemas x ON x.id = p.subsistema_id JOIN sistemas s ON s.id = x.sistema_id WHERE p.activo = 1 AND x.activo = 1 AND s.activo = 1 AND s.es_servicios_programados = 0 ORDER BY s.codigo, x.codigo, p.codigo`
    ),
    filas<{ id: number; nombre: string }>(t.pool, "SELECT id, nombre FROM motivos WHERE tipo = 'diferencia_inventario' AND activo = 1 ORDER BY nombre"),
    filas<{ id: number; nombre: string }>(t.pool, 'SELECT id, nombre FROM proveedores WHERE activo = 1 ORDER BY nombre'),
    filas<{ id: number; nombre: string }>(t.pool, "SELECT id, CONCAT(codigo, ' ', nombre) AS nombre FROM sistemas WHERE activo = 1 AND es_servicios_programados = 0 ORDER BY codigo"),
    filas<{ id: number; sistema_id: number; nombre: string }>(t.pool, "SELECT x.id, x.sistema_id, CONCAT(s.codigo, '-', x.codigo, ' ', x.nombre) AS nombre FROM subsistemas x JOIN sistemas s ON s.id = x.sistema_id WHERE x.activo = 1 AND s.activo = 1 AND s.es_servicios_programados = 0 ORDER BY s.codigo, x.codigo"),
  ]);
  return { bodegas, unidades, partes, motivos_diferencia: motivos, proveedores, sistemas, subsistemas };
}
