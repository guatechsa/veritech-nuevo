import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { encolarCorreo } from '../correos/cola';
import { plantillaCorreo } from '../correos/plantilla';
import { ejecutar, filas, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { escaparHtml } from '../utils/html';
import { registrarAcceso } from './accesos';
import { urlFirmada } from './archivos';
import { emitirAviso } from './avisos';
import { crearCita } from './citas';
import { TallerReq } from './comun';
import { hoyDelTaller } from './contadores';
import { cotizacionParaElCliente, responderComoCliente } from './enlaces';
import { estadoDeServicios } from './servicios';

/**
 * Portal del cliente (Fase 7d). La persona de contacto entra con su correo y un código de 6 números que le llega a ese correo (sin contraseñas que
 * recordar). Ve sus equipos —todos los del cliente o solo los que el taller le asignó—, lo que pasa con cada uno, sus cuentas e informes, y puede
 * responder cotizaciones (si es «aprobador») y pedir una cita (que la recepción confirma). Nunca ve costos ni datos internos del taller.
 */
export const MINUTOS_DEL_CODIGO = 15;
export const HORAS_DE_SESION = 8;
export const INTENTOS_POR_CODIGO = 5;
export const CODIGOS_POR_HORA = 3;
export const MAXIMO_DE_EQUIPOS = 100;

const huella = (texto: string): string => createHash('sha256').update(texto).digest('hex');
const credencialInvalida = (): ErrorApp => new ErrorApp(401, 'CODIGO_INVALIDO', 'El código no es válido o ya venció. Pida uno nuevo.');

export interface ContactoPortal {
  id: number;
  cliente_id: number;
  cliente: string;
  nombre: string;
  rol: 'aprobador' | 'consulta' | 'piloto';
  acceso_todos_equipos: boolean;
}

export interface SesionPortal {
  id: number;
  correo: string;
  contactos: ContactoPortal[];
}

async function contactosDeCorreo(t: TallerReq, correo: string): Promise<ContactoPortal[]> {
  const f = await filas<{ id: number; cliente_id: number; cliente: string; nombre: string; rol: ContactoPortal['rol']; acceso_todos_equipos: number }>(
    t.pool,
    `SELECT c.id, c.cliente_id, cl.nombre AS cliente, c.nombre, c.rol, c.acceso_todos_equipos FROM contactos_cliente c JOIN clientes cl ON cl.id = c.cliente_id
      WHERE c.correo = ? AND c.activo = 1 AND cl.activo = 1 ORDER BY c.id`,
    [correo]
  );
  return f.map((x) => ({ ...x, acceso_todos_equipos: x.acceso_todos_equipos === 1 }));
}

// ── Entrar ────────────────────────────────────────────────────────────────────────────
/** Manda el código al correo, SI ese correo es de una persona de contacto. Responde siempre lo mismo (no se puede averiguar qué correos existen). */
export async function solicitarCodigo(ctx: Contexto, t: TallerReq, correoCrudo: string, origen: { ip: string }): Promise<void> {
  const correo = correoCrudo.trim().toLowerCase();
  if ((await contactosDeCorreo(t, correo)).length === 0) return;
  const ahora = ahoraDe(ctx);
  const recientes = await una<{ n: number }>(t.pool, 'SELECT COUNT(*) AS n FROM portal_codigos WHERE correo = ? AND creado_en > ?', [correo, new Date(ahora.getTime() - 3600000)]);
  if (Number(recientes?.n ?? 0) >= CODIGOS_POR_HORA) return;
  const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await ejecutar(t.pool, 'INSERT INTO portal_codigos (correo, huella, vence_en, creado_en, ip) VALUES (?, ?, ?, ?, ?)', [correo, huella(`${correo}:${codigo}`), new Date(ahora.getTime() + MINUTOS_DEL_CODIGO * 60000), ahora, origen.ip.slice(0, 64)]);
  await encolarCorreo(ctx.pool, {
    tipo: 'portal_codigo',
    destinatarios: [correo],
    asunto: `Su código para entrar a ${t.empresa.nombre}`,
    cuerpoHtml: plantillaCorreo(
      `<p>Su código para entrar al portal de <strong>${escaparHtml(t.empresa.nombre)}</strong> es:</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold;">${codigo}</p><p>Vale ${MINUTOS_DEL_CODIGO} minutos y se usa una sola vez. Si usted no lo pidió, ignore este mensaje.</p>`
    ),
  });
}

export async function entrarAlPortal(ctx: Contexto, t: TallerReq, correoCrudo: string, codigo: string, origen: { ip: string; agente: string }) {
  const correo = correoCrudo.trim().toLowerCase();
  const ahora = ahoraDe(ctx);
  const c = await una<{ id: number; huella: string }>(t.pool, 'SELECT id, huella FROM portal_codigos WHERE correo = ? AND usado_en IS NULL AND vence_en > ? ORDER BY id DESC LIMIT 1', [correo, ahora]);
  if (!c) throw credencialInvalida();
  // Cada intento cuenta ANTES de comparar: un código se prueba como máximo 5 veces.
  const intento = await ejecutar(t.pool, 'UPDATE portal_codigos SET intentos = intentos + 1 WHERE id = ? AND intentos < ?', [c.id, INTENTOS_POR_CODIGO]);
  if (intento.affectedRows !== 1) throw credencialInvalida();
  const esperada = Buffer.from(c.huella, 'hex');
  const recibida = Buffer.from(huella(`${correo}:${codigo.trim()}`), 'hex');
  if (esperada.length !== recibida.length || !timingSafeEqual(esperada, recibida)) throw credencialInvalida();
  const usado = await ejecutar(t.pool, 'UPDATE portal_codigos SET usado_en = ? WHERE id = ? AND usado_en IS NULL', [ahora, c.id]);
  if (usado.affectedRows !== 1) throw credencialInvalida();
  const contactos = await contactosDeCorreo(t, correo);
  if (contactos.length === 0) throw credencialInvalida();
  const token = randomBytes(32).toString('hex');
  const vence = new Date(ahora.getTime() + HORAS_DE_SESION * 3600000);
  await ejecutar(t.pool, 'INSERT INTO portal_sesiones (huella, correo, vence_en, ip, dispositivo, creada_en, ultima_actividad_en) VALUES (?, ?, ?, ?, ?, ?, ?)', [huella(token), correo, vence, origen.ip.slice(0, 64), origen.agente.slice(0, 200), ahora, ahora]);
  for (const k of contactos) await registrarAcceso(t, { canal: 'portal', tipo: 'entrada', entidadId: null, referencia: k.nombre, clienteId: k.cliente_id, contactoId: k.id, ip: origen.ip, dispositivo: origen.agente, en: ahora });
  return { token, vence_en: vence };
}

/** Quién es la persona de esta llave (nulo si no sirve: no existe, venció, se revocó o ya no es contacto activo). */
export async function sesionDePortal(ctx: Contexto, t: TallerReq, token: string): Promise<SesionPortal | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const ahora = ahoraDe(ctx);
  const s = await una<{ id: number; correo: string }>(t.pool, 'SELECT id, correo FROM portal_sesiones WHERE huella = ? AND revocada_en IS NULL AND vence_en > ?', [huella(token), ahora]);
  if (!s) return null;
  const contactos = await contactosDeCorreo(t, s.correo);
  if (contactos.length === 0) return null;
  await ejecutar(t.pool, 'UPDATE portal_sesiones SET ultima_actividad_en = ? WHERE id = ?', [ahora, s.id]);
  return { id: s.id, correo: s.correo, contactos };
}

export async function cerrarSesionDePortal(ctx: Contexto, t: TallerReq, s: SesionPortal): Promise<void> {
  await ejecutar(t.pool, 'UPDATE portal_sesiones SET revocada_en = ? WHERE id = ?', [ahoraDe(ctx), s.id]);
}

// ── Lo que puede ver ──────────────────────────────────────────────────────────────────
/** Los equipos de esta persona: todos los de su cliente, o solo los que el taller le asignó. */
async function equiposPermitidos(t: TallerReq, s: SesionPortal): Promise<number[]> {
  const clientes = [...new Set(s.contactos.filter((c) => c.acceso_todos_equipos).map((c) => c.cliente_id))];
  const contactosSelectivos = s.contactos.filter((c) => !c.acceso_todos_equipos).map((c) => c.id);
  const partes: string[] = [];
  const params: unknown[] = [];
  if (clientes.length > 0) {
    partes.push(`e.cliente_id IN (${clientes.map(() => '?').join(',')})`);
    params.push(...clientes);
  }
  if (contactosSelectivos.length > 0) {
    partes.push(`e.id IN (SELECT equipo_id FROM contacto_equipos WHERE contacto_id IN (${contactosSelectivos.map(() => '?').join(',')}))`);
    params.push(...contactosSelectivos);
  }
  if (partes.length === 0) return [];
  const f = await filas<{ id: number }>(t.pool, `SELECT e.id FROM equipos e WHERE e.estado <> 'baja' AND (${partes.join(' OR ')}) ORDER BY e.codigo_interno, e.placa, e.id LIMIT ${MAXIMO_DE_EQUIPOS}`, params);
  return f.map((x) => x.id);
}

async function exigirEquipo(t: TallerReq, s: SesionPortal, equipoId: number): Promise<void> {
  if (!(await equiposPermitidos(t, s)).includes(equipoId)) throw new ErrorNoEncontrado('No encontramos ese equipo');
}

/** ¿Alguno de los contactos con acceso a este equipo es «aprobador»? */
async function puedeAprobar(t: TallerReq, s: SesionPortal, equipoId: number | null): Promise<boolean> {
  for (const c of s.contactos.filter((x) => x.rol === 'aprobador')) {
    if (equipoId === null) return true;
    if (c.acceso_todos_equipos) {
      const e = await una<{ cliente_id: number | null }>(t.pool, 'SELECT cliente_id FROM equipos WHERE id = ?', [equipoId]);
      if (e?.cliente_id === c.cliente_id) return true;
    } else if (await una(t.pool, 'SELECT 1 AS x FROM contacto_equipos WHERE contacto_id = ? AND equipo_id = ?', [c.id, equipoId])) return true;
  }
  return false;
}

interface AvanceDeOrden {
  orden_id: number;
  total: number;
  hecho: number;
}

/** El avance se pondera por horas (un trabajo largo pesa más que uno corto); un trabajo sin horas pesa como una hora. */
async function avances(t: TallerReq, ordenIds: number[]): Promise<Map<number, number | null>> {
  const salida = new Map<number, number | null>();
  if (ordenIds.length === 0) return salida;
  const f = await filas<AvanceDeOrden>(
    t.pool,
    `SELECT orden_id, SUM(GREATEST(COALESCE(horas_trabajo, 0), 1)) AS total, SUM(CASE WHEN estado = 'terminado' THEN GREATEST(COALESCE(horas_trabajo, 0), 1) ELSE 0 END) AS hecho
       FROM lineas_orden WHERE orden_id IN (${ordenIds.map(() => '?').join(',')}) AND anulada_en IS NULL AND tipo = 'servicio' GROUP BY orden_id`,
    ordenIds
  );
  for (const id of ordenIds) {
    const a = f.find((x) => x.orden_id === id);
    salida.set(id, a && Number(a.total) > 0 ? Math.round((Number(a.hecho) / Number(a.total)) * 100) : null);
  }
  return salida;
}

export async function resumenDelPortal(ctx: Contexto, t: TallerReq, s: SesionPortal) {
  const ids = await equiposPermitidos(t, s);
  const hoy = hoyDelTaller(ctx, t);
  const equipos = ids.length
    ? await filas<{ id: number; codigo_interno: string | null; placa: string | null; marca: string | null; modelo: string | null; tipo: string; cliente: string | null }>(
        t.pool,
        `SELECT e.id, e.codigo_interno, e.placa, m.nombre AS marca, e.modelo, te.nombre AS tipo, cl.nombre AS cliente FROM equipos e JOIN tipos_equipo te ON te.id = e.tipo_equipo_id
           LEFT JOIN marcas m ON m.id = e.marca_id LEFT JOIN clientes cl ON cl.id = e.cliente_id WHERE e.id IN (${ids.map(() => '?').join(',')}) ORDER BY e.codigo_interno, e.placa, e.id`,
        ids
      )
    : [];
  const abiertas = ids.length
    ? await filas<{ id: number; numero: string; equipo_id: number; estado: string; tipo: string; fecha_estimada_entrega: Date | null; descripcion: string | null }>(
        t.pool,
        `SELECT o.id, o.numero, o.equipo_id, es.nombre AS estado, tor.nombre AS tipo, o.fecha_estimada_entrega, o.descripcion FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id JOIN tipos_orden tor ON tor.id = o.tipo_orden_id
          WHERE o.equipo_id IN (${ids.map(() => '?').join(',')}) AND es.es_terminal = 0 ORDER BY o.id DESC`,
        ids
      )
    : [];
  const avance = await avances(t, abiertas.map((o) => o.id));
  const cotizaciones = ids.length
    ? await filas<{ id: number; numero: string; equipo_id: number; vence_en: string | null }>(
        t.pool,
        `SELECT id, numero, equipo_id, DATE_FORMAT(vence_en, '%Y-%m-%d') AS vence_en FROM cotizaciones WHERE equipo_id IN (${ids.map(() => '?').join(',')}) AND estado = 'enviada' AND (vence_en IS NULL OR vence_en >= ?) ORDER BY id DESC`,
        [...ids, hoy]
      )
    : [];
  const citas = ids.length
    ? await filas<{ id: number; equipo_id: number; fecha_hora: Date; por_confirmar: number }>(
        t.pool,
        `SELECT id, equipo_id, fecha_hora, por_confirmar FROM citas WHERE equipo_id IN (${ids.map(() => '?').join(',')}) AND estado = 'programada' AND fecha_hora >= ? ORDER BY fecha_hora LIMIT 20`,
        [...ids, ahoraDe(ctx)]
      )
    : [];
  return {
    taller: t.empresa.nombre,
    personas: s.contactos.map((c) => ({ nombre: c.nombre, cliente: c.cliente, rol: c.rol })),
    puede_aprobar: await puedeAprobar(t, s, null),
    equipos: equipos.map((e) => ({
      id: e.id,
      etiqueta: [e.codigo_interno, e.placa].filter(Boolean).join(' · ') || `EQUIPO ${e.id}`,
      detalle: [e.tipo, e.marca, e.modelo].filter(Boolean).join(' · '),
      cliente: e.cliente,
      ordenes_abiertas: abiertas.filter((o) => o.equipo_id === e.id).map((o) => ({ numero: o.numero, estado: o.estado, tipo: o.tipo, descripcion: o.descripcion, entrega_estimada: o.fecha_estimada_entrega, avance: avance.get(o.id) ?? null })),
    })),
    cotizaciones_por_responder: cotizaciones.map((c) => ({ id: c.id, numero: c.numero, equipo_id: c.equipo_id, vence_en: c.vence_en })),
    citas: citas.map((c) => ({ id: c.id, equipo_id: c.equipo_id, fecha_hora: c.fecha_hora, por_confirmar: c.por_confirmar === 1 })),
  };
}

export async function equipoDelPortal(ctx: Contexto, t: TallerReq, s: SesionPortal, equipoId: number, origen: { ip: string; agente: string }) {
  await exigirEquipo(t, s, equipoId);
  const e = await una<{ id: number; codigo_interno: string | null; placa: string | null; serie: string | null; marca: string | null; modelo: string | null; anio: number | null; color: string | null; tipo: string; cliente_id: number | null }>(
    t.pool,
    `SELECT e.id, e.codigo_interno, e.placa, e.serie, m.nombre AS marca, e.modelo, e.anio, e.color, te.nombre AS tipo, e.cliente_id FROM equipos e JOIN tipos_equipo te ON te.id = e.tipo_equipo_id LEFT JOIN marcas m ON m.id = e.marca_id WHERE e.id = ?`,
    [equipoId]
  );
  if (!e) throw new ErrorNoEncontrado('No encontramos ese equipo');
  const etiqueta = [e.codigo_interno, e.placa].filter(Boolean).join(' · ');
  const contacto = s.contactos.find((c) => c.cliente_id === e.cliente_id) ?? s.contactos[0]!;
  await registrarAcceso(t, { canal: 'portal', tipo: 'equipo', entidadId: e.id, referencia: etiqueta || null, clienteId: e.cliente_id, contactoId: contacto.id, ip: origen.ip, dispositivo: origen.agente, en: ahoraDe(ctx) });
  const ordenes = await filas<{ id: number; numero: string; tipo: string; estado: string; terminal: number; cancelado: number; fecha_cierre: Date | null; entrega: Date | null; descripcion: string | null }>(
    t.pool,
    `SELECT o.id, o.numero, tor.nombre AS tipo, es.nombre AS estado, es.es_terminal AS terminal, es.es_cancelado AS cancelado, o.fecha_cierre, o.fecha_estimada_entrega AS entrega, o.descripcion
       FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id JOIN tipos_orden tor ON tor.id = o.tipo_orden_id WHERE o.equipo_id = ? ORDER BY o.id DESC LIMIT 30`,
    [equipoId]
  );
  const avance = await avances(t, ordenes.map((o) => o.id));
  const lineas = ordenes.length
    ? await filas<{ orden_id: number; tipo: string; descripcion: string; cantidad: number; estado: string }>(
        t.pool,
        `SELECT orden_id, tipo, descripcion, cantidad, estado FROM lineas_orden WHERE orden_id IN (${ordenes.map(() => '?').join(',')}) AND anulada_en IS NULL ORDER BY id`,
        ordenes.map((o) => o.id)
      )
    : [];
  const documentos = await filas<{ id: number; tipo: string; folio: string; version: number; archivo_id: number; emitido_en: Date }>(
    t.pool,
    `SELECT d.id, d.tipo, d.folio, d.version, d.archivo_id, d.emitido_en FROM documentos_emitidos d LEFT JOIN ordenes o ON o.id = d.orden_id LEFT JOIN checklists c ON c.id = d.checklist_id
      WHERE d.tipo IN ('cuenta', 'informe') AND COALESCE(o.equipo_id, c.equipo_id) = ? AND NOT EXISTS (SELECT 1 FROM documentos_emitidos n WHERE n.reemplaza_a_id = d.id) ORDER BY d.emitido_en DESC, d.id DESC LIMIT 30`,
    [equipoId]
  );
  const servicios = (await estadoDeServicios(ctx, t, { equipo_id: equipoId })).map((x) => ({ servicio: x.servicio, estado: x.estado, unidad: x.unidad, restante: x.restante, ultimo_servicio: x.ultimo_servicio }));
  return {
    equipo: { id: e.id, etiqueta, codigo_interno: e.codigo_interno, placa: e.placa, serie: e.serie, marca: e.marca, modelo: e.modelo, anio: e.anio, color: e.color, tipo: e.tipo },
    puede_aprobar: await puedeAprobar(t, s, equipoId),
    ordenes: ordenes.map((o) => ({
      numero: o.numero,
      tipo: o.tipo,
      estado: o.estado,
      abierta: o.terminal === 0,
      cancelada: o.cancelado === 1,
      cerrada_en: o.fecha_cierre,
      entrega_estimada: o.entrega,
      descripcion: o.descripcion,
      avance: o.terminal === 0 ? avance.get(o.id) ?? null : null,
      trabajos: lineas.filter((l) => l.orden_id === o.id).map((l) => ({ tipo: l.tipo, descripcion: l.descripcion, cantidad: Number(l.cantidad), terminado: l.estado === 'terminado' })),
    })),
    documentos: documentos.map((d) => ({ tipo: d.tipo, folio: d.folio, version: d.version, emitido_en: d.emitido_en, url: urlFirmada(ctx, t.empresa.slug, d.archivo_id) })),
    servicios,
  };
}

// ── Cotizaciones ──────────────────────────────────────────────────────────────────────
async function exigirCotizacion(t: TallerReq, s: SesionPortal, cotizacionId: number): Promise<number | null> {
  const c = await una<{ equipo_id: number | null; estado: string }>(t.pool, 'SELECT equipo_id, estado FROM cotizaciones WHERE id = ?', [cotizacionId]);
  if (!c || !c.equipo_id || c.estado === 'borrador') throw new ErrorNoEncontrado('No encontramos esa cotización');
  await exigirEquipo(t, s, c.equipo_id);
  return c.equipo_id;
}

export async function cotizacionDelPortal(ctx: Contexto, t: TallerReq, s: SesionPortal, cotizacionId: number, origen: { ip: string; agente: string }) {
  const equipoId = await exigirCotizacion(t, s, cotizacionId);
  const d = await cotizacionParaElCliente(ctx, t, cotizacionId);
  const contacto = s.contactos[0]!;
  await registrarAcceso(t, { canal: 'portal', tipo: 'cotizacion', entidadId: cotizacionId, referencia: String((d as { numero?: string }).numero ?? ''), clienteId: contacto.cliente_id, contactoId: contacto.id, ip: origen.ip, dispositivo: origen.agente, en: ahoraDe(ctx) });
  return { ...d, puede_responder: await puedeAprobar(t, s, equipoId) };
}

export async function responderCotizacionDelPortal(
  ctx: Contexto,
  t: TallerReq,
  s: SesionPortal,
  cotizacionId: number,
  origen: { ip: string; agente: string },
  respuestas: Array<{ linea_id: number; decision: 'autorizada' | 'rechazada'; motivo_id?: number | null; motivo_texto?: string | null }>
) {
  const equipoId = await exigirCotizacion(t, s, cotizacionId);
  if (!(await puedeAprobar(t, s, equipoId))) throw new ErrorApp(403, 'SOLO_APROBADOR', 'Solo una persona de contacto con permiso de aprobar puede autorizar o rechazar. Pídale al taller que le dé ese permiso.');
  const aprobador = s.contactos.find((c) => c.rol === 'aprobador')!;
  return responderComoCliente(ctx, t, { cotizacionId, enlaceId: null, nombre: `${aprobador.nombre} (PORTAL)`, origen, respuestas });
}

// ── Pedir una cita ────────────────────────────────────────────────────────────────────
export async function solicitarCitaDelPortal(
  ctx: Contexto,
  t: TallerReq,
  s: SesionPortal,
  d: { equipo_id: number; fecha: string; hora: string; lectura_contador?: number | null; notas?: string | null },
  origen: { ip: string; agente: string }
) {
  await exigirEquipo(t, s, d.equipo_id);
  const e = await una<{ cliente_id: number | null }>(t.pool, 'SELECT cliente_id FROM equipos WHERE id = ?', [d.equipo_id]);
  const contacto = s.contactos.find((c) => c.cliente_id === e?.cliente_id) ?? s.contactos[0]!;
  const nota = [`PEDIDA POR ${contacto.nombre} DESDE EL PORTAL`, d.notas?.trim() || null].filter(Boolean).join('. ');
  const r = await crearCita(ctx, t, { usuarioId: null, esSoporte: false, ip: origen.ip }, { equipo_id: d.equipo_id, fecha: d.fecha, hora: d.hora, origen: 'portal', lectura_contador: d.lectura_contador ?? null, notas: nota, portal: { contactoId: contacto.id } });
  await avisarCitaSolicitada(ctx, t, r.cita.id as number, contacto.nombre);
  return { id: r.cita.id as number, fecha: d.fecha, hora: d.hora, por_confirmar: true, mensaje: 'Recibimos su solicitud. La recepción la confirmará con usted.' };
}

async function avisarCitaSolicitada(ctx: Contexto, t: TallerReq, citaId: number, solicitante: string): Promise<void> {
  const c = await una<{ equipo: string | null; fecha_hora: Date; sucursal: string }>(
    t.pool,
    `SELECT NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa), '') AS equipo, c.fecha_hora, s.nombre AS sucursal FROM citas c JOIN equipos e ON e.id = c.equipo_id JOIN sucursales s ON s.id = c.sucursal_id WHERE c.id = ?`,
    [citaId]
  );
  if (!c) return;
  const zona = t.empresa.zonaHoraria;
  const f = new Intl.DateTimeFormat('es-GT', { timeZone: zona, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(c.fecha_hora);
  await emitirAviso(ctx, t, { tipo: 'cita_solicitada', clave: `citasol:${citaId}`, referencia: `CITA ${citaId}`, ruta: '/citas', datos: { solicitante, equipo: c.equipo ?? '-', fecha_hora: f, sucursal: c.sucursal } });
}

export function validarCorreoDePortal(correo: string): string {
  const c = correo.trim().toLowerCase();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(c) || c.length > 150) throw new ErrorValidacion('Escriba un correo válido');
  return c;
}
