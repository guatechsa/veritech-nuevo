// UNA sola forma de botón de acción de fila/tarjeta en todos los productos GUATECH (estándar GUATECH_STANDARDS §20):
// la palabra escrita en el centro, texto azul (#4997D0, con valor fijo para no depender de la paleta de cada producto), borde azul, mismo tamaño. Editar y Eliminar nunca llevan íconos ni otros colores.
// `as` permite usar el mismo aspecto sobre un enlace del router: <BotonEditar as={Link} to="/ruta" />.
const CLASE = 'inline-flex items-center justify-center min-w-[5.5rem] px-3 py-1 rounded-md border border-[#4997D0] bg-white text-sm font-medium text-[#4997D0] whitespace-nowrap no-underline hover:bg-[#4997D0]/10 focus:outline-none focus:ring-2 focus:ring-[#4997D0]/40 disabled:opacity-50 disabled:cursor-not-allowed';

export function BotonAccion({ children, className = '', type = 'button', as: Etiqueta = 'button', ...resto }) {
  const propios = Etiqueta === 'button' ? { type } : {};
  return <Etiqueta className={`${CLASE} ${className}`.trim()} {...propios} {...resto}>{children}</Etiqueta>;
}

export const BotonEditar = ({ children = 'Editar', ...p }) => <BotonAccion {...p}>{children}</BotonAccion>;
export const BotonEliminar = ({ children = 'Eliminar', ...p }) => <BotonAccion {...p}>{children}</BotonAccion>;

// Contenedor de las acciones de una fila.
export const Acciones = ({ children }) => <span className="flex flex-wrap gap-2 justify-end">{children}</span>;
