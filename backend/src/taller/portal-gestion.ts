import { ejecutar, filas } from '../db/consulta';
import { ErrorNoEncontrado } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { Actor, bitacora, TallerReq } from './comun';

/** Del lado del taller: quién tiene acceso al portal de un cliente y las sesiones abiertas (se pueden revocar). */
export async function sesionesDeCliente(ctx: Contexto, t: TallerReq, clienteId: number) {
  const contactos = await filas<{ id: number; nombre: string; correo: string | null; rol: string; acceso_todos_equipos: number; activo: number }>(
    t.pool,
    'SELECT id, nombre, correo, rol, acceso_todos_equipos, activo FROM contactos_cliente WHERE cliente_id = ? ORDER BY nombre',
    [clienteId]
  );
  const correos = [...new Set(contactos.map((c) => c.correo?.toLowerCase()).filter((c): c is string => !!c))];
  const ahora = ahoraDe(ctx);
  const sesiones = correos.length
    ? await filas<{ id: number; correo: string; creada_en: Date; ultima_actividad_en: Date; vence_en: Date; dispositivo: string | null; ip: string | null; revocada_en: Date | null }>(
        t.pool,
        `SELECT id, correo, creada_en, ultima_actividad_en, vence_en, dispositivo, ip, revocada_en FROM portal_sesiones WHERE correo IN (${correos.map(() => '?').join(',')}) ORDER BY id DESC LIMIT 30`,
        correos
      )
    : [];
  return {
    contactos: contactos.map((c) => ({ id: c.id, nombre: c.nombre, correo: c.correo, rol: c.rol, todos_los_equipos: c.acceso_todos_equipos === 1, activo: c.activo === 1, puede_entrar: c.activo === 1 && !!c.correo })),
    sesiones: sesiones.map((s) => ({ ...s, vigente: s.revocada_en === null && s.vence_en.getTime() > ahora.getTime() })),
  };
}

/** Cierra todas las sesiones abiertas de un correo de contacto de este cliente. */
export async function revocarSesionesDeCorreo(ctx: Contexto, t: TallerReq, actor: Actor, clienteId: number, correoCrudo: string) {
  const correo = correoCrudo.trim().toLowerCase();
  const c = await filas(t.pool, 'SELECT id FROM contactos_cliente WHERE cliente_id = ? AND LOWER(correo) = ? LIMIT 1', [clienteId, correo]);
  if (c.length === 0) throw new ErrorNoEncontrado('Ese correo no es de un contacto de este cliente');
  const r = await ejecutar(t.pool, 'UPDATE portal_sesiones SET revocada_en = ?, revocada_por_id = ? WHERE correo = ? AND revocada_en IS NULL AND vence_en > ?', [ahoraDe(ctx), actor.usuarioId, correo, ahoraDe(ctx)]);
  await bitacora(t.pool, actor, { accion: 'portal_sesiones_revocadas', entidad: 'clientes', entidadId: clienteId, despues: { correo, sesiones: r.affectedRows } });
  return { revocadas: r.affectedRows };
}
