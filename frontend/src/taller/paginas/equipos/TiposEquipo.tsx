import { FormEvent, useEffect, useState } from 'react';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { dinero } from '../../../admin/tipos';
import { CatalogoSimple } from '../../componentes/CatalogoSimple';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, Si, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { TipoEquipo } from './tipos';

interface DetalleTipo extends TipoEquipo {
  documentos: Array<{ tipo_documento_id: number; nombre: string; obligatorio: number }>;
  componentes: Array<{ id: number; nombre: string; tipo_contador_id: number | null }>;
}

function FormTipo({ inicial, alCerrar, alGuardar }: { inicial: TipoEquipo | null; alCerrar: () => void; alGuardar: () => void }) {
  const { api } = useSesionTaller();
  const documentos = useLista(() => api.get<Array<{ id: number; nombre: string; activo: number }>>('/tipos-documento'), [api]);
  const contadores = useLista(() => api.get<Array<{ id: number; nombre: string; activo: number }>>('/tipos-contador'), [api]);
  const [v, setV] = useState({ codigo: '', nombre: '', es_vehiculo: false, usa_combustible: false, tarifa_venta_hora: '0', costo_hora: '0', tolerancia_dias: '0', tolerancia_contador: '0', tiene_componentes: false });
  const [pedidos, setPedidos] = useState<Record<number, 'no' | 'si' | 'obligatorio'>>({});
  const [componentes, setComponentes] = useState<Array<{ nombre: string; tipo_contador_id: string }>>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!inicial) return;
    setV({
      codigo: inicial.codigo,
      nombre: inicial.nombre,
      es_vehiculo: inicial.es_vehiculo === 1,
      usa_combustible: inicial.usa_combustible === 1,
      tarifa_venta_hora: String(inicial.tarifa_venta_hora),
      costo_hora: String(inicial.costo_hora),
      tolerancia_dias: String(inicial.tolerancia_dias),
      tolerancia_contador: String(inicial.tolerancia_contador),
      tiene_componentes: inicial.tiene_componentes === 1,
    });
    api.get<DetalleTipo>(`/tipos-equipo/${inicial.id}`).then((d) => {
      setPedidos(Object.fromEntries(d.documentos.map((x) => [x.tipo_documento_id, x.obligatorio === 1 ? 'obligatorio' : 'si'])));
      setComponentes(d.componentes.map((c) => ({ nombre: c.nombre, tipo_contador_id: c.tipo_contador_id ? String(c.tipo_contador_id) : '' })));
    }).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar')));
  }, [api, inicial]);

  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    const cuerpo = {
      nombre: v.nombre,
      es_vehiculo: v.es_vehiculo,
      usa_combustible: v.usa_combustible,
      tarifa_venta_hora: Number(v.tarifa_venta_hora) || 0,
      costo_hora: Number(v.costo_hora) || 0,
      tolerancia_dias: Math.round(Number(v.tolerancia_dias) || 0),
      tolerancia_contador: Number(v.tolerancia_contador) || 0,
      tiene_componentes: v.tiene_componentes,
    };
    try {
      let id: number;
      if (inicial) {
        await api.patch(`/tipos-equipo/${inicial.id}`, cuerpo);
        id = inicial.id;
      } else {
        id = (await api.post<{ id: number }>('/tipos-equipo', { codigo: v.codigo, ...cuerpo })).id;
      }
      await api.put(`/tipos-equipo/${id}/documentos`, { documentos: Object.entries(pedidos).filter(([, s]) => s !== 'no').map(([k, s]) => ({ tipo_documento_id: Number(k), obligatorio: s === 'obligatorio' })) });
      await api.put(`/tipos-equipo/${id}/componentes`, { componentes: v.tiene_componentes ? componentes.filter((c) => c.nombre.trim()).map((c) => ({ nombre: c.nombre, tipo_contador_id: c.tipo_contador_id ? Number(c.tipo_contador_id) : null })) : [] });
      alGuardar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar'));
    }
  };
  const caja = (k: 'es_vehiculo' | 'usa_combustible' | 'tiene_componentes', texto: string, ayuda: string) => (
    <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.checked })} /><span><span className="font-medium text-gray-800">{texto}</span><span className="block text-xs text-gray-500">{ayuda}</span></span></label>
  );
  return (
    <Modal onClose={alCerrar} title={inicial ? `Tipo de equipo: ${inicial.nombre}` : 'Nuevo tipo de equipo'} size="xl">
      <form onSubmit={enviar} className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        <div className="grid gap-3 sm:grid-cols-2">
          <Campo etiqueta="Código" ayuda={inicial ? 'No se cambia.' : 'Letras y números, sin espacios. Ejemplo: MONTACARGAS.'}><input className={CLASE_INPUT} value={v.codigo} onChange={(e) => setV({ ...v, codigo: e.target.value })} required={!inicial} disabled={!!inicial} maxLength={20} /></Campo>
          <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={v.nombre} onChange={(e) => setV({ ...v, nombre: e.target.value })} required maxLength={80} autoFocus={!!inicial} /></Campo>
          <Campo etiqueta="Tarifa de venta por hora" ayuda="Lo que se le cobra al cliente por cada hora de trabajo en este tipo de equipo."><input type="number" min="0" step="0.01" className={CLASE_INPUT} value={v.tarifa_venta_hora} onChange={(e) => setV({ ...v, tarifa_venta_hora: e.target.value })} /></Campo>
          <Campo etiqueta="Costo por hora (interno)" ayuda="Lo que le cuesta a su taller. Nunca se muestra al cliente."><input type="number" min="0" step="0.01" className={CLASE_INPUT} value={v.costo_hora} onChange={(e) => setV({ ...v, costo_hora: e.target.value })} /></Campo>
          <Campo etiqueta="Tolerancia en días" ayuda="Margen para los servicios por tiempo."><input type="number" min="0" max="3650" className={CLASE_INPUT} value={v.tolerancia_dias} onChange={(e) => setV({ ...v, tolerancia_dias: e.target.value })} /></Campo>
          <Campo etiqueta="Tolerancia en el contador" ayuda="Margen en km u horas para los servicios por uso."><input type="number" min="0" step="0.01" className={CLASE_INPUT} value={v.tolerancia_contador} onChange={(e) => setV({ ...v, tolerancia_contador: e.target.value })} /></Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {caja('es_vehiculo', 'Es un vehículo', 'Se le pide placa.')}
          {caja('usa_combustible', 'Usa combustible', 'Se le pide combustible y tanque.')}
          {caja('tiene_componentes', 'Tiene componentes', 'Partes con su propio contador.')}
        </div>
        <fieldset className="rounded-md border border-gray-200 p-3">
          <legend className="px-1 text-sm font-medium text-gray-700">Documentos que se piden a estos equipos</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(documentos.datos ?? []).filter((d) => d.activo === 1 || pedidos[d.id]).map((d) => (
              <label key={d.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{d.nombre}</span>
                <select className="rounded-md border border-gray-300 px-2 py-1 text-sm" value={pedidos[d.id] ?? 'no'} onChange={(e) => setPedidos({ ...pedidos, [d.id]: e.target.value as 'no' | 'si' | 'obligatorio' })}>
                  <option value="no">No se pide</option>
                  <option value="si">Opcional</option>
                  <option value="obligatorio">Obligatorio</option>
                </select>
              </label>
            ))}
          </div>
        </fieldset>
        {v.tiene_componentes && (
          <fieldset className="rounded-md border border-gray-200 p-3">
            <legend className="px-1 text-sm font-medium text-gray-700">Componentes de cada equipo nuevo</legend>
            <p className="mb-2 text-xs text-gray-500">Se copian a cada equipo que se cree de este tipo (los equipos que ya existen no cambian).</p>
            {componentes.map((c, i) => (
              <div key={i} className="mb-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                <input className={CLASE_INPUT} value={c.nombre} onChange={(e) => setComponentes((l) => l.map((x, j) => (j === i ? { ...x, nombre: e.target.value } : x)))} placeholder="Nombre (Motor, Trilla…)" maxLength={80} aria-label="Nombre del componente" />
                <select className={CLASE_INPUT} value={c.tipo_contador_id} onChange={(e) => setComponentes((l) => l.map((x, j) => (j === i ? { ...x, tipo_contador_id: e.target.value } : x)))} aria-label="Contador del componente">
                  <option value="">Sin contador</option>
                  {(contadores.datos ?? []).filter((x) => x.activo === 1).map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                </select>
                <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setComponentes((l) => l.filter((_, j) => j !== i))}>Quitar</button>
              </div>
            ))}
            <button type="button" className="text-sm font-semibold text-primary hover:underline" onClick={() => setComponentes((l) => [...l, { nombre: '', tipo_contador_id: '' }])}>Agregar componente</button>
          </fieldset>
        )}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

export function TiposEquipo() {
  const { api, tiene } = useSesionTaller();
  const lista = useLista(() => api.get<TipoEquipo[]>('/tipos-equipo?inactivos=true'), [api]);
  const [editando, setEditando] = useState<TipoEquipo | 'nuevo' | null>(null);
  const [error, setError] = useState('');
  const gestiona = tiene('tipos_equipo.gestionar');
  const estado = async (t: TipoEquipo): Promise<void> => {
    try {
      await api.patch(`/tipos-equipo/${t.id}`, { activo: t.activo !== 1 });
      setError('');
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar'));
    }
  };
  const columnas: Array<Columna<TipoEquipo>> = [
    { clave: 'nombre', etiqueta: 'Tipo', valor: (t) => t.nombre, render: (t) => <span><span className="block font-medium text-gray-900">{t.nombre}</span><span className="block text-xs text-gray-500">{t.codigo}</span></span> },
    { clave: 'veh', etiqueta: 'Vehículo', valor: (t) => t.es_vehiculo, render: (t) => <Si v={t.es_vehiculo} /> },
    { clave: 'comb', etiqueta: 'Combustible', valor: (t) => t.usa_combustible, render: (t) => <Si v={t.usa_combustible} /> },
    { clave: 'comp', etiqueta: 'Componentes', valor: (t) => t.tiene_componentes, render: (t) => <Si v={t.tiene_componentes} /> },
    { clave: 'tarifa', etiqueta: 'Tarifa por hora', valor: (t) => t.tarifa_venta_hora, render: (t) => dinero(t.tarifa_venta_hora), alinear: 'right' },
    { clave: 'equipos', etiqueta: 'Equipos', valor: (t) => t.equipos ?? 0, render: (t) => String(t.equipos ?? 0), alinear: 'right' },
    { clave: 'estado', etiqueta: 'Estado', valor: (t) => t.activo, render: (t) => <Badge variant={t.activo ? 'success' : 'default'}>{t.activo ? 'Activo' : 'Inactivo'}</Badge> },
    { clave: 'acc', etiqueta: 'Acciones', render: (t) => gestiona && <Acciones><BotonAccion onClick={() => void estado(t)}>{t.activo ? 'Desactivar' : 'Activar'}</BotonAccion><BotonAccion onClick={() => setEditando(t)}>Editar</BotonAccion></Acciones> },
  ];
  return (
    <Seccion titulo="Tipos de equipo" acciones={gestiona && <Button onClick={() => setEditando('nuevo')}>Nuevo tipo de equipo</Button>}>
      <p className="text-sm text-gray-600">El tipo manda sobre la tarifa por hora, los documentos que se piden y los campos de la ficha (placa para vehículos, combustible para quien lo usa).</p>
      <Aviso mensaje={lista.error || error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(t) => t.id} vacio={lista.datos ? 'No hay tipos de equipo.' : 'Cargando…'} />
      {editando && <FormTipo inicial={editando === 'nuevo' ? null : editando} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); lista.recargar(); }} />}
    </Seccion>
  );
}

/** Tipos de contador (odómetro, horómetro, calendario…) y tipos de documento (seguro, tarjeta…). */
export function CatalogosDeEquipos() {
  const { api } = useSesionTaller();
  const unidades = useLista(() => api.get<Array<{ id: number; codigo: string; nombre: string; uso: string; activo: number }>>('/catalogos/unidades'), [api]);
  const opciones = (unidades.datos ?? []).filter((u) => u.activo === 1 && u.uso !== 'inventario').map((u) => ({ valor: String(u.id), texto: `${u.nombre} (${u.codigo})` }));
  const nombreUnidad = (id: unknown): string => (unidades.datos ?? []).find((u) => u.id === id)?.codigo ?? '';
  return (
    <div className="space-y-8">
      <CatalogoSimple
        key={unidades.datos ? 'listo' : 'cargando'}
        titulo="Tipos de contador"
        singular="tipo de contador"
        ruta="/tipos-contador"
        permiso="tipos_equipo.gestionar"
        descripcion="Qué se mide: kilómetros, horas de motor, días. Uno de calendario cuenta los días solo y no lleva lecturas. La unidad y si es de calendario no se cambian después."
        campos={[
          { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 80 },
          { clave: 'unidad_id', etiqueta: 'Unidad', tipo: 'referencia', requerido: true, soloAlCrear: true, opciones },
          { clave: 'es_calendario', etiqueta: 'Es de calendario (cuenta días)', tipo: 'bool', soloAlCrear: true, defecto: false },
        ]}
        mostrar={[
          { clave: 'nombre', etiqueta: 'Contador' },
          { clave: 'unidad_id', etiqueta: 'Unidad', render: (r) => nombreUnidad(r['unidad_id']) },
          { clave: 'es_calendario', etiqueta: 'Calendario', render: (r) => (r['es_calendario'] ? 'Sí' : 'No') },
        ]}
      />
      <CatalogoSimple
        titulo="Tipos de documento"
        singular="tipo de documento"
        ruta="/tipos-documento"
        permiso="tipos_equipo.gestionar"
        descripcion="Los papeles que se guardan en la ficha del equipo. Los que vencen avisan con anticipación."
        campos={[
          { clave: 'nombre', etiqueta: 'Nombre', tipo: 'texto', requerido: true, max: 100 },
          { clave: 'requiere_vencimiento', etiqueta: 'Tiene fecha de vencimiento', tipo: 'bool', defecto: false },
          { clave: 'dias_aviso', etiqueta: 'Avisar con (días de anticipación)', tipo: 'numero', defecto: 30 },
        ]}
        mostrar={[
          { clave: 'nombre', etiqueta: 'Documento' },
          { clave: 'requiere_vencimiento', etiqueta: 'Vence', render: (r) => (r['requiere_vencimiento'] ? 'Sí' : 'No') },
          { clave: 'dias_aviso', etiqueta: 'Aviso (días)', render: (r) => (r['requiere_vencimiento'] ? String(r['dias_aviso']) : '—') },
        ]}
      />
    </div>
  );
}
