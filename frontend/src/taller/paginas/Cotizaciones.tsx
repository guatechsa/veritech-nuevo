import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Modal from '../../components/ui-guatech/Modal.jsx';
import { formatFecha } from '../../components/ui-guatech/formatoFecha.js';
import { Acciones, BotonAccion } from '../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../componentes/ui';
import { useSesionTaller } from '../Sesion';
import { FichaCotizacion } from './cotizaciones/FichaCotizacion';
import { ESTADO_COT, FilaCotizacion } from './cotizaciones/tipos';
import { dineroDe } from './ordenes/tipos';

type Origen = 'orden' | 'equipo' | 'cliente';

// ── Nueva cotización ──────────────────────────────────────────────────────────────────
export function NuevaCotizacion({ orden, alCerrar, alListo }: { orden?: { id: number; numero: string }; alCerrar: () => void; alListo: (id: number) => void }) {
  const { api } = useSesionTaller();
  const [origen, setOrigen] = useState<Origen>('orden');
  const [texto, setTexto] = useState('');
  const [opciones, setOpciones] = useState<Array<{ id: number; titulo: string; detalle: string }>>([]);
  const [elegido, setElegido] = useState<{ id: number; titulo: string } | null>(orden ? { id: orden.id, titulo: orden.numero } : null);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (orden || elegido || texto.trim().length < 2) return setOpciones([]);
    const q = encodeURIComponent(texto.trim());
    const espera = setTimeout(() => {
      if (origen === 'orden') api.get<{ registros: Array<{ id: number; numero: string; equipo: string; cliente: string | null }> }>(`/ordenes?abiertas=true&buscar=${q}`).then((r) => setOpciones(r.registros.slice(0, 8).map((o) => ({ id: o.id, titulo: o.numero, detalle: `${o.equipo} · ${o.cliente ?? 'Del taller'}` })))).catch(() => setOpciones([]));
      else if (origen === 'equipo') api.get<{ registros: Array<{ id: number; codigo_interno: string | null; placa: string | null; cliente: string | null }> }>(`/equipos?buscar=${q}`).then((r) => setOpciones(r.registros.slice(0, 8).map((x) => ({ id: x.id, titulo: [x.codigo_interno, x.placa].filter(Boolean).join(' · '), detalle: x.cliente ?? 'Del taller' })))).catch(() => setOpciones([]));
      else api.get<{ registros: Array<{ id: number; nombre: string }> }>(`/clientes?buscar=${q}`).then((r) => setOpciones(r.registros.slice(0, 8).map((x) => ({ id: x.id, titulo: x.nombre, detalle: '' })))).catch(() => setOpciones([]));
    }, 250);
    return () => clearTimeout(espera);
  }, [api, origen, texto, elegido, orden]);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!elegido) return setError('Elija de dónde sale la cotización.');
    setError('');
    try {
      const cuerpo = { notas: notas.trim() || null, ...(origen === 'orden' ? { orden_id: elegido.id } : origen === 'equipo' ? { equipo_id: elegido.id } : { cliente_id: elegido.id }) };
      const c = await api.post<{ id: number }>('/cotizaciones', cuerpo);
      alListo(c.id);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo crear la cotización'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Nueva cotización" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        {!orden && (
          <Campo etiqueta="¿De dónde sale?">
            <select className={CLASE_INPUT} value={origen} onChange={(e) => { setOrigen(e.target.value as Origen); setElegido(null); setTexto(''); }}>
              <option value="orden">De una orden (trae equipo y cliente)</option>
              <option value="equipo">De un equipo, sin orden todavía</option>
              <option value="cliente">Solo de un cliente (materiales y trabajos con terceros)</option>
            </select>
          </Campo>
        )}
        <Campo etiqueta={orden ? 'Orden' : origen === 'orden' ? 'Orden' : origen === 'equipo' ? 'Equipo' : 'Cliente'}>
          {elegido ? (
            <div className="flex items-center justify-between rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"><span className="font-medium">{elegido.titulo}</span>{!orden && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setElegido(null)}>Cambiar</button>}</div>
          ) : (
            <div className="relative">
              <input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escriba para buscar" data-no-uppercase="true" autoComplete="off" autoFocus />
              {opciones.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">{opciones.map((o) => <li key={o.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => setElegido({ id: o.id, titulo: o.titulo })}>{o.titulo} <span className="text-xs text-gray-500">{o.detalle}</span></button></li>)}</ul>}
            </div>
          )}
        </Campo>
        <Campo etiqueta="Nota para el cliente (opcional)"><input className={CLASE_INPUT} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={500} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" disabled={!elegido}>Crear borrador</Button></div>
      </form>
    </Modal>
  );
}

// ── Las cotizaciones de una orden (dentro de la ficha de la orden) ────────────────────
export function CotizacionesOrden({ ordenId, ordenNumero, alCambiar }: { ordenId: number; ordenNumero: string; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const { moneda } = useMoneda();
  const lista = useLista(() => api.get<{ registros: FilaCotizacion[] }>(`/cotizaciones?orden_id=${ordenId}`), [api, ordenId]);
  const [creando, setCreando] = useState(false);
  const [abierta, setAbierta] = useState<number | null>(null);
  const cambio = (): void => {
    lista.recargar();
    alCambiar();
  };
  const registros = lista.datos?.registros ?? [];
  if (registros.length === 0 && !tiene('cotizaciones.crear')) return null;
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Cotizaciones</h3>
        {tiene('cotizaciones.crear') && <Button size="sm" variant="outline" onClick={() => setCreando(true)}>Nueva cotización</Button>}
      </div>
      {registros.length === 0 ? <p className="text-sm text-gray-500">No hay cotizaciones para esta orden. Sirven para trabajos adicionales y para cotizar los ítems en rojo de un checklist.</p> : (
        <ul className="divide-y rounded-md border border-gray-200 text-sm">
          {registros.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="flex flex-wrap items-center gap-2"><strong>{r.numero}{r.version > 1 ? ` v${r.version}` : ''}</strong><Badge variant={ESTADO_COT[r.estado].variante}>{ESTADO_COT[r.estado].texto}</Badge><span className="text-xs text-gray-500">{r.lineas} {r.lineas === 1 ? 'línea' : 'líneas'} · {dineroDe(moneda, r.total)}{r.estado === 'enviada' ? ` · ${r.sin_respuesta} sin respuesta` : ''}</span></span>
              <Button size="sm" variant="outline" onClick={() => setAbierta(r.id)}>Ver</Button>
            </li>
          ))}
        </ul>
      )}
      {creando && <NuevaCotizacion orden={{ id: ordenId, numero: ordenNumero }} alCerrar={() => setCreando(false)} alListo={(cid) => { setCreando(false); cambio(); setAbierta(cid); }} />}
      {abierta && <FichaCotizacion id={abierta} alCerrar={() => setAbierta(null)} alCambiar={cambio} alAbrir={setAbierta} />}
    </section>
  );
}

function useMoneda(): { moneda: string } {
  const { perfil } = useSesionTaller();
  return { moneda: perfil?.empresa.moneda ?? 'GTQ' };
}

// ── La pantalla del menú ──────────────────────────────────────────────────────────────
export default function Cotizaciones() {
  const { api, tiene } = useSesionTaller();
  const { moneda } = useMoneda();
  const [params, setParams] = useSearchParams();
  const [vista, setVista] = useState<'abiertas' | 'respondida' | 'vencida' | 'anulada' | 'todas'>('abiertas');
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const [creando, setCreando] = useState(false);
  const abierta = params.get('cotizacion') ? Number(params.get('cotizacion')) : null;
  const q = new URLSearchParams({ pagina: String(pagina), ...(buscar.trim() ? { buscar: buscar.trim() } : {}), ...(vista === 'abiertas' ? { abiertas: 'true' } : vista !== 'todas' ? { estado: vista } : {}) });
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: FilaCotizacion[] }>(`/cotizaciones?${q.toString()}`), [api, pagina, buscar, vista]);
  useEffect(() => setPagina(1), [buscar, vista]);
  const abrir = (id: number | null): void => setParams(id ? { cotizacion: String(id) } : {}, { replace: true });
  const columnas: Array<Columna<FilaCotizacion>> = [
    { clave: 'numero', etiqueta: 'Cotización', valor: (c) => c.numero, render: (c) => `${c.numero}${c.version > 1 ? ` v${c.version}` : ''}` },
    { clave: 'cliente', etiqueta: 'Cliente y equipo', valor: (c) => c.cliente ?? '', render: (c) => <span>{c.cliente ?? 'Del taller'}<span className="block text-xs text-gray-500">{c.equipo ?? 'Sin equipo'}{c.orden ? ` · ${c.orden}` : ''}</span></span> },
    { clave: 'estado', etiqueta: 'Estado', valor: (c) => c.estado, render: (c) => <Badge variant={ESTADO_COT[c.estado].variante}>{ESTADO_COT[c.estado].texto}</Badge> },
    { clave: 'lineas', etiqueta: 'Respuestas', valor: (c) => c.lineas, render: (c) => (c.estado === 'borrador' ? `${c.lineas} líneas` : <span>{c.autorizadas} autorizadas · {c.rechazadas} rechazadas<span className="block text-xs text-gray-500">{c.sin_respuesta} sin respuesta</span></span>) },
    { clave: 'total', etiqueta: 'Total', valor: (c) => c.total, render: (c) => dineroDe(moneda, c.total), alinear: 'right' },
    { clave: 'vence', etiqueta: 'Vence', valor: (c) => c.vence_en ?? '', render: (c) => (c.vence_en ? formatFecha(c.vence_en) : '—') },
    { clave: 'acc', etiqueta: 'Acciones', render: (c) => <Acciones><BotonAccion onClick={() => abrir(c.id)}>Abrir</BotonAccion></Acciones> },
  ];
  const paginas = lista.datos ? Math.max(1, Math.ceil(lista.datos.total / lista.datos.porPagina)) : 1;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Cotizaciones</h1>
      <Seccion titulo="Seguimiento" acciones={tiene('cotizaciones.crear') && <Button onClick={() => setCreando(true)}>Nueva cotización</Button>}>
        <p className="text-sm text-gray-700">Una cotización es un solo documento: el cliente autoriza o rechaza cada línea, y lo autorizado se agrega a la orden. Los ítems en rojo de un checklist se cotizan desde el propio checklist.</p>
        <div className="flex flex-wrap gap-3">
          <select value={vista} onChange={(e) => setVista(e.target.value as typeof vista)} aria-label="Cuáles cotizaciones" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
            <option value="abiertas">Borradores y enviadas</option><option value="respondida">Respondidas</option><option value="vencida">Vencidas</option><option value="anulada">Anuladas</option><option value="todas">Todas</option>
          </select>
          <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por número, cliente o equipo" aria-label="Buscar cotización" className="min-w-64 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        </div>
        <Aviso mensaje={lista.error} tipo="error" />
        <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(c) => c.id} vacio={lista.datos ? 'No hay cotizaciones en esta lista.' : 'Cargando…'} />
        {lista.datos && (
          <div className="flex items-center justify-between text-sm text-gray-600">
            <span>{lista.datos.total} cotizaciones · página {pagina} de {paginas}</span>
            <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button></span>
          </div>
        )}
      </Seccion>
      {creando && <NuevaCotizacion alCerrar={() => setCreando(false)} alListo={(id) => { setCreando(false); lista.recargar(); abrir(id); }} />}
      {abierta && <FichaCotizacion id={abierta} alCerrar={() => abrir(null)} alCambiar={lista.recargar} alAbrir={abrir} />}
    </div>
  );
}
