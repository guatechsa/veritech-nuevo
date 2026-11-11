import { createPortal } from 'react-dom';

// ─────────────────────────────────────────────────────────────────────────────
// KIT DE INTERFAZ GUATECH — archivo compartido.
// Fuente de verdad: C:\GUATECH\GUATECH\ui-kit\Modal.jsx
// Se copia a cada producto con `bash C:/GUATECH/sync-ui-kit.sh`. NO editar la
// copia dentro de un producto: el siguiente sync la sobreescribe y la
// divergencia entre copias es justo lo que dejó vivo el bug del formateador de
// mayúsculas durante meses en 8 productos.
//
// Patrón tomado de VERI-TECH (GUATECH_STANDARDS.md: VERI-TECH es la referencia).
// El overlay usa `bg-gray-500/75` en vez de `bg-gray-500 bg-opacity-75` porque
// esa sintaxis funciona igual en Tailwind v3 y v4, y tres productos (QUALI-TECH,
// SAFE-TECH, CAR-TECH) están en v4, donde `bg-opacity-*` quedó obsoleto.
// ─────────────────────────────────────────────────────────────────────────────

const ANCHOS = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
  '2xl': 'max-w-6xl',
};

export default function Modal({
  isOpen = true,
  onClose,
  title,
  children,
  size = 'md',
  // Pie opcional: si no se pasa, el modal solo muestra su contenido.
  footer = null,
}) {
  if (!isOpen) return null;

  // Portal a document.body: sin esto, un modal abierto desde dentro de un <form>
  // queda como <form> anidado en el DOM real — HTML inválido que hace que el
  // submit del modal interno dispare también el form externo (bug real de
  // VERI-TECH, 2026-07-28; no era solo el warning de validateDOMNesting).
  return createPortal(
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-screen items-center justify-center px-4 pt-4 pb-20 text-center sm:block sm:p-0">
        <div
          className="fixed inset-0 bg-gray-500/75 transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />

        <div
          role="dialog"
          aria-modal="true"
          className={`inline-block w-full transform overflow-hidden rounded-lg bg-white text-left align-bottom shadow-xl transition-all sm:my-8 sm:align-middle ${ANCHOS[size] || ANCHOS.md}`}
        >
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            {(title || onClose) && (
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-medium leading-6 text-gray-900">{title}</h3>
                {onClose && (
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Cerrar"
                    className="text-gray-400 hover:text-gray-500 focus:outline-none"
                  >
                    {/* SVG inline: no todos los productos traen lucide-react. */}
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
                      strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
                      <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                  </button>
                )}
              </div>
            )}
            <div className="mt-2">{children}</div>
          </div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-gray-200 bg-gray-50 px-4 py-3 sm:px-6">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
