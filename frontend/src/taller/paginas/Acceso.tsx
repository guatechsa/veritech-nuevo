import { Building2 } from 'lucide-react';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import Button from '../../components/ui-guatech/Button.jsx';
import { ErrorApi } from '../../admin/api';
import CampoContrasena, { contrasenaValida } from '../../admin/componentes/CampoContrasena';
import { useUbicacion } from '../contexto';
import { useSesionTaller } from '../Sesion';

function Tarjeta({ titulo, subtitulo, children }: { titulo: string; subtitulo?: string; children: ReactNode }) {
  const { nombreTaller } = useSesionTaller();
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-900 p-4">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary">
            <Building2 size={26} />
          </div>
          <h1 className="text-xl font-extrabold">
            <span className="text-primary">VERI</span>
            <span className="text-secondary">-TECH</span>
          </h1>
          {nombreTaller && <p className="mt-1 text-sm font-semibold text-gray-800">{nombreTaller}</p>}
          <h2 className="mt-2 text-base font-semibold text-gray-900">{titulo}</h2>
          {subtitulo && <p className="mt-1 text-sm text-gray-500">{subtitulo}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

const Alerta = ({ mensaje }: { mensaje: string }) => (mensaje ? <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{mensaje}</p> : null);
const CLASE = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function PaginaIngresar() {
  const { perfil, ingresar } = useSesionTaller();
  const { base } = useUbicacion();
  const [correo, setCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const navegar = useNavigate();
  if (perfil) return <Navigate to={base || '/'} replace />;

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await ingresar(correo.trim(), contrasena);
      navegar(base || '/', { replace: true });
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo ingresar');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Tarjeta titulo="Ingresar">
      <form onSubmit={enviar} className="space-y-4">
        <Alerta mensaje={error} />
        <div>
          <label htmlFor="correo" className="mb-1 block text-sm font-medium text-gray-700">Correo</label>
          <input id="correo" type="email" required autoComplete="username" value={correo} onChange={(e) => setCorreo(e.target.value)} className={CLASE} />
        </div>
        <CampoContrasena id="password" etiqueta="Contraseña" valor={contrasena} alCambiar={setContrasena} />
        <Button type="submit" className="w-full" disabled={enviando}>{enviando ? 'Ingresando…' : 'Ingresar'}</Button>
        <p className="text-center text-sm"><Link to={`${base}/recuperar`} className="text-primary hover:underline">¿Olvidó su contraseña?</Link></p>
      </form>
    </Tarjeta>
  );
}

export function PaginaRecuperar() {
  const { api } = useSesionTaller();
  const { base } = useUbicacion();
  const [correo, setCorreo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const r = await api.post<{ mensaje: string }>('/auth/recuperar', { correo: correo.trim() });
      setMensaje(r.mensaje);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo enviar la solicitud');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Tarjeta titulo="Recuperar contraseña" subtitulo="Le enviaremos un enlace a su correo.">
      {mensaje ? (
        <div className="space-y-4">
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">{mensaje}</p>
          <p className="text-center text-sm"><Link to={`${base}/ingresar`} className="text-primary hover:underline">Volver a ingresar</Link></p>
        </div>
      ) : (
        <form onSubmit={enviar} className="space-y-4">
          <Alerta mensaje={error} />
          <div>
            <label htmlFor="correo" className="mb-1 block text-sm font-medium text-gray-700">Correo</label>
            <input id="correo" type="email" required autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} className={CLASE} />
          </div>
          <Button type="submit" className="w-full" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviarme el enlace'}</Button>
          <p className="text-center text-sm"><Link to={`${base}/ingresar`} className="text-primary hover:underline">Volver a ingresar</Link></p>
        </form>
      )}
    </Tarjeta>
  );
}

export function PaginaRestablecer() {
  const { api } = useSesionTaller();
  const { base } = useUbicacion();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    if (nueva !== confirmar) return setError('Las contraseñas no coinciden.');
    if (!contrasenaValida(nueva)) return setError('La contraseña no cumple todas las reglas.');
    setEnviando(true);
    try {
      await api.post('/auth/restablecer', { token, contrasena: nueva });
      setListo(true);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo restablecer la contraseña');
    } finally {
      setEnviando(false);
    }
  };

  if (!token) return <Tarjeta titulo="Enlace no válido"><p className="text-center text-sm text-gray-600">Pida un enlace nuevo desde <Link to={`${base}/recuperar`} className="text-primary hover:underline">Recuperar contraseña</Link>.</p></Tarjeta>;
  return (
    <Tarjeta titulo="Nueva contraseña">
      {listo ? (
        <div className="space-y-4">
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Su contraseña se restableció.</p>
          <Link to={`${base}/ingresar`} className="block text-center text-sm text-primary hover:underline">Ingresar</Link>
        </div>
      ) : (
        <form onSubmit={enviar} className="space-y-4">
          <Alerta mensaje={error} />
          <CampoContrasena id="password-nueva" etiqueta="Contraseña nueva" valor={nueva} alCambiar={setNueva} tipo="nueva" autoFocus />
          <CampoContrasena id="password-confirmar" etiqueta="Confirmar contraseña" valor={confirmar} alCambiar={setConfirmar} tipo="nueva" />
          <Button type="submit" className="w-full" disabled={enviando}>{enviando ? 'Guardando…' : 'Restablecer contraseña'}</Button>
        </form>
      )}
    </Tarjeta>
  );
}

/** Canje del enlace "Entrar" de soporte: se usa una sola vez y la sesión queda marcada como de soporte. */
export function PaginaEntrarSoporte() {
  const { api, adoptar } = useSesionTaller();
  const { base } = useUbicacion();
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const navegar = useNavigate();

  // El enlace sirve UNA vez: la guarda evita que el modo estricto de React (que repite los efectos) lo canjee dos veces.
  const canjeado = useRef(false);
  useEffect(() => {
    if (canjeado.current) return;
    canjeado.current = true;
    const token = params.get('token') ?? '';
    if (!token) {
      setError('El enlace no es válido.');
      return;
    }
    api
      .post<{ token: string }>('/auth/soporte', { token })
      .then((d) => adoptar(d.token))
      .then(() => navegar(base || '/', { replace: true }))
      .catch((e: unknown) => setError(e instanceof ErrorApi ? e.message : 'No se pudo abrir la sesión de soporte'));
  }, [api, adoptar, navegar, base, params]);

  return (
    <Tarjeta titulo="Acceso de soporte">
      {error ? <Alerta mensaje={error} /> : <p className="text-center text-sm text-gray-500">Abriendo la sesión de soporte…</p>}
    </Tarjeta>
  );
}
