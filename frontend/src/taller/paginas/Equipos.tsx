import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Acciones, BotonAccion } from '../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { Aviso, Seccion, useLista } from '../componentes/ui';
import { useSesionTaller } from '../Sesion';
import { FichaEquipo } from './equipos/FichaEquipo';
import { CatalogosDeEquipos, TiposEquipo } from './equipos/TiposEquipo';
import { ESTADO_EQUIPO, FilaEquipo, TipoEquipo } from './equipos/tipos';

function ListaEquipos() {
  const { api, tiene } = useSesionTaller();
  const [params, setParams] = useSearchParams();
  const [buscar, setBuscar] = useState('');
  const [tipo, setTipo] = useState('');
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(1);
  const tipos = useLista(() => api.get<TipoEquipo[]>('/tipos-equipo'), [api]);
  const q = new URLSearchParams({ pagina: String(pagina), ...(buscar.trim() ? { buscar: buscar.trim() } : {}), ...(tipo ? { tipo_equipo_id: tipo } : {}), ...(estado ? { estado } : {}) });
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: FilaEquipo[] }>(`/equipos?${q.toString()}`), [api, pagina, buscar, tipo, estado]);
  const [abierto, setAbierto] = useState<number | 'nuevo' | null>(() => {
    const n = Number(params.get('equipo'));
    return Number.isInteger(n) && n > 0 ? n : null;
  });
  useEffect(() => setPagina(1), [buscar, tipo, estado]);
  const cerrar = (): void => {
    setAbierto(null);
    if (params.has('equipo')) {
      const p = new URLSearchParams(params);
      p.delete('equipo');
      setParams(p, { replace: true });
    }
  };

  const columnas: Array<Columna<FilaEquipo>> = [
    { clave: 'equipo', etiqueta: 'Equipo', valor: (e) => e.descripcion, render: (e) => <span><span className="block font-medium text-gray-900">{e.descripcion}</span><span className="block text-xs text-gray-500">{e.tipo_equipo}{e.serie ? ` · Serie ${e.serie}` : ''}</span></span> },
    { clave: 'cliente', etiqueta: 'Cliente', valor: (e) => e.cliente ?? '', render: (e) => e.cliente ?? 'Del taller' },
    { clave: 'contador', etiqueta: 'Contador', valor: (e) => e.contador_principal ?? '', render: (e) => e.contador_principal ?? '—', alinear: 'right' },
    { clave: 'estado', etiqueta: 'Estado', valor: (e) => e.estado, render: (e) => <Badge variant={ESTADO_EQUIPO[e.estado].variante}>{ESTADO_EQUIPO[e.estado].texto}</Badge> },
    { clave: 'acc', etiqueta: 'Acciones', render: (e) => <Acciones><BotonAccion onClick={() => setAbierto(e.id)}>{tiene('equipos.editar') ? 'Abrir' : 'Ver'}</BotonAccion></Acciones> },
  ];
  const paginas = lista.datos ? Math.max(1, Math.ceil(lista.datos.total / lista.datos.porPagina)) : 1;
  return (
    <Seccion titulo="Equipos" acciones={tiene('equipos.crear') && <Button onClick={() => setAbierto('nuevo')}>Nuevo equipo</Button>}>
      <div className="flex flex-wrap gap-3">
        <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por código, placa, serie, modelo o cliente" aria-label="Buscar equipos" data-no-uppercase="true" className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de equipo" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="">Todos los tipos</option>
          {(tipos.datos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
        <select value={estado} onChange={(e) => setEstado(e.target.value)} aria-label="Estado" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="">Activos y fuera de servicio</option>
          <option value="activo">Solo activos</option>
          <option value="fuera_de_servicio">Fuera de servicio</option>
          <option value="baja">De baja</option>
        </select>
      </div>
      <Aviso mensaje={lista.error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(e) => e.id} vacio={lista.datos ? 'No hay equipos con ese filtro.' : 'Cargando…'} />
      {lista.datos && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{lista.datos.total} equipos · página {pagina} de {paginas}</span>
          <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button></span>
        </div>
      )}
      {abierto !== null && <FichaEquipo inicial={abierto} alCerrar={cerrar} alCambiar={lista.recargar} pestanaInicial={params.get('tab') === 'servicios' ? 'servicios' : undefined} />}
    </Seccion>
  );
}

export default function Equipos() {
  const { tiene } = useSesionTaller();
  const [params, setParams] = useSearchParams();
  const pestanas = [
    { k: 'equipos', t: 'Equipos', permiso: 'equipos.ver', vista: () => <ListaEquipos /> },
    { k: 'tipos', t: 'Tipos de equipo', permiso: 'tipos_equipo.ver', vista: () => <TiposEquipo /> },
    { k: 'catalogos', t: 'Contadores y documentos', permiso: 'tipos_equipo.ver', vista: () => <CatalogosDeEquipos /> },
  ].filter((p) => tiene(p.permiso));
  const actual = pestanas.find((p) => p.k === params.get('tab')) ?? pestanas[0];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Equipos</h1>
      <div className="flex flex-wrap gap-2">
        {pestanas.map((p) => <button key={p.k} onClick={() => setParams({ tab: p.k }, { replace: true })} className={`rounded-md border border-gray-200 px-4 py-2 text-sm font-medium ${actual?.k === p.k ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{p.t}</button>)}
      </div>
      {actual?.vista()}
    </div>
  );
}
