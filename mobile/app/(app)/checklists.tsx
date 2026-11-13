import { useRouter } from 'expo-router';
import { Pressable, ScrollView } from 'react-native';
import { fotosPorSubir } from '../../src/nucleo/reglas';
import { useDia } from '../../src/ui/hooks';
import { estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../src/ui/tema';

export default function Checklists() {
  const r = useRouter();
  const { datos } = useDia();
  const lista = datos?.checklists ?? [];
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Titulo>Checklists</Titulo>
      {!datos && <Mensaje texto="Descargue su día (en «Mi día») para tener sus checklists, incluso sin señal." tipo="aviso" />}
      {datos && lista.length === 0 && <Texto suave>No tiene checklists por llenar.</Texto>}
      {lista.map((c) => {
        const pendientes = fotosPorSubir(c);
        return (
          <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.tipo}, ${c.respondidas} de ${c.total} respondidos`} onPress={() => r.push(`/checklist/${c.id}`)}>
            <Tarjeta>
              <Texto negrita>{c.tipo}</Texto>
              <Texto suave>{c.orden_id ? `Orden ${datos?.ordenes.find((o) => o.id === c.orden_id)?.numero ?? ''}` : 'Del equipo'} · {c.respondidas} de {c.total} respondidos</Texto>
              {c.estado === 'completado' && <Texto>✔ Completado</Texto>}
              {pendientes > 0 && <Texto suave>{pendientes} fotos por subir</Texto>}
            </Tarjeta>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
