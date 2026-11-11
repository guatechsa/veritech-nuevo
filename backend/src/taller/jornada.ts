import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { validarFechaRazonable } from '../utils/fechas';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, TallerReq } from './comun';

const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface DiaDeJornada {
  dia_semana: number;
  desde: string;
  hasta: string;
  pausa_desde?: string | null;
  pausa_hasta?: string | null;
}

/** Jornada de la empresa (colaboradorId = null) o la propia de una persona. Un día sin fila es de descanso. */
export async function obtenerJornada(t: TallerReq, colaboradorId: number | null) {
  const dias = await filas<DiaDeJornada>(
    t.pool,
    `SELECT dia_semana, TIME_FORMAT(desde, '%H:%i') AS desde, TIME_FORMAT(hasta, '%H:%i') AS hasta,
            TIME_FORMAT(pausa_desde, '%H:%i') AS pausa_desde, TIME_FORMAT(pausa_hasta, '%H:%i') AS pausa_hasta
       FROM jornadas WHERE ${colaboradorId === null ? 'colaborador_id IS NULL' : 'colaborador_id = ?'} ORDER BY dia_semana`,
    colaboradorId === null ? [] : [colaboradorId]
  );
  return dias;
}

function validarDias(dias: DiaDeJornada[]): void {
  const vistos = new Set<number>();
  for (const d of dias) {
    if (!Number.isInteger(d.dia_semana) || d.dia_semana < 1 || d.dia_semana > 7) throw new ErrorValidacion('El día de la semana debe ser de 1 (lunes) a 7 (domingo)');
    if (vistos.has(d.dia_semana)) throw new ErrorValidacion('Un día está repetido en la jornada');
    vistos.add(d.dia_semana);
    if (!HORA.test(d.desde) || !HORA.test(d.hasta)) throw new ErrorValidacion('Las horas deben tener el formato HH:MM');
    if (d.desde >= d.hasta) throw new ErrorValidacion('La hora de salida debe ser después de la de entrada');
    const tieneDesde = d.pausa_desde !== undefined && d.pausa_desde !== null && d.pausa_desde !== '';
    const tieneHasta = d.pausa_hasta !== undefined && d.pausa_hasta !== null && d.pausa_hasta !== '';
    if (tieneDesde !== tieneHasta) throw new ErrorValidacion('El almuerzo necesita hora de inicio y de fin');
    if (tieneDesde && tieneHasta) {
      if (!HORA.test(d.pausa_desde as string) || !HORA.test(d.pausa_hasta as string)) throw new ErrorValidacion('Las horas del almuerzo deben tener el formato HH:MM');
      if ((d.pausa_desde as string) >= (d.pausa_hasta as string) || (d.pausa_desde as string) < d.desde || (d.pausa_hasta as string) > d.hasta) {
        throw new ErrorValidacion('El almuerzo debe quedar dentro de la jornada');
      }
    }
  }
}

/** Reemplaza la jornada completa. Para una persona, una lista vacía borra la suya y vuelve a valer la de la empresa. */
export async function guardarJornada(t: TallerReq, actor: Actor, colaboradorId: number | null, dias: DiaDeJornada[]) {
  validarDias(dias);
  if (colaboradorId === null && dias.length === 0) throw new ErrorValidacion('La jornada de la empresa necesita al menos un día de trabajo');
  await transaccion(t.pool, async (con) => {
    if (colaboradorId !== null && !(await una(con, 'SELECT id FROM colaboradores WHERE id = ?', [colaboradorId]))) throw new ErrorNoEncontrado('No se encontró al colaborador');
    const antes = await obtenerJornada(t, colaboradorId);
    await ejecutar(con, colaboradorId === null ? 'DELETE FROM jornadas WHERE colaborador_id IS NULL' : 'DELETE FROM jornadas WHERE colaborador_id = ?', colaboradorId === null ? [] : [colaboradorId]);
    for (const d of dias) {
      await ejecutar(con, 'INSERT INTO jornadas (colaborador_id, dia_semana, desde, hasta, pausa_desde, pausa_hasta) VALUES (?, ?, ?, ?, ?, ?)', [
        colaboradorId,
        d.dia_semana,
        d.desde,
        d.hasta,
        d.pausa_desde || null,
        d.pausa_hasta || null,
      ]);
    }
    await bitacora(con, actor, { accion: 'jornada_editada', entidad: 'jornadas', entidadId: colaboradorId, antes, despues: dias });
  });
  return obtenerJornada(t, colaboradorId);
}

/** La jornada que de verdad aplica a una persona: la suya si tiene, y si no la de la empresa. */
export async function jornadaEfectiva(t: TallerReq, colaboradorId: number) {
  const propia = await obtenerJornada(t, colaboradorId);
  return propia.length > 0 ? { origen: 'propia' as const, dias: propia } : { origen: 'empresa' as const, dias: await obtenerJornada(t, null) };
}

// ── Ausencias ────────────────────────────────────────────────────────────────────────

export type TipoAusencia = 'vacaciones' | 'permiso' | 'incapacidad' | 'otro';

export interface DatosAusencia {
  colaborador_id?: number;
  desde?: string;
  hasta?: string;
  tipo?: TipoAusencia;
  notas?: string | null;
}

export async function listarAusencias(t: TallerReq, f: { colaborador_id?: number; desde?: string; hasta?: string }) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (f.colaborador_id) {
    donde.push('a.colaborador_id = ?');
    params.push(f.colaborador_id);
  }
  // Las que tocan el rango pedido (se cruzan con él).
  if (f.hasta) {
    donde.push('a.desde <= ?');
    params.push(f.hasta);
  }
  if (f.desde) {
    donde.push('a.hasta >= ?');
    params.push(f.desde);
  }
  return filas(
    t.pool,
    `SELECT a.id, a.colaborador_id, c.nombre_completo AS colaborador, DATE_FORMAT(a.desde, '%Y-%m-%d') AS desde, DATE_FORMAT(a.hasta, '%Y-%m-%d') AS hasta, a.tipo, a.notas
       FROM ausencias a JOIN colaboradores c ON c.id = a.colaborador_id
       ${donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : ''} ORDER BY a.desde DESC, a.id DESC LIMIT 500`,
    params
  );
}

async function obtenerAusencia(t: TallerReq, id: number) {
  const f = (await listarAusencias(t, {})).find((a) => a['id'] === id);
  if (!f) throw new ErrorNoEncontrado('No se encontró la ausencia');
  return f;
}

async function validarAusencia(t: TallerReq, colaboradorId: number, desde: string, hasta: string, exceptoId: number | null): Promise<void> {
  validarFechaRazonable(desde, 'desde');
  validarFechaRazonable(hasta, 'hasta');
  if (desde > hasta) throw new ErrorValidacion('La fecha final no puede ser antes de la inicial');
  const cruza = await una<{ id: number }>(t.pool, 'SELECT id FROM ausencias WHERE colaborador_id = ? AND id <> ? AND desde <= ? AND hasta >= ? LIMIT 1', [colaboradorId, exceptoId ?? 0, hasta, desde]);
  if (cruza) throw new ErrorApp(409, 'CONFLICTO', 'Esa persona ya tiene una ausencia en esas fechas.');
}

export async function crearAusencia(t: TallerReq, actor: Actor, d: DatosAusencia & { colaborador_id: number; desde: string; hasta: string; tipo: TipoAusencia }) {
  if (!(await una(t.pool, 'SELECT id FROM colaboradores WHERE id = ?', [d.colaborador_id]))) throw new ErrorNoEncontrado('No se encontró al colaborador');
  await validarAusencia(t, d.colaborador_id, d.desde, d.hasta, null);
  const id = await transaccion(t.pool, async (con) => {
    const r = await ejecutar(con, 'INSERT INTO ausencias (colaborador_id, desde, hasta, tipo, notas, creada_por) VALUES (?, ?, ?, ?, ?, ?)', [d.colaborador_id, d.desde, d.hasta, d.tipo, normalizarCampo('texto', d.notas), actor.usuarioId]);
    await bitacora(con, actor, { accion: 'ausencia_creada', entidad: 'ausencias', entidadId: r.insertId, despues: d });
    return r.insertId;
  });
  return obtenerAusencia(t, id);
}

export async function actualizarAusencia(t: TallerReq, actor: Actor, id: number, d: DatosAusencia) {
  const antes = await obtenerAusencia(t, id);
  const desde = d.desde ?? String(antes['desde']);
  const hasta = d.hasta ?? String(antes['hasta']);
  await validarAusencia(t, Number(antes['colaborador_id']), desde, hasta, id);
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'UPDATE ausencias SET desde = ?, hasta = ?, tipo = ?, notas = ? WHERE id = ?', [
      desde,
      hasta,
      d.tipo ?? antes['tipo'],
      d.notas === undefined ? antes['notas'] : normalizarCampo('texto', d.notas),
      id,
    ]);
    await bitacora(con, actor, { accion: 'ausencia_editada', entidad: 'ausencias', entidadId: id, antes, despues: d });
  });
  return obtenerAusencia(t, id);
}

export async function eliminarAusencia(t: TallerReq, actor: Actor, id: number): Promise<void> {
  const antes = await obtenerAusencia(t, id);
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'DELETE FROM ausencias WHERE id = ?', [id]);
    await bitacora(con, actor, { accion: 'ausencia_eliminada', entidad: 'ausencias', entidadId: id, antes });
  });
}
