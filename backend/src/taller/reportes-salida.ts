import { escaparHtml } from '../utils/html';
import { anchoDeColumna, aBuffer, estiloEncabezado, ExcelJS } from './datos/libro';
import { ddmmaaaa, formatoCelda, ReporteArmado, TipoColumna } from './reportes-tipos';

/** Cómo sale un reporte armado: Excel (con formato y para imprimir) y HTML para el cuerpo de un correo. Todo reporte lleva su nombre, la empresa y cuándo se emitió. */

export interface PieDeReporte {
  empresa: string;
  /** «13/11/2026 09:30», ya en la hora del taller. */
  emitido: string;
  emitidoPor: string | null;
  moneda: string;
}

const FORMATO: Record<Exclude<TipoColumna, 'texto'>, (moneda: string) => string> = {
  entero: () => '#,##0',
  decimal: () => '#,##0.00',
  porcentaje: () => '0.00"%"',
  dinero: (m) => `"${m === 'USD' ? 'US$' : 'Q'}" #,##0.00`,
};

function nombreDeHoja(titulo: string, usados: Set<string>): string {
  const limpio = titulo.replace(/[\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Hoja';
  let nombre = limpio;
  for (let i = 2; usados.has(nombre.toLowerCase()); i++) nombre = `${limpio.slice(0, 28)} ${i}`;
  usados.add(nombre.toLowerCase());
  return nombre;
}

export async function reporteAExcel(r: ReporteArmado, pie: PieDeReporte): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'VERI-TECH';
  libro.title = r.titulo;
  const usados = new Set<string>();
  for (const s of r.secciones) {
    const hoja = libro.addWorksheet(nombreDeHoja(s.titulo, usados), {
      pageSetup: { paperSize: 1 as unknown as ExcelJS.PaperSize /* 1 = carta */, orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 } },
      headerFooter: { oddFooter: `&L&8${r.titulo} · ${pie.empresa.replace(/&/g, '&&')}&R&8Página &P de &N` },
    });
    hoja.addRow([r.titulo]).font = { bold: true, size: 14 };
    hoja.addRow([pie.empresa]).font = { bold: true };
    hoja.addRow([`Periodo: ${ddmmaaaa(r.desde)} al ${ddmmaaaa(r.hasta)}`]);
    hoja.addRow([`Filtros: ${r.filtros.length > 0 ? r.filtros.join(' · ') : 'ninguno'}`]);
    hoja.addRow([`Emitido: ${pie.emitido}${pie.emitidoPor ? ` por ${pie.emitidoPor}` : ''}`]).font = { color: { argb: 'FF555555' } };
    hoja.addRow([]);
    hoja.addRow([s.titulo]).font = { bold: true, size: 12 };
    const encabezado = hoja.addRow(s.columnas.map((c) => c.titulo));
    estiloEncabezado(encabezado);
    const filaEncabezado = encabezado.number;
    for (const f of s.filas) {
      const fila = hoja.addRow(s.columnas.map((c) => f[c.clave] ?? null));
      s.columnas.forEach((c, i) => {
        if (c.tipo !== 'texto') fila.getCell(i + 1).numFmt = FORMATO[c.tipo](pie.moneda);
      });
    }
    if (s.filas.length === 0) hoja.addRow(['Sin datos en el periodo.']).font = { italic: true, color: { argb: 'FF555555' } };
    if (s.total) {
      const total = hoja.addRow(s.columnas.map((c) => (s.total![c.clave] === undefined ? null : s.total![c.clave]!)));
      total.font = { bold: true };
      s.columnas.forEach((c, i) => {
        const celda = total.getCell(i + 1);
        celda.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } } };
        if (c.tipo !== 'texto') celda.numFmt = FORMATO[c.tipo](pie.moneda);
      });
    }
    hoja.addRow([]);
    for (const n of r.notas) hoja.addRow([n]).font = { italic: true, color: { argb: 'FF555555' }, size: 9 };
    s.columnas.forEach((c, i) => {
      hoja.getColumn(i + 1).width = anchoDeColumna(c.titulo, s.filas.map((f) => formatoCelda(pie.moneda, c.tipo, f[c.clave] ?? null)));
    });
    hoja.views = [{ state: 'frozen', ySplit: filaEncabezado }];
    hoja.pageSetup.printTitlesRow = `${filaEncabezado}:${filaEncabezado}`;
  }
  return aBuffer(libro);
}

/** El reporte como tablas dentro de un correo (sin adjuntos): se recortan las filas largas y se avisa cuántas faltan. */
export function reporteAHtml(r: ReporteArmado, pie: PieDeReporte, maxFilas = 40): string {
  const celda = 'padding:4px 8px;border-bottom:1px solid #e5e7eb;font-size:13px;';
  const secciones = r.secciones
    .map((s) => {
      const cabeza = s.columnas.map((c) => `<th style="${celda}background:#f3f4f6;text-align:${c.tipo === 'texto' ? 'left' : 'right'};">${escaparHtml(c.titulo)}</th>`).join('');
      const fila = (f: Record<string, string | number | null>, fuerte: boolean): string =>
        `<tr>${s.columnas.map((c) => `<td style="${celda}text-align:${c.tipo === 'texto' ? 'left' : 'right'};${fuerte ? 'font-weight:bold;' : ''}">${escaparHtml(formatoCelda(pie.moneda, c.tipo, f[c.clave]))}</td>`).join('')}</tr>`;
      const cuerpo = s.filas.slice(0, maxFilas).map((f) => fila(f, false)).join('');
      const faltan = s.filas.length - maxFilas;
      return `<h3 style="margin:18px 0 6px;font-size:14px;">${escaparHtml(s.titulo)}</h3>
      ${s.filas.length === 0 ? '<p style="color:#6b7280;">Sin datos en el periodo.</p>' : `<table style="border-collapse:collapse;width:100%;"><tr>${cabeza}</tr>${cuerpo}${s.total ? fila(s.total, true) : ''}</table>`}
      ${faltan > 0 ? `<p style="color:#6b7280;font-size:12px;">…y ${faltan} filas más. Descargue el reporte completo desde Reportes.</p>` : ''}`;
    })
    .join('\n');
  return `<p><strong>${escaparHtml(r.titulo)}</strong><br>${escaparHtml(pie.empresa)}<br>Periodo: ${ddmmaaaa(r.desde)} al ${ddmmaaaa(r.hasta)}${r.filtros.length > 0 ? `<br>${escaparHtml(r.filtros.join(' · '))}` : ''}<br><span style="color:#6b7280;">Emitido ${escaparHtml(pie.emitido)}</span></p>
  ${secciones}
  ${r.notas.map((n) => `<p style="color:#6b7280;font-size:12px;">${escaparHtml(n)}</p>`).join('')}`;
}
