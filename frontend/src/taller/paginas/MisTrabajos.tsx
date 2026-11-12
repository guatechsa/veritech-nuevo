import { useEffect, useState } from 'react';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import { Aviso, mensajeDe, useLista } from '../componentes/ui';
import { useSesionTaller } from '../Sesion';
import { FotoLinea, FotosLinea } from './ordenes/FotosLinea';
import { ESTADO_LINEA, EstadoLinea, formatoHoras, PRIORIDAD } from './ordenes/tipos';

interface Trabajo {
  id: number;
  orden_id: number;
  numero: string;
  prioridad: string;
  orden_descripcion: string | null;
  cliente: string | null;
  equipo: string;
  descripcion: string;
  horas_trabajo: number | null;
  estado: EstadoLinea;
  notas: string | null;
  horas_reales: number;
  tramo_desde: string | null;
  fotos: FotoLinea[];
}

interface MisTrabajosDatos {
  ocupado: boolean;
  trabajos: Trabajo[];
}

const DETENER_POR: Array<{ k: EstadoLinea; t: string }> = [
  { k: 'detenido_material', t: 'Falta material' },
  { k: 'detenido_terceros', t: 'Espera trabajo de terceros' },
  { k: 'detenido_autorizacion', t: 'Espera autorización' },
  { k: 'detenido_espacio', t: 'Falta espacio' },
];

function Tarjeta({ t, ocupado, alCambiar }: { t: Trabajo; ocupado: boolean; alCambiar: () => void }) {
  const { api } = useSesionTaller();
  const [error, setError] = useState('');
  const [fotos, setFotos] = useState(false);
  const [trabajando, setTrabajando] = useState(false);
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    if (!t.tramo_desde) return;
    const reloj = setInterval(() => setAhora(Date.now()), 30000);
    return () => clearInterval(reloj);
  }, [t.tramo_desde]);

  const cambiar = async (estado: EstadoLinea): Promise<void> => {
    setError('');
    setTrabajando(true);
    try {
      await api.post(`/lineas/${t.id}/estado`, { estado });
      alCambiar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo cambiar el estado'));
    } finally {
      setTrabajando(false);
    }
  };
  const enCurso = t.estado === 'en_proceso';
  const tramo = t.tramo_desde ? Math.max(0, (ahora - new Date(t.tramo_desde).getTime()) / 3600000) : 0;
  return (
    <article className={`space-y-3 rounded-lg border bg-white p-4 shadow-sm ${enCurso ? 'border-primary ring-1 ring-primary' : 'border-gray-200'}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-gray-900">{t.numero}</span>
        <span className="flex items-center gap-2">
          <Badge variant={PRIORIDAD[t.prioridad]?.variante ?? 'default'}>{PRIORIDAD[t.prioridad]?.texto ?? t.prioridad}</Badge>
          <Badge variant={ESTADO_LINEA[t.estado].variante}>{ESTADO_LINEA[t.estado].texto}</Badge>
        </span>
      </div>
      <div>
        <p className="text-base font-semibold text-gray-900">{t.descripcion}</p>
        <p className="text-sm text-gray-600">{t.equipo} · {t.cliente ?? 'Del taller'}</p>
        {t.orden_descripcion && <p className="mt-1 text-sm text-gray-700">Pedido: {t.orden_descripcion}</p>}
      </div>
      <p className="text-sm text-gray-600">
        Horas del trabajo: <strong>{t.horas_trabajo ?? '—'}</strong> · Trabajadas: <strong>{formatoHoras(t.horas_reales)}</strong>
        {enCurso && t.tramo_desde && <span className="ml-1 text-primary">· corriendo desde hace {formatoHoras(tramo)}</span>}
      </p>
      <Aviso mensaje={error} tipo="error" />
      <div className="flex flex-wrap items-center gap-2">
        {!enCurso && <Button disabled={trabajando || ocupado} onClick={() => void cambiar('en_proceso')}>{t.estado === 'pendiente' ? 'Iniciar' : 'Continuar'}</Button>}
        {enCurso && <Button variant="outline" disabled={trabajando} onClick={() => void cambiar('pausado')}>Pausar</Button>}
        {enCurso && (
          <select className="rounded-md border border-gray-300 px-3 py-2 text-sm" value="" aria-label="Detener por" disabled={trabajando} onChange={(e) => e.target.value && void cambiar(e.target.value as EstadoLinea)}>
            <option value="">Detener por…</option>
            {DETENER_POR.map((d) => <option key={d.k} value={d.k}>{d.t}</option>)}
          </select>
        )}
        {(enCurso || t.estado !== 'pendiente') && <Button variant="primary" disabled={trabajando} onClick={() => void cambiar('terminado')}>Terminar</Button>}
        <Button variant="outline" onClick={() => setFotos(true)}>Fotos ({t.fotos.length})</Button>
      </div>
      {!enCurso && ocupado && <p className="text-xs text-gray-500">Ya tiene un trabajo en proceso: páuselo o termínelo para iniciar otro.</p>}
      {fotos && <FotosLinea lineaId={t.id} titulo={`${t.numero} · ${t.descripcion}`} fotos={t.fotos} puedeCambiar alCerrar={() => setFotos(false)} alCambiar={alCambiar} />}
    </article>
  );
}

/** Pantalla del técnico: sus trabajos pendientes, lo urgente primero, con botones grandes para iniciar, pausar, detener o terminar. */
export default function MisTrabajos() {
  const { api } = useSesionTaller();
  const lista = useLista(() => api.get<MisTrabajosDatos>('/mis-trabajos'), [api]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900">Mis trabajos</h1>
        <Button variant="outline" size="sm" onClick={lista.recargar}>Actualizar</Button>
      </div>
      <Aviso mensaje={lista.error} tipo="error" />
      {lista.datos && lista.datos.trabajos.length === 0 && <p className="rounded-md bg-white p-4 text-sm text-gray-600 shadow-sm">No tiene trabajos pendientes. Cuando le asignen uno en una orden, aparecerá aquí.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        {(lista.datos?.trabajos ?? []).map((t) => <Tarjeta key={t.id} t={t} ocupado={lista.datos?.ocupado === true && t.estado !== 'en_proceso'} alCambiar={lista.recargar} />)}
      </div>
    </div>
  );
}
