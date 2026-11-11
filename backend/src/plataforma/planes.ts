import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { normalizarCampo } from '../utils/texto';
import { registrarAuditoria } from './auditoria';
import { Contexto, UsuarioPlataforma } from './contexto';

interface Origen {
  ip: string;
  userAgent: string;
}

export function listarModulos(ctx: Contexto) {
  return filas<{ codigo: string; nombre: string; orden: number }>(ctx.pool, 'SELECT codigo, nombre, orden FROM modulos ORDER BY orden');
}

export async function listarPlanes(ctx: Contexto) {
  const planes = await filas<{ id: number; codigo: string; nombre: string; precio_mensual: number; max_usuarios: number | null; max_sucursales: number | null; activo: number }>(
    ctx.pool,
    `SELECT p.id, p.codigo, p.nombre, p.precio_mensual, p.max_usuarios, p.max_sucursales, p.activo,
            (SELECT COUNT(*) FROM empresas e WHERE e.plan_id = p.id) AS empresas
       FROM planes p ORDER BY p.precio_mensual`
  );
  const relacion = await filas<{ plan_id: number; modulo_codigo: string }>(ctx.pool, 'SELECT plan_id, modulo_codigo FROM plan_modulos');
  return planes.map((p) => ({ ...p, modulos: relacion.filter((r) => r.plan_id === p.id).map((r) => r.modulo_codigo) }));
}

export async function actualizarPlan(
  ctx: Contexto,
  actor: UsuarioPlataforma,
  id: number,
  cambios: { nombre?: string; precio_mensual?: number; max_usuarios?: number | null; max_sucursales?: number | null; activo?: boolean; modulos?: string[] },
  origen: Origen
): Promise<void> {
  const plan = await una<{ codigo: string }>(ctx.pool, 'SELECT codigo FROM planes WHERE id = ?', [id]);
  if (!plan) throw new ErrorNoEncontrado('Plan no encontrado');

  if (cambios.modulos !== undefined) {
    const validos = new Set((await listarModulos(ctx)).map((m) => m.codigo));
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
  if (cambios.precio_mensual !== undefined) poner('precio_mensual', cambios.precio_mensual, `precio ${cambios.precio_mensual}`);
  if (cambios.max_usuarios !== undefined) poner('max_usuarios', cambios.max_usuarios, `usuarios ${cambios.max_usuarios ?? 'sin límite'}`);
  if (cambios.max_sucursales !== undefined) poner('max_sucursales', cambios.max_sucursales, `sucursales ${cambios.max_sucursales ?? 'sin límite'}`);
  if (cambios.activo !== undefined) poner('activo', cambios.activo ? 1 : 0, cambios.activo ? 'activado' : 'desactivado');
  if (cambios.modulos !== undefined) detalle.push(`módulos (${cambios.modulos.length})`);
  if (detalle.length === 0) return;

  await transaccion(ctx.pool, async (con) => {
    if (sets.length > 0) await ejecutar(con, `UPDATE planes SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
    if (cambios.modulos !== undefined) {
      await ejecutar(con, 'DELETE FROM plan_modulos WHERE plan_id = ?', [id]);
      for (const modulo of cambios.modulos) await ejecutar(con, 'INSERT INTO plan_modulos (plan_id, modulo_codigo) VALUES (?, ?)', [id, modulo]);
    }
    await registrarAuditoria(con, { usuarioId: actor.id, accion: 'plan_editado', descripcion: `Editó el plan ${plan.codigo}: ${detalle.join(', ')}`, ...origen });
  });
}
