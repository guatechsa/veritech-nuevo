import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Acciones, BotonAccion } from '../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import { formatFecha } from '../../components/ui-guatech/formatoFecha.js';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { Aviso, Seccion, useLista } from '../componentes/ui';
import { useSesionTaller } from '../Sesion';
import { FichaOrden } from './ordenes/FichaOrden';
import { NuevaOrden } from './ordenes/NuevaOrden';
import { TarifasArea } from './ordenes/TarifasArea';
import { dineroDe, FilaOrden, OpcionesOrden, PRIORIDAD, soloDia } from './ordenes/tipos';

function ListaOrdenes() {
  const { api, tiene, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const [params, setParams] = useSearchParams();
  const [buscar, setBuscar] = useState('');
  const [estado, setEstado] = useState('');
  const [vista, setVista] = useState<'abiertas' | 'cerradas' | 'todas'>('abiertas');
  const [pagina, setPagina] = useState(1);
  const opciones = useLista(() => api.get<OpcionesOrden>('/ordenes-opciones'), [api]);
  const q = new URLSearchParams({
    pagina: String(pagina),
    ...(buscar.trim() ? { buscar: buscar.trim() } : {}),
    ...(estado ? { estado_id: estado } : {}),
    ...(vista === 'abiertas' ? { abiertas: 'true' } : vista === 'cerradas' ? { abiertas: 'false' } : {}),
  });
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: FilaOrden[] }>(`/ordenes?${q.toString()}`), [api, pagina, buscar, estado, vista]);
  const [abierta, setAbierta] = useState<number | 'nueva' | null>(() => {
    const n = Number(params.get('orden'));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  useEffect(() => setPagina(1), [buscar, estado, vista]);
  const cerrar = (): void => {
    setAbierta(null);
    if (params.has('orden')) {
      const p = new URLSearchParams(params);
      p.delete('orden');
      setParams(p, { replace: true });
    }
  };

  const columnas: Array<Columna<FilaOrden>> = [
    { clave: 'numero', etiqueta: 'Orden', valor: (o) => o.numero, render: (o) => <span><span className="block font-medium text-gray-900">{o.numero}</span><span className="block text-xs text-gray-500">{o.tipo}</span></span> },
    { clave: 'equipo', etiqueta: 'Equipo', valor: (o) => o.equipo, render: (o) => <span><span className="block">{o.equipo}</span><span className="block text-xs text-gray-500">{o.cliente ?? 'Del taller'}</span></span> },
    { clave: 'estado', etiqueta: 'Estado', valor: (o) => o.estado, render: (o) => <span className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold text-white" style={{ backgroundColor: o.estado_color }}>{o.estado}</span> },
    { clave: 'prioridad', etiqueta: 'Prioridad', valor: (o) => o.prioridad, render: (o) => <Badge variant={PRIORIDAD[o.prioridad]?.variante ?? 'default'}>{PRIORIDAD[o.prioridad]?.texto ?? o.prioridad}</Badge> },
    { clave: 'responsable', etiqueta: 'Responsable', valor: (o) => o.responsable ?? '', render: (o) => o.responsable ?? '—' },
    { clave: 'entrega', etiqueta: 'Entrega estimada', valor: (o) => soloDia(o.fecha_estimada_entrega), render: (o) => (o.fecha_estimada_entrega ? formatFecha(soloDia(o.fecha_estimada_entrega)) : '—') },
    ...(lista.datos?.registros.some((o) => o.total !== undefined)
      ? [{ clave: 'total', etiqueta: 'Total', valor: (o: FilaOrden) => o.total ?? 0, render: (o: FilaOrden) => dineroDe(moneda, o.total), alinear: 'right' as const }]
      : []),
    { clave: 'acc', etiqueta: 'Acciones', render: (o) => <Acciones><BotonAccion onClick={() => setAbierta(o.id)}>Abrir</BotonAccion></Acciones> },
  ];
  const paginas = lista.datos ? Math.max(1, Math.ceil(lista.datos.total / lista.datos.porPagina)) : 1;
  return (
    <Seccion titulo="Órdenes de trabajo" acciones={tiene('ordenes.crear') && <Button onClick={() => setAbierta('nueva')}>Nueva orden</Button>}>
      <div className="flex flex-wrap gap-3">
        <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por número, placa, código, serie o cliente" aria-label="Buscar órdenes" data-no-uppercase="true" className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <select value={vista} onChange={(e) => setVista(e.target.value as typeof vista)} aria-label="Cuáles órdenes" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="abiertas">Abiertas</option>
          <option value="cerradas">Cerradas y anuladas</option>
          <option value="todas">Todas</option>
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="">Todos los estados</option>
          {(opciones.datos?.estados ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      </div>
      <Aviso mensaje={lista.error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(o) => o.id} vacio={lista.datos ? 'No hay órdenes con ese filtro.' : 'Cargando…'} />
      {lista.datos && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{lista.datos.total} órdenes · página {pagina} de {paginas}</span>
          <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button></span>
        </div>
      )}
      {abierta === 'nueva' && <NuevaOrden alCerrar={cerrar} alCrear={(id) => { lista.recargar(); setAbierta(id); }} />}
      {typeof abierta === 'number' && <FichaOrden id={abierta} alCerrar={cerrar} alCambiar={lista.recargar} />}
    </Seccion>
  );
}

export default function Ordenes() {
  const { tiene } = useSesionTaller();
  const [params, setParams] = useSearchParams();
  const pestanas = [
    { k: 'ordenes', t: 'Órdenes', permiso: 'ordenes.ver', vista: () => <ListaOrdenes /> },
    { k: 'tarifas', t: 'Tarifas por área', permiso: 'tarifas.gestionar', vista: () => <TarifasArea /> },
  ].filter((p) => tiene(p.permiso));
  const actual = pestanas.find((p) => p.k === params.get('tab')) ?? pestanas[0];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Órdenes</h1>
      {pestanas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {pestanas.map((p) => <button key={p.k} onClick={() => setParams({ tab: p.k }, { replace: true })} className={`rounded-md border border-gray-200 px-4 py-2 text-sm font-medium ${actual?.k === p.k ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{p.t}</button>)}
        </div>
      )}
      {actual?.vista()}
    </div>
  );
}
