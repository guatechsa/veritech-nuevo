import { ejecutar } from '../../src/db/consulta';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { tallerDePrueba, TallerDePrueba } from './ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});

async function admin(t: TallerDePrueba) {
  return t.api(await t.token());
}
type Api = Awaited<ReturnType<typeof admin>>;

/** Sistema → subsistema → parte, listos para crear trabajos. */
async function jerarquia(api: Api, nombres = { s: 'Motor', x: 'Lubricacion', p: 'Filtro de aceite' }) {
  const s = (await api.post('/catalogos/sistemas').send({ nombre: nombres.s })).body.data;
  const x = (await api.post('/catalogos/subsistemas').send({ sistema_id: s.id, nombre: nombres.x })).body.data;
  const p = (await api.post('/catalogos/partes').send({ subsistema_id: x.id, nombre: nombres.p })).body.data;
  return { s, x, p };
}
const accionId = async (api: Api, codigo: string): Promise<number> => (await api.get('/catalogos/acciones')).body.data.find((a: { codigo: string }) => a.codigo === codigo).id as number;

describe('jerarquía técnica: sistemas, subsistemas y partes', () => {
  it('viene con los sistemas de fábrica y los códigos nuevos se numeran solos', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const de_fabrica = (await api.get('/catalogos/sistemas')).body.data;
    expect(de_fabrica.map((s: { codigo: string; nombre: string }) => `${s.codigo} ${s.nombre}`)).toEqual(['00 SERVICIOS PROGRAMADOS', '99 INSUMOS GENERALES']);
    expect(de_fabrica[0]).toMatchObject({ es_servicios_programados: 1, es_insumos_generales: 0 });
    expect(de_fabrica[1]).toMatchObject({ es_servicios_programados: 0, es_insumos_generales: 1 });
    const a = (await api.post('/catalogos/sistemas').send({ nombre: 'Motor' })).body.data;
    const b = (await api.post('/catalogos/sistemas').send({ nombre: 'Frenos' })).body.data;
    expect([a.codigo, b.codigo]).toEqual(['01', '02']);
    expect(a.nombre).toBe('MOTOR');
    expect((await api.post('/catalogos/sistemas').send({ nombre: 'motor' })).status).toBe(409);
  });

  it('solo puede haber un grupo de insumos generales', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    expect((await api.post('/catalogos/sistemas').send({ nombre: 'Otros insumos', es_insumos_generales: true })).status).toBe(409);
    const s = (await api.post('/catalogos/sistemas').send({ nombre: 'Normal' })).body.data;
    expect((await api.patch(`/catalogos/sistemas/${s.id}`).send({ es_insumos_generales: true })).status).toBe(409);
  });

  it('subsistemas y partes: código de 2 dígitos propio de su padre, nombre único dentro del padre', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { s, x, p } = await jerarquia(api);
    expect(x.codigo).toBe('01');
    expect(p.codigo).toBe('01');
    const x2 = (await api.post('/catalogos/subsistemas').send({ sistema_id: s.id, nombre: 'Enfriamiento' })).body.data;
    expect(x2.codigo).toBe('02');
    expect((await api.post('/catalogos/subsistemas').send({ sistema_id: s.id, nombre: 'enfriamiento' })).status).toBe(409);
    // El mismo nombre en OTRO sistema sí se puede.
    const otro = (await api.post('/catalogos/sistemas').send({ nombre: 'Transmision' })).body.data;
    expect((await api.post('/catalogos/subsistemas').send({ sistema_id: otro.id, nombre: 'Enfriamiento' })).status).toBe(201);
    const partes = (await api.get(`/catalogos/partes?subsistema_id=${x.id}`)).body.data;
    expect(partes[0]).toMatchObject({ codigo_completo: '01-01-01', sistema: 'MOTOR', subsistema: 'LUBRICACION' });
    expect((await api.get('/catalogos/subsistemas')).body.data.find((q: { id: number }) => q.id === x.id).codigo_completo).toBe('01-01');
  });

  it('los códigos liberados se reutilizan: siempre el menor libre', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = (await api.post('/catalogos/sistemas').send({ nombre: 'Uno' })).body.data;
    await api.post('/catalogos/sistemas').send({ nombre: 'Dos' });
    await ejecutar(e.pool, 'SELECT 1');
    await t.sql((con) => con.query('DELETE FROM matriz_tecnico_sistema WHERE sistema_id = ?', [a.id]));
    await t.sql((con) => con.query('DELETE FROM sistemas WHERE id = ?', [a.id]));
    expect((await api.post('/catalogos/sistemas').send({ nombre: 'Tres' })).body.data.codigo).toBe('01');
  });

  it('un padre no se desactiva mientras tenga hijos activos, y un hijo no se activa si su padre está apagado', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { s, x, p } = await jerarquia(api);
    const r1 = await api.patch(`/catalogos/sistemas/${s.id}`).send({ activo: false });
    expect(r1.status).toBe(409);
    expect(r1.body.error).toContain('subsistemas activos');
    expect((await api.patch(`/catalogos/subsistemas/${x.id}`).send({ activo: false })).status).toBe(409);
    await api.patch(`/catalogos/partes/${p.id}`).send({ activo: false }).expect(200);
    await api.patch(`/catalogos/subsistemas/${x.id}`).send({ activo: false }).expect(200);
    await api.patch(`/catalogos/sistemas/${s.id}`).send({ activo: false }).expect(200);
    expect((await api.patch(`/catalogos/subsistemas/${x.id}`).send({ activo: true })).status).toBe(409); // su sistema está apagado
    await api.patch(`/catalogos/sistemas/${s.id}`).send({ activo: true }).expect(200);
    await api.patch(`/catalogos/subsistemas/${x.id}`).send({ activo: true }).expect(200);
    expect((await api.post('/catalogos/partes').send({ subsistema_id: 99999, nombre: 'X' })).status).toBe(400);
  });
});

describe('trabajos', () => {
  it('el código y el nombre se arman solos: sistema-subsistema-parte-acción-correlativo', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { p } = await jerarquia(api);
    const cam = await accionId(api, 'CAM');
    const rev = await accionId(api, 'REV');
    const a = (await api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: cam })).body.data;
    expect(a).toMatchObject({ codigo: '01-01-01-CAM-01', nombre: 'CAMBIAR - FILTRO DE ACEITE - LUBRICACION', sistema: 'MOTOR' });
    const b = (await api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: cam, variante: 'Sintetico' })).body.data;
    expect(b).toMatchObject({ codigo: '01-01-01-CAM-02', nombre: 'CAMBIAR - FILTRO DE ACEITE - LUBRICACION (SINTETICO)', variante: 'SINTETICO' });
    const c = (await api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: rev })).body.data;
    expect(c.codigo).toBe('01-01-01-REV-01'); // otra acción, su propio correlativo
  });

  it('dos trabajos creados a la vez nunca comparten correlativo', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { p } = await jerarquia(api);
    const cam = await accionId(api, 'CAM');
    const r = await Promise.all([1, 2, 3, 4].map((i) => api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: cam, variante: `V${i}` })));
    const codigos = r.filter((x) => x.status === 201).map((x) => x.body.data.codigo as string);
    expect(new Set(codigos).size).toBe(codigos.length);
    expect(codigos.length).toBeGreaterThan(0);
  });

  it('si se renombra la parte, el subsistema o la acción, los nombres de sus trabajos se rearman', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { x, p } = await jerarquia(api);
    const cam = await accionId(api, 'CAM');
    const tr = (await api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: cam, variante: 'Grande' })).body.data;
    await api.patch(`/catalogos/partes/${p.id}`).send({ nombre: 'Filtro principal' }).expect(200);
    expect((await api.get(`/catalogos/trabajos?parte_id=${p.id}`)).body.data.registros[0].nombre).toBe('CAMBIAR - FILTRO PRINCIPAL - LUBRICACION (GRANDE)');
    await api.patch(`/catalogos/subsistemas/${x.id}`).send({ nombre: 'Aceite' }).expect(200);
    await api.patch(`/catalogos/acciones/${cam}`).send({ nombre: 'Sustituir' }).expect(200);
    expect((await api.get(`/catalogos/trabajos?parte_id=${p.id}`)).body.data.registros[0].nombre).toBe('SUSTITUIR - FILTRO PRINCIPAL - ACEITE (GRANDE)');
    // La variante también se puede cambiar; el código no.
    const ed = await api.patch(`/catalogos/trabajos/${tr.id}`).send({ variante: 'Chico' });
    expect(ed.body.data).toMatchObject({ codigo: '01-01-01-CAM-01', nombre: 'SUSTITUIR - FILTRO PRINCIPAL - ACEITE (CHICO)' });
  });

  it('busca por nombre o código, filtra por jerarquía y pagina', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { s, p } = await jerarquia(api);
    const cam = await accionId(api, 'CAM');
    const rev = await accionId(api, 'REV');
    await api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: cam });
    await api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: rev });
    const otro = await jerarquia(api, { s: 'Frenos', x: 'Hidraulico', p: 'Pastillas' });
    await api.post('/catalogos/trabajos').send({ parte_id: otro.p.id, accion_id: cam });
    expect((await api.get('/catalogos/trabajos')).body.data.total).toBe(3);
    expect((await api.get(`/catalogos/trabajos?sistema_id=${s.id}`)).body.data.total).toBe(2);
    expect((await api.get(`/catalogos/trabajos?accion_id=${cam}`)).body.data.total).toBe(2);
    expect((await api.get('/catalogos/trabajos?buscar=pastillas')).body.data.total).toBe(1);
    expect((await api.get('/catalogos/trabajos?buscar=REV-01')).body.data.total).toBe(1);
    expect((await api.get('/catalogos/trabajos?pagina=2')).body.data.registros).toHaveLength(0);
  });

  it('el área de trabajo es opcional, debe existir y estar activa; una parte con trabajos activos no se apaga', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const { p } = await jerarquia(api);
    const cam = await accionId(api, 'CAM');
    const area = (await api.post('/areas').send({ nombre: 'Mecanica' })).body.data;
    const tr = (await api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: cam, area_trabajo_id: area.id })).body.data;
    expect(tr.area).toBe('MECANICA');
    expect((await api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: cam, area_trabajo_id: 9999 })).status).toBe(400);
    expect((await api.patch(`/catalogos/partes/${p.id}`).send({ activo: false })).status).toBe(409);
    await api.patch(`/catalogos/trabajos/${tr.id}`).send({ activo: false }).expect(200);
    await api.patch(`/catalogos/partes/${p.id}`).send({ activo: false }).expect(200);
    expect((await api.patch(`/catalogos/trabajos/${tr.id}`).send({ activo: true })).status).toBe(409); // su parte está apagada
    expect((await api.post('/catalogos/trabajos').send({ parte_id: p.id, accion_id: cam })).status).toBe(400); // no se crea bajo una parte apagada
  });
});

describe('catálogos simples', () => {
  it('acciones: vienen sembradas, el código son 3 letras y no se cambia', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const lista = (await api.get('/catalogos/acciones')).body.data;
    expect(lista.length).toBeGreaterThanOrEqual(10);
    const nueva = (await api.post('/catalogos/acciones').send({ codigo: 'sol', nombre: 'Soldar' })).body.data;
    expect(nueva).toMatchObject({ codigo: 'SOL', nombre: 'SOLDAR' });
    expect((await api.post('/catalogos/acciones').send({ codigo: 'SOL', nombre: 'Otra' })).status).toBe(409);
    expect((await api.post('/catalogos/acciones').send({ codigo: 'ABCD', nombre: 'Larga' })).status).toBe(400);
    const r = await api.patch(`/catalogos/acciones/${nueva.id}`).send({ codigo: 'SLD' });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain('no se puede cambiar');
    expect((await api.patch(`/catalogos/acciones/${nueva.id}`).send({ codigo: 'sol', nombre: 'Soldadura' })).body.data.nombre).toBe('SOLDADURA'); // el mismo código sí pasa
  });

  it('unidades: un solo catálogo con el uso (inventario, contador o ambos)', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const lista = (await api.get('/catalogos/unidades')).body.data as Array<{ codigo: string; uso: string }>;
    expect(lista.find((u) => u.codigo === 'KM')?.uso).toBe('contador');
    expect(lista.find((u) => u.codigo === 'LT')?.uso).toBe('inventario');
    const u = (await api.post('/catalogos/unidades').send({ codigo: 'rev', nombre: 'Revoluciones', uso: 'ambos' })).body.data;
    expect(u).toMatchObject({ codigo: 'REV', uso: 'ambos' });
    expect((await api.post('/catalogos/unidades').send({ codigo: 'XX', nombre: 'Mala', uso: 'otro' })).status).toBe(400);
  });

  it('marcas, etapas y motivos: nombre único, color válido y desactivar sin borrar', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const m = (await api.post('/catalogos/marcas').send({ nombre: 'Caterpillar' })).body.data;
    expect((await api.post('/catalogos/marcas').send({ nombre: 'caterpillar' })).status).toBe(409);
    await api.patch(`/catalogos/marcas/${m.id}`).send({ activo: false }).expect(200);
    expect((await api.get('/catalogos/marcas')).body.data).toHaveLength(0);
    expect((await api.get('/catalogos/marcas?inactivos=true')).body.data).toHaveLength(1);
    expect((await api.get('/catalogos/etapas')).body.data.map((x: { codigo: string }) => x.codigo)).toEqual(['RECEPCION', 'CALIDAD', 'ENTREGA']);
    expect((await api.post('/catalogos/etapas').send({ codigo: 'prueba', nombre: 'Prueba de ruta', color: 'rojo' })).status).toBe(400);
    expect((await api.post('/catalogos/etapas').send({ codigo: 'prueba', nombre: 'Prueba de ruta', color: '#ff0000', orden: 25 })).status).toBe(201);
    const motivos = (await api.get('/catalogos/motivos')).body.data as Array<{ tipo: string }>;
    expect(new Set(motivos.map((x) => x.tipo)).size).toBe(5);
    expect((await api.post('/catalogos/motivos').send({ tipo: 'anulacion_orden', nombre: 'Creada por error' })).status).toBe(409); // ya existe en ese tipo
    expect((await api.post('/catalogos/motivos').send({ tipo: 'cancelacion_cita', nombre: 'Creada por error' })).status).toBe(201); // en otro tipo, sí
  });

  it('tipos de orden: seis de fábrica, uno por defecto, el código son 3 letras', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const lista = (await api.get('/catalogos/tipos-orden')).body.data as Array<{ id: number; codigo: string; es_default: number; es_pedido_especial: number }>;
    expect(lista).toHaveLength(6);
    expect(lista.filter((x) => x.es_default === 1)).toHaveLength(1);
    expect(lista.find((x) => x.codigo === 'MPE')?.es_pedido_especial).toBe(1);
    expect((await api.post('/catalogos/tipos-orden').send({ codigo: 'AB', nombre: 'Corto' })).status).toBe(400);
    expect((await api.post('/catalogos/tipos-orden').send({ codigo: 'REP', nombre: 'Repetido' })).status).toBe(409);
    expect((await api.post('/catalogos/tipos-orden').send({ codigo: 'urg', nombre: 'Urgencia' })).body.data.codigo).toBe('URG');
  });

  it('el tipo de orden por defecto es uno solo y siempre activo: se cambia marcando otro', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const lista = (await api.get('/catalogos/tipos-orden')).body.data as Array<{ id: number; codigo: string; es_default: number }>;
    const rep = lista.find((x) => x.codigo === 'REP')!;
    const man = lista.find((x) => x.codigo === 'MAN')!;
    expect((await api.patch(`/catalogos/tipos-orden/${rep.id}`).send({ activo: false })).status).toBe(409);
    expect((await api.patch(`/catalogos/tipos-orden/${rep.id}`).send({ es_default: false })).status).toBe(409);
    await api.patch(`/catalogos/tipos-orden/${man.id}`).send({ es_default: true }).expect(200);
    const despues = (await api.get('/catalogos/tipos-orden')).body.data as Array<{ codigo: string; es_default: number }>;
    expect(despues.filter((x) => x.es_default === 1).map((x) => x.codigo)).toEqual(['MAN']);
    await api.patch(`/catalogos/tipos-orden/${rep.id}`).send({ activo: false }).expect(200); // ya no es el default
  });
});

describe('estados de la orden', () => {
  it('trae los 7 de fábrica con sus banderas', async () => {
    const t = await tallerDePrueba(e);
    const estados = (await (await admin(t)).get('/catalogos/estados-orden')).body.data as Array<{ codigo: string; es_inicial: number; es_terminal: number; es_cancelado: number; es_sistema: number }>;
    expect(estados.map((s) => s.codigo)).toEqual(['CREADA', 'EN_PROCESO', 'EN_REVISION', 'TERMINADA', 'ENTREGADA', 'CERRADA', 'ANULADA']);
    expect(estados.find((s) => s.codigo === 'CREADA')).toMatchObject({ es_inicial: 1, es_terminal: 0, es_sistema: 1 });
    expect(estados.find((s) => s.codigo === 'CERRADA')).toMatchObject({ es_terminal: 1, es_cancelado: 0 });
    expect(estados.find((s) => s.codigo === 'ANULADA')).toMatchObject({ es_terminal: 1, es_cancelado: 1 });
    expect(estados.every((s) => s.es_sistema === 1)).toBe(true);
  });

  it('los de fábrica se renombran pero no cambian de banderas ni se apagan', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const cerrada = (await api.get('/catalogos/estados-orden')).body.data.find((s: { codigo: string }) => s.codigo === 'CERRADA');
    const r = await api.patch(`/catalogos/estados-orden/${cerrada.id}`).send({ nombre: 'Finalizada', color: '#111111' });
    expect(r.body.data).toMatchObject({ codigo: 'CERRADA', nombre: 'FINALIZADA', color: '#111111', es_terminal: 1 }); // el código no cambia: la lógica nunca mira el texto
    expect((await api.patch(`/catalogos/estados-orden/${cerrada.id}`).send({ es_terminal: false })).status).toBe(409);
    expect((await api.patch(`/catalogos/estados-orden/${cerrada.id}`).send({ activo: false })).status).toBe(409);
  });

  it('el taller crea los suyos eligiendo banderas; uno cancelado siempre es terminal', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const a = (await api.post('/catalogos/estados-orden').send({ codigo: 'esperando repuesto', nombre: 'Esperando repuesto', orden: 25, color: '#FFAA00' })).body.data;
    expect(a).toMatchObject({ codigo: 'ESPERANDO_REPUESTO', es_terminal: 0, es_cancelado: 0, es_sistema: 0, es_inicial: 0 });
    const b = (await api.post('/catalogos/estados-orden').send({ codigo: 'rechazada', nombre: 'Rechazada', es_cancelado: true })).body.data;
    expect(b).toMatchObject({ es_cancelado: 1, es_terminal: 1 });
    expect((await api.patch(`/catalogos/estados-orden/${a.id}`).send({ es_cancelado: true })).body.data).toMatchObject({ es_cancelado: 1, es_terminal: 1 });
    expect((await api.patch(`/catalogos/estados-orden/${a.id}`).send({ activo: false })).body.data.activo).toBe(0); // los propios sí se apagan
    expect((await api.post('/catalogos/estados-orden').send({ codigo: '1mal', nombre: 'Mal' })).status).toBe(400);
    expect((await api.post('/catalogos/estados-orden').send({ codigo: 'CERRADA', nombre: 'Otra cerrada' })).status).toBe(409);
  });

  it('la lista sale ordenada por el campo orden', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await api.post('/catalogos/estados-orden').send({ codigo: 'extra', nombre: 'Extra', orden: 35 });
    const codigos = (await api.get('/catalogos/estados-orden')).body.data.map((s: { codigo: string }) => s.codigo);
    expect(codigos.indexOf('EXTRA')).toBe(codigos.indexOf('EN_REVISION') + 1);
  });
});

describe('matriz nivel de técnico × sistema', () => {
  it('nace todo habilitado, y fila ausente = sin permiso', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    const m = (await api.get('/catalogos/matriz-tecnico-sistema')).body.data;
    expect(m.niveles).toHaveLength(3);
    expect(m.sistemas).toHaveLength(2);
    expect(m.habilitadas).toHaveLength(6);
    const nivel = m.niveles[0].id;
    const sistema = m.sistemas[0].id;
    const r = await api.patch('/catalogos/matriz-tecnico-sistema').send({ cambios: [{ nivel_tecnico_id: nivel, sistema_id: sistema, habilitado: false }] });
    expect(r.body.data.habilitadas).toHaveLength(5);
    expect(r.body.data.habilitadas.some((h: { nivel_tecnico_id: number; sistema_id: number }) => h.nivel_tecnico_id === nivel && h.sistema_id === sistema)).toBe(false);
    // Cambiar una casilla no toca las demás, y repetir un cambio no duplica ni falla.
    await api.patch('/catalogos/matriz-tecnico-sistema').send({ cambios: [{ nivel_tecnico_id: nivel, sistema_id: sistema, habilitado: true }, { nivel_tecnico_id: nivel, sistema_id: sistema, habilitado: true }] }).expect(200);
    expect((await api.get('/catalogos/matriz-tecnico-sistema')).body.data.habilitadas).toHaveLength(6);
    expect((await api.patch('/catalogos/matriz-tecnico-sistema').send({ cambios: [{ nivel_tecnico_id: 9999, sistema_id: sistema, habilitado: true }] })).status).toBe(400);
  });

  it('un sistema o un nivel nuevo nace habilitado para todos; borrar un nivel quita sus casillas', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await api.post('/catalogos/sistemas').send({ nombre: 'Electrico' }).expect(201);
    let m = (await api.get('/catalogos/matriz-tecnico-sistema')).body.data;
    expect(m.habilitadas).toHaveLength(9); // 3 niveles × 3 sistemas
    const nivel = (await api.post('/niveles-tecnico').send({ codigo: 'n4', nombre: 'Aprendiz', orden: 4 })).body.data;
    m = (await api.get('/catalogos/matriz-tecnico-sistema')).body.data;
    expect(m.habilitadas).toHaveLength(12); // 4 × 3
    await api.delete(`/niveles-tecnico/${nivel.id}`).expect(200);
    expect((await api.get('/catalogos/matriz-tecnico-sistema')).body.data.habilitadas).toHaveLength(9);
  });
});

describe('permisos de los catálogos', () => {
  it('el técnico los consulta pero no los edita; sin el módulo de órdenes ni siquiera los ve', async () => {
    const t = await tallerDePrueba(e);
    const u = await t.usuario('tecnico');
    const api = t.api(await u.token());
    expect((await api.get('/catalogos/sistemas')).status).toBe(200);
    expect((await api.post('/catalogos/sistemas').send({ nombre: 'No' })).status).toBe(403);
    expect((await api.patch('/catalogos/matriz-tecnico-sistema').send({ cambios: [{ nivel_tecnico_id: 1, sistema_id: 1, habilitado: false }] })).status).toBe(403);
    await ejecutar(e.pool, "DELETE FROM empresa_modulos WHERE empresa_id = ? AND modulo_codigo = 'ordenes'", [t.empresaId]);
    expect((await api.get('/catalogos/sistemas')).status).toBe(403);
  });

  it('el visualizador solo mira y el recepcionista no gestiona', async () => {
    const t = await tallerDePrueba(e);
    for (const rol of ['visualizador', 'recepcionista'] as const) {
      const u = await t.usuario(rol);
      const api = t.api(await u.token());
      expect((await api.get('/catalogos/trabajos')).status).toBe(rol === 'visualizador' ? 200 : 200);
      expect((await api.post('/catalogos/acciones').send({ codigo: 'ZZZ', nombre: 'Prueba' })).status).toBe(403);
    }
  });

  it('todo cambio de un catálogo queda en la bitácora', async () => {
    const t = await tallerDePrueba(e);
    const api = await admin(t);
    await api.post('/catalogos/sistemas').send({ nombre: 'Auditado' });
    const b = (await api.get('/bitacora?accion=sistema_creado')).body.data;
    expect(b.total).toBe(1);
    expect(b.registros[0].entidad).toBe('sistemas');
  });
});
