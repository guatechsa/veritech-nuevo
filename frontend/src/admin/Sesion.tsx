import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, EVENTO_SESION_VENCIDA, guardarToken, leerToken } from './api';
import { UsuarioSesion } from './tipos';

interface ValorSesion {
  usuario: UsuarioSesion | null;
  cargando: boolean;
  ingresar: (correo: string, contrasena: string) => Promise<void>;
  salir: () => void;
  /** ¿Puede cambiar empresas? (ADMIN y SUPER_ADMIN). */
  puedeEscribir: boolean;
  esSuperAdmin: boolean;
}

const Contexto = createContext<ValorSesion | null>(null);

export function ProveedorSesion({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<UsuarioSesion | null>(null);
  const [cargando, setCargando] = useState<boolean>(() => leerToken() !== null);

  useEffect(() => {
    if (leerToken() === null) return;
    api
      .get<UsuarioSesion>('/auth/yo')
      .then(setUsuario)
      .catch(() => guardarToken(null))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    const alVencer = (): void => setUsuario(null);
    window.addEventListener(EVENTO_SESION_VENCIDA, alVencer);
    return () => window.removeEventListener(EVENTO_SESION_VENCIDA, alVencer);
  }, []);

  const ingresar = useCallback(async (correo: string, contrasena: string) => {
    const datos = await api.post<{ token: string; usuario: UsuarioSesion }>('/auth/ingresar', { correo, contrasena });
    guardarToken(datos.token);
    setUsuario(datos.usuario);
  }, []);

  const salir = useCallback(() => {
    guardarToken(null);
    setUsuario(null);
  }, []);

  const valor = useMemo<ValorSesion>(
    () => ({
      usuario,
      cargando,
      ingresar,
      salir,
      puedeEscribir: usuario?.rol === 'SUPER_ADMIN' || usuario?.rol === 'ADMIN',
      esSuperAdmin: usuario?.rol === 'SUPER_ADMIN',
    }),
    [usuario, cargando, ingresar, salir]
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesion(): ValorSesion {
  const valor = useContext(Contexto);
  if (!valor) throw new Error('useSesion debe usarse dentro de ProveedorSesion');
  return valor;
}
