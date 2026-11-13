import { z } from 'zod';

const nombreDeBase = z.string().regex(/^[a-z0-9_]+$/, 'solo letras minúsculas, números y guion bajo');
const textoOpcional = z.string().optional().transform((v) => (v === undefined || v === '' ? undefined : v));

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
  /** Llave con la que se firman las sesiones. Mínimo 32 caracteres. */
  JWT_SECRETO: z.string().min(32, 'debe tener al menos 32 caracteres'),
  /** Dirección pública del panel de administración (para los enlaces de los correos). */
  URL_PANEL: z.string().url().default('http://localhost:5180/admin'),
  /** Correo saliente. Si no se configura, los correos quedan en la cola sin enviarse. */
  SMTP_HOST: textoOpcional,
  SMTP_PUERTO: z.coerce.number().int().min(1).max(65535).default(587),
  SMTP_SEGURO: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  SMTP_USUARIO: textoOpcional,
  SMTP_CLAVE: textoOpcional,
  EXPO_ACCESS_TOKEN: textoOpcional,
  SMTP_DESDE: z.string().default('VERI-TECH <noreply@veritech.lat>'),
  /** Casilla anti-robots de Cloudflare para formularios públicos. Si falta, no se exige (como en el sistema actual). */
  TURNSTILE_SECRET: textoOpcional,
  /** Dominio bajo el que viven los talleres: <slug>.<dominio>. */
  DOMINIO_TALLERES: z.string().min(3).default('veritech.lat'),
  /** PayPal: sin identificador y llave el cobro queda apagado (el registro público no puede completarse). */
  PAYPAL_MODO: z.enum(['sandbox', 'live']).default('sandbox'),
  PAYPAL_CLIENT_ID: textoOpcional,
  PAYPAL_SECRETO: textoOpcional,
  /** Sin este identificador el aviso (webhook) de PayPal se rechaza: la verificación de firma nunca falla abierta. */
  PAYPAL_WEBHOOK_ID: textoOpcional,
  /** Borrado real de la base de un taller cerrado. Apagado hasta que Luis lo active. */
  BORRADO_AUTOMATICO: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /**
   * Permite indicar el taller con la cabecera `X-Taller` cuando la dirección no es <taller>.<dominio>. Solo para el sitio de
   * pruebas (mientras los talleres no tengan su propia dirección). En producción va apagado: manda el nombre de la dirección.
   */
  TALLER_POR_ENCABEZADO: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  /** Carpeta donde se guardan las fotos y documentos de los talleres (una subcarpeta por taller). Por defecto, `archivos` junto al sistema. */
  ARCHIVOS_DIR: textoOpcional,
  /** Quién recibe las alertas internas (alta fallida, correos agotados…). */
  CORREO_ALERTAS: z.string().email().default('soporte@guatech.lat'),
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
