import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { pantallasPara } from '../../src/nucleo/menu';
import { useServicios } from '../../src/plataforma/contexto';
import { BarraDeEnvio } from '../../src/ui/hooks';
import { color } from '../../src/ui/tema';

/** El menú sale de los PERMISOS de la persona (no de su rol): cada pantalla aparece solo si tiene el permiso. Las de detalle no salen en el menú. */
export default function Menu() {
  const s = useServicios();
  const visibles = new Set(pantallasPara(s.sesion.permisos).map((p) => p.id));
  const pestana = (id: string, titulo: string) => ({ title: titulo, href: visibles.has(id as never) ? undefined : null });
  return (
    <View style={{ flex: 1 }}>
      <BarraDeEnvio />
      <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: color.primarioOscuro, tabBarLabelStyle: { fontSize: 12 }, tabBarStyle: { minHeight: 56 } }}>
        <Tabs.Screen name="index" options={pestana('inicio', 'Mi día')} />
        <Tabs.Screen name="trabajos" options={pestana('trabajos', 'Trabajos')} />
        <Tabs.Screen name="checklists" options={pestana('checklists', 'Checklists')} />
        <Tabs.Screen name="bodega" options={pestana('bodega', 'Bodega')} />
        <Tabs.Screen name="citas" options={pestana('citas', 'Citas')} />
        <Tabs.Screen name="escanear" options={pestana('escanear', 'Escanear')} />
        <Tabs.Screen name="cuenta" options={pestana('cuenta', 'Mi cuenta')} />
        <Tabs.Screen name="trabajo/[id]" options={{ href: null, title: 'Trabajo' }} />
        <Tabs.Screen name="checklist/[id]" options={{ href: null, title: 'Checklist' }} />
      </Tabs>
    </View>
  );
}
