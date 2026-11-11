import { PoolConnection } from 'mysql2/promise';
import { Ejecutor, ejecutar, filas, transaccion, una } from '../db/consulta';
import { ErrorApp, ErrorNoEncontrado, ErrorValidacion } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { validarFechaRazonable } from '../utils/fechas';
import { normalizarCampo } from '../utils/texto';
import { Actor, bitacora, conflictoSiDuplicado, siguienteNumero, TallerReq } from './comun';
import { desactivarAccesoEnDirectorio, moverCorreoEnDirectorio } from './directorio';

export interface DatosColaborador {
  nombre_completo?: string;
  correo?: string | null;
  celular?: string | null;
  direccion?: string | null;
  dpi?: string | null;
  sucursal_id?: number | null;
  area_trabajo_id?: number | null;
  nivel_tecnico_id?: number | null;
  puestos?: number[];
}

/** DPI de Guatemala: 13 dígitos (se aceptan espacios y guiones al escribirlo). */
export function normalizarDpi(valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined || valor.trim() === '') return null;
  const limpio = valor.replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(limpio)) throw new ErrorValidacion('El DPI debe tener 13 dígitos');
  return limpio;
}

export interface FiltroColaboradores {
  buscar?: string;
  activo?: boolean;
  sucursal_id?: number;
  puesto_id?: number;
  con_usuario?: boolean;
}

export async function listarColaboradores(t: TallerReq, f: FiltroColaboradores = {}) {
  const donde: string[] = [];
  const params: unknown[] = [];
  if (f.activo !== undefined) {
    donde.push('c.activo = ?');
    params.push(f.activo ? 1 : 0);
  }
  if (f.sucursal_id) {
    donde.push('c.sucursal_id = ?');
    params.push(f.sucursal_id);
  }
  if (f.puesto_id) {
    donde.push('EXISTS (SELECT 1 FROM colaborador_puestos cp WHERE cp.colaborador_id = c.id AND cp.puesto_id = ?)');
    params.push(f.puesto_id);
  }
  if (f.con_usuario !== undefined) donde.push(f.con_usuario ? 'u.id IS NOT NULL' : 'u.id IS NULL');
  if (f.buscar) {
    const patron = `%${f.buscar.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
    donde.push('(c.nombre_completo LIKE ? OR c.correo LIKE ? OR c.codigo LIKE ? OR c.dpi LIKE ?)');
    params.push(patron, patron, patron, patron);
  }
  return filas(
    t.pool,
    `SELECT c.id, c.codigo, c.nombre_completo, c.correo, c.celular, c.dpi, c.sucursal_id, s.nombre AS sucursal, c.area_trabajo_id, a.nombre AS area,
            c.nivel_tecnico_id, n.nombre AS nivel, c.activo,
            (SELECT GROUP_CONCAT(p.nombre ORDER BY p.nombre SEPARATOR ', ') FROM colaborador_puestos cp JOIN puestos p ON p.id = cp.puesto_id WHERE cp.colaborador_id = c.id) AS puestos,
            u.id AS usuario_id, u.activo AS usuario_activo, u.ultimo_ingreso
       FROM colaboradores c
       LEFT JOIN sucursales s ON s.id = c.sucursal_id
       LEFT JOIN areas_trabajo a ON a.id = c.area_trabajo_id
       LEFT JOIN niveles_tecnico n ON n.id = c.nivel_tecnico_id
       LEFT JOIN usuarios u ON u.colaborador_id = c.id
       ${donde.length > 0 ? `WHERE ${donde.join(' AND ')}` : ''}
      ORDER BY c.nombre_completo`,
    params
  );
}

export async function obtenerColaborador(t: TallerReq, id: number, hoy: Date = new Date()) {
  const lista = await listarColaboradores(t, {});
  const base = lista.find((c) => c['id'] === id);
  if (!base) throw new ErrorNoEncontrado('No se encontró al colaborador');
  const detalle = await una(t.pool, 'SELECT direccion FROM colaboradores WHERE id = ?', [id]);
  const puestos = await filas<{ id: number; nombre: string; es_tecnico: number; es_operador: number }>(
    t.pool,
    'SELECT p.id, p.nombre, p.es_tecnico, p.es_operador FROM colaborador_puestos cp JOIN puestos p ON p.id = cp.puesto_id WHERE cp.colaborador_id = ? ORDER BY p.nombre',
    [id]
  );
  const credenciales = await filas<{ id: number; tipo_credencial_id: number; tipo: string; numero: string | null; vence: string | null; notas: string | null; activo: number; requiere_vencimiento: number; dias_aviso: number }>(
    t.pool,
    `SELECT cc.id, cc.tipo_credencial_id, tc.nombre AS tipo, cc.numero, DATE_FORMAT(cc.vence, '%Y-%m-%d') AS vence, cc.notas, cc.activo, tc.requiere_vencimiento, tc.dias_aviso
       FROM colaborador_credenciales cc JOIN tipos_credencial tc ON tc.id = cc.tipo_credencial_id WHERE cc.colaborador_id = ? ORDER BY tc.nombre`,
    [id]
  );
  const hoyTexto = hoy.toISOString().slice(0, 10);
  const conEstado = credenciales.map((c) => {
    let estado: 'vigente' | 'por_vencer' | 'vencida' | 'sin_vencimiento' = 'sin_vencimiento';
    if (c.vence) {
      const dias = Math.floor((new Date(`${c.vence}T00:00:00Z`).getTime() - new Date(`${hoyTexto}T00:00:00Z`).getTime()) / 86400000);
      estado = dias < 0 ? 'vencida' : dias <= c.dias_aviso ? 'por_vencer' : 'vigente';
    }
    return { ...c, activo: c.activo === 1, requiere_vencimiento: c.requiere_vencimiento === 1, estado };
  });
  // Credenciales obligatorias de sus puestos que no tiene (o que tiene vencidas).
  const exigidas = await filas<{ tipo_credencial_id: number; nombre: string }>(
    t.pool,
    `SELECT DISTINCT pc.tipo_credencial_id, tc.nombre FROM colaborador_puestos cp
       JOIN puesto_credenciales pc ON pc.puesto_id = cp.puesto_id AND pc.obligatoria = 1
       JOIN tipos_credencial tc ON tc.id = pc.tipo_credencial_id AND tc.activo = 1
      WHERE cp.colaborador_id = ?`,
    [id]
  );
  const faltantes = exigidas.filter((e) => !conEstado.some((c) => c.activo && c.tipo_credencial_id === e.tipo_credencial_id && c.estado !== 'vencida'));
  const roles = base['usuario_id']
    ? await filas<{ id: number; codigo: string; nombre: string }>(t.pool, 'SELECT r.id, r.codigo, r.nombre FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id WHERE ur.usuario_id = ? ORDER BY r.id', [base['usuario_id']])
    : [];
  return {
    ...base,
    direccion: detalle?.['direccion'] ?? null,
    puestos_detalle: puestos.map((p) => ({ id: p.id, nombre: p.nombre, es_tecnico: p.es_tecnico === 1, es_operador: p.es_operador === 1 })),
    credenciales: conEstado,
    credenciales_faltantes: faltantes.map((f) => f.nombre),
    roles,
  };
}

async function validarReferencias(con: Ejecutor, d: DatosColaborador, soloActivos = true): Promise<void> {
  if (d.sucursal_id) {
    const s = await una<{ activo: number }>(con, 'SELECT activo FROM sucursales WHERE id = ?', [d.sucursal_id]);
    if (!s || (soloActivos && s.activo !== 1)) throw new ErrorValidacion('La sucursal elegida no existe o está desactivada');
  }
  if (d.area_trabajo_id) {
    const a = await una<{ activo: number }>(con, 'SELECT activo FROM areas_trabajo WHERE id = ?', [d.area_trabajo_id]);
    if (!a || (soloActivos && a.activo !== 1)) throw new ErrorValidacion('El área elegida no existe o está desactivada');
  }
  if (d.nivel_tecnico_id && !(await una(con, 'SELECT id FROM niveles_tecnico WHERE id = ?', [d.nivel_tecnico_id]))) throw new ErrorValidacion('El nivel elegido no existe');
}

async function validarPuestos(con: Ejecutor, puestos: number[]): Promise<void> {
  if (new Set(puestos).size !== puestos.length) throw new ErrorValidacion('Un puesto está repetido');
  for (const p of puestos) {
    if (!(await una(con, 'SELECT id FROM puestos WHERE id = ? AND activo = 1', [p]))) throw new ErrorValidacion('Uno de los puestos no existe o está desactivado');
  }
}

async function validarNivelSoloTecnicos(con: Ejecutor, colaboradorId: number | null, puestos: number[] | undefined, nivel: number | null | undefined): Promise<void> {
  if (!nivel) return;
  const ids = puestos ?? (colaboradorId ? (await filas<{ puesto_id: number }>(con, 'SELECT puesto_id FROM colaborador_puestos WHERE colaborador_id = ?', [colaboradorId])).map((p) => p.puesto_id) : []);
  if (ids.length === 0) throw new ErrorValidacion('El nivel solo aplica a técnicos: elija primero un puesto de técnico');
  const tec = await una<{ n: number }>(con, `SELECT COUNT(*) AS n FROM puestos WHERE es_tecnico = 1 AND id IN (${ids.map(() => '?').join(',')})`, ids);
  if (Number(tec?.n) === 0) throw new ErrorValidacion('El nivel solo aplica a técnicos: elija primero un puesto de técnico');
}

async function exigirDpiLibre(con: Ejecutor, dpi: string | null, exceptoId: number | null): Promise<void> {
  if (!dpi) return;
  const otro = await una<{ nombre_completo: string }>(con, 'SELECT nombre_completo FROM colaboradores WHERE dpi = ? AND id <> ?', [dpi, exceptoId ?? 0]);
  if (otro) throw new ErrorApp(409, 'CONFLICTO', `Ese DPI ya está registrado a nombre de ${otro.nombre_completo}`);
}

export async function crearColaborador(t: TallerReq, actor: Actor, d: DatosColaborador & { nombre_completo: string; puestos: number[] }) {
  if (d.puestos.length === 0) throw new ErrorValidacion('Elija al menos un puesto');
  const dpi = normalizarDpi(d.dpi);
  try {
    const id = await transaccion(t.pool, async (con) => {
      await validarReferencias(con, d);
      await validarPuestos(con, d.puestos);
      await validarNivelSoloTecnicos(con, null, d.puestos, d.nivel_tecnico_id);
      await exigirDpiLibre(con, dpi, null);
      const numero = await siguienteNumero(con, 'colaborador');
      const r = await ejecutar(
        con,
        `INSERT INTO colaboradores (codigo, nombre_completo, correo, celular, direccion, dpi, sucursal_id, area_trabajo_id, nivel_tecnico_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          `C-${String(numero).padStart(6, '0')}`,
          normalizarCampo('texto', d.nombre_completo),
          normalizarCampo('correo', d.correo),
          normalizarCampo('telefono', d.celular),
          normalizarCampo('texto', d.direccion),
          dpi,
          d.sucursal_id ?? null,
          d.area_trabajo_id ?? null,
          d.nivel_tecnico_id ?? null,
        ]
      );
      for (const p of d.puestos) await ejecutar(con, 'INSERT INTO colaborador_puestos (colaborador_id, puesto_id) VALUES (?, ?)', [r.insertId, p]);
      await bitacora(con, actor, { accion: 'colaborador_creado', entidad: 'colaboradores', entidadId: r.insertId, despues: { ...d, dpi: dpi ? '***' : null } });
      return r.insertId;
    });
    return await obtenerColaborador(t, id);
  } catch (error) {
    return conflictoSiDuplicado(error, 'Ya hay un colaborador con ese correo');
  }
}

export async function actualizarColaborador(ctx: Contexto, t: TallerReq, actor: Actor, id: number, d: DatosColaborador) {
  const dpi = d.dpi === undefined ? undefined : normalizarDpi(d.dpi);
  let correoAnterior: string | null = null;
  let usuarioId: number | null = null;
  try {
    await transaccion(t.pool, async (con) => {
      const antes = await una<{ nombre_completo: string; correo: string | null }>(con, 'SELECT nombre_completo, correo FROM colaboradores WHERE id = ? FOR UPDATE', [id]);
      if (!antes) throw new ErrorNoEncontrado('No se encontró al colaborador');
      await validarReferencias(con, d);
      if (d.puestos) {
        if (d.puestos.length === 0) throw new ErrorValidacion('Elija al menos un puesto');
        await validarPuestos(con, d.puestos);
      }
      if (d.nivel_tecnico_id !== undefined) await validarNivelSoloTecnicos(con, id, d.puestos, d.nivel_tecnico_id);
      if (dpi !== undefined) await exigirDpiLibre(con, dpi, id);
      const sets: string[] = [];
      const valores: unknown[] = [];
      const poner = (col: string, v: unknown): void => {
        sets.push(`${col} = ?`);
        valores.push(v);
      };
      if (d.nombre_completo !== undefined) poner('nombre_completo', normalizarCampo('texto', d.nombre_completo));
      if (d.correo !== undefined) poner('correo', normalizarCampo('correo', d.correo));
      if (d.celular !== undefined) poner('celular', normalizarCampo('telefono', d.celular));
      if (d.direccion !== undefined) poner('direccion', normalizarCampo('texto', d.direccion));
      if (dpi !== undefined) poner('dpi', dpi);
      if (d.sucursal_id !== undefined) poner('sucursal_id', d.sucursal_id);
      if (d.area_trabajo_id !== undefined) poner('area_trabajo_id', d.area_trabajo_id);
      if (d.nivel_tecnico_id !== undefined) poner('nivel_tecnico_id', d.nivel_tecnico_id);
      if (sets.length > 0) await ejecutar(con, `UPDATE colaboradores SET ${sets.join(', ')} WHERE id = ?`, [...valores, id]);
      if (d.puestos) {
        await ejecutar(con, 'DELETE FROM colaborador_puestos WHERE colaborador_id = ?', [id]);
        for (const p of d.puestos) await ejecutar(con, 'INSERT INTO colaborador_puestos (colaborador_id, puesto_id) VALUES (?, ?)', [id, p]);
      }
      if (d.correo !== undefined && normalizarCampo('correo', d.correo) !== antes.correo) {
        correoAnterior = antes.correo;
        const u = await una<{ id: number }>(con, 'SELECT id FROM usuarios WHERE colaborador_id = ?', [id]);
        usuarioId = u?.id ?? null;
      }
      await bitacora(con, actor, { accion: 'colaborador_editado', entidad: 'colaboradores', entidadId: id, antes, despues: { ...d, dpi: dpi ? '***' : dpi } });
    });
  } catch (error) {
    conflictoSiDuplicado(error, 'Ya hay un colaborador con ese correo');
  }
  // Si la persona tiene acceso, su correo en el directorio de talleres cambia con ella.
  if (usuarioId !== null) {
    const nuevo = normalizarCampo('correo', d.correo);
    await moverCorreoEnDirectorio(ctx, t.empresa.id, usuarioId, correoAnterior, nuevo);
  }
  return obtenerColaborador(t, id, ahoraDe(ctx));
}

/** Trabajos abiertos de un colaborador (las órdenes llegan en la Fase 4: hasta entonces no hay ninguno). */
export async function trabajosAbiertosDe(_con: Ejecutor, _colaboradorId: number): Promise<number> {
  return 0;
}

async function administradoresActivos(con: Ejecutor, excluyendoUsuarioId: number): Promise<number> {
  const f = await una<{ n: number }>(
    con,
    `SELECT COUNT(DISTINCT u.id) AS n FROM usuarios u
       JOIN colaboradores c ON c.id = u.colaborador_id AND c.activo = 1
       JOIN usuario_roles ur ON ur.usuario_id = u.id JOIN roles r ON r.id = ur.rol_id AND r.codigo = 'administrador'
      WHERE u.activo = 1 AND u.id <> ?`,
    [excluyendoUsuarioId]
  );
  return Number(f?.n);
}

/** Siempre debe quedar al menos un administrador activo: nadie puede dejar al taller sin quien lo administre. */
export async function exigirOtroAdministrador(con: Ejecutor, usuarioId: number): Promise<void> {
  const esAdmin = await una(con, "SELECT 1 AS x FROM usuario_roles ur JOIN roles r ON r.id = ur.rol_id WHERE ur.usuario_id = ? AND r.codigo = 'administrador'", [usuarioId]);
  if (esAdmin && (await administradoresActivos(con, usuarioId)) === 0) {
    throw new ErrorApp(409, 'REGLA', 'Es el único administrador activo del taller. Nombre otro administrador antes de hacer este cambio.');
  }
}

export async function cambiarEstadoColaborador(
  ctx: Contexto,
  t: TallerReq,
  actor: Actor,
  id: number,
  activo: boolean,
  opciones: { desactivarAcceso: boolean }
) {
  let usuarioADesactivar: number | null = null;
  await transaccion(t.pool, async (con: PoolConnection) => {
    const c = await una<{ nombre_completo: string; activo: number }>(con, 'SELECT nombre_completo, activo FROM colaboradores WHERE id = ? FOR UPDATE', [id]);
    if (!c) throw new ErrorNoEncontrado('No se encontró al colaborador');
    if ((c.activo === 1) === activo) return;
    const u = await una<{ id: number; activo: number }>(con, 'SELECT id, activo FROM usuarios WHERE colaborador_id = ?', [id]);
    if (!activo) {
      if (u && u.id === actor.usuarioId) throw new ErrorApp(409, 'REGLA', 'No puede desactivarse a sí mismo.');
      const abiertos = await trabajosAbiertosDe(con, id);
      if (abiertos > 0) throw new ErrorApp(409, 'EN_USO', `Tiene ${abiertos} trabajos abiertos. Ciérrelos o reasígnelos antes de desactivarlo.`);
      if (u) await exigirOtroAdministrador(con, u.id);
      if (u && u.activo === 1 && opciones.desactivarAcceso) {
        await ejecutar(con, 'UPDATE usuarios SET activo = 0 WHERE id = ?', [u.id]);
        await ejecutar(con, 'UPDATE sesiones SET revocada_en = ? WHERE usuario_id = ? AND revocada_en IS NULL', [ahoraDe(ctx), u.id]);
        usuarioADesactivar = u.id;
      }
    }
    await ejecutar(con, 'UPDATE colaboradores SET activo = ? WHERE id = ?', [activo ? 1 : 0, id]);
    await bitacora(con, actor, { accion: activo ? 'colaborador_reactivado' : 'colaborador_desactivado', entidad: 'colaboradores', entidadId: id, despues: { acceso_desactivado: usuarioADesactivar !== null } });
  });
  if (usuarioADesactivar !== null) await desactivarAccesoEnDirectorio(ctx, t.empresa.id, usuarioADesactivar);
  return obtenerColaborador(t, id, ahoraDe(ctx));
}

// ── Credenciales de un colaborador ───────────────────────────────────────────────────

export interface DatosCredencial {
  tipo_credencial_id?: number;
  numero?: string | null;
  vence?: string | null;
  notas?: string | null;
  activo?: boolean;
}

async function validarCredencial(con: Ejecutor, d: DatosCredencial, tipoActual?: number): Promise<void> {
  const tipoId = d.tipo_credencial_id ?? tipoActual;
  const tipo = tipoId ? await una<{ requiere_vencimiento: number; activo: number }>(con, 'SELECT requiere_vencimiento, activo FROM tipos_credencial WHERE id = ?', [tipoId]) : null;
  if (!tipo) throw new ErrorValidacion('La credencial elegida no existe');
  if (d.vence) validarFechaRazonable(d.vence, 'vence');
  if (tipo.requiere_vencimiento === 1 && d.vence === undefined && tipoActual === undefined) throw new ErrorValidacion('Esta credencial exige fecha de vencimiento');
  if (tipo.requiere_vencimiento === 1 && d.vence === null) throw new ErrorValidacion('Esta credencial exige fecha de vencimiento');
}

export async function crearCredencial(ctx: Contexto, t: TallerReq, actor: Actor, colaboradorId: number, d: DatosCredencial & { tipo_credencial_id: number }) {
  await transaccion(t.pool, async (con) => {
    if (!(await una(con, 'SELECT id FROM colaboradores WHERE id = ?', [colaboradorId]))) throw new ErrorNoEncontrado('No se encontró al colaborador');
    await validarCredencial(con, d);
    const r = await ejecutar(con, 'INSERT INTO colaborador_credenciales (colaborador_id, tipo_credencial_id, numero, vence, notas) VALUES (?, ?, ?, ?, ?)', [
      colaboradorId,
      d.tipo_credencial_id,
      normalizarCampo('codigo', d.numero),
      d.vence ?? null,
      normalizarCampo('texto', d.notas),
    ]);
    await bitacora(con, actor, { accion: 'credencial_creada', entidad: 'colaborador_credenciales', entidadId: r.insertId, despues: { colaboradorId, ...d } });
  });
  return obtenerColaborador(t, colaboradorId, ahoraDe(ctx));
}

export async function actualizarCredencial(ctx: Contexto, t: TallerReq, actor: Actor, colaboradorId: number, credencialId: number, d: DatosCredencial) {
  await transaccion(t.pool, async (con) => {
    const antes = await una<{ tipo_credencial_id: number }>(con, 'SELECT tipo_credencial_id FROM colaborador_credenciales WHERE id = ? AND colaborador_id = ?', [credencialId, colaboradorId]);
    if (!antes) throw new ErrorNoEncontrado('No se encontró la credencial');
    await validarCredencial(con, d, antes.tipo_credencial_id);
    const sets: string[] = [];
    const valores: unknown[] = [];
    const poner = (col: string, v: unknown): void => {
      sets.push(`${col} = ?`);
      valores.push(v);
    };
    if (d.numero !== undefined) poner('numero', normalizarCampo('codigo', d.numero));
    if (d.vence !== undefined) poner('vence', d.vence);
    if (d.notas !== undefined) poner('notas', normalizarCampo('texto', d.notas));
    if (d.activo !== undefined) poner('activo', d.activo ? 1 : 0);
    if (sets.length === 0) return;
    await ejecutar(con, `UPDATE colaborador_credenciales SET ${sets.join(', ')} WHERE id = ?`, [...valores, credencialId]);
    await bitacora(con, actor, { accion: 'credencial_editada', entidad: 'colaborador_credenciales', entidadId: credencialId, antes, despues: d });
  });
  return obtenerColaborador(t, colaboradorId, ahoraDe(ctx));
}
