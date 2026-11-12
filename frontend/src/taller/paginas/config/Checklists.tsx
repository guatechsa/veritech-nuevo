import { FormEvent, useEffect, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { OpcionesOrden } from '../ordenes/tipos';

interface TipoChecklist {
  id: number;
  codigo: string;
  nombre: string;
  descripcion: string | null;
  etapa_id: number;
  etapa: string;
  exige_lectura_contador: number;
  requiere_firma_cliente: number;
  activo: number;
  version_vigente: number | null;
  items: number;
  tipos_equipo_ids: number[];
}
interface Etapa {
  id: number;
  nombre: string;
  activo: number;
}
interface ItemPlantilla {
  descripcion: string;
  tipo_respuesta: 'semaforo' | 'si_no' | 'numero' | 'texto' | 'lista';
  minimo: string;
  maximo: string;
  opciones: string;
}
interface SeccionPlantilla {
  nombre: string;
  items: ItemPlantilla[];
}
interface Requisito {
  tipo_orden_id: number;
  checklist_tipo_id: number;
  momento: 'antes_de_iniciar' | 'antes_de_terminar';
  accion: 'bloquear' | 'avisar';
}

const TIPOS_RESPUESTA: Array<{ k: ItemPlantilla['tipo_respuesta']; t: string }> = [
  { k: 'semaforo', t: 'Semáforo (verde, amarillo, rojo)' },
  { k: 'si_no', t: 'Sí / No' },
  { k: 'numero', t: 'Número' },
  { k: 'texto', t: 'Texto' },
  { k: 'lista', t: 'Lista de opciones' },
];

// ── Crear o editar un tipo ────────────────────────────────────────────────────────────
function FormTipo({ tipo, etapas, tiposEquipo, alCerrar, alListo }: { tipo?: TipoChecklist; etapas: Etapa[]; tiposEquipo: Array<{ id: number; nombre: string }>; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [codigo, setCodigo] = useState(tipo?.codigo ?? '');
  const [nombre, setNombre] = useState(tipo?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(tipo?.descripcion ?? '');
  const [etapaId, setEtapaId] = useState(tipo ? String(tipo.etapa_id) : '');
  const [lectura, setLectura] = useState(tipo?.exige_lectura_contador === 1);
  const [firma, setFirma] = useState(tipo?.requiere_firma_cliente === 1);
  const [activo, setActivo] = useState(tipo ? tipo.activo === 1 : true);
  const [aplica, setAplica] = useState<number[]>(tipo?.tipos_equipo_ids ?? []);
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      const cuerpo = { nombre, descripcion: descripcion.trim() || null, etapa_id: Number(etapaId), exige_lectura_contador: lectura, requiere_firma_cliente: firma, tipos_equipo_ids: aplica };
      if (tipo) await api.patch(`/checklists-tipos/${tipo.id}`, { ...cuerpo, activo });
      else await api.post('/checklists-tipos', { ...cuerpo, codigo });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={tipo ? `Checklist ${tipo.nombre}` : 'Nuevo tipo de checklist'} size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <div className="grid gap-3 sm:grid-cols-2">
          {!tipo && <Campo etiqueta="Código" ayuda="No se puede cambiar después. Letras y números, sin espacios."><input className={CLASE_INPUT} value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={20} required /></Campo>}
          <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={80} required /></Campo>
          <Campo etiqueta="Etapa" ayuda="Una etapa de «operación» se llena sin orden (por ejemplo, la revisión diaria del operador)."><select className={CLASE_INPUT} value={etapaId} onChange={(e) => setEtapaId(e.target.value)} required><option value="">Elija…</option>{etapas.filter((x) => x.activo === 1).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></Campo>
        </div>
        <Campo etiqueta="Descripción"><input className={CLASE_INPUT} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} maxLength={250} /></Campo>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={lectura} onChange={(e) => setLectura(e.target.checked)} /> Exige la lectura del medidor</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={firma} onChange={(e) => setFirma(e.target.checked)} /> Lleva la firma del cliente</label>
          {tipo && <label className="flex items-center gap-2"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo</label>}
        </div>
        <fieldset className="space-y-1 rounded-md border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium text-gray-700">A qué tipos de equipo aplica (ninguno marcado = a todos)</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            {tiposEquipo.map((te) => <label key={te.id} className="flex items-center gap-2"><input type="checkbox" checked={aplica.includes(te.id)} onChange={(e) => setAplica(e.target.checked ? [...aplica, te.id] : aplica.filter((x) => x !== te.id))} /> {te.nombre}</label>)}
          </div>
        </fieldset>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

// ── Editor de la plantilla (cada guardado es una versión nueva) ───────────────────────
function EditorPlantilla({ tipo, alCerrar, alListo }: { tipo: TipoChecklist; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [secciones, setSecciones] = useState<SeccionPlantilla[] | null>(null);
  const [version, setVersion] = useState<number | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<{ version: number; secciones: Array<{ nombre: string; items: Array<{ descripcion: string; tipo_respuesta: ItemPlantilla['tipo_respuesta']; minimo: number | null; maximo: number | null; opciones: string[] }> }> }>(`/checklists-tipos/${tipo.id}/plantilla`)
      .then((p) => {
        setVersion(p.version);
        setSecciones(p.secciones.map((s) => ({ nombre: s.nombre, items: s.items.map((i) => ({ descripcion: i.descripcion, tipo_respuesta: i.tipo_respuesta, minimo: i.minimo === null ? '' : String(i.minimo), maximo: i.maximo === null ? '' : String(i.maximo), opciones: i.opciones.join('\n') })) })));
      })
      .catch(() => setSecciones([{ nombre: '', items: [{ descripcion: '', tipo_respuesta: 'semaforo', minimo: '', maximo: '', opciones: '' }] }]));
  }, [api, tipo.id]);

  const cambiarSeccion = (i: number, f: (s: SeccionPlantilla) => SeccionPlantilla): void => setSecciones((ss) => (ss ?? []).map((s, k) => (k === i ? f(s) : s)));
  const cambiarItem = (i: number, j: number, cambios: Partial<ItemPlantilla>): void => cambiarSeccion(i, (s) => ({ ...s, items: s.items.map((it, k) => (k === j ? { ...it, ...cambios } : it)) }));
  const guardar = async (): Promise<void> => {
    setError('');
    try {
      await api.put(`/checklists-tipos/${tipo.id}/plantilla`, {
        secciones: (secciones ?? []).map((s) => ({
          nombre: s.nombre,
          items: s.items.map((i) => ({
            descripcion: i.descripcion,
            tipo_respuesta: i.tipo_respuesta,
            ...(i.tipo_respuesta === 'numero' ? { minimo: i.minimo === '' ? null : Number(i.minimo), maximo: i.maximo === '' ? null : Number(i.maximo) } : {}),
            ...(i.tipo_respuesta === 'lista' ? { opciones: i.opciones.split('\n').map((o) => o.trim()).filter(Boolean) } : {}),
          })),
        })),
      });
      alListo();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar la plantilla'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={`Plantilla de ${tipo.nombre}`} size="2xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">
          {version ? `Hoy rige la versión ${version}. ` : 'Todavía no tiene plantilla. '}Al guardar se crea una <strong>versión nueva</strong>: los checklists que ya se abrieron o completaron conservan la suya y nunca cambian.
        </p>
        {secciones === null ? <p className="text-sm text-gray-500">Cargando…</p> : secciones.map((s, i) => (
          <section key={i} className="space-y-2 rounded-md border border-gray-200 p-3">
            <div className="flex items-end gap-2">
              <Campo etiqueta={`Sección ${i + 1}`} ancho="flex-1"><input className={CLASE_INPUT} value={s.nombre} onChange={(e) => cambiarSeccion(i, (x) => ({ ...x, nombre: e.target.value }))} maxLength={100} /></Campo>
              <Button variant="outline" size="sm" onClick={() => setSecciones((ss) => (ss ?? []).filter((_, k) => k !== i))}>Quitar sección</Button>
            </div>
            <ul className="space-y-2">
              {s.items.map((it, j) => (
                <li key={j} className="space-y-2 rounded-md bg-gray-50 p-2">
                  <div className="flex flex-wrap items-end gap-2">
                    <Campo etiqueta="Ítem" ancho="min-w-[14rem] flex-1"><input className={CLASE_INPUT} value={it.descripcion} onChange={(e) => cambiarItem(i, j, { descripcion: e.target.value })} maxLength={250} /></Campo>
                    <Campo etiqueta="Cómo se responde"><select className={CLASE_INPUT} value={it.tipo_respuesta} onChange={(e) => cambiarItem(i, j, { tipo_respuesta: e.target.value as ItemPlantilla['tipo_respuesta'] })}>{TIPOS_RESPUESTA.map((t) => <option key={t.k} value={t.k}>{t.t}</option>)}</select></Campo>
                    <Button variant="outline" size="sm" onClick={() => cambiarSeccion(i, (x) => ({ ...x, items: x.items.filter((_, k) => k !== j) }))}>Quitar</Button>
                  </div>
                  {it.tipo_respuesta === 'numero' && (
                    <div className="grid max-w-sm gap-2 sm:grid-cols-2">
                      <Campo etiqueta="Mínimo (opcional)"><input className={CLASE_INPUT} type="number" step="any" value={it.minimo} onChange={(e) => cambiarItem(i, j, { minimo: e.target.value })} /></Campo>
                      <Campo etiqueta="Máximo (opcional)"><input className={CLASE_INPUT} type="number" step="any" value={it.maximo} onChange={(e) => cambiarItem(i, j, { maximo: e.target.value })} /></Campo>
                    </div>
                  )}
                  {it.tipo_respuesta === 'lista' && <Campo etiqueta="Opciones (una por renglón, mínimo dos)"><textarea className={CLASE_INPUT} rows={3} value={it.opciones} onChange={(e) => cambiarItem(i, j, { opciones: e.target.value })} /></Campo>}
                </li>
              ))}
            </ul>
            <Button variant="outline" size="sm" onClick={() => cambiarSeccion(i, (x) => ({ ...x, items: [...x.items, { descripcion: '', tipo_respuesta: 'semaforo', minimo: '', maximo: '', opciones: '' }] }))}>Agregar ítem</Button>
          </section>
        ))}
        <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => setSecciones((ss) => [...(ss ?? []), { nombre: '', items: [{ descripcion: '', tipo_respuesta: 'semaforo', minimo: '', maximo: '', opciones: '' }] }])}>Agregar sección</Button>
          <span className="flex gap-2"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button onClick={() => void guardar()}>Guardar como versión nueva</Button></span>
        </div>
      </div>
    </Modal>
  );
}

// ── Requisitos por tipo de orden ──────────────────────────────────────────────────────
function Requisitos({ tipos }: { tipos: TipoChecklist[] }) {
  const { api, tiene } = useSesionTaller();
  const opciones = useLista(() => api.get<OpcionesOrden>('/ordenes-opciones'), [api]);
  const requisitos = useLista(() => api.get<Requisito[]>('/checklists-requisitos'), [api]);
  const [tipoOrden, setTipoOrden] = useState('');
  const [valores, setValores] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [guardado, setGuardado] = useState('');
  const requeridos = tipos.filter((t) => t.etapa !== 'OPERACION' && t.activo === 1);
  const clave = (tipoId: number, momento: string): string => `${tipoId}:${momento}`;

  useEffect(() => {
    if (!tipoOrden || !requisitos.datos) return;
    const v: Record<string, string> = {};
    for (const r of requisitos.datos.filter((x) => String(x.tipo_orden_id) === tipoOrden)) v[clave(r.checklist_tipo_id, r.momento)] = r.accion;
    setValores(v);
    setGuardado('');
  }, [tipoOrden, requisitos.datos]);

  const guardar = async (): Promise<void> => {
    setError('');
    setGuardado('');
    try {
      const lista = Object.entries(valores).filter(([, a]) => a).map(([k, accion]) => {
        const [id, momento] = k.split(':');
        return { checklist_tipo_id: Number(id), momento, accion };
      });
      await api.put(`/checklists-requisitos/${tipoOrden}`, { requisitos: lista });
      setGuardado('Quedó guardado.');
      requisitos.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar'));
    }
  };
  return (
    <Seccion titulo="Qué checklists pide cada tipo de orden">
      <p className="text-sm text-gray-700">Elija un tipo de orden y marque, para cada checklist, si debe estar completado antes de iniciar un trabajo o antes de cerrar la orden. «Bloquear» impide seguir; «solo avisar» recomienda.</p>
      <Aviso mensaje={error || requisitos.error || opciones.error} tipo="error" />
      <Aviso mensaje={guardado} tipo="ok" />
      <Campo etiqueta="Tipo de orden"><select className={`${CLASE_INPUT} max-w-xs`} value={tipoOrden} onChange={(e) => setTipoOrden(e.target.value)}><option value="">Elija…</option>{(opciones.datos?.tipos_orden ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
      {tipoOrden && (
        <div className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
          {requeridos.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="w-56 font-medium text-gray-900">{t.nombre}</span>
              {(['antes_de_iniciar', 'antes_de_terminar'] as const).map((m) => (
                <label key={m} className="flex items-center gap-1">
                  <span className="text-gray-600">{m === 'antes_de_iniciar' ? 'Antes de iniciar un trabajo:' : 'Antes de cerrar la orden:'}</span>
                  <select className="rounded-md border border-gray-300 px-2 py-1 text-sm" value={valores[clave(t.id, m)] ?? ''} disabled={!tiene('checklists.gestionar')} onChange={(e) => setValores({ ...valores, [clave(t.id, m)]: e.target.value })}>
                    <option value="">No se pide</option><option value="bloquear">Bloquear</option><option value="avisar">Solo avisar</option>
                  </select>
                </label>
              ))}
            </div>
          ))}
          {tiene('checklists.gestionar') && <div className="flex justify-end pt-2"><Button onClick={() => void guardar()}>Guardar requisitos</Button></div>}
        </div>
      )}
    </Seccion>
  );
}

/** Pestaña «Checklists» de Configuración: tipos, plantillas con versiones y requisitos por tipo de orden. */
export function ChecklistsConfig() {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<TipoChecklist[]>('/checklists-tipos?inactivos=true'), [api]);
  const etapas = useLista(() => api.get<Etapa[]>('/catalogos/etapas'), [api]);
  const tiposEquipo = useLista(() => api.get<Array<{ id: number; nombre: string }>>('/tipos-equipo'), [api]);
  const [ventana, setVentana] = useState<{ tipo: 'nuevo' } | { tipo: 'editar' | 'plantilla'; fila: TipoChecklist } | null>(null);
  const gestionar = tiene('checklists.gestionar');
  const cerrar = (): void => {
    setVentana(null);
    lista.recargar();
  };
  const columnas: Array<Columna<TipoChecklist>> = [
    { clave: 'nombre', etiqueta: 'Checklist', valor: (t) => t.nombre, render: (t) => <span><span className="block font-medium text-gray-900">{t.nombre}</span><span className="block text-xs text-gray-500">{t.codigo}</span></span> },
    { clave: 'etapa', etiqueta: 'Etapa', valor: (t) => t.etapa },
    { clave: 'extras', etiqueta: 'Exige', render: (t) => <span className="flex gap-1">{t.exige_lectura_contador === 1 && <Badge variant="info">Lectura</Badge>}{t.requiere_firma_cliente === 1 && <Badge variant="info">Firma</Badge>}{t.exige_lectura_contador !== 1 && t.requiere_firma_cliente !== 1 && '—'}</span> },
    { clave: 'version', etiqueta: 'Plantilla', valor: (t) => t.version_vigente ?? 0, render: (t) => (t.version_vigente ? `Versión ${t.version_vigente} · ${t.items} ítems` : 'Sin plantilla'), alinear: 'right' },
    { clave: 'activo', etiqueta: 'Estado', valor: (t) => t.activo, render: (t) => <Badge variant={t.activo === 1 ? 'success' : 'default'}>{t.activo === 1 ? 'Activo' : 'Inactivo'}</Badge> },
    { clave: 'acc', etiqueta: 'Acciones', render: (t) => (gestionar ? <Acciones><BotonAccion onClick={() => setVentana({ tipo: 'plantilla', fila: t })}>Plantilla</BotonAccion><BotonAccion onClick={() => setVentana({ tipo: 'editar', fila: t })}>Editar</BotonAccion></Acciones> : null) },
  ];
  return (
    <div className="space-y-8">
      <Seccion titulo="Tipos de checklist" acciones={gestionar && <Button onClick={() => setVentana({ tipo: 'nuevo' })}>Nuevo tipo</Button>}>
        <Aviso mensaje={lista.error} tipo="error" />
        <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(t) => t.id} vacio={lista.datos ? 'Todavía no hay checklists.' : 'Cargando…'} />
      </Seccion>
      {lista.datos && <Requisitos tipos={lista.datos} />}
      {ventana?.tipo === 'nuevo' && <FormTipo etapas={etapas.datos ?? []} tiposEquipo={tiposEquipo.datos ?? []} alCerrar={() => setVentana(null)} alListo={cerrar} />}
      {ventana?.tipo === 'editar' && <FormTipo tipo={ventana.fila} etapas={etapas.datos ?? []} tiposEquipo={tiposEquipo.datos ?? []} alCerrar={() => setVentana(null)} alListo={cerrar} />}
      {ventana?.tipo === 'plantilla' && <EditorPlantilla tipo={ventana.fila} alCerrar={() => setVentana(null)} alListo={cerrar} />}
    </div>
  );
}
