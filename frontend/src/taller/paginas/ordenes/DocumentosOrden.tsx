import { useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import { formatFechaHora } from '../../../components/ui-guatech/formatoFecha.js';
import { Aviso, mensajeDe, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

export interface DocumentoEmitido {
  id: number;
  tipo: 'cuenta' | 'informe' | 'cotizacion';
  folio: string;
  version: number;
  vigente: boolean;
  emitido_en: string;
  emitido_por: string | null;
  url: string;
  nuevo?: boolean;
}

const NOMBRE = { cuenta: 'Cuenta', informe: 'Informe', cotizacion: 'Cotización' } as const;

/** Emite un documento (cuenta, informe o cotización) y devuelve el PDF para abrirlo. */
export function useEmitir(): { emitir: (ruta: string) => Promise<DocumentoEmitido | null>; error: string; ultimo: DocumentoEmitido | null } {
  const { api } = useSesionTaller();
  const [error, setError] = useState('');
  const [ultimo, setUltimo] = useState<DocumentoEmitido | null>(null);
  const emitir = async (ruta: string): Promise<DocumentoEmitido | null> => {
    setError('');
    try {
      const d = await api.post<DocumentoEmitido>(ruta, {});
      setUltimo(d);
      window.open(d.url, '_blank', 'noopener');
      return d;
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo emitir el documento'));
      return null;
    }
  };
  return { emitir, error, ultimo };
}

/** Botón «PDF» de un documento: lo emite (o devuelve el que ya estaba al día) y lo abre. */
export function BotonPdf({ ruta, texto, alEmitir }: { ruta: string; texto: string; alEmitir?: () => void }) {
  const { emitir, error, ultimo } = useEmitir();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={() => void emitir(ruta).then((d) => d && alEmitir?.())}>{texto}</Button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      {ultimo && !error && <a href={ultimo.url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">Abrir {ultimo.folio}{ultimo.version > 1 ? ` v${ultimo.version}` : ''}</a>}
    </span>
  );
}

/** Los documentos emitidos de una orden (la cuenta) y el botón para emitirla. */
export function DocumentosOrden({ ordenId, puedeEmitir }: { ordenId: number; puedeEmitir: boolean }) {
  const { api } = useSesionTaller();
  const lista = useLista(() => api.get<DocumentoEmitido[]>(`/documentos?orden_id=${ordenId}`), [api, ordenId]);
  const docs = lista.datos ?? [];
  if (docs.length === 0 && !puedeEmitir) return null;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Cuenta en PDF</h3>
        {puedeEmitir && <BotonPdf ruta={`/ordenes/${ordenId}/cuenta`} texto="Emitir cuenta (PDF)" alEmitir={lista.recargar} />}
      </div>
      <Aviso mensaje={lista.error} tipo="error" />
      {docs.length === 0 ? <p className="text-sm text-gray-500">Todavía no se emitió la cuenta. Al emitirla queda guardada tal como estaba; si la orden cambia, se emite una versión nueva. No es una factura.</p> : (
        <ul className="divide-y rounded-md border border-gray-200 text-sm">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex flex-wrap items-center gap-2"><strong>{NOMBRE[d.tipo]} {d.folio}{d.version > 1 ? ` · versión ${d.version}` : ''}</strong>{d.vigente && <Badge variant="success">Vigente</Badge>}<span className="text-xs text-gray-500">{formatFechaHora(d.emitido_en)}{d.emitido_por ? ` · ${d.emitido_por}` : ''}</span></span>
              <a href={d.url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary hover:underline">Abrir PDF</a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
