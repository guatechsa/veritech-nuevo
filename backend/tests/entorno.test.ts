import { leerEntorno } from '../src/config/entorno';

const SECRETO = 'una-llave-de-prueba-de-al-menos-32-caracteres';
const base = { BD_USUARIO: 'u', JWT_SECRETO: SECRETO } as NodeJS.ProcessEnv;

describe('leerEntorno', () => {
  it('aplica los valores por defecto', () => {
    const e = leerEntorno(base);
    expect(e.PUERTO).toBe(4100);
    expect(e.BD_HOST).toBe('127.0.0.1');
    expect(e.BD_PLATAFORMA).toBe('veritech_plataforma');
    expect(e.PREFIJO_BD_TALLER).toBe('veritech_');
    expect(e.NODE_ENV).toBe('development');
    expect(e.SMTP_HOST).toBeUndefined();
    expect(e.SMTP_SEGURO).toBe(false);
  });

  it('convierte números escritos como texto', () => {
    const e = leerEntorno({ ...base, PUERTO: '5000', BD_PUERTO: '3307' });
    expect(e.PUERTO).toBe(5000);
    expect(e.BD_PUERTO).toBe(3307);
  });

  it('falla con el motivo cuando falta lo obligatorio', () => {
    expect(() => leerEntorno({} as NodeJS.ProcessEnv)).toThrow(/Configuración inválida: BD_USUARIO/);
    expect(() => leerEntorno({ BD_USUARIO: 'u' } as NodeJS.ProcessEnv)).toThrow(/JWT_SECRETO/);
  });

  it('la llave de sesiones debe tener al menos 32 caracteres', () => {
    expect(() => leerEntorno({ ...base, JWT_SECRETO: 'corta' })).toThrow(/JWT_SECRETO: debe tener al menos 32/);
  });

  it('rechaza nombres de base con caracteres peligrosos', () => {
    expect(() => leerEntorno({ ...base, BD_PLATAFORMA: 'x; DROP DATABASE y' })).toThrow(/BD_PLATAFORMA/);
  });

  it('rechaza un puerto fuera de rango', () => {
    expect(() => leerEntorno({ ...base, PUERTO: '70000' })).toThrow(/PUERTO/);
  });

  it('un valor opcional vacío cuenta como no configurado', () => {
    expect(leerEntorno({ ...base, SMTP_HOST: '' }).SMTP_HOST).toBeUndefined();
  });
});
