import { useRouter } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { useDia } from '../../src/ui/hooks';
import { estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../src/ui/tema';
import { ESTADO_DE_TRABAJO } from '../../src/ui/estados';

export default function Trabajos() {
  const r = useRouter();
  const { datos } = useDia();
  const lista = datos?.trabajos?.trabajos ?? [];
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Titulo>Mis trabajos</Titulo>
      {!datos && <Mensaje texto="Descargue su día (en «Mi día») para ver sus trabajos." tipo="aviso" />}
      {datos && lista.length === 0 && <Texto suave>No tiene trabajos asignados.</Texto>}
      {lista.map((t) => (
        <Pressable key={t.id} accessibilityRole="button" accessibilityLabel={`${t.descripcion}, ${ESTADO_DE_TRABAJO[t.estado]?.nombre ?? t.estado}`} onPress={() => r.push(`/trabajo/${t.id}`)}>
          <Tarjeta estilo={t.estado === 'terminado' ? { opacity: 0.6 } : undefined}>
            <Texto negrita>{t.descripcion}</Texto>
            <Texto suave>{t.equipo} · orden {t.numero}</Texto>
            <Texto>{ESTADO_DE_TRABAJO[t.estado]?.nombre ?? t.estado}</Texto>
          </Tarjeta>
        </Pressable>
      ))}
    </ScrollView>
  );
}
