import 'dotenv/config';
import { crearApp } from './app';
import { leerEntorno } from './config/entorno';
import { procesarCola } from './correos/cola';
import { crearTransporteSmtp } from './correos/transporte';
import { crearPool } from './db/conexion';
import { APP_VERSION } from './version';

const entorno = leerEntorno();
const pool = crearPool(
  { host: entorno.BD_HOST, puerto: entorno.BD_PUERTO, usuario: entorno.BD_USUARIO, clave: entorno.BD_CLAVE },
  entorno.BD_PLATAFORMA
);

const app = crearApp({
  verificarBase: async () => {
    await pool.query('SELECT 1');
    return true;
  },
  plataforma: { pool, entorno },
});

// Cola de correos de la plataforma: cada 30 segundos. Sin SMTP configurado los correos quedan pendientes en la base.
const transporte = crearTransporteSmtp(entorno);
if (transporte) {
  setInterval(() => {
    procesarCola(pool, transporte).catch((error: unknown) => console.error('[correos] error al procesar la cola:', error));
  }, 30_000).unref();
} else {
  console.warn('[correos] SMTP no configurado: los correos quedan en la cola sin enviarse.');
}

app.listen(entorno.PUERTO, () => {
  console.log(`VERI-TECH ${APP_VERSION} escuchando en el puerto ${entorno.PUERTO}`);
});
