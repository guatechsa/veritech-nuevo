import { ejecutar, filas, una } from '../db/consulta';
import { Entorno } from '../config/entorno';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { limitesDelDia } from '../utils/zona';
import { TallerReq } from './comun';
import { hoyDelTaller } from './contadores';

/**
 * Avisos al teléfono (Fase 8a): trabajo asignado, material cargado, checklist por vencer, cita del día y solicitud de material nueva. Cada aviso entra a una
 * cola (con una clave que evita avisar dos veces lo mismo), respeta las preferencias de cada persona y solo llega a quien tiene el permiso de lo que se avisa.
 * Un aviso que falla NUNCA estorba la operación que lo causó. El envío real lo hace Expo (`exp.host`); en las pruebas se usa un transporte falso.
 */
export interface MensajePush {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
}
export interface ResultadoPush {
  estado: 'ok' | 'error';
  error?: string;
  mensaje?: string;
}
export interface TransportePush {
  enviar(mensajes: MensajePush[]): Promise<ResultadoPush[]>;
}

export const TOPE_DE_INTENTOS = 3;
export const MINUTOS_ENTRE_INTENTOS = 5;
/** A partir de esta hora del taller salen los avisos «del día». */
export const HORA_DE_AVISOS_DEL_DIA = 7;

/** Qué permiso exige cada aviso (la misma lista que ve la app en sus preferencias). */
const PERMISO_DE: Record<string, string> = {
  trabajo_asignado: 'ordenes.trabajar',
  material_cargado: 'ordenes.trabajar',
  checklist_por_vencer: 'checklists.llenar',
  cita_del_dia: 'citas.ver',
  solicitud_material_nueva: 'solicitudes.despachar',
};

/** Transporte real: el servicio de avisos de Expo. Sin dirección configurada o en pruebas se inyecta otro. */
export function crearTransporteExpo(entorno: Pick<Entorno, 'EXPO_ACCESS_TOKEN'>, fetchFn: typeof fetch = fetch): TransportePush {
  return {
    async enviar(mensajes) {
      const r = await fetchFn('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(entorno.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${entorno.EXPO_ACCESS_TOKEN}` } : {}) },
        body: JSON.stringify(mensajes.map((m) => ({ sound: 'default', ...m }))),
      });
      if (!r.ok) throw new Error(`Expo respondió ${r.status}`);
      const json = (await r.json()) as { data?: Array<{ status: 'ok' | 'error'; message?: string; details?: { error?: string } }> };
      return mensajes.map((_m, i) => {
        const x = json.data?.[i];
        return x?.status === 'ok' ? { estado: 'ok' as const } : { estado: 'error' as const, error: x?.details?.error ?? 'ERROR', mensaje: x?.message };
      });
    },
  };
}

// ── Encolar ───────────────────────────────────────────────────────────────────────────
export interface AvisoPush {
  usuarioId: number;
  tipo: string;
  titulo: string;
  cuerpo: string;
  datos?: Record<string, unknown>;
  clave: string;
}

/** Las personas activas que tienen un permiso (y cuyo módulo está en el plan del taller). */
export async function usuariosConPermiso(t: TallerReq, permiso: string): Promise<number[]> {
  const f = await filas<{ id: number; modulo: string }>(
    t.pool,
    `SELECT DISTINCT u.id, p.modulo FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id AND c.activo = 1 JOIN usuario_roles ur ON ur.usuario_id = u.id
       JOIN roles r ON r.id = ur.rol_id AND r.activo = 1 JOIN rol_permisos rp ON rp.rol_id = r.id JOIN permisos p ON p.codigo = rp.permiso_codigo WHERE u.activo = 1 AND p.codigo = ?`,
    [permiso]
  );
  return [...new Set(f.filter((x) => x.modulo === 'base' || t.empresa.modulos.has(x.modulo)).map((x) => x.id))];
}

/** Pone un aviso en la cola si la persona lo quiere y tiene derecho a él. Devuelve si quedó en la cola. Nunca lanza un error. */
export async function encolarPush(ctx: Contexto, t: TallerReq, a: AvisoPush): Promise<boolean> {
  try {
    const permiso = PERMISO_DE[a.tipo];
    if (!permiso || !(await usuariosConPermiso(t, permiso)).includes(a.usuarioId)) return false;
    const pref = await una<{ activo: number }>(t.pool, "SELECT activo FROM preferencias_aviso WHERE usuario_id = ? AND tipo_aviso = ? AND canal = 'push'", [a.usuarioId, a.tipo]);
    if (pref && pref.activo === 0) return false;
    const ahora = ahoraDe(ctx);
    const r = await ejecutar(
      t.pool,
      'INSERT IGNORE INTO notificaciones_push (usuario_id, tipo, titulo, cuerpo, datos, clave, creada_en, enviar_despues_de) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [a.usuarioId, a.tipo, a.titulo.slice(0, 100), a.cuerpo.slice(0, 300), a.datos ? JSON.stringify(a.datos) : null, a.clave.slice(0, 100), ahora, ahora]
    );
    return r.affectedRows === 1;
  } catch (error) {
    console.error(`[push] ${a.tipo} (${a.clave}):`, error instanceof Error ? error.message : error);
    return false;
  }
}

const sinFallar = async (nombre: string, trabajo: () => Promise<void>): Promise<void> => {
  try {
    await trabajo();
  } catch (error) {
    console.error(`[push] ${nombre}:`, error instanceof Error ? error.message : error);
  }
};

const EQUIPO = "NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa), '')";

// ── Los hechos que se avisan en el momento ────────────────────────────────────────────
/** Le asignaron un trabajo a un técnico (al crear la línea o al cambiarle el técnico). */
export async function pushTrabajoAsignado(ctx: Contexto, t: TallerReq, d: { ordenId: number; colaboradorId: number }): Promise<void> {
  await sinFallar('trabajo asignado', async () => {
    const l = await una<{ id: number; descripcion: string; numero: string; equipo: string | null; usuario_id: number }>(
      t.pool,
      `SELECT l.id, l.descripcion, o.numero, ${EQUIPO} AS equipo, u.id AS usuario_id FROM lineas_orden l JOIN ordenes o ON o.id = l.orden_id JOIN equipos e ON e.id = o.equipo_id
         JOIN usuarios u ON u.colaborador_id = l.tecnico_id AND u.activo = 1 WHERE l.orden_id = ? AND l.tecnico_id = ? AND l.anulada_en IS NULL AND l.estado <> 'terminado' ORDER BY l.id DESC LIMIT 1`,
      [d.ordenId, d.colaboradorId]
    );
    if (!l) return;
    await encolarPush(ctx, t, { usuarioId: l.usuario_id, tipo: 'trabajo_asignado', titulo: 'Le asignaron un trabajo', cuerpo: `${l.descripcion} · ${l.equipo ?? 'equipo'} · orden ${l.numero}`, datos: { pantalla: 'trabajo', linea_id: l.id, orden_id: d.ordenId }, clave: `asig:${l.id}` });
  });
}

/** Bodega despachó material a una orden: se le avisa a los técnicos que tienen trabajos abiertos en ella. */
export async function pushMaterialCargado(ctx: Contexto, t: TallerReq, solicitudId: number): Promise<void> {
  await sinFallar('material cargado', async () => {
    const s = await una<{ orden_id: number; numero: string; total: number | null }>(
      t.pool,
      'SELECT s.orden_id, o.numero, (SELECT SUM(cantidad_despachada) FROM solicitud_lineas WHERE solicitud_id = s.id) AS total FROM solicitudes_material s JOIN ordenes o ON o.id = s.orden_id WHERE s.id = ?',
      [solicitudId]
    );
    if (!s || !Number(s.total)) return;
    const tecnicos = await filas<{ usuario_id: number }>(
      t.pool,
      `SELECT DISTINCT u.id AS usuario_id FROM lineas_orden l JOIN usuarios u ON u.colaborador_id = l.tecnico_id AND u.activo = 1 WHERE l.orden_id = ? AND l.tecnico_id IS NOT NULL AND l.anulada_en IS NULL AND l.estado <> 'terminado'`,
      [s.orden_id]
    );
    for (const x of tecnicos) {
      await encolarPush(ctx, t, { usuarioId: x.usuario_id, tipo: 'material_cargado', titulo: 'Llegó material a su orden', cuerpo: `Ya se despachó material para la orden ${s.numero}.`, datos: { pantalla: 'orden', orden_id: s.orden_id }, clave: `mat:${solicitudId}:${Number(s.total)}` });
    }
  });
}

/** Hay una solicitud de material por despachar: se le avisa a quienes despachan. */
export async function pushSolicitudNueva(ctx: Contexto, t: TallerReq, solicitudId: number): Promise<void> {
  await sinFallar('solicitud nueva', async () => {
    const s = await una<{ numero: string; orden: string; equipo: string | null }>(
      t.pool,
      `SELECT s.numero, o.numero AS orden, ${EQUIPO} AS equipo FROM solicitudes_material s JOIN ordenes o ON o.id = s.orden_id JOIN equipos e ON e.id = o.equipo_id WHERE s.id = ?`,
      [solicitudId]
    );
    if (!s) return;
    for (const usuarioId of await usuariosConPermiso(t, 'solicitudes.despachar')) {
      await encolarPush(ctx, t, { usuarioId, tipo: 'solicitud_material_nueva', titulo: 'Solicitud de material por despachar', cuerpo: `${s.numero} · orden ${s.orden} · ${s.equipo ?? 'equipo'}`, datos: { pantalla: 'solicitud', solicitud_id: solicitudId }, clave: `sol:${solicitudId}` });
    }
  });
}

// ── La revisión periódica ─────────────────────────────────────────────────────────────
/** Checklists sin completar de órdenes que se entregan hoy (o ya se pasaron), y las citas del día. Cada hecho se avisa una sola vez por día. */
export async function revisarPush(ctx: Contexto, t: TallerReq): Promise<number> {
  const hoy = hoyDelTaller(ctx, t);
  const zona = t.empresa.zonaHoraria;
  const hora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: zona, hour: '2-digit', hourCycle: 'h23' }).format(ahoraDe(ctx)));
  if (hora < HORA_DE_AVISOS_DEL_DIA) return 0;
  let n = 0;
  await sinFallar('checklists por vencer', async () => {
    const f = await filas<{ id: number; tipo: string; numero: string; usuario_id: number }>(
      t.pool,
      `SELECT DISTINCT c.id, ct.nombre AS tipo, o.numero, u.id AS usuario_id FROM checklists c JOIN checklist_tipos ct ON ct.id = c.tipo_id JOIN ordenes o ON o.id = c.orden_id JOIN estados_orden es ON es.id = o.estado_id
         JOIN lineas_orden l ON l.orden_id = o.id AND l.tecnico_id IS NOT NULL AND l.anulada_en IS NULL AND l.estado <> 'terminado' JOIN usuarios u ON u.colaborador_id = l.tecnico_id AND u.activo = 1
        WHERE c.estado <> 'completado' AND es.es_terminal = 0 AND o.fecha_estimada_entrega IS NOT NULL AND o.fecha_estimada_entrega <= ?`,
      [hoy]
    );
    for (const x of f) {
      if (await encolarPush(ctx, t, { usuarioId: x.usuario_id, tipo: 'checklist_por_vencer', titulo: 'Un checklist está por vencer', cuerpo: `${x.tipo} de la orden ${x.numero}: la orden se entrega hoy y falta completarlo.`, datos: { pantalla: 'checklist', checklist_id: x.id }, clave: `chk:${x.id}:${hoy}` })) n += 1;
    }
  });
  await sinFallar('citas del día', async () => {
    const l = limitesDelDia(hoy, zona);
    const c = await una<{ n: number }>(t.pool, "SELECT COUNT(*) AS n FROM citas WHERE estado = 'programada' AND fecha_hora >= ? AND fecha_hora < ?", [l.desde, l.hasta]);
    const total = Number(c?.n ?? 0);
    if (total === 0) return;
    for (const usuarioId of await usuariosConPermiso(t, 'citas.ver')) {
      if (await encolarPush(ctx, t, { usuarioId, tipo: 'cita_del_dia', titulo: 'Citas de hoy', cuerpo: total === 1 ? 'Hoy hay 1 cita.' : `Hoy hay ${total} citas.`, datos: { pantalla: 'citas' }, clave: `citas:${hoy}` })) n += 1;
    }
  });
  return n;
}

// ── Enviar ────────────────────────────────────────────────────────────────────────────
export interface ResumenEnvioPush {
  enviadas: number;
  sin_dispositivo: number;
  con_error: number;
}

/** Manda los avisos pendientes. Cada aviso se «reserva» antes de enviarse (dos procesos a la vez nunca mandan el mismo); si falla, se reintenta (3 veces). */
export async function enviarPendientesPush(ctx: Contexto, t: TallerReq, transporte: TransportePush, limite = 50): Promise<ResumenEnvioPush> {
  const resumen: ResumenEnvioPush = { enviadas: 0, sin_dispositivo: 0, con_error: 0 };
  const ahora = ahoraDe(ctx);
  const pend = await filas<{ id: number }>(t.pool, "SELECT id FROM notificaciones_push WHERE estado = 'pendiente' AND enviar_despues_de <= ? ORDER BY id LIMIT ?", [ahora, limite]);
  for (const { id } of pend) {
    const reserva = await ejecutar(t.pool, "UPDATE notificaciones_push SET intentos = intentos + 1, enviar_despues_de = ? WHERE id = ? AND estado = 'pendiente' AND enviar_despues_de <= ?", [new Date(ahora.getTime() + MINUTOS_ENTRE_INTENTOS * 60000), id, ahora]);
    if (reserva.affectedRows !== 1) continue;
    const n = await una<{ usuario_id: number; titulo: string; cuerpo: string; datos: string | null; intentos: number }>(t.pool, 'SELECT usuario_id, titulo, cuerpo, datos, intentos FROM notificaciones_push WHERE id = ?', [id]);
    if (!n) continue;
    const telefonos = await filas<{ id: number; token_push: string }>(t.pool, 'SELECT id, token_push FROM dispositivos WHERE usuario_id = ? AND activo = 1 AND token_push IS NOT NULL', [n.usuario_id]);
    if (telefonos.length === 0) {
      await ejecutar(t.pool, "UPDATE notificaciones_push SET estado = 'sin_dispositivo' WHERE id = ?", [id]);
      resumen.sin_dispositivo += 1;
      continue;
    }
    try {
      const datos = n.datos ? (JSON.parse(n.datos) as Record<string, unknown>) : undefined;
      const resultados = await transporte.enviar(telefonos.map((x) => ({ to: x.token_push, title: n.titulo, body: n.cuerpo, ...(datos ? { data: datos } : {}) })));
      let alguno = false;
      for (let i = 0; i < telefonos.length; i++) {
        const r = resultados[i];
        if (r?.estado === 'ok') alguno = true;
        else if (r?.error === 'DeviceNotRegistered') await ejecutar(t.pool, 'UPDATE dispositivos SET activo = 0, token_push = NULL WHERE id = ?', [telefonos[i]!.id]); // el teléfono ya no recibe avisos
      }
      if (alguno) {
        await ejecutar(t.pool, "UPDATE notificaciones_push SET estado = 'enviada', enviada_en = ?, ultimo_error = NULL WHERE id = ?", [ahoraDe(ctx), id]);
        resumen.enviadas += 1;
      } else {
        const sinTelefonos = resultados.every((r) => r?.error === 'DeviceNotRegistered');
        await ejecutar(t.pool, 'UPDATE notificaciones_push SET estado = ?, ultimo_error = ? WHERE id = ?', [sinTelefonos ? 'sin_dispositivo' : n.intentos >= TOPE_DE_INTENTOS ? 'error' : 'pendiente', (resultados[0]?.error ?? 'ERROR').slice(0, 300), id]);
        if (sinTelefonos) resumen.sin_dispositivo += 1;
        else resumen.con_error += 1;
      }
    } catch (error) {
      await ejecutar(t.pool, 'UPDATE notificaciones_push SET estado = ?, ultimo_error = ? WHERE id = ?', [n.intentos >= TOPE_DE_INTENTOS ? 'error' : 'pendiente', (error instanceof Error ? error.message : String(error)).slice(0, 300), id]);
      resumen.con_error += 1;
    }
  }
  return resumen;
}
