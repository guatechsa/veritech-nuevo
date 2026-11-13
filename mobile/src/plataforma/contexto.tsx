import NetInfo from '@react-native-community/netinfo';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { HayPendientes } from '../nucleo/errores';
import { EstadoDeSincronizacion } from '../nucleo/sincronizador';
import { almacenSqlite } from './almacen';
import { Base, crearBase, crearDeSesion, Servicios } from './servicios';
import { registrarParaAvisos } from './avisos';

type Fase = { fase: 'cargando' } | { fase: 'sinSesion'; slug: string; correo: string; aviso: string } | { fase: 'listo'; servicios: Servicios };

interface Contexto {
  estado: Fase;
  ingresar(slug: string, correo: string, contrasena: string, recordar: boolean): Promise<void>;
  /** Cierra la sesión. Si quedan cambios sin enviar, lanza `HayPendientes` salvo que se confirme con `descartarPendientes`. */
  salir(descartarPendientes?: boolean): Promise<void>;
}

const Ctx = createContext<Contexto | null>(null);
const SLUG_GUARDADO = 'ultimoTaller';

export function ProveedorDeServicios({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Fase>({ fase: 'cargando' });
  const base = useRef<Base | null>(null);

  const alVencer = useCallback((slug: string, correo: string) => {
    // Las llaves ya se borraron; lo pendiente de esta persona se CONSERVA (vive en su propio espacio) y se envía cuando vuelva a ingresar.
    setEstado({ fase: 'sinSesion', slug, correo, aviso: 'Su sesión venció. Ingrese de nuevo: lo que tenía pendiente se conserva.' });
  }, []);

  const preparar = useCallback(
    (slug: string): Base => {
      const b = crearBase(slug, () => void b.gestor.correoRecordado().then((c) => alVencer(slug, c ?? '')));
      base.current = b;
      return b;
    },
    [alVencer]
  );

  useEffect(() => {
    let vivo = true;
    (async () => {
      const slug = await almacenSqlite.leer<string>(SLUG_GUARDADO);
      if (!slug) return vivo && setEstado({ fase: 'sinSesion', slug: '', correo: '', aviso: '' });
      const b = preparar(slug);
      const s = await b.gestor.cargar();
      if (!vivo) return;
      if (s) setEstado({ fase: 'listo', servicios: crearDeSesion(b, s) });
      else setEstado({ fase: 'sinSesion', slug, correo: (await b.gestor.correoRecordado()) ?? '', aviso: '' });
    })().catch(() => vivo && setEstado({ fase: 'sinSesion', slug: '', correo: '', aviso: '' }));
    return () => {
      vivo = false;
    };
  }, [preparar]);

  const ingresar: Contexto['ingresar'] = useCallback(
    async (slug, correo, contrasena, recordar) => {
      const limpio = slug.trim().toLowerCase();
      const b = preparar(limpio);
      const sesion = await b.gestor.ingresar(correo, contrasena, recordar);
      await almacenSqlite.escribir(SLUG_GUARDADO, limpio);
      const servicios = crearDeSesion(b, sesion);
      servicios.sincronizador.sesionRenovada();
      setEstado({ fase: 'listo', servicios });
    },
    [preparar]
  );

  const salir: Contexto['salir'] = useCallback(
    async (descartarPendientes = false) => {
      if (estado.fase !== 'listo') return;
      const { servicios } = estado;
      const pendientes = await servicios.cola.sinEnviar();
      if (pendientes > 0 && !descartarPendientes) throw new HayPendientes(pendientes);
      if (descartarPendientes) await servicios.cola.vaciar();
      await servicios.dia.borrarTodo(); // lo bajado es de esta persona: no se deja en un teléfono que otra puede usar
      await servicios.gestor.salir();
      setEstado({ fase: 'sinSesion', slug: servicios.slug, correo: (await servicios.gestor.correoRecordado()) ?? '', aviso: '' });
    },
    [estado]
  );

  // Mientras hay sesión: se envía lo pendiente al abrir, al volver a la app, al volver la señal y cada minuto; y se registra el teléfono para los avisos.
  const servicios = estado.fase === 'listo' ? estado.servicios : null;
  useEffect(() => {
    if (!servicios) return;
    const enviar = (): void => void servicios.sincronizador.sincronizar().catch(() => undefined);
    enviar();
    void registrarParaAvisos(servicios).catch(() => undefined);
    const app = AppState.addEventListener('change', (e) => e === 'active' && enviar());
    const red = NetInfo.addEventListener((r) => r.isConnected && r.isInternetReachable !== false && enviar());
    const reloj = setInterval(enviar, 60000);
    return () => {
      app.remove();
      red();
      clearInterval(reloj);
    };
  }, [servicios]);

  return <Ctx.Provider value={{ estado, ingresar, salir }}>{children}</Ctx.Provider>;
}

export function useApp(): Contexto {
  const c = useContext(Ctx);
  if (!c) throw new Error('Falta el proveedor de la app');
  return c;
}

/** Los servicios de la persona que tiene sesión (las pantallas internas siempre la tienen). */
export function useServicios(): Servicios {
  const { estado } = useApp();
  if (estado.fase !== 'listo') throw new Error('No hay sesión');
  return estado.servicios;
}

/** El estado del envío (pendientes, errores, señal), actualizado solo. */
export function useEstadoDeEnvio(): EstadoDeSincronizacion | null {
  const s = useServicios();
  const [e, setE] = useState<EstadoDeSincronizacion | null>(null);
  useEffect(() => {
    let vivo = true;
    const leer = (): void => void s.sincronizador.estado().then((x) => vivo && setE(x));
    leer();
    const quitar = s.sincronizador.escuchar(leer);
    return () => {
      vivo = false;
      quitar();
    };
  }, [s]);
  return e;
}
