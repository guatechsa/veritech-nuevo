import { FormEvent, useEffect, useState } from 'react';
import Button from '../../../components/ui-guatech/Button.jsx';
import { formatFechaHora } from '../../../components/ui-guatech/formatoFecha.js';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { aHoraDeGuatemala } from '../../../utils/hora';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

interface ClaveCfg {
  clave: string;
  tipo: 'texto' | 'correo' | 'opcion' | 'numero' | 'bool';
  etiqueta: string;
  grupo: 'empresa' | 'regional' | 'precios';
  opciones: string[] | null;
  min: number | null;
  max: number | null;
}
interface Config {
  valores: Record<string, string>;
  claves: ClaveCfg[];
}

const ZONAS = ['America/Guatemala', 'America/El_Salvador', 'America/Tegucigalpa', 'America/Managua', 'America/Costa_Rica', 'America/Panama', 'America/Mexico_City', 'America/Bogota', 'America/New_York', 'UTC'];
const GRUPOS: Array<{ g: ClaveCfg['grupo']; t: string }> = [
  { g: 'empresa', t: 'Datos de la empresa' },
  { g: 'regional', t: 'Zona horaria y moneda' },
  { g: 'precios', t: 'Impuestos y precios' },
];

export function General() {
  const { api, tiene } = useSesionTaller();
  const cfg = useLista(() => api.get<Config>('/configuracion'), [api]);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' }>({ texto: '', tipo: 'ok' });
  const edita = tiene('configuracion.editar');
  useEffect(() => {
    if (cfg.datos) setValores(cfg.datos.valores);
  }, [cfg.datos]);

  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setMensaje({ texto: '', tipo: 'ok' });
    try {
      const r = await api.patch<Config>('/configuracion', valores);
      setValores(r.valores);
      setMensaje({ texto: 'La configuración se guardó.', tipo: 'ok' });
    } catch (err) {
      setMensaje({ texto: mensajeDe(err, 'No se pudo guardar'), tipo: 'error' });
    }
  };
  if (!cfg.datos) return <p className="text-gray-500">{cfg.error || 'Cargando…'}</p>;

  const campo = (c: ClaveCfg) => {
    const v = valores[c.clave] ?? '';
    const poner = (nuevo: string): void => setValores((x) => ({ ...x, [c.clave]: nuevo }));
    switch (c.tipo) {
      case 'bool':
        return (
          <label key={c.clave} className="flex items-center gap-2 pt-6 text-sm">
            <input type="checkbox" checked={v === 'true'} disabled={!edita} onChange={(e) => poner(e.target.checked ? 'true' : 'false')} /> {c.etiqueta}
          </label>
        );
      case 'numero':
        return <Campo key={c.clave} etiqueta={c.etiqueta}><input type="number" min={c.min ?? undefined} max={c.max ?? undefined} step="0.01" className={CLASE_INPUT} value={v} disabled={!edita} onChange={(e) => poner(e.target.value)} /></Campo>;
      case 'opcion': {
        const opciones = c.clave === 'zona_horaria' ? (ZONAS.includes(v) ? ZONAS : [v, ...ZONAS]) : c.opciones ?? [];
        return (
          <Campo key={c.clave} etiqueta={c.etiqueta}>
            <select className={CLASE_INPUT} value={v} disabled={!edita} onChange={(e) => poner(e.target.value)}>{opciones.map((o) => <option key={o} value={o}>{o}</option>)}</select>
          </Campo>
        );
      }
      case 'correo':
        return <Campo key={c.clave} etiqueta={c.etiqueta}><input type="email" className={CLASE_INPUT} value={v} disabled={!edita} onChange={(e) => poner(e.target.value)} maxLength={c.max ?? 150} /></Campo>;
      default:
        return <Campo key={c.clave} etiqueta={c.etiqueta}><input className={CLASE_INPUT} value={v} disabled={!edita} onChange={(e) => poner(e.target.value)} maxLength={c.max ?? 250} /></Campo>;
    }
  };
  return (
    <form onSubmit={guardar} className="space-y-6">
      <Aviso mensaje={cfg.error || mensaje.texto} tipo={cfg.error ? 'error' : mensaje.tipo} />
      {GRUPOS.map((g) => (
        <section key={g.g} className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
          <h2 className="text-sm font-bold text-gray-900">{g.t}</h2>
          <div className="grid gap-3 sm:grid-cols-2">{cfg.datos?.claves.filter((c) => c.grupo === g.g).map(campo)}</div>
        </section>
      ))}
      {edita && <div className="flex justify-end"><Button type="submit">Guardar configuración</Button></div>}
    </form>
  );
}

// ── Bitácora ─────────────────────────────────────────────────────────────────────────
interface Registro {
  id: number;
  created_at: string;
  accion: string;
  entidad: string | null;
  entidad_id: number | null;
  motivo: string | null;
  ip: string | null;
  usuario: string | null;
}

export function Bitacora() {
  const { api } = useSesionTaller();
  const [pagina, setPagina] = useState(1);
  const datos = useLista(() => api.get<{ total: number; porPagina: number; registros: Registro[] }>(`/bitacora?pagina=${pagina}`), [api, pagina]);
  const columnas: Array<Columna<Registro>> = [
    { clave: 'fecha', etiqueta: 'Fecha', valor: (r) => r.created_at, render: (r) => formatFechaHora(aHoraDeGuatemala(r.created_at)) as string },
    { clave: 'usuario', etiqueta: 'Usuario', valor: (r) => r.usuario ?? '', render: (r) => r.usuario ?? '—' },
    { clave: 'accion', etiqueta: 'Acción', valor: (r) => r.accion },
    { clave: 'entidad', etiqueta: 'Sobre', valor: (r) => r.entidad ?? '', render: (r) => (r.entidad ? `${r.entidad}${r.entidad_id ? ` #${r.entidad_id}` : ''}` : '—') },
    { clave: 'motivo', etiqueta: 'Motivo', valor: (r) => r.motivo ?? '', render: (r) => r.motivo ?? '—' },
    { clave: 'ip', etiqueta: 'IP', valor: (r) => r.ip ?? '', render: (r) => r.ip ?? '—' },
  ];
  const paginas = datos.datos ? Math.max(1, Math.ceil(datos.datos.total / datos.datos.porPagina)) : 1;
  return (
    <Seccion titulo="Bitácora">
      <p className="text-sm text-gray-600">Lo delicado que se hace en el sistema (accesos, cambios de roles, de configuración y de personal), con quién lo hizo.</p>
      <Aviso mensaje={datos.error} tipo="error" />
      <Tabla columnas={columnas} filas={datos.datos?.registros ?? []} clave={(r) => r.id} vacio={datos.datos ? 'Todavía no hay registros.' : 'Cargando…'} />
      {datos.datos && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>{datos.datos.total} registros · página {pagina} de {paginas}</span>
          <span className="flex gap-2">
            <Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>Anterior</Button>
            <Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => setPagina((p) => p + 1)}>Siguiente</Button>
          </span>
        </div>
      )}
    </Seccion>
  );
}
