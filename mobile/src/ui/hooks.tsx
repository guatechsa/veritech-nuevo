import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { MiDia, ResultadoDeDescarga } from '../nucleo/dia';
import { ErrorDeRed } from '../nucleo/errores';
import { useEstadoDeEnvio, useServicios } from '../plataforma/contexto';
import { color } from './tema';

export interface VistaDelDia {
  datos: MiDia | null;
  descargadoHace: number | null;
  faltan: string[];
  cargando: boolean;
  error: string;
  /** Baja el día del servidor (con señal). */
  descargar(): Promise<ResultadoDeDescarga | null>;
}

/** Lo bajado + los cambios sin enviar, siempre al día (se actualiza solo cuando la cola cambia). */
export function useDia(): VistaDelDia {
  const s = useServicios();
  const [vista, setVista] = useState<{ datos: MiDia | null; hace: number | null; faltan: string[] }>({ datos: null, hace: null, faltan: [] });
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState('');
  const leer = useCallback(async () => {
    const v = await s.dia.ver();
    setVista({ datos: v?.datos ?? null, hace: v?.descargadoHace ?? null, faltan: v?.faltan ?? [] });
  }, [s]);
  useEffect(() => {
    void leer();
    return s.cola.escuchar(() => void leer());
  }, [s, leer]);
  const descargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      // Primero se envía lo pendiente: así lo que se hizo sin señal no se pisa con lo bajado.
      await s.sincronizador.sincronizar();
      const r = await s.dia.descargar();
      await leer();
      return r;
    } catch (e) {
      setError(e instanceof ErrorDeRed ? e.message : e instanceof Error ? e.message : 'No se pudo descargar.');
      return null;
    } finally {
      setCargando(false);
    }
  }, [s, leer]);
  return { datos: vista.datos, descargadoHace: vista.hace, faltan: vista.faltan, cargando, error, descargar };
}

/** Abre la cámara y devuelve la dirección de la foto (o nulo si se canceló o no hay permiso). */
export async function tomarFoto(): Promise<string | null> {
  const permiso = await ImagePicker.requestCameraPermissionsAsync();
  if (!permiso.granted) return null;
  const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
  return r.canceled ? null : (r.assets[0]?.uri ?? null);
}

export function haceCuanto(ms: number | null): string {
  if (ms === null) return 'Todavía no ha descargado su día.';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'Descargado hace un momento.';
  if (min < 60) return `Descargado hace ${min} min.`;
  const h = Math.floor(min / 60);
  return h < 24 ? `Descargado hace ${h} h.` : 'Descargado hace más de un día: conviene descargar de nuevo.';
}

/** La franja de arriba: dice si hay señal, cuánto falta por enviar y si algo se rechazó. Siempre honesta. */
export function BarraDeEnvio() {
  const e = useEstadoDeEnvio();
  const s = useServicios();
  if (!e) return null;
  const problemas = e.conError + e.rechazados;
  let texto = '✔ Todo enviado';
  let fondo: string = color.ok;
  if (e.sesionVencida) {
    texto = 'Su sesión venció: ingrese de nuevo para enviar lo pendiente.';
    fondo = color.error;
  } else if (problemas > 0) {
    texto = `⚠ ${problemas} ${problemas === 1 ? 'cambio no se pudo enviar' : 'cambios no se pudieron enviar'} (vea Mi cuenta)`;
    fondo = color.error;
  } else if (e.red !== 'ok') {
    texto = e.red === 'sin_senal' ? `Sin señal · ${e.pendientes} por enviar (se envían solos al volver la señal)` : e.red === 'senal_debil' ? `Señal débil · ${e.pendientes} por enviar` : `El servidor no responde · ${e.pendientes} por enviar`;
    fondo = color.aviso;
  } else if (e.pendientes > 0) {
    texto = `Enviando ${e.pendientes}…`;
    fondo = color.aviso;
  }
  return (
    <View accessibilityRole="summary" accessibilityLabel={texto} style={{ backgroundColor: fondo, paddingVertical: 8, paddingHorizontal: 12 }} onTouchEnd={() => void s.sincronizador.sincronizar().catch(() => undefined)}>
      <Text style={{ fontSize: 13, color: color.texto }}>{texto}</Text>
    </View>
  );
}
