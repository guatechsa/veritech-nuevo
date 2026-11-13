import * as LocalAuthentication from 'expo-local-authentication';
import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { Autenticador, Candado } from '../nucleo/bloqueo';
import { Boton, color, estilos } from '../ui/tema';
import { almacenSqlite } from './almacen';

/** La huella, la cara o el PIN/patrón del TELÉFONO (la app no guarda ninguna clave propia para esto). */
export const autenticadorDelTelefono: Autenticador = {
  async disponible() {
    // `getEnrolledLevelAsync` dice si hay AL MENOS un bloqueo de pantalla (PIN, patrón, huella o cara).
    return (await LocalAuthentication.getEnrolledLevelAsync()) !== LocalAuthentication.SecurityLevel.NONE;
  },
  async pedir(motivo) {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: motivo, cancelLabel: 'Cancelar', disableDeviceFallback: false });
    return r.success;
  },
};

const CLAVE = 'candado:activo';

const Ctx = createContext<Candado | null>(null);

/** Cambia a «candado activo» y lo guarda. */
export async function guardarCandadoActivo(activo: boolean): Promise<void> {
  await almacenSqlite.escribir(CLAVE, activo);
}

/**
 * Pone el candado alrededor de TODA la app con sesión: mientras está bloqueada se tapa todo con una pantalla de desbloqueo. Por defecto está activo; la persona puede apagarlo en «Mi cuenta».
 */
export function ProveedorDeCandado({ children }: { children: ReactNode }) {
  const [candado, setCandado] = useState<Candado | null>(null);
  const [, repintar] = useState(0);

  useEffect(() => {
    let vivo = true;
    let quitar: (() => void) | null = null;
    let app: { remove(): void } | null = null;
    (async () => {
      const activo = (await almacenSqlite.leer<boolean>(CLAVE)) ?? true;
      const c = new Candado({ autenticador: autenticadorDelTelefono, reloj: { ahora: () => new Date() }, activo });
      quitar = c.escuchar(() => vivo && repintar((n) => n + 1));
      app = AppState.addEventListener('change', (e) => {
        if (e === 'active') void c.alVolver();
        else c.alSegundoPlano();
      });
      await c.iniciar();
      if (!vivo) return;
      setCandado(c);
      if (c.bloqueado) void c.desbloquear(); // ya pide la huella al abrir; si cancela, queda el botón
    })().catch(() => vivo && setCandado(new Candado({ autenticador: autenticadorDelTelefono, reloj: { ahora: () => new Date() }, activo: false })));
    return () => {
      vivo = false;
      quitar?.();
      app?.remove();
    };
  }, []);

  // Mientras se decide, no se muestra nada (así no aparece un instante lo que luego se bloquea).
  if (!candado) return <View style={estilos.pantalla} />;
  const bloqueado = candado.bloqueado;
  // Las pantallas siguen montadas debajo (así no se pierde lo que la persona estaba haciendo), pero tapadas y fuera del alcance de los lectores de pantalla.
  return (
    <Ctx.Provider value={candado}>
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }} importantForAccessibility={bloqueado ? 'no-hide-descendants' : 'auto'} accessibilityElementsHidden={bloqueado}>
          {children}
        </View>
        {bloqueado && (
          <View style={[StyleSheet.absoluteFill, estilos.pantalla, { justifyContent: 'center', padding: 24, gap: 16 }]} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', color: color.texto, textAlign: 'center' }}>VERI-TECH está bloqueada</Text>
            <Text style={{ fontSize: 15, color: color.suave, textAlign: 'center' }}>Confirme que es usted con su huella, su cara o el PIN del teléfono.</Text>
            <Boton texto="Desbloquear" alPulsar={() => void candado.desbloquear()} />
          </View>
        )}
      </View>
    </Ctx.Provider>
  );
}

export function useCandado(): Candado {
  const c = useContext(Ctx);
  if (!c) throw new Error('Falta el candado');
  return c;
}
