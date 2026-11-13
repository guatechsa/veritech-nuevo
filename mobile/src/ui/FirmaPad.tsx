import { useRef, useState } from 'react';
import { Modal, PanResponder, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { esFirmaValida, firmaEnBase64, Trazo } from '../nucleo/firma';
import { Boton, Campo, color, estilos, Mensaje, Texto, Titulo } from './tema';

/** El lienzo donde el cliente firma con el dedo. Guarda los trazos tal cual (el núcleo los convierte en imagen). */
function Lienzo({ alCambiar }: { alCambiar: (trazos: Trazo[], ancho: number, alto: number) => void }) {
  const [trazos, setTrazos] = useState<Trazo[]>([]);
  const medida = useRef({ ancho: 300, alto: 150 });
  const actual = useRef<Trazo[]>([]);
  const origen = useRef({ x: 0, y: 0 });

  const poner = (t: Trazo[]): void => {
    actual.current = t;
    setTrazos(t);
    alCambiar(t, medida.current.ancho, medida.current.alto);
  };
  const gestos = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false, // nadie (ni una lista que se desplaza) le quita el dedo mientras firma
      onPanResponderGrant: (e) => {
        origen.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY };
        poner([...actual.current, [{ ...origen.current }]]);
      },
      onPanResponderMove: (_e, g) => {
        const t = actual.current.slice();
        const ultimo = t[t.length - 1];
        if (!ultimo) return;
        t[t.length - 1] = [...ultimo, { x: origen.current.x + g.dx, y: origen.current.y + g.dy }];
        poner(t);
      },
    })
  ).current;

  return (
    <View style={{ gap: 8 }}>
      <View
        {...gestos.panHandlers}
        onLayout={(e) => {
          medida.current = { ancho: e.nativeEvent.layout.width, alto: e.nativeEvent.layout.height };
        }}
        accessibilityLabel="Espacio para firmar con el dedo"
        style={{ height: 200, backgroundColor: color.blanco, borderWidth: 1, borderColor: color.borde, borderRadius: 10, overflow: 'hidden' }}
      >
        <Svg width="100%" height="100%" pointerEvents="none">
          {trazos.map((t, i) =>
            t.length === 1 ? <Circle key={i} cx={t[0]!.x} cy={t[0]!.y} r={1.5} fill="#000" /> : <Polyline key={i} points={t.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#000" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          )}
        </Svg>
      </View>
      <Boton texto="Borrar y empezar de nuevo" variante="borde" alPulsar={() => poner([])} deshabilitado={trazos.length === 0} />
    </View>
  );
}

/** Pantalla completa para que el cliente escriba su nombre y firme. Devuelve el nombre y la imagen PNG (base64). */
export function FirmaModal({ visible, titulo, alCancelar, alFirmar }: { visible: boolean; titulo: string; alCancelar: () => void; alFirmar: (nombre: string, imagenBase64: string) => void }) {
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const trazos = useRef<{ t: Trazo[]; ancho: number; alto: number }>({ t: [], ancho: 300, alto: 200 });
  const [hayFirma, setHayFirma] = useState(false);

  const guardar = (): void => {
    if (nombre.trim().length < 3) return setError('Escriba el nombre completo de quien firma.');
    if (!esFirmaValida(trazos.current.t, trazos.current.ancho)) return setError('La firma es muy corta: pídale al cliente que firme con calma.');
    setError('');
    alFirmar(nombre.trim(), firmaEnBase64(trazos.current.t, trazos.current.ancho, trazos.current.alto));
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={alCancelar} supportedOrientations={['portrait']}>
      <View style={[estilos.pantalla, estilos.contenido]}>
        <Titulo>{titulo}</Titulo>
        <Texto suave>Entregue el teléfono al cliente: debe escribir su nombre y firmar con el dedo.</Texto>
        <Campo etiqueta="Nombre completo de quien firma" value={nombre} onChangeText={setNombre} autoCapitalize="words" />
        <Lienzo
          alCambiar={(t, ancho, alto) => {
            trazos.current = { t, ancho, alto };
            setHayFirma(t.length > 0);
          }}
        />
        <Mensaje texto={error} tipo="error" />
        <View style={estilos.fila}>
          <Boton texto="Cancelar" variante="borde" alPulsar={alCancelar} />
          <Boton texto="Guardar firma" alPulsar={guardar} deshabilitado={!hayFirma} />
        </View>
      </View>
    </Modal>
  );
}
