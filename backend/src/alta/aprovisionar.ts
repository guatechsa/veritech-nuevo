import mysql, { Connection } from 'mysql2/promise';
import path from 'node:path';
import { POLITICA, sumarDias } from '../cobro/politica';
import { crearBase } from '../db/bases';
import { opcionesBase } from '../db/conexion';
import { ejecutar, transaccion, una } from '../db/consulta';
import { aplicarMigraciones } from '../db/migrador';
import { ErrorApp } from '../errores';
import { registrarAuditoria } from '../plataforma/auditoria';
import { ahoraDe, configBdDe, Contexto } from '../plataforma/contexto';
import { nombreBdDeSlug, subdominioDe } from '../utils/slug';
import { correoAltaFallida } from '../correos/ciclo-vida';
import { encolarCorreo } from '../correos/cola';

export const CARPETA_TALLER_POR_DEFECTO = path.join(__dirname, '..', '..', '..', 'database', 'taller');

interface FilaAlta {
  id: number;
  slug: string;
  nombre_taller: string;
  admin_nombre: string;
  admin_correo: string;
  contrasena_hash: string | null;
  plan_id: number;
  version_legal: string;
  ip: string | null;
  paypal_suscripcion_id: string | null;
  estado: 'emitida' | 'aprobada' | 'usada' | 'vencida' | 'error';
  empresa_id: number | null;
  intentos: number;
  created_at: Date;
}

export interface ResultadoAlta {
  empresaId: number;
  subdominio: string;
  yaExistia: boolean;
}

/**
 * Crea un taller de punta a punta: empresa, base de datos propia, migraciones, administrador inicial, módulos del plan
 * y acceso por correo. Se puede repetir las veces que haga falta: cada paso comprueba antes si ya está hecho, así un
 * fallo a la mitad se reanuda en vez de duplicar o dejar basura. Dos ejecuciones a la vez no se pisan (bloqueo por alta).
 */
export async function aprovisionarAlta(ctx: Contexto, altaId: number): Promise<ResultadoAlta> {
  const bloqueo = await ctx.pool.getConnection();
  const nombreBloqueo = `vtn_alta_${altaId}`;
  try {
    const [r] = await bloqueo.query<Array<{ ok: number } & mysql.RowDataPacket>>('SELECT GET_LOCK(?, 0) AS ok', [nombreBloqueo]);
    if (r[0]?.ok !== 1) throw new ErrorApp(409, 'ALTA_EN_CURSO', 'Esta alta ya se está procesando');
    try {
      return await ejecutarAlta(ctx, altaId);
    } finally {
      await bloqueo.query('SELECT RELEASE_LOCK(?)', [nombreBloqueo]);
    }
  } finally {
    bloqueo.release();
  }
}

async function ejecutarAlta(ctx: Contexto, altaId: number): Promise<ResultadoAlta> {
  const ahora = ahoraDe(ctx);
  const alta = await una<FilaAlta>(ctx.pool, 'SELECT * FROM altas_pendientes WHERE id = ?', [altaId]);
  if (!alta) throw new ErrorApp(404, 'NO_ENCONTRADO', 'Alta no encontrada');
  if (alta.estado === 'usada' && alta.empresa_id) {
    const e = await una<{ subdominio: string }>(ctx.pool, 'SELECT subdominio FROM empresas WHERE id = ?', [alta.empresa_id]);
    return { empresaId: alta.empresa_id, subdominio: e?.subdominio ?? '', yaExistia: true };
  }
  if (alta.estado !== 'aprobada' && alta.estado !== 'error') {
    throw new ErrorApp(409, 'ALTA_NO_APROBADA', `El alta está en estado «${alta.estado}»: solo se crea el taller de un alta aprobada`);
  }

  await ejecutar(ctx.pool, "UPDATE altas_pendientes SET intentos = intentos + 1, estado = 'aprobada' WHERE id = ?", [altaId]);
  try {
    const resultado = await construir(ctx, alta, ahora);
    return resultado;
  } catch (error) {
    const motivo = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const intentos = alta.intentos + 1;
    const agotado = intentos >= POLITICA.maximoIntentosAlta;
    await ejecutar(ctx.pool, 'UPDATE altas_pendientes SET error = ?, estado = ? WHERE id = ?', [motivo, agotado ? 'error' : 'aprobada', altaId]);
    if (agotado) {
      const c = correoAltaFallida({ nombreTaller: alta.nombre_taller, slug: alta.slug, correo: alta.admin_correo, suscripcion: alta.paypal_suscripcion_id ?? '(sin suscripción)', error: motivo });
      await encolarCorreo(ctx.pool, { tipo: c.tipo, destinatarios: [ctx.entorno.CORREO_ALERTAS], asunto: c.asunto, cuerpoHtml: c.cuerpoHtml, claveUnica: `alta_fallida:${altaId}:${intentos}` });
      await registrarAuditoria(ctx.pool, { usuarioId: null, accion: 'alta_fallida', empresaId: alta.empresa_id, descripcion: `No se pudo crear el taller ${alta.slug}: ${motivo}`.slice(0, 500) });
    }
    throw error;
  }
}

async function construir(ctx: Contexto, alta: FilaAlta, ahora: Date): Promise<ResultadoAlta> {
  if (!alta.contrasena_hash) throw new Error('El alta no conserva la contraseña del administrador');
  const plan = await una<{ id: number; precio_mensual: number }>(ctx.pool, 'SELECT id, precio_mensual FROM planes WHERE id = ?', [alta.plan_id]);
  if (!plan) throw new Error('El plan del alta ya no existe');

  const nombreBd = nombreBdDeSlug(ctx.entorno.PREFIJO_BD_TALLER, alta.slug);
  const subdominio = subdominioDe(alta.slug, ctx.entorno.DOMINIO_TALLERES);

  // 1. La empresa (si el intento anterior ya la creó, se reutiliza).
  let empresaId = alta.empresa_id;
  if (!empresaId) {
    const r = await ejecutar(
      ctx.pool,
      `INSERT INTO empresas (nombre, slug, nombre_bd, subdominio, estado, plan_id, cuota_mensual, paypal_suscripcion_id, contacto_nombre, contacto_correo,
                             version_legal_aceptada, legal_aceptada_en, legal_aceptada_ip, estado_desde)
       VALUES (?, ?, ?, ?, 'pendiente', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [alta.nombre_taller, alta.slug, nombreBd, subdominio, plan.id, plan.precio_mensual, alta.paypal_suscripcion_id, alta.admin_nombre, alta.admin_correo, alta.version_legal, alta.created_at, alta.ip, ahora]
    );
    empresaId = r.insertId;
    await ejecutar(ctx.pool, 'UPDATE altas_pendientes SET empresa_id = ? WHERE id = ?', [empresaId, alta.id]);
  }

  // 2. La base de datos del taller y su estructura.
  const config = configBdDe(ctx.entorno);
  await crearBase(config, nombreBd);
  await aplicarMigraciones(config, nombreBd, ctx.carpetaTaller ?? CARPETA_TALLER_POR_DEFECTO);

  // 3. El administrador inicial y la configuración básica, dentro del taller.
  const usuarioId = await sembrarTaller(ctx, nombreBd, alta);

  // 4. Todo lo de la plataforma queda en una sola transacción.
  await transaccion(ctx.pool, async (con) => {
    await ejecutar(con, 'DELETE FROM empresa_modulos WHERE empresa_id = ?', [empresaId]);
    await ejecutar(con, 'INSERT INTO empresa_modulos (empresa_id, modulo_codigo) SELECT ?, modulo_codigo FROM plan_modulos WHERE plan_id = ?', [empresaId, plan.id]);
    await ejecutar(
      con,
      `UPDATE empresas SET estado = 'prueba', prueba_hasta = ?, provisionada_en = ?, estado_desde = ? WHERE id = ? AND estado = 'pendiente'`,
      [sumarDias(ahora, POLITICA.diasPrueba), ahora, ahora, empresaId]
    );
    await ejecutar(
      con,
      `INSERT INTO directorio_acceso (correo, empresa_id, usuario_id, activo) VALUES (?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE usuario_id = VALUES(usuario_id), activo = 1`,
      [alta.admin_correo, empresaId, usuarioId]
    );
    await ejecutar(con, "UPDATE altas_pendientes SET estado = 'usada', contrasena_hash = NULL, error = NULL WHERE id = ?", [alta.id]);
    await registrarAuditoria(con, { usuarioId: null, accion: 'empresa_creada', empresaId, descripcion: `Se creó el taller ${alta.nombre_taller} (${subdominio}) desde el registro`, ip: alta.ip ?? undefined });
  });

  return { empresaId, subdominio, yaExistia: false };
}

/** Escribe en la base del taller el administrador, la sucursal principal y la configuración. Repetible. */
async function sembrarTaller(ctx: Contexto, nombreBd: string, alta: FilaAlta): Promise<number> {
  const con: Connection = await mysql.createConnection(opcionesBase(configBdDe(ctx.entorno), nombreBd));
  try {
    await con.query("SET time_zone = '+00:00'");
    await con.beginTransaction();
    try {
      const [existente] = await con.query<mysql.RowDataPacket[]>('SELECT u.id FROM usuarios u JOIN colaboradores c ON c.id = u.colaborador_id WHERE c.correo = ?', [alta.admin_correo]);
      if (existente[0]) {
        await con.commit();
        return Number(existente[0]['id']);
      }
      const [sucursal] = await con.query<mysql.RowDataPacket[]>('SELECT id FROM sucursales WHERE es_principal = 1 LIMIT 1');
      let sucursalId = sucursal[0] ? Number(sucursal[0]['id']) : undefined;
      if (!sucursalId) {
        const [r] = await con.query<mysql.ResultSetHeader>("INSERT INTO sucursales (nombre, es_principal) VALUES ('SUCURSAL PRINCIPAL', 1)");
        sucursalId = r.insertId;
      }
      const [col] = await con.query<mysql.ResultSetHeader>('INSERT INTO colaboradores (nombre_completo, correo, sucursal_id) VALUES (?, ?, ?)', [alta.admin_nombre, alta.admin_correo, sucursalId]);
      const [usu] = await con.query<mysql.ResultSetHeader>('INSERT INTO usuarios (colaborador_id, contrasena_hash) VALUES (?, ?)', [col.insertId, alta.contrasena_hash]);
      const [roles] = await con.query<mysql.RowDataPacket[]>("SELECT id FROM roles WHERE codigo = 'administrador'");
      if (!roles[0]) throw new Error('El taller no tiene el rol administrador (falló la migración base)');
      await con.query('INSERT INTO usuario_roles (usuario_id, rol_id) VALUES (?, ?)', [usu.insertId, roles[0]['id']]);
      const config: Array<[string, string]> = [
        ['nombre_empresa', alta.nombre_taller],
        ['zona_horaria', 'America/Guatemala'],
        ['moneda', 'GTQ'],
      ];
      for (const [clave, valor] of config) {
        await con.query('INSERT INTO configuracion (clave, valor) VALUES (?, ?) ON DUPLICATE KEY UPDATE valor = VALUES(valor)', [clave, valor]);
      }
      await con.query("INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, motivo) VALUES (?, 'taller_creado', 'usuarios', ?, 'ALTA DESDE EL REGISTRO')", [usu.insertId, usu.insertId]);
      await con.commit();
      return usu.insertId;
    } catch (error) {
      await con.rollback();
      throw error;
    }
  } finally {
    await con.end();
  }
}
