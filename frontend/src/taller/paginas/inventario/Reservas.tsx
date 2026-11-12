import { FormEvent, useEffect, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import { formatFecha } from '../../../components/ui-guatech/formatoFecha.js';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { DetalleReserva, ESTADO_RESERVA, FilaMaterial, FilaReserva } from './tipos';

const iso = (d: Date): string => {
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
};
const enDias = (n: number): string => iso(new Date(Date.now() + n * 86400000));

function Vence({ r }: { r: { estado: string; vence_en: string; dias_para_vencer: number | null } }) {
  const cuando = r.dias_para_vencer === null ? '' : r.dias_para_vencer < 0 ? '' : r.dias_para_vencer === 0 ? 'vence hoy' : r.dias_para_vencer === 1 ? 'vence mañana' : `faltan ${r.dias_para_vencer} días`;
  return <span>{formatFecha(r.vence_en)}{cuando ? <span className={`block text-xs ${(r.dias_para_vencer ?? 99) <= 3 ? 'font-medium text-red-700' : 'text-gray-500'}`}>{cuando}</span> : null}</span>;
}

// ── Nueva reserva ─────────────────────────────────────────────────────────────────────
interface Pedido { material_id: number; codigo: string; nombre: string; unidad: string; existencia: number; cantidad: string }

export function NuevaReserva({ orden, alCerrar, alListo }: { orden?: { id: number; numero: string }; alCerrar: () => void; alListo: (id: number) => void }) {
  const { api } = useSesionTaller();
  const [elegida, setElegida] = useState<{ id: number; numero: string } | null>(orden ?? null);
  const [textoOrden, setTextoOrden] = useState('');
  const [ordenes, setOrdenes] = useState<Array<{ id: number; numero: string; cliente: string | null; equipo: string }>>([]);
  const [vence, setVence] = useState(enDias(7));
  const [textoMat, setTextoMat] = useState('');
  const [materiales, setMateriales] = useState<FilaMaterial[]>([]);
  const [lineas, setLineas] = useState<Pedido[]>([]);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (elegida || textoOrden.trim().length < 2) return setOrdenes([]);
    const espera = setTimeout(() => api.get<{ registros: Array<{ id: number; numero: string; cliente: string | null; equipo: string }> }>(`/ordenes?abiertas=true&buscar=${encodeURIComponent(textoOrden.trim())}`).then((r) => setOrdenes(r.registros.slice(0, 8))).catch(() => setOrdenes([])), 250);
    return () => clearTimeout(espera);
  }, [api, textoOrden, elegida]);
  useEffect(() => {
    if (textoMat.trim().length < 2) return setMateriales([]);
    const espera = setTimeout(() => api.get<{ registros: FilaMaterial[] }>(`/materiales?buscar=${encodeURIComponent(textoMat.trim())}`).then((r) => setMateriales(r.registros.slice(0, 8))).catch(() => setMateriales([])), 250);
    return () => clearTimeout(espera);
  }, [api, textoMat]);
  const agregar = (m: FilaMaterial): void => {
    setLineas((ls) => (ls.some((l) => l.material_id === m.id) ? ls : [...ls, { material_id: m.id, codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, existencia: m.existencia_total, cantidad: '1' }]));
    setTextoMat('');
    setMateriales([]);
  };
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    if (!elegida) return setError('Elija la orden para la que se reserva.');
    try {
      const r = await api.post<DetalleReserva>('/reservas', { orden_id: elegida.id, vence_en: vence, notas: notas.trim() || null, lineas: lineas.map((l) => ({ material_id: l.material_id, cantidad: Number(l.cantidad) })) });
      alListo(r.id);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo reservar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Reservar material" size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">La reserva protege las unidades para una orden hasta su vencimiento. Se puede reservar aunque hoy no haya existencia (por ejemplo, una pieza que se está importando).</p>
        <Campo etiqueta="Orden">
          {elegida ? (
            <div className="flex items-center justify-between rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"><span className="font-medium">{elegida.numero}</span>{!orden && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setElegida(null)}>Cambiar</button>}</div>
          ) : (
            <div className="relative">
              <input className={CLASE_INPUT} value={textoOrden} onChange={(e) => setTextoOrden(e.target.value)} placeholder="Número de orden, placa o cliente" data-no-uppercase="true" autoComplete="off" autoFocus />
              {ordenes.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">{ordenes.map((o) => <li key={o.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => setElegida({ id: o.id, numero: o.numero })}>{o.numero} <span className="text-xs text-gray-500">{o.equipo} · {o.cliente ?? 'Del taller'}</span></button></li>)}</ul>}
            </div>
          )}
        </Campo>
        <Campo etiqueta="Vence" ayuda="Vale hasta el final de ese día; después las unidades se liberan solas."><FechaInput value={vence} onChange={(e) => setVence(e.target.value)} min={iso(new Date())} required className={`${CLASE_INPUT} max-w-xs`} /></Campo>
        <Campo etiqueta="Agregar material">
          <div className="relative">
            <input className={CLASE_INPUT} value={textoMat} onChange={(e) => setTextoMat(e.target.value)} placeholder="Código, nombre, marca o código del fabricante" data-no-uppercase="true" autoComplete="off" />
            {materiales.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">{materiales.map((m) => <li key={m.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => agregar(m)}>{m.nombre} <span className="text-xs text-gray-500">{m.codigo} · hay {m.existencia_total} {m.unidad}</span></button></li>)}</ul>}
          </div>
        </Campo>
        {lineas.length === 0 ? <p className="text-sm text-gray-500">Agregue al menos un material.</p> : (
          <table className="w-full text-sm">
            <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-1">Material</th><th className="py-1">Hay hoy</th><th className="w-28 py-1">Cantidad</th><th className="w-10" /></tr></thead>
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
        <Campo etiqueta="Nota (opcional)"><input className={CLASE_INPUT} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" disabled={lineas.length === 0 || !elegida}>Reservar</Button></div>
      </form>
    </Modal>
  );
}

// ── La reserva ────────────────────────────────────────────────────────────────────────
export function FichaReserva({ id, alCerrar, alCambiar }: { id: number; alCerrar: () => void; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const [r, setR] = useState<DetalleReserva | null>(null);
  const [error, setError] = useState('');
  const [ventana, setVentana] = useState<'ampliar' | 'cancelar' | null>(null);
  const [fecha, setFecha] = useState('');
  const [motivo, setMotivo] = useState('');
  const cargar = (): void => {
    api.get<DetalleReserva>(`/reservas/${id}`).then((d) => { setR(d); setError(''); }).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar la reserva')));
  };
  useEffect(cargar, [api, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const hecho = (): void => {
    setVentana(null);
    cargar();
    alCambiar();
  };
  const accion = async (f: () => Promise<unknown>, falla: string): Promise<void> => {
    setError('');
    try {
      await f();
      hecho();
    } catch (e) {
      setError(mensajeDe(e, falla));
      setVentana(null);
    }
  };
  const activa = r?.estado === 'activa';
  const columnas: Array<Columna<DetalleReserva['lineas'][number]>> = [
    { clave: 'material', etiqueta: 'Material', valor: (l) => l.nombre, render: (l) => <span><span className="block font-medium text-gray-900">{l.nombre}</span><span className="block text-xs text-gray-500">{l.codigo}</span></span> },
    { clave: 'cantidad', etiqueta: 'Reservado', valor: (l) => l.cantidad, render: (l) => `${l.cantidad} ${l.unidad}`, alinear: 'right' },
    { clave: 'cubierta', etiqueta: 'Ya despachado', valor: (l) => l.cantidad_cubierta, alinear: 'right' },
    { clave: 'pendiente', etiqueta: 'Falta', valor: (l) => l.pendiente, alinear: 'right' },
    ...(activa ? [{ clave: 'disponible', etiqueta: 'Hay libre ahora', valor: (l: DetalleReserva['lineas'][number]) => l.disponible, render: (l: DetalleReserva['lineas'][number]) => (l.pendiente === 0 ? '—' : <span className={l.alcanza ? 'font-medium text-green-700' : 'font-medium text-red-700'}>{l.disponible}{l.alcanza ? '' : ' (no alcanza)'}</span>), alinear: 'right' as const }] : []),
  ];
  return (
    <Modal onClose={alCerrar} title={r ? `Reserva ${r.numero}` : 'Reserva de material'} size="2xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        {!r ? <p className="text-sm text-gray-500">Cargando…</p> : (
          <>
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2"><Badge variant={ESTADO_RESERVA[r.estado].variante}>{ESTADO_RESERVA[r.estado].texto}</Badge><span className="font-medium text-gray-900">Orden {r.orden}</span><span className="text-gray-600">{r.cliente ?? 'Equipo del taller'} · {r.equipo}</span>{r.lista && <Badge variant="success">Ya hay material completo</Badge>}</p>
              <p className="text-gray-600">Vence el {formatFecha(r.vence_en)}{r.extensiones > 0 ? ` · ampliada ${r.extensiones} ${r.extensiones === 1 ? 'vez' : 'veces'} (${r.motivo_extension})` : ''}{r.creada_por ? ` · reservó ${r.creada_por}` : ''}</p>
              {r.notas && <p className="text-gray-800">Nota: {r.notas}</p>}
              {r.estado === 'cargada' && <p className="text-green-800">Se cargó a la orden{r.solicitud ? ` con la solicitud ${r.solicitud}` : ''}.</p>}
              {r.estado === 'cancelada' && <p className="text-red-700">Cancelada: {r.motivo_cancelacion}</p>}
              {r.estado === 'vencida' && <p className="text-red-700">Venció sin cargarse: las unidades ya quedaron libres. Si todavía hace falta, haga una reserva nueva.</p>}
            </div>
            <Tabla columnas={columnas} filas={r.lineas} clave={(l) => l.id} vacio="Sin materiales." />
            {activa && (
              <div className="flex flex-wrap justify-end gap-2">
                {tiene('reservas.gestionar') && <Button variant="outline" onClick={() => { setFecha(r.vence_en); setMotivo(''); setVentana('ampliar'); }}>Ampliar</Button>}
                <Button variant="outline" onClick={() => { setMotivo(''); setVentana('cancelar'); }}>Cancelar reserva</Button>
                {tiene('solicitudes.despachar') && !r.orden_cerrada && <Button onClick={() => void accion(() => api.post(`/reservas/${id}/cargar`, {}), 'No se pudo cargar a la orden')}>Cargar a la orden</Button>}
              </div>
            )}
            {activa && !r.lista && <p className="text-xs text-gray-500">«Cargar a la orden» despacha todo lo reservado o nada: no funciona hasta que haya las unidades completas.</p>}
          </>
        )}
      </div>
      {ventana === 'ampliar' && r && (
        <Modal onClose={() => setVentana(null)} title={`Ampliar la reserva ${r.numero}`} size="md">
          <form onSubmit={(e) => { e.preventDefault(); void accion(() => api.post(`/reservas/${id}/ampliar`, { vence_en: fecha, motivo }), 'No se pudo ampliar'); }} className="space-y-3">
            <Campo etiqueta="Nueva fecha de vencimiento"><FechaInput value={fecha} onChange={(e) => setFecha(e.target.value)} min={r.vence_en} required className={`${CLASE_INPUT} max-w-xs`} /></Campo>
            <Campo etiqueta="Motivo"><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={300} required autoFocus /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setVentana(null)}>Volver</Button><Button type="submit">Ampliar</Button></div>
          </form>
        </Modal>
      )}
      {ventana === 'cancelar' && r && (
        <Modal onClose={() => setVentana(null)} title={`Cancelar la reserva ${r.numero}`} size="md">
          <form onSubmit={(e) => { e.preventDefault(); void accion(() => api.post(`/reservas/${id}/cancelar`, { motivo }), 'No se pudo cancelar'); }} className="space-y-3">
            <p className="text-sm text-gray-700">Las unidades reservadas quedan libres para otras órdenes.</p>
            <Campo etiqueta="Motivo"><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={300} required autoFocus /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setVentana(null)}>Volver</Button><Button type="submit" variant="danger">Cancelar reserva</Button></div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}

// ── Las reservas de una orden (dentro de la ficha de la orden) ────────────────────────
export function ReservasOrden({ ordenId, ordenNumero, cerrada, alCambiar }: { ordenId: number; ordenNumero: string; cerrada: boolean; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<{ registros: FilaReserva[] }>(`/reservas?orden_id=${ordenId}`), [api, ordenId]);
  const [creando, setCreando] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const cambio = (): void => {
    lista.recargar();
    alCambiar();
  };
  const registros = lista.datos?.registros ?? [];
  if (registros.length === 0 && (cerrada || !tiene('reservas.crear'))) return null;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Reservas de material</h3>
        {tiene('reservas.crear') && !cerrada && <Button size="sm" variant="outline" onClick={() => setCreando(true)}>Reservar material</Button>}
      </div>
      {registros.length === 0 ? <p className="text-sm text-gray-500">No hay reservas para esta orden.</p> : (
        <ul className="divide-y rounded-md border border-gray-200 text-sm">
          {registros.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex flex-wrap items-center gap-2"><strong>{r.numero}</strong><Badge variant={ESTADO_RESERVA[r.estado].variante}>{ESTADO_RESERVA[r.estado].texto}</Badge>{r.lista && <Badge variant="success">Material completo</Badge>}<span className="text-xs text-gray-500">{r.lineas} {r.lineas === 1 ? 'material' : 'materiales'} · vence {formatFecha(r.vence_en)}</span></span>
              <Button size="sm" variant="outline" onClick={() => setAbierta(r.id)}>Ver</Button>
            </li>
          ))}
        </ul>
      )}
      {creando && <NuevaReserva orden={{ id: ordenId, numero: ordenNumero }} alCerrar={() => setCreando(false)} alListo={(rid) => { setCreando(false); cambio(); setAbierta(rid); }} />}
      {abierta && <FichaReserva id={abierta} alCerrar={() => setAbierta(null)} alCambiar={cambio} />}
    </section>
  );
}

// ── La pestaña de Reservas ────────────────────────────────────────────────────────────
export function PestanaReservas() {
  const { api, tiene } = useSesionTaller();
  const [vista, setVista] = useState<'abiertas' | 'cargada' | 'vencida' | 'cancelada' | 'todas'>('abiertas');
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const [creando, setCreando] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const q = new URLSearchParams({ pagina: String(pagina), ...(buscar.trim() ? { buscar: buscar.trim() } : {}), ...(vista === 'abiertas' ? { abiertas: 'true' } : vista !== 'todas' ? { estado: vista } : {}) });
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: FilaReserva[] }>(`/reservas?${q.toString()}`), [api, pagina, buscar, vista]);
  useEffect(() => setPagina(1), [buscar, vista]);
  const columnas: Array<Columna<FilaReserva>> = [
    { clave: 'numero', etiqueta: 'Reserva', valor: (r) => r.numero },
    { clave: 'orden', etiqueta: 'Orden', valor: (r) => r.orden, render: (r) => <span>{r.orden}<span className="block text-xs text-gray-500">{r.cliente ?? 'Del taller'} · {r.equipo}</span></span> },
    { clave: 'estado', etiqueta: 'Estado', valor: (r) => r.estado, render: (r) => <span><Badge variant={ESTADO_RESERVA[r.estado].variante}>{ESTADO_RESERVA[r.estado].texto}</Badge>{r.lista ? <span className="mt-1 block text-xs font-medium text-green-700">Ya hay material completo</span> : null}</span> },
    { clave: 'vence', etiqueta: 'Vence', valor: (r) => r.vence_en, render: (r) => <Vence r={r} /> },
    { clave: 'lineas', etiqueta: 'Materiales', valor: (r) => r.lineas, alinear: 'right' },
    { clave: 'creada', etiqueta: 'Reservó', valor: (r) => r.creada_por ?? '', render: (r) => r.creada_por ?? '—' },
    { clave: 'acc', etiqueta: 'Acciones', render: (r) => <Acciones><BotonAccion onClick={() => setAbierta(r.id)}>Abrir</BotonAccion></Acciones> },
  ];
  const paginas = lista.datos ? Math.max(1, Math.ceil(lista.datos.total / lista.datos.porPagina)) : 1;
  return (
    <Seccion titulo="Reservas de material" acciones={tiene('reservas.crear') && <Button onClick={() => setCreando(true)}>Reservar material</Button>}>
      <p className="text-sm text-gray-700">Una reserva protege unidades para una orden hasta su vencimiento: nadie más puede despacharlas. Cuando llega la pieza, «Cargar a la orden» la despacha de una vez.</p>
      <div className="flex flex-wrap gap-3">
        <select value={vista} onChange={(e) => setVista(e.target.value as typeof vista)} aria-label="Cuáles reservas" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="abiertas">Vigentes</option><option value="cargada">Cargadas</option><option value="vencida">Vencidas</option><option value="cancelada">Canceladas</option><option value="todas">Todas</option>
        </select>
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por reserva, orden o cliente" aria-label="Buscar reserva" className="min-w-64 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
      </div>
      <Aviso mensaje={lista.error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(r) => r.id} vacio={lista.datos ? 'No hay reservas en esta lista.' : 'Cargando…'} />
      {lista.datos && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{lista.datos.total} reservas · página {pagina} de {paginas}</span>
          <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button></span>
        </div>
      )}
      {creando && <NuevaReserva alCerrar={() => setCreando(false)} alListo={(rid) => { setCreando(false); lista.recargar(); setAbierta(rid); }} />}
      {abierta && <FichaReserva id={abierta} alCerrar={() => setAbierta(null)} alCambiar={lista.recargar} />}
    </Seccion>
  );
}
