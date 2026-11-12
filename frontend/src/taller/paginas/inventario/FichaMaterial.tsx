import { FormEvent, useEffect, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { fechaHoraLocal } from '../../../utils/hora';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { dineroDe } from '../ordenes/tipos';
import { DetalleMaterial, Movimiento, OpcionesInventario } from './tipos';

// ── Crear o editar un material ────────────────────────────────────────────────────────
export function FormMaterial({ material, opciones, alCerrar, alListo }: { material?: DetalleMaterial; opciones: OpcionesInventario; alCerrar: () => void; alListo: (id: number) => void }) {
  const { api, tiene } = useSesionTaller();
  const marcas = useLista(() => api.get<Array<{ id: number; nombre: string }>>('/catalogos/marcas'), [api]);
  const [codigo, setCodigo] = useState(material?.codigo ?? '');
  const [nombre, setNombre] = useState(material?.nombre ?? '');
  const [descripcion, setDescripcion] = useState(material?.descripcion ?? '');
  const [parte, setParte] = useState(material ? String(material.parte_id) : '');
  const [unidad, setUnidad] = useState(material ? String(material.unidad_id) : '');
  const [marca, setMarca] = useState(material?.marca_id ? String(material.marca_id) : '');
  const [oem, setOem] = useState(material?.codigo_oem ?? '');
  const [minimo, setMinimo] = useState(String(material?.existencia_minima ?? 0));
  const [ubicacion, setUbicacion] = useState(material?.ubicacion ?? '');
  const [precio, setPrecio] = useState(material?.precio_manual != null ? String(material.precio_manual) : '');
  const [proveedor, setProveedor] = useState(material?.proveedor_principal_id ? String(material.proveedor_principal_id) : '');
  const [activo, setActivo] = useState(material ? material.activo === 1 : true);
  const [error, setError] = useState('');
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      const cuerpo = {
        nombre,
        descripcion: descripcion.trim() || null,
        parte_id: Number(parte),
        unidad_id: Number(unidad),
        marca_id: marca ? Number(marca) : null,
        codigo_oem: oem.trim() || null,
        existencia_minima: Number(minimo || 0),
        ubicacion: ubicacion.trim() || null,
        precio_manual: precio.trim() === '' ? null : Number(precio),
        proveedor_principal_id: proveedor ? Number(proveedor) : null,
      };
      const r = material ? await api.patch<{ id: number }>(`/materiales/${material.id}`, { ...cuerpo, activo }) : await api.post<{ id: number }>('/materiales', { ...cuerpo, codigo });
      alListo(r.id);
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar el material'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={material ? `Material ${material.codigo}` : 'Nuevo material'} size="lg">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <div className="grid gap-3 sm:grid-cols-2">
          {!material && <Campo etiqueta="Código" ayuda="No se puede cambiar después."><input className={CLASE_INPUT} value={codigo} onChange={(e) => setCodigo(e.target.value)} maxLength={30} required autoFocus /></Campo>}
          <Campo etiqueta="Nombre"><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={200} required /></Campo>
        </div>
        <Campo etiqueta="Clasificación (sistema › subsistema › parte)" ayuda="Es obligatoria: de ella sale el margen de ganancia. Lo que no es de un sistema técnico va en «99 Insumos generales».">
          <select className={CLASE_INPUT} value={parte} onChange={(e) => setParte(e.target.value)} required><option value="">Elija…</option>{opciones.partes.map((p) => <option key={p.id} value={p.id}>{p.clasificacion} › {p.nombre}</option>)}</select>
        </Campo>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Unidad" ayuda="Siempre enteras: para vender medio metro use centímetros."><select className={CLASE_INPUT} value={unidad} onChange={(e) => setUnidad(e.target.value)} required><option value="">Elija…</option>{opciones.unidades.map((u) => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Marca"><select className={CLASE_INPUT} value={marca} onChange={(e) => setMarca(e.target.value)}><option value="">Sin marca</option>{(marcas.datos ?? []).map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Código del fabricante"><input className={CLASE_INPUT} value={oem} onChange={(e) => setOem(e.target.value)} maxLength={60} /></Campo>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Campo etiqueta="Existencia mínima" ayuda="Avisa cuando hay menos."><input className={CLASE_INPUT} type="number" min={0} step={1} value={minimo} onChange={(e) => setMinimo(e.target.value)} /></Campo>
          <Campo etiqueta="Ubicación"><input className={CLASE_INPUT} value={ubicacion} onChange={(e) => setUbicacion(e.target.value)} maxLength={60} /></Campo>
          <Campo etiqueta="Proveedor principal"><select className={CLASE_INPUT} value={proveedor} onChange={(e) => setProveedor(e.target.value)}><option value="">Ninguno</option>{opciones.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
        </div>
        <Campo etiqueta="Precio fijo (opcional)" ayuda="Vacío = el precio sale del costo más el margen de ganancia."><input className={`${CLASE_INPUT} max-w-xs`} type="number" min={0} step="0.01" value={precio} onChange={(e) => setPrecio(e.target.value)} /></Campo>
        <Campo etiqueta="Descripción"><textarea className={CLASE_INPUT} rows={2} maxLength={500} value={descripcion} onChange={(e) => setDescripcion(e.target.value)} /></Campo>
        {material && tiene('inventario.catalogo') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={activo} onChange={(e) => setActivo(e.target.checked)} /> Activo</label>}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

// ── Traslado y diferencia ─────────────────────────────────────────────────────────────
function Traslado({ material, opciones, origen, alCerrar, alListo }: { material: DetalleMaterial; opciones: OpcionesInventario; origen: number; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [destino, setDestino] = useState('');
  const [cantidad, setCantidad] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const hay = material.por_bodega.find((b) => b.bodega_id === origen)?.cantidad ?? 0;
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post('/inventario/traslados', { material_id: material.id, bodega_origen_id: origen, bodega_destino_id: Number(destino), cantidad: Number(cantidad), notas: notas.trim() || null });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo trasladar'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Trasladar a otra bodega" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">{material.codigo} · {material.nombre}. En esta bodega hay <strong>{hay}</strong>.</p>
        <Campo etiqueta="Bodega de destino"><select className={CLASE_INPUT} value={destino} onChange={(e) => setDestino(e.target.value)} required><option value="">Elija…</option>{opciones.bodegas.filter((b) => b.id !== origen).map((b) => <option key={b.id} value={b.id}>{b.nombre} ({b.sucursal})</option>)}</select></Campo>
        <Campo etiqueta="Cantidad"><input className={CLASE_INPUT} type="number" min={1} max={hay} step={1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} required /></Campo>
        <Campo etiqueta="Nota (opcional)"><input className={CLASE_INPUT} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Trasladar</Button></div>
      </form>
    </Modal>
  );
}

function Diferencia({ material, opciones, bodega, alCerrar, alListo }: { material: DetalleMaterial; opciones: OpcionesInventario; bodega: number; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [real, setReal] = useState('');
  const [motivo, setMotivo] = useState('');
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const hay = material.por_bodega.find((b) => b.bodega_id === bodega)?.cantidad ?? 0;
  const delta = real === '' ? null : Number(real) - hay;
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post('/inventario/diferencias', { material_id: material.id, bodega_id: bodega, cantidad_real: Number(real), motivo_id: Number(motivo), notas: notas.trim() || null });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo registrar la diferencia'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Diferencia de inventario" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">{material.codigo} · {material.nombre}. El sistema dice que en esta bodega hay <strong>{hay}</strong>. Escriba lo que hay <strong>de verdad</strong>; la diferencia queda registrada con su motivo.</p>
        <Campo etiqueta="Cantidad real"><input className={CLASE_INPUT} type="number" min={0} step={1} value={real} onChange={(e) => setReal(e.target.value)} required autoFocus /></Campo>
        {delta !== null && delta !== 0 && <p className={`text-sm font-medium ${delta < 0 ? 'text-red-700' : 'text-green-700'}`}>Diferencia: {delta > 0 ? '+' : ''}{delta}</p>}
        <Campo etiqueta="Motivo"><select className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} required><option value="">Elija…</option>{opciones.motivos_diferencia.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}</select></Campo>
        <Campo etiqueta="Nota (opcional)"><input className={CLASE_INPUT} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" variant="danger">Registrar diferencia</Button></div>
      </form>
    </Modal>
  );
}

// ── La ficha ──────────────────────────────────────────────────────────────────────────
export function FichaMaterial({ id, opciones, alCerrar, alCambiar }: { id: number; opciones: OpcionesInventario; alCerrar: () => void; alCambiar: () => void }) {
  const { api, tiene, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const [m, setM] = useState<DetalleMaterial | null>(null);
  const [error, setError] = useState('');
  const [ventana, setVentana] = useState<'editar' | { traslado: number } | { diferencia: number } | null>(null);
  const movimientos = useLista(() => api.get<{ registros: Movimiento[] }>(`/inventario/movimientos?material_id=${id}`), [api, id]);
  const cargar = (): void => {
    api.get<DetalleMaterial>(`/materiales/${id}`).then((d) => { setM(d); setError(''); }).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar el material')));
  };
  useEffect(cargar, [api, id]); // eslint-disable-line react-hooks/exhaustive-deps
  const refrescar = (): void => {
    setVentana(null);
    cargar();
    movimientos.recargar();
    alCambiar();
  };
  const columnas: Array<Columna<DetalleMaterial['por_bodega'][number]>> = [
    { clave: 'bodega', etiqueta: 'Bodega', valor: (b) => b.bodega, render: (b) => <span>{b.bodega}<span className="block text-xs text-gray-500">{b.sucursal}</span></span> },
    { clave: 'cantidad', etiqueta: 'Cantidad', valor: (b) => b.cantidad, alinear: 'right' },
    { clave: 'acc', etiqueta: 'Acciones', render: (b) => (
      <Acciones>
        {tiene('inventario.trasladar') && b.cantidad > 0 && <BotonAccion onClick={() => setVentana({ traslado: b.bodega_id })}>Trasladar</BotonAccion>}
        {tiene('inventario.diferencias') && <BotonAccion onClick={() => setVentana({ diferencia: b.bodega_id })}>Corregir cantidad</BotonAccion>}
      </Acciones>
    ) },
  ];
  const movCols: Array<Columna<Movimiento>> = [
    { clave: 'fecha', etiqueta: 'Fecha', valor: (x) => x.fecha, render: (x) => fechaHoraLocal(x.fecha) },
    { clave: 'tipo', etiqueta: 'Movimiento', valor: (x) => x.tipo, render: (x) => <span>{x.tipo}{x.motivo ? <span className="block text-xs text-gray-500">{x.motivo}</span> : null}</span> },
    { clave: 'bodega', etiqueta: 'Bodega', valor: (x) => x.bodega },
    { clave: 'cantidad', etiqueta: 'Cantidad', valor: (x) => x.cantidad, render: (x) => <span className={x.cantidad < 0 ? 'text-red-700' : 'text-green-700'}>{x.cantidad > 0 ? '+' : ''}{x.cantidad}</span>, alinear: 'right' },
    { clave: 'saldo', etiqueta: 'Saldo', valor: (x) => x.saldo_resultante, alinear: 'right' },
    { clave: 'usuario', etiqueta: 'Quién', valor: (x) => x.usuario ?? '', render: (x) => x.usuario ?? '—' },
  ];
  return (
    <Modal onClose={alCerrar} title={m ? `${m.codigo} · ${m.nombre}` : 'Material'} size="2xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        {!m ? <p className="text-sm text-gray-500">Cargando…</p> : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="space-y-1 text-sm">
                <p className="text-gray-700">{m.clasificacion} · {m.parte}{m.marca ? ` · ${m.marca}` : ''}{m.codigo_oem ? ` · ${m.codigo_oem}` : ''}</p>
                <p className="text-gray-700">
                  Existencia total: <strong>{m.existencia_total} {m.unidad}</strong>{m.existencia_minima > 0 && ` (mínimo ${m.existencia_minima})`} {m.bajo_minimo && <Badge variant="danger">Bajo el mínimo</Badge>} {m.activo !== 1 && <Badge variant="default">Inactivo</Badge>}
                </p>
                <p className="text-gray-700">Precio de venta: <strong>{dineroDe(moneda, m.precio)}</strong>{m.precio_manual != null ? ' (fijo)' : ''}</p>
                {m.costo_promedio !== undefined && <p className="text-gray-600">Costo promedio {dineroDe(moneda, m.costo_promedio)} · último costo {dineroDe(moneda, m.costo_ultimo)} · margen {m.margen}% ({m.margen_origen})</p>}
                {m.ubicacion && <p className="text-gray-600">Ubicación: {m.ubicacion}</p>}
                {m.descripcion && <p className="text-gray-800">{m.descripcion}</p>}
              </div>
              {tiene('inventario.catalogo') && <Button size="sm" variant="outline" onClick={() => setVentana('editar')}>Editar material</Button>}
            </div>
            <section className="space-y-2"><h3 className="text-sm font-bold text-gray-900">Existencia por bodega</h3><Tabla columnas={columnas} filas={m.por_bodega} clave={(b) => b.bodega_id} vacio="No hay bodegas activas: créelas en Configuración → Sucursales y áreas." /></section>
            <section className="space-y-2"><h3 className="text-sm font-bold text-gray-900">Últimos movimientos</h3><Tabla columnas={movCols} filas={(movimientos.datos?.registros ?? []).slice(0, 15)} clave={(x) => x.id} vacio="Todavía no hay movimientos." /></section>
          </>
        )}
      </div>
      {m && ventana === 'editar' && <FormMaterial material={m} opciones={opciones} alCerrar={() => setVentana(null)} alListo={refrescar} />}
      {m && typeof ventana === 'object' && ventana !== null && 'traslado' in ventana && <Traslado material={m} opciones={opciones} origen={ventana.traslado} alCerrar={() => setVentana(null)} alListo={refrescar} />}
      {m && typeof ventana === 'object' && ventana !== null && 'diferencia' in ventana && <Diferencia material={m} opciones={opciones} bodega={ventana.diferencia} alCerrar={() => setVentana(null)} alListo={refrescar} />}
    </Modal>
  );
}
