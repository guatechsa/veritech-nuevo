import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';
import { Almacen, AlmacenSeguro } from '../nucleo/tipos';

/** La base local del teléfono: una sola tabla de clave y valor (cada persona y cada taller usan sus propias claves, ver `Espacio`). */
let abierta: Promise<SQLite.SQLiteDatabase> | null = null;

function base(): Promise<SQLite.SQLiteDatabase> {
  abierta ??= SQLite.openDatabaseAsync('veritech2.db').then(async (db) => {
    await db.execAsync('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS kv (clave TEXT PRIMARY KEY NOT NULL, valor TEXT NOT NULL);');
    return db;
  });
  return abierta;
}

export const almacenSqlite: Almacen = {
  async leer<T>(clave: string): Promise<T | null> {
    const db = await base();
    const f = await db.getFirstAsync<{ valor: string }>('SELECT valor FROM kv WHERE clave = ?', [clave]);
    return f ? (JSON.parse(f.valor) as T) : null;
  },
  async escribir(clave: string, valor: unknown): Promise<void> {
    const db = await base();
    await db.runAsync('INSERT INTO kv (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor', [clave, JSON.stringify(valor)]);
  },
  async borrar(clave: string): Promise<void> {
    const db = await base();
    await db.runAsync('DELETE FROM kv WHERE clave = ?', [clave]);
  },
  async claves(prefijo: string): Promise<string[]> {
    const db = await base();
    const f = await db.getAllAsync<{ clave: string }>("SELECT clave FROM kv WHERE clave LIKE ? ESCAPE '\\'", [`${prefijo.replace(/[\\%_]/g, (c) => `\\${c}`)}%`]);
    return f.map((x) => x.clave);
  },
};

/** El almacén seguro del sistema solo admite letras, números y «.-_» en las claves. */
const claveSegura = (clave: string): string => `v2_${clave.replace(/[^A-Za-z0-9._-]/g, '_')}`;

export const almacenSeguro: AlmacenSeguro = {
  leer: (clave) => SecureStore.getItemAsync(claveSegura(clave)),
  escribir: (clave, valor) => SecureStore.setItemAsync(claveSegura(clave), valor),
  borrar: (clave) => SecureStore.deleteItemAsync(claveSegura(clave)),
};
