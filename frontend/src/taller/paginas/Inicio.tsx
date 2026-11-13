import { Link } from 'react-router-dom';
import { Aviso, useLista } from '../componentes/ui';
import { useUbicacion } from '../contexto';
import { useSesionTaller } from '../Sesion';
import { COLOR_SEMAFORO, formatoValor, Tarjeta } from './reportes/tipos';

function TarjetaTablero({ t, moneda, base }: { t: Tarjeta; moneda: string; base: string }) {
  const color = t.semaforo ? COLOR_SEMAFORO[t.semaforo] : null;
  const cambio = t.tipo === 'indicador' && t.valor !== null && t.anterior !== null && t.anterior !== undefined && t.anterior !== 0 ? ((t.valor - t.anterior) / Math.abs(t.anterior)) * 100 : null;
  return (
    <Link to={`${base}${t.ruta}`} title={t.ayuda} className={`block rounded-lg border bg-white p-4 shadow-sm transition hover:shadow ${color ? color.borde : 'border-gray-200'}`}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-gray-500">{color && <span className={`inline-block h-2.5 w-2.5 rounded-full ${color.punto}`} aria-label={color.texto} />}{t.titulo}</p>
      <p className="mt-1 text-3xl font-extrabold text-gray-900">{formatoValor(t.unidad, t.valor, moneda)}</p>
      {t.tipo === 'indicador' && (
        <p className="mt-1 text-xs text-gray-500">
          Este mes{t.anterior !== null && t.anterior !== undefined ? ` · mes anterior: ${formatoValor(t.unidad, t.anterior, moneda)}` : ''}
          {cambio !== null && <span className={`ml-1 font-semibold ${cambio >= 0 ? 'text-green-700' : 'text-red-700'}`}>{cambio >= 0 ? '▲' : '▼'} {Math.abs(Math.round(cambio))} %</span>}
        </p>
      )}
    </Link>
  );
}

export default function Inicio() {
  const { api, perfil } = useSesionTaller();
  const { base } = useUbicacion();
  const tablero = useLista(() => api.get<Tarjeta[]>('/tablero'), [api]);
  if (!perfil) return null;
  const nombre = perfil.usuario.nombre.split(' ')[0] ?? perfil.usuario.nombre;
  const moneda = perfil.empresa.moneda ?? 'GTQ';
  const tarjetas = tablero.datos ?? [];
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bienvenido, {nombre}</h1>
        <p className="text-sm text-gray-500">{perfil.empresa.nombre}{perfil.usuario.sucursal ? ` · ${perfil.usuario.sucursal.nombre}` : ''} · {perfil.usuario.roles.map((r) => r.nombre).join(', ')}</p>
      </div>
      <Aviso mensaje={tablero.error} tipo="error" />
      {tablero.datos && tarjetas.length === 0 && <p className="rounded-lg border border-gray-200 bg-white p-4 text-sm text-gray-600">Su rol todavía no tiene tarjetas en el tablero. Use el menú de la izquierda para trabajar; la administración puede elegir qué tarjetas ve cada rol en Reportes → Tablero por rol.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tarjetas.map((t) => <TarjetaTablero key={t.codigo} t={t} moneda={moneda} base={base} />)}
      </div>
    </div>
  );
}
