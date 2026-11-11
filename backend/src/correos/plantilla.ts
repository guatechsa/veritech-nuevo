import { escaparHtml } from '../utils/html';

/**
 * Plantilla única de correos (estándar GUATECH, diseño de correos): azul #4997D0, encabezado con el nombre del
 * producto, cuerpo simple y pie fijo. El cuerpo que se recibe debe venir ya escapado (use `escaparHtml` con todo dato
 * que escriba una persona).
 */
export function plantillaCorreo(cuerpoHtml: string, pie = 'GUATECH S.A. — Este es un correo automático, no lo respondas.'): string {
  return `<div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
  <h2 style="color: #4997D0; margin-bottom: 4px;">VERI-TECH</h2>
  ${cuerpoHtml}
  <p style="color: #A6A6A6; font-size: 12px; margin-top: 32px;">${escaparHtml(pie)}</p>
</div>`;
}

/** Botón sólido del estándar. `url` debe ser una dirección construida por el sistema, nunca escrita por una persona. */
export function botonCorreo(texto: string, url: string): string {
  return `<p style="margin: 24px 0;">
    <a href="${escaparHtml(url)}" style="background: #4997D0; color: #fff; padding: 10px 20px; border-radius: 8px; text-decoration: none; font-weight: bold;">${escaparHtml(texto)}</a>
  </p>
  <p>Si el botón no funciona, copie y pegue este enlace en su navegador:<br>${escaparHtml(url)}</p>`;
}
