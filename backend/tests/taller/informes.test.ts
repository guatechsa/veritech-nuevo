import { filas } from '../../src/db/consulta';
import { ExcelJS } from '../../src/taller/datos/libro';
import { poolsDe } from '../../src/taller/contexto';
import { revisarAvisosDeTaller } from '../../src/taller/avisos-barrido';
import { tocaEnviar } from '../../src/taller/reportes-guardados';
import { buscarEmpresa } from '../../src/taller/resolutor';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { dia, mundo as mundoDeOrdenes, Mundo as MundoOrdenes, nueva, ordenId } from './ayuda-ordenes';

process.env['PDF_SIN_COMPRIMIR'] = '1'; // para poder buscar texto dentro de los PDF de prueba

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
  e.reloj.fijo = null;
});

interface Mundo extends MundoOrdenes {
  bodega: number;
  material: number;
  orden: number;
}
type Api = MundoOrdenes['api'];
interface Grupo {
  codigo: string;
  titulo: string;
  resultados: Array<{ id: number; titulo: string; detalle: string | null; ruta: string }>;
}
interface Reporte {
  codigo: string;
  titulo: string;
  desde: string;
  hasta: string;
  filtros: string[];
  secciones: Array<{ titulo: string; columnas: Array<{ clave: string; tipo: string }>; filas: Array<Record<string, string | number | null>>; total?: Record<string, string | number | null> }>;
  notas: string[];
}

const hoy = (): string => dia(0);

/** Un taller con cliente «Industrias Lopez», un vehículo CAM-1 / C123ABC, una bodega con 20 unidades de aceite compradas a costo 10 y una orden abierta. */
async function mundo(): Promise<Mundo> {
  const base = await mundoDeOrdenes(e);
  const sucursal = ((await base.api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id;
  const bodega = (await base.api.post('/bodegas').send({ nombre: 'Bodega principal', sucursal_id: sucursal })).body.data.id as number;
  const op = (await base.api.get('/inventario-opciones')).body.data as { unidades: Array<{ id: number; codigo: string }>; partes: Array<{ id: number; clasificacion: string }> };
  const parte = op.partes.find((p) => p.clasificacion.startsWith('99-'))!.id;
  const unidad = op.unidades.find((u) => u.codigo === 'UND')!.id;
  const material = (await base.api.post('/materiales').send({ codigo: 'ACE-15W40', nombre: 'Aceite 15W40', parte_id: parte, unidad_id: unidad })).body.data.id as number;
  expect((await base.api.post('/compras').send({ proveedor_id: base.proveedor, bodega_id: bodega, fecha_documento: hoy(), lineas: [{ material_id: material, cantidad: 20, costo_unitario: 10 }] })).status).toBe(201);
  const orden = ordenId(await nueva(base));
  return { ...base, bodega, material, orden };
}

const buscar = async (api: Api, q: string): Promise<{ q: string; demasiado_corta: boolean; grupos: Grupo[] }> => {
  const r = await api.get(`/buscar?q=${encodeURIComponent(q)}`);
  expect(r.status).toBe(200);
  return r.body.data as { q: string; demasiado_corta: boolean; grupos: Grupo[] };
};
const codigos = (r: { grupos: Grupo[] }): string[] => r.grupos.map((g) => g.codigo);
const reporte = async (api: Api, codigo: string, consulta = 'periodo=este_mes'): Promise<Reporte> => {
  const r = await api.get(`/reporte/${codigo}?${consulta}`);
  expect(r.status).toBe(200);
  return r.body.data as Reporte;
};
const binario = async (api: Api, url: string) => {
  const r = await api.get(url).buffer(true).parse((res, cb) => {
    const trozos: Buffer[] = [];
    res.on('data', (c: Buffer) => trozos.push(c));
    res.on('end', () => cb(null, Buffer.concat(trozos)));
  });
  return { status: r.status, tipo: String(r.headers['content-type']), disposicion: String(r.headers['content-disposition']), cuerpo: r.body as Buffer };
};
const textoDe = (b: Buffer): string =>
  [...b.toString('latin1').matchAll(/\[(.*?)\]\s*TJ/g)]
    .map((m) => [...m[1]!.matchAll(/<([0-9a-fA-F]+)>/g)].map((h) => Buffer.from(h[1]!, 'hex').toString('latin1')).join(''))
    .join('\n');
const sql = (m: Mundo, consulta: string, params: unknown[] = []) => m.t.sql(async (c) => (await c.query(consulta, params))[0] as Array<Record<string, unknown>>);
const correos = (tipo: string) => filas<{ destinatarios: string; asunto: string; cuerpo: string }>(e.pool, 'SELECT destinatarios, asunto, cuerpo FROM correos_salida WHERE tipo = ? ORDER BY id', [tipo]);
const rolId = async (m: Mundo, codigo: string): Promise<number> => ((await m.api.get('/roles')).body.data as Array<{ id: number; codigo: string }>).find((r) => r.codigo === codigo)!.id;
async function revisar(m: Mundo) {
  const empresa = (await buscarEmpresa(e.ctx, m.t.slug))!;
  return revisarAvisosDeTaller(e.ctx, { empresa, pool: poolsDe(e.ctx).obtener(empresa.nombreBd) });
}

describe('búsqueda global', () => {
  it('busca en equipos, clientes y órdenes por varios campos, sin importar mayúsculas ni tildes; varias palabras deben aparecer todas', async () => {
    const m = await mundo();
    const r = await buscar(m.api, 'lópez');
    expect(codigos(r)).toEqual(expect.arrayContaining(['clientes', 'equipos', 'ordenes']));
    expect(r.grupos.find((g) => g.codigo === 'clientes')!.resultados[0]).toMatchObject({ titulo: 'INDUSTRIAS LOPEZ', ruta: '/clientes?tab=clientes&buscar=INDUSTRIAS%20LOPEZ' });
    const equipo = (await buscar(m.api, 'c123')).grupos.find((g) => g.codigo === 'equipos')!.resultados[0]!;
    expect(equipo).toMatchObject({ titulo: 'CAM-1 · C123ABC', ruta: `/equipos?equipo=${m.equipo}` });
    const orden = (await buscar(m.api, 'cam-1')).grupos.find((g) => g.codigo === 'ordenes')!.resultados[0]!;
    expect(orden.ruta).toBe(`/ordenes?orden=${m.orden}`);
    expect(codigos(await buscar(m.api, 'cam lopez'))).toContain('equipos'); // dos palabras, en campos distintos
    expect(codigos(await buscar(m.api, 'cam zzzz'))).toEqual([]); // una de las dos no aparece
    const mat = (await buscar(m.api, 'aceite 15w')).grupos.find((g) => g.codigo === 'materiales')!.resultados[0]!;
    expect(mat).toMatchObject({ titulo: 'ACE-15W40 · ACEITE 15W40', ruta: `/inventario?tab=materiales&material=${m.material}` });
    expect(codigos(await buscar(m.api, m.t.adminCorreo.slice(0, 6)))).toContain('colaboradores');
  });

  it('con menos de 2 letras no busca; los comodines % y _ se tratan como letras comunes', async () => {
    const m = await mundo();
    expect(await buscar(m.api, 'a')).toMatchObject({ demasiado_corta: true, grupos: [] });
    expect(await buscar(m.api, '   ')).toMatchObject({ demasiado_corta: true, grupos: [] });
    expect(codigos(await buscar(m.api, '%%'))).toEqual([]); // no es «todo»
    expect(codigos(await buscar(m.api, '__'))).toEqual([]);
    expect(codigos(await buscar(m.api, 'ca_1'))).toEqual([]); // el guion bajo no es comodín (CAM-1 no coincide con «ca_1»)
  });

  it('muestra solo los grupos que la persona puede ver', async () => {
    const m = await mundo();
    const visual = m.t.api(await (await m.t.usuario('visualizador', 'visual2@taller.test')).token());
    expect(codigos(await buscar(m.api, 'persona'))).toContain('colaboradores');
    const r = await buscar(visual, 'persona');
    expect(codigos(r)).not.toContain('colaboradores'); // no tiene «ver colaboradores»
    expect(codigos(await buscar(visual, 'lopez'))).toEqual(expect.arrayContaining(['clientes', 'equipos'])); // lo demás sí
    expect((await m.t.api().get('/buscar?q=lopez')).status).toBe(401); // sin sesión no hay búsqueda
  });
});

describe('reportes', () => {
  it('el catálogo depende de los permisos y «compras» exige reportes financieros', async () => {
    const m = await mundo();
    const lista = async (api: Api) => ((await api.get('/reporte-catalogo')).body.data as Array<{ codigo: string; exportable: boolean }>);
    expect((await lista(m.api)).map((r) => r.codigo)).toEqual(['indicadores', 'rechazos', 'carga', 'compras']);
    const sup = m.t.api(await (await m.t.usuario('supervisor')).token());
    const delSup = await lista(sup);
    expect(delSup.map((r) => r.codigo)).toEqual(['indicadores', 'rechazos', 'carga']);
    expect(delSup.every((r) => r.exportable)).toBe(true);
    expect((await sup.get('/reporte/compras?periodo=este_mes')).status).toBe(400);
    const visual = m.t.api(await (await m.t.usuario('visualizador')).token());
    expect((await visual.get('/reporte/indicadores?periodo=este_mes')).status).toBe(200);
    expect((await visual.get('/reporte-catalogo')).body.data.every((r: { exportable: boolean }) => r.exportable === false)).toBe(true);
    expect((await visual.get('/reporte/indicadores/exportar?periodo=este_mes&formato=xlsx')).status).toBe(403);
    expect((await m.api.get('/reporte/no_existe?periodo=este_mes')).status).toBe(400);
    // Sin dinero: el reporte de indicadores no trae los de dinero.
    const sinDinero = await reporte(sup, 'indicadores');
    expect(sinDinero.secciones[0]!.filas.map((f) => f['indicador'])).not.toContain('Ticket promedio');
    expect((await reporte(m.api, 'indicadores')).secciones[0]!.filas.map((f) => f['indicador'])).toContain('Ticket promedio');
  });

  it('los periodos relativos se resuelven con el día del taller; uno personalizado necesita fechas válidas', async () => {
    const m = await mundo();
    e.reloj.fijo = new Date('2026-11-13T15:00:00Z'); // 09:00 en el taller
    const api = m.t.api(await m.t.token());
    const periodo = async (p: string) => {
      const r = await reporte(api, 'indicadores', `periodo=${p}`);
      return [r.desde, r.hasta];
    };
    expect(await periodo('este_mes')).toEqual(['2026-11-01', '2026-11-13']);
    expect(await periodo('mes_anterior')).toEqual(['2026-10-01', '2026-10-31']);
    expect(await periodo('ultimos_7')).toEqual(['2026-11-07', '2026-11-13']);
    expect(await periodo('ultimos_30')).toEqual(['2026-10-15', '2026-11-13']);
    expect(await periodo('hoy')).toEqual(['2026-11-13', '2026-11-13']);
    expect(await periodo('personalizado&desde=2026-01-05&hasta=2026-01-20')).toEqual(['2026-01-05', '2026-01-20']);
    expect((await api.get('/reporte/indicadores?periodo=personalizado')).status).toBe(400);
    expect((await api.get('/reporte/indicadores?periodo=personalizado&desde=2026-02-30&hasta=2026-03-01')).status).toBe(400);
    expect((await api.get('/reporte/indicadores?periodo=personalizado&desde=2026-03-05&hasta=2026-03-01')).status).toBe(400);
    expect((await api.get('/reporte/indicadores?periodo=siempre')).status).toBe(400);
  });

  it('compras: total por proveedor y los materiales más comprados con su costo promedio, por la fecha del documento y la sucursal', async () => {
    const m = await mundo();
    const r = await reporte(m.api, 'compras');
    const [proveedores, materiales] = r.secciones;
    expect(proveedores!.filas).toEqual([expect.objectContaining({ documentos: 1, total: 200 })]);
    expect(proveedores!.total).toMatchObject({ documentos: 1, total: 200 });
    expect(materiales!.filas).toEqual([expect.objectContaining({ codigo: 'ACE-15W40', cantidad: 20, monto: 200, promedio: 10 })]);
    // Otra compra más cara del mismo material cambia el promedio ponderado.
    expect((await m.api.post('/compras').send({ proveedor_id: m.proveedor, bodega_id: m.bodega, fecha_documento: hoy(), lineas: [{ material_id: m.material, cantidad: 20, costo_unitario: 20 }] })).status).toBe(201);
    const r2 = await reporte(m.api, 'compras');
    expect(r2.secciones[1]!.filas[0]).toMatchObject({ cantidad: 40, monto: 600, promedio: 15 });
    // Fuera del periodo no cuenta; otra sucursal tampoco.
    expect((await reporte(m.api, 'compras', 'periodo=personalizado&desde=2020-01-01&hasta=2020-01-31')).secciones[0]!.filas).toEqual([]);
    expect(r.notas.join(' ')).toContain('tipo de equipo no aplica');
  });

  it('carga de trabajo: lo que hizo cada técnico, lo pendiente hoy por técnico y por área, y las citas de la semana', async () => {
    const m = await mundo();
    const tecnico = await m.t.usuario('tecnico');
    const t0 = new Date(`${dia(0)}T16:00:00Z`); // 10:00 del taller
    e.reloj.fijo = t0;
    const api = m.t.api(await m.t.token());
    const l1 = (await api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo, tecnico_id: tecnico.colaboradorId })).body.data.lineas[0].id as number;
    expect((await api.post(`/lineas/${l1}/estado`).send({ estado: 'en_proceso' })).status).toBe(200);
    // Otro trabajo sin técnico que queda pendiente.
    expect((await api.post(`/ordenes/${m.orden}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).status).toBe(201);
    // Una cita de mañana de 1,5 horas.
    expect((await api.post('/citas').send({ equipo_id: m.equipo, fecha: dia(1), hora: '09:00', horas_estimadas: 1.5 })).status).toBe(201);
    e.reloj.fijo = new Date(t0.getTime() + 3 * 3600000);
    const api3 = m.t.api(await m.t.token());
    expect((await api3.post(`/lineas/${l1}/estado`).send({ estado: 'terminado' })).status).toBe(200);

    const r = await reporte(api3, 'carga', `periodo=personalizado&desde=${dia(0)}&hasta=${dia(0)}`);
    const [porTecnico, pendTec, pendArea, citas] = r.secciones;
    expect(porTecnico!.filas).toEqual([expect.objectContaining({ tecnico: 'PERSONA TECNICO', terminados: 1, vendidas: 2, trabajadas: 3 })]);
    expect(porTecnico!.total).toMatchObject({ terminados: 1, vendidas: 2, trabajadas: 3 });
    expect(pendTec!.filas).toEqual([expect.objectContaining({ nombre: 'SIN TECNICO ASIGNADO', trabajos: 1, horas: 2 })]);
    expect(pendArea!.filas[0]).toMatchObject({ trabajos: 1 });
    expect(citas!.filas).toHaveLength(7);
    expect(citas!.filas[1]).toMatchObject({ citas: 1, horas: 1.5 });
    expect(citas!.filas[0]).toMatchObject({ citas: 0, horas: 0 });
    // Otro periodo: sin trabajo realizado, pero los pendientes de hoy siguen (no dependen del periodo).
    const antes = await reporte(api3, 'carga', 'periodo=personalizado&desde=2020-01-01&hasta=2020-01-31');
    expect(antes.secciones[0]!.filas).toEqual([expect.objectContaining({ terminados: 0, vendidas: 0, trabajadas: 0 })]);
    expect(antes.secciones[1]!.filas).toHaveLength(1);
  });
});

describe('exportar a Excel y PDF', () => {
  it('Excel: lleva el nombre del reporte, la empresa, el periodo y cuándo se emitió, con cifras como números con formato', async () => {
    const m = await mundo();
    e.reloj.fijo = new Date('2026-11-13T15:30:00Z'); // 09:30 del taller
    const api = m.t.api(await m.t.token());
    const r = await binario(api, '/reporte/compras/exportar?periodo=personalizado&desde=2026-11-01&hasta=2026-11-30&formato=xlsx');
    expect(r.status).toBe(200);
    expect(r.tipo).toContain('spreadsheetml');
    expect(r.disposicion).toContain('compras-2026-11-01-a-2026-11-30.xlsx');
    const libro = new ExcelJS.Workbook();
    await libro.xlsx.load(r.cuerpo as unknown as ArrayBuffer);
    expect(libro.worksheets.map((h) => h.name)).toEqual(['Compras por proveedor', 'Materiales más comprados (los 2']);
    const hoja = libro.worksheets[0]!;
    expect(hoja.getCell('A1').value).toBe('Compras de material');
    expect(String(hoja.getCell('A2').value)).not.toBe('');
    expect(hoja.getCell('A3').value).toBe('Periodo: 01/11/2026 al 30/11/2026');
    expect(String(hoja.getCell('A5').value)).toMatch(/^Emitido: 13\/11\/2026 09:30 por /);
    // La tabla: encabezado en la fila 8; la cifra es un número (no texto) y lleva formato de moneda.
    expect(hoja.getCell('A8').value).toBe('Proveedor');
    expect(typeof hoja.getCell('C9').value).toBe('number');
    expect(hoja.getCell('C9').numFmt).toContain('#,##0.00');
    expect(hoja.getCell('A10').value).toBe('Total'); // la fila de totales
    expect(hoja.pageSetup.orientation).toBe('landscape');
    expect(hoja.pageSetup.fitToWidth).toBe(1);
  });

  it('PDF: es un PDF válido con el nombre del reporte, la empresa y la fecha y hora de emisión, y no lleva folio', async () => {
    const m = await mundo();
    e.reloj.fijo = new Date('2026-11-13T15:30:00Z');
    const api = m.t.api(await m.t.token());
    const r = await binario(api, '/reporte/carga/exportar?periodo=este_mes&formato=pdf');
    expect(r.status).toBe(200);
    expect(r.tipo).toContain('application/pdf');
    expect(r.cuerpo.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const t = textoDe(r.cuerpo);
    expect(t).toContain('Carga de trabajo');
    expect(t).toContain('Emitido 13/11/2026 09:30');
    expect(t).toContain('Periodo');
    expect(t).not.toContain('Folio');
    expect((await binario(api, '/reporte/carga/exportar?periodo=este_mes&formato=docx')).status).toBe(400);
    // Queda constancia de quién descargó qué.
    expect(await sql(m, "SELECT accion FROM bitacora WHERE accion = 'reporte_exportado'")).toHaveLength(1);
  });

  it('exportar exige el permiso de exportar y el de dinero para los reportes de dinero', async () => {
    const m = await mundo();
    const sup = m.t.api(await (await m.t.usuario('supervisor')).token());
    expect((await sup.get('/reporte/carga/exportar?periodo=este_mes&formato=xlsx')).status).toBe(200);
    expect((await sup.get('/reporte/compras/exportar?periodo=este_mes&formato=xlsx')).status).toBe(400);
    const bodega = m.t.api(await (await m.t.usuario('bodeguero')).token());
    expect((await bodega.get('/reporte/carga/exportar?periodo=este_mes&formato=xlsx')).status).toBe(403); // ve reportes pero no exporta
  });
});

describe('vistas guardadas', () => {
  it('cada persona guarda las suyas: nombre único por reporte, con periodo relativo; nadie ve ni borra las ajenas', async () => {
    const m = await mundo();
    const sup = await m.t.usuario('supervisor');
    const apiSup = m.t.api(await sup.token());
    const filtros = { periodo: 'ultimos_30', sucursal_id: ((await m.api.get('/sucursales')).body.data as Array<{ id: number }>)[0]!.id };
    const c = await m.api.post('/vistas').send({ reporte: 'carga', nombre: 'Último mes central', filtros });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ nombre: 'ULTIMO MES CENTRAL', filtros });
    expect((await m.api.post('/vistas').send({ reporte: 'carga', nombre: 'ultimo mes central', filtros })).status).toBe(409);
    expect((await m.api.post('/vistas').send({ reporte: 'indicadores', nombre: 'ultimo mes central', filtros })).status).toBe(201); // otro reporte: sí
    expect((await m.api.post('/vistas').send({ reporte: 'no_existe', nombre: 'x', filtros })).status).toBe(400);
    expect((await m.api.post('/vistas').send({ reporte: 'carga', nombre: 'rango fijo', filtros: { periodo: 'personalizado', desde: '2026-02-30', hasta: '2026-03-01' } })).status).toBe(400);
    expect((await m.api.post('/vistas').send({ reporte: 'carga', nombre: 'x', filtros })).status).toBe(400); // nombre muy corto
    expect(((await m.api.get('/vistas?reporte=carga')).body.data as unknown[]).length).toBe(1);
    expect(((await m.api.get('/vistas')).body.data as unknown[]).length).toBe(2);
    expect((await apiSup.get('/vistas')).body.data).toEqual([]); // no ve las de otra persona
    expect((await apiSup.delete(`/vistas/${c.body.data.id}`)).status).toBe(404); // ni borrarlas
    expect((await m.api.delete(`/vistas/${c.body.data.id}`)).status).toBe(200);
    expect(((await m.api.get('/vistas?reporte=carga')).body.data as unknown[]).length).toBe(0);
  });

  it('hay un tope de 30 vistas por persona', async () => {
    const m = await mundo();
    for (let i = 0; i < 30; i++) expect((await m.api.post('/vistas').send({ reporte: 'carga', nombre: `vista ${i + 10}`, filtros: { periodo: 'este_mes' } })).status).toBe(201);
    expect((await m.api.post('/vistas').send({ reporte: 'carga', nombre: 'vista de mas', filtros: { periodo: 'este_mes' } })).status).toBe(400);
  });
});

describe('envíos programados', () => {
  const cuerpo = (_m: Mundo, extra: Record<string, unknown> = {}) => ({
    nombre: 'Resumen semanal para gerencia',
    reporte: 'carga',
    filtros: { periodo: 'ultimos_7' },
    frecuencia: 'semanal',
    dia_semana: 1,
    activo: true,
    roles: [] as number[],
    usuarios: [] as number[],
    correos: ['jefe@taller.test'],
    ...extra,
  });

  it('solo quien tiene «programar» los maneja; se validan frecuencia, día, destinatarios y periodo móvil', async () => {
    const m = await mundo();
    const sup = m.t.api(await (await m.t.usuario('supervisor')).token());
    expect((await sup.get('/reportes-programados')).status).toBe(403);
    expect((await sup.post('/reportes-programados').send(cuerpo(m))).status).toBe(403);
    expect((await m.api.post('/reportes-programados').send(cuerpo(m, { filtros: { periodo: 'personalizado', desde: '2026-01-01', hasta: '2026-01-31' } }))).status).toBe(400); // rango fijo
    expect((await m.api.post('/reportes-programados').send(cuerpo(m, { correos: [] }))).status).toBe(400); // sin destinatarios
    expect((await m.api.post('/reportes-programados').send(cuerpo(m, { correos: ['no es correo'] }))).status).toBe(400);
    expect((await m.api.post('/reportes-programados').send(cuerpo(m, { dia_semana: null }))).status).toBe(400); // semanal sin día
    expect((await m.api.post('/reportes-programados').send(cuerpo(m, { frecuencia: 'mensual', dia_semana: null, dia_mes: 31 }))).status).toBe(400); // el día del mes llega hasta el 28
    expect((await m.api.post('/reportes-programados').send(cuerpo(m, { roles: [99999] }))).status).toBe(400);
    expect((await m.api.post('/reportes-programados').send(cuerpo(m, { reporte: 'no_existe' }))).status).toBe(400);
    const ok = await m.api.post('/reportes-programados').send(cuerpo(m));
    expect(ok.status).toBe(201);
    const lista = (await m.api.get('/reportes-programados')).body.data as { programados: Array<{ id: number; nombre: string; correos: string[]; con_dinero: boolean }> };
    expect(lista.programados).toEqual([expect.objectContaining({ nombre: 'RESUMEN SEMANAL PARA GERENCIA', correos: ['jefe@taller.test'], con_dinero: true })]);
    expect(await sql(m, "SELECT accion FROM bitacora WHERE accion = 'envio_programado_creado'")).toHaveLength(1);
  });

  it('un reporte de dinero solo lo programa quien ve dinero', async () => {
    const m = await mundo();
    // Un rol con «programar» pero sin dinero: se le da el permiso a mano al supervisor.
    await sql(m, "INSERT INTO rol_permisos (rol_id, permiso_codigo) SELECT id, 'reportes.programar' FROM roles WHERE codigo = 'supervisor'");
    const sup = m.t.api(await (await m.t.usuario('supervisor')).token());
    expect((await sup.post('/reportes-programados').send(cuerpo(m, { reporte: 'compras' }))).status).toBe(400);
    const ok = await sup.post('/reportes-programados').send(cuerpo(m, { reporte: 'carga' }));
    expect(ok.status).toBe(201);
    expect((await m.api.get('/reportes-programados')).body.data.programados[0].con_dinero).toBe(false);
  });

  it('sale a su día, a partir de las 7:00 del taller, una sola vez, a los destinatarios elegidos, con el reporte dentro del correo', async () => {
    const m = await mundo();
    const gerente = await m.t.usuario('gerente', 'gerente@taller.test');
    const tecnico = await m.t.usuario('tecnico', 'tecnico@taller.test');
    await sql(m, 'UPDATE colaboradores SET nombre_completo = ? WHERE id = ?', ['<B>JUAN</B> & CIA', tecnico.colaboradorId]); // un nombre con código: no debe entrar al correo como código
    expect((await m.api.post('/reportes-programados').send(cuerpo(m, { roles: [await rolId(m, 'gerente')], correos: ['jefe@taller.test'] }))).status).toBe(201);
    const lunes = '2026-11-16';
    e.reloj.fijo = new Date(`${lunes}T12:30:00Z`); // 06:30: todavía no
    expect(await revisar(m)).toEqual({});
    e.reloj.fijo = new Date(`${lunes}T13:30:00Z`); // 07:30
    expect(await revisar(m)).toEqual({ reporte_programado: 1 });
    expect(await revisar(m)).toEqual({}); // una vez por día
    const c = await correos('reporte_programado');
    expect(c).toHaveLength(1);
    expect(c[0]!.destinatarios.split(',').sort()).toEqual(['gerente@taller.test', 'jefe@taller.test']);
    expect(c[0]!.asunto).toBe('Carga de trabajo · RESUMEN SEMANAL PARA GERENCIA');
    expect(c[0]!.cuerpo).toContain('Trabajo realizado por técnico');
    expect(c[0]!.cuerpo).toContain('&lt;B&gt;JUAN&lt;/B&gt; &amp; CIA');
    expect(c[0]!.cuerpo).not.toContain('<B>JUAN');
    expect(c[0]!.cuerpo).toContain('Periodo: 10/11/2026 al 16/11/2026'); // últimos 7 días contados desde el lunes de envío
    expect(c[0]!.cuerpo).toContain('Emitido 16/11/2026 07:30');
    expect(gerente.correo).toBeTruthy();
    // El martes no toca; el lunes siguiente sí.
    e.reloj.fijo = new Date('2026-11-17T14:00:00Z');
    expect(await revisar(m)).toEqual({});
    e.reloj.fijo = new Date('2026-11-23T14:00:00Z');
    expect(await revisar(m)).toEqual({ reporte_programado: 1 });
    expect(await correos('reporte_programado')).toHaveLength(2);
    // Queda en el registro de avisos y marca su último envío.
    const reg = await sql(m, "SELECT tipo_aviso, referencia FROM avisos_registro WHERE tipo_aviso = 'reporte_programado'");
    expect(reg).toHaveLength(2);
    expect((await sql(m, 'SELECT ultimo_envio_en FROM reportes_programados'))[0]!['ultimo_envio_en']).not.toBeNull();
  });

  it('apagado no sale; si quien lo programó ya no tiene acceso tampoco; uno mensual sale el día elegido', async () => {
    const m = await mundo();
    const creador = await m.t.usuario('gerente', 'gerente@taller.test');
    const apiCreador = m.t.api(await creador.token());
    expect((await apiCreador.post('/reportes-programados').send(cuerpo(m, { nombre: 'del gerente', frecuencia: 'mensual', dia_semana: null, dia_mes: 16 }))).status).toBe(201);
    expect((await m.api.post('/reportes-programados').send(cuerpo(m, { nombre: 'apagado', activo: false, frecuencia: 'diaria', dia_semana: null }))).status).toBe(201);
    e.reloj.fijo = new Date('2026-11-16T14:00:00Z'); // día 16, 08:00
    expect(await revisar(m)).toEqual({ reporte_programado: 1 }); // solo el mensual; el apagado no
    expect((await correos('reporte_programado'))[0]!.asunto).toContain('DEL GERENTE');
    // El creador deja de tener acceso: su envío ya no sale (el del mes siguiente).
    await sql(m, 'UPDATE usuarios SET activo = 0 WHERE id = ?', [creador.id]);
    e.reloj.fijo = new Date('2026-12-16T14:00:00Z');
    expect(await revisar(m)).toEqual({});
  });

  it('«enviarme una prueba» manda el reporte solo a quien lo pide y no cuenta como envío del día; se edita y se elimina', async () => {
    const m = await mundo();
    const id = (await m.api.post('/reportes-programados').send(cuerpo(m))).body.data.id as number;
    const r = await m.api.post(`/reportes-programados/${id}/probar`).send({});
    expect(r.status).toBe(200);
    expect(r.body.data.enviado_a.toLowerCase()).toBe(m.t.adminCorreo.toLowerCase());
    const c = await correos('reporte_prueba');
    expect(c).toHaveLength(1);
    expect(c[0]!.asunto.startsWith('PRUEBA: ')).toBe(true);
    expect((await sql(m, 'SELECT ultimo_envio_en FROM reportes_programados'))[0]!['ultimo_envio_en']).toBeNull();
    const cambio = await m.api.put(`/reportes-programados/${id}`).send(cuerpo(m, { nombre: 'otro nombre', frecuencia: 'diaria', dia_semana: null }));
    expect(cambio.status).toBe(200);
    expect((await m.api.get('/reportes-programados')).body.data.programados[0]).toMatchObject({ nombre: 'OTRO NOMBRE', frecuencia: 'diaria', dia_semana: null });
    expect((await m.api.delete(`/reportes-programados/${id}`)).status).toBe(200);
    expect((await m.api.delete(`/reportes-programados/${id}`)).status).toBe(404);
    expect(await sql(m, 'SELECT id FROM reportes_programados_destinatarios')).toHaveLength(0); // los destinatarios se van con el envío
  });

  it('cuándo toca: diaria siempre; semanal por día de la semana (domingo = 7); mensual por día del mes', () => {
    expect(tocaEnviar({ frecuencia: 'diaria', dia_semana: null, dia_mes: null }, '2026-11-14')).toBe(true);
    expect(tocaEnviar({ frecuencia: 'semanal', dia_semana: 1, dia_mes: null }, '2026-11-16')).toBe(true); // lunes
    expect(tocaEnviar({ frecuencia: 'semanal', dia_semana: 1, dia_mes: null }, '2026-11-17')).toBe(false);
    expect(tocaEnviar({ frecuencia: 'semanal', dia_semana: 7, dia_mes: null }, '2026-11-15')).toBe(true); // domingo
    expect(tocaEnviar({ frecuencia: 'semanal', dia_semana: 6, dia_mes: null }, '2026-11-14')).toBe(true); // sábado
    expect(tocaEnviar({ frecuencia: 'mensual', dia_semana: null, dia_mes: 28 }, '2026-02-28')).toBe(true);
    expect(tocaEnviar({ frecuencia: 'mensual', dia_semana: null, dia_mes: 5 }, '2026-11-06')).toBe(false);
  });
});
