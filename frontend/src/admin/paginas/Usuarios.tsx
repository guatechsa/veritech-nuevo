import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Acciones, BotonAccion, BotonEditar } from '../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Modal from '../../components/ui-guatech/Modal.jsx';
import { fechaHoraLocal } from '../../utils/hora';
import { api, ErrorApi } from '../api';
import Tabla, { Columna } from '../componentes/Tabla';
import { useSesion } from '../Sesion';
import { ETIQUETA_ROL, RolPlataforma, UsuarioPlataforma } from '../tipos';

const COLOR_ROL: Record<RolPlataforma, 'danger' | 'info' | 'default'> = { SUPER_ADMIN: 'danger', ADMIN: 'info', VIEWER: 'default' };

function FormularioUsuario({ usuario, alCerrar, alGuardar }: { usuario: UsuarioPlataforma | null; alCerrar: () => void; alGuardar: (contrasenaTemporal?: string) => void }) {
  const [nombre, setNombre] = useState(usuario?.nombre ?? '');
  const [correo, setCorreo] = useState(usuario?.correo ?? '');
  const [rol, setRol] = useState<RolPlataforma>(usuario?.rol ?? 'VIEWER');
  const [error, setError] = useState('');

  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      if (usuario) {
        await api.patch(`/usuarios/${usuario.id}`, { nombre, rol });
        alGuardar();
      } else {
        const r = await api.post<{ contrasenaTemporal: string }>('/usuarios', { nombre, correo: correo.trim(), rol });
        alGuardar(r.contrasenaTemporal);
      }
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar');
    }
  };
  const clase = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100';
  return (
    <Modal onClose={alCerrar} title={usuario ? 'Editar usuario' : 'Nuevo usuario de plataforma'} size="sm">
      <form onSubmit={guardar} className="space-y-4">
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Nombre completo</span><input className={clase} value={nombre} onChange={(e) => setNombre(e.target.value)} required /></label>
        <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Correo</span><input type="email" className={clase} value={correo} onChange={(e) => setCorreo(e.target.value)} required disabled={Boolean(usuario)} /></label>
        <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Rol</span>
          <select className={clase} value={rol} onChange={(e) => setRol(e.target.value as RolPlataforma)}>
            {(['VIEWER', 'ADMIN', 'SUPER_ADMIN'] as RolPlataforma[]).map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
          </select></label>
        <p className="text-xs text-gray-500">Solo lectura: ve todo, no cambia nada. Administrador: además edita empresas. Super administrador: además administra usuarios y planes.</p>
        {!usuario && <p className="text-xs text-gray-500">Al crear el usuario se genera una contraseña temporal que se muestra una sola vez.</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

export default function Usuarios() {
  const { usuario: yo, esSuperAdmin } = useSesion();
  const [usuarios, setUsuarios] = useState<UsuarioPlataforma[]>([]);
  const [formulario, setFormulario] = useState<{ usuario: UsuarioPlataforma | null } | null>(null);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'error' | 'ok' }>({ texto: '', tipo: 'ok' });
  const [temporal, setTemporal] = useState<{ para: string; contrasena: string } | null>(null);

  const cargar = useCallback(() => {
    api.get<UsuarioPlataforma[]>('/usuarios').then(setUsuarios).catch((e: unknown) => setMensaje({ texto: e instanceof ErrorApi ? e.message : 'No se pudo cargar', tipo: 'error' }));
  }, []);
  useEffect(cargar, [cargar]);

  const intentar = async (accion: () => Promise<void>): Promise<void> => {
    try {
      await accion();
      cargar();
    } catch (err) {
      setMensaje({ texto: err instanceof ErrorApi ? err.message : 'No se pudo completar', tipo: 'error' });
    }
  };

  const alternarActivo = (u: UsuarioPlataforma): Promise<void> =>
    intentar(async () => {
      if (u.activo === 1 && !window.confirm(`¿Desea desactivar a ${u.nombre}? Su sesión se cerrará de inmediato.`)) return;
      await api.patch(`/usuarios/${u.id}`, { activo: u.activo !== 1 });
      setMensaje({ texto: `${u.nombre}: ${u.activo === 1 ? 'desactivado' : 'activado'}.`, tipo: 'ok' });
    });

  const restablecer = (u: UsuarioPlataforma): Promise<void> =>
    intentar(async () => {
      if (!window.confirm(`¿Generar una contraseña temporal nueva para ${u.nombre}? La anterior dejará de servir.`)) return;
      const r = await api.post<{ contrasenaTemporal: string }>(`/usuarios/${u.id}/contrasena-temporal`);
      setTemporal({ para: u.correo, contrasena: r.contrasenaTemporal });
    });

  const columnas: Array<Columna<UsuarioPlataforma>> = [
    { clave: 'usuario', etiqueta: 'Usuario', valor: (u) => u.nombre, render: (u) => <span><span className="block font-medium text-gray-900">{u.nombre}</span><span className="block text-xs text-gray-500">{u.correo}</span></span> },
    { clave: 'rol', etiqueta: 'Rol', valor: (u) => u.rol, render: (u) => <Badge variant={COLOR_ROL[u.rol]}>{ETIQUETA_ROL[u.rol]}</Badge> },
    { clave: 'estado', etiqueta: 'Estado', valor: (u) => u.activo, render: (u) => <Badge variant={u.activo === 1 ? 'success' : 'default'}>{u.activo === 1 ? 'Activo' : 'Inactivo'}</Badge> },
    { clave: 'ingreso', etiqueta: 'Último ingreso', valor: (u) => u.ultimo_ingreso ?? '', render: (u) => fechaHoraLocal(u.ultimo_ingreso, 'Nunca') },
    { clave: 'creado', etiqueta: 'Creado', valor: (u) => u.created_at, render: (u) => fechaHoraLocal(u.created_at) },
    {
      clave: 'acciones',
      etiqueta: 'Acciones',
      render: (u) =>
        esSuperAdmin ? (
          <Acciones>
            {u.id !== yo?.id && <BotonAccion onClick={() => alternarActivo(u)}>{u.activo === 1 ? 'Desactivar' : 'Activar'}</BotonAccion>}
            <BotonAccion onClick={() => restablecer(u)}>Contraseña</BotonAccion>
            <BotonEditar onClick={() => setFormulario({ usuario: u })} />
          </Acciones>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Usuarios de Plataforma</h1>
        {esSuperAdmin && <Button onClick={() => setFormulario({ usuario: null })}>Nuevo usuario</Button>}
      </div>
      {mensaje.texto && <p role={mensaje.tipo === 'error' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-sm ${mensaje.tipo === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>{mensaje.texto}</p>}
      <Tabla columnas={columnas} filas={usuarios} clave={(u) => u.id} />
      {formulario && (
        <FormularioUsuario
          usuario={formulario.usuario}
          alCerrar={() => setFormulario(null)}
          alGuardar={(c) => {
            const correoNuevo = formulario.usuario?.correo ?? '';
            setFormulario(null);
            if (c) setTemporal({ para: correoNuevo || 'el usuario nuevo', contrasena: c });
            setMensaje({ texto: 'Los cambios se guardaron.', tipo: 'ok' });
            cargar();
          }}
        />
      )}
      {temporal && (
        <Modal onClose={() => setTemporal(null)} title="Contraseña temporal" size="sm">
          <div className="space-y-3 text-sm">
            <p>Entréguela a <strong>{temporal.para}</strong>. Se muestra <strong>una sola vez</strong>; si se pierde, genere otra.</p>
            <code className="block rounded-md border border-green-300 bg-green-50 p-3 text-center text-lg" data-no-uppercase="true">{temporal.contrasena}</code>
            <Button className="w-full" onClick={() => setTemporal(null)}>Entendido</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
