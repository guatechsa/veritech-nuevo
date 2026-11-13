import { FormEvent, useEffect, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { Aviso, Campo, CLASE_INPUT, mensajeDe } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';
import { ServiciosEquipo } from '../servicios/ServiciosEquipo';
import { ContadoresEquipo } from './ContadoresEquipo';
import { DatosEquipo } from './DatosEquipo';
import { QrEquipo } from './QrEquipo';
import { DocumentosEquipo, FotosEquipo } from './FotosYDocumentos';
import { NotasEquipo, PersonasEquipo } from './PersonasYNotas';
import { AvisoEquipo, DetalleEquipo, ESTADO_EQUIPO } from './tipos';

type Pestana = 'datos' | 'contadores' | 'servicios' | 'fotos' | 'documentos' | 'notas' | 'personas';

function CambiarEstado({ equipo, nuevo, alCerrar, alListo }: { equipo: DetalleEquipo; nuevo: 'activo' | 'fuera_de_servicio' | 'baja'; alCerrar: () => void; alListo: () => void }) {
  const { api } = useSesionTaller();
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const titulo = nuevo === 'baja' ? 'Dar de baja el equipo' : nuevo === 'fuera_de_servicio' ? 'Poner fuera de servicio' : 'Reactivar el equipo';
  const enviar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await api.post(`/equipos/${equipo.id}/estado`, { estado: nuevo, motivo: motivo.trim() || null });
      alListo();
    } catch (err) {
      setError(mensajeDe(err, 'No se pudo cambiar el estado'));
    }
  };
  return (
    <Modal onClose={alCerrar} title={titulo} size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">
          {nuevo === 'baja' ? 'La baja no borra nada: el equipo y su historia se conservan, pero deja de ofrecerse para nuevos trabajos. Se pueden reactivar después.' : nuevo === 'fuera_de_servicio' ? 'El equipo sigue en la lista pero queda marcado como fuera de servicio.' : 'El equipo vuelve a estar disponible.'}
        </p>
        {nuevo !== 'activo' && <Campo etiqueta={nuevo === 'baja' ? 'Motivo de la baja (obligatorio)' : 'Motivo (opcional)'}><input className={CLASE_INPUT} value={motivo} onChange={(e) => setMotivo(e.target.value)} required={nuevo === 'baja'} minLength={nuevo === 'baja' ? 3 : undefined} maxLength={300} autoFocus /></Campo>}
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit" variant={nuevo === 'baja' ? 'danger' : 'primary'}>Confirmar</Button></div>
      </form>
    </Modal>
  );
}

/** Ficha del equipo: lo que es, su uso (contadores), fotos, documentos, notas y quién lo maneja. */
export function FichaEquipo({ inicial, alCerrar, alCambiar, clienteInicial, pestanaInicial }: { inicial: number | 'nuevo'; alCerrar: () => void; alCambiar: () => void; clienteInicial?: { id: number; nombre: string } | null; pestanaInicial?: Pestana }) {
  const { api, tiene } = useSesionTaller();
  const [id, setId] = useState<number | 'nuevo'>(inicial);
  const [detalle, setDetalle] = useState<DetalleEquipo | null>(null);
  const [pestana, setPestana] = useState<Pestana>(pestanaInicial ?? 'datos');
  const [avisos, setAvisos] = useState<AvisoEquipo[]>([]);
  const [error, setError] = useState('');
  const [cambiando, setCambiando] = useState<'activo' | 'fuera_de_servicio' | 'baja' | null>(null);
  const [verQr, setVerQr] = useState(false);

  const cargar = (n: number): void => {
    api.get<DetalleEquipo>(`/equipos/${n}`).then((d) => { setDetalle(d); setError(''); }).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar el equipo')));
  };
  useEffect(() => {
    if (id !== 'nuevo') cargar(id);
    else setDetalle(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const refrescar = (): void => {
    if (id !== 'nuevo') cargar(id);
    alCambiar();
  };

  const pestanas: Array<{ k: Pestana; t: string; visible: boolean }> = [
    { k: 'datos', t: 'Datos', visible: true },
    { k: 'contadores', t: 'Contadores', visible: id !== 'nuevo' && tiene('contadores.ver') },
    { k: 'servicios', t: 'Servicios', visible: id !== 'nuevo' && tiene('servicios.ver') },
    { k: 'fotos', t: 'Fotos', visible: id !== 'nuevo' },
    { k: 'documentos', t: 'Documentos', visible: id !== 'nuevo' },
    { k: 'notas', t: 'Notas', visible: id !== 'nuevo' },
    { k: 'personas', t: 'Operadores y contactos', visible: id !== 'nuevo' },
  ];
  const estado = detalle ? ESTADO_EQUIPO[detalle.estado] : null;
  return (
    <Modal onClose={alCerrar} title={id === 'nuevo' ? 'Nuevo equipo' : detalle ? detalle.descripcion : 'Equipo'} size="2xl">
      <div className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        {detalle && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm text-gray-600">
              {estado && <Badge variant={estado.variante}>{estado.texto}</Badge>}
              <span>{detalle.tipo_equipo}{detalle.cliente ? ` · ${detalle.cliente}` : ' · Del taller'}</span>
              {detalle.documentos_faltantes.length > 0 && <Badge variant="warning">Documentos pendientes</Badge>}
            </span>
            <span className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setVerQr(true)}>Código QR</Button>
            </span>
            {tiene('equipos.desactivar') && (
              <span className="flex gap-2">
                {detalle.estado === 'activo' && <Button size="sm" variant="outline" onClick={() => setCambiando('fuera_de_servicio')}>Fuera de servicio</Button>}
                {detalle.estado !== 'baja' && <Button size="sm" variant="outline" onClick={() => setCambiando('baja')}>Dar de baja</Button>}
                {detalle.estado !== 'activo' && <Button size="sm" onClick={() => setCambiando('activo')}>Reactivar</Button>}
              </span>
            )}
          </div>
        )}
        {avisos.length > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Cuidado, la placa puede estar repetida: ya la tiene {avisos.map((a) => a.equipo.descripcion).join(', ')}. Si es un error, corríjala en «Datos».
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          {pestanas.filter((p) => p.visible).map((p) => (
            <button key={p.k} type="button" onClick={() => setPestana(p.k)} className={`rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium ${pestana === p.k ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'}`}>{p.t}</button>
          ))}
        </div>
        {pestana === 'datos' && (id === 'nuevo' || detalle) && (
          <DatosEquipo
            detalle={id === 'nuevo' ? null : detalle}
            clienteInicial={clienteInicial}
            alGuardar={(n, a) => { alCambiar(); setAvisos(a); if (id === 'nuevo') { setId(n); setPestana(tiene('contadores.ver') ? 'contadores' : 'fotos'); } else cargar(n); }}
          />
        )}
        {detalle && pestana === 'contadores' && <ContadoresEquipo equipo={detalle} alCambiar={refrescar} />}
        {detalle && pestana === 'servicios' && <ServiciosEquipo equipoId={detalle.id} />}
        {detalle && pestana === 'fotos' && <FotosEquipo equipo={detalle} alCambiar={refrescar} />}
        {detalle && pestana === 'documentos' && <DocumentosEquipo equipo={detalle} alCambiar={refrescar} />}
        {detalle && pestana === 'notas' && <NotasEquipo equipo={detalle} alCambiar={refrescar} />}
        {detalle && pestana === 'personas' && <PersonasEquipo equipo={detalle} alCambiar={refrescar} />}
      </div>
      {cambiando && detalle && <CambiarEstado equipo={detalle} nuevo={cambiando} alCerrar={() => setCambiando(null)} alListo={() => { setCambiando(null); refrescar(); }} />}
      {verQr && id !== 'nuevo' && <QrEquipo equipoId={id} alCerrar={() => setVerQr(false)} />}
    </Modal>
  );
}
