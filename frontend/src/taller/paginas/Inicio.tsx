import { useSesionTaller } from '../Sesion';

const NOMBRE_MODULO: Record<string, string> = {
  ordenes: 'Órdenes de trabajo',
  cotizaciones: 'Cotizaciones',
  citas: 'Citas',
  equipos: 'Equipos y contadores',
  clientes: 'Clientes y proveedores',
  checklists: 'Checklists',
  servicios_programados: 'Servicios programados',
  inventario: 'Inventario y bodegas',
  carga_taller: 'Carga de taller',
  reportes: 'Reportes e indicadores',
  contadores_condicion: 'Contadores por condición',
  portal_cliente: 'Portal del cliente',
  app_movil: 'App móvil',
};

export default function Inicio() {
  const { perfil } = useSesionTaller();
  if (!perfil) return null;
  const nombre = perfil.usuario.nombre.split(' ')[0] ?? perfil.usuario.nombre;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Bienvenido, {nombre}</h1>
        <p className="text-sm text-gray-500">{perfil.empresa.nombre}{perfil.usuario.sucursal ? ` · ${perfil.usuario.sucursal.nombre}` : ''}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Plan</p>
          <p className="mt-1 text-2xl font-extrabold text-gray-900">{perfil.empresa.plan ?? '—'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Su rol</p>
          <p className="mt-1 text-2xl font-extrabold text-gray-900">{perfil.usuario.roles.map((r) => r.nombre).join(', ') || '—'}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">Módulos habilitados</p>
          <p className="mt-1 text-2xl font-extrabold text-gray-900">{perfil.modulos.length}</p>
        </div>
      </div>
      <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-bold text-gray-900">Lo que incluye su plan</h2>
        <ul className="flex flex-wrap gap-2">
          {perfil.modulos.map((m) => (
            <li key={m} className="rounded-full bg-primary-100 px-3 py-1 text-xs font-medium text-primary-700">{NOMBRE_MODULO[m] ?? m}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
