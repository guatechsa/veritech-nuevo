import { FormEvent, useState } from 'react';
import { Acciones, BotonAccion } from '../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Modal from '../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { useSesionTaller } from '../Sesion';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from './ui';

export interface CampoCatalogo {
  clave: string;
  etiqueta: string;
  tipo: 'texto' | 'numero' | 'opcion' | 'bool' | 'color';
  opciones?: Array<{ valor: string; texto: string }>;
  /** Solo se escribe al crear (los códigos no se cambian). */
  soloAlCrear?: boolean;
  requerido?: boolean;
  max?: number;
  ayuda?: string;
  defecto?: string | number | boolean;
}

type Fila = Record<string, unknown> & { id: number; activo?: number };

/**
 * Pantalla de un catálogo sencillo: tabla + un MISMO formulario para crear y editar + desactivar/activar (nunca borrar).
 * Una sola forma de hacerlo para todos los catálogos del taller.
 */
export function CatalogoSimple({
  titulo,
  singular,
  ruta,
  permiso,
  campos,
  mostrar,
  conActivo = true,
  descripcion,
  alCambiar,
  bloqueadosSi,
  accionesExtra,
}: {
  titulo: string;
  singular: string;
  ruta: string;
  permiso: string;
  campos: CampoCatalogo[];
  mostrar: Array<{ clave: string; etiqueta: string; render?: (f: Fila) => React.ReactNode }>;
  conActivo?: boolean;
  descripcion?: string;
  alCambiar?: () => void;
  /** Campos que no se envían ni se editan en una fila concreta (por ejemplo, las banderas de un estado de fábrica). */
  bloqueadosSi?: (f: Fila) => string[];
  /** Acciones adicionales de cada fila (por ejemplo, «Por defecto»). */
  accionesExtra?: (f: Fila, recargar: () => void, fallar: (m: string) => void) => React.ReactNode;
}) {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<Fila[]>(`${ruta}${ruta.includes('?') ? '&' : '?'}inactivos=true`), [api, ruta]);
  const [editando, setEditando] = useState<Fila | 'nuevo' | null>(null);
  const [valores, setValores] = useState<Record<string, string | boolean>>({});
  const [error, setError] = useState('');
  const gestiona = tiene(permiso);

  const abrir = (f: Fila | 'nuevo'): void => {
    const v: Record<string, string | boolean> = {};
    for (const c of campos) {
      const actual = f === 'nuevo' ? c.defecto : (f[c.clave] as string | number | boolean | undefined);
      v[c.clave] = c.tipo === 'bool' ? (f === 'nuevo' ? c.defecto === true : actual === 1 || actual === true) : String(actual ?? '');
    }
    setValores(v);
    setError('');
    setEditando(f);
  };
  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const cuerpo: Record<string, unknown> = {};
    for (const c of campos) {
      if (c.soloAlCrear && editando !== 'nuevo') continue;
      if (editando !== 'nuevo' && editando && bloqueadosSi?.(editando).includes(c.clave)) continue;
      const v = valores[c.clave];
      cuerpo[c.clave] = c.tipo === 'bool' ? v === true : c.tipo === 'numero' ? (v === '' ? undefined : Number(v)) : v;
    }
    try {
      if (editando === 'nuevo') await api.post(ruta, cuerpo);
      else if (editando) await api.patch(`${ruta}/${editando.id}`, cuerpo);
      setEditando(null);
      lista.recargar();
      alCambiar?.();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  const estado = async (f: Fila, activo: boolean): Promise<void> => {
    try {
      await api.patch(`${ruta}/${f.id}`, { activo });
      lista.recargar();
      alCambiar?.();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };

  const columnas: Array<Columna<Fila>> = [
    ...mostrar.map((m) => ({ clave: m.clave, etiqueta: m.etiqueta, valor: (f: Fila) => String(f[m.clave] ?? ''), render: m.render ?? ((f: Fila) => String(f[m.clave] ?? '—')) })),
    ...(conActivo ? [{ clave: 'estado', etiqueta: 'Estado', valor: (f: Fila) => f.activo ?? 1, render: (f: Fila) => <Badge variant={f.activo ? 'success' : 'default'}>{f.activo ? 'Activo' : 'Inactivo'}</Badge> }] : []),
    {
      clave: 'acciones',
      etiqueta: 'Acciones',
      render: (f) => gestiona && <Acciones>{accionesExtra?.(f, () => { lista.recargar(); alCambiar?.(); }, setError)}{conActivo && <BotonAccion onClick={() => void estado(f, f.activo !== 1)}>{f.activo ? 'Desactivar' : 'Activar'}</BotonAccion>}<BotonAccion onClick={() => abrir(f)}>Editar</BotonAccion></Acciones>,
    },
  ];
  return (
    <Seccion titulo={titulo} acciones={gestiona && <Button onClick={() => abrir('nuevo')}>{`Nuevo ${singular}`}</Button>}>
      {descripcion && <p className="text-sm text-gray-600">{descripcion}</p>}
      <Aviso mensaje={lista.error || (editando ? '' : error)} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(f) => f.id} vacio={lista.datos ? 'No hay registros.' : 'Cargando…'} />
      {editando && (
        <Modal onClose={() => setEditando(null)} title={editando === 'nuevo' ? `Nuevo ${singular}` : `Editar ${singular}`} size="md">
          <form onSubmit={guardar} className="space-y-3">
            <Aviso mensaje={error} tipo="error" />
            {campos.map((c, i) => {
              const v = valores[c.clave];
              const bloqueado = (c.soloAlCrear && editando !== 'nuevo') || (editando !== 'nuevo' && editando !== null && !!bloqueadosSi?.(editando).includes(c.clave));
              if (c.tipo === 'bool') {
                return <label key={c.clave} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v === true} disabled={bloqueado} onChange={(e) => setValores((x) => ({ ...x, [c.clave]: e.target.checked }))} /> {c.etiqueta}</label>;
              }
              return (
                <Campo key={c.clave} etiqueta={c.etiqueta} ayuda={c.ayuda}>
                  {c.tipo === 'opcion' ? (
                    <select className={CLASE_INPUT} value={String(v ?? '')} disabled={bloqueado} onChange={(e) => setValores((x) => ({ ...x, [c.clave]: e.target.value }))}>
                      {(c.opciones ?? []).map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
                    </select>
                  ) : c.tipo === 'color' ? (
                    <input type="color" className="h-9 w-16 rounded border border-gray-300" value={String(v || '#6B7280')} onChange={(e) => setValores((x) => ({ ...x, [c.clave]: e.target.value.toUpperCase() }))} />
                  ) : (
                    <input
                      type={c.tipo === 'numero' ? 'number' : 'text'}
                      className={CLASE_INPUT}
                      value={String(v ?? '')}
                      disabled={bloqueado}
                      required={c.requerido}
                      maxLength={c.max}
                      autoFocus={i === 0}
                      onChange={(e) => setValores((x) => ({ ...x, [c.clave]: e.target.value }))}
                    />
                  )}
                </Campo>
              );
            })}
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setEditando(null)}>Cancelar</Button><Button type="submit">Guardar</Button></div>
          </form>
        </Modal>
      )}
    </Seccion>
  );
}
