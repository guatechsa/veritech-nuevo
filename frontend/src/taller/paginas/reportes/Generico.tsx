import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { dineroDe } from '../ordenes/tipos';
import { useFiltros } from './filtros';

export type TipoColumna = 'texto' | 'entero' | 'decimal' | 'dinero' | 'porcentaje';
type Celda = string | number | null;
interface SeccionReporte {
  titulo: string;
  columnas: Array<{ clave: string; titulo: string; tipo: TipoColumna }>;
  filas: Array<Record<string, Celda>>;
  total?: Record<string, Celda>;
}
export interface ReporteArmado {
  codigo: string;
  titulo: string;
  desde: string;
  hasta: string;
  filtros: string[];
  secciones: SeccionReporte[];
  notas: string[];
}

const num = (n: number, decimales: number): string => n.toLocaleString('es-GT', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

export function formatoCelda(moneda: string, tipo: TipoColumna, v: Celda | undefined): string {
  if (v === undefined) return '';
  if (v === null) return '—';
  if (tipo === 'texto') return String(v);
  const n = Number(v);
  if (Number.isNaN(n)) return String(v);
  switch (tipo) {
    case 'dinero': return dineroDe(moneda, n);
    case 'porcentaje': return `${num(n, 2)} %`;
    case 'entero': return num(n, 0);
    default: return num(n, 2);
  }
}

const fechaCorta = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Un reporte armado por el servidor (carga de trabajo, compras…): sus secciones como tablas, con sus notas. */
export function ReporteGenerico({ codigo, titulo, ayuda, sinTipoDeEquipo }: { codigo: string; titulo: string; ayuda: string; sinTipoDeEquipo?: boolean }) {
  const { api, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const { q, barra } = useFiltros(codigo, { tipoDeEquipo: !sinTipoDeEquipo });
  const datos = useLista(() => api.get<ReporteArmado>(`/reporte/${codigo}?periodo=personalizado&${q}`), [api, codigo, q]);
  const r = datos.datos;
  return (
    <Seccion titulo={titulo}>
      <p className="text-sm text-gray-700">{ayuda}</p>
      {barra}
      <Aviso mensaje={datos.error} tipo="error" />
      {r && (
        <>
          <p className="text-xs text-gray-500">Periodo: {fechaCorta(r.desde)} al {fechaCorta(r.hasta)}{r.filtros.length > 0 ? ` · ${r.filtros.join(' · ')}` : ''}</p>
          {r.secciones.map((s) => {
            const columnas: Array<Columna<Record<string, Celda>>> = s.columnas.map((c) => ({
              clave: c.clave,
              etiqueta: c.titulo,
              valor: (f) => (c.tipo === 'texto' ? String(f[c.clave] ?? '') : Number(f[c.clave] ?? 0)),
              render: (f) => formatoCelda(moneda, c.tipo, f[c.clave]),
              alinear: c.tipo === 'texto' ? 'left' : 'right',
            }));
            return (
              <div key={s.titulo} className="space-y-1">
                <h3 className="text-sm font-bold text-gray-900">{s.titulo}</h3>
                <Tabla columnas={columnas} filas={s.filas} clave={(f) => JSON.stringify(f)} vacio="Sin datos en este periodo." />
                {s.total && (
                  <p className="text-sm font-semibold text-gray-900">
                    {s.columnas.filter((c) => s.total![c.clave] !== undefined).map((c) => (c.tipo === 'texto' ? String(s.total![c.clave]) : `${c.titulo}: ${formatoCelda(moneda, c.tipo, s.total![c.clave])}`)).join(' · ')}
                  </p>
                )}
              </div>
            );
          })}
          {r.notas.map((n) => <p key={n} className="text-xs text-gray-500">{n}</p>)}
        </>
      )}
    </Seccion>
  );
}
