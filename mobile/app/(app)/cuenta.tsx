import { useEffect, useState } from 'react';
import { Alert, ScrollView, Switch, View } from 'react-native';
import { Cambio } from '../../src/nucleo/cola';
import { HayPendientes } from '../../src/nucleo/errores';
import { useApp, useEstadoDeEnvio, useServicios } from '../../src/plataforma/contexto';
import { VERSION_DE_LA_APP } from '../../src/plataforma/servicios';
import { Boton, estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../src/ui/tema';

interface PreferenciaDeAviso {
  tipo: string;
  nombre: string;
  activo: boolean;
}

/** Mi cuenta: lo que falta por enviar (con la opción de reintentar o descartar cada cambio), los avisos y cerrar la sesión. */
export default function Cuenta() {
  const s = useServicios();
  const { salir } = useApp();
  const estado = useEstadoDeEnvio();
  const [cambios, setCambios] = useState<Cambio[]>([]);
  const [avisos, setAvisos] = useState<PreferenciaDeAviso[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const leer = (): void => void s.cola.todos().then(setCambios);
    leer();
    return s.cola.escuchar(leer);
  }, [s]);
  useEffect(() => {
    s.cliente.get<PreferenciaDeAviso[]>('/movil/preferencias-aviso').then(setAvisos).catch(() => setAvisos([]));
  }, [s]);

  const alternar = async (a: PreferenciaDeAviso, activo: boolean): Promise<void> => {
    setError('');
    try {
      await s.cliente.solicitar('PUT', `/movil/preferencias-aviso/${a.tipo}`, { cuerpo: { activo } });
      setAvisos((x) => x.map((y) => (y.tipo === a.tipo ? { ...y, activo } : y)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cambiar el aviso (hace falta señal).');
    }
  };

  const cerrar = async (): Promise<void> => {
    try {
      await salir(false);
    } catch (e) {
      if (!(e instanceof HayPendientes)) return setError(e instanceof Error ? e.message : 'No se pudo cerrar la sesión.');
      Alert.alert('Hay cambios sin enviar', `${e.message}\n\n¿Quiere salir y perderlos?`, [
        { text: 'No, esperar a enviarlos', style: 'cancel' },
        { text: 'Salir y perderlos', style: 'destructive', onPress: () => void salir(true) },
      ]);
    }
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Titulo>Mi cuenta</Titulo>
      <Tarjeta>
        <Texto negrita>{s.sesion.nombre}</Texto>
        <Texto suave>Taller: {s.slug} · versión {VERSION_DE_LA_APP}</Texto>
        {estado?.ultimaSincronizacion && <Texto suave>Último envío: {estado.ultimaSincronizacion.slice(0, 16).replace('T', ' ')} (UTC)</Texto>}
      </Tarjeta>

      <Tarjeta>
        <Texto negrita>Cambios sin enviar: {cambios.length}</Texto>
        {cambios.length === 0 && <Texto suave>Todo lo que hizo ya se envió.</Texto>}
        {cambios.map((c) => (
          <View key={c.id} style={{ gap: 6, borderTopWidth: 1, borderColor: '#e5e7eb', paddingTop: 8 }}>
            <Texto negrita>{c.titulo}</Texto>
            <Texto suave>{c.estado === 'pendiente' ? 'En espera de enviarse' : c.estado === 'rechazado' ? 'El servidor lo rechazó' : 'No se pudo enviar'}</Texto>
            {c.motivo ? <Mensaje texto={c.motivo} tipo="error" /> : null}
            {c.estado !== 'pendiente' && (
              <View style={estilos.fila}>
                <Boton texto="Reintentar" variante="borde" alPulsar={() => void s.cola.reintentar(c.id).then(() => s.sincronizador.sincronizar())} />
                <Boton texto="Descartar" variante="peligro" alPulsar={() => Alert.alert('Descartar cambio', `¿Descartar «${c.titulo}»? No se enviará.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Descartar', style: 'destructive', onPress: () => void s.cola.quitar(c.id) }])} />
              </View>
            )}
          </View>
        ))}
        {cambios.length > 0 && <Boton texto="Enviar ahora" variante="borde" alPulsar={() => void s.sincronizador.sincronizar()} />}
      </Tarjeta>

      {avisos.length > 0 && (
        <Tarjeta>
          <Texto negrita>Avisos al teléfono</Texto>
          {avisos.map((a) => (
            <View key={a.tipo} style={[estilos.fila, { justifyContent: 'space-between', flexWrap: 'nowrap' }]}>
              <View style={{ flex: 1 }}><Texto>{a.nombre}</Texto></View>
              <Switch value={a.activo} onValueChange={(v) => void alternar(a, v)} accessibilityLabel={a.nombre} />
            </View>
          ))}
        </Tarjeta>
      )}
      <Mensaje texto={error} tipo="error" />
      <Boton texto="Cerrar sesión" variante="peligro" alPulsar={() => void cerrar()} />
    </ScrollView>
  );
}
