import { useState } from 'react';
import Button from '../../../components/ui-guatech/Button.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, useLista } from '../../componentes/ui';
import { guardarComoArchivo } from '../../componentes/descarga';
import { useSesionTaller } from '../../Sesion';

export type Periodo = 'hoy' | 'ultimos_7' | 'ultimos_30' | 'este_mes' | 'mes_anterior' | 'personalizado';

/** Los filtros como se guardan en una vista: el periodo es relativo («este mes» siempre es el mes en curso). */
export interface FiltrosVista {
  periodo: Periodo;
  desde?: string;
  hasta?: string;
  sucursal_id?: number;
  tipo_equipo_id?: number;
}

interface Vista {
  id: number;
  nombre: string;
  filtros: FiltrosVista;
}

export const PERIODOS: Array<{ k: Exclude<Periodo, 'personalizado'>; t: string }> = [
  { k: 'hoy', t: 'Hoy' },
  { k: 'ultimos_7', t: 'Últimos 7 días' },
  { k: 'ultimos_30', t: 'Últimos 30 días' },
  { k: 'este_mes', t: 'Este mes' },
  { k: 'mes_anterior', t: 'Mes anterior' },
];

const dos = (n: number): string => String(n).padStart(2, '0');
const iso = (d: Date): string => `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
const diasAntes = (n: number): Date => new Date(Date.now() - n * 86400000);

export function rangoDe(p: Exclude<Periodo, 'personalizado'>): { desde: string; hasta: string } {
  const h = new Date();
  switch (p) {
    case 'hoy':
      return { desde: iso(h), hasta: iso(h) };
    case 'ultimos_7':
      return { desde: iso(diasAntes(6)), hasta: iso(h) };
    case 'ultimos_30':
      return { desde: iso(diasAntes(29)), hasta: iso(h) };
    case 'este_mes':
      return { desde: iso(new Date(h.getFullYear(), h.getMonth(), 1)), hasta: iso(h) };
    case 'mes_anterior':
      return { desde: iso(new Date(h.getFullYear(), h.getMonth() - 1, 1)), hasta: iso(new Date(h.getFullYear(), h.getMonth(), 0)) };
  }
}

function BarraDeReporte({ reporte, filtros, rango, alAplicar }: { reporte: string; filtros: FiltrosVista; rango: { desde: string; hasta: string }; alAplicar: (f: FiltrosVista) => void }) {
  const { api, tiene } = useSesionTaller();
  const vistas = useLista(() => api.get<Vista[]>(`/vistas?reporte=${reporte}`), [api, reporte]);
  const [elegida, setElegida] = useState('');
  const [nombre, setNombre] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [bajando, setBajando] = useState<'xlsx' | 'pdf' | null>(null);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');

  const bajar = async (formato: 'xlsx' | 'pdf'): Promise<void> => {
    setError('');
    setMensaje('');
    setBajando(formato);
    try {
      const q = new URLSearchParams({ formato, periodo: 'personalizado', desde: rango.desde, hasta: rango.hasta, ...(filtros.sucursal_id ? { sucursal_id: String(filtros.sucursal_id) } : {}), ...(filtros.tipo_equipo_id ? { tipo_equipo_id: String(filtros.tipo_equipo_id) } : {}) });
      const r = await api.descargar(`/reporte/${reporte}/exportar?${q.toString()}`);
      guardarComoArchivo(r.blob, r.nombre);
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo descargar el reporte'));
    } finally {
      setBajando(null);
    }
  };

  const guardar = async (): Promise<void> => {
    setError('');
    setMensaje('');
    try {
      await api.post('/vistas', { reporte, nombre: nombre.trim(), filtros });
      setNombre('');
      setGuardando(false);
      setMensaje('Vista guardada.');
      vistas.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar la vista'));
    }
  };

  const quitar = async (): Promise<void> => {
    setError('');
    setMensaje('');
    try {
      await api.delete(`/vistas/${elegida}`);
      setElegida('');
      setMensaje('Vista eliminada.');
      vistas.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo eliminar la vista'));
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Campo etiqueta="Mis vistas">
            <select
              className={`${CLASE_INPUT} w-52`}
              value={elegida}
              onChange={(e) => {
                setElegida(e.target.value);
                const v = (vistas.datos ?? []).find((x) => String(x.id) === e.target.value);
                if (v) alAplicar(v.filtros);
              }}
            >
              <option value="">— Elegir una vista —</option>
              {(vistas.datos ?? []).map((v) => <option key={v.id} value={v.id}>{v.nombre}</option>)}
            </select>
          </Campo>
          {elegida && <Button size="sm" variant="outline" onClick={() => void quitar()}>Eliminar vista</Button>}
          {!guardando && <Button size="sm" variant="outline" onClick={() => setGuardando(true)}>Guardar esta vista</Button>}
          {guardando && (
            <span className="flex items-end gap-2">
              <Campo etiqueta="Nombre de la vista"><input className={`${CLASE_INPUT} w-52`} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} autoFocus /></Campo>
              <Button size="sm" disabled={nombre.trim().length < 2} onClick={() => void guardar()}>Guardar</Button>
              <Button size="sm" variant="outline" onClick={() => setGuardando(false)}>Cancelar</Button>
            </span>
          )}
        </div>
        {tiene('reportes.exportar') && (
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={bajando !== null} onClick={() => void bajar('xlsx')}>{bajando === 'xlsx' ? 'Preparando…' : 'Descargar Excel'}</Button>
            <Button size="sm" variant="outline" disabled={bajando !== null} onClick={() => void bajar('pdf')}>{bajando === 'pdf' ? 'Preparando…' : 'Descargar PDF'}</Button>
          </span>
        )}
      </div>
      <Aviso mensaje={error || vistas.error} tipo="error" />
      <Aviso mensaje={mensaje} tipo="ok" />
    </div>
  );
}

/**
 * Los filtros de todos los reportes: periodo (relativo o por fechas), sucursal y tipo de equipo, con las vistas guardadas y la descarga.
 * `q` sirve para las pantallas que piden por fechas; `filtros` es lo que se guarda en una vista.
 */
export function useFiltros(reporte: string, opciones: { tipoDeEquipo?: boolean } = {}) {
  const { api } = useSesionTaller();
  const [periodo, setPeriodo] = useState<Periodo>('este_mes');
  const [manual, setManual] = useState(() => rangoDe('este_mes'));
  const [sucursal, setSucursal] = useState('');
  const [tipo, setTipo] = useState('');
  const sucursales = useLista(() => api.get<Array<{ id: number; nombre: string }>>('/sucursales'), [api]);
  const tipos = useLista(() => api.get<Array<{ id: number; nombre: string }>>('/tipos-equipo'), [api]);
  const rango = periodo === 'personalizado' ? manual : rangoDe(periodo);
  const filtros: FiltrosVista = {
    periodo,
    ...(periodo === 'personalizado' ? { desde: manual.desde, hasta: manual.hasta } : {}),
    ...(sucursal ? { sucursal_id: Number(sucursal) } : {}),
    ...(tipo && opciones.tipoDeEquipo !== false ? { tipo_equipo_id: Number(tipo) } : {}),
  };
  const q = new URLSearchParams({ desde: rango.desde, hasta: rango.hasta, ...(sucursal ? { sucursal_id: sucursal } : {}), ...(tipo && opciones.tipoDeEquipo !== false ? { tipo_equipo_id: tipo } : {}) }).toString();
  const aplicar = (f: FiltrosVista): void => {
    setPeriodo(f.periodo);
    if (f.desde && f.hasta) setManual({ desde: f.desde, hasta: f.hasta });
    setSucursal(f.sucursal_id ? String(f.sucursal_id) : '');
    setTipo(f.tipo_equipo_id ? String(f.tipo_equipo_id) : '');
  };
  const barra = (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <Campo etiqueta="Desde"><FechaInput value={rango.desde} onChange={(e) => { setManual({ desde: e.target.value, hasta: rango.hasta }); setPeriodo('personalizado'); }} className={`${CLASE_INPUT} w-40`} /></Campo>
        <Campo etiqueta="Hasta"><FechaInput value={rango.hasta} onChange={(e) => { setManual({ desde: rango.desde, hasta: e.target.value }); setPeriodo('personalizado'); }} className={`${CLASE_INPUT} w-40`} /></Campo>
        <span className="flex flex-wrap gap-2 pb-1">
          {PERIODOS.map((p) => (
            <Button key={p.k} size="sm" variant={periodo === p.k ? 'primary' : 'outline'} onClick={() => setPeriodo(p.k)}>{p.t}</Button>
          ))}
        </span>
        <Campo etiqueta="Sucursal"><select className={`${CLASE_INPUT} w-44`} value={sucursal} onChange={(e) => setSucursal(e.target.value)}><option value="">Todas</option>{(sucursales.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></Campo>
        {opciones.tipoDeEquipo !== false && (
          <Campo etiqueta="Tipo de equipo"><select className={`${CLASE_INPUT} w-44`} value={tipo} onChange={(e) => setTipo(e.target.value)}><option value="">Todos</option>{(tipos.datos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
        )}
      </div>
      <BarraDeReporte reporte={reporte} filtros={filtros} rango={rango} alAplicar={aplicar} />
    </div>
  );
  return { q, barra, rango, filtros };
}
