import { filas } from '../db/consulta';
import { TallerReq } from './comun';

/**
 * Búsqueda global (Fase 7c): una sola caja que busca en todo lo que la persona tiene derecho a ver (cada grupo exige el permiso de su pantalla).
 * Varias palabras = todas deben aparecer (en cualquiera de los campos del grupo). La base ignora mayúsculas y tildes.
 */

export interface ResultadoBusqueda {
  id: number;
  titulo: string;
  detalle: string | null;
  /** Dirección dentro del taller (la pantalla abre el registro si sabe hacerlo; si no, queda filtrada por la búsqueda). */
  ruta: string;
}

export interface GrupoBusqueda {
  codigo: string;
  titulo: string;
  resultados: ResultadoBusqueda[];
}

const POR_GRUPO = 6;
export const MINIMO_DE_LETRAS = 2;

const escaparLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** (campo1 LIKE ? OR campo2 LIKE ?) AND (…) por cada palabra. */
function donde(campos: string[], palabras: string[]): { sql: string; params: string[] } {
  const params: string[] = [];
  const partes = palabras.map((p) => {
    for (let i = 0; i < campos.length; i++) params.push(`%${escaparLike(p)}%`);
    return `(${campos.map((c) => `${c} LIKE ?`).join(' OR ')})`;
  });
  return { sql: partes.join(' AND '), params };
}

interface DefGrupo {
  codigo: string;
  titulo: string;
  permiso: string;
  consulta: (w: { sql: string; params: string[] }) => { sql: string; params: string[] };
  campos: string[];
  /** Cómo se arma la dirección del resultado. */
  ruta: (r: { id: number; titulo: string }) => string;
}

const GRUPOS: DefGrupo[] = [
  {
    codigo: 'equipos',
    titulo: 'Equipos',
    permiso: 'equipos.ver',
    campos: ['e.codigo_interno', 'e.placa', 'e.serie', 'e.modelo', 'm.nombre', 'cl.nombre'],
    consulta: (w) => ({
      sql: `SELECT e.id, CONCAT_WS(' · ', e.codigo_interno, e.placa) AS titulo, CONCAT_WS(' · ', te.nombre, m.nombre, e.modelo, cl.nombre) AS detalle
              FROM equipos e JOIN tipos_equipo te ON te.id = e.tipo_equipo_id LEFT JOIN marcas m ON m.id = e.marca_id LEFT JOIN clientes cl ON cl.id = e.cliente_id
             WHERE ${w.sql} ORDER BY (e.estado = 'baja'), e.codigo_interno, e.id LIMIT ${POR_GRUPO}`,
      params: w.params,
    }),
    ruta: (r) => `/equipos?equipo=${r.id}`,
  },
  {
    codigo: 'clientes',
    titulo: 'Clientes',
    permiso: 'clientes.ver',
    campos: ['c.nombre', 'c.nit', 'c.contacto_nombre', 'c.telefono', 'c.email'],
    consulta: (w) => ({ sql: `SELECT c.id, c.nombre AS titulo, CONCAT_WS(' · ', c.nit, c.telefono) AS detalle FROM clientes c WHERE ${w.sql} ORDER BY c.activo DESC, c.nombre LIMIT ${POR_GRUPO}`, params: w.params }),
    ruta: (r) => `/clientes?tab=clientes&buscar=${encodeURIComponent(r.titulo)}`,
  },
  {
    codigo: 'ordenes',
    titulo: 'Órdenes de trabajo',
    permiso: 'ordenes.ver',
    campos: ['o.numero', 'o.descripcion', 'e.placa', 'e.codigo_interno', 'cl.nombre'],
    consulta: (w) => ({
      sql: `SELECT o.id, o.numero AS titulo, CONCAT_WS(' · ', es.nombre, CONCAT_WS(' ', e.codigo_interno, e.placa), cl.nombre) AS detalle
              FROM ordenes o JOIN estados_orden es ON es.id = o.estado_id JOIN equipos e ON e.id = o.equipo_id LEFT JOIN clientes cl ON cl.id = o.cliente_id
             WHERE ${w.sql} ORDER BY o.id DESC LIMIT ${POR_GRUPO}`,
      params: w.params,
    }),
    ruta: (r) => `/ordenes?orden=${r.id}`,
  },
  {
    codigo: 'cotizaciones',
    titulo: 'Cotizaciones',
    permiso: 'cotizaciones.ver',
    campos: ['c.numero', 'cl.nombre', 'e.placa', 'e.codigo_interno'],
    consulta: (w) => ({
      sql: `SELECT c.id, c.numero AS titulo, CONCAT_WS(' · ', c.estado, cl.nombre, CONCAT_WS(' ', e.codigo_interno, e.placa)) AS detalle
              FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id LEFT JOIN equipos e ON e.id = c.equipo_id WHERE ${w.sql} ORDER BY c.id DESC LIMIT ${POR_GRUPO}`,
      params: w.params,
    }),
    ruta: (r) => `/cotizaciones?cotizacion=${r.id}`,
  },
  {
    codigo: 'solicitudes',
    titulo: 'Solicitudes de material',
    permiso: 'solicitudes.ver',
    campos: ['s.numero', 'o.numero'],
    consulta: (w) => ({ sql: `SELECT s.id, s.numero AS titulo, CONCAT_WS(' · ', s.estado, o.numero) AS detalle FROM solicitudes_material s JOIN ordenes o ON o.id = s.orden_id WHERE ${w.sql} ORDER BY s.id DESC LIMIT ${POR_GRUPO}`, params: w.params }),
    ruta: () => '/inventario?tab=solicitudes',
  },
  {
    codigo: 'materiales',
    titulo: 'Materiales',
    permiso: 'inventario.ver',
    campos: ['m.codigo', 'm.nombre'],
    consulta: (w) => ({ sql: `SELECT m.id, CONCAT_WS(' · ', m.codigo, m.nombre) AS titulo, NULL AS detalle FROM materiales m WHERE ${w.sql} ORDER BY m.activo DESC, m.codigo LIMIT ${POR_GRUPO}`, params: w.params }),
    ruta: (r) => `/inventario?tab=materiales&material=${r.id}`,
  },
  {
    codigo: 'proveedores',
    titulo: 'Proveedores',
    permiso: 'proveedores.ver',
    campos: ['p.nombre', 'p.nit', 'p.contacto_nombre'],
    consulta: (w) => ({ sql: `SELECT p.id, p.nombre AS titulo, p.nit AS detalle FROM proveedores p WHERE ${w.sql} ORDER BY p.activo DESC, p.nombre LIMIT ${POR_GRUPO}`, params: w.params }),
    ruta: (r) => `/clientes?tab=proveedores&buscar=${encodeURIComponent(r.titulo)}`,
  },
  {
    codigo: 'trabajos',
    titulo: 'Trabajos del catálogo',
    permiso: 'catalogos.ver',
    campos: ['tr.nombre', 'tr.codigo'],
    consulta: (w) => ({ sql: `SELECT tr.id, tr.nombre AS titulo, tr.codigo AS detalle FROM trabajos tr WHERE tr.activo = 1 AND ${w.sql} ORDER BY tr.nombre LIMIT ${POR_GRUPO}`, params: w.params }),
    ruta: () => '/configuracion?tab=catalogos',
  },
  {
    codigo: 'colaboradores',
    titulo: 'Colaboradores',
    permiso: 'colaboradores.ver',
    campos: ['c.nombre_completo', 'c.codigo', 'c.correo'],
    consulta: (w) => ({ sql: `SELECT c.id, c.nombre_completo AS titulo, c.correo AS detalle FROM colaboradores c WHERE ${w.sql} ORDER BY c.activo DESC, c.nombre_completo LIMIT ${POR_GRUPO}`, params: w.params }),
    ruta: () => '/configuracion?tab=colaboradores',
  },
];

export async function buscar(t: TallerReq, permisos: Set<string>, texto: string): Promise<{ q: string; demasiado_corta: boolean; grupos: GrupoBusqueda[] }> {
  const q = texto.trim().replace(/\s+/g, ' ').slice(0, 60);
  const palabras = q.split(' ').filter((p) => p.length > 0).slice(0, 5);
  if (q.length < MINIMO_DE_LETRAS) return { q, demasiado_corta: true, grupos: [] };
  const permitidos = GRUPOS.filter((g) => permisos.has(g.permiso));
  const resultados = await Promise.all(
    permitidos.map(async (g) => {
      const c = g.consulta(donde(g.campos, palabras));
      const f = await filas<{ id: number; titulo: string | null; detalle: string | null }>(t.pool, c.sql, c.params);
      return { codigo: g.codigo, titulo: g.titulo, resultados: f.map((r) => ({ id: r.id, titulo: r.titulo ?? '', detalle: r.detalle, ruta: g.ruta({ id: r.id, titulo: r.titulo ?? '' }) })) };
    })
  );
  return { q, demasiado_corta: false, grupos: resultados.filter((g) => g.resultados.length > 0) };
}
