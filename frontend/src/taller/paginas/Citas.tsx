import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Acciones, BotonAccion } from '../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import FechaInput from '../../components/ui-guatech/FechaInput';
import Modal from '../../components/ui-guatech/Modal.jsx';
import { formatFecha, hoyIso } from '../../components/ui-guatech/formatoFecha.js';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../componentes/ui';
import { useUbicacion } from '../contexto';
import { useSesionTaller } from '../Sesion';
import { BuscadorEquipo, EquipoFila } from './ordenes/NuevaOrden';
import { OpcionesOrden } from './ordenes/tipos';

interface Cita {
  id: number;
  equipo_id: number;
  equipo: string;
  cliente: string | null;
  sucursal: string;
  sucursal_id: number;
  fecha: string;
  hora: string;
  horas_estimadas: number;
  estado: 'programada' | 'se_presento' | 'no_se_presento' | 'cancelada';
  origen?: 'recepcion' | 'aviso' | 'portal';
  por_confirmar?: number;
  notas: string | null;
  lectura_contador: number | null;
  motivo_cancelacion: string | null;
  motivo_cancelacion_texto: string | null;
  orden_id: number | null;
  orden_numero: string | null;
  minutos_de_diferencia: number | null;
  ya_paso: boolean;
}

interface OpcionesCita {
  motivos_cancelacion: Array<{ id: number; nombre: string }>;
  sucursales: Array<{ id: number; nombre: string; es_principal: number; cupo_diario_citas: number | null }>;
}

const ESTADO: Record<Cita['estado'], { texto: string; variante: 'default' | 'success' | 'warning' | 'danger' | 'info' }> = {
  programada: { texto: 'Programada', variante: 'info' },
  se_presento: { texto: 'Se presentó', variante: 'success' },
  no_se_presento: { texto: 'No se presentó', variante: 'danger' },
  cancelada: { texto: 'Cancelada', variante: 'default' },
};

const sumarDias = (iso: string, n: number): string => new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)) + n)).toISOString().slice(0, 10);

// ── Agendar o reprogramar ─────────────────────────────────────────────────────────────
/** 90 minutos → «1 h 30 min»; más de un día → «1 día 3 h». */
function duracionCorta(minutos: number): string {
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return minutos % 60 ? `${horas} h ${minutos % 60} min` : `${horas} h`;
  const dias = Math.floor(horas / 24);
  return horas % 24 ? `${dias} ${dias === 1 ? 'día' : 'días'} ${horas % 24} h` : `${dias} ${dias === 1 ? 'día' : 'días'}`;
}

function FormularioCita({ cita, equipoInicial, servicioId, alCerrar, alListo }: { cita?: Cita; equipoInicial?: EquipoFila | null; servicioId?: number; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const opciones = useLista(() => api.get<OpcionesCita>('/citas-opciones'), [api]);
  const [equipo, setEquipo] = useState<EquipoFila | null>(equipoInicial ?? null);
  const [fecha, setFecha] = useState(cita?.fecha ?? '');
  const [hora, setHora] = useState(cita?.hora ?? '08:00');
  const [horas, setHoras] = useState(String(cita?.horas_estimadas ?? 1));
  const [sucursal, setSucursal] = useState(cita ? String(cita.sucursal_id) : '');
  const [notas, setNotas] = useState(cita?.notas ?? '');
  const [lectura, setLectura] = useState(cita?.lectura_contador != null ? String(cita.lectura_contador) : '');
  const [error, setError] = useState('');
  const [avisos, setAvisos] = useState<string[]>([]);
  const [listo, setListo] = useState(false);

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      const cuerpo = { fecha, hora, horas_estimadas: Number(horas), notas: notas.trim() || null, lectura_contador: lectura.trim() === '' ? null : Number(lectura), ...(sucursal ? { sucursal_id: Number(sucursal) } : {}) };
      const r = cita
        ? await api.patch<{ avisos: Array<{ mensaje: string }> }>(`/citas/${cita.id}`, cuerpo)
        : await api.post<{ avisos: Array<{ mensaje: string }> }>('/citas', { ...cuerpo, equipo_id: equipo?.id, ...(servicioId ? { servicio_programado_id: servicioId } : {}) });
      if (r.avisos.length > 0) {
        setAvisos(r.avisos.map((a) => a.mensaje));
        setListo(true);
      } else alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar la cita'));
    }
  };
  return (
    <Modal onClose={listo ? alListo : alCerrar} title={cita ? 'Reprogramar la cita' : 'Nueva cita'} size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error || opciones.error} tipo="error" />
        {listo && (
          <div className="space-y-2">
            <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">La cita quedó guardada.</p>
            {avisos.map((a) => <p key={a} className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">{a}</p>)}
            <div className="flex justify-end"><Button onClick={alListo}>Entendido</Button></div>
          </div>
        )}
        {!listo && (
          <>
            {cita ? <p className="text-sm text-gray-700">{cita.equipo} · {cita.cliente ?? 'Del taller'}</p> : <Campo etiqueta="Equipo"><BuscadorEquipo valor={equipo} alCambiar={setEquipo} /></Campo>}
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo etiqueta="Día"><FechaInput value={fecha} onChange={(e) => setFecha(e.target.value)} min={hoyIso()} required className={CLASE_INPUT} /></Campo>
              <Campo etiqueta="Hora"><input className={CLASE_INPUT} type="text" inputMode="numeric" placeholder="HH:mm (24 horas)" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" maxLength={5} title="Escriba la hora así: 08:30 o 14:00" value={hora} onChange={(e) => setHora(e.target.value)} required /></Campo>
              <Campo etiqueta="Horas estimadas" ayuda="Sirven para planificar la carga del taller."><input className={CLASE_INPUT} type="number" min={0.25} max={24} step="0.25" value={horas} onChange={(e) => setHoras(e.target.value)} required /></Campo>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Sucursal">
                <select className={CLASE_INPUT} value={sucursal} onChange={(e) => setSucursal(e.target.value)}>
                  <option value="">La principal</option>
                  {(opciones.datos?.sucursales ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}{s.cupo_diario_citas ? ` (cupo ${s.cupo_diario_citas} al día)` : ''}</option>)}
                </select>
              </Campo>
              <Campo etiqueta="Lectura del medidor que dijo el cliente (opcional)"><input className={CLASE_INPUT} type="number" min={0} step="any" value={lectura} onChange={(e) => setLectura(e.target.value)} /></Campo>
            </div>
            <Campo etiqueta="Para qué viene"><textarea className={CLASE_INPUT} rows={3} maxLength={500} value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" disabled={!cita && !equipo}>{cita ? 'Guardar cambios' : 'Agendar'}</Button></div>
          </>
        )}
      </form>
    </Modal>
  );
}

// ── Cancelar ──────────────────────────────────────────────────────────────────────────
function CancelarCita({ cita, alCerrar, alListo }: { cita: Cita; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const opciones = useLista(() => api.get<OpcionesCita>('/citas-opciones'), [api]);
  const [motivo, setMotivo] = useState('');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post(`/citas/${cita.id}/cancelar`, { motivo_id: Number(motivo), texto: texto.trim() || null });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cancelar la cita'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Cancelar la cita" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">{cita.equipo}, {formatFecha(cita.fecha)} a las {cita.hora}. La cita no se borra: queda cancelada con su motivo y libera el lugar.</p>
        <Campo etiqueta="Motivo"><select className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} required><option value="">Elija…</option>{(opciones.datos?.motivos_cancelacion ?? []).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Detalle (opcional)"><input className={CLASE_INPUT} maxLength={300} value={texto} onChange={(e) => setTexto(e.target.value)} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Volver</Button><Button type="submit" variant="danger">Cancelar cita</Button></div>
      </form>
    </Modal>
  );
}

// ── Recibir al cliente: nace la orden ─────────────────────────────────────────────────
function RecibirCita({ cita, alCerrar, alListo }: { cita: Cita; alCerrar: () => void; alListo: (ordenId: number) => void }) {
  const { api } = useSesionTaller();
  const opciones = useLista(() => api.get<OpcionesOrden>('/ordenes-opciones'), [api]);
  const [contadores, setContadores] = useState<Array<{ id: number; nombre: string; es_calendario: boolean; valor_actual: number; unidad: string }>>([]);
  const [tipoId, setTipoId] = useState('');
  const [prioridad, setPrioridad] = useState('media');
  const [descripcion, setDescripcion] = useState(cita.notas ?? '');
  const [contadorId, setContadorId] = useState('');
  const [lectura, setLectura] = useState(cita.lectura_contador != null ? String(cita.lectura_contador) : '');
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<{ contadores: typeof contadores }>(`/equipos/${cita.equipo_id}`).then((d) => {
      const l = d.contadores.filter((c) => !c.es_calendario);
      setContadores(l);
      if (l.length === 1) setContadorId(String(l[0]?.id));
    }).catch(() => undefined);
  }, [api, cita.equipo_id]);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      const r = await api.post<{ orden_id: number }>(`/citas/${cita.id}/recibir`, {
        ...(tipoId ? { tipo_orden_id: Number(tipoId) } : {}),
        prioridad,
        descripcion: descripcion.trim() || null,
        ...(contadorId && lectura.trim() !== '' ? { lectura: { contador_id: Number(contadorId), valor: Number(lectura) } } : {}),
      });
      alListo(r.orden_id);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo recibir el equipo'));
    }
  };
  const medidor = contadores.find((c) => String(c.id) === contadorId);
  return (
    <Modal onClose={alCerrar} title="Recibir el equipo" size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error || opciones.error} tipo="error" />
        <p className="text-sm text-gray-700">{cita.equipo} · {cita.cliente ?? 'Del taller'}. Al recibirlo se abre la orden de trabajo y la cita queda «se presentó» con la hora de llegada.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tipo de orden"><select className={CLASE_INPUT} value={tipoId} onChange={(e) => setTipoId(e.target.value)}><option value="">{opciones.datos?.tipos_orden.find((t) => t.es_default === 1)?.nombre ?? 'Por defecto'} (por defecto)</option>{(opciones.datos?.tipos_orden ?? []).filter((t) => t.es_default !== 1).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Prioridad"><select className={CLASE_INPUT} value={prioridad} onChange={(e) => setPrioridad(e.target.value)}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></Campo>
        </div>
        <Campo etiqueta="Qué se pide o qué falla tiene"><textarea className={CLASE_INPUT} rows={3} maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Campo>
        {contadores.length > 0 && (
          <div className="grid gap-3 rounded-md border border-gray-200 p-3 sm:grid-cols-2">
            <Campo etiqueta="Medidor que se lee"><select className={CLASE_INPUT} value={contadorId} onChange={(e) => setContadorId(e.target.value)}><option value="">No anotar lectura</option>{contadores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
            <Campo etiqueta={`Lectura${medidor ? ` (hoy: ${medidor.valor_actual} ${medidor.unidad})` : ''}`}><input className={CLASE_INPUT} type="number" min={0} step="any" value={lectura} onChange={(e) => setLectura(e.target.value)} disabled={!contadorId} /></Campo>
          </div>
        )}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Volver</Button><Button type="submit">Recibir y abrir la orden</Button></div>
      </form>
    </Modal>
  );
}

// ── La pantalla ───────────────────────────────────────────────────────────────────────
type Ventana = { tipo: 'nueva'; equipo?: EquipoFila; servicio?: number } | { tipo: 'reprogramar' | 'cancelar' | 'recibir'; cita: Cita } | null;

export default function Citas() {
  const { api, tiene } = useSesionTaller();
  const { base } = useUbicacion();
  const navegar = useNavigate();
  const [params, setParams] = useSearchParams();
  const [desde, setDesde] = useState(hoyIso());
  const [hasta, setHasta] = useState(sumarDias(hoyIso(), 14));
  const [estado, setEstado] = useState('');
  const [ventana, setVentana] = useState<Ventana>(null);
  const [error, setError] = useState('');
  const q = new URLSearchParams({ ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(estado ? { estado } : {}) });
  const lista = useLista(() => api.get<{ total: number; registros: Cita[] }>(`/citas?${q.toString()}`), [api, desde, hasta, estado]);
  const gestionar = tiene('citas.gestionar');
  // «Agendar cita» desde un servicio por vencer: llega con el equipo y el servicio elegidos.
  useEffect(() => {
    const e = Number(params.get('nueva'));
    if (!gestionar || !Number.isInteger(e) || e <= 0) return;
    const s = Number(params.get('servicio'));
    api.get<{ id: number; descripcion: string; cliente: string | null; tipo_equipo: string; estado: string }>(`/equipos/${e}`).then((q) => {
      setVentana({ tipo: 'nueva', equipo: q, servicio: Number.isInteger(s) && s > 0 ? s : undefined });
      setParams({}, { replace: true });
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cerrar = (): void => {
    setVentana(null);
    lista.recargar();
  };
  const noSePresento = async (c: Cita): Promise<void> => {
    setError('');
    try {
      await api.post(`/citas/${c.id}/no-se-presento`, {});
      lista.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo marcar la cita'));
    }
  };
  const confirmar = async (c: Cita): Promise<void> => {
    setError('');
    try {
      await api.post(`/citas/${c.id}/confirmar`, {});
      lista.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo confirmar la cita'));
    }
  };
  const porDia = new Map<string, Cita[]>();
  for (const c of lista.datos?.registros ?? []) porDia.set(c.fecha, [...(porDia.get(c.fecha) ?? []), c]);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Citas</h1>
      <Seccion titulo="Agenda del taller" acciones={gestionar && <Button onClick={() => setVentana({ tipo: 'nueva' })}>Nueva cita</Button>}>
        <div className="flex flex-wrap items-end gap-3">
          <Campo etiqueta="Desde"><FechaInput value={desde} onChange={(e) => setDesde(e.target.value)} className={CLASE_INPUT} /></Campo>
          <Campo etiqueta="Hasta"><FechaInput value={hasta} onChange={(e) => setHasta(e.target.value)} className={CLASE_INPUT} /></Campo>
          <Campo etiqueta="Estado">
            <select className={CLASE_INPUT} value={estado} onChange={(e) => setEstado(e.target.value)}>
              <option value="">Todas</option><option value="programada">Programadas</option><option value="se_presento">Se presentó</option><option value="no_se_presento">No se presentó</option><option value="cancelada">Canceladas</option>
            </select>
          </Campo>
        </div>
        <Aviso mensaje={error || lista.error} tipo="error" />
        {lista.datos && lista.datos.registros.length === 0 && <p className="rounded-md bg-white p-4 text-sm text-gray-600 shadow-sm">No hay citas en esas fechas.</p>}
        {[...porDia.entries()].map(([dia, citas]) => (
          <section key={dia} className="space-y-2">
            <h2 className="text-sm font-bold text-gray-900">{formatFecha(dia)} <span className="font-normal text-gray-500">· {citas.length} {citas.length === 1 ? 'cita' : 'citas'}</span></h2>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white shadow-sm">
              {citas.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 space-y-0.5">
                    <p className="font-medium text-gray-900"><span className="mr-2 text-primary">{c.hora}</span>{c.equipo}</p>
                    <p className="text-gray-600">{c.cliente ?? 'Del taller'} · {c.sucursal} · {c.horas_estimadas} h estimadas</p>
                    {c.notas && <p className="text-gray-700">{c.notas}</p>}
                    {c.estado === 'cancelada' && <p className="text-gray-500">Motivo: {c.motivo_cancelacion}{c.motivo_cancelacion_texto ? ` — ${c.motivo_cancelacion_texto}` : ''}</p>}
                    {c.estado === 'se_presento' && c.minutos_de_diferencia !== null && (
                      <p className="text-gray-500">
                        {c.minutos_de_diferencia > 5 ? `Llegó ${duracionCorta(c.minutos_de_diferencia)} tarde` : c.minutos_de_diferencia < -5 ? `Llegó ${duracionCorta(-c.minutos_de_diferencia)} antes` : 'Llegó puntual'}
                        {c.orden_numero ? ` · Orden ${c.orden_numero}` : ''}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    {c.por_confirmar === 1 && c.estado === 'programada' && <Badge variant="warning">Pedida desde el portal: por confirmar</Badge>}
                    <Badge variant={ESTADO[c.estado].variante}>{ESTADO[c.estado].texto}</Badge>
                    {c.orden_id && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => navegar(`${base}/ordenes?orden=${c.orden_id}`)}>Ver orden</button>}
                    {gestionar && c.estado === 'programada' && (
                      <Acciones>
                        {c.por_confirmar === 1 && <BotonAccion onClick={() => void confirmar(c)}>Confirmar</BotonAccion>}
                        {tiene('ordenes.crear') && <BotonAccion onClick={() => setVentana({ tipo: 'recibir', cita: c })}>Recibir</BotonAccion>}
                        <BotonAccion onClick={() => setVentana({ tipo: 'reprogramar', cita: c })}>Reprogramar</BotonAccion>
                        {c.ya_paso && <BotonAccion onClick={() => void noSePresento(c)}>No se presentó</BotonAccion>}
                        <BotonAccion onClick={() => setVentana({ tipo: 'cancelar', cita: c })}>Cancelar</BotonAccion>
                      </Acciones>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </Seccion>
      {ventana?.tipo === 'nueva' && <FormularioCita equipoInicial={ventana.equipo} servicioId={ventana.servicio} alCerrar={() => setVentana(null)} alListo={cerrar} />}
      {ventana?.tipo === 'reprogramar' && <FormularioCita cita={ventana.cita} alCerrar={() => setVentana(null)} alListo={cerrar} />}
      {ventana?.tipo === 'cancelar' && <CancelarCita cita={ventana.cita} alCerrar={() => setVentana(null)} alListo={cerrar} />}
      {ventana?.tipo === 'recibir' && <RecibirCita cita={ventana.cita} alCerrar={() => setVentana(null)} alListo={(id) => { setVentana(null); setParams({}, { replace: true }); navegar(`${base}/ordenes?orden=${id}`); }} />}
    </div>
  );
}
