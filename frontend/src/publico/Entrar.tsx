import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui-guatech/Button.jsx';
import { ErrorApi } from '../admin/api';
import { llamarPublico } from './api';
import Tarjeta, { Aviso, CLASE_CAMPO } from './Tarjeta';

/** "Entrar": la persona escribe su correo y recibe por correo la dirección de cada taller donde trabaja. */
export default function Entrar() {
  const [correo, setCorreo] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      const r = await llamarPublico<{ mensaje: string }>('POST', '/entrar/solicitar', { correo: correo.trim() });
      setMensaje(r.mensaje);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo enviar la solicitud');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Tarjeta titulo="Entrar a mi taller" subtitulo="Escriba su correo y le enviaremos la dirección de su taller.">
      {mensaje ? (
        <div className="space-y-4">
          <Aviso mensaje={mensaje} tipo="ok" />
          <p className="text-center text-sm text-gray-600">Revise también su carpeta de correo no deseado.</p>
        </div>
      ) : (
        <form onSubmit={enviar} className="space-y-4">
          <Aviso mensaje={error} tipo="error" />
          <div>
            <label htmlFor="correo" className="mb-1 block text-sm font-medium text-gray-700">Correo</label>
            <input id="correo" type="email" required autoComplete="email" value={correo} onChange={(e) => setCorreo(e.target.value)} className={CLASE_CAMPO} />
          </div>
          <Button type="submit" className="w-full" disabled={enviando}>{enviando ? 'Enviando…' : 'Enviarme mis accesos'}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm text-gray-600">
        ¿Todavía no tiene cuenta? <Link to="/registro" className="text-primary hover:underline">Pruebe 30 días gratis</Link>
      </p>
    </Tarjeta>
  );
}
