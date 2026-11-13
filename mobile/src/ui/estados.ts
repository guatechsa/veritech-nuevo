/** Los 8 estados de un trabajo (estándar GUATECH): el texto en usted. La app también los recibe del servidor (`/movil/config`); esta lista es la de reserva. */
export const ESTADO_DE_TRABAJO: Record<string, { nombre: string; detenido: boolean }> = {
  pendiente: { nombre: 'Pendiente', detenido: false },
  en_proceso: { nombre: 'En proceso', detenido: false },
  pausado: { nombre: 'Pausado', detenido: false },
  detenido_material: { nombre: 'Detenido por material', detenido: true },
  detenido_terceros: { nombre: 'Detenido por trabajos de terceros', detenido: true },
  detenido_autorizacion: { nombre: 'Detenido por autorización', detenido: true },
  detenido_espacio: { nombre: 'Detenido por espacio', detenido: true },
  terminado: { nombre: 'Terminado', detenido: false },
};

/** Las razones por las que se detiene un trabajo, en el orden en que se muestran. */
export const RAZONES_DE_PAUSA = ['pausado', 'detenido_material', 'detenido_terceros', 'detenido_autorizacion', 'detenido_espacio'] as const;
