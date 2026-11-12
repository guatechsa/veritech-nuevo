import { ejecutar, filas, transaccion } from '../db/consulta';
import { ErrorValidacion } from '../errores';
import { Contexto } from '../plataforma/contexto';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, TallerReq } from './comun';

/**
 * Configuración del taller: las claves y sus valores permitidos están definidos AQUÍ (no hay llaves libres sin control).
 * Lo que no se ha guardado vale su valor de fábrica. Todo cambio queda en la bitácora.
 */
interface Clave {
  tipo: 'texto' | 'correo' | 'opcion' | 'numero' | 'bool';
  etiqueta: string;
  defecto: string;
  opciones?: string[];
  max?: number;
  min?: number;
  /** Datos de la empresa que salen en los documentos (se normalizan a MAYÚSCULAS). */
  grupo: 'empresa' | 'regional' | 'precios' | 'citas';
}

export const CLAVES: Record<string, Clave> = {
  nombre_empresa: { tipo: 'texto', etiqueta: 'Nombre de la empresa', defecto: '', max: 150, grupo: 'empresa' },
  nit_empresa: { tipo: 'texto', etiqueta: 'NIT de la empresa', defecto: '', max: 30, grupo: 'empresa' },
  direccion_empresa: { tipo: 'texto', etiqueta: 'Dirección', defecto: '', max: 250, grupo: 'empresa' },
  telefono_empresa: { tipo: 'texto', etiqueta: 'Teléfono', defecto: '', max: 40, grupo: 'empresa' },
  correo_empresa: { tipo: 'correo', etiqueta: 'Correo de la empresa', defecto: '', max: 150, grupo: 'empresa' },
  zona_horaria: { tipo: 'opcion', etiqueta: 'Zona horaria', defecto: 'America/Guatemala', grupo: 'regional' },
  moneda: { tipo: 'opcion', etiqueta: 'Moneda', defecto: 'GTQ', opciones: ['GTQ', 'USD'], grupo: 'regional' },
  iva_porcentaje: { tipo: 'numero', etiqueta: 'IVA (%)', defecto: '12', min: 0, max: 30, grupo: 'precios' },
  precios_incluyen_iva: { tipo: 'bool', etiqueta: 'Los precios ya incluyen IVA', defecto: 'false', grupo: 'precios' },
  margen_general: { tipo: 'numero', etiqueta: 'Margen general de los materiales (%)', defecto: '30', min: 0, max: 1000, grupo: 'precios' },
  costo_base_inventario: { tipo: 'opcion', etiqueta: 'Costo con el que se sugiere el precio de un material', defecto: 'COSTO PROMEDIO', opciones: ['COSTO PROMEDIO', 'ULTIMO COSTO'], grupo: 'precios' },
  vigencia_cotizacion_dias: { tipo: 'numero', etiqueta: 'Días de vigencia de una cotización', defecto: '15', min: 1, max: 365, grupo: 'precios' },
  modo_citas: { tipo: 'opcion', etiqueta: 'Cupo diario de citas', defecto: 'SOLO COORDINAR', opciones: ['SOLO COORDINAR', 'RESERVAR'], grupo: 'citas' },
};

function zonaValida(z: string): boolean {
  try {
    new Intl.DateTimeFormat('es', { timeZone: z });
    return true;
  } catch {
    return false;
  }
}

export async function leerConfiguracion(t: TallerReq): Promise<Record<string, string>> {
  const filasCfg = await filas<{ clave: string; valor: string | null }>(t.pool, 'SELECT clave, valor FROM configuracion');
  const guardados = new Map(filasCfg.map((f) => [f.clave, f.valor ?? '']));
  const salida: Record<string, string> = {};
  for (const [clave, def] of Object.entries(CLAVES)) salida[clave] = guardados.get(clave) ?? def.defecto;
  return salida;
}

export function metadatosDeConfiguracion() {
  return Object.entries(CLAVES).map(([clave, c]) => ({ clave, tipo: c.tipo, etiqueta: c.etiqueta, grupo: c.grupo, opciones: c.opciones ?? null, min: c.min ?? null, max: c.max ?? null }));
}

function normalizarValor(clave: string, c: Clave, valor: unknown): string {
  if (typeof valor !== 'string' && typeof valor !== 'number' && typeof valor !== 'boolean') throw new ErrorValidacion(`El valor de «${c.etiqueta}» no es válido`);
  const texto = String(valor).trim();
  switch (c.tipo) {
    case 'texto':
      if (texto.length > (c.max ?? 250)) throw new ErrorValidacion(`«${c.etiqueta}» es demasiado largo`);
      return normalizarCampo('texto', texto) ?? '';
    case 'correo':
      if (texto !== '' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(texto)) throw new ErrorValidacion(`«${c.etiqueta}» no es un correo válido`);
      return texto;
    case 'numero': {
      const n = Number(texto);
      if (!Number.isFinite(n) || n < (c.min ?? 0) || n > (c.max ?? 1_000_000)) throw new ErrorValidacion(`«${c.etiqueta}» debe estar entre ${c.min ?? 0} y ${c.max}`);
      return String(n);
    }
    case 'bool':
      if (texto !== 'true' && texto !== 'false') throw new ErrorValidacion(`«${c.etiqueta}» debe ser sí o no`);
      return texto;
    case 'opcion':
      if (clave === 'zona_horaria') {
        if (!zonaValida(texto)) throw new ErrorValidacion('La zona horaria no es válida');
        return texto;
      }
      if (!c.opciones?.includes(texto)) throw new ErrorValidacion(`«${c.etiqueta}» no admite ese valor`);
      return texto;
  }
}

export async function guardarConfiguracion(ctx: Contexto, t: TallerReq, actor: Actor, cambios: Record<string, unknown>): Promise<Record<string, string>> {
  const desconocidas = Object.keys(cambios).filter((k) => !(k in CLAVES));
  if (desconocidas.length > 0) throw new ErrorValidacion(`Configuración desconocida: ${desconocidas.join(', ')}`);
  const nuevos: Record<string, string> = {};
  for (const [k, v] of Object.entries(cambios)) nuevos[k] = normalizarValor(k, CLAVES[k] as Clave, v);
  if (Object.keys(nuevos).length === 0) return leerConfiguracion(t);
  const antes = await leerConfiguracion(t);
  await transaccion(t.pool, async (con) => {
    for (const [k, v] of Object.entries(nuevos)) await ejecutar(con, 'INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [k, v]);
    await bitacora(con, actor, { accion: 'configuracion_editada', entidad: 'configuracion', antes: Object.fromEntries(Object.keys(nuevos).map((k) => [k, antes[k]])), despues: nuevos });
  });
  // La zona horaria también la conoce la plataforma (la usa para mostrar horas al entrar).
  if (nuevos['zona_horaria']) await ejecutar(ctx.pool, 'UPDATE empresas SET zona_horaria = ? WHERE id = ?', [nuevos['zona_horaria'], t.empresa.id]);
  return leerConfiguracion(t);
}

export async function listarBitacora(t: TallerReq, f: { pagina: number; porPagina: number; accion?: string; entidad?: string; usuario_id?: number }) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (f.accion) {
    donde.push('b.accion = ?');
    params.push(f.accion);
  }
  if (f.entidad) {
    donde.push('b.entidad = ?');
    params.push(f.entidad);
  }
  if (f.usuario_id) {
    donde.push('b.usuario_id = ?');
    params.push(f.usuario_id);
  }
  const condicion = donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : '';
  const total = await filas<{ n: number }>(t.pool, `SELECT COUNT(*) AS n FROM bitacora b ${condicion}`, params);
  const registros = await filas(
    t.pool,
    `SELECT b.id, b.created_at, b.accion, b.entidad, b.entidad_id, b.motivo, b.ip, c.nombre_completo AS usuario
       FROM bitacora b LEFT JOIN usuarios u ON u.id = b.usuario_id LEFT JOIN colaboradores c ON c.id = u.colaborador_id
       ${condicion} ORDER BY b.id DESC LIMIT ? OFFSET ?`,
    [...params, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return { total: Number(total[0]?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros };
}
