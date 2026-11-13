import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { SolicitudDeMaterial } from '../../src/nucleo/dia';
import { Elecciones, existenciaEn, itemsDeDespacho, maximoADespachar, problemasDeDespacho, proponerDespacho } from '../../src/nucleo/despacho';
import { useServicios } from '../../src/plataforma/contexto';
import { useDia } from '../../src/ui/hooks';
import { Boton, estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../src/ui/tema';

/** Bodega: las solicitudes por despachar (se bajan con «Mi día»). Se elige de qué bodega sale cada material y cuánto; el despacho sale solo, con o sin señal. */
export default function Bodega() {
  const { datos } = useDia();
  const lista = datos?.solicitudes ?? [];
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Titulo>Solicitudes de material</Titulo>
      {!datos && <Mensaje texto="Descargue su día (en «Mi día») para ver las solicitudes." tipo="aviso" />}
      {datos && lista.length === 0 && <Texto suave>No hay solicitudes por despachar.</Texto>}
      {lista.map((s) => <Solicitud key={s.id} s={s} />)}
    </ScrollView>
  );
}

function Solicitud({ s }: { s: SolicitudDeMaterial }) {
  const servicios = useServicios();
  const [elegido, setElegido] = useState<Elecciones>(() => proponerDespacho(s));
  const [error, setError] = useState('');
  const problemas = problemasDeDespacho(s, elegido);
  const pendientes = s.lineas.filter((l) => l.pendiente > 0);

  const cambiar = (lineaId: number, cambio: Partial<{ bodega_id: number; cantidad: number }>): void =>
    setElegido((e) => {
      const previo = e[lineaId];
      const l = s.lineas.find((x) => x.id === lineaId)!;
      const bodega = cambio.bodega_id ?? previo?.bodega_id ?? l.por_bodega[0]?.bodega_id ?? 0;
      // Al cambiar de bodega se propone lo más que se puede sacar de ella.
      const cantidad = cambio.cantidad ?? (cambio.bodega_id !== undefined ? maximoADespachar(l, bodega) : (previo?.cantidad ?? 0));
      return { ...e, [lineaId]: { bodega_id: bodega, cantidad } };
    });
  const quitar = (lineaId: number): void => setElegido((e) => ({ ...e, [lineaId]: undefined }));

  const despachar = async (): Promise<void> => {
    setError('');
    try {
      await servicios.acciones.despachar(s.id, itemsDeDespacho(s, elegido), s.numero);
      setElegido({});
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar el despacho.');
    }
  };

  return (
    <Tarjeta>
      <Texto negrita>{s.numero} · orden {s.orden}</Texto>
      <Texto suave>{s.sucursal} · pidió {s.solicitante ?? '—'}</Texto>
      {s.lineas.map((l) => {
        const x = elegido[l.id];
        return (
          <View key={l.id} style={{ gap: 6, borderTopWidth: 1, borderColor: '#e5e7eb', paddingTop: 8 }}>
            <Texto negrita>{l.nombre}</Texto>
            <Texto suave>{l.codigo} · pidió {l.cantidad_solicitada} {l.unidad} · despachado {l.cantidad_despachada} · faltan {l.pendiente}</Texto>
            {l.pendiente > 0 && (
              <>
                <Texto suave>De qué bodega:</Texto>
                <View style={estilos.fila}>
                  {l.por_bodega.map((b) => (
                    <Boton key={b.bodega_id} texto={`${b.bodega} (${b.cantidad})`} variante={x?.bodega_id === b.bodega_id ? 'primario' : 'borde'} deshabilitado={b.cantidad <= 0} etiqueta={`${b.bodega}, hay ${b.cantidad}${x?.bodega_id === b.bodega_id ? ', elegida' : ''}`} alPulsar={() => cambiar(l.id, { bodega_id: b.bodega_id })} />
                  ))}
                </View>
                {x ? (
                  <View style={estilos.fila}>
                    <Boton texto="−" variante="borde" etiqueta={`Una menos de ${l.nombre}`} deshabilitado={x.cantidad <= 1} alPulsar={() => cambiar(l.id, { cantidad: x.cantidad - 1 })} />
                    <Texto negrita>Despachar {x.cantidad}</Texto>
                    <Boton texto="+" variante="borde" etiqueta={`Una más de ${l.nombre}`} deshabilitado={x.cantidad >= maximoADespachar(l, x.bodega_id)} alPulsar={() => cambiar(l.id, { cantidad: x.cantidad + 1 })} />
                    <Boton texto="No despachar" variante="borde" alPulsar={() => quitar(l.id)} />
                  </View>
                ) : (
                  <Boton texto="Despachar esta línea" variante="borde" deshabilitado={!l.por_bodega.some((b) => b.cantidad > 0)} alPulsar={() => cambiar(l.id, { bodega_id: l.por_bodega.find((b) => existenciaEn(l, b.bodega_id) > 0)?.bodega_id ?? 0 })} />
                )}
                {!l.por_bodega.some((b) => b.cantidad > 0) && <Mensaje texto="No hay existencia en ninguna bodega de esta sucursal." tipo="aviso" />}
              </>
            )}
          </View>
        );
      })}
      {pendientes.length > 0 && Object.values(elegido).some(Boolean) && problemas.map((p) => <Mensaje key={p} texto={p} tipo="error" />)}
      <Mensaje texto={error} tipo="error" />
      {pendientes.length > 0 && <Boton texto="Despachar lo elegido" alPulsar={() => void despachar()} deshabilitado={problemas.length > 0} />}
      {pendientes.length === 0 && <Mensaje texto="Esta solicitud ya se despachó completa." tipo="ok" />}
    </Tarjeta>
  );
}
