import { FormEvent, useEffect, useState } from 'react';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import { formatFecha } from '../../../components/ui-guatech/formatoFecha.js';
import { aHoraDeGuatemala } from '../../../utils/hora';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { DetalleEquipo } from './tipos';

const f = (iso: string | null): string => (iso ? (formatFecha(iso.slice(0, 10)) as string) : '—');

// ── Notas ────────────────────────────────────────────────────────────────────────────
export function NotasEquipo({ equipo, alCambiar }: { equipo: DetalleEquipo; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const [nota, setNota] = useState('');
  const [importante, setImportante] = useState(false);
  const [error, setError] = useState('');
  const puede = tiene('equipos.editar') && equipo.estado !== 'baja';
  const agregar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post(`/equipos/${equipo.id}/notas`, { nota, es_importante: importante });
      setNota('');
      setImportante(false);
      setError('');
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar la nota'));
    }
  };
  return (
    <Seccion titulo="Notas del equipo">
      <Aviso mensaje={error} tipo="error" />
      {puede && (
        <form onSubmit={agregar} className="space-y-2 rounded-lg border border-gray-200 bg-white p-3">
          <Campo etiqueta="Nueva nota"><textarea className={CLASE_INPUT} rows={2} value={nota} onChange={(e) => setNota(e.target.value)} maxLength={1000} required /></Campo>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={importante} onChange={(e) => setImportante(e.target.checked)} /> Importante (sale primero)</label>
            <Button type="submit" size="sm">Guardar nota</Button>
          </div>
        </form>
      )}
      {equipo.anotaciones.length === 0 ? (
        <p className="text-sm text-gray-500">Todavía no hay notas.</p>
      ) : (
        <ul className="space-y-2">
          {equipo.anotaciones.map((n) => (
            <li key={n.id} className={`rounded-md border p-3 text-sm ${n.es_importante ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}>
              <p className="whitespace-pre-line text-gray-900">{n.nota}</p>
              <p className="mt-1 text-xs text-gray-500">{n.es_importante ? <Badge variant="warning">Importante</Badge> : null} {n.autor ?? '—'} · {f(aHoraDeGuatemala(n.created_at))}</p>
            </li>
          ))}
        </ul>
      )}
    </Seccion>
  );
}

// ── Operadores, componentes y contactos ──────────────────────────────────────────────
export function PersonasEquipo({ equipo, alCambiar }: { equipo: DetalleEquipo; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const puede = tiene('equipos.editar') && equipo.estado !== 'baja';
  const disponibles = useLista(() => (puede ? api.get<Array<{ id: number; nombre_completo: string }>>('/equipos/operadores-disponibles') : Promise.resolve([])), [api, puede]);
  const [operador, setOperador] = useState('');
  const [componente, setComponente] = useState('');
  const [error, setError] = useState('');
  const [contactos, setContactos] = useState<Array<{ id: number; nombre: string; activo: number }>>([]);
  const [marcados, setMarcados] = useState<number[]>(equipo.contactos.map((c) => c.contacto_id));

  useEffect(() => setMarcados(equipo.contactos.map((c) => c.contacto_id)), [equipo.contactos]);
  useEffect(() => {
    if (!equipo.cliente_id) {
      setContactos([]);
      return;
    }
    api.get<{ contactos: Array<{ id: number; nombre: string; activo: number }> }>(`/clientes/${equipo.cliente_id}`).then((c) => setContactos(c.contactos)).catch(() => setContactos([]));
  }, [api, equipo.cliente_id]);

  const correr = async (llamada: () => Promise<unknown>, fallo: string): Promise<void> => {
    try {
      await llamada();
      setError('');
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, fallo));
    }
  };
  const activos = equipo.operadores.filter((o) => o.activo === 1);
  return (
    <div className="space-y-6">
      <Aviso mensaje={error} tipo="error" />
      <Seccion titulo="Operadores">
        <p className="text-sm text-gray-600">Quienes manejan este equipo. Solo aparecen colaboradores con un puesto de operador.</p>
        {equipo.operadores.length === 0 ? <p className="text-sm text-gray-500">Sin operadores asignados.</p> : (
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
            {equipo.operadores.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span><span className="font-medium text-gray-900">{o.colaborador}</span> <span className="text-xs text-gray-500">desde {f(o.desde)}{o.hasta ? ` hasta ${f(o.hasta)}` : ''}</span></span>
                {o.activo === 1 ? (puede && <Acciones><BotonAccion onClick={() => void correr(() => api.delete(`/equipos/${equipo.id}/operadores/${o.id}`), 'No se pudo quitar')}>Quitar</BotonAccion></Acciones>) : <Badge variant="default">Anterior</Badge>}
              </li>
            ))}
          </ul>
        )}
        {puede && (
          <div className="flex flex-wrap items-end gap-2">
            <Campo etiqueta="Asignar operador">
              <select className={CLASE_INPUT} value={operador} onChange={(e) => setOperador(e.target.value)}>
                <option value="">Elija…</option>
                {(disponibles.datos ?? []).filter((c) => !activos.some((a) => a.colaborador_id === c.id)).map((c) => <option key={c.id} value={c.id}>{c.nombre_completo}</option>)}
              </select>
            </Campo>
            <Button size="sm" disabled={!operador} onClick={() => void correr(async () => { await api.post(`/equipos/${equipo.id}/operadores`, { colaborador_id: Number(operador) }); setOperador(''); }, 'No se pudo asignar')}>Asignar</Button>
          </div>
        )}
      </Seccion>

      {equipo.tiene_componentes === 1 && (
        <Seccion titulo="Componentes">
          <p className="text-sm text-gray-600">Partes del equipo con su propio contador (por ejemplo, el motor).</p>
          <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
            {equipo.componentes.length === 0 && <li className="px-3 py-2 text-sm text-gray-500">Sin componentes.</li>}
            {equipo.componentes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                <span className={c.activo ? 'font-medium text-gray-900' : 'text-gray-400'}>{c.nombre}</span>
                {puede && <Acciones><BotonAccion onClick={() => void correr(() => api.patch(`/equipos/${equipo.id}/componentes/${c.id}`, { activo: c.activo !== 1 }), 'No se pudo cambiar')}>{c.activo ? 'Desactivar' : 'Activar'}</BotonAccion></Acciones>}
              </li>
            ))}
          </ul>
          {puede && (
            <div className="flex flex-wrap items-end gap-2">
              <Campo etiqueta="Nuevo componente"><input className={CLASE_INPUT} value={componente} onChange={(e) => setComponente(e.target.value)} maxLength={80} /></Campo>
              <Button size="sm" disabled={!componente.trim()} onClick={() => void correr(async () => { await api.post(`/equipos/${equipo.id}/componentes`, { nombre: componente }); setComponente(''); }, 'No se pudo agregar')}>Agregar</Button>
            </div>
          )}
        </Seccion>
      )}

      {equipo.cliente_id && (
        <Seccion titulo="Contactos que ven este equipo">
          <p className="text-sm text-gray-600">Contactos del cliente a quienes se les muestra este equipo en el portal. Los que tienen acceso a todos los equipos lo ven siempre.</p>
          {contactos.filter((c) => c.activo === 1).length === 0 ? <p className="text-sm text-gray-500">El cliente no tiene contactos activos.</p> : (
            <div className="space-y-1">
              {contactos.filter((c) => c.activo === 1).map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" disabled={!puede} checked={marcados.includes(c.id)} onChange={(e) => setMarcados((m) => (e.target.checked ? [...m, c.id] : m.filter((x) => x !== c.id)))} /> {c.nombre}
                </label>
              ))}
              {puede && <Button size="sm" onClick={() => void correr(() => api.put(`/equipos/${equipo.id}/contactos`, { contactos: marcados }), 'No se pudo guardar')}>Guardar contactos</Button>}
            </div>
          )}
        </Seccion>
      )}
    </div>
  );
}
