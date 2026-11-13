import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Modal from '../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../componentes/ui';
import { useSesionTaller } from '../Sesion';
import { dineroDe } from './ordenes/tipos';
import { EnviosProgramados } from './reportes/Envios';
import { useFiltros } from './reportes/filtros';
import { ReporteGenerico } from './reportes/Generico';
import { COLOR_SEMAFORO, formatoValor, Indicador } from './reportes/tipos';

interface Rechazos {
  total_lineas: number;
  total_valor?: number;
  por_motivo: Array<{ nombre: string; lineas: number; valor?: number }>;
  por_tipo_equipo: Array<{ nombre: string; lineas: number; valor?: number }>;
  por_cliente: Array<{ nombre: string; lineas: number; valor?: number }>;
  por_item: Array<{ nombre: string; lineas: number; valor?: number }>;
}

// ── Indicadores ───────────────────────────────────────────────────────────────────────
function Meta({ ind, alCerrar, alListo }: { ind: Indicador; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [meta, setMeta] = useState(ind.meta ? String(ind.meta.meta) : '');
  const [limite, setLimite] = useState(ind.meta?.limite != null ? String(ind.meta.limite) : '');
  const [error, setError] = useState('');
  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.put(`/indicadores/metas/${ind.codigo}`, { meta: Number(meta), limite: limite.trim() === '' ? null : Number(limite) });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar la meta'));
    }
  };
  const quitar = async (): Promise<void> => {
    try {
      await api.delete(`/indicadores/metas/${ind.codigo}`);
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo quitar la meta'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={`Meta de «${ind.nombre}»`} size="md">
      <form onSubmit={guardar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">{ind.sentido === 'mayor' ? 'Entre más alto, mejor.' : 'Entre más bajo, mejor.'} Verde si se cumple la meta; amarillo hasta el límite; rojo más allá.</p>
        <Campo etiqueta="Meta (verde)"><input className={`${CLASE_INPUT} max-w-xs`} type="number" step="any" value={meta} onChange={(e) => setMeta(e.target.value)} required autoFocus /></Campo>
        <Campo etiqueta="Límite del amarillo (opcional)" ayuda={ind.sentido === 'mayor' ? 'Un número menor que la meta.' : 'Un número mayor que la meta.'}><input className={`${CLASE_INPUT} max-w-xs`} type="number" step="any" value={limite} onChange={(e) => setLimite(e.target.value)} /></Campo>
        <div className="flex justify-between gap-2 border-t pt-3">
          <span>{ind.meta && <Button variant="outline" onClick={() => void quitar()}>Quitar la meta</Button>}</span>
          <span className="flex gap-2"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></span>
        </div>
      </form>
    </Modal>
  );
}

function Indicadores() {
  const { api, tiene, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const [params] = useSearchParams();
  const { q, barra } = useFiltros('indicadores');
  const lista = useLista(() => api.get<Indicador[]>(`/indicadores?${q}`), [api, q]);
  const [meta, setMeta] = useState<Indicador | null>(null);
  const resaltado = params.get('indicador');
  const columnas: Array<Columna<Indicador>> = [
    {
      clave: 'nombre',
      etiqueta: 'Indicador',
      valor: (i) => i.nombre,
      render: (i) => (
        <span className={i.codigo === resaltado ? 'rounded bg-amber-50 px-1' : ''}>
          <span className="block font-medium text-gray-900">{i.nombre}</span>
          <span className="block text-xs text-gray-500">{i.descripcion}</span>
          <span className="block text-xs font-medium text-gray-400">{i.base}</span>
        </span>
      ),
    },
    {
      clave: 'valor',
      etiqueta: 'Resultado',
      valor: (i) => i.valor ?? -1,
      render: (i) => (
        <span className="flex items-center justify-end gap-2">
          {i.semaforo && <span className={`inline-block h-2.5 w-2.5 rounded-full ${COLOR_SEMAFORO[i.semaforo].punto}`} aria-label={COLOR_SEMAFORO[i.semaforo].texto} />}
          <span className="text-lg font-bold text-gray-900">{formatoValor(i.unidad, i.valor, moneda)}</span>
        </span>
      ),
      alinear: 'right',
    },
    {
      clave: 'detalle',
      etiqueta: 'Detalle',
      render: (i) => (i.detalle ? <span className="text-xs text-gray-600">{Object.entries(i.detalle).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${k.includes('ventas') || k === 'costo' || k === 'cotizado' || k === 'autorizado' ? dineroDe(moneda, v) : v}`).join(' · ')}</span> : '—'),
    },
    { clave: 'meta', etiqueta: 'Meta', render: (i) => (i.meta ? <span>{formatoValor(i.unidad, i.meta.meta, moneda)}{i.meta.limite != null ? <span className="block text-xs text-gray-500">amarillo hasta {formatoValor(i.unidad, i.meta.limite, moneda)}</span> : null}</span> : <span className="text-gray-400">Sin meta</span>) },
    ...(tiene('reportes.configurar') ? [{ clave: 'acc', etiqueta: 'Acciones', render: (i: Indicador) => <Button size="sm" variant="outline" onClick={() => setMeta(i)}>{i.meta ? 'Cambiar meta' : 'Poner meta'}</Button> }] : []),
  ];
  return (
    <Seccion titulo="Indicadores">
      <p className="text-sm text-gray-700">Cada indicador dice en qué fecha se cuenta: el dinero y las entregas, por la fecha en que se cerró la orden; la carga de trabajo, por la fecha en que se pidió o se hizo. Las fechas son las del taller.</p>
      {barra}
      <Aviso mensaje={lista.error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(i) => i.codigo} vacio={lista.datos ? 'No hay indicadores.' : 'Calculando…'} />
      {!tiene('reportes.financieros') && <p className="text-xs text-gray-500">Los indicadores con dinero (ticket promedio, margen y valor autorizado) solo los ve quien tiene el permiso de reportes financieros.</p>}
      {meta && <Meta ind={meta} alCerrar={() => setMeta(null)} alListo={() => { setMeta(null); lista.recargar(); }} />}
    </Seccion>
  );
}

// ── Rechazos ──────────────────────────────────────────────────────────────────────────
function ListaCorte({ titulo, filas, moneda, conDinero }: { titulo: string; filas: Rechazos['por_motivo']; moneda: string; conDinero: boolean }) {
  const columnas: Array<Columna<Rechazos['por_motivo'][number]>> = [
    { clave: 'nombre', etiqueta: titulo, valor: (f) => f.nombre },
    { clave: 'lineas', etiqueta: 'Líneas', valor: (f) => f.lineas, alinear: 'right' },
    ...(conDinero ? [{ clave: 'valor', etiqueta: 'Valor', valor: (f: Rechazos['por_motivo'][number]) => f.valor ?? 0, render: (f: Rechazos['por_motivo'][number]) => dineroDe(moneda, f.valor ?? 0), alinear: 'right' as const }] : []),
  ];
  return <Tabla columnas={columnas} filas={filas} clave={(f) => f.nombre} vacio="Sin rechazos en este periodo." />;
}

function MotivosDeRechazo() {
  const { api, tiene, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const { q, barra } = useFiltros('rechazos');
  const datos = useLista(() => api.get<Rechazos>(`/reportes/rechazos?${q}`), [api, q]);
  const conDinero = tiene('reportes.financieros');
  const d = datos.datos;
  return (
    <Seccion titulo="Motivos de rechazo de las cotizaciones">
      <p className="text-sm text-gray-700">Por qué el cliente no autoriza lo que se le cotiza, de las líneas rechazadas en el periodo (por fecha de la respuesta).</p>
      {barra}
      <Aviso mensaje={datos.error} tipo="error" />
      {d && (
        <>
          <p className="text-sm font-medium text-gray-900">{d.total_lineas} {d.total_lineas === 1 ? 'línea rechazada' : 'líneas rechazadas'}{d.total_valor !== undefined ? ` · ${dineroDe(moneda, d.total_valor)}` : ''}</p>
          <div className="grid gap-4 lg:grid-cols-2">
            <div><h3 className="mb-1 text-sm font-bold text-gray-900">Por motivo</h3><ListaCorte titulo="Motivo" filas={d.por_motivo} moneda={moneda} conDinero={conDinero} /></div>
            <div><h3 className="mb-1 text-sm font-bold text-gray-900">Por tipo de equipo</h3><ListaCorte titulo="Tipo de equipo" filas={d.por_tipo_equipo} moneda={moneda} conDinero={conDinero} /></div>
            <div><h3 className="mb-1 text-sm font-bold text-gray-900">Por cliente</h3><ListaCorte titulo="Cliente" filas={d.por_cliente} moneda={moneda} conDinero={conDinero} /></div>
            <div><h3 className="mb-1 text-sm font-bold text-gray-900">Por ítem del checklist</h3><ListaCorte titulo="Ítem" filas={d.por_item} moneda={moneda} conDinero={conDinero} /></div>
          </div>
        </>
      )}
    </Seccion>
  );
}

// ── Tablero por rol ───────────────────────────────────────────────────────────────────
interface ConfigTablero {
  roles: Array<{ id: number; codigo: string; nombre: string; personalizado: boolean; tarjetas: string[] }>;
  catalogo: Array<{ codigo: string; titulo: string; tipo: string; permiso: string; ayuda: string }>;
}

function TableroPorRol() {
  const { api } = useSesionTaller();
  const cfg = useLista(() => api.get<ConfigTablero>('/tablero/config'), [api]);
  const [elegidas, setElegidas] = useState<Record<number, string[]>>({});
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (cfg.datos) setElegidas(Object.fromEntries(cfg.datos.roles.map((r) => [r.id, r.tarjetas])));
  }, [cfg.datos]);
  const alternar = (rol: number, codigo: string): void => setElegidas((x) => ({ ...x, [rol]: (x[rol] ?? []).includes(codigo) ? (x[rol] ?? []).filter((c) => c !== codigo) : [...(x[rol] ?? []), codigo] }));
  const guardar = async (rol: number): Promise<void> => {
    setError('');
    setMensaje('');
    try {
      await api.put(`/tablero/config/${rol}`, { tarjetas: elegidas[rol] ?? [] });
      setMensaje('Tablero guardado.');
      cfg.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar'));
    }
  };
  const restablecer = async (rol: number): Promise<void> => {
    setError('');
    setMensaje('');
    try {
      await api.delete(`/tablero/config/${rol}`);
      setMensaje('Se volvió a las tarjetas sugeridas.');
      cfg.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo restablecer'));
    }
  };
  return (
    <Seccion titulo="Tablero de inicio por rol">
      <p className="text-sm text-gray-700">Elija qué tarjetas ve cada rol al entrar. Una tarjeta solo aparece si la persona tiene el permiso de lo que cuenta (el dinero, solo con el permiso de reportes financieros).</p>
      <Aviso mensaje={error || cfg.error} tipo="error" />
      <Aviso mensaje={mensaje} tipo="ok" />
      {(cfg.datos?.roles ?? []).map((r) => (
        <section key={r.id} className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-gray-900">{r.nombre} {r.personalizado ? <Badge variant="info">Personalizado</Badge> : <Badge variant="default">Sugerido</Badge>}</h3>
            <span className="flex gap-2">{r.personalizado && <Button size="sm" variant="outline" onClick={() => void restablecer(r.id)}>Volver a lo sugerido</Button>}<Button size="sm" onClick={() => void guardar(r.id)}>Guardar</Button></span>
          </div>
          <div className="grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
            {(cfg.datos?.catalogo ?? []).map((c) => (
              <label key={c.codigo} className="flex items-start gap-2 text-sm" title={c.ayuda}>
                <input type="checkbox" className="mt-1" checked={(elegidas[r.id] ?? []).includes(c.codigo)} onChange={() => alternar(r.id, c.codigo)} />
                <span>{c.titulo}</span>
              </label>
            ))}
          </div>
        </section>
      ))}
    </Seccion>
  );
}

// ── La pantalla ───────────────────────────────────────────────────────────────────────
export default function Reportes() {
  const { tiene } = useSesionTaller();
  const [params, setParams] = useSearchParams();
  const pestanas = [
    { k: 'indicadores', t: 'Indicadores', permiso: 'reportes.ver', vista: () => <Indicadores /> },
    { k: 'rechazos', t: 'Motivos de rechazo', permiso: 'reportes.ver', vista: () => <MotivosDeRechazo /> },
    { k: 'carga', t: 'Carga de trabajo', permiso: 'reportes.ver', vista: () => <ReporteGenerico codigo="carga" titulo="Carga de trabajo" ayuda="Lo que hizo cada técnico en el periodo, lo que está pendiente hoy y las citas de los próximos 7 días." /> },
    { k: 'compras', t: 'Compras', permiso: 'reportes.financieros', vista: () => <ReporteGenerico codigo="compras" titulo="Compras de material" ayuda="Lo comprado por proveedor y los materiales más comprados, por la fecha del documento." sinTipoDeEquipo /> },
    { k: 'envios', t: 'Envíos programados', permiso: 'reportes.programar', vista: () => <EnviosProgramados /> },
    { k: 'tablero', t: 'Tablero por rol', permiso: 'reportes.configurar', vista: () => <TableroPorRol /> },
  ].filter((p) => tiene(p.permiso));
  const actual = pestanas.find((p) => p.k === params.get('tab')) ?? pestanas[0];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Reportes</h1>
      {pestanas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {pestanas.map((p) => <button key={p.k} onClick={() => setParams({ tab: p.k }, { replace: true })} className={`rounded-md border border-gray-200 px-4 py-2 text-sm font-medium ${actual?.k === p.k ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{p.t}</button>)}
        </div>
      )}
      {actual?.vista()}
    </div>
  );
}
