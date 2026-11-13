import { ejecutar, una } from '../db/consulta';
import { ErrorApp } from '../errores';
import { ahoraDe, Contexto } from '../plataforma/contexto';
import { crearToken, huellaDe } from '../utils/tokens';
import { ingresar } from './auth';
import { OrigenTaller, TallerReq } from './comun';

/**
 * Sesión de la app móvil (Fase 8a). Entrar con correo y contraseña da un token corto (8 horas, como en la web) y un REFRESCO largo (60 días):
 * la app lo usa para renovar la sesión sin pedir la contraseña otra vez. El refresco se cambia en cada uso; si alguien usa uno ya cambiado
 * (señal de que lo copiaron) la sesión se cierra. La contraseña nunca se guarda en el teléfono.
 */
export const DIAS_DE_REFRESCO = 60;
export const HORAS_DEL_TOKEN = 8;
/** Si la respuesta de un refresco se perdió por la señal, la app reintenta con el refresco anterior: se acepta durante este tiempo. */
export const SEGUNDOS_DE_GRACIA = 120;

export interface DatosDispositivo {
  instalacion: string;
  plataforma: 'android' | 'ios';
  nombre?: string | null;
  version_app?: string | null;
  token_push?: string | null;
}

const sumar = (d: Date, ms: number): Date => new Date(d.getTime() + ms);

/** Crea o actualiza el teléfono de esta persona y devuelve su id. */
export async function registrarDispositivo(ctx: Contexto, t: TallerReq, usuarioId: number, d: DatosDispositivo): Promise<number> {
  const ahora = ahoraDe(ctx);
  await ejecutar(
    t.pool,
    `INSERT INTO dispositivos (usuario_id, instalacion, plataforma, nombre, version_app, token_push, ultimo_uso) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE plataforma = VALUES(plataforma), nombre = COALESCE(VALUES(nombre), nombre), version_app = COALESCE(VALUES(version_app), version_app),
       token_push = COALESCE(VALUES(token_push), token_push), activo = 1, ultimo_uso = VALUES(ultimo_uso)`,
    [usuarioId, d.instalacion, d.plataforma, d.nombre?.slice(0, 100) ?? null, d.version_app?.slice(0, 20) ?? null, d.token_push?.slice(0, 255) ?? null, ahora]
  );
  const f = await una<{ id: number }>(t.pool, 'SELECT id FROM dispositivos WHERE usuario_id = ? AND instalacion = ?', [usuarioId, d.instalacion]);
  return f!.id;
}

export async function ingresarMovil(ctx: Contexto, t: TallerReq, datos: OrigenTaller & { correo: string; contrasena: string; telefono: DatosDispositivo }) {
  const r = await ingresar(ctx, t, datos); // mismos candados que la web (mensaje único, bloqueo tras 5 fallos)
  const sesion = await una<{ id: number; usuario_id: number }>(t.pool, 'SELECT id, usuario_id FROM sesiones WHERE huella_token = ?', [huellaDe(r.token)]);
  if (!sesion) throw new ErrorApp(500, 'SESION', 'No se pudo abrir la sesión');
  const dispositivoId = await registrarDispositivo(ctx, t, sesion.usuario_id, datos.telefono);
  const refresco = crearToken();
  const ahora = ahoraDe(ctx);
  const venceRefresco = sumar(ahora, DIAS_DE_REFRESCO * 86400000);
  await ejecutar(t.pool, 'UPDATE sesiones SET movil = 1, dispositivo_id = ?, refresco_huella = ?, refresco_vence_en = ?, refrescada_en = ? WHERE id = ?', [dispositivoId, refresco.huella, venceRefresco, ahora, sesion.id]);
  return { token: r.token, vence_en: r.vence_en, refresco: refresco.token, refresco_vence_en: venceRefresco };
}

const REFRESCO_INVALIDO = (): ErrorApp => new ErrorApp(401, 'REFRESCO_INVALIDO', 'Su sesión venció. Ingrese de nuevo con su correo y contraseña.');

/** Cambia el refresco por un token y un refresco nuevos. Una persona desactivada o una sesión cerrada ya no pueden renovar. */
export async function refrescarMovil(ctx: Contexto, t: TallerReq, refrescoCrudo: string) {
  if (!/^[a-f0-9]{64}$/.test(refrescoCrudo)) throw REFRESCO_INVALIDO();
  const ahora = ahoraDe(ctx);
  const huella = huellaDe(refrescoCrudo);
  const s = await una<{ id: number; refresco_huella: string | null; refresco_anterior_huella: string | null; refresco_vence_en: Date | null; refrescada_en: Date | null; revocada_en: Date | null; usuario_activo: number }>(
    t.pool,
    `SELECT s.id, s.refresco_huella, s.refresco_anterior_huella, s.refresco_vence_en, s.refrescada_en, s.revocada_en, (u.activo = 1 AND c.activo = 1) AS usuario_activo
       FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id JOIN colaboradores c ON c.id = u.colaborador_id
      WHERE s.movil = 1 AND (s.refresco_huella = ? OR s.refresco_anterior_huella = ?)`,
    [huella, huella]
  );
  if (!s || s.revocada_en || !s.refresco_vence_en || s.refresco_vence_en <= ahora || Number(s.usuario_activo) !== 1) throw REFRESCO_INVALIDO();
  const esElActual = s.refresco_huella === huella;
  if (!esElActual) {
    // Un refresco ya cambiado: vale solo un momento (la respuesta pudo perderse por la señal). Pasado ese momento, alguien lo copió: se cierra la sesión.
    const dentroDeGracia = !!s.refrescada_en && ahora.getTime() - s.refrescada_en.getTime() <= SEGUNDOS_DE_GRACIA * 1000;
    if (!dentroDeGracia) {
      await ejecutar(t.pool, 'UPDATE sesiones SET revocada_en = ? WHERE id = ? AND revocada_en IS NULL', [ahora, s.id]);
      throw new ErrorApp(401, 'REFRESCO_REUTILIZADO', 'Por seguridad se cerró su sesión. Ingrese de nuevo con su correo y contraseña.');
    }
  }
  const token = crearToken();
  const refresco = crearToken();
  const vence = sumar(ahora, HORAS_DEL_TOKEN * 3600000);
  const venceRefresco = sumar(ahora, DIAS_DE_REFRESCO * 86400000);
  // Se cambia SOLO si nadie más lo cambió antes (dos renovaciones a la vez no pueden ganar las dos).
  const r = await ejecutar(
    t.pool,
    'UPDATE sesiones SET huella_token = ?, vence_en = ?, refresco_anterior_huella = ?, refresco_huella = ?, refresco_vence_en = ?, refrescada_en = ?, ultimo_uso = ? WHERE id = ? AND revocada_en IS NULL AND (refresco_huella = ? OR refresco_anterior_huella = ?)',
    [token.huella, vence, huella, refresco.huella, venceRefresco, ahora, ahora, s.id, huella, huella]
  );
  if (r.affectedRows !== 1) throw REFRESCO_INVALIDO();
  return { token: token.token, vence_en: vence, refresco: refresco.token, refresco_vence_en: venceRefresco };
}
