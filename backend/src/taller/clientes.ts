import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, conflictoSiDuplicado, TallerReq } from './comun';

export type Condicion = 'contado' | 'credito';

export interface DatosCliente {
  nombre?: string;
  nit?: string | null;
  contacto_nombre?: string | null;
  contacto_email?: string | null;
  contacto_telefono?: string | null;
  telefono?: string | null;
  email?: string | null;
  direccion?: string | null;
  condicion_pago?: Condicion;
  dias_credito?: number;
  limite_credito?: number;
  notas?: string | null;
  tipo_cliente_id?: number | null;
}

/** Cosas que el taller debería ver antes de guardar, pero que no impiden guardar. */
export interface AvisoDuplicado {
  campo: 'email' | 'telefono';
  cliente: { id: number; nombre: string };
}

const COLUMNAS = `c.id, c.nombre, c.nit, c.contacto_nombre, c.contacto_email, c.contacto_telefono, c.telefono, c.email, c.direccion, c.condicion_pago,
  c.dias_credito, c.limite_credito, c.notas, c.tipo_cliente_id, tc.nombre AS tipo_cliente, c.activo`;

export async function listarClientes(t: TallerReq, f: { buscar?: string; activo?: boolean; tipo_cliente_id?: number; pagina: number; porPagina: number }) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (f.activo !== undefined) {
    donde.push('c.activo = ?');
    params.push(f.activo ? 1 : 0);
  }
  if (f.tipo_cliente_id) {
    donde.push('c.tipo_cliente_id = ?');
    params.push(f.tipo_cliente_id);
  }
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    donde.push('(c.nombre LIKE ? OR c.nit LIKE ? OR c.email LIKE ? OR c.telefono LIKE ? OR c.contacto_nombre LIKE ?)');
    params.push(patron, patron, patron, patron, patron);
  }
  const de = `FROM clientes c LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id ${donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : ''}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${de}`, params);
  const registros = await filas(t.pool, `SELECT ${COLUMNAS} ${de} ORDER BY c.nombre LIMIT ? OFFSET ?`, [...params, f.porPagina, (f.pagina - 1) * f.porPagina]);
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros };
}

/** Cuánta historia tiene un cliente (equipos, órdenes…). Las órdenes y los equipos llegan en fases posteriores: aquí se irán sumando. */
export async function historiaDeCliente(_con: Ejecutor, _clienteId: number): Promise<{ equipos: number; ordenes: number }> {
  return { equipos: 0, ordenes: 0 };
}

export async function obtenerCliente(t: TallerReq, id: number) {
  const c = await una(t.pool, `SELECT ${COLUMNAS}, c.created_at, c.updated_at FROM clientes c LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id WHERE c.id = ?`, [id]);
  if (!c) throw new ErrorNoEncontrado('No se encontró al cliente');
  const departamentos = await filas(t.pool, 'SELECT id, nombre, activo FROM departamentos WHERE cliente_id = ? ORDER BY nombre', [id]);
  const contactos = await filas(t.pool, 'SELECT id, nombre, correo, telefono, rol, acceso_todos_equipos, activo FROM contactos_cliente WHERE cliente_id = ? ORDER BY nombre', [id]);
  const historia = await historiaDeCliente(t.pool, id);
  return { ...c, departamentos, contactos, historia };
}

function condicionValida(d: DatosCliente): { condicion_pago?: Condicion; dias_credito?: number } {
  if (d.condicion_pago === 'contado') return { condicion_pago: 'contado', dias_credito: 0 };
  if (d.condicion_pago === 'credito' && !(d.dias_credito && d.dias_credito > 0)) throw new ErrorValidacion('Un cliente a crédito necesita los días de crédito');
  return { condicion_pago: d.condicion_pago, dias_credito: d.dias_credito };
}

async function exigirNitLibre(con: Ejecutor, nit: string | null, exceptoId: number | null): Promise<void> {
  if (!nit || nit === 'CF') return; // consumidor final: lo comparten muchos clientes
  const otro = await una<{ id: number; nombre: string }>(con, 'SELECT id, nombre FROM clientes WHERE nit_unico = ? AND id <> ?', [nit, exceptoId ?? 0]);
  if (otro) throw new ErrorApp(409, 'NIT_REPETIDO', `Ese NIT ya es de ${otro.nombre}.`, { cliente: { id: otro.id, nombre: otro.nombre } });
}

async function validarTipo(con: Ejecutor, tipoId: number | null | undefined): Promise<void> {
  if (!tipoId) return;
  const tipo = await una<{ activo: number }>(con, 'SELECT activo FROM tipos_cliente WHERE id = ?', [tipoId]);
  if (!tipo || tipo.activo !== 1) throw new ErrorValidacion('El tipo de cliente elegido no existe o está desactivado');
}

async function buscarDuplicados(con: Ejecutor, email: string | null, telefono: string | null, exceptoId: number | null): Promise<AvisoDuplicado[]> {
  const avisos: AvisoDuplicado[] = [];
  if (email) {
    for (const c of await filas<{ id: number; nombre: string }>(con, 'SELECT id, nombre FROM clientes WHERE email = ? AND id <> ? LIMIT 3', [email, exceptoId ?? 0])) avisos.push({ campo: 'email', cliente: c });
  }
  if (telefono) {
    for (const c of await filas<{ id: number; nombre: string }>(con, 'SELECT id, nombre FROM clientes WHERE telefono = ? AND id <> ? LIMIT 3', [telefono, exceptoId ?? 0])) avisos.push({ campo: 'telefono', cliente: c });
  }
  return avisos;
}

function normalizado(d: DatosCliente) {
  return {
    nombre: d.nombre === undefined ? undefined : normalizarCampo('texto', d.nombre),
    nit: d.nit === undefined ? undefined : normalizarCampo('nit', d.nit),
    contacto_nombre: d.contacto_nombre === undefined ? undefined : normalizarCampo('texto', d.contacto_nombre),
    contacto_email: d.contacto_email === undefined ? undefined : normalizarCampo('correo', d.contacto_email),
    contacto_telefono: d.contacto_telefono === undefined ? undefined : normalizarCampo('telefono', d.contacto_telefono),
    telefono: d.telefono === undefined ? undefined : normalizarCampo('telefono', d.telefono),
    email: d.email === undefined ? undefined : normalizarCampo('correo', d.email),
    direccion: d.direccion === undefined ? undefined : normalizarCampo('texto', d.direccion),
    notas: d.notas === undefined ? undefined : normalizarCampo('multilinea', d.notas),
  };
}

export async function crearCliente(t: TallerReq, actor: Actor, d: DatosCliente & { nombre: string }) {
  const n = normalizado(d);
  const cond = condicionValida({ condicion_pago: d.condicion_pago ?? 'contado', dias_credito: d.dias_credito });
  try {
    const resultado = await transaccion(t.pool, async (con) => {
      await exigirNitLibre(con, n.nit ?? null, null);
      await validarTipo(con, d.tipo_cliente_id);
      const tipoPorDefecto = d.tipo_cliente_id ?? (await una<{ id: number }>(con, "SELECT id FROM tipos_cliente WHERE activo = 1 ORDER BY id LIMIT 1"))?.id ?? null;
      const r = await ejecutar(
        con,
        `INSERT INTO clientes (nombre, nit, contacto_nombre, contacto_email, contacto_telefono, telefono, email, direccion, condicion_pago, dias_credito, limite_credito, notas, tipo_cliente_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [n.nombre, n.nit ?? null, n.contacto_nombre ?? null, n.contacto_email ?? null, n.contacto_telefono ?? null, n.telefono ?? null, n.email ?? null, n.direccion ?? null, cond.condicion_pago, cond.dias_credito ?? 0, d.limite_credito ?? 0, n.notas ?? null, tipoPorDefecto]
      );
      await bitacora(con, actor, { accion: 'cliente_creado', entidad: 'clientes', entidadId: r.insertId, despues: { nombre: n.nombre, nit: n.nit } });
      return { id: r.insertId, avisos: await buscarDuplicados(con, n.email ?? null, n.telefono ?? null, r.insertId) };
    });
    return { cliente: await obtenerCliente(t, resultado.id), avisos: resultado.avisos };
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ese NIT ya pertenece a otro cliente');
  }
}

export async function actualizarCliente(t: TallerReq, actor: Actor, id: number, d: DatosCliente) {
  const n = normalizado(d);
  try {
    const avisos = await transaccion(t.pool, async (con) => {
      const antes = await una<{ nombre: string; nit: string | null; email: string | null; telefono: string | null; condicion_pago: Condicion; dias_credito: number }>(
        con,
        'SELECT nombre, nit, email, telefono, condicion_pago, dias_credito FROM clientes WHERE id = ? FOR UPDATE',
        [id]
      );
      if (!antes) throw new ErrorNoEncontrado('No se encontró al cliente');
      if (n.nit !== undefined) await exigirNitLibre(con, n.nit, id);
      if (d.tipo_cliente_id !== undefined) await validarTipo(con, d.tipo_cliente_id);
      const sets: string[] = [];
      const valores: unknown[] = [];
      const poner = (col: string, v: unknown): void => {
        if (v === undefined) return;
        sets.push(`${col} = ?`);
        valores.push(v);
      };
      poner('nombre', n.nombre);
      poner('nit', n.nit);
      poner('contacto_nombre', n.contacto_nombre);
      poner('contacto_email', n.contacto_email);
      poner('contacto_telefono', n.contacto_telefono);
      poner('telefono', n.telefono);
      poner('email', n.email);
      poner('direccion', n.direccion);
      poner('notas', n.notas);
      poner('limite_credito', d.limite_credito);
      poner('tipo_cliente_id', d.tipo_cliente_id);
      if (d.condicion_pago !== undefined || d.dias_credito !== undefined) {
        const cond = condicionValida({ condicion_pago: d.condicion_pago ?? antes.condicion_pago, dias_credito: d.dias_credito ?? antes.dias_credito });
        poner('condicion_pago', cond.condicion_pago);
        poner('dias_credito', cond.dias_credito);
      }
      if (sets.length > 0) {
        await ejecutar(con, `UPDATE clientes SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
        await bitacora(con, actor, { accion: 'cliente_editado', entidad: 'clientes', entidadId: id, antes, despues: { ...n, tipo_cliente_id: d.tipo_cliente_id } });
      }
      return buscarDuplicados(con, n.email === undefined ? antes.email : n.email, n.telefono === undefined ? antes.telefono : n.telefono, id);
    });
    return { cliente: await obtenerCliente(t, id), avisos };
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ese NIT ya pertenece a otro cliente');
  }
}

export async function cambiarEstadoCliente(t: TallerReq, actor: Actor, id: number, activo: boolean) {
  await transaccion(t.pool, async (con) => {
    const c = await una<{ activo: number }>(con, 'SELECT activo FROM clientes WHERE id = ? FOR UPDATE', [id]);
    if (!c) throw new ErrorNoEncontrado('No se encontró al cliente');
    if ((c.activo === 1) === activo) return;
    await ejecutar(con, 'UPDATE clientes SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
    await bitacora(con, actor, { accion: activo ? 'cliente_reactivado' : 'cliente_desactivado', entidad: 'clientes', entidadId: id });
  });
  return obtenerCliente(t, id);
}

/** Solo se borra de verdad a un cliente que nunca se usó (sin equipos ni órdenes); con historia, solo se desactiva. */
export async function eliminarCliente(t: TallerReq, actor: Actor, id: number): Promise<void> {
  await transaccion(t.pool, async (con) => {
    const c = await una<{ nombre: string }>(con, 'SELECT nombre FROM clientes WHERE id = ? FOR UPDATE', [id]);
    if (!c) throw new ErrorNoEncontrado('No se encontró al cliente');
    const h = await historiaDeCliente(con, id);
    if (h.equipos > 0 || h.ordenes > 0) throw new ErrorApp(409, 'EN_USO', `${c.nombre} tiene historia (${h.equipos} equipos, ${h.ordenes} órdenes): no se puede borrar, pero sí desactivar.`);
    await ejecutar(con, 'DELETE FROM contactos_cliente WHERE cliente_id = ?', [id]);
    await ejecutar(con, 'DELETE FROM departamentos WHERE cliente_id = ?', [id]);
    await ejecutar(con, 'DELETE FROM clientes WHERE id = ?', [id]);
    await bitacora(con, actor, { accion: 'cliente_eliminado', entidad: 'clientes', entidadId: id, antes: c });
  });
}

// ── Departamentos del cliente (siempre dentro de SU cliente) ─────────────────────────
async function exigirCliente(con: Ejecutor, clienteId: number): Promise<void> {
  if (!(await una(con, 'SELECT id FROM clientes WHERE id = ?', [clienteId]))) throw new ErrorNoEncontrado('No se encontró al cliente');
}

export async function crearDepartamento(t: TallerReq, actor: Actor, clienteId: number, d: { nombre: string }) {
  try {
    await transaccion(t.pool, async (con) => {
      await exigirCliente(con, clienteId);
      const r = await ejecutar(con, 'INSERT INTO departamentos (cliente_id, nombre) VALUES (?, ?)', [clienteId, normalizarCampo('texto', d.nombre)]);
      await bitacora(con, actor, { accion: 'departamento_creado', entidad: 'departamentos', entidadId: r.insertId, despues: { clienteId, ...d } });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ese cliente ya tiene un departamento con ese nombre');
  }
  return obtenerCliente(t, clienteId);
}

export async function actualizarDepartamento(t: TallerReq, actor: Actor, clienteId: number, id: number, d: { nombre?: string; activo?: boolean }) {
  try {
    await transaccion(t.pool, async (con) => {
      // Se busca por cliente Y por id: un departamento de otro cliente no se puede tocar desde este.
      const dep = await una(con, 'SELECT id FROM departamentos WHERE id = ? AND cliente_id = ?', [id, clienteId]);
      if (!dep) throw new ErrorNoEncontrado('No se encontró el departamento de ese cliente');
      const sets: string[] = [];
      const valores: unknown[] = [];
      if (d.nombre !== undefined) {
        sets.push('nombre = ?');
        valores.push(normalizarCampo('texto', d.nombre));
      }
      if (d.activo !== undefined) {
        sets.push('activo = ?');
        valores.push(d.activo ? 1 : 0);
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE departamentos SET ${sets.join(', ')} WHERE id = ? AND cliente_id = ?`, [...valores, id, clienteId]);
      await bitacora(con, actor, { accion: 'departamento_editado', entidad: 'departamentos', entidadId: id, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ese cliente ya tiene un departamento con ese nombre');
  }
  return obtenerCliente(t, clienteId);
}

// ── Contactos del cliente ────────────────────────────────────────────────────────────
export interface DatosContacto {
  nombre?: string;
  correo?: string | null;
  telefono?: string | null;
  rol?: 'aprobador' | 'consulta' | 'piloto';
  acceso_todos_equipos?: boolean;
  activo?: boolean;
}

export async function crearContacto(t: TallerReq, actor: Actor, clienteId: number, d: DatosContacto & { nombre: string }) {
  await transaccion(t.pool, async (con) => {
    await exigirCliente(con, clienteId);
    const r = await ejecutar(con, 'INSERT INTO contactos_cliente (cliente_id, nombre, correo, telefono, rol, acceso_todos_equipos) VALUES (?, ?, ?, ?, ?, ?)', [
      clienteId,
      normalizarCampo('texto', d.nombre),
      normalizarCampo('correo', d.correo),
      normalizarCampo('telefono', d.telefono),
      d.rol ?? 'consulta',
      d.acceso_todos_equipos === false ? 0 : 1,
    ]);
    await bitacora(con, actor, { accion: 'contacto_creado', entidad: 'contactos_cliente', entidadId: r.insertId, despues: { clienteId, ...d } });
  });
  return obtenerCliente(t, clienteId);
}

export async function actualizarContacto(t: TallerReq, actor: Actor, clienteId: number, id: number, d: DatosContacto) {
  await transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM contactos_cliente WHERE id = ? AND cliente_id = ?', [id, clienteId]))) throw new ErrorNoEncontrado('No se encontró el contacto de ese cliente');
    const sets: string[] = [];
    const valores: unknown[] = [];
    const poner = (col: string, v: unknown): void => {
      sets.push(`${col} = ?`);
      valores.push(v);
    };
    if (d.nombre !== undefined) poner('nombre', normalizarCampo('texto', d.nombre));
    if (d.correo !== undefined) poner('correo', normalizarCampo('correo', d.correo));
    if (d.telefono !== undefined) poner('telefono', normalizarCampo('telefono', d.telefono));
    if (d.rol !== undefined) poner('rol', d.rol);
    if (d.acceso_todos_equipos !== undefined) poner('acceso_todos_equipos', d.acceso_todos_equipos ? 1 : 0);
    if (d.activo !== undefined) poner('activo', d.activo ? 1 : 0);
    if (sets.length === 0) return;
    await ejecutar(con, `UPDATE contactos_cliente SET ${sets.join(', ')} WHERE id = ? AND cliente_id = ?`, [...valores, id, clienteId]);
    await bitacora(con, actor, { accion: 'contacto_editado', entidad: 'contactos_cliente', entidadId: id, despues: d });
  });
  return obtenerCliente(t, clienteId);
}

// ── Proveedores ──────────────────────────────────────────────────────────────────────
export interface DatosProveedor {
  nombre?: string;
  nit?: string | null;
  contacto_nombre?: string | null;
  contacto_email?: string | null;
  contacto_telefono?: string | null;
  direccion?: string | null;
  condicion_pago?: Condicion;
  dias_credito?: number;
  notas?: string | null;
  activo?: boolean;
}

const COLS_PROV = 'id, nombre, nit, contacto_nombre, contacto_email, contacto_telefono, direccion, condicion_pago, dias_credito, notas, activo';

export async function listarProveedores(t: TallerReq, f: { buscar?: string; activo?: boolean; pagina: number; porPagina: number }) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (f.activo !== undefined) {
    donde.push('activo = ?');
    params.push(f.activo ? 1 : 0);
  }
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    donde.push('(nombre LIKE ? OR nit LIKE ? OR contacto_nombre LIKE ? OR contacto_email LIKE ?)');
    params.push(patron, patron, patron, patron);
  }
  const condicion = donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : '';
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n FROM proveedores ${condicion}`, params);
  const registros = await filas(t.pool, `SELECT ${COLS_PROV} FROM proveedores ${condicion} ORDER BY nombre LIMIT ? OFFSET ?`, [...params, f.porPagina, (f.pagina - 1) * f.porPagina]);
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros };
}

export async function obtenerProveedor(t: TallerReq, id: number) {
  const p = await una(t.pool, `SELECT ${COLS_PROV} FROM proveedores WHERE id = ?`, [id]);
  if (!p) throw new ErrorNoEncontrado('No se encontró al proveedor');
  return p;
}

export async function crearProveedor(t: TallerReq, actor: Actor, d: DatosProveedor & { nombre: string }) {
  const cond = condicionValida({ condicion_pago: d.condicion_pago ?? 'contado', dias_credito: d.dias_credito });
  try {
    const id = await transaccion(t.pool, async (con) => {
      const r = await ejecutar(
        con,
        `INSERT INTO proveedores (nombre, nit, contacto_nombre, contacto_email, contacto_telefono, direccion, condicion_pago, dias_credito, notas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          normalizarCampo('texto', d.nombre),
          normalizarCampo('nit', d.nit),
          normalizarCampo('texto', d.contacto_nombre),
          normalizarCampo('correo', d.contacto_email),
          normalizarCampo('telefono', d.contacto_telefono),
          normalizarCampo('texto', d.direccion),
          cond.condicion_pago,
          cond.dias_credito ?? 0,
          normalizarCampo('multilinea', d.notas),
        ]
      );
      await bitacora(con, actor, { accion: 'proveedor_creado', entidad: 'proveedores', entidadId: r.insertId, despues: { nombre: d.nombre } });
      return r.insertId;
    });
    return await obtenerProveedor(t, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya existe un proveedor con ese nombre');
  }
}

export async function actualizarProveedor(t: TallerReq, actor: Actor, id: number, d: DatosProveedor) {
  try {
    await transaccion(t.pool, async (con) => {
      const antes = await una<{ condicion_pago: Condicion; dias_credito: number }>(con, 'SELECT condicion_pago, dias_credito FROM proveedores WHERE id = ? FOR UPDATE', [id]);
      if (!antes) throw new ErrorNoEncontrado('No se encontró al proveedor');
      const sets: string[] = [];
      const valores: unknown[] = [];
      const poner = (col: string, v: unknown): void => {
        sets.push(`${col} = ?`);
        valores.push(v);
      };
      if (d.nombre !== undefined) poner('nombre', normalizarCampo('texto', d.nombre));
      if (d.nit !== undefined) poner('nit', normalizarCampo('nit', d.nit));
      if (d.contacto_nombre !== undefined) poner('contacto_nombre', normalizarCampo('texto', d.contacto_nombre));
      if (d.contacto_email !== undefined) poner('contacto_email', normalizarCampo('correo', d.contacto_email));
      if (d.contacto_telefono !== undefined) poner('contacto_telefono', normalizarCampo('telefono', d.contacto_telefono));
      if (d.direccion !== undefined) poner('direccion', normalizarCampo('texto', d.direccion));
      if (d.notas !== undefined) poner('notas', normalizarCampo('multilinea', d.notas));
      if (d.activo !== undefined) poner('activo', d.activo ? 1 : 0);
      if (d.condicion_pago !== undefined || d.dias_credito !== undefined) {
        const cond = condicionValida({ condicion_pago: d.condicion_pago ?? antes.condicion_pago, dias_credito: d.dias_credito ?? antes.dias_credito });
        poner('condicion_pago', cond.condicion_pago);
        poner('dias_credito', cond.dias_credito);
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE proveedores SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      await bitacora(con, actor, { accion: 'proveedor_editado', entidad: 'proveedores', entidadId: id, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya existe un proveedor con ese nombre');
  }
  return obtenerProveedor(t, id);
}
