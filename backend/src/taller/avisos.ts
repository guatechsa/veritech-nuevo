import { encolarCorreo } from '../correos/cola';
import { botonCorreo, plantillaCorreo } from '../correos/plantilla';
import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { escaparHtml } from '../utils/html';
import { urlBaseDeTaller } from './auth';
import { pushSolicitudNueva } from './avisos-push';
import { Actor, bitacora, TallerReq } from './comun';

/**
 * Avisos incluidos (Fase 7b). Los TIPOS de aviso y sus textos incluidos viven aquí; cada taller decide si cada aviso está encendido,
 * puede cambiar el asunto y el texto, el umbral de días y a quién le llega (por rol, por persona o por correo).
 *
 * Reglas:
 *  - Un aviso NUNCA interrumpe lo que lo causó: `emitirAviso` no lanza errores (los anota en el registro del servidor).
 *  - El mismo hecho nunca se avisa dos veces: la clave del hecho es única por tipo (tabla `avisos_registro`) y además la cola de
 *    correos de la plataforma ignora una clave repetida.
 *  - Los textos propios se guardan tal como se escriben (son cartas, no datos del taller) y solo admiten los {datos} de ese aviso.
 *  - Todo dato que escribió una persona se escapa antes de entrar al correo.
 */

export interface DefAviso {
  codigo: string;
  nombre: string;
  ayuda: string;
  /** al_ocurrir: sale en el momento del hecho; revision: lo detecta la revisión periódica del servidor. */
  cuando: 'al_ocurrir' | 'revision';
  /** A quién le llega por el hecho mismo (además de los destinatarios elegidos); nulo si no hay tal persona. */
  contextual: string | null;
  /** Si el correo lleva un botón para abrir el sistema (los correos a clientes no lo llevan). */
  interno: boolean;
  umbral: { etiqueta: string; ayuda: string } | null;
  /** Los {datos} que el texto puede usar. */
  datos: string[];
  asunto: string;
  cuerpo: string;
  ejemplo: Record<string, string>;
}

const COMUNES = ['taller'];

export const CATALOGO_AVISOS: DefAviso[] = [
  {
    codigo: 'servicio_proximo',
    nombre: 'Servicio próximo',
    ayuda: 'Un servicio programado de un equipo se está acercando (próximo o urgente).',
    cuando: 'revision',
    contextual: null,
    interno: true,
    umbral: null,
    datos: [...COMUNES, 'equipo', 'tipo_equipo', 'cliente', 'servicio', 'estado', 'detalle'],
    asunto: 'Servicio {estado}: {servicio} de {equipo}',
    cuerpo: 'Se acerca un servicio programado.\n\nEquipo: {equipo} ({tipo_equipo})\nCliente: {cliente}\nServicio: {servicio}\nSituación: {detalle}',
    ejemplo: { equipo: 'EQ-001 · P123ABC', tipo_equipo: 'CAMION', cliente: 'TRANSPORTES EJEMPLO', servicio: 'CAMBIO DE ACEITE', estado: 'PROXIMO', detalle: 'faltan 300 KM' },
  },
  {
    codigo: 'servicio_vencido',
    nombre: 'Servicio vencido',
    ayuda: 'Un servicio programado de un equipo ya se pasó.',
    cuando: 'revision',
    contextual: null,
    interno: true,
    umbral: null,
    datos: [...COMUNES, 'equipo', 'tipo_equipo', 'cliente', 'servicio', 'estado', 'detalle'],
    asunto: 'Servicio VENCIDO: {servicio} de {equipo}',
    cuerpo: 'Un servicio programado ya se pasó.\n\nEquipo: {equipo} ({tipo_equipo})\nCliente: {cliente}\nServicio: {servicio}\nSituación: {detalle}',
    ejemplo: { equipo: 'EQ-001 · P123ABC', tipo_equipo: 'CAMION', cliente: 'TRANSPORTES EJEMPLO', servicio: 'CAMBIO DE ACEITE', estado: 'VENCIDO', detalle: 'pasado por 150 KM' },
  },
  {
    codigo: 'recordatorio_cita',
    nombre: 'Recordatorio de cita',
    ayuda: 'Le recuerda al cliente su cita con la anticipación indicada. Le llega al correo del cliente.',
    cuando: 'revision',
    contextual: 'El cliente de la cita',
    interno: false,
    umbral: { etiqueta: 'Días antes de la cita', ayuda: '1 = un día antes; 0 = el mismo día.' },
    datos: [...COMUNES, 'cliente', 'equipo', 'fecha', 'hora', 'sucursal'],
    asunto: 'Recordatorio de su cita en {taller}',
    cuerpo: 'Estimado(a) {cliente}:\n\nLe recordamos su cita en {taller}.\n\nEquipo: {equipo}\nFecha: {fecha}\nHora: {hora}\nSucursal: {sucursal}\n\nSi no puede asistir, por favor avísenos con tiempo.',
    ejemplo: { cliente: 'TRANSPORTES EJEMPLO', equipo: 'EQ-001 · P123ABC', fecha: '15/11/2026', hora: '08:30', sucursal: 'CENTRAL' },
  },
  {
    codigo: 'material_pendiente_cargado',
    nombre: 'Repuesto cargado a su orden de material pendiente',
    ayuda: 'Cuando llega un repuesto de un pedido especial y se carga a la orden, le avisa al cliente. Le llega al correo del cliente.',
    cuando: 'al_ocurrir',
    contextual: 'El cliente de la orden',
    interno: false,
    umbral: null,
    datos: [...COMUNES, 'cliente', 'orden', 'materiales'],
    asunto: 'Ya llegó su repuesto: orden {orden}',
    cuerpo: 'Estimado(a) {cliente}:\n\nYa llegó el repuesto que pidió y quedó cargado a su orden {orden}:\n\n{materiales}\n\nNos pondremos en contacto con usted para continuar con el trabajo.',
    ejemplo: { cliente: 'TRANSPORTES EJEMPLO', orden: 'MPE-000012', materiales: '2 x FILTRO DE ACEITE' },
  },
  {
    codigo: 'solicitud_material_nueva',
    nombre: 'Solicitud de material nueva',
    ayuda: 'Cuando alguien pide material a bodega, le avisa a quien despacha.',
    cuando: 'al_ocurrir',
    contextual: null,
    interno: true,
    umbral: null,
    datos: [...COMUNES, 'solicitud', 'orden', 'solicitante', 'lineas', 'equipo'],
    asunto: 'Nueva solicitud de material {solicitud} (orden {orden})',
    cuerpo: 'Hay una solicitud de material por despachar.\n\nSolicitud: {solicitud}\nOrden: {orden}\nEquipo: {equipo}\nPidió: {solicitante}\nMateriales distintos: {lineas}',
    ejemplo: { solicitud: 'SOL-000003', orden: 'REP-000015', solicitante: 'JUAN PEREZ', lineas: '3', equipo: 'EQ-001 · P123ABC' },
  },
  {
    codigo: 'cotizacion_respondida',
    nombre: 'Cotización respondida',
    ayuda: 'Cuando el cliente (o quien lo atendió) responde todas las líneas de una cotización, le avisa a quien la hizo y a quienes elija.',
    cuando: 'al_ocurrir',
    contextual: 'Quien hizo la cotización',
    interno: true,
    umbral: null,
    datos: [...COMUNES, 'cotizacion', 'cliente', 'equipo', 'autorizadas', 'rechazadas'],
    asunto: 'Cotización {cotizacion} respondida',
    cuerpo: 'La cotización {cotizacion} ya fue respondida.\n\nCliente: {cliente}\nEquipo: {equipo}\nLíneas autorizadas: {autorizadas}\nLíneas rechazadas: {rechazadas}',
    ejemplo: { cotizacion: 'COT-000015', cliente: 'TRANSPORTES EJEMPLO', equipo: 'EQ-001 · P123ABC', autorizadas: '2', rechazadas: '1' },
  },
  {
    codigo: 'cotizacion_por_vencer',
    nombre: 'Cotización por vencer',
    ayuda: 'Una cotización enviada que el cliente todavía no responde está por vencer.',
    cuando: 'revision',
    contextual: 'Quien hizo la cotización',
    interno: true,
    umbral: { etiqueta: 'Días antes del vencimiento', ayuda: 'Se avisa cuando falten estos días o menos.' },
    datos: [...COMUNES, 'cotizacion', 'cliente', 'vence'],
    asunto: 'La cotización {cotizacion} vence el {vence}',
    cuerpo: 'La cotización {cotizacion} de {cliente} todavía no tiene respuesta y vence el {vence}.\n\nSi el cliente aún la quiere, conviene comunicarse con él.',
    ejemplo: { cotizacion: 'COT-000015', cliente: 'TRANSPORTES EJEMPLO', vence: '15/11/2026' },
  },
  {
    codigo: 'documento_por_vencer',
    nombre: 'Documento de equipo por vencer',
    ayuda: 'Seguro, tarjeta de circulación y otros documentos de un equipo que están por vencer. Si no indica días, se usan los de cada tipo de documento.',
    cuando: 'revision',
    contextual: null,
    interno: true,
    umbral: { etiqueta: 'Días antes del vencimiento (vacío: los de cada tipo de documento)', ayuda: 'Se avisa cuando falten estos días o menos.' },
    datos: [...COMUNES, 'equipo', 'documento', 'vence'],
    asunto: 'Documento por vencer: {documento} de {equipo}',
    cuerpo: 'Un documento de un equipo está por vencer.\n\nEquipo: {equipo}\nDocumento: {documento}\nVence: {vence}',
    ejemplo: { equipo: 'EQ-001 · P123ABC', documento: 'SEGURO', vence: '15/12/2026' },
  },
  {
    codigo: 'reserva_por_vencer',
    nombre: 'Reserva por vencer',
    ayuda: 'Una reserva de material vigente está por vencer; al vencer, las unidades vuelven a estar disponibles.',
    cuando: 'revision',
    contextual: 'Quien hizo la reserva',
    interno: true,
    umbral: { etiqueta: 'Días antes del vencimiento', ayuda: 'Se avisa cuando falten estos días o menos.' },
    datos: [...COMUNES, 'reserva', 'orden', 'vence'],
    asunto: 'La reserva {reserva} vence el {vence}',
    cuerpo: 'La reserva {reserva} (orden {orden}) vence el {vence}.\n\nSi todavía se necesita, amplíela o cárguela a la orden.',
    ejemplo: { reserva: 'RES-000004', orden: 'REP-000015', vence: '15/11/2026' },
  },
  {
    codigo: 'enlace_primera_apertura',
    nombre: 'El cliente abrió su enlace',
    ayuda: 'Cuando el cliente abre por primera vez el enlace que se le envió (no cuenta la vista previa automática de WhatsApp o del correo).',
    cuando: 'al_ocurrir',
    contextual: 'Quien creó el enlace',
    interno: true,
    umbral: null,
    datos: [...COMUNES, 'documento', 'cotizacion', 'cliente'],
    asunto: 'El cliente abrió el enlace de {documento}',
    cuerpo: '{cliente} acaba de abrir por primera vez el enlace de {documento}.',
    ejemplo: { documento: 'COT-000015', cotizacion: 'COT-000015', cliente: 'TRANSPORTES EJEMPLO' },
  },
  {
    codigo: 'cita_solicitada',
    nombre: 'Un cliente pidió una cita',
    ayuda: 'Cuando un cliente pide una cita desde el portal, avisa a quien confirma las citas. La cita queda «por confirmar» hasta que la recepción la confirme.',
    cuando: 'al_ocurrir',
    contextual: null,
    interno: true,
    umbral: null,
    datos: [...COMUNES, 'solicitante', 'equipo', 'fecha_hora', 'sucursal'],
    asunto: 'Nueva cita pedida desde el portal: {equipo}',
    cuerpo: '{solicitante} pidió una cita desde el portal.\n\nEquipo: {equipo}\nFecha y hora: {fecha_hora}\nSucursal: {sucursal}\n\nConfírmela en Citas o comuníquese con el cliente para cambiarla.',
    ejemplo: { solicitante: 'JUAN PEREZ', equipo: 'EQ-001 · P123ABC', fecha_hora: '15/11/2026, 09:30', sucursal: 'CENTRAL' },
  },
  {
    codigo: 'resumen_diario',
    nombre: 'Resumen diario del taller',
    ayuda: 'Cada mañana (a partir de las 7:00 del taller), un resumen de cómo está el taller.',
    cuando: 'revision',
    contextual: null,
    interno: true,
    umbral: null,
    datos: [...COMUNES, 'fecha', 'resumen'],
    asunto: 'Resumen de {taller} al {fecha}',
    cuerpo: 'Buenos días. Así amanece {taller} el {fecha}:\n\n{resumen}',
    ejemplo: { fecha: '15/11/2026', resumen: 'Órdenes abiertas: 12\nÓrdenes vencidas: 2' },
  },
  {
    codigo: 'resumen_semanal',
    nombre: 'Resumen semanal del taller',
    ayuda: 'Cada lunes (a partir de las 7:00 del taller), un resumen de cómo está el taller.',
    cuando: 'revision',
    contextual: null,
    interno: true,
    umbral: null,
    datos: [...COMUNES, 'fecha', 'resumen'],
    asunto: 'Resumen semanal de {taller} al {fecha}',
    cuerpo: 'Buenos días. Así empieza la semana {taller} el {fecha}:\n\n{resumen}',
    ejemplo: { fecha: '16/11/2026', resumen: 'Órdenes abiertas: 12\nÓrdenes vencidas: 2' },
  },
];

const DEF = new Map(CATALOGO_AVISOS.map((d) => [d.codigo, d]));
export const defDeAviso = (tipo: string): DefAviso => {
  const d = DEF.get(tipo);
  if (!d) throw new ErrorNoEncontrado('Ese aviso no existe');
  return d;
};

const CORREO = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;

// ── Armar el correo ───────────────────────────────────────────────────────────────────
const MARCAS = /\{([a-z_]+)\}/g;

/** Reemplaza los {datos}; uno que no se conoce se deja vacío (nunca se rompe el correo). */
function llenar(plantilla: string, datos: Record<string, string>): string {
  return plantilla.replace(MARCAS, (_m, k: string) => datos[k] ?? '');
}

function cuerpoHtml(texto: string): string {
  return texto
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => `<p>${escaparHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('\n  ');
}

/** Un texto propio solo puede usar los {datos} de ese aviso (así nadie escribe una marca que nunca se llena). */
function validarTexto(def: DefAviso, texto: string, campo: string): void {
  for (const m of texto.matchAll(MARCAS)) {
    if (!def.datos.includes(m[1] as string)) throw new ErrorValidacion(`En ${campo} no puede usar {${m[1]}}. Puede usar: ${def.datos.map((d) => `{${d}}`).join(', ')}`);
  }
}

// ── Destinatarios ─────────────────────────────────────────────────────────────────────
async function correosElegidos(t: TallerReq, tipo: string): Promise<string[]> {
  const f = await filas<{ correo: string | null }>(
    t.pool,
    `SELECT c.correo FROM avisos_destinatarios d JOIN usuario_roles ur ON ur.rol_id = d.rol_id JOIN usuarios u ON u.id = ur.usuario_id AND u.activo = 1
       JOIN colaboradores c ON c.id = u.colaborador_id AND c.activo = 1 WHERE d.tipo_aviso = ? AND d.rol_id IS NOT NULL
     UNION
     SELECT c.correo FROM avisos_destinatarios d JOIN usuarios u ON u.id = d.usuario_id AND u.activo = 1 JOIN colaboradores c ON c.id = u.colaborador_id AND c.activo = 1
      WHERE d.tipo_aviso = ? AND d.usuario_id IS NOT NULL
     UNION
     SELECT d.correo FROM avisos_destinatarios d WHERE d.tipo_aviso = ? AND d.correo IS NOT NULL`,
    [tipo, tipo, tipo]
  );
  return f.map((x) => x.correo).filter((c): c is string => !!c);
}

/** El correo de una persona del sistema (para «quien cotizó», «quien hizo la reserva»...). Nulo si no tiene o está desactivada. */
export async function correoDeUsuario(t: TallerReq, usuarioId: number | null | undefined): Promise<string | null> {
  if (!usuarioId) return null;
  const f = await una<{ correo: string | null }>(t.pool, 'SELECT c.correo FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.id = ? AND u.activo = 1 AND c.activo = 1', [usuarioId]);
  return f?.correo ?? null;
}

// ── Emitir ────────────────────────────────────────────────────────────────────────────
export interface Hecho {
  tipo: string;
  /** Identifica el hecho (la cotización 15, la cita 8 de tal fecha...): el mismo hecho nunca se avisa dos veces. Máximo 80 caracteres. */
  clave: string;
  datos: Record<string, string>;
  /** Correos de las personas del hecho (quien cotizó, el cliente...); solo cuentan si el aviso tiene encendida esa opción. */
  contextuales?: Array<string | null | undefined>;
  referencia?: string | null;
  /** Pantalla del sistema a la que lleva el botón (solo en los avisos internos). */
  ruta?: string;
}

export type ResultadoAviso = 'encolado' | 'apagado' | 'sin_destinatarios' | 'repetido' | 'error';

async function emitir(ctx: Contexto, t: TallerReq, h: Hecho): Promise<ResultadoAviso> {
  const def = defDeAviso(h.tipo);
  const cfg = await una<{ activo: number; asunto: string | null; cuerpo: string | null; incluir_contextual: number }>(t.pool, 'SELECT activo, asunto, cuerpo, incluir_contextual FROM avisos_config WHERE tipo_aviso = ?', [h.tipo]);
  if (!cfg || cfg.activo !== 1) return 'apagado';
  const clave = h.clave.slice(0, 80);
  if (await una(t.pool, 'SELECT id FROM avisos_registro WHERE tipo_aviso = ? AND clave = ?', [h.tipo, clave])) return 'repetido';

  const lista = [...(await correosElegidos(t, h.tipo)), ...(cfg.incluir_contextual === 1 ? (h.contextuales ?? []) : [])]
    .map((c) => (c ?? '').trim().toLowerCase())
    .filter((c) => CORREO.test(c));
  const destinatarios = [...new Set(lista)];

  const datos = { taller: t.empresa.nombre, ...h.datos };
  const asunto = llenar(cfg.asunto ?? def.asunto, datos).replace(/\s+/g, ' ').trim().slice(0, 200);
  if (destinatarios.length === 0) {
    await ejecutar(t.pool, "INSERT IGNORE INTO avisos_registro (tipo_aviso, clave, asunto, destinatarios, estado, referencia) VALUES (?, ?, ?, 0, 'sin_destinatarios', ?)", [h.tipo, clave, asunto, h.referencia?.slice(0, 60) ?? null]);
    return 'sin_destinatarios';
  }
  const boton = def.interno && h.ruta ? botonCorreo('Abrir en VERI-TECH', `${urlBaseDeTaller(ctx, t.empresa)}${h.ruta}`) : '';
  await encolarCorreo(ctx.pool, {
    tipo: `aviso_${h.tipo}`.slice(0, 40),
    destinatarios,
    asunto,
    cuerpoHtml: plantillaCorreo(`${cuerpoHtml(llenar(cfg.cuerpo ?? def.cuerpo, datos))}${boton}`),
    claveUnica: `t${t.empresa.id}:${h.tipo}:${clave}`.slice(0, 120),
  });
  await ejecutar(t.pool, "INSERT IGNORE INTO avisos_registro (tipo_aviso, clave, asunto, destinatarios, estado, referencia) VALUES (?, ?, ?, ?, 'encolado', ?)", [h.tipo, clave, asunto, destinatarios.length, h.referencia?.slice(0, 60) ?? null]);
  return 'encolado';
}

/** Avisa un hecho. Nunca lanza un error: un aviso que falla no debe deshacer ni frenar lo que lo causó. */
export async function emitirAviso(ctx: Contexto, t: TallerReq, h: Hecho): Promise<ResultadoAviso> {
  try {
    return await emitir(ctx, t, h);
  } catch (error) {
    console.error(`[avisos] ${h.tipo} (${h.clave}):`, error instanceof Error ? error.message : error);
    return 'error';
  }
}

// ── Los hechos que se avisan en el momento ────────────────────────────────────────────
const EQUIPO = "NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa), '')";

export async function avisarSolicitudNueva(ctx: Contexto, t: TallerReq, solicitudId: number): Promise<void> {
  try {
    const s = await una<{ numero: string; orden: string; equipo: string | null; solicitante: string | null; lineas: number }>(
      t.pool,
      `SELECT s.numero, o.numero AS orden, ${EQUIPO} AS equipo, co.nombre_completo AS solicitante, (SELECT COUNT(*) FROM solicitud_lineas l WHERE l.solicitud_id = s.id) AS lineas
         FROM solicitudes_material s JOIN ordenes o ON o.id = s.orden_id JOIN equipos e ON e.id = o.equipo_id
         LEFT JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id WHERE s.id = ?`,
      [solicitudId]
    );
    if (!s) return;
    await emitirAviso(ctx, t, { tipo: 'solicitud_material_nueva', clave: `sol:${solicitudId}`, referencia: s.numero, ruta: '/inventario?tab=solicitudes', datos: { solicitud: s.numero, orden: s.orden, equipo: s.equipo ?? '-', solicitante: s.solicitante ?? '-', lineas: String(s.lineas) } });
    await pushSolicitudNueva(ctx, t, solicitudId);
  } catch (error) {
    console.error('[avisos] solicitud nueva:', error instanceof Error ? error.message : error);
  }
}

export async function avisarCotizacionRespondida(ctx: Contexto, t: TallerReq, cotizacionId: number): Promise<void> {
  try {
    const c = await una<{ numero: string; estado: string; creada_por_id: number | null; cliente: string | null; equipo: string | null; autorizadas: number; rechazadas: number }>(
      t.pool,
      `SELECT c.numero, c.estado, c.creada_por_id, cl.nombre AS cliente, ${EQUIPO} AS equipo,
              (SELECT COUNT(*) FROM cotizacion_lineas l WHERE l.cotizacion_id = c.id AND l.estado = 'autorizada') AS autorizadas,
              (SELECT COUNT(*) FROM cotizacion_lineas l WHERE l.cotizacion_id = c.id AND l.estado = 'rechazada') AS rechazadas
         FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN equipos e ON e.id = c.equipo_id WHERE c.id = ?`,
      [cotizacionId]
    );
    if (!c || c.estado !== 'respondida') return;
    await emitirAviso(ctx, t, {
      tipo: 'cotizacion_respondida',
      clave: `cot:${cotizacionId}`,
      referencia: c.numero,
      ruta: '/cotizaciones',
      contextuales: [await correoDeUsuario(t, c.creada_por_id)],
      datos: { cotizacion: c.numero, cliente: c.cliente ?? '-', equipo: c.equipo ?? '-', autorizadas: String(c.autorizadas), rechazadas: String(c.rechazadas) },
    });
  } catch (error) {
    console.error('[avisos] cotización respondida:', error instanceof Error ? error.message : error);
  }
}

export async function avisarPrimeraAperturaDe(ctx: Contexto, t: TallerReq, d: { enlaceId: number; referencia: string; clienteId: number | null; creadoPorId: number | null }): Promise<void> {
  try {
    const cl = d.clienteId ? await una<{ nombre: string }>(t.pool, 'SELECT nombre FROM clientes WHERE id = ?', [d.clienteId]) : null;
    await emitirAviso(ctx, t, {
      tipo: 'enlace_primera_apertura',
      clave: `enlace:${d.enlaceId}`,
      referencia: d.referencia,
      ruta: '/ordenes',
      contextuales: [await correoDeUsuario(t, d.creadoPorId)],
      datos: { documento: d.referencia, cotizacion: d.referencia, cliente: cl?.nombre ?? 'EL CLIENTE' },
    });
  } catch (error) {
    console.error('[avisos] primera apertura:', error instanceof Error ? error.message : error);
  }
}

export async function avisarPrimeraApertura(ctx: Contexto, t: TallerReq, enlaceId: number, cotizacionId: number, creadoPorId: number | null): Promise<void> {
  try {
    const c = await una<{ numero: string; cliente: string | null }>(t.pool, 'SELECT c.numero, cl.nombre AS cliente FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id WHERE c.id = ?', [cotizacionId]);
    if (!c) return;
    await emitirAviso(ctx, t, {
      tipo: 'enlace_primera_apertura',
      clave: `enlace:${enlaceId}`,
      referencia: c.numero,
      ruta: '/cotizaciones',
      contextuales: [await correoDeUsuario(t, creadoPorId)],
      datos: { documento: c.numero, cotizacion: c.numero, cliente: c.cliente ?? 'EL CLIENTE' },
    });
  } catch (error) {
    console.error('[avisos] primera apertura:', error instanceof Error ? error.message : error);
  }
}

/** Después de despachar material: si la orden es de un tipo de «pedido especial» (MATERIAL PENDIENTE), el cliente se entera de que ya llegó su repuesto. */
export async function avisarMaterialCargado(ctx: Contexto, t: TallerReq, solicitudId: number): Promise<void> {
  try {
    const o = await una<{ orden: string; cliente: string | null; correo: string | null }>(
      t.pool,
      `SELECT o.numero AS orden, cl.nombre AS cliente, COALESCE(o.notificar_correo, cl.email, cl.contacto_email) AS correo FROM solicitudes_material s JOIN ordenes o ON o.id = s.orden_id JOIN tipos_orden tp ON tp.id = o.tipo_orden_id
         LEFT JOIN clientes cl ON cl.id = o.cliente_id WHERE s.id = ? AND tp.es_pedido_especial = 1`,
      [solicitudId]
    );
    if (!o) return;
    const lineas = await filas<{ nombre: string; cantidad: number }>(t.pool, 'SELECT m.nombre, l.cantidad_despachada AS cantidad FROM solicitud_lineas l JOIN materiales m ON m.id = l.material_id WHERE l.solicitud_id = ? AND l.cantidad_despachada > 0 ORDER BY m.nombre', [solicitudId]);
    if (lineas.length === 0) return;
    const total = lineas.reduce((a, l) => a + Number(l.cantidad), 0);
    await emitirAviso(ctx, t, {
      tipo: 'material_pendiente_cargado',
      clave: `desp:${solicitudId}:${total}`,
      referencia: o.orden,
      contextuales: [o.correo],
      datos: { cliente: o.cliente ?? 'CLIENTE', orden: o.orden, materiales: lineas.map((l) => `${l.cantidad} x ${l.nombre}`).join('\n') },
    });
  } catch (error) {
    console.error('[avisos] material cargado:', error instanceof Error ? error.message : error);
  }
}

// ── Configuración de cada taller ──────────────────────────────────────────────────────
export async function listarAvisos(t: TallerReq) {
  const config = await filas<{ tipo_aviso: string; activo: number; asunto: string | null; cuerpo: string | null; umbral_dias: number | null; incluir_contextual: number }>(t.pool, 'SELECT tipo_aviso, activo, asunto, cuerpo, umbral_dias, incluir_contextual FROM avisos_config');
  const destinos = await filas<{ tipo_aviso: string; rol_id: number | null; usuario_id: number | null; correo: string | null }>(t.pool, 'SELECT tipo_aviso, rol_id, usuario_id, correo FROM avisos_destinatarios ORDER BY id');
  const ultimos = await filas<{ tipo_aviso: string; ultimo: Date; total: number }>(t.pool, "SELECT tipo_aviso, MAX(created_at) AS ultimo, COUNT(*) AS total FROM avisos_registro WHERE estado = 'encolado' GROUP BY tipo_aviso");
  const roles = await filas<{ id: number; nombre: string }>(t.pool, 'SELECT id, nombre FROM roles WHERE activo = 1 ORDER BY nombre');
  const personas = await filas<{ id: number; nombre: string; correo: string | null }>(
    t.pool,
    'SELECT u.id, c.nombre_completo AS nombre, c.correo FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id WHERE u.activo = 1 AND c.activo = 1 ORDER BY c.nombre_completo'
  );
  return {
    avisos: CATALOGO_AVISOS.map((d) => {
      const c = config.find((x) => x.tipo_aviso === d.codigo);
      const mios = destinos.filter((x) => x.tipo_aviso === d.codigo);
      const u = ultimos.find((x) => x.tipo_aviso === d.codigo);
      return {
        codigo: d.codigo,
        nombre: d.nombre,
        ayuda: d.ayuda,
        cuando: d.cuando,
        contextual: d.contextual,
        umbral: d.umbral,
        datos: d.datos,
        asunto_incluido: d.asunto,
        cuerpo_incluido: d.cuerpo,
        activo: c?.activo === 1,
        asunto: c?.asunto ?? null,
        cuerpo: c?.cuerpo ?? null,
        umbral_dias: c?.umbral_dias ?? null,
        incluir_contextual: c ? c.incluir_contextual === 1 : true,
        roles: mios.filter((x) => x.rol_id).map((x) => x.rol_id as number),
        usuarios: mios.filter((x) => x.usuario_id).map((x) => x.usuario_id as number),
        correos: mios.filter((x) => x.correo).map((x) => x.correo as string),
        enviados: Number(u?.total ?? 0),
        ultimo_envio: u?.ultimo ?? null,
      };
    }),
    roles,
    personas,
  };
}

export interface DatosAviso {
  activo: boolean;
  asunto: string | null;
  cuerpo: string | null;
  umbral_dias: number | null;
  incluir_contextual: boolean;
  roles: number[];
  usuarios: number[];
  correos: string[];
}

export async function actualizarAviso(t: TallerReq, actor: Actor, tipo: string, d: DatosAviso) {
  const def = defDeAviso(tipo);
  const asunto = d.asunto?.trim() ? d.asunto.trim().slice(0, 150) : null;
  const cuerpo = d.cuerpo?.trim() ? d.cuerpo.trim().slice(0, 3000) : null;
  if (asunto) validarTexto(def, asunto, 'el asunto');
  if (cuerpo) validarTexto(def, cuerpo, 'el texto');
  if (d.umbral_dias !== null && !def.umbral) throw new ErrorValidacion('Este aviso no usa días de anticipación');
  const correos = [...new Set(d.correos.map((c) => c.trim().toLowerCase()).filter((c) => c.length > 0))];
  for (const c of correos) if (!CORREO.test(c) || c.length > 150) throw new ErrorValidacion(`«${c}» no es un correo válido`);
  const roles = [...new Set(d.roles)];
  const usuarios = [...new Set(d.usuarios)];
  if (d.activo && roles.length + usuarios.length + correos.length === 0 && !(def.contextual && d.incluir_contextual)) {
    throw new ErrorValidacion('Para encender este aviso elija a quién le llega: un rol, una persona o un correo');
  }
  await transaccion(t.pool, async (con) => {
    const antes = await una<{ activo: number }>(con, 'SELECT activo FROM avisos_config WHERE tipo_aviso = ? FOR UPDATE', [tipo]);
    if (!antes) throw new ErrorNoEncontrado('Ese aviso no existe');
    for (const id of roles) if (!(await una(con, 'SELECT id FROM roles WHERE id = ? AND activo = 1', [id]))) throw new ErrorValidacion('Alguno de los roles no existe o está desactivado');
    for (const id of usuarios) if (!(await una(con, 'SELECT id FROM usuarios WHERE id = ? AND activo = 1', [id]))) throw new ErrorValidacion('Alguna de las personas no existe o no tiene acceso');
    await ejecutar(con, 'UPDATE avisos_config SET activo = ?, asunto = ?, cuerpo = ?, umbral_dias = ?, incluir_contextual = ?, actualizado_por_id = ? WHERE tipo_aviso = ?', [d.activo ? 1 : 0, asunto, cuerpo, d.umbral_dias, d.incluir_contextual ? 1 : 0, actor.usuarioId, tipo]);
    await ejecutar(con, 'DELETE FROM avisos_destinatarios WHERE tipo_aviso = ?', [tipo]);
    for (const id of roles) await ejecutar(con, 'INSERT INTO avisos_destinatarios (tipo_aviso, rol_id) VALUES (?, ?)', [tipo, id]);
    for (const id of usuarios) await ejecutar(con, 'INSERT INTO avisos_destinatarios (tipo_aviso, usuario_id) VALUES (?, ?)', [tipo, id]);
    for (const c of correos) await ejecutar(con, 'INSERT INTO avisos_destinatarios (tipo_aviso, correo) VALUES (?, ?)', [tipo, c]);
    await bitacora(con, actor, { accion: 'aviso_configurado', entidad: 'avisos_config', entidadId: 0, antes: { activo: antes.activo === 1 }, despues: { tipo, activo: d.activo, roles, usuarios, correos: correos.length, umbral_dias: d.umbral_dias, texto_propio: !!(asunto || cuerpo) } });
  });
  return { tipo };
}

export async function registroDeAvisos(t: TallerReq, f: { tipo?: string; pagina: number; porPagina: number }) {
  const donde = f.tipo ? 'WHERE tipo_aviso = ?' : '';
  const params = f.tipo ? [f.tipo] : [];
  const total = Number((await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n FROM avisos_registro ${donde}`, params))?.n ?? 0);
  const filasR = await filas(
    t.pool,
    `SELECT id, tipo_aviso, asunto, destinatarios, estado, referencia, created_at FROM avisos_registro ${donde} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return { total, pagina: f.pagina, por_pagina: f.porPagina, filas: filasR.map((x) => ({ ...x, nombre: DEF.get(String((x as { tipo_aviso: string }).tipo_aviso))?.nombre ?? NOMBRES_EXTRA[String((x as { tipo_aviso: string }).tipo_aviso)] ?? (x as { tipo_aviso: string }).tipo_aviso })) };
}

/** Los envíos que no son avisos pero también quedan en el registro. */
const NOMBRES_EXTRA: Record<string, string> = { reporte_programado: 'Reporte programado' };

/**
 * Pone en la cola un correo del taller que no es uno de los avisos incluidos (por ejemplo un reporte programado), con su constancia y sin repetirse:
 * el mismo `clave` de un mismo `tipo` nunca sale dos veces.
 */
export async function enviarCorreoDeTaller(
  ctx: Contexto,
  t: TallerReq,
  c: { tipo: string; clave: string; destinatarios: string[]; asunto: string; cuerpoHtml: string; referencia?: string | null }
): Promise<'encolado' | 'repetido' | 'sin_destinatarios'> {
  const clave = c.clave.slice(0, 80);
  if (await una(t.pool, 'SELECT id FROM avisos_registro WHERE tipo_aviso = ? AND clave = ?', [c.tipo, clave])) return 'repetido';
  const destinatarios = [...new Set(c.destinatarios.map((x) => x.trim().toLowerCase()).filter((x) => CORREO.test(x)))];
  const asunto = c.asunto.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (destinatarios.length === 0) {
    await ejecutar(t.pool, "INSERT IGNORE INTO avisos_registro (tipo_aviso, clave, asunto, destinatarios, estado, referencia) VALUES (?, ?, ?, 0, 'sin_destinatarios', ?)", [c.tipo, clave, asunto, c.referencia?.slice(0, 60) ?? null]);
    return 'sin_destinatarios';
  }
  await encolarCorreo(ctx.pool, { tipo: c.tipo.slice(0, 40), destinatarios, asunto, cuerpoHtml: c.cuerpoHtml, claveUnica: `t${t.empresa.id}:${c.tipo}:${clave}`.slice(0, 120) });
  await ejecutar(t.pool, "INSERT IGNORE INTO avisos_registro (tipo_aviso, clave, asunto, destinatarios, estado, referencia) VALUES (?, ?, ?, ?, 'encolado', ?)", [c.tipo, clave, asunto, destinatarios.length, c.referencia?.slice(0, 60) ?? null]);
  return 'encolado';
}

/** Manda un correo de ejemplo con los textos actuales a quien lo pide (no cuenta como aviso ni se registra). */
export async function enviarPrueba(ctx: Contexto, t: TallerReq, actor: Actor, tipo: string) {
  const def = defDeAviso(tipo);
  const correo = await correoDeUsuario(t, actor.usuarioId);
  if (!correo) throw new ErrorValidacion('Su usuario no tiene un correo registrado: agréguelo en Colaboradores para recibir la prueba');
  const cfg = await una<{ asunto: string | null; cuerpo: string | null }>(t.pool, 'SELECT asunto, cuerpo FROM avisos_config WHERE tipo_aviso = ?', [tipo]);
  const datos = { taller: t.empresa.nombre, ...def.ejemplo };
  const boton = def.interno ? botonCorreo('Abrir en VERI-TECH', urlBaseDeTaller(ctx, t.empresa)) : '';
  await encolarCorreo(ctx.pool, {
    tipo: 'aviso_prueba',
    destinatarios: [correo],
    asunto: `PRUEBA: ${llenar(cfg?.asunto ?? def.asunto, datos)}`.replace(/\s+/g, ' ').slice(0, 200),
    cuerpoHtml: plantillaCorreo(`<p><strong>Este es un correo de prueba con datos de ejemplo.</strong></p>${cuerpoHtml(llenar(cfg?.cuerpo ?? def.cuerpo, datos))}${boton}`),
    claveUnica: `t${t.empresa.id}:prueba:${tipo}:${ahoraDe(ctx).getTime()}:${actor.usuarioId}`.slice(0, 120),
  });
  return { enviado_a: correo };
}
