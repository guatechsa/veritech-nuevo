import { FormEvent, useEffect, useState } from 'react';
import Button from '../../../components/ui-guatech/Button.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { OpcionesOrden } from './tipos';

interface EquipoFila {
  id: number;
  descripcion: string;
  cliente: string | null;
  tipo_equipo: string;
  estado: string;
}

interface ContadorEquipo {
  id: number;
  nombre: string;
  es_calendario: boolean;
  valor_actual: number;
  unidad: string;
}

/** Busca el equipo por código, placa, serie, modelo o cliente (la lista puede ser enorme, así que no se carga completa). */
function BuscadorEquipo({ valor, alCambiar }: { valor: EquipoFila | null; alCambiar: (e: EquipoFila | null) => void }) {
  const { api } = useSesionTaller();
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<EquipoFila[]>([]);
  useEffect(() => {
    if (texto.trim().length < 2) {
      setResultados([]);
      return;
    }
    const espera = setTimeout(() => {
      api.get<{ registros: EquipoFila[] }>(`/equipos?buscar=${encodeURIComponent(texto.trim())}`).then((r) => setResultados(r.registros.slice(0, 8))).catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(espera);
  }, [api, texto]);
  if (valor) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm">
        <span><span className="font-medium text-gray-900">{valor.descripcion}</span><span className="block text-xs text-gray-500">{valor.tipo_equipo} · {valor.cliente ?? 'Del taller'}</span></span>
        <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => alCambiar(null)}>Cambiar</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escriba el código, la placa, la serie o el cliente" data-no-uppercase="true" autoComplete="off" autoFocus />
      {resultados.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {resultados.map((q) => (
            <li key={q.id}>
              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => { alCambiar(q); setTexto(''); setResultados([]); }}>
                <span className="font-medium">{q.descripcion}</span> <span className="text-xs text-gray-500">{q.tipo_equipo} · {q.cliente ?? 'Del taller'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {texto.trim().length >= 2 && resultados.length === 0 && <p className="mt-1 text-xs text-gray-500">Sin resultados. Si el equipo no está registrado, créelo primero en «Equipos».</p>}
    </div>
  );
}

/** Recibir un equipo: se abre la orden, queda el equipo en el taller y, si se quiere, la lectura de su medidor. */
export function NuevaOrden({ equipoInicial, alCerrar, alCrear }: { equipoInicial?: EquipoFila | null; alCerrar: () => void; alCrear: (id: number) => void }) {
  const { api } = useSesionTaller();
  const opciones = useLista(() => api.get<OpcionesOrden>('/ordenes-opciones'), [api]);
  const [equipo, setEquipo] = useState<EquipoFila | null>(equipoInicial ?? null);
  const [contadores, setContadores] = useState<ContadorEquipo[]>([]);
  const [tipoId, setTipoId] = useState('');
  const [prioridad, setPrioridad] = useState('media');
  const [descripcion, setDescripcion] = useState('');
  const [responsable, setResponsable] = useState('');
  const [entrega, setEntrega] = useState('');
  const [contadorId, setContadorId] = useState('');
  const [lectura, setLectura] = useState('');
  const [error, setError] = useState('');
  const [avisos, setAvisos] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    setContadores([]);
    setContadorId('');
    setLectura('');
    if (!equipo) return;
    api.get<{ contadores: ContadorEquipo[] }>(`/equipos/${equipo.id}`).then((d) => {
      const lecturables = d.contadores.filter((c) => !c.es_calendario);
      setContadores(lecturables);
      if (lecturables.length === 1) setContadorId(String(lecturables[0]?.id));
    }).catch(() => undefined);
  }, [api, equipo]);

  const tipo = opciones.datos?.tipos_orden.find((t) => String(t.id) === tipoId) ?? opciones.datos?.tipos_orden.find((t) => t.es_default === 1);
  const sinEquipoPresente = tipo?.es_pedido_especial === 1;
  const medidor = contadores.find((c) => String(c.id) === contadorId);

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!equipo) return setError('Elija el equipo que se recibe.');
    setError('');
    setEnviando(true);
    try {
      const r = await api.post<{ orden: { id: number }; avisos: Array<{ tipo: string; numero: string }> }>('/ordenes', {
        equipo_id: equipo.id,
        ...(tipoId ? { tipo_orden_id: Number(tipoId) } : {}),
        prioridad,
        descripcion: descripcion.trim() || null,
        responsable_id: responsable ? Number(responsable) : null,
        fecha_estimada_entrega: entrega || null,
        ...(!sinEquipoPresente && contadorId && lectura.trim() !== '' ? { lectura: { contador_id: Number(contadorId), valor: Number(lectura) } } : {}),
      });
      const abierta = r.avisos.find((a) => a.tipo === 'orden_abierta');
      if (abierta) setAvisos(`Este equipo ya tenía abierta la orden ${abierta.numero}.`);
      alCrear(r.orden.id);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo crear la orden'));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal onClose={alCerrar} title="Nueva orden de trabajo" size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error || opciones.error} tipo="error" />
        <Aviso mensaje={avisos} tipo="ok" />
        <Campo etiqueta="Equipo que se recibe"><BuscadorEquipo valor={equipo} alCambiar={setEquipo} /></Campo>
        {equipo?.estado === 'fuera_de_servicio' && <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">Este equipo está marcado como fuera de servicio; la orden se puede abrir igual.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tipo de orden">
            <select className={CLASE_INPUT} value={tipoId} onChange={(e) => setTipoId(e.target.value)}>
              <option value="">{opciones.datos?.tipos_orden.find((t) => t.es_default === 1)?.nombre ?? 'Por defecto'} (por defecto)</option>
              {(opciones.datos?.tipos_orden ?? []).filter((t) => t.es_default !== 1).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Prioridad">
            <select className={CLASE_INPUT} value={prioridad} onChange={(e) => setPrioridad(e.target.value)}>
              <option value="baja">Baja</option><option value="media">Media</option><option value="alta">Alta</option><option value="urgente">Urgente</option>
            </select>
          </Campo>
          <Campo etiqueta="Responsable de la orden">
            <select className={CLASE_INPUT} value={responsable} onChange={(e) => setResponsable(e.target.value)}>
              <option value="">Sin asignar</option>
              {(opciones.datos?.responsables ?? []).map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Entrega estimada"><FechaInput value={entrega} onChange={(e) => setEntrega(e.target.value)} className={CLASE_INPUT} /></Campo>
        </div>
        <Campo etiqueta="¿Qué se pide o qué falla tiene?"><textarea className={CLASE_INPUT} rows={3} maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Campo>
        {sinEquipoPresente ? (
          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">Este tipo de orden nace sin el equipo presente (por ejemplo, un repuesto que llega antes que el equipo): no se anota lectura ni entrada.</p>
        ) : (
          contadores.length > 0 && (
            <div className="grid gap-3 rounded-md border border-gray-200 p-3 sm:grid-cols-2">
              <Campo etiqueta="Medidor que se lee al recibirlo">
                <select className={CLASE_INPUT} value={contadorId} onChange={(e) => setContadorId(e.target.value)}>
                  <option value="">No anotar lectura</option>
                  {contadores.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </Campo>
              <Campo etiqueta={`Lectura${medidor ? ` (hoy: ${medidor.valor_actual} ${medidor.unidad})` : ''}`} ayuda="Un medidor solo avanza: no puede ser menor que la última lectura.">
                <input className={CLASE_INPUT} type="number" min={0} step="any" value={lectura} onChange={(e) => setLectura(e.target.value)} disabled={!contadorId} />
              </Campo>
            </div>
          )
        )}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" disabled={enviando || !equipo}>{enviando ? 'Creando…' : 'Crear orden'}</Button></div>
      </form>
    </Modal>
  );
}
