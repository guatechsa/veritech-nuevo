import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatFecha } from '../../components/ui-guatech/formatoFecha.js';
import { ErrorApi } from '../../admin/api';
import { crearApiTaller, useUbicacion } from '../contexto';

interface Equipo {
  disponible: boolean;
  taller: string;
  equipo: { etiqueta: string; codigo_interno: string | null; placa: string | null; serie: string | null; marca: string | null; modelo: string | null; anio: number | null; color: string | null; tipo: string; fuera_de_servicio: boolean };
  foto: string | null;
  servicios: Array<{ servicio: string; estado: 'vencido' | 'urgente' | 'proximo' | 'al_dia' | 'sin_contador'; unidad: string; restante: number | null; ultimo_servicio: { valor: number; fecha: string } | null }>;
  historial: Array<{ numero: string; cerrada_en: string | null; tipo: string; descripcion: string | null; trabajos: Array<{ tipo: string; descripcion: string; cantidad: number }> }>;
}

const ESTADO: Record<string, { texto: string; clase: string }> = {
  vencido: { texto: 'Vencido', clase: 'bg-red-100 text-red-800' },
  urgente: { texto: 'Urgente', clase: 'bg-orange-100 text-orange-800' },
  proximo: { texto: 'Próximo', clase: 'bg-yellow-100 text-yellow-800' },
  al_dia: { texto: 'Al día', clase: 'bg-green-100 text-green-800' },
  sin_contador: { texto: 'Sin lecturas', clase: 'bg-gray-100 text-gray-700' },
};

/** Lo que ve quien escanea el QR pegado al equipo: su ficha, sus servicios y lo que se le ha hecho. Sin costos ni datos internos del taller. */
export default function EquipoPublico() {
  const { codigo = '' } = useParams();
  const { slug } = useUbicacion();
  const [api] = useState(() => crearApiTaller(slug));
  const [d, setD] = useState<Equipo | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<Equipo>(`/publico/equipo/${codigo}`).then(setD).catch((e: unknown) => setError(e instanceof ErrorApi ? e.message : 'No se pudo abrir la ficha. Intente de nuevo.'));
  }, [api, codigo]);
  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <main className="mx-auto max-w-2xl space-y-4">
        {!d && !error && <p className="text-center text-sm text-gray-500">Cargando…</p>}
        {error && <div className="rounded-lg bg-white p-6 text-center shadow"><h1 className="text-lg font-bold text-gray-900">Equipo</h1><p role="alert" className="mt-2 text-sm text-red-700">{error}</p></div>}
        {d && (
          <>
            <header className="rounded-lg bg-white p-5 shadow">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{d.taller}</p>
              <h1 className="text-xl font-bold text-gray-900">{d.equipo.etiqueta || d.equipo.tipo}</h1>
              {d.equipo.fuera_de_servicio && <p className="mt-1 text-sm font-semibold text-red-700">Fuera de servicio</p>}
              {d.foto && <img src={d.foto} alt="Foto del equipo" className="mt-3 max-h-60 w-full rounded-md object-cover" />}
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                {([['Tipo', d.equipo.tipo], ['Marca', d.equipo.marca], ['Modelo', d.equipo.modelo], ['Año', d.equipo.anio], ['Color', d.equipo.color], ['Placa', d.equipo.placa], ['Código interno', d.equipo.codigo_interno], ['Serie / VIN', d.equipo.serie]] as Array<[string, string | number | null]>)
                  .filter(([, v]) => v !== null && v !== '')
                  .map(([k, v]) => <div key={k}><dt className="text-xs text-gray-500">{k}</dt><dd className="font-medium text-gray-900">{v}</dd></div>)}
              </dl>
            </header>

            {d.servicios.length > 0 && (
              <section className="space-y-2 rounded-lg bg-white p-5 shadow">
                <h2 className="text-sm font-bold text-gray-900">Servicios programados</h2>
                <ul className="divide-y divide-gray-100 text-sm">
                  {d.servicios.map((s) => (
                    <li key={s.servicio} className="flex items-center justify-between gap-3 py-2">
                      <span><span className="block font-medium text-gray-900">{s.servicio}</span>{s.ultimo_servicio && <span className="block text-xs text-gray-500">Último: {formatFecha(s.ultimo_servicio.fecha)}</span>}</span>
                      <span className="text-right"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ESTADO[s.estado]?.clase ?? ''}`}>{ESTADO[s.estado]?.texto ?? s.estado}</span>{s.restante !== null && s.estado !== 'sin_contador' && <span className="block text-xs text-gray-500">{s.restante >= 0 ? `faltan ${s.restante} ${s.unidad}` : `pasado por ${Math.abs(s.restante)} ${s.unidad}`}</span>}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-2 rounded-lg bg-white p-5 shadow">
              <h2 className="text-sm font-bold text-gray-900">Lo que se le ha hecho</h2>
              {d.historial.length === 0 && <p className="text-sm text-gray-500">Todavía no hay trabajos terminados.</p>}
              <ul className="space-y-3">
                {d.historial.map((o) => (
                  <li key={o.numero} className="rounded-md border border-gray-200 p-3 text-sm">
                    <p className="font-semibold text-gray-900">{o.tipo}{o.cerrada_en ? ` · ${formatFecha(o.cerrada_en.slice(0, 10))}` : ''}</p>
                    {o.descripcion && <p className="text-gray-700">{o.descripcion}</p>}
                    {o.trabajos.length > 0 && <ul className="mt-1 list-disc pl-5 text-gray-700">{o.trabajos.map((t, i) => <li key={i}>{t.descripcion}{t.tipo === 'material' ? ` (${t.cantidad} u.)` : ''}</li>)}</ul>}
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
