import mysql from 'mysql2/promise';
import request from 'supertest';
import { opcionesBase } from '../../src/db/conexion';
import { ejecutar, una } from '../../src/db/consulta';
import { hashearContrasena } from '../../src/utils/clave';
import { configPruebas } from '../db/ayuda';
import { tallerCreado, CLAVE_ADMIN } from '../alta/ayuda';
import { EntornoDePrueba } from '../plataforma/ayuda';

export const CLAVE_TALLER = 'Usuario-2026-Segura!';
let contador = 0;

export interface TallerDePrueba {
  slug: string;
  empresaId: number;
  nombreBd: string;
  adminCorreo: string;
  /** Pide al servidor como ese taller (cabecera X-Taller), con o sin sesión. */
  api: (token?: string) => { get: (u: string) => request.Test; post: (u: string) => request.Test; patch: (u: string) => request.Test; put: (u: string) => request.Test; delete: (u: string) => request.Test };
  entrar: (correo: string, clave: string) => Promise<request.Response>;
  /** Inicia sesión y devuelve solo el token (falla si no se pudo). */
  token: (correo?: string, clave?: string) => Promise<string>;
  /** Crea directo en la base del taller una persona con acceso y el rol dado. */
  usuario: (rol: string, correo?: string, opciones?: { activo?: boolean }) => Promise<{ id: number; colaboradorId: number; correo: string; token: () => Promise<string> }>;
  sql: <T>(consulta: (con: mysql.Connection) => Promise<T>) => Promise<T>;
}

/** Un taller completo creado por el flujo real de registro, con ayudas para probarlo. */
export async function tallerDePrueba(e: EntornoDePrueba, cambios: { slug?: string; plan_codigo?: string } = {}): Promise<TallerDePrueba> {
  const n = ++contador;
  const t = await tallerCreado(e, { slug: cambios.slug ?? `tp${n}x${Date.now().toString(36).slice(-4)}`, plan_codigo: cambios.plan_codigo ?? 'profesional' });
  const slug = t.slug;
  const api: TallerDePrueba['api'] = (token) => {
    const poner = (r: request.Test): request.Test => {
      r.set('X-Taller', slug);
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    };
    return {
      get: (u) => poner(request(e.app).get(`/api/taller${u}`)),
      post: (u) => poner(request(e.app).post(`/api/taller${u}`)),
      patch: (u) => poner(request(e.app).patch(`/api/taller${u}`)),
      put: (u) => poner(request(e.app).put(`/api/taller${u}`)),
      delete: (u) => poner(request(e.app).delete(`/api/taller${u}`)),
    };
  };
  const entrar = (correo: string, clave: string) => api().post('/auth/ingresar').send({ correo, contrasena: clave });
  const token = async (correo = t.datos.admin_correo, clave = CLAVE_ADMIN): Promise<string> => {
    const r = await entrar(correo, clave);
    if (r.status !== 200) throw new Error(`No se pudo ingresar como ${correo}: ${r.status} ${JSON.stringify(r.body)}`);
    return r.body.data.token as string;
  };
  const sql: TallerDePrueba['sql'] = async (consulta) => {
    const con = await mysql.createConnection(opcionesBase(configPruebas(), t.nombreBd));
    try {
      await con.query("SET time_zone = '+00:00'");
      return await consulta(con);
    } finally {
      await con.end();
    }
  };
  const usuario: TallerDePrueba['usuario'] = async (rol, correoDado, opciones = {}) => {
    const correo = correoDado ?? `u${++contador}@taller.test`;
    const hash = await hashearContrasena(CLAVE_TALLER);
    const ids = await sql(async (con) => {
      const [c] = await con.query<mysql.ResultSetHeader>('INSERT INTO colaboradores (nombre_completo, correo) VALUES (?, ?)', [`PERSONA ${rol.toUpperCase()}`, correo]);
      const [u] = await con.query<mysql.ResultSetHeader>('INSERT INTO usuarios (colaborador_id, contrasena_hash, activo) VALUES (?, ?, ?)', [c.insertId, hash, opciones.activo === false ? 0 : 1]);
      await con.query('INSERT INTO usuario_roles (usuario_id, rol_id) SELECT ?, id FROM roles WHERE codigo = ?', [u.insertId, rol]);
      return { id: u.insertId, colaboradorId: c.insertId };
    });
    return { ...ids, correo, token: () => token(correo, CLAVE_TALLER) };
  };
  return { slug, empresaId: t.empresaId, nombreBd: t.nombreBd, adminCorreo: t.datos.admin_correo, api, entrar, token, usuario, sql };
}

export async function empresaEstado(e: EntornoDePrueba, id: number, estado: string, extra: Record<string, unknown> = {}): Promise<void> {
  await ejecutar(e.pool, 'UPDATE empresas SET estado = ? WHERE id = ?', [estado, id]);
  for (const [k, v] of Object.entries(extra)) await ejecutar(e.pool, `UPDATE empresas SET ${k} = ? WHERE id = ?`, [v, id]);
}

export async function filaDe<T extends object>(e: EntornoDePrueba, tabla: string, donde: string, params: unknown[] = []): Promise<T | null> {
  return una<T>(e.pool, `SELECT * FROM ${tabla} WHERE ${donde}`, params);
}
