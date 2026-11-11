import express, { ErrorRequestHandler, Express, Request, Response } from 'express';
import helmet from 'helmet';
import { ErrorApp } from './errores';
import { APP_VERSION } from './version';

export interface DependenciasApp {
  /** Comprueba que la base de datos responde (se inyecta para poder probar sin base real). */
  verificarBase: () => Promise<boolean>;
}

const manejadorDeErrores: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ErrorApp) {
    res.status(error.estado).json({ success: false, codigo: error.codigo, error: error.message });
    return;
  }
  // Un error inesperado nunca le muestra detalles internos a quien llama.
  console.error('[error no controlado]', error);
  res.status(500).json({ success: false, codigo: 'ERROR_INTERNO', error: 'No se pudo completar la operación' });
};

export function crearApp(dependencias: DependenciasApp): Express {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(express.json({ limit: '1mb' }));

  // Estándar GUATECH §1: un endpoint de salud que dice QUÉ versión corre de verdad.
  const salud = async (_req: Request, res: Response): Promise<void> => {
    let baseOk = false;
    try {
      baseOk = await dependencias.verificarBase();
    } catch {
      baseOk = false;
    }
    res.status(baseOk ? 200 : 503).json({
      success: baseOk,
      version: APP_VERSION,
      base: baseOk ? 'ok' : 'sin_conexion',
      hora: new Date().toISOString(),
    });
  };
  app.get('/health', salud);
  app.get('/api/health', salud);

  app.use((_req, res) => {
    res.status(404).json({ success: false, codigo: 'NO_ENCONTRADO', error: 'No encontrado' });
  });
  app.use(manejadorDeErrores);
  return app;
}
