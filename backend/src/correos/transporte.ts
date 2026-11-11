import nodemailer from 'nodemailer';
import { Entorno } from '../config/entorno';
import { MensajeCorreo, Transporte } from './cola';

function textoPlano(html: string): string {
  return html.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h2|li)>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\n{3,}/g, '\n\n').trim();
}

/** Transporte SMTP real. Devuelve null si el correo saliente no está configurado (los correos quedan en la cola). */
export function crearTransporteSmtp(entorno: Entorno): Transporte | null {
  if (!entorno.SMTP_HOST) return null;
  const smtp = nodemailer.createTransport({
    host: entorno.SMTP_HOST,
    port: entorno.SMTP_PUERTO,
    secure: entorno.SMTP_SEGURO,
    auth: entorno.SMTP_USUARIO && entorno.SMTP_CLAVE ? { user: entorno.SMTP_USUARIO, pass: entorno.SMTP_CLAVE } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return {
    async enviar(mensaje: MensajeCorreo): Promise<void> {
      await smtp.sendMail({
        from: entorno.SMTP_DESDE,
        to: mensaje.destinatarios,
        subject: mensaje.asunto,
        text: textoPlano(mensaje.html),
        html: mensaje.html,
        // base64: un enlace largo nunca queda cortado a mitad del botón (lección de Outlook del sistema anterior).
        encoding: 'base64',
      });
    },
  };
}
