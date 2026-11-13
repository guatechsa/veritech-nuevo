import { ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorConflicto, ErrorValidacion } from '../errores';
import { POLITICA } from '../cobro/politica';
import { Contexto, ahoraDe } from '../plataforma/contexto';
import { crearToken, huellaDe } from '../utils/tokens';
import { reglasIncumplidas, hashearContrasena } from '../utils/clave';
import { Entorno } from '../config/entorno';
import { urlBaseDeEmpresa } from '../utils/direccion';
import { exigirSlugValido, limpiarSlug, motivoSlugInvalido, subdominioDe } from '../utils/slug';
import { normalizarCampo } from '../utils/texto';

/** Versión de los Términos y la Privacidad que se aceptan al registrarse. Si cambia en guatech.lat/legal, se sube aquí. */
export const VERSION_LEGAL_VIGENTE = '1.0';

const MENSAJE_NO_DISPONIBLE = 'Ese nombre en la dirección no está disponible. Elija otro.';

export interface PlanPublico {
  codigo: string;
  nombre: string;
  precio_mensual: number;
  max_usuarios: number | null;
  max_sucursales: number | null;
  modulos: string[];
  cobro_disponible: boolean;
}

/** Los niveles que ve quien se registra (sin identificadores internos de PayPal). */
export async function listarPlanesPublicos(ctx: Contexto): Promise<PlanPublico[]> {
  const planes = await filas<{ id: number; codigo: string; nombre: string; precio_mensual: number; max_usuarios: number | null; max_sucursales: number | null; paypal_plan_prueba: string | null }>(
    ctx.pool,
    'SELECT id, codigo, nombre, precio_mensual, max_usuarios, max_sucursales, paypal_plan_prueba FROM planes WHERE activo = 1 ORDER BY precio_mensual'
  );
  const modulos = await filas<{ plan_id: number; nombre: string }>(
    ctx.pool,
    'SELECT pm.plan_id, m.nombre FROM plan_modulos pm JOIN modulos m ON m.codigo = pm.modulo_codigo ORDER BY m.orden'
  );
  return planes.map((p) => ({
    codigo: p.codigo,
    nombre: p.nombre,
    precio_mensual: Number(p.precio_mensual),
    max_usuarios: p.max_usuarios,
    max_sucursales: p.max_sucursales,
    modulos: modulos.filter((m) => m.plan_id === p.id).map((m) => m.nombre),
    cobro_disponible: p.paypal_plan_prueba !== null && ctx.pagos !== undefined,
  }));
}

async function vencerAltasViejas(ctx: Contexto, ahora: Date): Promise<void> {
  await ejecutar(ctx.pool, "UPDATE altas_pendientes SET estado = 'vencida', contrasena_hash = NULL WHERE estado = 'emitida' AND vence_en <= ?", [ahora]);
}

/** ¿Se puede usar este nombre? Responde lo mismo si está reservado o si ya lo tiene un taller. */
export async function slugDisponible(ctx: Contexto, slug: string): Promise<boolean> {
  const limpio = limpiarSlug(slug);
  if (motivoSlugInvalido(limpio)) return false;
  await vencerAltasViejas(ctx, ahoraDe(ctx));
  const ocupado = await una(
    ctx.pool,
    `SELECT 1 AS x FROM subdominios_reservados WHERE slug = ?
     UNION ALL SELECT 1 FROM empresas WHERE slug = ? AND estado <> 'cerrada'
     UNION ALL SELECT 1 FROM altas_pendientes WHERE slug_reservado = ?
     LIMIT 1`,
    [limpio, limpio, limpio]
  );
  return ocupado === null;
}

export interface DatosAlta {
  nombre_taller: string;
  slug: string;
  admin_nombre: string;
  admin_correo: string;
  contrasena: string;
  plan_codigo: string;
  version_legal: string;
  acepta_terminos: boolean;
}

export interface PaseEmitido {
  pase: string;
  /** Plan de PayPal que el navegador debe suscribir y valor que debe poner en `custom_id`. */
  paypal_plan_id: string;
  custom_id: string;
  vence_en: Date;
}

/** Paso 1 del registro: valida todo, reserva el nombre y entrega el pase (48 horas). Todavía no se crea nada. */
export async function iniciarAlta(ctx: Contexto, datos: DatosAlta, origen: { ip: string }): Promise<PaseEmitido> {
  if (!datos.acepta_terminos) throw new ErrorValidacion('Debe aceptar los Términos y la Política de Privacidad para registrarse');
  if (datos.version_legal !== VERSION_LEGAL_VIGENTE) throw new ErrorValidacion('Los Términos cambiaron: recargue la página y vuelva a aceptarlos');
  const slug = exigirSlugValido(datos.slug);
  const incumplidas = reglasIncumplidas(datos.contrasena);
  if (incumplidas.length > 0) throw new ErrorValidacion(`La contraseña debe tener: ${incumplidas.join('; ').toLowerCase()}`);
  const nombreTaller = normalizarCampo('texto', datos.nombre_taller);
  const adminNombre = normalizarCampo('texto', datos.admin_nombre);
  const adminCorreo = normalizarCampo('correo', datos.admin_correo);
  if (!nombreTaller || nombreTaller.length < 3 || !adminNombre || !adminCorreo) throw new ErrorValidacion('Faltan datos del taller o del administrador');

  const plan = await una<{ id: number; paypal_plan_prueba: string | null }>(ctx.pool, 'SELECT id, paypal_plan_prueba FROM planes WHERE codigo = ? AND activo = 1', [datos.plan_codigo.toUpperCase()]);
  if (!plan) throw new ErrorValidacion('El plan elegido no existe');
  if (!plan.paypal_plan_prueba || !ctx.pagos) throw new ErrorApp(503, 'COBRO_NO_DISPONIBLE', 'El registro de este plan todavía no está disponible. Intente más tarde.');

  const ahora = ahoraDe(ctx);
  const { token, huella } = crearToken();
  const venceEn = new Date(ahora.getTime() + POLITICA.horasVigenciaPase * 3600 * 1000);
  const hash = await hashearContrasena(datos.contrasena);

  await transaccion(ctx.pool, async (con) => {
    await vencerAltasViejas(ctx, ahora);
    const tomada = await una(
      con,
      `SELECT 1 AS x FROM subdominios_reservados WHERE slug = ?
       UNION ALL SELECT 1 FROM empresas WHERE slug = ? AND estado <> 'cerrada' LIMIT 1`,
      [slug, slug]
    );
    if (tomada) throw new ErrorConflicto(MENSAJE_NO_DISPONIBLE);
    try {
      await ejecutar(
        con,
        `INSERT INTO altas_pendientes (pase_hash, slug, nombre_taller, admin_nombre, admin_correo, contrasena_hash, plan_id, version_legal, ip, vence_en)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [huella, slug, nombreTaller, adminNombre, adminCorreo, hash, plan.id, datos.version_legal, origen.ip, venceEn]
      );
    } catch (error) {
      if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErrorConflicto(MENSAJE_NO_DISPONIBLE);
      throw error;
    }
  });

  return { pase: token, paypal_plan_id: plan.paypal_plan_prueba, custom_id: huella.slice(0, 32), vence_en: venceEn };
}

export type EstadoRegistro = 'esperando_pago' | 'creando' | 'lista' | 'error' | 'vencida';

export interface EstadoAltaPublico {
  estado: EstadoRegistro;
  altaId?: number;
  subdominio?: string;
  url?: string;
}

function publico(alta: { id: number; estado: string; slug: string; empresa_id: number | null }, entorno: Pick<Entorno, 'DOMINIO_TALLERES' | 'TALLER_POR_ENCABEZADO' | 'URL_PANEL'>): EstadoAltaPublico {
  switch (alta.estado) {
    case 'emitida':
      return { estado: 'esperando_pago' };
    case 'aprobada':
      return { estado: 'creando', altaId: alta.id };
    case 'usada': {
      const sub = subdominioDe(alta.slug, entorno.DOMINIO_TALLERES);
      return { estado: 'lista', subdominio: sub, url: urlBaseDeEmpresa(entorno, { slug: alta.slug, subdominio: sub }) };
    }
    case 'error':
      return { estado: 'error' };
    default:
      return { estado: 'vencida' };
  }
}

async function altaPorPase(ctx: Contexto, pase: string) {
  if (!/^[a-f0-9]{64}$/.test(pase)) throw new ErrorValidacion('El pase no es válido');
  const alta = await una<{ id: number; estado: string; slug: string; empresa_id: number | null; plan_id: number; vence_en: Date; paypal_suscripcion_id: string | null }>(
    ctx.pool,
    'SELECT id, estado, slug, empresa_id, plan_id, vence_en, paypal_suscripcion_id FROM altas_pendientes WHERE pase_hash = ?',
    [huellaDe(pase)]
  );
  if (!alta) throw new ErrorApp(404, 'PASE_DESCONOCIDO', 'No encontramos ese registro. Empiece de nuevo.');
  return alta;
}

/** Paso 2: PayPal ya aprobó la suscripción. Se comprueba contra PayPal y recién entonces el alta pasa a "aprobada". */
export async function confirmarAlta(ctx: Contexto, datos: { pase: string; suscripcionId: string }): Promise<EstadoAltaPublico> {
  if (!/^[A-Za-z0-9_-]{3,64}$/.test(datos.suscripcionId)) throw new ErrorValidacion('La suscripción no es válida');
  const alta = await altaPorPase(ctx, datos.pase);
  if (alta.estado !== 'emitida') return publico(alta, ctx.entorno); // repetir el paso 2 no cambia nada
  const ahora = ahoraDe(ctx);
  if (alta.vence_en <= ahora) throw new ErrorApp(410, 'PASE_VENCIDO', 'El registro venció. Empiece de nuevo.');
  if (!ctx.pagos) throw new ErrorApp(503, 'COBRO_APAGADO', 'El cobro con PayPal no está disponible');

  const plan = await una<{ paypal_plan_prueba: string | null }>(ctx.pool, 'SELECT paypal_plan_prueba FROM planes WHERE id = ?', [alta.plan_id]);
  const suscripcion = await ctx.pagos.obtenerSuscripcion(datos.suscripcionId).catch(() => {
    throw new ErrorApp(502, 'PAYPAL_NO_RESPONDE', 'No pudimos consultar a PayPal. Su pago no se perdió: intente de nuevo en unos minutos.');
  });
  if (!suscripcion) throw new ErrorValidacion('PayPal no reconoce esa suscripción');
  if (suscripcion.estado !== 'ACTIVE' && suscripcion.estado !== 'APPROVED') throw new ErrorValidacion('La suscripción todavía no está aprobada en PayPal');
  if (suscripcion.planId !== plan?.paypal_plan_prueba) throw new ErrorValidacion('La suscripción no corresponde al plan elegido');
  const huella = huellaDe(datos.pase);
  if (suscripcion.customId !== huella.slice(0, 32)) throw new ErrorValidacion('La suscripción no pertenece a este registro');

  try {
    const r = await ejecutar(
      ctx.pool,
      "UPDATE altas_pendientes SET estado = 'aprobada', paypal_suscripcion_id = ?, aprobada_en = ? WHERE id = ? AND estado = 'emitida'",
      [datos.suscripcionId, ahora, alta.id]
    );
    if (r.affectedRows !== 1) return publico((await altaPorPase(ctx, datos.pase)), ctx.entorno);
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_DUP_ENTRY') throw new ErrorConflicto('Esa suscripción ya se usó en otro registro');
    throw error;
  }
  return { estado: 'creando', altaId: alta.id };
}

export async function estadoAlta(ctx: Contexto, pase: string): Promise<EstadoAltaPublico> {
  const alta = await altaPorPase(ctx, pase);
  if (alta.estado === 'emitida' && alta.vence_en <= ahoraDe(ctx)) return { estado: 'vencida' };
  const e = publico(alta, ctx.entorno);
  return { estado: e.estado, ...(e.subdominio ? { subdominio: e.subdominio, url: e.url } : {}) };
}
