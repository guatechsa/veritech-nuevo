import { normalizarCampo, sinTildes } from '../../src/utils/texto';

describe('normalizarCampo (estándar §5: mayúsculas y sin tildes, excepto el correo)', () => {
  it('texto: mayúsculas, sin tildes, sin espacios sobrantes', () => {
    expect(normalizarCampo('texto', '  José  Pérez   Ñandú ')).toBe('JOSE PEREZ NANDU');
    expect(normalizarCampo('texto', 'Ünïcódé àèìòù')).toBe('UNICODE AEIOU');
  });

  it('el correo se guarda tal cual lo escribió la persona (solo se recortan los extremos)', () => {
    expect(normalizarCampo('correo', '  Luis.Ruiz@Taller.com ')).toBe('Luis.Ruiz@Taller.com');
  });

  it('vacío o nulo se guarda como nulo, nunca como texto vacío', () => {
    expect(normalizarCampo('texto', '   ')).toBeNull();
    expect(normalizarCampo('texto', null)).toBeNull();
    expect(normalizarCampo('correo', undefined)).toBeNull();
  });

  it('NIT: sin espacios y en mayúsculas; C/F, C.F. y cf son el mismo "consumidor final"', () => {
    expect(normalizarCampo('nit', ' 1234567-k ')).toBe('1234567-K');
    expect(normalizarCampo('nit', 'c/f')).toBe('CF');
    expect(normalizarCampo('nit', 'C.F.')).toBe('CF');
    expect(normalizarCampo('nit', 'cf')).toBe('CF');
  });

  it('código: mayúsculas, sin tildes y sin espacios', () => {
    expect(normalizarCampo('codigo', ' rep óo1 ')).toBe('REPOO1');
  });

  it('multilínea conserva los saltos de línea pero normaliza cada renglón', () => {
    expect(normalizarCampo('multilinea', ' línea uno \r\n  segunda   línea  \n')).toBe('LINEA UNO\nSEGUNDA LINEA');
  });

  it('teléfono: solo se ordenan los espacios', () => {
    expect(normalizarCampo('telefono', '  +502   5555 1234 ')).toBe('+502 5555 1234');
  });

  it('sinTildes quita diacríticos sin cambiar mayúsculas', () => {
    expect(sinTildes('Canción')).toBe('Cancion');
  });
});
