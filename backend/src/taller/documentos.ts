import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { PoolConnection } from 'mysql2/promise';
import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { localDeUtc } from '../utils/zona';
import { abrirArchivo, guardarArchivo, urlFirmada } from './archivos';
import { Actor, bitacora, siguienteNumero, TallerReq } from './comun';
import { leerConfiguracion } from './configuracion';
import { desenlaceDeRespuestas } from './cotizaciones-desenlace';
import { DESENLACE_TEXTO } from './documentos-textos';
import { DatosEmpresa, MetaPdf, pdfCotizacion, pdfCuenta, pdfInforme, ProveedorDeImagenes, Snapshot, SnapCotizacion, SnapCuenta, SnapInforme } from './pdf';

/**
 * Documentos emitidos (Fase 6c): la cuenta de una orden, el informe de un checklist y la cotización, en PDF con folio. Al emitir se toma
 * una INSTANTÁNEA de lo que decían en ese momento; si lo que muestran cambia se emite una versión nueva que reemplaza a la anterior, y si no
 * cambió se devuelve el mismo documento. No son facturas y nunca llevan costos.
 */

const TIPO_DOC = { cuenta: 'CTA', informe: 'INF' } as const;
type TipoDocumento = 'cuenta' | 'informe' | 'cotizacion';

const fechaHora = (d: Date | null, zona: string): string | null => {
  if (!d) return null;
  const { fecha, hora } = localDeUtc(d, zona);
  const [y, m, dd] = fecha.split('-');
  return `${dd}/${m}/${y} ${hora}`;
};
const fechaSola = (iso: string | null): string | null => (iso ? iso.split('-').reverse().join('/') : null);

async function datosDeEmpresa(t: TallerReq): Promise<DatosEmpresa> {
  const c = await leerConfiguracion(t);
  return { nombre: String(c['nombre_empresa'] || t.empresa.nombre), nit: String(c['nit_empresa'] ?? ''), direccion: String(c['direccion_empresa'] ?? ''), telefono: String(c['telefono_empresa'] ?? ''), correo: String(c['correo_empresa'] ?? '') };
}

// ── Las instantáneas ──────────────────────────────────────────────────────────────────
async function snapshotCuenta(t: TallerReq, ordenId: number): Promise<SnapCuenta> {
  const cfg = await leerConfiguracion(t);
  const zona = t.empresa.zonaHoraria;
  const o = await una<Record<string, unknown>>(
    t.pool,
    `SELECT o.numero, o.descripcion, o.created_at, o.subtotal, o.descuento_total, o.iva, o.total, tor.nombre AS tipo, es.nombre AS estado, s.nombre AS sucursal, c.nombre AS cliente,
            CONCAT_WS(' · ', e.codigo_interno, e.placa) AS equipo
       FROM ordenes o JOIN tipos_orden tor ON tor.id = o.tipo_orden_id JOIN estados_orden es ON es.id = o.estado_id JOIN sucursales s ON s.id = o.sucursal_id JOIN equipos e ON e.id = o.equipo_id LEFT JOIN clientes c ON c.id = o.cliente_id WHERE o.id = ?`,
    [ordenId]
  );
  if (!o) throw new ErrorNoEncontrado('No se encontró la orden');
  const lineas = await filas<Record<string, unknown>>(t.pool, 'SELECT tipo, descripcion, cantidad, precio_unitario, descuento_pct, total_linea FROM lineas_orden WHERE orden_id = ? AND anulada_en IS NULL ORDER BY id', [ordenId]);
  if (lineas.length === 0) throw new ErrorApp(409, 'SIN_LINEAS', 'La orden no tiene trabajos ni materiales que cobrar: no hay cuenta que emitir.');
  return {
    tipo: 'cuenta',
    moneda: String(cfg['moneda'] ?? 'GTQ'),
    empresa: await datosDeEmpresa(t),
    orden: { numero: String(o['numero']), tipo: String(o['tipo']), estado: String(o['estado']), sucursal: String(o['sucursal']), creada: String(fechaHora(o['created_at'] as Date, zona)), descripcion: (o['descripcion'] as string | null) ?? null },
    cliente: (o['cliente'] as string | null) ?? null,
    equipo: String(o['equipo']),
    lineas: lineas.map((l) => ({ tipo: String(l['tipo']), descripcion: String(l['descripcion']), cantidad: Number(l['cantidad']), precio_unitario: Number(l['precio_unitario']), descuento_pct: Number(l['descuento_pct']), total_linea: Number(l['total_linea']) })),
    totales: { subtotal: Number(o['subtotal']), descuento_total: Number(o['descuento_total']), iva: Number(o['iva']), total: Number(o['total']), incluye_iva: String(cfg['precios_incluyen_iva']) === 'true' },
  };
}

async function snapshotInforme(t: TallerReq, checklistId: number): Promise<SnapInforme> {
  const zona = t.empresa.zonaHoraria;
  const c = await una<Record<string, unknown>>(
    t.pool,
    `SELECT k.id, k.estado, k.completado_en, ct.nombre AS tipo, p.version, o.numero AS orden, CONCAT_WS(' · ', e.codigo_interno, e.placa) AS equipo, cl.nombre AS cliente, co.nombre_completo AS completado_por
       FROM checklists k JOIN checklist_tipos ct ON ct.id = k.tipo_id JOIN checklist_plantillas p ON p.id = k.plantilla_id JOIN equipos e ON e.id = k.equipo_id LEFT JOIN ordenes o ON o.id = k.orden_id
       LEFT JOIN clientes cl ON cl.id = e.cliente_id LEFT JOIN usuarios u ON u.id = k.completado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE k.id = ?`,
    [checklistId]
  );
  if (!c) throw new ErrorNoEncontrado('No se encontró el checklist');
  if (c['estado'] !== 'completado') throw new ErrorApp(409, 'REGLA', 'El informe se emite cuando el checklist está completado.');
  const resp = await filas<Record<string, unknown>>(
    t.pool,
    'SELECT id, seccion, descripcion, tipo_respuesta, semaforo, si_no, valor_numero, valor_texto, opcion_texto, nota FROM checklist_respuestas WHERE checklist_id = ? ORDER BY orden, id',
    [checklistId]
  );
  const fotos = await filas<{ respuesta_id: number; archivo_id: number }>(t.pool, 'SELECT f.respuesta_id, f.archivo_id FROM checklist_fotos f JOIN checklist_respuestas r ON r.id = f.respuesta_id WHERE r.checklist_id = ? ORDER BY f.orden, f.id', [checklistId]);
  const des = await desenlaceDeRespuestas(t.pool, resp.filter((r) => r['semaforo'] === 'rojo').map((r) => Number(r['id'])));
  const firma = await una<{ firmante_nombre: string; archivo_id: number; firmado_en: Date }>(t.pool, 'SELECT firmante_nombre, archivo_id, firmado_en FROM firmas WHERE checklist_id = ?', [checklistId]);
  const resultado = (r: Record<string, unknown>): string => {
    switch (r['tipo_respuesta']) {
      case 'si_no': return r['si_no'] === null ? '' : Number(r['si_no']) === 1 ? 'SÍ' : 'NO';
      case 'numero': return r['valor_numero'] === null ? '' : String(Number(r['valor_numero']));
      case 'texto': return String(r['valor_texto'] ?? '');
      case 'lista': return String(r['opcion_texto'] ?? '');
      default: return '';
    }
  };
  return {
    tipo: 'informe',
    empresa: await datosDeEmpresa(t),
    checklist: { tipo: String(c['tipo']), version: Number(c['version']), orden: (c['orden'] as string | null) ?? null, equipo: String(c['equipo']), cliente: (c['cliente'] as string | null) ?? null, completado_en: fechaHora(c['completado_en'] as Date | null, zona), completado_por: (c['completado_por'] as string | null) ?? null },
    respuestas: resp.map((r) => {
      const d = r['semaforo'] === 'rojo' ? des.get(Number(r['id'])) : undefined;
      return {
        seccion: String(r['seccion']),
        descripcion: String(r['descripcion']),
        resultado: resultado(r),
        semaforo: (r['semaforo'] as string | null) ?? null,
        nota: (r['nota'] as string | null) ?? null,
        desenlace: d ? `${DESENLACE_TEXTO[d.estado]}${d.cotizacion ? ` (${d.cotizacion})` : ''}${d.estado === 'rechazado' && d.motivo ? `: ${d.motivo}` : ''}` : null,
        fotos: fotos.filter((f) => f.respuesta_id === Number(r['id'])).map((f) => f.archivo_id),
      };
    }),
    firma: firma ? { nombre: firma.firmante_nombre, firmado_en: String(fechaHora(firma.firmado_en, zona)), archivo_id: firma.archivo_id } : null,
  };
}

const ESTADO_LINEA_TEXTO: Record<string, string> = { pendiente: 'Sin respuesta', autorizada: 'Autorizada', rechazada: 'Rechazada', agregada_a_orden: 'Autorizada y en la orden', vencida: 'Vencida' };

async function snapshotCotizacion(t: TallerReq, cotId: number): Promise<SnapCotizacion> {
  const cfg = await leerConfiguracion(t);
  const zona = t.empresa.zonaHoraria;
  const c = await una<Record<string, unknown>>(
    t.pool,
    `SELECT c.numero, c.version, c.estado, c.notas, DATE_FORMAT(c.vence_en, '%Y-%m-%d') AS vence_en, c.enviada_en, c.subtotal, c.descuento_total, c.iva, c.total, cl.nombre AS cliente,
            NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa), '') AS equipo, o.numero AS orden
       FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN equipos e ON e.id = c.equipo_id LEFT JOIN ordenes o ON o.id = c.orden_id WHERE c.id = ?`,
    [cotId]
  );
  if (!c) throw new ErrorNoEncontrado('No se encontró la cotización');
  if (c['estado'] === 'borrador') throw new ErrorApp(409, 'REGLA', 'La cotización todavía es un borrador: envíela antes de emitirla en PDF.');
  const lineas = await filas<Record<string, unknown>>(t.pool, 'SELECT tipo, descripcion, cantidad, precio_unitario, descuento_pct, total_linea, estado FROM cotizacion_lineas WHERE cotizacion_id = ? ORDER BY id', [cotId]);
  const hallazgos = await filas<{ respuesta_id: number; seccion: string; descripcion: string; nota: string | null }>(t.pool, 'SELECT h.respuesta_id, r.seccion, r.descripcion, r.nota FROM cotizacion_hallazgos h JOIN checklist_respuestas r ON r.id = h.respuesta_id WHERE h.cotizacion_id = ? ORDER BY h.id', [cotId]);
  const fotos = hallazgos.length === 0 ? [] : await filas<{ respuesta_id: number; archivo_id: number }>(t.pool, 'SELECT respuesta_id, archivo_id FROM checklist_fotos WHERE respuesta_id IN (?) ORDER BY orden, id', [hallazgos.map((h) => h.respuesta_id)]);
  return {
    tipo: 'cotizacion',
    moneda: String(cfg['moneda'] ?? 'GTQ'),
    empresa: await datosDeEmpresa(t),
    cotizacion: { numero: String(c['numero']), version: Number(c['version']), estado: String(c['estado']).toUpperCase(), vence_en: fechaSola(c['vence_en'] as string | null), enviada_en: fechaHora(c['enviada_en'] as Date | null, zona), notas: (c['notas'] as string | null) ?? null },
    cliente: (c['cliente'] as string | null) ?? null,
    equipo: (c['equipo'] as string | null) ?? null,
    orden: (c['orden'] as string | null) ?? null,
    hallazgos: hallazgos.map((h) => ({ seccion: h.seccion, descripcion: h.descripcion, nota: h.nota, fotos: fotos.filter((f) => f.respuesta_id === h.respuesta_id).map((f) => f.archivo_id) })),
    lineas: lineas.map((l) => ({ tipo: String(l['tipo']), descripcion: String(l['descripcion']), cantidad: Number(l['cantidad']), precio_unitario: Number(l['precio_unitario']), descuento_pct: Number(l['descuento_pct']), total_linea: Number(l['total_linea']), estado: ESTADO_LINEA_TEXTO[String(l['estado'])] ?? String(l['estado']) })),
    totales: { subtotal: Number(c['subtotal']), descuento_total: Number(c['descuento_total']), iva: Number(c['iva']), total: Number(c['total']), incluye_iva: String(cfg['precios_incluyen_iva']) === 'true' },
  };
}

// ── Emitir ────────────────────────────────────────────────────────────────────────────
const huellaDe = (s: Snapshot): string => createHash('sha256').update(JSON.stringify(s)).digest('hex');

function proveedorDeImagenes(ctx: Contexto, t: TallerReq): ProveedorDeImagenes {
  return async (id) => {
    try {
      const a = await abrirArchivo(ctx, t, id);
      if (!['image/jpeg', 'image/png'].includes(a.mime)) return null;
      return await fs.readFile(a.ruta);
    } catch {
      return null;
    }
  };
}

interface Origen {
  tipo: TipoDocumento;
  columna: 'orden_id' | 'checklist_id' | 'cotizacion_id';
  id: number;
}

async function emitir(ctx: Contexto, t: TallerReq, actor: Actor, origen: Origen, snap: Snapshot, folioNuevo: (con: PoolConnection) => Promise<string>, tabla: 'ordenes' | 'checklists' | 'cotizaciones') {
  const huella = huellaDe(snap);
  const zona = t.empresa.zonaHoraria;
  const ahora = ahoraDe(ctx);
  const nombrePersona = await una<{ n: string | null }>(t.pool, 'SELECT co.nombre_completo AS n FROM usuarios u JOIN colaboradores co ON co.id = u.colaborador_id WHERE u.id = ?', [actor.usuarioId]);
  // El PDF se arma antes de la transacción (no se tiene la base bloqueada mientras se dibuja); si otro emite a la vez, gana el primero.
  const previo = await una<{ id: number; folio: string; version: number; huella: string }>(t.pool, `SELECT id, folio, version, huella FROM documentos_emitidos WHERE tipo = ? AND ${origen.columna} = ? ORDER BY version DESC, id DESC LIMIT 1`, [origen.tipo, origen.id]);
  if (previo && previo.huella === huella) return { id: previo.id, nuevo: false };
  const folio = previo?.folio ?? (await transaccion(t.pool, folioNuevo));
  const version = (previo?.version ?? 0) + 1;
  const meta: MetaPdf = { folio, version, emitido: String(fechaHora(ahora, zona)), emitidoPor: nombrePersona?.n ?? null };
  const imagen = proveedorDeImagenes(ctx, t);
  const buffer = snap.tipo === 'cuenta' ? await pdfCuenta(snap, meta) : snap.tipo === 'cotizacion' ? await pdfCotizacion(snap, meta, imagen) : await pdfInforme(snap, meta, imagen);
  return transaccion(t.pool, async (con) => {
    await una(con, `SELECT id FROM ${tabla} WHERE id = ? FOR UPDATE`, [origen.id]);
    const ultimo = await una<{ id: number; version: number; huella: string }>(con, `SELECT id, version, huella FROM documentos_emitidos WHERE tipo = ? AND ${origen.columna} = ? ORDER BY version DESC, id DESC LIMIT 1`, [origen.tipo, origen.id]);
    if (ultimo && ultimo.huella === huella) return { id: ultimo.id, nuevo: false };
    if ((ultimo?.version ?? 0) !== (previo?.version ?? 0)) throw new ErrorApp(409, 'REGLA', 'Otra persona emitió este documento al mismo tiempo: vuelva a intentarlo.');
    const archivo = await guardarArchivo(ctx, t, con, actor, { buffer, mime: 'application/pdf', nombre: `${folio}-v${version}.pdf` });
    const r = await ejecutar(
      con,
      `INSERT INTO documentos_emitidos (tipo, folio, version, ${origen.columna}, huella, contenido, archivo_id, reemplaza_a_id, emitido_en, emitido_por_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [origen.tipo, folio, version, origen.id, huella, JSON.stringify(snap), archivo.id, ultimo?.id ?? null, ahora, actor.usuarioId]
    );
    await bitacora(con, actor, { accion: 'documento_emitido', entidad: 'documentos_emitidos', entidadId: r.insertId, despues: { tipo: origen.tipo, folio, version } });
    return { id: r.insertId, nuevo: true };
  });
}

const folioDe = (prefijo: string, n: number): string => `${prefijo}-${String(n).padStart(6, '0')}`;

export async function emitirCuenta(ctx: Contexto, t: TallerReq, actor: Actor, ordenId: number) {
  const snap = await snapshotCuenta(t, ordenId);
  return emitir(ctx, t, actor, { tipo: 'cuenta', columna: 'orden_id', id: ordenId }, snap, async (con) => folioDe(TIPO_DOC.cuenta, await siguienteNumero(con, 'CTA')), 'ordenes');
}

export async function emitirInforme(ctx: Contexto, t: TallerReq, actor: Actor, checklistId: number) {
  const snap = await snapshotInforme(t, checklistId);
  return emitir(ctx, t, actor, { tipo: 'informe', columna: 'checklist_id', id: checklistId }, snap, async (con) => folioDe(TIPO_DOC.informe, await siguienteNumero(con, 'INF')), 'checklists');
}

/** El folio de una cotización es su número (y «-V2» si es la versión 2); lo que cambia dentro de una misma versión (las respuestas) emite versiones del documento. */
export async function emitirCotizacion(ctx: Contexto, t: TallerReq, actor: Actor, cotizacionId: number) {
  const snap = await snapshotCotizacion(t, cotizacionId);
  const numero = snap.cotizacion.numero + (snap.cotizacion.version > 1 ? `-V${snap.cotizacion.version}` : '');
  return emitir(ctx, t, actor, { tipo: 'cotizacion', columna: 'cotizacion_id', id: cotizacionId }, snap, async () => numero, 'cotizaciones');
}

// ── Consultar ─────────────────────────────────────────────────────────────────────────
export async function listarDocumentos(ctx: Contexto, t: TallerReq, f: { id?: number; tipo?: TipoDocumento; orden_id?: number; checklist_id?: number; cotizacion_id?: number; todas?: boolean }) {
  const donde: string[] = ['1 = 1'];
  const params: unknown[] = [];
  for (const [col, v] of [['d.id', f.id], ['d.tipo', f.tipo], ['d.orden_id', f.orden_id], ['d.checklist_id', f.checklist_id], ['d.cotizacion_id', f.cotizacion_id]] as const) {
    if (v) {
      donde.push(`${col} = ?`);
      params.push(v);
    }
  }
  if (!f.todas && !f.id) donde.push('NOT EXISTS (SELECT 1 FROM documentos_emitidos n WHERE n.reemplaza_a_id = d.id)');
  const r = await filas<Record<string, unknown>>(
    t.pool,
    `SELECT d.id, d.tipo, d.folio, d.version, d.orden_id, d.checklist_id, d.cotizacion_id, d.archivo_id, d.emitido_en, co.nombre_completo AS emitido_por, d.reemplaza_a_id,
            NOT EXISTS (SELECT 1 FROM documentos_emitidos n WHERE n.reemplaza_a_id = d.id) AS vigente
       FROM documentos_emitidos d LEFT JOIN usuarios u ON u.id = d.emitido_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE ${donde.join(' AND ')} ORDER BY d.id DESC LIMIT 100`,
    params
  );
  return r.map(({ archivo_id, ...resto }) => ({ ...resto, vigente: Number(resto['vigente']) === 1, url: urlFirmada(ctx, t.empresa.slug, Number(archivo_id)) }));
}

export async function obtenerDocumento(ctx: Contexto, t: TallerReq, id: number) {
  const d = await una<{ contenido: string }>(t.pool, 'SELECT contenido FROM documentos_emitidos WHERE id = ?', [id]);
  if (!d) throw new ErrorNoEncontrado('No se encontró el documento');
  const fila = (await listarDocumentos(ctx, t, { id }))[0];
  return { ...fila, contenido: JSON.parse(d.contenido) as Snapshot };
}
