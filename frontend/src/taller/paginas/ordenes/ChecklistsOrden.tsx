import { useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import { ErrorApi } from '../../../admin/api';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import { Aviso, mensajeDe, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { LlenarChecklist } from './LlenarChecklist';

interface FilaChecklist {
  id: number;
  tipo: string;
  estado: 'pendiente' | 'en_progreso' | 'completado';
  total: number;
  respondidas: number;
}
interface DatosChecklists {
  checklists: FilaChecklist[];
  requeridos_pendientes: { iniciar: { bloquean: string[]; avisan: string[] }; terminar: { bloquean: string[]; avisan: string[] } };
}

const ESTADO = { pendiente: { t: 'Sin empezar', v: 'default' }, en_progreso: { t: 'En progreso', v: 'warning' }, completado: { t: 'Completado', v: 'success' } } as const;

/** Los checklists de una orden: lo que ya se llenó, lo que falta y lo que la orden exige para iniciar trabajos o cerrarse. */
export function ChecklistsOrden({ ordenId, cerrada, alCambiar }: { ordenId: number; cerrada: boolean; alCambiar?: () => void }) {
  const { api, tiene } = useSesionTaller();
  const datos = useLista(() => api.get<DatosChecklists>(`/ordenes/${ordenId}/checklists`), [api, ordenId]);
  const tipos = useLista(() => (tiene('checklists.llenar') ? api.get<Array<{ id: number; nombre: string }>>('/checklists-tipos') : Promise.resolve([])), [api]);
  const [abierto, setAbierto] = useState<number | null>(null);
  const [nuevo, setNuevo] = useState('');
  const [error, setError] = useState('');

  const agregar = async (): Promise<void> => {
    setError('');
    try {
      const c = await api.post<{ id: number }>(`/ordenes/${ordenId}/checklists`, { tipo_id: Number(nuevo) });
      setNuevo('');
      datos.recargar();
      setAbierto(c.id);
    } catch (e) {
      if (e instanceof ErrorApi && e.codigo === 'YA_ABIERTO') setAbierto((e.detalle as { checklist_id: number }).checklist_id);
      else setError(mensajeDe(e, 'No se pudo abrir el checklist'));
    }
  };
  const p = datos.datos?.requeridos_pendientes;
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-bold text-gray-900">Checklists</h3>
      <Aviso mensaje={error || datos.error} tipo="error" />
      {p && (p.iniciar.bloquean.length > 0 || p.terminar.bloquean.length > 0 || p.iniciar.avisan.length > 0 || p.terminar.avisan.length > 0) && !cerrada && (
        <ul className="space-y-1 text-sm">
          {p.iniciar.bloquean.length > 0 && <li className="rounded-md bg-red-50 px-3 py-1.5 text-red-700">Para iniciar un trabajo falta completar: <strong>{p.iniciar.bloquean.join(', ')}</strong>.</li>}
          {p.terminar.bloquean.length > 0 && <li className="rounded-md bg-red-50 px-3 py-1.5 text-red-700">Para cerrar la orden falta completar: <strong>{p.terminar.bloquean.join(', ')}</strong>.</li>}
          {[...p.iniciar.avisan, ...p.terminar.avisan].length > 0 && <li className="rounded-md bg-amber-50 px-3 py-1.5 text-amber-900">Se recomienda completar: {[...new Set([...p.iniciar.avisan, ...p.terminar.avisan])].join(', ')}.</li>}
        </ul>
      )}
      {datos.datos && datos.datos.checklists.length === 0 && <p className="text-sm text-gray-500">Esta orden todavía no tiene checklists.</p>}
      <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 bg-white">
        {(datos.datos?.checklists ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
            <span className="font-medium text-gray-900">{c.tipo} <span className="font-normal text-gray-500">· {c.respondidas}/{c.total}</span></span>
            <span className="flex items-center gap-3"><Badge variant={ESTADO[c.estado].v}>{ESTADO[c.estado].t}</Badge><Acciones><BotonAccion onClick={() => setAbierto(c.id)}>{c.estado === 'completado' || !tiene('checklists.llenar') ? 'Ver' : 'Llenar'}</BotonAccion></Acciones></span>
          </li>
        ))}
      </ul>
      {tiene('checklists.llenar') && !cerrada && (
        <div className="flex flex-wrap items-center gap-2">
          <select className="rounded-md border border-gray-300 px-3 py-2 text-sm" value={nuevo} onChange={(e) => setNuevo(e.target.value)} aria-label="Tipo de checklist">
            <option value="">Agregar un checklist…</option>
            {(tipos.datos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
          <Button size="sm" disabled={!nuevo} onClick={() => void agregar()}>Abrir</Button>
        </div>
      )}
      {abierto !== null && <LlenarChecklist id={abierto} alCerrar={() => { setAbierto(null); datos.recargar(); alCambiar?.(); }} alCambiar={() => datos.recargar()} />}
    </section>
  );
}
