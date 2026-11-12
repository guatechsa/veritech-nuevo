import { FormEvent, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Modal from '../../components/ui-guatech/Modal.jsx';
import { formatFecha } from '../../components/ui-guatech/formatoFecha.js';
import { Acciones, BotonAccion } from '../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../componentes/ui';
import { useUbicacion } from '../contexto';
import { useSesionTaller } from '../Sesion';
import { ESTADO_SERVICIO, Programa, ServicioDeEquipo, textoRestante } from './servicios/tipos';

// ── Lo que hay que atender ────────────────────────────────────────────────────────────
function PorVencer() {
  const { api, tiene } = useSesionTaller();
  const { base } = useUbicacion();
  const navegar = useNavigate();
  const [vista, setVista] = useState<'atender' | 'todos' | 'vencido' | 'urgente' | 'proximo' | 'al_dia'>('atender');
  const [tipoEquipo, setTipoEquipo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const tipos = useLista(() => api.get<Array<{ id: number; nombre: string }>>('/tipos-equipo'), [api]);
  const q = new URLSearchParams({ ...(tipoEquipo ? { tipo_equipo_id: tipoEquipo } : {}), ...(vista !== 'atender' && vista !== 'todos' ? { estado: vista } : {}) });
  const lista = useLista(() => api.get<ServicioDeEquipo[]>(`/servicios?${q.toString()}`), [api, vista, tipoEquipo]);
  const filas = (lista.datos ?? []).filter((s) => (vista === 'atender' ? s.estado === 'vencido' || s.estado === 'urgente' || s.estado === 'proximo' : true));

  const revisar = async (): Promise<void> => {
    setError('');
    setMensaje('');
    try {
      const r = await api.post<{ avisos_nuevos: unknown[]; pendientes: number }>('/servicios/revisar-avisos', {});
      setMensaje(`Revisión hecha: ${r.avisos_nuevos.length} avisos nuevos; ${r.pendientes} servicios por atender.`);
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo revisar'));
    }
  };
  const columnas: Array<Columna<ServicioDeEquipo>> = [
    { clave: 'equipo', etiqueta: 'Equipo', valor: (s) => s.equipo, render: (s) => <span><span className="block font-medium text-gray-900">{s.equipo}</span><span className="block text-xs text-gray-500">{s.cliente ?? 'Del taller'}</span></span> },
    { clave: 'servicio', etiqueta: 'Servicio', valor: (s) => s.servicio },
    { clave: 'estado', etiqueta: 'Estado', valor: (s) => s.estado, render: (s) => <Badge variant={ESTADO_SERVICIO[s.estado].variante}>{ESTADO_SERVICIO[s.estado].texto}</Badge> },
    { clave: 'restante', etiqueta: 'Cuánto falta', valor: (s) => s.restante ?? 1e12, render: (s) => textoRestante(s), alinear: 'right' },
    { clave: 'fecha', etiqueta: 'Fecha estimada', valor: (s) => s.fecha_estimada ?? '', render: (s) => (s.fecha_estimada ? formatFecha(s.fecha_estimada) : '—') },
    {
      clave: 'acc',
      etiqueta: 'Acciones',
      render: (s) => (
        <Acciones>
          {tiene('citas.gestionar') && s.estado !== 'sin_contador' && <BotonAccion onClick={() => navegar(`${base}/citas?nueva=${s.equipo_id}&servicio=${s.servicio_id}`)}>Agendar cita</BotonAccion>}
          <BotonAccion onClick={() => navegar(`${base}/equipos?equipo=${s.equipo_id}&tab=servicios`)}>Ver equipo</BotonAccion>
        </Acciones>
      ),
    },
  ];
  return (
    <Seccion titulo="Servicios por atender" acciones={tiene('servicios.gestionar') && <Button variant="outline" onClick={() => void revisar()}>Revisar avisos</Button>}>
      <p className="text-sm text-gray-700">Cada servicio tiene su propio reloj sobre el contador del equipo. La fecha estimada sale del ritmo de uso de los últimos 90 días; si todavía no hay lecturas suficientes, no se puede estimar.</p>
      <div className="flex flex-wrap gap-3">
        <select value={vista} onChange={(e) => setVista(e.target.value as typeof vista)} aria-label="Cuáles servicios" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="atender">Por atender (vencidos, urgentes y próximos)</option><option value="vencido">Solo vencidos</option><option value="urgente">Solo urgentes</option><option value="proximo">Solo próximos</option><option value="al_dia">Al día</option><option value="todos">Todos</option>
        </select>
        <select value={tipoEquipo} onChange={(e) => setTipoEquipo(e.target.value)} aria-label="Tipo de equipo" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="">Todos los tipos de equipo</option>{(tipos.datos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
        </select>
      </div>
      <Aviso mensaje={error || lista.error} tipo="error" />
      <Aviso mensaje={mensaje} tipo="ok" />
      <Tabla columnas={columnas} filas={filas} clave={(s) => `${s.equipo_id}-${s.servicio_id}`} vacio={lista.datos ? 'No hay servicios en esa lista. Si esperaba verlos, defina los servicios de cada tipo de equipo en «Programas».' : 'Cargando…'} />
    </Seccion>
  );
}

// ── Los programas (configuración) ─────────────────────────────────────────────────────
function FormPrograma({ programa, alCerrar, alListo }: { programa?: Programa; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const tipos = useLista(() => api.get<Array<{ id: number; nombre: string }>>('/tipos-equipo'), [api]);
  const contadores = useLista(() => api.get<Array<{ id: number; nombre: string; es_calendario: number; activo: number }>>('/tipos-contador'), [api]);
  const checklists = useLista(() => api.get<Array<{ id: number; nombre: string }>>('/checklists-tipos'), [api]);
  const [tipoEquipo, setTipoEquipo] = useState(programa ? String(programa.tipo_equipo_id) : '');
  const [contador, setContador] = useState(programa ? String(programa.tipo_contador_id) : '');
  const [checklist, setChecklist] = useState(programa?.checklist_tipo_id ? String(programa.checklist_tipo_id) : '');
  const [nombre, setNombre] = useState(programa?.nombre ?? '');
  const [intervalo, setIntervalo] = useState(programa ? String(programa.intervalo) : '');
  const [proximo, setProximo] = useState(programa ? String(programa.aviso_proximo) : '');
  const [urgente, setUrgente] = useState(programa ? String(programa.aviso_urgente) : '');
  const [activo, setActivo] = useState(programa ? programa.activo === 1 : true);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<Array<{ id: number; codigo: string; nombre: string }>>([]);
  const [trabajo, setTrabajo] = useState<{ id: number; nombre: string; codigo: string } | null>(programa ? { id: 0, nombre: programa.trabajo, codigo: programa.trabajo_codigo } : null);
  const [error, setError] = useState('');
  useEffect(() => {
    if (texto.trim().length < 2) return setResultados([]);
    const espera = setTimeout(() => api.get<{ registros: Array<{ id: number; codigo: string; nombre: string }> }>(`/catalogos/trabajos?buscar=${encodeURIComponent(texto.trim())}`).then((r) => setResultados(r.registros.slice(0, 8))).catch(() => setResultados([])), 250);
    return () => clearTimeout(espera);
  }, [api, texto]);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      const comunes = { nombre: nombre.trim() || undefined, checklist_tipo_id: checklist ? Number(checklist) : null, intervalo: Number(intervalo), ...(proximo ? { aviso_proximo: Number(proximo) } : {}), ...(urgente ? { aviso_urgente: Number(urgente) } : {}) };
      if (programa) await api.patch(`/servicios-programas/${programa.id}`, { ...comunes, activo });
      else await api.post('/servicios-programas', { ...comunes, tipo_equipo_id: Number(tipoEquipo), trabajo_id: trabajo?.id, tipo_contador_id: Number(contador) });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  const unidad = contadores.datos?.find((c) => String(c.id) === contador);
  return (
    <Modal onClose={alCerrar} title={programa ? `Servicio ${programa.nombre}` : 'Nuevo servicio programado'} size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Tipo de equipo"><select className={CLASE_INPUT} value={tipoEquipo} onChange={(e) => setTipoEquipo(e.target.value)} disabled={!!programa} required><option value="">Elija…</option>{(tipos.datos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Contador con el que corre" ayuda="Odómetro, horómetro o calendario (días)."><select className={CLASE_INPUT} value={contador} onChange={(e) => setContador(e.target.value)} disabled={!!programa} required><option value="">Elija…</option>{(contadores.datos ?? []).filter((c) => c.activo === 1).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        </div>
        <Campo etiqueta="Trabajo del catálogo">
          {trabajo ? (
            <div className="flex items-center justify-between gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"><span><span className="font-medium">{trabajo.nombre}</span> <span className="text-xs text-gray-500">{trabajo.codigo}</span></span>{!programa && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => setTrabajo(null)}>Cambiar</button>}</div>
          ) : (
            <div className="relative">
              <input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escriba el nombre o el código del trabajo" data-no-uppercase="true" autoComplete="off" />
              {resultados.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">{resultados.map((t) => <li key={t.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => { setTrabajo(t); if (!nombre) setNombre(t.nombre); setResultados([]); setTexto(''); }}>{t.nombre} <span className="text-xs text-gray-500">{t.codigo}</span></button></li>)}</ul>}
            </div>
          )}
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Nombre del servicio"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={120} placeholder="Si lo deja vacío se usa el del trabajo" /></Campo>
          <Campo etiqueta="Checklist que lo respalda" ayuda="Al completarlo, el servicio queda registrado como realizado."><select className={CLASE_INPUT} value={checklist} onChange={(e) => setChecklist(e.target.value)}><option value="">Ninguno</option>{(checklists.datos ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta={`Cada cuánto${unidad ? ` (${unidad.nombre})` : ''}`}><input className={CLASE_INPUT} type="number" min={0} step="any" value={intervalo} onChange={(e) => setIntervalo(e.target.value)} required /></Campo>
          <Campo etiqueta="Aviso «próximo» faltando…" ayuda="Vacío = el sugerido según la unidad."><input className={CLASE_INPUT} type="number" min={0} step="any" value={proximo} onChange={(e) => setProximo(e.target.value)} /></Campo>
          <Campo etiqueta="Aviso «urgente» faltando…"><input className={CLASE_INPUT} type="number" min={0} step="any" value={urgente} onChange={(e) => setUrgente(e.target.value)} /></Campo>
        </div>
        {programa && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo</label>}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" disabled={!trabajo}>Guardar</Button></div>
      </form>
    </Modal>
  );
}

function Programas() {
  const { api } = useSesionTaller();
  const lista = useLista(() => api.get<Programa[]>('/servicios-programas?inactivos=true'), [api]);
  const [ventana, setVentana] = useState<{ nuevo: true } | { programa: Programa } | null>(null);
  const cerrar = (): void => {
    setVentana(null);
    lista.recargar();
  };
  const columnas: Array<Columna<Programa>> = [
    { clave: 'tipo_equipo', etiqueta: 'Tipo de equipo', valor: (p) => p.tipo_equipo },
    { clave: 'nombre', etiqueta: 'Servicio', valor: (p) => p.nombre, render: (p) => <span><span className="block font-medium text-gray-900">{p.nombre}</span><span className="block text-xs text-gray-500">{p.trabajo_codigo}</span></span> },
    { clave: 'intervalo', etiqueta: 'Cada', valor: (p) => p.intervalo, render: (p) => `${p.intervalo.toLocaleString('es-GT')} ${p.unidad}`, alinear: 'right' },
    { clave: 'avisos', etiqueta: 'Avisos faltando', render: (p) => `${p.aviso_proximo} / ${p.aviso_urgente} ${p.unidad}`, alinear: 'right' },
    { clave: 'checklist', etiqueta: 'Checklist', valor: (p) => p.checklist ?? '', render: (p) => p.checklist ?? '—' },
    { clave: 'equipos', etiqueta: 'Equipos', valor: (p) => p.equipos, alinear: 'right' },
    { clave: 'activo', etiqueta: 'Estado', valor: (p) => p.activo, render: (p) => <Badge variant={p.activo === 1 ? 'success' : 'default'}>{p.activo === 1 ? 'Activo' : 'Inactivo'}</Badge> },
    { clave: 'acc', etiqueta: 'Acciones', render: (p) => <Acciones><BotonAccion onClick={() => setVentana({ programa: p })}>Editar</BotonAccion></Acciones> },
  ];
  return (
    <Seccion titulo="Servicios programados por tipo de equipo" acciones={<Button onClick={() => setVentana({ nuevo: true })}>Nuevo servicio</Button>}>
      <p className="text-sm text-gray-700">Aquí se define qué servicios lleva cada tipo de equipo (por ejemplo «servicio de 10 000 km»). Los equipos de ese tipo los siguen solos, cada uno con su contador.</p>
      <Aviso mensaje={lista.error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(p) => p.id} vacio={lista.datos ? 'Todavía no hay servicios programados.' : 'Cargando…'} />
      {ventana && 'nuevo' in ventana && <FormPrograma alCerrar={() => setVentana(null)} alListo={cerrar} />}
      {ventana && 'programa' in ventana && <FormPrograma programa={ventana.programa} alCerrar={() => setVentana(null)} alListo={cerrar} />}
    </Seccion>
  );
}

export default function Servicios() {
  const { tiene } = useSesionTaller();
  const [params, setParams] = useSearchParams();
  const pestanas = [
    { k: 'pendientes', t: 'Por atender', permiso: 'servicios.ver', vista: () => <PorVencer /> },
    { k: 'programas', t: 'Programas', permiso: 'servicios.gestionar', vista: () => <Programas /> },
  ].filter((p) => tiene(p.permiso));
  const actual = pestanas.find((p) => p.k === params.get('tab')) ?? pestanas[0];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Servicios</h1>
      {pestanas.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {pestanas.map((p) => <button key={p.k} onClick={() => setParams({ tab: p.k }, { replace: true })} className={`rounded-md border border-gray-200 px-4 py-2 text-sm font-medium ${actual?.k === p.k ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{p.t}</button>)}
        </div>
      )}
      {actual?.vista()}
    </div>
  );
}
