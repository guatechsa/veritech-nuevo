import { FormEvent, ReactNode, useEffect, useState } from 'react';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { CatalogoSimple } from '../../componentes/CatalogoSimple';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, Si, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

// ── Jerarquía técnica: sistemas → subsistemas → partes (se elige uno para ver sus hijos) ──
interface Nodo {
  id: number;
  codigo: string;
  nombre: string;
  activo: number;
  codigo_completo?: string;
  es_servicios_programados?: number;
  es_insumos_generales?: number;
}

function PanelNivel({ titulo, vacio, nodos, elegido, alElegir, gestiona, alCrear, alGuardar, extra }: {
  titulo: string;
  vacio: string;
  nodos: Nodo[] | null;
  elegido: number | null;
  alElegir?: (n: Nodo) => void;
  gestiona: boolean;
  alCrear: (() => void) | null;
  alGuardar: (n: Nodo, cambios: Record<string, unknown>) => Promise<void>;
  extra?: (n: Nodo) => string;
}) {
  const [editando, setEditando] = useState<Nodo | null>(null);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const abrir = (n: Nodo): void => {
    setNombre(n.nombre);
    setError('');
    setEditando(n);
  };
  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!editando) return;
    try {
      await alGuardar(editando, { nombre });
      setEditando(null);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center justify-between border-b border-gray-100 px-3 py-2">
        <h3 className="text-sm font-bold text-gray-900">{titulo}</h3>
        {gestiona && alCrear && <button className="text-sm font-medium text-primary hover:underline" onClick={alCrear}>Agregar</button>}
      </div>
      <ul className="max-h-96 divide-y divide-gray-100 overflow-y-auto">
        {nodos === null && <li className="px-3 py-3 text-sm text-gray-500">Cargando…</li>}
        {nodos?.length === 0 && <li className="px-3 py-3 text-sm text-gray-500">{vacio}</li>}
        {nodos?.map((n) => (
          <li key={n.id} className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${elegido === n.id ? 'bg-primary-100' : ''}`}>
            <button className="min-w-0 flex-1 text-left" onClick={() => alElegir?.(n)} disabled={!alElegir}>
              <span className="block truncate font-medium text-gray-900">{n.nombre} {n.activo ? null : <Badge variant="default">Inactivo</Badge>}</span>
              <span className="block text-xs text-gray-500">{n.codigo_completo ?? n.codigo}{extra ? ` · ${extra(n)}` : ''}</span>
            </button>
            {gestiona && (
              <span className="flex flex-shrink-0 gap-2 text-sm">
                <button className="font-medium text-primary hover:underline" onClick={() => abrir(n)}>Editar</button>
                <button className="font-medium text-primary hover:underline" onClick={() => void alGuardar(n, { activo: n.activo !== 1 }).catch((err: unknown) => setError(mensajeDe(err, 'No se pudo cambiar')))}>{n.activo ? 'Desactivar' : 'Activar'}</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {error && !editando && <p role="alert" className="px-3 pb-2 text-xs text-red-700">{error}</p>}
      {editando && (
        <Modal onClose={() => setEditando(null)} title={`Editar ${editando.nombre}`} size="sm">
          <form onSubmit={guardar} className="space-y-3">
            <Aviso mensaje={error} tipo="error" />
            <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={100} autoFocus /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function Jerarquia() {
  const { api, tiene } = useSesionTaller();
  const gestiona = tiene('catalogos.gestionar');
  const [sis, setSis] = useState<number | null>(null);
  const [sub, setSub] = useState<number | null>(null);
  const sistemas = useLista(() => api.get<Nodo[]>('/catalogos/sistemas?inactivos=true'), [api]);
  const subsistemas = useLista(() => (sis ? api.get<Nodo[]>(`/catalogos/subsistemas?sistema_id=${sis}&inactivos=true`) : Promise.resolve([])), [api, sis]);
  const partes = useLista(() => (sub ? api.get<Nodo[]>(`/catalogos/partes?subsistema_id=${sub}&inactivos=true`) : Promise.resolve([])), [api, sub]);
  const [nuevo, setNuevo] = useState<{ nivel: 'sistema' | 'subsistema' | 'parte' } | null>(null);
  const [nombre, setNombre] = useState('');
  const [programados, setProgramados] = useState(false);
  const [error, setError] = useState('');

  const crear = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      if (nuevo?.nivel === 'sistema') await api.post('/catalogos/sistemas', { nombre, es_servicios_programados: programados });
      if (nuevo?.nivel === 'subsistema' && sis) await api.post('/catalogos/subsistemas', { sistema_id: sis, nombre });
      if (nuevo?.nivel === 'parte' && sub) await api.post('/catalogos/partes', { subsistema_id: sub, nombre });
      setNuevo(null);
      sistemas.recargar();
      subsistemas.recargar();
      partes.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo crear'));
    }
  };
  const abrirNuevo = (nivel: 'sistema' | 'subsistema' | 'parte'): void => {
    setNombre('');
    setProgramados(false);
    setError('');
    setNuevo({ nivel });
  };
  return (
    <Seccion titulo="Jerarquía técnica">
      <p className="text-sm text-gray-600">Sistema → Subsistema → Parte. Los códigos se numeran solos y aparecen en letra pequeña junto al nombre. Elija un sistema para ver sus subsistemas, y un subsistema para ver sus partes.</p>
      <Aviso mensaje={sistemas.error || subsistemas.error || partes.error} tipo="error" />
      <div className="grid gap-4 lg:grid-cols-3">
        <PanelNivel titulo="Sistemas" vacio="No hay sistemas." nodos={sistemas.datos} elegido={sis} gestiona={gestiona} alCrear={() => abrirNuevo('sistema')} alElegir={(n) => { setSis(n.id); setSub(null); }}
          extra={(n) => (n.es_servicios_programados ? 'servicios programados' : n.es_insumos_generales ? 'insumos generales' : '')}
          alGuardar={async (n, c) => { await api.patch(`/catalogos/sistemas/${n.id}`, c); sistemas.recargar(); }} />
        <PanelNivel titulo="Subsistemas" vacio={sis ? 'Este sistema no tiene subsistemas.' : 'Elija un sistema.'} nodos={sis ? subsistemas.datos : []} elegido={sub} gestiona={gestiona} alCrear={sis ? () => abrirNuevo('subsistema') : null} alElegir={(n) => setSub(n.id)}
          alGuardar={async (n, c) => { await api.patch(`/catalogos/subsistemas/${n.id}`, c); subsistemas.recargar(); }} />
        <PanelNivel titulo="Partes" vacio={sub ? 'Este subsistema no tiene partes.' : 'Elija un subsistema.'} nodos={sub ? partes.datos : []} elegido={null} gestiona={gestiona} alCrear={sub ? () => abrirNuevo('parte') : null}
          alGuardar={async (n, c) => { await api.patch(`/catalogos/partes/${n.id}`, c); partes.recargar(); }} />
      </div>
      {nuevo && (
        <Modal onClose={() => setNuevo(null)} title={`Nuevo ${nuevo.nivel}`} size="sm">
          <form onSubmit={crear} className="space-y-3">
            <Aviso mensaje={error} tipo="error" />
            <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={100} autoFocus /></Campo>
            {nuevo.nivel === 'sistema' && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={programados} onChange={(e) => setProgramados(e.target.checked)} /> Sus trabajos son servicios programados</label>}
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setNuevo(null)}>Cancelar</Button><Button type="submit">Crear</Button></div>
          </form>
        </Modal>
      )}
    </Seccion>
  );
}

// ── Trabajos ─────────────────────────────────────────────────────────────────────────
interface Trabajo {
  id: number;
  codigo: string;
  nombre: string;
  variante: string | null;
  parte_id: number;
  sistema_id: number;
  subsistema_id: number;
  accion_id: number;
  area_trabajo_id: number | null;
  area: string | null;
  activo: number;
}
interface Opcion {
  id: number;
  nombre: string;
}

function FormTrabajo({ inicial, alCerrar, alGuardar }: { inicial: Trabajo | null; alCerrar: () => void; alGuardar: () => void }) {
  const { api } = useSesionTaller();
  const sistemas = useLista(() => api.get<Opcion[]>('/catalogos/sistemas'), [api]);
  const acciones = useLista(() => api.get<Opcion[]>('/catalogos/acciones'), [api]);
  const areas = useLista(() => api.get<Opcion[]>('/areas'), [api]);
  const [sis, setSis] = useState(inicial ? String(inicial.sistema_id) : '');
  const [sub, setSub] = useState(inicial ? String(inicial.subsistema_id) : '');
  const [parte, setParte] = useState(inicial ? String(inicial.parte_id) : '');
  const [accion, setAccion] = useState(inicial ? String(inicial.accion_id) : '');
  const [variante, setVariante] = useState(inicial?.variante ?? '');
  const [area, setArea] = useState(inicial?.area_trabajo_id ? String(inicial.area_trabajo_id) : '');
  const [error, setError] = useState('');
  const [horas, setHoras] = useState<Record<number, string>>({});
  const tiposEquipo = useLista(() => api.get<Array<Opcion & { activo: number }>>('/tipos-equipo'), [api]);
  useEffect(() => {
    if (!inicial) return;
    api.get<Array<{ tipo_equipo_id: number; horas: number | null }>>(`/catalogos/trabajos/${inicial.id}/horas`).then((f) => {
      setHoras(Object.fromEntries(f.filter((x) => x.horas !== null).map((x) => [x.tipo_equipo_id, String(x.horas)])));
    }).catch(() => undefined);
  }, [api, inicial]);
  const subs = useLista(() => (sis ? api.get<Opcion[]>(`/catalogos/subsistemas?sistema_id=${sis}`) : Promise.resolve([])), [api, sis]);
  const partes = useLista(() => (sub ? api.get<Opcion[]>(`/catalogos/partes?subsistema_id=${sub}`) : Promise.resolve([])), [api, sub]);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      let trabajoId: number;
      if (inicial) {
        await api.patch(`/catalogos/trabajos/${inicial.id}`, { variante: variante.trim() || null, area_trabajo_id: area ? Number(area) : null });
        trabajoId = inicial.id;
      } else {
        const creado = await api.post<{ id: number }>('/catalogos/trabajos', { parte_id: Number(parte), accion_id: Number(accion), variante: variante.trim() || null, area_trabajo_id: area ? Number(area) : null });
        trabajoId = creado.id;
      }
      const lista = (tiposEquipo.datos ?? []).map((t) => ({ tipo_equipo_id: t.id, horas: horas[t.id]?.trim() ? Number(horas[t.id]) : null }));
      if (lista.some((x) => x.horas !== null) || inicial) await api.put(`/catalogos/trabajos/${trabajoId}/horas`, { horas: lista });
      alGuardar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={inicial ? `Editar trabajo ${inicial.codigo}` : 'Nuevo trabajo'} size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        {inicial && <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">{inicial.nombre}<span className="block text-xs text-gray-500">La parte y la acción forman el código y no se cambian.</span></p>}
        {!inicial && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Sistema"><select className={CLASE_INPUT} value={sis} onChange={(e) => { setSis(e.target.value); setSub(''); setParte(''); }} required><option value="">Elija…</option>{(sistemas.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Subsistema"><select className={CLASE_INPUT} value={sub} onChange={(e) => { setSub(e.target.value); setParte(''); }} required disabled={!sis}><option value="">Elija…</option>{(subs.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Parte"><select className={CLASE_INPUT} value={parte} onChange={(e) => setParte(e.target.value)} required disabled={!sub}><option value="">Elija…</option>{(partes.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></Campo>
            <Campo etiqueta="Acción"><select className={CLASE_INPUT} value={accion} onChange={(e) => setAccion(e.target.value)} required><option value="">Elija…</option>{(acciones.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></Campo>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Variante (opcional)" ayuda="Distingue trabajos parecidos, por ejemplo: sintético."><input className={CLASE_INPUT} value={variante} onChange={(e) => setVariante(e.target.value)} maxLength={100} /></Campo>
          <Campo etiqueta="Área de trabajo (opcional)" ayuda="Vacío = trabajo general."><select className={CLASE_INPUT} value={area} onChange={(e) => setArea(e.target.value)}><option value="">General</option>{(areas.datos ?? []).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
        </div>
        {(tiposEquipo.datos ?? []).length > 0 && (
          <fieldset className="rounded-md border border-gray-200 p-3">
            <legend className="px-1 text-sm font-medium text-gray-700">Horas estándar por tipo de equipo</legend>
            <p className="mb-2 text-xs text-gray-500">El precio de este trabajo en una orden será las horas por la tarifa por hora del tipo de equipo. Déjelo vacío si no aplica a ese tipo.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {(tiposEquipo.datos ?? []).map((t) => (
                <Campo key={t.id} etiqueta={t.nombre}>
                  <input type="number" min="0" max="999" step="0.25" className={CLASE_INPUT} value={horas[t.id] ?? ''} onChange={(e) => setHoras((x) => ({ ...x, [t.id]: e.target.value }))} placeholder="Horas" />
                </Campo>
              ))}
            </div>
          </fieldset>
        )}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

function Trabajos() {
  const { api, tiene } = useSesionTaller();
  const gestiona = tiene('catalogos.gestionar');
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: Trabajo[] }>(`/catalogos/trabajos?inactivos=true&pagina=${pagina}${buscar.trim() ? `&buscar=${encodeURIComponent(buscar.trim())}` : ''}`), [api, pagina, buscar]);
  const [editando, setEditando] = useState<Trabajo | 'nuevo' | null>(null);
  const [error, setError] = useState('');
  useEffect(() => setPagina(1), [buscar]);
  const estado = async (t: Trabajo): Promise<void> => {
    try {
      await api.patch(`/catalogos/trabajos/${t.id}`, { activo: t.activo !== 1 });
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };
  const columnas: Array<Columna<Trabajo>> = [
    { clave: 'codigo', etiqueta: 'Código', valor: (t) => t.codigo },
    { clave: 'nombre', etiqueta: 'Trabajo', valor: (t) => t.nombre, render: (t) => <span className="font-medium text-gray-900">{t.nombre}</span> },
    { clave: 'area', etiqueta: 'Área', valor: (t) => t.area ?? '', render: (t) => t.area ?? 'General' },
    { clave: 'estado', etiqueta: 'Estado', valor: (t) => t.activo, render: (t) => <Badge variant={t.activo ? 'success' : 'default'}>{t.activo ? 'Activo' : 'Inactivo'}</Badge> },
    { clave: 'acciones', etiqueta: 'Acciones', render: (t) => gestiona && <Acciones><BotonAccion onClick={() => void estado(t)}>{t.activo ? 'Desactivar' : 'Activar'}</BotonAccion><BotonAccion onClick={() => setEditando(t)}>Editar</BotonAccion></Acciones> },
  ];
  const paginas = lista.datos ? Math.max(1, Math.ceil(lista.datos.total / lista.datos.porPagina)) : 1;
  return (
    <Seccion titulo="Trabajos" acciones={gestiona && <Button onClick={() => setEditando('nuevo')}>Nuevo trabajo</Button>}>
      <p className="text-sm text-gray-600">Cada trabajo es una parte con una acción (cambiar, revisar, reparar…). El código y el nombre se arman solos.</p>
      <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre o código" aria-label="Buscar trabajos" data-no-uppercase="true" className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm" />
      <Aviso mensaje={lista.error || error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(t) => t.id} vacio={lista.datos ? 'No hay trabajos con ese filtro.' : 'Cargando…'} />
      {lista.datos && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{lista.datos.total} trabajos · página {pagina} de {paginas}</span>
          <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button></span>
        </div>
      )}
      {editando && <FormTrabajo inicial={editando === 'nuevo' ? null : editando} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); lista.recargar(); }} />}
    </Seccion>
  );
}

// ── Matriz nivel de técnico × sistema ────────────────────────────────────────────────
interface Matriz {
  niveles: Array<{ id: number; codigo: string; nombre: string }>;
  sistemas: Array<{ id: number; codigo: string; nombre: string }>;
  habilitadas: Array<{ nivel_tecnico_id: number; sistema_id: number }>;
}

function MatrizNiveles() {
  const { api, tiene } = useSesionTaller();
  const gestiona = tiene('catalogos.gestionar');
  const m = useLista(() => api.get<Matriz>('/catalogos/matriz-tecnico-sistema'), [api]);
  const [error, setError] = useState('');
  const marcada = (n: number, s: number): boolean => !!m.datos?.habilitadas.some((h) => h.nivel_tecnico_id === n && h.sistema_id === s);
  const cambiar = async (n: number, s: number, habilitado: boolean): Promise<void> => {
    try {
      await api.patch('/catalogos/matriz-tecnico-sistema', { cambios: [{ nivel_tecnico_id: n, sistema_id: s, habilitado }] });
      m.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };
  if (!m.datos) return <p className="text-gray-500">{m.error || 'Cargando…'}</p>;
  return (
    <Seccion titulo="Niveles de técnico por sistema">
      <p className="text-sm text-gray-600">Marque en qué sistemas puede trabajar cada nivel. Una casilla sin marcar significa que ese nivel NO puede recibir trabajos de ese sistema. Un sistema o nivel nuevo nace con todo marcado.</p>
      <Aviso mensaje={error} tipo="error" />
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead><tr className="bg-gray-100 text-left text-xs uppercase text-gray-600"><th className="px-3 py-2">Nivel</th>{m.datos.sistemas.map((s) => <th key={s.id} className="px-3 py-2 text-center">{s.nombre}</th>)}</tr></thead>
          <tbody>
            {m.datos.niveles.map((n) => (
              <tr key={n.id} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium">{n.nombre}</td>
                {m.datos?.sistemas.map((s) => <td key={s.id} className="px-3 py-2 text-center"><input type="checkbox" aria-label={`${n.nombre} en ${s.nombre}`} disabled={!gestiona} checked={marcada(n.id, s.id)} onChange={(e) => void cambiar(n.id, s.id, e.target.checked)} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}

// ── Marcas (generales o de un tipo de equipo) ────────────────────────────────────────
function Marcas() {
  const { api } = useSesionTaller();
  const tipos = useLista(() => api.get<Array<Opcion & { activo: number }>>('/tipos-equipo?inactivos=true'), [api]);
  const nombreDe = (id: unknown): string => (tipos.datos ?? []).find((t) => t.id === id)?.nombre ?? '';
  return (
    <CatalogoSimple
      key={tipos.datos ? 'listo' : 'cargando'}
      titulo="Marcas"
      singular="marca"
      ruta="/catalogos/marcas"
      permiso="catalogos.gestionar"
      descripcion="Una marca general sirve para cualquier equipo; si la limita a un tipo (por ejemplo, vehículos), solo se ofrece en equipos de ese tipo."
      campos={[
        { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 80 },
        { clave: 'tipo_equipo_id', etiqueta: 'Tipo de equipo', tipo: 'referencia', ayudaVacio: 'General (todos los tipos)', opciones: (tipos.datos ?? []).filter((t) => t.activo === 1).map((t) => ({ valor: String(t.id), texto: t.nombre })) },
      ]}
      mostrar={[
        { clave: 'nombre', etiqueta: 'Marca' },
        { clave: 'tipo_equipo_id', etiqueta: 'Tipo de equipo', render: (f) => nombreDe(f['tipo_equipo_id']) || 'General' },
      ]}
    />
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────────────
const SECCIONES: Array<{ k: string; t: string; vista: () => ReactNode }> = [
  { k: 'jerarquia', t: 'Jerarquía técnica', vista: () => <Jerarquia /> },
  { k: 'trabajos', t: 'Trabajos', vista: () => <Trabajos /> },
  { k: 'acciones', t: 'Acciones', vista: () => <CatalogoSimple titulo="Acciones" singular="acción" ruta="/catalogos/acciones" permiso="catalogos.gestionar" descripcion="Lo que se hace sobre una parte: cambiar, revisar, reparar…" campos={[{ clave: 'codigo', etiqueta: 'Código (3 letras)', tipo: 'texto', soloAlCrear: true, requerido: true, max: 3 }, { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 60 }]} mostrar={[{ clave: 'codigo', etiqueta: 'Código' }, { clave: 'nombre', etiqueta: 'Acción' }]} /> },
  { k: 'unidades', t: 'Unidades', vista: () => <CatalogoSimple titulo="Unidades" singular="unidad" ruta="/catalogos/unidades" permiso="catalogos.gestionar" descripcion="Un solo catálogo para inventario y contadores: «uso» dice dónde aparece." campos={[{ clave: 'codigo', etiqueta: 'Código', tipo: 'texto', soloAlCrear: true, requerido: true, max: 10 }, { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 60 }, { clave: 'uso', etiqueta: 'Se usa en', tipo: 'opcion', defecto: 'inventario', opciones: [{ valor: 'inventario', texto: 'Inventario' }, { valor: 'contador', texto: 'Contadores' }, { valor: 'ambos', texto: 'Inventario y contadores' }] }]} mostrar={[{ clave: 'codigo', etiqueta: 'Código' }, { clave: 'nombre', etiqueta: 'Unidad' }, { clave: 'uso', etiqueta: 'Se usa en', render: (f) => ({ inventario: 'Inventario', contador: 'Contadores', ambos: 'Ambos' }[String(f['uso'])] ?? String(f['uso'])) }]} /> },
  { k: 'marcas', t: 'Marcas', vista: () => <Marcas /> },
  {
    k: 'tipos-orden',
    t: 'Tipos de orden',
    vista: () => (
      <TiposOrden />
    ),
  },
  {
    k: 'estados',
    t: 'Estados de orden',
    vista: () => (
      <CatalogoSimple
        titulo="Estados de orden"
        singular="estado"
        ruta="/catalogos/estados-orden"
        permiso="catalogos.gestionar"
        descripcion="Los 7 de fábrica se pueden renombrar pero no cambian de comportamiento. Los que usted cree eligen si cierran la orden (terminal) o la cancelan."
        campos={[
          { clave: 'codigo', etiqueta: 'Código', tipo: 'texto', soloAlCrear: true, requerido: true, max: 30 },
          { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 60 },
          { clave: 'orden', etiqueta: 'Orden', tipo: 'numero', defecto: 100 },
          { clave: 'color', etiqueta: 'Color', tipo: 'color', defecto: '#6B7280' },
          { clave: 'es_terminal', etiqueta: 'Cierra la orden (terminal)', tipo: 'bool' },
          { clave: 'es_cancelado', etiqueta: 'La cancela (anulada)', tipo: 'bool' },
        ]}
        bloqueadosSi={(f) => (f['es_sistema'] === 1 ? ['es_terminal', 'es_cancelado'] : [])}
        sinDesactivarSi={(f) => f['es_sistema'] === 1}
        mostrar={[
          { clave: 'orden', etiqueta: 'Orden' },
          { clave: 'nombre', etiqueta: 'Estado', render: (f) => <span><span className="mr-2 inline-block h-3 w-3 rounded-full align-middle" style={{ background: String(f['color']) }} />{String(f['nombre'])}{f['es_sistema'] === 1 ? <span className="ml-2 text-xs text-gray-500">de fábrica</span> : null}</span> },
          { clave: 'es_inicial', etiqueta: 'Inicial', render: (f) => <Si v={f['es_inicial'] === 1} /> },
          { clave: 'es_terminal', etiqueta: 'Terminal', render: (f) => <Si v={f['es_terminal'] === 1} /> },
          { clave: 'es_cancelado', etiqueta: 'Cancelado', render: (f) => <Si v={f['es_cancelado'] === 1} /> },
        ]}
      />
    ),
  },
  { k: 'etapas', t: 'Etapas de checklist', vista: () => <CatalogoSimple titulo="Etapas de checklist" singular="etapa" ruta="/catalogos/etapas" permiso="catalogos.gestionar" descripcion="Momentos del trabajo que cubren los checklists (recepción, calidad, entrega…)." campos={[{ clave: 'codigo', etiqueta: 'Código', tipo: 'texto', soloAlCrear: true, requerido: true, max: 20 }, { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 60 }, { clave: 'orden', etiqueta: 'Orden', tipo: 'numero', defecto: 0 }, { clave: 'requiere_orden', etiqueta: 'Necesita una orden de trabajo', tipo: 'bool', defecto: true }, { clave: 'color', etiqueta: 'Color', tipo: 'color', defecto: '#6B7280' }]} mostrar={[{ clave: 'orden', etiqueta: 'Orden' }, { clave: 'nombre', etiqueta: 'Etapa' }, { clave: 'requiere_orden', etiqueta: 'Necesita orden', render: (f) => <Si v={f['requiere_orden'] === 1} /> }]} /> },
  { k: 'motivos', t: 'Motivos', vista: () => <CatalogoSimple titulo="Motivos" singular="motivo" ruta="/catalogos/motivos" permiso="catalogos.gestionar" descripcion="Lo que se elige al anular una orden, rechazar una cotización o hacer una excepción." campos={[{ clave: 'tipo', etiqueta: 'Para', tipo: 'opcion', soloAlCrear: true, requerido: true, defecto: 'anulacion_orden', opciones: [{ valor: 'anulacion_orden', texto: 'Anular una orden' }, { valor: 'rechazo_cotizacion', texto: 'Rechazar una cotización' }, { valor: 'cancelacion_cita', texto: 'Cancelar una cita' }, { valor: 'diferencia_inventario', texto: 'Diferencia de inventario' }, { valor: 'excepcion_checklist', texto: 'Excepción de checklist' }] }, { clave: 'nombre', etiqueta: 'Motivo', tipo: 'texto', requerido: true, max: 100 }]} mostrar={[{ clave: 'tipo', etiqueta: 'Para', render: (f) => ({ anulacion_orden: 'Anular una orden', rechazo_cotizacion: 'Rechazar una cotización', cancelacion_cita: 'Cancelar una cita', diferencia_inventario: 'Diferencia de inventario', excepcion_checklist: 'Excepción de checklist' }[String(f['tipo'])] ?? String(f['tipo'])) }, { clave: 'nombre', etiqueta: 'Motivo' }]} /> },
  { k: 'matriz', t: 'Niveles por sistema', vista: () => <MatrizNiveles /> },
];

function TiposOrden() {
  const { api } = useSesionTaller();
  return (
    <CatalogoSimple
      titulo="Tipos de orden"
      singular="tipo de orden"
      ruta="/catalogos/tipos-orden"
      permiso="catalogos.gestionar"
      descripcion="El tipo «por defecto» es el que se usa cuando nadie elige. Un tipo de «pedido especial» nace sin el equipo presente (por ejemplo, un repuesto de importación)."
      campos={[
        { clave: 'codigo', etiqueta: 'Código (3 letras)', tipo: 'texto', soloAlCrear: true, requerido: true, max: 3 },
        { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 60 },
        { clave: 'es_pedido_especial', etiqueta: 'Es un pedido especial (nace sin equipo presente)', tipo: 'bool' },
      ]}
      mostrar={[
        { clave: 'codigo', etiqueta: 'Código' },
        { clave: 'nombre', etiqueta: 'Tipo', render: (f) => <span>{String(f['nombre'])} {f['es_default'] === 1 ? <Badge variant="info">Por defecto</Badge> : null}</span> },
        { clave: 'es_pedido_especial', etiqueta: 'Pedido especial', render: (f) => <Si v={f['es_pedido_especial'] === 1} /> },
      ]}
      accionesExtra={(f, recargar, fallar) =>
        f['es_default'] === 1 || f.activo !== 1 ? null : (
          <BotonAccion onClick={() => { api.patch(`/catalogos/tipos-orden/${f.id}`, { es_default: true }).then(recargar).catch((e: unknown) => fallar(mensajeDe(e, 'No se pudo cambiar'))); }}>Por defecto</BotonAccion>
        )
      }
    />
  );
}

export function CatalogosDeTrabajo() {
  const [actual, setActual] = useState('jerarquia');
  const seccion = SECCIONES.find((s) => s.k === actual) ?? SECCIONES[0]!;
  return (
    <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
      <ul className="h-fit space-y-1 rounded-lg border border-gray-200 bg-white p-2">
        {SECCIONES.map((s) => (
          <li key={s.k}>
            <button onClick={() => setActual(s.k)} className={`w-full rounded-md px-3 py-2 text-left text-sm font-medium ${actual === s.k ? 'bg-primary text-white' : 'text-gray-700 hover:bg-gray-100'}`}>{s.t}</button>
          </li>
        ))}
      </ul>
      <div className="min-w-0">{seccion.vista()}</div>
    </div>
  );
}
