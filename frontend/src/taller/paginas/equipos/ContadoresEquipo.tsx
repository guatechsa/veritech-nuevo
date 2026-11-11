import { FormEvent, useState } from 'react';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import { formatFecha } from '../../../components/ui-guatech/formatoFecha.js';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { prepararArchivo } from '../../componentes/imagen';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { Contador, DetalleEquipo, Lectura } from './tipos';

const f = (iso: string | null): string => (iso ? (formatFecha(iso) as string) : '—');
const numero = (n: number): string => n.toLocaleString('es-GT', { maximumFractionDigits: 2 });

function RegistrarLectura({ contador, alCerrar, alListo }: { contador: Contador; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [valor, setValor] = useState('');
  const [fecha, setFecha] = useState('');
  const [notas, setNotas] = useState('');
  const [foto, setFoto] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      // La foto se prepara primero: si no sirve, no se registra nada a medias.
      const archivo = foto ? await prepararArchivo(foto, { soloImagen: true }) : null;
      const lectura = await api.post<Lectura>(`/contadores/${contador.id}/lecturas`, { valor: Number(valor), ...(fecha ? { fecha } : {}), notas: notas.trim() || null });
      if (archivo) await api.subir(`/lecturas/${lectura.id}/foto`, archivo.blob, archivo.nombre);
      alListo();
    } catch (err) {
      setError(err instanceof Error ? mensajeDe(err, err.message) : 'No se pudo registrar');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Modal onClose={alCerrar} title={`Registrar lectura: ${contador.nombre}`} size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">Última lectura: <strong>{numero(contador.valor_actual)} {contador.unidad}</strong>{contador.ultima_lectura_en ? ` (${f(contador.ultima_lectura_en)})` : ''}. El medidor solo avanza: la nueva lectura no puede ser menor.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta={`Lo que marca (${contador.unidad})`}><input type="number" min="0" step="0.01" className={CLASE_INPUT} value={valor} onChange={(e) => setValor(e.target.value)} required autoFocus /></Campo>
          <Campo etiqueta="Fecha de la lectura" ayuda="Vacía = hoy."><FechaInput value={fecha} onChange={(e) => setFecha(e.target.value)} className={CLASE_INPUT} /></Campo>
        </div>
        <Campo etiqueta="Notas (opcional)"><input className={CLASE_INPUT} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} /></Campo>
        <Campo etiqueta="Foto del tablero (opcional)"><input type="file" accept="image/*" capture="environment" onChange={(e) => setFoto(e.target.files?.[0] ?? null)} className="block w-full text-sm" /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" disabled={enviando}>Registrar</Button></div>
      </form>
    </Modal>
  );
}

function Historial({ contador, alCerrar, alCambiar }: { contador: Contador; alCerrar: () => void; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<Lectura[]>(`/contadores/${contador.id}/lecturas`), [api, contador.id]);
  const [anulando, setAnulando] = useState<Lectura | null>(null);
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const anular = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!anulando) return;
    try {
      await api.post(`/lecturas/${anulando.id}/anular`, { motivo });
      setAnulando(null);
      setMotivo('');
      lista.recargar();
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo anular'));
    }
  };
  const ORIGEN: Record<string, string> = { inicial: 'Inicial', orden: 'Orden de trabajo', checklist: 'Checklist', manual: 'Manual', portal: 'Portal del cliente', cita: 'Cita', importacion: 'Carga masiva' };
  const columnas: Array<Columna<Lectura>> = [
    { clave: 'fecha', etiqueta: 'Fecha', valor: (l) => l.fecha, render: (l) => f(l.fecha) },
    { clave: 'valor', etiqueta: `Lectura (${contador.unidad})`, valor: (l) => l.valor, render: (l) => <span className={l.estado === 'anulada' ? 'text-gray-400 line-through' : 'font-medium'}>{numero(l.valor)}</span>, alinear: 'right' },
    { clave: 'origen', etiqueta: 'Origen', valor: (l) => l.origen, render: (l) => ORIGEN[l.origen] ?? l.origen },
    { clave: 'por', etiqueta: 'Registró', valor: (l) => l.registrado_por ?? '', render: (l) => l.registrado_por ?? '—' },
    {
      clave: 'estado',
      etiqueta: 'Estado',
      valor: (l) => l.estado,
      render: (l) => (
        <span>
          <Badge variant={l.estado === 'valida' ? 'success' : l.estado === 'anulada' ? 'danger' : 'warning'}>{l.estado === 'valida' ? 'Válida' : l.estado === 'anulada' ? 'Anulada' : 'Por revisar'}</Badge>
          {l.estado === 'anulada' && <span className="mt-1 block text-xs text-gray-500">{l.motivo_anulacion} · {l.anulada_por ?? ''}</span>}
        </span>
      ),
    },
    {
      clave: 'acc',
      etiqueta: 'Acciones',
      render: (l) => (
        <Acciones>
          {l.foto_url && <BotonAccion onClick={() => window.open(l.foto_url as string, '_blank', 'noopener')}>Ver foto</BotonAccion>}
          {tiene('contadores.anular') && l.estado !== 'anulada' && l.origen !== 'inicial' && <BotonAccion onClick={() => { setError(''); setAnulando(l); }}>Anular</BotonAccion>}
        </Acciones>
      ),
    },
  ];
  return (
    <Modal onClose={alCerrar} title={`Lecturas: ${contador.nombre}`} size="xl">
      <div className="space-y-3">
        <Aviso mensaje={lista.error || (anulando ? '' : error)} tipo="error" />
        <p className="text-sm text-gray-600">Una lectura equivocada no se borra: se anula con su motivo y el contador vuelve a la mejor lectura que queda.</p>
        <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(l) => l.id} vacio={lista.datos ? 'Todavía no hay lecturas.' : 'Cargando…'} />
        {anulando && (
          <form onSubmit={anular} className="space-y-2 rounded-md border border-red-200 bg-red-50 p-3">
            <p className="text-sm text-red-900">Anular la lectura de <strong>{numero(anulando.valor)} {contador.unidad}</strong> del {f(anulando.fecha)}.</p>
            <Aviso mensaje={error} tipo="error" />
            <Campo etiqueta="Motivo (obligatorio)"><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} maxLength={300} autoFocus /></Campo>
            <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAnulando(null)}>Cancelar</Button><Button type="submit" variant="danger">Anular lectura</Button></div>
          </form>
        )}
      </div>
    </Modal>
  );
}

function NuevoContador({ equipo, alCerrar, alListo }: { equipo: DetalleEquipo; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const tipos = useLista(() => api.get<Array<{ id: number; nombre: string; es_calendario: number; activo: number }>>('/tipos-contador'), [api]);
  const [tipo, setTipo] = useState('');
  const [componente, setComponente] = useState('');
  const [valor, setValor] = useState('');
  const [fecha, setFecha] = useState('');
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const t = (tipos.datos ?? []).find((x) => String(x.id) === tipo);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post(`/equipos/${equipo.id}/contadores`, { tipo_contador_id: Number(tipo), componente_id: componente ? Number(componente) : null, nombre: nombre.trim() || null, valor_inicial: t?.es_calendario ? 0 : Number(valor || 0), ...(fecha ? { fecha_inicio: fecha } : {}) });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo crear'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Nuevo contador" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <Campo etiqueta="Tipo de contador"><select className={CLASE_INPUT} value={tipo} onChange={(e) => setTipo(e.target.value)} required><option value="">Elija…</option>{(tipos.datos ?? []).filter((x) => x.activo === 1).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>
        {equipo.componentes.filter((c) => c.activo === 1).length > 0 && (
          <Campo etiqueta="De qué parte" ayuda="Vacío = del equipo completo."><select className={CLASE_INPUT} value={componente} onChange={(e) => setComponente(e.target.value)}><option value="">Todo el equipo</option>{equipo.componentes.filter((c) => c.activo === 1).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>
        )}
        <Campo etiqueta="Nombre (opcional)" ayuda="Si lo deja vacío se usa el nombre del tipo."><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} /></Campo>
        {t && !t.es_calendario && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo etiqueta="Lo que marca hoy"><input type="number" min="0" step="0.01" className={CLASE_INPUT} value={valor} onChange={(e) => setValor(e.target.value)} /></Campo>
            <Campo etiqueta="Desde el día" ayuda="Vacío = hoy."><FechaInput value={fecha} onChange={(e) => setFecha(e.target.value)} className={CLASE_INPUT} /></Campo>
          </div>
        )}
        {t?.es_calendario ? <Campo etiqueta="Cuenta días desde" ayuda="Vacío = hoy."><FechaInput value={fecha} onChange={(e) => setFecha(e.target.value)} className={CLASE_INPUT} /></Campo> : null}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Crear contador</Button></div>
      </form>
    </Modal>
  );
}

/** Pestaña «Contadores» de la ficha del equipo. */
export function ContadoresEquipo({ equipo, alCambiar }: { equipo: DetalleEquipo; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const [leyendo, setLeyendo] = useState<Contador | null>(null);
  const [historial, setHistorial] = useState<Contador | null>(null);
  const [nuevo, setNuevo] = useState(false);
  const [error, setError] = useState('');
  const baja = equipo.estado === 'baja';
  const cambiar = async (c: Contador, cuerpo: Record<string, unknown>): Promise<void> => {
    try {
      await api.patch(`/contadores/${c.id}`, cuerpo);
      setError('');
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };
  const columnas: Array<Columna<Contador>> = [
    { clave: 'nombre', etiqueta: 'Contador', valor: (c) => c.nombre, render: (c) => <span><span className="block font-medium text-gray-900">{c.nombre}</span><span className="block text-xs text-gray-500">{c.componente ? `De ${c.componente}` : 'Del equipo completo'}</span></span> },
    { clave: 'valor', etiqueta: 'Valor actual', valor: (c) => c.valor_actual, render: (c) => <span className="font-semibold">{numero(c.valor_actual)} {c.unidad}</span>, alinear: 'right' },
    { clave: 'ultima', etiqueta: 'Última lectura', valor: (c) => c.ultima_lectura_en ?? '', render: (c) => (c.es_calendario ? 'Cuenta sola' : f(c.ultima_lectura_en)) },
    { clave: 'estado', etiqueta: 'Estado', valor: (c) => (c.activo ? 1 : 0), render: (c) => <span className="flex gap-1">{c.es_principal && <Badge variant="info">Principal</Badge>}<Badge variant={c.activo ? 'success' : 'default'}>{c.activo ? 'Activo' : 'Inactivo'}</Badge></span> },
    {
      clave: 'acc',
      etiqueta: 'Acciones',
      render: (c) => (
        <Acciones>
          {tiene('contadores.registrar') && c.activo && !c.es_calendario && !baja && <BotonAccion onClick={() => setLeyendo(c)}>Registrar lectura</BotonAccion>}
          {!c.es_calendario && <BotonAccion onClick={() => setHistorial(c)}>Lecturas</BotonAccion>}
          {tiene('contadores.gestionar') && c.activo && !c.es_principal && !baja && <BotonAccion onClick={() => void cambiar(c, { es_principal: true })}>Hacer principal</BotonAccion>}
          {tiene('contadores.gestionar') && !baja && <BotonAccion onClick={() => void cambiar(c, { activo: !c.activo })}>{c.activo ? 'Desactivar' : 'Activar'}</BotonAccion>}
        </Acciones>
      ),
    },
  ];
  return (
    <Seccion titulo="Contadores" acciones={tiene('contadores.gestionar') && !baja && <Button size="sm" onClick={() => setNuevo(true)}>Nuevo contador</Button>}>
      <Aviso mensaje={error} tipo="error" />
      <Tabla columnas={columnas} filas={equipo.contadores} clave={(c) => c.id} vacio="Este equipo no tiene contadores. Agregue un odómetro u horómetro para llevar su uso." />
      {leyendo && <RegistrarLectura contador={leyendo} alCerrar={() => setLeyendo(null)} alListo={() => { setLeyendo(null); alCambiar(); }} />}
      {historial && <Historial contador={historial} alCerrar={() => setHistorial(null)} alCambiar={alCambiar} />}
      {nuevo && <NuevoContador equipo={equipo} alCerrar={() => setNuevo(false)} alListo={() => { setNuevo(false); alCambiar(); }} />}
    </Seccion>
  );
}
