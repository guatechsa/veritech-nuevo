import { useEffect } from 'react';

/**
 * Estándar GUATECH §5: todo texto libre se guarda en MAYÚSCULAS y SIN TILDES (excepto el correo). Un escucha global en
 * fase de captura lo hace en cualquier formulario sin tocar cada uno.
 *
 * DOS TRAMPAS que ya costaron incidentes en producción en el sistema anterior, resueltas aquí desde el primer día:
 *  1. NUNCA asignar `el.value = nuevo`: React guarda el último valor que conoce y, si se asigna así, concluye "no hubo
 *     cambio" y pierde la tecla. Se escribe con el setter del PROTOTIPO y se dispara un evento nuevo.
 *  2. NUNCA tocar contraseñas, ni siquiera cuando el botón del ojo las vuelve `type="text"`: se recuerdan los campos
 *     que alguna vez fueron `password` y se reconocen por nombre/id/autocomplete.
 */
const TIPOS_EXCLUIDOS = new Set(['email', 'password', 'number', 'date', 'datetime-local', 'time', 'month', 'week', 'url', 'tel', 'color', 'range', 'file', 'checkbox', 'radio', 'hidden', 'search']);
const camposPasswordVistos = new WeakSet<Element>();
// "clave" queda fuera a propósito: es palabra de negocio (clave de producto) y daría falsos positivos.
const PISTA_PASSWORD = /(password|passwd|contrase)/i;

export function mayusculasSinTildes(valor: string): string {
  return valor.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
}

export function esCampoDePassword(el: HTMLInputElement | HTMLTextAreaElement): boolean {
  if (el.tagName !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  if (input.type === 'password') {
    camposPasswordVistos.add(el);
    return true;
  }
  if (camposPasswordVistos.has(el)) return true;
  const autocomplete = (el.getAttribute('autocomplete') ?? '').toLowerCase();
  if (autocomplete.includes('password') || PISTA_PASSWORD.test(`${el.name} ${el.id}`)) {
    camposPasswordVistos.add(el);
    return true;
  }
  return false;
}

/** ¿Este campo debe normalizarse? Solo el texto libre. */
export function debeNormalizar(el: EventTarget | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return false;
  if (el.closest('[data-no-uppercase="true"]')) return false;
  if (el.getAttribute('data-no-uppercase') === 'true') return false;
  if (esCampoDePassword(el)) return false;
  if (el instanceof HTMLInputElement && TIPOS_EXCLUIDOS.has(el.type)) return false;
  if (el.readOnly || el.disabled) return false;
  return true;
}

function alEscribir(evento: Event): void {
  const el = evento.target;
  if (!debeNormalizar(el)) return;
  if ((evento as InputEvent).isComposing) return; // no interrumpir teclados con acentos compuestos
  const nuevo = mayusculasSinTildes(el.value);
  if (nuevo === el.value) return;

  evento.stopImmediatePropagation();
  const inicio = el.selectionStart;
  const fin = el.selectionEnd;
  const prototipo = el instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototipo, 'value')?.set;
  setter?.call(el, nuevo);
  if (inicio !== null && fin !== null) el.setSelectionRange(inicio, fin);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function useFormatoTextoGlobal(): void {
  useEffect(() => {
    document.addEventListener('input', alEscribir, true);
    return () => document.removeEventListener('input', alEscribir, true);
  }, []);
}
