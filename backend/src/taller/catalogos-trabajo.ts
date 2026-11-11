import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, conflictoSiDuplicado, TallerReq } from './comun';
import { DefCatalogo } from './catalogos';

// ── Catálogos simples (se manejan con el motor de catalogos.ts) ──────────────────────
export const ACCIONES: DefCatalogo = {
  tabla: 'acciones',
  nombre: 'una acción',
  campos: [
    { col: 'codigo', tipo: 'codigo', requerido: true, max: 3, inmutable: true },
    { col: 'nombre', tipo: 'texto', requerido: true, max: 60 },
  ],
  unica: 'código o nombre',
  ordenar: 'nombre',
  conActivo: true,
};

export const UNIDADES: DefCatalogo = {
  tabla: 'unidades',
  nombre: 'una unidad',
  campos: [
    { col: 'codigo', tipo: 'codigo', requerido: true, max: 10, inmutable: true },
    { col: 'nombre', tipo: 'texto', requerido: true, max: 60 },
    { col: 'uso', tipo: 'opcion', opciones: ['inventario', 'contador', 'ambos'], defecto: 'inventario' },
  ],
  unica: 'código',
  ordenar: 'uso, nombre',
  conActivo: true,
};

export const MARCAS: DefCatalogo = {
  tabla: 'marcas',
  nombre: 'una marca',
  campos: [
    { col: 'nombre', tipo: 'texto', requerido: true, max: 80 },
    { col: 'tipo_equipo_id', tipo: 'referencia' },
  ],
  unica: 'nombre',
  ordenar: 'nombre',
  conActivo: true,
};

export const MOTIVOS: DefCatalogo = {
  tabla: 'motivos',
  nombre: 'un motivo',
  campos: [
    { col: 'tipo', tipo: 'opcion', opciones: ['rechazo_cotizacion', 'cancelacion_cita', 'anulacion_orden', 'diferencia_inventario', 'excepcion_checklist'], requerido: true, inmutable: true },
    { col: 'nombre', tipo: 'texto', requerido: true, max: 100 },
  ],
  unica: 'nombre dentro de ese tipo',
  ordenar: 'tipo, nombre',
  conActivo: true,
};

export const ETAPAS: DefCatalogo = {
  tabla: 'etapas',
  nombre: 'una etapa',
  campos: [
    { col: 'codigo', tipo: 'codigo', requerido: true, max: 20, inmutable: true },
    { col: 'nombre', tipo: 'texto', requerido: true, max: 60 },
    { col: 'orden', tipo: 'entero', min: 0, max: 1000, defecto: 0 },
    { col: 'requiere_orden', tipo: 'bool', defecto: true },
    { col: 'color', tipo: 'color', defecto: '#6B7280' },
  ],
  unica: 'código o nombre',
  ordenar: 'orden, nombre',
  conActivo: true,
};

export const TIPOS_CLIENTE: DefCatalogo = {
  tabla: 'tipos_cliente',
  nombre: 'un tipo de cliente',
  campos: [
    { col: 'nombre', tipo: 'texto', requerido: true, max: 80 },
    { col: 'descuento_trabajos', tipo: 'porcentaje', defecto: 0 },
    { col: 'descuento_materiales', tipo: 'porcentaje', defecto: 0 },
    { col: 'descuento_otros', tipo: 'porcentaje', defecto: 0 },
  ],
  unica: 'nombre',
  ordenar: 'nombre',
  conActivo: true,
};

export const TIPOS_CONTADOR: DefCatalogo = {
  tabla: 'tipos_contador',
  nombre: 'un tipo de contador',
  campos: [
    { col: 'nombre', tipo: 'texto', requerido: true, max: 80 },
    { col: 'unidad_id', tipo: 'referencia', requerido: true, inmutable: true },
    { col: 'es_calendario', tipo: 'bool', defecto: false, inmutable: true },
  ],
  unica: 'nombre',
  ordenar: 'nombre',
  conActivo: true,
};

export const TIPOS_DOCUMENTO: DefCatalogo = {
  tabla: 'tipos_documento',
  nombre: 'un tipo de documento',
  campos: [
    { col: 'nombre', tipo: 'texto', requerido: true, max: 100 },
    { col: 'requiere_vencimiento', tipo: 'bool', defecto: false },
    { col: 'dias_aviso', tipo: 'entero', min: 0, max: 365, defecto: 30 },
  ],
  unica: 'nombre',
  ordenar: 'nombre',
  conActivo: true,
};

// ── Jerarquía técnica ────────────────────────────────────────────────────────────────

/** Menor número libre de 2 dígitos (01 a 98 para sistemas; 01 a 99 para subsistemas y partes). Los códigos se numeran solos. */
function siguienteCodigo(usados: string[], maximo: number): string {
  const set = new Set(usados);
  for (let n = 1; n <= maximo; n++) {
    const c = String(n).padStart(2, '0');
    if (!set.has(c)) return c;
  }
  throw new ErrorApp(409, 'LIMITE', 'Ya no quedan códigos libres en este nivel.');
}

export async function listarSistemas(t: TallerReq, incluirInactivos: boolean) {
  return filas(
    t.pool,
    `SELECT s.id, s.codigo, s.nombre, s.es_servicios_programados, s.es_insumos_generales, s.activo,
            (SELECT COUNT(*) FROM subsistemas x WHERE x.sistema_id = s.id AND x.activo = 1) AS subsistemas
       FROM sistemas s ${incluirInactivos ? '' : 'WHERE s.activo = 1'} ORDER BY s.codigo`
  );
}

async function obtenerSistema(ejecutor: Ejecutor, id: number) {
  const s = await una<{ id: number; codigo: string; nombre: string; es_servicios_programados: number; es_insumos_generales: number; activo: number }>(
    ejecutor,
    'SELECT id, codigo, nombre, es_servicios_programados, es_insumos_generales, activo FROM sistemas WHERE id = ?',
    [id]
  );
  if (!s) throw new ErrorNoEncontrado('No se encontró el sistema');
  return s;
}

export async function crearSistema(t: TallerReq, actor: Actor, d: { nombre: string; es_servicios_programados?: boolean; es_insumos_generales?: boolean }) {
  try {
    const id = await transaccion(t.pool, async (con) => {
      await ejecutar(con, 'SELECT id FROM sistemas FOR UPDATE');
      if (d.es_insumos_generales && (await una(con, 'SELECT id FROM sistemas WHERE es_insumos_generales = 1'))) throw new ErrorApp(409, 'REGLA', 'Ya existe un grupo de insumos generales.');
      const usados = (await filas<{ codigo: string }>(con, 'SELECT codigo FROM sistemas')).map((x) => x.codigo).concat(['99']);
      const codigo = siguienteCodigo(usados, 98);
      const r = await ejecutar(con, 'INSERT INTO sistemas (codigo, nombre, es_servicios_programados, es_insumos_generales) VALUES (?, ?, ?, ?)', [
        codigo,
        normalizarCampo('texto', d.nombre),
        d.es_servicios_programados ? 1 : 0,
        d.es_insumos_generales ? 1 : 0,
      ]);
      // Matriz: el sistema nuevo nace habilitado para todos los niveles.
      await ejecutar(con, 'INSERT INTO matriz_tecnico_sistema (nivel_tecnico_id, sistema_id) SELECT id, ? FROM niveles_tecnico', [r.insertId]);
      await bitacora(con, actor, { accion: 'sistema_creado', entidad: 'sistemas', entidadId: r.insertId, despues: { ...d, codigo } });
      return r.insertId;
    });
    return await obtenerSistema(t.pool, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya existe un sistema con ese nombre');
  }
}

export async function actualizarSistema(t: TallerReq, actor: Actor, id: number, d: { nombre?: string; es_servicios_programados?: boolean; es_insumos_generales?: boolean; activo?: boolean }) {
  try {
    await transaccion(t.pool, async (con) => {
      const antes = await obtenerSistema(con, id);
      const sets: string[] = [];
      const valores: unknown[] = [];
      if (d.nombre !== undefined) {
        sets.push('nombre = ?');
        valores.push(normalizarCampo('texto', d.nombre));
      }
      if (d.es_servicios_programados !== undefined) {
        sets.push('es_servicios_programados = ?');
        valores.push(d.es_servicios_programados ? 1 : 0);
      }
      if (d.es_insumos_generales !== undefined) {
        if (d.es_insumos_generales && (await una(con, 'SELECT id FROM sistemas WHERE es_insumos_generales = 1 AND id <> ?', [id]))) throw new ErrorApp(409, 'REGLA', 'Ya existe un grupo de insumos generales.');
        sets.push('es_insumos_generales = ?');
        valores.push(d.es_insumos_generales ? 1 : 0);
      }
      if (d.activo !== undefined && (d.activo ? 1 : 0) !== antes.activo) {
        if (!d.activo) {
          const hijos = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM subsistemas WHERE sistema_id = ? AND activo = 1', [id]);
          if (Number(hijos?.n) > 0) throw new ErrorApp(409, 'EN_USO', `El sistema tiene ${hijos?.n} subsistemas activos. Desactívelos primero.`);
        }
        sets.push('activo = ?');
        valores.push(d.activo ? 1 : 0);
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE sistemas SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      await bitacora(con, actor, { accion: 'sistema_editado', entidad: 'sistemas', entidadId: id, antes, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya existe un sistema con ese nombre');
  }
  return obtenerSistema(t.pool, id);
}

export async function listarSubsistemas(t: TallerReq, f: { sistema_id?: number; inactivos: boolean }) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (f.sistema_id) {
    donde.push('x.sistema_id = ?');
    params.push(f.sistema_id);
  }
  if (!f.inactivos) donde.push('x.activo = 1');
  return filas(
    t.pool,
    `SELECT x.id, x.sistema_id, s.codigo AS sistema_codigo, s.nombre AS sistema, x.codigo, CONCAT(s.codigo, '-', x.codigo) AS codigo_completo, x.nombre, x.activo,
            (SELECT COUNT(*) FROM partes p WHERE p.subsistema_id = x.id AND p.activo = 1) AS partes
       FROM subsistemas x JOIN sistemas s ON s.id = x.sistema_id ${donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : ''} ORDER BY s.codigo, x.codigo`,
    params
  );
}

async function obtenerSubsistema(ejecutor: Ejecutor, id: number) {
  const s = await una<{ id: number; sistema_id: number; codigo: string; nombre: string; activo: number }>(ejecutor, 'SELECT id, sistema_id, codigo, nombre, activo FROM subsistemas WHERE id = ?', [id]);
  if (!s) throw new ErrorNoEncontrado('No se encontró el subsistema');
  return s;
}

export async function crearSubsistema(t: TallerReq, actor: Actor, d: { sistema_id: number; nombre: string }) {
  try {
    const id = await transaccion(t.pool, async (con) => {
      const sis = await una<{ activo: number }>(con, 'SELECT activo FROM sistemas WHERE id = ? FOR UPDATE', [d.sistema_id]);
      if (!sis || sis.activo !== 1) throw new ErrorValidacion('El sistema elegido no existe o está desactivado');
      const usados = (await filas<{ codigo: string }>(con, 'SELECT codigo FROM subsistemas WHERE sistema_id = ?', [d.sistema_id])).map((x) => x.codigo);
      const r = await ejecutar(con, 'INSERT INTO subsistemas (sistema_id, codigo, nombre) VALUES (?, ?, ?)', [d.sistema_id, siguienteCodigo(usados, 99), normalizarCampo('texto', d.nombre)]);
      await bitacora(con, actor, { accion: 'subsistema_creado', entidad: 'subsistemas', entidadId: r.insertId, despues: d });
      return r.insertId;
    });
    return await obtenerSubsistema(t.pool, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya existe un subsistema con ese nombre en este sistema');
  }
}

/** Los trabajos guardan su nombre armado ("ACCION - PARTE - SUBSISTEMA"): si algo se renombra, se rearman. */
async function rearmarNombresDeTrabajos(con: Ejecutor, donde: string, id: number): Promise<void> {
  await ejecutar(
    con,
    `UPDATE trabajos tr JOIN partes p ON p.id = tr.parte_id JOIN subsistemas x ON x.id = p.subsistema_id JOIN acciones a ON a.id = tr.accion_id
        SET tr.nombre = LEFT(CONCAT(a.nombre, ' - ', p.nombre, ' - ', x.nombre, IF(tr.variante IS NULL, '', CONCAT(' (', tr.variante, ')'))), 220)
      WHERE ${donde} = ?`,
    [id]
  );
}

export async function actualizarSubsistema(t: TallerReq, actor: Actor, id: number, d: { nombre?: string; activo?: boolean }) {
  try {
    await transaccion(t.pool, async (con) => {
      const antes = await obtenerSubsistema(con, id);
      const sets: string[] = [];
      const valores: unknown[] = [];
      if (d.nombre !== undefined) {
        sets.push('nombre = ?');
        valores.push(normalizarCampo('texto', d.nombre));
      }
      if (d.activo !== undefined && (d.activo ? 1 : 0) !== antes.activo) {
        if (d.activo) {
          const padre = await una<{ activo: number }>(con, 'SELECT activo FROM sistemas WHERE id = ?', [antes.sistema_id]);
          if (padre?.activo !== 1) throw new ErrorApp(409, 'REGLA', 'El sistema de este subsistema está desactivado. Actívelo primero.');
        } else {
          const hijos = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM partes WHERE subsistema_id = ? AND activo = 1', [id]);
          if (Number(hijos?.n) > 0) throw new ErrorApp(409, 'EN_USO', `El subsistema tiene ${hijos?.n} partes activas. Desactívelas primero.`);
        }
        sets.push('activo = ?');
        valores.push(d.activo ? 1 : 0);
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE subsistemas SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      if (d.nombre !== undefined) await rearmarNombresDeTrabajos(con, 'x.id', id);
      await bitacora(con, actor, { accion: 'subsistema_editado', entidad: 'subsistemas', entidadId: id, antes, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya existe un subsistema con ese nombre en este sistema');
  }
  return obtenerSubsistema(t.pool, id);
}

export async function listarPartes(t: TallerReq, f: { subsistema_id?: number; sistema_id?: number; inactivos: boolean }) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (f.subsistema_id) {
    donde.push('p.subsistema_id = ?');
    params.push(f.subsistema_id);
  }
  if (f.sistema_id) {
    donde.push('x.sistema_id = ?');
    params.push(f.sistema_id);
  }
  if (!f.inactivos) donde.push('p.activo = 1');
  return filas(
    t.pool,
    `SELECT p.id, p.subsistema_id, x.nombre AS subsistema, x.sistema_id, s.nombre AS sistema, p.codigo, CONCAT(s.codigo, '-', x.codigo, '-', p.codigo) AS codigo_completo, p.nombre, p.activo
       FROM partes p JOIN subsistemas x ON x.id = p.subsistema_id JOIN sistemas s ON s.id = x.sistema_id
       ${donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : ''} ORDER BY s.codigo, x.codigo, p.codigo`,
    params
  );
}

async function obtenerParte(ejecutor: Ejecutor, id: number) {
  const p = await una<{ id: number; subsistema_id: number; codigo: string; nombre: string; activo: number }>(ejecutor, 'SELECT id, subsistema_id, codigo, nombre, activo FROM partes WHERE id = ?', [id]);
  if (!p) throw new ErrorNoEncontrado('No se encontró la parte');
  return p;
}

export async function crearParte(t: TallerReq, actor: Actor, d: { subsistema_id: number; nombre: string }) {
  try {
    const id = await transaccion(t.pool, async (con) => {
      const sub = await una<{ activo: number }>(con, 'SELECT activo FROM subsistemas WHERE id = ? FOR UPDATE', [d.subsistema_id]);
      if (!sub || sub.activo !== 1) throw new ErrorValidacion('El subsistema elegido no existe o está desactivado');
      const usados = (await filas<{ codigo: string }>(con, 'SELECT codigo FROM partes WHERE subsistema_id = ?', [d.subsistema_id])).map((x) => x.codigo);
      const r = await ejecutar(con, 'INSERT INTO partes (subsistema_id, codigo, nombre) VALUES (?, ?, ?)', [d.subsistema_id, siguienteCodigo(usados, 99), normalizarCampo('texto', d.nombre)]);
      await bitacora(con, actor, { accion: 'parte_creada', entidad: 'partes', entidadId: r.insertId, despues: d });
      return r.insertId;
    });
    return await obtenerParte(t.pool, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya existe una parte con ese nombre en este subsistema');
  }
}

export async function actualizarParte(t: TallerReq, actor: Actor, id: number, d: { nombre?: string; activo?: boolean }) {
  try {
    await transaccion(t.pool, async (con) => {
      const antes = await obtenerParte(con, id);
      const sets: string[] = [];
      const valores: unknown[] = [];
      if (d.nombre !== undefined) {
        sets.push('nombre = ?');
        valores.push(normalizarCampo('texto', d.nombre));
      }
      if (d.activo !== undefined && (d.activo ? 1 : 0) !== antes.activo) {
        if (d.activo) {
          const padre = await una<{ activo: number }>(con, 'SELECT activo FROM subsistemas WHERE id = ?', [antes.subsistema_id]);
          if (padre?.activo !== 1) throw new ErrorApp(409, 'REGLA', 'El subsistema de esta parte está desactivado. Actívelo primero.');
        } else {
          const hijos = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM trabajos WHERE parte_id = ? AND activo = 1', [id]);
          if (Number(hijos?.n) > 0) throw new ErrorApp(409, 'EN_USO', `La parte tiene ${hijos?.n} trabajos activos. Desactívelos primero.`);
        }
        sets.push('activo = ?');
        valores.push(d.activo ? 1 : 0);
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE partes SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      if (d.nombre !== undefined) await rearmarNombresDeTrabajos(con, 'p.id', id);
      await bitacora(con, actor, { accion: 'parte_editada', entidad: 'partes', entidadId: id, antes, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya existe una parte con ese nombre en este subsistema');
  }
  return obtenerParte(t.pool, id);
}

// ── Trabajos ─────────────────────────────────────────────────────────────────────────
export interface FiltroTrabajos {
  buscar?: string;
  sistema_id?: number;
  subsistema_id?: number;
  parte_id?: number;
  accion_id?: number;
  area_trabajo_id?: number;
  inactivos: boolean;
  pagina: number;
  porPagina: number;
}

export async function listarTrabajos(t: TallerReq, f: FiltroTrabajos) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (!f.inactivos) donde.push('tr.activo = 1');
  if (f.sistema_id) {
    donde.push('s.id = ?');
    params.push(f.sistema_id);
  }
  if (f.subsistema_id) {
    donde.push('x.id = ?');
    params.push(f.subsistema_id);
  }
  if (f.parte_id) {
    donde.push('tr.parte_id = ?');
    params.push(f.parte_id);
  }
  if (f.accion_id) {
    donde.push('tr.accion_id = ?');
    params.push(f.accion_id);
  }
  if (f.area_trabajo_id) {
    donde.push('tr.area_trabajo_id = ?');
    params.push(f.area_trabajo_id);
  }
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    donde.push('(tr.nombre LIKE ? OR tr.codigo LIKE ?)');
    params.push(patron, patron);
  }
  const de = `FROM trabajos tr JOIN partes p ON p.id = tr.parte_id JOIN subsistemas x ON x.id = p.subsistema_id JOIN sistemas s ON s.id = x.sistema_id
              JOIN acciones a ON a.id = tr.accion_id LEFT JOIN areas_trabajo ar ON ar.id = tr.area_trabajo_id ${donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : ''}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${de}`, params);
  const registros = await filas(
    t.pool,
    `SELECT tr.id, tr.codigo, tr.nombre, tr.variante, tr.parte_id, p.nombre AS parte, x.id AS subsistema_id, x.nombre AS subsistema, s.id AS sistema_id, s.nombre AS sistema,
            tr.accion_id, a.nombre AS accion, tr.area_trabajo_id, ar.nombre AS area, tr.activo
       ${de} ORDER BY tr.codigo LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros };
}

async function obtenerTrabajo(t: TallerReq, id: number) {
  const r = await listarTrabajosPorId(t, id);
  if (!r) throw new ErrorNoEncontrado('No se encontró el trabajo');
  return r;
}

async function listarTrabajosPorId(t: TallerReq, id: number) {
  return una(
    t.pool,
    `SELECT tr.id, tr.codigo, tr.nombre, tr.variante, tr.parte_id, p.nombre AS parte, x.id AS subsistema_id, x.nombre AS subsistema, s.id AS sistema_id, s.nombre AS sistema,
            tr.accion_id, a.nombre AS accion, tr.area_trabajo_id, ar.nombre AS area, tr.activo
       FROM trabajos tr JOIN partes p ON p.id = tr.parte_id JOIN subsistemas x ON x.id = p.subsistema_id JOIN sistemas s ON s.id = x.sistema_id
       JOIN acciones a ON a.id = tr.accion_id LEFT JOIN areas_trabajo ar ON ar.id = tr.area_trabajo_id WHERE tr.id = ?`,
    [id]
  );
}

async function validarArea(con: Ejecutor, areaId: number | null | undefined): Promise<void> {
  if (!areaId) return;
  const a = await una<{ activo: number }>(con, 'SELECT activo FROM areas_trabajo WHERE id = ?', [areaId]);
  if (!a || a.activo !== 1) throw new ErrorValidacion('El área elegida no existe o está desactivada');
}

export async function crearTrabajo(t: TallerReq, actor: Actor, d: { parte_id: number; accion_id: number; variante?: string | null; area_trabajo_id?: number | null }) {
  const id = await transaccion(t.pool, async (con) => {
    const parte = await una<{ codigo: string; nombre: string; activo: number; sub_codigo: string; sub_nombre: string; sub_activo: number; sis_codigo: string; sis_activo: number }>(
      con,
      `SELECT p.codigo, p.nombre, p.activo, x.codigo AS sub_codigo, x.nombre AS sub_nombre, x.activo AS sub_activo, s.codigo AS sis_codigo, s.activo AS sis_activo
         FROM partes p JOIN subsistemas x ON x.id = p.subsistema_id JOIN sistemas s ON s.id = x.sistema_id WHERE p.id = ? FOR UPDATE`,
      [d.parte_id]
    );
    if (!parte || !parte.activo || !parte.sub_activo || !parte.sis_activo) throw new ErrorValidacion('La parte elegida no existe o está desactivada');
    const accion = await una<{ codigo: string; nombre: string; activo: number }>(con, 'SELECT codigo, nombre, activo FROM acciones WHERE id = ?', [d.accion_id]);
    if (!accion || accion.activo !== 1) throw new ErrorValidacion('La acción elegida no existe o está desactivada');
    await validarArea(con, d.area_trabajo_id);
    const ult = await una<{ n: number | null }>(con, 'SELECT MAX(correlativo) AS n FROM trabajos WHERE parte_id = ? AND accion_id = ?', [d.parte_id, d.accion_id]);
    const correlativo = Number(ult?.n ?? 0) + 1;
    if (correlativo > 99) throw new ErrorApp(409, 'LIMITE', 'Esa parte ya tiene 99 trabajos con esa acción.');
    const variante = normalizarCampo('texto', d.variante);
    const nombre = `${accion.nombre} - ${parte.nombre} - ${parte.sub_nombre}${variante ? ` (${variante})` : ''}`.slice(0, 220);
    const codigo = `${parte.sis_codigo}-${parte.sub_codigo}-${parte.codigo}-${accion.codigo}-${String(correlativo).padStart(2, '0')}`;
    const r = await ejecutar(con, 'INSERT INTO trabajos (parte_id, accion_id, correlativo, codigo, nombre, variante, area_trabajo_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [
      d.parte_id,
      d.accion_id,
      correlativo,
      codigo,
      nombre,
      variante,
      d.area_trabajo_id ?? null,
    ]);
    await bitacora(con, actor, { accion: 'trabajo_creado', entidad: 'trabajos', entidadId: r.insertId, despues: { codigo, nombre } });
    return r.insertId;
  });
  return obtenerTrabajo(t, id);
}

/** Del trabajo solo se cambian la variante, el área y si está activo: la parte y la acción son parte de su código y no cambian. */
export async function actualizarTrabajo(t: TallerReq, actor: Actor, id: number, d: { variante?: string | null; area_trabajo_id?: number | null; activo?: boolean }) {
  await transaccion(t.pool, async (con) => {
    const antes = await una<{ activo: number }>(con, 'SELECT activo FROM trabajos WHERE id = ? FOR UPDATE', [id]);
    if (!antes) throw new ErrorNoEncontrado('No se encontró el trabajo');
    if (d.area_trabajo_id !== undefined) await validarArea(con, d.area_trabajo_id);
    const sets: string[] = [];
    const valores: unknown[] = [];
    if (d.variante !== undefined) {
      sets.push('variante = ?');
      valores.push(normalizarCampo('texto', d.variante));
    }
    if (d.area_trabajo_id !== undefined) {
      sets.push('area_trabajo_id = ?');
      valores.push(d.area_trabajo_id);
    }
    if (d.activo !== undefined) {
      if (d.activo && antes.activo === 0) {
        const padre = await una<{ activo: number; accion_activa: number }>(con, 'SELECT p.activo, a.activo AS accion_activa FROM trabajos tr JOIN partes p ON p.id = tr.parte_id JOIN acciones a ON a.id = tr.accion_id WHERE tr.id = ?', [id]);
        if (!padre?.activo || !padre.accion_activa) throw new ErrorApp(409, 'REGLA', 'Su parte o su acción están desactivadas. Actívelas primero.');
      }
      sets.push('activo = ?');
      valores.push(d.activo ? 1 : 0);
    }
    if (sets.length === 0) return;
    await ejecutar(con, `UPDATE trabajos SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
    if (d.variante !== undefined) await rearmarNombresDeTrabajos(con, 'tr.id', id);
    await bitacora(con, actor, { accion: 'trabajo_editado', entidad: 'trabajos', entidadId: id, despues: d });
  });
  return obtenerTrabajo(t, id);
}

/** Cuando se renombra una acción, los nombres armados de sus trabajos se rearman. */
export async function alRenombrarAccion(t: TallerReq, accionId: number): Promise<void> {
  await rearmarNombresDeTrabajos(t.pool, 'a.id', accionId);
}

// ── Tipos de orden ───────────────────────────────────────────────────────────────────
export async function listarTiposOrden(t: TallerReq, incluirInactivos: boolean) {
  return filas(t.pool, `SELECT id, codigo, nombre, es_default, es_pedido_especial, activo FROM tipos_orden ${incluirInactivos ? '' : 'WHERE activo = 1'} ORDER BY es_default DESC, nombre`);
}

async function obtenerTipoOrden(ejecutor: Ejecutor, id: number) {
  const f = await una<{ id: number; codigo: string; nombre: string; es_default: number; es_pedido_especial: number; activo: number }>(
    ejecutor,
    'SELECT id, codigo, nombre, es_default, es_pedido_especial, activo FROM tipos_orden WHERE id = ?',
    [id]
  );
  if (!f) throw new ErrorNoEncontrado('No se encontró el tipo de orden');
  return f;
}

export async function crearTipoOrden(t: TallerReq, actor: Actor, d: { codigo: string; nombre: string; es_pedido_especial?: boolean }) {
  const codigo = normalizarCampo('codigo', d.codigo) ?? '';
  if (!/^[A-Z]{3}$/.test(codigo)) throw new ErrorValidacion('El código del tipo de orden son 3 letras');
  try {
    const id = await transaccion(t.pool, async (con) => {
      const r = await ejecutar(con, 'INSERT INTO tipos_orden (codigo, nombre, es_pedido_especial) VALUES (?, ?, ?)', [codigo, normalizarCampo('texto', d.nombre), d.es_pedido_especial ? 1 : 0]);
      await bitacora(con, actor, { accion: 'tipo_orden_creado', entidad: 'tipos_orden', entidadId: r.insertId, despues: { ...d, codigo } });
      return r.insertId;
    });
    return await obtenerTipoOrden(t.pool, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya existe un tipo de orden con ese código o nombre');
  }
}

/** El tipo "por defecto" es uno solo y siempre está activo: se cambia marcando otro, no desmarcándolo. */
export async function actualizarTipoOrden(t: TallerReq, actor: Actor, id: number, d: { nombre?: string; es_pedido_especial?: boolean; es_default?: boolean; activo?: boolean }) {
  try {
    await transaccion(t.pool, async (con) => {
      const antes = await obtenerTipoOrden(con, id);
      const sets: string[] = [];
      const valores: unknown[] = [];
      if (d.nombre !== undefined) {
        sets.push('nombre = ?');
        valores.push(normalizarCampo('texto', d.nombre));
      }
      if (d.es_pedido_especial !== undefined) {
        sets.push('es_pedido_especial = ?');
        valores.push(d.es_pedido_especial ? 1 : 0);
      }
      const seraActivo = d.activo ?? antes.activo === 1;
      if (d.es_default === true) {
        if (!seraActivo) throw new ErrorApp(409, 'REGLA', 'El tipo por defecto debe estar activo.');
        await ejecutar(con, 'UPDATE tipos_orden SET es_default = 0 WHERE id <> ?', [id]);
        sets.push('es_default = 1');
      } else if (d.es_default === false && antes.es_default === 1) {
        throw new ErrorApp(409, 'REGLA', 'Para cambiar el tipo por defecto, marque otro como por defecto.');
      }
      if (d.activo !== undefined) {
        if (!d.activo && antes.es_default === 1 && d.es_default !== true) throw new ErrorApp(409, 'REGLA', 'El tipo por defecto no se puede desactivar: marque otro como por defecto primero.');
        sets.push('activo = ?');
        valores.push(d.activo ? 1 : 0);
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE tipos_orden SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      await bitacora(con, actor, { accion: 'tipo_orden_editado', entidad: 'tipos_orden', entidadId: id, antes, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya existe un tipo de orden con ese nombre');
  }
  return obtenerTipoOrden(t.pool, id);
}

// ── Estados de la orden ──────────────────────────────────────────────────────────────
export async function listarEstadosOrden(t: TallerReq, incluirInactivos: boolean) {
  return filas(t.pool, `SELECT id, codigo, nombre, orden, es_inicial, es_terminal, es_cancelado, es_sistema, color, activo FROM estados_orden ${incluirInactivos ? '' : 'WHERE activo = 1'} ORDER BY orden, id`);
}

async function obtenerEstado(ejecutor: Ejecutor, id: number) {
  const f = await una<{ id: number; codigo: string; nombre: string; orden: number; es_inicial: number; es_terminal: number; es_cancelado: number; es_sistema: number; color: string; activo: number }>(
    ejecutor,
    'SELECT id, codigo, nombre, orden, es_inicial, es_terminal, es_cancelado, es_sistema, color, activo FROM estados_orden WHERE id = ?',
    [id]
  );
  if (!f) throw new ErrorNoEncontrado('No se encontró el estado');
  return f;
}

export interface DatosEstado {
  nombre?: string;
  orden?: number;
  color?: string;
  es_terminal?: boolean;
  es_cancelado?: boolean;
  activo?: boolean;
}

/** Un estado que crea el taller elige sus banderas (terminal / cancelado); la lógica solo mira las banderas, nunca el nombre. */
export async function crearEstadoOrden(t: TallerReq, actor: Actor, d: DatosEstado & { codigo: string; nombre: string }) {
  // Los espacios entre palabras pasan a guion bajo (ESPERANDO REPUESTO → ESPERANDO_REPUESTO).
  const codigo = (normalizarCampo('texto', d.codigo) ?? '').replace(/s+/g, '_').replace(/[^A-Z0-9_]/g, '_');
  if (!/^[A-Z][A-Z0-9_]{1,29}$/.test(codigo)) throw new ErrorValidacion('El código del estado debe empezar con una letra y llevar solo letras, números y guion bajo');
  const cancelado = !!d.es_cancelado;
  const terminal = !!d.es_terminal || cancelado; // un estado cancelado siempre es terminal
  try {
    const id = await transaccion(t.pool, async (con) => {
      const r = await ejecutar(con, 'INSERT INTO estados_orden (codigo, nombre, orden, es_terminal, es_cancelado, color) VALUES (?, ?, ?, ?, ?, ?)', [
        codigo,
        normalizarCampo('texto', d.nombre),
        d.orden ?? 100,
        terminal ? 1 : 0,
        cancelado ? 1 : 0,
        d.color ?? '#6B7280',
      ]);
      await bitacora(con, actor, { accion: 'estado_orden_creado', entidad: 'estados_orden', entidadId: r.insertId, despues: { ...d, codigo } });
      return r.insertId;
    });
    return await obtenerEstado(t.pool, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya existe un estado con ese código o nombre');
  }
}

export async function actualizarEstadoOrden(t: TallerReq, actor: Actor, id: number, d: DatosEstado) {
  try {
    await transaccion(t.pool, async (con) => {
      const antes = await obtenerEstado(con, id);
      const sistema = antes.es_sistema === 1;
      if (sistema && (d.es_terminal !== undefined || d.es_cancelado !== undefined)) throw new ErrorApp(409, 'REGLA', 'Los estados de fábrica se pueden renombrar, pero sus banderas no se cambian.');
      if (sistema && d.activo === false) throw new ErrorApp(409, 'REGLA', 'Los estados de fábrica no se desactivan.');
      const sets: string[] = [];
      const valores: unknown[] = [];
      const poner = (col: string, v: unknown): void => {
        sets.push(`${col} = ?`);
        valores.push(v);
      };
      if (d.nombre !== undefined) poner('nombre', normalizarCampo('texto', d.nombre));
      if (d.orden !== undefined) poner('orden', d.orden);
      if (d.color !== undefined) poner('color', d.color);
      if (d.es_cancelado !== undefined || d.es_terminal !== undefined) {
        const cancelado = d.es_cancelado ?? antes.es_cancelado === 1;
        const terminal = (d.es_terminal ?? antes.es_terminal === 1) || cancelado;
        poner('es_cancelado', cancelado ? 1 : 0);
        poner('es_terminal', terminal ? 1 : 0);
      }
      if (d.activo !== undefined) poner('activo', d.activo ? 1 : 0);
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE estados_orden SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      await bitacora(con, actor, { accion: 'estado_orden_editado', entidad: 'estados_orden', entidadId: id, antes, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya existe un estado con ese nombre');
  }
  return obtenerEstado(t.pool, id);
}

// ── Matriz nivel de técnico × sistema ────────────────────────────────────────────────
export async function leerMatriz(t: TallerReq) {
  const niveles = await filas<{ id: number; codigo: string; nombre: string }>(t.pool, 'SELECT id, codigo, nombre FROM niveles_tecnico ORDER BY orden, id');
  const sistemas = await filas<{ id: number; codigo: string; nombre: string }>(t.pool, 'SELECT id, codigo, nombre FROM sistemas WHERE activo = 1 ORDER BY codigo');
  const celdas = await filas<{ nivel_tecnico_id: number; sistema_id: number }>(t.pool, 'SELECT nivel_tecnico_id, sistema_id FROM matriz_tecnico_sistema');
  return { niveles, sistemas, habilitadas: celdas.map((c) => ({ nivel_tecnico_id: c.nivel_tecnico_id, sistema_id: c.sistema_id })) };
}

/** Cambia SOLO las casillas indicadas (no reescribe toda la matriz: dos administradores guardando a la vez no se pisan). */
export async function cambiarMatriz(t: TallerReq, actor: Actor, cambios: Array<{ nivel_tecnico_id: number; sistema_id: number; habilitado: boolean }>): Promise<void> {
  await transaccion(t.pool, async (con) => {
    for (const c of cambios) {
      if (!(await una(con, 'SELECT id FROM niveles_tecnico WHERE id = ?', [c.nivel_tecnico_id])) || !(await una(con, 'SELECT id FROM sistemas WHERE id = ?', [c.sistema_id]))) {
        throw new ErrorValidacion('Un nivel o un sistema de la matriz no existe');
      }
      if (c.habilitado) await ejecutar(con, 'INSERT IGNORE INTO matriz_tecnico_sistema (nivel_tecnico_id, sistema_id) VALUES (?, ?)', [c.nivel_tecnico_id, c.sistema_id]);
      else await ejecutar(con, 'DELETE FROM matriz_tecnico_sistema WHERE nivel_tecnico_id = ? AND sistema_id = ?', [c.nivel_tecnico_id, c.sistema_id]);
    }
    await bitacora(con, actor, { accion: 'matriz_tecnico_sistema_editada', entidad: 'matriz_tecnico_sistema', despues: cambios });
  });
}

/** Un nivel nuevo nace habilitado para todos los sistemas. */
export async function sembrarMatrizDeNivel(t: TallerReq, nivelId: number): Promise<void> {
  await ejecutar(t.pool, 'INSERT IGNORE INTO matriz_tecnico_sistema (nivel_tecnico_id, sistema_id) SELECT ?, id FROM sistemas', [nivelId]);
}
