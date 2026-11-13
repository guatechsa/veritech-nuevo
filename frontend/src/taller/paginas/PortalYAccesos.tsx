import { useState } from 'react';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import { formatFechaHora } from '../../components/ui-guatech/formatoFecha.js';
import { aHoraDeGuatemala } from '../../utils/hora';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { Aviso, mensajeDe, Seccion, useLista } from '../componentes/ui';
import { useSesionTaller } from '../Sesion';

interface Portal {
  contactos: Array<{ id: number; nombre: string; correo: string | null; rol: string; todos_los_equipos: boolean; activo: boolean; puede_entrar: boolean }>;
  sesiones: Array<{ id: number; correo: string; creada_en: string; ultima_actividad_en: string; dispositivo: string | null; vigente: boolean; revocada_en: string | null }>;
}
interface Acceso {
  id: number;
  canal: 'enlace' | 'portal' | 'qr';
  tipo: string;
  referencia: string | null;
  contacto: string | null;
  ip: string;
  dispositivo: string;
  created_at: string;
}

const CANAL = { enlace: 'Enlace', portal: 'Portal', qr: 'Código QR' } as const;
const QUE: Record<string, string> = { cuenta: 'Cuenta', checklist: 'Informe', cotizacion: 'Cotización', equipo: 'Equipo', entrada: 'Entró al portal' };
const ROL: Record<string, string> = { aprobador: 'Aprobador', consulta: 'Consulta', piloto: 'Piloto' };

/** «Lo que ha visto el cliente» y quién puede entrar a su portal (Fase 7d). Una sola bitácora para enlaces, QR y portal. */
export function PortalYAccesos({ clienteId }: { clienteId: number }) {
  const { api, tiene } = useSesionTaller();
  const portal = useLista(() => api.get<Portal>(`/clientes/${clienteId}/portal`), [api, clienteId]);
  const accesos = useLista(() => api.get<Acceso[]>(`/clientes/${clienteId}/accesos`), [api, clienteId]);
  const [error, setError] = useState('');
  const [mensaje, setMensaje] = useState('');
  const revocar = async (correo: string): Promise<void> => {
    if (!window.confirm(`¿Cerrar las sesiones abiertas de ${correo}? Tendrá que pedir un código nuevo.`)) return;
    setError('');
    setMensaje('');
    try {
      const r = await api.post<{ revocadas: number }>(`/clientes/${clienteId}/portal/revocar`, { correo });
      setMensaje(`Se cerraron ${r.revocadas} ${r.revocadas === 1 ? 'sesión' : 'sesiones'}.`);
      portal.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudieron cerrar las sesiones'));
    }
  };
  const columnas: Array<Columna<Acceso>> = [
    { clave: 'fecha', etiqueta: 'Cuándo', valor: (a) => a.created_at, render: (a) => formatFechaHora(aHoraDeGuatemala(a.created_at)) },
    { clave: 'canal', etiqueta: 'Por dónde', valor: (a) => CANAL[a.canal], render: (a) => CANAL[a.canal] },
    { clave: 'que', etiqueta: 'Qué vio', valor: (a) => `${QUE[a.tipo] ?? a.tipo} ${a.referencia ?? ''}`, render: (a) => `${QUE[a.tipo] ?? a.tipo}${a.referencia ? ` · ${a.referencia}` : ''}` },
    { clave: 'contacto', etiqueta: 'Quién', valor: (a) => a.contacto ?? '', render: (a) => a.contacto ?? 'No se sabe (enlace)' },
    { clave: 'disp', etiqueta: 'Dispositivo', render: (a) => <span className="text-xs text-gray-600" title={a.dispositivo}>{a.dispositivo.slice(0, 50)}{a.dispositivo.length > 50 ? '…' : ''}</span> },
    { clave: 'ip', etiqueta: 'Red', valor: (a) => a.ip, render: (a) => a.ip },
  ];
  return (
    <div className="space-y-6">
      <Seccion titulo="Quién puede entrar al portal">
        <p className="text-sm text-gray-700">Las personas de contacto con correo entran con un código que se les manda a ese correo. Los contactos se administran en la pestaña «Contactos».</p>
        <Aviso mensaje={error || portal.error} tipo="error" />
        <Aviso mensaje={mensaje} tipo="ok" />
        {(portal.datos?.contactos ?? []).length === 0 && portal.datos && <p className="text-sm text-gray-500">Este cliente no tiene contactos.</p>}
        <ul className="divide-y rounded-md border border-gray-200 text-sm">
          {(portal.datos?.contactos ?? []).map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span><strong>{c.nombre}</strong> · {c.correo ?? 'sin correo'}<span className="block text-xs text-gray-500">{ROL[c.rol] ?? c.rol} · {c.todos_los_equipos ? 'todos los equipos' : 'solo los equipos asignados'}</span></span>
              <span className="flex items-center gap-2">
                {c.puede_entrar ? <Badge variant="success">Puede entrar</Badge> : <Badge variant="default">{c.activo ? 'Falta el correo' : 'Desactivado'}</Badge>}
                {c.correo && tiene('clientes.editar') && <Button size="sm" variant="outline" onClick={() => void revocar(c.correo as string)}>Cerrar sesiones</Button>}
              </span>
            </li>
          ))}
        </ul>
        {(portal.datos?.sesiones ?? []).length > 0 && (
          <>
            <h3 className="text-sm font-bold text-gray-900">Sesiones del portal</h3>
            <ul className="divide-y rounded-md border border-gray-200 text-xs text-gray-700">
              {(portal.datos?.sesiones ?? []).map((s) => <li key={s.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5"><span>{s.correo} · {formatFechaHora(aHoraDeGuatemala(s.creada_en))}</span><span>{s.vigente ? 'Abierta' : s.revocada_en ? 'Cerrada por el taller' : 'Vencida'}</span></li>)}
            </ul>
          </>
        )}
      </Seccion>
      <Seccion titulo="Lo que ha visto el cliente">
        <p className="text-sm text-gray-700">Cada vez que alguien abre un enlace, el código QR de un equipo o el portal queda anotado aquí (los avisos automáticos de WhatsApp o del correo no cuentan).</p>
        <Aviso mensaje={accesos.error} tipo="error" />
        <Tabla columnas={columnas} filas={accesos.datos ?? []} clave={(a) => a.id} vacio="Todavía no ha visto nada." />
      </Seccion>
    </div>
  );
}
