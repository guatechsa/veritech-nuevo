import { KeyboardEvent as TeclaReact, useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUbicacion } from '../contexto';
import { useSesionTaller } from '../Sesion';
import { mensajeDe } from './ui';

interface Resultado {
  id: number;
  titulo: string;
  detalle: string | null;
  ruta: string;
}
interface Grupo {
  codigo: string;
  titulo: string;
  resultados: Resultado[];
}

const esCampoDeTexto = (destino: EventTarget | null): boolean => {
  const e = destino as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable);
};

/** Búsqueda global (Ctrl+K o «/»): equipos, clientes, órdenes, cotizaciones, materiales, trabajos del catálogo… solo lo que la persona puede ver. */
export default function Buscador() {
  const { api } = useSesionTaller();
  const { base } = useUbicacion();
  const navigate = useNavigate();
  const [texto, setTexto] = useState('');
  const [abierto, setAbierto] = useState(false);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState('');
  const [activo, setActivo] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);
  const caja = useRef<HTMLDivElement>(null);
  const planos = grupos.flatMap((g) => g.resultados);
  const q = texto.trim();

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        entrada.current?.focus();
        setAbierto(true);
      } else if (e.key === '/' && !esCampoDeTexto(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        entrada.current?.focus();
        setAbierto(true);
      }
    };
    const alPulsarAfuera = (e: MouseEvent): void => {
      if (caja.current && !caja.current.contains(e.target as Node)) setAbierto(false);
    };
    window.addEventListener('keydown', alTeclear);
    window.addEventListener('mousedown', alPulsarAfuera);
    return () => {
      window.removeEventListener('keydown', alTeclear);
      window.removeEventListener('mousedown', alPulsarAfuera);
    };
  }, []);

  useEffect(() => {
    if (q.length < 2) {
      setGrupos([]);
      setError('');
      return;
    }
    let vivo = true;
    const espera = setTimeout(() => {
      setBuscando(true);
      api
        .get<{ grupos: Grupo[] }>(`/buscar?q=${encodeURIComponent(q)}`)
        .then((r) => {
          if (!vivo) return;
          setGrupos(r.grupos);
          setActivo(0);
          setError('');
        })
        .catch((e: unknown) => vivo && setError(mensajeDe(e, 'No se pudo buscar')))
        .finally(() => vivo && setBuscando(false));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [q, api]);

  const ir = (ruta: string): void => {
    setAbierto(false);
    setTexto('');
    setGrupos([]);
    entrada.current?.blur();
    navigate(`${base}${ruta}`);
  };

  const alPulsar = (e: TeclaReact<HTMLInputElement>): void => {
    if (e.key === 'Escape') {
      setAbierto(false);
      entrada.current?.blur();
    } else if (e.key === 'ArrowDown' && planos.length > 0) {
      e.preventDefault();
      setActivo((a) => (a + 1) % planos.length);
    } else if (e.key === 'ArrowUp' && planos.length > 0) {
      e.preventDefault();
      setActivo((a) => (a - 1 + planos.length) % planos.length);
    } else if (e.key === 'Enter' && planos[activo]) {
      e.preventDefault();
      ir(planos[activo]!.ruta);
    }
  };

  let indice = -1;
  return (
    <div ref={caja} className="relative w-full max-w-sm">
      <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
      <input
        ref={entrada}
        type="search"
        role="combobox"
        aria-expanded={abierto}
        aria-controls="resultados-busqueda"
        aria-label="Buscar en todo el sistema"
        data-no-uppercase="true"
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onKeyDown={alPulsar}
        placeholder="Buscar… (Ctrl+K)"
        className="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-3 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
      />
      {abierto && q.length > 0 && (
        <div id="resultados-busqueda" role="listbox" className="absolute left-0 right-0 z-40 mt-1 max-h-[70vh] overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {q.length < 2 && <p className="px-3 py-2 text-sm text-gray-500">Escriba al menos 2 letras.</p>}
          {error && <p className="px-3 py-2 text-sm text-red-700">{error}</p>}
          {q.length >= 2 && !error && !buscando && grupos.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">No encontramos nada con «{q}».</p>}
          {q.length >= 2 && buscando && grupos.length === 0 && <p className="px-3 py-2 text-sm text-gray-500">Buscando…</p>}
          {grupos.map((g) => (
            <div key={g.codigo}>
              <p className="bg-gray-50 px-3 py-1 text-xs font-bold uppercase tracking-wide text-gray-500">{g.titulo}</p>
              {g.resultados.map((r) => {
                indice += 1;
                const esActivo = indice === activo;
                const mio = indice;
                return (
                  <button
                    key={`${g.codigo}-${r.id}`}
                    type="button"
                    role="option"
                    aria-selected={esActivo}
                    onMouseEnter={() => setActivo(mio)}
                    onClick={() => ir(r.ruta)}
                    className={`block w-full px-3 py-2 text-left text-sm ${esActivo ? 'bg-primary/10' : 'hover:bg-gray-50'}`}
                  >
                    <span className="block font-medium text-gray-900">{r.titulo}</span>
                    {r.detalle && <span className="block text-xs text-gray-500">{r.detalle}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
