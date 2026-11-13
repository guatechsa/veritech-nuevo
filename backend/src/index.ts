import 'dotenv/config';
import { crearApp } from './app';
import { leerEntorno } from './config/entorno';
import { conciliarTodas } from './cobro/conciliacion';
import { barrerCicloDeVida, verificarSubdominioHttp } from './cobro/ciclo';
import { crearProveedorPaypal } from './cobro/paypal';
import { procesarCola } from './correos/cola';
import { crearTransporteSmtp } from './correos/transporte';
import { crearPool } from './db/conexion';
import { Contexto } from './plataforma/contexto';
import { barrerAvisos } from './taller/avisos-barrido';
import { APP_VERSION } from './version';

const entorno = leerEntorno();
const pool = crearPool(
  { host: entorno.BD_HOST, puerto: entorno.BD_PUERTO, usuario: entorno.BD_USUARIO, clave: entorno.BD_CLAVE },
  entorno.BD_PLATAFORMA
);

const pagos = crearProveedorPaypal(entorno) ?? undefined;
const ctx: Contexto = { pool, entorno, pagos, verificarSubdominio: verificarSubdominioHttp };

const app = crearApp({
  verificarBase: async () => {
    await pool.query('SELECT 1');
    return true;
  },
  plataforma: ctx,
});

/** Corre una tarea periódica sin que un fallo la detenga ni se pisen dos vueltas. */
function cada(nombre: string, milisegundos: number, tarea: () => Promise<unknown>, primeraVezEn = milisegundos): void {
  let corriendo = false;
  const vuelta = (): void => {
    if (corriendo) return;
    corriendo = true;
    tarea()
      .then((resultado) => console.log(`[${nombre}]`, JSON.stringify(resultado)))
      .catch((error: unknown) => console.error(`[${nombre}] error:`, error))
      .finally(() => {
        corriendo = false;
      });
  };
  setTimeout(vuelta, primeraVezEn).unref();
  setInterval(vuelta, milisegundos).unref();
}

// Cola de correos: cada 30 segundos. Sin SMTP configurado los correos quedan pendientes en la base.
const transporte = crearTransporteSmtp(entorno);
if (transporte) {
  cada('correos', 30_000, () => procesarCola(pool, transporte));
} else {
  console.warn('[correos] SMTP no configurado: los correos quedan en la cola sin enviarse.');
}

// Cobro: PayPal es la fuente de verdad; se concilia cada 3 horas (el aviso de PayPal solo acelera). Sin PayPal, el cobro está apagado.
if (pagos) {
  cada('conciliacion', 3 * 60 * 60 * 1000, () => conciliarTodas(ctx), 2 * 60 * 1000);
} else {
  console.warn('[cobro] PayPal no configurado: no se concilian suscripciones y el registro público no puede completarse.');
}
// Avisos incluidos de cada taller (servicios, citas, vencimientos, resúmenes): cada 15 minutos. Cada hecho se avisa una sola vez.
cada('avisos', 15 * 60 * 1000, () => barrerAvisos(ctx), 2 * 60 * 1000);
// Ciclo de vida (gracia, cierre de cuentas, avisos, altas atoradas): cada hora.
cada('ciclo', 60 * 60 * 1000, () => barrerCicloDeVida(ctx), 60 * 1000);

app.listen(entorno.PUERTO, () => {
  console.log(`VERI-TECH ${APP_VERSION} escuchando en el puerto ${entorno.PUERTO}`);
});
