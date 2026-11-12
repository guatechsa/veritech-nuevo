import { useRef, useState } from 'react';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { prepararArchivo } from '../../componentes/imagen';
import { Aviso, mensajeDe } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

export interface FotoLinea {
  id: number;
  tipo: 'antes' | 'durante' | 'despues';
  descripcion?: string | null;
  url: string;
}

const MOMENTOS: Array<{ k: FotoLinea['tipo']; t: string }> = [
  { k: 'antes', t: 'Antes' },
  { k: 'durante', t: 'Durante' },
  { k: 'despues', t: 'Después' },
];

/** Fotos de un trabajo: se suben reducidas (JPG de hasta 1600 px) y se ven con dirección firmada que vence. */
export function FotosLinea({ lineaId, titulo, fotos, puedeCambiar, alCerrar, alCambiar }: { lineaId: number; titulo: string; fotos: FotoLinea[]; puedeCambiar: boolean; alCerrar: () => void; alCambiar: () => void }) {
  const { api } = useSesionTaller();
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const momento = useRef<FotoLinea['tipo']>('antes');
  const entrada = useRef<HTMLInputElement>(null);

  const elegir = (k: FotoLinea['tipo']): void => {
    momento.current = k;
    entrada.current?.click();
  };
  const alElegir = async (lista: FileList | null): Promise<void> => {
    const archivo = lista?.[0];
    if (entrada.current) entrada.current.value = '';
    if (!archivo) return;
    setError('');
    setSubiendo(true);
    try {
      const { blob, nombre } = await prepararArchivo(archivo, { soloImagen: true });
      await api.subir(`/lineas/${lineaId}/fotos?tipo=${momento.current}`, blob, nombre);
      alCambiar();
    } catch (e) {
      setError(mensajeDe(e, e instanceof Error ? e.message : 'No se pudo subir la foto'));
    } finally {
      setSubiendo(false);
    }
  };
  const quitar = async (f: FotoLinea): Promise<void> => {
    setError('');
    try {
      await api.delete(`/lineas/${lineaId}/fotos/${f.id}`);
      alCambiar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo quitar la foto'));
    }
  };

  return (
    <Modal onClose={alCerrar} title={`Fotos: ${titulo}`} size="xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        <input ref={entrada} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void alElegir(e.target.files)} />
        {puedeCambiar && (
          <div className="flex flex-wrap gap-2">
            {MOMENTOS.map((m) => <Button key={m.k} variant="outline" size="sm" disabled={subiendo} onClick={() => elegir(m.k)}>{subiendo ? 'Subiendo…' : `Foto de ${m.t.toLowerCase()}`}</Button>)}
          </div>
        )}
        {MOMENTOS.map((m) => {
          const lista = fotos.filter((f) => f.tipo === m.k);
          return (
            <section key={m.k}>
              <h3 className="mb-1 text-sm font-bold text-gray-900">{m.t}</h3>
              {lista.length === 0 ? <p className="text-sm text-gray-500">Sin fotos.</p> : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {lista.map((f) => (
                    <figure key={f.id} className="space-y-1">
                      <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={`Foto de ${m.t.toLowerCase()}`} className="h-32 w-full rounded-md border border-gray-200 object-cover" /></a>
                      {puedeCambiar && <button type="button" className="text-xs font-semibold text-red-700 hover:underline" onClick={() => void quitar(f)}>Quitar</button>}
                    </figure>
                  ))}
                </div>
              )}
            </section>
          );
        })}
        <div className="flex justify-end border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cerrar</Button></div>
      </div>
    </Modal>
  );
}
