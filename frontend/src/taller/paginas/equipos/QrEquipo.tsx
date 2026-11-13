import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import Button from '../../../components/ui-guatech/Button.jsx';
import Modal from '../../../components/ui-guatech/Modal.jsx';
import { Aviso, mensajeDe } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

interface Qr {
  codigo: string;
  url: string;
  etiqueta: string;
}

/** El código QR del equipo: se imprime y se pega en el equipo; quien lo escanea ve su ficha y su historial (sin costos). */
export function QrEquipo({ equipoId, alCerrar }: { equipoId: number; alCerrar: () => void }) {
  const { api, tiene } = useSesionTaller();
  const [qr, setQr] = useState<Qr | null>(null);
  const [imagen, setImagen] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api.get<Qr>(`/equipos/${equipoId}/qr`).then(setQr).catch((e: unknown) => setError(mensajeDe(e, 'No se pudo cargar el código')));
  }, [api, equipoId]);
  useEffect(() => {
    if (!qr) return;
    QRCode.toDataURL(qr.url, { errorCorrectionLevel: 'M', margin: 2, width: 360 }).then(setImagen).catch(() => setError('No se pudo dibujar el código QR'));
  }, [qr]);
  const cambiar = async (): Promise<void> => {
    if (!window.confirm('¿Cambiar el código? El QR que ya está pegado en el equipo dejará de servir y habrá que imprimir uno nuevo.')) return;
    setError('');
    try {
      setQr(await api.post<Qr>(`/equipos/${equipoId}/qr/regenerar`));
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo cambiar el código'));
    }
  };
  const imprimir = (): void => {
    if (!qr || !imagen) return;
    const w = window.open('', '_blank', 'width=480,height=640');
    if (!w) return;
    const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    w.document.write(`<!doctype html><title>QR ${esc(qr.etiqueta)}</title><style>body{font-family:Arial,sans-serif;text-align:center;margin:24px}img{width:260px;height:260px}h1{font-size:20px;margin:8px 0}p{font-size:12px;color:#444}@page{margin:12mm}</style><h1>${esc(qr.etiqueta || 'Equipo')}</h1><img src="${imagen}" alt="Código QR"><p>Escanee para ver el historial de este equipo</p><script>window.onload=function(){window.print()}</script>`);
    w.document.close();
  };
  return (
    <Modal onClose={alCerrar} title="Código QR del equipo" size="sm">
      <div className="space-y-3 text-center">
        <Aviso mensaje={error} tipo="error" />
        {qr && <p className="text-sm font-semibold text-gray-900">{qr.etiqueta || 'Equipo'}</p>}
        {imagen ? <img src={imagen} alt="Código QR del equipo" className="mx-auto h-60 w-60" /> : !error && <p className="text-sm text-gray-500">Preparando…</p>}
        <p className="text-xs text-gray-600">Quien lo escanea ve la ficha del equipo y lo que se le ha hecho. No ve costos ni datos internos del taller.</p>
        {qr && <p className="break-all text-xs text-gray-400">{qr.url}</p>}
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={imprimir} disabled={!imagen}>Imprimir</Button>
          {tiene('equipos.editar') && <Button variant="outline" onClick={() => void cambiar()}>Cambiar el código</Button>}
        </div>
      </div>
    </Modal>
  );
}
