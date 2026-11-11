import { FormEvent, useEffect, useState } from 'react';
import Button from '../../../components/ui-guatech/Button.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { AvisoEquipo, DetalleEquipo, TipoEquipo } from './tipos';

interface Marca {
  id: number;
  nombre: string;
  tipo_equipo_id: number | null;
  activo: number;
}
interface TipoContador {
  id: number;
  nombre: string;
  es_calendario: number;
  activo: number;
}

/** Elige un cliente buscándolo por nombre (la lista puede ser larga, así que no se carga completa). */
function SelectorCliente({ valor, alCambiar, deshabilitado }: { valor: { id: number; nombre: string } | null; alCambiar: (c: { id: number; nombre: string } | null) => void; deshabilitado: boolean }) {
  const { api } = useSesionTaller();
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<Array<{ id: number; nombre: string; nit: string | null }>>([]);
  useEffect(() => {
    if (texto.trim().length < 2) {
      setResultados([]);
      return;
    }
    const espera = setTimeout(() => {
      api.get<{ registros: Array<{ id: number; nombre: string; nit: string | null }> }>(`/clientes?activo=true&buscar=${encodeURIComponent(texto.trim())}`).then((r) => setResultados(r.registros.slice(0, 8))).catch(() => setResultados([]));
    }, 250);
    return () => clearTimeout(espera);
  }, [api, texto]);
  if (valor) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm">
        <span className="font-medium text-gray-900">{valor.nombre}</span>
        {!deshabilitado && <button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => alCambiar(null)}>Cambiar</button>}
      </div>
    );
  }
  return (
    <div className="relative">
      <input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escriba el nombre del cliente" disabled={deshabilitado} data-no-uppercase="true" autoComplete="off" />
      {resultados.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {resultados.map((c) => (
            <li key={c.id}>
              <button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => { alCambiar({ id: c.id, nombre: c.nombre }); setTexto(''); setResultados([]); }}>
                {c.nombre} <span className="text-xs text-gray-500">{c.nit ? `NIT ${c.nit}` : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const VACIO = { tipo: '', propiedad: 'cliente', codigo_interno: '', placa: '', serie: '', marca: '', modelo: '', anio: '', color: '', motor_marca: '', motor_modelo: '', motor_serie: '', combustible: '', capacidad_tanque: '', departamento: '', notas: '' };
type Formulario = typeof VACIO;

/** Mismo formulario para crear y editar un equipo. Muestra solo los campos que el tipo de equipo usa (placa si es vehículo, combustible si lo usa). */
export function DatosEquipo({ detalle, clienteInicial, alGuardar }: { detalle: DetalleEquipo | null; clienteInicial?: { id: number; nombre: string } | null; alGuardar: (id: number, avisos: AvisoEquipo[]) => void }) {
  const { api, tiene } = useSesionTaller();
  const tipos = useLista(() => api.get<TipoEquipo[]>('/tipos-equipo'), [api]);
  const marcas = useLista(() => api.get<Marca[]>('/catalogos/marcas'), [api]);
  const tiposContador = useLista(() => api.get<TipoContador[]>('/tipos-contador'), [api]);
  const [f, setF] = useState<Formulario>(VACIO);
  const [cliente, setCliente] = useState<{ id: number; nombre: string } | null>(clienteInicial ?? null);
  const [departamentos, setDepartamentos] = useState<Array<{ id: number; nombre: string; activo: number }>>([]);
  const [iniciales, setIniciales] = useState<Array<{ tipo: string; valor: string; fecha: string }>>([]);
  const [error, setError] = useState('');
  const edita = detalle ? tiene('equipos.editar') : tiene('equipos.crear');
  const poner = (k: keyof Formulario, v: string): void => setF((x) => ({ ...x, [k]: v }));
  const tipo = (tipos.datos ?? []).find((t) => String(t.id) === f.tipo);

  useEffect(() => {
    if (!detalle) return;
    setF({
      tipo: String(detalle.tipo_equipo_id),
      propiedad: detalle.propiedad,
      codigo_interno: detalle.codigo_interno ?? '',
      placa: detalle.placa ?? '',
      serie: detalle.serie ?? '',
      marca: detalle.marca_id ? String(detalle.marca_id) : '',
      modelo: detalle.modelo ?? '',
      anio: detalle.anio ? String(detalle.anio) : '',
      color: detalle.color ?? '',
      motor_marca: detalle.motor_marca ?? '',
      motor_modelo: detalle.motor_modelo ?? '',
      motor_serie: detalle.motor_serie ?? '',
      combustible: detalle.combustible ?? '',
      capacidad_tanque: detalle.capacidad_tanque ? String(detalle.capacidad_tanque) : '',
      departamento: detalle.departamento_id ? String(detalle.departamento_id) : '',
      notas: detalle.notas ?? '',
    });
    setCliente(detalle.cliente_id ? { id: detalle.cliente_id, nombre: detalle.cliente ?? '' } : null);
  }, [detalle]);

  useEffect(() => {
    if (!cliente) {
      setDepartamentos([]);
      return;
    }
    api.get<{ departamentos: Array<{ id: number; nombre: string; activo: number }> }>(`/clientes/${cliente.id}`).then((c) => setDepartamentos(c.departamentos)).catch(() => setDepartamentos([]));
  }, [api, cliente]);

  // Al crear: se sugiere el contador natural del tipo (odómetro para vehículos, horómetro para maquinaria).
  useEffect(() => {
    if (detalle || !tipo || !tiposContador.datos) return;
    const buscar = (nombre: string): string => String(tiposContador.datos?.find((c) => c.nombre === nombre)?.id ?? '');
    const sugerido = tipo.es_vehiculo ? buscar('ODOMETRO') : tipo.usa_combustible ? buscar('HOROMETRO') : '';
    setIniciales(sugerido ? [{ tipo: sugerido, valor: '', fecha: '' }] : []);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [f.tipo, tiposContador.datos]);

  const o = (v: string): string | null => (v.trim() === '' ? null : v.trim());
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    const cuerpo: Record<string, unknown> = {
      tipo_equipo_id: Number(f.tipo),
      propiedad: f.propiedad,
      cliente_id: f.propiedad === 'cliente' ? cliente?.id ?? null : null,
      departamento_id: f.propiedad === 'cliente' && f.departamento ? Number(f.departamento) : null,
      codigo_interno: o(f.codigo_interno),
      placa: tipo?.es_vehiculo ? o(f.placa) : null,
      serie: o(f.serie),
      marca_id: f.marca ? Number(f.marca) : null,
      modelo: o(f.modelo),
      anio: f.anio ? Number(f.anio) : null,
      color: o(f.color),
      motor_marca: o(f.motor_marca),
      motor_modelo: o(f.motor_modelo),
      motor_serie: o(f.motor_serie),
      combustible: tipo?.usa_combustible ? o(f.combustible) : null,
      capacidad_tanque: tipo?.usa_combustible && f.capacidad_tanque ? Number(f.capacidad_tanque) : null,
      notas: o(f.notas),
    };
    if (!detalle) {
      cuerpo['contadores'] = iniciales
        .filter((c) => c.tipo)
        .map((c) => ({ tipo_contador_id: Number(c.tipo), valor_inicial: c.valor === '' ? 0 : Number(c.valor), ...(c.fecha ? { fecha_inicio: c.fecha } : {}) }));
    }
    try {
      const r = detalle ? await api.patch<{ equipo: { id: number }; avisos: AvisoEquipo[] }>(`/equipos/${detalle.id}`, cuerpo) : await api.post<{ equipo: { id: number }; avisos: AvisoEquipo[] }>('/equipos', cuerpo);
      alGuardar(r.equipo.id, r.avisos);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };

  const tipoBloqueado = !!detalle && (detalle.ordenes.total > 0 || !edita);
  const marcasDelTipo = (marcas.datos ?? []).filter((m) => (m.activo === 1 && (m.tipo_equipo_id === null || String(m.tipo_equipo_id) === f.tipo)) || String(m.id) === f.marca);
  return (
    <form onSubmit={enviar} className="space-y-4">
      <Aviso mensaje={error} tipo="error" />
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo etiqueta="Tipo de equipo" ayuda={tipoBloqueado && detalle?.ordenes.total ? 'Ya tiene órdenes de trabajo: el tipo no se cambia.' : undefined}>
          <select className={CLASE_INPUT} value={f.tipo} onChange={(e) => poner('tipo', e.target.value)} required disabled={tipoBloqueado || !edita}>
            <option value="">Elija…</option>
            {(tipos.datos ?? []).filter((t) => t.activo === 1 || String(t.id) === f.tipo).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Dueño del equipo">
          <select className={CLASE_INPUT} value={f.propiedad} onChange={(e) => poner('propiedad', e.target.value)} disabled={!edita}>
            <option value="cliente">Es de un cliente</option>
            <option value="propio">Es del propio taller</option>
          </select>
        </Campo>
        {f.propiedad === 'cliente' && (
          <>
            <Campo etiqueta="Cliente"><SelectorCliente valor={cliente} alCambiar={(c) => { setCliente(c); poner('departamento', ''); }} deshabilitado={!edita} /></Campo>
            <Campo etiqueta="Departamento del cliente (opcional)">
              <select className={CLASE_INPUT} value={f.departamento} onChange={(e) => poner('departamento', e.target.value)} disabled={!edita || !cliente}>
                <option value="">Ninguno</option>
                {departamentos.filter((d) => d.activo === 1 || String(d.id) === f.departamento).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
              </select>
            </Campo>
          </>
        )}
        <Campo etiqueta="Código interno" ayuda="El que el cliente usa para este equipo (opcional, no se repite en el mismo cliente)."><input className={CLASE_INPUT} value={f.codigo_interno} onChange={(e) => poner('codigo_interno', e.target.value)} maxLength={40} disabled={!edita} /></Campo>
        <Campo etiqueta="Serie" ayuda="Opcional; si la escribe, no puede estar en otro equipo."><input className={CLASE_INPUT} value={f.serie} onChange={(e) => poner('serie', e.target.value)} maxLength={60} disabled={!edita} /></Campo>
        {tipo?.es_vehiculo ? <Campo etiqueta="Placa"><input className={CLASE_INPUT} value={f.placa} onChange={(e) => poner('placa', e.target.value)} maxLength={20} disabled={!edita} /></Campo> : null}
        <Campo etiqueta="Marca">
          <select className={CLASE_INPUT} value={f.marca} onChange={(e) => poner('marca', e.target.value)} disabled={!edita}>
            <option value="">Sin marca</option>
            {marcasDelTipo.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </Campo>
        <Campo etiqueta="Modelo"><input className={CLASE_INPUT} value={f.modelo} onChange={(e) => poner('modelo', e.target.value)} maxLength={80} disabled={!edita} /></Campo>
        <Campo etiqueta="Año"><input type="number" min="1900" max="2100" className={CLASE_INPUT} value={f.anio} onChange={(e) => poner('anio', e.target.value)} disabled={!edita} /></Campo>
        <Campo etiqueta="Color"><input className={CLASE_INPUT} value={f.color} onChange={(e) => poner('color', e.target.value)} maxLength={40} disabled={!edita} /></Campo>
        <Campo etiqueta="Marca del motor"><input className={CLASE_INPUT} value={f.motor_marca} onChange={(e) => poner('motor_marca', e.target.value)} maxLength={60} disabled={!edita} /></Campo>
        <Campo etiqueta="Modelo del motor"><input className={CLASE_INPUT} value={f.motor_modelo} onChange={(e) => poner('motor_modelo', e.target.value)} maxLength={60} disabled={!edita} /></Campo>
        <Campo etiqueta="Serie del motor"><input className={CLASE_INPUT} value={f.motor_serie} onChange={(e) => poner('motor_serie', e.target.value)} maxLength={60} disabled={!edita} /></Campo>
        {tipo?.usa_combustible ? (
          <>
            <Campo etiqueta="Combustible"><input className={CLASE_INPUT} value={f.combustible} onChange={(e) => poner('combustible', e.target.value)} maxLength={30} placeholder="Diésel, gasolina…" disabled={!edita} /></Campo>
            <Campo etiqueta="Capacidad del tanque (litros)"><input type="number" min="0" step="0.01" className={CLASE_INPUT} value={f.capacidad_tanque} onChange={(e) => poner('capacidad_tanque', e.target.value)} disabled={!edita} /></Campo>
          </>
        ) : null}
        <Campo etiqueta="Observaciones" ancho="sm:col-span-2"><textarea className={CLASE_INPUT} rows={2} value={f.notas} onChange={(e) => poner('notas', e.target.value)} maxLength={500} disabled={!edita} /></Campo>
      </div>

      {!detalle && tipo && (
        <fieldset className="rounded-md border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium text-gray-700">Contadores con los que empieza</legend>
          <p className="mb-2 text-xs text-gray-500">Escriba lo que marca hoy el odómetro u horómetro. Desde ahí el contador solo avanza. Si el tipo tiene componentes, sus contadores se crean solos.</p>
          {iniciales.map((c, i) => {
            const t = (tiposContador.datos ?? []).find((x) => String(x.id) === c.tipo);
            return (
              <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_8rem_9rem_auto]">
                <select className={CLASE_INPUT} value={c.tipo} onChange={(e) => setIniciales((l) => l.map((x, j) => (j === i ? { ...x, tipo: e.target.value } : x)))} aria-label="Tipo de contador">
                  <option value="">Elija…</option>
                  {(tiposContador.datos ?? []).filter((x) => x.activo === 1).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
                <input type="number" min="0" step="0.01" className={CLASE_INPUT} value={t?.es_calendario ? '0' : c.valor} disabled={!!t?.es_calendario} onChange={(e) => setIniciales((l) => l.map((x, j) => (j === i ? { ...x, valor: e.target.value } : x)))} placeholder="Marca hoy" aria-label="Valor inicial" />
                <FechaInput value={c.fecha} onChange={(e) => setIniciales((l) => l.map((x, j) => (j === i ? { ...x, fecha: e.target.value } : x)))} className={CLASE_INPUT} aria-label="Fecha de inicio" />
                <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setIniciales((l) => l.filter((_, j) => j !== i))}>Quitar</button>
              </div>
            );
          })}
          <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setIniciales((l) => [...l, { tipo: '', valor: '', fecha: '' }])}>Agregar otro contador</button>
        </fieldset>
      )}
      {edita && <div className="flex justify-end border-t pt-3"><Button type="submit">Guardar</Button></div>}
    </form>
  );
}
