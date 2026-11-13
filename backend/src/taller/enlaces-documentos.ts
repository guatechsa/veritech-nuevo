import { randomBytes } from 'crypto';
import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { registrarAcceso } from './accesos';
import { urlFirmada } from './archivos';
import { urlBaseDeTaller } from './auth';
import { avisarPrimeraAperturaDe } from './avisos';
import { Actor, bitacora, TallerReq } from './comun';
import { leerConfiguracion } from './configuracion';
import { huellaDe, noDisponible, ROBOTS } from './enlaces';
import type { SnapCuenta, SnapInforme } from './pdf';

/**
 * Enlaces para el cliente a la CUENTA de una orden y al INFORME de un checklist (Fase 7d). El enlace sirve siempre la versión VIGENTE del
 * documento (si se emite una nueva, el mismo enlace muestra la nueva y lo dice). Mismas reglas que el de la cotización: el enlace completo
 * se ve una sola vez, vence (30 días por defecto), se revoca, responde siempre igual si no sirve y la primera apertura real avisa.
 */
export type TipoEnlaceDocumento = 'cuenta' | 'checklist';

const TIPO_DOC: Record<TipoEnlaceDocumento, 'cuenta' | 'informe'> = { cuenta: 'cuenta', checklist: 'informe' };
const COLUMNA: Record<TipoEnlaceDocumento, 'orden_id' | 'checklist_id'> = { cuenta: 'orden_id', checklist: 'checklist_id' };

interface DocVigente {
  id: number;
  folio: string;
  version: number;
  archivo_id: number;
  emitido_en: Date;
  contenido: string;
  orden_id: number | null;
  checklist_id: number | null;
}

async function documentoVigente(t: TallerReq, tipo: TipoEnlaceDocumento, entidadId: number): Promise<DocVigente | null> {
  return una<DocVigente>(
    t.pool,
    `SELECT d.id, d.folio, d.version, d.archivo_id, d.emitido_en, d.contenido, d.orden_id, d.checklist_id FROM documentos_emitidos d
      WHERE d.tipo = ? AND d.${COLUMNA[tipo]} = ? AND NOT EXISTS (SELECT 1 FROM documentos_emitidos n WHERE n.reemplaza_a_id = d.id) ORDER BY d.id DESC LIMIT 1`,
    [TIPO_DOC[tipo], entidadId]
  );
}

// ── Del lado del taller ───────────────────────────────────────────────────────────────
export async function crearEnlaceDeDocumento(ctx: Contexto, t: TallerReq, actor: Actor, tipo: TipoEnlaceDocumento, entidadId: number) {
  const doc = await documentoVigente(t, tipo, entidadId);
  if (!doc) throw new ErrorApp(409, 'SIN_DOCUMENTO', tipo === 'cuenta' ? 'Emita la cuenta de la orden antes de mandarle el enlace al cliente.' : 'Emita el informe del checklist antes de mandarle el enlace al cliente.');
  const cfg = await leerConfiguracion(t);
  const dias = Math.max(1, Number(cfg['vigencia_enlace_dias'] ?? 30));
  const token = randomBytes(32).toString('hex');
  const ahora = ahoraDe(ctx);
  const vence = new Date(ahora.getTime() + dias * 86400000);
  await transaccion(t.pool, async (con) => {
    await ejecutar(con, 'UPDATE enlaces_publicos SET revocado_en = ?, revocado_por_id = ? WHERE tipo = ? AND entidad_id = ? AND revocado_en IS NULL', [ahora, actor.usuarioId, tipo, entidadId]);
    await ejecutar(con, 'INSERT INTO enlaces_publicos (huella, tipo, entidad_id, creado_por_id, vence_en) VALUES (?, ?, ?, ?, ?)', [huellaDe(token), tipo, entidadId, actor.usuarioId, vence]);
    await bitacora(con, actor, { accion: 'enlace_documento_creado', entidad: tipo === 'cuenta' ? 'ordenes' : 'checklists', entidadId, despues: { folio: doc.folio, version: doc.version, vence_en: vence } });
  });
  return { url: `${urlBaseDeTaller(ctx, t.empresa)}/documento/${token}`, folio: doc.folio, vence_en: vence };
}

/** Revoca TODOS los enlaces de una orden: el de su cuenta, los de sus checklists y los de sus cotizaciones. */
export async function revocarEnlacesDeOrden(ctx: Contexto, t: TallerReq, actor: Actor, ordenId: number) {
  const r = await ejecutar(
    t.pool,
    `UPDATE enlaces_publicos SET revocado_en = ?, revocado_por_id = ? WHERE revocado_en IS NULL AND (
        (tipo = 'cuenta' AND entidad_id = ?)
        OR (tipo = 'checklist' AND entidad_id IN (SELECT id FROM checklists WHERE orden_id = ?))
        OR (tipo = 'cotizacion' AND entidad_id IN (SELECT id FROM cotizaciones WHERE orden_id = ?)))`,
    [ahoraDe(ctx), actor.usuarioId, ordenId, ordenId, ordenId]
  );
  await bitacora(t.pool, actor, { accion: 'enlaces_de_orden_revocados', entidad: 'ordenes', entidadId: ordenId, despues: { enlaces: r.affectedRows } });
  return r.affectedRows;
}

export async function listarEnlacesDeOrden(ctx: Contexto, t: TallerReq, ordenId: number) {
  const ahora = ahoraDe(ctx);
  const f = await filas<{ id: number; tipo: string; referencia: string | null; creado: string | null; created_at: Date; vence_en: Date; revocado_en: Date | null; primera_apertura_en: Date | null; ultima_apertura_en: Date | null; aperturas: number }>(
    t.pool,
    `SELECT e.id, e.tipo,
            CASE e.tipo WHEN 'cuenta' THEN (SELECT d.folio FROM documentos_emitidos d WHERE d.tipo = 'cuenta' AND d.orden_id = e.entidad_id ORDER BY d.id DESC LIMIT 1)
                        WHEN 'checklist' THEN (SELECT d.folio FROM documentos_emitidos d WHERE d.tipo = 'informe' AND d.checklist_id = e.entidad_id ORDER BY d.id DESC LIMIT 1)
                        WHEN 'cotizacion' THEN (SELECT c.numero FROM cotizaciones c WHERE c.id = e.entidad_id) END AS referencia,
            co.nombre_completo AS creado, e.created_at, e.vence_en, e.revocado_en, e.primera_apertura_en, e.ultima_apertura_en, e.aperturas
       FROM enlaces_publicos e LEFT JOIN usuarios u ON u.id = e.creado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id
      WHERE (e.tipo = 'cuenta' AND e.entidad_id = ?)
         OR (e.tipo = 'checklist' AND e.entidad_id IN (SELECT id FROM checklists WHERE orden_id = ?))
         OR (e.tipo = 'cotizacion' AND e.entidad_id IN (SELECT id FROM cotizaciones WHERE orden_id = ?))
      ORDER BY e.id DESC LIMIT 50`,
    [ordenId, ordenId, ordenId]
  );
  return f.map((e) => ({ ...e, aperturas: Number(e.aperturas), vigente: e.revocado_en === null && e.vence_en.getTime() > ahora.getTime() }));
}

// ── Del lado del cliente ──────────────────────────────────────────────────────────────
function resumenDe(contenido: string, tipo: TipoEnlaceDocumento) {
  if (tipo === 'cuenta') {
    const s = JSON.parse(contenido) as SnapCuenta;
    return {
      moneda: s.moneda,
      orden: s.orden.numero,
      cliente: s.cliente,
      equipo: s.equipo,
      lineas: s.lineas.map((l) => ({ tipo: l.tipo, descripcion: l.descripcion, cantidad: l.cantidad, total_linea: l.total_linea })),
      totales: s.totales,
      empresa: s.empresa,
    };
  }
  const s = JSON.parse(contenido) as SnapInforme;
  return {
    checklist: s.checklist.tipo,
    orden: s.checklist.orden,
    cliente: s.checklist.cliente,
    equipo: s.checklist.equipo,
    completado_en: s.checklist.completado_en,
    hallazgos: s.respuestas.filter((r) => r.semaforo === 'rojo' || r.semaforo === 'amarillo').map((r) => ({ seccion: r.seccion, descripcion: r.descripcion, semaforo: r.semaforo, nota: r.nota })),
    revisados: s.respuestas.length,
    empresa: s.empresa,
  };
}

export async function verDocumentoPublico(ctx: Contexto, t: TallerReq, token: string, origen: { ip: string; agente: string }) {
  if (!/^[0-9a-f]{64}$/.test(token)) throw noDisponible();
  const ahora = ahoraDe(ctx);
  const e = await una<{ id: number; tipo: TipoEnlaceDocumento; entidad_id: number; creado_por_id: number | null; primera_apertura_en: Date | null }>(
    t.pool,
    "SELECT id, tipo, entidad_id, creado_por_id, primera_apertura_en FROM enlaces_publicos WHERE huella = ? AND tipo IN ('cuenta', 'checklist') AND revocado_en IS NULL AND vence_en > ?",
    [huellaDe(token), ahora]
  );
  if (!e) throw noDisponible();
  const doc = await documentoVigente(t, e.tipo, e.entidad_id);
  if (!doc) throw noDisponible();
  const orden = doc.orden_id
    ? await una<{ cliente_id: number | null }>(t.pool, 'SELECT cliente_id FROM ordenes WHERE id = ?', [doc.orden_id])
    : doc.checklist_id
      ? await una<{ cliente_id: number | null }>(t.pool, 'SELECT o.cliente_id FROM checklists c LEFT JOIN ordenes o ON o.id = c.orden_id WHERE c.id = ?', [doc.checklist_id])
      : null;
  if (!ROBOTS.test(origen.agente)) {
    await ejecutar(t.pool, 'UPDATE enlaces_publicos SET aperturas = aperturas + 1, ultima_apertura_en = ?, primera_apertura_en = COALESCE(primera_apertura_en, ?), primera_apertura_ip = COALESCE(primera_apertura_ip, ?) WHERE id = ?', [ahora, ahora, origen.ip.slice(0, 64), e.id]);
    await registrarAcceso(t, { canal: 'enlace', tipo: e.tipo, entidadId: e.entidad_id, referencia: doc.folio, clienteId: orden?.cliente_id ?? null, ip: origen.ip, dispositivo: origen.agente, en: ahora });
    if (e.primera_apertura_en === null) await avisarPrimeraAperturaDe(ctx, t, { enlaceId: e.id, referencia: doc.folio, clienteId: orden?.cliente_id ?? null, creadoPorId: e.creado_por_id });
  }
  return {
    disponible: true,
    tipo: e.tipo,
    folio: doc.folio,
    version: doc.version,
    emitido_en: doc.emitido_en,
    reemplaza_a_una_anterior: doc.version > 1,
    taller: t.empresa.nombre,
    url: urlFirmada(ctx, t.empresa.slug, doc.archivo_id),
    aviso: 'Documento informativo emitido por el taller; no es una factura.',
    resumen: resumenDe(doc.contenido, e.tipo),
  };
}
