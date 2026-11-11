import { useEffect, useState } from 'react';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import FechaInput, { HoraInput } from '../../../components/ui-guatech/FechaInput';
import { formatFecha } from '../../../components/ui-guatech/formatoFecha.js';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

const DIAS = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];

export interface DiaJornada {
  dia_semana: number;
  desde: string;
  hasta: string;
  pausa_desde: string | null;
  pausa_hasta: string | null;
}

interface FilaEditable {
  trabaja: boolean;
  desde: string;
  hasta: string;
  almuerzo: boolean;
  pausa_desde: string;
  pausa_hasta: string;
}

function aFilas(dias: DiaJornada[]): FilaEditable[] {
  return DIAS.map((_, i) => {
    const d = dias.find((x) => x.dia_semana === i + 1);
    return {
      trabaja: !!d,
      desde: d?.desde ?? '08:00',
      hasta: d?.hasta ?? '17:00',
      almuerzo: !!d?.pausa_desde,
      pausa_desde: d?.pausa_desde ?? '12:00',
      pausa_hasta: d?.pausa_hasta ?? '13:00',
    };
  });
}

function aDias(filas: FilaEditable[]): DiaJornada[] {
  return filas.flatMap((f, i) => (f.trabaja ? [{ dia_semana: i + 1, desde: f.desde, hasta: f.hasta, pausa_desde: f.almuerzo ? f.pausa_desde : null, pausa_hasta: f.almuerzo ? f.pausa_hasta : null }] : []));
}

/** Editor de una jornada semanal: un renglón por día, con su almuerzo. Un día sin marcar es de descanso. */
export function EditorJornada({ dias, alGuardar, deshabilitado, textoGuardar = 'Guardar jornada' }: { dias: DiaJornada[]; alGuardar: (dias: DiaJornada[]) => Promise<void>; deshabilitado?: boolean; textoGuardar?: string }) {
  const [filas, setFilas] = useState<FilaEditable[]>(() => aFilas(dias));
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);
  useEffect(() => setFilas(aFilas(dias)), [dias]);
  const poner = (i: number, cambios: Partial<FilaEditable>): void => {
    setListo(false);
    setFilas((f) => f.map((x, j) => (j === i ? { ...x, ...cambios } : x)));
  };
  const guardar = async (): Promise<void> => {
    setError('');
    try {
      await alGuardar(aDias(filas));
      setListo(true);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar la jornada'));
    }
  };
  return (
    <div className="space-y-3">
      <Aviso mensaje={error} tipo="error" />
      <Aviso mensaje={listo ? 'La jornada se guardó.' : ''} tipo="ok" />
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-left text-xs uppercase text-gray-600">
              <th className="px-3 py-2">Día</th><th className="px-3 py-2">Trabaja</th><th className="px-3 py-2">Entrada</th><th className="px-3 py-2">Salida</th><th className="px-3 py-2">Almuerzo</th><th className="px-3 py-2">De</th><th className="px-3 py-2">A</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr key={DIAS[i]} className="border-t border-gray-100">
                <td className="px-3 py-1.5 font-medium">{DIAS[i]}</td>
                <td className="px-3 py-1.5"><input type="checkbox" aria-label={`${DIAS[i]} trabaja`} checked={f.trabaja} disabled={deshabilitado} onChange={(e) => poner(i, { trabaja: e.target.checked })} /></td>
                <td className="px-3 py-1.5"><HoraInput value={f.desde} disabled={deshabilitado || !f.trabaja} onChange={(e) => poner(i, { desde: e.target.value })} className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" /></td>
                <td className="px-3 py-1.5"><HoraInput value={f.hasta} disabled={deshabilitado || !f.trabaja} onChange={(e) => poner(i, { hasta: e.target.value })} className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" /></td>
                <td className="px-3 py-1.5"><input type="checkbox" aria-label={`${DIAS[i]} almuerzo`} checked={f.almuerzo} disabled={deshabilitado || !f.trabaja} onChange={(e) => poner(i, { almuerzo: e.target.checked })} /></td>
                <td className="px-3 py-1.5"><HoraInput value={f.pausa_desde} disabled={deshabilitado || !f.trabaja || !f.almuerzo} onChange={(e) => poner(i, { pausa_desde: e.target.value })} className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" /></td>
                <td className="px-3 py-1.5"><HoraInput value={f.pausa_hasta} disabled={deshabilitado || !f.trabaja || !f.almuerzo} onChange={(e) => poner(i, { pausa_hasta: e.target.value })} className="w-24 rounded border border-gray-300 px-2 py-1 text-sm" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!deshabilitado && <div className="flex justify-end"><Button onClick={() => void guardar()}>{textoGuardar}</Button></div>}
    </div>
  );
}

// ── Ausencias ────────────────────────────────────────────────────────────────────────
export interface Ausencia {
  id: number;
  colaborador_id: number;
  colaborador: string;
  desde: string;
  hasta: string;
  tipo: 'vacaciones' | 'permiso' | 'incapacidad' | 'otro';
  notas: string | null;
}

const TIPOS: Record<Ausencia['tipo'], string> = { vacaciones: 'Vacaciones', permiso: 'Permiso', incapacidad: 'Incapacidad', otro: 'Otro' };

export function FormAusencia({ colaboradorId, colaboradores, alCerrar, alGuardar }: { colaboradorId?: number; colaboradores?: Array<{ id: number; nombre_completo: string }>; alCerrar: () => void; alGuardar: () => void }) {
  const { api } = useSesionTaller();
  const [quien, setQuien] = useState(String(colaboradorId ?? colaboradores?.[0]?.id ?? ''));
  const [tipo, setTipo] = useState<Ausencia['tipo']>('vacaciones');
  const [desde, setDesde] = useState('');
  const [hasta, setHasta] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const guardar = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!desde || !hasta) return setError('Elija las dos fechas.');
    try {
      await api.post('/ausencias', { colaborador_id: Number(quien), tipo, desde, hasta, notas: notas.trim() || null });
      alGuardar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Nueva ausencia" size="md">
      <form onSubmit={guardar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        {!colaboradorId && (
          <Campo etiqueta="Colaborador">
            <select className={CLASE_INPUT} value={quien} onChange={(e) => setQuien(e.target.value)} required>
              {(colaboradores ?? []).map((c) => <option key={c.id} value={c.id}>{c.nombre_completo}</option>)}
            </select>
          </Campo>
        )}
        <Campo etiqueta="Tipo">
          <select className={CLASE_INPUT} value={tipo} onChange={(e) => setTipo(e.target.value as Ausencia['tipo'])}>
            {Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Desde"><FechaInput value={desde} onChange={(e) => setDesde(e.target.value)} className={CLASE_INPUT} required /></Campo>
          <Campo etiqueta="Hasta"><FechaInput value={hasta} onChange={(e) => setHasta(e.target.value)} className={CLASE_INPUT} required /></Campo>
        </div>
        <Campo etiqueta="Notas (opcional)"><input className={CLASE_INPUT} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

export function TablaAusencias({ ausencias, puedeEditar, alEliminar, conColaborador }: { ausencias: Ausencia[] | null; puedeEditar: boolean; alEliminar: (a: Ausencia) => void; conColaborador: boolean }) {
  const columnas: Array<Columna<Ausencia>> = [
    ...(conColaborador ? [{ clave: 'colaborador', etiqueta: 'Colaborador', valor: (a: Ausencia) => a.colaborador }] : []),
    { clave: 'tipo', etiqueta: 'Tipo', valor: (a) => a.tipo, render: (a) => TIPOS[a.tipo] },
    { clave: 'desde', etiqueta: 'Desde', valor: (a) => a.desde, render: (a) => formatFecha(a.desde) as string },
    { clave: 'hasta', etiqueta: 'Hasta', valor: (a) => a.hasta, render: (a) => formatFecha(a.hasta) as string },
    { clave: 'notas', etiqueta: 'Notas', valor: (a) => a.notas ?? '', render: (a) => a.notas ?? '—' },
    { clave: 'acciones', etiqueta: 'Acciones', render: (a) => puedeEditar && <Acciones><BotonAccion onClick={() => alEliminar(a)}>Eliminar</BotonAccion></Acciones> },
  ];
  return <Tabla columnas={columnas} filas={ausencias ?? []} clave={(a) => a.id} vacio={ausencias ? 'No hay ausencias registradas.' : 'Cargando…'} />;
}

/** Pestaña «Jornada y ausencias»: la jornada de la empresa y las ausencias de todo el equipo. */
export function JornadaYAusencias() {
  const { api, tiene } = useSesionTaller();
  const edita = tiene('configuracion.editar');
  const jornada = useLista(() => api.get<DiaJornada[]>('/jornada'), [api]);
  const ausencias = useLista(() => api.get<Ausencia[]>('/ausencias'), [api]);
  const colabs = useLista(() => api.get<Array<{ id: number; nombre_completo: string; activo: number }>>('/colaboradores?activo=true'), [api]);
  const [nueva, setNueva] = useState(false);
  const [error, setError] = useState('');
  const puedeAusencias = tiene('colaboradores.editar');

  const eliminar = async (a: Ausencia): Promise<void> => {
    if (!window.confirm(`¿Eliminar la ausencia de ${a.colaborador}?`)) return;
    try {
      await api.delete(`/ausencias/${a.id}`);
      ausencias.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo eliminar'));
    }
  };
  return (
    <div className="space-y-8">
      <Seccion titulo="Jornada de trabajo de la empresa">
        <p className="text-sm text-gray-600">Es la jornada de todos, salvo quien tenga la suya propia (se cambia en la ficha de cada colaborador). Un día sin marcar es de descanso.</p>
        <Aviso mensaje={jornada.error} tipo="error" />
        {jornada.datos && (
          <EditorJornada
            dias={jornada.datos}
            deshabilitado={!edita}
            alGuardar={async (dias) => {
              await api.put('/jornada', { dias });
              jornada.recargar();
            }}
          />
        )}
      </Seccion>
      <Seccion titulo="Ausencias del equipo" acciones={puedeAusencias && <Button onClick={() => setNueva(true)}>Nueva ausencia</Button>}>
        <p className="text-sm text-gray-600">Vacaciones, permisos e incapacidades: se usan para no asignar trabajo a quien no está y para calcular la capacidad del taller.</p>
        <Aviso mensaje={ausencias.error || error} tipo="error" />
        <TablaAusencias ausencias={ausencias.datos} puedeEditar={puedeAusencias} alEliminar={(a) => void eliminar(a)} conColaborador />
      </Seccion>
      {nueva && <FormAusencia colaboradores={colabs.datos ?? []} alCerrar={() => setNueva(false)} alGuardar={() => { setNueva(false); ausencias.recargar(); }} />}
    </div>
  );
}
