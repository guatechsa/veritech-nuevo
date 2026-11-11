import type { ReactNode } from 'react';
interface Props {
  isOpen?: boolean;
  onClose?: () => void;
  title?: ReactNode;
  children?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  footer?: ReactNode;
}
export default function Modal(props: Props): JSX.Element | null;
