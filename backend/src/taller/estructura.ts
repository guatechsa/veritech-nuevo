import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado } from '../errores';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, conflictoSiDuplicado, TallerReq } from './comun';
import { crearCatalogo, DefCatalogo } from './catalogos';

// ── Sucursales ───────────────────────────────────────────────────────────────────────

export async function listarSucursales(t: TallerReq, incluirInactivos: boolean) {
  return filas(
    t.pool,
    `SELECT s.id, s.nombre, s.direccion, s.telefono, s.es_principal, s.cupo_diario_citas, s.activo,
            (SELECT COUNT(*) FROM colaboradores c WHERE c.sucursal_id = s.id AND c.activo = 1) AS colaboradores,
            (SELECT COUNT(*) FROM bodegas b WHERE b.sucursal_id = s.id AND b.activo = 1) AS bodegas
       FROM sucursales s ${incluirInactivos ? '' : 'WHERE s.activo = 1'} ORDER BY s.es_principal DESC, s.nombre`
  );
}

async function sucursalesActivas(ejecutor: Ejecutor): Promise<number> {
  const f = await una<{ n: number }>(ejecutor, 'SELECT COUNT(*) AS n FROM sucursales WHERE activo = 1');
  return Number(f?.n);
}

/** El plan limita cuántas sucursales activas puede tener el taller (nulo = sin límite). */
async function exigirCupoDeSucursales(t: TallerReq, ejecutor: Ejecutor): Promise<void> {
  const max = t.empresa.maxSucursales;
  if (max !== null && (await sucursalesActivas(ejecutor)) >= max) {
    throw new ErrorApp(409, 'LIMITE_DEL_PLAN', `Su plan permite ${max} ${max === 1 ? 'sucursal' : 'sucursales'}. Para tener más, suba de plan.`);
  }
}

export interface DatosSucursal {
  nombre?: string;
  direccion?: string | null;
  telefono?: string | null;
  cupo_diario_citas?: number | null;
  es_principal?: boolean;
  activo?: boolean;
}

export async function obtenerSucursal(t: TallerReq, id: number) {
  const f = await una(t.pool, 'SELECT id, nombre, direccion, telefono, es_principal, cupo_diario_citas, activo FROM sucursales WHERE id = ?', [id]);
  if (!f) throw new ErrorNoEncontrado('No se encontró la sucursal');
  return f;
}

export async function crearSucursal(t: TallerReq, actor: Actor, d: DatosSucursal & { nombre: string }) {
  try {
    const id = await transaccion(t.pool, async (con) => {
      await ejecutar(con, 'SELECT id FROM sucursales FOR UPDATE'); // dos altas a la vez no se pasan del límite
      await exigirCupoDeSucursales(t, con);
      const r = await ejecutar(con, 'INSERT INTO sucursales (nombre, direccion, telefono, cupo_diario_citas) VALUES (?, ?, ?, ?)', [
        normalizarCampo('texto', d.nombre),
        normalizarCampo('texto', d.direccion),
        normalizarCampo('telefono', d.telefono),
        d.cupo_diario_citas ?? null,
      ]);
      await bitacora(con, actor, { accion: 'sucursal_creada', entidad: 'sucursales', entidadId: r.insertId, despues: d });
      return r.insertId;
    });
    return await obtenerSucursal(t, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya existe una sucursal con ese nombre');
  }
}

export async function actualizarSucursal(t: TallerReq, actor: Actor, id: number, d: DatosSucursal) {
  try {
    await transaccion(t.pool, async (con) => {
      await ejecutar(con, 'SELECT id FROM sucursales FOR UPDATE');
      const actual = await una<{ nombre: string; es_principal: number; activo: number }>(con, 'SELECT nombre, es_principal, activo FROM sucursales WHERE id = ?', [id]);
      if (!actual) throw new ErrorNoEncontrado('No se encontró la sucursal');
      const sets: string[] = [];
      const valores: unknown[] = [];
      const poner = (col: string, v: unknown): void => {
        sets.push(`${col} = ?`);
        valores.push(v);
      };
      if (d.nombre !== undefined) poner('nombre', normalizarCampo('texto', d.nombre));
      if (d.direccion !== undefined) poner('direccion', normalizarCampo('texto', d.direccion));
      if (d.telefono !== undefined) poner('telefono', normalizarCampo('telefono', d.telefono));
      if (d.cupo_diario_citas !== undefined) poner('cupo_diario_citas', d.cupo_diario_citas);

      if (d.activo === false && actual.activo === 1) {
        if (actual.es_principal === 1 && d.es_principal !== false) {
          throw new ErrorApp(409, 'REGLA', 'La sucursal principal no se puede desactivar: nombre otra sucursal como principal primero.');
        }
        if ((await sucursalesActivas(con)) <= 1) throw new ErrorApp(409, 'REGLA', 'El taller necesita al menos una sucursal activa.');
        const colabs = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM colaboradores WHERE sucursal_id = ? AND activo = 1', [id]);
        if (Number(colabs?.n) > 0) throw new ErrorApp(409, 'EN_USO', `La sucursal tiene ${colabs?.n} colaboradores activos. Cámbieles la sucursal antes de desactivarla.`);
        const bodegas = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM bodegas WHERE sucursal_id = ? AND activo = 1', [id]);
        if (Number(bodegas?.n) > 0) throw new ErrorApp(409, 'EN_USO', `La sucursal tiene ${bodegas?.n} bodegas activas. Desactívelas o muévalas antes.`);
        poner('activo', 0);
        poner('es_principal', 0);
      } else if (d.activo === true && actual.activo === 0) {
        await exigirCupoDeSucursales(t, con);
        poner('activo', 1);
      }
      if (d.es_principal === true) {
        if ((d.activo ?? actual.activo === 1) === false) throw new ErrorApp(409, 'REGLA', 'Una sucursal desactivada no puede ser la principal.');
        await ejecutar(con, 'UPDATE sucursales SET es_principal = 0 WHERE id <> ?', [id]);
        poner('es_principal', 1);
      } else if (d.es_principal === false && actual.es_principal === 1 && d.activo !== false) {
        throw new ErrorApp(409, 'REGLA', 'Para cambiar la sucursal principal, marque otra como principal.');
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE sucursales SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      await bitacora(con, actor, { accion: 'sucursal_editada', entidad: 'sucursales', entidadId: id, antes: actual, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya existe una sucursal con ese nombre');
  }
  return obtenerSucursal(t, id);
}

// ── Bodegas ──────────────────────────────────────────────────────────────────────────

export async function listarBodegas(t: TallerReq, incluirInactivos: boolean) {
  return filas(
    t.pool,
    `SELECT b.id, b.nombre, b.sucursal_id, s.nombre AS sucursal, b.activo FROM bodegas b JOIN sucursales s ON s.id = b.sucursal_id
      ${incluirInactivos ? '' : 'WHERE b.activo = 1'} ORDER BY s.nombre, b.nombre`
  );
}

async function sucursalActiva(ejecutor: Ejecutor, id: number): Promise<void> {
  const s = await una<{ activo: number }>(ejecutor, 'SELECT activo FROM sucursales WHERE id = ?', [id]);
  if (!s) throw new ErrorApp(400, 'VALIDACION', 'La sucursal elegida no existe');
  if (s.activo !== 1) throw new ErrorApp(409, 'REGLA', 'La sucursal elegida está desactivada');
}

export async function crearBodega(t: TallerReq, actor: Actor, d: { nombre: string; sucursal_id: number }) {
  try {
    const id = await transaccion(t.pool, async (con) => {
      await sucursalActiva(con, d.sucursal_id);
      const r = await ejecutar(con, 'INSERT INTO bodegas (nombre, sucursal_id) VALUES (?, ?)', [normalizarCampo('texto', d.nombre), d.sucursal_id]);
      await bitacora(con, actor, { accion: 'bodega_creada', entidad: 'bodegas', entidadId: r.insertId, despues: d });
      return r.insertId;
    });
    return (await listarBodegas(t, true)).find((b) => b['id'] === id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Esa sucursal ya tiene una bodega con ese nombre');
  }
}

export async function actualizarBodega(t: TallerReq, actor: Actor, id: number, d: { nombre?: string; sucursal_id?: number; activo?: boolean }) {
  try {
    await transaccion(t.pool, async (con) => {
      const antes = await una(con, 'SELECT id, nombre, sucursal_id, activo FROM bodegas WHERE id = ?', [id]);
      if (!antes) throw new ErrorNoEncontrado('No se encontró la bodega');
      const sets: string[] = [];
      const valores: unknown[] = [];
      if (d.nombre !== undefined) {
        sets.push('nombre = ?');
        valores.push(normalizarCampo('texto', d.nombre));
      }
      if (d.sucursal_id !== undefined) {
        await sucursalActiva(con, d.sucursal_id);
        sets.push('sucursal_id = ?');
        valores.push(d.sucursal_id);
      }
      if (d.activo !== undefined) {
        sets.push('activo = ?');
        valores.push(d.activo ? 1 : 0);
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE bodegas SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      await bitacora(con, actor, { accion: 'bodega_editada', entidad: 'bodegas', entidadId: id, antes, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Esa sucursal ya tiene una bodega con ese nombre');
  }
  return (await listarBodegas(t, true)).find((b) => b['id'] === id);
}

// ── Puestos (con las credenciales que exige cada uno) ────────────────────────────────

const DEF_PUESTOS: DefCatalogo = {
  tabla: 'puestos',
  nombre: 'un puesto',
  campos: [
    { col: 'nombre', tipo: 'texto', requerido: true, max: 80 },
    { col: 'es_tecnico', tipo: 'bool', defecto: false },
    { col: 'es_operador', tipo: 'bool', defecto: false },
  ],
  unica: 'nombre',
  ordenar: 'nombre',
  conActivo: true,
};
export const puestosBase = crearCatalogo(DEF_PUESTOS);
export { DEF_PUESTOS };

export interface CredencialDePuesto {
  tipo_credencial_id: number;
  obligatoria: boolean;
}

export async function listarPuestos(t: TallerReq, incluirInactivos: boolean) {
  const puestos = await puestosBase.listar(t, incluirInactivos);
  const creds = await filas<{ puesto_id: number; tipo_credencial_id: number; obligatoria: number; nombre: string }>(
    t.pool,
    'SELECT pc.puesto_id, pc.tipo_credencial_id, pc.obligatoria, tc.nombre FROM puesto_credenciales pc JOIN tipos_credencial tc ON tc.id = pc.tipo_credencial_id ORDER BY tc.nombre'
  );
  return puestos.map((p) => ({ ...p, credenciales: creds.filter((c) => c.puesto_id === p['id']).map((c) => ({ tipo_credencial_id: c.tipo_credencial_id, nombre: c.nombre, obligatoria: c.obligatoria === 1 })) })) as Array<Record<string, unknown>>;
}

export async function guardarCredencialesDePuesto(t: TallerReq, actor: Actor, puestoId: number, credenciales: CredencialDePuesto[]): Promise<void> {
  await transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM puestos WHERE id = ?', [puestoId]))) throw new ErrorNoEncontrado('No se encontró el puesto');
    for (const c of credenciales) {
      if (!(await una(con, 'SELECT id FROM tipos_credencial WHERE id = ? AND activo = 1', [c.tipo_credencial_id]))) throw new ErrorApp(400, 'VALIDACION', 'Una de las credenciales no existe o está desactivada');
    }
    await ejecutar(con, 'DELETE FROM puesto_credenciales WHERE puesto_id = ?', [puestoId]);
    for (const c of credenciales) await ejecutar(con, 'INSERT INTO puesto_credenciales (puesto_id, tipo_credencial_id, obligatoria) VALUES (?, ?, ?)', [puestoId, c.tipo_credencial_id, c.obligatoria ? 1 : 0]);
    await bitacora(con, actor, { accion: 'puesto_credenciales_editadas', entidad: 'puestos', entidadId: puestoId, despues: credenciales });
  });
}
