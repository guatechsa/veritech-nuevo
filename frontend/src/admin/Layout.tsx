import { Building2, KeyRound, LayoutDashboard, LogOut, Menu, ScrollText, ShieldCheck, Users, X } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { NavLink, Navigate, Outlet } from 'react-router-dom';
import Button from '../components/ui-guatech/Button.jsx';
import Modal from '../components/ui-guatech/Modal.jsx';
import { APP_VERSION } from '../version';
import { api, ErrorApi } from './api';
import CampoContrasena, { contrasenaValida } from './componentes/CampoContrasena';
import { useSesion } from './Sesion';
import { ETIQUETA_ROL } from './tipos';

// Estándar del panel de superadmin §1: exactamente estas 4 entradas, en este orden.
const MENU = [
  { a: '/admin', etiqueta: 'Dashboard', icono: LayoutDashboard, fin: true },
  { a: '/admin/empresas', etiqueta: 'Empresas', icono: Building2, fin: false },
  { a: '/admin/usuarios', etiqueta: 'Usuarios de Plataforma', icono: Users, fin: false },
  { a: '/admin/auditoria', etiqueta: 'Audit Logs', icono: ScrollText, fin: false },
];

function CambiarContrasena({ alCerrar }: { alCerrar: () => void }) {
  const [actual, setActual] = useState('');
  const [nueva, setNueva] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [error, setError] = useState('');
  const [listo, setListo] = useState(false);

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    if (nueva !== confirmar) return setError('Las contraseñas nuevas no coinciden.');
    if (!contrasenaValida(nueva)) return setError('La contraseña nueva no cumple todas las reglas.');
    try {
      await api.post('/auth/cambiar-contrasena', { actual, nueva });
      setListo(true);
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo cambiar la contraseña');
    }
  };

  return (
    <Modal onClose={alCerrar} title="Cambiar contraseña" size="sm">
      {listo ? (
        <div className="space-y-4">
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Su contraseña se cambió.</p>
          <Button onClick={alCerrar} className="w-full">Cerrar</Button>
        </div>
      ) : (
        <form onSubmit={enviar} className="space-y-4">
          {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <CampoContrasena id="password-actual" etiqueta="Contraseña actual" valor={actual} alCambiar={setActual} autoFocus />
          <CampoContrasena id="password-nueva" etiqueta="Contraseña nueva" valor={nueva} alCambiar={setNueva} tipo="nueva" />
          <CampoContrasena id="password-confirmar" etiqueta="Confirmar contraseña nueva" valor={confirmar} alCambiar={setConfirmar} tipo="nueva" />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={alCerrar}>Cancelar</Button>
            <Button type="submit">Cambiar contraseña</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

export default function Layout() {
  const { usuario, cargando, salir } = useSesion();
  const [abierto, setAbierto] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  if (cargando) return <div className="flex min-h-screen items-center justify-center text-gray-500">Cargando…</div>;
  if (!usuario) return <Navigate to="/admin/ingresar" replace />;

  const menu = (
    <nav className="flex-1 space-y-1 p-3">
      {MENU.map((m) => (
        <NavLink
          key={m.a}
          to={m.a}
          end={m.fin}
          onClick={() => setAbierto(false)}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-primary-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`
          }
        >
          <m.icono size={18} /> {m.etiqueta}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      {/* Menú lateral fijo en pantallas grandes; cajón en el celular */}
      <aside className="hidden w-60 flex-shrink-0 flex-col bg-slate-900 lg:flex">
        <div className="flex items-center gap-2 border-b border-slate-800 p-4 text-white">
          <ShieldCheck size={22} className="text-primary" /> <span className="font-bold">VERI-TECH Admin</span>
        </div>
        {menu}
        <p className="p-4 text-xs text-slate-500">Versión {APP_VERSION}</p>
      </aside>
      {abierto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAbierto(false)} />
          <aside className="relative z-10 flex h-full w-64 flex-col bg-slate-900">
            <div className="flex items-center justify-between border-b border-slate-800 p-4 text-white">
              <span className="font-bold">VERI-TECH Admin</span>
              <button aria-label="Cerrar menú" onClick={() => setAbierto(false)}><X size={20} /></button>
            </div>
            {menu}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <button className="lg:hidden" aria-label="Abrir menú" onClick={() => setAbierto(true)}><Menu size={22} /></button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-right sm:block">
              <span className="block font-medium text-gray-900">{usuario.nombre}</span>
              <span className="block text-xs text-gray-500">{ETIQUETA_ROL[usuario.rol]}</span>
            </span>
            <button onClick={() => setCambiando(true)} className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-50">
              <KeyRound size={15} /> <span className="hidden sm:inline">Contraseña</span>
            </button>
            <button onClick={salir} className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-50">
              <LogOut size={15} /> <span className="hidden sm:inline">Salir</span>
            </button>
          </div>
        </header>
        <main className="flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
      {cambiando && <CambiarContrasena alCerrar={() => setCambiando(false)} />}
    </div>
  );
}
