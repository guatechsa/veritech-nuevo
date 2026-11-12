import { CircleAlert, ClipboardList, Home, KeyRound, LifeBuoy, LogOut, Menu, Settings, Truck, Users, Wrench, X } from 'lucide-react';
import { FormEvent, ReactNode, useState } from 'react';
import { Link, NavLink, Navigate, Outlet } from 'react-router-dom';
import Button from '../components/ui-guatech/Button.jsx';
import Modal from '../components/ui-guatech/Modal.jsx';
import { formatFecha } from '../components/ui-guatech/formatoFecha.js';
import { aHoraDeGuatemala } from '../utils/hora';
import { APP_VERSION } from '../version';
import { ErrorApi } from '../admin/api';
import CampoContrasena, { contrasenaValida } from '../admin/componentes/CampoContrasena';
import { useUbicacion } from './contexto';
import { PerfilTaller, useSesionTaller } from './Sesion';

const fecha = (iso: string | null): string => (iso ? (formatFecha(aHoraDeGuatemala(iso).slice(0, 10)) as string) : '');

/** Mensajes fijos arriba de la pantalla según el estado de la cuenta y el tipo de sesión. */
function Avisos({ perfil, salir }: { perfil: PerfilTaller; salir: () => void }) {
  const { empresa, avisos } = perfil;
  const { base } = useUbicacion();
  const filas: Array<{ clave: string; clase: string; texto: string; accion?: ReactNode }> = [];
  if (perfil.soporte) {
    filas.push({
      clave: 'soporte',
      clase: 'bg-amber-400 text-amber-950',
      texto: 'Sesión de soporte GUATECH: usted está viendo este taller como su administrador. Todo queda registrado.',
      accion: <button onClick={salir} className="rounded border border-amber-900 px-2 py-0.5 text-xs font-semibold hover:bg-amber-300">Salir</button>,
    });
  }
  if (empresa.estado === 'pago_fallido' && avisos.gracia_hasta) {
    filas.push({ clave: 'gracia', clase: 'bg-red-100 text-red-900', texto: `No pudimos cobrar su suscripción. El taller sigue funcionando; corrija el medio de pago en PayPal antes del ${fecha(avisos.gracia_hasta)} o la cuenta se suspenderá.` });
  }
  if (empresa.estado === 'cancelada_con_acceso' && avisos.acceso_hasta) {
    filas.push({ clave: 'cancelada', clase: 'bg-amber-100 text-amber-900', texto: `Su suscripción está cancelada. Puede seguir trabajando hasta el ${fecha(avisos.acceso_hasta)}; después tendrá 30 días para descargar sus datos.` });
  }
  if (empresa.estado === 'solo_exportar' && avisos.exportable_hasta) {
    filas.push({ clave: 'exportar', clase: 'bg-red-100 text-red-900', texto: `El servicio terminó. Puede consultar y descargar sus datos hasta el ${fecha(avisos.exportable_hasta)}; después se borrarán.`,
      accion: <Link to={`${base}/configuracion?tab=datos`} className="whitespace-nowrap rounded border border-red-900 px-2 py-0.5 text-xs font-semibold hover:bg-red-200">Descargar mis datos</Link>,
    });
  }
  if (empresa.estado === 'prueba' && avisos.prueba_hasta) {
    filas.push({ clave: 'prueba', clase: 'bg-primary-100 text-primary-700', texto: `Está en su período de prueba hasta el ${fecha(avisos.prueba_hasta)}. El primer cobro será al terminar; puede cancelar antes sin costo.` });
  }
  if (filas.length === 0) return null;
  return (
    <div>
      {filas.map((f) => (
        <div key={f.clave} className={`flex items-center justify-between gap-3 px-4 py-2 text-sm font-medium ${f.clase}`} role="status">
          <span className="flex items-center gap-2"><CircleAlert size={16} className="flex-shrink-0" /> {f.texto}</span>
          {f.accion}
        </div>
      ))}
    </div>
  );
}

function CambiarContrasena({ alCerrar }: { alCerrar: () => void }) {
  const { api } = useSesionTaller();
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
          <p role="status" className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800">Su contraseña se cambió. Se cerraron sus otras sesiones.</p>
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

/**
 * Menú de UN solo nivel (estándar §13: de 6 a 11 entradas; las pantallas nuevas se suman en cada fase). Cada entrada
 * aparece solo si la persona tiene su permiso "ver" (y el módulo está habilitado: el servidor ya lo filtró).
 */
const MENU: Array<{ a: string; etiqueta: string; icono: typeof Home; permiso?: string; fin?: boolean }> = [
  { a: '', etiqueta: 'Inicio', icono: Home, fin: true },
  { a: '/clientes', etiqueta: 'Clientes', icono: Users, permiso: 'clientes.ver' },
  { a: '/equipos', etiqueta: 'Equipos', icono: Truck, permiso: 'equipos.ver' },
  { a: '/ordenes', etiqueta: 'Órdenes', icono: ClipboardList, permiso: 'ordenes.ver' },
  { a: '/configuracion', etiqueta: 'Configuración', icono: Settings },
];

export default function LayoutTaller() {
  const { perfil, cargando, nombreTaller, tiene, salir } = useSesionTaller();
  const { base } = useUbicacion();
  const [abierto, setAbierto] = useState(false);
  const [cambiando, setCambiando] = useState(false);

  if (cargando) return <div className="flex min-h-screen items-center justify-center text-gray-500">Cargando…</div>;
  if (!perfil) return <Navigate to={`${base}/ingresar`} replace />;

  const menu = (
    <nav className="flex-1 space-y-1 p-3">
      {MENU.filter((m) => !m.permiso || tiene(m.permiso)).map((m) => (
        <NavLink
          key={m.a}
          to={`${base}${m.a}` || '/'}
          end={m.fin}
          onClick={() => setAbierto(false)}
          className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-primary-600 text-white' : 'text-slate-300 hover:bg-slate-800'}`}
        >
          <m.icono size={18} /> {m.etiqueta}
        </NavLink>
      ))}
    </nav>
  );
  const marca = (
    <span className="flex items-center gap-2 font-bold">
      <Wrench size={20} className="text-primary" /> <span className="truncate">{nombreTaller ?? 'VERI-TECH'}</span>
    </span>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <Avisos perfil={perfil} salir={() => void salir()} />
      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-60 flex-shrink-0 flex-col bg-slate-900 lg:flex">
          <div className="border-b border-slate-800 p-4 text-white">{marca}</div>
          {menu}
          <p className="flex items-center gap-1 p-4 text-xs text-slate-500"><LifeBuoy size={13} /> VERI-TECH · Versión {APP_VERSION}</p>
        </aside>
        {abierto && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <div className="absolute inset-0 bg-black/30" onClick={() => setAbierto(false)} />
            <aside className="relative z-10 flex h-full w-64 flex-col bg-slate-900">
              <div className="flex items-center justify-between border-b border-slate-800 p-4 text-white">
                {marca}
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
                <span className="block font-medium text-gray-900">{perfil.usuario.nombre}</span>
                <span className="block text-xs text-gray-500">{perfil.usuario.roles.map((r) => r.nombre).join(', ')}</span>
              </span>
              {!perfil.soporte && (
                <button onClick={() => setCambiando(true)} className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-50">
                  <KeyRound size={15} /> <span className="hidden sm:inline">Contraseña</span>
                </button>
              )}
              <button onClick={() => void salir()} className="flex items-center gap-1 rounded-md border border-gray-300 px-2.5 py-1.5 text-gray-700 hover:bg-gray-50">
                <LogOut size={15} /> <span className="hidden sm:inline">Salir</span>
              </button>
            </div>
          </header>
          <main className="flex-1 p-4 sm:p-6"><Outlet /></main>
        </div>
      </div>
      {cambiando && <CambiarContrasena alCerrar={() => setCambiando(false)} />}
    </div>
  );
}
