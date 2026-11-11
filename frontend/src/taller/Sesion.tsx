import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiTaller, crearApiTaller, EVENTO_SESION_TALLER_VENCIDA, guardarTokenTaller, leerTokenTaller, useUbicacion } from './contexto';

export interface PerfilTaller {
  usuario: { id: number; nombre: string; correo: string | null; roles: Array<{ codigo: string; nombre: string }>; sucursal: { id: number; nombre: string } | null };
  permisos: string[];
  modulos: string[];
  soporte: boolean;
  empresa: { nombre: string; slug: string; estado: string; zona_horaria: string; plan: string | null; cobro_por_contrato: boolean };
  avisos: { prueba_hasta: string | null; gracia_hasta: string | null; acceso_hasta: string | null; exportable_hasta: string | null };
}

interface ValorSesion {
  api: ApiTaller;
  perfil: PerfilTaller | null;
  cargando: boolean;
  nombreTaller: string | null;
  tiene: (permiso: string) => boolean;
  ingresar: (correo: string, contrasena: string) => Promise<void>;
  /** Recibe el token de una sesión ya abierta (por ejemplo, la de soporte) y carga el perfil. */
  adoptar: (token: string) => Promise<void>;
  recargar: () => Promise<void>;
  salir: () => Promise<void>;
}

const Contexto = createContext<ValorSesion | null>(null);

export function ProveedorSesionTaller({ children }: { children: ReactNode }) {
  const { slug } = useUbicacion();
  const api = useMemo(() => crearApiTaller(slug), [slug]);
  const [perfil, setPerfil] = useState<PerfilTaller | null>(null);
  const [cargando, setCargando] = useState<boolean>(() => leerTokenTaller(slug) !== null);
  const [nombreTaller, setNombreTaller] = useState<string | null>(null);

  const cargarPerfil = useCallback(async (): Promise<void> => {
    const p = await api.get<PerfilTaller>('/auth/yo');
    setPerfil(p);
    setNombreTaller(p.empresa.nombre);
  }, [api]);

  useEffect(() => {
    api.get<{ nombre: string }>('/info').then((i) => setNombreTaller(i.nombre)).catch(() => undefined);
    if (leerTokenTaller(slug) === null) return;
    cargarPerfil()
      .catch(() => guardarTokenTaller(slug, null))
      .finally(() => setCargando(false));
  }, [api, slug, cargarPerfil]);

  useEffect(() => {
    const alVencer = (): void => setPerfil(null);
    window.addEventListener(EVENTO_SESION_TALLER_VENCIDA, alVencer);
    return () => window.removeEventListener(EVENTO_SESION_TALLER_VENCIDA, alVencer);
  }, []);

  const adoptar = useCallback(
    async (token: string) => {
      guardarTokenTaller(slug, token);
      await cargarPerfil();
    },
    [slug, cargarPerfil]
  );

  const ingresar = useCallback(
    async (correo: string, contrasena: string) => {
      const d = await api.post<{ token: string }>('/auth/ingresar', { correo, contrasena });
      await adoptar(d.token);
    },
    [api, adoptar]
  );

  const salir = useCallback(async () => {
    try {
      await api.post('/auth/cerrar');
    } catch {
      // Si no se pudo avisar al servidor, igual se cierra aquí.
    }
    guardarTokenTaller(slug, null);
    setPerfil(null);
  }, [api, slug]);

  const valor = useMemo<ValorSesion>(
    () => ({ api, perfil, cargando, nombreTaller, tiene: (p) => perfil?.permisos.includes(p) ?? false, ingresar, adoptar, recargar: cargarPerfil, salir }),
    [api, perfil, cargando, nombreTaller, ingresar, adoptar, cargarPerfil, salir]
  );
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

export function useSesionTaller(): ValorSesion {
  const v = useContext(Contexto);
  if (!v) throw new Error('useSesionTaller debe usarse dentro de ProveedorSesionTaller');
  return v;
}
