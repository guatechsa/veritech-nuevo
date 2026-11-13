import PDFDocument from 'pdfkit';

/**
 * Armado de los PDF de los documentos emitidos (Fase 6c): cuenta, informe de checklist y cotización. Cada documento se arma a partir de su
 * instantánea (ya con los textos y fechas listos), así que el mismo contenido da siempre el mismo documento. Ninguno es una factura.
 */

export interface DatosEmpresa {
  nombre: string;
  nit: string;
  direccion: string;
  telefono: string;
  correo: string;
}

export interface LineaPdf {
  tipo: string;
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  total_linea: number;
  estado?: string;
}

export interface TotalesPdf {
  subtotal: number;
  descuento_total: number;
  iva: number;
  total: number;
  incluye_iva?: boolean;
}

export interface SnapCuenta {
  tipo: 'cuenta';
  moneda: string;
  empresa: DatosEmpresa;
  orden: { numero: string; tipo: string; estado: string; sucursal: string; creada: string; descripcion: string | null };
  cliente: string | null;
  equipo: string;
  lineas: LineaPdf[];
  totales: TotalesPdf;
}

export interface SnapInforme {
  tipo: 'informe';
  empresa: DatosEmpresa;
  checklist: { tipo: string; version: number; orden: string | null; equipo: string; cliente: string | null; completado_en: string | null; completado_por: string | null };
  respuestas: Array<{ seccion: string; descripcion: string; resultado: string; semaforo: string | null; nota: string | null; desenlace: string | null; fotos: number[] }>;
  firma: { nombre: string; firmado_en: string; archivo_id: number } | null;
}

export interface SnapCotizacion {
  tipo: 'cotizacion';
  moneda: string;
  empresa: DatosEmpresa;
  cotizacion: { numero: string; version: number; estado: string; vence_en: string | null; enviada_en: string | null; notas: string | null };
  cliente: string | null;
  equipo: string | null;
  orden: string | null;
  hallazgos: Array<{ seccion: string; descripcion: string; nota: string | null; fotos: number[] }>;
  lineas: LineaPdf[];
  totales: TotalesPdf;
}

export type Snapshot = SnapCuenta | SnapInforme | SnapCotizacion;
export interface MetaPdf {
  folio: string;
  version: number;
  emitido: string;
  emitidoPor: string | null;
}
export type ProveedorDeImagenes = (archivoId: number) => Promise<Buffer | null>;

const GRIS = '#555555';
const LINEA = '#CCCCCC';
const MARGEN = 40;

export function dinero(moneda: string, monto: number): string {
  const n = (Math.round((monto + Number.EPSILON) * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${moneda === 'USD' ? 'US$' : 'Q'} ${n}`;
}

class Hoja {
  doc: PDFKit.PDFDocument;
  constructor(private readonly titulo: string, private readonly meta: MetaPdf, private readonly empresa: DatosEmpresa) {
    this.doc = new PDFDocument({ size: 'LETTER', margin: MARGEN, bufferPages: true, compress: process.env['PDF_SIN_COMPRIMIR'] !== '1', info: { Title: `${titulo} ${meta.folio}`, Author: empresa.nombre || 'VERI-TECH', Creator: 'VERI-TECH' } });
  }
  get ancho(): number {
    return this.doc.page.width - MARGEN * 2;
  }
  asegurar(alto: number): void {
    if (this.doc.y + alto > this.doc.page.height - MARGEN - 30) this.doc.addPage();
  }
  encabezado(): void {
    const d = this.doc;
    d.font('Helvetica-Bold').fontSize(14).fillColor('#000000').text(this.empresa.nombre || 'TALLER', MARGEN, MARGEN, { width: this.ancho * 0.6 });
    d.font('Helvetica').fontSize(8).fillColor(GRIS);
    const datos = [this.empresa.nit ? `NIT ${this.empresa.nit}` : '', this.empresa.direccion, [this.empresa.telefono, this.empresa.correo].filter(Boolean).join(' · ')].filter(Boolean);
    for (const l of datos) d.text(l, MARGEN, d.y, { width: this.ancho * 0.6 });
    const yFin = d.y;
    d.font('Helvetica-Bold').fontSize(13).fillColor('#000000').text(this.titulo, MARGEN + this.ancho * 0.6, MARGEN, { width: this.ancho * 0.4, align: 'right' });
    d.font('Helvetica').fontSize(9).fillColor(GRIS).text(`Folio ${this.meta.folio}${this.meta.version > 1 ? ` · versión ${this.meta.version}` : ''}`, MARGEN + this.ancho * 0.6, d.y, { width: this.ancho * 0.4, align: 'right' });
    d.text(`Emitido ${this.meta.emitido}`, MARGEN + this.ancho * 0.6, d.y, { width: this.ancho * 0.4, align: 'right' });
    d.y = Math.max(yFin, d.y) + 8;
    d.moveTo(MARGEN, d.y).lineTo(MARGEN + this.ancho, d.y).strokeColor(LINEA).stroke();
    d.y += 10;
    d.x = MARGEN;
  }
  datos(pares: Array<[string, string | null | undefined]>): void {
    const d = this.doc;
    for (const [k, v] of pares) {
      if (!v) continue;
      this.asegurar(14);
      const y = d.y;
      d.font('Helvetica-Bold').fontSize(9).fillColor('#000000').text(`${k}:`, MARGEN, y, { width: 90, continued: false });
      d.font('Helvetica').fontSize(9).fillColor('#000000').text(v, MARGEN + 95, y, { width: this.ancho - 95 });
    }
    d.moveDown(0.5);
    d.x = MARGEN;
  }
  seccion(texto: string): void {
    this.asegurar(30);
    this.doc.moveDown(0.4);
    this.doc.font('Helvetica-Bold').fontSize(10).fillColor('#000000').text(texto, MARGEN, this.doc.y);
    this.doc.moveDown(0.2);
  }
  parrafo(texto: string, opciones: { color?: string; tam?: number; negrita?: boolean } = {}): void {
    this.asegurar(14);
    this.doc.font(opciones.negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(opciones.tam ?? 9).fillColor(opciones.color ?? '#000000').text(texto, MARGEN, this.doc.y, { width: this.ancho });
  }
  tabla(columnas: Array<{ titulo: string; ancho: number; alinear?: 'left' | 'right' | 'center' }>, filas: string[][]): void {
    const d = this.doc;
    const total = columnas.reduce((s, c) => s + c.ancho, 0);
    const esc = this.ancho / total;
    const dibujarFila = (celdas: string[], negrita: boolean, fondo?: string): void => {
      d.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(8.5);
      const alto = Math.max(...celdas.map((t, i) => d.heightOfString(t, { width: columnas[i]!.ancho * esc - 6 }))) + 6;
      this.asegurar(alto + 2);
      const y = d.y;
      if (fondo) d.rect(MARGEN, y, this.ancho, alto).fill(fondo);
      let x = MARGEN;
      celdas.forEach((t, i) => {
        d.fillColor('#000000').text(t, x + 3, y + 3, { width: columnas[i]!.ancho * esc - 6, align: columnas[i]!.alinear ?? 'left' });
        x += columnas[i]!.ancho * esc;
      });
      d.y = y + alto;
      d.moveTo(MARGEN, d.y).lineTo(MARGEN + this.ancho, d.y).strokeColor(LINEA).lineWidth(0.5).stroke();
    };
    dibujarFila(columnas.map((c) => c.titulo), true, '#EEEEEE');
    for (const f of filas) dibujarFila(f, false);
    d.x = MARGEN;
    d.y += 4;
  }
  totales(moneda: string, t: TotalesPdf): void {
    const d = this.doc;
    this.asegurar(70);
    const filas: Array<[string, string, boolean]> = [
      ['Subtotal', dinero(moneda, t.subtotal), false],
      ['Descuento', `- ${dinero(moneda, t.descuento_total)}`, false],
      [t.incluye_iva ? 'IVA (incluido en los precios)' : 'IVA', dinero(moneda, t.iva), false],
      ['Total', dinero(moneda, t.total), true],
    ];
    for (const [k, v, fuerte] of filas) {
      const y = d.y;
      d.font(fuerte ? 'Helvetica-Bold' : 'Helvetica').fontSize(fuerte ? 11 : 9).fillColor('#000000').text(k, MARGEN + this.ancho - 230, y, { width: 110 });
      d.text(v, MARGEN + this.ancho - 120, y, { width: 120, align: 'right' });
    }
    d.x = MARGEN;
  }
  async imagenes(ids: number[], proveedor: ProveedorDeImagenes, tamano = 70): Promise<void> {
    const d = this.doc;
    let x = MARGEN;
    let alto = 0;
    for (const id of ids.slice(0, 6)) {
      const b = await proveedor(id);
      if (!b) continue;
      this.asegurar(tamano + 6);
      if (x + tamano > MARGEN + this.ancho) x = MARGEN;
      try {
        d.image(b, x, d.y, { fit: [tamano, tamano] });
        x += tamano + 6;
        alto = tamano;
      } catch {
        // una foto que no se puede dibujar (formato raro) se omite; el documento sale igual
      }
    }
    if (alto > 0) d.y += alto + 6;
    d.x = MARGEN;
  }
  pie(aviso: string): Buffer[] {
    const d = this.doc;
    const rango = d.bufferedPageRange();
    for (let i = 0; i < rango.count; i++) {
      d.switchToPage(rango.start + i);
      d.font('Helvetica').fontSize(7.5).fillColor(GRIS);
      d.text(aviso, MARGEN, d.page.height - MARGEN - 10, { width: this.ancho - 80, align: 'left', lineBreak: false });
      d.text(`Página ${i + 1} de ${rango.count}`, MARGEN + this.ancho - 80, d.page.height - MARGEN - 10, { width: 80, align: 'right', lineBreak: false });
    }
    return [];
  }
  async terminar(aviso: string): Promise<Buffer> {
    const trozos: Buffer[] = [];
    this.doc.on('data', (c: Buffer) => trozos.push(c));
    const fin = new Promise<Buffer>((resolver, rechazar) => {
      this.doc.on('end', () => resolver(Buffer.concat(trozos)));
      this.doc.on('error', rechazar);
    });
    this.pie(aviso);
    this.doc.end();
    return fin;
  }
}

const TIPO_LINEA: Record<string, string> = { servicio: 'Trabajo', material: 'Material', tercero: 'Con terceros' };
const AVISO = 'Documento informativo emitido por el sistema; no es una factura.';

function filasDeLineas(moneda: string, lineas: LineaPdf[], conEstado: boolean): string[][] {
  return lineas.map((l) => [
    `${l.descripcion}\n${TIPO_LINEA[l.tipo] ?? l.tipo}`,
    String(l.cantidad),
    dinero(moneda, l.precio_unitario),
    l.descuento_pct ? `${l.descuento_pct} %` : '—',
    dinero(moneda, l.total_linea),
    ...(conEstado ? [l.estado ?? ''] : []),
  ]);
}

export async function pdfCuenta(s: SnapCuenta, m: MetaPdf): Promise<Buffer> {
  const h = new Hoja('CUENTA', m, s.empresa);
  h.encabezado();
  h.datos([['Orden', `${s.orden.numero} · ${s.orden.tipo}`], ['Estado', s.orden.estado], ['Sucursal', s.orden.sucursal], ['Fecha de la orden', s.orden.creada], ['Cliente', s.cliente ?? 'Equipo del taller'], ['Equipo', s.equipo], ['Descripción', s.orden.descripcion]]);
  h.seccion('Detalle');
  h.tabla(
    [{ titulo: 'Concepto', ancho: 44 }, { titulo: 'Cant.', ancho: 8, alinear: 'right' }, { titulo: 'Precio', ancho: 16, alinear: 'right' }, { titulo: 'Desc.', ancho: 8, alinear: 'right' }, { titulo: 'Total', ancho: 16, alinear: 'right' }],
    filasDeLineas(s.moneda, s.lineas, false)
  );
  h.totales(s.moneda, s.totales);
  return h.terminar(AVISO);
}

export async function pdfCotizacion(s: SnapCotizacion, m: MetaPdf, imagen: ProveedorDeImagenes): Promise<Buffer> {
  const h = new Hoja('COTIZACIÓN', m, s.empresa);
  h.encabezado();
  h.datos([['Cotización', `${s.cotizacion.numero}${s.cotizacion.version > 1 ? ` · versión ${s.cotizacion.version}` : ''}`], ['Estado', s.cotizacion.estado], ['Cliente', s.cliente ?? 'Equipo del taller'], ['Equipo', s.equipo], ['Orden', s.orden], ['Enviada', s.cotizacion.enviada_en], ['Vigente hasta', s.cotizacion.vence_en]]);
  if (s.cotizacion.notas) h.parrafo(s.cotizacion.notas, { color: GRIS });
  if (s.hallazgos.length > 0) {
    h.seccion('Lo que se encontró');
    for (const x of s.hallazgos) {
      h.parrafo(`${x.seccion} › ${x.descripcion}`, { negrita: true });
      if (x.nota) h.parrafo(x.nota, { color: GRIS });
      await h.imagenes(x.fotos, imagen);
    }
  }
  h.seccion('Lo que se cotiza');
  h.tabla(
    [{ titulo: 'Concepto', ancho: 36 }, { titulo: 'Cant.', ancho: 7, alinear: 'right' }, { titulo: 'Precio', ancho: 14, alinear: 'right' }, { titulo: 'Desc.', ancho: 7, alinear: 'right' }, { titulo: 'Total', ancho: 14, alinear: 'right' }, { titulo: 'Respuesta', ancho: 16 }],
    filasDeLineas(s.moneda, s.lineas, true)
  );
  h.totales(s.moneda, s.totales);
  return h.terminar(AVISO);
}

export async function pdfInforme(s: SnapInforme, m: MetaPdf, imagen: ProveedorDeImagenes): Promise<Buffer> {
  const h = new Hoja('INFORME', m, s.empresa);
  h.encabezado();
  h.datos([['Checklist', `${s.checklist.tipo} (plantilla versión ${s.checklist.version})`], ['Orden', s.checklist.orden], ['Cliente', s.checklist.cliente ?? 'Equipo del taller'], ['Equipo', s.checklist.equipo], ['Completado', s.checklist.completado_en ? `${s.checklist.completado_en}${s.checklist.completado_por ? ` · ${s.checklist.completado_por}` : ''}` : null]]);
  let seccion = '';
  for (const r of s.respuestas) {
    if (r.seccion !== seccion) {
      seccion = r.seccion;
      h.seccion(seccion);
    }
    const marca = r.semaforo === 'rojo' ? 'MAL' : r.semaforo === 'amarillo' ? 'ATENCIÓN' : r.semaforo === 'verde' ? 'BIEN' : '';
    h.parrafo(`${r.descripcion}: ${marca || r.resultado}${marca && r.resultado && r.resultado !== marca ? ` (${r.resultado})` : ''}`, { negrita: r.semaforo === 'rojo' });
    if (r.nota) h.parrafo(`Nota: ${r.nota}`, { color: GRIS });
    if (r.desenlace) h.parrafo(`Qué se hizo con este ítem: ${r.desenlace}`, { color: GRIS });
    if (r.fotos.length > 0) await h.imagenes(r.fotos, imagen, 60);
  }
  if (s.firma) {
    h.seccion('Firma del cliente');
    h.parrafo(`${s.firma.nombre} · ${s.firma.firmado_en}`);
    await h.imagenes([s.firma.archivo_id], imagen, 90);
  }
  return h.terminar(AVISO);
}
