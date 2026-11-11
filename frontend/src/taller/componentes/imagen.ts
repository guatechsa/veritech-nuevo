/** Lado más largo permitido de una foto subida desde la pantalla: suficiente para ver detalle sin pasar de unos cientos de KB. */
export const LADO_MAXIMO = 1600;
export const MAXIMO_BYTES = 10 * 1024 * 1024;

/** Medidas finales de una imagen al reducirla: no se agranda nunca y conserva la proporción. */
export function medidasReducidas(ancho: number, alto: number, maximo: number = LADO_MAXIMO): { ancho: number; alto: number } {
  const mayor = Math.max(ancho, alto);
  if (mayor <= maximo) return { ancho, alto };
  const factor = maximo / mayor;
  return { ancho: Math.max(1, Math.round(ancho * factor)), alto: Math.max(1, Math.round(alto * factor)) };
}

/**
 * Prepara un archivo elegido por la persona. Una foto del celular (varios MB) se reduce a JPG de hasta 1600 px; un PDF
 * pasa tal cual. Devuelve un mensaje claro si el archivo no sirve.
 */
export async function prepararArchivo(archivo: File, opciones: { soloImagen?: boolean } = {}): Promise<{ blob: Blob; nombre: string }> {
  if (archivo.type === 'application/pdf') {
    if (opciones.soloImagen) throw new Error('Aquí solo se aceptan fotos (JPG, PNG o WEBP).');
    if (archivo.size > MAXIMO_BYTES) throw new Error('El PDF pesa más de 10 MB.');
    return { blob: archivo, nombre: archivo.name };
  }
  if (!archivo.type.startsWith('image/')) throw new Error('Solo se aceptan fotos (JPG, PNG o WEBP)' + (opciones.soloImagen ? '.' : ' y documentos PDF.'));
  let imagen: ImageBitmap;
  try {
    imagen = await createImageBitmap(archivo);
  } catch {
    throw new Error('No se pudo leer la foto. Pruebe con otra.');
  }
  const { ancho, alto } = medidasReducidas(imagen.width, imagen.height);
  const lienzo = document.createElement('canvas');
  lienzo.width = ancho;
  lienzo.height = alto;
  const contexto = lienzo.getContext('2d');
  if (!contexto) throw new Error('No se pudo preparar la foto.');
  contexto.fillStyle = '#ffffff'; // un PNG transparente no queda negro al pasar a JPG
  contexto.fillRect(0, 0, ancho, alto);
  contexto.drawImage(imagen, 0, 0, ancho, alto);
  imagen.close();
  const blob = await new Promise<Blob | null>((resolver) => lienzo.toBlob(resolver, 'image/jpeg', 0.82));
  if (!blob) throw new Error('No se pudo preparar la foto.');
  if (blob.size > MAXIMO_BYTES) throw new Error('La foto sigue pesando más de 10 MB después de reducirla.');
  return { blob, nombre: archivo.name.replace(/\.[^.]+$/, '') + '.jpg' };
}
