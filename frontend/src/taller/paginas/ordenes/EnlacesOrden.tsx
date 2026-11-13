import { useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import { aHoraDeGuatemala } from '../../../utils/hora';
import { formatFechaHora } from '../../../components/ui-guatech/formatoFecha.js';
import { Aviso, mensajeDe, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

interface EnlaceFila {
  id: number;
  tipo: 'cuenta' | 'checklist' | 'cotizacion';
  referencia: string | null;
  creado: string | null;
  created_at: string;
  vence_en: string;
  revocado_en: string | null;
  primera_apertura_en: string | null;
  aperturas: number;
  vigente: boolean;
}

const NOMBRE = { cuenta: 'Cuenta', checklist: 'Informe', cotizacion: 'Cotización' } as const;

/** Botón que crea el enlace para el cliente y lo muestra UNA vez (el sistema no lo guarda: solo guarda su huella). */
export function BotonEnlace({ ruta, texto, alCrear }: { ruta: string; texto: string; alCrear?: () => void }) {
  const { api } = useSesionTaller();
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [copiado, setCopiado] = useState(false);
  const crear = async (): Promise<void> => {
    setError('');
    setCopiado(false);
    try {
      const r = await api.post<{ url: string }>(ruta);
      setUrl(r.url);
      alCrear?.();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo crear el enlace'));
    }
  };
  const copiar = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={() => void crear()}>{texto}</Button>
      {error && <span role="alert" className="text-xs text-red-700">{error}</span>}
      {url && (
        <span className="flex max-w-xs flex-col items-end gap-1 rounded-md border border-gray-200 bg-gray-50 p-2 text-xs">
          <span className="break-all text-gray-800">{url}</span>
          <span className="flex gap-2">
            <button type="button" onClick={() => void copiar()} className="font-semibold text-primary hover:underline">{copiado ? 'Copiado' : 'Copiar'}</button>
            <a href={`https://wa.me/?text=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer" className="font-semibold text-primary hover:underline">WhatsApp</a>
          </span>
          <span className="text-gray-500">Se muestra una sola vez; si lo pierde, cree otro (el anterior deja de servir).</span>
        </span>
      )}
    </span>
  );
}

/** Los enlaces que se le han dado al cliente por esta orden (cuenta, informes y cotizaciones): su estado y si ya los abrió. */
export function EnlacesOrden({ ordenId }: { ordenId: number }) {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<EnlaceFila[]>(`/ordenes/${ordenId}/enlaces`), [api, ordenId]);
  const [error, setError] = useState('');
  const filas = lista.datos ?? [];
  const puede = tiene('documentos.emitir');
  const revocar = async (): Promise<void> => {
    if (!window.confirm('¿Revocar TODOS los enlaces de esta orden? Dejarán de abrirse.')) return;
    setError('');
    try {
      await api.post(`/ordenes/${ordenId}/enlaces/revocar`);
      lista.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudieron revocar'));
    }
  };
  if (filas.length === 0 && !puede) return null;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Enlaces para el cliente</h3>
        <span className="flex flex-wrap items-start gap-2">
          {puede && <BotonEnlace ruta={`/ordenes/${ordenId}/enlace-cuenta`} texto="Enlace de la cuenta" alCrear={lista.recargar} />}
          {puede && filas.some((f) => f.vigente) && <Button size="sm" variant="outline" onClick={() => void revocar()}>Revocar todos</Button>}
        </span>
      </div>
      <Aviso mensaje={error || lista.error} tipo="error" />
      {filas.length === 0 ? <p className="text-sm text-gray-500">Todavía no se le ha dado ningún enlace al cliente por esta orden. La cuenta debe estar emitida primero.</p> : (
        <ul className="divide-y rounded-md border border-gray-200 text-sm">
          {filas.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex flex-wrap items-center gap-2"><strong>{NOMBRE[f.tipo]} {f.referencia ?? ''}</strong>{f.vigente ? <Badge variant="success">Vigente</Badge> : <Badge variant="default">{f.revocado_en ? 'Revocado' : 'Vencido'}</Badge>}</span>
              <span className="text-xs text-gray-600">{f.primera_apertura_en ? `Abierto ${f.aperturas} ${f.aperturas === 1 ? 'vez' : 'veces'} · la primera, ${formatFechaHora(aHoraDeGuatemala(f.primera_apertura_en))}` : 'Todavía no lo abre'}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
