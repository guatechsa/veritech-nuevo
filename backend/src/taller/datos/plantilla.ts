import { TallerReq } from '../comun';
import { Importador } from './importar';
import { aBuffer, anchoDeColumna, estiloEncabezado, ExcelJS, MAXIMO_FILAS } from './libro';

/**
 * Plantilla de Excel de una carga masiva: la hoja «Datos» (donde se llena), la hoja «Instrucciones» (qué va en cada
 * columna, con un ejemplo) y una hoja oculta «Listas» con las opciones del taller para los desplegables.
 */
export async function crearPlantilla(importador: Importador, t: TallerReq): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'VERI-TECH';
  const datos = libro.addWorksheet('Datos');
  const instrucciones = libro.addWorksheet('Instrucciones');
  const listasHoja = libro.addWorksheet('Listas');
  const listas = await importador.listas(t);

  // Hoja de datos: solo los encabezados; las columnas ya van en formato texto para que Excel no cambie los números ni las fechas.
  datos.addRow(importador.columnas.map((c) => c.encabezado));
  estiloEncabezado(datos.getRow(1));
  importador.columnas.forEach((c, i) => {
    const col = datos.getColumn(i + 1);
    col.width = anchoDeColumna(c.encabezado, [c.ejemplo]);
    col.numFmt = '@';
    if (c.requerida) datos.getCell(1, i + 1).font = { bold: true, color: { argb: 'FFB91C1C' } };
  });
  datos.views = [{ state: 'frozen', ySplit: 1 }];

  // Listas desplegables (una columna de la hoja «Listas» por cada lista).
  const columnaDeLista = new Map<string, string>();
  Object.entries(listas).forEach(([nombre, valores], i) => {
    const letra = String.fromCharCode(65 + i);
    columnaDeLista.set(nombre, `Listas!$${letra}$2:$${letra}$${Math.max(2, valores.length + 1)}`);
    listasHoja.getCell(1, i + 1).value = nombre;
    valores.forEach((v, j) => {
      listasHoja.getCell(j + 2, i + 1).value = v;
    });
  });
  listasHoja.state = 'hidden';
  importador.columnas.forEach((c, i) => {
    const rango = c.lista ? columnaDeLista.get(c.lista) : undefined;
    if (!rango) return;
    for (let fila = 2; fila <= MAXIMO_FILAS + 1; fila++) {
      datos.getCell(fila, i + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [rango], showErrorMessage: false };
    }
  });

  // Instrucciones.
  instrucciones.columns = [{ width: 28 }, { width: 14 }, { width: 80 }, { width: 30 }];
  instrucciones.addRow([`Carga de ${importador.titulo.toLowerCase()}`]).font = { bold: true, size: 14 };
  instrucciones.addRow([importador.descripcion]);
  instrucciones.addRow([]);
  instrucciones.addRow(['1. Llene la hoja «Datos», una fila por registro, sin cambiar los nombres de las columnas (los rojos son obligatorios).']);
  instrucciones.addRow([`2. Cada archivo puede tener hasta ${MAXIMO_FILAS} filas. Las fechas se escriben día/mes/año (15/03/2026).`]);
  instrucciones.addRow(['3. Súbalo en el sistema y use «Probar sin guardar»: le dirá qué filas tienen problemas. Si hay un solo error no se carga nada; corríjalo y suba el archivo completo otra vez.']);
  instrucciones.addRow([]);
  estiloEncabezado(instrucciones.addRow(['Columna', '¿Obligatoria?', 'Qué poner', 'Ejemplo']));
  for (const c of importador.columnas) instrucciones.addRow([c.encabezado, c.requerida ? 'SÍ' : 'No', c.ayuda, c.ejemplo]);
  instrucciones.eachRow((fila, numero) => {
    if (numero <= 6) instrucciones.mergeCells(numero, 1, numero, 4);
    fila.alignment = { vertical: 'top', wrapText: true };
    if (numero === 2 || (numero >= 4 && numero <= 6)) fila.height = 32;
  });

  return aBuffer(libro);
}
