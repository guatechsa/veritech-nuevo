import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { RespuestaDeChecklist } from '../../../src/nucleo/dia';
import { numeroDe } from '../../../src/nucleo/fechas';
import { fotosPorSubir, necesitaFoto, problemasParaCompletar, puedeAgregarFoto, totalDeFotos } from '../../../src/nucleo/reglas';
import { useEstadoDeEnvio, useServicios } from '../../../src/plataforma/contexto';
import { FirmaModal } from '../../../src/ui/FirmaPad';
import { tomarFoto, useDia } from '../../../src/ui/hooks';
import { Boton, Campo, color, estilos, Mensaje, SEMAFORO, Tarjeta, Texto, Titulo } from '../../../src/ui/tema';

/** Llenar un checklist: cada punto se guarda al instante en el teléfono (con o sin señal). Un checklist completado es solo lectura. */
export default function Checklist() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const s = useServicios();
  const r = useRouter();
  const { datos } = useDia();
  const [lectura, setLectura] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [firmando, setFirmando] = useState(false);
  const [cotizando, setCotizando] = useState(false);
  const [resultado, setResultado] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const envio = useEstadoDeEnvio();
  const c = datos?.checklists.find((x) => x.id === Number(id));
  if (!c || !datos) return <View style={estilos.pantalla}><Mensaje texto="No encontramos ese checklist en su día descargado." tipo="aviso" /></View>;

  const soloLectura = c.estado === 'completado';
  const equipo = datos.equipos.find((e) => e.id === c.equipo_id);
  const contador = equipo?.contadores?.find((k) => (k as { es_principal?: number }).es_principal === 1) ?? equipo?.contadores?.[0];
  const lecturaNum = lectura.trim() === '' ? null : numeroDe(lectura);
  const problemas = problemasParaCompletar(c, c.exige_lectura_contador ? lecturaNum : null);
  const sinSubir = fotosPorSubir(c);

  const responder = (x: RespuestaDeChecklist, valores: Parameters<typeof s.acciones.responderItem>[2]): void => void s.acciones.responderItem(c.id, x.id, valores, x.descripcion);
  const foto = async (x: RespuestaDeChecklist): Promise<void> => {
    setMensaje('');
    const uri = await tomarFoto();
    if (!uri) return setMensaje('No se tomó la foto (revise el permiso de la cámara).');
    try {
      await s.acciones.agregarFotoDeItem(c.id, x, uri);
    } catch (e) {
      setMensaje(e instanceof Error ? e.message : 'No se pudo guardar la foto.');
    }
  };
  const firmante = c.firma_local?.nombre ?? c.firma?.firmante_nombre ?? null;
  const hayRojos = c.respuestas.some((x) => x.semaforo === 'rojo');
  const puedeCotizar = s.sesion.permisos.includes('cotizaciones.crear') && hayRojos && c.estado === 'completado';
  const cotizar = async (): Promise<void> => {
    setCotizando(true);
    setResultado(null);
    try {
      const r = await s.enLinea.cotizarRojos(c.id);
      setResultado({ texto: `Cotización ${r.numero ?? `#${r.id}`} creada con los puntos en rojo. Complétela y envíela al cliente desde el sistema.`, tipo: 'ok' });
    } catch (e) {
      setResultado({ texto: e instanceof Error ? e.message : 'No se pudo crear la cotización.', tipo: 'error' });
    } finally {
      setCotizando(false);
    }
  };
  const completar = async (): Promise<void> => {
    await s.acciones.completarChecklist(c.id, c.exige_lectura_contador && contador && lecturaNum !== null ? { contador_id: contador.id, valor: lecturaNum } : null, c.tipo);
    r.back();
  };

  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Titulo>{c.tipo}</Titulo>
      {soloLectura && <Mensaje texto="Este checklist ya está completado: solo se puede ver." tipo="ok" />}
      {sinSubir > 0 && <Mensaje texto={`${sinSubir} ${sinSubir === 1 ? 'foto está' : 'fotos están'} guardada${sinSubir === 1 ? '' : 's'} en el teléfono y se ${sinSubir === 1 ? 'enviará' : 'enviarán'} sola${sinSubir === 1 ? '' : 's'}.`} tipo="aviso" />}
      {c.exige_lectura_contador && !soloLectura && (
        <Tarjeta>
          <Campo etiqueta={`Lectura del contador${contador ? ` (actual: ${contador.valor_actual ?? '—'})` : ''}`} value={lectura} onChangeText={setLectura} keyboardType="decimal-pad" placeholder="Escríbala antes de completar" />
          {lectura.trim() !== '' && lecturaNum === null && <Mensaje texto="Escriba solo números (por ejemplo 12500 o 12,5)." tipo="error" />}
        </Tarjeta>
      )}
      {c.respuestas.map((x) => (
        <Tarjeta key={x.id}>
          <Text style={{ fontSize: 12, color: color.suave }}>{x.seccion}</Text>
          <Texto negrita>{x.descripcion}</Texto>
          {x.tipo_respuesta === 'semaforo' && (
            <View style={estilos.fila}>
              {(['verde', 'amarillo', 'rojo'] as const).map((v) => (
                <Boton key={v} texto={SEMAFORO[v].texto} variante={x.semaforo === v ? 'primario' : 'borde'} deshabilitado={soloLectura} etiqueta={`${SEMAFORO[v].texto}${x.semaforo === v ? ', elegido' : ''}`} alPulsar={() => responder(x, { semaforo: v })} />
              ))}
            </View>
          )}
          {x.tipo_respuesta === 'si_no' && (
            <View style={estilos.fila}>
              <Boton texto="Sí" variante={x.si_no === 1 ? 'primario' : 'borde'} deshabilitado={soloLectura} alPulsar={() => responder(x, { si_no: true })} />
              <Boton texto="No" variante={x.si_no === 0 ? 'primario' : 'borde'} deshabilitado={soloLectura} alPulsar={() => responder(x, { si_no: false })} />
            </View>
          )}
          {x.tipo_respuesta === 'lista' && (
            <View style={estilos.fila}>
              {x.opciones.map((o) => <Boton key={o} texto={o} variante={x.opcion_texto === o ? 'primario' : 'borde'} deshabilitado={soloLectura} alPulsar={() => responder(x, { opcion: o })} />)}
            </View>
          )}
          {x.tipo_respuesta === 'numero' && <Entrada x={x} tipo="numero" soloLectura={soloLectura} alGuardar={(valores) => responder(x, valores)} />}
          {x.tipo_respuesta === 'texto' && <Entrada x={x} tipo="texto" soloLectura={soloLectura} alGuardar={(valores) => responder(x, valores)} />}
          {!soloLectura && (
            <View style={estilos.fila}>
              <Boton texto={`Foto (${totalDeFotos(x)})`} variante="borde" deshabilitado={!puedeAgregarFoto(x)} alPulsar={() => void foto(x)} />
              {necesitaFoto(x) && totalDeFotos(x) === 0 && <Text style={{ color: color.rojo, fontSize: 13 }}>Este punto necesita una foto.</Text>}
            </View>
          )}
        </Tarjeta>
      ))}
      {c.requiere_firma_cliente && (
        <Tarjeta>
          <Texto negrita>Firma del cliente</Texto>
          {firmante ? <Texto>Firmó: {firmante}{c.firma_local ? ' (por enviar)' : ''}</Texto> : <Texto suave>Este checklist lleva la firma del cliente.</Texto>}
          {!soloLectura && <Boton texto={firmante ? 'Firmar de nuevo' : 'Pedir la firma del cliente'} variante={firmante ? 'borde' : 'primario'} alPulsar={() => setFirmando(true)} />}
        </Tarjeta>
      )}
      {firmando && (
        <FirmaModal
          visible
          titulo={`Firma: ${c.tipo}`}
          alCancelar={() => setFirmando(false)}
          alFirmar={(nombre, imagen) => {
            setFirmando(false);
            void s.acciones.firmarChecklist(c.id, nombre, imagen).catch((e: unknown) => setMensaje(e instanceof Error ? e.message : 'No se pudo guardar la firma.'));
          }}
        />
      )}
      {puedeCotizar && (
        <Tarjeta>
          <Texto negrita>Puntos en rojo</Texto>
          <Texto suave>Se puede cotizar lo que está mal para enviarlo al cliente. Necesita señal.</Texto>
          {(envio?.pendientes ?? 0) > 0 && <Mensaje texto="Espere a que se envíe todo lo pendiente (la cotización se arma con lo que ya está en el servidor)." tipo="aviso" />}
          <Boton texto="Cotizar los puntos en rojo" variante="borde" cargando={cotizando} deshabilitado={(envio?.pendientes ?? 0) > 0} alPulsar={() => void cotizar()} />
          {resultado && <Mensaje texto={resultado.texto} tipo={resultado.tipo} />}
        </Tarjeta>
      )}
      <Mensaje texto={mensaje} tipo="error" />
      {!soloLectura && (
        <Tarjeta>
          {problemas.map((p) => <Text key={p} style={{ color: color.rojo, fontSize: 14 }}>• {p}</Text>)}
          <Boton texto="Completar checklist" alPulsar={() => void completar()} deshabilitado={problemas.length > 0} />
        </Tarjeta>
      )}
    </ScrollView>
  );
}

function Entrada({ x, tipo, soloLectura, alGuardar }: { x: RespuestaDeChecklist; tipo: 'numero' | 'texto'; soloLectura: boolean; alGuardar: (v: { valor_numero?: number; valor_texto?: string }) => void }) {
  const [v, setV] = useState(tipo === 'numero' ? (x.valor_numero === null ? '' : String(x.valor_numero)) : (x.valor_texto ?? ''));
  const n = tipo === 'numero' ? numeroDe(v) : null;
  return (
    <View style={{ gap: 6 }}>
      <Campo etiqueta={tipo === 'numero' ? 'Valor' : 'Texto'} value={v} onChangeText={setV} editable={!soloLectura} keyboardType={tipo === 'numero' ? 'decimal-pad' : 'default'} multiline={tipo === 'texto'} />
      {tipo === 'numero' && v.trim() !== '' && n === null && <Mensaje texto="Escriba solo números (por ejemplo 12500 o 12,5)." tipo="error" />}
      {!soloLectura && <Boton texto="Guardar" variante="borde" deshabilitado={tipo === 'numero' ? n === null : v.trim() === ''} alPulsar={() => alGuardar(tipo === 'numero' ? { valor_numero: n as number } : { valor_texto: v.trim() })} />}
    </View>
  );
}
