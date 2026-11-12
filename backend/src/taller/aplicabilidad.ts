import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, TallerReq } from './comun';

/**
 * A qué equipos les sirve cada material (Fase 5c). Se aprende solo: cada vez que se despacha un material a la orden de un equipo
 * queda anotado el tipo, la marca y el modelo de ese equipo. También se puede capturar a mano (por tipo, marca y modelo; no equipo
 * por equipo, para que un equipo nuevo herede de inmediato lo que ya se sabe de su modelo). Sirve para sugerir materiales al pedirlos.
 */

/** Anota (o refuerza) que el material se usó en un equipo de ese tipo, marca y modelo. */
export async function registrarUsoEnEquipo(con: Ejecutor, materialId: number, equipoId: number, ahora: Date): Promise<void> {
  const e = await una<{ tipo_equipo_id: number; marca_id: number | null; modelo: string | null }>(con, 'SELECT tipo_equipo_id, marca_id, modelo FROM equipos WHERE id = ?', [equipoId]);
  if (!e) return;
  await ejecutar(
    con,
    `INSERT INTO material_aplica_a (material_id, tipo_equipo_id, marca_id, modelo, origen, veces, ultima_vez) VALUES (?, ?, ?, ?, 'consumo', 1, ?)
     ON DUPLICATE KEY UPDATE veces = veces + 1, ultima_vez = VALUES(ultima_vez)`,
    [materialId, e.tipo_equipo_id, e.marca_id, e.modelo ? e.modelo.slice(0, 60) : null, ahora]
  );
}

export async function listarAplicabilidad(t: TallerReq, materialId: number) {
  return filas<Record<string, unknown>>(
    t.pool,
    `SELECT a.id, a.tipo_equipo_id, te.nombre AS tipo_equipo, a.marca_id, mr.nombre AS marca, a.modelo, a.origen, a.veces, a.ultima_vez
       FROM material_aplica_a a JOIN tipos_equipo te ON te.id = a.tipo_equipo_id LEFT JOIN marcas mr ON mr.id = a.marca_id
      WHERE a.material_id = ? ORDER BY a.veces DESC, te.nombre, mr.nombre, a.modelo`,
    [materialId]
  );
}

export async function agregarAplicabilidad(t: TallerReq, actor: Actor, materialId: number, d: { tipo_equipo_id: number; marca_id?: number | null; modelo?: string | null }) {
  const modelo = normalizarCampo('texto', d.modelo)?.slice(0, 60) ?? null;
  if (d.marca_id == null && modelo) throw new ErrorValidacion('Para indicar un modelo, elija también la marca');
  return transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM materiales WHERE id = ?', [materialId]))) throw new ErrorNoEncontrado('No se encontró el material');
    if (!(await una(con, 'SELECT id FROM tipos_equipo WHERE id = ? AND activo = 1', [d.tipo_equipo_id]))) throw new ErrorValidacion('El tipo de equipo elegido no existe o está desactivado');
    if (d.marca_id && !(await una(con, 'SELECT id FROM marcas WHERE id = ? AND activo = 1', [d.marca_id]))) throw new ErrorValidacion('La marca elegida no existe o está desactivada');
    try {
      const r = await ejecutar(con, "INSERT INTO material_aplica_a (material_id, tipo_equipo_id, marca_id, modelo, origen) VALUES (?, ?, ?, ?, 'manual')", [materialId, d.tipo_equipo_id, d.marca_id ?? null, modelo]);
      await bitacora(con, actor, { accion: 'material_aplica_agregado', entidad: 'materiales', entidadId: materialId, despues: { ...d, modelo } });
      return r.insertId;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErrorApp(409, 'REPETIDO', 'Ese tipo, marca y modelo ya están en la lista de este material.');
      throw error;
    }
  });
}

export async function quitarAplicabilidad(t: TallerReq, actor: Actor, id: number) {
  await transaccion(t.pool, async (con) => {
    const a = await una<{ material_id: number }>(con, 'SELECT material_id FROM material_aplica_a WHERE id = ?', [id]);
    if (!a) throw new ErrorNoEncontrado('No se encontró esa línea');
    await ejecutar(con, 'DELETE FROM material_aplica_a WHERE id = ?', [id]);
    await bitacora(con, actor, { accion: 'material_aplica_quitado', entidad: 'materiales', entidadId: a.material_id, despues: { id } });
  });
}

/** Materiales que le sirven al equipo de una orden (por su tipo, marca y modelo), los más usados primero, con lo que hay en existencia. */
export async function materialesSugeridos(t: TallerReq, ordenId: number) {
  const e = await una<{ tipo_equipo_id: number; marca_id: number | null; modelo: string | null }>(t.pool, 'SELECT e.tipo_equipo_id, e.marca_id, e.modelo FROM ordenes o JOIN equipos e ON e.id = o.equipo_id WHERE o.id = ?', [ordenId]);
  if (!e) throw new ErrorNoEncontrado('No se encontró la orden');
  const r = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT m.id, m.codigo, m.nombre, u.codigo AS unidad, MAX(a.veces) AS veces, MAX(a.origen = 'manual') AS manual,
            COALESCE((SELECT SUM(x.cantidad) FROM existencias x WHERE x.material_id = m.id), 0) AS existencia_total
       FROM material_aplica_a a JOIN materiales m ON m.id = a.material_id JOIN unidades u ON u.id = m.unidad_id
      WHERE m.activo = 1 AND a.tipo_equipo_id = ? AND (a.marca_id IS NULL OR a.marca_id <=> ?) AND (a.modelo IS NULL OR a.modelo <=> ?)
      GROUP BY m.id, m.codigo, m.nombre, u.codigo ORDER BY MAX(a.veces) DESC, m.nombre LIMIT 20`,
    [e.tipo_equipo_id, e.marca_id, e.modelo ? e.modelo.slice(0, 60) : null]
  );
  return r.map((x) => ({ ...x, veces: Number(x['veces']), manual: Number(x['manual']) === 1, existencia_total: Number(x['existencia_total']) }));
}
