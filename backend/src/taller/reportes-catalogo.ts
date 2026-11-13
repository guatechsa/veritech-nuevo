import { filas, una } from '../db/consulta';
import { ErrorValidacion } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { limitesDelDia } from '../utils/zona';
import { TallerReq } from './comun';
import { hoyDelTaller } from './contadores';
import { Filtros, indicadores, rechazosDeCotizaciones, validarPeriodo } from './indicadores';
import { FiltrosGuardados, ReporteArmado, SeccionReporte } from './reportes-tipos';

/**
 * Catálogo de reportes (Fase 7c). Cada reporte se arma UNA vez (en el servidor, paginado por periodo) y de ahí salen la pantalla, el Excel, el PDF
 * y el correo programado: así los cuatro dicen siempre lo mismo. Los de dinero solo se arman con el permiso de reportes financieros.
 */

export interface DefReporte {
  codigo: string;
  titulo: string;
  ayuda: string;
  /** Todo el reporte es de dinero: solo con el permiso de reportes financieros. */
  financiero: boolean;
  armar: (ctx: Contexto, t: TallerReq, f: Filtros, conDinero: boolean) => Promise<ReporteArmado>;
}

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
const sumarDias = (fecha: string, dias: number): string => new Date(new Date(`${fecha}T00:00:00Z`).getTime() + dias * 86400000).toISOString().slice(0, 10);

/** «este mes», «últimos 30 días»… → fechas del taller. */
export function resolverPeriodo(ctx: Contexto, t: TallerReq, g: FiltrosGuardados): Filtros {
  const hoy = hoyDelTaller(ctx, t);
  const base: Filtros = { desde: hoy, hasta: hoy };
  if (g.sucursal_id) base.sucursal_id = g.sucursal_id;
  if (g.tipo_equipo_id) base.tipo_equipo_id = g.tipo_equipo_id;
  switch (g.periodo) {
    case 'hoy':
      return base;
    case 'ultimos_7':
      return { ...base, desde: sumarDias(hoy, -6) };
    case 'ultimos_30':
      return { ...base, desde: sumarDias(hoy, -29) };
    case 'este_mes':
      return { ...base, desde: `${hoy.slice(0, 7)}-01` };
    case 'mes_anterior': {
      const primero = `${hoy.slice(0, 7)}-01`;
      const ultimo = sumarDias(primero, -1);
      return { ...base, desde: `${ultimo.slice(0, 7)}-01`, hasta: ultimo };
    }
    case 'personalizado':
      if (!g.desde || !g.hasta) throw new ErrorValidacion('Indique desde y hasta para el periodo personalizado');
      return { ...base, desde: g.desde, hasta: g.hasta };
  }
}

async function describirFiltros(t: TallerReq, f: Filtros): Promise<string[]> {
  const salida: string[] = [];
  if (f.sucursal_id) {
    const s = await una<{ nombre: string }>(t.pool, 'SELECT nombre FROM sucursales WHERE id = ?', [f.sucursal_id]);
    salida.push(`Sucursal: ${s?.nombre ?? f.sucursal_id}`);
  }
  if (f.tipo_equipo_id) {
    const s = await una<{ nombre: string }>(t.pool, 'SELECT nombre FROM tipos_equipo WHERE id = ?', [f.tipo_equipo_id]);
    salida.push(`Tipo de equipo: ${s?.nombre ?? f.tipo_equipo_id}`);
  }
  return salida;
}

const UNIDAD: Record<string, string> = { cantidad: '', moneda: 'Q', porcentaje: '%', dias: 'días', horas: 'horas' };

// ── Indicadores ───────────────────────────────────────────────────────────────────────
async function armarIndicadores(ctx: Contexto, t: TallerReq, f: Filtros, conDinero: boolean): Promise<ReporteArmado> {
  const ind = await indicadores(ctx, t, f, conDinero);
  const seccion: SeccionReporte = {
    titulo: 'Indicadores',
    columnas: [
      { clave: 'indicador', titulo: 'Indicador', tipo: 'texto' },
      { clave: 'base', titulo: 'Base de fechas', tipo: 'texto' },
      { clave: 'resultado', titulo: 'Resultado', tipo: 'decimal' },
      { clave: 'unidad', titulo: 'Unidad', tipo: 'texto' },
      { clave: 'meta', titulo: 'Meta', tipo: 'decimal' },
      { clave: 'semaforo', titulo: 'Semáforo', tipo: 'texto' },
    ],
    filas: ind.map((i) => ({ indicador: i.nombre, base: i.base, resultado: i.valor, unidad: UNIDAD[i.unidad] ?? '', meta: i.meta?.meta ?? null, semaforo: i.semaforo ? i.semaforo.toUpperCase() : null })),
  };
  return {
    codigo: 'indicadores',
    titulo: 'Indicadores del taller',
    desde: f.desde,
    hasta: f.hasta,
    filtros: await describirFiltros(t, f),
    secciones: [seccion],
    notas: ['«Sin dato» significa que en el periodo no hubo con qué calcularlo; no es cero.', ...(conDinero ? [] : ['Los indicadores de dinero no se incluyen: hace falta el permiso de reportes financieros.'])],
  };
}

// ── Motivos de rechazo ────────────────────────────────────────────────────────────────
async function armarRechazos(ctx: Contexto, t: TallerReq, f: Filtros, conDinero: boolean): Promise<ReporteArmado> {
  const r = await rechazosDeCotizaciones(ctx, t, f, conDinero);
  const cols = (titulo: string) => [
    { clave: 'nombre', titulo, tipo: 'texto' as const },
    { clave: 'lineas', titulo: 'Líneas rechazadas', tipo: 'entero' as const },
    ...(conDinero ? [{ clave: 'valor', titulo: 'Valor', tipo: 'dinero' as const }] : []),
  ];
  const seccion = (titulo: string, primera: string, datos: Array<{ nombre: string; lineas: number; valor?: number }>): SeccionReporte => ({
    titulo,
    columnas: cols(primera),
    filas: datos.map((d) => ({ nombre: d.nombre, lineas: d.lineas, ...(conDinero ? { valor: d.valor ?? 0 } : {}) })),
  });
  return {
    codigo: 'rechazos',
    titulo: 'Motivos de rechazo de las cotizaciones',
    desde: f.desde,
    hasta: f.hasta,
    filtros: await describirFiltros(t, f),
    secciones: [
      { ...seccion('Por motivo', 'Motivo', r.por_motivo), total: { nombre: 'Total', lineas: r.total_lineas, ...(conDinero ? { valor: r.total_valor ?? 0 } : {}) } },
      seccion('Por tipo de equipo', 'Tipo de equipo', r.por_tipo_equipo),
      seccion('Por cliente', 'Cliente', r.por_cliente),
      seccion('Por ítem del checklist', 'Ítem', r.por_item),
    ],
    notas: ['Cuenta las líneas rechazadas por el cliente en el periodo, por la fecha en que respondió.'],
  };
}

// ── Carga de trabajo ──────────────────────────────────────────────────────────────────
async function armarCarga(ctx: Contexto, t: TallerReq, f: Filtros): Promise<ReporteArmado> {
  validarPeriodo(f);
  const zona = t.empresa.zonaHoraria;
  const d = limitesDelDia(f.desde, zona).desde;
  const h = limitesDelDia(f.hasta, zona).hasta;
  const hoy = hoyDelTaller(ctx, t);
  const sql: string[] = [];
  const params: unknown[] = [];
  if (f.sucursal_id) {
    sql.push('o.sucursal_id = ?');
    params.push(f.sucursal_id);
  }
  if (f.tipo_equipo_id) {
    sql.push('e.tipo_equipo_id = ?');
    params.push(f.tipo_equipo_id);
  }
  const fo = sql.length ? ` AND ${sql.join(' AND ')}` : '';
  const union = 'JOIN ordenes o ON o.id = l.orden_id JOIN equipos e ON e.id = o.equipo_id';

  // 1. Lo que hizo cada técnico en el periodo.
  const terminados = await filas<{ id: number; n: number; vendidas: number | null }>(
    t.pool,
    `SELECT l.tecnico_id AS id, COUNT(*) AS n, SUM(l.horas_trabajo) AS vendidas FROM lineas_orden l ${union}
      WHERE l.tecnico_id IS NOT NULL AND l.tipo = 'servicio' AND l.estado = 'terminado' AND l.anulada_en IS NULL AND l.fin_en >= ? AND l.fin_en < ?${fo} GROUP BY l.tecnico_id`,
    [d, h, ...params]
  );
  const trabajadas = await filas<{ id: number; horas: number | null }>(
    t.pool,
    `SELECT r.colaborador_id AS id, SUM(TIMESTAMPDIFF(SECOND, r.inicio, r.fin)) / 3600 AS horas FROM registros_tiempo r JOIN lineas_orden l ON l.id = r.linea_id ${union}
      WHERE r.fin IS NOT NULL AND r.inicio >= ? AND r.inicio < ?${fo} GROUP BY r.colaborador_id`,
    [d, h, ...params]
  );
  const roster = await filas<{ id: number }>(t.pool, "SELECT DISTINCT u.colaborador_id AS id FROM usuarios u JOIN usuario_roles ur ON ur.usuario_id = u.id JOIN roles r ON r.id = ur.rol_id WHERE u.activo = 1 AND r.codigo = 'tecnico'");
  const ids = [...new Set([...roster.map((x) => x.id), ...terminados.map((x) => x.id), ...trabajadas.map((x) => x.id)])];
  const nombres = ids.length > 0 ? await filas<{ id: number; nombre: string }>(t.pool, `SELECT id, nombre_completo AS nombre FROM colaboradores WHERE id IN (${ids.map(() => '?').join(',')})`, ids) : [];
  const porTecnico = ids
    .map((id) => {
      const a = terminados.find((x) => x.id === id);
      const b = trabajadas.find((x) => x.id === id);
      return { tecnico: nombres.find((x) => x.id === id)?.nombre ?? `COLABORADOR ${id}`, terminados: Number(a?.n ?? 0), vendidas: r2(Number(a?.vendidas ?? 0)), trabajadas: r2(Number(b?.horas ?? 0)) };
    })
    .sort((x, y) => y.trabajadas - x.trabajadas || x.tecnico.localeCompare(y.tecnico, 'es'));

  // 2. Lo que está pendiente HOY (foto del momento, no del periodo).
  const pendiente = `FROM lineas_orden l ${union} JOIN estados_orden es ON es.id = o.estado_id
      WHERE es.es_terminal = 0 AND l.tipo = 'servicio' AND l.estado <> 'terminado' AND l.anulada_en IS NULL${fo}`;
  const pendTec = await filas<{ nombre: string | null; n: number; horas: number | null }>(
    t.pool,
    `SELECT c.nombre_completo AS nombre, COUNT(*) AS n, SUM(l.horas_trabajo) AS horas ${pendiente.replace('FROM lineas_orden l', 'FROM lineas_orden l LEFT JOIN colaboradores c ON c.id = l.tecnico_id')} GROUP BY l.tecnico_id, c.nombre_completo ORDER BY horas DESC`,
    params
  );
  const pendArea = await filas<{ nombre: string | null; n: number; horas: number | null }>(
    t.pool,
    `SELECT a.nombre AS nombre, COUNT(*) AS n, SUM(l.horas_trabajo) AS horas ${pendiente.replace('FROM lineas_orden l', 'FROM lineas_orden l LEFT JOIN areas_trabajo a ON a.id = l.area_trabajo_id')} GROUP BY l.area_trabajo_id, a.nombre ORDER BY horas DESC`,
    params
  );

  // 3. Citas de los próximos 7 días.
  const citas: Array<Record<string, string | number | null>> = [];
  for (let i = 0; i < 7; i++) {
    const dia = sumarDias(hoy, i);
    const l = limitesDelDia(dia, zona);
    const c = await una<{ n: number; horas: number | null }>(
      t.pool,
      `SELECT COUNT(*) AS n, SUM(c.horas_estimadas) AS horas FROM citas c JOIN equipos e ON e.id = c.equipo_id WHERE c.estado = 'programada' AND c.fecha_hora >= ? AND c.fecha_hora < ?${f.sucursal_id ? ' AND c.sucursal_id = ?' : ''}${f.tipo_equipo_id ? ' AND e.tipo_equipo_id = ?' : ''}`,
      [l.desde, l.hasta, ...(f.sucursal_id ? [f.sucursal_id] : []), ...(f.tipo_equipo_id ? [f.tipo_equipo_id] : [])]
    );
    citas.push({ dia: `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`, citas: Number(c?.n ?? 0), horas: r2(Number(c?.horas ?? 0)) });
  }

  const sumar = <T,>(xs: T[], campo: (x: T) => number): number => r2(xs.reduce((a, x) => a + campo(x), 0));
  return {
    codigo: 'carga',
    titulo: 'Carga de trabajo',
    desde: f.desde,
    hasta: f.hasta,
    filtros: await describirFiltros(t, f),
    secciones: [
      {
        titulo: 'Trabajo realizado por técnico (en el periodo)',
        columnas: [
          { clave: 'tecnico', titulo: 'Técnico', tipo: 'texto' },
          { clave: 'terminados', titulo: 'Trabajos terminados', tipo: 'entero' },
          { clave: 'vendidas', titulo: 'Horas vendidas', tipo: 'decimal' },
          { clave: 'trabajadas', titulo: 'Horas trabajadas', tipo: 'decimal' },
        ],
        filas: porTecnico,
        total: { tecnico: 'Total', terminados: sumar(porTecnico, (x) => x.terminados), vendidas: sumar(porTecnico, (x) => x.vendidas), trabajadas: sumar(porTecnico, (x) => x.trabajadas) },
      },
      {
        titulo: 'Trabajos pendientes hoy, por técnico',
        columnas: [
          { clave: 'nombre', titulo: 'Técnico', tipo: 'texto' },
          { clave: 'trabajos', titulo: 'Trabajos', tipo: 'entero' },
          { clave: 'horas', titulo: 'Horas vendidas', tipo: 'decimal' },
        ],
        filas: pendTec.map((x) => ({ nombre: x.nombre ?? 'SIN TECNICO ASIGNADO', trabajos: Number(x.n), horas: r2(Number(x.horas ?? 0)) })),
        total: { nombre: 'Total', trabajos: sumar(pendTec, (x) => Number(x.n)), horas: sumar(pendTec, (x) => Number(x.horas ?? 0)) },
      },
      {
        titulo: 'Trabajos pendientes hoy, por área',
        columnas: [
          { clave: 'nombre', titulo: 'Área de trabajo', tipo: 'texto' },
          { clave: 'trabajos', titulo: 'Trabajos', tipo: 'entero' },
          { clave: 'horas', titulo: 'Horas vendidas', tipo: 'decimal' },
        ],
        filas: pendArea.map((x) => ({ nombre: x.nombre ?? 'SIN AREA', trabajos: Number(x.n), horas: r2(Number(x.horas ?? 0)) })),
      },
      {
        titulo: 'Citas programadas (próximos 7 días)',
        columnas: [
          { clave: 'dia', titulo: 'Día', tipo: 'texto' },
          { clave: 'citas', titulo: 'Citas', tipo: 'entero' },
          { clave: 'horas', titulo: 'Horas estimadas', tipo: 'decimal' },
        ],
        filas: citas,
      },
    ],
    notas: [
      'El trabajo realizado cuenta por la fecha en que el trabajo terminó (horas vendidas) y por la fecha en que se trabajó (horas trabajadas, con cronómetro).',
      'Los pendientes y las citas son la situación de hoy y de los próximos 7 días; no dependen del periodo elegido.',
    ],
  };
}

// ── Compras ───────────────────────────────────────────────────────────────────────────
async function armarCompras(_ctx: Contexto, t: TallerReq, f: Filtros): Promise<ReporteArmado> {
  validarPeriodo(f);
  const sucursal = f.sucursal_id ? ' AND b.sucursal_id = ?' : '';
  const base = [f.desde, f.hasta, ...(f.sucursal_id ? [f.sucursal_id] : [])];
  const prov = await filas<{ nombre: string; n: number; total: number }>(
    t.pool,
    `SELECT p.nombre, COUNT(*) AS n, SUM(c.total) AS total FROM compras c JOIN proveedores p ON p.id = c.proveedor_id JOIN bodegas b ON b.id = c.bodega_id
      WHERE c.fecha_documento >= ? AND c.fecha_documento <= ?${sucursal} GROUP BY p.id, p.nombre ORDER BY total DESC`,
    base
  );
  const mats = await filas<{ codigo: string; nombre: string; cantidad: number; monto: number }>(
    t.pool,
    `SELECT m.codigo, m.nombre, SUM(l.cantidad) AS cantidad, SUM(l.cantidad * l.costo_unitario) AS monto FROM compra_lineas l JOIN compras c ON c.id = l.compra_id JOIN materiales m ON m.id = l.material_id JOIN bodegas b ON b.id = c.bodega_id
      WHERE c.fecha_documento >= ? AND c.fecha_documento <= ?${sucursal} GROUP BY m.id, m.codigo, m.nombre ORDER BY monto DESC LIMIT 25`,
    base
  );
  return {
    codigo: 'compras',
    titulo: 'Compras de material',
    desde: f.desde,
    hasta: f.hasta,
    filtros: await describirFiltros(t, { ...f, tipo_equipo_id: undefined }),
    secciones: [
      {
        titulo: 'Compras por proveedor',
        columnas: [
          { clave: 'proveedor', titulo: 'Proveedor', tipo: 'texto' },
          { clave: 'documentos', titulo: 'Compras', tipo: 'entero' },
          { clave: 'total', titulo: 'Total comprado', tipo: 'dinero' },
        ],
        filas: prov.map((x) => ({ proveedor: x.nombre, documentos: Number(x.n), total: r2(Number(x.total)) })),
        total: { proveedor: 'Total', documentos: prov.reduce((a, x) => a + Number(x.n), 0), total: r2(prov.reduce((a, x) => a + Number(x.total), 0)) },
      },
      {
        titulo: 'Materiales más comprados (los 25 de mayor monto)',
        columnas: [
          { clave: 'codigo', titulo: 'Código', tipo: 'texto' },
          { clave: 'material', titulo: 'Material', tipo: 'texto' },
          { clave: 'cantidad', titulo: 'Unidades', tipo: 'entero' },
          { clave: 'monto', titulo: 'Monto', tipo: 'dinero' },
          { clave: 'promedio', titulo: 'Costo promedio', tipo: 'dinero' },
        ],
        filas: mats.map((x) => ({ codigo: x.codigo, material: x.nombre, cantidad: Number(x.cantidad), monto: r2(Number(x.monto)), promedio: Number(x.cantidad) > 0 ? r2(Number(x.monto) / Number(x.cantidad)) : null })),
      },
    ],
    notas: ['Cuenta las compras por la fecha del documento. El tipo de equipo no aplica a las compras.'],
  };
}

export const REPORTES: DefReporte[] = [
  { codigo: 'indicadores', titulo: 'Indicadores del taller', ayuda: 'Los indicadores con su meta y su semáforo.', financiero: false, armar: armarIndicadores },
  { codigo: 'rechazos', titulo: 'Motivos de rechazo de las cotizaciones', ayuda: 'Por qué el cliente no autoriza lo que se le cotiza.', financiero: false, armar: armarRechazos },
  { codigo: 'carga', titulo: 'Carga de trabajo', ayuda: 'Lo que hizo cada técnico, lo que está pendiente hoy y las citas que vienen.', financiero: false, armar: (c, t, f) => armarCarga(c, t, f) },
  { codigo: 'compras', titulo: 'Compras de material', ayuda: 'Lo comprado por proveedor y los materiales más comprados.', financiero: true, armar: (c, t, f) => armarCompras(c, t, f) },
];

export function defDeReporte(codigo: string): DefReporte {
  const d = REPORTES.find((r) => r.codigo === codigo);
  if (!d) throw new ErrorValidacion('Ese reporte no existe');
  return d;
}

/** Los reportes de la lista a los que la persona tiene derecho. */
export function reportesPermitidos(permisos: Set<string>): DefReporte[] {
  return REPORTES.filter((r) => permisos.has('reportes.ver') && (!r.financiero || permisos.has('reportes.financieros')));
}

export async function armarReporte(ctx: Contexto, t: TallerReq, codigo: string, g: FiltrosGuardados, conDinero: boolean): Promise<ReporteArmado> {
  const def = defDeReporte(codigo);
  if (def.financiero && !conDinero) throw new ErrorValidacion('Este reporte es de dinero: hace falta el permiso de reportes financieros');
  return def.armar(ctx, t, resolverPeriodo(ctx, t, g), conDinero);
}

