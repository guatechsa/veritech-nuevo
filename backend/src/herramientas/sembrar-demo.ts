import { Api } from './migracion-enova';

/**
 * Datos de ejemplo para el taller de DEMOSTRACIÓN (Fase 9): un taller mecánico inventado, con catálogo, clientes, vehículos con su odómetro, personal, bodega con
 * existencias y órdenes en distintos estados. Todo es ficticio (nombres, placas, teléfonos) y se crea por la API del taller, así que cumple todas sus reglas.
 * Si el taller ya tiene clientes NO se siembra nada (nunca mezcla ejemplos con datos reales).
 */
type Reg = Record<string, unknown>;
export interface ResultadoDemo {
  clientes: number;
  equipos: number;
  colaboradores: number;
  materiales: number;
  ordenes: number;
  ordenesCerradas: number;
  citas: number;
}

class Llamador {
  constructor(private readonly api: Api) {}
  async pedir<T>(que: string, metodo: 'GET' | 'POST' | 'PUT' | 'PATCH', ruta: string, cuerpo?: unknown): Promise<T> {
    const r = await this.api.llamar(metodo, ruta, cuerpo);
    if (r.status < 200 || r.status >= 300) throw new Error(`${que}: ${r.status} ${r.body.codigo ?? ''} ${r.body.error ?? ''}`.trim());
    return r.body.data as T;
  }
}
const lista = (x: unknown): Reg[] => (Array.isArray(x) ? (x as Reg[]) : Array.isArray((x as { registros?: unknown })?.registros) ? (x as { registros: Reg[] }).registros : []);
const id = (x: Reg): number => Number(x['id']);

/** El día del taller (Guatemala) más o menos `n` días, como AAAA-MM-DD. */
export const diaDelTaller = (n: number, ahora = new Date()): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Guatemala' }).format(new Date(ahora.getTime() + n * 86400000));

export async function sembrarDemo(api: Api, ahora = new Date()): Promise<ResultadoDemo> {
  const c = new Llamador(api);
  const ya = lista(await c.pedir('revisar clientes', 'GET', '/clientes'));
  if (ya.length > 0) throw new Error('Este taller ya tiene clientes: no se siembran datos de ejemplo encima de datos existentes.');

  // ── Tarifas por tipo de equipo ────────────────────────────────────────────────────
  const tipos = lista(await c.pedir('tipos de equipo', 'GET', '/tipos-equipo'));
  const vehiculo = id(tipos.find((t) => t['codigo'] === 'VEHICULO')!);
  const maquinaria = id(tipos.find((t) => t['codigo'] === 'MAQUINARIA')!);
  await c.pedir('tarifa vehículos', 'PATCH', `/tipos-equipo/${vehiculo}`, { tarifa_venta_hora: 120, costo_hora: 45 });
  await c.pedir('tarifa maquinaria', 'PATCH', `/tipos-equipo/${maquinaria}`, { tarifa_venta_hora: 180, costo_hora: 70 });
  const medidores = lista(await c.pedir('medidores', 'GET', '/tipos-contador'));
  const odometro = id(medidores.find((x) => x['nombre'] === 'ODOMETRO')!);

  // ── Catálogo técnico y trabajos con sus horas ─────────────────────────────────────
  const acciones = lista(await c.pedir('acciones', 'GET', '/catalogos/acciones'));
  const accion = (codigo: string): number => id(acciones.find((a) => a['codigo'] === codigo)!);
  const partesPorNombre = new Map<string, number>();
  const estructura: Array<[string, string, string[]]> = [
    ['MOTOR', 'LUBRICACION', ['FILTRO DE ACEITE', 'ACEITE DE MOTOR']],
    ['FRENOS', 'FRENOS DELANTEROS', ['PASTILLAS', 'DISCOS']],
    ['SUSPENSION', 'AMORTIGUACION', ['AMORTIGUADORES']],
  ];
  for (const [sistema, sub, partes] of estructura) {
    const s = await c.pedir<Reg>('sistema', 'POST', '/catalogos/sistemas', { nombre: sistema });
    const ss = await c.pedir<Reg>('subsistema', 'POST', '/catalogos/subsistemas', { sistema_id: id(s), nombre: sub });
    for (const p of partes) partesPorNombre.set(p, id(await c.pedir<Reg>('parte', 'POST', '/catalogos/partes', { subsistema_id: id(ss), nombre: p })));
  }
  const trabajos: Array<[string, string, number]> = [
    ['FILTRO DE ACEITE', 'CAM', 0.5],
    ['ACEITE DE MOTOR', 'CAM', 0.4],
    ['PASTILLAS', 'CAM', 1.2],
    ['DISCOS', 'REV', 0.8],
    ['AMORTIGUADORES', 'CAM', 1.5],
  ];
  const trabajoIds: number[] = [];
  for (const [parte, a, horas] of trabajos) {
    const t = await c.pedir<Reg>('trabajo', 'POST', '/catalogos/trabajos', { parte_id: partesPorNombre.get(parte), accion_id: accion(a) });
    await c.pedir('horas', 'PUT', `/catalogos/trabajos/${id(t)}/horas`, { horas: [{ tipo_equipo_id: vehiculo, horas }] });
    trabajoIds.push(id(t));
  }

  // ── Personal ──────────────────────────────────────────────────────────────────────
  const puestos = lista(await c.pedir('puestos', 'GET', '/puestos'));
  const puesto = (nombre: string): number => id(puestos.find((p) => p['nombre'] === nombre)!);
  const niveles = lista(await c.pedir('niveles', 'GET', '/niveles-tecnico'));
  const personal: Array<[string, string]> = [
    ['CARLOS MENDEZ (DEMO)', 'TECNICO'],
    ['ANA LOPEZ (DEMO)', 'TECNICO'],
    ['LUIS RAMIREZ (DEMO)', 'TECNICO'],
    ['MARTA GARCIA (DEMO)', 'RECEPCIONISTA'],
    ['JORGE PEREZ (DEMO)', 'BODEGUERO'],
  ];
  const tecnicos: number[] = [];
  for (const [nombre, p] of personal) {
    const r = await c.pedir<Reg>('colaborador', 'POST', '/colaboradores', { nombre_completo: nombre, puestos: [puesto(p)], ...(p === 'TECNICO' ? { nivel_tecnico_id: id(niveles[0]!) } : {}) });
    if (p === 'TECNICO') tecnicos.push(id(r));
  }

  // ── Clientes y vehículos ──────────────────────────────────────────────────────────
  const clientes = ['TRANSPORTES EL SOL, S.A. (DEMO)', 'DISTRIBUIDORA LA ESTRELLA (DEMO)', 'CONSTRUCTORA MONTE ALTO (DEMO)', 'JUAN PEREZ - PARTICULAR (DEMO)'];
  const clienteIds: number[] = [];
  for (const nombre of clientes) clienteIds.push(id((await c.pedir<{ cliente: Reg }>('cliente', 'POST', '/clientes', { nombre, telefono: '5555-0100', email: 'cliente@ejemplo.test' })).cliente));
  const vehiculos: Array<[number, string, string, number, number]> = [
    [0, 'CAM-01', 'FREIGHTLINER CASCADIA', 2021, 148200],
    [0, 'CAM-02', 'FREIGHTLINER M2', 2019, 201500],
    [1, 'REP-01', 'ISUZU NPR', 2020, 98400],
    [1, 'REP-02', 'ISUZU NPR', 2022, 41200],
    [2, 'VOL-01', 'VOLQUETA HINO 500', 2018, 187300],
    [2, 'PICK-01', 'TOYOTA HILUX', 2023, 26800],
    [3, 'P-501', 'HONDA CR-V', 2020, 74500],
    [3, 'P-502', 'MAZDA 3', 2021, 52100],
  ];
  const equipoIds: number[] = [];
  const odometroIds: number[] = [];
  for (const [cli, codigo, modelo, anio, km] of vehiculos) {
    const r = await c.pedir<{ equipo: Reg & { contadores?: Reg[] } }>('equipo', 'POST', '/equipos', {
      tipo_equipo_id: vehiculo,
      cliente_id: clienteIds[cli],
      codigo_interno: `${codigo}-DEMO`,
      placa: `DEMO${String(equipoIds.length + 1).padStart(3, '0')}`,
      modelo,
      anio,
      contadores: [{ tipo_contador_id: odometro, valor_inicial: km - 3000, fecha_inicio: diaDelTaller(-90, ahora) }],
    });
    equipoIds.push(id(r.equipo));
    const medidor = r.equipo.contadores?.[0];
    if (medidor) {
      odometroIds.push(id(medidor));
      await c.pedir('lectura', 'POST', `/contadores/${id(medidor)}/lecturas`, { valor: km, fecha: diaDelTaller(-2, ahora) });
    }
  }

  // ── Bodega con existencias ────────────────────────────────────────────────────────
  const sucursal = id(lista(await c.pedir('sucursales', 'GET', '/sucursales'))[0]!);
  const bodega = id(await c.pedir<Reg>('bodega', 'POST', '/bodegas', { nombre: 'BODEGA PRINCIPAL', sucursal_id: sucursal }));
  const prov = await c.pedir<{ proveedor?: Reg } & Reg>('proveedor', 'POST', '/proveedores', { nombre: 'REPUESTOS DEL NORTE (DEMO)' });
  const proveedor = id(prov.proveedor ?? prov);
  const unidades = lista(await c.pedir('unidades', 'GET', '/catalogos/unidades'));
  const und = id(unidades.find((u) => u['codigo'] === 'UND') ?? unidades[0]!);
  const materiales: Array<[string, string, string, number, number]> = [
    ['FIL-ACE-01', 'FILTRO DE ACEITE UNIVERSAL', 'FILTRO DE ACEITE', 40, 35],
    ['ACE-15W40', 'ACEITE 15W40 (LITRO)', 'ACEITE DE MOTOR', 200, 28],
    ['PAS-DEL-01', 'PASTILLAS DELANTERAS JUEGO', 'PASTILLAS', 24, 185],
    ['DIS-DEL-01', 'DISCO DELANTERO', 'DISCOS', 16, 320],
    ['AMO-DEL-01', 'AMORTIGUADOR DELANTERO', 'AMORTIGUADORES', 12, 410],
    ['AMO-TRA-01', 'AMORTIGUADOR TRASERO', 'AMORTIGUADORES', 12, 380],
  ];
  const lineasCompra: Array<{ material_id: number; cantidad: number; costo_unitario: number }> = [];
  for (const [codigo, nombre, parte, cantidad, costo] of materiales) {
    const m = await c.pedir<Reg>('material', 'POST', '/materiales', { codigo, nombre, parte_id: partesPorNombre.get(parte), unidad_id: und, existencia_minima: 4 });
    lineasCompra.push({ material_id: id(m), cantidad, costo_unitario: costo });
  }
  await c.pedir('compra', 'POST', '/compras', { proveedor_id: proveedor, bodega_id: bodega, fecha_documento: diaDelTaller(0, ahora), lineas: lineasCompra });

  // ── Órdenes: unas abiertas en distintos estados y otras ya cerradas ──────────────
  const op = await c.pedir<{ estados: Array<{ id: number; es_inicial: number; es_terminal: number; es_cancelado: number }> }>('opciones de orden', 'GET', '/ordenes-opciones');
  const intermedios = op.estados.filter((e) => e.es_inicial === 0 && e.es_terminal === 0);
  const cerrada = op.estados.find((e) => e.es_terminal === 1 && e.es_cancelado === 0)!;
  const nuevaOrden = async (equipo: number, descripcion: string, trabajosDeLaOrden: number[], tecnicoIdx: number): Promise<number> => {
    const r = await c.pedir<{ orden: Reg }>('orden', 'POST', '/ordenes', { equipo_id: equipo, descripcion });
    const ordenId = id(r.orden);
    for (const t of trabajosDeLaOrden) await c.pedir('línea', 'POST', `/ordenes/${ordenId}/lineas`, { tipo: 'servicio', trabajo_id: trabajoIds[t], tecnico_id: tecnicos[tecnicoIdx % tecnicos.length] });
    return ordenId;
  };
  let cerradas = 0;
  // Tres ya entregadas (con todos sus trabajos terminados).
  const entregadas: Array<[number, string, number[]]> = [
    [0, 'CAMBIO DE ACEITE Y FILTRO', [0, 1]],
    [2, 'CAMBIO DE PASTILLAS DELANTERAS', [2]],
    [6, 'REVISION DE FRENOS Y DISCOS', [3]],
  ];
  for (const [i, desc, ts] of entregadas) {
    const o = await nuevaOrden(equipoIds[i]!, desc, ts, i);
    const ficha = await c.pedir<{ lineas: Reg[] }>('ficha', 'GET', `/ordenes/${o}`);
    for (const l of ficha.lineas) {
      await c.pedir('iniciar', 'POST', `/lineas/${id(l)}/estado`, { estado: 'en_proceso' });
      await c.pedir('terminar', 'POST', `/lineas/${id(l)}/estado`, { estado: 'terminado' });
    }
    await c.pedir('cerrar', 'POST', `/ordenes/${o}/estado`, { estado_id: cerrada.id });
    cerradas += 1;
  }
  // Tres en proceso y dos recién recibidas.
  const abiertas: Array<[number, string, number[], boolean]> = [
    [1, 'CAMBIO DE AMORTIGUADORES DELANTEROS', [4], true],
    [4, 'SERVICIO DE 200.000 KM', [0, 1, 3], true],
    [5, 'RUIDO EN FRENOS AL FRENAR', [3], true],
    [3, 'CAMBIO DE ACEITE', [0, 1], false],
    [7, 'REVISION GENERAL ANTES DE VIAJE', [3], false],
  ];
  let enProcesoN = 0;
  for (const [i, desc, ts, enProceso] of abiertas) {
    // Un técnico solo puede tener UN trabajo en proceso: cada orden en proceso va con un técnico distinto.
    const o = await nuevaOrden(equipoIds[i]!, desc, ts, enProceso ? enProcesoN++ : 0);
    if (enProceso) {
      if (intermedios[0]) await c.pedir('estado', 'POST', `/ordenes/${o}/estado`, { estado_id: intermedios[0].id });
      const ficha = await c.pedir<{ lineas: Reg[] }>('ficha', 'GET', `/ordenes/${o}`);
      if (ficha.lineas[0]) await c.pedir('iniciar', 'POST', `/lineas/${id(ficha.lineas[0])}/estado`, { estado: 'en_proceso' });
    }
  }

  // ── Citas de los próximos días ────────────────────────────────────────────────────
  const citas: Array<[number, number, string]> = [
    [6, 1, '08:00'],
    [7, 1, '10:30'],
    [0, 2, '09:00'],
  ];
  for (const [i, dias, hora] of citas) await c.pedir('cita', 'POST', '/citas', { equipo_id: equipoIds[i], fecha: diaDelTaller(dias, ahora), hora });

  return { clientes: clienteIds.length, equipos: equipoIds.length, colaboradores: personal.length, materiales: materiales.length, ordenes: entregadas.length + abiertas.length, ordenesCerradas: cerradas, citas: citas.length };
}
