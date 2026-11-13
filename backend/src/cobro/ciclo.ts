import { aprovisionarAlta } from '../alta/aprovisionar';
import { correoBienvenida, correoBorradoProximo, correoPagoFallido, correoPruebaPorTerminar } from '../correos/ciclo-vida';
import { borrarBaseDeTaller } from '../db/bases';
import { ejecutar, filas, transaccion } from '../db/consulta';
import { registrarAuditoria } from '../plataforma/auditoria';
import { ahoraDe, configBdDe, Contexto } from '../plataforma/contexto';
import { procesarAvisosPendientes } from './aviso';
import { decidirPorFechas } from './estado';
import { MS_DIA, POLITICA } from './politica';
import { aplicarDecision, avisarEmpresa, bloquearEmpresa, COLUMNAS_EMPRESA, datosTaller, FilaEmpresa } from './transicion';

export interface ResumenCiclo {
  transiciones: number;
  avisos: number;
  bienvenidas: number;
  bases_borradas: number;
  altas_vencidas: number;
  altas_reintentadas: number;
  avisos_paypal_pendientes: number;
  errores: string[];
}

/** ¿Responde ya el subdominio? Se pide su /health por HTTPS (el certificado y el sitio ya están listos si responde). */
export async function verificarSubdominioHttp(url: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Barrido del ciclo de vida (cada hora): lo que cambia solo con el paso del tiempo. Cada empresa se procesa por
 * separado: si una falla, las demás siguen. Todos los correos llevan clave única, así que repetir el barrido es seguro.
 */
export async function barrerCicloDeVida(ctx: Contexto): Promise<ResumenCiclo> {
  const ahora = ahoraDe(ctx);
  const resumen: ResumenCiclo = { transiciones: 0, avisos: 0, bienvenidas: 0, bases_borradas: 0, altas_vencidas: 0, altas_reintentadas: 0, avisos_paypal_pendientes: 0, errores: [] };
  const fallo = (donde: string, error: unknown): void => {
    resumen.errores.push(`${donde}: ${(error instanceof Error ? error.message : String(error)).slice(0, 200)}`);
  };

  // 1. Altas: las no pagadas vencen a las 48 h y las aprobadas que se quedaron a medias se reintentan.
  const vencidas = await ejecutar(ctx.pool, "UPDATE altas_pendientes SET estado = 'vencida', contrasena_hash = NULL WHERE estado = 'emitida' AND vence_en <= ?", [ahora]);
  resumen.altas_vencidas = vencidas.affectedRows;
  const atoradas = await filas<{ id: number }>(
    ctx.pool,
    `SELECT id FROM altas_pendientes WHERE estado = 'aprobada' AND aprobada_en <= ? AND intentos < ? ORDER BY id LIMIT 20`,
    [new Date(ahora.getTime() - 2 * 60 * 1000), POLITICA.maximoIntentosAlta]
  );
  for (const { id } of atoradas) {
    try {
      await aprovisionarAlta(ctx, id);
      resumen.altas_reintentadas += 1;
    } catch (error) {
      fallo(`alta ${id}`, error);
    }
  }

  // 2. Avisos de PayPal guardados pero sin procesar.
  try {
    resumen.avisos_paypal_pendientes = await procesarAvisosPendientes(ctx);
  } catch (error) {
    fallo('avisos de PayPal', error);
  }

  // 3. Empresas: el calendario manda (gracia, fin de acceso, exportar, cierre) y salen los avisos.
  const empresas = await filas<FilaEmpresa & { provisionada_en: Date | null; subdominio_listo_en: Date | null }>(
    ctx.pool,
    `SELECT ${COLUMNAS_EMPRESA}, provisionada_en, subdominio_listo_en FROM empresas WHERE estado <> 'cerrada' ORDER BY id`
  );
  for (const inicial of empresas) {
    try {
      // 3a. Transición por fechas (con la fila bloqueada y releída: otra tarea pudo haberla cambiado).
      const cierre: { fila: FilaEmpresa | null } = { fila: null };
      if (!inicial.cobro_por_contrato) {
        await transaccion(ctx.pool, async (con) => {
          const e = await bloquearEmpresa(con, inicial.id);
          if (!e) return;
          const decision = decidirPorFechas(e, ahora);
          if (!decision) return;
          await aplicarDecision(con, ahora, ctx.entorno, e, decision, { origen: 'sistema', tipo: 'calendario', detalle: decision.motivo });
          resumen.transiciones += 1;
          if (decision.estado === 'cerrada') cierre.fila = e;
        });
      }
      if (cierre.fila) {
        await cerrarTaller(ctx, cierre.fila, resumen);
        continue;
      }

      // 3b. Avisos que dependen de la fecha.
      const actual = (await filas<FilaEmpresa>(ctx.pool, `SELECT ${COLUMNAS_EMPRESA} FROM empresas WHERE id = ?`, [inicial.id]))[0];
      if (!actual) continue;
      resumen.avisos += await enviarAvisosDeFecha(ctx, actual, ahora);

      // 3c. Bienvenida: solo cuando el subdominio ya responde.
      if (inicial.provisionada_en && !inicial.subdominio_listo_en && ctx.verificarSubdominio) {
        const listo = await ctx.verificarSubdominio(datosTaller(actual, ctx.entorno).urlTaller);
        if (listo) {
          await transaccion(ctx.pool, async (con) => {
            await ejecutar(con, 'UPDATE empresas SET subdominio_listo_en = ? WHERE id = ?', [ahora, actual.id]);
            await avisarEmpresa(con, actual, correoBienvenida(datosTaller(actual, ctx.entorno), POLITICA.diasPrueba), `bienvenida:${actual.id}`);
          });
          resumen.bienvenidas += 1;
        }
      }
    } catch (error) {
      fallo(`empresa ${inicial.id}`, error);
    }
  }
  return resumen;
}

async function enviarAvisosDeFecha(ctx: Contexto, e: FilaEmpresa, ahora: Date): Promise<number> {
  if (e.cobro_por_contrato || !e.contacto_correo) return 0;
  const dt = datosTaller(e, ctx.entorno);
  let enviados = 0;
  const marcar = async (correo: Parameters<typeof avisarEmpresa>[2], clave: string): Promise<void> => {
    const antes = await filas<{ n: number }>(ctx.pool, 'SELECT COUNT(*) AS n FROM correos_salida WHERE clave_unica = ?', [clave]);
    await avisarEmpresa(ctx.pool, e, correo, clave);
    if (Number(antes[0]?.n) === 0) enviados += 1;
  };

  if (e.estado === 'prueba' && e.prueba_hasta && e.prueba_hasta > ahora) {
    const aplicables = POLITICA.diasAvisoPrueba.filter((d) => ahora.getTime() >= e.prueba_hasta!.getTime() - d * MS_DIA);
    if (aplicables.length > 0) {
      const d = Math.min(...aplicables);
      await marcar(correoPruebaPorTerminar(dt, d, e.prueba_hasta), `prueba_${d}d:${e.id}`);
    }
  }
  if (e.estado === 'pago_fallido' && e.gracia_hasta) {
    const inicio = e.gracia_hasta.getTime() - POLITICA.diasGracia * MS_DIA;
    for (const d of POLITICA.diasAvisoGracia) {
      if (ahora.getTime() >= inicio + d * MS_DIA) {
        await marcar(correoPagoFallido(dt, e.gracia_hasta, POLITICA.diasGracia - d), `gracia${d}:${e.id}:${Math.floor(e.gracia_hasta.getTime() / 1000)}`);
      }
    }
  }
  if (e.estado === 'solo_exportar' && e.borrado_programado_en && ahora.getTime() >= e.borrado_programado_en.getTime() - POLITICA.diasAvisoBorrado * MS_DIA) {
    await marcar(correoBorradoProximo(dt, e.borrado_programado_en), `borrado_proximo:${e.id}:${Math.floor(e.borrado_programado_en.getTime() / 1000)}`);
  }
  return enviados;
}

/** Un taller recién cerrado: se borra su base solo si el borrado automático está encendido. Siempre queda constancia. */
async function cerrarTaller(ctx: Contexto, e: FilaEmpresa, resumen: ResumenCiclo): Promise<void> {
  if (!ctx.entorno.BORRADO_AUTOMATICO) {
    await registrarAuditoria(ctx.pool, { usuarioId: null, accion: 'taller_cerrado', empresaId: e.id, descripcion: `Se cerró ${e.nombre}. La base ${e.nombre_bd} NO se borró (borrado automático apagado)` });
    return;
  }
  await borrarBaseDeTaller(configBdDe(ctx.entorno), e.nombre_bd, ctx.entorno.PREFIJO_BD_TALLER, ctx.entorno.BD_PLATAFORMA);
  resumen.bases_borradas += 1;
  await registrarAuditoria(ctx.pool, { usuarioId: null, accion: 'taller_cerrado', empresaId: e.id, descripcion: `Se cerró ${e.nombre} y se borró su base ${e.nombre_bd}` });
}
