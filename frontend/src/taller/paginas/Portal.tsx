import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Button from '../../components/ui-guatech/Button.jsx';
import FechaInput from '../../components/ui-guatech/FechaInput';
import { formatFecha, formatFechaHora } from '../../components/ui-guatech/formatoFecha.js';
import { ErrorApi } from '../../admin/api';
import { aHoraDeGuatemala } from '../../utils/hora';
import { crearApiTaller, useUbicacion } from '../contexto';
import { Aviso, Campo, CLASE_INPUT, mensajeDe } from '../componentes/ui';
import { Publica, VistaCotizacion } from './CotizacionPublica';

interface Resumen {
  taller: string;
  personas: Array<{ nombre: string; cliente: string; rol: string }>;
  puede_aprobar: boolean;
  equipos: Array<{ id: number; etiqueta: string; detalle: string; cliente: string | null; ordenes_abiertas: Array<{ numero: string; estado: string; tipo: string; descripcion: string | null; entrega_estimada: string | null; avance: number | null }> }>;
  cotizaciones_por_responder: Array<{ id: number; numero: string; equipo_id: number; vence_en: string | null }>;
  citas: Array<{ id: number; equipo_id: number; fecha_hora: string; por_confirmar: boolean }>;
}

interface Ficha {
  equipo: { etiqueta: string; placa: string | null; serie: string | null; marca: string | null; modelo: string | null; anio: number | null; color: string | null; tipo: string };
  ordenes: Array<{ numero: string; tipo: string; estado: string; abierta: boolean; cancelada: boolean; cerrada_en: string | null; entrega_estimada: string | null; descripcion: string | null; avance: number | null; trabajos: Array<{ tipo: string; descripcion: string; cantidad: number; terminado: boolean }> }>;
  documentos: Array<{ tipo: string; folio: string; version: number; emitido_en: string; url: string }>;
  servicios: Array<{ servicio: string; estado: string; unidad: string; restante: number | null }>;
}

type Vista = { k: 'inicio' } | { k: 'equipo'; id: number } | { k: 'cotizacion'; id: number } | { k: 'cita' };

const CLAVE = (slug: string): string => `vt-portal-${slug}`;
const leer = (slug: string): string | null => {
  try {
    return sessionStorage.getItem(CLAVE(slug));
  } catch {
    return null;
  }
};
const guardar = (slug: string, token: string | null): void => {
  try {
    if (token) sessionStorage.setItem(CLAVE(slug), token);
    else sessionStorage.removeItem(CLAVE(slug));
  } catch {
    // Sin almacenamiento, la sesión dura mientras la página siga abierta.
  }
};

const Tarjeta = ({ children }: { children: React.ReactNode }) => <section className="space-y-3 rounded-lg bg-white p-5 shadow">{children}</section>;

// ── Entrar con correo y código ────────────────────────────────────────────────────────
function Entrar({ slug, alEntrar }: { slug: string; alEntrar: (token: string) => void }) {
  const api = useMemo(() => crearApiTaller(slug, { token: null }), [slug]);
  const [correo, setCorreo] = useState('');
  const [codigo, setCodigo] = useState('');
  const [paso, setPaso] = useState<'correo' | 'codigo'>('correo');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const pedir = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setTrabajando(true);
    try {
      const r = await api.post<{ mensaje: string }>('/publico/portal/codigo', { correo: correo.trim() });
      setMensaje(r.mensaje);
      setPaso('codigo');
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo pedir el código'));
    } finally {
      setTrabajando(false);
    }
  };
  const entrar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setTrabajando(true);
    try {
      const r = await api.post<{ token: string }>('/publico/portal/entrar', { correo: correo.trim(), codigo: codigo.trim() });
      alEntrar(r.token);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo entrar'));
    } finally {
      setTrabajando(false);
    }
  };
  return (
    <div className="mx-auto max-w-sm space-y-4">
      <Tarjeta>
        <h1 className="text-xl font-bold text-gray-900">Portal del cliente</h1>
        <p className="text-sm text-gray-600">Vea el estado de sus equipos, sus cuentas e informes y pida citas. Entre con su correo: le mandamos un código.</p>
        {paso === 'correo' ? (
          <form onSubmit={(e) => void pedir(e)} className="space-y-3">
            <Campo etiqueta="Su correo"><input className={CLASE_INPUT} type="email" required autoComplete="email" data-no-uppercase="true" value={correo} onChange={(e) => setCorreo(e.target.value)} /></Campo>
            <Aviso mensaje={error} tipo="error" />
            <Button type="submit" className="w-full" disabled={trabajando}>{trabajando ? 'Enviando…' : 'Enviarme un código'}</Button>
          </form>
        ) : (
          <form onSubmit={(e) => void entrar(e)} className="space-y-3">
            <Aviso mensaje={mensaje} tipo="ok" />
            <Campo etiqueta="Código de 6 números"><input className={`${CLASE_INPUT} text-center text-xl tracking-widest`} inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))} autoFocus data-no-uppercase="true" /></Campo>
            <Aviso mensaje={error} tipo="error" />
            <Button type="submit" className="w-full" disabled={trabajando || codigo.length !== 6}>{trabajando ? 'Entrando…' : 'Entrar'}</Button>
            <button type="button" className="w-full text-sm text-primary underline" onClick={() => { setPaso('correo'); setCodigo(''); setError(''); setMensaje(''); }}>Pedir otro código</button>
          </form>
        )}
      </Tarjeta>
    </div>
  );
}

// ── Una pantalla por cosa ─────────────────────────────────────────────────────────────
function Avance({ valor }: { valor: number | null }) {
  if (valor === null) return null;
  return (
    <div className="mt-1" aria-label={`Avance ${valor} por ciento`}>
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200"><div className="h-2 rounded-full bg-primary" style={{ width: `${valor}%` }} /></div>
      <p className="mt-0.5 text-xs text-gray-500">{valor} % de los trabajos</p>
    </div>
  );
}

function Inicio({ r, ir }: { r: Resumen; ir: (v: Vista) => void }) {
  return (
    <>
      {r.cotizaciones_por_responder.length > 0 && (
        <Tarjeta>
          <h2 className="text-sm font-bold text-gray-900">Cotizaciones esperando su respuesta</h2>
          <ul className="divide-y divide-gray-100 text-sm">
            {r.cotizaciones_por_responder.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span><span className="font-medium text-gray-900">{c.numero}</span>{c.vence_en && <span className="block text-xs text-gray-500">Vigente hasta el {formatFecha(c.vence_en)}</span>}</span>
                <Button size="sm" onClick={() => ir({ k: 'cotizacion', id: c.id })}>Ver</Button>
              </li>
            ))}
          </ul>
        </Tarjeta>
      )}
      <Tarjeta>
        <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-bold text-gray-900">Sus equipos</h2><Button size="sm" variant="outline" onClick={() => ir({ k: 'cita' })}>Pedir una cita</Button></div>
        {r.equipos.length === 0 && <p className="text-sm text-gray-500">Todavía no hay equipos asignados a su correo. Pídale al taller que se los agregue.</p>}
        <ul className="space-y-3">
          {r.equipos.map((e) => (
            <li key={e.id} className="rounded-md border border-gray-200 p-3 text-sm">
              <button type="button" onClick={() => ir({ k: 'equipo', id: e.id })} className="block w-full text-left">
                <span className="block font-semibold text-gray-900">{e.etiqueta}</span>
                <span className="block text-xs text-gray-500">{e.detalle}</span>
              </button>
              {e.ordenes_abiertas.length === 0 ? <p className="mt-2 text-xs text-gray-500">No tiene trabajos en el taller.</p> : e.ordenes_abiertas.map((o) => (
                <div key={o.numero} className="mt-2 rounded-md bg-gray-50 p-2">
                  <p className="font-medium text-gray-900">{o.tipo} · <span className="text-primary">{o.estado}</span></p>
                  {o.descripcion && <p className="text-xs text-gray-600">{o.descripcion}</p>}
                  {o.entrega_estimada && <p className="text-xs text-gray-500">Entrega estimada: {formatFecha(o.entrega_estimada.slice(0, 10))}</p>}
                  <Avance valor={o.avance} />
                </div>
              ))}
            </li>
          ))}
        </ul>
      </Tarjeta>
      {r.citas.length > 0 && (
        <Tarjeta>
          <h2 className="text-sm font-bold text-gray-900">Sus citas</h2>
          <ul className="divide-y divide-gray-100 text-sm">
            {r.citas.map((c) => <li key={c.id} className="flex items-center justify-between py-2"><span>{formatFechaHora(aHoraDeGuatemala(c.fecha_hora))} · {r.equipos.find((e) => e.id === c.equipo_id)?.etiqueta ?? ''}</span>{c.por_confirmar ? <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-semibold text-yellow-800">Por confirmar</span> : <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">Confirmada</span>}</li>)}
          </ul>
        </Tarjeta>
      )}
    </>
  );
}

function Equipo({ api, id }: { api: ReturnType<typeof crearApiTaller>; id: number }) {
  const [f, setF] = useState<Ficha | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<Ficha>(`/portal/equipos/${id}`).then(setF).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo abrir el equipo')));
  }, [api, id]);
  if (error) return <Aviso mensaje={error} tipo="error" />;
  if (!f) return <p className="text-center text-sm text-gray-500">Cargando…</p>;
  return (
    <>
      <Tarjeta>
        <h2 className="text-lg font-bold text-gray-900">{f.equipo.etiqueta}</h2>
        <p className="text-sm text-gray-600">{[f.equipo.tipo, f.equipo.marca, f.equipo.modelo, f.equipo.anio, f.equipo.color].filter(Boolean).join(' · ')}</p>
        {f.equipo.serie && <p className="text-xs text-gray-500">Serie / VIN: {f.equipo.serie}</p>}
      </Tarjeta>
      {f.servicios.length > 0 && (
        <Tarjeta>
          <h3 className="text-sm font-bold text-gray-900">Servicios programados</h3>
          <ul className="divide-y divide-gray-100 text-sm">{f.servicios.map((s) => <li key={s.servicio} className="flex justify-between py-2"><span>{s.servicio}</span><span className={s.estado === 'vencido' || s.estado === 'urgente' ? 'font-semibold text-red-700' : 'text-gray-600'}>{s.estado === 'al_dia' ? 'Al día' : s.estado === 'proximo' ? 'Próximo' : s.estado === 'urgente' ? 'Urgente' : s.estado === 'vencido' ? 'Vencido' : '—'}{s.restante !== null && s.estado !== 'al_dia' && s.estado !== 'sin_contador' ? ` (${s.restante >= 0 ? `faltan ${s.restante}` : `pasado por ${Math.abs(s.restante)}`} ${s.unidad})` : ''}</span></li>)}</ul>
        </Tarjeta>
      )}
      <Tarjeta>
        <h3 className="text-sm font-bold text-gray-900">Trabajos</h3>
        {f.ordenes.length === 0 && <p className="text-sm text-gray-500">Todavía no tiene trabajos.</p>}
        <ul className="space-y-3">
          {f.ordenes.map((o) => (
            <li key={o.numero} className="rounded-md border border-gray-200 p-3 text-sm">
              <p className="font-semibold text-gray-900">{o.tipo} · {o.cancelada ? 'Cancelada' : o.estado}</p>
              {o.descripcion && <p className="text-gray-700">{o.descripcion}</p>}
              <p className="text-xs text-gray-500">{o.abierta ? (o.entrega_estimada ? `Entrega estimada: ${formatFecha(o.entrega_estimada.slice(0, 10))}` : 'En el taller') : o.cerrada_en ? `Terminada el ${formatFecha(o.cerrada_en.slice(0, 10))}` : ''}</p>
              <Avance valor={o.avance} />
              {o.trabajos.length > 0 && <ul className="mt-2 space-y-0.5 text-gray-700">{o.trabajos.map((t, i) => <li key={i}>{o.abierta ? (t.terminado ? '✔ ' : '○ ') : '• '}{t.descripcion}{t.tipo === 'material' ? ` (${t.cantidad} u.)` : ''}</li>)}</ul>}
            </li>
          ))}
        </ul>
      </Tarjeta>
      {f.documentos.length > 0 && (
        <Tarjeta>
          <h3 className="text-sm font-bold text-gray-900">Cuentas e informes</h3>
          <ul className="divide-y divide-gray-100 text-sm">{f.documentos.map((d) => <li key={`${d.folio}-${d.version}`} className="flex items-center justify-between gap-3 py-2"><span>{d.tipo === 'cuenta' ? 'Cuenta' : 'Informe'} {d.folio}{d.version > 1 ? ` (v${d.version})` : ''}<span className="block text-xs text-gray-500">{formatFechaHora(aHoraDeGuatemala(d.emitido_en))}</span></span><a href={d.url} target="_blank" rel="noreferrer" className="text-primary underline">Ver PDF</a></li>)}</ul>
        </Tarjeta>
      )}
    </>
  );
}

function PedirCita({ api, r, alListo }: { api: ReturnType<typeof crearApiTaller>; r: Resumen; alListo: () => void }) {
  const [equipo, setEquipo] = useState(r.equipos[0] ? String(r.equipos[0].id) : '');
  const [fecha, setFecha] = useState('');
  const [hora, setHora] = useState('08:00');
  const [lectura, setLectura] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const x = await api.post<{ mensaje: string }>('/portal/citas', { equipo_id: Number(equipo), fecha, hora, lectura_contador: lectura.trim() === '' ? null : Number(lectura), notas: notas.trim() || null });
      setMensaje(x.mensaje);
      setTimeout(alListo, 2500);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo pedir la cita'));
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Tarjeta>
      <h2 className="text-lg font-bold text-gray-900">Pedir una cita</h2>
      <p className="text-sm text-gray-600">Elija el día y la hora que le convienen. La recepción la confirmará con usted.</p>
      <form onSubmit={(e) => void enviar(e)} className="space-y-3">
        <Campo etiqueta="Equipo"><select className={CLASE_INPUT} value={equipo} onChange={(e) => setEquipo(e.target.value)} required>{r.equipos.map((x) => <option key={x.id} value={x.id}>{x.etiqueta}</option>)}</select></Campo>
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Día"><FechaInput value={fecha} onChange={(e) => setFecha(e.target.value)} className={CLASE_INPUT} required /></Campo>
          <Campo etiqueta="Hora (24 horas)"><input className={CLASE_INPUT} value={hora} onChange={(e) => setHora(e.target.value)} placeholder="08:30" maxLength={5} required data-no-uppercase="true" /></Campo>
        </div>
        <Campo etiqueta="Kilómetros u horas actuales del equipo (opcional)"><input className={CLASE_INPUT} type="number" min={0} value={lectura} onChange={(e) => setLectura(e.target.value)} /></Campo>
        <Campo etiqueta="¿Qué necesita? (opcional)"><textarea className={CLASE_INPUT} rows={3} maxLength={300} value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
        <Aviso mensaje={error} tipo="error" />
        <Aviso mensaje={mensaje} tipo="ok" />
        <Button type="submit" className="w-full" disabled={enviando || !!mensaje || !fecha || r.equipos.length === 0}>{enviando ? 'Enviando…' : 'Pedir la cita'}</Button>
      </form>
    </Tarjeta>
  );
}

// ── La pantalla ───────────────────────────────────────────────────────────────────────
export default function Portal() {
  const { slug } = useUbicacion();
  const [token, setToken] = useState<string | null>(() => leer(slug));
  const api = useMemo(() => crearApiTaller(slug, { token }), [slug, token]);
  const [resumen, setResumen] = useState<Resumen | null>(null);
  const [error, setError] = useState('');
  const [vista, setVista] = useState<Vista>({ k: 'inicio' });
  const [version, setVersion] = useState(0);

  const cerrar = useCallback((): void => {
    guardar(slug, null);
    setToken(null);
    setResumen(null);
    setVista({ k: 'inicio' });
  }, [slug]);

  useEffect(() => {
    if (!token) return;
    api
      .get<Resumen>('/portal/resumen')
      .then((r) => {
        setResumen(r);
        setError('');
      })
      .catch((e: unknown) => {
        if (e instanceof ErrorApi && e.codigo === 'PORTAL_SIN_SESION') cerrar();
        else setError(mensajeDe(e, 'No se pudo cargar su información'));
      });
  }, [api, token, version, cerrar]);

  const salir = async (): Promise<void> => {
    try {
      await api.post('/portal/cerrar', {});
    } catch {
      // Si ya no servía, da igual.
    }
    cerrar();
  };
  // La función de carga debe ser siempre la misma mientras se mire la misma cotización (si no, la pantalla volvería a pedirla sin parar).
  const idCotizacion = vista.k === 'cotizacion' ? vista.id : null;
  const cargarCotizacion = useMemo(
    () =>
      idCotizacion === null
        ? null
        : async () => {
            const d = await api.get<Publica & { puede_responder: boolean }>(`/portal/cotizaciones/${idCotizacion}`);
            return { ...d, se_puede_responder: !!d.se_puede_responder && d.puede_responder };
          },
    [api, idCotizacion]
  );

  const volver = (
    <button type="button" onClick={() => { setVista({ k: 'inicio' }); setVersion((v) => v + 1); }} className="text-sm text-primary underline">← Volver</button>
  );

  return (
    <div className="min-h-screen bg-gray-100 px-4 py-6">
      <main className="mx-auto max-w-2xl space-y-4">
        {!token ? (
          <Entrar slug={slug} alEntrar={(t) => { guardar(slug, t); setToken(t); }} />
        ) : (
          <>
            <header className="flex items-start justify-between gap-3 rounded-lg bg-white p-4 shadow">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{resumen?.taller ?? ''}</p>
                <p className="text-sm font-medium text-gray-900">{resumen ? resumen.personas.map((p) => p.nombre).join(', ') : 'Cargando…'}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => void salir()}>Salir</Button>
            </header>
            <Aviso mensaje={error} tipo="error" />
            {resumen && vista.k === 'inicio' && <Inicio r={resumen} ir={setVista} />}
            {resumen && vista.k === 'equipo' && <>{volver}<Equipo api={api} id={vista.id} /></>}
            {resumen && vista.k === 'cita' && <>{volver}<PedirCita api={api} r={resumen} alListo={() => { setVista({ k: 'inicio' }); setVersion((v) => v + 1); }} /></>}
            {resumen && vista.k === 'cotizacion' && cargarCotizacion && (
              <VistaCotizacion
                key={vista.id}
                cargar={cargarCotizacion}
                enviar={(c) => api.post<Publica>(`/portal/cotizaciones/${vista.id}/responder`, { respuestas: c.respuestas })}
                pedirNombre={false}
                volver={volver}
              />
            )}
          </>
        )}
      </main>
    </div>
  );
}
