import { z } from 'zod';

const nombreDeBase = z.string().regex(/^[a-z0-9_]+$/, 'solo letras minúsculas, números y guion bajo');

const esquema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PUERTO: z.coerce.number().int().min(1).max(65535).default(4100),
  BD_HOST: z.string().min(1).default('127.0.0.1'),
  BD_PUERTO: z.coerce.number().int().min(1).max(65535).default(3306),
  BD_USUARIO: z.string().min(1, 'es obligatorio'),
  BD_CLAVE: z.string().default(''),
  /** Base global de la plataforma (empresas, planes, pagos, soporte). */
  BD_PLATAFORMA: nombreDeBase.default('veritech_plataforma'),
  /** Prefijo de la base de cada taller: veritech_<slug>. */
  PREFIJO_BD_TALLER: nombreDeBase.default('veritech_'),
});

export type Entorno = z.infer<typeof esquema>;

/** Lee y valida la configuración. Si falta algo obligatorio el sistema NO arranca (falla fuerte, con el motivo). */
export function leerEntorno(fuente: NodeJS.ProcessEnv = process.env): Entorno {
  const resultado = esquema.safeParse(fuente);
  if (!resultado.success) {
    const detalle = resultado.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Configuración inválida: ${detalle}`);
  }
  return resultado.data;
}
