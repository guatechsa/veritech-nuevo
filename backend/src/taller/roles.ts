import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { normalizarCampo, sinTildes } from '../utils/texto';
import { Actor, bitacora, conflictoSiDuplicado, TallerReq } from './comun';

export async function listarRoles(t: TallerReq) {
  return filas(
    t.pool,
    `SELECT r.id, r.codigo, r.nombre, r.descripcion, r.es_sistema, r.activo,
            (SELECT COUNT(*) FROM usuario_roles ur JOIN usuarios u ON u.id = ur.usuario_id AND u.activo = 1 WHERE ur.rol_id = r.id) AS usuarios,
            (SELECT COUNT(*) FROM rol_permisos rp WHERE rp.rol_id = r.id) AS permisos
       FROM roles r ORDER BY r.es_sistema DESC, r.id`
  );
}

export async function obtenerRol(t: TallerReq, id: number) {
  const r = await una<{ id: number; codigo: string; nombre: string; descripcion: string | null; es_sistema: number; activo: number }>(t.pool, 'SELECT id, codigo, nombre, descripcion, es_sistema, activo FROM roles WHERE id = ?', [id]);
  if (!r) throw new ErrorNoEncontrado('No se encontró el rol');
  const permisos = await filas<{ permiso_codigo: string }>(t.pool, 'SELECT permiso_codigo FROM rol_permisos WHERE rol_id = ? ORDER BY permiso_codigo', [id]);
  return { ...r, permisos: permisos.map((p) => p.permiso_codigo) };
}

/** El catálogo completo de permisos, agrupado por módulo, indicando cuáles están disponibles según el plan del taller. */
export async function listarPermisos(t: TallerReq) {
  const permisos = await filas<{ codigo: string; modulo: string; descripcion: string }>(t.pool, 'SELECT codigo, modulo, descripcion FROM permisos ORDER BY modulo, codigo');
  return permisos.map((p) => ({ ...p, disponible: p.modulo === 'base' || t.empresa.modulos.has(p.modulo) }));
}

async function validarPermisos(con: Ejecutor, permisos: string[], actorPermisos: Set<string>): Promise<void> {
  const unicos = [...new Set(permisos)];
  if (unicos.length > 0) {
    const validos = await filas<{ codigo: string }>(con, `SELECT codigo FROM permisos WHERE codigo IN (${unicos.map(() => '?').join(',')})`, unicos);
    if (validos.length !== unicos.length) throw new ErrorValidacion('Hay permisos que no existen');
  }
  // Nadie puede dar un permiso que no tiene: sin esto, quien edita roles podría escalarse.
  const noPuede = unicos.filter((p) => !actorPermisos.has(p));
  if (noPuede.length > 0) throw new ErrorApp(403, 'SIN_PERMISO', 'No puede otorgar permisos que usted mismo no tiene.');
}

function codigoDe(nombre: string): string {
  return sinTildes(nombre).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30);
}

export async function crearRol(t: TallerReq, actor: Actor, actorPermisos: Set<string>, d: { nombre: string; descripcion?: string | null; permisos?: string[]; copiar_de?: number }) {
  const nombre = normalizarCampo('texto', d.nombre) ?? '';
  const codigo = codigoDe(nombre);
  if (!codigo) throw new ErrorValidacion('El nombre del rol no es válido');
  try {
    const id = await transaccion(t.pool, async (con) => {
      let permisos = d.permisos ?? [];
      if (d.copiar_de) permisos = (await filas<{ permiso_codigo: string }>(con, 'SELECT permiso_codigo FROM rol_permisos WHERE rol_id = ?', [d.copiar_de])).map((p) => p.permiso_codigo);
      await validarPermisos(con, permisos, actorPermisos);
      const r = await ejecutar(con, 'INSERT INTO roles (codigo, nombre, descripcion, es_sistema) VALUES (?, ?, ?, 0)', [codigo, nombre, normalizarCampo('texto', d.descripcion)]);
      for (const p of new Set(permisos)) await ejecutar(con, 'INSERT INTO rol_permisos (rol_id, permiso_codigo) VALUES (?, ?)', [r.insertId, p]);
      await bitacora(con, actor, { accion: 'rol_creado', entidad: 'roles', entidadId: r.insertId, despues: { nombre, permisos: permisos.length } });
      return r.insertId;
    });
    return await obtenerRol(t, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya existe un rol con ese nombre');
  }
}

export async function actualizarRol(t: TallerReq, actor: Actor, actorPermisos: Set<string>, id: number, d: { nombre?: string; descripcion?: string | null; activo?: boolean; permisos?: string[] }) {
  try {
    await transaccion(t.pool, async (con) => {
      const r = await una<{ codigo: string; nombre: string; activo: number }>(con, 'SELECT codigo, nombre, activo FROM roles WHERE id = ? FOR UPDATE', [id]);
      if (!r) throw new ErrorNoEncontrado('No se encontró el rol');
      const esAdmin = r.codigo === 'administrador';
      if (esAdmin && d.permisos !== undefined) throw new ErrorApp(409, 'REGLA', 'El rol administrador siempre tiene todos los permisos: no se edita.');
      if (esAdmin && d.activo === false) throw new ErrorApp(409, 'REGLA', 'El rol administrador no se puede desactivar.');
      if (d.activo === false && r.activo === 1) {
        const uso = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM usuario_roles ur JOIN usuarios u ON u.id = ur.usuario_id AND u.activo = 1 WHERE ur.rol_id = ?', [id]);
        if (Number(uso?.n) > 0) throw new ErrorApp(409, 'EN_USO', `${uso?.n} usuarios activos tienen este rol. Cámbieles el rol antes de desactivarlo.`);
      }
      const sets: string[] = [];
      const valores: unknown[] = [];
      if (d.nombre !== undefined) {
        sets.push('nombre = ?');
        valores.push(normalizarCampo('texto', d.nombre)); // el código no cambia: la lógica nunca mira el texto
      }
      if (d.descripcion !== undefined) {
        sets.push('descripcion = ?');
        valores.push(normalizarCampo('texto', d.descripcion));
      }
      if (d.activo !== undefined) {
        sets.push('activo = ?');
        valores.push(d.activo ? 1 : 0);
      }
      if (sets.length > 0) await ejecutar(con, `UPDATE roles SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      if (d.permisos !== undefined) {
        const antes = (await filas<{ permiso_codigo: string }>(con, 'SELECT permiso_codigo FROM rol_permisos WHERE rol_id = ?', [id])).map((p) => p.permiso_codigo);
        await validarPermisos(con, d.permisos, actorPermisos);
        // Los permisos que el actor no tiene no se pueden quitar tampoco (no los puede ver ni cambiar).
        const intocables = antes.filter((p) => !actorPermisos.has(p));
        const nuevos = [...new Set([...d.permisos, ...intocables])];
        await ejecutar(con, 'DELETE FROM rol_permisos WHERE rol_id = ?', [id]);
        for (const p of nuevos) await ejecutar(con, 'INSERT INTO rol_permisos (rol_id, permiso_codigo) VALUES (?, ?)', [id, p]);
        await bitacora(con, actor, { accion: 'rol_permisos_editados', entidad: 'roles', entidadId: id, antes, despues: nuevos });
      } else {
        await bitacora(con, actor, { accion: 'rol_editado', entidad: 'roles', entidadId: id, antes: r, despues: d });
      }
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya existe un rol con ese nombre');
  }
  return obtenerRol(t, id);
}
