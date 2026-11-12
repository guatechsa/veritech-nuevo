import { FormEvent, useState } from 'react';
import Button from '../../../components/ui-guatech/Button.jsx';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { dineroDe, OpcionesOrden } from './tipos';

interface Tarifa {
  area_trabajo_id: number;
  area: string;
  tipo_equipo_id: number;
  tipo_equipo: string;
  tarifa_venta_hora: number;
  costo_hora: number;
}

/** Tarifa de venta y costo por hora de un tipo de equipo cuando se trabaja en un área concreta (si no hay, rige la del tipo de equipo). */
export function TarifasArea() {
  const { api, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const lista = useLista(() => api.get<Tarifa[]>('/tarifas-area'), [api]);
  const opciones = useLista(() => api.get<OpcionesOrden>('/ordenes-opciones'), [api]);
  const tipos = useLista(() => api.get<Array<{ id: number; nombre: string }>>('/tipos-equipo'), [api]);
  const [area, setArea] = useState('');
  const [tipo, setTipo] = useState('');
  const [tarifa, setTarifa] = useState('');
  const [costo, setCosto] = useState('');
  const [error, setError] = useState('');

  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.put(`/tarifas-area/${area}/${tipo}`, { tarifa_venta_hora: Number(tarifa), costo_hora: Number(costo || 0) });
      setTarifa('');
      setCosto('');
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar la tarifa'));
    }
  };
  const quitar = async (t: Tarifa): Promise<void> => {
    setError('');
    try {
      await api.delete(`/tarifas-area/${t.area_trabajo_id}/${t.tipo_equipo_id}`);
      lista.recargar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo quitar la tarifa'));
    }
  };
  const columnas: Array<Columna<Tarifa>> = [
    { clave: 'area', etiqueta: 'Área de trabajo', valor: (t) => t.area },
    { clave: 'tipo', etiqueta: 'Tipo de equipo', valor: (t) => t.tipo_equipo },
    { clave: 'tarifa', etiqueta: 'Tarifa de venta por hora', valor: (t) => t.tarifa_venta_hora, render: (t) => dineroDe(moneda, t.tarifa_venta_hora), alinear: 'right' },
    { clave: 'costo', etiqueta: 'Costo por hora (interno)', valor: (t) => t.costo_hora, render: (t) => dineroDe(moneda, t.costo_hora), alinear: 'right' },
    { clave: 'acc', etiqueta: 'Acciones', render: (t) => <Acciones><BotonAccion onClick={() => void quitar(t)}>Quitar</BotonAccion></Acciones> },
  ];
  return (
    <Seccion titulo="Tarifas por área">
      <p className="text-sm text-gray-700">
        El precio de un trabajo es sus horas por la tarifa de venta por hora del tipo de equipo. Aquí puede poner una tarifa distinta cuando el trabajo se hace en un área concreta;
        si no hay una para esa combinación, rige la del tipo de equipo. La tarifa queda copiada en cada línea de la orden: cambiarla después no altera lo ya cotizado.
      </p>
      <Aviso mensaje={error || lista.error} tipo="error" />
      <form onSubmit={guardar} className="flex flex-wrap items-end gap-3 rounded-md border border-gray-200 bg-white p-3">
        <Campo etiqueta="Área de trabajo"><select className={CLASE_INPUT} value={area} onChange={(e) => setArea(e.target.value)} required><option value="">Elija…</option>{(opciones.datos?.areas ?? []).map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Tipo de equipo"><select className={CLASE_INPUT} value={tipo} onChange={(e) => setTipo(e.target.value)} required><option value="">Elija…</option>{(tipos.datos ?? []).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Tarifa de venta por hora"><input className={CLASE_INPUT} type="number" min={0} step="0.01" value={tarifa} onChange={(e) => setTarifa(e.target.value)} required /></Campo>
        <Campo etiqueta="Costo por hora (interno)"><input className={CLASE_INPUT} type="number" min={0} step="0.01" value={costo} onChange={(e) => setCosto(e.target.value)} /></Campo>
        <Button type="submit">Guardar tarifa</Button>
      </form>
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(t) => `${t.area_trabajo_id}-${t.tipo_equipo_id}`} vacio={lista.datos ? 'Todavía no hay tarifas por área: se usa la de cada tipo de equipo.' : 'Cargando…'} />
    </Seccion>
  );
}
