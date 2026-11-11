import { FormEvent, useRef, useState } from 'react';
import { Acciones, BotonAccion } from '../../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import FechaInput from '../../../components/ui-guatech/FechaInput';
import { formatFecha } from '../../../components/ui-guatech/formatoFecha.js';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { prepararArchivo } from '../../componentes/imagen';
import { Aviso, Campo, CLASE_INPUT, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { DetalleEquipo } from './tipos';

// ── Fotos ────────────────────────────────────────────────────────────────────────────
export function FotosEquipo({ equipo, alCambiar }: { equipo: DetalleEquipo; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const entrada = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [subiendo, setSubiendo] = useState(false);
  const puede = tiene('equipos.editar') && equipo.estado !== 'baja';

  const subir = async (archivos: FileList | null): Promise<void> => {
    if (!archivos || archivos.length === 0) return;
    setError('');
    setSubiendo(true);
    try {
      for (const a of Array.from(archivos)) {
        const listo = await prepararArchivo(a, { soloImagen: true });
        await api.subir(`/equipos/${equipo.id}/fotos`, listo.blob, listo.nombre);
      }
      alCambiar();
    } catch (err) {
      setError(err instanceof Error ? mensajeDe(err, err.message) : 'No se pudo subir la foto');
    } finally {
      setSubiendo(false);
      if (entrada.current) entrada.current.value = '';
    }
  };
  const accion = async (llamada: () => Promise<unknown>): Promise<void> => {
    try {
      await llamada();
      setError('');
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo completar'));
    }
  };
  return (
    <Seccion
      titulo="Fotos"
      acciones={
        puede && (
          <>
            <input ref={entrada} type="file" accept="image/*" multiple className="hidden" onChange={(e) => void subir(e.target.files)} />
            <Button size="sm" disabled={subiendo} onClick={() => entrada.current?.click()}>{subiendo ? 'Subiendo…' : 'Agregar fotos'}</Button>
          </>
        )
      }
    >
      <Aviso mensaje={error} tipo="error" />
      {equipo.fotos.length === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">Todavía no hay fotos de este equipo.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {equipo.fotos.map((fo) => (
            <figure key={fo.id} className="overflow-hidden rounded-lg border border-gray-200 bg-white">
              <a href={fo.url} target="_blank" rel="noopener noreferrer"><img src={fo.url} alt={fo.descripcion ?? 'Foto del equipo'} loading="lazy" className="h-44 w-full object-cover" /></a>
              <figcaption className="flex items-center justify-between gap-2 p-2 text-xs">
                <span>{fo.es_principal ? <Badge variant="info">Principal</Badge> : <span className="text-gray-500">{fo.descripcion ?? ''}</span>}</span>
                {puede && (
                  <Acciones>
                    {!fo.es_principal && <BotonAccion onClick={() => void accion(() => api.post(`/equipos/${equipo.id}/fotos/${fo.id}/principal`))}>Hacer principal</BotonAccion>}
                    <BotonAccion onClick={() => { if (window.confirm('¿Quitar esta foto? No se puede recuperar.')) void accion(() => api.delete(`/equipos/${equipo.id}/fotos/${fo.id}`)); }}>Quitar</BotonAccion>
                  </Acciones>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <p className="text-xs text-gray-500">Las fotos se reducen automáticamente antes de subirse. Se aceptan JPG, PNG y WEBP.</p>
    </Seccion>
  );
}

// ── Documentos ───────────────────────────────────────────────────────────────────────
const ESTADO_DOC = {
  vigente: { texto: 'Vigente', variante: 'success' as const },
  por_vencer: { texto: 'Por vencer', variante: 'warning' as const },
  vencido: { texto: 'Vencido', variante: 'danger' as const },
  sin_vencimiento: { texto: 'Sin vencimiento', variante: 'default' as const },
};

export function DocumentosEquipo({ equipo, alCambiar }: { equipo: DetalleEquipo; alCambiar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const tipos = useLista(() => api.get<Array<{ id: number; nombre: string; requiere_vencimiento: number; activo: number }>>('/tipos-documento'), [api]);
  const [tipo, setTipo] = useState('');
  const [nombre, setNombre] = useState('');
  const [vence, setVence] = useState('');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [entrada, setEntrada] = useState(0);
  const [error, setError] = useState('');
  const puede = tiene('equipos.editar') && equipo.estado !== 'baja';
  const elegido = (tipos.datos ?? []).find((t) => String(t.id) === tipo);

  const agregar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      if (archivo) {
        const listo = await prepararArchivo(archivo);
        const q = new URLSearchParams({ tipo_documento_id: tipo, ...(nombre.trim() ? { nombre: nombre.trim() } : {}), ...(vence ? { vence } : {}) });
        await api.subir(`/equipos/${equipo.id}/documentos?${q.toString()}`, listo.blob, listo.nombre);
      } else {
        await api.post(`/equipos/${equipo.id}/documentos`, { tipo_documento_id: Number(tipo), nombre: nombre.trim() || null, vence: vence || null });
      }
      setTipo('');
      setNombre('');
      setVence('');
      setArchivo(null);
      setEntrada((n) => n + 1);
      alCambiar();
    } catch (err) {
      setError(err instanceof Error ? mensajeDe(err, err.message) : 'No se pudo guardar');
    }
  };
  const quitar = async (id: number): Promise<void> => {
    if (!window.confirm('¿Quitar este documento de la ficha?')) return;
    try {
      await api.delete(`/equipos/${equipo.id}/documentos/${id}`);
      alCambiar();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo quitar'));
    }
  };
  const columnas: Array<Columna<DetalleEquipo['documentos'][number]>> = [
    { clave: 'tipo', etiqueta: 'Documento', valor: (d) => d.tipo, render: (d) => <span><span className="block font-medium text-gray-900">{d.tipo}</span>{d.nombre && <span className="block text-xs text-gray-500">{d.nombre}</span>}</span> },
    { clave: 'vence', etiqueta: 'Vence', valor: (d) => d.vence ?? '', render: (d) => (d.vence ? (formatFecha(d.vence) as string) : '—') },
    { clave: 'estado', etiqueta: 'Estado', valor: (d) => d.estado, render: (d) => <Badge variant={ESTADO_DOC[d.estado].variante}>{ESTADO_DOC[d.estado].texto}</Badge> },
    { clave: 'acc', etiqueta: 'Acciones', render: (d) => <Acciones>{d.url && <BotonAccion onClick={() => window.open(d.url as string, '_blank', 'noopener')}>Ver archivo</BotonAccion>}{puede && <BotonAccion onClick={() => void quitar(d.id)}>Quitar</BotonAccion>}</Acciones> },
  ];
  return (
    <Seccion titulo="Documentos">
      {equipo.documentos_faltantes.length > 0 && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Falta o está vencido: {equipo.documentos_faltantes.map((x) => `${x.nombre}${x.obligatorio ? ' (obligatorio)' : ''}`).join(', ')}.
        </p>
      )}
      <Aviso mensaje={error} tipo="error" />
      <Tabla columnas={columnas} filas={equipo.documentos} clave={(d) => d.id} vacio="Este equipo no tiene documentos." />
      {puede && (
        <form onSubmit={agregar} className="space-y-3 rounded-lg border border-gray-200 bg-white p-3">
          <h3 className="text-sm font-bold text-gray-900">Agregar documento</h3>
          <p className="text-xs text-gray-500">Un documento nuevo del mismo tipo reemplaza al anterior (el anterior queda en el historial).</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <Campo etiqueta="Tipo de documento"><select className={CLASE_INPUT} value={tipo} onChange={(e) => setTipo(e.target.value)} required><option value="">Elija…</option>{(tipos.datos ?? []).filter((t) => t.activo === 1).map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}</select></Campo>
            <Campo etiqueta={elegido?.requiere_vencimiento ? 'Vence (obligatorio)' : 'Vence (opcional)'}><FechaInput value={vence} onChange={(e) => setVence(e.target.value)} className={CLASE_INPUT} required={!!elegido?.requiere_vencimiento} /></Campo>
            <Campo etiqueta="Referencia (opcional)" ayuda="Por ejemplo, número de póliza."><input className={CLASE_INPUT} value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={150} /></Campo>
          </div>
          <Campo etiqueta="Archivo (foto o PDF, opcional)"><input key={entrada} type="file" accept="image/*,application/pdf" onChange={(e) => setArchivo(e.target.files?.[0] ?? null)} className="block w-full text-sm" /></Campo>
          <div className="flex justify-end"><Button type="submit">Agregar</Button></div>
        </form>
      )}
    </Seccion>
  );
}
