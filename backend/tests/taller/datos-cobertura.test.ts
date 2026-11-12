import { hojasDeExportacion, TABLAS_NO_EXPORTADAS } from '../../src/taller/datos/exportar';
import { crearEntornoDePrueba, EntornoDePrueba } from '../plataforma/ayuda';
import { tallerDePrueba } from './ayuda';

let e: EntornoDePrueba;
beforeAll(async () => {
  e = await crearEntornoDePrueba();
});
afterAll(async () => e.cerrar());
beforeEach(async () => {
  await e.limpiar();
  await e.planesConPaypal();
});

/**
 * La descarga de datos es lo que el taller se lleva al irse. Si una fase futura agrega una tabla y se olvida de ponerla
 * en la descarga, esta prueba falla y obliga a decidir: se exporta o se excluye CON su motivo.
 */
describe('la descarga cubre todas las tablas del taller', () => {
  it('cada tabla sale en alguna hoja o está en la lista de excluidas con su motivo', async () => {
    const t = await tallerDePrueba(e);
    const tablas = (await t.sql(async (c) => (await c.query("SELECT TABLE_NAME AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'"))[0])) as Array<{ n: string }>;
    const nombres = tablas.map((x) => x.n);
    const sqls = hojasDeExportacion().map((h) => h.sql).join('\n');

    const sinCubrir = nombres.filter((n) => !(n in TABLAS_NO_EXPORTADAS) && !new RegExp(`\\b(FROM|JOIN)\\s+${n}\\b`, 'i').test(sqls));
    expect(sinCubrir).toEqual([]);

    // La lista de excluidas no guarda nombres que ya no existen, y todas llevan motivo.
    for (const [tabla, motivo] of Object.entries(TABLAS_NO_EXPORTADAS)) {
      expect(nombres).toContain(tabla);
      expect(motivo.length).toBeGreaterThan(10);
    }
  });

  it('una tabla excluida nunca se vuelca completa en una hoja (contraseñas, sesiones, enlaces)', () => {
    const volcadas = hojasDeExportacion().map((h) => /SELECT \* FROM (\w+)/i.exec(h.sql)?.[1]).filter((x): x is string => !!x);
    for (const tabla of volcadas) expect(tabla in TABLAS_NO_EXPORTADAS).toBe(false);
  });

  it('ninguna hoja trae columnas de contraseñas, llaves o enlaces secretos', async () => {
    const t = await tallerDePrueba(e);
    for (const h of hojasDeExportacion()) {
      const columnas = (await t.sql(async (c) => (await c.query(h.sql))[1])) as Array<{ name: string }>;
      for (const col of columnas) expect({ hoja: h.nombre, columna: col.name, secreta: /hash|contrasena|token|secret/i.test(col.name) }).toMatchObject({ secreta: false });
    }
  });
});
