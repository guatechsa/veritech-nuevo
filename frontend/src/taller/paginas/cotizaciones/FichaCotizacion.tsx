import { FormEvent, useEffect, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import { formatFecha, formatFechaHora } from '../../../components/ui-guatech/formatoFecha.js';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { BotonPdf } from '../ordenes/DocumentosOrden';
import { dineroDe } from '../ordenes/tipos';
import { DESENLACE, DetalleCotizacion, ESTADO_COT, ESTADO_LINEA_COT, LineaCotizacion, OpcionesCotizacion } from './tipos';

const TIPO = { servicio: 'Trabajo', material: 'Material', tercero: 'Con terceros' } as const;
const iso = (d: Date): string => {
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
};

// ── Agregar una línea ─────────────────────────────────────────────────────────────────
function AgregarLinea({ cot, alCerrar, alListo }: { cot: DetalleCotizacion; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [tipo, setTipo] = useState<'servicio' | 'material' | 'tercero'>(cot.equipo_id ? 'servicio' : 'material');
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<Array<{ id: number; codigo: string; nombre: string; unidad?: string; existencia_total?: number; precio?: number }>>([]);
  const [elegido, setElegido] = useState<{ id: number; nombre: string } | null>(null);
  const [horas, setHoras] = useState('');
  const [cantidad, setCantidad] = useState('1');
  const [proveedor, setProveedor] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [precio, setPrecio] = useState('');
  const [costo, setCosto] = useState('');
  const [rojo, setRojo] = useState('');
  const [error, setError] = useState('');
  const proveedores = useLista(() => (tipo === 'tercero' ? api.get<{ registros: Array<{ id: number; nombre: string }> }>('/proveedores?activo=true') : Promise.resolve({ registros: [] })), [api, tipo]);
  useEffect(() => {
    setElegido(null);
    setTexto('');
    setResultados([]);
  }, [tipo]);
  useEffect(() => {
    if (tipo === 'tercero' || elegido || texto.trim().length < 2) return setResultados([]);
    const ruta = tipo === 'servicio' ? '/catalogos/trabajos' : '/materiales';
    const espera = setTimeout(() => api.get<{ registros: Array<{ id: number; codigo: string; nombre: string; unidad?: string; existencia_total?: number; precio?: number }> }>(`${ruta}?buscar=${encodeURIComponent(texto.trim())}`).then((r) => setResultados(r.registros.slice(0, 8))).catch(() => setResultados([])), 250);
    return () => clearTimeout(espera);
  }, [api, tipo, texto, elegido]);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      const comun = { tipo, respuesta_id: rojo ? Number(rojo) : null };
      if (tipo === 'servicio') {
        if (!elegido) return setError('Elija el trabajo del catálogo.');
        await api.post(`/cotizaciones/${cot.id}/lineas`, { ...comun, trabajo_id: elegido.id, ...(horas ? { horas: Number(horas) } : {}) });
      } else if (tipo === 'material') {
        if (!elegido) return setError('Elija el material.');
        await api.post(`/cotizaciones/${cot.id}/lineas`, { ...comun, material_id: elegido.id, cantidad: Number(cantidad) });
      } else {
        await api.post(`/cotizaciones/${cot.id}/lineas`, { ...comun, proveedor_id: Number(proveedor), descripcion, cantidad: Number(cantidad), precio_unitario: Number(precio || 0), costo: Number(costo || 0) });
      }
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo agregar la línea'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Agregar a la cotización" size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <div className="flex flex-wrap gap-2">
          {(['servicio', 'material', 'tercero'] as const).map((t) => <button key={t} type="button" onClick={() => setTipo(t)} className={`rounded-md border border-gray-200 px-4 py-2 text-sm font-medium ${tipo === t ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{TIPO[t]}</button>)}
        </div>
        {tipo === 'servicio' && !cot.equipo_id && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Para cotizar trabajos del catálogo hace falta el equipo: las horas y la tarifa dependen de su tipo.</p>}
        {(tipo === 'servicio' || tipo === 'material') && (
          <Campo etiqueta={tipo === 'servicio' ? 'Trabajo del catálogo' : 'Material'}>
            {elegido ? (
              <div className="flex items-center justify-between rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"><span className="font-medium">{elegido.nombre}</span><button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setElegido(null)}>Cambiar</button></div>
            ) : (
              <div className="relative">
                <input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escriba el nombre o el código" data-no-uppercase="true" autoComplete="off" autoFocus />
                {resultados.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">{resultados.map((r) => <li key={r.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => setElegido({ id: r.id, nombre: r.nombre })}>{r.nombre} <span className="text-xs text-gray-500">{r.codigo}{r.existencia_total !== undefined ? ` · hay ${r.existencia_total} ${r.unidad ?? ''}` : ''}</span></button></li>)}</ul>}
              </div>
            )}
          </Campo>
        )}
        {tipo === 'servicio' && <Campo etiqueta="Horas (opcional)" ayuda="Vacío = las horas del catálogo para este tipo de equipo."><input className={`${CLASE_INPUT} max-w-xs`} type="number" min={0.25} step="0.25" value={horas} onChange={(e) => setHoras(e.target.value)} /></Campo>}
        {tipo === 'material' && <Campo etiqueta="Cantidad"><input className={`${CLASE_INPUT} max-w-xs`} type="number" min={1} step={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} required /></Campo>}
        {tipo === 'tercero' && (
          <>
            <Campo etiqueta="Proveedor"><select className={CLASE_INPUT} value={proveedor} onChange={(e) => setProveedor(e.target.value)} required><option value="">Elija…</option>{(proveedores.datos?.registros ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Descripción del trabajo"><input className={CLASE_INPUT} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={250} required /></Campo>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo etiqueta="Cantidad"><input className={CLASE_INPUT} type="number" min={0.01} step="any" value={cantidad} onChange={(e) => setCantidad(e.target.value)} required /></Campo>
              <Campo etiqueta="Precio al cliente (c/u)"><input className={CLASE_INPUT} type="number" min={0} step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} required /></Campo>
              <Campo etiqueta="Costo para el taller (interno)"><input className={CLASE_INPUT} type="number" min={0} step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} /></Campo>
            </div>
          </>
        )}
        {cot.hallazgos.length > 0 && (
          <Campo etiqueta="¿Qué ítem en rojo atiende? (opcional)"><select className={CLASE_INPUT} value={rojo} onChange={(e) => setRojo(e.target.value)}><option value="">Ninguno en particular</option>{cot.hallazgos.map((h) => <option key={h.respuesta_id} value={h.respuesta_id}>{h.seccion} › {h.descripcion}</option>)}</select></Campo>
        )}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Agregar</Button></div>
      </form>
    </Modal>
  );
}

// ── El enlace para el cliente ─────────────────────────────────────────────────────────
interface EnlaceFila { id: number; creado: string | null; created_at: string; vence_en: string; revocado_en: string | null; primera_apertura_en: string | null; aperturas: number; vigente: boolean }

function EnlaceCliente({ id, puedeCrear, alCambiar }: { id: number; puedeCrear: boolean; alCambiar: () => void }) {
  const { api } = useSesionTaller();
  const lista = useLista(() => api.get<EnlaceFila[]>(`/cotizaciones/${id}/enlaces`), [api, id]);
  const [nuevo, setNuevo] = useState<{ url: string; vence_en: string } | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [error, setError] = useState('');
  const crear = async (): Promise<void> => {
    setError('');
    setCopiado(false);
    try {
      setNuevo(await api.post<{ url: string; vence_en: string }>(`/cotizaciones/${id}/enlace`, {}));
      lista.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo crear el enlace'));
    }
  };
  const revocar = async (): Promise<void> => {
    setError('');
    try {
      await api.post(`/cotizaciones/${id}/enlace/revocar`, {});
      setNuevo(null);
      lista.recargar();
      alCambiar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo revocar'));
    }
  };
  const copiar = async (): Promise<void> => {
    if (!nuevo) return;
    try {
      await navigator.clipboard.writeText(nuevo.url);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  };
  const vigente = (lista.datos ?? []).find((e) => e.vigente);
  return (
    <section className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Enlace para el cliente</h3>
        {puedeCrear && <span className="flex gap-2"><Button size="sm" onClick={() => void crear()}>{vigente ? 'Crear otro enlace' : 'Crear enlace'}</Button>{vigente && <Button size="sm" variant="outline" onClick={() => void revocar()}>Revocar enlaces</Button>}</span>}
      </div>
      <p className="text-xs text-gray-600">El cliente lo abre sin usuario ni contraseña y autoriza o rechaza cada línea. Un enlace nuevo anula los anteriores.</p>
      <Aviso mensaje={error || lista.error} tipo="error" />
      {nuevo && (
        <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium text-amber-900">Cópielo ahora: por seguridad el enlace no se vuelve a mostrar (si lo pierde, cree otro).</p>
          <input readOnly value={nuevo.url} aria-label="Enlace para el cliente" onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-xs" data-no-uppercase="true" />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void copiar()}>{copiado ? 'Copiado' : 'Copiar enlace'}</Button>
            <a className="text-sm font-semibold text-primary hover:underline" href={`https://wa.me/?text=${encodeURIComponent(`Le compartimos su cotización: ${nuevo.url}`)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a>
            <span className="text-xs text-gray-600">Vigente hasta {formatFechaHora(nuevo.vence_en)}</span>
          </div>
        </div>
      )}
      {(lista.datos ?? []).length > 0 && (
        <ul className="space-y-1 text-xs text-gray-600">
          {(lista.datos ?? []).map((e) => <li key={e.id}>{e.vigente ? 'Vigente' : e.revocado_en ? 'Anulado' : 'Vencido'} · creado {formatFechaHora(e.created_at)}{e.creado ? ` por ${e.creado}` : ''} · {e.aperturas === 0 ? 'todavía no lo abren' : `abierto ${e.aperturas} ${e.aperturas === 1 ? 'vez' : 'veces'}${e.primera_apertura_en ? `, la primera el ${formatFechaHora(e.primera_apertura_en)}` : ''}`}</li>)}
        </ul>
      )}
    </section>
  );
}

// ── La ficha ──────────────────────────────────────────────────────────────────────────
type Ventana = null | 'linea' | 'enviar' | 'anular' | { responder: LineaCotizacion; decision: 'autorizada' | 'rechazada' } | 'orden';

export function FichaCotizacion({ id, alCerrar, alCambiar, alAbrir }: { id: number; alCerrar: () => void; alCambiar: () => void; alAbrir?: (id: number) => void }) {
  const { api, tiene, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const [c, setC] = useState<DetalleCotizacion | null>(null);
  const [error, setError] = useState('');
  const [ventana, setVentana] = useState<Ventana>(null);
  const [vence, setVence] = useState('');
  const [motivo, setMotivo] = useState('');
  const [motivoTexto, setMotivoTexto] = useState('');
  const [ordenId, setOrdenId] = useState('');
  const opciones = useLista(() => api.get<OpcionesCotizacion>('/cotizaciones-opciones'), [api]);
  const ordenesAbiertas = useLista(() => (c?.equipo_id ? api.get<{ registros: Array<{ id: number; numero: string }> }>(`/ordenes?abiertas=true&equipo_id=${c.equipo_id}`) : Promise.resolve({ registros: [] })), [api, c?.equipo_id]);
  const cargar = (): void => {
    api.get<DetalleCotizacion>(`/cotizaciones/${id}`).then((d) => { setC(d); setError(''); }).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar la cotización')));
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
  const borrador = c?.estado === 'borrador';
  const puedeCotizar = tiene('cotizaciones.crear');
  const verCostos = tiene('ordenes.ver_costos');
  const llevables = (c?.lineas ?? []).filter((l) => l.estado === 'autorizada').length;
  const columnas: Array<Columna<LineaCotizacion>> = [
    { clave: 'linea', etiqueta: 'Concepto', valor: (l) => l.descripcion, render: (l) => <span><span className="block font-medium text-gray-900">{l.descripcion}</span><span className="block text-xs text-gray-500">{TIPO[l.tipo]}{l.proveedor ? ` · ${l.proveedor}` : ''}{l.horas ? ` · ${l.horas} h` : ''}{l.tipo !== 'servicio' ? ` · ${l.cantidad} u.` : ''}</span></span> },
    { clave: 'precio', etiqueta: 'Precio', valor: (l) => l.precio_unitario, render: (l) => dineroDe(moneda, l.precio_unitario), alinear: 'right' },
    { clave: 'desc', etiqueta: 'Desc.', valor: (l) => l.descuento_pct, render: (l) => (l.descuento_pct ? `${l.descuento_pct} %` : '—'), alinear: 'right' },
    { clave: 'total', etiqueta: 'Total', valor: (l) => l.total_linea, render: (l) => <strong>{dineroDe(moneda, l.total_linea)}</strong>, alinear: 'right' },
    ...(verCostos ? [{ clave: 'costo', etiqueta: 'Costo', valor: (l: LineaCotizacion) => l.costo ?? 0, render: (l: LineaCotizacion) => dineroDe(moneda, l.costo), alinear: 'right' as const }] : []),
    {
      clave: 'estado',
      etiqueta: 'Respuesta',
      valor: (l) => l.estado,
      render: (l) => (
        <span>
          {c?.estado === 'borrador' ? <span className="text-xs text-gray-400">—</span> : <Badge variant={ESTADO_LINEA_COT[l.estado].variante}>{ESTADO_LINEA_COT[l.estado].texto}</Badge>}
          {l.estado === 'rechazada' && <span className="mt-1 block text-xs text-gray-600">{l.motivo_rechazo}{l.motivo_rechazo_texto ? `: ${l.motivo_rechazo_texto}` : ''}</span>}
          {l.respondida_en && <span className="mt-1 block text-xs text-gray-500">{formatFechaHora(l.respondida_en)}{l.respondida_por_nombre ? ` · ${l.respondida_por_nombre} (por enlace)` : l.respondida_por ? ` · ${l.respondida_por}` : ''}</span>}
          {l.estado === 'agregada_a_orden' && <span className="mt-1 block text-xs text-gray-500">{l.agregada_orden}{l.solicitud ? ` · pedido a bodega ${l.solicitud}` : ''}</span>}
        </span>
      ),
    },
    {
      clave: 'acc',
      etiqueta: 'Acciones',
      render: (l) => (
        <Acciones>
          {borrador && puedeCotizar && <BotonAccion onClick={() => void accion(() => api.delete(`/cotizacion-lineas/${l.id}`), 'No se pudo quitar la línea')}>Quitar</BotonAccion>}
          {c?.estado === 'enviada' && l.estado === 'pendiente' && tiene('cotizaciones.responder') && (
            <>
              <BotonAccion onClick={() => void accion(() => api.post(`/cotizacion-lineas/${l.id}/responder`, { decision: 'autorizada' }), 'No se pudo registrar')}>Autorizó</BotonAccion>
              <BotonAccion onClick={() => { setMotivo(''); setMotivoTexto(''); setVentana({ responder: l, decision: 'rechazada' }); }}>Rechazó</BotonAccion>
            </>
          )}
        </Acciones>
      ),
    },
  ];
  return (
    <Modal onClose={alCerrar} title={c ? `Cotización ${c.numero}${c.version > 1 ? ` · versión ${c.version}` : ''}` : 'Cotización'} size="2xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        {!c ? <p className="text-sm text-gray-500">Cargando…</p> : (
          <>
            <div className="space-y-1 text-sm">
              <p className="flex flex-wrap items-center gap-2"><Badge variant={ESTADO_COT[c.estado].variante}>{ESTADO_COT[c.estado].texto}</Badge><span className="font-medium text-gray-900">{c.cliente ?? 'Equipo del taller'}</span>{c.equipo && <span className="text-gray-600">{c.equipo}</span>}{c.orden && <span className="text-gray-600">· Orden {c.orden}</span>}</p>
              <p className="text-gray-600">{c.creada_por ? `Hizo ${c.creada_por}` : ''}{c.enviada_en ? ` · enviada ${formatFechaHora(c.enviada_en)}` : ''}{c.vence_en ? ` · vence el ${formatFecha(c.vence_en)}` : ''}</p>
              {c.notas && <p className="text-gray-800">Nota para el cliente: {c.notas}</p>}
              {c.estado === 'anulada' && <p className="text-red-700">Anulada: {c.motivo_anulacion}</p>}
              {c.estado === 'reemplazada' && c.version_nueva_id && <p className="text-amber-800">Esta versión fue reemplazada. {alAbrir && <button className="font-semibold underline" onClick={() => alAbrir(c.version_nueva_id as number)}>Ver la versión nueva</button>}</p>}
            </div>

            {c.hallazgos.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-sm font-bold text-gray-900">Ítems en rojo que atiende</h3>
                <ul className="space-y-2">
                  {c.hallazgos.map((h) => (
                    <li key={h.respuesta_id} className="rounded-md border border-red-200 bg-red-50 p-3 text-sm">
                      <p className="flex flex-wrap items-center gap-2"><strong>{h.seccion} › {h.descripcion}</strong>{h.desenlace && <Badge variant={DESENLACE[h.desenlace.estado].variante}>{DESENLACE[h.desenlace.estado].texto}</Badge>}</p>
                      {h.nota && <p className="text-gray-700">Nota del técnico: {h.nota}</p>}
                      {h.fotos.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{h.fotos.map((f, i) => <a key={i} href={f.url} target="_blank" rel="noreferrer"><img src={f.url} alt={`Foto de ${h.descripcion}`} className="h-20 w-20 rounded-md border border-gray-200 object-cover" /></a>)}</div>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-bold text-gray-900">Lo que se cotiza</h3>
                {borrador && puedeCotizar && <Button size="sm" onClick={() => setVentana('linea')}>Agregar</Button>}
              </div>
              <Tabla columnas={columnas} filas={c.lineas} clave={(l) => l.id} vacio="Todavía no hay líneas." />
              <dl className="ml-auto max-w-xs space-y-1 text-sm">
                <div className="flex justify-between"><dt className="text-gray-600">Subtotal</dt><dd>{dineroDe(moneda, c.subtotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-600">Descuento</dt><dd>- {dineroDe(moneda, c.descuento_total)}</dd></div>
                <div className="flex justify-between"><dt className="text-gray-600">IVA</dt><dd>{dineroDe(moneda, c.iva)}</dd></div>
                <div className="flex justify-between border-t pt-1 text-base font-bold"><dt>Total</dt><dd>{dineroDe(moneda, c.total)}</dd></div>
              </dl>
            </section>

            <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
              {c.estado !== 'borrador' && tiene('documentos.emitir') && <BotonPdf ruta={`/cotizaciones/${c.id}/documento`} texto="Descargar PDF" />}
              {puedeCotizar && ['borrador', 'enviada', 'vencida', 'respondida'].includes(c.estado) && <Button variant="outline" onClick={() => { setMotivo(''); setVentana('anular'); }}>Anular</Button>}
              {puedeCotizar && (c.estado === 'enviada' || c.estado === 'vencida') && <Button variant="outline" onClick={() => void accion(async () => { const r = await api.post<{ id: number }>(`/cotizaciones/${id}/nueva-version`, {}); if (alAbrir) alAbrir(r.id); }, 'No se pudo crear la versión nueva')}>Cambiarla (versión nueva)</Button>}
              {puedeCotizar && tiene('ordenes.editar') && llevables > 0 && <Button variant="outline" onClick={() => { setOrdenId(''); setVentana('orden'); }}>Agregar lo autorizado a la orden ({llevables})</Button>}
              {puedeCotizar && borrador && <Button disabled={c.lineas.length === 0} onClick={() => { setVence(c.vence_en ?? iso(new Date(Date.now() + (opciones.datos?.vigencia_dias ?? 15) * 86400000))); setVentana('enviar'); }}>Enviar al cliente</Button>}
            </div>
            {c.estado === 'enviada' && <EnlaceCliente id={c.id} puedeCrear={puedeCotizar} alCambiar={hecho} />}
            {c.estado === 'enviada' && <p className="text-xs text-gray-500">Si el cliente responde por teléfono o en persona, quien habló con él registra aquí (botones «Autorizó» y «Rechazó») qué dijo de cada línea.</p>}
          </>
        )}
      </div>
      {ventana === 'linea' && c && <AgregarLinea cot={c} alCerrar={() => setVentana(null)} alListo={hecho} />}
      {ventana === 'enviar' && c && (
        <Modal onClose={() => setVentana(null)} title={`Enviar la cotización ${c.numero}`} size="md">
          <form onSubmit={(e) => { e.preventDefault(); void accion(() => api.post(`/cotizaciones/${id}/enviar`, { vence_en: vence }), 'No se pudo enviar'); }} className="space-y-3">
            <p className="text-sm text-gray-700">Una vez enviada ya no se edita: si hace falta cambiarla se crea una versión nueva.</p>
            <Campo etiqueta="Vigente hasta"><FechaInput value={vence} onChange={(e) => setVence(e.target.value)} min={iso(new Date())} required className={`${CLASE_INPUT} max-w-xs`} /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setVentana(null)}>Volver</Button><Button type="submit">Enviar</Button></div>
          </form>
        </Modal>
      )}
      {ventana === 'anular' && c && (
        <Modal onClose={() => setVentana(null)} title={`Anular la cotización ${c.numero}`} size="md">
          <form onSubmit={(e) => { e.preventDefault(); void accion(() => api.post(`/cotizaciones/${id}/anular`, { motivo }), 'No se pudo anular'); }} className="space-y-3">
            <Campo etiqueta="Motivo"><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={300} required autoFocus /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setVentana(null)}>Volver</Button><Button type="submit" variant="danger">Anular</Button></div>
          </form>
        </Modal>
      )}
      {typeof ventana === 'object' && ventana !== null && 'responder' in ventana && (
        <Modal onClose={() => setVentana(null)} title="El cliente rechazó esta línea" size="md">
          <form onSubmit={(e) => { e.preventDefault(); void accion(() => api.post(`/cotizacion-lineas/${ventana.responder.id}/responder`, { decision: 'rechazada', motivo_id: Number(motivo), motivo_texto: motivoTexto.trim() || null }), 'No se pudo registrar'); }} className="space-y-3">
            <p className="text-sm text-gray-700">{ventana.responder.descripcion}</p>
            <Campo etiqueta="Motivo"><select className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} required><option value="">Elija…</option>{(opciones.datos?.motivos_rechazo ?? []).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Detalle (opcional)"><input className={CLASE_INPUT} value={motivoTexto} onChange={(e) => setMotivoTexto(e.target.value)} maxLength={300} /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setVentana(null)}>Volver</Button><Button type="submit" variant="danger">Registrar rechazo</Button></div>
          </form>
        </Modal>
      )}
      {ventana === 'orden' && c && (
        <Modal onClose={() => setVentana(null)} title="Agregar lo autorizado a la orden" size="md">
          <form onSubmit={(e) => { e.preventDefault(); void accion(() => api.post(`/cotizaciones/${id}/agregar-a-orden`, ordenId ? { orden_id: Number(ordenId) } : {}), 'No se pudo agregar a la orden'); }} className="space-y-3">
            <p className="text-sm text-gray-700">Los trabajos y los trabajos con terceros pasan a la orden con el precio cotizado; los materiales se piden a bodega en una solicitud (se cobran con el precio del día en que se despachen). Lo rechazado o sin respuesta no se lleva.</p>
            {c.orden_id ? <p className="text-sm font-medium text-gray-900">Orden {c.orden}</p> : <Campo etiqueta="Orden a la que se agrega" ayuda="La cotización no tiene orden: elija una orden abierta de este equipo."><select className={CLASE_INPUT} value={ordenId} onChange={(e) => setOrdenId(e.target.value)} required><option value="">Elija…</option>{(ordenesAbiertas.datos?.registros ?? []).map((o) => <option key={o.id} value={o.id}>{o.numero}</option>)}</select></Campo>}
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setVentana(null)}>Volver</Button><Button type="submit">Agregar a la orden</Button></div>
          </form>
        </Modal>
      )}
    </Modal>
  );
}
