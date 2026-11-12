import { FormEvent, useEffect, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { formatFecha } from '../../../components/ui-guatech/formatoFecha.js';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { fechaHoraLocal } from '../../../utils/hora';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { FotosLinea } from './FotosLinea';
import { DetalleOrden, dineroDe, ESTADO_LINEA, EstadoLinea, formatoHoras, LineaOrden, OpcionesOrden, PRIORIDAD, soloDia } from './tipos';

const COLOR_POR_DEFECTO = '#6B7280';

function EstadoOrden({ nombre, color }: { nombre: string; color: string }) {
  return <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: color || COLOR_POR_DEFECTO }}>{nombre}</span>;
}

// ── Agregar un trabajo del catálogo ───────────────────────────────────────────────────
interface TrabajoFila {
  id: number;
  codigo: string;
  nombre: string;
  variante: string | null;
  sistema: string;
  parte: string;
}

function AgregarServicio({ orden, opciones, alCerrar, alListo }: { orden: DetalleOrden; opciones: OpcionesOrden; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<TrabajoFila[]>([]);
  const [trabajo, setTrabajo] = useState<TrabajoFila | null>(null);
  const [horas, setHoras] = useState('');
  const [tecnico, setTecnico] = useState('');
  const [area, setArea] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (texto.trim().length < 2) {
      setResultados([]);
      return;
    }
    const espera = setTimeout(() => {
      api.get<{ registros: TrabajoFila[] }>(`/catalogos/trabajos?buscar=${encodeURIComponent(texto.trim())}`).then((r) => setResultados(r.registros.slice(0, 10))).catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(espera);
  }, [api, texto]);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!trabajo) return setError('Elija el trabajo del catálogo.');
    setError('');
    try {
      await api.post(`/ordenes/${orden.id}/lineas`, {
        tipo: 'servicio',
        trabajo_id: trabajo.id,
        ...(horas.trim() ? { horas_trabajo: Number(horas) } : {}),
        tecnico_id: tecnico ? Number(tecnico) : null,
        area_trabajo_id: area ? Number(area) : null,
        notas: notas.trim() || null,
      });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo agregar el trabajo'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Agregar un trabajo" size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <Campo etiqueta="Trabajo del catálogo" ayuda={`El precio sale de las horas del trabajo para un equipo de tipo ${orden.tipo_equipo}, por la tarifa por hora.`}>
          {trabajo ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm">
              <span><span className="font-medium">{trabajo.nombre}</span>{trabajo.variante ? ` · ${trabajo.variante}` : ''}<span className="block text-xs text-gray-500">{trabajo.codigo} · {trabajo.sistema}</span></span>
              <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setTrabajo(null)}>Cambiar</button>
            </div>
          ) : (
            <div className="relative">
              <input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escriba el nombre o el código del trabajo" data-no-uppercase="true" autoComplete="off" autoFocus />
              {resultados.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                  {resultados.map((t) => (
                    <li key={t.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => { setTrabajo(t); setResultados([]); setTexto(''); }}><span className="font-medium">{t.nombre}</span>{t.variante ? ` · ${t.variante}` : ''} <span className="text-xs text-gray-500">{t.codigo}</span></button></li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Campo>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Horas (solo si no las define el catálogo)"><input className={CLASE_INPUT} type="number" min={0} step="0.25" value={horas} onChange={(e) => setHoras(e.target.value)} /></Campo>
          <Campo etiqueta="Técnico">
            <select className={CLASE_INPUT} value={tecnico} onChange={(e) => setTecnico(e.target.value)}><option value="">Sin asignar</option>{opciones.responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select>
          </Campo>
          <Campo etiqueta="Área de trabajo">
            <select className={CLASE_INPUT} value={area} onChange={(e) => setArea(e.target.value)}><option value="">La del trabajo o de la orden</option>{opciones.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select>
          </Campo>
        </div>
        <Campo etiqueta="Notas"><input className={CLASE_INPUT} maxLength={500} value={notas} onChange={(e) => setNotas(e.target.value)} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Agregar</Button></div>
      </form>
    </Modal>
  );
}

// ── Trabajo con terceros ──────────────────────────────────────────────────────────────
function AgregarTercero({ orden, alCerrar, alListo }: { orden: DetalleOrden; alCerrar: () => void; alListo: () => void }) {
  const { api, tiene } = useSesionTaller();
  const proveedores = useLista(() => api.get<{ registros: Array<{ id: number; nombre: string }> }>('/proveedores?activo=true'), [api]);
  const [proveedor, setProveedor] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [precio, setPrecio] = useState('');
  const [costo, setCosto] = useState('');
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/ordenes/${orden.id}/lineas`, {
        tipo: 'tercero',
        proveedor_id: Number(proveedor),
        descripcion,
        cantidad: Number(cantidad),
        precio_unitario: Number(precio || 0),
        ...(tiene('ordenes.ver_costos') && costo.trim() ? { costo: Number(costo) } : {}),
      });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo agregar el trabajo'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Agregar trabajo con terceros" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error || proveedores.error} tipo="error" />
        <Campo etiqueta="Proveedor que lo hace">
          <select className={CLASE_INPUT} value={proveedor} onChange={(e) => setProveedor(e.target.value)} required><option value="">Elija…</option>{(proveedores.datos?.registros ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select>
        </Campo>
        <Campo etiqueta="Qué trabajo es"><input className={CLASE_INPUT} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={250} required /></Campo>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Cantidad"><input className={CLASE_INPUT} type="number" min={0} step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required /></Campo>
          <Campo etiqueta="Precio al cliente (c/u)"><input className={CLASE_INPUT} type="number" min={0} step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} required /></Campo>
          {tiene('ordenes.ver_costos') && <Campo etiqueta="Costo para el taller"><input className={CLASE_INPUT} type="number" min={0} step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} /></Campo>}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Agregar</Button></div>
      </form>
    </Modal>
  );
}

// ── Anular una línea o la orden, y reabrir ────────────────────────────────────────────
function PedirMotivo({ titulo, explicacion, etiqueta, boton, peligro, alCerrar, alConfirmar }: { titulo: string; explicacion: string; etiqueta: string; boton: string; peligro?: boolean; alCerrar: () => void; alConfirmar: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await alConfirmar(motivo.trim());
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo completar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={titulo} size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">{explicacion}</p>
        <Campo etiqueta={etiqueta}><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={300} required autoFocus /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Volver</Button><Button type="submit" variant={peligro ? 'danger' : 'primary'}>{boton}</Button></div>
      </form>
    </Modal>
  );
}

function AnularOrden({ orden, opciones, alCerrar, alListo }: { orden: DetalleOrden; opciones: OpcionesOrden; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [motivo, setMotivo] = useState('');
  const [texto, setTexto] = useState('');
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post(`/ordenes/${orden.id}/anular`, { motivo_id: Number(motivo), texto: texto.trim() || null });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo anular la orden'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={`Anular la orden ${orden.numero}`} size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">La orden no se borra: queda anulada con su motivo y su historia. Los trabajos sin terminar se anulan con ella; los ya terminados se conservan. Una orden anulada no se puede reabrir.</p>
        <Campo etiqueta="Motivo"><select className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} required><option value="">Elija…</option>{opciones.motivos_anulacion.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Detalle (opcional)"><input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} maxLength={300} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Volver</Button><Button type="submit" variant="danger">Anular orden</Button></div>
      </form>
    </Modal>
  );
}

function EditarDatos({ orden, opciones, alCerrar, alListo }: { orden: DetalleOrden; opciones: OpcionesOrden; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [prioridad, setPrioridad] = useState(orden.prioridad);
  const [responsable, setResponsable] = useState(orden.responsable_id ? String(orden.responsable_id) : '');
  const [area, setArea] = useState(orden.area_trabajo_id ? String(orden.area_trabajo_id) : '');
  const [entrega, setEntrega] = useState(soloDia(orden.fecha_estimada_entrega));
  const [descripcion, setDescripcion] = useState(orden.descripcion ?? '');
  const [factura, setFactura] = useState(orden.referencia_factura_externa ?? '');
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.patch(`/ordenes/${orden.id}`, {
        prioridad,
        responsable_id: responsable ? Number(responsable) : null,
        area_trabajo_id: area ? Number(area) : null,
        fecha_estimada_entrega: entrega || null,
        descripcion: descripcion.trim() || null,
        referencia_factura_externa: factura.trim() || null,
      });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={`Datos de la orden ${orden.numero}`} size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Prioridad"><select className={CLASE_INPUT} value={prioridad} onChange={(e) => setPrioridad(e.target.value)}><option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="urgente">Urgente</option></select></Campo>
          <Campo etiqueta="Responsable"><select className={CLASE_INPUT} value={responsable} onChange={(e) => setResponsable(e.target.value)}><option value="">Sin asignar</option>{opciones.responsables.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Área principal"><select className={CLASE_INPUT} value={area} onChange={(e) => setArea(e.target.value)}><option value="">Ninguna</option>{opciones.areas.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Entrega estimada"><FechaInput value={entrega} onChange={(e) => setEntrega(e.target.value)} className={CLASE_INPUT} /></Campo>
        </div>
        <Campo etiqueta="Descripción"><textarea className={CLASE_INPUT} rows={3} maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Campo>
        <Campo etiqueta="Factura en el sistema de caja del taller" ayuda="Solo una referencia: este sistema no emite facturas."><input className={CLASE_INPUT} maxLength={40} value={factura} onChange={(e) => setFactura(e.target.value)} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

// ── La ficha ──────────────────────────────────────────────────────────────────────────
type Ventana = 'servicio' | 'tercero' | 'anular' | 'editar' | 'reabrir' | { anularLinea: LineaOrden } | { fotosLinea: number } | null;

export function FichaOrden({ id, alCerrar, alCambiar }: { id: number; alCerrar: () => void; alCambiar: () => void }) {
  const { api, tiene, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const opciones = useLista(() => api.get<OpcionesOrden>('/ordenes-opciones'), [api]);
  const [orden, setOrden] = useState<DetalleOrden | null>(null);
  const [error, setError] = useState('');
  const [ventana, setVentana] = useState<Ventana>(null);
  const [nuevoEstado, setNuevoEstado] = useState('');

  const cargar = (): void => {
    api.get<DetalleOrden>(`/ordenes/${id}`).then((o) => { setOrden(o); setError(''); }).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar la orden')));
  };
  useEffect(cargar, [api, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refrescar = (): void => {
    setVentana(null);
    setNuevoEstado('');
    cargar();
    alCambiar();
  };
  const accion = async (f: () => Promise<unknown>, falla: string): Promise<void> => {
    setError('');
    try {
      await f();
      refrescar();
    } catch (e) {
      setError(mensajeDe(e, falla));
    }
  };

  const puedeEditar = tiene('ordenes.editar') && orden !== null && orden.es_terminal !== 1;
  const verPrecios = orden?.total !== undefined;
  const verCostos = tiene('ordenes.ver_costos');
  const estados = opciones.datos?.estados ?? [];

  const columnas: Array<Columna<LineaOrden>> = [
    {
      clave: 'trabajo',
      etiqueta: 'Trabajo',
      valor: (l) => l.descripcion,
      render: (l) => (
        <span className={l.anulada_en ? 'text-gray-400 line-through' : ''}>
          <span className="block font-medium text-gray-900">{l.descripcion}</span>
          <span className="block text-xs text-gray-500">{l.tipo === 'servicio' ? l.trabajo_codigo : `Con terceros · ${l.proveedor ?? ''}`}{l.area ? ` · ${l.area}` : ''}</span>
          {l.anulada_en && <span className="block text-xs text-red-700 no-underline">Anulada: {l.motivo_anulacion}</span>}
        </span>
      ),
    },
    {
      clave: 'tecnico',
      etiqueta: 'Técnico',
      valor: (l) => l.tecnico ?? '',
      render: (l) =>
        puedeEditar && !l.anulada_en && l.tipo !== 'material' && l.estado !== 'terminado' ? (
          <select className="max-w-[10rem] rounded-md border border-gray-300 px-2 py-1 text-xs" value={l.tecnico_id ?? ''} aria-label="Técnico del trabajo" onChange={(e) => void accion(() => api.patch(`/lineas/${l.id}`, { tecnico_id: e.target.value ? Number(e.target.value) : null }), 'No se pudo asignar el técnico')}>
            <option value="">Sin asignar</option>
            {(opciones.datos?.responsables ?? []).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        ) : (l.tecnico ?? '—'),
    },
    { clave: 'horas', etiqueta: 'Horas', valor: (l) => l.horas_trabajo ?? 0, render: (l) => (l.tipo === 'servicio' ? <span>{l.horas_trabajo} h{l.horas_reales > 0 ? <span className="block text-xs text-gray-500">{formatoHoras(l.horas_reales)} reales</span> : null}</span> : `${l.cantidad} u.`), alinear: 'right' },
    {
      clave: 'estado',
      etiqueta: 'Estado',
      valor: (l) => l.estado,
      render: (l) =>
        l.anulada_en ? <Badge variant="default">Anulada</Badge> : puedeEditar && l.tipo !== 'material' ? (
          <select className="rounded-md border border-gray-300 px-2 py-1 text-xs" value={l.estado} aria-label="Estado del trabajo" onChange={(e) => void accion(() => api.post(`/lineas/${l.id}/estado`, { estado: e.target.value }), 'No se pudo cambiar el estado')}>
            {(Object.keys(ESTADO_LINEA) as EstadoLinea[]).map((k) => <option key={k} value={k}>{ESTADO_LINEA[k].texto}</option>)}
          </select>
        ) : <Badge variant={ESTADO_LINEA[l.estado].variante}>{ESTADO_LINEA[l.estado].texto}</Badge>,
    },
    ...(verPrecios ? [{ clave: 'total', etiqueta: 'Total', valor: (l: LineaOrden) => l.total_linea ?? 0, render: (l: LineaOrden) => <span className={l.anulada_en ? 'text-gray-400 line-through' : ''}>{dineroDe(moneda, l.total_linea)}{l.descuento_pct ? <span className="block text-xs text-gray-500">{l.descuento_pct}% desc.</span> : null}</span>, alinear: 'right' as const }] : []),
    ...(verCostos ? [{ clave: 'costo', etiqueta: 'Costo', valor: (l: LineaOrden) => l.costo ?? 0, render: (l: LineaOrden) => dineroDe(moneda, l.costo), alinear: 'right' as const }] : []),
    {
      clave: 'acc',
      etiqueta: 'Acciones',
      render: (l) =>
        l.tipo === 'material' ? null : (
          <Acciones>
            <BotonAccion onClick={() => setVentana({ fotosLinea: l.id })}>Fotos ({l.fotos.length})</BotonAccion>
            {puedeEditar && !l.anulada_en && <BotonAccion onClick={() => setVentana({ anularLinea: l })}>Anular</BotonAccion>}
          </Acciones>
        ),
    },
  ];

  return (
    <Modal onClose={alCerrar} title={orden ? `Orden ${orden.numero}` : 'Orden de trabajo'} size="2xl">
      <div className="space-y-4">
        <Aviso mensaje={error || opciones.error} tipo="error" />
        {!orden ? (
          <p className="text-sm text-gray-500">Cargando…</p>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <EstadoOrden nombre={orden.estado} color={orden.estado_color} />
                  <Badge variant={PRIORIDAD[orden.prioridad]?.variante ?? 'default'}>{PRIORIDAD[orden.prioridad]?.texto ?? orden.prioridad}</Badge>
                  <span className="text-gray-600">{orden.tipo}</span>
                </div>
                <p className="font-medium text-gray-900">{orden.equipo}</p>
                <p className="text-gray-600">{orden.cliente ?? 'Equipo del taller'} · {orden.sucursal}</p>
                <p className="text-gray-600">
                  {orden.es_pedido_especial === 1 ? 'Pedido especial: el equipo no está en el taller' : orden.equipo_en_taller ? `En el taller desde hace ${orden.dias_en_taller ?? 0} días` : 'El equipo ya no está en el taller'}
                  {orden.fecha_estimada_entrega ? ` · Entrega estimada: ${formatFecha(soloDia(orden.fecha_estimada_entrega))}` : ''}
                </p>
                <p className="text-gray-600">Responsable: {orden.responsable ?? 'sin asignar'}{orden.area ? ` · Área: ${orden.area}` : ''}</p>
                {orden.referencia_factura_externa && <p className="text-gray-600">Factura en caja: {orden.referencia_factura_externa}</p>}
                {orden.descripcion && <p className="whitespace-pre-line text-gray-800">{orden.descripcion}</p>}
                {orden.es_cancelado === 1 && <p className="text-red-700">Anulada: {orden.motivo_anulacion}{orden.motivo_anulacion_texto ? ` — ${orden.motivo_anulacion_texto}` : ''}</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                {tiene('ordenes.editar') && orden.es_terminal !== 1 && <Button size="sm" variant="outline" onClick={() => setVentana('editar')}>Editar datos</Button>}
                {tiene('ordenes.anular') && orden.es_terminal !== 1 && <Button size="sm" variant="danger" onClick={() => setVentana('anular')}>Anular</Button>}
              </div>
            </div>

            {tiene('ordenes.cambiar_estado') && orden.es_cancelado !== 1 && (
              <div className="flex flex-wrap items-end gap-2 rounded-md border border-gray-200 bg-gray-50 p-3">
                <Campo etiqueta={orden.es_terminal === 1 ? 'Reabrir la orden pasándola a' : 'Cambiar el estado a'}>
                  <select className={CLASE_INPUT} value={nuevoEstado} onChange={(e) => setNuevoEstado(e.target.value)}>
                    <option value="">Elija…</option>
                    {estados.filter((s) => s.es_cancelado !== 1 && s.id !== orden.estado_id).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                  </select>
                </Campo>
                <Button
                  disabled={!nuevoEstado || (orden.es_terminal === 1 && !tiene('ordenes.reabrir'))}
                  onClick={() => (orden.es_terminal === 1 ? setVentana('reabrir') : void accion(() => api.post(`/ordenes/${orden.id}/estado`, { estado_id: Number(nuevoEstado) }), 'No se pudo cambiar el estado'))}
                >
                  {orden.es_terminal === 1 ? 'Reabrir…' : 'Aplicar'}
                </Button>
                {orden.es_terminal === 1 && !tiene('ordenes.reabrir') && <span className="text-xs text-gray-500">Reabrir una orden cerrada lo hace la gerencia.</span>}
              </div>
            )}

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-gray-900">Trabajos de la orden</h3>
                {puedeEditar && <span className="flex gap-2"><Button size="sm" onClick={() => setVentana('servicio')}>Agregar trabajo</Button><Button size="sm" variant="outline" onClick={() => setVentana('tercero')}>Agregar trabajo con terceros</Button></span>}
              </div>
              <Tabla columnas={columnas} filas={orden.lineas} clave={(l) => l.id} vacio="Todavía no hay trabajos en esta orden." />
              <p className="text-xs text-gray-500">Los materiales se cargarán a la orden desde Inventario (próxima fase).</p>
              {verPrecios && (
                <dl className="ml-auto max-w-xs space-y-1 text-sm">
                  <div className="flex justify-between"><dt className="text-gray-600">Subtotal</dt><dd>{dineroDe(moneda, orden.subtotal)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">Descuento</dt><dd>- {dineroDe(moneda, orden.descuento_total)}</dd></div>
                  <div className="flex justify-between"><dt className="text-gray-600">IVA</dt><dd>{dineroDe(moneda, orden.iva)}</dd></div>
                  <div className="flex justify-between border-t pt-1 text-base font-bold"><dt>Total</dt><dd>{dineroDe(moneda, orden.total)}</dd></div>
                </dl>
              )}
            </section>

            <div className="grid gap-4 md:grid-cols-2">
              <section>
                <h3 className="mb-1 text-sm font-bold text-gray-900">Historial de estados</h3>
                <ul className="space-y-1 text-sm">
                  {orden.historial.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-2"><EstadoOrden nombre={h.estado} color={h.estado_color} /><span className="text-xs text-gray-500">{fechaHoraLocal(h.desde)}{h.usuario ? ` · ${h.usuario}` : ''}{h.motivo ? ` · ${h.motivo}` : ''}</span></li>
                  ))}
                </ul>
              </section>
              <section>
                <h3 className="mb-1 text-sm font-bold text-gray-900">Lecturas anotadas con esta orden</h3>
                {orden.lecturas.length === 0 ? <p className="text-sm text-gray-500">No se anotó ninguna lectura.</p> : <ul className="text-sm">{orden.lecturas.map((l) => <li key={l.id}>{l.contador}: <strong>{l.valor}</strong> <span className="text-xs text-gray-500">({formatFecha(l.fecha)})</span></li>)}</ul>}
              </section>
            </div>
          </>
        )}
      </div>

      {orden && ventana === 'servicio' && opciones.datos && <AgregarServicio orden={orden} opciones={opciones.datos} alCerrar={() => setVentana(null)} alListo={refrescar} />}
      {orden && ventana === 'tercero' && <AgregarTercero orden={orden} alCerrar={() => setVentana(null)} alListo={refrescar} />}
      {orden && ventana === 'anular' && opciones.datos && <AnularOrden orden={orden} opciones={opciones.datos} alCerrar={() => setVentana(null)} alListo={refrescar} />}
      {orden && ventana === 'editar' && opciones.datos && <EditarDatos orden={orden} opciones={opciones.datos} alCerrar={() => setVentana(null)} alListo={refrescar} />}
      {orden && ventana === 'reabrir' && (
        <PedirMotivo
          titulo={`Reabrir la orden ${orden.numero}`}
          explicacion="La orden vuelve a poder modificarse y, si el equipo ya se había entregado, se anota que regresó al taller. Queda registrado quién la reabrió y por qué."
          etiqueta="Motivo para reabrirla"
          boton="Reabrir orden"
          alCerrar={() => setVentana(null)}
          alConfirmar={async (motivo) => {
            await api.post(`/ordenes/${orden.id}/estado`, { estado_id: Number(nuevoEstado), motivo });
            refrescar();
          }}
        />
      )}
      {orden && typeof ventana === 'object' && ventana !== null && 'fotosLinea' in ventana && (() => {
        const l = orden.lineas.find((x) => x.id === ventana.fotosLinea);
        return l ? <FotosLinea lineaId={l.id} titulo={l.descripcion} fotos={l.fotos} puedeCambiar={puedeEditar} alCerrar={() => setVentana(null)} alCambiar={() => { cargar(); alCambiar(); }} /> : null;
      })()}
      {orden && typeof ventana === 'object' && ventana !== null && 'anularLinea' in ventana && (
        <PedirMotivo
          titulo="Anular el trabajo"
          explicacion={`Se anula «${ventana.anularLinea.descripcion}». No se borra: queda con su motivo, y el precio deja de contar en la orden.`}
          etiqueta="Motivo"
          boton="Anular trabajo"
          peligro
          alCerrar={() => setVentana(null)}
          alConfirmar={async (motivo) => {
            await api.post(`/lineas/${ventana.anularLinea.id}/anular`, { motivo });
            refrescar();
          }}
        />
      )}
    </Modal>
  );
}
