import { EstadoEmpresa } from '../cobro/estado';
import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorConflicto, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { normalizarCampo } from '../utils/texto';
import { registrarAuditoria } from './auditoria';
import { Contexto, UsuarioPlataforma } from './contexto';

interface Origen {
  ip: string;
  userAgent: string;
}

export type { EstadoEmpresa } from '../cobro/estado';

/** Estados con contrato vigente (cuentan como "clientes activos" en el panel). */
export const ESTADOS_ACTIVOS: EstadoEmpresa[] = ['activa', 'pago_fallido', 'cancelada_con_acceso'];
export const ESTADOS_EN_PRUEBA: EstadoEmpresa[] = ['pendiente', 'prueba'];
export const ESTADOS_SUSPENDIDOS: EstadoEmpresa[] = ['suspendida', 'solo_exportar', 'cerrada'];

export async function listarEmpresas(ctx: Contexto, filtro: { estado?: EstadoEmpresa; buscar?: string } = {}) {
  const donde: string[] = [];
  const parametros: unknown[] = [];
  if (filtro.estado) {
    donde.push('e.estado = ?');
    parametros.push(filtro.estado);
  }
  if (filtro.buscar) {
    donde.push('(e.nombre LIKE ? OR e.slug LIKE ? OR e.contacto_correo LIKE ?)');
    const patron = `%${filtro.buscar.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    parametros.push(patron, patron, patron);
  }
  const condicion = donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : '';
  const empresas = await filas(
    ctx.pool,
    `SELECT e.id, e.nombre, e.slug, e.subdominio, e.estado, e.cuota_mensual, e.cobro_por_contrato, e.es_demo,
            e.contacto_nombre, e.contacto_correo, e.provisionada_en, e.created_at,
            p.id AS plan_id, p.nombre AS plan_nombre,
            (SELECT COUNT(*) FROM empresa_modulos m WHERE m.empresa_id = e.id) AS modulos_habilitados
       FROM empresas e LEFT JOIN planes p ON p.id = e.plan_id
       ${condicion}
      ORDER BY e.nombre`,
    parametros
  );
  const totalModulos = await una<{ n: number }>(ctx.pool, 'SELECT COUNT(*) AS n FROM modulos');
  const suma = await una<{ total: number | null }>(
    ctx.pool,
    `SELECT SUM(cuota_mensual) AS total FROM empresas WHERE estado IN (${ESTADOS_ACTIVOS.map(() => '?').join(',')})`,
    ESTADOS_ACTIVOS
  );
  return { empresas, total_modulos: Number(totalModulos?.n ?? 0), cuota_total_activas: suma?.total === null || suma?.total === undefined ? null : Number(suma.total) };
}

export async function obtenerEmpresa(ctx: Contexto, id: number) {
  const empresa = await una(ctx.pool, 'SELECT * FROM empresas WHERE id = ?', [id]);
  if (!empresa) throw new ErrorNoEncontrado('Empresa no encontrada');
  const modulos = await filas<{ modulo_codigo: string }>(ctx.pool, 'SELECT modulo_codigo FROM empresa_modulos WHERE empresa_id = ? ORDER BY modulo_codigo', [id]);
  return { ...empresa, modulos: modulos.map((m) => m.modulo_codigo) };
}

export async function actualizarEmpresa(
  ctx: Contexto,
  actor: UsuarioPlataforma,
  id: number,
  cambios: {
    nombre?: string;
    contacto_nombre?: string | null;
    contacto_correo?: string | null;
    plan_id?: number | null;
    cuota_mensual?: number | null;
    cobro_por_contrato?: boolean;
    modulos?: string[];
  },
  origen: Origen
): Promise<void> {
  const actual = await una<{ nombre: string }>(ctx.pool, 'SELECT nombre FROM empresas WHERE id = ?', [id]);
  if (!actual) throw new ErrorNoEncontrado('Empresa no encontrada');

  if (cambios.plan_id !== undefined && cambios.plan_id !== null) {
    const plan = await una(ctx.pool, 'SELECT id FROM planes WHERE id = ? AND activo = 1', [cambios.plan_id]);
    if (!plan) throw new ErrorValidacion('El plan elegido no existe o está desactivado');
  }
  if (cambios.modulos !== undefined) {
    const validos = new Set((await filas<{ codigo: string }>(ctx.pool, 'SELECT codigo FROM modulos')).map((m) => m.codigo));
    const invalidos = cambios.modulos.filter((m) => !validos.has(m));
    if (invalidos.length > 0) throw new ErrorValidacion(`Módulos desconocidos: ${invalidos.join(', ')}`);
  }

  const sets: string[] = [];
  const valores: unknown[] = [];
  const detalle: string[] = [];
  const poner = (columna: string, valor: unknown, etiqueta: string): void => {
    sets.push(`${columna} = ?`);
    valores.push(valor);
    detalle.push(etiqueta);
  };
  if (cambios.nombre !== undefined) poner('nombre', normalizarCampo('texto', cambios.nombre), 'nombre');
  if (cambios.contacto_nombre !== undefined) poner('contacto_nombre', normalizarCampo('texto', cambios.contacto_nombre), 'contacto');
  if (cambios.contacto_correo !== undefined) poner('contacto_correo', normalizarCampo('correo', cambios.contacto_correo), 'correo del contacto');
  if (cambios.plan_id !== undefined) poner('plan_id', cambios.plan_id, 'plan');
  if (cambios.cuota_mensual !== undefined) poner('cuota_mensual', cambios.cuota_mensual, `cuota ${cambios.cuota_mensual ?? '—'}`);
  if (cambios.cobro_por_contrato !== undefined) poner('cobro_por_contrato', cambios.cobro_por_contrato ? 1 : 0, `cobro por contrato ${cambios.cobro_por_contrato ? 'sí' : 'no'}`);
  if (cambios.modulos !== undefined) detalle.push(`módulos (${cambios.modulos.length})`);
  if (detalle.length === 0) return;

  await transaccion(ctx.pool, async (con) => {
    if (sets.length > 0) await ejecutar(con, `UPDATE empresas SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
    if (cambios.modulos !== undefined) {
      await ejecutar(con, 'DELETE FROM empresa_modulos WHERE empresa_id = ?', [id]);
      for (const modulo of cambios.modulos) await ejecutar(con, 'INSERT INTO empresa_modulos (empresa_id, modulo_codigo) VALUES (?, ?)', [id, modulo]);
    }
    await registrarAuditoria(con, { usuarioId: actor.id, accion: 'empresa_editada', empresaId: id, descripcion: `Editó a ${actual.nombre}: ${detalle.join(', ')}`, ...origen });
  });
}

const SUSPENDIBLES: EstadoEmpresa[] = ['prueba', 'activa', 'pago_fallido', 'cancelada_con_acceso'];

/** Suspensión y reactivación manuales. Los demás cambios de estado los hace el motor de cobro (Fase 2). */
export async function cambiarEstadoEmpresa(
  ctx: Contexto,
  actor: UsuarioPlataforma,
  id: number,
  nuevo: 'activa' | 'suspendida',
  motivo: string | undefined,
  origen: Origen
): Promise<void> {
  await transaccion(ctx.pool, async (con) => {
    const empresa = await una<{ nombre: string; estado: EstadoEmpresa }>(con, 'SELECT nombre, estado FROM empresas WHERE id = ? FOR UPDATE', [id]);
    if (!empresa) throw new ErrorNoEncontrado('Empresa no encontrada');
    if (nuevo === 'suspendida' && !SUSPENDIBLES.includes(empresa.estado)) {
      throw new ErrorConflicto(`Una empresa en estado «${empresa.estado}» no se puede suspender`);
    }
    if (nuevo === 'activa' && empresa.estado !== 'suspendida') {
      throw new ErrorConflicto('Solo se puede reactivar una empresa suspendida');
    }
    if (nuevo === 'suspendida' && !motivo) throw new ErrorValidacion('Para suspender una empresa escriba el motivo');
    await ejecutar(con, 'UPDATE empresas SET estado = ?, suspension_origen = ?, estado_desde = UTC_TIMESTAMP(), gracia_hasta = NULL WHERE id = ?', [
      nuevo,
      nuevo === 'suspendida' ? 'manual' : null,
      id,
    ]);
    await ejecutar(
      con,
      `INSERT INTO suscripcion_eventos (empresa_id, tipo, estado_antes, estado_despues, origen, usuario_plataforma_id, detalle, procesado_en)
       VALUES (?, ?, ?, ?, 'manual', ?, ?, UTC_TIMESTAMP())`,
      [id, nuevo === 'suspendida' ? 'suspension_manual' : 'reactivacion_manual', empresa.estado, nuevo, actor.id, (motivo ?? 'sin motivo').slice(0, 500)]
    );
    await registrarAuditoria(con, {
      usuarioId: actor.id,
      accion: nuevo === 'suspendida' ? 'empresa_suspendida' : 'empresa_activada',
      empresaId: id,
      descripcion: `${nuevo === 'suspendida' ? 'Suspendió' : 'Reactivó'} a ${empresa.nombre} (estaba ${empresa.estado})${motivo ? `. Motivo: ${motivo}` : ''}`,
      ...origen,
    });
  });
}

/** Ficha completa de una empresa para el panel: sus datos, pagos recientes, eventos de la suscripción y su alta de origen. */
export async function detalleEmpresa(ctx: Contexto, id: number) {
  const empresa = await obtenerEmpresa(ctx, id);
  const pagos = await filas(ctx.pool, 'SELECT paypal_transaccion_id, fecha, monto, moneda, estado FROM pagos WHERE empresa_id = ? ORDER BY fecha DESC LIMIT 20', [id]);
  const eventos = await filas(
    ctx.pool,
    `SELECT e.id, e.created_at, e.tipo, e.estado_antes, e.estado_despues, e.origen, e.detalle, u.nombre AS usuario_nombre
       FROM suscripcion_eventos e LEFT JOIN usuarios_plataforma u ON u.id = e.usuario_plataforma_id
      WHERE e.empresa_id = ? ORDER BY e.id DESC LIMIT 30`,
    [id]
  );
  const alta = await una(ctx.pool, 'SELECT id, estado, intentos, error, aprobada_en FROM altas_pendientes WHERE empresa_id = ? ORDER BY id DESC LIMIT 1', [id]);
  return { empresa, pagos, eventos, alta };
}

/** Altas aprobadas (el cliente ya pagó) cuyo taller todavía no existe: lo que soporte debe vigilar. */
export async function listarAltasPorAtender(ctx: Contexto) {
  return filas(
    ctx.pool,
    `SELECT a.id, a.slug, a.nombre_taller, a.admin_correo, a.estado, a.intentos, a.error, a.aprobada_en, a.empresa_id
       FROM altas_pendientes a WHERE a.estado IN ('aprobada','error') ORDER BY a.id DESC LIMIT 50`
  );
}
