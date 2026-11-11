import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { Express } from 'express';
import { Pool } from 'mysql2/promise';
import request from 'supertest';
import { crearApp } from '../../src/app';
import { leerEntorno, Entorno } from '../../src/config/entorno';
import { crearPool, opcionesBase } from '../../src/db/conexion';
import { ejecutar } from '../../src/db/consulta';
import { aplicarMigraciones } from '../../src/db/migrador';
import { Contexto, RolPlataforma } from '../../src/plataforma/contexto';
import { hashearContrasena } from '../../src/utils/clave';
import { baseTemporal } from '../db/ayuda';

export const CONTRASENA_DE_PRUEBA = 'Prueba-2026-Segura!';
const CARPETA = path.join(__dirname, '..', '..', '..', 'database', 'plataforma');

export interface EntornoDePrueba {
  ctx: Contexto;
  app: Express;
  pool: Pool;
  entorno: Entorno;
  limpiar: () => Promise<void>;
  cerrar: () => Promise<void>;
  /** Crea un usuario de plataforma directo en la base y devuelve cómo entrar con él. */
  usuario: (rol: RolPlataforma, correo?: string, activo?: boolean) => Promise<{ id: number; correo: string; token: string }>;
  /** Inserta una empresa de prueba y devuelve su id. */
  empresa: (datos?: Partial<{ nombre: string; slug: string; estado: string; cuota: number | null; plan_id: number | null; creada: Date }>) => Promise<number>;
  autorizado: (token: string) => { get: (u: string) => request.Test; post: (u: string) => request.Test; patch: (u: string) => request.Test };
}

let contadorUsuarios = 0;
let contadorEmpresas = 0;

export async function crearEntornoDePrueba(opciones: { limites?: Contexto['limites'] } = {}): Promise<EntornoDePrueba> {
  const base = await baseTemporal();
  await aplicarMigraciones(base.config, base.base, CARPETA);
  const entorno = leerEntorno({
    BD_USUARIO: base.config.usuario,
    BD_CLAVE: base.config.clave,
    JWT_SECRETO: 'llave-de-pruebas-que-tiene-mas-de-treinta-y-dos-caracteres',
    URL_PANEL: 'https://pruebas.veritech.lat/admin',
  } as NodeJS.ProcessEnv);
  const pool = crearPool(base.config, base.base, 5);
  const ctx: Contexto = { pool, entorno, limites: opciones.limites ?? { ingreso: 10000, recuperacion: 10000 } };
  const app = crearApp({ verificarBase: async () => true, plataforma: ctx });

  const usuario: EntornoDePrueba['usuario'] = async (rol, correo, activo = true) => {
    const c = correo ?? `usuario${++contadorUsuarios}@prueba.test`;
    const r = await ejecutar(pool, 'INSERT INTO usuarios_plataforma (nombre, correo, contrasena_hash, rol, activo) VALUES (?, ?, ?, ?, ?)', [
      `USUARIO ${rol}`,
      c,
      await hashearContrasena(CONTRASENA_DE_PRUEBA),
      rol,
      activo ? 1 : 0,
    ]);
    const res = await request(app).post('/api/plataforma/auth/ingresar').send({ correo: c, contrasena: CONTRASENA_DE_PRUEBA });
    return { id: r.insertId, correo: c, token: (res.body?.data?.token as string | undefined) ?? '' };
  };

  const empresa: EntornoDePrueba['empresa'] = async (datos = {}) => {
    const n = ++contadorEmpresas;
    const r = await ejecutar(
      pool,
      `INSERT INTO empresas (nombre, slug, nombre_bd, subdominio, estado, plan_id, cuota_mensual, contacto_nombre, contacto_correo, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ADMIN DE PRUEBA', 'admin@taller.test', ?)`,
      [
        datos.nombre ?? `TALLER ${n}`,
        datos.slug ?? `taller${n}`,
        `veritech_taller${n}`,
        `taller${n}.veritech.lat`,
        datos.estado ?? 'activa',
        datos.plan_id ?? null,
        datos.cuota ?? null,
        datos.creada ?? new Date(),
      ]
    );
    return r.insertId;
  };

  const limpiar = async (): Promise<void> => {
    for (const t of ['tokens_acceso_soporte', 'tokens_recuperacion', 'auditoria_plataforma', 'correos_salida', 'empresa_modulos', 'empresas', 'usuarios_plataforma']) {
      await ejecutar(pool, `DELETE FROM ${t}`);
    }
    // Los planes y módulos de fábrica vuelven a su estado original (otra prueba pudo haberlos editado).
    for (const t of ['plan_modulos', 'planes', 'modulos']) await ejecutar(pool, `DELETE FROM ${t}`);
    const con = await mysql.createConnection({ ...opcionesBase(base.config, base.base), multipleStatements: true });
    try {
      await con.query(fs.readFileSync(path.join(CARPETA, '0002_semillas_planes_y_modulos.sql'), 'utf8'));
    } finally {
      await con.end();
    }
  };

  const autorizado: EntornoDePrueba['autorizado'] = (token) => ({
    get: (u) => request(app).get(u).set('Authorization', `Bearer ${token}`),
    post: (u) => request(app).post(u).set('Authorization', `Bearer ${token}`),
    patch: (u) => request(app).patch(u).set('Authorization', `Bearer ${token}`),
  });

  return {
    ctx,
    app,
    pool,
    entorno,
    limpiar,
    usuario,
    empresa,
    autorizado,
    cerrar: async () => {
      await pool.end();
      await base.borrar();
    },
  };
}
