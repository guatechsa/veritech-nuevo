// ─────────────────────────────────────────────────────────────────────────────
// KIT DE INTERFAZ GUATECH — archivo compartido.
// Fuente de verdad: C:\GUATECH\GUATECH\ui-kit\FechaInput.jsx
// Se copia con `bash C:/GUATECH/sync-ui-kit.sh`. NO editar la copia de un producto.
//
// Campo de fecha del estándar GUATECH (GUATECH_STANDARDS.md sección 18): se ve y se escribe como DD/MM/YYYY en
// cualquier computadora. Reemplaza a <input type="date">, cuyo formato lo decide el sistema operativo y no se puede
// forzar. Es un reemplazo directo: mismas props (value, onChange, min, max, required, disabled, className, id, name)
// y `onChange` recibe un objeto con `target.value` en ISO ('YYYY-MM-DD' o '' si está vacío o incompleto), igual que
// el input nativo, así que los formularios existentes no cambian.
//
//   <FechaInput value={form.fecha} onChange={(e) => update('fecha', e.target.value)} max={hoyIso()} required />
//   <FechaHoraInput value={form.cuando} onChange={(e) => update('cuando', e.target.value)} />  // 'YYYY-MM-DDTHH:mm'
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fechaAIso, formatFecha, hoyIso, nombreMes } from './formatoFecha.js';

const p2 = (n) => String(n).padStart(2, '0');
const DIAS_CORTOS = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

// "04102026" -> "04/10/2026"
function mascara(crudo) {
  const d = String(crudo).replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
}

// Las clases que mueven la caja (ancho, márgenes, display) van al contenedor; el resto al campo.
const LAYOUT = /^(!?(w|min-w|max-w|m[trblxy]?|flex|grow|shrink|col-span|self|basis)-|block$|inline|hidden$)/;
function repartirClases(className = '') {
  const caja = [];
  const campo = [];
  className.split(/\s+/).filter(Boolean).forEach((c) => (LAYOUT.test(c) ? caja : campo).push(c));
  return { caja: caja.join(' '), campo: campo.join(' ') };
}

function Calendario({ ancla, valor, min, max, alElegir, alCerrar, anclaRef }) {
  const base = /^\d{4}-\d{2}-\d{2}/.test(valor) ? valor : (min && hoyIso() < min ? min : hoyIso());
  const [vista, setVista] = useState({ a: +base.slice(0, 4), m: +base.slice(5, 7) });
  const [pos, setPos] = useState(null);
  const caja = useRef(null);

  useLayoutEffect(() => {
    const r = anclaRef.current?.getBoundingClientRect();
    if (!r) return;
    const alto = 300;
    const abajo = window.innerHeight - r.bottom;
    const top = abajo >= alto || abajo >= r.top ? r.bottom + 4 : Math.max(8, r.top - alto - 4);
    setPos({ top, left: Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - 268)) });
  }, [anclaRef]);

  useEffect(() => {
    const fuera = (e) => { if (!caja.current?.contains(e.target) && !anclaRef.current?.contains(e.target)) alCerrar(); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); alCerrar(); } };
    const mover = (e) => { if (!caja.current?.contains(e.target)) alCerrar(); };
    document.addEventListener('mousedown', fuera);
    document.addEventListener('keydown', tecla, true);
    window.addEventListener('scroll', mover, true);
    window.addEventListener('resize', alCerrar);
    return () => {
      document.removeEventListener('mousedown', fuera);
      document.removeEventListener('keydown', tecla, true);
      window.removeEventListener('scroll', mover, true);
      window.removeEventListener('resize', alCerrar);
    };
  }, [alCerrar, anclaRef]);

  const primero = new Date(vista.a, vista.m - 1, 1);
  const hueco = (primero.getDay() + 6) % 7; // semana desde el lunes
  const diasMes = new Date(vista.a, vista.m, 0).getDate();
  const celdas = [];
  for (let i = 0; i < hueco; i += 1) celdas.push(null);
  for (let d = 1; d <= diasMes; d += 1) celdas.push(d);
  const mover = (n) => setVista((v) => {
    const t = new Date(v.a, v.m - 1 + n, 1);
    return { a: t.getFullYear(), m: t.getMonth() + 1 };
  });
  const hoy = hoyIso();

  if (!pos) return null;
  return createPortal(
    <div
      ref={caja}
      role="dialog"
      aria-label="Calendario"
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999, width: 260 }}
      className="rounded-lg border border-slate-200 bg-white p-3 shadow-xl"
    >
      <div className="mb-2 flex items-center justify-between">
        <button type="button" onClick={() => mover(-1)} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" aria-label="Mes anterior">‹</button>
        <span className="text-sm font-semibold capitalize text-slate-800">{nombreMes(vista.m)} {vista.a}</span>
        <button type="button" onClick={() => mover(1)} className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100" aria-label="Mes siguiente">›</button>
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-xs">
        {DIAS_CORTOS.map((d, i) => <div key={i} className="py-1 font-medium text-slate-400">{d}</div>)}
        {celdas.map((d, i) => {
          if (d === null) return <div key={`v${i}`} />;
          const iso = `${vista.a}-${p2(vista.m)}-${p2(d)}`;
          const fuera = (min && iso < min) || (max && iso > max);
          const elegido = iso === valor;
          return (
            <button
              key={iso}
              type="button"
              disabled={!!fuera}
              onClick={() => alElegir(iso)}
              className={[
                'rounded py-1.5 text-sm',
                elegido ? 'bg-slate-800 font-semibold text-white' : 'text-slate-700 hover:bg-slate-100',
                iso === hoy && !elegido ? 'ring-1 ring-slate-400' : '',
                fuera ? 'cursor-not-allowed text-slate-300 hover:bg-transparent' : '',
              ].join(' ')}
            >
              {d}
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs">
        <button type="button" className="text-slate-500 hover:text-slate-800" onClick={() => alElegir('')}>Borrar</button>
        <button
          type="button"
          disabled={(min && hoy < min) || (max && hoy > max)}
          className="text-slate-500 hover:text-slate-800 disabled:text-slate-300"
          onClick={() => alElegir(hoy)}
        >
          Hoy
        </button>
      </div>
    </div>,
    document.body,
  );
}

export default function FechaInput({
  value = '', onChange, min, max, required, disabled, className = '', id, name, placeholder = 'DD/MM/AAAA',
  autoFocus, onBlur, title, ...resto
}) {
  const iso = /^\d{4}-\d{2}-\d{2}/.test(value || '') ? String(value).slice(0, 10) : '';
  const [texto, setTexto] = useState(formatFecha(iso));
  const [abierto, setAbierto] = useState(false);
  const campoRef = useRef(null);
  const cajaRef = useRef(null);
  const idAuto = useId();
  const { caja, campo } = repartirClases(className);

  // El valor llegó de afuera (cargar un registro, limpiar el formulario): mostrarlo, salvo que sea lo que ya se escribe.
  useEffect(() => {
    if (fechaAIso(texto) !== iso) setTexto(formatFecha(iso));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);

  const mensaje = (() => {
    if (!texto) return '';
    if (texto.length < 10) return 'Escriba la fecha completa: DD/MM/AAAA';
    const f = fechaAIso(texto);
    if (!f) return 'Esa fecha no existe. Use el formato DD/MM/AAAA';
    if (min && f < String(min).slice(0, 10)) return `La fecha no puede ser anterior al ${formatFecha(min)}`;
    if (max && f > String(max).slice(0, 10)) return `La fecha no puede ser posterior al ${formatFecha(max)}`;
    return '';
  })();

  useEffect(() => {
    campoRef.current?.setCustomValidity(mensaje);
  }, [mensaje]);

  const emitir = (nuevo) => {
    if (nuevo === iso) return;
    onChange?.({ target: { value: nuevo, name, id: id || idAuto } });
  };

  const alEscribir = (e) => {
    const t = mascara(e.target.value);
    setTexto(t);
    emitir(t.length === 10 ? fechaAIso(t) : '');
  };

  const elegir = (nuevo) => {
    setTexto(formatFecha(nuevo));
    emitir(nuevo);
    setAbierto(false);
    campoRef.current?.focus();
  };

  return (
    <div ref={cajaRef} className={`relative ${caja}`}>
      <input
        {...resto}
        ref={campoRef}
        id={id}
        name={name}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder={placeholder}
        title={title || mensaje || undefined}
        value={texto}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={alEscribir}
        onBlur={onBlur}
        onKeyDown={(e) => { if (e.key === 'ArrowDown' && !abierto && !disabled) { e.preventDefault(); setAbierto(true); } }}
        className={`${campo} pr-9`}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        onClick={() => setAbierto((a) => !a)}
        aria-label="Abrir calendario"
        className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-40"
      >
        <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <rect x="3" y="4.5" width="14" height="12" rx="2" />
          <path d="M3 8h14M7 3v3M13 3v3" strokeLinecap="round" />
        </svg>
      </button>
      {abierto && !disabled && (
        <Calendario
          valor={iso}
          min={min ? String(min).slice(0, 10) : undefined}
          max={max ? String(max).slice(0, 10) : undefined}
          alElegir={elegir}
          alCerrar={() => setAbierto(false)}
          anclaRef={cajaRef}
        />
      )}
    </div>
  );
}

// Fecha y hora: 'YYYY-MM-DDTHH:mm'. La hora es 24 horas (HH:mm), escrita en un campo propio.
export function FechaHoraInput({ value = '', onChange, min, max, required, disabled, className = '', name, id, ...resto }) {
  const fecha = /^\d{4}-\d{2}-\d{2}/.test(value || '') ? String(value).slice(0, 10) : '';
  const hora = /[T ](\d{2}:\d{2})/.exec(value || '')?.[1] || '';
  const [textoHora, setTextoHora] = useState(hora);
  const { caja, campo } = repartirClases(className);
  const horaRef = useRef(null);

  useEffect(() => { setTextoHora(hora); }, [hora]);
  useEffect(() => {
    horaRef.current?.setCustomValidity(textoHora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(textoHora) ? 'Escriba la hora como HH:mm (24 horas)' : '');
  }, [textoHora]);

  const emitir = (f, h) => {
    const completo = f && /^\d{2}:\d{2}$/.test(h) ? `${f}T${h}` : (f && !h ? '' : '');
    onChange?.({ target: { value: completo, name, id } });
  };

  const horaValida = (h) => /^([01]\d|2[0-3]):[0-5]\d$/.test(h);
  const alHora = (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 4);
    const t = d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
    setTextoHora(t);
    emitir(fecha, horaValida(t) ? t : '');
  };

  return (
    <div className={`flex gap-2 ${caja}`}>
      <FechaInput
        {...resto}
        id={id}
        value={fecha}
        min={min ? String(min).slice(0, 10) : undefined}
        max={max ? String(max).slice(0, 10) : undefined}
        required={required}
        disabled={disabled}
        className={`${campo} flex-1`}
        onChange={(e) => emitir(e.target.value, horaValida(textoHora) ? textoHora : '')}
      />
      <input
        ref={horaRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={5}
        placeholder="HH:mm"
        value={textoHora}
        required={required}
        disabled={disabled}
        onChange={alHora}
        className={`${campo} !w-24 text-center`}
        title={textoHora && !horaValida(textoHora) ? 'Hora de 00:00 a 23:59' : undefined}
      />
    </div>
  );
}

// Hora de 24 horas: se escribe HH:mm (nunca AM/PM, que es lo que muestra <input type="time"> en una PC en inglés).
// `value` y `onChange` en 'HH:mm' (acepta 'HH:mm:ss' y lo recorta); '' si está vacío o incompleto.
export function HoraInput({ value = '', onChange, required, disabled, className = '', id, name, placeholder = 'HH:mm', ...resto }) {
  const v = /^\d{2}:\d{2}/.test(value || '') ? String(value).slice(0, 5) : '';
  const [texto, setTexto] = useState(v);
  const ref = useRef(null);
  const valida = (t) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

  useEffect(() => { if ((valida(texto) ? texto : '') !== v) setTexto(v); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [v]);
  useEffect(() => {
    ref.current?.setCustomValidity(texto && !valida(texto) ? 'Escriba la hora como HH:mm, de 00:00 a 23:59' : '');
  }, [texto]);

  const alEscribir = (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 4);
    const t = d.length <= 2 ? d : `${d.slice(0, 2)}:${d.slice(2)}`;
    setTexto(t);
    const nuevo = valida(t) ? t : '';
    if (nuevo !== v) onChange?.({ target: { value: nuevo, name, id } });
  };

  return (
    <input
      {...resto}
      ref={ref}
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={5}
      placeholder={placeholder}
      value={texto}
      required={required}
      disabled={disabled}
      onChange={alEscribir}
      className={className}
    />
  );
}

// Mes y año: se escribe MM/YYYY. `value` y `onChange` en 'YYYY-MM'; '' si está vacío o incompleto.
export function MesInput({ value = '', onChange, min, max, required, disabled, className = '', id, name, placeholder = 'MM/AAAA', ...resto }) {
  const aTexto = (iso) => (/^\d{4}-\d{2}/.test(iso || '') ? `${String(iso).slice(5, 7)}/${String(iso).slice(0, 4)}` : '');
  const aIso = (t) => {
    const r = /^(\d{2})\/(\d{4})$/.exec(t);
    return r && +r[1] >= 1 && +r[1] <= 12 ? `${r[2]}-${r[1]}` : '';
  };
  const v = /^\d{4}-\d{2}/.test(value || '') ? String(value).slice(0, 7) : '';
  const [texto, setTexto] = useState(aTexto(v));
  const ref = useRef(null);

  useEffect(() => { if (aIso(texto) !== v) setTexto(aTexto(v)); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [v]);

  const mensaje = (() => {
    if (!texto) return '';
    const iso = aIso(texto);
    if (!iso) return 'Escriba el mes como MM/AAAA';
    if (min && iso < String(min).slice(0, 7)) return `No puede ser anterior a ${aTexto(String(min))}`;
    if (max && iso > String(max).slice(0, 7)) return `No puede ser posterior a ${aTexto(String(max))}`;
    return '';
  })();
  useEffect(() => { ref.current?.setCustomValidity(mensaje); }, [mensaje]);

  const alEscribir = (e) => {
    const d = e.target.value.replace(/\D/g, '').slice(0, 6);
    const t = d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
    setTexto(t);
    const nuevo = t.length === 7 ? aIso(t) : '';
    if (nuevo !== v) onChange?.({ target: { value: nuevo, name, id } });
  };

  return (
    <input
      {...resto}
      ref={ref}
      id={id}
      name={name}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      maxLength={7}
      placeholder={placeholder}
      title={mensaje || undefined}
      value={texto}
      required={required}
      disabled={disabled}
      onChange={alEscribir}
      className={className}
    />
  );
}
