import { FormEvent, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Acciones, BotonAccion, BotonEditar } from '../../components/ui-guatech/AccionBoton.jsx';
import Badge from '../../components/ui-guatech/Badge.jsx';
import Button from '../../components/ui-guatech/Button.jsx';
import Modal from '../../components/ui-guatech/Modal.jsx';
import { fechaHoraLocal } from '../../utils/hora';
import { api, ErrorApi } from '../api';
import Tabla, { Columna } from '../componentes/Tabla';
import { useSesion } from '../Sesion';
import { AltaPorAtender, dinero, EmpresaDetalle, EmpresaFila, ETIQUETA_ESTADO, ETIQUETA_ORIGEN, FichaEmpresa, ListaEmpresas, Modulo, Plan } from '../tipos';

function Aviso({ mensaje, tipo }: { mensaje: string; tipo: 'error' | 'ok' }) {
  if (!mensaje) return null;
  return (
    <p role={tipo === 'error' ? 'alert' : 'status'} className={`rounded-md px-3 py-2 text-sm ${tipo === 'error' ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
      {mensaje}
    </p>
  );
}

function ListaModulos({ modulos, marcados, alCambiar, deshabilitado }: { modulos: Modulo[]; marcados: string[]; alCambiar: (v: string[]) => void; deshabilitado?: boolean }) {
  const todos = marcados.length === modulos.length;
  return (
    <fieldset>
      <div className="mb-1 flex items-center justify-between">
        <legend className="text-sm font-medium text-gray-700">Módulos habilitados</legend>
        <button type="button" disabled={deshabilitado} className="text-xs text-primary hover:underline disabled:opacity-50" onClick={() => alCambiar(todos ? [] : modulos.map((m) => m.codigo))}>
          {todos ? 'Desmarcar todos' : 'Marcar todos'}
        </button>
      </div>
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
        {modulos.map((m) => (
          <label key={m.codigo} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={deshabilitado}
              checked={marcados.includes(m.codigo)}
              onChange={(e) => alCambiar(e.target.checked ? [...marcados, m.codigo] : marcados.filter((x) => x !== m.codigo))}
            />
            {m.nombre}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function EditarEmpresa({ id, planes, modulos, alCerrar, alGuardar }: { id: number; planes: Plan[]; modulos: Modulo[]; alCerrar: () => void; alGuardar: () => void }) {
  const { puedeEscribir } = useSesion();
  const [empresa, setEmpresa] = useState<EmpresaDetalle | null>(null);
  const [nombre, setNombre] = useState('');
  const [contactoNombre, setContactoNombre] = useState('');
  const [contactoCorreo, setContactoCorreo] = useState('');
  const [planId, setPlanId] = useState('');
  const [cuota, setCuota] = useState('');
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get<EmpresaDetalle>(`/empresas/${id}`).then((e) => {
      setEmpresa(e);
      setNombre(e.nombre);
      setContactoNombre(e.contacto_nombre ?? '');
      setContactoCorreo(e.contacto_correo ?? '');
      setPlanId(e.plan_id ? String(e.plan_id) : '');
      setCuota(e.cuota_mensual === null ? '' : String(e.cuota_mensual));
      setSeleccion(e.modulos);
    }).catch((err: unknown) => setError(err instanceof ErrorApi ? err.message : 'No se pudo cargar la empresa'));
  }, [id]);

  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.patch(`/empresas/${id}`, {
        nombre,
        contacto_nombre: contactoNombre.trim() === '' ? null : contactoNombre,
        contacto_correo: contactoCorreo.trim() === '' ? null : contactoCorreo.trim(),
        plan_id: planId === '' ? null : Number(planId),
        cuota_mensual: cuota.trim() === '' ? null : Number(cuota),
        modulos: seleccion,
      });
      alGuardar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar');
    }
  };

  const clase = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100';
  return (
    <Modal onClose={alCerrar} title={empresa ? `Editar: ${empresa.nombre}` : 'Editar empresa'} size="lg">
      {!empresa ? (
        <Aviso mensaje={error || 'Cargando…'} tipo={error ? 'error' : 'ok'} />
      ) : (
        <form onSubmit={guardar} className="space-y-4">
          <Aviso mensaje={error} tipo="error" />
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Nombre de la empresa</span>
              <input className={clase} value={nombre} onChange={(e) => setNombre(e.target.value)} required disabled={!puedeEscribir} /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Dirección del sistema</span>
              <input className={clase} value={empresa.subdominio} readOnly disabled /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Nombre del administrador</span>
              <input className={clase} value={contactoNombre} onChange={(e) => setContactoNombre(e.target.value)} disabled={!puedeEscribir} /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Correo del administrador</span>
              <input type="email" className={clase} value={contactoCorreo} onChange={(e) => setContactoCorreo(e.target.value)} disabled={!puedeEscribir} /></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Plan</span>
              <select className={clase} value={planId} onChange={(e) => setPlanId(e.target.value)} disabled={!puedeEscribir}>
                <option value="">Sin plan</option>
                {planes.map((p) => <option key={p.id} value={p.id}>{p.nombre} — {dinero(p.precio_mensual)}</option>)}
              </select></label>
            <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Cuota mensual (USD)</span>
              <input type="number" min="0" step="0.01" className={clase} value={cuota} onChange={(e) => setCuota(e.target.value)} placeholder="Vacío = sin cuota registrada" disabled={!puedeEscribir} /></label>
          </div>
          <ListaModulos modulos={modulos} marcados={seleccion} alCambiar={setSeleccion} deshabilitado={!puedeEscribir} />
          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" onClick={alCerrar}>{puedeEscribir ? 'Cancelar' : 'Cerrar'}</Button>
            {puedeEscribir && <Button type="submit">Guardar</Button>}
          </div>
        </form>
      )}
    </Modal>
  );
}

function Fila({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-gray-100 py-1 text-sm">
      <dt className="text-gray-500">{etiqueta}</dt>
      <dd className="text-right font-medium text-gray-900">{valor}</dd>
    </div>
  );
}

function FichaDeEmpresa({ id, alCerrar, alCambiar }: { id: number; alCerrar: () => void; alCambiar: () => void }) {
  const { puedeEscribir } = useSesion();
  const [ficha, setFicha] = useState<FichaEmpresa | null>(null);
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'error' | 'ok' }>({ texto: '', tipo: 'ok' });
  const [trabajando, setTrabajando] = useState(false);

  const cargar = useCallback(() => {
    api.get<FichaEmpresa>(`/empresas/${id}/detalle`).then(setFicha).catch((e: unknown) => setMensaje({ texto: e instanceof ErrorApi ? e.message : 'No se pudo cargar', tipo: 'error' }));
  }, [id]);
  useEffect(cargar, [cargar]);

  const conciliar = async (): Promise<void> => {
    setTrabajando(true);
    setMensaje({ texto: '', tipo: 'ok' });
    try {
      const r = await api.post<{ omitida?: string; estado?: string; cambioEstado?: boolean; pagosNuevos?: number }>(`/empresas/${id}/conciliar`);
      setMensaje({
        texto: r.omitida ? `No se concilió: ${r.omitida}.` : `Conciliada con PayPal. ${r.cambioEstado ? 'El estado cambió.' : 'El estado no cambió.'} Pagos nuevos: ${r.pagosNuevos ?? 0}.`,
        tipo: 'ok',
      });
      cargar();
      alCambiar();
    } catch (err) {
      setMensaje({ texto: err instanceof ErrorApi ? err.message : 'No se pudo conciliar', tipo: 'error' });
    } finally {
      setTrabajando(false);
    }
  };

  const e = ficha?.empresa;
  const fecha = (v: string | null | undefined): string => fechaHoraLocal(v);
  return (
    <Modal onClose={alCerrar} title={e ? `Detalle: ${e.nombre}` : 'Detalle de la empresa'} size="xl">
      {!e || !ficha ? (
        <Aviso mensaje={mensaje.texto || 'Cargando…'} tipo={mensaje.texto ? mensaje.tipo : 'ok'} />
      ) : (
        <div className="space-y-5">
          <Aviso mensaje={mensaje.texto} tipo={mensaje.tipo} />
          {ficha.alta && ficha.alta.estado === 'error' && <Aviso mensaje={`El alta falló ${ficha.alta.intentos} veces: ${ficha.alta.error ?? ''}`} tipo="error" />}
          <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
            <section>
              <h3 className="mb-1 text-sm font-bold text-gray-900">Estado</h3>
              <dl>
                <Fila etiqueta="Estado" valor={ETIQUETA_ESTADO[e.estado].texto} />
                <Fila etiqueta="Desde" valor={fecha(e.estado_desde)} />
                {e.suspension_origen && <Fila etiqueta="Suspendida por" valor={e.suspension_origen === 'manual' ? 'GUATECH (a mano)' : 'Falta de pago'} />}
                <Fila etiqueta="Prueba hasta" valor={fecha(e.prueba_hasta)} />
                <Fila etiqueta="Próximo cobro" valor={fecha(e.proximo_cobro_en)} />
                <Fila etiqueta="Gracia de pago hasta" valor={fecha(e.gracia_hasta)} />
                <Fila etiqueta="Acceso hasta" valor={fecha(e.acceso_hasta)} />
                <Fila etiqueta="Exportar datos hasta" valor={fecha(e.exportable_hasta)} />
                <Fila etiqueta="Borrado programado" valor={fecha(e.borrado_programado_en)} />
              </dl>
            </section>
            <section>
              <h3 className="mb-1 text-sm font-bold text-gray-900">Suscripción y taller</h3>
              <dl>
                <Fila etiqueta="Cobro" valor={e.cobro_por_contrato ? 'Por contrato' : 'PayPal'} />
                <Fila etiqueta="Suscripción de PayPal" valor={e.paypal_suscripcion_id ?? '—'} />
                <Fila etiqueta="Estado en PayPal" valor={e.paypal_estado ?? '—'} />
                <Fila etiqueta="Última conciliación" valor={fecha(e.ultima_conciliacion_en)} />
                <Fila etiqueta="Cuota mensual" valor={dinero(e.cuota_mensual)} />
                <Fila etiqueta="Dirección" valor={e.subdominio} />
                <Fila etiqueta="Dirección respondió" valor={fecha(e.subdominio_listo_en)} />
                <Fila etiqueta="Base de datos" valor={e.nombre_bd} />
              </dl>
              {puedeEscribir && e.paypal_suscripcion_id && !e.cobro_por_contrato && (
                <div className="mt-3">
                  <Button variant="outline" size="sm" disabled={trabajando} onClick={() => void conciliar()}>
                    {trabajando ? 'Conciliando…' : 'Conciliar ahora'}
                  </Button>
                </div>
              )}
            </section>
          </div>
          <section>
            <h3 className="mb-1 text-sm font-bold text-gray-900">Pagos</h3>
            {ficha.pagos.length === 0 ? (
              <p className="text-sm text-gray-500">Todavía no hay pagos registrados.</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-100 text-left text-xs uppercase text-gray-600">
                    <th className="px-2 py-1">Fecha</th>
                    <th className="px-2 py-1">Referencia</th>
                    <th className="px-2 py-1">Estado</th>
                    <th className="px-2 py-1 text-right">Monto</th>
                  </tr>
                </thead>
                <tbody>
                  {ficha.pagos.map((p) => (
                    <tr key={p.paypal_transaccion_id} className="border-b border-gray-100">
                      <td className="px-2 py-1">{fecha(p.fecha)}</td>
                      <td className="px-2 py-1">{p.paypal_transaccion_id}</td>
                      <td className="px-2 py-1">{p.estado}</td>
                      <td className="px-2 py-1 text-right">{p.moneda} {p.monto.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
          <section>
            <h3 className="mb-1 text-sm font-bold text-gray-900">Eventos de la suscripción</h3>
            {ficha.eventos.length === 0 ? (
              <p className="text-sm text-gray-500">Todavía no hay eventos.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {ficha.eventos.map((v) => (
                  <li key={v.id} className="border-b border-gray-100 pb-1">
                    <span className="text-gray-500">{fecha(v.created_at)}</span> · <span className="font-medium">{ETIQUETA_ORIGEN[v.origen]}</span>
                    {v.estado_despues && (
                      <>
                        {' '}· {v.estado_antes ? ETIQUETA_ESTADO[v.estado_antes].texto : '—'} → <strong>{ETIQUETA_ESTADO[v.estado_despues].texto}</strong>
                      </>
                    )}
                    {v.detalle && <span className="block text-xs text-gray-600">{v.detalle}{v.usuario_nombre ? ` (${v.usuario_nombre})` : ''}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="flex justify-end border-t pt-3">
            <Button variant="outline" onClick={alCerrar}>Cerrar</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function SuspenderEmpresa({ empresa, alCerrar, alListo }: { empresa: EmpresaFila; alCerrar: () => void; alListo: () => void }) {
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState('');
  const enviar = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault();
    setError('');
    try {
      await api.post(`/empresas/${empresa.id}/estado`, { estado: 'suspendida', motivo });
      alListo();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo suspender');
    }
  };
  return (
    <Modal onClose={alCerrar} title={`Suspender a ${empresa.nombre}`} size="md">
      <form onSubmit={enviar} className="space-y-3">
        <Aviso mensaje={error} tipo="error" />
        <p className="text-sm text-gray-700">La empresa dejará de poder entrar al sistema. Una suspensión hecha a mano no se levanta sola: hay que activarla desde aquí.</p>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-gray-700">Motivo (obligatorio)</span>
          <input className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" value={motivo} onChange={(e) => setMotivo(e.target.value)} required maxLength={300} autoFocus />
        </label>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={alCerrar}>Cancelar</Button>
          <Button type="submit" variant="danger">Suspender</Button>
        </div>
      </form>
    </Modal>
  );
}

function AltasPorAtender({ altas, alCambiar }: { altas: AltaPorAtender[]; alCambiar: () => void }) {
  const { puedeEscribir } = useSesion();
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'error' | 'ok' }>({ texto: '', tipo: 'ok' });
  if (altas.length === 0) return null;
  const reintentar = async (a: AltaPorAtender): Promise<void> => {
    try {
      await api.post(`/altas/${a.id}/reintentar`);
      setMensaje({ texto: `${a.nombre_taller}: el taller se creó.`, tipo: 'ok' });
    } catch (err) {
      setMensaje({ texto: err instanceof ErrorApi ? err.message : 'No se pudo crear el taller', tipo: 'error' });
    }
    alCambiar();
  };
  return (
    <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3">
      <h2 className="text-sm font-bold text-amber-900">Clientes que ya aprobaron su pago y cuyo taller todavía no se crea</h2>
      <Aviso mensaje={mensaje.texto} tipo={mensaje.tipo} />
      <ul className="space-y-1 text-sm">
        {altas.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center justify-between gap-2">
            <span>
              <strong>{a.nombre_taller}</strong> ({a.slug}) · {a.admin_correo} · {a.estado === 'error' ? `falló ${a.intentos} veces` : 'creándose'}
              {a.error ? ` — ${a.error}` : ''}
            </span>
            {puedeEscribir && <Button size="sm" variant="outline" onClick={() => void reintentar(a)}>Reintentar alta</Button>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PestanaEmpresas({ planes, modulos }: { planes: Plan[]; modulos: Modulo[] }) {
  const { puedeEscribir, esSuperAdmin } = useSesion();
  const [datos, setDatos] = useState<ListaEmpresas | null>(null);
  const [buscar, setBuscar] = useState('');
  const [mensaje, setMensaje] = useState<{ texto: string; tipo: 'error' | 'ok' }>({ texto: '', tipo: 'ok' });
  const [editando, setEditando] = useState<number | null>(null);
  const [viendo, setViendo] = useState<number | null>(null);
  const [suspendiendo, setSuspendiendo] = useState<EmpresaFila | null>(null);
  const [altas, setAltas] = useState<AltaPorAtender[]>([]);

  const cargar = useCallback(() => {
    api.get<AltaPorAtender[]>('/altas').then(setAltas).catch(() => setAltas([]));
    api.get<ListaEmpresas>(`/empresas${buscar.trim() ? `?buscar=${encodeURIComponent(buscar.trim())}` : ''}`).then(setDatos).catch((e: unknown) => setMensaje({ texto: e instanceof ErrorApi ? e.message : 'No se pudo cargar', tipo: 'error' }));
  }, [buscar]);
  useEffect(cargar, [cargar]);

  /** "Entrar" (acceso de soporte): se abre la pestaña de inmediato (si no, el navegador la bloquea) y luego se le pone la dirección. */
  const entrar = async (e: EmpresaFila): Promise<void> => {
    const ventana = window.open('', '_blank');
    try {
      const r = await api.post<{ url: string }>(`/empresas/${e.id}/entrar`);
      if (ventana) ventana.location.href = r.url;
      else setMensaje({ texto: 'El navegador bloqueó la ventana nueva. Permita las ventanas emergentes e intente de nuevo.', tipo: 'error' });
    } catch (err) {
      ventana?.close();
      setMensaje({ texto: err instanceof ErrorApi ? err.message : 'No se pudo abrir el taller', tipo: 'error' });
    }
  };

  const reactivar = async (e: EmpresaFila): Promise<void> => {
    if (!window.confirm(`¿Desea reactivar a ${e.nombre}?`)) return;
    try {
      await api.post(`/empresas/${e.id}/estado`, { estado: 'activa' });
      setMensaje({ texto: `${e.nombre}: reactivada.`, tipo: 'ok' });
      cargar();
    } catch (err) {
      setMensaje({ texto: err instanceof ErrorApi ? err.message : 'No se pudo cambiar el estado', tipo: 'error' });
    }
  };

  const columnas: Array<Columna<EmpresaFila>> = [
    { clave: 'empresa', etiqueta: 'Empresa', valor: (e) => e.nombre, render: (e) => <span><span className="block font-medium text-gray-900">{e.nombre}</span><span className="block text-xs text-gray-500">{e.slug}</span></span> },
    { clave: 'subdominio', etiqueta: 'Subdominio', valor: (e) => e.subdominio },
    { clave: 'plan', etiqueta: 'Plan', valor: (e) => e.plan_nombre ?? '', render: (e) => e.plan_nombre ?? '—' },
    { clave: 'cuota', etiqueta: 'Cuota', valor: (e) => e.cuota_mensual ?? -1, render: (e) => dinero(e.cuota_mensual), alinear: 'right' },
    { clave: 'admin', etiqueta: 'Admin', valor: (e) => e.contacto_nombre ?? '', render: (e) => <span><span className="block">{e.contacto_nombre ?? '—'}</span><span className="block text-xs text-gray-500">{e.contacto_correo ?? ''}</span></span> },
    { clave: 'modulos', etiqueta: 'Módulos', valor: (e) => e.modulos_habilitados, render: (e) => (datos && e.modulos_habilitados === datos.total_modulos ? 'Todos' : `${e.modulos_habilitados} de ${datos?.total_modulos ?? 0}`) },
    { clave: 'estado', etiqueta: 'Estado', valor: (e) => e.estado, render: (e) => <Badge variant={ETIQUETA_ESTADO[e.estado].variante}>{ETIQUETA_ESTADO[e.estado].texto}</Badge> },
    { clave: 'prov', etiqueta: 'Provisionado', valor: (e) => e.provisionada_en ?? '', render: (e) => fechaHoraLocal(e.provisionada_en) },
    {
      clave: 'acciones',
      etiqueta: 'Acciones',
      render: (e) => (
        <Acciones>
          {esSuperAdmin && ['prueba', 'activa', 'pago_fallido', 'cancelada_con_acceso'].includes(e.estado) && <BotonAccion onClick={() => void entrar(e)}>Entrar</BotonAccion>}
          <BotonAccion onClick={() => setViendo(e.id)}>Detalle</BotonAccion>
          {puedeEscribir && e.estado === 'suspendida' && <BotonAccion onClick={() => void reactivar(e)}>Activar</BotonAccion>}
          {puedeEscribir && ['prueba', 'activa', 'pago_fallido', 'cancelada_con_acceso'].includes(e.estado) && <BotonAccion onClick={() => setSuspendiendo(e)}>Suspender</BotonAccion>}
          <BotonEditar onClick={() => setEditando(e.id)}>{puedeEscribir ? 'Editar' : 'Ver'}</BotonEditar>
        </Acciones>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          value={buscar}
          onChange={(e) => setBuscar(e.target.value)}
          placeholder="Buscar por nombre, código o correo"
          aria-label="Buscar empresas"
          data-no-uppercase="true"
          className="w-full max-w-xs rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
        {datos && (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-medium text-green-800">
            Cuota total (activas): {datos.cuota_total_activas === null ? '—' : dinero(datos.cuota_total_activas)}
          </span>
        )}
      </div>
      <AltasPorAtender altas={altas} alCambiar={cargar} />
      <Aviso mensaje={mensaje.texto} tipo={mensaje.tipo} />
      <Tabla columnas={columnas} filas={datos?.empresas ?? []} clave={(e) => e.id} vacio={datos ? 'Todavía no hay empresas. Se crean solas cuando un cliente se registra.' : 'Cargando…'} />
      {viendo !== null && <FichaDeEmpresa id={viendo} alCerrar={() => setViendo(null)} alCambiar={cargar} />}
      {suspendiendo && (
        <SuspenderEmpresa
          empresa={suspendiendo}
          alCerrar={() => setSuspendiendo(null)}
          alListo={() => {
            setMensaje({ texto: `${suspendiendo.nombre}: suspendida.`, tipo: 'ok' });
            setSuspendiendo(null);
            cargar();
          }}
        />
      )}
      {editando !== null && (
        <EditarEmpresa id={editando} planes={planes} modulos={modulos} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); setMensaje({ texto: 'Los cambios se guardaron.', tipo: 'ok' }); cargar(); }} />
      )}
    </div>
  );
}

function EditarPlan({ plan, modulos, alCerrar, alGuardar }: { plan: Plan; modulos: Modulo[]; alCerrar: () => void; alGuardar: () => void }) {
  const [nombre, setNombre] = useState(plan.nombre);
  const [precio, setPrecio] = useState(String(plan.precio_mensual));
  const [usuarios, setUsuarios] = useState(plan.max_usuarios === null ? '' : String(plan.max_usuarios));
  const [sucursales, setSucursales] = useState(plan.max_sucursales === null ? '' : String(plan.max_sucursales));
  const [seleccion, setSeleccion] = useState<string[]>(plan.modulos);
  const [error, setError] = useState('');

  const guardar = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError('');
    try {
      await api.patch(`/planes/${plan.id}`, {
        nombre,
        precio_mensual: Number(precio),
        max_usuarios: usuarios.trim() === '' ? null : Number(usuarios),
        max_sucursales: sucursales.trim() === '' ? null : Number(sucursales),
        modulos: seleccion,
      });
      alGuardar();
    } catch (err) {
      setError(err instanceof ErrorApi ? err.message : 'No se pudo guardar');
    }
  };
  const clase = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm';
  return (
    <Modal onClose={alCerrar} title={`Editar plan ${plan.nombre}`} size="lg">
      <form onSubmit={guardar} className="space-y-4">
        <Aviso mensaje={error} tipo="error" />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Nombre</span><input className={clase} value={nombre} onChange={(e) => setNombre(e.target.value)} required /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Precio mensual (USD)</span><input type="number" min="0" step="0.01" className={clase} value={precio} onChange={(e) => setPrecio(e.target.value)} required /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Máximo de usuarios</span><input type="number" min="1" className={clase} value={usuarios} onChange={(e) => setUsuarios(e.target.value)} placeholder="Vacío = sin límite" /></label>
          <label className="block text-sm"><span className="mb-1 block font-medium text-gray-700">Máximo de sucursales</span><input type="number" min="1" className={clase} value={sucursales} onChange={(e) => setSucursales(e.target.value)} placeholder="Vacío = sin límite" /></label>
        </div>
        <ListaModulos modulos={modulos} marcados={seleccion} alCambiar={setSeleccion} />
        <p className="text-xs text-gray-500">Cambiar un plan no modifica los módulos de las empresas que ya lo tienen: cada empresa conserva los suyos.</p>
        <div className="flex justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={alCerrar}>Cancelar</Button><Button type="submit">Guardar</Button></div>
      </form>
    </Modal>
  );
}

function PestanaPlanes({ planes, modulos, recargar }: { planes: Plan[]; modulos: Modulo[]; recargar: () => void }) {
  const { esSuperAdmin } = useSesion();
  const [editando, setEditando] = useState<Plan | null>(null);
  const columnas: Array<Columna<Plan>> = [
    { clave: 'nombre', etiqueta: 'Plan', valor: (p) => p.nombre, render: (p) => <span className="font-medium text-gray-900">{p.nombre}</span> },
    { clave: 'precio', etiqueta: 'Precio mensual', valor: (p) => p.precio_mensual, render: (p) => dinero(p.precio_mensual), alinear: 'right' },
    { clave: 'usuarios', etiqueta: 'Usuarios', valor: (p) => p.max_usuarios ?? 1e9, render: (p) => p.max_usuarios ?? 'Sin límite' },
    { clave: 'sucursales', etiqueta: 'Sucursales', valor: (p) => p.max_sucursales ?? 1e9, render: (p) => p.max_sucursales ?? 'Sin límite' },
    { clave: 'modulos', etiqueta: 'Módulos', valor: (p) => p.modulos.length, render: (p) => `${p.modulos.length} de ${modulos.length}` },
    { clave: 'empresas', etiqueta: 'Empresas', valor: (p) => p.empresas },
    { clave: 'acciones', etiqueta: 'Acciones', render: (p) => <Acciones><BotonEditar onClick={() => setEditando(p)}>{esSuperAdmin ? 'Editar' : 'Ver'}</BotonEditar></Acciones> },
  ];
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-600">Los tres niveles de precio. Los límites y módulos de cada nivel se aplican a las empresas nuevas; las que ya existen conservan los suyos.</p>
      <Tabla columnas={columnas} filas={planes} clave={(p) => p.id} />
      {editando && (esSuperAdmin ? (
        <EditarPlan plan={editando} modulos={modulos} alCerrar={() => setEditando(null)} alGuardar={() => { setEditando(null); recargar(); }} />
      ) : (
        <Modal onClose={() => setEditando(null)} title={`Plan ${editando.nombre}`} size="md">
          <p className="text-sm text-gray-700">Solo un super administrador puede cambiar los planes.</p>
          <ul className="mt-2 list-disc pl-5 text-sm">{editando.modulos.map((m) => <li key={m}>{modulos.find((x) => x.codigo === m)?.nombre ?? m}</li>)}</ul>
        </Modal>
      ))}
    </div>
  );
}

export default function Empresas() {
  const [params, setParams] = useSearchParams();
  const pestana = params.get('tab') === 'planes' ? 'planes' : 'empresas';
  const [planes, setPlanes] = useState<Plan[]>([]);
  const [modulos, setModulos] = useState<Modulo[]>([]);
  const cargarPlanes = useCallback(() => {
    void api.get<Plan[]>('/planes').then(setPlanes);
    void api.get<Modulo[]>('/modulos').then(setModulos);
  }, []);
  useEffect(cargarPlanes, [cargarPlanes]);

  const boton = (clave: 'empresas' | 'planes', texto: string) => (
    <button
      key={clave}
      onClick={() => setParams(clave === 'empresas' ? {} : { tab: clave }, { replace: true })}
      className={`rounded-md px-4 py-2 text-sm font-medium ${pestana === clave ? 'bg-primary text-white' : 'bg-white text-gray-700 hover:bg-gray-100'} border border-gray-200`}
    >
      {texto}
    </button>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-gray-900">Empresas</h1>
      <div className="flex gap-2">{boton('empresas', 'Empresas')}{boton('planes', 'Planes y módulos')}</div>
      {pestana === 'empresas' ? <PestanaEmpresas planes={planes} modulos={modulos} /> : <PestanaPlanes planes={planes} modulos={modulos} recargar={cargarPlanes} />}
    </div>
  );
}
