/**
 * Normalización de texto (estándar GUATECH §5): lo que se guarda va en MAYÚSCULAS y SIN TILDES,
 * excepto el correo, que se guarda tal cual lo escribió la persona (solo se le quitan los espacios de los extremos).
 * Esta normalización se hace también en el servidor, no solo en la pantalla.
 */
export type TipoCampo = 'texto' | 'multilinea' | 'correo' | 'nit' | 'codigo' | 'telefono';

export function sinTildes(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function mayusculasSinTildes(valor: string): string {
  return sinTildes(valor).toUpperCase();
}

export function normalizarCampo(tipo: TipoCampo, valor: string | null | undefined): string | null {
  if (valor === null || valor === undefined) return null;
  const entrada = String(valor);
  let salida: string;
  switch (tipo) {
    case 'correo':
      salida = entrada.trim();
      break;
    case 'texto':
      salida = mayusculasSinTildes(entrada).replace(/\s+/g, ' ').trim();
      break;
    case 'multilinea':
      salida = mayusculasSinTildes(entrada)
        .split(/\r?\n/)
        .map((linea) => linea.replace(/[ \t]+/g, ' ').trim())
        .join('\n')
        .trim();
      break;
    case 'codigo':
      salida = mayusculasSinTildes(entrada).replace(/\s+/g, '');
      break;
    case 'nit': {
      const limpio = mayusculasSinTildes(entrada).replace(/\s+/g, '');
      // "C/F", "C.F." y "CF" son lo mismo: consumidor final (el único NIT que puede repetirse).
      salida = /^C[/.]?F\.?$/.test(limpio) ? 'CF' : limpio;
      break;
    }
    case 'telefono':
      salida = entrada.replace(/\s+/g, ' ').trim();
      break;
  }
  return salida === '' ? null : salida;
}
