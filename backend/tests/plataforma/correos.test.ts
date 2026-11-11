import { encolarCorreo, MensajeCorreo, procesarCola, Transporte } from '../../src/correos/cola';
import { botonCorreo, plantillaCorreo } from '../../src/correos/plantilla';
import { filas } from '../../src/db/consulta';
import { crearEntornoDePrueba, EntornoDePrueba } from './ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => {
  await e.cerrar();
});
beforeEach(async () => {
  await e.limpiar();
});

function transporteDePrueba(falla: () => boolean = () => false, demoraMs = 0) {
  const enviados: MensajeCorreo[] = [];
  const transporte: Transporte = {
    async enviar(m) {
      if (demoraMs) await new Promise((r) => setTimeout(r, demoraMs));
      if (falla()) throw new Error('SMTP caído');
      enviados.push(m);
    },
  };
  return { enviados, transporte };
}

const nuevo = (n = 1) => encolarCorreo(e.pool, { tipo: 'prueba', destinatarios: [`a${n}@x.test`, `b${n}@x.test`], asunto: `Asunto ${n}`, cuerpoHtml: `<p>Cuerpo ${n}</p>` });

describe('cola de correos', () => {
  it('envía los pendientes y los marca como enviados', async () => {
    await nuevo(1);
    await nuevo(2);
    const { enviados, transporte } = transporteDePrueba();
    expect(await procesarCola(e.pool, transporte)).toEqual({ enviados: 2, conError: 0 });
    expect(enviados[0]).toEqual({ destinatarios: ['a1@x.test', 'b1@x.test'], asunto: 'Asunto 1', html: '<p>Cuerpo 1</p>' });
    const estados = await filas<{ estado: string; enviado_en: Date | null }>(e.pool, 'SELECT estado, enviado_en FROM correos_salida');
    expect(estados.every((f) => f.estado === 'enviado' && f.enviado_en instanceof Date)).toBe(true);
    expect(await procesarCola(e.pool, transporte)).toEqual({ enviados: 0, conError: 0 }); // nada se manda dos veces
  });

  it('si el envío falla, el correo NO se pierde: queda pendiente con el motivo y se reintenta más tarde', async () => {
    await nuevo();
    const { transporte } = transporteDePrueba(() => true);
    expect(await procesarCola(e.pool, transporte)).toEqual({ enviados: 0, conError: 1 });
    const [c] = await filas<{ estado: string; intentos: number; ultimo_error: string; espera: number }>(
      e.pool,
      'SELECT estado, intentos, ultimo_error, TIMESTAMPDIFF(MINUTE, UTC_TIMESTAMP(), enviar_despues_de) AS espera FROM correos_salida'
    );
    expect(c).toMatchObject({ estado: 'pendiente', intentos: 1, ultimo_error: 'SMTP caído' });
    expect(c?.espera).toBeGreaterThanOrEqual(4); // el próximo intento es en ~5 minutos
    // todavía no toca reintentarlo
    expect(await procesarCola(e.pool, transporteDePrueba().transporte)).toEqual({ enviados: 0, conError: 0 });
    // al llegar la hora, se envía
    await e.pool.query('UPDATE correos_salida SET enviar_despues_de = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)');
    const ok = transporteDePrueba();
    expect(await procesarCola(e.pool, ok.transporte)).toEqual({ enviados: 1, conError: 0 });
  });

  it('tras agotar los intentos pasa a "error" para que alguien lo revise', async () => {
    await nuevo();
    const { transporte } = transporteDePrueba(() => true);
    for (let i = 0; i < 5; i++) {
      await procesarCola(e.pool, transporte, { maximoIntentos: 3 });
      await e.pool.query("UPDATE correos_salida SET enviar_despues_de = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND) WHERE estado = 'pendiente'");
    }
    const [c] = await filas<{ estado: string; intentos: number }>(e.pool, 'SELECT estado, intentos FROM correos_salida');
    expect(c).toMatchObject({ estado: 'error', intentos: 3 });
  });

  it('dos procesos a la vez NO mandan el mismo correo dos veces', async () => {
    for (let i = 1; i <= 6; i++) await nuevo(i);
    const { enviados, transporte } = transporteDePrueba(() => false, 30);
    const [a, b] = await Promise.all([procesarCola(e.pool, transporte), procesarCola(e.pool, transporte)]);
    expect(a.enviados + b.enviados).toBe(6);
    expect(enviados).toHaveLength(6);
    expect(new Set(enviados.map((m) => m.asunto)).size).toBe(6);
  });

  it('encolar dentro de una transacción que se deshace NO deja el correo', async () => {
    const con = await e.pool.getConnection();
    try {
      await con.beginTransaction();
      await encolarCorreo(con, { tipo: 'prueba', destinatarios: ['x@y.test'], asunto: 'No debe salir', cuerpoHtml: '<p>x</p>' });
      await con.rollback();
    } finally {
      con.release();
    }
    expect(await filas(e.pool, 'SELECT id FROM correos_salida')).toHaveLength(0);
  });
});

describe('plantilla de correo (estándar de diseño)', () => {
  it('lleva el encabezado azul, el cuerpo y el pie fijo', () => {
    const html = plantillaCorreo('<p>Hola</p>');
    expect(html).toContain('color: #4997D0');
    expect(html).toContain('VERI-TECH');
    expect(html).toContain('<p>Hola</p>');
    expect(html).toContain('Este es un correo automático, no lo respondas.');
  });

  it('el botón escapa la dirección y el texto', () => {
    const html = botonCorreo('Entrar <ya>', 'https://x.test/?a=1&b="2"');
    expect(html).not.toContain('<ya>');
    expect(html).toContain('&amp;b=&quot;2&quot;');
  });
});
