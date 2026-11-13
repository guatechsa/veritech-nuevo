import { ScrollView } from 'react-native';
import { useDia } from '../../src/ui/hooks';
import { estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../src/ui/tema';

interface LineaSolicitud {
  id: number;
  material?: string;
  nombre?: string;
  codigo?: string;
  cantidad_solicitada?: number;
  pendiente?: number;
}

/** Bodega: las solicitudes de material por despachar (se descargan con «Mi día»). El despacho se hace desde el sistema web por ahora. */
export default function Bodega() {
  const { datos } = useDia();
  const lista = (datos?.solicitudes ?? []) as Array<{ id: number; numero?: string; orden?: string; sucursal?: string; solicitante?: string; lineas?: LineaSolicitud[] }>;
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Titulo>Solicitudes de material</Titulo>
      {!datos && <Mensaje texto="Descargue su día (en «Mi día») para ver las solicitudes." tipo="aviso" />}
      {datos && lista.length === 0 && <Texto suave>No hay solicitudes por despachar.</Texto>}
      {lista.map((s) => (
        <Tarjeta key={s.id}>
          <Texto negrita>{s.numero} · orden {s.orden}</Texto>
          <Texto suave>{s.sucursal} · pidió {s.solicitante ?? '—'}</Texto>
          {(s.lineas ?? []).map((l) => (
            <Texto key={l.id}>{l.cantidad_solicitada ?? l.pendiente ?? ''} × {l.nombre ?? l.material ?? l.codigo ?? 'Material'}{l.pendiente !== undefined ? ` (faltan ${l.pendiente})` : ''}</Texto>
          ))}
        </Tarjeta>
      ))}
    </ScrollView>
  );
}
