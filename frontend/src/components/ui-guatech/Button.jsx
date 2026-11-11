// ─────────────────────────────────────────────────────────────────────────────
// KIT DE INTERFAZ GUATECH — archivo compartido.
// Fuente de verdad: C:\GUATECH\GUATECH\ui-kit\Button.jsx
// Se copia con `bash C:/GUATECH/sync-ui-kit.sh`. NO editar la copia de un producto.
//
// Patrón de VERI-TECH. Usa las clases `primary-*`, que existen en los 9
// productos desde la Fase 1 de la auditoría visual (2026-08-19).
// ─────────────────────────────────────────────────────────────────────────────

const VARIANTES = {
  primary: 'bg-primary-600 hover:bg-primary-700 text-white focus:ring-primary-500',
  secondary: 'bg-gray-200 hover:bg-gray-300 text-gray-900 focus:ring-gray-500',
  danger: 'bg-red-600 hover:bg-red-700 text-white focus:ring-red-500',
  success: 'bg-green-600 hover:bg-green-700 text-white focus:ring-green-500',
  // Botón de acción secundaria con borde, para "Cancelar" y similares.
  outline: 'border border-gray-300 bg-white hover:bg-gray-50 text-gray-700 focus:ring-gray-400',
};

const TAMANOS = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-base',
  lg: 'px-6 py-3 text-lg',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  disabled,
  type = 'button',
  ...props
}) {
  const base =
    'inline-flex items-center justify-center font-medium rounded-md transition-colors ' +
    'focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <button
      type={type}
      className={`${base} ${VARIANTES[variant] || VARIANTES.primary} ${TAMANOS[size] || TAMANOS.md} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}
