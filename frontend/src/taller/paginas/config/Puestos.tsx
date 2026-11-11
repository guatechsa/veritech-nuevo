import { FormEvent, useState } from 'react';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, Si, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

interface Puesto {
  id: number;
  nombre: string;
  es_tecnico: number;
  es_operador: number;
  activo: number;
  credenciales: Array<{ tipo_credencial_id: number; nombre: string; obligatoria: boolean }>;
}
interface Tipo {
  id: number;
  nombre: string;
  requiere_vencimiento: number;
  dias_aviso: number;
  activo: number;
}
interface Nivel {
  id: number;
  codigo: string;
  nombre: string;
  orden: number;
}

const Estado = ({ activo }: { activo: number }) => <Badge variant={activo ? 'success' : 'default'}>{activo ? 'Activo' : 'Inactivo'}</Badge>;

// ── Puestos ──────────────────────────────────────────────────────────────────────────
function FormPuesto({ inicial, tipos, alCerrar, alGuardar }: { inicial: Puesto | null; tipos: Tipo[]; alCerrar: () => void; alGuardar: () => void }) {
  const { api } = useSesionTaller();
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [tecnico, setTecnico] = useState(inicial?.es_tecnico === 1);
  const [operador, setOperador] = useState(inicial?.es_operador === 1);
  const [creds, setCreds] = useState<Map<number, boolean>>(new Map((inicial?.credenciales ?? []).map((c) => [c.tipo_credencial_id, c.obligatoria])));
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      const cuerpo = { nombre, es_tecnico: tecnico, es_operador: operador };
      const guardado = inicial ? await api.patch<{ id: number }>(`/puestos/${inicial.id}`, cuerpo) : await api.post<{ id: number }>('/puestos', cuerpo);
      await api.put(`/puestos/${guardado.id}/credenciales`, { credenciales: [...creds.entries()].map(([tipo_credencial_id, obligatoria]) => ({ tipo_credencial_id, obligatoria })) });
      alGuardar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={inicial ? `Editar puesto: ${inicial.nombre}` : 'Nuevo puesto'} size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={80} autoFocus /></Campo>
        <div className="flex flex-wrap gap-5 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={tecnico} onChange={(e) => setTecnico(e.target.checked)} /> Es técnico (lleva nivel y recibe trabajos)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={operador} onChange={(e) => setOperador(e.target.checked)} /> Maneja equipos (operador)</label>
        </div>
        <fieldset>
          <legend className="mb-1 text-sm font-medium text-gray-700">Credenciales que exige este puesto</legend>
          {tipos.length === 0 && <p className="text-xs text-gray-500">Primero cree credenciales en el cuadro de abajo.</p>}
          {tipos.filter((t) => t.activo === 1).map((t) => (
            <div key={t.id} className="flex items-center gap-3 py-0.5 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={creds.has(t.id)} onChange={(e) => setCreds((m) => { const n = new Map(m); if (e.target.checked) n.set(t.id, true); else n.delete(t.id); return n; })} /> {t.nombre}</label>
              {creds.has(t.id) && <label className="flex items-center gap-1 text-xs text-gray-600"><input type="checkbox" checked={creds.get(t.id) === true} onChange={(e) => setCreds((m) => new Map(m).set(t.id, e.target.checked))} /> obligatoria</label>}
            </div>
          ))}
        </fieldset>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

// ── Credenciales ─────────────────────────────────────────────────────────────────────
function FormTipo({ inicial, alCerrar, alGuardar }: { inicial: Tipo | null; alCerrar: () => void; alGuardar: () => void }) {
  const { api } = useSesionTaller();
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [vence, setVence] = useState(inicial?.requiere_vencimiento === 1);
  const [dias, setDias] = useState(String(inicial?.dias_aviso ?? 30));
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const cuerpo = { nombre, requiere_vencimiento: vence, dias_aviso: Number(dias) };
    try {
      if (inicial) await api.patch(`/tipos-credencial/${inicial.id}`, cuerpo);
      else await api.post('/tipos-credencial', cuerpo);
      alGuardar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={inicial ? 'Editar credencial' : 'Nueva credencial'} size="sm">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <Campo etiqueta="Nombre" ayuda="Por ejemplo: licencia tipo C, certificado de operador de montacargas."><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={100} autoFocus /></Campo>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vence} onChange={(e) => setVence(e.target.checked)} /> Tiene fecha de vencimiento</label>
        {vence && <Campo etiqueta="Avisar con (días de anticipación)"><input type="number" min="0" max="365" className={CLASE_INPUT} value={dias} onChange={(e) => setDias(e.target.value)} /></Campo>}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

// ── Niveles ──────────────────────────────────────────────────────────────────────────
function FormNivel({ inicial, alCerrar, alGuardar }: { inicial: Nivel | null; alCerrar: () => void; alGuardar: () => void }) {
  const { api } = useSesionTaller();
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '');
  const [nombre, setNombre] = useState(inicial?.nombre ?? '');
  const [orden, setOrden] = useState(String(inicial?.orden ?? 0));
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    const cuerpo = { codigo, nombre, orden: Number(orden) };
    try {
      if (inicial) await api.patch(`/niveles-tecnico/${inicial.id}`, cuerpo);
      else await api.post('/niveles-tecnico', cuerpo);
      alGuardar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={inicial ? 'Editar nivel' : 'Nuevo nivel'} size="sm">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Código"><input className={CLASE_INPUT} value={codigo} onChange={(e) => setCodigo(e.target.value)} required maxLength={20} autoFocus /></Campo>
          <Campo etiqueta="Orden"><input type="number" min="0" max="100" className={CLASE_INPUT} value={orden} onChange={(e) => setOrden(e.target.value)} /></Campo>
        </div>
        <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} required maxLength={60} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

export function PuestosYCredenciales() {
  const { api, tiene } = useSesionTaller();
  const edita = tiene('configuracion.editar');
  const puestos = useLista(() => api.get<Puesto[]>('/puestos?inactivos=true'), [api]);
  const tipos = useLista(() => api.get<Tipo[]>('/tipos-credencial?inactivos=true'), [api]);
  const niveles = useLista(() => api.get<Nivel[]>('/niveles-tecnico'), [api]);
  const [pEdit, setPEdit] = useState<Puesto | 'nuevo' | null>(null);
  const [tEdit, setTEdit] = useState<Tipo | 'nuevo' | null>(null);
  const [nEdit, setNEdit] = useState<Nivel | 'nuevo' | null>(null);
  const [error, setError] = useState('');

  const correr = async (accion: () => Promise<unknown>, despues: () => void): Promise<void> => {
    try {
      await accion();
      despues();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo completar'));
    }
  };

  const colPuestos: Array<Columna<Puesto>> = [
    { clave: 'nombre', etiqueta: 'Puesto', valor: (p) => p.nombre, render: (p) => <span className="font-medium text-gray-900">{p.nombre}</span> },
    { clave: 'tec', etiqueta: 'Técnico', valor: (p) => p.es_tecnico, render: (p) => <Si v={p.es_tecnico} /> },
    { clave: 'op', etiqueta: 'Maneja equipos', valor: (p) => p.es_operador, render: (p) => <Si v={p.es_operador} /> },
    { clave: 'cred', etiqueta: 'Credenciales que exige', valor: (p) => p.credenciales.length, render: (p) => (p.credenciales.length ? p.credenciales.map((c) => c.nombre + (c.obligatoria ? '' : ' (opcional)')).join(', ') : '—') },
    { clave: 'estado', etiqueta: 'Estado', valor: (p) => p.activo, render: (p) => <Estado activo={p.activo} /> },
    { clave: 'acc', etiqueta: 'Acciones', render: (p) => edita && <Acciones><BotonAccion onClick={() => void correr(() => api.patch(`/puestos/${p.id}`, { activo: p.activo !== 1 }), puestos.recargar)}>{p.activo ? 'Desactivar' : 'Activar'}</BotonAccion><BotonAccion onClick={() => setPEdit(p)}>Editar</BotonAccion></Acciones> },
  ];
  const colTipos: Array<Columna<Tipo>> = [
    { clave: 'nombre', etiqueta: 'Credencial', valor: (t) => t.nombre, render: (t) => <span className="font-medium text-gray-900">{t.nombre}</span> },
    { clave: 'vence', etiqueta: 'Vence', valor: (t) => t.requiere_vencimiento, render: (t) => (t.requiere_vencimiento ? `Sí, avisa ${t.dias_aviso} días antes` : 'No') },
    { clave: 'estado', etiqueta: 'Estado', valor: (t) => t.activo, render: (t) => <Estado activo={t.activo} /> },
    { clave: 'acc', etiqueta: 'Acciones', render: (t) => edita && <Acciones><BotonAccion onClick={() => void correr(() => api.patch(`/tipos-credencial/${t.id}`, { activo: t.activo !== 1 }), tipos.recargar)}>{t.activo ? 'Desactivar' : 'Activar'}</BotonAccion><BotonAccion onClick={() => setTEdit(t)}>Editar</BotonAccion></Acciones> },
  ];
  const colNiveles: Array<Columna<Nivel>> = [
    { clave: 'orden', etiqueta: 'Orden', valor: (n) => n.orden, alinear: 'right' },
    { clave: 'codigo', etiqueta: 'Código', valor: (n) => n.codigo },
    { clave: 'nombre', etiqueta: 'Nivel', valor: (n) => n.nombre, render: (n) => <span className="font-medium text-gray-900">{n.nombre}</span> },
    { clave: 'acc', etiqueta: 'Acciones', render: (n) => edita && <Acciones><BotonAccion onClick={() => { if (window.confirm(`¿Eliminar el nivel ${n.nombre}?`)) void correr(() => api.delete(`/niveles-tecnico/${n.id}`), niveles.recargar); }}>Eliminar</BotonAccion><BotonAccion onClick={() => setNEdit(n)}>Editar</BotonAccion></Acciones> },
  ];
  return (
    <div className="space-y-8">
      <Aviso mensaje={error || puestos.error || tipos.error || niveles.error} tipo="error" />
      <Seccion titulo="Puestos" acciones={edita && <Button onClick={() => setPEdit('nuevo')}>Nuevo puesto</Button>}>
        <p className="text-sm text-gray-600">El puesto decide qué se le pide a cada persona: quien es técnico lleva nivel y recibe trabajos; quien maneja equipos puede necesitar credenciales (licencia, certificado interno…).</p>
        <Tabla columnas={colPuestos} filas={puestos.datos ?? []} clave={(p) => p.id} vacio="Cargando…" />
      </Seccion>
      <Seccion titulo="Credenciales" acciones={edita && <Button onClick={() => setTEdit('nuevo')}>Nueva credencial</Button>}>
        <Tabla columnas={colTipos} filas={tipos.datos ?? []} clave={(t) => t.id} vacio="Todavía no hay credenciales definidas." />
      </Seccion>
      <Seccion titulo="Niveles de técnico" acciones={edita && <Button onClick={() => setNEdit('nuevo')}>Nuevo nivel</Button>}>
        <Tabla columnas={colNiveles} filas={niveles.datos ?? []} clave={(n) => n.id} vacio="Cargando…" />
      </Seccion>
      {pEdit && <FormPuesto inicial={pEdit === 'nuevo' ? null : pEdit} tipos={tipos.datos ?? []} alCerrar={() => setPEdit(null)} alGuardar={() => { setPEdit(null); puestos.recargar(); }} />}
      {tEdit && <FormTipo inicial={tEdit === 'nuevo' ? null : tEdit} alCerrar={() => setTEdit(null)} alGuardar={() => { setTEdit(null); tipos.recargar(); puestos.recargar(); }} />}
      {nEdit && <FormNivel inicial={nEdit === 'nuevo' ? null : nEdit} alCerrar={() => setNEdit(null)} alGuardar={() => { setNEdit(null); niveles.recargar(); }} />}
    </div>
  );
}
