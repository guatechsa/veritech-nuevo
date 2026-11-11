// Tipos del componente del kit (Button.jsx) para el proyecto TypeScript. Las copias del kit no se editan; los tipos viven aquí.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
type Props = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type'> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit' | 'reset';
  children?: ReactNode;
};
export default function Button(props: Props): JSX.Element;
