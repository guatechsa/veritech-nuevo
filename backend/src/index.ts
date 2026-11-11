import 'dotenv/config';
import { crearApp } from './app';
import { leerEntorno } from './config/entorno';
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
});

app.listen(entorno.PUERTO, () => {
  console.log(`VERI-TECH ${APP_VERSION} escuchando en el puerto ${entorno.PUERTO}`);
});
