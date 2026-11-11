// Tipos del componente del kit (AccionBoton.jsx) para los proyectos TypeScript.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
type Props = ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode };
export function BotonAccion(props: Props): JSX.Element;
export function BotonEditar(props: Props): JSX.Element;
export function BotonEliminar(props: Props): JSX.Element;
export function Acciones(props: { children?: ReactNode }): JSX.Element;
