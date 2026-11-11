// Tipos del componente del kit (FechaInput.jsx) para el proyecto TypeScript. Las copias del kit no se editan; los tipos viven aquí.
import type { InputHTMLAttributes } from 'react';
type Cambio = { target: { value: string } };
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value?: string; onChange?: (e: Cambio) => void };
export default function FechaInput(props: Props): JSX.Element;
export function FechaHoraInput(props: Props): JSX.Element;
export function HoraInput(props: Props): JSX.Element;
export function MesInput(props: Props): JSX.Element;
