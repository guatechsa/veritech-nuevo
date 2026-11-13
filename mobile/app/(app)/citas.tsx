import { ScrollView } from 'react-native';
import { fechaCorta } from '../../src/nucleo/fechas';
import { useDia } from '../../src/ui/hooks';
import { estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../src/ui/tema';

interface CitaDelDia {
  id: number;
  equipo?: string;
  cliente?: string | null;
  fecha?: string;
  hora?: string;
  sucursal?: string;
  notas?: string | null;
  por_confirmar?: number;
}

export default function Citas() {
  const { datos } = useDia();
  const lista = (datos?.citas ?? []) as CitaDelDia[];
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Titulo>Citas de hoy y mañana</Titulo>
      {!datos && <Mensaje texto="Descargue su día (en «Mi día») para ver las citas." tipo="aviso" />}
      {datos && lista.length === 0 && <Texto suave>No hay citas programadas.</Texto>}
      {lista.map((c) => (
        <Tarjeta key={c.id}>
          <Texto negrita>{fechaCorta(c.fecha)} · {c.hora}</Texto>
          <Texto>{c.equipo}</Texto>
          <Texto suave>{c.cliente ?? 'Del taller'} · {c.sucursal}</Texto>
          {c.por_confirmar === 1 && <Mensaje texto="Pedida desde el portal: falta confirmarla (en el sistema web)." tipo="aviso" />}
          {c.notas ? <Texto suave>{c.notas}</Texto> : null}
        </Tarjeta>
      ))}
    </ScrollView>
  );
}
