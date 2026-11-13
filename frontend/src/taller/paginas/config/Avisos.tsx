import { FormEvent, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { fechaHoraLocal } from '../../../utils/hora';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

interface AvisoConfig {
  codigo: string;
  nombre: string;
  ayuda: string;
  cuando: 'al_ocurrir' | 'revision';
  contextual: string | null;
  umbral: { etiqueta: string; ayuda: string } | null;
  datos: string[];
  asunto_incluido: string;
  cuerpo_incluido: string;
  activo: boolean;
  asunto: string | null;
  cuerpo: string | null;
  umbral_dias: number | null;
  incluir_contextual: boolean;
  roles: number[];
  usuarios: number[];
  correos: string[];
  enviados: number;
  ultimo_envio: string | null;
}

interface Lista {
  avisos: AvisoConfig[];
  roles: Array<{ id: number; nombre: string }>;
  personas: Array<{ id: number; nombre: string; correo: string | null }>;
}

interface FilaRegistro {
  id: number;
  tipo_aviso: string;
  nombre: string;
  asunto: string;
  destinatarios: number;
  estado: 'encolado' | 'sin_destinatarios';
  referencia: string | null;
  created_at: string;
}

interface Registro {
  total: number;
  pagina: number;
  por_pagina: number;
  filas: FilaRegistro[];
}

function EditarAviso({ aviso, lista, alCerrar, alGuardar }: { aviso: AvisoConfig; lista: Lista; alCerrar: () => void; alGuardar: () => void }) {
  const { api } = useSesionTaller();
  const [activo, setActivo] = useState(aviso.activo);
  const [roles, setRoles] = useState<number[]>(aviso.roles);
  const [usuarios, setUsuarios] = useState<number[]>(aviso.usuarios);
  const [correos, setCorreos] = useState(aviso.correos.join(', '));
  const [contextual, setContextual] = useState(aviso.incluir_contextual);
  const [dias, setDias] = useState(aviso.umbral_dias === null ? '' : String(aviso.umbral_dias));
  const [asunto, setAsunto] = useState(aviso.asunto ?? '');
  const [cuerpo, setCuerpo] = useState(aviso.cuerpo ?? '');
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);

  const alternar = <T,>(valores: T[], valor: T): T[] => (valores.includes(valor) ? valores.filter((v) => v !== valor) : [...valores, valor]);

  const guardar = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault();
    setError('');
    setGuardando(true);
    try {
      await api.put(`/avisos/${aviso.codigo}`, {
        activo,
        asunto: asunto.trim() || null,
        cuerpo: cuerpo.trim() || null,
        umbral_dias: aviso.umbral && dias.trim() !== '' ? Number(dias) : null,
        incluir_contextual: contextual,
        roles,
        usuarios,
        correos: correos.split(/[\s,;]+/).filter((c) => c.length > 0),
      });
      alGuardar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo guardar'));
    } finally {
      setGuardando(false);
    }
  };

  const probar = async (): Promise<void> => {
    setError('');
    setMensaje('');
    try {
      const r = await api.post<{ enviado_a: string }>(`/avisos/${aviso.codigo}/prueba`, {});
      setMensaje(`Le enviamos un correo de prueba a ${r.enviado_a}. Llega en un par de minutos.`);
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo enviar la prueba'));
    }
  };

  return (
    <Modal onClose={alCerrar} title={aviso.nombre} size="lg">
      <form onSubmit={(ev) => void guardar(ev)} className="space-y-4">
        <p className="text-sm text-gray-700">{aviso.ayuda}</p>
        <Aviso mensaje={error} tipo="error" />
        <Aviso mensaje={mensaje} tipo="ok" />
        <label className="flex items-center gap-2 text-sm font-medium text-gray-800">
          <input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Aviso encendido
        </label>

        <fieldset className="space-y-2 rounded-md border border-gray-200 p-3">
          <legend className="px-1 text-sm font-bold text-gray-800">¿A quién le llega?</legend>
          {aviso.contextual && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={contextual} onChange={(e) => setContextual(e.target.checked)} /> {aviso.contextual}
            </label>
          )}
          <div>
            <p className="mb-1 text-xs font-medium text-gray-600">Todos los de estos roles</p>
            <div className="grid gap-1 sm:grid-cols-2">
              {lista.roles.map((r) => (
                <label key={r.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={roles.includes(r.id)} onChange={() => setRoles(alternar(roles, r.id))} /> {r.nombre}
                </label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-medium text-gray-600">Estas personas</p>
            <div className="grid max-h-40 gap-1 overflow-y-auto sm:grid-cols-2">
              {lista.personas.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm" title={p.correo ?? 'No tiene correo registrado'}>
                  <input type="checkbox" checked={usuarios.includes(p.id)} onChange={() => setUsuarios(alternar(usuarios, p.id))} /> {p.nombre}
                  {!p.correo && <Badge variant="warning">Sin correo</Badge>}
                </label>
              ))}
            </div>
          </div>
          <Campo etiqueta="Otros correos (separados por coma)">
            <input className={CLASE_INPUT} value={correos} onChange={(e) => setCorreos(e.target.value)} placeholder="gerencia@miempresa.com" />
          </Campo>
        </fieldset>

        {aviso.umbral && (
          <Campo etiqueta={aviso.umbral.etiqueta} ayuda={aviso.umbral.ayuda}>
            <input className={`${CLASE_INPUT} max-w-[10rem]`} type="number" min={0} max={365} value={dias} onChange={(e) => setDias(e.target.value)} />
          </Campo>
        )}

        <fieldset className="space-y-2 rounded-md border border-gray-200 p-3">
          <legend className="px-1 text-sm font-bold text-gray-800">Texto del correo</legend>
          <p className="text-xs text-gray-600">
            Déjelos vacíos para usar el texto incluido. Puede usar estos datos entre llaves: {aviso.datos.map((d) => `{${d}}`).join(' ')}
          </p>
          <Campo etiqueta="Asunto">
            <input className={CLASE_INPUT} maxLength={150} value={asunto} onChange={(e) => setAsunto(e.target.value)} placeholder={aviso.asunto_incluido} />
          </Campo>
          <Campo etiqueta="Mensaje">
            <textarea className={CLASE_INPUT} rows={6} maxLength={3000} value={cuerpo} onChange={(e) => setCuerpo(e.target.value)} placeholder={aviso.cuerpo_incluido} />
          </Campo>
        </fieldset>

        <div className="flex flex-wrap justify-between gap-2 border-t pt-3">
          <Button type="button" variant="outline" onClick={() => void probar()}>Enviarme una prueba</Button>
          <span className="flex gap-2">
            <Button type="button" variant="outline" onClick={alCerrar}>Cancelar</Button>
            <Button type="submit" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</Button>
          </span>
        </div>
      </form>
    </Modal>
  );
}

function RegistroDeAvisos() {
  const { api } = useSesionTaller();
  const [pagina, setPagina] = useState(1);
  const reg = useLista(() => api.get<Registro>(`/avisos-registro?pagina=${pagina}&porPagina=15`), [api, pagina]);
  const columnas: Array<Columna<FilaRegistro>> = [
    { clave: 'fecha', etiqueta: 'Fecha', valor: (f) => f.created_at, render: (f) => fechaHoraLocal(f.created_at) },
    { clave: 'aviso', etiqueta: 'Aviso', valor: (f) => f.nombre, render: (f) => f.nombre },
    { clave: 'asunto', etiqueta: 'Asunto', valor: (f) => f.asunto, render: (f) => f.asunto },
    { clave: 'ref', etiqueta: 'De qué', valor: (f) => f.referencia, render: (f) => f.referencia ?? '—' },
    {
      clave: 'estado',
      etiqueta: 'Resultado',
      valor: (f) => f.estado,
      render: (f) => (f.estado === 'encolado' ? <Badge variant="success">Enviado a {f.destinatarios}</Badge> : <Badge variant="warning">No había a quién avisar</Badge>),
    },
  ];
  const total = reg.datos?.total ?? 0;
  const paginas = Math.max(1, Math.ceil(total / 15));
  return (
    <Seccion titulo="Avisos enviados">
      <Aviso mensaje={reg.error} tipo="error" />
      <Tabla columnas={columnas} filas={reg.datos?.filas ?? []} clave={(f) => f.id} vacio="Todavía no se ha enviado ningún aviso." />
      {total > 15 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>Página {pagina} de {paginas} ({total} avisos)</span>
          <span className="flex gap-2">
            <Button size="sm" variant="outline" disabled={pagina <= 1} onClick={() => setPagina(pagina - 1)}>Anterior</Button>
            <Button size="sm" variant="outline" disabled={pagina >= paginas} onClick={() => setPagina(pagina + 1)}>Siguiente</Button>
          </span>
        </div>
      )}
    </Seccion>
  );
}

export default function Avisos() {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<Lista>('/avisos'), [api]);
  const [editando, setEditando] = useState<AvisoConfig | null>(null);
  const [version, setVersion] = useState(0);
  const puede = tiene('avisos.configurar');
  const nombreDeRol = (id: number): string => lista.datos?.roles.find((r) => r.id === id)?.nombre ?? '';
  const quienes = (a: AvisoConfig): string => {
    const partes = [
      ...(a.contextual && a.incluir_contextual ? [a.contextual] : []),
      ...a.roles.map(nombreDeRol).filter((n) => n),
      ...a.usuarios.map((id) => lista.datos?.personas.find((p) => p.id === id)?.nombre ?? '').filter((n) => n),
      ...a.correos,
    ];
    return partes.length > 0 ? partes.join(' · ') : 'Nadie elegido';
  };
  return (
    <div className="space-y-8">
      <Seccion titulo="Avisos por correo">
        <p className="text-sm text-gray-700">
          El sistema trae estos avisos ya listos. Usted decide cuáles se envían, a quién le llegan y con qué texto. Cada hecho se avisa una sola vez.
        </p>
        <Aviso mensaje={lista.error} tipo="error" />
        <div className="grid gap-3 lg:grid-cols-2">
          {(lista.datos?.avisos ?? []).map((a) => (
            <section key={a.codigo} className="space-y-2 rounded-md border border-gray-200 bg-white p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h3 className="text-sm font-bold text-gray-900">{a.nombre}</h3>
                {a.activo ? <Badge variant="success">Encendido</Badge> : <Badge variant="default">Apagado</Badge>}
              </div>
              <p className="text-xs text-gray-600">{a.ayuda}</p>
              <p className="text-xs text-gray-700"><span className="font-medium">Le llega a:</span> {quienes(a)}</p>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs text-gray-500">{a.enviados > 0 ? `${a.enviados} enviados · último ${fechaHoraLocal(a.ultimo_envio)}` : 'Todavía no se ha enviado'}</span>
                {puede && <Button size="sm" variant="outline" onClick={() => setEditando(a)}>Configurar</Button>}
              </div>
            </section>
          ))}
        </div>
      </Seccion>
      <RegistroDeAvisos key={version} />
      {editando && lista.datos && (
        <EditarAviso
          aviso={editando}
          lista={lista.datos}
          alCerrar={() => setEditando(null)}
          alGuardar={() => {
            setEditando(null);
            lista.recargar();
            setVersion((v) => v + 1);
          }}
        />
      )}
    </div>
  );
}
