/** Suma días a una fecha AAAA-MM-DD (sin zonas: es un día del calendario). */
export const addDias = (fecha: string, dias: number): string => new Date(new Date(`${fecha}T00:00:00Z`).getTime() + dias * 86400000).toISOString().slice(0, 10);
