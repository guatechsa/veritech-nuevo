import { useEffect, useRef, useState } from 'react';
import Button from '../../../components/ui-guatech/Button.jsx';

/** Lienzo para firmar con el dedo o el ratón. Entrega la firma como imagen PNG (data URL) cuando la persona pulsa «Usar esta firma». */
export function FirmaPad({ alFirmar }: { alFirmar: (png: string) => void }) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const dibujando = useRef(false);
  const [vacio, setVacio] = useState(true);

  useEffect(() => {
    const c = lienzo.current;
    const g = c?.getContext('2d');
    if (!c || !g) return;
    g.lineWidth = 2.5;
    g.lineCap = 'round';
    g.strokeStyle = '#111827';
  }, []);

  const punto = (e: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const c = lienzo.current as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  };
  const empezar = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const g = lienzo.current?.getContext('2d');
    if (!g) return;
    lienzo.current?.setPointerCapture(e.pointerId);
    dibujando.current = true;
    const p = punto(e);
    g.beginPath();
    g.moveTo(p.x, p.y);
    g.lineTo(p.x + 0.1, p.y + 0.1);
    g.stroke();
    setVacio(false);
  };
  const mover = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!dibujando.current) return;
    const g = lienzo.current?.getContext('2d');
    if (!g) return;
    const p = punto(e);
    g.lineTo(p.x, p.y);
    g.stroke();
  };
  const terminar = (): void => {
    dibujando.current = false;
  };
  const limpiar = (): void => {
    const c = lienzo.current;
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height);
    setVacio(true);
  };

  return (
    <div className="space-y-2">
      <canvas
        ref={lienzo}
        width={600}
        height={200}
        onPointerDown={empezar}
        onPointerMove={mover}
        onPointerUp={terminar}
        onPointerLeave={terminar}
        className="w-full touch-none rounded-md border border-dashed border-gray-400 bg-white"
        aria-label="Espacio para la firma"
      />
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={limpiar}>Borrar</Button>
        <Button size="sm" disabled={vacio} onClick={() => lienzo.current && alFirmar(lienzo.current.toDataURL('image/png'))}>Usar esta firma</Button>
      </div>
    </div>
  );
}
