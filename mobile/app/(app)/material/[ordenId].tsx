import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { agregarAlCarrito, aLineasDeSolicitud, buscarMateriales, cambiarCantidad, LineaDelCarrito, problemasDeSolicitud } from '../../../src/nucleo/materiales';
import { useServicios } from '../../../src/plataforma/contexto';
import { useDia } from '../../../src/ui/hooks';
import { Boton, Campo, estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../../src/ui/tema';

/** Pedir material a la bodega para una orden: se busca en el catálogo que se bajó con «Mi día» y la solicitud sale sola (con o sin señal). */
export default function PedirMaterial() {
  const { ordenId } = useLocalSearchParams<{ ordenId: string }>();
  const s = useServicios();
  const r = useRouter();
  const { datos } = useDia();
  const [texto, setTexto] = useState('');
  const [carrito, setCarrito] = useState<LineaDelCarrito[]>([]);
  const [notas, setNotas] = useState('');
  const [error, setError] = useState('');
  const catalogo = datos?.catalogos?.materiales ?? [];
  const orden = datos?.ordenes.find((o) => o.id === Number(ordenId));
  const resultados = useMemo(() => buscarMateriales(catalogo, texto), [catalogo, texto]);

  if (!datos) return <View style={estilos.pantalla}><Mensaje texto="Descargue su día (en «Mi día») para tener el catálogo de materiales." tipo="aviso" /></View>;
  if (catalogo.length === 0) return <View style={estilos.pantalla}><Mensaje texto="No hay materiales en su día descargado: descargue de nuevo con señal, o pida permiso para solicitar material." tipo="aviso" /></View>;

  const problemas = problemasDeSolicitud(carrito);
  const enviar = async (): Promise<void> => {
    setError('');
    try {
      await s.acciones.solicitarMaterial(Number(ordenId), aLineasDeSolicitud(carrito), notas.trim() || undefined);
      r.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar la solicitud.');
    }
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Titulo>Pedir material{orden ? ` · orden ${orden.numero}` : ''}</Titulo>
      <Tarjeta>
        <Texto negrita>Su solicitud ({carrito.length})</Texto>
        {carrito.length === 0 && <Texto suave>Busque abajo y toque un material para agregarlo.</Texto>}
        {carrito.map((l) => (
          <View key={l.material_id} style={{ gap: 6, borderTopWidth: 1, borderColor: '#e5e7eb', paddingTop: 8 }}>
            <Texto negrita>{l.nombre}</Texto>
            <Texto suave>{l.codigo} · {l.unidad}</Texto>
            <View style={estilos.fila}>
              <Boton texto="−" variante="borde" etiqueta={`Una menos de ${l.nombre}`} alPulsar={() => setCarrito((c) => cambiarCantidad(c, l.material_id, l.cantidad - 1))} />
              <Texto negrita>{l.cantidad}</Texto>
              <Boton texto="+" variante="borde" etiqueta={`Una más de ${l.nombre}`} alPulsar={() => setCarrito((c) => cambiarCantidad(c, l.material_id, l.cantidad + 1))} />
              <Boton texto="Quitar" variante="peligro" etiqueta={`Quitar ${l.nombre}`} alPulsar={() => setCarrito((c) => cambiarCantidad(c, l.material_id, 0))} />
            </View>
          </View>
        ))}
        {carrito.length > 0 && <Campo etiqueta="Notas para la bodega (opcional)" value={notas} onChangeText={setNotas} maxLength={300} />}
        {carrito.length > 0 && problemas.map((p) => <Mensaje key={p} texto={p} tipo="error" />)}
        <Mensaje texto={error} tipo="error" />
        <Boton texto="Enviar solicitud a la bodega" alPulsar={() => void enviar()} deshabilitado={problemas.length > 0} />
      </Tarjeta>

      <Campo etiqueta="Buscar material (nombre o código)" value={texto} onChangeText={setTexto} autoCapitalize="none" autoCorrect={false} />
      {resultados.length === 0 && <Texto suave>No hay materiales con ese nombre.</Texto>}
      {resultados.map((m) => (
        <Tarjeta key={m.id}>
          <Texto negrita>{m.nombre}</Texto>
          <Texto suave>{m.codigo} · {m.unidad}</Texto>
          <Boton texto="Agregar" variante="borde" etiqueta={`Agregar ${m.nombre}`} alPulsar={() => setCarrito((c) => agregarAlCarrito(c, m))} />
        </Tarjeta>
      ))}
    </ScrollView>
  );
}
