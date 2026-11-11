import { contrasenaTemporal, hashearContrasena, REGLAS_CONTRASENA, reglasIncumplidas, verificarContrasena } from '../../src/utils/clave';
import { crearToken, huellaDe } from '../../src/utils/tokens';
import { escaparHtml } from '../../src/utils/html';

describe('política de contraseñas (estándar: 10 caracteres, mayúscula, minúscula, número y símbolo)', () => {
  it('acepta una contraseña que cumple todo', () => {
    expect(reglasIncumplidas('Taller-2026-Fuerte!')).toEqual([]);
  });

  it('dice exactamente qué regla falla', () => {
    expect(reglasIncumplidas('Ab1!')).toEqual(['Al menos 10 caracteres']);
    expect(reglasIncumplidas('abcdefghij1!')).toEqual(['Una letra mayúscula']);
    expect(reglasIncumplidas('ABCDEFGHIJ1!')).toEqual(['Una letra minúscula']);
    expect(reglasIncumplidas('Abcdefghijk!')).toEqual(['Un número']);
    expect(reglasIncumplidas('Abcdefghijk1')).toEqual(['Un símbolo (por ejemplo ! # $ % & *)']);
  });

  it('hay una regla por cada requisito del estándar', () => {
    expect(REGLAS_CONTRASENA).toHaveLength(5);
  });

  it('la contraseña temporal siempre cumple las reglas y no se repite', () => {
    const vistas = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const t = contrasenaTemporal();
      expect(reglasIncumplidas(t)).toEqual([]);
      vistas.add(t);
    }
    expect(vistas.size).toBe(200);
  });
});

describe('hash de contraseñas', () => {
  it('verifica la correcta y rechaza la incorrecta', async () => {
    const h = await hashearContrasena('Taller-2026-Fuerte!');
    expect(await verificarContrasena('Taller-2026-Fuerte!', h)).toBe(true);
    expect(await verificarContrasena('Taller-2026-Fuerte', h)).toBe(false);
    expect(await verificarContrasena('', h)).toBe(false);
  });

  it('cada hash lleva su propia sal (dos hashes de la misma contraseña son distintos)', async () => {
    const a = await hashearContrasena('Taller-2026-Fuerte!');
    const b = await hashearContrasena('Taller-2026-Fuerte!');
    expect(a).not.toBe(b);
    expect(a).not.toContain('Taller-2026-Fuerte!');
  });

  it('un valor guardado con formato roto nunca verifica', async () => {
    expect(await verificarContrasena('x', 'no-es-un-hash')).toBe(false);
    expect(await verificarContrasena('x', 'bcrypt$a$b$c$d$e')).toBe(false);
  });

  it('las mismas letras escritas con distinta normalización Unicode cuentan igual', async () => {
    const h = await hashearContrasena('Contraseña-2026!');
    expect(await verificarContrasena('Contraseña-2026!'.replace('ñ', 'ñ'), h)).toBe(true);
    expect(await verificarContrasena('Contraseña-2026!', h)).toBe(true);
  });
});

describe('tokens y HTML', () => {
  it('el token es largo, aleatorio, y la huella es su SHA-256', () => {
    const a = crearToken();
    const b = crearToken();
    expect(a.token).toMatch(/^[0-9a-f]{64}$/);
    expect(a.token).not.toBe(b.token);
    expect(a.huella).toBe(huellaDe(a.token));
    expect(a.huella).not.toBe(a.token);
  });

  it('escaparHtml neutraliza etiquetas y comillas', () => {
    expect(escaparHtml(`<script>alert("x")</script> & 'y'`)).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;');
  });
});
