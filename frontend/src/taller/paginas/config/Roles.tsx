import { FormEvent, useEffect, useMemo, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

interface RolFila {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  es_sistema: number;
  activo: number;
  usuarios: number;
  permisos: number;
}
interface RolDetalle extends RolFila {
  permisos: never;
}
interface Permiso {
  codigo: string;
  modulo: string;
  descripcion: string;
  disponible: boolean;
}

const MODULOS: Record<string, string> = {
  base: 'General del taller',
  ordenes: 'Órdenes de trabajo y catálogos',
  clientes: 'Clientes y proveedores',
  equipos: 'Equipos y contadores',
  inventario: 'Inventario y bodegas',
};

function NuevoRol({ roles, alCerrar, alCrear }: { roles: RolFila[]; alCerrar: () => void; alCrear: (id: number) => void }) {
  const { api } = useSesionTaller();
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [copiar, setCopiar] = useState('');
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      const r = await api.post<{ id: number }>('/roles', { nombre, descripcion: descripcion.trim() || null, ...(copiar ? { copiar_de: Number(copiar) } : {}) });
      alCrear(r.id);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo crear el rol'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Nuevo rol" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required minLength={2} maxLength={60} autoFocus /></Campo>
        <Campo etiqueta="Descripción (opcional)"><input className={CLASE_INPUT} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={200} /></Campo>
        <Campo etiqueta="Empezar con los permisos de" ayuda="Después puede marcar y desmarcar los que quiera.">
          <select className={CLASE_INPUT} value={copiar} onChange={(e) => setCopiar(e.target.value)}>
            <option value="">Ninguno</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
        </Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Crear rol</Button></div>
      </form>
    </Modal>
  );
}

export function Roles() {
  const { api, tiene, perfil } = useSesionTaller();
  const gestiona = tiene('roles.gestionar');
  const roles = useLista(() => api.get<RolFila[]>('/roles'), [api]);
  const permisos = useLista(() => api.get<Permiso[]>('/permisos'), [api]);
  const [elegido, setElegido] = useState<number | null>(null);
  const [detalle, setDetalle] = useState<{ nombre: string; descripcion: string | null; codigo: string; es_sistema: number; activo: number; permisos: string[] } | null>(null);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [nombre, setNombre] = useState('');
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' }>({ texto: '', tipo: 'ok' });
  const [nuevo, setNuevo] = useState(false);

  useEffect(() => {
    if (elegido === null && roles.datos?.[0]) setElegido(roles.datos[0].id);
  }, [roles.datos, elegido]);
  useEffect(() => {
    if (elegido === null) return;
    api.get<RolDetalle & { permisos: string[] }>(`/roles/${elegido}`).then((r) => {
      setDetalle(r as never);
      setMarcados(new Set((r as unknown as { permisos: string[] }).permisos));
      setNombre(r.nombre);
    }).catch((e: unknown) => setMensaje({ texto: mensajeDe(e, 'No se pudo cargar el rol'), tipo: 'error' }));
  }, [api, elegido]);

  const grupos = useMemo(() => {
    const m = new Map<string, Permiso[]>();
    for (const p of permisos.datos ?? []) m.set(p.modulo, [...(m.get(p.modulo) ?? []), p]);
    return [...m.entries()];
  }, [permisos.datos]);

  const esAdmin = detalle?.codigo === 'administrador';
  const mios = new Set(perfil?.permisos ?? []);
  const guardar = async (): Promise<void> => {
    if (elegido === null) return;
    setMensaje({ texto: '', tipo: 'ok' });
    try {
      await api.patch(`/roles/${elegido}`, { nombre, ...(esAdmin ? {} : { permisos: [...marcados] }) });
      setMensaje({ texto: 'El rol se guardó. Los cambios valen desde la siguiente acción de cada persona.', tipo: 'ok' });
      roles.recargar();
    } catch (err) {
      setMensaje({ texto: mensajeDe(err, 'No se pudo guardar'), tipo: 'error' });
    }
  };
  const activar = async (activo: boolean): Promise<void> => {
    if (elegido === null) return;
    try {
      await api.patch(`/roles/${elegido}`, { activo });
      roles.recargar();
      setDetalle((d) => (d ? { ...d, activo: activo ? 1 : 0 } : d));
    } catch (err) {
      setMensaje({ texto: mensajeDe(err, 'No se pudo cambiar'), tipo: 'error' });
    }
  };
  const alternarGrupo = (lista: Permiso[], marcar: boolean): void =>
    setMarcados((s) => {
      const n = new Set(s);
      for (const p of lista) if (p.disponible && (mios.has(p.codigo) || n.has(p.codigo))) (marcar ? n.add(p.codigo) : n.delete(p.codigo));
      return n;
    });

  return (
    <Seccion titulo="Roles y permisos" acciones={gestiona && <Button onClick={() => setNuevo(true)}>Nuevo rol</Button>}>
      <p className="text-sm text-gray-600">Cada persona tiene uno o varios roles y cada rol es un conjunto de permisos. Lo que no está marcado está prohibido. Los módulos que su plan no incluye aparecen en gris.</p>
      <Aviso mensaje={roles.error || permisos.error || mensaje.texto} tipo={roles.error || permisos.error || mensaje.tipo === 'error' ? 'error' : 'ok'} />
      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <ul className="space-y-1 rounded-lg border border-gray-200 bg-white p-2">
          {(roles.datos ?? []).map((r) => (
            <li key={r.id}>
              <button onClick={() => setElegido(r.id)} className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${elegido === r.id ? 'bg-primary text-white' : 'hover:bg-gray-100'}`}>
                <span className="font-medium">{r.nombre}</span>
                <span className={`text-xs ${elegido === r.id ? 'text-white' : 'text-gray-500'}`}>{r.usuarios} {r.usuarios === 1 ? 'persona' : 'personas'}{r.activo ? '' : ' · inactivo'}</span>
              </button>
            </li>
          ))}
        </ul>
        {detalle && (
          <div className="space-y-4 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-wrap items-end gap-3">
              <Campo etiqueta="Nombre del rol" ancho="min-w-[14rem]"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} disabled={!gestiona} maxLength={60} /></Campo>
              {detalle.es_sistema ? <Badge variant="info">De fábrica</Badge> : null}
              {esAdmin && <Badge variant="success">Siempre tiene todos los permisos</Badge>}
              {gestiona && !esAdmin && (detalle.activo ? <Button variant="outline" size="sm" onClick={() => void activar(false)}>Desactivar rol</Button> : <Button variant="outline" size="sm" onClick={() => void activar(true)}>Activar rol</Button>)}
            </div>
            {grupos.map(([modulo, lista]) => (
              <fieldset key={modulo} className="rounded-md border border-gray-100 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <legend className="text-sm font-bold text-gray-900">{MODULOS[modulo] ?? modulo}{lista[0] && !lista[0].disponible ? ' (no incluido en su plan)' : ''}</legend>
                  {gestiona && !esAdmin && lista[0]?.disponible && (
                    <span className="flex gap-3 text-xs"><button className="text-primary hover:underline" onClick={() => alternarGrupo(lista, true)}>Marcar todos</button><button className="text-primary hover:underline" onClick={() => alternarGrupo(lista, false)}>Quitar todos</button></span>
                  )}
                </div>
                <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                  {lista.map((p) => (
                    <label key={p.codigo} className={`flex items-start gap-2 text-sm ${p.disponible ? '' : 'text-gray-400'}`}>
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={esAdmin || marcados.has(p.codigo)}
                        disabled={!gestiona || esAdmin || !p.disponible || (!mios.has(p.codigo) && !marcados.has(p.codigo))}
                        onChange={(e) => setMarcados((s) => { const n = new Set(s); if (e.target.checked) n.add(p.codigo); else n.delete(p.codigo); return n; })}
                      />
                      <span>{p.descripcion.charAt(0) + p.descripcion.slice(1).toLowerCase()}<span className="block text-xs text-gray-400">{p.codigo}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
            {gestiona && <div className="flex justify-end"><Button onClick={() => void guardar()}>Guardar rol</Button></div>}
          </div>
        )}
      </div>
      {nuevo && <NuevoRol roles={roles.datos ?? []} alCerrar={() => setNuevo(false)} alCrear={(id) => { setNuevo(false); roles.recargar(); setElegido(id); }} />}
    </Seccion>
  );
}
