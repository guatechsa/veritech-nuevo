import { z, ZodType } from 'zod';
import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado } from '../errores';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, conflictoSiDuplicado, TallerReq } from './comun';

/**
 * Catálogos sencillos (áreas, puestos, tipos de credencial, niveles de técnico…): una tabla con unas cuantas columnas.
 * Texto en MAYÚSCULAS sin tildes (§5) también en el servidor, nombres únicos con mensaje claro, y todo cambio queda en la bitácora.
 * Eliminar = desactivar cuando hay historia: aquí solo se desactiva.
 */
export interface Campo {
  col: string;
  tipo: 'texto' | 'codigo' | 'bool' | 'entero';
  requerido?: boolean;
  max?: number;
  min?: number;
  /** Valor cuando no se manda (solo campos no requeridos). */
  defecto?: string | number | boolean | null;
}

export interface DefCatalogo {
  tabla: string;
  /** Cómo se nombra en los mensajes: "el área de trabajo". */
  nombre: string;
  campos: Campo[];
  /** Columna única que, si choca, da el 409. */
  unica: string;
  ordenar: string;
  conActivo: boolean;
}

function zodDe(c: Campo, parcial: boolean): ZodType {
  let z0: ZodType;
  switch (c.tipo) {
    case 'texto':
      z0 = z.string().trim().min(1).max(c.max ?? 100);
      break;
    case 'codigo':
      z0 = z.string().trim().min(1).max(c.max ?? 20);
      break;
    case 'bool':
      z0 = z.boolean();
      break;
    case 'entero':
      z0 = z.number().int().min(c.min ?? 0).max(c.max ?? 1_000_000);
      break;
  }
  return parcial || !c.requerido ? z0.optional() : z0;
}

export function esquemaCatalogo(def: DefCatalogo, parcial: boolean): ZodType {
  const forma: Record<string, ZodType> = {};
  for (const c of def.campos) forma[c.col] = zodDe(c, parcial);
  if (def.conActivo && parcial) forma['activo'] = z.boolean().optional();
  return z.object(forma);
}

function valorBd(c: Campo, v: unknown): unknown {
  if (v === undefined) return undefined;
  switch (c.tipo) {
    case 'texto':
      return normalizarCampo('texto', String(v));
    case 'codigo':
      return normalizarCampo('codigo', String(v));
    case 'bool':
      return v ? 1 : 0;
    case 'entero':
      return v;
  }
}

export function crearCatalogo(def: DefCatalogo) {
  const columnas = ['id', ...def.campos.map((c) => c.col), ...(def.conActivo ? ['activo'] : [])].join(', ');

  async function obtener(t: TallerReq, id: number) {
    const f = await una(t.pool, `SELECT ${columnas} FROM ${def.tabla} WHERE id = ?`, [id]);
    if (!f) throw new ErrorNoEncontrado(`No se encontró ${def.nombre}`);
    return f;
  }

  return {
    obtener,
    async listar(t: TallerReq, incluirInactivos: boolean) {
      return filas(t.pool, `SELECT ${columnas} FROM ${def.tabla} ${def.conActivo && !incluirInactivos ? 'WHERE activo = 1' : ''} ORDER BY ${def.ordenar}`);
    },
    async crear(t: TallerReq, actor: Actor, datos: Record<string, unknown>) {
      const cols: string[] = [];
      const valores: unknown[] = [];
      for (const c of def.campos) {
        const v = datos[c.col] === undefined ? c.defecto : datos[c.col];
        if (v === undefined || v === null) {
          if (c.requerido) throw new ErrorApp(400, 'VALIDACION', `El dato «${c.col}» falta`);
          continue;
        }
        cols.push(c.col);
        valores.push(valorBd(c, v));
      }
      try {
        const id = await transaccion(t.pool, async (con) => {
          const r = await ejecutar(con, `INSERT INTO ${def.tabla} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, valores);
          await bitacora(con, actor, { accion: `${def.tabla}_creado`, entidad: def.tabla, entidadId: r.insertId, despues: datos });
          return r.insertId;
        });
        return await obtener(t, id);
      } catch (error) {
        return conflictoSiDuplicado(error, `Ya existe ${def.nombre} con ese ${def.unica}`);
      }
    },
    async actualizar(t: TallerReq, actor: Actor, id: number, cambios: Record<string, unknown>) {
      const antes = await obtener(t, id);
      const sets: string[] = [];
      const valores: unknown[] = [];
      for (const c of def.campos) {
        if (cambios[c.col] === undefined) continue;
        sets.push(`${c.col} = ?`);
        valores.push(valorBd(c, cambios[c.col]));
      }
      if (def.conActivo && cambios['activo'] !== undefined) {
        sets.push('activo = ?');
        valores.push(cambios['activo'] ? 1 : 0);
      }
      if (sets.length === 0) return antes;
      try {
        await transaccion(t.pool, async (con) => {
          await ejecutar(con, `UPDATE ${def.tabla} SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
          await bitacora(con, actor, { accion: `${def.tabla}_editado`, entidad: def.tabla, entidadId: id, antes, despues: cambios });
        });
      } catch (error) {
        conflictoSiDuplicado(error, `Ya existe ${def.nombre} con ese ${def.unica}`);
      }
      return obtener(t, id);
    },
  };
}

export const AREAS: DefCatalogo = {
  tabla: 'areas_trabajo',
  nombre: 'un área de trabajo',
  campos: [{ col: 'nombre', tipo: 'texto', requerido: true }],
  unica: 'nombre',
  ordenar: 'nombre',
  conActivo: true,
};

export const TIPOS_CREDENCIAL: DefCatalogo = {
  tabla: 'tipos_credencial',
  nombre: 'una credencial',
  campos: [
    { col: 'nombre', tipo: 'texto', requerido: true },
    { col: 'requiere_vencimiento', tipo: 'bool', defecto: false },
    { col: 'dias_aviso', tipo: 'entero', min: 0, max: 365, defecto: 30 },
  ],
  unica: 'nombre',
  ordenar: 'nombre',
  conActivo: true,
};

export const NIVELES_TECNICO: DefCatalogo = {
  tabla: 'niveles_tecnico',
  nombre: 'un nivel de técnico',
  campos: [
    { col: 'codigo', tipo: 'codigo', requerido: true, max: 20 },
    { col: 'nombre', tipo: 'texto', requerido: true, max: 60 },
    { col: 'orden', tipo: 'entero', min: 0, max: 100, defecto: 0 },
  ],
  unica: 'código',
  ordenar: 'orden, id',
  conActivo: false,
};

export async function eliminarNivel(t: TallerReq, actor: Actor, id: number): Promise<void> {
  const nivel = await una(t.pool, 'SELECT id, codigo, nombre FROM niveles_tecnico WHERE id = ?', [id]);
  if (!nivel) throw new ErrorNoEncontrado('No se encontró el nivel');
  const uso = await una<{ n: number }>(t.pool, 'SELECT COUNT(*) AS n FROM colaboradores WHERE nivel_tecnico_id = ?', [id]);
  if (Number(uso?.n) > 0) throw new ErrorApp(409, 'EN_USO', 'No se puede eliminar un nivel que tienen colaboradores. Cámbieles el nivel primero.');
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'DELETE FROM niveles_tecnico WHERE id = ?', [id]);
    await bitacora(con, actor, { accion: 'niveles_tecnico_eliminado', entidad: 'niveles_tecnico', entidadId: id, antes: nivel });
  });
}
