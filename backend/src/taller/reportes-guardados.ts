import { PoolConnection } from 'mysql2/promise';
import { encolarCorreo } from '../correos/cola';
import { plantillaCorreo } from '../correos/plantilla';
import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { normalizarCampo } from '../utils/texto';
import { localDeUtc } from '../utils/zona';
import { correoDeUsuario, enviarCorreoDeTaller } from './avisos';
import { Actor, bitacora, conflictoSiDuplicado, TallerReq } from './comun';
import { leerConfiguracion } from './configuracion';
import { hoyDelTaller } from './contadores';
import { armarReporte, defDeReporte, resolverPeriodo } from './reportes-catalogo';
import { PieDeReporte, reporteAHtml } from './reportes-salida';
import { ddmmaaaa, FiltrosGuardados } from './reportes-tipos';

/** Vistas guardadas (de cada persona) y envíos programados por correo (del taller) de los reportes. Fase 7c. */

const CORREO = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export const MAXIMO_VISTAS_POR_PERSONA = 30;
export const MAXIMO_PROGRAMADOS = 30;
/** Los envíos programados salen a partir de esta hora del taller. */
export const HORA_DE_ENVIO = 7;

export function validarFiltros(f: FiltrosGuardados): FiltrosGuardados {
  if (f.periodo === 'personalizado') {
    const ok = (x: string | undefined): boolean => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x) && new Date(`${x}T00:00:00Z`).toISOString().slice(0, 10) === x;
    if (!ok(f.desde) || !ok(f.hasta)) throw new ErrorValidacion('Una de las fechas del periodo no es válida');
    if ((f.hasta as string) < (f.desde as string)) throw new ErrorValidacion('La fecha final no puede ser anterior a la inicial');
    return { periodo: 'personalizado', desde: f.desde, hasta: f.hasta, ...(f.sucursal_id ? { sucursal_id: f.sucursal_id } : {}), ...(f.tipo_equipo_id ? { tipo_equipo_id: f.tipo_equipo_id } : {}) };
  }
  return { periodo: f.periodo, ...(f.sucursal_id ? { sucursal_id: f.sucursal_id } : {}), ...(f.tipo_equipo_id ? { tipo_equipo_id: f.tipo_equipo_id } : {}) };
}

const leerFiltros = (texto: string): FiltrosGuardados => JSON.parse(texto) as FiltrosGuardados;

// ── Vistas guardadas ──────────────────────────────────────────────────────────────────
export async function listarVistas(t: TallerReq, usuarioId: number, reporte?: string) {
  const f = await filas<{ id: number; reporte: string; nombre: string; filtros: string }>(
    t.pool,
    `SELECT id, reporte, nombre, filtros FROM vistas_guardadas WHERE usuario_id = ?${reporte ? ' AND reporte = ?' : ''} ORDER BY nombre`,
    reporte ? [usuarioId, reporte] : [usuarioId]
  );
  return f.map((v) => ({ id: v.id, reporte: v.reporte, nombre: v.nombre, filtros: leerFiltros(v.filtros) }));
}

export async function guardarVista(t: TallerReq, actor: Actor, d: { reporte: string; nombre: string; filtros: FiltrosGuardados }) {
  defDeReporte(d.reporte);
  const nombre = normalizarCampo('texto', d.nombre)?.slice(0, 80);
  if (!nombre || nombre.length < 2) throw new ErrorValidacion('Póngale un nombre a la vista');
  const filtros = validarFiltros(d.filtros);
  const n = Number((await una<{ n: number }>(t.pool, 'SELECT COUNT(*) AS n FROM vistas_guardadas WHERE usuario_id = ?', [actor.usuarioId]))?.n ?? 0);
  if (n >= MAXIMO_VISTAS_POR_PERSONA) throw new ErrorValidacion(`Ya tiene ${MAXIMO_VISTAS_POR_PERSONA} vistas guardadas: elimine alguna para guardar otra`);
  try {
    const r = await ejecutar(t.pool, 'INSERT INTO vistas_guardadas (usuario_id, reporte, nombre, filtros) VALUES (?, ?, ?, ?)', [actor.usuarioId, d.reporte, nombre, JSON.stringify(filtros)]);
    return { id: r.insertId, reporte: d.reporte, nombre, filtros };
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya tiene una vista con ese nombre en este reporte');
  }
}

export async function borrarVista(t: TallerReq, actor: Actor, id: number) {
  const r = await ejecutar(t.pool, 'DELETE FROM vistas_guardadas WHERE id = ? AND usuario_id = ?', [id, actor.usuarioId]);
  if (r.affectedRows === 0) throw new ErrorNoEncontrado('No se encontró la vista');
  return { id };
}

// ── Envíos programados ────────────────────────────────────────────────────────────────
export interface DatosProgramado {
  nombre: string;
  reporte: string;
  filtros: FiltrosGuardados;
  frecuencia: 'diaria' | 'semanal' | 'mensual';
  dia_semana?: number | null;
  dia_mes?: number | null;
  activo: boolean;
  roles: number[];
  usuarios: number[];
  correos: string[];
}

interface FilaProgramado {
  id: number;
  nombre: string;
  reporte: string;
  filtros: string;
  frecuencia: 'diaria' | 'semanal' | 'mensual';
  dia_semana: number | null;
  dia_mes: number | null;
  con_dinero: number;
  activo: number;
  creado_por_id: number;
  creador: string | null;
  ultimo_envio_en: Date | null;
}

const COLUMNAS_PROGRAMADO = `p.id, p.nombre, p.reporte, p.filtros, p.frecuencia, p.dia_semana, p.dia_mes, p.con_dinero, p.activo, p.creado_por_id, co.nombre_completo AS creador, p.ultimo_envio_en
       FROM reportes_programados p LEFT JOIN usuarios u ON u.id = p.creado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id`;

export async function listarProgramados(t: TallerReq) {
  const f = await filas<FilaProgramado>(t.pool, `SELECT ${COLUMNAS_PROGRAMADO} ORDER BY p.nombre`);
  const dest = await filas<{ reporte_programado_id: number; rol_id: number | null; usuario_id: number | null; correo: string | null }>(t.pool, 'SELECT reporte_programado_id, rol_id, usuario_id, correo FROM reportes_programados_destinatarios ORDER BY id');
  const roles = await filas<{ id: number; nombre: string }>(t.pool, 'SELECT id, nombre FROM roles WHERE activo = 1 ORDER BY nombre');
  const personas = await filas<{ id: number; nombre: string; correo: string | null }>(t.pool, 'SELECT u.id, c.nombre_completo AS nombre, c.correo FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.activo = 1 AND c.activo = 1 ORDER BY c.nombre_completo');
  return {
    programados: f.map((p) => {
      const mios = dest.filter((x) => x.reporte_programado_id === p.id);
      return {
        id: p.id,
        nombre: p.nombre,
        reporte: p.reporte,
        filtros: leerFiltros(p.filtros),
        frecuencia: p.frecuencia,
        dia_semana: p.dia_semana,
        dia_mes: p.dia_mes,
        con_dinero: p.con_dinero === 1,
        activo: p.activo === 1,
        creado_por: p.creador,
        ultimo_envio_en: p.ultimo_envio_en,
        roles: mios.filter((x) => x.rol_id).map((x) => x.rol_id as number),
        usuarios: mios.filter((x) => x.usuario_id).map((x) => x.usuario_id as number),
        correos: mios.filter((x) => x.correo).map((x) => x.correo as string),
      };
    }),
    roles,
    personas,
  };
}

async function validarProgramado(_t: TallerReq, d: DatosProgramado, permisos: Set<string>, conDineroOriginal: boolean) {
  const def = defDeReporte(d.reporte);
  const nombre = normalizarCampo('texto', d.nombre)?.slice(0, 80);
  if (!nombre || nombre.length < 2) throw new ErrorValidacion('Póngale un nombre al envío');
  if (d.filtros.periodo === 'personalizado') throw new ErrorValidacion('Un envío programado necesita un periodo que se mueva solo (este mes, últimos 30 días…): un rango de fechas fijo saldría igual cada vez');
  const filtros = validarFiltros(d.filtros);
  if (d.frecuencia === 'semanal' && !(Number.isInteger(d.dia_semana) && (d.dia_semana as number) >= 1 && (d.dia_semana as number) <= 7)) throw new ErrorValidacion('Elija el día de la semana');
  if (d.frecuencia === 'mensual' && !(Number.isInteger(d.dia_mes) && (d.dia_mes as number) >= 1 && (d.dia_mes as number) <= 28)) throw new ErrorValidacion('Elija el día del mes (del 1 al 28)');
  const conDinero = conDineroOriginal || permisos.has('reportes.financieros');
  if (def.financiero && !conDinero) throw new ErrorValidacion('Ese reporte es de dinero: hace falta el permiso de reportes financieros');
  const correos = [...new Set(d.correos.map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0))];
  for (const c of correos) if (!CORREO.test(c) || c.length > 150) throw new ErrorValidacion(`«${c}» no es un correo válido`);
  const roles = [...new Set(d.roles)];
  const usuarios = [...new Set(d.usuarios)];
  if (roles.length + usuarios.length + correos.length === 0) throw new ErrorValidacion('Elija a quién se le envía: un rol, una persona o un correo');
  return { nombre, filtros, correos, roles, usuarios, conDinero };
}

async function guardarDestinatarios(con: PoolConnection, id: number, v: { roles: number[]; usuarios: number[]; correos: string[] }) {
  for (const rid of v.roles) if (!(await una(con, 'SELECT id FROM roles WHERE id = ? AND activo = 1', [rid]))) throw new ErrorValidacion('Alguno de los roles no existe o está desactivado');
  for (const uid of v.usuarios) if (!(await una(con, 'SELECT id FROM usuarios WHERE id = ? AND activo = 1', [uid]))) throw new ErrorValidacion('Alguna de las personas no existe o no tiene acceso');
  await ejecutar(con, 'DELETE FROM reportes_programados_destinatarios WHERE reporte_programado_id = ?', [id]);
  for (const rid of v.roles) await ejecutar(con, 'INSERT INTO reportes_programados_destinatarios (reporte_programado_id, rol_id) VALUES (?, ?)', [id, rid]);
  for (const uid of v.usuarios) await ejecutar(con, 'INSERT INTO reportes_programados_destinatarios (reporte_programado_id, usuario_id) VALUES (?, ?)', [id, uid]);
  for (const c of v.correos) await ejecutar(con, 'INSERT INTO reportes_programados_destinatarios (reporte_programado_id, correo) VALUES (?, ?)', [id, c]);
}

export async function crearProgramado(t: TallerReq, actor: Actor, permisos: Set<string>, d: DatosProgramado) {
  const v = await validarProgramado(t, d, permisos, false);
  if (Number((await una<{ n: number }>(t.pool, 'SELECT COUNT(*) AS n FROM reportes_programados'))?.n ?? 0) >= MAXIMO_PROGRAMADOS) throw new ErrorValidacion(`Ya hay ${MAXIMO_PROGRAMADOS} envíos programados: elimine alguno para crear otro`);
  const id = await transaccion(t.pool, async (con) => {
    const r = await ejecutar(
      con,
      'INSERT INTO reportes_programados (nombre, reporte, filtros, frecuencia, dia_semana, dia_mes, con_dinero, activo, creado_por_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [v.nombre, d.reporte, JSON.stringify(v.filtros), d.frecuencia, d.frecuencia === 'semanal' ? d.dia_semana : null, d.frecuencia === 'mensual' ? d.dia_mes : null, v.conDinero ? 1 : 0, d.activo ? 1 : 0, actor.usuarioId]
    );
    await guardarDestinatarios(con, r.insertId, v);
    await bitacora(con, actor, { accion: 'envio_programado_creado', entidad: 'reportes_programados', entidadId: r.insertId, despues: { nombre: v.nombre, reporte: d.reporte, frecuencia: d.frecuencia, destinatarios: v.roles.length + v.usuarios.length + v.correos.length } });
    return r.insertId;
  });
  return { id };
}

export async function actualizarProgramado(t: TallerReq, actor: Actor, permisos: Set<string>, id: number, d: DatosProgramado) {
  const actual = await una<{ con_dinero: number }>(t.pool, 'SELECT con_dinero FROM reportes_programados WHERE id = ?', [id]);
  if (!actual) throw new ErrorNoEncontrado('No se encontró el envío programado');
  const v = await validarProgramado(t, d, permisos, actual.con_dinero === 1);
  await transaccion(t.pool, async (con) => {
    await ejecutar(
      con,
      'UPDATE reportes_programados SET nombre = ?, reporte = ?, filtros = ?, frecuencia = ?, dia_semana = ?, dia_mes = ?, con_dinero = ?, activo = ? WHERE id = ?',
      [v.nombre, d.reporte, JSON.stringify(v.filtros), d.frecuencia, d.frecuencia === 'semanal' ? d.dia_semana : null, d.frecuencia === 'mensual' ? d.dia_mes : null, v.conDinero ? 1 : 0, d.activo ? 1 : 0, id]
    );
    await guardarDestinatarios(con, id, v);
    await bitacora(con, actor, { accion: 'envio_programado_cambiado', entidad: 'reportes_programados', entidadId: id, despues: { nombre: v.nombre, reporte: d.reporte, frecuencia: d.frecuencia, activo: d.activo } });
  });
  return { id };
}

export async function eliminarProgramado(t: TallerReq, actor: Actor, id: number) {
  await transaccion(t.pool, async (con) => {
    const p = await una<{ nombre: string }>(con, 'SELECT nombre FROM reportes_programados WHERE id = ? FOR UPDATE', [id]);
    if (!p) throw new ErrorNoEncontrado('No se encontró el envío programado');
    await ejecutar(con, 'DELETE FROM reportes_programados WHERE id = ?', [id]);
    await bitacora(con, actor, { accion: 'envio_programado_eliminado', entidad: 'reportes_programados', entidadId: id, despues: { nombre: p.nombre } });
  });
  return { id };
}

// ── El envío ──────────────────────────────────────────────────────────────────────────
function pieDe(ctx: Contexto, t: TallerReq, empresa: string, moneda: string, emitidoPor: string | null): PieDeReporte {
  const { fecha, hora } = localDeUtc(ahoraDe(ctx), t.empresa.zonaHoraria);
  return { empresa, emitido: `${ddmmaaaa(fecha)} ${hora}`, emitidoPor, moneda };
}

async function cuerpoDelEnvio(ctx: Contexto, t: TallerReq, p: { nombre: string; reporte: string; filtros: FiltrosGuardados; con_dinero: boolean }) {
  const cfg = await leerConfiguracion(t);
  const r = await armarReporte(ctx, t, p.reporte, p.filtros, p.con_dinero);
  const pie = pieDe(ctx, t, String(cfg['nombre_empresa'] || t.empresa.nombre), String(cfg['moneda'] ?? 'GTQ'), null);
  const html = `${reporteAHtml(r, pie)}<p style="color:#6b7280;font-size:12px;">Este es un resumen dentro del correo. Para descargar el reporte completo en Excel o PDF, entre a Reportes.</p>`;
  return { asunto: `${r.titulo} · ${p.nombre}`.slice(0, 200), cuerpoHtml: plantillaCorreo(html) };
}

/** Los correos de un envío: roles activos, personas con acceso y correos sueltos. */
async function correosDe(t: TallerReq, id: number): Promise<string[]> {
  const f = await filas<{ correo: string | null }>(
    t.pool,
    `SELECT c.correo FROM reportes_programados_destinatarios d JOIN usuario_roles ur ON ur.rol_id = d.rol_id JOIN usuarios u ON u.id = ur.usuario_id AND u.activo = 1 JOIN colaboradores c ON c.id = u.colaborador_id AND c.activo = 1 WHERE d.reporte_programado_id = ? AND d.rol_id IS NOT NULL
     UNION
     SELECT c.correo FROM reportes_programados_destinatarios d JOIN usuarios u ON u.id = d.usuario_id AND u.activo = 1 JOIN colaboradores c ON c.id = u.colaborador_id AND c.activo = 1 WHERE d.reporte_programado_id = ? AND d.usuario_id IS NOT NULL
     UNION
     SELECT d.correo FROM reportes_programados_destinatarios d WHERE d.reporte_programado_id = ? AND d.correo IS NOT NULL`,
    [id, id, id]
  );
  return f.map((x) => x.correo).filter((c): c is string => !!c);
}

export function tocaEnviar(p: { frecuencia: 'diaria' | 'semanal' | 'mensual'; dia_semana: number | null; dia_mes: number | null }, hoy: string): boolean {
  if (p.frecuencia === 'diaria') return true;
  if (p.frecuencia === 'mensual') return Number(hoy.slice(8, 10)) === p.dia_mes;
  const dia = new Date(`${hoy}T00:00:00Z`).getUTCDay();
  return (dia === 0 ? 7 : dia) === p.dia_semana;
}

/** Manda los envíos programados que tocan hoy (a partir de las 7:00 del taller). Cada envío sale una sola vez por día. Devuelve cuántos salieron. */
export async function enviarProgramados(ctx: Contexto, t: TallerReq): Promise<number> {
  const hoy = hoyDelTaller(ctx, t);
  if (Number(localDeUtc(ahoraDe(ctx), t.empresa.zonaHoraria).hora.slice(0, 2)) < HORA_DE_ENVIO) return 0;
  const f = await filas<FilaProgramado>(t.pool, `SELECT ${COLUMNAS_PROGRAMADO} WHERE p.activo = 1 ORDER BY p.id`);
  let enviados = 0;
  for (const p of f) {
    if (!tocaEnviar(p, hoy)) continue;
    try {
      const clave = `prog:${p.id}:${hoy}`;
      if (await una(t.pool, "SELECT id FROM avisos_registro WHERE tipo_aviso = 'reporte_programado' AND clave = ?", [clave])) continue;
      // Si quien lo programó ya no tiene acceso, el envío no sale (no se manda dinero «a nombre» de alguien que ya no está).
      if (!(await una(t.pool, 'SELECT id FROM usuarios WHERE id = ? AND activo = 1', [p.creado_por_id]))) continue;
      const cuerpo = await cuerpoDelEnvio(ctx, t, { nombre: p.nombre, reporte: p.reporte, filtros: leerFiltros(p.filtros), con_dinero: p.con_dinero === 1 });
      const r = await enviarCorreoDeTaller(ctx, t, { tipo: 'reporte_programado', clave, destinatarios: await correosDe(t, p.id), referencia: p.nombre, ...cuerpo });
      if (r === 'encolado') {
        enviados += 1;
        await ejecutar(t.pool, 'UPDATE reportes_programados SET ultimo_envio_en = ? WHERE id = ?', [ahoraDe(ctx), p.id]);
      }
    } catch (error) {
      console.error(`[reportes] envío ${p.id} de ${t.empresa.slug}:`, error instanceof Error ? error.message : error);
    }
  }
  return enviados;
}

/** Manda el envío ahora, SOLO a quien lo pide, para ver cómo queda. No cuenta como envío del día. */
export async function probarProgramado(ctx: Contexto, t: TallerReq, actor: Actor, id: number) {
  const p = await una<FilaProgramado>(t.pool, `SELECT ${COLUMNAS_PROGRAMADO} WHERE p.id = ?`, [id]);
  if (!p) throw new ErrorNoEncontrado('No se encontró el envío programado');
  const correo = await correoDeUsuario(t, actor.usuarioId);
  if (!correo) throw new ErrorValidacion('Su usuario no tiene un correo registrado: agréguelo en Colaboradores para recibir la prueba');
  const cuerpo = await cuerpoDelEnvio(ctx, t, { nombre: p.nombre, reporte: p.reporte, filtros: leerFiltros(p.filtros), con_dinero: p.con_dinero === 1 });
  await encolarCorreo(ctx.pool, { tipo: 'reporte_prueba', destinatarios: [correo], asunto: `PRUEBA: ${cuerpo.asunto}`.slice(0, 200), cuerpoHtml: cuerpo.cuerpoHtml, claveUnica: `t${t.empresa.id}:prueba_rep:${id}:${ahoraDe(ctx).getTime()}:${actor.usuarioId}`.slice(0, 120) });
  return { enviado_a: correo };
}

/** Para las pantallas: las fechas que resultan de un periodo relativo hoy. */
export function periodoDeHoy(ctx: Contexto, t: TallerReq, f: FiltrosGuardados) {
  const r = resolverPeriodo(ctx, t, f);
  return { desde: r.desde, hasta: r.hasta };
}
