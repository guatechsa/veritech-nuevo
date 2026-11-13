import { Cambio } from './cola';
import { Checklist, MiDia, RespuestaDeChecklist } from './dia';
import { estaRespondida } from './reglas';

/**
 * Cómo se ve un cambio que todavía no se envió, aplicado sobre lo que se bajó del servidor. Es una función PURA: no modifica nada, devuelve una copia.
 * Así la pantalla muestra al instante lo que la persona hizo (sin señal también) y, al bajar el día otra vez, esos cambios se vuelven a aplicar encima.
 */
export function aplicarCambio(datos: MiDia, c: Cambio): MiDia {
  const x = c.contexto ?? {};
  switch (c.tipo) {
    case 'linea_estado':
    {
      const lineaId = Number(x['lineaId']);
      const estado = String(x['estado']);
      const lista = datos.trabajos?.trabajos.map((t) => (t.id === lineaId ? { ...t, estado } : t));
      return {
        ...datos,
        trabajos: datos.trabajos && lista ? { ...datos.trabajos, trabajos: lista, ocupado: lista.some((t) => t.estado === 'en_proceso') } : datos.trabajos,
        ordenes: datos.ordenes.map((o) => (o.lineas ? { ...o, lineas: o.lineas.map((l) => (l.id === lineaId ? { ...l, estado } : l)) } : o)),
      };
    }
    case 'linea_foto':
      return {
        ...datos,
        trabajos: datos.trabajos ? { ...datos.trabajos, trabajos: datos.trabajos.trabajos.map((t) => (t.id === Number(x['lineaId']) ? { ...t, fotos_locales: [...(t.fotos_locales ?? []), { uri: String(x['uri']), tipo: String(x['tipo']) }] } : t)) } : datos.trabajos,
      };
    case 'checklist_respuesta':
      return cambiarRespuesta(datos, Number(x['checklistId']), Number(x['respuestaId']), (r) => {
        const v = (x['valores'] ?? {}) as Record<string, unknown>;
        return {
          ...r,
          ...(v['semaforo'] !== undefined ? { semaforo: v['semaforo'] as RespuestaDeChecklist['semaforo'] } : {}),
          ...(v['si_no'] !== undefined ? { si_no: v['si_no'] ? 1 : 0 } : {}),
          ...(v['valor_numero'] !== undefined ? { valor_numero: Number(v['valor_numero']) } : {}),
          ...(v['valor_texto'] !== undefined ? { valor_texto: String(v['valor_texto']) } : {}),
          ...(v['opcion'] !== undefined ? { opcion_texto: String(v['opcion']) } : {}),
          ...(v['nota'] !== undefined ? { nota: v['nota'] === null ? null : String(v['nota']) } : {}),
        };
      });
    case 'checklist_foto':
      return cambiarRespuesta(datos, Number(x['checklistId']), Number(x['respuestaId']), (r) => ({ ...r, fotos_locales: [...(r.fotos_locales ?? []), { uri: String(x['uri']) }] }));
    case 'checklist_completar':
      return cambiarChecklist(datos, Number(x['checklistId']), (k) => ({ ...k, estado: 'completado' }));
    case 'lectura':
      return {
        ...datos,
        equipos: datos.equipos.map((e) => ({ ...e, contadores: e.contadores?.map((k) => (k.id === Number(x['contadorId']) ? { ...k, valor_actual: Number(x['valor']) } : k)) })),
      };
    default:
      return datos;
  }
}

function cambiarChecklist(d: MiDia, id: number, f: (c: Checklist) => Checklist): MiDia {
  return { ...d, checklists: d.checklists.map((c) => (c.id === id ? f(c) : c)) };
}

function cambiarRespuesta(d: MiDia, checklistId: number, respuestaId: number, f: (r: RespuestaDeChecklist) => RespuestaDeChecklist): MiDia {
  return cambiarChecklist(d, checklistId, (c) => {
    const respuestas = c.respuestas.map((r) => (r.id === respuestaId ? f(r) : r));
    return { ...c, respuestas, respondidas: respuestas.filter(estaRespondida).length, estado: c.estado === 'pendiente' ? 'en_progreso' : c.estado };
  });
}
