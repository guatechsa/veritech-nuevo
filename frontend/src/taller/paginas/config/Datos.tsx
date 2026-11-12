import { useRef, useState } from 'react';
import Badge from '../../../components/ui-guatech/Badge.jsx';
import Button from '../../../components/ui-guatech/Button.jsx';
import Tabla, { Columna } from '../../../admin/componentes/Tabla';
import { Aviso, mensajeDe, Seccion, useLista } from '../../componentes/ui';
import { useSesionTaller } from '../../Sesion';

type TipoCarga = 'clientes' | 'equipos' | 'lecturas' | 'ultimos_servicios';

interface InfoCarga {
  tipo: TipoCarga;
  titulo: string;
  descripcion: string;
  columnas: Array<{ encabezado: string; requerida: boolean; ayuda: string; ejemplo: string }>;
}

interface ResultadoCarga {
  tipo: TipoCarga;
  simulacion: boolean;
  aplicado: boolean;
  total_filas: number;
  correctas: number;
  con_error: number;
  errores: Array<{ fila: number; columna: string | null; mensaje: string }>;
  avisos: Array<{ fila: number; mensaje: string }>;
  columnas_ignoradas: string[];
  creados: Record<string, number>;
}

const TIPO_EXCEL = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const NOMBRES_CREADOS: Record<string, [string, string]> = {
  clientes: ['cliente', 'clientes'],
  equipos: ['equipo', 'equipos'],
  contadores: ['medidor', 'medidores'],
  lecturas: ['lectura', 'lecturas'],
  servicios: ['servicio anterior', 'servicios anteriores'],
  marcas: ['marca nueva', 'marcas nuevas'],
};

function resumenDeCreados(creados: Record<string, number>): string {
  const partes = Object.entries(creados)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${(NOMBRES_CREADOS[k] ?? [k, k])[n === 1 ? 0 : 1]}`);
  return partes.length > 0 ? partes.join(', ') : 'nada';
}

/** Entrega al navegador un archivo ya descargado (como si la persona hubiera pulsado «Guardar»). */
function guardarComoArchivo(blob: Blob, nombre: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function Descargar() {
  const { api, tiene } = useSesionTaller();
  const resumen = useLista(() => api.get<Array<{ hoja: string; filas: number }>>('/exportar/resumen'), [api]);
  const [trabajando, setTrabajando] = useState<'libro' | 'zip' | null>(null);
  const [error, setError] = useState('');
  const bajar = async (que: 'libro' | 'zip'): Promise<void> => {
    setError('');
    setTrabajando(que);
    try {
      const r = await api.descargar(que === 'libro' ? '/exportar/datos' : '/exportar/archivos');
      guardarComoArchivo(r.blob, r.nombre);
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo descargar'));
    } finally {
      setTrabajando(null);
    }
  };
  if (!tiene('datos.exportar')) return null;
  const conDatos = (resumen.datos ?? []).filter((h) => h.filas > 0);
  return (
    <Seccion titulo="Descargar mis datos">
      <p className="text-sm text-gray-700">
        Descargue una copia de toda su información en un libro de Excel (una hoja por tema: clientes, equipos, lecturas, colaboradores y los catálogos) y, aparte, un archivo .zip con las fotos y documentos escaneados.
        Por seguridad no incluye contraseñas.
      </p>
      <Aviso mensaje={error || resumen.error} tipo="error" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void bajar('libro')} disabled={trabajando !== null}>{trabajando === 'libro' ? 'Preparando el libro…' : 'Descargar libro de Excel'}</Button>
        <Button variant="outline" onClick={() => void bajar('zip')} disabled={trabajando !== null}>{trabajando === 'zip' ? 'Preparando el .zip…' : 'Descargar fotos y documentos (.zip)'}</Button>
      </div>
      {resumen.datos && (
        <p className="text-xs text-gray-500">
          Lo que hay hoy: {conDatos.length > 0 ? conDatos.map((h) => `${h.hoja} (${h.filas})`).join(' · ') : 'todavía no hay información cargada'}.
        </p>
      )}
    </Seccion>
  );
}

function Resultado({ r }: { r: ResultadoCarga }) {
  const columnas: Array<Columna<ResultadoCarga['errores'][number]>> = [
    { clave: 'fila', etiqueta: 'Fila de Excel', valor: (x) => x.fila, alinear: 'right' },
    { clave: 'columna', etiqueta: 'Columna', valor: (x) => x.columna ?? '', render: (x) => x.columna ?? '—' },
    { clave: 'mensaje', etiqueta: 'Qué corregir', valor: (x) => x.mensaje },
  ];
  const hayErrores = r.con_error > 0;
  return (
    <div className="space-y-3 rounded-lg border border-gray-200 bg-white p-4 shadow-sm" aria-live="polite">
      {r.aplicado ? (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-800">Listo. Quedaron cargados: {resumenDeCreados(r.creados)}. Ya los puede ver en el sistema.</p>
      ) : hayErrores ? (
        <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {r.con_error === 1 ? 'Hay 1 fila con un problema' : `Hay ${r.con_error} filas con problemas`} y por eso NO se cargó nada. Corrija el Excel y vuelva a subirlo completo.
        </p>
      ) : (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm font-medium text-green-800">
          Todo está bien: las {r.total_filas} filas se pueden cargar ({resumenDeCreados(r.creados)}). Todavía no se guardó nada; pulse «Cargar de verdad» para guardarlo.
        </p>
      )}
      <p className="text-sm text-gray-600">
        Filas revisadas: <strong>{r.total_filas}</strong> · Correctas: <strong>{r.correctas}</strong> · Con problema: <strong>{r.con_error}</strong>
      </p>
      {r.columnas_ignoradas.length > 0 && <p className="text-xs text-amber-800">Estas columnas no se usan y se ignoraron: {r.columnas_ignoradas.join(', ')}.</p>}
      {hayErrores && (
        <>
          <Tabla columnas={columnas} filas={r.errores} clave={(x) => `${x.fila}-${x.columna}-${x.mensaje}`} />
          {r.con_error > r.errores.length && <p className="text-xs text-gray-500">Se muestran los primeros {r.errores.length} problemas; corríjalos y pruebe de nuevo para ver los demás.</p>}
        </>
      )}
      {r.avisos.length > 0 && (
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-sm font-bold text-gray-900">Avisos <Badge variant="warning">{r.avisos.length}</Badge></h3>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-gray-700">
            {r.avisos.slice(0, 50).map((a, i) => (
              <li key={i}>Fila {a.fila}: {a.mensaje}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Cargar() {
  const { api, tiene } = useSesionTaller();
  const tipos = useLista(() => api.get<InfoCarga[]>('/importar/tipos'), [api]);
  const [tipo, setTipo] = useState<TipoCarga>('clientes');
  const [archivo, setArchivo] = useState<File | null>(null);
  const [crearMarcas, setCrearMarcas] = useState(false);
  const [resultado, setResultado] = useState<ResultadoCarga | null>(null);
  /** Lo que se probó sin guardar: «Cargar de verdad» solo se habilita si ESTA misma prueba salió limpia. */
  const [probado, setProbado] = useState<{ archivo: File; crearMarcas: boolean; tipo: TipoCarga } | null>(null);
  const [error, setError] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [claveCampo, setClaveCampo] = useState(0);
  const entrada = useRef<HTMLInputElement>(null);

  if (!tiene('datos.importar')) return null;
  const info = tipos.datos?.find((t) => t.tipo === tipo);

  const descargarPlantilla = async (): Promise<void> => {
    setError('');
    try {
      const r = await api.descargar(`/importar/${tipo}/plantilla`);
      guardarComoArchivo(r.blob, r.nombre);
    } catch (e) {
      setError(mensajeDe(e, 'No se pudo descargar la plantilla'));
    }
  };

  const enviar = async (simular: boolean): Promise<void> => {
    if (!archivo) return;
    setError('');
    setTrabajando(true);
    try {
      const r = await api.subir<ResultadoCarga>(`/importar/${tipo}?simular=${simular}&crear_marcas=${crearMarcas}`, new Blob([archivo], { type: TIPO_EXCEL }), archivo.name);
      setResultado(r);
      if (r.aplicado) {
        setProbado(null);
        setArchivo(null);
        setClaveCampo((k) => k + 1);
      } else if (simular && r.con_error === 0) setProbado({ archivo, crearMarcas, tipo });
      else setProbado(null);
    } catch (e) {
      setResultado(null);
      setProbado(null);
      setError(mensajeDe(e, 'No se pudo revisar el archivo'));
    } finally {
      setTrabajando(false);
    }
  };

  const listoParaCargar = probado !== null && probado.archivo === archivo && probado.crearMarcas === crearMarcas && probado.tipo === tipo;
  const cambiarTipo = (t: TipoCarga): void => {
    setTipo(t);
    setResultado(null);
    setProbado(null);
    setError('');
    setArchivo(null);
    setClaveCampo((k) => k + 1);
  };

  return (
    <Seccion titulo="Cargar desde Excel">
      <p className="text-sm text-gray-700">
        Para pasar su información de un Excel al sistema sin escribirla de nuevo. Descargue la plantilla, llénela, y súbala: primero se <strong>prueba sin guardar</strong> para avisarle de cualquier error, y solo cuando todo esté bien se carga.
        Se carga todo o nada, así que puede corregir y volver a subir sin miedo a duplicar.
      </p>
      <Aviso mensaje={tipos.error} tipo="error" />
      <div className="grid gap-3 md:grid-cols-3">
        {(tipos.datos ?? []).map((t) => (
          <button
            key={t.tipo}
            type="button"
            onClick={() => cambiarTipo(t.tipo)}
            aria-pressed={tipo === t.tipo}
            className={`rounded-lg border p-3 text-left text-sm ${tipo === t.tipo ? 'border-primary bg-primary-100' : 'border-gray-200 bg-white hover:bg-gray-50'}`}
          >
            <span className="block font-bold text-gray-900">{t.titulo}</span>
            <span className="mt-1 block text-xs text-gray-600">{t.descripcion}</span>
          </button>
        ))}
      </div>

      {info && (
        <details className="rounded-lg border border-gray-200 bg-white p-3 text-sm">
          <summary className="cursor-pointer font-medium text-gray-800">Qué lleva cada columna de la plantilla de {info.titulo.toLowerCase()}</summary>
          <ul className="mt-2 space-y-1">
            {info.columnas.map((c) => (
              <li key={c.encabezado}>
                <strong>{c.encabezado}</strong>
                {c.requerida && <span className="ml-1 text-red-700">(obligatoria)</span>}: {c.ayuda}
                {c.ejemplo && <span className="text-gray-500"> Ejemplo: {c.ejemplo}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Button variant="outline" onClick={() => void descargarPlantilla()}>Descargar plantilla de {info?.titulo.toLowerCase() ?? ''}</Button>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Archivo de Excel (.xlsx) ya lleno</span>
          <input
            key={claveCampo}
            ref={entrada}
            type="file"
            accept=".xlsx"
            onChange={(e) => {
              setArchivo(e.target.files?.[0] ?? null);
              setResultado(null);
              setProbado(null);
              setError('');
            }}
            className="block text-sm"
          />
        </label>
      </div>

      {tipo === 'equipos' && (
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={crearMarcas} onChange={(e) => setCrearMarcas(e.target.checked)} />
          Crear las marcas que falten (si no, una marca que no exista se marca como error)
        </label>
      )}

      <Aviso mensaje={error} tipo="error" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void enviar(true)} disabled={!archivo || trabajando}>{trabajando ? 'Revisando…' : 'Probar sin guardar'}</Button>
        <Button variant="outline" onClick={() => void enviar(false)} disabled={!listoParaCargar || trabajando}>Cargar de verdad</Button>
      </div>
      {archivo && !listoParaCargar && !resultado && <p className="text-xs text-gray-500">Primero pulse «Probar sin guardar». «Cargar de verdad» se habilita cuando la prueba sale sin errores.</p>}
      {resultado && <Resultado r={resultado} />}
    </Seccion>
  );
}

/** Pestaña «Cargar y descargar datos» de Configuración. En «solo exportar» solo queda la descarga (el servidor además lo exige). */
export function DatosDelTaller() {
  const { perfil } = useSesionTaller();
  const soloExportar = perfil?.empresa.estado === 'solo_exportar';
  return (
    <div className="space-y-8">
      <Descargar />
      {!soloExportar && <Cargar />}
    </div>
  );
}
