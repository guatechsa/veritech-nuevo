import { ScrollText, Users } from 'lucide-react';
import { ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ErrorApi } from '../api';
import { dinero, Indicadores } from '../tipos';

function Tarjeta({ titulo, valor, nota, acento, color }: { titulo: string; valor: ReactNode; nota?: string; acento?: boolean; color?: 'verde' | 'ambar' | 'rojo' }) {
  const colores = { verde: 'text-green-600', ambar: 'text-amber-600', rojo: 'text-red-600' };
  return (
    <div className={`rounded-lg border bg-white p-4 shadow-sm ${acento ? 'border-primary border-l-4' : 'border-gray-200'}`}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{titulo}</p>
      <p className={`mt-1 text-3xl font-extrabold ${color ? colores[color] : 'text-gray-900'}`}>{valor}</p>
      {nota && <p className="mt-1 text-xs text-gray-500">{nota}</p>}
    </div>
  );
}

/**
 * Estándar del panel de superadmin §2: 5 indicadores fijos (clientes activos, en prueba, suspendidos, ingreso mensual
 * recurrente y altas del mes) más 2 accesos directos. Si el dato no existe se muestra "—", nunca cero.
 */
export default function Dashboard() {
  const [datos, setDatos] = useState<Indicadores | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .get<Indicadores>('/stats')
      .then(setDatos)
      .catch((e: unknown) => setError(e instanceof ErrorApi ? e.message : 'No se pudieron cargar los indicadores'));
  }, []);

  if (error) return <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!datos) return <p className="text-gray-500">Cargando…</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Clientes activos" valor={datos.clientes.activos} nota={`de ${datos.clientes.total} registrados`} acento />
        <Tarjeta titulo="En prueba" valor={datos.clientes.en_prueba} nota="Prueba, pendiente de pago o de verificación" color="ambar" />
        <Tarjeta titulo="Suspendidos" valor={datos.clientes.suspendidos} nota="Suspendidos, cancelados o vencidos" color="rojo" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Tarjeta
          titulo="Ingreso mensual recurrente"
          valor={datos.ingreso_mensual.sin_datos ? '—' : dinero(datos.ingreso_mensual.monto)}
          nota={datos.ingreso_mensual.sin_datos ? 'Sin cuotas registradas' : 'Suma de la cuota de los clientes activos'}
        />
        <Tarjeta titulo="Altas del mes" valor={datos.altas_mes} nota="Clientes nuevos desde el día 1" color="verde" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Link to="/admin/usuarios" className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:bg-gray-50">
          <Users className="text-primary" />
          <span>
            <span className="block font-semibold text-gray-900">Usuarios de Plataforma</span>
            <span className="block text-sm text-gray-500">{datos.usuarios_plataforma.activos} de {datos.usuarios_plataforma.total} activos</span>
          </span>
        </Link>
        <Link to="/admin/auditoria" className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm hover:bg-gray-50">
          <ScrollText className="text-primary" />
          <span>
            <span className="block font-semibold text-gray-900">Audit Logs</span>
            <span className="block text-sm text-gray-500">{datos.eventos_auditoria} eventos registrados</span>
          </span>
        </Link>
      </div>
    </div>
  );
}
