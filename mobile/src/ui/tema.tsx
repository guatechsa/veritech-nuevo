import { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle } from 'react-native';

/** Tema único de la app: los mismos colores del estándar GUATECH, objetivos táctiles de al menos 44 px y etiquetas para lectores de pantalla. */
export const color = {
  primario: '#4997D0',
  primarioOscuro: '#2f6f9f',
  texto: '#1f2937',
  suave: '#6b7280',
  borde: '#d1d5db',
  fondo: '#f3f4f6',
  blanco: '#ffffff',
  verde: '#15803d',
  amarillo: '#b45309',
  rojo: '#b91c1c',
  error: '#fee2e2',
  ok: '#dcfce7',
  aviso: '#fef3c7',
};

export const TAMANO_TACTIL = 44;

export function Boton({ texto, alPulsar, variante = 'primario', deshabilitado, cargando, estilo, etiqueta }: { texto: string; alPulsar: () => void; variante?: 'primario' | 'borde' | 'peligro'; deshabilitado?: boolean; cargando?: boolean; estilo?: ViewStyle; etiqueta?: string }) {
  const fondo = variante === 'primario' ? color.primario : variante === 'peligro' ? color.rojo : color.blanco;
  const letra = variante === 'borde' ? color.primarioOscuro : color.blanco;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={etiqueta ?? texto}
      accessibilityState={{ disabled: !!deshabilitado, busy: !!cargando }}
      disabled={deshabilitado || cargando}
      onPress={alPulsar}
      style={[estilos.boton, { backgroundColor: fondo, borderColor: variante === 'borde' ? color.primario : fondo, opacity: deshabilitado ? 0.5 : 1 }, estilo]}
    >
      {cargando ? <ActivityIndicator color={letra} /> : <Text style={[estilos.botonTexto, { color: letra }]}>{texto}</Text>}
    </Pressable>
  );
}

export function Tarjeta({ children, estilo }: { children: ReactNode; estilo?: ViewStyle }) {
  return <View style={[estilos.tarjeta, estilo]}>{children}</View>;
}

export function Titulo({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={estilos.titulo}>
      {children}
    </Text>
  );
}

export function Texto({ children, suave, negrita }: { children: ReactNode; suave?: boolean; negrita?: boolean }) {
  return <Text style={{ fontSize: 15, color: suave ? color.suave : color.texto, fontWeight: negrita ? '700' : '400' }}>{children}</Text>;
}

export function Mensaje({ texto, tipo }: { texto: string; tipo: 'error' | 'ok' | 'aviso' }) {
  if (!texto) return null;
  return (
    <View accessibilityRole={tipo === 'error' ? 'alert' : undefined} style={{ backgroundColor: tipo === 'error' ? color.error : tipo === 'ok' ? color.ok : color.aviso, padding: 10, borderRadius: 8 }}>
      <Text style={{ color: color.texto, fontSize: 14 }}>{texto}</Text>
    </View>
  );
}

export function Campo({ etiqueta, ...props }: { etiqueta: string } & TextInputProps) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontSize: 13, fontWeight: '600', color: color.texto }}>{etiqueta}</Text>
      <TextInput accessibilityLabel={etiqueta} placeholderTextColor={color.suave} style={estilos.campo} {...props} />
    </View>
  );
}

/** El semáforo se distingue por TEXTO e ícono además del color (no solo por color). */
export const SEMAFORO = {
  verde: { texto: '✔ Bien', fondo: color.ok, letra: color.verde },
  amarillo: { texto: '⚠ Atención', fondo: color.aviso, letra: color.amarillo },
  rojo: { texto: '✖ Mal', fondo: color.error, letra: color.rojo },
} as const;

export const estilos = StyleSheet.create({
  pantalla: { flex: 1, backgroundColor: color.fondo },
  contenido: { padding: 16, gap: 12 },
  tarjeta: { backgroundColor: color.blanco, borderRadius: 12, padding: 14, gap: 8, borderWidth: 1, borderColor: color.borde },
  titulo: { fontSize: 20, fontWeight: '700', color: color.texto },
  boton: { minHeight: TAMANO_TACTIL, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  botonTexto: { fontSize: 16, fontWeight: '700' },
  campo: { minHeight: TAMANO_TACTIL, borderWidth: 1, borderColor: color.borde, borderRadius: 10, paddingHorizontal: 12, backgroundColor: color.blanco, fontSize: 16, color: color.texto },
  fila: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
});
