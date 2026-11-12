# 21 — Lo que Luis debe revisar o decidir (se va llenando durante la construcción)

Última actualización: 2026-11-12, trabajando de corrido durante la noche (Fase 4). Todo está en **https://pruebas.veritech.lat** (nada de producción).

**Cómo entrar a probar:** desde el panel de administración de pruebas, entrar a un taller con el botón «Entrar» (sesión de soporte); el taller de práctica se llama `prueba1`. Los datos que se siembran para verificar se borran al terminar; si desea ver pantallas con datos, cree usted los suyos (cliente, equipo, trabajo del catálogo).

Cada sección dice **qué probar** y **qué decidí yo mientras usted dormía** (por si desea cambiarlo).

---

## Fase 3e — Cargar y descargar datos
**Qué probar:** Configuración → «Cargar y descargar datos». Descargue la plantilla de equipos, llénela con 3 o 4 equipos de verdad y use «Probar sin guardar»; después «Cargar de verdad». Descargue el libro de Excel y el .zip.
**Decidí yo:**
- «Últimos servicios» no se puede cargar todavía (no existen los servicios hasta la parte 4e/Fase 5).
- La bitácora no sale en la descarga (puede ser enorme): pendiente bajarla aparte en CSV.

## Fase 4a — Órdenes de trabajo
**Qué probar:** menú «Órdenes». Cree una orden (busque un equipo por placa), agregue un trabajo del catálogo (necesita que el trabajo tenga horas para ese tipo de equipo: Equipos → Tipos de equipo / catálogo de trabajos), cambie estados, intente cerrar con un trabajo pendiente, anule una orden.
**Decidí yo:**
- Una orden pertenece a UN equipo (el cliente sale del equipo). Los equipos del propio taller no llevan cliente.
- «Cerrada» y «Anulada» son los estados que bloquean la orden (así lo dicen las banderas de los estados). «Entregada» saca al equipo del taller pero la orden aún se puede tocar.
- Si el trabajo no tiene horas para el tipo de equipo, el sistema pide escribirlas a mano en esa línea.
- Los materiales no se pueden agregar todavía (llegan con Inventario, Fase 5).
- Permisos: técnico y operador solo ven órdenes (sin precios); recepción ve precios y no costos; supervisor ve precios; gerente y administrador ven todo y solo ellos reabren una orden cerrada.

## Fase 4b — Tiempos reales, fotos y «Mis trabajos»
**Qué probar:** entre como un técnico (cree un colaborador con puesto de técnico y acceso, o use un usuario de pruebas), asígnele un trabajo desde la orden, y en «Mis trabajos»: Iniciar → Pausar → Detener por… → Terminar; suba una foto antes y otra después. Ojo: desde el celular la foto se reduce sola.
**Decidí yo:**
- Un técnico no puede tener dos trabajos en proceso a la vez (lo hace cumplir también la base de datos).
- Iniciar un trabajo exige técnico asignado. Un trabajo en proceso no cambia de técnico (primero se pausa).
- La matriz nivel × sistema: un colaborador **sin nivel asignado no tiene restricción**; con nivel, rige la matriz (que hoy viene toda habilitada).
- La recepción puede editar órdenes pero «Mis trabajos» solo existe para quien tiene el permiso `ordenes.trabajar` (administrador, gerente, supervisor y técnico).
- Hasta 20 fotos por trabajo. Terminar no pide confirmación (se puede volver a poner en proceso).
- El estado de la orden **no** cambia solo cuando empieza el primer trabajo: se cambia a mano (decisión pendiente: ¿quiere que pase sola a EN PROCESO?).

## Fase 4c — Citas
**Qué probar:** menú «Citas»: agende una cita para mañana (busque un equipo), reprográmela, cancele otra con motivo; cuando llegue la hora (o cambiando el día), pruebe «Recibir» (abre la orden) y «No se presentó». En Configuración → General, sección «Citas», cambie entre «solo coordinar» y «reservar», y en Configuración → Sucursales ponga un cupo diario para ver la diferencia.
**Decidí yo:**
- Hora de la cita: se escribe en la hora del taller; no se pueden agendar citas en días pasados.
- «Solo coordinar» (por defecto): si el cupo del día está lleno, avisa pero agenda. «Reservar»: rechaza. El cupo es por sucursal.
- «No se presentó» solo se puede marcar cuando ya pasó la hora de la cita.
- «Recibir» pide además el permiso de crear órdenes. El técnico, el operador y el visualizador ven las citas pero no las agendan; el bodeguero no las ve.
- Todavía no hay: planificación de carga por día/7 días/30 días (usa las horas estimadas; llega con los reportes), aviso al cliente de la cita (Fase 7), cita pedida por el cliente desde el portal (Fase 7) ni la cita nacida de un aviso de servicio (parte 4e).

## Fase 4d — Checklists
**Qué probar:** Configuración → Checklists: mire los tres sembrados (RECEPCIÓN, CALIDAD, ENTREGA), abra «Plantilla», cambie un ítem y guarde (crea la versión 2). En una orden, sección «Checklists» → agregue «Recepción del equipo», llénelo (pruebe un ítem en rojo: pide foto), pida la firma con el dedo (o con el ratón) y complételo. Luego, en «Qué checklists pide cada tipo de orden», pida CALIDAD «antes de cerrar la orden» (bloquear) y pruebe cerrar una orden sin él; si usted es administrador verá el botón para autorizar una excepción con motivo.
**Decidí yo:**
- Los requisitos vienen VACÍOS: ningún tipo de orden exige checklists hasta que usted lo configure (así no se frena el trabajo desde el primer día).
- Un checklist completado no se puede reabrir (candado). Si se equivocan, se abre otro del mismo tipo.
- Para completar RECEPCIÓN/ENTREGA se exige la lectura del medidor (se toma la de la orden si ya existe) y la firma del cliente.
- Solo administrador y gerente configuran tipos y plantillas; administrador, gerente y supervisor autorizan excepciones; técnico, operador, recepción y supervisor llenan.
- La firma y las fotos se guardan como archivos del taller y salen en la descarga de datos.
- Todavía no hay: informe PDF del checklist (Fase 6/7), la cotización que nace de un ítem en rojo (Fase 6) ni plantillas con aplicabilidad por ítem (solo por tipo de equipo, como se decidió).

## Fase 4e — Servicios programados
**Qué probar:** menú «Servicios» → Programas: cree «Servicio de 10 000 km» para un tipo de equipo (contador: odómetro, cada 10 000). Vaya a un equipo de ese tipo → pestaña «Servicios»: verá cómo va el reloj; registre lecturas del odómetro para ver cómo pasa a próximo, urgente y vencido; cargue un servicio ya hecho; agende la cita desde «Servicios → Por atender».
**Decidí yo:**
- El primer servicio de un equipo se cuenta desde el valor INICIAL de su contador (si el odómetro entró con 125 000 km y el servicio es cada 10 000, toca a los 135 000), salvo que se cargue un servicio anterior.
- Avisos sugeridos si no se escriben: kilómetros 1 000 y 200; millas 600 y 120; horas 50 y 10; días 30 y 7.
- Los servicios se definen por TIPO de equipo y todos los equipos de ese tipo los siguen. Un servicio de un contador que el equipo no tiene aparece como «Sin contador».
- Un checklist que respalda un servicio lo registra como realizado al completarse (con el valor del contador de ese momento).
- Solo contadores del equipo (no de componentes) por ahora; la cascada «un servicio incluye a otro» (servicio_incluye) NO se construyó: era opcional y avanzada.
- «Revisar avisos» solo anota qué avisos corresponde mandar; el correo o el aviso al teléfono llegan con la Fase 7 (avisos incluidos). Todavía no corre solo cada noche.
- La planificación de carga y la «lista del servicio» (kit) quedaron fuera a propósito (usted pidió olvidar el kit).

## Fase 5a — Inventario (materiales, compras, traslados, diferencias, márgenes)
**Qué probar:** menú «Inventario». (1) Pestaña Materiales → «Nuevo material»: código, nombre, clasificación (elija «99 Insumos generales» para aceite, trapos, etc.), unidad. (2) Pestaña Compras → «Registrar compra» con 2 materiales: vea que sube la existencia y el costo promedio. Repita con otro costo para ver el promedio ponderado. (3) Abra un material → «Trasladar» a otra bodega (cree una segunda bodega en Configuración → Áreas y bodegas) y «Corregir cantidad». (4) Pestaña Márgenes: defina 50 % para un sistema y 80 % para un material y vea el precio en la ficha. (5) Pestaña Movimientos: todo queda ahí.
**Decidí yo:**
- Las cantidades de inventario son SIEMPRE enteras (para medio metro use centímetros). La unidad de un material no se cambia cuando ya tiene movimientos.
- El margen general por defecto es 30 % y el precio se calcula con el costo promedio (ambos se cambian en Configuración → General, grupo «precios»). Un precio fijo en el material manda sobre todo.
- La clasificación es obligatoria porque de ella sale el margen. Los insumos generales cuelgan de un sistema «99» creado por la migración.
- La compra no se puede anular ni editar (como todo documento): un error se corrige con otra compra o con una diferencia con motivo. Fecha de la factura no puede ser futura.
- Quién hace qué: bodeguero recibe, traslada y corrige cantidades; solo administrador/gerente cambian el catálogo y los márgenes; los costos se ven solo con el permiso «ver costos».
- Todavía no hay (Fase 5b/5c): solicitudes de material y despacho a una orden, devoluciones, reservas, aplicabilidad de materiales a equipos y alertas de mínimo por correo.

## Estado de verificación (2026-11-12)
Probado en navegador real en el taller de práctica: 4c (agendar, reprogramar, recibir → orden), 4d (checklist con firma; bloquea sin foto/firma; queda cerrado), 4e (servicio programado, «urgente», agendar cita desde el servicio), 5a (material, compra, traslado). **Sin probar en pantalla:** cancelar cita y «no se presentó», subir fotos en checklist, «corregir cantidad» y márgenes (las pruebas automáticas sí los cubren). Para probar usted mismo la foto del checklist, hágalo desde un celular.
