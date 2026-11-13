import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatFechaHora } from '../../components/ui-guatech/formatoFecha.js';
import { ErrorApi } from '../../admin/api';
import { aHoraDeGuatemala } from '../../utils/hora';
import { crearApiTaller, useUbicacion } from '../contexto';
import { dineroDe } from './ordenes/tipos';

interface Documento {
  disponible: boolean;
  tipo: 'cuenta' | 'checklist';
  folio: string;
  version: number;
  emitido_en: string;
  reemplaza_a_una_anterior: boolean;
  taller: string;
  url: string;
  aviso: string;
  resumen: {
    moneda?: string;
    orden?: string | null;
    cliente?: string | null;
    equipo?: string;
    lineas?: Array<{ tipo: string; descripcion: string; cantidad: number; total_linea: number }>;
    totales?: { subtotal: number; descuento_total: number; iva: number; total: number };
    checklist?: string;
    completado_en?: string | null;
    hallazgos?: Array<{ seccion: string; descripcion: string; semaforo: string; nota: string | null }>;
    revisados?: number;
  };
}

const TIPO_LINEA: Record<string, string> = { servicio: 'Trabajo', material: 'Material', tercero: 'Con terceros' };

/** La cuenta o el informe que el taller le mandó al cliente por enlace: sin iniciar sesión, pensado para el teléfono. */
export default function DocumentoPublico() {
  const { token = '' } = useParams();
  const { slug } = useUbicacion();
  const [api] = useState(() => crearApiTaller(slug));
  const [d, setD] = useState<Documento | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<Documento>(`/publico/documento/${token}`).then(setD).catch((e: unknown) => setError(e instanceof ErrorApi ? e.message : 'No se pudo abrir el documento. Intente de nuevo.'));
  }, [api, token]);
  const r = d?.resumen;
  const moneda = r?.moneda ?? 'GTQ';
  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <main className="mx-auto max-w-2xl space-y-4">
        {!d && !error && <p className="text-center text-sm text-gray-500">Cargando…</p>}
        {error && <div className="rounded-lg bg-white p-6 text-center shadow"><h1 className="text-lg font-bold text-gray-900">Documento</h1><p role="alert" className="mt-2 text-sm text-red-700">{error}</p></div>}
        {d && (
          <>
            <header className="rounded-lg bg-white p-5 shadow">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{d.taller}</p>
              <h1 className="text-xl font-bold text-gray-900">{d.tipo === 'cuenta' ? 'Cuenta' : 'Informe'} {d.folio}{d.version > 1 ? ` · versión ${d.version}` : ''}</h1>
              <p className="mt-1 text-sm text-gray-700">{[r?.cliente, r?.equipo].filter(Boolean).join(' · ')}</p>
              <p className="text-xs text-gray-500">Emitido el {formatFechaHora(aHoraDeGuatemala(d.emitido_en))}</p>
              {d.reemplaza_a_una_anterior && <p className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">Esta es la versión más reciente: reemplaza a la que le habían mandado antes.</p>}
              <a href={d.url} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white">Ver o descargar el PDF</a>
            </header>

            {d.tipo === 'cuenta' && r?.lineas && r.totales && (
              <section className="space-y-3 rounded-lg bg-white p-5 shadow">
                <h2 className="text-sm font-bold text-gray-900">Detalle{r.orden ? ` de la orden ${r.orden}` : ''}</h2>
                <ul className="divide-y divide-gray-100 text-sm">
                  {r.lineas.map((l, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 py-2">
                      <span><span className="block font-medium text-gray-900">{l.descripcion}</span><span className="block text-xs text-gray-500">{TIPO_LINEA[l.tipo] ?? l.tipo}{l.tipo !== 'servicio' ? ` · ${l.cantidad} u.` : ''}</span></span>
                      <span className="whitespace-nowrap font-semibold">{dineroDe(moneda, l.total_linea)}</span>
                    </li>
                  ))}
                </ul>
                <dl className="ml-auto max-w-xs space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-gray-600">Subtotal</dt><dd>{dineroDe(moneda, r.totales.subtotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">Descuento</dt><dd>- {dineroDe(moneda, r.totales.descuento_total)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">IVA</dt><dd>{dineroDe(moneda, r.totales.iva)}</dd></div>
                  <div className="flex justify-between border-t pt-1 text-base font-bold"><dt>Total</dt><dd>{dineroDe(moneda, r.totales.total)}</dd></div>
                </dl>
              </section>
            )}

            {d.tipo === 'checklist' && r?.hallazgos && (
              <section className="space-y-3 rounded-lg bg-white p-5 shadow">
                <h2 className="text-sm font-bold text-gray-900">{r.checklist ?? 'Revisión'} · {r.revisados ?? 0} puntos revisados</h2>
                {r.hallazgos.length === 0 && <p className="text-sm text-green-800">No se encontró nada que requiera atención.</p>}
                <ul className="space-y-2">
                  {r.hallazgos.map((h, i) => (
                    <li key={i} className={`rounded-md border p-3 text-sm ${h.semaforo === 'rojo' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
                      <p className="font-semibold text-gray-900">{h.seccion} › {h.descripcion}</p>
                      <p className="text-xs font-medium text-gray-600">{h.semaforo === 'rojo' ? 'Requiere reparación' : 'Requiere atención pronto'}</p>
                      {h.nota && <p className="text-gray-700">{h.nota}</p>}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-center text-xs text-gray-500">{d.aviso}</p>
          </>
        )}
      </main>
    </div>
  );
}
