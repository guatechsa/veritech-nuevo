import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { validarFechaRazonable } from '../utils/fechas';
import { normalizarCampo } from '../utils/texto';
import { limitesDelDia, localDeUtc, utcDeLocal } from '../utils/zona';
import { Actor, bitacora, TallerReq } from './comun';
import { leerConfiguracion } from './configuracion';
import { hoyDelTaller } from './contadores';
import { descripcionDeEquipo } from './equipos';
import { crearOrdenEn, DatosOrdenNueva } from './ordenes';

/**
 * Citas (Fase 4c). Una cita es una reserva de espacio, aparte de la orden:
 *  - siempre termina en SE PRESENTÓ (se recibe el equipo y nace la orden), NO SE PRESENTÓ o CANCELADA (con motivo);
 *  - el taller elige si el cupo diario de la sucursal solo se avisa («solo coordinar») o se hace cumplir («reservar»);
 *  - el servidor recibe y entrega el día y la hora DEL TALLER y guarda UTC.
 */

export interface DatosCita {
  fecha?: string;
  hora?: string;
  sucursal_id?: number;
  horas_estimadas?: number;
  notas?: string | null;
  lectura_contador?: number | null;
}

export interface DatosCitaNueva extends DatosCita {
  equipo_id: number;
  fecha: string;
  hora: string;
  origen?: 'recepcion' | 'aviso' | 'portal';
  servicio_programado_id?: number;
}

const HORA = /^([01]\d|2[0-3]):([0-5]\d)$/;

async function cupoDelDia(con: Ejecutor, t: TallerReq, sucursalId: number, fecha: string, exceptoCitaId: number | null) {
  const s = await una<{ cupo: number | null; nombre: string }>(con, 'SELECT cupo_diario_citas AS cupo, nombre FROM sucursales WHERE id = ?', [sucursalId]);
  const { desde, hasta } = limitesDelDia(fecha, t.empresa.zonaHoraria);
  const n = await una<{ n: number }>(con, "SELECT COUNT(*) AS n FROM citas WHERE sucursal_id = ? AND estado <> 'cancelada' AND fecha_hora >= ? AND fecha_hora < ? AND id <> ?", [sucursalId, desde, hasta, exceptoCitaId ?? 0]);
  return { cupo: s?.cupo ?? null, usadas: Number(n?.n ?? 0), sucursal: s?.nombre ?? '' };
}

/** Revisa día, hora y cupo. Devuelve los avisos (cosas que se deben saber pero no impiden guardar). */
async function revisarHorario(ctx: Contexto, t: TallerReq, con: Ejecutor, d: { fecha: string; hora: string; sucursal_id: number; equipo_id: number }, exceptoCitaId: number | null): Promise<Array<{ tipo: string; mensaje: string }>> {
  const hoy = hoyDelTaller(ctx, t);
  validarFechaRazonable(d.fecha, 'fecha', { hoy });
  if (!HORA.test(d.hora)) throw new ErrorValidacion('La hora debe escribirse como HH:MM, por ejemplo 14:30');
  if (d.fecha < hoy) throw new ErrorValidacion('La fecha de la cita no puede ser anterior a hoy');
  const avisos: Array<{ tipo: string; mensaje: string }> = [];
  const modo = (await leerConfiguracion(t))['modo_citas'];
  const c = await cupoDelDia(con, t, d.sucursal_id, d.fecha, exceptoCitaId);
  if (c.cupo !== null && c.usadas >= c.cupo) {
    const texto = `La sucursal ${c.sucursal} ya tiene ${c.usadas} citas ese día (cupo: ${c.cupo}).`;
    if (modo === 'RESERVAR') throw new ErrorApp(409, 'SIN_CUPO', `${texto} Elija otro día u otra sucursal.`, { cupo: c.cupo, usadas: c.usadas });
    avisos.push({ tipo: 'cupo_lleno', mensaje: `${texto} Se agendó igual porque el taller trabaja en «solo coordinar».` });
  }
  const { desde, hasta } = limitesDelDia(d.fecha, t.empresa.zonaHoraria);
  const otra = await una<{ id: number }>(con, "SELECT id FROM citas WHERE equipo_id = ? AND estado = 'programada' AND fecha_hora >= ? AND fecha_hora < ? AND id <> ? LIMIT 1", [d.equipo_id, desde, hasta, exceptoCitaId ?? 0]);
  if (otra) avisos.push({ tipo: 'ya_tiene_cita', mensaje: 'Este equipo ya tiene otra cita ese mismo día.' });
  return avisos;
}

const SELECT_CITA = `c.id, c.equipo_id, c.fecha_hora, c.horas_estimadas, c.estado, c.origen, c.notas, c.lectura_contador, c.llegada_en, c.sucursal_id, s.nombre AS sucursal, c.servicio_programado_id, sp.nombre AS servicio,
  e.codigo_interno, e.placa, m.nombre AS marca, e.modelo, te.nombre AS tipo_equipo, cl.nombre AS cliente, mo.nombre AS motivo_cancelacion, c.motivo_cancelacion_texto,
  (SELECT o.id FROM ordenes o WHERE o.cita_id = c.id LIMIT 1) AS orden_id, (SELECT o.numero FROM ordenes o WHERE o.cita_id = c.id LIMIT 1) AS orden_numero`;
const DE_CITA = `FROM citas c JOIN equipos e ON e.id = c.equipo_id JOIN tipos_equipo te ON te.id = e.tipo_equipo_id JOIN sucursales s ON s.id = c.sucursal_id LEFT JOIN marcas m ON m.id = e.marca_id
  LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN motivos mo ON mo.id = c.motivo_cancelacion_id LEFT JOIN servicios_programados sp ON sp.id = c.servicio_programado_id`;

type FilaCita = { id: number; fecha_hora: Date; codigo_interno: string | null; placa: string | null; marca: string | null; modelo: string | null; tipo_equipo: string; llegada_en: Date | null; horas_estimadas: number } & Record<string, unknown>;

function presentar(t: TallerReq, c: FilaCita, ahora: Date) {
  const { codigo_interno, placa, marca, modelo, fecha_hora, llegada_en, ...resto } = c;
  const local = localDeUtc(fecha_hora, t.empresa.zonaHoraria);
  const minutosTarde = llegada_en ? Math.round((llegada_en.getTime() - fecha_hora.getTime()) / 60000) : null;
  return {
    ...resto,
    horas_estimadas: Number(c.horas_estimadas),
    equipo: descripcionDeEquipo({ id: Number(c['equipo_id']), codigo_interno, placa, marca, modelo, tipo_equipo: c.tipo_equipo }),
    fecha: local.fecha,
    hora: local.hora,
    llegada_en,
    /** Positivo = llegó tarde; negativo = llegó antes. */
    minutos_de_diferencia: minutosTarde,
    ya_paso: fecha_hora.getTime() < ahora.getTime(),
  };
}

export async function listarCitas(ctx: Contexto, t: TallerReq, f: { desde?: string; hasta?: string; estado?: string; equipo_id?: number; sucursal_id?: number; pagina: number; porPagina: number }) {
  const donde: string[] = ['1 = 1'];
  const params: unknown[] = [];
  const zona = t.empresa.zonaHoraria;
  if (f.desde) {
    donde.push('c.fecha_hora >= ?');
    params.push(limitesDelDia(f.desde, zona).desde);
  }
  if (f.hasta) {
    donde.push('c.fecha_hora < ?');
    params.push(limitesDelDia(f.hasta, zona).hasta);
  }
  if (f.estado) {
    donde.push('c.estado = ?');
    params.push(f.estado);
  }
  if (f.equipo_id) {
    donde.push('c.equipo_id = ?');
    params.push(f.equipo_id);
  }
  if (f.sucursal_id) {
    donde.push('c.sucursal_id = ?');
    params.push(f.sucursal_id);
  }
  const where = `WHERE ${donde.join(' AND ')}`;
  const total = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n ${DE_CITA} ${where}`, params);
  const registros = await filas<FilaCita>(t.pool, `SELECT ${SELECT_CITA} ${DE_CITA} ${where} ORDER BY c.fecha_hora, c.id LIMIT ? OFFSET ?`, [...params, f.porPagina, (f.pagina - 1) * f.porPagina]);
  const ahora = ahoraDe(ctx);
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros: registros.map((r) => presentar(t, r, ahora)) };
}

async function obtenerCita(ctx: Contexto, t: TallerReq, id: number) {
  const c = await una<FilaCita>(t.pool, `SELECT ${SELECT_CITA} ${DE_CITA} WHERE c.id = ?`, [id]);
  if (!c) throw new ErrorNoEncontrado('No se encontró la cita');
  return presentar(t, c, ahoraDe(ctx));
}

export async function crearCita(ctx: Contexto, t: TallerReq, actor: Actor, d: DatosCitaNueva) {
  const notas = normalizarCampo('multilinea', d.notas);
  const horas = d.horas_estimadas ?? 1;
  if (!(horas >= 0.25 && horas <= 24)) throw new ErrorValidacion('Las horas estimadas deben estar entre 0.25 y 24');
  const { id, avisos } = await transaccion(t.pool, async (con) => {
    const e = await una<{ estado: string; cliente_id: number | null }>(con, 'SELECT estado, cliente_id FROM equipos WHERE id = ? FOR UPDATE', [d.equipo_id]);
    if (!e) throw new ErrorValidacion('El equipo elegido no existe');
    if (e.estado === 'baja') throw new ErrorApp(409, 'REGLA', 'El equipo está dado de baja: reactívelo antes de darle una cita.');
    let sucursalId = d.sucursal_id ?? null;
    if (!sucursalId) sucursalId = (await una<{ id: number }>(con, 'SELECT id FROM sucursales WHERE activo = 1 ORDER BY es_principal DESC, id LIMIT 1'))?.id ?? null;
    const suc = sucursalId ? await una<{ activo: number }>(con, 'SELECT activo FROM sucursales WHERE id = ?', [sucursalId]) : null;
    if (!sucursalId || !suc || suc.activo !== 1) throw new ErrorValidacion('La sucursal elegida no existe o está desactivada');
    if (d.servicio_programado_id) {
      const sp = await una<{ tipo_equipo_id: number }>(con, 'SELECT tipo_equipo_id FROM servicios_programados WHERE id = ? AND activo = 1', [d.servicio_programado_id]);
      const tipoEquipo = await una<{ tipo_equipo_id: number }>(con, 'SELECT tipo_equipo_id FROM equipos WHERE id = ?', [d.equipo_id]);
      if (!sp || sp.tipo_equipo_id !== tipoEquipo?.tipo_equipo_id) throw new ErrorValidacion('Ese servicio no aplica a este equipo');
    }
    const avisos = await revisarHorario(ctx, t, con, { fecha: d.fecha, hora: d.hora, sucursal_id: sucursalId, equipo_id: d.equipo_id }, null);
    const r = await ejecutar(
      con,
      'INSERT INTO citas (equipo_id, cliente_id, sucursal_id, fecha_hora, horas_estimadas, origen, lectura_contador, notas, servicio_programado_id, creada_por_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [d.equipo_id, e.cliente_id, sucursalId, utcDeLocal(d.fecha, d.hora, t.empresa.zonaHoraria), horas, d.origen ?? 'recepcion', d.lectura_contador ?? null, notas, d.servicio_programado_id ?? null, actor.usuarioId]
    );
    await bitacora(con, actor, { accion: 'cita_creada', entidad: 'citas', entidadId: r.insertId, despues: { ...d } });
    return { id: r.insertId, avisos };
  });
  return { cita: await obtenerCita(ctx, t, id), avisos };
}

async function citaProgramada(con: Ejecutor, id: number) {
  const c = await una<{ id: number; equipo_id: number; sucursal_id: number; fecha_hora: Date; estado: string; notas: string | null; lectura_contador: number | null }>(
    con,
    'SELECT id, equipo_id, sucursal_id, fecha_hora, estado, notas, lectura_contador FROM citas WHERE id = ? FOR UPDATE',
    [id]
  );
  if (!c) throw new ErrorNoEncontrado('No se encontró la cita');
  if (c.estado !== 'programada') {
    const nombres: Record<string, string> = { se_presento: 'ya se atendió', no_se_presento: 'se marcó como «no se presentó»', cancelada: 'está cancelada' };
    throw new ErrorApp(409, 'REGLA', `Esa cita ${nombres[c.estado] ?? 'ya no está programada'}.`);
  }
  return c;
}

/** Reprogramar o corregir una cita que sigue programada. */
export async function actualizarCita(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: DatosCita) {
  const avisos = await transaccion(t.pool, async (con) => {
    const c = await citaProgramada(con, id);
    const actual = localDeUtc(c.fecha_hora, t.empresa.zonaHoraria);
    const fecha = d.fecha ?? actual.fecha;
    const hora = d.hora ?? actual.hora;
    const sucursalId = d.sucursal_id ?? c.sucursal_id;
    if (d.sucursal_id) {
      const s = await una<{ activo: number }>(con, 'SELECT activo FROM sucursales WHERE id = ?', [d.sucursal_id]);
      if (!s || s.activo !== 1) throw new ErrorValidacion('La sucursal elegida no existe o está desactivada');
    }
    const horas = d.horas_estimadas ?? null;
    if (horas !== null && !(horas >= 0.25 && horas <= 24)) throw new ErrorValidacion('Las horas estimadas deben estar entre 0.25 y 24');
    const cambiaHorario = fecha !== actual.fecha || hora !== actual.hora || sucursalId !== c.sucursal_id;
    const avisos = cambiaHorario ? await revisarHorario(ctx, t, con, { fecha, hora, sucursal_id: sucursalId, equipo_id: c.equipo_id }, id) : [];
    await ejecutar(
      con,
      'UPDATE citas SET fecha_hora = ?, sucursal_id = ?, horas_estimadas = COALESCE(?, horas_estimadas), notas = ?, lectura_contador = ? WHERE id = ?',
      [utcDeLocal(fecha, hora, t.empresa.zonaHoraria), sucursalId, horas, d.notas === undefined ? c.notas : normalizarCampo('multilinea', d.notas), d.lectura_contador === undefined ? c.lectura_contador : d.lectura_contador, id]
    );
    await bitacora(con, actor, { accion: cambiaHorario ? 'cita_reprogramada' : 'cita_editada', entidad: 'citas', entidadId: id, antes: { fecha: actual.fecha, hora: actual.hora }, despues: d });
    return avisos;
  });
  return { cita: await obtenerCita(ctx, t, id), avisos };
}

export async function cancelarCita(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: { motivo_id: number; texto?: string | null }) {
  const texto = normalizarCampo('texto', d.texto);
  await transaccion(t.pool, async (con) => {
    await citaProgramada(con, id);
    const m = await una<{ nombre: string; activo: number }>(con, "SELECT nombre, activo FROM motivos WHERE id = ? AND tipo = 'cancelacion_cita'", [d.motivo_id]);
    if (!m || m.activo !== 1) throw new ErrorValidacion('Elija un motivo de cancelación de la lista');
    await ejecutar(con, "UPDATE citas SET estado = 'cancelada', motivo_cancelacion_id = ?, motivo_cancelacion_texto = ? WHERE id = ?", [d.motivo_id, texto, id]);
    await bitacora(con, actor, { accion: 'cita_cancelada', entidad: 'citas', entidadId: id, motivo: m.nombre, despues: { texto } });
  });
  return obtenerCita(ctx, t, id);
}

export async function marcarNoSePresento(ctx: Contexto, t: TallerReq, actor: Actor, id: number) {
  await transaccion(t.pool, async (con) => {
    const c = await citaProgramada(con, id);
    if (c.fecha_hora.getTime() > ahoraDe(ctx).getTime()) throw new ErrorApp(409, 'AUN_NO_ES_HORA', 'La cita todavía no llega a su hora: no se puede marcar como «no se presentó».');
    await ejecutar(con, "UPDATE citas SET estado = 'no_se_presento' WHERE id = ?", [id]);
    await bitacora(con, actor, { accion: 'cita_no_se_presento', entidad: 'citas', entidadId: id });
  });
  return obtenerCita(ctx, t, id);
}

/**
 * El cliente llegó: se recibe el equipo, nace la orden (ligada a la cita) y la cita queda «se presentó» con la hora de llegada,
 * todo en un solo paso: o pasa todo o no pasa nada.
 */
export async function recibirCita(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: Omit<DatosOrdenNueva, 'equipo_id'>) {
  const ordenId = await transaccion(t.pool, async (con) => {
    const c = await citaProgramada(con, id);
    const r = await crearOrdenEn(ctx, t, con, actor, { ...d, equipo_id: c.equipo_id, sucursal_id: d.sucursal_id ?? c.sucursal_id, descripcion: d.descripcion === undefined ? c.notas : d.descripcion, cita_id: id });
    await ejecutar(con, "UPDATE citas SET estado = 'se_presento', llegada_en = ? WHERE id = ?", [ahoraDe(ctx), id]);
    await bitacora(con, actor, { accion: 'cita_recibida', entidad: 'citas', entidadId: id, despues: { orden_id: r.id } });
    return r.id;
  });
  const numero = (await una<{ numero: string }>(t.pool, 'SELECT numero FROM ordenes WHERE id = ?', [ordenId]))?.numero ?? '';
  return { ordenId, numero, cita: await obtenerCita(ctx, t, id) };
}
