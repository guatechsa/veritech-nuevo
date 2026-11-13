import { Entorno } from '../config/entorno';

/**
 * La dirección base de un taller. Hay dos modos:
 *  - con `TALLER_POR_ENCABEZADO` (dirección única, como `app.veritech.lat/t/<taller>`): cuelga del sitio del panel;
 *  - sin él: un subdominio propio `<taller>.<dominio>`.
 * Todo enlace que se escribe en un correo o se muestra en pantalla pasa por aquí, para que nunca apunte a una dirección que no existe.
 */
export function urlBaseDeEmpresa(entorno: Pick<Entorno, 'TALLER_POR_ENCABEZADO' | 'URL_PANEL'>, empresa: { slug: string; subdominio: string }): string {
  if (entorno.TALLER_POR_ENCABEZADO) return `${new URL(entorno.URL_PANEL).origin}/t/${empresa.slug}`;
  return `https://${empresa.subdominio}`;
}
