/**
 * Los errores de la app, separados por lo que la persona debe hacer:
 *  - ErrorDeRed: no se pudo hablar con el servidor (sin señal, señal débil, servidor caído). Lo pendiente se conserva y se reintenta; NUNCA cierra la sesión.
 *  - ErrorDelServidor: el servidor contestó y dijo que no (400, 403, 404, 409…). No se reintenta solo: se le muestra a la persona.
 *  - SesionVencida: ya no hay forma de renovar la sesión; hay que ingresar de nuevo (lo pendiente de esta misma persona se conserva).
 */
export type TipoDeRed = 'sin_senal' | 'senal_debil' | 'servidor_caido';

export class ErrorDeRed extends Error {
  constructor(
    public readonly tipo: TipoDeRed,
    mensaje?: string
  ) {
    super(mensaje ?? MENSAJE_DE_RED[tipo]);
    this.name = 'ErrorDeRed';
  }
}

export const MENSAJE_DE_RED: Record<TipoDeRed, string> = {
  sin_senal: 'No hay señal. Lo que haga se guarda en el teléfono y se envía solo cuando vuelva.',
  senal_debil: 'La señal es muy débil y el servidor no respondió a tiempo.',
  servidor_caido: 'El servidor no está respondiendo en este momento.',
};

export class ErrorDelServidor extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly detalle?: unknown
  ) {
    super(mensaje);
    this.name = 'ErrorDelServidor';
  }
}

export class SesionVencida extends Error {
  constructor(mensaje = 'Su sesión venció. Ingrese de nuevo con su correo y contraseña.') {
    super(mensaje);
    this.name = 'SesionVencida';
  }
}

/** Un cambio sin enviar impide cerrar la sesión sin avisar. */
export class HayPendientes extends Error {
  constructor(public readonly cantidad: number) {
    super(`Hay ${cantidad} ${cantidad === 1 ? 'cambio' : 'cambios'} sin enviar. Si sale ahora, se perderán.`);
    this.name = 'HayPendientes';
  }
}
