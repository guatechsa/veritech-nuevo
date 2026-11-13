/**
 * La firma del cliente con el dedo. Se arma SIN librerías del teléfono: los trazos que dibuja la persona (listas de puntos) se pintan en una imagen en
 * blanco y negro y se escriben como un archivo PNG, todo aquí, en TypeScript puro. Así se prueba en la computadora, funciona igual en cualquier teléfono y la
 * imagen que llega al servidor es exactamente la que se probó. El PNG va SIN comprimir (bloques «almacenados» de zlib): son unos 80 KB y solo viaja una vez.
 */
export interface Punto {
  x: number;
  y: number;
}
export type Trazo = Punto[];

export const ANCHO_FIRMA = 400;
export const ALTO_FIRMA = 200;
const GROSOR = 3;
/** Menos que esto es un garabato o un toque sin querer: no cuenta como firma. */
export const LARGO_MINIMO_DE_FIRMA = 80;

export function largoDeTrazos(trazos: Trazo[]): number {
  let total = 0;
  for (const t of trazos) for (let i = 1; i < t.length; i++) total += Math.hypot(t[i]!.x - t[i - 1]!.x, t[i]!.y - t[i - 1]!.y);
  return total;
}

/** El largo se mide en la medida del lienzo (ancho `ANCHO_FIRMA`): un toque suelto o una rayita corta no es una firma. */
export const esFirmaValida = (trazos: Trazo[], anchoLienzo: number): boolean => largoDeTrazos(trazos) * (ANCHO_FIRMA / Math.max(anchoLienzo, 1)) >= LARGO_MINIMO_DE_FIRMA;

/** Pinta los trazos (dados en la medida del lienzo de la pantalla) en una imagen de 400×200: 255 = blanco, 0 = tinta. */
export function rasterizar(trazos: Trazo[], anchoLienzo: number, altoLienzo: number): Uint8Array {
  const px = new Uint8Array(ANCHO_FIRMA * ALTO_FIRMA).fill(255);
  const ex = ANCHO_FIRMA / Math.max(anchoLienzo, 1);
  const ey = ALTO_FIRMA / Math.max(altoLienzo, 1);
  const sello = (cx: number, cy: number): void => {
    for (let dy = -1; dy < GROSOR - 1; dy++) {
      for (let dx = -1; dx < GROSOR - 1; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x >= 0 && y >= 0 && x < ANCHO_FIRMA && y < ALTO_FIRMA) px[y * ANCHO_FIRMA + x] = 0;
      }
    }
  };
  for (const t of trazos) {
    let anterior: Punto | null = null;
    for (const p of t) {
      const actual = { x: Math.round(p.x * ex), y: Math.round(p.y * ey) };
      if (!anterior) {
        sello(actual.x, actual.y);
      } else {
        // Línea entre dos puntos (Bresenham): sin huecos aunque el dedo vaya rápido.
        let x0 = anterior.x;
        let y0 = anterior.y;
        const dx = Math.abs(actual.x - x0);
        const dy = -Math.abs(actual.y - y0);
        const sx = x0 < actual.x ? 1 : -1;
        const sy = y0 < actual.y ? 1 : -1;
        let error = dx + dy;
        for (;;) {
          sello(x0, y0);
          if (x0 === actual.x && y0 === actual.y) break;
          const e2 = 2 * error;
          if (e2 >= dy) {
            error += dy;
            x0 += sx;
          }
          if (e2 <= dx) {
            error += dx;
            y0 += sy;
          }
        }
      }
      anterior = actual;
    }
  }
  return px;
}

// ── PNG sin librerías ────────────────────────────────────────────────────────────────
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = TABLA_CRC[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function adler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

const aBytes32 = (n: number): number[] => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

function bloque(tipo: string, datos: Uint8Array): Uint8Array {
  const t = Uint8Array.from(tipo, (c) => c.charCodeAt(0));
  const cuerpo = new Uint8Array(4 + datos.length);
  cuerpo.set(t, 0);
  cuerpo.set(datos, 4);
  const salida = new Uint8Array(12 + datos.length);
  salida.set(aBytes32(datos.length), 0);
  salida.set(cuerpo, 4);
  salida.set(aBytes32(crc32(cuerpo)), 8 + datos.length);
  return salida;
}

/** Imagen en escala de grises de 8 bits (un byte por punto) → archivo PNG. */
export function codificarPng(ancho: number, alto: number, pixeles: Uint8Array): Uint8Array {
  if (pixeles.length !== ancho * alto) throw new Error('La imagen no tiene el tamaño indicado.');
  // Cada fila lleva delante un byte de filtro (0 = sin filtro).
  const crudo = new Uint8Array((ancho + 1) * alto);
  for (let y = 0; y < alto; y++) crudo.set(pixeles.subarray(y * ancho, (y + 1) * ancho), y * (ancho + 1) + 1);
  // zlib con bloques almacenados (sin comprimir) de hasta 65.535 bytes.
  const MAXIMO = 65535;
  let total = 2;
  const bloques: Uint8Array[] = [];
  for (let i = 0; i < crudo.length; i += MAXIMO) {
    const trozo = crudo.subarray(i, Math.min(i + MAXIMO, crudo.length));
    const ultimo = i + MAXIMO >= crudo.length;
    const b = new Uint8Array(5 + trozo.length);
    b[0] = ultimo ? 1 : 0;
    b[1] = trozo.length & 255;
    b[2] = trozo.length >>> 8;
    b[3] = ~trozo.length & 255;
    b[4] = (~trozo.length >>> 8) & 255;
    b.set(trozo, 5);
    bloques.push(b);
    total += b.length;
  }
  const zlib = new Uint8Array(total + 4);
  zlib[0] = 0x78;
  zlib[1] = 0x01;
  let pos = 2;
  for (const b of bloques) {
    zlib.set(b, pos);
    pos += b.length;
  }
  zlib.set(aBytes32(adler32(crudo)), pos);

  const ihdr = new Uint8Array([...aBytes32(ancho), ...aBytes32(alto), 8, 0, 0, 0, 0]); // 8 bits, grises, sin entrelazado
  const partesPng = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), bloque('IHDR', ihdr), bloque('IDAT', zlib), bloque('IEND', new Uint8Array(0))];
  const salida = new Uint8Array(partesPng.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of partesPng) {
    salida.set(p, o);
    o += p.length;
  }
  return salida;
}

const LETRAS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function aBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    s += LETRAS[a >> 2]! + LETRAS[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    s += b === undefined ? '=' : LETRAS[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    s += c === undefined ? '=' : LETRAS[c & 63]!;
  }
  return s;
}

/** Lo que se manda al servidor: la imagen PNG de la firma en base64. */
export function firmaEnBase64(trazos: Trazo[], anchoLienzo: number, altoLienzo: number): string {
  return aBase64(codificarPng(ANCHO_FIRMA, ALTO_FIRMA, rasterizar(trazos, anchoLienzo, altoLienzo)));
}
