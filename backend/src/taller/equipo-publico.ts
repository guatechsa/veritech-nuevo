import { randomBytes } from 'crypto';
import { ejecutar, filas, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { registrarAcceso } from './accesos';
import { urlFirmada } from './archivos';
import { urlBaseDeTaller } from './auth';
import { Actor, bitacora, TallerReq } from './comun';
import { ROBOTS } from './enlaces';
import { estadoDeServicios } from './servicios';

/**
 * QR del equipo (Fase 7d). El código impreso lleva solo una clave al azar del equipo (`codigo_publico`), sin el número de empresa ni el id: la
 * empresa sale del nombre en la dirección. Quien lo escanea ve la ficha del equipo y su historial (lo que decidió Luis: todo lo del vehículo,
 * menos costos, precios y datos operativos del taller como técnicos o tiempos). Se puede cambiar la clave si un código se filtra.
 */
const noDisponible = (): ErrorApp => new ErrorApp(404, 'ENLACE_NO_DISPONIBLE', 'Este código no está disponible. Pida ayuda al taller.');

/** La dirección que va dentro del QR. */
export const urlDeQr = (ctx: Contexto, t: TallerReq, codigo: string): string => `${urlBaseDeTaller(ctx, t.empresa)}/equipo/${codigo}`;

export async function qrDeEquipo(ctx: Contexto, t: TallerReq, equipoId: number) {
  const e = await una<{ codigo_publico: string; codigo_interno: string | null; placa: string | null }>(t.pool, 'SELECT codigo_publico, codigo_interno, placa FROM equipos WHERE id = ?', [equipoId]);
  if (!e) throw new ErrorNoEncontrado('No se encontró el equipo');
  return { codigo: e.codigo_publico, url: urlDeQr(ctx, t, e.codigo_publico), etiqueta: [e.codigo_interno, e.placa].filter(Boolean).join(' · ') };
}

/** Cambia la clave del QR: el código impreso anterior deja de servir (para cuando un código se filtra o se pierde un equipo). */
export async function regenerarQr(ctx: Contexto, t: TallerReq, actor: Actor, equipoId: number) {
  const nuevo = randomBytes(8).toString('hex');
  const r = await ejecutar(t.pool, 'UPDATE equipos SET codigo_publico = ? WHERE id = ?', [nuevo, equipoId]);
  if (r.affectedRows === 0) throw new ErrorNoEncontrado('No se encontró el equipo');
  await bitacora(t.pool, actor, { accion: 'qr_regenerado', entidad: 'equipos', entidadId: equipoId });
  return qrDeEquipo(ctx, t, equipoId);
}

export async function verEquipoPublico(ctx: Contexto, t: TallerReq, codigo: string, origen: { ip: string; agente: string }) {
  if (!/^[0-9a-f]{16}$/.test(codigo)) throw noDisponible();
  const e = await una<{ id: number; codigo_interno: string | null; placa: string | null; serie: string | null; marca: string | null; modelo: string | null; anio: number | null; color: string | null; tipo: string; cliente_id: number | null; estado: string }>(
    t.pool,
    `SELECT e.id, e.codigo_interno, e.placa, e.serie, m.nombre AS marca, e.modelo, e.anio, e.color, te.nombre AS tipo, e.cliente_id, e.estado
       FROM equipos e JOIN tipos_equipo te ON te.id = e.tipo_equipo_id LEFT JOIN marcas m ON m.id = e.marca_id WHERE e.codigo_publico = ?`,
    [codigo]
  );
  if (!e) throw noDisponible();
  const etiqueta = [e.codigo_interno, e.placa].filter(Boolean).join(' · ');
  if (!ROBOTS.test(origen.agente)) await registrarAcceso(t, { canal: 'qr', tipo: 'equipo', entidadId: e.id, referencia: etiqueta || null, clienteId: e.cliente_id, ip: origen.ip, dispositivo: origen.agente, en: ahoraDe(ctx) });

  const foto = await una<{ archivo_id: number }>(t.pool, 'SELECT archivo_id FROM equipo_fotos WHERE equipo_id = ? ORDER BY es_principal DESC, id LIMIT 1', [e.id]);
  const servicios = (await estadoDeServicios(ctx, t, { equipo_id: e.id })).map((s) => ({ servicio: s.servicio, estado: s.estado, unidad: s.unidad, restante: s.restante, ultimo_servicio: s.ultimo_servicio }));
  const ordenes = await filas<{ id: number; numero: string; fecha_cierre: Date | null; tipo: string; descripcion: string | null }>(
    t.pool,
    `SELECT o.id, o.numero, o.fecha_cierre, tor.nombre AS tipo, o.descripcion FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id JOIN tipos_orden tor ON tor.id = o.tipo_orden_id
      WHERE o.equipo_id = ? AND es.es_terminal = 1 AND es.es_cancelado = 0 ORDER BY o.fecha_cierre DESC, o.id DESC LIMIT 15`,
    [e.id]
  );
  const lineas = ordenes.length
    ? await filas<{ orden_id: number; tipo: string; descripcion: string; cantidad: number }>(
        t.pool,
        `SELECT orden_id, tipo, descripcion, cantidad FROM lineas_orden WHERE orden_id IN (${ordenes.map(() => '?').join(',')}) AND anulada_en IS NULL ORDER BY id`,
        ordenes.map((o) => o.id)
      )
    : [];
  return {
    disponible: true,
    taller: t.empresa.nombre,
    equipo: { etiqueta, codigo_interno: e.codigo_interno, placa: e.placa, serie: e.serie, marca: e.marca, modelo: e.modelo, anio: e.anio, color: e.color, tipo: e.tipo, fuera_de_servicio: e.estado !== 'activo' },
    foto: foto ? urlFirmada(ctx, t.empresa.slug, foto.archivo_id) : null,
    servicios,
    historial: ordenes.map((o) => ({ numero: o.numero, cerrada_en: o.fecha_cierre, tipo: o.tipo, descripcion: o.descripcion, trabajos: lineas.filter((l) => l.orden_id === o.id).map((l) => ({ tipo: l.tipo, descripcion: l.descripcion, cantidad: Number(l.cantidad) })) })),
  };
}
