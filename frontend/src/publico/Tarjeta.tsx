import { ReactNode } from 'react';

/** Marco de las páginas públicas (registro y "Entrar"): fondo oscuro, marca y una tarjeta blanca. */
export default function Tarjeta({ titulo, subtitulo, ancho = 'max-w-md', children }: { titulo: string; subtitulo?: string; ancho?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-start justify-center bg-slate-900 p-4 sm:items-center">
      <div className={`w-full ${ancho} rounded-xl bg-white p-6 shadow-xl`}>
        <div className="mb-5 text-center">
          <h1 className="text-xl font-extrabold">
            <span className="text-primary">VERI</span>
            <span className="text-secondary">-TECH</span>
          </h1>
          <h2 className="mt-2 text-lg font-semibold text-gray-900">{titulo}</h2>
          {subtitulo && <p className="mt-1 text-sm text-gray-500">{subtitulo}</p>}
        </div>
        {children}
      </div>
    </main>
  );
}

export function Aviso({ mensaje, tipo }: { mensaje: string; tipo: 'error' | 'ok' }) {
  if (!mensaje) return null;
  return (
    <p role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-sm ${tipo === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
      {mensaje}
    </p>
  );
}

export const CLASE_CAMPO = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
