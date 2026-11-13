import { createHash, randomBytes } from 'crypto';
import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { normalizarCampo } from '../utils/texto';
import { urlFirmada } from './archivos';
import { urlBaseDeTaller } from './auth';
import { Actor, bitacora, TallerReq } from './comun';
import { leerConfiguracion } from './configuracion';
import { hoyDelTaller } from './contadores';

/**
 * Enlaces públicos (Fase 6b). El cliente abre el enlace, sin iniciar sesión, ve su cotización con las fotos de lo que se encontró, y
 * autoriza o rechaza CADA línea escribiendo su nombre. Queda la fecha, la hora, el dispositivo y la dirección de red. Reglas:
 * el enlace completo solo se ve al crearlo (en la base solo queda su huella); crear uno nuevo anula los anteriores de esa cotización;
 * caduca (30 días por defecto) y se puede revocar; un enlace malo, caducado o revocado responde siempre lo mismo; no se muestran
 * costos, técnicos ni notas internas; y las vistas previas automáticas (WhatsApp, correo) no cuentan como «primera apertura».
 */

const huellaDe = (token: string): string => createHash('sha256').update(token).digest('hex');
const noDisponible = (): ErrorApp => new ErrorApp(404, 'ENLACE_NO_DISPONIBLE', 'Este enlace no está disponible: puede haber vencido o haber sido reemplazado. Pídale al taller uno nuevo.');
const ROBOTS = /bot|crawler|spider|preview|whatsapp|facebookexternalhit|slackbot|telegrambot|skypeuripreview|googleimageproxy|linkedinbot|embedly|headless/i;

// ── Del lado del taller ───────────────────────────────────────────────────────────────
export async function crearEnlaceCotizacion(ctx: Contexto, t: TallerReq, actor: Actor, cotizacionId: number) {
  const cfg = await leerConfiguracion(t);
  const dias = Math.max(1, Number(cfg['vigencia_enlace_dias'] ?? 30));
  const token = randomBytes(32).toString('hex');
  const ahora = ahoraDe(ctx);
  const vence = new Date(ahora.getTime() + dias * 86400000);
  await transaccion(t.pool, async (con) => {
    const c = await una<{ numero: string; estado: string }>(con, 'SELECT numero, estado FROM cotizaciones WHERE id = ? FOR UPDATE', [cotizacionId]);
    if (!c) throw new ErrorApp(404, 'NO_ENCONTRADO', 'No se encontró la cotización');
    if (c.estado !== 'enviada') throw new ErrorApp(409, 'REGLA', c.estado === 'borrador' ? `La cotización ${c.numero} todavía es un borrador: envíela primero.` : `La cotización ${c.numero} está ${c.estado}: ya no se le manda enlace al cliente.`);
    await ejecutar(con, "UPDATE enlaces_publicos SET revocado_en = ?, revocado_por_id = ? WHERE tipo = 'cotizacion' AND entidad_id = ? AND revocado_en IS NULL", [ahora, actor.usuarioId, cotizacionId]);
    await ejecutar(con, "INSERT INTO enlaces_publicos (huella, tipo, entidad_id, creado_por_id, vence_en) VALUES (?, 'cotizacion', ?, ?, ?)", [huellaDe(token), cotizacionId, actor.usuarioId, vence]);
    await bitacora(con, actor, { accion: 'enlace_cotizacion_creado', entidad: 'cotizaciones', entidadId: cotizacionId, despues: { numero: c.numero, vence_en: vence } });
  });
  return { url: `${urlBaseDeTaller(ctx, t.empresa)}/cotizacion/${token}`, vence_en: vence };
}

export async function revocarEnlacesCotizacion(ctx: Contexto, t: TallerReq, actor: Actor, cotizacionId: number) {
  const r = await ejecutar(t.pool, "UPDATE enlaces_publicos SET revocado_en = ?, revocado_por_id = ? WHERE tipo = 'cotizacion' AND entidad_id = ? AND revocado_en IS NULL", [ahoraDe(ctx), actor.usuarioId, cotizacionId]);
  await bitacora(t.pool, actor, { accion: 'enlace_cotizacion_revocado', entidad: 'cotizaciones', entidadId: cotizacionId, despues: { enlaces: r.affectedRows } });
  return r.affectedRows;
}

export async function listarEnlacesCotizacion(ctx: Contexto, t: TallerReq, cotizacionId: number) {
  const ahora = ahoraDe(ctx);
  const f = await filas<{ id: number; creado: string | null; created_at: Date; vence_en: Date; revocado_en: Date | null; primera_apertura_en: Date | null; ultima_apertura_en: Date | null; aperturas: number }>(
    t.pool,
    `SELECT e.id, co.nombre_completo AS creado, e.created_at, e.vence_en, e.revocado_en, e.primera_apertura_en, e.ultima_apertura_en, e.aperturas
       FROM enlaces_publicos e LEFT JOIN usuarios u ON u.id = e.creado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE e.tipo = 'cotizacion' AND e.entidad_id = ? ORDER BY e.id DESC LIMIT 20`,
    [cotizacionId]
  );
  return f.map((e) => ({ ...e, aperturas: Number(e.aperturas), vigente: e.revocado_en === null && e.vence_en.getTime() > ahora.getTime() }));
}

// ── Del lado del cliente ──────────────────────────────────────────────────────────────
interface EnlaceCrudo {
  id: number;
  entidad_id: number;
}

async function enlaceValido(ctx: Contexto, t: TallerReq, token: string): Promise<EnlaceCrudo> {
  if (!/^[0-9a-f]{64}$/.test(token)) throw noDisponible();
  const e = await una<EnlaceCrudo>(t.pool, "SELECT id, entidad_id FROM enlaces_publicos WHERE huella = ? AND tipo = 'cotizacion' AND revocado_en IS NULL AND vence_en > ?", [huellaDe(token), ahoraDe(ctx)]);
  if (!e) throw noDisponible();
  return e;
}

/** Lo que el cliente puede ver: nada de costos, técnicos, usuarios ni notas internas. */
async function cotizacionParaElCliente(ctx: Contexto, t: TallerReq, id: number) {
  const hoy = hoyDelTaller(ctx, t);
  const c = await una<Record<string, unknown>>(
    t.pool,
    `SELECT c.id, c.numero, c.version, c.estado, c.notas, DATE_FORMAT(c.vence_en, '%Y-%m-%d') AS vence_en, c.enviada_en, cl.nombre AS cliente, NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa), '') AS equipo,
            c.subtotal, c.descuento_total, c.iva, c.total
       FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN equipos e ON e.id = c.equipo_id WHERE c.id = ?`,
    [id]
  );
  if (!c) throw noDisponible();
  const cfg = await leerConfiguracion(t);
  const base = { empresa: t.empresa.nombre, moneda: String(cfg['moneda'] ?? 'GTQ'), numero: c['numero'], version: c['version'], estado: c['estado'] };
  if (c['estado'] === 'reemplazada') return { ...base, disponible: false, aviso: 'Esta cotización fue reemplazada por una versión nueva. Pídale al taller el enlace actualizado.' };
  if (c['estado'] === 'anulada' || c['estado'] === 'borrador') return { ...base, disponible: false, aviso: 'Esta cotización ya no está disponible.' };
  const vencida = String(c['vence_en'] ?? '9999-12-31') < hoy || c['estado'] === 'vencida';
  const lineas = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT l.id, l.tipo, l.respuesta_id, l.descripcion, l.cantidad, l.precio_unitario, l.descuento_pct, l.total_linea, l.horas, l.estado, mo.nombre AS motivo_rechazo, l.motivo_rechazo_texto, l.respondida_en, l.respondida_por_nombre
       FROM cotizacion_lineas l LEFT JOIN motivos mo ON mo.id = l.motivo_rechazo_id WHERE l.cotizacion_id = ? ORDER BY l.id`,
    [id]
  );
  const hallazgos = await filas<{ respuesta_id: number; seccion: string; descripcion: string; nota: string | null }>(
    t.pool,
    'SELECT h.respuesta_id, r.seccion, r.descripcion, r.nota FROM cotizacion_hallazgos h JOIN checklist_respuestas r ON r.id = h.respuesta_id WHERE h.cotizacion_id = ? ORDER BY h.id',
    [id]
  );
  const fotos = hallazgos.length === 0 ? [] : await filas<{ respuesta_id: number; archivo_id: number }>(t.pool, 'SELECT respuesta_id, archivo_id FROM checklist_fotos WHERE respuesta_id IN (?) ORDER BY orden, id', [hallazgos.map((h) => h.respuesta_id)]);
  const pendientes = lineas.filter((l) => l['estado'] === 'pendiente').length;
  const motivos = await filas<{ id: number; nombre: string }>(t.pool, "SELECT id, nombre FROM motivos WHERE tipo = 'rechazo_cotizacion' AND activo = 1 ORDER BY id");
  return {
    ...base,
    disponible: true,
    cliente: c['cliente'],
    equipo: c['equipo'],
    notas: c['notas'],
    vence_en: c['vence_en'],
    enviada_en: c['enviada_en'],
    vencida,
    se_puede_responder: c['estado'] === 'enviada' && !vencida && pendientes > 0,
    subtotal: Number(c['subtotal']),
    descuento_total: Number(c['descuento_total']),
    iva: Number(c['iva']),
    total: Number(c['total']),
    motivos_rechazo: motivos,
    lineas: lineas.map((l) => ({ ...l, cantidad: Number(l['cantidad']), precio_unitario: Number(l['precio_unitario']), descuento_pct: Number(l['descuento_pct']), total_linea: Number(l['total_linea']), horas: l['horas'] === null ? null : Number(l['horas']) })),
    hallazgos: hallazgos.map((h) => ({ ...h, fotos: fotos.filter((f) => f.respuesta_id === h.respuesta_id).map((f) => ({ url: urlFirmada(ctx, t.empresa.slug, f.archivo_id) })) })),
  };
}

export async function verCotizacionPublica(ctx: Contexto, t: TallerReq, token: string, origen: { ip: string; agente: string }) {
  const e = await enlaceValido(ctx, t, token);
  if (!ROBOTS.test(origen.agente)) {
    const ahora = ahoraDe(ctx);
    await ejecutar(t.pool, 'UPDATE enlaces_publicos SET aperturas = aperturas + 1, ultima_apertura_en = ?, primera_apertura_en = COALESCE(primera_apertura_en, ?), primera_apertura_ip = COALESCE(primera_apertura_ip, ?) WHERE id = ?', [ahora, ahora, origen.ip.slice(0, 64), e.id]);
  }
  return cotizacionParaElCliente(ctx, t, e.entidad_id);
}

export async function responderPorEnlace(
  ctx: Contexto,
  t: TallerReq,
  token: string,
  origen: { ip: string; agente: string },
  d: { nombre: string; respuestas: Array<{ linea_id: number; decision: 'autorizada' | 'rechazada'; motivo_id?: number | null; motivo_texto?: string | null }> }
) {
  const e = await enlaceValido(ctx, t, token);
  const nombre = normalizarCampo('texto', d.nombre);
  if (!nombre || nombre.length < 3) throw new ErrorValidacion('Escriba su nombre completo para registrar la respuesta');
  if (d.respuestas.length === 0) throw new ErrorValidacion('No hay ninguna respuesta que registrar');
  const hoy = hoyDelTaller(ctx, t);
  const ahora = ahoraDe(ctx);
  await transaccion(t.pool, async (con) => {
    const c = await una<{ numero: string; estado: string; vence_en: string | null }>(con, "SELECT numero, estado, DATE_FORMAT(vence_en, '%Y-%m-%d') AS vence_en FROM cotizaciones WHERE id = ? FOR UPDATE", [e.entidad_id]);
    if (!c) throw noDisponible();
    if (c.estado !== 'enviada') throw new ErrorApp(409, 'REGLA', c.estado === 'respondida' ? 'Esta cotización ya fue respondida en su totalidad.' : 'Esta cotización ya no se puede responder.');
    if (c.vence_en && c.vence_en < hoy) throw new ErrorApp(409, 'COTIZACION_VENCIDA', `Esta cotización venció el ${c.vence_en}: pídale al taller una nueva.`);
    const vistos = new Set<number>();
    for (const r of d.respuestas) {
      if (vistos.has(r.linea_id)) throw new ErrorValidacion('Una línea aparece dos veces');
      vistos.add(r.linea_id);
      const l = await una<{ estado: string }>(con, 'SELECT estado FROM cotizacion_lineas WHERE id = ? AND cotizacion_id = ? FOR UPDATE', [r.linea_id, e.entidad_id]);
      if (!l) throw new ErrorValidacion('Una de las líneas no es de esta cotización');
      if (l.estado !== 'pendiente') throw new ErrorApp(409, 'REGLA', 'Una de las líneas ya tenía respuesta y no se cambia.');
      let motivoId: number | null = null;
      if (r.decision === 'rechazada') {
        const m = r.motivo_id ? await una<{ activo: number }>(con, "SELECT activo FROM motivos WHERE id = ? AND tipo = 'rechazo_cotizacion'", [r.motivo_id]) : null;
        if (!m || m.activo !== 1) throw new ErrorValidacion('Para rechazar una línea elija el motivo');
        motivoId = r.motivo_id as number;
      }
      await ejecutar(
        con,
        'UPDATE cotizacion_lineas SET estado = ?, motivo_rechazo_id = ?, motivo_rechazo_texto = ?, respondida_en = ?, respondida_por_nombre = ?, dispositivo = ?, ip = ?, enlace_id = ? WHERE id = ?',
        [r.decision, motivoId, normalizarCampo('texto', r.motivo_texto)?.slice(0, 300) ?? null, ahora, nombre.slice(0, 100), origen.agente.slice(0, 200), origen.ip.slice(0, 64), e.id, r.linea_id]
      );
    }
    const pend = await una<{ n: number }>(con, "SELECT COUNT(*) AS n FROM cotizacion_lineas WHERE cotizacion_id = ? AND estado = 'pendiente'", [e.entidad_id]);
    if (Number(pend?.n ?? 0) === 0) await ejecutar(con, "UPDATE cotizaciones SET estado = 'respondida' WHERE id = ?", [e.entidad_id]);
    await bitacora(con, { usuarioId: null, ip: origen.ip }, { accion: 'cotizacion_respondida_por_enlace', entidad: 'cotizaciones', entidadId: e.entidad_id, despues: { numero: c.numero, nombre, lineas: d.respuestas.length } });
  });
  return cotizacionParaElCliente(ctx, t, e.entidad_id);
}
