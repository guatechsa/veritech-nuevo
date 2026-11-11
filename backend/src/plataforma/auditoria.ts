import { Ejecutor, ejecutar, filas, una } from '../db/consulta';

export interface EventoAuditoria {
  usuarioId: number | null;
  accion: string;
  empresaId?: number | null;
  descripcion: string;
  ip?: string;
  userAgent?: string;
}

/** Registra una acción administrativa. Dentro de una transacción, la acción y su rastro se guardan o se deshacen juntos. */
export async function registrarAuditoria(ejecutor: Ejecutor, evento: EventoAuditoria): Promise<void> {
  await ejecutar(
    ejecutor,
    `INSERT INTO auditoria_plataforma (usuario_plataforma_id, accion, empresa_id, descripcion, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [evento.usuarioId, evento.accion.slice(0, 60), evento.empresaId ?? null, evento.descripcion.slice(0, 500), evento.ip ?? null, evento.userAgent ?? null]
  );
}

export interface FiltroAuditoria {
  pagina: number;
  porPagina: number;
  accion?: string;
  usuarioId?: number;
  empresaId?: number;
}

export async function listarAuditoria(ejecutor: Ejecutor, f: FiltroAuditoria) {
  const donde: string[] = [];
  const parametros: unknown[] = [];
  if (f.accion) {
    donde.push('a.accion = ?');
    parametros.push(f.accion);
  }
  if (f.usuarioId) {
    donde.push('a.usuario_plataforma_id = ?');
    parametros.push(f.usuarioId);
  }
  if (f.empresaId) {
    donde.push('a.empresa_id = ?');
    parametros.push(f.empresaId);
  }
  const condicion = donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : '';
  const total = await una<{ n: number }>(ejecutor, `SELECT COUNT(*) AS n FROM auditoria_plataforma a ${condicion}`, parametros);
  const registros = await filas(
    ejecutor,
    `SELECT a.id, a.created_at, a.accion, a.descripcion, a.ip, a.empresa_id, a.usuario_plataforma_id,
            u.nombre AS usuario_nombre, u.correo AS usuario_correo
       FROM auditoria_plataforma a
       LEFT JOIN usuarios_plataforma u ON u.id = a.usuario_plataforma_id
       ${condicion}
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?`,
    [...parametros, f.porPagina, (f.pagina - 1) * f.porPagina]
  );
  return { total: Number(total?.n ?? 0), pagina: f.pagina, porPagina: f.porPagina, registros };
}
