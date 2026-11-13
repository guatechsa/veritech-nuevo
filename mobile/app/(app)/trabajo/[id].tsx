import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useServicios } from '../../../src/plataforma/contexto';
import { ESTADO_DE_TRABAJO, RAZONES_DE_PAUSA } from '../../../src/ui/estados';
import { tomarFoto, useDia } from '../../../src/ui/hooks';
import { Boton, estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../../src/ui/tema';

/** Un trabajo: iniciar, pausar (con la razón), reanudar, terminar y tomar fotos. Todo funciona sin señal y se envía solo. */
export default function Trabajo() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useServicios();
  const r = useRouter();
  const { datos } = useDia();
  const [pausando, setPausando] = useState(false);
  const [mensaje, setMensaje] = useState('');
  const [fotos, setFotos] = useState<string[]>([]);
  const t = datos?.trabajos?.trabajos.find((x) => x.id === Number(id));
  const checklists = (datos?.checklists ?? []).filter((c) => t && c.orden_id === t.orden_id && c.estado !== 'completado');
  const ocupado = datos?.trabajos?.ocupado && t?.estado !== 'en_proceso';

  useEffect(() => {
    if (!t) return;
    void Promise.all(t.fotos.map((f) => s.dia.uriLocal(f.url))).then(setFotos);
  }, [t, s]);

  if (!t) return <View style={estilos.pantalla}><Mensaje texto="No encontramos ese trabajo en su día descargado." tipo="aviso" /></View>;

  const cambiar = async (estado: string, titulo: string): Promise<void> => {
    setMensaje('');
    setPausando(false);
    await s.acciones.cambiarEstadoTrabajo(t.id, estado, titulo);
  };
  const foto = async (tipo: 'antes' | 'durante' | 'despues'): Promise<void> => {
    const uri = await tomarFoto();
    if (!uri) return setMensaje('No se tomó la foto (revise el permiso de la cámara).');
    await s.acciones.agregarFotoDeTrabajo(t.id, tipo, uri);
    setMensaje('Foto guardada en el teléfono; se envía sola.');
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Titulo>{t.descripcion}</Titulo>
      <Tarjeta>
        <Texto>{t.equipo} · orden {t.numero}</Texto>
        <Texto negrita>{ESTADO_DE_TRABAJO[t.estado]?.nombre ?? t.estado}</Texto>
      </Tarjeta>
      {ocupado && t.estado === 'pendiente' && <Mensaje texto="Ya tiene otro trabajo en proceso: páuselo o termínelo antes de iniciar este." tipo="aviso" />}

      {t.estado !== 'terminado' && (
        <Tarjeta>
          {(t.estado === 'pendiente' || t.estado === 'pausado' || ESTADO_DE_TRABAJO[t.estado]?.detenido) && <Boton texto={t.estado === 'pendiente' ? 'Iniciar trabajo' : 'Reanudar trabajo'} alPulsar={() => void cambiar('en_proceso', t.estado === 'pendiente' ? 'Iniciar trabajo' : 'Reanudar trabajo')} deshabilitado={!!ocupado} />}
          {t.estado === 'en_proceso' && !pausando && <Boton texto="Pausar o detener…" variante="borde" alPulsar={() => setPausando(true)} />}
          {pausando && (
            <View style={{ gap: 8 }}>
              <Texto negrita>¿Por qué se detiene?</Texto>
              {RAZONES_DE_PAUSA.map((e) => <Boton key={e} texto={ESTADO_DE_TRABAJO[e]!.nombre} variante="borde" alPulsar={() => void cambiar(e, ESTADO_DE_TRABAJO[e]!.nombre)} />)}
              <Boton texto="Cancelar" variante="borde" alPulsar={() => setPausando(false)} />
            </View>
          )}
          {t.estado === 'en_proceso' && <Boton texto="Terminar trabajo" alPulsar={() => void cambiar('terminado', 'Terminar trabajo')} />}
        </Tarjeta>
      )}

      <Tarjeta>
        <Texto negrita>Fotos del trabajo</Texto>
        <View style={estilos.fila}>
          <Boton texto="Antes" variante="borde" alPulsar={() => void foto('antes')} />
          <Boton texto="Durante" variante="borde" alPulsar={() => void foto('durante')} />
          <Boton texto="Después" variante="borde" alPulsar={() => void foto('despues')} />
        </View>
        <Mensaje texto={mensaje} tipo="ok" />
        <View style={estilos.fila}>
          {fotos.map((u) => <Image key={u} source={{ uri: u }} style={{ width: 72, height: 72, borderRadius: 8 }} accessibilityLabel="Foto del trabajo" />)}
          {(t.fotos_locales ?? []).map((f) => <Image key={f.uri} source={{ uri: f.uri }} style={{ width: 72, height: 72, borderRadius: 8, opacity: 0.7 }} accessibilityLabel="Foto por enviar" />)}
        </View>
        {(t.fotos_locales?.length ?? 0) > 0 && <Texto suave>{t.fotos_locales!.length} por enviar (se envían solas).</Texto>}
      </Tarjeta>

      {s.sesion.permisos.includes('solicitudes.crear') && (
        <Tarjeta>
          <Texto negrita>Material</Texto>
          <Texto suave>Pida a la bodega lo que necesita para esta orden. Funciona sin señal.</Texto>
          <Boton texto="Pedir material a la bodega" variante="borde" alPulsar={() => r.push(`/material/${t.orden_id}`)} />
        </Tarjeta>
      )}

      {checklists.length > 0 && (
        <Tarjeta>
          <Texto negrita>Checklists de esta orden</Texto>
          {checklists.map((c) => <Boton key={c.id} texto={`${c.tipo} (${c.respondidas}/${c.total})`} variante="borde" alPulsar={() => r.push(`/checklist/${c.id}`)} />)}
        </Tarjeta>
      )}
    </ScrollView>
  );
}
