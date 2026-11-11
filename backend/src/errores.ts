/** Error esperado: lleva el código HTTP y un mensaje que SÍ se le puede mostrar a la persona. */
export class ErrorApp extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    /** Datos adicionales que se le pueden mostrar a la persona (por ejemplo, el cliente que ya tiene ese NIT). */
    public readonly detalle?: unknown
  ) {
    super(mensaje);
    this.name = 'ErrorApp';
  }
}

export class ErrorValidacion extends ErrorApp {
  constructor(mensaje: string) {
    super(400, 'VALIDACION', mensaje);
    this.name = 'ErrorValidacion';
  }
}

export class ErrorNoEncontrado extends ErrorApp {
  constructor(mensaje = 'No encontrado') {
    super(404, 'NO_ENCONTRADO', mensaje);
    this.name = 'ErrorNoEncontrado';
  }
}

export class ErrorConflicto extends ErrorApp {
  constructor(mensaje: string) {
    super(409, 'CONFLICTO', mensaje);
    this.name = 'ErrorConflicto';
  }
}
