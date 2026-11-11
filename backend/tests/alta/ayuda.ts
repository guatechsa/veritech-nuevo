import { aprovisionarAlta } from '../../src/alta/aprovisionar';
import { confirmarAlta, DatosAlta, iniciarAlta } from '../../src/alta/registro';
import { una } from '../../src/db/consulta';
import { EntornoDePrueba } from '../plataforma/ayuda';

export const CLAVE_ADMIN = 'Taller-2026-Segura!';
let contador = 0;

export function datosAlta(cambios: Partial<DatosAlta> = {}): DatosAlta {
  const n = ++contador;
  return {
    nombre_taller: `Taller López ${n}`,
    slug: `lopez${n}`,
    admin_nombre: 'José Pérez',
    admin_correo: `Jose${n}@Lopez.test`,
    contrasena: CLAVE_ADMIN,
    plan_codigo: 'basico',
    version_legal: '1.0',
    acepta_terminos: true,
    ...cambios,
  };
}

export interface AltaListaParaCrear {
  altaId: number;
  pase: string;
  suscripcionId: string;
  datos: DatosAlta;
}

/** Recorre los dos pasos del registro con PayPal simulado y deja el alta "aprobada" (lista para crear el taller). */
export async function altaAprobada(e: EntornoDePrueba, cambios: Partial<DatosAlta> = {}): Promise<AltaListaParaCrear> {
  await e.planesConPaypal();
  const datos = datosAlta(cambios);
  const emitido = await iniciarAlta(e.ctx, datos, { ip: '10.0.0.1' });
  const suscripcionId = `I-${datos.slug.toUpperCase()}`;
  e.paypal.suscripcion(suscripcionId, { planId: emitido.paypal_plan_id, customId: emitido.custom_id, enPrueba: true, proximoCobro: new Date(Date.now() + 30 * 86400000) });
  const estado = await confirmarAlta(e.ctx, { pase: emitido.pase, suscripcionId });
  if (estado.estado !== 'creando' || estado.altaId === undefined) throw new Error(`El alta no quedó aprobada: ${estado.estado}`);
  return { altaId: estado.altaId, pase: emitido.pase, suscripcionId, datos };
}

/** Alta aprobada + taller creado. Devuelve también el id de la empresa. */
export async function tallerCreado(e: EntornoDePrueba, cambios: Partial<DatosAlta> = {}) {
  const alta = await altaAprobada(e, cambios);
  const r = await aprovisionarAlta(e.ctx, alta.altaId);
  const empresa = await una<{ nombre_bd: string; slug: string }>(e.pool, 'SELECT nombre_bd, slug FROM empresas WHERE id = ?', [r.empresaId]);
  return { ...alta, empresaId: r.empresaId, subdominio: r.subdominio, nombreBd: empresa?.nombre_bd ?? '', slug: empresa?.slug ?? '' };
}
