import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import Button from '../../components/ui-guatech/Button.jsx';
import { formatFecha, formatFechaHora } from '../../components/ui-guatech/formatoFecha.js';
import { ErrorApi } from '../../admin/api';
import { crearApiTaller, useUbicacion } from '../contexto';
import { dineroDe } from './ordenes/tipos';

interface PublicaLinea {
  id: number;
  tipo: 'servicio' | 'material' | 'tercero';
  descripcion: string;
  cantidad: number;
  precio_unitario: number;
  descuento_pct: number;
  total_linea: number;
  horas: number | null;
  estado: 'pendiente' | 'autorizada' | 'rechazada' | 'agregada_a_orden' | 'vencida';
  motivo_rechazo: string | null;
  motivo_rechazo_texto: string | null;
  respondida_en: string | null;
  respondida_por_nombre: string | null;
}
interface Publica {
  disponible: boolean;
  moneda?: string;
  aviso?: string;
  empresa: string;
  numero: string;
  version: number;
  cliente?: string | null;
  equipo?: string | null;
  notas?: string | null;
  vence_en?: string | null;
  vencida?: boolean;
  se_puede_responder?: boolean;
  subtotal?: number;
  descuento_total?: number;
  iva?: number;
  total?: number;
  motivos_rechazo?: Array<{ id: number; nombre: string }>;
  lineas?: PublicaLinea[];
  hallazgos?: Array<{ respuesta_id: number; seccion: string; descripcion: string; nota: string | null; fotos: Array<{ url: string }> }>;
}

type Decision = 'autorizada' | 'rechazada' | '';

/** Página que abre el cliente con el enlace de su cotización: sin iniciar sesión, pensada para el teléfono. */
export default function CotizacionPublica() {
  const { token = '' } = useParams();
  const { slug } = useUbicacion();
  const [api] = useState(() => crearApiTaller(slug));
  const [d, setD] = useState<Publica | null>(null);
  const [error, setError] = useState('');
  const [decisiones, setDecisiones] = useState<Record<number, { decision: Decision; motivo: string; detalle: string }>>({});
  const [nombre, setNombre] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [listo, setListo] = useState(false);
  const moneda = d?.moneda ?? 'GTQ';

  useEffect(() => {
    api.get<Publica>(`/publico/cotizacion/${token}`).then(setD).catch((e: unknown) => setError(e instanceof ErrorApi ? e.message : 'No se pudo abrir la cotización. Intente de nuevo.'));
  }, [api, token]);

  const pendientes = (d?.lineas ?? []).filter((l) => l.estado === 'pendiente');
  const elegidas = pendientes.filter((l) => decisiones[l.id]?.decision);
  const poner = (id: number, cambio: Partial<{ decision: Decision; motivo: string; detalle: string }>): void => setDecisiones((x) => ({ ...x, [id]: { decision: '', motivo: '', detalle: '', ...x[id], ...cambio } }));
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const nuevo = await api.post<Publica>(`/publico/cotizacion/${token}/responder`, {
        nombre,
        respuestas: elegidas.map((l) => ({ linea_id: l.id, decision: decisiones[l.id]!.decision, motivo_id: decisiones[l.id]!.decision === 'rechazada' ? Number(decisiones[l.id]!.motivo) : null, motivo_texto: decisiones[l.id]!.detalle.trim() || null })),
      });
      setD(nuevo);
      setDecisiones({});
      setListo(true);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo enviar su respuesta. Intente de nuevo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <main className="mx-auto max-w-2xl space-y-4">
        {!d && !error && <p className="text-center text-sm text-gray-500">Cargando su cotización…</p>}
        {error && !d && <div className="rounded-lg bg-white p-6 text-center shadow"><h1 className="text-lg font-bold text-gray-900">Cotización</h1><p role="alert" className="mt-2 text-sm text-red-700">{error}</p></div>}
        {d && !d.disponible && <div className="rounded-lg bg-white p-6 text-center shadow"><p className="text-xs font-semibold uppercase text-gray-500">{d.empresa}</p><h1 className="text-lg font-bold text-gray-900">Cotización {d.numero}</h1><p className="mt-2 text-sm text-gray-700">{d.aviso}</p></div>}
        {d && d.disponible && (
          <>
            <header className="rounded-lg bg-white p-5 shadow">
              <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{d.empresa}</p>
              <h1 className="text-xl font-bold text-gray-900">Cotización {d.numero}{d.version > 1 ? ` · versión ${d.version}` : ''}</h1>
              <p className="mt-1 text-sm text-gray-700">{d.cliente ?? ''}{d.equipo ? ` · ${d.equipo}` : ''}</p>
              {d.vence_en && <p className={`mt-1 text-sm ${d.vencida ? 'font-semibold text-red-700' : 'text-gray-600'}`}>{d.vencida ? 'Venció el' : 'Vigente hasta el'} {formatFecha(d.vence_en)}</p>}
              {d.notas && <p className="mt-2 rounded-md bg-gray-50 p-3 text-sm text-gray-800">{d.notas}</p>}
            </header>

            {(d.hallazgos ?? []).length > 0 && (
              <section className="space-y-3 rounded-lg bg-white p-5 shadow">
                <h2 className="text-sm font-bold text-gray-900">Lo que se encontró en su equipo</h2>
                <ul className="space-y-3">
                  {(d.hallazgos ?? []).map((h) => (
                    <li key={h.respuesta_id} className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                      <p className="font-semibold text-gray-900">{h.seccion} › {h.descripcion}</p>
                      {h.nota && <p className="text-gray-700">{h.nota}</p>}
                      {h.fotos.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{h.fotos.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={`Foto: ${h.descripcion}`} className="h-24 w-24 rounded-md border border-gray-200 object-cover" /></a>)}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <form onSubmit={enviar} className="space-y-4">
              <section className="space-y-3 rounded-lg bg-white p-5 shadow">
                <h2 className="text-sm font-bold text-gray-900">Lo que se le cotiza</h2>
                <p className="text-xs text-gray-600">{d.se_puede_responder ? 'Elija, línea por línea, si autoriza o no autoriza. Puede responder algunas hoy y el resto después.' : d.vencida ? 'Esta cotización ya venció; si todavía le interesa, pídale al taller una nueva.' : 'Todas las líneas ya tienen respuesta. Gracias.'}</p>
                <ul className="space-y-3">
                  {(d.lineas ?? []).map((l) => {
                    const x = decisiones[l.id];
                    return (
                      <li key={l.id} className="rounded-md border border-gray-200 p-3 text-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900">{l.descripcion}</p>
                            <p className="text-xs text-gray-500">{l.tipo === 'servicio' ? 'Trabajo' : l.tipo === 'material' ? 'Material' : 'Trabajo con terceros'}{l.horas ? ` · ${l.horas} h` : ''}{l.tipo !== 'servicio' ? ` · ${l.cantidad} u.` : ''}{l.descuento_pct ? ` · ${l.descuento_pct} % de descuento` : ''}</p>
                          </div>
                          <p className="whitespace-nowrap font-bold text-gray-900">{dineroDe(moneda, l.total_linea)}</p>
                        </div>
                        {l.estado === 'pendiente' && d.se_puede_responder && (
                          <fieldset className="mt-3 space-y-2">
                            <legend className="sr-only">Su respuesta para {l.descripcion}</legend>
                            <div className="flex gap-2">
                              <button type="button" aria-pressed={x?.decision === 'autorizada'} onClick={() => poner(l.id, { decision: 'autorizada' })} className={`flex-1 rounded-md border px-3 py-2 text-sm font-semibold ${x?.decision === 'autorizada' ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>Autorizo</button>
                              <button type="button" aria-pressed={x?.decision === 'rechazada'} onClick={() => poner(l.id, { decision: 'rechazada' })} className={`flex-1 rounded-md border px-3 py-2 text-sm font-semibold ${x?.decision === 'rechazada' ? 'border-red-600 bg-red-600 text-white' : 'border-gray-300 bg-white text-gray-700'}`}>No autorizo</button>
                            </div>
                            {x?.decision === 'rechazada' && (
                              <div className="space-y-2">
                                <select required aria-label="Motivo" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" value={x.motivo} onChange={(e) => poner(l.id, { motivo: e.target.value })}><option value="">¿Por qué no autoriza?</option>{(d.motivos_rechazo ?? []).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select>
                                <input aria-label="Detalle (opcional)" className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" placeholder="Detalle (opcional)" maxLength={300} value={x.detalle} onChange={(e) => poner(l.id, { detalle: e.target.value })} />
                              </div>
                            )}
                          </fieldset>
                        )}
                        {l.estado !== 'pendiente' && (
                          <p className={`mt-2 text-xs font-semibold ${l.estado === 'rechazada' ? 'text-red-700' : l.estado === 'vencida' ? 'text-gray-500' : 'text-green-700'}`}>
                            {l.estado === 'rechazada' ? 'No autorizada' : l.estado === 'vencida' ? 'Venció sin respuesta' : 'Autorizada'}
                            {l.respondida_en ? ` · ${formatFechaHora(l.respondida_en)}` : ''}{l.respondida_por_nombre ? ` · ${l.respondida_por_nombre}` : ''}{l.motivo_rechazo ? ` · ${l.motivo_rechazo}` : ''}
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
                <dl className="ml-auto max-w-xs space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-gray-600">Subtotal</dt><dd>{dineroDe(moneda, d.subtotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">Descuento</dt><dd>- {dineroDe(moneda, d.descuento_total)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">IVA</dt><dd>{dineroDe(moneda, d.iva)}</dd></div>
                  <div className="flex justify-between border-t pt-1 text-base font-bold"><dt>Total</dt><dd>{dineroDe(moneda, d.total)}</dd></div>
                </dl>
              </section>

              {d.se_puede_responder && (
                <section className="space-y-3 rounded-lg bg-white p-5 shadow">
                  <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Su nombre completo</span><input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" value={nombre} onChange={(e) => setNombre(e.target.value)} minLength={3} maxLength={100} required autoComplete="name" /></label>
                  <p className="text-xs text-gray-500">Al enviar, queda registrado su nombre, la fecha y hora y el dispositivo desde el que responde.</p>
                  {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
                  <Button type="submit" disabled={enviando || elegidas.length === 0 || nombre.trim().length < 3}>{enviando ? 'Enviando…' : `Enviar mi respuesta (${elegidas.length} de ${pendientes.length})`}</Button>
                </section>
              )}
              {listo && <p role="status" className="rounded-lg bg-green-50 p-4 text-sm text-green-800 shadow">Recibimos su respuesta. El taller la tiene registrada y se comunicará con usted.</p>}
            </form>
          </>
        )}
      </main>
    </div>
  );
}
