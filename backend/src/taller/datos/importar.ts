import { PoolConnection } from 'mysql2/promise';
import { ejecutar, filas } from '../../db/consulta';
import { ErrorApp, ErrorValidacion } from '../../errores';
import { Contexto } from '../../plataforma/contexto';
import { normalizarCampo } from '../../utils/texto';
import { crearClienteEn } from '../clientes';
import { Actor, bitacora, TallerReq } from '../comun';
import { hoyDelTaller, registrarLecturaEn } from '../contadores';
import { crearEquipoEn } from '../equipos';
import { registrarRealizadoEn } from '../servicios';
import { Celda, claveDeEncabezado, FilaDeHoja, leerHoja } from './libro';

/**
 * Carga masiva desde Excel. Reglas que no se negocian:
 *  - TODO O NADA: si una sola fila tiene error, no se carga ninguna (así se corrige el Excel y se vuelve a subir completo,
 *    sin duplicar lo que ya entró).
 *  - Se puede SIMULAR: se hace todo el trabajo real y al final se deshace, para que la persona vea los errores antes.
 *  - Cada fila pasa por las mismas funciones que usa la pantalla, así que cumple las mismas reglas (lecturas que solo
 *    avanzan, NIT único, tipos de equipo, etc.).
 */

export type TipoCarga = 'clientes' | 'equipos' | 'lecturas' | 'ultimos_servicios';

export interface ColumnaCarga {
  clave: string;
  encabezado: string;
  requerida: boolean;
  ayuda: string;
  ejemplo: string;
  tipo: 'texto' | 'numero' | 'entero' | 'fecha';
  /** Largo máximo del texto (el mismo que acepta la pantalla). */
  max?: number;
  /** Otros nombres con los que puede venir la columna. */
  alias?: string[];
  /** Nombre de la lista de opciones que la plantilla ofrece como desplegable. */
  lista?: string;
}

export interface OpcionesCarga {
  simular: boolean;
  crearMarcas: boolean;
}

/** Un error de una fila: dice en qué columna está el problema (si se sabe) y qué hacer. */
export class ErrorDeFila extends Error {
  constructor(
    public readonly columna: string | null,
    mensaje: string
  ) {
    super(mensaje);
  }
}

// ── Lectura de los valores de una fila ───────────────────────────────────────────────
export class Fila {
  constructor(
    private readonly f: FilaDeHoja,
    private readonly columnas: ColumnaCarga[]
  ) {}

  /** Número de fila tal como se ve en Excel. */
  get linea(): number {
    return this.f.numero;
  }

  private columna(clave: string): ColumnaCarga {
    const c = this.columnas.find((x) => x.clave === clave);
    if (!c) throw new Error(`Columna ${clave} no definida`);
    return c;
  }

  private crudo(c: ColumnaCarga): Celda {
    for (const nombre of [c.encabezado, ...(c.alias ?? [])]) {
      const v = this.f.celdas.get(claveDeEncabezado(nombre));
      if (v !== undefined) return v;
    }
    return null;
  }

  texto(clave: string): string | null {
    const c = this.columna(clave);
    const v = this.crudo(c);
    if (v === null) return null;
    if (v instanceof Date || typeof v === 'boolean') throw new ErrorDeFila(c.encabezado, 'Debe ser texto');
    const t = typeof v === 'number' ? String(v) : v.trim();
    if (t === '') return null;
    if (c.max !== undefined && t.length > c.max) throw new ErrorDeFila(c.encabezado, `Es demasiado largo (máximo ${c.max} letras)`);
    return t;
  }

  requerido(clave: string): string {
    const v = this.texto(clave);
    if (v === null) throw new ErrorDeFila(this.columna(clave).encabezado, 'Falta este dato');
    return v;
  }

  numero(clave: string): number | null {
    const c = this.columna(clave);
    const v = this.crudo(c);
    if (v === null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'string') {
      const limpio = v.replace(/\s+/g, '');
      const n = /^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(limpio) ? Number(limpio.replace(/,/g, '')) : Number(limpio.replace(',', '.'));
      if (Number.isFinite(n)) return n;
    }
    throw new ErrorDeFila(c.encabezado, 'Debe ser un número');
  }

  entero(clave: string): number | null {
    const n = this.numero(clave);
    if (n !== null && !Number.isInteger(n)) throw new ErrorDeFila(this.columna(clave).encabezado, 'Debe ser un número entero, sin decimales');
    return n;
  }

  /** Como `fecha`, pero rechaza lo que aún no ha pasado (una lectura o una compra no pueden ser del futuro). */
  fechaPasada(clave: string, hoy: string): string | null {
    const v = this.fecha(clave);
    if (v === null) return null;
    const columna = this.columna(clave).encabezado;
    const anioActual = Number(hoy.slice(0, 4));
    if (Number(v.slice(0, 4)) < 1980) throw new ErrorDeFila(columna, `El año debe ser 1980 o posterior`);
    if (v > hoy) throw new ErrorDeFila(columna, `No puede ser una fecha futura (hoy es ${hoy.slice(8, 10)}/${hoy.slice(5, 7)}/${anioActual})`);
    return v;
  }

  /** Devuelve la fecha como AAAA-MM-DD. Acepta fechas de Excel, DD/MM/AAAA y AAAA-MM-DD. */
  fecha(clave: string): string | null {
    const c = this.columna(clave);
    const v = this.crudo(c);
    if (v === null) return null;
    const mal = new ErrorDeFila(c.encabezado, 'La fecha no es válida. Use día/mes/año, por ejemplo 15/03/2026');
    let anio: number;
    let mes: number;
    let dia: number;
    if (v instanceof Date) {
      anio = v.getUTCFullYear();
      mes = v.getUTCMonth() + 1;
      dia = v.getUTCDate();
    } else if (typeof v === 'number') {
      if (v < 1 || v > 80000) throw mal;
      const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000); // fecha serial de Excel
      anio = d.getUTCFullYear();
      mes = d.getUTCMonth() + 1;
      dia = d.getUTCDate();
    } else if (typeof v === 'string') {
      const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(v);
      const latino = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/.exec(v);
      if (iso) [anio, mes, dia] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
      else if (latino) [dia, mes, anio] = [Number(latino[1]), Number(latino[2]), Number(latino[3])];
      else throw mal;
    } else throw mal;
    const prueba = new Date(Date.UTC(anio, mes - 1, dia));
    if (prueba.getUTCFullYear() !== anio || prueba.getUTCMonth() !== mes - 1 || prueba.getUTCDate() !== dia) throw new ErrorDeFila(c.encabezado, 'Esa fecha no existe en el calendario');
    return `${String(anio).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
  }
}

// ── Lo que ve un procesador mientras corre la carga ──────────────────────────────────
export interface EntornoCarga {
  ctx: Contexto;
  t: TallerReq;
  con: PoolConnection;
  actor: Actor;
  hoy: string;
  opciones: OpcionesCarga;
  /** Anota algo que no impide cargar pero que la persona debería saber. */
  aviso: (fila: number, mensaje: string) => void;
  /** Suma uno al conteo de lo creado (clientes, equipos, marcas…). */
  contar: (que: string) => void;
}

export type Procesador = (fila: Fila) => Promise<void>;

export interface Importador {
  tipo: TipoCarga;
  titulo: string;
  descripcion: string;
  columnas: ColumnaCarga[];
  /** Listas desplegables que la plantilla ofrece, sacadas de lo que ya tiene el taller. */
  listas: (t: TallerReq) => Promise<Record<string, string[]>>;
  preparar: (e: EntornoCarga) => Promise<Procesador>;
}

const buscarEn = <T>(mapa: Map<string, T[]>, clave: string): T[] => mapa.get(clave) ?? [];
function agregar<T>(mapa: Map<string, T[]>, clave: string | null, valor: T): void {
  if (!clave) return;
  const lista = mapa.get(clave) ?? [];
  if (!lista.includes(valor)) lista.push(valor);
  mapa.set(clave, lista);
}
const norma = (v: string): string => normalizarCampo('texto', v) ?? '';
const normaCodigo = (v: string): string => normalizarCampo('codigo', v) ?? '';
const nombres = (xs: string[]): string => (xs.length === 0 ? 'ninguno' : xs.slice(0, 12).join(', ') + (xs.length > 12 ? '…' : ''));

// ── Clientes ─────────────────────────────────────────────────────────────────────────
const COLUMNAS_CLIENTES: ColumnaCarga[] = [
  { clave: 'nombre', encabezado: 'NOMBRE', requerida: true, ayuda: 'Nombre o razón social. No puede repetirse con un cliente que ya exista.', ejemplo: 'TRANSPORTES EL SOL, S.A.', tipo: 'texto', max: 150 },
  { clave: 'nit', encabezado: 'NIT', requerida: false, ayuda: 'NIT sin guion. Si es consumidor final ponga CF. No puede repetirse.', ejemplo: '1234567K', tipo: 'texto', max: 30 },
  { clave: 'tipo_cliente', encabezado: 'TIPO DE CLIENTE', requerida: false, ayuda: 'Uno de los tipos que ya tiene el taller. Si lo deja vacío se usa el primero.', ejemplo: 'GENERAL', tipo: 'texto', max: 80, lista: 'tipos_cliente' },
  { clave: 'telefono', encabezado: 'TELEFONO', requerida: false, ayuda: 'Teléfono del cliente.', ejemplo: '2222-3333', tipo: 'texto', max: 40 },
  { clave: 'correo', encabezado: 'CORREO', requerida: false, ayuda: 'Correo del cliente.', ejemplo: 'compras@elsol.com', tipo: 'texto', max: 150 },
  { clave: 'direccion', encabezado: 'DIRECCION', requerida: false, ayuda: 'Dirección.', ejemplo: '5A AVENIDA 10-20 ZONA 1', tipo: 'texto', max: 250 },
  { clave: 'contacto', encabezado: 'CONTACTO', requerida: false, ayuda: 'Persona con quien se trata.', ejemplo: 'JUAN PEREZ', tipo: 'texto', max: 120 },
  { clave: 'telefono_contacto', encabezado: 'TELEFONO DEL CONTACTO', requerida: false, ayuda: 'Teléfono de esa persona.', ejemplo: '5555-1234', tipo: 'texto', max: 40 },
  { clave: 'correo_contacto', encabezado: 'CORREO DEL CONTACTO', requerida: false, ayuda: 'Correo de esa persona.', ejemplo: 'jperez@elsol.com', tipo: 'texto', max: 150 },
  { clave: 'condicion', encabezado: 'CONDICION DE PAGO', requerida: false, ayuda: 'CONTADO o CREDITO. Si lo deja vacío se usa CONTADO.', ejemplo: 'CREDITO', tipo: 'texto', max: 20, lista: 'condiciones' },
  { clave: 'dias_credito', encabezado: 'DIAS DE CREDITO', requerida: false, ayuda: 'Obligatorio si la condición es CREDITO.', ejemplo: '30', tipo: 'entero' },
  { clave: 'limite_credito', encabezado: 'LIMITE DE CREDITO', requerida: false, ayuda: 'Monto máximo de crédito.', ejemplo: '15000', tipo: 'numero' },
  { clave: 'notas', encabezado: 'NOTAS', requerida: false, ayuda: 'Cualquier observación.', ejemplo: '', tipo: 'texto', max: 500 },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const importadorClientes: Importador = {
  tipo: 'clientes',
  titulo: 'Clientes',
  descripcion: 'Una fila por cliente. Los equipos se cargan después, en su propia plantilla, y se ligan al cliente por su nombre o NIT.',
  columnas: COLUMNAS_CLIENTES,
  async listas(t) {
    const tipos = await filas<{ nombre: string }>(t.pool, 'SELECT nombre FROM tipos_cliente WHERE activo = 1 ORDER BY nombre');
    return { tipos_cliente: tipos.map((x) => x.nombre), condiciones: ['CONTADO', 'CREDITO'] };
  },
  async preparar(e) {
    const tipos = new Map((await filas<{ id: number; nombre: string }>(e.con, 'SELECT id, nombre FROM tipos_cliente WHERE activo = 1')).map((x) => [norma(x.nombre), x.id]));
    const existentes = new Set((await filas<{ nombre: string }>(e.con, 'SELECT nombre FROM clientes')).map((x) => norma(x.nombre)));
    return async (f) => {
      const nombre = f.requerido('nombre');
      if (nombre.length < 2) throw new ErrorDeFila('NOMBRE', 'El nombre es demasiado corto');
      const clave = norma(nombre);
      if (existentes.has(clave)) throw new ErrorDeFila('NOMBRE', 'Ya hay un cliente con ese nombre (en el sistema o más arriba en este mismo archivo). Si es otro cliente, agréguele algo que lo distinga.');
      const tipoTxt = f.texto('tipo_cliente');
      let tipoId: number | undefined;
      if (tipoTxt) {
        tipoId = tipos.get(norma(tipoTxt));
        if (tipoId === undefined) throw new ErrorDeFila('TIPO DE CLIENTE', `El tipo «${tipoTxt}» no existe. Los tipos del taller son: ${nombres([...tipos.keys()])}`);
      }
      const condTxt = f.texto('condicion');
      let condicion: 'contado' | 'credito' | undefined;
      if (condTxt) {
        const c = norma(condTxt);
        if (c === 'CONTADO') condicion = 'contado';
        else if (c === 'CREDITO') condicion = 'credito';
        else throw new ErrorDeFila('CONDICION DE PAGO', 'Escriba CONTADO o CREDITO');
      }
      const dias = f.entero('dias_credito');
      if (dias !== null && (dias < 0 || dias > 3650)) throw new ErrorDeFila('DIAS DE CREDITO', 'Los días de crédito deben estar entre 0 y 3650');
      const limite = f.numero('limite_credito');
      if (limite !== null && (limite < 0 || limite > 9999999999)) throw new ErrorDeFila('LIMITE DE CREDITO', 'El límite de crédito no es válido');
      const correo = f.texto('correo');
      if (correo && !EMAIL.test(correo)) throw new ErrorDeFila('CORREO', 'El correo no es válido');
      const correoContacto = f.texto('correo_contacto');
      if (correoContacto && !EMAIL.test(correoContacto)) throw new ErrorDeFila('CORREO DEL CONTACTO', 'El correo no es válido');
      const r = await crearClienteEn(e.con, e.actor, {
        nombre,
        nit: f.texto('nit'),
        tipo_cliente_id: tipoId ?? null,
        telefono: f.texto('telefono'),
        email: correo,
        direccion: f.texto('direccion'),
        contacto_nombre: f.texto('contacto'),
        contacto_telefono: f.texto('telefono_contacto'),
        contacto_email: correoContacto,
        condicion_pago: condicion,
        dias_credito: dias ?? undefined,
        limite_credito: limite ?? undefined,
        notas: f.texto('notas'),
      });
      existentes.add(clave);
      e.contar('clientes');
      for (const a of r.avisos) e.aviso(f.linea, `${a.campo === 'email' ? 'El correo' : 'El teléfono'} ya lo tiene el cliente ${a.cliente.nombre}`);
    };
  },
};

// ── Equipos ──────────────────────────────────────────────────────────────────────────
const COLUMNAS_EQUIPOS: ColumnaCarga[] = [
  { clave: 'cliente', encabezado: 'CLIENTE', requerida: false, ayuda: 'Nombre o NIT del cliente dueño. Déjelo vacío si el equipo es del propio taller. El cliente debe existir.', ejemplo: 'TRANSPORTES EL SOL, S.A.', tipo: 'texto', max: 150 },
  { clave: 'tipo_equipo', encabezado: 'TIPO DE EQUIPO', requerida: true, ayuda: 'Uno de los tipos del taller (nombre o código).', ejemplo: 'VEHICULO', tipo: 'texto', max: 80, lista: 'tipos_equipo' },
  { clave: 'codigo_interno', encabezado: 'CODIGO INTERNO', requerida: false, ayuda: 'El número con que el cliente conoce su equipo. No se repite dentro del mismo cliente. Ponga al menos uno: código interno, placa o serie.', ejemplo: 'CAM-014', tipo: 'texto', max: 40 },
  { clave: 'placa', encabezado: 'PLACA', requerida: false, ayuda: 'Solo para vehículos.', ejemplo: 'C123ABC', tipo: 'texto', max: 20 },
  { clave: 'serie', encabezado: 'SERIE', requerida: false, ayuda: 'Número de serie o chasis. No puede repetirse en ningún equipo.', ejemplo: '3AKJHHDR5NSNN1234', tipo: 'texto', max: 60 },
  { clave: 'marca', encabezado: 'MARCA', requerida: false, ayuda: 'Debe existir en el taller (o marque la casilla para crear las que falten al cargar).', ejemplo: 'FREIGHTLINER', tipo: 'texto', max: 80 },
  { clave: 'modelo', encabezado: 'MODELO', requerida: false, ayuda: 'Modelo.', ejemplo: 'CASCADIA', tipo: 'texto', max: 80 },
  { clave: 'anio', encabezado: 'AÑO', requerida: false, ayuda: 'Año del modelo.', ejemplo: '2022', tipo: 'entero', alias: ['ANIO'] },
  { clave: 'color', encabezado: 'COLOR', requerida: false, ayuda: 'Color.', ejemplo: 'BLANCO', tipo: 'texto', max: 40 },
  { clave: 'motor_marca', encabezado: 'MARCA DEL MOTOR', requerida: false, ayuda: 'Marca del motor.', ejemplo: 'DETROIT', tipo: 'texto', max: 60 },
  { clave: 'motor_modelo', encabezado: 'MODELO DEL MOTOR', requerida: false, ayuda: 'Modelo del motor.', ejemplo: 'DD15', tipo: 'texto', max: 60 },
  { clave: 'motor_serie', encabezado: 'SERIE DEL MOTOR', requerida: false, ayuda: 'Serie del motor.', ejemplo: '472901C0123456', tipo: 'texto', max: 60 },
  { clave: 'combustible', encabezado: 'COMBUSTIBLE', requerida: false, ayuda: 'Solo para tipos que usan combustible.', ejemplo: 'DIESEL', tipo: 'texto', max: 30 },
  { clave: 'capacidad_tanque', encabezado: 'CAPACIDAD DEL TANQUE', requerida: false, ayuda: 'Solo para tipos que usan combustible.', ejemplo: '300', tipo: 'numero' },
  { clave: 'tipo_contador', encabezado: 'TIPO DE CONTADOR', requerida: false, ayuda: 'Medidor con el que nace el equipo (odómetro, horómetro…). Obligatorio si llena la lectura.', ejemplo: 'ODOMETRO', tipo: 'texto', max: 80, lista: 'tipos_contador' },
  { clave: 'lectura', encabezado: 'LECTURA ACTUAL', requerida: false, ayuda: 'Lo que marca el medidor hoy (o en la fecha que ponga). Un contador de calendario siempre empieza en 0.', ejemplo: '125400', tipo: 'numero' },
  { clave: 'fecha_lectura', encabezado: 'FECHA DE LECTURA', requerida: false, ayuda: 'Día en que se tomó esa lectura. Si la deja vacía se usa hoy. Las lecturas históricas que cargue después no pueden ser anteriores a esta fecha.', ejemplo: '15/03/2026', tipo: 'fecha' },
  { clave: 'notas', encabezado: 'NOTAS', requerida: false, ayuda: 'Cualquier observación.', ejemplo: '', tipo: 'texto', max: 500 },
];

interface EquipoLigero {
  id: number;
  cliente_id: number | null;
  codigo_interno: string | null;
  placa: string | null;
  serie: string | null;
}

/** Busca un cliente por nombre o NIT. Devuelve null si no hay, y falla si hay más de uno. */
function buscarCliente(texto: string, porNombre: Map<string, number[]>, porNit: Map<string, number[]>): number | null {
  const candidatos = [...new Set([...buscarEn(porNombre, norma(texto)), ...buscarEn(porNit, normalizarCampo('nit', texto) ?? '')])];
  if (candidatos.length > 1) throw new ErrorDeFila('CLIENTE', `Hay ${candidatos.length} clientes que coinciden con «${texto}». Use el NIT para distinguirlos.`);
  return candidatos[0] ?? null;
}

async function indicesDeClientes(e: EntornoCarga): Promise<{ porNombre: Map<string, number[]>; porNit: Map<string, number[]> }> {
  const porNombre = new Map<string, number[]>();
  const porNit = new Map<string, number[]>();
  for (const c of await filas<{ id: number; nombre: string; nit: string | null }>(e.con, 'SELECT id, nombre, nit FROM clientes WHERE activo = 1')) {
    agregar(porNombre, norma(c.nombre), c.id);
    if (c.nit && c.nit !== 'CF') agregar(porNit, c.nit, c.id);
  }
  return { porNombre, porNit };
}

const importadorEquipos: Importador = {
  tipo: 'equipos',
  titulo: 'Equipos',
  descripcion: 'Una fila por equipo (vehículo, maquinaria…). Puede incluir el medidor con el que nace y su lectura de hoy; las lecturas viejas se cargan en la plantilla de lecturas.',
  columnas: COLUMNAS_EQUIPOS,
  async listas(t) {
    const tipos = await filas<{ nombre: string }>(t.pool, 'SELECT nombre FROM tipos_equipo WHERE activo = 1 ORDER BY nombre');
    const contadores = await filas<{ nombre: string }>(t.pool, 'SELECT nombre FROM tipos_contador WHERE activo = 1 ORDER BY nombre');
    return { tipos_equipo: tipos.map((x) => x.nombre), tipos_contador: contadores.map((x) => x.nombre) };
  },
  async preparar(e) {
    const tipos = new Map<string, number>();
    const nombresDeTipos: string[] = [];
    for (const x of await filas<{ id: number; codigo: string; nombre: string }>(e.con, 'SELECT id, codigo, nombre FROM tipos_equipo WHERE activo = 1 ORDER BY nombre')) {
      nombresDeTipos.push(x.nombre);
      tipos.set(norma(x.nombre), x.id);
      tipos.set(norma(x.codigo), x.id);
    }
    const tiposContador = new Map((await filas<{ id: number; nombre: string }>(e.con, 'SELECT id, nombre FROM tipos_contador WHERE activo = 1')).map((x) => [norma(x.nombre), x.id]));
    const { porNombre, porNit } = await indicesDeClientes(e);
    const marcas = new Map<string, Array<{ id: number; tipo: number | null }>>();
    for (const m of await filas<{ id: number; nombre: string; tipo_equipo_id: number | null }>(e.con, 'SELECT id, nombre, tipo_equipo_id FROM marcas WHERE activo = 1')) agregar(marcas, norma(m.nombre), { id: m.id, tipo: m.tipo_equipo_id });

    return async (f) => {
      const tipoTxt = f.requerido('tipo_equipo');
      const tipoId = tipos.get(norma(tipoTxt));
      if (tipoId === undefined) throw new ErrorDeFila('TIPO DE EQUIPO', `El tipo «${tipoTxt}» no existe. Los tipos del taller son: ${nombres(nombresDeTipos)}`);

      const clienteTxt = f.texto('cliente');
      let clienteId: number | null = null;
      if (clienteTxt) {
        clienteId = buscarCliente(clienteTxt, porNombre, porNit);
        if (clienteId === null) throw new ErrorDeFila('CLIENTE', `No existe un cliente llamado «${clienteTxt}». Cárguelo primero en la plantilla de clientes, o revise cómo está escrito.`);
      }

      const codigo = f.texto('codigo_interno');
      const placa = f.texto('placa');
      const serie = f.texto('serie');
      if (!codigo && !placa && !serie) throw new ErrorDeFila('CODIGO INTERNO', 'Ponga al menos uno de estos datos para poder reconocer el equipo: código interno, placa o serie');

      let marcaId: number | null = null;
      const marcaTxt = f.texto('marca');
      if (marcaTxt) {
        const clave = norma(marcaTxt);
        const opciones = buscarEn(marcas, clave);
        const elegida = opciones.find((m) => m.tipo === tipoId) ?? opciones.find((m) => m.tipo === null);
        if (elegida) marcaId = elegida.id;
        else if (opciones.length > 0) throw new ErrorDeFila('MARCA', `La marca «${marcaTxt}» existe, pero es de otro tipo de equipo`);
        else if (e.opciones.crearMarcas) {
          const r = await ejecutar(e.con, 'INSERT INTO marcas (nombre) VALUES (?)', [clave]);
          marcaId = r.insertId;
          agregar(marcas, clave, { id: marcaId, tipo: null });
          e.contar('marcas');
        } else throw new ErrorDeFila('MARCA', `La marca «${marcaTxt}» no existe. Revise cómo está escrita, agréguela en el catálogo de marcas o marque «Crear las marcas que falten» al cargar.`);
      }

      const lectura = f.numero('lectura');
      const fechaLectura = f.fechaPasada('fecha_lectura', e.hoy);
      const contadorTxt = f.texto('tipo_contador');
      let contadores: Array<{ tipo_contador_id: number; valor_inicial?: number; fecha_inicio?: string }> | undefined;
      if (contadorTxt) {
        const id = tiposContador.get(norma(contadorTxt));
        if (id === undefined) throw new ErrorDeFila('TIPO DE CONTADOR', `El tipo de contador «${contadorTxt}» no existe. Los tipos son: ${nombres([...tiposContador.keys()])}`);
        contadores = [{ tipo_contador_id: id, valor_inicial: lectura ?? 0, ...(fechaLectura ? { fecha_inicio: fechaLectura } : {}) }];
      } else if (lectura !== null || fechaLectura !== null) {
        throw new ErrorDeFila('TIPO DE CONTADOR', 'Indique el tipo de contador (odómetro, horómetro…) para poder guardar la lectura');
      }

      const anio = f.entero('anio');
      const tanque = f.numero('capacidad_tanque');
      const r = await crearEquipoEn(e.ctx, e.t, e.con, e.actor, {
        tipo_equipo_id: tipoId,
        propiedad: clienteId === null ? 'propio' : 'cliente',
        cliente_id: clienteId,
        codigo_interno: codigo,
        placa,
        serie,
        marca_id: marcaId,
        modelo: f.texto('modelo'),
        anio,
        color: f.texto('color'),
        motor_marca: f.texto('motor_marca'),
        motor_modelo: f.texto('motor_modelo'),
        motor_serie: f.texto('motor_serie'),
        combustible: f.texto('combustible'),
        capacidad_tanque: tanque,
        notas: f.texto('notas'),
        contadores,
      });
      e.contar('equipos');
      if (contadores) e.contar('contadores');
      if (r.aviso) e.aviso(f.linea, `La placa ${placa} ya la tiene otro equipo (${r.aviso.equipo.descripcion}). Si es un error, corríjala después.`);
    };
  },
};

// ── Lecturas de contador (historial) ─────────────────────────────────────────────────
const COLUMNAS_LECTURAS: ColumnaCarga[] = [
  { clave: 'equipo', encabezado: 'EQUIPO', requerida: true, ayuda: 'Código interno, placa o serie del equipo (debe estar ya cargado).', ejemplo: 'CAM-014', tipo: 'texto', max: 60 },
  { clave: 'cliente', encabezado: 'CLIENTE', requerida: false, ayuda: 'Solo si el código interno se repite entre clientes: nombre o NIT del dueño.', ejemplo: '', tipo: 'texto', max: 150 },
  { clave: 'tipo_contador', encabezado: 'TIPO DE CONTADOR', requerida: false, ayuda: 'Solo si el equipo tiene más de un medidor (por ejemplo odómetro y horómetro).', ejemplo: 'ODOMETRO', tipo: 'texto', max: 80, lista: 'tipos_contador' },
  { clave: 'lectura', encabezado: 'LECTURA', requerida: true, ayuda: 'Lo que marcaba el medidor. Un medidor solo avanza: cada lectura debe ser mayor o igual a la anterior.', ejemplo: '118200', tipo: 'numero' },
  { clave: 'fecha', encabezado: 'FECHA', requerida: true, ayuda: 'Día de la lectura, no puede ser futura ni anterior al inicio del contador.', ejemplo: '10/01/2026', tipo: 'fecha' },
  { clave: 'notas', encabezado: 'NOTAS', requerida: false, ayuda: 'Cualquier observación.', ejemplo: '', tipo: 'texto', max: 300 },
];

const importadorLecturas: Importador = {
  tipo: 'lecturas',
  titulo: 'Lecturas de contador',
  descripcion: 'Una fila por lectura del odómetro, horómetro u otro medidor, para cargar el historial de un equipo ya registrado. Pueden ir en cualquier orden.',
  columnas: COLUMNAS_LECTURAS,
  async listas(t) {
    const contadores = await filas<{ nombre: string }>(t.pool, 'SELECT nombre FROM tipos_contador WHERE activo = 1 AND es_calendario = 0 ORDER BY nombre');
    return { tipos_contador: contadores.map((x) => x.nombre) };
  },
  async preparar(e) {
    const { porNombre, porNit } = await indicesDeClientes(e);
    const porClave = new Map<string, EquipoLigero[]>();
    for (const q of await filas<EquipoLigero>(e.con, 'SELECT id, cliente_id, codigo_interno, placa, serie FROM equipos')) {
      for (const k of [q.codigo_interno, q.placa, q.serie]) agregar(porClave, k, q);
    }
    const contadoresDe = new Map<number, Array<{ id: number; nombre: string; tipo: string; principal: boolean; componente: boolean }>>();

    return async (f) => {
      const idTxt = f.requerido('equipo');
      let candidatos = buscarEn(porClave, normaCodigo(idTxt));
      const clienteTxt = f.texto('cliente');
      if (clienteTxt) {
        const clienteId = buscarCliente(clienteTxt, porNombre, porNit);
        if (clienteId === null) throw new ErrorDeFila('CLIENTE', `No existe un cliente llamado «${clienteTxt}»`);
        candidatos = candidatos.filter((q) => q.cliente_id === clienteId);
      }
      if (candidatos.length === 0) throw new ErrorDeFila('EQUIPO', `No se encontró un equipo con el código, placa o serie «${idTxt}». Cárguelo primero en la plantilla de equipos.`);
      if (candidatos.length > 1) throw new ErrorDeFila('EQUIPO', `Hay ${candidatos.length} equipos con «${idTxt}». Agregue el cliente o use la serie para distinguirlos.`);
      const equipo = candidatos[0] as EquipoLigero;

      let lista = contadoresDe.get(equipo.id);
      if (!lista) {
        lista = (
          await filas<{ id: number; nombre: string; tipo: string; es_principal: number; componente_id: number | null }>(
            e.con,
            `SELECT ct.id, ct.nombre, tc.nombre AS tipo, ct.es_principal, ct.componente_id FROM contadores ct JOIN tipos_contador tc ON tc.id = ct.tipo_contador_id
              WHERE ct.equipo_id = ? AND ct.activo = 1 AND tc.es_calendario = 0 ORDER BY ct.id`,
            [equipo.id]
          )
        ).map((c) => ({ id: c.id, nombre: c.nombre, tipo: norma(c.tipo), principal: c.es_principal === 1, componente: c.componente_id !== null }));
        contadoresDe.set(equipo.id, lista);
      }
      if (lista.length === 0) throw new ErrorDeFila('EQUIPO', `El equipo «${idTxt}» no tiene ningún medidor al que se le registren lecturas. Agréguele uno en su ficha.`);
      let elegibles = lista;
      const tipoTxt = f.texto('tipo_contador');
      if (tipoTxt) {
        elegibles = lista.filter((c) => c.tipo === norma(tipoTxt));
        if (elegibles.length === 0) throw new ErrorDeFila('TIPO DE CONTADOR', `El equipo «${idTxt}» no tiene un medidor de tipo «${tipoTxt}». Tiene: ${nombres([...new Set(lista.map((c) => c.tipo))])}`);
      }
      let contador = elegibles.length === 1 ? elegibles[0] : undefined;
      if (!contador) {
        const principales = elegibles.filter((c) => c.principal && !c.componente);
        if (principales.length === 1) contador = principales[0];
      }
      if (!contador) throw new ErrorDeFila('TIPO DE CONTADOR', `El equipo «${idTxt}» tiene varios medidores (${nombres(elegibles.map((c) => c.nombre))}). Indique cuál en la columna TIPO DE CONTADOR.`);

      const valor = f.numero('lectura');
      if (valor === null) throw new ErrorDeFila('LECTURA', 'Falta este dato');
      const fecha = f.fechaPasada('fecha', e.hoy);
      if (fecha === null) throw new ErrorDeFila('FECHA', 'Falta este dato');
      await registrarLecturaEn(e.ctx, e.t, e.con, e.actor, contador.id, { valor, fecha, notas: f.texto('notas'), origen: 'importacion' });
      e.contar('lecturas');
    };
  },
};

// ── Últimos servicios (historial de mantenimiento) ───────────────────────────────────
const COLUMNAS_SERVICIOS: ColumnaCarga[] = [
  { clave: 'equipo', encabezado: 'EQUIPO', requerida: true, ayuda: 'Código interno, placa o serie del equipo (debe estar ya cargado).', ejemplo: 'CAM-014', tipo: 'texto', max: 60 },
  { clave: 'cliente', encabezado: 'CLIENTE', requerida: false, ayuda: 'Solo si el código interno se repite entre clientes: nombre o NIT del dueño.', ejemplo: '', tipo: 'texto', max: 150 },
  { clave: 'servicio', encabezado: 'SERVICIO', requerida: true, ayuda: 'Nombre del servicio programado que lleva el tipo de ese equipo (se definen en Servicios → Programas).', ejemplo: 'SERVICIO DE 10000 KM', tipo: 'texto', max: 120, lista: 'servicios' },
  { clave: 'fecha', encabezado: 'FECHA', requerida: true, ayuda: 'Día en que se hizo el último servicio (no puede ser futuro).', ejemplo: '20/12/2025', tipo: 'fecha' },
  { clave: 'contador', encabezado: 'CONTADOR', requerida: false, ayuda: 'Lo que marcaba el medidor ese día (no puede ser mayor que lo que marca hoy). En servicios por calendario se calcula solo.', ejemplo: '110000', tipo: 'numero' },
];

const importadorServicios: Importador = {
  tipo: 'ultimos_servicios',
  titulo: 'Últimos servicios',
  descripcion: 'Una fila por servicio ya hecho (el último de cada tipo), para que el sistema sepa cuándo toca el siguiente. Los equipos y los servicios programados deben existir.',
  columnas: COLUMNAS_SERVICIOS,
  async listas(t) {
    const nombres = await filas<{ nombre: string }>(t.pool, 'SELECT DISTINCT nombre FROM servicios_programados WHERE activo = 1 ORDER BY nombre');
    return { servicios: nombres.map((x) => x.nombre) };
  },
  async preparar(e) {
    const { porNombre, porNit } = await indicesDeClientes(e);
    const equipos = new Map<string, Array<EquipoLigero & { tipo_equipo_id: number }>>();
    for (const q of await filas<EquipoLigero & { tipo_equipo_id: number }>(e.con, 'SELECT id, tipo_equipo_id, cliente_id, codigo_interno, placa, serie FROM equipos')) {
      for (const k of [q.codigo_interno, q.placa, q.serie]) agregar(equipos, k, q);
    }
    const servicios = await filas<{ id: number; tipo_equipo_id: number; nombre: string; es_calendario: number }>(e.con, 'SELECT sp.id, sp.tipo_equipo_id, sp.nombre, tc.es_calendario FROM servicios_programados sp JOIN tipos_contador tc ON tc.id = sp.tipo_contador_id WHERE sp.activo = 1');
    return async (f) => {
      const idTxt = f.requerido('equipo');
      let candidatos = buscarEn(equipos, normaCodigo(idTxt));
      const clienteTxt = f.texto('cliente');
      if (clienteTxt) {
        const clienteId = buscarCliente(clienteTxt, porNombre, porNit);
        if (clienteId === null) throw new ErrorDeFila('CLIENTE', `No existe un cliente llamado «${clienteTxt}»`);
        candidatos = candidatos.filter((q) => q.cliente_id === clienteId);
      }
      if (candidatos.length === 0) throw new ErrorDeFila('EQUIPO', `No se encontró un equipo con el código, placa o serie «${idTxt}». Cárguelo primero en la plantilla de equipos.`);
      if (candidatos.length > 1) throw new ErrorDeFila('EQUIPO', `Hay ${candidatos.length} equipos con «${idTxt}». Agregue el cliente o use la serie para distinguirlos.`);
      const equipo = candidatos[0] as EquipoLigero & { tipo_equipo_id: number };
      const nombreServicio = f.requerido('servicio');
      const delTipo = servicios.filter((s) => s.tipo_equipo_id === equipo.tipo_equipo_id);
      const servicio = delTipo.find((s) => norma(s.nombre) === norma(nombreServicio));
      if (!servicio) throw new ErrorDeFila('SERVICIO', `Los equipos de ese tipo no tienen un servicio llamado «${nombreServicio}». Los que tienen son: ${nombres(delTipo.map((s) => s.nombre))}`);
      const fecha = f.fechaPasada('fecha', e.hoy);
      if (fecha === null) throw new ErrorDeFila('FECHA', 'Falta este dato');
      const contador = f.numero('contador');
      if (contador === null && servicio.es_calendario !== 1) throw new ErrorDeFila('CONTADOR', 'Diga qué marcaba el medidor ese día (solo los servicios por calendario no lo piden)');
      await registrarRealizadoEn(e.ctx, e.t, e.con, e.actor, { equipo_id: equipo.id, servicio_id: servicio.id, fecha, contador_valor: contador ?? undefined, origen: 'historico' });
      e.contar('servicios');
    };
  },
};

export const IMPORTADORES: Record<TipoCarga, Importador> = {
  clientes: importadorClientes,
  equipos: importadorEquipos,
  lecturas: importadorLecturas,
  ultimos_servicios: importadorServicios,
};

export function esTipoDeCarga(valor: string): valor is TipoCarga {
  return Object.prototype.hasOwnProperty.call(IMPORTADORES, valor);
}

// ── Motor de la carga ────────────────────────────────────────────────────────────────
export interface ErrorDeCarga {
  fila: number;
  columna: string | null;
  mensaje: string;
}

export interface ResultadoCarga {
  tipo: TipoCarga;
  /** true si solo fue una prueba (no se guardó nada). */
  simulacion: boolean;
  /** true si los datos quedaron guardados. */
  aplicado: boolean;
  total_filas: number;
  correctas: number;
  con_error: number;
  errores: ErrorDeCarga[];
  avisos: Array<{ fila: number; mensaje: string }>;
  columnas_ignoradas: string[];
  /** Lo que se creó (o se habría creado, si fue simulación). */
  creados: Record<string, number>;
}

const MAXIMO_ERRORES_MOSTRADOS = 300;

export async function ejecutarCarga(ctx: Contexto, t: TallerReq, actor: Actor, tipo: TipoCarga, buffer: Buffer, opciones: OpcionesCarga): Promise<ResultadoCarga> {
  const importador = IMPORTADORES[tipo];
  const hoja = await leerHoja(buffer, 'Datos');
  const conocidas = new Set(importador.columnas.flatMap((c) => [c.encabezado, ...(c.alias ?? [])].map(claveDeEncabezado)));
  const faltan = importador.columnas.filter((c) => c.requerida && ![c.encabezado, ...(c.alias ?? [])].some((n) => hoja.encabezados.includes(claveDeEncabezado(n))));
  if (faltan.length > 0) {
    throw new ErrorValidacion(`Al archivo le falta la columna ${faltan.map((c) => `«${c.encabezado}»`).join(', ')}. Use la plantilla que descargó del sistema y no cambie los nombres de las columnas.`);
  }
  if (hoja.filas.length === 0) throw new ErrorValidacion('El archivo no tiene ninguna fila con datos para cargar');

  const errores: ErrorDeCarga[] = [];
  const avisos: Array<{ fila: number; mensaje: string }> = [];
  const creados: Record<string, number> = {};
  let correctas = 0;
  let conError = 0;
  const con = await t.pool.getConnection();
  try {
    await con.beginTransaction();
    const entorno: EntornoCarga = {
      ctx,
      t,
      con,
      actor,
      hoy: hoyDelTaller(ctx, t),
      opciones,
      aviso: (fila, mensaje) => {
        if (avisos.length < 200) avisos.push({ fila, mensaje });
      },
      contar: (que) => {
        creados[que] = (creados[que] ?? 0) + 1;
      },
    };
    const procesar = await importador.preparar(entorno);
    for (const celdas of hoja.filas) {
      const fila = new Fila(celdas, importador.columnas);
      await con.query('SAVEPOINT fila_de_carga');
      const antes = { ...creados };
      try {
        await procesar(fila);
        correctas++;
      } catch (error) {
        await con.query('ROLLBACK TO SAVEPOINT fila_de_carga');
        // Lo contado en una fila fallida se descuenta (también se deshizo en la base).
        for (const k of Object.keys(creados)) creados[k] = antes[k] ?? 0;
        conError++;
        if (error instanceof ErrorDeFila) {
          if (errores.length < MAXIMO_ERRORES_MOSTRADOS) errores.push({ fila: celdas.numero, columna: error.columna, mensaje: error.message });
        } else if (error instanceof ErrorApp) {
          if (errores.length < MAXIMO_ERRORES_MOSTRADOS) errores.push({ fila: celdas.numero, columna: null, mensaje: error.message });
        } else {
          throw error;
        }
      }
    }
    const aplicar = !opciones.simular && conError === 0;
    if (aplicar) {
      await bitacora(con, actor, { accion: 'carga_masiva', entidad: tipo, despues: { filas: hoja.filas.length, creados } });
      await con.commit();
    } else {
      await con.rollback();
    }
    return {
      tipo,
      simulacion: opciones.simular,
      aplicado: aplicar,
      total_filas: hoja.filas.length,
      correctas,
      con_error: conError,
      errores,
      avisos,
      columnas_ignoradas: hoja.encabezados.filter((h) => !conocidas.has(h)),
      creados,
    };
  } catch (error) {
    await con.rollback().catch(() => undefined);
    throw error;
  } finally {
    con.release();
  }
}
