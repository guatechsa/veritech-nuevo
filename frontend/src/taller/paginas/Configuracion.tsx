import { FormEvent, ReactNode, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Modal from '../../components/ui-guatech/Modal.jsx';
import { ErrorApi } from '../../admin/api';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { dinero } from '../../admin/tipos';
import { fechaHoraLocal } from '../../utils/hora';
import { useSesionTaller } from '../Sesion';
import Avisos from './config/Avisos';
import { Colaboradores } from './config/Colaboradores';
import { DatosDelTaller } from './config/Datos';
import { CatalogosDeTrabajo } from './config/Catalogos';
import { ChecklistsConfig } from './config/Checklists';
import { Bitacora, General } from './config/General';
import { AreasYBodegas, Sucursales } from './config/Estructura';
import { JornadaYAusencias } from './config/Jornada';
import { PuestosYCredenciales } from './config/Puestos';
import { Roles } from './config/Roles';

interface Suscripcion {
  estado: string;
  plan: string | null;
  cuota_mensual: number | null;
  cobro_por_contrato: boolean;
  prueba_hasta: string | null;
  proximo_cobro_en: string | null;
  gracia_hasta: string | null;
  acceso_hasta: string | null;
  exportable_hasta: string | null;
  borrado_programado_en: string | null;
  limites: { max_usuarios: number | null; max_sucursales: number | null };
  pagos: Array<{ paypal_transaccion_id: string; fecha: string; monto: number; moneda: string; estado: string }>;
  puede_cancelar: boolean;
}

const ESTADOS: Record<string, { texto: string; variante: 'success' | 'warning' | 'danger' | 'default' }> = {
  prueba: { texto: 'En prueba', variante: 'warning' },
  activa: { texto: 'Activa', variante: 'success' },
  pago_fallido: { texto: 'Pago fallido', variante: 'danger' },
  suspendida: { texto: 'Suspendida', variante: 'danger' },
  cancelada_con_acceso: { texto: 'Cancelada, con servicio hasta el fin del período', variante: 'warning' },
  solo_exportar: { texto: 'Solo exportar datos', variante: 'default' },
};

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-gray-100 py-1.5 text-sm">
      <dt className="text-gray-500">{etiqueta}</dt>
      <dd className="text-right font-medium text-gray-900">{valor}</dd>
    </div>
  );
}

function Cancelar({ alCerrar, alListo }: { alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    setEnviando(true);
    try {
      await api.post('/suscripcion/cancelar', { motivo });
      alListo();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo cancelar');
    } finally {
      setEnviando(false);
    }
  };
  return (
    <Modal onClose={alCerrar} title="Cancelar la suscripción" size="md">
      <form onSubmit={enviar} className="space-y-3">
        {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <p className="text-sm text-gray-700">Se dejará de cobrar. Usted puede seguir trabajando hasta el final del período ya pagado; después tendrá 30 días para descargar sus datos y, si cambia de opinión, podrá reactivar la cuenta.</p>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Motivo (opcional, nos ayuda a mejorar)</span>
          <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} />
        </label>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={alCerrar}>Volver</Button>
          <Button type="submit" variant="danger" disabled={enviando}>{enviando ? 'Cancelando…' : 'Cancelar suscripción'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function PestanaSuscripcion() {
  const { api, recargar } = useSesionTaller();
  const [datos, setDatos] = useState<Suscripcion | null>(null);
  const [error, setError] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const cargar = useCallback(() => {
    api.get<Suscripcion>('/suscripcion').then(setDatos).catch((e: unknown) => setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar'));
  }, [api]);
  useEffect(cargar, [cargar]);

  if (error) return <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>;
  if (!datos) return <p className="text-gray-500">Cargando…</p>;
  const f = (v: string | null): string => fechaHoraLocal(v);
  const estado = ESTADOS[datos.estado] ?? { texto: datos.estado, variante: 'default' as const };
  const columnas: Array<Columna<Suscripcion['pagos'][number]>> = [
    { clave: 'fecha', etiqueta: 'Fecha', valor: (p) => p.fecha, render: (p) => f(p.fecha) },
    { clave: 'ref', etiqueta: 'Referencia de PayPal', valor: (p) => p.paypal_transaccion_id },
    { clave: 'estado', etiqueta: 'Estado', valor: (p) => p.estado },
    { clave: 'monto', etiqueta: 'Monto', valor: (p) => p.monto, render: (p) => `${p.moneda} ${p.monto.toFixed(2)}`, alinear: 'right' },
  ];
  return (
    <div className="space-y-5">
      <div className="grid gap-5 md:grid-cols-2">
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-bold text-gray-900">Su suscripción</h2><Badge variant={estado.variante}>{estado.texto}</Badge></div>
          <dl>
            <Dato etiqueta="Plan" valor={datos.plan ?? '—'} />
            <Dato etiqueta="Cuota mensual" valor={dinero(datos.cuota_mensual)} />
            <Dato etiqueta="Cobro" valor={datos.cobro_por_contrato ? 'Por contrato (no usa PayPal)' : 'PayPal, mensual'} />
            {datos.estado === 'prueba' && <Dato etiqueta="La prueba termina" valor={f(datos.prueba_hasta)} />}
            {['prueba', 'activa', 'pago_fallido'].includes(datos.estado) && <Dato etiqueta="Próximo cobro" valor={f(datos.proximo_cobro_en)} />}
            {datos.estado === 'pago_fallido' && <Dato etiqueta="Corregir el pago antes del" valor={f(datos.gracia_hasta)} />}
            {datos.estado === 'cancelada_con_acceso' && <Dato etiqueta="Puede trabajar hasta" valor={f(datos.acceso_hasta)} />}
            {datos.estado === 'solo_exportar' && <Dato etiqueta="Puede descargar sus datos hasta" valor={f(datos.exportable_hasta)} />}
          </dl>
          {datos.puede_cancelar && <div className="mt-4"><Button variant="danger" size="sm" onClick={() => setCancelando(true)}>Cancelar suscripción</Button></div>}
        </section>
        <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-gray-900">Límites de su plan</h2>
          <dl>
            <Dato etiqueta="Usuarios" valor={datos.limites.max_usuarios === null ? 'Sin límite' : `Hasta ${datos.limites.max_usuarios}`} />
            <Dato etiqueta="Sucursales" valor={datos.limites.max_sucursales === null ? 'Sin límite' : `Hasta ${datos.limites.max_sucursales}`} />
          </dl>
          <p className="mt-3 text-xs text-gray-500">Para cambiar de plan o de medio de pago, hágalo desde su cuenta de PayPal o escriba a soporte@guatech.lat.</p>
        </section>
      </div>
      <section>
        <h2 className="mb-2 text-sm font-bold text-gray-900">Pagos anteriores</h2>
        <Tabla columnas={columnas} filas={datos.pagos} clave={(p) => p.paypal_transaccion_id} vacio="Todavía no hay pagos: el primer cobro es al terminar la prueba." />
      </section>
      {cancelando && <Cancelar alCerrar={() => setCancelando(false)} alListo={() => { setCancelando(false); cargar(); void recargar(); }} />}
    </div>
  );
}

function PestanaCuenta() {
  const { perfil } = useSesionTaller();
  if (!perfil) return null;
  return (
    <section className="max-w-lg rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-2 text-sm font-bold text-gray-900">Mi cuenta</h2>
      <dl>
        <Dato etiqueta="Nombre" valor={perfil.usuario.nombre} />
        <Dato etiqueta="Correo" valor={perfil.usuario.correo ?? '—'} />
        <Dato etiqueta="Rol" valor={perfil.usuario.roles.map((r) => r.nombre).join(', ') || '—'} />
        <Dato etiqueta="Sucursal" valor={perfil.usuario.sucursal?.nombre ?? '—'} />
      </dl>
      <p className="mt-3 text-xs text-gray-500">Para cambiar su contraseña use el botón «Contraseña» de la parte de arriba.</p>
    </section>
  );
}

type Pestana = { clave: string; texto: string; permiso?: string; vista: () => ReactNode };

/** Todo lo que se configura vive aquí, en pestañas (estándar §13: el menú es de un solo nivel). Cada una aparece según los permisos. */
const PESTANAS: Pestana[] = [
  { clave: 'general', texto: 'General', permiso: 'configuracion.ver', vista: () => <General /> },
  { clave: 'estructura', texto: 'Sucursales y áreas', permiso: 'sucursales.ver', vista: () => <div className="space-y-8"><Sucursales /><AreasYBodegas /></div> },
  { clave: 'colaboradores', texto: 'Colaboradores', permiso: 'colaboradores.ver', vista: () => <Colaboradores /> },
  { clave: 'puestos', texto: 'Puestos y credenciales', permiso: 'colaboradores.ver', vista: () => <PuestosYCredenciales /> },
  { clave: 'roles', texto: 'Roles y permisos', permiso: 'roles.ver', vista: () => <Roles /> },
  { clave: 'jornada', texto: 'Jornada y ausencias', permiso: 'colaboradores.ver', vista: () => <JornadaYAusencias /> },
  { clave: 'catalogos', texto: 'Catálogos de trabajo', permiso: 'catalogos.ver', vista: () => <CatalogosDeTrabajo /> },
  { clave: 'datos', texto: 'Cargar y descargar datos', vista: () => <DatosDelTaller /> },
  { clave: 'checklists', texto: 'Checklists', permiso: 'checklists.ver', vista: () => <ChecklistsConfig /> },
  { clave: 'avisos', texto: 'Avisos', permiso: 'configuracion.ver', vista: () => <Avisos /> },
  { clave: 'suscripcion', texto: 'Suscripción y pagos', permiso: 'suscripcion.ver', vista: () => <PestanaSuscripcion /> },
  { clave: 'bitacora', texto: 'Bitácora', permiso: 'bitacora.ver', vista: () => <Bitacora /> },
  { clave: 'cuenta', texto: 'Mi cuenta', vista: () => <PestanaCuenta /> },
];

export default function Configuracion() {
  const { tiene } = useSesionTaller();
  const [params, setParams] = useSearchParams();
  const visibles = PESTANAS.filter((p) => (p.clave === 'datos' ? tiene('datos.exportar') || tiene('datos.importar') : !p.permiso || tiene(p.permiso)));
  const actual = visibles.find((p) => p.clave === params.get('tab')) ?? visibles[0];
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Configuración</h1>
      <div className="flex flex-wrap gap-2">
        {visibles.map((p) => (
          <button
            key={p.clave}
            onClick={() => setParams({ tab: p.clave }, { replace: true })}
            className={`rounded-md border border-gray-200 px-4 py-2 text-sm font-medium ${actual?.clave === p.clave ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}
          >
            {p.texto}
          </button>
        ))}
      </div>
      {actual?.vista()}
    </div>
  );
}
