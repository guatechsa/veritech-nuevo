import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Traslado de los datos de `enova` del sistema 3.xxx al sistema nuevo (Fase 9). Se hace SOLO por la API del taller nuevo (así se cumplen todas sus reglas) y a
 * partir de tablas bajadas en solo lectura (un archivo .tsv por tabla, ver `scripts/migracion/extraer-enova.sh`). Reglas del traslado:
 *  - Se puede repetir: cada cosa se busca por su nombre antes de crearla («ya existía»), así que una segunda corrida no duplica nada.
 *  - «Ensayo» (`simular`): no escribe nada; solo cuenta lo que haría.
 *  - Al final compara cifras (cuántos clientes, equipos, medidores, materiales, colaboradores, órdenes…) entre el origen y el destino.
 *  - Lo que no se traslada se dice en el informe, con el motivo (nunca se descarta en silencio).
 */
export type Fila = Record<string, string | null>;
export type Tablas = Record<string, Fila[]>;

export interface Cuerpo {
  success?: boolean;
  data?: unknown;
  error?: string;
  codigo?: string;
}
export interface Api {
  llamar(metodo: 'GET' | 'POST' | 'PUT' | 'PATCH', ruta: string, cuerpo?: unknown): Promise<{ status: number; body: Cuerpo }>;
}

export class ErrorDeMigracion extends Error {}

// ── Lectura de las tablas bajadas (formato de `mysql --batch`) ─────────────────────────
const SIN_ESCAPE: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', '0': '\0', r: '\r' };
function desescapar(v: string): string | null {
  if (v === 'NULL') return null;
  return v.replace(/\\([nt\\0r])/g, (_m, c: string) => SIN_ESCAPE[c] ?? c);
}
export function leerTsv(texto: string): Fila[] {
  const lineas = texto.split('\n').filter((l) => l.length > 0);
  if (lineas.length === 0) return [];
  const cabecera = lineas[0]!.split('\t');
  return lineas.slice(1).map((l) => {
    const campos = l.replace(/\r$/, '').split('\t');
    const f: Fila = {};
    cabecera.forEach((c, i) => (f[c] = desescapar(campos[i] ?? 'NULL')));
    return f;
  });
}
export function cargarTablas(carpeta: string): Tablas {
  const t: Tablas = {};
  for (const n of ['clients', 'departamentos', 'proveedores', 'catalog_sistemas', 'catalog_subsistemas', 'catalog_partes', 'catalog_acciones', 'catalog_trabajos', 'cat_trabajos_tiempos', 'catalog_tipos_equipo', 'catalog_marcas_equipo', 'catalog_tipo_contador', 'equipos', 'equipo_contadores', 'ot_contadores_lecturas', 'catalog_puestos', 'colaboradores', 'colaborador_puesto', 'operador_equipo_asignaciones', 'catalog_nivel_tecnico', 'inventory', 'orders', 'order_items', 'users', 'checklist_types', 'checklist_templates', 'checklist_type_tipos_equipo', 'inventory_movements', 'catalog_unidades']) {
    const f = join(carpeta, `${n}.tsv`);
    t[n] = existsSync(f) ? leerTsv(readFileSync(f, 'utf8')) : [];
  }
  return t;
}

// ── Utilidades ───────────────────────────────────────────────────────────────────────
const MARCAS_DE_TILDE = new RegExp('[' + String.fromCharCode(0x300) + '-' + String.fromCharCode(0x36f) + ']', 'g');
export const norma = (s: string | null | undefined): string => (s ?? '').normalize('NFD').replace(MARCAS_DE_TILDE, '').toUpperCase().replace(/\s+/g, ' ').trim();
const num = (v: string | null | undefined): number | null => (v === null || v === undefined || v === '' ? null : Number(v));
const texto = (v: string | null | undefined): string | null => (v === null || v === undefined || v.trim() === '' ? null : v.trim());
/** Las fechas de MySQL llegan como «2026-08-03» (DATE) o «2026-08-03 09:52:13» (DATETIME): se toma el día. */
const dia = (v: string | null | undefined): string | null => (v ? v.slice(0, 10) : null);

export interface Paso {
  entidad: string;
  origen: number;
  creados: number;
  yaExistian: number;
  omitidos: string[];
}
export interface Control {
  concepto: string;
  origen: number | string;
  destino: number | string;
  coincide: boolean;
}
export interface Informe {
  simulado: boolean;
  pasos: Paso[];
  control: Control[];
  noTrasladado: string[];
}

interface Opciones {
  simular?: boolean;
}

/** Ayuda para llamar a la API y fallar con un mensaje que diga QUÉ se estaba haciendo. */
class Cliente {
  constructor(private readonly api: Api) {}
  async pedir<T>(que: string, metodo: 'GET' | 'POST' | 'PUT' | 'PATCH', ruta: string, cuerpo?: unknown): Promise<T> {
    const r = await this.api.llamar(metodo, ruta, cuerpo);
    if (r.status < 200 || r.status >= 300) throw new ErrorDeMigracion(`${que}: ${r.status} ${r.body.codigo ?? ''} ${r.body.error ?? ''}`.trim());
    return r.body.data as T;
  }
  get<T>(que: string, ruta: string): Promise<T> {
    return this.pedir<T>(que, 'GET', ruta);
  }
}

type Reg = Record<string, unknown>;
const regs = (x: unknown): Reg[] => (Array.isArray(x) ? (x as Reg[]) : Array.isArray((x as { registros?: unknown })?.registros) ? ((x as { registros: Reg[] }).registros) : []);
const idDe = (x: Reg): number => Number(x['id']);
const nombreDe = (x: Reg): string => norma(String(x['nombre'] ?? ''));

export async function migrarEnova(api: Api, t: Tablas, opciones: Opciones = {}): Promise<Informe> {
  const simular = opciones.simular ?? false;
  const c = new Cliente(api);
  const informe: Informe = { simulado: simular, pasos: [], control: [], noTrasladado: [] };
  const paso = (entidad: string, origen: number): Paso => {
    const p: Paso = { entidad, origen, creados: 0, yaExistian: 0, omitidos: [] };
    informe.pasos.push(p);
    return p;
  };
  /** Busca por nombre; si no existe lo crea (salvo en ensayo, donde solo cuenta). Devuelve el id (0 en ensayo cuando no existía). */
  async function asegurar(p: Paso, que: string, existentes: Reg[], nombre: string, crear: () => Promise<Reg>): Promise<number> {
    const hallado = existentes.find((x) => nombreDe(x) === norma(nombre));
    if (hallado) {
      p.yaExistian += 1;
      return idDe(hallado);
    }
    p.creados += 1;
    if (simular) return 0;
    const nuevo = await crear();
    existentes.push(nuevo);
    void que;
    return idDe(nuevo);
  }

  // ── Cliente(s) y sus departamentos ────────────────────────────────────────────────
  const pCli = paso('Clientes', t['clients']!.length);
  const pDep = paso('Departamentos de clientes', t['departamentos']!.length);
  const clientes = regs(await c.get('listar clientes', '/clientes'));
  const clienteNuevo = new Map<string, number>();
  for (const f of t['clients']!) {
    const id = await asegurar(pCli, 'cliente', clientes, f['name']!, async () => {
      const dir = [texto(f['address']), texto(f['city'])].filter(Boolean).join(', ');
      const r = await c.pedir<{ cliente: Reg }>('crear cliente', 'POST', '/clientes', {
        nombre: f['name'],
        nit: texto(f['nit']),
        email: texto(f['email']),
        telefono: texto(f['phone']),
        direccion: dir || null,
        contacto_nombre: texto(f['contact']),
        contacto_telefono: texto(f['phone2']),
        notas: texto(f['notes']),
      });
      return r.cliente;
    });
    clienteNuevo.set(f['id']!, id);
  }
  const deptoNuevo = new Map<string, number>();
  for (const f of t['departamentos']!) {
    const clienteId = clienteNuevo.get(f['client_id']!) ?? 0;
    const existentes = clienteId ? regs((await c.get('leer cliente', `/clientes/${clienteId}`) as Reg)['departamentos']) : [];
    const id = await asegurar(pDep, 'departamento', existentes, f['nombre']!, async () => {
      const r = await c.pedir<Reg>('crear departamento', 'POST', `/clientes/${clienteId}/departamentos`, { nombre: f['nombre'] });
      const ficha = (await c.get('leer cliente', `/clientes/${clienteId}`)) as Reg;
      return regs(ficha['departamentos']).find((d) => nombreDe(d) === norma(f['nombre'])) ?? r;
    });
    deptoNuevo.set(f['id']!, id);
  }

  // ── Proveedores ───────────────────────────────────────────────────────────────────
  const pProv = paso('Proveedores', t['proveedores']!.length);
  const proveedores = regs(await c.get('listar proveedores', '/proveedores'));
  const proveedorNuevo = new Map<string, number>();
  for (const f of t['proveedores']!) {
    const id = await asegurar(pProv, 'proveedor', proveedores, f['nombre']!, async () => {
      const r = await c.pedir<{ proveedor?: Reg } & Reg>('crear proveedor', 'POST', '/proveedores', {
        nombre: f['nombre'],
        nit: texto(f['nit']),
        direccion: texto(f['direccion']),
        condicion_pago: f['condicion_pago'] === 'credito' ? 'credito' : 'contado',
        ...(f['condicion_pago'] === 'credito' && num(f['dias_credito']) ? { dias_credito: num(f['dias_credito']) } : {}),
        contacto_nombre: texto(f['contacto_nombre']),
        contacto_email: texto(f['contacto_email']),
        contacto_telefono: texto(f['contacto_telefono']) ?? texto(f['telefono']),
        notas: texto(f['notas']),
      });
      return (r.proveedor ?? r) as Reg;
    });
    proveedorNuevo.set(f['id']!, id);
  }

  // ── Catálogo técnico: sistemas > subsistemas > partes, acciones y trabajos ───────
  const pSis = paso('Sistemas', t['catalog_sistemas']!.length);
  const pSub = paso('Subsistemas', t['catalog_subsistemas']!.length);
  const pPar = paso('Partes', t['catalog_partes']!.length);
  const sistemas = regs(await c.get('listar sistemas', '/catalogos/sistemas'));
  const sistemaNuevo = new Map<string, number>(); // código viejo → id nuevo
  for (const f of t['catalog_sistemas']!) {
    sistemaNuevo.set(f['codigo_sis']!, await asegurar(pSis, 'sistema', sistemas, f['sistema']!, async () => c.pedir<Reg>('crear sistema', 'POST', '/catalogos/sistemas', { nombre: f['sistema'] })));
  }
  const subsistemas = regs(await c.get('listar subsistemas', '/catalogos/subsistemas'));
  const subsistemaNuevo = new Map<string, number>();
  for (const f of t['catalog_subsistemas']!) {
    if (f['activo'] === '0') {
      pSub.omitidos.push(`${f['sub_sistema']} (${f['codigo_sis_sub']}): estaba inactivo`);
      continue;
    }
    const sistemaId = sistemaNuevo.get(f['codigo_sis']!) ?? 0;
    const propios = subsistemas.filter((x) => Number(x['sistema_id']) === sistemaId);
    subsistemaNuevo.set(f['codigo_sis_sub']!, await asegurar(pSub, 'subsistema', propios, f['sub_sistema']!, async () => c.pedir<Reg>('crear subsistema', 'POST', '/catalogos/subsistemas', { sistema_id: sistemaId, nombre: f['sub_sistema'] })));
  }
  const partes = regs(await c.get('listar partes', '/catalogos/partes'));
  const parteNueva = new Map<string, number>();
  for (const f of t['catalog_partes']!) {
    if (f['activo'] === '0') {
      pPar.omitidos.push(`${f['parte']} (${f['codigo_completo']}): estaba inactiva`);
      continue;
    }
    const subId = subsistemaNuevo.get(f['codigo_sis_sub']!) ?? 0;
    const propias = partes.filter((x) => Number(x['subsistema_id']) === subId);
    parteNueva.set(f['codigo_completo']!, await asegurar(pPar, 'parte', propias, f['parte']!, async () => c.pedir<Reg>('crear parte', 'POST', '/catalogos/partes', { subsistema_id: subId, nombre: f['parte'] })));
  }

  const pAcc = paso('Acciones', t['catalog_acciones']!.length);
  const acciones = regs(await c.get('listar acciones', '/catalogos/acciones'));
  const accionNueva = new Map<string, number>();
  for (const f of t['catalog_acciones']!) {
    const usada = t['catalog_trabajos']!.some((x) => x['codigo_accion'] === f['codigo']);
    const hallada = acciones.find((x) => norma(String(x['codigo'])) === norma(f['codigo']));
    if (hallada) {
      pAcc.yaExistian += 1;
      accionNueva.set(f['codigo']!, idDe(hallada));
    } else if (usada) {
      pAcc.creados += 1;
      if (!simular) {
        const nueva = await c.pedir<Reg>('crear acción', 'POST', '/catalogos/acciones', { codigo: f['codigo'], nombre: f['descripcion'] });
        acciones.push(nueva);
        accionNueva.set(f['codigo']!, idDe(nueva));
      }
    } else {
      pAcc.omitidos.push(`${f['descripcion']} (${f['codigo']}): ningún trabajo la usa`);
    }
  }

  // ── Tipos de equipo, marcas y medidores ───────────────────────────────────────────
  const pTip = paso('Tipos de equipo', t['catalog_tipos_equipo']!.length);
  const tipos = regs(await c.get('listar tipos de equipo', '/tipos-equipo?inactivos=true'));
  const tipoNuevo = new Map<string, number>(); // código viejo → id nuevo
  const equiposDelTipo = (cod: string): boolean => t['equipos']!.some((e) => e['tipo_equipo_codigo'] === cod);
  for (const f of t['catalog_tipos_equipo']!) {
    if (f['activo'] === '0' && !equiposDelTipo(f['codigo']!)) {
      pTip.omitidos.push(`${f['tipo']} (${f['codigo']}): inactivo y sin equipos`);
      continue;
    }
    const id = await asegurar(pTip, 'tipo de equipo', tipos, f['tipo']!, async () =>
      c.pedir<Reg>('crear tipo de equipo', 'POST', '/tipos-equipo', {
        codigo: f['codigo'],
        nombre: f['tipo'],
        es_vehiculo: f['codigo'] === 'PICK',
        usa_combustible: f['codigo'] !== 'FOT',
        tarifa_venta_hora: num(f['valor_tarifa']) ?? 0,
        costo_hora: num(f['costo_tarifa']) ?? 0,
        ...(num(f['tolerancia_dias']) !== null ? { tolerancia_dias: num(f['tolerancia_dias']) } : {}),
        ...(num(f['tolerancia_contador']) !== null ? { tolerancia_contador: num(f['tolerancia_contador']) } : {}),
      })
    );
    tipoNuevo.set(f['codigo']!, id);
    if (f['activo'] === '0') pTip.omitidos.push(`${f['tipo']} (${f['codigo']}) estaba inactivo pero tiene equipos: se deja ACTIVO (el sistema nuevo no deja inactivar un tipo en uso)`);
  }
  const pMar = paso('Marcas', 0);
  const marcas = regs(await c.get('listar marcas', '/catalogos/marcas'));
  const marcaNueva = new Map<string, number>();
  for (const e of t['equipos']!) {
    const m = texto(e['brand']);
    if (!m || marcaNueva.has(norma(m))) continue;
    pMar.origen += 1;
    marcaNueva.set(norma(m), await asegurar(pMar, 'marca', marcas, m, async () => c.pedir<Reg>('crear marca', 'POST', '/catalogos/marcas', { nombre: m })));
  }
  const tiposContador = regs(await c.get('listar tipos de contador', '/tipos-contador'));
  const contadorDeTipo: Record<string, string> = { KM: 'ODOMETRO', HR: 'HOROMETRO', DIAS: 'CALENDARIO' };
  const tipoContadorNuevo = (codigoViejo: string): number => {
    const n = contadorDeTipo[codigoViejo];
    const hallado = n ? tiposContador.find((x) => nombreDe(x) === n) : undefined;
    if (!hallado) throw new ErrorDeMigracion(`No hay un tipo de contador equivalente a «${codigoViejo}»`);
    return idDe(hallado);
  };

  // ── Colaboradores ─────────────────────────────────────────────────────────────────
  const pPue = paso('Puestos', t['catalog_puestos']!.length);
  const puestos = regs(await c.get('listar puestos', '/puestos'));
  const equivalePuesto: Record<string, string> = { 'TECNICO': 'TECNICO', 'OPERADOR DE EQUIPO': 'OPERADOR', 'SUPERVISOR': 'SUPERVISOR', 'ADMINISTRADOR': 'ADMINISTRADOR', 'GERENTE': 'GERENTE', 'BODEGUERO': 'BODEGUERO', 'RECEPCIONISTA': 'RECEPCIONISTA' };
  const puestoNuevo = new Map<string, number>();
  for (const f of t['catalog_puestos']!) {
    const nombre = equivalePuesto[norma(f['nombre'])] ?? norma(f['nombre']);
    const usado = t['colaborador_puesto']!.some((x) => x['puesto_id'] === f['id']);
    if (!usado && !equivalePuesto[norma(f['nombre'])]) {
      pPue.omitidos.push(`${f['nombre']}: nadie lo tiene`);
      continue;
    }
    puestoNuevo.set(f['id']!, await asegurar(pPue, 'puesto', puestos, nombre, async () => c.pedir<Reg>('crear puesto', 'POST', '/puestos', { nombre, es_tecnico: f['es_tecnico'] === '1', es_operador: norma(f['nombre']) === 'OPERADOR DE EQUIPO' })));
  }
  const pNiv = paso('Niveles de técnico', 4);
  const niveles = regs(await c.get('listar niveles', '/niveles-tecnico'));
  const nivelNuevo = new Map<string, number>(); // nivel viejo (1..4) → id nuevo
  for (const n of ['1', '2', '3', '4']) {
    const nombre = `NIVEL ${n}`;
    nivelNuevo.set(n, await asegurar(pNiv, 'nivel', niveles, nombre, async () => c.pedir<Reg>('crear nivel', 'POST', '/niveles-tecnico', { codigo: `N${n}`, nombre, orden: Number(n) })));
  }
  const correoDe = new Map<string, string>(); // colaborador viejo → correo del usuario que tenía
  for (const u of t['users']!) if (u['colaborador_id'] && texto(u['email'])) correoDe.set(u['colaborador_id'], texto(u['email'])!);
  const pCol = paso('Colaboradores', t['colaboradores']!.length);
  const colaboradores = regs(await c.get('listar colaboradores', '/colaboradores?activo=true')).concat(regs(await c.get('listar colaboradores inactivos', '/colaboradores?activo=false')));
  for (const x of colaboradores) x['nombre'] = x['nombre_completo'];
  const colaboradorNuevo = new Map<string, number>();
  for (const f of t['colaboradores']!) {
    const misPuestos = t['colaborador_puesto']!.filter((x) => x['colaborador_id'] === f['id']).map((x) => puestoNuevo.get(x['puesto_id']!)).filter((x): x is number => !!x);
    const puestosDelColab = misPuestos.length ? misPuestos : [puestoNuevo.values().next().value as number | undefined].filter((x): x is number => !!x);
    colaboradorNuevo.set(
      f['id']!,
      await asegurar(pCol, 'colaborador', colaboradores, f['nombre_completo']!, async () =>
        c.pedir<Reg>('crear colaborador', 'POST', '/colaboradores', {
          nombre_completo: f['nombre_completo'],
          celular: texto(f['celular']),
          correo: texto(f['correo']) ?? correoDe.get(f['id']!) ?? null,
          dpi: texto(f['dpi']),
          direccion: texto(f['direccion']),
          nivel_tecnico_id: nivelNuevo.get(f['nivel'] ?? '') ?? null,
          puestos: puestosDelColab.length ? puestosDelColab : [1],
        })
      )
    );
  }
  // La matriz «qué nivel puede trabajar en qué sistema» (reglas reales de la empresa).
  if (!simular && t['catalog_nivel_tecnico']!.length > 0) {
    const cambios = t['catalog_nivel_tecnico']!
      .map((f) => ({ nivel_tecnico_id: nivelNuevo.get(f['nivel']!) ?? 0, sistema_id: sistemaNuevo.get(f['codigo_sis']!) ?? 0, habilitado: f['puede_trabajar'] === '1' }))
      .filter((x) => x.nivel_tecnico_id > 0 && x.sistema_id > 0);
    for (let i = 0; i < cambios.length; i += 400) await c.pedir('matriz de niveles', 'PATCH', '/catalogos/matriz-tecnico-sistema', { cambios: cambios.slice(i, i + 400) });
  }

  // ── Trabajos con sus horas ────────────────────────────────────────────────────────
  const pTra = paso('Trabajos', t['catalog_trabajos']!.length);
  const trabajoNuevo = new Map<string, number>(); // código viejo completo → id nuevo
  const trabajosExistentes = regs(await c.get('listar trabajos', '/catalogos/trabajos'));
  for (const f of t['catalog_trabajos']!) {
    if (f['activo'] === '0') {
      pTra.omitidos.push(`${f['codigo_trabajo_completo']}: estaba inactivo`);
      continue;
    }
    const parteId = parteNueva.get(f['codigo_completo']!) ?? 0;
    const accionId = accionNueva.get(f['codigo_accion']!) ?? 0;
    const variante = texto(f['descripcion']);
    const hallado = trabajosExistentes.find((x) => Number(x['parte_id']) === parteId && Number(x['accion_id']) === accionId && norma(String(x['variante'] ?? '')) === norma(variante));
    if (hallado) {
      pTra.yaExistian += 1;
      trabajoNuevo.set(f['codigo_trabajo_completo']!, idDe(hallado));
      continue;
    }
    pTra.creados += 1;
    if (simular) continue;
    const nuevo = await c.pedir<Reg>('crear trabajo', 'POST', '/catalogos/trabajos', { parte_id: parteId, accion_id: accionId, variante });
    trabajosExistentes.push(nuevo);
    trabajoNuevo.set(f['codigo_trabajo_completo']!, idDe(nuevo));
  }
  if (!simular) {
    const horasPorTrabajo = new Map<number, Array<{ tipo_equipo_id: number; horas: number }>>();
    for (const f of t['cat_trabajos_tiempos']!) {
      const tr = trabajoNuevo.get(f['codigo_trabajo_completo']!);
      const tipo = tipoNuevo.get(f['tipo_equipo_codigo']!);
      if (!tr || !tipo || f['activo'] === '0') continue;
      horasPorTrabajo.set(tr, [...(horasPorTrabajo.get(tr) ?? []), { tipo_equipo_id: tipo, horas: Number(f['tiempo_horas']) }]);
    }
    for (const [tr, horas] of horasPorTrabajo) await c.pedir('horas del trabajo', 'PUT', `/catalogos/trabajos/${tr}/horas`, { horas });
  }

  // ── Checklists propios de sus equipos (los genéricos de autos del sistema anterior no se trasladan) ──
  const pChk = paso('Checklists (tipos con su plantilla)', t['checklist_types']!.length);
  const etapas = regs(await c.get('listar etapas', '/catalogos/etapas'));
  const tiposChecklist = regs(await c.get('listar tipos de checklist', '/checklists-tipos'));
  const etapaDe: Record<string, string> = { RECEPCION: 'RECEPCION', ENTREGA: 'ENTREGA', QC: 'CALIDAD', MANTENIMIENTO: 'MANTENIMIENTO', OPERACION: 'OPERACION' };
  for (const f of t['checklist_types']!) {
    const suyos = t['checklist_type_tipos_equipo']!.filter((x) => x['checklist_type_id'] === f['id']).map((x) => tipoNuevo.get(x['tipo_equipo_codigo']!)).filter((x): x is number => x !== undefined);
    if (suyos.length === 0) {
      pChk.omitidos.push(`${f['name']}: plantilla genérica del sistema anterior (sin equipos propios); la empresa define las suyas`);
      continue;
    }
    const etapa = etapas.find((x) => norma(String(x['codigo'])) === (etapaDe[norma(f['stage'])] ?? ''));
    if (!etapa) {
      pChk.omitidos.push(`${f['name']}: etapa «${f['stage']}» sin equivalente`);
      continue;
    }
    const tipoId = await asegurar(pChk, 'tipo de checklist', tiposChecklist, f['name']!, async () =>
      c.pedir<Reg>('crear tipo de checklist', 'POST', '/checklists-tipos', { codigo: f['code']!.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 20), nombre: f['name'], descripcion: texto(f['description'])?.slice(0, 250) ?? null, etapa_id: idDe(etapa), tipos_equipo_ids: suyos })
    );
    const items = t['checklist_templates']!.filter((x) => x['checklist_type_id'] === f['id'] && x['is_active'] !== '0').sort((a, b) => Number(a['display_order']) - Number(b['display_order']));
    if (simular || !tipoId || items.length === 0) continue;
    const actual = await api.llamar('GET', `/checklists-tipos/${tipoId}/plantilla`); // 404 = todavía no tiene plantilla
    if (actual.status === 200) continue; // ya tiene plantilla (corrida repetida)
    const secciones: Array<{ nombre: string; items: Array<{ descripcion: string; tipo_respuesta: string }> }> = [];
    for (const it of items) {
      const nombre = (texto(it['section']) ?? 'GENERAL').replace(/^d+.s*/, '');
      let sec = secciones.find((x) => norma(x.nombre) === norma(nombre));
      if (!sec) {
        sec = { nombre, items: [] };
        secciones.push(sec);
      }
      sec.items.push({ descripcion: (texto(it['name']) ?? '').slice(0, 250), tipo_respuesta: 'semaforo' });
    }
    await c.pedir('guardar plantilla', 'PUT', `/checklists-tipos/${tipoId}/plantilla`, { secciones });
  }

  // ── Equipos con sus medidores y lecturas ──────────────────────────────────────────
  const pEq = paso('Equipos', t['equipos']!.length);
  const pMed = paso('Medidores', t['equipo_contadores']!.length);
  const pLec = paso('Lecturas', t['ot_contadores_lecturas']!.length);
  const existentesEq: Reg[] = regs(await c.get('listar equipos', '/equipos'));
  const equipoNuevo = new Map<string, number>();
  const medidorNuevo = new Map<string, number>(); // equipo_contador viejo → contador nuevo
  for (const f of t['equipos']!) {
    const codigo = texto(f['internal_code']) ?? texto(f['plate']) ?? texto(f['vin']) ?? `EQ-${f['id']}`;
    const tipoId = tipoNuevo.get(f['tipo_equipo_codigo']!) ?? 0;
    const hallado = existentesEq.find((x) => norma(String(x['codigo_interno'] ?? '')) === norma(codigo));
    if (hallado) {
      pEq.yaExistian += 1;
      equipoNuevo.set(f['id']!, idDe(hallado));
      continue;
    }
    pEq.creados += 1;
    const mios = t['equipo_contadores']!.filter((x) => x['equipo_id'] === f['id'] && x['activo'] !== '0');
    pMed.creados += mios.length;
    if (simular) continue;
    const r = await c.pedir<{ equipo: Reg & { contadores?: Reg[] } }>('crear equipo', 'POST', '/equipos', {
      tipo_equipo_id: tipoId,
      codigo_interno: codigo,
      // Solo los vehículos llevan placa en el sistema nuevo: en los demás equipos, lo que estaba en «placa» pasa a las notas si no era ya el código interno.
      placa: f['tipo_equipo_codigo'] === 'PICK' ? texto(f['plate']) : null,
      serie: texto(f['vin']),
      marca_id: marcaNueva.get(norma(f['brand'])) ?? null,
      modelo: texto(f['model']),
      anio: num(f['year']),
      color: texto(f['color']),
      motor_marca: texto(f['engine_brand']),
      motor_modelo: texto(f['engine_model']),
      motor_serie: texto(f['engine_serial']),
      combustible: texto(f['fuel_type']) ? norma(f['fuel_type']) : null,
      capacidad_tanque: num(f['capacidad_tanque_galones']),
      cliente_id: clienteNuevo.get(f['client_id'] ?? '') ?? null,
      departamento_id: deptoNuevo.get(f['departamento_id'] ?? '') ?? null,
      propiedad: f['client_id'] ? 'cliente' : 'propio',
      notas: [texto(f['notes']), f['tipo_equipo_codigo'] !== 'PICK' && texto(f['plate']) && texto(f['plate']) !== codigo ? `PLACA ANTERIOR: ${texto(f['plate'])}` : null].filter(Boolean).join('. ') || null,
      contadores: mios.map((m) => ({ tipo_contador_id: tipoContadorNuevo(t['catalog_tipo_contador']!.find((k) => k['id'] === m['tipo_contador_id'])?.['tipo'] ?? ''), valor_inicial: num(m['valor_inicial']) ?? 0, fecha_inicio: dia(m['fecha_inicio']) })),
    });
    equipoNuevo.set(f['id']!, idDe(r.equipo));
    const creados = r.equipo.contadores ?? [];
    mios.forEach((m, i) => {
      if (creados[i]) medidorNuevo.set(m['id']!, idDe(creados[i]!));
    });
  }
  if (!simular && existentesEq.length > 0) {
    // Corrida repetida: los medidores ya existen, se buscan en la ficha de cada equipo.
    for (const f of t['equipo_contadores']!) {
      if (medidorNuevo.has(f['id']!)) continue;
      const eq = equipoNuevo.get(f['equipo_id']!);
      if (!eq) continue;
      const ficha = (await c.get('leer equipo', `/equipos/${eq}`)) as { contadores?: Reg[] };
      const tipoId = tipoContadorNuevo(t['catalog_tipo_contador']!.find((k) => k['id'] === f['tipo_contador_id'])?.['tipo'] ?? '');
      const m = (ficha.contadores ?? []).find((x) => Number(x['tipo_contador_id']) === tipoId);
      if (m) medidorNuevo.set(f['id']!, idDe(m));
    }
  }
  // Lecturas: la inicial ya nació con el medidor; las demás se registran en orden de fecha. Al final el valor actual debe ser el del sistema viejo.
  for (const f of [...t['ot_contadores_lecturas']!].sort((a, b) => (dia(a['fecha_lectura']) ?? '').localeCompare(dia(b['fecha_lectura']) ?? '') || Number(a['id']) - Number(b['id']))) {
    if (f['tipo_lectura'] === 'inicial') {
      pLec.omitidos.push(`lectura inicial #${f['id']}: ya es el valor con el que nació el medidor`);
      continue;
    }
    const m = medidorNuevo.get(f['equipo_contador_id']!);
    if (simular || !m) {
      pLec.creados += 1;
      continue;
    }
    const previas = regs(await c.get('leer lecturas', `/contadores/${m}/lecturas`));
    const ya = previas.some((x) => String(x['fecha']).slice(0, 10) === dia(f['fecha_lectura']) && Number(x['valor']) === Number(f['valor_lectura']) && x['anulada_en'] == null);
    if (ya) {
      pLec.yaExistian += 1;
      continue;
    }
    await c.pedir('registrar lectura', 'POST', `/contadores/${m}/lecturas`, { valor: Number(f['valor_lectura']), fecha: dia(f['fecha_lectura']), notas: 'TRASLADADA DEL SISTEMA ANTERIOR' });
    pLec.creados += 1;
  }
  // Operadores asignados.
  const pOpe = paso('Operadores asignados a equipos', t['operador_equipo_asignaciones']!.length);
  for (const f of t['operador_equipo_asignaciones']!) {
    if (f['activo'] === '0') {
      pOpe.omitidos.push(`asignación #${f['id']}: ya estaba terminada`);
      continue;
    }
    const eq = equipoNuevo.get(f['equipo_id']!);
    // Desde el 25-ago-2026 el «operador» de una asignación ya es el número del colaborador.
    const col = colaboradorNuevo.get(f['operador_id']!);
    if (!col && !simular) {
      pOpe.omitidos.push(`asignación #${f['id']}: no se encontró al operador entre los colaboradores`);
      continue;
    }
    if (simular || !eq) {
      pOpe.creados += 1;
      continue;
    }
    const ficha = (await c.get('leer equipo', `/equipos/${eq}`)) as { operadores?: Reg[] };
    if ((ficha.operadores ?? []).some((x) => Number(x['colaborador_id']) === col && x['hasta'] == null)) {
      pOpe.yaExistian += 1;
      continue;
    }
    await c.pedir('asignar operador', 'POST', `/equipos/${eq}/operadores`, { colaborador_id: col, desde: dia(f['fecha_asignacion']) });
    pOpe.creados += 1;
  }

  // ── Materiales (el inventario está en cero: solo el catálogo) ──────────────────────
  const pMat = paso('Materiales', t['inventory']!.length);
  const materiales = regs(await c.get('listar materiales', '/materiales?inactivos=true')).map((x) => ({ ...x, nombre: String(x['codigo'] ?? '') }));
  const unidades = regs(await c.get('listar unidades', '/catalogos/unidades'));
  const materialNuevo = new Map<string, number>();
  for (const f of t['inventory']!) {
    const parteId = parteNueva.get(f['catalog_parte_codigo'] ?? '') ?? 0;
    const unidadViejo = t['catalog_unidades']!.find((u) => norma(u['codigo']) === norma(f['unit']));
    const unidad = unidades.find((u) => norma(String(u['codigo'])) === norma(f['unit'])) ?? unidades.find((u) => norma(String(u['codigo'])) === 'UND');
    void unidadViejo;
    if (!parteId && !simular) {
      pMat.omitidos.push(`${f['part_number']}: su clasificación (${f['catalog_parte_codigo'] ?? 'ninguna'}) no se trasladó`);
      continue;
    }
    materialNuevo.set(
      f['id']!,
      await asegurar(pMat, 'material', materiales, f['part_number']!, async () =>
        c.pedir<Reg>('crear material', 'POST', '/materiales', {
          codigo: f['part_number'],
          nombre: f['name'],
          descripcion: texto(f['description']),
          parte_id: parteId,
          unidad_id: unidad ? idDe(unidad) : 1,
          codigo_oem: texto(f['oem_code']),
          marca_id: texto(f['brand']) ? (marcaNueva.get(norma(f['brand'])) ?? null) : null,
          existencia_minima: Math.round(num(f['min_quantity']) ?? 0),
          ubicacion: texto(f['location']),
          proveedor_principal_id: proveedorNuevo.get(f['proveedor_id'] ?? '') ?? null,
        })
      )
    );
  }

  // ── La orden abierta ──────────────────────────────────────────────────────────────
  const pOrd = paso('Órdenes abiertas', t['orders']!.length);
  const ordenes = regs(await c.get('listar órdenes', '/ordenes?abiertas=true'));
  for (const f of t['orders']!) {
    const eq = equipoNuevo.get(f['equipo_id']!) ?? 0;
    const descripcion = `${f['descripcion'] ?? ''} (ORDEN ${f['order_number']} DEL SISTEMA ANTERIOR)`.trim();
    const hecha = ordenes.find((x) => Number(x['equipo_id']) === eq && norma(String(x['descripcion'] ?? '')) === norma(descripcion));
    if (hecha) {
      pOrd.yaExistian += 1;
      continue;
    }
    pOrd.creados += 1;
    if (simular) continue;
    const r = await c.pedir<{ orden: Reg }>('crear orden', 'POST', '/ordenes', {
      equipo_id: eq,
      descripcion,
      prioridad: f['priority'] === 'Alta' ? 'alta' : f['priority'] === 'Baja' ? 'baja' : f['priority'] === 'Urgente' ? 'urgente' : 'media',
      notificar_nombre: texto(f['notify_contact_name']),
      notificar_correo: texto(f['notify_email']),
      notificar_telefono: texto(f['notify_phone']),
    });
    const ordenId = idDe(r.orden);
    for (const it of t['order_items']!.filter((x) => x['order_id'] === f['id'])) {
      const tr = trabajoNuevo.get(it['catalog_trabajo_codigo'] ?? '');
      if (it['tipo_item'] === 'servicio' && tr) {
        await c.pedir('crear línea', 'POST', `/ordenes/${ordenId}/lineas`, { tipo: 'servicio', trabajo_id: tr, ...(num(it['horas_estimadas']) ? { horas_trabajo: num(it['horas_estimadas']) } : {}), notas: `TRASLADADA: ${it['quantity']} ${it['description'] ?? ''} A ${it['unit_price']} C/U EN EL SISTEMA ANTERIOR`.slice(0, 480) });
      } else {
        pOrd.omitidos.push(`línea «${it['description']}»: ${it['tipo_item']} sin equivalente claro, se agrega a mano si hace falta`);
      }
    }
  }

  // ── Lo que NO se traslada (y por qué) ─────────────────────────────────────────────
  informe.noTrasladado.push(
    'El IVA de la orden abierta: el valor del trabajo es el mismo (Q800), pero el sistema nuevo suma el IVA que tenga configurado la empresa (el anterior no lo sumaba).',
    'Contraseñas y sesiones: no se pueden copiar. Cada persona recibe un enlace para crear la suya (se envía al salir, con el correo ya configurado).',
    'Permisos y roles del sistema viejo: el sistema nuevo tiene los suyos (un solo sistema de permisos); se asignan al invitar a cada persona.',
    `Movimientos de inventario (${t['inventory_movements']!.length}): el stock de todos los materiales estaba en 0; el historial queda en la copia de seguridad del sistema anterior.`,
    'Plantillas de checklist genéricas (de autos) del sistema anterior: no se trasladan; la empresa define las suyas. Las propias de sus equipos sí se trasladaron.',
    'Licencia de conducir de los operadores: se carga en la ficha del colaborador cuando la empresa defina el tipo de credencial.',
  );

  // ── Cifras de control ─────────────────────────────────────────────────────────────
  if (!simular) {
    const cuenta = (x: unknown): number => regs(x).length;
    const crudos = {
      clientes: cuenta(await c.get('control clientes', '/clientes')),
      proveedores: cuenta(await c.get('control proveedores', '/proveedores')),
      equipos: cuenta(await c.get('control equipos', '/equipos')),
      materiales: cuenta(await c.get('control materiales', '/materiales')),
      colaboradores: regs(await c.get('control colaboradores', '/colaboradores?activo=true')).length,
      ordenes: cuenta(await c.get('control órdenes', '/ordenes?abiertas=true')),
    };
    const igual = (concepto: string, origen: number, destino: number): void => {
      informe.control.push({ concepto, origen, destino, coincide: destino >= origen });
    };
    igual('Clientes', t['clients']!.length, crudos.clientes);
    igual('Proveedores', t['proveedores']!.length, crudos.proveedores);
    igual('Equipos', t['equipos']!.length, crudos.equipos);
    igual('Materiales', t['inventory']!.length - pMat.omitidos.length, crudos.materiales);
    igual('Colaboradores activos', t['colaboradores']!.filter((x) => x['status'] === 'Activo').length, crudos.colaboradores);
    igual('Órdenes abiertas', t['orders']!.length, crudos.ordenes);
    // Medidores: el valor actual de cada uno debe ser igual al del sistema viejo.
    for (const m of t['equipo_contadores']!) {
      const id = medidorNuevo.get(m['id']!);
      const eq = equipoNuevo.get(m['equipo_id']!);
      if (!id || !eq) continue;
      const ficha = (await c.get('control medidor', `/equipos/${eq}`)) as { contadores?: Reg[] };
      const nuevo = (ficha.contadores ?? []).find((x) => idDe(x) === id);
      // Un medidor de calendario cuenta los días desde su fecha de inicio (no tiene valor propio): se compara la fecha.
      if (m['unidad'] === 'DIAS') {
        const nueva = nuevo ? String(nuevo['fecha_inicio'] ?? '').slice(0, 10) : '';
        informe.control.push({ concepto: `Medidor de calendario del equipo ${m['equipo_id']} (fecha de inicio)`, origen: dia(m['fecha_inicio']) ?? '', destino: nueva, coincide: nueva === dia(m['fecha_inicio']) });
        continue;
      }
      const valor = nuevo ? Number(nuevo['valor_actual']) : NaN;
      informe.control.push({ concepto: `Medidor ${m['nombre']} del equipo ${m['equipo_id']}`, origen: Number(m['valor_actual']), destino: valor, coincide: valor === Number(m['valor_actual']) });
    }
  }
  return informe;
}

export function resumen(i: Informe): string {
  const l: string[] = [i.simulado ? 'ENSAYO (no se escribió nada)' : 'TRASLADO HECHO', ''];
  for (const p of i.pasos) l.push(`${p.entidad}: origen ${p.origen} · creados ${p.creados} · ya existían ${p.yaExistian}${p.omitidos.length ? ` · omitidos ${p.omitidos.length}` : ''}`);
  if (i.control.length) {
    l.push('', 'CONTROL DE CIFRAS');
    for (const x of i.control) l.push(`${x.coincide ? 'OK ' : 'MAL'} ${x.concepto}: origen ${x.origen} · destino ${x.destino}`);
  }
  l.push('', 'NO SE TRASLADA', ...i.noTrasladado.map((x) => `- ${x}`));
  for (const p of i.pasos) for (const o of p.omitidos) l.push(`  · ${p.entidad}: ${o}`);
  return l.join('\n');
}
