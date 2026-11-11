import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Acciones, BotonAccion } from '../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Modal from '../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { ErrorApi } from '../../admin/api';
import { dinero } from '../../admin/tipos';
import { CatalogoSimple } from '../componentes/CatalogoSimple';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../componentes/ui';
import { useSesionTaller } from '../Sesion';

interface FilaCliente {
  id: number;
  nombre: string;
  nit: string | null;
  email: string | null;
  telefono: string | null;
  contacto_nombre: string | null;
  tipo_cliente: string | null;
  condicion_pago: 'contado' | 'credito';
  dias_credito: number;
  activo: number;
}
interface Detalle extends FilaCliente {
  contacto_email: string | null;
  contacto_telefono: string | null;
  direccion: string | null;
  limite_credito: number;
  notas: string | null;
  tipo_cliente_id: number | null;
  departamentos: Array<{ id: number; nombre: string; activo: number }>;
  contactos: Array<{ id: number; nombre: string; correo: string | null; telefono: string | null; rol: 'aprobador' | 'consulta' | 'piloto'; acceso_todos_equipos: number; activo: number }>;
  historia: { equipos: number; ordenes: number };
}
interface Tipo {
  id: number;
  nombre: string;
  activo: number;
}
interface Aviso2 {
  campo: 'email' | 'telefono';
  cliente: { id: number; nombre: string };
}

const ROL: Record<string, string> = { aprobador: 'Aprueba trabajos', consulta: 'Consulta', piloto: 'Maneja el equipo' };

// ── Datos del cliente (mismo formulario para crear y editar) ──────────────────────────
function DatosCliente({ detalle, alGuardar, alAbrirOtro }: { detalle: Detalle | null; alGuardar: (id: number, avisos: Aviso2[]) => void; alAbrirOtro: (id: number) => void }) {
  const { api, tiene } = useSesionTaller();
  const tipos = useLista(() => api.get<Tipo[]>('/tipos-cliente'), [api]);
  const [f, setF] = useState({ nombre: '', nit: '', email: '', telefono: '', contacto_nombre: '', contacto_email: '', contacto_telefono: '', direccion: '', condicion_pago: 'contado', dias_credito: '0', limite_credito: '0', notas: '', tipo: '' });
  const [error, setError] = useState('');
  const [nitRepetido, setNitRepetido] = useState<{ id: number; nombre: string } | null>(null);
  const edita = detalle ? tiene('clientes.editar') : tiene('clientes.crear');
  useEffect(() => {
    setF({
      nombre: detalle?.nombre ?? '',
      nit: detalle?.nit ?? '',
      email: detalle?.email ?? '',
      telefono: detalle?.telefono ?? '',
      contacto_nombre: detalle?.contacto_nombre ?? '',
      contacto_email: detalle?.contacto_email ?? '',
      contacto_telefono: detalle?.contacto_telefono ?? '',
      direccion: detalle?.direccion ?? '',
      condicion_pago: detalle?.condicion_pago ?? 'contado',
      dias_credito: String(detalle?.dias_credito ?? 0),
      limite_credito: String(detalle?.limite_credito ?? 0),
      notas: detalle?.notas ?? '',
      tipo: detalle?.tipo_cliente_id ? String(detalle.tipo_cliente_id) : '',
    });
  }, [detalle]);
  const poner = (k: keyof typeof f, v: string): void => setF((x) => ({ ...x, [k]: v }));
  const o = (v: string): string | null => (v.trim() === '' ? null : v.trim());

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setNitRepetido(null);
    const cuerpo = {
      nombre: f.nombre,
      nit: o(f.nit),
      email: o(f.email),
      telefono: o(f.telefono),
      contacto_nombre: o(f.contacto_nombre),
      contacto_email: o(f.contacto_email),
      contacto_telefono: o(f.contacto_telefono),
      direccion: o(f.direccion),
      condicion_pago: f.condicion_pago,
      dias_credito: f.condicion_pago === 'credito' ? Number(f.dias_credito) : 0,
      limite_credito: Number(f.limite_credito) || 0,
      notas: o(f.notas),
      tipo_cliente_id: f.tipo ? Number(f.tipo) : null,
    };
    try {
      const r = detalle ? await api.patch<{ cliente: { id: number }; avisos: Aviso2[] }>(`/clientes/${detalle.id}`, cuerpo) : await api.post<{ cliente: { id: number }; avisos: Aviso2[] }>('/clientes', cuerpo);
      alGuardar(r.cliente.id, r.avisos);
    } catch (err) {
      if (err instanceof ErrorApi && err.codigo === 'NIT_REPETIDO') {
        const det = (err as ErrorApi & { detalle?: { cliente: { id: number; nombre: string } } }).detalle;
        setNitRepetido(det?.cliente ?? null);
      }
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <form onSubmit={enviar} className="space-y-4">
      <Aviso mensaje={error} tipo="error" />
      {nitRepetido && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Ese NIT ya es de <strong>{nitRepetido.nombre}</strong>. <button type="button" className="font-semibold text-primary hover:underline" onClick={() => alAbrirOtro(nitRepetido.id)}>Abrir ese cliente</button>
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre" ancho="sm:col-span-2"><input className={CLASE_INPUT} value={f.nombre} onChange={(e) => poner('nombre', e.target.value)} required minLength={2} maxLength={150} disabled={!edita} autoFocus /></Campo>
        <Campo etiqueta="NIT" ayuda="Escriba CF si es consumidor final."><input className={CLASE_INPUT} value={f.nit} onChange={(e) => poner('nit', e.target.value)} maxLength={30} disabled={!edita} /></Campo>
        <Campo etiqueta="Tipo de cliente"><select className={CLASE_INPUT} value={f.tipo} onChange={(e) => poner('tipo', e.target.value)} disabled={!edita}><option value="">Sin tipo</option>{(tipos.datos ?? []).filter((t) => t.activo === 1 || String(t.id) === f.tipo).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Correo"><input type="email" className={CLASE_INPUT} value={f.email} onChange={(e) => poner('email', e.target.value)} maxLength={150} disabled={!edita} /></Campo>
        <Campo etiqueta="Teléfono"><input className={CLASE_INPUT} value={f.telefono} onChange={(e) => poner('telefono', e.target.value)} maxLength={40} disabled={!edita} /></Campo>
        <Campo etiqueta="Dirección" ancho="sm:col-span-2"><input className={CLASE_INPUT} value={f.direccion} onChange={(e) => poner('direccion', e.target.value)} maxLength={250} disabled={!edita} /></Campo>
        <Campo etiqueta="Persona de contacto"><input className={CLASE_INPUT} value={f.contacto_nombre} onChange={(e) => poner('contacto_nombre', e.target.value)} maxLength={120} disabled={!edita} /></Campo>
        <Campo etiqueta="Teléfono del contacto"><input className={CLASE_INPUT} value={f.contacto_telefono} onChange={(e) => poner('contacto_telefono', e.target.value)} maxLength={40} disabled={!edita} /></Campo>
        <Campo etiqueta="Correo del contacto" ancho="sm:col-span-2"><input type="email" className={CLASE_INPUT} value={f.contacto_email} onChange={(e) => poner('contacto_email', e.target.value)} maxLength={150} disabled={!edita} /></Campo>
        <Campo etiqueta="Condición de pago"><select className={CLASE_INPUT} value={f.condicion_pago} onChange={(e) => poner('condicion_pago', e.target.value)} disabled={!edita}><option value="contado">Contado</option><option value="credito">Crédito</option></select></Campo>
        {f.condicion_pago === 'credito' && (
          <>
            <Campo etiqueta="Días de crédito"><input type="number" min="1" max="365" className={CLASE_INPUT} value={f.dias_credito} onChange={(e) => poner('dias_credito', e.target.value)} required disabled={!edita} /></Campo>
            <Campo etiqueta="Límite de crédito"><input type="number" min="0" step="0.01" className={CLASE_INPUT} value={f.limite_credito} onChange={(e) => poner('limite_credito', e.target.value)} disabled={!edita} /></Campo>
          </>
        )}
        <Campo etiqueta="Notas" ancho="sm:col-span-2"><textarea className={CLASE_INPUT} rows={2} value={f.notas} onChange={(e) => poner('notas', e.target.value)} maxLength={500} disabled={!edita} /></Campo>
      </div>
      {edita && <div className="flex justify-end border-t pt-3"><Button type="submit">Guardar</Button></div>}
    </form>
  );
}

// ── Departamentos y contactos ────────────────────────────────────────────────────────
function Departamentos({ detalle, alCambiar }: { detalle: Detalle; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const edita = tiene('clientes.editar');
  const correr = async (accion: () => Promise<unknown>): Promise<void> => {
    setError('');
    try {
      await accion();
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo completar'));
    }
  };
  const columnas: Array<Columna<Detalle['departamentos'][number]>> = [
    { clave: 'nombre', etiqueta: 'Departamento', valor: (d) => d.nombre },
    { clave: 'estado', etiqueta: 'Estado', valor: (d) => d.activo, render: (d) => <Badge variant={d.activo ? 'success' : 'default'}>{d.activo ? 'Activo' : 'Inactivo'}</Badge> },
    { clave: 'acc', etiqueta: 'Acciones', render: (d) => edita && <Acciones><BotonAccion onClick={() => void correr(() => api.patch(`/clientes/${detalle.id}/departamentos/${d.id}`, { activo: d.activo !== 1 }))}>{d.activo ? 'Desactivar' : 'Activar'}</BotonAccion></Acciones> },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Las áreas internas de este cliente (producción, empaque…), para agrupar sus equipos. No son las áreas de trabajo de su taller.</p>
      <Aviso mensaje={error} tipo="error" />
      <Tabla columnas={columnas} filas={detalle.departamentos} clave={(d) => d.id} vacio="Este cliente no tiene departamentos." />
      {edita && (
        <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); void correr(async () => { await api.post(`/clientes/${detalle.id}/departamentos`, { nombre }); setNombre(''); }); }}>
          <Campo etiqueta="Nuevo departamento" ancho="flex-1"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={100} /></Campo>
          <Button type="submit">Agregar</Button>
        </form>
      )}
    </div>
  );
}

function Contactos({ detalle, alCambiar }: { detalle: Detalle; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const [editando, setEditando] = useState<Detalle['contactos'][number] | 'nuevo' | null>(null);
  const [v, setV] = useState({ nombre: '', correo: '', telefono: '', rol: 'consulta', todos: true });
  const [error, setError] = useState('');
  const edita = tiene('clientes.editar');
  const abrir = (c: Detalle['contactos'][number] | 'nuevo'): void => {
    setV({ nombre: c === 'nuevo' ? '' : c.nombre, correo: c === 'nuevo' ? '' : c.correo ?? '', telefono: c === 'nuevo' ? '' : c.telefono ?? '', rol: c === 'nuevo' ? 'consulta' : c.rol, todos: c === 'nuevo' ? true : c.acceso_todos_equipos === 1 });
    setError('');
    setEditando(c);
  };
  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const cuerpo = { nombre: v.nombre, correo: v.correo.trim() || null, telefono: v.telefono.trim() || null, rol: v.rol, acceso_todos_equipos: v.todos };
    try {
      if (editando === 'nuevo') await api.post(`/clientes/${detalle.id}/contactos`, cuerpo);
      else if (editando) await api.patch(`/clientes/${detalle.id}/contactos/${editando.id}`, cuerpo);
      setEditando(null);
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  const activar = async (c: Detalle['contactos'][number]): Promise<void> => {
    try {
      await api.patch(`/clientes/${detalle.id}/contactos/${c.id}`, { activo: c.activo !== 1 });
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };
  const columnas: Array<Columna<Detalle['contactos'][number]>> = [
    { clave: 'nombre', etiqueta: 'Contacto', valor: (c) => c.nombre, render: (c) => <span><span className="block font-medium text-gray-900">{c.nombre}</span><span className="block text-xs text-gray-500">{[c.correo, c.telefono].filter(Boolean).join(' · ') || '—'}</span></span> },
    { clave: 'rol', etiqueta: 'Función', valor: (c) => c.rol, render: (c) => ROL[c.rol] },
    { clave: 'equipos', etiqueta: 'Equipos', valor: (c) => c.acceso_todos_equipos, render: (c) => (c.acceso_todos_equipos ? 'Todos' : 'Solo los que se le asignen') },
    { clave: 'estado', etiqueta: 'Estado', valor: (c) => c.activo, render: (c) => <Badge variant={c.activo ? 'success' : 'default'}>{c.activo ? 'Activo' : 'Inactivo'}</Badge> },
    { clave: 'acc', etiqueta: 'Acciones', render: (c) => edita && <Acciones><BotonAccion onClick={() => void activar(c)}>{c.activo ? 'Desactivar' : 'Activar'}</BotonAccion><BotonAccion onClick={() => abrir(c)}>Editar</BotonAccion></Acciones> },
  ];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600">Las personas del cliente que se relacionan con el taller: aprueban trabajos, consultan o manejan el equipo.</p>
        {edita && <Button onClick={() => abrir('nuevo')}>Nuevo contacto</Button>}
      </div>
      <Aviso mensaje={editando ? '' : error} tipo="error" />
      <Tabla columnas={columnas} filas={detalle.contactos} clave={(c) => c.id} vacio="Este cliente no tiene contactos." />
      {editando && (
        <Modal onClose={() => setEditando(null)} title={editando === 'nuevo' ? 'Nuevo contacto' : 'Editar contacto'} size="md">
          <form onSubmit={guardar} className="space-y-3">
            <Aviso mensaje={error} tipo="error" />
            <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} required maxLength={120} autoFocus /></Campo>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Correo"><input type="email" className={CLASE_INPUT} value={v.correo} onChange={(e) => setV({ ...v, correo: e.target.value })} maxLength={150} /></Campo>
              <Campo etiqueta="Teléfono"><input className={CLASE_INPUT} value={v.telefono} onChange={(e) => setV({ ...v, telefono: e.target.value })} maxLength={40} /></Campo>
            </div>
            <Campo etiqueta="Función"><select className={CLASE_INPUT} value={v.rol} onChange={(e) => setV({ ...v, rol: e.target.value })}>{Object.entries(ROL).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Campo>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.todos} onChange={(e) => setV({ ...v, todos: e.target.checked })} /> Puede ver todos los equipos de este cliente</label>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ── Ficha ────────────────────────────────────────────────────────────────────────────
type PestanaFicha = 'datos' | 'departamentos' | 'contactos';

function Ficha({ inicial, alCerrar, alCambiar }: { inicial: number | 'nuevo'; alCerrar: () => void; alCambiar: () => void }) {
  const { api } = useSesionTaller();
  const [id, setId] = useState<number | 'nuevo'>(inicial);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [pestana, setPestana] = useState<PestanaFicha>('datos');
  const [avisos, setAvisos] = useState<Aviso2[]>([]);
  const [error, setError] = useState('');
  const cargar = (n: number): void => {
    api.get<Detalle>(`/clientes/${n}`).then(setDetalle).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar')));
  };
  useEffect(() => {
    if (id !== 'nuevo') cargar(id);
    else setDetalle(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const pestanas: Array<{ k: PestanaFicha; t: string }> = [{ k: 'datos', t: 'Datos' }, ...(id !== 'nuevo' ? [{ k: 'departamentos' as const, t: 'Departamentos' }, { k: 'contactos' as const, t: 'Contactos' }] : [])];
  return (
    <Modal onClose={alCerrar} title={id === 'nuevo' ? 'Nuevo cliente' : detalle ? detalle.nombre : 'Cliente'} size="xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        {avisos.length > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Cuidado, puede estar repetido: {avisos.map((a) => `${a.campo === 'email' ? 'el correo' : 'el teléfono'} ya lo tiene ${a.cliente.nombre}`).join('; ')}.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {pestanas.map((p) => <button key={p.k} type="button" onClick={() => setPestana(p.k)} className={`rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium ${pestana === p.k ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{p.t}</button>)}
        </div>
        {pestana === 'datos' && (id === 'nuevo' || detalle) && (
          <DatosCliente
            detalle={id === 'nuevo' ? null : detalle}
            alAbrirOtro={(n) => { setAvisos([]); setError(''); setId(n); }}
            alGuardar={(n, a) => { alCambiar(); setAvisos(a); if (id === 'nuevo') setId(n); else cargar(n); }}
          />
        )}
        {detalle && pestana === 'departamentos' && <Departamentos detalle={detalle} alCambiar={() => { cargar(detalle.id); alCambiar(); }} />}
        {detalle && pestana === 'contactos' && <Contactos detalle={detalle} alCambiar={() => { cargar(detalle.id); alCambiar(); }} />}
      </div>
    </Modal>
  );
}

// ── Lista de clientes ────────────────────────────────────────────────────────────────
function ListaClientes() {
  const { api, tiene } = useSesionTaller();
  const [buscar, setBuscar] = useState('');
  const [estado, setEstado] = useState<'true' | 'false' | ''>('true');
  const [pagina, setPagina] = useState(1);
  const params = new URLSearchParams({ pagina: String(pagina), ...(buscar.trim() ? { buscar: buscar.trim() } : {}), ...(estado ? { activo: estado } : {}) });
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: FilaCliente[] }>(`/clientes?${params.toString()}`), [api, pagina, buscar, estado]);
  const [abierto, setAbierto] = useState<number | 'nuevo' | null>(null);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' }>({ texto: '', tipo: 'ok' });
  useEffect(() => setPagina(1), [buscar, estado]);

  const cambiarEstado = async (c: FilaCliente): Promise<void> => {
    const desactivar = c.activo === 1;
    if (!window.confirm(desactivar ? `¿Desactivar a ${c.nombre}?` : `¿Reactivar a ${c.nombre}?`)) return;
    try {
      await api.post(`/clientes/${c.id}/estado`, { activo: !desactivar });
      setMensaje({ texto: `${c.nombre}: ${desactivar ? 'desactivado' : 'reactivado'}.`, tipo: 'ok' });
      lista.recargar();
    } catch (err) {
      setMensaje({ texto: mensajeDe(err, 'No se pudo cambiar el estado'), tipo: 'error' });
    }
  };
  const columnas: Array<Columna<FilaCliente>> = [
    { clave: 'nombre', etiqueta: 'Cliente', valor: (c) => c.nombre, render: (c) => <span><span className="block font-medium text-gray-900">{c.nombre}</span><span className="block text-xs text-gray-500">{c.nit ? `NIT ${c.nit}` : 'Sin NIT'}</span></span> },
    { clave: 'contacto', etiqueta: 'Contacto', valor: (c) => c.contacto_nombre ?? '', render: (c) => <span><span className="block">{c.contacto_nombre ?? '—'}</span><span className="block text-xs text-gray-500">{[c.telefono, c.email].filter(Boolean).join(' · ')}</span></span> },
    { clave: 'tipo', etiqueta: 'Tipo', valor: (c) => c.tipo_cliente ?? '', render: (c) => c.tipo_cliente ?? '—' },
    { clave: 'pago', etiqueta: 'Pago', valor: (c) => c.condicion_pago, render: (c) => (c.condicion_pago === 'credito' ? `Crédito ${c.dias_credito} días` : 'Contado') },
    { clave: 'estado', etiqueta: 'Estado', valor: (c) => c.activo, render: (c) => <Badge variant={c.activo ? 'success' : 'default'}>{c.activo ? 'Activo' : 'Inactivo'}</Badge> },
    { clave: 'acc', etiqueta: 'Acciones', render: (c) => <Acciones>{tiene('clientes.desactivar') && <BotonAccion onClick={() => void cambiarEstado(c)}>{c.activo ? 'Desactivar' : 'Activar'}</BotonAccion>}<BotonAccion onClick={() => setAbierto(c.id)}>{tiene('clientes.editar') ? 'Editar' : 'Ver'}</BotonAccion></Acciones> },
  ];
  const paginas = lista.datos ? Math.max(1, Math.ceil(lista.datos.total / lista.datos.porPagina)) : 1;
  return (
    <Seccion titulo="Clientes" acciones={tiene('clientes.crear') && <Button onClick={() => setAbierto('nuevo')}>Nuevo cliente</Button>}>
      <div className="flex flex-wrap gap-3">
        <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre, NIT, correo o teléfono" aria-label="Buscar clientes" data-no-uppercase="true" className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} aria-label="Estado" className="rounded-md border border-gray-300 px-3 py-2 text-sm"><option value="true">Activos</option><option value="false">Inactivos</option><option value="">Todos</option></select>
      </div>
      <Aviso mensaje={lista.error || mensaje.texto} tipo={lista.error ? 'error' : mensaje.tipo} />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(c) => c.id} vacio={lista.datos ? 'No hay clientes con ese filtro.' : 'Cargando…'} />
      {lista.datos && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{lista.datos.total} clientes · página {pagina} de {paginas}</span>
          <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button></span>
        </div>
      )}
      {abierto !== null && <Ficha inicial={abierto} alCerrar={() => setAbierto(null)} alCambiar={lista.recargar} />}
    </Seccion>
  );
}

// ── Proveedores ──────────────────────────────────────────────────────────────────────
interface Proveedor {
  id: number;
  nombre: string;
  nit: string | null;
  contacto_nombre: string | null;
  contacto_email: string | null;
  contacto_telefono: string | null;
  direccion: string | null;
  condicion_pago: 'contado' | 'credito';
  dias_credito: number;
  notas: string | null;
  activo: number;
}

function Proveedores() {
  const { api, tiene } = useSesionTaller();
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: Proveedor[] }>(`/proveedores?pagina=${pagina}${buscar.trim() ? `&buscar=${encodeURIComponent(buscar.trim())}` : ''}`), [api, pagina, buscar]);
  const [editando, setEditando] = useState<Proveedor | 'nuevo' | null>(null);
  const [v, setV] = useState({ nombre: '', nit: '', contacto_nombre: '', contacto_email: '', contacto_telefono: '', direccion: '', condicion_pago: 'contado', dias_credito: '0', notas: '' });
  const [error, setError] = useState('');
  useEffect(() => setPagina(1), [buscar]);
  const abrir = (p: Proveedor | 'nuevo'): void => {
    setV({ nombre: p === 'nuevo' ? '' : p.nombre, nit: p === 'nuevo' ? '' : p.nit ?? '', contacto_nombre: p === 'nuevo' ? '' : p.contacto_nombre ?? '', contacto_email: p === 'nuevo' ? '' : p.contacto_email ?? '', contacto_telefono: p === 'nuevo' ? '' : p.contacto_telefono ?? '', direccion: p === 'nuevo' ? '' : p.direccion ?? '', condicion_pago: p === 'nuevo' ? 'contado' : p.condicion_pago, dias_credito: p === 'nuevo' ? '0' : String(p.dias_credito), notas: p === 'nuevo' ? '' : p.notas ?? '' });
    setError('');
    setEditando(p);
  };
  const o = (s: string): string | null => (s.trim() === '' ? null : s.trim());
  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const cuerpo = { nombre: v.nombre, nit: o(v.nit), contacto_nombre: o(v.contacto_nombre), contacto_email: o(v.contacto_email), contacto_telefono: o(v.contacto_telefono), direccion: o(v.direccion), condicion_pago: v.condicion_pago, dias_credito: v.condicion_pago === 'credito' ? Number(v.dias_credito) : 0, notas: o(v.notas) };
    try {
      if (editando === 'nuevo') await api.post('/proveedores', cuerpo);
      else if (editando) await api.patch(`/proveedores/${editando.id}`, cuerpo);
      setEditando(null);
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  const estado = async (p: Proveedor): Promise<void> => {
    try {
      await api.patch(`/proveedores/${p.id}`, { activo: p.activo !== 1 });
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };
  const columnas: Array<Columna<Proveedor>> = [
    { clave: 'nombre', etiqueta: 'Proveedor', valor: (p) => p.nombre, render: (p) => <span><span className="block font-medium text-gray-900">{p.nombre}</span><span className="block text-xs text-gray-500">{p.nit ? `NIT ${p.nit}` : 'Sin NIT'}</span></span> },
    { clave: 'contacto', etiqueta: 'Contacto', valor: (p) => p.contacto_nombre ?? '', render: (p) => <span><span className="block">{p.contacto_nombre ?? '—'}</span><span className="block text-xs text-gray-500">{[p.contacto_telefono, p.contacto_email].filter(Boolean).join(' · ')}</span></span> },
    { clave: 'pago', etiqueta: 'Pago', valor: (p) => p.condicion_pago, render: (p) => (p.condicion_pago === 'credito' ? `Crédito ${p.dias_credito} días` : 'Contado') },
    { clave: 'estado', etiqueta: 'Estado', valor: (p) => p.activo, render: (p) => <Badge variant={p.activo ? 'success' : 'default'}>{p.activo ? 'Activo' : 'Inactivo'}</Badge> },
    { clave: 'acc', etiqueta: 'Acciones', render: (p) => <Acciones>{tiene('proveedores.desactivar') && <BotonAccion onClick={() => void estado(p)}>{p.activo ? 'Desactivar' : 'Activar'}</BotonAccion>}<BotonAccion onClick={() => abrir(p)}>{tiene('proveedores.editar') ? 'Editar' : 'Ver'}</BotonAccion></Acciones> },
  ];
  const paginas = lista.datos ? Math.max(1, Math.ceil(lista.datos.total / lista.datos.porPagina)) : 1;
  const edita = editando === 'nuevo' ? tiene('proveedores.crear') : tiene('proveedores.editar');
  return (
    <Seccion titulo="Proveedores" acciones={tiene('proveedores.crear') && <Button onClick={() => abrir('nuevo')}>Nuevo proveedor</Button>}>
      <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre, NIT o contacto" aria-label="Buscar proveedores" data-no-uppercase="true" className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm" />
      <Aviso mensaje={lista.error || (editando ? '' : error)} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(p) => p.id} vacio={lista.datos ? 'No hay proveedores.' : 'Cargando…'} />
      {lista.datos && lista.datos.total > lista.datos.porPagina && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{lista.datos.total} proveedores · página {pagina} de {paginas}</span>
          <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button></span>
        </div>
      )}
      {editando && (
        <Modal onClose={() => setEditando(null)} title={editando === 'nuevo' ? 'Nuevo proveedor' : `Proveedor: ${editando.nombre}`} size="lg">
          <form onSubmit={guardar} className="space-y-3">
            <Aviso mensaje={error} tipo="error" />
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} required minLength={2} maxLength={150} disabled={!edita} autoFocus /></Campo>
              <Campo etiqueta="NIT"><input className={CLASE_INPUT} value={v.nit} onChange={(e) => setV({ ...v, nit: e.target.value })} maxLength={30} disabled={!edita} /></Campo>
              <Campo etiqueta="Persona de contacto"><input className={CLASE_INPUT} value={v.contacto_nombre} onChange={(e) => setV({ ...v, contacto_nombre: e.target.value })} maxLength={120} disabled={!edita} /></Campo>
              <Campo etiqueta="Teléfono del contacto"><input className={CLASE_INPUT} value={v.contacto_telefono} onChange={(e) => setV({ ...v, contacto_telefono: e.target.value })} maxLength={40} disabled={!edita} /></Campo>
              <Campo etiqueta="Correo del contacto" ancho="sm:col-span-2"><input type="email" className={CLASE_INPUT} value={v.contacto_email} onChange={(e) => setV({ ...v, contacto_email: e.target.value })} maxLength={150} disabled={!edita} /></Campo>
              <Campo etiqueta="Dirección" ancho="sm:col-span-2"><input className={CLASE_INPUT} value={v.direccion} onChange={(e) => setV({ ...v, direccion: e.target.value })} maxLength={250} disabled={!edita} /></Campo>
              <Campo etiqueta="Condición de pago"><select className={CLASE_INPUT} value={v.condicion_pago} onChange={(e) => setV({ ...v, condicion_pago: e.target.value })} disabled={!edita}><option value="contado">Contado</option><option value="credito">Crédito</option></select></Campo>
              {v.condicion_pago === 'credito' && <Campo etiqueta="Días de crédito"><input type="number" min="1" max="365" className={CLASE_INPUT} value={v.dias_credito} onChange={(e) => setV({ ...v, dias_credito: e.target.value })} required disabled={!edita} /></Campo>}
              <Campo etiqueta="Notas" ancho="sm:col-span-2"><textarea className={CLASE_INPUT} rows={2} value={v.notas} onChange={(e) => setV({ ...v, notas: e.target.value })} maxLength={500} disabled={!edita} /></Campo>
            </div>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setEditando(null)}>{edita ? 'Cancelar' : 'Cerrar'}</Button>{edita && <Button type="submit">Guardar</Button>}</div>
          </form>
        </Modal>
      )}
    </Seccion>
  );
}

// ── Tipos de cliente ─────────────────────────────────────────────────────────────────
function TiposCliente() {
  return (
    <CatalogoSimple
      titulo="Tipos de cliente"
      singular="tipo de cliente"
      ruta="/tipos-cliente"
      permiso="configuracion.editar"
      descripcion="Agrupan a los clientes y les dan descuentos automáticos (porcentajes de 0 a 100)."
      campos={[
        { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 80 },
        { clave: 'descuento_trabajos', etiqueta: 'Descuento en trabajos (%)', tipo: 'numero', defecto: 0 },
        { clave: 'descuento_materiales', etiqueta: 'Descuento en materiales (%)', tipo: 'numero', defecto: 0 },
        { clave: 'descuento_otros', etiqueta: 'Descuento en otros cargos (%)', tipo: 'numero', defecto: 0 },
      ]}
      mostrar={[
        { clave: 'nombre', etiqueta: 'Tipo' },
        { clave: 'descuento_trabajos', etiqueta: 'Trabajos', render: (f) => `${f['descuento_trabajos']}%` },
        { clave: 'descuento_materiales', etiqueta: 'Materiales', render: (f) => `${f['descuento_materiales']}%` },
        { clave: 'descuento_otros', etiqueta: 'Otros', render: (f) => `${f['descuento_otros']}%` },
      ]}
    />
  );
}

// ── Pantalla ─────────────────────────────────────────────────────────────────────────
export default function Clientes() {
  const { tiene } = useSesionTaller();
  const [params, setParams] = useSearchParams();
  const pestanas = [
    { k: 'clientes', t: 'Clientes', permiso: 'clientes.ver', vista: () => <ListaClientes /> },
    { k: 'proveedores', t: 'Proveedores', permiso: 'proveedores.ver', vista: () => <Proveedores /> },
    { k: 'tipos', t: 'Tipos de cliente', permiso: 'clientes.ver', vista: () => <TiposCliente /> },
  ].filter((p) => tiene(p.permiso));
  const actual = pestanas.find((p) => p.k === params.get('tab')) ?? pestanas[0];
  void dinero;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Clientes</h1>
      <div className="flex flex-wrap gap-2">
        {pestanas.map((p) => <button key={p.k} onClick={() => setParams({ tab: p.k }, { replace: true })} className={`rounded-md border border-gray-200 px-4 py-2 text-sm font-medium ${actual?.k === p.k ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{p.t}</button>)}
      </div>
      {actual?.vista()}
    </div>
  );
}
