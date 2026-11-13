import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { datosDelTelefono, Servicios } from './servicios';

/**
 * Avisos al teléfono: se pide el permiso, se obtiene el código del teléfono y se le manda al servidor (que lo usa para mandar «trabajo asignado», «material
 * cargado», etc.). Si la persona no da permiso o el teléfono no puede recibir avisos, la app sigue funcionando igual.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
});

export async function registrarParaAvisos(s: Servicios): Promise<boolean> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', { name: 'Avisos del taller', importance: Notifications.AndroidImportance.DEFAULT });
  }
  const permiso = await Notifications.getPermissionsAsync();
  const final = permiso.granted ? permiso : await Notifications.requestPermissionsAsync();
  if (!final.granted) return false;
  const proyecto = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  if (!proyecto) return false; // sin proyecto de Expo configurado no hay código de avisos (se configura al publicar)
  const token = (await Notifications.getExpoPushTokenAsync({ projectId: proyecto })).data;
  const t = await datosDelTelefono();
  await s.cliente.solicitar('POST', '/movil/dispositivo', { cuerpo: { ...t, token_push: token } });
  return true;
}
