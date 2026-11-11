import { filas } from '../../src/db/consulta';
import { consumirTokenAcceso, emitirTokenAcceso, SEGUNDOS_TOKEN_SOPORTE } from '../../src/plataforma/soporte';
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

const origen = { ip: '10.0.0.7', userAgent: 'prueba' };

async function superAdmin() {
  const u = await e.usuario('SUPER_ADMIN');
  return { id: u.id, nombre: 'USUARIO SUPER_ADMIN', correo: u.correo, rol: 'SUPER_ADMIN' as const };
}

describe('"Entrar" de soporte: token de un solo uso y 60 segundos', () => {
  it('el token se canjea una sola vez y devuelve a quién entrar', async () => {
    const actor = await superAdmin();
    const empresa = await e.empresa({ estado: 'activa' });
    const { token, venceEnSegundos } = await emitirTokenAcceso(e.ctx, actor, { empresaId: empresa, usuarioDestinoId: 42 }, origen);
    expect(venceEnSegundos).toBe(SEGUNDOS_TOKEN_SOPORTE);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await consumirTokenAcceso(e.ctx, token, '10.0.0.9')).toEqual({ empresaId: empresa, usuarioDestinoId: 42, creadoPor: actor.id });
    await expect(consumirTokenAcceso(e.ctx, token, '10.0.0.9')).rejects.toMatchObject({ codigo: 'TOKEN_INVALIDO' });
  });

  it('dos intentos de canje a la vez: solo uno pasa', async () => {
    const actor = await superAdmin();
    const empresa = await e.empresa();
    const { token } = await emitirTokenAcceso(e.ctx, actor, { empresaId: empresa, usuarioDestinoId: 1 }, origen);
    const resultados = await Promise.allSettled(Array.from({ length: 6 }, () => consumirTokenAcceso(e.ctx, token, '10.0.0.9')));
    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('vence a los 60 segundos', async () => {
    const actor = await superAdmin();
    const empresa = await e.empresa();
    const { token } = await emitirTokenAcceso(e.ctx, actor, { empresaId: empresa, usuarioDestinoId: 1 }, origen);
    const [t] = await filas<{ segundos: number }>(e.pool, 'SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), vence_en) AS segundos FROM tokens_acceso_soporte');
    expect(t?.segundos).toBeGreaterThanOrEqual(58);
    expect(t?.segundos).toBeLessThanOrEqual(60);
    await e.pool.query('UPDATE tokens_acceso_soporte SET vence_en = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND)');
    await expect(consumirTokenAcceso(e.ctx, token, '10.0.0.9')).rejects.toMatchObject({ codigo: 'TOKEN_INVALIDO' });
  });

  it('un token inventado no sirve y en la base solo queda la huella', async () => {
    const actor = await superAdmin();
    const empresa = await e.empresa();
    const { token } = await emitirTokenAcceso(e.ctx, actor, { empresaId: empresa, usuarioDestinoId: 1 }, origen);
    await expect(consumirTokenAcceso(e.ctx, 'f'.repeat(64), '10.0.0.9')).rejects.toMatchObject({ codigo: 'TOKEN_INVALIDO' });
    const [fila] = await filas<{ huella: string }>(e.pool, 'SELECT huella FROM tokens_acceso_soporte');
    expect(fila?.huella).not.toBe(token);
  });

  it('solo un super administrador puede emitirlo', async () => {
    const empresa = await e.empresa();
    for (const rol of ['ADMIN', 'VIEWER'] as const) {
      const u = await e.usuario(rol);
      await expect(
        emitirTokenAcceso(e.ctx, { id: u.id, nombre: 'X', correo: u.correo, rol }, { empresaId: empresa, usuarioDestinoId: 1 }, origen)
      ).rejects.toMatchObject({ estado: 403 });
    }
  });

  it('no se emite para una empresa inexistente ni para una sin acceso (suspendida, cerrada…)', async () => {
    const actor = await superAdmin();
    await expect(emitirTokenAcceso(e.ctx, actor, { empresaId: 9999, usuarioDestinoId: 1 }, origen)).rejects.toMatchObject({ estado: 404 });
    for (const estado of ['suspendida', 'cerrada', 'solo_exportar', 'pendiente']) {
      const empresa = await e.empresa({ estado });
      await expect(emitirTokenAcceso(e.ctx, actor, { empresaId: empresa, usuarioDestinoId: 1 }, origen)).rejects.toMatchObject({ estado: 409 });
    }
  });

  it('cada acceso queda auditado con quién, a qué empresa y desde qué dirección', async () => {
    const actor = await superAdmin();
    const empresa = await e.empresa({ nombre: 'TALLER AUDITADO' });
    await emitirTokenAcceso(e.ctx, actor, { empresaId: empresa, usuarioDestinoId: 7 }, origen);
    const [a] = await filas<{ accion: string; descripcion: string; ip: string; empresa_id: number; usuario_plataforma_id: number }>(
      e.pool,
      "SELECT accion, descripcion, ip, empresa_id, usuario_plataforma_id FROM auditoria_plataforma WHERE accion = 'acceso_soporte_iniciado'"
    );
    expect(a).toMatchObject({ ip: '10.0.0.7', empresa_id: empresa, usuario_plataforma_id: actor.id });
    expect(a?.descripcion).toContain('TALLER AUDITADO');
  });
});
