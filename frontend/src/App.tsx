import { useEffect, useState } from 'react';
import { APP_VERSION } from './version';

interface Salud {
  success: boolean;
  version: string;
  base: string;
}

// Pantalla provisional de la Fase 0: confirma que el frontend y el backend se hablan y muestran su versión.
export default function App() {
  const [salud, setSalud] = useState<Salud | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json() as Promise<Salud>)
      .then(setSalud)
      .catch(() => setError(true));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-3xl font-extrabold">
        <span className="text-primary">VERI</span>
        <span className="text-secondary">-TECH</span>
      </h1>
      <p className="text-sm text-gray-600">Versión {APP_VERSION} · sitio de pruebas (Fase 0)</p>
      <p className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm">
        {error && 'No se pudo hablar con el servidor.'}
        {!error && !salud && 'Consultando el servidor…'}
        {salud && `Servidor ${salud.version} · base de datos: ${salud.base === 'ok' ? 'conectada' : 'sin conexión'}`}
      </p>
    </main>
  );
}
