import { Check, Eye, EyeOff, X } from 'lucide-react';
import { useState } from 'react';

export const REGLAS = [
  { id: 'largo', texto: 'Al menos 10 caracteres', cumple: (c: string) => c.length >= 10 },
  { id: 'mayuscula', texto: 'Una letra mayúscula', cumple: (c: string) => /[A-ZÁÉÍÓÚÑÜ]/.test(c) },
  { id: 'minuscula', texto: 'Una letra minúscula', cumple: (c: string) => /[a-záéíóúñü]/.test(c) },
  { id: 'numero', texto: 'Un número', cumple: (c: string) => /[0-9]/.test(c) },
  { id: 'simbolo', texto: 'Un símbolo (por ejemplo ! # $ % & *)', cumple: (c: string) => /[^A-Za-z0-9ÁÉÍÓÚÑÜáéíóúñü\s]/.test(c) },
];

export const contrasenaValida = (c: string): boolean => REGLAS.every((r) => r.cumple(c));

interface Props {
  id: string;
  etiqueta: string;
  valor: string;
  alCambiar: (valor: string) => void;
  /** 'nueva' muestra la lista de reglas y usa autocomplete="new-password". */
  tipo?: 'actual' | 'nueva';
  autoFocus?: boolean;
  requerido?: boolean;
}

/**
 * Campo de contraseña del estándar: botón de ojo, lista de reglas en vivo y los CINCO atributos que impiden que el
 * navegador o el formateador de texto la reescriban (autoComplete, autoCapitalize, autoCorrect, spellCheck, textTransform).
 */
export default function CampoContrasena({ id, etiqueta, valor, alCambiar, tipo = 'actual', autoFocus, requerido = true }: Props) {
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-gray-700">
        {etiqueta}
      </label>
      <div className="relative">
        <input
          id={id}
          name={id.includes('password') ? id : `password-${id}`}
          type={visible ? 'text' : 'password'}
          value={valor}
          onChange={(e) => alCambiar(e.target.value)}
          autoComplete={tipo === 'nueva' ? 'new-password' : 'current-password'}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          style={{ textTransform: 'none' }}
          autoFocus={autoFocus}
          required={requerido}
          className="w-full rounded-md border border-gray-300 px-3 py-2 pr-10 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 hover:text-gray-700"
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>
      {tipo === 'nueva' && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {REGLAS.map((r) => {
            const ok = r.cumple(valor);
            return (
              <li key={r.id} className={`flex items-center gap-1.5 ${ok ? 'text-green-700' : 'text-gray-500'}`}>
                {ok ? <Check size={13} /> : <X size={13} />} {r.texto}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
