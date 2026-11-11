import express, { ErrorRequestHandler, Express, Request, Response } from 'express';
import helmet from 'helmet';
import { crearRutasPublicas } from './alta/rutas';
import { ErrorApp } from './errores';
import { crearRutasTaller } from './taller/rutas';
import { crearRutasArchivos } from './taller/rutas-archivos';
import { Contexto } from './plataforma/contexto';
import { crearRutasPlataforma } from './plataforma/rutas';
import { APP_VERSION } from './version';

export interface DependenciasApp {
  /** Comprueba que la base de datos responde (se inyecta para poder probar sin base real). */
  verificarBase: () => Promise<boolean>;
  /** Contexto del panel de plataforma (base de datos y configuración). */
  plataforma?: Contexto;
}

const manejadorDeErrores: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ErrorApp) {
    res.status(error.estado).json({ success: false, codigo: error.codigo, error: error.message, ...(error.detalle !== undefined ? { detalle: error.detalle } : {}) });
    return;
  }
  // Un cuerpo que no es JSON válido o es demasiado grande es un error de quien llama, no del servidor.
  const tipo = (error as { type?: string }).type;
  if (tipo === 'entity.parse.failed') {
    res.status(400).json({ success: false, codigo: 'VALIDACION', error: 'El cuerpo de la solicitud no es un JSON válido' });
    return;
  }
  if (tipo === 'entity.too.large') {
    res.status(413).json({ success: false, codigo: 'DEMASIADO_GRANDE', error: 'La solicitud es demasiado grande' });
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
  // El cuerpo crudo solo se conserva para los avisos de PayPal: su firma se verifica sobre los bytes exactos recibidos.
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if ((req as { url?: string }).url?.startsWith('/api/webhooks/')) (req as { rawBody?: string }).rawBody = buf.toString('utf8');
      },
    })
  );

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

  if (dependencias.plataforma) {
    app.use('/api/plataforma', crearRutasPlataforma(dependencias.plataforma));
    app.use('/api/taller', crearRutasTaller(dependencias.plataforma));
    app.use('/api/archivos', crearRutasArchivos(dependencias.plataforma));
    app.use('/api', crearRutasPublicas(dependencias.plataforma));
  }

  app.use((_req, res) => {
    res.status(404).json({ success: false, codigo: 'NO_ENCONTRADO', error: 'No encontrado' });
  });
  app.use(manejadorDeErrores);
  return app;
}
