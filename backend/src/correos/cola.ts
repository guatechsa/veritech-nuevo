import { Pool } from 'mysql2/promise';
import { ejecutar, Ejecutor, filas } from '../db/consulta';

export interface MensajeCorreo {
  destinatarios: string[];
  asunto: string;
  html: string;
}

export interface Transporte {
  enviar(mensaje: MensajeCorreo): Promise<void>;
}

/** Pone un correo en la cola. Se puede llamar dentro de una transacción: si esta se deshace, el correo tampoco sale. */
export async function encolarCorreo(
  ejecutor: Ejecutor,
  correo: { tipo: string; destinatarios: string[]; asunto: string; cuerpoHtml: string }
): Promise<number> {
  const r = await ejecutar(
    ejecutor,
    'INSERT INTO correos_salida (tipo, destinatarios, asunto, cuerpo) VALUES (?, ?, ?, ?)',
    [correo.tipo, correo.destinatarios.join(','), correo.asunto.slice(0, 200), correo.cuerpoHtml]
  );
  return r.insertId;
}

export interface ResultadoCola {
  enviados: number;
  conError: number;
}

/**
 * Envía los correos pendientes. Cada correo se "reserva" antes de enviarse (se adelanta su próxima hora de intento),
 * así dos procesos a la vez nunca mandan el mismo correo. Si falla, se reintenta más tarde; tras `maximoIntentos`
 * queda en estado `error` para que alguien lo revise.
 */
export async function procesarCola(
  pool: Pool,
  transporte: Transporte,
  opciones: { limite?: number; maximoIntentos?: number; minutosEntreIntentos?: number } = {}
): Promise<ResultadoCola> {
  const { limite = 20, maximoIntentos = 5, minutosEntreIntentos = 5 } = opciones;
  const resultado: ResultadoCola = { enviados: 0, conError: 0 };

  const candidatos = await filas<{ id: number }>(
    pool,
    `SELECT id FROM correos_salida WHERE estado = 'pendiente' AND enviar_despues_de <= UTC_TIMESTAMP() ORDER BY id LIMIT ?`,
    [limite]
  );

  for (const { id } of candidatos) {
    const reserva = await ejecutar(
      pool,
      `UPDATE correos_salida
          SET intentos = intentos + 1, enviar_despues_de = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
        WHERE id = ? AND estado = 'pendiente' AND enviar_despues_de <= UTC_TIMESTAMP()`,
      [minutosEntreIntentos, id]
    );
    if (reserva.affectedRows !== 1) continue; // otro proceso se lo llevó

    const [correo] = await filas<{ destinatarios: string; asunto: string; cuerpo: string; intentos: number }>(
      pool,
      'SELECT destinatarios, asunto, cuerpo, intentos FROM correos_salida WHERE id = ?',
      [id]
    );
    if (!correo) continue;
    try {
      await transporte.enviar({ destinatarios: correo.destinatarios.split(','), asunto: correo.asunto, html: correo.cuerpo });
      await ejecutar(pool, `UPDATE correos_salida SET estado = 'enviado', enviado_en = UTC_TIMESTAMP(), ultimo_error = NULL WHERE id = ?`, [id]);
      resultado.enviados += 1;
    } catch (error) {
      const motivo = (error instanceof Error ? error.message : String(error)).slice(0, 500);
      const agotado = correo.intentos >= maximoIntentos;
      await ejecutar(pool, `UPDATE correos_salida SET ultimo_error = ?, estado = ? WHERE id = ?`, [motivo, agotado ? 'error' : 'pendiente', id]);
      resultado.conError += 1;
    }
  }
  return resultado;
}
