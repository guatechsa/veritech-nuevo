import { leerEntorno } from '../src/config/entorno';

describe('leerEntorno', () => {
  it('aplica los valores por defecto', () => {
    const e = leerEntorno({ BD_USUARIO: 'u' } as NodeJS.ProcessEnv);
    expect(e.PUERTO).toBe(4100);
    expect(e.BD_HOST).toBe('127.0.0.1');
    expect(e.BD_PLATAFORMA).toBe('veritech_plataforma');
    expect(e.PREFIJO_BD_TALLER).toBe('veritech_');
    expect(e.NODE_ENV).toBe('development');
  });

  it('convierte números escritos como texto', () => {
    const e = leerEntorno({ BD_USUARIO: 'u', PUERTO: '5000', BD_PUERTO: '3307' } as NodeJS.ProcessEnv);
    expect(e.PUERTO).toBe(5000);
    expect(e.BD_PUERTO).toBe(3307);
  });

  it('falla con el motivo cuando falta lo obligatorio', () => {
    expect(() => leerEntorno({} as NodeJS.ProcessEnv)).toThrow(/Configuración inválida: BD_USUARIO/);
  });

  it('rechaza nombres de base con caracteres peligrosos', () => {
    expect(() => leerEntorno({ BD_USUARIO: 'u', BD_PLATAFORMA: 'x; DROP DATABASE y' } as NodeJS.ProcessEnv)).toThrow(/BD_PLATAFORMA/);
  });

  it('rechaza un puerto fuera de rango', () => {
    expect(() => leerEntorno({ BD_USUARIO: 'u', PUERTO: '70000' } as NodeJS.ProcessEnv)).toThrow(/PUERTO/);
  });
});
