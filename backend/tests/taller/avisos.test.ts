import { filas } from '../../src/db/consulta';
import { emitirAviso } from '../../src/taller/avisos';
import { barrerAvisos, revisarAvisosDeTaller } from '../../src/taller/avisos-barrido';
import { poolsDe } from '../../src/taller/contexto';
import { buscarEmpresa } from '../../src/taller/resolutor';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { dia, mundo as mundoDeOrdenes, Mundo as MundoOrdenes, nueva, ordenId } from './ayuda-ordenes';

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
interface Aviso {
  codigo: string;
  activo: boolean;
  roles: number[];
  usuarios: number[];
  correos: string[];
  umbral_dias: number | null;
  incluir_contextual: boolean;
  enviados: number;
}
interface Registro {
  total: number;
  filas: Array<{ tipo_aviso: string; clave?: string; estado: string; destinatarios: number; asunto: string; nombre: string }>;
}

const hoy = (): string => dia(0);
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

const correos = (tipo?: string) => filas<{ tipo: string; destinatarios: string; asunto: string; cuerpo: string }>(e.pool, `SELECT tipo, destinatarios, asunto, cuerpo FROM correos_salida WHERE tipo LIKE 'aviso\\_%' ${tipo ? 'AND tipo = ?' : ''} ORDER BY id`, tipo ? [`aviso_${tipo}`] : []);
const lista = async (m: Mundo): Promise<Aviso[]> => (await m.api.get('/avisos')).body.data.avisos as Aviso[];
const aviso = async (m: Mundo, codigo: string): Promise<Aviso> => (await lista(m)).find((a) => a.codigo === codigo)!;
const configurar = (m: Mundo, codigo: string, cuerpo: Record<string, unknown>) => m.api.put(`/avisos/${codigo}`).send(cuerpo);
const registro = async (m: Mundo, tipo?: string): Promise<Registro> => (await m.api.get(`/avisos-registro${tipo ? `?tipo=${tipo}` : ''}`)).body.data as Registro;
const rolId = async (m: Mundo, codigo: string): Promise<number> => ((await m.api.get('/roles')).body.data as Array<{ id: number; codigo: string }>).find((r) => r.codigo === codigo)!.id;
const sql = (m: Mundo, consulta: string, params: unknown[] = []) => m.t.sql(async (c) => (await c.query(consulta, params))[0] as Array<Record<string, unknown>>);

/** La revisión periódica de UN taller, como la haría el servidor. */
async function revisar(m: Mundo) {
  const empresa = (await buscarEmpresa(e.ctx, m.t.slug))!;
  return revisarAvisosDeTaller(e.ctx, { empresa, pool: poolsDe(e.ctx).obtener(empresa.nombreBd) });
}
const treq = async (m: Mundo) => {
  const empresa = (await buscarEmpresa(e.ctx, m.t.slug))!;
  return { empresa, pool: poolsDe(e.ctx).obtener(empresa.nombreBd) };
};

describe('configuración de los avisos', () => {
  it('el taller nace con los 13 avisos, solo 6 encendidos y destinatarios por rol; el registro nace vacío', async () => {
    const m = await mundo();
    const todos = await lista(m);
    expect(todos.map((a) => a.codigo).sort()).toEqual(
      ['cita_solicitada', 'cotizacion_por_vencer', 'cotizacion_respondida', 'documento_por_vencer', 'enlace_primera_apertura', 'material_pendiente_cargado', 'recordatorio_cita', 'reserva_por_vencer', 'resumen_diario', 'resumen_semanal', 'servicio_proximo', 'servicio_vencido', 'solicitud_material_nueva'].sort()
    );
    expect(todos.filter((a) => a.activo).map((a) => a.codigo).sort()).toEqual(['cita_solicitada', 'cotizacion_respondida', 'material_pendiente_cargado', 'servicio_proximo', 'servicio_vencido', 'solicitud_material_nueva']);
    const bodeguero = await rolId(m, 'bodeguero');
    expect((await aviso(m, 'solicitud_material_nueva')).roles).toEqual([bodeguero]);
    expect((await aviso(m, 'recordatorio_cita')).umbral_dias).toBe(1);
    expect((await registro(m)).total).toBe(0);
  });

  it('solo quien tiene el permiso cambia los avisos; cualquiera con «configuración» los ve; queda en la bitácora', async () => {
    const m = await mundo();
    const sup = (await m.t.usuario('supervisor')).token;
    const supApi = m.t.api(await sup());
    const cuerpo = { activo: true, incluir_contextual: false, roles: [await rolId(m, 'gerente')], usuarios: [], correos: [] };
    expect((await configurar({ ...m, api: supApi } as Mundo, 'reserva_por_vencer', cuerpo)).status).toBe(403);
    // Con «ver configuración» (pero sin el permiso de avisos) los ve, pero no los cambia ni manda pruebas.
    await sql(m, "INSERT INTO rol_permisos (rol_id, permiso_codigo) SELECT id, 'configuracion.ver' FROM roles WHERE codigo = 'supervisor'");
    const supApi2 = m.t.api(await sup());
    expect((await supApi2.get('/avisos')).status).toBe(200);
    expect((await configurar({ ...m, api: supApi2 } as Mundo, 'reserva_por_vencer', cuerpo)).status).toBe(403);
    expect((await supApi2.post('/avisos/reserva_por_vencer/prueba').send({})).status).toBe(403);
    const r = await configurar(m, 'reserva_por_vencer', cuerpo);
    expect(r.status).toBe(200);
    expect((await aviso(m, 'reserva_por_vencer')).activo).toBe(true);
    expect(await sql(m, "SELECT accion FROM bitacora WHERE accion = 'aviso_configurado'")).toHaveLength(1);
  });

  it('se rechaza lo que no sirve: encender sin a quién avisar, marcas desconocidas, correos mal escritos, días donde no aplican, roles que no existen', async () => {
    const m = await mundo();
    const base = { activo: true, incluir_contextual: false, roles: [], usuarios: [], correos: [] };
    expect((await configurar(m, 'resumen_diario', base)).status).toBe(400); // sin destinatarios
    const ok = { ...base, correos: ['jefe@taller.test'] };
    expect((await configurar(m, 'resumen_diario', { ...ok, cuerpo: 'Hola {nombre_inventado}' })).status).toBe(400);
    expect((await configurar(m, 'resumen_diario', { ...ok, asunto: 'Resumen {taller} {resumenes}' })).status).toBe(400);
    expect((await configurar(m, 'resumen_diario', { ...ok, correos: ['esto no es un correo'] })).status).toBe(400);
    expect((await configurar(m, 'resumen_diario', { ...ok, umbral_dias: 3 })).status).toBe(400); // no usa días
    expect((await configurar(m, 'resumen_diario', { ...ok, roles: [99999] })).status).toBe(400);
    expect((await configurar(m, 'no_existe', ok)).status).toBe(404);
    // Un aviso con persona del hecho sí puede encenderse solo con ella.
    expect((await configurar(m, 'cotizacion_por_vencer', { ...base, incluir_contextual: true, umbral_dias: 3 })).status).toBe(200);
    expect((await aviso(m, 'cotizacion_por_vencer')).umbral_dias).toBe(3);
    expect((await configurar(m, 'resumen_diario', { ...ok, cuerpo: 'Hola {taller}: {resumen}' })).status).toBe(200); // marcas válidas
  });

  it('un aviso que falla nunca lanza: devuelve «error» (y un aviso apagado devuelve «apagado»)', async () => {
    const m = await mundo();
    const t = await treq(m);
    expect(await emitirAviso(e.ctx, t, { tipo: 'no_existe', clave: 'x', datos: {} })).toBe('error');
    expect(await emitirAviso(e.ctx, t, { tipo: 'resumen_diario', clave: 'x', datos: {} })).toBe('apagado');
  });
});

describe('avisos que salen en el momento del hecho', () => {
  it('solicitud de material nueva: le llega a los del rol elegido, una sola vez por solicitud, con sus datos escapados y su constancia', async () => {
    const m = await mundo();
    const bodeguero = await m.t.usuario('bodeguero', 'bodega1@taller.test');
    await m.t.usuario('bodeguero', 'bodega2@taller.test', { activo: false }); // desactivado: no recibe
    const r = await m.api.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.material, cantidad: 2 }] });
    expect(r.status).toBe(201);
    const c = await correos('solicitud_material_nueva');
    expect(c).toHaveLength(1);
    expect(c[0]!.destinatarios).toBe(bodeguero.correo);
    expect(c[0]!.asunto).toContain(r.body.data.numero);
    expect(c[0]!.cuerpo).toContain('Materiales distintos: 1');
    expect(c[0]!.cuerpo).toContain('Abrir en VERI-TECH');
    const reg = await registro(m, 'solicitud_material_nueva');
    expect(reg.total).toBe(1);
    expect(reg.filas[0]).toMatchObject({ estado: 'encolado', destinatarios: 1, nombre: 'Solicitud de material nueva' });
    // El mismo hecho no se vuelve a avisar aunque se emita otra vez.
    expect(await emitirAviso(e.ctx, await treq(m), { tipo: 'solicitud_material_nueva', clave: `sol:${r.body.data.id}`, datos: {} })).toBe('repetido');
    expect(await correos('solicitud_material_nueva')).toHaveLength(1);
  });

  it('apagado no avisa; sin destinatarios queda la constancia «sin destinatarios»; un texto propio reemplaza el incluido con sus marcas', async () => {
    const m = await mundo();
    const bodeguero = await rolId(m, 'bodeguero');
    const base = { activo: false, incluir_contextual: true, roles: [bodeguero], usuarios: [], correos: [] };
    expect((await configurar(m, 'solicitud_material_nueva', base)).status).toBe(200);
    expect((await m.api.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.material, cantidad: 1 }] })).status).toBe(201);
    expect(await correos()).toHaveLength(0);
    expect((await registro(m)).total).toBe(0);

    // Encendido, pero el rol no tiene a nadie: queda la constancia de que no hubo a quién avisar.
    expect((await configurar(m, 'solicitud_material_nueva', { ...base, activo: true })).status).toBe(200);
    const s2 = await m.api.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.material, cantidad: 1 }] });
    expect(await correos()).toHaveLength(0);
    expect((await registro(m)).filas[0]).toMatchObject({ estado: 'sin_destinatarios', destinatarios: 0 });

    // Con una persona y texto propio.
    await m.t.usuario('bodeguero', 'bodega@taller.test');
    expect((await configurar(m, 'solicitud_material_nueva', { ...base, activo: true, asunto: 'Pidieron {solicitud}', cuerpo: 'Revise {solicitud} de <b>{solicitante}</b>' })).status).toBe(200);
    const s3 = await m.api.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.material, cantidad: 1 }] });
    const c = await correos('solicitud_material_nueva');
    expect(c).toHaveLength(1);
    expect(c[0]!.asunto).toBe(`Pidieron ${s3.body.data.numero}`);
    expect(c[0]!.cuerpo).toContain(`Revise ${s3.body.data.numero} de &lt;b&gt;`); // lo escrito por personas se escapa
    expect(c[0]!.cuerpo).not.toContain('<b>');
    expect(s2.body.data.numero).not.toBe(s3.body.data.numero);
  });

  it('cotización respondida: le llega a quien cotizó y al rol elegido solo cuando TODAS las líneas tienen respuesta; sin «persona del hecho» solo al rol', async () => {
    const m = await mundo();
    const recepcion = await m.t.usuario('recepcionista', 'recepcion@taller.test');
    const c = (await m.api.post('/cotizaciones').send({ orden_id: m.orden })).body.data as { id: number };
    expect((await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).status).toBe(201);
    expect((await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'tercero', proveedor_id: m.proveedor, descripcion: 'rectificado', cantidad: 1, precio_unitario: 300, costo: 120 })).status).toBe(201);
    const enviada = (await m.api.post(`/cotizaciones/${c.id}/enviar`).send({})).body.data as { lineas: Array<{ id: number }> };
    const motivo = ((await m.api.get('/cotizaciones-opciones')).body.data as { motivos_rechazo: Array<{ id: number }> }).motivos_rechazo[0]!.id;
    expect((await m.api.post(`/cotizacion-lineas/${enviada.lineas[0]!.id}/responder`).send({ decision: 'autorizada' })).status).toBe(200);
    expect(await correos('cotizacion_respondida')).toHaveLength(0); // falta una línea
    expect((await m.api.post(`/cotizacion-lineas/${enviada.lineas[1]!.id}/responder`).send({ decision: 'rechazada', motivo_id: motivo })).status).toBe(200);
    const enviados = await correos('cotizacion_respondida');
    expect(enviados).toHaveLength(1);
    expect(enviados[0]!.destinatarios.split(',').sort()).toEqual([m.t.adminCorreo.toLowerCase(), recepcion.correo].sort());
    expect(enviados[0]!.cuerpo).toContain('Líneas autorizadas: 1');
    expect(enviados[0]!.cuerpo).toContain('Líneas rechazadas: 1');
  });

  it('primera apertura del enlace: avisa a quien lo creó solo la primera vez real; las vistas previas automáticas no cuentan', async () => {
    const m = await mundo();
    expect((await configurar(m, 'enlace_primera_apertura', { activo: true, incluir_contextual: true, roles: [], usuarios: [], correos: [] })).status).toBe(200);
    const c = (await m.api.post('/cotizaciones').send({ orden_id: m.orden })).body.data as { id: number };
    expect((await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).status).toBe(201);
    expect((await m.api.post(`/cotizaciones/${c.id}/enviar`).send({})).status).toBe(200);
    const url = (await m.api.post(`/cotizaciones/${c.id}/enlace`).send({})).body.data.url as string;
    const token = /cotizacion\/([0-9a-f]{64})$/.exec(url)![1]!;
    const ver = (agente: string) => m.t.api().get(`/publico/cotizacion/${token}`).set('User-Agent', agente);
    expect((await ver('WhatsApp/2.23 A')).status).toBe(200);
    expect(await correos('enlace_primera_apertura')).toHaveLength(0);
    expect((await ver('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).status).toBe(200);
    expect(await correos('enlace_primera_apertura')).toHaveLength(1);
    expect((await ver('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)')).status).toBe(200);
    expect(await correos('enlace_primera_apertura')).toHaveLength(1);
    expect((await correos('enlace_primera_apertura'))[0]!.destinatarios).toBe(m.t.adminCorreo.toLowerCase());
  });

  it('la persona del hecho solo recibe el aviso si el taller lo dejó así; si no, solo los elegidos', async () => {
    const m = await mundo();
    expect((await configurar(m, 'enlace_primera_apertura', { activo: true, incluir_contextual: false, roles: [], usuarios: [], correos: ['Jefe@Taller.test'] })).status).toBe(200);
    const c = (await m.api.post('/cotizaciones').send({ orden_id: m.orden })).body.data as { id: number };
    expect((await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).status).toBe(201);
    expect((await m.api.post(`/cotizaciones/${c.id}/enviar`).send({})).status).toBe(200);
    const token = /cotizacion\/([0-9a-f]{64})$/.exec((await m.api.post(`/cotizaciones/${c.id}/enlace`).send({})).body.data.url as string)![1]!;
    expect((await m.t.api().get(`/publico/cotizacion/${token}`).set('User-Agent', 'Mozilla/5.0 (iPhone)')).status).toBe(200);
    expect((await correos('enlace_primera_apertura'))[0]!.destinatarios).toBe('jefe@taller.test'); // en minúsculas, sin quien creó el enlace
  });

  it('repuesto cargado a una orden de MATERIAL PENDIENTE: avisa al cliente cada vez que llega más; una orden normal no avisa', async () => {
    const m = await mundo();
    await sql(m, 'UPDATE clientes SET email = ? WHERE id = ?', ['cliente@lopez.test', m.cliente]);
    const normal = await m.api.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.material, cantidad: 2 }] });
    const lineaNormal = (await m.api.get(`/solicitudes/${normal.body.data.id}`)).body.data.lineas[0].id as number;
    expect((await m.api.post(`/solicitudes/${normal.body.data.id}/despachar`).send({ items: [{ linea_id: lineaNormal, bodega_id: m.bodega, cantidad: 2 }] })).status).toBe(200);
    expect(await correos('material_pendiente_cargado')).toHaveLength(0);

    const pedido = ordenId(await nueva(m, { tipo_orden_id: m.tipos['MPE'] }));
    const s = await m.api.post('/solicitudes').send({ orden_id: pedido, lineas: [{ material_id: m.material, cantidad: 4 }] });
    expect(s.status).toBe(201);
    const linea = (await m.api.get(`/solicitudes/${s.body.data.id}`)).body.data.lineas[0].id as number;
    expect((await m.api.post(`/solicitudes/${s.body.data.id}/despachar`).send({ items: [{ linea_id: linea, bodega_id: m.bodega, cantidad: 3 }] })).status).toBe(200);
    expect((await m.api.post(`/solicitudes/${s.body.data.id}/despachar`).send({ items: [{ linea_id: linea, bodega_id: m.bodega, cantidad: 1 }] })).status).toBe(200);
    const c = await correos('material_pendiente_cargado');
    expect(c).toHaveLength(2);
    expect(c[0]!.destinatarios).toBe('cliente@lopez.test');
    expect(c[0]!.cuerpo).toContain('3 x ACEITE 15W40');
    expect(c[1]!.cuerpo).toContain('4 x ACEITE 15W40');
    expect(c[0]!.cuerpo).not.toContain('Abrir en VERI-TECH'); // al cliente no se le da un botón al sistema
  });
});

describe('la revisión periódica', () => {
  async function programa(m: Mundo) {
    const odo = ((await m.api.get('/tipos-contador')).body.data as Array<{ id: number; nombre: string }>).find((x) => x.nombre === 'ODOMETRO')!.id;
    const r = await m.api.post('/servicios-programas').send({ tipo_equipo_id: m.tipoVehiculo, trabajo_id: m.trabajo, tipo_contador_id: odo, intervalo: 10000, aviso_proximo: 1000, aviso_urgente: 200, nombre: 'servicio de 10000 km' });
    expect(r.status).toBe(201);
  }
  const lectura = (m: Mundo, valor: number) => m.api.post(`/contadores/${m.odometro}/lecturas`).send({ valor, fecha: hoy() });

  it('servicios: avisa al supervisor y al gerente cuando el estado EMPEORA (próximo, luego vencido), nunca dos veces lo mismo', async () => {
    const m = await mundo();
    const sup = await m.t.usuario('supervisor', 'sup@taller.test');
    const ger = await m.t.usuario('gerente', 'ger@taller.test');
    await programa(m);
    expect(await revisar(m)).toEqual({});
    await lectura(m, 10200);
    expect(await revisar(m)).toEqual({ servicio_proximo: 1 });
    expect(await revisar(m)).toEqual({}); // sin cambios
    const c1 = await correos('servicio_proximo');
    expect(c1).toHaveLength(1);
    expect(c1[0]!.destinatarios.split(',').sort()).toEqual([ger.correo, sup.correo].sort());
    await lectura(m, 11100);
    expect(await revisar(m)).toEqual({ servicio_vencido: 1 });
    const c2 = await correos('servicio_vencido');
    expect(c2).toHaveLength(1);
    expect(c2[0]!.asunto).toContain('VENCIDO');
    expect(c2[0]!.cuerpo).toContain('pasado por 100 KM');
  });

  it('cita de mañana: el recordatorio llega al correo del cliente y no se repite; una cita lejana o cancelada no avisa', async () => {
    const m = await mundo();
    await sql(m, 'UPDATE clientes SET email = ? WHERE id = ?', ['cliente@lopez.test', m.cliente]);
    expect((await configurar(m, 'recordatorio_cita', { activo: true, incluir_contextual: true, roles: [], usuarios: [], correos: [], umbral_dias: 1 })).status).toBe(200);
    const manana = dia(1);
    const c1 = await m.api.post('/citas').send({ equipo_id: m.equipo, fecha: manana, hora: '09:30' });
    expect(c1.status).toBe(201);
    const c2 = await m.api.post('/citas').send({ equipo_id: m.equipo, fecha: dia(5), hora: '09:30' });
    expect(c2.status).toBe(201);
    const c3 = await m.api.post('/citas').send({ equipo_id: m.equipo, fecha: manana, hora: '11:00' });
    expect(c3.status).toBe(201);
    await sql(m, "UPDATE citas SET estado = 'cancelada' WHERE id = ?", [c3.body.data.cita.id]);
    expect(await revisar(m)).toEqual({ recordatorio_cita: 1 });
    expect(await revisar(m)).toEqual({});
    const c = await correos('recordatorio_cita');
    expect(c).toHaveLength(1);
    expect(c[0]!.destinatarios).toBe('cliente@lopez.test');
    expect(c[0]!.cuerpo).toContain(`${manana.slice(8, 10)}/${manana.slice(5, 7)}/${manana.slice(0, 4)}`);
    expect(c[0]!.cuerpo).toContain('09:30');
  });

  it('cotizaciones, documentos y reservas por vencer avisan a su tiempo; si se amplía la fecha, avisan de nuevo', async () => {
    const m = await mundo();
    await m.t.usuario('gerente', 'ger@taller.test');
    for (const [tipo, extra] of [
      ['cotizacion_por_vencer', { umbral_dias: 2 }],
      ['documento_por_vencer', { umbral_dias: null }],
      ['reserva_por_vencer', { umbral_dias: 1 }],
    ] as const) {
      expect((await configurar(m, tipo, { activo: true, incluir_contextual: true, roles: [await rolId(m, 'gerente')], usuarios: [], correos: [], ...extra })).status).toBe(200);
    }
    // Cotización enviada que vence en 2 días (y otra que vence en 10).
    const cot = async (vence: string) => {
      const c = (await m.api.post('/cotizaciones').send({ orden_id: m.orden })).body.data as { id: number };
      expect((await m.api.post(`/cotizaciones/${c.id}/lineas`).send({ tipo: 'servicio', trabajo_id: m.trabajo })).status).toBe(201);
      expect((await m.api.post(`/cotizaciones/${c.id}/enviar`).send({ vence_en: vence })).status).toBe(200);
    };
    await cot(dia(2));
    await cot(dia(10));
    // Un documento del equipo que vence en 20 días (el seguro avisa con 30) y una tarjeta que vence en 90.
    await sql(m, "INSERT INTO equipo_documentos (equipo_id, tipo_documento_id, vence) SELECT ?, id, DATE_ADD(?, INTERVAL 20 DAY) FROM tipos_documento WHERE nombre = 'SEGURO'", [m.equipo, hoy()]);
    await sql(m, "INSERT INTO equipo_documentos (equipo_id, tipo_documento_id, vence) SELECT ?, id, DATE_ADD(?, INTERVAL 90 DAY) FROM tipos_documento WHERE nombre = 'TARJETA DE CIRCULACION'", [m.equipo, hoy()]);
    await sql(m, "INSERT INTO equipo_documentos (equipo_id, tipo_documento_id, vence) SELECT ?, id, DATE_SUB(?, INTERVAL 5 DAY) FROM tipos_documento WHERE nombre = 'GARANTIA'", [m.equipo, hoy()]); // ya venció: eso lo ve el taller en el equipo
    // Una reserva que vence mañana y otra en 30 días.
    await sql(m, "INSERT INTO reservas (numero, orden_id, estado, vence_en, creada_por_id) VALUES ('RES-9001', ?, 'activa', ?, (SELECT MIN(id) FROM usuarios)), ('RES-9002', ?, 'activa', DATE_ADD(?, INTERVAL 30 DAY), (SELECT MIN(id) FROM usuarios))", [m.orden, dia(1), m.orden, hoy()]);

    expect(await revisar(m)).toEqual({ cotizacion_por_vencer: 1, documento_por_vencer: 1, reserva_por_vencer: 1 });
    expect(await revisar(m)).toEqual({});
    expect((await correos('reserva_por_vencer'))[0]!.cuerpo).toContain('RES-9001');
    expect((await correos('documento_por_vencer'))[0]!.cuerpo).toContain('SEGURO');
    // Ampliar la reserva cambia su fecha: es otro hecho y se avisa de nuevo cuando se acerque.
    await sql(m, "UPDATE reservas SET vence_en = ? WHERE numero = 'RES-9001'", [hoy()]);
    expect(await revisar(m)).toEqual({ reserva_por_vencer: 1 });
  });

  it('resumen diario: sale una vez por día y solo a partir de las 7:00 del taller; el semanal solo los lunes', async () => {
    const m = await mundo();
    for (const tipo of ['resumen_diario', 'resumen_semanal']) {
      expect((await configurar(m, tipo, { activo: true, incluir_contextual: false, roles: [], usuarios: [], correos: ['jefe@taller.test'] })).status).toBe(200);
    }
    // Un lunes a las 06:30 del taller (12:30 UTC): todavía no.
    const lunes = '2026-11-16';
    expect(new Date(`${lunes}T00:00:00Z`).getUTCDay()).toBe(1);
    e.reloj.fijo = new Date(`${lunes}T12:30:00Z`);
    expect(await revisar(m)).toEqual({});
    e.reloj.fijo = new Date(`${lunes}T13:30:00Z`); // 07:30 del taller
    expect(await revisar(m)).toEqual({ resumen_diario: 1, resumen_semanal: 1 });
    expect(await revisar(m)).toEqual({});
    const d = await correos('resumen_diario');
    expect(d).toHaveLength(1);
    expect(d[0]!.destinatarios).toBe('jefe@taller.test');
    expect(d[0]!.cuerpo).toContain('16/11/2026');
    expect(d[0]!.cuerpo).toContain('Órdenes abiertas: 1');
    // El martes solo el diario.
    e.reloj.fijo = new Date('2026-11-17T14:00:00Z');
    expect(await revisar(m)).toEqual({ resumen_diario: 1 });
  });

  it('barrerAvisos recorre los talleres que trabajan y no se detiene por uno con problemas', async () => {
    const m = await mundo();
    const otro = await mundo();
    await m.t.usuario('supervisor', 'sup@taller.test');
    await programa(m);
    await lectura(m, 10200);
    await sql(otro, 'RENAME TABLE avisos_config TO avisos_config_perdida'); // un taller con la base dañada
    const r = await barrerAvisos(e.ctx);
    expect(r.talleres).toBeGreaterThanOrEqual(2);
    expect(r.avisos).toBe(1);
    expect(await correos('servicio_proximo')).toHaveLength(1);
  });
});

describe('probar y consultar', () => {
  it('«enviarme una prueba» manda un correo de ejemplo a quien lo pide, con los textos vigentes, sin contar como aviso', async () => {
    const m = await mundo();
    expect((await configurar(m, 'solicitud_material_nueva', { activo: true, incluir_contextual: true, roles: [await rolId(m, 'bodeguero')], usuarios: [], correos: [], asunto: 'Pidieron {solicitud}' })).status).toBe(200);
    const r = await m.api.post('/avisos/solicitud_material_nueva/prueba').send({});
    expect(r.status).toBe(200);
    expect(r.body.data.enviado_a.toLowerCase()).toBe(m.t.adminCorreo.toLowerCase());
    const c = await correos('prueba');
    expect(c).toHaveLength(1);
    expect(c[0]!.asunto).toBe('PRUEBA: Pidieron SOL-000003');
    expect(c[0]!.cuerpo).toContain('correo de prueba');
    expect((await registro(m)).total).toBe(0);
    const sup = m.t.api(await (await m.t.usuario('supervisor')).token());
    expect((await sup.post('/avisos/solicitud_material_nueva/prueba').send({})).status).toBe(403);
  });

  it('el registro se pagina, se filtra por aviso y nombra cada tipo', async () => {
    const m = await mundo();
    await m.t.usuario('bodeguero', 'bodega@taller.test');
    for (let i = 0; i < 3; i++) expect((await m.api.post('/solicitudes').send({ orden_id: m.orden, lineas: [{ material_id: m.material, cantidad: 1 }] })).status).toBe(201);
    const pag = (await m.api.get('/avisos-registro?tipo=solicitud_material_nueva&porPagina=2&pagina=2')).body.data as Registro;
    expect(pag.total).toBe(3);
    expect(pag.filas).toHaveLength(1);
    expect((await registro(m, 'servicio_vencido')).total).toBe(0);
  });
});
