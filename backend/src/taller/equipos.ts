import crypto from 'node:crypto';
import { PoolConnection } from 'mysql2/promise';
import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { validarFechaRazonable } from '../utils/fechas';
import { normalizarCampo } from '../utils/texto';
import { borrarArchivo, guardarArchivo, urlFirmada } from './archivos';
import { Actor, bitacora, conflictoSiDuplicado, TallerReq } from './comun';
import { crearContadorEn, hoyDelTaller, listarContadores } from './contadores';

/** Órdenes de trabajo de un equipo: cuántas siguen abiertas y cuántas tiene en total (anuladas incluidas). */
export async function ordenesDeEquipo(con: Ejecutor, equipoId: number): Promise<{ abiertas: number; total: number }> {
  const f = await una<{ total: number; abiertas: number | null }>(
    con,
    'SELECT COUNT(*) AS total, SUM(es.es_terminal = 0) AS abiertas FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id WHERE o.equipo_id = ?',
    [equipoId]
  );
  return { abiertas: Number(f?.abiertas ?? 0), total: Number(f?.total ?? 0) };
}

// ── Tipos de equipo ──────────────────────────────────────────────────────────────────
export interface DatosTipoEquipo {
  codigo?: string;
  nombre?: string;
  es_vehiculo?: boolean;
  usa_combustible?: boolean;
  tarifa_venta_hora?: number;
  costo_hora?: number;
  tolerancia_dias?: number;
  tolerancia_contador?: number;
  tiene_componentes?: boolean;
  activo?: boolean;
}

const COLUMNAS_TIPO = `te.id, te.codigo, te.nombre, te.es_vehiculo, te.usa_combustible, te.tarifa_venta_hora, te.costo_hora, te.tolerancia_dias, te.tolerancia_contador, te.tiene_componentes, te.activo`;

export async function listarTiposEquipo(t: TallerReq, inactivos: boolean) {
  return filas(
    t.pool,
    `SELECT ${COLUMNAS_TIPO},
            (SELECT COUNT(*) FROM equipos e WHERE e.tipo_equipo_id = te.id AND e.estado <> 'baja') AS equipos
       FROM tipos_equipo te ${inactivos ? '' : 'WHERE te.activo = 1'} ORDER BY te.nombre`
  );
}

export async function obtenerTipoEquipo(ejecutor: Ejecutor, id: number) {
  const tipo = await una(ejecutor, `SELECT ${COLUMNAS_TIPO} FROM tipos_equipo te WHERE te.id = ?`, [id]);
  if (!tipo) throw new ErrorNoEncontrado('No se encontró el tipo de equipo');
  const documentos = await filas(
    ejecutor,
    `SELECT d.tipo_documento_id, td.nombre, td.requiere_vencimiento, d.obligatorio FROM tipo_equipo_documentos d JOIN tipos_documento td ON td.id = d.tipo_documento_id WHERE d.tipo_equipo_id = ? ORDER BY td.nombre`,
    [id]
  );
  const componentes = await filas(
    ejecutor,
    `SELECT c.id, c.nombre, c.tipo_contador_id, tc.nombre AS tipo_contador FROM tipo_equipo_componentes c LEFT JOIN tipos_contador tc ON tc.id = c.tipo_contador_id WHERE c.tipo_equipo_id = ? ORDER BY c.nombre`,
    [id]
  );
  return { ...tipo, documentos, componentes };
}

function validarTarifas(d: DatosTipoEquipo): void {
  for (const [nombre, v] of [['tarifa de venta por hora', d.tarifa_venta_hora], ['costo por hora', d.costo_hora]] as const) {
    if (v !== undefined && (v < 0 || v > 1_000_000)) throw new ErrorValidacion(`La ${nombre} no es válida`);
  }
}

export async function crearTipoEquipo(t: TallerReq, actor: Actor, d: DatosTipoEquipo & { codigo: string; nombre: string }) {
  const codigo = normalizarCampo('codigo', d.codigo) ?? '';
  if (!/^[A-Z][A-Z0-9_]{1,19}$/.test(codigo)) throw new ErrorValidacion('El código del tipo de equipo debe empezar con una letra y llevar solo letras, números y guion bajo');
  validarTarifas(d);
  try {
    const id = await transaccion(t.pool, async (con) => {
      const r = await ejecutar(
        con,
        'INSERT INTO tipos_equipo (codigo, nombre, es_vehiculo, usa_combustible, tarifa_venta_hora, costo_hora, tolerancia_dias, tolerancia_contador, tiene_componentes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [codigo, normalizarCampo('texto', d.nombre), d.es_vehiculo ? 1 : 0, d.usa_combustible ? 1 : 0, d.tarifa_venta_hora ?? 0, d.costo_hora ?? 0, d.tolerancia_dias ?? 0, d.tolerancia_contador ?? 0, d.tiene_componentes ? 1 : 0]
      );
      await bitacora(con, actor, { accion: 'tipo_equipo_creado', entidad: 'tipos_equipo', entidadId: r.insertId, despues: { ...d, codigo } });
      return r.insertId;
    });
    return await obtenerTipoEquipo(t.pool, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya existe un tipo de equipo con ese código o nombre');
  }
}

export async function actualizarTipoEquipo(t: TallerReq, actor: Actor, id: number, d: DatosTipoEquipo) {
  validarTarifas(d);
  try {
    await transaccion(t.pool, async (con) => {
      const antes = await una<{ activo: number }>(con, 'SELECT * FROM tipos_equipo WHERE id = ? FOR UPDATE', [id]);
      if (!antes) throw new ErrorNoEncontrado('No se encontró el tipo de equipo');
      if (d.codigo !== undefined && normalizarCampo('codigo', d.codigo) !== (antes as unknown as { codigo: string }).codigo) throw new ErrorApp(409, 'REGLA', 'El código no se puede cambiar una vez creado.');
      const sets: string[] = [];
      const valores: unknown[] = [];
      const poner = (col: string, v: unknown): void => {
        sets.push(`${col} = ?`);
        valores.push(v);
      };
      if (d.nombre !== undefined) poner('nombre', normalizarCampo('texto', d.nombre));
      if (d.es_vehiculo !== undefined) poner('es_vehiculo', d.es_vehiculo ? 1 : 0);
      if (d.usa_combustible !== undefined) poner('usa_combustible', d.usa_combustible ? 1 : 0);
      if (d.tarifa_venta_hora !== undefined) poner('tarifa_venta_hora', d.tarifa_venta_hora);
      if (d.costo_hora !== undefined) poner('costo_hora', d.costo_hora);
      if (d.tolerancia_dias !== undefined) poner('tolerancia_dias', d.tolerancia_dias);
      if (d.tolerancia_contador !== undefined) poner('tolerancia_contador', d.tolerancia_contador);
      if (d.tiene_componentes !== undefined) poner('tiene_componentes', d.tiene_componentes ? 1 : 0);
      if (d.activo !== undefined && (d.activo ? 1 : 0) !== antes.activo) {
        if (!d.activo) {
          const uso = await una<{ n: number }>(con, "SELECT COUNT(*) AS n FROM equipos WHERE tipo_equipo_id = ? AND estado <> 'baja'", [id]);
          if (Number(uso?.n) > 0) throw new ErrorApp(409, 'EN_USO', `Hay ${uso?.n} equipos de este tipo. Cámbieles el tipo o dé de baja los equipos primero.`);
        }
        poner('activo', d.activo ? 1 : 0);
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE tipos_equipo SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      await bitacora(con, actor, { accion: 'tipo_equipo_editado', entidad: 'tipos_equipo', entidadId: id, antes, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya existe un tipo de equipo con ese nombre');
  }
  return obtenerTipoEquipo(t.pool, id);
}

/** Qué documentos pide este tipo de equipo (reemplaza la lista completa). */
export async function definirDocumentosDeTipo(t: TallerReq, actor: Actor, id: number, lista: Array<{ tipo_documento_id: number; obligatorio: boolean }>) {
  if (new Set(lista.map((x) => x.tipo_documento_id)).size !== lista.length) throw new ErrorValidacion('Hay un documento repetido en la lista');
  await transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM tipos_equipo WHERE id = ? FOR UPDATE', [id]))) throw new ErrorNoEncontrado('No se encontró el tipo de equipo');
    for (const x of lista) {
      const td = await una<{ activo: number }>(con, 'SELECT activo FROM tipos_documento WHERE id = ?', [x.tipo_documento_id]);
      if (!td || td.activo !== 1) throw new ErrorValidacion('Un documento de la lista no existe o está desactivado');
    }
    await ejecutar(con, 'DELETE FROM tipo_equipo_documentos WHERE tipo_equipo_id = ?', [id]);
    for (const x of lista) await ejecutar(con, 'INSERT INTO tipo_equipo_documentos (tipo_equipo_id, tipo_documento_id, obligatorio) VALUES (?, ?, ?)', [id, x.tipo_documento_id, x.obligatorio ? 1 : 0]);
    await bitacora(con, actor, { accion: 'tipo_equipo_documentos_definidos', entidad: 'tipos_equipo', entidadId: id, despues: lista });
  });
  return obtenerTipoEquipo(t.pool, id);
}

/** Plantilla de componentes (solo para tipos que «tienen componentes»): se copia a cada equipo nuevo. Lo ya creado no cambia. */
export async function definirComponentesDeTipo(t: TallerReq, actor: Actor, id: number, lista: Array<{ nombre: string; tipo_contador_id?: number | null }>) {
  const nombres = lista.map((x) => normalizarCampo('texto', x.nombre) ?? '');
  if (nombres.some((n) => n === '')) throw new ErrorValidacion('Cada componente necesita un nombre');
  if (new Set(nombres).size !== nombres.length) throw new ErrorValidacion('Hay un componente repetido en la lista');
  await transaccion(t.pool, async (con) => {
    const tipo = await una<{ tiene_componentes: number }>(con, 'SELECT tiene_componentes FROM tipos_equipo WHERE id = ? FOR UPDATE', [id]);
    if (!tipo) throw new ErrorNoEncontrado('No se encontró el tipo de equipo');
    if (tipo.tiene_componentes !== 1 && lista.length > 0) throw new ErrorApp(409, 'REGLA', 'Este tipo no maneja componentes. Márquelo primero como «tiene componentes».');
    for (const x of lista) {
      if (x.tipo_contador_id && !(await una(con, 'SELECT id FROM tipos_contador WHERE id = ? AND activo = 1', [x.tipo_contador_id]))) throw new ErrorValidacion('Un tipo de contador de la lista no existe o está desactivado');
    }
    await ejecutar(con, 'DELETE FROM tipo_equipo_componentes WHERE tipo_equipo_id = ?', [id]);
    for (let i = 0; i < lista.length; i++) await ejecutar(con, 'INSERT INTO tipo_equipo_componentes (tipo_equipo_id, nombre, tipo_contador_id) VALUES (?, ?, ?)', [id, nombres[i], lista[i]?.tipo_contador_id ?? null]);
    await bitacora(con, actor, { accion: 'tipo_equipo_componentes_definidos', entidad: 'tipos_equipo', entidadId: id, despues: lista });
  });
  return obtenerTipoEquipo(t.pool, id);
}

// ── Horas de cada trabajo por tipo de equipo ──────────────────────────────────────────
export async function horasDeTrabajo(t: TallerReq, trabajoId: number) {
  if (!(await una(t.pool, 'SELECT id FROM trabajos WHERE id = ?', [trabajoId]))) throw new ErrorNoEncontrado('No se encontró el trabajo');
  return filas(
    t.pool,
    `SELECT te.id AS tipo_equipo_id, te.nombre AS tipo_equipo, th.horas
       FROM tipos_equipo te LEFT JOIN trabajo_horas_tipo_equipo th ON th.tipo_equipo_id = te.id AND th.trabajo_id = ?
      WHERE te.activo = 1 OR th.trabajo_id IS NOT NULL ORDER BY te.nombre`,
    [trabajoId]
  );
}

/** Reemplaza las horas del trabajo: un tipo sin horas (o con `null`) queda sin estándar. */
export async function definirHorasDeTrabajo(t: TallerReq, actor: Actor, trabajoId: number, lista: Array<{ tipo_equipo_id: number; horas: number | null }>) {
  if (new Set(lista.map((x) => x.tipo_equipo_id)).size !== lista.length) throw new ErrorValidacion('Hay un tipo de equipo repetido en la lista');
  for (const x of lista) if (x.horas !== null && (x.horas <= 0 || x.horas > 999)) throw new ErrorValidacion('Las horas deben estar entre 0 y 999');
  await transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM trabajos WHERE id = ? FOR UPDATE', [trabajoId]))) throw new ErrorNoEncontrado('No se encontró el trabajo');
    for (const x of lista) {
      if (!(await una(con, 'SELECT id FROM tipos_equipo WHERE id = ?', [x.tipo_equipo_id]))) throw new ErrorValidacion('Un tipo de equipo de la lista no existe');
      if (x.horas === null) await ejecutar(con, 'DELETE FROM trabajo_horas_tipo_equipo WHERE trabajo_id = ? AND tipo_equipo_id = ?', [trabajoId, x.tipo_equipo_id]);
      else await ejecutar(con, 'INSERT INTO trabajo_horas_tipo_equipo (trabajo_id, tipo_equipo_id, horas) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE horas = VALUES(horas)', [trabajoId, x.tipo_equipo_id, x.horas]);
    }
    await bitacora(con, actor, { accion: 'trabajo_horas_definidas', entidad: 'trabajos', entidadId: trabajoId, despues: lista });
  });
  return horasDeTrabajo(t, trabajoId);
}

// ── Equipos ──────────────────────────────────────────────────────────────────────────
export type EstadoEquipo = 'activo' | 'fuera_de_servicio' | 'baja';

export interface DatosEquipo {
  tipo_equipo_id?: number;
  codigo_interno?: string | null;
  placa?: string | null;
  serie?: string | null;
  marca_id?: number | null;
  modelo?: string | null;
  anio?: number | null;
  color?: string | null;
  motor_marca?: string | null;
  motor_modelo?: string | null;
  motor_serie?: string | null;
  combustible?: string | null;
  capacidad_tanque?: number | null;
  cliente_id?: number | null;
  departamento_id?: number | null;
  propiedad?: 'propio' | 'cliente';
  notas?: string | null;
}

export interface DatosEquipoNuevo extends DatosEquipo {
  tipo_equipo_id: number;
  /** Contadores con los que nace el equipo (el valor que marca hoy el medidor). */
  contadores?: Array<{ tipo_contador_id: number; valor_inicial?: number; fecha_inicio?: string }>;
}

export interface AvisoEquipo {
  campo: 'placa';
  equipo: { id: number; descripcion: string };
}

const SELECT_EQUIPO = `e.id, e.tipo_equipo_id, te.nombre AS tipo_equipo, te.codigo AS tipo_codigo, te.es_vehiculo, te.usa_combustible, te.tiene_componentes,
  e.codigo_interno, e.placa, e.serie, e.marca_id, m.nombre AS marca, e.modelo, e.anio, e.color, e.motor_marca, e.motor_modelo, e.motor_serie, e.combustible, e.capacidad_tanque,
  e.cliente_id, c.nombre AS cliente, e.departamento_id, d.nombre AS departamento, e.propiedad, e.estado, e.codigo_publico, e.notas`;
const DE_EQUIPO = `FROM equipos e JOIN tipos_equipo te ON te.id = e.tipo_equipo_id LEFT JOIN marcas m ON m.id = e.marca_id LEFT JOIN clientes c ON c.id = e.cliente_id LEFT JOIN departamentos d ON d.id = e.departamento_id`;

export function descripcionDeEquipo(e: { codigo_interno?: string | null; placa?: string | null; marca?: string | null; modelo?: string | null; tipo_equipo?: string | null; id: number }): string {
  const partes = [e.codigo_interno, e.placa, e.marca, e.modelo].filter((x) => x);
  return partes.length > 0 ? partes.join(' · ') : `${e.tipo_equipo ?? 'EQUIPO'} #${e.id}`;
}

export async function listarEquipos(
  t: TallerReq,
  f: { buscar?: string; cliente_id?: number; tipo_equipo_id?: number; estado?: EstadoEquipo; propiedad?: 'propio' | 'cliente'; pagina: number; porPagina: number }
) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (f.estado) {
    donde.push('e.estado = ?');
    params.push(f.estado);
  } else donde.push("e.estado <> 'baja'");
  if (f.cliente_id) {
    donde.push('e.cliente_id = ?');
    params.push(f.cliente_id);
  }
  if (f.tipo_equipo_id) {
    donde.push('e.tipo_equipo_id = ?');
    params.push(f.tipo_equipo_id);
  }
  if (f.propiedad) {
    donde.push('e.propiedad = ?');
    params.push(f.propiedad);
  }
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    donde.push('(e.codigo_interno LIKE ? OR e.placa LIKE ? OR e.serie LIKE ? OR e.modelo LIKE ? OR m.nombre LIKE ? OR c.nombre LIKE ?)');
    params.push(patron, patron, patron, patron, patron, patron);
  }
  const where = `WHERE ${donde.join(' AND ')}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${DE_EQUIPO} ${where}`, params);
  const registros = await filas<{ id: number; codigo_interno: string | null; placa: string | null; marca: string | null; modelo: string | null; tipo_equipo: string }>(
    t.pool,
    `SELECT ${SELECT_EQUIPO},
            (SELECT CONCAT(ct.valor_actual, ' ', u.codigo) FROM contadores ct JOIN tipos_contador tc ON tc.id = ct.tipo_contador_id JOIN unidades u ON u.id = tc.unidad_id
              WHERE ct.equipo_id = e.id AND ct.componente_id IS NULL AND ct.es_principal = 1 AND ct.activo = 1 AND tc.es_calendario = 0 LIMIT 1) AS contador_principal
       ${DE_EQUIPO} ${where} ORDER BY c.nombre, e.codigo_interno, e.id LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros: registros.map((r) => ({ ...r, descripcion: descripcionDeEquipo(r) })) };
}

export type EstadoDocumento = 'vigente' | 'por_vencer' | 'vencido' | 'sin_vencimiento';

function estadoDeDocumento(vence: string | null, diasAviso: number, hoy: string): EstadoDocumento {
  if (!vence) return 'sin_vencimiento';
  if (vence < hoy) return 'vencido';
  const falta = Math.floor((new Date(`${vence}T00:00:00Z`).getTime() - new Date(`${hoy}T00:00:00Z`).getTime()) / 86400000);
  return falta <= diasAviso ? 'por_vencer' : 'vigente';
}

export async function obtenerEquipo(ctx: Contexto, t: TallerReq, id: number) {
  const e = await una<{ id: number; tipo_equipo_id: number; cliente_id: number | null; codigo_interno: string | null; placa: string | null; marca: string | null; modelo: string | null; tipo_equipo: string }>(
    t.pool,
    `SELECT ${SELECT_EQUIPO}, e.created_at, e.updated_at ${DE_EQUIPO} WHERE e.id = ?`,
    [id]
  );
  if (!e) throw new ErrorNoEncontrado('No se encontró el equipo');
  const hoy = hoyDelTaller(ctx, t);
  const slug = t.empresa.slug;

  const fotosCrudas = await filas<{ id: number; archivo_id: number; descripcion: string | null; es_principal: number }>(t.pool, 'SELECT id, archivo_id, descripcion, es_principal FROM equipo_fotos WHERE equipo_id = ? ORDER BY es_principal DESC, id', [id]);
  const fotos = fotosCrudas.map((x) => ({ id: x.id, descripcion: x.descripcion, es_principal: x.es_principal === 1, url: urlFirmada(ctx, slug, x.archivo_id) }));

  const docsCrudos = await filas<{
    id: number; tipo_documento_id: number; tipo: string; dias_aviso: number; requiere_vencimiento: number; nombre: string | null; vence: string | null; archivo_id: number | null; created_at: Date;
  }>(
    t.pool,
    `SELECT d.id, d.tipo_documento_id, td.nombre AS tipo, td.dias_aviso, td.requiere_vencimiento, d.nombre, DATE_FORMAT(d.vence, '%Y-%m-%d') AS vence, d.archivo_id, d.created_at
       FROM equipo_documentos d JOIN tipos_documento td ON td.id = d.tipo_documento_id WHERE d.equipo_id = ? AND d.activo = 1 ORDER BY td.nombre, d.vence DESC, d.id DESC`,
    [id]
  );
  const documentos = docsCrudos.map((x) => ({
    id: x.id,
    tipo_documento_id: x.tipo_documento_id,
    tipo: x.tipo,
    nombre: x.nombre,
    vence: x.vence,
    estado: estadoDeDocumento(x.vence, x.dias_aviso, hoy),
    url: x.archivo_id ? urlFirmada(ctx, slug, x.archivo_id) : null,
  }));
  const requeridos = await filas<{ tipo_documento_id: number; nombre: string; obligatorio: number }>(
    t.pool,
    'SELECT d.tipo_documento_id, td.nombre, d.obligatorio FROM tipo_equipo_documentos d JOIN tipos_documento td ON td.id = d.tipo_documento_id WHERE d.tipo_equipo_id = ? AND td.activo = 1',
    [e.tipo_equipo_id]
  );
  // Falta un documento si no hay ninguno vigente de ese tipo (uno vencido no cuenta).
  const documentos_faltantes = requeridos
    .filter((r) => !documentos.some((d) => d.tipo_documento_id === r.tipo_documento_id && d.estado !== 'vencido'))
    .map((r) => ({ tipo_documento_id: r.tipo_documento_id, nombre: r.nombre, obligatorio: r.obligatorio === 1 }));

  const notas = await filas(
    t.pool,
    `SELECT n.id, n.nota, n.es_importante, n.created_at, col.nombre_completo AS autor FROM equipo_notas n LEFT JOIN usuarios u ON u.id = n.creado_por LEFT JOIN colaboradores col ON col.id = u.colaborador_id WHERE n.equipo_id = ? ORDER BY n.es_importante DESC, n.id DESC LIMIT 200`,
    [id]
  );
  const componentes = await filas(t.pool, 'SELECT id, nombre, activo FROM componentes WHERE equipo_id = ? ORDER BY nombre', [id]);
  const operadores = await filas(
    t.pool,
    `SELECT a.id, a.colaborador_id, col.nombre_completo AS colaborador, DATE_FORMAT(a.desde, '%Y-%m-%d') AS desde, DATE_FORMAT(a.hasta, '%Y-%m-%d') AS hasta, a.activo
       FROM asignaciones_operador a JOIN colaboradores col ON col.id = a.colaborador_id WHERE a.equipo_id = ? ORDER BY a.activo DESC, a.id DESC`,
    [id]
  );
  const contactos = await filas(t.pool, 'SELECT ce.contacto_id, cc.nombre FROM contacto_equipos ce JOIN contactos_cliente cc ON cc.id = ce.contacto_id WHERE ce.equipo_id = ? ORDER BY cc.nombre', [id]);
  const contadores = await listarContadores(ctx, t, id);
  const ordenes = await ordenesDeEquipo(t.pool, id);
  return { ...e, descripcion: descripcionDeEquipo(e), fotos, documentos, documentos_faltantes, anotaciones: notas, componentes, operadores, contactos, contadores, ordenes };
}

/** Revisa y completa los datos de un equipo según su tipo, su dueño y su marca. Devuelve lo que se guardará. */
async function revisarDatos(con: Ejecutor, d: DatosEquipo, base: { tipo_equipo_id: number; propiedad: string; cliente_id: number | null }, anioActual: number) {
  const tipo = await una<{ nombre: string; es_vehiculo: number; usa_combustible: number; activo: number; tiene_componentes: number }>(con, 'SELECT nombre, es_vehiculo, usa_combustible, activo, tiene_componentes FROM tipos_equipo WHERE id = ?', [base.tipo_equipo_id]);
  if (!tipo || tipo.activo !== 1) throw new ErrorValidacion('El tipo de equipo elegido no existe o está desactivado');
  const propiedad = d.propiedad ?? (base.propiedad as 'propio' | 'cliente');
  let clienteId = d.cliente_id === undefined ? base.cliente_id : d.cliente_id;
  if (propiedad === 'propio') clienteId = null;
  else {
    if (!clienteId) throw new ErrorValidacion('Elija el cliente dueño del equipo');
    const c = await una<{ activo: number }>(con, 'SELECT activo FROM clientes WHERE id = ?', [clienteId]);
    if (!c) throw new ErrorValidacion('El cliente elegido no existe');
    if (c.activo !== 1 && d.cliente_id !== undefined && d.cliente_id !== base.cliente_id) throw new ErrorValidacion('El cliente elegido está desactivado');
  }
  if (d.departamento_id) {
    const dep = await una<{ cliente_id: number; activo: number }>(con, 'SELECT cliente_id, activo FROM departamentos WHERE id = ?', [d.departamento_id]);
    if (!dep || dep.cliente_id !== clienteId) throw new ErrorValidacion('El departamento elegido no es de ese cliente');
    if (dep.activo !== 1) throw new ErrorValidacion('El departamento elegido está desactivado');
  }
  if (d.marca_id) {
    const m = await una<{ tipo_equipo_id: number | null; activo: number }>(con, 'SELECT tipo_equipo_id, activo FROM marcas WHERE id = ?', [d.marca_id]);
    if (!m || m.activo !== 1) throw new ErrorValidacion('La marca elegida no existe o está desactivada');
    if (m.tipo_equipo_id !== null && m.tipo_equipo_id !== base.tipo_equipo_id) throw new ErrorValidacion('La marca elegida es de otro tipo de equipo');
  }
  if (d.placa && tipo.es_vehiculo !== 1) throw new ErrorValidacion(`Solo los vehículos llevan placa (${tipo.nombre} no es vehículo)`);
  if ((d.combustible || (d.capacidad_tanque !== undefined && d.capacidad_tanque !== null)) && tipo.usa_combustible !== 1) throw new ErrorValidacion(`${tipo.nombre} no usa combustible`);
  if (d.anio !== undefined && d.anio !== null && (d.anio < 1900 || d.anio > anioActual + 1)) throw new ErrorValidacion(`El año debe estar entre 1900 y ${anioActual + 1}`);
  if (d.capacidad_tanque !== undefined && d.capacidad_tanque !== null && (d.capacidad_tanque < 0 || d.capacidad_tanque > 100000)) throw new ErrorValidacion('La capacidad del tanque no es válida');
  return { tipo, propiedad, clienteId };
}

const COLUMNAS_TEXTO: Array<[keyof DatosEquipo, 'texto' | 'codigo']> = [
  ['codigo_interno', 'codigo'],
  ['placa', 'codigo'],
  ['serie', 'codigo'],
  ['modelo', 'texto'],
  ['color', 'texto'],
  ['motor_marca', 'texto'],
  ['motor_modelo', 'texto'],
  ['motor_serie', 'codigo'],
  ['combustible', 'texto'],
  ['notas', 'texto'],
];

function traducirDuplicado(error: unknown): never {
  const e = error as { code?: string; sqlMessage?: string };
  if (e.code === 'ER_DUP_ENTRY') {
    const m = e.sqlMessage ?? '';
    if (m.includes('uq_equipos_serie')) throw new ErrorApp(409, 'SERIE_REPETIDA', 'Ya existe un equipo con esa serie.');
    if (m.includes('uq_equipos_codigo_interno')) throw new ErrorApp(409, 'CODIGO_REPETIDO', 'Ese cliente ya tiene un equipo con ese código interno.');
  }
  throw error;
}

async function equipoConPlaca(con: Ejecutor, placa: string | null, exceptoId: number): Promise<AvisoEquipo | null> {
  if (!placa) return null;
  const otro = await una<{ id: number; codigo_interno: string | null; placa: string | null; marca: string | null; modelo: string | null; tipo_equipo: string }>(
    con,
    `SELECT e.id, e.codigo_interno, e.placa, m.nombre AS marca, e.modelo, te.nombre AS tipo_equipo FROM equipos e JOIN tipos_equipo te ON te.id = e.tipo_equipo_id LEFT JOIN marcas m ON m.id = e.marca_id WHERE e.placa = ? AND e.id <> ? AND e.estado <> 'baja' LIMIT 1`,
    [placa, exceptoId]
  );
  return otro ? { campo: 'placa', equipo: { id: otro.id, descripcion: descripcionDeEquipo(otro) } } : null;
}

/**
 * Crea el equipo dentro de una transacción ya abierta (la usa también la carga masiva, que prueba todo y deshace si algo falla).
 * Devuelve el id y, si la placa ya la tiene otro equipo, el aviso correspondiente.
 */
export async function crearEquipoEn(ctx: Contexto, t: TallerReq, con: PoolConnection, actor: Actor, d: DatosEquipoNuevo): Promise<{ id: number; aviso: AvisoEquipo | null }> {
  const hoy = hoyDelTaller(ctx, t);
  const anioActual = Number(hoy.slice(0, 4));
  const base = { tipo_equipo_id: d.tipo_equipo_id, propiedad: d.propiedad ?? 'cliente', cliente_id: d.cliente_id ?? null };
  const { tipo, propiedad, clienteId } = await revisarDatos(con, d, base, anioActual);
  const valores: Record<string, unknown> = {};
  for (const [col, norma] of COLUMNAS_TEXTO) valores[col] = normalizarCampo(norma, d[col] as string | null | undefined);
  try {
    const r = await ejecutar(
      con,
      `INSERT INTO equipos (tipo_equipo_id, codigo_interno, placa, serie, marca_id, modelo, anio, color, motor_marca, motor_modelo, motor_serie, combustible, capacidad_tanque, cliente_id, departamento_id, propiedad, codigo_publico, notas)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.tipo_equipo_id, valores['codigo_interno'], valores['placa'], valores['serie'], d.marca_id ?? null, valores['modelo'], d.anio ?? null, valores['color'], valores['motor_marca'],
        valores['motor_modelo'], valores['motor_serie'], valores['combustible'], d.capacidad_tanque ?? null, clienteId, d.departamento_id ?? null, propiedad,
        crypto.randomBytes(8).toString('hex'), valores['notas'],
      ]
    );
    const equipoId = r.insertId;
    // Componentes de la plantilla del tipo, cada uno con su contador si la plantilla lo pide.
    if (tipo.tiene_componentes === 1) {
      const plantilla = await filas<{ nombre: string; tipo_contador_id: number | null }>(con, 'SELECT nombre, tipo_contador_id FROM tipo_equipo_componentes WHERE tipo_equipo_id = ? ORDER BY id', [d.tipo_equipo_id]);
      for (const p of plantilla) {
        const comp = await ejecutar(con, 'INSERT INTO componentes (equipo_id, nombre) VALUES (?, ?)', [equipoId, p.nombre]);
        if (p.tipo_contador_id) await crearContadorEn(ctx, t, con, actor, equipoId, { tipo_contador_id: p.tipo_contador_id, componente_id: comp.insertId });
      }
    }
    for (const c of d.contadores ?? []) await crearContadorEn(ctx, t, con, actor, equipoId, c);
    const aviso = await equipoConPlaca(con, valores['placa'] as string | null, equipoId);
    await bitacora(con, actor, { accion: 'equipo_creado', entidad: 'equipos', entidadId: equipoId, despues: { ...d, ...valores } });
    return { id: equipoId, aviso };
  } catch (error) {
    return traducirDuplicado(error);
  }
}

export async function crearEquipo(ctx: Contexto, t: TallerReq, actor: Actor, d: DatosEquipoNuevo) {
  const { id, aviso } = await transaccion(t.pool, (con) => crearEquipoEn(ctx, t, con, actor, d));
  return { equipo: await obtenerEquipo(ctx, t, id), avisos: aviso ? [aviso] : [] };
}

export async function actualizarEquipo(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: DatosEquipo) {
  const hoy = hoyDelTaller(ctx, t);
  const anioActual = Number(hoy.slice(0, 4));
  let aviso: AvisoEquipo | null = null;
  await transaccion(t.pool, async (con) => {
    const antes = await una<{ tipo_equipo_id: number; propiedad: string; cliente_id: number | null; estado: string; placa: string | null }>(con, 'SELECT * FROM equipos WHERE id = ? FOR UPDATE', [id]);
    if (!antes) throw new ErrorNoEncontrado('No se encontró el equipo');
    if (antes.estado === 'baja') throw new ErrorApp(409, 'REGLA', 'El equipo está dado de baja: reactívelo para editarlo.');
    const nuevoTipo = d.tipo_equipo_id ?? antes.tipo_equipo_id;
    if (nuevoTipo !== antes.tipo_equipo_id) {
      const ord = await ordenesDeEquipo(con, id);
      if (ord.total > 0) throw new ErrorApp(409, 'REGLA', 'Este equipo ya tiene órdenes de trabajo: su tipo no se puede cambiar.');
    }
    // La revisión usa los datos nuevos sobre los actuales (para que "la placa solo si es vehículo" valga también al cambiar de tipo).
    const completo: DatosEquipo = { ...d };
    if (d.tipo_equipo_id !== undefined && d.placa === undefined && antes.placa) completo.placa = antes.placa;
    const { propiedad, clienteId } = await revisarDatos(con, completo, { tipo_equipo_id: nuevoTipo, propiedad: antes.propiedad, cliente_id: antes.cliente_id }, anioActual);
    if (clienteId !== antes.cliente_id) {
      const hay = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM contacto_equipos WHERE equipo_id = ?', [id]);
      if (Number(hay?.n) > 0) await ejecutar(con, 'DELETE FROM contacto_equipos WHERE equipo_id = ?', [id]); // los contactos eran del cliente anterior
      if (d.departamento_id === undefined) await ejecutar(con, 'UPDATE equipos SET departamento_id = NULL WHERE id = ?', [id]);
    }
    const sets: string[] = [];
    const valores: unknown[] = [];
    const poner = (col: string, v: unknown): void => {
      sets.push(`${col} = ?`);
      valores.push(v);
    };
    for (const [col, norma] of COLUMNAS_TEXTO) if (d[col] !== undefined) poner(col, normalizarCampo(norma, d[col] as string | null));
    if (d.tipo_equipo_id !== undefined) poner('tipo_equipo_id', d.tipo_equipo_id);
    if (d.marca_id !== undefined) poner('marca_id', d.marca_id);
    if (d.anio !== undefined) poner('anio', d.anio);
    if (d.capacidad_tanque !== undefined) poner('capacidad_tanque', d.capacidad_tanque);
    if (d.departamento_id !== undefined) poner('departamento_id', d.departamento_id);
    if (d.propiedad !== undefined || d.cliente_id !== undefined) {
      poner('propiedad', propiedad);
      poner('cliente_id', clienteId);
    }
    if (sets.length === 0) return;
    try {
      await ejecutar(con, `UPDATE equipos SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
    } catch (error) {
      traducirDuplicado(error);
    }
    if (d.placa !== undefined) aviso = await equipoConPlaca(con, normalizarCampo('codigo', d.placa), id);
    await bitacora(con, actor, { accion: 'equipo_editado', entidad: 'equipos', entidadId: id, antes, despues: d });
  });
  return { equipo: await obtenerEquipo(ctx, t, id), avisos: aviso ? [aviso] : [] };
}

/** Activo ↔ fuera de servicio ↔ baja. La baja pide motivo, no se hace con órdenes abiertas y nunca borra nada. */
export async function cambiarEstadoEquipo(ctx: Contexto, t: TallerReq, actor: Actor, id: number, estado: EstadoEquipo, motivo?: string | null) {
  await transaccion(t.pool, async (con) => {
    const antes = await una<{ estado: EstadoEquipo }>(con, 'SELECT estado FROM equipos WHERE id = ? FOR UPDATE', [id]);
    if (!antes) throw new ErrorNoEncontrado('No se encontró el equipo');
    if (antes.estado === estado) return;
    const texto = normalizarCampo('texto', motivo);
    if (estado === 'baja') {
      if (!texto || texto.length < 3) throw new ErrorValidacion('Escriba el motivo de la baja');
      const ord = await ordenesDeEquipo(con, id);
      if (ord.abiertas > 0) throw new ErrorApp(409, 'EN_USO', `El equipo tiene ${ord.abiertas} órdenes abiertas. Ciérrelas o cancélelas primero.`);
      await ejecutar(con, "UPDATE asignaciones_operador SET activo = 0, hasta = ? WHERE equipo_id = ? AND activo = 1", [hoyDelTaller(ctx, t), id]);
    }
    await ejecutar(con, 'UPDATE equipos SET estado = ? WHERE id = ?', [estado, id]);
    await bitacora(con, actor, { accion: 'equipo_estado', entidad: 'equipos', entidadId: id, antes: antes.estado, despues: estado, motivo: texto });
  });
  return obtenerEquipo(ctx, t, id);
}

async function equipoEditable(con: Ejecutor, id: number): Promise<{ cliente_id: number | null; estado: string }> {
  const e = await una<{ cliente_id: number | null; estado: string }>(con, 'SELECT cliente_id, estado FROM equipos WHERE id = ? FOR UPDATE', [id]);
  if (!e) throw new ErrorNoEncontrado('No se encontró el equipo');
  if (e.estado === 'baja') throw new ErrorApp(409, 'REGLA', 'El equipo está dado de baja.');
  return e;
}

// ── Contactos que ven este equipo ─────────────────────────────────────────────────────
export async function definirContactosDeEquipo(ctx: Contexto, t: TallerReq, actor: Actor, id: number, contactoIds: number[]) {
  await transaccion(t.pool, async (con) => {
    const e = await equipoEditable(con, id);
    if (!e.cliente_id && contactoIds.length > 0) throw new ErrorApp(409, 'REGLA', 'Un equipo propio del taller no tiene contactos de cliente.');
    for (const cid of new Set(contactoIds)) {
      const c = await una<{ cliente_id: number; activo: number }>(con, 'SELECT cliente_id, activo FROM contactos_cliente WHERE id = ?', [cid]);
      if (!c || c.cliente_id !== e.cliente_id || c.activo !== 1) throw new ErrorValidacion('Un contacto elegido no es de ese cliente o está desactivado');
    }
    await ejecutar(con, 'DELETE FROM contacto_equipos WHERE equipo_id = ?', [id]);
    for (const cid of new Set(contactoIds)) await ejecutar(con, 'INSERT INTO contacto_equipos (contacto_id, equipo_id) VALUES (?, ?)', [cid, id]);
    await bitacora(con, actor, { accion: 'equipo_contactos_definidos', entidad: 'equipos', entidadId: id, despues: contactoIds });
  });
  return obtenerEquipo(ctx, t, id);
}

// ── Fotos ────────────────────────────────────────────────────────────────────────────
export async function agregarFoto(ctx: Contexto, t: TallerReq, actor: Actor, id: number, entrada: { buffer: Buffer; mime: string; nombre: string; descripcion?: string | null; es_principal?: boolean }) {
  if (!entrada.mime.startsWith('image/')) throw new ErrorValidacion('La foto debe ser una imagen (JPG, PNG o WEBP)');
  if (!(await una(t.pool, 'SELECT id FROM equipos WHERE id = ?', [id]))) throw new ErrorNoEncontrado('No se encontró el equipo');
  const archivo = await guardarArchivo(ctx, t, t.pool, actor, entrada);
  try {
    await transaccion(t.pool, async (con) => {
      await equipoEditable(con, id);
      const hay = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM equipo_fotos WHERE equipo_id = ?', [id]);
      const principal = Number(hay?.n) === 0 || entrada.es_principal === true;
      if (principal) await ejecutar(con, 'UPDATE equipo_fotos SET es_principal = 0 WHERE equipo_id = ?', [id]);
      const r = await ejecutar(con, 'INSERT INTO equipo_fotos (equipo_id, archivo_id, descripcion, es_principal) VALUES (?, ?, ?, ?)', [id, archivo.id, normalizarCampo('texto', entrada.descripcion), principal ? 1 : 0]);
      await bitacora(con, actor, { accion: 'equipo_foto_agregada', entidad: 'equipo_fotos', entidadId: r.insertId, despues: { equipoId: id, archivoId: archivo.id } });
    });
  } catch (error) {
    await borrarArchivo(ctx, t, t.pool, archivo.id);
    throw error;
  }
  return obtenerEquipo(ctx, t, id);
}

export async function marcarFotoPrincipal(ctx: Contexto, t: TallerReq, actor: Actor, id: number, fotoId: number) {
  await transaccion(t.pool, async (con) => {
    await equipoEditable(con, id);
    if (!(await una(con, 'SELECT id FROM equipo_fotos WHERE id = ? AND equipo_id = ?', [fotoId, id]))) throw new ErrorNoEncontrado('No se encontró la foto');
    await ejecutar(con, 'UPDATE equipo_fotos SET es_principal = (id = ?) WHERE equipo_id = ?', [fotoId, id]);
    await bitacora(con, actor, { accion: 'equipo_foto_principal', entidad: 'equipo_fotos', entidadId: fotoId });
  });
  return obtenerEquipo(ctx, t, id);
}

export async function quitarFoto(ctx: Contexto, t: TallerReq, actor: Actor, id: number, fotoId: number) {
  let archivoId = 0;
  await transaccion(t.pool, async (con) => {
    await equipoEditable(con, id);
    const f = await una<{ archivo_id: number; es_principal: number }>(con, 'SELECT archivo_id, es_principal FROM equipo_fotos WHERE id = ? AND equipo_id = ? FOR UPDATE', [fotoId, id]);
    if (!f) throw new ErrorNoEncontrado('No se encontró la foto');
    archivoId = f.archivo_id;
    await ejecutar(con, 'DELETE FROM equipo_fotos WHERE id = ?', [fotoId]);
    if (f.es_principal === 1) await ejecutar(con, 'UPDATE equipo_fotos SET es_principal = 1 WHERE equipo_id = ? ORDER BY id LIMIT 1', [id]);
    await bitacora(con, actor, { accion: 'equipo_foto_quitada', entidad: 'equipo_fotos', entidadId: fotoId, antes: { archivoId } });
  });
  await borrarArchivo(ctx, t, t.pool, archivoId);
  return obtenerEquipo(ctx, t, id);
}

// ── Documentos ───────────────────────────────────────────────────────────────────────
export async function agregarDocumento(
  ctx: Contexto,
  t: TallerReq,
  actor: Actor,
  id: number,
  d: { tipo_documento_id: number; nombre?: string | null; vence?: string | null },
  archivo?: { buffer: Buffer; mime: string; nombre: string }
) {
  const td = await una<{ requiere_vencimiento: number; activo: number }>(t.pool, 'SELECT requiere_vencimiento, activo FROM tipos_documento WHERE id = ?', [d.tipo_documento_id]);
  if (!td || td.activo !== 1) throw new ErrorValidacion('El tipo de documento elegido no existe o está desactivado');
  if (td.requiere_vencimiento === 1 && !d.vence) throw new ErrorValidacion('Este documento necesita su fecha de vencimiento');
  if (d.vence) validarFechaRazonable(d.vence, 'vence');
  const guardado = archivo ? await guardarArchivo(ctx, t, t.pool, actor, archivo) : null;
  try {
    await transaccion(t.pool, async (con) => {
      await equipoEditable(con, id);
      const r = await ejecutar(con, 'INSERT INTO equipo_documentos (equipo_id, tipo_documento_id, nombre, vence, archivo_id, subido_por) VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        d.tipo_documento_id,
        normalizarCampo('texto', d.nombre),
        d.vence ?? null,
        guardado?.id ?? null,
        actor.usuarioId,
      ]);
      // Un documento nuevo del mismo tipo reemplaza al anterior (queda en el historial, ya no cuenta).
      await ejecutar(con, 'UPDATE equipo_documentos SET activo = 0 WHERE equipo_id = ? AND tipo_documento_id = ? AND id <> ? AND activo = 1', [id, d.tipo_documento_id, r.insertId]);
      await bitacora(con, actor, { accion: 'equipo_documento_agregado', entidad: 'equipo_documentos', entidadId: r.insertId, despues: { ...d, equipoId: id } });
    });
  } catch (error) {
    if (guardado) await borrarArchivo(ctx, t, t.pool, guardado.id);
    throw error;
  }
  return obtenerEquipo(ctx, t, id);
}

export async function quitarDocumento(ctx: Contexto, t: TallerReq, actor: Actor, id: number, documentoId: number) {
  await transaccion(t.pool, async (con) => {
    await equipoEditable(con, id);
    const r = await ejecutar(con, 'UPDATE equipo_documentos SET activo = 0 WHERE id = ? AND equipo_id = ? AND activo = 1', [documentoId, id]);
    if (r.affectedRows !== 1) throw new ErrorNoEncontrado('No se encontró el documento');
    await bitacora(con, actor, { accion: 'equipo_documento_quitado', entidad: 'equipo_documentos', entidadId: documentoId });
  });
  return obtenerEquipo(ctx, t, id);
}

// ── Notas ────────────────────────────────────────────────────────────────────────────
export async function agregarNota(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { nota: string; es_importante?: boolean }) {
  const nota = normalizarCampo('multilinea', d.nota);
  if (!nota) throw new ErrorValidacion('Escriba la nota');
  await transaccion(t.pool, async (con) => {
    await equipoEditable(con, id);
    const r = await ejecutar(con, 'INSERT INTO equipo_notas (equipo_id, nota, es_importante, creado_por) VALUES (?, ?, ?, ?)', [id, nota, d.es_importante ? 1 : 0, actor.usuarioId]);
    await bitacora(con, actor, { accion: 'equipo_nota_agregada', entidad: 'equipo_notas', entidadId: r.insertId });
  });
  return obtenerEquipo(ctx, t, id);
}

// ── Operadores ───────────────────────────────────────────────────────────────────────
/** Colaboradores activos con un puesto de operador (para elegirlos sin necesitar el permiso de ver colaboradores). */
export async function operadoresDisponibles(t: TallerReq) {
  return filas(
    t.pool,
    'SELECT c.id, c.nombre_completo FROM colaboradores c WHERE c.activo = 1 AND EXISTS (SELECT 1 FROM colaborador_puestos cp JOIN puestos p ON p.id = cp.puesto_id WHERE cp.colaborador_id = c.id AND p.es_operador = 1) ORDER BY c.nombre_completo'
  );
}

export async function asignarOperador(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { colaborador_id: number; desde?: string }) {
  const hoy = hoyDelTaller(ctx, t);
  const desde = d.desde ?? hoy;
  validarFechaRazonable(desde, 'desde', { noFutura: true, hoy });
  await transaccion(t.pool, async (con) => {
    const e = await equipoEditable(con, id);
    const col = await una<{ activo: number; operador: number }>(
      con,
      'SELECT c.activo, EXISTS(SELECT 1 FROM colaborador_puestos cp JOIN puestos p ON p.id = cp.puesto_id WHERE cp.colaborador_id = c.id AND p.es_operador = 1) AS operador FROM colaboradores c WHERE c.id = ?',
      [d.colaborador_id]
    );
    if (!col || col.activo !== 1) throw new ErrorValidacion('El colaborador elegido no existe o está desactivado');
    if (Number(col.operador) !== 1) throw new ErrorApp(409, 'REGLA', 'Ese colaborador no tiene un puesto de operador. Asígnele el puesto primero.');
    if (e.estado !== 'activo' && e.estado !== 'fuera_de_servicio') throw new ErrorApp(409, 'REGLA', 'El equipo no admite operadores en este estado.');
    if (await una(con, 'SELECT id FROM asignaciones_operador WHERE equipo_id = ? AND colaborador_id = ? AND activo = 1', [id, d.colaborador_id])) throw new ErrorApp(409, 'CONFLICTO', 'Ese colaborador ya es operador de este equipo.');
    const r = await ejecutar(con, 'INSERT INTO asignaciones_operador (colaborador_id, equipo_id, desde) VALUES (?, ?, ?)', [d.colaborador_id, id, desde]);
    await bitacora(con, actor, { accion: 'operador_asignado', entidad: 'asignaciones_operador', entidadId: r.insertId, despues: { equipoId: id, ...d } });
  });
  return obtenerEquipo(ctx, t, id);
}

export async function quitarOperador(ctx: Contexto, t: TallerReq, actor: Actor, id: number, asignacionId: number) {
  const hoy = hoyDelTaller(ctx, t);
  await transaccion(t.pool, async (con) => {
    const r = await ejecutar(con, 'UPDATE asignaciones_operador SET activo = 0, hasta = ? WHERE id = ? AND equipo_id = ? AND activo = 1', [hoy, asignacionId, id]);
    if (r.affectedRows !== 1) throw new ErrorNoEncontrado('No se encontró la asignación');
    await bitacora(con, actor, { accion: 'operador_quitado', entidad: 'asignaciones_operador', entidadId: asignacionId });
  });
  return obtenerEquipo(ctx, t, id);
}

// ── Componentes ──────────────────────────────────────────────────────────────────────
export async function crearComponente(ctx: Contexto, t: TallerReq, actor: Actor, id: number, nombre: string) {
  const n = normalizarCampo('texto', nombre);
  if (!n) throw new ErrorValidacion('Escriba el nombre del componente');
  try {
    await transaccion(t.pool, async (con) => {
      await equipoEditable(con, id);
      const tipo = await una<{ tiene_componentes: number }>(con, 'SELECT te.tiene_componentes FROM equipos e JOIN tipos_equipo te ON te.id = e.tipo_equipo_id WHERE e.id = ?', [id]);
      if (tipo?.tiene_componentes !== 1) throw new ErrorApp(409, 'REGLA', 'El tipo de este equipo no maneja componentes.');
      const r = await ejecutar(con, 'INSERT INTO componentes (equipo_id, nombre) VALUES (?, ?)', [id, n]);
      await bitacora(con, actor, { accion: 'componente_creado', entidad: 'componentes', entidadId: r.insertId, despues: { equipoId: id, nombre: n } });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Este equipo ya tiene un componente con ese nombre');
  }
  return obtenerEquipo(ctx, t, id);
}

export async function actualizarComponente(ctx: Contexto, t: TallerReq, actor: Actor, id: number, componenteId: number, d: { nombre?: string; activo?: boolean }) {
  try {
    await transaccion(t.pool, async (con) => {
      await equipoEditable(con, id);
      const c = await una<{ activo: number }>(con, 'SELECT activo FROM componentes WHERE id = ? AND equipo_id = ? FOR UPDATE', [componenteId, id]);
      if (!c) throw new ErrorNoEncontrado('No se encontró el componente');
      const sets: string[] = [];
      const valores: unknown[] = [];
      if (d.nombre !== undefined) {
        sets.push('nombre = ?');
        valores.push(normalizarCampo('texto', d.nombre));
      }
      if (d.activo !== undefined) {
        if (!d.activo) {
          const act = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM contadores WHERE componente_id = ? AND activo = 1', [componenteId]);
          if (Number(act?.n) > 0) throw new ErrorApp(409, 'EN_USO', 'El componente tiene contadores activos. Desactívelos primero.');
        }
        sets.push('activo = ?');
        valores.push(d.activo ? 1 : 0);
      }
      if (sets.length === 0) return;
      await ejecutar(con, `UPDATE componentes SET ${sets.join(', ')} WHERE id = ?`, [...valores, componenteId]);
      await bitacora(con, actor, { accion: 'componente_editado', entidad: 'componentes', entidadId: componenteId, despues: d });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Este equipo ya tiene un componente con ese nombre');
  }
  return obtenerEquipo(ctx, t, id);
}

/** Cuántos equipos tiene un cliente (para su ficha y para impedir eliminarlo si tiene historia). */
export async function contarEquiposDeCliente(con: Ejecutor, clienteId: number): Promise<number> {
  const r = await una<{ n: number }>(con, 'SELECT COUNT(*) AS n FROM equipos WHERE cliente_id = ?', [clienteId]);
  return Number(r?.n ?? 0);
}
