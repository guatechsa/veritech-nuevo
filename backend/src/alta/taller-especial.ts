import { aprovisionarAlta } from './aprovisionar';
import { ejecutar, una } from '../db/consulta';
import { ErrorValidacion } from '../errores';
import { registrarAuditoria } from '../plataforma/auditoria';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { contrasenaTemporal, hashearContrasena } from '../utils/clave';
import { crearToken } from '../utils/tokens';
import { normalizarCampo } from '../utils/texto';
import { exigirSlugValido } from '../utils/slug';

/**
 * Talleres que NO pasan por el registro con PayPal: de CORTESÍA (la empresa del socio, que no paga pero se respeta) y de DEMOSTRACIÓN (para mostrar el
 * sistema). Se crean con el mismo aprovisionamiento de siempre (base propia, migraciones, administrador, módulos del plan), y después quedan «activos» y sin
 * cobro: el ciclo de vida no los pasa por prueba, gracia, suspensión ni cierre, ni les manda avisos de pago.
 */
export type TipoDeTallerEspecial = 'cortesia' | 'demo';

export interface DatosTallerEspecial {
  slug: string;
  nombre: string;
  adminNombre: string;
  adminCorreo: string;
  planCodigo: string;
  tipo: TipoDeTallerEspecial;
}

export async function crearTallerEspecial(ctx: Contexto, d: DatosTallerEspecial): Promise<{ empresaId: number; subdominio: string; contrasenaTemporal: string }> {
  const slug = exigirSlugValido(d.slug);
  const nombre = normalizarCampo('texto', d.nombre);
  const adminNombre = normalizarCampo('texto', d.adminNombre);
  const adminCorreo = normalizarCampo('correo', d.adminCorreo);
  if (!nombre || nombre.length < 3 || !adminNombre || !adminCorreo) throw new ErrorValidacion('Faltan datos del taller o del administrador');
  const plan = await una<{ id: number }>(ctx.pool, 'SELECT id FROM planes WHERE codigo = ?', [d.planCodigo.toUpperCase()]);
  if (!plan) throw new ErrorValidacion(`El plan «${d.planCodigo}» no existe`);
  if (await una(ctx.pool, "SELECT 1 AS x FROM empresas WHERE slug = ? AND estado <> 'cerrada'", [slug])) throw new ErrorValidacion('Ya existe un taller con ese nombre de subdominio');

  const temporal = contrasenaTemporal();
  const { huella } = crearToken();
  const ahora = ahoraDe(ctx);
  const alta = await ejecutar(
    ctx.pool,
    `INSERT INTO altas_pendientes (pase_hash, slug, nombre_taller, admin_nombre, admin_correo, contrasena_hash, plan_id, version_legal, ip, estado, vence_en)
     VALUES (?, ?, ?, ?, ?, ?, ?, '1.0', NULL, 'aprobada', ?)`,
    [huella, slug, nombre, adminNombre, adminCorreo, await hashearContrasena(temporal), plan.id, new Date(ahora.getTime() + 3600_000)]
  );
  const r = await aprovisionarAlta(ctx, alta.insertId);
  await ejecutar(
    ctx.pool,
    `UPDATE empresas SET estado = 'activa', prueba_hasta = NULL, cobro_por_contrato = 1, es_demo = ?, cuota_mensual = NULL, estado_desde = ? WHERE id = ?`,
    [d.tipo === 'demo' ? 1 : 0, ahora, r.empresaId]
  );
  await registrarAuditoria(ctx.pool, {
    usuarioId: null,
    accion: 'empresa_creada_especial',
    empresaId: r.empresaId,
    descripcion: `Taller ${d.tipo === 'demo' ? 'de demostración' : 'de cortesía'} creado desde la línea de comandos (sin cobro)`,
  });
  return { empresaId: r.empresaId, subdominio: r.subdominio, contrasenaTemporal: temporal };
}
