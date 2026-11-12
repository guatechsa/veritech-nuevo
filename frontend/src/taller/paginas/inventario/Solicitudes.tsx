import { FormEvent, useEffect, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { fechaHoraLocal } from '../../../utils/hora';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { DetalleSolicitud, ESTADO_SOLICITUD, FilaMaterial, FilaSolicitud, LineaSolicitud, MaterialSugerido } from './tipos';

const ESTADOS_ABIERTOS = ['no_despachada', 'despachada_parcial'];

/** Tiempo que lleva esperando: «3 h 10 min», «2 días». */
function esperando(desde: string): string {
  const minutos = Math.max(0, Math.floor((Date.now() - new Date(desde).getTime()) / 60000));
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `${horas} h ${minutos % 60} min`;
  const dias = Math.floor(horas / 24);
  return `${dias} ${dias === 1 ? 'día' : 'días'}`;
}

// ── Pedir materiales para una orden ───────────────────────────────────────────────────
interface Pedido { material_id: number; codigo: string; nombre: string; unidad: string; existencia: number; cantidad: string }

export function PedirMateriales({ ordenId, ordenNumero, alCerrar, alListo }: { ordenId: number; ordenNumero: string; alCerrar: () => void; alListo: (solicitudId: number) => void }) {
  const { api } = useSesionTaller();
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<FilaMaterial[]>([]);
  const [lineas, setLineas] = useState<Pedido[]>([]);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const sugeridos = useLista(() => api.get<MaterialSugerido[]>(`/ordenes/${ordenId}/materiales-sugeridos`), [api, ordenId]);
  useEffect(() => {
    if (texto.trim().length < 2) return setResultados([]);
    const espera = setTimeout(() => api.get<{ registros: FilaMaterial[] }>(`/materiales?buscar=${encodeURIComponent(texto.trim())}`).then((r) => setResultados(r.registros.slice(0, 8))).catch(() => setResultados([])), 250);
    return () => clearTimeout(espera);
  }, [api, texto]);
  const agregar = (m: FilaMaterial): void => {
    setLineas((ls) => (ls.some((l) => l.material_id === m.id) ? ls : [...ls, { material_id: m.id, codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, existencia: m.existencia_total, cantidad: '1' }]));
    setTexto('');
    setResultados([]);
  };
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      const s = await api.post<DetalleSolicitud>('/solicitudes', { orden_id: ordenId, notas: notas.trim() || null, lineas: lineas.map((l) => ({ material_id: l.material_id, cantidad: Number(l.cantidad) })) });
      alListo(s.id);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo enviar la solicitud'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={`Pedir materiales para la orden ${ordenNumero}`} size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">Bodega recibe el pedido y lo despacha; lo despachado se carga solo a la orden.</p>
        {(sugeridos.datos ?? []).length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-600">Para este tipo de equipo se suelen pedir:</p>
            <div className="flex flex-wrap gap-2">
              {(sugeridos.datos ?? []).map((s) => <button key={s.id} type="button" disabled={lineas.some((l) => l.material_id === s.id)} className="rounded-full border border-gray-300 bg-white px-3 py-1 text-xs hover:bg-gray-100 disabled:opacity-50" onClick={() => setLineas((ls) => [...ls, { material_id: s.id, codigo: s.codigo, nombre: s.nombre, unidad: s.unidad, existencia: s.existencia_total, cantidad: '1' }])}>{s.nombre} <span className="text-gray-500">· hay {s.existencia_total}</span></button>)}
            </div>
          </div>
        )}
        <Campo etiqueta="Buscar material">
          <div className="relative">
            <input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Código, nombre, marca o código del fabricante" data-no-uppercase="true" autoComplete="off" autoFocus />
            {resultados.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">{resultados.map((m) => <li key={m.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => agregar(m)}>{m.nombre} <span className="text-xs text-gray-500">{m.codigo} · hay {m.existencia_total} {m.unidad}</span></button></li>)}</ul>}
          </div>
        </Campo>
        {lineas.length === 0 ? <p className="text-sm text-gray-500">Agregue al menos un material.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-1">Material</th><th className="py-1">Hay en total</th><th className="w-28 py-1">Cantidad</th><th className="w-10" /></tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.material_id} className="border-b">
                  <td className="py-1">{l.nombre} <span className="text-xs text-gray-500">{l.codigo}</span></td>
                  <td className="py-1">{l.existencia} {l.unidad}</td>
                  <td className="py-1"><input className={CLASE_INPUT} type="number" min={1} step={1} value={l.cantidad} onChange={(e) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, cantidad: e.target.value } : x)))} required aria-label={`Cantidad de ${l.nombre}`} /></td>
                  <td className="py-1 text-right"><button type="button" className="text-xs font-semibold text-red-700 hover:underline" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>Quitar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Campo etiqueta="Nota para la bodega (opcional)"><input className={CLASE_INPUT} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" disabled={lineas.length === 0}>Enviar solicitud</Button></div>
      </form>
    </Modal>
  );
}

// ── Devolver ──────────────────────────────────────────────────────────────────────────
function Devolver({ linea, alCerrar, alListo }: { linea: LineaSolicitud; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [bodega, setBodega] = useState(linea.por_bodega.length === 1 ? String(linea.por_bodega[0]?.bodega_id) : '');
  const [cantidad, setCantidad] = useState('1');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post('/solicitudes/devoluciones', { solicitud_linea_id: linea.id, bodega_id: Number(bodega), cantidad: Number(cantidad), motivo });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo registrar la devolución'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Devolver material a la bodega" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">{linea.codigo} · {linea.nombre}. En la orden hay <strong>{linea.en_la_orden} {linea.unidad}</strong>. Al devolverlo baja el cobro de la orden.</p>
        <Campo etiqueta="Bodega que lo recibe"><select className={CLASE_INPUT} value={bodega} onChange={(e) => setBodega(e.target.value)} required><option value="">Elija…</option>{linea.por_bodega.map((b) => <option key={b.bodega_id} value={b.bodega_id}>{b.bodega}</option>)}</select></Campo>
        <Campo etiqueta="Cantidad"><input className={CLASE_INPUT} type="number" min={1} max={linea.en_la_orden} step={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} required /></Campo>
        <Campo etiqueta="Motivo"><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={200} required /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Devolver</Button></div>
      </form>
    </Modal>
  );
}

// ── La solicitud ──────────────────────────────────────────────────────────────────────
export function FichaSolicitud({ id, alCerrar, alCambiar }: { id: number; alCerrar: () => void; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const [s, setS] = useState<DetalleSolicitud | null>(null);
  const [error, setError] = useState('');
  const [aDespachar, setADespachar] = useState<Record<number, { bodega: string; cantidad: string }>>({});
  const [devolviendo, setDevolviendo] = useState<LineaSolicitud | null>(null);
  const [anulando, setAnulando] = useState(false);
  const [motivo, setMotivo] = useState('');
  const cargar = (): void => {
    api.get<DetalleSolicitud>(`/solicitudes/${id}`).then((d) => {
      setS(d);
      setError('');
      // Propone sacar lo que falta de la bodega que más tiene.
      setADespachar(Object.fromEntries(d.lineas.map((l) => {
        const mejor = [...l.por_bodega].sort((a, b) => b.cantidad - a.cantidad)[0];
        return [l.id, { bodega: mejor ? String(mejor.bodega_id) : '', cantidad: String(Math.max(0, Math.min(l.pendiente, mejor?.cantidad ?? 0))) }];
      })));
    }).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar la solicitud')));
  };
  useEffect(cargar, [api, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refrescar = (): void => {
    setDevolviendo(null);
    setAnulando(false);
    cargar();
    alCambiar();
  };
  const abierta = s !== null && ESTADOS_ABIERTOS.includes(s.estado);
  const puedeDespachar = tiene('solicitudes.despachar') && abierta && !s?.orden_cerrada;
  const despachar = async (): Promise<void> => {
    if (!s) return;
    setError('');
    const items = s.lineas.map((l) => ({ linea_id: l.id, bodega_id: Number(aDespachar[l.id]?.bodega), cantidad: Number(aDespachar[l.id]?.cantidad) })).filter((i) => i.cantidad > 0);
    if (items.length === 0) return setError('Escriba la cantidad que va a despachar en al menos un material.');
    if (items.some((i) => !i.bodega_id)) return setError('Elija la bodega de la que sale cada material.');
    try {
      await api.post(`/solicitudes/${id}/despachar`, { items });
      refrescar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo despachar'));
    }
  };
  const anular = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post(`/solicitudes/${id}/anular`, { motivo });
      refrescar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo anular'));
      setAnulando(false);
    }
  };
  const columnas: Array<Columna<LineaSolicitud>> = [
    { clave: 'material', etiqueta: 'Material', valor: (l) => l.nombre, render: (l) => <span><span className="block font-medium text-gray-900">{l.nombre}</span><span className="block text-xs text-gray-500">{l.codigo}</span></span> },
    { clave: 'pedido', etiqueta: 'Pedido', valor: (l) => l.cantidad_solicitada, render: (l) => `${l.cantidad_solicitada} ${l.unidad}`, alinear: 'right' },
    { clave: 'despachado', etiqueta: 'Despachado', valor: (l) => l.cantidad_despachada, render: (l) => <span>{l.cantidad_despachada}{l.cantidad_devuelta > 0 ? <span className="block text-xs text-gray-500">{l.cantidad_devuelta} devueltos</span> : null}</span>, alinear: 'right' },
    { clave: 'pendiente', etiqueta: 'Falta', valor: (l) => l.pendiente, render: (l) => (s?.estado === 'anulada' ? '—' : <span className={l.pendiente > 0 ? 'font-semibold text-red-700' : ''}>{l.pendiente}</span>), alinear: 'right' },
    ...(puedeDespachar ? [{
      clave: 'despachar',
      etiqueta: 'Despachar ahora',
      render: (l: LineaSolicitud) => (l.pendiente > 0 ? (
        <span className="flex items-center gap-1">
          <select className="max-w-[11rem] rounded-md border border-gray-300 px-2 py-1 text-xs" aria-label={`Bodega de ${l.nombre}`} value={aDespachar[l.id]?.bodega ?? ''} onChange={(e) => setADespachar((a) => ({ ...a, [l.id]: { bodega: e.target.value, cantidad: a[l.id]?.cantidad ?? '0' } }))}>
            <option value="">Bodega…</option>
            {l.por_bodega.map((b) => <option key={b.bodega_id} value={b.bodega_id}>{b.bodega} ({b.cantidad})</option>)}
          </select>
          <input className="w-16 rounded-md border border-gray-300 px-2 py-1 text-xs" type="number" min={0} max={l.pendiente} step={1} aria-label={`Cantidad a despachar de ${l.nombre}`} value={aDespachar[l.id]?.cantidad ?? ''} onChange={(e) => setADespachar((a) => ({ ...a, [l.id]: { bodega: a[l.id]?.bodega ?? '', cantidad: e.target.value } }))} />
        </span>
      ) : '—'),
    }] : []),
    { clave: 'acc', etiqueta: 'Acciones', render: (l) => <Acciones>{tiene('solicitudes.despachar') && !s?.orden_cerrada && l.en_la_orden > 0 && <BotonAccion onClick={() => setDevolviendo(l)}>Devolver</BotonAccion>}</Acciones> },
  ];
  return (
    <Modal onClose={alCerrar} title={s ? `Solicitud ${s.numero}` : 'Solicitud de material'} size="2xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        {!s ? <p className="text-sm text-gray-500">Cargando…</p> : (
          <>
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2"><Badge variant={ESTADO_SOLICITUD[s.estado].variante}>{ESTADO_SOLICITUD[s.estado].texto}</Badge><span className="font-medium text-gray-900">Orden {s.orden}</span><span className="text-gray-600">{s.cliente ?? 'Equipo del taller'} · {s.sucursal}</span></p>
              <p className="text-gray-600">Pedida {fechaHoraLocal(s.solicitada_en)}{s.solicitante ? ` por ${s.solicitante}` : ''}{abierta ? ` · espera hace ${esperando(s.solicitada_en)}` : ''}</p>
              {s.primer_despacho_en && <p className="text-gray-600">Primer despacho: {fechaHoraLocal(s.primer_despacho_en)}{s.despachada_en ? ` · completa: ${fechaHoraLocal(s.despachada_en)}` : ''}</p>}
              {s.notas && <p className="text-gray-800">Nota: {s.notas}</p>}
              {s.estado === 'anulada' && <p className="text-red-700">Anulada: {s.motivo_anulacion}</p>}
              {s.orden_cerrada && <p className="text-amber-800">La orden está cerrada o anulada: ya no se despacha ni se devuelve.</p>}
              {puedeDespachar && <p className="text-xs text-gray-500">El material se despacha solo desde las bodegas de la sucursal de la orden.</p>}
            </div>
            <Tabla columnas={columnas} filas={s.lineas} clave={(l) => l.id} vacio="Sin materiales." />
            <div className="flex flex-wrap justify-end gap-2">
              {abierta && (tiene('solicitudes.crear') || tiene('solicitudes.anular')) && <Button variant="outline" onClick={() => { setMotivo(''); setAnulando(true); }}>Anular solicitud</Button>}
              {puedeDespachar && <Button onClick={() => void despachar()}>Despachar</Button>}
            </div>
            {(s.despachos.length > 0 || s.devoluciones.length > 0) && (
              <section className="space-y-1 text-sm">
                <h3 className="font-bold text-gray-900">Historial</h3>
                <ul className="space-y-1 text-gray-700">
                  {s.despachos.map((d) => <li key={`d${d.id}`}>{fechaHoraLocal(d.fecha)} · Despachó {d.cantidad} de {s.lineas.find((l) => l.id === d.solicitud_linea_id)?.nombre} desde {d.bodega}{d.despachado_por ? ` (${d.despachado_por})` : ''}</li>)}
                  {s.devoluciones.map((d) => <li key={`v${d.id}`}>{fechaHoraLocal(d.fecha)} · {d.numero}: devolvió {d.cantidad} de {s.lineas.find((l) => l.id === d.solicitud_linea_id)?.nombre} a {d.bodega}, motivo {d.motivo}{d.registrada_por ? ` (${d.registrada_por})` : ''}</li>)}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
      {devolviendo && <Devolver linea={devolviendo} alCerrar={() => setDevolviendo(null)} alListo={refrescar} />}
      {anulando && s && (
        <Modal onClose={() => setAnulando(false)} title={`Anular la solicitud ${s.numero}`} size="md">
          <form onSubmit={anular} className="space-y-3">
            <p className="text-sm text-gray-700">{s.estado === 'despachada_parcial' ? 'Se anula lo que falta por despachar; lo ya despachado sigue en la orden y se puede devolver.' : 'No se despachará nada de esta solicitud.'}</p>
            <Campo etiqueta="Motivo"><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={300} required autoFocus /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setAnulando(false)}>Volver</Button><Button type="submit" variant="danger">Anular solicitud</Button></div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}

// ── Las solicitudes de una orden (se ve dentro de la ficha de la orden) ───────────────
export function SolicitudesOrden({ ordenId, ordenNumero, cerrada, alCambiar }: { ordenId: number; ordenNumero: string; cerrada: boolean; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<{ registros: FilaSolicitud[] }>(`/solicitudes?orden_id=${ordenId}`), [api, ordenId]);
  const [pidiendo, setPidiendo] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const cambio = (): void => {
    lista.recargar();
    alCambiar();
  };
  const registros = lista.datos?.registros ?? [];
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Materiales</h3>
        {tiene('solicitudes.crear') && !cerrada && <Button size="sm" onClick={() => setPidiendo(true)}>Pedir materiales</Button>}
      </div>
      <Aviso mensaje={lista.error} tipo="error" />
      {registros.length === 0 ? <p className="text-sm text-gray-500">Todavía no se pidió material para esta orden. Lo que bodega despache aparece en la lista de trabajos.</p> : (
        <ul className="divide-y rounded-md border border-gray-200 text-sm">
          {registros.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex flex-wrap items-center gap-2"><strong>{r.numero}</strong><Badge variant={ESTADO_SOLICITUD[r.estado].variante}>{ESTADO_SOLICITUD[r.estado].texto}</Badge><span className="text-xs text-gray-500">{r.lineas} {r.lineas === 1 ? 'material' : 'materiales'} · {fechaHoraLocal(r.solicitada_en)}{r.solicitante ? ` · ${r.solicitante}` : ''}</span></span>
              <Button size="sm" variant="outline" onClick={() => setAbierta(r.id)}>Ver</Button>
            </li>
          ))}
        </ul>
      )}
      {pidiendo && <PedirMateriales ordenId={ordenId} ordenNumero={ordenNumero} alCerrar={() => setPidiendo(false)} alListo={(sid) => { setPidiendo(false); cambio(); setAbierta(sid); }} />}
      {abierta && <FichaSolicitud id={abierta} alCerrar={() => setAbierta(null)} alCambiar={cambio} />}
    </section>
  );
}

// ── La bandeja de bodega (pestaña de Inventario) ──────────────────────────────────────
export function Bandeja() {
  const { api } = useSesionTaller();
  const [vista, setVista] = useState<'pendientes' | 'todas' | 'despachada' | 'anulada'>('pendientes');
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const [abierta, setAbierta] = useState<number | null>(null);
  const q = new URLSearchParams({ pagina: String(pagina), ...(buscar.trim() ? { buscar: buscar.trim() } : {}), ...(vista === 'pendientes' ? { pendientes: 'true' } : vista === 'despachada' || vista === 'anulada' ? { estado: vista } : {}) });
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: FilaSolicitud[] }>(`/solicitudes?${q.toString()}`), [api, pagina, buscar, vista]);
  useEffect(() => setPagina(1), [buscar, vista]);
  const columnas: Array<Columna<FilaSolicitud>> = [
    { clave: 'numero', etiqueta: 'Solicitud', valor: (r) => r.numero },
    { clave: 'orden', etiqueta: 'Orden', valor: (r) => r.orden, render: (r) => <span>{r.orden}<span className="block text-xs text-gray-500">{r.cliente ?? 'Del taller'}</span></span> },
    { clave: 'estado', etiqueta: 'Estado', valor: (r) => r.estado, render: (r) => <Badge variant={ESTADO_SOLICITUD[r.estado].variante}>{ESTADO_SOLICITUD[r.estado].texto}</Badge> },
    { clave: 'pedida', etiqueta: 'Pedida', valor: (r) => r.solicitada_en, render: (r) => <span>{fechaHoraLocal(r.solicitada_en)}{ESTADOS_ABIERTOS.includes(r.estado) ? <span className="block text-xs font-medium text-red-700">espera {esperando(r.solicitada_en)}</span> : null}</span> },
    { clave: 'solicitante', etiqueta: 'Pidió', valor: (r) => r.solicitante ?? '', render: (r) => r.solicitante ?? '—' },
    { clave: 'lineas', etiqueta: 'Materiales', valor: (r) => r.lineas, render: (r) => <span>{r.lineas}{r.unidades_pendientes > 0 && ESTADOS_ABIERTOS.includes(r.estado) ? <span className="block text-xs text-gray-500">{r.unidades_pendientes} u. por despachar</span> : null}</span>, alinear: 'right' },
    { clave: 'acc', etiqueta: 'Acciones', render: (r) => <Acciones><BotonAccion onClick={() => setAbierta(r.id)}>Abrir</BotonAccion></Acciones> },
  ];
  const paginas = lista.datos ? Math.max(1, Math.ceil(lista.datos.total / lista.datos.porPagina)) : 1;
  return (
    <Seccion titulo="Solicitudes de material">
      <p className="text-sm text-gray-700">Lo que el taller pide para sus órdenes. Bodega despacha y lo despachado se carga a la orden. Las más viejas sin despachar salen primero.</p>
      <div className="flex flex-wrap gap-3">
        <select value={vista} onChange={(e) => setVista(e.target.value as typeof vista)} aria-label="Cuáles solicitudes" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="pendientes">Por despachar</option><option value="despachada">Despachadas</option><option value="anulada">Anuladas</option><option value="todas">Todas</option>
        </select>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por solicitud, orden o cliente" aria-label="Buscar solicitud" className="min-w-64 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <Aviso mensaje={lista.error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(r) => r.id} vacio={lista.datos ? 'No hay solicitudes en esta lista.' : 'Cargando…'} />
      {lista.datos && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{lista.datos.total} solicitudes · página {pagina} de {paginas}</span>
          <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button></span>
        </div>
      )}
      {abierta && <FichaSolicitud id={abierta} alCerrar={() => setAbierta(null)} alCambiar={lista.recargar} />}
    </Seccion>
  );
}
