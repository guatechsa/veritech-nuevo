import { Redirect, Slot, usePathname } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, View } from 'react-native';
import { ProveedorDeServicios, useApp } from '../src/plataforma/contexto';
import { color } from '../src/ui/tema';

/** La puerta de la app: sin sesión se va a la entrada; con sesión, a «Mi día». */
function Puerta() {
  const { estado } = useApp();
  const ruta = usePathname();
  if (estado.fase === 'cargando') {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: color.fondo }}>
        <ActivityIndicator size="large" color={color.primario} />
      </View>
    );
  }
  if (estado.fase === 'sinSesion' && ruta !== '/login') return <Redirect href="/login" />;
  if (estado.fase === 'listo' && ruta === '/login') return <Redirect href="/" />;
  return <Slot />;
}

export default function Raiz() {
  return (
    <ProveedorDeServicios>
      <StatusBar style="dark" />
      <Puerta />
    </ProveedorDeServicios>
  );
}
