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
    case 'checklist_firma':
      return cambiarChecklist(datos, Number(x['checklistId']), (k) => ({ ...k, firma_local: { nombre: String(x['nombre']) } }));
    case 'orden_estado': {
      const ordenId = Number(x['ordenId']);
      const nuevo = datos.catalogos?.estados_orden?.find((e) => e.id === Number(x['estadoId']));
      if (!nuevo) return datos;
      const cambiar = <T extends { id: number; [clave: string]: unknown }>(o: T): T => (o.id === ordenId ? { ...o, estado_id: nuevo.id, estado: nuevo.nombre, es_terminal: nuevo.es_terminal, ...(nuevo.sale_equipo === 1 ? { equipo_en_taller: 0 } : {}) } : o);
      return { ...datos, ordenes: datos.ordenes.map(cambiar), ordenes_abiertas: datos.ordenes_abiertas?.map(cambiar) };
    }
    case 'despacho': {
      const items = (x['items'] ?? []) as Array<{ linea_id: number; bodega_id: number; cantidad: number }>;
      return {
        ...datos,
        solicitudes: datos.solicitudes?.map((s) => {
          if (s.id !== Number(x['solicitudId'])) return s;
          const lineas = s.lineas.map((l) => {
            const aqui = items.filter((i) => i.linea_id === l.id);
            const total = aqui.reduce((n, i) => n + i.cantidad, 0);
            if (total === 0) return l;
            return {
              ...l,
              cantidad_despachada: l.cantidad_despachada + total,
              pendiente: Math.max(0, l.pendiente - total),
              por_bodega: l.por_bodega.map((b) => ({ ...b, cantidad: b.cantidad - aqui.filter((i) => i.bodega_id === b.bodega_id).reduce((n, i) => n + i.cantidad, 0) })),
            };
          });
          return { ...s, lineas, estado: lineas.every((l) => l.pendiente === 0) ? 'despachada' : 'despachada_parcial' };
        }),
      };
    }
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
