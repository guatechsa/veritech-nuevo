import { FormEvent, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { fechaHoraLocal } from '../../../utils/hora';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { FiltrosVista, PERIODOS } from './filtros';

type Frecuencia = 'diaria' | 'semanal' | 'mensual';

interface Programado {
  id: number;
  nombre: string;
  reporte: string;
  filtros: FiltrosVista;
  frecuencia: Frecuencia;
  dia_semana: number | null;
  dia_mes: number | null;
  con_dinero: boolean;
  activo: boolean;
  creado_por: string | null;
  ultimo_envio_en: string | null;
  roles: number[];
  usuarios: number[];
  correos: string[];
}

interface Lista {
  programados: Programado[];
  roles: Array<{ id: number; nombre: string }>;
  personas: Array<{ id: number; nombre: string; correo: string | null }>;
}

interface Reporte {
  codigo: string;
  titulo: string;
  financiero: boolean;
}

const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];

function cuando(p: Programado): string {
  if (p.frecuencia === 'diaria') return 'Todos los días';
  if (p.frecuencia === 'semanal') return `Cada ${DIAS[p.dia_semana ?? 1]}`;
  return `El día ${p.dia_mes} de cada mes`;
}

function Editar({ inicial, lista, reportes, alCerrar, alGuardar }: { inicial: Programado | null; lista: Lista; reportes: Reporte[]; alCerrar: () => void; alGuardar: () => void }) {
  const { api } = useSesionTaller();
  const sucursales = useLista(() => api.get<Array<{ id: number; nombre: string }>>('/sucursales'), [api]);
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [reporte, setReporte] = useState(inicial?.reporte ?? reportes[0]?.codigo ?? 'indicadores');
  const [periodo, setPeriodo] = useState<string>(inicial?.filtros.periodo ?? 'este_mes');
  const [sucursal, setSucursal] = useState(inicial?.filtros.sucursal_id ? String(inicial.filtros.sucursal_id) : '');
  const [frecuencia, setFrecuencia] = useState<Frecuencia>(inicial?.frecuencia ?? 'semanal');
  const [diaSemana, setDiaSemana] = useState(String(inicial?.dia_semana ?? 1));
  const [diaMes, setDiaMes] = useState(String(inicial?.dia_mes ?? 1));
  const [activo, setActivo] = useState(inicial?.activo ?? true);
  const [roles, setRoles] = useState<number[]>(inicial?.roles ?? []);
  const [usuarios, setUsuarios] = useState<number[]>(inicial?.usuarios ?? []);
  const [correos, setCorreos] = useState((inicial?.correos ?? []).join(', '));
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const alternar = <T,>(valores: T[], valor: T): T[] => (valores.includes(valor) ? valores.filter((v) => v !== valor) : [...valores, valor]);

  const guardar = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault();
    setError('');
    setGuardando(true);
    const cuerpo = {
      nombre: nombre.trim(),
      reporte,
      filtros: { periodo, ...(sucursal ? { sucursal_id: Number(sucursal) } : {}) },
      frecuencia,
      dia_semana: frecuencia === 'semanal' ? Number(diaSemana) : null,
      dia_mes: frecuencia === 'mensual' ? Number(diaMes) : null,
      activo,
      roles,
      usuarios,
      correos: correos.split(/[\s,;]+/).filter((c) => c.length > 0),
    };
    try {
      if (inicial) await api.put(`/reportes-programados/${inicial.id}`, cuerpo);
      else await api.post('/reportes-programados', cuerpo);
      alGuardar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <Modal onClose={alCerrar} title={inicial ? 'Cambiar envío programado' : 'Nuevo envío programado'} size="lg">
      <form onSubmit={(ev) => void guardar(ev)} className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        <Campo etiqueta="Nombre del envío"><input className={CLASE_INPUT} value={nombre} maxLength={80} onChange={(e) => setNombre(e.target.value)} placeholder="Resumen semanal para gerencia" required autoFocus /></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Reporte"><select className={CLASE_INPUT} value={reporte} onChange={(e) => setReporte(e.target.value)}>{reportes.map((r) => <option key={r.codigo} value={r.codigo}>{r.titulo}</option>)}</select></Campo>
          <Campo etiqueta="Periodo" ayuda="Se mueve solo: «Este mes» siempre es el mes en curso al momento de enviar."><select className={CLASE_INPUT} value={periodo} onChange={(e) => setPeriodo(e.target.value)}>{PERIODOS.map((p) => <option key={p.k} value={p.k}>{p.t}</option>)}</select></Campo>
          <Campo etiqueta="Sucursal"><select className={CLASE_INPUT} value={sucursal} onChange={(e) => setSucursal(e.target.value)}><option value="">Todas</option>{(sucursales.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Cada"><select className={CLASE_INPUT} value={frecuencia} onChange={(e) => setFrecuencia(e.target.value as Frecuencia)}><option value="diaria">Día</option><option value="semanal">Semana</option><option value="mensual">Mes</option></select></Campo>
          {frecuencia === 'semanal' && <Campo etiqueta="El día"><select className={CLASE_INPUT} value={diaSemana} onChange={(e) => setDiaSemana(e.target.value)}>{[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{DIAS[d]}</option>)}</select></Campo>}
          {frecuencia === 'mensual' && <Campo etiqueta="El día del mes (1 a 28)"><input className={CLASE_INPUT} type="number" min={1} max={28} value={diaMes} onChange={(e) => setDiaMes(e.target.value)} /></Campo>}
        </div>
        <p className="text-xs text-gray-600">Sale a partir de las 7:00 de la mañana (hora del taller), una sola vez ese día.</p>
        <fieldset className="space-y-2 rounded-md border border-gray-200 p-3">
          <legend className="px-1 text-sm font-bold text-gray-800">¿A quién se le envía?</legend>
          <div className="grid gap-1 sm:grid-cols-2">
            {lista.roles.map((r) => <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={roles.includes(r.id)} onChange={() => setRoles(alternar(roles, r.id))} /> Todos los de {r.nombre}</label>)}
          </div>
          <div className="grid max-h-36 gap-1 overflow-y-auto sm:grid-cols-2">
            {lista.personas.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-sm" title={p.correo ?? 'No tiene correo registrado'}>
                <input type="checkbox" checked={usuarios.includes(p.id)} onChange={() => setUsuarios(alternar(usuarios, p.id))} /> {p.nombre}{!p.correo && <Badge variant="warning">Sin correo</Badge>}
              </label>
            ))}
          </div>
          <Campo etiqueta="Otros correos (separados por coma)"><input className={CLASE_INPUT} value={correos} onChange={(e) => setCorreos(e.target.value)} placeholder="gerencia@miempresa.com" /></Campo>
        </fieldset>
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Envío activo</label>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={alCerrar}>Cancelar</Button>
          <Button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Envíos programados de reportes por correo (el reporte va dentro del mensaje). */
export function EnviosProgramados() {
  const { api } = useSesionTaller();
  const lista = useLista(() => api.get<Lista>('/reportes-programados'), [api]);
  const reportes = useLista(() => api.get<Reporte[]>('/reporte-catalogo'), [api]);
  const [editando, setEditando] = useState<Programado | 'nuevo' | null>(null);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const nombreDe = (codigo: string): string => (reportes.datos ?? []).find((r) => r.codigo === codigo)?.titulo ?? codigo;
  const quienes = (p: Programado): string =>
    [...p.roles.map((id) => lista.datos?.roles.find((r) => r.id === id)?.nombre ?? ''), ...p.usuarios.map((id) => lista.datos?.personas.find((x) => x.id === id)?.nombre ?? ''), ...p.correos].filter((x) => x).join(' · ') || 'Nadie';

  const probar = async (p: Programado): Promise<void> => {
    setError('');
    setMensaje('');
    try {
      const r = await api.post<{ enviado_a: string }>(`/reportes-programados/${p.id}/probar`, {});
      setMensaje(`Le enviamos una prueba a ${r.enviado_a}.`);
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo enviar la prueba'));
    }
  };
  const eliminar = async (p: Programado): Promise<void> => {
    if (!window.confirm(`¿Eliminar el envío «${p.nombre}»?`)) return;
    setError('');
    setMensaje('');
    try {
      await api.delete(`/reportes-programados/${p.id}`);
      lista.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo eliminar'));
    }
  };

  return (
    <Seccion titulo="Envíos programados por correo" acciones={<Button onClick={() => setEditando('nuevo')}>Nuevo envío</Button>}>
      <p className="text-sm text-gray-700">El sistema manda un reporte por correo con la frecuencia que usted elija (por ejemplo, el resumen del mes a gerencia cada lunes). El reporte viaja dentro del mensaje; para bajarlo en Excel o PDF, entre a Reportes.</p>
      <Aviso mensaje={error || lista.error || reportes.error} tipo="error" />
      <Aviso mensaje={mensaje} tipo="ok" />
      {(lista.datos?.programados ?? []).length === 0 && lista.datos && <p className="text-sm text-gray-500">Todavía no hay envíos programados.</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        {(lista.datos?.programados ?? []).map((p) => (
          <section key={p.id} className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h3 className="text-sm font-bold text-gray-900">{p.nombre}</h3>
              {p.activo ? <Badge variant="success">Activo</Badge> : <Badge variant="default">Apagado</Badge>}
            </div>
            <p className="text-xs text-gray-700">{nombreDe(p.reporte)} · {PERIODOS.find((x) => x.k === p.filtros.periodo)?.t ?? p.filtros.periodo} · {cuando(p)}</p>
            <p className="text-xs text-gray-700"><span className="font-medium">Se envía a:</span> {quienes(p)}</p>
            <p className="text-xs text-gray-500">{p.ultimo_envio_en ? `Último envío: ${fechaHoraLocal(p.ultimo_envio_en)}` : 'Todavía no se ha enviado'}{p.creado_por ? ` · lo programó ${p.creado_por}` : ''}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => void probar(p)}>Enviarme una prueba</Button>
              <Button size="sm" variant="outline" onClick={() => setEditando(p)}>Cambiar</Button>
              <Button size="sm" variant="outline" onClick={() => void eliminar(p)}>Eliminar</Button>
            </div>
          </section>
        ))}
      </div>
      {editando && lista.datos && reportes.datos && (
        <Editar
          inicial={editando === 'nuevo' ? null : editando}
          lista={lista.datos}
          reportes={reportes.datos}
          alCerrar={() => setEditando(null)}
          alGuardar={() => {
            setEditando(null);
            lista.recargar();
          }}
        />
      )}
    </Seccion>
  );
}
