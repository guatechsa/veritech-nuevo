import ExcelJS from 'exceljs';
import { ErrorValidacion } from '../../errores';

/**
 * Lectura y escritura de libros de Excel (.xlsx) para la carga masiva y la descarga de datos.
 * Todo lo que llega de afuera se trata como desconfiable: se revisa que sea de verdad un .xlsx, que no sea un archivo
 * "bomba" (pequeño comprimido pero enorme al abrirse) y que no tenga más filas de las permitidas.
 */

export const MAXIMO_BYTES_EXCEL = 5 * 1024 * 1024;
export const MAXIMO_FILAS = 2000;
const MAXIMO_DESCOMPRIMIDO = 80 * 1024 * 1024;
const MAXIMO_ENTRADAS_ZIP = 300;

/** Revisa la "tabla de contenido" del .xlsx (que es un zip) sin abrirlo: tamaño total al abrirse y cantidad de partes. */
export function revisarZip(buffer: Buffer): void {
  const noEsExcel = new ErrorValidacion('El archivo no es un libro de Excel (.xlsx). Use la plantilla que descargó del sistema.');
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) throw noEsExcel;
  let fin = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 22 - 65535); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      fin = i;
      break;
    }
  }
  if (fin < 0) throw noEsExcel;
  const entradas = buffer.readUInt16LE(fin + 10);
  const inicioDirectorio = buffer.readUInt32LE(fin + 16);
  if (entradas === 0xffff || inicioDirectorio === 0xffffffff) throw noEsExcel;
  if (entradas > MAXIMO_ENTRADAS_ZIP) throw new ErrorValidacion('El archivo de Excel tiene demasiadas partes. Use la plantilla que descargó del sistema.');
  let posicion = inicioDirectorio;
  let total = 0;
  for (let n = 0; n < entradas; n++) {
    if (posicion + 46 > buffer.length || buffer.readUInt32LE(posicion) !== 0x02014b50) throw noEsExcel;
    total += buffer.readUInt32LE(posicion + 24);
    posicion += 46 + buffer.readUInt16LE(posicion + 28) + buffer.readUInt16LE(posicion + 30) + buffer.readUInt16LE(posicion + 32);
  }
  if (total > MAXIMO_DESCOMPRIMIDO) throw new ErrorValidacion('El archivo de Excel es demasiado grande al abrirse. Quite formatos o filas vacías y vuelva a intentarlo.');
}

/** Encabezado comparable: sin tildes, en mayúsculas y sin signos ni espacios dobles («Año» y «ANIO» son lo mismo). */
export function claveDeEncabezado(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export type Celda = string | number | boolean | Date | null;

function aCelda(v: ExcelJS.CellValue): Celda {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' || typeof v === 'boolean' || v instanceof Date) return v;
  if (typeof v === 'object') {
    if ('result' in v) return aCelda((v as { result?: ExcelJS.CellValue }).result ?? null); // fórmula: lo que muestra
    if ('richText' in v) return aCelda((v.richText as Array<{ text: string }>).map((p) => p.text).join(''));
    if ('text' in v) return aCelda(String((v as { text: unknown }).text)); // enlace
    if ('error' in v) return null;
  }
  return null;
}

export interface FilaDeHoja {
  /** Número de fila tal como la ve la persona en Excel. */
  numero: number;
  celdas: Map<string, Celda>;
}

export interface HojaLeida {
  encabezados: string[];
  filas: FilaDeHoja[];
}

/** Lee la hoja con ese nombre (o la primera) y devuelve sus filas indexadas por encabezado normalizado. */
export async function leerHoja(buffer: Buffer, nombreHoja: string): Promise<HojaLeida> {
  revisarZip(buffer);
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new ErrorValidacion('No se pudo abrir el archivo. Verifique que sea un libro de Excel (.xlsx) y que no esté dañado o protegido con contraseña.');
  }
  const hoja = libro.getWorksheet(nombreHoja) ?? libro.worksheets[0];
  if (!hoja) throw new ErrorValidacion('El libro no tiene ninguna hoja con datos');
  const encabezados: string[] = [];
  hoja.getRow(1).eachCell({ includeEmpty: false }, (celda, columna) => {
    const v = aCelda(celda.value);
    encabezados[columna] = v === null ? '' : claveDeEncabezado(String(v));
  });
  if (encabezados.filter((e) => e).length === 0) throw new ErrorValidacion('La primera fila de la hoja debe tener los nombres de las columnas, como en la plantilla');
  const filas: FilaDeHoja[] = [];
  hoja.eachRow({ includeEmpty: false }, (fila, numero) => {
    if (numero === 1) return;
    const celdas = new Map<string, Celda>();
    let alguna = false;
    fila.eachCell({ includeEmpty: false }, (celda, columna) => {
      const clave = encabezados[columna];
      const v = aCelda(celda.value);
      if (!clave || v === null) return;
      celdas.set(clave, v);
      alguna = true;
    });
    if (alguna) filas.push({ numero, celdas });
  });
  if (filas.length > MAXIMO_FILAS) throw new ErrorValidacion(`El archivo tiene ${filas.length} filas y el máximo por carga es ${MAXIMO_FILAS}. Divídalo en varios archivos.`);
  return { encabezados: encabezados.filter((e) => e), filas };
}

// ── Escritura ─────────────────────────────────────────────────────────────────────────
const COLOR_ENCABEZADO = 'FFE5E7EB';

export function estiloEncabezado(fila: ExcelJS.Row): void {
  fila.font = { bold: true };
  fila.alignment = { vertical: 'middle', wrapText: true };
  fila.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLOR_ENCABEZADO } };
    c.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
  });
}

/** Ancho razonable de una columna según el encabezado y los primeros valores. */
export function anchoDeColumna(encabezado: string, muestra: unknown[]): number {
  let largo = encabezado.length;
  for (const v of muestra.slice(0, 200)) {
    const l = v === null || v === undefined ? 0 : String(v).length;
    if (l > largo) largo = l;
  }
  return Math.min(60, Math.max(10, largo + 2));
}

export async function aBuffer(libro: ExcelJS.Workbook): Promise<Buffer> {
  return Buffer.from(await libro.xlsx.writeBuffer());
}

export { ExcelJS };
