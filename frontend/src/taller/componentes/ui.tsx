import { ReactNode, useCallback, useEffect, useState } from 'react';
import { ErrorApi } from '../../admin/api';

export const CLASE_INPUT = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:bg-gray-100';

export function Aviso({ mensaje, tipo }: { mensaje: string; tipo: 'error' | 'ok' }) {
  if (!mensaje) return null;
  return (
    <p role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-sm ${tipo === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
      {mensaje}
    </p>
  );
}

export function Campo({ etiqueta, children, ayuda, ancho }: { etiqueta: string; children: ReactNode; ayuda?: string; ancho?: string }) {
  return (
    <label className={`block text-sm ${ancho ?? ''}`}>
      <span className="mb-1 block font-medium text-gray-700">{etiqueta}</span>
      {children}
      {ayuda && <span className="mt-1 block text-xs text-gray-500">{ayuda}</span>}
    </label>
  );
}

export function mensajeDe(err: unknown, porDefecto: string): string {
  return err instanceof ErrorApi ? err.message : porDefecto;
}

/** Carga una lista al abrir la pantalla y permite recargarla; maneja el error de forma uniforme. */
export function useLista<T>(cargar: () => Promise<T>, dependencias: unknown[] = []): { datos: T | null; error: string; recargar: () => void } {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const f = useCallback(cargar, dependencias);
  useEffect(() => {
    let vivo = true;
    f().then((d) => {
      if (vivo) {
        setDatos(d);
        setError('');
      }
    }).catch((e: unknown) => vivo && setError(mensajeDe(e, 'No se pudo cargar')));
    return () => {
      vivo = false;
    };
  }, [f, version]);
  return { datos, error, recargar: () => setVersion((v) => v + 1) };
}

export function Si({ v }: { v: number | boolean }) {
  return <>{v ? 'Sí' : 'No'}</>;
}

export function Seccion({ titulo, acciones, children }: { titulo: string; acciones?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold text-gray-900">{titulo}</h2>
        {acciones}
      </div>
      {children}
    </section>
  );
}
