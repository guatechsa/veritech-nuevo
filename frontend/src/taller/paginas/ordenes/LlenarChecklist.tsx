import { useEffect, useRef, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { formatFechaHora } from '../../../components/ui-guatech/formatoFecha.js';
import { ErrorApi } from '../../../admin/api';
import { prepararArchivo } from '../../componentes/imagen';
import { Aviso, Campo, CLASE_INPUT, mensajeDe } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { useNavigate } from 'react-router-dom';
import { useUbicacion } from '../../contexto';
import { DESENLACE, Desenlace } from '../cotizaciones/tipos';
import { BotonPdf } from './DocumentosOrden';
import { BotonEnlace } from './EnlacesOrden';
import { FirmaPad } from './FirmaPad';

export interface RespuestaChecklist {
  id: number;
  seccion: string;
  descripcion: string;
  tipo_respuesta: 'semaforo' | 'si_no' | 'numero' | 'texto' | 'lista';
  minimo: number | null;
  maximo: number | null;
  semaforo: 'verde' | 'amarillo' | 'rojo' | null;
  si_no: number | null;
  valor_numero: number | null;
  valor_texto: string | null;
  opcion_texto: string | null;
  nota: string | null;
  opciones: string[];
  fotos: Array<{ id: number; url: string }>;
  desenlace?: Desenlace;
}

export interface DetalleChecklist {
  id: number;
  tipo: string;
  estado: 'pendiente' | 'en_progreso' | 'completado';
  orden_numero: string | null;
  orden_id: number | null;
  equipo_id: number;
  version: number;
  exige_lectura_contador: boolean;
  requiere_firma_cliente: boolean;
  completado_en: string | null;
  completado_por: string | null;
  total: number;
  respondidas: number;
  respuestas: RespuestaChecklist[];
  firma: { firmante_nombre: string; firmado_en: string; url: string } | null;
  rojos_anteriores?: Array<{ id: number; seccion: string; descripcion: string; desenlace: Desenlace }>;
}

const COLORES: Array<{ k: 'verde' | 'amarillo' | 'rojo'; t: string; clase: string }> = [
  { k: 'verde', t: 'Bien', clase: 'bg-green-600 text-white' },
  { k: 'amarillo', t: 'Atención', clase: 'bg-amber-500 text-white' },
  { k: 'rojo', t: 'Mal', clase: 'bg-red-600 text-white' },
];

function Item({ c, r, bloqueado, alCambiar, alError }: { c: DetalleChecklist; r: RespuestaChecklist; bloqueado: boolean; alCambiar: (d: DetalleChecklist) => void; alError: (m: string) => void }) {
  const { api } = useSesionTaller();
  const [texto, setTexto] = useState(r.valor_texto ?? '');
  const [numero, setNumero] = useState(r.valor_numero !== null ? String(r.valor_numero) : '');
  const [nota, setNota] = useState(r.nota ?? '');
  const entrada = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);

  const guardar = async (cuerpo: Record<string, unknown>): Promise<void> => {
    alError('');
    try {
      alCambiar(await api.patch<DetalleChecklist>(`/checklists/${c.id}/respuestas/${r.id}`, cuerpo));
    } catch (e) {
      alError(mensajeDe(e, 'No se pudo guardar la respuesta'));
    }
  };
  const subirFoto = async (lista: FileList | null): Promise<void> => {
    const f = lista?.[0];
    if (entrada.current) entrada.current.value = '';
    if (!f) return;
    alError('');
    setSubiendo(true);
    try {
      const { blob, nombre } = await prepararArchivo(f, { soloImagen: true });
      alCambiar(await api.subir<DetalleChecklist>(`/checklists/${c.id}/respuestas/${r.id}/fotos`, blob, nombre));
    } catch (e) {
      alError(mensajeDe(e, e instanceof Error ? e.message : 'No se pudo subir la foto'));
    } finally {
      setSubiendo(false);
    }
  };
  const quitarFoto = async (fotoId: number): Promise<void> => {
    try {
      alCambiar(await api.delete<DetalleChecklist>(`/checklists/${c.id}/fotos/${fotoId}`));
    } catch (e) {
      alError(mensajeDe(e, 'No se pudo quitar la foto'));
    }
  };
  const pideFoto = r.semaforo === 'amarillo' || r.semaforo === 'rojo';

  return (
    <li className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-gray-900">{r.descripcion}{r.semaforo === 'rojo' && r.desenlace && <Badge variant={DESENLACE[r.desenlace.estado].variante}>{DESENLACE[r.desenlace.estado].texto}{r.desenlace.cotizacion ? ` · ${r.desenlace.cotizacion}` : ''}{r.desenlace.estado === 'rechazado' && r.desenlace.motivo ? ` (${r.desenlace.motivo})` : ''}</Badge>}</p>
      {r.tipo_respuesta === 'semaforo' && (
        <div className="flex flex-wrap gap-2">
          {COLORES.map((x) => (
            <button key={x.k} type="button" disabled={bloqueado} onClick={() => void guardar({ semaforo: x.k })} aria-pressed={r.semaforo === x.k} className={`rounded-md px-4 py-2 text-sm font-semibold disabled:opacity-60 ${r.semaforo === x.k ? x.clase : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'}`}>{x.t}</button>
          ))}
        </div>
      )}
      {r.tipo_respuesta === 'si_no' && (
        <div className="flex gap-2">
          {[{ v: true, t: 'Sí' }, { v: false, t: 'No' }].map((x) => {
            const activo = r.si_no === (x.v ? 1 : 0);
            return <button key={x.t} type="button" disabled={bloqueado} onClick={() => void guardar({ si_no: x.v })} aria-pressed={activo} className={`rounded-md px-5 py-2 text-sm font-semibold disabled:opacity-60 ${activo ? 'bg-primary text-white' : 'border border-gray-300 bg-white text-gray-700 hover:bg-gray-100'}`}>{x.t}</button>;
          })}
        </div>
      )}
      {r.tipo_respuesta === 'numero' && (
        <div className="flex items-center gap-2">
          <input className={`${CLASE_INPUT} max-w-[10rem]`} type="number" step="any" min={r.minimo ?? undefined} max={r.maximo ?? undefined} value={numero} disabled={bloqueado} onChange={(e) => setNumero(e.target.value)} onBlur={() => numero !== '' && numero !== String(r.valor_numero ?? '') && void guardar({ valor_numero: Number(numero) })} />
          {(r.minimo !== null || r.maximo !== null) && <span className="text-xs text-gray-500">Entre {r.minimo ?? '—'} y {r.maximo ?? '—'}</span>}
        </div>
      )}
      {r.tipo_respuesta === 'texto' && <textarea className={CLASE_INPUT} rows={2} maxLength={500} value={texto} disabled={bloqueado} onChange={(e) => setTexto(e.target.value)} onBlur={() => texto.trim() !== '' && texto !== (r.valor_texto ?? '') && void guardar({ valor_texto: texto })} />}
      {r.tipo_respuesta === 'lista' && (
        <select className={`${CLASE_INPUT} max-w-xs`} value={r.opcion_texto ?? ''} disabled={bloqueado} onChange={(e) => e.target.value && void guardar({ opcion: e.target.value })}>
          <option value="">Elija…</option>
          {r.opciones.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!bloqueado && <input className={`${CLASE_INPUT} max-w-sm text-xs`} placeholder="Nota (opcional)" maxLength={300} value={nota} onChange={(e) => setNota(e.target.value)} onBlur={() => nota !== (r.nota ?? '') && r.tipo_respuesta !== 'texto' && void guardar(r.tipo_respuesta === 'semaforo' && r.semaforo ? { semaforo: r.semaforo, nota } : r.tipo_respuesta === 'si_no' && r.si_no !== null ? { si_no: r.si_no === 1, nota } : r.tipo_respuesta === 'numero' && r.valor_numero !== null ? { valor_numero: r.valor_numero, nota } : r.tipo_respuesta === 'lista' && r.opcion_texto ? { opcion: r.opcion_texto, nota } : {})} />}
        {bloqueado && r.nota && <span className="text-xs text-gray-600">Nota: {r.nota}</span>}
        {!bloqueado && (
          <>
            <input ref={entrada} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => void subirFoto(e.target.files)} />
            <Button size="sm" variant="outline" disabled={subiendo || r.fotos.length >= 5} onClick={() => entrada.current?.click()}>{subiendo ? 'Subiendo…' : `Foto (${r.fotos.length}/5)`}</Button>
          </>
        )}
        {pideFoto && r.fotos.length === 0 && <Badge variant="warning">Pide al menos una foto</Badge>}
      </div>
      {r.fotos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {r.fotos.map((f) => (
            <figure key={f.id} className="space-y-0.5">
              <a href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt="Foto del ítem" className="h-20 w-20 rounded border border-gray-200 object-cover" /></a>
              {!bloqueado && <button type="button" className="text-xs font-semibold text-red-700 hover:underline" onClick={() => void quitarFoto(f.id)}>Quitar</button>}
            </figure>
          ))}
        </div>
      )}
    </li>
  );
}

/** Llenar un checklist: cada respuesta se guarda al instante; al completarlo queda bloqueado. */
export function LlenarChecklist({ id, alCerrar, alCambiar }: { id: number; alCerrar: () => void; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const [c, setC] = useState<DetalleChecklist | null>(null);
  const [error, setError] = useState('');
  const [faltas, setFaltas] = useState<string[]>([]);
  const [firmando, setFirmando] = useState(false);
  const [nombreFirma, setNombreFirma] = useState('');
  const [contadores, setContadores] = useState<Array<{ id: number; nombre: string; es_calendario: boolean; valor_actual: number; unidad: string }>>([]);
  const [contadorId, setContadorId] = useState('');
  const [lectura, setLectura] = useState('');
  const navegar = useNavigate();
  const { base } = useUbicacion();

  const cargar = (): void => {
    api.get<DetalleChecklist>(`/checklists/${id}`).then(setC).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar el checklist')));
  };
  useEffect(cargar, [api, id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!c?.exige_lectura_contador) return;
    api.get<{ contadores: typeof contadores }>(`/equipos/${c.equipo_id}`).then((d) => {
      const l = d.contadores.filter((x) => !x.es_calendario);
      setContadores(l);
      if (l.length === 1) setContadorId(String(l[0]?.id));
    }).catch(() => undefined);
  }, [api, c?.exige_lectura_contador, c?.equipo_id]);

  const aplicar = (d: DetalleChecklist): void => {
    setC(d);
    setFaltas([]);
    alCambiar();
  };
  const firmar = async (png: string): Promise<void> => {
    setError('');
    try {
      aplicar(await api.post<DetalleChecklist>(`/checklists/${id}/firma`, { nombre: nombreFirma, imagen: png }));
      setFirmando(false);
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar la firma'));
    }
  };
  const completar = async (): Promise<void> => {
    setError('');
    setFaltas([]);
    try {
      aplicar(await api.post<DetalleChecklist>(`/checklists/${id}/completar`, contadorId && lectura.trim() !== '' ? { lectura: { contador_id: Number(contadorId), valor: Number(lectura) } } : {}));
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'CHECKLIST_INCOMPLETO') setFaltas((e.detalle as { faltas: string[] }).faltas);
      else setError(mensajeDe(e, 'No se pudo completar el checklist'));
    }
  };

  const cotizarRojos = async (): Promise<void> => {
    setError('');
    try {
      const cot = await api.post<{ id: number }>('/cotizaciones/desde-checklist', { checklist_id: id });
      navegar(`${base}/cotizaciones?cotizacion=${cot.id}`);
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo crear la cotización'));
    }
  };
  const hayRojos = (c?.respuestas ?? []).some((r) => r.semaforo === 'rojo');
  const bloqueado = c?.estado === 'completado' || !tiene('checklists.llenar');
  const secciones = c ? [...new Set(c.respuestas.map((r) => r.seccion))] : [];
  const medidor = contadores.find((x) => String(x.id) === contadorId);
  return (
    <Modal onClose={alCerrar} title={c ? `${c.tipo}${c.orden_numero ? ` · Orden ${c.orden_numero}` : ''}` : 'Checklist'} size="2xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        {!c ? <p className="text-sm text-gray-500">Cargando…</p> : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-600">
              <span>Plantilla versión {c.version} · {c.respondidas} de {c.total} ítems respondidos</span>
              {c.estado === 'completado' ? <Badge variant="success">Completado{c.completado_en ? ` el ${formatFechaHora(c.completado_en)}` : ''}{c.completado_por ? ` por ${c.completado_por}` : ''}</Badge> : <Badge variant="warning">{c.estado === 'pendiente' ? 'Sin empezar' : 'En progreso'}</Badge>}
            </div>
            {c.estado === 'completado' && tiene('documentos.emitir') && <div className="flex flex-wrap items-start justify-end gap-2"><BotonPdf ruta={`/checklists/${c.id}/informe`} texto="Informe en PDF" /><BotonEnlace ruta={`/checklists/${c.id}/enlace-informe`} texto="Enlace del informe" /></div>}
            {(hayRojos && tiene('cotizaciones.crear')) && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900">
                <span>Este checklist tiene ítems en rojo. Se pueden cotizar: la cotización lleva los rojos con sus fotos y el cliente autoriza o rechaza cada línea.</span>
                <Button size="sm" variant="outline" onClick={() => void cotizarRojos()}>Cotizar los rojos</Button>
              </div>
            )}
            {(c.rojos_anteriores ?? []).length > 0 && (
              <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <p className="font-medium">En la revisión anterior de este equipo quedaron sin resolver:</p>
                <ul className="list-disc pl-5">{(c.rojos_anteriores ?? []).map((r) => <li key={r.id}>{r.seccion} › {r.descripcion} <Badge variant={DESENLACE[r.desenlace.estado].variante}>{DESENLACE[r.desenlace.estado].texto}</Badge></li>)}</ul>
                <p className="text-xs">Revise si el defecto sigue.</p>
              </div>
            )}
            {secciones.map((s) => (
              <section key={s} className="space-y-2">
                <h3 className="text-sm font-bold text-gray-900">{s}</h3>
                <ul className="space-y-2">{c.respuestas.filter((r) => r.seccion === s).map((r) => <Item key={r.id} c={c} r={r} bloqueado={bloqueado} alCambiar={aplicar} alError={setError} />)}</ul>
              </section>
            ))}
            {c.requiere_firma_cliente && (
              <section className="space-y-2 rounded-md border border-gray-200 p-3">
                <h3 className="text-sm font-bold text-gray-900">Firma del cliente</h3>
                {c.firma ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <img src={c.firma.url} alt="Firma del cliente" className="h-20 rounded border border-gray-200 bg-white" />
                    <span className="text-sm text-gray-600">Firmó {c.firma.firmante_nombre}, {formatFechaHora(c.firma.firmado_en)}</span>
                    {!bloqueado && <Button size="sm" variant="outline" onClick={() => setFirmando(true)}>Firmar de nuevo</Button>}
                  </div>
                ) : !bloqueado && !firmando ? <Button size="sm" variant="outline" onClick={() => setFirmando(true)}>Pedir la firma</Button> : null}
                {firmando && !bloqueado && (
                  <div className="space-y-2">
                    <Campo etiqueta="Nombre de quien firma"><input className={CLASE_INPUT} value={nombreFirma} onChange={(e) => setNombreFirma(e.target.value)} maxLength={120} autoFocus /></Campo>
                    {nombreFirma.trim().length >= 3 ? <FirmaPad alFirmar={(png) => void firmar(png)} /> : <p className="text-xs text-gray-500">Escriba el nombre completo para habilitar el espacio de la firma.</p>}
                  </div>
                )}
              </section>
            )}
            {c.exige_lectura_contador && !bloqueado && contadores.length > 0 && (
              <section className="grid gap-3 rounded-md border border-gray-200 p-3 sm:grid-cols-2">
                <Campo etiqueta="Medidor" ayuda="Si la orden ya tiene una lectura de recepción no hace falta otra."><select className={CLASE_INPUT} value={contadorId} onChange={(e) => setContadorId(e.target.value)}><option value="">Elija…</option>{contadores.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>
                <Campo etiqueta={`Lectura${medidor ? ` (hoy: ${medidor.valor_actual} ${medidor.unidad})` : ''}`}><input className={CLASE_INPUT} type="number" min={0} step="any" value={lectura} onChange={(e) => setLectura(e.target.value)} disabled={!contadorId} /></Campo>
              </section>
            )}
            {faltas.length > 0 && (
              <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                <p className="font-semibold">Todavía no se puede completar:</p>
                <ul className="list-disc pl-5">{faltas.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            )}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button variant="outline" onClick={alCerrar}>Cerrar</Button>
              {!bloqueado && <Button onClick={() => void completar()}>Completar checklist</Button>}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
