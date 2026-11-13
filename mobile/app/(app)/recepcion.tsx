import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { MiDia } from '../../src/nucleo/dia';
import { fechaCorta, numeroDe } from '../../src/nucleo/fechas';
import { useServicios } from '../../src/plataforma/contexto';
import { useDia } from '../../src/ui/hooks';
import { Boton, Campo, estilos, Mensaje, Tarjeta, Texto, Titulo } from '../../src/ui/tema';

interface Cita {
  id: number;
  equipo_id?: number;
  equipo?: string;
  cliente?: string | null;
  fecha?: string;
  hora?: string;
  sucursal?: string;
  por_confirmar?: number;
}
interface OrdenAbierta {
  id: number;
  numero?: string;
  estado?: string;
  equipo?: string;
  cliente?: string | null;
  equipo_en_taller?: number;
  es_terminal?: number;
}

/**
 * Recepción: recibir al cliente que llega con su cita (nace la orden), llenar con él el checklist de recepción con fotos y firma, y entregarle el equipo.
 * Recibir y crear checklists necesitan señal (el servidor crea algo nuevo); llenar, firmar y entregar funcionan sin señal.
 */
export default function Recepcion() {
  const s = useServicios();
  const { datos } = useDia();
  const permisos = s.sesion.permisos;
  const citas = ((datos?.citas ?? []) as Cita[]).filter((c) => c.fecha === datos?.hoy);
  const abiertas = ((datos?.ordenes_abiertas ?? []) as OrdenAbierta[]).filter((o) => !o.es_terminal);
  return (
    <ScrollView style={estilos.pantalla} contentContainerStyle={estilos.contenido} keyboardShouldPersistTaps="handled">
      <Titulo>Recepción</Titulo>
      {!datos && <Mensaje texto="Descargue su día (en «Mi día») para ver las citas y las órdenes abiertas." tipo="aviso" />}
      {datos && (
        <>
          <Texto negrita>Citas de hoy ({citas.length})</Texto>
          {citas.length === 0 && <Texto suave>No hay citas para hoy.</Texto>}
          {citas.map((c) => <CitaDeHoy key={c.id} c={c} datos={datos} puedeRecibir={permisos.includes('citas.gestionar')} />)}
          <Texto negrita>Órdenes abiertas ({abiertas.length})</Texto>
          {abiertas.length === 0 && <Texto suave>No hay órdenes abiertas.</Texto>}
          {abiertas.map((o) => <OrdenDeRecepcion key={o.id} o={o} datos={datos} />)}
        </>
      )}
    </ScrollView>
  );
}

function CitaDeHoy({ c, datos, puedeRecibir }: { c: Cita; datos: MiDia; puedeRecibir: boolean }) {
  const s = useServicios();
  const [abierta, setAbierta] = useState(false);
  const [descripcion, setDescripcion] = useState('');
  const [lectura, setLectura] = useState('');
  const [trabajando, setTrabajando] = useState(false);
  const [resultado, setResultado] = useState<{ texto: string; tipo: 'ok' | 'error' | 'aviso' } | null>(null);
  const equipo = datos.equipos.find((e) => e.id === c.equipo_id);
  const contador = equipo?.contadores?.find((k) => (k as { es_principal?: number }).es_principal === 1) ?? equipo?.contadores?.[0];
  const lecturaNum = lectura.trim() === '' ? null : numeroDe(lectura);
  const lecturaMala = lectura.trim() !== '' && lecturaNum === null;

  const recibir = async (): Promise<void> => {
    setTrabajando(true);
    setResultado(null);
    try {
      const r = await s.enLinea.recibirCita(c.id, {
        ...(descripcion.trim() ? { descripcion: descripcion.trim() } : {}),
        ...(contador && lecturaNum !== null ? { lectura: { contador_id: contador.id, valor: lecturaNum } } : {}),
      });
      setAbierta(false);
      setResultado({ texto: `Equipo recibido: orden ${r.numero}.${r.diaActualizado ? ' Ya aparece abajo, en las órdenes abiertas.' : ' Descargue su día para verla.'}`, tipo: r.diaActualizado ? 'ok' : 'aviso' });
    } catch (e) {
      setResultado({ texto: e instanceof Error ? e.message : 'No se pudo recibir el equipo.', tipo: 'error' });
    } finally {
      setTrabajando(false);
    }
  };

  return (
    <Tarjeta>
      <Texto negrita>{c.hora} · {c.equipo}</Texto>
      <Texto suave>{c.cliente ?? 'Del taller'} · {c.sucursal} · {fechaCorta(c.fecha)}</Texto>
      {c.por_confirmar === 1 && <Mensaje texto="Pedida desde el portal: falta confirmarla en el sistema web antes de recibirla." tipo="aviso" />}
      {puedeRecibir && c.por_confirmar !== 1 && !abierta && <Boton texto="Recibir el equipo" alPulsar={() => setAbierta(true)} />}
      {abierta && (
        <View style={{ gap: 8 }}>
          <Campo etiqueta="¿Qué problema reporta el cliente? (opcional)" value={descripcion} onChangeText={setDescripcion} multiline maxLength={500} />
          {contador && <Campo etiqueta={`Lectura del contador (actual: ${contador.valor_actual ?? '—'})`} value={lectura} onChangeText={setLectura} keyboardType="decimal-pad" />}
          {lecturaMala && <Mensaje texto="Escriba solo números (por ejemplo 12500 o 12,5)." tipo="error" />}
          <Texto suave>Necesita señal: se crea la orden en el servidor.</Texto>
          <View style={estilos.fila}>
            <Boton texto="Cancelar" variante="borde" alPulsar={() => setAbierta(false)} />
            <Boton texto="Recibir" alPulsar={() => void recibir()} cargando={trabajando} deshabilitado={lecturaMala} />
          </View>
        </View>
      )}
      {resultado && <Mensaje texto={resultado.texto} tipo={resultado.tipo} />}
    </Tarjeta>
  );
}

function OrdenDeRecepcion({ o, datos }: { o: OrdenAbierta; datos: MiDia }) {
  const s = useServicios();
  const r = useRouter();
  const [eligiendo, setEligiendo] = useState(false);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'ok' | 'error' } | null>(null);
  const permisos = s.sesion.permisos;
  const checklists = datos.checklists.filter((c) => c.orden_id === o.id);
  const tipos = (datos.catalogos?.checklist_tipos ?? []).filter((t) => t.requiere_orden === 1);
  const entregas = (datos.catalogos?.estados_orden ?? []).filter((e) => e.sale_equipo === 1 && e.es_cancelado === 0);

  const iniciar = async (tipoId: number): Promise<void> => {
    setMensaje(null);
    try {
      const x = await s.enLinea.iniciarChecklist(o.id, tipoId);
      setEligiendo(false);
      setMensaje({ texto: x.diaActualizado ? 'Checklist creado: ya aparece arriba.' : 'Checklist creado. Descargue su día para verlo.', tipo: 'ok' });
    } catch (e) {
      setMensaje({ texto: e instanceof Error ? e.message : 'No se pudo crear el checklist.', tipo: 'error' });
    }
  };
  const entregar = (estadoId: number, nombre: string): void =>
    Alert.alert('Entregar el equipo', `¿Pasar la orden ${o.numero} a «${nombre}»? Si quedan trabajos o checklists sin terminar, el sistema no lo permitirá.`, [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Sí, entregar', onPress: () => void s.acciones.entregarOrden(o.id, estadoId, o.numero ?? String(o.id), nombre).catch((e: unknown) => setMensaje({ texto: e instanceof Error ? e.message : 'No se pudo guardar.', tipo: 'error' })) },
    ]);

  return (
    <Tarjeta>
      <Texto negrita>{o.numero} · {o.estado}</Texto>
      <Texto suave>{o.equipo} · {o.cliente ?? 'Del taller'}{o.equipo_en_taller === 1 ? ' · el equipo está en el taller' : ''}</Texto>
      {checklists.map((c) => <Boton key={c.id} texto={`${c.tipo} (${c.respondidas}/${c.total})${c.requiere_firma_cliente ? ' · con firma' : ''}`} variante="borde" alPulsar={() => r.push(`/checklist/${c.id}`)} />)}
      {permisos.includes('checklists.llenar') && tipos.length > 0 && !eligiendo && <Boton texto="Iniciar un checklist" variante="borde" alPulsar={() => setEligiendo(true)} />}
      {eligiendo && (
        <View style={{ gap: 8 }}>
          <Texto negrita>¿Cuál checklist? (necesita señal)</Texto>
          {tipos.map((t) => <Boton key={t.id} texto={`${t.nombre}${t.requiere_firma_cliente ? ' · con firma' : ''}`} variante="borde" alPulsar={() => void iniciar(t.id)} />)}
          <Boton texto="Cancelar" variante="borde" alPulsar={() => setEligiendo(false)} />
        </View>
      )}
      {permisos.includes('solicitudes.crear') && <Boton texto="Pedir material" variante="borde" alPulsar={() => r.push(`/material/${o.id}`)} />}
      {permisos.includes('ordenes.cambiar_estado') && entregas.map((e) => <Boton key={e.id} texto={`Pasar a «${e.nombre}»`} alPulsar={() => entregar(e.id, e.nombre)} />)}
      {mensaje && <Mensaje texto={mensaje.texto} tipo={mensaje.tipo} />}
    </Tarjeta>
  );
}
