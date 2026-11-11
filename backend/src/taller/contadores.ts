import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { validarFechaRazonable } from '../utils/fechas';
import { normalizarCampo } from '../utils/texto';
import { urlFirmada } from './archivos';
import { Actor, bitacora, TallerReq } from './comun';

/** Hoy (AAAA-MM-DD) en la zona horaria DEL TALLER: a las 23:00 de Guatemala ya es "mañana" en UTC, y ahí se equivocaba el sistema anterior. */
export function hoyDelTaller(ctx: Contexto, t: TallerReq): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: t.empresa.zonaHoraria, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ahoraDe(ctx));
}

function dias(desde: string, hasta: string): number {
  return Math.floor((new Date(`${hasta}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime()) / 86400000);
}

export interface FilaContador {
  id: number;
  equipo_id: number;
  componente_id: number | null;
  componente: string | null;
  tipo_contador_id: number;
  tipo: string;
  unidad: string;
  es_calendario: boolean;
  nombre: string;
  valor_inicial: number;
  valor_actual: number;
  fecha_inicio: string;
  ultima_lectura_en: string | null;
  es_principal: boolean;
  activo: boolean;
}

/** Contadores de un equipo. Los de calendario no guardan lecturas: su valor son los días corridos desde que se inició. */
export async function listarContadores(ctx: Contexto, t: TallerReq, equipoId: number): Promise<FilaContador[]> {
  const hoy = hoyDelTaller(ctx, t);
  const f = await filas<{
    id: number; equipo_id: number; componente_id: number | null; componente: string | null; tipo_contador_id: number; tipo: string; unidad: string; es_calendario: number; nombre: string;
    valor_inicial: number; valor_actual: number; fecha_inicio: string; ultima_lectura_en: string | null; es_principal: number; activo: number;
  }>(
    t.pool,
    `SELECT c.id, c.equipo_id, c.componente_id, cp.nombre AS componente, c.tipo_contador_id, tc.nombre AS tipo, u.codigo AS unidad, tc.es_calendario, c.nombre,
            c.valor_inicial, c.valor_actual, DATE_FORMAT(c.fecha_inicio, '%Y-%m-%d') AS fecha_inicio, DATE_FORMAT(c.ultima_lectura_en, '%Y-%m-%d') AS ultima_lectura_en,
            c.es_principal, c.activo
       FROM contadores c JOIN tipos_contador tc ON tc.id = c.tipo_contador_id JOIN unidades u ON u.id = tc.unidad_id LEFT JOIN componentes cp ON cp.id = c.componente_id
      WHERE c.equipo_id = ? ORDER BY c.es_principal DESC, c.id`,
    [equipoId]
  );
  return f.map((c) => ({
    ...c,
    es_calendario: c.es_calendario === 1,
    es_principal: c.es_principal === 1,
    activo: c.activo === 1,
    valor_inicial: Number(c.valor_inicial),
    valor_actual: c.es_calendario === 1 ? Math.max(0, dias(c.fecha_inicio, hoy)) : Number(c.valor_actual),
  }));
}

async function obtenerContadorCrudo(con: Ejecutor, id: number) {
  const c = await una<{ id: number; equipo_id: number; componente_id: number | null; tipo_contador_id: number; es_calendario: number; fecha_inicio: string; activo: number; equipo_estado: string }>(
    con,
    `SELECT c.id, c.equipo_id, c.componente_id, c.tipo_contador_id, tc.es_calendario, DATE_FORMAT(c.fecha_inicio, '%Y-%m-%d') AS fecha_inicio, c.activo, e.estado AS equipo_estado
       FROM contadores c JOIN tipos_contador tc ON tc.id = c.tipo_contador_id JOIN equipos e ON e.id = c.equipo_id WHERE c.id = ? FOR UPDATE`,
    [id]
  );
  if (!c) throw new ErrorNoEncontrado('No se encontró el contador');
  return c;
}

export interface DatosContador {
  tipo_contador_id: number;
  componente_id?: number | null;
  nombre?: string | null;
  valor_inicial?: number;
  fecha_inicio?: string;
  es_principal?: boolean;
}

/**
 * Crea un contador (medidor) del equipo y su lectura "inicial": desde que existe, lleva su valor. El primero de un grupo
 * (el equipo o un componente) es el principal; hay uno solo por grupo.
 */
export async function crearContadorEn(ctx: Contexto, t: TallerReq, con: Ejecutor, actor: Actor, equipoId: number, d: DatosContador): Promise<number> {
  const hoy = hoyDelTaller(ctx, t);
  const tipo = await una<{ nombre: string; es_calendario: number; activo: number }>(con, 'SELECT nombre, es_calendario, activo FROM tipos_contador WHERE id = ?', [d.tipo_contador_id]);
  if (!tipo || tipo.activo !== 1) throw new ErrorValidacion('El tipo de contador elegido no existe o está desactivado');
  let componente: { nombre: string } | null = null;
  if (d.componente_id) {
    componente = await una<{ nombre: string }>(con, 'SELECT nombre FROM componentes WHERE id = ? AND equipo_id = ? AND activo = 1', [d.componente_id, equipoId]);
    if (!componente) throw new ErrorValidacion('El componente elegido no existe en este equipo');
  }
  const fecha = d.fecha_inicio ?? hoy;
  validarFechaRazonable(fecha, 'fecha_inicio', { noFutura: true, hoy });
  const valor = d.valor_inicial ?? 0;
  if (valor < 0) throw new ErrorValidacion('El valor inicial no puede ser negativo');
  if (tipo.es_calendario === 1 && valor !== 0) throw new ErrorValidacion('Un contador de calendario siempre empieza en cero');
  const nombre = normalizarCampo('texto', d.nombre) ?? `${tipo.nombre}${componente ? ` ${componente.nombre}` : ''}`;
  const grupo = await una<{ n: number }>(con, `SELECT COUNT(*) AS n FROM contadores WHERE equipo_id = ? AND ${d.componente_id ? 'componente_id = ?' : 'componente_id IS NULL'} AND es_principal = 1`, d.componente_id ? [equipoId, d.componente_id] : [equipoId]);
  const principal = Number(grupo?.n) === 0 || d.es_principal === true;
  if (principal) await ejecutar(con, `UPDATE contadores SET es_principal = 0 WHERE equipo_id = ? AND ${d.componente_id ? 'componente_id = ?' : 'componente_id IS NULL'}`, d.componente_id ? [equipoId, d.componente_id] : [equipoId]);
  const r = await ejecutar(
    con,
    'INSERT INTO contadores (equipo_id, componente_id, tipo_contador_id, nombre, valor_inicial, valor_actual, fecha_inicio, ultima_lectura_en, es_principal) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [equipoId, d.componente_id ?? null, d.tipo_contador_id, nombre, valor, valor, fecha, tipo.es_calendario === 1 ? null : fecha, principal ? 1 : 0]
  );
  if (tipo.es_calendario !== 1) {
    await ejecutar(con, "INSERT INTO lecturas_contador (contador_id, valor, fecha, origen, registrado_por, estado) VALUES (?, ?, ?, 'inicial', ?, 'valida')", [r.insertId, valor, fecha, actor.usuarioId]);
  }
  await bitacora(con, actor, { accion: 'contador_creado', entidad: 'contadores', entidadId: r.insertId, despues: { equipoId, ...d, nombre } });
  return r.insertId;
}

export async function crearContador(ctx: Contexto, t: TallerReq, actor: Actor, equipoId: number, d: DatosContador): Promise<FilaContador[]> {
  await transaccion(t.pool, async (con) => {
    const e = await una<{ estado: string }>(con, 'SELECT estado FROM equipos WHERE id = ? FOR UPDATE', [equipoId]);
    if (!e) throw new ErrorNoEncontrado('No se encontró el equipo');
    if (e.estado === 'baja') throw new ErrorApp(409, 'REGLA', 'El equipo está dado de baja.');
    await crearContadorEn(ctx, t, con, actor, equipoId, d);
  });
  return listarContadores(ctx, t, equipoId);
}

export async function actualizarContador(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { nombre?: string; activo?: boolean; es_principal?: boolean }): Promise<FilaContador[]> {
  let equipoId = 0;
  await transaccion(t.pool, async (con) => {
    const c = await obtenerContadorCrudo(con, id);
    equipoId = c.equipo_id;
    const sets: string[] = [];
    const valores: unknown[] = [];
    if (d.nombre !== undefined) {
      sets.push('nombre = ?');
      valores.push(normalizarCampo('texto', d.nombre));
    }
    if (d.activo !== undefined) {
      if (d.activo === false) {
        const act = await una<{ es_principal: number }>(con, 'SELECT es_principal FROM contadores WHERE id = ?', [id]);
        if (act?.es_principal === 1) {
          const otros = await una<{ n: number }>(con, `SELECT COUNT(*) AS n FROM contadores WHERE equipo_id = ? AND id <> ? AND activo = 1 AND ${c.componente_id ? 'componente_id = ?' : 'componente_id IS NULL'}`, c.componente_id ? [c.equipo_id, id, c.componente_id] : [c.equipo_id, id]);
          if (Number(otros?.n) > 0) throw new ErrorApp(409, 'REGLA', 'Este es el contador principal: marque otro como principal antes de desactivarlo.');
        }
      }
      sets.push('activo = ?');
      valores.push(d.activo ? 1 : 0);
    }
    if (d.es_principal === true) {
      await ejecutar(con, `UPDATE contadores SET es_principal = 0 WHERE equipo_id = ? AND ${c.componente_id ? 'componente_id = ?' : 'componente_id IS NULL'}`, c.componente_id ? [c.equipo_id, c.componente_id] : [c.equipo_id]);
      sets.push('es_principal = 1');
    } else if (d.es_principal === false) {
      const act = await una<{ es_principal: number }>(con, 'SELECT es_principal FROM contadores WHERE id = ?', [id]);
      if (act?.es_principal === 1) throw new ErrorApp(409, 'REGLA', 'Para cambiar el contador principal, marque otro como principal.');
    }
    if (sets.length === 0) return;
    await ejecutar(con, `UPDATE contadores SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
    await bitacora(con, actor, { accion: 'contador_editado', entidad: 'contadores', entidadId: id, despues: d });
  });
  return listarContadores(ctx, t, equipoId);
}

// ── Lecturas ─────────────────────────────────────────────────────────────────────────
export interface FilaLectura {
  id: number;
  contador_id: number;
  valor: number;
  fecha: string;
  origen: string;
  estado: 'valida' | 'pendiente_revision' | 'anulada';
  notas: string | null;
  registrado_por: string | null;
  archivo_id: number | null;
  foto_url: string | null;
  anulada_en: string | null;
  anulada_por: string | null;
  motivo_anulacion: string | null;
}

export async function listarLecturas(ctx: Contexto, t: TallerReq, contadorId: number, incluirAnuladas = true): Promise<FilaLectura[]> {
  if (!(await una(t.pool, 'SELECT id FROM contadores WHERE id = ?', [contadorId]))) throw new ErrorNoEncontrado('No se encontró el contador');
  const f = await filas<Omit<FilaLectura, 'valor' | 'foto_url'> & { valor: number }>(
    t.pool,
    `SELECT l.id, l.contador_id, l.valor, DATE_FORMAT(l.fecha, '%Y-%m-%d') AS fecha, l.origen, l.estado, l.notas, cr.nombre_completo AS registrado_por, l.archivo_id,
            l.anulada_en, ca.nombre_completo AS anulada_por, l.motivo_anulacion
       FROM lecturas_contador l
       LEFT JOIN usuarios ur ON ur.id = l.registrado_por LEFT JOIN colaboradores cr ON cr.id = ur.colaborador_id
       LEFT JOIN usuarios ua ON ua.id = l.anulada_por LEFT JOIN colaboradores ca ON ca.id = ua.colaborador_id
      WHERE l.contador_id = ? ${incluirAnuladas ? '' : "AND l.estado <> 'anulada'"} ORDER BY l.fecha DESC, l.id DESC LIMIT 500`,
    [contadorId]
  );
  return f.map((l) => ({ ...l, valor: Number(l.valor), foto_url: l.archivo_id ? urlFirmada(ctx, t.empresa.slug, l.archivo_id) : null }));
}

/** El contador toma el valor de su mejor lectura vigente (la última válida por fecha). */
async function recalcular(con: Ejecutor, contadorId: number): Promise<void> {
  const ult = await una<{ valor: number; fecha: string }>(
    con,
    "SELECT valor, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha FROM lecturas_contador WHERE contador_id = ? AND estado = 'valida' ORDER BY fecha DESC, id DESC LIMIT 1",
    [contadorId]
  );
  if (ult) await ejecutar(con, 'UPDATE contadores SET valor_actual = ?, ultima_lectura_en = ? WHERE id = ?', [ult.valor, ult.fecha, contadorId]);
  else await ejecutar(con, 'UPDATE contadores SET valor_actual = valor_inicial, ultima_lectura_en = NULL WHERE id = ?', [contadorId]);
}

export async function registrarLectura(
  ctx: Contexto,
  t: TallerReq,
  actor: Actor,
  contadorId: number,
  d: { valor: number; fecha?: string; notas?: string | null }
): Promise<FilaLectura> {
  const hoy = hoyDelTaller(ctx, t);
  const id = await transaccion(t.pool, async (con) => {
    const c = await obtenerContadorCrudo(con, contadorId);
    if (c.activo !== 1) throw new ErrorApp(409, 'REGLA', 'El contador está desactivado.');
    if (c.equipo_estado === 'baja') throw new ErrorApp(409, 'REGLA', 'El equipo está dado de baja.');
    if (c.es_calendario === 1) throw new ErrorApp(409, 'REGLA', 'Un contador de calendario cuenta los días solo: no se le registran lecturas.');
    if (!Number.isFinite(d.valor) || d.valor < 0) throw new ErrorValidacion('La lectura no puede ser negativa');
    const fecha = d.fecha ?? hoy;
    validarFechaRazonable(fecha, 'fecha', { noFutura: true, hoy });
    if (fecha < c.fecha_inicio) throw new ErrorValidacion('La lectura no puede ser anterior a la fecha en que se inició el contador');
    // Un medidor solo avanza: el valor debe quedar entre la lectura anterior y la siguiente (si la hay) de esa fecha.
    const antes = await una<{ v: number | null }>(con, "SELECT MAX(valor) AS v FROM lecturas_contador WHERE contador_id = ? AND estado <> 'anulada' AND fecha <= ?", [contadorId, fecha]);
    const despues = await una<{ v: number | null }>(con, "SELECT MIN(valor) AS v FROM lecturas_contador WHERE contador_id = ? AND estado <> 'anulada' AND fecha > ?", [contadorId, fecha]);
    if (antes?.v !== null && antes?.v !== undefined && d.valor < Number(antes.v)) {
      throw new ErrorApp(409, 'LECTURA_MENOR', `La lectura (${d.valor}) es menor que la anterior (${Number(antes.v)}). Si la anterior estaba equivocada, anúlela primero.`);
    }
    if (despues?.v !== null && despues?.v !== undefined && d.valor > Number(despues.v)) {
      throw new ErrorApp(409, 'LECTURA_MAYOR', `La lectura (${d.valor}) es mayor que una lectura posterior (${Number(despues.v)}). Revise la fecha o anule la posterior.`);
    }
    const r = await ejecutar(con, "INSERT INTO lecturas_contador (contador_id, valor, fecha, origen, registrado_por, notas, estado) VALUES (?, ?, ?, 'manual', ?, ?, 'valida')", [
      contadorId,
      d.valor,
      fecha,
      actor.usuarioId,
      normalizarCampo('texto', d.notas),
    ]);
    await recalcular(con, contadorId);
    await bitacora(con, actor, { accion: 'lectura_registrada', entidad: 'lecturas_contador', entidadId: r.insertId, despues: { contadorId, valor: d.valor, fecha } });
    return r.insertId;
  });
  return (await listarLecturas(ctx, t, contadorId)).find((l) => l.id === id) as FilaLectura;
}

/** Anula una lectura equivocada: queda con quién, cuándo y por qué. Nunca se borra y la lectura inicial no se anula. */
export async function anularLectura(ctx: Contexto, t: TallerReq, actor: Actor, lecturaId: number, motivo: string): Promise<FilaLectura> {
  const texto = normalizarCampo('texto', motivo) ?? '';
  if (texto.length < 3) throw new ErrorValidacion('Escriba el motivo de la anulación');
  const contadorId = await transaccion(t.pool, async (con) => {
    const l = await una<{ contador_id: number; estado: string; origen: string }>(con, 'SELECT contador_id, estado, origen FROM lecturas_contador WHERE id = ? FOR UPDATE', [lecturaId]);
    if (!l) throw new ErrorNoEncontrado('No se encontró la lectura');
    if (l.estado === 'anulada') throw new ErrorApp(409, 'REGLA', 'Esa lectura ya está anulada.');
    if (l.origen === 'inicial') throw new ErrorApp(409, 'REGLA', 'La lectura inicial no se anula: es el punto de partida del contador.');
    await obtenerContadorCrudo(con, l.contador_id); // bloquea el contador
    await ejecutar(con, "UPDATE lecturas_contador SET estado = 'anulada', anulada_en = ?, anulada_por = ?, motivo_anulacion = ? WHERE id = ?", [ahoraDe(ctx), actor.usuarioId, texto.slice(0, 300), lecturaId]);
    await recalcular(con, l.contador_id);
    await bitacora(con, actor, { accion: 'lectura_anulada', entidad: 'lecturas_contador', entidadId: lecturaId, motivo: texto });
    return l.contador_id;
  });
  return (await listarLecturas(ctx, t, contadorId)).find((x) => x.id === lecturaId) as FilaLectura;
}

/** Enlaza la foto del tablero a una lectura (la foto se sube aparte, en una sola vez, sin dejar archivos huérfanos). */
export async function adjuntarFotoALectura(con: Ejecutor, lecturaId: number, archivoId: number): Promise<void> {
  const r = await ejecutar(con, 'UPDATE lecturas_contador SET archivo_id = ? WHERE id = ? AND archivo_id IS NULL', [archivoId, lecturaId]);
  if (r.affectedRows !== 1) throw new ErrorApp(409, 'REGLA', 'Esa lectura ya tiene foto o no existe.');
}
