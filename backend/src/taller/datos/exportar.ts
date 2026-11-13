import fs from 'node:fs';
import { Response } from 'express';
import archiver from 'archiver';
import { FieldPacket, RowDataPacket } from 'mysql2/promise';
import { filas, una } from '../../db/consulta';
import { Contexto } from '../../plataforma/contexto';
import { abrirArchivo } from '../archivos';
import { Actor, bitacora, TallerReq } from '../comun';
import { aBuffer, anchoDeColumna, estiloEncabezado, ExcelJS } from './libro';

/**
 * Descarga de los datos del taller (libro de Excel con una hoja por tema y un .zip con las fotos y documentos).
 * Es lo que se lleva el taller cuando termina su servicio: por eso NUNCA incluye contraseñas, sesiones ni enlaces de
 * recuperación, y por eso cada fase nueva debe agregar aquí sus tablas.
 */

const SI_NO = (c: string): string => `IF(${c} = 1, 'SI', 'NO')`;
const FECHA = (c: string): string => `DATE_FORMAT(${c}, '%d/%m/%Y')`;
const FECHA_HORA = (c: string): string => `DATE_FORMAT(${c}, '%d/%m/%Y %H:%i')`;
const EQUIPO_REF = `COALESCE(NULLIF(CONCAT_WS(' · ', e.codigo_interno, e.placa, e.serie), ''), CONCAT('EQUIPO ', e.id))`;

/**
 * Tablas del taller que NO salen en la descarga, cada una con su motivo. Toda tabla nueva debe aparecer en una hoja o aquí:
 * la prueba `datos-cobertura` falla si se olvida una.
 */
export const TABLAS_NO_EXPORTADAS: Record<string, string> = {
  usuarios: 'Guarda las contraseñas de las personas; ellas salen en la hoja «Colaboradores» sin ninguna clave.',
  sesiones: 'Sesiones abiertas: son llaves de acceso y no tienen valor fuera del sistema.',
  tokens_recuperacion: 'Enlaces de recuperación de contraseña: son secretos de un solo uso.',
  permisos: 'Lista fija de permisos que trae cada versión del sistema; no es información del taller.',
  migraciones_aplicadas: 'Control interno de las versiones de la base de datos.',
  secuencias: 'Contadores internos de numeración; el sistema nuevo los recalcula.',
  vistas_guardadas: 'Preferencias personales de cada usuario (cómo le gusta ver cada reporte); no es información del taller.',
  portal_codigos: 'Códigos de entrada al portal: son secretos de un solo uso.',
  portal_sesiones: 'Sesiones abiertas del portal: son llaves de acceso y no tienen valor fuera del sistema.',
  avisos_registro: 'Constancia técnica de los avisos ya enviados (evita avisar dos veces lo mismo); no es información del taller.',
  bitacora: 'PENDIENTE: puede ser enorme y no cabe en un libro de Excel; se descargará aparte en CSV.',
};

export interface HojaExportada {
  nombre: string;
  /** Una consulta cuyos nombres de columna (alias) son los encabezados que verá la persona. */
  sql: string;
}

/** Tablas de catálogo que se descargan tal cual (con sus números, para poder cruzarlas con las demás hojas). */
const CATALOGOS: Array<[string, string]> = [
  ['sucursales', 'Sucursales'],
  ['areas_trabajo', 'Areas de trabajo'],
  ['bodegas', 'Bodegas'],
  ['puestos', 'Puestos'],
  ['niveles_tecnico', 'Niveles de tecnico'],
  ['jornadas', 'Jornadas'],
  ['ausencias', 'Ausencias'],
  ['tipos_cliente', 'Tipos de cliente'],
  ['tipos_equipo', 'Tipos de equipo'],
  ['marcas', 'Marcas'],
  ['tipos_contador', 'Tipos de contador'],
  ['tipos_documento', 'Tipos de documento'],
  ['sistemas', 'Sistemas'],
  ['subsistemas', 'Subsistemas'],
  ['partes', 'Partes'],
  ['acciones', 'Acciones'],
  ['trabajos', 'Trabajos'],
  ['trabajo_horas_tipo_equipo', 'Horas por tipo de equipo'],
  ['unidades', 'Unidades'],
  ['tipos_orden', 'Tipos de orden'],
  ['estados_orden', 'Estados de orden'],
  ['etapas', 'Etapas'],
  ['motivos', 'Motivos'],
  ['configuracion', 'Configuracion'],
  ['tipos_credencial', 'Tipos de credencial'],
  ['puesto_credenciales', 'Credenciales por puesto'],
  ['colaborador_puestos', 'Puestos de colaboradores'],
  ['colaborador_credenciales', 'Credenciales de colaboradores'],
  ['matriz_tecnico_sistema', 'Nivel tecnico por sistema'],
  ['tipo_equipo_documentos', 'Documentos por tipo de equipo'],
  ['tipo_equipo_componentes', 'Componentes por tipo de equipo'],
  ['contacto_equipos', 'Contactos por equipo'],
  ['checklist_tipos', 'Tipos de checklist'],
  ['checklist_tipo_tipos_equipo', 'Checklist por tipo de equipo'],
  ['checklists_requeridos', 'Checklists requeridos'],
  ['avisos_servicio', 'Avisos de servicios'],
  ['margenes', 'Margenes de materiales'],
];

/** Las hojas del libro. Las primeras son las que el taller reconoce de inmediato; luego van los catálogos. */
export function hojasDeExportacion(): HojaExportada[] {
  const principales: HojaExportada[] = [
    {
      nombre: 'Clientes',
      sql: `SELECT c.id AS "Número", c.nombre AS "Nombre", c.nit AS "NIT", tc.nombre AS "Tipo de cliente", c.telefono AS "Teléfono", c.email AS "Correo", c.direccion AS "Dirección",
              c.contacto_nombre AS "Contacto", c.contacto_telefono AS "Teléfono del contacto", c.contacto_email AS "Correo del contacto", UPPER(c.condicion_pago) AS "Condición de pago",
              c.dias_credito AS "Días de crédito", c.limite_credito AS "Límite de crédito", c.notas AS "Notas", ${SI_NO('c.activo')} AS "Activo", ${FECHA_HORA('c.created_at')} AS "Creado (UTC)"
            FROM clientes c LEFT JOIN tipos_cliente tc ON tc.id = c.tipo_cliente_id ORDER BY c.nombre, c.id`,
    },
    {
      nombre: 'Departamentos de clientes',
      sql: `SELECT d.id AS "Número", c.nombre AS "Cliente", d.nombre AS "Departamento", ${SI_NO('d.activo')} AS "Activo"
            FROM departamentos d JOIN clientes c ON c.id = d.cliente_id ORDER BY c.nombre, d.nombre`,
    },
    {
      nombre: 'Contactos de clientes',
      sql: `SELECT k.id AS "Número", c.nombre AS "Cliente", k.nombre AS "Nombre", k.correo AS "Correo", k.telefono AS "Teléfono", UPPER(k.rol) AS "Rol",
              ${SI_NO('k.acceso_todos_equipos')} AS "Ve todos los equipos", ${SI_NO('k.activo')} AS "Activo"
            FROM contactos_cliente k JOIN clientes c ON c.id = k.cliente_id ORDER BY c.nombre, k.nombre`,
    },
    {
      nombre: 'Proveedores',
      sql: `SELECT p.id AS "Número", p.nombre AS "Nombre", p.nit AS "NIT", p.contacto_nombre AS "Contacto", p.contacto_telefono AS "Teléfono del contacto", p.contacto_email AS "Correo del contacto",
              p.direccion AS "Dirección", UPPER(p.condicion_pago) AS "Condición de pago", p.dias_credito AS "Días de crédito", p.notas AS "Notas", ${SI_NO('p.activo')} AS "Activo"
            FROM proveedores p ORDER BY p.nombre`,
    },
    {
      nombre: 'Equipos',
      sql: `SELECT e.id AS "Número", IFNULL(c.nombre, 'DEL TALLER') AS "Cliente", te.nombre AS "Tipo de equipo", e.codigo_interno AS "Código interno", e.placa AS "Placa", e.serie AS "Serie",
              m.nombre AS "Marca", e.modelo AS "Modelo", e.anio AS "Año", e.color AS "Color", e.motor_marca AS "Marca del motor", e.motor_modelo AS "Modelo del motor", e.motor_serie AS "Serie del motor",
              e.combustible AS "Combustible", e.capacidad_tanque AS "Capacidad del tanque", d.nombre AS "Departamento", UPPER(e.propiedad) AS "Propiedad",
              REPLACE(UPPER(e.estado), '_', ' ') AS "Estado", e.notas AS "Notas", ${FECHA_HORA('e.created_at')} AS "Creado (UTC)"
            FROM equipos e JOIN tipos_equipo te ON te.id = e.tipo_equipo_id LEFT JOIN marcas m ON m.id = e.marca_id LEFT JOIN clientes c ON c.id = e.cliente_id
              LEFT JOIN departamentos d ON d.id = e.departamento_id ORDER BY c.nombre, e.id`,
    },
    {
      nombre: 'Componentes de equipos',
      sql: `SELECT k.id AS "Número", ${EQUIPO_REF} AS "Equipo", k.nombre AS "Componente", ${SI_NO('k.activo')} AS "Activo"
            FROM componentes k JOIN equipos e ON e.id = k.equipo_id ORDER BY e.id, k.id`,
    },
    {
      nombre: 'Contadores',
      sql: `SELECT ct.id AS "Número", ${EQUIPO_REF} AS "Equipo", k.nombre AS "Componente", tc.nombre AS "Tipo de contador", ct.nombre AS "Contador",
              ct.valor_inicial AS "Valor inicial", ct.valor_actual AS "Valor actual", ${FECHA('ct.fecha_inicio')} AS "Desde", ${FECHA('ct.ultima_lectura_en')} AS "Última lectura",
              ${SI_NO('ct.es_principal')} AS "Principal", ${SI_NO('ct.activo')} AS "Activo"
            FROM contadores ct JOIN equipos e ON e.id = ct.equipo_id JOIN tipos_contador tc ON tc.id = ct.tipo_contador_id LEFT JOIN componentes k ON k.id = ct.componente_id
            ORDER BY e.id, ct.id`,
    },
    {
      nombre: 'Lecturas de contadores',
      sql: `SELECT l.id AS "Número", ${EQUIPO_REF} AS "Equipo", ct.nombre AS "Contador", l.valor AS "Lectura", ${FECHA('l.fecha')} AS "Fecha", UPPER(l.origen) AS "Origen",
              REPLACE(UPPER(l.estado), '_', ' ') AS "Estado", co.nombre_completo AS "Registrada por", l.notas AS "Notas", ${FECHA_HORA('l.anulada_en')} AS "Anulada el (UTC)",
              l.motivo_anulacion AS "Motivo de la anulación"
            FROM lecturas_contador l JOIN contadores ct ON ct.id = l.contador_id JOIN equipos e ON e.id = ct.equipo_id
              LEFT JOIN usuarios u ON u.id = l.registrado_por LEFT JOIN colaboradores co ON co.id = u.colaborador_id
            ORDER BY e.id, ct.id, l.fecha, l.id`,
    },
    {
      nombre: 'Documentos de equipos',
      sql: `SELECT ed.id AS "Número", ${EQUIPO_REF} AS "Equipo", td.nombre AS "Tipo de documento", ed.nombre AS "Nombre", ${FECHA('ed.vence')} AS "Vence",
              IF(a.id IS NULL, NULL, CONCAT(a.id, '_', a.nombre_original)) AS "Archivo (en el .zip)", ${SI_NO('ed.activo')} AS "Vigente en el sistema"
            FROM equipo_documentos ed JOIN equipos e ON e.id = ed.equipo_id JOIN tipos_documento td ON td.id = ed.tipo_documento_id LEFT JOIN archivos a ON a.id = ed.archivo_id
            ORDER BY e.id, ed.id`,
    },
    {
      nombre: 'Fotos de equipos',
      sql: `SELECT f.id AS "Número", ${EQUIPO_REF} AS "Equipo", f.descripcion AS "Descripción", ${SI_NO('f.es_principal')} AS "Principal", CONCAT(a.id, '_', a.nombre_original) AS "Archivo (en el .zip)"
            FROM equipo_fotos f JOIN equipos e ON e.id = f.equipo_id JOIN archivos a ON a.id = f.archivo_id ORDER BY e.id, f.id`,
    },
    {
      nombre: 'Notas de equipos',
      sql: `SELECT n.id AS "Número", ${EQUIPO_REF} AS "Equipo", n.nota AS "Nota", ${SI_NO('n.es_importante')} AS "Importante", co.nombre_completo AS "Escrita por", ${FECHA_HORA('n.created_at')} AS "Fecha (UTC)"
            FROM equipo_notas n JOIN equipos e ON e.id = n.equipo_id LEFT JOIN usuarios u ON u.id = n.creado_por LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY e.id, n.id`,
    },
    {
      nombre: 'Operadores de equipos',
      sql: `SELECT ao.id AS "Número", ${EQUIPO_REF} AS "Equipo", co.nombre_completo AS "Operador", ${FECHA('ao.desde')} AS "Desde", ${FECHA('ao.hasta')} AS "Hasta", ${SI_NO('ao.activo')} AS "Activo"
            FROM asignaciones_operador ao JOIN equipos e ON e.id = ao.equipo_id JOIN colaboradores co ON co.id = ao.colaborador_id ORDER BY e.id, ao.id`,
    },
    {
      // Sin contraseñas, sesiones ni intentos de ingreso: solo quién es y qué rol tiene.
      nombre: 'Colaboradores',
      sql: `SELECT co.id AS "Número", co.codigo AS "Código", co.nombre_completo AS "Nombre", co.correo AS "Correo", co.celular AS "Celular", co.direccion AS "Dirección", co.dpi AS "DPI",
              s.nombre AS "Sucursal", ar.nombre AS "Área de trabajo", nt.nombre AS "Nivel técnico", ${SI_NO('co.activo')} AS "Activo", IF(u.id IS NULL, 'NO', 'SI') AS "Tiene acceso al sistema",
              (SELECT GROUP_CONCAT(r.nombre ORDER BY r.nombre SEPARATOR ', ') FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id WHERE ur.usuario_id = u.id) AS "Roles"
            FROM colaboradores co LEFT JOIN usuarios u ON u.colaborador_id = co.id LEFT JOIN sucursales s ON s.id = co.sucursal_id LEFT JOIN areas_trabajo ar ON ar.id = co.area_trabajo_id
              LEFT JOIN niveles_tecnico nt ON nt.id = co.nivel_tecnico_id ORDER BY co.nombre_completo`,
    },
    {
      nombre: 'Ordenes de trabajo',
      sql: `SELECT o.numero AS "Número", tor.nombre AS "Tipo de orden", es.nombre AS "Estado", UPPER(o.prioridad) AS "Prioridad", c.nombre AS "Cliente", ${EQUIPO_REF} AS "Equipo", s.nombre AS "Sucursal",
              ar.nombre AS "Área principal", co.nombre_completo AS "Responsable", o.descripcion AS "Descripción", ${FECHA_HORA('o.created_at')} AS "Creada (UTC)", ${FECHA('o.fecha_estimada_entrega')} AS "Entrega estimada",
              ${FECHA_HORA('o.fecha_cierre')} AS "Cerrada (UTC)", o.referencia_factura_externa AS "Factura en el sistema de caja", mo.nombre AS "Motivo de anulación", o.motivo_anulacion_texto AS "Detalle de la anulación",
              o.notificar_nombre AS "Avisar a", o.notificar_correo AS "Correo para avisar", o.notificar_telefono AS "Teléfono para avisar",
              o.subtotal AS "Subtotal", o.descuento_total AS "Descuento", o.iva AS "IVA", o.total AS "Total"
            FROM ordenes o JOIN tipos_orden tor ON tor.id = o.tipo_orden_id JOIN estados_orden es ON es.id = o.estado_id JOIN equipos e ON e.id = o.equipo_id JOIN sucursales s ON s.id = o.sucursal_id
              LEFT JOIN clientes c ON c.id = o.cliente_id LEFT JOIN areas_trabajo ar ON ar.id = o.area_trabajo_id LEFT JOIN colaboradores co ON co.id = o.responsable_id LEFT JOIN motivos mo ON mo.id = o.motivo_anulacion_id
            ORDER BY o.id`,
    },
    {
      nombre: 'Lineas de ordenes',
      sql: `SELECT l.id AS "Número", o.numero AS "Orden", UPPER(l.tipo) AS "Tipo", tr.codigo AS "Código del trabajo", l.descripcion AS "Descripción", p.nombre AS "Proveedor", l.cantidad AS "Cantidad",
              l.precio_unitario AS "Precio unitario", l.descuento_pct AS "Descuento %", l.total_linea AS "Total de la línea", l.costo AS "Costo (interno)", l.horas_trabajo AS "Horas de trabajo",
              l.tarifa_hora_aplicada AS "Tarifa por hora aplicada", l.costo_hora_aplicado AS "Costo por hora aplicado", ar.nombre AS "Área", co.nombre_completo AS "Técnico",
              REPLACE(UPPER(l.estado), '_', ' ') AS "Estado", ${FECHA_HORA('l.inicio_en')} AS "Inició (UTC)", ${FECHA_HORA('l.fin_en')} AS "Terminó (UTC)", l.notas AS "Notas",
              ${FECHA_HORA('l.anulada_en')} AS "Anulada el (UTC)", l.motivo_anulacion AS "Motivo de la anulación"
            FROM lineas_orden l JOIN ordenes o ON o.id = l.orden_id LEFT JOIN trabajos tr ON tr.id = l.trabajo_id LEFT JOIN proveedores p ON p.id = l.proveedor_id
              LEFT JOIN areas_trabajo ar ON ar.id = l.area_trabajo_id LEFT JOIN colaboradores co ON co.id = l.tecnico_id ORDER BY o.id, l.id`,
    },
    {
      nombre: 'Historial de estados',
      sql: `SELECT h.id AS "Número", o.numero AS "Orden", es.nombre AS "Estado", ${FECHA_HORA('h.desde')} AS "Desde (UTC)", co.nombre_completo AS "Quién lo cambió", h.motivo AS "Motivo"
            FROM orden_estados_historial h JOIN ordenes o ON o.id = h.orden_id JOIN estados_orden es ON es.id = h.estado_id LEFT JOIN usuarios u ON u.id = h.usuario_id
              LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY o.id, h.id`,
    },
    {
      nombre: 'Ingresos de equipos',
      sql: `SELECT i.id AS "Número", o.numero AS "Orden", ${EQUIPO_REF} AS "Equipo", ${FECHA_HORA('i.entrada_en')} AS "Entró (UTC)", ${FECHA_HORA('i.salida_en')} AS "Salió (UTC)", co.nombre_completo AS "Lo recibió"
            FROM ingresos_equipo i JOIN ordenes o ON o.id = i.orden_id JOIN equipos e ON e.id = i.equipo_id LEFT JOIN usuarios u ON u.id = i.recibido_por_id
              LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY o.id, i.id`,
    },
    {
      nombre: 'Tarifas por area',
      sql: `SELECT ar.nombre AS "Área", te.nombre AS "Tipo de equipo", ta.tarifa_venta_hora AS "Tarifa de venta por hora", ta.costo_hora AS "Costo por hora (interno)"
            FROM tarifas_area ta JOIN areas_trabajo ar ON ar.id = ta.area_trabajo_id JOIN tipos_equipo te ON te.id = ta.tipo_equipo_id ORDER BY ar.nombre, te.nombre`,
    },
    {
      nombre: 'Citas',
      sql: `SELECT c.id AS "Número", ${EQUIPO_REF} AS "Equipo", cl.nombre AS "Cliente", s.nombre AS "Sucursal", ${FECHA_HORA('c.fecha_hora')} AS "Fecha y hora (UTC)", c.horas_estimadas AS "Horas estimadas",
              REPLACE(UPPER(c.estado), '_', ' ') AS "Estado", UPPER(c.origen) AS "Origen", ${FECHA_HORA('c.llegada_en')} AS "Llegó (UTC)", mo.nombre AS "Motivo de cancelación", c.motivo_cancelacion_texto AS "Detalle de la cancelación",
              c.lectura_contador AS "Lectura dicha por el cliente", c.notas AS "Notas", (SELECT o.numero FROM ordenes o WHERE o.cita_id = c.id LIMIT 1) AS "Orden"
            FROM citas c JOIN equipos e ON e.id = c.equipo_id JOIN sucursales s ON s.id = c.sucursal_id LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN motivos mo ON mo.id = c.motivo_cancelacion_id ORDER BY c.fecha_hora, c.id`,
    },
    {
      nombre: 'Tiempos de trabajo',
      sql: `SELECT r.id AS "Número", o.numero AS "Orden", l.descripcion AS "Trabajo", co.nombre_completo AS "Técnico", ${FECHA_HORA('r.inicio')} AS "Inició (UTC)", ${FECHA_HORA('r.fin')} AS "Terminó (UTC)",
              ROUND(TIMESTAMPDIFF(SECOND, r.inicio, COALESCE(r.fin, UTC_TIMESTAMP())) / 3600, 2) AS "Horas"
            FROM registros_tiempo r JOIN lineas_orden l ON l.id = r.linea_id JOIN ordenes o ON o.id = l.orden_id JOIN colaboradores co ON co.id = r.colaborador_id ORDER BY o.id, r.id`,
    },
    {
      nombre: 'Fotos de trabajos',
      sql: `SELECT f.id AS "Número", o.numero AS "Orden", l.descripcion AS "Trabajo", UPPER(f.tipo) AS "Momento", f.descripcion AS "Descripción", CONCAT(a.id, '_', a.nombre_original) AS "Archivo (en el .zip)",
              ${FECHA_HORA('f.created_at')} AS "Subida el (UTC)"
            FROM linea_fotos f JOIN lineas_orden l ON l.id = f.linea_id JOIN ordenes o ON o.id = l.orden_id JOIN archivos a ON a.id = f.archivo_id ORDER BY o.id, f.id`,
    },
    {
      nombre: 'Plantillas de checklist',
      sql: `SELECT ct.nombre AS "Checklist", p.version AS "Versión", ${SI_NO('p.vigente')} AS "Vigente", s.nombre AS "Sección", s.orden AS "Orden de la sección", i.orden AS "Orden del ítem",
              i.descripcion AS "Ítem", UPPER(REPLACE(i.tipo_respuesta, '_', ' ')) AS "Tipo de respuesta", i.minimo AS "Mínimo", i.maximo AS "Máximo",
              (SELECT GROUP_CONCAT(o.texto ORDER BY o.orden SEPARATOR ' | ') FROM checklist_item_opciones o WHERE o.item_id = i.id) AS "Opciones"
            FROM checklist_items i JOIN checklist_plantillas p ON p.id = i.plantilla_id JOIN checklist_tipos ct ON ct.id = p.checklist_tipo_id JOIN checklist_secciones s ON s.id = i.seccion_id
            ORDER BY ct.nombre, p.version, s.orden, i.orden`,
    },
    {
      nombre: 'Checklists',
      sql: `SELECT c.id AS "Número", ct.nombre AS "Checklist", p.version AS "Versión de la plantilla", o.numero AS "Orden", ${EQUIPO_REF} AS "Equipo", REPLACE(UPPER(c.estado), '_', ' ') AS "Estado",
              ${FECHA_HORA('c.created_at')} AS "Abierto (UTC)", ${FECHA_HORA('c.completado_en')} AS "Completado (UTC)", co.nombre_completo AS "Completado por", mo.nombre AS "Excepción autorizada"
            FROM checklists c JOIN checklist_tipos ct ON ct.id = c.tipo_id JOIN checklist_plantillas p ON p.id = c.plantilla_id JOIN equipos e ON e.id = c.equipo_id LEFT JOIN ordenes o ON o.id = c.orden_id
              LEFT JOIN usuarios u ON u.id = c.completado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id LEFT JOIN motivos mo ON mo.id = c.excepcion_motivo_id ORDER BY c.id`,
    },
    {
      nombre: 'Respuestas de checklists',
      sql: `SELECT r.id AS "Número", c.id AS "Checklist", ct.nombre AS "Tipo", r.seccion AS "Sección", r.descripcion AS "Ítem", UPPER(r.semaforo) AS "Semáforo", IF(r.si_no IS NULL, NULL, IF(r.si_no = 1, 'SI', 'NO')) AS "Sí / No",
              r.valor_numero AS "Valor numérico", r.valor_texto AS "Texto", r.opcion_texto AS "Opción", r.nota AS "Nota", (SELECT COUNT(*) FROM checklist_fotos f WHERE f.respuesta_id = r.id) AS "Fotos",
              co.nombre_completo AS "Respondió", ${FECHA_HORA('r.respondido_en')} AS "Respondido (UTC)"
            FROM checklist_respuestas r JOIN checklists c ON c.id = r.checklist_id JOIN checklist_tipos ct ON ct.id = c.tipo_id LEFT JOIN usuarios u ON u.id = r.respondido_por_id
              LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY c.id, r.orden`,
    },
    {
      nombre: 'Fotos de checklists',
      sql: `SELECT f.id AS "Número", r.checklist_id AS "Checklist", r.descripcion AS "Ítem", CONCAT(a.id, '_', a.nombre_original) AS "Archivo (en el .zip)"
            FROM checklist_fotos f JOIN checklist_respuestas r ON r.id = f.respuesta_id JOIN archivos a ON a.id = f.archivo_id ORDER BY r.checklist_id, f.id`,
    },
    {
      nombre: 'Firmas de checklists',
      sql: `SELECT f.id AS "Número", f.checklist_id AS "Checklist", f.firmante_nombre AS "Firmó", ${FECHA_HORA('f.firmado_en')} AS "Firmado (UTC)", CONCAT(a.id, '_', a.nombre_original) AS "Archivo (en el .zip)"
            FROM firmas f JOIN archivos a ON a.id = f.archivo_id ORDER BY f.id`,
    },
    {
      nombre: 'Servicios programados',
      sql: `SELECT sp.id AS "Número", te.nombre AS "Tipo de equipo", sp.nombre AS "Servicio", tr.codigo AS "Código del trabajo", UPPER(REPLACE(sp.tipo, '_', ' ')) AS "Tipo", tc.nombre AS "Contador",
              sp.intervalo AS "Cada", sp.aviso_proximo AS "Aviso próximo faltando", sp.aviso_urgente AS "Aviso urgente faltando", ct.nombre AS "Checklist", ${SI_NO('sp.activo')} AS "Activo"
            FROM servicios_programados sp JOIN tipos_equipo te ON te.id = sp.tipo_equipo_id JOIN trabajos tr ON tr.id = sp.trabajo_id JOIN tipos_contador tc ON tc.id = sp.tipo_contador_id
              LEFT JOIN checklist_tipos ct ON ct.id = sp.checklist_tipo_id ORDER BY te.nombre, sp.nombre`,
    },
    {
      nombre: 'Servicios realizados',
      sql: `SELECT r.id AS "Número", ${EQUIPO_REF} AS "Equipo", sp.nombre AS "Servicio", ${FECHA('r.fecha')} AS "Fecha", r.contador_valor AS "Contador", UPPER(r.origen) AS "Cómo se registró", r.motivo AS "Motivo",
              o.numero AS "Orden", co.nombre_completo AS "Registró", ${FECHA_HORA('r.anulado_en')} AS "Anulado el (UTC)", r.motivo_anulacion AS "Motivo de la anulación"
            FROM servicios_realizados r JOIN equipos e ON e.id = r.equipo_id JOIN servicios_programados sp ON sp.id = r.servicio_id LEFT JOIN ordenes o ON o.id = r.orden_id
              LEFT JOIN usuarios u ON u.id = r.registrado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY r.equipo_id, r.fecha, r.id`,
    },
    {
      nombre: 'Materiales',
      sql: `SELECT m.id AS "Número", m.codigo AS "Código", m.nombre AS "Nombre", CONCAT(s.codigo, '-', x.codigo, '-', p.codigo, ' ', p.nombre) AS "Clasificación", mr.nombre AS "Marca", m.codigo_oem AS "Código del fabricante",
              u.nombre AS "Unidad", m.existencia_minima AS "Existencia mínima", m.ubicacion AS "Ubicación", COALESCE((SELECT SUM(e.cantidad) FROM existencias e WHERE e.material_id = m.id), 0) AS "Existencia total",
              m.costo_ultimo AS "Último costo (interno)", m.costo_promedio AS "Costo promedio (interno)", m.precio_manual AS "Precio fijo", pv.nombre AS "Proveedor principal", ${SI_NO('m.activo')} AS "Activo"
            FROM materiales m JOIN partes p ON p.id = m.parte_id JOIN subsistemas x ON x.id = p.subsistema_id JOIN sistemas s ON s.id = x.sistema_id JOIN unidades u ON u.id = m.unidad_id
              LEFT JOIN marcas mr ON mr.id = m.marca_id LEFT JOIN proveedores pv ON pv.id = m.proveedor_principal_id ORDER BY m.codigo`,
    },
    {
      nombre: 'Existencias',
      sql: `SELECT m.codigo AS "Código", m.nombre AS "Material", b.nombre AS "Bodega", sc.nombre AS "Sucursal", e.cantidad AS "Cantidad"
            FROM existencias e JOIN materiales m ON m.id = e.material_id JOIN bodegas b ON b.id = e.bodega_id JOIN sucursales sc ON sc.id = b.sucursal_id ORDER BY m.codigo, b.nombre`,
    },
    {
      nombre: 'Movimientos de inventario',
      sql: `SELECT mv.id AS "Número", ${FECHA_HORA('mv.fecha')} AS "Fecha (UTC)", m.codigo AS "Código", m.nombre AS "Material", b.nombre AS "Bodega", UPPER(REPLACE(mv.tipo, '_', ' ')) AS "Tipo", mv.cantidad AS "Cantidad",
              mv.saldo_resultante AS "Saldo de la bodega", mv.costo_unitario AS "Costo unitario (interno)", mv.referencia_tipo AS "Documento", mv.referencia_id AS "Número del documento", mo.nombre AS "Motivo",
              mv.notas AS "Notas", co.nombre_completo AS "Usuario"
            FROM movimientos_inventario mv JOIN materiales m ON m.id = mv.material_id JOIN bodegas b ON b.id = mv.bodega_id LEFT JOIN motivos mo ON mo.id = mv.motivo_id
              LEFT JOIN usuarios u ON u.id = mv.usuario_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY mv.id`,
    },
    {
      nombre: 'Compras',
      sql: `SELECT c.id AS "Número", c.numero AS "Compra", p.nombre AS "Proveedor", b.nombre AS "Bodega", ${FECHA('c.fecha_documento')} AS "Fecha del documento", c.numero_factura AS "Factura", c.total AS "Total",
              c.notas AS "Notas", co.nombre_completo AS "Registró"
            FROM compras c JOIN proveedores p ON p.id = c.proveedor_id JOIN bodegas b ON b.id = c.bodega_id LEFT JOIN usuarios u ON u.id = c.creada_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY c.id`,
    },
    {
      nombre: 'Lineas de compras',
      sql: `SELECT l.id AS "Número", c.numero AS "Compra", m.codigo AS "Código", m.nombre AS "Material", l.cantidad AS "Cantidad", l.costo_unitario AS "Costo unitario", (l.cantidad * l.costo_unitario) AS "Subtotal"
            FROM compra_lineas l JOIN compras c ON c.id = l.compra_id JOIN materiales m ON m.id = l.material_id ORDER BY c.id, l.id`,
    },
    {
      nombre: 'Solicitudes de material',
      sql: `SELECT s.id AS "Número", s.numero AS "Solicitud", o.numero AS "Orden", UPPER(REPLACE(s.estado, '_', ' ')) AS "Estado", ${FECHA_HORA('s.solicitada_en')} AS "Solicitada (UTC)", ${FECHA_HORA('s.primer_despacho_en')} AS "Primer despacho (UTC)",
              ${FECHA_HORA('s.despachada_en')} AS "Completada (UTC)", co.nombre_completo AS "Solicitó", s.notas AS "Notas", ${FECHA_HORA('s.anulada_en')} AS "Anulada (UTC)", s.motivo_anulacion AS "Motivo de anulación"
            FROM solicitudes_material s JOIN ordenes o ON o.id = s.orden_id LEFT JOIN usuarios u ON u.id = s.solicitante_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY s.id`,
    },
    {
      nombre: 'Lineas de solicitudes',
      sql: `SELECT l.id AS "Número", s.numero AS "Solicitud", m.codigo AS "Código", m.nombre AS "Material", l.cantidad_solicitada AS "Cantidad pedida", l.cantidad_despachada AS "Cantidad despachada"
            FROM solicitud_lineas l JOIN solicitudes_material s ON s.id = l.solicitud_id JOIN materiales m ON m.id = l.material_id ORDER BY s.id, l.id`,
    },
    {
      nombre: 'Despachos de material',
      sql: `SELECT d.id AS "Número", s.numero AS "Solicitud", m.codigo AS "Código", m.nombre AS "Material", b.nombre AS "Bodega", d.cantidad AS "Cantidad", d.costo_unitario AS "Costo unitario (interno)",
              ${FECHA_HORA('d.fecha')} AS "Fecha (UTC)", co.nombre_completo AS "Despachó"
            FROM despachos_material d JOIN solicitud_lineas l ON l.id = d.solicitud_linea_id JOIN solicitudes_material s ON s.id = l.solicitud_id JOIN materiales m ON m.id = l.material_id
              JOIN bodegas b ON b.id = d.bodega_id LEFT JOIN usuarios u ON u.id = d.despachado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY d.id`,
    },
    {
      nombre: 'Devoluciones de material',
      sql: `SELECT d.id AS "Número", d.numero AS "Devolución", s.numero AS "Solicitud", m.codigo AS "Código", m.nombre AS "Material", b.nombre AS "Bodega", d.cantidad AS "Cantidad", d.costo_unitario AS "Costo unitario (interno)",
              d.motivo AS "Motivo", ${FECHA_HORA('d.fecha')} AS "Fecha (UTC)", co.nombre_completo AS "Registró"
            FROM devoluciones_material d JOIN solicitud_lineas l ON l.id = d.solicitud_linea_id JOIN solicitudes_material s ON s.id = l.solicitud_id JOIN materiales m ON m.id = l.material_id
              JOIN bodegas b ON b.id = d.bodega_id LEFT JOIN usuarios u ON u.id = d.registrada_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY d.id`,
    },
    {
      nombre: 'Reservas de material',
      sql: `SELECT r.id AS "Número", r.numero AS "Reserva", o.numero AS "Orden", UPPER(r.estado) AS "Estado", ${FECHA('r.vence_en')} AS "Vence", r.extensiones AS "Veces ampliada", r.motivo_extension AS "Motivo de la ampliación",
              r.notas AS "Notas", co.nombre_completo AS "Reservó", sm.numero AS "Solicitud de despacho", ${FECHA_HORA('r.cargada_en')} AS "Cargada (UTC)", ${FECHA_HORA('r.cancelada_en')} AS "Cancelada (UTC)", r.motivo_cancelacion AS "Motivo de cancelación"
            FROM reservas r JOIN ordenes o ON o.id = r.orden_id LEFT JOIN usuarios u ON u.id = r.creada_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id LEFT JOIN solicitudes_material sm ON sm.id = r.solicitud_id ORDER BY r.id`,
    },
    {
      nombre: 'Lineas de reservas',
      sql: `SELECT l.id AS "Número", r.numero AS "Reserva", m.codigo AS "Código", m.nombre AS "Material", l.cantidad AS "Cantidad reservada", l.cantidad_cubierta AS "Cantidad ya despachada"
            FROM reserva_lineas l JOIN reservas r ON r.id = l.reserva_id JOIN materiales m ON m.id = l.material_id ORDER BY r.id, l.id`,
    },
    {
      nombre: 'Materiales aplican a',
      sql: `SELECT a.id AS "Número", m.codigo AS "Código", m.nombre AS "Material", te.nombre AS "Tipo de equipo", mr.nombre AS "Marca", a.modelo AS "Modelo", UPPER(a.origen) AS "Origen", a.veces AS "Veces despachado", ${FECHA_HORA('a.ultima_vez')} AS "Última vez (UTC)"
            FROM material_aplica_a a JOIN materiales m ON m.id = a.material_id JOIN tipos_equipo te ON te.id = a.tipo_equipo_id LEFT JOIN marcas mr ON mr.id = a.marca_id ORDER BY m.codigo, te.nombre`,
    },
    {
      nombre: 'Cotizaciones',
      sql: `SELECT c.id AS "Número", c.numero AS "Cotización", c.version AS "Versión", UPPER(c.estado) AS "Estado", cl.nombre AS "Cliente", e.codigo_interno AS "Equipo", o.numero AS "Orden", c.subtotal AS "Subtotal", c.descuento_total AS "Descuento",
              c.iva AS "IVA", c.total AS "Total", ${FECHA('c.vence_en')} AS "Vence", ${FECHA_HORA('c.enviada_en')} AS "Enviada (UTC)", c.notas AS "Notas", co.nombre_completo AS "Creó", ${FECHA_HORA('c.anulada_en')} AS "Anulada (UTC)", c.motivo_anulacion AS "Motivo de anulación"
            FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN equipos e ON e.id = c.equipo_id LEFT JOIN ordenes o ON o.id = c.orden_id LEFT JOIN usuarios u ON u.id = c.creada_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY c.id`,
    },
    {
      nombre: 'Lineas de cotizaciones',
      sql: `SELECT l.id AS "Número", c.numero AS "Cotización", c.version AS "Versión", UPPER(l.tipo) AS "Tipo", l.descripcion AS "Descripción", l.cantidad AS "Cantidad", l.precio_unitario AS "Precio unitario", l.descuento_pct AS "Descuento %", l.total_linea AS "Total",
              l.costo AS "Costo (interno)", UPPER(REPLACE(l.estado, '_', ' ')) AS "Estado", mo.nombre AS "Motivo de rechazo", l.motivo_rechazo_texto AS "Detalle del rechazo", ${FECHA_HORA('l.respondida_en')} AS "Respondida (UTC)", co.nombre_completo AS "Registró la respuesta",
              l.respondida_por_nombre AS "Respondió por enlace", l.dispositivo AS "Dispositivo", l.ip AS "IP", ao.numero AS "Llevada a la orden", ${FECHA_HORA('l.agregada_en')} AS "Llevada (UTC)"
            FROM cotizacion_lineas l JOIN cotizaciones c ON c.id = l.cotizacion_id LEFT JOIN motivos mo ON mo.id = l.motivo_rechazo_id LEFT JOIN usuarios u ON u.id = l.respondida_por_usuario_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id
              LEFT JOIN ordenes ao ON ao.id = l.agregada_orden_id ORDER BY c.id, l.id`,
    },
    {
      nombre: 'Rojos en cotizaciones',
      sql: `SELECT h.id AS "Número", c.numero AS "Cotización", c.version AS "Versión", r.seccion AS "Sección", r.descripcion AS "Ítem en rojo", r.nota AS "Nota"
            FROM cotizacion_hallazgos h JOIN cotizaciones c ON c.id = h.cotizacion_id JOIN checklist_respuestas r ON r.id = h.respuesta_id ORDER BY c.id, h.id`,
    },
    {
      nombre: 'Enlaces publicos',
      sql: `SELECT e.id AS "Número", UPPER(e.tipo) AS "Documento", e.entidad_id AS "Número del documento", co.nombre_completo AS "Lo creó", ${FECHA_HORA('e.created_at')} AS "Creado (UTC)", ${FECHA_HORA('e.vence_en')} AS "Vence (UTC)", ${FECHA_HORA('e.revocado_en')} AS "Revocado (UTC)",
              ${FECHA_HORA('e.primera_apertura_en')} AS "Primera apertura (UTC)", e.primera_apertura_ip AS "Dirección de la primera apertura", ${FECHA_HORA('e.ultima_apertura_en')} AS "Última apertura (UTC)", e.aperturas AS "Aperturas"
            FROM enlaces_publicos e LEFT JOIN usuarios u ON u.id = e.creado_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY e.id`,
    },
    {
      nombre: 'Documentos emitidos',
      sql: `SELECT d.id AS "Número", UPPER(d.tipo) AS "Tipo", d.folio AS "Folio", d.version AS "Versión", o.numero AS "Orden", ct.numero AS "Cotización", ${FECHA_HORA('d.emitido_en')} AS "Emitido (UTC)", co.nombre_completo AS "Lo emitió",
              a.nombre_original AS "Archivo PDF"
            FROM documentos_emitidos d LEFT JOIN ordenes o ON o.id = d.orden_id LEFT JOIN cotizaciones ct ON ct.id = d.cotizacion_id JOIN archivos a ON a.id = d.archivo_id LEFT JOIN usuarios u ON u.id = d.emitido_por_id LEFT JOIN colaboradores co ON co.id = u.colaborador_id ORDER BY d.id`,
    },
    {
      nombre: 'Metas de indicadores',
      sql: `SELECT m.indicador AS "Indicador", m.sentido AS "Entre más… mejor", m.meta AS "Meta (verde)", m.limite AS "Límite (amarillo)" FROM metas_indicadores m ORDER BY m.indicador`,
    },
    {
      nombre: 'Tablero por rol',
      sql: `SELECT r.nombre AS "Rol", t.tarjeta AS "Tarjeta", t.orden AS "Orden" FROM tablero_roles t JOIN roles r ON r.id = t.rol_id ORDER BY r.id, t.orden`,
    },
    {
      nombre: 'Accesos de clientes',
      sql: `SELECT a.created_at AS "Fecha (UTC)", a.canal AS "Canal", a.tipo AS "Que vio", a.referencia AS "Referencia", cl.nombre AS "Cliente", co.nombre AS "Contacto", a.ip AS "Direccion de red", a.dispositivo AS "Dispositivo" FROM accesos_cliente a LEFT JOIN clientes cl ON cl.id = a.cliente_id LEFT JOIN contactos_cliente co ON co.id = a.contacto_id ORDER BY a.id`,
    },
    {
      nombre: 'Avisos',
      sql: `SELECT a.tipo_aviso AS "Aviso", ${SI_NO('a.activo')} AS "Encendido", a.umbral_dias AS "Días de anticipación", a.asunto AS "Asunto propio", a.cuerpo AS "Texto propio", ${SI_NO('a.incluir_contextual')} AS "También a la persona del hecho" FROM avisos_config a ORDER BY a.tipo_aviso`,
    },
    {
      nombre: 'Destinatarios de avisos',
      sql: `SELECT d.tipo_aviso AS "Aviso", r.nombre AS "Rol", c.nombre_completo AS "Persona", d.correo AS "Correo" FROM avisos_destinatarios d LEFT JOIN roles r ON r.id = d.rol_id LEFT JOIN usuarios u ON u.id = d.usuario_id LEFT JOIN colaboradores c ON c.id = u.colaborador_id ORDER BY d.tipo_aviso, d.id`,
    },
    {
      nombre: 'Envios programados',
      sql: `SELECT p.nombre AS "Nombre", p.reporte AS "Reporte", p.frecuencia AS "Frecuencia", p.dia_semana AS "Dia de la semana", p.dia_mes AS "Dia del mes", ${SI_NO('p.activo')} AS "Activo", p.filtros AS "Filtros", p.ultimo_envio_en AS "Ultimo envio (UTC)" FROM reportes_programados p ORDER BY p.nombre`,
    },
    {
      nombre: 'Destinatarios de envios',
      sql: `SELECT p.nombre AS "Envio", r.nombre AS "Rol", c.nombre_completo AS "Persona", d.correo AS "Correo" FROM reportes_programados_destinatarios d JOIN reportes_programados p ON p.id = d.reporte_programado_id LEFT JOIN roles r ON r.id = d.rol_id LEFT JOIN usuarios u ON u.id = d.usuario_id LEFT JOIN colaboradores c ON c.id = u.colaborador_id ORDER BY p.nombre, d.id`,
    },
    {
      nombre: 'Roles',
      sql: `SELECT r.codigo AS "Código", r.nombre AS "Nombre", r.descripcion AS "Descripción", ${SI_NO('r.es_sistema')} AS "Viene con el sistema", ${SI_NO('r.activo')} AS "Activo",
              (SELECT GROUP_CONCAT(rp.permiso_codigo ORDER BY rp.permiso_codigo SEPARATOR ', ') FROM rol_permisos rp WHERE rp.rol_id = r.id) AS "Permisos"
            FROM roles r ORDER BY r.nombre`,
    },
  ];
  const catalogos = CATALOGOS.map(([tabla, nombre]) => ({ nombre, sql: `SELECT * FROM ${tabla} ORDER BY 1` }));
  return [...principales, ...catalogos];
}

export interface ResumenHoja {
  hoja: string;
  filas: number;
}

export async function resumenDeExportacion(t: TallerReq): Promise<ResumenHoja[]> {
  const resultado: ResumenHoja[] = [];
  for (const h of hojasDeExportacion()) {
    const r = await una<{ n: number }>(t.pool, `SELECT COUNT(*) AS n FROM (${h.sql}) x`);
    resultado.push({ hoja: h.nombre, filas: Number(r?.n ?? 0) });
  }
  return resultado;
}

function aTexto(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    const p = (n: number): string => String(n).padStart(2, '0');
    const fecha = `${p(v.getUTCDate())}/${p(v.getUTCMonth() + 1)}/${v.getUTCFullYear()}`;
    return v.getUTCHours() === 0 && v.getUTCMinutes() === 0 && v.getUTCSeconds() === 0 ? fecha : `${fecha} ${p(v.getUTCHours())}:${p(v.getUTCMinutes())}`;
  }
  if (typeof v === 'number') return v;
  if (Buffer.isBuffer(v)) return v.toString('utf8');
  return String(v);
}

/** Arma el libro de Excel con todas las hojas. */
export async function generarLibroDeDatos(t: TallerReq, actor: Actor): Promise<{ buffer: Buffer; nombre: string; hojas: ResumenHoja[] }> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'VERI-TECH';
  libro.created = new Date();
  const leeme = libro.addWorksheet('Leeme');
  const resumen: ResumenHoja[] = [];
  for (const h of hojasDeExportacion()) {
    const [datos, campos] = (await t.pool.query<RowDataPacket[]>(h.sql)) as unknown as [RowDataPacket[], FieldPacket[]];
    const hoja = libro.addWorksheet(h.nombre.slice(0, 31));
    const encabezados = campos.map((c) => c.name);
    hoja.addRow(encabezados);
    estiloEncabezado(hoja.getRow(1));
    hoja.views = [{ state: 'frozen', ySplit: 1 }];
    for (const fila of datos) hoja.addRow(encabezados.map((e) => aTexto(fila[e])));
    encabezados.forEach((e, i) => {
      hoja.getColumn(i + 1).width = anchoDeColumna(e, datos.map((f) => f[e]));
    });
    if (datos.length > 0) hoja.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: encabezados.length } };
    resumen.push({ hoja: h.nombre, filas: datos.length });
  }

  leeme.columns = [{ width: 34 }, { width: 14 }, { width: 70 }];
  leeme.addRow([`Datos de ${t.empresa.nombre}`]).font = { bold: true, size: 14 };
  leeme.addRow([`Descargados el ${new Date().toISOString().slice(0, 16).replace('T', ' ')} (hora UTC) con VERI-TECH.`]);
  leeme.addRow([]);
  leeme.addRow(['Las horas marcadas (UTC) están en hora universal; Guatemala va 6 horas atrás. Las fechas van como día/mes/año.']);
  leeme.addRow(['Las fotos y documentos escaneados vienen aparte, en el archivo .zip, con el mismo nombre que dice la columna «Archivo (en el .zip)».']);
  leeme.addRow(['Las hojas de catálogos (desde «Sucursales») conservan los números internos para poder cruzarlas con las demás.']);
  leeme.addRow(['Por seguridad este libro NO incluye contraseñas, sesiones abiertas ni enlaces de recuperación.']);
  leeme.addRow([]);
  const cab = leeme.addRow(['Hoja', 'Filas']);
  estiloEncabezado(cab);
  for (const r of resumen) leeme.addRow([r.hoja, r.filas]);

  await bitacora(t.pool, actor, { accion: 'datos_exportados', entidad: 'exportacion', despues: { formato: 'xlsx', hojas: resumen.length, filas: resumen.reduce((s, r) => s + r.filas, 0) } });
  const fecha = new Date().toISOString().slice(0, 10);
  return { buffer: await aBuffer(libro), nombre: `datos-${t.empresa.slug}-${fecha}.xlsx`, hojas: resumen };
}

function nombreSeguro(nombre: string): string {
  return nombre.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 150) || 'archivo';
}

/** Envía un .zip con todas las fotos y documentos del taller (cada uno se llama «número_nombre original»). */
export async function enviarZipDeArchivos(ctx: Contexto, t: TallerReq, actor: Actor, res: Response): Promise<void> {
  const todos = await filas<{ id: number; nombre_original: string }>(t.pool, 'SELECT id, nombre_original FROM archivos ORDER BY id');
  await bitacora(t.pool, actor, { accion: 'datos_exportados', entidad: 'exportacion', despues: { formato: 'zip', archivos: todos.length } });
  const fecha = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="archivos-${t.empresa.slug}-${fecha}.zip"`);
  res.setHeader('Cache-Control', 'no-store');
  const zip = archiver('zip', { store: true });
  zip.on('error', () => res.destroy());
  zip.pipe(res);
  const faltantes: string[] = [];
  for (const a of todos) {
    const nombre = `${a.id}_${nombreSeguro(a.nombre_original)}`;
    try {
      const { ruta } = await abrirArchivo(ctx, t, a.id);
      await fs.promises.access(ruta);
      zip.append(fs.createReadStream(ruta), { name: `archivos/${nombre}` });
    } catch {
      faltantes.push(nombre);
    }
  }
  const lineas = [
    `Fotos y documentos de ${t.empresa.nombre}`,
    `Archivos incluidos: ${todos.length - faltantes.length} de ${todos.length}.`,
    'Cada archivo se llama «número_nombre original»; ese mismo nombre aparece en la columna «Archivo (en el .zip)» del libro de Excel.',
    ...(faltantes.length > 0 ? ['', 'No se encontraron en el servidor:', ...faltantes] : []),
  ];
  zip.append(lineas.join('\r\n'), { name: 'LEEME.txt' });
  await zip.finalize();
}
