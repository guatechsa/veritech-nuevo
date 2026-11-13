import Constants from 'expo-constants';
import * as Crypto from 'expo-crypto';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { Acciones } from '../nucleo/acciones';
import { aplicarCambio } from '../nucleo/cambios-locales';
import { ClienteApi } from '../nucleo/cliente';
import { Cola } from '../nucleo/cola';
import { Dia } from '../nucleo/dia';
import { Fotos } from '../nucleo/fotos';
import { FetchLike } from '../nucleo/http';
import { GestorDeSesion } from '../nucleo/sesion';
import { Sincronizador } from '../nucleo/sincronizador';
import { Archivos, Sesion, Telefono } from '../nucleo/tipos';
import { almacenSeguro, almacenSqlite } from './almacen';
import { crearArchivos, imagenes } from './archivos';

export const VERSION_DE_LA_APP = '2.0.0';

/** La dirección del servidor del taller. En pruebas se puede cambiar con `EXPO_PUBLIC_API_URL` (por ejemplo https://pruebas.veritech.lat/api/taller). */
export function direccionDelTaller(slug: string): { api: string; origen: string } {
  const api = process.env['EXPO_PUBLIC_API_URL'] ?? `https://${slug}.veritech.lat/api/taller`;
  return { api, origen: new URL(api).origin };
}

const reloj = { ahora: () => new Date() };
const llamar: FetchLike = (url, init) => fetch(url, init as RequestInit) as unknown as ReturnType<FetchLike>;

/** Un identificador de esta instalación de la app (se crea una vez y se guarda). */
async function instalacion(): Promise<string> {
  const guardado = await almacenSqlite.leer<string>('instalacion');
  if (guardado) return guardado;
  const nuevo = Crypto.randomUUID();
  await almacenSqlite.escribir('instalacion', nuevo);
  return nuevo;
}

export async function datosDelTelefono(): Promise<Telefono> {
  return { instalacion: await instalacion(), plataforma: Platform.OS === 'ios' ? 'ios' : 'android', nombre: Device.modelName ?? Device.deviceName ?? null, version_app: Constants.expoConfig?.version ?? VERSION_DE_LA_APP };
}

export interface Base {
  slug: string;
  gestor: GestorDeSesion;
  cliente: ClienteApi;
  archivos: Archivos;
}

/** Lo que existe aunque todavía no haya sesión: la forma de entrar y de hablar con el servidor del taller. */
export function crearBase(slug: string, alVencer: () => void): Base {
  const { api, origen } = direccionDelTaller(slug);
  const gestor = new GestorDeSesion({ baseUrl: api, taller: slug, fetch: llamar, seguro: almacenSeguro, reloj, telefono: datosDelTelefono, alVencer });
  return { slug, gestor, cliente: new ClienteApi({ baseUrl: api, taller: slug, fetch: llamar, sesion: gestor }), archivos: crearArchivos(origen) };
}

export interface Servicios extends Base {
  sesion: Sesion;
  cola: Cola;
  sincronizador: Sincronizador;
  dia: Dia;
  acciones: Acciones;
}

/** Lo que pertenece a ESTA persona en ESTE taller: su cola, su día y sus acciones (nada se comparte con otra persona del mismo teléfono). */
export function crearDeSesion(base: Base, sesion: Sesion): Servicios {
  const cola = new Cola(almacenSqlite, sesion.espacio, () => Crypto.randomUUID(), reloj);
  const sincronizador = new Sincronizador({ cola, cliente: base.cliente, archivos: base.archivos, reloj });
  const dia = new Dia({ almacen: almacenSqlite, espacio: sesion.espacio, cliente: base.cliente, archivos: base.archivos, cola, reloj, aplicarCambio });
  const fotos = new Fotos({ almacen: almacenSqlite, archivos: base.archivos, imagenes, espacio: sesion.espacio });
  return { ...base, sesion, cola, sincronizador, dia, acciones: new Acciones({ cola, sincronizador, fotos }) };
}
