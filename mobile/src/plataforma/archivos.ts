import { Directory, File, Paths } from 'expo-file-system';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { Archivos, Imagenes } from '../nucleo/tipos';

/**
 * Archivos del teléfono. Todo va a la carpeta de DOCUMENTOS de la app (el sistema no la borra cuando falta espacio, a diferencia de la carpeta temporal de la cámara).
 * `origen` es la dirección del servidor para completar las direcciones que empiezan con «/api/…».
 */
export function crearArchivos(origen: string): Archivos {
  const raiz = new Directory(Paths.document, 'veritech2');
  const asegurar = (carpeta: Directory): void => {
    if (!carpeta.exists) carpeta.create({ intermediates: true, idempotent: true });
  };
  const aFile = (uri: string): File => new File(uri);
  const carpetaDe = (uri: string): Directory => new Directory(uri.slice(0, uri.lastIndexOf('/')));
  return {
    carpeta: () => `${raiz.uri.endsWith('/') ? raiz.uri : `${raiz.uri}/`}`,
    async copiar(desde, hacia) {
      asegurar(carpetaDe(hacia));
      const destino = aFile(hacia);
      if (destino.exists) destino.delete();
      aFile(desde).copy(destino);
      return destino.uri;
    },
    async descargar(url, hacia) {
      asegurar(carpetaDe(hacia));
      const destino = aFile(hacia);
      if (destino.exists) destino.delete();
      const bajado = await File.downloadFileAsync(url.startsWith('/') ? `${origen}${url}` : url, destino);
      return bajado.uri;
    },
    async leerBytes(uri) {
      return aFile(uri).bytes();
    },
    async existe(uri) {
      return aFile(uri).exists;
    },
    async borrar(uri) {
      const f = aFile(uri);
      if (f.exists) f.delete();
    },
  };
}

/** Reduce las fotos: ancho máximo 1.600 px (el alto sigue la proporción) y JPG al 70 %. */
export const imagenes: Imagenes = {
  async reducir(uri, anchoMaximo) {
    const r = await manipulateAsync(uri, [{ resize: { width: anchoMaximo } }], { compress: 0.7, format: SaveFormat.JPEG });
    return { uri: r.uri, ancho: r.width, alto: r.height };
  },
};
