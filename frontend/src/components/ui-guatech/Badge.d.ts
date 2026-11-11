import type { ReactNode } from 'react';
export default function Badge(props: { children?: ReactNode; variant?: 'default' | 'success' | 'warning' | 'danger' | 'info'; className?: string }): JSX.Element;
export function BadgeEstado(props: { activo: boolean | number; textoActivo?: string; textoInactivo?: string }): JSX.Element;
