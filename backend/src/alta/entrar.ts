import { filas } from '../db/consulta';
import { correoAccesos } from '../correos/ciclo-vida';
import { encolarCorreo } from '../correos/cola';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { urlDeTaller } from '../utils/slug';

const ESTADOS_VISIBLES = ['prueba', 'activa', 'pago_fallido', 'suspendida', 'cancelada_con_acceso', 'solo_exportar'];

/**
 * Página "Entrar": la persona escribe su correo y recibe por correo la lista de sus talleres (uno o varios).
 * Quien llama SIEMPRE responde lo mismo, exista o no el correo; aquí solo se encola el mensaje cuando hay accesos.
 * Con clave única por hora, repetir la solicitud no llena la bandeja de la persona.
 */
export async function solicitarAccesos(ctx: Contexto, correo: string): Promise<void> {
  const limpio = correo.trim();
  const accesos = await filas<{ nombre: string; subdominio: string }>(
    ctx.pool,
    `SELECT e.nombre, e.subdominio
       FROM directorio_acceso d JOIN empresas e ON e.id = d.empresa_id
      WHERE d.correo = ? AND d.activo = 1 AND e.estado IN (${ESTADOS_VISIBLES.map(() => '?').join(',')})
      ORDER BY e.nombre`,
    [limpio, ...ESTADOS_VISIBLES]
  );
  if (accesos.length === 0) return;
  const hora = ahoraDe(ctx).toISOString().slice(0, 13);
  const c = correoAccesos(accesos.map((a) => ({ nombreTaller: a.nombre, url: urlDeTaller(a.subdominio) })));
  await encolarCorreo(ctx.pool, { tipo: c.tipo, destinatarios: [limpio], asunto: c.asunto, cuerpoHtml: c.cuerpoHtml, claveUnica: `accesos:${limpio.toLowerCase()}:${hora}` });
}
