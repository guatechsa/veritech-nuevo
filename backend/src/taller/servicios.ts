import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { validarFechaRazonable } from '../utils/fechas';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, TallerReq } from './comun';
import { hoyDelTaller } from './contadores';
import { descripcionDeEquipo } from './equipos';

/**
 * Servicios programados (Fase 4e). Cada servicio (por ejemplo «servicio de 10 000 km») tiene su PROPIO reloj sobre un contador del
 * equipo. Un servicio cuenta como realizado cuando se completa su checklist; la carga de un servicio anterior y la excepción
 * quedan registradas con quién y por qué; una carga equivocada se anula con motivo, nunca se borra.
 */

export type EstadoServicio = 'vencido' | 'urgente' | 'proximo' | 'al_dia' | 'sin_contador';
const ORDEN_GRAVEDAD: Record<EstadoServicio, number> = { vencido: 0, urgente: 1, proximo: 2, al_dia: 3, sin_contador: 4 };

/** Días entre dos fechas AAAA-MM-DD. */
function diasEntre(desde: string, hasta: string): number {
  const f = (s: string): number => Date.UTC(Number(s.slice(0, 4)), Number(s.slice(5, 7)) - 1, Number(s.slice(8, 10)));
  return Math.round((f(hasta) - f(desde)) / 86400000);
}
const sumarDias = (iso: string, n: number): string => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n)).toISOString().slice(0, 10);
const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

// ── Los programas (configuración por tipo de equipo) ──────────────────────────────────
export interface DatosPrograma {
  tipo_equipo_id?: number;
  trabajo_id?: number;
  nombre?: string;
  checklist_tipo_id?: number | null;
  tipo?: 'mantenimiento' | 'revision_operativa';
  tipo_contador_id?: number;
  intervalo?: number;
  aviso_proximo?: number;
  aviso_urgente?: number;
  activo?: boolean;
}

/** Cuánto antes se avisa si la persona no lo dice: depende de la unidad del contador (kilómetros, horas, días…). */
async function umbralesPorDefecto(con: Ejecutor, tipoContadorId: number, intervalo: number): Promise<{ proximo: number; urgente: number }> {
  const u = await una<{ codigo: string }>(con, 'SELECT u.codigo FROM tipos_contador tc JOIN unidades u ON u.id = tc.unidad_id WHERE tc.id = ?', [tipoContadorId]);
  const tabla: Record<string, [number, number]> = { DIAS: [30, 7], KM: [1000, 200], MI: [600, 120], HR: [50, 10], HRS: [50, 10] };
  const [p, ur] = tabla[(u?.codigo ?? '').toUpperCase()] ?? [r2(intervalo * 0.1), r2(intervalo * 0.05)];
  return { proximo: Math.min(p, intervalo), urgente: Math.min(ur, intervalo) };
}

export async function listarProgramas(t: TallerReq, f: { tipo_equipo_id?: number; inactivos?: boolean }) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (!f.inactivos) donde.push('sp.activo = 1');
  if (f.tipo_equipo_id) {
    donde.push('sp.tipo_equipo_id = ?');
    params.push(f.tipo_equipo_id);
  }
  return filas<Record<string, unknown>>(
    t.pool,
    `SELECT sp.id, sp.tipo_equipo_id, te.nombre AS tipo_equipo, sp.trabajo_id, tr.codigo AS trabajo_codigo, tr.nombre AS trabajo, sp.nombre, sp.tipo, sp.checklist_tipo_id, ct.nombre AS checklist,
            sp.tipo_contador_id, tc.nombre AS tipo_contador, u.codigo AS unidad, tc.es_calendario, sp.intervalo, sp.aviso_proximo, sp.aviso_urgente, sp.activo,
            (SELECT COUNT(*) FROM equipos e WHERE e.tipo_equipo_id = sp.tipo_equipo_id AND e.estado <> 'baja') AS equipos
       FROM servicios_programados sp JOIN tipos_equipo te ON te.id = sp.tipo_equipo_id JOIN trabajos tr ON tr.id = sp.trabajo_id JOIN tipos_contador tc ON tc.id = sp.tipo_contador_id
       JOIN unidades u ON u.id = tc.unidad_id LEFT JOIN checklist_tipos ct ON ct.id = sp.checklist_tipo_id ${donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : ''} ORDER BY te.nombre, sp.nombre`,
    params
  );
}

async function revisarPrograma(con: Ejecutor, d: DatosPrograma, actual: { intervalo: number; aviso_proximo: number; aviso_urgente: number } | null): Promise<void> {
  const intervalo = d.intervalo ?? actual?.intervalo ?? 0;
  const proximo = d.aviso_proximo ?? actual?.aviso_proximo ?? 0;
  const urgente = d.aviso_urgente ?? actual?.aviso_urgente ?? 0;
  if (!(intervalo > 0)) throw new ErrorValidacion('El intervalo debe ser mayor que cero');
  if (proximo < 0 || urgente < 0) throw new ErrorValidacion('Los avisos no pueden ser negativos');
  if (urgente > proximo) throw new ErrorValidacion('El aviso «urgente» debe ser igual o menor que el aviso «próximo»');
  if (proximo > intervalo) throw new ErrorValidacion('El aviso «próximo» no puede ser mayor que el intervalo del servicio');
  if (d.checklist_tipo_id) {
    const c = await una<{ activo: number }>(con, 'SELECT activo FROM checklist_tipos WHERE id = ?', [d.checklist_tipo_id]);
    if (!c || c.activo !== 1) throw new ErrorValidacion('El checklist elegido no existe o está desactivado');
  }
}

export async function crearPrograma(t: TallerReq, actor: Actor, d: DatosPrograma & { tipo_equipo_id: number; trabajo_id: number; tipo_contador_id: number; intervalo: number }) {
  const id = await transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM tipos_equipo WHERE id = ? AND activo = 1', [d.tipo_equipo_id]))) throw new ErrorValidacion('El tipo de equipo elegido no existe o está desactivado');
    const tr = await una<{ nombre: string; activo: number }>(con, 'SELECT nombre, activo FROM trabajos WHERE id = ?', [d.trabajo_id]);
    if (!tr || tr.activo !== 1) throw new ErrorValidacion('El trabajo elegido no existe o está desactivado');
    const tc = await una<{ activo: number }>(con, 'SELECT activo FROM tipos_contador WHERE id = ?', [d.tipo_contador_id]);
    if (!tc || tc.activo !== 1) throw new ErrorValidacion('El tipo de contador elegido no existe o está desactivado');
    const def = await umbralesPorDefecto(con, d.tipo_contador_id, d.intervalo);
    const completo = { ...d, aviso_proximo: d.aviso_proximo ?? def.proximo, aviso_urgente: d.aviso_urgente ?? def.urgente };
    await revisarPrograma(con, completo, null);
    const nombre = normalizarCampo('texto', d.nombre) ?? tr.nombre;
    try {
      const r = await ejecutar(
        con,
        'INSERT INTO servicios_programados (tipo_equipo_id, trabajo_id, checklist_tipo_id, nombre, tipo, tipo_contador_id, intervalo, aviso_proximo, aviso_urgente) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [d.tipo_equipo_id, d.trabajo_id, d.checklist_tipo_id ?? null, nombre.slice(0, 120), d.tipo ?? 'mantenimiento', d.tipo_contador_id, d.intervalo, completo.aviso_proximo, completo.aviso_urgente]
      );
      await bitacora(con, actor, { accion: 'servicio_programado_creado', entidad: 'servicios_programados', entidadId: r.insertId, despues: completo });
      return r.insertId;
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErrorApp(409, 'CONFLICTO', 'Ese tipo de equipo ya tiene un servicio con ese nombre');
      throw error;
    }
  });
  return (await listarProgramas(t, { inactivos: true })).find((x) => x['id'] === id);
}

export async function actualizarPrograma(t: TallerReq, actor: Actor, id: number, d: DatosPrograma) {
  await transaccion(t.pool, async (con) => {
    const p = await una<{ intervalo: number; aviso_proximo: number; aviso_urgente: number }>(con, 'SELECT intervalo, aviso_proximo, aviso_urgente FROM servicios_programados WHERE id = ? FOR UPDATE', [id]);
    if (!p) throw new ErrorNoEncontrado('No se encontró el servicio');
    if (d.tipo_equipo_id !== undefined || d.trabajo_id !== undefined || d.tipo_contador_id !== undefined) {
      throw new ErrorApp(409, 'REGLA', 'El tipo de equipo, el trabajo y el contador de un servicio no se cambian (rompería su historia). Desactívelo y cree otro.');
    }
    await revisarPrograma(con, d, { intervalo: Number(p.intervalo), aviso_proximo: Number(p.aviso_proximo), aviso_urgente: Number(p.aviso_urgente) });
    const sets: string[] = [];
    const v: unknown[] = [];
    if (d.nombre !== undefined) {
      const n = normalizarCampo('texto', d.nombre);
      if (!n) throw new ErrorValidacion('El servicio necesita un nombre');
      sets.push('nombre = ?');
      v.push(n.slice(0, 120));
    }
    for (const [campo, col] of [['intervalo', 'intervalo'], ['aviso_proximo', 'aviso_proximo'], ['aviso_urgente', 'aviso_urgente'], ['tipo', 'tipo']] as const) {
      if (d[campo] !== undefined) {
        sets.push(`${col} = ?`);
        v.push(d[campo]);
      }
    }
    if (d.checklist_tipo_id !== undefined) {
      sets.push('checklist_tipo_id = ?');
      v.push(d.checklist_tipo_id);
    }
    if (d.activo !== undefined) {
      sets.push('activo = ?');
      v.push(d.activo ? 1 : 0);
    }
    try {
      if (sets.length > 0) await ejecutar(con, `UPDATE servicios_programados SET ${sets.join(', ')} WHERE id = ?`, [...v, id]);
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErrorApp(409, 'CONFLICTO', 'Ese tipo de equipo ya tiene un servicio con ese nombre');
      throw error;
    }
    await bitacora(con, actor, { accion: 'servicio_programado_editado', entidad: 'servicios_programados', entidadId: id, despues: d });
  });
  return (await listarProgramas(t, { inactivos: true })).find((x) => x['id'] === id);
}

// ── Estado de los servicios de cada equipo ────────────────────────────────────────────
interface FilaCalculo {
  equipo_id: number;
  codigo_interno: string | null;
  placa: string | null;
  marca: string | null;
  modelo: string | null;
  tipo_equipo: string;
  cliente: string | null;
  servicio_id: number;
  servicio: string;
  intervalo: number;
  aviso_proximo: number;
  aviso_urgente: number;
  unidad: string;
  es_calendario: number;
  contador_id: number | null;
  valor_actual: number | null;
  fecha_inicio: string | null;
  valor_inicial: number | null;
  ultimo_valor: number | null;
  ultima_fecha: string | null;
}

export interface Pendiente {
  equipo_id: number;
  equipo: string;
  tipo_equipo: string;
  cliente: string | null;
  servicio_id: number;
  servicio: string;
  unidad: string;
  estado: EstadoServicio;
  valor_actual: number | null;
  ultimo_servicio: { valor: number; fecha: string } | null;
  proximo_en: number | null;
  restante: number | null;
  /** Unidades por día según las lecturas de los últimos 90 días (nulo si no hay lecturas suficientes). */
  ritmo_por_dia: number | null;
  fecha_estimada: string | null;
}

export async function estadoDeServicios(ctx: Contexto, t: TallerReq, f: { equipo_id?: number; estado?: EstadoServicio; tipo_equipo_id?: number; servicio_id?: number } = {}): Promise<Pendiente[]> {
  const hoy = hoyDelTaller(ctx, t);
  const donde: string[] = ["sp.activo = 1", "e.estado <> 'baja'"];
  const params: unknown[] = [];
  if (f.equipo_id) {
    donde.push('e.id = ?');
    params.push(f.equipo_id);
  }
  if (f.tipo_equipo_id) {
    donde.push('e.tipo_equipo_id = ?');
    params.push(f.tipo_equipo_id);
  }
  if (f.servicio_id) {
    donde.push('sp.id = ?');
    params.push(f.servicio_id);
  }
  const filasBase = await filas<FilaCalculo>(
    t.pool,
    `SELECT e.id AS equipo_id, e.codigo_interno, e.placa, m.nombre AS marca, e.modelo, te.nombre AS tipo_equipo, cl.nombre AS cliente,
            sp.id AS servicio_id, sp.nombre AS servicio, sp.intervalo, sp.aviso_proximo, sp.aviso_urgente, u.codigo AS unidad, tc.es_calendario,
            ct.id AS contador_id, ct.valor_actual, DATE_FORMAT(ct.fecha_inicio, '%Y-%m-%d') AS fecha_inicio, ct.valor_inicial,
            (SELECT r.contador_valor FROM servicios_realizados r WHERE r.equipo_id = e.id AND r.servicio_id = sp.id AND r.anulado_en IS NULL ORDER BY r.contador_valor DESC, r.id DESC LIMIT 1) AS ultimo_valor,
            (SELECT DATE_FORMAT(r.fecha, '%Y-%m-%d') FROM servicios_realizados r WHERE r.equipo_id = e.id AND r.servicio_id = sp.id AND r.anulado_en IS NULL ORDER BY r.contador_valor DESC, r.id DESC LIMIT 1) AS ultima_fecha
       FROM servicios_programados sp JOIN equipos e ON e.tipo_equipo_id = sp.tipo_equipo_id JOIN tipos_equipo te ON te.id = e.tipo_equipo_id JOIN tipos_contador tc ON tc.id = sp.tipo_contador_id
       JOIN unidades u ON u.id = tc.unidad_id LEFT JOIN marcas m ON m.id = e.marca_id LEFT JOIN clientes cl ON cl.id = e.cliente_id
       LEFT JOIN contadores ct ON ct.id = (SELECT c2.id FROM contadores c2 WHERE c2.equipo_id = e.id AND c2.tipo_contador_id = sp.tipo_contador_id AND c2.componente_id IS NULL AND c2.activo = 1 ORDER BY c2.es_principal DESC, c2.id LIMIT 1)
      WHERE ${donde.join(' AND ')}`,
    params
  );

  // El ritmo de uso sale de las lecturas válidas de los últimos 90 días (solo para contadores que no son de calendario).
  const contadorIds = [...new Set(filasBase.filter((x) => x.contador_id && x.es_calendario !== 1).map((x) => Number(x.contador_id)))];
  const lecturas = contadorIds.length === 0 ? [] : await filas<{ contador_id: number; fecha: string; valor: number }>(
    t.pool,
    "SELECT contador_id, DATE_FORMAT(fecha, '%Y-%m-%d') AS fecha, valor FROM lecturas_contador WHERE contador_id IN (?) AND estado = 'valida' AND fecha >= ? ORDER BY contador_id, fecha, id",
    [contadorIds, sumarDias(hoy, -90)]
  );
  const ritmo = new Map<number, number>();
  for (const id of contadorIds) {
    const l = lecturas.filter((x) => x.contador_id === id);
    const primera = l[0];
    const ultima = l[l.length - 1];
    if (primera && ultima) {
      const dias = diasEntre(primera.fecha, ultima.fecha);
      const uso = Number(ultima.valor) - Number(primera.valor);
      if (dias >= 7 && uso > 0) ritmo.set(id, uso / dias);
    }
  }

  const resultado: Pendiente[] = filasBase.map((x) => {
    const base: Pendiente = {
      equipo_id: x.equipo_id,
      equipo: descripcionDeEquipo({ id: x.equipo_id, codigo_interno: x.codigo_interno, placa: x.placa, marca: x.marca, modelo: x.modelo, tipo_equipo: x.tipo_equipo }),
      tipo_equipo: x.tipo_equipo,
      cliente: x.cliente,
      servicio_id: x.servicio_id,
      servicio: x.servicio,
      unidad: x.unidad,
      estado: 'sin_contador',
      valor_actual: null,
      ultimo_servicio: x.ultimo_valor === null ? null : { valor: Number(x.ultimo_valor), fecha: x.ultima_fecha as string },
      proximo_en: null,
      restante: null,
      ritmo_por_dia: null,
      fecha_estimada: null,
    };
    if (!x.contador_id || !x.fecha_inicio) return base;
    const calendario = x.es_calendario === 1;
    const actual = calendario ? diasEntre(x.fecha_inicio, hoy) : Number(x.valor_actual);
    // Sin servicio anterior, el reloj empieza donde empezó el contador: «el primer servicio» se cuenta desde el valor inicial.
    const desde = x.ultimo_valor !== null ? Number(x.ultimo_valor) : calendario ? 0 : Number(x.valor_inicial);
    const proximoEn = r2(desde + Number(x.intervalo));
    const restante = r2(proximoEn - actual);
    const estado: EstadoServicio = restante < 0 ? 'vencido' : restante <= Number(x.aviso_urgente) ? 'urgente' : restante <= Number(x.aviso_proximo) ? 'proximo' : 'al_dia';
    const ritmoDia = calendario ? 1 : ritmo.get(Number(x.contador_id)) ?? null;
    let fechaEstimada: string | null = null;
    if (calendario) fechaEstimada = sumarDias(x.fecha_inicio, Math.round(proximoEn));
    else if (ritmoDia && restante > 0) fechaEstimada = sumarDias(hoy, Math.ceil(restante / ritmoDia));
    else if (restante <= 0) fechaEstimada = hoy;
    return { ...base, estado, valor_actual: r2(actual), proximo_en: proximoEn, restante, ritmo_por_dia: calendario ? null : ritmoDia === null ? null : r2(ritmoDia), fecha_estimada: fechaEstimada };
  });
  const filtrado = f.estado ? resultado.filter((x) => x.estado === f.estado) : resultado;
  return filtrado.sort((a, b) => ORDEN_GRAVEDAD[a.estado] - ORDEN_GRAVEDAD[b.estado] || (a.restante ?? 1e12) - (b.restante ?? 1e12) || a.equipo.localeCompare(b.equipo));
}

// ── Lo realizado ──────────────────────────────────────────────────────────────────────
export async function serviciosDeEquipo(ctx: Contexto, t: TallerReq, equipoId: number) {
  if (!(await una(t.pool, 'SELECT id FROM equipos WHERE id = ?', [equipoId]))) throw new ErrorNoEncontrado('No se encontró el equipo');
  const historial = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT r.id, r.servicio_id, sp.nombre AS servicio, r.contador_valor, DATE_FORMAT(r.fecha, '%Y-%m-%d') AS fecha, UPPER(r.origen) AS origen, r.motivo, o.numero AS orden_numero, co.nombre_completo AS registrado_por,
            r.anulado_en, r.motivo_anulacion
       FROM servicios_realizados r JOIN servicios_programados sp ON sp.id = r.servicio_id LEFT JOIN ordenes o ON o.id = r.orden_id LEFT JOIN usuarios u ON u.id = r.registrado_por_id
       LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE r.equipo_id = ? ORDER BY r.fecha DESC, r.id DESC`,
    [equipoId]
  );
  return { servicios: await estadoDeServicios(ctx, t, { equipo_id: equipoId }), historial };
}

/** Valor que marca hoy el contador de un servicio en un equipo (en días desde su inicio si es de calendario). */
async function valorDelContador(ctx: Contexto, t: TallerReq, con: Ejecutor, equipoId: number, servicioId: number): Promise<{ valor: number; calendario: boolean; inicio: string } | null> {
  const c = await una<{ valor_actual: number; es_calendario: number; fecha_inicio: string }>(
    con,
    `SELECT ct.valor_actual, tc.es_calendario, DATE_FORMAT(ct.fecha_inicio, '%Y-%m-%d') AS fecha_inicio FROM servicios_programados sp JOIN tipos_contador tc ON tc.id = sp.tipo_contador_id
       JOIN contadores ct ON ct.id = (SELECT c2.id FROM contadores c2 WHERE c2.equipo_id = ? AND c2.tipo_contador_id = sp.tipo_contador_id AND c2.componente_id IS NULL AND c2.activo = 1 ORDER BY c2.es_principal DESC, c2.id LIMIT 1)
      WHERE sp.id = ?`,
    [equipoId, servicioId]
  );
  if (!c) return null;
  const calendario = c.es_calendario === 1;
  return { valor: calendario ? diasEntre(c.fecha_inicio, hoyDelTaller(ctx, t)) : Number(c.valor_actual), calendario, inicio: c.fecha_inicio };
}

export interface DatosRealizado {
  equipo_id: number;
  servicio_id: number;
  fecha: string;
  contador_valor?: number;
  origen: 'historico' | 'excepcion';
  motivo?: string | null;
}

/** Registra un servicio ya hecho dentro de una transacción abierta (la usa también la carga masiva de «últimos servicios»). */
export async function registrarRealizadoEn(ctx: Contexto, t: TallerReq, con: Ejecutor, actor: Actor, d: DatosRealizado): Promise<number> {
  const hoy = hoyDelTaller(ctx, t);
  const motivo = normalizarCampo('texto', d.motivo);
  if (d.origen === 'excepcion' && (!motivo || motivo.length < 3)) throw new ErrorValidacion('Registrar un servicio sin su checklist pide el motivo');
  validarFechaRazonable(d.fecha, 'fecha', { noFutura: true, hoy });
  const e = await una<{ tipo_equipo_id: number }>(con, "SELECT tipo_equipo_id FROM equipos WHERE id = ? AND estado <> 'baja'", [d.equipo_id]);
  if (!e) throw new ErrorValidacion('El equipo elegido no existe o está dado de baja');
  const sp = await una<{ tipo_equipo_id: number }>(con, 'SELECT tipo_equipo_id FROM servicios_programados WHERE id = ? AND activo = 1', [d.servicio_id]);
  if (!sp || sp.tipo_equipo_id !== e.tipo_equipo_id) throw new ErrorValidacion('Ese servicio no aplica a este equipo');
  const c = await valorDelContador(ctx, t, con, d.equipo_id, d.servicio_id);
  if (!c) throw new ErrorApp(409, 'SIN_CONTADOR', 'El equipo no tiene el contador de este servicio. Agréguelo en su ficha y vuelva a intentarlo.');
  // Un servicio anterior: si es de calendario el valor son los días desde el inicio del contador; si no, hay que decir qué marcaba.
  let valor = d.contador_valor;
  if (valor === undefined) {
    if (!c.calendario) throw new ErrorValidacion('Diga qué marcaba el contador cuando se hizo el servicio');
    valor = diasEntre(c.inicio, d.fecha);
  }
  if (!c.calendario && valor > c.valor) throw new ErrorValidacion(`El servicio no pudo hacerse a ${valor}: el contador marca hoy ${c.valor}`);
  if (valor < -100000) throw new ErrorValidacion('El valor del contador no es válido');
  const r = await ejecutar(con, 'INSERT INTO servicios_realizados (equipo_id, servicio_id, contador_valor, fecha, origen, motivo, registrado_por_id) VALUES (?, ?, ?, ?, ?, ?, ?)', [d.equipo_id, d.servicio_id, valor, d.fecha, d.origen, motivo, actor.usuarioId]);
  await bitacora(con, actor, { accion: d.origen === 'excepcion' ? 'servicio_realizado_excepcion' : 'servicio_realizado_historico', entidad: 'servicios_realizados', entidadId: r.insertId, motivo, despues: { ...d, contador_valor: valor } });
  return r.insertId;
}

export async function registrarRealizado(ctx: Contexto, t: TallerReq, actor: Actor, d: DatosRealizado) {
  const id = await transaccion(t.pool, (con) => registrarRealizadoEn(ctx, t, con, actor, d));
  return { id, servicios: await estadoDeServicios(ctx, t, { equipo_id: d.equipo_id }) };
}

export async function anularRealizado(ctx: Contexto, t: TallerReq, actor: Actor, id: number, motivo: string) {
  const texto = normalizarCampo('texto', motivo);
  if (!texto || texto.length < 3) throw new ErrorValidacion('Anular una carga pide el motivo');
  let equipoId = 0;
  await transaccion(t.pool, async (con) => {
    const r = await una<{ equipo_id: number; anulado_en: Date | null }>(con, 'SELECT equipo_id, anulado_en FROM servicios_realizados WHERE id = ? FOR UPDATE', [id]);
    if (!r) throw new ErrorNoEncontrado('No se encontró el registro');
    if (r.anulado_en) throw new ErrorApp(409, 'REGLA', 'Ese registro ya está anulado.');
    equipoId = r.equipo_id;
    await ejecutar(con, 'UPDATE servicios_realizados SET anulado_en = ?, anulado_por_id = ?, motivo_anulacion = ? WHERE id = ?', [ahoraDe(ctx), actor.usuarioId, texto.slice(0, 300), id]);
    await bitacora(con, actor, { accion: 'servicio_realizado_anulado', entidad: 'servicios_realizados', entidadId: id, motivo: texto });
  });
  return serviciosDeEquipo(ctx, t, equipoId);
}

/** Al completar un checklist, los servicios que lo usan quedan registrados como realizados (con lo que marca hoy el contador). */
export async function registrarServiciosPorChecklist(ctx: Contexto, t: TallerReq, con: Ejecutor, actor: Actor, c: { checklist_id: number; tipo_id: number; orden_id: number | null; equipo_id: number }): Promise<number> {
  const e = await una<{ tipo_equipo_id: number }>(con, 'SELECT tipo_equipo_id FROM equipos WHERE id = ?', [c.equipo_id]);
  if (!e) return 0;
  const servicios = await filas<{ id: number }>(con, 'SELECT id FROM servicios_programados WHERE checklist_tipo_id = ? AND tipo_equipo_id = ? AND activo = 1', [c.tipo_id, e.tipo_equipo_id]);
  let n = 0;
  for (const s of servicios) {
    const v = await valorDelContador(ctx, t, con, c.equipo_id, s.id);
    if (!v) continue; // el equipo no tiene ese contador: no hay con qué medir
    await ejecutar(con, "INSERT INTO servicios_realizados (equipo_id, servicio_id, contador_valor, fecha, orden_id, checklist_id, origen, registrado_por_id) VALUES (?, ?, ?, ?, ?, ?, 'checklist', ?)", [c.equipo_id, s.id, v.valor, hoyDelTaller(ctx, t), c.orden_id, c.checklist_id, actor.usuarioId]);
    await bitacora(con, actor, { accion: 'servicio_realizado_checklist', entidad: 'servicios_realizados', despues: { servicio_id: s.id, checklist_id: c.checklist_id } });
    n++;
  }
  return n;
}

// ── Avisos ────────────────────────────────────────────────────────────────────────────
/**
 * Revisa todos los servicios y anota los que EMPEORARON de estado desde la última vez (para no repetir avisos). Devuelve los avisos
 * nuevos; el envío por correo o teléfono lo hacen los «avisos incluidos» de la Fase 7.
 */
export async function revisarAvisos(ctx: Contexto, t: TallerReq) {
  const todos = await estadoDeServicios(ctx, t);
  const previos = await filas<{ equipo_id: number; servicio_id: number; estado_alertado: string }>(t.pool, 'SELECT equipo_id, servicio_id, estado_alertado FROM avisos_servicio');
  const peso: Record<string, number> = { proximo: 1, urgente: 2, vencido: 3 };
  const nuevos: Pendiente[] = [];
  await transaccion(t.pool, async (con) => {
    for (const p of todos) {
      const previo = previos.find((x) => x.equipo_id === p.equipo_id && x.servicio_id === p.servicio_id);
      if (p.estado === 'proximo' || p.estado === 'urgente' || p.estado === 'vencido') {
        if (!previo || peso[p.estado]! > (peso[previo.estado_alertado] ?? 0)) {
          await ejecutar(con, 'INSERT INTO avisos_servicio (equipo_id, servicio_id, estado_alertado, enviado_en) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE estado_alertado = VALUES(estado_alertado), enviado_en = VALUES(enviado_en)', [p.equipo_id, p.servicio_id, p.estado, ahoraDe(ctx)]);
          nuevos.push(p);
        }
      } else if (previo) {
        // Volvió a estar al día (se hizo el servicio): la próxima vez que se acerque, se avisa de nuevo.
        await ejecutar(con, 'DELETE FROM avisos_servicio WHERE equipo_id = ? AND servicio_id = ?', [p.equipo_id, p.servicio_id]);
      }
    }
  });
  return { avisos_nuevos: nuevos, pendientes: todos.filter((x) => x.estado === 'vencido' || x.estado === 'urgente' || x.estado === 'proximo').length };
}
