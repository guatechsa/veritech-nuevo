// ─────────────────────────────────────────────────────────────────────────────
// KIT DE INTERFAZ GUATECH — archivo compartido.
// Fuente de verdad: C:\GUATECH\GUATECH\ui-kit\Badge.jsx
// Se copia con `bash C:/GUATECH/sync-ui-kit.sh`. NO editar la copia de un producto.
//
// Patrón de VERI-TECH: fondo -100, texto -800, `font-medium`, sin mayúsculas.
// La auditoría del 2026-08-19 encontró 6 variantes distintas entre productos
// (font-bold + uppercase en QUALI/SAFE, texto -700 en PAY-TECH, etc.).
// ─────────────────────────────────────────────────────────────────────────────

const VARIANTES = {
  default: 'bg-gray-100 text-gray-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-yellow-100 text-yellow-800',
  danger: 'bg-red-100 text-red-800',
  info: 'bg-blue-100 text-blue-800',
};

export default function Badge({ children, variant = 'default', className = '' }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
        VARIANTES[variant] || VARIANTES.default
      } ${className}`}
    >
      {children}
    </span>
  );
}

// Atajo para el caso más repetido de GUATECH: Activo / Inactivo.
export function BadgeEstado({ activo, textoActivo = 'Activo', textoInactivo = 'Inactivo' }) {
  return <Badge variant={activo ? 'success' : 'default'}>{activo ? textoActivo : textoInactivo}</Badge>;
}
