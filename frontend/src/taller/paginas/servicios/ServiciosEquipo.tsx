import { FormEvent, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { formatFecha } from '../../../components/ui-guatech/formatoFecha.js';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { ESTADO_SERVICIO, ServicioDeEquipo, textoRestante } from './tipos';

interface Realizado {
  id: number;
  servicio_id: number;
  servicio: string;
  contador_valor: number;
  fecha: string;
  origen: string;
  motivo: string | null;
  orden_numero: string | null;
  registrado_por: string | null;
  anulado_en: string | null;
  motivo_anulacion: string | null;
}
interface Datos {
  servicios: ServicioDeEquipo[];
  historial: Realizado[];
}

function CargarAnterior({ equipoId, servicios, alCerrar, alListo }: { equipoId: number; servicios: ServicioDeEquipo[]; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [servicio, setServicio] = useState('');
  const [fecha, setFecha] = useState('');
  const [valor, setValor] = useState('');
  const [origen, setOrigen] = useState<'historico' | 'excepcion'>('historico');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const elegido = servicios.find((s) => String(s.servicio_id) === servicio);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/servicios/realizados', { equipo_id: equipoId, servicio_id: Number(servicio), fecha, origen, ...(valor.trim() !== '' ? { contador_valor: Number(valor) } : {}), motivo: motivo.trim() || null });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Cargar un servicio ya hecho" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <Campo etiqueta="Servicio"><select className={CLASE_INPUT} value={servicio} onChange={(e) => setServicio(e.target.value)} required><option value="">Elija…</option>{servicios.map((s) => <option key={s.servicio_id} value={s.servicio_id}>{s.servicio}</option>)}</select></Campo>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Día en que se hizo"><FechaInput value={fecha} onChange={(e) => setFecha(e.target.value)} required className={CLASE_INPUT} /></Campo>
          <Campo etiqueta={`Qué marcaba el contador${elegido ? ` (${elegido.unidad})` : ''}`} ayuda="En contadores de calendario se calcula solo."><input className={CLASE_INPUT} type="number" step="any" value={valor} onChange={(e) => setValor(e.target.value)} /></Campo>
        </div>
        <Campo etiqueta="Qué se registra">
          <select className={CLASE_INPUT} value={origen} onChange={(e) => setOrigen(e.target.value as typeof origen)}>
            <option value="historico">Un servicio anterior (de antes del sistema)</option>
            <option value="excepcion">Un servicio hecho sin su checklist (excepción)</option>
          </select>
        </Campo>
        {origen === 'excepcion' && <Campo etiqueta="Motivo de la excepción"><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} required /></Campo>}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

/** Pestaña «Servicios» de la ficha del equipo: cómo va cada servicio y lo que ya se hizo. */
export function ServiciosEquipo({ equipoId }: { equipoId: number }) {
  const { api, tiene } = useSesionTaller();
  const datos = useLista(() => api.get<Datos>(`/equipos/${equipoId}/servicios`), [api, equipoId]);
  const [cargando, setCargando] = useState(false);
  const [anulando, setAnulando] = useState<Realizado | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');

  const anular = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!anulando) return;
    try {
      await api.post(`/servicios/realizados/${anulando.id}/anular`, { motivo });
      setAnulando(null);
      setMotivo('');
      datos.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo anular'));
    }
  };
  const columnas: Array<Columna<ServicioDeEquipo>> = [
    { clave: 'servicio', etiqueta: 'Servicio', valor: (s) => s.servicio },
    { clave: 'estado', etiqueta: 'Estado', valor: (s) => s.estado, render: (s) => <Badge variant={ESTADO_SERVICIO[s.estado].variante}>{ESTADO_SERVICIO[s.estado].texto}</Badge> },
    { clave: 'restante', etiqueta: 'Cuánto falta', valor: (s) => s.restante ?? 0, render: (s) => textoRestante(s), alinear: 'right' },
    { clave: 'ultimo', etiqueta: 'Último servicio', render: (s) => (s.ultimo_servicio ? `${s.ultimo_servicio.valor} ${s.unidad} · ${formatFecha(s.ultimo_servicio.fecha)}` : 'Ninguno registrado') },
    { clave: 'fecha', etiqueta: 'Fecha estimada', valor: (s) => s.fecha_estimada ?? '', render: (s) => (s.fecha_estimada ? formatFecha(s.fecha_estimada) : s.estado === 'sin_contador' ? '—' : 'Sin lecturas suficientes') },
  ];
  const histCols: Array<Columna<Realizado>> = [
    { clave: 'fecha', etiqueta: 'Fecha', valor: (r) => r.fecha, render: (r) => formatFecha(r.fecha) },
    { clave: 'servicio', etiqueta: 'Servicio', valor: (r) => r.servicio, render: (r) => <span className={r.anulado_en ? 'text-gray-400 line-through' : ''}>{r.servicio}</span> },
    { clave: 'valor', etiqueta: 'Contador', valor: (r) => r.contador_valor, alinear: 'right' },
    { clave: 'origen', etiqueta: 'Cómo se registró', valor: (r) => r.origen, render: (r) => <span>{r.origen === 'CHECKLIST' ? `Con su checklist${r.orden_numero ? ` (orden ${r.orden_numero})` : ''}` : r.origen === 'HISTORICO' ? 'Servicio anterior' : r.origen === 'EXCEPCION' ? `Excepción: ${r.motivo ?? ''}` : r.origen}{r.registrado_por ? <span className="block text-xs text-gray-500">{r.registrado_por}</span> : null}{r.anulado_en ? <span className="block text-xs text-red-700">Anulado: {r.motivo_anulacion}</span> : null}</span> },
    { clave: 'acc', etiqueta: 'Acciones', render: (r) => (tiene('servicios.registrar') && !r.anulado_en ? <Acciones><BotonAccion onClick={() => setAnulando(r)}>Anular</BotonAccion></Acciones> : null) },
  ];
  return (
    <div className="space-y-4">
      <Aviso mensaje={error || datos.error} tipo="error" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-gray-900">Cómo va cada servicio</h3>
        {tiene('servicios.registrar') && datos.datos && datos.datos.servicios.length > 0 && <Button size="sm" variant="outline" onClick={() => setCargando(true)}>Cargar un servicio ya hecho</Button>}
      </div>
      <Tabla columnas={columnas} filas={datos.datos?.servicios ?? []} clave={(s) => s.servicio_id} vacio={datos.datos ? 'Este tipo de equipo no tiene servicios programados. Se definen en Servicios → Programas.' : 'Cargando…'} />
      <h3 className="text-sm font-bold text-gray-900">Lo que ya se hizo</h3>
      <Tabla columnas={histCols} filas={datos.datos?.historial ?? []} clave={(r) => r.id} vacio="Todavía no hay servicios registrados." />
      {cargando && datos.datos && <CargarAnterior equipoId={equipoId} servicios={datos.datos.servicios} alCerrar={() => setCargando(false)} alListo={() => { setCargando(false); datos.recargar(); }} />}
      {anulando && (
        <Modal onClose={() => setAnulando(null)} title="Anular el registro" size="sm">
          <form onSubmit={anular} className="space-y-3">
            <p className="text-sm text-gray-700">No se borra: queda anulado con su motivo y el servicio vuelve a contarse desde el anterior.</p>
            <Campo etiqueta="Motivo"><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} minLength={3} maxLength={300} required autoFocus /></Campo>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={() => setAnulando(null)}>Volver</Button><Button type="submit" variant="danger">Anular</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}
