import { desenlaceDeRespuestas, rojosAnteriores } from './cotizaciones-desenlace';
import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { normalizarCampo } from '../utils/texto';
import { borrarArchivo, guardarArchivo, urlFirmada } from './archivos';
import { Actor, bitacora, TallerReq } from './comun';
import { hoyDelTaller, registrarLecturaEn } from './contadores';
import { registrarServiciosPorChecklist } from './servicios';

/**
 * Checklists (Fase 4d). Reglas que el servidor hace cumplir:
 *  - Las plantillas se VERSIONAN: lo ya completado nunca cambia, porque cada respuesta copia el texto del ítem.
 *  - Un checklist completado queda bloqueado (candado): ni respuestas, ni fotos, ni firma.
 *  - No se puede completar vacío: todos los ítems respondidos; amarillo y rojo piden al menos una foto; la lectura del medidor y la firma
 *    del cliente se exigen en los tipos que las piden.
 *  - El checklist requerido bloquea el cierre de la orden (o el inicio de un trabajo), salvo excepción autorizada con motivo.
 */

export type TipoRespuesta = 'semaforo' | 'si_no' | 'numero' | 'texto' | 'lista';
export const TIPOS_DE_RESPUESTA: TipoRespuesta[] = ['semaforo', 'si_no', 'numero', 'texto', 'lista'];
const MAXIMO_FOTOS_POR_ITEM = 5;

// ── Tipos y plantillas (configuración) ────────────────────────────────────────────────
export interface DatosTipoChecklist {
  codigo?: string;
  nombre?: string;
  descripcion?: string | null;
  etapa_id?: number;
  exige_lectura_contador?: boolean;
  requiere_firma_cliente?: boolean;
  activo?: boolean;
  tipos_equipo_ids?: number[];
}

export async function listarTiposChecklist(t: TallerReq, inactivos = false) {
  const tipos = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT ct.id, ct.codigo, ct.nombre, ct.descripcion, ct.etapa_id, e.nombre AS etapa, e.requiere_orden, ct.exige_lectura_contador, ct.requiere_firma_cliente, ct.activo,
            (SELECT p.version FROM checklist_plantillas p WHERE p.checklist_tipo_id = ct.id AND p.vigente = 1 LIMIT 1) AS version_vigente,
            (SELECT COUNT(*) FROM checklist_items i JOIN checklist_plantillas p ON p.id = i.plantilla_id WHERE p.checklist_tipo_id = ct.id AND p.vigente = 1) AS items
       FROM checklist_tipos ct JOIN etapas e ON e.id = ct.etapa_id ${inactivos ? '' : 'WHERE ct.activo = 1'} ORDER BY e.orden, ct.nombre`
  );
  const aplica = await filas<{ checklist_tipo_id: number; tipo_equipo_id: number }>(t.pool, 'SELECT checklist_tipo_id, tipo_equipo_id FROM checklist_tipo_tipos_equipo');
  return tipos.map((x) => ({ ...x, tipos_equipo_ids: aplica.filter((a) => a.checklist_tipo_id === x['id']).map((a) => a.tipo_equipo_id) }));
}

async function definirAplicabilidad(con: Ejecutor, tipoId: number, ids: number[]): Promise<void> {
  const unicos = [...new Set(ids)];
  if (unicos.length > 0) {
    const f = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM tipos_equipo WHERE id IN (?)', [unicos]);
    if (Number(f?.n) !== unicos.length) throw new ErrorValidacion('Alguno de los tipos de equipo elegidos no existe');
  }
  await ejecutar(con, 'DELETE FROM checklist_tipo_tipos_equipo WHERE checklist_tipo_id = ?', [tipoId]);
  for (const id of unicos) await ejecutar(con, 'INSERT INTO checklist_tipo_tipos_equipo (checklist_tipo_id, tipo_equipo_id) VALUES (?, ?)', [tipoId, id]);
}

export async function crearTipoChecklist(t: TallerReq, actor: Actor, d: DatosTipoChecklist & { codigo: string; nombre: string; etapa_id: number }) {
  const codigo = normalizarCampo('codigo', d.codigo);
  const nombre = normalizarCampo('texto', d.nombre);
  if (!codigo || !/^[A-Z][A-Z0-9_]{1,19}$/.test(codigo)) throw new ErrorValidacion('El código debe empezar con una letra y llevar solo letras, números o guion bajo (hasta 20)');
  if (!nombre) throw new ErrorValidacion('Escriba el nombre del checklist');
  const id = await transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM etapas WHERE id = ? AND activo = 1', [d.etapa_id]))) throw new ErrorValidacion('La etapa elegida no existe o está desactivada');
    try {
      const r = await ejecutar(con, 'INSERT INTO checklist_tipos (codigo, nombre, descripcion, etapa_id, exige_lectura_contador, requiere_firma_cliente) VALUES (?, ?, ?, ?, ?, ?)', [
        codigo, nombre, normalizarCampo('texto', d.descripcion), d.etapa_id, d.exige_lectura_contador ? 1 : 0, d.requiere_firma_cliente ? 1 : 0,
      ]);
      await definirAplicabilidad(con, r.insertId, d.tipos_equipo_ids ?? []);
      await bitacora(con, actor, { accion: 'checklist_tipo_creado', entidad: 'checklist_tipos', entidadId: r.insertId, despues: { codigo, nombre } });
      return r.insertId;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErrorApp(409, 'CONFLICTO', 'Ya existe un checklist con ese código o ese nombre');
      throw error;
    }
  });
  return (await listarTiposChecklist(t, true)).find((x) => (x as Record<string, unknown>)['id'] === id);
}

export async function actualizarTipoChecklist(t: TallerReq, actor: Actor, id: number, d: DatosTipoChecklist) {
  await transaccion(t.pool, async (con) => {
    const actual = await una<{ id: number }>(con, 'SELECT id FROM checklist_tipos WHERE id = ? FOR UPDATE', [id]);
    if (!actual) throw new ErrorNoEncontrado('No se encontró el tipo de checklist');
    if (d.codigo !== undefined) throw new ErrorApp(409, 'REGLA', 'El código de un tipo de checklist no se cambia.');
    const sets: string[] = [];
    const v: unknown[] = [];
    if (d.nombre !== undefined) {
      const nombre = normalizarCampo('texto', d.nombre);
      if (!nombre) throw new ErrorValidacion('Escriba el nombre del checklist');
      sets.push('nombre = ?');
      v.push(nombre);
    }
    if (d.descripcion !== undefined) {
      sets.push('descripcion = ?');
      v.push(normalizarCampo('texto', d.descripcion));
    }
    if (d.etapa_id !== undefined) {
      if (!(await una(con, 'SELECT id FROM etapas WHERE id = ? AND activo = 1', [d.etapa_id]))) throw new ErrorValidacion('La etapa elegida no existe o está desactivada');
      sets.push('etapa_id = ?');
      v.push(d.etapa_id);
    }
    for (const [campo, col] of [['exige_lectura_contador', 'exige_lectura_contador'], ['requiere_firma_cliente', 'requiere_firma_cliente'], ['activo', 'activo']] as const) {
      if (d[campo] !== undefined) {
        sets.push(`${col} = ?`);
        v.push(d[campo] ? 1 : 0);
      }
    }
    try {
      if (sets.length > 0) await ejecutar(con, `UPDATE checklist_tipos SET ${sets.join(', ')} WHERE id = ?`, [...v, id]);
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErrorApp(409, 'CONFLICTO', 'Ya existe un checklist con ese nombre');
      throw error;
    }
    if (d.tipos_equipo_ids !== undefined) await definirAplicabilidad(con, id, d.tipos_equipo_ids);
    await bitacora(con, actor, { accion: 'checklist_tipo_editado', entidad: 'checklist_tipos', entidadId: id, despues: d });
  });
  return (await listarTiposChecklist(t, true)).find((x) => (x as Record<string, unknown>)['id'] === id);
}

export async function obtenerPlantilla(t: TallerReq, tipoId: number, version?: number) {
  const p = await una<{ id: number; version: number; vigente: number }>(
    t.pool,
    `SELECT id, version, vigente FROM checklist_plantillas WHERE checklist_tipo_id = ? AND ${version ? 'version = ?' : 'vigente = 1'} LIMIT 1`,
    version ? [tipoId, version] : [tipoId]
  );
  if (!p) throw new ErrorNoEncontrado('Ese tipo de checklist todavía no tiene plantilla');
  const secciones = await filas<{ id: number; nombre: string }>(t.pool, 'SELECT id, nombre FROM checklist_secciones WHERE plantilla_id = ? ORDER BY orden, id', [p.id]);
  const items = await filas<{ id: number; seccion_id: number; descripcion: string; tipo_respuesta: TipoRespuesta; unidad_id: number | null; minimo: number | null; maximo: number | null }>(
    t.pool,
    'SELECT id, seccion_id, descripcion, tipo_respuesta, unidad_id, minimo, maximo FROM checklist_items WHERE plantilla_id = ? ORDER BY orden, id',
    [p.id]
  );
  const opciones = items.length === 0 ? [] : await filas<{ item_id: number; texto: string }>(t.pool, 'SELECT item_id, texto FROM checklist_item_opciones WHERE item_id IN (?) ORDER BY orden, id', [items.map((i) => i.id)]);
  const versiones = await filas<{ version: number; vigente: number; created_at: Date }>(t.pool, 'SELECT version, vigente, created_at FROM checklist_plantillas WHERE checklist_tipo_id = ? ORDER BY version DESC', [tipoId]);
  return {
    version: p.version,
    vigente: p.vigente === 1,
    versiones,
    secciones: secciones.map((s) => ({
      id: s.id,
      nombre: s.nombre,
      items: items.filter((i) => i.seccion_id === s.id).map((i) => ({ id: i.id, descripcion: i.descripcion, tipo_respuesta: i.tipo_respuesta, unidad_id: i.unidad_id, minimo: i.minimo === null ? null : Number(i.minimo), maximo: i.maximo === null ? null : Number(i.maximo), opciones: opciones.filter((o) => o.item_id === i.id).map((o) => o.texto) })),
    })),
  };
}

export interface DatosPlantilla {
  secciones: Array<{ nombre: string; items: Array<{ descripcion: string; tipo_respuesta: TipoRespuesta; unidad_id?: number | null; minimo?: number | null; maximo?: number | null; opciones?: string[] }> }>;
}

/** Guarda la plantilla como una VERSIÓN NUEVA y la deja vigente: los checklists ya abiertos o completados siguen con la suya. */
export async function guardarPlantilla(t: TallerReq, actor: Actor, tipoId: number, d: DatosPlantilla) {
  if (d.secciones.length === 0 || d.secciones.length > 30) throw new ErrorValidacion('La plantilla necesita entre 1 y 30 secciones');
  await transaccion(t.pool, async (con) => {
    const tipo = await una<{ id: number }>(con, 'SELECT id FROM checklist_tipos WHERE id = ? FOR UPDATE', [tipoId]);
    if (!tipo) throw new ErrorNoEncontrado('No se encontró el tipo de checklist');
    const v = await una<{ v: number | null }>(con, 'SELECT MAX(version) AS v FROM checklist_plantillas WHERE checklist_tipo_id = ?', [tipoId]);
    const version = Number(v?.v ?? 0) + 1;
    await ejecutar(con, 'UPDATE checklist_plantillas SET vigente = 0 WHERE checklist_tipo_id = ?', [tipoId]);
    const p = await ejecutar(con, 'INSERT INTO checklist_plantillas (checklist_tipo_id, version, vigente, creada_por_id) VALUES (?, ?, 1, ?)', [tipoId, version, actor.usuarioId]);
    let ordenSeccion = 0;
    for (const s of d.secciones) {
      const nombre = normalizarCampo('texto', s.nombre);
      if (!nombre) throw new ErrorValidacion('Cada sección necesita un nombre');
      if (s.items.length === 0) throw new ErrorValidacion(`La sección «${nombre}» no tiene ítems`);
      const sec = await ejecutar(con, 'INSERT INTO checklist_secciones (plantilla_id, nombre, orden) VALUES (?, ?, ?)', [p.insertId, nombre.slice(0, 100), ++ordenSeccion]);
      let ordenItem = 0;
      for (const i of s.items) {
        const descripcion = normalizarCampo('texto', i.descripcion);
        if (!descripcion) throw new ErrorValidacion(`Un ítem de «${nombre}» no tiene descripción`);
        if (!TIPOS_DE_RESPUESTA.includes(i.tipo_respuesta)) throw new ErrorValidacion('El tipo de respuesta no es válido');
        const opciones = (i.opciones ?? []).map((o) => normalizarCampo('texto', o)).filter((o): o is string => !!o);
        if (i.tipo_respuesta === 'lista' && new Set(opciones).size < 2) throw new ErrorValidacion(`El ítem «${descripcion}» es de lista y necesita al menos dos opciones distintas`);
        if (i.minimo != null && i.maximo != null && i.minimo > i.maximo) throw new ErrorValidacion(`En «${descripcion}» el mínimo es mayor que el máximo`);
        if (i.unidad_id && !(await una(con, 'SELECT id FROM unidades WHERE id = ?', [i.unidad_id]))) throw new ErrorValidacion('La unidad elegida no existe');
        const it = await ejecutar(con, 'INSERT INTO checklist_items (plantilla_id, seccion_id, orden, descripcion, tipo_respuesta, unidad_id, minimo, maximo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
          p.insertId, sec.insertId, ++ordenItem, descripcion.slice(0, 250), i.tipo_respuesta, i.tipo_respuesta === 'numero' ? i.unidad_id ?? null : null, i.tipo_respuesta === 'numero' ? i.minimo ?? null : null, i.tipo_respuesta === 'numero' ? i.maximo ?? null : null,
        ]);
        if (i.tipo_respuesta === 'lista') {
          let o = 0;
          for (const texto of [...new Set(opciones)]) await ejecutar(con, 'INSERT INTO checklist_item_opciones (item_id, texto, orden) VALUES (?, ?, ?)', [it.insertId, texto.slice(0, 100), ++o]);
        }
      }
    }
    await bitacora(con, actor, { accion: 'checklist_plantilla_guardada', entidad: 'checklist_tipos', entidadId: tipoId, despues: { version } });
  });
  return obtenerPlantilla(t, tipoId);
}

// ── Requisitos por tipo de orden ──────────────────────────────────────────────────────
export async function listarRequisitos(t: TallerReq) {
  return filas<{ tipo_orden_id: number; checklist_tipo_id: number; momento: string; accion: string; checklist: string; tipo_orden: string }>(
    t.pool,
    `SELECT r.tipo_orden_id, tor.nombre AS tipo_orden, r.checklist_tipo_id, ct.nombre AS checklist, r.momento, r.accion
       FROM checklists_requeridos r JOIN tipos_orden tor ON tor.id = r.tipo_orden_id JOIN checklist_tipos ct ON ct.id = r.checklist_tipo_id ORDER BY tor.nombre, ct.nombre, r.momento`
  );
}

export async function definirRequisitos(t: TallerReq, actor: Actor, tipoOrdenId: number, lista: Array<{ checklist_tipo_id: number; momento: 'antes_de_iniciar' | 'antes_de_terminar'; accion: 'bloquear' | 'avisar' }>) {
  await transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM tipos_orden WHERE id = ?', [tipoOrdenId]))) throw new ErrorNoEncontrado('No se encontró el tipo de orden');
    const claves = new Set<string>();
    for (const r of lista) {
      const k = `${r.checklist_tipo_id}:${r.momento}`;
      if (claves.has(k)) throw new ErrorValidacion('Un mismo checklist no puede repetirse en el mismo momento');
      claves.add(k);
      const ct = await una<{ activo: number; requiere_orden: number }>(con, 'SELECT ct.activo, e.requiere_orden FROM checklist_tipos ct JOIN etapas e ON e.id = ct.etapa_id WHERE ct.id = ?', [r.checklist_tipo_id]);
      if (!ct || ct.activo !== 1) throw new ErrorValidacion('Uno de los checklists elegidos no existe o está desactivado');
      if (ct.requiere_orden !== 1) throw new ErrorValidacion('Un checklist de operación no depende de una orden: no se puede pedir en una orden');
    }
    await ejecutar(con, 'DELETE FROM checklists_requeridos WHERE tipo_orden_id = ?', [tipoOrdenId]);
    for (const r of lista) await ejecutar(con, 'INSERT INTO checklists_requeridos (tipo_orden_id, checklist_tipo_id, momento, accion) VALUES (?, ?, ?, ?)', [tipoOrdenId, r.checklist_tipo_id, r.momento, r.accion]);
    await bitacora(con, actor, { accion: 'checklists_requeridos_definidos', entidad: 'tipos_orden', entidadId: tipoOrdenId, despues: lista });
  });
  return listarRequisitos(t);
}

/**
 * ¿Qué checklists requeridos faltan en esta orden para este momento? (Un tipo que no aplica al tipo de equipo de la orden no se exige.)
 * Devuelve los que bloquean y los que solo avisan.
 */
export async function checklistsPendientes(con: Ejecutor, ordenId: number, momento: 'antes_de_iniciar' | 'antes_de_terminar'): Promise<{ bloquean: string[]; avisan: string[] }> {
  const faltan = await filas<{ nombre: string; accion: 'bloquear' | 'avisar' }>(
    con,
    `SELECT ct.nombre, r.accion FROM ordenes o JOIN equipos e ON e.id = o.equipo_id JOIN checklists_requeridos r ON r.tipo_orden_id = o.tipo_orden_id AND r.momento = ?
       JOIN checklist_tipos ct ON ct.id = r.checklist_tipo_id AND ct.activo = 1
      WHERE o.id = ?
        AND (NOT EXISTS (SELECT 1 FROM checklist_tipo_tipos_equipo a WHERE a.checklist_tipo_id = ct.id) OR EXISTS (SELECT 1 FROM checklist_tipo_tipos_equipo a WHERE a.checklist_tipo_id = ct.id AND a.tipo_equipo_id = e.tipo_equipo_id))
        AND NOT EXISTS (SELECT 1 FROM checklists c WHERE c.orden_id = o.id AND c.tipo_id = ct.id AND c.estado = 'completado')
      ORDER BY ct.nombre`,
    [momento, ordenId]
  );
  return { bloquean: faltan.filter((f) => f.accion === 'bloquear').map((f) => f.nombre), avisan: faltan.filter((f) => f.accion === 'avisar').map((f) => f.nombre) };
}

// ── Abrir y llenar un checklist ───────────────────────────────────────────────────────
async function checklistCrudo(con: Ejecutor, id: number, bloquear = false) {
  const c = await una<{ id: number; tipo_id: number; orden_id: number | null; equipo_id: number; estado: 'pendiente' | 'en_progreso' | 'completado'; exige_lectura: number; requiere_firma: number; tipo_nombre: string }>(
    con,
    `SELECT c.id, c.tipo_id, c.orden_id, c.equipo_id, c.estado, ct.exige_lectura_contador AS exige_lectura, ct.requiere_firma_cliente AS requiere_firma, ct.nombre AS tipo_nombre
       FROM checklists c JOIN checklist_tipos ct ON ct.id = c.tipo_id WHERE c.id = ? ${bloquear ? 'FOR UPDATE' : ''}`,
    [id]
  );
  if (!c) throw new ErrorNoEncontrado('No se encontró el checklist');
  return c;
}

function exigirEditable(c: { estado: string }): void {
  if (c.estado === 'completado') throw new ErrorApp(409, 'CHECKLIST_COMPLETADO', 'Este checklist ya está completado y quedó bloqueado: no se puede cambiar.');
}

export async function crearChecklist(ctx: Contexto, t: TallerReq, actor: Actor, d: { tipo_id: number; orden_id?: number; equipo_id?: number }) {
  const id = await transaccion(t.pool, async (con) => {
    const tipo = await una<{ id: number; activo: number; requiere_orden: number; nombre: string }>(con, 'SELECT ct.id, ct.activo, e.requiere_orden, ct.nombre FROM checklist_tipos ct JOIN etapas e ON e.id = ct.etapa_id WHERE ct.id = ?', [d.tipo_id]);
    if (!tipo || tipo.activo !== 1) throw new ErrorValidacion('El tipo de checklist elegido no existe o está desactivado');
    let equipoId = d.equipo_id ?? 0;
    if (d.orden_id) {
      const o = await una<{ equipo_id: number; es_terminal: number; numero: string }>(con, 'SELECT o.equipo_id, es.es_terminal, o.numero FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id WHERE o.id = ? FOR UPDATE', [d.orden_id]);
      if (!o) throw new ErrorValidacion('La orden elegida no existe');
      if (o.es_terminal === 1) throw new ErrorApp(409, 'ORDEN_CERRADA', `La orden ${o.numero} está cerrada o anulada: ya no se le agregan checklists.`);
      equipoId = o.equipo_id;
    } else {
      if (tipo.requiere_orden === 1) throw new ErrorValidacion(`El checklist «${tipo.nombre}» se llena dentro de una orden de trabajo`);
      if (!equipoId) throw new ErrorValidacion('Elija el equipo');
    }
    const eq = await una<{ tipo_equipo_id: number; estado: string }>(con, 'SELECT tipo_equipo_id, estado FROM equipos WHERE id = ?', [equipoId]);
    if (!eq) throw new ErrorValidacion('El equipo elegido no existe');
    if (eq.estado === 'baja') throw new ErrorApp(409, 'REGLA', 'El equipo está dado de baja.');
    const aplica = await una<{ total: number; este: number | null }>(con, 'SELECT COUNT(*) AS total, SUM(tipo_equipo_id = ?) AS este FROM checklist_tipo_tipos_equipo WHERE checklist_tipo_id = ?', [eq.tipo_equipo_id, d.tipo_id]);
    if (Number(aplica?.total) > 0 && Number(aplica?.este ?? 0) === 0) throw new ErrorApp(409, 'REGLA', `El checklist «${tipo.nombre}» no aplica a este tipo de equipo.`);
    const p = await una<{ id: number }>(con, 'SELECT id FROM checklist_plantillas WHERE checklist_tipo_id = ? AND vigente = 1', [d.tipo_id]);
    if (!p) throw new ErrorApp(409, 'REGLA', `El checklist «${tipo.nombre}» todavía no tiene plantilla.`);
    let nuevo: number;
    try {
      const r = await ejecutar(con, 'INSERT INTO checklists (tipo_id, plantilla_id, orden_id, equipo_id, creado_por_id) VALUES (?, ?, ?, ?, ?)', [d.tipo_id, p.id, d.orden_id ?? null, equipoId, actor.usuarioId]);
      nuevo = r.insertId;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') {
        const abierto = await una<{ id: number }>(con, "SELECT id FROM checklists WHERE orden_id = ? AND tipo_id = ? AND estado <> 'completado' LIMIT 1", [d.orden_id ?? 0, d.tipo_id]);
        throw new ErrorApp(409, 'YA_ABIERTO', `Esta orden ya tiene abierto un checklist «${tipo.nombre}»: termínelo antes de abrir otro.`, { checklist_id: abierto?.id });
      }
      throw error;
    }
    // Las respuestas COPIAN el texto de la plantilla de este momento.
    await ejecutar(
      con,
      `INSERT INTO checklist_respuestas (checklist_id, item_id, orden, seccion, descripcion, tipo_respuesta, minimo, maximo)
       SELECT ?, i.id, (s.orden * 1000 + i.orden), s.nombre, i.descripcion, i.tipo_respuesta, i.minimo, i.maximo FROM checklist_items i JOIN checklist_secciones s ON s.id = i.seccion_id WHERE i.plantilla_id = ? ORDER BY s.orden, i.orden`,
      [nuevo, p.id]
    );
    await bitacora(con, actor, { accion: 'checklist_creado', entidad: 'checklists', entidadId: nuevo, despues: { tipo_id: d.tipo_id, orden_id: d.orden_id ?? null, equipo_id: equipoId } });
    return nuevo;
  });
  return obtenerChecklist(ctx, t, id);
}

export async function obtenerChecklist(ctx: Contexto, t: TallerReq, id: number) {
  const c = await una<Record<string, unknown>>(
    t.pool,
    `SELECT c.id, c.tipo_id, ct.codigo AS tipo_codigo, ct.nombre AS tipo, ct.exige_lectura_contador, ct.requiere_firma_cliente, c.orden_id, o.numero AS orden_numero, c.equipo_id, c.estado, c.completado_en,
            co.nombre_completo AS completado_por, c.excepcion_motivo_id, p.version, c.created_at
       FROM checklists c JOIN checklist_tipos ct ON ct.id = c.tipo_id JOIN checklist_plantillas p ON p.id = c.plantilla_id LEFT JOIN ordenes o ON o.id = c.orden_id
       LEFT JOIN usuarios u ON u.id = c.completado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE c.id = ?`,
    [id]
  );
  if (!c) throw new ErrorNoEncontrado('No se encontró el checklist');
  const respuestas = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT r.id, r.item_id, r.seccion, r.descripcion, r.tipo_respuesta, r.minimo, r.maximo, r.semaforo, r.si_no, r.valor_numero, r.valor_texto, r.opcion_texto, r.nota, r.respondido_en
       FROM checklist_respuestas r WHERE r.checklist_id = ? ORDER BY r.orden, r.id`,
    [id]
  );
  const fotos = await filas<{ id: number; respuesta_id: number; archivo_id: number }>(t.pool, 'SELECT f.id, f.respuesta_id, f.archivo_id FROM checklist_fotos f JOIN checklist_respuestas r ON r.id = f.respuesta_id WHERE r.checklist_id = ? ORDER BY f.orden, f.id', [id]);
  const itemIds = respuestas.map((r) => Number(r['item_id']));
  const opciones = itemIds.length === 0 ? [] : await filas<{ item_id: number; texto: string }>(t.pool, 'SELECT item_id, texto FROM checklist_item_opciones WHERE item_id IN (?) ORDER BY orden, id', [itemIds]);
  const firma = await una<{ firmante_nombre: string; archivo_id: number; firmado_en: Date }>(t.pool, 'SELECT firmante_nombre, archivo_id, firmado_en FROM firmas WHERE checklist_id = ?', [id]);
  const respondidas = respuestas.filter((r) => hayRespuesta(r as unknown as FilaRespuesta)).length;
  const rojosIds = respuestas.filter((r) => r['semaforo'] === 'rojo').map((r) => Number(r['id']));
  const desenlaces = await desenlaceDeRespuestas(t.pool, rojosIds);
  const anteriores = c['estado'] === 'completado' ? [] : await rojosAnteriores(t.pool, Number(c['equipo_id']), Number(c['tipo_id']), id);
  return {
    ...c,
    exige_lectura_contador: c['exige_lectura_contador'] === 1,
    requiere_firma_cliente: c['requiere_firma_cliente'] === 1,
    total: respuestas.length,
    respondidas,
    respuestas: respuestas.map((r) => ({
      ...r,
      opciones: opciones.filter((o) => o.item_id === r['item_id']).map((o) => o.texto),
      fotos: fotos.filter((f) => f.respuesta_id === r['id']).map((f) => ({ id: f.id, url: urlFirmada(ctx, t.empresa.slug, f.archivo_id) })),
      ...(r['semaforo'] === 'rojo' ? { desenlace: desenlaces.get(Number(r['id'])) } : {}),
    })),
    rojos_anteriores: anteriores,
    firma: firma ? { firmante_nombre: firma.firmante_nombre, firmado_en: firma.firmado_en, url: urlFirmada(ctx, t.empresa.slug, firma.archivo_id) } : null,
  };
}

export async function listarChecklistsDeOrden(t: TallerReq, ordenId: number) {
  return filas<Record<string, unknown>>(
    t.pool,
    `SELECT c.id, c.tipo_id, ct.nombre AS tipo, c.estado, c.completado_en,
            (SELECT COUNT(*) FROM checklist_respuestas r WHERE r.checklist_id = c.id) AS total,
            (SELECT COUNT(*) FROM checklist_respuestas r WHERE r.checklist_id = c.id AND (r.semaforo IS NOT NULL OR r.si_no IS NOT NULL OR r.valor_numero IS NOT NULL OR r.valor_texto IS NOT NULL OR r.opcion_texto IS NOT NULL)) AS respondidas
       FROM checklists c JOIN checklist_tipos ct ON ct.id = c.tipo_id WHERE c.orden_id = ? ORDER BY c.id`,
    [ordenId]
  );
}

export async function listarChecklistsDeEquipo(t: TallerReq, equipoId: number) {
  return filas<Record<string, unknown>>(
    t.pool,
    `SELECT c.id, ct.nombre AS tipo, c.estado, c.completado_en, o.numero AS orden_numero FROM checklists c JOIN checklist_tipos ct ON ct.id = c.tipo_id LEFT JOIN ordenes o ON o.id = c.orden_id WHERE c.equipo_id = ? ORDER BY c.id DESC LIMIT 100`,
    [equipoId]
  );
}

interface FilaRespuesta {
  tipo_respuesta: TipoRespuesta;
  semaforo: string | null;
  si_no: number | null;
  valor_numero: number | null;
  valor_texto: string | null;
  opcion_texto: string | null;
}
function hayRespuesta(r: FilaRespuesta): boolean {
  switch (r.tipo_respuesta) {
    case 'semaforo': return r.semaforo !== null;
    case 'si_no': return r.si_no !== null;
    case 'numero': return r.valor_numero !== null;
    case 'texto': return r.valor_texto !== null && r.valor_texto !== '';
    case 'lista': return r.opcion_texto !== null;
  }
}

export interface DatosRespuesta {
  semaforo?: 'verde' | 'amarillo' | 'rojo';
  si_no?: boolean;
  valor_numero?: number;
  valor_texto?: string;
  opcion?: string;
  nota?: string | null;
}

export async function responder(ctx: Contexto, t: TallerReq, actor: Actor, checklistId: number, respuestaId: number, d: DatosRespuesta): Promise<void> {
  await transaccion(t.pool, async (con) => {
    const c = await checklistCrudo(con, checklistId, true);
    exigirEditable(c);
    const r = await una<{ id: number; item_id: number; tipo_respuesta: TipoRespuesta; minimo: number | null; maximo: number | null; descripcion: string }>(con, 'SELECT id, item_id, tipo_respuesta, minimo, maximo, descripcion FROM checklist_respuestas WHERE id = ? AND checklist_id = ?', [respuestaId, checklistId]);
    if (!r) throw new ErrorNoEncontrado('No se encontró ese ítem en el checklist');
    const sets: string[] = ['respondido_por_id = ?', 'respondido_en = ?'];
    const v: unknown[] = [actor.usuarioId, ahoraDe(ctx)];
    const falta = new ErrorValidacion(`Falta la respuesta de «${r.descripcion}»`);
    switch (r.tipo_respuesta) {
      case 'semaforo':
        if (!d.semaforo) throw falta;
        sets.push('semaforo = ?');
        v.push(d.semaforo);
        break;
      case 'si_no':
        if (d.si_no === undefined) throw falta;
        sets.push('si_no = ?');
        v.push(d.si_no ? 1 : 0);
        break;
      case 'numero':
        if (d.valor_numero === undefined || !Number.isFinite(d.valor_numero)) throw falta;
        if (r.minimo !== null && d.valor_numero < Number(r.minimo)) throw new ErrorValidacion(`«${r.descripcion}» no puede ser menor que ${Number(r.minimo)}`);
        if (r.maximo !== null && d.valor_numero > Number(r.maximo)) throw new ErrorValidacion(`«${r.descripcion}» no puede ser mayor que ${Number(r.maximo)}`);
        sets.push('valor_numero = ?');
        v.push(d.valor_numero);
        break;
      case 'texto': {
        const txt = normalizarCampo('multilinea', d.valor_texto);
        if (!txt) throw falta;
        sets.push('valor_texto = ?');
        v.push(txt.slice(0, 500));
        break;
      }
      case 'lista': {
        const op = await una<{ id: number }>(con, 'SELECT id FROM checklist_item_opciones WHERE item_id = ? AND texto = ?', [r.item_id, normalizarCampo('texto', d.opcion) ?? '']);
        if (!op) throw new ErrorValidacion(`Elija una de las opciones de «${r.descripcion}»`);
        sets.push('opcion_texto = ?');
        v.push(normalizarCampo('texto', d.opcion));
        break;
      }
    }
    if (d.nota !== undefined) {
      sets.push('nota = ?');
      v.push(normalizarCampo('texto', d.nota)?.slice(0, 300) ?? null);
    }
    await ejecutar(con, `UPDATE checklist_respuestas SET ${sets.join(', ')} WHERE id = ?`, [...v, respuestaId]);
    if (c.estado === 'pendiente') await ejecutar(con, "UPDATE checklists SET estado = 'en_progreso' WHERE id = ?", [checklistId]);
  });
}

export async function agregarFotoRespuesta(ctx: Contexto, t: TallerReq, actor: Actor, checklistId: number, respuestaId: number, entrada: { buffer: Buffer; mime: string; nombre: string }): Promise<void> {
  await transaccion(t.pool, async (con) => {
    exigirEditable(await checklistCrudo(con, checklistId, true));
    if (!(await una(con, 'SELECT id FROM checklist_respuestas WHERE id = ? AND checklist_id = ?', [respuestaId, checklistId]))) throw new ErrorNoEncontrado('No se encontró ese ítem en el checklist');
    const n = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM checklist_fotos WHERE respuesta_id = ?', [respuestaId]);
    if (Number(n?.n) >= MAXIMO_FOTOS_POR_ITEM) throw new ErrorApp(409, 'REGLA', `Cada ítem admite hasta ${MAXIMO_FOTOS_POR_ITEM} fotos.`);
    if (!entrada.mime.startsWith('image/')) throw new ErrorValidacion('Aquí solo se aceptan fotos (JPG, PNG o WEBP).');
    const archivo = await guardarArchivo(ctx, t, con, actor, entrada);
    await ejecutar(con, 'INSERT INTO checklist_fotos (respuesta_id, archivo_id, orden) VALUES (?, ?, ?)', [respuestaId, archivo.id, Number(n?.n) + 1]);
  });
}

export async function quitarFotoRespuesta(ctx: Contexto, t: TallerReq, checklistId: number, fotoId: number): Promise<void> {
  await transaccion(t.pool, async (con) => {
    exigirEditable(await checklistCrudo(con, checklistId, true));
    const f = await una<{ archivo_id: number }>(con, 'SELECT f.archivo_id FROM checklist_fotos f JOIN checklist_respuestas r ON r.id = f.respuesta_id WHERE f.id = ? AND r.checklist_id = ?', [fotoId, checklistId]);
    if (!f) throw new ErrorNoEncontrado('No se encontró la foto');
    await ejecutar(con, 'DELETE FROM checklist_fotos WHERE id = ?', [fotoId]);
    await borrarArchivo(ctx, t, con, f.archivo_id);
  });
}

export async function registrarFirma(ctx: Contexto, t: TallerReq, actor: Actor, checklistId: number, d: { nombre: string; buffer: Buffer; dispositivo?: string }): Promise<void> {
  const nombre = normalizarCampo('texto', d.nombre);
  if (!nombre || nombre.length < 3) throw new ErrorValidacion('Escriba el nombre completo de quien firma');
  await transaccion(t.pool, async (con) => {
    const c = await checklistCrudo(con, checklistId, true);
    exigirEditable(c);
    if (c.requiere_firma !== 1) throw new ErrorApp(409, 'REGLA', 'Este tipo de checklist no lleva firma del cliente.');
    const previa = await una<{ archivo_id: number }>(con, 'SELECT archivo_id FROM firmas WHERE checklist_id = ?', [checklistId]);
    const archivo = await guardarArchivo(ctx, t, con, actor, { buffer: d.buffer, mime: 'image/png', nombre: 'firma.png' });
    if (previa) {
      await ejecutar(con, 'DELETE FROM firmas WHERE checklist_id = ?', [checklistId]);
      await borrarArchivo(ctx, t, con, previa.archivo_id);
    }
    await ejecutar(con, 'INSERT INTO firmas (checklist_id, firmante_nombre, archivo_id, firmado_en, dispositivo) VALUES (?, ?, ?, ?, ?)', [checklistId, nombre.slice(0, 120), archivo.id, ahoraDe(ctx), d.dispositivo?.slice(0, 200) ?? null]);
    await bitacora(con, actor, { accion: 'checklist_firmado', entidad: 'checklists', entidadId: checklistId, despues: { firmante: nombre } });
  });
}

/** Completa el checklist (queda bloqueado). Si falta algo, dice TODO lo que falta de una vez. */
export async function completarChecklist(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { lectura?: { contador_id: number; valor: number } }): Promise<void> {
  await transaccion(t.pool, async (con) => {
    const c = await checklistCrudo(con, id, true);
    exigirEditable(c);
    const resp = await filas<FilaRespuesta & { id: number; descripcion: string; fotos: number }>(
      con,
      `SELECT r.id, r.descripcion, r.tipo_respuesta, r.semaforo, r.si_no, r.valor_numero, r.valor_texto, r.opcion_texto, (SELECT COUNT(*) FROM checklist_fotos f WHERE f.respuesta_id = r.id) AS fotos
         FROM checklist_respuestas r WHERE r.checklist_id = ? ORDER BY r.orden, r.id`,
      [id]
    );
    const faltas: string[] = [];
    if (resp.length === 0) faltas.push('El checklist no tiene ítems');
    const sinResponder = resp.filter((r) => !hayRespuesta(r));
    if (sinResponder.length > 0) faltas.push(`Faltan ${sinResponder.length} ítems por responder`);
    const sinFoto = resp.filter((r) => (r.semaforo === 'amarillo' || r.semaforo === 'rojo') && Number(r.fotos) === 0);
    if (sinFoto.length > 0) faltas.push(`${sinFoto.length === 1 ? 'Un ítem en amarillo o rojo necesita' : `${sinFoto.length} ítems en amarillo o rojo necesitan`} al menos una foto`);
    let lecturaId: number | null = null;
    if (c.exige_lectura === 1 && c.orden_id) {
      const ya = await una<{ id: number }>(con, "SELECT id FROM lecturas_contador WHERE orden_id = ? AND estado <> 'anulada' ORDER BY id DESC LIMIT 1", [c.orden_id]);
      if (ya) lecturaId = ya.id;
      else if (!d.lectura) faltas.push('Este checklist exige la lectura del medidor: anótela al completarlo');
    } else if (c.exige_lectura === 1 && !d.lectura) faltas.push('Este checklist exige la lectura del medidor: anótela al completarlo');
    if (c.requiere_firma === 1 && !(await una(con, 'SELECT id FROM firmas WHERE checklist_id = ?', [id]))) faltas.push('Falta la firma del cliente');
    if (faltas.length > 0) throw new ErrorApp(409, 'CHECKLIST_INCOMPLETO', `No se puede completar «${c.tipo_nombre}». ${faltas.join('. ')}.`, { faltas });

    if (!lecturaId && d.lectura) {
      const m = await una<{ equipo_id: number }>(con, 'SELECT equipo_id FROM contadores WHERE id = ?', [d.lectura.contador_id]);
      if (!m || m.equipo_id !== c.equipo_id) throw new ErrorValidacion('El contador elegido no es de este equipo');
      lecturaId = await registrarLecturaEn(ctx, t, con, actor, d.lectura.contador_id, { valor: d.lectura.valor, fecha: hoyDelTaller(ctx, t), origen: 'checklist', orden_id: c.orden_id });
    }
    await ejecutar(con, "UPDATE checklists SET estado = 'completado', completado_en = ?, completado_por_id = ?, lectura_contador_id = ? WHERE id = ?", [ahoraDe(ctx), actor.usuarioId, lecturaId, id]);
    await bitacora(con, actor, { accion: 'checklist_completado', entidad: 'checklists', entidadId: id });
    await registrarServiciosPorChecklist(ctx, t, con, actor, { checklist_id: id, tipo_id: c.tipo_id, orden_id: c.orden_id, equipo_id: c.equipo_id });
  });
}
