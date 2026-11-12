import { FormEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Modal from '../../components/ui-guatech/Modal.jsx';
import FechaInput from '../../components/ui-guatech/FechaInput';
import { formatFecha } from '../../components/ui-guatech/formatoFecha.js';
import { Acciones, BotonAccion } from '../../components/ui-guatech/AccionBoton.jsx';
import Tabla, { Columna } from '../../admin/componentes/Tabla';
import { fechaHoraLocal } from '../../utils/hora';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../componentes/ui';
import { useSesionTaller } from '../Sesion';
import { dineroDe } from './ordenes/tipos';
import { FichaMaterial, FormMaterial } from './inventario/FichaMaterial';
import { FilaCompra, FilaMaterial, Movimiento, OpcionesInventario } from './inventario/tipos';

const hoyIso = (): string => {
  const d = new Date();
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
};

function Paginador({ total, porPagina, pagina, alCambiar, cosa }: { total: number; porPagina: number; pagina: number; alCambiar: (p: number) => void; cosa: string }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina));
  return (
    <div className="flex items-center justify-between text-sm text-gray-600">
      <span>{total} {cosa} · página {pagina} de {paginas}</span>
      <span className="flex gap-2"><Button variant="outline" size="sm" disabled={pagina <= 1} onClick={() => alCambiar(pagina - 1)}>Anterior</Button><Button variant="outline" size="sm" disabled={pagina >= paginas} onClick={() => alCambiar(pagina + 1)}>Siguiente</Button></span>
    </div>
  );
}

// ── Materiales ────────────────────────────────────────────────────────────────────────
function Materiales({ opciones }: { opciones: OpcionesInventario }) {
  const { api, tiene, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const [params, setParams] = useSearchParams();
  const [buscar, setBuscar] = useState('');
  const [sistema, setSistema] = useState('');
  const [bajo, setBajo] = useState(false);
  const [inactivos, setInactivos] = useState(false);
  const [pagina, setPagina] = useState(1);
  const [nuevo, setNuevo] = useState(false);
  const abierto = params.get('material') ? Number(params.get('material')) : null;
  const q = new URLSearchParams({ pagina: String(pagina), ...(buscar.trim() ? { buscar: buscar.trim() } : {}), ...(sistema ? { sistema_id: sistema } : {}), ...(bajo ? { bajo_minimo: 'true' } : {}), ...(inactivos ? { inactivos: 'true' } : {}) });
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: FilaMaterial[] }>(`/materiales?${q.toString()}`), [api, pagina, buscar, sistema, bajo, inactivos]);
  useEffect(() => setPagina(1), [buscar, sistema, bajo, inactivos]);
  const verCostos = tiene('inventario.ver_costos');
  const abrir = (id: number | null): void => setParams(id ? { tab: 'materiales', material: String(id) } : { tab: 'materiales' }, { replace: true });
  const columnas: Array<Columna<FilaMaterial>> = [
    { clave: 'codigo', etiqueta: 'Código', valor: (m) => m.codigo },
    { clave: 'nombre', etiqueta: 'Material', valor: (m) => m.nombre, render: (m) => <span><span className="block font-medium text-gray-900">{m.nombre}</span><span className="block text-xs text-gray-500">{m.clasificacion}{m.marca ? ` · ${m.marca}` : ''}</span></span> },
    { clave: 'existencia', etiqueta: 'Existencia', valor: (m) => m.existencia_total, render: (m) => <span className={m.bajo_minimo ? 'font-semibold text-red-700' : ''}>{m.existencia_total} {m.unidad}</span>, alinear: 'right' },
    { clave: 'minimo', etiqueta: 'Mínimo', valor: (m) => m.existencia_minima, alinear: 'right' },
    ...(verCostos ? [{ clave: 'costo', etiqueta: 'Costo promedio', valor: (m: FilaMaterial) => m.costo_promedio ?? 0, render: (m: FilaMaterial) => dineroDe(moneda, m.costo_promedio ?? 0), alinear: 'right' as const }] : []),
    { clave: 'precio', etiqueta: 'Precio', valor: (m) => m.precio, render: (m) => dineroDe(moneda, m.precio), alinear: 'right' },
    { clave: 'estado', etiqueta: 'Estado', valor: (m) => m.activo, render: (m) => (m.activo !== 1 ? <Badge variant="default">Inactivo</Badge> : m.bajo_minimo ? <Badge variant="danger">Bajo el mínimo</Badge> : <Badge variant="success">Normal</Badge>) },
    { clave: 'acc', etiqueta: 'Acciones', render: (m) => <Acciones><BotonAccion onClick={() => abrir(m.id)}>Ver</BotonAccion></Acciones> },
  ];
  return (
    <Seccion titulo="Materiales" acciones={tiene('inventario.catalogo') && <Button onClick={() => setNuevo(true)}>Nuevo material</Button>}>
      <div className="flex flex-wrap items-center gap-3">
        <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por código, nombre, marca o código del fabricante" aria-label="Buscar material" className="min-w-64 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <select value={sistema} onChange={(e) => setSistema(e.target.value)} aria-label="Sistema" className="rounded-md border border-gray-300 px-3 py-2 text-sm"><option value="">Todos los sistemas</option>{opciones.sistemas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={bajo} onChange={(e) => setBajo(e.target.checked)} /> Solo bajo el mínimo</label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> Incluir inactivos</label>
      </div>
      <Aviso mensaje={lista.error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(m) => m.id} vacio={lista.datos ? 'No hay materiales con esos filtros.' : 'Cargando…'} />
      {lista.datos && <Paginador total={lista.datos.total} porPagina={lista.datos.porPagina} pagina={pagina} alCambiar={setPagina} cosa="materiales" />}
      {nuevo && <FormMaterial opciones={opciones} alCerrar={() => setNuevo(false)} alListo={(id) => { setNuevo(false); lista.recargar(); abrir(id); }} />}
      {abierto && <FichaMaterial id={abierto} opciones={opciones} alCerrar={() => abrir(null)} alCambiar={lista.recargar} />}
    </Seccion>
  );
}

// ── Compras ───────────────────────────────────────────────────────────────────────────
interface LineaCompra { material_id: number; codigo: string; nombre: string; unidad: string; cantidad: string; costo: string }

function NuevaCompra({ opciones, alCerrar, alListo }: { opciones: OpcionesInventario; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [proveedor, setProveedor] = useState('');
  const [bodega, setBodega] = useState(opciones.bodegas.length === 1 ? String(opciones.bodegas[0]?.id) : '');
  const [fecha, setFecha] = useState(hoyIso());
  const [factura, setFactura] = useState('');
  const [notas, setNotas] = useState('');
  const [lineas, setLineas] = useState<LineaCompra[]>([]);
  const [texto, setTexto] = useState('');
  const [resultados, setResultados] = useState<FilaMaterial[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (texto.trim().length < 2) return setResultados([]);
    const espera = setTimeout(() => api.get<{ registros: FilaMaterial[] }>(`/materiales?buscar=${encodeURIComponent(texto.trim())}`).then((r) => setResultados(r.registros.slice(0, 8))).catch(() => setResultados([])), 250);
    return () => clearTimeout(espera);
  }, [api, texto]);
  const agregar = (m: FilaMaterial): void => {
    setLineas((ls) => (ls.some((l) => l.material_id === m.id) ? ls : [...ls, { material_id: m.id, codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, cantidad: '1', costo: m.costo_ultimo != null ? String(m.costo_ultimo) : '' }]));
    setTexto('');
    setResultados([]);
  };
  const cambiar = (i: number, campo: 'cantidad' | 'costo', v: string): void => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, [campo]: v } : l)));
  const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo) || 0), 0);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/compras', {
        proveedor_id: Number(proveedor),
        bodega_id: Number(bodega),
        fecha_documento: fecha,
        numero_factura: factura.trim() || null,
        notas: notas.trim() || null,
        lineas: lineas.map((l) => ({ material_id: l.material_id, cantidad: Number(l.cantidad), costo_unitario: Number(l.costo) })),
      });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo registrar la compra'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Registrar compra" size="2xl">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo etiqueta="Proveedor"><select className={CLASE_INPUT} value={proveedor} onChange={(e) => setProveedor(e.target.value)} required><option value="">Elija…</option>{opciones.proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
          <Campo etiqueta="Bodega que recibe"><select className={CLASE_INPUT} value={bodega} onChange={(e) => setBodega(e.target.value)} required><option value="">Elija…</option>{opciones.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre} ({b.sucursal})</option>)}</select></Campo>
          <Campo etiqueta="Fecha de la factura"><FechaInput value={fecha} onChange={(e) => setFecha(e.target.value)} max={hoyIso()} required className={CLASE_INPUT} /></Campo>
          <Campo etiqueta="Número de factura" ayuda="No se puede repetir con el mismo proveedor."><input className={CLASE_INPUT} value={factura} onChange={(e) => setFactura(e.target.value)} maxLength={40} /></Campo>
        </div>
        <Campo etiqueta="Agregar material">
          <div className="relative">
            <input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escriba el código o el nombre" data-no-uppercase="true" autoComplete="off" />
            {resultados.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">{resultados.map((m) => <li key={m.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => agregar(m)}>{m.nombre} <span className="text-xs text-gray-500">{m.codigo} · hay {m.existencia_total} {m.unidad}</span></button></li>)}</ul>}
          </div>
        </Campo>
        {lineas.length === 0 ? <p className="text-sm text-gray-500">Agregue al menos un material.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-gray-500"><th className="py-1">Material</th><th className="w-28 py-1">Cantidad</th><th className="w-32 py-1">Costo unitario</th><th className="w-28 py-1 text-right">Subtotal</th><th className="w-10" /></tr></thead>
              <tbody>
                {lineas.map((l, i) => (
                  <tr key={l.material_id} className="border-b">
                    <td className="py-1">{l.nombre} <span className="text-xs text-gray-500">{l.codigo} · {l.unidad}</span></td>
                    <td className="py-1"><input className={CLASE_INPUT} type="number" min={1} step={1} value={l.cantidad} onChange={(e) => cambiar(i, 'cantidad', e.target.value)} required aria-label={`Cantidad de ${l.nombre}`} /></td>
                    <td className="py-1"><input className={CLASE_INPUT} type="number" min={0} step="0.01" value={l.costo} onChange={(e) => cambiar(i, 'costo', e.target.value)} required aria-label={`Costo de ${l.nombre}`} /></td>
                    <td className="py-1 text-right">{((Number(l.cantidad) || 0) * (Number(l.costo) || 0)).toFixed(2)}</td>
                    <td className="py-1 text-right"><button type="button" className="text-xs font-semibold text-red-700 hover:underline" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>Quitar</button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr><td colSpan={3} className="py-2 text-right font-semibold">Total</td><td className="py-2 text-right font-semibold">{total.toFixed(2)}</td><td /></tr></tfoot>
            </table>
          </div>
        )}
        <Campo etiqueta="Nota (opcional)"><input className={CLASE_INPUT} value={notas} onChange={(e) => setNotas(e.target.value)} maxLength={300} /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" disabled={lineas.length === 0}>Registrar compra</Button></div>
      </form>
    </Modal>
  );
}

interface DetalleCompra extends Omit<FilaCompra, 'lineas'> { registrada_por: string | null; notas: string | null; lineas: Array<{ id: number; codigo: string; nombre: string; cantidad: number; costo_unitario: number; subtotal: number }> }

function VerCompra({ id, alCerrar }: { id: number; alCerrar: () => void }) {
  const { api, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const c = useLista(() => api.get<DetalleCompra>(`/compras/${id}`), [api, id]);
  const d = c.datos;
  return (
    <Modal onClose={alCerrar} title={d ? `Compra ${d.numero}` : 'Compra'} size="lg">
      <Aviso mensaje={c.error} tipo="error" />
      {!d ? <p className="text-sm text-gray-500">Cargando…</p> : (
        <div className="space-y-3 text-sm">
          <p className="text-gray-700">{d.proveedor} · {d.bodega} · {formatFecha(d.fecha_documento)}{d.numero_factura ? ` · factura ${d.numero_factura}` : ''}{d.registrada_por ? ` · registró ${d.registrada_por}` : ''}</p>
          <Tabla columnas={[
            { clave: 'material', etiqueta: 'Material', valor: (l: DetalleCompra['lineas'][number]) => l.nombre, render: (l) => <span>{l.nombre} <span className="text-xs text-gray-500">{l.codigo}</span></span> },
            { clave: 'cantidad', etiqueta: 'Cantidad', valor: (l) => l.cantidad, alinear: 'right' },
            { clave: 'costo', etiqueta: 'Costo unitario', valor: (l) => l.costo_unitario, render: (l) => dineroDe(moneda, l.costo_unitario), alinear: 'right' },
            { clave: 'sub', etiqueta: 'Subtotal', valor: (l) => l.subtotal, render: (l) => dineroDe(moneda, l.subtotal), alinear: 'right' },
          ]} filas={d.lineas} clave={(l) => l.id} vacio="Sin líneas." />
          <p className="text-right font-semibold">Total: {dineroDe(moneda, d.total)}</p>
          {d.notas && <p className="text-gray-700">{d.notas}</p>}
        </div>
      )}
    </Modal>
  );
}

function Compras({ opciones }: { opciones: OpcionesInventario }) {
  const { api, tiene, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const [buscar, setBuscar] = useState('');
  const [pagina, setPagina] = useState(1);
  const [nueva, setNueva] = useState(false);
  const [ver, setVer] = useState<number | null>(null);
  const [mensaje, setMensaje] = useState('');
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: FilaCompra[] }>(`/compras?pagina=${pagina}${buscar.trim() ? `&buscar=${encodeURIComponent(buscar.trim())}` : ''}`), [api, pagina, buscar]);
  useEffect(() => setPagina(1), [buscar]);
  const columnas: Array<Columna<FilaCompra>> = [
    { clave: 'numero', etiqueta: 'Compra', valor: (c) => c.numero },
    { clave: 'fecha', etiqueta: 'Fecha', valor: (c) => c.fecha_documento, render: (c) => formatFecha(c.fecha_documento) },
    { clave: 'proveedor', etiqueta: 'Proveedor', valor: (c) => c.proveedor },
    { clave: 'factura', etiqueta: 'Factura', valor: (c) => c.numero_factura ?? '', render: (c) => c.numero_factura ?? '—' },
    { clave: 'bodega', etiqueta: 'Bodega', valor: (c) => c.bodega },
    { clave: 'lineas', etiqueta: 'Líneas', valor: (c) => c.lineas, alinear: 'right' },
    { clave: 'total', etiqueta: 'Total', valor: (c) => c.total, render: (c) => dineroDe(moneda, c.total), alinear: 'right' },
    { clave: 'acc', etiqueta: 'Acciones', render: (c) => <Acciones><BotonAccion onClick={() => setVer(c.id)}>Ver</BotonAccion></Acciones> },
  ];
  return (
    <Seccion titulo="Compras" acciones={tiene('inventario.recibir') && <Button onClick={() => setNueva(true)}>Registrar compra</Button>}>
      <p className="text-sm text-gray-700">Cada compra suma sus cantidades a la bodega que recibe y actualiza el costo promedio del material.</p>
      <input value={buscar} onChange={(e) => setBuscar(e.target.value)} placeholder="Buscar por número, factura o proveedor" aria-label="Buscar compra" className="w-full max-w-md rounded-md border border-gray-300 px-3 py-2 text-sm" />
      <Aviso mensaje={lista.error} tipo="error" />
      <Aviso mensaje={mensaje} tipo="ok" />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(c) => c.id} vacio={lista.datos ? 'Todavía no hay compras registradas.' : 'Cargando…'} />
      {lista.datos && <Paginador total={lista.datos.total} porPagina={lista.datos.porPagina} pagina={pagina} alCambiar={setPagina} cosa="compras" />}
      {nueva && <NuevaCompra opciones={opciones} alCerrar={() => setNueva(false)} alListo={() => { setNueva(false); setMensaje('La compra quedó registrada y las existencias se actualizaron.'); lista.recargar(); }} />}
      {ver && <VerCompra id={ver} alCerrar={() => setVer(null)} />}
    </Seccion>
  );
}

// ── Movimientos ───────────────────────────────────────────────────────────────────────
const TIPOS_MOVIMIENTO = [
  ['compra', 'Compras'],
  ['despacho', 'Despachos'],
  ['devolucion', 'Devoluciones'],
  ['traslado_salida', 'Traslados (salida)'],
  ['traslado_entrada', 'Traslados (entrada)'],
  ['diferencia', 'Diferencias'],
] as const;

function Movimientos({ opciones }: { opciones: OpcionesInventario }) {
  const { api, tiene, perfil } = useSesionTaller();
  const moneda = perfil?.empresa.moneda ?? 'GTQ';
  const [tipo, setTipo] = useState('');
  const [bodega, setBodega] = useState('');
  const [pagina, setPagina] = useState(1);
  const q = new URLSearchParams({ pagina: String(pagina), ...(tipo ? { tipo } : {}), ...(bodega ? { bodega_id: bodega } : {}) });
  const lista = useLista(() => api.get<{ total: number; porPagina: number; registros: Movimiento[] }>(`/inventario/movimientos?${q.toString()}`), [api, pagina, tipo, bodega]);
  useEffect(() => setPagina(1), [tipo, bodega]);
  const verCostos = tiene('inventario.ver_costos');
  const columnas: Array<Columna<Movimiento>> = [
    { clave: 'fecha', etiqueta: 'Fecha', valor: (x) => x.fecha, render: (x) => fechaHoraLocal(x.fecha) },
    { clave: 'material', etiqueta: 'Material', valor: (x) => x.material, render: (x) => <span>{x.material} <span className="text-xs text-gray-500">{x.codigo}</span></span> },
    { clave: 'tipo', etiqueta: 'Movimiento', valor: (x) => x.tipo, render: (x) => <span>{x.tipo}{x.motivo ? <span className="block text-xs text-gray-500">{x.motivo}</span> : null}</span> },
    { clave: 'bodega', etiqueta: 'Bodega', valor: (x) => x.bodega },
    { clave: 'cantidad', etiqueta: 'Cantidad', valor: (x) => x.cantidad, render: (x) => <span className={x.cantidad < 0 ? 'text-red-700' : 'text-green-700'}>{x.cantidad > 0 ? '+' : ''}{x.cantidad}</span>, alinear: 'right' },
    { clave: 'saldo', etiqueta: 'Saldo', valor: (x) => x.saldo_resultante, alinear: 'right' },
    ...(verCostos ? [{ clave: 'costo', etiqueta: 'Costo unitario', valor: (x: Movimiento) => x.costo_unitario ?? 0, render: (x: Movimiento) => (x.costo_unitario != null ? dineroDe(moneda, x.costo_unitario) : '—'), alinear: 'right' as const }] : []),
    { clave: 'usuario', etiqueta: 'Quién', valor: (x) => x.usuario ?? '', render: (x) => x.usuario ?? '—' },
  ];
  return (
    <Seccion titulo="Movimientos de inventario">
      <p className="text-sm text-gray-700">Aquí queda el registro de todo lo que entra, sale o se corrige. Las cantidades solo cambian por un movimiento; no se pueden editar a mano.</p>
      <div className="flex flex-wrap gap-3">
        <select value={tipo} onChange={(e) => setTipo(e.target.value)} aria-label="Tipo de movimiento" className="rounded-md border border-gray-300 px-3 py-2 text-sm"><option value="">Todos los movimientos</option>{TIPOS_MOVIMIENTO.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
        <select value={bodega} onChange={(e) => setBodega(e.target.value)} aria-label="Bodega" className="rounded-md border border-gray-300 px-3 py-2 text-sm"><option value="">Todas las bodegas</option>{opciones.bodegas.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</select>
      </div>
      <Aviso mensaje={lista.error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos?.registros ?? []} clave={(x) => x.id} vacio={lista.datos ? 'No hay movimientos con esos filtros.' : 'Cargando…'} />
      {lista.datos && <Paginador total={lista.datos.total} porPagina={lista.datos.porPagina} pagina={pagina} alCambiar={setPagina} cosa="movimientos" />}
    </Seccion>
  );
}

// ── Márgenes ──────────────────────────────────────────────────────────────────────────
interface FilaMargen { nivel: 'sistema' | 'subsistema' | 'parte' | 'material'; referencia_id: number; porcentaje: number; nombre: string }
const NIVELES: Record<FilaMargen['nivel'], string> = { sistema: 'Sistema', subsistema: 'Subsistema', parte: 'Parte', material: 'Material' };

function NuevoMargen({ opciones, alCerrar, alListo }: { opciones: OpcionesInventario; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [nivel, setNivel] = useState<FilaMargen['nivel']>('sistema');
  const [referencia, setReferencia] = useState('');
  const [porcentaje, setPorcentaje] = useState('');
  const [texto, setTexto] = useState('');
  const [materiales, setMateriales] = useState<FilaMaterial[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (nivel !== 'material' || texto.trim().length < 2) return setMateriales([]);
    const espera = setTimeout(() => api.get<{ registros: FilaMaterial[] }>(`/materiales?buscar=${encodeURIComponent(texto.trim())}`).then((r) => setMateriales(r.registros.slice(0, 8))).catch(() => setMateriales([])), 250);
    return () => clearTimeout(espera);
  }, [api, nivel, texto]);
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.put(`/margenes/${nivel}/${referencia}`, { porcentaje: Number(porcentaje) });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo guardar el margen'));
    }
  };
  return (
    <Modal onClose={alCerrar} title="Definir margen de ganancia" size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <Campo etiqueta="¿Para qué?" ayuda="Manda el más específico: material, luego parte, subsistema, sistema y al final el margen general.">
          <select className={CLASE_INPUT} value={nivel} onChange={(e) => { setNivel(e.target.value as FilaMargen['nivel']); setReferencia(''); setTexto(''); }}>{(Object.keys(NIVELES) as Array<FilaMargen['nivel']>).map((n) => <option key={n} value={n}>{NIVELES[n]}</option>)}</select>
        </Campo>
        {nivel === 'sistema' && <Campo etiqueta="Sistema"><select className={CLASE_INPUT} value={referencia} onChange={(e) => setReferencia(e.target.value)} required><option value="">Elija…</option>{opciones.sistemas.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}</select></Campo>}
        {nivel === 'subsistema' && <Campo etiqueta="Subsistema"><select className={CLASE_INPUT} value={referencia} onChange={(e) => setReferencia(e.target.value)} required><option value="">Elija…</option>{opciones.subsistemas.map((s) => <option key={s.id} value={s.id}>{opciones.sistemas.find((x) => x.id === s.sistema_id)?.nombre} › {s.nombre}</option>)}</select></Campo>}
        {nivel === 'parte' && <Campo etiqueta="Parte"><select className={CLASE_INPUT} value={referencia} onChange={(e) => setReferencia(e.target.value)} required><option value="">Elija…</option>{opciones.partes.map((p) => <option key={p.id} value={p.id}>{p.clasificacion} › {p.nombre}</option>)}</select></Campo>}
        {nivel === 'material' && (
          <Campo etiqueta="Material">
            {referencia ? <div className="flex items-center justify-between rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-sm"><span>{texto}</span><button type="button" className="text-xs font-semibold text-primary hover:underline" onClick={() => { setReferencia(''); setTexto(''); }}>Cambiar</button></div> : (
              <div className="relative">
                <input className={CLASE_INPUT} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Escriba el código o el nombre" data-no-uppercase="true" autoComplete="off" />
                {materiales.length > 0 && <ul className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">{materiales.map((m) => <li key={m.id}><button type="button" className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-100" onClick={() => { setReferencia(String(m.id)); setTexto(`${m.codigo} ${m.nombre}`); setMateriales([]); }}>{m.nombre} <span className="text-xs text-gray-500">{m.codigo}</span></button></li>)}</ul>}
              </div>
            )}
          </Campo>
        )}
        <Campo etiqueta="Margen (%)"><input className={`${CLASE_INPUT} max-w-xs`} type="number" min={0} max={1000} step="0.01" value={porcentaje} onChange={(e) => setPorcentaje(e.target.value)} required /></Campo>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" disabled={!referencia}>Guardar</Button></div>
      </form>
    </Modal>
  );
}

function Margenes({ opciones }: { opciones: OpcionesInventario }) {
  const { api } = useSesionTaller();
  const lista = useLista(() => api.get<FilaMargen[]>('/margenes'), [api]);
  const [nuevo, setNuevo] = useState(false);
  const [error, setError] = useState('');
  const quitar = async (m: FilaMargen): Promise<void> => {
    setError('');
    try {
      await api.delete(`/margenes/${m.nivel}/${m.referencia_id}`);
      lista.recargar();
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo quitar el margen'));
    }
  };
  const columnas: Array<Columna<FilaMargen>> = [
    { clave: 'nivel', etiqueta: 'Nivel', valor: (m) => m.nivel, render: (m) => NIVELES[m.nivel] },
    { clave: 'nombre', etiqueta: 'Qué', valor: (m) => m.nombre },
    { clave: 'porcentaje', etiqueta: 'Margen', valor: (m) => m.porcentaje, render: (m) => `${m.porcentaje} %`, alinear: 'right' },
    { clave: 'acc', etiqueta: 'Acciones', render: (m) => <Acciones><BotonAccion onClick={() => void quitar(m)}>Quitar</BotonAccion></Acciones> },
  ];
  return (
    <Seccion titulo="Márgenes de ganancia" acciones={<Button onClick={() => setNuevo(true)}>Definir margen</Button>}>
      <p className="text-sm text-gray-700">El precio de un material es su costo más el margen. Si no hay un margen específico, se usa el margen general (Configuración → General). Un precio fijo en el material manda sobre todo.</p>
      <Aviso mensaje={error || lista.error} tipo="error" />
      <Tabla columnas={columnas} filas={lista.datos ?? []} clave={(m) => `${m.nivel}-${m.referencia_id}`} vacio={lista.datos ? 'No hay márgenes específicos: todo usa el margen general.' : 'Cargando…'} />
      {nuevo && <NuevoMargen opciones={opciones} alCerrar={() => setNuevo(false)} alListo={() => { setNuevo(false); lista.recargar(); }} />}
    </Seccion>
  );
}

// ── La pantalla ───────────────────────────────────────────────────────────────────────
export default function Inventario() {
  const { api, tiene } = useSesionTaller();
  const [params, setParams] = useSearchParams();
  const opciones = useLista(() => api.get<OpcionesInventario>('/inventario-opciones'), [api]);
  const pestanas = [
    { k: 'materiales', t: 'Materiales', permiso: 'inventario.ver' },
    { k: 'compras', t: 'Compras', permiso: 'inventario.ver' },
    { k: 'movimientos', t: 'Movimientos', permiso: 'inventario.ver' },
    { k: 'margenes', t: 'Márgenes', permiso: 'inventario.ver_costos' },
  ].filter((p) => tiene(p.permiso));
  const actual = pestanas.find((p) => p.k === params.get('tab')) ?? pestanas[0];
  const o = opciones.datos;
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Inventario</h1>
      <div className="flex flex-wrap gap-2">
        {pestanas.map((p) => <button key={p.k} onClick={() => setParams({ tab: p.k }, { replace: true })} className={`rounded-md border border-gray-200 px-4 py-2 text-sm font-medium ${actual?.k === p.k ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{p.t}</button>)}
      </div>
      <Aviso mensaje={opciones.error} tipo="error" />
      {!o ? <p className="text-sm text-gray-500">Cargando…</p> : (
        <>
          {actual?.k === 'materiales' && <Materiales opciones={o} />}
          {actual?.k === 'compras' && <Compras opciones={o} />}
          {actual?.k === 'movimientos' && <Movimientos opciones={o} />}
          {actual?.k === 'margenes' && <Margenes opciones={o} />}
        </>
      )}
    </div>
  );
}
