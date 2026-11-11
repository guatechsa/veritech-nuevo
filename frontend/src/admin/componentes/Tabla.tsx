import { ChevronDown, ChevronsUpDown, ChevronUp } from 'lucide-react';
import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';

export interface Columna<T> {
  clave: string;
  etiqueta: string;
  /** Valor para ordenar. Si falta, la columna no ordena (por ejemplo, la de acciones). */
  valor?: (fila: T) => string | number | null | undefined;
  render?: (fila: T) => ReactNode;
  alinear?: 'left' | 'right';
}

interface Props<T> {
  columnas: Array<Columna<T>>;
  filas: T[];
  clave: (fila: T) => string | number;
  vacio?: string;
}

/**
 * Listado del estándar (§6 y §6.1): encabezado gris corporativo con orden ascendente/descendente (números se ordenan
 * como números, texto con la colación en español) y barra de desplazamiento horizontal ARRIBA cuando la tabla desborda.
 */
export default function Tabla<T>({ columnas, filas, clave, vacio = 'No hay registros.' }: Props<T>) {
  const [orden, setOrden] = useState<{ clave: string; dir: 'asc' | 'desc' } | null>(null);
  const contenedor = useRef<HTMLDivElement>(null);
  const barraSuperior = useRef<HTMLDivElement>(null);
  const tabla = useRef<HTMLTableElement>(null);
  const [anchoTabla, setAnchoTabla] = useState(0);
  const [desborda, setDesborda] = useState(false);
  const sincronizando = useRef(false);

  const ordenadas = useMemo(() => {
    if (!orden) return filas;
    const col = columnas.find((c) => c.clave === orden.clave);
    if (!col?.valor) return filas;
    const valor = col.valor;
    return [...filas].sort((a, b) => {
      const x = valor(a);
      const y = valor(b);
      const comparacion =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'es', { numeric: true });
      return orden.dir === 'asc' ? comparacion : -comparacion;
    });
  }, [filas, columnas, orden]);

  useEffect(() => {
    const medir = (): void => {
      if (!tabla.current || !contenedor.current) return;
      setAnchoTabla(tabla.current.scrollWidth);
      setDesborda(tabla.current.scrollWidth > contenedor.current.clientWidth + 1);
    };
    medir();
    const observador = new ResizeObserver(medir);
    if (tabla.current) observador.observe(tabla.current);
    if (contenedor.current) observador.observe(contenedor.current);
    return () => observador.disconnect();
  }, [filas, columnas]);

  const alDesplazar = (origen: 'arriba' | 'tabla'): void => {
    if (sincronizando.current) return;
    sincronizando.current = true;
    if (origen === 'arriba' && barraSuperior.current && contenedor.current) contenedor.current.scrollLeft = barraSuperior.current.scrollLeft;
    if (origen === 'tabla' && barraSuperior.current && contenedor.current) barraSuperior.current.scrollLeft = contenedor.current.scrollLeft;
    requestAnimationFrame(() => {
      sincronizando.current = false;
    });
  };

  const alternar = (c: Columna<T>): void => {
    if (!c.valor) return;
    setOrden((o) => (o?.clave === c.clave ? { clave: c.clave, dir: o.dir === 'asc' ? 'desc' : 'asc' } : { clave: c.clave, dir: 'asc' }));
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white shadow-sm">
      {desborda && (
        <div ref={barraSuperior} onScroll={() => alDesplazar('arriba')} className="table-top-scroll">
          <div style={{ width: anchoTabla, height: 1 }} />
        </div>
      )}
      <div ref={contenedor} onScroll={() => alDesplazar('tabla')} className="overflow-x-auto">
        <table ref={tabla} className="min-w-full text-sm">
          <thead>
            <tr>
              {columnas.map((c) => {
                const activa = orden?.clave === c.clave;
                const ordenable = Boolean(c.valor);
                return (
                  <th
                    key={c.clave}
                    scope="col"
                    onClick={() => alternar(c)}
                    aria-sort={activa ? (orden?.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={`bg-secondary px-3 py-2 text-xs font-semibold uppercase text-black ${c.alinear === 'right' ? 'text-right' : 'text-left'} ${ordenable ? 'cursor-pointer select-none hover:bg-secondary-hover' : ''}`}
                  >
                    <span className="inline-flex items-center gap-1">
                      {c.etiqueta}
                      {ordenable && (activa ? orden?.dir === 'asc' ? <ChevronUp size={14} /> : <ChevronDown size={14} /> : <ChevronsUpDown size={14} className="opacity-40" />)}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {ordenadas.map((fila) => (
              <tr key={clave(fila)} className="hover:bg-gray-50">
                {columnas.map((c) => (
                  <td key={c.clave} className={`px-3 py-2 align-middle ${c.alinear === 'right' ? 'text-right' : ''}`}>
                    {c.render ? c.render(fila) : String(c.valor?.(fila) ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
            {ordenadas.length === 0 && (
              <tr>
                <td colSpan={columnas.length} className="px-3 py-8 text-center text-gray-500">
                  {vacio}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
