import { CameraView, useCameraPermissions } from 'expo-camera';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { fechaCorta } from '../../src/nucleo/fechas';
import { useServicios } from '../../src/plataforma/contexto';
import { Boton, estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../src/ui/tema';

interface FichaPublica {
  equipo: { etiqueta: string; placa: string | null; serie: string | null; marca: string | null; modelo: string | null; anio: number | null; tipo: string; fuera_de_servicio: boolean };
  servicios: Array<{ servicio: string; estado: string }>;
  historial: Array<{ numero: string; cerrada_en: string | null; tipo: string; descripcion: string | null }>;
}

/** Escanear el QR pegado a un equipo: abre su ficha y su historial (requiere señal). */
export default function Escanear() {
  const s = useServicios();
  const [permiso, pedirPermiso] = useCameraPermissions();
  const [ficha, setFicha] = useState<FichaPublica | null>(null);
  const [error, setError] = useState('');
  const [leyendo, setLeyendo] = useState(false);

  const alLeer = async (dato: string): Promise<void> => {
    if (leyendo) return;
    const m = /\/equipo\/([0-9a-f]{16})(?:[/?#]|$)/.exec(dato);
    if (!m) return setError('Ese código QR no es de un equipo de VERI-TECH.');
    setLeyendo(true);
    setError('');
    try {
      setFicha(await s.cliente.get<FichaPublica>(`/publico/equipo/${m[1]}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo abrir la ficha.');
    } finally {
      setLeyendo(false);
    }
  };

  if (!permiso) return <View style={estilos.pantalla} />;
  if (!permiso.granted) {
    return (
      <View style={[estilos.pantalla, estilos.contenido]}>
        <Titulo>Escanear QR</Titulo>
        <Mensaje texto="Para escanear el código de un equipo necesitamos usar la cámara." tipo="aviso" />
        <Boton texto="Permitir la cámara" alPulsar={() => void pedirPermiso()} />
      </View>
    );
  }
  if (ficha) {
    return (
      <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
        <Titulo>{ficha.equipo.etiqueta || ficha.equipo.tipo}</Titulo>
        {ficha.equipo.fuera_de_servicio && <Mensaje texto="Fuera de servicio" tipo="error" />}
        <Tarjeta>
          <Texto>{[ficha.equipo.tipo, ficha.equipo.marca, ficha.equipo.modelo, ficha.equipo.anio].filter(Boolean).join(' · ')}</Texto>
          {ficha.equipo.serie && <Texto suave>Serie / VIN: {ficha.equipo.serie}</Texto>}
        </Tarjeta>
        {ficha.servicios.length > 0 && <Tarjeta><Texto negrita>Servicios programados</Texto>{ficha.servicios.map((x) => <Texto key={x.servicio}>{x.servicio}: {x.estado.replace('_', ' ')}</Texto>)}</Tarjeta>}
        <Tarjeta>
          <Texto negrita>Lo que se le ha hecho</Texto>
          {ficha.historial.length === 0 && <Texto suave>Todavía no hay trabajos terminados.</Texto>}
          {ficha.historial.map((h) => <Texto key={h.numero}>{fechaCorta(h.cerrada_en)} · {h.tipo}{h.descripcion ? ` — ${h.descripcion}` : ''}</Texto>)}
        </Tarjeta>
        <Boton texto="Escanear otro" variante="borde" alPulsar={() => setFicha(null)} />
      </ScrollView>
    );
  }
  return (
    <View style={{ flex: 1 }}>
      <CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={(r) => void alLeer(r.data)} accessibilityLabel="Cámara para escanear el código QR de un equipo" />
      <View style={{ position: 'absolute', bottom: 16, left: 16, right: 16 }}>
        <Mensaje texto={error || (leyendo ? 'Abriendo la ficha…' : 'Apunte la cámara al código QR del equipo.')} tipo={error ? 'error' : 'aviso'} />
      </View>
    </View>
  );
}
