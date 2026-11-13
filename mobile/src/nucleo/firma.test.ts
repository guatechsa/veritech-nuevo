import { inflateSync } from 'zlib';
import { ALTO_FIRMA, ANCHO_FIRMA, aBase64, codificarPng, crc32, esFirmaValida, firmaEnBase64, rasterizar, Trazo } from './firma';

/** Lee un PNG como lo haría cualquier programa de imágenes: revisa la cabecera, cada CRC y descomprime. */
function leerPng(png: Uint8Array): { ancho: number; alto: number; pixeles: Uint8Array } {
  expect(Array.from(png.slice(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  let ancho = 0;
  let alto = 0;
  const idat: Uint8Array[] = [];
  let fin = false;
  while (pos < png.length) {
    const largo = v.getUint32(pos);
    const tipo = String.fromCharCode(...png.slice(pos + 4, pos + 8));
    const cuerpo = png.slice(pos + 8, pos + 8 + largo);
    expect(v.getUint32(pos + 8 + largo)).toBe(crc32(png.slice(pos + 4, pos + 8 + largo))); // cada bloque trae su CRC correcto
    if (tipo === 'IHDR') {
      ancho = v.getUint32(pos + 8);
      alto = v.getUint32(pos + 12);
      expect(Array.from(cuerpo.slice(8))).toEqual([8, 0, 0, 0, 0]);
    }
    if (tipo === 'IDAT') idat.push(cuerpo);
    if (tipo === 'IEND') fin = true;
    pos += 12 + largo;
  }
  expect(fin).toBe(true);
  const crudo = inflateSync(Buffer.concat(idat)); // zlib de verdad: valida también el Adler-32
  const pixeles = new Uint8Array(ancho * alto);
  for (let y = 0; y < alto; y++) {
    expect(crudo[y * (ancho + 1)]).toBe(0);
    pixeles.set(crudo.subarray(y * (ancho + 1) + 1, (y + 1) * (ancho + 1)), y * ancho);
  }
  return { ancho, alto, pixeles };
}

const diagonal: Trazo[] = [[{ x: 20, y: 20 }, { x: 180, y: 90 }]];
const px = (p: Uint8Array, x: number, y: number): number => p[y * ANCHO_FIRMA + x]!;

describe('la firma del cliente', () => {
  it('lo que se pinta sale como un PNG que cualquier programa lee: tamaño, CRC y zlib correctos', () => {
    const { ancho, alto, pixeles } = leerPng(codificarPng(ANCHO_FIRMA, ALTO_FIRMA, rasterizar(diagonal, 200, 100)));
    expect([ancho, alto]).toEqual([400, 200]);
    expect(pixeles.length).toBe(400 * 200);
  });

  it('el trazo se pinta en su lugar (se escala del lienzo de la pantalla al de 400×200) y el resto queda en blanco', () => {
    const p = rasterizar(diagonal, 200, 100); // lienzo de 200×100 → ×2
    expect(px(p, 40, 40)).toBe(0); // el punto inicial (20,20) ×2
    expect(px(p, 360, 180)).toBe(0); // el punto final (180,90) ×2
    expect(px(p, 200, 110)).toBe(0); // la mitad del recorrido: no hay huecos
    expect(px(p, 10, 190)).toBe(255);
    expect(px(p, 390, 5)).toBe(255);
  });

  it('un trazo que se sale del lienzo no rompe nada', () => {
    const p = rasterizar([[{ x: -50, y: -50 }, { x: 900, y: 900 }]], 200, 100);
    expect(p.length).toBe(400 * 200);
    expect(px(p, 0, 0)).toBe(0);
  });

  it('no todo es una firma: un toque suelto o una rayita corta no cuentan; un trazo normal o varios, sí', () => {
    expect(esFirmaValida([], 300)).toBe(false);
    expect(esFirmaValida([[{ x: 5, y: 5 }]], 300)).toBe(false); // un toque
    expect(esFirmaValida([[{ x: 5, y: 5 }, { x: 25, y: 5 }]], 300)).toBe(false); // una rayita
    expect(esFirmaValida(diagonal, 300)).toBe(true);
    expect(esFirmaValida([[{ x: 0, y: 0 }, { x: 40, y: 0 }], [{ x: 0, y: 20 }, { x: 40, y: 20 }]], 300)).toBe(true); // varios trazos suman
    // La medida es proporcional al lienzo: la misma rayita en un lienzo pequeño pesa más.
    expect(esFirmaValida([[{ x: 0, y: 0 }, { x: 50, y: 0 }]], 100)).toBe(true);
    expect(esFirmaValida([[{ x: 0, y: 0 }, { x: 50, y: 0 }]], 400)).toBe(false);
  });

  it('el base64 es el de siempre (igual que el del sistema) y la firma lista para enviar se lee de vuelta', () => {
    for (const largo of [0, 1, 2, 3, 4, 5, 100, 1000]) {
      const b = Uint8Array.from({ length: largo }, (_, i) => (i * 37 + 11) & 255);
      expect(aBase64(b)).toBe(Buffer.from(b).toString('base64'));
    }
    const png = Buffer.from(firmaEnBase64(diagonal, 200, 100), 'base64');
    expect(leerPng(png).pixeles.filter((v) => v === 0).length).toBeGreaterThan(300);
  });

  it('cabe de sobra en lo que acepta el servidor (900.000 caracteres)', () => {
    expect(firmaEnBase64(diagonal, 200, 100).length).toBeLessThan(200_000);
  });
});
