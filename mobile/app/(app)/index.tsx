import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { useServicios } from '../../src/plataforma/contexto';
import { fechaCorta } from '../../src/nucleo/fechas';
import { haceCuanto, useDia } from '../../src/ui/hooks';
import { Boton, estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../src/ui/tema';

/** Mi día: baja todo lo que la persona necesita para trabajar sin señal y muestra un resumen de lo que hay. */
export default function MiDia() {
  const s = useServicios();
  const r = useRouter();
  const v = useDia();
  const [resultado, setResultado] = useState('');
  const d = v.datos;

  const bajar = async (): Promise<void> => {
    setResultado('');
    const x = await v.descargar();
    if (x) setResultado(x.fotosFaltan > 0 || x.partesIncompletas.length > 0 ? `Listo, pero faltó algo: ${x.fotosFaltan} fotos${x.partesIncompletas.length ? ` y ${x.partesIncompletas.join(', ')}` : ''}. Intente de nuevo con mejor señal.` : 'Listo: ya puede trabajar sin señal.');
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido}>
      <Titulo>Hola, {s.sesion.nombre}</Titulo>
      <Tarjeta>
        <Texto negrita>Descargar mi día</Texto>
        <Texto suave>Baja sus trabajos, checklists y fichas de equipos para que pueda trabajar aunque no haya señal.</Texto>
        <Text accessibilityLiveRegion="polite" style={{ fontSize: 13 }}>{haceCuanto(v.descargadoHace)}</Text>
        <Boton texto="Descargar mi día" alPulsar={() => void bajar()} cargando={v.cargando} />
        <Mensaje texto={v.error} tipo="error" />
        <Mensaje texto={resultado} tipo={resultado.startsWith('Listo:') ? 'ok' : 'aviso'} />
        {v.faltan.length > 0 && <Mensaje texto={`${v.faltan.length} fotos o documentos no se pudieron bajar: sin señal no se verán.`} tipo="aviso" />}
      </Tarjeta>

      {d && (
        <>
          {d.trabajos && (
            <Tarjeta>
              <Texto negrita>Mis trabajos: {d.trabajos.trabajos.filter((t) => t.estado !== 'terminado').length}</Texto>
              {d.trabajos.ocupado && <Texto suave>Tiene un trabajo en proceso.</Texto>}
              <Boton texto="Ver mis trabajos" variante="borde" alPulsar={() => r.push('/trabajos')} />
            </Tarjeta>
          )}
          {d.checklists.length > 0 && (
            <Tarjeta>
              <Texto negrita>Checklists por llenar: {d.checklists.filter((c) => c.estado !== 'completado').length}</Texto>
              <Boton texto="Ver checklists" variante="borde" alPulsar={() => r.push('/checklists')} />
            </Tarjeta>
          )}
          {d.solicitudes && (
            <Tarjeta>
              <Texto negrita>Solicitudes de material por despachar: {d.solicitudes.length}</Texto>
              <Boton texto="Ir a bodega" variante="borde" alPulsar={() => r.push('/bodega')} />
            </Tarjeta>
          )}
          {d.citas && (
            <Tarjeta>
              <Texto negrita>Citas de hoy y mañana: {d.citas.length}</Texto>
              <Boton texto="Ver citas" variante="borde" alPulsar={() => r.push('/citas')} />
            </Tarjeta>
          )}
          <Texto suave>Datos al {fechaCorta(d.hoy)}</Texto>
        </>
      )}
    </ScrollView>
  );
}
