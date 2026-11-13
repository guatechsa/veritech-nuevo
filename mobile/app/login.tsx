import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Switch, Text, View } from 'react-native';
import { ErrorDeRed, ErrorDelServidor } from '../src/nucleo/errores';
import { useApp } from '../src/plataforma/contexto';
import { Boton, Campo, color, estilos, Mensaje, Tarjeta, Titulo } from '../src/ui/tema';

/** Entrar: el taller, el correo y la contraseña. La contraseña NUNCA se guarda; «recordar» guarda solo el correo. */
export default function Entrar() {
  const { estado, ingresar } = useApp();
  const previo = estado.fase === 'sinSesion' ? estado : null;
  const [taller, setTaller] = useState(previo?.slug ?? '');
  const [correo, setCorreo] = useState(previo?.correo ?? '');
  const [contrasena, setContrasena] = useState('');
  const [recordar, setRecordar] = useState(true);
  const [error, setError] = useState('');
  const [entrando, setEntrando] = useState(false);

  const enviar = async (): Promise<void> => {
    setError('');
    setEntrando(true);
    try {
      await ingresar(taller, correo, contrasena, recordar);
    } catch (e) {
      setError(e instanceof ErrorDeRed ? e.message : e instanceof ErrorDelServidor ? e.message : 'No se pudo ingresar. Intente de nuevo.');
    } finally {
      setEntrando(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={estilos.pantalla}>
      <ScrollView contentContainerStyle={[estilos.contenido, { justifyContent: 'center', flexGrow: 1 }]} keyboardShouldPersistTaps="handled">
        <Tarjeta>
          <Titulo>VERI-TECH</Titulo>
          <Text style={{ color: color.suave }}>Ingrese con el correo y la contraseña que le dio su taller.</Text>
          <Mensaje texto={previo?.aviso ?? ''} tipo="aviso" />
          <Campo etiqueta="Su taller" value={taller} onChangeText={setTaller} autoCapitalize="none" autoCorrect={false} placeholder="el nombre de su taller en la dirección" />
          <Campo etiqueta="Correo" value={correo} onChangeText={setCorreo} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
          <Campo etiqueta="Contraseña" value={contrasena} onChangeText={setContrasena} secureTextEntry autoCapitalize="none" autoComplete="current-password" />
          <View style={estilos.fila}>
            <Switch value={recordar} onValueChange={setRecordar} accessibilityLabel="Recordar mi correo" />
            <Text>Recordar mi correo</Text>
          </View>
          <Mensaje texto={error} tipo="error" />
          <Boton texto="Entrar" alPulsar={() => void enviar()} cargando={entrando} deshabilitado={!taller.trim() || !correo.trim() || !contrasena} />
        </Tarjeta>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
