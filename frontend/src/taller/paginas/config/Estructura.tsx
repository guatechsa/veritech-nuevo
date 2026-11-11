import { FormEvent, useState } from 'react';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

const Estado = ({ activo }: { activo: number }) => <Badge variant={activo ? 'success' : 'default'}>{activo ? 'Activa' : 'Inactiva'}</Badge>;

// ── Sucursales ───────────────────────────────────────────────────────────────────────
interface Sucursal {
  id: number;
  nombre: string;
  direccion: string | null;
  telefono: string | null;
  es_principal: number;
  cupo_diario_citas: number | null;
  activo: number;
  colaboradores: number;
  bodegas: number;
}

function FormSucursal({ inicial, alCerrar, alGuardar }: { inicial: Sucursal | null; alCerrar: () => void; alGuardar: () => void }) {
  const { api } = useSesionTaller();
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [direccion, setDireccion] = useState(inicial?.direccion ?? '');
  const [telefono, setTelefono] = useState(inicial?.telefono ?? '');
  const [cupo, setCupo] = useState(inicial?.cupo_diario_citas === null || inicial === null ? '' : String(inicial.cupo_diario_citas));
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    const cuerpo = { nombre, direccion: direccion.trim() || null, telefono: telefono.trim() || null, cupo_diario_citas: cupo.trim() === '' ? null : Number(cupo) };
    try {
      if (inicial) await api.patch(`/sucursales/${inicial.id}`, cuerpo);
      else await api.post('/sucursales', cuerpo);
      alGuardar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={inicial ? `Editar sucursal: ${inicial.nombre}` : 'Nueva sucursal'} size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={100} autoFocus /></Campo>
        <Campo etiqueta="Dirección"><input className={CLASE_INPUT} value={direccion} onChange={(e) => setDireccion(e.target.value)} maxLength={250} /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Teléfono"><input className={CLASE_INPUT} value={telefono} onChange={(e) => setTelefono(e.target.value)} maxLength={40} /></Campo>
          <Campo etiqueta="Citas por día (opcional)" ayuda="Máximo de citas que recibe al día."><input type="number" min="0" className={CLASE_INPUT} value={cupo} onChange={(e) => setCupo(e.target.value)} /></Campo>
        </div>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

export function Sucursales() {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<Sucursal[]>('/sucursales?inactivos=true'), [api]);
  const [editando, setEditando] = useState<Sucursal | 'nueva' | null>(null);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' }>({ texto: '', tipo: 'ok' });
  const gestiona = tiene('sucursales.gestionar');

  const cambiar = async (s: Sucursal, cuerpo: Record<string, unknown>, ok: string): Promise<void> => {
    try {
      await api.patch(`/sucursales/${s.id}`, cuerpo);
      setMensaje({ texto: ok, tipo: 'ok' });
      lista.recargar();
    } catch (err) {
      setMensaje({ texto: mensajeDe(err, 'No se pudo cambiar'), tipo: 'error' });
    }
  };

  const columnas: Array<Columna<Sucursal>> = [
    { clave: 'nombre', etiqueta: 'Sucursal', valor: (s) => s.nombre, render: (s) => <span className="font-medium text-gray-900">{s.nombre} {s.es_principal ? <Badge variant="info">Principal</Badge> : null}</span> },
    { clave: 'direccion', etiqueta: 'Dirección', valor: (s) => s.direccion ?? '', render: (s) => s.direccion ?? '—' },
    { clave: 'telefono', etiqueta: 'Teléfono', valor: (s) => s.telefono ?? '', render: (s) => s.telefono ?? '—' },
    { clave: 'cupo', etiqueta: 'Citas por día', valor: (s) => s.cupo_diario_citas ?? -1, render: (s) => s.cupo_diario_citas ?? '—', alinear: 'right' },
    { clave: 'colaboradores', etiqueta: 'Colaboradores', valor: (s) => s.colaboradores, alinear: 'right' },
    { clave: 'estado', etiqueta: 'Estado', valor: (s) => s.activo, render: (s) => <Estado activo={s.activo} /> },
    {
      clave: 'acciones',
      etiqueta: 'Acciones',
      render: (s) => gestiona && (
        <Acciones>
          {s.activo === 1 && !s.es_principal && <BotonAccion onClick={() => void cambiar(s, { es_principal: true }, `${s.nombre} es ahora la sucursal principal.`)}>Hacer principal</BotonAccion>}
          {s.activo === 1 ? <BotonAccion onClick={() => void cambiar(s, { activo: false }, `${s.nombre} se desactivó.`)}>Desactivar</BotonAccion> : <BotonAccion onClick={() => void cambiar(s, { activo: true }, `${s.nombre} se activó.`)}>Activar</BotonAccion>}
          <BotonAccion onClick={() => setEditando(s)}>Editar</BotonAccion>
        </Acciones>
      ),
    },
  ];
  return (
    <Seccion titulo="Sucursales" acciones={gestiona && <Button onClick={() => setEditando('nueva')}>Nueva sucursal</Button>}>
      <Aviso mensaje={lista.error || mensaje.texto} tipo={lista.error ? 'error' : mensaje.tipo} />
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(s) => s.id} vacio={lista.datos ? 'No hay sucursales.' : 'Cargando…'} />
      {editando && <FormSucursal inicial={editando === 'nueva' ? null : editando} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); setMensaje({ texto: 'Se guardó la sucursal.', tipo: 'ok' }); lista.recargar(); }} />}
    </Seccion>
  );
}

// ── Áreas de trabajo ─────────────────────────────────────────────────────────────────
interface Area {
  id: number;
  nombre: string;
  activo: number;
}

/** Lista con nombre y estado (áreas de trabajo): un mismo formulario sirve para crear y editar. */
function ListaSencilla({ titulo, ruta, permiso, singular }: { titulo: string; ruta: string; permiso: string; singular: string }) {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<Area[]>(`${ruta}?inactivos=true`), [api, ruta]);
  const [editando, setEditando] = useState<Area | 'nueva' | null>(null);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const gestiona = tiene(permiso);
  const abrir = (a: Area | 'nueva'): void => {
    setNombre(a === 'nueva' ? '' : a.nombre);
    setError('');
    setEditando(a);
  };
  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      if (editando === 'nueva') await api.post(ruta, { nombre });
      else if (editando) await api.patch(`${ruta}/${editando.id}`, { nombre });
      setEditando(null);
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  const estado = async (a: Area, activo: boolean): Promise<void> => {
    try {
      await api.patch(`${ruta}/${a.id}`, { activo });
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };
  const columnas: Array<Columna<Area>> = [
    { clave: 'nombre', etiqueta: titulo, valor: (a) => a.nombre, render: (a) => <span className="font-medium text-gray-900">{a.nombre}</span> },
    { clave: 'estado', etiqueta: 'Estado', valor: (a) => a.activo, render: (a) => <Estado activo={a.activo} /> },
    { clave: 'acciones', etiqueta: 'Acciones', render: (a) => gestiona && <Acciones><BotonAccion onClick={() => void estado(a, a.activo !== 1)}>{a.activo ? 'Desactivar' : 'Activar'}</BotonAccion><BotonAccion onClick={() => abrir(a)}>Editar</BotonAccion></Acciones> },
  ];
  return (
    <Seccion titulo={titulo} acciones={gestiona && <Button onClick={() => abrir('nueva')}>{`Nueva ${singular}`}</Button>}>
      <Aviso mensaje={lista.error || (editando ? '' : error)} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(a) => a.id} vacio={lista.datos ? 'No hay registros.' : 'Cargando…'} />
      {editando && (
        <Modal onClose={() => setEditando(null)} title={editando === 'nueva' ? `Nueva ${singular}` : `Editar ${singular}`} size="sm">
          <form onSubmit={guardar} className="space-y-3">
            <Aviso mensaje={error} tipo="error" />
            <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={100} autoFocus /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
          </form>
        </Modal>
      )}
    </Seccion>
  );
}

// ── Bodegas ──────────────────────────────────────────────────────────────────────────
interface Bodega {
  id: number;
  nombre: string;
  sucursal_id: number;
  sucursal: string;
  activo: number;
}

function Bodegas() {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<Bodega[]>('/bodegas?inactivos=true'), [api]);
  const sucursales = useLista(() => api.get<Sucursal[]>('/sucursales'), [api]);
  const [editando, setEditando] = useState<Bodega | 'nueva' | null>(null);
  const [nombre, setNombre] = useState('');
  const [sucursalId, setSucursalId] = useState('');
  const [error, setError] = useState('');
  const gestiona = tiene('bodegas.gestionar');
  const abrir = (b: Bodega | 'nueva'): void => {
    setNombre(b === 'nueva' ? '' : b.nombre);
    setSucursalId(b === 'nueva' ? String(sucursales.datos?.[0]?.id ?? '') : String(b.sucursal_id));
    setError('');
    setEditando(b);
  };
  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      const cuerpo = { nombre, sucursal_id: Number(sucursalId) };
      if (editando === 'nueva') await api.post('/bodegas', cuerpo);
      else if (editando) await api.patch(`/bodegas/${editando.id}`, cuerpo);
      setEditando(null);
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  const estado = async (b: Bodega, activo: boolean): Promise<void> => {
    try {
      await api.patch(`/bodegas/${b.id}`, { activo });
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };
  const columnas: Array<Columna<Bodega>> = [
    { clave: 'nombre', etiqueta: 'Bodega', valor: (b) => b.nombre, render: (b) => <span className="font-medium text-gray-900">{b.nombre}</span> },
    { clave: 'sucursal', etiqueta: 'Sucursal', valor: (b) => b.sucursal },
    { clave: 'estado', etiqueta: 'Estado', valor: (b) => b.activo, render: (b) => <Estado activo={b.activo} /> },
    { clave: 'acciones', etiqueta: 'Acciones', render: (b) => gestiona && <Acciones><BotonAccion onClick={() => void estado(b, b.activo !== 1)}>{b.activo ? 'Desactivar' : 'Activar'}</BotonAccion><BotonAccion onClick={() => abrir(b)}>Editar</BotonAccion></Acciones> },
  ];
  if (!tiene('bodegas.ver')) return null;
  return (
    <Seccion titulo="Bodegas" acciones={gestiona && <Button onClick={() => abrir('nueva')}>Nueva bodega</Button>}>
      <Aviso mensaje={lista.error || (editando ? '' : error)} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(b) => b.id} vacio={lista.datos ? 'No hay bodegas.' : 'Cargando…'} />
      {editando && (
        <Modal onClose={() => setEditando(null)} title={editando === 'nueva' ? 'Nueva bodega' : 'Editar bodega'} size="sm">
          <form onSubmit={guardar} className="space-y-3">
            <Aviso mensaje={error} tipo="error" />
            <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={100} autoFocus /></Campo>
            <Campo etiqueta="Sucursal">
              <select className={CLASE_INPUT} value={sucursalId} onChange={(e) => setSucursalId(e.target.value)} required>
                {(sucursales.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
          </form>
        </Modal>
      )}
    </Seccion>
  );
}

export function AreasYBodegas() {
  return (
    <div className="space-y-8">
      <ListaSencilla titulo="Áreas de trabajo" ruta="/areas" permiso="areas.gestionar" singular="área" />
      <Bodegas />
    </div>
  );
}
