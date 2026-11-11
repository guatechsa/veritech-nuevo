import { Check, CircleAlert, LoaderCircle } from 'lucide-react';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Button from '../components/ui-guatech/Button.jsx';
import { ErrorApi } from '../admin/api';
import CampoContrasena, { contrasenaValida } from '../admin/componentes/CampoContrasena';
import { dinero } from '../admin/tipos';
import { EstadoAltaPublico, llamarPublico, PaseEmitido, PlanPublico } from './api';
import Tarjeta, { Aviso, CLASE_CAMPO } from './Tarjeta';

// ── PayPal: el botón lo dibuja PayPal; aquí solo se le dice qué plan suscribir y se recibe el resultado ──
interface BotonesPaypal {
  render: (contenedor: HTMLElement) => Promise<void>;
  close: () => void;
}
interface OpcionesPaypal {
  style: { layout: 'vertical'; color: 'blue'; label: 'subscribe' };
  createSubscription: (datos: unknown, acciones: { subscription: { create: (d: { plan_id: string; custom_id: string }) => Promise<string> } }) => Promise<string>;
  onApprove: (datos: { subscriptionID?: string | null }) => Promise<void> | void;
  onError: (error: unknown) => void;
  onCancel: () => void;
}
declare global {
  interface Window {
    paypal?: { Buttons: (opciones: OpcionesPaypal) => BotonesPaypal };
  }
}

function cargarSdkPaypal(clientId: string): Promise<void> {
  if (window.paypal) return Promise.resolve();
  return new Promise((resolver, rechazar) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&vault=true&intent=subscription&currency=USD`;
    s.async = true;
    s.onload = () => resolver();
    s.onerror = () => rechazar(new Error('No se pudo cargar PayPal'));
    document.head.appendChild(s);
  });
}

const URL_TERMINOS = 'https://guatech.lat/legal/veri-tech/terminos.html';
const URL_PRIVACIDAD = 'https://guatech.lat/legal/veri-tech/privacidad.html';
const CLAVE_PASE = 'vt_registro_pase';

interface PaseGuardado extends PaseEmitido {
  slug: string;
}

function leerPase(): PaseGuardado | null {
  try {
    const t = sessionStorage.getItem(CLAVE_PASE);
    return t ? (JSON.parse(t) as PaseGuardado) : null;
  } catch {
    return null;
  }
}
function guardarPase(p: PaseGuardado | null): void {
  try {
    if (p) sessionStorage.setItem(CLAVE_PASE, JSON.stringify(p));
    else sessionStorage.removeItem(CLAVE_PASE);
  } catch {
    // Sin almacenamiento: si recarga la página tendrá que empezar de nuevo.
  }
}

type Paso = 'datos' | 'pago' | 'creando' | 'lista' | 'error';
type Disponibilidad = 'sin_revisar' | 'revisando' | 'libre' | 'ocupado' | 'invalido';

const FORMATO_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function descripcionPlan(p: PlanPublico): string {
  const usuarios = p.max_usuarios === null ? 'usuarios sin límite' : `hasta ${p.max_usuarios} usuarios`;
  const sucursales = p.max_sucursales === null ? 'sucursales sin límite' : p.max_sucursales === 1 ? '1 sucursal' : `hasta ${p.max_sucursales} sucursales`;
  return `${usuarios} · ${sucursales}`;
}

export default function Registro() {
  const [paso, setPaso] = useState<Paso>('datos');
  const [planes, setPlanes] = useState<PlanPublico[]>([]);
  const [versionLegal, setVersionLegal] = useState('1.0');
  const [dominio, setDominio] = useState('veritech.lat');
  const [clientePaypal, setClientePaypal] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  const [nombreTaller, setNombreTaller] = useState('');
  const [slug, setSlug] = useState('');
  const [adminNombre, setAdminNombre] = useState('');
  const [adminCorreo, setAdminCorreo] = useState('');
  const [contrasena, setContrasena] = useState('');
  const [planCodigo, setPlanCodigo] = useState('');
  const [acepta, setAcepta] = useState(false);
  const [disponibilidad, setDisponibilidad] = useState<Disponibilidad>('sin_revisar');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);

  const [pase, setPase] = useState<PaseGuardado | null>(null);
  const [resultado, setResultado] = useState<EstadoAltaPublico | null>(null);
  const contenedorPaypal = useRef<HTMLDivElement>(null);

  // Carga inicial: planes, configuración y, si había un registro a medias en esta pestaña, se retoma.
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const [p, c] = await Promise.all([
          llamarPublico<{ version_legal: string; planes: PlanPublico[] }>('GET', '/registro/planes'),
          llamarPublico<{ paypal: { client_id: string } | null; dominio: string }>('GET', '/registro/config'),
        ]);
        if (!vivo) return;
        setPlanes(p.planes);
        setVersionLegal(p.version_legal);
        setDominio(c.dominio);
        setClientePaypal(c.paypal?.client_id ?? null);
        setPlanCodigo((actual) => actual || p.planes[0]?.codigo || '');
        const guardado = leerPase();
        if (guardado) {
          const estado = await llamarPublico<EstadoAltaPublico>('GET', `/registro/estado?pase=${guardado.pase}`).catch(() => null);
          if (!vivo) return;
          if (estado?.estado === 'esperando_pago') {
            setPase(guardado);
            setPaso('pago');
          } else if (estado?.estado === 'creando' || estado?.estado === 'lista' || estado?.estado === 'error') {
            setPase(guardado);
            setResultado(estado);
            setPaso(estado.estado === 'lista' ? 'lista' : estado.estado === 'error' ? 'error' : 'creando');
          } else {
            guardarPase(null);
          }
        }
      } catch (e) {
        if (vivo) setError(e instanceof ErrorApi ? e.message : 'No se pudo cargar la página');
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  // Disponibilidad del nombre en la dirección, con una pausa para no preguntar en cada tecla.
  useEffect(() => {
    if (slug === '') {
      setDisponibilidad('sin_revisar');
      return;
    }
    if (slug.length < 3 || slug.length > 30 || !FORMATO_SLUG.test(slug) || /^\d+$/.test(slug)) {
      setDisponibilidad('invalido');
      return;
    }
    setDisponibilidad('revisando');
    const t = setTimeout(() => {
      llamarPublico<{ disponible: boolean }>('POST', '/registro/disponibilidad', { slug })
        .then((r) => setDisponibilidad(r.disponible ? 'libre' : 'ocupado'))
        .catch(() => setDisponibilidad('sin_revisar'));
    }, 450);
    return () => clearTimeout(t);
  }, [slug]);

  const planElegido = planes.find((p) => p.codigo === planCodigo);

  const enviarDatos = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    if (!contrasenaValida(contrasena)) {
      setError('La contraseña no cumple todas las reglas.');
      return;
    }
    if (disponibilidad === 'ocupado' || disponibilidad === 'invalido') {
      setError('Elija otro nombre en la dirección.');
      return;
    }
    setEnviando(true);
    try {
      const emitido = await llamarPublico<PaseEmitido>('POST', '/registro/iniciar', {
        nombre_taller: nombreTaller,
        slug,
        admin_nombre: adminNombre,
        admin_correo: adminCorreo.trim(),
        contrasena,
        plan_codigo: planCodigo,
        version_legal: versionLegal,
        acepta_terminos: acepta,
      });
      const guardado = { ...emitido, slug };
      guardarPase(guardado);
      setPase(guardado);
      setContrasena(''); // la contraseña ya no se necesita en la pantalla
      setPaso('pago');
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo continuar');
    } finally {
      setEnviando(false);
    }
  };

  // Paso 2: el botón de PayPal.
  const confirmar = useCallback(
    async (suscripcionId: string) => {
      if (!pase) return;
      setError('');
      try {
        await llamarPublico('POST', '/registro/confirmar', { pase: pase.pase, suscripcion_id: suscripcionId });
        setPaso('creando');
      } catch (err) {
        setError(err instanceof ErrorApi ? err.message : 'No se pudo confirmar el pago');
      }
    },
    [pase]
  );

  useEffect(() => {
    if (paso !== 'pago' || !pase || !clientePaypal || !contenedorPaypal.current) return;
    let botones: BotonesPaypal | null = null;
    let activo = true;
    cargarSdkPaypal(clientePaypal)
      .then(() => {
        if (!activo || !window.paypal || !contenedorPaypal.current) return;
        botones = window.paypal.Buttons({
          style: { layout: 'vertical', color: 'blue', label: 'subscribe' },
          createSubscription: (_d, acciones) => acciones.subscription.create({ plan_id: pase.paypal_plan_id, custom_id: pase.custom_id }),
          onApprove: async (d) => {
            if (d.subscriptionID) await confirmar(d.subscriptionID);
          },
          onError: () => setError('PayPal no pudo procesar la suscripción. No se le cobró nada; intente de nuevo.'),
          onCancel: () => setError('Cancelaron la aprobación en PayPal. Cuando quiera, vuelva a intentarlo.'),
        });
        void botones.render(contenedorPaypal.current);
      })
      .catch(() => setError('No se pudo cargar PayPal. Revise su conexión e intente de nuevo.'));
    return () => {
      activo = false;
      try {
        botones?.close();
      } catch {
        // el botón ya no estaba
      }
    };
  }, [paso, pase, clientePaypal, confirmar]);

  // Paso 3: se consulta cada pocos segundos hasta que el taller esté listo.
  useEffect(() => {
    if (paso !== 'creando' || !pase) return;
    let vivo = true;
    const inicio = Date.now();
    const vuelta = async (): Promise<void> => {
      try {
        const estado = await llamarPublico<EstadoAltaPublico>('GET', `/registro/estado?pase=${pase.pase}`);
        if (!vivo) return;
        if (estado.estado === 'lista') {
          setResultado(estado);
          setPaso('lista');
          guardarPase(null);
        } else if (estado.estado === 'error' || (Date.now() - inicio > 5 * 60 * 1000)) {
          setPaso('error');
        }
      } catch {
        // un tropiezo de red no detiene la espera
      }
    };
    const t = setInterval(() => void vuelta(), 2500);
    void vuelta();
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [paso, pase]);

  if (cargando) {
    return (
      <Tarjeta titulo="Pruebe VERI-TECH 30 días gratis">
        <p className="flex items-center justify-center gap-2 text-sm text-gray-500"><LoaderCircle className="animate-spin" size={16} /> Cargando…</p>
      </Tarjeta>
    );
  }

  if (paso === 'creando') {
    return (
      <Tarjeta titulo="Estamos preparando su taller" subtitulo="Esto toma unos segundos. No cierre esta página.">
        <p className="flex items-center justify-center gap-2 py-6 text-sm text-gray-600"><LoaderCircle className="animate-spin" size={18} /> Creando su cuenta…</p>
      </Tarjeta>
    );
  }

  if (paso === 'lista') {
    return (
      <Tarjeta titulo="¡Su taller está listo!">
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-700"><Check size={26} /></div>
          <p className="text-sm text-gray-700">Ya puede entrar con el correo y la contraseña que registró. Tiene 30 días de prueba; el primer cobro será al terminar ese período y puede cancelar cuando quiera.</p>
          {resultado?.url && <a href={resultado.url} className="block rounded-md bg-primary px-4 py-2 text-sm font-semibold text-white hover:opacity-90">Entrar a mi taller</a>}
          {resultado?.subdominio && <p className="text-xs text-gray-500">Su dirección: {resultado.subdominio}</p>}
        </div>
      </Tarjeta>
    );
  }

  if (paso === 'error') {
    return (
      <Tarjeta titulo="Su pago está seguro">
        <div className="space-y-4 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-700"><CircleAlert size={26} /></div>
          <p className="text-sm text-gray-700">Recibimos su suscripción, pero tuvimos un problema al terminar de crear su taller. Ya avisamos a nuestro equipo y lo resolverá hoy; le escribiremos a su correo.</p>
          <p className="text-sm text-gray-600">Si necesita ayuda, escriba a <a className="text-primary hover:underline" href="mailto:soporte@guatech.lat">soporte@guatech.lat</a>.</p>
        </div>
      </Tarjeta>
    );
  }

  if (paso === 'pago' && pase) {
    return (
      <Tarjeta titulo="Un último paso: apruebe su suscripción" subtitulo="No se le cobra hoy: el primer cobro es al terminar los 30 días de prueba." ancho="max-w-md">
        <div className="space-y-4">
          <Aviso mensaje={error} tipo="error" />
          <p className="rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-700">
            Su dirección será <strong>{pase.slug}.{dominio}</strong>
          </p>
          {clientePaypal ? (
            <div ref={contenedorPaypal} />
          ) : (
            <Aviso mensaje="El cobro con PayPal todavía no está habilitado en este ambiente de pruebas." tipo="error" />
          )}
          <p className="text-center text-xs text-gray-500">Puede cancelar en cualquier momento desde su cuenta. El servicio sigue hasta el final del período pagado.</p>
        </div>
      </Tarjeta>
    );
  }

  const estadoSlug: Record<Disponibilidad, { texto: string; clase: string } | null> = {
    sin_revisar: null,
    revisando: { texto: 'Revisando…', clase: 'text-gray-500' },
    libre: { texto: '✓ Disponible', clase: 'text-green-700' },
    ocupado: { texto: 'No está disponible. Elija otro.', clase: 'text-red-700' },
    invalido: { texto: 'De 3 a 30 letras minúsculas sin tilde, números y guiones sueltos.', clase: 'text-red-700' },
  };
  const indicador = estadoSlug[disponibilidad];
  const hayCobro = planes.some((p) => p.cobro_disponible);

  return (
    <Tarjeta titulo="Pruebe VERI-TECH 30 días gratis" subtitulo="Registre su taller, apruebe la suscripción en PayPal y empiece. Cancele cuando quiera." ancho="max-w-2xl">
      <form onSubmit={enviarDatos} className="space-y-5">
        <Aviso mensaje={error} tipo="error" />
        {!hayCobro && <Aviso mensaje="El registro todavía no está habilitado en este ambiente de pruebas (falta configurar el cobro con PayPal)." tipo="error" />}

        <fieldset>
          <legend className="mb-2 text-sm font-medium text-gray-700">Elija su plan</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            {planes.map((p) => (
              <label key={p.codigo} className={`cursor-pointer rounded-lg border p-3 text-sm ${planCodigo === p.codigo ? 'border-primary bg-primary-100 ring-1 ring-primary' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="radio" name="plan" value={p.codigo} checked={planCodigo === p.codigo} onChange={() => setPlanCodigo(p.codigo)} className="sr-only" />
                <span className="block font-bold text-gray-900">{p.nombre}</span>
                <span className="block text-lg font-extrabold text-primary">{dinero(p.precio_mensual)}<span className="text-xs font-medium text-gray-500"> / mes</span></span>
                <span className="mt-1 block text-xs text-gray-600">{descripcionPlan(p)}</span>
                <span className="block text-xs text-gray-500">{p.modulos.length} módulos incluidos</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label htmlFor="nombre_taller" className="mb-1 block text-sm font-medium text-gray-700">Nombre del taller</label>
            <input id="nombre_taller" required minLength={3} maxLength={150} value={nombreTaller} onChange={(e) => setNombreTaller(e.target.value)} className={CLASE_CAMPO} />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="slug" className="mb-1 block text-sm font-medium text-gray-700">Su dirección en VERI-TECH</label>
            <div className="flex items-center gap-2">
              <input id="slug" required value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={30} autoComplete="off" data-no-uppercase="true" className={CLASE_CAMPO} />
              <span className="whitespace-nowrap text-sm text-gray-500">.{dominio}</span>
            </div>
            {indicador && <p className={`mt-1 text-xs ${indicador.clase}`}>{indicador.texto}</p>}
          </div>
          <div>
            <label htmlFor="admin_nombre" className="mb-1 block text-sm font-medium text-gray-700">Su nombre (administrador)</label>
            <input id="admin_nombre" required minLength={2} maxLength={120} value={adminNombre} onChange={(e) => setAdminNombre(e.target.value)} autoComplete="name" className={CLASE_CAMPO} />
          </div>
          <div>
            <label htmlFor="admin_correo" className="mb-1 block text-sm font-medium text-gray-700">Su correo</label>
            <input id="admin_correo" type="email" required maxLength={150} value={adminCorreo} onChange={(e) => setAdminCorreo(e.target.value)} autoComplete="email" className={CLASE_CAMPO} />
          </div>
          <div className="sm:col-span-2">
            <CampoContrasena id="contrasena" etiqueta="Contraseña" tipo="nueva" valor={contrasena} alCambiar={setContrasena} />
          </div>
        </div>

        <label className="flex items-start gap-2 text-sm text-gray-700">
          <input type="checkbox" required checked={acepta} onChange={(e) => setAcepta(e.target.checked)} className="mt-1" />
          <span>
            Acepto los <a href={URL_TERMINOS} target="_blank" rel="noopener" className="text-primary hover:underline">Términos de Uso</a> y la{' '}
            <a href={URL_PRIVACIDAD} target="_blank" rel="noopener" className="text-primary hover:underline">Política de Privacidad</a> de VERI-TECH.
          </span>
        </label>

        <Button type="submit" className="w-full" disabled={enviando || !hayCobro || !planElegido}>
          {enviando ? 'Un momento…' : 'Continuar a PayPal'}
        </Button>
        <p className="text-center text-sm text-gray-600">
          ¿Ya tiene cuenta? <Link to="/entrar" className="text-primary hover:underline">Entrar a mi taller</Link>
        </p>
      </form>
    </Tarjeta>
  );
}
