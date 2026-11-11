import { FormEvent, useEffect, useState } from 'react';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import { formatFecha, formatFechaHora } from '../../../components/ui-guatech/formatoFecha.js';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { aHoraDeGuatemala } from '../../../utils/hora';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { Ausencia, DiaJornada, EditorJornada, FormAusencia, TablaAusencias } from './Jornada';

interface FilaColaborador {
  id: number;
  codigo: string | null;
  nombre_completo: string;
  correo: string | null;
  celular: string | null;
  dpi: string | null;
  sucursal_id: number | null;
  sucursal: string | null;
  area_trabajo_id: number | null;
  nivel_tecnico_id: number | null;
  puestos: string | null;
  activo: number;
  usuario_id: number | null;
  usuario_activo: number | null;
  ultimo_ingreso: string | null;
}

interface Credencial {
  id: number;
  tipo_credencial_id: number;
  tipo: string;
  numero: string | null;
  vence: string | null;
  activo: boolean;
  estado: 'vigente' | 'por_vencer' | 'vencida' | 'sin_vencimiento';
}

interface Detalle extends FilaColaborador {
  direccion: string | null;
  puestos_detalle: Array<{ id: number; nombre: string; es_tecnico: boolean; es_operador: boolean }>;
  credenciales: Credencial[];
  credenciales_faltantes: string[];
  roles: Array<{ id: number; codigo: string; nombre: string }>;
}

interface Opcion {
  id: number;
  nombre: string;
}
interface Puesto extends Opcion {
  es_tecnico: number;
  activo: number;
}
interface Rol extends Opcion {
  codigo: string;
  activo: number;
}
interface TipoCred extends Opcion {
  requiere_vencimiento: number;
  activo: number;
}

// ── Datos de la persona (mismo formulario para crear y editar) ────────────────────────
function Datos({ detalle, alGuardar }: { detalle: Detalle | null; alGuardar: (id: number) => void }) {
  const { api, tiene } = useSesionTaller();
  const sucursales = useLista(() => api.get<Opcion[]>('/sucursales'), [api]);
  const areas = useLista(() => api.get<Opcion[]>('/areas'), [api]);
  const puestos = useLista(() => api.get<Puesto[]>('/puestos'), [api]);
  const niveles = useLista(() => api.get<Opcion[]>('/niveles-tecnico'), [api]);
  const [f, setF] = useState({ nombre: '', correo: '', celular: '', dpi: '', direccion: '', sucursal: '', area: '', nivel: '' });
  const [sel, setSel] = useState<number[]>([]);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState(false);
  const edita = detalle ? tiene('colaboradores.editar') : tiene('colaboradores.crear');

  useEffect(() => {
    setF({
      nombre: detalle?.nombre_completo ?? '',
      correo: detalle?.correo ?? '',
      celular: detalle?.celular ?? '',
      dpi: detalle?.dpi ?? '',
      direccion: detalle?.direccion ?? '',
      sucursal: detalle?.sucursal_id ? String(detalle.sucursal_id) : '',
      area: detalle?.area_trabajo_id ? String(detalle.area_trabajo_id) : '',
      nivel: detalle?.nivel_tecnico_id ? String(detalle.nivel_tecnico_id) : '',
    });
    setSel(detalle?.puestos_detalle.map((p) => p.id) ?? []);
  }, [detalle]);

  const esTecnico = (puestos.datos ?? []).some((p) => sel.includes(p.id) && p.es_tecnico === 1);
  const poner = (campo: keyof typeof f, valor: string): void => setF((x) => ({ ...x, [campo]: valor }));

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    if (sel.length === 0) return setError('Elija al menos un puesto.');
    setGuardando(true);
    const cuerpo = {
      nombre_completo: f.nombre,
      correo: f.correo.trim() === '' ? null : f.correo.trim(),
      celular: f.celular.trim() || null,
      dpi: f.dpi.trim() || null,
      direccion: f.direccion.trim() || null,
      sucursal_id: f.sucursal ? Number(f.sucursal) : null,
      area_trabajo_id: f.area ? Number(f.area) : null,
      nivel_tecnico_id: esTecnico && f.nivel ? Number(f.nivel) : null,
      puestos: sel,
    };
    try {
      if (detalle) {
        await api.patch(`/colaboradores/${detalle.id}`, cuerpo);
        alGuardar(detalle.id);
      } else {
        const creado = await api.post<{ id: number }>('/colaboradores', cuerpo);
        alGuardar(creado.id);
      }
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={enviar} className="space-y-4">
      <Aviso mensaje={error} tipo="error" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Nombre completo" ancho="sm:col-span-2"><input className={CLASE_INPUT} value={f.nombre} onChange={(e) => poner('nombre', e.target.value)} required minLength={2} maxLength={150} disabled={!edita} autoFocus /></Campo>
        <Campo etiqueta="Correo" ayuda="Lo necesita para recibir su acceso al sistema."><input type="email" className={CLASE_INPUT} value={f.correo} onChange={(e) => poner('correo', e.target.value)} maxLength={150} disabled={!edita} /></Campo>
        <Campo etiqueta="Celular"><input className={CLASE_INPUT} value={f.celular} onChange={(e) => poner('celular', e.target.value)} maxLength={30} disabled={!edita} /></Campo>
        <Campo etiqueta="DPI" ayuda="13 dígitos."><input className={CLASE_INPUT} value={f.dpi} onChange={(e) => poner('dpi', e.target.value)} maxLength={30} disabled={!edita} /></Campo>
        <Campo etiqueta="Dirección"><input className={CLASE_INPUT} value={f.direccion} onChange={(e) => poner('direccion', e.target.value)} maxLength={200} disabled={!edita} /></Campo>
        <Campo etiqueta="Sucursal" ayuda="Vacío = trabaja en todas.">
          <select className={CLASE_INPUT} value={f.sucursal} onChange={(e) => poner('sucursal', e.target.value)} disabled={!edita}>
            <option value="">Todas</option>
            {(sucursales.datos ?? []).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Área de trabajo">
          <select className={CLASE_INPUT} value={f.area} onChange={(e) => poner('area', e.target.value)} disabled={!edita}>
            <option value="">Sin área</option>
            {(areas.datos ?? []).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
          </select>
        </Campo>
      </div>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-gray-700">Puestos</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {(puestos.datos ?? []).map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" disabled={!edita} checked={sel.includes(p.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, p.id] : s.filter((x) => x !== p.id)))} /> {p.nombre}
            </label>
          ))}
        </div>
      </fieldset>
      {esTecnico && (
        <Campo etiqueta="Nivel de técnico">
          <select className={CLASE_INPUT} value={f.nivel} onChange={(e) => poner('nivel', e.target.value)} disabled={!edita}>
            <option value="">Sin nivel</option>
            {(niveles.datos ?? []).map((n) => <option key={n.id} value={n.id}>{n.nombre}</option>)}
          </select>
        </Campo>
      )}
      {edita && <div className="flex justify-end border-t pt-3"><Button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button></div>}
    </form>
  );
}

// ── Credenciales ─────────────────────────────────────────────────────────────────────
const ESTADO_CRED: Record<Credencial['estado'], { texto: string; v: 'success' | 'warning' | 'danger' | 'default' }> = {
  vigente: { texto: 'Vigente', v: 'success' },
  por_vencer: { texto: 'Por vencer', v: 'warning' },
  vencida: { texto: 'Vencida', v: 'danger' },
  sin_vencimiento: { texto: 'Sin vencimiento', v: 'default' },
};

function Credenciales({ detalle, alCambiar }: { detalle: Detalle; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const tipos = useLista(() => api.get<TipoCred[]>('/tipos-credencial'), [api]);
  const [tipo, setTipo] = useState('');
  const [numero, setNumero] = useState('');
  const [vence, setVence] = useState('');
  const [error, setError] = useState('');
  const edita = tiene('colaboradores.editar');
  const elegido = (tipos.datos ?? []).find((t) => String(t.id) === tipo);

  const agregar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.post(`/colaboradores/${detalle.id}/credenciales`, { tipo_credencial_id: Number(tipo), numero: numero.trim() || null, vence: vence || null });
      setNumero('');
      setVence('');
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  const activar = async (c: Credencial, activo: boolean): Promise<void> => {
    try {
      await api.patch(`/colaboradores/${detalle.id}/credenciales/${c.id}`, { activo });
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };
  const columnas: Array<Columna<Credencial>> = [
    { clave: 'tipo', etiqueta: 'Credencial', valor: (c) => c.tipo },
    { clave: 'numero', etiqueta: 'Número', valor: (c) => c.numero ?? '', render: (c) => c.numero ?? '—' },
    { clave: 'vence', etiqueta: 'Vence', valor: (c) => c.vence ?? '', render: (c) => (c.vence ? (formatFecha(c.vence) as string) : '—') },
    { clave: 'estado', etiqueta: 'Estado', valor: (c) => c.estado, render: (c) => (c.activo ? <Badge variant={ESTADO_CRED[c.estado].v}>{ESTADO_CRED[c.estado].texto}</Badge> : <Badge variant="default">Inactiva</Badge>) },
    { clave: 'acciones', etiqueta: 'Acciones', render: (c) => edita && <Acciones><BotonAccion onClick={() => void activar(c, !c.activo)}>{c.activo ? 'Desactivar' : 'Activar'}</BotonAccion></Acciones> },
  ];
  return (
    <div className="space-y-4">
      {detalle.credenciales_faltantes.length > 0 && <Aviso mensaje={`Le falta cumplir: ${detalle.credenciales_faltantes.join(', ')}.`} tipo="error" />}
      <Aviso mensaje={error} tipo="error" />
      <Tabla columnas={columnas} filas={detalle.credenciales} clave={(c) => c.id} vacio="Todavía no tiene credenciales registradas." />
      {edita && (
        <form onSubmit={agregar} className="grid items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 sm:grid-cols-4">
          <Campo etiqueta="Credencial">
            <select className={CLASE_INPUT} value={tipo} onChange={(e) => setTipo(e.target.value)} required>
              <option value="">Elija…</option>
              {(tipos.datos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
            </select>
          </Campo>
          <Campo etiqueta="Número"><input className={CLASE_INPUT} value={numero} onChange={(e) => setNumero(e.target.value)} maxLength={60} /></Campo>
          <Campo etiqueta={elegido?.requiere_vencimiento ? 'Vence (obligatorio)' : 'Vence'}><FechaInput value={vence} onChange={(e) => setVence(e.target.value)} className={CLASE_INPUT} required={!!elegido?.requiere_vencimiento} /></Campo>
          <Button type="submit">Agregar</Button>
        </form>
      )}
    </div>
  );
}

// ── Jornada propia ───────────────────────────────────────────────────────────────────
function JornadaPropia({ detalle }: { detalle: Detalle }) {
  const { api, tiene } = useSesionTaller();
  const j = useLista(() => api.get<{ origen: 'propia' | 'empresa'; dias: DiaJornada[] }>(`/colaboradores/${detalle.id}/jornada`), [api, detalle.id]);
  const edita = tiene('colaboradores.editar');
  const [quitando, setQuitando] = useState(false);
  if (!j.datos) return <p className="text-gray-500">{j.error || 'Cargando…'}</p>;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">{j.datos.origen === 'propia' ? 'Tiene una jornada propia.' : 'Usa la jornada de la empresa. Si la cambia aquí y guarda, tendrá una propia.'}</p>
      <EditorJornada dias={j.datos.dias} deshabilitado={!edita} textoGuardar="Guardar jornada propia" alGuardar={async (dias) => { await api.put(`/colaboradores/${detalle.id}/jornada`, { dias }); j.recargar(); }} />
      {edita && j.datos.origen === 'propia' && (
        <Button variant="outline" disabled={quitando} onClick={() => { setQuitando(true); api.put(`/colaboradores/${detalle.id}/jornada`, { dias: [] }).then(() => j.recargar()).finally(() => setQuitando(false)); }}>
          Volver a la jornada de la empresa
        </Button>
      )}
    </div>
  );
}

// ── Ausencias de la persona ──────────────────────────────────────────────────────────
function AusenciasDe({ detalle }: { detalle: Detalle }) {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<Ausencia[]>(`/ausencias?colaborador_id=${detalle.id}`), [api, detalle.id]);
  const [nueva, setNueva] = useState(false);
  const [error, setError] = useState('');
  const edita = tiene('colaboradores.editar');
  const eliminar = async (a: Ausencia): Promise<void> => {
    if (!window.confirm('¿Eliminar esta ausencia?')) return;
    try {
      await api.delete(`/ausencias/${a.id}`);
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo eliminar'));
    }
  };
  return (
    <div className="space-y-3">
      <div className="flex justify-end">{edita && <Button onClick={() => setNueva(true)}>Nueva ausencia</Button>}</div>
      <Aviso mensaje={lista.error || error} tipo="error" />
      <TablaAusencias ausencias={lista.datos} puedeEditar={edita} alEliminar={(a) => void eliminar(a)} conColaborador={false} />
      {nueva && <FormAusencia colaboradorId={detalle.id} alCerrar={() => setNueva(false)} alGuardar={() => { setNueva(false); lista.recargar(); }} />}
    </div>
  );
}

// ── Acceso al sistema ────────────────────────────────────────────────────────────────
function Acceso({ detalle, alCambiar }: { detalle: Detalle; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const roles = useLista(() => api.get<Rol[]>('/roles'), [api]);
  const [sel, setSel] = useState<number[]>(detalle.roles.map((r) => r.id));
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' }>({ texto: '', tipo: 'ok' });
  const gestiona = tiene('usuarios.gestionar');
  useEffect(() => setSel(detalle.roles.map((r) => r.id)), [detalle]);

  const correr = async (accion: () => Promise<unknown>, ok: string): Promise<void> => {
    setMensaje({ texto: '', tipo: 'ok' });
    try {
      await accion();
      setMensaje({ texto: ok, tipo: 'ok' });
      alCambiar();
    } catch (err) {
      setMensaje({ texto: mensajeDe(err, 'No se pudo completar'), tipo: 'error' });
    }
  };
  const selector = (
    <fieldset>
      <legend className="mb-1 text-sm font-medium text-gray-700">Roles</legend>
      <div className="flex flex-wrap gap-x-5 gap-y-1">
        {(roles.datos ?? []).filter((r) => r.activo === 1).map((r) => (
          <label key={r.id} className="flex items-center gap-2 text-sm">
            <input type="checkbox" disabled={!gestiona} checked={sel.includes(r.id)} onChange={(e) => setSel((s) => (e.target.checked ? [...s, r.id] : s.filter((x) => x !== r.id)))} /> {r.nombre}
          </label>
        ))}
      </div>
    </fieldset>
  );
  const u = detalle.usuario_id;
  return (
    <div className="space-y-4">
      <Aviso mensaje={mensaje.texto} tipo={mensaje.tipo} />
      {u === null ? (
        <>
          <p className="text-sm text-gray-600">Esta persona todavía no tiene acceso al sistema. Al dárselo recibirá un correo con un enlace para crear su contraseña (nadie ve la contraseña de otra persona).</p>
          {!detalle.correo && <Aviso mensaje="Primero escriba su correo en la pestaña «Datos»." tipo="error" />}
          {selector}
          {gestiona && <Button disabled={sel.length === 0 || !detalle.correo || !detalle.activo} onClick={() => void correr(() => api.post(`/colaboradores/${detalle.id}/acceso`, { roles: sel }), 'Listo: le enviamos el enlace a su correo.')}>Dar acceso</Button>}
        </>
      ) : (
        <>
          <dl className="grid gap-x-8 text-sm sm:grid-cols-2">
            <div className="flex justify-between border-b border-gray-100 py-1.5"><dt className="text-gray-500">Acceso</dt><dd><Badge variant={detalle.usuario_activo ? 'success' : 'default'}>{detalle.usuario_activo ? 'Activo' : 'Desactivado'}</Badge></dd></div>
            <div className="flex justify-between border-b border-gray-100 py-1.5"><dt className="text-gray-500">Último ingreso</dt><dd className="font-medium">{detalle.ultimo_ingreso ? (formatFechaHora(aHoraDeGuatemala(detalle.ultimo_ingreso)) as string) : 'Nunca'}</dd></div>
          </dl>
          {selector}
          {gestiona && (
            <div className="flex flex-wrap gap-2">
              <Button disabled={sel.length === 0} onClick={() => void correr(() => api.patch(`/usuarios/${u}`, { roles: sel }), 'Los roles se guardaron.')}>Guardar roles</Button>
              {detalle.usuario_activo ? (
                <>
                  <Button variant="outline" onClick={() => void correr(() => api.post(`/usuarios/${u}/enlace`), 'Le enviamos un enlace nuevo a su correo.')}>Reenviar enlace</Button>
                  <Button variant="outline" onClick={() => void correr(() => api.post(`/usuarios/${u}/revocar-sesiones`), 'Se cerraron sus sesiones abiertas.')}>Cerrar sus sesiones</Button>
                  <Button variant="danger" onClick={() => { if (window.confirm('¿Quitarle el acceso al sistema?')) void correr(() => api.patch(`/usuarios/${u}`, { activo: false }), 'Se le quitó el acceso.'); }}>Quitar acceso</Button>
                </>
              ) : (
                <Button variant="outline" onClick={() => void correr(() => api.patch(`/usuarios/${u}`, { activo: true }), 'El acceso se activó.')}>Activar acceso</Button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Ficha ────────────────────────────────────────────────────────────────────────────
type PestanaFicha = 'datos' | 'credenciales' | 'jornada' | 'ausencias' | 'acceso';

function Ficha({ id, alCerrar, alCambiar }: { id: number | 'nuevo'; alCerrar: () => void; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const [idActual, setIdActual] = useState<number | 'nuevo'>(id);
  const [detalle, setDetalle] = useState<Detalle | null>(null);
  const [pestana, setPestana] = useState<PestanaFicha>('datos');
  const [error, setError] = useState('');
  const cargar = (n: number): void => {
    api.get<Detalle>(`/colaboradores/${n}`).then(setDetalle).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar')));
  };
  useEffect(() => {
    if (idActual !== 'nuevo') cargar(idActual);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idActual]);

  const pestanas: Array<{ k: PestanaFicha; t: string; visible: boolean }> = [
    { k: 'datos', t: 'Datos', visible: true },
    { k: 'credenciales', t: 'Credenciales', visible: idActual !== 'nuevo' },
    { k: 'jornada', t: 'Jornada', visible: idActual !== 'nuevo' },
    { k: 'ausencias', t: 'Ausencias', visible: idActual !== 'nuevo' },
    { k: 'acceso', t: 'Acceso al sistema', visible: idActual !== 'nuevo' && tiene('usuarios.gestionar') },
  ];
  const titulo = idActual === 'nuevo' ? 'Nuevo colaborador' : detalle ? `${detalle.codigo ?? ''} · ${detalle.nombre_completo}` : 'Colaborador';
  return (
    <Modal onClose={alCerrar} title={titulo} size="xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        <div className="flex flex-wrap gap-2">
          {pestanas.filter((p) => p.visible).map((p) => (
            <button key={p.k} type="button" onClick={() => setPestana(p.k)} className={`rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium ${pestana === p.k ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{p.t}</button>
          ))}
        </div>
        {pestana === 'datos' && (idActual === 'nuevo' || detalle) && (
          <Datos
            detalle={idActual === 'nuevo' ? null : detalle}
            alGuardar={(n) => {
              alCambiar();
              // Crear mínimo y reabrir el de edición: la ficha completa aparece al guardar.
              if (idActual === 'nuevo') setIdActual(n);
              else cargar(n);
            }}
          />
        )}
        {detalle && pestana === 'credenciales' && <Credenciales detalle={detalle} alCambiar={() => { cargar(detalle.id); alCambiar(); }} />}
        {detalle && pestana === 'jornada' && <JornadaPropia detalle={detalle} />}
        {detalle && pestana === 'ausencias' && <AusenciasDe detalle={detalle} />}
        {detalle && pestana === 'acceso' && <Acceso detalle={detalle} alCambiar={() => { cargar(detalle.id); alCambiar(); }} />}
      </div>
    </Modal>
  );
}

// ── Lista ────────────────────────────────────────────────────────────────────────────
export function Colaboradores() {
  const { api, tiene } = useSesionTaller();
  const [buscar, setBuscar] = useState('');
  const [estado, setEstado] = useState<'true' | 'false' | ''>('true');
  const lista = useLista(() => api.get<FilaColaborador[]>(`/colaboradores?${new URLSearchParams({ ...(buscar.trim() ? { buscar: buscar.trim() } : {}), ...(estado ? { activo: estado } : {}) }).toString()}`), [api, buscar, estado]);
  const [abierto, setAbierto] = useState<number | 'nuevo' | null>(null);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' }>({ texto: '', tipo: 'ok' });

  const cambiarEstado = async (c: FilaColaborador): Promise<void> => {
    const desactivar = c.activo === 1;
    if (!window.confirm(desactivar ? `¿Desactivar a ${c.nombre_completo}?${c.usuario_activo ? ' También se le quitará el acceso al sistema.' : ''}` : `¿Reactivar a ${c.nombre_completo}?`)) return;
    try {
      await api.post(`/colaboradores/${c.id}/estado`, { activo: !desactivar });
      setMensaje({ texto: `${c.nombre_completo}: ${desactivar ? 'desactivado' : 'reactivado'}.`, tipo: 'ok' });
      lista.recargar();
    } catch (err) {
      setMensaje({ texto: mensajeDe(err, 'No se pudo cambiar el estado'), tipo: 'error' });
    }
  };

  const columnas: Array<Columna<FilaColaborador>> = [
    { clave: 'codigo', etiqueta: 'Código', valor: (c) => c.codigo ?? '', render: (c) => c.codigo ?? '—' },
    { clave: 'nombre', etiqueta: 'Nombre', valor: (c) => c.nombre_completo, render: (c) => <span><span className="block font-medium text-gray-900">{c.nombre_completo}</span><span className="block text-xs text-gray-500">{c.correo ?? 'Sin correo'}</span></span> },
    { clave: 'puestos', etiqueta: 'Puestos', valor: (c) => c.puestos ?? '', render: (c) => c.puestos ?? '—' },
    { clave: 'sucursal', etiqueta: 'Sucursal', valor: (c) => c.sucursal ?? '', render: (c) => c.sucursal ?? 'Todas' },
    { clave: 'acceso', etiqueta: 'Acceso', valor: (c) => (c.usuario_id ? (c.usuario_activo ? 2 : 1) : 0), render: (c) => (c.usuario_id ? <Badge variant={c.usuario_activo ? 'success' : 'default'}>{c.usuario_activo ? 'Con acceso' : 'Desactivado'}</Badge> : <Badge variant="default">Sin acceso</Badge>) },
    { clave: 'estado', etiqueta: 'Estado', valor: (c) => c.activo, render: (c) => <Badge variant={c.activo ? 'success' : 'default'}>{c.activo ? 'Activo' : 'Inactivo'}</Badge> },
    {
      clave: 'acciones',
      etiqueta: 'Acciones',
      render: (c) => (
        <Acciones>
          {tiene('colaboradores.desactivar') && <BotonAccion onClick={() => void cambiarEstado(c)}>{c.activo ? 'Desactivar' : 'Activar'}</BotonAccion>}
          <BotonAccion onClick={() => setAbierto(c.id)}>{tiene('colaboradores.editar') ? 'Editar' : 'Ver'}</BotonAccion>
        </Acciones>
      ),
    },
  ];
  return (
    <Seccion titulo="Colaboradores" acciones={tiene('colaboradores.crear') && <Button onClick={() => setAbierto('nuevo')}>Nuevo colaborador</Button>}>
      <div className="flex flex-wrap gap-3">
        <input type="search" value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por nombre, correo, código o DPI" aria-label="Buscar colaboradores" data-no-uppercase="true" className="w-full max-w-sm rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <select value={estado} onChange={(e) => setEstado(e.target.value as typeof estado)} aria-label="Estado" className="rounded-md border border-gray-300 px-3 py-2 text-sm">
          <option value="true">Activos</option>
          <option value="false">Inactivos</option>
          <option value="">Todos</option>
        </select>
      </div>
      <Aviso mensaje={lista.error || mensaje.texto} tipo={lista.error ? 'error' : mensaje.tipo} />
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(c) => c.id} vacio={lista.datos ? 'No hay colaboradores con ese filtro.' : 'Cargando…'} />
      {abierto !== null && <Ficha id={abierto} alCerrar={() => setAbierto(null)} alCambiar={lista.recargar} />}
    </Seccion>
  );
}
